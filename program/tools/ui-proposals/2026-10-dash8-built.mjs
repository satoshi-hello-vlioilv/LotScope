// 2026-10-dash8 で決めた J（2 回目 82.6 点）を作った後（作った物そのもの。案の CSS・DOM は当てない）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dash8-built.mjs --states dash-ops-lead,dash-eorder,dash-swap-pop,dash-hide-pop,dash-hstack --from dash   （1536x864・1280x720 でも）
// 作るときに、2 回目の採点で残った弱い所も直した: ⋮⋮ を本当に引いて並べられる（評価関数 ui-eval-dash8.mjs で確かめる）・13 台からは 2 段組み（縦に長くならない）・
// 入れ替えた印はアプリが 1 つだけ描く・全設備をリードタイムにすると出す項目の言葉も「平均作業・平均 LT」・「全設備の時間」の添え書きを入力の列にそろえる
export const PROPOSALS = [{ key: "built", name: "作った物（J: 設備の並びは枠で囲んだ番号つきの表・出す項目は全設備の時間の下・作業開始と作業終了は品種の下・入れ替えた印）", css: "", ops: [] }];
