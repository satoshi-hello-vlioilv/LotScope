// 2026-10 ダッシュボードをグリッドのパネルに。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-grid-2.mjs --states dash,dash-edit,dash-panel
// 1 回目（2026-10-grid.mjs）は 1 位 D 34.4 点で届かず。採点者が全案に共通で挙げた所を、土台（0＝作った物）に入れた:
//   ①低いパネルの目盛りの重なり → 高さに合わせて目盛りを 5→3→2 に・混んだ横軸の名前は斜めに
//   ②1 枚の表が切られる → 字を詰め、それでも入らなければ行を 2〜3 つの列に分けて横に並べる（どの設備も見える）
//   ③狭いパネルの見出しの 組む・複製・消す がはみ出す → 狭いパネル（360px 未満）は「⋯」1 つに畳む
//   ④組む所を開くとグリッドが縮み字が切れる → 1 位の D の焦点を土台に（グリッドは縮めず、組むパネルを左に大きく・ほかは淡い幕・組む所は右に重ねる。
//      形の札は 3 列で名前が全部読める・題の欄は字の頭から見せる）
//   ⑤色が 1 色 → 色＝データの種類（仕掛＝藍・作業実績＝青緑・品質＝琥珀。題の頭の点・グラフ・1 枚の表の仕掛の棒と実績の濃淡で同じ）。
//      種類の少ない段（仕掛区分など 8 つまで）は名前ごとに決まった色
//   ⑥数字に注記が被る → 知らせ（読めない設備など）は見出しの「⚠ 1」の札に（中身の上に出さない）
// 案（1 回目で効いた D・E を持ち越し、新しい案を 4 つ）:
//   0  作ったまま（上の①〜⑥を入れた土台。並びは 1 回目と同じ: 数字 2・仕掛区分・設備ごとの仕掛・直近 14 日・1 枚の表）
//   E2 並び: 上 1 段に数字 4 つ（仕掛・前日の実績・保留の仕掛・今月の実績）→ グラフ 3 つ → 1 枚の表（1 回目 2 位の E）
//   J  並び（新）: 上 1 段に数字 4 つ → 左にグラフ 2 つ（仕掛区分・直近 14 日）・右に縦長の 1 枚の表（設備ごとの仕掛の棒グラフは表と同じ数なので外す）
//   K  並び（新）: 1 枚の表を主に左いっぱい（8 列×全段）・右の列に数字 2 つ・仕掛区分のドーナツ・直近 14 日
//   G  組む流れ（新）: J の並び＋組む所を段階のタブ（① データ ② 行・列・値 ③ 形 ④ 条件）に分け、一度に見せる物を減らす
//   H  組む置き場（新）: J の並び＋組むパネルを上の真ん中に、組む所をその真下に続けて 1 つの面に（目が上から下へ流れる）

const css = `
/* G: 段階のタブ */
.pvG-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:-2px 0 2px}
.pvG-tabs button{height:30px;padding:0 12px;border:0;border-bottom:3px solid transparent;background:transparent;font:inherit;font-size:13px;font-weight:700;color:var(--muted)}
.pvG-tabs button.on{color:var(--h-input);border-bottom-color:var(--h-input)}
.pvG #deVis,.pvG #deCond,.pvG #deSort{display:none}
/* H: 上にパネル・真下に組む所 */
.pvH .db-p.is-focus{left:calc(50vw - 380px)!important;top:calc(var(--header-h) + 58px)!important;width:760px!important;height:36vh!important}
.pvH .db-editor-pane{left:calc(50vw - 380px);right:auto;width:760px;max-width:none;top:calc(var(--header-h) + 66px + 36vh)}
`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const mark = (k) => ["script", `document.body.classList.add("pv${k}")`];
const K = (id, x, y, w, h, title, source, extra = {}) => ({ id, x, y, w, h, title, visual: "kpi", source, body: { measures: [{ agg: "lots" }] }, ...extra });
const YDAY = { column: "@workday", kind: "yesterday" };
const kpis = [K("k1", 0, 0, 3, 1, "仕掛ロット数", "src:wip"), K("k2", 3, 0, 3, 1, "前日の実績本数", "work", { period: YDAY }),
  K("k3", 6, 0, 3, 1, "保留の仕掛ロット数", "src:wip", { filters: [{ column: "仕掛区分", op: "eq", value: "保留" }] }),
  K("k4", 9, 0, 3, 1, "今月の実績本数", "work", { period: { column: "@workday", kind: "this_month" } })];
