// 2026-10 色付け（2 回目。1 回目の上位 3 案 B・F・G と、複合案 M1〜M4）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-marks-2.mjs --states list
// 1 回目で画像から分かったこと: B の入口は閉じていても「効いていること・数」が見える。F の凡例は押してすぐ消す／付けるができる。
// G は打っている条件をそのまま色にでき、手が最も短い。A は「絞り込みの派生」と分かる（条件を作る所から色を付けられる）。
import { PROPOSALS as R1, TONES, PAINT, POP, RULES } from "./2026-10-marks.mjs";

const pick = (k) => ({ ...R1.find((p) => p.key === k) });
const BTN_CSS = `.mk-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid #cfd9e3;border-radius:8px;background:#fff;font-weight:700;color:#2c4660;margin-left:6px}
  .mk-btn b{background:#3f6591;color:#fff;border-radius:9px;padding:0 6px;font-size:11px}`;
const BTN = ["insert", '<button class="mk-btn" id="mkBtn"><span class="mk-tones"><i class="mk-red" style="width:9px;height:9px"></i><i class="mk-amber" style="width:9px;height:9px"></i></span>色付け<b>2</b> ▾</button>', "afterend", "#llSlicerBtn"];
/** 件数の行の凡例の札（押すと消す／付ける。2 つ目は消した形） */
const CHIPS_CSS = `.mk-chip{cursor:pointer}.mk-chip.off{background:#f1f3f5;color:#8a96a2;text-decoration:line-through}.mk-chip.off .mk-dot{background:#c3ccd5}`;
const CHIPS = ["insert", `<span class="mk-legend" title="押すと、その色付けを消す／付ける（行は絞りません）"><span class="mk-chip mk-red"><span class="mk-dot"></span>不良名＝汚れ<i>361</i></span>`
  + `<span class="mk-chip mk-amber off"><span class="mk-dot"></span>重量≧3000・板厚＜1<i>863</i></span></span>`, "afterend", ".ll-lothint"];
const PAINT_RED = ["script", `
const paint = () => { const heads = [...document.querySelectorAll("#llHead th")].map((th) => th.dataset.col); const at = (c) => heads.indexOf(c);
  document.querySelectorAll("#llBody tr[data-i]").forEach((tr) => { const td = tr.children[at("不良名")]; if (td && td.textContent.trim() === "汚れ") td.classList.add("mk-cell", "mk-red"); }); };
new MutationObserver(paint).observe(document.querySelector("#llBody"), { childList: true }); paint();`];
const ADHOC = (btn) => ["script", `document.querySelector("#llAdhocRow").hidden = false; const c = document.querySelector("#llAdhocColumn");
  c.innerHTML = "<option>不良名</option>"; document.querySelector("#llAdhocValue").value = "汚れ";
  document.querySelector("#llAdhocKeep").insertAdjacentHTML("afterend", ${JSON.stringify(btn)});`];
const ADHOC_BTN = '<button type="button" class="mk-paint"><span class="mk-dot mk-red"></span>色を付ける</button>';
const BUILD_CSS = `.mk-paint{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid #e3b2ab;border-radius:7px;background:#fff7f6;color:#a52a1f;font-weight:700}
  .mk-rule .mk-dot{flex:0 0 auto;width:10px}`;
const BUILDER = `<div style="border-top:1px solid #e3e9ef;margin-top:8px;padding-top:8px"><h5>色付けを作る（条件は絞り込みと同じ・かつ）</h5>`
  + `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 4px"><select><option>不良名</option></select><select><option>＝ 一致</option></select><input value="汚れ" style="width:90px">`
  + `<span class="mk-tones"><i class="mk-red on"></i><i class="mk-amber"></i><i class="mk-green"></i><i class="mk-blue"></i><i class="mk-violet" style="--mk-bar:#8a5fd0"></i><i style="--mk-bar:#9aa6b2"></i></span>`
  + `<select><option>条件の列のセル</option><option>行全体</option></select></div><div style="margin:8px 4px 0;display:flex;gap:8px"><button class="mk-paint">＋ 条件を足す（かつ）</button><button class="mk-paint" style="background:#3f6591;color:#fff;border-color:#3f6591">色を付ける</button></div></div>`;

export const PROPOSALS = [
  { ...pick("B"), name: "道具の行に専用の色付け（1 回目 1 位）" },
  { ...pick("F"), name: "件数の行の下に凡例の帯（1 回目 2 位）" },
  { ...pick("G"), name: "列で絞り込むに「絞る｜色付け」（1 回目 3 位）" },
  {
    key: "M1", name: "B の入口＋件数の行の凡例の札を押して消す／付ける（F の手の短さを、帯を足さずに）",
    css: TONES + BTN_CSS + CHIPS_CSS, ops: [PAINT_RED, BTN, CHIPS],
  },
  {
    key: "M2", name: "M1＋列で絞り込むの行に「色を付ける」（G: 打っている条件をそのまま色に）",
    css: TONES + BTN_CSS + CHIPS_CSS + BUILD_CSS, ops: [PAINT_RED, BTN, CHIPS, ADHOC(ADHOC_BTN)],
  },
  {
    key: "M3", name: "B の入口を開くと、一覧の下に「色付けを作る」（列・比べ方・値・色・当てる所。条件は足せる）",
    css: TONES + BTN_CSS + CHIPS_CSS + BUILD_CSS, ops: [PAINT_RED, BTN, CHIPS, POP(`<h5>色付け（行は絞らず、当たった所に色。上の組が優先）</h5>${RULES}${BUILDER}`, "#mkBtn")],
  },
  {
    key: "M4", name: "F の帯を色付けがあるときだけ出し、入口は B（帯が空のときの行を使わない）",
    css: TONES + BTN_CSS + `.mk-band{display:flex;align-items:center;gap:8px;margin:4px 0 6px;padding:5px 10px;border-radius:8px;background:#f6f8fa;border:1px solid #e3e9ef;font-size:12.5px}
      .mk-band>b{color:#5d6b78;font-weight:800;margin-right:4px}` + CHIPS_CSS,
    ops: [PAINT_RED, BTN, ["insert", `<div class="mk-band"><b>色付け</b><span class="mk-chip mk-red"><span class="mk-dot"></span>不良名＝汚れ<i>361</i></span>`
      + `<span class="mk-chip mk-amber off"><span class="mk-dot"></span>重量≧3000・板厚＜1<i>863</i></span>`
      + `<small style="color:#6b7680;margin-left:auto">札を押すと消す／付ける・行は絞りません</small></div>`, "afterend", ".ll-status"]],
  },
];
