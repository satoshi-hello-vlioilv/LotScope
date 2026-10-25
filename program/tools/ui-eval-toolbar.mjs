// 評価関数（開発用）: 件数の行（機能のボタン類の段）を 1 段のままにする（版 3.25.0。7 案＋2 回目で選んだ: ui-proposals/2026-10-toolbar* の M2）。
//   node program/tools/ui-eval-toolbar.mjs
// ① 1 段: 何も効いていない一覧・混んだ所（まとめ 3 段＋並べ替え＋スライサーで選んだ値＋色付け）・並べ替え・作業実績（日＋直でまとめ、直を押して絞った所）で、
//    利用者の PC（1728×1152）とフル HD・125%（1536×864）のどちらでも、件数の行が 1 段に収まり、拡大のボタンと頁送り（▶）が切れずに見える。
//    上の段（絞り込み）も 1 段。ボタン・札の中で字が折れない（縮むのは検索の欄と、書式・条件などの名前の省略だけ）
// ② 混んだ所: 効いている物のタブが まとめ 3・並べ替え 1・選んだ値 1・色付け 1 の順に並び、1728 では名前（登録日時 › 設備 › 不良名 など）が省略されずに読める。
//    フル HD で省略されても、タブの説明（title）に全部が入る
// ③ まとめのタブ → 面に段の札（3 つ）。× で 1 段外すと、面は開いたまま札は 2 つ・タブの数も 2。Esc で閉じ、フォーカスはタブへ戻る
// ④ 並べ替えのタブ → 面の「並べ替えを外す」でタブが消え、面も閉じる。選んだ値のタブ → × で外すとタブが消え、件数が戻る
// ⑤ 拡大: 「🔍 100% ▾」→ 面のつまみ・＋で 110%（ボタンにも出る）・「100%に戻す」で戻る
// ⑥ 何も効いていない一覧では、タブは出ず「ロット番号を押すと…」の案内が見える。頁の誤りが無い
// 全部合えば終了コード 0。
import { launch, sleep, walk } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
/** 件数の行と上の段が何段か・右の組（拡大・頁送り）が切れていないか */
const rows = (p) => p.evaluate(() => {
  const lines = (box) => {
    const tops = [...box.children].filter((x) => x.offsetParent && x.getBoundingClientRect().width > 0).map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
    const uniq = []; tops.sort((a, b) => a - b).forEach((t) => { if (!uniq.length || t - uniq[uniq.length - 1] > 8) uniq.push(t); });
    return uniq.length;
  };
  const st = document.querySelector(".ll-status"), sr = st.getBoundingClientRect();
  const inside = (sel) => { const e = document.querySelector(sel); if (!e || !e.offsetParent) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= sr.right + 1 && r.left >= sr.left - 1; };
  const bar = document.querySelector("#llFilterBar .filter-search-row") || document.querySelector("#llFilterBar");
  // ボタン・札の中で字が折れて 2 行以上になった物（字の行の上端が 10px 以上ずれる）。見えている物だけ
  const folded = [...bar.querySelectorAll(":scope > button, :scope > * > button, :scope > label"), ...st.querySelectorAll("button, label, .ll-count")]
    .filter((el) => el.offsetParent && el.getBoundingClientRect().width > 0 && !el.closest(".ll-activepop,.ll-zoompop,.fm-panel,.ll-viewmenu"))
    .filter((el) => { const r = document.createRange(); r.selectNodeContents(el); const tops = [...r.getClientRects()].filter((x) => x.height > 4 && x.width > 1).map((x) => x.top);
      return tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 10; })
    .map((el) => (el.id || el.className || el.tagName) + ":" + el.textContent.trim().slice(0, 12));
  return { status: lines(st), statusH: Math.round(sr.height), filter: lines(bar), folded, zoom: inside("#llZoomBtn"), next: inside("#llCount") };   // 頁の送り（▶）は無くなった（版 3.56.0）。件数が右まで見えるか
});
const tabs = (p) => p.$$eval("#llActiveTabs [data-kind]", (xs) => xs.map((x) => ({ kind: x.dataset.kind, n: +(x.querySelector(".ll-an")?.textContent || 0),
  name: x.querySelector(".ll-aname")?.textContent || "", cut: (() => { const e = x.querySelector(".ll-aname"); return e ? e.scrollWidth > e.clientWidth + 1 : false; })(), title: x.title })));

