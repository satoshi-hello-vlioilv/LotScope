// 2026-10 ロット番号の横の虫眼鏡（押すとロット問い合わせ〈LotDsp〉でそのロットを開くだけ。取り込まない）と、その ON/OFF（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-lens.mjs --states list,grouped,worklog
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

export const PROPOSALS = [
  { key: "now", name: "今の作り（ロット番号を押すと取り込む。開くだけの道が無い）", css: "", ops: [] },
  { key: "A", name: "番号の右に淡い虫眼鏡（乗せると藍）", css: BASE, ops: [LENS("after")] },
  {
    key: "B", name: "番号の左に虫眼鏡（縦に揃う）",
    css: BASE + `.ll-lens{margin:0 5px 0 0}`, ops: [LENS("before")],
  },
  {
    key: "C", name: "行に乗せたときだけ虫眼鏡",
    css: BASE + `.ll-lens{visibility:hidden}.ll-grid tbody tr:hover .ll-lens,.ll-lens:focus-visible{visibility:visible}`,
    ops: [LENS("after"), ["script", `document.querySelector("#llBody tr[data-i]:nth-child(3)")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const s = document.createElement("style"); s.textContent = "#llBody tr[data-i]:nth-child(3) .ll-lens{visibility:visible}"; document.head.append(s);`]],
  },
  {
    key: "D", name: "セルの右端に寄せる（番号と離す）",
    css: BASE + `.ll-grid td.ll-lotcol{position:relative;padding-right:26px!important}.ll-lens{position:absolute;right:4px;top:50%;transform:translateY(-50%);margin:0}`,
    ops: [LENS("after")],
  },
  {
    key: "E", name: "淡い地の小札（押せると分かる形）",
    css: BASE + `.ll-lens{background:#edf2f8;color:#5d7ea3;border:1px solid #d5e0ec;width:22px;height:19px}.ll-lens:hover{background:#dbe6f2;border-color:#9fb6cf}`,
    ops: [LENS("after")],
  },
  {
    key: "F", name: "道具の行の切り替えで、番号を押したときの動きを「取り込む／開くだけ」に替える",
    css: `.lens-mode{display:inline-flex;align-items:center;border:1px solid #c9d6e4;border-radius:7px;overflow:hidden;height:30px;margin-left:6px;font-size:12.5px}
      .lens-mode b{padding:0 8px;color:var(--muted);font-weight:600}
      .lens-mode span{padding:0 10px;height:100%;display:grid;place-items:center;color:#4b6584;cursor:pointer}
      .lens-mode span.on{background:var(--h-input);color:#fff;font-weight:700}`,
    ops: [["insert", '<span class="lens-mode" role="radiogroup" aria-label="ロット番号を押したとき"><b>番号を押すと</b><span class="on">取り込む</span><span>開くだけ</span></span>', "afterend", "#llSlicerBtn"]],
  },
  {
    key: "G", name: "ロット番号の列の見出しに虫眼鏡の切り替え（その列で決める）",
    css: BASE + `.lens-head{display:inline-grid;place-items:center;width:20px;height:18px;margin-left:6px;border-radius:4px;background:rgba(255,255,255,.22);vertical-align:-3px}
      .lens-head svg{width:12px;height:12px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}`,
    ops: [LENS("after"), ["script", `
const head = () => { const th = document.querySelector("#llHead th.ll-lotcol > .th-in"); if (th && !th.querySelector(".lens-head")) th.insertAdjacentHTML("beforeend", '<i class="lens-head" title="虫眼鏡を出す／しまう">${ICON}</i>'); };
new MutationObserver(head).observe(document.querySelector("#llHead"), { childList: true, subtree: true }); head();`]],
  },
];
