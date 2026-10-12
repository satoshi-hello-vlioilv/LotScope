// 評価関数（開発用）: 表示列の「この列の作り方」の窓（表示ルールと同じ組み立て＋式を書く。版 3.22.0 で別の窓にした）。
//   node program/tools/ui-eval-formula.mjs
// 1. 組み立て: 重量の列で「重量 ≧ 3000 かつ 板厚 ＜ 1 → 重・薄／重量 ≧ 3000 → 重／どれにも当てはまらないとき → 軽」を組み、
//    できる式が思った式になる・試した結果が当たる・「当てる」で一覧の重量の列が 重・薄／重／軽 になり、元の重量と合う
//    （[この列] は作り替える前の値。以前は自分の式をもう 1 度通した値と比べていた）
// 2. 開き直すと組み立てるで開き、3 行が戻る。「式を書く」に組み立てた式が入る。部品から作る（数を丸める）で式の欄に足せる
// 3. 入力のラグ: CPU を 4 分の 1 に落とし、式を書く欄に打つ間の 1 打鍵の遅れ（打ってから描くまで）と長いタスク・一覧の描き直しを測り、
//    同じ画面の上の素の欄（何の処理も無い入力欄）と比べる
//    （以前は表示列の窓の欄で打つたびに 350ms 後に一覧と窓を丸ごと描き直し、平均 61ms・最大 147ms・長いタスク 482ms だった）
// 4. 読み替えルールの窓（同じ作り）も開いて閉じられる
// 全部合えば終了コード 0。
import { buildWeight, launch, sleep } from "./ui-harness.mjs";

