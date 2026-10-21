// 評価関数（開発用。版 3.49.0。利用者の要望 2026-10-21 の 4 回目）: ダッシュボードの保存先と ABC 分析の負荷の見積もりを本物の画面で確かめる。
//   node program/tools/ui-eval-dashsave.mjs [1280x720]
// ① 名前を付けて保存: 組み込みと同じ名前「標準」を全員の既定へ → 主のボタンが行き先「「標準」〔全員の既定〕に上書き保存」→ 組み込みの代わりになり、「標準」は 1 つ
//    同じ置き場の同じ名前 → 上書き（数が増えない）／新しい名前 → 新しく（1 つ増える）
// ② ★: 全員（共有）に★があるとき、全員の既定へ★を付けて保存すると「★を外す」が出て、外すと全員の既定の物が最初に開く
// ③ 面の置き場の見出し（自分だけ・全員（共有）・全員の既定）と、だれが直せるかの添え書き・★の効いている物の印。面が画面に収まる
// ④ ABC: 占有時間 ＝ 本数 × 平均・負荷比の計 100%・換算本数の計 ＝ 占有時間の計 ÷ 基準。表の数がサーバーへ同じ組みを問い合わせた答えと同じ
// ⑤ 地点 A の係数（係数の期間）: 組む所で「日付で決める」を選ぶと、表の見出しが「係数（A）」「換算本数（A）」になり、数がサーバーと同じ
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 900)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const ABC = { id: "abc", x: 0, y: 0, w: 12, h: 8, title: "", visual: "abc", source: "work", ops: { cls: "合金" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } };
const list = (p) => p.evaluate(async () => (await fetch("/api/dashboards")).json());
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", TPA.json("POST", { panel: x }))).json(), panel);
const answer = (p, id) => p.evaluate((k) => Dashboard._state().answers[k], id);
async function saveAs(p, name, scope, star) {
  await p.click("[data-db-saveas]"); await sleep(300);
  await p.fill("#dbSaveName", name); await p.dispatchEvent("#dbSaveName", "input");
  await p.check(`input[name="dbScope"][value="${scope}"]`); await sleep(100);
  if ((await p.isChecked("#dbSaveStd")) !== star) { await p.click("#dbSaveStd"); await sleep(100); }
  return p.evaluate(() => ({ plan: document.querySelector("#dbSavePlan").textContent, cls: document.querySelector("#dbSavePlan").className,
    btn: document.querySelector("[data-db-dosave]").textContent, plan2: document.querySelector("[data-db-dosave]").dataset.plan, unstar: document.querySelector("#dbUnstar") ? document.querySelector("#dbUnstar").checked : null }));
}
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));

  /* ① 組み込みと同じ名前 → 上書き */
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.selectOption("[data-db-rows]", "9"); await sleep(300);
  let s = await saveAs(p, "標準", "default", true);
  check("① 組み込みと同じ名前: ボタンが「「標準」〔全員の既定〕に上書き保存」（組み込みの代わり）", s.plan2 === "swap" && s.btn === "「標準」〔全員の既定〕に上書き保存", s);
  await p.click("[data-db-dosave]"); await sleep(1200);
  let l = await list(p);
  const std = l.items.filter((x) => x.name === "標準");
  check("① 「標準」は 1 つ（組み込みの代わり・9 段・最初に開く）", std.length === 1 && std[0].replaces === "b:standard" && std[0].body.rows === 9 && l.standardId === std[0].id, l.items.map((x) => [x.id, x.name, x.scope, x.replaces]));
  s = await saveAs(p, "標準", "default", true);
  check("① もう一度同じ名前・同じ置き場 → 上書き（組み込みではなく置いた物）", s.plan2 === "over" && s.btn === "「標準」〔全員の既定〕に上書き保存", s);
  await p.click("[data-db-dosave]"); await sleep(1000);
  check("① 上書きしても数は増えない", (await list(p)).items.length === l.items.length, null);
  const n0 = (await list(p)).items.length;
  s = await saveAs(p, "わたしの朝", "me", false);
  check("① 新しい名前 → ボタンは「「わたしの朝」〔自分だけ〕に保存」", s.plan2 === "new" && s.btn === "「わたしの朝」〔自分だけ〕に保存", s);
  await p.click("[data-db-dosave]"); await sleep(1000);
  check("① 新しい名前 → 1 つ増える", (await list(p)).items.length === n0 + 1, null);
  s = await saveAs(p, "わたしの朝", "me", false);
  await p.click("[data-db-dosave]"); await sleep(1000);
  check("① 自分だけでも同じ名前 → 上書き（増えない）", s.plan2 === "over" && (await list(p)).items.length === n0 + 1, s);

  /* ② ★の勝ち負け */
  await p.evaluate(async (l0) => { await fetch("/api/dashboards", TPA.json("POST", { name: "現場", scope: "all", standard: true, body: l0 })); }, { rows: 8, panels: [ABC] });
  await p.evaluate(() => Dashboard._reload && Dashboard._reload());
  await p.click("[data-db-leave]").catch(() => {}); await p.click("[data-db-discard]").catch(() => {}); await sleep(300);
  await p.reload(); await p.click("#tabDash"); await waitDash(p); await sleep(400);
  l = await list(p);
  check("② 全員（共有）の★が全員の既定の★より先に効く", (l.items.find((x) => x.id === l.standardId) || {}).scope === "all", l.standardId);
  await p.click("[data-db-pick]"); await sleep(400);
  const pop = await p.evaluate(() => { const el = document.querySelector(".db-pickpop"), r = el.getBoundingClientRect();
    return { heads: [...el.querySelectorAll(".db-pcol:last-child .tpa-sch b")].map((b) => b.textContent), who: [...el.querySelectorAll(".db-pcol:last-child .tpa-sch small")].map((b) => b.textContent),
      on: (el.querySelector(".db-li.is-std") || {}).textContent || "", off: el.querySelectorAll(".db-std.is-off").length, fit: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 }; });
  check("③ 面の置き場の見出しと、だれが直せるか", JSON.stringify(pop.heads) === JSON.stringify(["自分だけ", "全員（共有）", "全員の既定"]) && pop.who.every((w) => /直せる/.test(w)), pop);
  check("③ ★の効いている物に「最初に開く」・負けている★は白抜き", /現場.*最初に開く/.test(pop.on) && pop.off === 1, pop);
  check("③ 面が画面に収まる", pop.fit, pop);
  await p.keyboard.press("Escape"); await sleep(200);
  await p.click("[data-db-pick]"); await sleep(300);
  await p.click(`.db-li[data-db-open="${std[0].id}"]`); await waitDash(p); await sleep(300);
  await p.click("[data-db-editmode]"); await sleep(300);
  s = await saveAs(p, "標準", "default", true);
  check("② 全員の既定へ★を付けて保存 → 全員（共有）の★を外す選び（初めから外す）", s.unstar === true && /現場/.test(s.plan), s);
  await p.click("[data-db-dosave]"); await sleep(1300);
  l = await list(p);
  check("② 外すと、全員の既定の「標準」が最初に開く", l.standardId === std[0].id && !l.items.find((x) => x.name === "現場").standard, { std: l.standardId, items: l.items.map((x) => [x.name, x.scope, x.standard]) });
  await p.click("[data-db-leave]").catch(() => {}); await sleep(300);

  /* ④ ABC の負荷 */
  await p.evaluate((x) => Dashboard._setLayout(x), { rows: 8, panels: [ABC] }); await sleep(400); await waitDash(p); await sleep(600);
  const a = await answer(p, "abc"), sv = await ask(p, ABC), all = sv.all;
  const occOk = all.items.every((x) => x.avg == null || Math.abs(x.occ - x.lots * x.avg) <= x.lots * 0.006);
  const shareSum = all.items.reduce((t, x) => t + x.occShare, 0), base = all.base.minutes;
  check("④ 占有時間 ＝ 本数 × 平均（品種ごと。平均は小数 2 桁に丸めて返す）", occOk, all.items.slice(0, 3));
  check("④ 負荷比の計が 100%・換算本数の計 ＝ 占有時間の計 ÷ 基準", Math.abs(shareSum - 100) < 0.5 && Math.abs(all.conv - all.occ / base) < 0.5, { shareSum, conv: all.conv, occ: all.occ, base });
  check("④ 画面の答えがサーバーへ同じ組みを問い合わせた答えと同じ", JSON.stringify(a.all.items) === JSON.stringify(all.items), null);
  const heads = await p.$$eval(`${P("abc")} .oa-table thead th`, (ts) => ts.map((t) => t.textContent));
  check("④ 表に本数・平均作業・占有時間・本数比・負荷比", ["本数", "平均作業", "占有時間", "本数比", "負荷比"].every((h) => heads.includes(h)), heads);
  const row1 = await p.$$eval(`${P("abc")} .oa-table tbody tr:first-child > *`, (ts) => ts.map((t) => t.textContent));
  check("④ 1 行目の本数がサーバーと同じ", row1[0] === all.items[0].key && +row1[1].replace(/,/g, "") === all.items[0].lots, { row1, top: all.items[0] });

  /* ⑤ 地点 A の係数 */
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.click(`${P("abc")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
  await p.selectOption("[data-de-rkind]", "range"); await sleep(300);
  await p.fill("[data-de-rfrom]", "2026-09-20"); await p.dispatchEvent("[data-de-rfrom]", "change"); await sleep(200);
  await p.fill("[data-de-rto]", "2026-09-26"); await p.dispatchEvent("[data-de-rto]", "change"); await sleep(300); await waitDash(p); await sleep(600);
  const pn = await p.evaluate(() => Dashboard._state().layout.panels.find((x) => x.id === "abc"));
  const a5 = await answer(p, "abc"), s5 = await ask(p, pn);
  const h5 = await p.$$eval(`${P("abc")} .oa-table thead th`, (ts) => ts.map((t) => t.textContent));
  check("⑤ 係数の期間を日付で決めると、組みに refPeriod（9/20〜9/26）", pn.ops.refPeriod && pn.ops.refPeriod.from === "2026-09-20" && pn.ops.refPeriod.to === "2026-09-26", pn.ops);
  check("⑤ 見出しが「係数（A）」「換算本数（A）」", h5.includes("係数（A）") && h5.includes("換算本数（A）"), h5);
  check("⑤ A の係数で換算した数がサーバーと同じ（範囲・換算本数の計）", a5.all.ref && JSON.stringify(a5.all.ref) === JSON.stringify(s5.all.ref) && a5.all.ref.range[0] === "2026-09-20", { a: a5.all.ref, s: s5.all.ref });
  const fit = await p.evaluate(() => { const ops = document.querySelector("#dbEditor .de-ops"); return ops ? ops.scrollWidth <= ops.clientWidth + 1 : false; });
  check("⑤ 組む所の稼働の欄が横に切れない", fit, null);
  check("頁のエラーが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `FAILED ${fails.length}` : "OK");
process.exit(fails.length ? 1 : 0);
