// 評価関数（開発用。版 3.50.0。利用者の要望 2026-10-22 の 3）: ウォーターフォール図（ダッシュボードのパネルと一覧の集計表）。
//   node program/tools/ui-eval-waterfall.mjs [1280x720]
// ① 設備ごとのロット数（直近 7 日）: 棒の数＝設備の数＋計・計の数＝サーバーの総計・どの棒も前の棒の終わりから始まる（点線でつなぐ）
// ② 作業日ごとのロット数（前との差）: 正の値は「増加」・負の値は「減少」の棒（色だけでなく凡例の ▲▼ と数値ラベルの ＋−）・平均など足せない値には計の棒を出さない
// ③ 値の計算（÷1000）を当てた重量の合計: 計の数＝サーバーの総計 ÷ 1000（パネルの題に［値÷1000］）
// ④ 一覧の集計表でもグラフの形「ウォーターフォール」を選べ、棒が描ける
// ⑤ どの大きさのパネルでも、棒・字が図からはみ出さない
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash, pickChart } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const VIEW = parseView(process.argv[2] || "1728x1152");
const L = { rows: 8, panels: [
  { id: "wf1", x: 0, y: 0, w: 6, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] }, fmt: { labels: "top" } },
  { id: "wf2", x: 6, y: 0, w: 6, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 14 }, body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots", show: "diff" }] }, fmt: { labels: "top" } },
  { id: "wf3", x: 0, y: 4, w: 4, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "sum", column: "重量", expr: "÷1000" }] }, fmt: { labels: "top" } },
  { id: "wf4", x: 4, y: 4, w: 4, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "avg", column: "重量" }] } },
  { id: "wf5", x: 8, y: 4, w: 4, h: 2, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] } }] };
