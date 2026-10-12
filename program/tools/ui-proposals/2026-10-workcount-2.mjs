// 2026-10「作業実績」の作業のまとめ（2 回目）。1 回目の上位 3 案（C・B・A）と、効いていたエッセンスを組んだ複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-workcount-2.mjs --states worklog [--view 1536x864]
// H1: C の右の帯（日×直）＋ A の分割ロットを 1 行に畳む「＋n」＋件数の行で「日ごと／日＋直ごと」を切り替え（帯の列が変わる）
// H2: C の右の帯 ＋ A の一覧の中の日・直の見出し行（両方）
// H3: C の右の帯 ＋ E の件数の行の作業数の札（一覧は畳まず、分割した行に左の線）
// H4: G の切り替えを 3 段に（一覧だけ／一覧＋集計／集計だけ）。既定は一覧＋集計（C の形）
import { CSS, HELPER, PROPOSALS as FIRST, SWITCH, opt } from "./2026-10-workcount.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const SIDE = `.wk-side{flex:none;width:330px;margin-left:12px;border:1px solid var(--line);border-radius:8px;background:#fbfdfe;overflow:auto;padding:8px}
  .wk-side h5{margin:2px 4px 8px;font-size:13px;display:flex;align-items:center;gap:8px}.wk-side h5 small{color:var(--muted);font-weight:500}
  .wk-pv tbody tr:nth-child(4){background:#e6f3f1;box-shadow:inset 3px 0 var(--ll-teal)}
  #llBody td:first-child{overflow:visible}#llCols col:first-child{width:150px!important}`;
const side = (title) => `document.querySelector("#llBodyRow").insertAdjacentHTML("beforeend", '<aside class="wk-ui wk-side"><h5>${title}</h5>' + h.pivotHtml(w, 60) + "</aside>");`;
const SWITCH2 = SWITCH.replace("日ごと</b><b class=\"on\">日＋直ごと", "日ごと</b><b class=\"on\">日＋直ごと");
const total = "d.work.total.works + 'ロット（' + d.work.total.rows + '行）'";

export const PROPOSALS = [
  { ...pick("C"), key: "C" },
  { ...pick("B"), key: "B" },
  { ...pick("A"), key: "A" },
  {
    key: "H1", name: "右の帯（日×直）＋分割ロットを 1 行に畳む＋件数の行で日／日＋直を切り替え",
    css: CSS + SIDE,
    ops: [opt(`list: { merge: true },
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", ${JSON.stringify(SWITCH2)});
        document.querySelector("#llCount").textContent = "全 " + ${total};
        ${side("日・直ごとのロット数 <small>押すとその日・直に絞ります</small>")} }`)],
  },
  {
    key: "H2", name: "右の帯（日×直）＋一覧の中の日・直の見出し行",
    css: CSS + SIDE,
    ops: [opt(`list: { heads: true, shifts: true, merge: true, tog: true },
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", ${JSON.stringify(SWITCH2)});
        document.querySelector("#llCount").textContent = "全 " + ${total};
        ${side("日・直ごとのロット数")} }`)],
  },
  {
    key: "H3", name: "右の帯（日×直）＋件数の行に作業数の札（一覧は畳まず、分割した行に左の線）",
    css: CSS + SIDE,
    ops: [opt(`list: { merge: false },
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", '<span class="wk-ui wk-chip">作業 ' + w.total.works + 'ロット<small>（行 ' + w.total.rows + '・分割 ' + w.total.split + '）</small></span>');
        ${side("日・直ごとのロット数 <small>分割は 1</small>")} }`)],
  },
  {
    key: "H4", name: "「一覧だけ／一覧＋集計／集計だけ」の 3 段の切り替え（既定は一覧＋集計）",
    css: CSS + SIDE,
    ops: [opt(`list: { merge: true },
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", '<span class="wk-ui wk-seg"><b>一覧だけ</b><b class="on">一覧＋集計</b><b>集計だけ</b></span>');
        document.querySelector("#llCount").textContent = "全 " + ${total};
        ${side("日・直ごとのロット数")} }`)],
  },
];
