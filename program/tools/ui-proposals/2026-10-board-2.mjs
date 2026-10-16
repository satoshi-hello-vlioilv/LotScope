// 2026-10 合わせた表を組む所の置き方（版 3.38.0。利用者の要望 2）。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-board-2.mjs --states dash-board,dash-board-group
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-board-2.mjs --states dash-board,dash-board-group --view 1280x720
// 1 回目（2026-10-board.mjs・.json）の 1 位は S 74.6 点・V 74.5 点・T 74.4 点（合格点 95 に届かず）。採点者の指摘:
//   ①土台: 1280 で組む所を開くと、大きく出したパネルの表の右（直の外・計・SL3 の文）が切れる（全案 −5）
//      → 作った物の不具合として直した（表の幅が足りないとき、列の幅 → 字と余白を詰める。dashboard-panels.js の fitWidth）
//   ②T は 16 の形の札が組む所の上半分を占め、肝の行の並びが下へ追いやられる（階層化・考えさせない）
//   ③V の「形の札を 1 つの選びに畳む」「1 列の順位つきの行の札」は効いた。ただし行の札は並びの中ではなく組む所全体で送る（二重のスクロールを無くす）、
//     「形」の選びは表全体の札にだけ出す（② に出ると「ほかの形にすると ① の組みでグラフ」と読めて迷う）、説明文は欄の列にそろえる
//   ④S の見出しの帯の小さな札（1直…計）は 10.5px で読みにくい → 外して色の線だけに。札の言葉「表全体」は残す
//   ⑤L は中身が狭く 4 か所で折れる・D は行の頭の ⋮⋮ と「隠す」で表が狭くなる
// 持ち越し（直した）: V2（③）・S2（④）・C2（V2＋S2）
// 新しい案（3 つ。どれも V2 の畳みの上に）:
//   M まとまりの要約を表全体に（表全体の面に「列のまとまり」の行を足し、① ② のデータ・値・見せ方を 1 行ずつ。押すとその札へ）
//   Q 表全体を 2 列に（左＝形・行・並びの決め方と説明、右＝行の札〈順位つきの 1 列〉。並びの決め方と結果を横に並べる）
//   W 見せ方を絵で選ぶ（まとまりの見せ方〈棒と数・数と濃淡・数だけ〉を、表のセルの小さな見本の札にする。色は「色」の見出しつき）

const watch = (sel, fn) => ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.pv) return; el.dataset.pv = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];
const boardOf = "(() => { try { return Dashboard._state().layout.panels.find((x) => x.visual === 'board'); } catch (_) { return null; } })()";

/** V2: 合わせた表のときは 16 の形の札を隠し、表全体の面の頭にだけ「形」の選びを置く。行の札は 1 列・順位つき（組む所全体で送る） */
const fold = {
  css: `
#dbEditor.is-board .de-vis{display:none}
#dbEditor .pv-form select{flex:1 1 auto;min-width:0;max-width:420px}
#dbEditor .de-rows{grid-template-columns:minmax(0,1fr);max-width:380px;counter-reset:rk}
#dbEditor .de-rowi{counter-increment:rk}
#dbEditor .de-rowi::before{content:counter(rk);width:1.6em;text-align:right;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
#dbEditor .de-row .de-hint{flex-basis:100%;margin-left:60px}`,
  op: watch("#deBoard > .de-row:first-child", `(r) => {
    r.insertAdjacentHTML('beforebegin', '<div class="de-row pv-form" data-pv="1"><label class="de-l">形</label><select aria-label="形"><option>合わせた表（行をそろえて、データの数を横に並べる）</option><option>表</option><option>数字</option><option>縦棒</option><option>横棒</option><option>時系列</option></select></div>');
  }`),
};
/** S2: 札の頭に色の線だけ（小さな札は外す）。札の言葉は今のまま */
const strip = {
  css: `
#dbEditor .de-tabs{gap:0;padding:10px 10px 0}
#dbEditor .de-tab{border-radius:0;margin-left:-1px;padding:7px 12px 6px;background:var(--surface-2,#f4f6f8)}
#dbEditor .de-tab:first-child{border-radius:8px 0 0 0;margin-left:0}
#dbEditor .de-tab:not(.is-add):last-of-type{border-radius:0 8px 0 0}
#dbEditor .de-tab.on{background:var(--surface);box-shadow:inset 0 -3px 0 var(--h-input);z-index:1}
#dbEditor .de-tab i{left:0;right:0;width:auto;top:0;bottom:auto;height:4px}
#dbEditor .de-tab.is-add{margin-left:8px;border-radius:8px 8px 0 0;border-style:dashed}`,
};

