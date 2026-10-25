// 評価関数（開発用）: 一覧の行を、見える分＋先行の分（合わせて約 3 ページ）だけ描く作り（版 3.24.0）。
//   node program/tools/ui-eval-virtual.mjs
// 1. 描く行の数: 500 行の頁でも、描くのは見える分の約 3 倍まで（上に 1 ページ・見える分・下に 1 ページ）
// 2. 隙間なく出る: 上・1/4・真ん中・3/4・いちばん下で、見えている所が行で埋まり、行は元の順に続く。いちばん下で最後の行が見える
// 3. 1/3 ページずつ下まで送ると、全部の行が 1 度は見える（抜けも重なりも無い）。表の高さは行の数×行の高さ
// 4. 縞（1 行おきの地の色）が行の番号で決まる（描く範囲が動いても縞がずれない）
// 5. 左に固定した列は、横に送っても左に貼り付いたまま
// 6. 拡大 150% でも 2 と同じ
// 7. まとめ（見出しあり）: 1 つ畳むと中の行が消えて次の見出しが続く。キーボードで押してもフォーカスが残る。全部畳む → 見出しだけ・全部開く → 戻る
// 8. 作業実績: ＋n を押すと分割したロットの行がすぐ下に出て、もう 1 度で消える
// 9. カード: 描いていない所の行（下の方）をカードで出すと、その行まで送って印を付ける
// 10. 重さ（表示するだけ）: 一覧のセルの数・4 倍遅い CPU でホイールで送ったときの長いタスク
// 11. 集計表・グラフ、転写計算のタブから一覧へ戻ると、2 と同じ（隠している間に崩れない）
// 全部合えば終了コード 0。
import { launch, openActive, sleep } from "./ui-harness.mjs";

const ARR_HEADS = { "仕掛": { levels: [{ column: "設備", dir: "asc", lot: false }, { column: "不良名", dir: "asc", lot: false }], heads: true, suppress: true } };
const app = await launch();
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

/** いま見えている所: 行（見出し行も）が隙間なく埋めているか・順・最初と最後の行 */
const view = (p) => p.evaluate(() => {
  const w = document.querySelector(".ll-grid-wrap"), wr = w.getBoundingClientRect();
  // 見出しは th が貼り付く（thead の箱は動く）。下の端は、行が見える所の下端か表の終わりの上の方
  const th = document.querySelector("#llHead tr:last-child th"), body = document.querySelector("#llBody").getBoundingClientRect();   // 見出しの下の段（版 3.45.0 から値で絞る段）まで
  const top = Math.max(wr.top, th ? th.getBoundingClientRect().bottom : wr.top), bottom = Math.min(wr.top + w.clientHeight, body.bottom);
  const trs = [...document.querySelectorAll("#llBody > tr")].filter((tr) => !tr.hidden && (tr.dataset.i != null || tr.classList.contains("ll-ghead")));
  const rects = trs.map((tr) => ({ tr, r: tr.getBoundingClientRect() })).filter((x) => x.r.height > 0);
  const inView = rects.filter((x) => x.r.bottom > top + 0.5 && x.r.top < bottom - 0.5);
  let y = top, gap = 0;
  for (const x of inView) { if (x.r.top > y + 1) gap = Math.max(gap, x.r.top - y); y = Math.max(y, x.r.bottom); }
  if (y < bottom - 1) gap = Math.max(gap, bottom - y);
  const ids = inView.map((x) => (x.tr.dataset.i != null ? +x.tr.dataset.i : `g${x.tr.dataset.g}`));
  const nums = ids.filter((v) => typeof v === "number");
  return { rendered: trs.filter((tr) => tr.dataset.i != null).length, heads: trs.filter((tr) => tr.classList.contains("ll-ghead")).length,
    gap: Math.round(gap), ids, first: nums[0], last: nums[nums.length - 1], rowH: rects.length ? rects.find((x) => x.tr.dataset.i != null)?.r.height : 0,
    viewH: bottom - top, scrollH: w.scrollHeight, scrollTop: w.scrollTop, clientH: w.clientHeight,
    atEnd: w.scrollTop + w.clientHeight >= w.scrollHeight - 2, tds: document.querySelectorAll("#llBody td").length };
});
const scrollTo = async (p, frac) => { await p.evaluate((f) => { const w = document.querySelector(".ll-grid-wrap"); w.scrollTop = f * (w.scrollHeight - w.clientHeight); }, frac); await frames(p); await frames(p); };
// 読んだ行の数（版 3.56.0 から頁の送りは無く、送れば続きを読み足す。ここでは一度に 2000 行を読む設定で、試験の 1500 行を全部読んだ形を見る。
// 読み足しそのものは ui-eval-allrows.mjs）
const total = (p) => p.evaluate(() => window.LotList.loaded());
/** 送る範囲のどこでも隙間が無く、順に続く（まとめていないとき）か */
async function sweep(p, label, { ordered = true } = {}) {
  const out = [];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    await scrollTo(p, f);
    const v = await view(p);
    const seq = !ordered || v.ids.every((x, k) => k === 0 || x === v.ids[k - 1] + 1);
    out.push({ f, gap: v.gap, seq, first: v.first, last: v.last, rendered: v.rendered, atEnd: v.atEnd });
  }
  return out;
}

