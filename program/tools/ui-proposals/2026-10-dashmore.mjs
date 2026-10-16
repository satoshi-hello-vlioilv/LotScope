// 2026-10 ダッシュボードの改良（版 3.39.0。利用者の要望 9 つ）で増えた、パネルを組む所の置き方。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmore.mjs --states dash,dash-filter,dash-panel,dash-panel-fmt
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmore.mjs --states dash,dash-filter,dash-panel,dash-panel-fmt --view 1280x720
// 土台（作った今の物）を撮って見えた問題（scratchpad の base/dash-panel-light-now.png ほか）:
//   ①形の札が 7 段（25 の形）あり、組む所の高さの 1/3 を占める。データ・数え方が下へ押され、最初に見る物が形になる
//   ②目的の見出し（比べる・順位／ばらつきを見る）が 2 段に折れる
//   ③値の札に「表し方」の選びが付き、文の「を出す」が次の段へ折れる
//   ④書式がいちばん下で、送らないと見えない（何が効いているかは見出しの要約だけ）
//   ⑤「何を数えるか（データ・設備・文・期間・条件・並べ方）」と「どう見せるか（形・見せ方・書式）」のまとまりの境が見えない
// 案（方向を散らす: 整える／置き場を分ける〈タブ〉／流れを変える〈順に並べ・形を畳む〉／減らす〈開閉〉／形を細い帯に／目次で跳ぶ）:
//   A 整える（今の並びのまま ②③ だけ直す）
//   T 3 つのタブ（数える・形・見せ方と書式）
//   S 流れの順に 4 段（① データ ② 数え方 ③ 形〈選んだ札 1 枚＋形を変える…〉 ④ 見せ方・書式）。見出しに番号
//   F 開閉する見出し（データ・数え方・形・見せ方・書式。形と書式は畳んで要約を出す）
//   R 形を細い帯（絵だけの札を 1〜2 段。名前は選んだ物だけ）＋ S の流れ
//   N 上に目次（データ・数え方・形・見せ方・書式）を置き、押すとその段へ跳ぶ（並びは今のまま）

let seq = 0;      // 同じ所に当てる仕掛けが 2 つあっても、それぞれ 1 回ずつ動くように印を分ける
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// 共通の整え（②③。どの案にも入れる）
const tidy = `
#dbEditor .de-vrow{grid-template-columns:86px minmax(0,1fr)}
#dbEditor .de-vg{white-space:nowrap}
#dbEditor .pv-chip .de-show{max-width:4.6em}
#dbEditor .de-sent{row-gap:6px}`;

// 段の見出し（.pvh）を、組む所の中の決まった所の前に置く（組む所を開き直しても置き直す）
const heads = (list) => watch("#dbEditor .de-main", `(m) => {
  const put = () => { ${JSON.stringify(list)}.forEach(([sel, html]) => { const t = m.querySelector(sel); if (t && !(t.previousElementSibling && t.previousElementSibling.classList.contains("pvh") && t.previousElementSibling.dataset.for === sel)) t.insertAdjacentHTML("beforebegin", '<div class="pvh" data-for="' + sel + '">' + html + '</div>'); }); };
  put(); new MutationObserver(put).observe(m, { childList: true });
}`);
const headCss = `
#dbEditor .pvh{display:flex;align-items:baseline;gap:8px;margin-top:4px;padding-top:8px;border-top:1px solid var(--line-soft);font-size:13px;font-weight:800;color:var(--ink)}
#dbEditor .pvh:first-child{border-top:0;margin-top:0;padding-top:0}
#dbEditor .pvh small{font-weight:600;color:var(--muted);font-size:12px}
#dbEditor .pvh i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--h-input);color:#fff;font-size:12px}`;

// 流れの順（データ → 数え方 → 形 → 見せ方 → 書式）に並べ替える
const reorder = watch("#dbEditor .de-main", `(m) => {
  const order = ["#deData", "#deSent", "#deCond", "#deSort", "#deVis", "#deBoard", "#deLook", "#deFmt", "#deGacts", "#deMsg"];
  order.forEach((s) => { const el = m.querySelector(s); if (el) m.append(el); });
}`);

// 形を先に置いたまま、データ → 数え方 → 見せ方 → 書式 に並べ替える（開閉の見出し F 用）
const reorderFormFirst = watch("#dbEditor .de-main", `(m) => {
  ["#deVis", "#deBoard", "#deData", "#deSent", "#deCond", "#deSort", "#deLook", "#deFmt", "#deGacts", "#deMsg"].forEach((s) => { const el = m.querySelector(s); if (el) m.append(el); });
}`);

