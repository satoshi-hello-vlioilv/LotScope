// 評価関数（開発用）: 集計表・グラフ（ピボット集計。版 3.23.0）と、作業実績の右の日・直の表の「合計する列」、表示の状態の保存。
//   node program/tools/ui-eval-pivot.mjs
// ① 作業実績で「集計表・グラフ」→ すぐに見る「作業日ごとのロット数・重量」→ 表の総計＝サーバーの作業でまとめた数（ロット数・重量の合計）、
//    時系列のグラフが作業日の最初から最後まで間も空けて描かれる（棒の数＝作業のあった日の数）
// ② 日×直のロット数 → 直ごとの積み上げ棒。ヒストグラム → 区間の棒と傾向の数・区間の幅を変えると、その幅で数え直す
// ③ 絞り込み（検索）を変えると、集計も同じ件数で数え直す（一覧と同じ絞り込み）
// ④ 作業実績の右の表で「合計する列」に重量 → 日・直のセルと合計の行に重量の合計（集計の総計と同じ）
// ⑤ 保存した見方: 集計表の組み方・作業でまとめる形（合計する列）・スライサーの開閉を保存 → 変えて → 呼び出すと戻る
// ⑥ 品質異常でも: すぐに見る（年月ごとの件数）で時系列。Excel に出力で「集計」「出力の条件」のシート
// ⑦ 設備を替えて集計を開き直しても、［行］は 1 回で 1 つ入り、× は 1 つだけ外す（以前は開き直すたびに押した時の処理が増え、偶数個で効かなかった）
// 全部合えば終了コード 0。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, pickChart, sleep } from "./ui-harness.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-"));
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) fails.push(name); };
const READ = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as ET
m = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
z = zipfile.ZipFile(sys.argv[1])
names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find(m + "sheets")]
def rows(i):
    out = []
    for r in ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml")).iter(m + "row"):
        cells = []
        for c in r.iter(m + "c"):
            t = c.find(m + "is/" + m + "t"); v = c.find(m + "v")
            cells.append(t.text if t is not None else v.text if v is not None else "")
        out.append(cells)
    return out
