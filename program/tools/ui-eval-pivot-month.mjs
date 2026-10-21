// 評価関数（開発用）: 集計表・グラフの 月ごと・月で区切る・月を ◀ ▶ で送る・数値ラベル・組み方のプリセット（共通／ID・標準）
// （版 3.26.0。置き場は 7 案＋2 回目で選んだ: ui-proposals/2026-10-pvmonth* の M4。組み方の入口は版 3.27.0 でグラフの形の行の「組み方 ▾」へ移した:
// いまの組み方の名前と★は、すぐに見るの札か「組み方: 名前 ▾」で見る）。
//   node program/tools/ui-eval-pivot-month.mjs [画像を置くフォルダ]
// ① 作業実績で「作業日ごとのロット数・重量」→ グラフの見出しの右に 数値ラベル・月で区切る・◀ すべての月 ▶（月の一覧＝サーバーの months）。
//    文の頭に「☆ 組み方 なし ▾」。利用者の PC（1728×1152）とフル HD・125%（1536×864）で、文・グラフの形・グラフの見出しが各 1 段
// ② 作業日のまとめ方を「年月」に → 表の行＝月の数、総計は日ごとと同じ（ロット数・重量の合計）
// ③ 月で区切る → 表に月の小計（月の数だけ。足すと総計）・表の角に「（年月）」・グラフに月の境目の線（月の数−1）と月の名前（月の数）
// ④ ◀ で新しい月から遡る: 選んだ月の日だけが表に並び、総計＝③の月の小計。数値ラベルは間引かず、棒のある日の数だけ・字は表のロット数と同じ。
//    ◀ を押し切ると最初の月で ◀ が押せない。▶ で戻り、「すべての月」で ▶ が押せない。添え書きに「◯年◯月だけ」
// ⑤ 表だけにしても、表の上の帯に 月で区切る・◀ 月 ▶ が残る（数値ラベルはグラフだけなので出さない）
// ⑥ 組み方: 面で「自分」に標準として保存 → ボタンに名前と★。すべて外す → 面から当てると、行・値・月で区切る・数値ラベルが戻る
// ⑦ 別の設備で集計表を開くと（組み方が空）、自分の標準を自動で当てる
// ⑧ この表に無いカラムを含む組み方を当てると、そのカラムを外して知らせる。行の段が無くなる組み方は当てない
// ⑨ 共通の標準と自分の標準: 自分の標準が先。自分の標準を消すと共通の標準を当てる。面から消す（確かめの窓で はい）
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, pickChart, sleep } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 900)}`}`); if (!ok) fails.push(name); };
const num = (t) => +String(t || "").replace(/,/g, "");
const idle = (p) => p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy") && !!document.querySelector("#llPivot .pv-table, #llPivot .pv-empty"), null, { timeout: 15000 }).then(() => sleep(350));
/** 表: 総計の行・小計の行・データの行（見出し＝最後の th の字・数＝td） */
const table = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll("#llPivot .pv-table tbody tr")].map((tr) => ({ kind: tr.classList.contains("is-grand") ? "grand" : tr.classList.contains("is-sub") ? "sub" : "data",
    head: [...tr.querySelectorAll("th")].map((x) => x.textContent), v: [...tr.querySelectorAll("td")].map((x) => +x.textContent.replace(/,/g, "") || 0) }));
  return { rows, corner: document.querySelector("#llPivot .pv-corner")?.textContent || "" };
});
const opts = (p) => p.evaluate(() => {
  const o = document.querySelector("#llPivot .pv-copts");
  const sel = o?.querySelector("[data-pv-month]");
  return { labels: !!o?.querySelector('[data-pv-opt="labels"]'), split: !!o?.querySelector('[data-pv-opt="split"]'), month: sel ? sel.value : null,
    months: sel ? [...sel.options].map((x) => x.value).filter(Boolean) : [], prev: o?.querySelector('[data-pv-mstep="-1"]')?.disabled, next: o?.querySelector('[data-pv-mstep="1"]')?.disabled,
    // いまの組み方: すぐに見るの札で印の付いた物か、グラフの形の行の「組み方: 名前 ▾」（版 3.27.0 で文の頭から移した）。★＝標準
    preset: (document.querySelector("#llPivot .pv-bar .pv-quick.is-on") || document.querySelector("#llPvPreset"))?.textContent.replace(/\s+/g, " ").trim() || "",
    std: !!document.querySelector("#llPivot .pv-bar .pv-quick.is-on .pv-star.is-std, #llPvPreset .pv-star.is-std"),
    hint: document.querySelector("#llPivot .pv-hint")?.textContent || "", note: document.querySelector("#llPvChart .pv-cnote")?.textContent || "" };
});
/** 文・グラフの形・グラフの見出しが何段か（子の縦の真ん中が 8px 以上ずれた数） */
const lines = (p) => p.evaluate(() => Object.fromEntries([["sent", "#llPivot .pv-sent"], ["bar", "#llPivot .pv-bar"], ["chead", "#llPvChart .pv-chead"]].map(([k, sel]) => {
  const box = document.querySelector(sel); if (!box) return [k, 0];
  const kids = [...box.querySelectorAll(":scope > *, :scope > .pv-copts > *, :scope > .pv-legend > *")].filter((x) => x.getBoundingClientRect().width > 0 && !x.classList.contains("pv-copts") && !x.classList.contains("pv-legend"));
  const mids = kids.map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
  return [k, mids.reduce((n, m, i) => n + (i && m - mids[i - 1] > 8 ? 1 : 0), mids.length ? 1 : 0)];
})));
const flash = (p) => p.evaluate(() => document.querySelector("#llFlash")?.textContent || "");
const api = (p, method, url, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, m === "GET" || m === "DELETE" ? { method: m } : { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => ({})) }; }, [method, url, body]);
const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: path.join(SHOT, `${name}.png`) }); };