const cls = (x, y, w, h, visual = "bar") => ({ id: "wipClass", x, y, w, h, title: "仕掛区分ごとの仕掛ロット数", visual, source: "src:wip", body: { rows: [{ column: "仕掛区分" }], measures: [{ agg: "lots" }] }, sort: "desc" });
const days = (x, y, w, h) => ({ id: "workDays", x, y, w, h, title: "直近 14 日の実績本数", visual: "time", source: "work", body: { rows: [{ column: "@workday" }], measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "days", n: 14 } });
const board = (x, y, w, h) => ({ id: "board", x, y, w, h, title: "設備ごとの仕掛と前日の実績", visual: "board" });
const LAYOUTS = {
  E2: { rows: 8, panels: [...kpis, cls(0, 1, 4, 4), { id: "wipEquip", x: 4, y: 1, w: 4, h: 4, title: "設備ごとの仕掛ロット数", visual: "column", source: "src:wip", body: { rows: [{ column: "@equip" }], measures: [{ agg: "lots" }] }, sort: "desc" }, days(8, 1, 4, 4), board(0, 5, 12, 3)] },
  J: { rows: 8, panels: [...kpis, cls(0, 1, 5, 4), days(0, 5, 5, 3), board(5, 1, 7, 7)] },
  K: { rows: 8, panels: [board(0, 0, 8, 8), K("k1", 8, 0, 2, 2, "仕掛ロット数", "src:wip"), K("k2", 10, 0, 2, 2, "前日の実績本数", "work", { period: YDAY }), cls(8, 2, 4, 3, "donut"), days(8, 5, 4, 3)] },
};
const layout = (k) => ["script", `{ const L = ${JSON.stringify(LAYOUTS[k])};
  const go = () => { if (window.Dashboard && document.querySelector("#dashGrid .db-p")) { if (!window.__pvL) { window.__pvL = 1; Dashboard._setLayout(L); } } else setTimeout(go, 300); }; go(); }`];
const G = keep(`const m = document.querySelector("#dbEditor .de-main"); if (!m || m.querySelector(".pvG-tabs")) return;
  m.insertAdjacentHTML("afterbegin", '<div class="pvG-tabs" role="tablist"><button>① データ</button><button class="on">② 行・列・値</button><button>③ 形</button><button>④ 条件・並べ方</button></div>');`);

export const PROPOSALS = [
  { key: "0", name: "作ったまま（1 回目の指摘①〜⑥を入れた土台・焦点で組む）", css, ops: [] },
  { key: "E2", name: "上 1 段に数字 4 つ → グラフ 3 つ → 1 枚の表", css, ops: [layout("E2")] },
  { key: "J", name: "上 1 段に数字 4 つ・左にグラフ 2 つ・右に縦長の 1 枚の表（重なる設備ごとの棒グラフを外す）", css, ops: [layout("J")] },
  { key: "K", name: "1 枚の表を主に左いっぱい・右の列に数字 2 つ・仕掛区分のドーナツ・直近 14 日", css, ops: [layout("K")] },
  { key: "G", name: "J の並び＋組む所を段階のタブ（① データ ② 行・列・値 ③ 形 ④ 条件）", css, ops: [layout("J"), mark("G"), G] },
  { key: "H", name: "J の並び＋組むパネルを上の真ん中・組む所をその真下に続けて", css, ops: [layout("J"), mark("H")] },
];
