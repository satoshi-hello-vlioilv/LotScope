// 2026-10-21 グラフの組み合わせ の 3 回目（2 回目は 5 案とも 80 点に届かず。1 位 E 73.3 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-combo-3.mjs --states dash-combo --from dash   （1536x864・1280x720 でも）
// 2 回目の採点で、どの案にも共通した減点は作った物の不具合として直した（A に入っている）:
//   線の数値ラベルの上を破線が通る・線のラベルが棒の頭に被る → 線の脚を 2px おきに調べ、上・下・右上・左上・右下・左下から線と棒を避けられる所へ。
//   どこも避けられなければ白い札を敷く／「線」を押した系列にも「自動（線）」が並ぶ → 手で決めた系列は「自動」とだけ
// 案の方向（新しい案は C・D・E・F・G）:
//   A 直した作った物
//   B 持ち越し（2 回目 1 位 E）: 名前の行の右端に、いまの形の絵と目盛り（字を墨・12.5px に強く）
//   C 見せ方（新）: B ＋ 形の札にも同じ絵（字の前に小さく。段は増やさない）
//   D まとまり（新）: B ＋ 系列の行の左に系列の色の帯（どこからどこまでが 1 つの系列か）
//   E 統一（新）: 名前の行の絵を系列の色で描く（グラフの凡例と同じ印）
//   F 整列（新）: B ＋ 札の組の見出しを同じ幅の列にして、系列どうしで札の縦をそろえる（見出しを墨の 12px に）
//   G 合わせ（新）: C ＋ D ＋ E ＋ F
let seq = 0;
const watch = (sel, fn) => { const k = `cd${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const ICO = `(c) => ({ "棒": '<svg class="cd-ico" viewBox="0 0 14 12"><rect x="1" y="4" width="3" height="8" fill="' + c + '"/><rect x="6" y="1" width="3" height="11" fill="' + c + '"/><rect x="11" y="6" width="2" height="6" fill="' + c + '"/></svg>',
  "線": '<svg class="cd-ico" viewBox="0 0 14 12"><path d="M1 10l4-5 3 3 5-6" fill="none" stroke="' + c + '" stroke-width="1.8"/></svg>', "面": '<svg class="cd-ico" viewBox="0 0 14 12"><path d="M1 12V9l4-5 3 3 5-6v11z" fill="' + c + '"/></svg>' })`;
const BASE_CSS = `.cd-ico{display:inline-block;width:14px;height:12px;vertical-align:-1px;flex:0 0 auto}`;
const now = (colored) => watch(".de-sers", `(box) => { const ico = ${ICO}; box.querySelectorAll(".de-ser").forEach((r) => { const c = r.querySelector(".de-scol"); if (!c) return; c.querySelector(".cd-now")?.remove();
  const on = (lab) => ((r.querySelector('[aria-label$="' + lab + '"] .de-seg.on') || {}).textContent || "").replace(/自動（|）/g, "");
  const kind = on("の形") === "自動" ? "" : on("の形"), axis = on("の目盛り");
  const col = ${colored} ? (c.querySelector("input[type=color]") || {}).value || "currentColor" : "currentColor";
  c.insertAdjacentHTML("beforeend", '<span class="cd-now">' + (ico(col)[kind] || "") + "<span>" + kind + "・" + (axis === "右" ? "右の目盛り" : "左の目盛り") + "</span></span>"); }); }`);
const NOW_CSS = `.de-ser .de-scol span:not(.cd-now):not(.cd-now *){flex:0 1 auto}.cd-now{display:inline-flex!important;align-items:center;gap:5px;margin-left:auto;padding:0 4px 0 10px;font-size:12.5px;color:var(--ink);font-weight:600;white-space:nowrap}.cd-now .cd-ico{width:16px;height:13px}`;
const CHIP_ICO = watch(".de-sers", `(box) => { const ico = (${ICO})("currentColor"); box.querySelectorAll('[aria-label$="の形"] .de-seg').forEach((l) => { if (l.querySelector(".cd-ico")) return; const t = l.textContent.trim(); if (ico[t]) l.insertAdjacentHTML("afterbegin", ico[t]); }); }`);
const CHIP_CSS = `[aria-label$="の形"] .de-seg{display:inline-flex;align-items:center;gap:4px}`;
const STRIPE_CSS = `.de-ser{border-left:4px solid var(--cd-c,#ccd);padding-left:6px!important}`;
const STRIPE = watch(".de-sers", `(box) => { box.querySelectorAll(".de-ser").forEach((r) => { const v = (r.querySelector(".de-scol input[type=color]") || {}).value; if (v) r.style.setProperty("--cd-c", v); }); }`);
const GRID_CSS = `.de-sgrp > small{min-width:3.4em!important;font-size:12px!important;color:var(--ink)!important}.de-ser .de-sgrp{min-width:0}`;
export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（線のラベルが線・棒を避ける・手で決めたら「自動」だけ）", css: "", ops: [] },
  { key: "B", name: "B 名前の行の右端に、いまの形の絵と目盛り", css: BASE_CSS + NOW_CSS, ops: [now(false)] },
  { key: "C", name: "C B ＋ 形の札にも同じ絵", css: BASE_CSS + NOW_CSS + CHIP_CSS, ops: [now(false), CHIP_ICO] },
  { key: "D", name: "D B ＋ 系列の行の左に系列の色の帯", css: BASE_CSS + NOW_CSS + STRIPE_CSS, ops: [now(false), STRIPE] },
  { key: "E", name: "E 名前の行の絵を系列の色で（凡例と同じ印）", css: BASE_CSS + NOW_CSS, ops: [now(true)] },
  { key: "F", name: "F B ＋ 札の組の見出しを同じ幅に・墨の字", css: BASE_CSS + NOW_CSS + GRID_CSS, ops: [now(false)] },
  { key: "G", name: "G 形の札の絵＋色の帯＋系列の色の絵＋見出しの幅", css: BASE_CSS + NOW_CSS + CHIP_CSS + STRIPE_CSS + GRID_CSS, ops: [now(true), CHIP_ICO, STRIPE] },
];
