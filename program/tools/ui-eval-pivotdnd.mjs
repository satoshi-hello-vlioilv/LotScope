// 評価関数（開発用。版 3.50.0。利用者の要望 2026-10-22 の 1）: 行・列・値の札を引いて組み替える（本物の画面で、本物のマウスの引き方で）。
//   node program/tools/ui-eval-pivotdnd.mjs [1280x720]
// 一覧の集計表（作業実績）:
// ① カラムの札「作業区分」を文の［列］の枠へ引く → 列の段に入り、表の総計がサーバーの同じ組みの答えと合う
// ② 引いている間: 札の影がマウスに付き、置ける枠が色づき、差し込む線が出る（値の枠は置けない色）
// ③ 列の札「作業区分」を行の枠の先頭へ引く → 行が［作業区分, 作業日］・列が空（行 ⇔ 列）
// ④ 値の札「重量」をロット数の前へ引く → 値の順が入れ替わり、グラフにする値の札も重量になる
// ⑤ 行の札をカラムの欄へ戻す → 外れる／札に焦点で Alt＋↓ → 列へ移る／Delete → 外れる
// ⑥ 引いた後のクリックで、札の［行］ボタンの足し外しが起きない
// ダッシュボードの組む所:
// ⑦ カラムの札「作業区分」を［列］へ → パネルが列の段で描き直る・行の札を列へ引いて行と列を入れ替える → パネルの答えの段が入れ替わる
// ⑧ 合わせた表のまとまり（行は表全体で 1 つ）では、行の枠は置けない色で、置いても変わらない
// 値の計算（版 3.50.0。要望 2）と行 ⇔ 列の入れ替え:
// ⑨ 一覧の集計表の「値の計算」の段で、重量の合計に ÷1000 → 表の総計＝サーバーの計算なしの総計 ÷ 1000・欄の横に「前 → 後」・見出しに［値÷1000］・
//    打っている間も欄の焦点と字が消えない・札 ×100 で替わり、もう一度押すと外れる・読めない式は知らせて当てない
// ⑪ 小数の桁（版 3.50.1）: 「1桁」で表・総計・変わり方・数値ラベルが 1 桁・「自動」で外れる
// ⑫ 組む所の狭い段: 「小数」の札は次の行へ・よく使う計算の札は並べたまま（1 手で当たる）・「整数」が選ばれる
// ⑩ 「⇄ 入れ替え」: 行［作業区分］・列［直］ → 行［直］・列［作業区分］。列が空なら押せない（一覧・ダッシュボード）
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const VIEW = parseView(process.argv[2] || "1728x1152");
const center = async (p, sel) => { const el = await p.waitForSelector(sel); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
/** 本物のマウスで引く（途中で止めて観る: during(p)） */
async function dragTo(p, fromSel, toPoint, during) {
  const a = await center(p, fromSel);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(a.x + 12, a.y + 6, { steps: 3 });
  const to = typeof toPoint === "function" ? await toPoint() : toPoint;
  await p.mouse.move(to.x, to.y, { steps: 8 }); await sleep(120);
  const seen = during ? await during(p) : null;
  await p.mouse.up(); await sleep(250);
  return seen;
}
const slotPoint = async (p, scope, role, where = "end") => {
  const s = await center(p, `${scope} .pv-slot[data-role="${role}"]`);
  return where === "start" ? { x: s.b.x + 4, y: s.y } : { x: s.b.x + s.b.width - 4, y: s.y };
};
const chipSel = (scope, role, i) => `${scope} .pv-chip[data-dnd-role="${role}"][data-dnd-i="${i}"]`;
const names = (p, scope) => p.evaluate((sc) => Object.fromEntries(["rows", "cols", "vals"].map((r) => [r, [...document.querySelectorAll(`${sc} .pv-slot[data-role="${r}"] .pv-chip > b`)].map((b) => b.textContent.trim())])), scope);
const errors = [];
const app = await launch();
try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(700);
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-empty"); await sleep(300);
  // 作業日ごとのロット数・重量（行 作業日・値 ロット数と重量の合計）
  await p.evaluate(() => LotListPivot.setState({ view: "pivot", rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "sum", column: "重量" }], chart: "time" }));
  await p.waitForSelector("#llPivot .pv-table"); await sleep(600);
  const S = "#llPivot";
  const settle = async () => { await sleep(300); await p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy")); await p.waitForSelector("#llPivot .pv-table"); await sleep(250); };
  const server = (st) => p.evaluate(async (st) => {
    const equip = document.querySelector("#llEquipBar [aria-selected=true]")?.dataset.equip || "";
    const u = new URLSearchParams({ equip, rows: JSON.stringify(st.rows), cols: JSON.stringify(st.cols), measures: JSON.stringify(st.measures) });
    const d = await (await fetch("/api/worklog/pivot?" + u)).json();
    return (d.cells.find((c) => !c.r.length && !c.c.length) || {}).v;
  }, st);
  const grandRow = () => p.evaluate(() => { const tr = [...document.querySelectorAll("#llPivot .pv-table tr.is-grand")].pop(); return tr ? [...tr.querySelectorAll("td")].map((td) => +td.textContent.replace(/[^0-9.\-]/g, "")) : null; });

  // ①②
  const seen = await dragTo(p, `${S} .pv-f[data-dnd-col="作業区分"] > span`, () => slotPoint(p, S, "cols"), (q) => q.evaluate(() => ({
    ghost: !!document.querySelector(".pv-ghost"), ok: [...document.querySelectorAll("#llPivot .pv-slot.is-drop-ok")].map((s) => s.dataset.role),
    no: [...document.querySelectorAll("#llPivot .pv-slot.is-drop-no")].map((s) => s.dataset.role), on: document.querySelector("#llPivot .pv-slot.is-drop-on")?.dataset.role, line: !!document.querySelector("#llPivot .pv-ins") })));
  check("② 引いている間: 影・置ける枠（行・列）・置けない枠（値）・差し込む線", seen.ghost && seen.ok.join() === "rows,cols" && seen.no.join() === "vals" && seen.on === "cols" && seen.line, seen);
  await settle();
  let n = await names(p, S);
  check("① カラムの札を列へ → 列の段に作業区分", n.cols.join() === "作業区分" && n.rows.length === 1, n);
  const st1 = await p.evaluate(() => LotListPivot.stateOf());
  const g1 = await grandRow(), want1 = await server(st1);
  check("① 表の総計（右端の総計の列）がサーバーの答えと合う", g1 && Math.abs(g1[g1.length - 2] - want1[0]) < 1e-6 && Math.abs(g1[g1.length - 1] - want1[1]) < 0.11, { g1, want1 });
  check("② 引き終えると影・色・線が消える", await p.evaluate(() => !document.querySelector(".pv-ghost,.pv-ins,.is-drop-ok,.is-dragging")));

  // ③ 列の札を行の先頭へ
  await dragTo(p, chipSel(S, "cols", 0) + " > b", () => slotPoint(p, S, "rows", "start"));
  await settle();
  n = await names(p, S);
  check("③ 列の札を行の先頭へ → 行［作業区分, 作業日］・列は空", n.rows[0] === "作業区分" && n.rows.length === 2 && !n.cols.length, n);

  // ④ 値の並べ替え
  await dragTo(p, chipSel(S, "vals", 1) + " > b", () => slotPoint(p, S, "vals", "start"));
  await settle();
  const st4 = await p.evaluate(() => LotListPivot.stateOf());
  check("④ 値の札を前へ → 重量の合計が 1 つ目", st4.measures[0].column === "重量" && st4.measures[1].agg === "lots", st4.measures);

  // ⑤ カラムの欄へ戻して外す・Alt＋↓・Delete
  await dragTo(p, chipSel(S, "rows", 0) + " > b", () => center(p, "#llPvFields"));
  await settle();
  n = await names(p, S);
  check("⑤ 行の札をカラムの欄へ戻すと外れる", n.rows.join() === "作業日（現場歴）" || (n.rows.length === 1 && /作業日/.test(n.rows[0])), n);
  await p.focus(chipSel(S, "rows", 0)); await p.keyboard.press("Alt+ArrowDown"); await settle().catch(() => {});
  n = await names(p, S);
  check("⑤ Alt＋↓ で行の札が列へ", !n.rows.length && n.cols.length === 1, n);
  await p.evaluate(() => LotListPivot.setState({ view: "pivot", rows: [{ column: "@workday", part: "" }, { column: "作業区分", part: "" }], cols: [], measures: [{ agg: "lots" }], chart: "time" })); await settle();
  await p.focus(chipSel(S, "rows", 1)); await p.keyboard.press("Delete"); await settle();
  n = await names(p, S);
  check("⑤ Delete で外れ、焦点は前の札へ", n.rows.length === 1 && await p.evaluate(() => document.activeElement?.matches('.pv-chip[data-dnd-role="rows"]')), n);

  // ⑥ 引いた後のクリックで足し外しが起きない（［行］ボタンから引き始めて、列の枠へ置く）
  await dragTo(p, `${S} .pv-f[data-dnd-col="作業者"] [data-pv-add="rows"]`, () => slotPoint(p, S, "cols"));
  await settle();
  n = await names(p, S);
  check("⑥ ［行］ボタンから引いて列へ置くと、列にだけ入る（行に足されない）", n.cols.join() === "作業者" && n.rows.length === 1, n);

  // ⑨ 値の計算
  await p.evaluate(() => LotListPivot.setState({ view: "pivot", rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "sum", column: "重量" }], chart: "time" })); await settle();
  const one9 = await p.evaluate(() => { const s = document.querySelector("#llPivot .pv-sent"), a = s.querySelector(".pv-slot").getBoundingClientRect(), b = s.querySelector("[data-pv-clear]").getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 8; });
  check("⑨ 文（行・入れ替え・列・値・小計・総計・Excel・すべて外す）が 1 段に収まる", one9);
  const raw9 = await server({ rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "sum", column: "重量" }] });
  await p.click(`${S} [data-pc-in="1"]`); await p.keyboard.type("÷10", { delay: 60 });
  await sleep(150);
  const midFocus = await p.evaluate(() => document.activeElement?.dataset?.pcIn);
  await p.keyboard.type("00", { delay: 60 }); await sleep(1200); await settle();
  const g9 = await grandRow(), prev9 = await p.$eval(`${S} [data-pc-out="1"]`, (x) => x.textContent), head9 = await p.$eval(`${S} .pv-table thead`, (x) => x.textContent);
  check("⑨ 打っている間も欄の焦点が残る", midFocus === "1" && await p.evaluate(() => document.activeElement?.dataset?.pcIn === "1" && document.activeElement.value === "÷1000"), midFocus);
  check("⑨ 重量の合計 ÷1000 → 表の総計＝サーバーの総計 ÷ 1000", g9 && Math.abs(g9[g9.length - 1] - raw9[1] / 1000) < 0.06 && g9[g9.length - 2] === raw9[0], { g9, raw9 });
  check("⑨ 欄の横に「前 → 後」", /→/.test(prev9) && prev9.replace(/[^0-9.→]/g, "").startsWith(String(Math.round(raw9[1])).slice(0, 3)), prev9);
  check("⑨ 見出しに［値÷1000］", /［値÷1000］/.test(head9), head9);
  await p.click(`${S} [data-pc-q="×100"][data-pc-qi="1"]`); await settle();
  let st9 = await p.evaluate(() => LotListPivot.stateOf());
  check("⑨ 札 ×100 で替わる", st9.measures[1].expr === "×100", st9.measures);
  await p.click(`${S} [data-pc-q="×100"][data-pc-qi="1"]`); await settle();
  st9 = await p.evaluate(() => LotListPivot.stateOf());
  check("⑨ もう一度押すと外れる", !st9.measures[1].expr, st9.measures);
  await p.fill(`${S} [data-pc-in="0"]`, "x+"); await p.keyboard.press("Enter"); await sleep(400);
  st9 = await p.evaluate(() => LotListPivot.stateOf());
  const bad9 = await p.$eval(`${S} [data-pc-out="0"]`, (x) => x.textContent);
  check("⑨ 読めない式は知らせて当てない", !st9.measures[0].expr && /途中/.test(bad9), { bad9, m: st9.measures[0] });

  // ⑪ 小数の桁（版 3.50.1）: 重量の合計 ÷1000 に「1桁」→ 表の数がどれも小数 1 桁・総計＝サーバー÷1000 を 1 桁にした字・前 → 後も 1 桁・
  //    状態に dec・グラフの数値ラベルも 1 桁・「自動」で外れる（値は丸めない: 割合は元の数で出る）
  await p.fill(`${S} [data-pc-in="1"]`, "÷1000"); await p.keyboard.press("Enter"); await settle();
  await p.click(`${S} [data-pc-dec="1"][data-pc-di="1"]`); await settle();
  let st11 = await p.evaluate(() => LotListPivot.stateOf());
  const cells11 = await p.evaluate(() => [...document.querySelectorAll("#llPivot .pv-table tbody tr")].map((tr) => { const t = tr.querySelectorAll("td"); return t[t.length - 1]?.textContent.trim(); }).filter(Boolean));
  const want11 = (raw9[1] / 1000).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const prev11 = await p.$eval(`${S} [data-pc-out="1"]`, (x) => x.textContent);
  check("⑪ 「1桁」で状態に dec=1・札が選ばれる", st11.measures[1].dec === 1 && st11.measures[1].expr === "÷1000" && await p.$eval(`${S} [data-pc-dec="1"][data-pc-di="1"]`, (b) => b.getAttribute("aria-checked") === "true"), st11.measures);
  check("⑪ 表の重量の列の数がどれも小数 1 桁", cells11.length > 5 && cells11.every((t) => /^-?[\d,]+\.\d$/.test(t)), cells11.slice(0, 8));
  check("⑪ 総計＝サーバーの総計 ÷1000 を 1 桁にした字", cells11[cells11.length - 1] === want11, { last: cells11[cells11.length - 1], want11 });
  check("⑪ 変わり方の「後」も 1 桁", prev11.endsWith(want11), prev11);
  await p.click(`${S} [data-pv-opt="labels"]`).catch(() => {}); await settle();
  const lab11 = await p.evaluate(() => [...document.querySelectorAll("#llPivot svg text.pv-vl")].map((t) => t.textContent.trim()).filter((t) => /\d/.test(t)));
  check("⑪ グラフの数値ラベル: 重量（1桁）は小数 1 桁・ロット数（自動）は整数のまま（系列ごとの桁）", lab11.some((t) => /^-?[\d,]+\.\d$/.test(t)) && lab11.every((t) => /^-?[\d,]+(\.\d)?$/.test(t)) && lab11.some((t) => /^\d+$/.test(t)), lab11.slice(0, 12));
  await p.click(`${S} [data-pv-opt="labels"]`).catch(() => {}); await settle();
  await p.click(`${S} [data-pc-dec=""][data-pc-di="1"]`); await settle();
  st11 = await p.evaluate(() => LotListPivot.stateOf());
  check("⑪ 「自動」で dec が外れる", st11.measures[1].dec == null, st11.measures);
  await p.fill(`${S} [data-pc-in="1"]`, ""); await p.keyboard.press("Enter"); await settle();

  // ⑩ 入れ替え（一覧）
  await p.evaluate(() => LotListPivot.setState({ view: "pivot", rows: [{ column: "作業区分", part: "" }], cols: [], measures: [{ agg: "lots" }], chart: "column" })); await settle();
  check("⑩ 列が空なら「入れ替え」は押せない", await p.$eval(`${S} [data-pv-swap]`, (b) => b.disabled));
  await p.evaluate(() => LotListPivot.setState({ view: "pivot", rows: [{ column: "作業区分", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }], chart: "column" })); await settle();
  await p.click(`${S} [data-pv-swap]`); await settle();
  n = await names(p, S);
  check("⑩ 行と列が入れ替わる", n.rows.join() === "直" && n.cols.join() === "作業区分", n);

  // ⑦ ダッシュボードの組む所
  await p.click('[data-screen="dash"]'); await waitDash(p); await sleep(500);
  if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(300); }
  await p.focus('#dashGrid .db-p[data-id="workDays"]'); await p.keyboard.press("Enter");
  await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
  const E = "#dbEditor";
  const ans = () => p.evaluate(() => { const a = Dashboard._state().answers.workDays; return a && a.dims ? { rows: a.dims.rows.map((x) => x.column), cols: a.dims.cols.map((x) => x.column) } : null; });
  await dragTo(p, `${E} .pv-f[data-dnd-col="作業区分"] > span`, () => slotPoint(p, E, "cols"));
  await sleep(600); await waitDash(p); await sleep(300);
  n = await names(p, E);
  const a1 = await ans();
  check("⑦ カラムの札を［列］へ → 組む所の列に作業区分・パネルの答えも列の段", n.cols.join() === "作業区分" && (!a1 || a1.cols.join() === "作業区分"), { n, a1 });
  await dragTo(p, chipSel(E, "rows", 0) + " > b", () => slotPoint(p, E, "cols", "end"));
  await sleep(600); await waitDash(p); await sleep(300);
  n = await names(p, E);
  const a2 = await ans();
  check("⑦ 行の札を列へ（列は空きあり）→ 行は空・列［作業区分, 作業日］", !n.rows.length && n.cols.length === 2, { n, a2 });
  await dragTo(p, chipSel(E, "cols", 1) + " > b", () => slotPoint(p, E, "rows"));
  await dragTo(p, chipSel(E, "cols", 0) + " > b", () => slotPoint(p, E, "rows", "end"));
  await sleep(600); await waitDash(p); await sleep(300);
  n = await names(p, E);
  const a3 = await ans();
  check("⑦ 引き戻して 行［作業日, 作業区分］・パネルの答えも同じ段", n.rows.length === 2 && /作業日/.test(n.rows[0]) && !n.cols.length && (!a3 || (a3.rows.length === 2 && !a3.cols.length)), { n, a3 });

  // ⑩ 入れ替え（ダッシュボード）: いまは 行［作業日, 作業区分］・列［］ → 作業区分を列へ引いてから入れ替える
  await dragTo(p, chipSel(E, "rows", 1) + " > b", () => slotPoint(p, E, "cols")); await sleep(600); await waitDash(p);
  await p.click(`${E} [data-de-swap]`); await sleep(600); await waitDash(p); await sleep(300);
  n = await names(p, E);
  check("⑩ ダッシュボードでも行と列が入れ替わる", n.rows.join() === "作業区分" && /作業日/.test(n.cols.join()), n);

  // ⑫ 組む所（狭い段）: 「小数」と札は次の行へ（同じ値の段の中）・よく使う計算の札は並べたまま（畳まない。1 手で当たる）
  const fold12 = await p.evaluate(() => { const v = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
    const it = document.querySelector("#dbEditor .pc-item"), dg = it?.querySelector(".pc-dg")?.getBoundingClientRect(), qs = it?.querySelector(".pc-qs")?.getBoundingClientRect(), band = document.querySelector("#dbEditor .pc-band")?.getBoundingClientRect();
    return { qs: v("#dbEditor .pc-qs"), more: v("#dbEditor .pc-more"), inside: !!dg && dg.right <= band.right + 0.5, dgTop: dg?.top, qsTop: qs?.top }; });
  check("⑫ 組む所でも、よく使う計算は札のまま（畳まない）・小数の札は段の中に収まる", fold12.qs && !fold12.more && fold12.inside, fold12);
  await p.click(`${E} [data-pc-q="÷1000"][data-pc-qi="0"]`); await sleep(600); await waitDash(p); await sleep(300);
  check("⑫ 組む所で札 ÷1000 を 1 手で当てる", await p.$eval(`${E} [data-pc-in="0"]`, (x) => x.value) === "÷1000");
  await p.click(`${E} [data-pc-dec="0"][data-pc-di="0"]`); await sleep(600); await waitDash(p); await sleep(300);
  check("⑫ 組む所で「整数」を選ぶと札が選ばれる（描き直しても残る）", await p.$eval(`${E} [data-pc-dec="0"][data-pc-di="0"]`, (b) => b.getAttribute("aria-checked") === "true"));

  // ⑧ 合わせた表のまとまり
  await p.click("[data-de-cancel]"); await sleep(400);
  const board = await p.$('#dashGrid .db-p[data-id="board"]');
  if (board) {
    await p.focus('#dashGrid .db-p[data-id="board"]'); await p.keyboard.press("Enter"); await p.waitForSelector("#deTabs"); await sleep(500);
    await p.click('[data-de-tab="1"]'); await p.waitForSelector("#deFields .pv-f"); await sleep(600);
    const before = await names(p, E);
    const s8 = await dragTo(p, `${E} .pv-f[data-dnd-col="作業区分"] > span`, () => slotPoint(p, E, "rows"), (q) => q.evaluate(() => document.querySelector('#dbEditor .pv-slot[data-role="rows"]')?.className));
    await sleep(400);
    const after = await names(p, E);
    check("⑧ 合わせた表のまとまりでは、行の枠は置けない色・置いても変わらない", /is-drop-no/.test(s8 || "") && JSON.stringify(before) === JSON.stringify(after), { s8, before, after });
    await p.click("[data-de-cancel]"); await sleep(300);
  } else check("⑧ 合わせた表のパネル（board）がある", false, "無い");
  check("頁の誤りが無い", !errors.length, errors);
} finally { await app.close(); }
console.log(fails.length ? `NG ${fails.length} 件` : "OK（すべて合いました）");
process.exit(fails.length ? 1 : 0);
