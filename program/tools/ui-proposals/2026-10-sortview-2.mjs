// 2026-10 並べ替えの見え方・外し方と、条件＋並べ替えの保存（2 回目: 1 回目の上位 3 案＋複合案 4 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sortview-2.mjs --states sorted,headers
// 1 回目: A 83.0・F 76.5・B 71.5（A と F が僅差 → 複合案）。効いて見えたエッセンス:
//   A … 件数の行の並べ替えの札（まとめの段の札と同じ所・同じ形。× で 1 押しで外す）と、プリセットに入れて保存する（入口を増やさない）
//   F … 保存した物が見えていて 1 押しで切り替わる（ただし帯のぶん一覧が 1 行下がる）
//   C … 見出しの番号の札（どの列で何番目に並べているかが、列の所で分かる）
//   E … 保存した物に「何が入っているか」（条件 1・並べ替え 2・まとめ…）を札で見せる
//   G … 1 つ前に戻す（試した並べ替え・条件を気軽に戻せる）
import { BASE, keep, pop, CHIPS, VIEWS, SAVE, PROPOSALS as FIRST } from "./2026-10-sortview.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const HEAD_BADGE = `#llHead th[data-sort]{box-shadow:inset 0 -4px 0 #6b84d6}
  #llHead th[data-sort="desc"]::after,#llHead th[data-sort="asc"]::after{display:inline-grid;place-items:center;margin-left:4px;padding:0 5px;height:18px;border-radius:5px;background:#e6ecfa;color:#30447f;font-size:11px;font-weight:800}
  #llHead th[data-sort="desc"]::after{content:"①▼"}#llHead th[data-sort="asc"]::after{content:"②▲"}`;
const WHAT = `<div class="sv-what"><i>条件 1</i><i>並べ替え 2</i><i>まとめ なし</i><i>スライサー なし</i></div>`;
const PRESET_POP = (extra = "") => pop(`<h5>プリセット<small>押すと、条件と並べ替えがその形に入れ替わります</small></h5><div class="sv-row"><i class="sv-mark"></i><span><b>なし</b></span></div>${VIEWS()}${extra}<div class="sv-sep"></div>${SAVE("条件と並べ替え")}`, "#llPresetBtn");

export const PROPOSALS = [
  { key: "now", name: "今の作り", css: "", ops: [] },
  pick("A"), pick("F"), pick("B"),
  {
    key: "M1", name: "A＋C: 件数の行の札＋見出しの番号の札＋プリセットに保存",
    css: BASE + HEAD_BADGE, ops: [keep("svSortBar", CHIPS, "beforebegin", "#llGroupBar"), PRESET_POP()],
  },
  {
    key: "M2", name: "A＋E: 件数の行の札＋プリセットに保存（入っている物を札で見せる・まとめとスライサーも）",
    css: BASE, ops: [keep("svSortBar", CHIPS, "beforebegin", "#llGroupBar"), PRESET_POP(`<h5 style="margin-top:8px">いまの形<small>保存すると入る物</small></h5>${WHAT}`)],
  },
  {
    key: "M3", name: "A＋F: 件数の行の札＋プリセットのボタンの横に保存した物を 3 つまで札で（1 押しで切り替え）",
    css: BASE + `.sv-quick{display:inline-flex;gap:4px;align-items:center}.sv-q{height:30px;padding:0 10px;border:1px solid #cfd9e3;border-radius:999px;background:#fff;font-weight:700;font-size:12px;font-family:inherit}
      .sv-q.is-cur{background:#2f7d78;border-color:#2f7d78;color:#fff}`,
    ops: [keep("svSortBar", CHIPS, "beforebegin", "#llGroupBar"),
      keep("svQuick", `<span id="svQuick" class="sv-quick"><button class="sv-q is-cur">不良あり・重い順</button><button class="sv-q">CR1 の今月</button><button class="sv-q">検査待ち</button></span>`, "afterend", "#llPresetBtn")],
  },
  {
    key: "M4", name: "A＋G: 件数の行の札＋「1 つ前に戻す」＋プリセットに保存",
    css: BASE, ops: [keep("svSortBar", CHIPS.replace('<button class="sv-btn">並べ替えを外す</button>', '<button class="sv-btn">並べ替えを外す</button><button class="sv-btn" title="1 つ前の条件・並べ替えに戻す">↶ 戻す</button>'), "beforebegin", "#llGroupBar"), PRESET_POP()],
  },
];
