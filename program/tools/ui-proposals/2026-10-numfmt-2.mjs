// 2026-10 値の表示形式（版 3.43.0）: 2 回目（合格点 90 点）。1 回目（2026-10-numfmt.mjs・採点 2026-10-numfmt.json）の 1 位 F（83.2 点）を土台に、
// どの案にも足りなかった所を直す:
//   ・見本が小さな灰の 1 行で、最初に見る物になっていない → 見本を大きく・単位まで入れて出す（1 回目の B は見本を移すときに「本」が落ちた。写し方を直す）
//   ・配置の行は「縦」にだけ名前があり、横に名前が無い → 「横」「縦」の両方に名前
//   ・畳んだ見出しの「表示形式 #,##0.0」は書式の符号で読めない → 言葉の要約（数値・小数 1 桁・後ろに「本」）
//   ・分類は横の札（F。開かずに全部見える・1 回で選べる）
// 案: F2（F を直す）・G（新: 見本を分類の右の箱に）・H（新: 負の数を見本の札で選ぶ）・I（新: 見本を書式の頭の帯に）・J（新: 左に選び・右に見本の札〈パネルと同じ大きな数〉）
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-numfmt-2.mjs --states dash-kpi-fmt [--view 1280x720]
let seq = 0;
const watch = (sel, fn) => { const k = `nf2${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const rowOf = (label) => `[...el.querySelectorAll(".de-row")].find((r) => (r.querySelector(".de-l") || {}).textContent === ${JSON.stringify(label)})`;
// F（分類を横の札）・横の名前・言葉の要約。どの案も先に当てる
const BASE = [
  watch("#dbEditor .de-fmt", `(el) => { const cat = el.querySelector("[data-de-fncat]"); if (!cat) return;
    const segs = document.createElement("span"); segs.className = "de-segs";
    segs.innerHTML = [...cat.options].map((o) => '<label class="de-seg' + (o.selected ? " on" : "") + '">' + o.textContent + "</label>").join("");
    const r = cat.closest(".de-row"); cat.style.display = "none"; cat.after(segs);
    const div = [...r.children].findIndex((x) => x.textContent === "単位で割る");
    if (div >= 0) { const nr = document.createElement("div"); nr.className = "de-row"; nr.innerHTML = '<span class="de-l"></span>'; [...r.children].slice(div).forEach((x) => nr.append(x)); r.after(nr); }
    const al = ${rowOf("配置")}; if (al) al.querySelector(".de-segs").insertAdjacentHTML("beforebegin", '<span class="de-l2">横</span>'); }`),
  watch("#dbEditor .de-fmthead small", `(el) => { el.textContent = "数値・小数 1 桁・後ろに「本」"; }`),
];
// 見本の字（いまの数 21 → 21.0本 ほか）を大きく写す
const SAMPLE = `(src) => [...src.querySelectorAll(":scope > span")].map((s, i) => '<span class="' + (i ? "nf2-sub" : "nf2-main") + '"><small>' + s.querySelector("small").textContent + "</small> " + s.innerHTML.replace(/<small>.*?<\\/small>/, "") + "</span>").join("")`;
const BIG = `.nf2-main{font-size:24px;font-weight:800;color:var(--ink)}.nf2-main small,.nf2-sub small{font-size:12px;font-weight:400;color:var(--muted)}.nf2-sub{font-size:14px;font-weight:700;color:#3d4a57}`;

export const PROPOSALS = [
  {
    key: "F2", name: "F2 分類の札＋見本を太く（単位まで）・横の名前・言葉の要約",
    css: `${BIG} #deNumSample{gap:4px 18px!important;align-items:baseline}`,
    ops: [...BASE, watch("#deNumSample", `(el) => { el.innerHTML = (${SAMPLE})(el); }`)],
  },
  {
    key: "G", name: "G 見本を分類の右の箱に（選ぶ所と結果が隣り合う）",
    css: `${BIG} .nfG-box{display:flex;flex-direction:column;gap:2px;margin-left:auto;padding:8px 14px;border:1px solid var(--line);border-radius:10px;background:var(--input-soft);min-width:170px}`,
    ops: [...BASE, watch("#deNumSample", `(el) => { const row = el.closest(".de-row"), first = el.closest(".de-fmt").querySelector(".de-row");
      const box = document.createElement("div"); box.className = "nfG-box"; box.innerHTML = '<small style="color:var(--muted)">見本</small>' + (${SAMPLE})(el);
      first.append(box); first.style.alignItems = "flex-start"; row.style.display = "none"; }`)],
  },
  {
    key: "H", name: "H 負の数を見本の札で選ぶ（-1,234・▲1,234・(1,234)・赤）",
    css: `${BIG} .nfH{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}.nfH span{padding:4px 10px;font-weight:700;font-variant-numeric:tabular-nums;border-left:1px solid var(--line)}.nfH span:first-child{border-left:0}.nfH span.on{background:var(--input-soft);color:var(--h-input)}`,
    ops: [...BASE, watch("#deNumSample", `(el) => { el.innerHTML = (${SAMPLE})(el); }`),
      watch("#dbEditor [data-de-fnneg]", `(el) => { el.style.display = "none"; el.insertAdjacentHTML("afterend", '<span class="nfH"><span class="on">-1,234</span><span>▲1,234</span><span>(1,234)</span><span style="color:#c62828">-1,234</span><span style="color:#c62828">▲1,234</span></span>'); }`)],
  },
  {
    key: "I", name: "I 見本を書式の頭の帯に（最初に見る物）",
    css: `${BIG} .nfI{display:flex;gap:6px 18px;align-items:baseline;flex-wrap:wrap;margin:2px 0 10px;padding:10px 14px;border-radius:10px;background:var(--input-soft)}.nfI b{font-size:12px;color:var(--h-input)}`,
    ops: [...BASE, watch("#deNumSample", `(el) => { const row = el.closest(".de-row"), fmt = el.closest(".de-fmt");
      const band = document.createElement("div"); band.className = "nfI"; band.innerHTML = "<b>見本</b>" + (${SAMPLE})(el); fmt.prepend(band); row.style.display = "none"; }`)],
  },
  {
    key: "J", name: "J 左に選び・右に見本の札（パネルと同じ大きな数）",
    css: `.nfJ{display:grid;grid-template-columns:1fr 190px;gap:14px;align-items:start}.nfJ-card{position:sticky;top:8px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
      .nfJ-card .t{font-size:12px;color:var(--muted)}.nfJ-card .n{font-size:34px;font-weight:800;line-height:1.1;color:var(--ink)}.nfJ-card .s{display:flex;flex-direction:column;gap:2px;margin-top:6px;font-weight:700;font-size:13px}`,
    ops: [...BASE, watch("#deNumSample", `(el) => { const row = el.closest(".de-row"), fmt = el.closest(".de-fmt"), spans = [...el.querySelectorAll(":scope > span")];
      const main = spans[0] ? spans[0].innerHTML.replace(/<small>.*?<\\/small>/, "") : "";
      const g = document.createElement("div"); g.className = "nfJ"; const left = document.createElement("div");
      [...fmt.children].forEach((c) => left.append(c)); g.append(left);
      g.insertAdjacentHTML("beforeend", '<div class="nfJ-card"><div class="t">見本（いまの数）</div><div class="n">' + main + '</div><div class="s">' + spans.slice(1).map((s) => s.innerHTML.replace(/<small>(.*?)<\\/small>/, "<small style=\\"color:var(--muted);font-weight:400\\">$1</small>")).map((h) => "<span>" + h + "</span>").join("") + "</div></div>");
      fmt.append(g); row.style.display = "none"; }`)],
  },
];
