// 評価関数（開発用）: ダッシュボードの組む所の「設備」で、その元のすべての設備を選べるか（版 3.69.0。利用者の要望 2026-11-04 の 1）。
//   node program/tools/ui-eval-dasheq.mjs [--view 1728x1152]
// 期間・条件の付いたパネル（前日の実績など）を組む所で開き、「設備 ▾」の並びに出る設備が、その元の全部の設備（期間・条件で絞らない
// @equip の段。サーバーへ直接問い合わせた答え）と同じかを見る。期間に作業の無い設備も選べること・件数はパネルの期間・条件の数であること。
// 頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), panel);
const click = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const equipsAsked = async (p, panel) => {
  const d = await ask(p, { visual: "none", source: panel.source, equip: panel.equip || "", filters: panel.filters || [], period: panel.period || null,
    basis: panel.basis || "work", body: { rows: [{ column: "@equip" }], cols: [], measures: [{ agg: "count" }], grand: false } });
  const lab = d.labels[0] || {};
  return (d.orders[0] || []).filter((k) => k !== "").map((k) => String(lab[k] ?? k));
};

const viewArg = process.argv.includes("--view") ? process.argv[process.argv.indexOf("--view") + 1] : "1728x1152";
const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView(viewArg), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p); await sleep(1500);
  const panels = (await p.evaluate(() => Dashboard._state().layout)).panels;
  const target = panels.find((x) => x.source === "work" && x.period && x.visual !== "kpi") || panels.find((x) => x.source === "work" && x.period);
  check("期間の付いた作業実績のパネルがある", !!target, panels.map((x) => [x.id, x.source, x.period]));
  const all = await equipsAsked(p, { source: target.source, equip: target.equip });
  // 期間・条件で当たる設備を少なくする（本物では「前日」に作業の無い設備が多い）: 1 台の設備にしか無い作業日で絞る
  const days = await ask(p, { visual: "none", source: target.source, equip: target.equip || "", filters: [], period: null, basis: "work",
    body: { rows: [{ column: "@workday" }, { column: "@equip" }], cols: [], measures: [{ agg: "count" }], grand: false } });
  const perDay = new Map();
  for (const c of days.cells.filter((x) => x.r.length === 2)) perDay.set(c.r[0], (perDay.get(c.r[0]) || 0) + 1);
  const lab0 = days.labels[0] || {};
  const few = [...perDay.entries()].sort((a, b) => a[1] - b[1])[0];
  const day = few ? String(few[0]) : ""; void lab0;
  target.period = { column: "@workday", kind: "range", from: day, to: day };
  const inPeriod = await equipsAsked(p, target);
  check(`前提: その元の設備（${all.length} 台）は、パネルの期間で絞った設備（${inPeriod.length} 台）より多い（期間に作業の無い設備がある）`, all.length > inPeriod.length, { all, inPeriod });
  await click(p, "[data-db-editmode]"); await sleep(400);
  await p.focus(P(target.id)); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await sleep(800);
  // 組む所で期間をその 1 日にする（日付で決める）
  const set = (sel, v) => p.evaluate(([q, x]) => { const el = document.querySelector(q); el.value = x; el.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
  await set("[data-de-pkind]", "range"); await sleep(400);
  await set("[data-de-pfrom]", day); await sleep(200); await set("[data-de-pto]", day); await sleep(1200);
  await click(p, "[data-de-eqopen]"); await p.waitForSelector("[data-ck-deq]", { timeout: 15000 }); await sleep(500);
  const shown = await p.evaluate(() => [...document.querySelectorAll("[data-ck-deq]")].map((x) => x.dataset.ckDeq));
  const more = await p.evaluate(() => [...document.querySelectorAll(".de-eqbox .df-n")].map((x) => x.textContent).join(" "));
  check(`組む所の「設備」に、その元のすべての設備（${all.length} 台）が並ぶ`, all.every((n) => shown.includes(n)) && !/ほか \d+/.test(more), { shown, all, more });
  const missing = all.filter((n) => !inPeriod.includes(n));
  if (missing.length && shown.includes(missing[0])) {
    await p.evaluate((v) => [...document.querySelectorAll("[data-ck-deq]")].find((x) => x.dataset.ckDeq === v).click(), missing[0]); await sleep(800);
    const eq = (await p.evaluate((id) => Dashboard._state().layout.panels.find((x) => x.id === id), target.id)) || {};
    const ed = await p.evaluate(() => (window.DashEditor && DashEditor._panel) ? DashEditor._panel() : null);
    const picked = (ed && ed.equips) || eq.equips || [];
    const btn = await p.$eval("[data-de-eqopen]", (x) => x.textContent);
    check(`期間に作業の無い設備（${missing[0]}）も選べ、ボタンにその名前が出る`, btn.includes(missing[0]), { btn, picked });
    const n0 = await p.evaluate((v) => { const el = [...document.querySelectorAll("[data-ck-deq]")].find((x) => x.dataset.ckDeq === v); return el ? (el.closest("label").querySelector("small") || {}).textContent || "" : ""; }, missing[1] || missing[0]);
    check("期間に作業の無い設備の件数は 0 件と出る（件数はパネルの期間・条件の数）", /\b0件/.test(n0), n0);
    const nIn = await p.evaluate((v) => { const el = [...document.querySelectorAll("[data-ck-deq]")].find((x) => x.dataset.ckDeq === v); return el ? (el.closest("label").querySelector("small") || {}).textContent || "" : ""; }, inPeriod[0]);
    check("期間に作業のある設備の件数は 1 件以上", /[1-9][\d,]*件/.test(nIn), nIn);
  }
  check("頁の誤りが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
