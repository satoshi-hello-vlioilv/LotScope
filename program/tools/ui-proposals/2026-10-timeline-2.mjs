// 2026-10 タイムライン・値の並べ替え・狭い幅（2 回目）: 1 回目の上位 3 案（B・C・D）と、エッセンスを組み直した複合案 4 つ（M1〜M4）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-timeline-2.mjs --states slicer [--view 1536x864]
// 1 回目で見えたこと: 見出しの名前を折り返すだけでは、ボタンに押されて「発生日」が 1 字ずつ縦に並ぶ・「設備」が消える。
//   複合案は、名前が狭いときに名前の行を分ける（見出しの行を折り返す。名前は 7 字分の幅を下回らない）。
import { KIT, CSS, PROPOSALS as FIRST } from "./2026-10-timeline.mjs";

const CSS2 = CSS + `
  .sx-ch{flex-wrap:wrap;row-gap:4px}
  .sx-ch > b{flex:1 1 7em !important;word-break:normal !important;overflow-wrap:anywhere}
  .sx-v span{word-break:normal !important;overflow-wrap:anywhere}
  .tl-rangebtn{border-bottom:1px dashed #9fb3c6;cursor:pointer}
  .px-chip{display:inline-flex;align-items:center;gap:4px;margin:0 0 4px;padding:1px 4px 1px 8px;border-radius:999px;background:var(--input-soft);color:var(--h-input);font-size:11px;font-weight:700}
  .px-chip b{font-weight:400}
`;
const go = (key, build) => ["script", `window.__tl.mount(${JSON.stringify(key)}, () => { const T = window.__tl; ${build}
  document.querySelector("#llSlicer .sx-card").setAttribute("data-px", ${JSON.stringify(key)}); });`];
const PUT = (html) => `T.$("#llSlicer .sx-card").insertAdjacentHTML("beforebegin", ${html});`;
const VHEAD = `[...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-vals")].forEach((v, i) => v.insertAdjacentHTML("beforebegin", '<div class="px-vh">' + (i ? '<span>値</span><span>件数</span>' : '<span>値</span><b>件数 ▼</b>') + '</div>'));`;
const MENU = `const c = [...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl])")][0]; c.classList.add("px-rel"); c.insertAdjacentHTML("beforeend", T.menuOrder());`;
const keep = (k) => ({ ...FIRST.find((p) => p.key === k), css: CSS2 });

export const PROPOSALS = [
  { key: "M1", name: "B の山＋スライダー＋C の値の上の見出し（値｜件数 ▼）＋名前の行を分ける", css: CSS2,
    ops: [KIT, go("M1", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>' + T.days() + ' 日・' + T.total() + ' 件</small></div>' + T.bars(34) + T.slider() + T.axis() + '<div class="tl-inputs"><input value="' + T.from + '">〜<input value="' + T.to + '"></div>')`) + VHEAD)] },
  { key: "M2", name: "B の山＋スライダー＋D の期間の札（1 行）＋値の並びは ⋯", css: CSS2,
    ops: [KIT, go("M2", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>' + T.days() + ' 日・' + T.total() + ' 件</small></div><div class="tl-chips"><span>30 日</span><span>今月</span><span>先月</span><span>今年</span><span>全期間</span></div>' + T.bars(30) + T.slider() + T.axis())`) + MENU)] },
  { key: "M3", name: "C の細いタイムライン＋B の日付の欄＋値の上の見出し", css: CSS2,
    ops: [KIT, go("M3", PUT(`T.card('<div class="tl-inputs" style="margin:0 0 4px"><input value="' + T.from + '">〜<input value="' + T.to + '"></div>' + T.slider() + T.axis() + '<div class="tl-range"><small>' + T.days() + ' 日・' + T.total() + ' 件</small></div>')`) + VHEAD)] },
  { key: "M4", name: "B のタイムライン（期間の字を押すと日付の欄）＋値の並びは ⋯ と、既定でないときだけ値の上の札", css: CSS2,
    ops: [KIT, go("M4", PUT(`T.card('<div class="tl-range"><span class="tl-rangebtn" title="押すと日付で決められます">' + T.label() + '</span><small>' + T.days() + ' 日・' + T.total() + ' 件</small></div>' + T.bars(34) + T.slider() + T.axis())`)
      + `[...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-vals")][0].insertAdjacentHTML("beforebegin", '<span class="px-chip">件数の多い順<b>×</b></span>');`)] },
  keep("B"), keep("C"), keep("D"),
];
