// 評価関数（開発用）: カードの設計（版 3.55.0。利用者の要望 2026-10-25「Access のフォームのようなカード」）。
//   node program/tools/ui-eval-cardform.mjs [1728x1152|1536x864|1280x720]
// ① カードを開くと、組み込みの「標準」で項目が方眼に並ぶ（デザインの選び）
// ② 「デザインを直す」で、見た目の大きさのまま直す画面になる（項目の位置と大きさが直す前と同じ）
// ③ 四隅の取っ手（右下）を左へ 1 升引くと幅が 1 減る・Ctrl＋Z で戻る／掴んでほかの項目の上へ動かすと置けない（形は変わらない）
// ④ 項目をダブルクリック → 項目の面がカードの外（左か右）に開き、線で項目と結ぶ・窓に収まる
// ⑤ 面で名前を変える → カードの項目の名前がその場で変わる／字の大きさ「特大」→ 項目に fs-xl
// ⑥ 「＋ 項目」→ 組み合わせた項目（式）→ 式 [合金] + ' / ' + [調質] → いまの行の値「合金 / 調質」が出る
// ⑤ 名前と値の置き方は 8 通り（上・下・左・両端・枠の上・札・続ける・出さない）。見本の札で選ぶと項目に当たり、名前と値の並びが合い、
//   項目の中に収まる（枠の上は名前が枠の線に乗る）・見本の札の字が切れない
// ⑦ 見栄え: 詰め具合「詰める」→ 方眼に cfv-d-compact／名前と値の置き方を全部の項目に当てる（8 通りとも 1 段の値が「…」で切れず 2 段に折れない）
// ⑧ 名前を付けて保存（自分だけ・★標準）→ 開き直してカードを開くと、そのデザインが当たる（組み合わせた項目・名前・字の大きさ）
// ⑨ デザインを消す → 組み込みの標準に戻る・サーバーにも残らない
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const W = ".ll-cardwin:not([hidden])";
const NAME = "評価のカード";
const boxes = (p) => p.$$eval(`${W} .cfv-i`, (xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [x.dataset.id, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }));
const itemOf = (p, id) => p.evaluate((id) => { const x = document.querySelector(`.ll-cardwin:not([hidden]) .cfv-i[data-id="${CSS.escape(id)}"]`); if (!x) return null;
  const r = x.getBoundingClientRect(); return { col: x.style.gridColumn, row: x.style.gridRow, cls: x.className, label: x.querySelector(".cfv-l")?.textContent || "", value: x.querySelector(".cfv-v")?.textContent || "", r: [r.left, r.top, r.width, r.height] }; }, id);
