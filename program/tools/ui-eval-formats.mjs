// 評価関数（開発用）: 共有の書式に、絞り込みの状態（効いている条件・スライサーで選んだ値）と並べ替えを入れて置き、当てると戻るか（版 3.28.0）。
//   node program/tools/ui-eval-formats.mjs [画像を置くフォルダ]
// 利用者の要望: 共有の書式の中に、フィルタの状態と並び替えの状態も含ませて保存したり読み出したりできるように。
// ① 作業実績で 条件（作業区分＝通常）・並べ替え（重量 ▼）・スライサー（作業者で作業者A を選ぶ）にして件数を控え、書式「絞り込み込み（試験）」として置く
//    → 置いた書式の札に「条件 1」「並べ替え 1」「スライサー（選んだ値）」
// ② 絞り込みを全部外して読み直す（件数が増える）→ 書式を当てる → 条件・並べ替え・スライサーの選んだ値が戻り、件数が①と同じ
// ③ 元に戻す → 条件・並べ替え・選んだ値が外れた形（②の外した形）に戻る
// ④ 設備を選んで、ほかの設備にも当てる → その設備を開くと同じ条件・並べ替え・選んだ値で、件数＝サーバーで同じ絞り込みを数えた数
// ⑤ 版 3.27.0 までの書式（条件の部品が無い）を当てても、いまの条件はそのまま（書式に無い部品は今のまま）
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 800)}`}`); if (!ok) fails.push(name); };
const FILTER = [{ column: "作業区分", op: "eq", value: "通常" }], SORT = [{ column: "重量", dir: "desc" }], SLICE = [{ column: "作業者", sel: ["作業者A"] }];
const idle = (p) => p.waitForFunction(() => !document.querySelector(".ll-screen.is-loading") && !!document.querySelector("#llBody tr[data-i], #llBody .ll-empty"), null, { timeout: 15000 }).then(() => sleep(500));
/** いまの所の覚え（条件・並べ替え・スライサーで選んだ値）と件数 */
const state = (p) => p.evaluate(() => {
  const k = window.LotList.formats.places()[0].key;
  const sl = (TPA.local.get("tpa.lotlist.slicer.v1", {}).tables || {})[k] || [];
  return { key: k, filters: (TPA.local.get("tpa.lotlist.active.v1", {})[k] || []).map((f) => `${f.column}${f.op}${f.value}`),
    sorts: (TPA.local.get("tpa.lotlist.sorts.v1", {})[k] || []).map((x) => `${x.column}${x.dir}`),
    sel: sl.filter((c) => (c.sel || []).length).map((c) => `${c.column}=${c.sel.join(",")}`), count: document.querySelector("#llCount")?.textContent || "" };
});
/** いまの所の覚えを置き換えて読み直す（利用者が条件・並べ替え・スライサーを触った形の再現） */
const setState = async (p, { filters, sorts, slicer }) => {
  await p.evaluate(async ([f, s, sl]) => {
    const k = window.LotList.formats.places()[0].key;
    const put = (key, v) => { const all = TPA.local.get(key, {}); if (v.length) all[k] = v; else delete all[k]; TPA.local.set(key, all); };
    put("tpa.lotlist.active.v1", f); put("tpa.lotlist.sorts.v1", s);
    const st = TPA.local.get("tpa.lotlist.slicer.v1", { open: {}, tables: {} }); st.tables = st.tables || {}; st.tables[k] = sl.map((c) => ({ column: c.column, key: "", sel: c.sel || [] }));
    TPA.local.set("tpa.lotlist.slicer.v1", st);
    await TPA.saveUiState();
  }, [filters, sorts, slicer]);
  await p.reload(); await p.waitForSelector("#tabWork"); await sleep(600);
  if (!(await p.evaluate(() => document.querySelector("#tabWork")?.getAttribute("aria-selected") === "true"))) await p.click("#tabWork");
  await idle(p);
};
const openPanel = async (p) => { if (await p.$eval("#llFormatPanel", (x) => x.hidden)) await p.click("#llFormatBtn"); await p.waitForSelector("#llFormatPanel .fm-save, #llFormatPanel .fm-note"); await sleep(300); };
const item = (name) => `#llFormatPanel .fm-item:has(.fm-main b:text-is("${name}"))`;

