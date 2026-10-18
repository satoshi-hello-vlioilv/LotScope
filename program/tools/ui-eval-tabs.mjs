// 評価関数（開発用）: 見出しのタブの名前と並び（版 3.45.0。利用者の要望 2026-10-18 の 4）。
//   node program/tools/ui-eval-tabs.mjs [1280x720]
// ① タブの右クリック →「名前を変える…」→ 欄に打って Enter → タブの名前が変わる・押すとその画面が開く・開き直しても残る
// ② F2 → 打って Esc → 名前は変わらない／空にして Enter → 元の名前
// ③ 仕掛のタブをつかんで左端へ引く → 左端に移る・開き直しても残る・引いたあとに画面は切り替わらない
// ④ 選んだタブで Ctrl＋Shift＋→ → 1 つ右へ
// ⑤ 並びを変えても Alt＋1 は品質異常・Alt＋0 はダッシュボード
// ⑥ 「タブの並びと名前を元に戻す」→ 元の並び・元の名前
// ⑦ 名前を長くしても（10 字）見出しが 1 段に収まり、終了まで窓に入る
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const tabs = (p) => p.$$eval(".screen-tabs [data-screen]", (bs) => bs.map((b) => [b.dataset.screen, b.querySelector(".tab-name").textContent]));
const T = (s) => `.screen-tabs [data-screen="${s}"]`;
const rclick = async (p, s) => { const b = await (await p.$(T(s))).boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" }); await sleep(250); };
const choose = (p, text) => p.evaluate((t) => [...document.querySelectorAll(".tpa-menu button")].find((b) => b.textContent.includes(t)).click(), text);
const app = await launch();
try {
  const p = await app.newPage("light", parseView(process.argv[2] || "1280x720"));
  p.on("pageerror", (e) => errors.push(e.message));
  await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  const def = await tabs(p);
  await rclick(p, "list");
  const head = await p.$eval(".tpa-menu .tm-head", (x) => x.textContent);
  await choose(p, "名前を変える"); await sleep(150);
  await p.keyboard.press("Control+A"); await p.keyboard.type("異常ロット"); await p.keyboard.press("Enter"); await sleep(300);
  check("① 右クリック → 名前を変える → タブの名前が変わる", head.includes("品質異常") && (await p.$eval(`${T("list")} .tab-name`, (x) => x.textContent)) === "異常ロット", head);
  await p.click(T("dash")); await sleep(500); await p.click(T("list")); await sleep(500);
  check("① 押すとその画面が開く", await p.$eval("#lotListScreen", (x) => !x.classList.contains("hidden")), "");
  await p.evaluate(() => TPA.saveUiState()); await p.reload(); await p.waitForSelector(".screen-tabs"); await sleep(800);
  check("① 開き直しても名前が残る", (await p.$eval(`${T("list")} .tab-name`, (x) => x.textContent)) === "異常ロット", await tabs(p));

  await p.focus(T("work")); await p.keyboard.press("F2"); await sleep(150); await p.keyboard.type("XX"); await p.keyboard.press("Escape"); await sleep(200);
  check("② F2 → Esc で名前は変わらない", (await p.$eval(`${T("work")} .tab-name`, (x) => x.textContent)) === "作業実績", await tabs(p));
  await p.focus(T("list")); await p.keyboard.press("F2"); await sleep(150); await p.keyboard.press("Control+A"); await p.keyboard.press("Delete"); await p.keyboard.press("Enter"); await sleep(200);
  check("② 空にすると元の名前", (await p.$eval(`${T("list")} .tab-name`, (x) => x.textContent)) === "品質異常", await tabs(p));

  const was = await p.evaluate(() => document.querySelector("[aria-selected=true][data-screen]")?.dataset.screen);
  const b1 = await (await p.$(T("src:wip"))).boundingBox(), b0 = await (await p.$(T("dash"))).boundingBox();
  await p.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2); await p.mouse.down();
  await p.mouse.move(b0.x + 30, b0.y + b0.height / 2, { steps: 8 }); await p.mouse.move(b0.x + 4, b0.y + b0.height / 2, { steps: 3 }); await p.mouse.up(); await sleep(400);
  const t3 = await tabs(p), now = await p.evaluate(() => document.querySelector("[aria-selected=true][data-screen]")?.dataset.screen);
  check("③ 仕掛のタブを左端へ引く（画面は切り替わらない）", t3[0][0] === "src:wip" && now === was, { t3, now, was });
  await p.evaluate(() => TPA.saveUiState()); await p.reload(); await p.waitForSelector('.screen-tabs [data-screen="src:wip"]'); await sleep(800);
  check("③ 開き直しても並びが残る", (await tabs(p))[0][0] === "src:wip", await tabs(p));

  await p.focus(T("dash")); const i0 = (await tabs(p)).findIndex((x) => x[0] === "dash");
  await p.keyboard.press("Control+Shift+ArrowRight"); await sleep(200);
  check("④ Ctrl＋Shift＋→ で 1 つ右へ", (await tabs(p)).findIndex((x) => x[0] === "dash") === i0 + 1, await tabs(p));

  await p.keyboard.press("Alt+1"); await sleep(500);
  const a1 = await p.evaluate(() => document.querySelector("[aria-selected=true][data-screen]")?.dataset.screen);
  await p.keyboard.press("Alt+0"); await sleep(500);
  const a0 = await p.evaluate(() => document.querySelector("[aria-selected=true][data-screen]")?.dataset.screen);
  check("⑤ 並びを変えても Alt＋1 は品質異常・Alt＋0 はダッシュボード", a1 === "list" && a0 === "dash", { a1, a0 });

  for (const s of ["dash", "list", "calc", "work", "src:wip"]) {
    await p.focus(T(s)); await p.keyboard.press("F2"); await sleep(100); await p.keyboard.press("Control+A"); await p.keyboard.type("十文字のタブの名前だ"); await p.keyboard.press("Enter"); await sleep(150);
  }
  const fit = await p.evaluate(() => { const h = document.querySelector("body > header"), r = h.getBoundingClientRect(), tabsR = [...document.querySelectorAll(".screen-tab")].map((b) => b.getBoundingClientRect());
    const quit = [...h.querySelectorAll("button")].pop().getBoundingClientRect();
    return { oneRow: new Set(tabsR.map((x) => Math.round(x.top))).size === 1, quitIn: quit.right <= innerWidth, h: r.height, W: innerWidth, sw: h.scrollWidth, cw: h.clientWidth }; });
  check("⑦ 10 字の名前でも見出しは 1 段・終了まで窓に入る", fit.oneRow && fit.quitIn && fit.sw <= fit.cw + 1, fit);

  await rclick(p, "work"); await choose(p, "並びと名前を元に戻す"); await sleep(300);
  check("⑥ 並びと名前を元に戻す", JSON.stringify(await tabs(p)) === JSON.stringify(def), { now: await tabs(p), def });
  check("画面のエラーが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