export const PROPOSALS = [
  { key: "V2", name: "形の札を表全体の選び 1 つに畳む・行の札は 1 列の順位つき", css: fold.css, ops: [fold.op] },
  { key: "S2", name: "札の頭に色の線（表と同じ色）・小さな札は外す", css: strip.css, ops: [] },
  { key: "C2", name: "V2＋S2", css: fold.css + strip.css, ops: [fold.op] },
  {
    key: "M", name: "表全体にまとまりの要約（押すとその札へ）",
    css: fold.css + `
#dbEditor .pv-sum{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
#dbEditor .pv-sum button{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border:1px solid var(--line);border-left:4px solid var(--gc);border-radius:7px;background:var(--surface);font:inherit;font-size:13px;text-align:left;cursor:pointer}
#dbEditor .pv-sum b{flex:none}#dbEditor .pv-sum small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#dbEditor .pv-sum i{margin-left:auto;font-style:normal;color:var(--h-input);font-size:12px;font-weight:800}`,
    ops: [fold.op, watch("#deBoard > .de-row.de-top", `(r) => {
      const p = ${boardOf}; if (!p) return;
      const look = { bar: '棒と数', heat: '数と濃淡', num: '数だけ' }, n = '①②③④', col = { 'src:wip': '#3f6591', work: '#2f7d78', lot: '#b5822a' };
      const rows = p.groups.map((g, i) => '<button type="button" style="--gc:' + (g.color || col[g.source] || '#3f6591') + '"><b>' + n[i] + ' ' + (g.title || '前日の実績本数') + '</b><small>' + (g.source === 'work' ? '作業実績' : '仕掛') + '・' + (g.measure.agg === 'lots' ? 'ロット数' : '件数') + (g.cols.length ? '・直別' : '') + '・' + look[g.look] + (g.period ? '・前日' : '') + '</small><i>組む ›</i></button>').join('');
      r.insertAdjacentHTML('beforebegin', '<div class="de-row de-top pv-sumrow" data-pv="1"><label class="de-l">列</label><div class="pv-sum">' + rows + '</div></div>');
    }`)],
  },
  {
    key: "Q", name: "表全体を 2 列に（左＝決め方・右＝行の札）",
    css: fold.css + `
#dbEditor #deBoard{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:4px 16px;align-items:start}
#dbEditor #deBoard > .de-row{grid-column:1}
#dbEditor #deBoard > .de-row.de-top:not(.pv-sumrow){grid-column:2;grid-row:1 / span 6}
#dbEditor #deBoard > .de-row.de-top > .de-l{display:none}
#dbEditor #deBoard .de-rows{max-width:none}
#dbEditor #deBoard > .de-row.de-top::before{content:"行の並び（引く・↑↓・出す）";display:block;width:100%;font-size:12.5px;font-weight:800;color:var(--h-meta);margin-bottom:4px}
#dbEditor #deBoard > .de-row.de-top{flex-wrap:wrap}`,
    ops: [fold.op],
  },
  {
    key: "W", name: "見せ方を絵で選ぶ（表のセルの小さな見本）",
    css: fold.css + `
#dbEditor .de-segs{border:0;gap:6px;overflow:visible}
#dbEditor .de-seg{flex-direction:column;align-items:flex-start;height:auto;gap:3px;padding:6px 10px;border:1px solid var(--edit-line);border-radius:8px}
#dbEditor .de-seg + .de-seg{border-left:1px solid var(--edit-line)}
#dbEditor .de-seg .pv-mini{display:flex;align-items:center;gap:4px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink)}
#dbEditor .de-seg .pv-mini i{display:block;width:34px;height:7px;border-radius:3px;background:linear-gradient(90deg,var(--h-input) 70%,var(--surface-4) 70%)}
#dbEditor .de-seg .pv-mini s{text-decoration:none;padding:0 5px;border-radius:4px;background:rgba(47,125,120,.35)}
#dbEditor .de-seg.on{border-color:var(--h-input);box-shadow:0 0 0 2px rgba(63,101,145,.18)}
#dbEditor .de-sws::before{content:"色";font-size:12.5px;font-weight:800;color:var(--h-meta);margin-right:4px;align-self:center}`,
    ops: [fold.op, watch("#deLook .de-seg", `(l) => {
      const v = l.querySelector('input').value, mini = { bar: '<i></i>231', heat: '<s>3</s><s style="background:rgba(47,125,120,.15)">1</s>', num: '231　0　4' }[v];
      l.insertAdjacentHTML('beforeend', '<span class="pv-mini">' + mini + '</span>');
    }`)],
  },
];
