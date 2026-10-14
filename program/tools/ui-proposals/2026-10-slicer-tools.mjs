// 2026-10 スライサーの操作を足す（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-slicer-tools.mjs --states slicer [--view 1536x864]
// 利用者の要望: スライサーにした項目の並び変更・0 件の非表示・全選択／全解除・1 つだけ選ぶ方式と選んだ分だけ入る今の方式の切り替え・
//   スライサーの幅の変更・スライサーの部分の拡大縮小。
// 今の画面（画像で見えたこと）: 幅は 250px で決まっていて変えられない（値の名前が長いと切れる）。カードの並びは足した順のまま動かせない。
//   値は押すたびに入る・外れる（何個でも）だけで、1 つだけに切り替えるには、いちいち前の値を外す。全部選ぶ・全部外す手が無い（外すは「2 選択 ×」だけ）。
//   0 件の値（（空欄）0）も淡く並び、値が多い列では探す邪魔になる。字の大きさは一覧の拡大（100% ▾）と関係なく固定。
// 案は、左に置いたスライサー（設備で CR1・L-1 を選んだ・不良名）に、操作を当てた形で比べる。
//
// 方向（何で解くか）: A 置き場＝カードの見出しに小さなボタンを並べる（⋮⋮・全・外・1つ/複数・0 件）＋面の頭に拡大・右端を引いて幅
// ／B 減らし方＝カードの「⋯」のメニューにまとめる（全部選ぶ・外す・選び方・0 件・上へ下へ）＋面の頭に拡大・右端で幅
// ／C 流れ＝値の並びの下に「すべて選ぶ・外す」と「0 件 N 個を隠しています」、見出しに 1つ/複数 ＋拡大・幅
// ／D 見せ方を分ける＝面の頭の「⚙ 整える」を押した間だけ、並べ替え・選び方・0 件・幅・字の大きさを出す（ふだんは値だけ）
// ／E 借りる＝Excel のスライサーと同じ見出しの 2 つの絵（複数選択・フィルターのクリア）＋0 件は右クリック
// 5 案は「カードに操作を足す」に寄る → 方向の違う 2 案を足す:
// F 値の側で解く＝値の行に ☑（いくつでも）か ◉（1 つだけ）を付け、先頭に「（すべて）」の行。0 件は畳んで「0 件 N 個（出す）」
// G まとめて決める＝面の頭の下に、全部のカードに効く帯（0 件を隠す・選び方・幅・字の大きさ）。カードは ⋮⋮ と全・外だけ

export const KIT = ["script", `
(() => {
  const $ = (s) => document.querySelector(s);
  window.__sx = {
    $,
    /** 案を入れる: build() が HTML を入れる（data-px の物が消えたら入れ直す。スライサーは読み直すたびに描き直す） */
    mount(key, build) { setInterval(() => { if (document.querySelector(".sx-card") && !document.querySelector("[data-px='" + key + "']")) try { build(); } catch (_) {} }, 150); },
    cards: () => [...document.querySelectorAll("#llSlicer .sx-card")],
    head: () => document.querySelector("#llSlicer .sx-head"),
  };
})();`];
export const CSS = `
  .px-g{color:#8a97a3;font-weight:800;letter-spacing:-2px;cursor:grab;padding:0 2px;font-size:13px}
  .px-ib{height:22px;min-width:22px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font:inherit;font-size:11px;color:var(--h-input);padding:0 5px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center}
  .px-ib.on{background:var(--input-soft);border-color:var(--h-input);font-weight:700}
  .px-seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
  .px-seg b{font-weight:400;font-size:11px;padding:0 6px;height:22px;display:inline-flex;align-items:center;color:var(--muted);background:var(--surface)}
  .px-seg b.on{background:var(--h-input);color:#fff;font-weight:700}
  .px-zoom{display:inline-flex;align-items:center;gap:2px;font-size:11.5px;color:var(--h-input)}
  .px-zoom b{width:22px;height:22px;border:1px solid var(--line);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:var(--surface);font-weight:700}
  .px-zoom span{min-width:34px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
  .px-edge{position:absolute;top:0;bottom:0;right:-7px;width:8px;cursor:col-resize;display:flex;align-items:center;justify-content:center}
  .px-edge::before{content:"";width:3px;height:44px;border-radius:2px;background:#9fb3c6}
  .px-menu{position:absolute;z-index:40;right:6px;top:30px;background:var(--surface);border:1px solid var(--pop-line);border-radius:9px;box-shadow:0 14px 34px var(--pop-shadow);padding:5px;display:grid;min-width:190px;font-size:12.5px}
  .px-menu span{padding:6px 10px;border-radius:6px;display:flex;gap:8px;align-items:center}
  .px-menu span:hover,.px-menu span.hov{background:var(--surface-4)}
  .px-menu hr{border:0;border-top:1px solid var(--line);margin:3px 0}
  .px-menu small{color:var(--muted);margin-left:auto}
  .px-foot{display:flex;gap:10px;align-items:center;margin-top:6px;font-size:11.5px;color:var(--muted)}
  .px-foot a{color:var(--h-input);font-weight:700;text-decoration:none}
  .px-strip{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:11.5px;color:var(--muted)}
  .px-strip label{display:inline-flex;gap:4px;align-items:center}
  .px-edit{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px;margin:-2px 0 6px;border-radius:6px;background:var(--surface-3);font-size:11.5px;color:var(--muted)}
  .px-ck{width:14px;height:14px;border:1.5px solid #8ea3b7;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex:none;background:var(--surface);color:#fff;position:relative}
  .px-ck.on{background:var(--h-input);border-color:var(--h-input)}
  .px-ck.on::after{content:"✓"}
  .px-ck.half{background:var(--h-input);border-color:var(--h-input)}
  .px-ck.half::after{content:"–"}
  .px-rd{width:14px;height:14px;border:1.5px solid #8ea3b7;border-radius:50%;flex:none;background:var(--surface);position:relative}
  .px-rd.on{border-color:var(--h-input)}
  .px-rd.on::after{content:"";position:absolute;inset:2.5px;border-radius:50%;background:var(--h-input)}
  .sx-v .px-ck,.sx-v .px-rd{margin-right:6px}
  .px-all{font-weight:700}
  .px-hid .sx-v.is-zero{display:none}
  .px-pane-rel{position:relative}
  .px-xl{font-size:15px}
`;
// 入れた印は最初のカードに付ける（スライサーは読み直すたびにカードを描き直すので、描き直したら入れ直す）
export const go = (key, build) => ["script", `window.__sx.mount(${JSON.stringify(key)}, () => { const X = window.__sx; X.cards()[0].setAttribute("data-px", ${JSON.stringify(key)}); ${build} });`];
// 面の頭に拡大縮小、面の右端に幅を変える取っ手
export const ZOOM = (key) => `X.head().querySelector(".sx-place").insertAdjacentHTML("beforebegin", '<span class="px-zoom" data-px="${key}z" title="スライサーの字の大きさ"><b>−</b><span>100%</span><b>＋</b></span>');
  const p = X.$("#llSlicer"); p.classList.add("px-pane-rel"); p.style.overflow = "visible"; p.insertAdjacentHTML("beforeend", '<i class="px-edge" data-px="${key}e" title="引いて幅を変える"></i>');`;
