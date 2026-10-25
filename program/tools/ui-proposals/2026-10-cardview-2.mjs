// カードの窓を大きく・見出しを細く・タブの置き場 — 2 回目（1 回目は 1 位 C 69.4 点で決めない: 2026-10-cardview.json）
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-cardview-2.mjs --states card-tabs,card-fold,card-dense --from card
// 1 回目の採点の手がかり: 右 75% の幅では 5 列の値が切れ・折れる（C の幅が要る）。加点は B（縦のタブの目次）と E（上は見る物・下は設定）が高い。
//   C の弱い所: 一覧が全部隠れていまの行が分からない・3 列の項目が横に長すぎて短い値の右が空く・1 段に物が混む。E の弱い所: 同じロットの札が ◀▶ から遠い
// 2 回目の案（新しい 3 案 F・G・H と、前の回で効いた所の持ち越し C2・B2）:
//   F: 一覧のロット番号の列だけ残して広げる＋左の縦のタブ＋同じロットは見出しの中（ロット番号の隣）＋デザインは本文の上の細い段
//   G: F と同じ幅＋上は見出し（同じロット入り）とタブだけ・デザインは下の帯（E の改良）
//   H: F に本文の幅の上限（3 列が横に伸びすぎない。項目は 1 つ 420px まで）を足す
//   C2: C（最大化）＋同じロットを見出しへ・タブの段とデザインの段を分ける
//   B2: B（縦のタブ）を最大化
const slim = `
.ll-cardwin .lk-head{padding:5px 10px 5px 14px;min-height:0;flex-wrap:nowrap;row-gap:0;gap:12px}
.ll-cardwin .lk-title{display:flex;align-items:baseline;gap:10px;flex:0 0 auto;min-width:0}
.ll-cardwin .lk-title .lc-eyebrow{display:none}
.ll-cardwin .lk-title h3{font-size:18px;margin:0}
.ll-cardwin .lk-title .lc-lead{margin:0;font-size:12.5px;white-space:nowrap;opacity:.85}
.ll-cardwin .lk-nav{flex-wrap:nowrap;margin-left:auto}
.ll-cardwin .lk-nav button,.ll-cardwin .lc-x,.ll-cardwin .lk-nav .lk-pick{height:28px}
.ll-cardwin .lk-tools{min-height:0;padding:4px 12px;border-bottom:0}
.ll-cardwin .lk-sibs{padding:4px 12px;border-bottom:0;background:transparent;white-space:nowrap}
.ll-cardwin .cfv-tabbar{padding:0 10px;border-bottom:0}
.ll-cardwin .lk-body{padding:10px 14px}
.ll-cardwin{display:grid !important;min-height:0}
.ll-cardwin > *{min-width:0}
`;
// 同じロットの札を見出しの中（ロット番号の隣）へ（暗い帯の上の札）
const sibsInHead = `
.ll-cardwin .lk-head .lk-sibs{padding:0;display:flex;gap:4px;flex:0 1 auto;min-width:0;overflow:hidden}
.ll-cardwin .lk-head .lk-sibs em{color:#cfe0f0;font-size:12px;margin-right:2px}
.ll-cardwin .lk-head .lk-sibs button{height:24px;min-width:26px;border-color:var(--on-dark-line);background:var(--on-dark-fill);color:var(--on-fill)}
.ll-cardwin .lk-head .lk-sibs button[aria-pressed="true"]{background:var(--surface);border-color:var(--surface);color:var(--h-input)}`;
const moveSibs = `
    const sb = w.querySelector('.lk-sibs'), tt = w.querySelector('.lk-title');
    if (sb && tt && sb.previousElementSibling !== tt) tt.after(sb);`;
/** kind: "lot"＝一覧のロット番号の列だけ残す・"max"＝左右いっぱい */
const place = (kind, extra = "") => ["script", `
  const go = () => {
    const w = document.querySelector('.ll-cardwin:not([hidden])'); if (!w) return;
    ${extra}
    if (w.dataset.cfr) return;
    const s = document.querySelector('#lotListScreen'), top = Math.round((s ? s.getBoundingClientRect().top : 64) + 6);
    const lot = document.querySelector('#llHead th.ll-lotcol');
    const left = ${kind === "lot" ? "Math.round((lot ? lot.getBoundingClientRect().right : 200) + 6)" : "16"}, width = innerWidth - left - 16, height = innerHeight - top - 12;
    Object.assign(w.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
    w.dataset.cfr = '1';
  };
  new MutationObserver(() => { try { go(); } catch (e) {} }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  go();`];
