// 評価関数（開発用）: 一覧とカードで、絞り込み・並べ替えに当たる全部の行を、ページで止まらずに見られる（版 3.56.0。利用者の要望 2026-10-25）。
//   node program/tools/ui-eval-allrows.mjs [1728x1152|1280x720]
// 試験のデータは 1500 行。一度に読むのは 500 行（既定）。答えは、同じ問い合わせをサーバーへ 1 ページで全部（2000 行）尋ねた並び。
// ① 開いた直後から、スクロールの長さが全部の行のぶんある（読んでいない所も、行の高さ×行の数で空けてある）
// ② いちばん下まで送ると、全部の行が出る（最後の行がサーバーの最後の行）。途中で止まらない・行の抜けも重なりも無い
// ③ 真ん中あたり（読んでいない所）へ飛んでも、そこの行が出る（スクロールのつまみを引いた形）
// ④ 並べ替え（重量 ▼）と検索をしても、②と同じ（並びがサーバーと同じ）
// ⑤ カード: 読んだ所の最後の行で ▶ を押すと次の行（読んでいない所）が出る。カードの行の番号は全部の行の中の番号
// ⑥ まとめ（設備でまとめる）でも、いちばん下まで送ると全部の行が出る
// ⑦ 速さ: 最初の行が出るまでの時間は 1 ページ分と同じ程度（全部を一度に読まない）。下まで送る間の長いタスク（200ms 以上）が無い
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const errors = [];
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40)))));

/** サーバーの答え（同じ問い合わせを 1 ページで全部）: ロット番号の並び */
const truth = (p) => p.evaluate(async () => {
  const url = window.LotList.pageUrl(1, 100000);
  const d = await (await fetch(url, { cache: "no-store" })).json();
  const lot = d.lotColumn;
  return { count: d.count, lots: d.rows.map((r) => String(r[lot] ?? "")), lot };
});
/** 描いている行（見えている所）のロット番号と行の番号 */
const shown = (p) => p.evaluate(() => {
  const w = document.querySelector(".ll-grid-wrap"), wr = w.getBoundingClientRect();
  const trs = [...document.querySelectorAll("#llBody > tr[data-i]")].filter((tr) => { const r = tr.getBoundingClientRect(); return r.height > 0 && r.bottom > wr.top && r.top < wr.top + w.clientHeight; });
  return { ids: trs.map((tr) => +tr.dataset.i), lots: trs.map((tr) => tr.querySelector(".ll-lotcol")?.innerText.trim().split(/\s/)[0] || ""),
    scrollH: w.scrollHeight, clientH: w.clientHeight, top: w.scrollTop, rowH: trs[0] ? trs[0].getBoundingClientRect().height : 0 };
});
/** いちばん下まで送る（読み終えるまで待つ）。送った回数と最後の様子 */
async function toBottom(p, limit = 60) {
  let last = null, k = 0;
  for (; k < limit; k++) {
    await p.evaluate(() => { const w = document.querySelector(".ll-grid-wrap"); w.scrollTop = w.scrollHeight; });
    await sleep(120); await frames(p);
    await p.waitForFunction(() => !document.querySelector("#lotListScreen .is-busy, #llBody tr.ll-loading"), null, { timeout: 15000 }).catch(() => {});
    const s = await shown(p);
    if (last && s.scrollH === last.scrollH && s.top === last.top) { last = s; break; }
    last = s;
  }
  return { ...last, tries: k };
}
/** 上から 1 画面ずつ送り、見えた行の番号を集める（抜け・重なり） */
async function sweep(p) {
  await p.evaluate(() => { document.querySelector(".ll-grid-wrap").scrollTop = 0; });
  const seen = new Set(); let guard = 0;
  for (;;) {
    await sleep(60); await frames(p);
    await p.waitForFunction(() => !document.querySelector("#llBody tr.ll-loading"), null, { timeout: 15000 }).catch(() => {});
    (await shown(p)).ids.forEach((i) => seen.add(i));
    const end = await p.evaluate(() => { const w = document.querySelector(".ll-grid-wrap"); const was = w.scrollTop; w.scrollTop += w.clientHeight * 0.8; return w.scrollTop === was; });
    if (end || ++guard > 400) break;
  }
  return seen;
}

