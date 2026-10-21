// 2026-10-21 稼働のガントと稼働率・ABC 分析と換算係数 の 3 回目（2 回目は 6 案とも 80 点に届かず。1 位 C 77.9 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops-3.mjs --states dash-ops --from dash   （1536x864・1280x720 でも）
// 2 回目の採点で、どの案にも共通した減点は作った物の不具合として直した（A に入っている）:
//   ABC の足の札「A 2 品種」の A・B の字が地と同じ濃さ（コントラスト 1.6）→ 表の中の印と同じ白い字（.oa-foot b の墨の字が札にも当たっていた）
// 2 回目で低かった所: 1728 で ABC の表の下が大きく空く（整列・余白）／作業の棒・稼働率の細い棒・選んだ札が同じ青緑で別の意味（形と色）／
//   札にすると「稼働 42 時間／勤務 257 時間」の内訳が消える
// 案の方向（新しい案は D・E・F・G）:
//   A 直した作った物
//   B 持ち越し（2 回目 1 位 C）: 全体の稼働率を見出しの題の横へ札で（内訳の時間も添える）
//   C 持ち越し（2 回目 2 位 D）: 行を 1 つおきに淡い縞・直の境を濃く
//   D 合わせ（新）: B の札＋C の縞
//   E 色（新）: 稼働率の細い棒を墨の濃淡に（作業の棒の青緑と分ける。割合は量なので色相を持たせない）
//   F 余白（新）: ABC の品種が少ないときは表の行を高くしてパネルを埋める（1 行 17px → 最大 28px）・パレート図と高さを揃える
//   G 合わせ（新）: D＋E＋F
let seq = 0;
const watch = (sel, fn) => { const k = `or${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const BADGE_CSS = `.og-total{display:none}.or-badge{display:inline-flex;align-items:baseline;gap:6px;margin-left:10px;padding:1px 10px;border-radius:999px;background:#eef1f3;border:1px solid #c9d1d6;font-size:12px;color:var(--muted);white-space:nowrap}.or-badge b{font-size:16px;color:var(--ink)}.or-badge small{font-size:11.5px}`;
const BADGE = watch(".db-p", `(p) => { const t = p.querySelector(".og-total"), h = p.querySelector(".db-ph h3"); if (!t || !h) return; p.querySelector(".or-badge")?.remove();
  const ts = t.querySelectorAll("tspan"); h.insertAdjacentHTML("afterend", '<span class="or-badge">全体の稼働率<b>' + ts[1].textContent + '</b><small>' + ts[2].textContent + '</small></span>'); }`);
const STRIPE_CSS = `.og-row:nth-of-type(even) .og-on{fill:#e3eeec}.og-row:nth-of-type(even) .og-off{opacity:.8}.og-sep{stroke:#8fa9a5;stroke-width:1.2}.og-day{stroke:#5f6f76}`;
const INK_CSS = `.og-rfill{fill:#5b6770}.og-rtrack{fill:#e6e9eb}`;
const FILL_CSS = `.oa-tbl{display:flex;flex-direction:column}.oa-table{flex:0 0 auto}.oa-table tbody td,.oa-table tbody th{height:var(--or-rh,17px)}`;
const FILL = watch(".oa-wrap", `(w) => { const tw = w.querySelector(".oa-tbl"), tb = w.querySelector(".oa-table tbody"), hd = w.querySelector(".oa-table thead"); if (!tw || !tb || !tb.rows.length) return;
  const free = tw.clientHeight - hd.offsetHeight; const rh = Math.max(17, Math.min(28, Math.floor(free / tb.rows.length) - 1)); w.style.setProperty("--or-rh", rh + "px"); }`);
export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（ABC の足の札の字を白に）", css: "", ops: [] },
  { key: "B", name: "B 全体の稼働率を見出しの題の横へ札で（内訳の時間も）", css: BADGE_CSS, ops: [BADGE] },
  { key: "C", name: "C 行を 1 つおきに淡い縞・直の境を濃く", css: STRIPE_CSS, ops: [] },
  { key: "D", name: "D 題の横の札＋縞", css: BADGE_CSS + STRIPE_CSS, ops: [BADGE] },
  { key: "E", name: "E 稼働率の細い棒を墨の濃淡に（作業の棒の青緑と分ける）", css: INK_CSS, ops: [] },
  { key: "F", name: "F ABC の品種が少なければ行を高くしてパネルを埋める", css: FILL_CSS, ops: [FILL] },
  { key: "G", name: "G 札＋縞＋墨の稼働率の棒＋ABC の行を高く", css: BADGE_CSS + STRIPE_CSS + INK_CSS + FILL_CSS, ops: [BADGE, FILL] },
];
