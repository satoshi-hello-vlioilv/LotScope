// 評価関数（開発用）: 列の幅の取っ手と、計算列の並べ替え（版 3.42.0）。
//   node program/tools/ui-eval-colsort.mjs
// 幅（利用者の要望 2026-10: 仕掛の一覧で、いちばん左に持ってきた列の幅を狭められない）
// 1. 異常ロット一覧・仕掛（データ元 wip）で、いちばん左へ動かした列の取っ手を左へ 40px 引くと、その列がちょうど 40px 狭まる
// 2. まとめて見出し行を付けた表（左端の列に畳むボタン・件数・字下げのぶんを足して描く）でも、左へ 60px 引くたびに 60px 狭まる
//    （前は覚える幅に足し分が入り込み、引くたびに逆に広がった）。いちばん狭い 20px まで狭められ、覚えた幅と描いた幅が同じ
// 3. 取っ手のダブルクリックで自動の幅に戻る（足し分も戻る）
// 4. 一覧を 150% に拡大していても、引いた量÷1.5 だけ狭まる
// 計算列の並べ替え（利用者の要望 2026-10: 計算列でもカラムクリックで行の並び替え）
// 5. 計算列の見出しを押すと ▲ 小さい順 → ▼ 大きい順 → 外す。並べ替えは全件（サーバー）で、ページの行は式の答えの順。
//    サーバーへは式（calc）を添え、窓では Python が答える（engine=python）。ふつうの列だけのときは添えない
// 6. 数の式は数の大小、字の式は字の順。Shift＋クリックでふつうの列と組める（2 つ目のキーが効く）
// 7. まとめた表の中の並べ替えにも使え、読み直しても残る（件数の行の並べ替えの札に出る）
// 8. 仕掛（データ元 wip）の計算列でも同じ
// 全部合えば終了コード 0。
import { launch, sleep } from "./ui-harness.mjs";

const app = await launch();
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
// 表示列の設定は「lotlist:表」・並び（まとめ・並べ替え）は表の名前で覚える（異常ロット一覧）。仕掛はどちらも「src:wip:表」
const LOT = "lotlist:仕掛", LOT_ARR = "仕掛", WIP = "src:wip:仕掛";
const head = (p) => p.evaluate(() => [...document.querySelectorAll("#llHead th")].map((th) => ({ c: th.dataset.col, w: th.offsetWidth, sort: th.dataset.sort || "" })));
/** 設定（表示列・並び）を置いて読み直す。screen は "list" か "wip" */
async function setup(p, { layout = {}, arrange = {}, sorts = {} }, screen = "list") {
  await p.evaluate(async (s) => {
    TPA.local.set("tpa.lotlist.layout.v1", s.layout); TPA.local.set("tpa.lotlist.arrange.v1", s.arrange); TPA.local.set("tpa.lotlist.sorts.v1", s.sorts);
    await TPA.saveUiState();
  }, { layout, arrange, sorts });
  await p.reload();
  await p.waitForSelector("#llBody tr[data-i]", { timeout: 30000 });
  if (screen === "wip") { await p.click('[data-screen="src:wip"]'); await p.waitForFunction(() => document.querySelector('#llHead th[data-col="鋳造番号"]'), null, { timeout: 30000 }); }
  await sleep(600);
}
const layoutOf = (order, extra = {}) => ({ order, hidden: [], widths: {}, locks: [], names: {}, formats: {}, aligns: {}, formulas: {}, rules: {}, builds: {}, ...extra });
/** 取っ手を dx だけ引く（10px ずつ） */
async function drag(p, col, dx) {
  const b = await (await p.$(`#llHead th[data-col="${col}"] .col-resize`)).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.mouse.move(x, y); await p.mouse.down();
  const step = dx < 0 ? -10 : 10;
  for (let d = step; Math.abs(d) <= Math.abs(dx); d += step) await p.mouse.move(x + d, y);
  await p.mouse.up(); await sleep(700);
}
const widthOf = async (p, c) => (await head(p)).find((h) => h.c === c).w;
const stored = (p, t, c) => p.evaluate(({ t, c }) => (TPA.local.get("tpa.lotlist.layout.v1", {})[t] || { widths: {} }).widths[c] || 0, { t, c });

