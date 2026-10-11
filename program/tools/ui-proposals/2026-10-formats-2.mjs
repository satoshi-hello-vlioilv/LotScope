// 2026-10「共有の書式」2 回目（1 回目の 1 位 E 76.5 点が 80 点に届かない → 上位 3 案＋複合 4 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-formats-2.mjs --states formats,formats-pick,formats-applied
//
// 1 回目で効いて見えたエッセンス:
//   E … 行の主の行動を「当てる」1 つに（上書き・削除は「…」）。部品を札にして、読まずに中身が分かる
//   G … 件数の行に「書式 ○○」の札。窓を開かずに、いまの書式が分かる
//   H … 設備を選ぶとき、各設備にいま当たっている書式が見える（ただし表にすると広く読みにくい → 名前の横に小さく）
//   A の弱い所 … 当てた結果と「元に戻す」が窓のいちばん下で、押した所から遠い → 結果を一覧のすぐ上（当てる所の下）に
// 複合: K1 = E＋G ／ K2 = E＋G＋結果を一覧の上に ／ K3 = E＋G＋結果を上に＋設備の名前の横にいまの書式（H を小さく）／
//       K4 = E＋結果を上に＋当てる所を 1 行にたたむ（設備は 4 列）

import { PROPOSALS as FIRST } from "./2026-10-formats.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const E = pick("E"), G = pick("G"), D = pick("D");
const TOP = `#llFormatPanel .fm-msg{order:-1;grid-row:3;padding:6px 10px;border-radius:7px;background:var(--ok-soft)}
  #llFormatPanel .fm-msg.is-ng{background:var(--danger-bg)}
  #llFormatPanel .fm-head{order:-3}#llFormatPanel .fm-to{order:-2}`;
const CUR = ["script", `
  const sync = () => {
    const ap = JSON.parse(localStorage.getItem('tpa.lotlist.formatApplied.v1') || '{}');
    document.querySelectorAll('#llFormatPanel .fm-equips input[data-key]').forEach((i) => {
      const l = i.closest('label'); if (l.querySelector('.px-cur')) return;
      const a = ap[i.dataset.key]; if (a) l.insertAdjacentHTML('beforeend', '<small class="px-cur">' + a.name + '</small>');
    });
  };
  new MutationObserver(sync).observe(document.querySelector('#llFormatPanel'), { childList: true, subtree: true }); sync();`];
const CUR_CSS = `.px-cur{font-size:10.5px;color:var(--ll-teal-dark);background:var(--ll-pale);border-radius:999px;padding:0 6px;margin-left:2px}`;

export const PROPOSALS = [
  { ...E, key: "E", name: "行は「当てる」だけ・部品は札（1 回目 1 位）" },
  { ...G, key: "G", name: "件数の行に「書式: ○○」の札（1 回目 2 位）" },
  { ...D, key: "D", name: "当てる所は「当てる ▾」の後で聞く（1 回目 3 位）" },
  { key: "K1", name: "E＋G（行は当てるだけ＋件数の行に書式の札）", css: E.css + G.css, ops: [...E.ops, ...G.ops] },
  { key: "K2", name: "E＋G＋当てた結果を一覧の上に", css: E.css + G.css + TOP, ops: [...E.ops, ...G.ops] },
  { key: "K3", name: "E＋G＋結果を上に＋設備の横にいまの書式", css: E.css + G.css + TOP + CUR_CSS, ops: [...E.ops, ...G.ops, CUR] },
  {
    key: "K4", name: "E＋結果を上に＋当てる所を 1 行にたたむ", css: E.css + TOP + `
      #llFormatPanel .fm-to{border:0;padding:0;background:var(--surface-2);border-radius:8px;padding:6px 10px}
      #llFormatPanel .fm-to legend{float:left;padding:0 8px 0 0}
      #llFormatPanel .fm-equips{display:grid;grid-template-columns:repeat(4,1fr)}
      #llFormatPanel .fm-equips[hidden]{display:none}`,
    ops: [...E.ops],
  },
];
