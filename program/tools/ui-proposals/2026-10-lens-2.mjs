// 2026-10 ロット番号の横の虫眼鏡（2 回目。1 回目の上位 3 案 F・D・C と、複合案 H1〜H4）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-lens-2.mjs --states list,grouped,worklog
// 1 回目で画像から分かったこと: ロット番号の列は番号に合わせた幅なので、字の流れに足す虫眼鏡は番号ごと切れて見えない（A・C・E・G）。
// 右端に重ねる D だけが両方見えるが、番号に詰まって窮屈。F は「押すと何が起きるか」が道具の行で見えるが、開くたびに切り替える手間が増える。
// 今はロット番号を押すと、転写計算へ移ってデータを取り込む（引っ張る連携）。見るだけの人には重く、画面も移ってしまう。
//
// 方向（何で解くか）: A 置き場＝番号の右に淡く／B 置き場＝番号の左（縦に揃う）／C 出し方＝行に乗せたときだけ／
// D 置き場＝セルの右端に寄せる（番号と離す）／E 見せ方＝淡い地の小札にして押せると分かる形に（A〜E の ON/OFF は表示の設定の「機能」）
// 5 案は「セルの中のどこにどう出すか」に偏る → 2 案を足す: F 流れの変え方＝道具の行の切り替えで、ロット番号を押したときの動きを
// 「取り込む／開くだけ」に替える／G ON/OFF の置き場＝ロット番号の列の見出しに虫眼鏡の切り替え（その列で決める）

const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.3"/><path d="M10.1 10.1 14 14"/></svg>';
/** 虫眼鏡をロット番号の前（before）か後ろ（after）に足す（描き直されるたびに） */
const LENS = (where = "after") => ["script", `
const add = () => document.querySelectorAll("#llBody .ll-lot").forEach((b) => {
  const near = ${where === "after" ? "b.nextElementSibling" : "b.previousElementSibling"};
  if (near && near.classList.contains("ll-lens")) return;
  b.insertAdjacentHTML("${where === "after" ? "afterend" : "beforebegin"}", '<button type="button" class="ll-lens" title="LotDsp で開く（取り込まない）" aria-label="LotDsp で開く">${ICON}</button>');
});
new MutationObserver(add).observe(document.querySelector("#llBody"), { childList: true, subtree: true }); add();`];
const BASE = `.ll-lens{border:0;background:transparent;padding:0;margin:0 0 0 5px;width:20px;height:20px;display:inline-grid;place-items:center;
    vertical-align:-4px;color:#a3b5c9;cursor:pointer;border-radius:5px}
  .ll-lens svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}
  .ll-lens:hover{color:var(--h-input);background:#e6edf6}`;


/** 虫眼鏡のぶんだけロット番号の列を広げる（作るときは列の幅の計算に足す。ここでは描き直されるたびに col を広げて再現） */
const WIDEN = ["script", `
const widen = () => { const col = document.querySelector('#llCols col[data-col="ロット番号"]'); const grid = document.querySelector("#llGrid");
  if (!col || col.dataset.widened) return; col.dataset.widened = "1"; col.style.width = (parseFloat(col.style.width) + 22) + "px";
  grid.style.width = (parseFloat(grid.style.width) + 22) + "px"; };
new MutationObserver(widen).observe(document.querySelector("#llCols"), { childList: true }); widen();`];
const EDGE = `.ll-grid td.ll-lotcol{position:relative;padding-right:26px!important}.ll-lens{position:absolute;right:5px;top:50%;transform:translateY(-50%);margin:0}`;
const HINT = (text) => ["script", `const h = document.querySelector(".ll-lothint"); if (h) h.innerHTML = ${JSON.stringify(text)};`];

