// 2026-10 保存していない変更の警告（版 3.43.0）: 2 回目（合格点 90 点）。1 回目（2026-10-unsaved.mjs・採点 2026-10-unsaved.json）の 1 位 D（81.8 点）を土台に、
// どの案にも足りなかった所を直す:
//   ・移る先が無く「進む」がどこへかを推測させる → 「勤務体系のタブへ移る前に」と移る先の名前（作る時は goTab・showScreen が渡す）
//   ・最初に見る物が割れる（橙の主のボタンと、焦点の黒い枠の「戻る」）→ 焦点の枠は細い藍の輪にし、主は 1 つ
//   ・D のカードはほかのボタンと形が違い大きい → アプリのボタンと同じ形・高さで、結果の一言は下の小さな字
// 案: D2（D を直す）・K（新: 横に 3 つ＋結果の一言を下に）・L（新: 右に寄せた 3 つ〈Windows の並び〉＋結果の一言）・M（新: 直した物を札で・結果の一言）・N（新: 保存して進むを大きく 1 つ・下に残り 2 つ）
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-unsaved-2.mjs --states unsaved [--view 1280x720]
let seq = 0;
const watch = (sel, fn) => { const k = `us2${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const DEST = watch(".us-body p", `(el) => { el.textContent = "勤務体系のタブへ移る前に、次の変更をどうしますか。"; }`);
const RING = `.us-acts button:focus-visible,.us-acts button:focus{outline:2px solid var(--h-input);outline-offset:2px;border-color:var(--line)}`;
const SAYS = `{ save: "保存してから移ります", discard: "直した所は消えます", back: "この画面に残ります" }`;
const withSays = (cls) => watch(".us-acts", `(el) => { const t = ${SAYS}; el.querySelectorAll("[data-us]").forEach((b) => { const w = document.createElement("span"); w.className = "${cls}"; b.before(w); w.append(b); w.insertAdjacentHTML("beforeend", "<small>" + t[b.dataset.us] + "</small>"); }); }`);

export const PROPOSALS = [
  {
    key: "D2", name: "D2 縦の 3 つ（ボタンと同じ形）＋結果の一言・移る先の名前・焦点は細い輪",
    css: `${RING} .us-acts{flex-direction:column;align-items:stretch;gap:8px}.us-acts .us-sp{display:none}.us2-c{display:grid;grid-template-columns:170px 1fr;align-items:center;gap:12px}.us2-c button{width:170px}.us2-c small{color:var(--muted);font-size:12.5px}`,
    ops: [DEST, withSays("us2-c")],
  },
  {
    key: "K", name: "K 横に 3 つ＋結果の一言を下に・移る先の名前",
    css: `${RING} .us-acts{align-items:flex-start}.us2-k{display:flex;flex-direction:column;gap:4px;align-items:flex-start}.us2-k small{color:var(--muted);font-size:12px}`,
    ops: [DEST, withSays("us2-k")],
  },
  {
    key: "L", name: "L 右に寄せた 3 つ（戻る・保存せずに・保存して）＋結果の一言",
    css: `${RING} .us-acts{justify-content:flex-end;align-items:flex-start}.us-acts .us-sp{display:none}.us2-k{display:flex;flex-direction:column;gap:4px;align-items:center}.us2-k small{color:var(--muted);font-size:12px}`,
    ops: [DEST, withSays("us2-k"), watch(".us-acts", `(el) => { const ws = [...el.querySelectorAll(".us2-k")]; const by = (k) => ws.find((w) => w.querySelector('[data-us="' + k + '"]')); [by("back"), by("discard"), by("save")].forEach((w) => w && el.append(w)); }`)],
  },
  {
    key: "M", name: "M 直した物を札で（タブの名前・何を直したか）＋結果の一言",
    css: `${RING} .us-body ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}.us-body li{display:inline-flex;gap:6px;align-items:center;padding:4px 10px;border-radius:999px;background:#fff1d6;color:#5c3a00;font-weight:700}
      .us-body li small{font-weight:400;color:#7a5a20}.us-acts{align-items:flex-start}.us2-k{display:flex;flex-direction:column;gap:4px;align-items:flex-start}.us2-k small{color:var(--muted);font-size:12px}`,
    ops: [DEST, withSays("us2-k"), watch(".us-body li", `(el) => { el.insertAdjacentHTML("afterbegin", "<small>マスタ管理 › 変換表</small>"); el.insertAdjacentHTML("beforeend", "<small>名前を変えた</small>"); }`)],
  },
  {
    key: "N", name: "N 保存して進むを大きく 1 つ・下に保存せずに進む／戻る",
    css: `${RING} .us-acts{flex-wrap:wrap}.us-acts [data-us="save"]{flex:1 1 100%;height:40px!important;font-size:14.5px}.us-acts .us-sp{display:none}.us-acts .us-discard,.us-acts [data-us="back"]{flex:1}`,
    ops: [DEST],
  },
];
