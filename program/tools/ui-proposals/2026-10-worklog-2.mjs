// 2026-10「作業実績」の設備の選び方 2 回目（1 回目の 1 位 D 79.5 点が 80 点に届かない → 上位 3 案＋複合 4 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-worklog-2.mjs --states worklog
// 試験用の作業実績は設備 12 台（SL3 はファイルが見つからない・HOT は 80 時間更新が止まっている）。
//
// 1 回目で効いて見えたエッセンス:
//   D … 紙のタブで「どの設備の一覧か」が一覧とつながって見える（2 段目のタブ）
//   A … 札が全部見えて 1 押しで替わる・押せない設備が形で分かる
//   G … 設備の様子（最後の更新・ファイルなし）が札の上で分かる。ただし全部の札に時刻を出すと読む量が倍になる
// 複合: H1 = D＋G を「印だけ」（古い・見つからない設備にだけ点）、H2 = A＋同じ印、H3 = D＋選んでいる設備にだけ最後の更新、
//       H4 = D＋G の 2 段（全部の札に時刻）

import { PROPOSALS as FIRST } from "./2026-10-worklog.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const D_CSS = pick("D").css;
// 古い設備に橙の点・見つからない設備は今の「!」（どちらも札の右上。正常な設備には何も足さない＝読む量を増やさない）
const DOT = `#llEquipBar .eq-chip.is-stale::after{content:"";position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:#dc7f2a;box-shadow:0 0 0 2px var(--surface)}
  #llEquipBar .eq-chip.is-stale[aria-selected=true]::after{box-shadow:0 0 0 2px var(--ll-teal)}`;
const WHEN = `
  const add = () => document.querySelectorAll('#llEquipBar .eq-chip').forEach((b) => {
    if (b.querySelector('.eq-sub')) return;
    if (ONLY_SELECTED && b.getAttribute('aria-selected') !== 'true') return;
    b.insertAdjacentHTML('beforeend', '<small class="eq-sub">' + (b.dataset.when || 'ファイルなし') + '</small>');
  });
  new MutationObserver(add).observe(document.querySelector('#llEquipBar'), { childList: true, subtree: true }); add();`;

export const PROPOSALS = [
  { ...pick("D"), key: "D", name: "タブの中のタブ（1 回目 1 位）" },
  { ...pick("A"), key: "A", name: "一覧の上に設備の札の帯（1 回目 2 位）" },
  { ...pick("G"), key: "G", name: "札に最後の更新を添える（1 回目 3 位）" },
  { key: "H1", name: "D の紙のタブ＋古い・見つからない設備にだけ印", css: D_CSS + DOT, ops: [] },
  { key: "H2", name: "A の札の帯＋古い・見つからない設備にだけ印", css: DOT, ops: [] },
  {
    key: "H3", name: "D の紙のタブ＋選んでいる設備にだけ最後の更新", css: D_CSS + DOT + `.eq-sub{margin-left:8px;font-size:11px;font-weight:600;color:var(--muted)}`,
    ops: [["script", "const ONLY_SELECTED = true;" + WHEN]],
  },
  {
    key: "H4", name: "D の紙のタブを 2 段（名前＋最後の更新）", css: D_CSS + DOT + `#llEquipBar .eq-chip{height:42px;display:inline-flex;flex-direction:column;justify-content:center;line-height:1.15}
      .eq-sub{font-size:10.5px;font-weight:600;opacity:.75}`,
    ops: [["script", "const ONLY_SELECTED = false;" + WHEN]],
  },
];
