// 2026-10 値の表示形式（版 3.43.0）: 3 回目（合格点 80 点）。2 回目（2026-10-numfmt-2.mjs）の 1 位 I（89.1 点）を土台に、採点の指摘を直す:
//   ・負の数の形が select の中で見えない → 「負の数」の名前の右に見本の札（-1,234・▲1,234・(1,234)・-1,234 赤・▲1,234 赤。赤は「赤」の字も添え、色だけにしない）
//   ・名前が 2 列に分かれる（単位で割る・小数・前に が内側の列）→ 名前は左の 1 列にそろえる（表示形式・単位で割る・小数・負の数・前後・配置・字）
//   ・見本が左のパネルの大きな数と二重に見える → 見本の帯は「表」の形（いまの数・負の数・0 を並べた小さな表。灰の枠）にし、パネルの数字とは形を変える
//   ・見本の「21 →」の字が小さい → 13px・濃い灰
// 案: I3（I を直す）・P（新: 見本の帯は いまの数 だけ・負の数と 0 は小さく横に）・Q（新: 見本の帯を分類の札のすぐ下に）・R（新: よく使う形の札を 1 段で）・S（新: 細かい所を 2 列の格子に）
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-numfmt-3.mjs --states dash-kpi-fmt [--view 1280x720]
let seq = 0;
const watch = (sel, fn) => { const k = `nf3${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const live = (sel, fn) => ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.querySelector("[data-nf3]")) return;
  (${fn})(el); el.insertAdjacentHTML("beforeend", "<i data-nf3 hidden></i>"); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); run(); }`];

// 分類を横の札・名前を左の 1 列（行ごとに 1 つの名前）・負の数の見本の札・言葉の要約・横の名前
const BASE = [
  watch("#dbEditor .de-fmt", `(el) => { const cat = el.querySelector("[data-de-fncat]"); if (!cat) return;
    const segs = document.createElement("span"); segs.className = "de-segs";
    segs.innerHTML = [...cat.options].map((o) => '<label class="de-seg' + (o.selected ? " on" : "") + '">' + o.textContent + "</label>").join("");
    cat.style.display = "none"; cat.after(segs);
    // 名前を左の 1 列に: 行の中の de-l2 の前で行を分け、de-l2 を新しい行の de-l にする
    [...el.querySelectorAll(".de-row")].forEach((r) => {
      let cur = r;
      [...r.children].filter((x) => x.classList.contains("de-l2")).forEach((l2) => {
        if (l2.textContent === "縦") return;
        const nr = document.createElement("div"); nr.className = "de-row"; const lab = document.createElement("span"); lab.className = "de-l"; lab.textContent = l2.textContent; nr.append(lab);
        let n = l2.nextSibling; l2.remove(); while (n && !(n.classList && n.classList.contains("de-l2"))) { const nx = n.nextSibling; nr.append(n); n = nx; }
        cur.after(nr); cur = nr; });
      if (!r.querySelector(".de-l").textContent && r.children.length <= 1) r.remove(); });
    // 桁区切りの札と負の数: 「負の数」の行は見本の札
    const neg = el.querySelector("[data-de-fnneg]");
    if (neg) { neg.style.display = "none"; neg.insertAdjacentHTML("afterend", '<span class="nf3-neg"><span class="on">-1,234</span><span>▲1,234</span><span>(1,234)</span><span class="r">-1,234 <small>赤</small></span><span class="r">▲1,234 <small>赤</small></span></span>'); }
    const sep = el.querySelector("[data-de-nsep]"); if (sep) { const l = sep.closest("label"), row = l.closest(".de-row"); const nr = document.createElement("div"); nr.className = "de-row"; nr.innerHTML = '<span class="de-l">桁区切り</span>'; nr.append(l); row.after(nr); }
    const al = [...el.querySelectorAll(".de-row")].find((r) => (r.querySelector(".de-l") || {}).textContent === "配置"); if (al) al.querySelector(".de-segs").insertAdjacentHTML("beforebegin", '<span class="de-l2">横</span>'); }`),
  watch("#dbEditor .de-fmthead small", `(el) => { el.textContent = "数値・小数 1 桁・後ろに「本」"; }`),
];
const BASE_CSS = `.nf3-neg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:7px;overflow:hidden}.nf3-neg span{padding:4px 9px;font-weight:700;font-size:12.5px;font-variant-numeric:tabular-nums;border-left:1px solid var(--line);white-space:nowrap}
  .nf3-neg span:first-child{border-left:0}.nf3-neg span.on{background:var(--input-soft);color:var(--h-input)}.nf3-neg span.r{color:#c62828}.nf3-neg span.r small{font-size:11px;font-weight:700}
  #dbEditor .de-fmt .de-row{flex-wrap:nowrap}`;
