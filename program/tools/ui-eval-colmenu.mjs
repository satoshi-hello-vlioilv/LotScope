// 評価関数（開発用）: 表示列の窓の、作った列を消す・右クリックのメニュー（版 3.44.0。利用者の要望 2026-10-17 の 4・5）。
//   node program/tools/ui-eval-colmenu.mjs [1280x720]
// ① 作った列の行の右端にだけごみ箱（元データの列には無い）。押すと聞いてから消え、一覧の見出しからも消える
// ② 元データの列の右クリック: 見出しに列の名前・「この列を削除」は押せず理由が出る・Esc でメニューだけ閉じる（窓は残る）
// ③ メニューで 1 つ下へ（並びが 1 つ下がる）・一覧から隠す（チェックが外れ、一覧の見出しから消える）
// ④ F2 で表示名の欄に焦点・欄の Esc は打った名前を捨てる（窓は閉じない）・Alt+↑ で 1 つ上へ
// ⑤ 作った列の右クリック →「この列を複製」で「…のコピー」が右に足される
// ⑥ 2 列を選んで右クリック → 見出しは「2 列を選んでいます」・「選んだ作った列 2 列を削除」で 2 列とも消える
// ⑦ Delete キーで、選んだ作った列が消える／右の札の「削除」でも消える
// ⑧ 窓の下の方の行で開いても、メニューは画面に収まる
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const app = await launch();
let answer = "";
const row = (c) => `#lcList li[data-col="${c}"]`;
const rows = (p) => p.$$eval("#lcList li[data-col]", (xs) => xs.map((x) => x.dataset.col));
const heads = (p) => p.$$eval("#llHead th[data-col]", (xs) => xs.map((x) => x.dataset.col));
const menu = (p) => p.evaluate(() => { const m = document.querySelector(".tpa-menu"); if (!m) return null; const r = m.getBoundingClientRect();
  return { head: m.querySelector(".tm-head")?.textContent, items: [...m.querySelectorAll("button")].map((b) => ({ t: b.querySelector("span").firstChild.textContent, off: b.disabled, why: b.title })), r: [r.left, r.top, r.right, r.bottom], W: innerWidth, H: innerHeight }; });
