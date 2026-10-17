// 2026-10 ダッシュボードの改良（版 3.41.0）。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashslice-2.mjs --states dash-slicer,dash-slicer-pick,dash-series,dash-tree,dash-corners
//   （1280x720 でも: --view 1280x720）
// 1 回目（2026-10-dashslice.mjs）の 1 位は A1 65.3 点（合格点 95 に届かず）。土台で直した所:
//   ①折れ線の数値ラベル: ほかの系列の点を障りにし、線の脚が通らない側を選ぶ。同じ日に同じ値の系列は 1 つのラベル（墨の字）にまとめる
//   ②行を引いて並べる: ゴーストは名前だけの小さな札にして、並びの右の外・入る所の線の高さに出し「◀ ここへ n 番目」（並びの札を覆わない・番号が食い違わない）。
//     元の所の空きは番号を出さない
//   ③「設備…」の面が左上に開いた（前の面を閉じて道具の行を描き直すと、押した札が外れていた）→ 描き直した後の札の下に開く
//   ④スライサーで期間を替えたパネルは、題の期間の言葉（前日・今月など）をスライサーの期間に置き換えて印（「9月の実績本数」）。合わせた表の題も
//   ⑤1280 の詰めた形にも効いている枚数（6 / 6 枚）・編集で狭いパネルの印は絵だけ（題が切れない）・編集の説明を短く・四隅の取っ手は選んだパネルを濃く
// 持ち越し: B0＝直した土台・B1＝A1（道具の行の下の帯。編集のときは帯を出さない）
// 新しい案:
//   B2 減らし方: 道具の行のほかの物を詰める（ダッシュボードの札は名前だけ・「03:17 の数」は引き直すの説明へ・引き直すは絵だけ）→ 1280 でも全部の札が 1 段に出る
//   B3 形: 期間・設備を、組む所の札と同じ「つながった札」（1 本の帯の中で選ぶ）にし、効いている枚数は「× 外す」の中へ（部品の数を減らす）
//   B4 B1＋B3（帯の中に、つながった札）
//   B5 置き場: 道具の行の右（引き直す・編集の左）。左＝どのダッシュボードか、右＝どう絞るか。B2 の詰め方も
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// B1・B4: 道具の行の下の帯（編集のときは出さない）
const strip = ["script", `{ const put = () => { const bar = document.querySelector("#dashBar"); if (!bar) return; const w = bar.querySelector("#dashSlicer"); let st = document.querySelector("#pvStrip");
  if (!w) { if (st && bar.querySelector(".db-editing")) st.remove(); return; }
  if (!st) { st = document.createElement("div"); st.id = "pvStrip"; st.className = "pv-strip"; bar.after(st); }
  w.remove(); st.innerHTML = '<div id="dashSlicer" class="ds-wrap">' + Dashboard._slicerHtml(false) + '</div>'; };
  new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); put(); }`];
const stripCss = `.pv-strip{flex:0 0 auto;min-width:0}.pv-strip .ds-wrap{overflow:visible}.pv-strip .ds-bar{width:100%;box-sizing:border-box}`;

// B2・B5: 道具の行のほかの物を詰める
const slimCss = `.db-tools .db-pick small{display:none}.db-tools .db-when{display:none}
.db-tools [data-db-refresh]{font-size:0;width:32px;padding:0}.db-tools [data-db-refresh]::before{content:"↻";font-size:16px}`;
const slimOps = watch(".ds-hits", `(h) => { const m = /(\\d+) \\/ (\\d+)/.exec(h.textContent); if (m) { h.title = h.textContent; h.textContent = m[1] + " / " + m[2] + " 枚"; } }`);
const refreshTip = watch("[data-db-refresh]", `(b) => { const w = document.querySelector(".db-when"); b.title = "いま引き直す（" + (w ? w.textContent : "") + "）"; }`);

// B3・B4: つながった札
const segCss = `.ds-chips{gap:0;border:1px solid var(--edit-line,#d5dde5);border-radius:8px;overflow:hidden}
.ds-chips .ds-chip{border:0;border-radius:0;height:26px}.ds-chips .ds-chip + .ds-chip{border-left:1px solid var(--edit-line,#d5dde5)}
.ds-chips .ds-chip.on{background:var(--input-soft,#eef3f9);color:var(--h-input);box-shadow:inset 0 -2.5px 0 var(--h-input)}
.ds-month{border-radius:8px}`;
const hitsIntoClear = watch(".ds-clear", `(b) => { const h = b.parentElement.querySelector(".ds-hits"); if (!h) return; const m = /(\\d+) \\/ (\\d+)/.exec(h.textContent); h.remove(); if (m) { b.textContent = "× 外す（" + m[1] + " 枚に効いています）"; } }`);

// B5: 道具の行の右へ
const right = ["script", `{ const put = () => { const bar = document.querySelector("#dashBar"), w = bar && bar.querySelector("#dashSlicer"), sp = bar && bar.querySelector(":scope > .db-sp"); if (!w || !sp || w.previousElementSibling === sp) return; sp.after(w); };
  new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); put(); }`];

export const PROPOSALS = [
  { key: "B0", name: "直した土台（道具の行の中・1280 は詰めた形・題の期間を置き換え）", css: "", ops: [] },
  { key: "B1", name: "A1 を持ち越し（道具の行の下の帯）", css: stripCss, ops: [strip] },
  { key: "B2", name: "道具の行のほかの物を詰めて、全部の札を 1 段に", css: slimCss, ops: [slimOps, refreshTip] },
  { key: "B3", name: "つながった札・枚数は「外す」の中", css: segCss, ops: [hitsIntoClear] },
  { key: "B4", name: "帯の中に、つながった札（B1＋B3）", css: stripCss + segCss, ops: [strip, hitsIntoClear] },
  { key: "B5", name: "道具の行の右に置く（B2 の詰め方も）", css: slimCss, ops: [right, slimOps, refreshTip] },
];
