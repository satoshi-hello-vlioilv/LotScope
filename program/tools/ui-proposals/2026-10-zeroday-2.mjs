// 2026-10 作業実績の 0 件の日（2 回目）: 1 回目の上位 3 案（A・F・B）と、エッセンスを組み直した複合案 4 つ（Z1〜Z4）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-zeroday-2.mjs --states worklog-work
import { KIT, CSS, PROPOSALS as FIRST } from "./2026-10-zeroday.mjs";

const CSS2 = CSS + `
  .zd-row td.wk-tot{color:#9aa6b2 !important}
  .zd-row.zd-top th,.zd-row.zd-top td{border-top:1px dashed #c9d3dd !important}
  .zd-days small{color:var(--muted);font-weight:400}
`;
const go = (key, mode, build = "") => ["script", `window.__zd.mount(${JSON.stringify(key)}, () => { const Z = window.__zd; Z.fill(${JSON.stringify(mode)}); ${build} });`];
const TOG = `document.querySelector("#llWork .wk-table").insertAdjacentHTML("beforebegin", '<label class="zd-tog"><i></i>0 件の日も出す</label>');`;
/** 0 件の行の「計」を 0 と書く（ほかの直は –） */
const ZERO_TOT = `document.querySelectorAll("#llWork .zd-row").forEach((r) => { const c = r.lastElementChild; c.className = "wk-tot"; c.textContent = "0"; });`;
/** 合計の行の日数: 表の日数（作業のあった日） */
const DAYS = `const s = document.querySelector("#llWork .wk-sum th small"); if (s) { const n = document.querySelectorAll("#llWork .zd-row").length; s.closest("th").classList.add("zd-days"); s.textContent = (parseInt(s.textContent) + n) + "日"; s.title = "作業のあった日 " + parseInt(s.textContent) + " 日"; }`;
const keep = (k) => ({ ...FIRST.find((p) => p.key === k), css: CSS2 });

export const PROPOSALS = [
  { key: "Z1", name: "A＋0 件の行の「計」は 0 と書く・合計の日数は暦の日数", css: CSS2, ops: [KIT, go("Z1", "row", TOG + ZERO_TOT + DAYS)] },
  { key: "Z2", name: "A＋F: 0 件の行は少し低く（字は同じ大きさ）・計は 0", css: CSS2,
    ops: [KIT, go("Z2", "row", TOG + ZERO_TOT + `document.querySelectorAll("#llWork .zd-row th, #llWork .zd-row td").forEach((c) => { c.style.height = "20px"; c.style.paddingTop = c.style.paddingBottom = "0"; });`)] },
  { key: "Z3", name: "A＋B: 3 日以上続いた 0 件は 1 行に畳む・それより短いときは日の行", css: CSS2, ops: [KIT, go("Z3", "row", TOG + ZERO_TOT)] },
  { key: "Z4", name: "A＋G: 0 件の行の上に破線（作業の行と区切る）・計は 0", css: CSS2,
    ops: [KIT, go("Z4", "row", TOG + ZERO_TOT + `document.querySelectorAll("#llWork .zd-row").forEach((r) => r.classList.add("zd-top"));`)] },
  keep("A"), keep("F"), keep("B"),
];
