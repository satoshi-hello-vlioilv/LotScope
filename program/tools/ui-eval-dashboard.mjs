// 評価関数（開発用）: ダッシュボード（版 3.37.0。最初の画面・グリッドのパネル・パネルを組む・保存。版 3.36.0 の 1 枚の表もパネルの 1 つ）。
//   node program/tools/ui-eval-dashboard.mjs
// 試験用のサーバーは「いま」を試験データの翌日（10/3 10:00）にしてあるので、前日は 10/2。
// ① 頁の印なしで開くと、最初の画面はダッシュボード（タブが選ばれ、パネルが出る）
// ② 1728×1152・1536×864・1280×720 で、スクロールしない（頁が窓より高くならない・グリッドが窓の中・パネルの中身がパネルからはみ出さない）
//    ・見出しの字（題）が 11px 以上・パネルの見出しのボタンが切れない
// ③ 標準のパネルの数がサーバーの答えと合う: 数字（仕掛ロット数・前日の実績本数）・仕掛区分ごとの横棒（値の大きい順）・合わせた表（まとまりごとの計・0 本の印）
// ④ 大きさに合わせる: 編集で仕掛区分のパネルを Shift+← で狭め、Shift+↑ で低くしても、はみ出さず、入らない棒は「n / m を描いています」と出る
// ⑤ 組む: 仕掛区分のパネルを「表」にすると、グリッドの中でその場で表になる。条件（製造材質 ＝ A1100）でサーバーと同じ数に減る。当てる → 元に戻すで戻る
// ⑥ 動かす: パネルを 1 つ消して空けた所へ、ほかのパネルの見出しを掴んで動かせる。重なる所へは置けない（影が赤）
// ⑦ 保存: 名前を付けて保存（自分・標準）→ 頁を開き直すと、保存した物が開く → いまの物を消す（2 回押し）→ 組み込みの標準に戻る
// ⑧ 合わせた表（版 3.38.0。設備ごとの仕掛と前日の実績）を組む: 行の札で並べ替える（↓・手で並べた順）・隠す・名前の順・まとまりの見せ方（数だけ）・
//    まとまりの条件でサーバーと同じ計・当てると組みに入る・元に戻す
// ⑨ 計算列（版 3.38.0）: 一覧の表示列で作った式の列を、組む所の札に出し、行の段に使える
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
    // 合わせた表を組む所で開くと、表を大きく出す。幅が足りなくても右の列（直の外・計）が切れない（版 3.38.0。列の幅 → 字と余白を詰める）
    await p.click(`${P("board")} [data-db-edit]`); await p.waitForSelector("#deBoard .de-rowi[data-de-row]"); await sleep(800);
    const wide = await p.evaluate((sel) => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect();
      const tbls = [...el.querySelectorAll(".dp-tbl")].map((t) => ({ sw: t.scrollWidth, cw: t.clientWidth }));
      const last = [...el.querySelectorAll("thead th.db-sum, thead th:last-child")].map((x) => x.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0);
      return { tbls, lastRight: Math.round(last), panelRight: Math.round(r.right) };
    }, P("board"));
    check(`② ${v} 合わせた表を組む所で開いても、表の右（計）が切れない`, wide.tbls.every((t) => t.sw <= t.cw + 1) && wide.lastRight <= wide.panelRight, wide);
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
  const board = await ask(p, byId.board);
  const heads = await p.evaluate((sel) => [...document.querySelectorAll(`${sel} thead tr:first-child th[colspan] small`)].map((x) => x.textContent), P("board"));
  const gtot = board.groups.map((g) => total(g));
  check(`③ 合わせた表のまとまりごとの計がサーバーと合う（${gtot.join("・")}）`, heads.length === 2 && heads.every((h, i) => num(h) === gtot[i]) && gtot[0] === wipTotal && gtot[1] === workTotal, { heads, gtot });
  const flags = await p.$$eval(`${P("board")} .db-flag`, (x) => x.length);
  check("③ 仕掛があるのに前日 0 本の設備に印（前の版の 1 枚の表と同じ）", flags > 0, flags);

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
  check(`④ 狭く低くしても（${small.w}×${small.h}）はみ出さない`, small.w === 3 && small.h === 2 && !f4.bad.length, { small, f4 });
  check(`④ 入らない棒は描かず、下に「n / m を描いています」（${drawn} 本）`, drawn < want.length ? /\d+ \/ \d+ を描いています/.test(foot) : true, { drawn, foot });
  await p.click("[data-db-undo]"); await p.click("[data-db-undo]"); await p.click("[data-db-undo]"); await p.click("[data-db-undo]"); await sleep(800);
  const back = (await layout(p)).panels.find((x) => x.id === "wipClass");
  check("④ 元に戻す（4 回）で、大きさが戻る", back.w === 5 && back.h === 4, back);

  // ⑤ 組む（その場で描き直る・条件・当てる・元に戻す）
  await p.click(`${P("wipClass")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f");
  await p.click('[data-de-vis="none"]'); await sleep(1500);
  check("⑤ 「表」を選ぶと、グリッドの中のそのパネルがその場で表になる", await p.$(`${P("wipClass")} .pv-table`) !== null, "");
  await p.click("[data-de-fadd]");
  await p.selectOption('#deCond .db-crow [data-de-f="column"]', "製造材質");
  await p.fill('#deCond .db-crow [data-de-f="value"]', "A1100"); await p.dispatchEvent('#deCond .db-crow [data-de-f="value"]', "change");
  await sleep(1800);
  const cond = { ...byId.wipClass, visual: "none", filters: [{ column: "製造材質", op: "eq", value: "A1100" }], body: { ...byId.wipClass.body, grand: true } };
  const want5 = total(await ask(p, cond));
  const shown5 = await p.evaluate((sel) => [...document.querySelectorAll(`${sel} tr.is-grand td`)].map((t) => t.textContent)[0], P("wipClass"));
  check(`⑤ 条件（製造材質 ＝ A1100）でサーバーと同じ総計（${want5}）に減る`, num(shown5) === want5 && want5 < wipTotal, { shown5, want5 });
  await p.click("[data-de-apply]"); await sleep(600);
  const applied = (await layout(p)).panels.find((x) => x.id === "wipClass");
  check("⑤ 当てると組みに入る（表・条件 1 つ）", applied.visual === "none" && applied.filters.length === 1, applied);
  await p.click("[data-db-undo]"); await sleep(1200);
  const undone = (await layout(p)).panels.find((x) => x.id === "wipClass");
  check("⑤ 元に戻すで、組む前（横棒・条件なし）に戻る", undone.visual === "bar" && !undone.filters.length, undone);

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
  await p.mouse.move(tb.x + 20, tb.y + 20, { steps: 6 }); await sleep(200);
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

  // ⑧ 合わせた表を組む
  const rowsOf = () => p.$$eval(`${P("board")} tbody th[scope=row]`, (x) => x.map((t) => t.textContent));
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.click(`${P("board")} [data-db-edit]`); await p.waitForSelector("#deBoard .de-rowi[data-de-row]"); await sleep(600);
  const list0 = await p.$$eval("#deBoard .de-rowi[data-de-row]", (x) => x.map((li) => li.dataset.deRow)), rows0 = await rowsOf();
  check("⑧ 表全体の行の札が、表の行と同じ並び", JSON.stringify(list0.slice(0, rows0.length)) === JSON.stringify(rows0), { list0, rows0 });
  await p.click('#deBoard .de-rowi:first-child [data-de-rdown]'); await sleep(1500);
  const rows1 = await rowsOf(), o1 = await p.$eval("[data-de-border]", (x) => x.value);
  check("⑧ 行の札の ↓ で、表の 1 行目と 2 行目が入れ替わり、並びが「手で並べた順」になる", rows1[0] === rows0[1] && rows1[1] === rows0[0] && o1 === "manual", { rows1: rows1.slice(0, 3), o1 });
  await p.click('#deBoard .de-rowi[data-de-row="XYZ"] [data-de-rshow]'); await sleep(1500);
  const rows2 = await rowsOf();
  check("⑧ 「出す」を外すと、その行が表から消える", !rows2.includes("XYZ") && rows0.includes("XYZ"), rows2);
  await p.selectOption("[data-de-border]", "name"); await sleep(1500);
  const rows3 = await rowsOf();
  check("⑧ 名前の順にすると、表の行が名前の順", JSON.stringify(rows3) === JSON.stringify([...rows3].sort((a, b) => a.localeCompare(b, "ja"))), rows3);
  await p.click('[data-de-tab="0"]'); await p.waitForSelector("#deFields .pv-f"); await sleep(300);
  await p.click('[data-de-look][value="num"]', { force: true }).catch(async () => { await p.click('.de-seg:nth-child(3)'); }); await sleep(1500);
  check("⑧ ① の見せ方を「数だけ」にすると、棒が消える", (await p.$$eval(`${P("board")} .db-bar`, (x) => x.length)) === 0, "");
  await p.click("[data-de-fadd]");
  await p.selectOption('#deCond .db-crow [data-de-f="column"]', "製造材質");
  await p.fill('#deCond .db-crow [data-de-f="value"]', "A1100"); await p.dispatchEvent('#deCond .db-crow [data-de-f="value"]', "change");
  await sleep(2500);
  const g8 = { ...byId.board, groups: [{ ...byId.board.groups[0], filters: [{ column: "製造材質", op: "eq", value: "A1100" }] }, byId.board.groups[1]] };
  const want8 = total((await ask(p, g8)).groups[0]);
  const head8 = await p.evaluate((sel) => document.querySelector(`${sel} thead tr:first-child th[colspan] small`)?.textContent, P("board"));
  check(`⑧ ① の条件（製造材質 ＝ A1100）で、① の計がサーバーと同じ（${want8}）に減る`, num(head8) === want8 && want8 < wipTotal, { head8, want8 });
  await p.click("[data-de-apply]"); await sleep(800);
  const b8 = (await layout(p)).panels.find((x) => x.id === "board");
  check("⑧ 当てると組みに入る（名前の順・隠す XYZ・① は数だけ・条件 1 つ）",
    b8.order.by === "name" && b8.order.hide.includes("XYZ") && b8.groups[0].look === "num" && b8.groups[0].filters.length === 1, b8.order);
  await p.click("[data-db-undo]"); await sleep(1500);
  const u8 = (await layout(p)).panels.find((x) => x.id === "board");
  check("⑧ 元に戻すで、組む前（値の大きい順・隠す無し・棒）に戻る", u8.order.by === "value" && !u8.order.hide.length && u8.groups[0].look === "bar", u8.order);
  await p.click("[data-db-leave]").catch(() => {}); await sleep(300);
  await p.click("[data-db-discard]").catch(() => {}); await sleep(300);

  // ⑨ 計算列（版 3.38.0。要望「ダッシュボードに使えるカラムは追加した列も」）: 仕掛の一覧の表示列で式から作った列を、組む所の札に出し、行の段に使える
  await p.evaluate(() => {
    const k = "tpa.lotlist.layout.v1", all = JSON.parse(localStorage.getItem(k) || "{}");
    all["src:wip:仕掛"] = { ...(all["src:wip:仕掛"] || {}), formulas: { "設備の頭": "left([残仕掛設備ｺｰｽ], 3)", "ロット数の倍": "2" } };
    localStorage.setItem(k, JSON.stringify(all));
  });
  await p.reload(); await waitDash(p);           // 表示列の設定は頁を開いたときに読む
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.click(`${P("wipClass")} [data-db-edit]`); await p.waitForSelector("#deFields .pv-f.is-calc");
  const calcCards = await p.$$eval("#deFields .pv-f.is-calc b", (x) => x.map((b) => b.textContent));
  check("⑨ 組む所のカラムの札に、一覧で作った計算列が「式」の印つきで出る", calcCards.includes("設備の頭式") && calcCards.includes("ロット数の倍式"), calcCards);
  await p.click('#deFields .pv-f.is-calc[title^="設備の頭"] [data-de-add="rows"]'); await sleep(300);
  await p.click('.de-sent [data-de-x="rows"][data-i="0"]'); await sleep(2000);
  await p.click("[data-de-apply]"); await sleep(1500);
  const used9 = (await layout(p)).panels.find((x) => x.id === "wipClass");
  const ans9 = await ask(p, used9);
  const labels9 = ans9.orders[0].map((k) => ans9.labels[0][k]);
  const sum9 = ans9.cells.filter((c) => c.r.length === 1 && !c.c.length).reduce((a, c) => a + c.v[0], 0);
  check("⑨ 計算列を行の段にすると、パネルに式（使う物だけ）が写り、サーバーが式の値で数える（計は仕掛の総数と同じ）",
    used9.body.rows[0].column === "設備の頭" && Object.keys((used9.calc || {}).formulas || {}).join() === "設備の頭" && labels9.every((t) => [...t].length <= 3 || t === "（空欄）") && sum9 === wipTotal,
    { rows: used9.body.rows, calc: used9.calc, labels9, sum9, wipTotal });
  const bars9 = await p.evaluate((sel) => [...document.querySelectorAll(`${sel} svg rect title`)].length, P("wipClass"));
  check("⑨ パネルが計算列の段で描き直る", bars9 > 0, bars9);
  check("頁の誤りが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
