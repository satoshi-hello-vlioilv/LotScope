// 2026-10 表示の下限を広げる・3 回目（最後の回。95 点に届かなくても、いちばん高い案に決めて足りない点を伝える）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-narrow-3.mjs --view 1280x720 --states list,crowded,card,worklog-many,calc3d
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-narrow-3.mjs --states list,worklog-many,calc3d
// 2 回目（2026-10-narrow-2.mjs）の 1 位は M5（54.5 点）・2 位は E（47.9 点）。採点者が挙げた直すこと:
//   道具の行の Excel が 7px はみ出す・書式の名前が「…」無しで 1 字に切れる／設備が 1728 でも「ほか 5 台」（並べ替えの案内が幅を取る）・
//   1280 で「ほか 4 台」・橙の点が HOT の T に被る／3D の赤い札（肉厚…で写る）がコイルに被る／凡例を 1 行に畳み、語の途中で切れ 5 項目が奥／
//   カードを開いた所で件数の行の札が枠を出る／名前（書式・並べ替えの列）が 1〜2 字で読めない
// 3 回目の土台 P1 は本物のコード（案の CSS は当てない）。2 回目の M1 から直したこと:
//   道具の行の字を 13px（M5 の 12.5 より 1 段控えめ）・書式の名前は「異常…」まで読める幅を残す／件数の行の札は名前が 3 字読めなければ畳み、
//   まだ入らなければ ▾ と余白も詰める／設備は 1440 以下で余白 7px・字 13px（E の詰め方。24 台が 1 段）・入りきらないときは先に並べ替えの案内の字を畳み、
//   それでも入らなければ「ほか N 台 ▾」・更新の点は字の右の余白に／3D の赤い札・汚れの肉厚の札はコイルの外へ伸ばす・凡例は狭いとき言い添えを畳んだ
//   短い言葉で全部の項目を 2 行までに（全文は説明に）・札のまわりに 2px 空けて重なりをほどく
// 新しい案（P1 からの違い）:
// P2 道具の行・件数の行の字を M5 と同じ 12.5px に（もう 1 段詰める）
// P3 見出し帯の状態の札を「● 接続・待機中」に縮め、データ元は説明に（見出し帯の右に余裕を作る）
// P4 3D の札は見ている工程の大事な物だけ（狭い窓では薄い注記を出さない）。隠した数に入れる
// 持ち越し: 2 回目の M5・E（P1 の上に、2 回目と同じ CSS を当てる）

import { PROPOSALS as SECOND } from "./2026-10-narrow-2.mjs";

const MEDIA = "@media (max-width:1440px)";

export const PROPOSALS = [
  { key: "P1", name: "土台（本物）: 字は変えず余白と飾りを詰める・設備は詰めて 1 段・凡例は短い言葉で 2 行・札は外へ", css: "", ops: [] },
  { key: "P2", name: "P1＋道具の行・件数の行の字を 12.5px に",
    css: `${MEDIA}{ .ll-screen{--ll-fs:12.5px;--ll-h:28px} .ll-status{font-size:12.5px} .ll-fresh,.ll-zoombtn{font-size:12px} .ll-atab{font-size:12px} }`, ops: [] },
  { key: "P3", name: "P1＋見出し帯の状態の札を「● 接続・待機中」に縮める（データ元は説明に）",
    css: `${MEDIA}{ #modeBadge{display:none} }`, ops: [] },
  { key: "P4", name: "P1＋3D の札は見ている工程の大事な物だけ（薄い注記を出さない。隠した数に入れる）",
    css: `${MEDIA}{ .x-label.muted:not(.tip){visibility:hidden!important} }`,
    ops: [["script", `setInterval(() => { const n = document.querySelector("#explainStage .x-hidden-note"); if (!n || innerWidth > 1440) return;
      const k = [...document.querySelectorAll("#explainStage .x-label.muted:not(.tip)")].filter((x) => x.style.display !== "none").length
        + [...document.querySelectorAll("#explainStage .x-label.x-hide:not(.muted)")].length;
      n.hidden = !k; n.textContent = "札 " + k + " 個を隠しています（ホイールで近づけると出ます）"; }, 200);`]] },
  ...SECOND.filter((p) => ["M5", "E"].includes(p.key)),
];