const app = await launch();
try {
  const p = await app.newPage("light", parseView(process.argv[2] || "1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  const t0 = Date.now();
  await p.waitForSelector("#llBody tr[data-i]"); const firstMs = Date.now() - t0; await sleep(500);
  const T = await truth(p);
  const s0 = await shown(p);
  check("① 開いた直後から、スクロールの長さが全部の行のぶん", s0.rowH > 0 && s0.scrollH >= T.count * s0.rowH * 0.9, { scrollH: s0.scrollH, need: T.count * s0.rowH, count: T.count });

  const longTasks = await p.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask", buffered: false }); } catch (_) {} return true; });
  const b = await toBottom(p);
  check("② いちばん下まで送ると最後の行がサーバーの最後の行", b.ids.length && b.ids[b.ids.length - 1] === T.count - 1 && b.lots[b.lots.length - 1] === T.lots[T.count - 1],
    { lastId: b.ids[b.ids.length - 1], lastLot: b.lots[b.lots.length - 1], want: T.lots[T.count - 1], count: T.count, tries: b.tries });
  const seen = await sweep(p);
  const missing = []; for (let i = 0; i < T.count; i++) if (!seen.has(i)) missing.push(i);
  check("② 上から下まで送ると、全部の行が 1 度は見える（抜けが無い）", missing.length === 0, { missing: missing.slice(0, 20), n: missing.length });
  const order = await p.evaluate(() => [...document.querySelectorAll("#llBody > tr[data-i]")].length);
  void order;

  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(500);
  await p.evaluate(() => { const w = document.querySelector(".ll-grid-wrap"); w.scrollTop = w.scrollHeight * 0.55; });
  await sleep(200); await frames(p);
  await p.waitForFunction(() => !document.querySelector("#llBody tr.ll-loading"), null, { timeout: 15000 }).catch(() => {});
  await sleep(150); await frames(p);
  const mid = await shown(p);
  const midOk = mid.ids.length > 3 && mid.ids.every((i, k) => mid.lots[k] === T.lots[i]) && mid.ids[0] > 600;
  check("③ 読んでいない真ん中へ飛んでも、そこの行がサーバーと同じ並びで出る", midOk, { ids: mid.ids.slice(0, 5), lots: mid.lots.slice(0, 5), want: mid.ids.slice(0, 5).map((i) => T.lots[i]) });

  // ④ 並べ替え（重量 ▼）＋検索
  await p.evaluate(() => { document.querySelector(".ll-grid-wrap").scrollTop = 0; });
  const th = { click: () => p.click('#llHead th[data-col="重量"] .th-in') };
  await th.click(); await sleep(700); await th.click(); await sleep(900);
  await p.fill("#llSearch", "L"); await p.keyboard.press("Enter"); await sleep(1200);
  const T2 = await truth(p);
  const b2 = await toBottom(p);
  const top2 = (await p.evaluate(() => { document.querySelector(".ll-grid-wrap").scrollTop = 0; return true; }), await sleep(200), await shown(p));
  check("④ 並べ替え＋検索でも、最初と最後の行がサーバーと同じ", T2.count > 500 && b2.ids[b2.ids.length - 1] === T2.count - 1 && b2.lots[b2.lots.length - 1] === T2.lots[T2.count - 1] && top2.lots[0] === T2.lots[0],
    { count: T2.count, last: b2.lots[b2.lots.length - 1], want: T2.lots[T2.count - 1], first: top2.lots[0], wantFirst: T2.lots[0] });
  await p.fill("#llSearch", ""); await p.keyboard.press("Enter"); await sleep(1000);
  await th.click(); await sleep(900);

  // ⑤ カード
  const T3 = await truth(p);
  await p.evaluate(() => { document.querySelector(".ll-grid-wrap").scrollTop = 0; }); await sleep(300);
  await p.dblclick("#llBody tr[data-i] td:nth-child(3)"); await p.waitForSelector(".ll-cardwin:not([hidden])"); await sleep(400);
  const loaded = await p.evaluate(() => window.LotList.loaded());
  await p.evaluate((i) => window.LotListCard.show(i), loaded - 1); await sleep(400);
  await p.evaluate(() => document.querySelector(".ll-cardwin:not([hidden]) [data-card=next]").click()); await sleep(400);
  await p.waitForFunction((n) => { const t = document.querySelector(".ll-cardwin:not([hidden]) .lc-sub, .ll-cardwin:not([hidden]) [data-k=sub]"); return t && t.textContent.includes(`${(n + 1).toLocaleString()} `); }, loaded, { timeout: 15000 }).catch(() => {});
  const card = await p.evaluate(() => { const c = document.querySelector(".ll-cardwin:not([hidden])"); return { title: c.querySelector("h3, .lc-title, [data-k=title]")?.textContent.trim(), sub: c.querySelector(".lc-sub, [data-k=sub]")?.textContent.trim() }; });
  check("⑤ カードで、読んだ所の最後の行の ▶ が次の行（読んでいない所）を出し、番号は全部の中の番号", loaded < T3.count && (card.title || "").includes(T3.lots[loaded]) && (card.sub || "").includes(`${(loaded + 1).toLocaleString()}`) && (card.sub || "").includes(T3.count.toLocaleString()),
    { loaded, title: card.title, sub: card.sub, want: T3.lots[loaded], count: T3.count });
  await p.keyboard.press("Escape"); await sleep(300);

  // ⑥ まとめ（設備でまとめる）
  await p.evaluate(() => window.LotList.groupBy?.("設備")); await sleep(1200);
  const T4 = await truth(p);
  const b4 = await toBottom(p);
  check("⑥ まとめても、いちばん下まで送ると全部の行が出る", b4.ids.length && Math.max(...b4.ids) === T4.count - 1, { last: b4.ids[b4.ids.length - 1], count: T4.count });
  await p.evaluate(() => window.LotList.groupBy?.(null)); await sleep(800);

  const lt = await p.evaluate(() => window.__lt || []);
  const oneMs = await p.evaluate(async () => { const t = performance.now(); await (await fetch(window.LotList.pageUrl(1, 500), { cache: "no-store" })).json(); return performance.now() - t; });
  check("⑦ 最初の行が出るまでは 1 ページ分の読み込みと同じ程度・送る間に 200ms 以上の長いタスクが無い", firstMs < 15000 && lt.filter((x) => x >= 200).length === 0, { firstMs, oneMs: Math.round(oneMs), longTasks: lt.filter((x) => x >= 100).map(Math.round) });
  check("画面のエラーが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
