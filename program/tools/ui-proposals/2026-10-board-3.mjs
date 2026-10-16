// 2026-10 合わせた表を組む所の置き方（版 3.38.0。利用者の要望 2）。3 回目（合格点 80 点。最後の回）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-board-3.mjs --states dash-board,dash-board-group
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-board-3.mjs --states dash-board,dash-board-group --view 1280x720
// 2 回目（2026-10-board-2.mjs）の 1 位は C2（形の札を表全体の選び 1 つに畳む・行の札は 1 列の順位つき・札の頭に色の線）87.1 点・2 位 W 86.3 点（合格点 90 に届かず）。
// 採点者の指摘（C2 を土台に）:
//   ①説明を寄せる CSS（.de-hint の左 60px）が ② の条件の説明「すべての行を数えます」にも効き、欄の列から約 75px 右へずれる → 表全体の面だけに効かせる
//   ②W の見本つきの見せ方の札を足すと視覚化が上がる
//   ③Q の 2 列（右に行の札）は、並びの 2 つ目の選び（① 仕掛ロット数の計）が折れない幅で入れれば、13 行が送らずに見える
//   ④「形」の選びを、ほかのパネルと同じ札の形にそろえる（選んだ 1 枚の札＋「形を変える…」）
// 持ち越し（直した）: C3（C2＋①）・CW（C3＋②）
// 新しい案（3 つ）:
//   CQ C3＋③（表全体を 2 列: 左＝形・行・並び〈2 つ目の選びは次の段に置き、折れない〉、右＝行の札）
//   CF C3＋④（形は、ほかのパネルと同じ札 1 枚〈合わせた表〉と「形を変える…」。押すと 16 の形の札が開く）
//   CA C3＋②＋③＋④（全部）

const watch = (sel, fn) => ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.pv) return; el.dataset.pv = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];

const c3 = `
#dbEditor.is-board .de-vis{display:none}
#dbEditor .pv-form select{flex:1 1 auto;min-width:0;max-width:420px}
#dbEditor .de-rows{grid-template-columns:minmax(0,1fr);max-width:380px;counter-reset:rk}
#dbEditor .de-rowi{counter-increment:rk}
#dbEditor .de-rowi::before{content:counter(rk);width:1.6em;text-align:right;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
#dbEditor #deBoard .de-row .de-hint{flex-basis:100%;margin-left:60px}
#dbEditor .de-tabs{gap:0;padding:10px 10px 0}
#dbEditor .de-tab{border-radius:0;margin-left:-1px;padding:7px 12px 6px;background:var(--surface-2,#f4f6f8)}
#dbEditor .de-tab:first-child{border-radius:8px 0 0 0;margin-left:0}
#dbEditor .de-tab:not(.is-add):last-of-type{border-radius:0 8px 0 0}
#dbEditor .de-tab.on{background:var(--surface);box-shadow:inset 0 -3px 0 var(--h-input);z-index:1}
#dbEditor .de-tab i{left:0;right:0;width:auto;top:0;bottom:auto;height:4px}
#dbEditor .de-tab.is-add{margin-left:8px;border-radius:8px 8px 0 0;border-style:dashed}`;
const formSelect = watch("#deBoard > .de-row:first-child", `(r) => {
  r.insertAdjacentHTML('beforebegin', '<div class="de-row pv-form" data-pv="1"><label class="de-l">形</label><select aria-label="形"><option>合わせた表（行をそろえて、データの数を横に並べる）</option><option>表</option><option>数字</option><option>縦棒</option><option>横棒</option><option>時系列</option></select></div>');
}`);
const formCard = {
  css: `#dbEditor .pv-fc{display:flex;align-items:center;gap:8px}
#dbEditor .pv-fc .pv-cbtn{flex:0 0 auto;min-width:180px;justify-content:flex-start}
#dbEditor .pv-fc small{color:var(--muted);font-size:12px}`,
  op: watch("#deBoard > .de-row:first-child", `(r) => {
    r.insertAdjacentHTML('beforebegin', '<div class="de-row pv-fc" data-pv="1"><label class="de-l">形</label><button type="button" class="pv-cbtn on" aria-pressed="true"><svg class="pv-ico" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M3 4h14v12H3zM3 8h14M7 4v12M12 4v12"/></svg><span>合わせた表</span></button><button type="button" class="pv-btn">形を変える…</button><small>行をそろえて、データの数を横に並べる</small></div>');
  }`),
};
const look = {
  css: `
#dbEditor .de-segs{border:0;gap:6px;overflow:visible}
#dbEditor .de-seg{flex-direction:column;align-items:flex-start;height:auto;gap:3px;padding:6px 10px;border:1px solid var(--edit-line);border-radius:8px}
#dbEditor .de-seg + .de-seg{border-left:1px solid var(--edit-line)}
#dbEditor .de-seg .pv-mini{display:flex;align-items:center;gap:4px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink)}
#dbEditor .de-seg .pv-mini i{display:block;width:34px;height:7px;border-radius:3px;background:linear-gradient(90deg,var(--h-input) 70%,var(--surface-4) 70%)}
#dbEditor .de-seg .pv-mini s{text-decoration:none;padding:0 5px;border-radius:4px;background:rgba(47,125,120,.35)}
#dbEditor .de-seg.on{border-color:var(--h-input);box-shadow:0 0 0 2px rgba(63,101,145,.18)}
#dbEditor .de-sws::before{content:"色";font-size:12.5px;font-weight:800;color:var(--h-meta);margin-right:4px;align-self:center}`,
  op: watch("#deLook .de-seg", `(l) => {
    const v = l.querySelector('input').value, mini = { bar: '<i></i>231', heat: '<s>3</s><s style="background:rgba(47,125,120,.15)">1</s>', num: '231　0　4' }[v];
    l.insertAdjacentHTML('beforeend', '<span class="pv-mini">' + mini + '</span>');
  }`),
};
const twoCols = {
  css: `
#dbEditor #deBoard{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:4px 14px;align-items:start}
#dbEditor #deBoard > .de-row{grid-column:1}
#dbEditor #deBoard > .de-row.de-top{grid-column:2;grid-row:1 / span 8;flex-wrap:wrap}
#dbEditor #deBoard > .de-row.de-top > .de-l{display:none}
#dbEditor #deBoard > .de-row.de-top::before{content:"行の並び（引く・↑↓・出す）";display:block;width:100%;font-size:12.5px;font-weight:800;color:var(--h-meta);margin-bottom:4px}
#dbEditor #deBoard .de-rows{max-width:none}
#dbEditor #deBoard [data-de-border]{flex:1 1 auto}
#dbEditor #deBoard [data-de-bgroup]{flex:1 1 100%;margin-left:60px;max-width:calc(100% - 60px)}`,
};

export const PROPOSALS = [
  { key: "C3", name: "C2（形の選び 1 つ・順位つきの行の札・色の線）＋説明のずれを直す", css: c3, ops: [formSelect] },
  { key: "CW", name: "C3＋見せ方を見本つきの札に", css: c3 + look.css, ops: [formSelect, look.op] },
  { key: "CQ", name: "C3＋表全体を 2 列（右に行の札・並びの選びは折れない）", css: c3 + twoCols.css, ops: [formSelect] },
  { key: "CF", name: "C3＋形はほかのパネルと同じ札 1 枚と「形を変える…」", css: c3 + formCard.css, ops: [formCard.op] },
  { key: "CA", name: "全部（C3＋見本つきの見せ方＋2 列＋形の札）", css: c3 + look.css + twoCols.css + formCard.css, ops: [formCard.op, look.op] },
];
