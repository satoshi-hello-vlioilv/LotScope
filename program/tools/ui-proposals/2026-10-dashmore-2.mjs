// 2026-10 ダッシュボードの改良（版 3.39.0）の、パネルを組む所の置き方。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmore-2.mjs --states dash,dash-filter,dash-panel,dash-panel-fmt
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmore-2.mjs --states dash,dash-filter,dash-panel,dash-panel-fmt --view 1280x720
// 1 回目（2026-10-dashmore.mjs・採点は 2026-10-dashmore.json）の 1 位は S（流れの順に 4 段・形を畳む）73.4 点（合格点 95 に届かず）。採点者の指摘:
//   ①全案: 値の札の「表し方」が「表しﾌ」と切れる（整えの max-width が原因）→ 幅を限らない
//   ②全案: 行の札が選び付き（作業日 日▾）になると「を出す」が 2 段目に落ちる → 文を、意図した 2 行
//     （［行］ごとに、［列］別の ／ ［値］を出す）に決めて並べる（思いがけない折れにしない）
//   ③S: 形を変えるのに「形を変える…」の 1 手が増える → 選んだ形の横に、いまの組み方に向く形を名前つきで 4 つ（組む所が出す .de-vfit）。
//     全部の形は「すべての形（24）…」
//   ④S: 選んだ形の札が大きな濃い帯で、押せる札か表示か迷う → ほかの札と同じ形の札（選んだ色）にそろえる
//   ⑤T: 隠れたタブに今の形・書式が見えない／タブの説明が固定の字で薄く小さい → タブに今の設定の要約（12px）
// 持ち越し（直した）: S2（S＋①〜④）・T2（T＋①②⑤＋向く形）
// 新しい案（4 つ）:
//   H  S2＋段の見出しの右に、今の設定の要約（データ「仕掛・すべての設備」・形「横棒」・見せ方「標準・書式は既定」）
//   B  S2＋上に今の組みの要約の帯（1 行・押すとその段へ）
//   W  S2＋書式を 2 列（左に数値・横軸・数の形・縦軸・凡例、右に基準線・色の組・系列の色）にして、送らずに見える所を増やす
//   P  S2＋形の札を見本の絵つき（絵 24px・名前の 2 段の札）で、向く形を大きく

let seq = 0;      // 同じ所に当てる仕掛けが 2 つあっても、それぞれ 1 回ずつ動くように印を分ける
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// ①②（どの案にも）: 表し方は読める幅・文は意図した 2 行（値の前で改める。行の段が無い数字の文は 1 行のまま）
const sentence = `
#dbEditor .de-sent:has(.pv-slot[data-role="rows"])::after{content:"";flex-basis:100%;height:0;order:5}
#dbEditor .de-sent:has(.pv-slot[data-role="rows"]) .pv-slot[data-role="vals"]{order:6}
#dbEditor .de-sent:has(.pv-slot[data-role="rows"]) .pv-w:last-child{order:7}
#dbEditor .de-sent{row-gap:6px}
#dbEditor .de-vrow{grid-template-columns:86px minmax(0,1fr)}
#dbEditor .de-vg{white-space:nowrap}`;
// ③④: 向く形の行（組む所が出す .de-vfit）を出し、全部の札は「すべての形…」で開く。選んだ札はほかと同じ形
const fitRow = `
#dbEditor:not(.is-board) .de-vfit{display:flex}
#dbEditor:not(.is-board) .de-vis[data-open="false"]{display:none}
#dbEditor .de-vfit .pv-cbtn.on{min-width:0}`;

// 段の見出し（.pvh）
const heads = (list) => watch("#dbEditor .de-main", `(m) => {
  const put = () => { ${JSON.stringify(list)}.forEach(([sel, html]) => { const t = m.querySelector(sel); if (t && !(t.previousElementSibling && t.previousElementSibling.classList.contains("pvh") && t.previousElementSibling.dataset.for === sel)) t.insertAdjacentHTML("beforebegin", '<div class="pvh" data-for="' + sel + '">' + html + '</div>'); }); };
  put(); new MutationObserver(put).observe(m, { childList: true });
}`);
const headCss = `
#dbEditor .pvh{display:flex;align-items:baseline;gap:8px;margin-top:4px;padding-top:8px;border-top:1px solid var(--line-soft);font-size:13px;font-weight:800;color:var(--ink)}
#dbEditor .pvh:first-child{border-top:0;margin-top:0;padding-top:0}
#dbEditor .pvh small{font-weight:600;color:var(--muted);font-size:12px}
#dbEditor .pvh i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--h-input);color:#fff;font-size:12px;flex:0 0 auto}`;
const reorder = watch("#dbEditor .de-main", `(m) => {
  ["#deData", "#deSent", "#deCond", "#deSort", "#deVis", "#deBoard", "#deLook", "#deFmt", "#deGacts", "#deMsg"].forEach((s) => { const el = m.querySelector(s); if (el) m.append(el); });
}`);
const stepHeads = heads([["#deData", "<i>1</i>データ<small>何を数えるか</small>"], ["#deSent", "<i>2</i>数え方<small>行・列・値・期間・条件</small>"], ["#deVis", "<i>3</i>形<small>どう描くか</small>"], ["#deLook", "<i>4</i>見せ方・書式<small>枠・数値・軸・色</small>"]]);
const S2css = sentence + fitRow + headCss;
const S2ops = [reorder, stepHeads];

