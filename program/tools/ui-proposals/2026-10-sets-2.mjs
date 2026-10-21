// 2026-10-21 ダッシュボードのセット の 2 回目（1 回目は 6 案とも 80 点に届かず。1 位 E 77.2 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sets-2.mjs --states dash-set,dash-set-pop --from dash   （1536x864・1280x720 でも）
// 1 回目の採点で、どの案にも共通した弱い所は作った物で直した（A に入っている）:
//   面の「外す・左へ・右へ」がどのダッシュボードに効くか書いていない → 「『標準』のタブ ← 左へ 右へ →」「− セットから外す」と名前を出す／
//   札は「共通デフォルト」・面は「標準のセット（開発者）」で言葉が違う → 面も「共通デフォルトのセット」／面の中で、いまのセットに入っている物に印が無い → 「タブ」の印
// 案の方向（新しい案は D・E・F・G）:
//   A 直した作った物
//   B 持ち越し（1 回目 1 位 E）: 面を 2 列（左＝セット・右＝ダッシュボード）
//   C 持ち越し（1 回目 2 位 B）: タブを道具の行の下の段に
//   D 流れ（新）: タブの右端に字の付いた「＋ タブに足す」（面を開かずに、ほかのダッシュボードを足す入口）
//   E まとまり（新）: セットの札とタブを 1 つの枠に入れる（札＝束の名前・タブ＝その中身が一目で 1 つの塊）
//   F 見せ方（新）: 面のセットの行に、中のダッシュボードの名前を小さく並べる（開かずに中身が分かる）
//   G 合わせ（新）: B ＋ E ＋ F
let seq = 0;
const watch = (sel, fn) => { const k = `sx${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const TWO_CSS = `.db-pickpop{width:780px;display:grid;grid-template-columns:1fr 1fr;column-gap:18px;align-content:start}.db-pickpop > *{grid-column:auto}.db-pickpop .db-popsep{display:none}`;
const TWO = watch(".db-pickpop", `(p) => { const kids = [...p.children], i = kids.findIndex((x) => x.classList.contains("db-popsep")); if (i < 0) return;
  const L = document.createElement("div"), R = document.createElement("div"); L.style.cssText = R.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0";
  kids.slice(0, i).forEach((x) => L.append(x)); kids.slice(i + 1).forEach((x) => R.append(x)); p.prepend(L, R); }`);
const BOX_CSS = `.db-tools:has(.db-pick.is-set){}.sx-box{display:inline-flex;align-items:flex-end;gap:6px;padding:3px 8px 0 3px;border:1px solid #c9d3de;border-radius:9px;background:#f6f8fb}.sx-box .db-pick{margin-bottom:3px}.sx-box .db-tabs{border-bottom:0}`;
const BOX = watch("#dashBar .db-pick.is-set", `(b) => { const t = b.nextElementSibling; if (!t || !t.classList.contains("db-tabs")) return; const box = document.createElement("div"); box.className = "sx-box"; b.before(box); box.append(b, t); }`);
const PLUS_CSS = `.sx-plus{height:26px;margin:0 0 3px 6px;padding:0 10px;border:1px dashed #9db5d2;border-radius:6px;background:transparent;color:#24446a;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}`;
const PLUS = watch("#dashBar .db-tabs", `(t) => { if (t.querySelector(".sx-plus")) return; t.insertAdjacentHTML("beforeend", '<button type="button" class="sx-plus" title="ほかのダッシュボードをこのセットのタブに足す">＋ タブに足す</button>'); }`);
const ROW_CSS = `.db-setli{flex-wrap:wrap;height:auto!important;min-height:32px;padding:4px 8px!important;row-gap:1px}.sx-in{flex:1 1 100%;display:block;font-size:11.5px;color:var(--muted);font-weight:400;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
const ROW = watch(".db-pickpop .db-setli", `(b) => { const names = { "現場の朝": "標準・稼働・品種の ABC", "品質の会議": "標準・品種の ABC" }; const n = (b.querySelector("b") || {}).textContent; if (names[n]) b.insertAdjacentHTML("beforeend", '<span class="sx-in">' + names[n] + '</span>'); }`);
export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（操作に名前・言葉を揃える・タブの印）", css: "", ops: [] },
  { key: "B", name: "B 面を 2 列（左＝セット・右＝ダッシュボード）", css: TWO_CSS, ops: [TWO] },
  {
    key: "C", name: "C タブを道具の行の下の段に",
    css: `.sx-row{display:flex;gap:2px;align-items:flex-end;height:32px;border-bottom:2px solid var(--line-soft);margin:0 0 4px}.db-tools > .db-tabs{display:none}`,
    ops: [watch("#dashBar .db-tabs", `(t) => { const bar = document.querySelector("#dashBar"); let row = document.querySelector(".sx-row"); if (!row) { row = document.createElement("div"); row.className = "sx-row"; bar.after(row); } row.innerHTML = t.innerHTML; }`)],
  },
  { key: "D", name: "D タブの右端に「＋ タブに足す」", css: PLUS_CSS, ops: [PLUS] },
  { key: "E", name: "E セットの札とタブを 1 つの枠に", css: BOX_CSS, ops: [BOX] },
  { key: "F", name: "F 面のセットの行に、中のダッシュボードの名前", css: ROW_CSS, ops: [ROW] },
  { key: "G", name: "G 面を 2 列＋札とタブを 1 つの枠＋セットの中身の名前", css: TWO_CSS + BOX_CSS + ROW_CSS, ops: [TWO, BOX, ROW] },
];
