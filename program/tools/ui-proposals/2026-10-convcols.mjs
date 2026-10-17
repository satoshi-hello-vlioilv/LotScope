// 2026-10-17 変換表の入力の「当てる列」を、取り込んでいるデータの列から選ぶ（版 3.44.0。利用者の要望 3）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-convcols.mjs --states master-conv-cols   （1280x720 でも）
// 今の物（版 3.43.1）で見えたこと: 入力の右の欄に列の名前を「・」区切りで手で打つ。どのデータにどの名前の列があるかは見えず、
//   打ち間違い・データで名前が違う列（品質データと仕掛で別名）に気づけない（試験のデータでは、管理分類の入力の名前はどのデータにも無い）
// 案の方向（何で解くか）:
//   A 置き場（浮かぶ面・データ元ごとの段）: 札を押すと、データ元ごとに列を並べた面（値の見本・探す・選んだ列の順）。作った物
//   B 見せ方（データ元ごとに 1 つ選ぶ）: データ元ごとの選び（select）を縦に並べる。別名を「データごとに 1 つ」と形で見せる
//   C 置き場（その場で開く）: 浮かせず、入力の行の下に開く（判定表を下へ押す）
//   D 見せ方（名前で 1 本の並び）: 列の名前ごとに 1 行、行の右にその列が有るデータの印（同じ名前の列は 1 回だけ）
//   E 減らし方（打って候補）: 狭い面に、探す欄と候補の 1 本の並びだけ（選んだ列の段・見出しの説明を出さない）
let seq = 0;
const watch = (sel, fn) => { const k = `cc${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
/** 面の中のデータ元ごとの列を、名前ごとに合わせる（D・E） */
const merged = `(el) => { const by = new Map();
  el.querySelectorAll(".cv-cpsrc").forEach((s) => { const c = s.style.getPropertyValue("--c"), n = s.querySelector("h5").childNodes[1].textContent.trim();
    s.querySelectorAll(".cv-cpi").forEach((it) => { const k = it.querySelector("b").textContent; const m = by.get(k) || { it, tags: [] }; m.tags.push('<i class="cv-src" style="--c:' + c + '" title="' + n + '">' + n[0] + '</i>'); by.set(k, m); }); });
  if (!by.size) return; const box = el; box.innerHTML = ""; box.className = "cv-cpsrcs cc-one";
  [...by.values()].forEach(({ it, tags }) => { it.insertAdjacentHTML("beforeend", '<span class="cc-tags">' + tags.join("") + "</span>"); box.append(it); }); }`;
export const PROPOSALS = [
  { key: "A", name: "A 浮かぶ面・データ元ごとの段（作った物）", css: "", ops: [] },
  {
    key: "B", name: "B データ元ごとに 1 つ選ぶ（選びを縦に）",
    css: `.cv-cpsrcs.cc-sel{display:grid;grid-template-columns:auto 1fr auto;gap:8px 12px;align-items:center}.cc-sel h5{margin:0;display:flex;gap:6px;align-items:center;font-size:13px}
      .cc-sel h5 i{width:10px;height:10px;border-radius:50%;background:var(--c)}.cc-sel select{height:30px}.cc-sel small{color:var(--muted);font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cv-colpop{width:min(640px,calc(100vw - 24px))}.cv-cpq{display:none}`,
    ops: [watch(".cv-cpsrcs", `(box) => { const rows = [...box.querySelectorAll(".cv-cpsrc")].map((s) => { const c = s.style.getPropertyValue("--c"), n = s.querySelector("h5").childNodes[1].textContent.trim();
      const items = [...s.querySelectorAll(".cv-cpi")]; const on = items.find((x) => x.querySelector("input").checked);
      return '<h5 style="--c:' + c + '"><i></i>' + n + '</h5><select class="ps-input"><option>（このデータでは当てない）</option>' + items.map((x) => '<option' + (x === on ? " selected" : "") + '>' + x.querySelector("b").textContent + '</option>').join("") + '</select><small>' + (on ? on.querySelector("small").textContent : items[1] ? "値の例: " + items[1].querySelector("small").textContent : "") + '</small>'; });
      if (rows.length) { box.className = "cv-cpsrcs cc-sel"; box.innerHTML = rows.join(""); } }`)],
  },
  {
    key: "C", name: "C 浮かせず、入力の行の下に開く",
    css: `.cv-colpop{position:static!important;width:auto;box-shadow:none;border-color:#c9d6e2;background:#fbfcfd}.cv-cplist{max-height:180px}`,
    ops: [watch(".cv-colpop", `(el) => { const ins = document.querySelector("#masterSettings .cv-ins"); if (ins) ins.after(el); }`)],
  },
  {
    key: "D", name: "D 列の名前ごとに 1 本の並び＋有るデータの印",
    css: `.cc-one{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:none;align-content:start;gap:2px 10px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px}
      .cc-one .cv-cpi{grid-template-columns:auto minmax(0,1fr) auto}.cc-one .cc-tags{grid-row:span 2;display:flex;gap:2px}`,
    ops: [watch(".cv-cpsrcs", merged)],
  },
  {
    key: "E", name: "E 狭い面に、探す欄と候補だけ",
    css: `.cv-colpop{width:380px}.cv-cphead small,.cv-cpchosen,.cv-cpfoot{display:none}.cc-one{display:flex;flex-direction:column;overflow:auto}
      .cc-one .cv-cpi{grid-template-columns:auto minmax(0,1fr) auto}.cc-one .cc-tags{grid-row:span 2;display:flex;gap:2px}`,
    ops: [watch(".cv-cpsrcs", merged)],
  },
];
