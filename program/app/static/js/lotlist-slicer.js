/* =========================================================================
   異常ロット一覧のスライサー（Excel のスライサーと同じ: 列の重複なしの値を並べ、押して絞り込む）
   - 足した列ごとにカード。値は全部並べ（件数の帯つき）、多いときは「値を探す」で絞る。0 件の値も淡く並べる（押せる）
   - 件数は「ほかの絞り込み（検索・条件・列で絞り込む・ほかのスライサー）のもとで」の件数（自分の選択は除く）
   - 選んだ値は in の絞り込みとして一覧へ渡す（lot_list.build_filter_where / lotlist.rs）。空欄も選べる（値 ""）
   - 日付だけ・年月・年の書式で見せている列は、見えている値でまとめる（鍵は一覧と同じ levelKeyKind）
   - 置き場は左（既定）・右・上。足した列と選んだ値は表ごと、開閉は画面ごと（異常ロット一覧・作業実績で別）、置き場は全体で、この PC に覚える
   - 計算列（表示列で式から作った列）も足せる。式は画面にしか無いので、式が使う元の列の値の組と件数をサーバーに尋ね（columns）、
     組ごとに一覧と同じ見えている値（書式・読み替えの後）を計算して件数を足す。選んだ値は、その値になる組の tuple_in として一覧へ渡す
     （lot_list.slicer_combos・tuple_in / lotlist.rs）。組がまだ読めていない選択は、読めたときに一覧を引き直して効かせる
   一覧（lotlist.js）とは mount の引数だけでつながる: table（覚えの範囲）・screen（開閉を覚える画面）・api（問い合わせの頭）・params（どの設備か）・search・baseFilters・keyOf・label・onChange
     ・calcColumns（計算列の名前）・sourcesOf（計算列の式が使う元の列）・calcText（計算列の見えている値: 元の列の値の組 → 字）
   一覧の元（異常ロット一覧・作業実績の設備）を替えたら reset（前の元の値を出さない）
   版 3.30.0（7 案＋2 回目で選んだ M3: ui-proposals/2026-10-slicer-tools*）:
   - 値の行に ☑（いくつでも選ぶ）か ◉（1 つだけ選ぶ）。カードごとに選べる（⋯ のメニュー）。先頭の「（すべて）」で全部選ぶ・外す
   - 0 件の値を隠せる（⋯）。隠したときは値の下に「0 件 N 個を隠しています 出す」
   - カードの並びを変えられる（⋮⋮ を引く・⋯ の上へ／下へ／先頭へ／末尾へ）
   - 面の幅（上に置いたときは高さ）を、表との境目を引いて変える（キーでも・2 回押すと既定 280px）。字の大きさは頭の「🔍 100% ▾」（一覧の拡大と同じ形）
   - 選び方・0 件を隠すはカードの設定なので、表示の設定の書き出し・共有の書式・保存した見方にも入る。幅・字の大きさ・置き場はこの PC に覚える
   版 3.31.0（7 案＋2 回目で選んだ M4: ui-proposals/2026-10-timeline*）:
   - 値の並び（カードの ⋯）: 値の順（既定）・件数の多い順・件数の少ない順・値の逆順・手で並べる（値の行の ⋮⋮ を引く・Alt＋↑↓）。
     既定でないときだけ、値の上に「件数の多い順 ×」の札（今の並びと戻し方が同じ所に見える）
   - 幅を縮めても字を切らない: 値の名前は折り返す。見出しは名前が 7 字分より狭くなると、ボタンを次の行へ送る
   - タイムライン: 「＋ 列を足す…」の「タイムライン（期間で選ぶ）」から日付の列を足す。件数の山（日・月・年）の下の 2 点のスライダーで期間を決め、
     date_range の絞り込みとして一覧へ渡す（lot_list.build_filter_where / lotlist.rs）。期間の字を押すと日付で決められる。
     山の柱を押すとその日・月・年だけ。両端まで広げると期間なし（絞らない）。日付と読める値は一覧と同じ ToDate で読む
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const KEY = "tpa.lotlist.slicer.v1";
  const PLACES = [["left", "左"], ["right", "右"], ["top", "上"]];
  const SEARCH_FROM = 6;        // 値がこの数以上なら「値を探す」の欄を出す（数個なら探すまでもない）
  const BLANK = "（空欄）";
  const SIZE = { width: 280, minW: 200, maxW: 560, height: 260, minH: 140, maxH: 640, step: 20 };   // 面の幅（左右）・高さ（上）
  const ZOOM = { min: 70, max: 160, step: 10 };                                                        // 字の大きさ（%）
  const ORDERS = [["", "値の順（既定）"], ["count-desc", "件数の多い順"], ["count-asc", "件数の少ない順"], ["value-desc", "値の逆順"], ["manual", "手で並べる"]];
  const MAX_MANUAL = 1000;      // 手で並べた値を覚える数（並べる値の数 MAX_SLICER_VALUES と同じ）
  const DAY = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;
  let host = null, seq = 0;
  const vals = {};              // 列 → { key, values: [{value, count, all}], truncated, tuples?: Map(値 → [元の列の値の組]), uses?: [元の列] }（直近の答え）
  const MAX_TUPLES = 1000;      // 計算列で選べる値の組の数（サーバーの MAX_IN_VALUES と同じ）
  const sent = {};              // 計算列 → 一覧へ渡した組（JSON）。読み直した組と違えば（まだ読めていない・ほかの絞り込みで組が変わった）一覧を引き直す
  const qs = {};                // 列 → 「値を探す」に打った字（描き直しても残す）

  /* ---- 覚え: {open: {画面: 開いているか}, place, width, height, zoom, tables: {表: [{column, key, sel: [...], one?, hide0?, order?, manual?} | {column, kind: "time", from?, to?}]}} ----
     one: 1 つだけ選ぶ（無ければいくつでも）／hide0: 0 件の値を隠す／order: 値の並び（ORDERS。無ければ値の順）／manual: 手で並べた値の並び
     kind "time": タイムライン（from・to は 'YYYY-MM-DD'。無い側は限らない）
     開閉は画面ごと（版 3.20.0 まで全体で 1 つ。前の覚えは、どの画面にも引き継ぐ） */
  const load = () => {
    const s = TPA.local.get(KEY, {}), o = s.open;
    const num = (v, lo, hi, d) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : d);
    return { open: o && typeof o === "object" ? o : { all: !!o }, place: PLACES.some((p) => p[0] === s.place) ? s.place : "left", tables: s.tables || {},
      width: num(s.width, SIZE.minW, SIZE.maxW, SIZE.width), height: num(s.height, SIZE.minH, SIZE.maxH, SIZE.height), zoom: num(s.zoom, ZOOM.min, ZOOM.max, 100) };
  };
  let st = load();
  const save = () => TPA.local.set(KEY, st);
  const isOpen = () => !!(host && (host.screen() in st.open ? st.open[host.screen()] : st.open.all));
  const setOpen = (v) => { st.open[host.screen()] = !!v; save(); };
  const cards = () => (st.tables[host.table()] || []);
  const setCards = (list) => { const t = host.table(); if (list.length) st.tables[t] = list; else delete st.tables[t]; save(); };
  const cardOf = (col) => cards().find((c) => c.column === col);
  const isTime = (c) => c.kind === "time";
  /** カードが一覧を絞っているか（値を選んだ・期間を決めた） */
  const isActive = (c) => (isTime(c) ? !!(c.from || c.to) : c.sel.length > 0);

  /** 一覧へ渡す絞り込み（選んでいるカードだけ。except の列は除く＝その列自身の件数を数えるとき） */
  const isCalc = (col) => host.calcColumns().includes(col);
  const known = (col) => { const cs = host.columns(); return !cs.length || cs.includes(col) || isCalc(col); };
  function filters(except = null) {
    // 列がまだ分からない（開いた直後）ときも渡す。無い列はサーバーが外す（safe_filters）
    return cards().filter((c) => isActive(c) && c.column !== except && known(c.column)).flatMap((c) => {
      if (isTime(c)) return [{ column: c.column, op: "date_range", value: `${c.from || ""}..${c.to || ""}` }];
      if (!isCalc(c.column)) return [{ column: c.column, op: "in", value: JSON.stringify(c.sel), ...(c.key ? { key: c.key } : {}) }];
      const v = vals[c.column], value = tupleJson(c);
      if (except === null) sent[c.column] = value;          // 一覧へ渡す分（スライサー自身の件数のための分は数えない）
      return value == null ? [] : [{ column: c.column, op: "tuple_in", columns: v.uses, value }];
    });
  }
  /** 計算列のカードで選んだ値になる組（JSON の字）。組をまだ読めていなければ null */
  function tupleJson(c) {
    const v = vals[c.column];
    return v && v.tuples ? JSON.stringify(c.sel.flatMap((x) => v.tuples.get(x) || []).slice(0, MAX_TUPLES)) : null;
  }
  /** 計算列: 元の列の値の組と件数 → 見えている値ごとの件数（並びはふつうの列と同じ: SortKey の小さい順・空欄は最後） */
  function calcValues(col, uses, combos) {
    const by = new Map();
    combos.forEach((x) => {
      const row = Object.fromEntries(uses.map((k, i) => [k, x.values[i]]));
      const text = String(host.calcText(col, row) ?? "").trim();
      const b = by.get(text) || { value: text, count: 0, all: 0, tuples: [] };
      b.count += x.count; b.all += x.all; b.tuples.push(x.values);
      by.set(text, b);
    });
    const key = (v) => { const n = Number(v); return v !== "" && Number.isFinite(n) ? [0, n, ""] : [1, 0, v]; };
    const list = [...by.values()].sort((a, b) => (a.value === "") - (b.value === "") || (() => { const [x, y] = [key(a.value), key(b.value)];
      return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0); })());
    return { values: list.map(({ value, count, all }) => ({ value, count, all })), tuples: new Map(list.map((b) => [b.value, b.tuples])) };
  }
  const active = () => cards().filter(isActive).length;

  /* ---- 値を読む（カードごとに、自分の選択を除いた絞り込みで） ---- */
  async function refresh() {
    if (!host) return;
    paintEntry(); paintSum();
    if (!isOpen()) return;
    const my = ++seq, list = cards().filter(isShown);
    // 書式が変わって鍵が変わった列は、前の鍵で選んだ値が当たらないので選び直してもらう
    let changed = false;
    list.forEach((c) => { if (isTime(c)) return; const k = isCalc(c.column) ? "" : host.keyOf(c.column); if ((c.key || "") !== k) { c.key = k; if (c.sel.length) { c.sel = []; changed = true; } } });
    if (changed) { save(); host.onChange(); return; }
    await Promise.all(list.map(async (c) => {
      if (isTime(c)) return refreshTime(c, my);
      if (isCalc(c.column)) return refreshCalc(c, my);
      const q = new URLSearchParams({ ...host.params(), column: c.column, table: host.table() });
      if (c.key) q.set("key", c.key);
      if (host.search()) q.set("search", host.search());
      const f = host.baseFilters().concat(filters(c.column));
      if (f.length) q.set("filters", JSON.stringify(f));
      try {
        const r = await fetch(`${host.api()}/slicer?` + q, { cache: "no-store" });
        const d = await r.json();
        if (my === seq && r.ok) vals[c.column] = { key: c.key || "", values: d.values || [], truncated: !!d.truncated };
      } catch (_) { /* 次の読み込みで */ }
    }));
    if (my !== seq) return;
    render();
    // 計算列の選択: 一覧へ渡した組と読み直した組が違う（まだ読めていなかった・ほかの絞り込みで組が変わった）→ 一覧を引き直す。
    // 引き直したあとの読み直しは同じ組になるので、繰り返さない
    if (list.some((c) => isCalc(c.column) && c.sel.length && tupleJson(c) !== null && tupleJson(c) !== sent[c.column])) host.onChange();
  }
  /** タイムライン: 日付と読める値ごとの件数（スライサーの問い合わせを日付でまとめて。多すぎれば月でまとめて読み直す） */
  async function refreshTime(c, my) {
    const ask = async (key) => {
      const q = new URLSearchParams({ ...host.params(), column: c.column, table: host.table(), key });
      if (host.search()) q.set("search", host.search());
      const f = host.baseFilters().concat(filters(c.column));
      if (f.length) q.set("filters", JSON.stringify(f));
      const r = await fetch(`${host.api()}/slicer?` + q, { cache: "no-store" });
      return r.ok ? r.json() : null;
    };
    try {
      let unit = "date", d = await ask("date");
      if (d && d.truncated) { unit = "month"; d = await ask("month"); }
      if (my !== seq || !d) return;
      const shape = unit === "date" ? DAY : MONTH, ok = (d.values || []).filter((x) => shape.test(x.value));
      vals[c.column] = { time: true, unit, points: ok.map((x) => [x.value, x.count, x.all]),
        bad: (d.values || []).filter((x) => x.value !== "" && !shape.test(x.value)).reduce((n, x) => n + x.count, 0), truncated: !!d.truncated };
    } catch (_) { /* 次の読み込みで */ }
  }
  async function refreshCalc(c, my) {
    const uses = host.sourcesOf(c.column);
    if (!uses || !uses.length || uses.length > 4) {
      vals[c.column] = { key: "", values: [], truncated: false, error: !uses ? "式が読めないか、表に無い列を使っています" : !uses.length ? "式が列を使っていません" : "式が 5 つ以上の列を使っているため、スライサーにできません（4 列まで）" };
      return;
    }
    const q = new URLSearchParams({ ...host.params(), columns: JSON.stringify(uses), table: host.table() });
    if (host.search()) q.set("search", host.search());
    const f = host.baseFilters().concat(filters(c.column));
    if (f.length) q.set("filters", JSON.stringify(f));
    try {
      const r = await fetch(`${host.api()}/slicer?` + q, { cache: "no-store" });
      const d = await r.json();
      if (my !== seq) return;
      if (!r.ok) { vals[c.column] = { key: "", values: [], truncated: false, error: d.error || "値を読めませんでした" }; return; }
      vals[c.column] = { key: "", uses, truncated: !!d.truncated, combos: true, ...calcValues(c.column, uses, d.combos || []) };
    } catch (_) { /* 次の読み込みで */ }
  }

  /* ---- 描く ---- */
  const ZOOM_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/></svg>';
  /** 面の大きさ（左右は幅・上は高さ）と字の大きさを当てる。境目（表との間）の取っ手も置き場に合わせる */
  function paintSize() {
    const pane = $("#llSlicer"), top = st.place === "top";
    pane.style.flexBasis = `${top ? st.height : st.width}px`;   // 左右は幅・上は高さ（縦に並ぶ枠では flex-basis が高さ）
    pane.style.setProperty("--sx-h", `${st.height}px`);
    const cs = pane.querySelector(".sx-cards"); if (cs) cs.style.zoom = st.zoom === 100 ? "" : String(st.zoom / 100);
    const edge = $("#llSlicerEdge");
    if (edge) {
      edge.hidden = pane.hidden;
      edge.setAttribute("aria-orientation", top ? "horizontal" : "vertical");
      edge.setAttribute("aria-valuenow", top ? st.height : st.width);
      edge.setAttribute("aria-valuemin", top ? SIZE.minH : SIZE.minW);
      edge.setAttribute("aria-valuemax", top ? SIZE.maxH : SIZE.maxW);
      edge.title = `引いてスライサーの${top ? "高さ" : "幅"}を変えます（${top ? st.height : st.width}px。選んで ${top ? "↑↓" : "←→"} でも・2 回押すと既定）`;
    }
  }
  function render() {
    const pane = $("#llSlicer"), row = $("#llBodyRow");
    pane.hidden = !isOpen();
    row.dataset.place = st.place;
    paintEntry(); paintSum(); paintSize();
    if (!isOpen()) return;
    const used = new Set(cards().map((c) => c.column));
    const addable = host.columns().concat(host.calcColumns()).filter((c) => !used.has(c));
    const dated = host.dateColumns().filter((c) => !used.has(c) && host.columns().includes(c));
    const head = `<div class="sx-head"><b>スライサー</b>
      <button type="button" class="sx-zoombtn${st.zoom !== 100 ? " is-zoomed" : ""}" data-zoom aria-haspopup="dialog" aria-expanded="false" title="スライサーの字の大きさを変えます（この PC に覚えます）">${ZOOM_SVG}<b>${st.zoom}%</b><i aria-hidden="true">▾</i></button>
      <span class="sx-place" role="radiogroup" aria-label="置き場">${PLACES.map(([k, n]) => `<button type="button" role="radio" data-place="${k}" aria-checked="${st.place === k}" title="スライサーを表の${n}に置きます">${n}</button>`).join("")}</span>
      <button type="button" class="sx-close" data-close title="スライサーを閉じます（選んだ値はそのまま効きます）" aria-label="閉じる">×</button></div>`;
    const shown = cards().filter(isShown);
    const body = shown.map((c) => (isTime(c) ? timeHtml(c) : cardHtml(c))).join("")
      || '<p class="sx-empty">列を足すと、その列の値（重複なし）と件数が並びます。押した値の行だけが一覧に出ます。日付の列はタイムライン（期間で選ぶ）にもできます。</p>';
    // 足し口は 1 つ: 値で選ぶ（スライサー）と期間で選ぶ（タイムライン。日付の列だけ）を分けて並べる
    // 値は列の名前のまま（タイムラインは data-kind で見分ける）
    const opt = (c, kind) => `<option value="${esc(c)}"${kind === "t" ? ' data-kind="time"' : ""}>${esc(host.label(c))}${isCalc(c) ? "（式）" : ""}</option>`;
    const add = `<select id="llSlicerAdd" class="sx-add" aria-label="スライサーかタイムラインに列を足す"><option value="">＋ 列を足す…</option>`
      + `<optgroup label="スライサー（値で選ぶ）">${addable.map((c) => opt(c, "v")).join("")}</optgroup>`
      + (dated.length ? `<optgroup label="タイムライン（期間で選ぶ）">${dated.map((c) => opt(c, "t")).join("")}</optgroup>` : "") + "</select>";
    pane.innerHTML = head + `<div class="sx-cards">${body}${add}</div>`;
    paintSize();
    pane.querySelectorAll(".sx-q").forEach((inp) => { const q = qs[inp.closest(".sx-card").dataset.col]; if (q) { inp.value = q; filterValues(inp); } });
  }
  /** 出すカード（表にある列・計算列。タイムラインは表にある列だけ） */
  const isShown = (c) => host.columns().includes(c.column) || (!isTime(c) && isCalc(c.column));
  /** カードの値のうち、いま見えている物（0 件を隠す・値を探すの字に合う物） */
  const seen = (c) => {
    const v = vals[c.column], q = String(qs[c.column] || "").trim().toLowerCase(), sel = new Set(c.sel);
    return ordered(c, v ? v.values : []).filter((x) => !(c.hide0 && !x.count && !sel.has(x.value)) && (!q || (x.value === "" ? BLANK : x.value).toLowerCase().includes(q)));
  };
  /** 値の並び（ORDERS）: 件数の順は同じ件数なら値の順のまま。値の逆順でも空欄は最後。手で並べた値の後ろに、まだ並べていない値を値の順で */
  function ordered(c, list) {
    const o = c.order || "";
    if (o === "count-desc" || o === "count-asc") { const k = o === "count-desc" ? -1 : 1; return list.slice().sort((a, b) => k * (a.count - b.count) || k * (a.all - b.all)); }
    if (o === "value-desc") { const r = list.filter((x) => x.value !== "").reverse(); return r.concat(list.filter((x) => x.value === "")); }
    if (o === "manual") { const at = new Map((c.manual || []).map((v, i) => [v, i])), big = at.size;
      return list.map((x, i) => [x, at.has(x.value) ? at.get(x.value) : big + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]); }
    return list;
  }
  const orderName = (o) => (ORDERS.find((x) => x[0] === o) || ORDERS[0])[1];
  function cardHtml(c) {
    const v = vals[c.column] && !vals[c.column].time ? vals[c.column] : null, sel = new Set(c.sel), one = !!c.one;
    const list = ordered(c, v ? v.values : []), manual = c.order === "manual";
    const max = Math.max(1, ...list.map((x) => x.count));
    const hidden0 = c.hide0 ? list.filter((x) => !x.count && !sel.has(x.value)).length : 0;
    const search = list.length >= SEARCH_FROM ? `<input class="sx-q" type="search" placeholder="値を探す" aria-label="「${esc(host.label(c.column))}」の値を探す" autocomplete="off">` : "";
    const mark = (on) => `<i class="sx-mk${one ? " is-one" : ""}${on ? " is-on" : ""}" aria-hidden="true"></i>`;
    // 先頭の（すべて）: いくつでも選ぶカードは、見えている値を全部選ぶ／全部外す（☑・一部なら ━）。1 つだけ選ぶカードは「選ばない」（◉）
    const visible = list.filter((x) => !(c.hide0 && !x.count && !sel.has(x.value)));
    const nOn = visible.filter((x) => sel.has(x.value)).length;
    const allState = one ? (c.sel.length ? "" : " is-on") : nOn && nOn === visible.length ? " is-on" : nOn ? " is-half" : "";
    const all = v && visible.length > 1 ? `<button type="button" class="sx-v sx-all" data-all aria-pressed="${allState === " is-on"}" title="${one ? "選ばない（全部の値の行を出す）" : "見えている値を全部選ぶ（全部選んでいれば全部外す）"}">`
      + `<span><i class="sx-mk${one ? " is-one" : ""}${allState}" aria-hidden="true"></i>（すべて）</span><i>${one ? "" : `${nOn} / ${visible.length}`}</i></button>` : "";
    const items = !v ? '<p class="sx-wait">読み込み中…</p>' : all + list.map((x) => {
      const on = sel.has(x.value), label = x.value === "" ? BLANK : x.value;
      const hide = c.hide0 && !x.count && !on;
      return `<button type="button" class="sx-v${on ? " is-on" : ""}${x.count ? "" : " is-zero"}" data-v="${esc(x.value)}" data-n="${x.count}" aria-pressed="${on}"${hide ? " data-zero-hidden hidden" : ""}`
        + ` style="--w:${Math.round(x.count / max * 100)}%" title="${esc(label)}：${x.count} 件（絞り込みを外すと ${x.all} 件）${manual ? "\n⋮⋮ を引くか Alt＋↑↓ で並べ替え" : ""}">`
        + `<span>${manual ? '<i class="sx-vgrip" aria-hidden="true">⋮⋮</i>' : ""}${mark(on)}<em>${esc(label)}</em></span><i>${x.count}</i></button>`;
    }).join("") + (v.error ? `<p class="sx-more">${esc(v.error)}</p>` : "")
      + (v.truncated ? `<p class="sx-more">${v.combos ? "元の列の値の組が多いため、件数の多い組から並べています（件数の少ない値は出ないことがあります）" : `値が多いため、先頭の ${list.length} 通りだけを並べています`}</p>` : "")
      + (v.tuples && c.sel.reduce((n, x) => n + (v.tuples.get(x) || []).length, 0) > MAX_TUPLES ? `<p class="sx-more">選んだ値になる元の値の組が ${MAX_TUPLES} を超えたため、先頭の ${MAX_TUPLES} 組で絞っています</p>` : "")
      + (hidden0 ? `<p class="sx-zero">0 件 ${hidden0} 個を隠しています<button type="button" data-show0 title="0 件の値も並べます（⋯ の「0 件の値を隠す」と同じ）">出す</button></p>` : "");
    return `<section class="sx-card${one ? " is-one" : ""}" data-col="${esc(c.column)}">
      <div class="sx-ch"><span class="sx-grip" title="つかんで並べ替え（⋯ の上へ・下へでも）" aria-hidden="true">⋮⋮</span>
        <b title="${esc(c.column)}${isCalc(c.column) ? `（計算列。式が使う列: ${esc((host.sourcesOf(c.column) || []).join("・"))}）` : ""}">${esc(host.label(c.column))}${isCalc(c.column) ? '<small class="sx-calc">式</small>' : ""}</b>
        <span class="sx-acts">${c.sel.length ? `<button type="button" class="sx-clr" data-clr title="この列の選択を外します">${c.sel.length} 選択 ×</button>` : ""}
        <button type="button" class="sx-more-btn" data-menu aria-haspopup="menu" aria-expanded="false" title="選び方（1 つだけ／いくつでも）・0 件の値を隠す・値の並び・カードの並び" aria-label="「${esc(host.label(c.column))}」のスライサーの操作">⋯</button>
        <button type="button" class="sx-rm" data-rm title="このスライサーを外します（選んだ値も外れます）">外す</button></span></div>
      ${search}${c.order ? `<p class="sx-ord"><button type="button" data-order-clear title="値の順（既定）に戻します">${esc(manual ? "手で並べた順" : orderName(c.order))}<b aria-hidden="true">×</b></button>${manual ? "<small>⋮⋮ を引いて並べ替え</small>" : ""}</p>` : ""}<div class="sx-vals" role="group" aria-label="${esc(host.label(c.column))}の値（${one ? "1 つだけ選ぶ" : "いくつでも選ぶ"}）">${items}</div></section>`;
  }
  /* ---- タイムライン ----
     日付は 'YYYY-MM-DD' の字のまま数える（new Date('YYYY-MM-DD') は UTC で読まれるので、日の足し引きは UTC で揃える） */
  const utc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(utc(d) + n * 864e5);
  const monthEnd = (y, m) => iso(Date.UTC(y, m, 0));            // m は 1〜12
  const slash = (d) => d.replace(/-/g, "/");
  const ymd = (d) => `${+d.slice(0, 4)}/${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  /** 件数の山の柱: 期間が 92 日までなら日・10 年までなら月・それより長ければ年。→ { unit, bins: [{start, end, n, all}] } */
  function timeBins(v) {
    const pts = v.points.map(([k, n, a]) => [k.length === 7 ? `${k}-01` : k, n, a]);
    if (!pts.length) return { unit: "", bins: [] };
    const first = pts[0][0], last = v.unit === "month" ? monthEnd(+pts[pts.length - 1][0].slice(0, 4), +pts[pts.length - 1][0].slice(5, 7)) : pts[pts.length - 1][0];
    const days = Math.round((utc(last) - utc(first)) / 864e5) + 1, months = (+last.slice(0, 4) - +first.slice(0, 4)) * 12 + +last.slice(5, 7) - +first.slice(5, 7) + 1;
    const unit = v.unit === "date" && days <= 92 ? "day" : months <= 120 ? "month" : "year";
    const bins = [];
    if (unit === "day") for (let d = first; d <= last; d = addDays(d, 1)) bins.push({ start: d, end: d, n: 0, all: 0 });
    else if (unit === "month") for (let y = +first.slice(0, 4), m = +first.slice(5, 7), i = 0; i < months; i++, m === 12 ? (m = 1, y++) : m++) bins.push({ start: `${y}-${String(m).padStart(2, "0")}-01`, end: monthEnd(y, m), n: 0, all: 0 });
    else for (let y = +first.slice(0, 4); y <= +last.slice(0, 4); y++) bins.push({ start: `${y}-01-01`, end: `${y}-12-31`, n: 0, all: 0 });
    let i = 0;
    pts.forEach(([d, n, a]) => { while (i < bins.length - 1 && d > bins[i].end) i++; bins[i].n += n; bins[i].all += a; });
    return { unit, bins };
  }
  /** 決めた期間 → 柱の番号 [lo, hi]（両端を含む）。決めていない側は端 */
  function timeIdx(c, bins) {
    const n = bins.length;
    let lo = c.from ? bins.findIndex((b) => b.end >= c.from) : 0, hi = -1;
    if (c.to) { for (let i = n - 1; i >= 0; i--) if (bins[i].start <= c.to) { hi = i; break; } } else hi = n - 1;
    if (lo < 0) lo = n - 1;
    return [Math.max(0, Math.min(lo, hi)), Math.max(0, hi)];
  }
  /** 期間の中の件数（日付ごとの件数を、決めた日で数える） */
  const timeCount = (c, v) => v.points.reduce((s, [k, n]) => {
    const a = k.length === 7 ? `${k}-01` : k, b = k.length === 7 ? monthEnd(+k.slice(0, 4), +k.slice(5, 7)) : k;
    return s + ((!c.to || a <= c.to) && (!c.from || b >= c.from) ? n : 0);
  }, 0);
  const timeText = (c) => (c.from && c.to ? `${slash(c.from)} 〜 ${slash(c.to)}` : c.from ? `${slash(c.from)} から` : c.to ? `${slash(c.to)} まで` : "全期間");
  const UNIT = { day: ["日", "日ごと"], month: ["月", "月ごと"], year: ["年", "年ごと"] };
  /** 柱の名前（山の柱・スライダーの字に出す） */
  const binText = (b, unit) => (unit === "day" ? ymd(b.start) : unit === "month" ? `${b.start.slice(0, 4)}/${+b.start.slice(5, 7)}` : b.start.slice(0, 4));
  /** 目盛り: 日の柱は月で・月の柱は年で・年の柱は 5 年ごとに区切って名前を置く（狭ければ名前は隠れる） */
  function timeAxis(bins, unit) {
    const key = (b) => (unit === "day" ? b.start.slice(0, 7) : unit === "month" ? b.start.slice(0, 4) : String(Math.floor(+b.start.slice(0, 4) / 5) * 5));
    const runs = [];
    bins.forEach((b) => { const k = key(b); if (runs.length && runs[runs.length - 1][0] === k) runs[runs.length - 1][1]++; else runs.push([k, 1]); });
    return `<div class="tl-axis" aria-hidden="true">${runs.map(([k, n]) => `<span style="flex:${n}">${unit === "day" ? `${+k.slice(5, 7)}月` : k}</span>`).join("")}</div>`;
  }
  const editing = new Set();     // 日付の欄を開いているタイムライン（列。その場だけ）
  function timeHtml(c) {
    const v = vals[c.column] && vals[c.column].time ? vals[c.column] : null, on = isActive(c), name = host.label(c.column);
    const head = `<div class="sx-ch"><span class="sx-grip" title="つかんで並べ替え（⋯ の上へ・下へでも）" aria-hidden="true">⋮⋮</span>
        <b title="${esc(c.column)}（タイムライン: 期間で選ぶ）">${esc(name)}<small class="tl-tag">期間</small></b>
        <span class="sx-acts">${on ? '<button type="button" class="sx-clr" data-clr title="期間を外します（全期間に戻します）">期間 ×</button>' : ""}
        <button type="button" class="sx-more-btn" data-menu aria-haspopup="menu" aria-expanded="false" title="カードの並び" aria-label="「${esc(name)}」のタイムラインの操作">⋯</button>
        <button type="button" class="sx-rm" data-rm title="このタイムラインを外します（期間も外れます）">外す</button></span></div>`;
    if (!v) return `<section class="sx-card tl-card" data-col="${esc(c.column)}" data-time>${head}<p class="sx-wait">読み込み中…</p></section>`;
    const { unit, bins } = timeBins(v);
    if (!bins.length) return `<section class="sx-card tl-card" data-col="${esc(c.column)}" data-time>${head}<p class="sx-more">日付と読める値がありません（ほかの絞り込みを外すと出ることがあります）。</p></section>`;
    const [lo, hi] = timeIdx(c, bins), n = bins.length, max = Math.max(1, ...bins.map((b) => b.n));
    const first = bins[0].start, last = bins[n - 1].end, ed = editing.has(c.column);
    const range = `<button type="button" class="tl-range${on ? "" : " is-all"}" data-tl-edit aria-expanded="${ed}" title="押すと、始めと終わりの日付を打って決められます">`
      + `<b>${esc(timeText(c))}</b><i aria-hidden="true">✎</i></button>`
      + `<small class="tl-sum" data-tl-sum>${on ? `${(Math.round((utc(c.to || last) - utc(c.from || first)) / 864e5) + 1).toLocaleString()} 日・` : `${slash(first)} 〜 ${slash(last)}・`}${timeCount(c, v).toLocaleString()} 件</small>`;
    const edit = ed ? `<div class="tl-edit"><input type="date" data-tl-from value="${esc(c.from || "")}" min="${first}" max="${last}" aria-label="始めの日（空なら限らない）">`
      + `<span>〜</span><input type="date" data-tl-to value="${esc(c.to || "")}" min="${first}" max="${last}" aria-label="終わりの日（空なら限らない）"></div>` : "";
    const bars = `<div class="tl-bars" role="group" aria-label="${esc(name)}の${UNIT[unit][1]}の件数（押すとその${UNIT[unit][0]}だけ）">${bins.map((b, i) =>
      `<button type="button" class="${i >= lo && i <= hi ? "on" : ""}" data-tl-bin="${i}" style="--h:${b.n ? Math.max(6, Math.round(b.n / max * 100)) : 0}%" title="${esc(binText(b, unit))}：${b.n} 件\n押すとこの${UNIT[unit][0]}だけ（Shift で今の期間をここまで広げる）"></button>`).join("")}</div>`;
    const knob = (k, i) => `<b class="tl-h" data-tl-h="${k}" role="slider" tabindex="0" aria-label="${k === "lo" ? "始め" : "終わり"}" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${i}"`
      + ` aria-valuetext="${esc(k === "lo" ? (c.from ? slash(c.from) : "限らない") : (c.to ? slash(c.to) : "限らない"))}" style="left:${(i / n * 100).toFixed(3)}%" title="引いて期間の${k === "lo" ? "始め" : "終わり"}を決めます（←→ で 1 ${UNIT[unit][0]}・Home／End で端）"></b>`;
    const track = `<div class="tl-track" data-tl-track><span class="tl-fill" style="left:${(lo / n * 100).toFixed(3)}%;width:${((hi + 1 - lo) / n * 100).toFixed(3)}%"></span>${knob("lo", lo)}${knob("hi", hi + 1)}</div>`;
    const note = (v.bad ? `<p class="sx-more">日付と読めない値が ${v.bad.toLocaleString()} 件あります（期間を決めると外れます）。</p>` : "")
      + (v.truncated ? '<p class="sx-more">日付が多いため、月ごとに数えています。</p>' : "");
    return `<section class="sx-card tl-card${on ? " is-on" : ""}" data-col="${esc(c.column)}" data-time data-unit="${unit}">${head}<div class="tl-head">${range}</div>${edit}${bars}${track}${timeAxis(bins, unit)}${note}</section>`;
  }
  /** 期間を決める（柱の番号の端: lo は 0〜n-1・hi は lo〜n-1。両端まで広げた側は限らない）。commit で一覧を引き直す */
  function setTime(col, lo, hi, commit = true) {
    const c = cardOf(col), v = vals[col]; if (!c || !v || !v.time) return;
    const { bins } = timeBins(v), n = bins.length; if (!n) return;
    lo = Math.max(0, Math.min(n - 1, lo)); hi = Math.max(lo, Math.min(n - 1, hi));
    const from = lo === 0 ? "" : bins[lo].start, to = hi === n - 1 ? "" : bins[hi].end;
    if ((c.from || "") === from && (c.to || "") === to) { if (commit) render(); return; }
    if (from) c.from = from; else delete c.from;
    if (to) c.to = to; else delete c.to;
    save();
    if (commit) { render(); host.onChange(); } else paintTime(col);
  }
  /** 引いている間: カードの中だけ描き直す（取っ手の要素を残して、引くのを切らない） */
  function paintTime(col) {
    const el = $("#llSlicer").querySelector(`.tl-card[data-col="${CSS.escape(col)}"]`), c = cardOf(col), v = vals[col]; if (!el || !c || !v) return;
    const { bins } = timeBins(v), n = bins.length, [lo, hi] = timeIdx(c, bins);
    el.querySelectorAll("[data-tl-bin]").forEach((b, i) => b.classList.toggle("on", i >= lo && i <= hi));
    const f = el.querySelector(".tl-fill"); f.style.left = `${(lo / n * 100).toFixed(3)}%`; f.style.width = `${((hi + 1 - lo) / n * 100).toFixed(3)}%`;
    const [a, b] = el.querySelectorAll("[data-tl-h]"); a.style.left = `${(lo / n * 100).toFixed(3)}%`; b.style.left = `${((hi + 1) / n * 100).toFixed(3)}%`;
    a.setAttribute("aria-valuenow", lo); b.setAttribute("aria-valuenow", hi + 1);
    el.querySelector(".tl-range b").textContent = timeText(c);
    el.querySelector(".tl-range").classList.toggle("is-all", !isActive(c));
    const first = bins[0].start, last = bins[n - 1].end;
    el.querySelector("[data-tl-sum]").textContent = (isActive(c) ? `${(Math.round((utc(c.to || last) - utc(c.from || first)) / 864e5) + 1).toLocaleString()} 日・` : `${slash(first)} 〜 ${slash(last)}・`) + `${timeCount(c, v).toLocaleString()} 件`;
  }
  /** スライダー: 取っ手を引く（近い方の取っ手を、押した所へ）。柱の境目に吸い付く。離したときに一覧を引き直す */
  function bindTime(pane) {
    let drag = null;
    pane.addEventListener("pointerdown", (e) => {
      const track = e.target.closest("[data-tl-track]"); if (!track || e.button !== 0) return;
      const card = track.closest(".tl-card"), col = card.dataset.col, c = cardOf(col), v = vals[col]; if (!c || !v) return;
      const { bins } = timeBins(v), n = bins.length, [lo, hi] = timeIdx(c, bins), r = track.getBoundingClientRect();
      const at = (x) => Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * n);
      const h = e.target.closest("[data-tl-h]");
      const which = h ? h.dataset.tlH : Math.abs(at(e.clientX) - lo) <= Math.abs(at(e.clientX) - (hi + 1)) ? "lo" : "hi";
      e.preventDefault(); track.setPointerCapture(e.pointerId);
      drag = { col, which, at, lo, hi };
      track.classList.add("is-dragging");
      move(e);
    });
    const move = (e) => {
      if (!drag) return;
      const e1 = drag.at(e.clientX);
      if (drag.which === "lo") drag.lo = Math.min(e1, drag.hi); else drag.hi = Math.max(e1 - 1, drag.lo);
      setTime(drag.col, drag.lo, drag.hi, false);
    };
    pane.addEventListener("pointermove", move);
    const end = (e) => {
      if (!drag) return;
      const { col } = drag; drag = null;
      e.target.closest("[data-tl-track]")?.classList.remove("is-dragging");
      render(); host.onChange();
      requestAnimationFrame(() => $("#llSlicer").querySelector(`.tl-card[data-col="${CSS.escape(col)}"] [data-tl-h]`)?.focus({ preventScroll: true }));
    };
    pane.addEventListener("pointerup", end); pane.addEventListener("pointercancel", end);
    // キー: ←→ で 1 柱・Home／End で端。押すたびに引き直すと重いので、指を離して少し待ってから
    let timer = 0;
    pane.addEventListener("keydown", (e) => {
      const h = e.target.closest("[data-tl-h]"); if (!h) return;
      const col = h.closest(".tl-card").dataset.col, c = cardOf(col), v = vals[col]; if (!c || !v) return;
      const { bins } = timeBins(v), n = bins.length; let [lo, hi] = timeIdx(c, bins);
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 }[e.key];
      if (step == null && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      if (h.dataset.tlH === "lo") lo = e.key === "Home" ? 0 : e.key === "End" ? hi : Math.max(0, Math.min(hi, lo + step));
      else hi = e.key === "Home" ? lo : e.key === "End" ? n - 1 : Math.max(lo, Math.min(n - 1, hi + step));
      setTime(col, lo, hi, false);
      clearTimeout(timer); timer = setTimeout(() => { host.onChange(); }, 350);
    });
  }
  /** 道具の行の入口: 開いているか・選んでいるスライサーの数 */
  function paintEntry() {
    const b = $("#llSlicerBtn"); if (!b) return;
    const n = active();
    b.classList.toggle("is-on", isOpen() || n > 0);
    b.setAttribute("aria-expanded", isOpen());
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="5" height="12" rx="1"/><path d="M9 3.5h5.5M9 6.5h5.5M9 9.5h5.5M9 12.5h5.5"/></svg>スライサー${n ? `<b>${n}</b>` : ""}`;
  }
  /** 件数の行の札: 「設備: CR1・L-1 ×」。スライサーを閉じても何で絞っているかが分かる */
  function paintSum() {
    const box = $("#llSlicerSum"); if (!box) return;
    const on = cards().filter((c) => isActive(c) && isShown(c));
    box.hidden = !on.length;
    // 件数の行の「効いている物」のタブ（lotlist-active.js）が読む数と要約
    box.dataset.count = on.length;
    box.dataset.summary = on.map((c) => `${host.label(c.column)} ${isTime(c) ? timeText(c) : c.sel.map((v) => (v === "" ? BLANK : v)).join("・")}`).join(" ／ ");
    box.innerHTML = on.map((c) => {
      const names = isTime(c) ? [timeText(c)] : c.sel.map((v) => (v === "" ? BLANK : v));
      const text = names.length > 3 ? `${names.slice(0, 3).join("・")} ほか ${names.length - 3}` : names.join("・");
      return `<span class="sx-chip" title="${esc(host.label(c.column))}: ${esc(names.join("・"))}"><b>${esc(host.label(c.column))}:</b> ${esc(text)}`
        + `<button type="button" data-clear="${esc(c.column)}" aria-label="「${esc(host.label(c.column))}」のスライサーの選択を外す">×</button></span>`;
    }).join("");
  }

  /* ---- 操作 ---- */
  /** 値を押した: いくつでも選ぶカードは入れる・外す。1 つだけ選ぶカードはその値だけ（選んである値をもう一度押すと選ばない） */
  function toggleValue(col, v) {
    const c = cardOf(col); if (!c) return;
    if (c.one) c.sel = c.sel.length === 1 && c.sel[0] === v ? [] : [v];
    else c.sel = c.sel.includes(v) ? c.sel.filter((x) => x !== v) : c.sel.concat(v);
    save(); render(); host.onChange();
  }
  /** （すべて）: いくつでも選ぶカードは、見えている値を全部選ぶ（全部選んでいれば全部外す）。1 つだけ選ぶカードは選ばない */
  function toggleAll(col) {
    const c = cardOf(col); if (!c) return;
    const vs = seen(c).map((x) => x.value), sel = new Set(c.sel);
    if (c.one || (vs.length && vs.every((x) => sel.has(x)))) c.sel = c.one ? [] : c.sel.filter((x) => !vs.includes(x));
    else c.sel = c.sel.concat(vs.filter((x) => !sel.has(x)));
    save(); render(); host.onChange();
  }
  /** 選び方を替える。いくつでも → 1 つだけ のとき、選んでいた値は先頭の 1 つだけ残す（カードの値の並びで） */
  function setOne(col, one) {
    const c = cardOf(col); if (!c || !!c.one === one) return;
    const before = c.sel.length;
    if (one) { const order = ordered(c, vals[col] && vals[col].values ? vals[col].values : []).map((x) => x.value); c.sel = c.sel.slice().sort((x, y) => order.indexOf(x) - order.indexOf(y)).slice(0, 1); c.one = true; }
    else delete c.one;
    save(); render();
    if (c.sel.length !== before) host.onChange();
  }
  /** 値の並びを替える。手で並べるにしたときは、今見えている並びから始める（その値の行に移る） */
  function setOrder(col, o) {
    const c = cardOf(col); if (!c || !ORDERS.some((x) => x[0] === o)) return;
    if (o === "manual" && c.order !== "manual") c.manual = ordered(c, vals[col] && vals[col].values ? vals[col].values : []).map((x) => x.value).slice(0, MAX_MANUAL);
    if (o) c.order = o; else delete c.order;
    if (o !== "manual") delete c.manual;
    save(); render();
    if (o === "manual") requestAnimationFrame(() => $("#llSlicer").querySelector(`.sx-card[data-col="${CSS.escape(col)}"] .sx-v[data-v]`)?.focus());
  }
  /** 手で並べた値の並び（keys: 見えている値の並び。隠れている値はその場所のまま＝カードの並べ替えと同じ考え） */
  function reorderValues(col, keys) {
    const c = cardOf(col), v = vals[col]; if (!c || !v || !v.values) return;
    const list = ordered(c, v.values).map((x) => x.value), slots = list.map((x, i) => (keys.includes(x) ? i : -1)).filter((i) => i >= 0);
    keys.filter((k) => list.includes(k)).forEach((k, n) => { list[slots[n]] = k; });
    c.order = "manual"; c.manual = list.slice(0, MAX_MANUAL);
    save(); render();
  }
  function setHide0(col, on) { const c = cardOf(col); if (!c) return; if (on) c.hide0 = true; else delete c.hide0; save(); render(); }
  /** カードの並びを変える（keys: 列の並び。いま出ていないカードはその場所のまま＝作業実績の設備のタブと同じ考え） */
  function reorder(keys) {
    const list = cards(), slots = list.map((c, i) => (keys.includes(c.column) ? i : -1)).filter((i) => i >= 0);
    const by = new Map(list.map((c) => [c.column, c])), next = list.slice();
    keys.filter((k) => by.has(k)).forEach((k, n) => { next[slots[n]] = by.get(k); });
    setCards(next); render(); refresh();
  }
  const shownKeys = () => [...$("#llSlicer").querySelectorAll(".sx-card")].map((x) => x.dataset.col);
  function moveCard(col, where) {
    const keys = shownKeys(), i = keys.indexOf(col); if (i < 0) return;
    const to = where === "first" ? 0 : where === "last" ? keys.length - 1 : i + where;
    if (to < 0 || to >= keys.length || to === i) return;
    keys.splice(to, 0, keys.splice(i, 1)[0]);
    reorder(keys);
    requestAnimationFrame(() => $(`#llSlicer .sx-card[data-col="${CSS.escape(col)}"] [data-menu]`)?.focus());
  }
  /** カードの ⋯ のメニュー: 選び方・0 件を隠す・並び */
  let menuOff = null;
  function closeMenu() { if (menuOff) { menuOff(); menuOff = null; } document.querySelector(".sx-menu")?.remove(); $("#llSlicer").querySelectorAll("[data-menu][aria-expanded=true]").forEach((b) => b.setAttribute("aria-expanded", "false")); }
  function openMenu(btn) {
    const col = btn.closest(".sx-card").dataset.col, c = cardOf(col), keys = shownKeys(), i = keys.indexOf(col), time = isTime(c);
    closeMenu();
    const m = document.createElement("div");
    m.className = "sx-menu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", `「${host.label(col)}」のスライサー`);
    const item = (act, text, { role = "menuitem", on = null, off = false, kind = "" } = {}) =>
      `<button type="button" role="${role}" data-act="${act}"${on === null ? "" : ` aria-checked="${on}"`}${off ? " disabled" : ""}>${kind ? `<i class="sx-mk ${kind}${on ? " is-on" : ""}" aria-hidden="true"></i>` : ""}${text}</button>`;
    m.innerHTML = (time ? "" : '<small>選び方</small>'
      + item("one", "1 つだけ選ぶ", { role: "menuitemradio", on: !!c.one, kind: "is-one" })
      + item("many", "いくつでも選ぶ", { role: "menuitemradio", on: !c.one, kind: "is-many" })
      + "<hr>" + item("hide0", "0 件の値を隠す", { role: "menuitemcheckbox", on: !!c.hide0, kind: "is-many" })
      + '<hr><small>値の並び</small>'
      + ORDERS.map(([k, t]) => item(`order:${k}`, t, { role: "menuitemradio", on: (c.order || "") === k, kind: "is-one" })).join("") + "<hr>")
      + '<small>カードの並び</small>'
      + item("up", "↑ 上へ", { off: i <= 0 }) + item("down", "↓ 下へ", { off: i >= keys.length - 1 })
      + item("first", "⤒ 先頭へ", { off: i <= 0 }) + item("last", "⤓ 末尾へ", { off: i >= keys.length - 1 });
    document.body.appendChild(m);
    TPA.placeBelow(m, btn, "right");
    btn.setAttribute("aria-expanded", "true");
    menuOff = TPA.dismissable(m, () => { menuOff = null; closeMenu(); btn.focus(); }, { keep: btn });
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
      const act = b.dataset.act;
      closeMenu();
      if (act === "one" || act === "many") setOne(col, act === "one");
      else if (act === "hide0") setHide0(col, !c.hide0);
      else if (act.startsWith("order:")) setOrder(col, act.slice(6));
      else moveCard(col, { up: -1, down: 1, first: "first", last: "last" }[act]);
      if (!["up", "down", "first", "last"].includes(act) && act !== "order:manual") $(`#llSlicer .sx-card[data-col="${CSS.escape(col)}"] [data-menu]`)?.focus();
    });
    m.addEventListener("keydown", (e) => {
      const bs = [...m.querySelectorAll("button:not(:disabled)")], k = bs.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); bs[(k + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); }
    });
    (m.querySelector('[aria-checked="true"]') || m.querySelector("button:not(:disabled)")).focus();
  }
  /** 字の大きさの面（一覧の拡大と同じ形: − つまみ ＋・100% に戻す） */
  let zoomOff = null;
  function closeZoom() { if (zoomOff) { zoomOff(); zoomOff = null; } document.querySelector(".sx-zoompop")?.remove(); $("#llSlicer [data-zoom]")?.setAttribute("aria-expanded", "false"); }
  function setZoom(z) {
    st.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.round(z / ZOOM.step) * ZOOM.step)); save(); paintSize();
    const b = $("#llSlicer [data-zoom]"); if (b) { b.querySelector("b").textContent = `${st.zoom}%`; b.classList.toggle("is-zoomed", st.zoom !== 100); }
    const pop = document.querySelector(".sx-zoompop");
    if (pop) { pop.querySelector("input").value = st.zoom; pop.querySelector("output").textContent = `${st.zoom}%`; pop.querySelector("[data-z100]").hidden = st.zoom === 100;
      pop.querySelector("[data-zm]").disabled = st.zoom <= ZOOM.min; pop.querySelector("[data-zp]").disabled = st.zoom >= ZOOM.max; }
  }
  function openZoom(btn) {
    closeZoom();
    const m = document.createElement("div");
    m.className = "ll-zoompop sx-zoompop"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "スライサーの字の大きさ");
    m.innerHTML = `<span class="ll-zoom">${ZOOM_SVG}<button type="button" class="ll-zpm" data-zm aria-label="小さく" title="${ZOOM.step}% 小さく">−</button>
      <input type="range" min="${ZOOM.min}" max="${ZOOM.max}" step="${ZOOM.step}" value="${st.zoom}" aria-label="スライサーの字の大きさ">
      <button type="button" class="ll-zpm" data-zp aria-label="大きく" title="${ZOOM.step}% 大きく">＋</button><output>${st.zoom}%</output>
      <button type="button" data-z100 title="100% に戻します">100%に戻す</button></span>`;
    document.body.appendChild(m);
    TPA.placeBelow(m, btn, "left");
    btn.setAttribute("aria-expanded", "true");
    zoomOff = TPA.dismissable(m, () => { zoomOff = null; closeZoom(); btn.focus(); }, { keep: btn });
    m.querySelector("input").addEventListener("input", (e) => setZoom(+e.target.value));
    m.addEventListener("click", (e) => {
      if (e.target.closest("[data-zm]")) setZoom(st.zoom - ZOOM.step);
      else if (e.target.closest("[data-zp]")) setZoom(st.zoom + ZOOM.step);
      else if (e.target.closest("[data-z100]")) { setZoom(100); m.querySelector("input").focus(); }
    });
    setZoom(st.zoom);
    m.querySelector("input").focus();
  }
  /** 面と表の境目: 引いて幅（上に置いたときは高さ）を変える。選んで矢印でも・2 回押すと既定 */
  function setSize(px) {
    if (st.place === "top") st.height = Math.max(SIZE.minH, Math.min(SIZE.maxH, Math.round(px)));
    else st.width = Math.max(SIZE.minW, Math.min(SIZE.maxW, Math.round(px)));
    save(); paintSize();
  }
  function bindEdge() {
    const pane = $("#llSlicer");
    let edge = $("#llSlicerEdge");
    if (!edge) {
      edge = document.createElement("div");
      edge.id = "llSlicerEdge"; edge.className = "sx-edge"; edge.tabIndex = 0; edge.hidden = true;
      edge.setAttribute("role", "separator"); edge.setAttribute("aria-label", "スライサーの大きさ");
      pane.after(edge);
    }
    let drag = null;
    edge.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); edge.setPointerCapture(e.pointerId);
      const r = pane.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      document.body.classList.add("sx-resizing"); edge.classList.add("is-dragging");
    });
    edge.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (st.place === "top") setSize(drag.h + (e.clientY - drag.y));
      else setSize(drag.w + (st.place === "right" ? drag.x - e.clientX : e.clientX - drag.x));
    });
    const end = () => { if (!drag) return; drag = null; document.body.classList.remove("sx-resizing"); edge.classList.remove("is-dragging"); };
    edge.addEventListener("pointerup", end); edge.addEventListener("pointercancel", end);
    edge.addEventListener("dblclick", () => setSize(st.place === "top" ? SIZE.height : SIZE.width));
    edge.addEventListener("keydown", (e) => {
      const top = st.place === "top", grow = top ? "ArrowDown" : st.place === "right" ? "ArrowLeft" : "ArrowRight",
        shrink = top ? "ArrowUp" : st.place === "right" ? "ArrowRight" : "ArrowLeft";
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      setSize((top ? st.height : st.width) + (e.key === grow ? SIZE.step : -SIZE.step));
    });
  }
  /** この表のスライサーの選択を全部外す（カードは残す）。引き直しは呼んだ側が行う */
  function clearAll() { cards().forEach((c) => { c.sel = []; delete c.from; delete c.to; }); save(); render(); }
  function clear(col) { const c = cardOf(col); if (!c || !isActive(c)) return; c.sel = []; delete c.from; delete c.to; save(); render(); host.onChange(); }
  function bind() {
    $("#llSlicerBtn").addEventListener("click", () => { setOpen(!isOpen()); render(); refresh(); });
    $("#llSlicerSum").addEventListener("click", (e) => { const b = e.target.closest("[data-clear]"); if (b) clear(b.dataset.clear); });
    const pane = $("#llSlicer");
    bindEdge();
    // カードの並べ替え: 見出しの ⋮⋮ をつかんで引く（左右に置いたときは上下・上に置いたときは左右）
    TPA.sortable(pane, { items: () => [...pane.querySelectorAll(".sx-card")], keyOf: (el) => el.dataset.col, handle: ".sx-grip",
      axis: () => (st.place === "top" ? "x" : "y"), onOrder: reorder });
    // 手で並べる値: 値の行の ⋮⋮ を引く（引いているカードの中だけで並べ替える）
    let vcard = null;
    pane.addEventListener("pointerdown", (e) => { vcard = e.target.closest(".sx-vgrip") ? e.target.closest(".sx-card") : null; }, true);
    TPA.sortable(pane, { items: () => (vcard ? [...vcard.querySelectorAll(".sx-v[data-v]:not([hidden])")] : []), keyOf: (el) => el.dataset.v, handle: ".sx-vgrip",
      axis: "y", onOrder: (keys) => vcard && reorderValues(vcard.dataset.col, keys) });
    bindTime(pane);
    pane.addEventListener("click", (e) => {
      const t = e.target, card = t.closest(".sx-card"), col = card && card.dataset.col;
      const place = t.closest("button[data-place]");   // 枠（#llBodyRow）も data-place を持つので、ボタンに限る
      if (place) { st.place = place.dataset.place; save(); render(); return; }
      if (t.closest("[data-close]")) { setOpen(false); render(); $("#llSlicerBtn").focus(); return; }
      if (t.closest("[data-zoom]")) { if (document.querySelector(".sx-zoompop")) closeZoom(); else openZoom(t.closest("[data-zoom]")); return; }
      if (t.closest("[data-menu]")) { if (document.querySelector(".sx-menu")) closeMenu(); else openMenu(t.closest("[data-menu]")); return; }
      if (t.closest("[data-all]")) { toggleAll(col); return; }
      if (t.closest("[data-show0]")) { setHide0(col, false); return; }
      if (t.closest("[data-order-clear]")) { setOrder(col, ""); $(`#llSlicer .sx-card[data-col="${CSS.escape(col)}"] [data-menu]`)?.focus(); return; }
      if (t.closest(".sx-vgrip")) return;                  // 引く所（押しても選ばない）
      if (t.closest("[data-tl-edit]")) { if (editing.has(col)) editing.delete(col); else editing.add(col); render(); if (editing.has(col)) $(`#llSlicer .tl-card[data-col="${CSS.escape(col)}"] [data-tl-from]`)?.focus(); return; }
      const bin = t.closest("[data-tl-bin]");
      if (bin) {
        const c = cardOf(col), i = +bin.dataset.tlBin, { bins } = timeBins(vals[col]), [lo, hi] = timeIdx(c, bins);
        // 押した柱だけ（それだけを選んでいれば全期間に戻す）。Shift は今の期間を押した柱まで広げる
        if (e.shiftKey && isActive(c)) setTime(col, Math.min(lo, i), Math.max(hi, i));
        else if (lo === i && hi === i) setTime(col, 0, bins.length - 1); else setTime(col, i, i);
        return;
      }
      if (t.closest(".sx-v")) { toggleValue(col, t.closest(".sx-v").dataset.v); return; }
      if (t.closest("[data-clr]")) { clear(col); return; }
      if (t.closest("[data-rm]")) { const had = isActive(cardOf(col)); setCards(cards().filter((c) => c.column !== col)); delete vals[col]; editing.delete(col); render(); if (had) host.onChange(); }
    });
    pane.addEventListener("change", (e) => {
      const d = e.target.closest("[data-tl-from],[data-tl-to]");
      if (d) {   // 日付で決める（空は限らない。逆なら入れ替える）
        const card = d.closest(".tl-card"), c = cardOf(card.dataset.col); if (!c) return;
        let from = card.querySelector("[data-tl-from]").value, to = card.querySelector("[data-tl-to]").value;
        if (from && to && from > to) [from, to] = [to, from];
        if (from) c.from = from; else delete c.from;
        if (to) c.to = to; else delete c.to;
        save(); render(); host.onChange();
        return;
      }
      if (e.target.id !== "llSlicerAdd" || !e.target.value) return;
      const col = e.target.value, time = (e.target.selectedOptions[0] || {}).dataset?.kind === "time";
      setCards(cards().concat(time ? { column: col, kind: "time", sel: [] } : { column: col, key: isCalc(col) ? "" : host.keyOf(col), sel: [] }));
      render(); refresh();
    });
    // 手で並べる値: Alt＋↑↓ で 1 つ動かす
    pane.addEventListener("keydown", (e) => {
      const b = e.target.closest(".sx-v[data-v]"); if (!b || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const card = b.closest(".sx-card"), c = cardOf(card.dataset.col); if (!c || c.order !== "manual") return;
      e.preventDefault();
      const keys = [...card.querySelectorAll(".sx-v[data-v]:not([hidden])")].map((x) => x.dataset.v), i = keys.indexOf(b.dataset.v), j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (j < 0 || j >= keys.length) return;
      keys.splice(j, 0, keys.splice(i, 1)[0]);
      reorderValues(card.dataset.col, keys);
      $("#llSlicer").querySelector(`.sx-card[data-col="${CSS.escape(card.dataset.col)}"] .sx-v[data-v="${CSS.escape(b.dataset.v)}"]`)?.focus();
    });
    // 値を探す（変換中は絞らない）。描き直しても字は残す
    pane.addEventListener("input", (e) => {
      const inp = e.target.closest(".sx-q"); if (!inp || TPA.composing(e)) return;
      filterValues(inp);
    });
    pane.addEventListener("compositionend", (e) => { const inp = e.target.closest(".sx-q"); if (inp) filterValues(inp); });
  }
  /** 値を探す: 字に合う値だけを出す（0 件を隠した値は隠したまま）。（すべて）の数も、見えている値で数え直す */
  function filterValues(inp) {
    const card = inp.closest(".sx-card"), col = card.dataset.col;
    qs[col] = inp.value;
    const q = inp.value.trim().toLowerCase();
    card.querySelectorAll(".sx-v:not([data-all])").forEach((b) => { b.hidden = b.hasAttribute("data-zero-hidden") || (!!q && !b.textContent.toLowerCase().includes(q)); });
    const c = cardOf(col), all = card.querySelector("[data-all]");
    if (!c || !all || c.one) return;
    const vs = seen(c), sel = new Set(c.sel), n = vs.filter((x) => sel.has(x.value)).length;
    all.querySelector(":scope > i").textContent = `${n} / ${vs.length}`;
    all.querySelector(".sx-mk").className = `sx-mk${n && n === vs.length ? " is-on" : n ? " is-half" : ""}`;
    all.querySelector("span").lastChild.textContent = q ? "（合う値をすべて）" : "（すべて）";
  }

  function mount(h) { host = h; bind(); render(); }
  /** 一覧の元が替わった: 前の元の値・探した字を捨てて描き直す（値は次の refresh で読む） */
  function reset() { seq++; Object.keys(vals).forEach((k) => delete vals[k]); Object.keys(qs).forEach((k) => delete qs[k]); if (host) render(); }
  /** 範囲 t のカードの並び（選び方・0 件を隠すを含む）と、その置き換え。
      共有の書式（lotlist-formats.js）は選んだ値を運ばない（既定）。保存した見方（lotlist.js）は選んだ値ごと運ぶ（{ sel: true }） */
  const setupOf = (t, { sel = false } = {}) => (st.tables[t] || []).map((c) => (isTime(c)
    ? { column: c.column, kind: "time", ...(sel && c.from ? { from: c.from } : {}), ...(sel && c.to ? { to: c.to } : {}) }
    : { column: c.column, ...(c.key ? { key: c.key } : {}), ...(sel && c.sel.length ? { sel: c.sel.slice() } : {}), ...(c.one ? { one: true } : {}), ...(c.hide0 ? { hide0: true } : {}),
      ...(c.order ? { order: c.order } : {}), ...(c.order === "manual" && Array.isArray(c.manual) ? { manual: c.manual.slice() } : {}) }));
  function setSetup(t, list, { sel = false } = {}) {
    const day = (v) => (typeof v === "string" && DAY.test(v) ? { ok: v } : null);
    const cs = (Array.isArray(list) ? list : []).filter((c) => c && typeof c.column === "string" && c.column)
      .map((c) => (c.kind === "time"
        ? { column: c.column, kind: "time", sel: [], ...(sel && day(c.from) ? { from: c.from } : {}), ...(sel && day(c.to) ? { to: c.to } : {}) }
        : { column: c.column, key: String(c.key || ""), sel: sel && Array.isArray(c.sel) ? c.sel.map(String).slice(0, c.one ? 1 : undefined) : [],
          ...(c.one ? { one: true } : {}), ...(c.hide0 ? { hide0: true } : {}),
          ...(ORDERS.some((o) => o[0] && o[0] === c.order) ? { order: c.order } : {}),
          ...(c.order === "manual" && Array.isArray(c.manual) ? { manual: c.manual.map(String).slice(0, MAX_MANUAL) } : {}) }));
    if (cs.length) st.tables[t] = cs; else delete st.tables[t];
    save();
    if (host && host.table() === t) render();
  }
  /** 選んでいる値の要約 [[列の表示名, 値・値…]]（Excel に出力の「出力の条件」） */
  const summary = () => cards().filter((c) => isActive(c) && isShown(c))
    .map((c) => (isTime(c) ? [host.label(c.column) + "（期間）", timeText(c)] : [host.label(c.column) + (isCalc(c.column) ? "（式）" : ""), c.sel.map((v) => (v === "" ? BLANK : v)).join("・")]));
  /** 保存した見方（lotlist.js）: いまの画面でスライサーを開いているか・開く／閉じる */
  const openState = () => isOpen();
  function setOpenState(v) { if (!host) return; setOpen(!!v); render(); refresh(); }
  window.LotListSlicer = { mount, refresh, filters, render, clearAll, reset, setupOf, setSetup, summary, isOpen: openState, setOpen: setOpenState };
})();
