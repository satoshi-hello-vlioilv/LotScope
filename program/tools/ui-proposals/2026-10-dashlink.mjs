// 2026-10 ダッシュボードの改良（版 3.40.0。利用者の要望 6 つ）の置き方・見せ方。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashlink.mjs --states dash-split,dash-facet,dash-link,dash-link-whole,dash-subtotal,master-egroups,appmenu
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashlink.mjs --states （同じ） --view 1280x720
// 今の物（作る前: 版 3.39.0）を撮って見えたこと（利用者の画像と ui-check の dash-panel）:
//   ①設備を 3 つ選び「まとめない（1 台ずつ）」でも 1 本の棒（合算）。まとめないの言葉と結果が食い違う（直感的・状態が見えない）
//   ②「設備」の札はカラムの並びのいちばん上にだけあり、並びを送ると見えない（探させる）
//   ③45度線管理図は 1 つのデータの 2 つの値だけ。別のデータ（目標と実績）を合わせる所が無い
//   ④設備グループの設備の札が作業実績の 12 台だけ（画面奥の表に出る VC・QF・XYZ などが選べない）
//   ⑤グループごとの小計の出し方が無い　⑥画面を印刷・画像にする所が無い
// 土台（N0）: 作った物のまま。案は、土台に CSS と DOM の組み替えを当てて再現する（数え方・描き方は同じ）。
// 案の方向（何で解くか）:
//   N0 置き場: 設備のすぐ下に絵つきの札 4 つ＋説明＋「行に置く・列に置く」／合わせ方は表／印刷はアプリのメニュー
//   P1 流れ: 出し方を ②数え方 の文の上へ（設備を何ごとに出すかを、行・列と同じ所で決める）。合わせるは ① の頭の 2 択の札
//   P2 見せ方: 出し方を大きな絵のカード（2×2）に・合わせ方はデータごとのカード・印刷は見出し帯のボタン
//   P3 減らし方: 出し方は 1 行の札（説明は札の title）・行に置く/列に置くは字のリンク・印刷はダッシュボードの道具の行
//   P4 見せ方（色）: 役割の色を強く（札・表の行の頭に役割の色の帯と「横軸／縦軸」）・ルールの行の右に当たる設備
//   P5 流れ（出す時だけ）: 出し方は設備を 2 つ以上選んだときだけ出す・合わせるは ③形 の 45度線などの横に・印刷は右下の浮くボタン
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// ---- 印刷・ハードコピーの置き場（アプリのメニュー以外） ----
const headerPrint = ["insert", `<button type="button" class="btn-ghost on-dark pv-hcbtn" onclick="Hardcopy.print()" title="画面を印刷（Ctrl＋P）">⎙ 印刷・画像 ▾</button>`, "beforebegin", "#appBtn"];
const dashPrint = watch("#dashBar", `(bar) => { const put = () => { if (bar.querySelector(".pv-dbhc")) return; const sp = bar.querySelector(".db-sp"); if (sp) sp.insertAdjacentHTML("afterend", '<span class="pv-dbhc"><button type="button" class="pv-btn" title="画面を印刷（Ctrl＋P）">⎙ 印刷</button><button type="button" class="pv-btn" title="画面を画像で保存（Ctrl＋Shift＋S）">画像で保存</button></span>'); };
  put(); new MutationObserver(put).observe(bar, { childList: true }); }`);
const floatPrint = ["insert", `<div class="pv-float"><button type="button" title="画面を印刷（Ctrl＋P）">⎙</button><button type="button" title="画面を画像で保存（Ctrl＋Shift＋S）">⤓</button></div>`, "beforeend", "body"];
const hideMenuHc = `#appMenu .am-sep,#amPrint,#amShot,#amCopy{display:none}`;
const hcCss = `.pv-hcbtn{margin-right:6px}
.pv-dbhc{display:inline-flex;gap:6px;margin-left:8px}
.pv-float{position:fixed;right:18px;bottom:18px;z-index:70;display:flex;flex-direction:column;gap:6px}
.pv-float button{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:var(--surface);box-shadow:0 4px 12px rgba(0,0,0,.18);font-size:18px;cursor:pointer}`;

// ---- P1: 出し方を ② の文の上へ・合わせるは ① の頭の 2 択 ----
const P1ops = [
  watch("#dbEditor .de-row:has(.de-splitbox)", `(row) => { const sent = document.querySelector("#deSent"); if (sent && row.parentElement && row.parentElement.id === "deData") { row.classList.add("pv-in-sent"); sent.prepend(row); } }`),
  watch("#dbEditor .de-row:has(.de-linkbtn)", `(row) => { const d = document.querySelector("#deData"); if (!d) return; const btn = row.querySelector(".de-linkbtn"); d.insertAdjacentHTML("afterbegin", '<div class="de-row pv-twopick"><span class="de-l">数える物</span><span class="de-segs"><label class="de-seg on">1 つのデータ</label><label class="de-seg pv-go">別のデータと合わせる（目標と実績）</label></span></div>'); d.querySelector(".pv-go").onclick = () => btn.click(); row.style.display = "none"; }`),
];
const P1css = `#dbEditor .pv-in-sent{margin:0 0 8px;padding:8px;border:1px dashed var(--line);border-radius:8px}
#dbEditor .pv-in-sent .de-eqput{display:none}`;

