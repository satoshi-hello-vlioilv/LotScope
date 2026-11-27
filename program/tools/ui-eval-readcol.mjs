// 評価関数（開発用）: ルールで作る列（版 3.123.0。利用者の改良依頼 2026-11-17 の 3「表示列の読み替えルールのさらなる汎用化」。採点 2026-11-readcol の G）。
//   node program/tools/ui-eval-readcol.mjs
// 品質の表「仕掛」に、式の無い作った列「管理区分」と、ほかの列（合金・板厚）を条件にしたルール「管理区分」（ui-harness の READCOL）を置き、次を確かめる:
//  ① 一覧の 管理区分 のセルが、全部の行をルールで判定した答え（独立の答え: 一覧の全部の行に LotListRules.match）と同じ
//  ② 見出しを押した並べ替え: サーバーへ送った問い合わせに 管理区分 の式（ルールと同じ意味の式）が付き、答えの全部の行が 管理区分 の昇順で、
//     値ごとの件数が独立の答えと同じ（前は式を送らず、押しても並ばなかった）
//  ③ 集計表: カラムの欄の頭（ƒx 計算列）に 管理区分 が並び、管理区分 を行・件数を値にしたサーバーの答え（式つき）が独立の答えと同じ。
//     画面の表の数もサーバーと同じ
//  ④ 表示列の窓: 管理区分 の札「ルール「管理区分」で作る列」が 1 段・値のある行が全部・値の種類「ルールで決まる 3 つの値」、作り方の段に
//     「ƒx 式で作る｜≡ ルールで作る」（ルール側）とルールの 3 行（条件 → 値の札 → 件数）。件数は窓が読んだ行をルールで数えた独立の答えと同じ。
//     ③ 読み替えの段は無い（ルールを選ぶ所は 1 か所）。元の列（合金）には ③ がある
//  ⑤ ルールの窓（ルールを編集）: 目「ルール」・題「ルール「管理区分」」（表示ルール・読み替えルールの言葉が無い）、試した結果の左がロット番号
//  ⑥ 作り方の窓: 「＋ 列を作る」で足した列は「≡ 保存したルール」のタブで開き、カードを押すと ✓ と 3 行・試した結果がルールの答え（左はロット番号）。
//     版 3.127.0: 3 行の件数は（④ も）一覧の全部の行で数え、母数「一覧の全 n 行」を言う。「保存したルール」のタブの窓は中身の高さ（組み立てるは前の高さ）
//     「当てる」でその列がルールで作る列になり、一覧のセルがルールの答え。「⇄ 変換表（マスタ）で作る」のカードがある
//  ⑦ 式で作る に切り替えるとルールで作る列でなくなり（式は残る）、③ が戻る。ルールで作るに戻すと元どおり
//  ⑧ 1728・1536×864・1280×720 で、作り方の段を開いても ② 値の整え方と結果の段が右の欄の中に見え、札の説明が 1 段
// 頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, READCOL } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 800)}`}`); if (!ok) fails.push(name); };
const T = "lotlist:仕掛", COL = "管理区分";
const setScene = (p) => p.evaluate(async ({ l, r }) => { TPA.local.set("tpa.lotlist.layout.v1", l); TPA.local.set("tpa.lotlist.rules.v1", r); TPA.local.set("tpa.lotlist.pivot.v1", {}); TPA.local.set("tpa.calcfold.v1", {}); TPA.local.set("tpa.lotlist.sorts.v1", {}); await TPA.saveUiState(); }, READCOL);
/** 独立の答え: 一覧の全部の行（1 ページで全件）をルールで判定（式を通さない。セルの判定の道） */
const independent = (p) => p.evaluate(async (col) => {
  const d = await (await fetch("/api/lotlist?table=" + encodeURIComponent("仕掛") + "&page=1&page_size=5000")).json();
  const by = {}, each = {};
  for (const r of d.rows || []) { const hit = LotListRules.match(col, r, col), v = hit ? String(LotListRules.textOf(hit, r) ?? "") : ""; by[v] = (by[v] || 0) + 1; each[r["ロット番号"] + "\u0000" + (r["ID"] ?? "")] = v; }
  return { by, n: (d.rows || []).length, first: (d.rows || []).slice(0, 60).map((r) => { const hit = LotListRules.match(col, r, col); return hit ? String(LotListRules.textOf(hit, r) ?? "") : ""; }) };
}, COL);
const colCells = (p, col, n = 60) => p.evaluate(([c, k]) => { const i = [...document.querySelectorAll("#llHead tr:first-child th")].findIndex((t) => t.dataset.col === c); return [...document.querySelectorAll("#llBody tr[data-i]")].slice(0, k).map((tr) => (tr.children[i] || {}).textContent.trim()); }, [col, n]);
const openCols = async (p, col) => {
  await p.click("#llColBtn"); await p.waitForSelector("#lcList li[data-col]"); await sleep(400);
  await p.click(`#lcList li[data-col="${col}"]`); await sleep(400);
};

