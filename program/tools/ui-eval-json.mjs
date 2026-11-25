// 評価関数（開発用）: JSON の列を分ける窓と、分けた表をダッシュボードで合計する道（版 3.120.0。利用者の依頼 2026-11-17「６）JSONデータ列に対応してほしい」）。
//   node program/tools/ui-eval-json.mjs [--views 1728x1152,1536x864,1280x720]
// 場面は TPA_UI_JSON=1（この道具が自分で付ける）の仕掛 1,200 行の JSON の列 5 つ（tests/ui_window_scene.py の json_cells）。
// 本物の画面で:
//  1. 仕掛の一覧の道具の行の「{ } JSON」から窓が開き、① 列に JSON の列 5 つ・勧める形が「① 名前→値」で、帯の割合と字が窓の見分けの答え
//     （POST /api/sources/json/probe）と同じ・② の 5 つの札の行の数と ③ の「✓ n 行を m 行に分けます」・下の段の「(1,200 → k 行)」が試す答え
//     （POST /api/sources/json/preview）と同じ
//  2. 試す答えの数（分けた行・空・壊れ・違う形・できる行）が、一覧の全部の行（GET /api/src/wip）をこの道具が JSON.parse で数えた独立の答えと同じ
//  3. 見本の先頭の元の行の分けた行が、その行の JSON の鍵の順と値と同じ
//  4. 合わない行の「見る」で例が出る（壊れた JSON は「閉じていない」・違う形は「② 値の並びです」）・設備マスタに無い鍵（CR1）を押すと ③ にその行の例
//  5. 鍵の列の名前を変えると ③ の見出しがすぐ替わる（問い合わせを待たない）
//  6. 「表を作る」（新しいダッシュボードに作る。組み込みの標準は書き換えない）→ データ元に「仕掛 › 設備別通過回数」が並び、分けた表の行の数がサーバーの一覧の件数と同じ・知らせの「見る」で
//     ダッシュボードへ行き、足したパネルの設備ごとの合計が独立に数えた合計と同じ・添え書き（何行を何行に・数えていない行）
//  7. 開き直しても（頁を読み直して）分けた表とパネルが残り、同じ合計
//  8. 組む所のカラムの欄に入口「{ } JSON の列 5」と札「› 設備」「› 通過回数」・入口から同じ窓が仕掛を選んで開く
//  9. 3 つの大きさで、組み込みの標準の数字のパネルの数が残り・作った表のダッシュボードの棒が 1 色・窓が画面に収まり（「表を作る」まで送らずに届く）・分け方の説明の 1 行と下の段の できる表 が畳まれず・札の名前が切れない
// 頁の誤りが無いこと。全部合えば終了コード 0。最後に作った表と入れ替えたダッシュボードを片付ける。
process.env.TPA_UI_JSON = "1";
const { launch, sleep, parseView, waitDash } = await import("./ui-harness.mjs");

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const VIEWS = arg("--views", "1728x1152,1536x864,1280x720").split(",");
const COL = "設備別通過回数";
const fmt = (n) => Number(n).toLocaleString("ja-JP");
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

/** 独立の答え: JSON.parse で数える（空・壊れ・名前→値・違う形）と、鍵ごとの合計 */
function truth(cells) {
  const t = { rows: cells.length, fit: 0, empty: 0, broken: 0, other: 0, out: 0, sums: {}, firstKeys: null };
  for (const c of cells) {
    const s = c === null || c === undefined ? "" : String(c).replace(/^﻿/, "").trim();
    if (!s) { t.empty++; t.out++; continue; }
    let v;
    try { v = JSON.parse(s); } catch (_) { if (/^[[{]/.test(s)) t.broken++; else t.other++; t.out++; continue; }
    if (v === null || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) { t.empty++; t.out++; continue; }
    if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x === null || typeof x !== "object")) {
      t.fit++; t.out += Object.keys(v).length;
      if (!t.firstKeys) t.firstKeys = Object.entries(v);
      for (const [k, x] of Object.entries(v)) if (typeof x === "number") t.sums[k] = (t.sums[k] || 0) + x;
    } else { t.other++; t.out++; }
  }
  return t;
}

