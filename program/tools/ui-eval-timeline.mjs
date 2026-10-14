// 評価関数（開発用）: タイムライン・スライサーの値の並び・狭い幅で字が切れない・作業実績の 0 件の日（版 3.31.0。
//   7 案＋2 回目で選んだ M4: ui-proposals/2026-10-timeline*・Z1: ui-proposals/2026-10-zeroday*）。
//   node program/tools/ui-eval-timeline.mjs [画像を置くフォルダ]
// 利用者の要望: 実績の日・日＋直ごとのまとめで 0 件の日も日付の行を出す（既定は出す）。スライサーの値の並びを変える。
//   スライサーの幅を縮めても字が切れない。時間の列を選び、2 点のスライダーで期間を決めて絞るタイムライン（スライサーと同じ足し方）。
// ① タイムラインの足し口: 「＋ 列を足す…」の「タイムライン（期間で選ぶ）」に日付の列だけが並び、足すと件数の山・2 つの取っ手・期間の字
// ② 始めの取っ手を引く → 期間の字・件数＝一覧の件数＝サーバーに date_range で尋ねた件数。件数の行の札に期間。ほかのスライサーの件数もその期間で
// ③ キー（→ で 1 柱）・柱を押すとその柱だけ（もう一度で全期間）・日付の欄で決める・見出しの「期間 ×」で外す。読み直しても期間が残る
// ④ 値の並び（⋯）: 件数の多い順・少ない順・値の逆順の並びが正しく、値の上に札。札の × で値の順に戻る
// ⑤ 手で並べる: Alt＋↓ で 1 つ下へ・⋮⋮ を引いて先頭へ。読み直しても残る。共有の書式・保存した見方に運ぶ形（setupOf）に並び・期間が入る
// ⑥ 幅 200px: 値の名前が「…」で切れず（はみ出しも無い）、見出しの名前が潰れない（名前の幅 ≥ 字の長さと 5 字分の小さい方）・ボタンが面の外に出ない。
//   既定の幅 280px では、短い名前の見出しはボタンと 1 行に収まる（版 3.30.0 と同じ高さ）
// ⑦ 作業実績の日＋直・日ごと: 0 件の日も行がある（日が 1 日ずつ続く）・0 件の行は計 0・押せない。☑ を外すと作業のあった日だけ。
//   読み直して開くと、覚えたまとめ方で右の表が出る（版 3.30.0 までは、表の名前を知る前に尋ねて、まとめないままだった）・☑ も覚える
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep, walk } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 800)}`}`); if (!ok) fails.push(name); };
const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: path.join(SHOT, `${name}.png`) }); };
const CARD = (c) => `#llSlicer .sx-card[data-col="${c}"]`;
const TL = '#llSlicer .tl-card[data-col="発生日"]';
const idle = (p) => p.waitForFunction(() => !document.querySelector(".ll-screen.is-loading") && !document.querySelector("#llSlicer .sx-wait"), null, { timeout: 15000 }).then(() => sleep(600));
const count = (p) => p.evaluate(() => +((document.querySelector("#llCount")?.textContent || "").replace(/[^\d]/g, "") || 0));
const store = (p) => p.evaluate(() => TPA.local.get("tpa.lotlist.slicer.v1", {}));
const cardOf = async (p, c) => ((await store(p)).tables["仕掛"] || []).find((x) => x.column === c) || {};
const tl = (p) => p.$eval(TL, (el) => ({ range: el.querySelector(".tl-range b").textContent, sum: el.querySelector("[data-tl-sum]").textContent,
  on: [...el.querySelectorAll("[data-tl-bin]")].map((b) => b.classList.contains("on")), unit: el.dataset.unit }));
