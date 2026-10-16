// 2026-10 合わせた表（版 3.38.0。利用者の要望 2「設備ごとの仕掛と前日の実績について、設備の並びの変更やデザインの変更ができるように。
// この部分だけ汎用の枠外なので、ダッシュボードの汎用の仕組みの中でできるだけ動かせるように」）を組む所の置き方。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-board.mjs --states dash-board,dash-board-group
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-board.mjs --states dash-board,dash-board-group --view 1280x720
// 前（版 3.37.0）: 1 枚の表は組めなかった（「組む」を押すと「この表は組み替えられません」。並びは仕掛ロット数の多い順で固定・見た目も固定）。
//   集計対象の条件だけ、表の上の「仕掛の対象」「実績の対象」の札から全員で 1 つを変えられた。
// 作った土台（どの案も同じ中身）: 表を「合わせた表」（行の段＝設備を共通にして、列のまとまりを横に並べる）の 1 つにし、組む所に
//   表全体（行の段・並び〈値の大きい順・名前の順・設備の並び・手で並べた順〉・行の札〈⋮⋮ で引く・↑↓・出す〉）と、
//   まとまりごと（ほかのパネルと同じカラムの札・文・データ・条件・期間＋見せ方〈棒と数・数と濃淡・数だけ〉・色・計の列・0 の行に印・見出し）。
// 案の方向（置き場・見せ方・流れ）:
//   T 上の札で切り替える（今の作り。表全体 ｜ ① ｜ ② ｜ ＋）
//   S 札を表の見出しの形に（見せ方: 札を、パネルの表と同じ並び・同じ色の見出しの帯にする。どの札が表のどこかが一目で分かる）
//   L 左の柱に縦の札（置き場: 表全体・まとまりを左に縦に並べ、右に中身。札の字が切れない）
//   D 表の上で直接（流れ: 行の並べ替え・隠すは大きく出したパネルの表の上で行う。組む所は並びの決め方だけ）
//   V 減らす（減らし方: 合わせた表のときは 16 の形の札を「形」の選び 1 つに畳み、行の札を 1 列の順位つきの並びに）
//   C 合わせ（S の見出しの帯＋V の畳み）

const watch = (sel, fn) => ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.pv) return; el.dataset.pv = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];
const boardOf = "(() => { try { return Dashboard._state().layout.panels.find((x) => x.visual === 'board'); } catch (_) { return null; } })()";

/** S: 札を表の見出しの形に（表全体＝「設備」の列・まとまり＝その列の見出しと下の列の名前） */
const strip = {
  css: `
#dbEditor .de-tabs{display:flex;gap:0;padding:10px 10px 0;border-bottom:0}
#dbEditor .de-tab{flex:0 0 auto;max-width:none;border:1px solid var(--line);border-radius:0;margin-left:-1px;background:var(--surface-2,#f4f6f8);padding:6px 10px 6px 12px;top:0}
#dbEditor .de-tab:first-child{border-radius:8px 0 0 8px;margin-left:0}
#dbEditor .de-tab:not(.is-add):last-of-type{border-radius:0 8px 8px 0}
#dbEditor .de-tab.on{background:var(--surface);box-shadow:inset 0 -3px 0 var(--h-input);z-index:1}
#dbEditor .de-tab i{left:0;right:0;width:auto;top:0;bottom:auto;height:4px}
#dbEditor .de-tab .pv-cols{display:flex;gap:4px;margin-top:3px}
#dbEditor .de-tab .pv-cols span{padding:0 5px;border-radius:4px;background:var(--surface-4);font-size:10.5px;font-weight:700;color:var(--h-meta)}
#dbEditor .de-tab.is-add{margin-left:8px;border-radius:8px;border-style:dashed}
#dbEditor .de-tab:first-child small::after{content:"（行の段）"}`,
  op: watch("#dbEditor .de-tab[data-de-tab]", `(b) => {
    const p = ${boardOf}; if (!p) return;
    const i = +b.dataset.deTab;
    if (i < 0) { b.innerHTML = '設備<small>表全体・並び</small>'; return; }
    const g = p.groups[i], cols = (g.cols || []).length ? ['1直','2直','3直','4直','5直','直の外'].concat(g.total ? ['計'] : []) : [{ bar: '棒と数', heat: '数と濃淡', num: '数だけ' }[g.look]];
    b.insertAdjacentHTML('beforeend', '<span class="pv-cols">' + cols.map((c) => '<span>' + c + '</span>').join('') + '</span>');
  }`),
};
/** V: 合わせた表のときは形の札を畳む・行の札は 1 列の順位つき */
const fold = {
  css: `
#dbEditor.is-board .de-vis{display:none}
#dbEditor .pv-form{display:flex;align-items:center;gap:8px}
#dbEditor .pv-form select{height:30px;border:1px solid var(--edit-line);background:var(--edit-field);border-radius:7px;padding:0 8px;font:inherit;font-size:13px}
#dbEditor .de-rows{grid-template-columns:minmax(0,1fr);max-width:360px;counter-reset:rk;max-height:calc(100vh - 420px);overflow:auto}
#dbEditor .de-rowi{counter-increment:rk}
#dbEditor .de-rowi::before{content:counter(rk);width:1.6em;text-align:right;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}`,
  op: watch("#dbEditor.is-board #deVis", `(v) => {
    v.insertAdjacentHTML('afterend', '<div class="de-row pv-form"><span class="de-l">形</span><select aria-label="形"><option>合わせた表（行をそろえて、データの数を横に並べる）</option><option>表</option><option>数字</option><option>縦棒</option><option>横棒</option></select><small class="de-hint">ほかの形にすると、① の組みでグラフになります</small></div>');
  }`),
};

