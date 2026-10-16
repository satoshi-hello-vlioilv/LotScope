// 評価関数（開発用）: ダッシュボード（版 3.37.0。最初の画面・グリッドのパネル・パネルを組む・保存。版 3.36.0 の 1 枚の表もパネルの 1 つ）。
//   node program/tools/ui-eval-dashboard.mjs
// 試験用のサーバーは「いま」を試験データの翌日（10/3 10:00）にしてあるので、前日は 10/2。
// ① 頁の印なしで開くと、最初の画面はダッシュボード（タブが選ばれ、パネルが出る）
// ② 1728×1152・1536×864・1280×720 で、スクロールしない（頁が窓より高くならない・グリッドが窓の中・パネルの中身がパネルからはみ出さない）
//    ・見出しの字（題）が 11px 以上・パネルの見出しのボタンが切れない
// ③ 標準のパネルの数がサーバーの答えと合う: 数字（仕掛ロット数・前日の実績本数）・仕掛区分ごとの横棒（値の大きい順）・1 枚の表（/api/dashboard）
// ④ 大きさに合わせる: 編集で仕掛区分のパネルを Shift+← で狭め、Shift+↑ で低くしても、はみ出さず、入らない棒は「n / m を描いています」と出る
// ⑤ 組む: 設備ごとのパネルを「表」にすると、グリッドの中でその場で表になる。条件（製造材質 ＝ A1100）でサーバーと同じ数に減る。当てる → 元に戻すで戻る
// ⑥ 動かす: パネルを 1 つ消して空けた所へ、ほかのパネルの見出しを掴んで動かせる。重なる所へは置けない（影が赤）
// ⑦ 保存: 名前を付けて保存（自分・標準）→ 頁を開き直すと、保存した物が開く → いまの物を消す（2 回押し）→ 組み込みの標準に戻る
// ⑧ 1 枚の表の集計対象（全員で 1 つ）: 「仕掛の対象」で製造材質 ＝ A1100 を保存すると仕掛の計が減り、すべてに戻せる
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
/** 頁の大きさ・はみ出し（② ④） */
const fitOf = (p) => p.evaluate(() => {
  const g = document.querySelector("#dashGrid").getBoundingClientRect();
  const bad = [...document.querySelectorAll("#dashGrid .db-p")].map((el) => {
    const b = el.querySelector(".db-pb"), r = el.getBoundingClientRect(), h = el.querySelector(".db-ph");
    const btnCut = [...h.querySelectorAll("button")].some((x) => { const q = x.getBoundingClientRect(); return q.width > 0 && (q.right > r.right - 4 || q.left < r.left); });
    const over = b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1;
    const out = r.bottom > g.bottom + 1 || r.right > g.right + 1;
    const small = parseFloat(getComputedStyle(h.querySelector("h3")).fontSize) < 11;
    return { id: el.dataset.id, over, out, btnCut, small, sh: b.scrollHeight, ch: b.clientHeight, sw: b.scrollWidth, cw: b.clientWidth };
  }).filter((x) => x.over || x.out || x.btnCut || x.small);
  return { pageScroll: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    gridIn: g.bottom <= innerHeight + 1, bad };
});
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), panel);
const total = (d) => (d.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v[0];
const layout = (p) => p.evaluate(() => Dashboard._state().layout);
const num = (t) => Number(String(t).replace(/[^\d.]/g, ""));

const app = await launch();
const errors = [];
try {
  // ① 最初の画面
  {
    const ctx = await app.browser.newContext({ viewport: parseView("1728x1152"), deviceScaleFactor: 1.25, locale: "ja-JP" });
    await ctx.route("**/__desktop/**", (r) => r.fulfill({ status: 404, json: { error: "作り物の窓は答えません" } }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(app.base); await waitDash(p);
    const s = await p.evaluate(() => ({ tab: document.querySelector("#tabDash").getAttribute("aria-selected"), shown: !document.querySelector("#dashScreen").classList.contains("hidden"),
      list: document.querySelector("#lotListScreen").classList.contains("hidden"), panels: document.querySelectorAll("#dashGrid .db-p").length }));
    check("① 頁の印なしで開くと、最初の画面はダッシュボード", s.tab === "true" && s.shown && s.list && s.panels >= 5, s);
    await ctx.close();
  }
  // ② スクロールしない（3 つの大きさ）
  for (const v of ["1728x1152", "1536x864", "1280x720"]) {
    const p = await app.newPage("light", parseView(v), { screen: "dash" }); p.on("pageerror", (e) => errors.push(e.message));
    const f = await fitOf(p);
    check(`② ${v} スクロールしない・パネルの中身がはみ出さない・見出しのボタンが切れない`, !f.pageScroll && f.gridIn && !f.bad.length, f);
    await p.click("[data-db-editmode]"); await sleep(400);
    const e = await fitOf(p);
    check(`② ${v} 編集のときも同じ`, !e.pageScroll && e.gridIn && !e.bad.length, e);
    await p.context().close();
  }

  const p = await app.newPage("light", parseView("1728x1152"), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  // ③ 標準のパネルの数がサーバーと合う
  const L = await layout(p), byId = Object.fromEntries(L.panels.map((x) => [x.id, x]));
  const wipTotal = total(await ask(p, byId.wipTotal)), workTotal = total(await ask(p, byId.workTotal));
  const kpi = await p.evaluate(() => ["wipTotal", "workTotal"].map((id) => document.querySelector(`#dashGrid .db-p[data-id="${id}"] .dp-num`)?.childNodes[0].textContent));
  check(`③ 数字のパネルがサーバーと合う（仕掛 ${wipTotal}・前日 ${workTotal}）`, num(kpi[0]) === wipTotal && num(kpi[1]) === workTotal, kpi);
  const cls = await ask(p, byId.wipClass);
  const want = cls.orders[0].map((k) => [cls.labels[0][k], cls.cells.find((c) => c.r.length === 1 && c.r[0] === k && !c.c.length).v[0]]).sort((a, b) => b[1] - a[1]);
  const bars = await p.evaluate((sel) => [...document.querySelectorAll(`${sel} svg rect title`)].map((t) => t.textContent), P("wipClass"));
  check("③ 仕掛区分ごとの横棒が、サーバーの数と同じで大きい順", bars.length === want.length && bars.every((t, i) => t === `${want[i][0]}: ${want[i][1].toLocaleString("ja-JP")}`), { bars, want });
  const board = await p.evaluate(async () => (await fetch("/api/dashboard")).json());
  const boardShown = await p.evaluate((sel) => document.querySelector(`${sel} thead .db-lots small`)?.textContent || "", P("board"));
  check("③ 1 枚の表の仕掛の計が /api/dashboard と合う", boardShown.includes(board.wip.total.toLocaleString()), { boardShown, total: board.wip.total });

  // ④ 大きさに合わせる
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.focus(P("wipClass"));
  for (let i = 0; i < 2; i++) { await p.keyboard.press("Shift+ArrowLeft"); await sleep(150); }
  for (let i = 0; i < 2; i++) { await p.keyboard.press("Shift+ArrowUp"); await sleep(150); }
  await sleep(1500);
  const small = (await layout(p)).panels.find((x) => x.id === "wipClass");
  const f4 = await fitOf(p);
  const foot = await p.$eval(`${P("wipClass")} .db-pf`, (e) => (e.hidden ? "" : e.textContent));
  const drawn = await p.$$eval(`${P("wipClass")} svg rect`, (x) => x.length);
  check(`④ 狭く低くしても（${small.w}×${small.h}）はみ出さない`, small.w === 2 && small.h === 2 && !f4.bad.length, { small, f4 });
  check(`④ 入らない棒は描かず、下に「n / m を描いています」（${drawn} 本）`, drawn < want.length ? /\d+ \/ \d+ を描いています/.test(foot) : true, { drawn, foot });
  await p.click("[data-db-undo]"); await p.click("[data-db-undo]"); await p.click("[data-db-undo]"); await p.click("[data-db-undo]"); await sleep(800);
  const back = (await layout(p)).panels.find((x) => x.id === "wipClass");
  check("④ 元に戻す（4 回）で、大きさが戻る", back.w === 4 && back.h === 4, back);

  // ⑤ 組む（その場で描き直る・条件・当てる・元に戻す）
  await p.click(`${P("wipEquip")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f");
  await p.click('[data-de-vis="none"]'); await sleep(1500);
  check("⑤ 「表」を選ぶと、グリッドの中のそのパネルがその場で表になる", await p.$(`${P("wipEquip")} .pv-table`) !== null, "");
  await p.click("[data-de-fadd]");
  await p.selectOption('#deCond .db-crow [data-de-f="column"]', "製造材質");
  await p.fill('#deCond .db-crow [data-de-f="value"]', "A1100"); await p.dispatchEvent('#deCond .db-crow [data-de-f="value"]', "change");
  await sleep(1800);
  const cond = { ...byId.wipEquip, visual: "none", filters: [{ column: "製造材質", op: "eq", value: "A1100" }], body: { ...byId.wipEquip.body, grand: true } };
  const want5 = total(await ask(p, cond));
  const shown5 = await p.evaluate((sel) => [...document.querySelectorAll(`${sel} tr.is-grand td`)].map((t) => t.textContent)[0], P("wipEquip"));
  check(`⑤ 条件（製造材質 ＝ A1100）でサーバーと同じ総計（${want5}）に減る`, num(shown5) === want5 && want5 < wipTotal, { shown5, want5 });
  await p.click("[data-de-apply]"); await sleep(600);
  const applied = (await layout(p)).panels.find((x) => x.id === "wipEquip");
  check("⑤ 当てると組みに入る（表・条件 1 つ）", applied.visual === "none" && applied.filters.length === 1, applied);
  await p.click("[data-db-undo]"); await sleep(1200);
  const undone = (await layout(p)).panels.find((x) => x.id === "wipEquip");
  check("⑤ 元に戻すで、組む前（縦棒・条件なし）に戻る", undone.visual === "column" && !undone.filters.length, undone);

  // ⑥ 動かす（消して空けた所へ、見出しを掴んで）
  await p.click(`${P("wipTotal")} [data-db-del]`); await p.click(`${P("wipTotal")} [data-db-del]`); await sleep(400);
  const drag = async (id, cell) => {
    const h = await p.$(`${P(id)} .db-ph h3`), b = await h.boundingBox();
    const c = await p.$(`#dashGrid .db-cell[data-cell="${cell}"]`), cb = c ? await c.boundingBox() : null;
    await p.mouse.move(b.x + 10, b.y + b.height / 2); await p.mouse.down();
    return { b, cb };
  };
  const wt = (await layout(p)).panels.find((x) => x.id === "workTotal");
  let { b, cb } = await drag("workTotal", "0,0");
  await p.mouse.move(cb.x + 10, b.y + b.height / 2, { steps: 6 }); await sleep(200);
  const ghostOk = await p.$eval("#dbGhost", (g) => !g.classList.contains("is-bad")).catch(() => false);
  await p.mouse.up(); await sleep(500);
  const moved = (await layout(p)).panels.find((x) => x.id === "workTotal");
  check(`⑥ 見出しを掴んで空いた所へ動かせる（${wt.x} 列 → ${moved.x} 列）`, ghostOk && moved.x === 0 && moved.y === wt.y, { wt, moved, ghostOk });
  ({ b } = await drag("workTotal"));
  const target = await p.$(`${P("wipClass")} .db-pb`), tb = await target.boundingBox();
  await p.mouse.move(tb.x + 20, b.y + b.height / 2, { steps: 6 }); await sleep(200);
  const bad = await p.$eval("#dbGhost", (g) => g.classList.contains("is-bad")).catch(() => false);
  await p.mouse.up(); await sleep(400);
  const still = (await layout(p)).panels.find((x) => x.id === "workTotal");
  check("⑥ 重なる所へは置けない（影が赤・動かない）", bad && still.x === 0, { bad, still });

  // ⑦ 保存（自分・標準）→ 開き直す → 消す
  await p.click("[data-db-saveas]"); await sleep(300);
  await p.fill("#dbSaveName", "評価のダッシュボード");
  await p.click("[data-db-dosave]"); await sleep(1200);
  const saved = await p.evaluate(() => Dashboard._state());
  await p.goto(`${app.base}/#screen=dash`); await waitDash(p);
  const reopened = await p.evaluate(() => ({ name: document.querySelector(".db-pick b").textContent, n: Dashboard._state().layout.panels.length }));
  check("⑦ 名前を付けて保存（自分・標準）→ 開き直すと、保存した物が開く", reopened.name === "評価のダッシュボード" && reopened.n === saved.layout.panels.length, reopened);
  await p.click("[data-db-pick]"); await p.click("[data-db-remove]"); await p.click("[data-db-remove]"); await sleep(1200);
  const after = await p.evaluate(() => ({ name: document.querySelector(".db-pick b").textContent, ids: Dashboard._state().layout.panels.map((x) => x.id) }));
  check("⑦ いまの物を消す（2 回押し）と、組み込みの標準に戻る", after.name === "標準" && after.ids.includes("wipTotal"), after);

  // ⑧ 1 枚の表の集計対象
  await p.click('[data-db-cond="wip"]'); await sleep(300);
  await p.selectOption('.db-condpop [data-f="column"]', "製造材質");
  await p.selectOption('.db-condpop [data-f="op"]', "eq");
  await p.fill('.db-condpop [data-f="value"]', "A1100");
  await p.click("[data-db-condsave]"); await sleep(2500);
  const b2 = await p.evaluate(async () => (await fetch("/api/dashboard?part=wip")).json());
  const shown8 = await p.evaluate((sel) => document.querySelector(`${sel} thead .db-lots small`)?.textContent || "", P("board"));
  check("⑧ 「仕掛の対象」で条件を保存すると、1 枚の表の仕掛の計が減り、札に条件が出る",
    b2.wip.total < board.wip.total && shown8.includes(b2.wip.total.toLocaleString()) && /製造材質/.test(await p.$eval('[data-db-cond="wip"]', (x) => x.textContent)), { shown8, total: b2.wip.total });
  await p.click('[data-db-cond="wip"]'); await sleep(300);
  await p.click(".db-condpop [data-db-crowdel]"); await p.click("[data-db-condsave]"); await sleep(2500);
  check("⑧ 条件を外して保存すると、すべてに戻る", /すべて/.test(await p.$eval('[data-db-cond="wip"]', (x) => x.textContent)), "");
  check("頁の誤りが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