const choose = (p, text) => p.evaluate((t) => [...document.querySelectorAll(".tpa-menu button:not(:disabled)")].find((b) => b.textContent.includes(t)).click(), text);
const openCard = async (p) => { await p.dblclick("#llBody tr[data-i] td:nth-child(3)"); await p.waitForSelector(`${W} .cfv-i`); await sleep(500); };
const app = await launch();
try {
  const p = await app.newPage("light", parseView(process.argv[2] || "1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  await p.evaluate(() => { localStorage.removeItem("tpa.lotlist.cardForm.v1"); });
  await openCard(p);
  const pick = await p.$eval(`${W} [data-cf=pick]`, (s) => s.selectedOptions[0].textContent);
  const n0 = (await boxes(p)).length;
  check("① カードを開くと組み込みの標準で項目が並ぶ", pick.startsWith("標準") && n0 >= 6, { pick, n0 });

  const before = await boxes(p);
  await p.click(`${W} [data-cf=edit]`); await sleep(400);
  const after = await boxes(p);
  const same = before.length === after.length && before.every((b, i) => b[0] === after[i][0] && b.slice(1).every((v, j) => Math.abs(v - after[i][j + 1]) <= 2));
  check("② 直す画面でも項目の位置と大きさが同じ", same && (await p.$(`${W} .cfv.is-edit`)) != null, { before: before.slice(0, 4), after: after.slice(0, 4) });

  const ids = after.map((b) => b[0]), id4 = ids[3];
  const it0 = await itemOf(p, id4);
  await p.click(`${W} .cfv-i[data-id="${id4}"]`); await sleep(200);
  const h = await (await p.$(`${W} .cfv-i[data-id="${id4}"] .cfv-rz[data-rz="se"]`)).boundingBox();
  const cw = (it0.r[2] + 8) / Number(/span (\d+)/.exec(it0.col)[1]);
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
  await p.mouse.move(h.x + h.width / 2 - cw * 0.6, h.y + h.height / 2, { steps: 4 }); await p.mouse.move(h.x + h.width / 2 - cw, h.y + h.height / 2, { steps: 4 }); await sleep(100);
  const ghost = await p.$eval(`${W} .cfv-ghost`, (g) => g.textContent).catch(() => "");
  await p.mouse.up(); await sleep(300);
  const it1 = await itemOf(p, id4);
  const span = (s) => Number(/span (\d+)/.exec(s)[1]);
  check("③ 右下の取っ手を左へ 1 升 → 幅が 1 減る（引く間は大きさの影）", span(it1.col) === span(it0.col) - 1 && /×/.test(ghost), { it0: it0.col, it1: it1.col, ghost });
  await p.keyboard.press("Control+z"); await sleep(300);
  check("③ Ctrl＋Z で戻る", (await itemOf(p, id4)).col === it0.col, await itemOf(p, id4));
  const a = await itemOf(p, ids[0]), b = await itemOf(p, ids[1]);
  await p.mouse.move(a.r[0] + 30, a.r[1] + 20); await p.mouse.down();
  await p.mouse.move(b.r[0] + 30, b.r[1] + 20, { steps: 8 }); await sleep(100);
  const bad = await p.$eval(`${W} .cfv-ghost`, (g) => g.classList.contains("is-bad")).catch(() => false);
  await p.mouse.up(); await sleep(300);
  check("③ ほかの項目の上へは置けない（影が赤・形は変わらない）", bad && (await itemOf(p, ids[0])).col === a.col && (await itemOf(p, ids[0])).row === a.row, { bad, a: a.col, now: (await itemOf(p, ids[0])).col });

  const el4 = await p.$(`${W} .cfv-i[data-id="${id4}"]`);
  const r4 = await el4.boundingBox();
  await p.mouse.dblclick(r4.x + r4.width / 2, r4.y + r4.height / 2); await sleep(400);
  const sd = await p.evaluate(() => {
    const s = document.querySelector(".cf-side"), c = document.querySelector(".ll-cardwin:not([hidden])"), l = document.querySelector(".cf-link");
    if (!s) return null;
    const a = s.getBoundingClientRect(), b = c.getBoundingClientRect();
    return { out: a.right <= b.left + 1 || a.left >= b.right - 1, fit: a.left >= 0 && a.top >= 0 && a.right <= innerWidth && a.bottom <= innerHeight, link: !!l && !l.hidden && l.getBoundingClientRect().width > 0, head: s.querySelector("header b").textContent };
  });
  check("④ ダブルクリックで項目の面がカードの外に開き、線で結ぶ・窓に収まる", sd && sd.out && sd.fit && sd.link, sd);

  await p.fill(".cf-side [data-sd=label]", "重さ（kg）"); await sleep(300);
  check("⑤ 名前を変えるとカードの項目の名前がその場で変わる", (await itemOf(p, id4)).label.includes("重さ（kg）"), await itemOf(p, id4));
  await p.click('.cf-side [data-st=fs][data-v=xl]'); await sleep(300);
  check("⑤ 字の大きさ「特大」が項目に当たる", /\bfs-xl\b/.test((await itemOf(p, id4)).cls), (await itemOf(p, id4)).cls);

  const KS = ["top", "bottom", "left", "spread", "legend", "tag", "inline", "none"];
  const tiles = await p.$$eval(".cf-side .cf-lp", (bs) => bs.map((b) => { const c = b.querySelector(".cfv-i").getBoundingClientRect();
    const cut = [...b.querySelectorAll(".cfv-l,.cfv-v,em")].some((x) => { const r = x.getBoundingClientRect(); return x.scrollWidth > x.clientWidth + 1 || (x.tagName !== "EM" && (r.right > c.right + 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1)); });
    return [b.dataset.v, cut]; }));
  check("⑤ 置き方の見本の札が 8 つ・字が切れない", tiles.length === 8 && tiles.every((t, i) => t[0] === KS[i] && !t[1]), tiles);
  const placed = [];
  for (const k of KS) {
    await p.click(`.cf-side [data-st=lab][data-v="${k}"]`); await sleep(200);
    placed.push(await p.evaluate(([id, k]) => {
      const x = document.querySelector(`.ll-cardwin:not([hidden]) .cfv-i[data-id="${CSS.escape(id)}"]`), r = x.getBoundingClientRect(), l = x.querySelector(".cfv-l"), v = x.querySelector(".cfv-v").getBoundingClientRect();
      const lr = l && l.getBoundingClientRect();
      const inside = v.left >= r.left - 1 && v.right <= r.right + 1 && v.top >= r.top - 1 && v.bottom <= r.bottom + 1;
      const lab = !l ? k === "none" : k === "legend" ? lr.top < r.top && lr.bottom > r.top : lr.left >= r.left - 1 && lr.right <= r.right + 1 && lr.top >= r.top - 1 && lr.bottom <= r.bottom + 1;
      const order = !l ? true : k === "bottom" ? lr.top >= v.bottom - 2 : ["left", "spread", "tag", "inline"].includes(k) ? lr.right <= v.left + 2 : lr.bottom <= v.top + 2;
      return { k, cls: x.classList.contains(`lab-${k}`), inside, lab, order };
    }, [id4, k]));
  }
  const okP = (x) => x.cls && x.inside && x.lab && x.order;
  check("⑤ 8 通りの置き方が項目に当たり、名前と値の並びが合い、項目の中に収まる", placed.every(okP), placed.filter((x) => !okP(x)));
  await p.click('.cf-side [data-st=lab][data-v="top"]'); await sleep(200);

  const row = await p.evaluate(() => { const c = document.querySelector(".ll-cardwin:not([hidden])"); const t = [...c.querySelectorAll(".cfv-i")]; const v = (n) => t.find((x) => x.querySelector(".cfv-l")?.textContent.trim() === n)?.querySelector(".cfv-v")?.textContent.trim(); return { al: v("合金"), tp: v("調質") }; });
  await p.click(`${W} [data-cf=add]`); await sleep(200);
  await choose(p, "組み合わせた項目"); await sleep(400);
  await p.fill(".cf-side [data-sd=expr]", "[合金] + ' / ' + [調質]"); await sleep(400);
  const combo = await p.evaluate(() => { const s = [...document.querySelectorAll(".ll-cardwin:not([hidden]) .cfv-i.k-combo")].pop(); return s ? s.querySelector(".cfv-v").textContent.trim() : null; });
  check("⑥ 組み合わせた項目（式）の値がいまの行の値", combo === `${row.al} / ${row.tp}`, { combo, row });

  await p.click(`${W} [data-cf=look]`); await sleep(200);
  await p.click(".cf-look [data-lk=density][data-v=compact]"); await sleep(300);
  check("⑦ 見栄えの詰め具合が方眼に当たる", (await p.$(`${W} .cfv.cfv-d-compact`)) != null, "");
  await p.click('.cf-look [data-lk=lab][data-v="spread"]'); await sleep(300);
  const notAll = await p.$$eval(`${W} .cfv-i:is(.k-field,.k-combo)`, (xs) => xs.filter((x) => !x.classList.contains("lab-spread")).length);
  const broken = [];
  for (const k of KS) {     // どの置き方を全部に当てても、1 段の項目の値は「…」で切れず、2 段に折れない（入らなければ字を小さくする）
    await p.click(`.cf-look [data-lk=lab][data-v="${k}"]`); await sleep(250);
    broken.push(...(await p.evaluate((k) => [...document.querySelectorAll(".ll-cardwin:not([hidden]) .cfv-i:not(.is-tall):not(.k-section) .cfv-v")].filter((v) => {
      const lh = parseFloat(getComputedStyle(v).lineHeight) || parseFloat(getComputedStyle(v).fontSize) * 1.3;
      return v.getBoundingClientRect().height > lh * 1.5 || v.scrollWidth > v.clientWidth + 1; }).map((v) => `${k}: ${v.textContent}`), k)));
  }
  await p.click('.cf-look [data-lk=lab][data-v="top"]'); await sleep(300);
  check("⑦ 名前と値の置き方を全部の項目に当てる", notAll === 0, notAll);
  check("⑦ どの置き方でも 1 段の値が切れず・折れない", broken.length === 0, broken);
  await p.keyboard.press("Escape"); await sleep(150);

  await p.click(`${W} [data-cf=save]`); await sleep(200);
  await choose(p, "名前を付けて保存"); await sleep(300);
  await p.fill(".cf-saveas [data-sv=name]", NAME);
  await p.check('.cf-saveas input[name=cfsc][value="me"]');
  await p.check(".cf-saveas [data-sv=std]");
  await p.click(".cf-saveas [data-sv=ok]"); await sleep(800);
  const saved = await p.evaluate(async (n) => { const k = document.querySelector(".ll-cardwin:not([hidden]) [data-cf=edit], .ll-cardwin:not([hidden]) .cf-name"); return k ? k.textContent : ""; }, NAME);
  check("⑧ 名前を付けて保存すると直している名前が替わる", saved.includes(NAME), saved);
  await p.click(`${W} [data-cf=done]`); await sleep(400);

  await p.evaluate(() => { localStorage.removeItem("tpa.lotlist.cardForm.v1"); });    // 選びの覚えを消しても ★標準が当たる
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  await openCard(p);
  const re = await p.evaluate(() => {
    const c = document.querySelector(".ll-cardwin:not([hidden])");
    return { pick: c.querySelector("[data-cf=pick]").selectedOptions[0].textContent, combo: c.querySelector(".cfv-i.k-combo .cfv-v")?.textContent.trim(),
      heavy: [...c.querySelectorAll(".cfv-i.fs-xl .cfv-l")].map((x) => x.textContent.trim()), compact: !!c.querySelector(".cfv.cfv-d-compact") };
  });
  check("⑧ 開き直すと★標準のデザインが当たる（式・名前・字の大きさ・見栄え）", re.pick.startsWith(NAME) && re.combo === combo && re.heavy.some((x) => x.includes("重さ（kg）")) && re.compact, re);

  await p.click(`${W} [data-cf=edit]`); await sleep(300);
  await p.click(`${W} [data-cf=save]`); await sleep(200);
  await choose(p, "このデザインを消す"); await sleep(800);
  const gone = await p.evaluate(async (n) => {
    const src = document.querySelector(".ll-cardwin:not([hidden]) [data-cf=pick]").selectedOptions[0].textContent;
    const r = await fetch("/api/card-forms?source=" + encodeURIComponent("card:lotlist:"), { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    const all = await fetch("/api/card-forms", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    return { pick: src, left: [...(r.items || []), ...(all.items || [])].filter((x) => x.name === n).length };
  }, NAME);
  check("⑨ 消すと組み込みの標準に戻り、サーバーにも残らない", gone.pick.startsWith("標準") && gone.left === 0, gone);
  check("画面のエラーが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