// 今の設定の要約（データ・数え方・形・見せ方と書式）を、組む所の画面から読む（H の見出し・B の帯・T2 のタブで使う）
const summaryFn = `(m) => {
  const t = (sel) => (m.querySelector(sel) || {}).textContent || "";
  const src = m.querySelector("[data-de-src]"), opt = src && src.selectedOptions[0];
  const data = [opt ? opt.textContent : "", t(".de-eqbtn").replace(/[▾▴]/g, "").trim()].filter(Boolean).join("・");
  const sent = (m.querySelector("#deSent .de-sent") || {}).innerText || "";
  const count = sent.replace(/[×▾]/g, "").replace(/\\s+/g, " ").replace(/表し方/g, "").trim();
  const form = t(".de-vfit .pv-cbtn.on span") || t(".de-vis .pv-cbtn.on span");
  const frame = t("#deLook .de-frame.on").trim(), fmt = t(".de-fmthead small");
  return { data, count, form, look: [frame, fmt === "既定のまま" ? "書式は既定" : fmt].filter(Boolean).join("・") };
}`;

// H: 段の見出しに要約
const H = {
  css: `#dbEditor .pvh .pvs{margin-left:auto;font-size:12px;font-weight:700;color:var(--h-input);max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  op: watch("#dbEditor .de-main", `(m) => {
    const sum = ${summaryFn};
    const paint = () => { const s = sum(m), map = { "#deData": s.data, "#deSent": "", "#deVis": s.form, "#deLook": s.look };
      m.querySelectorAll(".pvh").forEach((h) => { let el = h.querySelector(".pvs"); const v = map[h.dataset.for] || ""; if (!el) { h.insertAdjacentHTML("beforeend", '<span class="pvs"></span>'); el = h.querySelector(".pvs"); } if (el.textContent !== v) el.textContent = v; }); };
    new MutationObserver(paint).observe(m, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); paint();
  }`),
};
// B: 上に要約の帯（押すとその段へ）
const B = {
  css: `
#dbEditor .pvb{position:sticky;top:0;z-index:2;display:flex;gap:6px;flex-wrap:nowrap;overflow:hidden;background:var(--surface);padding:0 0 6px;border-bottom:1px solid var(--line-soft)}
#dbEditor .pvb button{display:flex;flex-direction:column;align-items:flex-start;min-width:0;flex:1 1 0;padding:4px 8px;border:1px solid var(--edit-line);border-radius:8px;background:var(--edit-field);font:inherit;cursor:pointer;text-align:left}
#dbEditor .pvb button:hover{border-color:var(--h-input)}
#dbEditor .pvb b{font-size:11.5px;color:var(--h-meta)}
#dbEditor .pvb span{font-size:12.5px;font-weight:700;color:var(--ink);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  op: watch("#dbEditor .de-main", `(m) => {
    const sum = ${summaryFn};
    const put = () => { if (m.querySelector(".pvb")) return; m.insertAdjacentHTML("afterbegin", '<nav class="pvb" aria-label="いまの組み"><button data-to="#deData"><b>1 データ</b><span></span></button><button data-to="#deSent"><b>2 数え方</b><span></span></button><button data-to="#deVis"><b>3 形</b><span></span></button><button data-to="#deLook"><b>4 見せ方・書式</b><span></span></button></nav>');
      m.querySelector(".pvb").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { const el = m.querySelector(b.dataset.to); if (el) m.scrollTop = el.offsetTop - m.offsetTop - 70; } }); };
    const paint = () => { put(); const s = sum(m), v = [s.data, s.count, s.form, s.look]; m.querySelectorAll(".pvb span").forEach((x, i) => { if (x.textContent !== v[i]) x.textContent = v[i]; }); };
    new MutationObserver(paint).observe(m, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); paint();
  }`),
};
// W: 書式を 2 列（基準線・色の組・系列の色を右へ）
const W = `
#dbEditor .de-fmt{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 14px;align-items:start}
#dbEditor .de-fmt > .de-row{grid-column:1}
#dbEditor .de-fmt > .de-row.de-top{grid-column:2;grid-row:auto}
#dbEditor .de-fmt > .de-row.de-top:nth-last-child(3){grid-row:1 / span 2}
#dbEditor .de-fmt > .de-row.de-top:nth-last-child(2){grid-row:3 / span 2}
#dbEditor .de-fmt > .de-row.de-top:nth-last-child(1){grid-row:5 / span 2}
#dbEditor .de-fmt .de-row{flex-wrap:wrap}
#dbEditor .de-fmt .de-scols{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
#dbEditor .de-fmt .de-l2{margin-left:0}`;
// P: 形の札を見本の絵つき（大きめ）で、向く形を 6 つまで（組む所の行の札を大きく見せる。7 つ目以降は CSS で隠す）
const P = `
#dbEditor .de-vfit{gap:6px}
#dbEditor .de-vfit .pv-cbtn{flex-direction:column;height:auto;min-width:76px;padding:6px 8px;gap:3px;justify-content:center}
#dbEditor .de-vfit .pv-cbtn .pv-ico{width:24px;height:24px}
#dbEditor .de-vfit .pv-cbtn span{font-size:12px}
#dbEditor .de-vfit .de-vfn{writing-mode:horizontal-tb}`;

