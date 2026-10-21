// 評価関数（開発用。版 3.48.0。利用者の要望 2026-10-21 の 3 回目）: ダッシュボードの 7 つの改良を本物の画面で確かめる。
//   node program/tools/ui-eval-dash8.mjs [1280x720]
// ① 組み込みの標準を直して「保存」→ 組み込みの代わりに出る（replaces）→「組み込みに戻す」で戻る。「いまの物を消す」で一覧から外れ、
//    空の画面に知らせ →「外した組み込み」の「戻す」で戻る
// ② 積み上げ横棒・100%積み上げ横棒: 行の名前の順・行ごとの合計がサーバーの答えと同じ。100% は棒の長さがそろう
// ③ 設備を手で並べる: 組む所の「手で並べる」→ 札の → で 1 つ後ろへ → ガントの行の順・積み上げ横棒の行の順が並べた順
// ④ ガントの日の区切り: 日付の札と境の線が、答えの作業日の区切り（現場歴: 勤務体系の始まり）に引かれ、横の範囲が期間の作業日そのもの
// ⑤ ABC の出す項目: 外した列が表に無い・パレート図を外すと図が無い・ABC を外すと札が無い
// ⑥ 全設備の時間: リードタイムにすると「ロット数」「平均 LT」と下の段の印、数はサーバーへ同じ組みを問い合わせた答えと同じ
// ⑦ 作業開始の列: 組む所で選ぶと、答えの作業開始の列が替わる
// どれも画面に収まる（組む所の稼働の欄が横に切れない）。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 900)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const OPS = { rows: 8, panels: [
  { id: "gantt", x: 0, y: 0, w: 12, h: 4, title: "", visual: "gantt", source: "work", period: { column: "@workday", kind: "days", n: 2 }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } },
  { id: "abc", x: 0, y: 4, w: 12, h: 4, title: "", visual: "abc", source: "work", ops: { cls: "合金" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } }] };
