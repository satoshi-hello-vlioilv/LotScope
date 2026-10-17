// 2026-10 保存していない変更の警告（版 3.43.0）: 3 回目（合格点 80 点）。2 回目（2026-10-unsaved-2.mjs）の 1 位 N（88.0 点）と 2 位 D2（87.2 点。焦点の輪が出なかった減点が無ければ 90.2 点）から:
//   ・押した後に何が起きるかの一言（D2）を残す
//   ・ボタンはアプリのほかのボタンと同じ形・高さ。主（保存して進む）は橙の色だけで示す
//   ・焦点は［戻る］に置き、細い藍の輪が見える（2 回目は組み替えで焦点が外れた。案でも焦点を戻す）
//   ・移る先の名前（勤務体系のタブへ移る前に）
// 案: D3（D2 を直す）・T（新: 見出しに移る先を入れる）・U（新: 直した物に置き場の札〈マスタ管理 › 変換表〉）・V（新: 3 つを横に並べ、一言は各ボタンの下）・W（新: 主を上に 1 つ、残り 2 つを下に並べる〈N の並びを同じ形のボタンで〉）
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-unsaved-3.mjs --states unsaved [--view 1280x720]
let seq = 0;
const watch = (sel, fn) => { const k = `us3${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const DEST = watch(".us-body p", `(el) => { el.textContent = "勤務体系のタブへ移る前に、次の変更をどうしますか。"; }`);
const RING = `.us-acts button:focus{outline:2px solid var(--h-input);outline-offset:2px}`;
const SAYS = `{ save: "保存してから移ります", discard: "直した所は消えます", back: "この画面に残ります" }`;
const wrap = (cls) => watch(".us-acts", `(el) => { const t = ${SAYS}; el.querySelectorAll("[data-us]").forEach((b) => { const w = document.createElement("span"); w.className = "${cls}"; b.before(w); w.append(b); w.insertAdjacentHTML("beforeend", "<small>" + t[b.dataset.us] + "</small>"); });
  setTimeout(() => el.querySelector('[data-us="back"]').focus(), 0); }`);
const ROWS = `${RING} .us-acts{flex-direction:column;align-items:stretch;gap:8px}.us-acts .us-sp{display:none}.us3-c{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:12px}.us3-c button{width:150px}.us3-c small{color:#4b5a68;font-size:12.5px}`;

export const PROPOSALS = [
  { key: "D3", name: "D3 縦の 3 つ（同じ形）＋一言・焦点は戻るに細い輪", css: ROWS, ops: [DEST, wrap("us3-c")] },
  { key: "T", name: "T D3＋見出しに移る先（勤務体系のタブへ移る前に）", css: ROWS + `.us-body p{display:none}`,
    ops: [DEST, wrap("us3-c"), watch("#usTitle", `(el) => { el.innerHTML = "保存していない変更があります<small style=\\"display:block;font-size:12.5px;font-weight:400;color:#4b5a68;margin-top:2px\\">勤務体系のタブへ移る前に、どうしますか</small>"; }`)] },
  { key: "U", name: "U D3＋直した物に置き場の札（マスタ管理 › 変換表）", css: ROWS + `.us-body li small{display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;background:var(--surface-2);color:#4b5a68;font-weight:400;font-size:12px}`,
    ops: [DEST, wrap("us3-c"), watch(".us-body li", `(el) => { el.insertAdjacentHTML("afterbegin", "<small>マスタ管理 › 変換表</small>"); }`)] },
  { key: "V", name: "V 横に 3 つ（同じ形）・一言は各ボタンの下", css: `${RING} .us-acts{align-items:flex-start}.us3-k{display:flex;flex-direction:column;gap:4px;align-items:flex-start}.us3-k small{color:#4b5a68;font-size:12px}`, ops: [DEST, wrap("us3-k")] },
  { key: "W", name: "W 主を上に 1 つ・残り 2 つを下に（同じ高さ）＋一言", css: `${RING} .us-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}.us-acts .us-sp{display:none}.us3-k{display:flex;flex-direction:column;gap:3px}.us3-k button{width:100%}.us3-k small{color:#4b5a68;font-size:12px}
    .us3-k:has([data-us="save"]){grid-column:1/-1}`, ops: [DEST, wrap("us3-k")] },
];
