// 評価関数（開発用）: データ元の結合と、見出しの「マスタ」のタブ（版 3.53.0。決め方: ui-proposals/2026-10-join*〈2 回目の G〉）。
//   node program/tools/ui-eval-join.mjs
// ① マスタ管理の「データ元」の品質データの欄で、製造条件マスタを 合金＝材質・調質＝質別 で組む（joinDemo）:
//    方式の 4 枚に残る行の数が出て、サーバーの「試す」の答え（同じ決まり）から出した数と同じ。当たった数・当たらない数も同じ
// ② 方式を替えると言葉が替わる（内部結合は「外れます」・左外部結合は「空のまま残ります」）。← → でも替わる
// ③ 相手に設備マスタを足すと、名前の同じ列が無くても空の鍵の行が出る。鍵を「設備 = 設備名」にすると全部当たる。外すと消える
// ④ 保存すると、一覧の行の結合の列に相手と当たった数・題に結合ごとの文（相手・方式・鍵。版 3.54.0 で 1 行 1 件の表に）。品質異常の一覧に持ってきた列（圧延速度・ライン）が出て、
//    圧延速度が空でない行の数がサーバーの答え（hit）と同じ。結合を外して保存すると列が消える
// ⑤ 見出しの「マスタ」のタブ: 製造条件マスタ・設備マスタが設備のタブと同じ札で並ぶ・押すと替わる・ロット番号の警告と案内を出さない・
//    マスタごとのタブは見出しに出ない・Alt の数字で開ける
// ⑥ 1728×1152・1280×720: 結合の段が横にはみ出さない・保存の段が窓の下の縁に着いて見える・方式の 4 枚の名前と行の数が切れない
// 全部合えば終了コード 0。
import { launch, sleep, parseView, joinDemo, openJoinSec } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const openTab = async (p, key) => { await p.evaluate((k) => document.querySelector(`#masterTabs [data-tab="${k}"]`).click(), key); await sleep(1200); };
const J = "#masterSettings .sr-card.is-open .jn-item";
const cardsOf = (p, i = 0) => p.$$eval(`${J}[data-jn-i="${i}"] [data-jn-how]`, (bs) => bs.map((b) => ({ how: b.dataset.jnHow, on: b.getAttribute("aria-checked") === "true",
  n: b.querySelector("em").textContent.trim(), cut: [...b.querySelectorAll("b,em")].some((x) => x.scrollWidth > x.clientWidth + 1) })));
const resText = (p, i = 0) => p.$eval(`${J}[data-jn-i="${i}"] [data-jn-res]`, (x) => x.textContent.replace(/\s+/g, " "));
const api = (p, url, body) => p.evaluate(async ([u, b]) => { const r = await fetch(u, b ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) } : {}); return r.json(); }, [url, body]);
const keyOf = async (p, name) => (await api(p, "/api/sources")).items.find((x) => x.name === name).key;
const fmt = (n) => `${n.toLocaleString()} 行`;
/** 方式ごとの数（試した答えから。画面と同じ考えで、ここで別に組む） */
const expect = (st) => {
  const m = st.out - (st.how === "left" || st.how === "full" ? st.miss : 0) - (st.how === "right" || st.how === "full" ? st.rightOnly : 0);
  return { inner: m, left: m + st.miss, right: m + st.rightOnly, full: m + st.miss + st.rightOnly };
};