const HS = { rows: 8, panels: [
  { id: "hs", x: 0, y: 0, w: 6, h: 8, title: "", visual: "hstack", source: "work", period: { column: "@workday", kind: "days", n: 7 }, eorder: ["L-1", "CR2"],
    body: { rows: [{ column: "@equip", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }] } },
  { id: "hs100", x: 6, y: 0, w: 6, h: 8, title: "", visual: "hstack100", source: "work", period: { column: "@workday", kind: "days", n: 7 },
    body: { rows: [{ column: "作業区分", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }] } }] };
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", TPA.json("POST", { panel: x }))).json(), panel);
const answer = (p, id) => p.evaluate((k) => Dashboard._state().answers[k], id);
const layout = async (p, l) => { await p.evaluate((x) => Dashboard._setLayout(x), l); await sleep(400); await waitDash(p); await sleep(500); };
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));

  /* ① 組み込みを入れ替える・外す */
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.selectOption("[data-db-rows]", "9"); await sleep(300);
  await p.click("[data-db-save]"); await sleep(1200);
  let list = await p.evaluate(async () => (await fetch("/api/dashboards")).json());
  const swapped = list.items.find((x) => x.replaces === "b:standard");
  check("① 組み込みを直して保存 → 組み込みの代わりに出る（標準のまま）", swapped && swapped.body.rows === 9 && !list.items.some((x) => x.id === "b:standard") && list.standardId === swapped.id,
    list.items.map((x) => [x.id, x.replaces]));
  await p.click("[data-db-leave]").catch(() => {}); await sleep(300);
  await p.click("[data-db-pick]"); await sleep(400);
  check("① 面に「組み込みに戻す」", !!(await p.$("[data-db-unswap]")), null);
  await p.click("[data-db-unswap]"); await sleep(1000);
  list = await p.evaluate(async () => (await fetch("/api/dashboards")).json());
  check("① 組み込みに戻すと、組み込みの標準（8 段）に戻る", list.items.length === 1 && list.items[0].id === "b:standard" && (await p.evaluate(() => Dashboard._state().layout.rows)) === 8, list.items.map((x) => x.id));
  await p.click("[data-db-pick]"); await sleep(400);
  await p.click("[data-db-remove]"); await sleep(200); await p.click("[data-db-remove]"); await sleep(1000);
  const none = await p.$eval(".db-none", (x) => x.textContent).catch(() => "");
  check("① いまの物を消す → 一覧から外れ、空の画面に知らせ", /ダッシュボードがありません/.test(none), none);
  await p.click("[data-db-pick]"); await sleep(400);
  const unhide = await p.$("[data-db-unhide]");
  check("① 面に「外した組み込み」と「戻す」", !!unhide, null);
  await unhide.click(); await sleep(800); await waitDash(p);
  list = await p.evaluate(async () => (await fetch("/api/dashboards")).json());
  check("① 戻すと組み込みの標準が一覧と画面に戻る", list.items.some((x) => x.id === "b:standard") && !(list.hidden || []).length && (await p.$$eval("#dashGrid .db-p", (xs) => xs.length)) > 0, list);

  /* ② 積み上げ横棒・③ 設備の手の順 */
  await layout(p, HS);
  for (const id of ["hs", "hs100"]) {
    const a = await answer(p, id), panel = HS.panels.find((x) => x.id === id);
    const server = await ask(p, panel);
    // 行の名前（左の名前の欄。下の目盛りの字は除く）
    const names = await p.$$eval(`${P(id)} svg text.pv-ax[text-anchor="end"]`, (ts) => ts.filter((t) => !/^[\d,.]+%?$/.test(t.textContent)).map((t) => t.textContent));
    const want = server.orders[0].map((k) => (server.labels[0] || {})[k] ?? k).filter((k) => k !== "");
    check(`② ${id}: 行の名前の順がサーバーの答えの順（設備は手で並べた順）`, JSON.stringify(names) === JSON.stringify(want.slice(0, names.length)) && names.length >= 3, { names, want });
    if (id === "hs") {
      check("③ 積み上げ横棒の設備の順: 手で並べた L-1・CR2 が先", names[0] === "L-1" && names[1] === "CR2", names);
      const tot = await p.$$eval(`${P(id)} svg text`, (ts) => ts.filter((t) => !t.getAttribute("text-anchor") && /^\d/.test(t.textContent)).map((t) => +t.textContent.replace(/,/g, "")));
      const sums = want.map((k) => (server.cells.find((c) => c.r.length === 1 && c.r[0] === k && !c.c.length) || { v: [0] }).v[0]);
      check("② 積み上げ横棒の行ごとの合計がサーバーの答えと同じ", JSON.stringify(tot) === JSON.stringify(sums.slice(0, tot.length)), { tot, sums });
    } else {
      const ends = await p.$$eval(`${P(id)} svg`, (ss) => { const out = {}, s = ss.sort((a, b) => b.querySelectorAll("rect").length - a.querySelectorAll("rect").length)[0]; s.querySelectorAll("rect").forEach((r) => { const y = Math.round(+r.getAttribute("y")); out[y] = Math.max(out[y] || 0, +r.getAttribute("x") + +r.getAttribute("width")); }); return Object.values(out); });
      check("② 100%積み上げ横棒: 行ごとの棒の右の端がそろう", ends.length >= 2 && Math.max(...ends) - Math.min(...ends) < 1.5, ends);
    }
    check(`② ${id}: パネルの外へはみ出さない`, await p.$eval(P(id), (el) => { const s = el.querySelector("svg"); if (!s) return false; const a = el.getBoundingClientRect(), b = s.getBoundingClientRect(); return b.right <= a.right + 1 && b.bottom <= a.bottom + 1; }), null);
  }

  /* ④ ガントの日の区切り */
  await layout(p, OPS);
  const g = await answer(p, "gantt");
  const eq = g.equips.find((e) => (e.days || []).length);
  const geo = await p.evaluate(() => {
    const svg = document.querySelector('#dashGrid .db-p[data-id="gantt"] .og-svg');
    const labels = [...svg.querySelectorAll(".og-dayl")].map((t) => [+t.getAttribute("x"), t.firstChild.nodeValue]);
    const lines = [...svg.querySelectorAll(".og-day:not(.is-own)")].map((l) => +l.getAttribute("x1"));
    const off = svg.querySelector(".og-off"), on = [...svg.querySelectorAll(".og-on")];
    return { labels, lines, x0: +off.getAttribute("x"), w: +off.getAttribute("width") };
  });
  const ms = (s) => Date.parse(s.replace(" ", "T"));
  const x0 = Math.min(...g.equips.filter((e) => e.view).map((e) => ms(e.view[0]))), x1 = Math.max(...g.equips.filter((e) => e.view).map((e) => ms(e.view[1])));
  const X = (t) => geo.x0 + ((t - x0) / (x1 - x0)) * geo.w;
  const want = eq.days.map((d) => X(ms(d[0])));
  check("④ 日付の札が作業日の始まり（現場歴）に出る", geo.labels.length === eq.days.length && geo.labels.every(([x], i) => Math.abs(x - 3 - Math.max(geo.x0, want[i])) < 1.5), { labels: geo.labels, want, days: eq.days });
  check("④ 日の境の線が作業日の区切りに引かれる", geo.lines.length === eq.days.length - 1 && geo.lines.every((x, i) => Math.abs(x - want[i + 1]) < 1.5), { lines: geo.lines, want });
  // 設備ごとに勤務体系が違えば区切りも違う（CR2 は 4,5直）。どの設備も見る範囲＝自分の作業日の区切りの最初〜最後で、2 日ぶん
  const bad = g.equips.filter((e) => e.view && !(e.view[0] === e.days[0][0] && e.view[1] === e.days[e.days.length - 1][1] && e.days.length === 2 && ms(e.view[1]) - ms(e.view[0]) === 2 * 86400000));
  check("④ 横の範囲が期間の作業日そのもの（どの設備も 2 日）", !bad.length, bad.map((e) => [e.name, e.view, e.days]));
  check("④ 現場歴の作業日は勤務体系の始まりから（0 時ではない）", !eq.days[0][0].endsWith("00:00:00"), eq.days[0]);

  /* ⑤⑥⑦ 組む所（ABC） */
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.click(`${P("abc")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
  const fit = await p.evaluate(() => { const ed = document.querySelector("#dbEditor .de-main"), ops = document.querySelector("#dbEditor .de-ops"); return ed && ops ? { sw: ops.scrollWidth, cw: ops.clientWidth, right: ops.getBoundingClientRect().right, edr: ed.getBoundingClientRect().right } : null; });
  check("組む所の稼働の欄が横に切れない", fit && fit.sw <= fit.cw + 1 && fit.right <= fit.edr + 1, fit);
  for (const k of ["conv", "chart", "rank"]) { await p.click(`[data-de-ohide="${k}"]`); await sleep(150); }
  await waitDash(p); await sleep(600);
  const heads = await p.$$eval(`${P("abc")} .oa-table thead th`, (ts) => ts.map((t) => t.textContent));
  const chart = await p.$(`${P("abc")} .oa-chart`), ranks = await p.$$(`${P("abc")} .oa-table .oa-rank`);
  check("⑤ 外した項目（換算本数・ABC）が表に無く、パレート図も無い", !heads.includes("換算本数") && !heads.includes("ABC") && heads.includes("構成比") && !chart && !ranks.length, heads);
  await p.click('.de-seg:has([data-de-ospan][value="lead"])'); await sleep(200); await waitDash(p); await sleep(600);
  const st = await p.evaluate(() => { const s = Dashboard._state(); return { panel: s.layout.panels.find((x) => x.id === "abc") }; });
  const a2 = await answer(p, "abc");
  const server = await ask(p, { ...OPS.panels[1], ops: { cls: "合金", span: "lead", hide: ["conv", "chart", "rank"] } });
  const heads2 = await p.$$eval(`${P("abc")} .oa-table thead th`, (ts) => ts.map((t) => t.textContent));
  const firstRow = await p.$$eval(`${P("abc")} .oa-table tbody tr:first-child > *`, (ts) => ts.map((t) => t.textContent));
  const top = server.all.items[0];
  check("⑥ リードタイム: 答えの span・見出し（ロット数・平均 LT）・下の段の印", a2.span === "lead" && heads2.includes("ロット数") && heads2.includes("平均 LT") && !!(await p.$(`${P("abc")} .oa-flt`)), { span: a2.span, heads2 });
  check("⑥ リードタイムの数がサーバーへ同じ組みを問い合わせた答えと同じ（1 行目の品種・ロット数・平均）", firstRow[0] === top.key && +firstRow[1].replace(/,/g, "") === top.lots && firstRow.some((x) => x === `${top.avg.toFixed(1)} 分`), { firstRow, top: [top.key, top.lots, top.avg] });
  check("⑥ 積み上げとリードタイムで全設備の本数が違う（1 本＝作業／1 本＝ロット）", server.all.lots !== (await ask(p, OPS.panels[1])).all.lots, null);
  const opts = await p.$$eval("[data-de-ostart] option", (os) => os.map((o) => o.value));
  check("⑦ 作業開始の列を選べる（候補に開始の列）", opts.includes("開始"), opts);
  await p.selectOption("[data-de-ostart]", "開始"); await sleep(200); await waitDash(p); await sleep(600);
  check("⑦ 選んだ作業開始の列で数える", (await answer(p, "abc")).startColumn === "開始", (await answer(p, "abc")).startColumn);
  await p.click("[data-de-cancel]"); await sleep(300);

  /* ③ ガントの行を手で並べる */
  await p.click(`${P("gantt")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
  await p.click('.de-seg:has([data-de-eord][value="hand"])'); await p.waitForSelector("[data-de-eomove]"); await sleep(300);
  const before = await p.$$eval(".de-eoc b", (bs) => bs.map((b) => b.textContent));
  await p.click('[data-de-eomove="0"][data-d="1"]'); await sleep(200); await waitDash(p); await sleep(700);
  const after = await p.$$eval(".de-eoc b", (bs) => bs.map((b) => b.textContent));
  const rows = await p.$$eval(`${P("gantt")} .og-name`, (ts) => ts.map((t) => t.firstChild.nodeValue));
  check("③ → で 1 つ後ろへ（札の並び）", after[0] === before[1] && after[1] === before[0], { before, after });
  check("③ ガントの行が手で並べた順", JSON.stringify(rows) === JSON.stringify(after.slice(0, rows.length)), { rows, after });
  check("③ 答えの設備の順も同じ", JSON.stringify((await answer(p, "gantt")).equips.map((e) => e.name)) === JSON.stringify(after), null);
  // ⋮⋮ を引いて並べる（2026-10-dash8 の J）: 1 つ目の札を 3 つ目の札の下半分へ落とすと、3 番目に入る
  const g0 = await (await p.$(".de-eoc:nth-child(1) [data-de-eogrip]")).boundingBox(), t3 = await (await p.$(".de-eoc:nth-child(3)")).boundingBox();
  await p.mouse.move(g0.x + g0.width / 2, g0.y + g0.height / 2); await p.mouse.down();
  await p.mouse.move(t3.x + 40, t3.y + t3.height * 0.75, { steps: 6 }); await p.mouse.up(); await sleep(300); await waitDash(p); await sleep(600);
  const dragged = await p.$$eval(".de-eoc b", (bs) => bs.map((b) => b.textContent));
  check("③ ⋮⋮ を引いて並べる（1 つ目 → 3 つ目の下へ）", dragged[2] === after[0] && dragged[0] === after[1] && dragged[1] === after[2], { after: after.slice(0, 4), dragged: dragged.slice(0, 4) });
  const rows2 = await p.$$eval(`${P("gantt")} .og-name`, (ts) => ts.map((t) => t.firstChild.nodeValue));
  check("③ 引いた順がガントの行に効く", JSON.stringify(rows2) === JSON.stringify(dragged.slice(0, rows2.length)), rows2);
  await p.click("[data-de-cancel]"); await sleep(300);
  check("画面の誤り（pageerror）が無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
