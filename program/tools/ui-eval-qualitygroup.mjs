// 評価関数（開発用）: 品質データもほかのデータ元と同じ汎用のデータに（版 3.122.0。利用者の改良依頼 2026-11-17 の 2。決め方: ui-proposals/2026-11-qualitygroup の K）。
//   node program/tools/ui-eval-qualitygroup.mjs
// データ元が多い形（台帳 8・工程 2・マスタ 2・結合した表 1。ui-harness の manySources）で:
// ① 品質の行: ⠿ がある（引ける）・見出しのタブは押せない錠つきのスイッチ・右クリックのメニューに「グループ（押すと移す）」のまとまりと今のグループの ✓・
//    薄い「見出しのタブに出さない」は無く、最後の 1 行で消す・タブを外すができないと言う
// ② 右クリックで「工程」へ移す → 窓の答え（/api/sources）の品質のグループが工程・結合した表（品質データ＋製造条件）も工程（元に付いて動く）・
//    表では工程の中に品質と └ 結合した表・移した直後の帯（移した先・「工程 › 品質」のタブ・結合した表も一緒・元に戻す）が窓の中で、表の上（表に被らない）
// ③ 見出し: 決まったタブ「品質」が消え、工程のタブに「› 品質」・押す 1 手で品質の一覧（件数がサーバーの /api/lotlist と同じ）・札に品質（選ばれている）・
//    札のスラブへ移って品質へ戻れる・Alt＋1 も工程のタブの品質
// ④ 帯の「元に戻す」でグループなしへ戻る・⠿ を引いて工程の見出しへ落とすと工程へ
// ⑤ 欄: グループは札で選ぶ（なし・マスタ・台帳・工程・＋ 新しいグループ…）・「台帳」を選んで保存すると台帳・押せない「このデータ元を消す」と理由
// ⑥ 開き直しても（頁を読み直す）品質は台帳のまま・見出しの台帳のタブに品質の札
// ⑦ スケジュールも移せて保存で残る（前は窓がグループを空にした）・開くと札の帯にグループの札
// ⑧ 3 つの大きさ（1728・1536・1280）: 見出しの帯が窓に収まり、品質の入ったグループのタブが見出しに残る（「ほか」に入らない）・表が横にはみ出さない・
//    メニューが窓に収まる
// 全部合えば終了コード 0。
import { launch, sleep, parseView, manySources } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 1500)}`}`); if (!ok) fails.push(name); };
const items = (p) => p.evaluate(async () => (await (await fetch("/api/sources")).json()).items);
const lotOf = async (p) => (await items(p)).find((x) => x.key === "lot");
const openSources = async (p) => {
  if (!(await p.$("#masterOverlay:not(.hidden)"))) { await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); }
  await p.evaluate(() => document.querySelector('#masterTabs [data-tab="sources"]').click()); await p.waitForSelector("#masterSettings tr.sr-row"); await sleep(700);
};
const closeMaster = async (p) => { await p.click("#masterCloseBtn").catch(() => {}); await sleep(500); };
const rightClick = async (p, key) => {
  await p.evaluate((k) => document.querySelector(`#masterSettings tr.sr-row[data-key="${k}"]`).scrollIntoView({ block: "center" }), key); await sleep(150);
  const b = await (await p.$(`#masterSettings tr.sr-row[data-key="${key}"] .sr-nm`)).boundingBox();
  await p.mouse.click(b.x + 30, b.y + b.height / 2, { button: "right" }); await sleep(350);
};
const menuItems = (p) => p.$$eval(".tpa-menu button[role=menuitem], .tpa-menu .tm-group, .tpa-menu .tm-foot", (xs) => xs.map((x) => ({
  kind: x.tagName === "BUTTON" ? "item" : x.className, text: (x.querySelector("span") || x).textContent.trim(), on: x.classList.contains("is-on"), disabled: !!x.disabled })));