// T2: タブ（数える・形・見せ方と書式）に今の設定の要約
const T2 = {
  css: `
#dbEditor .pvt{display:flex;gap:0;border-bottom:1px solid var(--line);margin-bottom:2px;position:sticky;top:0;background:var(--surface);z-index:2}
#dbEditor .pvt button{flex:1;min-width:0;height:44px;border:0;border-bottom:3px solid transparent;background:none;font:inherit;font-size:13px;font-weight:800;color:var(--h-meta);cursor:pointer;padding:0 6px}
#dbEditor .pvt button.on{color:var(--h-input);border-bottom-color:var(--h-input)}
#dbEditor .pvt button small{display:block;font-size:12px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#dbEditor[data-pvt="count"] #deVis,#dbEditor[data-pvt="count"] #deLook,#dbEditor[data-pvt="count"] #deFmt{display:none}
#dbEditor[data-pvt="form"] #deData,#dbEditor[data-pvt="form"] #deSent,#dbEditor[data-pvt="form"] #deCond,#dbEditor[data-pvt="form"] #deSort,#dbEditor[data-pvt="form"] #deLook,#dbEditor[data-pvt="form"] #deFmt{display:none}
#dbEditor[data-pvt="look"] #deData,#dbEditor[data-pvt="look"] #deSent,#dbEditor[data-pvt="look"] #deCond,#dbEditor[data-pvt="look"] #deSort,#dbEditor[data-pvt="look"] #deVis{display:none}
#dbEditor[data-pvt="form"] .de-vis{display:flex!important}`,
  op: watch("#dbEditor .de-main", `(m) => {
    const ed = document.querySelector("#dbEditor"), sum = ${summaryFn};
    const set = (k) => { ed.dataset.pvt = k; m.querySelectorAll(".pvt button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); };
    const put = () => { if (m.querySelector(".pvt")) return; m.insertAdjacentHTML("afterbegin", '<div class="pvt" role="tablist"><button type="button" data-k="count">数える<small></small></button><button type="button" data-k="form">形<small></small></button><button type="button" data-k="look">見せ方・書式<small></small></button></div>');
      m.querySelector(".pvt").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) set(b.dataset.k); }); set(ed.dataset.pvt || "count"); };
    const paint = () => { put(); const s = sum(m), v = [s.data, s.form, s.look]; m.querySelectorAll(".pvt small").forEach((x, i) => { if (x.textContent !== v[i]) x.textContent = v[i]; }); };
    new MutationObserver(paint).observe(m, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); paint();
    document.addEventListener("tpa-show-fmt", () => set("look"));
  }`),
};

export const PROPOSALS = [
  { key: "S2", name: "S を直した物（流れの順に 4 段・向く形の札・文は 2 行・表し方は読める幅）", css: S2css, ops: S2ops },
  { key: "T2", name: "T を直した物（3 つのタブに今の設定の要約・向く形の札・文は 2 行）", css: sentence + fitRow + T2.css, ops: [T2.op] },
  { key: "H", name: "S2＋段の見出しの右に今の設定の要約", css: S2css + H.css, ops: [...S2ops, H.op] },
  { key: "B", name: "S2＋上に今の組みの要約の帯（押すとその段へ）", css: S2css + B.css, ops: [...S2ops, B.op] },
  { key: "W", name: "S2＋書式を 2 列（右に基準線・色の組・系列の色）", css: S2css + W, ops: S2ops },
  { key: "P", name: "S2＋形の札を見本の絵つき（大きめ）", css: S2css + P, ops: S2ops },
];
