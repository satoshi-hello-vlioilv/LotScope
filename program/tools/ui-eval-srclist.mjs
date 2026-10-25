// 評価関数（開発用）: データ元の一覧（版 3.54.0。決め方: ui-proposals/2026-10-srclist*〈2 回目の E2〉）。
//   node program/tools/ui-eval-srclist.mjs
// データ元が多い形（台帳 8・工程 2・マスタ 2・結合した表 1。ui-harness の manySources）で:
// ① 1 行 1 件の表: グループの見出し（グループなし・マスタ・台帳・工程）・行の数＝データ元の数・ファイル名／状態／結合の数が切れない（1728・1536・1280）
// ② スイッチ 1 手で見出しのタブの出し入れ（サーバーの listed が替わる）・品質データは「いつも出す」で替えられない理由が題にある
// ③ 見出しのグループのタブ（台帳）: 中の札が、出すデータ元だけ・並びのとおり。札を押すとその一覧
// ④ ⠿ を引いて並べ替え（リピートを組成の前へ）→ サーバーの並び・見出しの札の並びも同じ
// ⑤ 右クリックの「「台帳」へ移す」でグループが替わる・Alt＋↓ で 1 つ下へ
// ⑥ グループの名前を変える（工程 → 工程表）・全部出さない／全部出す
// ⑦ 結合した表: 見出しのタブで開くと、元の行の数（1,500）で、元より列が多い。結合の列は「＋ 製造条件マスタ」
// ⑧ ＋ 結合した表で作る（元: 仕掛・製造材質＝材質・製造調質＝質別）→ 仕掛の下に └ で入る → 消す
// ⑨ 名前・ファイルで探す（QZ*）
// 全部合えば終了コード 0。
import { launch, sleep, parseView, manySources } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const items = (p) => p.evaluate(async () => (await (await fetch("/api/sources")).json()).items);
const rows = (p) => p.$$eval("#masterSettings tr.sr-row", (trs) => trs.map((tr) => ({ key: tr.dataset.key, group: tr.dataset.group, name: tr.querySelector(".sr-nm b").textContent,
  cut: [".sr-fname", ".sr-state", ".sr-j em", ".sr-sw span"].filter((q) => { const x = tr.querySelector(q); return x && (x.scrollWidth > x.clientWidth + 1 || x.getBoundingClientRect().right > x.closest("td").getBoundingClientRect().right + 1); }) })));
