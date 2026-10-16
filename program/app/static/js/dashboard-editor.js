/* =========================================================================
   ダッシュボードのパネルを組む所（版 3.37.0。グリッドは dashboard.js・描き方は dashboard-panels.js）
   集計表・グラフ（lotlist-pivot.js）と同じ組み方: 左にカラムの札（行・列・値）、右に文「［行］ごとに、［列］別の［値］を出す」と形。
   変えるたびに、グリッドの中のそのパネルがすぐ描き直る（パネルの大きさのまま。プレビューを別に持たない）。
   ほかに: データ（データ元・作業実績の設備・作業日の数え方）・条件（一覧と同じ形）・期間（今日・前日・直近 n 日・今月・先月）・
   並べ方（大きい順・小さい順）と上位いくつ・題
   合わせた表（版 3.38.0。visual board）: 上の札で「表全体」（行の段・行の並び・隠す行）と「列のまとまり」（1〜4）を切り替える。
   まとまりは、ふつうのパネルと同じ部品（カラムの札・文・データ・条件・期間）で組み（行の段は表全体で 1 つ・値は 1 つ）、見せ方（棒・濃淡・数・色・
   計の列・0 の印）を選ぶ。組む物（target）は、ふつうのパネルならパネル、合わせた表ならまとまりを写した形（groupView）で、変えるたびに書き戻す
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const C = window.LotListPivotCharts, P = window.DashPanels;
  const MAX_DIMS = 3, MAX_MEASURES = 4, MAX_GROUPS = 4, MAX_GROUP_COLS = 2;
  const AGGS = [["sum", "合計"], ["avg", "平均"], ["min", "最小"], ["max", "最大"]];
  const DATE_PARTS = ["date", "ym", "year", "month", "weekday", "hour", ""], NUM_PARTS = ["", "bin"], WORKDAY_PARTS = ["", "ym", "year"];
  const PART_NAME = { "": "値のまま", date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const WORKDAY_NAME = { "": "日", ym: "年月", year: "年" };
  const EXTRA = [{ k: "kpi", n: "数字", tip: "値の総計を大きな数で出します（行の段は要りません）", icon: "M4 15V5l-2 2M8 6a2 2 0 1 1 4 0c0 2-4 4-4 9h4M14 5h4l-3 4a3 3 0 1 1-2 5" },
    { k: "none", n: "表", tip: "集計表（行・列・値）を、パネルの大きさに詰めて出します", icon: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12" },
    { k: "board", n: "合わせた表", tip: "行（設備など）をそろえて、いくつかのデータの数を横に並べた 1 枚の表（設備ごとの仕掛と前日の実績など）", icon: "M3 4h14v12H3zM3 8h14M7 4v12M12 4v12" }];
  const PERIODS = [["", "期間で絞らない"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 n 日（今日を含む）"], ["this_month", "今月"], ["last_month", "先月"]];
  const LOOKS = [["bar", "棒と数"], ["heat", "数と濃淡"], ["num", "数だけ"]];
  // まとまりの色（"" はデータの種類の色＝仕掛は藍・作業実績は青緑・品質データは琥珀。ほかは区分の色と同じ並び）
  const GROUP_COLORS = ["", "#7658ae", "#5c8a2a", "#8a5f18", "#5a6f77", "#8e4f76"];
  let host = null, p = null, t = null, gi = -1, sources = [], fields = null, fieldsKey = "", fieldsErr = "", q = "", ctx = { formulas: {}, names: {} };

  const isBoard = () => p && p.visual === "board";
  const inGroup = () => isBoard() && gi >= 0;
  /** 合わせた表のまとまり → 組む形（ふつうのパネルと同じ形。行の段は表全体の物・値は 1 つ） */
  function groupView(g) {
    return { visual: "none", source: g.source, equip: g.equip || "", filters: g.filters || [], search: g.search || "", period: g.period || null, basis: g.basis || "work",
      ...(g.calc ? { calc: g.calc } : {}), body: { rows: [p.rows], cols: g.cols || [], measures: [g.measure || { agg: "lots" }], grand: true } };
  }
  /** 組んだ形 → まとまりへ書き戻す */
  function pushGroup() {
    if (!inGroup()) return;
    const g = p.groups[gi];
    Object.assign(g, { source: t.source, equip: t.equip, filters: t.filters, search: t.search, period: t.period, basis: t.basis, cols: t.body.cols, measure: t.body.measures[0] || { agg: "lots" } });
    if (t.calc) g.calc = t.calc; else delete g.calc;
    delete p.legacy;              // 組み直した表は、前の版の条件を引き継がない
  }
  function select(i) {
    gi = isBoard() ? Math.max(-1, Math.min(i, p.groups.length - 1)) : -1;
    t = inGroup() ? groupView(p.groups[gi]) : p;
    q = "";
    paint(); if (t !== p || !isBoard()) loadFields();
  }

  /* ---- 計算列（版 3.38.0。一覧の表示列で式から作った列）。この PC の表示列の設定の式を、そのデータの分だけ集める
     （作業実績は設備ごとの設定。すべての設備なら合わせる）。パネルには使う計算列の式だけを写す（共通のダッシュボードをほかの PC で開いても同じ数） */
  function calcContext() {
    const LC = window.LotListColumns;
    if (!LC || !LC.formulaContext) return t.calc || { formulas: {}, names: {} };
    const head = t.source === "lot" ? "lotlist:" : t.source === "work" ? (t.equip ? `worklog:${t.equip}:` : "worklog:") : `${t.source}:`;
    const mine = LC.formulaContext((k) => k.startsWith(head)), had = t.calc || { formulas: {}, names: {} };
    // 組み直すと、この PC の一覧の今の式になる。この PC に無い計算列（ほかの人が組んだ物）は、パネルに写してある式のまま
    return { formulas: { ...had.formulas, ...mine.formulas }, names: { ...had.names, ...mine.names } };
  }
  const isCalc = (c) => !!(fieldOf(c) || {}).calc;
  /** 組む物が使う計算列の式（＋その式が [名前] で読む式の列を 1 段。サーバーは画面の baseRow と同じ引き方で計算する）→ 無ければ null */
  function calcOf(x) {
    const b = x.body || {}, used = new Set([...(b.rows || []), ...(b.cols || [])].map((d) => d.column)
      .concat((b.measures || []).map((m) => m.column || ""), (x.filters || []).map((f) => f.column), [x.period ? x.period.column : ""]));
    const byName = Object.fromEntries(Object.entries(ctx.names).map(([c, n]) => [n, c]));
    const formulas = {};
    [...used].filter((c) => c && isCalc(c) && ctx.formulas[c]).forEach((c) => {
      formulas[c] = ctx.formulas[c];
      const chk = window.WL && WL.formula.check(ctx.formulas[c]);
      ((chk && chk.ok && chk.columns) || []).map((n) => byName[n] || n).forEach((n) => { if (ctx.formulas[n] && !(n in formulas)) formulas[n] = ctx.formulas[n]; });
    });
    return Object.keys(formulas).length ? { formulas, names: ctx.names } : null;
  }
  /** 使う計算列の式を組む物に写す（使わなくなったら外す） */
  function syncCalc() { if (t === p && isBoard()) return; const c = calcOf(t); if (c) t.calc = c; else delete t.calc; }

  const srcOf = (k) => sources.find((x) => x.key === k) || null;
  const isWork = () => t.source === "work";
  const special = () => (fields && fields.special) || [];
  const fieldOf = (c) => ((fields && fields.fields) || []).find((f) => f.column === c) || null;
  const isDate = (c) => (c === "@workday") || !!(fieldOf(c) || {}).date;
  const isNum = (c) => !!(fieldOf(c) || {}).numeric;
  function partsOf(c) {
    if (c === "@workday") return WORKDAY_PARTS;
    if (c.startsWith("@")) return [""];
    if (isDate(c)) return DATE_PARTS;
    if (isNum(c)) return NUM_PARTS;
    return [""];
  }
  function defaultPart(c) {
    if (c.startsWith("@")) return "";
    if (isDate(c)) return "date";
    const f = fieldOf(c);
    return f && f.numeric && (f.many || f.kinds > 30) ? "bin" : "";
  }
  const dimLabel = (d) => (d.column === "@equip" ? "設備" : d.column === "@workday" ? "作業日" : d.column === "@shift" ? "直" : d.column);

  /** 題が空のときの名前（組み方から作る。パネルの見出しにも同じ物） */
  function autoTitle(x) {
    if (x.visual === "board") return (x.groups || []).length ? `${dimLabel(x.rows || { column: "@equip" })}ごとの${x.groups.map((g) => g.title || P.groupTitle(g, null)).join("と")}` : "合わせた表";
    const b = x.body || {}, ms = (b.measures || []).map(P.measName).join("・") || "ロット数";
    const pr = x.period && x.period.kind ? `${x.period.kind === "days" ? `直近 ${x.period.n || 7} 日` : (PERIODS.find((k) => k[0] === x.period.kind) || [, ""])[1]}の` : "";
    const src = (srcOf(x.source) || {}).name || "";
    if (!(b.rows || []).length) return `${pr}${src ? src + "の" : ""}${ms}`;
    return `${pr}${b.rows.map(dimLabel).join("・")}ごとの${(b.cols || []).length ? b.cols.map(dimLabel).join("・") + "別の" : ""}${ms}`;
  }

  /* ---- 変える（変えるたびに host.onChange でグリッドのパネルを描き直す） ---- */
  function changed(repaintFields = true) { syncCalc(); pushGroup(); host.onChange(TPA.clone(p)); paint(repaintFields); }
  function addDim(role, col) {
    const b = t.body, other = role === "rows" ? "cols" : "rows", max = inGroup() ? MAX_GROUP_COLS : MAX_DIMS;
    if (inGroup() && role === "rows") return;                        // 行の段は表全体で 1 つ（「表全体」で決める）
    if (b[role].some((d) => d.column === col)) { b[role] = b[role].filter((d) => d.column !== col); changed(); return; }
    if (b[role].length >= max) { host.toast(`${role === "rows" ? "行" : "列"}の段は ${max} つまでです`); return; }
    if (!inGroup()) b[other] = b[other].filter((d) => d.column !== col);
    b[role] = b[role].concat([{ column: col, part: defaultPart(col) }]);
    if (t.visual === "kpi" && role === "rows") t.visual = C.isTimeDim(b.rows[0]) ? "time" : "column";   // 行を入れたら数字はグラフに
    changed();
  }
  function addMeasure(m) {
    const ms = t.body.measures, same = (x) => x.agg === m.agg && (x.column || "") === (m.column || "");
    if (inGroup()) { t.body.measures = [m]; changed(); return; }          // まとまりの値は 1 つ（押した物に替える）
    if (ms.some(same)) { t.body.measures = ms.filter((x) => !same(x)); if (!t.body.measures.length) t.body.measures = [{ agg: "lots" }]; changed(); return; }
    if (ms.length >= MAX_MEASURES) { host.toast(`値は ${MAX_MEASURES} つまでです`); return; }
    t.body.measures = ms.concat([m]); changed();
  }
  function setVisual(k) {
    if (k === "board") { toBoard(); return; }
    if (isBoard()) fromBoard();
    p.visual = k;
    const b = p.body;
    if (k !== "kpi" && k !== "none" && !b.rows.length) {   // 行の段が要る形: 向く段を 1 つ入れる（作業実績は作業日・ほかは設備か種類の少ない列）
      const sp = special().map((x) => x.column);
      const pick = (k === "time" || k === "line" || k === "control") ? (sp.includes("@workday") ? "@workday" : ((fields && fields.fields) || []).find((f) => f.date)?.column)
        : sp.includes("@equip") ? "@equip" : ((fields && fields.fields) || []).filter((f) => !f.numeric && !f.date && f.kinds >= 2 && f.kinds <= 30).sort((a, c) => a.kinds - c.kinds)[0]?.column;
      if (pick) { b.rows = [{ column: pick, part: defaultPart(pick) }]; host.toast(`この形には行の段が要るので「${dimLabel(b.rows[0])}」を入れました`); }
    }
    b.grand = k === "none" || k === "kpi";
    changed();
  }
  /** ふつうのパネル → 合わせた表（いまの組みを 1 つ目のまとまりに。行の段は設備） */
  function toBoard() {
    if (isBoard()) return;
    const b = p.body || {};
    const g = { title: "", source: p.source, equip: p.equip || "", filters: p.filters || [], search: p.search || "", period: p.period || null, basis: p.basis || "work",
      ...(p.calc ? { calc: p.calc } : {}), measure: (b.measures || [])[0] || { agg: "lots" }, cols: (b.cols || []).slice(0, MAX_GROUP_COLS), look: "num", total: true, zero: false, color: "" };
    ["source", "equip", "filters", "search", "period", "basis", "calc", "body", "sort", "top"].forEach((k) => delete p[k]);
    Object.assign(p, { visual: "board", rows: { column: "@equip", part: "" }, groups: [g], order: { by: "value", group: 0, dir: "desc", list: [], hide: [] } });
    host.toast("合わせた表にしました。行は設備です（「表全体」で変えられます）");
    gi = 0; t = groupView(p.groups[0]); changed(); loadFields();
  }
  /** 合わせた表 → ふつうのパネル（1 つ目のまとまりの組みで） */
  function fromBoard() {
    const g = p.groups[0] || { source: "work", measure: { agg: "lots" }, cols: [] };
    Object.assign(p, { source: g.source, equip: g.equip || "", filters: g.filters || [], search: g.search || "", period: g.period || null, basis: g.basis || "work",
      ...(g.calc ? { calc: g.calc } : {}), body: { rows: [p.rows || { column: "@equip", part: "" }], cols: g.cols || [], measures: [g.measure], grand: false, labels: true, chartAt: 0 }, sort: "desc", top: 0 });
    ["rows", "groups", "order", "legacy"].forEach((k) => delete p[k]);
    gi = -1; t = p;
  }
  async function setSource(key, equip = "") {
    if (key === t.source && equip === t.equip) return;
    const keepPeriod = t.period && t.period.column === "@workday" && key === "work";
    Object.assign(t, { source: key, equip, filters: [], search: "", period: keepPeriod ? t.period : null });
    t.body = { ...t.body, rows: inGroup() ? t.body.rows : [], cols: [], measures: [{ agg: "lots" }] };
    if (!inGroup() && p.visual !== "kpi" && p.visual !== "none") p.visual = "kpi";
    await loadFields(); changed();
  }

  /* ---- 合わせた表: 表全体（行の段・並び・隠す行）とまとまりの並び ---- */
  function addGroup() {
    if (p.groups.length >= MAX_GROUPS) { host.toast(`列のまとまりは ${MAX_GROUPS} つまでです`); return; }
    const last = p.groups[p.groups.length - 1] || {};
    p.groups.push({ title: "", source: last.source || "work", equip: "", filters: [], search: "", period: null, basis: "work", measure: { agg: "lots" }, cols: [], look: "num", total: true, zero: false, color: "" });
    delete p.legacy; host.onChange(TPA.clone(p)); select(p.groups.length - 1);
  }
  function moveGroup(i, d) {
    const j = i + d; if (j < 0 || j >= p.groups.length) return;
    [p.groups[i], p.groups[j]] = [p.groups[j], p.groups[i]];
    const o = p.order; if (o.group === i) o.group = j; else if (o.group === j) o.group = i;
    gi = j; t = groupView(p.groups[gi]); changed(false);
  }
  function removeGroup(i) {
    if (p.groups.length <= 1) { host.toast("まとまりは 1 つ以上要ります（表をやめるときは、ほかの形を選びます）"); return; }
    p.groups.splice(i, 1);
    p.order.group = Math.min(p.order.group, p.groups.length - 1);
    gi = -1; t = p; changed(false);
  }
  /** 行の鍵の並び（いまの答えから。隠した行も）→ [{key, hidden}] */
  function rowKeys() {
    const d = host.answer && host.answer();
    const all = d ? P.boardKeys(p, d) : [];
    const hide = new Set(p.order.hide || []);
    return all.map((k) => ({ key: k, hidden: hide.has(k) }));
  }
  /** 手で並べる: いまの見え方の並び（隠した行も）を list にして、i を d だけ動かす */
  function moveRow(key, to) {
    const keys = rowKeys().map((x) => x.key), from = keys.indexOf(key);
    if (from < 0 || to < 0 || to >= keys.length) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    Object.assign(p.order, { by: "manual", list: keys });
    changed(false);
  }
  function toggleRow(key) {
    const hide = new Set(p.order.hide || []);
    if (hide.has(key)) hide.delete(key); else hide.add(key);
    p.order.hide = [...hide];
    changed(false);
  }

  async function loadFields() {
    if (isBoard() && gi < 0) return;
    ctx = calcContext();
    const key = JSON.stringify([t.source, t.equip, ctx]);
    if (fields && fieldsKey === key) return;
    fields = null; fieldsErr = ""; fieldsKey = key; paint();
    try {
      const r = await fetch("/api/dashboard/fields", TPA.json("POST", { source: t.source, equip: t.equip || "", calc: ctx }));
      const d = await r.json().catch(() => ({}));
      if (fieldsKey !== key) return;
      if (!r.ok) { fieldsErr = d.error || "カラムを読めませんでした"; if (d.kind === "copying") setTimeout(() => { if (fieldsKey === key) { fieldsKey = ""; loadFields().then(() => paint()); } }, 4000); }
      else fields = d;
    } catch (e) { fieldsErr = String(e); }
    paint();
  }

  /* ---- 描く ---- */
  const btn = (role, col, on, extra = "") => `<button type="button" class="pv-r r-${role}${on ? " on" : ""}" data-de-add="${role}" data-col="${esc(col)}" aria-pressed="${on}" ${extra}>${{ rows: "行", cols: "列", vals: "値" }[role]}</button>`;
  function fieldsHtml() {
    if (fieldsErr) return `<p class="pv-none">${esc(fieldsErr)}</p>`;
    if (!fields) return '<p class="pv-none">カラムを読んでいます…</p>';
    const b = t.body, used = (c) => (b.rows.some((d) => d.column === c) ? "rows" : b.cols.some((d) => d.column === c) ? "cols" : "");
    const rowBtn = (c, on) => (inGroup() ? "<i></i>" : btn("rows", c, on));
    const meas = (agg, col = "") => b.measures.some((m) => m.agg === agg && (m.column || "") === col);
    const ql = q.trim().toLowerCase(), hit = (n) => !ql || n.toLowerCase().includes(ql);
    let html = special().filter((x) => hit(x.name)).map((x) => `<div class="pv-f is-special${used(x.column) ? " is-used" : ""}" title="${esc(x.hint || "")}"><span><b>${esc(x.name)}</b><small>${esc(x.hint || "")}</small></span>`
      + `${rowBtn(x.column, used(x.column) === "rows")}${btn("cols", x.column, used(x.column) === "cols")}<i></i></div>`).join("");
    if (hit("ロット数 件数")) {
      html += `<div class="pv-f is-special${meas("lots") ? " is-used" : ""}"><span><b>ロット数</b><small>${isWork() ? "作業の数（作業開始が同じ行は 1）" : "重複の無いロット番号"}</small></span><i></i><i></i>${btn("vals", "@lots", meas("lots"))}</div>`
        + `<div class="pv-f is-special${meas("count") ? " is-used" : ""}"><span><b>件数</b><small>行の数</small></span><i></i><i></i>${btn("vals", "@count", meas("count"))}</div>`;
    }
    html += fields.fields.filter((f) => hit(f.column)).map((f) => {
      const c = f.column, u = used(c), anyVal = b.measures.some((m) => m.column === c);
      if (f.error) return `<div class="pv-f is-off" title="${esc(ctx.formulas[c] || "")}"><span><b>${esc(c)}<small class="sx-calc">式</small></b><small>${esc(f.error)}（一覧の「表示列」で直す）</small></span><i></i><i></i><i></i></div>`;
      const sub = (f.calc ? "式の列 · " : "") + (f.date ? "日付" : f.numeric ? `数${f.many ? "" : ` · ${f.kinds} 種類`}` : f.many ? "1,000 種類以上" : `${f.kinds} 種類`);
      const tip = f.calc ? `${c}（計算列。一覧の表示列で作った式）\n${ctx.formulas[c] || ""}` : c;
      return `<div class="pv-f${u || anyVal ? " is-used" : ""}${f.calc ? " is-calc" : ""}" title="${esc(tip)}"><span><b>${esc(c)}${f.calc ? '<small class="sx-calc">式</small>' : ""}</b><small>${sub}</small></span>`
        + rowBtn(c, u === "rows") + btn("cols", c, u === "cols") + (f.numeric ? btn("vals", c, anyVal, 'title="合計を値に足します（値の札で平均・最小・最大に替えられます）"') : "<i></i>") + "</div>";
    }).join("");
    return html || '<p class="pv-none">当たるカラムがありません</p>';
  }
  function dimChip(d, role, i) {
    const parts = partsOf(d.column), pn = d.column === "@workday" ? WORKDAY_NAME : PART_NAME, fixed = inGroup() && role === "rows";
    const sel = parts.length > 1 && !fixed ? `<select data-de-part="${role}" data-i="${i}" aria-label="まとめ方">${parts.map((x) => `<option value="${x}"${(d.part || "") === x ? " selected" : ""}>${pn[x]}</option>`).join("")}</select>` : "";
    return `<span class="pv-chip ${role === "rows" ? "r" : "c"}${fixed ? " is-fixed" : ""}"${fixed ? ' title="行の段は表全体で 1 つです（「表全体」で変えます）"' : ""}><b>${esc(dimLabel(d))}</b>${sel}${fixed ? "" : `<button type="button" data-de-x="${role}" data-i="${i}" aria-label="「${esc(dimLabel(d))}」を外す">×</button>`}</span>`;
  }
  function measChip(m, i) {
    const sel = m.agg === "count" || m.agg === "lots" ? "" : `<select data-de-agg="${i}" aria-label="集計のしかた">${AGGS.map(([k, n]) => `<option value="${k}"${m.agg === k ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    const name = m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : m.column;
    return `<span class="pv-chip v"><b>${esc(name)}</b>${sel}${inGroup() ? "" : `<button type="button" data-de-mx="${i}" aria-label="「${esc(P.measName(m))}」を外す">×</button>`}</span>`;
  }
  function sentenceHtml() {
    const b = t.body, slot = (role, html, ph) => `<span class="pv-slot" data-role="${role}">${html || `<span class="pv-ph">${ph}</span>`}</span>`;
    const kpi = t.visual === "kpi";
    return `<div class="pv-sent de-sent">${kpi ? '<span class="pv-w">全体の</span>' : `${slot("rows", b.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］")}<span class="pv-w">ごとに、</span>`
      + `${slot("cols", b.cols.map((d, i) => dimChip(d, "cols", i)).join(""), "＋ 列")}<span class="pv-w">別の</span>`}`
      + `${slot("vals", b.measures.map(measChip).join(""), "ロット数")}<span class="pv-w">を出す</span></div>`;
  }
  function visualsHtml() {
    if (inGroup()) return "";
    const all = EXTRA.concat(C.DEFS.filter((x) => x.k !== "none"));
    const ico = (x) => (x.icon && !C.get(x.k) ? `<svg class="pv-ico" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="${x.icon}"/></svg>` : C.iconSvg(x.k, 17));
    return `<div class="de-vis" role="radiogroup" aria-label="形">${all.map((x) => `<button type="button" class="pv-cbtn${p.visual === x.k ? " on" : ""}" role="radio" aria-checked="${p.visual === x.k}" data-de-vis="${x.k}" title="${esc(x.tip || "")}">${ico(x)}<span>${esc(x.n)}</span></button>`).join("")}</div>`;
  }
  function condHtml() {
    const cols = ((fields && fields.fields) || []).filter((f) => !f.error).map((f) => f.column);
    const colOpts = (cur) => [`<option value="">列を選ぶ</option>`, ...cols.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`)].join("");
    const opOpts = (cur) => TPA.FILTER_OPS.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    const rows = t.filters.map((f, i) => `<div class="db-crow" data-i="${i}"><select data-de-f="column">${colOpts(f.column)}</select><select data-de-f="op">${opOpts(f.op || "eq")}</select>`
      + `<input data-de-f="value" value="${esc(f.value || "")}" placeholder="値"${TPA.noValueOp(f.op) ? " disabled" : ""}><button type="button" class="icon-btn" data-de-fdel="${i}" aria-label="この条件を外す">×</button></div>`).join("");
    const dates = [...(special().some((x) => x.column === "@workday") ? [["@workday", "作業日（勤務体系で決めた日）"]] : []), ...((fields && fields.fields) || []).filter((f) => f.date).map((f) => [f.column, f.column])];
    const pr = t.period || {}, kind = pr.kind || "";
    const period = `<div class="de-row"><label class="de-l">期間</label><select data-de-pkind aria-label="期間">${PERIODS.map(([k, n]) => `<option value="${k}"${k === kind ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + (kind === "days" ? `<input type="number" min="1" max="3660" data-de-pn value="${pr.n || 7}" aria-label="日の数" class="de-n">日` : "")
      + (kind ? `<select data-de-pcol aria-label="期間で絞る日付">${dates.map(([c, n]) => `<option value="${esc(c)}"${c === pr.column ? " selected" : ""}>${esc(n)}</option>`).join("") || '<option value="">（日付の列がありません）</option>'}</select>` : "")
      + "</div>";
    return `${period}<div class="de-row de-top"><label class="de-l">条件</label><div class="db-crows">${rows || '<small class="de-hint">すべての行を数えます</small>'}</div></div>`
      + `<div class="de-row"><span class="de-l"></span><button type="button" class="pv-btn" data-de-fadd${cols.length ? "" : " disabled"}>＋ 条件を足す</button></div>`;
  }
  /** 見せ方（形の札のすぐ下）。まとまりは 棒・濃淡・数・色・計の列・0 の印。ほかは目立たせる */
  function lookHtml() {
    if (!inGroup()) return `<div class="de-row"><span class="de-l">見せ方</span><label class="pv-ck" title="最初に見る数に（淡い藍の地と藍の枠）"><input type="checkbox" data-de-emph${p.emph ? " checked" : ""}>目立たせる</label></div>`;
    const g = p.groups[gi], base = P.colorOf(g.source);
    const looks = LOOKS.map(([k, n]) => `<label class="de-seg${g.look === k ? " on" : ""}"><input type="radio" name="deLook" value="${k}" data-de-look${g.look === k ? " checked" : ""}>${n}</label>`).join("");
    const colors = GROUP_COLORS.map((c) => `<button type="button" class="de-sw${(g.color || "") === c ? " on" : ""}" data-de-color="${c}" style="--sw:${c || base}" aria-label="${c ? `色 ${c}` : "データの種類の色"}" aria-pressed="${(g.color || "") === c}" title="${c ? "この色にする" : "データの種類の色（仕掛＝藍・作業実績＝青緑・品質データ＝琥珀）"}">${c ? "" : "自"}</button>`).join("");
    return `<div class="de-row"><span class="de-l">見せ方</span><span class="de-segs" role="radiogroup" aria-label="見せ方">${looks}</span><span class="de-sws" aria-label="色">${colors}</span></div>`
      + `<div class="de-row"><span class="de-l"></span>${g.cols.length ? `<label class="pv-ck"><input type="checkbox" data-de-total${g.total ? " checked" : ""}>計の列</label>` : ""}`
      + `<label class="pv-ck" title="ほかのまとまりに数があるのに、このまとまりが 0 の行に印を付け、表の上に名前を出します"><input type="checkbox" data-de-zero${g.zero ? " checked" : ""}>0 の行に印</label>`
      + `<label class="pv-ck de-gt">見出し<input data-de-gtitle value="${esc(g.title || "")}" placeholder="${esc(P.groupTitle(g, null))}" maxlength="40" aria-label="まとまりの見出し"></label></div>`;
  }
  function sortHtml() {
    if (t.visual === "kpi" || inGroup()) return "";
    return `<div class="de-row"><label class="de-l">並べ方</label><select data-de-sort aria-label="並べ方">${[["", "決まった順（名前・日付）"], ["desc", "値の大きい順"], ["asc", "値の小さい順"]].map(([k, n]) => `<option value="${k}"${(p.sort || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + `<label class="pv-ck">上位<input type="number" min="0" max="60" data-de-top value="${p.top || 0}" class="de-n" aria-label="上位いくつ（0＝パネルに入るだけ）"></label><small class="de-hint">0＝パネルに入るだけ</small></div>`;
  }
  function dataHtml() {
    const src = srcOf(t.source);
    const equips = src && src.equips ? `<select data-de-equip aria-label="設備"><option value="">すべての設備</option>${src.equips.map((e) => `<option value="${esc(e.key)}"${e.key === t.equip ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : "";
    const basis = isWork() ? `<select data-de-basis aria-label="作業日の数え方"><option value="work"${t.basis !== "cal" ? " selected" : ""}>現場歴</option><option value="cal"${t.basis === "cal" ? " selected" : ""}>太陽暦</option></select>` : "";
    return `<div class="de-row"><label class="de-l">データ</label><select data-de-src aria-label="データ">${sources.map((x) => `<option value="${esc(x.key)}"${x.key === t.source ? " selected" : ""}${x.place ? "" : " disabled"}>${esc(x.name)}${x.place ? "" : "（場所が未設定）"}</option>`).join("")}</select>${equips}${basis}</div>`;
  }
  /** 合わせた表の札（表全体・まとまり ①②…・＋） */
  function tabsHtml() {
    if (!isBoard()) return "";
    const n = "①②③④";
    return `<div class="de-tabs" role="tablist" aria-label="合わせた表の組み"><button type="button" role="tab" class="de-tab${gi < 0 ? " on" : ""}" aria-selected="${gi < 0}" data-de-tab="-1">表全体<small>行・並び</small></button>`
      + p.groups.map((g, i) => `<button type="button" role="tab" class="de-tab${gi === i ? " on" : ""}" aria-selected="${gi === i}" data-de-tab="${i}" style="--gc:${g.color || P.colorOf(g.source)}"><i aria-hidden="true"></i>${n[i]} ${esc(g.title || P.groupTitle(g, null))}<small>${esc((srcOf(g.source) || {}).name || "")}</small></button>`).join("")
      + (p.groups.length < MAX_GROUPS ? '<button type="button" class="de-tab is-add" data-de-gadd title="データの数を横に足します（4 つまで）">＋ まとまり</button>' : "") + "</div>";
  }
  /** 表全体: 行の段・並び・隠す行（行の札。⋮⋮ を引くか ↑↓ で手で並べる） */
  function boardHtml() {
    const o = p.order, keys = rowKeys(), n = "①②③④";
    const by = [["value:desc", "値の大きい順"], ["value:asc", "値の小さい順"], ["name", "名前の順"], ["equip", "設備の並び（作業実績の設備の並び）"], ["manual", "手で並べた順"]];
    const cur = o.by === "value" ? `value:${o.dir}` : o.by;
    const rowsSel = `<select data-de-brows aria-label="行の段"><option value="@equip"${p.rows.column === "@equip" ? " selected" : ""}>設備</option>`
      + (p.rows.column !== "@equip" ? `<option selected>${esc(p.rows.column)}</option>` : "") + "</select>";
    const list = keys.length ? keys.map((x, i) => `<li class="de-rowi${x.hidden ? " is-hidden" : ""}" draggable="true" data-de-row="${esc(x.key)}"><span class="de-grip" aria-hidden="true">⋮⋮</span><b>${esc(x.key)}</b>`
      + `<button type="button" class="icon-btn" data-de-rup="${i}" aria-label="「${esc(x.key)}」を上へ"${i ? "" : " disabled"}>↑</button><button type="button" class="icon-btn" data-de-rdown="${i}" aria-label="「${esc(x.key)}」を下へ"${i < keys.length - 1 ? "" : " disabled"}>↓</button>`
      + `<label class="pv-ck"><input type="checkbox" data-de-rshow${x.hidden ? "" : " checked"}>出す</label></li>`).join("") : '<li class="de-hint">数え終えると、行がここに並びます</li>';
    return `<div class="de-row"><label class="de-l">行</label>${rowsSel}<small class="de-hint">どのまとまりも、この段でそろえます</small></div>`
      + `<div class="de-row"><label class="de-l">並び</label><select data-de-border aria-label="行の並び">${by.map(([k, nm]) => `<option value="${k}"${k === cur ? " selected" : ""}>${nm}</option>`).join("")}</select>`
      + (o.by === "value" ? `<select data-de-bgroup aria-label="どのまとまりの計で">${p.groups.map((g, i) => `<option value="${i}"${o.group === i ? " selected" : ""}>${n[i]} ${esc(g.title || P.groupTitle(g, null))}の計</option>`).join("")}</select>` : "")
      + `</div><div class="de-row de-top"><span class="de-l"></span><ol class="de-rows" aria-label="行（引いて並べる・出すを外すと隠す）">${list}</ol></div>`;
  }
  function groupActsHtml() {
    if (!inGroup()) return "";
    return `<div class="de-row de-gacts"><span class="de-l"></span><button type="button" class="pv-btn" data-de-gmove="-1"${gi ? "" : " disabled"}>← 左へ</button><button type="button" class="pv-btn" data-de-gmove="1"${gi < p.groups.length - 1 ? "" : " disabled"}>右へ →</button>`
      + `<button type="button" class="pv-btn is-danger" data-de-gdel${p.groups.length > 1 ? "" : " disabled"}>このまとまりを外す</button></div>`;
  }

  function paint(repaintFields = true) {
    const el = $("#dbEditor"); if (!el || !p) return;
    if (!el.firstChild) {
      el.innerHTML = `<div class="de-head" data-drag><b>パネルを組む</b><input id="deTitle" class="de-title" autocomplete="off" aria-label="題" maxlength="60">`
        + `<span class="db-sp"></span><button type="button" class="btn-ghost" data-de-cancel>やめる</button><button type="button" class="btn-primary" data-de-apply>当てる</button></div>`
        + `<div id="deTabs"></div><div class="de-body"><aside class="pv-fields de-fields"><div class="pv-cap"><b>カラム</b><small>札を押すと右の文に入ります（もう一度押すと外れます）</small></div>`
        + `<input id="deSearch" type="search" placeholder="カラムを検索" autocomplete="off" aria-label="カラムを検索"><div class="pv-list" id="deFields"></div></aside>`
        + `<div class="de-main"><div id="deVis"></div><div id="deBoard"></div><div id="deData"></div><div id="deSent"></div><div id="deLook"></div><div id="deCond"></div><div id="deSort"></div><div id="deGacts"></div><p class="de-msg" id="deMsg" aria-live="polite"></p></div></div>`;
      TPA.onText($("#deSearch"), (v) => { q = v; $("#deFields").innerHTML = fieldsHtml(); });
      TPA.onText($("#deTitle"), (v) => { p.title = v.slice(0, 60); host.onChange(TPA.clone(p)); });
    }
    const whole = isBoard() && gi < 0;
    el.classList.toggle("is-board", isBoard()); el.classList.toggle("is-whole", whole);
    const ti = $("#deTitle");
    if (document.activeElement !== ti) ti.value = p.title || "";
    ti.placeholder = autoTitle(p);
    $("#deTabs").innerHTML = tabsHtml();
    $("#deVis").innerHTML = visualsHtml();
    $("#deBoard").innerHTML = whole ? boardHtml() : "";
    $(".de-fields").hidden = whole;
    ["#deData", "#deSent", "#deCond", "#deSort"].forEach((s) => { $(s).hidden = whole; });
    if (!whole) {
      if (repaintFields) $("#deFields").innerHTML = fieldsHtml();
      $("#deData").innerHTML = dataHtml();
      $("#deSent").innerHTML = sentenceHtml();
      if (!el.contains(document.activeElement) || !document.activeElement.closest("#deCond")) $("#deCond").innerHTML = condHtml();
      $("#deSort").innerHTML = sortHtml();
    }
    if (!el.contains(document.activeElement) || !document.activeElement.closest("#deLook")) $("#deLook").innerHTML = whole ? "" : lookHtml();
    $("#deGacts").innerHTML = groupActsHtml();
  }
  function message(text) { const m = $("#deMsg"); if (m) m.textContent = text || ""; }

  function bind(el) {
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || !p) return;
      if (b.hasAttribute("data-de-cancel")) { host.onCancel(); return; }
      if (b.hasAttribute("data-de-apply")) { host.onApply(TPA.clone(p)); return; }
      if (b.dataset.deTab != null) { select(+b.dataset.deTab); return; }
      if (b.hasAttribute("data-de-gadd")) { addGroup(); return; }
      if (b.dataset.deGmove) { moveGroup(gi, +b.dataset.deGmove); return; }
      if (b.hasAttribute("data-de-gdel")) { removeGroup(gi); return; }
      if (b.dataset.deRup != null || b.dataset.deRdown != null) { const i = +(b.dataset.deRup ?? b.dataset.deRdown); moveRow(b.closest("[data-de-row]").dataset.deRow, b.dataset.deRup != null ? i - 1 : i + 1); return; }
      if (b.dataset.deColor != null) { p.groups[gi].color = b.dataset.deColor; changed(false); return; }
      if (b.dataset.deAdd) {
        const role = b.dataset.deAdd, col = b.dataset.col;
        if (role === "vals") addMeasure(col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : { agg: "sum", column: col });
        else addDim(role, col);
        return;
      }
      if (b.dataset.deX) { t.body[b.dataset.deX].splice(+b.dataset.i, 1); changed(); return; }
      if (b.dataset.deMx != null) { t.body.measures.splice(+b.dataset.deMx, 1); if (!t.body.measures.length) t.body.measures = [{ agg: "lots" }]; changed(); return; }
      if (b.dataset.deVis) { setVisual(b.dataset.deVis); return; }
      if (b.hasAttribute("data-de-fadd")) { t.filters.push({ column: "", op: "eq", value: "" }); $("#deCond").innerHTML = condHtml(); return; }
      if (b.dataset.deFdel != null) { t.filters.splice(+b.dataset.deFdel, 1); $("#deCond").innerHTML = condHtml(); changed(false); }
    });
    el.addEventListener("change", (e) => {
      const x = e.target; if (!p) return;
      if (x.matches("[data-de-src]")) { setSource(x.value, ""); return; }
      if (x.matches("[data-de-equip]")) { setSource(t.source, x.value); return; }
      if (x.matches("[data-de-basis]")) { t.basis = x.value; changed(false); return; }
      if (x.matches("[data-de-part]")) { t.body[x.dataset.dePart][+x.dataset.i].part = x.value; changed(false); return; }
      if (x.matches("[data-de-agg]")) { t.body.measures[+x.dataset.deAgg].agg = x.value; changed(false); return; }
      if (x.matches("[data-de-pkind]")) {
        const dates = special().some((s) => s.column === "@workday") ? "@workday" : (((fields && fields.fields) || []).find((f) => f.date) || {}).column || "";
        t.period = x.value ? { column: (t.period && t.period.column) || dates, kind: x.value, n: (t.period && t.period.n) || 7 } : null;
        $("#deCond").innerHTML = condHtml(); changed(false); return;
      }
      if (x.matches("[data-de-pcol]")) { t.period.column = x.value; changed(false); return; }
      if (x.matches("[data-de-pn]")) { t.period.n = Math.max(1, Math.min(3660, +x.value || 7)); changed(false); return; }
      if (x.matches("[data-de-sort]")) { p.sort = x.value; changed(false); return; }
      if (x.matches("[data-de-emph]")) { p.emph = x.checked; changed(false); return; }
      if (x.matches("[data-de-top]")) { p.top = Math.max(0, Math.min(60, +x.value || 0)); changed(false); return; }
      if (x.matches("[data-de-look]")) { p.groups[gi].look = x.value; changed(false); return; }
      if (x.matches("[data-de-total]")) { p.groups[gi].total = x.checked; changed(false); return; }
      if (x.matches("[data-de-zero]")) { p.groups[gi].zero = x.checked; changed(false); return; }
      if (x.matches("[data-de-gtitle]")) { p.groups[gi].title = x.value.trim().slice(0, 40); changed(false); return; }
      if (x.matches("[data-de-border]")) { const [by, dir] = x.value.split(":"); Object.assign(p.order, { by, ...(dir ? { dir } : {}) }); if (by === "manual" && !p.order.list.length) p.order.list = rowKeys().map((r) => r.key); changed(false); return; }
      if (x.matches("[data-de-bgroup]")) { p.order.group = +x.value; changed(false); return; }
      if (x.matches("[data-de-rshow]")) { toggleRow(x.closest("[data-de-row]").dataset.deRow); return; }
      const row = x.closest(".db-crow");
      if (row && x.dataset.deF) {
        const f = t.filters[+row.dataset.i]; f[x.dataset.deF] = x.value;
        if (x.dataset.deF === "op") row.querySelector('[data-de-f="value"]').disabled = TPA.noValueOp(x.value);
        if (f.column) changed(false);
      }
    });
    // 行の札を引いて並べる（落とした所の行の前へ）
    let dragKey = "";
    el.addEventListener("dragstart", (e) => { const li = e.target.closest && e.target.closest("[data-de-row]"); if (!li) return; dragKey = li.dataset.deRow; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragKey); li.classList.add("is-drag"); });
    el.addEventListener("dragover", (e) => { if (dragKey && e.target.closest && e.target.closest("[data-de-row]")) { e.preventDefault(); el.querySelectorAll(".de-rowi.is-over").forEach((x) => x.classList.remove("is-over")); e.target.closest("[data-de-row]").classList.add("is-over"); } });
    el.addEventListener("drop", (e) => {
      const li = e.target.closest && e.target.closest("[data-de-row]"); if (!dragKey || !li) return;
      e.preventDefault();
      const keys = rowKeys().map((r) => r.key);
      moveRow(dragKey, keys.indexOf(li.dataset.deRow));
      dragKey = "";
    });
    el.addEventListener("dragend", () => { dragKey = ""; el.querySelectorAll(".is-drag,.is-over").forEach((x) => x.classList.remove("is-drag", "is-over")); });
  }

  window.DashEditor = {
    /** 開く。h = {panel, sources, answer() → いまの答え, onChange(panel), onApply(panel), onCancel(), toast(text)} */
    async open(h) {
      host = h; sources = h.sources || [];
      p = TPA.clone(h.panel);
      if (p.visual !== "board") {
        p.body = Object.assign({ rows: [], cols: [], measures: [{ agg: "lots" }], grand: false, labels: true, chartAt: 0 }, p.body || {});
        p.filters = p.filters || [];
      } else {
        p.order = Object.assign({ by: "value", group: 0, dir: "desc", list: [], hide: [] }, p.order || {});
      }
      p.title = p.title || "";
      const el = $("#dbEditor");
      if (!el.dataset.bound) { bind(el); el.dataset.bound = "1"; }
      el.innerHTML = ""; el.hidden = false; q = ""; fields = null; fieldsKey = "";
      gi = -1; t = p;
      paint();
      await loadFields();
      const ti = $("#deTitle");
      if (ti) { ti.focus({ preventScroll: true }); ti.setSelectionRange(0, 0); ti.scrollLeft = 0; }   // 字の頭から見せる（欄が狭いと末尾へ送られて頭が欠ける）
    },
    close() { const el = $("#dbEditor"); if (el) { el.hidden = true; el.innerHTML = ""; } host = null; p = null; t = null; },
    isOpen: () => !!p,
    panelId: () => (p ? p.id : ""),
    /** 答えが変わった（合わせた表の行の札を、数えた行で並べ直す） */
    answered() { if (isBoard() && gi < 0) paint(false); },
    message, autoTitle,
    setSources(list) { sources = list || []; },
  };
})();