// ---- P2: 大きな絵のカード（2×2）・合わせ方はデータごとのカード ----
const P2css = `#dbEditor .de-splits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;width:100%}
#dbEditor .de-splits .de-frame{height:52px;flex-direction:column;justify-content:center;gap:3px;font-size:13px}
#dbEditor .de-splits .de-sico{width:22px;height:22px}
#dbEditor .de-splitwhy{display:none}
#dbEditor .de-lnkt thead{display:none}
#dbEditor .de-lnkt,#dbEditor .de-lnkt tbody{display:block}
#dbEditor .de-lnkt tbody tr{display:grid;grid-template-columns:1fr auto;gap:4px 10px;margin-bottom:8px;padding:8px 10px 8px 14px;border:1px solid var(--line);border-radius:10px;box-shadow:inset 5px 0 0 var(--rc)}
#dbEditor .de-lnkt td,#dbEditor .de-lnkt th{border:0;padding:0}
#dbEditor .de-lnkt td:nth-child(3)::before{content:"軸 ";color:var(--muted)}
#dbEditor .de-lnkt td:nth-child(4)::before{content:"値 ";color:var(--muted)}`;

// ---- P3: 1 行の札・字のリンク ----
const P3css = `#dbEditor .de-splitwhy{display:none}
#dbEditor .de-splits .de-frame{height:26px;padding:0 8px}
#dbEditor .de-splits .de-sico{display:none}
#dbEditor .de-eqput .pv-btn{border:0;background:none;color:var(--h-input);text-decoration:underline;padding:0 2px;height:auto}
#dbEditor .de-splitbox{flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px}`;

// ---- P4: 役割の色を強く・ルールの右に当たる設備 ----
const P4css = `#dbEditor .de-tab.is-side{border-top:0}
#dbEditor .de-tab.is-side i{height:6px}
#dbEditor .de-tab.is-side.on{background:color-mix(in srgb,var(--gc) 10%,#fff)}
#dbEditor .de-lnkt tbody tr{box-shadow:inset 6px 0 0 var(--rc);background:color-mix(in srgb,var(--rc) 6%,#fff)}
#dbEditor .de-lnkt td:nth-child(2) .de-seg.on{background:var(--rc);color:#fff}
#dbEditor .de-lnkt tbody tr:nth-child(1) td:nth-child(3)::after{content:"  → 横軸";color:var(--muted);font-size:11px}
#dbEditor .de-lnkt tbody tr:nth-child(2) td:nth-child(3)::after{content:"  → 縦軸";color:var(--muted);font-size:11px}
.eg-rule .pv-hit{font-size:12px;color:var(--h-input);font-weight:700;margin-left:6px}`;
const P4ops = [watch(".eg-rule", `(row) => { const v = row.querySelector("[data-eg-rv]").value; if (!v) return; const hits = [...document.querySelectorAll(".sh-eq.is-rule[aria-pressed=true]")].map((b) => b.textContent.replace("≈", "")); row.insertAdjacentHTML("beforeend", '<span class="pv-hit">→ ' + hits.join("・") + '</span>'); }`)];

// ---- P5: 出し方は設備を 2 つ以上選んだときだけ・合わせるは ③ 形の横に ----
const P5ops = [
  watch("#dbEditor .de-row:has(.de-splitbox)", `(row) => { const btn = document.querySelector("#dbEditor .de-eqbtn"); const n = btn ? (btn.textContent.match(/・/g) || []).length + (/ほか (\\d+)/.test(btn.textContent) ? +RegExp.$1 : 0) + (btn.classList.contains("is-on") ? 1 : 0) : 0; if (n < 2) row.style.display = "none"; }`),
  watch("#dbEditor .de-row:has(.de-linkbtn)", `(row) => { const vis = document.querySelector("#deVis"); if (vis) { row.classList.add("pv-at-vis"); vis.append(row); } }`),
];
const P5css = `#dbEditor .pv-at-vis{margin-top:6px}`;

export const PROPOSALS = [
  { key: "N0", name: "設備の下に絵の札・合わせ方は表・印刷はアプリのメニュー", css: "", ops: [] },
  { key: "P1", name: "出し方を数え方の文の上・合わせるは 2 択の札", css: P1css, ops: P1ops },
  { key: "P2", name: "絵のカード 2×2・合わせ方はカード・印刷は見出し帯", css: P2css + hcCss + hideMenuHc, ops: [headerPrint] },
  { key: "P3", name: "1 行の札・字のリンク・印刷は道具の行", css: P3css + hcCss + hideMenuHc, ops: [dashPrint] },
  { key: "P4", name: "役割の色を強く・ルールの右に当たる設備", css: P4css, ops: P4ops },
  { key: "P5", name: "出し方は 2 つ以上のときだけ・合わせるは形の横・印刷は浮くボタン", css: P5css + hcCss + hideMenuHc, ops: [...P5ops, floatPrint] },
];
