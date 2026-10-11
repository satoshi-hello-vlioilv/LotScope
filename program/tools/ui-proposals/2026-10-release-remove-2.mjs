// 2026-10「版を消す」の 2 回目: 1 回目の上位 3 案（A・C・B）と、エッセンスを組んだ複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-release-remove-2.mjs --states master-release
// K1 = A ＋ C の「結果が見える」（消した版を表の下に 1 行残す）／K2 = A ＋ B の「静かさ」（枠の無い灰の字・乗せた行で赤）／
// K3 = K2 ＋ K1／K4 = A ＋ C の見せ方（2 回押したあと、行を打ち消し線で「消しています…」）
import { PROPOSALS as FIRST } from "./2026-10-release-remove.mjs";

let marks = 100;
const after = (fn) => { const mark = `px${++marks}`; return ["script", `
  const box = document.querySelector('#masterSettings');
  const run = () => { const t = box.querySelector('.dz-flow') && box.querySelector('.pz-table'); if (!t || t.dataset.${mark}) return; t.dataset.${mark} = '1'; (${fn})(box); };
  new MutationObserver(run).observe(box, { childList: true }); run();`]; };
const pick = (k) => FIRST.find((p) => p.key === k);
const [armOld] = pick("A").ops;
const QUIET = `.pz-btn.dz-rm{border-color:transparent;background:none;color:var(--muted)}
  .pz-table tr:hover .pz-btn.dz-rm,.pz-table tr.px-hover .pz-btn.dz-rm{color:var(--danger);border-color:var(--danger-line)}
  .pz-btn.dz-rm.is-armed{color:var(--on-fill);background:var(--danger);border-color:var(--danger)}`;
const GONE = `.px-gonebar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px dashed var(--line);font-size:12.5px;color:var(--muted)}
  .px-gonebar b{color:var(--ink);text-decoration:line-through}`;
const goneRow = after(`(box) => { box.querySelector('.pz-table').insertAdjacentHTML('afterend',
  '<div class="px-gonebar">消した版 <b>3.10.0</b>（10/11 12:40 user）— もう一度使うときは「ZIP から版を置く…」で置き直せます</div>'); }`);

export const PROPOSALS = [
  { ...pick("A"), key: "A" },
  { ...pick("C"), key: "C" },
  { ...pick("B"), key: "B" },
  { key: "K1", name: "A ＋ 消した版を表の下に 1 行残す", css: GONE, ops: [armOld, goneRow] },
  { key: "K2", name: "A ＋ 静かな灰の「消す」（乗せた行で赤・2 回押し）", css: QUIET, ops: [armOld] },
  { key: "K3", name: "K2 ＋ 消した版を表の下に 1 行残す", css: QUIET + GONE, ops: [armOld, goneRow] },
  {
    key: "K4", name: "A ＋ 2 回押したあと、行を打ち消し線で「消しています…」",
    css: `.px-gone td{color:var(--muted);text-decoration:line-through;background:var(--surface-5)}.px-gone td.pz-acts{text-decoration:none;color:var(--danger)}`,
    ops: [after(`(box) => { const r = [...box.querySelectorAll('.pz-table tbody tr')].find((x) => x.querySelector('.pz-ver').textContent === '3.11.0');
      r.classList.add('px-gone'); r.querySelector('.pz-acts').innerHTML = '<i class="wait-spin" aria-hidden="true"></i> 消しています…'; }`)],
  },
];
