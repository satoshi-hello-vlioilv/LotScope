// 2026-10「起動画面」3 回目の見直しの 2 回目（1 回目は P6 82.5 点・P2 80.5 点が僅差）。1 回目の上位 3 案（P6・P2・P4）と複合 4 案。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-splash-4.mjs --states splash,splash-fail
//
// 1 回目で効いて見えたエッセンス:
//   P6 … 周期の山の線が段ごとに描かれていく。遠くからでも進み具合が分かり、アイコンと同じ形でアプリらしい。止まると線もそこで止まる
//   P2 … 下の模様が暗い面を埋め、寂しさが消える（ただし模様は飾りで、何も伝えない）
//   P4 … アイコンの光の輪で、名乗りに目が行く
// 弱かった所: P6 は進み具合の線が名乗りから離れた画面の下にあり、いまの段の字（中央）と目の行き来が要る。「3 / 4」も消えた
// 複合: Q1 = P6＋P4 の光の輪／Q2 = P6 の線を名乗りのすぐ下へ（帯の代わり。いまの段の字と 3 / 4 はその下）／
//       Q3 = Q2＋P2 の淡い模様を下に（暗い面を埋める）／Q4 = Q2＋P4 の光の輪

import { PROPOSALS as FIRST } from "./2026-10-splash-3.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const P6 = pick("P6"), P2 = pick("P2"), P4 = pick("P4");
const GLOW = `.logo{width:132px;height:132px;filter:drop-shadow(0 0 40px rgba(47,138,128,.6)) drop-shadow(0 14px 30px rgba(0,0,0,.35))}`;

/** 名乗りのすぐ下に、進み具合の山の線（9 つの山。段が 1 つ済むごとに 1/4 ずつ描く）を置く */
function near(n = 9) {
  const w = 560, h = 70, step = w / n;
  let d = `M0 ${h - 4}`;
  for (let i = 0; i < n; i++) { const x = i * step + step / 2; d += ` L${x - step * 0.22} ${h - 4} L${x} 6 L${x + step * 0.22} ${h - 4}`; }
  d += ` L${w} ${h - 4}`;
  return `<svg class="qx-run" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/><path class="on" pathLength="1" d="${d}"/></svg>`;
}
const NEAR_CSS = `.seg{display:none}
  .qx-run{display:block;width:560px;height:70px;margin:40px auto 0;overflow:visible}
  .qx-run path{fill:none;stroke:rgba(127,211,201,.18);stroke-width:3.5;stroke-linejoin:round;stroke-linecap:round}
  .qx-run .on{stroke:var(--mint);stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .6s ease;filter:drop-shadow(0 0 6px rgba(127,211,201,.5))}
  body[data-done="1"] .qx-run .on{stroke-dashoffset:.75}body[data-done="2"] .qx-run .on{stroke-dashoffset:.5}
  body[data-done="3"] .qx-run .on{stroke-dashoffset:.25}body[data-done="4"] .qx-run .on{stroke-dashoffset:0}
  body.is-fail .qx-run{display:none}
  .run{width:560px;margin-top:6px}`;
const DONE = P6.ops[P6.ops.length - 1];     // 済んだ段の数を body の data-done に写す（P6 の最後の操作）
const NEAR_OPS = [["insert", near(), "beforebegin", ".run"], DONE];

export const PROPOSALS = [
  { ...P6, key: "P6", name: "周期の山の線が描かれていく（1 回目 1 位）" },
  { ...P2, key: "P2", name: "背景に周期の山の模様（1 回目 2 位）" },
  { ...P4, key: "P4", name: "光の輪・帯を太く広く（1 回目 3 位）" },
  { key: "Q1", name: "P6＋アイコンの光の輪", css: P6.css + GLOW, ops: P6.ops },
  { key: "Q2", name: "山の線を名乗りのすぐ下に（帯の代わり）", css: NEAR_CSS, ops: NEAR_OPS },
  { key: "Q3", name: "Q2＋下に淡い模様", css: NEAR_CSS + P2.css.replace(/\.run\{[^}]*\}/, "").replace(/\.seg\{[^}]*\}\.seg i\{[^}]*\}\.step\{[^}]*\}/, "")
      + `.px-wave path{stroke:rgba(127,211,201,.07)}.px-wave path.b{stroke:rgba(127,211,201,.04)}`,
    ops: [P2.ops[0], ...NEAR_OPS] },
  { key: "Q4", name: "Q2＋アイコンの光の輪", css: NEAR_CSS + GLOW, ops: NEAR_OPS },
];
