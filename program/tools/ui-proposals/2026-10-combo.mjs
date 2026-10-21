// 2026-10-21 グラフの組み合わせ（版 3.46.0。利用者の要望 3: グラフ同士を汎用的に組み合わせる）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-combo.mjs --states dash-combo   （1536x864・1280x720 でも）
// 作った物（A）を撮って見えたこと（自分で画像を見た）: 形「組み合わせ」（1 つ目の系列＝棒・ほか＝線。桁が違えば右の目盛り）。
//   組む所の書式の「系列」は、1 段目に色と名前、2 段目に 形（自動・棒・線・面）・目盛り（自動・左・右）・数値ラベル・線（実線・破線）の札
// 案の方向（何で解くか）:
//   A 作った物
//   B 見せ方: 形の札を絵（棒・線・面の印）にして短く
//   C 減らし方: 「自動」の札を外し、選んでいない時は何も押されていない形（札の数を減らす）
//   D 置き場: 系列の書式を表に（行＝系列、列＝形・目盛り・数値・線。見出しは 1 回）
//   E 見せ方: 系列の名前の行に、いまの形と目盛りの要約（棒・左 など）を出し、札は畳む（押すと開く）
let seq = 0;
const watch = (sel, fn) => { const k = `cb${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 作った物（名前の下の段に 形・目盛り・数値・線の札）", css: "", ops: [] },
  {
    key: "B", name: "B 形の札を絵に",
    css: `.cb-ico{display:inline-block;width:14px;height:12px;vertical-align:-1px}`,
    ops: [watch(".de-sers", `(box) => { const ico = { "棒": '<svg class="cb-ico" viewBox="0 0 14 12"><rect x="1" y="4" width="3" height="8" fill="currentColor"/><rect x="6" y="1" width="3" height="11" fill="currentColor"/><rect x="11" y="6" width="2" height="6" fill="currentColor"/></svg>',
      "線": '<svg class="cb-ico" viewBox="0 0 14 12"><path d="M1 10l4-5 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', "面": '<svg class="cb-ico" viewBox="0 0 14 12"><path d="M1 12V9l4-5 3 3 5-6v11z" fill="currentColor" opacity=".7"/></svg>' };
      box.querySelectorAll('[aria-label$="の形"] .de-seg').forEach((l) => { const t = l.lastChild && l.lastChild.textContent; if (ico[t]) { l.lastChild.remove(); l.insertAdjacentHTML("beforeend", ico[t]); l.title = t; } }); }`)],
  },
  {
    key: "C", name: "C 「自動」の札を外す（選んでいなければ何も押されていない）",
    css: `.de-sers [aria-label$="の形"] .de-seg:first-child,.de-sers [aria-label$="の目盛り"] .de-seg:first-child{display:none}`,
    ops: [],
  },
  {
    key: "D", name: "D 系列の書式を表に（見出しは 1 回）",
    css: `.de-sers{grid-template-columns:minmax(0,1fr)}.de-ser{display:grid!important;grid-template-columns:minmax(90px,1fr) auto auto;align-items:center;column-gap:6px;row-gap:3px}.de-ser .de-scol{grid-column:1;grid-row:1 / span 2}
      .cb-head{display:grid;grid-template-columns:minmax(90px,1fr) auto auto;column-gap:6px;font-size:11.5px;color:var(--muted);font-weight:700;padding:0 4px}`,
    ops: [watch(".de-sers", `(box) => { if (box.querySelector(".cb-head")) return; box.insertAdjacentHTML("afterbegin", '<div class="cb-head"><span>系列</span><span>形・目盛り</span><span>数値・線</span></div>'); }`)],
  },
  {
    key: "E", name: "E 名前の行に要約（棒・左）を出し、札は畳む",
    css: `.de-ser > .de-segs{display:none}.de-ser.cb-open > .de-segs{display:inline-flex}.cb-sum{font-size:12px;color:var(--muted);margin-left:auto;padding:0 6px;border:1px solid var(--line);border-radius:6px;height:24px;display:inline-flex;align-items:center;background:var(--surface)}
      .de-ser .de-scol{flex:1 1 60%!important}`,
    ops: [watch(".de-sers", `(box) => { box.querySelectorAll(".de-ser").forEach((r, i) => { if (r.querySelector(".cb-sum")) return; const on = (lab) => (r.querySelector('[aria-label$="' + lab + '"] .de-seg.on') || {}).textContent || "自動";
      r.querySelector(".de-scol").insertAdjacentHTML("afterend", '<button type="button" class="cb-sum">' + on("の形") + "・" + on("の目盛り") + " ▾</button>"); if (i === 0) r.classList.add("cb-open"); }); }`)],
  },
];
