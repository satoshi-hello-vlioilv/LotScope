// 2026-10 Excel に出力する入口（2 回目）。1 回目の上位 3 案（A・B・G）と、エッセンスを組んだ複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-excel-2.mjs --states list,worklog-work
// H1: A＋出す件数をボタンに添える／H2: A＋作業でまとめているときだけ ▾（集計のシートも出す）／H3: B の置き場に A の字／H4: A を道具の行の右端へ
import { PROPOSALS as FIRST } from "./2026-10-excel.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;fill:none;stroke:currentColor;stroke-width:1.6"><path d="M8 2v8m-3-3 3 3 3-3M3 12.5h10"/></svg>';
const CSS = pick("A").css + `.xl-btn small{margin-left:5px;font-weight:600;opacity:.8;font-size:11.5px}`;
export const PROPOSALS = [
  pick("A"), pick("B"), pick("G"),
  { key: "H1", name: "道具の行のボタンに出す件数を添える", css: CSS,
    ops: [["insert", `<button type="button" class="xl-btn" id="xlH1">${ICON}Excel に出力<small></small></button>`, "beforebegin", "#llColBtn"],
      ["script", `setInterval(() => { const n = (document.querySelector("#llCount") || {}).textContent || ""; const s = document.querySelector("#xlH1 small"); if (s) s.textContent = n.replace(/^全\\s*/, ""); }, 300);`]] },
  { key: "H2", name: "道具の行のボタン＋作業でまとめているときだけ ▾ で集計のシートも", css: CSS + `.xl-split{display:inline-flex}.xl-split .xl-btn:first-child{border-radius:7px 0 0 7px}.xl-split .xl-btn + .xl-btn{border-radius:0 7px 7px 0;border-left:0;padding:0 8px}`,
    ops: [["insert", `<span class="xl-split">${'<button type="button" class="xl-btn">' + ICON + "Excel に出力</button>"}<button type="button" class="xl-btn" title="集計（日・直ごとのロット数）のシートも出す・出さない">▾</button></span>`, "beforebegin", "#llColBtn"]] },
  { key: "H3", name: "件数の行（全 N 件の隣）に「Excel に出力」", css: CSS, ops: [["insert", `<button type="button" class="xl-btn sm">${ICON}Excel に出力</button>`, "afterend", "#llCount"]] },
  { key: "H4", name: "道具の行の右端に「Excel に出力」", css: CSS, ops: [["insert", `<button type="button" class="xl-btn">${ICON}Excel に出力</button>`, "afterend", "#llProfileBtn"]] },
];
