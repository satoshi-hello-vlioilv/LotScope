// 2026-10-17 ダッシュボードの右クリックのメニュー（版 3.44.0。利用者の要望 6）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashmenu.mjs --states dash-menu,dash-gridmenu   （1280x720 でも）
// 今の物（版 3.43.1）で見えたこと: 右クリックはブラウザーのメニュー（戻る・印刷など。ダッシュボードの操作は無い）。パネルの操作は見出しのボタン（絞る・組む）だけで、
//   画像にする・表の値を写す・ほかのダッシュボードへ写す手は無い（画面全体の画像だけ）
// 案の方向（何で解くか）:
//   A 置き場（押した所に・まとまり）: 見る・写す・組む・消す のまとまり（印・キー）。空いた所は 足す・貼り付け・引き直す。作った物
//   B 減らし方（平らなメニュー）: まとまりの見出しを外し、線だけで分ける
//   C 見せ方（絵のボタンの行）: 頭に よく使う物（引き直す・絞る・画像・複製・消す）の絵のボタンを 1 行
//   D 置き場（パネルの右上に出す）: 押した所ではなく、パネルの見出しの右上に揃えて出す（⋯ のメニューと同じ置き場）
//   E 置き場（2 列）: 左に 見る・写す、右に 組む・消す（縦を短く）
let seq = 0;
const watch = (sel, fn) => { const k = `dm${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 押した所に・まとまりのメニュー（作った物）", css: "", ops: [] },
  { key: "B", name: "B 平らなメニュー（見出しなし）", css: `.tpa-menu .tm-group{font-size:0;margin:4px 6px;padding:0}`, ops: [] },
  {
    key: "C", name: "C 頭に絵のボタンの行",
    css: `.dm-quick{display:flex;gap:4px;padding:2px 6px 6px;border-bottom:1px solid var(--line-soft);margin-bottom:4px}.dm-quick span{flex:1;height:32px;display:grid;place-items:center;border:1px solid var(--line);border-radius:7px}.dm-quick span.d{color:#b42318;border-color:#f3c1bb}`,
    ops: [watch(".tpa-menu", `(m) => { const h = m.querySelector(".tm-head"); if (!h || !/引き直す/.test(m.textContent) || /すべて/.test(m.textContent)) return; h.insertAdjacentHTML("afterend", '<div class="dm-quick"><span title="引き直す">↻</span><span title="絞る">⏷</span><span title="画像をコピー">🖼</span><span title="複製">⧉</span><span class="d" title="消す">🗑</span></div>');
      [...m.querySelectorAll("button")].filter((b) => /引き直す|絞る|画像をコピー|複製|消す/.test(b.textContent)).forEach((b) => b.remove()); }`)],
  },
  {
    key: "D", name: "D パネルの右上に揃えて出す",
    css: "",
    ops: [watch(".tpa-menu", `(m) => { const p = document.querySelector("#dashGrid .db-p.is-sel, #dashGrid .db-p:hover"); const sel = [...document.querySelectorAll("#dashGrid .db-p")].find((x) => x.querySelector("h3")?.textContent === m.querySelector(".tm-head")?.textContent) || p;
      if (!sel) return; const r = sel.getBoundingClientRect(); TPA.placeAt(m, r.right - m.offsetWidth - 6, r.top + 40); }`)],
  },
  {
    key: "E", name: "E 2 列のメニュー（縦を短く）",
    css: `.tpa-menu.dm-two{max-width:none;width:480px;display:grid;grid-template-columns:1fr 1fr;column-gap:8px}.dm-two .tm-head{grid-column:1/-1}.dm-two > div{min-width:0}`,
    ops: [watch(".tpa-menu", `(m) => { const kids = [...m.children]; kids.shift(); const at = kids.findIndex((k) => k.classList.contains("tm-group") && /組む|画面/.test(k.textContent)); if (at < 0) return;
      const L = document.createElement("div"), R = document.createElement("div"); kids.slice(0, at).forEach((k) => L.append(k)); kids.slice(at).forEach((k) => R.append(k)); m.append(L, R); m.classList.add("dm-two");
      TPA.placeAt(m, parseFloat(m.style.left), parseFloat(m.style.top)); }`)],
  },
];
