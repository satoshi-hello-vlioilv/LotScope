// 評価関数（開発用。版 3.73.0。利用者の知らせ 2026-11-05）: ダッシュボードのガント・ABC で作業開始・作業終了の列を選ぶと、その列で数える。
//   node program/tools/ui-eval-dashopscol.mjs [1280x720]
// 組む所で ① 作業開始・作業終了の候補に、日付・日時の列と組む所で作った計算列が並ぶ ② 選ぶと答えの列（startColumn・endColumn）と棒が替わる
// ③ 計算列（組む所の「＋ 計算列」）を作業開始・作業終了に選んでも効く・式が問い合わせに載る ④「当てる」と保存のあと、開き直しても選んだ列のまま
// ⑤ 計算列の名前を変える・消すと、作業開始・作業終了・色分け・棒の字・期間の列の名前も付いていく（消したら自動へ戻る）
// ⑥ 一覧で設備ごとに作った同じ名前の計算列は、選んだ設備の式で数える（ほかの設備の違う式を使わない）
// ⑦ 選んだ設備どうしで式が違えば、先に選んだ設備の式で数え、組む所で知らせる
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${String(JSON.stringify(got)).slice(0, 900)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1728x1152");
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const OPS = { rows: 8, panels: [
  { id: "gantt", x: 0, y: 0, w: 12, h: 8, title: "", visual: "gantt", source: "work", period: { column: "@workday", kind: "days", n: 2 }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } }] };
