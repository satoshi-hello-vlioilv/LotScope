// 2026-10-dash8 の 2 回目（1 回目は 6 案とも 80 点に届かず。1 位 B 79.1 点・2 位 C 72.8 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dash8-2.mjs --states dash-ops-lead,dash-eorder,dash-swap-pop,dash-hide-pop --from dash
// 1 回目で効いた所（持ち越す）: B の流れ（品種 → 作業開始・作業終了 → 量）・「全設備の時間」の見出しを 1 段・入れ替えた印・ガントに関係の無い添え書きを消す・
//   空のダッシュボードで「編集」を出さない／C の押す札（✓ と色）／F の戻す先を名前で言う言葉
// 低かった所: ABC に効く設定（全設備の時間 ②・出す項目 ④）が離れて組む所を上下に送る・2 列の格子に ↑↓ で向きが紛らわしい・縦に長い・
//   出す項目の見出しが 1 段を使い、チェックが次の段に回って見出しの列とそろわない
// 案の方向（新しい案は G・H・I・J）:
//   B2 持ち越し＋直し: 出す項目は ② の「全設備の時間」のすぐ下で、見出しと同じ段にそろえる・設備は 1 列の縦の並び（↑↓）
//   G 見せ方（新）: 出す項目は押す札（✓）で ② にそろえる・設備は大きめの札を読む順に流し ← →
//   H まとめ方（新）: 出す項目を「表の列」「図と段」の 2 つのまとまりに分ける・設備は 2 列の格子を読む順（左→右）にして ← →
//   I 言葉（新）: B2 ＋ 戻す先と入れ替えた印を名前で言う（組み込みの「標準」に戻す・組み込みの代わり）。ボタンは 1 段に収める短い言葉
//   J 置き場（新）: B2 ＋ 設備の並びを枠で囲んだ番号つきの表（⋮⋮・名前・↑↓ を 1 行に詰め、行の高さ 26px）
let seq = 0;
const watch = (sel, fn) => { const k = `d82${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const EMPTY = `body:has(.db-none) .db-editbtn{display:none}`;
const SPAN_LABEL = `.de-ops .de-row:has([data-de-ospan]) .de-l{white-space:nowrap;flex:0 0 auto;width:auto}`;
// 出す項目の段: 見出しと同じ段に、チェックは見出しの右の列で折り返す（見出しの列とそろえる）
const SHOW_ROW = `.de-ops .de-row:has(.de-ochk){flex-wrap:nowrap;align-items:flex-start}.de-ops .de-row:has(.de-ochk) .de-l{padding-top:3px}.de-ochk{flex:1 1 0;min-width:0}`;
// 出す項目を「全設備の時間」の段（と添え書き）のすぐ下へ
const SHOW_UNDER_SPAN = watch("#dbEditor .de-ops", `(ops) => { const sp = ops.querySelector(".de-row:has([data-de-ospan])"), row = ops.querySelector(".de-row:has(.de-ochk)"); if (sp && row && sp.nextElementSibling !== row) sp.after(row); }`);
const STAMPS_UP = watch("#dbEditor .de-ops", `(ops) => { const cls = ops.querySelector(".de-clsrow"); if (!cls) return; const s = ops.querySelector(".de-row:has([data-de-ostart])"), e = ops.querySelector(".de-row:has([data-de-oend])"); if (s && e && cls.nextElementSibling !== s) { cls.after(s); s.after(e); } }`);
const NO_SORT_HINT = watch("#dbEditor", `(ed) => { if (!ed.querySelector("[data-de-ocolor]")) return; const h = ed.querySelector(".de-row:has([data-de-eord]) .de-hint"); if (h) h.remove(); }`);
const swapMark = (word) => watch(".db-pickpop", `(pop) => { if (!pop.querySelector("[data-db-unswap]")) return; const li = pop.querySelector(".db-li.on[data-db-open]"); if (li && !li.querySelector(".d8-swap")) li.querySelector("b").insertAdjacentHTML("afterend", '<i class="d8-swap">${word}</i>'); }`);
const SWAP_CSS = `.d8-swap{font-style:normal;font-size:11.5px;font-weight:700;color:#24446a;border:1px solid #9fb0c6;border-radius:999px;padding:0 7px;margin-left:6px;line-height:18px}`;
const arrows = (up, down) => watch(".de-eord", `(o) => o.querySelectorAll("[data-de-eomove]").forEach((b) => { b.textContent = b.dataset.d === "-1" ? "${up}" : "${down}"; })`);
const BASE = (mark) => [STAMPS_UP, SHOW_UNDER_SPAN, NO_SORT_HINT, swapMark(mark)];
const BASE_CSS = EMPTY + SWAP_CSS + SPAN_LABEL + SHOW_ROW;
// 1 列の縦の並び（番号・名前・↑↓）
const ONE_COL = `
  .de-eord{display:flex;flex-direction:column;gap:3px;width:100%;max-width:340px}
  .de-eoc{height:28px;background:#f3f6f8!important;color:var(--ink)!important;border:1px solid #d5dde3;border-radius:6px!important;justify-content:flex-start;max-width:none}
  .de-eoc .de-eon{background:#2f7d78;color:#fff}
  .de-eoc b{flex:1 1 auto}
  .de-eoc button{color:var(--ink)!important;width:26px;height:24px;border-radius:4px!important}
  .de-eoc button:hover{background:#dfe7ec!important}`;
// 押す札（✓ と色）
const CHIPS = `
  .de-ochk{gap:6px}
  .de-ochk .pv-ck{border:1px solid #c9d3da;border-radius:999px;padding:2px 11px;background:#fff;cursor:pointer;font-weight:700;color:var(--muted)}
  .de-ochk .pv-ck input{position:absolute;opacity:0;width:1px;height:1px}
  .de-ochk .pv-ck:has(input:checked){background:#e5eef6;border-color:#4d6e96;color:#24446a}
  .de-ochk .pv-ck:has(input:checked)::before{content:"✓ ";font-weight:800}`;

export const PROPOSALS = [
  { key: "B2", name: "B2 持ち越し＋直し: 出す項目は ② の全設備の時間の下で見出しとそろえる・設備は 1 列の縦の並び（↑↓）・入れ替えた印",
    css: BASE_CSS + ONE_COL, ops: [...BASE("組み込みと入れ替え"), arrows("↑", "↓")] },
  { key: "G", name: "G 見せ方: 出す項目は押す札（✓）で ② にそろえる・設備は大きめの札を読む順に流し ← →・入れ替えた印",
    css: BASE_CSS + CHIPS + `.de-eord{gap:6px}.de-eoc{height:32px;font-size:13px}.de-eoc button{width:28px;height:28px;font-size:15px}`,
    ops: BASE("組み込みと入れ替え") },
  { key: "H", name: "H まとめ方: 出す項目を「表の列」「図と段」に分ける・設備は 2 列の格子を左→右に読む ← →・入れ替えた印",
    css: BASE_CSS + `
      .d8-grp{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;width:100%}
      .d8-grp + .d8-grp{margin-top:4px}
      .d8-grp > small{flex:0 0 52px;color:var(--muted);font-size:12px}
      .de-eord{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px;width:100%;max-width:520px}
      .de-eoc{height:30px;background:#f3f6f8!important;color:var(--ink)!important;border:1px solid #d5dde3;border-radius:6px!important;justify-content:flex-start;max-width:none}
      .de-eoc .de-eon{background:#2f7d78;color:#fff}
      .de-eoc b{flex:1 1 auto}
      .de-eoc button{color:var(--ink)!important;width:26px;height:26px}`,
    ops: [...BASE("組み込みと入れ替え"),
      watch("#dbEditor .de-ochk", `(ck) => { if (ck.querySelector(".d8-grp")) return; const labs = [...ck.querySelectorAll(":scope > .pv-ck")]; const by = (k) => labs.find((l) => l.querySelector("[data-de-ohide=" + k + "]"));
        const g1 = document.createElement("span"), g2 = document.createElement("span"); g1.className = g2.className = "d8-grp"; g1.innerHTML = "<small>表の列</small>"; g2.innerHTML = "<small>図と段</small>";
        ["share", "cum", "rank", "avg", "factor", "conv"].forEach((k) => by(k) && g1.append(by(k))); ["chart", "foot"].forEach((k) => by(k) && g2.append(by(k))); ck.append(g1, g2); ck.style.display = "block"; }`)] },
  { key: "I", name: "I 言葉: B2 ＋ 戻す先と入れ替えた印を名前で（組み込みの「標準」に戻す・組み込みの代わり）。ボタンは 1 段に収める",
    css: BASE_CSS + ONE_COL, ops: [...BASE("組み込みの代わり"), arrows("↑", "↓"),
      watch(".db-pickpop", `(pop) => { const b = pop.querySelector("[data-db-unswap]"); if (b && !b.dataset.w) { b.dataset.w = 1; b.textContent = "「標準」を組み込みに戻す"; } const r = pop.querySelector("[data-db-remove]"); if (r && !r.dataset.w) { r.dataset.w = 1; r.textContent = "消す"; } const n = pop.querySelector("[data-db-new]"); if (n && !n.dataset.w) { n.dataset.w = 1; n.textContent = "＋ 空から"; } }`)] },
  { key: "J", name: "J 置き場: B2 ＋ 設備の並びを枠で囲んだ番号つきの表（⋮⋮・名前・↑↓ を 1 行。行 26px）",
    css: BASE_CSS + `
      .de-eord{display:flex;flex-direction:column;gap:0;width:100%;max-width:320px;border:1px solid #d5dde3;border-radius:8px;overflow:hidden;background:#fff}
      .de-eoc{height:26px;background:#fff!important;color:var(--ink)!important;border-radius:0!important;border-bottom:1px solid #edf1f4;justify-content:flex-start;max-width:none;padding-left:6px}
      .de-eoc:nth-child(even){background:#f7f9fa!important}
      .de-eoc:last-child{border-bottom:0}
      .de-eoc::before{content:"⋮⋮";font-size:11px;color:#8a99a3;margin-right:4px}
      .de-eoc .de-eon{background:transparent;color:#5a6f77;min-width:18px}
      .de-eoc b{flex:1 1 auto;font-weight:700}
      .de-eoc button{color:var(--ink)!important;width:24px;height:22px;border-radius:4px!important}`,
    ops: [...BASE("組み込みと入れ替え"), arrows("↑", "↓")] },
];