const app = await launch();
const errors = [];
try {
  // ---------------- 1〜7: 利用者の画面（1728×1152）----------------
  const p = await app.newPage("light", parseView(VIEWS[0]));
  p.on("pageerror", (e) => errors.push(e.message));
  await sleep(1500);
  await p.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:wip" })));
  await p.waitForSelector("#llBody .ll-lot", { timeout: 30000 }); await sleep(1500);
  check("仕掛の一覧の道具の行に「{ } JSON」が出る", await p.$("#llJsonBtn:not([hidden])").then(Boolean), null);
  await p.click("#llJsonBtn");
  await p.waitForSelector("#jxWin .jx-prev", { timeout: 30000 }); await sleep(400);
  const spec = { 列: COL, 形: "dict", 鍵: "設備", 値: "通過回数", 道筋: "" };
  const ans = await p.evaluate(async (sp) => {
    const post = async (u, b) => (await fetch(u, TPA.json("POST", b))).json();
    return { probe: await post("/api/sources/json/probe", { base: "wip" }), pre: await post("/api/sources/json/preview", { base: "wip", 展開: sp }) };
  }, spec);
  const win = await p.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(`#jxWin ${s}`)];
    return { cols: q(".jx-col > b").map((x) => x.textContent), onCol: (q(".jx-col.is-on b")[0] || {}).textContent, words: q(".jx-col .jx-words").map((x) => x.textContent),
      pats: q(".jx-pat").map((x) => ({ k: x.dataset.jxShape, on: x.classList.contains("is-on"), em: x.querySelector("em").textContent, rec: !!x.querySelector(".jx-rec") })),
      ok: (q(".jx-ok")[0] || {}).textContent, out: (q(".jx-out")[0] || {}).textContent, heads: q(".jx-prev th").map((x) => x.textContent),
      first: q(".jx-prev tbody tr").slice(0, 8).map((tr) => [...tr.children].map((td) => td.textContent)),
      keep: q(".jx-iss .jx-mute").map((x) => x.textContent).join(" "), h1: (q(".jx-s1 h5")[0] || {}).textContent || "", bases: q(".jx-bases button").map((x) => x.textContent) };
  });
  const pc = ans.probe.columns || [];
  check("① 列に JSON の列 5 つが窓の見分けと同じ順で並ぶ", JSON.stringify(win.cols) === JSON.stringify(pc.map((c) => c.column)) && pc.length === 5, { win: win.cols, probe: pc.map((c) => c.column) });
  const c0 = pc[0], pct = (a, b) => { const x = (a * 100) / b; return x >= 10 || x === 0 ? `${Math.round(x)}%` : `${x.toFixed(1)}%`; };
  check(`① の帯の字が見分けの答え（${c0.best} ${pct(c0.fit[c0.best], c0.total)}・空・壊れ・違う形）と同じ`, win.words[0].includes(`名前→値 ${pct(c0.fit.dict, c0.total)}`) && win.words[0].includes(`壊れ ${c0.broken}`) && win.words[0].includes(`違う形 ${c0.other}`), { words: win.words[0], c0 });
  check("勧める形が ① 名前→値（選んであり、おすすめの札）", c0.best === "dict" && win.pats.find((x) => x.k === "dict").on && win.pats.find((x) => x.k === "dict").rec, win.pats);
  const pre = ans.pre, made = pre.stats.out - (pre.stats.rows - pre.stats.fit);
  check("② の ① の札の行の数（分けた行）が試す答えの ③ と同じ言葉と数", win.pats.find((x) => x.k === "dict").em.startsWith(`${fmt(made)} 行に`), { em: win.pats[0].em, made });
  check("合わない形（③ 表の並び）は「合いません」", win.pats.find((x) => x.k === "rows").em.startsWith("合いません"), win.pats);
  check("③ の「✓ n 行を m 行に分けます」が試す答えと同じ", win.ok === `✓ ${fmt(pre.stats.fit)} 行を ${fmt(made)} 行に分けます`, { ok: win.ok, stats: pre.stats });
  const keep = pre.stats.rows - pre.stats.fit;
  check("下の段の できる表 が「仕掛 › 設備別通過回数：m 行 ＋ 分けずに残す k 行 ＝ n 行（元 1,200 行）」", win.out.includes(`仕掛 › 設備別通過回数：${fmt(made)} 行 ＋ 分けずに残す ${fmt(keep)} 行 ＝ ${fmt(pre.stats.out)} 行（元 ${fmt(pre.rows)} 行）`), win.out);
  check("③ に 分けずに残す k 行と合わせた n 行（下の段と同じ数）", win.keep.includes(`分けずに残す ${fmt(keep)} 行`) && win.keep.includes(`合わせて ${fmt(pre.stats.out)} 行`), win.keep);
  check("① の見出しに「帯は先頭 500 行の割合」", /帯は先頭 500 行の割合/.test(win.h1), win.h1);
  check("窓の頭の札は JSON の列のある元だけ（品質・仕掛。製造条件マスタ・設備マスタは出さない）", JSON.stringify(win.bases) === JSON.stringify(["品質", "仕掛"]), win.bases);
  // 2. 独立の答え（一覧の全部の行を JSON.parse で数える）
  const cells = await p.evaluate(async (col) => {
    const out = []; let page = 1;
    for (;;) {
      const d = await (await fetch(`/api/src/wip?page=${page}`, { cache: "no-store" })).json();
      const ci = (d.columns || []).indexOf(col);
      for (const r of d.rows || []) out.push(Array.isArray(r) ? r[ci] : (r.values ? r.values[ci] : r[col]));
      if (out.length >= (d.count || 0) || !(d.rows || []).length) break;
      page++;
    }
    return out;
  }, COL);
  const T = truth(cells);
  const st = pre.stats;
  check(`試す答えの数が独立の答えと同じ（${T.rows} 行: 分ける ${T.fit}・空 ${T.empty}・壊れ ${T.broken}・違う形 ${T.other}・できる ${T.out} 行）`,
    st.rows === T.rows && st.fit === T.fit && st.empty === T.empty && st.broken === T.broken && st.other === T.other && st.out === T.out, { st, T: { ...T, sums: undefined, firstKeys: undefined } });
  // 3. 見本の先頭の元の行
  const fk = T.firstKeys || [];
  const shown = win.first.filter((r) => r.length >= 4).slice(0, fk.length).map((r) => [r[2], Number(r[3])]);
  check("見本の先頭の元の行の分けた行が、その行の JSON の鍵の順と値と同じ", JSON.stringify(shown) === JSON.stringify(fk.slice(0, shown.length)) && shown.length === Math.min(fk.length, 8), { shown, fk });
  // 4. 合わない行・設備マスタに無い鍵
  await p.click("#jxWin [data-jx-issues]"); await sleep(250);
  const iss = await p.$$eval("#jxWin .jx-issues li", (xs) => xs.map((x) => x.textContent));
  check("合わない行の「見る」で例が出る（閉じていない・② 値の並びです）", iss.some((x) => x.includes("閉じていない")) && iss.some((x) => x.includes("② 値の並びです")), iss);
  const miss = (pre.keyMaster || {}).missing || [];
  check("設備マスタに無い鍵に CR1 がある", miss.some((m) => m.key === "CR1"), pre.keyMaster);
  const kmw = await p.evaluate(() => ({ t: (document.querySelector("#jxWin .jx-kmw") || {}).textContent || "", go: !!document.querySelector("#jxWin [data-jx-master]") }));
  check("「CR1 が無い」に理由（設備マスタに無い設備名）と「設備マスタに足す…」への道", kmw.t.includes("設備マスタに無い") && kmw.go, kmw);
  await p.click('#jxWin [data-jx-miss="CR1"]'); await sleep(250);
  const cap = await p.evaluate(() => ({ cap: (document.querySelector("#jxWin .jx-cap") || {}).textContent || "", rows: [...document.querySelectorAll("#jxWin .jx-prev tbody tr:not(.jx-cap)")].map((tr) => tr.textContent) }));
  check("「CR1 が無い」を押すと ③ にその鍵を含む行の例", cap.cap.includes("CR1") && cap.rows.length > 0 && cap.rows.every((r) => r.includes("CR1")), cap);
  await p.click('#jxWin [data-jx-miss="CR1"]'); await sleep(200);
  // 5. 名前をその場で
  const asked = []; p.on("request", (r) => { if (r.url().includes("/json/preview")) asked.push(r.url()); });
  await p.fill('#jxWin [data-jx-name="key"]', "設備名"); await sleep(150);
  const h0 = await p.$eval('#jxWin [data-jx-head="0"]', (x) => x.textContent);
  check("鍵の列の名前を変えると ③ の見出しがすぐ替わる（問い合わせを待たない）", h0.startsWith("設備名") && asked.length === 0, { h0, asked });
  await p.fill('#jxWin [data-jx-name="key"]', "設備"); await sleep(150);
  // 6. 表を作る → ダッシュボード
  const panelOn = await p.$eval("#jxWin [data-jx-panel]", (x) => x.checked);
  check("「新しいダッシュボードに…を作る」が選んである", panelOn, null);
  await p.click("#jxWin [data-jx-make]");
  await p.waitForSelector(".tpa-toast [data-jx-jump]", { timeout: 60000 });
  const toast = await p.$eval(".tpa-toast", (x) => x.textContent);
  check("作った後に、足したパネルを知らせる（「設備ごとの通過回数の合計」を足しました・見る）", toast.includes("新しいダッシュボード「仕掛 › 設備別通過回数」") && toast.includes("設備ごとの通過回数の合計") && toast.includes("足しました"), toast);
  const made1 = await p.evaluate(async () => {
    const items = (await (await fetch("/api/sources", { cache: "no-store" })).json()).items || [];
    const v = items.find((x) => x.expand); if (!v) return null;
    const d = await (await fetch(`/api/src/${v.key}?page=1`, { cache: "no-store" })).json();
    return { key: v.key, name: v.name, base: v.base, listed: v.listed, rows: v.rows, count: d.count, cols: d.columns };
  });
  check("データ元に「仕掛 › 設備別通過回数」（元 仕掛・見出しのタブに出さない）が並ぶ", made1 && made1.name === "仕掛 › 設備別通過回数" && made1.base === "wip" && made1.listed === false, made1);
  check(`分けた表の一覧の件数・データ元の行の数が、できる行（${T.out}）と同じ・足した列（設備・通過回数）がある`, made1 && made1.count === T.out && made1.rows === T.out && made1.cols.includes("設備") && made1.cols.includes("通過回数"), made1);
  const dl = await p.evaluate(async () => (await (await fetch("/api/dashboards", { cache: "no-store" })).json()).items || []);
  const mine = dl.find((x) => x.name === "仕掛 › 設備別通過回数");
  check("新しいダッシュボード「仕掛 › 設備別通過回数」（自分だけ）に作り、組み込みの標準は書き換えない（入れ替えた物が無い）", !!mine && mine.scope === "me" && !dl.some((x) => x.replaces), dl.map((x) => [x.name, x.scope, x.replaces || ""]));
  await p.click(".tpa-toast [data-jx-jump]");
  await waitDash(p); await sleep(1500);
  const sumsOf = (pg) => pg.evaluate(() => {
    const s = Dashboard._state(); const x = [...s.layout.panels].reverse().find((y) => y.title === "設備ごとの通過回数の合計"); if (!x) return null;
    const a = s.answers[x.id] || {}; const lab = (a.labels || [])[0] || {};
    const sums = {}; for (const c of a.cells || []) if (c.r.length === 1 && c.r[0] !== "") sums[String(lab[c.r[0]] ?? c.r[0])] = c.v[0];
    const el = document.querySelector(`#dashGrid .db-p[data-id="${x.id}"]`);
    return { id: x.id, source: x.source, sums, sub: el ? el.querySelector(".db-psub").textContent : "", seen: !!el && el.getBoundingClientRect().height > 0,
      note: el ? (el.querySelector(".db-pb") || el).textContent : "", dash: s.id };
  });
  const D = await sumsOf(p);
  const keys = Object.keys(T.sums).sort(), dk = D ? Object.keys(D.sums).sort() : [];
  check("ダッシュボードに足したパネル（設備ごとの通過回数の合計）があり、データは分けた表", D && D.seen && D.source === `src:${made1.key}`, D);
  check(`パネルの設備ごとの合計が、独立に数えた合計と同じ（${keys.length} 設備）`, D && JSON.stringify(dk) === JSON.stringify(keys) && keys.every((k) => near(D.sums[k], T.sums[k])), { D: D && D.sums, T: T.sums });
  check("パネルの添え書き（仕掛 › 設備別通過回数 を ① 名前→値 で分けた（n 行を m 行に）・▲ 分けずに残した k 行は数えていません）",
    D && D.sub.includes(`仕掛 › 設備別通過回数 を ① 名前→値 で分けた（${fmt(T.fit)} 行を ${fmt(made)} 行に）`) && D.sub.includes(`▲ 分けずに残した ${fmt(T.rows - T.fit)} 行は数えていません`), D && D.sub);
  check("空の鍵（分けずに残した行）を棒に入れない（「n / m を描いています」の m に入らない）", D && !/\/ 10 を描いています/.test(D.note) && !("" in D.sums), D && D.note);
  // 7. 開き直し
  await p.reload(); await sleep(1500); await p.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "dash" }))); await waitDash(p); await sleep(2000);
  const D2 = await sumsOf(p);
  check("開き直しても、足したパネルと同じ合計が残る", D2 && keys.every((k) => near(D2.sums[k], T.sums[k])), D2);
  // 8. 組む所の入口と札
  await p.click("[data-db-editmode]"); await sleep(500);
  const eb = await p.$(`#dashGrid .db-p[data-id="${D2.id}"] [data-db-edit]`);
  if (eb) await eb.click(); else { await p.focus(`#dashGrid .db-p[data-id="${D2.id}"]`); await p.keyboard.press("Enter"); }
  await p.waitForSelector("#deFields .de-json", { timeout: 30000 }).catch(() => {}); await sleep(600);
  const de = await p.evaluate(() => ({ entry: (document.querySelector("#deFields .de-json") || {}).textContent || "",
    marks: [...document.querySelectorAll("#deFields .pv-f")].filter((x) => x.querySelector(".de-jxmark")).map((x) => x.querySelector("b").textContent) }));
  check("組む所のカラムの欄に入口「{ } JSON の列 5」", de.entry.includes("JSON の列 5"), de);
  check("組む所の札に「› 設備」「› 通過回数」", de.marks.includes("›設備") && de.marks.includes("›通過回数"), de);
  await p.click("#deFields [data-de-json]"); await p.waitForSelector("#jxWin .jx-prev", { timeout: 30000 }); await sleep(300);
  const fromDash = await p.evaluate(() => { const sm = document.querySelector("#jxWin .jx-out small"); return { base: (document.querySelector("#jxWin .jx-bases .is-on") || {}).textContent, make: (document.querySelector("#jxWin [data-jx-make]") || {}).textContent, small: sm ? parseFloat(getComputedStyle(sm).fontSize) : 99 }; });
  check("「（作ってある表の決まりを直します）」の字が 12px 以上", fromDash.small >= 12, fromDash);
  check("組む所の入口から同じ窓が、組んでいるデータ（仕掛）を選んで開く", fromDash.base === "仕掛" && /パネルに使う/.test(fromDash.make), fromDash);
  await p.keyboard.press("Escape"); await sleep(200);
  await p.close();

  // ---------------- 9: 3 つの大きさ ----------------
  for (const v of VIEWS) {
    const q = await app.newPage("light", parseView(v));
    q.on("pageerror", (e) => errors.push(`${v}: ${e.message}`));
    await sleep(1200);
    await q.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:wip" })));
    await q.waitForSelector("#llBody .ll-lot", { timeout: 30000 }); await sleep(1200);
    const btn = await q.$eval("#llJsonBtn", (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, wrap: b.scrollHeight > b.clientHeight + 2 }; });
    check(`${v}: 道具の行の「{ } JSON」が見えて、字が折れない`, btn.w > 0 && !btn.wrap, btn);
    // 作った表のダッシュボードの棒の色が窓の大きさによらず同じ（1 色）・組み込みの標準の数字のパネルの数が残る
    const look = async (id) => {
      await q.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "dash" }))); await waitDash(q); await sleep(800);
      await q.evaluate((x) => Dashboard._open(x || "b:standard"), id); await sleep(800); await waitDash(q); await sleep(1500);
      return q.evaluate(() => {
        const s = Dashboard._state(); const kpis = [...document.querySelectorAll("#dashGrid .db-p")].filter((el) => (s.layout.panels.find((x) => x.id === el.dataset.id) || {}).visual === "kpi");
        const fills = new Set([...document.querySelectorAll("#dashGrid .db-p .db-pb svg rect")].map((r) => r.getAttribute("fill")).filter((f) => f && f !== "none" && !/^(#fff|white|transparent)/i.test(f)));
        return { id: s.id, kpis: kpis.map((el) => { const n = el.querySelector(".dp-num"); const r = n && n.getBoundingClientRect(); return { t: n ? n.textContent.trim().slice(0, 30) : "", h: r ? r.height : 0 }; }), fills: [...fills] };
      });
    };
    const std = await look("");
    check(`${v}: 組み込みの標準の数字のパネルの数が残る（${std.kpis.length} 枚）`, std.kpis.length >= 3 && std.kpis.every((k) => /\d/.test(k.t) && k.h > 10), std);
    const jx = await look(mine && mine.id);
    check(`${v}: 作った表のダッシュボードの棒の色が 1 色（窓の大きさによらない）`, String(jx.id) === String(mine && mine.id) && jx.fills.length === 1, jx);
    await q.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:wip" })));
    await q.waitForSelector("#llBody .ll-lot", { timeout: 30000 }); await sleep(1200);
    await q.click("#llJsonBtn"); await q.waitForSelector("#jxWin .jx-prev", { timeout: 30000 }); await sleep(400);
    const fit = await q.evaluate(() => {
      const W = innerWidth, H = innerHeight, win = document.querySelector("#jxWin").getBoundingClientRect();
      const mk = document.querySelector("#jxWin [data-jx-make]").getBoundingClientRect();
      const cut = [...document.querySelectorAll("#jxWin .jx-pat b, #jxWin .jx-col > b, #jxWin .jx-bases button, #jxWin .jx-f button, #jxWin .jx-h b")].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent);
      const how = [...document.querySelectorAll("#jxWin .jx-pat .jx-pb small")].map((x) => getComputedStyle(x).display !== "none" && x.getBoundingClientRect().height > 0);
      const out = document.querySelector("#jxWin .jx-out"), outSeen = !!out && out.getBoundingClientRect().width > 40;
      const body = document.querySelector("#jxWin .jx-body");
      const fl = document.querySelector("#jxWin .jx-fl").getBoundingClientRect(), btns = [...document.querySelectorAll("#jxWin .jx-f button")].map((b) => b.getBoundingClientRect());
      const footOk = fl.right <= btns[0].left + 1 && btns.every((b) => Math.abs(b.top - btns[0].top) < 2);
      return { footOk, inView: win.left >= 0 && win.top >= 0 && win.right <= W && win.bottom <= H, make: mk.bottom <= H && mk.right <= W && mk.width > 0, cut, how, outSeen,
        scroll: body.scrollHeight > body.clientHeight + 2, footOne: (() => { const f = document.querySelector("#jxWin .jx-f"); return f.scrollHeight <= f.clientHeight + 2; })() };
    });
    check(`${v}: 窓が画面に収まり、「表を作る」まで送らずに届く`, fit.inView && fit.make && !fit.scroll, fit);
    check(`${v}: 分け方の 5 つの説明の 1 行と、下の段の できる表 が畳まれない`, fit.how.length === 5 && fit.how.every(Boolean) && fit.outSeen, fit);
    check(`${v}: 札・ボタンの名前が切れない・下の段のボタンが 1 段で、できる表の字に重ならない`, !fit.cut.length && fit.footOk, fit);
    await q.close();
  }
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  // 片付け（作った分けた表と、組み込みの標準を入れ替えた物）
  try {
    const c = await app.newPage("light");
    await c.evaluate(async () => {
      const items = ((await (await fetch("/api/sources", { cache: "no-store" })).json()).items || []).filter((x) => x.expand);
      for (const x of items) await fetch(`/api/sources/${encodeURIComponent(x.key)}?rev=${x.rev || ""}`, { method: "DELETE" });
      const d = await (await fetch("/api/dashboards")).json();
      for (const x of (d.items || []).filter((y) => y.replaces || (!y.builtin && / › /.test(y.name || "")))) await fetch(`/api/dashboards/${x.id}`, { method: "DELETE" });
    });
  } catch (_) { /* 片付けられなくても作業フォルダごと消える */ }
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "全部 OK");
process.exit(fails.length ? 1 : 0);
