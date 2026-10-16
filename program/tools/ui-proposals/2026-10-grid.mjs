// 2026-10 ダッシュボードをグリッドのパネルに（版 3.37.0。利用者の要望: 最初の画面・仕掛区分ごとの仕掛ロット数・スクロールしない・
// パネルの大きさを変え、パネルごとにデータと条件からグラフや表を組む〈集計表・グラフを組むのと同じ感じ・Power BI のように〉）。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-grid.mjs --states dash,dash-edit,dash-panel
// 今（版 3.36.0）は 1 枚の表だけ（撮った物: 作る前の画像）。どの案も、組みの仕組み（グリッド・パネル・組む所・保存）は作った物（0）を使い、
// 置き場・見せ方・流れを変える。案の方向:
//   0  作ったまま: 組む所はグリッドの右（640px）・編集のときパネルの見出しに 組む・複製・消す・形の札は 4 列（名前つき）
//   B  減らし方: 編集のとき見出しのボタンを外し、選んだパネルの下に 1 つの浮かぶ帯（組む・複製・消す）。形の札は絵を上・名前を下の 8 列。組む所は 560px
//   C  置き場: 組む所をグリッドの下（高さ 44%）。グリッドは上に縮む（横の幅はそのまま）。組む所の中は 3 列（カラム｜文・形｜条件）
//   D  流れ: 組む間は「焦点」: 組んでいるパネルを左に大きく出し、ほかのパネルは淡く。組む所は右に重ねる（グリッドは動かない）
//   E  見せ方: 標準の並びを「数の帯」に（上 1 段に数字 4 つ: 仕掛・前日の実績・保留の仕掛・今月の実績）＋グラフ 3 つ＋1 枚の表。
//      編集のとき見出しのボタンは「⋯」1 つ
//   F  置き場: 組む所をグリッドの左（一覧の集計表と同じ「左にカラム」の並び）