const rows = `(src) => [...src.querySelectorAll(":scope > span")].map((s) => { const sm = s.querySelector("small"); return [sm ? sm.textContent.replace(" →", "") : "", s.innerHTML.replace(/<small>.*?<\\/small>/, "").trim()]; })`;
// 見本の表（いまの数・負の数・0）
const TABLE = `(src, where) => { const r = (${rows})(src), names = ["いまの数", "負の数", "0"];
  return '<table class="nf3-tbl"><tr>' + r.map((x, i) => "<th>" + names[i] + "</th>").join("") + "</tr><tr>" + r.map((x) => "<td>" + x[1] + "</td>").join("") + "</tr></table>"; }`;
const TABLE_CSS = `.nf3-tbl{border-collapse:collapse;font-variant-numeric:tabular-nums}.nf3-tbl th{font-size:12px;font-weight:600;color:#4b5a68;text-align:left;padding:2px 14px 2px 0}.nf3-tbl td{font-size:16px;font-weight:800;color:var(--ink);padding:0 14px 0 0}
  .nf3-box{display:flex;align-items:center;gap:12px;margin:2px 0 10px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2)}.nf3-box > b{font-size:12.5px;color:#4b5a68}`;
const band = (where) => live("#deNumSample", `(el) => { const row = el.closest(".de-row"), fmt = el.closest(".de-fmt");
  let box = fmt.querySelector(".nf3-box"); if (!box) { box = document.createElement("div"); box.className = "nf3-box";
    ${where === "top" ? "fmt.prepend(box);" : "const segs = fmt.querySelector('.de-segs'); segs.closest('.de-row').after(box);"} }
  box.innerHTML = "<b>見本</b>" + (${TABLE})(el); row.style.display = "none"; }`);

export const PROPOSALS = [
  { key: "I3", name: "I3 見本の表を書式の頭に・負の数の見本の札・名前は左の 1 列", css: BASE_CSS + TABLE_CSS, ops: [...BASE, band("top")] },
  {
    key: "P", name: "P 見本は いまの数 を大きく・負の数と 0 は小さく横に",
    css: BASE_CSS + `.nf3-box{display:flex;align-items:baseline;gap:14px;margin:2px 0 10px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2)}.nf3-box b{font-size:12.5px;color:#4b5a68}
      .nf3-main{font-size:20px;font-weight:800}.nf3-sub{font-size:13px;color:#3d4a57;font-weight:700}.nf3-sub small{color:#4b5a68;font-weight:400}`,
    ops: [...BASE, live("#deNumSample", `(el) => { const row = el.closest(".de-row"), fmt = el.closest(".de-fmt"), r = (${rows})(el);
      let box = fmt.querySelector(".nf3-box"); if (!box) { box = document.createElement("div"); box.className = "nf3-box"; fmt.prepend(box); }
      box.innerHTML = "<b>見本</b><span class=\\"nf3-main\\">" + (r[0] || ["", ""])[1] + "</span>" + r.slice(1).map((x, i) => "<span class=\\"nf3-sub\\"><small>" + ["負の数", "0"][i] + "</small> " + x[1] + "</span>").join("");
      row.style.display = "none"; }`)],
  },
  { key: "Q", name: "Q 見本の表を分類の札のすぐ下に", css: BASE_CSS + TABLE_CSS, ops: [...BASE, band("under")] },
  {
    key: "R", name: "R I3＋よく使う形の札（1 段）",
    css: BASE_CSS + TABLE_CSS + `.nf3-quick{display:flex;flex-wrap:nowrap;gap:6px;overflow:hidden}.nf3-quick span{height:26px;display:inline-flex;align-items:center;padding:0 10px;border:1px solid var(--line);border-radius:999px;font-weight:700;font-size:12.5px;white-space:nowrap;font-variant-numeric:tabular-nums}`,
    ops: [...BASE, band("top"), watch("#dbEditor .de-fmt .de-segs", `(el) => { if (el.closest(".de-row").nextElementSibling?.classList.contains("nf3-qrow")) return; const r = document.createElement("div"); r.className = "de-row nf3-qrow";
      r.innerHTML = '<span class="de-l">よく使う形</span><span class="nf3-quick"><span>1,234</span><span>1,234.5</span><span>1,234本</span><span>12.3%</span><span>▲1,234</span></span>'; el.closest(".de-row").after(r); }`)],
  },
  {
    key: "S", name: "S 細かい所を 2 列の格子に（名前と欄の組を 2 つずつ）",
    css: BASE_CSS + TABLE_CSS + `.nf3-grid{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 10px;align-items:center;margin:4px 0}.nf3-grid .de-l{min-width:0!important;width:auto!important}.nf3-grid > .de-row{display:contents}`,
    ops: [...BASE, band("top"), watch("#dbEditor .de-fmt", `(el) => { setTimeout(() => { const rs = [...el.querySelectorAll(":scope > .de-row")].filter((r) => ["単位で割る", "小数", "桁区切り", "前に", "後ろに"].includes((r.querySelector(".de-l") || {}).textContent));
      if (rs.length < 2) return; const g = document.createElement("div"); g.className = "nf3-grid"; rs[0].before(g); rs.forEach((r) => g.append(r)); }, 0); }`)],
  },
];
