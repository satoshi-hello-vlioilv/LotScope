// 2026-10-21 グラフの組み合わせ の 2 回目（1 回目は 5 案とも 80 点に届かず。1 位 B 66.4 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-combo-2.mjs --states dash-combo --from dash   （1536x864・1280x720 でも）
// 1 回目の採点で、作った物の不具合として直した所（A に入っている）:
//   札の組に見出しが無い → 「形」「目盛り」「数値」「線」の見出し／「自動」が何かを推測させる → 自動（棒）・自動（左）といま描いている形・目盛りを添える／
//   棒の系列にも［実線・破線］が出る → 線・面で描く系列だけ／押した札の差が弱い → 太字と藍の枠／数値ラベルの上を線が通る → 字の白い縁を太く
// 案の方向（新しい案は C・D・E）:
//   A 直した作った物
//   B 持ち越し（1 回目の 1 位）: 形の札を絵に（棒・線・面の印。目盛りも ◀左・右▶ の印に）
//   C 減らし方（新）: 形と目盛りを 1 つの札の組に（棒・左／棒・右／線・左／線・右／面・左／面・右 と 自動）
//   D 減らし方（新）: 形と目盛りは札、数値と線は「その他 ▾」に畳む（よく使う物だけ出す）
//   E 見せ方（新）: 系列の名前の行の右に、いまの形と目盛りの小さな絵（棒の印・左右の目盛りの印）を出す（どの系列が何で描かれているかを一目で）
let seq = 0;
const watch = (sel, fn) => { const k = `cc${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const ICO = `{ "棒": '<svg class="cc-ico" viewBox="0 0 14 12"><rect x="1" y="4" width="3" height="8" fill="currentColor"/><rect x="6" y="1" width="3" height="11" fill="currentColor"/><rect x="11" y="6" width="2" height="6" fill="currentColor"/></svg>',
  "線": '<svg class="cc-ico" viewBox="0 0 14 12"><path d="M1 10l4-5 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>', "面": '<svg class="cc-ico" viewBox="0 0 14 12"><path d="M1 12V9l4-5 3 3 5-6v11z" fill="currentColor"/></svg>',
  "左": '◀左', "右": '右▶' }`;
export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（組の見出し・自動（棒）・棒に線の札なし・押した札を太字と枠）", css: "", ops: [] },
  {
    key: "B", name: "B 持ち越し: 形の札を絵に・目盛りを ◀左・右▶ に",
    css: `.cc-ico{display:inline-block;width:14px;height:12px;vertical-align:-1px}`,
    ops: [watch(".de-sers", `(box) => { const ico = ${ICO}; box.querySelectorAll('[aria-label$="の形"] .de-seg, [aria-label$="の目盛り"] .de-seg').forEach((l) => { const t = l.lastChild && l.lastChild.textContent; if (ico[t]) { l.lastChild.remove(); l.insertAdjacentHTML("beforeend", ico[t]); l.title = t; } }); }`)],
  },
  {
    key: "C", name: "C 形と目盛りを 1 つの札の組に（棒・左／線・右 など）",
    css: `.de-sers [aria-label$="の目盛り"]{display:none}.de-sers .de-sgrp:has([aria-label$="の目盛り"]){display:none}`,
    ops: [watch(".de-sers", `(box) => { box.querySelectorAll(".de-ser").forEach((r) => { const k = r.querySelector('[aria-label$="の形"]'); if (!k || k.dataset.cc) return; k.dataset.cc = 1;
      const on = (lab) => (r.querySelector('[aria-label$="' + lab + '"] .de-seg.on') || {}).textContent || "";
      const cur = on("の形").replace(/自動（|）/g, "") + "・" + on("の目盛り").replace(/自動（|）/g, "");
      k.innerHTML = ["自動", "棒・左", "棒・右", "線・左", "線・右", "面・右"].map((t) => '<label class="de-seg' + ((t === "自動" && /自動/.test(on("の形"))) || t === cur && !/自動/.test(on("の形")) ? " on" : "") + '">' + t + "</label>").join("");
      k.closest(".de-sgrp").querySelector("small").textContent = "形・目盛り"; }); }`)],
  },
  {
    key: "D", name: "D 形と目盛りは札、数値と線は「その他 ▾」に畳む",
    css: `.de-sers .de-sgrp:has([aria-label$="の数値ラベル"]),.de-sers .de-sgrp:has([aria-label$="の線"]){display:none}.cc-more{height:24px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font:inherit;font-size:12px;color:var(--muted)}`,
    ops: [watch(".de-sers", `(box) => { box.querySelectorAll(".de-ser").forEach((r) => { if (r.querySelector(".cc-more")) return; const ax = r.querySelector('.de-sgrp:has([aria-label$="の目盛り"])'); if (ax) ax.insertAdjacentHTML("afterend", '<button type="button" class="cc-more">その他 ▾</button>'); }); }`)],
  },
  {
    key: "E", name: "E 系列の名前の行に、いまの形と目盛りの小さな絵",
    css: `.cc-now{display:inline-flex;align-items:center;gap:4px;margin-left:auto;padding:0 6px;font-size:11.5px;color:var(--muted)}.cc-now .cc-ico{width:16px;height:12px}.de-ser .de-scol{display:flex}`,
    ops: [watch(".de-sers", `(box) => { const ico = ${ICO}; box.querySelectorAll(".de-ser").forEach((r) => { const c = r.querySelector(".de-scol"); if (!c || c.querySelector(".cc-now")) return;
      const on = (lab) => ((r.querySelector('[aria-label$="' + lab + '"] .de-seg.on') || {}).textContent || "").replace(/自動（|）/g, "");
      c.insertAdjacentHTML("beforeend", '<span class="cc-now">' + (ico[on("の形")] || "") + "<span>" + (on("の目盛り") === "右" ? "右の目盛り" : "左の目盛り") + "</span></span>"); }); }`), ["insert", `<style>.cc-ico{display:inline-block;width:14px;height:12px;vertical-align:-1px}</style>`, "beforeend", "head"]],
  },
];
