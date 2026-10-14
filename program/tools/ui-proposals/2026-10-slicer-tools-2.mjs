// 2026-10 スライサーの操作を足す（2 回目。1 回目の上位 3 案 F・B・C と、効いていたエッセンスを組み直した複合案 4 つ）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-slicer-tools-2.mjs --states slicer [--view 1536x864]
// 1 回目で効いて見えた所:
//   F の値の ☑／◉: 選び方（いくつでも／1 つだけ）が値の行そのものに見え、説明を読まずに分かる。「（すべて）」の行で全部選ぶ・外すが 1 回
//   F の 0 件の畳み: 「0 件 1 個を隠しています 出す」で、隠したことと戻し方が同じ所に見える
//   B の ⋯ のメニュー: 見出しが「名前・N 選択 ×・⋯・外す」に収まり、名前が切れない。たまにしか使わない物（選び方・0 件・上へ下へ）を文で選べる
//   C の下の「すべて選ぶ・外す」: 字のリンクで読みやすいが、見出しの 1つ/複数 は 250px で潰れて読めない
//   面の頭の「− 100% ＋」は、頭の「スライサー」を 2 行に折る（A〜F 共通の弱み）
import { CSS, GRIP, HIDE0, KIT, PROPOSALS as R1, go } from "./2026-10-slicer-tools.mjs";

const pick = (k) => R1.find((p) => p.key === k);
// F の値の形（☑／◉・（すべて）の行・0 件の畳み）。single: 1 つだけにするカードの番号
const VALUES = (single = 1, allRow = true) => `X.cards().forEach((c, i) => { const one = i === ${single}, vs = [...c.querySelectorAll(".sx-v")];
  vs.forEach((v) => { const on = v.classList.contains("is-on"); v.classList.remove("is-on"); const s = v.querySelector("span"); s.style.display = "flex"; s.style.alignItems = "center";
    s.insertAdjacentHTML("afterbegin", one ? '<i class="px-rd' + (on ? ' on' : '') + '"></i>' : '<i class="px-ck' + (on ? ' on' : '') + '"></i>'); });
  ${allRow ? `if (!one) c.querySelector(".sx-vals").insertAdjacentHTML("afterbegin", '<button class="sx-v px-all"><span style="display:flex;align-items:center"><i class="px-ck half"></i>（すべて）</span><i>2 / 8</i></button>');` : ""}
  const z = c.querySelectorAll(".sx-v.is-zero").length;
  if (z) c.insertAdjacentHTML("beforeend", '<div class="px-foot"><span>0 件 ' + z + ' 個を隠しています</span><a>出す</a></div>'); });`;
// カードの ⋯（開いた形は 2 枚目）
const MENU = (key) => `X.cards().forEach((c, i) => c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<button class="px-ib' + (i ? ' on' : '') + '" data-px="${key}m' + i + '" title="このスライサーの操作">⋯</button>'));
  const c = X.cards()[1]; c.style.position = "relative";
  c.insertAdjacentHTML("beforeend", '<div class="px-menu" data-px="${key}p"><span class="hov"><i class="px-rd on"></i>1 つだけ選ぶ</span><span><i class="px-ck"></i>いくつでも選ぶ</span><hr>'
    + '<span><i class="px-ck on"></i>0 件の値を隠す</span><hr><span>↑ 上へ</span><span>↓ 下へ</span></div>');`;
// 面の頭: 一覧と同じ「🔍 100% ▾」（押すと − ━●━ ＋ の面）＋右端で幅
const ZOOMBTN = (key) => `X.head().querySelector(".sx-place").insertAdjacentHTML("beforebegin", '<button class="px-ib" data-px="${key}z" title="スライサーの字の大きさ" style="gap:3px">🔍<b>100%</b>▾</button>');
  const p = X.$("#llSlicer"); p.classList.add("px-pane-rel"); p.style.overflow = "visible"; p.insertAdjacentHTML("beforeend", '<i class="px-edge" data-px="${key}e" title="引いて幅を変える"></i>');`;

export const PROPOSALS = [
  pick("F"), pick("B"), pick("C"),
  { key: "M1", name: "複合: F（値の ☑／◉・（すべて）の行・0 件の畳み）＋ B（⋯ に選び方・0 件・上へ下へ）＋頭に − 100% ＋・右端で幅", css: CSS,
    ops: [KIT, go("M1", `${GRIP("M1")} ${HIDE0} ${VALUES()} ${MENU("M1")}
      X.head().querySelector(".sx-place").insertAdjacentHTML("beforebegin", '<span class="px-zoom" data-px="M1z"><b>−</b><span>100%</span><b>＋</b></span>');
      const p = X.$("#llSlicer"); p.classList.add("px-pane-rel"); p.style.overflow = "visible"; p.insertAdjacentHTML("beforeend", '<i class="px-edge" data-px="M1e"></i>');`)] },
  { key: "M2", name: "複合: F の値 ＋ C（値の下に「すべて選ぶ・外す」。（すべて）の行は無し）＋ B の ⋯ ＋頭は 🔍 100% ▾・右端で幅", css: CSS,
    ops: [KIT, go("M2", `${GRIP("M2")} ${HIDE0} ${VALUES(1, false)} ${MENU("M2")} ${ZOOMBTN("M2")}
      X.cards().forEach((c) => { const f = c.querySelector(".px-foot"); const links = '<a>すべて選ぶ</a><a>外す</a>';
        if (f) f.insertAdjacentHTML("afterbegin", links + '<span style="flex:1"></span>'); else c.insertAdjacentHTML("beforeend", '<div class="px-foot">' + links + '</div>'); });`)] },
  { key: "M3", name: "複合: F の値（（すべて）の行）＋ B の ⋯ ＋頭は一覧と同じ 🔍 100% ▾（頭が 1 行に収まる）・右端で幅", css: CSS,
    ops: [KIT, go("M3", `${GRIP("M3")} ${HIDE0} ${VALUES()} ${MENU("M3")} ${ZOOMBTN("M3")}`)] },
  { key: "M4", name: "複合: F の値 ＋ 見出しの 1 つの絵で選び方を切り替え（☑⇄◉）・0 件の畳み ＋頭は 🔍 100% ▾・右端で幅（⋯ は無し・並べ替えは ⋮⋮ だけ）", css: CSS,
    ops: [KIT, go("M4", `${GRIP("M4")} ${HIDE0} ${VALUES()} ${ZOOMBTN("M4")}
      X.cards().forEach((c, i) => c.querySelector(".sx-rm").insertAdjacentHTML("beforebegin", '<button class="px-ib" data-px="M4b' + i + '" title="選び方を切り替える（いくつでも ⇄ 1 つだけ）">' + (i ? '◉' : '☑') + '</button>'));`)] },
];
