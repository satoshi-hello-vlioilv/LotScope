// 評価関数（開発用）: ダッシュボードの数の計算と単位（版 3.45.0。利用者の要望 2026-10-18 の 3）。
//   node program/tools/ui-eval-dashcalc.mjs [1280x720]
// ① 数字のパネル（前日の実績本数 21 本）に計算「×10」→ パネルの数が 210・見本も 210・書式の見出しの要約に「計算 値×10」・欄の横に「21 → 210」
// ② 札「÷60」を押すと 0.35（21÷60）。読めない式（「x+」）は知らせが出て、パネルは前の式のまま
// ③ 単位の欄はいまの字（本）。「本/日」にするとパネルの数の後ろが「本/日」・空にすると単位を出さない・「自動に戻す」で「本」
// ④ 表のパネル（仕掛区分ごと）に「×2」→ 総計がサーバーの数の 2 倍
// ⑤ 当てて名前を付けて保存 → 開き直しても計算・単位が残る
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const errors = [];
async function openEditor(p, id) {
  if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(300); }
  await p.focus(P(id)); await p.keyboard.press("Enter");
  await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
  if (!(await p.$("#dbEditor [data-de-fexpr]"))) { await p.click("#dbEditor [data-de-fmtopen]"); await sleep(200); }
}
const kpi = (p, id) => p.$eval(`${P(id)} .dp-num`, (x) => ({ num: x.firstChild ? [...x.childNodes].filter((n) => n.nodeName !== "SMALL").map((n) => n.textContent).join("") : "", unit: x.querySelector("small")?.textContent ?? "" }));
const typeExpr = async (p, sel, text) => { await p.fill(sel, ""); await p.type(sel, text); await sleep(700); await waitDash(p); await sleep(200); };
const VIEW = parseView(process.argv[2] || "1728x1152");
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p);
  const base = await kpi(p, "workTotal");
  await openEditor(p, "workTotal");
  await typeExpr(p, "#dbEditor [data-de-fexpr]", "×10");
  const k1 = await kpi(p, "workTotal");
  const sample = await p.$eval("#deNumSample td", (x) => x.textContent);
  const sum1 = await p.$eval("#dbEditor .de-fmthead small", (x) => x.textContent);
  const prev = await p.$eval("#deCalcPrev", (x) => x.textContent);
  check(`① 計算の欄の横に変わり方（${prev}）`, prev.replace(/\s/g, "") === `${base.num}→${+base.num * 10}`, prev);
  check(`① ×10 → パネルの数（${base.num} → ${k1.num}）・見本・要約`, +k1.num.replace(/,/g, "") === +base.num.replace(/,/g, "") * 10 && sample.replace(/,/g, "") === `${+base.num * 10}本` && sum1.includes("値×10"), { base, k1, sample, sum1 });
  await p.click('#dbEditor [data-de-fexq="÷60"]'); await sleep(600); await waitDash(p);
  const k2 = await kpi(p, "workTotal");
  check("② 札「÷60」", Math.abs(parseFloat(k2.num) - +base.num / 60) < 0.01, { k2, want: +base.num / 60 });
  await typeExpr(p, "#dbEditor [data-de-fexpr]", "x+");
  const warn = await p.$eval("#deCalcMsg", (x) => x.textContent);
  check("② 読めない式は知らせ・パネルは前の式のまま", /途中/.test(warn) && (await kpi(p, "workTotal")).num === k2.num, { warn });
  await typeExpr(p, "#dbEditor [data-de-fexpr]", "×10");

  const u0 = await p.$eval("#dbEditor [data-de-futext]", (x) => x.value);
  check("③ 単位の欄はいまの字（本）", u0 === "本" && base.unit === "本", { u0, base });
  await typeExpr(p, "#dbEditor [data-de-futext]", "本/日");
  check("③ 単位「本/日」", (await kpi(p, "workTotal")).unit === "本/日", await kpi(p, "workTotal"));
  await p.fill("#dbEditor [data-de-futext]", ""); await p.dispatchEvent("#dbEditor [data-de-futext]", "input"); await sleep(600);
  check("③ 空にすると単位を出さない", (await kpi(p, "workTotal")).unit === "", await kpi(p, "workTotal"));
  await p.click("#dbEditor [data-de-futextx]"); await sleep(500);
  check("③ 自動に戻す → 本", (await kpi(p, "workTotal")).unit === "本" && (await p.$eval("#dbEditor [data-de-futext]", (x) => x.value)) === "本", await kpi(p, "workTotal"));
  await typeExpr(p, "#dbEditor [data-de-futext]", "本/日");
  await p.click("[data-de-apply]"); await sleep(500);

  // ④ 表のパネル
  await openEditor(p, "wipClass");
  await p.click('[data-de-vis="none"]'); await sleep(1200); await waitDash(p);
  const g0 = await p.evaluate((sel) => +[...document.querySelectorAll(`${sel} tr.is-grand td`)].map((t) => t.textContent)[0].replace(/[^0-9.]/g, ""), P("wipClass"));
  await typeExpr(p, "#dbEditor [data-de-fexpr]", "×2");
  const g1 = await p.evaluate((sel) => +[...document.querySelectorAll(`${sel} tr.is-grand td`)].map((t) => t.textContent)[0].replace(/[^0-9.]/g, ""), P("wipClass"));
  check(`④ 表の総計が 2 倍（${g0} → ${g1}）`, g1 === g0 * 2 && g0 > 0, { g0, g1 });
  await p.click("[data-de-cancel]"); await sleep(500);

  // ⑤ 名前を付けて保存して開き直す
  await p.click("[data-db-saveas]"); await sleep(300);
  await p.fill("#dbSaveName", "計算の試し");
  await p.click("[data-db-dosave]"); await sleep(1200);
  await p.goto(`${app.base}/#screen=dash`); await waitDash(p); await sleep(500);
  const k5 = await kpi(p, "workTotal");
  check("⑤ 開き直しても計算・単位が残る", +k5.num.replace(/,/g, "") === +base.num * 10 && k5.unit === "本/日", k5);
  check("画面のエラーが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
