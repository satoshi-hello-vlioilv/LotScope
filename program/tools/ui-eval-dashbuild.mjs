// 評価関数（開発用）: ダッシュボードのパネルの「組む」ボタンの意味と挙動（版 3.69.0。利用者の要望 2026-11-04 の 3）。
//   node program/tools/ui-eval-dashbuild.mjs [--view 1728x1152]
// 組んでいるパネルの見出しのボタンは「組んでいます」（押せない・押した形）になり、押しても・Enter でもパネルの大きさと置き場が変わらない。
// 組む所を閉じると「組む」に戻る。頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const rect = (p, sel) => p.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });

const viewArg = process.argv.includes("--view") ? process.argv[process.argv.indexOf("--view") + 1] : "1728x1152";
const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView(viewArg), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p); await sleep(1200);
  const id = (await p.evaluate(() => Dashboard._state().layout.panels.find((x) => x.visual !== "board").id));
  await p.click("[data-db-editmode]"); await sleep(500);
  await p.click(`${P(id)} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await sleep(900);
  const r1 = await rect(p, P(id));
  const btn = await p.$eval(`${P(id)} [data-db-edit], ${P(id)} [data-db-editing]`, (b) => ({ text: b.textContent.trim(), disabled: b.disabled, pressed: b.getAttribute("aria-pressed") }));
  check("組んでいるパネルのボタンは「組んでいます」・押せない・押した形", /組んでいます/.test(btn.text) && btn.disabled && btn.pressed === "true", btn);
  // 押す（押せなくても DOM の click を送る）・Enter を押す → 大きさと置き場が変わらない
  await p.evaluate((s) => { const b = document.querySelector(`${s} [data-db-edit], ${s} [data-db-editing]`); b && b.click(); }, P(id)); await sleep(600);
  const r2 = await rect(p, P(id));
  check("組んでいる最中に押しても、パネルの大きさと置き場が変わらない", JSON.stringify(r1) === JSON.stringify(r2), { r1, r2 });
  await p.evaluate((s) => document.querySelector(s).focus(), P(id)); await p.keyboard.press("Enter"); await sleep(600);
  const r3 = await rect(p, P(id));
  check("組んでいる最中に Enter を押しても、変わらない", JSON.stringify(r1) === JSON.stringify(r3), { r1, r3 });
  // 閉じると「組む」に戻る
  await p.evaluate(() => { const b = document.querySelector("[data-de-cancel]") || [...document.querySelectorAll("#dashEditor button")].find((x) => /やめる|閉じる/.test(x.textContent)); b && b.click(); }); await sleep(800);
  const back = await p.$eval(`${P(id)} [data-db-edit]`, (b) => ({ text: b.textContent.trim(), disabled: b.disabled }));
  check("組む所を閉じると「組む」に戻り、押せる", back.text === "組む" && !back.disabled, back);
  check("頁の誤りが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