const answer = (p, id) => p.evaluate((k) => Dashboard._state().answers[k], id);
const panel = (p, id) => p.evaluate((k) => Dashboard._state().layout.panels.find((x) => x.id === k), id);
const bars = (a) => (a && a.equips ? a.equips.reduce((s, e) => s + (e.ops || []).length, 0) : -1);
const firstBar = (a) => { const e = a && a.equips && a.equips.find((x) => (x.ops || []).length); return e ? e.ops[0].slice(0, 2) : null; };
const settle = async (p) => { await sleep(250); await waitDash(p); await sleep(500); };
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p);
  await p.evaluate((x) => Dashboard._setLayout(x), OPS); await settle(p);
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.click(`${P("gantt")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await settle(p);
  const a0 = await answer(p, "gantt");
  check("初めは自動の列で数える（startColumn・endColumn がある・棒がある）", a0 && a0.startColumn && a0.endColumn && bars(a0) > 0, a0 && [a0.startColumn, a0.endColumn, bars(a0), a0.error]);
  const opt = (k) => p.$$eval(`[data-de-o${k}] option`, (os) => os.map((o) => o.value));
  const so = await opt("start"), eo = await opt("end");
  check("① 作業開始の候補に、いまの作業開始の列", so.includes(a0.startColumn), so);
  check("① 作業終了の候補に、いまの作業終了の列", eo.includes(a0.endColumn), eo);

  // ② 作業終了に作業開始の列を選ぶ → 作業終了が作業開始より前（同じ時刻）で、棒が無くなる（選んだ列で数えた印）
  await p.selectOption("[data-de-oend]", a0.startColumn); await settle(p);
  const a1 = await answer(p, "gantt");
  check("② 作業終了を選ぶと、答えの作業終了の列が替わる", a1.endColumn === a0.startColumn, a1.endColumn);
  check("② 選んだ作業終了の列で数える（同じ時刻なので棒は出ない）", bars(a1) === 0, bars(a1));
  await p.selectOption("[data-de-oend]", ""); await settle(p);
  const a2 = await answer(p, "gantt");
  check("② 自動に戻すと、元の作業終了の列と棒の数", a2.endColumn === a0.endColumn && bars(a2) === bars(a0), [a2.endColumn, bars(a2), bars(a0)]);

  // ③ 計算列を作り、作業開始・作業終了に選ぶ（元の列の写し → 同じ棒）
  const mkCalc = async (name, expr) => {
    await p.click("[data-de-calcnew]"); await p.waitForSelector("#deCalcName");
    await p.fill("#deCalcName", name); await p.fill("#deCalcExpr", expr);
    await p.evaluate(() => { const x = document.querySelector("#deCalcExpr"); x.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(200); await p.click("[data-de-calcok]"); await settle(p);
  };
  await mkCalc("開始の写し", `[${a0.startColumn}]`);
  await mkCalc("終了の写し", `[${a0.endColumn}]`);
  const so2 = await opt("start"), eo2 = await opt("end");
  check("③ 作業開始・作業終了の候補に、組む所で作った計算列が並ぶ", so2.includes("開始の写し") && eo2.includes("終了の写し"), { so2, eo2 });
  await p.selectOption("[data-de-ostart]", "開始の写し").catch(() => {}); await settle(p);
  await p.selectOption("[data-de-oend]", "終了の写し").catch(() => {}); await settle(p);
  const a3 = await answer(p, "gantt"), pn3 = await panel(p, "gantt");
  check("③ 計算列を選ぶと、答えの列がその計算列", a3.startColumn === "開始の写し" && a3.endColumn === "終了の写し", [a3.startColumn, a3.endColumn, a3.error]);
  check("③ 計算列の式が問い合わせに載る", pn3.calc && pn3.calc.formulas && pn3.calc.formulas["開始の写し"] && pn3.calc.formulas["終了の写し"], pn3.calc);
  check("③ 元の列の写しなので、棒の数と最初の棒が自動のときと同じ", bars(a3) === bars(a0) && JSON.stringify(firstBar(a3)) === JSON.stringify(firstBar(a0)), [bars(a3), bars(a0), firstBar(a3), firstBar(a0)]);

  // ④ 当てる → 保存 → 開き直す
  await p.click("[data-de-apply]"); await settle(p);
  const pn4 = await panel(p, "gantt");
  check("④ 当てたあとも、選んだ作業開始・作業終了の列", pn4.ops && pn4.ops.start === "開始の写し" && pn4.ops.end === "終了の写し", pn4.ops);
  const a4 = await answer(p, "gantt");
  check("④ 当てたあとの答えも、選んだ列で数える", a4.startColumn === "開始の写し" && a4.endColumn === "終了の写し" && bars(a4) === bars(a0), [a4.startColumn, a4.endColumn, bars(a4)]);
  await p.click(`${P("gantt")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await settle(p);
  const sel = await p.evaluate(() => [document.querySelector("[data-de-ostart]").value, document.querySelector("[data-de-oend]").value]);
  check("④ 組む所を開き直すと、選んだ列が選ばれている", sel[0] === "開始の写し" && sel[1] === "終了の写し", sel);

  // ⑤ 計算列の名前を変える → 作業開始の列も付いていく。消す → 自動に戻る
  await p.click('[data-de-calcopen="開始の写し"]'); await p.waitForSelector("#deCalcName");
  await p.fill("#deCalcName", "開始C"); await sleep(150); await p.click("[data-de-calcok]"); await settle(p);
  const pn5 = await panel(p, "gantt"), a5 = await answer(p, "gantt");
  check("⑤ 計算列の名前を変えると、作業開始の列の名前も替わる", pn5.ops && pn5.ops.start === "開始C" && a5.startColumn === "開始C", [pn5.ops, a5.startColumn, a5.error]);
  await p.click('[data-de-calcopen="終了の写し"]'); await p.waitForSelector("[data-de-calcdel]");
  p.once("dialog", (d) => d.accept());
  await p.click("[data-de-calcdel]"); await settle(p);
  const pn6 = await panel(p, "gantt"), a6 = await answer(p, "gantt");
  check("⑤ 計算列を消すと、作業終了の列は自動に戻り、元の列で数える", !(pn6.ops || {}).end && a6.endColumn === a0.endColumn && !a6.error, [pn6.ops, a6.endColumn, a6.error]);
  await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);

  // ⑥ 一覧の表示列で作った計算列（設備ごとの設定）。同じ名前の計算列がほかの設備で違う式でも、選んだ設備（HOT）の式で数える
  //   （利用者の知らせ 2026-11-05: HOT の「作業終了時刻」を選んでも、名前の順で先の設備の式〈作業開始と同じ時刻〉で数え、どの作業も「作業終了が作業開始より前」）
  const eqs = await p.evaluate(async () => ((await fetch("/api/dashboard/sources").then((r) => r.json())).items.find((x) => x.key === "work") || {}).equips || []);
  const key = (n) => (eqs.find((e) => e.name === n) || {}).key;
  const others = eqs.map((e) => e.key).filter((k) => k !== key("HOT"));
  // ほかの設備すべてに、同じ名前で違う式（作業開始の写し）を置く。キーは毎回変わるので、HOT より先の設備があるときに前の版の誤りが出る（12 台中 11 台がほかの設備）
  check("⑥ 試験の前提: 設備のキーの順で HOT より先の設備がある", others.some((k) => k < key("HOT")), [others.sort()[0], key("HOT")]);
  await p.evaluate(([hot, oth, sc, ec]) => {
    const LC = window.LotListColumns;
    LC.replaceLayout(`worklog:${hot}:`, { formulas: { 作業終了時刻: `[${ec}]`, 作業開始時刻: `[${sc}]` }, names: { 作業終了時刻: "作業終了" } });
    oth.forEach((k) => LC.replaceLayout(`worklog:${k}:`, { formulas: { 作業終了時刻: `[${sc}]`, 作業開始時刻: `[${sc}]` }, names: { 作業終了時刻: "作業終了" } }));
  }, [key("HOT"), others, a0.startColumn, a0.endColumn]);
  const HOT = { rows: 8, panels: [{ ...OPS.panels[0], id: "hot", equips: ["HOT"] }] };
  await p.evaluate((x) => Dashboard._setLayout(x), HOT); await settle(p);
  const h0 = await answer(p, "hot");
  await p.click("[data-db-editmode]").catch(() => {}); await sleep(300);
  await p.click(`${P("hot")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await settle(p);
  const he = await opt("end");
  check("⑥ 作業終了の候補に、一覧で作った計算列「作業終了時刻」", he.includes("作業終了時刻"), he);
  await p.selectOption("[data-de-ostart]", "作業開始時刻").catch(() => {}); await settle(p);
  await p.selectOption("[data-de-oend]", "作業終了時刻").catch(() => {}); await settle(p);
  const h1 = await answer(p, "hot"), hp = await panel(p, "hot");
  check("⑥ 問い合わせに載る式は、選んだ設備 HOT の式", hp.calc && hp.calc.formulas && hp.calc.formulas["作業終了時刻"] === `[${a0.endColumn}]`, hp.calc);
  check("⑥ HOT の式で数える（棒の数が元の列のときと同じ・区間の分からない作業が無い）",
    h1.endColumn === "作業終了時刻" && bars(h1) === bars(h0) && bars(h1) > 0, [h1.endColumn, bars(h1), bars(h0), h1.error, (h1.equips || []).map((e) => e.why)]);
  await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);

  // ⑦ 設備を 2 つ選び、同じ名前の計算列の式が設備で違う: 先に選んだ設備（HOT）の式で数え、組む所で知らせる
  const two = { rows: 8, panels: [{ ...OPS.panels[0], id: "two", equips: ["HOT", eqs.find((e) => e.name !== "HOT").name], ops: { start: "作業開始時刻", end: "作業終了時刻" } }] };
  await p.evaluate((x) => Dashboard._setLayout(x), two); await settle(p);
  await p.click("[data-db-editmode]").catch(() => {}); await sleep(300);
  await p.click(`${P("two")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await settle(p);
  await p.selectOption("[data-de-oend]", ""); await settle(p); await p.selectOption("[data-de-oend]", "作業終了時刻"); await settle(p);
  const tp = await panel(p, "two"), warn = await p.$eval("#deFields", (el) => (el.querySelector(".de-ophint.is-warn") || {}).textContent || "").catch(() => "");
  check("⑦ 設備を 2 つ選んでも、先に選んだ設備 HOT の式", tp.calc && tp.calc.formulas && tp.calc.formulas["作業終了時刻"] === `[${a0.endColumn}]`, tp.calc);
  check("⑦ 設備で式が違う計算列を、組む所で知らせる（名前と、どの設備の式か）", warn.includes("作業終了時刻") && warn.includes("HOT"), warn);
  await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);
  check("頁の誤りが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