const app = await launch();
try {
  for (const view of [parseView("1728x1152"), parseView("1280x720")]) {
    const tag = `${view.width}×${view.height}`, big = view.width === 1728;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
    await openTab(p, "sources");
    await p.click('#masterSettings [data-sr-edit="lot"]'); await sleep(700);
    await joinDemo(p);
    const cond = await keyOf(p, "製造条件マスタ"), eq = await keyOf(p, "設備マスタ");
    const want = await api(p, "/api/sources/join/preview", { key: "lot", joins: [{ with: cond, how: "left", on: [["合金", "材質"], ["調質", "質別"]], cols: [] }] });
    const st = want.stats[0], ex = expect(st);
    const cs = await cardsOf(p);
    check(`① ${tag} 方式の 4 枚に残る行の数（サーバーの答えと同じ）`, cs.every((c) => c.n === fmt(ex[c.how])) && cs.find((c) => c.on).how === "left", { cs, ex });
    check(`① ${tag} 当たった数・当たらない数がサーバーと同じ（${st.hit}・${st.miss}）`, (await resText(p)).includes(`${st.hit.toLocaleString()} 行が当たりました`) && (await resText(p)).includes(`${st.miss.toLocaleString()} 行は相手が無い`), await resText(p));
    // ⑥ はみ出し・保存の段・切れ
    const fit = await p.evaluate(() => {
      const box = document.querySelector("#masterSettings"), acts = document.querySelector("#masterSettings .sr-card.is-open .sr-acts");
      const save = acts.querySelector("[data-sr-save]").getBoundingClientRect(), b = box.getBoundingClientRect(), a = acts.getBoundingClientRect();
      const card = acts.closest(".sr-card").getBoundingClientRect();
      // 欄が窓より長いときだけ、保存の段は窓の下の縁に着く（短ければ欄の下にある）
      return { over: box.scrollWidth > box.clientWidth + 1, saveIn: save.top >= b.top && save.bottom <= b.bottom, gap: card.bottom > b.bottom + 1 ? Math.round(b.bottom - a.bottom) : 0,
        jnOver: [...document.querySelectorAll("#masterSettings .jn-item")].some((x) => x.scrollWidth > x.clientWidth + 1) };
    });
    check(`⑥ ${tag} 横にはみ出さない・保存が見える・保存の段の下に隙間が無い`, !fit.over && !fit.jnOver && fit.saveIn && Math.abs(fit.gap) <= 1, fit);
    check(`⑥ ${tag} 方式の 4 枚の名前と行の数が切れない`, cs.every((c) => !c.cut), cs);
    if (big) {
      // ② 方式を替えると言葉が替わる・← → でも
      await p.click(`${J} [data-jn-how="inner"]`); await sleep(300);
      check("② 内部結合: 当たらない行は「外れます」", /外れます/.test(await resText(p)) && (await cardsOf(p)).find((c) => c.on).how === "inner", await resText(p));
      await p.focus(`${J} [data-jn-how="inner"]`); await p.keyboard.press("ArrowRight"); await sleep(300);
      check("② → で左外部結合へ: 「空のまま残ります」", (await cardsOf(p)).find((c) => c.on).how === "left" && /空のまま残ります/.test(await resText(p)), await resText(p));
      // ③ 2 つ目の結合（設備マスタ。名前の同じ列が無い → 空の鍵の行）
      await p.click("#masterSettings [data-jn-add]"); await sleep(300);
      const j2 = `${J}[data-jn-i="1"]`;
      await p.selectOption(`${j2} [data-jn-with]`, eq); await sleep(1200);
      const keys = await p.$$eval(`${j2} [data-jn-key]`, (ks) => ks.map((k) => [k.querySelector("[data-jn-l]").value, k.querySelector("[data-jn-r]").value]));
      check("③ 名前の同じ列が無い相手は、空の鍵の行が 1 つ", JSON.stringify(keys) === '[["",""]]', keys);
      await p.selectOption(`${j2} [data-jn-key="0"] [data-jn-l]`, "設備");
      await p.selectOption(`${j2} [data-jn-key="0"] [data-jn-r]`, "設備名"); await sleep(1800);
      check("③ 設備 = 設備名 で全部当たる（全角の ＣＲ２ も同じ設備）", /1,500 行が当たりました/.test(await resText(p, 1)) && !/相手が無い/.test(await resText(p, 1)), await resText(p, 1));
      // ④ 保存 → カードの 1 行・一覧に列
      await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(2500);
      // 版 3.54.0: 一覧は 1 行 1 件の表。結合の列にベン図・相手（ほか N）・当たった数、題に結合ごとの文（相手・方式・鍵）
      const sum = await p.$eval('#masterSettings tr[data-key="lot"] .sr-j', (x) => [x.textContent.replace(/\s+/g, " "), x.title]);
      check("④ 保存すると、一覧の行の結合の列に相手（ほか 1）・題に結合ごとの文（相手・方式・鍵）", /製造条件マスタ ほか 1/.test(sum[0]) && /製造条件マスタ を左外部結合（合金 = 材質・調質 = 質別）/.test(sum[1]) && /設備マスタ/.test(sum[1]), sum);
      await p.click("#masterCloseBtn"); await sleep(400);
      await p.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "list" }))); await sleep(2500);
      const lst = await api(p, `/api/lotlist?engine=python&page_size=2000&filters=${encodeURIComponent(JSON.stringify([{ column: "圧延速度", op: "not_empty", value: "" }]))}`);
      const heads = await p.$$eval("#llHead th[data-fcol]", (ts) => ts.map((t) => t.dataset.fcol));
      check("④ 品質異常の一覧に持ってきた列（圧延速度・ライン）が出る", heads.includes("圧延速度") && heads.includes("ライン"), heads);
      check(`④ 圧延速度が空でない行の数がサーバーの当たった数と同じ（${st.hit}）`, lst.count === st.hit, lst.count);
      // ④ 結合を外して保存 → 列が消える
      await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await openTab(p, "sources");
      await p.click('#masterSettings [data-sr-edit="lot"]'); await sleep(900);
      await openJoinSec(p);
      for (let i = 0; i < 2; i++) { await p.click(`${J} [data-jn-del]`); await sleep(300); }
      await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(2000);
      await p.click("#masterCloseBtn"); await sleep(2500);
      const heads2 = await p.$$eval("#llHead th[data-fcol]", (ts) => ts.map((t) => t.dataset.fcol));
      check("④ 結合を外して保存すると、持ってきた列が一覧から消える", !heads2.includes("圧延速度") && !heads2.includes("ライン"), heads2);
    }
    // ⑤ 見出しの「マスタ」のタブ（保存していない欄は捨てて閉じる: 保存していない変更の窓が聞く）
    if (!big) {
      await p.click("#masterSettings .sr-card.is-open [data-sr-close]"); await sleep(400);
      const ask = await p.$('.us-card [data-us="discard"]');
      check(`${tag} 結合を直して閉じると、保存していない変更の窓が聞く`, !!ask, !!ask);
      if (ask) await ask.click();
      await sleep(300); await p.click("#masterCloseBtn"); await sleep(400);
    }
    await p.keyboard.press("Escape");
    const tabs = await p.$$eval(".screen-tabs [data-screen]", (bs) => bs.map((b) => b.dataset.screen));
    check(`⑤ ${tag} 見出しに「マスタ」のタブが 1 つ・マスタごとのタブは出ない`, tabs.filter((t) => t === "mst").length === 1 && !tabs.some((t) => /^src:m/.test(t)), tabs);
    const key = await p.$eval("#tabMst", (b) => (b.title.match(/Alt\+(\d)/) || [])[1]);
    await p.keyboard.press(`Alt+${key}`); await sleep(2500);
    const bar = () => p.evaluate(() => ({ hidden: document.querySelector("#llEquipBar").hidden, lab: document.querySelector("#llEquipLab")?.textContent,
      chips: [...document.querySelectorAll("#llEquipBar .eq-chip")].map((c) => [c.textContent.trim(), c.getAttribute("aria-selected")]),
      count: document.querySelector("#llCount").textContent, note: document.querySelector("#llNote").hidden ? "" : document.querySelector("#llNote").textContent,
      hint: (() => { const h = document.querySelector(".ll-lothint"); return h && !h.hidden ? h.textContent : ""; })(),
      selected: document.querySelector("#tabMst").getAttribute("aria-selected") }));
    let b = await bar();
    check(`⑤ ${tag} Alt+${key} で「マスタ」: 札の段に 製造条件マスタ・設備マスタ（最初は製造条件マスタ・8 件）`, !b.hidden && b.lab === "マスタ" && b.selected === "true"
      && JSON.stringify(b.chips) === '[["製造条件マスタ","true"],["設備マスタ","false"]]' && /全 8件/.test(b.count), b);
    check(`⑤ ${tag} マスタではロット番号の警告と案内を出さない`, !b.note && !b.hint, b);
    await p.click('#llEquipBar .eq-chip[aria-selected="false"]'); await sleep(2500);
    b = await bar();
    check(`⑤ ${tag} 札を押すと設備マスタへ（「マスタ」のタブのまま）`, JSON.stringify(b.chips) === '[["製造条件マスタ","false"],["設備マスタ","true"]]' && /全 8件/.test(b.count) && b.selected === "true", b);
    const fitBar = await p.evaluate(() => { const x = document.querySelector("#llEquipBar .eq-chips"); return x.scrollWidth <= x.clientWidth + 1; });
    check(`⑥ ${tag} 札の段が 1 段に収まる`, fitBar, fitBar);
    check(`${tag} 頁の中で JavaScript の失敗が無い`, !errors.length, errors);
    await p.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件が合いません` : "\n全部合いました");
process.exit(fails.length ? 1 : 0);
