/* =========================================================================
   パネルを絞る（版 3.39.0。利用者の要望 1・2: パネル単位で絞る・設備を複数選ぶ）
   - 見ているときに、パネルの見出しの「絞る」から開く面。設備（複数）・期間・値（列の値をチェックで選ぶ）で、そのパネルだけを絞る
   - 絞り込みは、この PC の見え方（dashboard.js が覚える）。組んだ条件（組む所の「条件」）に足して効く。共通のダッシュボードは変わらない
     （編集のときは「パネルの条件にする」で組んだ条件へ移せる＝保存すると全員に効く）
   - 値の候補は、そのパネルの組み（データ・組んだ条件・期間）に当たる行の値と件数（サーバーの集計 /api/dashboard/query で数える。
     値を打たせない＝思い出させない）。日付の列は日ごと
   - 設備の選び（チェックの並び checklistHtml）は、組む所の「設備」でも同じ部品を使う
   ========================================================================= */
(function () {
  "use strict";
  const { esc } = TPA;
  const PERIODS = [["", "組んだ期間のまま"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 n 日"], ["this_month", "今月"], ["last_month", "先月"]];
  const MAX_SHOW = 300;

  /** 数える元（合わせた表は 1 つ目のまとまり） */
  const baseOf = (p) => (p.visual === "board" ? { ...((p.groups || [])[0] || {}), equips: p.equips } : p);
  const isEmpty = (q) => !q || (!(q.filters || []).length && !(q.equips || []).length && !(q.period && q.period.kind));
  /** 組んだパネル＋この PC の絞り込み → 数えるときのパネル */
  function merge(p, q) {
    if (isEmpty(q)) return p;
    const x = TPA.clone(p);
    if ((q.equips || []).length) x.equips = q.equips.slice();
    x.filters = (x.filters || []).concat(q.filters || []);
    if (x.visual !== "board" && q.period && q.period.kind) x.period = { column: q.period.column, kind: q.period.kind, n: q.period.n || 7 };
    return x;
  }
  /** ダッシュボードのスライサー（版 3.41.0。利用者の要望 6）をパネルに当てる → 数えるときのパネル（当たらなければ p のまま）。
      sl = {period: {kind, n}, equips: [設備名]}。期間は、期間を組んだパネル（合わせた表・合わせたデータは、期間を組んだまとまり・データ）だけに効く
      （仕掛のように「いま」を数えるパネルは変えない）。設備は、設備を見分けられるデータのパネルに効き、パネルが設備を選んでいれば重なる設備だけ。
      パネルの「スライサーに従わない」（noslice）なら当てない */
  function slice(p, sl, canEquip) {
    const hit = sliceHits(p, sl, canEquip);
    if (!hit.period && !hit.equip) return p;
    const x = TPA.clone(p), per = sl.period;
    const setPer = (o) => { if (hit.period && o && o.period && o.period.kind) o.period = { column: o.period.column, kind: per.kind, n: per.n || 7 }; };
    // 設備はスライサーで「絞る」だけ（パネルが設備を選んでいなければ、選んだ設備の計。設備ごとに分けるのはパネルの組みで決める）
    const setEq = (o) => { if (!hit.equip) return; const own = o.equips || []; if (!own.length && !o.esplit && !o.egroup && o !== x.link) o.esplit = "sum"; o.equips = own.length ? own.filter((e) => sl.equips.includes(e)) : sl.equips.slice(); if (!o.equips.length) o.equips = ["（スライサーの設備に当たりません）"]; };
    if (x.visual === "board") { (x.groups || []).forEach(setPer); setEq(x); }
    else if (x.link) (x.link.sides || []).forEach((sd) => { setPer(sd); if (canEquip(sd.source)) setEq(sd); });
    else { setPer(x); setEq(x); }
    return x;
  }
  /** スライサーがそのパネルに効くか → {period, equip} */
  function sliceHits(p, sl, canEquip) {
    const out = { period: false, equip: false };
    if (!sl || p.noslice) return out;
    const per = !!(sl.period && sl.period.kind), eq = (sl.equips || []).length > 0;
    const parts = p.visual === "board" ? p.groups || [] : p.link ? p.link.sides || [] : [p];
    out.period = per && parts.some((o) => o.period && o.period.kind);
    out.equip = eq && (p.visual === "board" ? ((p.rows || {}).column || "@equip") === "@equip" : parts.some((o) => canEquip(o.source)));
    return out;
  }
  /** 絞り込みの短い字（見出しの下の札） → [{key, text}]（key で 1 つずつ外す） */
  function chips(q) {
    if (isEmpty(q)) return [];
    const out = [];
    if ((q.equips || []).length) out.push({ key: "equips", text: `設備 ${q.equips.slice(0, 3).join("・")}${q.equips.length > 3 ? ` ほか ${q.equips.length - 3}` : ""}` });
    if (q.period && q.period.kind) out.push({ key: "period", text: `期間 ${q.period.kind === "days" ? `直近 ${q.period.n || 7} 日` : (PERIODS.find((x) => x[0] === q.period.kind) || ["", ""])[1]}` });
    byColumn(q.filters).forEach(([col, fs]) => out.push({ key: `c:${col}`, text: colText(col, fs) }));
    return out;
  }
  function drop(q, key) {
    const x = TPA.clone(q || {});
    if (key === "equips") x.equips = [];
    else if (key === "period") x.period = null;
    else if (key.startsWith("c:")) x.filters = (x.filters || []).filter((f) => f.column !== key.slice(2));
    else if (/^f\d+$/.test(key)) x.filters.splice(+key.slice(1), 1);
    return x;
  }
  /** 条件を列ごとにまとめる → [[列, [条件]]]（並びは最初に出た順） */
  function byColumn(filters) {
    const m = new Map();
    (filters || []).forEach((f) => { if (!m.has(f.column)) m.set(f.column, []); m.get(f.column).push(f); });
    return [...m];
  }
  /** 列の条件の短い字（値の選び「A1100・A3004 ほか 1」と条件「含む ab」を「・」で） */
  const colText = (col, fs) => `${col} ${fs.map((f) => (f.op === "in" ? TPA.inText(f) : TPA.condLabel({ ...f, column: "" }).trim())).join("・")}`;
  const inValues = (f) => { try { const v = JSON.parse(f.value || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };

  /* ---- 候補（サーバーで数える） ---- */
  async function ask(panel) {
    const r = await fetch("/api/dashboard/query", TPA.json("POST", { panel }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `読めませんでした（${r.status}）`);
    return d;
  }
  /** その組みの列の値と件数 → [{value, label, n}]（多い順ではなく、決まった順＝日付・名前の順）。date … 日付の列（日ごと） */
  async function valuesOf(p, column, { date = false, without = -1, except = "", q = null } = {}) {
    const b = baseOf(p), own = (q && q.filters ? q.filters : []).filter((f, i) => i !== without && (!except || f.column !== except));
    const panel = { visual: "none", source: b.source, equip: b.equip || "", equips: (q && (q.equips || []).length ? q.equips : b.equips) || [], calc: b.calc, search: b.search || "",
      filters: (b.filters || []).concat(own), period: b.period || null, basis: b.basis || "work",
      body: { rows: [{ column, part: date ? "date" : "" }], cols: [], measures: [{ agg: "count" }], grand: false } };
    const d = await ask(panel);
    const lab = d.labels[0] || {}, cnt = new Map(d.cells.filter((x) => x.r.length === 1).map((x) => [x.r[0], x.v[0]]));
    return (d.orders[0] || []).map((k) => ({ value: k === "" ? "" : date ? k : k[0] === "$" ? k.slice(1) : String(lab[k] ?? k), label: String(lab[k] ?? k), n: cnt.get(k) || 0 }));
  }
  /** その組みの設備と件数 → [{value, label, n}] */
  async function equipsOf(p) {
    const b = baseOf(p);
    const d = await ask({ visual: "none", source: b.source, equip: b.equip || "", calc: b.calc, filters: b.filters || [], period: b.period || null, basis: b.basis || "work",
      body: { rows: [{ column: "@equip" }], cols: [], measures: [{ agg: "count" }], grand: false } });
    const lab = d.labels[0] || {}, cnt = new Map(d.cells.filter((x) => x.r.length === 1).map((x) => [x.r[0], x.v[0]]));
    return (d.orders[0] || []).filter((k) => k !== "").map((k) => ({ value: String(lab[k] ?? k), label: String(lab[k] ?? k), n: cnt.get(k) || 0 }));
  }
  async function fieldsOf(p) {
    const b = baseOf(p);
    const r = await fetch("/api/dashboard/fields", TPA.json("POST", { source: b.source, equip: b.equip || "", calc: b.calc || null }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "カラムを読めませんでした");
    return d;
  }

  /** チェックの並び（設備・値）。items: [{value, label, n}]・picked: 選んだ値の Set。name … data 属性の名前（押すと data-ck-<name>）。
      全部を選んでいない（空）＝すべて。並びは 2〜3 列の格子（数が多いと検索で絞る） */
  function checklistHtml(items, picked, { name = "v", search = "", all = "すべて", unit = "件" } = {}) {
    const ql = search.trim().toLowerCase(), shown = items.filter((x) => !ql || x.label.toLowerCase().includes(ql)).slice(0, MAX_SHOW);
    const none = !picked.size;
    return `<div class="df-ck" role="group"><label class="df-all${none ? " on" : ""}"><input type="checkbox" data-ck-${name}-all${none ? " checked" : ""}>${esc(all)}</label>`
      + (picked.size ? `<small class="df-n">${picked.size} を選んでいます</small><button type="button" class="df-link" data-ck-${name}-clear>選びを外す</button>` : "")
      + `</div><div class="df-grid">${shown.map((x) => `<label class="df-it${picked.has(x.value) ? " on" : ""}" title="${esc(x.label)}"><input type="checkbox" data-ck-${name}="${esc(x.value)}"${picked.has(x.value) ? " checked" : ""}><span>${esc(x.label || "（空欄）")}</span>${x.n != null ? `<small>${C.fmt(x.n)}${unit}</small>` : ""}</label>`).join("")
      || '<p class="df-none">当たる値がありません</p>'}</div>${items.length > shown.length ? `<small class="df-n">ほか ${items.length - shown.length}（検索で絞ってください）</small>` : ""}`;
  }
  const C = window.LotListPivotCharts;

  /* ---- 面 ----
     3 つのまとまり（設備・期間・値と条件）を畳める段にし、開くのは 1 つだけ（版 3.45.0。1280×720 で値のチェックが面の下に隠れた: 2026-10-colfilter の 1 回目）。
     畳んだ段の見出しには、いま選んでいる物の要約を出す（開かなくても何で絞っているかが見える）。
     設備と値は同じ「値で絞る」の部品（value-filter.js の埋め込み）で、同じ形・同じ言葉（（すべて選択）・件数の帯）。
     埋め込みの部品は、段を開いたとき・列を替えたときだけ作り直す（チェックのたびに作り直すと、値の読み直し・送り位置・打っている欄が失われる） */
  let el = null, off = null, st = null, vf = null, vfEq = null;
  function close() {
    if (off) off(); off = null;
    if (st && st.ro) st.ro.disconnect();
    [vf, vfEq].forEach((x) => x && x.destroy()); vf = vfEq = null;      // 待っている選びを渡してから
    if (st && emit.t) { clearTimeout(emit.t); emit.t = 0; st.onChange(TPA.clone(st.q)); }   // 閉じる前の最後の変更も効かせる（すぐ閉じると捨てていた）
    if (el) el.remove(); el = null; st = null;
  }
  /** 開く。h = {anchor, panel, quick, sources, canMove, onChange(quick), onMove(), boardKeys?} */
  async function open(h) {
    close();
    st = { ...h, q: TPA.clone(h.quick || { filters: [], equips: [], period: null }), equipItems: null, fields: null, col: "", err: "", sec: "" };
    st.q.filters = st.q.filters || []; st.q.equips = st.q.equips || [];
    el = document.createElement("div");
    el.className = "db-pop df-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "このパネルを絞る");
    el.innerHTML = '<div class="df-top"></div>'
      + '<section class="df-sec" data-sec="eq" hidden><button type="button" class="df-sech" data-df-sec="eq"></button><div class="df-secb"><div class="df-eqvf"></div></div></section>'
      + '<section class="df-sec" data-sec="per" hidden><button type="button" class="df-sech" data-df-sec="per"></button><div class="df-secb df-perb"></div></section>'
      + '<section class="df-sec" data-sec="val"><button type="button" class="df-sech" data-df-sec="val"></button><div class="df-secb"><div class="df-valtop"></div><div class="df-vf" hidden></div></div></section>'
      + '<div class="df-bottom"></div>';
    document.body.append(el);
    paint();
    place();
    // 中身の高さが変わったら（段を開く・値を読み終える）置き直す
    const ro = new ResizeObserver(() => { cancelAnimationFrame(place.raf); place.raf = requestAnimationFrame(place); });
    el.querySelectorAll(".df-top,.df-sec,.df-bottom").forEach((x) => ro.observe(x));
    st.ro = ro;
    off = TPA.dismissable(el, close, { keep: { contains: (t) => !!(t && t.closest && (t === h.anchor || t.closest("[data-db-filter]"))) } });
    el.addEventListener("click", onClick); el.addEventListener("change", onChange);
    const src = (h.sources || []).find((x) => x.key === baseOf(h.panel).source) || {};
    st.hasEquip = h.panel.visual === "board" ? (h.panel.rows || {}).column === "@equip" : !!src.equip;
    try {
      const [eq, f] = await Promise.all([st.hasEquip ? (h.boardKeys ? Promise.resolve(h.boardKeys.map((k) => ({ value: k, label: k, n: null }))) : equipsOf(h.panel)) : Promise.resolve(null), fieldsOf(h.panel)]);
      if (!st) return;
      st.equipItems = eq; st.fields = f;
      // 開く段: 値で絞っていればその列・設備を選んでいれば設備・どちらも無ければ値と条件（設備は見出しの要約で見える）
      const first = byColumn(st.q.filters)[0];
      openSec(first || !(st.q.equips || []).length ? "val" : "eq");
      if (first) pickCol(first[0]);
    } catch (e) { if (st) st.err = String(e.message || e); }
    if (st) { paint(); place(); }
  }
  /** 基準のボタンの下に置き、下に入りきらなければ上へずらす（見出しの下まで）。それでも入らなければ中を送る
      （1280×720 で、値と条件の段の下が下のボタンの行に隠れた: 2026-10-colfilter の作った後の採点） */
  function place() {
    if (!el || !st) return;
    el.style.maxHeight = ""; el.style.top = "";
    TPA.placeBelow(el, st.anchor);
    const floor = Math.round(document.querySelector("body > header")?.getBoundingClientRect().bottom || 0) + 8;
    const need = el.scrollHeight, top = el.getBoundingClientRect().top;
    if (need > innerHeight - top - 8) {
      const t = Math.max(floor, innerHeight - need - 8);
      el.style.top = `${t}px`; el.style.maxHeight = `${innerHeight - t - 8}px`;
    }
  }
  const emit = () => { clearTimeout(emit.t); const q = TPA.clone(st.q); emit.t = setTimeout(() => { emit.t = 0; if (st) st.onChange(q); }, 200); };
  const sel = (attr, opts, cur, label) => `<select class="df-sel" ${attr} aria-label="${esc(label)}">${opts.map(([k, n]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  const perText = (pr) => (pr && pr.kind ? (pr.kind === "days" ? `直近 ${pr.n || 7} 日` : (PERIODS.find((x) => x[0] === pr.kind) || ["", ""])[1]) : "組んだ期間のまま");
  /** 段の見出し（名前・要約・開閉の印） */
  const secHead = (name, sum, on, open) => `<i aria-hidden="true">${open ? "▾" : "▸"}</i><b>${name}</b><span class="df-sum${on ? " on" : ""}" title="${esc(sum)}">${esc(sum)}</span>`;
  function paint() {
    if (!el || !st) return;
    const q = st.q, p = st.panel, fl = (st.fields && st.fields.fields) || [], dates = fl.filter((f) => f.date && !f.error);
    const cols = fl.filter((f) => !f.error);
    const work = baseOf(p).source === "work";
    const periodCols = [...(work ? [["@workday", "作業日"]] : []), ...dates.map((f) => [f.column, f.column])];
    const pr = q.period || {}, groups = byColumn(q.filters);
    el.querySelector(".df-top").innerHTML = `<div class="db-pophead"><b>このパネルを絞る</b><small>この PC の見え方だけです。組んだ条件に足して効きます（共通のダッシュボードは変わりません）</small></div>`
      + (st.err ? `<p class="db-poperr">${esc(st.err)}</p>` : "");
    const secEl = (k) => el.querySelector(`[data-sec="${k}"]`);
    // 設備
    secEl("eq").hidden = !st.hasEquip;
    secEl("eq").querySelector(".df-sech").innerHTML = secHead("設備", q.equips.length ? VF().pickedText(q.equips, 3) : "すべての設備", q.equips.length > 0, st.sec === "eq");
    // 期間
    const perOk = p.visual !== "board" && periodCols.length > 0;
    secEl("per").hidden = !perOk;
    secEl("per").querySelector(".df-sech").innerHTML = secHead("期間", perText(pr), !!pr.kind, st.sec === "per");
    if (perOk) el.querySelector(".df-perb").innerHTML = `<div class="df-row">${sel("data-df-pkind", PERIODS, pr.kind || "", "期間")}`
      + (pr.kind === "days" ? `<input type="number" min="1" max="3660" value="${pr.n || 7}" data-df-pn aria-label="日の数" class="df-num">日` : "")
      + (pr.kind ? sel("data-df-pcol", periodCols, pr.column, "期間で絞る日付") : "") + "</div>";
    // 値と条件
    secEl("val").querySelector(".df-sech").innerHTML = secHead("値・条件", groups.length ? groups.map(([c, fs]) => colText(c, fs)).join("／") : "絞っていません", groups.length > 0, st.sec === "val");
    const had = groups.map(([col, fs]) => `<span class="df-chip${col === st.col ? " on" : ""}"><button type="button" class="df-chipb" data-df-fcol="${esc(col)}" title="この列の絞り込みを直す">`
      + `<b>${esc(col)}</b>${esc(colText(col, fs).slice(col.length + 1))}</button><button type="button" data-df-fdel="${esc(col)}" aria-label="「${esc(col)}」の絞り込みを外す" title="外す">×</button></span>`).join("");
    const pick = `<div class="df-row">${sel("data-df-col", [["", "列を選ぶ…"], ...cols.map((f) => [f.column, `${f.column}${f.calc ? "（式）" : ""}${q.filters.some((x) => x.column === f.column) ? "  ●" : ""}`])], st.col, "値・条件で絞る列")}</div>`;
    el.querySelector(".df-valtop").innerHTML = (had ? `<div class="df-chips">${had}</div>` : "") + (st.fields ? pick : '<p class="df-none">カラムを読んでいます…</p>');
    ["eq", "per", "val"].forEach((k) => { secEl(k).classList.toggle("is-open", st.sec === k); secEl(k).querySelector(".df-sech").setAttribute("aria-expanded", String(st.sec === k)); });
    el.querySelector(".df-bottom").innerHTML = `<div class="db-popacts"><button type="button" class="pv-btn" data-df-clear${isEmpty(q) ? " disabled" : ""}>すべて外す</button><span class="db-sp"></span>`
      + (st.canMove ? `<button type="button" class="pv-btn" data-df-move${isEmpty(q) ? " disabled" : ""} title="この絞り込みを、組む所の条件（保存すると全員に効く）へ移します">パネルの条件にする</button>` : "")
      + `<button type="button" class="btn-primary" data-df-close>閉じる</button></div>`;
  }
  const VF = () => window.ValueFilter;
  /** 段を開く（1 つだけ）。設備の段を初めて開くとき、設備の値で絞る部品を作る */
  function openSec(k) {
    st.sec = st.sec === k ? "" : k;
    if (st.sec === "eq" && !vfEq && st.equipItems) {
      vfEq = VF().mount(el.querySelector(".df-eqvf"), {
        column: "@equip", label: "設備", picked: st.q.equips.length ? st.q.equips.slice() : null, ops: [],
        load: async () => ({ values: st.equipItems.map((x) => ({ value: x.value, label: x.label, count: x.n })) }),
        onChange: (r) => { if (!st || st.clearing) return; st.q.equips = r.picked || []; emit(); paint(); },
      });
    }
    paint();
  }
  /** 値で絞る列を選ぶ（埋め込みの面を作り直す。空なら畳む） */
  function pickCol(col) {
    st.col = col;
    if (vf) { vf.destroy(); vf = null; }
    const box = el.querySelector(".df-vf");
    box.hidden = !col;
    if (!col) return;
    const f = ((st.fields && st.fields.fields) || []).find((x) => x.column === col) || {}, date = !!f.date;
    const cur = VF().fromFilters(col, st.q.filters);
    vf = VF().mount(box, {
      column: col, label: col, date, picked: cur.picked, conds: cur.conds,
      load: async () => ({ values: (await valuesOf(st.panel, col, { date, except: col, q: st.q })).map((x) => ({ value: x.value, label: x.label, count: x.n })) }),
      onChange: (r) => {
        if (!st || st.col !== col) return;
        st.q.filters = st.q.filters.filter((x) => x.column !== col).concat(VF().toFilters(col, r, date ? "date" : ""));
        emit(); paint();
      },
    });
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b || b.closest(".df-eqvf,.df-vf")) return;
    if (b.dataset.dfSec) { openSec(b.dataset.dfSec); return; }
    if (b.hasAttribute("data-df-close")) { close(); return; }
    if (b.hasAttribute("data-df-clear")) {
      st.clearing = true; pickCol(""); if (vfEq) vfEq.destroy(); st.clearing = false;      // 待っていた選びは捨てる（すべて外すが先）
      st.q = { filters: [], equips: [], period: null }; emit();
      if (vfEq) { vfEq = null; if (st.sec === "eq") { st.sec = ""; openSec("eq"); return; } }
      paint(); return;
    }
    if (b.hasAttribute("data-df-move")) { const h = st; close(); h.onMove(); return; }
    if (b.dataset.dfFcol != null) { pickCol(b.dataset.dfFcol); paint(); return; }
    if (b.dataset.dfFdel != null) { const c = b.dataset.dfFdel; st.q.filters = st.q.filters.filter((x) => x.column !== c); if (st.col === c) pickCol(c); emit(); paint(); }
  }
  function onChange(e) {
    const x = e.target; if (x.closest(".df-eqvf,.df-vf")) return;
    if (x.matches("[data-df-col]")) { pickCol(x.value); paint(); return; }
    if (x.matches("[data-df-pkind]")) {
      const work = baseOf(st.panel).source === "work", first = ((st.fields && st.fields.fields) || []).find((f) => f.date);
      st.q.period = x.value ? { column: (st.q.period && st.q.period.column) || (work ? "@workday" : first ? first.column : ""), kind: x.value, n: (st.q.period && st.q.period.n) || 7 } : null;
      emit(); paint(); return;
    }
    if (x.matches("[data-df-pcol]")) { st.q.period.column = x.value; emit(); return; }
    if (x.matches("[data-df-pn]")) { st.q.period.n = Math.max(1, Math.min(3660, +x.value || 7)); emit(); }
  }

  window.DashFilter = { open, close, merge, slice, sliceHits, chips, drop, isEmpty, checklistHtml, equipsOf, valuesOf, byColumn, colText, isOpen: () => !!el };
})();
