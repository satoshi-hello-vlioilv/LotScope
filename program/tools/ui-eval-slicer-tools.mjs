// 評価関数（開発用）: スライサーの操作（版 3.30.0。7 案＋2 回目で選んだ M3: ui-proposals/2026-10-slicer-tools*）。
//   node program/tools/ui-eval-slicer-tools.mjs [画像を置くフォルダ]
// 利用者の要望: スライサーにした項目の並び変更・0 件の非表示・全選択／全解除・1 つだけ選ぶ方式と今の方式の切り替え・幅の変更・拡大縮小。
// ① 面の頭が 1 行に収まる（スライサー・🔍・左右上・×。既定の幅 280px・1728×1152 と 1536×864）
// ② （すべて）: 見えている値を全部選ぶ → 件数＝選んだ値の件数の和。もう一度で全部外す。値を探すで絞ると、合う値だけを選ぶ
// ③ 1 つだけ選ぶ（⋯）: ◉ の印・押すとその値だけ・もう一度で選ばない・いくつでも → 1 つだけ で選んでいた値は先頭の 1 つ
// ④ 0 件の値を隠す（⋯）: 0 件の値が消え「0 件 N 個を隠しています 出す」。選んでいる 0 件の値は隠さない。出すで戻る
// ⑤ 並び: ⋮⋮ を引いて 2 枚目を先頭へ・⋯ の「下へ」。覚えにも同じ並び
// ⑥ 幅: 境目を引くと広がる・選んで → で 20px・2 回押すと既定（280px）。右に置くと左へ引いて広がる・上に置くと高さ
// ⑦ 字の大きさ: 🔍 の ＋ 2 回で 120%（カードに zoom 1.2）・100% に戻す。読み直しても残る
// ⑧ 選び方・0 件を隠すは、共有の書式・保存した見方に運ぶ形（setupOf）に入る。読み直しても残る・頁の誤りが無い
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep, walk } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 800)}`}`); if (!ok) fails.push(name); };
const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: path.join(SHOT, `${name}.png`) }); };
const CARD = (c) => `#llSlicer .sx-card[data-col="${c}"]`;
const idle = (p) => p.waitForFunction(() => !document.querySelector(".ll-screen.is-loading") && !document.querySelector("#llSlicer .sx-wait"), null, { timeout: 15000 }).then(() => sleep(500));
const card = (p, c) => p.$eval(CARD(c), (el) => ({
  vals: [...el.querySelectorAll(".sx-v:not([data-all])")].filter((b) => !b.hidden).map((b) => ({ v: b.dataset.v, n: +b.dataset.n, on: b.getAttribute("aria-pressed") === "true", one: !!b.querySelector(".sx-mk.is-one") })),
  all: el.querySelector("[data-all]") ? { text: el.querySelector("[data-all]").textContent.replace(/\s+/g, ""), cls: el.querySelector("[data-all] .sx-mk").className } : null,
  zero: el.querySelector(".sx-zero")?.textContent || "" }));
const store = (p) => p.evaluate(() => TPA.local.get("tpa.lotlist.slicer.v1", {}));
const count = (p) => p.evaluate(() => +((document.querySelector("#llCount")?.textContent || "").replace(/[^\d]/g, "") || 0));
const menu = async (p, c, act) => { await p.click(`${CARD(c)} [data-menu]`); await p.waitForSelector(".sx-menu"); await p.click(`.sx-menu [data-act="${act}"]`); await sleep(300); await idle(p); };
const headFits = (p) => p.evaluate(() => {
  const h = document.querySelector("#llSlicer .sx-head"), pane = document.querySelector("#llSlicer").getBoundingClientRect();
  const kids = [...h.children].map((x) => x.getBoundingClientRect());
  // 1 行: 部品の高さが違っても、どれも同じ帯に重なる（いちばん下の上端 < いちばん上の下端）
  const one = Math.max(...kids.map((r) => r.top)) < Math.min(...kids.map((r) => r.bottom));
  return { rows: one ? 1 : 2, inside: kids.every((r) => r.right <= pane.right - 4 && r.left >= pane.left), w: Math.round(pane.width) };
});

