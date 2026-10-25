// 評価関数（開発用）: データ元（品質データ・作業実績・仕掛・足した元を 1 つの並びで。版 3.36.0）。
//   node program/tools/ui-eval-sources.mjs
// ① マスタ管理の「データ元」: 品質データ・作業実績・仕掛が先に並ぶ（版 3.54.0 から 1 行 1 件の表）。ファイル名が切れない・品質データは「N 行 時刻」
// ② 仕掛のカードを押すと直す欄に変わる（変える… でも）。設備の列を変えて保存 → カードに出る。「既定に戻す」で既定に戻る
// ③ データ元を足す（共有の .sqlite3 を 1 つ）→ 見出しにタブが出る → 開くと一覧が出る → 消すとタブが消える
// ④ 見出しの「仕掛」のタブ: 品質異常と同じ部品で 1,200 件・ロット番号の列。品質データの「元ファイルを直す」案内はデータ元を開く
// ⑤ 参照先には品質データの場所が出ない（直す所は 1 つ）
// ⑥ 1728×1152・1280×720 で、データ元の頁が横にはみ出さない・カードの場所が切れない
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const openTab = async (p, key) => { await p.evaluate((k) => document.querySelector(`#masterTabs [data-tab="${k}"]`).click(), key); await sleep(1200); };
// 版 3.54.0: 一覧は 1 行 1 件の表（行 tr.sr-row・開いた欄 tr.sr-formrow の .sr-card.is-open）。設備の列・表は名前の題に
const cards = (p) => p.$$eval("#masterSettings tr.sr-row, #masterSettings .sr-card.is-open", (cs) => cs.map((c) => ({ key: c.dataset.key, open: c.classList.contains("is-open"),
  name: c.querySelector(".sr-nm b, .sr-name b")?.textContent || "", path: c.querySelector(".sr-file")?.title || "", file: c.querySelector(".sr-fname")?.textContent || "",
  state: (c.querySelector(".sr-state")?.textContent || "").replace(/\s+/g, " "), facts: (c.querySelector(".sr-nm")?.title || "").replace(/\s+/g, " "),
  stateTip: c.querySelector(".sr-state")?.title || "",
  cut: (() => { const x = c.querySelector(".sr-fname"); return x ? x.scrollWidth > x.clientWidth + 1 || x.getBoundingClientRect().right > x.closest("td").getBoundingClientRect().right + 1 : false; })() })));