const errors = [];
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.evaluate((l) => Dashboard._setLayout(l), L); await sleep(800); await waitDash(p); await sleep(900);
  const read = (id) => p.evaluate((id) => {
    const el = document.querySelector(`#dashGrid .db-p[data-id="${id}"]`), svg = el.querySelector("svg[aria-label='ウォーターフォール図']");
    if (!svg) return null;
    const vb = svg.viewBox.baseVal, bars = [...svg.querySelectorAll("rect.pv-wf")].map((r) => ({ kind: [...r.classList].find((c) => c.startsWith("pv-wf-")).slice(6), x: +r.getAttribute("x"), y: +r.getAttribute("y"), w: +r.getAttribute("width"), h: +r.getAttribute("height"), t: r.querySelector("title").textContent }));
    // 字の外形は画面上の位置で測る（getBBox は回す前の座標なので、斜めの字を外と数えてしまう）
    const sr = svg.getBoundingClientRect();
    const out = [...svg.querySelectorAll("text")].map((t) => t.getBoundingClientRect()).filter((b) => b.left < sr.left - 1 || b.top < sr.top - 1 || b.right > sr.right + 1 || b.bottom > sr.bottom + 1).length;
    return { bars, links: svg.querySelectorAll(".pv-wf-link").length, legend: el.querySelector(".pv-legend")?.textContent || "", labels: [...svg.querySelectorAll("text.pv-vl")].map((t) => t.textContent), title: el.querySelector(".db-ttl, h3")?.textContent || "", out, W: vb.width, H: vb.height };
  }, id);
  const ans = (id) => p.evaluate((id) => Dashboard._state().answers[id], id);
  // ①
  const a1 = await ans("wf1"), r1 = await read("wf1");
  const rows1 = a1.cells.filter((c) => c.r.length === 1), grand1 = a1.cells.find((c) => !c.r.length).v[0];
  const tot = r1 && r1.bars.find((b) => b.kind === "total");
  check("① 棒の数＝設備の数＋計", r1 && r1.bars.length === rows1.length + 1, { bars: r1 && r1.bars.length, rows: rows1.length });
  check("① 計の数＝サーバーの総計（ラベル）", tot && r1.labels.includes(String(grand1)) && new RegExp(`: ${grand1}（計`).test(tot.t), { grand1, labels: r1 && r1.labels });
  // 前の棒の終わりから始まる: title の「a → b」で、次の a は前の b
  const chain = (r) => r.bars.filter((b) => b.kind !== "total").map((b) => (/（.*・(.+) → (.+)）/.exec(b.t) || []).slice(1).map((x) => +x.replace(/,/g, "")));
  const c1 = chain(r1);
  check("① どの棒も前の棒の終わりから始まり、点線でつなぐ", c1.every((x, i) => i === 0 ? x[0] === 0 : x[0] === c1[i - 1][1]) && r1.links >= c1.length, { c1, links: r1.links });
  // ②
  const r2 = await read("wf2"), a2 = await ans("wf2");
  const days = a2.cells.filter((c) => c.r.length === 1 && typeof c.v[0] === "number");
  const kindsOk = r2 && r2.bars.filter((b) => b.kind !== "total").every((b) => { const v = +(/: ([+\-−]?[\d,.]+)/.exec(b.t) || [])[1]?.replace(/,/g, "").replace("−", "-"); return (v >= 0 ? b.kind === "up" : b.kind === "down"); });
  check("② 正は増加・負は減少の棒", kindsOk && r2.bars.some((b) => b.kind === "down"), r2 && r2.bars.map((b) => [b.kind, b.t]).slice(0, 6));
  check("② 前との差（表し方）は足せないので計の棒を出さない・凡例に ▲ 増加 ▼ 減少", r2 && !r2.bars.some((b) => b.kind === "total") && /▲ 増加/.test(r2.legend) && /▼ 減少/.test(r2.legend), r2 && r2.legend);
  check("② 数値ラベルに ＋ と − の符号", r2 && r2.labels.some((t) => t.startsWith("+")) && r2.labels.some((t) => t.startsWith("−")), r2 && r2.labels);
  check("② 棒の数＝数のある作業日の数", r2 && r2.bars.length === days.length, { bars: r2 && r2.bars.length, days: days.length });
  // ③
  const a3 = await ans("wf3"), r3 = await read("wf3");
  const raw = await p.evaluate(async () => { const r = await fetch("/api/dashboard/query", TPA.json("POST", { panel: { id: "x", visual: "column", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "sum", column: "重量" }] } } })); return r.ok ? r.json() : null; }).catch(() => null);
  const g3 = a3.cells.find((c) => !c.r.length).v[0], gRaw = raw && raw.cells ? raw.cells.find((c) => !c.r.length).v[0] : null;
  check("③ 計算 ÷1000 の総計＝計算なしの総計 ÷ 1000", gRaw != null && Math.abs(g3 - gRaw / 1000) < 1e-6, { g3, gRaw });
  check("③ 題に［値÷1000］", /［値÷1000］/.test(r3 ? r3.title || "" : "") || /［値÷1000］/.test(await p.$eval('#dashGrid .db-p[data-id="wf3"]', (e) => e.textContent)), r3 && r3.title);
  // 平均（足せない）
  const r4 = await read("wf4");
  check("② 平均は計の棒を出さず、そのことを書く", r4 && !r4.bars.some((b) => b.kind === "total") && /計の棒は出しません/.test(await p.$eval('#dashGrid .db-p[data-id="wf4"]', (e) => e.textContent)), r4 && r4.legend);
  // ⑤
  for (const id of ["wf1", "wf2", "wf3", "wf4", "wf5"]) {
    const r = await read(id);
    const inside = r && r.bars.every((b) => b.x >= 0 && b.y >= -0.5 && b.x + b.w <= r.W + 0.5 && b.y + b.h <= r.H + 0.5);
    check(`⑤ ${id}: 棒・字が図からはみ出さない`, r && inside && r.out === 0, r && { out: r.out, W: r.W, H: r.H });
  }
  // ④ 一覧の集計表
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await sleep(400);
  await p.evaluate(() => LotListPivot.setState({ view: "pivot", rows: [{ column: "作業区分", part: "" }], cols: [], measures: [{ agg: "lots" }], chart: "column" }));
  await p.waitForSelector("#llPivot .pv-table"); await sleep(500);
  await pickChart(p, "waterfall"); await sleep(900);
  const n4 = await p.$$eval("#llPvChart rect.pv-wf", (x) => x.length);
  const rows4 = await p.$$eval("#llPivot .pv-table tbody tr:not(.is-grand):not(.is-sub)", (x) => x.length);
  check("④ 一覧の集計表でも ウォーターフォール（棒＝行＋計）", n4 === rows4 + 1, { n4, rows4 });
  check("頁の誤りが無い", !errors.length, errors);
} finally { await app.close(); }
console.log(fails.length ? `NG ${fails.length} 件` : "OK（すべて合いました）");
process.exit(fails.length ? 1 : 0);