const rclick = async (p, c) => { await p.$eval(row(c), (el) => el.scrollIntoView({ block: "nearest" })); const b = await (await p.$(row(c))).boundingBox(); await p.mouse.click(b.x + 90, b.y + b.height / 2, { button: "right" }); await sleep(250); };
const choose = async (p, text) => { await p.evaluate((t) => [...document.querySelectorAll(".tpa-menu button")].find((b) => b.textContent.includes(t)).click(), text); await sleep(300); };
const pick = async (p, c, opt = {}) => { const b = await (await p.$(row(c))).boundingBox(); await p.mouse.click(b.x + 90, b.y + b.height / 2, opt); await sleep(150); };   // 行の名前の所（表示名の欄ではなく）
const makeCalc = async (p, name) => { answer = name; await p.click("#lcAddCol"); await sleep(400); await p.evaluate(() => window.LotListRules.closeFormula()); await sleep(200); };
try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => (d.type() === "prompt" ? d.accept(answer) : d.accept()));
  await p.click("#llColBtn"); await sleep(600);
  await makeCalc(p, "試し列");
  const dels = await p.$$eval("#lcList li[data-col]", (xs) => xs.filter((x) => x.querySelector(".lc-del")).map((x) => x.dataset.col));
  check("① ごみ箱は作った列の行にだけ", dels.join() === "試し列", dels);
  await p.click(`${row("試し列")} .lc-del`); await sleep(300);
  check("① ごみ箱で消える（一覧の見出しからも）", !(await rows(p)).includes("試し列") && !(await heads(p)).includes("試し列"), await rows(p));

  await rclick(p, "重量");
  const m1 = await menu(p);
  const del = m1 && m1.items.find((x) => x.t.includes("この列を削除"));
  check("② 元データの列: 見出しは列の名前・削除は押せず理由が出る", m1 && m1.head === "重量" && del && del.off && /元データ/.test(del.why), m1);
  await p.keyboard.press("Escape"); await sleep(200);
  check("② Esc でメニューだけ閉じる", !(await menu(p)) && await p.$eval("#llColumnPanel", (x) => !x.hidden), "");
  const r0 = await rows(p), i0 = r0.indexOf("重量");
  await rclick(p, "重量"); await choose(p, "1 つ下へ");
  const r1 = await rows(p);
  check("③ 1 つ下へ", r1.indexOf("重量") === i0 + 1 && r1[i0] === r0[i0 + 1], { i0, r1: r1.slice(i0 - 1, i0 + 3) });
  await rclick(p, "重量"); await choose(p, "一覧から隠す");
  const hid = await p.$eval(`${row("重量")} .lc-vis`, (x) => x.checked);
  check("③ 一覧から隠す（チェックが外れ、見出しから消える）", !hid && !(await heads(p)).includes("重量"), { hid });
  await rclick(p, "重量"); await choose(p, "一覧に出す");

  await p.click(row("板厚")); await sleep(200); await p.keyboard.press("F2"); await sleep(250);
  const f2 = await p.evaluate(() => { const a = document.activeElement; return a && a.closest(".lc-inl") ? a.closest("li").dataset.col : a && a.tagName; });
  check("④ F2 で表示名の欄に焦点", f2 === "板厚", f2);
  await p.keyboard.type("仮の名");
  await p.keyboard.press("Escape"); await pick(p, "板厚");
  check("④ 表示名の欄の Esc は、打った名前を捨てて欄を離れる（窓は閉じない）", await p.evaluate(() => !document.querySelector("#llColumnPanel").hidden && !document.querySelector(".us-overlay")) && (await p.$eval(row("板厚"), (li) => li.querySelector(".lc-inl").textContent + (li.querySelector(".lc-inl input")?.value || ""))) === "", "");
  const j0 = (await rows(p)).indexOf("板厚");
  await p.keyboard.press("Alt+ArrowUp"); await sleep(250);
  check("④ Alt+↑ で 1 つ上へ", (await rows(p)).indexOf("板厚") === j0 - 1, { j0, now: (await rows(p)).indexOf("板厚") });

  await makeCalc(p, "試し列");
  await rclick(p, "試し列"); await choose(p, "この列を複製"); await p.evaluate(() => window.LotListRules.closeFormula()); await sleep(200);
  const r2 = await rows(p);
  check("⑤ 複製が右に足される", r2.indexOf("試し列のコピー") === r2.indexOf("試し列") + 1, r2.slice(-4));

  await pick(p, "試し列"); await p.keyboard.down("Control"); await pick(p, "試し列のコピー"); await p.keyboard.up("Control");
  await rclick(p, "試し列のコピー");
  const m2 = await menu(p);
  check("⑥ 2 列を選んで右クリック: 見出し", m2 && m2.head === "2 列を選んでいます" && m2.items.some((x) => x.t.includes("選んだ作った列 2 列を削除") && !x.off), m2);
  await choose(p, "選んだ作った列");
  const r3 = await rows(p);
  check("⑥ 2 列とも消える", !r3.includes("試し列") && !r3.includes("試し列のコピー"), r3.slice(-3));

  await makeCalc(p, "試し列"); await pick(p, "試し列"); await p.keyboard.press("Delete"); await sleep(300);
  check("⑦ Delete キーで消える", !(await rows(p)).includes("試し列"), "");
  await makeCalc(p, "試し列"); await p.click(row("試し列")); await sleep(200); await p.click("[data-lc-cdel]"); await sleep(300);
  check("⑦ 右の札の「削除」で消える", !(await rows(p)).includes("試し列"), "");

  const last = (await rows(p)).slice(-1)[0];
  await rclick(p, last);
  const m3 = await menu(p);
  check("⑧ 下の方の行で開いても、メニューは画面に収まる", m3 && m3.r[0] >= 0 && m3.r[1] >= 0 && m3.r[2] <= m3.W && m3.r[3] <= m3.H, m3 && m3.r);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