// 形を畳む: 選んだ形の札 1 枚＋「形を変える…」。押すと全部の札を開く（合わせた表の表全体と同じ型）
const foldForm = {
  css: `
#dbEditor .pvf{display:flex;align-items:center;gap:8px}
#dbEditor .pvf .pv-cbtn{min-width:170px;justify-content:flex-start;cursor:default}
#dbEditor .pvf small{color:var(--muted);font-size:12px;flex:1;min-width:0}
#dbEditor .pvf .pv-btn{white-space:nowrap;flex:0 0 auto}
#dbEditor:not(.pv-formopen) #deVis .de-vis{display:none}`,
  op: watch("#dbEditor #deVis", `(v) => {
    const paint = () => {
      if (document.querySelector("#dbEditor.is-board")) return;
      let bar = v.querySelector(".pvf");
      const on = v.querySelector(".de-vis .pv-cbtn.on");
      if (!bar) { v.insertAdjacentHTML("afterbegin", '<div class="pvf"><span class="pv-cbtn on"></span><button type="button" class="pv-btn">形を変える…</button><small></small></div>'); bar = v.querySelector(".pvf");
        bar.querySelector("button").addEventListener("click", () => { const ed = document.querySelector("#dbEditor"); ed.classList.toggle("pv-formopen"); bar.querySelector("button").textContent = ed.classList.contains("pv-formopen") ? "閉じる" : "形を変える…"; }); }
      if (on && bar.dataset.k !== on.dataset.deVis) { bar.dataset.k = on.dataset.deVis; bar.querySelector(".pv-cbtn").innerHTML = on.innerHTML; bar.querySelector("small").textContent = on.title.split("。")[0]; }
    };
    paint(); new MutationObserver(paint).observe(v, { childList: true, subtree: true });
  }`),
};

// タブ（数える・形・見せ方と書式）
const tabs = {
  css: `
#dbEditor .pvt{display:flex;gap:0;border-bottom:1px solid var(--line);margin-bottom:2px;position:sticky;top:0;background:var(--surface);z-index:2}
#dbEditor .pvt button{flex:1;height:34px;border:0;border-bottom:3px solid transparent;background:none;font:inherit;font-size:13px;font-weight:800;color:var(--h-meta);cursor:pointer}
#dbEditor .pvt button.on{color:var(--h-input);border-bottom-color:var(--h-input)}
#dbEditor .pvt button small{display:block;font-size:11px;font-weight:600;color:var(--muted)}
#dbEditor[data-pvt="count"] #deVis,#dbEditor[data-pvt="count"] #deLook,#dbEditor[data-pvt="count"] #deFmt{display:none}
#dbEditor[data-pvt="form"] #deData,#dbEditor[data-pvt="form"] #deSent,#dbEditor[data-pvt="form"] #deCond,#dbEditor[data-pvt="form"] #deSort,#dbEditor[data-pvt="form"] #deLook,#dbEditor[data-pvt="form"] #deFmt{display:none}
#dbEditor[data-pvt="look"] #deData,#dbEditor[data-pvt="look"] #deSent,#dbEditor[data-pvt="look"] #deCond,#dbEditor[data-pvt="look"] #deSort,#dbEditor[data-pvt="look"] #deVis{display:none}`,
  op: watch("#dbEditor .de-main", `(m) => {
    const ed = document.querySelector("#dbEditor");
    const set = (k) => { ed.dataset.pvt = k; m.querySelectorAll(".pvt button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); };
    const put = () => { if (m.querySelector(".pvt")) return; m.insertAdjacentHTML("afterbegin", '<div class="pvt" role="tablist"><button type="button" data-k="count">数える<small>データ・設備・値・条件</small></button><button type="button" data-k="form">形<small>グラフ・数字・表</small></button><button type="button" data-k="look">見せ方・書式<small>枠・数値・軸・色</small></button></div>');
      m.querySelector(".pvt").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) set(b.dataset.k); }); set(ed.dataset.pvt || "count"); };
    put(); new MutationObserver(put).observe(m, { childList: true });
    document.addEventListener("tpa-show-fmt", () => set("look"));
  }`),
};