const app = await launch();
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    const tag = `${view.width}×${view.height}`;
    const lot = await rows(p);
    const hint = await p.evaluate(() => { const h = document.querySelector(".ll-lothint"); return !!h && h.offsetParent !== null && h.getBoundingClientRect().width > 40; });
    const none = await p.$$eval("#llActiveTabs [data-kind]", (x) => x.length);
    check(`${tag} 何も効いていない一覧: 1 段・タブ無し・案内が見える`, lot.status === 1 && none === 0 && hint && lot.next && lot.zoom, { lot, none, hint });
    const seen = {};
    await walk(p, async (state) => { seen[state] = await rows(p); seen.tabs = await tabs(p); }, ["crowded"]);
    check(`${tag} 混んだ所（まとめ 3 段＋並べ替え＋選んだ値＋色付け）も件数の行は 1 段・拡大と件数が見える`, seen.crowded.status === 1 && seen.crowded.zoom && seen.crowded.next, seen.crowded);
    check(`${tag} 上の段（絞り込み。共有の書式の名前つき）も 1 段`, seen.crowded.filter === 1, seen.crowded);
    check(`${tag} 上の段・件数の行のボタンの字が折れない（縮むのは検索の欄・名前の省略だけ）`, !seen.crowded.folded.length && !lot.folded.length, { crowded: seen.crowded.folded, list: lot.folded });
    const t = seen.tabs;
    check(`${tag} 効いている物のタブ: まとめ 3・並べ替え 1・選んだ値 1・色付け 1 の順`, t.map((x) => `${x.kind}${x.n}`).join() === "group3,sort1,slicer1,marks1", t);
    check(`${tag} タブの説明に全部の名前（省略されても読める）`, t[0]?.title.includes("登録日時") && t[0]?.title.includes("不良名") && t[2]?.title.includes("CR1") && t[3]?.title.includes("汚れ"), t.map((x) => x.title));
    if (view.width === 1728) check("1728: 名前が省略されずに読める", t.every((x) => !x.cut) && t[0]?.name.includes("登録日時 › 設備 › 不良名"), t);
    if (view.width === 1728) {
      // ③ まとめの面
      await p.click('#llActiveTabs [data-kind="group"]'); await sleep(300);
      const pop1 = await p.evaluate(() => { const pp = document.querySelector("#llActivePop"); return { open: !pp.hidden, chips: pp.querySelectorAll("#llGroupBar .ll-glv").length }; });
      await p.click('#llActivePop #llGroupBar [data-gx="不良名"]'); await p.waitForFunction(() => !document.querySelector("#lotListScreen").classList.contains("is-loading")); await sleep(600);
      const pop2 = await p.evaluate(() => { const pp = document.querySelector("#llActivePop"); return { open: !pp.hidden, chips: pp.querySelectorAll("#llGroupBar .ll-glv").length, n: +document.querySelector('#llActiveTabs [data-kind="group"] .ll-an')?.textContent }; });
      await p.keyboard.press("Escape"); await sleep(200);
      const pop3 = await p.evaluate(() => ({ open: !document.querySelector("#llActivePop").hidden, focus: document.activeElement?.dataset?.kind || "" }));
      check("まとめのタブ → 面に段の札 3 つ・× で 1 段外すと面は開いたまま 2 つ（タブも 2）・Esc で閉じてタブへ戻る",
        pop1.open && pop1.chips === 3 && pop2.open && pop2.chips === 2 && pop2.n === 2 && !pop3.open && pop3.focus === "group", { pop1, pop2, pop3 });
      // ④ 並べ替え・選んだ値
      await p.click('#llActiveTabs [data-kind="sort"]'); await sleep(300);
      await p.click("#llActivePop #llSortBar [data-soff]"); await p.waitForFunction(() => !document.querySelector("#lotListScreen").classList.contains("is-loading")); await sleep(600);
      const so = await p.evaluate(() => ({ tab: !!document.querySelector('#llActiveTabs [data-kind="sort"]'), open: !document.querySelector("#llActivePop").hidden }));
      const before = await p.$eval("#llCount", (x) => +x.textContent.replace(/[^0-9]/g, ""));
      await p.click('#llActiveTabs [data-kind="slicer"]'); await sleep(300);
      await p.click("#llActivePop #llSlicerSum [data-clear]"); await p.waitForFunction(() => !document.querySelector("#lotListScreen").classList.contains("is-loading")); await sleep(700);
      const sx = await p.evaluate(() => ({ tab: !!document.querySelector('#llActiveTabs [data-kind="slicer"]'), open: !document.querySelector("#llActivePop").hidden, count: +document.querySelector("#llCount").textContent.replace(/[^0-9]/g, "") }));
      check("並べ替えのタブ → 「並べ替えを外す」でタブが消え面も閉じる。選んだ値 → × でタブが消え件数が戻る",
        !so.tab && !so.open && !sx.tab && !sx.open && sx.count > before, { so, sx, before });
      // ⑤ 拡大
      const z0 = await p.$eval("#llZoomBtn", (b) => b.textContent.replace(/\s+/g, ""));
      await p.click("#llZoomBtn"); await sleep(300);
      const zp = await p.evaluate(() => ({ open: !document.querySelector("#llZoomPop").hidden, range: !!document.querySelector("#llZoomPop #llZoomRange") }));
      await p.click("#llZoomPlus"); await sleep(200);
      const z1 = await p.$eval("#llZoomBtn", (b) => ({ t: b.textContent.replace(/\s+/g, ""), on: b.classList.contains("is-zoomed") }));
      await p.click("#llZoomReset"); await sleep(200);
      const z2 = await p.$eval("#llZoomBtn", (b) => ({ t: b.textContent.replace(/\s+/g, ""), on: b.classList.contains("is-zoomed") }));
      await p.keyboard.press("Escape");
      check("拡大: 🔍 100% → 面のつまみ・＋で 110%（ボタンにも出て強まる）・100%に戻す",
        z0.includes("100%") && zp.open && zp.range && z1.t.includes("110%") && z1.on && z2.t.includes("100%") && !z2.on, { z0, zp, z1, z2 });
    }
    // 並べ替えだけの所・作業実績（日＋直でまとめ・直を押して絞った所）
    await p.keyboard.press("Escape");
    const w = {};
    await walk(p, async (state) => { w[state] = await rows(p); }, ["sorted", "worklog-pick"]);
    check(`${tag} 並べ替えだけの所も 1 段`, w.sorted.status === 1 && w.sorted.next, w.sorted);
    check(`${tag} 作業実績（日＋直でまとめ・直で絞った所）も 1 段`, w["worklog-pick"].status === 1 && w["worklog-pick"].next, w["worklog-pick"]);
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
