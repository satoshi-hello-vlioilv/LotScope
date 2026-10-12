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
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const KEY = "tpa.lotlist.slicer.v1";
  const PLACES = [["left", "左"], ["right", "右"], ["top", "上"]];
  const SEARCH_FROM = 6;        // 値がこの数以上なら「値を探す」の欄を出す（数個なら探すまでもない）
  const BLANK = "（空欄）";
  let host = null, seq = 0;
  const vals = {};              // 列 → { key, values: [{value, count, all}], truncated, tuples?: Map(値 → [元の列の値の組]), uses?: [元の列] }（直近の答え）
  const MAX_TUPLES = 1000;      // 計算列で選べる値の組の数（サーバーの MAX_IN_VALUES と同じ）
  const sent = {};              // 計算列 → 一覧へ渡した組（JSON）。読み直した組と違えば（まだ読めていない・ほかの絞り込みで組が変わった）一覧を引き直す
  const qs = {};                // 列 → 「値を探す」に打った字（描き直しても残す）

  /* ---- 覚え: {open: {画面: 開いているか}, place, tables: {表: [{column, key, sel: [...]}]}} ----
     開閉は画面ごと（版 3.20.0 まで全体で 1 つ。前の覚えは、どの画面にも引き継ぐ） */
  const load = () => {
    const s = TPA.local.get(KEY, {}), o = s.open;
    return { open: o && typeof o === "object" ? o : { all: !!o }, place: PLACES.some((p) => p[0] === s.place) ? s.place : "left", tables: s.tables || {} };
  };
  let st = load();
  const save = () => TPA.local.set(KEY, st);
  const isOpen = () => !!(host && (host.screen() in st.open ? st.open[host.screen()] : st.open.all));
  const setOpen = (v) => { st.open[host.screen()] = !!v; save(); };
  const cards = () => (st.tables[host.table()] || []);
  const setCards = (list) => { const t = host.table(); if (list.length) st.tables[t] = list; else delete st.tables[t]; save(); };
  const cardOf = (col) => cards().find((c) => c.column === col);

  /** 一覧へ渡す絞り込み（選んでいるカードだけ。except の列は除く＝その列自身の件数を数えるとき） */
  const isCalc = (col) => host.calcColumns().includes(col);
  const known = (col) => { const cs = host.columns(); return !cs.length || cs.includes(col) || isCalc(col); };
  function filters(except = null) {
    // 列がまだ分からない（開いた直後）ときも渡す。無い列はサーバーが外す（safe_filters）
    return cards().filter((c) => c.sel.length && c.column !== except && known(c.column)).flatMap((c) => {
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
  const active = () => cards().filter((c) => c.sel.length).length;

  /* ---- 値を読む（カードごとに、自分の選択を除いた絞り込みで） ---- */
  async function refresh() {
    if (!host) return;
    paintEntry(); paintSum();
    if (!isOpen()) return;
    const my = ++seq, list = cards().filter((c) => host.columns().includes(c.column) || isCalc(c.column));
    // 書式が変わって鍵が変わった列は、前の鍵で選んだ値が当たらないので選び直してもらう
    let changed = false;
    list.forEach((c) => { const k = isCalc(c.column) ? "" : host.keyOf(c.column); if ((c.key || "") !== k) { c.key = k; if (c.sel.length) { c.sel = []; changed = true; } } });
    if (changed) { save(); host.onChange(); return; }
    await Promise.all(list.map(async (c) => {
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
  function render() {
    const pane = $("#llSlicer"), row = $("#llBodyRow");
    pane.hidden = !isOpen();
    row.dataset.place = st.place;
    paintEntry(); paintSum();
    if (!isOpen()) return;
    const used = new Set(cards().map((c) => c.column));
    const addable = host.columns().concat(host.calcColumns()).filter((c) => !used.has(c));
    const head = `<div class="sx-head"><b>スライサー</b>
      <span class="sx-place" role="radiogroup" aria-label="置き場">${PLACES.map(([k, n]) => `<button type="button" role="radio" data-place="${k}" aria-checked="${st.place === k}" title="スライサーを表の${n}に置きます">${n}</button>`).join("")}</span>
      <button type="button" class="sx-close" data-close title="スライサーを閉じます（選んだ値はそのまま効きます）" aria-label="閉じる">×</button></div>`;
    const body = cards().filter((c) => host.columns().includes(c.column) || isCalc(c.column)).map(cardHtml).join("")
      || '<p class="sx-empty">列を足すと、その列の値（重複なし）と件数が並びます。押した値の行だけが一覧に出ます。</p>';
    const add = `<select id="llSlicerAdd" class="sx-add" aria-label="スライサーに列を足す"><option value="">＋ 列を足す…</option>${addable.map((c) => `<option value="${esc(c)}">${esc(host.label(c))}${isCalc(c) ? "（式）" : ""}</option>`).join("")}</select>`;
    pane.innerHTML = head + `<div class="sx-cards">${body}${add}</div>`;
    pane.querySelectorAll(".sx-q").forEach((inp) => { const q = qs[inp.closest(".sx-card").dataset.col]; if (q) { inp.value = q; filterValues(inp); } });
  }
  function cardHtml(c) {
    const v = vals[c.column], sel = new Set(c.sel);
    const list = v ? v.values : [];
    const max = Math.max(1, ...list.map((x) => x.count));
    const search = list.length >= SEARCH_FROM ? `<input class="sx-q" type="search" placeholder="値を探す" aria-label="「${esc(host.label(c.column))}」の値を探す" autocomplete="off">` : "";
    const items = !v ? '<p class="sx-wait">読み込み中…</p>' : list.map((x) => {
      const on = sel.has(x.value), label = x.value === "" ? BLANK : x.value;
      return `<button type="button" class="sx-v${on ? " is-on" : ""}${x.count ? "" : " is-zero"}" data-v="${esc(x.value)}" data-n="${x.count}" aria-pressed="${on}"`
        + ` style="--w:${Math.round(x.count / max * 100)}%" title="${esc(label)}：${x.count} 件（絞り込みを外すと ${x.all} 件）"><span>${esc(label)}</span><i>${x.count}</i></button>`;
    }).join("") + (v.error ? `<p class="sx-more">${esc(v.error)}</p>` : "")
      + (v.truncated ? `<p class="sx-more">${v.combos ? "元の列の値の組が多いため、件数の多い組から並べています（件数の少ない値は出ないことがあります）" : `値が多いため、先頭の ${list.length} 通りだけを並べています`}</p>` : "")
      + (v.tuples && c.sel.reduce((n, x) => n + (v.tuples.get(x) || []).length, 0) > MAX_TUPLES ? `<p class="sx-more">選んだ値になる元の値の組が ${MAX_TUPLES} を超えたため、先頭の ${MAX_TUPLES} 組で絞っています</p>` : "");
    return `<section class="sx-card" data-col="${esc(c.column)}">
      <div class="sx-ch"><b title="${esc(c.column)}${isCalc(c.column) ? `（計算列。式が使う列: ${esc((host.sourcesOf(c.column) || []).join("・"))}）` : ""}">${esc(host.label(c.column))}${isCalc(c.column) ? '<small class="sx-calc">式</small>' : ""}</b>
        ${c.sel.length ? `<button type="button" class="sx-clr" data-clr title="この列の選択を外します">${c.sel.length} 選択 ×</button>` : ""}
        <button type="button" class="sx-rm" data-rm title="このスライサーを外します（選んだ値も外れます）">外す</button></div>
      ${search}<div class="sx-vals">${items}</div></section>`;
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
    const on = cards().filter((c) => c.sel.length && (host.columns().includes(c.column) || isCalc(c.column)));
    box.hidden = !on.length;
    box.innerHTML = on.map((c) => {
      const names = c.sel.map((v) => (v === "" ? BLANK : v));
      const text = names.length > 3 ? `${names.slice(0, 3).join("・")} ほか ${names.length - 3}` : names.join("・");
      return `<span class="sx-chip" title="${esc(host.label(c.column))}: ${esc(names.join("・"))}"><b>${esc(host.label(c.column))}:</b> ${esc(text)}`
        + `<button type="button" data-clear="${esc(c.column)}" aria-label="「${esc(host.label(c.column))}」のスライサーの選択を外す">×</button></span>`;
    }).join("");
  }

  /* ---- 操作 ---- */
  function toggleValue(col, v) {
    const c = cardOf(col); if (!c) return;
    c.sel = c.sel.includes(v) ? c.sel.filter((x) => x !== v) : c.sel.concat(v);
    save(); render(); host.onChange();
  }
  /** この表のスライサーの選択を全部外す（カードは残す）。引き直しは呼んだ側が行う */
  function clearAll() { cards().forEach((c) => { c.sel = []; }); save(); render(); }
  function clear(col) { const c = cardOf(col); if (!c || !c.sel.length) return; c.sel = []; save(); render(); host.onChange(); }
  function bind() {
    $("#llSlicerBtn").addEventListener("click", () => { setOpen(!isOpen()); render(); refresh(); });
    $("#llSlicerSum").addEventListener("click", (e) => { const b = e.target.closest("[data-clear]"); if (b) clear(b.dataset.clear); });
    const pane = $("#llSlicer");
    pane.addEventListener("click", (e) => {
      const t = e.target, card = t.closest(".sx-card"), col = card && card.dataset.col;
      const place = t.closest("button[data-place]");   // 枠（#llBodyRow）も data-place を持つので、ボタンに限る
      if (place) { st.place = place.dataset.place; save(); render(); return; }
      if (t.closest("[data-close]")) { setOpen(false); render(); $("#llSlicerBtn").focus(); return; }
      if (t.closest(".sx-v")) { toggleValue(col, t.closest(".sx-v").dataset.v); return; }
      if (t.closest("[data-clr]")) { clear(col); return; }
      if (t.closest("[data-rm]")) { const had = cardOf(col).sel.length; setCards(cards().filter((c) => c.column !== col)); delete vals[col]; render(); if (had) host.onChange(); }
    });
    pane.addEventListener("change", (e) => {
      if (e.target.id !== "llSlicerAdd" || !e.target.value) return;
      const col = e.target.value;
      setCards(cards().concat({ column: col, key: isCalc(col) ? "" : host.keyOf(col), sel: [] }));
      render(); refresh();
    });
    // 値を探す（変換中は絞らない）。描き直しても字は残す
    pane.addEventListener("input", (e) => {
      const inp = e.target.closest(".sx-q"); if (!inp || TPA.composing(e)) return;
      filterValues(inp);
    });
    pane.addEventListener("compositionend", (e) => { const inp = e.target.closest(".sx-q"); if (inp) filterValues(inp); });
  }
  function filterValues(inp) {
    qs[inp.closest(".sx-card").dataset.col] = inp.value;
    const q = inp.value.trim().toLowerCase();
    inp.closest(".sx-card").querySelectorAll(".sx-v").forEach((b) => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); });
  }

  function mount(h) { host = h; bind(); render(); }
  /** 一覧の元が替わった: 前の元の値・探した字を捨てて描き直す（値は次の refresh で読む） */
  function reset() { seq++; Object.keys(vals).forEach((k) => delete vals[k]); Object.keys(qs).forEach((k) => delete qs[k]); if (host) render(); }
  /** 範囲 t のカードの並びと、その置き換え。
      共有の書式（lotlist-formats.js）は選んだ値を運ばない（既定）。保存した見方（lotlist.js）は選んだ値ごと運ぶ（{ sel: true }） */
  const setupOf = (t, { sel = false } = {}) => (st.tables[t] || [])
    .map((c) => ({ column: c.column, ...(c.key ? { key: c.key } : {}), ...(sel && c.sel.length ? { sel: c.sel.slice() } : {}) }));
  function setSetup(t, list, { sel = false } = {}) {
    const cs = (Array.isArray(list) ? list : []).filter((c) => c && typeof c.column === "string" && c.column)
      .map((c) => ({ column: c.column, key: String(c.key || ""), sel: sel && Array.isArray(c.sel) ? c.sel.map(String) : [] }));
    if (cs.length) st.tables[t] = cs; else delete st.tables[t];
    save();
    if (host && host.table() === t) render();
  }
  /** 選んでいる値の要約 [[列の表示名, 値・値…]]（Excel に出力の「出力の条件」） */
  const summary = () => cards().filter((c) => c.sel.length && (host.columns().includes(c.column) || isCalc(c.column)))
    .map((c) => [host.label(c.column) + (isCalc(c.column) ? "（式）" : ""), c.sel.map((v) => (v === "" ? BLANK : v)).join("・")]);
  window.LotListSlicer = { mount, refresh, filters, render, clearAll, reset, setupOf, setSetup, summary };
})();