export const PROPOSALS = [
  {
    key: "F", name: "道具の行の切り替えで、番号を押したときの動きを「取り込む／開くだけ」に替える（1 回目 1 位）",
    css: `.lens-mode{display:inline-flex;align-items:center;border:1px solid #c9d6e4;border-radius:7px;overflow:hidden;height:30px;margin-left:6px;font-size:12.5px}
      .lens-mode b{padding:0 8px;color:var(--muted);font-weight:600}
      .lens-mode span{padding:0 10px;height:100%;display:grid;place-items:center;color:#4b6584;cursor:pointer}
      .lens-mode span.on{background:var(--h-input);color:#fff;font-weight:700}`,
    ops: [["insert", '<span class="lens-mode" role="radiogroup" aria-label="ロット番号を押したとき"><b>番号を押すと</b><span class="on">取り込む</span><span>開くだけ</span></span>', "afterend", "#llSlicerBtn"]],
  },
  { key: "D", name: "セルの右端に寄せる（1 回目 2 位）", css: BASE + EDGE, ops: [LENS("after")] },
  {
    key: "C", name: "行に乗せたときだけ虫眼鏡（1 回目 3 位）",
    css: BASE + `.ll-lens{visibility:hidden}.ll-grid tbody tr:hover .ll-lens,.ll-lens:focus-visible{visibility:visible}`,
    ops: [LENS("after"), ["script", `const s = document.createElement("style"); s.textContent = "#llBody tr[data-i]:nth-child(3) .ll-lens{visibility:visible}"; document.head.append(s);`]],
  },
  {
    key: "H1", name: "右端の虫眼鏡＋そのぶん列を広げる（ON/OFF は表示の設定の機能。案内の札に虫眼鏡の使い方も）",
    css: BASE + EDGE, ops: [LENS("after"), WIDEN, HINT("ロット番号を押すと計算へ取り込み・<svg viewBox='0 0 16 16' style='width:12px;height:12px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:2'><circle cx='6.8' cy='6.8' r='4.3'/><path d='M10.1 10.1 14 14'/></svg> で LotDsp を開くだけ")],
  },
  {
    key: "H2", name: "H1 をふだんは淡く、行に乗せると藍で濃く（C の静かさ）",
    css: BASE + EDGE + `.ll-lens{color:#c4d1df}.ll-grid tbody tr:hover .ll-lens{color:var(--h-input)}`,
    ops: [LENS("after"), WIDEN, HINT("ロット番号を押すと計算へ取り込み・<svg viewBox='0 0 16 16' style='width:12px;height:12px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:2'><circle cx='6.8' cy='6.8' r='4.3'/><path d='M10.1 10.1 14 14'/></svg> で LotDsp を開くだけ"),
      ["script", `const s = document.createElement("style"); s.textContent = "#llBody tr[data-i]:nth-child(3) .ll-lens{color:var(--h-input);background:#e6edf6}"; document.head.append(s);`]],
  },
  {
    key: "H3", name: "H1＋案内の札そのものを ON/OFF の切り替えに（F の「いま何が起きるか」を、説明の置き場で）",
    css: BASE + EDGE + `.ll-lothint{display:inline-flex;align-items:center;gap:6px}.lens-sw{display:inline-flex;align-items:center;gap:4px;margin-left:4px;padding:1px 8px 1px 6px;border-radius:999px;background:var(--h-input);color:#fff;font-size:11.5px;font-weight:700;cursor:pointer}
      .lens-sw svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2.2}`,
    ops: [LENS("after"), WIDEN, HINT("ロット番号を押すと計算へ取り込み<span class='lens-sw' role='switch' aria-checked='true' title='虫眼鏡を出す／しまう'><svg viewBox='0 0 16 16'><circle cx='6.8' cy='6.8' r='4.3'/><path d='M10.1 10.1 14 14'/></svg>開くだけ ON</span>")],
  },
  {
    key: "H4", name: "H1＋ロット番号の列の見出しに ON/OFF（G の置き場を、広げた列で）",
    css: BASE + EDGE + `.lens-head{display:inline-grid;place-items:center;width:20px;height:18px;margin-left:6px;border-radius:4px;background:rgba(255,255,255,.22);vertical-align:-3px}
      .lens-head svg{width:12px;height:12px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}`,
    ops: [LENS("after"), WIDEN, ["script", `
const head = () => { const th = document.querySelector("#llHead th.ll-lotcol > .th-in"); if (th && !th.querySelector(".lens-head")) th.insertAdjacentHTML("beforeend", '<i class="lens-head" title="虫眼鏡を出す／しまう">${ICON}</i>'); };
new MutationObserver(head).observe(document.querySelector("#llHead"), { childList: true, subtree: true }); head();`]],
  },
];
