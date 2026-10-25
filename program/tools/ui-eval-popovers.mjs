// 評価関数（開発用）: 道具の行から開く浮かぶ面（共有の書式・表の見せ方・色付け・条件・表示の設定）が、画面に収まり横に送らずに読めるか（版 3.28.0）。
//   node program/tools/ui-eval-popovers.mjs [画像を置くフォルダ]
// 利用者の指摘: 共有の書式の面が見切れる・表の見せ方の面に横のスクロールが出る。
// 原因は 2 つ: ① 道具の行の子に掛けた「折り返さない」（white-space:nowrap）を面が受け継ぎ、長い説明の字が面の幅を押し広げていた
//   ② 共有の書式の面は「道具の行の右端から 10px」に置いていたので、窓が狭く道具の行が画面より広いとき、面ごと画面の外へ出ていた。
// 確かめること（作業実績と品質異常、窓の幅 1728・1536・1280・1100）:
//   面の左右が窓の中（8px の余白）・面の中に横の送り（scrollWidth − clientWidth）が無い・面の中の字が面の右からはみ出さない
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
// [名前, 開くボタン, 面, 開けたとみなす中身]
const POPS = [
  ["共有の書式", "#llFormatBtn", "#llFormatPanel", "#llFormatPanel .fm-save, #llFormatPanel .fm-msg"],
  ["表の見せ方", "#llViewBtn", "#llViewMenu", "#llViewMenu .vm-sec"],
  ["色付け", "#llMarkBtn", "#llMarkMenu", "#llMarkMenu > *"],
  ["条件", "#llCondBtn", "#llCondMenu", "#llCondMenu > *"],
  ["表示の設定", "#llProfileBtn", "#llProfileMenu", "#llProfileMenu button"],
];
const measure = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e || e.hidden) return null;
  const r = e.getBoundingClientRect();
  const out = [...e.querySelectorAll("*")].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== "hidden")
    .filter((x) => { const q = x.getBoundingClientRect(); return q.width > 0 && q.right > r.left + e.clientWidth + 1 && !x.closest("[data-scroll-x]"); })
    .slice(0, 3).map((x) => `${x.tagName.toLowerCase()}.${x.className}: ${x.textContent.trim().slice(0, 30)}`);
  return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, hscroll: e.scrollWidth - e.clientWidth, out };
}, sel);

const app = await launch();
try {
  for (const src of ["work", "lot"]) {
    for (const width of [1728, 1536, 1280, 1100]) {
      const p = await app.newPage("light", { width, height: 900 });
      const errors = []; p.on("pageerror", (e) => errors.push(e.message));
      if (src === "work") { await p.evaluate(() => document.querySelector("#tabWork").click()); /* 狭い窓では作業実績のタブが「ほか N ▾」に入る（版 3.54.0）ので、押す物を直接押す */ }
      await p.waitForSelector("#llBody tr[data-i]"); await sleep(700);
      const bad = [];
      for (const [name, opener, pop, ready] of POPS) {
        await p.mouse.click(4, 600); await p.keyboard.press("Escape"); await sleep(150);
        // 窓が狭いと道具の行が画面より広くなる: 開くボタンが画面の外なら、行を送って見える所へ
        await p.$eval(opener, (b) => b.scrollIntoView({ block: "nearest", inline: "nearest" }));
        await p.click(opener); await p.waitForSelector(ready, { timeout: 5000 }).catch(() => {}); await sleep(350);
        const m = await measure(p, pop);
        const ok = !!m && m.left >= 8 - 1 && m.right <= m.vw - 8 + 1 && m.hscroll <= 1 && !m.out.length;
        if (!ok) bad.push({ name, ...m });
        if (SHOT) await p.screenshot({ path: path.join(SHOT, `${src}-${width}-${name}.png`) });
      }
      check(`${src === "work" ? "作業実績" : "品質異常"} ${width}px: 5 つの面が窓に収まり、横に送らずに読める`, !bad.length, bad);
      check(`${src === "work" ? "作業実績" : "品質異常"} ${width}px: 頁の誤りが無い`, !errors.length, errors);
      await p.context().close();
    }
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
