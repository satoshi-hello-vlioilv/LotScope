// 評価関数（開発用。版 3.51.0。利用者の要望 2026-10-22: ABC 分析を A・B・C の 3 つに限らず、A からアルファベットを付ける）。
//   node program/tools/ui-eval-abcrank.mjs [1280x720]
// ① 線 4 本（40・60・80・95%）: 表の段の札が A〜E・どの品種の段もサーバーへ同じ組みを問い合わせた答えと同じ・
//    段は量の大きい順に進む・段の色は A（濃い）→ E（淡い）へ明るくなり、札の字は地と 4.5 以上の差・下の段の品種の数の計＝品種の数・
//    パレート図に線が 4 本
// ② 品種ごと（rankBy each）: 品種 1 つずつに A, B, C, …（数に上限なし）・パレート図に線が無い・下の段は「品種ごと A〜K 11 段」の形
// ③ 前の a・b（70・90）で保存したパネルも、今までどおり A・B・C
// ④ 組む所の ABC の段（決めた形は 2026-10-abcrank）: 線を足す → 段が 1 つ増える・線を外す → 減る・数を直す → 答えの線が替わる・
//    品種ごと に切り替える → 品種ごとの段・保存の形（lims・rankBy）。どの段も組む所に収まる（横に切れない）
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 900)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1728x1152");
const P = '#dashGrid .db-p[data-id="abc"]';
const panel = (ops) => ({ id: "abc", x: 0, y: 0, w: 12, h: 6, title: "", visual: "abc", source: "work", ops: { cls: ["合金", "調質"], ...ops }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } });
const ask = (p, x) => p.evaluate(async (y) => (await fetch("/api/dashboard/query", TPA.json("POST", { panel: y }))).json(), x);
const layout = async (p, ops) => { await p.evaluate((x) => Dashboard._setLayout({ rows: 8, panels: [x] }), panel(ops)); await sleep(400); await waitDash(p); await sleep(500); };
const shown = (p) => p.$$eval(`${P} .oa-table tbody tr`, (trs) => trs.map((tr) => ({ key: (tr.querySelectorAll(".oa-k").length ? [...tr.querySelectorAll(".oa-k")] : [tr.querySelector("th")]).map((c) => c.textContent.trim()).join("／"), rank: (tr.querySelector(".oa-rank") || {}).textContent || "",
  bg: tr.querySelector(".oa-rank") ? getComputedStyle(tr.querySelector(".oa-rank")).backgroundColor : "", fg: tr.querySelector(".oa-rank") ? getComputedStyle(tr.querySelector(".oa-rank")).color : "" })));
