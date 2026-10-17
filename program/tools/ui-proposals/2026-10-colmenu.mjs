// 2026-10-17 表示列の窓: 作った列を消す・右クリックのメニュー（版 3.44.0。利用者の要望 4・5）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-colmenu.mjs --states columns-conv,columns-menu   （1280x720 でも）
// 今の物（版 3.43.1）で見えたこと: 作った列を消すボタンは、右の「この列の作り方」の段を開いた中の下にだけある（段は畳まれていて見えない）。
//   列の一覧に右クリックは無く、並び替えはドラッグだけ・表示名は選んだ行の欄だけ
// 案の方向（何で解くか）:
//   A 置き場（行・右クリック・札）: 作った列の行の右端にごみ箱（淡く）・右の札の「削除」・右クリックのまとまり（表示・並び・作る・整える・消す）。作った物
//   B 減らし方（平らなメニュー）: まとまりの見出しを外し、線だけで分ける（印・キーも外す）
//   C 見せ方（よく使う物を絵の行に）: メニューの頭に 並び（⤒↑↓⤓）と削除の絵のボタンを 1 行、その下に字の項目
//   D 見せ方（消すを目立たせる）: 行のごみ箱をいつも赤で見せ、メニューの消す項目を一番上に
//   E 置き場（2 列のメニュー）: 左に 表示・並び、右に 作る・整える・消す（縦を短く）
let seq = 0;
const watch = (sel, fn) => { const k = `cm${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 行のごみ箱・札の削除・まとまりのメニュー（作った物）", css: "", ops: [] },
  { key: "B", name: "B 平らなメニュー（見出し・印・キーなし）", css: `.tpa-menu .tm-group{font-size:0;margin:4px 6px;padding:0}.tpa-menu .tm-ico,.tpa-menu kbd{display:none}.tpa-menu button{padding-left:10px}`, ops: [] },
  {
    key: "C", name: "C 頭に絵のボタンの行（並び・削除）",
    css: `.cm-quick{display:flex;gap:4px;padding:2px 6px 6px;border-bottom:1px solid var(--line-soft);margin-bottom:4px}.cm-quick span{flex:1;height:30px;display:grid;place-items:center;border:1px solid var(--line);border-radius:7px;color:var(--ink)}.cm-quick span.d{color:#b42318;border-color:#f3c1bb}`,
    ops: [watch(".tpa-menu", `(m) => { const h = m.querySelector(".tm-head"); if (!h) return; h.insertAdjacentHTML("afterend", '<div class="cm-quick"><span title="いちばん上へ">⤒</span><span title="1 つ上へ">↑</span><span title="1 つ下へ">↓</span><span title="いちばん下へ">⤓</span><span class="d" title="削除">🗑</span></div>');
      [...m.querySelectorAll("button")].filter((b) => /いちばん|1 つ|削除/.test(b.textContent)).forEach((b) => b.remove()); m.querySelectorAll(".tm-group").forEach((g) => { if (g.textContent === "並び") g.remove(); }); }`)],
  },
  {
    key: "D", name: "D 消すを目立たせる（赤いごみ箱・消すを一番上）",
    css: `.lc-row .lc-del{opacity:1!important;color:#b42318!important}`,
    ops: [watch(".tpa-menu", `(m) => { const d = [...m.querySelectorAll("button")].find((b) => /削除|式を外す/.test(b.textContent)); const h = m.querySelector(".tm-head"); if (d && h) { h.after(d); d.insertAdjacentHTML("afterend", '<hr class="tm-sep">'); } }`)],
  },
  {
    key: "E", name: "E 2 列のメニュー（縦を短く）",
    css: `.tpa-menu.cm-two{max-width:none;width:470px;display:grid;grid-template-columns:1fr 1fr;column-gap:8px}.cm-two .tm-head{grid-column:1/-1}.cm-two > div{min-width:0}`,
    ops: [watch(".tpa-menu", `(m) => { const kids = [...m.children]; const h = kids.shift(); const at = kids.findIndex((k) => k.classList.contains("tm-group") && /作る/.test(k.textContent)); if (at < 0) return;
      const L = document.createElement("div"), R = document.createElement("div"); kids.slice(0, at).forEach((k) => L.append(k)); kids.slice(at).forEach((k) => R.append(k)); m.append(L, R); m.classList.add("cm-two");
      TPA.placeAt(m, parseFloat(m.style.left), parseFloat(m.style.top)); }`)],
  },
];
