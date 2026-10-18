// 評価関数（開発用）: ダッシュボードの組む所の幅（版 3.45.0。利用者の要望 2026-10-18 の 2: カラム名が読めるよう幅を変える）。
//   node program/tools/ui-eval-dashwidth.mjs [1728x1152]
// ① 組む所の左の縁を左へ 200px 引くと、組む所が 200px 広がる・組むパネルは組む所の左に収まる（重ならない）
// ② カラムの欄の境を右へ 140px 引くと、カラムの欄が 140px 広がる・切れていた長いカラム名が全部見える・右の組み立ては 480px 以上（札が切れない）
// ③ 開き直しても（頁を読み直しても）幅が残る
// ④ ← → で 16px ずつ（境に焦点）・ダブルクリックで元の幅（210px・720px）
// ⑤ 窓が狭い（1280）と、覚えた幅でも窓に収まる（右の 260px は空ける）
// ⑥ カラム名は 2 行まで折り返す・「⇔ 名前に合わせる」で、いちばん長い名前が 1 行に入る幅へ一度で
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const errors = [];
async function openEditor(p, id) {
  if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(300); }
  await p.focus(P(id)); await p.keyboard.press("Enter");
  await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
}
const box = (p, sel) => p.$eval(sel, (x) => { const r = x.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; });
const drag = async (p, sel, dx) => { const b = await box(p, sel); const y = (await p.$eval(sel, (x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; }));
  await p.mouse.move(b.l + b.w / 2, y); await p.mouse.down(); await p.mouse.move(b.l + b.w / 2 + dx / 2, y, { steps: 4 }); await p.mouse.move(b.l + b.w / 2 + dx, y, { steps: 4 }); await p.mouse.up(); await sleep(500); };
// 1 行で入りきらないカラム名（ふだんは 2 行まで折り返すので、測るときだけ 1 行にする）
const cut = (p) => p.evaluate(() => { const el = document.querySelector("#dbEditor"); el.classList.add("de-measure");
  const out = [...document.querySelectorAll("#deFields .pv-f > span > b")].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent); el.classList.remove("de-measure"); return out; });
const clipped = (p) => p.$$eval("#deFields .pv-f > span > b", (xs) => xs.filter((x) => x.scrollHeight > x.clientHeight + 1).map((x) => x.textContent));   // 2 行でも入りきらない名前
const app = await launch();
try {
  const p = await app.newPage("light", parseView(process.argv[2] || "1728x1152"), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p);
  await openEditor(p, "wipClass");
  const e0 = await box(p, "#dbEditor"), a0 = await box(p, "#dbEditor .de-fields"), cut0 = await cut(p);
  await drag(p, "#dbEditor .de-wgrip", -200);
  const e1 = await box(p, "#dbEditor"), f1 = await box(p, `${P("wipClass")}`);
  check(`① 左の縁で組む所が 200px 広がる（${Math.round(e0.w)} → ${Math.round(e1.w)}）・組むパネルは左に収まる`, Math.abs(e1.w - e0.w - 200) <= 2 && f1.r <= e1.l, { e0, e1, f1 });
  await drag(p, "#dbEditor .de-split", 140);
  const a1 = await box(p, "#dbEditor .de-fields"), cut1 = await cut(p), m1 = await box(p, "#dbEditor .de-main");
  check(`② 右の組み立ては 480px 以上（${Math.round(m1.w)}）`, m1.w >= 480, m1);
  check(`② カラムの欄が 140px 広がる（${Math.round(a0.w)} → ${Math.round(a1.w)}）・切れていたカラム名が見える（${cut0.length} → ${cut1.length}）`, Math.abs(a1.w - a0.w - 140) <= 2 && cut0.length > 0 && cut1.length < cut0.length, { a0, a1, cut0, cut1 });
  await p.click("[data-de-cancel]"); await sleep(300);
  await p.reload(); await waitDash(p); await openEditor(p, "wipClass");
  const e3 = await box(p, "#dbEditor"), a3 = await box(p, "#dbEditor .de-fields");
  check("③ 開き直しても幅が残る", Math.abs(e3.w - e1.w) <= 2 && Math.abs(a3.w - a1.w) <= 2, { e3, a3 });
  await p.focus("#dbEditor .de-split"); await p.keyboard.press("ArrowLeft"); await sleep(300);
  const a4 = await box(p, "#dbEditor .de-fields");
  check("④ ← で 16px 狭まる", Math.abs(a1.w - a4.w - 16) <= 2, { a1, a4 });
  await p.dblclick("#dbEditor .de-split"); await sleep(300); await p.dblclick("#dbEditor .de-wgrip"); await sleep(300);
  const e5 = await box(p, "#dbEditor"), a5 = await box(p, "#dbEditor .de-fields");
  check("④ ダブルクリックで元の幅", Math.abs(e5.w - 720) <= 2 && Math.abs(a5.w - 210) <= 2, { e5, a5 });
  await drag(p, "#dbEditor .de-wgrip", -600);
  await p.setViewportSize({ width: 1280, height: 720 }); await sleep(300);
  await p.click("[data-de-cancel]"); await sleep(300); await openEditor(p, "wipClass");
  const e6 = await box(p, "#dbEditor");
  check("⑤ 1280 では窓に収まる（右の 260px は空ける）", e6.w <= 1280 - 260 + 1 && e6.r <= 1280, e6);
  // ⑥ 2 行まで折り返すので、既定の幅でもほとんどの名前が読める／「⇔ 名前に合わせる」で 1 行に入る幅へ一度で
  await p.setViewportSize({ width: 1728, height: 1152 }); await sleep(300);
  await p.click("[data-de-cancel]"); await sleep(300); await openEditor(p, "wipClass");
  await p.dblclick("#dbEditor .de-split"); await sleep(300); await p.dblclick("#dbEditor .de-wgrip"); await sleep(300);
  const clip6 = await clipped(p), cut6 = await cut(p);
  await p.click("#dbEditor [data-de-fitcols]"); await sleep(500);
  const cut7 = await cut(p), a7 = await box(p, "#dbEditor .de-fields"), m7 = await box(p, "#dbEditor .de-main");
  check(`⑥ 既定の幅で 2 行でも切れる名前 ${clip6.length}・1 行で切れる名前 ${cut6.length} → 名前に合わせると ${cut7.length}（欄 ${Math.round(a7.w)}px・右 ${Math.round(m7.w)}px）`, cut6.length > 0 && cut7.length === 0 && m7.w >= 480, { clip6, cut6, cut7 });
  check("画面のエラーが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
