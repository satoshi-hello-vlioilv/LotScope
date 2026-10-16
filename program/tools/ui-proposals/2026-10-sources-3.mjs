// 2026-10 データ元。3 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sources-3.mjs --states master-paths,master-sources,master-sources-edit
// 2 回目（2026-10-sources-2.mjs）の 1 位は B2（84.3 点。合格点 90 に届かず）。採点者が挙げた直す所を本物の画面（今＝B3）に入れた:
//   ①カードに「表」を戻す ②カードのどこを押しても開く（押せる印「変える…」は残す） ③1728 の右の空き → 並びの幅を 1180px まで
//   ④作業実績の状態（表示する設備の台数） ⑤品質データの「既定に戻す」を開いた欄へ（参照先から外したため） ⑥「設備の列（空なら見分けない）」の補足
//   ⑦閉じる手は 1 つ（欄の「閉じる」）
// 案:
//   B3 今のまま（本物の 1 列のカード）
//   Q  状態をカードの左の帯の色でも見せる（写した＝緑・まだ＝灰・届かない＝赤。字はそのまま）
//   R  詰めたカード（幅 980px・「変える…」を場所のすぐ右に・カードの上下の余白を詰める）
//   S  まだ開いていない元に「いま写す」（押すとその場で写して、時刻と行の数を出す）
//   G2 G を直す（1 行の並び〈▶〉。閉じる手は ▶ だけ・長い場所は折り返す）

const css = `
.sr-card.pvQ{border-left-width:5px;padding-left:10px}
.sr-card.pvQ.ok{border-left-color:var(--ok)} .sr-card.pvQ.no{border-left-color:#9aa6b0} .sr-card.pvQ.ng{border-left-color:#c0392b}
.pvR .sr-page{max-width:980px} .pvR .sr-card{padding:8px 12px;grid-template-columns:130px minmax(0,1fr) auto}
.pvS-go{margin-left:4px;height:24px;padding:0 10px;font-size:12px}
.pvG .sr-cards{gap:0;border-top:1px solid var(--line)}
.pvG .sr-card{border:0;border-bottom:1px solid var(--line);border-radius:0;grid-template-columns:20px 140px minmax(0,1fr)}
.pvG .sr-card::before{content:"▶";color:var(--muted);font-size:11px}
.pvG .sr-card.is-open::before{content:"▼"}
.pvG .sr-card .sr-edit{opacity:0;width:1px;min-width:1px;padding:0;border:0;overflow:hidden}
.pvG .sr-card .sr-facts{grid-column:3 / 4}
.pvG .sr-card.is-open [data-sr-close]{display:none}
.pvG .sr-card.is-open{border-left:0;padding-left:14px;background:#f7fafd}
`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const Q = keep(`document.querySelectorAll("#masterSettings .sr-card:not(.pvQ)").forEach((c) => { const st = c.querySelector(".sr-state"); c.classList.add("pvQ", st && st.classList.contains("ok") ? "ok" : st && st.classList.contains("ng") ? "ng" : "no"); });`);
const R = keep(`const b = document.querySelector("#masterSettings"); if (b && !b.classList.contains("pvR")) b.classList.add("pvR");
  document.querySelectorAll("#masterSettings .sr-card:not(.is-open) .sr-edit").forEach((x) => { const w = x.parentElement.querySelector(".sr-where"); if (w && x.previousElementSibling !== w) { w.style.display = "flex"; w.style.gap = "10px"; w.style.alignItems = "center"; w.appendChild(x); } });`);
const S = keep(`document.querySelectorAll("#masterSettings .sr-card .sr-state:not(.ok):not(.ng)").forEach((st) => { if (st.parentElement.querySelector(".pvS-go")) return;
  st.insertAdjacentHTML("afterend", '<button type="button" class="pz-btn pvS-go" title="いま共有のファイルを手元へ写し、時刻と行の数を出します">いま写す</button>'); });`);
const G = keep(`const b = document.querySelector("#masterSettings"); if (b && !b.classList.contains("pvG")) b.classList.add("pvG");`);

export const PROPOSALS = [
  { key: "0", name: "今＝B3（本物の 1 列のカード）", css: "", ops: [] },
  { key: "Q", name: "状態をカードの左の帯の色でも（写した＝緑・まだ＝灰・届かない＝赤。字はそのまま）", css, ops: [Q] },
  { key: "R", name: "詰めたカード（幅 980px・「変える…」を場所のすぐ右・余白を詰める）", css, ops: [R] },
  { key: "S", name: "まだ開いていない元に「いま写す」（その場で写して時刻と行の数を出す）", css, ops: [S] },
  { key: "G2", name: "G を直す: 1 行の並び（▶）。閉じる手は ▶ だけ・長い場所は折り返す", css, ops: [G] },
];