const app = await launch();
try {
  const p = await app.newPage("light", { width: 1728, height: 1152 });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.click("#tabWork"); await idle(p);
  // ① 絞り込み・並べ替え・スライサーの選んだ値 → 書式として置く
  await setState(p, { filters: FILTER, sorts: SORT, slicer: SLICE });
  const s1 = await state(p);
  await openPanel(p);
  await p.fill("#fmName", "絞り込み込み（試験）"); await p.click("#fmSave button[type=submit]"); await sleep(1200);
  const chips = await p.$$eval(`${item("絞り込み込み（試験）")} .fm-parts i`, (xs) => xs.map((x) => x.textContent));
  if (SHOT) await p.screenshot({ path: path.join(SHOT, "saved.png") });
  check("置いた書式の札に 条件 1・並べ替え 1・スライサー（選んだ値）", ["条件 1", "並べ替え 1", "スライサー（選んだ値）"].every((c) => chips.includes(c)) && s1.filters.length === 1 && s1.sel.length === 1, { chips, s1 });
  // ② 全部外して読み直す → 当てる
  await p.keyboard.press("Escape");
  await setState(p, { filters: [], sorts: [], slicer: [{ column: "作業者", sel: [] }] });
  const s2 = await state(p);
  await openPanel(p);
  await p.click(`${item("絞り込み込み（試験）")} .fm-apply`); await sleep(400); await idle(p);
  const s3 = await state(p);
  check("外した形から当てると、条件・並べ替え・スライサーで選んだ値が戻り、件数も同じ", s2.filters.length === 0 && s2.count !== s1.count
    && JSON.stringify([s3.filters, s3.sorts, s3.sel, s3.count]) === JSON.stringify([s1.filters, s1.sorts, s1.sel, s1.count]), { s1, s2, s3 });
  const tabs = await p.$$eval("#llActiveTabs [data-kind]", (xs) => xs.map((x) => x.dataset.kind));
  const cond = await p.$eval("#llCondBtn", (x) => x.textContent.replace(/\s+/g, ""));
  check("画面にも効いている（条件の数 1・効いている物のタブに並べ替えと選んだ値）", cond.includes("1") && tabs.includes("sort") && tabs.includes("slicer"), { cond, tabs });
  // ③ 元に戻す
  await openPanel(p);
  await p.click("#llFormatPanel .fm-undo"); await sleep(400); await idle(p);
  const s4 = await state(p);
  check("元に戻す → 当てる前（外した形）に戻る", JSON.stringify([s4.filters, s4.sorts, s4.sel, s4.count]) === JSON.stringify([s2.filters, s2.sorts, s2.sel, s2.count]), { s2, s4 });
  // ④ ほかの設備にも当てる
  await setState(p, { filters: FILTER, sorts: SORT, slicer: SLICE });
  await openPanel(p);
  await p.check('#llFormatPanel input[name="fmTo"][value="pick"]'); await sleep(200);
  const other = await p.$eval("#llFormatPanel .fm-equips input[data-key]", (x) => ({ key: x.dataset.key, label: x.parentElement.textContent.trim() }));
  await p.check(`#llFormatPanel .fm-equips input[data-key="${other.key}"]`); await sleep(150);
  await p.click(`${item("絞り込み込み（試験）")} .fm-apply`); await sleep(500);
  const stored = await p.evaluate((k) => ({ f: TPA.local.get("tpa.lotlist.active.v1", {})[k] || [], s: TPA.local.get("tpa.lotlist.sorts.v1", {})[k] || [],
    sel: ((TPA.local.get("tpa.lotlist.slicer.v1", {}).tables || {})[k] || []).filter((c) => (c.sel || []).length).map((c) => `${c.column}=${c.sel.join(",")}`) }), other.key);
  await p.keyboard.press("Escape");
  const equip = other.key.split(":")[1] || "";
  const btn = await p.$$eval("#llEquipBar [data-equip]", (xs, lab) => (xs.find((x) => lab.startsWith(x.textContent.trim().replace(/\s+/g, ""))) || {}).dataset?.equip || "", other.label.replace(/\s+/g, ""));
  await p.click(`#llEquipBar [data-equip="${btn || equip}"]`); await sleep(1200); await idle(p);
  const s5 = await state(p);
  const srv = await p.evaluate(async ([eq]) => {
    // 画面と同じ渡し方: 条件とスライサーで選んだ値（op: in）を filters に並べる（lotlist.js の filterParams）
    const q = new URLSearchParams({ equip: eq, page_size: "1",
      filters: JSON.stringify([{ column: "作業区分", op: "eq", value: "通常" }, { column: "作業者", op: "in", value: JSON.stringify(["作業者A"]) }]) });
    return (await (await fetch("/api/worklog?" + q)).json()).count;
  }, [btn || equip]);
  check(`ほかの設備（${other.label}）にも当てる → 開くと同じ条件・並べ替え・選んだ値`, stored.f.length === 1 && stored.s.length === 1 && stored.sel.length === 1
    && s5.filters.join() === s1.filters.join() && s5.sorts.join() === s1.sorts.join() && s5.sel.join() === s1.sel.join(), { other, stored, s5 });
  check("その設備の件数＝サーバーで同じ絞り込みを数えた数", s5.count.includes(`${srv.toLocaleString()}行`) || s5.count.includes(`全 ${srv.toLocaleString()}`), { count: s5.count, srv });
  // ⑤ 条件の部品が無い書式（版 3.27.0 までの形）を当てても、いまの条件はそのまま
  const old = await p.evaluate(async () => { const h = window.LotList.formats.here();
    const r = await fetch("/api/masters/formats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "古い形（試験）", source: h.source, table: h.table, origin: h.origin, body: { sorts: [{ column: "作業日", dir: "asc" }] } }) });
    return r.status; });
  const before5 = await state(p);
  await openPanel(p);
  await p.click(`${item("古い形（試験）")} .fm-apply`); await sleep(400); await idle(p);
  const s6 = await state(p);
  check("条件の部品が無い書式を当てても、いまの条件・選んだ値はそのまま（並べ替えだけ替わる）", old === 201 && s6.filters.join() === before5.filters.join() && s6.sel.join() === before5.sel.join() && s6.sorts.join() === "作業日asc", { old, before5, s6 });
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