const css = `
/* B: 浮かぶ帯 */
.pvB .db-screen.is-edit .db-ph .db-pbtn{display:none}
.pvB-bar{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);display:flex;gap:2px;padding:3px;border-radius:999px;background:#1f3347;box-shadow:0 6px 18px rgba(12,34,48,.3);z-index:4}
.pvB-bar button{height:28px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#fff;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.pvB-bar button.is-danger{color:#ffc9c0}
.pvB .db-editor-pane{flex-basis:560px}
.pvB .de-vis{grid-template-columns:repeat(8,minmax(0,1fr))}
.pvB .de-vis .pv-cbtn{flex-direction:column;justify-content:center;height:50px;gap:2px;padding:2px;font-size:11.5px}
/* C: 下に組む所 */
.pvC .db-stage{flex-direction:column}
.pvC .db-editor-pane{flex:0 0 44%}
.pvC .de-body{grid-template-columns:240px minmax(0,1fr)}
.pvC .de-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:8px 14px;align-content:start}
.pvC #deVis{grid-row:span 2}
.pvC .de-vis{grid-template-columns:repeat(4,minmax(0,1fr))}
/* D: 焦点 */
.pvD .db-screen.has-editor .db-p:not(.is-editing){opacity:.2;filter:grayscale(.7)}
.pvD .db-screen.has-editor .db-p.is-editing{position:fixed;left:24px;top:116px;width:calc(100vw - 720px);height:calc(100vh - 140px);z-index:20;box-shadow:0 12px 36px rgba(12,34,48,.28)}
.pvD .db-editor-pane{position:fixed;right:12px;top:110px;bottom:12px;width:660px;z-index:21}
/* E: 数の帯と「⋯」 */
.pvE .db-screen.is-edit .db-ph .db-pbtn{display:none}
.pvE .db-screen.is-edit .db-ph .pvE-more{display:inline-block}
.pvE-more{display:none;width:28px;height:24px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font-weight:800;color:var(--h-meta)}
/* F: 左に組む所 */
.pvF .db-editor-pane{order:-1;flex-basis:600px}
.pvF .de-body{grid-template-columns:200px minmax(0,1fr)}
`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); }`];
const mark = (k) => ["script", `document.body.classList.add("pv${k}")`];

const B = keep(`const g = document.querySelector("#dashGrid"); if (!g) return;
  const edit = document.querySelector("#dashScreen.is-edit");
  const old = g.querySelector(".pvB-bar"), sel = edit && (g.querySelector(".db-p.is-editing") || g.querySelector(".db-p.is-sel") || g.querySelector('.db-p[data-id="wipClass"]'));
  if (!sel) { if (old) old.remove(); return; }
  if (old && old.parentElement === sel) return; if (old) old.remove();
  sel.insertAdjacentHTML("beforeend", '<div class="pvB-bar"><button>組む</button><button>複製</button><button>大きさ…</button><button class="is-danger">消す</button></div>');`);
const E = [["script", `{ const L = { rows: 8, panels: [
    { id: "k1", x: 0, y: 0, w: 3, h: 1, title: "仕掛ロット数", visual: "kpi", source: "src:wip", body: { measures: [{ agg: "lots" }] } },
    { id: "k2", x: 3, y: 0, w: 3, h: 1, title: "前日の実績本数", visual: "kpi", source: "work", body: { measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "yesterday" } },
    { id: "k3", x: 6, y: 0, w: 3, h: 1, title: "保留の仕掛ロット数", visual: "kpi", source: "src:wip", body: { measures: [{ agg: "lots" }] }, filters: [{ column: "仕掛区分", op: "eq", value: "保留" }] },
    { id: "k4", x: 9, y: 0, w: 3, h: 1, title: "今月の実績本数", visual: "kpi", source: "work", body: { measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "this_month" } },
    { id: "wipClass", x: 0, y: 1, w: 4, h: 4, title: "仕掛区分ごとの仕掛ロット数", visual: "bar", source: "src:wip", body: { rows: [{ column: "仕掛区分" }], measures: [{ agg: "lots" }] }, sort: "desc" },
    { id: "wipEquip", x: 4, y: 1, w: 4, h: 4, title: "設備ごとの仕掛ロット数", visual: "column", source: "src:wip", body: { rows: [{ column: "@equip" }], measures: [{ agg: "lots" }] }, sort: "desc" },
    { id: "workDays", x: 8, y: 1, w: 4, h: 4, title: "直近 14 日の実績本数", visual: "time", source: "work", body: { rows: [{ column: "@workday" }], measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "days", n: 14 } },
    { id: "board", x: 0, y: 5, w: 12, h: 3, title: "設備ごとの仕掛と前日の実績", visual: "board" }] };
  const go = () => { if (window.Dashboard && document.querySelector("#dashGrid .db-p")) { if (!window.__pvE) { window.__pvE = 1; Dashboard._setLayout(L); } } else setTimeout(go, 300); }; go(); }`],
  keep(`document.querySelectorAll("#dashGrid .db-ph").forEach((h) => { if (!h.querySelector(".pvE-more")) h.insertAdjacentHTML("beforeend", '<button type="button" class="pvE-more" aria-label="このパネルの操作">⋯</button>'); });`)];

export const PROPOSALS = [
  { key: "0", name: "作ったまま（組む所は右 640px・見出しに 組む／複製／消す・形の札 4 列）", css, ops: [] },
  { key: "B", name: "選んだパネルの下に 1 つの浮かぶ帯（見出しのボタンを外す）・形の札は 8 列（絵の下に名前）・組む所 560px", css, ops: [mark("B"), B] },
  { key: "C", name: "組む所をグリッドの下（高さ 44%）。中は カラム｜文・形｜条件", css, ops: [mark("C")] },
  { key: "D", name: "組む間は焦点: 組むパネルを左に大きく・ほかは淡く・組む所は右に重ねる", css, ops: [mark("D")] },
  { key: "E", name: "標準の並びを数の帯（上 1 段に数字 4 つ）＋グラフ 3 つ＋1 枚の表。編集の見出しは「⋯」1 つ", css, ops: [mark("E"), ...E] },
  { key: "F", name: "組む所をグリッドの左（一覧の集計表と同じ「左にカラム」）", css, ops: [mark("F")] },
];
