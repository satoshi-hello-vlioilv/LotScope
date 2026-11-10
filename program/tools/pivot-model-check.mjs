// 評価関数（開発用。版 3.92.0）: 集計の答え → 表の形（static/js/lotlist-pivot-charts.js の buildModel）。node で流す（tests/test_screen_parts.py からも）。
//   node program/tools/pivot-model-check.mjs
// 1. 総計は段の頭が空（行・列の段が 0 個）のセル。1 段目が空の値（「-」）のまとまりの小計（段の頭が [""]）と取り違えない
//    （版 3.91.0 まで: 鍵が段の字を join しただけで、[] と [""] がどちらも "" になり、総計が「-」の小計に上書きされた）
// 2. 行・列の両方の段で同じ（列の段の頭が [""] の値と、その行の全体）
// 3. ダッシュボードの表で上位 N に切ったとき（static/js/dashboard-panels.js の trimRows・withOther）: 切った行を「その他（n 行）」の 1 行にまとめ、
//    足し上げられる値は 上位の行＋その他＝総計（表の中で合う）。総計はどの行より小さくならない。平均はその他を空にし、総計はサーバーの全体のまま。
//    切らない（行が上位 N 以下）ときは「その他」を出さない
// 4. 値ごとの単位（utext）と見出しの式（hideExpr）: 単位はその値の数だけに付き、パネルの書式の単位の字（"t"）を重ねない。空の字は単位なし。
//    見出しは式を外すが、系列の鍵（measLabel）は変えない
// 全部合えば終了コード 0
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js");
const ctx = { console, TPA: { esc: (s) => String(s), pad2: (n) => String(n).padStart(2, "0") }, DashStyle: { PALETTES: {} } }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["num-format.js", "lotlist-pivot-charts.js", "dashboard-panels.js"]) vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
const C = ctx.LotListPivotCharts, P = ctx.DashPanels;
let bad = 0, n = 0;
const check = (name, ok, got) => { n++; console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) bad++; };
const S = { sub: false, grand: true, chart: "none", chartAt: 0, labels: true, split: false, month: "" };

// 行 2 段（発生課 > 異常内容）・値 1 つ。発生課が空の行が 1 つ（小計 [""] は 3）、総計は 30
const d1 = { dims: { rows: [{ column: "発生課" }, { column: "異常内容" }], cols: [] }, measures: [{ agg: "count" }], orders: [["冷延課", ""], ["汚れ", "キズ"]], labels: [{}, {}],
  cells: [{ r: [], c: [], v: [30] }, { r: ["冷延課"], c: [], v: [27] }, { r: [""], c: [], v: [3] },
    { r: ["冷延課", "汚れ"], c: [], v: [20] }, { r: ["冷延課", "キズ"], c: [], v: [7] }, { r: ["", "キズ"], c: [], v: [3] }] };
const m1 = C.buildModel(d1, S), g1 = m1.rows.find((r) => r.type === "grand"), all = { type: "all", path: [] };
check("1 総計は全体の 30（空の値のまとまりの小計 3 ではない）", m1.value(g1, all, 0) === 30, m1.value(g1, all, 0));
check("1 空の値の葉はそのまま 3", m1.value(m1.rows.find((r) => r.type === "data" && r.path[0] === ""), all, 0) === 3);

// 行 1 段・列 1 段。列の値が空の葉（[""]）と、その行の全体（[]）を取り違えない
const d2 = { dims: { rows: [{ column: "設備" }], cols: [{ column: "直" }] }, measures: [{ agg: "count" }], orders: [["A"], ["1", ""]], labels: [{}, {}],
  cells: [{ r: [], c: [], v: [10] }, { r: ["A"], c: [], v: [10] }, { r: [], c: ["1"], v: [6] }, { r: [], c: [""], v: [4] },
    { r: ["A"], c: ["1"], v: [6] }, { r: ["A"], c: [""], v: [4] }] };
const m2 = C.buildModel(d2, S), rA = m2.rows.find((r) => r.type === "data"), g2 = m2.rows.find((r) => r.type === "grand");
const cEmpty = m2.cols.find((c) => c.type === "data" && c.path[0] === ""), cAll = m2.cols.find((c) => c.type === "grand") || all;
check("2 A の全体は 10（列の空の値 4 ではない）", m2.value(rA, cAll, 0) === 10, m2.value(rA, cAll, 0));
check("2 A の列の空の値は 4", m2.value(rA, cEmpty, 0) === 4, m2.value(rA, cEmpty, 0));
check("2 総計の全体は 10", m2.value(g2, cAll, 0) === 10, m2.value(g2, cAll, 0));

// 3. 行 1 段・値 2 つ（重さの合計〈足せる〉と平均〈足せない〉）。サーバーの総計の数え方（ロットの重なりなど）は行の足し上げと違ってよい
const keys = ["a", "b", "c", "d", "e"], wt = [50, 40, 30, 20, 10];
const d3 = { dims: { rows: [{ column: "異常内容" }], cols: [] }, measures: [{ agg: "sum", column: "重量" }, { agg: "avg", column: "重量" }], orders: [keys], labels: [{}],
  cells: [{ r: [], c: [], v: [99, 7] }, ...keys.map((k, i) => ({ r: [k], c: [], v: [wt[i], i] }))] };
