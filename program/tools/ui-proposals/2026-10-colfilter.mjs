// 2026-10-18 一覧の列を値で絞る（Excel のフィルタ）と、ダッシュボードの「絞る」（版 3.45.0。利用者の要望 1・5・6）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-colfilter.mjs --states list-colfilter,dash-filter   （1536x864・1280x720 でも）
// 今の物（版 3.44.0）で見えたこと: 一覧の列で絞るのは「条件」「列で絞り込む」から列・比べ方・値を打つしかなく、値の一覧が出ない（思い出させる）。
//   ダッシュボードの「絞る」は値のチェックはあるが、列と検索の欄に形が当たっておらず素の選択欄（要望 5）・条件（含む・以上）が無い（要望 6）
// 案の方向（何で解くか）:
//   A 置き場（見出しの ▼ は乗せた時と絞っている列だけ）・面は 並べ替え → 条件（畳む）→ 検索 → 値のチェック（件数の帯）→ OK。作った物
//   B 見せ方（▼ をいつも全部の見出しに淡く出す: 探させない）
//   C 流れの順（Excel と同じく 検索 → 値 → 条件を下に: よく使う値のチェックを上に）
//   D 減らし方（件数の帯を外し、数だけ。並べ替えは小さな札に）
//   E 置き場（横に広い面: 左に並べ替え・条件、右に値の並び）
//   F 見せ方（選んだ値を札で面の上に並べ、外せる: 何を選んだかを見える所に）
let seq = 0;
const watch = (sel, fn) => { const k = `cf${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A ▼は乗せた時・絞っている列だけ／並べ替え→条件→検索→値→OK（作った物）", css: "", ops: [] },
  { key: "B", name: "B ▼をいつも全部の見出しに淡く出す", css: `.ll-grid thead th .th-filter{opacity:.62}.ll-grid thead th .th-filter.on{opacity:1}.ll-grid thead th > .th-in{padding-right:18px}`, ops: [] },
  {
    key: "C", name: "C 検索→値を上に、条件は下に（Excel の順）",
    css: `.vf-pop,.vf-embed{display:flex}.vf-pop .vf-conds,.vf-embed .vf-conds{order:5}.vf-pop .vf-foot{order:9}.vf-embed .vf-estate{order:6}.vf-pop .vf-search,.vf-embed .vf-search{order:1}.vf-pop .vf-list,.vf-embed .vf-list{order:2}.vf-pop .vf-sort{order:0}.vf-pop .vf-head{order:-1}`,
    ops: [],
  },
  {
    key: "D", name: "D 件数の帯を外し数だけ・並べ替えは小さな札",
    css: `.vf-n i{display:none!important}.vf-it{grid-template-columns:auto minmax(0,1fr) 52px}.vf-sort button{flex:0 0 auto;min-height:24px;padding:0 8px;font-size:12px}.vf-sort{justify-content:flex-end}`,
    ops: [],
  },
  {
    key: "E", name: "E 横に広い面（左に並べ替え・条件・右に値）",
    css: `.vf-pop.cf-wide{width:600px;display:grid;grid-template-columns:230px minmax(0,1fr);grid-auto-rows:auto;column-gap:14px;align-content:start}
      .cf-wide .vf-head,.cf-wide .vf-foot{grid-column:1/-1}.cf-wide .vf-sort,.cf-wide .vf-conds,.cf-wide .vf-locked{grid-column:1}.cf-wide .vf-search,.cf-wide .vf-list{grid-column:2}
      .cf-wide .vf-sort{flex-direction:column}.cf-wide .vf-search{grid-row:2}.cf-wide .vf-list{grid-row:3 / span 3}.cf-wide .vf-conds{grid-row:3}.cf-wide .vf-crow,.cf-wide .vf-crow:not(:has(.vf-and)){grid-template-columns:1fr auto}.cf-wide .vf-crow [data-vf-val]{grid-column:1}`,
    ops: [watch(".vf-pop", `(m) => { m.classList.add("cf-wide"); TPA.placeAt(m, Math.min(parseFloat(m.style.left), innerWidth - 616), parseFloat(m.style.top)); }`)],
  },
  {
    key: "F", name: "F 選んだ値を札で上に並べる（外せる）",
    css: `.cf-picked{display:flex;flex-wrap:wrap;gap:4px;min-height:24px}.cf-picked span{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 8px;border-radius:999px;background:var(--ll-pale);border:1px solid #9fd3cb;color:var(--ll-teal-dark);font-size:12px}.cf-picked span i{font-style:normal;color:var(--muted);padding:0 3px}`,
    ops: [watch(".vf-list", `(l) => { const paint = () => { const box = l.parentElement; let c = box.querySelector(".cf-picked"); if (!c) { c = document.createElement("div"); c.className = "cf-picked"; l.before(c); }
      const on = [...l.querySelectorAll(".vf-it.on .vf-lab")].map((x) => x.textContent); const all = l.querySelectorAll(".vf-it").length;
      c.innerHTML = on.length === all ? '<small style="color:var(--muted)">すべての値（絞っていません）</small>' : on.slice(0, 8).map((t) => '<span>' + t + '<i>×</i></span>').join(""); };
      paint(); new MutationObserver(paint).observe(l, { childList: true, subtree: true, attributes: true }); }`)],
  },
];