const sumN = (t) => +(/([\d,]+) 件/.exec(t)?.[1] || "0").replace(/,/g, "");
/** サーバーに直接尋ねた件数（一覧と同じ道。期間だけで絞る） */
const server = (p, from, to) => p.evaluate(async ([f, t]) => {
  const q = new URLSearchParams({ table: "仕掛", page_size: "1", filters: JSON.stringify([{ column: "発生日", op: "date_range", value: `${f}..${t}` }]) });
  return (await (await fetch("/api/lotlist?" + q)).json()).count;
}, [from, to]);
const vals = (p, c) => p.$$eval(`${CARD(c)} .sx-v[data-v]`, (bs) => bs.filter((b) => !b.hidden).map((b) => [b.dataset.v, +b.dataset.n]));
/** 画面の設定をサーバーの控えへ送り切ってから読み直す（送る前に読み直すと、控えの古い設定で戻る。撮影の道具と同じ） */
const reload = async (p) => { await p.evaluate(() => TPA.saveUiState()); await p.reload(); };
const menu = async (p, c, act) => { await p.click(`${CARD(c)} [data-menu]`); await p.waitForSelector(".sx-menu"); await p.click(`.sx-menu [data-act="${act}"]`); await sleep(300); await idle(p); };

const app = await launch();
try {
  const p = await app.newPage("light");
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.click("#llSlicerBtn"); await sleep(400);
  // ① 足し口
  const groups = await p.$$eval("#llSlicerAdd optgroup", (gs) => gs.map((g) => ({ label: g.label, cols: [...g.children].map((o) => o.value), kind: [...g.children].map((o) => o.dataset.kind || "") })));
  const dates = await p.evaluate(async () => (await (await fetch("/api/lotlist?table=" + encodeURIComponent("仕掛") + "&page_size=1")).json()).dateColumns);
  const time = groups.find((g) => g.label.includes("タイムライン"));
  check("① 足し口: タイムライン（期間で選ぶ）に日付の列だけ（発生日を含む）", !!time && time.cols.includes("発生日") && time.cols.every((c) => dates.includes(c)) && time.kind.every((k) => k === "time"), { groups, dates });
  await p.$eval("#llSlicerAdd", (s) => { const o = [...s.querySelectorAll('option[data-kind="time"]')].find((x) => x.value === "発生日"); s.value = o.value; o.selected = true; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await idle(p);
  for (const c of ["設備", "備考"]) { await p.selectOption("#llSlicerAdd", c); await idle(p); }
  const parts = await p.$eval(TL, (el) => ({ bars: el.querySelectorAll("[data-tl-bin]").length, knobs: el.querySelectorAll("[data-tl-h][role=slider]").length, range: el.querySelector(".tl-range b").textContent }));
  check("① 足すと件数の山・2 つの取っ手・期間の字（全期間）", parts.bars > 10 && parts.knobs === 2 && parts.range === "全期間", parts);
  const all = await count(p);
  // ② 始めの取っ手を引く
  const box = await (await p.$(`${TL} [data-tl-track]`)).boundingBox();
  await p.mouse.move(box.x + 1, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 6 }); await p.mouse.up();
  await idle(p);
  let c = await cardOf(p, "発生日"), t = await tl(p);
  const n1 = await count(p), s1 = await server(p, c.from || "", c.to || "");
  check(`② 引くと期間が決まり、件数＝一覧＝サーバー（${c.from}〜・${n1} 件）`, !!c.from && !c.to && t.range === `${c.from.replace(/-/g, "/")} から` && n1 === s1 && sumN(t.sum) === n1 && n1 < all, { c, t, n1, s1, all });
  const chip = await p.$eval("#llSlicerSum", (e) => e.textContent);
  check("② 件数の行の札に期間", chip.includes("発生日") && chip.includes(c.from.replace(/-/g, "/")), chip);
  const eq = (await vals(p, "設備")).reduce((n, [, k]) => n + k, 0);
  check("② ほかのスライサー（設備）の件数もその期間で数える", eq === n1, { eq, n1 });
  await shot(p, "timeline-drag");
  // ③ キー・柱・日付の欄・札の ×
  const before = await tl(p);
  await p.focus(`${TL} [data-tl-h="lo"]`); await p.keyboard.press("ArrowRight"); await sleep(700); await idle(p);
  t = await tl(p);
  check("③ → で始めが 1 柱進む", t.on.indexOf(true) === before.on.indexOf(true) + 1 && (await count(p)) === (await server(p, (await cardOf(p, "発生日")).from, "")), { before: before.on.indexOf(true), after: t.on.indexOf(true) });
  const bin = Math.floor(t.on.length / 2);
  await p.click(`${TL} [data-tl-bin="${bin}"]`); await idle(p);
  c = await cardOf(p, "発生日"); t = await tl(p);
  check("③ 柱を押すとその柱だけ", t.on.filter(Boolean).length === 1 && t.on[bin] && (await count(p)) === (await server(p, c.from, c.to)), { c, on: t.on.filter(Boolean).length });
  await p.click(`${TL} [data-tl-bin="${bin}"]`); await idle(p);
  c = await cardOf(p, "発生日");
  check("③ もう一度押すと全期間（絞らない）", !c.from && !c.to && (await count(p)) === all && (await tl(p)).range === "全期間", c);
  await p.click(`${TL} [data-tl-edit]`); await sleep(300);
  await p.fill(`${TL} [data-tl-from]`, "2025-06-01"); await p.$eval(`${TL} [data-tl-from]`, (e) => e.dispatchEvent(new Event("change", { bubbles: true }))); await idle(p);
  await p.fill(`${TL} [data-tl-to]`, "2025-08-31"); await p.$eval(`${TL} [data-tl-to]`, (e) => e.dispatchEvent(new Event("change", { bubbles: true }))); await idle(p);
  c = await cardOf(p, "発生日"); t = await tl(p);
  const n3 = await count(p);
  check("③ 日付の欄で決める（2025/06/01〜2025/08/31）", c.from === "2025-06-01" && c.to === "2025-08-31" && t.range === "2025/06/01 〜 2025/08/31" && n3 === (await server(p, c.from, c.to)) && sumN(t.sum) === n3, { c, t, n3 });
  await reload(p); await p.waitForSelector(`${TL} .tl-bars`); await idle(p);
  check("③ 読み直しても期間が残る", (await count(p)) === n3 && (await tl(p)).range === "2025/06/01 〜 2025/08/31", { n: await count(p), n3 });
  await shot(p, "timeline-dates");
  await p.click(`${TL} [data-clr]`); await idle(p);
  c = await cardOf(p, "発生日");
  check("③ 見出しの「期間 ×」で期間を外す", !c.from && !c.to && (await count(p)) === all, c);
  // ④ 値の並び
  const base = await vals(p, "設備");
  const sorted = (k) => base.slice().sort((a, b) => k * (a[1] - b[1]));
  await menu(p, "設備", "order:count-desc");
  let v = await vals(p, "設備");
  check("④ 件数の多い順", JSON.stringify(v.map((x) => x[1])) === JSON.stringify(sorted(-1).map((x) => x[1])) && (await p.$eval(`${CARD("設備")} .sx-ord`, (e) => e.textContent)).includes("件数の多い順"), v);
  await menu(p, "設備", "order:count-asc");
  v = await vals(p, "設備");
  check("④ 件数の少ない順", JSON.stringify(v.map((x) => x[1])) === JSON.stringify(sorted(1).map((x) => x[1])), v);
  await menu(p, "設備", "order:value-desc");
  v = await vals(p, "設備");
  check("④ 値の逆順", JSON.stringify(v.map((x) => x[0])) === JSON.stringify(base.map((x) => x[0]).reverse()), v);
  await p.click(`${CARD("設備")} [data-order-clear]`); await idle(p);
  v = await vals(p, "設備");
  check("④ 札の × で値の順に戻る", JSON.stringify(v) === JSON.stringify(base) && !(await p.$(`${CARD("設備")} .sx-ord`)) && !(await cardOf(p, "設備")).order, v);
  // ⑤ 手で並べる
  await menu(p, "設備", "order:manual");
  const first = base[0][0], second = base[1][0];
  await p.focus(`${CARD("設備")} .sx-v[data-v="${first}"]`); await p.keyboard.press("Alt+ArrowDown"); await idle(p);
  v = await vals(p, "設備");
  check("⑤ 手で並べる: Alt＋↓ で 1 つ下へ", v[0][0] === second && v[1][0] === first && (await p.$$(`${CARD("設備")} .sx-vgrip`)).length === base.length, v.map((x) => x[0]));
  const last = v[v.length - 1][0];
  const g = await (await p.$(`${CARD("設備")} .sx-v[data-v="${last}"] .sx-vgrip`)).boundingBox(), top = await (await p.$(`${CARD("設備")} .sx-v[data-v="${second}"]`)).boundingBox();
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down(); await p.mouse.move(top.x + 30, top.y + 3, { steps: 8 }); await p.mouse.up(); await idle(p);
  v = await vals(p, "設備");
  const pressed = await p.$eval(`${CARD("設備")} .sx-v[data-v="${last}"]`, (b) => b.getAttribute("aria-pressed"));
  check("⑤ ⋮⋮ を引いて先頭へ（引いても値は選ばない）", v[0][0] === last && pressed === "false", v.map((x) => x[0]));
  await reload(p); await p.waitForSelector(`${CARD("設備")} .sx-v`); await idle(p);
  check("⑤ 読み直しても手で並べた順が残る", (await vals(p, "設備"))[0][0] === last && (await p.$eval(`${CARD("設備")} .sx-ord`, (e) => e.textContent)).includes("手で並べた順"), await vals(p, "設備"));
  await p.click(`${TL} [data-tl-bin="2"]`); await idle(p);
  const setup = await p.evaluate(() => window.LotListSlicer.setupOf("仕掛", { sel: true }));
  const sTime = setup.find((x) => x.column === "発生日"), sEq = setup.find((x) => x.column === "設備");
  check("⑤ 運ぶ形（setupOf）に期間・並び・手で並べた順", sTime.kind === "time" && !!sTime.from && sEq.order === "manual" && sEq.manual[0] === last, setup);
  const noSel = await p.evaluate(() => window.LotListSlicer.setupOf("仕掛"));
  check("⑤ 選んだ値を運ばない形には期間も入らない", !noSel.find((x) => x.column === "発生日").from, noSel);
  // ⑥ 幅 200px
  await p.selectOption("#llSlicerAdd", "入力日時"); await idle(p);
  const oneLine = await p.$eval(`${CARD("設備")} .sx-ch`, (h) => { const r = [...h.children].map((x) => x.getBoundingClientRect()); return Math.max(...r.map((x) => x.top)) < Math.min(...r.map((x) => x.bottom)); });
  check("⑥ 既定の幅 280px: 短い名前（設備）の見出しはボタンと 1 行", oneLine, oneLine);
  await p.focus("#llSlicerEdge"); for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowLeft");   // 境目を選んで ← で 20px ずつ（280 → 200px）
  await reload(p); await p.waitForSelector(`${CARD("入力日時")} .sx-v`); await idle(p);
  const narrow = await p.evaluate(() => {
    const pane = document.querySelector("#llSlicer").getBoundingClientRect();
    const em = parseFloat(getComputedStyle(document.querySelector("#llSlicer .sx-ch > b")).fontSize);
    const names = [...document.querySelectorAll("#llSlicer .sx-v em")].filter((e) => e.offsetParent);
    return { w: Math.round(pane.width), cut: names.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent).slice(0, 5),
      out: [...document.querySelectorAll("#llSlicer .sx-v, #llSlicer .sx-ch button, #llSlicer .sx-ch > b")].filter((e) => e.offsetParent && e.getBoundingClientRect().right > pane.right + 0.5).length,
      // 名前の幅が、字の長さ（1 行に並べたときの幅）と 5 字分の小さい方より細い＝ボタンに押されて潰れた
      thin: [...document.querySelectorAll("#llSlicer .sx-ch > b")].filter((b) => {
        const m = Object.assign(document.createElement("span"), { textContent: b.textContent }); m.style.cssText = "position:absolute;white-space:nowrap;font:" + getComputedStyle(b).font;
        document.body.append(m); const natural = m.getBoundingClientRect().width; m.remove();
        return b.getBoundingClientRect().width + 0.5 < Math.min(natural, em * 5); }).map((b) => b.textContent),
      wrapped: names.filter((e) => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) * 1.8).length };
  });
  check(`⑥ 幅 ${narrow.w}px: 値の名前は切れずに折り返し、見出しの名前は潰れない・面の外に出ない`, narrow.w === 200 && !narrow.cut.length && !narrow.out && !narrow.thin.length && narrow.wrapped > 0, narrow);
  await shot(p, "slicer-200");
  check("頁の誤りが無い（異常ロット一覧）", !errors.length, errors);

  // ⑦ 作業実績の 0 件の日
  const w = await app.newPage("light");
  const werr = []; w.on("pageerror", (e) => werr.push(e.message));
  await walk(w, async () => {}, ["worklog-work"]);
  await w.waitForSelector("#llWork .wk-pv"); await sleep(600);
  const table = () => w.evaluate(() => ({
    days: [...document.querySelectorAll("#llWork .wk-pv tbody tr")].map((r) => ({ d: r.querySelector("[data-wk-day]")?.dataset.wkDay || r.querySelector("th span")?.title.slice(0, 10).replace(/\//g, "-") || "",
      empty: r.classList.contains("wk-empty"), tot: r.querySelector(".wk-tot")?.textContent, btn: !!r.querySelector("button") })),
    total: document.querySelector("#llWork .wk-sum th small")?.textContent, zero: document.querySelector("#llWork [data-wk-zero]")?.checked }));
  const gapless = (ds) => ds.every((d, i) => !i || !d.d || !ds[i - 1].d || Math.round((Date.parse(ds[i - 1].d) - Date.parse(d.d)) / 864e5) === 1);
  for (const mode of ["dayshift", "day"]) {
    await w.click(`#llWorkSwitch [data-wk-mode="${mode}"]`); await w.waitForSelector("#llWork .wk-pv"); await sleep(900);
    let tb = await table();
    const empty = tb.days.filter((d) => d.empty), dated = tb.days.filter((d) => d.d);
    check(`⑦ ${mode}: 既定で 0 件の日も行がある（日が 1 日ずつ続く・0 件 ${empty.length} 日）`, tb.zero === true && empty.length > 0 && gapless(dated) && tb.total === `${tb.days.filter((d) => d.d).length}日`, { zero: tb.zero, empty: empty.length, total: tb.total, rows: tb.days.length });
    check(`⑦ ${mode}: 0 件の行は計 0・押せない`, empty.every((d) => d.tot === "0" && !d.btn), empty.slice(0, 3));
    if (mode === "dayshift") await shot(w, "worklog-zero");
    await w.click("#llWork [data-wk-zero]"); await sleep(900);
    tb = await table();
    check(`⑦ ${mode}: ☑ を外すと作業のあった日だけ`, tb.zero === false && !tb.days.some((d) => d.empty) && tb.days.length === dated.length - empty.length, { rows: tb.days.length, dated: dated.length, empty: empty.length });
    await reload(w); await w.waitForSelector("#llBody tr[data-i]"); await w.click("#tabWork"); await w.waitForSelector("#llWork .wk-pv"); await sleep(900);   // 読み直すと異常ロット一覧から
    const back = await w.evaluate(() => ({ pane: !document.querySelector("#llWork").hidden, mode: document.querySelector("#llWorkSwitch [aria-checked=true]")?.dataset.wkMode }));
    check(`⑦ ${mode}: 読み直して開くと、覚えたまとめ方で右の表が出て（版 3.30.0 までは出なかった）、外したことも覚えている`, back.pane && back.mode === mode && (await table()).zero === false, { back, t: await table() });
    await w.click("#llWork [data-wk-zero]"); await sleep(900);
  }
  check("頁の誤りが無い（作業実績）", !werr.length, werr);
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\n全部 OK");
process.exit(fails.length ? 1 : 0);
