// 評価関数（開発用）: マスタの変換表の入力のしやすさ（版 3.44.0。利用者の要望 2026-10-17 の 1・2）。
//   node program/tools/ui-eval-convedit.mjs [1280x720]
// ① 条件を直したすぐ後に、別の欄を押しても、表の送り位置（判定表・マスタの面）が戻らず、押した欄に焦点が移る
//    （セルの条件が 2 つの所で、1 つ目の値を打ってから 2 つ目の欄を押す・出す値を打ってから次の行の出す値を押す・試すへ移る）。
//    比べ方を替えて描き直しても、送り位置と焦点が戻る。直した値は表の札にも出る。打ってすぐ「閉じる」を押しても、押したことが消えない
// ② 送る所の下に余白: 判定表をいちばん下まで送ったとき、最後の行の下・マスタの面の最後の部品の下に 24px 以上の空き
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const scrolls = (p) => p.evaluate(() => ({ grid: document.querySelector(".cv-gridwrap").scrollTop, box: document.querySelector("#masterSettings").scrollTop }));
const near = (a, b) => Math.abs(a.grid - b.grid) <= 2 && Math.abs(a.box - b.box) <= 2;
const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a ? Object.entries(a.dataset).map(([k, v]) => `${k}=${v}`).join(",") || a.id : ""; });

const app = await launch();
try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
  await p.$eval('#masterTabs [data-tab="conv"]', (b) => b.click()); await p.waitForSelector("[data-cv-save]"); await sleep(500);
  // 管理分類（35 行）の 20 行目の形状区分のセルを開き、条件を 2 つにする。表とマスタの面を、その行が真ん中に来るまで送る
  const R = 19, K = "形状区分";
  await p.evaluate(({ R, K }) => document.querySelector(`[data-cv-cell="${R}|${K}"]`).scrollIntoView({ block: "center" }), { R, K });
  await p.click(`[data-cv-cell="${R}|${K}"]`); await sleep(300);
  await p.click("[data-cv-tadd]"); await sleep(300);
  await p.evaluate(() => document.querySelector(".cv-celled").scrollIntoView({ block: "center" })); await sleep(200);
  const s0 = await scrolls(p);
  check("前提: 判定表を送ってある（送り位置が 0 でない）", s0.grid > 50, s0);
  await p.click('[data-cv-tv="0"]', { clickCount: 3 }); await p.keyboard.type("4HIｺｲﾙ");
  await p.click('[data-cv-tv="1"]'); await sleep(300);
  const s1 = await scrolls(p), f1 = await focused(p);
  check("① 1 つ目の条件を打って 2 つ目の欄を押す: 送り位置が戻らない", near(s0, s1), { s0, s1 });
  check("① 押した 2 つ目の欄に焦点が移る", f1 === "cvTv=1", f1);
  const chip = await p.$eval(`[data-cv-cell="${R}|${K}"]`, (b) => b.textContent);
  check("① 打った値が表の札に出る", chip.includes("4HIｺｲﾙ"), chip);
  await p.keyboard.type("箔"); await p.click('[data-cv-tv="0"]'); await sleep(300);
  const s2 = await scrolls(p), f2 = await focused(p);
  check("① 2 つ目を打って 1 つ目へ戻る: 送り位置が戻らず、焦点が移る", near(s0, s2) && f2 === "cvTv=0", { s0, s2, f2 });
  // 形が変わる直し（比べ方を「の範囲」に）: 描き直しても、送り位置と焦点が戻る
  const s4a = await scrolls(p);
  await p.focus('[data-cv-top="1"]'); await p.selectOption('[data-cv-top="1"]', "range"); await sleep(300);
  const s4 = await scrolls(p), f4 = await focused(p);
  check("① 比べ方を替えて描き直しても、送り位置と焦点（比べ方の欄）が戻る", near(s4a, s4) && f4 === "cvTop=1" && await p.$('[data-cv-tmin="1"]') != null, { s4a, s4, f4 });
  await p.selectOption('[data-cv-top="1"]', "eq"); await sleep(300);
  // 出す値を打って、次の行の出す値を押す
  await p.click(`[data-cv-out="${R}"]`, { clickCount: 3 }); await p.keyboard.type("試しの値");
  const s3a = await scrolls(p);
  await p.click(`[data-cv-out="${R + 1}"]`); await sleep(300);
  const s3 = await scrolls(p), f3 = await focused(p);
  check("① 出す値を打って次の行の出す値を押す: 送り位置が戻らず、焦点が移る", near(s3a, s3) && f3 === `cvOut=${R + 1}`, { s3a, s3, f3 });
  // 打ってすぐ「閉じる」: 押したことが消えない
  await p.click('[data-cv-tv="1"]', { clickCount: 3 }); await p.keyboard.type("2HI");
  await p.click("[data-cv-close]"); await sleep(300);
  const closed = await p.evaluate((sel) => ({ open: !!document.querySelector(".cv-celled"), chip: document.querySelector(sel).textContent }), `[data-cv-cell="${R}|${K}"]`);
  check("① 打ってすぐ「閉じる」を押すと閉じ、打った値は残る", !closed.open && closed.chip.includes("2HI"), closed);
  // 試すの欄: 打つたびに答えが変わり、焦点が欄に残る
  await p.click('[data-cv-try="0"]'); await p.keyboard.type("HOT"); await sleep(200);
  const tr = await p.evaluate(() => ({ f: document.activeElement?.dataset.cvTry, v: document.activeElement?.value, out: document.querySelector(".cv-tryout")?.textContent || "" }));
  check("① 試すに打つと、焦点が欄に残って答えが出る", tr.f === "0" && tr.v === "HOT" && tr.out.includes("→"), tr);

  // ② 送る所の下の余白
  const gap = await p.evaluate(() => {
    const g = document.querySelector(".cv-gridwrap"); g.scrollTop = g.scrollHeight;
    const last = g.querySelector("tbody tr:last-child").getBoundingClientRect(), gb = g.getBoundingClientRect();
    const s = document.querySelector("#masterSettings"); s.scrollTop = s.scrollHeight;
    const page = s.querySelector(".cv-page"), kids = [...page.querySelectorAll(".cv-detail > *, .sh-list > *")].map((x) => x.getBoundingClientRect().bottom);
    const sb = s.getBoundingClientRect();
    return { grid: Math.round(gb.bottom - (g.offsetHeight - g.clientHeight - (g.clientTop * 2)) - last.bottom), box: Math.round(sb.bottom - Math.max(...kids)) };
  });
  check("② 判定表をいちばん下まで送ると、最後の行の下に 24px 以上の空き", gap.grid >= 24, gap);
  check("② マスタの面をいちばん下まで送ると、最後の部品の下に 24px 以上の空き", gap.box >= 24, gap);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
