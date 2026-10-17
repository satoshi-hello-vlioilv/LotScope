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
    (q.filters || []).forEach((f, i) => { const vs = inValues(f); out.push({ key: `f${i}`, text: `${f.column} ${vs.slice(0, 2).map((v) => v || "（空欄）").join("・")}${vs.length > 2 ? ` ほか ${vs.length - 2}` : ""}` }); });
    return out;
  }
  function drop(q, key) {
    const x = TPA.clone(q || {});
    if (key === "equips") x.equips = [];
    else if (key === "period") x.period = null;
    else if (/^f\d+$/.test(key)) x.filters.splice(+key.slice(1), 1);
    return x;
  }
  const inValues = (f) => { try { const v = JSON.parse(f.value || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };

  /* ---- 候補（サーバーで数える） ---- */
  async function ask(panel) {
    const r = await fetch("/api/dashboard/query", TPA.json("POST", { panel }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `読めませんでした（${r.status}）`);
    return d;
  }
  /** その組みの列の値と件数 → [{value, label, n}]（多い順ではなく、決まった順＝日付・名前の順）。date … 日付の列（日ごと） */
  async function valuesOf(p, column, { date = false, without = -1, q = null } = {}) {
    const b = baseOf(p), own = (q && q.filters ? q.filters : []).filter((_, i) => i !== without);
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

  /* ---- 面 ---- */
  let el = null, off = null, st = null;
  function close() { if (off) off(); off = null; if (el) el.remove(); el = null; st = null; }
  /** 開く。h = {anchor, panel, quick, sources, canMove, onChange(quick), onMove()} */
  async function open(h) {
    close();
    st = { ...h, q: TPA.clone(h.quick || { filters: [], equips: [], period: null }), equipItems: null, fields: null, col: "", vals: null, search: "", esearch: "", err: "" };
    st.q.filters = st.q.filters || []; st.q.equips = st.q.equips || [];
    el = document.createElement("div");
    el.className = "db-pop df-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "このパネルを絞る");
    document.body.append(el);
    paint();
    TPA.placeBelow(el, h.anchor);
    off = TPA.dismissable(el, close, { keep: { contains: (t) => !!(t && t.closest && (t === h.anchor || t.closest("[data-db-filter]"))) } });
    el.addEventListener("click", onClick); el.addEventListener("change", onChange); el.addEventListener("input", onInput);
    const src = (h.sources || []).find((x) => x.key === baseOf(h.panel).source) || {};
    st.hasEquip = h.panel.visual === "board" ? (h.panel.rows || {}).column !== "@equip" ? false : true : !!src.equip;
    try {
      const [eq, f] = await Promise.all([st.hasEquip ? (h.boardKeys ? Promise.resolve(h.boardKeys.map((k) => ({ value: k, label: k, n: null }))) : equipsOf(h.panel)) : Promise.resolve(null), fieldsOf(h.panel)]);
      if (!st) return;
      st.equipItems = eq; st.fields = f;
    } catch (e) { if (st) st.err = String(e.message || e); }
    if (st) { paint(); TPA.placeBelow(el, h.anchor); }
  }
  const emit = () => { clearTimeout(emit.t); const q = TPA.clone(st.q); emit.t = setTimeout(() => st && st.onChange(q), 200); };
  function paint() {
    if (!el || !st) return;
    const q = st.q, p = st.panel, dates = ((st.fields && st.fields.fields) || []).filter((f) => f.date && !f.error);
    const cols = ((st.fields && st.fields.fields) || []).filter((f) => !f.error);
    const work = baseOf(p).source === "work";
    const periodCols = [...(work ? [["@workday", "作業日"]] : []), ...dates.map((f) => [f.column, f.column])];
    const pr = q.period || {};
    const sec = (title, body, hint = "") => `<section class="df-sec"><h4>${title}${hint ? `<small>${hint}</small>` : ""}</h4>${body}</section>`;
    let html = `<div class="db-pophead"><b>このパネルを絞る</b><small>この PC の見え方だけです。組んだ条件に足して効きます（共通のダッシュボードは変わりません）</small></div>`;
    if (st.err) html += `<p class="db-poperr">${esc(st.err)}</p>`;
    if (st.hasEquip) html += sec("設備", st.equipItems ? checklistHtml(st.equipItems, new Set(q.equips), { name: "eq", all: "すべての設備" }) : '<p class="df-none">設備を数えています…</p>', "複数選べます");
    if (p.visual !== "board" && periodCols.length) {
      html += sec("期間", `<div class="df-row"><select data-df-pkind aria-label="期間">${PERIODS.map(([k, n]) => `<option value="${k}"${(pr.kind || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
        + (pr.kind === "days" ? `<input type="number" min="1" max="3660" value="${pr.n || 7}" data-df-pn aria-label="日の数" class="de-n">日` : "")
        + (pr.kind ? `<select data-df-pcol aria-label="期間で絞る日付">${periodCols.map(([c, n]) => `<option value="${esc(c)}"${c === pr.column ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>` : "") + "</div>");
    }
    const had = q.filters.map((f, i) => `<span class="df-chip"><b>${esc(f.column)}</b>${esc(inValues(f).slice(0, 3).map((v) => v || "（空欄）").join("・"))}${inValues(f).length > 3 ? ` ほか ${inValues(f).length - 3}` : ""}<button type="button" data-df-fdel="${i}" aria-label="「${esc(f.column)}」の絞り込みを外す">×</button></span>`).join("");
    const pick = `<div class="df-row"><select data-df-col aria-label="値で絞る列"><option value="">列を選ぶ…</option>${cols.map((f) => `<option value="${esc(f.column)}"${f.column === st.col ? " selected" : ""}>${esc(f.column)}${f.calc ? "（式）" : ""}</option>`).join("")}</select>`
      + (st.col ? `<input type="search" data-df-search value="${esc(st.search)}" placeholder="値を検索" aria-label="値を検索">` : "") + "</div>";
    const cur = st.col ? q.filters.findIndex((f) => f.column === st.col) : -1;
    const vals = st.col ? (st.vals ? checklistHtml(st.vals, new Set(cur >= 0 ? inValues(q.filters[cur]) : []), { name: "val", search: st.search, all: "すべての値" }) : '<p class="df-none">値を数えています…</p>') : "";
    html += sec("値で絞る", (had ? `<div class="df-chips">${had}</div>` : "") + (st.fields ? pick + vals : '<p class="df-none">カラムを読んでいます…</p>'), "列を選び、出す値にチェック");
    html += `<div class="db-popacts"><button type="button" class="pv-btn" data-df-clear${isEmpty(q) ? " disabled" : ""}>すべて外す</button><span class="db-sp"></span>`
      + (st.canMove ? `<button type="button" class="pv-btn" data-df-move${isEmpty(q) ? " disabled" : ""} title="この絞り込みを、組む所の条件（保存すると全員に効く）へ移します">パネルの条件にする</button>` : "")
      + `<button type="button" class="btn-primary" data-df-close>閉じる</button></div>`;
    const keep = el.querySelector("[data-df-search]") === document.activeElement;
    el.innerHTML = html;
    if (keep) { const s = el.querySelector("[data-df-search]"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  async function loadValues() {
    const col = st.col, f = (st.fields.fields || []).find((x) => x.column === col) || {};
    st.vals = null; paint();
    const cur = st.q.filters.findIndex((x) => x.column === col);
    try {
      const vals = await valuesOf(st.panel, col, { date: !!f.date, without: cur, q: st.q });
      if (st && st.col === col) { st.vals = vals; st.date = !!f.date; paint(); }
    } catch (e) { if (st) { st.err = String(e.message || e); paint(); } }
  }
  function setValues(col, list) {
    const i = st.q.filters.findIndex((f) => f.column === col);
    if (!list.length) { if (i >= 0) st.q.filters.splice(i, 1); }
    else {
      const f = { column: col, op: "in", value: JSON.stringify(list), ...(st.date ? { key: "date" } : {}) };
      if (i >= 0) st.q.filters[i] = f; else st.q.filters.push(f);
    }
    emit(); paint();
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-df-close")) { close(); return; }
    if (b.hasAttribute("data-df-clear")) { st.q = { filters: [], equips: [], period: null }; emit(); paint(); return; }
    if (b.hasAttribute("data-df-move")) { const h = st; close(); h.onMove(); return; }
    if (b.dataset.dfFdel != null) { st.q.filters.splice(+b.dataset.dfFdel, 1); if (st.col) loadValues(); emit(); paint(); return; }
    if (b.hasAttribute("data-ck-eq-clear")) { st.q.equips = []; emit(); paint(); return; }
    if (b.hasAttribute("data-ck-val-clear")) { setValues(st.col, []); }
  }
  function onChange(e) {
    const x = e.target;
    if (x.matches("[data-ck-eq-all]")) { st.q.equips = []; emit(); paint(); return; }
    if (x.dataset.ckEq != null) {
      const set = new Set(st.q.equips); if (x.checked) set.add(x.dataset.ckEq); else set.delete(x.dataset.ckEq);
      st.q.equips = st.equipItems.map((i) => i.value).filter((v) => set.has(v)); emit(); paint(); return;
    }
    if (x.matches("[data-ck-val-all]")) { setValues(st.col, []); return; }
    if (x.dataset.ckVal != null) {
      const i = st.q.filters.findIndex((f) => f.column === st.col), set = new Set(i >= 0 ? inValues(st.q.filters[i]) : []);
      if (x.checked) set.add(x.dataset.ckVal); else set.delete(x.dataset.ckVal);
      setValues(st.col, st.vals.map((v) => v.value).filter((v) => set.has(v))); return;
    }
    if (x.matches("[data-df-col]")) { st.col = x.value; st.search = ""; if (st.col) loadValues(); else paint(); return; }
    if (x.matches("[data-df-pkind]")) {
      const work = baseOf(st.panel).source === "work", first = ((st.fields && st.fields.fields) || []).find((f) => f.date);
      st.q.period = x.value ? { column: (st.q.period && st.q.period.column) || (work ? "@workday" : first ? first.column : ""), kind: x.value, n: (st.q.period && st.q.period.n) || 7 } : null;
      emit(); paint(); return;
    }
    if (x.matches("[data-df-pcol]")) { st.q.period.column = x.value; emit(); return; }
    if (x.matches("[data-df-pn]")) { st.q.period.n = Math.max(1, Math.min(3660, +x.value || 7)); emit(); }
  }
  function onInput(e) { if (e.target.matches("[data-df-search]")) { st.search = e.target.value; paint(); } }

  window.DashFilter = { open, close, merge, slice, sliceHits, chips, drop, isEmpty, checklistHtml, equipsOf, valuesOf, isOpen: () => !!el };
})();
