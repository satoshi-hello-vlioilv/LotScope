// 2026-10 集計表・グラフの月・数値ラベル・組み方（2 回目）。1 回目の上位 3 案（D・C・E）と、エッセンスを組み直した複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvmonth-2.mjs --states worklog-pivot [--view 1536x864]
// 1 回目の画像で効いて見えたこと: D の「日の札のすぐ後ろに ◀ すべての月 ▶」は文として読め（作業日 ◀9月▶ ごとに）、1 段に収まる／
// G の「数値ラベルはグラフの枠の見出し（凡例の横）」はグラフの形の行を増やさず、効く物のそばにある／
// C の「組み方 ▾ 1 つ（いまの名前と★）」は保存した数が増えても幅が一定／B の「月で区切るは小計・総計の横」は表にも効く物の置き場として筋が通る／
// E の「月を押すだけで選ぶ」は速いが帯で 1 段増える → ◀▶ の真ん中を押すと月の一覧（E の帯の中身）が開く形に
// 逆に効かなかったこと: D の「日（月で区切る）」をまとめ方の選択に隠すと、入れ方を推測させる（チェックの方が状態が見える）

import { CSS as C1, PROPOSALS as R1 } from "./2026-10-pvmonth.mjs";

const pick = (k) => R1.find((p) => p.key === k);
const [REAL, KEEP] = [pick("A").ops[0], (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(`<span id="${id}" style="display:contents">${html}</span>`)}); };
setInterval(put, 120); put();`]];
const CSS = C1 + `.pv-chead .mx-ck{height:26px} .mx-small{height:26px!important;font-size:12px!important}`;
const NAV = `<span class="mx-nav" title="月を 1 つ選ぶ（◀ ▶ で前後の月へ・真ん中を押すと月の一覧）"><button disabled>◀</button><span>すべての月 ▾</span><button>▶</button></span>`;
const SPLIT = `<label class="pv-ck"><input type="checkbox" checked>月で区切る</label>`;
const LBL = `<label class="pv-ck mx-lbl"><input type="checkbox" checked>数値ラベル</label>`;
const PRE = `<button class="mx-pre" title="組み方（共通・自分）を呼ぶ・保存する・標準にする"><span class="mx-star">★</span>組み方<span class="mx-pn">月ごとの重量</span>▾</button>`;
const SENT_HEAD = '#llPivot .pv-sent';
const AFTER_ROWS = '#llPivot .pv-slot[data-role="rows"]';
const SUB = '#llPivot .pv-sent [data-pv-opt="sub"]';
const CHEAD = "#llPivot .pv-chead";

export const PROPOSALS = [
  { ...pick("D"), key: "D" }, { ...pick("C"), key: "C" }, { ...pick("E"), key: "E" },
  { key: "M1", name: "複合: 文の日の札の後ろに ◀月▶（D）・月で区切るは小計の横（B）・数値ラベルはグラフの見出し（G）・組み方 ▾ は文の頭（C）", css: CSS,
    ops: [REAL, KEEP("m1a", NAV, "afterend", AFTER_ROWS), KEEP("m1b", SPLIT, "beforebegin", SUB), KEEP("m1c", LBL, "beforeend", CHEAD), KEEP("m1d", PRE, "afterbegin", SENT_HEAD)] },
  { key: "M2", name: "複合: M1 の組み方を左の面のタブ（D）に", css: CSS + `.mx-ftabs{display:flex;border-bottom:1px solid var(--line);margin:-2px 0 6px}`,
    ops: [REAL, KEEP("m2a", NAV, "afterend", AFTER_ROWS), KEEP("m2b", SPLIT, "beforebegin", SUB), KEEP("m2c", LBL, "beforeend", CHEAD),
      KEEP("m2d", `<div class="mx-ftabs"><b class="on">カラム</b><b>組み方 <span class="mx-star">★</span>4</b></div>`, "afterbegin", "#llPivot .pv-fields")] },
  { key: "M3", name: "複合: 月の物を 1 か所に（日の札の後ろに ☑月で区切る ◀月▶）・数値ラベルはグラフの見出し・組み方 ▾ は文の頭", css: CSS,
    ops: [REAL, KEEP("m3a", SPLIT.replace('class="pv-ck"', 'class="mx-ck mx-on mx-small"') + NAV, "afterend", AFTER_ROWS), KEEP("m3c", LBL, "beforeend", CHEAD), KEEP("m3d", PRE, "afterbegin", SENT_HEAD)] },
  { key: "M4", name: "複合: グラフの見出しに 数値ラベル・月で区切る・◀月▶ をまとめる（G）・組み方 ▾ は文の頭（C）", css: CSS + `.pv-chead .mx-g4{margin-left:auto;display:inline-flex;gap:10px;align-items:center}`,
    ops: [REAL, KEEP("m4a", `<span class="mx-g4">${LBL}${SPLIT}${NAV}</span>`, "beforeend", CHEAD), KEEP("m4d", PRE, "afterbegin", SENT_HEAD)] },
];
