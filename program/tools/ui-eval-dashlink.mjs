// 評価関数（開発用）: ダッシュボードの版 3.40.0（利用者の要望 2026-10 の 6 つ）を本物の画面で確かめる。
//   node program/tools/ui-eval-dashlink.mjs
// どの数も、画面と同じ組みをサーバー（/api/dashboard/query）へ直接問い合わせた答えと突き合わせる（画面の数を手で決め打ちしない）。
// ① 設備を 3 つ選ぶと、出し方は「重ねる」（設備ごとの系列 3 つ。合算しない）。凡例に 3 つの名前・パネルの添え書きに「設備ごとに重ねる」
//    「並べる」→ 設備ごとの小さな図 3 つ（見出しが設備名）・それぞれの計がサーバーの設備 1 台の計と同じ。「合算」→ 1 系列で 3 台の計
// ② 「行に置く」で設備が行の段の頭に入る（カラムの札の「設備」も 行 が選ばれる）。出し方の札の代わりに「行に置いています」
// ③ 別のデータと合わせる: 札が「全体・① 目標・② 実績」・② の軸を設備にして作り方を積み上げ → パネルの値が 2 つ（目標：…・実績：…（積み上げ））で、
//    サーバーへ同じ組みを問うた答えと同じ・全体の表に 2 行・差を足すと値が 3 つ・やめると 1 つのデータに戻る
// ④ 設備グループのマスタ: 設備の札が、サーバーの「実際に出てくる設備」と同じ数（作業実績だけの 12 台より多い）・ルールで入る設備に ≈ の印
//    ルールを足すと（名前が「C」で始まる）その場で当たる設備が増える（保存しない）
// ⑤ 設備グループ → 設備の表と小計: 小計の行がグループのすぐ下・総計＝小計の和＝サーバーの総計
// ⑥ 画面の印刷・ハードコピー: アプリのメニューに 3 つ・どの画面（ダッシュボード・異常ロット一覧・マスタ管理）も窓の大きさの PNG になる（白紙でない）
//    印刷は、印刷の時だけ画面の画像（#hcPrint）を出す CSS
// 頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), panel);
const total = (d) => (d.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v;
const answer = (p, id) => p.evaluate((k) => Dashboard._state().answers.get ? (Dashboard._state().answers.get(k) || {}).d : Dashboard._state().answers[k], id);
const panelOf = async (p, id) => p.evaluate((k) => Dashboard._state().layout.panels.find((x) => x.id === k), id);
async function settle(p, ms = 900) { await sleep(ms); for (let i = 0; i < 60; i++) { if (!(await p.$("#dashGrid .db-spin, #dashGrid .dp-wait"))) break; await sleep(250); } await sleep(300); }
const click = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const W = "#dashGrid .db-p[data-id=\"workDays\"]";

const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView("1728x1152"), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await click(p, "[data-db-editmode]"); await sleep(400);
  await p.focus(W); await p.keyboard.press("Enter");
  await p.waitForSelector("#deFields .pv-f"); await settle(p);

  // ① 3 つ選ぶ → 重ねる
  await click(p, "[data-de-eqopen]"); await p.waitForSelector("[data-ck-deq]"); await sleep(300);
  const three = ["CR1", "L-1", "L-2"];
  for (const n of three) await p.evaluate((v) => document.querySelector(`[data-ck-deq="${v}"]`).click(), n);
  await click(p, "[data-de-eqopen]"); await settle(p, 1200);
  let d = await answer(p, "workDays");
  const on = await p.$eval("input[data-de-split]:checked", (x) => x.value);
  const legend = await p.$eval(`${W} .dp-legend`, (x) => x.textContent).catch(() => "");
  const sub = await p.$eval(`${W} .db-psub`, (x) => x.textContent);
  check("① 3 つ選ぶと出し方は「重ねる」・設備ごとの系列 3 つ（凡例に 3 つの名前・添え書き「設備ごとに重ねる」）",
    on === "series" && d.esplit === "series" && d.dims.cols[0].column === "@equip" && three.every((n) => legend.includes(n)) && sub.includes("設備ごとに重ねる"), { on, esplit: d.esplit, legend, sub });
  const pan = await panelOf(p, "workDays");
  const one = async (n) => total(await ask(p, { ...pan, equips: [n], esplit: "sum", visual: "none", body: { ...pan.body, grand: true } }))[0];
  const each = {}; for (const n of three) each[n] = await one(n);
  const seriesSum = Object.fromEntries(three.map((n) => [n, (d.cells.find((c) => !c.r.length && c.c.length === 1 && c.c[0] === n) || { v: [null] }).v[0]]));
  check("① 系列ごとの計が、設備 1 台ずつサーバーへ問うた計と同じ", three.every((n) => seriesSum[n] === each[n]), { seriesSum, each });
  // 並べる
  await p.evaluate(() => document.querySelector('input[data-de-split][value="facet"]').click()); await settle(p, 1200);
  d = await answer(p, "workDays");
  const facets = await p.$$eval(`${W} .dp-facet h4`, (xs) => xs.map((x) => x.textContent));
  check("① 「並べる」: 設備ごとの小さな図 3 つ（見出しが設備名）・計がサーバーと同じ",
    JSON.stringify(facets) === JSON.stringify(three) && d.facets.every((f) => total(f.answer)[0] === each[f.name]), { facets, totals: (d.facets || []).map((f) => [f.name, total(f.answer)[0]]) });
  // 合算
  await p.evaluate(() => document.querySelector('input[data-de-split][value="sum"]').click()); await settle(p, 1200);
  d = await answer(p, "workDays");
  check("① 「合算」: 1 系列で 3 台の計", !d.facets && !d.dims.cols.length && total(d)[0] === three.reduce((a, n) => a + each[n], 0), { cols: d.dims.cols, t: total(d), each });

  // ② 行に置く
  await click(p, '[data-de-eqput="rows"]'); await settle(p, 1000);
  const rows = (await panelOf(p, "workDays")).body.rows.map((x) => x.column);
  const said = await p.$eval("#deData", (x) => x.textContent);
  const card = await p.$eval('[data-de-add="rows"][data-col="@equip"]', (x) => x.classList.contains("on"));
  check("② 「行に置く」で設備が行の段の頭に入り、カラムの「設備」の 行 が選ばれ、「行に置いています」と言う", rows[0] === "@equip" && card && said.includes("行」に置いています"), { rows, card });
  await click(p, '[data-de-x="rows"][data-i="0"]'); await settle(p, 800);

  // ③ 別のデータと合わせる
  await click(p, "[data-de-link]"); await p.waitForSelector("#deFields .pv-f"); await settle(p, 1500);
  const tabs = await p.$$eval("#deTabs .de-tab", (xs) => xs.map((x) => x.textContent.replace(/\s+/g, "")));
  check("③ 札が「全体・① 目標・② 実績・＋ データ」", tabs.length === 4 && tabs[0].startsWith("全体") && tabs[1].includes("目標") && tabs[2].includes("実績"), tabs);
  await p.evaluate(() => document.querySelector('input[name="de-build-1"][value="cum"]').click()); await settle(p, 1200);
  let lp = await panelOf(p, "workDays");
  d = await answer(p, "workDays");
  const want = await ask(p, lp);
  check("③ 値は 2 つ（目標：…・実績：…（積み上げ））で、サーバーへ同じ組みを問うた答えと同じ",
    d.measures.length === 2 && d.measures[0].name.startsWith("目標：") && d.measures[1].name.includes("（積み上げ）") && JSON.stringify(d.cells) === JSON.stringify(want.cells), { names: d.measures.map((m) => m.name) });
  const last = d.cells.filter((c) => c.r.length).map((c) => c.v[1]).pop();
  check("③ 積み上げの最後の値＝積み上げの計", last === total(d)[1], { last, t: total(d) });
  await click(p, '[data-de-tab="-1"]'); await sleep(600);
  const lrows = await p.$$eval("#deData .de-lnkt tbody tr", (xs) => xs.length);
  await p.evaluate(() => document.querySelector('[data-de-extra="diff"]').click()); await settle(p, 1200);
  d = await answer(p, "workDays");
  check("③ 全体の表にデータ 2 行・差を足すと値が 3 つ（差＝実績−目標）", lrows === 2 && d.measures.length === 3 && d.measures[2].role === "diff"
    && d.cells.filter((c) => c.r.length && c.v[0] != null && c.v[1] != null).every((c) => Math.abs(c.v[2] - (c.v[1] - c.v[0])) < 1e-9), { lrows, n: d.measures.length });
  await click(p, "[data-de-unlink]"); await settle(p, 1200);
  lp = await panelOf(p, "workDays");
  check("③ 「合わせるのをやめる」で 1 つのデータのパネルに戻る（札が消える）", !lp.link && !(await p.$("#deTabs .de-tab")), lp.link);
  await click(p, "[data-de-cancel]"); await sleep(500);

  // ⑤ 設備グループ → 設備の表と小計
  await p.focus(W); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await settle(p);
  await click(p, '[data-de-vis="none"]'); await sleep(300);
  await click(p, '[data-de-x="rows"][data-i="0"]'); await sleep(300);
  await click(p, '[data-de-add="rows"][data-col="@egroup"]'); await sleep(300);
  await click(p, '[data-de-add="rows"][data-col="@equip"]'); await sleep(300);
  await click(p, "[data-de-sub]"); await settle(p, 1500);
  const trs = await p.$$eval(`${W} .pv-table tbody tr`, (xs) => xs.map((tr) => ({ sub: !!tr.querySelector(".pv-st"), grand: tr.classList.contains("is-grand"), text: tr.textContent.replace(/\s+/g, " ").trim() })));
  const subs = trs.filter((x) => x.sub), grandRow = trs.find((x) => x.grand);
  const subOrder = trs.map((x, i) => (x.sub ? i : -1)).filter((i) => i >= 0);
  const firstSub = subOrder[0];
  const num = (t) => +(t.match(/([\d,]+)\s*$/) || [, "0"])[1].replace(/,/g, "");
  lp = await panelOf(p, "workDays");
  const sv = total(await ask(p, lp))[0];
  check("⑤ 小計の行がグループのすぐ下（最初の小計の前は CR ライン の 2 台）・総計＝小計の和＝サーバーの総計",
    subs.length >= 3 && firstSub === 2 && grandRow && num(grandRow.text) === sv && subs.reduce((a, x) => a + num(x.text), 0) === sv, { trs: trs.map((x) => x.text), sv });
  const head = await p.$eval(`${W} .pv-table thead`, (x) => x.textContent);
  check("⑤ 見出しは「設備グループ（ライン別）」（内部の名前 @egroup を出さない）", head.includes("設備グループ（ライン別）") && !head.includes("@egroup"), head);
  await click(p, "[data-de-cancel]"); await sleep(500);

  // ⑥ 印刷・ハードコピー
  await click(p, "#appBtn"); await sleep(400);
  const items = await p.$$eval("#appMenu [role=menuitem] b", (xs) => xs.map((x) => x.textContent));
  check("⑥ アプリのメニューに「画面を印刷…・画面を画像で保存・画面の画像をコピー」", ["画面を印刷…", "画面を画像で保存", "画面の画像をコピー"].every((t) => items.includes(t)), items);
  await p.keyboard.press("Escape"); await sleep(300);
  const shoot = () => p.evaluate(async () => {
    const b = await Hardcopy.capture(), bmp = await createImageBitmap(b), c = document.createElement("canvas");
    c.width = 64; c.height = 64; const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, 64, 64);
    const px = g.getImageData(0, 0, 64, 64).data; let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 600) dark++;
    return { type: b.type, w: bmp.width, h: bmp.height, want: [Math.round(document.documentElement.clientWidth * devicePixelRatio), Math.round(document.documentElement.clientHeight * devicePixelRatio)], dark };
  });
  for (const [name, go] of [["ダッシュボード", null], ["異常ロット一覧", "#tabList"], ["マスタ管理", "#masterBtn"]]) {
    if (go) { await p.click(go).catch(() => p.evaluate((s) => document.querySelector(s).click(), go)); await sleep(2500); }
    const r = await shoot().catch((e) => ({ error: String(e) }));
    check(`⑥ ${name}を窓の大きさの PNG にできる（白紙でない）`, r.type === "image/png" && r.w === r.want[0] && r.h === r.want[1] && r.dark > 200, r);
  }
  const printCss = await p.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.media && r.media.mediaText === "print" && r.cssText.includes("#hcPrint")); } catch (_) { return false; } }));
  check("⑥ 印刷の時だけ画面の画像（#hcPrint）を出す CSS がある", printCss, printCss);

  // ④ 設備グループのマスタ（マスタ管理を開いている）
  await click(p, '#masterTabs [data-tab="egroups"]');
  await p.waitForSelector("[data-eg-save]", { timeout: 15000 }); await sleep(800);
  const server = await p.evaluate(async () => (await (await fetch("/api/masters/equipgroups")).json()).equipments);
  const chips = await p.$$eval("[data-eg-eq]", (xs) => xs.map((x) => x.dataset.egEq));
  const wl = await p.evaluate(async () => (await (await fetch("/api/dashboard/sources")).json()).items.find((x) => x.key === "work").equips.length);
  check(`④ 設備の札＝実際に出てくる設備（${server.length} 台。作業実績の ${wl} 台より多い・仕掛だけの XYZ も）`, chips.length === server.length && server.length > wl && chips.includes("XYZ"), { chips: chips.length, server: server.length, wl });
  await p.evaluate(() => [...document.querySelectorAll("[data-eg-pick]")].find((b) => b.textContent.includes("L ライン")).click()); await sleep(600);
  const ruled = await p.$$eval(".sh-eq.is-rule", (xs) => xs.map((x) => x.dataset.egEq));
  check("④ ルール（L- で始まる）で入る設備に ≈ の印", ruled.length >= 2 && ruled.every((n) => n.startsWith("L-")), ruled);
  await click(p, "[data-eg-radd]"); await sleep(300);
  await p.evaluate(() => { const rows = document.querySelectorAll("[data-eg-rv]"); const x = rows[rows.length - 1]; x.value = "C"; x.dispatchEvent(new Event("change", { bubbles: true })); }); await sleep(500);
  const ruled2 = await p.$$eval(".sh-eq.is-rule", (xs) => xs.map((x) => x.dataset.egEq));
  check("④ ルールを足すと（名前が「C」で始まる）その場で当たる設備が増える", ruled2.length > ruled.length && ruled2.some((n) => n.startsWith("C")), ruled2);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
