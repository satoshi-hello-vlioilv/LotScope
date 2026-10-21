// 2026-10-ops4 の 3 回目（2 回目は 6 案とも 80 点に届かず。1 位 P 78.6 点・2 位 C と N 77.0 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops4-3.mjs --states dash-ops,dash-ops-edit --from dash   （1536x864・1280x720 でも）
// 2 回目の採点で、どの案にも共通した減点（−3）は作った物の不具合として直した（A に入っている）:
//   パレート図が上位の品種だけを棒にし、省いたことがどこにも出ない → 図の左上に「上位 7 品種（全 11 品種は右の表）」
//   組む所の品種の札の「‹」が何か分からない → 「←」（前へ）
// 2 回目で効いた所: P の見出しの札（パネルを開いた所で気付く）と、行の琥珀の丸い札（どの設備か）。
// 低かった所: 見出しの札と行の札で言葉が違う（「区間の分からない作業 1 本」と「区間なし 1」）・見出しの札はどの設備か・何が無いのかを言わない・
//   全体の稼働率の札との間が約 30px 空いて浮く・N の「作業終了が空」は同じ行の作業中の棒（これも作業終了が無い）と取り違える
// 案の方向（新しい案は Q・S・T）:
//   A 直した作った物（行の右の端に字「区間なし n」）
//   P 持ち越し（2 回目 1 位）: 行の札＋見出しの全体の稼働率の横に「区間の分からない作業 n 本」の札
//   Q 言葉（新）: P の言葉をそろえる（見出しも行も「区間なし」）・見出しの札にどの設備かを書く（「区間なし 1 本 ANF」）・稼働率の札のすぐ横に
//   S まとめ方（新）: 見出しの札を分けず、全体の稼働率の札の中の終わりに「区間なし 1 本（ANF）」の琥珀の字（1 つの札に全体の数）
//   T 置き場＋言葉（新）: Q ＋ 行の札にわけを添える（「区間なし 1・終了の記録なし」。作業中〈まだ終わっていない〉と分ける言い方）
let seq = 0;
const watch = (sel, fn) => { const k = `o6${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const PILL_CSS = `.og-nend{fill:#7a4310}.o6-pill{fill:#fdf0dc;stroke:#d9a55a;stroke-width:1}`;
/** 行の札: 行の右の端の字に丸い地を敷く。why … 字の後ろに「・終了の記録なし」 */
const pill = (why) => watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-nend").forEach((t) => { if (t.dataset.mv) return; t.dataset.mv = 1;
  ${why ? `t.firstChild.nodeValue = t.firstChild.nodeValue + "・終了の記録なし";` : ""}
  t.setAttribute("x", +t.getAttribute("x") - 8); const b = t.getBBox();
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("class", "o6-pill"); r.setAttribute("x", b.x - 8); r.setAttribute("y", b.y - 2); r.setAttribute("width", b.width + 16); r.setAttribute("height", b.height + 4); r.setAttribute("rx", (b.height + 4) / 2); t.before(r); }); }`);
/** 区間の分からない作業: [[設備, 本数]] */
const ROWS = `[...svg.querySelectorAll(".og-nend")].map((t) => [t.closest(".og-row").querySelector(".og-name").firstChild.nodeValue, +(/(\\d+)/.exec(t.querySelector("title").textContent.split("のうち")[1] || "") || [0, 0])[1]])`;
const HEAD_CSS = (gap) => `.o6-hb{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 10px;margin-left:${gap}px;border-radius:999px;background:#fdf0dc;border:1px solid #d9a55a;color:#7a4310;font-size:12px;font-weight:700;white-space:nowrap;flex:0 0 auto}.o6-hb small{font-size:12px;font-weight:400;color:#7a4310}`;
/** 見出しの札。word … 札の言葉・who … どの設備かを書く */
const head = (word, who) => watch(".db-p", `(p) => { const svg = p.querySelector(".og-svg"), bd = p.querySelector(".og-badge"); if (!svg || !bd || p.querySelector(".o6-hb")) return;
  const rows = ${ROWS}, n = rows.reduce((a, r) => a + r[1], 0); if (!n) return;
  bd.insertAdjacentHTML("afterend", '<span class="o6-hb" title="作業終了の記録が無いなどで、棒にできない作業（行の右の札）">${word} ' + n + ' 本' + (${who} ? '<small>' + rows.map((r) => r[0]).join("・") + '</small>' : '') + '</span>'); }`);
const IN_CSS = `.o6-in{color:#7a4310;font-weight:700;font-size:12px;padding-left:8px;margin-left:2px;border-left:1px solid #c9d1d6}`;
const INSIDE = watch(".db-p", `(p) => { const svg = p.querySelector(".og-svg"), bd = p.querySelector(".og-badge"); if (!svg || !bd || bd.querySelector(".o6-in")) return;
  const rows = ${ROWS}, n = rows.reduce((a, r) => a + r[1], 0); if (!n) return;
  bd.insertAdjacentHTML("beforeend", '<span class="o6-in" title="作業終了の記録が無いなどで、棒にできない作業（行の右の札）">区間なし ' + n + ' 本（' + rows.map((r) => r[0]).join("・") + '）</span>'); }`);

export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（行の右の端に字「区間なし n」）", css: "", ops: [] },
  { key: "P", name: "P 行の札＋見出しの全体の稼働率の横に「区間の分からない作業 n 本」", css: PILL_CSS + HEAD_CSS(8), ops: [pill(false), head("区間の分からない作業", false)] },
  { key: "Q", name: "Q 見出しも行も「区間なし」・見出しの札に設備（稼働率の札のすぐ横）", css: PILL_CSS + HEAD_CSS(4), ops: [pill(false), head("区間なし", true)] },
  { key: "S", name: "S 全体の稼働率の札の中の終わりに「区間なし n 本（設備）」", css: PILL_CSS + IN_CSS, ops: [pill(false), INSIDE] },
  { key: "T", name: "T Q ＋ 行の札にわけ（区間なし 1・終了の記録なし）", css: PILL_CSS + HEAD_CSS(4), ops: [pill(true), head("区間なし", true)] },
];
