// 評価関数（開発用）: 表示列の「この列の作り方」で、式の欄を広げてから打っても大きさが保たれるか（版 3.20.0 で直した不具合の再現と確かめ）。
//   node program/tools/ui-eval-formula.mjs
// 列を選ぶ → 作り方を開く → 欄を 200px に広げる → 式を打つ（350ms 後に一覧と詳細が描き直される）→ 欄の高さを測る。
// 別の段（値の整え方）を触って描き直されたあとも測る。どちらも 200px ± 2 なら OK。
// 続けて式ビルダー: 式の無い列は「組み立てる」から開くか・「数を丸める」を組んで「式にする」と式の欄に入り、式を書く方へ戻るか。
// 全部合えば終了コード 0。
import { launch, sleep } from "./ui-harness.mjs";

const app = await launch();
let ok = true;
try {
  const p = await app.newPage("light");
  await p.click("#llColBtn"); await sleep(600);
  await p.click('#lcList li[data-col="重量"]'); await sleep(400);
  await p.click('.lc-step[data-step="fx"] > h4'); await sleep(200);
  const startMode = await p.$eval('[data-fxmode][aria-selected="true"]', (b) => b.dataset.fxmode);
  await p.click('[data-fxmode="write"]'); await sleep(150);
  const h = () => p.$eval("#lcFormula", (x) => Math.round(x.getBoundingClientRect().height));
  const before = await h();
  await p.$eval("#lcFormula", (x) => { x.style.height = "200px"; });
  const widened = await h();
  await p.focus("#lcFormula"); await p.keyboard.type("[重量] * 2"); await sleep(900);
  const afterType = await h();
  await p.click('.lc-step[data-step="fmt"] > h4'); await sleep(200);
  await p.click('input[name="lcK"][value="number"]'); await sleep(500);
  await p.click('.lc-step[data-step="fx"] > h4'); await sleep(300);
  const afterRedraw = await h();
  // 式ビルダー: 式の無い列（板幅）を選ぶ → 組み立てるで開く → 数を丸める（小数 1 桁）→ 式にする
  await p.click('#lcList li[data-col="板幅"]'); await sleep(400);
  const opened = await p.$eval('.lc-step[data-step="fx"]', (x) => x.classList.contains("is-open"));
  if (!opened) { await p.click('.lc-step[data-step="fx"] > h4'); await sleep(200); }
  const emptyMode = await p.$eval('[data-fxmode][aria-selected="true"]', (b) => b.dataset.fxmode);
  await p.click('#lcFxBuilder [data-kind="round"]'); await sleep(150);
  await p.selectOption('#lcFxBuilder .fb-term[data-path="from"] select', "重量"); await sleep(150);
  const built = await p.$eval("#lcFxBuilder .fb-code", (x) => x.textContent);
  await p.click('#lcFxBuilder [data-apply="replace"]'); await sleep(900);
  const after = await p.evaluate(() => ({ value: document.querySelector("#lcFormula").value,
    mode: document.querySelector('[data-fxmode][aria-selected="true"]').dataset.fxmode, state: document.querySelector("#lcFxState").textContent }));
  const res = { startMode, before, widened, afterType, afterRedraw, emptyMode, built, after };
  const keep = Math.abs(afterType - widened) <= 2 && Math.abs(afterRedraw - widened) <= 2;
  const fb = startMode === "build" && emptyMode === "build" && built === "round([重量], 1)" && after.value === built && after.mode === "write" && after.state.startsWith("使える式");
  ok = keep && fb;
  console.log(JSON.stringify(res), ok ? "OK" : `NG:${keep ? "" : " 広げた大きさが戻った"}${fb ? "" : " 式ビルダーが式の欄に入らない"}`);
} finally {
  await app.close();
}
process.exit(ok ? 0 : 1);
