// 評価関数（開発用。版 3.74.0。利用者の知らせ 2026-11-05）: ダッシュボードの組む所で、設備を選ぶ面を下へ送ってチェックしても、送り位置が戻らない。
//   node program/tools/ui-eval-dashscroll.mjs [1280x720]
// ① 設備の並びを下へ送り、下の方の設備にチェック → 並びの送り位置がそのまま・押した設備が見えている・チェックが付いている
// ② もう 1 つチェック・外す（すべての設備に戻す）でも同じ ③ 組む所の右の欄（数え方）を下へ送ってチェックしても、右の欄の送り位置が戻らない
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${String(JSON.stringify(got)).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1728x1152");
const LAY = { rows: 8, panels: [{ id: "bar", x: 0, y: 0, w: 12, h: 8, title: "", visual: "bar", source: "work",
  body: { rows: [{ column: "@equip" }], cols: [], measures: [{ agg: "lots" }] } }] };
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p);
  await p.evaluate((x) => Dashboard._setLayout(x), LAY); await sleep(800); await waitDash(p);
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.click('#dashGrid .db-p[data-id="bar"] [data-db-edit]'); await p.waitForSelector("#deFields .pv-f"); await sleep(500);
  await p.click("[data-de-eqopen]"); await p.waitForSelector(".de-eqbox .df-grid label"); await sleep(400);
  // 試験の設備は 12 台なので、並びの高さを詰めて送れる形にする（本物では設備が多いと送れる）
  await p.addStyleTag({ content: ".de-eqbox .df-grid{max-height:64px!important}" });
  const state = () => p.evaluate(() => {
    const g = document.querySelector(".de-eqbox .df-grid"), m = document.querySelector("#dbEditor .de-main");
    return { top: g ? g.scrollTop : -1, max: g ? g.scrollHeight - g.clientHeight : -1, main: m ? m.scrollTop : -1,
      on: [...document.querySelectorAll(".de-eqbox .df-it.on input")].map((x) => x.dataset.ckDeq) };
  });
  const s0 = await state();
  check("前提: 設備の並びが送れる（見えない設備がある）", s0.max > 20, s0);
  await p.evaluate(() => { const g = document.querySelector(".de-eqbox .df-grid"); g.scrollTop = g.scrollHeight; });
  await sleep(150);
  const s1 = await state();
  // いちばん下の段の設備を押す（見えている物）
  const last = await p.evaluate(() => { const xs = [...document.querySelectorAll(".de-eqbox .df-it input")]; return xs[xs.length - 1].dataset.ckDeq; });
  await p.click(`.de-eqbox input[data-ck-deq="${last}"]`); await sleep(700);
  const s2 = await state();
  check("① チェックが付く", s2.on.includes(last), s2.on);
  check("① 並びの送り位置が戻らない（下へ送ったまま）", Math.abs(s2.top - s1.top) <= 2 && s2.top > 0, [s1.top, s2.top]);
  const vis = (v) => p.evaluate((x) => {
    const g = document.querySelector(".de-eqbox .df-grid"), it = g && g.querySelector(`input[data-ck-deq="${CSS.escape(x)}"]`);
    if (!it) return false;
    const a = g.getBoundingClientRect(), b = it.closest("label").getBoundingClientRect();
    return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
  }, v);
  check("① 押した設備が見えている", await vis(last), last);
  // ② もう 1 つ（下から 2 つ目）・外す
  const prev = await p.evaluate(() => { const xs = [...document.querySelectorAll(".de-eqbox .df-it input")]; return xs[xs.length - 2].dataset.ckDeq; });
  await p.click(`.de-eqbox input[data-ck-deq="${prev}"]`); await sleep(700);
  const s3 = await state();
  check("② もう 1 つ押しても送り位置が戻らない・2 つ付く", Math.abs(s3.top - s1.top) <= 2 && s3.on.includes(prev) && s3.on.includes(last), [s1.top, s3.top, s3.on]);
  await p.click(`.de-eqbox input[data-ck-deq="${last}"]`); await sleep(700);
  const s4 = await state();
  check("② 外しても送り位置が戻らない", Math.abs(s4.top - s1.top) <= 2 && !s4.on.includes(last), [s1.top, s4.top, s4.on]);
  // ③ 右の欄そのものを送ってからチェック
  await p.addStyleTag({ content: "#dbEditor .de-main{max-height:260px!important;overflow:auto!important}" });
  await p.evaluate(() => { const m = document.querySelector("#dbEditor .de-main"); m.scrollTop = Math.min(m.scrollHeight, document.querySelector(".de-eqbox").offsetTop - 20); });
  await sleep(150);
  const m1 = await state();
  await p.click(`.de-eqbox input[data-ck-deq="${prev}"]`); await sleep(700);
  const m2 = await state();
  check("③ 右の欄を送ってチェックしても、右の欄の送り位置が戻らない", m1.main > 0 && Math.abs(m2.main - m1.main) <= 2, [m1.main, m2.main]);
  check("頁の誤りが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
