// 評価関数（開発用）: スライサーで計算列（表示列で式から作った列）を選べるか（版 3.20.0）。
//   node program/tools/ui-eval-slicer.mjs
// 計算列「材調質 = concat([合金],'-',[調質])」を作り、スライサーに足し、値「A5052-H24」を押す。
// ① カードの件数 ② 一覧の件数 が、サーバーに 合金=A5052 かつ 調質=H24 で数えさせた件数と同じか。
// ③ 開き直しても（選んだ値を覚えたまま、組を読み直してから）同じ件数で効くか。全部合えば終了コード 0。
import { launch, sleep } from "./ui-harness.mjs";

const LAYOUT = { "lotlist:仕掛": { order: [], hidden: [], widths: {}, locks: [], names: {}, formats: {}, aligns: {}, rules: {},
  formulas: { "材調質": "concat([合金], '-', [調質])" } } };
const app = await launch();
let ok = false;
try {
  const p = await app.newPage("light");
  await p.evaluate(async (l) => { TPA.local.set("tpa.lotlist.layout.v1", l); await TPA.saveUiState(); }, LAYOUT);
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(500);
  const want = await p.evaluate(async () => {
    const f = JSON.stringify([{ column: "合金", op: "eq", value: "A5052" }, { column: "調質", op: "eq", value: "H24" }]);
    return (await (await fetch("/api/lotlist?page_size=1&filters=" + encodeURIComponent(f))).json()).count;
  });
  await p.click("#llSlicerBtn"); await sleep(400);
  const listed = await p.$$eval("#llSlicerAdd option", (o) => o.map((x) => x.textContent).filter((t) => t.includes("（式）")));
  await p.selectOption("#llSlicerAdd", "材調質"); await sleep(1200);
  const card = await p.$eval('#llSlicer .sx-card[data-col="材調質"] .sx-v[data-v="A5052-H24"]', (b) => +b.dataset.n).catch(() => -1);
  await p.click('#llSlicer .sx-card[data-col="材調質"] .sx-v[data-v="A5052-H24"]'); await sleep(1500);
  const count = () => p.$eval("#llCount", (x) => +x.textContent.replace(/[^0-9]/g, ""));
  const list = await count();
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(2500);
  const again = await count();
  ok = listed.length === 1 && want > 0 && card === want && list === want && again === want;
  console.log(JSON.stringify({ listed, want, card, list, again }), ok ? "OK" : "NG");
} finally {
  await app.close();
}
process.exit(ok ? 0 : 1);
