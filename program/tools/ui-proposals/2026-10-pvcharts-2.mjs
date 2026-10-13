// 2026-10 集計表・グラフ: 形の選び方とすぐに見る（2 回目。1 回目の上位 3 案 G・B・D と、エッセンスを組んだ複合案 4 つ）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvcharts-2.mjs --states worklog-pivot,pivot-pick,pivot-quickpick [--view 1536x864]
// 1 回目で効いて見えたエッセンス:
//   G … すぐに見る＝組み方（入口が 1 つ。文の頭の「組み方 ▾」が無くなり、文が短い・フル HD でも 1 段）／目的ごとの行に札を並べた小さな面（620px で全部が見える）
//   B … 形のボタン 1 つに今の形の絵と名前（いま何を見ているかが分かる）／目的ごとの列に説明つきの面（初めてでも選べる）
//   D … 目的の言葉（推移・比べる・内訳・ばらつき・関係）で選ぶ／「向く」の印
//   F … 押してすぐ替わる（1 回で）
import { PROPOSALS as FIRST, CSS, KIT, go, BAR, HIDE_QUICK } from "./2026-10-pvcharts.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
// 目的ごとの行の面（G）。desc なら札の下に説明の 1 行（B）
const ROWS_POP = (anchor, desc) => `if (want === "chart") X.pop("pxR", '<div class="px-gal" style="grid-template-columns:1fr;gap:6px">' + X.groups().map((x) => '<div class="px-seg" style="flex-wrap:wrap;align-items:flex-start"><span class="px-gname" style="width:84px;padding-top:7px">' + x.n + "</span>" + x.defs.map((dd) => ${desc
  ? `'<button type="button" class="px-gi' + (X.P().chart === dd.k ? " on" : "") + '" style="width:178px">' + X.C.iconSvg(dd.k, 22) + "<span><b>" + dd.n + (X.fits(dd) && X.P().chart !== dd.k ? ' <i class=\\"px-fit\\">向く</i>' : "") + "</b><small>" + X.esc(dd.tip.split("。")[0].slice(0, 26)) + "</small></span></button>"`
  : `X.chip(dd, { mark: true })`}).join("") + "</div>").join("") + "</div>", ${JSON.stringify(anchor)}, ${desc ? 900 : 620}); else X.$("#pxR")?.remove();`;
const QPOP = (anchor, save) => `if (want === "quick") X.pop("pxQ2", X.quickPop().replace("すぐに見るに出す組み方", "組み方").replace("☑ を付けた物を、この順でグラフの形の行に並べます", "押すと当てます。☑＝グラフの形の行に出す（自分の ID ごと）")${save ? ` + '<p class="px-sec">いまの組み方を保存</p><div class="px-seg"><input class="pv-btn" style="flex:1;text-align:left;font-weight:400" value="名前"><label class="px-k"><input type="radio" checked>自分</label><label class="px-k"><input type="radio">共通</label><button class="pv-btn">保存</button></div>'` : ""}, ${JSON.stringify(anchor)}, 470); else X.$("#pxQ2")?.remove();`;
const STD = `.replace('作業日ごとのロット数・重量</span>', '作業日ごとのロット数・重量</span><span class="px-star">★</span>')`;

export const PROPOSALS = [
  pick("G"), pick("B"), pick("D"),
  { key: "M1", name: "複合: G の統合（すぐに見る＝組み方の札・★標準）＋ B の形ボタン（絵と名前）＋ G の目的ごとの行の面（向く印は D）", css: CSS + HIDE_QUICK + `#llPvPreset{display:none!important}`,
    ops: [KIT, go("M1", `const d = X.C.get(X.P().chart) || X.C.DEFS[0];
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="M1" class="px-seg"><span class="px-k">グラフ</span><button type="button" class="px-pick" id="pxM1">' + X.C.iconSvg(d.k, 18) + d.n + ' ▾</button><span class="px-k" style="margin-left:14px">すぐに見る:</span>' + X.quick()${STD} + '<button type="button" class="px-edit" id="pxM1q">組み方 ▾</button></span>');`,
    ROWS_POP("#pxM1", false) + QPOP("#pxM1q", true))] },
  { key: "M2", name: "複合: M1 の面を B の説明つき（目的の行 × 絵・名前・1 行の説明）に", css: CSS + HIDE_QUICK + `#llPvPreset{display:none!important}`,
    ops: [KIT, go("M2", `const d = X.C.get(X.P().chart) || X.C.DEFS[0];
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="M2" class="px-seg"><span class="px-k">グラフ</span><button type="button" class="px-pick" id="pxM2">' + X.C.iconSvg(d.k, 18) + d.n + ' ▾</button><span class="px-k" style="margin-left:14px">すぐに見る:</span>' + X.quick()${STD} + '<button type="button" class="px-edit" id="pxM2q">組み方 ▾</button></span>');`,
    ROWS_POP("#pxM2", true) + QPOP("#pxM2q", true))] },
  { key: "M3", name: "複合: M2 ＋ 形のボタンの横に、最近使った形 3 つの絵の札（F の 1 回で替わる）", css: CSS + HIDE_QUICK + `#llPvPreset{display:none!important}`,
    ops: [KIT, go("M3", `const d = X.C.get(X.P().chart) || X.C.DEFS[0], recent = ["column", "hist", "pareto"].filter((k) => k !== d.k).map((k) => X.C.get(k));
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="M3" class="px-seg"><span class="px-k">グラフ</span><button type="button" class="px-pick" id="pxM3">' + X.C.iconSvg(d.k, 18) + d.n + ' ▾</button>' + recent.map((r) => X.chip(r, { iconOnly: true })).join("") + '<span class="px-k" style="margin-left:14px">すぐに見る:</span>' + X.quick()${STD} + '<button type="button" class="px-edit" id="pxM3q">組み方 ▾</button></span>');`,
    ROWS_POP("#pxM3", true) + QPOP("#pxM3q", true))] },
  { key: "M4", name: "複合: 文の頭の「☆ 組み方 ▾」は残す（前の版の置き場）＋ B の形ボタン・G の行の面＋すぐに見るは同じ行で「✎ 選ぶ」", css: CSS + HIDE_QUICK,
    ops: [KIT, go("M4", `const d = X.C.get(X.P().chart) || X.C.DEFS[0];
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="M4" class="px-seg"><span class="px-k">グラフ</span><button type="button" class="px-pick" id="pxM4">' + X.C.iconSvg(d.k, 18) + d.n + ' ▾</button><span class="px-k" style="margin-left:14px">すぐに見る:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxM4q">✎ 選ぶ</button></span>');`,
    ROWS_POP("#pxM4", false) + QPOP("#pxM4q", false))] },
];
