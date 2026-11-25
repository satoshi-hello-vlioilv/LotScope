// 評価関数（開発用）: 計算列を集計表・グラフとダッシュボードで使う（版 3.121.0。利用者の改良依頼 2026-11-17 の 1。採点 2026-11-calcpivot の N）。
//   node program/tools/ui-eval-calcpivot.mjs
// 品質の表「仕掛」に計算列 4 つ（重量t＝[重量]/1000・材調質＝concat・板厚区分＝if・寸法＝読めない式）を作り、次を確かめる:
//  ① 一覧の集計表のカラムの欄の頭に「ƒx 計算列 3」のまとまり（読めない式は最後に理由と直す口）。元の列の前
//  ② 集計表で 合金 を行・重量t の合計を値・板厚区分 を列にした答え（表の総計・板厚区分ごとの総計）が、サーバーへ同じ組み（式つき）を
//     問い合わせた答えと、別に数えた答え（一覧の全部の行の 重量÷1000 の合計）と同じ。式を添えないと計算列は 400
//  ③ ダッシュボードの組む所（品質）でも同じ札の形で、板厚区分 を行・重量t を値にしたパネルの答えが、同じ組みの問い合わせと同じ
//  ④ 作業実績は設備ごとの表示列の設定: 同じ名前の計算列でも設備ごとの式で数える（設備 A は ×2・設備 B は ×3）
//  ⑤ 読めない式の札の「表示列で直す ›」で、その列の作り方の窓が開く
//  ⑥ 表示列の窓の「集計表で値に置く」で、集計表が開いてその列の合計が値に入る
//  ⑦ 「畳む ▴」で計算列が隠れ（元の列が上に来る）、開き直しても畳んだまま（画面ごと）。開くと戻る
//  ⑧ 1728・1536×864・1280×720 で、集計表と組む所の計算列の札の字が切れない（2 段目は 2 行まで・語の途中で折れない）。
//     すぐに見るの行が 1 段（「組み方 ▾」が 2 段目へ折れない）。表の同じ値の小数の桁がそろう。一覧の計算列の値に小数の誤差が出ない
// 頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash, CALC_LAYOUT, pickChart } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
const CALC = { formulas: CALC_LAYOUT["lotlist:仕掛"].formulas, names: {} };
const setLayout = (p, l) => p.evaluate(async (x) => { TPA.local.set("tpa.lotlist.layout.v1", x); TPA.local.set("tpa.lotlist.pivot.v1", {}); TPA.local.set("tpa.calcfold.v1", {}); await TPA.saveUiState(); }, l);
const busyDone = (p) => p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy") && document.querySelector("#llPvOut .pv-table"), null, { timeout: 30000 });
const pvAsk = (p, api, q) => p.evaluate(async ([a, x]) => { const r = await fetch(`${a}/pivot?${new URLSearchParams(x)}`); return { st: r.status, d: await r.json() }; }, [api, q]);
/** 札の字の切れ・語の途中の折れ: 計算列の札の名前・2 段目が札の中に収まり、2 段目は 2 行まで・… を出さない */
const cardFit = (p, box) => p.evaluate((b) => [...document.querySelectorAll(`${b} .pv-f.is-fx`)].map((x) => {
  const name = x.querySelector("b"), line = x.querySelector(".fx-l"), lh = parseFloat(getComputedStyle(line).lineHeight) || 16;
  const r = x.getBoundingClientRect(), lr = line.getBoundingClientRect();
  return { col: name.textContent, nameCut: name.scrollWidth > name.clientWidth + 1, lineCut: line.scrollHeight > line.clientHeight + 1,
    lines: Math.round(lr.height / lh), out: lr.right > r.right + 1, text: line.textContent,
    // 語の途中の折れ: 折れない塊（.nw）が 2 行にまたがらない
    split: [...line.querySelectorAll(".nw")].some((n) => n.getClientRects().length > 1) };
}), box);