const area = (rows, cols, trows) => `.ll-cardwin{grid-template-areas:${rows};grid-template-columns:${cols};grid-template-rows:${trows}}
.ll-cardwin .lk-head{grid-area:head}.ll-cardwin .lk-tools{grid-area:tools}.ll-cardwin .cfv-tabbar{grid-area:tabs}.ll-cardwin .lk-body{grid-area:body}
.ll-cardwin > .lk-sibs{grid-area:sibs}.ll-cardwin .lk-sibs[hidden]{display:none}.ll-cardwin .cfv-tabbar[hidden]{display:none}`;
const vtabs = `
.ll-cardwin .cfv-tabbar{flex-direction:column;align-items:stretch;padding:8px 6px;gap:2px;border-right:1px solid var(--line);background:var(--surface-2);overflow-y:auto}
.ll-cardwin .cfv-tabbar .cfv-tab{justify-content:space-between;border-bottom:0;border-left:3px solid transparent;border-radius:0 6px 6px 0;height:34px}
.ll-cardwin .cfv-tabbar .cfv-tab[aria-selected="true"]{border-left-color:var(--h-input);background:var(--surface)}
.ll-cardwin:has(.cfv-tabbar[hidden]){grid-template-columns:0 minmax(0,1fr) !important}`;
const toolsTop = ".ll-cardwin .lk-tools{border-bottom:1px solid var(--line);background:var(--surface)}";
const capBody = ".ll-cardwin .lk-body .cfv{max-width:calc(var(--cf-cols) * 84px + (var(--cf-cols) - 1) * 8px)}";

export const PROPOSALS = [
  { key: "F", name: "一覧のロット番号の列だけ残して広げる・左に縦のタブ・同じロットは見出しのロット番号の隣・デザインは本文の上の細い段",
    css: slim + sibsInHead + area(`"head head" "tools tools" "tabs body"`, "190px minmax(0,1fr)", "auto auto minmax(0,1fr)") + vtabs + toolsTop,
    ops: [place("lot", moveSibs)] },
  { key: "G", name: "F と同じ幅・上は見出し（同じロット入り）とタブだけ・デザインは下の帯",
    css: slim + sibsInHead + area(`"head" "tabs" "body" "tools"`, "minmax(0,1fr)", "auto auto minmax(0,1fr) auto")
      + ".ll-cardwin .cfv-tabbar{border-bottom:1px solid var(--line)}.ll-cardwin .lk-tools{border-top:1px solid var(--line);background:var(--surface-2)}",
    ops: [place("lot", moveSibs)] },
  { key: "H", name: "F ＋ 本文の幅の上限（3 列の項目は 1 つ約 360px まで。横に伸びすぎない）",
    css: slim + sibsInHead + area(`"head head" "tools tools" "tabs body"`, "190px minmax(0,1fr)", "auto auto minmax(0,1fr)") + vtabs + toolsTop + capBody,
    ops: [place("lot", moveSibs)] },
  { key: "C2", name: "C（左右いっぱい）＋同じロットを見出しへ・タブの段とデザインの段を分ける",
    css: slim + sibsInHead + area(`"head" "tools" "tabs" "body"`, "minmax(0,1fr)", "auto auto auto minmax(0,1fr)")
      + toolsTop + ".ll-cardwin .cfv-tabbar{border-bottom:1px solid var(--line)}",
    ops: [place("max", moveSibs)] },
  { key: "B2", name: "B（左に縦のタブ・上にデザインと同じロット）を左右いっぱい",
    css: slim + area(`"head head head" "sibs sibs tools" "tabs body body"`, "190px auto minmax(0,1fr)", "auto auto minmax(0,1fr)")
      + vtabs.replace("grid-template-columns:0 minmax(0,1fr)", "grid-template-columns:0 auto minmax(0,1fr)")
      + ".ll-cardwin .lk-tools{border-bottom:1px solid var(--line)}.ll-cardwin > .lk-sibs{border-bottom:1px solid var(--line)}",
    ops: [place("max")] },
];