export const PROPOSALS = [
  { key: "T", name: "上の札で切り替える（今の作り）", css: "", ops: [] },
  { key: "S", name: "札を表の見出しの形に（表と同じ並び・色）", css: strip.css, ops: [strip.op] },
  {
    key: "L", name: "左の柱に縦の札（表全体・まとまり）",
    css: `
#dbEditor.is-board{display:grid;grid-template-columns:150px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
#dbEditor.is-board .de-head{grid-column:1 / -1}
#dbEditor.is-board #deTabs{grid-column:1;grid-row:2;padding:10px 0 10px 10px;min-height:0;overflow:auto}
#dbEditor.is-board .de-body{grid-column:2;grid-row:2;min-height:0}
#dbEditor.is-board .de-tabs{flex-direction:column;padding:0;border-bottom:0;gap:4px;overflow:visible}
#dbEditor.is-board .de-tab{max-width:none;width:100%;border:1px solid var(--line);border-radius:8px;top:0;padding:7px 10px 7px 14px;white-space:normal}
#dbEditor.is-board .de-tab.on{background:var(--input-soft);border-color:var(--h-input);color:var(--h-input)}`,
    ops: [],
  },
  {
    key: "D", name: "表の上で直接（行を引いて並べる・隠すは表で）",
    css: `
#dashGrid .db-p.is-focus th[scope=row]{position:relative;padding-left:26px !important;cursor:grab}
#dashGrid .db-p.is-focus th[scope=row] .pv-g{position:absolute;left:6px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:12px;letter-spacing:-2px}
#dashGrid .db-p.is-focus th[scope=row] .pv-h{margin-left:8px;padding:0 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);font-size:11px;font-weight:700;color:var(--h-meta)}
#dashGrid .db-p.is-focus thead th[colspan] .pv-e{display:inline-block;margin-left:8px;padding:0 6px;border-radius:5px;background:var(--input-soft);color:var(--h-input);font-size:11px;font-weight:800}
#dbEditor .de-rows{display:none}
#dbEditor .pv-dhint{flex:1;padding:8px 10px;border:1px dashed var(--line);border-radius:8px;color:var(--h-meta);font-size:12.5px}`,
    ops: [watch("#dashGrid .db-p.is-focus th[scope=row]", `(th) => { th.insertAdjacentHTML('afterbegin', '<span class="pv-g" aria-hidden="true">⋮⋮</span>'); th.insertAdjacentHTML('beforeend', '<button type="button" class="pv-h" tabindex="-1">隠す</button>'); }`),
      watch("#dashGrid .db-p.is-focus thead th[colspan]", `(th) => { th.insertAdjacentHTML('beforeend', '<span class="pv-e">組む</span>'); }`),
      watch("#dbEditor .de-rows", `(ol) => { ol.insertAdjacentHTML('afterend', '<div class="pv-dhint">左の表で、設備の行の ⋮⋮ を引いて並べ替えます（並びは「手で並べた順」になります）。行の「隠す」で隠し、隠した行はここに出ます: <b>なし</b></div>'); }`)],
  },
  { key: "V", name: "減らす（形の札を畳む・行の札は 1 列の順位つき）", css: fold.css, ops: [fold.op] },
  { key: "C", name: "合わせ（見出しの帯の札＋畳む）", css: strip.css + fold.css, ops: [strip.op, fold.op] },
];