const EXPR = "if(cmp([重量], '3000') >= 0 and cmp([板厚], '1') < 0, '重・薄', if(cmp([重量], '3000') >= 0, '重', '軽'))";
// 4 倍遅い CPU で、素の欄より多くかかってよい 1 打鍵の遅れ（ms）。長いタスクは表示するだけ（打つ手が止まった後の 1 回の描き直しは、
// 後ろの一覧の大きさ＝500 行の描画に比例し、窓の作りでは減らせない）
const LAG = { avg: 12, max: 50 };
const app = await launch();
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) fails.push(name); };
try {
  const p = await app.newPage("light");
  await p.click("#llColBtn"); await sleep(600);
  await p.click('#lcList li[data-col="重量"]'); await sleep(400);
  await p.click('.lc-step[data-step="fx"] > h4'); await sleep(200);
  await p.click("#lcFxOpen"); await sleep(500);
  const tab0 = await p.$eval('#llFxPanel [data-tab][aria-selected="true"]', (b) => b.dataset.tab);
  check("式の無い列は「組み立てる」で開く", tab0 === "build", tab0);
  await buildWeight(p); await sleep(300);
  const expr = await p.$eval("#llFxPanel .lr-fx-out", (x) => x.value);
  check("できる式（表示ルールと同じ組み立て → 式）", expr === EXPR, expr);
  const tryHits = await p.$$eval("#llFxPanel .lr-try-list li.is-hit", (xs) => xs.length);
  check("試した結果: 12 件すべてがどれかの行に当たる", tryHits === 12, tryHits);
  await p.click('#llFxPanel [data-act="save"]'); await sleep(900);
  const grid = await p.evaluate(() => {
    const heads = [...document.querySelectorAll("#llHead th")].map((th) => th.dataset.col), i = heads.indexOf("重量"), j = heads.indexOf("板厚");
    return [...document.querySelectorAll("#llBody tr[data-i]")].slice(0, 40).map((tr) => [tr.children[i].textContent.trim(), tr.children[j].textContent.trim(), tr.dataset.i]);
  });
  // 一覧の元の行（サーバーの答え。並べ替え・まとめ無しなので data-i の順）と見比べる
  const rawOk = await p.evaluate(async () => {
    const d = await (await fetch("/api/lotlist?table=" + encodeURIComponent("仕掛") + "&page=1&page_size=500")).json();
    const cmp = (a, b) => window.WL.formula.cmp(a, b);
    const want = (r) => (cmp(r["重量"], "3000") >= 0 && cmp(r["板厚"], "1") < 0 ? "重・薄" : cmp(r["重量"], "3000") >= 0 ? "重" : "軽");
    const heads = [...document.querySelectorAll("#llHead th")].map((th) => th.dataset.col), i = heads.indexOf("重量");
    const trs = [...document.querySelectorAll("#llBody tr[data-i]")].slice(0, 60);
    return trs.length > 0 && trs.every((tr) => tr.children[i].textContent.trim() === want(d.rows[+tr.dataset.i]));
  });
  const kinds = [...new Set(grid.map((g) => g[0]))].sort();
  check("当てると一覧の重量の列が 重・薄／重／軽 になる", JSON.stringify(kinds) === JSON.stringify(["軽", "重", "重・薄"].sort()), kinds);
  check("一覧の値が元の重量・板厚と合う（[この列] は作り替える前の値）", rawOk, rawOk);
  // 2. 開き直す
  const sum = await p.$eval(".lc-fxhow", (x) => x.textContent);
  check("表示列の窓の要約: 組み立て 3 行から作った式", sum.includes("組み立て 3行"), sum);
  await p.click("#lcFxOpen"); await sleep(500);
  const tab1 = await p.$eval('#llFxPanel [data-tab][aria-selected="true"]', (b) => b.dataset.tab);
  const nRows = await p.$$eval("#llFxPanel .lr-rows .lr-row", (xs) => xs.length);
  check("開き直すと組み立てるで開き、3 行が戻る", tab1 === "build" && nRows === 3, { tab1, nRows });
  await p.click('#llFxPanel [data-tab="write"]'); await sleep(300);
  const written = await p.$eval("#llFxPanel .lr-write", (x) => x.value);
  check("式を書く に組み立てた式が入る", written === EXPR, written);
  // 部品から作る: 数を丸める（重量・1 桁）→ 式にする
  await p.click('#llFxPanel .lr-fbbox [data-kind="round"]'); await sleep(150);
  await p.selectOption('#llFxPanel .lr-fbbox .fb-term[data-path="from"] select', "重量"); await sleep(150);
  await p.click('#llFxPanel .lr-fbbox [data-apply="replace"]'); await sleep(300);
  const parts = await p.$eval("#llFxPanel .lr-write", (x) => x.value);
  check("部品から作る（数を丸める）で式の欄に入る", parts === "round([重量], 1)", parts);
  const condKind = await p.$$eval('#llFxPanel .lr-fbbox [data-kind]', (xs) => xs.map((x) => x.dataset.kind));
  check("部品から作るに「条件で分ける」は出さない（組み立てるで作る）", !condKind.includes("if"), condKind);

  // 3. 入力のラグ（4 倍遅い CPU）。同じ画面の上に置いた何の処理も無い入力欄（素の欄）と比べ、窓が足す遅れを測る
  //    （後ろの一覧そのものの重さ＝素の欄でもかかる分は、窓の作りでは減らせないので分けて見る）
  await p.fill("#llFxPanel .lr-write", ""); await sleep(300);
  const cdp = await p.context().newCDPSession(p);
  await p.evaluate(() => {
    window.__lat = []; window.__long = 0; window.__redraw = 0; window.__on = false;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (window.__on) window.__long += e.duration; })).observe({ entryTypes: ["longtask"] });
    new MutationObserver(() => { if (window.__on) window.__redraw++; }).observe(document.querySelector("#llBody"), { childList: true });
    document.addEventListener("keydown", () => { if (!window.__on) return; const t = performance.now(); requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t), 0)); }, true);
    const d = document.createElement("div"); d.id = "bareBox";
    d.style.cssText = "position:fixed;left:40%;top:30%;width:520px;height:220px;background:#fff;z-index:300;overflow:hidden;border:1px solid #888";
    d.innerHTML = '<textarea id="bareTa" style="width:500px;height:200px"></textarea>'; document.body.append(d);
  });
  const typeOnce = async (sel) => {
    await p.focus(sel);
    await p.evaluate(() => { window.__lat = []; window.__long = 0; window.__redraw = 0; window.__on = true; });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const pauses = [90, 120, 400, 110, 380, 130, 100, 420]; let k = 0;
    for (const ch of "if([重量] > 1000, 'a', 'b')") { await p.keyboard.type(ch); await sleep(pauses[k++ % pauses.length]); }
    await sleep(800);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    return p.evaluate(() => { window.__on = false; return { max: Math.round(Math.max(...window.__lat)), avg: Math.round(window.__lat.reduce((a, b) => a + b, 0) / window.__lat.length), long: Math.round(window.__long), redraw: window.__redraw }; });
  };
  const bare = await typeOnce("#bareTa");
  await p.evaluate(() => document.querySelector("#bareBox").remove()); await sleep(300);
  const lag = await typeOnce("#llFxPanel .lr-write");
  console.log("    入力のラグ（4 倍遅い CPU）: 作り方の窓", JSON.stringify(lag), "／ 素の欄", JSON.stringify(bare),
    "／ 以前（表示列の窓の欄・版 3.21.1）は平均 61ms・最大 147ms・長いタスク 482ms＋打つ手が止まるたびに一覧を描き直し");
  check(`窓が打鍵に足す遅れが小さい（素の欄＋平均 ${LAG.avg}ms・最大 ${LAG.max}ms まで）`, lag.avg <= bare.avg + LAG.avg && lag.max <= bare.max + LAG.max, { lag, bare });
  check("打っている間は一覧を描き直さない", lag.redraw === 0, lag.redraw);
  const tryOut = await p.$$eval("#llFxPanel .lr-try-list li b", (xs) => [...new Set(xs.map((x) => x.textContent))].sort());
  check("打った式の結果が試した結果に出る", JSON.stringify(tryOut) === '["a","b"]' || JSON.stringify(tryOut) === '["a"]', tryOut);
  await p.click('#llFxPanel [data-act="cancel"]'); await sleep(300);

  // 4. 読み替えルールの窓（同じ作り）
  p.once("dialog", (d) => d.accept("評価の読み替え"));
  await p.click('.lc-step[data-step="rule"] > h4'); await sleep(200);
  await p.selectOption("#lcRule", "__new"); await sleep(500);
  const rule = await p.evaluate(() => ({ open: !document.querySelector("#llRulePanel").hidden, title: document.querySelector("#llRulePanel .lr-title").textContent,
    colors: !!document.querySelector("#llRulePanel .lr-color"), mode: !!document.querySelector("#llRulePanel [data-mode]") }));
  check("読み替えルールの窓が開く（色・列の値の切り替えあり）", rule.open && rule.title.includes("評価の読み替え") && rule.colors && rule.mode, rule);
  await p.click('#llRulePanel [data-act="cancel"]'); await sleep(200);
  const closed = await p.$eval("#llRulePanel", (x) => x.hidden);
  check("読み替えルールの窓を閉じられる", closed, closed);
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
