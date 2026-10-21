// 2026-10-ops4 で決めた T（84.6 点）を作った後（作った物そのもの。案の CSS・DOM は当てない）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops4-built.mjs --states dash-ops,dash-ops-edit --from dash   （1536x864・1280x720 でも）
// 作るときに、3 回目の採点で残った弱い所も直した: パレート図の左上は「上位 7 / 全 11 品種」（右の表が全部を出さないときに言葉が食い違った）・
// ABC の下の段も「区間なし n 本」（ガントと同じ言葉）・作業中の棒の白い縞を淡く、字に縁（縞が字を横切って読みにくかった）・
// 行の札のわけは理由ごとの短い言い方（終了の記録なし・終了に時刻なし・終了が読めない・終了が開始より前・開始が読めない）
export const PROPOSALS = [{ key: "built", name: "作った物（T: 見出しの「区間なし n 本 設備」の札＋行の「区間なし n・わけ」の札）", css: "", ops: [] }];
