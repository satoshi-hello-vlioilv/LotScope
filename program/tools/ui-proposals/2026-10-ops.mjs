// 2026-10-21 稼働のガントチャートと稼働率・ABC 分析と換算係数（版 3.46.0。利用者の要望 1・2）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops.mjs --states dash-ops   （1536x864・1280x720 でも）
// 今の物: 新しいパネル（A が作った物）。作った物を撮って見えたこと（自分で画像を見た）:
//   ・ガント: 勤務の外の斜線・直の境・作業の棒・右に稼働率（数＋細い棒＋稼働/勤務の時間）。棒の色は作業区分ごと
//   ・ABC: 設備の札（全設備＋11 台）・左にパレート図（A＝藍・B＝琥珀・C＝灰）・右に表（累積の帯・ABC の印・平均作業・換算係数・換算本数）
// 案の方向（何で解くか）:
//   A 作った物
//   B 見せ方: 勤務の外を斜線でなく淡い灰の地に（地の模様を減らし、棒を主に）
//   C 見せ方: 稼働率を主に（字を大きく・稼働率の高さで 3 段の濃さの数の地。全体の稼働率も大きく）
//   D 減らし方: 棒の字（ロット番号）を出さず、棒を細く（形だけで稼働の塊を見る）
//   E 置き場: ABC の表を左・パレート図を右（読む順＝表が先）
//   F 減らし方: ABC のパレート図をやめ、表の累積の帯を広く・行の左に ABC の色の帯
//   G 置き場: ABC の設備の札を左の縦の並びに（設備の数が増えても 1 列）
let seq = 0;
const watch = (sel, fn) => { const k = `op${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 作った物（斜線の勤務外・右に稼働率／パレート図＋表・設備の札）", css: "", ops: [] },
  { key: "B", name: "B 勤務の外は淡い灰の地（斜線をやめる）", css: `.og-off{fill:#e9ecee}.og-on{fill:#ffffff}.og-k-off{background:#e9ecee!important}`, ops: [] },
  {
    key: "C", name: "C 稼働率を主に（大きな字・高さで 3 段の地・全体も大きく）",
    css: `.og-rate{font-size:15px}.og-all b{font-size:17px}.og-rchip{rx:4}`,
    ops: [watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-rate").forEach((t) => { const v = parseFloat(t.textContent); if (isNaN(v)) return;
      const b = t.getBBox(), r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("x", b.x - 4); r.setAttribute("y", b.y - 1); r.setAttribute("width", b.width + 8); r.setAttribute("height", b.height + 2); r.setAttribute("rx", 4);
      r.setAttribute("fill", v >= 40 ? "#cfe6e2" : v >= 20 ? "#e6efee" : "#f2f4f5"); t.before(r); }); }`)],
  },
  { key: "D", name: "D 棒の字を出さず、棒を細く", css: `.og-bl{display:none}`, ops: [watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-bar").forEach((r) => { const h = +r.getAttribute("height"), y = +r.getAttribute("y"); if (r.dataset.thin) return; r.dataset.thin = 1; r.setAttribute("y", y + h * 0.22); r.setAttribute("height", h * 0.56); }); }`)] },
  { key: "E", name: "E ABC は表を左・パレート図を右", css: `.oa-main{flex-direction:row-reverse}`, ops: [] },
  {
    key: "F", name: "F ABC はパレート図をやめ、累積の帯を広く・行の左に ABC の色",
    css: `.oa-chart{display:none}.oa-cum{width:120px}.oa-table tbody tr.oa-r-A th{box-shadow:inset 4px 0 0 #3f6591}.oa-table tbody tr.oa-r-B th{box-shadow:inset 4px 0 0 #b5822a}.oa-table tbody tr.oa-r-C th{box-shadow:inset 4px 0 0 #6f7c85}.oa-table tbody th{padding-left:10px}`,
    ops: [],
  },
  {
    key: "G", name: "G ABC の設備の札を左の縦の並びに",
    css: `.oa-wrap{display:grid;grid-template-columns:96px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;column-gap:10px}.oa-tabs{grid-row:1;flex-direction:column;overflow:hidden;gap:3px}
      .oa-tab{border-radius:6px;text-align:left}.oa-main{grid-column:2;grid-row:1}.oa-foot{grid-column:1 / -1}`,
    ops: [],
  },
];
