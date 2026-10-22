// 2026-10-22 ABC 分析の段を A・B・C に限らない（版 3.51.0。利用者の要望）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-abcrank.mjs --states dash-ops-ranks,dash-ops-ranks-edit --from dash
// 今の画像で見えた問題（abc0-*/dash-ops-edit-light-now.png）: 組む所の「ABC線」は A・B の 2 つの欄が決め打ちで、線を足す手段が無い・
//   品種ごとに段を付ける選び方が無い・「残りが C」は字だけで、いくつの段ができるかが形で見えない・欄が広く数字が離れて読みにくい
// 土台（全案）: サーバーは線をいくつでも（lims）・品種ごと（rankBy each）で数える。段の名前は A〜Z の次が AA・AB …。パネルの画像は線 4 本（40・60・80・95%）＝ A〜E
// 自分で確かめて直した所（撮り直し）: C・D で「D ≦」と数の欄が別の行に分かれた → 段の名前と欄を 1 組にして折らない。数の欄が広すぎた → 46px
// 案の方向（組む所の段の操作の形）:
//   A 分け方の切り替え［線で分ける｜品種ごと］＋ 線の札（A ≦ 40% ×）を並べ、「＋ 線」で足す … 札を足し引き（慣れた型）
//   B 分け方の切り替え＋線を 1 つの欄に「40, 60, 80, 95」と書く ＋ できる段の見本（A〜40・B〜60 …・E）… 打つ
//   C 段の数の −／＋（5 段）で線を等分に作り、数の欄で直す … 数で決める
//   D 決まった分け方の選び（ABC 70・90／ABCD 50・75・90／A〜E …／品種ごと／自分で決める）＋ 自分で決める欄 … 選ぶ
//   E 0〜100% の帯を段の色で区切り、境ごとに数の欄、「＋ 線」・品種ごと … 形で見せる
let seq = 0;
const watch = (sel, fn) => { const k = `ab${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const LIMS = [40, 60, 80, 95];
const COLS = ["#24446a", "#395980", "#4d6e96", "#889db6", "#c3ccd5"], INK = ["#fff", "#fff", "#fff", "#1b2733", "#1b2733"];
const R = (i) => `<b class="mk-r" style="background:${COLS[i]};color:${INK[i]}">${"ABCDE"[i]}</b>`;
const SEG = `<span class="mk-seg" role="radiogroup" aria-label="分け方"><button class="on">線で分ける</button><button>品種ごと</button></span>`;
const BASE = `.mk-pair{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}.mk-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:4px 0}
  .mk-r{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 3px;border-radius:4px;font-size:11.5px;font-weight:700}
  .mk-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.mk-seg button{height:28px;padding:0 10px;border:0;border-left:1px solid var(--line);background:var(--surface);font:inherit;font-size:13px;color:var(--ink)}
  .mk-seg button:first-child{border-left:0}.mk-seg button.on{background:#e8f0f6;color:#1f3f60;font-weight:700;box-shadow:inset 0 0 0 1px #9db6cc}
  .mk-n{width:46px!important;min-width:0!important;height:26px;border:1px solid var(--edit-line,#c9d3dc);border-radius:6px;background:var(--edit-field,#fffdf6);font:13px ui-monospace,Consolas,monospace;text-align:right;padding:0 5px}
  .mk-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 3px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:12.5px;white-space:nowrap}
  .mk-chip button{border:0;background:none;color:#6b7680;font-size:13px;padding:0 2px}
  .mk-add{height:26px;padding:0 10px;border:1px dashed #8aa0b6;border-radius:8px;background:var(--surface);font:inherit;font-size:12.5px;color:#1f3f60}
  .mk-h{color:var(--muted);font-size:12px}.mk-txt{width:190px;height:28px;border:1px solid var(--edit-line,#c9d3dc);border-radius:6px;background:var(--edit-field,#fffdf6);font:13px ui-monospace,Consolas,monospace;padding:0 8px}
  .mk-prev{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--ink)}
  .mk-step{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden}.mk-step button{width:28px;height:28px;border:0;background:var(--surface);font-size:16px;font-weight:700}
  .mk-step b{padding:0 10px;border-left:1px solid var(--line);border-right:1px solid var(--line);line-height:28px;font-size:13px}
  .mk-sel{height:28px;border:1px solid var(--edit-line,#c9d3dc);border-radius:6px;background:var(--surface);font:inherit;font-size:13px;padding:0 6px}
  .mk-bar{position:relative;display:flex;width:100%;max-width:420px;height:22px;border-radius:5px;overflow:hidden;border:1px solid #9aa9b8}
  .mk-bar span{display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700}
  .mk-ticks{position:relative;width:100%;max-width:420px;height:30px}.mk-ticks .mk-n{position:absolute;top:2px;transform:translateX(-50%);width:44px}`;
const row = (html) => watch("#dbEditor .de-row:has([data-de-oa])", `(r) => { r.innerHTML = '<label class="de-l" title="ABC の段の分け方">ABC</label><div class="mk-col" style="flex:1;min-width:0">' + ${JSON.stringify(html)} + '</div>'; r.style.alignItems = "flex-start"; }`);
export const PROPOSALS = [
  { key: "A", name: "A 分け方の切り替え＋線の札（A ≦ 40% ×）を並べ「＋ 線」で足す", css: BASE,
    ops: [row(`<div class="mk-row">${SEG}</div><div class="mk-row">${LIMS.map((v, i) => `<span class="mk-chip">${R(i)} ≦<input class="mk-n" value="${v}">%<button title="この線を外す">×</button></span>`).join("")}<button class="mk-add">＋ 線</button><span class="mk-h">残りが</span>${R(4)}</div>`)] },
  { key: "B", name: "B 線を 1 つの欄に「40, 60, 80, 95」と書く＋できる段の見本", css: BASE,
    ops: [row(`<div class="mk-row">${SEG}</div><div class="mk-row"><span class="mk-h">累積の線</span><input class="mk-txt" value="40, 60, 80, 95"><span class="mk-h">%（, で区切る）</span></div><div class="mk-row mk-prev">${LIMS.map((v, i) => `${R(i)}〜${v}%`).join("")}${R(4)}残り</div>`)] },
  { key: "C", name: "C 段の数の −／＋ で線を等分に作り、数の欄で直す", css: BASE,
    ops: [row(`<div class="mk-row"><span class="mk-h">段の数</span><span class="mk-step"><button>−</button><b>5 段（A〜E）</b><button>＋</button></span><label class="mk-h"><input type="checkbox"> 品種ごとに 1 段</label></div><div class="mk-row">${LIMS.map((v, i) => `<span class="mk-pair">${R(i)}≦<input class="mk-n" value="${v}">%</span>`).join("")}${R(4)}</div>`)] },
  { key: "D", name: "D 決まった分け方の選び（ABC・ABCD・A〜E・品種ごと・自分で）＋ 自分で決める欄", css: BASE,
    ops: [row(`<div class="mk-row"><select class="mk-sel"><option>A・B・C（70・90%）</option><option>A〜D（50・75・90%）</option><option selected>自分で決める（いま A〜E）</option><option>品種ごとに A・B・C …</option></select></div><div class="mk-row">${LIMS.map((v, i) => `<span class="mk-pair">${R(i)}≦<input class="mk-n" value="${v}">%</span>`).join("")}${R(4)}<button class="mk-add">＋ 線</button></div>`)] },
  { key: "E", name: "E 0〜100% の帯を段の色で区切り、境ごとに数の欄・「＋ 線」", css: BASE,
    ops: [row(`<div class="mk-row">${SEG}<button class="mk-add">＋ 線</button></div><div class="mk-bar">${[0, ...LIMS, 100].slice(1).map((v, i, a) => `<span style="width:${v - (i ? a[i - 1] : 0)}%;background:${COLS[i]};color:${INK[i]}">${"ABCDE"[i]}</span>`).join("")}</div><div class="mk-ticks">${LIMS.map((v) => `<input class="mk-n" style="left:${v}%" value="${v}">`).join("")}</div>`)] },
];