// 開閉する見出し（データ・数え方・形・見せ方・書式）。形と書式は畳んで要約
const fold = {
  css: headCss + `
#dbEditor .pvh{cursor:pointer;user-select:none}
#dbEditor .pvh::after{content:"▾";margin-left:auto;color:var(--muted);font-size:11px}
#dbEditor .pvh.is-shut::after{content:"▸"}
#dbEditor .pv-shut{display:none!important}
#dbEditor #deFmt .de-fmthead{display:none}`,
  op: watch("#dbEditor .de-main", `(m) => {
    const groups = { "#deData": ["#deData"], "#deSent": ["#deSent", "#deCond", "#deSort"], "#deVis": ["#deVis"], "#deLook": ["#deLook"], "#deFmt": ["#deFmt"] };
    const shut = new Set(["#deVis", "#deFmt"]);
    const apply = () => m.querySelectorAll(".pvh").forEach((h) => { const k = h.dataset.for, s = shut.has(k); h.classList.toggle("is-shut", s); (groups[k] || []).forEach((sel) => m.querySelector(sel)?.classList.toggle("pv-shut", s));
      const sum = h.querySelector("small"), t = !s ? "" : k === "#deVis" ? (m.querySelector(".de-vis .pv-cbtn.on span")?.textContent || "") : k === "#deFmt" ? (m.querySelector(".de-fmthead small")?.textContent || "") : null;
      if (sum && t != null && sum.textContent !== t) sum.textContent = t; });
    m.addEventListener("click", (e) => { const h = e.target.closest(".pvh"); if (!h) return; const k = h.dataset.for; if (shut.has(k)) shut.delete(k); else shut.add(k); apply(); });
    document.addEventListener("tpa-show-fmt", () => { shut.delete("#deFmt"); apply(); });
    new MutationObserver(apply).observe(m, { childList: true, subtree: true }); apply();
  }`),
  heads: heads([["#deData", "データ<small></small>"], ["#deSent", "数え方<small></small>"], ["#deVis", "形<small></small>"], ["#deLook", "見せ方<small></small>"], ["#deFmt", "書式<small></small>"]]),
};

// 形を細い帯（絵だけの札。目的の見出しは帯の上の小さな字。名前は選んだ物と title）
const strip = `
#dbEditor .de-vis{flex-direction:row;flex-wrap:wrap;gap:4px 10px}
#dbEditor .de-vrow{display:flex;flex-direction:column;gap:2px}
#dbEditor .de-vg{padding:0;font-size:11px;color:var(--muted)}
#dbEditor .de-vi{gap:3px}
#dbEditor .de-vi .pv-cbtn{width:34px;height:32px;padding:0;justify-content:center}
#dbEditor .de-vi .pv-cbtn span{display:none}
#dbEditor .de-vi .pv-cbtn.on{width:auto;padding:0 9px}
#dbEditor .de-vi .pv-cbtn.on span{display:inline}`;

// 目次（上に固定。押すとその段へ）
const toc = {
  css: `
#dbEditor .pvn{display:flex;gap:4px;position:sticky;top:0;z-index:2;background:var(--surface);padding-bottom:6px;border-bottom:1px solid var(--line-soft)}
#dbEditor .pvn button{height:28px;padding:0 10px;border:1px solid var(--edit-line);border-radius:999px;background:var(--edit-field);font:inherit;font-size:12.5px;font-weight:700;color:var(--h-meta);cursor:pointer}
#dbEditor .pvn button:hover{border-color:var(--h-input);color:var(--h-input)}`,
  op: watch("#dbEditor .de-main", `(m) => {
    const put = () => { if (m.querySelector(".pvn")) return; m.insertAdjacentHTML("afterbegin", '<nav class="pvn" aria-label="組む所の目次"><button data-to="#deVis">形</button><button data-to="#deData">データ</button><button data-to="#deSent">数え方</button><button data-to="#deLook">見せ方</button><button data-to="#deFmt">書式</button></nav>');
      m.querySelector(".pvn").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) m.querySelector(b.dataset.to)?.scrollIntoView({ block: "start", behavior: "smooth" }); }); };
    put(); new MutationObserver(put).observe(m, { childList: true });
  }`),
};

const stepHeads = heads([["#deData", "<i>1</i>データ<small>何を数えるか</small>"], ["#deSent", "<i>2</i>数え方<small>行・列・値・期間・条件</small>"], ["#deVis", "<i>3</i>形<small>どう描くか</small>"], ["#deLook", "<i>4</i>見せ方・書式<small>枠・数値・軸・色</small>"]]);

export const PROPOSALS = [
  { key: "A", name: "整える（並びは今のまま。目的の見出しと文の折れを直す）", css: tidy, ops: [] },
  { key: "T", name: "3 つのタブ（数える・形・見せ方と書式）", css: tidy + tabs.css, ops: [tabs.op] },
  { key: "S", name: "流れの順に 4 段（① データ ② 数え方 ③ 形〈畳む〉 ④ 見せ方・書式）", css: tidy + headCss + foldForm.css, ops: [reorder, stepHeads, foldForm.op] },
  { key: "F", name: "開閉する見出し（形と書式は畳んで要約）", css: tidy + fold.css, ops: [reorderFormFirst, fold.heads, fold.op] },
  { key: "R", name: "形を細い帯（絵の札）＋流れの順に 4 段", css: tidy + headCss + strip, ops: [reorder, stepHeads] },
  { key: "N", name: "上に目次（押すとその段へ。並びは今のまま）", css: tidy + toc.css, ops: [toc.op] },
];