const openSources = async (p) => { await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await p.evaluate(() => document.querySelector('#masterTabs [data-tab="sources"]').click()); await p.waitForSelector("#masterSettings tr.sr-row"); await sleep(600); };
const app = await launch();
try {
  const errors = [];
  for (const view of ["1280x720", "1536x864", "1728x1152"].map(parseView)) {
    const tag = `${view.width}×${view.height}`;
    const p = await app.newPage("light", view);
    p.on("pageerror", (e) => errors.push(e.message));
    await manySources(p, true); await sleep(500);
    await openSources(p);
    const rs = await rows(p), all = await items(p);
    const heads = await p.$$eval("#masterSettings tr.sr-gh b", (bs) => bs.map((b) => b.textContent));
    check(`① ${tag} グループの見出し（グループなし・マスタ・台帳・工程）`, heads.join() === "グループなし,マスタ,台帳,工程", heads);
    check(`① ${tag} 行の数＝データ元の数`, rs.length === all.length, { rows: rs.length, items: all.length });
    check(`① ${tag} ファイル名・状態・結合の数・スイッチの字が切れない`, rs.every((r) => !r.cut.length), rs.filter((r) => r.cut.length));
    const over = await p.evaluate(() => { const b = document.querySelector("#masterSettings"); return b.scrollWidth > b.clientWidth + 1; });
    check(`① ${tag} 横にはみ出さない`, !over, over);
    // 見出しの帯（グループ・結合した表でタブが増えても、右端の「終了」まで窓に収まる。入らないタブは「ほか N ▾」）
    await p.click("#masterCloseBtn"); await sleep(300);
    const hdr = await p.evaluate(() => { const h = document.querySelector("header"), q = document.querySelector("#quitBtn, [data-quit], .quit-btn") || [...h.querySelectorAll("button")].pop();
      return { over: h.scrollWidth > h.clientWidth + 1, right: q.getBoundingClientRect().right, W: innerWidth, more: !!document.querySelector(".screen-tabs .tab-more"),
        hidden: [...document.querySelectorAll(".screen-tabs [data-screen][hidden]")].map((b) => b.dataset.screen) }; });
    check(`① ${tag} 見出しの帯が窓に収まる（右端のボタンが見える）`, !hdr.over && hdr.right <= hdr.W, hdr);
    if (hdr.more) {
      await p.click(".screen-tabs .tab-more"); await sleep(250);
      const last = hdr.hidden[hdr.hidden.length - 1];
      await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button")].pop().click()); await sleep(1500);
      const sel = await p.evaluate((k) => document.querySelector(`.screen-tabs [data-screen="${CSS.escape(k)}"]`)?.getAttribute("aria-selected"), last);
      const fit2 = await p.evaluate(() => document.querySelector("header").scrollWidth <= document.querySelector("header").clientWidth + 1);
      check(`① ${tag} 「ほか」のメニューから開くと、そのタブが選ばれて帯に出る（帯は収まったまま）`, sel === "true" && fit2, { last, sel, fit2 });
    }
    await openSources(p);
    if (view.width !== 1728) { await p.context().close(); continue; }

    const key = (n) => all.find((x) => x.name === n).key;
    // ②
    await p.click(`#masterSettings [data-sr-show="${key("材調")}"]`); await sleep(1200);
    check("② スイッチ 1 手で見出しのタブに出す（材調）", (await items(p)).find((x) => x.name === "材調").listed, "");
    const lotFixed = await p.$eval('#masterSettings tr[data-key="lot"] .sr-fixed', (x) => [x.textContent, x.title]).catch(() => null);
    check("② 品質データは「いつも出す」・替えられない理由が題に", !!lotFixed && lotFixed[0] === "いつも出す" && /いつも出ます/.test(lotFixed[1]), lotFixed);
    // ③
    await p.click("#masterCloseBtn"); await sleep(400);
    await p.click('.screen-tabs [data-screen="grp:台帳"]'); await sleep(2500);
    const chips = await p.$$eval("#llEquipBar .eq-chip", (cs) => cs.map((c) => c.textContent.trim()));
    const want = (await items(p)).filter((x) => x.group === "台帳" && x.listed).map((x) => x.name);
    check("③ 台帳のタブの札が、出すデータ元だけ・並びのとおり", chips.join() === want.join(), { chips, want });
    const lab = await p.$eval("#llEquipLab", (x) => x.textContent);
    check("③ 札の段の頭がグループの名前", lab === "台帳", lab);
    // ④
    await openSources(p);
    await p.dragAndDrop(`#masterSettings tr[data-key="${key("リピート")}"]`, `#masterSettings tr[data-key="${key("組成")}"]`, { targetPosition: { x: 40, y: 4 } }); await sleep(1500);
    const order = (await items(p)).filter((x) => x.group === "台帳").map((x) => x.name);
    check("④ 引いて並べ替え: リピートが組成の前", order.indexOf("リピート") === order.indexOf("組成") - 1, order);
    await p.click("#masterCloseBtn"); await sleep(300);
    await p.click('.screen-tabs [data-screen="grp:台帳"]'); await sleep(800);
    const chips2 = await p.$$eval("#llEquipBar .eq-chip", (cs) => cs.map((c) => c.textContent.trim()));
    check("④ 見出しの札の並びも同じ", chips2.indexOf("リピート") < chips2.indexOf("組成"), chips2);
    // ⑤
    await openSources(p);
    const tr = await (await p.$(`#masterSettings tr[data-key="${key("スラブ")}"] .sr-nm`)).boundingBox();
    await p.mouse.click(tr.x + 30, tr.y + tr.height / 2, { button: "right" }); await sleep(300);
    await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button")].find((b) => b.textContent.includes("「台帳」へ移す")).click()); await sleep(1800);
    check("⑤ 右クリックの「台帳」へ移す", (await items(p)).find((x) => x.name === "スラブ").group === "台帳", "");
    const before = (await items(p)).filter((x) => x.group === "台帳").map((x) => x.name);
    await p.focus(`#masterSettings tr[data-key="${key("組成")}"] [data-sr-grip]`); await p.keyboard.press("Alt+ArrowDown"); await sleep(1500);
    const after = (await items(p)).filter((x) => x.group === "台帳").map((x) => x.name);
    check("⑤ Alt＋↓ で 1 つ下へ", after.indexOf("組成") === before.indexOf("組成") + 1, { before, after });
    // ⑥
    await p.click('#masterSettings [data-sr-rename="工程"]'); await sleep(200);
    await p.fill("#masterSettings .sr-ask input", "工程表"); await p.keyboard.press("Enter"); await sleep(1800);
    check("⑥ グループの名前を変える（工程 → 工程表）", (await items(p)).find((x) => x.name === "圧延予定").group === "工程表", "");
    await p.click('#masterSettings [data-sr-all="0"][data-g="台帳"]'); await sleep(3500);
    check("⑥ 全部出さない", (await items(p)).filter((x) => x.group === "台帳").every((x) => !x.listed), "");
    await p.click('#masterSettings [data-sr-all="1"][data-g="台帳"]'); await sleep(3500);
    check("⑥ 全部出す", (await items(p)).filter((x) => x.group === "台帳").every((x) => x.listed), "");
    // ⑦
    const vk = key("品質データ＋製造条件");
    const jtext = await p.$eval(`#masterSettings tr[data-key="${vk}"] .sr-j`, (x) => x.textContent);
    check("⑦ 結合した表の結合の列は「＋ 製造条件マスタ」", /＋ 製造条件マスタ/.test(jtext), jtext);
    await p.click("#masterCloseBtn"); await sleep(300);
    await p.click(`.screen-tabs [data-screen="src:${vk}"]`); await sleep(4000);
    const got = await p.evaluate(async (vk) => { const a = await (await fetch(`/api/src/${vk}?page_size=1`)).json(); const b = await (await fetch("/api/lotlist?page_size=1&engine=python")).json(); return [a.count, a.columns.length, b.columns.length, document.querySelector("#llCount")?.textContent]; }, vk);
    check("⑦ 結合した表のタブ: 元の行の数（1,500）・元より列が多い", got[0] === 1500 && got[1] > got[2] && /1,500/.test(got[3] || ""), got);
    // ⑧
    await openSources(p);
    await p.click("#srView"); await sleep(500);
    await p.fill('#masterSettings .sr-card.is-open [data-sr="name"]', "仕掛＋条件");
    await p.selectOption('#masterSettings .sr-card.is-open [data-sr="base"]', "wip"); await sleep(800);
    if (!(await p.$("#masterSettings .jn-item"))) await p.click("[data-jn-add]");
    await sleep(300);
    const j = "#masterSettings .jn-item:last-of-type";
    await p.selectOption(`${j} [data-jn-with]`, { label: "製造条件マスタ" }); await sleep(900);
    await p.waitForSelector(`${j} [data-jn-key="0"] [data-jn-l] option[value="製造材質"]`, { timeout: 15000, state: "attached" }).catch(() => {});
    await p.selectOption(`${j} [data-jn-key="0"] [data-jn-l]`, "製造材質"); await p.selectOption(`${j} [data-jn-key="0"] [data-jn-r]`, "材質");
    await p.click(`${j} [data-jn-addkey]`); await sleep(150);
    await p.selectOption(`${j} [data-jn-key="1"] [data-jn-l]`, "製造調質"); await p.selectOption(`${j} [data-jn-key="1"] [data-jn-r]`, "質別"); await sleep(1500);
    await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(2500);
    const nv = (await items(p)).find((x) => x.name === "仕掛＋条件");
    const nested = nv && await p.$eval(`#masterSettings tr[data-key="${nv.key}"]`, (tr) => [!!tr.querySelector(".sr-tree"), tr.previousElementSibling?.dataset.key]).catch(() => null);
    check("⑧ ＋ 結合した表で作ると、仕掛の下に └ で入る", !!nv && nv.kind === "view" && nv.base === "wip" && nested && nested[0] && nested[1] === "wip", { nv, nested });
    if (nv) {
      await p.click(`#masterSettings [data-sr-edit="${nv.key}"]`); await sleep(400);
      p.once("dialog", (d) => d.accept());
      await p.click("#masterSettings .sr-card.is-open [data-sr-del]"); await sleep(1500);
      check("⑧ 消せる（元と相手は残る）", !(await items(p)).some((x) => x.name === "仕掛＋条件") && (await items(p)).some((x) => x.key === "wip"), "");
    }
    // ⑨
    await p.fill("#srSearch", "QZ*"); await sleep(500);
    const found = (await rows(p)).map((r) => r.name);
    check("⑨ 「QZ*」で探すと QZ のファイルの元だけ", found.length === 3 && found.every((n) => ["材調", "材質一覧", "材質"].includes(n)), found);
    await p.context().close();
  }
  check("画面のエラーが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
