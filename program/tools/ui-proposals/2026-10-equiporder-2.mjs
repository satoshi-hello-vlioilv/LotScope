// 2026-10 作業実績: 設備のタブの並び（2 回目。1 回目の上位 3 案 A・E・F と、エッセンスを組んだ複合案 4 つ）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-equiporder-2.mjs --states worklog,master-worklog
// 1 回目で効いて見えたエッセンス:
//   A … タブそのものを引いて動かす（ブラウザのタブと同じ・探させない）／一覧の行の取っ手 ⋮⋮（動かせると一目で分かる）
//   E … 設備を管理に、タブと同じ見た目の「タブの並び」（何の並びかを推測させない）
//   F … キーで 1 つずつ動かす（引くのが苦手な人・細かい位置合わせ）
//   G … 名前順に一度に並べる（設備が多いとき）
import { PROPOSALS as FIRST, CSS, KIT, go, DRAG_TABS, ROW_COL } from "./2026-10-equiporder.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const GRIPS = (key) => `${ROW_COL(key, "", `(i) => '<span class="px-grip" title="つかんで並べ替え（Alt＋↑↓ でも）">⋮⋮</span>'`)}
  const r = X.rows(); if (r[5]) r[5].classList.add("px-row-lift"); if (r[2]) r[2].classList.add("px-row-ins");`;
const HEAD_NOTE = (key, html) => `const sum = X.$(".wl-sum"); if (sum && !sum.querySelector("[data-px='${key}n']")) sum.insertAdjacentHTML("beforeend", '<span data-px="${key}n" class="px-hint">${html}</span>');`;

export const PROPOSALS = [
  pick("A"), pick("E"), pick("F"),
  { key: "M1", name: "複合: A（タブを引く・行の取っ手）＋ F（Alt＋← → / ↑↓ でも）", css: CSS,
    ops: [KIT, go("M1t", DRAG_TABS("M1t", "つかんで並べ替え（選んで Alt＋← → でも）")),
      go("M1m", `${GRIPS("M1m")} ${HEAD_NOTE("M1m", "⋮⋮ をつかんで並べ替え（Alt＋↑↓ でも）。タブも同じ並びになります")}`)] },
  { key: "M2", name: "複合: A（タブを引く）＋ E（設備を管理にタブと同じ見た目の「タブの並び」）", css: CSS,
    ops: [KIT, go("M2t", DRAG_TABS("M2t", "つかんで並べ替え")),
      go("M2m", `const sum = X.$(".wl-sum"); if (!sum || !X.rows().length) return; const names = X.rows().map((tr) => tr.querySelector(".wl-name")?.value || "");
      sum.insertAdjacentHTML("afterend", '<div class="px-strip" data-px="M2m"><b>タブの並び</b>' + names.map((n, i) => '<span class="' + (i === 5 ? "px-lift" : "") + '">' + n + '</span>' + (i === 1 ? '<i class="px-ins"></i>' : "")).join("") + '<small>つかんで並べ替え</small></div>');`)] },
  { key: "M3", name: "複合: M1 ＋ 設備を管理に「名前順に並べる」（G を一度だけの操作に）", css: CSS,
    ops: [KIT, go("M3t", DRAG_TABS("M3t", "つかんで並べ替え（選んで Alt＋← → でも）")),
      go("M3m", `${GRIPS("M3m")} ${HEAD_NOTE("M3m", "⋮⋮ をつかんで並べ替え（Alt＋↑↓ でも）")}
        X.$(".wl-sum")?.insertAdjacentHTML("beforeend", '<button class="px-btn" data-px="M3m">名前順に並べる</button>');`)] },
  { key: "M4", name: "複合: A ＋ タブの右クリックに「先頭へ・末尾へ」（C を遠くへ動かすときだけ）", css: CSS,
    ops: [KIT, go("M4t", `${DRAG_TABS("M4t", "つかんで並べ替え")} const r = X.tabs()[8].getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", '<div class="px-menu" data-px="M4t" style="left:' + (r.left + 10) + 'px;top:' + (r.bottom + 4) + 'px"><span>⇤ 先頭へ</span><span>末尾へ ⇥</span><hr><span>設備を管理…</span></div>');`),
      go("M4m", GRIPS("M4m"))] },
];
