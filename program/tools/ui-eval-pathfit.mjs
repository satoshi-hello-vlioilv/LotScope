// 評価関数（開発用）: 「参照…」の窓が、欄の位置によらず窓に収まる（版 3.54.1。利用者の報告 2026-10-25: データ元の欄で
// 参照… を押すと、窓の下が画面の外へ切れた）。
//   node program/tools/ui-eval-pathfit.mjs
// データ元の行を開き、場所の欄を画面の上から 15%・35%・50%・60%・70%・85% の高さに送ってから「参照…」を押す。窓の大きさは
// 1728×1152・1536×864・1536×830（利用者の画面: 2160×1440 の窓を 125% で開いた頁の大きさ）・1280×720。
// ④ 開いた欄の入力欄（グループの欄も）が潰れていない
// ① 窓の上下左右が頁の中（OK・やめるに届く）② 欄（行）を覆わない（窓は欄の上か下）③ 開いたあと後ろを送っても、窓は頁の中・欄に付いていく
// 全部合えば終了コード 0。
import { launch, sleep, parseView, manySources } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const fit = (p) => p.evaluate(() => {
  const d = document.querySelector(".pp-dlg"), inp = document.querySelector('#masterSettings .sr-card.is-open [data-sr-conn="place"]');
  if (!d || !inp) return null;
  const r = d.getBoundingClientRect(), a = (inp.closest(".sr-row") || inp).getBoundingClientRect(), go = d.querySelector(".pp-go").getBoundingClientRect();
  return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), a: [Math.round(a.top), Math.round(a.bottom)], H: innerHeight, W: innerWidth,
    inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && go.bottom <= innerHeight,
    covers: r.top < a.bottom - 1 && r.bottom > a.top + 1 };
});
const app = await launch();
try {
  const errors = [];
  for (const v of ["1728x1152", "1536x864", "1536x830", "1536x805", "1280x720"]) {
    const p = await app.newPage("light", parseView(v));
    p.on("pageerror", (e) => errors.push(e.message));
    await manySources(p, true); await sleep(500);
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
    await p.evaluate(() => document.querySelector('#masterTabs [data-tab="sources"]').click());
    await p.waitForSelector("#masterSettings tr.sr-row"); await sleep(600);
    const key = await p.evaluate(() => (document.querySelectorAll("#masterSettings tr.sr-row[data-group='台帳']")[2] || {}).dataset?.key);
    await p.click(`#masterSettings [data-sr-edit="${key}"]`); await sleep(500);
    // ④ 開いた欄の入力欄がどれも潰れていない（高さ 28px 以上。利用者の画像でグループの欄が細く潰れていた）
    const hs = await p.$$eval("#masterSettings .sr-card.is-open input.ps-input", (xs) => xs.filter((x) => x.offsetParent).map((x) => [x.dataset.sr || x.dataset.srConn, Math.round(x.getBoundingClientRect().height)]));
    check(`④ ${v} 開いた欄の入力欄が潰れていない（グループの欄も）`, hs.length && hs.every(([, h]) => h >= 28), hs);
    for (const frac of [0.15, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85]) {
      // 欄を画面の frac の高さへ（マスタ管理の中を送る）
      await p.evaluate((frac) => { const box = document.querySelector("#masterSettings"), inp = document.querySelector('#masterSettings .sr-card.is-open [data-sr-conn="place"]');
        box.scrollTop += inp.getBoundingClientRect().top - innerHeight * frac; }, frac);
      await sleep(150);
      const at = await p.evaluate(() => Math.round(document.querySelector('#masterSettings .sr-card.is-open [data-sr-conn="place"]').getBoundingClientRect().top));
      await p.click("#masterSettings .sr-card.is-open .pp-open"); await sleep(500);
      const f = await fit(p);
      check(`① ${v} 欄が ${at}px（${Math.round(frac * 100)}%）: 窓が頁に収まり、選ぶボタンに届く`, f && f.inView, { at, ...f });
      check(`② ${v} 欄が ${at}px: 窓が欄を覆わない`, f && !f.covers, { at, ...f });
      if (frac === 0.5) {   // ③ 開いたまま後ろを送る
        await p.evaluate(() => { document.querySelector("#masterSettings").scrollTop += 120; }); await sleep(250);
        const g = await fit(p);
        check(`③ ${v} 開いたまま後ろを送っても、窓は頁の中・欄を覆わない`, !g || (g.inView && !g.covers), g);
      }
      await p.keyboard.press("Escape"); await sleep(200);
      if (await p.$(".pp-dlg")) { await p.click(".pp-dlg [data-pp=close]").catch(() => {}); await sleep(150); }
    }
    await p.context().close();
  }
  check("画面のエラーが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
