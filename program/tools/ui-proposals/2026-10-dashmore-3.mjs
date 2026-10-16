// 2026-10 ダッシュボードの改良（版 3.39.0）の、パネルを組む所の置き方。3 回目（合格点 80 点。最後の回）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmore-3.mjs --states dash,dash-filter,dash-panel,dash-panel-fmt
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmore-3.mjs --states dash,dash-filter,dash-panel,dash-panel-fmt --view 1280x720
// 2 回目（2026-10-dashmore-2.mjs）の 1 位は S2 80.4 点（合格点 90 に届かず）。採点者の指摘:
//   ①全案・土台: 期間の 2 つ目の選び（作業日〈勤務体系で決めた日〉）が次の段へ落ち、見出しの列から始まる → 意図した 2 段目として値の列から始める
//   ②S2 ほか: 向く形が 4 つ並ぶと「すべての形（24）…」が 2 段目へ落ちる → 形の行を意図した 2 段に（1 段目: 選んだ形と「すべての形…」、2 段目: 向く形）
//   ③W: 組む所を広げると組んでいるパネルを覆う → 広げない
//   ④要約は開いている段と重なると繰り返し → 出すなら畳んだ物の所だけ
//   ⑤P: 選んだ札の幅がほかとそろわない・高い → そろえて低く
// 持ち越し（直した）: S3（S2＋①②）・P2（P＋①②⑤）
// 新しい案（3 つ）:
//   K  S3＋カラムの札の列を 210 → 180px に狭め、右の面を広げる（形の行・期間の行に余裕）
//   V  S3＋段の番号を縦の道筋（細い線）でつなぎ、段の中身を道筋の右にそろえる
//   C  S3＋書式は畳んで始め、見出しに効いている物の要約（畳んだ物の所だけに要約）。見せ方の枠は書式の見出しの上
let seq = 0;      // 同じ所に当てる仕掛けが 2 つあっても、それぞれ 1 回ずつ動くように印を分ける
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// ①②（どの案にも）: 表し方は読める幅・文は意図した 2 行（値の前で改める。行の段が無い数字の文は 1 行のまま）
const sentence = `
#dbEditor .de-sent:has(.pv-slot[data-role="rows"])::after{content:"";flex-basis:100%;height:0;order:5}
#dbEditor .de-sent:has(.pv-slot[data-role="rows"]) .pv-slot[data-role="vals"]{order:6}
#dbEditor .de-sent:has(.pv-slot[data-role="rows"]) .pv-w:last-child{order:7}
#dbEditor .de-sent{row-gap:6px}
#dbEditor .de-vrow{grid-template-columns:86px minmax(0,1fr)}
#dbEditor .de-vg{white-space:nowrap}`;
// ③④: 向く形の行（組む所が出す .de-vfit）を出し、全部の札は「すべての形…」で開く。選んだ札はほかと同じ形
const fitRow = `
#dbEditor:not(.is-board) .de-vfit{display:flex}
#dbEditor:not(.is-board) .de-vis[data-open="false"]{display:none}
#dbEditor .de-vfit .pv-cbtn.on{min-width:0}`;

// 段の見出し（.pvh）
const heads = (list) => watch("#dbEditor .de-main", `(m) => {
  const put = () => { ${JSON.stringify(list)}.forEach(([sel, html]) => { const t = m.querySelector(sel); if (t && !(t.previousElementSibling && t.previousElementSibling.classList.contains("pvh") && t.previousElementSibling.dataset.for === sel)) t.insertAdjacentHTML("beforebegin", '<div class="pvh" data-for="' + sel + '">' + html + '</div>'); }); };
  put(); new MutationObserver(put).observe(m, { childList: true });
}`);
const headCss = `
#dbEditor .pvh{display:flex;align-items:baseline;gap:8px;margin-top:4px;padding-top:8px;border-top:1px solid var(--line-soft);font-size:13px;font-weight:800;color:var(--ink)}
#dbEditor .pvh:first-child{border-top:0;margin-top:0;padding-top:0}
#dbEditor .pvh small{font-weight:600;color:var(--muted);font-size:12px}
#dbEditor .pvh i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--h-input);color:#fff;font-size:12px;flex:0 0 auto}`;
const reorder = watch("#dbEditor .de-main", `(m) => {
  ["#deData", "#deSent", "#deCond", "#deSort", "#deVis", "#deBoard", "#deLook", "#deFmt", "#deGacts", "#deMsg"].forEach((s) => { const el = m.querySelector(s); if (el) m.append(el); });
}`);
const stepHeads = heads([["#deData", "<i>1</i>データ<small>何を数えるか</small>"], ["#deSent", "<i>2</i>数え方<small>行・列・値・期間・条件</small>"], ["#deVis", "<i>3</i>形<small>どう描くか</small>"], ["#deLook", "<i>4</i>見せ方・書式<small>枠・数値・軸・色</small>"]]);
const S2css = sentence + fitRow + headCss + `
#dbEditor .de-vfit > .de-l{display:none}`;      // 段の見出し「3 形」があるので、行の頭の「形」は重ねない
const S2ops = [reorder, stepHeads];


