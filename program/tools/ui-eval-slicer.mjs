// 評価関数（開発用）: スライサーで計算列（表示列で式から作った列）を選べるか（版 3.20.0）・開閉が画面ごとか（版 3.21.0）。
//   node program/tools/ui-eval-slicer.mjs
// 計算列「材調質 = concat([合金],'-',[調質])」を作り、スライサーに足し、値「A5052-H24」を押す。
// ① カードの件数 ② 一覧の件数 が、サーバーに 合金=A5052 かつ 調質=H24 で数えさせた件数と同じか。
// ③ 開き直しても（選んだ値を覚えたまま、組を読み直してから）同じ件数で効くか。
// ④（版 3.21.0）開閉が画面ごとに分かれるか: 異常ロット一覧で開いたまま作業実績へ移ると閉じている・作業実績で開いて閉じても
//    異常ロット一覧は開いたまま・開き直しても画面ごとに覚えている・前の覚え（全体で 1 つ）は両方へ引き継ぐ。全部合えば終了コード 0。
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
  // ④ 開閉は画面ごと
  const open = () => p.$eval("#llSlicer", (x) => !x.hidden);
  const go = async (tab) => { await p.click(tab); await sleep(700); };
  const screens = {};
  screens.listAfterReload = await open();
  await go("#tabWork"); screens.workFirst = await open();
  await p.click("#llSlicerBtn"); await sleep(300); screens.workOpened = await open();
  await go("#tabList"); screens.listStill = await open();
  await go("#tabWork"); await p.click("#llSlicerBtn"); await sleep(300); screens.workClosed = await open();
  await go("#tabList"); screens.listAfterWorkClosed = await open();
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  screens.listReload = await open(); await go("#tabWork"); screens.workReload = await open();
  await p.evaluate(async () => { const s = TPA.local.get("tpa.lotlist.slicer.v1", {}); s.open = true; TPA.local.set("tpa.lotlist.slicer.v1", s); await TPA.saveUiState(); });
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  screens.legacyList = await open(); await go("#tabWork"); screens.legacyWork = await open();
  const perScreen = JSON.stringify(screens) === JSON.stringify({ listAfterReload: true, workFirst: false, workOpened: true, listStill: true,
    workClosed: false, listAfterWorkClosed: true, listReload: true, workReload: false, legacyList: true, legacyWork: true });
  ok = listed.length === 1 && want > 0 && card === want && list === want && again === want && perScreen;
  console.log(JSON.stringify({ listed, want, card, list, again, screens }), ok ? "OK" : "NG");
} finally {
  await app.close();
}
process.exit(ok ? 0 : 1);
