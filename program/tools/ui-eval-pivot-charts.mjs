// 評価関数（開発用）: 集計表・グラフの形を 14 に増やした所と、すぐに見る（ID ごとに選ぶ・共通デフォルト）（版 3.27.0。
// 置き場は 7 案＋2 回目で選んだ: ui-proposals/2026-10-pvcharts* の M1）。
//   node program/tools/ui-eval-pivot-charts.mjs [画像を置くフォルダ]
// ① グラフの形の行: 「グラフ ［絵］時系列 ▾」・すぐに見るの札（共通デフォルト＝組み込みの quick の物）・「組み方 ▾」が 1 段（1728×1152・1536×864）
// ② グラフの形の面: 目的の行 6 つに全部の形（登録 DEFS の数。版 3.39.0 で 24）・いまの形が押されている・向くの印（日の段に ロット数＋重量の合計 → 折れ線は向く・縦棒は向かない）。
//    もう一度押すと閉じる（外を押したとして閉じ、同じ押しでまた開く、を起こさない）
// ③ 組み込みの組み方（共通デフォルト）を作業実績・品質異常で 1 つずつ当てる → どれも描ける（描けない案内が出ない）・形のボタンの名前が替わる
// ④ グラフの数と表の数を突き合わせる: パレート図（大きい順・値＝表・累積の最後が 100%）／ドーナツ（真ん中＝総計・割合の和 100%）／
//    ヒートマップ（升の数＝行×列・値＝表）／管理図（中心線＝表の値の平均・UCL−CL＝3×移動範囲の平均÷1.128）／
//    箱ひげ図（箱の数＝表の行・箱の平均＝表の平均）／散布図（点の数・相関係数＝表の 2 つの値から数え直した r）／積み上げ（凡例＝表の列）
// ⑤ すぐに見る: 組み方 ▾ の面で ☑ → 札の最後に並ぶ・◀ で前へ（札の順も替わる）・読み直しても同じ（ID ごとにサーバーへ）・☐ で消える・
//    共通デフォルトに戻す → 既定の 4 つ
// ⑥ いまの形を保存（すぐに見るに出す・標準）→ 札の最後に★つきで並び、印（当てた）が付く。開発者は共通デフォルトにも保存できる
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, pickChart, sleep } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 900)}`}`); if (!ok) fails.push(name); };
const num = (t) => +String(t || "").replace(/[,，%]/g, "");
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const idle = (p) => p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy") && !!document.querySelector("#llPivot .pv-table, #llPivot .pv-empty"), null, { timeout: 15000 }).then(() => sleep(400));
const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: path.join(SHOT, `${name}.png`) }); };
/** 表: データの行（見出し＝最後の th・数＝td）・総計の行・列の見出し */
const table = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll("#llPivot .pv-table tbody tr")].map((tr) => ({ kind: tr.classList.contains("is-grand") ? "grand" : tr.classList.contains("is-sub") ? "sub" : "data",
    head: [...tr.querySelectorAll("th")].map((x) => x.textContent).join(" / "), v: [...tr.querySelectorAll("td")].map((x) => (x.textContent === "" ? null : +x.textContent.replace(/,/g, ""))) }));
  return { data: rows.filter((r) => r.kind === "data"), grand: rows.find((r) => r.kind === "grand"), heads: [...document.querySelectorAll("#llPivot .pv-table thead th")].map((x) => x.textContent) };
});
/** グラフの形の行が何段か（子の縦の真ん中が 8px 以上ずれた数） */
const barLines = (p) => p.evaluate(() => {
  const kids = [...document.querySelectorAll("#llPivot .pv-bar > *")].filter((x) => x.getBoundingClientRect().width > 0);
  const mids = kids.map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
  return mids.reduce((n, m, i) => n + (i && m - mids[i - 1] > 8 ? 1 : 0), mids.length ? 1 : 0);
});
const quick = (p) => p.$$eval("#llPivot .pv-bar .pv-quick", (xs) => xs.map((x) => ({ id: x.dataset.pvQuick, name: x.querySelector("span").textContent, on: x.classList.contains("is-on"), std: !!x.querySelector(".pv-star.is-std") })));
const api = (p, method, url, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, m === "GET" ? {} : { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => ({})) }; }, [method, url, body]);
const openPresetPop = async (p) => { if (!(await p.$("#llPvPresetPop"))) await p.click("#llPvPreset"); await p.waitForSelector("#llPvPresetPop .pv-qorder"); await sleep(200); };
/** 元（タブ）を替え、集計表を出して読み終えるまで待つ（集計表を出している間は一覧の行を描かない） */
const toSrc = async (p, tab) => {
  await p.click(tab); await sleep(900);
  if (!(await p.evaluate(() => window.LotListPivot.on()))) await p.click('#llViewSwitch [data-pv-view="pivot"]');
  await p.waitForSelector("#llPivot .pv-bar"); await idle(p);
};
/** グラフの横の数の表（管理図・散布図の pv-stats）→ {見出し: 数} */
const stats = async (p) => Object.fromEntries((await p.$$eval("#llPvChart .pv-stats tr", (xs) => xs.map((x) => [x.querySelector("th").textContent, x.querySelector("td").textContent]))).map(([k, v]) => [k, num(v)]));
const applyBuiltin = async (p, key) => { await p.evaluate((id) => window.LotListPivot._apply(id), `b:${key}`); await sleep(300); await idle(p); };

