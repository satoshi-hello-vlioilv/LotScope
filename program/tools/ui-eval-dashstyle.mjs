// 評価関数（開発用）: ダッシュボードの色の組・スタイル・見せ方（版 3.69.0。利用者の要望 2026-11-04 の 2・5）。
//   node program/tools/ui-eval-dashstyle.mjs [--view 1728x1152] [--shots 出力フォルダ]
// 組む所の書式で: スタイル 7 つ（見本の絵がそのスタイルで描かれる）・色の組（カラフル・単色の濃淡がそれぞれ 10 以上と「自分で作る」）を選ぶと、
// パネルのグラフにその場で効く（グラデーションの塗り・角丸・影・枠だけ、色の組の 1 番目の色）。自分の色: 色を直す・足す・外すがグラフに効く。
// 見せ方 9 つ（夜は暗い地で、軸の字と地のコントラストが 4.5 以上）。当てたあとも保つ。サーバーの確かめ（保存のときの clean_fmt）を通っても残る。
// 書式の欄が組む所から横にはみ出さない。頁の誤りが無いこと。全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const viewArg = arg("--view", "1728x1152"), shots = arg("--shots", "");
const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView(viewArg), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  const shot = async (n) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, `${n}-${viewArg}.png`) }); } };
  await waitDash(p); await sleep(1200);
  const id = "workDays";
  await p.click("[data-db-editmode]"); await sleep(400);
  await p.focus(P(id)); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(600);
  const click = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await sleep(700); };
  // 上のタブ（版 3.70.0）: データと数え方・デザイン・書式。デザインを押すと、テーマ・見せ方・スタイル・色の組だけが出る
  const tabs = await p.$$eval("[data-de-pane]", (bs) => bs.map((b) => b.textContent.trim()));
  check(`組む所の上にタブ「データと数え方・デザイン・書式」（${tabs.join("・")}）`, tabs.join("|") === "データと数え方|デザイン|書式", tabs);
  await p.click('[data-de-pane="design"]'); await sleep(500);
  const vis = await p.evaluate(() => [...document.querySelectorAll("#dbEditor .de-pane")].filter((x) => !x.hidden).map((x) => x.dataset.pane));
  check("デザインを押すと、デザインのタブだけが出る", vis.join() === "design", vis);
  const secs = await p.$$eval('.de-pane[data-pane="design"] .de-sec h4', (hs) => hs.map((h) => h.firstChild.textContent.trim()));
  check(`デザインのタブの囲みは 見せ方・テーマ・スタイル・色の組（${secs.join("・")}）`, ["見せ方", "テーマ", "スタイル", "色の組"].every((x) => secs.includes(x)), secs);
  const fit = await p.evaluate(() => { const m = document.querySelector("#dbEditor .de-main"), own = document.querySelector('[data-de-pal="custom"]'); return own ? own.getBoundingClientRect().bottom <= m.getBoundingClientRect().bottom + 1 : false; });
  check("デザインのタブを開いただけで「自分の色」が見える（送らずに届く）", fit || viewArg !== "1728x1152", fit);
  const svg = () => p.$eval(`${P(id)} .dp-chart svg`, (s) => s.outerHTML);
  const bars = () => p.$$eval(`${P(id)} .dp-chart svg rect`, (rs) => rs.map((r) => (r.getAttribute("fill") || "").toLowerCase()).filter((f) => f && f !== "none" && !f.startsWith("#f") && f !== "#fff"));
  // スタイル
  const stys = await p.$$eval("[data-de-sty]", (bs) => bs.map((b) => [b.dataset.deSty, b.textContent.trim(), !!b.querySelector("svg")]));
  check(`スタイルが 7 つ並び、どれにも見本の絵がある（${stys.map((x) => x[1]).join("・")}）`, stys.length === 7 && stys.every((x) => x[2]), stys);
  const gradIcon = await p.$eval('[data-de-sty="grad"] svg', (s) => s.outerHTML);
  check("グラデーションの見本は、グラデーションで描かれている", /linearGradient/.test(gradIcon) && /url\(#/.test(gradIcon), gradIcon.slice(0, 200));
  for (const [k, re, what] of [["grad", /linearGradient[\s\S]*fill="url\(#/, "グラデーションの塗り"], ["round", /<rect[^>]*rx="4"/, "角丸"], ["shadow", /feDropShadow[\s\S]*filter="url\(#/, "影"], ["outline", /fill-opacity="\.22"[^>]*stroke=/, "枠だけ"]]) {
    await click(`[data-de-sty="${k}"]`);
    check(`スタイル「${k}」を押すと、パネルのグラフが${what}になる`, re.test(await svg()), (await svg()).slice(0, 300));
    if (k === "grad") await shot("style-grad");
  }
  await click('[data-de-sty=""]');
  check("標準に戻すと、塗りは元の色に戻る", !/url\(#/.test(await svg()) && !/fill-opacity="\.22"/.test(await svg()), "");
  // テーマ: 押すと見せ方・スタイル・色の組が一緒に替わり、そのテーマだけが押した形。どれかを替えると、テーマの押した形が外れる
  await click('[data-de-theme="3"]');
  const th = await p.evaluate((i) => { const x = Dashboard._state().layout.panels.find((y) => y.id === i); return { frame: x.frame, fmt: x.fmt, on: [...document.querySelectorAll(".de-theme.on")].map((b) => b.dataset.deTheme) }; }, id);
  check("テーマ「ナイト」で 見せ方＝夜・スタイル＝グラデーション・色の組＝鮮やか になり、ナイトだけが押した形", th.frame === "night" && th.fmt && th.fmt.style === "grad" && th.fmt.palette === "neon" && th.on.join() === "3", th);
  const dot = await p.$$eval("[data-de-pane] .de-pdot", (xs) => xs.map((x) => x.closest("button").dataset.dePane));
  check("デザインのタブに「既定から変えています」の印が付く", dot.includes("design"), dot);
  await shot("theme-night");
  await click('[data-de-sty="round"]');
  const on2 = await p.$$eval(".de-theme.on", (bs) => bs.length);
  check("スタイルだけを替えると、テーマの押した形が外れる（選びが食い違って見えない）", on2 === 0, on2);
  await click('[data-de-theme="0"]');
  // 色の組
  const groups = await p.$$eval(".de-palg", (gs) => gs.map((g) => [g.querySelector("small").textContent, g.querySelectorAll("[data-de-pal]").length]));
  check(`色の組: カラフル 11＋自分の色（同じ格子の最後の升）→ 単色の濃淡 10（${groups.map((g) => g.join(" ")).join("／")}）`, groups.length === 2 && groups[0][1] === 12 && groups[1][1] >= 10 && await p.$('.de-palg:first-child [data-de-pal="custom"]') !== null, groups);
  const want = await p.evaluate(() => DashStyle.PALETTES.wa.c[0]);
  await click('[data-de-pal="wa"]');
  check(`「和の色」を押すと、棒が組の 1 番目の色（${want}）になる`, (await bars()).includes(want), await bars());
  await click('[data-de-pal="green"]');
  const g0 = await p.evaluate(() => DashStyle.PALETTES.green.c[0]);
  check(`単色の「緑」を押すと、棒が ${g0} になる`, (await bars()).includes(g0), await bars());
  // 自分で作る
  await click('[data-de-pal="custom"]');
  const n0 = await p.$$eval("[data-de-palc]", (xs) => xs.length);
  check("「自分の色」を押すと、いまの色から始まる色の並び（色の欄）が出る", n0 >= 3, n0);
  await p.evaluate(() => { const x = document.querySelector('[data-de-palc="0"]'); x.value = "#c2185b"; x.dispatchEvent(new Event("change", { bubbles: true })); }); await sleep(700);
  check("1 番目の色を #c2185b に直すと、棒がその色になる", (await bars()).includes("#c2185b"), await bars());
  await click("[data-de-paladd]");
  const n1 = await p.$$eval("[data-de-palc]", (xs) => xs.length);
  await click('[data-de-palx="1"]');
  const n2 = await p.$$eval("[data-de-palc]", (xs) => xs.length);
  check(`色を足す・外す（${n0} → ${n1} → ${n2}）`, n1 === n0 + 1 && n2 === n0, [n0, n1, n2]);
  await shot("palette-custom");
  // 見せ方 9 つ・夜
  const frames = await p.$$eval("[data-de-frame]", (xs) => xs.map((x) => x.value));
  check(`見せ方が 9 つ（${frames.join("・")}）`, frames.length === 9, frames);
  await p.evaluate(() => { const x = document.querySelector('[data-de-frame][value="night"]'); x.checked = true; x.dispatchEvent(new Event("change", { bubbles: true })); }); await sleep(800);
  const night = await p.$eval(P(id), (el) => {
    const L = (c) => { const v = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((x) => { const s = +x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const bg = getComputedStyle(el).backgroundColor, ax = el.querySelector(".pv-ax"), h = el.querySelector("h3");
    const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    return { cls: el.className, bg, ax: ax ? cr(getComputedStyle(ax).fill, bg) : 0, h: h ? cr(getComputedStyle(h).color, bg) : 0 };
  });
  check(`夜: 暗い地で、軸の字（${night.ax.toFixed(1)}）と題（${night.h.toFixed(1)}）のコントラストが 4.5 以上`, /is-frame-night/.test(night.cls) && night.ax >= 4.5 && night.h >= 4.5, night);
  await click('[data-de-sty="grad"]');
  await shot("night-grad");
  // はみ出さない
  const over = await p.evaluate(() => { const m = document.querySelector("#dbEditor .de-main"); return m ? m.scrollWidth - m.clientWidth : 0; });
  check("書式の欄が組む所から横にはみ出さない", over <= 1, over);
  // 当てる → 残る・サーバーの確かめを通っても残る
  await click("[data-de-apply]"); await sleep(600);
  const fm = await p.evaluate((i) => Dashboard._state().layout.panels.find((x) => x.id === i).fmt, id);
  check("当てたあとも、スタイル・自分の色が書式に残る", fm && fm.style === "grad" && fm.palette === "custom" && (fm.pcolors || [])[0] === "#c2185b", fm);
  check("当てたあとも、パネルはグラデーションで描かれる", /fill="url\(#/.test(await svg()), "");
  check("頁の誤りが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
