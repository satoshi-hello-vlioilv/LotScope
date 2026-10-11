// 2026-10 マスタ管理「作業実績」2 回目（1 回目は E 79.5 点が 80 点に届かない）。1 回目の上位 3 案（E・D・B）と複合 4 案。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-worklog-master-2.mjs --states master-worklog
// 1 回目のあとに、どの案にも出ていた崩れを本体で直した（フォルダの欄の高さが 18px に潰れる・「古い」の札が切れる）。
//
// 1 回目で効いて見えたエッセンス:
//   E … 直すべき物（見つからない・古い）と次の手が頁の上に出て、表を見て回らなくてよい
//   D … フォルダを 1 行にして縦を空け、数の札（表示・見つからない・古い）で全体が一目で分かる
//   B … ① フォルダを決めて探す → ② 表示する設備を選ぶ の順が見える
// 1 回目で弱かった所（どの案にも共通）: 行ごとに赤い「登録を消す」が並んで騒がしい・行ごとに「表示」の字が繰り返す
// 複合: K1 = E＋D／K2 = E＋B／K3 = E＋D＋行を静かに（「表示」の字を外し、「登録を消す」は行にマウスを乗せたときだけ）／
//       K4 = 直す行を表の上に寄せて色で示す（E の「先に」を表の中で）＋D＋行を静かに

import { PROPOSALS as FIRST } from "./2026-10-worklog-master.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const E = pick("E"), D = pick("D"), B = pick("B");
const D_CSS = D.css.replace(".wl-src{grid-template-columns:auto minmax(0,1fr) 190px auto;", ".wl-src{grid-template-columns:minmax(0,1fr) 260px auto;")
  + ".wl-field .ps-input{flex:1}";   // 横並びの欄は幅いっぱいに
const QUIET = `.wl-switch span{display:none}
  .wl-tablelist [data-wl="del"]{opacity:0;transition:opacity .12s}
  .wl-tablelist tr:hover [data-wl="del"],.wl-tablelist [data-wl="del"]:focus-visible{opacity:1}`;
const scriptOf = (p) => p.ops.filter((o) => o[0] === "script");

export const PROPOSALS = [
  { ...E, key: "E", name: "直すべき物を先に（1 回目 1 位）" },
  { ...D, key: "D", name: "フォルダを 1 行・数の札（1 回目 2 位）" },
  { ...B, key: "B", name: "番号つきの段（1 回目 3 位）" },
  { key: "K1", name: "E＋D（直すべき物を先に・フォルダ 1 行・数の札）", css: E.css + D_CSS, ops: [...scriptOf(D), ...scriptOf(E)] },
  { key: "K2", name: "E＋B（① 探す → 直すべき物 → ② 表示する設備）", css: E.css + B.css, ops: [...scriptOf(B), ...scriptOf(E)] },
  { key: "K3", name: "E＋D＋行を静かに（「表示」の字なし・消すはマウスを乗せたときだけ）", css: E.css + D_CSS + QUIET, ops: [...scriptOf(D), ...scriptOf(E)] },
  {
    key: "K4", name: "直す行を表の上に寄せて色で示す＋D＋行を静かに",
    css: D_CSS + QUIET + `.wl-tablelist tr.px-fix td{background:var(--amber-pale)}.wl-tablelist tr.px-fix td:first-child{box-shadow:inset 4px 0 0 #dc7f2a}`,
    ops: [...scriptOf(D), ["script", `
      const box = document.querySelector('#masterSettings');
      const run = () => { const tb = box.querySelector('.wl-tablelist tbody'); if (!tb || tb.dataset.px2) return; tb.dataset.px2 = '1';
        [...tb.rows].filter((r) => r.querySelector('.c-off, .c-warn')).reverse().forEach((r) => { r.classList.add('px-fix'); tb.prepend(r); }); };
      new MutationObserver(run).observe(box, { childList: true, subtree: true }); run();`]],
  },
];
