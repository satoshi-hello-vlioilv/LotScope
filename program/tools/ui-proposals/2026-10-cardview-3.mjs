// カードの窓を大きく・見出しを細く・タブの置き場 — 3 回目（最後の回。2 回目は 1 位 G 75.4 点: 2026-10-cardview.json）
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-cardview-3.mjs --states card-tabs,card-fold,card-dense --from card
// 2 回目の手がかり: G（上は見出し〈同じロット入り〉とタブだけ・デザインは下の帯）が 1 位。残る所: 1280 の 5 列で入力日時が 2 段に折れる（ロット番号の列を残す幅）・
//   タブの数が小さい灰色で目立たない・開いている行の印が窓に隠れる・3 列の項目が 1728 で横に長い
// 3 回目の案（新しい 3 案 I・K・M と、持ち越し G2・C3）:
//   G2: G ＋ タブの数を札に・開いている行をロット番号の列で示す（琥珀の地と左の線）
//   I : G の段の置き方で左右いっぱい（5 列が折れない）＋見出しに「◧ 一覧を見せる」（押すとロット番号の列を残す幅に）
//   K : 左右いっぱい・上は見出し（同じロット・デザインの選びも見出しの中）とタブだけ・下の帯なし（本文がいちばん高い）
//   M : G ＋ 項目の中の余白と名前の字を詰めて、ロット番号の列を残す幅でも 5 列が 1 段に収まる
//   C3: C2（左右いっぱい・デザインの段とタブの段）＋タブの数を札に
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


const pills = `.ll-cardwin .cfv-tab small{padding:0 7px;border-radius:999px;background:var(--input-soft);color:var(--h-input);font-weight:800;font-size:11.5px}
.ll-cardwin .cfv-tabbar .cfv-tab[aria-selected="true"] small{background:var(--h-input);color:var(--on-fill)}`;
const carded = `#llBody tr.is-carded > td{background:#fff3d6 !important}
#llBody tr.is-carded > td.ll-lotcol{box-shadow:inset 4px 0 0 #d08a0c,inset 0 2px 0 #d08a0c,inset 0 -2px 0 #d08a0c !important;font-weight:800}`;
const gLayout = area(`"head" "tabs" "body" "tools"`, "minmax(0,1fr)", "auto auto minmax(0,1fr) auto")
  + ".ll-cardwin .cfv-tabbar{border-bottom:1px solid var(--line)}.ll-cardwin .lk-tools{border-top:1px solid var(--line);background:var(--surface-2)}";
const tight = `.ll-cardwin .cfv-d-compact .cfv-i{padding:2px 6px}
.ll-cardwin .cfv-i.lab-spread{gap:6px}.ll-cardwin .cfv-i.lab-spread .cfv-l{font-size:11px}`;
const wideBtn = `
    const nav = w.querySelector('.lk-nav');
    if (nav && !nav.querySelector('.cf-wide')) nav.insertAdjacentHTML('afterbegin', '<button type="button" class="cf-wide" title="一覧のロット番号の列が見えるように窓を狭めます（もう 1 度で左右いっぱい）" style="width:auto;padding:0 10px">◧ 一覧を見せる</button>');`;
const toolsInHead = `
    const tl = w.querySelector('.lk-tools'), nv = w.querySelector('.lk-nav'), hd = w.querySelector('.lk-head');
    if (tl && nv && hd) {
      if (tl.classList.contains('is-editing')) { if (tl.parentElement === hd) hd.after(tl); }      // 直すときの帯は見出しの下の段に
      else if (tl.nextElementSibling !== nv) nv.before(tl);
    }`;
const toolsHeadCss = `.ll-cardwin > .lk-tools.is-editing{border-bottom:1px solid var(--line)}
.ll-cardwin .lk-head .lk-tools{padding:0;border:0;background:transparent;flex:0 1 auto;min-width:0;gap:8px;margin-left:auto}
.ll-cardwin .lk-head .lk-tools .lc-sp{display:none}.ll-cardwin .lk-head .lk-check{color:#e6eef5;font-size:12.5px;white-space:nowrap}
.ll-cardwin .lk-head .cf-pick{color:#cfe0f0}.ll-cardwin .lk-head .cf-pick select{height:26px;max-width:200px;background:var(--on-dark-fill);color:var(--on-fill);border-color:var(--on-dark-line)}
.ll-cardwin .lk-head .lk-tools button{height:26px;background:var(--on-dark-fill);color:var(--on-fill);border-color:var(--on-dark-line)}
.ll-cardwin .lk-head .lk-nav{margin-left:8px}`;
export const PROPOSALS = [
  { key: "G2", name: "G ＋ タブの数を札に・開いている行をロット番号の列で示す（琥珀の地と左の線）",
    css: slim + sibsInHead + gLayout + pills + carded,
    ops: [place("lot", moveSibs)] },
  { key: "I", name: "G の段の置き方で左右いっぱい（5 列が折れない）＋見出しに「◧ 一覧を見せる」（押すとロット番号の列を残す幅に）",
    css: slim + sibsInHead + gLayout + pills + carded,
    ops: [place("max", moveSibs + wideBtn)] },
  { key: "K", name: "左右いっぱい・上は見出し（同じロット・デザインの選びも見出しの中）とタブだけ・下の帯なし",
    css: slim + sibsInHead + toolsHeadCss + area(`"head" "tools" "tabs" "body"`, "minmax(0,1fr)", "auto auto auto minmax(0,1fr)")
      + ".ll-cardwin .cfv-tabbar{border-bottom:1px solid var(--line)}" + pills,
    ops: [place("max", moveSibs + toolsInHead)] },
  { key: "M", name: "G ＋ 項目の中の余白と名前の字を詰めて、ロット番号の列を残す幅でも 5 列を 1 段に",
    css: slim + sibsInHead + gLayout + pills + carded + tight,
    ops: [place("lot", moveSibs)] },
  { key: "C3", name: "C2（左右いっぱい・デザインの段とタブの段を分ける）＋タブの数を札に",
    css: slim + sibsInHead + area(`"head" "tools" "tabs" "body"`, "minmax(0,1fr)", "auto auto auto minmax(0,1fr)")
      + toolsTop + ".ll-cardwin .cfv-tabbar{border-bottom:1px solid var(--line)}" + pills,
    ops: [place("max", moveSibs)] },
];