try {
  const p = await app.newPage("light");
  // ---------- 1. いちばん左へ動かした列
  for (const [screen, t, col, rest] of [["list", LOT, "設備", ["ロット番号", "発生日", "不良名", "重量"]], ["wip", WIP, "製造調質", ["ロット番号", "鋳造番号", "製造材質"]]]) {
    await setup(p, { layout: { [t]: layoutOf([col, ...rest], { widths: { [col]: 140 } }) } }, screen);
    const h = await head(p), w0 = h[0].w;
    await drag(p, col, -40);
    const w1 = await widthOf(p, col);
    check(`1. ${screen}: 左端へ動かした「${col}」を左へ 40px → 40px 狭まる`, h[0].c === col && Math.abs(w0 - 40 - w1) <= 1, { first: h[0].c, w0, w1 });
  }
  // ---------- 2・3. まとめて見出し行を付けた表の左端の列
  for (const [screen, t, ta, col, lv] of [["list", LOT, LOT_ARR, "ロット番号", "設備"], ["wip", WIP, WIP, "製造調質", "製造材質"]]) {
    const order = col === "ロット番号" ? [] : [col, "ロット番号", "鋳造番号"];
    await setup(p, { layout: { [t]: layoutOf(order) }, arrange: { [ta]: { levels: [{ column: lv, dir: "asc", lot: false }], heads: true, suppress: false } } }, screen);
    const auto = await widthOf(p, col), steps = [];
    let w = auto;
    for (let k = 0; k < 4; k++) {
      await drag(p, col, -60);
      const now = await widthOf(p, col), s = await stored(p, t, col);
      steps.push({ now, stored: s, want: Math.max(20, w - 60) });
      w = now;
    }
    const first = (await head(p))[0].c;
    check(`2. ${screen}: まとめた表の左端「${col}」を左へ 60px ずつ → 60px ずつ狭まり（20px まで）、覚えた幅＝描いた幅`,
      first === col && steps.every((x) => Math.abs(x.now - x.want) <= 1 && x.now === x.stored), { auto, steps });
    await p.dblclick(`#llHead th[data-col="${col}"] .col-resize`); await sleep(800);
    check(`3. ${screen}: ダブルクリックで自動の幅（足し分を含む）に戻る`, Math.abs((await widthOf(p, col)) - auto) <= 1 && !(await stored(p, t, col)), { auto, now: await widthOf(p, col) });
  }
  // ---------- 4. 150% に拡大していても
  await setup(p, { layout: { [LOT]: layoutOf(["設備", "ロット番号"], { widths: { "設備": 160 } }) } });
  await p.evaluate(() => { document.querySelector("#llGrid").style.zoom = "1.5"; });
  await drag(p, "設備", -60);
  check("4. 150% に拡大: 左へ 60px 引くと 40px（60÷1.5）狭まる", Math.abs((await stored(p, LOT, "設備")) - 120) <= 1, await stored(p, LOT, "設備"));

  // ---------- 5〜7. 計算列の並べ替え（異常ロット一覧）
  const calcLayout = layoutOf(["ロット番号", "長さ2倍", "合金調質", "重量", "設備"], { formulas: { "長さ2倍": "[長さ]*2", "合金調質": "[合金] & '-' & [調質]" } });
  await setup(p, { layout: { [LOT]: calcLayout } });
  const asked = [];
  p.on("request", (r) => { const u = new URL(r.url()); if (/^\/api\/(lotlist|src\/[^/]+)$/.test(u.pathname)) asked.push(u.searchParams); });
  const colVals = (c, num) => p.evaluate(({ c, num }) => {
    const i = [...document.querySelectorAll("#llHead th")].findIndex((th) => th.dataset.col === c);
    return [...document.querySelectorAll("#llBody tr[data-i]")].sort((a, b) => a.dataset.i - b.dataset.i).map((tr) => {
      const t = tr.children[i].textContent.trim(); return num ? Number(t.replace(/,/g, "")) : t;
    });
  }, { c, num });
  const sortedBy = (v, dir, num) => v.every((x, k) => k === 0 || (num ? (dir === "asc" ? v[k - 1] <= x : v[k - 1] >= x) : (dir === "asc" ? v[k - 1] <= x : v[k - 1] >= x)));
  const clickHead = async (c, mod) => { asked.length = 0; await p.click(`#llHead th[data-col="${c}"] .th-in`, mod ? { modifiers: [mod] } : {}); await p.waitForFunction(() => !document.querySelector("#llBody.is-busy, .ll-busy"), null, { timeout: 15000 }).catch(() => {}); await sleep(900); };
  await clickHead("長さ2倍");
  let v = await colVals("長さ2倍", true), q = asked[asked.length - 1];
  const all = await p.evaluate(async (qs) => { const r = await (await fetch(`/api/lotlist?${qs}&page_size=5000`)).json(); return { count: r.count, n: r.rows.length, first: r.rows[0] }; }, q ? q.toString().replace(/&?page_size=\d+/, "") : "");
  const minLen = await p.evaluate(async () => { const r = await (await fetch("/api/lotlist?page=1&page_size=5000")).json(); return Math.min(...r.rows.map((x) => Number(x["長さ"])).filter((x) => Number.isFinite(x))) * 2; });
  check("5. 計算列「長さ2倍」を押す → ▲ 小さい順（ページの行が式の答えの順・全件でいちばん小さい値が先頭）",
    (await head(p)).find((h) => h.c === "長さ2倍").sort === "asc" && sortedBy(v.filter(Number.isFinite), "asc", true) && Math.abs(v[0] - minLen) < 1e-6, { head: v.slice(0, 5), minLen });
  check("5. 式を添えて Python に任せる（calc・engine=python）", !!q && q.get("engine") === "python" && JSON.parse(q.get("calc") || "{}").formulas?.["長さ2倍"] === "[長さ]*2", q && Object.fromEntries(q));
  check("5. サーバーの全件の答えも同じ順（先頭のロット）", all.first && all.first["ロット番号"] === (await colVals("ロット番号"))[0], all);
  await clickHead("長さ2倍");
  v = await colVals("長さ2倍", true);
  check("5. もう 1 度 → ▼ 大きい順", sortedBy(v.filter(Number.isFinite), "desc", true), v.slice(0, 5));
  await clickHead("長さ2倍");
  q = asked[asked.length - 1];
  check("5. 3 度目で外す（式は添えない）", (await head(p)).find((h) => h.c === "長さ2倍").sort === "" && !!q && !q.get("calc") && !q.get("engine"), q && Object.fromEntries(q));
  await clickHead("重量");
  q = asked[asked.length - 1];
  check("5. ふつうの列だけのときは式を添えない", !!q && !q.get("calc") && !q.get("engine"), q && Object.fromEntries(q));
  // 6. 字の式・Shift で組む
  await clickHead("合金調質");
  v = await colVals("合金調質");
  check("6. 字の式「合金調質」→ 字の順", sortedBy(v, "asc"), v.slice(0, 5));
  await clickHead("重量", "Shift");
  const pairs = (await colVals("合金調質")).map((x, k) => [x, v[k]]), w = await colVals("重量", true), al = await colVals("合金調質");
  const inner = al.every((x, k) => k === 0 || x !== al[k - 1] || w[k - 1] <= w[k]);
  check("6. Shift＋クリックで 2 つ目のキー（合金調質 ▲ → 重量 ▲。同じ合金調質の中は重量の順）", sortedBy(al, "asc") && inner, { pairs: pairs.slice(0, 3) });
  // 7. まとめた表の中で・読み直しても残る
  await setup(p, { layout: { [LOT]: calcLayout }, arrange: { [LOT_ARR]: { levels: [{ column: "設備", dir: "asc", lot: false }], heads: true, suppress: false } }, sorts: { [LOT_ARR]: [{ column: "長さ2倍", dir: "desc" }] } });
  const bar = await p.evaluate(() => document.querySelector("#llSortBar")?.dataset.summary || "");
  const grp = await p.evaluate(() => {
    const iE = [...document.querySelectorAll("#llHead th")].findIndex((th) => th.dataset.col === "設備"), iL = [...document.querySelectorAll("#llHead th")].findIndex((th) => th.dataset.col === "長さ2倍");
    return [...document.querySelectorAll("#llBody tr[data-i]")].sort((a, b) => a.dataset.i - b.dataset.i).map((tr) => [tr.children[iE].textContent.trim(), Number(tr.children[iL].textContent.replace(/,/g, ""))]);
  });
  const sameEquipDesc = grp.every((x, k) => k === 0 || x[0] !== grp[k - 1][0] || !(x[1] > grp[k - 1][1]));
  check("7. まとめた表の中の並べ替え（設備ごとに 長さ2倍 ▼）が効き、読み直しても札に残る", /長さ2倍 ▼/.test(bar) && sameEquipDesc && grp.length > 0, { bar, head: grp.slice(0, 4) });

  // ---------- 8. 仕掛（データ元 wip）
  await setup(p, { layout: { [WIP]: layoutOf(["ロット番号", "材質調質", "製造材質"], { formulas: { "材質調質": "[製造材質] & '/' & [製造調質]" } }) } }, "wip");
  await clickHead("材質調質");
  q = asked[asked.length - 1];
  v = await colVals("材質調質");
  check("8. 仕掛の計算列「材質調質」でも ▲ に並ぶ（/api/src/wip に式を添える）", sortedBy(v, "asc") && v.length > 0 && !!q && !!q.get("calc"), { head: v.slice(0, 4), q: q && Object.fromEntries(q) });
} catch (e) {
  console.error(e); fails.push(String(e));
} finally {
  await app.close();
}
if (fails.length) { console.log(`\n${fails.length} 件合いません`); process.exit(1); }
console.log("\n全部合いました");