const app = await launch();
const errors = [];
try {
  /* ------------------------------------------------------------ ①〜③・⑤〜⑦（1728） */
  const p = await app.newPage("light", parseView("1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  await setLayout(p, CALC_LAYOUT); await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  // 一覧の計算列の値に小数の誤差が出ない（3.7053000000000003 → 3.7053）
  const cellsT = await p.evaluate(() => { const i = [...document.querySelectorAll("#llHead th")].findIndex((t) => t.dataset.col === "重量t"); return [...document.querySelectorAll("#llBody tr[data-i]")].slice(0, 40).map((tr) => (tr.children[i] || {}).textContent || ""); });
  check("一覧の計算列（重量t）の値に小数の誤差（0000000000 や 9999999999）が出ない", cellsT.length > 10 && cellsT.every((t) => !/\d{9,}/.test(t.replace(/[,.]/g, (c) => c))), cellsT.slice(0, 8));

  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPvFields .pv-f[data-col]"); await sleep(800);
  const side = await p.evaluate(() => {
    const list = [...document.querySelectorAll("#llPvFields > *")];
    const at = (sel) => list.findIndex((x) => x.matches(sel));
    return { head: (document.querySelector("#llPvFields .fx-head:not(.is-raw)") || {}).textContent || "", headAt: at(".fx-head:not(.is-raw)"), rawAt: at(".fx-head.is-raw"),
      fx: [...document.querySelectorAll("#llPvFields .pv-f.is-fx")].map((x) => [x.dataset.col, x.classList.contains("is-bad"), x.querySelector(".fx-l").textContent]),
      firstRaw: list.findIndex((x) => x.matches(".pv-f:not(.is-fx):not(.is-special)")) };
  });
  check("① 集計表のカラムの欄の頭に「ƒx 計算列 3」・作る口「＋ 一覧の列を作る」・畳む ▴", /計算列3/.test(side.head.replace(/\s/g, "")) && side.head.includes("＋ 一覧の列を作る") && side.head.includes("畳む"), side);
  check("① 計算列の札は元の列の前（読めない式〈寸法〉は最後に理由と直す口）",
    side.headAt >= 0 && side.rawAt > side.headAt && side.firstRaw > side.rawAt && side.fx.map((x) => x[0]).join() === "重量t,材調質,板厚区分,寸法"
    && side.fx[3][1] && /式が読めません/.test(side.fx[3][2]) && /表示列で直す/.test(side.fx[3][2]) && /= \[重量\]\/1000 · 数/.test(side.fx[0][2]), side);

  await p.click('#llPvFields .pv-f[data-col="合金"] [data-pv-add="rows"]'); await sleep(300);
  await p.click('#llPvFields .pv-f[data-col="重量t"] [data-pv-add="vals"]'); await sleep(300);
  await p.click('#llPvFields .pv-f[data-col="板厚区分"] [data-pv-add="cols"]'); await sleep(500);
  await busyDone(p); await sleep(400);
  const got = await p.evaluate(() => { const t = document.querySelector("#llPvOut .pv-table"); const tr = [...t.querySelectorAll("tbody tr")]; return tr.map((r) => [...r.children].map((c) => c.textContent.trim())); });
  const q = { rows: JSON.stringify([{ column: "合金", part: "" }]), cols: JSON.stringify([{ column: "板厚区分", part: "" }]), measures: JSON.stringify([{ agg: "sum", column: "重量t" }]), calc: JSON.stringify(CALC) };
  const ans = await pvAsk(p, "/api/lotlist", q);
  const grand = (ans.d.cells || []).find((c) => !c.r.length && !c.c.length);
  const byCol = Object.fromEntries((ans.d.cells || []).filter((c) => !c.r.length && c.c.length === 1).map((c) => [ans.d.labels[1][c.c[0]], c.v[0]]));
  // 別に数えた答え: 全部の行（一覧の 1 ページで全件を読む）の 重量 ÷ 1000 の合計・板厚 >= 1 で分けた合計
  // 区分は画面の式の答え（一覧のセルと同じ list-formula.js。窓の式〈formula.rs〉とは事例の表 formula_cases で突き合わせてある）
  const indep = await p.evaluate(async () => {
    const d = await (await fetch("/api/lotlist?page=1&page_size=5000")).json(); let all = 0, thick = 0, thin = 0;
    for (const r of d.rows || []) {
      const w = Number(r["重量"]); if (!Number.isFinite(w) || String(r["重量"]).trim() === "") continue;
      const v = w / 1000, k = window.LotListColumns.cell("lotlist:仕掛", "板厚区分", r).raw; all += v;
      if (k === "厚") thick += v; else if (k === "薄") thin += v;
    }
    return { all, thick, thin, n: (d.rows || []).length };
  });
  check(`② サーバーの答え（式つき）の重量t の総計 ${grand && grand.v[0].toFixed(1)} が別に数えた ${indep.all.toFixed(1)}（${indep.n} 行）と同じ`, grand && Math.abs(grand.v[0] - indep.all) < 1e-6, { grand, indep });
  check(`② 板厚区分ごとの合計（厚 ${(byCol["厚"] || 0).toFixed(1)}・薄 ${(byCol["薄"] || 0).toFixed(1)}）が別に数えた答えと同じ`, Math.abs(byCol["厚"] - indep.thick) < 1e-6 && Math.abs(byCol["薄"] - indep.thin) < 1e-6, { byCol, indep });
  const last = got[got.length - 1] || [];
  const fmt1 = (v) => v.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  check(`② 集計表の総計の行（${last.join(" | ")}）がサーバーの答えと同じ（1 桁）`, last[0] === "総計" && last.includes(fmt1(grand.v[0])) && last.includes(fmt1(byCol["厚"])) && last.includes(fmt1(byCol["薄"])), { last, grand, byCol });
  const decs = got.flatMap((r) => r.slice(1)).filter((t) => /^[\d,]+\.\d+$/.test(t)).map((t) => t.split(".")[1].length);
  check("⑧ 表の同じ値の小数の桁がそろう（どの数も同じ桁）", decs.length >= 8 && new Set(decs).size === 1, { decs, got });
  const noCalc = await pvAsk(p, "/api/lotlist", { ...q, calc: "" });
  check("② 式を添えなければ、計算列の組みは 400（サーバーは画面の式で数える）", noCalc.st === 400, noCalc);

  // ⑦ 畳む・開き直し・開く
  await p.click("#llPvFields [data-fx-fold]"); await sleep(300);
  const folded = await p.evaluate(() => ({ cards: document.querySelectorAll("#llPvFields .pv-f.is-fx").length, head: document.querySelector("#llPvFields .fx-head").textContent }));
  await p.reload(); await p.waitForSelector("#llPvFields .pv-f[data-col]"); await sleep(800);
  const again = await p.evaluate(() => ({ cards: document.querySelectorAll("#llPvFields .pv-f.is-fx").length, head: document.querySelector("#llPvFields .fx-head").textContent, store: TPA.local.get("tpa.calcfold.v1", {}) }));
  await p.click("#llPvFields [data-fx-fold]"); await sleep(300);
  const opened = await p.evaluate(() => document.querySelectorAll("#llPvFields .pv-f.is-fx").length);
  check("⑦ 畳むと計算列の札が隠れ「4 列を畳んでいます」、開き直しても畳んだまま（集計表だけ）、開くと戻る",
    folded.cards === 0 && /4 列を畳んでいます/.test(folded.head) && again.cards === 0 && again.store.pivot === true && !again.store.dash && opened === 4, { folded, again, opened });

  // ⑤ 読めない式の札の「表示列で直す ›」→ 作り方の窓
  await p.click('#llPvFields .pv-f[data-col="寸法"] [data-pv-fxfix]'); await sleep(900);
  const fixWin = await p.evaluate(() => ({ panel: !!document.querySelector("#llColumnPanel:not([hidden])"), focus: (document.querySelector("#lcList li.is-focus") || {}).dataset?.col, fx: !!document.querySelector("#llFxPanel:not([hidden])") }));
  check("⑤ 読めない式の「表示列で直す ›」で、表示列の窓でその列（寸法）を選び、作り方の窓が開く", fixWin.panel && fixWin.focus === "寸法" && fixWin.fx, fixWin);
  await p.evaluate(() => { document.querySelector("#llFxPanel:not([hidden]) [data-act=close]")?.click(); }); await sleep(300);

  // ⑥ 表示列の窓の「集計表で値に置く」
  await p.evaluate(() => { window.LotListPivot.setState({ view: "list", rows: [], cols: [], measures: [] }); }); await sleep(300);
  await p.evaluate(() => document.querySelector('#lcList li[data-col="重量t"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))); await sleep(300);
  await p.click('#lcList li[data-col="重量t"]').catch(() => {}); await sleep(400);
  const hasBtn = await p.$("#lcFxPivot");
  check("⑥ 表示列の窓で計算列（重量t）を選ぶと「集計表で値に置く」がある", !!hasBtn, null);
  if (hasBtn) {
    await p.click("#lcFxPivot"); await sleep(600); await busyDone(p).catch(() => {}); await sleep(400);
    const st = await p.evaluate(() => ({ on: window.LotListPivot.on(), s: window.LotListPivot.stateOf(), panel: !!document.querySelector("#llColumnPanel:not([hidden])") }));
    check("⑥ 押すと表示列の窓が閉じ、集計表・グラフが開いて 重量t の合計が値に入り、行も入る", st.on && !st.panel && st.s.measures.some((m) => m.column === "重量t" && m.agg === "sum") && st.s.rows.length > 0, st);
  }

  // ③ 組む所
  await p.evaluate(() => showScreen("dash")); await waitDash(p); await sleep(500);
  await p.click("[data-db-editmode]"); await sleep(500);
  const b = await p.$('#dashGrid .db-p[data-id="wipClass"] [data-db-edit]');
  if (b) await b.click(); else { await p.focus('#dashGrid .db-p[data-id="wipClass"]'); await p.keyboard.press("Enter"); }
  await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
  await p.selectOption("[data-de-src]", "lot"); await p.waitForSelector('#deFields .pv-f[data-dnd-col="板厚区分"]', { timeout: 30000 }); await sleep(400);
  const dside = await p.evaluate(() => ({ head: (document.querySelector("#deFields .fx-head:not(.is-raw)") || {}).textContent || "",
    fx: [...document.querySelectorAll("#deFields .pv-f.is-fx")].map((x) => [x.querySelector("b").textContent, x.classList.contains("is-bad")]),
    oldBtn: !!document.querySelector(".de-fsearch [data-de-calcnew]") }));
  check("③ 組む所も同じ「ƒx 計算列 3」のまとまり（作る口は「＋ このパネルだけの列」・畳みは集計表と別）", /計算列3/.test(dside.head.replace(/\s/g, "")) && dside.head.includes("＋ このパネルだけの列") && dside.head.includes("畳む")
    && dside.fx.map((x) => x[0]).join() === "重量t,材調質,板厚区分,寸法" && dside.fx[3][1] && !dside.oldBtn, dside);
  await p.click('#deFields .pv-f[data-dnd-col="板厚区分"] [data-de-add="rows"]'); await sleep(400);
  await p.click('#deFields .pv-f[data-dnd-col="重量t"] [data-de-add="vals"]'); await sleep(400);
  await p.click('#deFields [data-de-add="vals"][data-col="@lots"]').catch(() => {}); await sleep(400);
  await waitDash(p); await sleep(1200);
  const pan = await p.evaluate(() => window.DashEditor && DashEditor._panel ? DashEditor._panel() : null);
  const da = pan && await p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), pan);
  const dv = da && Object.fromEntries((da.cells || []).filter((c) => c.r.length === 1).map((c) => [da.labels[0][c.r[0]], c.v[0]]));
  check(`③ 組む所のパネル（板厚区分ごとの重量t）の答え（厚 ${dv && dv["厚"] && dv["厚"].toFixed(1)}・薄 ${dv && dv["薄"] && dv["薄"].toFixed(1)}）が集計表と同じ`, !!dv && near(dv["厚"], byCol["厚"]) && near(dv["薄"], byCol["薄"]) && !!(pan.calc && pan.calc.formulas && pan.calc.formulas["重量t"]), { dv, byCol, calc: pan && pan.calc });
  const shownBars = await p.evaluate(() => [...document.querySelectorAll("#dbEditor .db-p text, .de-preview text, #dashGrid .db-p.is-editing text")].map((t) => t.textContent).join(" "));
  check("③ 組む所の見本のグラフに 厚 と 薄 が出る", /厚/.test(shownBars) && /薄/.test(shownBars), shownBars.slice(0, 200));
  await p.click("#deFields .pv-f.is-bad [data-de-fxfix]"); await sleep(900);
  const dfix = await p.evaluate(() => ({ panel: !!document.querySelector("#llColumnPanel:not([hidden])"), fx: !!document.querySelector("#llFxPanel:not([hidden])"), toast: (document.querySelector(".tpa-toast") || {}).textContent || "" }));
  check("⑤ 組む所の読めない式の「表示列で直す ›」も、作り方の窓を開く（一覧の表が同じとき）", dfix.fx || /表示列/.test(dfix.toast), dfix);
  await p.context().close();

  /* ------------------------------------------------------------ ④ 作業実績: 設備ごとの式 */
  const w = await app.newPage("light", parseView("1728x1152"));
  w.on("pageerror", (e) => errors.push(e.message));
  await w.click("#tabWork"); await w.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  const asked = await w.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/api\/worklog\?/.test(n)).pop() || "");
  const wq = new URL(asked).searchParams, eqA = wq.get("equip") || "";
  const table = wq.get("table") || (await w.evaluate(async (u) => (await (await fetch(u)).json()).table || "", asked));   // 一覧の表示列の設定の鍵は表の名前まで
  const eqs = await w.evaluate(() => [...document.querySelectorAll("#llEquipBar [data-equip], #llEquipBar [role=tab]")].map((x) => x.dataset.equip || x.dataset.key || "").filter(Boolean));
  const fl = await pvAsk(w, "/api/worklog", { fields: "1", equip: eqA, ...(table ? { table } : {}) });
  const numCol = ((fl.d.fields || []).find((f) => f.numeric && !f.date && !/年月日|日時|時刻|時分秒/.test(f.column)) || {}).column;
  check(`④ 前提: 作業実績（設備 ${eqA}）に数の列（${numCol}）があり、ほかの設備もある`, !!numCol && eqs.length >= 2, { eqA, eqs, numCol });
  if (numCol && eqs.length >= 2) {
    const eqB = eqs.find((x) => x !== eqA);
    const layout = { [`worklog:${eqA}:${table}`]: { formulas: { "倍": `[${numCol}]*2` } }, [`worklog:${eqB}:${table}`]: { formulas: { "倍": `[${numCol}]*3` } } };
    await w.evaluate(async (l) => { TPA.local.set("tpa.lotlist.layout.v1", l); TPA.local.set("tpa.lotlist.pivot.v1", {}); await TPA.saveUiState(); }, layout);
    await w.reload(); await w.click("#tabWork"); await w.waitForSelector("#llBody tr[data-i]"); await sleep(800);
    const sumOf = async (eq, mul) => {
      const one = await pvAsk(w, "/api/worklog", { equip: eq, ...(table ? { table } : {}), rows: "[]", cols: "[]", measures: JSON.stringify([{ agg: "sum", column: numCol }]) });
      const c = (one.d.cells || []).find((x) => !x.r.length && !x.c.length); return c ? c.v[0] * mul : null;
    };
    const runFor = async (eq) => {
      await w.evaluate((e) => { const b = [...document.querySelectorAll("#llEquipBar [data-equip], #llEquipBar [role=tab]")].find((x) => (x.dataset.equip || x.dataset.key) === e); b && b.click(); }, eq); await sleep(1200);
      await w.evaluate(() => window.LotListPivot.setState({ view: "pivot", rows: [{ column: "@workday", part: "ym" }], cols: [], measures: [{ agg: "sum", column: "倍" }], grand: true }));
      await busyDone(w).catch(() => {}); await sleep(600);
      const msg = await w.evaluate(() => (document.querySelector("#llPvMsg") || {}).textContent || ""); if (msg) console.log("集計の知らせ:", msg);
      return w.evaluate(() => { const tr = [...document.querySelectorAll("#llPvOut .pv-table tbody tr")].pop(); return tr ? [...tr.children].map((c) => c.textContent.trim()) : []; });
    };
    const ra = await runFor(eqA), rb = await runFor(eqB);
    const sa = await sumOf(eqA, 2), sb = await sumOf(eqB, 3);
    const num = (r) => Number(String(r[r.length - 1] || "").replace(/,/g, ""));
    const tol = (x, y) => y != null && Math.abs(x - y) <= Math.max(0.06, Math.abs(y) * 1e-6);
    check(`④ 設備 ${eqA} の「倍」（×2）の総計 ${num(ra)} が ${numCol}×2 の合計 ${sa} と同じ`, tol(num(ra), sa), { ra, sa });
    check(`④ 設備 ${eqB} の同じ名前の「倍」は ×3 の式で ${num(rb)}（${numCol}×3 の合計 ${sb}）`, tol(num(rb), sb), { rb, sb });
  }
  await w.context().close();

  /* ------------------------------------------------------------ ⑧ 3 つの大きさ */
  for (const v of ["1728x1152", "1536x864", "1280x720"]) {
    const q3 = await app.newPage("light", parseView(v));
    q3.on("pageerror", (e) => errors.push(e.message));
    await setLayout(q3, CALC_LAYOUT); await q3.reload(); await q3.waitForSelector("#llBody tr[data-i]"); await sleep(600);
    await q3.click('#llViewSwitch [data-pv-view="pivot"]'); await q3.waitForSelector("#llPvFields .pv-f[data-col]"); await sleep(600);
    await q3.click('#llPvFields .pv-f[data-col="合金"] [data-pv-add="rows"]'); await sleep(300);
    await q3.click('#llPvFields .pv-f[data-col="重量t"] [data-pv-add="vals"]'); await sleep(300);
    await q3.click('#llPvFields .pv-f[data-col="板厚区分"] [data-pv-add="cols"]'); await sleep(400);
    await pickChart(q3, "column").catch(() => {}); await q3.keyboard.press("Escape"); await busyDone(q3); await sleep(500);
    const pf = await cardFit(q3, "#llPvFields");
    const bad = pf.filter((x) => x.nameCut || x.lineCut || x.out || x.split || x.lines > 3);
    check(`⑧ ${v}: 集計表の計算列の札 ${pf.length} 枚の名前と 2 段目が切れず、語の途中で折れない（2 段目は 2 行まで）`, pf.length === 4 && !bad.length && pf.filter((x) => !/寸法/.test(x.col)).every((x) => x.lines <= 2), pf);
    const bar = await q3.evaluate(() => { const pre = document.querySelector("#llPvPreset"), pick = document.querySelector("#llPvChartBtn"); return { pre: pre && pre.getBoundingClientRect().top, pick: pick && pick.getBoundingClientRect().top }; });
    check(`⑧ ${v}: すぐに見るの行が 1 段（「組み方 ▾」が グラフ ▾ と同じ段）`, bar.pre != null && Math.abs(bar.pre - bar.pick) < 8, bar);
    await q3.evaluate(() => showScreen("dash")); await waitDash(q3); await sleep(400);
    await q3.click("[data-db-editmode]"); await sleep(400);
    const eb = await q3.$('#dashGrid .db-p[data-id="wipClass"] [data-db-edit]');
    if (eb) await eb.click(); else { await q3.focus('#dashGrid .db-p[data-id="wipClass"]'); await q3.keyboard.press("Enter"); }
    await q3.waitForSelector("#deFields .pv-f"); await waitDash(q3); await sleep(300);
    await q3.selectOption("[data-de-src]", "lot"); await q3.waitForSelector('#deFields .pv-f[data-dnd-col="板厚区分"]', { timeout: 30000 }); await sleep(500);
    const df = await cardFit(q3, "#deFields");
    const dbad = df.filter((x) => x.nameCut || x.lineCut || x.out || x.split || x.lines > 3);
    check(`⑧ ${v}: 組む所の計算列の札 ${df.length} 枚の名前と 2 段目が切れず、語の途中で折れない`, df.length === 4 && !dbad.length, df);
    const unit = await q3.evaluate(() => { const u = document.querySelector("#dbEditor .pc-uin"); return u ? { w: u.clientWidth, need: (() => { const c = document.createElement("canvas").getContext("2d"); c.font = getComputedStyle(u).font; return c.measureText(u.placeholder).width + 16; })(), ph: u.placeholder } : null; });
    check(`⑧ ${v}: 組む所の値の計算の単位の欄の見本（${unit && unit.ph}）が欄に収まる`, !unit || unit.w >= unit.need - 1, unit);
    await q3.context().close();
  }
} finally {
  await app.close();
}
check("頁の誤りが無い", errors.length === 0, errors);
console.log(fails.length ? `NG ${fails.length} 件` : "すべて OK");
process.exit(fails.length ? 1 : 0);
