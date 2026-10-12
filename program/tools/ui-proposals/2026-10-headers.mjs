// 2026-10 一覧の列の見出しの札（段・並べ替え・式・絞り込み）が列名を押しのける問題（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-headers.mjs --states headers
// 状態 headers（ui-harness.mjs）: 3 段でまとめ・並べ替え・計算列 3 つ・狭い列の幅・絞り込み 1 つ（利用者の画面の再現）。
//
// 方向（何で解くか）: A 置き場＝列名の下の 2 段目へ／B 減らし方＝札を記号に（段は下線の色・式は点線の下線）／
// C 見せ方＝右上の角に小さく重ねる／D 流れ＝ふだんは細い印、マウスを乗せたときに札／E 優先順位＝列名を先に確保し狭い列だけ札を点に
// 5 案は「札を見出しの中でどう置くか」に偏る → 2 案を足す: F 列名を 2 行まで折り返す（字を削らない）／G 札を見出しから外し、件数の行の帯だけで示す

// 札を 1 つの入れ物（.th-marks）にまとめる（描き直されるたびに）。案ごとの CSS はこの入れ物に当てる
const WRAP = ["script", `
const wrap = () => document.querySelectorAll("#llHead th > .th-in").forEach((x) => {
  if (x.querySelector(".th-marks")) return;
  const m = document.createElement("span"); m.className = "th-marks";
  x.querySelectorAll(":scope > i").forEach((i) => m.append(i));
  if (m.childNodes.length) x.append(m);
  const th = x.parentElement;
  if (th.querySelector(".ll-sort")) th.classList.add("is-sorted");
});
new MutationObserver(wrap).observe(document.querySelector("#llHead"), { childList: true, subtree: true }); wrap();`];

export const PROPOSALS = [
  { key: "now", name: "今の作り（札が縮まず、列名だけが縮む）", css: "", ops: [] },
  {
    key: "A", name: "札を列名の下の 2 段目へ（列名は幅いっぱい）",
    css: `.ll-grid thead th > .th-in{flex-wrap:wrap;row-gap:0;line-height:1.15}
      .ll-grid thead th > .th-in > span:first-child{flex:1 0 100%}
      .th-marks{display:flex;gap:3px;justify-content:inherit;width:100%;line-height:12px;font-size:9.5px}
      .th-marks i{margin:0!important;font-size:9.5px!important;padding:0 3px!important}`,
    ops: [WRAP],
  },
  {
    key: "B", name: "札を記号に減らす（段は下線の色・式は点線の下線・▲ だけ）",
    css: `.th-marks .ll-lvmark,.th-marks .ll-calcmark{display:none}
      .ll-grid thead th.is-level{box-shadow:inset 0 -3px 0 #8fe0d6}
      .ll-grid thead th.is-calc > .th-in > span:first-child{text-decoration:underline dotted rgba(255,255,255,.7);text-underline-offset:3px}
      .th-marks .ll-sort{font-size:10px;margin-left:2px}`,
    ops: [WRAP],
  },
  {
    key: "C", name: "札を右上の角に小さく重ねる",
    css: `.ll-grid thead th{position:sticky}
      .th-marks{position:absolute;top:1px;right:9px;display:flex;gap:2px;opacity:.95}
      .th-marks i{margin:0!important;font-size:9px!important;line-height:11px;padding:0 2px!important;border-radius:3px;background:rgba(0,0,0,.25)}
      .ll-grid thead th > .th-in{padding-top:5px}`,
    ops: [WRAP],
  },
  {
    key: "D", name: "ふだんは細い印だけ、マウスを乗せたときに札を出す",
    css: `.th-marks{display:none}
      .ll-grid thead th:hover .th-marks{display:inline-flex;position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:1px 4px;border-radius:5px;background:#21384a;box-shadow:0 1px 4px rgba(0,0,0,.3)}
      .ll-grid thead th.is-level{box-shadow:inset 0 -3px 0 #8fe0d6}
      .ll-grid thead th.is-sorted::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:#ffe3a6}
      .ll-grid thead th.is-calc > .th-in > span:first-child{font-style:italic}`,
    ops: [WRAP],
  },
  {
    key: "E", name: "列名を先に確保し、狭い列だけ札を点に縮める",
    css: `.ll-grid thead th{container-type:inline-size}
      .ll-grid thead th > .th-in > span:first-child{flex:1 1 auto;min-width:2.6em}
      .th-marks{display:inline-flex;gap:2px;min-width:0;overflow:hidden}
      @container (max-width: 120px){ .th-marks i{font-size:0!important;width:6px;height:6px;padding:0!important;border-radius:50%;margin:0 1px!important;background:#8fe0d6!important}
        .th-marks .ll-sort{background:#ffe3a6!important}.th-marks .ll-calcmark{background:rgba(255,255,255,.6)!important} }`,
    ops: [WRAP],
  },
  {
    key: "F", name: "列名を 2 行まで折り返す（字を削らない）",
    css: `.ll-grid thead th > .th-in{flex-wrap:wrap;align-items:center;row-gap:1px}
      .ll-grid thead th > .th-in > span:first-child{white-space:normal;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-all}
      .th-marks{display:inline-flex;gap:2px}.th-marks i{margin:0 0 0 2px!important;font-size:9.5px!important}`,
    ops: [WRAP],
  },
  {
    key: "G", name: "札を見出しから外す（段・並べ替えは件数の行の帯だけ。見出しは色の下線）",
    css: `.th-marks{display:none}
      .ll-grid thead th.is-level{box-shadow:inset 0 -3px 0 #8fe0d6}
      .ll-grid thead th.is-sorted{box-shadow:inset 0 -3px 0 #ffe3a6}`,
    ops: [WRAP],
  },
];
