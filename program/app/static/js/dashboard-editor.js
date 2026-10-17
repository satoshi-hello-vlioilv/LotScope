/* =========================================================================
   ダッシュボードのパネルを組む所（版 3.37.0。グリッドは dashboard.js・描き方は dashboard-panels.js）
   集計表・グラフ（lotlist-pivot.js）と同じ組み方: 左にカラムの札（行・列・値）、右に文「［行］ごとに、［列］別の［値］を出す」と形。
   変えるたびに、グリッドの中のそのパネルがすぐ描き直る（パネルの大きさのまま。プレビューを別に持たない）。
   ほかに: データ（データ元・作業実績の設備・作業日の数え方）・条件（一覧と同じ形）・期間（今日・前日・直近 n 日・今月・先月）・
   並べ方（大きい順・小さい順）と上位いくつ・題
   合わせた表（版 3.38.0。visual board）: 上の札で「表全体」（行の段・行の並び・隠す行）と「列のまとまり」（1〜4）を切り替える。
   まとまりは、ふつうのパネルと同じ部品（カラムの札・文・データ・条件・期間）で組み（行の段は表全体で 1 つ・値は 1 つ）、見せ方（棒・濃淡・数・色・
   計の列・0 の印）を選ぶ。組む物（target）は、ふつうのパネルならパネル、合わせた表ならまとまりを写した形（groupView）で、変えるたびに書き戻す
   版 3.39.0（利用者の要望 2026-10）: 値の統計（中央値・標準偏差・p%点・Cpk など）と表し方（割合・累計・差・順位）・設備を複数選ぶ・設備をまとめる
   （選んだ設備の合算・このパネルのグループ・設備グループのマスタ）・見せ方（枠 5 つ・数字の形 3 つ・合わせた表 8 つ）・書式（数値ラベル・日付の形・
   字の向き・桁・単位・縦軸・凡例・補助線・字の大きさ・基準線・色の組・系列の色）・計算列をここで作る・形は目的ごとに並べる
   版 3.40.0（利用者の要望 2026-10）:
   - 設備の出し方（esplit・egroup）: 系列に分ける（設備ごとの系列）・図を並べる（設備ごとの小さな表・グラフ）・合算して 1 つ・グループ合算。
     設備は行・列にも置ける（「行に置く」「列に置く」）。設備グループの段（@egroup）と表の小計
   - 別のデータを合わせる（link）: 上の札で「全体」（軸のそろえ方・役割・作り方・差と達成率）と「データ」（1〜4）を切り替える。
     データ（側）は、合わせた表のまとまりと同じ部品で組む（行の段＝軸 1 つ・値 1 つ）
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const C = window.LotListPivotCharts, P = window.DashPanels;
  const MAX_DIMS = 3, MAX_MEASURES = 6, MAX_GROUPS = 4, MAX_GROUP_COLS = 2;
  const Q = window.DashFilter;
  const DATE_PARTS = ["date", "ym", "year", "month", "weekday", "hour", ""], NUM_PARTS = ["", "bin"], WORKDAY_PARTS = ["", "ym", "year"];
  const PART_NAME = { "": "値のまま", date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const WORKDAY_NAME = { "": "日", ym: "年月", year: "年" };
  const EXTRA = [{ k: "kpi", n: "数字", tip: "値の総計を大きな数で出します（行の段は要りません）", icon: "M4 15V5l-2 2M8 6a2 2 0 1 1 4 0c0 2-4 4-4 9h4M14 5h4l-3 4a3 3 0 1 1-2 5" },
    { k: "none", n: "表", tip: "集計表（行・列・値）を、パネルの大きさに詰めて出します", icon: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12" },
    { k: "board", n: "合わせた表", tip: "行（設備など）をそろえて、いくつかのデータの数を横に並べた 1 枚の表（設備ごとの仕掛と前日の実績など）", icon: "M3 4h14v12H3zM3 8h14M7 4v12M12 4v12" }];
  const PERIODS = [["", "期間で絞らない"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 n 日（今日を含む）"], ["this_month", "今月"], ["last_month", "先月"]];
  // 合わせた表の見せ方（版 3.39.0 で 3 → 8）。cols … 列の段があるときだけ意味のある物
  const LOOKS = [["bar", "棒と数", "棒の長さと数"], ["heat", "数と濃淡", "数の大きさを地の濃さで"], ["num", "数だけ", "数だけを並べる"],
    ["stack", "積み上げ帯", "列の段（直など）の内訳を 1 本の帯に積む", true], ["share", "割合", "行の計に対する割合（%）"], ["dot", "点と数", "線の上の点の位置で大きさ"],
    ["signal", "信号", "しきい値で ●よい・▲注意・✕要対応"], ["spark", "小さな線", "列の段（日など）の移りを 1 本の線で", true]];
  // パネルの見せ方（枠）・数字の形
  const FRAMES = [["card", "標準", "白い面"], ["emph", "目立たせる", "淡い藍の地と藍の枠（最初に見る数に）"], ["accent", "色の帯", "左に系列の色の帯"], ["plain", "枠なし", "地に溶け込む（補う数に）"], ["tint", "淡い地", "系列の色をごく淡く敷く"]];
  const KPI_LOOKS = [["num", "数", "大きな数だけ"], ["bar", "目標までの棒", "目標に対する達成率を棒で"], ["gauge", "メーター", "目標に対する達成率を半円で"]];
  // 書式の選び（サーバーの dashboard.clean_fmt と同じ鍵）
  const LABELS = [["", "自動"], ["none", "なし"], ["top", "上"], ["inside", "棒の中"], ["both", "両方"]];
  const XDATES = [["", "自動（10/2）"], ["md", "10/2"], ["mdw", "10/2(金)"], ["d", "2（日だけ）"], ["dw", "2(金)"], ["ymd", "2026/10/2"], ["w", "金（曜日）"]];
  const XROTS = [["", "自動"], ["0", "横"], ["45", "45°"], ["90", "縦"]];
  const UNITS = [["", "自動（万・億）"], ["none", "そのまま"], ["k", "千"], ["man", "万"]];
  const LEGENDS = [["", "自動"], ["none", "出さない"], ["top", "上"], ["bottom", "下"]];
  const SIZES = [["s", "小"], ["", "中"], ["l", "大"]];
  const REF_COLORS = ["#c9564a", "#b5822a", "#2f7d78", "#3f6591", "#5a6f77"];
  // まとまりの色（"" はデータの種類の色＝仕掛は藍・作業実績は青緑・品質データは琥珀。ほかは区分の色と同じ並び）
  const GROUP_COLORS = ["", "#7658ae", "#5c8a2a", "#8a5f18", "#5a6f77", "#8e4f76"];
  let host = null, p = null, t = null, gi = -1, sources = [], fields = null, fieldsKey = "", fieldsErr = "", q = "", ctx = { formulas: {}, names: {} }, formOpen = false;
  let eqOpen = false, eqItems = null, eqKey = "", eqSearch = "", calcEdit = null, fmtOpen = true;

  const isBoard = () => p && p.visual === "board";
  const isLink = () => !!(p && p.link && (p.link.sides || []).length);
  /** 札で切り替えて組む物（合わせた表のまとまり・合わせるデータ） */
  const parts = () => (isLink() ? p.link.sides : isBoard() ? p.groups : null);
  const inGroup = () => !!parts() && gi >= 0;
  const inSide = () => isLink() && gi >= 0;
  const ROLES = [["target", "目標", "計画・目標の数（45度線管理図では横）"], ["actual", "実績", "実際の数（45度線管理図では縦）"], ["", "比べる", "目標・実績ではなく並べて比べる"]];
  const ROLE_COLOR = P.ROLE_COLOR;             // 役割の色（グラフの系列と同じ。dashboard-panels.js）
  const BUILDS = [["as", "そのまま", "軸の値ごとの数"], ["cum", "積み上げ", "軸の並び（日なら古い順）に足していく累計"]];
  /** 合わせた表のまとまり → 組む形（ふつうのパネルと同じ形。行の段は表全体の物・値は 1 つ） */
  function groupView(g) {
    return { visual: "none", source: g.source, equip: g.equip || "", equips: g.equips || [], filters: g.filters || [], search: g.search || "", period: g.period || null, basis: g.basis || "work",
      ...(g.calc ? { calc: g.calc } : {}), body: { rows: isLink() ? (g.key ? [g.key] : []) : [p.rows], cols: isLink() ? [] : g.cols || [], measures: [g.measure || { agg: "lots" }], grand: true } };
  }
  /** 組んだ形 → まとまり（合わせるデータなら軸と値）へ書き戻す */
  function pushGroup() {
    if (!inGroup()) return;
    const g = parts()[gi];
    Object.assign(g, { source: t.source, equip: t.equip, filters: t.filters, search: t.search, period: t.period, basis: t.basis, measure: t.body.measures[0] || { agg: "lots" } });
    if (isLink()) g.key = t.body.rows[0] || null; else g.cols = t.body.cols;
    if ((t.equips || []).length) g.equips = t.equips; else delete g.equips;
    if (t.calc) g.calc = t.calc; else delete g.calc;
    delete p.legacy;              // 組み直した表は、前の版の条件を引き継がない
  }
  function select(i) {
    gi = parts() ? Math.max(-1, Math.min(i, parts().length - 1)) : -1;
    t = inGroup() ? groupView(parts()[gi]) : p;
    q = ""; eqOpen = false; eqItems = null; eqKey = "";
    paint(); if (t !== p || !parts()) loadFields();
  }

  /* ---- 計算列（版 3.38.0。一覧の表示列で式から作った列）。この PC の表示列の設定の式を、そのデータの分だけ集める
     （作業実績は設備ごとの設定。すべての設備なら合わせる）。パネルには使う計算列の式だけを写す（共通のダッシュボードをほかの PC で開いても同じ数） */
  function calcContext() {
    const LC = window.LotListColumns;
    if (!LC || !LC.formulaContext) return t.calc || { formulas: {}, names: {} };
    const head = t.source === "lot" ? "lotlist:" : t.source === "work" ? (t.equip ? `worklog:${t.equip}:` : "worklog:") : `${t.source}:`;
    const mine = LC.formulaContext((k) => k.startsWith(head)), had = t.calc || { formulas: {}, names: {} };
    // 組み直すと、この PC の一覧の今の式になる。この PC に無い計算列（ほかの人が組んだ物）は、パネルに写してある式のまま。
    // パネルで作った計算列（own。版 3.39.0）は、いつもパネルの式（一覧の同じ名前の式より先）
    const own = ownOf(had);
    return { formulas: { ...had.formulas, ...mine.formulas, ...own }, names: { ...had.names, ...mine.names }, own: Object.keys(own) };
  }
  const isCalc = (c) => !!(fieldOf(c) || {}).calc;
  /** パネルで作った計算列 → {名前: 式} */
  const ownOf = (c) => Object.fromEntries(((c && c.own) || []).filter((n) => c.formulas && c.formulas[n]).map((n) => [n, c.formulas[n]]));
  /** 組む物が使う計算列の式（＋その式が [名前] で読む式の列を 1 段。サーバーは画面の baseRow と同じ引き方で計算する）→ 無ければ null */
  function calcOf(x) {
    const b = x.body || {}, used = new Set([...(b.rows || []), ...(b.cols || [])].map((d) => d.column)
      .concat((b.measures || []).map((m) => m.column || ""), (x.filters || []).map((f) => f.column), [x.period ? x.period.column : ""]));
    const byName = Object.fromEntries(Object.entries(ctx.names).map(([c, n]) => [n, c]));
    const formulas = {};
    // パネルで作った計算列は、使っていなくても持つ（カラムの札に残す）
    (ctx.own || []).forEach((n) => { if (ctx.formulas[n]) used.add(n); });
    [...used].filter((c) => c && (isCalc(c) || (ctx.own || []).includes(c)) && ctx.formulas[c]).forEach((c) => {
      formulas[c] = ctx.formulas[c];
      const chk = window.WL && WL.formula.check(ctx.formulas[c]);
      ((chk && chk.ok && chk.columns) || []).map((n) => byName[n] || n).forEach((n) => { if (ctx.formulas[n] && !(n in formulas)) formulas[n] = ctx.formulas[n]; });
    });
    const own = (ctx.own || []).filter((n) => formulas[n]);
    return Object.keys(formulas).length ? { formulas, names: ctx.names, ...(own.length ? { own } : {}) } : null;
  }
  /** 使う計算列の式を組む物に写す（使わなくなったら外す） */
  function syncCalc() { if (t === p && parts()) return; const c = calcOf(t); if (c) t.calc = c; else delete t.calc; }

  const srcOf = (k) => sources.find((x) => x.key === k) || null;
  const isWork = () => t.source === "work";
  const special = () => (fields && fields.special) || [];
  const fieldOf = (c) => ((fields && fields.fields) || []).find((f) => f.column === c) || null;
  const isDate = (c) => (c === "@workday") || !!(fieldOf(c) || {}).date;
  const isNum = (c) => !!(fieldOf(c) || {}).numeric;
  /** 設備グループの段のまとめ方（マスタのまとめ方の名前・このパネルのグループ） */
  const egSets = () => ((special().find((x) => x.column === "@egroup") || {}).sets || []).concat(p.egroup && p.egroup.mode === "panel" ? ["@panel"] : []);
  function partsOf(c) {
    if (c === "@workday") return WORKDAY_PARTS;
    if (c === "@egroup") return egSets().length ? egSets() : [""];
    if (c.startsWith("@")) return [""];
    if (isDate(c)) return DATE_PARTS;
    if (isNum(c)) return NUM_PARTS;
    return [""];
  }
  function defaultPart(c) {
    if (c === "@egroup") return egSets()[0] || "";
    if (c.startsWith("@")) return "";
    if (isDate(c)) return "date";
    const f = fieldOf(c);
    return f && f.numeric && (f.many || f.kinds > 30) ? "bin" : "";
  }
  const dimLabel = (d) => (d.column === "@equip" ? "設備" : d.column === "@egroup" ? "設備グループ" : d.column === "@workday" ? "作業日" : d.column === "@shift" ? "直" : d.column);

  /** 題が空のときの名前（組み方から作る。パネルの見出しにも同じ物） */
  function autoTitle(x) {
    if (x.link && (x.link.sides || []).length) {
      const ss = x.link.sides, role = (r) => (ROLES.find((y) => y[0] === r) || [, ""])[1];
      return `${ss[0].key ? dimLabel(ss[0].key) + "ごとの" : ""}${ss.map((y) => (y.role ? role(y.role) : y.title || (srcOf(y.source) || {}).name || "データ")).join("と")}`;
    }
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
    if (inSide()) {                                                  // 合わせるデータの軸は 1 つ（押した物に替える）。列の段は無い
      if (role !== "rows") return;
      b.rows = b.rows.some((d) => d.column === col) ? [] : [{ column: col, part: defaultPart(col) }];
      changed(); return;
    }
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
    if (k === "board") { if (isLink()) unlink(); toBoard(); return; }
    if (isBoard()) fromBoard();
    p.visual = k;
    const b = p.body;
    if (isLink()) { b.grand = k === "none" || k === "kpi"; changed(false); return; }    // 行・値は合わせるデータの軸と値
    if (k !== "kpi" && k !== "none" && !b.rows.length) {   // 行の段が要る形: 向く段を 1 つ入れる（作業実績は作業日・ほかは設備か種類の少ない列）
      const sp = special().map((x) => x.column);
      const pick = (k === "time" || k === "line" || k === "area" || k === "stackarea" || k === "control" || k === "xbar") ? (sp.includes("@workday") ? "@workday" : ((fields && fields.fields) || []).find((f) => f.date)?.column)
        : sp.includes("@equip") ? "@equip" : ((fields && fields.fields) || []).filter((f) => !f.numeric && !f.date && f.kinds >= 2 && f.kinds <= 30).sort((a, c) => a.kinds - c.kinds)[0]?.column;
      if (pick) { b.rows = [{ column: pick, part: defaultPart(pick) }]; host.toast(`この形には行の段が要るので「${dimLabel(b.rows[0])}」を入れました`); }
    }
    // 値の数のカラムが要る形（箱ひげ・バイオリン・X̄-R は 1 つ、散布図・45度線は 2 つ、バブルは 3 つ）: 足りなければ数のカラムの平均を入れて知らせる
    const need = { box: 1, violin: 1, xbar: 1, scatter: 2, diag45: 2, bubble: 3 }[k] || 0;
    const have = b.measures.filter((m) => m.column && isNum(m.column));
    if (have.length < need) {
      const nums = ((fields && fields.fields) || []).filter((f) => f.numeric && !f.error).map((f) => f.column).filter((c) => !have.some((m) => m.column === c));
      const add = nums.slice(0, need - have.length).map((c) => ({ agg: "avg", column: c }));
      if (add.length) { b.measures = have.concat(add).slice(0, MAX_MEASURES); host.toast(`この形には数の値が ${need} つ要るので「${add.map(P.measName).join("」「")}」を入れました（値の札で替えられます）`); }
      else host.toast(`この形には数のカラムの値が ${need} つ要ります`);
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
    Object.assign(t, { source: key, equip, equips: [], filters: [], search: "", period: keepPeriod ? t.period : null });
    if (!inGroup()) delete p.egroup;
    eqOpen = false;
    t.body = { ...t.body, rows: inGroup() && !inSide() ? t.body.rows : [], cols: [], measures: [{ agg: "lots" }] };
    if (!inGroup() && p.visual !== "kpi" && p.visual !== "none") p.visual = "kpi";
    await loadFields();
    if (inSide()) t.body.rows = [sideKey()];
    changed();
  }

  /* ---- 別のデータを合わせる（版 3.40.0。link）: 全体（軸のそろえ方・役割・作り方・差と達成率）とデータ（1〜4） ---- */
  /** このデータの軸の既定: ほかのデータの軸と同じ種類（日・設備）があればそれ、無ければ作業日・設備・日付の列 */
  function sideKey() {
    const other = (p.link.sides.find((x, i) => i !== gi && x.key) || {}).key, sp = special().map((x) => x.column), dates = ((fields && fields.fields) || []).filter((f) => f.date).map((f) => f.column);
    const day = other && (other.column === "@workday" ? !other.part : other.part === "date");
    if (other && other.column === "@equip" && sp.includes("@equip")) return { column: "@equip", part: "" };
    if (day || !other) { if (sp.includes("@workday")) return { column: "@workday", part: "" }; if (dates[0]) return { column: dates[0], part: "date" }; }
    if (other && (fieldOf(other.column) || sp.includes(other.column))) return { ...other };
    return sp.includes("@equip") ? { column: "@equip", part: "" } : dates[0] ? { column: dates[0], part: "date" } : null;
  }
  /** いまの組みを 1 つ目のデータ（目標）にして、2 つ目（実績。作業実績）を足す */
  function startLink() {
    const b = p.body || {}, key = (b.rows || [])[0] || (special().some((x) => x.column === "@workday") ? { column: "@workday", part: "" } : { column: "@equip", part: "" });
    const first = { title: "", role: "target", build: "as", source: p.source, equip: p.equip || "", equips: p.equips || [], filters: p.filters || [], search: p.search || "",
      period: p.period || null, basis: p.basis || "work", ...(p.calc ? { calc: p.calc } : {}), key, measure: (b.measures || [])[0] || { agg: "lots" } };
    p.link = { sides: [first, { ...TPA.clone(first), role: "actual", source: "work", equip: "", equips: [], filters: [], search: "", calc: undefined, measure: { agg: "lots" } }] };
    delete p.link.sides[1].calc; delete p.egroup; delete p.esplit;
    if (!["diag45", "time", "line", "area", "column", "bar", "none", "scatter"].includes(p.visual)) p.visual = "diag45";
    host.toast("① 目標・② 実績 にしました（上の札で切り替えて決めます）");
    gi = 1; t = groupView(p.link.sides[1]); fields = null; fieldsKey = "";
    loadFields().then(() => { if (!t.body.rows.length) { t.body.rows = [sideKey()].filter(Boolean); } changed(); });
  }
  /** 合わせるのをやめる（1 つ目のデータの組みで、ふつうのパネルに戻す） */
  function unlink() {
    const x = p.link.sides[0];
    Object.assign(p, { source: x.source, equip: x.equip || "", equips: x.equips || [], filters: x.filters || [], search: x.search || "", period: x.period || null, basis: x.basis || "work",
      ...(x.calc ? { calc: x.calc } : {}), body: { ...(p.body || {}), rows: x.key ? [x.key] : [], cols: [], measures: [x.measure || { agg: "lots" }] } });
    delete p.link; gi = -1; t = p;
  }
  /** ① の頭の 2 択（数える物: 1 つのデータ／別のデータと合わせる）。合わせた後も同じ所に残す（押すと 1 つに戻る） */
  const linkPick = () => `<div class="de-row de-linkpick"><span class="de-l">数える物</span>${segs("linkmode", [["one", "1 つのデータ", "1 つのデータの数を出します"], ["link", "別のデータと合わせる（目標と実績）", "別のデータ（元・条件・値）の数を同じ軸でそろえて 1 つのパネルに出します（45度線管理図など）"]], isLink() ? "link" : "one", "数える物")}</div>`;
  /** 全体の札: データごとのカード（役割の色の帯・役割・軸・値・作り方・グラフのどこに出るか）と、差・達成率。
      2026-10-dashlink の 2 回目で 1 位の R4（表 → カード。横軸／縦軸を読める大きさで） */
  function linkHtml() {
    const ss = p.link.sides, ex = new Set(p.link.extra || []), n = "①②③④";
    const both = ss.some((x) => x.role === "target") && ss.some((x) => x.role === "actual");
    const diag = ["diag45", "scatter"].includes(p.visual);
    const where = (r) => (r === "target" ? (diag ? "→ 45度線の<b>横軸</b>" : "→ グラフの<b>棒</b>") : r === "actual" ? (diag ? "→ 45度線の<b>縦軸</b>" : "→ グラフの<b>線</b>") : "→ 並べて比べる");
    const keyText = (k) => (k ? dimLabel(k) + (k.part ? `（${(k.column === "@workday" ? WORKDAY_NAME : PART_NAME)[k.part] || k.part}）` : "") : "（軸を選ぶ）");
    const cards = ss.map((x, i) => `<div class="de-lnkcard" style="--rc:${ROLE_COLOR[x.role || ""]}"><button type="button" class="de-lnk-go" data-de-tab="${i}" title="このデータを組む">${n[i]} ${esc(x.title || (srcOf(x.source) || {}).name || "")}</button>`
      + `<div class="de-lnkrow">${segs(`role-${i}`, ROLES, x.role || "", "役割")}</div>`
      + `<div class="de-lnkkv"><span>軸</span><b>${esc(keyText(x.key))}</b><span>値</span><b>${esc(P.measName(x.measure || { agg: "lots" }))}</b></div>`
      + `<div class="de-lnkrow">${segs(`build-${i}`, BUILDS, x.build || "as", "作り方")}</div><div class="de-lnkwhere">${where(x.role || "")}</div></div>`).join("");
    return linkPick() + `<div class="de-row de-top"><span class="de-l">合わせ方</span><div class="de-lnk"><div class="de-lnkc">${cards}</div>`
      + `<small class="de-hint">軸の値（日・年月・設備名・字）が同じ行をそろえます。カードの名前を押すと、そのデータを組みます</small></div></div>`
      + `<div class="de-row"><span class="de-l">足す値</span><label class="pv-ck"${both ? "" : ' title="目標と実績を 1 つずつ決めると使えます"'}><input type="checkbox" data-de-extra="diff"${ex.has("diff") ? " checked" : ""}${both ? "" : " disabled"}>差（実績−目標）</label>`
      + `<label class="pv-ck"><input type="checkbox" data-de-extra="rate"${ex.has("rate") ? " checked" : ""}${both ? "" : " disabled"}>達成率（実績÷目標 %）</label></div>`;
  }
  function addGroup() {
    const gs = parts(), what = isLink() ? "合わせるデータ" : "列のまとまり";
    if (gs.length >= MAX_GROUPS) { host.toast(`${what}は ${MAX_GROUPS} つまでです`); return; }
    const last = gs[gs.length - 1] || {};
    if (isLink()) gs.push({ title: "", role: "", build: "as", source: last.source || "work", equip: "", filters: [], search: "", period: null, basis: "work", key: last.key || null, measure: { agg: "lots" } });
    else gs.push({ title: "", source: last.source || "work", equip: "", filters: [], search: "", period: null, basis: "work", measure: { agg: "lots" }, cols: [], look: "num", total: true, zero: false, color: "" });
    delete p.legacy; host.onChange(TPA.clone(p)); select(gs.length - 1);
  }
  function moveGroup(i, d) {
    const gs = parts(), j = i + d; if (j < 0 || j >= gs.length) return;
    [gs[i], gs[j]] = [gs[j], gs[i]];
    const o = p.order; if (o) { if (o.group === i) o.group = j; else if (o.group === j) o.group = i; }
    gi = j; t = groupView(gs[gi]); changed(false);
  }
  function removeGroup(i) {
    const gs = parts();
    if (gs.length <= (isLink() ? 2 : 1)) { host.toast(isLink() ? "合わせるデータは 2 つ以上要ります（やめるときは「全体」の「合わせるのをやめる」）" : "まとまりは 1 つ以上要ります（表をやめるときは、ほかの形を選びます）"); return; }
    gs.splice(i, 1);
    if (p.order) p.order.group = Math.min(p.order.group, gs.length - 1);
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

  /* ---- 計算列をここで作る（版 3.39.0。要望 5）: 名前と式（式ビルダーで組み立てるか、式を書く）。パネルの計算列（calc.own）として持つ
     （一覧の表示列には入れない。一覧の計算列と同じ書き方・同じ答え: list-formula.js / services/formula.py） ---- */
  function calcHtml() {
    if (!calcEdit) return "";
    const chk = calcEdit.expr.trim() && window.WL ? WL.formula.check(calcEdit.expr) : null;
    const dup = calcEdit.name.trim() && calcEdit.name.trim() !== calcEdit.was && ((fields && fields.fields) || []).some((f) => f.column === calcEdit.name.trim());
    const ok = calcEdit.name.trim() && chk && chk.ok && !dup;
    return `<div class="de-calc" role="dialog" aria-label="計算列を作る"><div class="de-calchead"><b>${calcEdit.was ? "計算列を直す" : "計算列を作る"}</b><small>このパネルだけの列です。左のカラムの札に並び、行・列・値・条件に使えます</small></div>`
      + `<label class="de-row"><span class="de-l">名前</span><input id="deCalcName" value="${esc(calcEdit.name)}" maxlength="60" placeholder="例: 板厚の差" aria-label="計算列の名前"></label>`
      + `<div class="de-row de-top"><span class="de-l">式</span><textarea id="deCalcExpr" rows="2" spellcheck="false" placeholder="例: [出側板厚] - [入側板厚]" aria-label="式">${esc(calcEdit.expr)}</textarea></div>`
      + `<div class="de-row"><span class="de-l"></span><small class="de-hint${chk && !chk.ok ? " is-warn" : ""}" id="deCalcMsg">${dup ? "同じ名前の列があります。別の名前にしてください" : chk ? (chk.ok ? "✓ 読める式です" : esc(chk.error)) : "列は [名前]。＋ − × ÷・文字は '…'。下の「部品から作る」でも組み立てられます"}</small></div>`
      + `<details class="de-fbwrap"${calcEdit.expr ? "" : " open"}><summary>部品から作る（式ビルダー）</summary><div class="fb" id="deCalcFb"></div></details>`
      + `<div class="de-calcacts">${calcEdit.was ? '<button type="button" class="pv-btn is-danger" data-de-calcdel>この計算列を消す</button>' : ""}<span class="db-sp"></span>`
      + `<button type="button" class="btn-ghost" data-de-calcx>やめる</button><button type="button" class="btn-primary" data-de-calcok${ok ? "" : " disabled"}>${calcEdit.was ? "直す" : "作る"}</button></div></div>`;
  }
  function openCalc(name = "") {
    const own = ownOf(t.calc);
    calcEdit = { was: name, name, expr: name ? own[name] || ctx.formulas[name] || "" : "" };
    paintCalc();
  }
  function paintCalc() {
    const box = $("#deCalcBox"); if (!box) return;
    box.innerHTML = calcHtml(); box.hidden = !calcEdit;
    if (!calcEdit) return;
    const fb = $("#deCalcFb");
    if (fb && window.FormulaBuilder) window.FormulaBuilder.mount(fb, { kind: "calc", kinds: ["calc", "if", "join", "cut", "fill", "round"],
      columns: () => ((fields && fields.fields) || []).filter((f) => !f.error && f.column !== calcEdit.was).map((f) => f.column), preview: () => [],
      apply: (f, how) => { const ta = $("#deCalcExpr"); calcEdit.expr = how === "insert" ? ta.value.slice(0, ta.selectionStart) + f + ta.value.slice(ta.selectionEnd) : f; paintCalc(); } });
    const n = $("#deCalcName"); if (n && !calcEdit.name) n.focus();
  }
  /** 計算列を置く（名前を変えたら、使っている段・値・条件の列の名前も替える）・消す */
  async function saveCalc(remove = false) {
    const name = calcEdit.name.trim(), was = calcEdit.was, own = ownOf(t.calc);
    if (was) delete own[was];
    if (!remove) own[name] = calcEdit.expr.trim();
    const swap = (c) => (c === was ? (remove ? null : name) : c);
    if (was) {
      const b = t.body;
      ["rows", "cols"].forEach((r) => { b[r] = b[r].map((d) => ({ ...d, column: swap(d.column) })).filter((d) => d.column); });
      b.measures = b.measures.map((m) => (m.column ? { ...m, column: swap(m.column) } : m)).filter((m) => m.column !== null);
      if (!b.measures.length) b.measures = [{ agg: "lots" }];
      t.filters = t.filters.map((f) => ({ ...f, column: swap(f.column) })).filter((f) => f.column);
    }
    const cur = t.calc || { formulas: {}, names: {} }, formulas = { ...cur.formulas };
    if (was) delete formulas[was];
    Object.assign(formulas, own);
    t.calc = { formulas, names: cur.names || {}, own: Object.keys(own) };
    if (!t.calc.own.length) delete t.calc.own;
    calcEdit = null; paintCalc();
    fieldsKey = ""; await loadFields();
    changed();
    host.toast(remove ? `計算列「${was}」を消しました` : `計算列「${name}」を${was ? "直しました" : "作りました。左のカラムの札から使えます"}`);
  }

  async function loadFields() {
    if (parts() && gi < 0) return;
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
    const ownList = (t.calc && t.calc.own) || [];
    const b = t.body, used = (c) => (b.rows.some((d) => d.column === c) ? "rows" : b.cols.some((d) => d.column === c) ? "cols" : "");
    const rowBtn = (c, on) => (inGroup() && !inSide() ? "<i></i>" : btn("rows", c, on, inSide() ? 'title="このデータの軸（そろえる段）にします"' : ""));
    const colBtn = (c, on) => (inSide() ? "<i></i>" : btn("cols", c, on));
    const meas = (agg, col = "") => b.measures.some((m) => m.agg === agg && (m.column || "") === col);
    const ql = q.trim().toLowerCase(), hit = (n) => !ql || n.toLowerCase().includes(ql);
    let html = special().filter((x) => hit(x.name)).map((x) => `<div class="pv-f is-special${used(x.column) ? " is-used" : ""}" title="${esc(x.hint || "")}"><span><b>${esc(x.name)}</b><small>${esc(x.hint || "")}</small></span>`
      + `${rowBtn(x.column, used(x.column) === "rows")}${colBtn(x.column, used(x.column) === "cols")}<i></i></div>`).join("");
    if (hit("ロット数 件数")) {
      html += `<div class="pv-f is-special${meas("lots") ? " is-used" : ""}"><span><b>ロット数</b><small>${isWork() ? "作業の数（作業開始が同じ行は 1）" : "重複の無いロット番号"}</small></span><i></i><i></i>${btn("vals", "@lots", meas("lots"))}</div>`
        + `<div class="pv-f is-special${meas("count") ? " is-used" : ""}"><span><b>件数</b><small>行の数</small></span><i></i><i></i>${btn("vals", "@count", meas("count"))}</div>`;
    }
    html += fields.fields.filter((f) => hit(f.column)).map((f) => {
      const c = f.column, u = used(c), anyVal = b.measures.some((m) => m.column === c);
      if (f.error) return `<div class="pv-f is-off" title="${esc(ctx.formulas[c] || "")}"><span><b>${esc(c)}<small class="sx-calc">式</small></b><small>${esc(f.error)}（一覧の「表示列」で直す）</small></span><i></i><i></i><i></i></div>`;
      const sub = (f.calc ? "式の列 · " : "") + (f.date ? "日付" : f.numeric ? `数${f.many ? "" : ` · ${f.kinds} 種類`}` : f.many ? "1,000 種類以上" : `${f.kinds} 種類`);
      const tip = f.calc ? `${c}（計算列。一覧の表示列で作った式）\n${ctx.formulas[c] || ""}` : c;
      const mine = ownList.includes(c);
      return `<div class="pv-f${u || anyVal ? " is-used" : ""}${f.calc ? " is-calc" : ""}" title="${esc(tip)}"><span><b>${esc(c)}${f.calc ? (mine ? `<button type="button" class="sx-calc is-own" data-de-calcopen="${esc(c)}" title="このパネルで作った計算列。押すと直せます">式 ✎</button>` : '<small class="sx-calc">式</small>') : ""}</b><small>${mine ? "このパネルの式 · " : ""}${sub.replace(/^式の列 · /, "")}</small></span>`
        + rowBtn(c, u === "rows") + colBtn(c, u === "cols") + (f.numeric ? btn("vals", c, anyVal, 'title="合計を値に足します（値の札で平均・中央値・標準偏差などの統計に替えられます）"')
          : btn("vals", c, anyVal, 'title="種類の数（重複の無い値の数）を値に足します"')) + "</div>";
    }).join("");
    return html || '<p class="pv-none">当たるカラムがありません</p>';
  }
  function dimChip(d, role, i) {
    const ps = partsOf(d.column), pn = d.column === "@workday" ? WORKDAY_NAME : d.column === "@egroup" ? { "@panel": "このパネルのグループ", "": "（まとめ方なし）" } : PART_NAME;
    const fixed = isBoard() && inGroup() && role === "rows";
    const sel = (ps.length > 1 || d.column === "@egroup") && !fixed ? `<select data-de-part="${role}" data-i="${i}" aria-label="まとめ方">${ps.map((x) => `<option value="${esc(x)}"${(d.part || "") === x ? " selected" : ""}>${esc(pn[x] || x)}</option>`).join("")}</select>` : "";
    return `<span class="pv-chip ${role === "rows" ? "r" : "c"}${fixed ? " is-fixed" : ""}"${fixed ? ' title="行の段は表全体で 1 つです（「表全体」で変えます）"' : ""}><b>${esc(dimLabel(d))}</b>${sel}${fixed ? "" : `<button type="button" data-de-x="${role}" data-i="${i}" aria-label="「${esc(dimLabel(d))}」を外す">×</button>`}</span>`;
  }
  /** 値の札: 名前・集計のしかた（よく使う／統計／種類。数でない列は種類の数だけ）・決める数（p%点の p・Cpk の規格）・表し方（割合・累計など） */
  function measChip(m, i) {
    const num = m.column && isNum(m.column), grp = { basic: "よく使う", stat: "統計", kind: "種類" };
    const opts = (g) => C.AGGS.filter((a) => a.g === g && (num || a.any)).map((a) => `<option value="${a.k}"${m.agg === a.k ? " selected" : ""} title="${esc(a.tip || "")}">${a.n}</option>`).join("");
    const sel = m.agg === "count" || m.agg === "lots" ? "" : `<select data-de-agg="${i}" aria-label="集計のしかた">${Object.entries(grp).map(([g, n]) => { const o = opts(g); return o ? `<optgroup label="${n}">${o}</optgroup>` : ""; }).join("")}</select>`;
    const par = m.agg === "pct" ? `<label class="de-par">p<input type="number" min="1" max="99" value="${m.p || 90}" data-de-mp="${i}" aria-label="何%点か"></label>`
      : m.agg === "cpk" ? `<label class="de-par">下限<input type="number" step="any" value="${m.lsl ?? ""}" data-de-mlsl="${i}" aria-label="規格の下限"></label><label class="de-par">上限<input type="number" step="any" value="${m.usl ?? ""}" data-de-musl="${i}" aria-label="規格の上限"></label>` : "";
    const show = `<select class="de-show" data-de-show="${i}" aria-label="表し方" title="表し方（割合・累計・前との差・順位）">${C.SHOWS.map(([k, n]) => `<option value="${k}"${(m.show || "") === k ? " selected" : ""}>${k ? n : "表し方"}</option>`).join("")}</select>`;
    const name = m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : m.column;
    return `<span class="pv-chip v"><b>${esc(name)}</b>${sel}${par}${show}${inGroup() ? "" : `<button type="button" data-de-mx="${i}" aria-label="「${esc(P.measName(m))}」を外す">×</button>`}</span>`;
  }
  function sentenceHtml() {
    const b = t.body, slot = (role, html, ph) => `<span class="pv-slot" data-role="${role}">${html || `<span class="pv-ph">${ph}</span>`}</span>`;
    const kpi = t.visual === "kpi";
    if (inSide()) return `<div class="pv-sent de-sent">${slot("rows", b.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］で軸を選ぶ")}<span class="pv-w">ごとの</span>`
      + `${slot("vals", b.measures.map(measChip).join(""), "ロット数")}<span class="pv-w">を合わせる</span></div>`;
    // 小計（版 3.40.0。要望 5）: 表で行の段が 2 つ以上（設備グループ → 設備 など）。行の段の文のすぐ下（何ごとの小計かを、段の札の近くで決める）
    const sub = !inGroup() && !isLink() && p.visual === "none" && (b.rows || []).length > 1
      ? `<div class="de-subrow"><label class="pv-ck" title="行の段の上の段ごとに小計の行を出します"><input type="checkbox" data-de-sub${b.sub ? " checked" : ""}>${esc(dimLabel(b.rows[0]))}ごとの小計を出す</label></div>` : "";
    return `<div class="pv-sent de-sent">${kpi ? '<span class="pv-w">全体の</span>' : `${slot("rows", b.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］")}<span class="pv-w">ごとに、</span>`
      + `${slot("cols", b.cols.map((d, i) => dimChip(d, "cols", i)).join(""), "＋ 列")}<span class="pv-w">別の</span>`}`
      + `${slot("vals", b.measures.map(measChip).join(""), "ロット数")}<span class="pv-w">を出す</span></div>${sub}`;
  }
  /** 形の札（版 3.39.0 で 25。目的の行に並べる: 数と表・推移を見る・比べる・内訳・ばらつき・関係。集計表のグラフの形の面と同じまとまり）。
      合わせた表は、表全体の札で「選んだ形の札 1 枚＋形を変える…」に畳む（押すと全部の札が開く。2026-10-board の 3 回目で決めた CF） */
  function visualsHtml() {
    if (inGroup()) return "";
    const ico = (x) => (x.icon && !C.get(x.k) ? `<svg class="pv-ico" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="${x.icon}"/></svg>` : C.iconSvg(x.k, 17));
    const btn = (x) => `<button type="button" class="pv-cbtn${p.visual === x.k ? " on" : ""}" role="radio" aria-checked="${p.visual === x.k}" data-de-vis="${x.k}" title="${esc(x.tip || "")}">${ico(x)}<span>${esc(x.n)}</span></button>`;
    const rows = [["num", "数と表", EXTRA]].concat(C.GROUPS.filter(([g]) => g !== "table").map(([g, n]) => [g, n, C.DEFS.filter((x) => x.g === g)]));
    const grid = `<div class="de-vis" role="radiogroup" aria-label="形" data-open="${formOpen}">${rows.map(([g, n, xs]) => `<div class="de-vrow"><span class="de-vg">${esc(n)}</span><span class="de-vi">${xs.map(btn).join("")}</span></div>`).join("")}</div>`;
    if (!isBoard()) {
      // 向く形の行（版 3.39.0）: 選んだ形と、いまの組み方（行・列・値）に向く形を名前つきで 4 つまで。全部の形は「すべての形…」で開く
      const f = fitInfo(), all = EXTRA.concat(C.DEFS.filter((x) => x.k !== "none"));
      const cur = all.find((x) => x.k === p.visual), fit = all.filter((x) => x.k !== p.visual && x.k !== "board" && (x.fit ? !x.fit(f) : x.k === "none" ? f.rows : !f.rows)).slice(0, 4);
      const row = `<div class="de-vfit"><span class="de-l">形</span>${cur ? btn(cur) : ""}${fit.length ? `<span class="de-vfn">向く形</span>${fit.map(btn).join("")}` : ""}`
        + `<button type="button" class="pv-btn de-vall" data-de-formmore aria-expanded="${formOpen}">${formOpen ? "閉じる" : `すべての形（${all.length}）…`}</button></div>`;
      return row + grid;
    }
    const me = EXTRA.find((x) => x.k === "board");
    return `<div class="de-row de-form"><span class="de-l">形</span><span class="pv-cbtn on de-formcard" title="${esc(me.tip)}">${ico(me)}<span>${esc(me.n)}</span></span>`
      + `<button type="button" class="pv-btn" data-de-formmore aria-expanded="${formOpen}">${formOpen ? "閉じる" : "形を変える…"}</button><small class="de-hint">行をそろえて、データの数を横に並べる</small></div>`
      + (formOpen ? grid : "");
  }
  /** いまの組み方（形の登録 DEFS の fit に渡す形。一覧の集計表の fitInfo と同じ鍵） */
  function fitInfo() {
    if (isLink()) {        // 合わせたデータ: 値＝データの数（どれも数）。軸が日なら時の形
      const ss = p.link.sides, k = ss[0].key;
      return { rows: 1, cols: 0, meas: ss.length, numMeas: ss.length, addMeas: ss.length, additive: true, time: !!k && C.isTimeDim(k), bin: false };
    }
    const b = p.body || {}, r0 = (b.rows || [])[0], ms = b.measures && b.measures.length ? b.measures : [{ agg: "lots" }];
    return { rows: (b.rows || []).length, cols: (b.cols || []).length, meas: ms.length, numMeas: ms.filter((m) => m.column && isNum(m.column)).length,
      addMeas: ms.filter((m) => C.ADDITIVE.has(m.agg)).length, additive: C.ADDITIVE.has(ms[0].agg), time: !!r0 && C.isTimeDim(r0), bin: !!r0 && r0.part === "bin" };
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
  /** 選びの札（ラジオを札に見せる）。name … data-de-<name> */
  const segs = (name, list, cur, label) => `<span class="de-segs" role="radiogroup" aria-label="${esc(label)}">${list.map(([k, n, tip]) =>
    `<label class="de-seg${(cur || "") === k ? " on" : ""}"${tip ? ` title="${esc(tip)}"` : ""}><input type="radio" name="de-${name}" value="${k}" data-de-${name}${(cur || "") === k ? " checked" : ""}>${esc(n)}</label>`).join("")}</span>`;
  /** 見せ方（形の札のすぐ下）。まとまりは 棒・濃淡・数・積み上げ帯・割合・点・信号・小さな線・色・計の列・0 の印・しきい値。ほかはパネルの枠（5 つ）と、数字の形（目標） */
  function lookHtml() {
    if (inSide()) return "";
    if (!inGroup()) {
      const frame = p.frame || (p.emph ? "emph" : "card"), fm = p.fmt || {};
      const frames = `<span class="de-frames" role="radiogroup" aria-label="パネルの見せ方">${FRAMES.map(([k, n, tip]) => `<label class="de-frame${frame === k ? " on" : ""}" title="${esc(tip)}"><input type="radio" name="de-frame" value="${k}" data-de-frame${frame === k ? " checked" : ""}><i class="fr-${k}" aria-hidden="true"></i>${n}</label>`).join("")}</span>`;
      const kpi = p.visual === "kpi" ? `<div class="de-row"><span class="de-l">数字</span>${segs("kpilook", KPI_LOOKS, fm.kpi || "num", "数字の形")}`
        + (fm.kpi === "bar" || fm.kpi === "gauge" ? `<label class="pv-ck">目標<input type="number" step="any" data-de-target value="${fm.target ?? ""}" class="de-n2" aria-label="目標の値" placeholder="例 30"></label>${fm.target ? "" : '<small class="de-hint is-warn">目標を入れると出ます</small>'}` : "") + "</div>" : "";
      return `<div class="de-row"><span class="de-l">見せ方</span>${frames}</div>${kpi}`;
    }
    const g = p.groups[gi], base = P.colorOf(g.source), hasCols = (g.cols || []).length > 0;
    const looks = LOOKS.filter(([, , , cols]) => !cols || hasCols).map(([k, n, tip]) => [k, n, tip]);
    const colors = GROUP_COLORS.map((c) => `<button type="button" class="de-sw${(g.color || "") === c ? " on" : ""}" data-de-color="${c}" style="--sw:${c || base}" aria-label="${c ? `色 ${c}` : "データの種類の色"}" aria-pressed="${(g.color || "") === c}" title="${c ? "この色にする" : "データの種類の色（仕掛＝藍・作業実績＝青緑・品質データ＝琥珀）"}">${c ? "" : "自"}</button>`).join("");
    const lim = g.limits || {};
    const limits = g.look === "signal" ? `<div class="de-row"><span class="de-l"></span><label class="pv-ck">注意<input type="number" step="any" data-de-lwarn value="${lim.warn ?? ""}" class="de-n2" aria-label="注意のしきい値"></label>`
      + `<label class="pv-ck">要対応<input type="number" step="any" data-de-lalert value="${lim.alert ?? ""}" class="de-n2" aria-label="要対応のしきい値"></label>`
      + `<select data-de-ldir aria-label="悪い向き"><option value="high"${lim.dir !== "low" ? " selected" : ""}>大きいほど悪い</option><option value="low"${lim.dir === "low" ? " selected" : ""}>小さいほど悪い</option></select></div>` : "";
    // 見せ方の札（8 つ）は、パネルの見せ方（枠）と同じ絵つきの札。字は折らず、入らなければ札ごと次の段へ（作った後の採点の指摘）
    const lookChips = `<span class="de-frames de-looks" role="radiogroup" aria-label="見せ方">${looks.map(([k, n, tip]) => `<label class="de-frame${g.look === k ? " on" : ""}" title="${esc(tip)}"><input type="radio" name="de-look" value="${k}" data-de-look${g.look === k ? " checked" : ""}><i class="lk lk-${k}" aria-hidden="true"></i>${esc(n)}</label>`).join("")}</span>`;
    return `<div class="de-row de-top"><span class="de-l">見せ方</span>${lookChips}</div>`
      + `<div class="de-row"><span class="de-l">色</span><span class="de-sws" aria-label="色">${colors}</span></div>${limits}`
      + `<div class="de-row"><span class="de-l"></span>${hasCols ? `<label class="pv-ck"><input type="checkbox" data-de-total${g.total ? " checked" : ""}>計の列</label>` : ""}`
      + `<label class="pv-ck" title="ほかのまとまりに数があるのに、このまとまりが 0 の行に印を付け、表の上に名前を出します"><input type="checkbox" data-de-zero${g.zero ? " checked" : ""}>0 の行に印</label>`
      + `<label class="pv-ck de-gt">見出し<input data-de-gtitle value="${esc(g.title || "")}" placeholder="${esc(P.groupTitle(g, null))}" maxlength="40" aria-label="まとまりの見出し"></label></div>`;
  }
  /* ---- 書式（版 3.39.0。要望 7・8）: 数値ラベル・横軸（日付の形・字の向き）・数の形（桁・単位）・縦軸の範囲・凡例・補助線・字の大きさ・基準線・色 ---- */
  /** いまの答えの系列（色を決められる名前）: 列の段があれば列の葉、1 系列で行が少なければ行の葉、ほかは値 */
  function seriesNames() {
    const d = host.answer && host.answer();
    if (!d || !d.cells || !d.dims) return [];
    const m = C.buildModel(d, { sub: false, grand: false });
    if (m.nc) return m.cols.filter((c) => c.type === "data").slice(0, 12).map((c) => m.colName(c));
    const rows = m.rows.filter((r) => r.type === "data");
    if (["column", "bar", "lollipop", "donut", "treemap", "pareto", "bubble", "box", "violin"].includes(p.visual) && rows.length <= 16) return rows.map((r) => m.rowName(r));
    return d.measures.map((x) => P.measName(x));
  }
  function fmtHtml() {
    if (inGroup() || isBoard() || p.visual === "none") return "";
    const fm = p.fmt || {}, kpi = p.visual === "kpi";
    const sel = (name, list, cur, label) => `<select data-de-f${name} aria-label="${esc(label)}">${list.map(([k, n]) => `<option value="${k}"${String(cur ?? "") === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    const digits = sel("digits", [["", "自動"], ["0", "整数"], ["1", "0.1"], ["2", "0.01"], ["3", "0.001"]], fm.digits == null ? "" : String(fm.digits), "小数の桁");
    const head = `<button type="button" class="de-fmthead" data-de-fmtopen aria-expanded="${fmtOpen}"><b>書式</b><small>${fmtSummary(fm)}</small><i aria-hidden="true">${fmtOpen ? "▴" : "▾"}</i></button>`;
    if (!fmtOpen) return head;
    if (kpi) return head + `<div class="de-fmt"><div class="de-row"><span class="de-l">数の形</span>${digits}${sel("unit", UNITS, fm.unit || "", "単位")}</div></div>`;
    const pal = P.PALETTES, cur = fm.palette || "";
    const palBtn = (k, n, cs) => `<button type="button" class="de-pal${cur === k ? " on" : ""}" data-de-pal="${k}" aria-pressed="${cur === k}" title="${esc(n)}"><span>${cs.slice(0, 5).map((c) => `<i style="background:${c}"></i>`).join("")}</span>${esc(n)}</button>`;
    const pals = palBtn("", "データの種類", P.seriesColors({ source: p.source })) + Object.entries(pal).map(([k, x]) => palBtn(k, x.n, x.c)).join("");
    // 合わせたデータは役割の色（グラフ・札と同じ。3 回目の採点: 見本だけ別の色だった）
    const d0 = host.answer && host.answer();
    const names = seriesNames(), colors = isLink() && d0 && d0.measures ? d0.measures.map((x) => P.ROLE_COLOR[x.role] || "#5a6f77") : P.seriesColors(p);
    const named = names.length ? names.map((n, i) => { const c = (fm.colors || {})[n]; return `<label class="de-scol${c ? " is-set" : ""}" title="${esc(n)}"><input type="color" value="${c || colors[i % colors.length]}" data-de-scol="${esc(n)}" aria-label="「${esc(n)}」の色"><span>${esc(n)}</span>${c ? `<button type="button" class="icon-btn" data-de-scolx="${esc(n)}" aria-label="「${esc(n)}」の色を戻す">×</button>` : ""}</label>`; }).join("") : '<small class="de-hint">数え終えると、系列の名前が並びます</small>';
    const refs = (fm.refs || []).map((r, i) => `<div class="de-ref" data-i="${i}"><input type="number" step="any" value="${r.value}" data-de-refv aria-label="基準線の値" class="de-n2"><input value="${esc(r.label || "")}" data-de-refl maxlength="20" placeholder="名前（目標・上限など）" aria-label="基準線の名前">`
      + `<span class="de-sws">${REF_COLORS.map((c) => `<button type="button" class="de-sw${(r.color || REF_COLORS[0]) === c ? " on" : ""}" style="--sw:${c}" data-de-refc="${c}" aria-label="色 ${c}"></button>`).join("")}</span><button type="button" class="icon-btn" data-de-refdel="${i}" aria-label="この基準線を外す">×</button></div>`).join("");
    return head + `<div class="de-fmt">`
      + `<div class="de-row"><span class="de-l">数値</span>${segs("flabels", LABELS, fm.labels || "", "数値ラベル")}</div>`
      + `<div class="de-row"><span class="de-l">横軸</span>${sel("xdate", XDATES, fm.xdate || "", "横軸の日付の形")}${segs("fxrot", XROTS, fm.xrot || "", "横軸の字の向き")}</div>`
      + `<div class="de-row"><span class="de-l">数の形</span>${digits}${sel("unit", UNITS, fm.unit || "", "単位")}</div>`
      + `<div class="de-row"><span class="de-l">縦軸</span><label class="pv-ck">最小<input type="number" step="any" data-de-fymin value="${fm.ymin ?? ""}" placeholder="自動" class="de-n2"></label><label class="pv-ck">最大<input type="number" step="any" data-de-fymax value="${fm.ymax ?? ""}" placeholder="自動" class="de-n2"></label>`
      + `<label class="pv-ck"><input type="checkbox" data-de-fgrid${fm.grid === false ? "" : " checked"}>補助線</label></div>`
      + `<div class="de-row"><span class="de-l">凡例</span>${segs("flegend", LEGENDS, fm.legend || "", "凡例")}<span class="de-l2">字</span>${segs("fsize", SIZES, fm.size || "", "字の大きさ")}</div>`
      + `<div class="de-row de-top"><span class="de-l">基準線</span><div class="de-refs">${refs}<button type="button" class="pv-btn" data-de-refadd${(fm.refs || []).length >= 4 ? " disabled" : ""}>＋ 基準線（目標・規格）</button></div></div>`
      + `<div class="de-row de-top"><span class="de-l">色の組</span><div class="de-pals">${pals}</div></div>`
      + `<div class="de-row de-top"><span class="de-l">系列の色</span><div class="de-scols">${named}</div></div></div>`;
  }
  /** 書式の要約（畳んだときに、何が効いているかを見せる） */
  function fmtSummary(fm) {
    const out = [];
    if (fm.labels) out.push(`数値 ${(LABELS.find((x) => x[0] === fm.labels) || ["", ""])[1]}`);
    if (fm.xdate) out.push(`日付 ${(XDATES.find((x) => x[0] === fm.xdate) || ["", ""])[1]}`);
    if (fm.digits != null || fm.unit) out.push("数の形");
    if (fm.ymin != null || fm.ymax != null) out.push("縦軸");
    if ((fm.refs || []).length) out.push(`基準線 ${fm.refs.length}`);
    if (fm.palette) out.push(P.PALETTES[fm.palette].n);
    if (fm.colors && Object.keys(fm.colors).length) out.push(`色 ${Object.keys(fm.colors).length}`);
    return out.length ? esc(out.join("・")) : "既定のまま";
  }
  /** 書式を 1 つ変える（既定に戻す物は消す） */
  function setFmt(k, v) {
    const fm = { ...(p.fmt || {}) };
    if (v === "" || v == null || (k === "grid" && v === true)) delete fm[k]; else fm[k] = v;
    if (Object.keys(fm).length) p.fmt = fm; else delete p.fmt;
    changed(false);
  }
  function sortHtml() {
    if (t.visual === "kpi" || inGroup()) return "";
    // 小計（版 3.40.0。要望 5）: 表で行の段が 2 つ以上（設備グループ → 設備 など）
    return `<div class="de-row"><label class="de-l">並べ方</label><select data-de-sort aria-label="並べ方">${[["", "決まった順（名前・日付）"], ["desc", "値の大きい順"], ["asc", "値の小さい順"]].map(([k, n]) => `<option value="${k}"${(p.sort || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + `<label class="pv-ck" title="0＝パネルに入るだけ">上位<input type="number" min="0" max="60" data-de-top value="${p.top || 0}" class="de-n" aria-label="上位いくつ（0＝パネルに入るだけ）"></label><small class="de-hint">0＝入るだけ</small></div>`;
  }
  /* ---- 設備（版 3.39.0。要望 2・9）: 複数選ぶ（チェックの並び。dashboard-filter.js と同じ部品）と、まとめる（合算・このパネルのグループ・マスタ） ---- */
  /** 設備を選ぶ物（ふつうのパネル・まとまり＝組む物 t、合わせた表の表全体＝パネル p） */
  const eqHost = () => (isBoard() && gi < 0 ? p : t);
  function setEquips(list) {
    const h = eqHost();
    if (list.length) h.equips = list; else delete h.equips;
    if (h === t && inGroup()) pushGroup();
    changed(false);
  }
  const eqText = (list) => (!list || !list.length ? "すべての設備" : `${list.slice(0, 3).join("・")}${list.length > 3 ? ` ほか ${list.length - 3}` : ""}`);
  /** 選べる設備（その元で数えた設備と件数。元ごとに 1 回） */
  async function loadEquips() {
    const base = isBoard() && gi < 0 ? (p.groups[0] || {}) : t, key = JSON.stringify([base.source, base.equip || "", base.filters || []]);
    if (eqKey === key && eqItems) return;
    eqKey = key; eqItems = null;
    try { const items = await Q.equipsOf({ ...base, visual: "none" }); if (eqKey === key) eqItems = items; } catch (_) { if (eqKey === key) eqItems = []; }
    paint(false);
  }
  function equipHtml() {
    const h = eqHost(), list = h.equips || [];
    const can = isBoard() && gi < 0 ? (p.rows || {}).column === "@equip" : !!(srcOf(t.source) || {}).equip;
    if (!can) return "";
    const picker = eqOpen ? `<div class="de-eqbox">${eqItems ? Q.checklistHtml(eqItems, new Set(list), { name: "deq", all: "すべての設備" }) : '<p class="df-none">設備を数えています…</p>'}</div>` : "";
    return `<div class="de-row"><span class="de-l">設備</span><button type="button" class="de-eqbtn${list.length ? " is-on" : ""}" data-de-eqopen aria-expanded="${eqOpen}" title="数える設備を選びます（複数選べます）">${esc(eqText(list))}<i aria-hidden="true">${eqOpen ? "▴" : "▾"}</i></button>`
      + (list.length ? `<button type="button" class="df-link" data-de-eqall>すべてに戻す</button>` : "") + `</div>${picker}`;
  }
  // 設備の出し方（版 3.40.0。利用者の要望 1: まとめないのに勝手に合算された）。絵つきの札で、出し方の違いを見て選ぶ
  // 言葉は形と合わせる（「重ねる」は積み上げの棒に見えて食い違った: 2026-10-dashlink の 2 回目の採点）
  const SPLITS = [["series", "系列に分ける", "設備ごとの系列（グラフは設備ごとの色の棒・線、表は設備ごとの列）", "M3 16V9h2v7M7 16V6h2v10M11 16v-5h2v5M15 16V4h2v12"],
    ["facet", "図を並べる", "設備ごとに小さな表・グラフを並べる（縦軸は同じ）", "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"],
    ["sum", "合算", "選んだ設備（選ばなければすべて）を合わせて 1 つ", "M4 16V5h12v11"],
    ["group", "グループ合算", "グループ（このパネルで作る・マスタの設備グループ）ごとに合わせる", "M3 16V8h5v8M12 16V4h5v12M3 6h5M12 2h5"]];
  const EG_SRCS = [["panel", "このパネルで作る"], ["master", "設備グループのマスタ"]];
  const EG_RESTS = [["keep", "そのまま 1 台ずつ出す"], ["other", "「その他の設備」にまとめる"], ["hide", "出さない"]];
  /** 設備のまとめ（合わせた表は表全体、ふつうのパネルは設備の段があるときに効く） */
  /** いまの出し方（サーバーの dashboard.split_of と同じ決め方） */
  function splitOf() {
    const eg = p.egroup || {};
    if (eg.mode === "sum") return "sum";
    if (eg.mode === "panel" || eg.mode === "master") return "group";
    return p.esplit || ((p.equips || []).length >= 2 ? "series" : "sum");
  }
  const dimsOf = (b) => [...((b && b.rows) || []), ...((b && b.cols) || [])];
  function egroupHtml() {
    if (inGroup() || isLink()) return "";
    const can = isBoard() ? (p.rows || {}).column === "@equip" : !!(srcOf(p.source) || {}).equip;
    if (!can) return "";
    const eg = p.egroup || { mode: "" }, sets = host.egroupSets ? host.egroupSets() : [];
    // 設備を行・列に置いた（要望 2）なら、それで設備ごとに出る。出し方の札の代わりに、どこに置いたかを言う
    const placed = !isBoard() && dimsOf(p.body).find((d) => d.column === "@equip" || d.column === "@egroup");
    const put = isBoard() ? "" : `<span class="de-eqput">${placed ? `<small class="de-hint">設備は「${(p.body.rows || []).includes(placed) ? "行" : "列"}」に置いています（${esc(dimLabel(placed))}ごとに出ます）</small>`
      : `<small class="de-hint">設備を</small><button type="button" class="pv-btn" data-de-eqput="rows" title="設備を行の段の頭に置きます（設備ごとの行）">行に置く</button><button type="button" class="pv-btn" data-de-eqput="cols" title="設備を列の段の頭に置きます（設備ごとの列・系列）">列に置く</button>`}</span>`;
    const cur = splitOf();
    const chips = isBoard() ? `<select data-de-egmode aria-label="設備をまとめる">${[["", "まとめない（1 台ずつ）"], ["sum", "選んだ設備を合算して 1 つに"], ["panel", "このパネルでグループを作って合算"], ["master", "設備グループのマスタから合算"]].map(([k, n]) => `<option value="${k}"${(eg.mode || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
      : `<span class="de-frames de-splits" role="radiogroup" aria-label="設備の出し方">${SPLITS.map(([k, n, tip, ico]) => `<label class="de-frame${cur === k ? " on" : ""}" title="${esc(tip)}"><input type="radio" name="de-split" value="${k}" data-de-split${cur === k ? " checked" : ""}><svg class="de-sico" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="${ico}"/></svg>${n}</label>`).join("")}</span>`;
    let body = "";
    if (!isBoard() && cur === "group") body = `<div class="de-row"><span class="de-l"></span>${segs("egsrc", EG_SRCS, eg.mode, "グループの決め方")}</div>`;
    if (eg.mode === "sum") body += `<div class="de-row"><span class="de-l"></span><label class="pv-ck">名前<input data-de-egname value="${esc(eg.name || "")}" placeholder="選んだ設備の計" maxlength="40" aria-label="合算した設備の名前"></label><small class="de-hint">${esc(eqText(eqHost().equips))}を 1 つの行（値）にします</small></div>`;
    if (eg.mode === "panel") {
      const all = (eqItems || []).map((x) => x.value), used = new Map();
      (eg.groups || []).forEach((g, k) => (g.members || []).forEach((m) => { if (!used.has(m)) used.set(m, k); }));
      body += (eg.groups || []).map((g, k) => `<div class="de-eg" data-k="${k}"><input data-de-eggname value="${esc(g.name)}" maxlength="40" aria-label="グループの名前" placeholder="グループ ${k + 1}">`
        + `<span class="de-egm">${(all.length ? all : g.members || []).map((n) => `<button type="button" class="sh-eq" data-de-egm="${esc(n)}" aria-pressed="${(g.members || []).includes(n)}"${used.has(n) && used.get(n) !== k ? ` title="グループ ${used.get(n) + 1} にも入っています（先のグループで数えます）"` : ""}>${esc(n)}</button>`).join("")}</span>`
        + `<button type="button" class="icon-btn" data-de-egdel="${k}" aria-label="グループ「${esc(g.name)}」を外す">×</button></div>`).join("")
        + `<div class="de-row"><span class="de-l"></span><button type="button" class="pv-btn" data-de-egadd>＋ グループ</button>${eqItems ? "" : '<small class="de-hint">設備を数えています…</small>'}</div>`;
    }
    if (eg.mode === "master") {
      const cur = sets.find((x) => x.name === eg.set);
      body += `<div class="de-row"><span class="de-l"></span><select data-de-egset aria-label="まとめ方">${sets.length ? "" : '<option value="">（設備グループがまだありません）</option>'}${sets.map((x) => `<option${x.name === eg.set ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`
        + `<small class="de-hint">マスタ管理の「設備グループ」で足す・直す（直すと、このパネルにもすぐ効きます）</small></div>`
        + (cur ? `<div class="de-row"><span class="de-l"></span><span class="de-egprev">${cur.groups.map((g) => `<span><b>${esc(g.name)}</b>${esc([...g.equipment, ...(g.rules || []).map(ruleText)].join("・"))}</span>`).join("")}</span></div>` : "");
    }
    const rest = eg.mode === "panel" || eg.mode === "master" ? `<div class="de-row"><span class="de-l"></span><label class="pv-ck">グループに入らない設備<select data-de-egrest>${EG_RESTS.map(([k, n]) => `<option value="${k}"${(eg.rest || "keep") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>` : "";
    if (placed) return `<div class="de-row"><span class="de-l">出し方</span>${put}</div>`;
    const why = isBoard() ? "" : `<small class="de-hint de-splitwhy">${esc((SPLITS.find((x) => x[0] === cur) || [, , ""])[2])}</small>`;
    return `<div class="de-row de-top"><span class="de-l">${isBoard() ? "まとめる" : "出し方"}</span><div class="de-splitbox">${chips}${why}${put}</div></div>${body}${rest}`;
  }
  const RULE_WORD = { prefix: "で始まる", suffix: "で終わる", contains: "を含む", equals: "と同じ", regex: "に当たる" };
  const ruleText = (r) => `「${r.value}」${RULE_WORD[r.op] || ""}`;
  function dataHtml() {
    const basis = isWork() ? `<select data-de-basis aria-label="作業日の数え方"><option value="work"${t.basis !== "cal" ? " selected" : ""}>現場歴</option><option value="cal"${t.basis === "cal" ? " selected" : ""}>太陽暦</option></select>` : "";
    const g = inSide() ? p.link.sides[gi] : null;
    // 合わせるデータ（版 3.40.0）: 役割（目標・実績）と作り方（そのまま・積み上げ）は、データの選びの上（何のデータかを先に決める）
    const side = g ? `<div class="de-row"><span class="de-l">役割</span>${segs(`role-${gi}`, ROLES, g.role || "", "役割")}<label class="pv-ck de-gt">名前<input data-de-stitle value="${esc(g.title || "")}" placeholder="${esc((srcOf(g.source) || {}).name || "")}" maxlength="40" aria-label="このデータの名前"></label></div>`
      + `<div class="de-row"><span class="de-l">作り方</span>${segs(`build-${gi}`, BUILDS, g.build || "as", "作り方")}<small class="de-hint">${g.build === "cum" ? "軸の並びに足していく（累計）" : "軸の値ごとの数のまま"}</small></div>` : "";
    return (!parts() && p.visual !== "board" ? linkPick() : "") + side + `<div class="de-row"><label class="de-l">データ</label><select data-de-src aria-label="データ">${sources.map((x) => `<option value="${esc(x.key)}"${x.key === t.source ? " selected" : ""}${x.place ? "" : " disabled"}>${esc(x.name)}${x.place ? "" : "（場所が未設定）"}</option>`).join("")}</select>${basis}</div>`
      + equipHtml() + egroupHtml();
  }
  /** 合わせた表の札（表全体・まとまり ①②…・＋） */
  function tabsHtml() {
    if (!parts()) return "";
    const n = "①②③④";
    if (isLink()) {
      const role = (r) => (ROLES.find((y) => y[0] === r) || [, ""])[1];
      return `<div class="de-tabs" role="tablist" aria-label="合わせるデータ"><button type="button" role="tab" class="de-tab${gi < 0 ? " on" : ""}" aria-selected="${gi < 0}" data-de-tab="-1">全体<small>合わせ方・形</small></button>`
        + p.link.sides.map((g, i) => `<button type="button" role="tab" class="de-tab is-side${gi === i ? " on" : ""}" aria-selected="${gi === i}" data-de-tab="${i}" style="--gc:${ROLE_COLOR[g.role || ""]}"><i aria-hidden="true"></i>${n[i]} ${esc(g.role ? role(g.role) : g.title || "比べる")}<small>${esc(g.title && g.role ? g.title : (srcOf(g.source) || {}).name || "")}</small></button>`).join("")
        + (p.link.sides.length < MAX_GROUPS ? '<button type="button" class="de-tab is-add" data-de-gadd title="合わせるデータを足します（4 つまで）">＋ データ</button>' : "") + "</div>";
    }
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
    const gs = parts(), what = isLink() ? "データ" : "まとまり";
    return `<div class="de-row de-gacts"><span class="de-l"></span><button type="button" class="pv-btn" data-de-gmove="-1"${gi ? "" : " disabled"}>← 左へ</button><button type="button" class="pv-btn" data-de-gmove="1"${gi < gs.length - 1 ? "" : " disabled"}>右へ →</button>`
      + `<button type="button" class="pv-btn is-danger" data-de-gdel${gs.length > (isLink() ? 2 : 1) ? "" : " disabled"}>この${what}を外す</button></div>`;
  }

  /** 欄に字を打っている間は、その欄のまとまりを描き直さない（打っている字・カーソルを失わない）。押す札・選ぶ欄は描き直す */
  const typingIn = (sel) => { const a = document.activeElement; return !!(a && a.closest(sel) && a.matches("input:not([type=checkbox]):not([type=radio]):not([type=color]),textarea")); };
  function paint(repaintFields = true) {
    const el = $("#dbEditor"); if (!el || !p) return;
    if (!el.firstChild) {
      el.innerHTML = `<div class="de-head" data-drag><b>パネルを組む</b><input id="deTitle" class="de-title" autocomplete="off" aria-label="題" maxlength="60">`
        + `<span class="db-sp"></span><button type="button" class="btn-ghost" data-de-cancel>やめる</button><button type="button" class="btn-primary" data-de-apply>当てる</button></div>`
        + `<div id="deTabs"></div><div class="de-body"><aside class="pv-fields de-fields"><div class="pv-cap"><b>カラム</b><small>札を押すと右の文に入ります（もう一度押すと外れます）</small></div>`
        + `<div class="de-fsearch"><input id="deSearch" type="search" placeholder="カラムを検索" autocomplete="off" aria-label="カラムを検索"><button type="button" class="pv-btn de-calcbtn" data-de-calcnew title="式から列を作り、このパネルで使います">＋ 計算列</button></div><div class="pv-list" id="deFields"></div></aside>`
        // 流れの順に 4 段（2026-10-dashmore の 3 回目で決めた S3）: ① データ ② 数え方 ③ 形 ④ 見せ方・書式。段の見出しに番号（合わせた表は札で切り替えるので出さない）
        + `<div class="de-main"><div class="de-step"><i>1</i>データ<small>何を数えるか</small></div><div id="deData"></div>`
        + `<div class="de-step"><i>2</i>数え方<small>行・列・値・期間・条件</small></div><div id="deSent"></div><div id="deCond"></div><div id="deSort"></div>`
        + `<div class="de-step"><i>3</i>形<small>どう描くか</small></div><div id="deVis"></div><div id="deBoard"></div>`
        + `<div class="de-step"><i>4</i>見せ方・書式<small>枠・数値・軸・色</small></div><div id="deLook"></div><div id="deFmt"></div><div id="deGacts"></div><p class="de-msg" id="deMsg" aria-live="polite"></p></div></div>`
        + `<div id="deCalcBox" class="de-calcbox" hidden></div>`;
      TPA.onText($("#deSearch"), (v) => { q = v; $("#deFields").innerHTML = fieldsHtml(); });
      TPA.onText($("#deTitle"), (v) => { p.title = v.slice(0, 60); host.onChange(TPA.clone(p)); });
    }
    const whole = !!parts() && gi < 0;
    el.classList.toggle("is-board", isBoard()); el.classList.toggle("is-link", isLink()); el.classList.toggle("is-whole", whole);
    const ti = $("#deTitle");
    if (document.activeElement !== ti) ti.value = p.title || "";
    ti.placeholder = autoTitle(p);
    $("#deTabs").innerHTML = tabsHtml();
    $("#deVis").innerHTML = visualsHtml();
    if (!typingIn("#deBoard")) $("#deBoard").innerHTML = whole && isBoard() ? boardHtml() : "";
    $(".de-fields").hidden = whole;
    ["#deData", "#deSent", "#deCond", "#deSort"].forEach((s) => { $(s).hidden = whole; });
    // 段の見出し: 合わせたデータの「全体」は ① を「合わせ方」にし ② を出さない・「データ」の札は ③ ④（形・見せ方は全体で決める）を出さない
    const steps = el.querySelectorAll(".de-step"), lw = isLink() && whole;
    steps[0].innerHTML = lw ? "<i>1</i>合わせ方<small>データ・役割・軸・作り方</small>" : "<i>1</i>データ<small>何を数えるか</small>";
    steps[1].hidden = lw; steps[2].hidden = steps[3].hidden = inSide();
    // 番号は見えている段の順（全体の札は ① 合わせ方 → ② 形 → ③ 見せ方。① → ③ と飛ばない）
    let no = 0; steps.forEach((st) => { if (!st.hidden) { const i = st.querySelector("i"); if (i) i.textContent = String(++no); } });
    if (lw) { const d = $("#deData"); d.hidden = false; if (!typingIn("#deData")) d.innerHTML = linkHtml(); }
    if (!whole) {
      if (repaintFields) $("#deFields").innerHTML = fieldsHtml();
      $("#deData").innerHTML = dataHtml();
      $("#deSent").innerHTML = sentenceHtml();
      if (!typingIn("#deCond")) $("#deCond").innerHTML = condHtml();
      $("#deSort").innerHTML = sortHtml();
    }
    if (!typingIn("#deLook")) $("#deLook").innerHTML = whole ? "" : lookHtml();
    if (!typingIn("#deFmt")) $("#deFmt").innerHTML = fmtHtml();
    $("#deGacts").innerHTML = groupActsHtml();
    // 表全体: 設備の選び・まとめは、行の段（設備）の選びのすぐ下（どちらも行の段に効く）
    if (whole && isBoard()) { const b = $("#deBoard"), first = b && b.querySelector(".de-row"); if (first && !b.querySelector("[data-de-egmode]")) first.insertAdjacentHTML("afterend", equipHtml() + egroupHtml()); }
    if ((eqOpen || (p.egroup && p.egroup.mode === "panel")) && !eqItems) loadEquips();
  }
  function message(text) { const m = $("#deMsg"); if (m) m.textContent = text || ""; }

  function bind(el) {
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || !p) return;
      if (b.hasAttribute("data-de-cancel")) { host.onCancel(); return; }
      if (b.hasAttribute("data-de-apply")) { host.onApply(TPA.clone(p)); return; }
      if (b.dataset.deTab != null) { select(+b.dataset.deTab); return; }
      if (b.hasAttribute("data-de-formmore")) { formOpen = !formOpen; $("#deVis").innerHTML = visualsHtml(); return; }
      if (b.hasAttribute("data-de-gadd")) { addGroup(); return; }

      if (b.dataset.deEqput) {          // 設備を行・列の段の頭に置く（要望 2）
        const role = b.dataset.deEqput, bd = p.body;
        if (bd[role].length >= MAX_DIMS) { host.toast(`${role === "rows" ? "行" : "列"}の段は ${MAX_DIMS} つまでです`); return; }
        bd[role === "rows" ? "cols" : "rows"] = bd[role === "rows" ? "cols" : "rows"].filter((d) => d.column !== "@equip");
        bd[role] = [{ column: "@equip", part: "" }].concat(bd[role].filter((d) => d.column !== "@equip"));
        if (p.visual === "kpi") p.visual = role === "rows" ? "column" : "none";
        delete p.esplit; changed(); return;
      }
      if (b.dataset.deGmove) { moveGroup(gi, +b.dataset.deGmove); return; }
      if (b.hasAttribute("data-de-gdel")) { removeGroup(gi); return; }
      if (b.dataset.deRup != null || b.dataset.deRdown != null) { const i = +(b.dataset.deRup ?? b.dataset.deRdown); moveRow(b.closest("[data-de-row]").dataset.deRow, b.dataset.deRup != null ? i - 1 : i + 1); return; }
      if (b.dataset.deColor != null) { p.groups[gi].color = b.dataset.deColor; changed(false); return; }
      // 設備（複数）・まとめる
      if (b.hasAttribute("data-de-eqopen")) { eqOpen = !eqOpen; if (eqOpen) loadEquips(); paint(false); return; }
      if (b.hasAttribute("data-de-eqall") || b.hasAttribute("data-ck-deq-clear")) { setEquips([]); return; }
      if (b.hasAttribute("data-de-egadd")) { const eg = p.egroup; eg.groups = (eg.groups || []).concat([{ name: `グループ ${(eg.groups || []).length + 1}`, members: [] }]); changed(false); return; }
      if (b.dataset.deEgdel != null) { p.egroup.groups.splice(+b.dataset.deEgdel, 1); changed(false); return; }
      if (b.dataset.deEgm != null) {
        const g = p.egroup.groups[+b.closest(".de-eg").dataset.k], n = b.dataset.deEgm;
        g.members = (g.members || []).includes(n) ? g.members.filter((x) => x !== n) : (g.members || []).concat([n]);
        changed(false); return;
      }
      // 書式
      if (b.hasAttribute("data-de-fmtopen")) { fmtOpen = !fmtOpen; $("#deFmt").innerHTML = fmtHtml(); return; }
      if (b.dataset.dePal != null) { setFmt("palette", b.dataset.dePal); return; }
      if (b.dataset.deScolx != null) { const cs = { ...((p.fmt || {}).colors || {}) }; delete cs[b.dataset.deScolx]; setFmt("colors", Object.keys(cs).length ? cs : ""); return; }
      if (b.hasAttribute("data-de-refadd")) { const fm = p.fmt || {}; setFmt("refs", (fm.refs || []).concat([{ value: 0, label: "目標", color: REF_COLORS[0] }])); return; }
      if (b.dataset.deRefdel != null) { const r = ((p.fmt || {}).refs || []).slice(); r.splice(+b.dataset.deRefdel, 1); setFmt("refs", r.length ? r : ""); return; }
      if (b.dataset.deRefc != null) { const r = ((p.fmt || {}).refs || []).map((x) => ({ ...x })), i = +b.closest(".de-ref").dataset.i; r[i].color = b.dataset.deRefc; setFmt("refs", r); return; }
      // 計算列
      if (b.hasAttribute("data-de-calcnew")) { openCalc(""); return; }
      if (b.dataset.deCalcopen != null) { e.stopPropagation(); openCalc(b.dataset.deCalcopen); return; }
      if (b.hasAttribute("data-de-calcx")) { calcEdit = null; paintCalc(); return; }
      if (b.hasAttribute("data-de-calcok")) { saveCalc(false); return; }
      if (b.hasAttribute("data-de-calcdel")) { if (confirm(`計算列「${calcEdit.was}」を消します。使っている段・値・条件からも外します。よろしいですか？`)) saveCalc(true); return; }
      if (b.dataset.deAdd) {
        const role = b.dataset.deAdd, col = b.dataset.col;
        if (role === "vals") addMeasure(col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : isNum(col) ? { agg: "sum", column: col } : { agg: "distinct", column: col });
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
      if (x.matches("[data-de-agg]")) {
        const m = t.body.measures[+x.dataset.deAgg]; m.agg = x.value;
        if (m.agg === "pct" && !m.p) m.p = 90;
        if (m.agg === "cpk" && m.lsl == null && m.usl == null) { host.toast("Cpk は規格の下限か上限を入れると数えます"); paint(false); return; }
        changed(false); return;
      }
      if (x.matches("[data-de-show]")) { const m = t.body.measures[+x.dataset.deShow]; if (x.value) m.show = x.value; else delete m.show; changed(false); return; }
      if (x.matches("[data-de-mp]")) { t.body.measures[+x.dataset.deMp].p = Math.max(1, Math.min(99, +x.value || 90)); changed(false); return; }
      if (x.matches("[data-de-mlsl],[data-de-musl]")) {
        const i = +(x.dataset.deMlsl ?? x.dataset.deMusl), m = t.body.measures[i], k = x.dataset.deMlsl != null ? "lsl" : "usl";
        if (x.value === "") delete m[k]; else m[k] = +x.value;
        if (m.lsl == null && m.usl == null) { host.toast("Cpk は規格の下限か上限が要ります"); return; }
        if (m.lsl != null && m.usl != null && m.lsl >= m.usl) { host.toast("規格は 下限 < 上限 にしてください"); return; }
        changed(false); return;
      }
      if (x.matches("[data-de-pkind]")) {
        const dates = special().some((s) => s.column === "@workday") ? "@workday" : (((fields && fields.fields) || []).find((f) => f.date) || {}).column || "";
        t.period = x.value ? { column: (t.period && t.period.column) || dates, kind: x.value, n: (t.period && t.period.n) || 7 } : null;
        $("#deCond").innerHTML = condHtml(); changed(false); return;
      }
      if (x.matches("[data-de-pcol]")) { t.period.column = x.value; changed(false); return; }
      if (x.matches("[data-de-pn]")) { t.period.n = Math.max(1, Math.min(3660, +x.value || 7)); changed(false); return; }
      if (x.matches("[data-de-sort]")) { p.sort = x.value; changed(false); return; }
      if (x.matches("[data-de-emph]")) { p.emph = x.checked; changed(false); return; }
      if (x.matches("[data-de-frame]")) { if (x.value === "card") delete p.frame; else p.frame = x.value; p.emph = x.value === "emph"; changed(false); return; }
      if (x.matches("[data-de-kpilook]")) { setFmt("kpi", x.value === "num" ? "" : x.value); return; }
      if (x.matches("[data-de-target]")) { setFmt("target", x.value === "" ? "" : +x.value); return; }
      if (x.dataset.ckDeq != null || x.matches("[data-ck-deq-all]")) {
        if (x.matches("[data-ck-deq-all]")) { setEquips([]); return; }
        const set = new Set(eqHost().equips || []); if (x.checked) set.add(x.dataset.ckDeq); else set.delete(x.dataset.ckDeq);
        setEquips((eqItems || []).map((i) => i.value).filter((v) => set.has(v))); return;
      }
      if (x.matches("[data-de-split]")) {
        const v = x.value, eg = p.egroup || {};
        if (v === "sum") { p.egroup = { mode: "sum", rest: "keep", ...(eg.mode === "sum" ? { name: eg.name } : {}) }; delete p.esplit; }
        else if (v === "group") { p.egroup = eg.mode === "panel" || eg.mode === "master" ? eg : { mode: (host.egroupSets && host.egroupSets().length) ? "master" : "panel", rest: "keep", set: ((host.egroupSets ? host.egroupSets() : [])[0] || {}).name || "", groups: [{ name: "グループ 1", members: [] }] }; delete p.esplit; loadEquips(); }
        else { delete p.egroup; p.esplit = v; }
        changed(false); return;
      }
      if (x.matches("[data-de-egsrc]")) {
        const eg = p.egroup; eg.mode = x.value;
        if (x.value === "panel" && !(eg.groups || []).length) eg.groups = [{ name: "グループ 1", members: [] }];
        if (x.value === "master" && !eg.set) eg.set = ((host.egroupSets ? host.egroupSets() : [])[0] || {}).name || "";
        if (x.value === "panel") loadEquips();
        changed(false); return;
      }
      if (x.matches("[data-de-linkmode]")) {           // 数える物: 1 つのデータ ⇔ 別のデータと合わせる
        if (x.value === "link" && !isLink()) startLink();
        else if (x.value === "one" && isLink()) { unlink(); host.toast("1 つ目のデータだけのパネルに戻しました"); loadFields(); changed(); }
        return;
      }
      if (x.matches("[data-de-sub]")) { p.body.sub = x.checked; changed(false); return; }
      if (x.name && /^de-(role|build)-\d+$/.test(x.name)) {
        const [, k, i] = /^de-(role|build)-(\d+)$/.exec(x.name), g = p.link.sides[+i];
        if (k === "role" && x.value) p.link.sides.forEach((y, j) => { if (j !== +i && y.role === x.value) y.role = ""; });    // 目標・実績は 1 つずつ
        g[k] = x.value; changed(false); return;
      }
      if (x.matches("[data-de-extra]")) { const ex = new Set(p.link.extra || []); if (x.checked) ex.add(x.dataset.deExtra); else ex.delete(x.dataset.deExtra); p.link.extra = [...ex]; changed(false); return; }
      if (x.matches("[data-de-stitle]")) { p.link.sides[gi].title = x.value.trim().slice(0, 40); changed(false); return; }
      if (x.matches("[data-de-egmode]")) {
        if (!x.value) delete p.egroup;
        else p.egroup = { mode: x.value, rest: (p.egroup || {}).rest || "keep", ...(x.value === "panel" ? { groups: (p.egroup || {}).groups || [{ name: "グループ 1", members: [] }] } : {}),
          ...(x.value === "master" ? { set: ((host.egroupSets ? host.egroupSets() : [])[0] || {}).name || "" } : {}) };
        if (x.value === "panel") loadEquips();
        if (x.value === "sum" && !(eqHost().equips || []).length) host.toast("選んだ設備を合算します（設備を選ばなければ、すべての設備の計）");
        changed(false); return;
      }
      if (x.matches("[data-de-egname]")) { p.egroup.name = x.value.trim().slice(0, 40); changed(false); return; }
      if (x.matches("[data-de-eggname]")) { p.egroup.groups[+x.closest(".de-eg").dataset.k].name = x.value.trim().slice(0, 40) || `グループ ${+x.closest(".de-eg").dataset.k + 1}`; changed(false); return; }
      if (x.matches("[data-de-egset]")) { p.egroup.set = x.value; changed(false); return; }
      if (x.matches("[data-de-egrest]")) { p.egroup.rest = x.value; changed(false); return; }
      if (x.matches("[data-de-flabels]")) { setFmt("labels", x.value); return; }
      if (x.matches("[data-de-fxdate]")) { setFmt("xdate", x.value); return; }
      if (x.matches("[data-de-fxrot]")) { setFmt("xrot", x.value); return; }
      if (x.matches("[data-de-fdigits]")) { setFmt("digits", x.value === "" ? "" : +x.value); return; }
      if (x.matches("[data-de-funit]")) { setFmt("unit", x.value); return; }
      if (x.matches("[data-de-fymin],[data-de-fymax]")) { setFmt(x.matches("[data-de-fymin]") ? "ymin" : "ymax", x.value === "" ? "" : +x.value); return; }
      if (x.matches("[data-de-fgrid]")) { setFmt("grid", x.checked ? "" : false); return; }
      if (x.matches("[data-de-flegend]")) { setFmt("legend", x.value); return; }
      if (x.matches("[data-de-fsize]")) { setFmt("size", x.value); return; }
      if (x.matches("[data-de-refv],[data-de-refl]")) {
        const r = ((p.fmt || {}).refs || []).map((y) => ({ ...y })), i = +x.closest(".de-ref").dataset.i;
        if (x.matches("[data-de-refv]")) r[i].value = +x.value || 0; else r[i].label = x.value.trim().slice(0, 20);
        setFmt("refs", r); return;
      }
      if (x.matches("[data-de-scol]")) { setFmt("colors", { ...((p.fmt || {}).colors || {}), [x.dataset.deScol]: x.value }); return; }
      if (x.matches("[data-de-lwarn],[data-de-lalert],[data-de-ldir]")) {
        const g = p.groups[gi], L = { ...(g.limits || {}) };
        if (x.matches("[data-de-ldir]")) L.dir = x.value;
        else { const k = x.matches("[data-de-lwarn]") ? "warn" : "alert"; if (x.value === "") delete L[k]; else L[k] = +x.value; }
        if (L.warn == null && L.alert == null) delete g.limits; else g.limits = { dir: "high", ...L };
        changed(false); return;
      }
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
    el.addEventListener("input", (e) => {
      if (!calcEdit) return;
      if (e.target.id === "deCalcName") calcEdit.name = e.target.value;
      else if (e.target.id === "deCalcExpr") calcEdit.expr = e.target.value;
      else return;
      // 欄は作り直さない（打っている字を失わない）。確かめの字と「作る」だけを替える
      const tmp = document.createElement("div"); tmp.innerHTML = calcHtml();
      $("#deCalcMsg").replaceWith(tmp.querySelector("#deCalcMsg"));
      $("[data-de-calcok]").disabled = tmp.querySelector("[data-de-calcok]").disabled;
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
      // 前の版の設備の選び（作業実績の設備 1 つ: equip＝キー）は、設備の名前の並び（equips）にして組む（同じ数）
      [p, ...(p.groups || []), ...((p.link || {}).sides || [])].forEach((x) => {
        const e = x.equip && x.source === "work" ? ((srcOf("work") || {}).equips || []).find((y) => y.key === x.equip) : null;
        if (e) { x.equips = [e.name]; x.equip = ""; }
      });
      eqOpen = false; eqItems = null; eqKey = ""; calcEdit = null;
      const el = $("#dbEditor");
      if (!el.dataset.bound) { bind(el); el.dataset.bound = "1"; }
      el.innerHTML = ""; el.hidden = false; q = ""; fields = null; fieldsKey = ""; formOpen = false;
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