const app = await launch();
try {
  const p = await app.newPage("light", { width: 1728, height: 1152 });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(700);
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-quick", { state: "attached" }); await sleep(400);
  // ① グラフの形の行
  const defaults = (await api(p, "GET", "/api/pivot-presets?source=work")).json;
  await p.click("#llPivot .pv-quickbig .pv-quick >> nth=0"); await idle(p);
  const q1 = await quick(p), btn1 = await p.$eval("#llPvChartBtn", (x) => x.textContent.replace(/\s+/g, ""));
  check("グラフの形の行: グラフ［時系列 ▾］・すぐに見るの札＝共通デフォルトの 4 つ（当てた札に印）・組み方 ▾",
    btn1.startsWith("時系列") && q1.map((x) => x.id).join() === defaults.quick.join() && q1.length === 4 && q1[0].on && !defaults.quickCustom && !!(await p.$("#llPvPreset")), { btn1, q1, quick: defaults.quick });
  for (const view of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
    await p.setViewportSize(view); await sleep(400);
    check(`${view.width}×${view.height} グラフの形の行が 1 段`, (await barLines(p)) === 1, await barLines(p));
  }
  await p.setViewportSize({ width: 1728, height: 1152 }); await sleep(300);
  // ② グラフの形の面
  await p.click("#llPvChartBtn"); await p.waitForSelector("#llPvChartPop .pv-cbtn"); await sleep(200);
  await shot(p, "chart-pop");
  const pop2 = await p.evaluate(() => ({ groups: [...document.querySelectorAll("#llPvChartPop .pv-cgn")].map((x) => x.textContent), charts: [...document.querySelectorAll("#llPvChartPop .pv-cbtn")].map((x) => x.dataset.pvChart),
    on: [...document.querySelectorAll('#llPvChartPop .pv-cbtn[aria-pressed="true"]')].map((x) => x.dataset.pvChart), fit: [...document.querySelectorAll("#llPvChartPop .pv-cbtn")].filter((x) => x.querySelector(".pv-fit")).map((x) => x.dataset.pvChart) }));
  const nDefs = await p.evaluate(() => LotListPivotCharts.DEFS.length);
  check(`形の面: 目的の行 6 つに ${nDefs} 形・いまの形が押されている・向く（折れ線は向く・縦棒とパレート図は向かない）`,
    pop2.groups.length === 6 && pop2.charts.length === nDefs && nDefs >= 24 && new Set(pop2.charts).size === nDefs && pop2.on.join() === "time" && pop2.fit.includes("line") && !pop2.fit.includes("column") && !pop2.fit.includes("pareto"), pop2);
  await p.click("#llPvChartBtn"); await sleep(300);
  check("形のボタンをもう一度押すと面が閉じる（開き直さない）", !(await p.$("#llPvChartPop")), "open");
  await pickChart(p, "line"); await idle(p);
  check("面から折れ線を選ぶと、面が閉じ、ボタンの名前が「折れ線」に", !(await p.$("#llPvChartPop")) && (await p.$eval("#llPvChartBtn b", (x) => x.textContent)) === "折れ線", "line");
  // ③ 組み込みの組み方を 1 つずつ（作業実績・品質異常）
  const drawn = [];
  for (const src of ["work", "lot"]) {
    if (src === "lot") await toSrc(p, "#tabList");
    const its = (await p.evaluate(() => window.LotListPivot._items())).filter((x) => x.builtin);
    for (const it of its) {
      await applyBuiltin(p, it.id.slice(2));
      const got = await p.evaluate(() => ({ svg: !!document.querySelector("#llPvChart svg[role=img]"), empty: document.querySelector("#llPvChart .pv-cempty")?.textContent || "", btn: document.querySelector("#llPvChartBtn b")?.textContent }));
      drawn.push({ src, name: it.name, chart: it.chart, missing: it.missing, ...got });
    }
  }
  const bad = drawn.filter((x) => !x.svg || x.empty || x.missing.length);
  const charts = new Set(drawn.map((x) => x.chart));
  check(`組み込みの組み方 ${drawn.length} 個を当てると、どれも描ける（形: ${[...charts].join("・")}）`, !bad.length && charts.size >= 10, bad);
  // 組み込みに無い形は、いまの組み方（担当×合金の積み上げ）で形の面から選ぶ（足りない段・値は setChart が入れる）
  await applyBuiltin(p, "few-pair");
  const rest = [];
  for (const k of (await p.evaluate(() => window.LotListPivotCharts.DEFS.map((x) => x.k))).filter((k) => !charts.has(k) && k !== "none")) {
    await pickChart(p, k); await idle(p);
    rest.push(await p.evaluate((kk) => ({ k: kk, svg: !!document.querySelector("#llPvChart svg[role=img]"), empty: document.querySelector("#llPvChart .pv-cempty")?.textContent || "" }), k));
  }
  check(`組み込みに無い形（${rest.map((x) => x.k).join("・")}）も描ける`, rest.length >= 3 && rest.every((x) => x.svg && !x.empty), rest);
  // ④ グラフの数と表の数（作業実績）
  await toSrc(p, "#tabWork");
  await applyBuiltin(p, "pareto");
  const t4 = await table(p), bars = await p.$$eval("#llPvChart svg rect title", (xs) => xs.map((x) => x.textContent));
  const pv = bars.map((t) => { const m = /^(.*): ([\d,.]+)（[\d.]+%・累積 ([\d.]+)%）$/.exec(t); return m ? { name: m[1], v: num(m[2]), cum: +m[3] } : null; }).filter(Boolean);
  const want = t4.data.map((r) => ({ name: r.head, v: r.v[0] })).sort((a, b) => b.v - a.v);
  check("パレート図: 大きい順・値＝表・累積の最後が 100%", pv.length === want.length && pv.every((x, i) => x.name === want[i].name && x.v === want[i].v) && pv[pv.length - 1].cum === 100, { pv, want });
  await shot(p, "pareto");
  await applyBuiltin(p, "work-heat");
  const t4h = await table(p), cells = await p.$$eval("#llPvChart svg rect title", (xs) => xs.map((x) => x.textContent));
  const nCols = t4h.data[0].v.length - 1;     // 列の葉（直）＋総計の列
  const sample = t4h.data[0], sampleCells = cells.filter((c) => c.startsWith(sample.head.split(" / ")[0] + " /"));
  check("ヒートマップ: 升の数＝行×列（行は 80 まで）・1 行目の値＝表", cells.length === Math.min(80, t4h.data.length) * nCols && sampleCells.every((c, k) => (c.endsWith("なし") ? sample.v[k] == null : num(c.split(": ")[1]) === sample.v[k])), { cells: cells.length, rows: t4h.data.length, nCols, sampleCells, sample });
  await applyBuiltin(p, "work-control");
  const t4c = await table(p), side = await stats(p);
  const vs = t4c.data.map((r) => r.v[0]).filter((v) => v != null), mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sigma = vs.slice(1).reduce((a, v, i) => a + Math.abs(v - vs[i]), 0) / (vs.length - 1) / 1.128;
  check("管理図: 点の数・中心線＝表の値の平均・UCL−CL＝3σ（σ＝移動範囲の平均÷1.128）", side["点の数"] === vs.length && near(side["中心線（平均）"], mean, 2e-3) && near(side["UCL（＋3σ）"] - side["中心線（平均）"], 3 * sigma, 5e-3), { side, mean, sigma, n: vs.length });
  await shot(p, "control");
  await applyBuiltin(p, "box");
  const t4b = await table(p), boxes = await p.$$eval("#llPvChart svg g > title", (xs) => xs.map((x) => x.textContent));
  const means = boxes.map((t) => num(/平均 ([\d,.]+)/.exec(t)?.[1]));
  check("箱ひげ図: 箱の数＝表の行・箱の平均＝表の平均（箱ひげの数はサーバーが同じ行で数える）", boxes.length === t4b.data.length && means.every((m, i) => near(m, t4b.data[i].v[0], 1e-3)), { boxes, rows: t4b.data.map((r) => r.v) });
  await applyBuiltin(p, "few-pair");
  const t4s = await table(p), legend = await p.$$eval("#llPvChart .pv-legend span", (xs) => xs.map((x) => x.textContent));
  check("積み上げ: 凡例＝表の列（総計を除く）", legend.join() === t4s.heads.filter((h) => !/総計|→/.test(h) && !t4s.heads[0].startsWith(h)).join(), { legend, heads: t4s.heads });
  // ④ 品質異常: ドーナツ・散布図
  await toSrc(p, "#tabList");
  await applyBuiltin(p, "donut");
  const t4d = await table(p), dn = await p.evaluate(() => ({ total: document.querySelector("#llPvChart .pv-dtot")?.textContent, pct: [...document.querySelectorAll("#llPvChart .pv-dlist small")].map((x) => +x.textContent.replace("%", "")) }));
  const pctSum = dn.pct.reduce((a, b) => a + b, 0);
  check("ドーナツ: 真ん中＝表の総計・割合の和が 100%（丸めの差 0.3 まで）", t4d.grand && num(dn.total) === t4d.grand.v[0] && Math.abs(pctSum - 100) <= 0.3, { dn, grand: t4d.grand, pctSum });
  await applyBuiltin(p, "scatter");
  const t4x = await table(p), sx = await stats(p);
  const pts = t4x.data.map((r) => r.v).filter((v) => v[0] != null && v[1] != null), n = pts.length;
  const mx = pts.reduce((a, v) => a + v[0], 0) / n, my = pts.reduce((a, v) => a + v[1], 0) / n;
  const sxy = pts.reduce((a, v) => a + (v[0] - mx) * (v[1] - my), 0), sxx = pts.reduce((a, v) => a + (v[0] - mx) ** 2, 0), syy = pts.reduce((a, v) => a + (v[1] - my) ** 2, 0);
  const r = sxy / Math.sqrt(sxx * syy);
  check("散布図: 点の数＝両方の値がある行・相関係数＝表から数え直した r（小数 3 桁）", sx["点の数"] === n && Math.abs(sx["相関係数 r"] - Math.round(r * 1000) / 1000) < 1e-9, { sx, n, r });
  await shot(p, "scatter");
  // ⑤ すぐに見る（作業実績）
  await toSrc(p, "#tabWork");
  await openPresetPop(p);
  await p.check('#llPvPresetPop [data-pv-pin="b:pareto"]'); await sleep(900);
  const q5 = await quick(p);
  check("☑ を付けると、すぐに見るの札の最後に並ぶ", q5.length === 5 && q5[4].id === "b:pareto", q5);
  await p.click('#llPvPresetPop [data-pv-qmove="4"][data-d="-1"]'); await sleep(900);
  const q5b = await quick(p);
  check("並びの ◀ で前へ（札の順も替わる）", q5b.map((x) => x.id).join() === [...defaults.quick.slice(0, 3), "b:pareto", defaults.quick[3]].join(), q5b);
  await shot(p, "quick-pop");
  await p.keyboard.press("Escape");
  await p.reload(); await p.waitForSelector("#tabWork"); await sleep(1200);
  await toSrc(p, "#tabWork");
  const q5c = await quick(p), srv = (await api(p, "GET", "/api/pivot-presets?source=work")).json;
  check("読み直しても同じ並び（ID ごとにサーバーへ覚える）", q5c.map((x) => x.id).join() === q5b.map((x) => x.id).join() && srv.quickCustom && srv.login, { q5c, srv: srv.quick });
  check("品質異常のすぐに見るは別（元ごと）", !(await api(p, "GET", "/api/pivot-presets?source=lot")).json.quickCustom, "lot");
  await openPresetPop(p);
  await p.uncheck('#llPvPresetPop [data-pv-pin="b:work-shift"]'); await sleep(900);
  const q5d = await quick(p);
  check("☐ にすると、すぐに見るの札から消える", !q5d.some((x) => x.id === "b:work-shift") && q5d.length === 4, q5d);
  await p.click("#llPvPresetPop [data-pv-qreset]"); await sleep(900);
  const q5e = await quick(p);
  check("共通デフォルトに戻す → 既定の 4 つ（自分の選びを消す）", q5e.map((x) => x.id).join() === defaults.quick.join() && !(await api(p, "GET", "/api/pivot-presets?source=work")).json.quickCustom, q5e);
  // ⑥ いまの形を保存（すぐに見るに出す・標準）・開発者は共通デフォルトにも
  await p.keyboard.press("Escape"); await sleep(200);
  await applyBuiltin(p, "work-month");
  await p.check('#llPivot [data-pv-opt="labels"]').catch(() => {}); await sleep(300);
  await openPresetPop(p);
  const dev = await p.$('#llPvPresetPop input[name="llPvPScope"][value="default"]');
  await p.fill("#llPvPName", "月ごと（試験）"); await p.check("#llPvPStd");
  await p.click("#llPvPresetPop [data-pv-psave]"); await sleep(1200);
  await p.keyboard.press("Escape"); await sleep(200);
  const q6 = await quick(p);
  check("保存（すぐに見るに出す・標準）→ 札の最後に★つきで並び、印（当てた）が付く", q6.length === 5 && q6[4].name === "月ごと（試験）" && q6[4].std && q6[4].on, q6);
  const can = (await api(p, "GET", "/api/pivot-presets?source=work")).json.canEditDefault;
  check("共通デフォルトに保存できるのは開発者だけ（面の選択肢＝サーバーの権限）", !!dev === can, { dev: !!dev, can });
  if (can) {
    await openPresetPop(p);
    await p.fill("#llPvPName", "開発者の既定（試験）"); await p.check('#llPvPresetPop input[name="llPvPScope"][value="default"]'); await p.uncheck("#llPvPQuick");
    await p.click("#llPvPresetPop [data-pv-psave]"); await sleep(1200);
    const secs = await p.$$eval("#llPvPresetPop .pv-psec", (xs) => xs.map((x) => x.textContent));
    const inDefault = await p.evaluate(() => { const items = [...document.querySelectorAll("#llPvPresetPop .pv-psec, #llPvPresetPop .pv-pi")]; let sec = ""; return items.map((x) => (x.classList.contains("pv-psec") ? ((sec = x.textContent), null) : [sec, x.querySelector("b").textContent])).filter(Boolean).filter(([s]) => s.startsWith("全員の既定")).map(([, n]) => n); });
    check("開発者が全員の既定に保存 → 面の「全員の既定」に並ぶ（版 3.49.0 で共通デフォルトから言葉を改めた）", inDefault.includes("開発者の既定（試験）") && secs.some((x) => x.startsWith("全員の既定")), { inDefault, secs });
    await p.keyboard.press("Escape");
  }
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
