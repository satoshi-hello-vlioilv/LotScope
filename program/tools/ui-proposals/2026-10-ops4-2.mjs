// 2026-10-ops4 の 2 回目（1 回目は 7 案とも 80 点に届かず。1 位 C 58.9 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops4-2.mjs --states dash-ops,dash-ops-edit --from dash   （1536x864・1280x720 でも）
// 1 回目の採点で、どの案にも共通した減点（−21）は作った物の不具合として直した（A に入っている）:
//   パレート図の棒の下の名前が「A11…」で切れた → 棒の数を、名前が入る幅で決める／ガントの棒の字の上に次の棒が重なった → 次の棒の始まりまでに
//   入るときだけ字を書く／1280 の組む所で ABC の表・設備の札・下の段が切れた → 描いた後に測り、表は要らない順に列を隠し、設備の札は選ぶ欄に替え、
//   下の段は基準 → 換算本数の計 → ABC の数の順に隠す／組む所の見出し「換算の基準」「ABC の線」が 2 段 → 「換算基準」「ABC線」（説明に元の言い方）
// 1 回目で効いた所: C の琥珀の丸い札（状態の印と迷わない）。低かった所: 札が名前から遠い・「いま」の線より右に乗る・何が無いのかが字から分からない
// 案の方向（新しい案は K・M・N・P）:
//   A 直した作った物（行の右の端に字「区間なし n」）
//   C 持ち越し（1 回目 1 位）: 「区間なし n」を琥珀の丸い札に
//   K 置き場（新）: C の札＋名前の前に琥珀の点（名前を読んだ所で気付く）
//   M 減らし方（新）: C の札＋ガントの下の段の先頭に「区間の分からない作業 n 本」の 1 行（全体で何本か）
//   N 言葉（新）: 札の字をわけそのものに（「作業終了が空 1」。何が無いのかを読んで分かる）
//   P 置き場（新）: C の札＋見出しの全体の稼働率の札の横に「区間の分からない作業 n 本」の札（パネルを開いた所で気付く）
let seq = 0;
const watch = (sel, fn) => { const k = `o5${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const PILL_CSS = `.og-nend{fill:#7a4310}.o5-pill{fill:#fdf0dc;stroke:#d9a55a;stroke-width:1}`;
/** 札: 行の右の端の字に丸い地を敷く。why … 字をわけにする（説明の（）の中から） */
const pill = (why) => watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-nend").forEach((t) => { if (t.dataset.mv) return; t.dataset.mv = 1;
  ${why ? `const m = /（([^（）]+?) (\\d+) 本[・）]/.exec(t.querySelector("title").textContent); if (m) t.firstChild.nodeValue = m[1] + " " + m[2];` : ""}
  t.setAttribute("x", +t.getAttribute("x") - 8); const b = t.getBBox();
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("class", "o5-pill"); r.setAttribute("x", b.x - 8); r.setAttribute("y", b.y - 2); r.setAttribute("width", b.width + 16); r.setAttribute("height", b.height + 4); r.setAttribute("rx", (b.height + 4) / 2); t.before(r); }); }`);
const DOT = watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-nend").forEach((t) => { const nm = t.closest(".og-row").querySelector(".og-name"); if (!nm || nm.dataset.dot) return; nm.dataset.dot = 1;
  const b = nm.getBBox(), c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("cx", b.x - 7); c.setAttribute("cy", b.y + b.height / 2); c.setAttribute("r", 3.6); c.setAttribute("fill", "#b8661a"); nm.before(c); }); }`);
const SUM_CSS = `.o5-sum{color:#8a4b0f;font-weight:700}`;
const SUM = watch(".og-wrap", `(w) => { if (w.querySelector(".o5-sum")) return; const n = [...w.querySelectorAll(".og-nend")].reduce((a, t) => a + (+(/(\\d+)/.exec(t.querySelector("title").textContent.split("のうち")[1] || "") || [0, 0])[1]), 0);
  if (!n) return; w.querySelector(".og-foot").insertAdjacentHTML("afterbegin", '<span class="o5-sum" title="作業終了が空などで、棒にできない作業">区間の分からない作業 ' + n + ' 本</span>'); }`);
const HEAD_CSS = `.o5-hb{display:inline-flex;align-items:center;height:22px;padding:0 10px;margin-left:8px;border-radius:999px;background:#fdf0dc;border:1px solid #d9a55a;color:#7a4310;font-size:12px;font-weight:700;white-space:nowrap;flex:0 0 auto}`;
const HEAD = watch(".db-p", `(p) => { const svg = p.querySelector(".og-svg"), bd = p.querySelector(".og-badge"); if (!svg || !bd || p.querySelector(".o5-hb")) return;
  const n = [...svg.querySelectorAll(".og-nend")].reduce((a, t) => a + (+(/(\\d+)/.exec(t.querySelector("title").textContent.split("のうち")[1] || "") || [0, 0])[1]), 0);
  if (n) bd.insertAdjacentHTML("afterend", '<span class="o5-hb" title="作業終了が空などで、棒にできない作業（行の右の札）">区間の分からない作業 ' + n + ' 本</span>'); }`);

export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（行の右の端に字「区間なし n」）", css: "", ops: [] },
  { key: "C", name: "C 「区間なし n」を琥珀の丸い札に", css: PILL_CSS, ops: [pill(false)] },
  { key: "K", name: "K 札＋名前の前に琥珀の点", css: PILL_CSS, ops: [pill(false), DOT] },
  { key: "M", name: "M 札＋下の段の先頭に「区間の分からない作業 n 本」", css: PILL_CSS + SUM_CSS, ops: [pill(false), SUM] },
  { key: "N", name: "N 札の字をわけそのものに（作業終了が空 1）", css: PILL_CSS, ops: [pill(true)] },
  { key: "P", name: "P 札＋見出しの全体の稼働率の横に「区間の分からない作業 n 本」", css: PILL_CSS + HEAD_CSS, ops: [pill(false), HEAD] },
];
