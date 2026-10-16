// 2026-10 ダッシュボードをグリッドのパネルに。3 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-grid-3.mjs --states dash,dash-edit,dash-panel
// 2 回目（2026-10-grid-2.mjs）は 1 位 J 81.3 点で 90 点に届かず。J を土台（0＝作った物の標準の並び）にし、採点者の指摘を入れた:
//   ①添え書き（期間・元）が見出しで … と切れる → 見出しは題と操作だけの 1 行。添え書きは 2 行目（数字の形は数の下）
//   ②縦長の 1 枚の表の下が空く → 入るいちばん大きな字にし、まだ空けば行の上下の余白で埋める
//   ③「保留」の棒が作業実績の色（青緑）と同じ → 名前ごとの色からデータの種類の色（藍・青緑・琥珀）を外す
//   ④数字 4 つが同じ重さ → 数字は 3 つ（仕掛・前日の実績・今月の実績。データの中の値〈保留など〉を決め打ちしない物だけ）
//   ⑤狭いパネルの「⋯」が枠の外 → 狭いときは題が縮む
// 案（2 回目で効いた J・H を持ち越し、新しい案を 3 つ）:
//   0  作ったまま（J＋上の①〜⑤）
//   L  強弱（新）: いちばん先に見る数＝仕掛ロット数のパネルだけ淡い藍の地と濃い藍の数（最初に見る物を 1 つに）
//   M  見せ方（新）: 仕掛区分をドーナツに（割合と数を一緒に。真ん中に計）
//   P  減らし方（新）: 添え書きの 2 行目を出さず、題の横の「ⓘ」に畳む（中身を広く。押すと元・期間・条件）
//   H2 置き場（2 回目の H の持ち越し）: 高い窓（1000px 以上）では、組むパネルを上の真ん中・組む所をその真下に。低い窓では右に重ねる（2 回目で 1280 の切れが出た所）

const css = `
/* L: 主の数 */
.pvL #dashGrid .db-p[data-id="wipTotal"]{background:#eef3f9;border-color:#c9d8e8}
.pvL #dashGrid .db-p[data-id="wipTotal"] .dp-num{color:#2b4a70}
/* P: 添え書きを ⓘ に */
.pvP .db-psub,.pvP .dp-kmeta{display:none!important}
.pvP-i{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid var(--line);color:var(--muted);font-size:11px;font-weight:800;font-style:normal;flex:0 0 auto}
/* H2: 高い窓だけ縦に続ける */
@media (min-height:1000px){
  .pvH .db-p.is-focus{left:calc(50vw - 380px)!important;top:calc(var(--header-h) + 58px)!important;width:760px!important;height:36vh!important}
  .pvH .db-editor-pane{left:calc(50vw - 380px);right:auto;width:760px;max-width:none;top:calc(var(--header-h) + 66px + 36vh)}
}
`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const mark = (k) => ["script", `document.body.classList.add("pv${k}")`];
const M = ["script", `{ const go = () => { if (window.Dashboard && document.querySelector('#dashGrid .db-p[data-id="wipClass"]')) { if (!window.__pvM) { window.__pvM = 1;
    const L = Dashboard._state().layout; L.panels.find((x) => x.id === "wipClass").visual = "donut"; Dashboard._setLayout(L); } } else setTimeout(go, 300); }; go(); }`];
const P = keep(`document.querySelectorAll("#dashGrid .db-p").forEach((el) => { const h = el.querySelector(".db-ph h3"), s = el.querySelector(".db-psub");
  if (!h || h.nextElementSibling?.classList.contains("pvP-i")) return; const t = (s && s.textContent) || "";
  if (t || el.querySelector(".dp-kmeta")) h.insertAdjacentHTML("afterend", '<i class="pvP-i" title="' + (t || el.querySelector(".dp-kmeta").textContent) + '">i</i>'); });`);

export const PROPOSALS = [
  { key: "0", name: "作ったまま（J＋2 回目の指摘①〜⑤: 添え書きは 2 行目・表は空きを埋める・区分の色・数字 3 つ）", css, ops: [] },
  { key: "L", name: "主の数を 1 つ強く（仕掛ロット数のパネルだけ淡い藍の地）", css, ops: [mark("L")] },
  { key: "M", name: "仕掛区分をドーナツに（割合と数を一緒に）", css, ops: [M] },
  { key: "P", name: "添え書きを 2 行目に出さず、題の横の「ⓘ」に畳む", css, ops: [mark("P"), P] },
  { key: "H2", name: "高い窓では組むパネルを上の真ん中・組む所をその真下に（低い窓は右に重ねる）", css, ops: [mark("H")] },
];