const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView("1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  await setScene(p); await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(900);
  const ind = await independent(p);
  check(`独立の答え: ${ind.n} 行を 3 つの値に分けた（${JSON.stringify(ind.by)}）`, ind.n >= 1000 && Object.keys(ind.by).sort().join() === "3000系,5052厚板,その他", ind);

  /* ① 一覧のセル */
  const cells = await colCells(p, COL);
  check("① 一覧の 管理区分 のセル（先頭 60 行）が、ルールで判定した独立の答えと同じ", cells.length >= 40 && cells.every((t, i) => t === ind.first[i]), { cells: cells.slice(0, 10), want: ind.first.slice(0, 10) });

  /* ② 並べ替え */
  const sent = [];
  const onReq = (r) => { const u = decodeURIComponent(r.url()); if (/\/api\/lotlist\?/.test(u) && /sorts=/.test(u)) sent.push(u); };
  p.on("request", onReq);
  await p.click(`#llHead tr:first-child th[data-col="${COL}"]`); await sleep(2500);
  p.off("request", onReq);
  const q = sent[0] || "";
  check("② 並べ替えの問い合わせに 管理区分 の式（ルールと同じ意味の式 if(…)）が付く", /"管理区分"/.test(q) && /calc=\{"formulas":\{"管理区分":"if\(/.test(q.replace(/\\"/g, '"')), q.slice(0, 400));
  const sorted = await p.evaluate(async (qs) => {
    const u = new URL(qs, location.href); u.searchParams.set("page", "1"); u.searchParams.set("page_size", "5000");
    const d = await (await fetch(u.pathname + "?" + u.searchParams.toString())).json();
    return (d.rows || []).map((r) => { const hit = LotListRules.match("管理区分", r, "管理区分"); return hit ? String(LotListRules.textOf(hit, r) ?? "") : ""; });
  }, q.replace(/^.*?(\/api\/lotlist\?)/, "$1"));
  const ascending = sorted.every((v, i) => i === 0 || sorted[i - 1] <= v);
  const cnt = {}; sorted.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
  check(`② サーバーの答えの全部の行（${sorted.length}）が 管理区分 の昇順で、値ごとの件数が独立の答えと同じ`, sorted.length === ind.n && ascending && JSON.stringify(cnt) === JSON.stringify(Object.fromEntries(Object.keys(ind.by).sort().map((k) => [k, ind.by[k]]))), { n: sorted.length, ascending, cnt, by: ind.by });
  const shownSorted = await colCells(p, COL, 30);
  check("② 一覧の先頭が並べ替えた順（いちばん小さい値「3000系」が先頭に来る）", shownSorted.length >= 20 && shownSorted.every((v) => v === "3000系"), shownSorted.slice(0, 8));
  await p.click(`#llHead tr:first-child th[data-col="${COL}"]`); await sleep(800);
  await p.evaluate(() => { const b = document.querySelector('[data-sort-clear], #llSortClear'); if (b) b.click(); });
  await setScene(p); await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);

  /* ③ 集計表 */
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPvFields .pv-f[data-col]"); await sleep(800);
  const fx = await p.evaluate(() => [...document.querySelectorAll("#llPvFields .pv-f.is-fx")].map((x) => x.dataset.col));
  check("③ 集計表のカラムの欄の計算列（ƒx）に 管理区分 が並ぶ", fx.includes(COL), fx);
  const calc = await p.evaluate(() => LotListColumns.calcOfTable("lotlist:仕掛", []));
  const ans = await p.evaluate(async (c) => {
    const qs = new URLSearchParams({ table: "仕掛", rows: JSON.stringify([{ column: "管理区分", part: "" }]), cols: "[]", measures: JSON.stringify([{ agg: "count" }]), calc: JSON.stringify(c) });
    const r = await fetch(`/api/lotlist/pivot?${qs}`); return { st: r.status, d: await r.json() };
  }, calc);
  const got = Object.fromEntries((ans.d.cells || []).filter((x) => x.r.length === 1 && !x.c.length).map((x) => [ans.d.labels[0][x.r[0]], x.v[0]]));
  check(`③ サーバーの集計（管理区分 × 件数・式つき）が独立の答えと同じ（${JSON.stringify(got)}）`, ans.st === 200 && Object.keys(ind.by).every((k) => got[k] === ind.by[k]) && Object.keys(got).length === 3, { st: ans.st, got, by: ind.by });
  await p.click(`#llPvFields .pv-f[data-col="${COL}"] [data-pv-add="rows"]`); await sleep(500);
  await p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy") && document.querySelector("#llPvOut .pv-table"), null, { timeout: 30000 }); await sleep(500);
  const table = await p.evaluate(() => [...document.querySelectorAll("#llPvOut .pv-table tbody tr")].map((r) => [...r.children].map((c) => c.textContent.trim())));
  const tableBy = Object.fromEntries(table.filter((r) => ["3000系", "5052厚板", "その他"].includes(r[0])).map((r) => [r[0], Number(String(r[r.length - 1]).replace(/,/g, ""))]));
  check("③ 画面の集計表の数がサーバーの答えと同じ", Object.keys(ind.by).every((k) => tableBy[k] === ind.by[k]), { tableBy, table: table.slice(0, 5) });
  await p.click('#llViewSwitch [data-pv-view="list"]').catch(() => {}); await sleep(600);

  /* ④ 表示列の窓 */
  await openCols(p, COL);
  await p.evaluate(() => { const s = document.querySelector('.lc-step[data-step="fx"]'); if (s && !s.classList.contains("is-open")) s.querySelector("h4").click(); }); await sleep(300);
  // 版 3.127.0: 3 行の件数は一覧の全部の行で数える（サーバーに値の組を尋ねる）。届くまで待つ
  await p.waitForFunction(() => /一覧の全 [\d,]+ 行/.test(document.querySelector("#lcDetail .lc-rcap")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  const det = await p.evaluate(() => {
    const dd = [...document.querySelectorAll("#lcDetail .lc-card dd")];
    const lh = parseFloat(getComputedStyle(dd[0]).lineHeight) || 18;
    return { kind: dd[0].textContent, kindLines: Math.round(dd[0].getBoundingClientRect().height / lh), have: dd[1].textContent, sort: dd[2].textContent,
      fx: (document.querySelector('.lc-step[data-step="fx"] .lc-now') || {}).textContent, seg: [...document.querySelectorAll(".lc-fxseg button")].map((b) => [b.textContent, b.getAttribute("aria-checked")]),
      rows: [...document.querySelectorAll("#lcDetail .lc-rrows li")].map((li) => [li.querySelector(".lc-rread").textContent, li.querySelector(".lc-rval").textContent, +li.querySelector(".lc-rn").textContent]),
      cap: (document.querySelector("#lcDetail .lc-rrows") || {}).getAttribute?.("aria-label") || "", vcap: document.querySelector("#lcDetail .lc-rcap")?.textContent || "",
      count: (document.querySelector("#llCount") || {}).textContent || "", rule: !!document.querySelector('.lc-step[data-step="rule"]'), edit: !!document.querySelector('.lc-step[data-step="fx"] #lcRuleEdit') };
  });
  const nAll = Number(((det.vcap.match(/全 ([\d,]+) 行/) || [])[1] || "0").replace(/,/g, ""));
  // 独立の答え: 一覧の全部の行（1 ページで全件）を、ルールの行ごとに数える（値の組を通さない）
  const indCols = await p.evaluate(async (col) => {
    const d = await (await fetch("/api/lotlist?table=" + encodeURIComponent("仕掛") + "&page=1&page_size=5000")).json(), rows = LotListRules.rowsOf(col), k = rows.map(() => 0);
    for (const r of d.rows || []) { const hit = LotListRules.match(rows, r, col); if (hit) k[rows.indexOf(hit)]++; }
    return k;
  }, COL);
  check(`④ 札「${det.kind}」が 1 段・値のある行 ${det.have}・値の種類「${det.sort}」`, det.kind === "ルール「管理区分」で作る列" && det.kindLines === 1 && /^(\d+) \/ \1（/.test(det.have) && det.sort === "ルールで決まる 3 つの値", det);
  check("④ 作り方の段は「≡ ルール「管理区分」」で、2 択はルール側・ルールを編集が段の中", det.fx === "≡ ルール「管理区分」" && det.seg.length === 2 && det.seg[1][1] === "true" && det.edit, det);
  check(`④ ルールの 3 行（条件 → 値 → 件数）の件数が、一覧の全部の ${ind.n} 行をルールで数えた独立の答え（${indCols}）と同じ`, det.rows.length === 3 && det.rows.map((r) => r[1]).join() === "5052厚板,3000系,その他"
    && /合金 ＝ 「A5052」 かつ 板厚 ≧ 「1」/.test(det.rows[0][0]) && det.rows.every((r, i) => r[2] === indCols[i]) && indCols.reduce((a, b) => a + b, 0) === ind.n, { rows: det.rows, indCols });
  // 版 3.127.0: 母数を言う（一覧の「全 1,500件」と同じ数）
  check(`④ 件数の下に母数「${det.vcap}」（一覧の ${det.count} と同じ数）`, nAll === ind.n && new RegExp(`全 ${ind.n.toLocaleString()}件`).test(det.count) && det.cap.includes(det.vcap), { vcap: det.vcap, count: det.count, nAll });
  check("④ ルールで作る列には ③ 読み替えの段が無い", !det.rule, det);
  await p.click('#lcList li[data-col="合金"]'); await sleep(300);
  check("④ 元の列（合金）には ③ 読み替えの段がある", await p.evaluate(() => !!document.querySelector('.lc-step[data-step="rule"]') && !document.querySelector(".lc-fxseg")), "");
  await p.click(`#lcList li[data-col="${COL}"]`); await sleep(300);

  /* ⑤ ルールの窓 */
  await p.click("#lcRuleEdit"); await p.waitForSelector("#llRulePanel:not([hidden])"); await sleep(500);
  const rp = await p.evaluate(() => { const r = document.querySelector("#llRulePanel"); return { eb: r.querySelector(".lc-eyebrow").textContent, title: r.querySelector(".lr-title").textContent, text: r.innerText,
    keys: [...r.querySelectorAll(".lr-try-list code")].map((c) => c.textContent) }; });
  check(`⑤ ルールの窓の目「${rp.eb}」・題「${rp.title}」（表示ルール・読み替えルールと言わない）`, rp.eb === "ルール" && rp.title === "ルール「管理区分」" && !/表示ルール|読み替えルール/.test(rp.text), rp.title);
  check("⑤ 試した結果の左がロット番号（行の番号「1件目」ではない）", rp.keys.length >= 10 && rp.keys.every((k) => /^L\d{4}C\d$/.test(k)), rp.keys.slice(0, 4));
  await p.click('#llRulePanel [data-act="close"]'); await sleep(400);

  /* ⑥ 作り方の窓（新しい列） */
  p.once("dialog", (d) => d.accept("区分").catch(() => {}));
  await p.click("#lcAddCol"); await p.waitForSelector("#llFxPanel:not([hidden])"); await sleep(600);
  const fx0 = await p.evaluate(() => { const f = document.querySelector("#llFxPanel"); return { tab: (f.querySelector('[data-tab][aria-selected="true"]') || {}).dataset?.tab, cards: [...f.querySelectorAll(".lr-rcard")].map((c) => c.dataset.rule || c.dataset.act),
    usage: f.querySelector(".lr-usage").textContent, tabs: [...f.querySelectorAll(".lr-tabs button:not([hidden])")].map((b) => b.textContent) }; });
  check("⑥ 足した列の作り方の窓は「≡ 保存したルール」のタブで開き、ルール・新しいルール・変換表（マスタ）のカードが並ぶ", fx0.tab === "rule" && fx0.cards.join() === "管理区分,newrule,conv", fx0);
  check("⑥ 作り方の窓の副題・タブに「式で作る列」「表示ルール」が無い", !/式で作る列|表示ルール/.test(fx0.usage + fx0.tabs.join()), fx0);
  await p.click('#llFxPanel .lr-rcard[data-rule="管理区分"]'); await sleep(500);
  const fx1 = await p.evaluate(() => { const f = document.querySelector("#llFxPanel"); return { on: (f.querySelector(".lr-rcard.is-on") || {}).dataset?.rule, rows: [...f.querySelectorAll(".lr-rrows li")].map((li) => +li.querySelector(".lr-rn").textContent),
    keys: [...f.querySelectorAll(".lr-try-list code")].map((c) => c.textContent), outs: [...f.querySelectorAll(".lr-try-list b")].map((b) => b.textContent) }; });
  check("⑥ カードを押すと ✓（選んだ形）と 3 行の件数", fx1.on === "管理区分" && fx1.rows.length === 3 && fx1.rows.reduce((a, b) => a + b, 0) >= 100, fx1);
  // 版 3.127.0: 作り方の窓の 3 行の件数も一覧の全部の行で（表示列の窓と同じ数）・母数を言う
  await p.waitForFunction(() => /一覧の全 [\d,]+ 行/.test(document.querySelector("#llFxPanel .lr-rcap")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  const fx2 = await p.evaluate(() => { const f = document.querySelector("#llFxPanel"); return { rows: [...f.querySelectorAll(".lr-rrows li")].map((li) => +li.querySelector(".lr-rn").textContent), cap: f.querySelector(".lr-rcap")?.textContent || "" }; });
  check(`⑥ 作り方の窓の 3 行の件数（${fx2.rows}）＝一覧の全部の行で数えた独立の答え（${indCols}）・母数「${fx2.cap}」`,
    fx2.rows.join() === indCols.join() && fx2.cap === `一覧の全 ${ind.n.toLocaleString()} 行をこのルールで数えた件数`, fx2);
  // 版 3.127.0: 「保存したルール」のタブでは窓の高さが中身まで（右の下が大きく空かない）。組み立てるへ移ると前の高さ
  const fit = await p.evaluate(() => {
    const f = document.querySelector("#llFxPanel"), b = f.querySelector(".lr-body").getBoundingClientRect(), pr = f.getBoundingClientRect();
    const last = (sel) => Math.max(...[...f.querySelectorAll(sel)].map((x) => x.getBoundingClientRect().bottom), 0);
    const content = Math.max(last(".lr-rcards > *"), last(".lr-try-list li"), last(".lr-try-head"));
    return { gap: Math.round(b.bottom - content), h: Math.round(pr.height), max: parseFloat(f.style.maxHeight) || 0, fit: f.classList.contains("is-fit"), inView: pr.bottom <= innerHeight + 1 };
  });
  check(`⑥ 「保存したルール」のタブの窓は中身の高さ（中身の下の空き ${fit.gap}px ≦ 48px・窓 ${fit.h}px ≦ 前の高さ ${fit.max}px）`, fit.fit && fit.gap <= 48 && fit.gap >= 0 && fit.h <= fit.max + 1 && fit.inView, fit);
  await p.click('#llFxPanel [data-tab="build"]'); await sleep(400);
  const fit2 = await p.evaluate(() => { const f = document.querySelector("#llFxPanel"); return { h: Math.round(f.getBoundingClientRect().height), fit: f.classList.contains("is-fit") }; });
  check(`⑥ 組み立てるへ移ると前の高さ（${fit2.h}px）`, !fit2.fit && Math.abs(fit2.h - fit.max) <= 1, { fit2, fit });
  await p.click('#llFxPanel [data-tab="rule"]'); await sleep(400);
  check("⑥ 試した結果の左がロット番号で、右がルールの答え", fx1.keys.length >= 10 && fx1.keys.every((k) => /^L\d{4}C\d$/.test(k)) && fx1.outs.every((o) => ["5052厚板", "3000系", "その他"].includes(o)), fx1);
  await p.click('#llFxPanel [data-act="save"]'); await sleep(700);
  const made = await p.evaluate(() => ({ rc: LotListColumns.get("lotlist:仕掛").ruleCols, now: (document.querySelector('.lc-step[data-step="fx"] .lc-now') || {}).textContent }));
  check("⑥ 当てると 区分 がルール「管理区分」で作る列になる", made.rc["区分"] === "管理区分" && made.now === "≡ ルール「管理区分」", made);
  const cellsNew = await colCells(p, "区分", 40), cellsOld = await colCells(p, COL, 40);
  check("⑥ 一覧の 区分 のセルが 管理区分 と同じ答え", cellsNew.length >= 20 && cellsNew.every((v, i) => v === cellsOld[i]), { cellsNew: cellsNew.slice(0, 5), cellsOld: cellsOld.slice(0, 5) });

  /* ⑦ 式で作る ⇄ ルールで作る */
  await p.click('.lc-fxseg [data-lc-fxmode="fx"]'); await sleep(400);
  const toFx = await p.evaluate(() => ({ rc: LotListColumns.get("lotlist:仕掛").ruleCols["区分"], f: LotListColumns.get("lotlist:仕掛").formulas["区分"], rule: !!document.querySelector('.lc-step[data-step="rule"]') }));
  check("⑦ 式で作る に切り替えるとルールで作る列でなくなり（式は残る）、③ が戻る", !toFx.rc && /^if\(/.test(toFx.f || "") && toFx.rule, toFx);
  await p.click('.lc-fxseg [data-lc-fxmode="rule"]'); await sleep(400);
  check("⑦ ルールで作る に戻すと元どおり", await p.evaluate(() => LotListColumns.get("lotlist:仕掛").ruleCols["区分"] === "管理区分" && !document.querySelector('.lc-step[data-step="rule"]')), "");
  await p.click("#lcClose"); await sleep(300);
  await p.evaluate(() => document.querySelector('.us-card [data-us="discard"]')?.click()); await sleep(300);
  await p.close();

  /* ⑧ 3 つの大きさ */
  for (const v of ["1728x1152", "1536x864", "1280x720"]) {
    const q2 = await app.newPage("light", parseView(v));
    q2.on("pageerror", (e) => errors.push(e.message));
    await setScene(q2); await q2.reload(); await q2.waitForSelector("#llBody tr[data-i]"); await sleep(700);
    await openCols(q2, COL);
    await q2.evaluate(() => { const s = document.querySelector('.lc-step[data-step="fx"]'); if (s && !s.classList.contains("is-open")) s.querySelector("h4").click(); }); await sleep(400);
    const fit = await q2.evaluate(() => {
      const pane = document.querySelector("#lcDetail").getBoundingClientRect();
      const at = (k) => { const s = document.querySelector(`.lc-step[data-step="${k}"]`); return s ? s.getBoundingClientRect() : null; };
      const dd = document.querySelector("#lcDetail .lc-card dd"), lh = parseFloat(getComputedStyle(dd).lineHeight) || 18;
      const fmt = at("fmt"), res = at("result");
      return { pane: [pane.top, pane.bottom], fmt: fmt && [fmt.top, fmt.bottom], res: res && [res.top, res.bottom], kindLines: Math.round(dd.getBoundingClientRect().height / lh),
        rowsCut: [...document.querySelectorAll(".lc-rrows li")].some((li) => li.scrollWidth > li.clientWidth + 1) };
    });
    check(`⑧ ${v}: 作り方の段を開いても ② 値の整え方と結果の段が右の欄の中に見え、札の説明が 1 段・3 行がはみ出さない`, fit.fmt && fit.res && fit.res[1] <= fit.pane[1] + 1 && fit.kindLines === 1 && !fit.rowsCut, fit);
    await q2.close();
  }
} finally {
  await app.close();
}
check("頁の誤りが無い", errors.length === 0, errors.slice(0, 5));
console.log(fails.length ? `FAILED ${fails.length}` : "OK all");
process.exit(fails.length ? 1 : 0);
