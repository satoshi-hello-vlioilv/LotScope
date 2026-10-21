// 2026-10-21（2 回目の要望）稼働のガント・ABC 分析の不具合の直しと改良の見せ方。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops4.mjs --states dash-ops,dash-ops-edit --from dash   （1536x864・1280x720 でも）
// 今の物（版 3.46.0）を撮って見えたこと（tools/ops-bench.py で数も測った）:
//   作業終了が 14 桁・午後・日時の数・日跨ぎ・48 時間超え・前日より前から続く作業の設備は、行が空のまま（区間を出せない理由も数も出ない）。
//   読めない設備は行ごと消える。ABC は品種の列を 1 つしか選べない。色分けの札に計算列を選んでも色が付かない（式がサーバーへ届かない）
// 作った物（A）の見せ方: 棒の無い行は行の中にわけ・棒はあるが区間の分からない作業がある行は右の端に「区間なし n」（琥珀の太字）・
//   作業中（作業終了がまだ無いいちばん新しい作業）は白い斜めの縞＋右の端の › ・前から続く作業は左の端の ‹ ・
//   ABC の組み合わせは列ごとの見出し（狭いパネルは「A1100／H14」の 1 つの欄）・パレート図の名前は列ごとの段・組む所の品種は札を × でつなぐ
// 案の方向（どれも新しい案）:
//   A 作った物
//   B 置き場: 「なし n」を設備名の下に小さく（目が最初に行く名前と一緒に読む。名前の欄が狭く「区間なし」では切れた: 自分の確かめで直した）
//   C 見せ方: 「区間なし n」を琥珀の丸い札に（置き場は A と同じ行の右の端。左の端は前から続く棒と重なった: 自分の確かめで直した）
//   D 減らし方: 行の中の印をやめ、ガントの下の段に「区間の分からない作業: ANF 1 本」の 1 行にまとめる
//   E 見せ方: 作業中の棒は縞でなく、右の端へ向けて淡くなる色＋棒の中に「作業中」
//   F 減らし方: 組み合わせの品種を列に分けず 1 つの欄（A1100／H14）
//   G 階層: 組み合わせの 2 つ目からの列の値を淡い字に（1 つ目の列を主に読む）
let seq = 0;
const watch = (sel, fn) => { const k = `o4${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const UNDER = watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-nend").forEach((t) => { const g = t.closest(".og-row"), nm = g.querySelector(".og-name"); if (!nm || t.dataset.mv) return;
  const y = +nm.getAttribute("y"); nm.setAttribute("y", y - 6); t.setAttribute("x", +nm.getAttribute("x") + 4); t.setAttribute("y", y + 8); t.style.fontSize = "10px"; t.firstChild.nodeValue = t.firstChild.nodeValue.replace("区間なし ", "なし "); t.dataset.mv = 1; }); }`);
const PILL_CSS = `.og-nend{fill:#7a4310}.o4-pill{fill:#fdf0dc;stroke:#d9a55a;stroke-width:1}`;
const PILL = watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-nend").forEach((t) => { if (t.dataset.mv) return;
  t.setAttribute("x", +t.getAttribute("x") - 8); t.dataset.mv = 1; const b = t.getBBox();
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("class", "o4-pill"); r.setAttribute("x", b.x - 8); r.setAttribute("y", b.y - 2); r.setAttribute("width", b.width + 16); r.setAttribute("height", b.height + 4); r.setAttribute("rx", (b.height + 4) / 2); t.before(r); }); }`);
const SUM_CSS = `.og-nend{display:none}.o4-sum{color:#8a4b0f;font-weight:700}`;
const SUM = watch(".og-wrap", `(w) => { if (w.querySelector(".o4-sum")) return; const xs = [...w.querySelectorAll(".og-nend")].map((t) => t.closest(".og-row").querySelector(".og-name").firstChild.nodeValue + " " + t.firstChild.nodeValue.replace("区間なし ", "") + " 本");
  if (!xs.length) return; const f = w.querySelector(".og-foot"); f.insertAdjacentHTML("afterbegin", '<span class="o4-sum" title="作業終了が空などで、棒にできない作業">区間の分からない作業: ' + xs.join("・") + '</span>'); }`);
const FADE_CSS = `.og-run{display:none}.o4-runl{font-size:11px;font-weight:700;fill:#fff}`;
const FADE = watch(".og-svg", `(svg) => { if (!svg.querySelector("#o4Fade")) svg.querySelector("defs").insertAdjacentHTML("beforeend", '<linearGradient id="o4Fade" x1="0" x2="1"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>');
  svg.querySelectorAll(".og-bar.is-run").forEach((b) => { if (b.dataset.fd) return; b.dataset.fd = 1; const NS = "http://www.w3.org/2000/svg", r = document.createElementNS(NS, "rect");
    ["x", "y", "width", "height", "rx"].forEach((a) => r.setAttribute(a, b.getAttribute(a))); r.setAttribute("fill", "url(#o4Fade)"); r.style.pointerEvents = "none"; b.after(r);
    const t = document.createElementNS(NS, "text"); t.setAttribute("class", "o4-runl"); t.setAttribute("x", +b.getAttribute("x") + +b.getAttribute("width") - 12); t.setAttribute("y", +b.getAttribute("y") + +b.getAttribute("height") / 2 + 4); t.setAttribute("text-anchor", "end"); t.textContent = "作業中"; r.after(t); }); }`);
const ONE = watch(".oa-table", `(t) => { const hk = [...t.querySelectorAll("thead th.oa-k")]; if (hk.length < 2) return; hk[0].textContent = hk.map((x) => x.textContent).join(" × "); hk.slice(1).forEach((x) => x.remove());
  t.querySelectorAll("tbody tr").forEach((tr) => { const ks = [...tr.querySelectorAll(".oa-k")]; if (ks.length < 2) return; ks[0].textContent = ks.map((x) => x.textContent).join("／"); ks.slice(1).forEach((x) => x.remove()); }); }`);
const SUB_CSS = `.oa-table td.oa-k{color:#6b7a84;font-weight:400}.oa-table thead th.oa-k+th.oa-k{font-weight:400}.oa-xl tspan{fill:#6b7a84}`;

export const PROPOSALS = [
  { key: "A", name: "A 作った物（行の中にわけ・右の端に「区間なし n」・作業中は縞・組み合わせは列ごと）", css: "", ops: [] },
  { key: "B", name: "B 「なし n」を設備名の下に小さく", css: "", ops: [UNDER] },
  { key: "C", name: "C 「区間なし n」を琥珀の丸い札に（行の右の端）", css: PILL_CSS, ops: [PILL] },
  { key: "D", name: "D 行の中の印をやめ、下の段に「区間の分からない作業」の 1 行", css: SUM_CSS, ops: [SUM] },
  { key: "E", name: "E 作業中は右へ淡くなる色＋棒の中に「作業中」", css: FADE_CSS, ops: [FADE] },
  { key: "F", name: "F 組み合わせの品種を 1 つの欄（A1100／H14）", css: "", ops: [ONE] },
  { key: "G", name: "G 組み合わせの 2 つ目からの列の値を淡い字に", css: SUB_CSS, ops: [] },
];
