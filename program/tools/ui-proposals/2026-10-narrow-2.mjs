// 2026-10 表示の下限を広げる・2 回目。1 回目（2026-10-narrow.mjs）は 7 案とも 95 点に届かず（1 位 F 56.4 点）、案出しからやり直す。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-narrow-2.mjs --view 1280x720 --states list,crowded,worklog-many,calc3d
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-narrow-2.mjs --states list,worklog-many,calc3d
// 1 回目の採点で効いて見えたエッセンスと、残った問題（採点者の言葉）:
//   A の見出し帯の畳み方（副題と QUALITY ANALYSIS）・E の「言葉も置き場も変えずに詰める」・B の「ほか N 台 ▾」で隠れた台数が読める・
//   G の 3D の札を大事な物だけに・D の凡例を模型の外に。問題: 幅で言葉が変わる（A）・しまうと 1 手増える（B・G）・2 段は縦を食う（F）・
//   件数の行の「並べ替え」の札が全部の案で切れる・内径の札がコイルの線に被る・広い画面（1728）を悪くした案があった
// 2 回目の土台 M1 は本物のコード（版 3.32.0 の作り。案の CSS は当てない）:
//   見出し帯＝狭い窓（1440px 以下）で飾りの字（QUALITY ANALYSIS・副題・「データ元:」）を畳み、タブの余白を詰める（言葉・ボタンは変えない）
//   道具の行＝言葉を変えずしまいもせず、余白と間だけ詰める／件数の行＝入りきらないときは「効いている物」と名前を畳む（種類と数は残す）
//   設備＝1 段。入りきらない後ろの設備を「ほか N 台 ▾」に（いま見ている設備は残す・広い画面でも同じ）
//   3D＝凡例は模型の下の帯（狭い・低い 3D では 1 行＋「凡例をすべて ▸」）・重なる札は大事な方を残して隠し、隠した数を右上に・
//   薄い注記に地の色・内径の札はコイルの外へ伸ばす
// 新しい案（M1 からの違い）:
// M2 設備は 2 段を許す（全部の設備がいつも見える。F の良い所）
// M3 3D の凡例を右の説明の頭へ（D）。説明は開いておく。模型の下の帯は無し
// M4 3D の札は見ている工程の大事な物だけ（G）: 狭い窓では薄い注記を出さない
// M5 道具の行・件数の行だけ字を 1 段小さく（E の詰め方を道具の行に限る）
// 持ち越し: 1 回目の F・E（上位 2 案）

import { KIT, PROPOSALS as FIRST } from "./2026-10-narrow.mjs";

const MEDIA = "@media (max-width:1440px)";
const legendToText = ["script", `setInterval(() => {
  const t = document.querySelector("#explainText"), lg = document.querySelector("#explainStage .x-legend .lg-items");
  if (!t || !lg || !t.children.length || t.querySelector(".nw-lg")) return;
  document.querySelector("#explainBody")?.classList.remove("text-closed");
  t.insertAdjacentHTML("afterbegin", '<div class="nw-lg">' + lg.innerHTML + '</div>');
}, 250);`];

export const PROPOSALS = [
  { key: "M1", name: "土台: 飾りを畳む・余白を詰める・設備は ほか N 台・凡例は模型の下の帯（本物）", css: "", ops: [] },
  { key: "M2", name: "M1＋設備は 2 段を許す（全部いつも見える）",
    css: `.eq-chips{flex-wrap:wrap!important;overflow:visible!important}.eq-chips > .eq-chip[hidden]{display:inline-flex!important;align-items:center}.eq-more{display:none!important}`, ops: [] },
  { key: "M3", name: "M1＋凡例は右の説明の頭へ（説明は開く）",
    css: `.x-legend{display:none!important}
      .explain-text .nw-lg{display:flex;flex-wrap:wrap;gap:3px 12px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line-soft);font-size:11.5px;color:var(--muted)}
      .explain-text .nw-lg span{display:inline-flex;align-items:center;gap:5px}
      .explain-text .nw-lg .lg-line{display:inline-block;width:3px;height:12px;background:var(--x-defect);margin-right:-2px}
      .explain-text .nw-lg .lg-dot{width:9px;height:9px;border-radius:50%;background:var(--x-defect);display:inline-block}
      .explain-text .nw-lg .lg-sw{width:14px;height:9px;border-radius:2px;display:inline-block}
      .explain-text .nw-lg i{font-style:normal}`, ops: [legendToText] },
  { key: "M4", name: "M1＋3D の札は見ている工程の大事な物だけ（狭い窓では薄い注記を出さない）",
    css: `${MEDIA}{ .x-label.muted:not(.tip){display:none!important} }`, ops: [] },
  { key: "M5", name: "M1＋道具の行・件数の行だけ字を 1 段小さく",
    css: `${MEDIA}{ .ll-screen{--ll-fs:12.5px;--ll-h:28px} .ll-status{font-size:12.5px} .ll-fresh,.ll-zoombtn{font-size:12px} .ll-atab{font-size:12px} }`, ops: [] },
  ...FIRST.filter((p) => ["F", "E"].includes(p.key)).map((p) => ({ ...p, ops: [KIT, ...p.ops.filter((o) => o !== KIT)] })),
];
