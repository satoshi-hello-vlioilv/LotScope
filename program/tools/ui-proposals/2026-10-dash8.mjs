// 2026-10-dash8（版 3.48.0。利用者の要望 2026-10-21 の 3 回目）: 組み込みを外す・入れ替える／設備を手で並べる／ABC の出す項目・全設備の時間・作業開始の列。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dash8.mjs --states dash-ops-lead,dash-eorder,dash-swap-pop,dash-hide-pop --from dash
//   （--view 1536x864・1280x720 でも）
// 今の物（A。作った物）を撮って見えたこと:
//   dash-ops-lead … 「全設備の時間」の見出しが 2 段に折れる。「出す項目」の見出しだけが 1 段を使い、チェックが次の段に回って見出しの列とそろわない。
//                   作業開始・作業終了（何を数えるかの決め事）が、出す項目（見せ方）より下にある＝流れが逆。リードタイムと分かるのは列の名前（平均 LT）だけ
//   dash-eorder   … 11 台の設備の札が 3 段に折れ、← → の的が小さい（20px）。ガントには関係の無い「値の大きい順にしていれば…」が 1 段を使う
//   dash-swap-pop … 入れ替えた「標準」に、組み込みと入れ替えた印が無い（「組み込みに戻す」が何に戻すのかを推測させる）
//   dash-hide-pop … ダッシュボードが無いのに「編集」が出ている（何を編集するのか分からない）
// 案の方向: A 作った物 / B 置き場（出す項目を ④ 見せ方へ・作業開始と作業終了を品種の上へ・設備は縦の番号つきの並び）/
//   C 見せ方（出す項目を押す札・設備の札を大きく 1 段に流す・面の札に印）/ D 減らし方（出す項目を畳む・設備の札から矢印を外し ⋮⋮ だけ・外した組み込みを一覧の中へ）/
//   E 流れ（出す項目をパネルの見出しの「列 ▾」で・設備はガントの行の名前を引いて並べる）/ F 言葉（見出し・選びの言葉をそろえ、入れ替えた印と戻す先を名前で言う）
let seq = 0;
const watch = (sel, fn) => { const k = `d8${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// 空のダッシュボードでは「編集」を出さない（どの案も。D は「＋ 空から作る」を主のボタンに）
const EMPTY = `body:has(.db-none) .db-editbtn{display:none}`;
// 出す項目の段を ④ 見せ方の頭へ動かす
const SHOW_TO_LOOK = watch("#dbEditor", `(ed) => { const row = ed.querySelector("#deSent .de-row:has(.de-ochk)"), look = ed.querySelector("#deLook"); if (row && look) look.prepend(row); }`);
// 作業開始・作業終了の段を、品種の段のすぐ下へ
const STAMPS_UP = watch("#dbEditor .de-ops", `(ops) => { const cls = ops.querySelector(".de-clsrow"); if (!cls) return; const s = ops.querySelector(".de-row:has([data-de-ostart])"), e = ops.querySelector(".de-row:has([data-de-oend])"); if (s && e && cls.nextElementSibling !== s) { cls.after(s); s.after(e); } }`);
// ガント（並べ替えの無い形）では「値の大きい順…」の添え書きを出さない
const NO_SORT_HINT = watch("#dbEditor", `(ed) => { if (!ed.querySelector("[data-de-ocolor]")) return; const h = ed.querySelector(".de-row:has([data-de-eord]) .de-hint"); if (h) h.remove(); }`);
// 入れ替えた物の印（面の一覧の札）
const swapMark = (word) => watch(".db-pickpop", `(pop) => { if (!pop.querySelector("[data-db-unswap]")) return; const li = pop.querySelector(".db-li.on[data-db-open]"); if (li && !li.querySelector(".d8-swap")) li.querySelector("b").insertAdjacentHTML("afterend", '<i class="d8-swap">${word}</i>'); }`);
const SWAP_CSS = `.d8-swap{font-style:normal;font-size:11.5px;font-weight:700;color:#24446a;border:1px solid #9fb0c6;border-radius:999px;padding:0 7px;margin-left:6px;line-height:18px}`;
// 見出しの折れ（「全設備の時間」が 2 段）: その段の見出しだけ 1 段に（見出しの列を広げると「量」の段の選びが折れた: 1 回目の自分の確認）
const WIDE_LABEL = `.de-ops .de-row:has([data-de-ospan]) .de-l{white-space:nowrap;flex:0 0 auto;width:auto}`;

export const PROPOSALS = [
  { key: "A", name: "A 作った物（組む所の稼働の欄に足した段・設備の札に ← →・面に「組み込みに戻す」と「外した組み込み」）", css: EMPTY, ops: [] },
  { key: "B", name: "B 置き場: 出す項目は ④ 見せ方へ・作業開始と作業終了は品種の下・設備は縦の番号つきの並び（↑↓）・入れ替えた印",
    css: EMPTY + SWAP_CSS + WIDE_LABEL + `
      .de-eord{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px;width:100%}
      .de-eoc{height:30px;background:#f3f6f8!important;color:var(--ink)!important;border:1px solid #d5dde3;justify-content:flex-start}
      .de-eoc .de-eon{background:#2f7d78;color:#fff}
      .de-eoc b{flex:1 1 auto}
      .de-eoc button{color:var(--ink)!important;width:26px;height:26px}
      #deLook > .de-row:has(.de-ochk){margin-bottom:6px}`,
    ops: [SHOW_TO_LOOK, STAMPS_UP, NO_SORT_HINT, swapMark("組み込みと入れ替え"),
      watch(".de-eord", `(o) => o.querySelectorAll("[data-de-eomove]").forEach((b) => { b.textContent = b.dataset.d === "-1" ? "↑" : "↓"; })`)] },
  { key: "C", name: "C 見せ方: 出す項目は押す札（✓）・設備の札は大きく 1 段に流す（的 28px）・入れ替えた印",
    css: EMPTY + SWAP_CSS + WIDE_LABEL + `
      .de-ochk{gap:6px}
      .de-ochk .pv-ck{border:1px solid #c9d3da;border-radius:999px;padding:3px 12px;background:#fff;cursor:pointer;font-weight:700;color:var(--muted)}
      .de-ochk .pv-ck input{position:absolute;opacity:0;width:1px;height:1px}
      .de-ochk .pv-ck:has(input:checked){background:#e5eef6;border-color:#4d6e96;color:#24446a}
      .de-ochk .pv-ck:has(input:checked)::before{content:"✓ ";font-weight:800}
      .de-eord{gap:6px}
      .de-eoc{height:32px;font-size:13px}
      .de-eoc button{width:28px;height:28px;font-size:15px}`,
    ops: [NO_SORT_HINT, swapMark("組み込みと入れ替え")] },
  { key: "D", name: "D 減らし方: 出す項目は畳んだ 1 段（6/8 ▾）・設備の札は ⋮⋮ だけ（引いて並べる）・外した組み込みは一覧の中に淡く",
    css: EMPTY + WIDE_LABEL + `
      .de-eoc button{display:none}
      .de-eoc::before{content:"⋮⋮";font-size:11px;opacity:.75;margin-right:2px}
      .de-eoc{cursor:grab;padding-right:10px}
      .d8-fold{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border:1px solid #c9d3da;border-radius:6px;background:#fff;font-weight:700;color:var(--ink)}
      .d8-fold small{font-weight:400;color:var(--muted)}
      .db-hid{opacity:.8}
      body:has(.db-none) .db-none .btn-primary{display:none}`,
    ops: [NO_SORT_HINT,
      watch("#dbEditor .de-ops", `(ops) => { const row = ops.querySelector(".de-row:has(.de-ochk)"); if (!row || row.querySelector(".d8-fold")) return; const ck = row.querySelector(".de-ochk"), all = ck.querySelectorAll("input").length, on = ck.querySelectorAll("input:checked").length;
        ck.style.display = "none"; ck.insertAdjacentHTML("beforebegin", '<button type="button" class="d8-fold">' + on + ' / ' + all + ' 項目 <small>構成比・累積・ABC …</small> ▾</button>'); }`)] },
  { key: "E", name: "E 流れ: 出す項目はパネルの見出しの「列 ▾」・設備はガントの行の名前を引いて並べる（組む所は並びの選びだけ）",
    css: EMPTY + SWAP_CSS + `
      #dbEditor .de-row:has(.de-ochk){display:none}
      .de-eord{display:none}
      .d8-cols{height:26px;padding:0 10px;border:1px solid #c9d3da;border-radius:6px;background:#fff;font:inherit;font-size:12.5px;font-weight:700;color:var(--ink)}
      .d8-grip{fill:#5a6f77;font-size:11px}`,
    ops: [NO_SORT_HINT, swapMark("組み込みと入れ替え"),
      watch(".db-p .db-ph", `(ph) => { const p = ph.closest(".db-p"); if (!p.querySelector(".oa-wrap") || ph.querySelector(".d8-cols")) return; const f = ph.querySelector("[data-db-filter]"); (f || ph).insertAdjacentHTML(f ? "beforebegin" : "beforeend", '<button type="button" class="d8-cols" title="表の列・パレート図・下の段を出す・出さない">列 ▾</button>'); }`),
      watch("#dbEditor .de-row:has([data-de-eord])", `(row) => { const h = row.querySelector(".de-hint"); if (h) h.textContent = "パネルの行の名前（⋮⋮）を引いて並べます"; }`),
      watch(".og-svg", `(svg) => { if (!document.querySelector("#dbEditor [data-de-eord]:checked[value=hand]")) return; svg.querySelectorAll(".og-name").forEach((t) => { if (t.dataset.g) return; t.dataset.g = 1; const g = document.createElementNS("http://www.w3.org/2000/svg", "text"); g.setAttribute("class", "d8-grip"); g.setAttribute("x", 4); g.setAttribute("y", t.getAttribute("y")); g.textContent = "⋮⋮"; t.after(g); }); }`)] },
  { key: "F", name: "F 言葉: 「全設備の作業時間」・選びは中身を言う・設備は「設備の順」・入れ替えた印と戻す先を名前で（組み込みの「標準」に戻す）",
    css: EMPTY + SWAP_CSS + WIDE_LABEL,
    ops: [NO_SORT_HINT, swapMark("組み込みの代わり"),
      watch("#dbEditor .de-ops", `(ops) => { const l = ops.querySelector(".de-row:has([data-de-ospan]) .de-l"); if (l && l.textContent !== "全設備の作業時間") l.textContent = "全設備の作業時間";
        ops.querySelectorAll(".de-row:has([data-de-ospan]) .de-seg").forEach((s) => { const i = s.querySelector("input"); s.lastChild.nodeValue = i.value === "lead" ? "リードタイム（ロットの最初〜最後）" : "積み上げ（各設備の合計）"; }); }`),
      watch("#dbEditor .de-row:has([data-de-eord])", `(row) => { const l = row.querySelector(".de-l"); if (l) l.textContent = "設備の順"; }`),
      watch(".db-pickpop", `(pop) => { const b = pop.querySelector("[data-db-unswap]"); if (b && !b.dataset.w) { b.dataset.w = 1; b.textContent = "組み込みの「標準」に戻す"; } const r = pop.querySelector("[data-db-remove]"); if (r && pop.querySelector("[data-db-unswap]") && !r.dataset.w) { r.dataset.w = 1; r.textContent = "一覧から外す"; } }`)] },
];
