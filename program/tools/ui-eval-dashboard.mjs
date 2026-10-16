// 評価関数（開発用）: ダッシュボード（設備別の仕掛ロット数・前日〈現場歴〉の設備別・直ごとの実績本数。版 3.36.0）。
//   node program/tools/ui-eval-dashboard.mjs
// 試験用のサーバーは「いま」を試験データの翌日（10/3 10:00）にしてあるので、前日は 10/2。
// ① 見出しの「ダッシュボード」のタブで開く。1 枚の表で、設備ごとに仕掛のロット数と前日の直ごとの本数・計が並ぶ
// ② 表の数がサーバーの答え（/api/dashboard）と合う（仕掛の数・前日の計・直の列の和＝計〈直の外も入れて〉）
// ③ 仕掛があるのに前日 0 本の設備は「0 本」の札（色だけに頼らない）と、上の「前日 0 本」の行に名前が出る
// ④ 条件: 「仕掛の対象」を押すと札のすぐ下に欄が開く。製造材質 ＝ A1100 で保存 → 仕掛の計がサーバーの答えと合って減る。すべてに戻す
// ⑤ 「仕掛を開く ›」で仕掛のタブへ移る
// ⑥ 1728×1152・1280×720 で、見出し（題・タブ・状態の札・終了）が 1 段で窓に収まる・表が横にはみ出さない
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const read = (p) => p.evaluate(() => {
  const t = document.querySelector("#dashBody .db-table");
  if (!t) return null;
  const heads = [...t.querySelectorAll("thead tr:last-child th")].map((x) => x.textContent.trim());
  const rows = [...t.querySelectorAll("tbody tr")].map((tr) => ({ eq: tr.querySelector("th")?.textContent.trim(),
    lots: tr.querySelector(".db-lots b")?.textContent.trim(), cells: [...tr.querySelectorAll("td.db-s")].map((x) => x.textContent.trim()),
    sum: tr.querySelector(".db-sum")?.childNodes[0]?.textContent.trim(), flag: !!tr.querySelector(".db-flag"), note: tr.querySelector(".db-ng, .db-na")?.textContent || "" }));
  return { heads, rows, title: document.querySelector("#dashBody h3")?.textContent || "", warn: document.querySelector("#dashBody .db-warn")?.textContent || "",
    lotsTotal: document.querySelector("#dashBody thead .db-lots small")?.textContent || "" };
});

const app = await launch();
try {
  for (const view of [parseView("1728x1152"), parseView("1280x720")]) {
    const tag = `${view.width}×${view.height}`, big = view.width === 1728;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.click("#tabDash"); await p.waitForSelector("#dashBody .db-table", { timeout: 20000 }); await sleep(500);
    const d = await read(p);
    const api = await p.evaluate(async () => (await fetch("/api/dashboard")).json());
    check(`① ${tag} 1 枚の表（前日 10/2・現場歴）`, !!d && /前日 10\/2・現場歴/.test(d.title) && d.heads.includes("計"), d && d.title);
    const lots = Object.fromEntries(api.wip.items.map((x) => [x.equipment, x.lots]));
    const work = Object.fromEntries(api.work.items.map((x) => [x.equipment, x]));
    const badLots = d.rows.filter((r) => (lots[r.eq] || 0) !== (r.lots === "–" ? 0 : Number(r.lots.replace(/,/g, ""))));
    check(`② ${tag} 仕掛のロット数がサーバーの答えと合う（計 ${api.wip.total}）`, !badLots.length && d.lotsTotal.includes(api.wip.total.toLocaleString()), badLots);
    const badSum = d.rows.filter((r) => { const w = work[r.eq]; if (!w || w.error) return false;
      const sum = r.cells.filter((c) => /^\d+$/.test(c)).reduce((a, c) => a + Number(c), 0);
      return Number(r.sum) !== w.total.works || sum !== w.total.works; });
    check(`② ${tag} 前日の計がサーバーと合い、直の列の和＝計（直の外も入れて）`, !badSum.length, badSum);
    const zero = api.work.items.filter((x) => !x.error && !x.total.works && lots[x.equipment]).map((x) => x.equipment);
    const flagged = d.rows.filter((r) => r.flag).map((r) => r.eq);
    check(`③ ${tag} 仕掛があるのに前日 0 本の設備に「0 本」の札・上の行に名前`, zero.length > 0 && zero.every((e) => flagged.includes(e) && d.warn.includes(e)), { zero, flagged, warn: d.warn });
    // ⑥ 見出しが 1 段で窓に収まる・表が横にはみ出さない
    const fit = await p.evaluate(() => {
      const h = document.querySelector("header").getBoundingClientRect(), q = document.querySelector("#quitBtn").getBoundingClientRect();
      const brand = document.querySelector("header .brand h1"), tabs = [...document.querySelectorAll(".screen-tab")].map((b) => b.getBoundingClientRect());
      const wrap = document.querySelector("#dashBody .db-tablewrap");
      return { quit: q.right <= innerWidth + 0.5 && q.bottom <= h.bottom + 0.5, brand: brand.scrollWidth <= brand.clientWidth + 1,
        oneRow: tabs.every((t) => Math.abs(t.top - tabs[0].top) < 2), table: wrap.scrollWidth <= wrap.clientWidth + 1 };
    });
    check(`⑥ ${tag} 見出しが 1 段で収まる（終了が窓の中・題が切れない）・表が横にはみ出さない`, fit.quit && fit.brand && fit.oneRow && fit.table, fit);
    if (big) {
      // ④ 条件
      await p.click('[data-db-cond="wip"]'); await sleep(300);
      const ed = await p.evaluate(() => { const e = document.querySelector("#dashBody .db-editor"), h = document.querySelector("#dashBody .db-head");
        return { open: !!e, below: e && h ? e.getBoundingClientRect().top >= h.getBoundingClientRect().bottom - 1 : false }; });
      check("④ 「仕掛の対象」を押すと、札のすぐ下に条件の欄が開く", ed.open && ed.below, ed);
      await p.selectOption('#dashBody .db-editor [data-f="column"]', "製造材質");
      await p.selectOption('#dashBody .db-editor [data-f="op"]', "eq");
      await p.fill('#dashBody .db-editor [data-f="value"]', "A1100");
      await p.click("#dashBody [data-db-save]"); await sleep(2500);
      const api2 = await p.evaluate(async () => (await fetch("/api/dashboard?part=wip")).json());
      const d2 = await read(p);
      check("④ 条件で保存すると、仕掛の計がサーバーの答えと合って減り、札に条件が出る",
        api2.wip.total < api.wip.total && d2.lotsTotal.includes(api2.wip.total.toLocaleString())
        && /製造材質/.test(await p.$eval('[data-db-cond="wip"]', (b) => b.textContent)), { before: api.wip.total, after: api2.wip.total, shown: d2.lotsTotal });
      await p.click('[data-db-cond="wip"]'); await sleep(300);
      await p.click("#dashBody .db-editor [data-db-del]");
      await p.click("#dashBody [data-db-save]"); await sleep(2500);
      check("④ 条件を外して保存すると、すべてに戻る", /すべて/.test(await p.$eval('[data-db-cond="wip"]', (b) => b.textContent)), "");
      // ⑤ 仕掛を開く
      await p.click("#dashBody [data-db-open]"); await sleep(3000);
      check("⑤ 「仕掛を開く ›」で仕掛のタブへ移る", (await p.evaluate(() => document.querySelector('[data-screen="src:wip"]').getAttribute("aria-selected"))) === "true", "");
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
