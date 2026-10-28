// 撮るだけの道具（開発用。版 3.58.0）: データ元の実績を開いた所（接続・設備・ロット番号の列）・そのほかの接続・見出しのタブの権限を 3 つの大きさで撮る。
//   node program/tools/shot-unify.mjs 出力フォルダ（確かめは ui-eval-unify.mjs）
import { launch, sleep, parseView } from "./ui-harness.mjs";
const out = process.argv[2];
const app = await launch();
try {
  for (const v of ["1728x1152", "1536x864", "1280x720"].map(parseView)) {
    const p = await app.newPage("light", v);
    const errs = []; p.on("pageerror", (e) => errs.push(e.stack));
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
    await p.evaluate(() => document.querySelector('#masterTabs [data-tab="sources"]').click());
    await p.waitForSelector("#masterSettings tr.sr-row"); await sleep(600);
    await p.click('#masterSettings [data-sr-edit="work"]'); await sleep(1500);
    await p.screenshot({ path: `${out}/work-conn-${v.width}.png` });
    await p.click('#masterSettings [data-sr-sec="equip"]'); await sleep(800);
    await p.screenshot({ path: `${out}/work-equip-${v.width}.png` });
    await p.click('#masterSettings [data-sr-sec="lot"]'); await sleep(800);
    await p.screenshot({ path: `${out}/work-lot-${v.width}.png` });
    await p.click('#masterSettings [data-sr-close]'); await sleep(500);
    await p.click('#masterSettings [data-oth-open="update.source"]'); await sleep(800);
    await p.screenshot({ path: `${out}/others-${v.width}.png`, fullPage: false });
    console.log(v.width, "errors", JSON.stringify(errs));
    await p.context().close();
  }
} finally { await app.close(); }
// 見出しのタブの権限（データ元が多い形＋人 3 人）
{
  const { manySources } = await import("./ui-harness.mjs");
  const app2 = await launch();
  try {
    for (const v of ["1728x1152", "1536x864", "1280x720"].map(parseView)) {
      const p = await app2.newPage("light", v);
      const errs = []; p.on("pageerror", (e) => errs.push(e.stack));
      if (v.width === 1728) {
        await manySources(p, true);
        await p.evaluate(async () => {
          const put = (b) => fetch("/api/masters/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
          await put({ "ログインID": "maint-b", "権限区分": "メンテナンス者", "有効": "有" });
          await put({ "ログインID": "user-a", "権限区分": "一般ユーザー", "有効": "有", "タブの例外": { work: "出さない", sch: "出す" } });
          await put({ "ログインID": "line-1", "権限区分": "設備作業者", "有効": "有", "タブの例外": { lot: "出す" } });
        });
      }
      await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
      await p.evaluate(() => document.querySelector('#masterTabs [data-tab="access"]').click()); await sleep(800);
      await p.click('[data-ta-mode="tabs"]'); await sleep(1200);
      await p.screenshot({ path: `${out}/tabs-${v.width}.png` });
      // 「＋ 例外」の面（表の右端から左へ開く）と、表の下の説明
      await p.hover('.ta-mx [data-ta-add="work"]'); await p.click('.ta-mx [data-ta-add="work"]'); await sleep(400);
      await p.screenshot({ path: `${out}/tabs-add-${v.width}.png` });
      await p.keyboard.press("Escape"); await sleep(200);
      await p.evaluate(() => document.querySelector(".ta-foot").scrollIntoView({ block: "end" })); await sleep(300);
      await p.screenshot({ path: `${out}/tabs-foot-${v.width}.png` });
      console.log("tabs", v.width, JSON.stringify(errs));
      await p.context().close();
    }
  } finally { await app2.close(); }
}