const app = await launch();
try {
  for (const view of [parseView("1728x1152"), parseView("1280x720")]) {
    const tag = `${view.width}×${view.height}`, big = view.width === 1728;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
    await openTab(p, "sources");
    const cs = await cards(p);
    // 試験用のマスタ（製造条件マスタ・設備マスタ。版 3.53.0）が後ろに並ぶ
    check(`① ${tag} 決まった 3 枚（品質データ・作業実績・仕掛）が先に並ぶ`, cs.slice(0, 3).map((c) => c.key).join() === "lot,work,wip", cs);
    check(`① ${tag} 場所はファイル名まで（切れない）`, cs[0].file === "SIKADEF.sqlite3" && cs[2].file === "LOTNOW.sqlite3" && cs[1].file === "実績_*.sqlite3" && cs.every((c) => !c.cut), cs);
    check(`① ${tag} 品質データの状態は「1,500 行」と写した時刻（日付は題に）`, /1,500 行 \d\d:\d\d/.test(cs[0].state) && /写した \d+\/\d+ \d\d:\d\d/.test(cs[0].stateTip), cs[0]);
    const over = await p.evaluate(() => { const b = document.querySelector("#masterSettings"); return b.scrollWidth > b.clientWidth + 1; });
    check(`⑥ ${tag} データ元の頁が横にはみ出さない`, !over, over);
    if (big) {
      // ② 仕掛を直す（カードを押す）→ 設備の列を変えて保存 → 既定に戻す
      await p.click('#masterSettings tr[data-key="wip"] .sr-nm'); await sleep(300);
      check("② カードを押すと直す欄に変わる", (await cards(p)).find((c) => c.key === "wip").open, await cards(p));
      await p.fill('#masterSettings .sr-card.is-open [data-sr="equip"]', "BOX設計_設備名");
      await p.selectOption('#masterSettings .sr-card.is-open [data-sr="mode"]', "そのまま");
      await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(1500);
      const after = (await cards(p)).find((c) => c.key === "wip");
      check("② 保存すると閉じて、カードに新しい設備の列が出る", !after.open && /BOX設計_設備名（そのまま）/.test(after.facts), after);
      await p.click('#masterSettings [data-sr-edit="wip"]'); await sleep(300);
      p.once("dialog", (d) => d.accept());
      await p.click("#masterSettings .sr-card.is-open [data-sr-reset]"); await sleep(1500);
      const back = (await cards(p)).find((c) => c.key === "wip");
      check("② 既定に戻すと、設備の列も既定（残仕掛設備ｺｰｽ・前方一致）に戻る", /残仕掛設備ｺｰｽ（前方一致）/.test(back.facts), back);
      // ③ 足す → タブ → 開く → 消す
      const lotPlace = cs[0].path;
      await p.click("#srAdd"); await sleep(300);
      await p.fill('#masterSettings .sr-card.is-open [data-sr="name"]', "品質の控え");
      await p.fill('#masterSettings .sr-card.is-open [data-sr="place"]', lotPlace);
      await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(1800);
      const added = (await cards(p)).find((c) => c.name === "品質の控え");
      const tab = await p.$$eval(".screen-tabs [data-screen^='src:']", (bs) => bs.map((b) => b.textContent.trim()));
      check("③ 足すとカードが増え、見出しにタブが出る", !!added && tab.includes("品質の控え"), { added, tab });
      await p.click("#masterCloseBtn"); await sleep(300);
      await p.click(`.screen-tabs [data-screen="src:${added.key}"]`); await sleep(3500);
      const rows = await p.evaluate(() => ({ rows: document.querySelectorAll("#llBody tr[data-i]").length, count: document.querySelector("#llCount")?.textContent || "" }));
      check("③ 足した元のタブを開くと、品質異常と同じ部品で一覧が出る", rows.rows > 0 && /1,500/.test(rows.count), rows);
      await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await openTab(p, "sources");
      await p.click(`#masterSettings [data-sr-edit="${added.key}"]`); await sleep(300);
      p.once("dialog", (d) => d.accept());
      await p.click("#masterSettings .sr-card.is-open [data-sr-del]"); await sleep(1800);
      const gone = await p.$$eval(".screen-tabs [data-screen^='src:']", (bs) => bs.map((b) => b.textContent.trim()));
      check("③ 消すとカードとタブが消え、開いていた画面は品質異常へ戻る",
        !(await cards(p)).some((c) => c.name === "品質の控え") && !gone.includes("品質の控え") && (await p.evaluate(() => document.querySelector("#tabList").getAttribute("aria-selected"))) === "true", gone);
      // ⑤ 参照先に品質データの場所が出ない
      await openTab(p, "paths");
      const keys = await p.$$eval("#masterSettings .ps-card[data-key]", (xs) => xs.map((x) => x.dataset.key));
      check("⑤ 参照先には品質データの場所・表が出ない（直す所は データ元 だけ）", !keys.includes("lot_list.source") && !keys.includes("lot_list.table") && keys.includes("update.source"), keys);
      await p.click("#masterCloseBtn"); await sleep(300);
      // ④ 仕掛のタブ
      await p.click('.screen-tabs [data-screen="src:wip"]'); await sleep(3500);
      const wip = await p.evaluate(() => ({ count: document.querySelector("#llCount")?.textContent || "", head: [...document.querySelectorAll("#llHead th")].map((t) => t.textContent.trim()).slice(0, 3),
        sel: document.querySelector('.screen-tabs [data-screen="src:wip"]').getAttribute("aria-selected") }));
      check("④ 仕掛のタブ: 1,200 件・ロット番号の列・タブが選ばれている", /1,200/.test(wip.count) && wip.head.some((h) => h.includes("ロット番号")) && wip.sel === "true", wip);
    }
    check(`${tag} 頁の誤りが無い`, !errors.length, errors);
    await p.context().close();
  }
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