const panel = (top) => ({ visual: "none", sort: "desc", top, body: { grand: true }, fmt: {} });
const cut = (top) => { const m0 = C.buildModel(d3, S); return P.withOther(P.trimRows(m0, panel(top), Infinity), m0, d3).m; };
const m3 = cut(2), rows3 = m3.rows, other = rows3.find((r) => r.type === "other"), g3 = rows3.find((r) => r.type === "grand");
check("3 上位 2 の後に「その他（3 行）」・最後に総計", rows3.map((r) => r.type).join() === "data,data,other,grand" && other.n === 3, rows3.map((r) => r.type));
check("3 その他＝切った 3 行の合計 60", m3.value(other, all, 0) === 60, m3.value(other, all, 0));
check("3 総計＝上位 2＋その他＝150（表の中で合う）", m3.value(g3, all, 0) === 50 + 40 + 60, m3.value(g3, all, 0));
check("3 総計はどの行より小さくない", rows3.filter((r) => r.type !== "grand").every((r) => m3.value(r, all, 0) <= m3.value(g3, all, 0)));
check("3 平均（足せない）はその他が空・総計はサーバーの全体", m3.value(other, all, 1) === null && m3.value(g3, all, 1) === 7, [m3.value(other, all, 1), m3.value(g3, all, 1)]);
const m4 = cut(5);
check("3 切らない（上位 5 で 5 行）ときはその他を出さず、総計はサーバーの答え", !m4.rows.some((r) => r.type === "other") && m4.value(m4.rows.find((r) => r.type === "grand"), all, 0) === 99);
const html = C.tableHtml(m3, d3, { measName: (x) => x.agg, dimName: (x) => x.column, num: (v) => (v == null ? "" : String(v)) });
check("3 表に「その他（3 行）」の行", /class="is-other"><th[^>]*>その他（3 行）<\/th><td[^>]*>60<\/td>/.test(html), html.slice(0, 400));

// 4. 値ごとの単位・見出しの式
const pf = { num: '#,##0.0"t"' }, wM = { agg: "sum", column: "重量", expr: "÷1000", dec: 1, utext: "t", hideExpr: true }, lM = { agg: "lots", utext: "" };
check("4 重量は t が 1 つだけ", C.numText(4940.7, C.measFmt(pf, wM)) === "4,940.7t", C.numText(4940.7, C.measFmt(pf, wM)));
check("4 ロット数は単位なし（パネルの t も小数 1 桁も引き継がない）", C.numText(1377, C.measFmt(pf, lM)) === "1,377", C.numText(1377, C.measFmt(pf, lM)));
check("4 値ごとに単位と桁を決めた値は、値の桁が先（.0 を付けない）", C.numText(1377, C.measFmt(pf, { ...lM, dec: 0 })) === "1,377", C.numText(1377, C.measFmt(pf, { ...lM, dec: 0 })));
check("4 値ごとの単位を決めていない値はパネルの書式のまま", C.numText(5, C.measFmt(pf, { agg: "count" })) === "5.0t", C.numText(5, C.measFmt(pf, { agg: "count" })));
check("4 数の無い所に単位を付けない", C.numText(null, C.measFmt({}, { agg: "sum", column: "w", utext: "本" })) === C.numText(null, {}), C.numText(null, C.measFmt({}, { agg: "sum", column: "w", utext: "本" })));
check("4 書式の無いパネルでも値ごとの単位", C.numText(12, C.measFmt({}, { agg: "sum", column: "w", utext: "本" })) === "12本", C.numText(12, C.measFmt({}, { agg: "sum", column: "w", utext: "本" })));
check("4 見出しは式を外す・鍵は式つきのまま", C.measHead(wM) === "重量の合計" && C.measLabel(wM) !== C.measHead(wM) && /÷1000/.test(C.measLabel(wM)), [C.measHead(wM), C.measLabel(wM)]);
check("4 hideExpr の無い値は見出しにも式", C.measHead({ ...wM, hideExpr: undefined }) === C.measLabel(wM), C.measHead({ ...wM, hideExpr: undefined }));
const d5 = { ...d3, measures: [{ ...wM }, { ...lM }] }, m5 = C.buildModel(d5, S);
const html5 = C.tableHtml(m5, d5, { measName: P.headName, dimName: (x) => x.column, num: (v, j) => C.numHtml(v, C.measFmt(pf, d5.measures[j])) });
const cells5 = [...html5.matchAll(/<tr[^>]*>(?:<th[^>]*>.*?<\/th>)+<td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><\/tr>/g)].map((x) => [x[1], x[2]]);
check("4 表の見出しに式が無く、重量の列だけに t（ロット数の列に t が無い）", !/÷1000/.test(html5) && cells5.length >= 5 && cells5.every(([a, b]) => /t$/.test(a) && !/t$/.test(b)), [cells5, html5.slice(0, 300)]);

console.log(bad ? `NG ${n} 件中 ${bad} 件が違う` : `OK（${n} 件）`);
process.exit(bad ? 1 : 0);
