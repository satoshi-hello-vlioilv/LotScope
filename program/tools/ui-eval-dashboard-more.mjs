// 評価関数（開発用）: ダッシュボードの改良（版 3.39.0。利用者の要望 2026-10 の 9 つ）を本物の画面で確かめる。
//   node program/tools/ui-eval-dashboard-more.mjs
// どの数も、画面と同じ組みをサーバー（/api/dashboard/query）へ直接問い合わせた答えと突き合わせる（画面の数を手で決め打ちしない）。
// ① パネルを絞る: 見出しの「絞る」→ 値（製造材質 A1100）をチェック → パネルの計がサーバーと同じに減る・札が出る・開き直しても残る・札の × で戻る
//    設備を 2 台選ぶ → サーバーの設備 2 台の計と同じ
// ② 設備を複数選ぶ（組む所）: 「設備」から 2 台選ぶ → パネルの組み（equips）に入り、数がサーバーと同じ
// ③ グラフの形を足す: 面・積み上げ面・X̄-R・ロリポップ・ツリーマップ・バイオリン・45度線管理図・バブル・サンキー図・スイムレーン図が、
//    それぞれの印を描く（空の知らせにならない）。サンキー図の流れの計・スイムレーン図の札の数は、サーバーの答えと同じ
// ④ 統計: 中央値・標準偏差・90%点・種類の数の数字のパネルがサーバーと同じ。累計（表し方）の最後の値＝総計
// ⑤ 計算列を組む所で作る: 名前と式を入れて「作る」→ カラムの札に「式 ✎」で出る → 値にすると、パネルの組みに式（own）が入り、サーバーがその列で数える
// ⑥ 見せ方: 枠（色の帯）・数字の形（メーター・目標までの棒）・合わせた表の見せ方（積み上げ帯・信号・割合・点・小さな線）
// ⑦ 色: 色の組（色覚に配慮）・系列ごとの色が、描いた棒の色になる
// ⑧ 書式: 横軸を日だけ・積み上げの段の中の数・基準線・縦軸の最大・凡例を出さない
// ⑨ 設備をまとめる: 選んだ設備を合算・このパネルのグループ（入らない設備はその他）・設備グループのマスタ（マスタ管理の頁で足す）
// 頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), panel);
const total = (d) => (d.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v;
const answer = (p, id) => p.evaluate((k) => Dashboard._state().answers[k], id);
const layout = (p) => p.evaluate(() => Dashboard._state().layout);
const panelOf = async (p, id) => (await layout(p)).panels.find((x) => x.id === id);
/** 答えが出そろうまで待つ（引いている間の印が消える） */
async function settle(p, ms = 900) { await sleep(ms); for (let i = 0; i < 60; i++) { if (!(await p.$("#dashGrid .db-spin"))) break; await sleep(250); } await sleep(300); }
const click = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const pick = (p, sel, v) => p.evaluate(([s, x]) => { const el = document.querySelector(s); el.value = x; el.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
const work = (id, x, y, w, h, extra) => ({ id, x, y, w, h, title: "", source: "work", equip: "", filters: [], search: "", period: null, basis: "work", sort: "", top: 0, ...extra });

const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView("1728x1152"), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.evaluate(() => { const m = TPA.local.get("tpa.dash.v1", {}); delete m.quick; TPA.local.set("tpa.dash.v1", m); });

  // ① パネルを絞る（値）
  await click(p, `${P("wipClass")} [data-db-filter]`); await p.waitForSelector("[data-df-col]"); await sleep(1500);
  await pick(p, "[data-df-col]", "製造材質"); await p.waitForSelector(".df-vf [data-vf-v]"); await sleep(300);
  await p.evaluate(() => { document.querySelector(".df-vf [data-vf-all]").click(); document.querySelector('.df-vf [data-vf-v="A1100"]').click(); }); await sleep(600);
  await click(p, "[data-df-close]"); await settle(p);
  const base = await panelOf(p, "wipClass");
  const want1 = total(await ask(p, { ...base, visual: "none", body: { ...base.body, grand: true }, filters: [{ column: "製造材質", op: "in", value: JSON.stringify(["A1100"]) }] }))[0];
  const got1 = await p.evaluate(() => { const a = Dashboard._state().answers.wipClass; return (a.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v[0]; });
  const chip1 = await p.$eval(`${P("wipClass")} .db-pq`, (x) => x.textContent);
  check(`① 値で絞る: パネルの計がサーバーと同じ（${want1}）・見出しの下に札「製造材質 A1100」`, got1 === want1 && want1 > 0 && want1 < 1200 && chip1.includes("A1100"), { got1, want1, chip1 });
  await p.reload(); await waitDash(p); await settle(p);
  const kept = await p.$eval(`${P("wipClass")} .db-pq`, (x) => !x.hidden && x.textContent.includes("A1100"));
  check("① 開き直しても、この PC の絞り込みが残る（札と「絞り込み 1」）", kept && (await p.$eval(`${P("wipClass")} [data-db-filter]`, (x) => x.textContent.includes("絞り込み 1"))), kept);
  await click(p, `${P("wipClass")} [data-db-qdrop]`); await settle(p);
  const back = await p.evaluate(() => { const a = Dashboard._state().answers.wipClass; return (a.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v[0]; });
  check("① 札の × で絞り込みが外れ、元の計（1,200）に戻る", back === 1200, back);
  // ① 設備を 2 台
  // 版 3.45.0: 設備は畳める段の中の「値で絞る」の部品（（すべて選択）を外して 2 台にチェック）
  await click(p, `${P("workDays")} [data-db-filter]`); await p.waitForSelector('[data-df-sec="eq"]'); await sleep(400);
  await p.click('[data-df-sec="eq"]'); await p.waitForSelector(".df-eqvf [data-vf-v]"); await sleep(300);
  const two = await p.evaluate(() => [...document.querySelectorAll(".df-eqvf [data-vf-v]")].slice(0, 2).map((x) => x.dataset.vfV));
  await p.click(".df-eqvf [data-vf-all]"); await sleep(200);
  for (const n of two) { await p.evaluate((v) => [...document.querySelectorAll(".df-eqvf [data-vf-v]")].find((x) => x.dataset.vfV === v).click(), n); await sleep(300); }
  await click(p, "[data-df-close]"); await settle(p, 1200);
  const wd = await panelOf(p, "workDays");
  const want2 = total(await ask(p, { ...wd, visual: "none", body: { ...wd.body, grand: true }, equips: two }))[0];
  const got2 = await p.evaluate(() => { const a = Dashboard._state().answers.workDays; return (a.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v[0] ?? a.cells.filter((c) => c.r.length === 1).reduce((s, c) => s + c.v[0], 0); });
  const all2 = total(await ask(p, { ...wd, visual: "none", body: { ...wd.body, grand: true } }))[0];
  check(`① 設備を 2 台（${two.join("・")}）選ぶと、サーバーの 2 台の計（${want2}）と同じ・全設備（${all2}）より少ない`, got2 === want2 && want2 < all2, { got2, want2, all2 });
  await click(p, `${P("workDays")} [data-db-qdrop]`); await settle(p);

  // ② 組む所で設備を複数選ぶ
  await click(p, "[data-db-editmode]"); await sleep(400);
  await p.focus(P("workDays")); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await sleep(800);
  await click(p, "[data-de-eqopen]"); await p.waitForSelector("[data-ck-deq]"); await sleep(300);
  for (const n of two) { await p.evaluate((v) => [...document.querySelectorAll("[data-ck-deq]")].find((x) => x.dataset.ckDeq === v).click(), n); await sleep(400); }
  await settle(p, 1200);
  const eqBtn = await p.$eval("[data-de-eqopen]", (x) => x.textContent);
  // 版 3.40.0: 2 台選ぶと設備ごとの系列（列の段に設備）になる。行ごとの計（列の段の無いセル）を足す
  const got3 = await p.evaluate(() => { const a = Dashboard._state().answers.workDays; return a.cells.filter((c) => c.r.length === 1 && !c.c.length).reduce((s, c) => s + c.v[0], 0); });
  check(`② 組む所の「設備」で 2 台選ぶと、ボタンに 2 台の名前・数がサーバーと同じ（${want2}）`, two.every((n) => eqBtn.includes(n)) && got3 === want2, { eqBtn, got3, want2 });
  // ⑨ 設備をまとめる（選んだ 2 台を合算）→ 行を設備にして 1 行
  // 版 3.40.0 から「まとめる」の選びは「出し方」の絵の札（重ねる・並べる・合算・グループで合算）
  await click(p, 'input[data-de-split][value="sum"]'); await sleep(300);
  await p.evaluate(() => document.querySelector('[data-de-add="rows"][data-col="@equip"]').click()); await sleep(300);   // 行を 作業日 → 外さずに設備を足すと 2 段
  await settle(p, 1500);
  const sumL = await p.evaluate(() => { const a = Dashboard._state().answers.workDays; return a.labels.map((l) => Object.values(l)); });
  check("⑨ 「選んだ設備を合算して 1 つに」: 設備の段が「選んだ設備の計」の 1 つ", sumL.some((ls) => ls.length === 1 && ls[0] === "選んだ設備の計"), sumL);
  await click(p, "[data-de-cancel]"); await sleep(600);

  // ③④⑥⑦⑧⑨: 試しのダッシュボードを置いて、答えと描いた物を確かめる
  const r = await p.evaluate(async () => (await fetch("/api/masters/equipgroups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ライン X", set: "評価のまとめ方", equipment: ["CR1", "CR2"] }) })).status);
  check("⑨ 設備グループのマスタへ足せる（/api/masters/equipgroups）", r === 201, r);
  const eqs = ["CR1", "CR2", "LS3", "L-1"];
  const T = [
    work("area", 0, 0, 4, 2, { visual: "area", body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }], labels: true }, period: { column: "@workday", kind: "days", n: 14 }, fmt: { xdate: "d" } }),
    work("sarea", 4, 0, 4, 2, { visual: "stackarea", body: { rows: [{ column: "@workday", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "days", n: 10 } }),
    work("xbar", 8, 0, 4, 2, { visual: "xbar", body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "avg", column: "出側板厚" }] } }),
    work("lolli", 0, 2, 3, 2, { visual: "lollipop", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] }, sort: "desc" }),
    work("tree", 3, 2, 3, 2, { visual: "treemap", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] } }),
    work("violin", 6, 2, 3, 2, { visual: "violin", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "avg", column: "出側板厚" }] } }),
    work("diag", 9, 2, 3, 2, { visual: "diag45", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "avg", column: "入側板厚" }, { agg: "avg", column: "出側板厚" }] } }),
    work("bubble", 0, 4, 3, 2, { visual: "bubble", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "avg", column: "入側板厚" }, { agg: "avg", column: "出側板厚" }, { agg: "lots" }] } }),
    work("stats", 3, 4, 3, 2, { visual: "kpi", body: { rows: [], cols: [], measures: [{ agg: "median", column: "出側板厚" }, { agg: "sd", column: "出側板厚" }, { agg: "pct", column: "出側板厚", p: 90 }, { agg: "distinct", column: "ロット番号" }], grand: true } }),
    work("gauge", 6, 4, 3, 2, { visual: "kpi", body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true }, period: { column: "@workday", kind: "yesterday" }, frame: "accent", fmt: { kpi: "gauge", target: 30 } }),
    work("kbar", 9, 4, 3, 1, { visual: "kpi", body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true }, period: { column: "@workday", kind: "yesterday" }, fmt: { kpi: "bar", target: 30 } }),
    work("stack", 0, 8, 6, 2, { visual: "stack", body: { rows: [{ column: "@equip", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }] }, equips: eqs,
      fmt: { labels: "inside", palette: "cud", refs: [{ value: 10, label: "目標", color: "" }], legend: "none" } }),
    work("cum", 0, 6, 3, 2, { visual: "line", body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "lots", show: "cum" }] }, period: { column: "@workday", kind: "this_month" } }),
    work("col", 3, 6, 3, 2, { visual: "column", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] }, equips: eqs, fmt: { colors: { CR1: "#123456" }, ymax: 900 },
      egroup: { mode: "panel", groups: [{ name: "CR の 2 台", members: ["CR1", "CR2"] }], rest: "other" } }),
    work("master", 6, 6, 3, 2, { visual: "none", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }], grand: true }, egroup: { mode: "master", set: "評価のまとめ方", rest: "hide" } }),
    { id: "board", x: 9, y: 6, w: 3, h: 2, title: "", visual: "board", rows: { column: "@equip", part: "" }, order: { by: "name", group: 0, dir: "desc", list: [], hide: [] },
      groups: [{ title: "", source: "work", filters: [], search: "", period: { column: "@workday", kind: "days", n: 7 }, basis: "work", measure: { agg: "lots" }, cols: [{ column: "@shift", part: "" }], look: "stack", total: true, zero: false, color: "" },
        { title: "", source: "work", filters: [], search: "", period: { column: "@workday", kind: "days", n: 7 }, basis: "work", measure: { agg: "lots" }, cols: [], look: "signal", total: true, zero: false, color: "", limits: { warn: 5, alert: 2, dir: "low" } }] },
  ];
  // サンキー図（作業区分 → 直 → 設備）・スイムレーン図（設備 × 作業日）
  T.push(work("sankey", 6, 8, 3, 2, { visual: "sankey", body: { rows: [{ column: "作業区分", part: "" }, { column: "@shift", part: "" }, { column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "days", n: 7 } }),
    work("swim", 9, 8, 3, 2, { visual: "swimlane", body: { rows: [{ column: "@equip", part: "" }, { column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "days", n: 5 } }));
  await p.evaluate((panels) => Dashboard._setLayout({ rows: 10, panels }), T); await settle(p, 3000);
  const drawn = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#dashGrid .db-p")].map((el) => [el.dataset.id, {
    empty: !!el.querySelector(".pv-cempty, .dp-err, .dp-empty"), text: (el.querySelector(".pv-cempty, .dp-err") || {}).textContent || "",
    paths: el.querySelectorAll(".db-pb svg path").length, circles: el.querySelectorAll(".db-pb svg circle").length, rects: el.querySelectorAll(".db-pb svg rect").length,
    cl: el.querySelectorAll(".pv-cl").length, lim: el.querySelectorAll(".pv-lim").length, axn: [...el.querySelectorAll(".pv-axn")].map((x) => x.textContent),
    ticks: [...el.querySelectorAll(".db-pb svg text.pv-ax")].map((x) => x.textContent), inside: el.querySelectorAll(".pv-in").length, ref: el.querySelectorAll(".pv-ref").length,
    fills: [...el.querySelectorAll(".db-pb svg rect")].map((x) => x.getAttribute("fill")), legend: !!el.querySelector(".dp-legend"),
    cls: el.className, gauge: !!el.querySelector(".dp-gauge"), kbar: !!el.querySelector(".dp-kbar .dp-track"), stackbar: el.querySelectorAll(".db-stack i").length, sig: el.querySelectorAll(".db-sig").length,
    th: [...el.querySelectorAll("tbody th")].map((x) => x.textContent) }])));
  const ok3 = {
    area: !drawn.area.empty && drawn.area.paths >= 2, sarea: !drawn.sarea.empty && drawn.sarea.paths >= 2, xbar: !drawn.xbar.empty && drawn.xbar.axn.includes("R") && drawn.xbar.cl >= 2,
    lolli: !drawn.lolli.empty && drawn.lolli.circles >= 4, tree: !drawn.tree.empty && drawn.tree.rects >= 4, violin: !drawn.violin.empty && drawn.violin.paths >= 3,
    diag: !drawn.diag.empty && drawn.diag.cl >= 1 && drawn.diag.lim >= 2 && drawn.diag.circles >= 4, bubble: !drawn.bubble.empty && drawn.bubble.circles >= 4,
  };
  // サンキー図: 最初の段 → 次の段の帯（path の title）の量の計＝サーバーの総計。スイムレーン図: 札の数＝値のある（設備・日）の組の数
  const sk = await p.evaluate(() => [...document.querySelectorAll('#dashGrid .db-p[data-id="sankey"] .db-pb svg path title')].map((t) => t.textContent));
  const skAns = await answer(p, "sankey"), skTotal = total(skAns)[0], first = new Set(Object.values(skAns.labels[0]));
  // 最初の段（作業区分。3 つなので「その他」にまとまらない）から出る帯の量の計＝総計
  const firstLinks = sk.filter((t) => first.has(t.split(" → ")[0])).map((t) => Number(t.split(": ")[1].split("（")[0].replace(/,/g, "")));
  ok3.sankey = !drawn.sankey.empty && firstLinks.length > 0 && firstLinks.reduce((a, b) => a + b, 0) === skTotal;
  // スイムレーン図: 描いたレーン（左の名前）の、値のある日の数だけ札がある
  const lanes = await p.$$eval('#dashGrid .db-p[data-id="swim"] .db-pb svg text[text-anchor="end"]', (x) => x.map((t) => t.textContent));
  const swAns = await answer(p, "swim"), swWant = swAns.cells.filter((c) => c.r.length === 2 && !c.c.length && c.v[0] > 0 && lanes.includes(c.r[0])).length;
  const swGot = await p.$$eval('#dashGrid .db-p[data-id="swim"] .db-pb svg rect[fill-opacity]', (x) => x.length);
  ok3.swim = !drawn.swim.empty && swGot === swWant && swWant > 0 && lanes.length >= 2;
  check("③ 足した形（面・積み上げ面・X̄-R・ロリポップ・ツリーマップ・バイオリン・45度線・バブル・サンキー図・スイムレーン図）が、それぞれの印を描く（サンキー図の流れの計・スイムレーン図の札の数はサーバーと同じ）",
    Object.values(ok3).every(Boolean), { ok3, skTotal, firstLinks: firstLinks.slice(0, 5), swGot, swWant, why: Object.fromEntries(Object.entries(drawn).filter(([k]) => k in ok3).map(([k, v]) => [k, v.text || v.empty])) });
  // ④ 統計
  const st = total(await ask(p, T.find((x) => x.id === "stats")));
  const shown = await p.evaluate(() => Dashboard._state().answers.stats.cells.find((c) => !c.r.length && !c.c.length).v);
  const kpiText = await p.$eval(`${P("stats")} .dp-num`, (x) => x.childNodes[0].textContent);
  check(`④ 統計（中央値 ${st[0]}・標準偏差・90%点・種類の数 ${st[3]}）がサーバーと同じで、大きな数は中央値`,
    JSON.stringify(st) === JSON.stringify(shown) && st.every((v) => typeof v === "number") && Math.abs(Number(kpiText.replace(/,/g, "")) - st[0]) < 0.01, { st, shown, kpiText });
  const cum = await ask(p, T.find((x) => x.id === "cum")), last = cum.orders[0][cum.orders[0].length - 1];
  const lastV = cum.cells.find((c) => c.r.length === 1 && c.r[0] === last && !c.c.length).v;
  check("④ 累計（表し方）の最後の日の値＝その月の総計", lastV[1] === total(cum)[0], { lastV, total: total(cum) });
  // ⑥ 見せ方
  check("⑥ 枠「色の帯」・数字の形「メーター」「目標までの棒」が出る", drawn.gauge.cls.includes("is-frame-accent") && drawn.gauge.gauge && drawn.kbar.kbar, { g: drawn.gauge.cls, gauge: drawn.gauge.gauge, kbar: drawn.kbar.kbar });
  check("⑥ 合わせた表の見せ方「積み上げ帯」「信号」（●▲✕）が出る", drawn.board.stackbar > 0 && drawn.board.sig > 0, { stack: drawn.board.stackbar, sig: drawn.board.sig });
  // ⑦ 色
  const cud = ["#0072b2", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#56b4e9"];
  check("⑦ 色の組（色覚に配慮）で積み上げの段がその組の色", drawn.stack.fills.some((f) => cud.includes(f)), drawn.stack.fills.slice(0, 8));
  // ⑨ このパネルのグループ（入らない設備はその他）・系列の色
  const colA = await answer(p, "col");
  check("⑨ このパネルのグループ: 「CR の 2 台」と「その他の設備」の 2 行（選んだ 4 台を合算）", JSON.stringify(Object.values(colA.labels[0])) === JSON.stringify(["CR の 2 台", "その他の設備"]), colA.labels);
  const masterA = await answer(p, "master");
  const cr = total(await ask(p, { ...T.find((x) => x.id === "col"), visual: "none", egroup: null, equips: ["CR1", "CR2"], body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } }))[0];
  check(`⑨ 設備グループのマスタ（入らない設備は出さない）: 「ライン X」1 行で、CR1・CR2 の計（${cr}）と同じ`, JSON.stringify(Object.values(masterA.labels[0])) === JSON.stringify(["ライン X"]) && total(masterA)[0] === cr, { l: masterA.labels, t: total(masterA), cr });
  // ⑧ 書式
  check("⑧ 横軸を「日だけ」にすると、目盛りが日の数だけ（10/2 → 2）", drawn.area.ticks.some((t) => /^\d{1,2}$/.test(t)) && !drawn.area.ticks.some((t) => t.includes("/")), drawn.area.ticks);
  check("⑧ 積み上げの段の中の数・基準線・凡例を出さない", drawn.stack.inside > 0 && drawn.stack.ref > 0 && !drawn.stack.legend, { inside: drawn.stack.inside, ref: drawn.stack.ref, legend: drawn.stack.legend });
  check("⑧ 縦軸の最大（900）が目盛りの上の端", drawn.col.ticks.includes("900"), drawn.col.ticks);

  // ⑤ 計算列を組む所で作る（値にする）
  if (await p.$("[data-db-editmode]")) { await click(p, "[data-db-editmode]"); await sleep(400); }
  await p.focus(P("cum")); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await sleep(800);
  await click(p, "[data-de-calcnew]"); await p.waitForSelector("#deCalcName");
  await p.fill("#deCalcName", "板厚の差"); await p.fill("#deCalcExpr", "[入側板厚] - [出側板厚]"); await sleep(300);
  const okBtn = await p.$eval("[data-de-calcok]", (x) => !x.disabled);
  await click(p, "[data-de-calcok]"); await p.waitForSelector('[data-de-calcopen="板厚の差"]', { timeout: 15000 }); await sleep(400);
  await p.evaluate(() => document.querySelector('[data-de-add="vals"][data-col="板厚の差"]').click()); await settle(p, 1500);
  await p.evaluate(() => { const s = document.querySelector("[data-de-agg]:last-of-type"); });
  const cp = await p.evaluate(() => Dashboard._state().layout.panels.find((x) => x.id === "cum"));
  const ca = await answer(p, "cum");
  check("⑤ 組む所で計算列（板厚の差）を作ると、札に「式 ✎」で出て、値にでき、パネルに式（own）が入り、サーバーがその列で数える",
    okBtn && (cp.calc || {}).own?.includes("板厚の差") && ca.measures.some((m) => m.column === "板厚の差" && m.agg === "sum") && !ca.error, { okBtn, calc: cp.calc, ms: ca.measures });
  // ⑤ 統計を値の札から選ぶ（標準偏差）・表し方
  const idx = await p.evaluate(() => [...document.querySelectorAll("[data-de-agg]")].pop().dataset.deAgg);
  await pick(p, `[data-de-agg="${idx}"]`, "sd"); await settle(p, 1200);
  const sd = await answer(p, "cum");
  check("④ 値の札で「標準偏差」を選ぶと、その値で数える", sd.measures.some((m) => m.column === "板厚の差" && m.agg === "sd"), sd.measures);
  await click(p, "[data-de-cancel]"); await sleep(500);

  // ⑨ マスタ管理の「設備グループ」の頁
  await p.click("#masterBtn"); await sleep(900);
  await p.evaluate(() => document.querySelector('#masterTabs [data-tab="egroups"]').click()); await sleep(1500);
  const mg = await p.evaluate(() => ({ items: [...document.querySelectorAll(".sh-item")].map((x) => x.textContent), set: [...document.querySelectorAll(".eg-setname")].map((x) => x.textContent) }));
  check("⑨ マスタ管理に「設備グループ」の頁があり、足したグループがまとめ方の下に並ぶ", mg.set.includes("評価のまとめ方") && mg.items.some((t) => t.includes("ライン X")), mg);
  await click(p, "[data-eg-new]"); await sleep(400);
  await p.fill("#egSet", "評価のまとめ方"); await p.fill("#egName", "ライン Y");
  await p.evaluate(() => document.querySelector('[data-eg-eq="L-1"]').click()); await sleep(500);
  await click(p, "[data-eg-save]"); await sleep(1500);
  const after = await p.evaluate(async () => (await (await fetch("/api/masters/equipgroups")).json()).sets);
  check("⑨ マスタ管理の頁でグループを足すと、同じまとめ方に並ぶ", JSON.stringify(after.find((x) => x.name === "評価のまとめ方").groups.map((g) => g.name)) === JSON.stringify(["ライン X", "ライン Y"]), after);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
