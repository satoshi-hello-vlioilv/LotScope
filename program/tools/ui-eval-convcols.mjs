// 評価関数（開発用）: 変換表の入力の「当てる列」を、取り込んでいるデータの列から選ぶ（版 3.44.0。利用者の要望 2026-10-17 の 3）。
//   node program/tools/ui-eval-convcols.mjs [1280x720]
// ① /api/data/columns: データ元ごと（品質データ・作業実績・仕掛）の実際の列と値の見本。どの列もそのデータ元の表に有る名前
// ② 入力の札を押すと、データ元ごとの段に列が並ぶ（数がサーバーの答えと合う）。値で探せる（A5052 → 仕掛の製造材質）
// ③ データで名前が違う同じ意味の列を選べる: 品質データの「合金」と仕掛の「製造材質」を選ぶと、札に 2 つ（それぞれ有るデータの印 1 つ）。
//    ↑ で順を替えられ、データに無い名前は手で足せて「!」の印。× で外せる
// ④ 選んだ列は一覧で当たる: 品質データの列の並びでは「合金」、仕掛では「製造材質」（Conversions.matchColumn）。保存すると表に残る
// ⑤ 面はマスタ管理の窓の中に収まる（面ごとは送らない）・同じ名前の列にはほかのデータの印・Esc で閉じる
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const app = await launch();
try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  const api = await p.evaluate(async () => (await (await fetch("/api/data/columns")).json()).sources);
  const by = Object.fromEntries(api.map((s) => [s.key, s]));
  check("① データ元ごとの列（品質データ・作業実績・仕掛）と値の見本", ["lot", "work", "src:wip"].every((k) => by[k] && by[k].columns.length > 5)
    && by.lot.columns.some((c) => c.column === "合金") && by["src:wip"].columns.some((c) => c.column === "製造材質" && c.samples.length), api.map((s) => [s.key, s.columns.length, s.error]));
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
  await p.$eval('#masterTabs [data-tab="conv"]', (b) => b.click()); await p.waitForSelector("[data-cv-save]"); await sleep(500);
  await p.click("[data-cv-new]"); await sleep(300);
  await p.fill("#cvName", "試しの材質"); await p.press("#cvName", "Tab");
  await p.click('[data-cv-cols="0"]'); await p.waitForSelector(".cv-cpi"); await sleep(300);
  const secs = await p.$$eval(".cv-cpsrc", (xs) => xs.map((s) => ({ name: s.querySelector("h5").textContent, n: s.querySelectorAll(".cv-cpi").length })));
  check("② データ元ごとの段に列が並ぶ（数がサーバーと合う）", secs.length === api.length && secs.every((s, i) => s.n === api[i].columns.length), { secs, api: api.map((s) => s.columns.length) });
  await p.fill("[data-cp-q]", "A5052"); await sleep(200);
  const found = await p.$$eval(".cv-cpi b", (xs) => xs.map((b) => b.firstChild.textContent));
  check("② 値で探せる（A5052 → 製造材質）", found.includes("製造材質") && !found.includes("ロット番号"), found);
  await p.fill("[data-cp-q]", ""); await sleep(200);
  const pick = async (sec, col) => p.evaluate(({ sec, col }) => { const s = [...document.querySelectorAll(".cv-cpsrc")][sec]; [...s.querySelectorAll(".cv-cpi")].find((l) => l.querySelector("b").firstChild.textContent === col).querySelector("input").click(); }, { sec, col });
  const iLot = api.findIndex((s) => s.key === "lot"), iWip = api.findIndex((s) => s.key === "src:wip");
  await pick(iLot, "合金"); await sleep(150); await pick(iWip, "製造材質"); await sleep(200);
  const btn = await p.$$eval('[data-cv-cols="0"] .cv-alias', (xs) => xs.map((x) => ({ name: x.querySelector("b").textContent, tags: [...x.querySelectorAll(".cv-src")].map((i) => i.title) })));
  check("③ 札に 2 つ（それぞれ有るデータの印。合金は仕掛に無い）", btn.length === 2 && btn[0].name === "合金" && btn[0].tags.some((t) => t.startsWith(by.lot.name)) && !btn[0].tags.some((t) => t.startsWith(by["src:wip"].name))
    && btn[1].name === "製造材質" && btn[1].tags[0].startsWith(by["src:wip"].name), btn);
  await p.click('[data-cp-up="1"]'); await sleep(150);
  const order = await p.$$eval('[data-cv-cols="0"] .cv-alias b', (xs) => xs.map((b) => b.textContent));
  check("③ ↑ で順を替える", order.join() === "製造材質,合金", order);
  await p.fill("[data-cp-own]", "計算した材質"); await p.click("[data-cp-add]"); await sleep(150);
  const own = await p.$$eval('[data-cv-cols="0"] .cv-alias', (xs) => xs.map((x) => [x.querySelector("b").textContent, x.querySelector(".cv-src.is-none") ? "!" : ""]));
  check("③ データに無い名前を手で足すと「!」", own.length === 3 && own[2][0] === "計算した材質" && own[2][1] === "!", own);
  await p.click('[data-cp-drop="2"]'); await sleep(150);
  const fit = await p.evaluate(() => { const r = document.querySelector(".cv-colpop").getBoundingClientRect(), m = document.querySelector("#masterOverlay .master-panel").getBoundingClientRect();
    const s = document.querySelector(".cv-colpop"); return { l: r.left - m.left, r: m.right - r.right, b: m.bottom - r.bottom, scroll: s.scrollHeight - s.clientHeight }; });
  check("⑤ 面がマスタ管理の窓の中に収まり、面ごとは送らない", fit.l >= 0 && fit.r >= 0 && fit.b >= 0 && fit.scroll <= 1, fit);
  const also = await p.evaluate(() => [...document.querySelectorAll(".cv-cpsrc")].map((s) => [...s.querySelectorAll(".cv-cpi")].find((l) => l.querySelector("b").firstChild.textContent === "ロット番号")?.querySelectorAll(".cv-also .cv-src").length));
  // ロット番号の無いデータ（試験用のマスタ。版 3.53.0）は数えない
  const has = also.filter((n) => n != null);
  check("⑤ 同じ名前の列には、ほかのデータの印（ロット番号は 3 つのデータに有る → ほか 2 つ）", has.length === 3 && has.every((n) => n === 2), also);
  await p.keyboard.press("Escape"); await sleep(150);
  check("⑤ Esc で閉じる", !(await p.$(".cv-colpop")), "");
  const match = await p.evaluate(({ lot, wip }) => { const cs = window.__draftCols = ["製造材質", "合金"]; return [Conversions.matchColumn(cs, lot), Conversions.matchColumn(cs, wip)]; },
    { lot: by.lot.columns.map((c) => c.column), wip: by["src:wip"].columns.map((c) => c.column) });
  check("④ 品質データでは「合金」、仕掛では「製造材質」に当たる", match[0] === "合金" && match[1] === "製造材質", match);
  await p.click("[data-cv-save]"); await sleep(800);
  const saved = await p.evaluate(async () => (await (await fetch("/api/masters/conversions")).json()).items.find((x) => x.name === "試しの材質"));
  check("④ 保存すると表に残る", saved && saved.inputs[0].columns.join() === "製造材質,合金", saved && saved.inputs);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
