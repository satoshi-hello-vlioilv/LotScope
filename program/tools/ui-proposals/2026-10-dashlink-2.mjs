// 2026-10 ダッシュボードの改良（版 3.40.0）の置き方・見せ方。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashlink-2.mjs --states dash-split,dash-facet,dash-link,dash-link-whole,dash-subtotal,master-egroups,appmenu
//   （1280x720 でも: --view 1280x720）
// 1 回目（2026-10-dashlink.mjs）の 1 位は N0 66.2 点（合格点 95 に届かず）。採点者の指摘のうち、土台の描き方の不具合は土台で直した:
//   ①合わせたグラフの右の目盛りが棒に重なる → 目標と実績は同じ単位なので左の同じ目盛り（達成率だけ右。右に目盛りの余白）
//   ②1280 で道具の行の案内が切れる → 短くした　③役割の色が札（目標＝紫・実績＝青緑）とグラフで食い違う → グラフも役割の色
//   ④全体の札で段の番号が ① → ③ と飛ぶ → 見えている段の順に番号　⑤並べるの縦軸がそろわない・色が重ねると違う → 同じ縦軸・その設備の色
//   ⑥小計のチェックが見出し無しで浮く → 文のすぐ下に「設備グループごとの小計を出す」
// 避ける所（1 回目）: 印刷をダッシュボードだけに置く・見出し帯に足す（1280 ではみ出す）・浮くボタン
// 持ち越し: R0＝直した土台（N0）・R1＝R0＋P1 の「1 つのデータ／別のデータと合わせる」の 2 択を ① の頭に（出し方は設備のすぐ下のまま）
// 新しい案（4 つ）:
//   R2 置き場: R1＋印刷・画像はアプリのメニューに加えて、ダッシュボードの道具の行にも（どの画面でもメニューから届く）
//   R3 減らし方: R1＋出し方の札を設備のボタンと同じ段の右へ（① の段を 1 つ減らす。説明の 1 行と絵は残す）
//   R4 見せ方: R1＋合わせ方の全体を、データごとのカードを左右に並べ「→ 45度線の横軸／縦軸」を読める大きさで（役割の色の帯）
//   R5 状態を見せる: R1＋出し方の札に「3 系列」「3 枚」と、いま何本・何枚になるかを出す・小計は札（押すと入切）・
//      設備グループのマスタはルールの行の右に、いま当てはまる設備（読める大きさ）
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// R1: ① の頭の 2 択（1 つのデータ／別のデータと合わせる）。「＋ 別のデータと合わせる」の行は見えなくする（押す所は残す: 撮る手順が押す）
const twoPick = watch("#dbEditor .de-row:has(.de-linkbtn)", `(row) => { const d = document.querySelector("#deData"); if (!d || d.querySelector(".pv-twopick")) return; const btn = row.querySelector(".de-linkbtn");
  d.insertAdjacentHTML("afterbegin", '<div class="de-row pv-twopick"><span class="de-l">数える物</span><span class="de-segs"><label class="de-seg on">1 つのデータ</label><label class="de-seg pv-go">別のデータと合わせる（目標と実績）</label></span></div>');
  d.querySelector(".pv-go").onclick = () => btn.click(); row.classList.add("pv-gone"); }`);
const twoCss = `#dbEditor .pv-gone{position:absolute;opacity:0;pointer-events:auto;height:0;overflow:hidden}`;

// R2: ダッシュボードの道具の行にも印刷・画像
const dashPrint = watch("#dashBar", `(bar) => { const put = () => { if (bar.querySelector(".pv-dbhc")) return; const sp = bar.querySelector(".db-sp"); if (sp) sp.insertAdjacentHTML("afterend", '<span class="pv-dbhc"><button type="button" class="pv-btn" title="画面を印刷（Ctrl＋P）">⎙ 印刷</button><button type="button" class="pv-btn" title="画面を画像で保存（Ctrl＋Shift＋S）">画像で保存</button></span>'); };
  put(); new MutationObserver(put).observe(bar, { childList: true }); }`);
const dashPrintCss = `.pv-dbhc{display:inline-flex;gap:6px;margin:0 8px}`;

// R3: 出し方を設備のボタンの段の右へ
const splitRight = watch("#dbEditor .de-row:has(.de-splitbox:not(.pv-split-inline))", `(row) => { if (row.querySelector(".de-eqbtn")) return; const eq = row.previousElementSibling && row.previousElementSibling.querySelector(".de-eqbtn") ? row.previousElementSibling : null;
  if (!eq) { const any = [...document.querySelectorAll("#deData .de-row")].find((r) => r.querySelector(".de-eqbtn")); if (!any) return; }
  const host = eq || [...document.querySelectorAll("#deData .de-row")].find((r) => r.querySelector(".de-eqbtn"));
  const box = row.querySelector(".de-splitbox"); box.classList.add("pv-split-inline"); host.append(box); row.remove(); }`);