const pickMenu = (p, label) => p.evaluate((l) => { const b = [...document.querySelectorAll(".tpa-menu button[role=menuitem]")].find((x) => x.querySelector("span")?.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
const header = (p) => p.evaluate(() => {
  const h = document.querySelector("header"), q = [...h.querySelectorAll("button")].pop();
  const tab = (s) => document.querySelector(`.screen-tabs [data-screen="${s}"]`);
  return { over: h.scrollWidth > h.clientWidth + 1, right: q.getBoundingClientRect().right, W: innerWidth,
    hidden: [...document.querySelectorAll(".screen-tabs [data-screen][hidden]")].map((b) => b.dataset.screen),
    list: tab("list") ? getComputedStyle(tab("list")).display : "", grp: tab("grp:工程") ? { shown: !tab("grp:工程").hidden && getComputedStyle(tab("grp:工程")).display !== "none", cur: tab("grp:工程").querySelector(".tab-cur")?.textContent || "",
      curShown: !!tab("grp:工程").querySelector(".tab-cur") && getComputedStyle(tab("grp:工程").querySelector(".tab-cur")).display !== "none", sel: tab("grp:工程").getAttribute("aria-selected") } : null };
});
const chips = (p) => p.$$eval("#llEquipBar .eq-chip", (cs) => cs.map((c) => ({ t: c.textContent.trim(), on: c.getAttribute("aria-selected") === "true", k: c.dataset.equip })));
const reset = (p) => p.evaluate(async () => {
  const its = (await (await fetch("/api/sources")).json()).items || [];
  for (const k of ["lot", "sch"]) { const x = its.find((i) => i.key === k); if (x && x.groupSet) await fetch(`/api/sources/${k}/quick`, TPA.json("POST", { "グループ": "", base_rev: x.rev || 0 })); }
  await fetch("/api/sources/order", TPA.json("POST", { keys: ["lot", ...its.filter((x) => x.key !== "lot" && x.key !== "work").map((x) => x.key)] }));
  document.dispatchEvent(new CustomEvent("tpa:sources-changed"));
});

const app = await launch();
try {
  const errors = [];
  for (const view of ["1728x1152", "1536x864", "1280x720"].map(parseView)) {
    const tag = `${view.width}×${view.height}`, full = view.width === 1728;
    const p = await app.newPage("light", view);
    p.on("pageerror", (e) => errors.push(e.message));
    await manySources(p, true); await reset(p); await sleep(600);
    await openSources(p);
    // ①
    const row = await p.$eval('#masterSettings tr.sr-row[data-key="lot"]', (tr) => ({ grip: !!tr.querySelector("[data-sr-grip]"), drag: tr.draggable,
      sw: tr.querySelector(".sr-sw") && [tr.querySelector(".sr-sw").textContent.trim(), tr.querySelector(".sr-sw").getAttribute("aria-disabled"), !!tr.querySelector(".sr-sw .sr-lock")] }));
    check(`① ${tag} 品質の行に ⠿（引ける）・押せない錠つきのスイッチ（出す）`, row.grip && row.drag && row.sw && row.sw[0] === "出す" && row.sw[1] === "true" && row.sw[2], row);
    await rightClick(p, "lot");
    const m1 = await menuItems(p);
    const grpAt = m1.findIndex((x) => x.kind === "tm-group" && x.text === "グループ（押すと移す）");
    const after = m1.slice(grpAt + 1).filter((x) => x.kind === "item").map((x) => x.text);
    check(`① ${tag} メニューに「グループ（押すと移す）」のまとまり（グループなし ✓・今あるグループ 3 つ〈並びはデータ元の順〉・新しいグループ…）`,
      grpAt >= 0 && after[0] === "グループなし" && [...after.slice(1, 4)].sort().join() === ["マスタ", "台帳", "工程"].sort().join() && after[4] === "新しいグループ…" && m1.find((x) => x.text === "グループなし").on && m1.filter((x) => x.on).length === 1, m1);
    const foot = m1.filter((x) => x.kind === "tm-foot").map((x) => x.text);
    check(`① ${tag} 薄い「見出しのタブに出さない」は無く、最後の 1 行で「消す・タブを外すはできません」`,
      !m1.some((x) => /見出しのタブに出/.test(x.text)) && foot.length === 1 && /消す・タブを外すはできません/.test(foot[0]), m1);
    const mbox = await p.$eval(".tpa-menu", (m) => { const r = m.getBoundingClientRect(); return [r.top >= 0, r.bottom <= innerHeight, r.left >= 0, r.right <= innerWidth]; });
    check(`⑧ ${tag} メニューが窓に収まる`, mbox.every(Boolean), mbox);
    // ②
    await pickMenu(p, "工程"); await sleep(1800);
    let its = await items(p);
    const lot = its.find((x) => x.key === "lot"), vw = its.find((x) => x.kind === "view" && x.base === "lot");
    check(`② ${tag} 窓の答え: 品質のグループが工程・結合した表（${vw && vw.name}）も工程`, lot.group === "工程" && vw && vw.group === "工程", { lot: lot.group, view: vw && vw.group });
    const tbl = await p.$$eval('#masterSettings tr.sr-row[data-group="工程"]', (trs) => trs.map((tr) => [tr.dataset.key, !!tr.querySelector(".sr-tree")]));
    const li = tbl.findIndex((x) => x[0] === "lot");
    check(`② ${tag} 表の工程の中に品質と、その下に └ 結合した表`, li >= 0 && tbl[li + 1] && tbl[li + 1][0] === vw.key && tbl[li + 1][1], tbl);
    const bar = await p.$eval("#srMoved", (b) => { const r = b.getBoundingClientRect(), w = document.querySelector(".master-panel").getBoundingClientRect(), s = document.querySelector("#masterSettings").getBoundingClientRect();
      return { text: b.textContent, undo: !!b.querySelector("[data-sr-undo]"), shown: r.height > 0, inside: r.top >= w.top - 1 && r.bottom <= w.bottom + 1 && r.left >= w.left - 1 && r.right <= w.right + 1,
        above: r.bottom <= s.top + 1, cut: [...b.querySelectorAll("b,button")].some((x) => x.scrollWidth > x.clientWidth + 1),
        lines: [...b.querySelectorAll(":scope > b, :scope > span")].map((x) => new Set([...x.getClientRects()].map((q) => Math.round(q.top))).size) }; }).catch(() => null);
    // 版 3.127.0: 帯は「見出しの「工程」のタブの中の札で開きます」（狭いと見出しのタブは「工程」だけになるので、「工程 › 品質」と言わない。欄の説明と同じ言葉）
    check(`② ${tag} 移した直後の帯（移した先・「工程」のタブの中の札・結合した表も一緒・元に戻す）が窓の中で切れず、表の上で表に被らない`,
      !!bar && bar.shown && /「工程」へ移しました/.test(bar.text) && /「工程」のタブの中の札で開きます/.test(bar.text) && !/工程 › 品質/.test(bar.text) && /結合した表/.test(bar.text) && bar.undo && bar.inside && bar.above && !bar.cut, bar);
    check(`② ${tag} 移した直後の帯の字が 1 段（移した先と開く所が折れない）`, !!bar && bar.lines.length === 2 && bar.lines.every((n) => n === 1), bar && bar.lines);
    const over = await p.evaluate(() => { const b = document.querySelector("#masterSettings"); return b.scrollWidth > b.clientWidth + 1; });
    check(`⑧ ${tag} データ元の表が横にはみ出さない`, !over, over);
    // ③
    await closeMaster(p);
    const h1 = await header(p);
    check(`③ ${tag} 決まったタブ「品質」は出ず、工程のタブが見出しに残る（「ほか」に入らない）`, h1.list === "none" && h1.grp && h1.grp.shown && !h1.hidden.includes("grp:工程"), h1);
    check(`⑧ ${tag} 見出しの帯が窓に収まる（右端のボタンが見える）`, !h1.over && h1.right <= h1.W, h1);
    if (full) check(`③ ${tag} 工程のタブに「› 品質」（押すと開く札）`, h1.grp.cur === "› 品質" && h1.grp.curShown, h1.grp);
    await p.click('.screen-tabs [data-screen="grp:工程"]'); await sleep(2500);
    const want = await p.evaluate(async () => (await (await fetch("/api/lotlist?page_size=1")).json()).count);
    const shown = await p.$eval("#llCount", (x) => x.textContent).catch(() => "");
    const c1 = await chips(p);
    check(`③ ${tag} 工程のタブを押す 1 手で品質の一覧（件数 ${want} がサーバーと同じ）・札の品質が選ばれている`,
      new RegExp(Number(want).toLocaleString()).test(shown) && c1.some((c) => c.t === "品質" && c.on) && (await header(p)).grp.sel === "true", { shown, want, c1 });
    if (full) {
      await p.evaluate(() => [...document.querySelectorAll("#llEquipBar .eq-chip")].find((c) => c.textContent.trim() === "スラブ").click()); await sleep(1500);
      const c2 = await chips(p);
      await p.evaluate(() => document.querySelector('#llEquipBar [data-equip="list"]').click()); await sleep(2000);
      const c3 = await chips(p), s3 = await p.$eval("#llCount", (x) => x.textContent).catch(() => "");
      check("③ 札のスラブへ移って、札の品質へ戻れる（同じ件数）", c2.some((c) => c.t === "スラブ" && c.on) && c3.some((c) => c.t === "品質" && c.on) && s3 === shown, { c2, c3, s3 });
      await p.click('.screen-tabs [data-screen="dash"]'); await sleep(1200);
      await p.keyboard.press("Alt+1"); await sleep(2000);
      const h2 = await header(p), c4 = await chips(p);
      check("③ Alt＋1 も工程のタブの品質", h2.grp.sel === "true" && c4.some((c) => c.t === "品質" && c.on), { h2, c4 });
      // ④
      await openSources(p);
      await rightClick(p, "lot"); await pickMenu(p, "グループなし"); await sleep(1600);
      check("④ グループなしへ戻せる（メニュー）", (await lotOf(p)).group === "", (await lotOf(p)).group);
      await rightClick(p, "lot"); await pickMenu(p, "工程"); await sleep(1600);
      await p.click("#srMoved [data-sr-undo]"); await sleep(1800);
      check("④ 帯の「元に戻す」でグループなしへ戻る（帯は消える）", (await lotOf(p)).group === "" && !(await p.$("#srMoved")), (await lotOf(p)).group);
      await p.evaluate(() => document.querySelector('#masterSettings tr.sr-gh[data-group="工程"]').scrollIntoView({ block: "center" })); await sleep(200);
      await p.evaluate(() => document.querySelector('#masterSettings tr.sr-row[data-key="lot"]').scrollIntoView({ block: "start" })); await sleep(200);
      await p.dragAndDrop('#masterSettings tr.sr-row[data-key="lot"] [data-sr-grip]', '#masterSettings tr.sr-gh[data-group="工程"]'); await sleep(2000);
      check("④ ⠿ を引いて工程の見出しへ落とすと工程へ", (await lotOf(p)).group === "工程", (await lotOf(p)).group);
      // ⑤
      await p.click('#masterSettings [data-sr-edit="lot"]'); await sleep(700);
      await p.click('#masterSettings .sr-card.is-open [data-sr-sec="name"]').catch(() => {}); await sleep(300);
      const gf = await p.$$eval("#masterSettings .sr-card.is-open [data-sr-gpick], #masterSettings .sr-card.is-open [data-sr-gnew]", (bs) => bs.map((b) => [b.textContent.trim(), b.getAttribute("aria-checked")]));
      check("⑤ 欄のグループは札（グループなし・マスタ・台帳・工程 ✓・＋ 新しいグループ…）", gf.map((x) => x[0]).join() === "グループなし,マスタ,台帳,工程,＋ 新しいグループ…" && gf[3][1] === "true", gf);
      // 版 3.127.0: 同じ選びは欄の札とメニューで同じ言葉（前は欄が「なし」、メニューが「グループなし」「新しいグループへ…」）
      const words = (x) => x.replace(/^＋\s*/, "");
      check("⑤ 欄の札の言葉が行のメニューのグループの項目と同じ（グループなし・新しいグループ…）",
        [gf[0][0], words(gf[gf.length - 1][0])].join() === [after[0], after[4]].join(), { field: gf.map((x) => x[0]), menu: after });
      const nd = await p.$eval("#masterSettings .sr-card.is-open .sr-nodel", (b) => [b.disabled, b.textContent, b.nextElementSibling?.textContent]).catch(() => null);
      check("⑤ 押せない「このデータ元を消す」と「決まったデータ元なので消せません」", !!nd && nd[0] && /このデータ元を消す/.test(nd[1]) && /消せません/.test(nd[2] || ""), nd);
      await p.click('#masterSettings .sr-card.is-open [data-sr-gpick="台帳"]'); await sleep(200);
      await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(2200);
      check("⑤ 欄で「台帳」を選んで保存すると台帳", (await lotOf(p)).group === "台帳", (await lotOf(p)).group);
      // ⑥
      await p.reload(); await sleep(3500);
      const h3 = await p.evaluate(() => ({ list: getComputedStyle(document.querySelector("#tabList")).display, cur: document.querySelector('.screen-tabs [data-screen="grp:台帳"] .tab-cur')?.textContent || "" }));
      await p.click('.screen-tabs [data-screen="grp:台帳"]'); await sleep(2500);
      const c5 = await chips(p);
      check("⑥ 開き直しても品質は台帳のまま・見出しの台帳のタブの札に品質", (await lotOf(p)).group === "台帳" && h3.list === "none" && c5.some((c) => c.t === "品質"), { h3, c5 });
      // ⑦
      await openSources(p);
      await rightClick(p, "sch"); await pickMenu(p, "工程"); await sleep(1800);
      await p.reload(); await sleep(3500);
      const sch = (await items(p)).find((x) => x.key === "sch");
      check("⑦ スケジュールも移せて、開き直しても残る（窓がグループを空にしない）", sch.group === "工程", sch.group);
      await p.click('.screen-tabs [data-screen="grp:工程"]'); await sleep(1500);
      await p.evaluate(() => [...document.querySelectorAll("#llEquipBar .eq-chip")].find((c) => c.textContent.trim() === "スケジュール")?.click()); await sleep(3000);
      const sg = await p.$$eval("#llEquipBar .eq-grpchips .eq-chip", (cs) => cs.map((c) => c.textContent.trim()));
      check("⑦ スケジュールを開くと札の帯にグループの札（ほかの元へ移れる）", sg.includes("スラブ") && sg.includes("スケジュール"), sg);
    }
    await reset(p); await manySources(p, false);
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
