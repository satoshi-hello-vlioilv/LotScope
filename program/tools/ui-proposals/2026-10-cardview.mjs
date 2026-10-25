// カードの窓を大きく・見出しを細く・タブの置き場（版 3.56.0。利用者の要望 2026-10-25）
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-cardview.mjs --states card-tabs,card-fold,card-dense --from card
// 今（撮って見たこと）: 窓は約 880×830。本文の前に 見出し（品質データのカード・ロット番号・行の番号の 3 段 110px）・同じロットの行（46px）・
//   デザインの段（52px）・タブ（40px）で約 250px（窓の 3 割）。窓は一覧の右に寄り、左の一覧の側は空いたまま。
// 案の方向: 置き場（タブを上・左・見出しの中）・減らし方（段を 1 本にまとめる・下へ寄せる）・大きさ（右 75%・一覧に重ねて最大）
// 再現: 窓の段（見出し・同じロットの行・デザインの段・タブ・本文）を CSS の grid の置き場で組み替え、窓の大きさを script で決める（中身は本物）
const slim = `
.ll-cardwin .lk-head{padding:5px 10px 5px 14px;min-height:0;flex-wrap:nowrap;row-gap:0}
.ll-cardwin .lk-title{display:flex;align-items:baseline;gap:10px;flex:0 1 auto;min-width:0}
.ll-cardwin .lk-title .lc-eyebrow{display:none}
.ll-cardwin .lk-title h3{font-size:18px;margin:0}
.ll-cardwin .lk-title .lc-lead{margin:0;font-size:12.5px;white-space:nowrap;opacity:.85}
.ll-cardwin .lk-nav{flex-wrap:nowrap;margin-left:auto}
.ll-cardwin .lk-nav button,.ll-cardwin .lc-x{height:28px}
.ll-cardwin .lk-nav .lk-pick{height:28px}
.ll-cardwin .lk-tools{min-height:0;padding:4px 12px;border-bottom:0}
.ll-cardwin .lk-sibs{padding:4px 12px;border-bottom:0;background:transparent}
.ll-cardwin .cfv-tabbar{padding:0 10px;border-bottom:0}
.ll-cardwin .lk-body{padding:10px 14px}
.ll-cardwin{display:grid !important;min-height:0}
.ll-cardwin > *{min-width:0}
`;
const rect = (kind) => ["script", `
  const go = () => {
    const w = document.querySelector('.ll-cardwin:not([hidden])'); if (!w || w.dataset.cfr) return;
    const s = document.querySelector('#lotListScreen'), top = Math.round((s ? s.getBoundingClientRect().top : 64) + 6);
    const left = ${kind === "max" ? "16" : "Math.round(innerWidth * 0.25)"}, width = innerWidth - left - 16, height = innerHeight - top - 12;
    Object.assign(w.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
    w.dataset.cfr = '1';
  };
  new MutationObserver(() => { try { go(); } catch (e) {} }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  go();`];
const area = (rows, cols, map) => `.ll-cardwin{grid-template-areas:${rows};grid-template-columns:${cols};grid-template-rows:${map.rows}}
.ll-cardwin .lk-head{grid-area:head}.ll-cardwin .lk-sibs{grid-area:sibs}.ll-cardwin .lk-tools{grid-area:tools}.ll-cardwin .cfv-tabbar{grid-area:tabs}.ll-cardwin .lk-body{grid-area:body}
.ll-cardwin .lk-sibs[hidden]{display:none}.ll-cardwin .cfv-tabbar[hidden]{display:none}`;
const line = ".ll-cardwin .lk-body{border-top:1px solid var(--line)}";

export const PROPOSALS = [
  { key: "A", name: "見出しを 1 段（ロット・行の番号・送り）＋その下の 1 段にタブ・同じロット・デザイン。窓は一覧の右 75%・高さいっぱい",
    css: slim + area(`"head head head" "tabs sibs tools" "body body body"`, "minmax(0,1fr) auto auto", { rows: "auto auto minmax(0,1fr)" }) + line
      + ".ll-cardwin .cfv-tabbar{align-self:end}.ll-cardwin .lk-tools .lc-sp{display:none}",
    ops: [rect("right")] },
  { key: "B", name: "見出しを 1 段＋左に縦のタブ（目次）・上にデザインと同じロット。窓は一覧の右 75%",
    css: slim + area(`"head head head" "sibs sibs tools" "tabs body body"`, "190px auto minmax(0,1fr)", { rows: "auto auto minmax(0,1fr)" })
      + ".ll-cardwin:has(.cfv-tabbar[hidden]){grid-template-columns:0 auto minmax(0,1fr)}"
      + `.ll-cardwin .cfv-tabbar{flex-direction:column;align-items:stretch;padding:8px 6px;gap:2px;border-right:1px solid var(--line);background:var(--surface-2);overflow-y:auto}
.ll-cardwin .cfv-tabbar .cfv-tab{justify-content:space-between;border-bottom:0;border-left:3px solid transparent;border-radius:0 6px 6px 0;height:34px}
.ll-cardwin .cfv-tabbar .cfv-tab[aria-selected="true"]{border-left-color:var(--h-input);background:var(--surface)}
.ll-cardwin .lk-tools{border-bottom:1px solid var(--line)}.ll-cardwin .lk-sibs{border-bottom:1px solid var(--line);white-space:nowrap}.ll-cardwin .lk-sibs em{white-space:nowrap}`,
    ops: [rect("right")] },
  { key: "C", name: "一覧に重ねて最大化（左右いっぱい）・見出し 1 段＋タブとデザインの 1 段",
    css: slim + area(`"head head head" "tabs sibs tools" "body body body"`, "minmax(0,1fr) auto auto", { rows: "auto auto minmax(0,1fr)" }) + line
      + ".ll-cardwin .cfv-tabbar{align-self:end}.ll-cardwin .lk-tools .lc-sp{display:none}",
    ops: [rect("max")] },
  { key: "D", name: "タブを見出しの段の中へ（1 段: ロット・タブ・デザイン・送り）。同じロットは細い 2 段目。窓は右 75%",
    css: slim + area(`"head tabs tools" "sibs sibs sibs" "body body body"`, "auto minmax(0,1fr) auto", { rows: "auto auto minmax(0,1fr)" })
      + `.ll-cardwin .lk-head,.ll-cardwin .cfv-tabbar,.ll-cardwin .lk-tools{background:var(--surface);border-bottom:1px solid var(--line)}
.ll-cardwin .lk-head{background:linear-gradient(135deg,#1f3b55,#2b5a7a)}
.ll-cardwin .lk-head .lk-nav{margin-left:14px}
.ll-cardwin .cfv-tabbar{align-items:stretch}.ll-cardwin .cfv-tabbar .cfv-tab{height:auto}
.ll-cardwin .lk-tools .lk-check,.ll-cardwin .lk-tools .lc-sp{display:none}.ll-cardwin .lk-tools .cf-pick select{max-width:180px}`,
    ops: [rect("right")] },
  { key: "E", name: "上は見出し 1 段とタブだけ・デザインと同じロットは下の帯へ。窓は右 75%",
    css: slim + area(`"head head" "tabs tabs" "body body" "sibs tools"`, "auto minmax(0,1fr)", { rows: "auto auto minmax(0,1fr) auto" })
      + `.ll-cardwin{grid-template-rows:auto auto minmax(0,1fr) auto !important}
.ll-cardwin .cfv-tabbar{border-bottom:1px solid var(--line)}
.ll-cardwin .lk-sibs,.ll-cardwin .lk-tools{border-top:1px solid var(--line);background:var(--surface-2)}`,
    ops: [rect("right")] },
];