const splitRightCss = `#dbEditor .pv-split-inline{flex:1 1 320px;margin-left:8px}
#dbEditor .pv-split-inline .de-splits .de-frame{height:28px}`;

// R4: 合わせ方をデータごとのカード（左右）
const cardsCss = `#dbEditor .de-lnkt thead{display:none}
#dbEditor .de-lnkt,#dbEditor .de-lnkt tbody{display:block}
#dbEditor .de-lnkt tbody{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#dbEditor .de-lnkt tbody tr{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:9px 10px 9px 14px;border:1px solid var(--line);border-radius:10px;box-shadow:inset 5px 0 0 var(--rc);background:color-mix(in srgb,var(--rc) 5%,#fff)}
#dbEditor .de-lnkt td,#dbEditor .de-lnkt th{border:0;padding:0;white-space:normal}
#dbEditor .de-lnkt td:nth-child(3)::before{content:"軸 ";color:var(--muted);font-size:12px}
#dbEditor .de-lnkt td:nth-child(4)::before{content:"値 ";color:var(--muted);font-size:12px}
#dbEditor .pv-axis{font-size:12.5px;font-weight:700;color:var(--ink)}
#dbEditor .pv-axis b{color:var(--rc)}`;
const axisTag = watch("#dbEditor .de-lnkt tbody tr", `(tr) => { const on = tr.querySelector("td:nth-child(2) .de-seg.on"); const r = on ? on.textContent.trim() : ""; const t = r === "目標" ? "→ 45度線の<b>横軸</b>・グラフの棒" : r === "実績" ? "→ 45度線の<b>縦軸</b>・グラフの線" : "→ 並べて比べる";
  tr.insertAdjacentHTML("beforeend", '<td class="pv-axis">' + t + '</td>'); }`);

// R5: 出し方の札に本数・枚数・小計は札・ルールの右に当たる設備
const splitCount = watch("#dbEditor .de-splits", `(box) => { const btn = document.querySelector("#dbEditor .de-eqbtn"); if (!btn) return; const t = btn.textContent; const n = btn.classList.contains("is-on") ? t.split("・").length + (/ほか (\\d+)/.test(t) ? +RegExp.$1 - 1 : 0) : 0;
  if (n < 2) return; box.querySelectorAll(".de-frame").forEach((l) => { const v = l.querySelector("input").value; const add = v === "series" ? n + " 系列" : v === "facet" ? n + " 枚" : v === "sum" ? "1 つ" : ""; if (add) l.insertAdjacentHTML("beforeend", '<small class="pv-cnt">' + add + '</small>'); }); }`);
const ruleHits = watch(".eg-rule", `(row) => { const v = row.querySelector("[data-eg-rv]").value; if (!v) return; const hits = [...document.querySelectorAll(".sh-eq.is-rule[aria-pressed=true]")].map((b) => b.textContent.replace("≈", "").trim());
  row.insertAdjacentHTML("beforeend", '<span class="pv-hit">→ いま ' + hits.length + ' 設備: ' + hits.join("・") + '</span>'); }`);
const r5Css = `#dbEditor .pv-cnt{font-size:11.5px;font-weight:700;color:var(--muted);margin-left:2px}
#dbEditor .de-frame.on .pv-cnt{color:var(--h-input)}
#dbEditor .de-subrow .pv-ck{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--edit-line);border-radius:999px;background:var(--edit-field);font-weight:700}
#dbEditor .de-subrow .pv-ck:has(input:checked){border-color:var(--h-input);background:var(--input-soft);color:var(--h-input)}
.eg-rule .pv-hit{font-size:12.5px;color:var(--ink);font-weight:600;margin-left:8px}`;

export const PROPOSALS = [
  { key: "R0", name: "直した土台（設備の下に絵の札・合わせ方は表・印刷はメニュー）", css: "", ops: [] },
  { key: "R1", name: "R0＋① の頭に「1 つのデータ／別のデータと合わせる」", css: twoCss, ops: [twoPick] },
  { key: "R2", name: "R1＋印刷・画像を道具の行にも", css: twoCss + dashPrintCss, ops: [twoPick, dashPrint] },
  { key: "R3", name: "R1＋出し方を設備のボタンの右へ", css: twoCss + splitRightCss, ops: [twoPick, splitRight] },
  { key: "R4", name: "R1＋合わせ方はデータのカードと横軸／縦軸", css: twoCss + cardsCss, ops: [twoPick, axisTag] },
  { key: "R5", name: "R1＋本数・枚数を札に・小計は札・ルールの右に当たる設備", css: twoCss + r5Css, ops: [twoPick, splitCount, ruleHits] },
];
