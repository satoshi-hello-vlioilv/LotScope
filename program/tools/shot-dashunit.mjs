// 撮るだけの道具（開発用。版 3.92.0）: ダッシュボードの表の列ごとの単位・計算式の見出し・上位 N＋その他・数字のパネルの組む所と確定後。
//   node program/tools/shot-dashunit.mjs 出力フォルダ [1536x864] [案の定義.mjs 案の鍵]
//   作った後は TPA_DASHUNIT_BUILT=1 を付けて案なしで撮る（値ごとの単位・見出しの式・数字のパネルを左右に 2 つにした組み）
// 案の定義を渡すと、案の CSS と、撮る状態ごとの組み替え（at: {table, kpiEdit, tableEdit, wait} の頁の中の文）を当ててから撮る。
// 撮る物: dash-table（表と数字のパネルの確定後）・dash-kpi-edit（数字のパネルを組む所）・dash-table-edit（表を組む所）・dash-wait（数を待っている所）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, parseView, waitDash } from "./ui-harness.mjs";

process.env.TPA_UI_BYPASS_CSP = "1";
const [outArg, viewArg, defs, key] = process.argv.slice(2);
const OUT = path.resolve(outArg || "shot-dashunit"), VIEW = parseView(viewArg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prop = defs ? (await import(pathToFileURL(path.resolve(defs)).href)).PROPOSALS.find((p) => p.key === key) : null;
export const LAYOUT = { rows: 8, panels: [
  { id: "t1", x: 0, y: 0, w: 6, h: 5, title: "不良ごとの重量の合計・ロット数", visual: "none", source: "lot", sort: "desc", top: 6,
    body: { rows: [{ column: "不良名", part: "" }], cols: [], measures: [{ agg: "sum", column: "重量", expr: "÷1000", dec: 1 }, { agg: "lots" }], grand: true },
    fmt: { num: '#,##0.0"t"', numUi: { cat: "num", dec: 1, sep: true, neg: "minus", pre: "", suf: "t" } } },
  { id: "k1", x: 6, y: 0, w: 3, h: 2, title: "仕掛ロット数", visual: "kpi", source: "lot", body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } },
  { id: "k2", x: 9, y: 0, w: 3, h: 2, title: "重量の合計", visual: "kpi", source: "lot", body: { rows: [], cols: [], measures: [{ agg: "sum", column: "重量", expr: "÷1000", dec: 1 }, { agg: "lots" }], grand: true }, fmt: { utext: "t" } },
  { id: "k3", x: 6, y: 2, w: 6, h: 1, title: "前日の実績本数", visual: "kpi", source: "work", period: { column: "@workday", kind: "yesterday" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } }] };

// 撮るのは、この道具を直に流したときだけ（ui-eval-dashunit.mjs が LAYOUT を読むときは撮らない）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
async function main() {
// 作った後（版 3.92.0）を撮るとき（TPA_DASHUNIT_BUILT=1）: 値ごとの単位（重量は t・ロット数は単位なし）・見出しに式を出さない・数字のパネルは左右に 2 つ
if (process.env.TPA_DASHUNIT_BUILT) {
  const [t1, , k2] = LAYOUT.panels;
  t1.body.measures = [{ ...t1.body.measures[0], utext: "t", hideExpr: true }, { agg: "lots", utext: "" }];
  k2.body.measures = [{ ...k2.body.measures[0], utext: "t", hideExpr: true }, { agg: "lots", utext: "ロット" }];
  k2.fmt = { kpair: "side" };
}
const built = !!process.env.TPA_DASHUNIT_BUILT;
const app = await launch();
try {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await app.newPage("light", VIEW, { screen: "dash" });
  if (prop && prop.css) await page.addStyleTag({ content: prop.css });
  // 前の状態で足した札（.mk-tag など）は片付けてから当てる
  const apply = async (state) => { const js = prop && prop.at && prop.at[state]; if (js) { await page.evaluate(() => document.querySelectorAll(".mk-tag,.mk-mini,.mk-pop,.mk-ghost").forEach((x) => x.remove())); await page.evaluate(js); await sleep(300); } };
  await page.evaluate((l) => Dashboard._setLayout(l), LAYOUT); await sleep(600); await waitDash(page); await sleep(700);
  await apply("table");
  await page.screenshot({ path: path.join(OUT, "dash-table.png") });
  // 数字のパネルを組む所で開いた所（重量の合計: 値が 2 つ）。組むのは編集の中から
  await page.click("[data-db-editmode]"); await sleep(500);
  await page.focus('#dashGrid .db-p[data-id="k2"]'); await page.keyboard.press("Enter");
  await page.waitForSelector("#deFields .pv-f"); await waitDash(page); await sleep(600);
  await apply("kpiEdit");
  if (built) { await page.evaluate(() => document.querySelector("#deKLay")?.scrollIntoView({ block: "center" })); await sleep(300); }
  await page.screenshot({ path: path.join(OUT, "dash-kpi-edit.png") });
  // 表のパネルを組む所で開いた所（値の計算の段）
  await page.click("[data-de-cancel]").catch(() => {}); await sleep(500);
  await page.focus('#dashGrid .db-p[data-id="t1"]'); await page.keyboard.press("Enter");
  await page.waitForSelector("#deFields .pv-f"); await waitDash(page); await sleep(600);
  await apply("tableEdit");
  if (built) { await page.evaluate(() => document.querySelector("#dbEditor .pc-band")?.scrollIntoView({ block: "center" })); await sleep(300); }
  await page.screenshot({ path: path.join(OUT, "dash-table-edit.png") });
  await page.click("[data-de-cancel]").catch(() => {}); await sleep(500);
  await page.keyboard.press("Escape"); await sleep(300);
  await page.click("[data-db-leave]").catch(() => {}); await sleep(600);
  // 待っている所（問い合わせを 4 秒遅らせて、引き直した直後）
  await page.route("**/api/dashboard/query**", async (r) => { await sleep(4000); await r.continue(); });
  await page.click("[data-db-refresh]").catch(() => {}); await sleep(1600);
  await apply("wait");
  await page.screenshot({ path: path.join(OUT, "dash-wait.png") });
  await page.unroute("**/api/dashboard/query**");
} finally {
  await app.close();
}
}