const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const lum = (c) => rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const order = (r) => [...r].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));

  /* ① 線 4 本 */
  await layout(p, { lims: [40, 60, 80, 95] });
  const want1 = (await ask(p, panel({ lims: [40, 60, 80, 95] }))).all;
  const rows1 = await shown(p);
  const byKey = Object.fromEntries(want1.items.map((x) => [x.key, x.rank]));
  check("① 段の札が A〜E", [...new Set(want1.items.map((x) => x.rank))].join() === "A,B,C,D,E" && want1.ranks.count === 5, want1.ranks);
  check("① 表の段がサーバーの答えと同じ", rows1.length > 0 && rows1.every((r) => byKey[r.key] === r.rank), { rows1, byKey });
  check("① 段は量の大きい順に進む（前の段に戻らない）", want1.items.every((x, i, a) => !i || order(x.rank) >= order(a[i - 1].rank)), want1.items.map((x) => x.rank));
  const firstOf = [...new Map(rows1.map((r) => [r.rank, r])).values()];
  check("① 段の色は A → E へ明るくなる", firstOf.every((r, i, a) => !i || lum(r.bg) > lum(a[i - 1].bg)), firstOf.map((r) => [r.rank, r.bg]));
  check("① 札の字は地と 4.5 以上の差", rows1.every((r) => contrast(r.bg, r.fg) >= 4.5), rows1.map((r) => [r.rank, contrast(r.bg, r.fg).toFixed(2)]));
  const foot1 = await p.$$eval(`${P} .oa-fa .oa-rank`, (bs) => bs.map((b) => [b.textContent, parseInt(b.nextSibling && b.nextSibling.textContent, 10)]));
  check("① 下の段: A〜E の品種の数の計＝品種の数", foot1.map((x) => x[0]).join() === "A,B,C,D,E" && foot1.reduce((a, x) => a + x[1], 0) === want1.items.length, foot1);
  check("① パレート図に線が 4 本", (await p.$$(`${P} .oa-chart .oa-lim`)).length === 4, (await p.$$(`${P} .oa-chart .oa-lim`)).length);

  /* ② 品種ごと */
  await layout(p, { rankBy: "each" });
  const want2 = (await ask(p, panel({ rankBy: "each" }))).all;
  const rows2 = await shown(p);
  const names = want2.items.map((_, i) => { let s = ""; for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; });
  check("② 品種ごとに A, B, C, …（上から順に 1 つずつ）", want2.items.map((x) => x.rank).join() === names.join() && rows2.map((r) => r.rank).join() === names.slice(0, rows2.length).join(), { want: want2.items.map((x) => x.rank), rows: rows2.map((r) => r.rank) });
  check("② パレート図に線が無い", !(await p.$(`${P} .oa-chart .oa-lim`)));
  const foot2 = await p.$eval(`${P} .oa-fa`, (x) => x.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
  check("② 下の段は「品種ごと A〜最後 n 段」", new RegExp(`品種ごと ?A〜${names[names.length - 1]} ${names.length} 段`).test(foot2), foot2);

  /* ③ 前の a・b */
  await layout(p, { a: 70, b: 90 });
  const rows3 = await shown(p);
  check("③ 前の a・b（70・90）のパネルは A・B・C", [...new Set(rows3.map((r) => r.rank))].every((r) => "ABC".includes(r)) && rows3.some((r) => r.rank === "C"), rows3.map((r) => r.rank));

  /* ④ 組む所 */
  if (await p.$("[data-de-abcrow]") === null) {
    await p.click("[data-db-editmode]"); await sleep(300);
    await p.click(`${P} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(500);
  }
  const ops = () => p.evaluate(() => (Dashboard._state().editing || {}).ops || null).catch(() => null);
  const ansRanks = () => p.evaluate(() => { const a = Dashboard._state().answers.abc; return a && a.all && a.all.ranks; });
  if (await p.$("[data-de-abcrow]")) {
    const fit = await p.evaluate(() => { const r = document.querySelector("[data-de-abcrow]"), box = document.querySelector("#dbEditor").getBoundingClientRect(); return [...r.querySelectorAll("*")].every((e) => { const b = e.getBoundingClientRect(); return !b.width || b.right <= box.right + 0.5; }); });
    check("④ ABC の段が組む所に収まる", fit);
    await p.click("[data-de-limadd]"); await sleep(500); await waitDash(p); await sleep(300);
    let rk = await ansRanks();
    check("④「＋ 線」で段が 1 つ増える（3 → 4 段）", rk && rk.count === 4 && rk.lims.length === 3, rk);
    const ins = await p.$$("[data-de-lim]");
    await ins[0].fill("50"); await ins[0].press("Enter"); await sleep(500); await waitDash(p); await sleep(300);
    rk = await ansRanks();
    check("④ 線の数を直すと答えの線が替わる", rk && rk.lims[0] === 50, rk);
    const ins2 = await p.$$("[data-de-lim]");
    await ins2[1].fill("50"); await ins2[1].press("Enter"); await sleep(400);
    const bad = await p.evaluate(() => ({ red: document.querySelectorAll("[data-de-lim].is-bad").length, msg: (document.querySelector("[data-de-limerr]") || {}).textContent || "" }));
    rk = await ansRanks();
    check("④ 同じ線は当てず、欄を赤くして字で知らせる", bad.red === 1 && /もうあります/.test(bad.msg) && rk.lims.join() !== "50,50", { bad, rk });
    await ins2[1].fill("70"); await ins2[1].press("Enter"); await sleep(500); await waitDash(p); await sleep(300);
    await p.click("[data-de-limx]"); await sleep(500); await waitDash(p); await sleep(300);
    rk = await ansRanks();
    check("④ 線の × で段が 1 つ減る", rk && rk.count === 3, rk);
    await p.click('.de-seg:has([data-de-rankby][value="each"])'); await sleep(500); await waitDash(p); await sleep(300);
    rk = await ansRanks();
    check("④「品種ごと」で品種ごとの段", rk && rk.each === true, rk);
    check("④ 品種ごとのときは線の欄を出さない", !(await p.$("[data-de-lim]")));
    await p.click('.de-seg:has([data-de-rankby][value=""])'); await sleep(500); await waitDash(p); await sleep(300);
    rk = await ansRanks();
    check("④「線で分ける」に戻すと線で分ける", rk && rk.each === false && rk.lims.length >= 1, rk);
  } else check("④ 組む所に ABC の段（data-de-abcrow）がある", false, "無い");
  check("頁の誤りが無い", !errors.length, errors);
} finally { await app.close(); }
console.log(fails.length ? `NG ${fails.length} 件` : "OK（すべて合いました）");
process.exit(fails.length ? 1 : 0);
