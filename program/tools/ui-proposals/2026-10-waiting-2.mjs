// 2026-10 待ちの窓 2 回目（1 回目は A・F 78.5 点・D 78 点で 80 点に届かない）。1 回目の上位 3 案（A・F・D）と複合 4 案。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-waiting-2.mjs --states waiting
//
// 1 回目で効いて見えたエッセンス:
//   A … 問い合わせ中の窓と同じ形（見慣れた形）。何を・どこから・いま何を・何秒・裏で続ける、が揃う
//   F … 輪と 1 行だけで、読む量が最も少ない
//   D … アプリの形（周期の山）が流れ、待つ時間も「このアプリ」に見える。起動画面の進み具合と同じ形
//   B … 窓の上端の流れる帯は、窓が出た瞬間に「動いている」と分かる
// 1 回目で弱かった所: 控えの文（3 行）が長い。E の段取りは、配布の置き場を読む 1 回の問い合わせには本当の段が無く、
//   見せると「正しくない進み具合」になる（決まった段を後から当てない）
// 複合: R1 = A の形＋F の短さ（控えを 1 行に・淡く）／R2 = A＋D（輪の代わりに流れる山）／R3 = A＋B（上端の帯）＋控え 1 行／
//       R4 = D＋F（流れる山・題・1 行・秒だけ）

import { PROPOSALS as FIRST } from "./2026-10-waiting.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const A = pick("A"), F = pick("F"), D = pick("D"), B = pick("B");
const SHORT = `.tpa-wait .wait-note{background:transparent;padding:0;margin-top:6px;font-size:12px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}`;

export const PROPOSALS = [
  { ...A, key: "A", name: "問い合わせ中の窓と同じ形（1 回目 1 位）" },
  { ...F, key: "F", name: "輪と 1 行だけ（1 回目 1 位と同点）" },
  { ...D, key: "D", name: "周期の山が流れる絵（1 回目 3 位）" },
  { key: "R1", name: "A の形＋控えを 1 行に（F の短さ）", css: SHORT, ops: [] },
  { key: "R2", name: "A＋輪の代わりに流れる山（D）＋控え 1 行", css: D.css + SHORT, ops: D.ops },
  { key: "R3", name: "A＋上端の流れる帯（B）＋控え 1 行", css: B.css.replace(".tpa-wait .fetch-time{font-size:20px;font-weight:800;color:var(--ink)}", "") + SHORT, ops: [] },
  { key: "R4", name: "流れる山＋題・1 行・秒だけ（D＋F）", css: D.css + `.tpa-wait .wait-note,.tpa-wait .wait-from{display:none}`, ops: D.ops },
];
