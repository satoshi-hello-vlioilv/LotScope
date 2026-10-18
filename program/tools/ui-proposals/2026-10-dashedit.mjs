// 2026-10-18 ダッシュボードの組む所: 幅を変える・条件（値で絞る）・数の計算と単位（版 3.45.0。利用者の要望 2・3・6）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashedit.mjs --states dash-cond,dash-kpi-fmt   （1536x864・1280x720 でも）
// 今の物（版 3.44.0）で見えたこと: カラムの欄が 210px で決まっていて、長いカラム名（BOX設計_設… など 21 個）が切れて読めない・組む所の幅も 720px で決まっている。
//   条件は 列・比べ方・値を打つ行だけ（値の一覧が無い）。数字の単位は表示形式の「後ろに」を開かないと見えず、数に計算を足す所が無い
// 案の方向（何で解くか）:
//   A 置き場（縁と境の取っ手を引く・条件は列ごとの札＋値で絞る面・書式の頭に「計算」「単位」の行）。作った物
//   B 見せ方（取っ手をいつも見える「⇔」の札にする）
//   C 減らし方（幅は見出しの「標準・広い・最大」の 3 つの札で選ぶ）
//   D 置き場（計算と単位を、③ 形の「数字」のすぐ下に出す: 書式を開かずに）
//   E 見せ方（計算を 演算子の選び＋数の欄にする: 書き方を思い出させない）
let seq = 0;
const watch = (sel, fn) => { const k = `de${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 縁と境の取っ手・条件の札＋値で絞る面・書式の頭に計算と単位（作った物）", css: "", ops: [] },
  {
    key: "B", name: "B 取っ手をいつも見える「⇔」の札に",
    css: `.de-split::after,.de-wgrip::after{background:var(--ll-teal)!important;height:72px!important;margin-top:-36px!important}
      .de-split::before{content:"⇔";position:absolute;top:calc(50% - 52px);left:-6px;font-size:12px;color:var(--ll-teal-dark);background:#fff;border:1px solid #9fd3cb;border-radius:999px;padding:0 4px}`,
    ops: [],
  },
  {
    key: "C", name: "C 幅は見出しの「標準・広い・最大」の札",
    css: `.de-wsegs{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden;margin-right:6px}.de-wsegs span{padding:4px 10px;font-size:12.5px;border-left:1px solid var(--line)}.de-wsegs span:first-child{border-left:0}.de-wsegs span.on{background:var(--ll-pale);color:var(--ll-teal-dark);font-weight:700}.de-wgrip,.de-split{display:none}`,
    ops: [watch("#dbEditor .de-head", `(h) => { h.querySelector(".db-sp").insertAdjacentHTML("afterend", '<span class="de-wsegs" title="組む所の幅"><span>標準</span><span class="on">広い</span><span>最大</span></span>'); }`)],
  },
  {
    key: "D", name: "D 計算と単位を ③ 形の「数字」のすぐ下に",
    css: `.de-ngrid > .de-gl:nth-child(-n+4),.de-ngrid > .de-gc:nth-child(-n+4){}`,
    ops: [watch("#deFmt .de-ngrid", `(g) => { const rows = [...g.children].slice(0, 4); const vis = document.querySelector("#deVis"); if (!vis || !rows.length) return; const box = document.createElement("div"); box.className = "de-ngrid"; box.style.marginTop = "8px"; rows.forEach((r) => box.append(r)); vis.after(box); }`)],
  },
  {
    key: "E", name: "E 計算は 演算子の選び＋数の欄",
    css: `.de-cop{height:30px;border:1px solid var(--line);border-radius:6px;padding:0 6px;font:inherit}.de-cnum{width:90px!important}`,
    ops: [watch("#dbEditor .de-fcalc", `(c) => { const i = c.querySelector("[data-de-fexpr]"); if (!i) return; const m = /^([×÷+\\-])(.*)$/.exec(i.value) || ["", "×", "10"];
      i.insertAdjacentHTML("beforebegin", '<select class="de-cop"><option>なし</option><option' + (m[1] === "×" ? " selected" : "") + '>× かける</option><option' + (m[1] === "÷" ? " selected" : "") + '>÷ わる</option><option>＋ たす</option><option>− ひく</option></select><input class="de-ntx de-cnum" value="' + m[2] + '">');
      i.style.display = "none"; const ex = c.querySelector(".de-cex"); if (ex) ex.remove(); const msg = c.querySelector(".de-cmsg"); if (msg) msg.textContent = "値" + m[1] + m[2] + " を出します（式で書くときは「式で書く」）"; }`)],
  },
];