export const GRIP = (key) => `X.cards().forEach((c, i) => c.querySelector(".sx-ch").insertAdjacentHTML("afterbegin", '<span class="px-g" data-px="${key}g' + i + '" title="つかんで並べ替え">⋮⋮</span>'));`;
export const HIDE0 = `X.cards().forEach((c) => c.classList.add("px-hid"));`;

export const PROPOSALS = [
  { key: "A", name: "置き場: カードの見出しに ⋮⋮・全・外・1つ/複数・0 件のボタン＋面の頭に拡大・右端で幅", css: CSS,
    ops: [KIT, go("A", `${ZOOM("A")} ${GRIP("A")}
      X.cards().forEach((c, i) => { const rm = c.querySelector(".sx-rm");
        rm.insertAdjacentHTML("beforebegin", '<button class="px-ib" data-px="Ab' + i + '" title="すべて選ぶ">全</button><button class="px-ib" title="選択を外す">外</button>'
          + '<span class="px-seg"><b' + (i ? ' class="on"' : '') + '>1つ</b><b' + (i ? '' : ' class="on"') + '>複数</b></span><button class="px-ib' + (i ? ' on' : '') + '" title="0 件の値を隠す">0件</button>'); });
      X.cards()[1].classList.add("px-hid");`)] },
  { key: "B", name: "減らし方: カードの「⋯」のメニュー（全部選ぶ・外す・選び方・0 件を隠す・上へ下へ）＋面の頭に拡大・右端で幅", css: CSS,
    ops: [KIT, go("B", `${ZOOM("B")} ${GRIP("B")}
      X.cards().forEach((c, i) => c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<button class="px-ib' + (i ? ' on' : '') + '" data-px="Bm' + i + '" title="このスライサーの操作">⋯</button>'));
      const c = X.cards()[1]; c.style.position = "relative";
      c.insertAdjacentHTML("beforeend", '<div class="px-menu" data-px="Bp"><span>☑ すべて選ぶ<small>8 個</small></span><span>☐ 選択を外す</span><hr>'
        + '<span class="hov"><i class="px-rd on"></i>1 つだけ選ぶ</span><span><i class="px-rd"></i>いくつでも選ぶ</span><hr>'
        + '<span><i class="px-ck on"></i>0 件の値を隠す</span><hr><span>↑ 上へ</span><span>↓ 下へ</span></div>');`)] },
  { key: "C", name: "流れ: 値の並びの下に「すべて選ぶ・外す」と「0 件 N 個を隠しています」、見出しに 1つ/複数 ＋拡大・幅", css: CSS,
    ops: [KIT, go("C", `${ZOOM("C")} ${GRIP("C")} ${HIDE0}
      X.cards().forEach((c, i) => { c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<span class="px-seg" data-px="Cs' + i + '"><b' + (i ? ' class="on"' : '') + '>1つ</b><b' + (i ? '' : ' class="on"') + '>複数</b></span>');
        const z = c.querySelectorAll(".sx-v.is-zero").length;
        c.insertAdjacentHTML("beforeend", '<div class="px-foot"><a>すべて選ぶ</a><a>外す</a>' + (z ? '<span style="margin-left:auto">0 件 ' + z + ' 個を隠しています <a>出す</a></span>' : '') + '</div>'); });`)] },
  { key: "D", name: "見せ方を分ける: 面の頭の「⚙ 整える」を押した間だけ、並べ替え・選び方・0 件・幅・字の大きさ（ふだんは値と全・外だけ）", css: CSS,
    ops: [KIT, go("D", `X.head().querySelector(".sx-place").insertAdjacentHTML("beforebegin", '<button class="px-ib on" data-px="Dh">⚙ 整える</button>');
      X.head().insertAdjacentHTML("afterend", '<div class="px-strip" data-px="Ds"><span>幅</span><input type="range" style="width:70px"><span>字</span><span class="px-zoom"><b>−</b><span>100%</span><b>＋</b></span><span style="margin-left:auto">⋮⋮ で並べ替え</span></div>');
      ${GRIP("D")}
      X.cards().forEach((c, i) => c.querySelector(".sx-ch").insertAdjacentHTML("afterend", '<div class="px-edit" data-px="De' + i + '">選び方 <span class="px-seg"><b' + (i ? ' class="on"' : '') + '>1 つ</b><b' + (i ? '' : ' class="on"') + '>いくつでも</b></span><label><i class="px-ck' + (i ? ' on' : '') + '"></i>0 件を隠す</label></div>'));`)] },
  { key: "E", name: "借りる: Excel のスライサーと同じ見出しの絵（≣ 複数選択・⊘ クリア）＋ 0 件は右クリック・Ctrl＋ホイールで拡大・右端で幅", css: CSS,
    ops: [KIT, go("E", `const p = X.$("#llSlicer"); p.classList.add("px-pane-rel"); p.style.overflow = "visible"; p.insertAdjacentHTML("beforeend", '<i class="px-edge" data-px="Ee"></i>');
      ${GRIP("E")}
      X.cards().forEach((c, i) => { const clr = c.querySelector(".sx-clr"); if (clr) clr.remove();
        c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<button class="px-ib px-xl' + (i ? '' : ' on') + '" data-px="Ei' + i + '" title="複数選択">≣</button><button class="px-ib px-xl" title="フィルターのクリア">⊘</button>'); });`)] },
  { key: "F", name: "値の側で解く: 値の行に ☑（いくつでも）か ◉（1 つだけ）、先頭に「（すべて）」の行。0 件は畳んで「0 件 N 個（出す）」", css: CSS,
    ops: [KIT, go("F", `${ZOOM("F")} ${GRIP("F")} ${HIDE0}
      X.cards().forEach((c, i) => { const single = i === 1, vs = [...c.querySelectorAll(".sx-v")];
        c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<span class="px-seg" data-px="Fs' + i + '"><b' + (single ? ' class="on"' : '') + '>◉ 1 つ</b><b' + (single ? '' : ' class="on"') + '>☑ 複数</b></span>');
        vs.forEach((v) => { const on = v.classList.contains("is-on"); v.classList.remove("is-on"); v.querySelector("span").insertAdjacentHTML("afterbegin", single ? '<i class="px-rd' + (on ? ' on' : '') + '"></i>' : '<i class="px-ck' + (on ? ' on' : '') + '"></i>'); v.querySelector("span").style.display = "flex"; v.querySelector("span").style.alignItems = "center"; });
        if (!single) c.querySelector(".sx-vals").insertAdjacentHTML("afterbegin", '<button class="sx-v px-all"><span style="display:flex;align-items:center"><i class="px-ck half"></i>（すべて）</span><i>2 / 8</i></button>');
        const z = c.querySelectorAll(".sx-v.is-zero").length;
        if (z) c.insertAdjacentHTML("beforeend", '<div class="px-foot"><span>0 件 ' + z + ' 個を隠しています</span><a>出す</a></div>'); });`)] },
  { key: "G", name: "まとめて決める: 面の頭の下に全部のカードに効く帯（0 件を隠す・選び方・幅・字の大きさ）。カードは ⋮⋮ と全・外だけ", css: CSS,
    ops: [KIT, go("G", `X.head().insertAdjacentHTML("afterend", '<div class="px-strip" data-px="Gs"><label><i class="px-ck on"></i>0 件を隠す</label><span class="px-seg"><b>1つ</b><b class="on">複数</b></span>'
        + '<span>幅 <b class="px-ib">◀</b><b class="px-ib">▶</b></span><span class="px-zoom"><b>−</b><span>100%</span><b>＋</b></span></div>');
      ${GRIP("G")} ${HIDE0}
      X.cards().forEach((c, i) => c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<button class="px-ib" data-px="Gb' + i + '">全</button><button class="px-ib">外</button>'));`)] },
];
