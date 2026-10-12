// 2026-10 異常ロット一覧・作業実績の一覧を Excel に出力する入口の置き場（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-excel.mjs --states list,worklog-work
// 方向（何で解くか）: A 置き場＝道具の行（表示列の左）にボタン／B 置き場＝件数の行（全 N 件の隣）／C 減らし方＝「表示の設定 ▾」の中に入れる／
// D 置き場＝頁送りの横にアイコン／E 見せ方＝表の右上の角に浮かぶ小ボタン
// 5 案は「どこに置くか」に偏る → 2 案を足す: F 流れ＝件数の札を押すと出力（件数＝出す物）／G 流れ＝押すと出す範囲（全件・このページ・集計も）を選ぶ小窓

const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;fill:none;stroke:currentColor;stroke-width:1.6"><path d="M8 2v8m-3-3 3 3 3-3M3 12.5h10"/></svg>';
const BTN = (label, cls = "") => `<button type="button" class="xl-btn ${cls}">${ICON}${label}</button>`;
const CSS = `.xl-btn{height:30px;padding:0 12px;border:1px solid #1d6f42;border-radius:7px;background:#fff;color:#1d6f42;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
  .xl-btn.sm{height:26px;padding:0 9px;font-size:12.5px}`;

export const PROPOSALS = [
  { key: "A", name: "道具の行（表示列の左）に「Excel に出力」", css: CSS, ops: [["insert", BTN("Excel に出力"), "beforebegin", "#llColBtn"]] },
  { key: "B", name: "件数の行（全 N 件の隣）に小さな「Excel」", css: CSS, ops: [["insert", BTN("Excel", "sm"), "afterend", "#llCount"]] },
  {
    key: "C", name: "「表示の設定 ▾」を「出力・設定 ▾」にして中に入れる（開いたところ）",
    css: CSS + `.xl-menu{position:absolute;right:16px;top:150px;z-index:50;width:280px;padding:6px;border:1px solid var(--pop-line);border-radius:9px;background:#fff;box-shadow:0 8px 24px var(--pop-shadow)}
      .xl-menu b{display:block;padding:8px 10px;border-radius:6px;font-size:13px}.xl-menu b:first-child{background:#e8f4ec;color:#1d6f42}.xl-menu small{display:block;font-weight:500;color:var(--muted)}`,
    ops: [["script", `const b = document.querySelector("#llProfileBtn"); b.textContent = "出力・設定 ▾";
      document.body.insertAdjacentHTML("beforeend", '<div class="xl-menu"><b>${ICON.replace(/"/g, "\\'")}Excel に出力<small>いまの絞り込み・表示列のまま全件</small></b><b>表示の設定を書き出す…</b><b>表示の設定を読み込む…</b><b>初期設定に戻す</b></div>');`]],
  },
  { key: "D", name: "頁送りの横にアイコンボタン", css: CSS + `.xl-icon{width:30px;padding:0;display:inline-grid;place-items:center}.xl-icon svg{margin:0!important}`,
    ops: [["insert", `<button type="button" class="xl-btn xl-icon" title="Excel に出力">${ICON}</button>`, "beforebegin", ".ll-pager"]] },
  { key: "E", name: "表の右上の角に浮かぶ小ボタン", css: CSS + `.ll-grid-wrap{position:relative}.xl-float{position:absolute;right:10px;top:4px;z-index:5;box-shadow:0 2px 8px rgba(0,0,0,.15)}`,
    ops: [["insert", BTN("Excel", "sm xl-float"), "afterbegin", ".ll-grid-wrap"]] },
  { key: "F", name: "件数の札を押すと出力（全 N 件 ⤓）", css: CSS + `#llCount{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border:1px solid #1d6f42;border-radius:999px;color:#1d6f42;cursor:pointer}`,
    ops: [["script", `setInterval(() => { const c = document.querySelector("#llCount"); if (c && !c.querySelector("svg")) c.insertAdjacentHTML("beforeend", '${ICON.replace(/"/g, "\\'")}'); }, 300);`]] },
  {
    key: "G", name: "道具の行のボタン → 出す範囲を選ぶ小窓（開いたところ）",
    css: CSS + `.xl-pop{position:absolute;right:420px;top:150px;z-index:50;width:330px;padding:12px;border:1px solid var(--pop-line);border-radius:10px;background:#fff;box-shadow:0 8px 24px var(--pop-shadow);font-size:13px}
      .xl-pop label{display:block;padding:4px 0}.xl-pop small{color:var(--muted)}.xl-pop .go{margin-top:8px;height:30px;width:100%;border:0;border-radius:7px;background:#1d6f42;color:#fff;font-weight:700}`,
    ops: [["insert", BTN("Excel ▾"), "beforebegin", "#llColBtn"], ["script", `document.body.insertAdjacentHTML("beforeend", '<div class="xl-pop"><b>Excel に出力</b><label><input type="radio" checked> 絞り込みに当たる全件 <small>（387 件）</small></label><label><input type="radio"> このページだけ <small>（1〜387）</small></label><label><input type="checkbox" checked> 出力の条件（検索・条件・スライサー）を別のシートに</label><button class="go">出力する</button></div>');`]],
  },
];