const app = await launch();
try {
  for (const view of [{ width: 1536, height: 864 }, { width: 1728, height: 1152 }]) {
    const full = view.width === 1728, tag = `${view.width}×${view.height}`;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
    // ① 作業実績 → 集計表 → 作業日ごとのロット数・重量
    await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(700);
    await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-empty"); await sleep(300);
    await p.click('#llPivot .pv-quickbig .pv-quick >> nth=0'); await idle(p);
    const o1 = await opts(p), t1 = await table(p);
    const days = t1.rows.filter((r) => r.kind === "data").map((r) => r.head[r.head.length - 1]);
    const wantMonths = [...new Set(days.map((d) => d.slice(0, 7).replace("/", "-")))].sort();
    check(`${tag} グラフの見出しの右に 数値ラベル・月で区切る・◀ すべての月 ▶（月＝表の日の月）・すぐに見るの札に当てた組み方の印`,
      o1.labels && o1.split && o1.month === "" && o1.months.join() === wantMonths.join() && o1.prev === false && o1.next === true && o1.preset.startsWith("作業日ごとのロット数"), { o1, wantMonths });
    const grand1 = t1.rows.find((r) => r.kind === "grand").v;
    await p.check('#llPivot [data-pv-opt="labels"]'); await sleep(500);
    await p.check('#llPivot [data-pv-opt="split"]'); await idle(p);
    const L = await lines(p);
    check(`${tag} 文・グラフの形・グラフの見出しが各 1 段（数値ラベル・月で区切るを入れても）`, L.sent === 1 && L.bar === 1 && L.chead === 1, L);
    await shot(p, `split-${view.width}`);
    if (!full) { check(`${tag} 頁の誤りが無い`, !errors.length, errors); await p.context().close(); continue; }

    // ③ 月で区切る（①で入れた）
    const t3 = await table(p);
    const subs = t3.rows.filter((r) => r.kind === "sub"), grand3 = t3.rows.find((r) => r.kind === "grand").v;
    const subSum = subs.reduce((a, r) => a.map((x, i) => x + r.v[i]), [0, 0]);
    const chart3 = await p.evaluate(() => ({ seps: document.querySelectorAll("#llPvChart .pv-msep").length, names: [...document.querySelectorAll("#llPvChart .pv-mname")].map((x) => x.textContent) }));
    check("月で区切る: 表に月の小計（月の数・足すと総計）と角に（年月）", subs.length === wantMonths.length && grand3[0] === grand1[0] && Math.abs(subSum[0] - grand3[0]) < 1e-6 && Math.abs(subSum[1] - grand3[1]) < 0.05 && t3.corner.includes("年月"),
      { subs: subs.length, months: wantMonths.length, grand1, grand3, subSum, corner: t3.corner });
    check("月で区切る: グラフに月の境目の線（月の数−1）と月の名前", chart3.seps === wantMonths.length - 1 && chart3.names.length === wantMonths.length && chart3.names[0] === `${+wantMonths[0].slice(0, 4)}年${+wantMonths[0].slice(5)}月`, chart3);
    // ④ ◀ で新しい月から遡る
    await p.click('#llPivot [data-pv-mstep="-1"]'); await idle(p);
    const o4 = await opts(p), t4 = await table(p);
    const last = wantMonths[wantMonths.length - 1], lastSub = subs[subs.length - 1].v;
    const d4 = t4.rows.filter((r) => r.kind === "data");
    const g4 = t4.rows.find((r) => r.kind === "grand").v;
    check("◀: 新しい月（最後の月）だけを数える（表の日はその月だけ・総計＝その月の小計・添え書きに◯年◯月だけ）",
      o4.month === last && d4.every((r) => r.head[r.head.length - 1].startsWith(last.replace("-", "/"))) && g4[0] === lastSub[0] && Math.abs(g4[1] - lastSub[1]) < 0.05 && o4.hint.includes(`${+last.slice(0, 4)}年${+last.slice(5)}月だけ`) && o4.next === false,
      { o4, last, g4, lastSub });
    // 棒の数値ラベルだけ（線の系列のラベルは系列の色の字〈style の fill〉。版 3.46.0 から線のラベルは横にも置ける）
    const vl = await p.$$eval("#llPvChart .pv-vl", (xs) => xs.filter((x) => !x.style.fill).map((x) => x.textContent));
    const want = d4.map((r) => r.v[0]).filter((v) => v > 0).map(String);
    check("月を選ぶと数値ラベルは間引かず、棒のある日の数だけ・字は表のロット数と同じ", vl.length === want.length && [...vl].sort().join() === [...want].sort().join() && !o4.note.includes("本おき"), { vl, want, note: o4.note });
    for (let k = 0; k < wantMonths.length + 2; k++) { if ((await opts(p)).prev) break; await p.click('#llPivot [data-pv-mstep="-1"]'); await idle(p); }
    const o4b = await opts(p);
    await p.click('#llPivot [data-pv-mstep="1"]'); await idle(p);
    const o4c = await opts(p);
    await p.selectOption("#llPivot [data-pv-month]", ""); await idle(p);
    const o4d = await opts(p);
    check("◀ を押し切ると最初の月で ◀ が押せない・▶ で次の月・すべての月で ▶ が押せない", o4b.month === wantMonths[0] && o4b.prev && o4c.month === wantMonths[1] && o4d.month === "" && o4d.next && !o4d.prev, { o4b, o4c, o4d });
    // ② 作業日のまとめ方を年月に（月で区切るは日の段のときだけなので外れる）
    await p.selectOption('#llPivot [data-pv-part="rows"][data-i="0"]', "ym"); await idle(p);
    const t2 = await table(p), o2 = await opts(p);
    const g2 = t2.rows.find((r) => r.kind === "grand").v;
    check("作業日を年月でまとめると、行＝月の数・総計は日ごとと同じ・月の物は出ない（数値ラベルは出る）",
      t2.rows.filter((r) => r.kind === "data").length === wantMonths.length && g2[0] === grand1[0] && Math.abs(g2[1] - grand1[1]) < 0.05 && o2.labels && !o2.split && o2.month === null, { g2, grand1, o2 });
    await shot(p, "ym");
    await p.selectOption('#llPivot [data-pv-part="rows"][data-i="0"]', ""); await idle(p);
    // ⑤ 表だけ
    await pickChart(p, "none"); await idle(p);
    const t5 = await p.evaluate(() => ({ bar: !!document.querySelector("#llPivot .pv-tbar"), split: !!document.querySelector('#llPivot .pv-tbar [data-pv-opt="split"]'), nav: !!document.querySelector("#llPivot .pv-tbar [data-pv-month]"), labels: !!document.querySelector('#llPivot [data-pv-opt="labels"]') }));
    check("表だけ: 表の上の帯に 月で区切る・◀ 月 ▶（数値ラベルは出さない）", t5.bar && t5.split && t5.nav && !t5.labels, t5);
    await pickChart(p, "time"); await idle(p);
    // ⑥ 組み方を保存（自分・標準）→ すべて外す → 面から当てる
    await p.click("#llPvPreset"); await p.waitForSelector("#llPvPresetPop .pv-psave"); await sleep(200);
    await shot(p, "preset-empty");
    await p.fill("#llPvPName", "月で区切った重量（試験）"); await p.check("#llPvPStd");
    await p.click("#llPvPresetPop [data-pv-psave]"); await sleep(800);
    const pop6 = await p.evaluate(() => ({ items: [...document.querySelectorAll("#llPvPresetPop .pv-pi")].filter((x) => !x.querySelector("[data-pv-pin^='b:']"))
      .map((x) => ({ name: x.querySelector("b").textContent.replace("★", "").trim(), now: x.classList.contains("is-now"), std: !!x.querySelector(".pv-star.is-std") })) }));
    await shot(p, "preset-saved");
    await p.keyboard.press("Escape"); await sleep(200);
    const o6 = await opts(p);
    check("組み方: 自分に標準で保存 → 面に★で並び、すぐに見るの札に名前と★", pop6.items.length === 1 && pop6.items[0].now && pop6.items[0].std && o6.preset.includes("月で区切った重量（試験）") && o6.std, { pop6, o6 });
    await p.click("#llPivot [data-pv-clear]"); await idle(p);
    await p.click("#llPvPreset"); await p.waitForSelector("#llPvPresetPop [data-pv-papply]"); await sleep(200);
    await p.click("#llPvPresetPop [data-pv-papply]"); await idle(p);
    const o6b = await opts(p), back = await p.evaluate(() => ({ rows: [...document.querySelectorAll("#llPivot .pv-chip.r b")].map((x) => x.textContent), vals: [...document.querySelectorAll("#llPivot .pv-chip.v b")].map((x) => x.textContent),
      split: document.querySelector('#llPivot [data-pv-opt="split"]')?.checked, labels: document.querySelector('#llPivot [data-pv-opt="labels"]')?.checked, open: !!document.querySelector("#llPvPresetPop") }));
    check("すべて外したあと、面から当てると 行・値・月で区切る・数値ラベルが戻る（面は閉じる）", back.rows[0]?.startsWith("作業日") && back.vals.join() === "ロット数,重量" && back.split && back.labels && !back.open && o6b.preset.includes("月で区切った重量（試験）"), { back, o6b });
    // ⑦ 別の設備で開くと、自分の標準を当てる
    const equips = await p.$$eval("#llEquipBar [data-equip]:not([aria-disabled=true])", (xs) => xs.map((x) => x.dataset.equip));
    const cur = await p.$eval("#llEquipBar [aria-selected=true]", (x) => x.dataset.equip);
    const other = equips.find((e) => e !== cur);
    await p.click(`#llEquipBar [data-equip="${other}"]`); await sleep(1200);
    if (!(await p.evaluate(() => window.LotListPivot.on()))) await p.click('#llViewSwitch [data-pv-view="pivot"]');
    await idle(p); await sleep(400);
    const o7 = await opts(p), f7 = await flash(p);
    check(`別の設備（${other}）で集計表を開くと、自分の標準を当てる（知らせる）`, o7.preset.includes("月で区切った重量（試験）") && o7.split && f7.includes("標準の組み方") && f7.includes("自分"), { o7, f7 });
    // ⑧ この表に無いカラムを含む組み方
    const bad = await api(p, "POST", "/api/pivot-presets", { name: "無いカラム入り", source: "work", scope: "me", body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "sum", column: "無いカラム" }], chart: "time" } });
    const none = await api(p, "POST", "/api/pivot-presets", { name: "行が無いカラム", source: "work", scope: "me", body: { rows: [{ column: "無いカラム", part: "" }], measures: [{ agg: "count" }], chart: "column" } });
    await p.click("#llPvPreset"); await p.waitForSelector("#llPvPresetPop [data-pv-papply]"); await sleep(200);
    await p.click(`#llPvPresetPop [data-pv-papply="${bad.json.id}"]`); await idle(p);
    const f8 = await flash(p), v8 = await p.$$eval("#llPivot .pv-chip.v b", (xs) => xs.map((x) => x.textContent));
    await p.click("#llPvPreset"); await p.waitForSelector("#llPvPresetPop [data-pv-papply]"); await sleep(200);
    await p.click(`#llPvPresetPop [data-pv-papply="${none.json.id}"]`); await sleep(600);
    const f8b = await flash(p), v8b = await p.$$eval("#llPivot .pv-chip.v b", (xs) => xs.map((x) => x.textContent));
    check("無いカラムは外して知らせる・行の段が無くなる組み方は当てない", bad.status === 201 && f8.includes("無いカラム") && f8.includes("外しました") && v8.join() === "ロット数" && f8b.includes("当てられません") && v8b.join() === "ロット数", { bad: bad.status, f8, v8, f8b, v8b });
    // ⑨ 共通の標準と自分の標準
    const common = await api(p, "POST", "/api/pivot-presets", { name: "共通の標準（試験）", source: "work", scope: "all", standard: true, body: { rows: [{ column: "@workday", part: "ym" }], cols: [], measures: [{ agg: "lots" }], chart: "column" } });
    const list1 = await api(p, "GET", "/api/pivot-presets?source=work");
    const mineStd = list1.json.items.find((x) => x.name === "月で区切った重量（試験）");
    check("共通の標準があっても、自分の標準が先", common.status === 201 && list1.json.standardId === mineStd.id && list1.json.items[0].scope === "me", { common: common.status, std: list1.json.standardId, mine: mineStd.id });
    await p.click("#llPvPreset"); await p.waitForSelector("#llPvPresetPop .pv-pi"); await sleep(200);
    await shot(p, "preset-list");
    await p.click(`#llPvPresetPop [data-pv-pdel="${mineStd.id}"]`); await sleep(900);
    const names9 = await p.$$eval("#llPvPresetPop .pv-pi b", (xs) => xs.map((x) => x.textContent.replace("★", "").trim()));
    await p.keyboard.press("Escape");
    const list2 = await api(p, "GET", "/api/pivot-presets?source=work");
    const third = equips.find((e) => e !== cur && e !== other);
    await p.click(`#llEquipBar [data-equip="${third}"]`); await sleep(1200);
    if (!(await p.evaluate(() => window.LotListPivot.on()))) await p.click('#llViewSwitch [data-pv-view="pivot"]');
    await idle(p); await sleep(400);
    const o9 = await opts(p), f9 = await flash(p);
    check("面から自分の標準を消す → 共通の標準に替わり、次の設備では共通の標準を当てる", !names9.includes("月で区切った重量（試験）") && list2.json.standardId === common.json.id && o9.preset.includes("共通の標準（試験）") && o9.std && f9.includes("共通"), { names9, std: list2.json.standardId, o9, f9 });
    check(`${tag} 頁の誤りが無い`, !errors.length, errors);
    await p.context().close();
  }
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
