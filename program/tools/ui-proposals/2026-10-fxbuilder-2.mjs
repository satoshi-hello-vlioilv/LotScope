// 2026-10 式ビルダーの置き場（2 回目）。1 回目の上位 3 案（A・B・D）と、エッセンスを組んだ複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-fxbuilder-2.mjs --states columns-fx
// H1: A のタブ＋開いたときのタブを式の有無で決める（式が空なら「組み立てる」・式があれば「式を書く」）。タブにいまの式の有無を添える
// H2: A のタブ＋G の「数・区分・文字」の大きな選び口（組み立ての形を 2 段で選ぶ）
// H3: B を畳んで置き、式が空のときだけ開いて出す（畳んだところを撮る）
// H4: A のタブ＋組み立てると式の欄へすぐ入る（「式にする」を押さない）
import { PROPOSALS as FIRST } from "./2026-10-fxbuilder.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const A = pick("A");
export const PROPOSALS = [
  A, pick("B"), pick("D"),
  {
    key: "H1", name: "タブ＋開いたときのタブは式の有無で決める（式が空なら組み立てる）",
    css: A.css + `.fxa-tabs b small{margin-left:4px;font-size:10.5px;opacity:.8}`,
    ops: [JSON.parse(JSON.stringify(A.ops[0])).map((x) => (typeof x === "string" ? x.replace(`'<span class="fxa-tabs"><b>式を書く</b><b class="on">組み立てる</b></span>'`,
      `'<span class="fxa-tabs"><b>式を書く<small>（式なし）</small></b><b class="on">組み立てる</b></span><small style="display:block;color:var(--muted);font-size:11.5px;margin:-2px 0 6px">式がまだ無いので、組み立てるから始めます。組み立てて「式にする」と式の欄に入ります</small>'`) : x))],
  },
  {
    key: "H2", name: "タブ＋「数・区分・文字」の大きな選び口",
    css: A.css + pick("G").css,
    ops: [JSON.parse(JSON.stringify(A.ops[0])).map((x) => (typeof x === "string" ? x.replace(`'<span class="fxa-tabs"><b>式を書く</b><b class="on">組み立てる</b></span>'`,
      `'<span class="fxa-tabs"><b>式を書く</b><b class="on">組み立てる</b></span><div class="fxg"><b>数<small>計算・丸める</small></b><b class="on">区分<small>条件で分ける</small></b><b>文字<small>つなぐ・取り出す・空なら</small></b></div>'`) : x))],
  },
  {
    key: "H3", name: "式の欄の下に畳んで置き、式が空のときだけ開く（畳んだところ）",
    css: `.fxh3{display:flex;align-items:center;gap:8px;margin:6px 0;padding:6px 10px;border:1px dashed #b9c9d6;border-radius:8px;background:var(--surface-2);font-size:12.5px;color:var(--h-input);font-weight:700}
      .fxh3 small{font-weight:500;color:var(--muted)}`,
    ops: [["script", `setInterval(() => { const st = document.querySelector('.lc-step[data-step="fx"] #lcFxState'); if (!st || st.parentElement.querySelector(".fxh3")) return;
      st.insertAdjacentHTML("afterend", '<div class="fxh3">▸ 組み立てて作る<small>式に慣れていないときは、選ぶだけで式を作れます（計算・条件で分ける・つなぐ…）</small></div>'); }, 250);`]],
  },
  {
    key: "H4", name: "タブ＋組み立てると式の欄へすぐ入る（式にするを押さない）",
    css: A.css + `.fb-acts{display:none}.fb-out::after{content:"組み立てると、式の欄と一覧にすぐ入ります";flex:0 0 100%;font-size:11.5px;color:var(--muted)}`,
    ops: A.ops,
  },
];