const app = await launch();
try {
  for (const view of [{ width: 1536, height: 864 }, { width: 1728, height: 1152 }]) {
    const big = view.width === 1728;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await walk(p, async () => {}, ["slicer"]);
    await idle(p);
    const h = await headFits(p);
    check(`${view.width}×${view.height}: 面の頭が 1 行に収まる（幅 ${h.w}px）`, h.rows === 1 && h.inside && h.w === 280, h);
    if (!big) { check("頁の誤りが無い（1536×864）", !errors.length, errors); continue; }
    await shot(p, "slicer");
    // ② （すべて）
    await p.click(`${CARD("設備")} [data-clr]`).catch(() => {}); await idle(p);
    await p.click(`${CARD("設備")} [data-all]`); await idle(p);
    let c = await card(p, "設備");
    const sum = c.vals.filter((x) => x.on).reduce((n, x) => n + x.n, 0);
    check("（すべて）で見えている値を全部選び、件数＝選んだ値の件数の和", c.vals.every((x) => x.on) && c.all.cls.includes("is-on") && (await count(p)) === sum, { c, count: await count(p), sum });
    await p.click(`${CARD("設備")} [data-all]`); await idle(p);
    c = await card(p, "設備");
    check("もう一度押すと全部外す", c.vals.every((x) => !x.on) && !(await store(p)).tables["仕掛"].find((x) => x.column === "設備").sel.length, c);
    await p.fill(`${CARD("設備")} .sx-q`, "L"); await sleep(300);
    const label = await p.$eval(`${CARD("設備")} [data-all] span`, (x) => x.textContent);
    await p.click(`${CARD("設備")} [data-all]`); await idle(p);
    c = await card(p, "設備");
    const sel = (await store(p)).tables["仕掛"].find((x) => x.column === "設備").sel;
    check("値を探すで絞ると「（合う値をすべて）」になり、合う値だけを選ぶ", label.includes("合う値") && sel.length > 0 && sel.every((v) => v.toUpperCase().includes("L")) && c.vals.every((x) => x.on), { label, sel });
    await p.fill(`${CARD("設備")} .sx-q`, ""); await p.dispatchEvent(`${CARD("設備")} .sx-q`, "input"); await sleep(200);
    // ③ 1 つだけ選ぶ
    await p.click(`${CARD("設備")} [data-clr]`); await idle(p);
    for (const v of ["CR1", "L-1"]) { await p.click(`${CARD("設備")} .sx-v[data-v="${v}"]`); await idle(p); }
    await menu(p, "設備", "one");
    c = await card(p, "設備");
    check("いくつでも → 1 つだけ: ◉ の印になり、選んでいた値は先頭の 1 つ（CR1）", c.vals.every((x) => x.one) && c.vals.filter((x) => x.on).map((x) => x.v).join() === "CR1", c.vals.filter((x) => x.on));
    await p.click(`${CARD("設備")} .sx-v[data-v="L-2"]`); await idle(p);
    c = await card(p, "設備");
    const n1 = c.vals.find((x) => x.v === "L-2").n;
    check("1 つだけ: 別の値を押すとその値だけ（件数もその値の件数）", c.vals.filter((x) => x.on).map((x) => x.v).join() === "L-2" && (await count(p)) === n1, { on: c.vals.filter((x) => x.on), count: await count(p), n1 });
    await p.click(`${CARD("設備")} .sx-v[data-v="L-2"]`); await idle(p);
    check("1 つだけ: 同じ値をもう一度押すと選ばない", !(await card(p, "設備")).vals.some((x) => x.on), null);
    await shot(p, "one");
    await menu(p, "設備", "many");
    // ④ 0 件の値を隠す（不良名の（空欄）は 0 件）
    const z0 = (await card(p, "不良名")).vals.filter((x) => !x.n).map((x) => x.v);
    await menu(p, "不良名", "hide0");
    c = await card(p, "不良名");
    check(`0 件の値を隠す: 0 件（${z0.length} 個）が消え「0 件 ${z0.length} 個を隠しています」`, z0.length > 0 && c.vals.every((x) => x.n > 0) && c.zero.includes(`0 件 ${z0.length} 個`), { z0, c });
    await shot(p, "hide0");
    await p.click(`${CARD("不良名")} [data-show0]`); await idle(p);
    c = await card(p, "不良名");
    check("「出す」で 0 件の値が戻る（0 件の値を隠すが外れる）", z0.every((v) => c.vals.some((x) => x.v === v)) && !c.zero, c.zero);
    await p.click(`${CARD("不良名")} .sx-v[data-v=""]`); await idle(p);
    await menu(p, "不良名", "hide0");
    c = await card(p, "不良名");
    check("選んでいる 0 件の値は、隠しても出たまま（外せる）", c.vals.some((x) => x.v === "" && x.on), c.vals);
    await p.click(`${CARD("不良名")} .sx-v[data-v=""]`); await idle(p);
    // ⑤ 並び
    const order = async () => p.$$eval("#llSlicer .sx-card", (xs) => xs.map((x) => x.dataset.col));
    const o0 = await order();
    const g = await (await p.$(`${CARD(o0[1])} .sx-grip`)).boundingBox(), t = await (await p.$(CARD(o0[0]))).boundingBox();
    await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down();
    await p.mouse.move(g.x + g.width / 2, g.y - 10, { steps: 3 }); await p.mouse.move(t.x + 40, t.y + 6, { steps: 10 }); await sleep(150);
    await shot(p, "drag");
    await p.mouse.up(); await idle(p);
    const o1 = await order(), saved = (await store(p)).tables["仕掛"].map((x) => x.column);
    check(`⋮⋮ を引いて 2 枚目（${o0[1]}）を先頭へ（覚えにも同じ並び）`, o1.join() === [o0[1], o0[0]].join() && saved.join() === o1.join(), { o0, o1, saved });
    await menu(p, o1[0], "down");
    check("⋯ の「下へ」で 1 つ下へ", (await order()).join() === o0.join(), await order());
    // ⑥ 幅
    const paneW = () => p.$eval("#llSlicer", (x) => Math.round(x.getBoundingClientRect().width));
    const e = await (await p.$("#llSlicerEdge")).boundingBox();
    await p.mouse.move(e.x + e.width / 2, e.y + e.height / 2); await p.mouse.down(); await p.mouse.move(e.x + e.width / 2 + 100, e.y + e.height / 2, { steps: 8 }); await p.mouse.up(); await sleep(300);
    const w1 = await paneW();
    await p.focus("#llSlicerEdge"); await p.keyboard.press("ArrowRight"); await sleep(200);
    const w2 = await paneW();
    await shot(p, "wide");
    await p.dblclick("#llSlicerEdge"); await sleep(200);
    const w3 = await paneW();
    check("幅: 境目を引くと広がる（+100px）・→ で 20px・2 回押すと既定（280px）", Math.abs(w1 - 380) <= 3 && w2 === w1 + 20 && w3 === 280, { w1, w2, w3 });
    await p.click('#llSlicer button[data-place="right"]'); await sleep(300);
    const er = await (await p.$("#llSlicerEdge")).boundingBox();
    await p.mouse.move(er.x + er.width / 2, er.y + er.height / 2); await p.mouse.down(); await p.mouse.move(er.x + er.width / 2 - 60, er.y + er.height / 2, { steps: 6 }); await p.mouse.up(); await sleep(300);
    const wr = await paneW();
    await p.click('#llSlicer button[data-place="top"]'); await sleep(400);
    const ph = () => p.$eval("#llSlicer", (x) => Math.round(x.getBoundingClientRect().height));
    const et = await (await p.$("#llSlicerEdge")).boundingBox(), h0 = await ph();
    await p.mouse.move(et.x + et.width / 2, et.y + et.height / 2); await p.mouse.down(); await p.mouse.move(et.x + et.width / 2, et.y + et.height / 2 + 80, { steps: 6 }); await p.mouse.up(); await sleep(300);
    const h1 = await ph();
    check("右に置くと左へ引いて広がる・上に置くと境目で高さが変わる", Math.abs(wr - 340) <= 3 && h1 > h0 + 40, { wr, h0, h1 });
    await p.click('#llSlicer button[data-place="left"]'); await sleep(300);
    // ⑦ 字の大きさ
    await p.click("#llSlicer [data-zoom]"); await p.waitForSelector(".sx-zoompop");
    await p.click(".sx-zoompop [data-zp]"); await p.click(".sx-zoompop [data-zp]"); await sleep(200);
    const z = await p.evaluate(() => ({ zoom: document.querySelector("#llSlicer .sx-cards").style.zoom, btn: document.querySelector("#llSlicer [data-zoom] b").textContent, head: getComputedStyle(document.querySelector("#llSlicer .sx-head > b")).fontSize }));
    await shot(p, "zoom");
    await p.keyboard.press("Escape");
    // ⑧ 書式に運ぶ形・読み直し
    await menu(p, "不良名", "one");
    const setup = await p.evaluate(() => window.LotListSlicer.setupOf("仕掛"));
    await p.reload(); await p.waitForSelector("#llSlicer .sx-card"); await idle(p);
    const after = await p.evaluate(() => ({ zoom: document.querySelector("#llSlicer .sx-cards").style.zoom, one: !!document.querySelector('#llSlicer .sx-card[data-col="不良名"] .sx-v .sx-mk.is-one') }));
    check("字の大きさ: ＋ 2 回で 120%（カードだけ。頭はそのまま）・読み直しても残る", z.zoom === "1.2" && z.btn === "120%" && z.head === "13.5px" && after.zoom === "1.2", { z, after });
    check("選び方（1 つだけ）・0 件を隠すが、共有の書式・保存した見方に運ぶ形に入り、読み直しても残る",
      setup.find((x) => x.column === "不良名")?.one === true && setup.find((x) => x.column === "不良名")?.hide0 === true && after.one, setup);
    await p.click("#llSlicer [data-zoom]"); await p.click(".sx-zoompop [data-z100]"); await p.keyboard.press("Escape");
    check("頁の誤りが無い", !errors.length, errors);
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
