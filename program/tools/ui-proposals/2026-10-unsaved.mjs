// 2026-10 保存していない変更の警告（版 3.43.0。利用者の要望 7: マスタに限らず、設定を変えたまま保存せずに閉じる・別の画面へ移る操作に警告）。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-unsaved.mjs --states unsaved
//   （1280x720 でも: --view 1280x720）
// 今の物を調べて見えたこと（作る前・版 3.42.0）:
//   ・聞くのはマスタ管理の右の詳細だけで、ブラウザの confirm（OK・キャンセル）。何が保存されていないかの名前が無く、「保存して進む」も無い
//   ・変換表・勤務体系・設備グループ・データ元・表示列の窓・ルールの窓・ダッシュボードの編集は、閉じる・移ると黙って捨てる。終了ボタンも聞かない
// 案の方向（何で解くか）:
//   A 見せ方（アプリの窓）: 真ん中の窓。何が保存されていないか（名前の並び）と［保存して進む］［保存せずに進む］……［戻る］。焦点は「戻る」（作った物）
//   B 並び（OS の並び）: 「戻る」を右端に主のボタンとして、保存して進む・保存せずに進むを左に
//   C 減らし方（2 つだけ）: ［保存して進む］［戻る］の 2 つ。捨てるのは小さな字のつなぎ（誤って捨てにくい）
//   D 見せ方（縦の選び）: 3 つを縦のカード（それぞれの結果を一言で: 「保存してから移ります」「直した所は消えます」「この画面に残ります」）
//   E 置き場（その場の帯）: 窓ではなく、閉じる・移るボタンの下の細い帯で同じ 3 つ（画面を覆わない）
let seq = 0;
const watch = (sel, fn) => { const k = `us${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

export const PROPOSALS = [
  { key: "A", name: "A 真ん中の窓・3 つ（作った物）", css: "", ops: [] },
  {
    key: "B", name: "B 「戻る」を右端の主のボタンに",
    css: `.us-acts [data-us="back"]{background:var(--h-input);color:#fff;border-color:var(--h-input)}.us-acts [data-us="save"]{background:var(--surface);color:var(--h-input);border:1px solid var(--h-input)}`,
    ops: [],
  },
  {
    key: "C", name: "C 2 つ（保存して進む・戻る）＋捨てるは小さなつなぎ",
    css: `.us-acts .us-discard{border:0;background:none;text-decoration:underline;font-weight:400;padding:0 4px}`,
    ops: [watch(".us-acts", `(el) => { const d = el.querySelector(".us-discard"), sp = el.querySelector(".us-sp"); sp.after(d); }`)],
  },
  {
    key: "D", name: "D 縦の 3 つのカード（結果を一言で）",
    css: `.us-acts{flex-direction:column;align-items:stretch}.us-acts .us-sp{display:none}.us-acts button{height:auto!important;padding:8px 14px!important;text-align:left;display:flex;flex-direction:column;align-items:flex-start}
      .us-acts button small{font-weight:400;opacity:.85}`,
    ops: [watch(".us-acts", `(el) => { const t = { save: "保存してから移ります", discard: "直した所は消えます", back: "この画面に残ります" };
      el.querySelectorAll("[data-us]").forEach((b) => b.insertAdjacentHTML("beforeend", "<small>" + t[b.dataset.us] + "</small>")); }`)],
  },
  {
    key: "E", name: "E 画面の上の細い帯（覆わない）",
    css: `.us-overlay{background:none;place-items:start center;padding-top:70px;pointer-events:none}.us-card{pointer-events:auto;width:min(900px,calc(100vw - 32px));display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:10px 14px;border-top:0;border-left:4px solid #c27a12}
      .us-body{margin:0}.us-body p{display:none}.us-body ul{display:flex;gap:10px;padding:0;list-style:none}.us-acts{margin:0}.us-head h3{font-size:14px}`,
    ops: [],
  },
];