print(json.dumps({"names": names, "sheets": [rows(i + 1) for i in range(len(names))]}, ensure_ascii=False))`;

const app = await launch();
try {
  const p = await app.newPage("light");
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const grand = () => p.evaluate(() => { const tr = [...document.querySelectorAll("#llPivot .pv-table tr.is-grand")].pop(); return tr ? [...tr.querySelectorAll("td")].map((td) => td.textContent.replace(/,/g, "")) : null; });
  const work = (q = {}) => p.evaluate(async (q) => {
    const equip = document.querySelector("#llEquipBar [aria-selected=true]")?.dataset.equip || "";
    const u = new URLSearchParams({ equip, work: "1", total: "重量", page_size: "1", ...q });
    return (await (await fetch("/api/worklog?" + u)).json()).work;
  }, q);
  // ① 作業実績
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(700);
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-empty"); await sleep(300);
  const quick = await p.$$eval("#llPivot .pv-quickbig .pv-quick", (xs) => xs.map((x) => x.textContent));
  check("集計表を開くと、何も置いていない案内と「すぐに見る」組み方", quick.length >= 3 && quick[0].startsWith("作業日ごとのロット数"), quick);
  await p.click('#llPivot .pv-quickbig .pv-quick >> nth=0'); await p.waitForSelector("#llPivot .pv-table"); await sleep(500);
  const g1 = await grand(), w = await work();
  check("総計のロット数・重量の合計＝作業でまとめた数", g1 && +g1[0] === w.total.works && Math.abs(+g1[1] - w.total.sum) < 0.05, { g1, works: w.total.works, sum: w.total.sum });
  const days = new Set(w.buckets.map((b) => b.day).filter(Boolean)).size;
  const chart = await p.evaluate(() => ({ bars: document.querySelectorAll("#llPvChart svg rect").length, line: !!document.querySelector("#llPvChart svg path"), note: document.querySelector("#llPvChart .pv-cnote")?.textContent || "" }));
  const span = (() => { const ds = w.buckets.map((b) => b.day).filter(Boolean).sort(); return Math.round((new Date(ds[ds.length - 1]) - new Date(ds[0])) / 864e5) + 1; })();
  check("時系列: 作業のあった日の棒＋重量の折れ線、横は最初から最後の日まで", chart.bars === days && chart.line && chart.note.startsWith(`${span} 刻み`), { chart, days, span });
  // ② 日×直・ヒストグラム
  await p.click('#llPivot .pv-bar .pv-quick >> nth=1'); await sleep(900);
  const stack = await p.evaluate(() => ({ heads: [...document.querySelectorAll("#llPivot .pv-table thead th")].map((x) => x.textContent), legend: [...document.querySelectorAll("#llPvChart .pv-legend span")].map((x) => x.textContent) }));
  check("日×直: 列に直（1直・2直・3直・総計）、グラフは直ごとの積み上げ", ["1直", "2直", "3直", "総計"].every((x) => stack.heads.includes(x)) && stack.legend.join() === "1直,2直,3直", stack);
  await pickChart(p, "hist"); await sleep(1000);
  const hist = await p.evaluate(() => ({ rows: document.querySelector("#llPivot .pv-chip.r b")?.textContent, part: document.querySelector("#llPivot .pv-chip.r select")?.value,
    stats: [...document.querySelectorAll("#llPivot .pv-stats th")].map((x) => x.textContent), width: document.querySelector("#llPivot [data-pv-binw]")?.value }));
  check("ヒストグラム: 数の列を区間に・傾向の数（平均・標準偏差・四分位）・区間の幅", hist.part === "bin" && hist.stats.includes("標準偏差") && hist.stats.includes("中央値") && +hist.width > 0, hist);
  await p.fill("#llPivot [data-pv-binw]", "250"); await p.dispatchEvent("#llPivot [data-pv-binw]", "change"); await sleep(1000);
  const labels = await p.$$eval("#llPivot .pv-table tbody th", (xs) => xs.map((x) => x.textContent).filter((t) => t.includes("〜")).slice(0, 3));
  check("区間の幅を 250 にすると、250 刻みで数え直す", labels.length === 3 && labels.every((t) => { const [a, b] = t.split("〜").map(Number); return b - a === 250 && a % 250 === 0; }), labels);
  // ③ 絞り込み
  await p.click('#llPivot .pv-bar .pv-quick >> nth=0'); await sleep(800);
  await p.fill("#llSearch", "作業者A"); await sleep(1500);
  const g2 = await grand(), w2 = await work({ search: "作業者A" });
  check("検索で絞ると、集計も同じ絞り込みで数え直す", g2 && +g2[0] === w2.total.works && w2.total.works < w.total.works, { g2, works: w2.total.works });
  await p.fill("#llSearch", ""); await sleep(1500);
  // ④ 右の表の合計する列
  await p.click('#llViewSwitch [data-pv-view="list"]'); await sleep(500);
  await p.click('#llWorkSwitch [data-wk-mode="dayshift"]'); await p.waitForSelector("#llWork .wk-pv"); await sleep(500);
  await p.selectOption("#llWork [data-wk-total]", "重量"); await sleep(1200);
  const pane = await p.evaluate(() => ({ title: document.querySelector("#llWork .wk-title")?.textContent, sum: document.querySelector("#llWork .wk-sum .wk-tot .wk-sumv")?.textContent.replace(/,/g, ""), cells: document.querySelectorAll("#llWork tbody .wk-sumv").length }));
  check("右の表: 合計する列（重量）の合計を、日・直のセルと合計の行に", pane.title.includes("重量の合計") && Math.abs(+pane.sum - w.total.sum) < 0.1 && pane.cells > 10, { pane, want: w.total.sum });
  // ⑤ 保存した見方（集計の組み方・作業でまとめる形・スライサーの開閉）
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await sleep(900);
  await p.click("#llSlicerBtn"); await sleep(400);
  await p.click("#llPresetBtn"); await sleep(300);
  const tags = await p.$$eval(".fb-preset-tags i", (xs) => xs.map((x) => x.textContent));
  p.once("dialog", (d) => d.accept("作業日の実績"));
  await p.click("#llViewSave"); await sleep(500);
  await p.click('#llPivot [data-pv-clear]'); await sleep(500);
  await p.click('#llViewSwitch [data-pv-view="list"]'); await sleep(400);
  await p.click('#llWorkSwitch [data-wk-mode="none"]'); await sleep(800);
  await p.click("#llSlicerBtn"); await sleep(400);
  await p.click("#llPresetBtn"); await sleep(300);
  await p.click('.fb-preset-menu [data-preset-key^="v:"]'); await sleep(1600);
  const back = await p.evaluate(() => ({ view: document.querySelector('#llViewSwitch [aria-selected="true"]')?.dataset.pvView,
    rows: [...document.querySelectorAll("#llPivot .pv-chip.r b")].map((x) => x.textContent), vals: [...document.querySelectorAll("#llPivot .pv-chip.v b")].map((x) => x.textContent),
    work: TPA.local.get("tpa.worklog.count.v1", {}), slicer: !document.querySelector("#llSlicer").hidden }));
  const wc = Object.values(back.work)[0] || {};
  check("保存した見方の札に集計・作業でまとめる", tags.includes("集計表・グラフ") && tags.some((t) => t.startsWith("作業でまとめる: 日＋直ごと・合計")), tags);
  check("呼び出すと、集計の組み方・作業でまとめる形（合計する列）・スライサーの開閉が戻る",
    back.view === "pivot" && back.rows[0].startsWith("作業日") && back.vals.join() === "ロット数,重量" && wc.mode === "dayshift" && wc.total === "重量" && back.slicer, back);
  // ⑦ 設備を替えて集計を開き直しても、札は 1 回押せば 1 回だけ効く（版 3.24.0 まで: 開き直すたびに押した時の処理が 1 つずつ増え、
  //    偶数個のときは［行］を押しても入れてすぐ外して何も起きず、× は段をいくつも外した）。替える回数の偶数・奇数を両方試す
  const equips = await p.$$eval("#llEquipBar [data-equip]:not([aria-disabled=true])", (xs) => xs.map((x) => x.dataset.equip));
  const presses = [];
  for (let k = 0; k < 4; k++) {
    await p.click(`#llEquipBar [data-equip="${equips[(k + 1) % equips.length]}"]`); await sleep(1000);
    if (!(await p.evaluate(() => window.LotListPivot.on()))) { await p.click('#llViewSwitch [data-pv-view="pivot"]'); await sleep(900); }
    await p.evaluate(() => window.LotListPivot.setState({ ...window.LotListPivot.stateOf(), view: "pivot", rows: [], cols: [], measures: [] })); await sleep(600);
    const rowsNow = () => p.evaluate(() => window.LotListPivot.stateOf().rows.map((d) => d.column));
    const btns = await p.$$('#llPvFields .pv-f:not(.is-special) [data-pv-add="rows"]');
    await btns[0].click(); await sleep(500); const one = await rowsNow();
    await (await p.$$('#llPvFields .pv-f:not(.is-special) [data-pv-add="rows"]'))[1].click(); await sleep(500); const two = await rowsNow();
    const x = await p.$('#llPvHead .pv-slot[data-role="rows"] [data-pv-x="rows"][data-i="0"]');   // 入らなかったときは × も無い
    if (x) { await x.click(); await sleep(500); }
    const x1 = await rowsNow();
    presses.push({ k: k + 1, one: one.length, two: two.length, afterX: x1.length, kept: x1[0] === two[1] });
  }
  check("設備を替えて集計を開き直しても、［行］は 1 回で 1 つ入り、× は 1 つだけ外す（替える回数が奇数でも偶数でも）",
    presses.every((x) => x.one === 1 && x.two === 2 && x.afterX === 1 && x.kept), presses);
  await p.evaluate(() => window.LotListPivot.setState({ ...window.LotListPivot.stateOf(), view: "list", rows: [], cols: [], measures: [] }));

  // ⑥ 品質異常と Excel
  await p.click("#tabList"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-quick"); await sleep(400);
  const lotQuick = await p.$$eval("#llPivot .pv-quickbig .pv-quick", (xs) => xs.map((x) => x.textContent));
  await p.click('#llPivot .pv-quickbig .pv-quick >> nth=0'); await p.waitForSelector("#llPivot .pv-table"); await sleep(600);
  const lot = await p.evaluate(() => ({ count: document.querySelector("#llPivot .pv-hint")?.textContent, svg: !!document.querySelector("#llPvChart svg"), vals: [...document.querySelectorAll("#llPivot .pv-chip.v b")].map((x) => x.textContent) }));
  check("品質異常: 年月ごとの件数・ロット数の時系列", /（年月）ごとの件数/.test(lotQuick[0]) && lot.svg && lot.vals.join() === "件数,ロット数", { lotQuick, lot });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.click("#llPivot [data-pv-xlsx]")]);
  const f = path.join(dir, dl.suggestedFilename()); await dl.saveAs(f);
  const x = JSON.parse(execFileSync("python3", ["-c", READ, f], { encoding: "utf8" }));
  const head = x.sheets[0][0], last = x.sheets[0][x.sheets[0].length - 1];
  check("Excel に出力: 集計（見出し・総計）と出力の条件のシート", x.names.join() === "集計,出力の条件" && head[1] === "件数" && head[2] === "ロット数" && last[0] === "総計", { names: x.names, head, last });
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
