// 2026-10 ダッシュボードの改良（版 3.41.0）。3 回目（合格点 80 点。最後の回）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashslice-3.mjs --states dash-slicer,dash-slicer-pick,dash-series,dash-tree,dash-corners
//   （1280x720 でも: --view 1280x720）
// 2 回目（2026-10-dashslice-2.mjs）の 1 位は B1 83.3 点・2 位 B0 83.0 点（合格点 90 に届かず）。土台で直した所:
//   ①編集で題が切れる（1280 の数字のパネル「前日の実績…」）→ 題が切れるなら、パネルの操作を「⋯」1 つに畳む（幅で決めず、切れたかを測る）
//   ②先月を選ぶと前日・今月のパネルが同じ題と数に見えた → 印を「前日→9月」「今月→9月」に（元の期間が分かる）
// 持ち越し: C0＝B1（道具の行の下の帯）・C1＝B0（道具の行の中。1280 は詰めた形）
// 新しい案:
//   C2 見せ方: 帯を細く（30px）し、道具の行と同じ地に溶かす（枠を消し、上の段と 1 つのまとまりに見せる。上が 2 段で重い・2 回目の階層化）
//   C3 置き場: 帯の右の空きに「効いている枚数・外す」と「03:17 の数・↻ 引き直す」を寄せ、道具の行を軽くする（2 回目の整列・余白: 右が空いた）
//   C4 流れ: 入れば道具の行の中、入らなければ（1280）帯へ。どちらも同じ札の形（選ぶ欄にしない。2 回目: 1280 で形が変わり、選べる物が見えない）
//   C5 C2＋C3
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

/** 帯へ（always＝いつも・ほかは詰めた形になった時だけ） */
const stripOp = (always) => ["script", `{ const put = () => { const bar = document.querySelector("#dashBar"); if (!bar) return; const w = bar.querySelector("#dashSlicer"); let st = document.querySelector("#pvStrip");
  if (!w) { if (st && bar.querySelector(".db-editing")) st.remove(); return; }
  if (!${always} && !w.querySelector(".is-compact")) { if (st) st.remove(); return; }
  if (!st) { st = document.createElement("div"); st.id = "pvStrip"; st.className = "pv-strip"; bar.after(st); }
  w.remove(); st.innerHTML = '<div id="dashSlicer" class="ds-wrap">' + Dashboard._slicerHtml(false) + '</div>'; };
  new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); put(); }`];
const stripCss = `.pv-strip{flex:0 0 auto;min-width:0}.pv-strip .ds-wrap{overflow:visible}.pv-strip .ds-bar{width:100%;box-sizing:border-box}`;
// C2: 細く・道具の行に溶かす
const slimCss = `.db-screen{gap:4px}.pv-strip .ds-bar{height:30px;border:0;border-radius:0;background:transparent;padding:0 2px;border-bottom:1px solid var(--line-soft)}
.pv-strip .ds-bar.is-on{background:transparent}.pv-strip .ds-chip{height:24px}.pv-strip .ds-month{height:24px}`;
// C3: 帯の右に、枚数・外す と 時刻・引き直す
const rightOps = ["script", `{ const put = () => { const st = document.querySelector("#pvStrip .ds-bar"), bar = document.querySelector("#dashBar"); if (!st || !bar || st.querySelector(".pv-rt")) return;
  const when = bar.querySelector(".db-when"), ref = bar.querySelector("[data-db-refresh]"); if (!when || !ref) return;
  const hits = st.querySelector(".ds-hits"), clear = st.querySelector(".ds-clear");
  st.insertAdjacentHTML("beforeend", '<span class="pv-rt"></span>'); const rt = st.querySelector(".pv-rt");
  if (hits) rt.append(hits); if (clear) rt.append(clear); rt.append(when, ref); };
  new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); put(); }`];
const rightCss = `.pv-rt{margin-left:auto;display:inline-flex;align-items:center;gap:8px}.pv-rt .pv-btn{height:26px}`;

export const PROPOSALS = [
  { key: "C0", name: "B1 を持ち越し（道具の行の下の帯）＋土台の直し", css: stripCss, ops: [stripOp(true)] },
  { key: "C1", name: "B0 を持ち越し（道具の行の中・1280 は詰めた形）＋土台の直し", css: "", ops: [] },
  { key: "C2", name: "細い帯を道具の行に溶かす", css: stripCss + slimCss, ops: [stripOp(true)] },
  { key: "C3", name: "帯の右に、枚数・外す と 時刻・引き直す", css: stripCss + rightCss, ops: [stripOp(true), rightOps] },
  { key: "C4", name: "入れば道具の行の中・入らなければ帯（どちらも札）", css: stripCss, ops: [stripOp(false)] },
  { key: "C5", name: "C2＋C3（細い帯・右に枚数と時刻）", css: stripCss + slimCss + rightCss, ops: [stripOp(true), rightOps] },
];