try {
  const p = await app.newPage("light");
  await p.evaluate(() => localStorage.setItem("tpa.lotlist.pageSize.v1", "2000")); await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  const n = await total(p);
  // 1. 描く行の数
  await scrollTo(p, 0.5);
  const mid = await view(p);
  const pageRows = Math.ceil(mid.viewH / mid.rowH);
  console.log(`    ${n} 行の頁・1 ページ ${pageRows} 行（行の高さ ${mid.rowH.toFixed(1)}px）・描いている行 ${mid.rendered}・セル ${mid.tds}`);
  check("描く行は見える分の約 3 倍まで（上に 1 ページ・見える分・下に 1 ページ）", mid.rendered <= pageRows * 3 + 6 && mid.rendered >= pageRows, { rendered: mid.rendered, pageRows, n });

  // 2. 隙間なく出る・順に続く・いちばん下で最後の行
  const s = await sweep(p, "100%");
  check("上・1/4・真ん中・3/4・下で、見えている所が行で埋まり、行が元の順に続く", s.every((x) => x.gap <= 1 && x.seq), s);
  check("いちばん下までで、最後の行が見える", s[4].last === n - 1 && s[4].atEnd, s[4]);
  const headH = await p.$eval("#llHead th", (h) => h.getBoundingClientRect().height);
  check("表の高さは 行の数×行の高さ（見出しの分を除いて ±1%）", Math.abs(mid.scrollH - headH - n * mid.rowH) <= n * mid.rowH * 0.01, { scrollH: mid.scrollH, headH, want: n * mid.rowH });

  // 3. 1/3 ページずつ送って全部の行が見える
  await scrollTo(p, 0);
  const seen = new Set();
  for (let k = 0; k < 400; k++) {
    const v = await view(p);
    v.ids.forEach((i) => seen.add(i));
    if (v.atEnd) break;
    await p.evaluate((d) => { document.querySelector(".ll-grid-wrap").scrollTop += d; }, Math.round(v.viewH / 3));
    await frames(p);
  }
  check("1/3 ページずつ下まで送ると、全部の行が 1 度は見える", seen.size === n, { seen: seen.size, n });

  // 4. 縞
  await scrollTo(p, 0.37);
  const stripes = await p.evaluate(() => {
    const trs = [...document.querySelectorAll("#llBody tr[data-i]")];
    const bg = (tr) => getComputedStyle(tr.children[2]).backgroundColor;
    const odd = new Set(trs.filter((tr) => +tr.dataset.i % 2 === 1).map(bg)), even = new Set(trs.filter((tr) => +tr.dataset.i % 2 === 0).map(bg));
    return { odd: [...odd], even: [...even] };
  });
  check("縞が行の番号で決まる（奇数の行どうし・偶数の行どうしで同じ色、両者は違う）", stripes.odd.length === 1 && stripes.even.length === 1 && stripes.odd[0] !== stripes.even[0], stripes);

  // 5. 左に固定した列
  const stick = await p.evaluate(async () => {
    const w = document.querySelector(".ll-grid-wrap"); w.scrollLeft = 300;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const td = [...document.querySelectorAll("#llBody tr[data-i]")].find((tr) => tr.getBoundingClientRect().top > w.getBoundingClientRect().top + 60)?.children[0];
    const d = td ? td.getBoundingClientRect().left - w.getBoundingClientRect().left : null; w.scrollLeft = 0; return d;
  });
  check("左に固定した列は、横に送っても左に貼り付いたまま", stick != null && Math.abs(stick) <= 2, stick);

  // 6. 拡大 150%
  await p.evaluate(() => { const r = document.querySelector("#llZoomRange"); r.value = 150; r.dispatchEvent(new Event("input")); });
  await frames(p);
  const z = await sweep(p, "150%");
  check("拡大 150% でも、見えている所が行で埋まり、順に続き、最後の行まで見える", z.every((x) => x.gap <= 1 && x.seq) && z[4].last === n - 1, z);
  await p.evaluate(() => { const r = document.querySelector("#llZoomRange"); r.value = 100; r.dispatchEvent(new Event("input")); });

  // 10. 重さ（4 倍遅い CPU・ホイールで送る）
  const cdp = await p.context().newCDPSession(p);
  await scrollTo(p, 0);
  await p.evaluate(() => { window.__long = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__long += e.duration; })).observe({ entryTypes: ["longtask"] }); });
  await p.mouse.move(800, 600);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  for (let k = 0; k < 30; k++) { await p.mouse.wheel(0, 400); await sleep(60); }
  await sleep(500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const heavy = await p.evaluate(() => Math.round(window.__long));
  console.log(`    4 倍遅い CPU でホイール 30 回（400px ずつ）: 長いタスク 合計 ${heavy}ms`);

  // 9. カード
  await scrollTo(p, 0);
  const far = n - 20;
  await p.evaluate((i) => window.LotListCard.show(i), far); await frames(p); await sleep(300);
  const card = await p.evaluate((i) => {
    const tr = document.querySelector(`#llBody tr[data-i="${i}"]`), w = document.querySelector(".ll-grid-wrap");
    if (!tr) return { found: false };
    const r = tr.getBoundingClientRect(), wr = w.getBoundingClientRect();
    return { found: true, carded: tr.classList.contains("is-carded"), inView: r.top >= wr.top - 1 && r.bottom <= wr.top + w.clientHeight + 1 };
  }, far);
  check("描いていない所の行をカードで出すと、その行まで送って印を付ける", card.found && card.carded && card.inView, card);
  await p.keyboard.press("Escape");
  for (let k = 0; k < 4; k++) { const x = await p.$(".lk-card [data-card=close]"); if (!x) break; await x.click().catch(() => {}); await sleep(150); }

  // 11. 隠して戻る: 集計表・グラフ → 一覧、転写計算のタブ → 一覧（隠している間に描いた・測った物で崩れない）
  await scrollTo(p, 0.6);
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await sleep(800);
  await p.click('#llViewSwitch [data-pv-view="list"]'); await frames(p); await sleep(300);
  const back1 = await view(p);
  await p.click("#tabCalc"); await sleep(500); await p.click("#tabList"); await frames(p); await sleep(500);
  const back2 = await view(p);
  check("集計表・転写計算から一覧へ戻ると、見えている所が行で埋まり、順に続く", [back1, back2].every((v) => v.gap <= 1 && v.rendered > 0 && v.ids.every((x, k) => k === 0 || x === v.ids[k - 1] + 1)),
    [back1, back2].map((v) => ({ gap: v.gap, rendered: v.rendered, first: v.first, last: v.last })));

  // 7. まとめ（見出しあり）
  await p.evaluate(async (a) => { TPA.local.set("tpa.lotlist.arrange.v1", a); await TPA.saveUiState?.(); }, ARR_HEADS);
  await p.reload(); await p.waitForSelector("#llBody tr.ll-ghead"); await sleep(800);
  const g0 = await view(p);
  const gs = await sweep(p, "grouped", { ordered: false });
  check("まとめ（見出しあり）でも、どこでも見えている所が埋まる", gs.every((x) => x.gap <= 1), gs);
  await scrollTo(p, 0);
  const fold = await p.evaluate(async () => {
    const h = document.querySelector("#llBody tr.ll-ghead[data-depth='0']"), g = h.dataset.g;
    const inside = () => [...document.querySelectorAll(`#llBody tr[data-anc~="${g}"]`)].filter((tr) => !tr.hidden).length;
    const before = inside();
    h.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const h2 = document.querySelector(`#llBody tr.ll-ghead[data-g="${g}"]`);
    let next = h2?.nextElementSibling; while (next && next.hidden) next = next.nextElementSibling;   // 畳んだ行を DOM に残す作りでも、見える次の行
    const after = inside();
    h2.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { before, after, nextIsHead: !!next && next.classList.contains("ll-ghead") && next.dataset.depth === "0", reopened: inside() };
  });
  check("見出しを 1 つ畳むと中の行が消え、すぐ下に次の見出しが続く。もう 1 度で戻る", fold.before > 0 && fold.after === 0 && fold.nextIsHead && fold.reopened === fold.before, fold);
  // キーボードで ▾ を押しても、フォーカスは同じボタンに残る（描き直しで消えたボタンから外れない）。2 回で元に戻る
  await p.focus("#llBody tr.ll-ghead .ll-gtog");
  const g1 = await p.evaluate(() => document.activeElement.closest("tr").dataset.g);
  await p.keyboard.press("Enter"); await frames(p);
  const kb1 = await p.evaluate(() => ({ g: document.activeElement.closest?.("tr.ll-ghead")?.dataset.g, open: document.activeElement.closest?.("tr.ll-ghead")?.getAttribute("aria-expanded") }));
  await p.keyboard.press("Enter"); await frames(p);
  const kb2 = await p.evaluate(() => ({ g: document.activeElement.closest?.("tr.ll-ghead")?.dataset.g, open: document.activeElement.closest?.("tr.ll-ghead")?.getAttribute("aria-expanded") }));
  check("キーボードで ▾ を押しても、フォーカスが同じ見出しのボタンに残る", kb1.g === g1 && kb1.open === "false" && kb2.g === g1 && kb2.open === "true", { g1, kb1, kb2 });
  await openActive(p, "group"); await p.click('#llGroupBar [data-gall="0"]'); await frames(p);
  const shut = await view(p);
  const shutRows = await p.$$eval("#llBody tr[data-i]", (x) => x.filter((tr) => !tr.hidden && tr.getBoundingClientRect().height > 0 && !tr.closest("tr.ll-ghead")).length);
  await openActive(p, "group"); await p.click('#llGroupBar [data-gall="1"]'); await frames(p);
  await p.keyboard.press("Escape");
  const opened = await view(p);
  check("全部畳む → 見える所は見出しと 1 行だけのまとまり・全部開く → 元の行が戻る", shut.gap <= 1 && shut.heads > 0 && shut.ids.filter((x) => typeof x === "string").length >= shut.ids.length / 2 && opened.rendered >= g0.rendered - 2,
    { heads: shut.heads, shown: shut.ids.length, shutRows, opened: opened.rendered, before: g0.rendered });

  // 8. 作業実績
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  await p.click('[data-wk-mode="day"]'); await sleep(1500);   // 作業でまとめる（日ごと）にすると、分割したロットを畳んで「＋n」を出す
  const wk = await p.evaluate(async () => {
    const b = document.querySelector("#llBody .wk-plus"); if (!b) return { none: true };
    const k = b.dataset.wkOpen, n = +b.textContent.replace(/[^0-9]/g, "");
    const subs = () => [...document.querySelectorAll(`#llBody tr[data-wk-of="${CSS.escape(k)}"]`)].filter((tr) => !tr.hidden);
    const row = b.closest("tr"), i = +row.dataset.i;
    b.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const open = subs(); let next = document.querySelector(`#llBody tr[data-i="${i}"]`)?.nextElementSibling;
    while (next && next.hidden) next = next.nextElementSibling;
    document.querySelector(`#llBody tr[data-i="${i}"] .wk-plus`).click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { n, open: open.length, follows: !!next && next.dataset.wkOf === k, closed: subs().length };
  });
  check("作業実績: ＋n で分割したロットの行がすぐ下に出て、もう 1 度で消える", !wk.none && wk.open === wk.n && wk.follows && wk.closed === 0, wk);
  const ws = await sweep(p, "work", { ordered: false });
  check("作業実績でも、どこでも見えている所が埋まり、最後まで見える", ws.every((x) => x.gap <= 1) && ws[4].atEnd, ws);
} catch (e) {
  console.error(e); fails.push(String(e));
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
