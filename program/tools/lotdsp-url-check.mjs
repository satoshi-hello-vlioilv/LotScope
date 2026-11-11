// 評価関数（開発用）: LotDsp を開く URL（static/js/lotdsp-url.js）が、WaveLog（static/js/core/base.js の buildLotDspUrl）と同じ URL を作るか。
//   node program/tools/lotdsp-url-check.mjs
// WaveLog の関数は、その字のまま下に写して（LOT_DSP_BASE だけ引数に）並べて比べる。全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js/lotdsp-url.js");
const ctx = { String };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(JS, "utf8"), ctx, { filename: "lotdsp-url.js" });
const U = ctx.LotDspUrl;

// WaveLog（satoshi-hello-vlioilv/wavelog の static/js/core/base.js）の写し
const LOT_DSP_BASE = "http://nlmfangyweb1a/LotDspWeb/#/lotdsp";
function lotDspField(v) { return String(v || "").slice(0, 7).padEnd(7, " "); }
function lotDspLinkKey(lotNo, castingNo) { return lotDspField(lotNo) + "   " + lotDspField(castingNo); }
function buildLotDspUrl(lotNo, castingNo, tab) { return `${LOT_DSP_BASE}?linkkey=${encodeURIComponent(lotDspLinkKey(lotNo, castingNo))}&tab=${encodeURIComponent(tab)}`; }

const cases = [
  ["L7150C0", "J82G25A", "1"], ["L7150C0", "", "1"], ["L71", "J8", "0"], ["L7150C0X9", "J82G25A77", "7"], ["", "", "1"], ["l0001c1", "j1", "4"],
];
let ng = 0;
for (const [lot, cast, tab] of cases) {
  for (const url of ["http://nlmfangyweb1a/LotDspWeb/", "http://nlmfangyweb1a/LotDspWeb", "http://nlmfangyweb1a/LotDspWeb/#/lotdsp"]) {
    const got = U.build(url, lot, cast, tab), want = buildLotDspUrl(lot, cast, tab);
    if (got !== want) { ng++; console.log("NG", JSON.stringify([url, lot, cast, tab]), got, "≠", want); }
  }
}
const key = U.linkKey("L7150C0", "J82G25A");
const checks = [
  ["linkkey の長さ（7＋3＋7）", key.length === 17],
  ["linkkey の形", key === "L7150C0   J82G25A"],
  ["タブが無い番号なら既定（1）", U.build("http://h/LotDspWeb/", "L1", "C1", "9").endsWith("&tab=1")],
  ["タブの名前", U.label(1) === "進度情報" && U.label(0) === "ICAS情報" && U.TABS.length === 8],
];
for (const [name, ok] of checks) { if (!ok) ng++; console.log(ok ? "OK" : "NG", name); }

// 版 3.98.0: 場所の組み立て（siteBase・searchBase）は、サーバー・窓と同じ事例の表 tests/fixtures/lotdsp_rules_cases.json で確かめる
const RULES = JSON.parse(fs.readFileSync(path.resolve(path.dirname(JS), "../../../tests/fixtures/lotdsp_rules_cases.json"), "utf8"));
for (const c of RULES.site) {
  const okBase = U.siteBase(c.url) === c.base, okSearch = U.searchBase(c.url) === c.direct;
  if (!okBase || !okSearch) { ng++; console.log("NG 場所", JSON.stringify(c.url), U.siteBase(c.url), U.searchBase(c.url)); }
}
console.log(`場所の事例 ${RULES.site.length} 通り（サーバー・窓と同じ表）`);

// 版 3.98.0: 取込の結果の札（LotDspReport.report）。理由ごとの「取り込まなかった行」・設備名が空の行・札の題は report.source
const R = ctx.LotDspReport;
const base = { lot_no: "L1", actual_rows: 10, default_unwind: "上", imported: [], planned: [], renamed: [], warnings: [] };
const r1 = R.report({ ...base, source: "LotDsp 進度情報", skipped: [
  { no: 11, equipment: "", reason: "設備名が実績にも設計にもありません" },
  { no: 4, equipment: "XYZ", reason: "設備マスタに無い設備" }, { no: 5, equipment: "XQ", reason: "設備マスタに無い設備" }] }, "このアプリで直接・2.9 秒", "12:03");
const r2 = R.report({ ...base, source: "LotDsp API（ログインなし）", skipped: [], planned: [{ no: 7, equipment: "CAL" }] }, "LotDsp API・ログインなし・0.5 秒", "12:04");
const r3 = R.report({ ...base, source: "LotDsp 進度情報", skipped: [{ no: 3, equipment: "<b>", reason: "設備マスタに無い設備" }] }, "貼り付け", "12:05",
  (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;"));
const reportChecks = [
  ["理由ごとに 1 行ずつ", r1.details.length === 2],
  ["設備名が空の行は名前を出さない", r1.details[0].html === "⚠ 取り込まなかった行（設備名が実績にも設計にもありません）: №11"],
  ["設備マスタに無い行だけ直し方を添える", r1.details[1].html === "⚠ 取り込まなかった行（設備マスタに無い設備）: №4 XYZ、№5 XQ。要るならマスタ管理で設備を足して取り込み直す"],
  ["設備マスタに無いでない理由には直し方を添えない", !r1.details[0].html.includes("マスタ管理")],
  ["⚠ の数", r1.warn === 3],
  ["札の題は report.source（画面で読んだ）", r1.title.startsWith("LotDsp 進度情報（このアプリで直接・2.9 秒・12:03）")],
  ["札の題は report.source（API で読んだ）", r2.title.startsWith("LotDsp API（ログインなし）（") && !r2.title.startsWith("LotDsp 進度情報")],
  ["未実績の行", r2.details.length === 1 && r2.details[0].html === "◌ 未実績（設計の設備名だけ）: №7 CAL"],
  ["設備名は逃がす", r3.details[0].html.includes("№3 &lt;b&gt;")],
];
for (const [name, ok] of reportChecks) { if (!ok) ng++; console.log(ok ? "OK" : "NG", "取込の札:", name); }
console.log(ng ? `NG ${ng}` : `OK（WaveLog と同じ URL を ${cases.length * 3} 通りで確かめた）`);
process.exit(ng ? 1 : 0);
