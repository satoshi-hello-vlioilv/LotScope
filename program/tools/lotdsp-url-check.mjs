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
console.log(ng ? `NG ${ng}` : `OK（WaveLog と同じ URL を ${cases.length * 3} 通りで確かめた）`);
process.exit(ng ? 1 : 0);