// ①: 期間の 2 つ目の選びは、値の列から始める 2 段目（いつも）
const period = `
#dbEditor #deCond .de-row > select[data-de-pcol]{margin-left:60px;flex-basis:auto}
#dbEditor #deCond .de-row:has(select[data-de-pcol])::after{content:none}
#dbEditor #deCond .de-row:has(select[data-de-pcol]){row-gap:6px}
#dbEditor #deCond .de-row:has(select[data-de-pcol]) > select[data-de-pkind]{flex:0 0 auto}
#dbEditor #deCond .de-row:has(select[data-de-pcol]) > select[data-de-pcol]{order:9}
#dbEditor #deCond .de-row:has(select[data-de-pcol])::before{content:"";flex-basis:100%;height:0;order:8}`;
// ②: 形の行を 2 段（1 段目: 選んだ形・すべての形… 2 段目: 向く形 …）
const formRows = `
#dbEditor .de-vfit{row-gap:6px}
#dbEditor .de-vfit > .pv-cbtn.on{order:1}
#dbEditor .de-vfit > .de-vall{order:2;margin-left:8px}
#dbEditor .de-vfit::after{content:"";flex-basis:100%;height:0;order:3}
#dbEditor .de-vfit > .de-vfn{order:4;margin-left:0}
#dbEditor .de-vfit > .pv-cbtn:not(.on){order:5}`;
const S3css = S2css + period + formRows;
const S3ops = S2ops;
const P2 = `
#dbEditor .de-vfit{gap:6px}
#dbEditor .de-vfit .pv-cbtn{flex-direction:column;height:auto;width:84px;min-width:84px;padding:4px 6px;gap:2px;justify-content:center}
#dbEditor .de-vfit .pv-cbtn.on{width:84px;min-width:84px}
#dbEditor .de-vfit .de-vall{align-self:center}
#dbEditor .de-vfit .pv-cbtn .pv-ico{width:20px;height:20px}
#dbEditor .de-vfit .pv-cbtn span{font-size:12px}
#dbEditor .de-vfit .de-vfn{writing-mode:horizontal-tb}`;


// K: カラムの札の列を狭める
const K = `
#dbEditor .de-body{grid-template-columns:180px minmax(0,1fr)}
#dbEditor .de-fields .pv-f span small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
// V: 縦の道筋
const V = `
#dbEditor .de-main{padding-left:28px;position:relative}
#dbEditor .de-main::before{content:"";position:absolute;left:9px;top:12px;bottom:8px;width:2px;background:color-mix(in srgb,var(--h-input) 25%,transparent)}
#dbEditor .pvh{margin-left:-28px;border-top:0;padding-top:6px}
#dbEditor .pvh i{position:relative;z-index:1;box-shadow:0 0 0 3px var(--surface)}`;
// C: 書式は畳んで始める（見出しの要約は組む所が出す「書式 既定のまま」の字）。畳んだ見出しは押せると分かる形に
const C = {
  css: `
#dbEditor .de-fmthead{border:1px solid var(--edit-line);border-radius:8px;background:var(--edit-field);padding:8px 10px}
#dbEditor .de-fmthead[aria-expanded="false"] small{color:var(--h-input);font-weight:700}`,
  op: watch("#dbEditor .de-main", `(m) => {
    let done = false;
    const shut = () => { const b = m.querySelector('#deFmt [data-de-fmtopen][aria-expanded="true"]'); if (b && !done) { done = true; b.click(); } };
    document.addEventListener("tpa-show-fmt", () => { done = true; const b = m.querySelector('#deFmt [data-de-fmtopen][aria-expanded="false"]'); if (b) b.click(); });
    new MutationObserver(shut).observe(m, { childList: true, subtree: true }); shut();
  }`),
};

export const PROPOSALS = [
  { key: "S3", name: "S2 を直した物（期間の 2 段目は値の列から・形の行は 2 段）", css: S3css, ops: S3ops },
  { key: "P2", name: "P を直した物（絵の札を同じ幅で低く・期間と形の行の直し）", css: S3css + P2, ops: S3ops },
  { key: "K", name: "S3＋カラムの札の列を狭めて右の面を広げる", css: S3css + K, ops: S3ops },
  { key: "V", name: "S3＋段の番号を縦の道筋でつなぐ", css: S3css + V, ops: S3ops },
  { key: "C", name: "S3＋書式は畳んで始め、見出しに要約", css: S3css + C.css, ops: [...S3ops, C.op] },
];
