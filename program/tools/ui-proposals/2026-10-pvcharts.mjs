// 2026-10 集計表・グラフ: グラフの形を 5 → 14 に増やしても選びやすい形の選び方と、「すぐに見る」を ID ごとに選べる置き場（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvcharts.mjs --states worklog-pivot,pivot-pick,pivot-quickpick [--view 1536x864]
// 利用者の要望: 「すぐに見る」のプリセットをいくつも登録でき（共通デフォルト＝開発者だけ・共通・ID ごと）、今表示されている所に出す物を
// ユーザーごとに選べる。集計表・グラフの種類を増やし、さらに増えても選びやすい UI に。
// 今の画面（画像で見えたこと）: 形の札が 14 個 1 段に並び、1728 でも「すぐに見る」が 2 段目へ押し出される（フル HD ではさらに段が増える）。
//   14 個の名前を読んで選ぶ（目的のまとまりが無い）。いまの組み方に向く形が分からない。すぐに見るは並べる物を選べない。
// どの案も、グラフ・表・形の中身は本物（版 3.27.0 の 14 形）。案ごとに違うのは、形の選び方・すぐに見るの置き場と選び方だけ。
//
// 方向（何で解くか）: A 置き場＝今の行のまま、目的の区切りを入れた絵つきの札・すぐに見るは下の段
// ／B 見せ方＝形は「絵 時系列 ▾」1 つ、押すと目的ごとの絵の面（向く形に印）・すぐに見るは同じ行
// ／C 減らし方＝いまの組み方に向く形だけを札に（最大 5）、残りは「ほかの形 ▾」・すぐに見るは同じ行
// ／D 流れ＝目的のタブ（推移・比べる・内訳・ばらつき・関係）→ その目的の形の札（2 段）
// ／E 置き場＝左の面を「カラム｜すぐに見る」のタブに（すぐに見るは縦の一覧で ☆ を付けて選ぶ）・形の行は絵つきの札
// 5 案は「形の札をどう並べるか」に寄る → 方向の違う 2 案を足す:
// F 見せ方＝絵だけの札（14 個・選んだ形だけ名前）を 1 段に＋すぐに見るは同じ行（形の数が増えても幅が伸びにくい）
// G 統合＝すぐに見る＝組み方の一覧そのもの（文の頭の「組み方 ▾」をやめ、すぐに見るの札の最後の「すべての組み方 ▾」で選ぶ・保存）・形は目的ごとの選び（▾）

// 案の部品を作る頁の中の道具（window.__pvx）。描き直しで消えたら入れ直す（setInterval）
export const KIT = ["script", `
(() => {
  const C = window.LotListPivotCharts, $ = (s) => document.querySelector(s);
  const P = () => window.LotListPivot && window.LotListPivot.stateOf ? window.LotListPivot.stateOf() : { rows: [], cols: [], measures: [], chart: "time" };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fitInfo = () => { const s = P(), r0 = s.rows[0] || {}; return { rows: s.rows.length, cols: s.cols.length, meas: s.measures.length,
    numMeas: s.measures.filter((m) => m.column).length, addMeas: s.measures.filter((m) => ["count", "lots", "sum"].includes(m.agg)).length,
    additive: !s.measures.length || ["count", "lots", "sum"].includes(s.measures[0].agg), time: r0.column === "@workday" || ["date", "ym", "year", "hour"].includes(r0.part), bin: r0.part === "bin" }; };
  const fits = (d) => !d.fit(fitInfo());
  const chip = (d, opts = {}) => '<button type="button" class="px-chip' + (P().chart === d.k ? " on" : "") + (opts.iconOnly ? " px-ion" : "") + '" title="' + esc(d.n + "\\n" + d.tip) + '">' + C.iconSvg(d.k, 17)
    + (opts.iconOnly && P().chart !== d.k ? "" : "<span>" + d.n + "</span>") + (opts.mark && fits(d) && P().chart !== d.k ? '<i class="px-fit">向く</i>' : "") + "</button>";
  const groups = () => C.GROUPS.map(([g, n]) => ({ g, n, defs: C.DEFS.filter((d) => d.g === g) }));
  const quick = () => [...document.querySelectorAll("#llPivot .pv-bar .pv-quick")].map((b) => b.outerHTML).join("");
  const items = () => (window.LotListPivot._items ? window.LotListPivot._items() : []);
  const pickList = (pins) => { const it = items(), sec = (t, list) => '<p class="px-sec">' + t + "</p>" + list.map((p) => '<label class="px-li"><input type="checkbox"' + (pins.includes(p.id) ? " checked" : "") + ">" + C.iconSvg(p.chart, 15) + "<span>" + esc(p.name) + "</span>" + (pins.includes(p.id) ? '<i class="px-ord">⋮⋮</i>' : "") + "</label>").join("");
    const mine = [{ id: "m1", name: "月ごとの重量（自分）", chart: "column" }, { id: "m2", name: "CR2 の直ごとの重量", chart: "heat" }];
    return sec("自分（taro）", mine) + sec("共通（全員）", [{ id: "c1", name: "設備ごとの不良のパレート図", chart: "pareto" }]) + sec("共通デフォルト（開発者）", it.filter((p) => p.builtin)); };
  const PINS = ["m1", "b:work-day", "b:work-shift", "b:hist", "b:few-pair"];
  const pop = (id, html, anchorSel, w = 520) => { if ($("#" + id)) return; const a = $(anchorSel); if (!a) return; const r = a.getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", '<div id="' + id + '" class="px-pop" style="left:' + Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px;top:" + (r.bottom + 4) + "px;width:" + w + 'px">' + html + "</div>"); };
  const gallery = () => '<div class="px-gal">' + groups().map((x) => '<div class="px-gcol"><p class="px-sec">' + x.n + "</p>" + x.defs.map((d) => '<button type="button" class="px-gi' + (P().chart === d.k ? " on" : "") + '">' + C.iconSvg(d.k, 26)
    + "<span><b>" + d.n + (fits(d) ? ' <i class="px-fit">向く</i>' : "") + "</b><small>" + esc(d.tip.split("。")[0]) + "</small></span></button>").join("") + "</div>").join("") + "</div>";
  const quickPop = () => '<div class="px-phead"><b>すぐに見るに出す組み方</b><small>☑ を付けた物を、この順でグラフの形の行に並べます（自分の ID ごと。⋮⋮ で並べ替え）</small></div>' + pickList(PINS)
    + '<div class="px-pfoot"><button type="button" class="px-link">共通デフォルトに戻す</button><span class="pv-sp"></span><button type="button" class="pv-btn">閉じる</button></div>';
  window.__pvx = { C, P, chip, groups, quick, gallery, quickPop, pop, pickList, PINS, fits, esc, $ };
  /** 案を入れる: build() が HTML を入れる（id の付いた物が消えたら入れ直す）。open(kind) は開いた形を出す */
  window.__pvx.mount = (key, build, open) => { let sig = "";
    setInterval(() => { if (!$("#llPivot .pv-bar")) return; const now = P().chart + "|" + JSON.stringify(P().rows) + "|" + $("#llPivot .pv-bar").childElementCount;
      if (!$("[data-px='" + key + "']") || now !== sig) { document.querySelectorAll("[data-px='" + key + "']").forEach((n) => n.remove()); sig = now; build(); }
      const want = document.body.dataset.uiPick || ""; if (open) open(want); }, 150); };
})();`];

export const CSS = `
  #llPivot .pv-bar .pv-tabs{display:none}
  .px-chip{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font:inherit;font-size:12.5px;font-weight:700;color:var(--h-meta);white-space:nowrap;cursor:pointer}
  .px-chip.on{background:var(--h-input);border-color:var(--h-input);color:#fff}
  .px-chip.px-ion{padding:0 7px}
  .px-seg{display:inline-flex;align-items:center;gap:4px}
  .px-sep{width:1px;height:22px;background:var(--line);margin:0 4px}
  .px-gname{font-size:11px;color:var(--muted);font-weight:700;margin-right:2px;white-space:nowrap}
  .px-fit{font-style:normal;font-size:10.5px;font-weight:800;color:#24615d;background:#e3f2ef;border-radius:999px;padding:1px 6px;margin-left:2px}
  .px-chip.on .px-fit{display:none}
  .px-k{font-size:12px;color:var(--muted);font-weight:700;white-space:nowrap}
  .px-pick{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--h-input);border-radius:8px;background:color-mix(in srgb,var(--h-input) 8%,var(--surface));font:inherit;font-size:13px;font-weight:800;color:var(--h-input);white-space:nowrap}
  .px-pick small{font-weight:400;color:var(--muted);font-size:11.5px}
  .px-edit{height:28px;border:1px dashed var(--line);border-radius:999px;background:transparent;font:inherit;font-size:12px;color:var(--h-input);font-weight:700;padding:0 10px;white-space:nowrap}
  .px-pop{position:fixed;z-index:70;background:var(--surface);border:1px solid var(--pop-line);border-radius:10px;box-shadow:0 18px 44px var(--pop-shadow);padding:10px 12px;font-size:13px;max-height:70vh;overflow:auto}
  .px-gal{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
  .px-gcol{display:flex;flex-direction:column;gap:4px;min-width:0}
  .px-sec{margin:2px 0 4px;font-size:11.5px;font-weight:800;color:var(--h-meta)}
  .px-gi{display:flex;gap:8px;align-items:flex-start;text-align:left;border:1px solid var(--line-soft);border-radius:8px;background:var(--surface);padding:7px 8px;font:inherit;cursor:pointer;color:var(--ink)}
  .px-gi .pv-ico{color:var(--h-input);margin-top:1px}
  .px-gi.on{border-color:var(--h-input);background:color-mix(in srgb,var(--h-input) 9%,var(--surface))}
  .px-gi b{display:block;font-size:12.5px}.px-gi small{display:block;color:var(--muted);font-size:11px;line-height:1.35}
  .px-li{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;font-size:12.5px}
  .px-li:hover{background:var(--surface-2)}
  .px-li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .px-ord{font-style:normal;color:var(--muted);letter-spacing:-2px;cursor:grab}
  .px-phead b{font-size:14px}.px-phead small{display:block;color:var(--muted);font-size:11.5px;margin-bottom:4px}
  .px-pfoot{display:flex;align-items:center;gap:8px;border-top:1px solid var(--line);margin-top:6px;padding-top:8px}
  .px-link{border:0;background:transparent;color:var(--h-input);font:inherit;font-size:12.5px;font-weight:700;text-decoration:underline;padding:0}
  .px-row2{display:flex;align-items:center;gap:6px;flex-wrap:wrap;width:100%}
  .px-tabs{display:inline-flex;border-bottom:1px solid var(--line);gap:2px}
  .px-tabs b{padding:5px 12px;font-size:12.5px;color:var(--muted);cursor:pointer;white-space:nowrap}
  .px-tabs b.on{color:var(--h-input);box-shadow:inset 0 -3px 0 var(--h-input)}
  .px-ftabs{display:flex;border-bottom:1px solid var(--line);margin:-2px 0 6px}
  .px-ftabs b{padding:4px 12px;font-size:13px;color:var(--muted)}
  .px-ftabs b.on{color:var(--h-input);box-shadow:inset 0 -3px 0 var(--h-input)}
  .px-side{display:flex;flex-direction:column;gap:2px}
  .px-side .px-li{border:1px solid var(--line-soft);background:var(--surface)}
  .px-star{color:#b5822a}
`;
export const go = (key, build, open = "") => ["script", `window.__pvx.mount(${JSON.stringify(key)}, () => { const X = window.__pvx; ${build} }, ${open ? `(want) => { const X = window.__pvx; ${open} }` : "null"});`];
export const BAR = `X.$("#llPivot .pv-bar")`;
// すぐに見るの札を、元の行から別の所へ写す（押せる本物は元の場所に残したまま隠す）
export const HIDE_QUICK = `#llPivot .pv-bar > .pv-w, #llPivot .pv-bar > .pv-quick{display:none}`;
export const QUICK_POP = (anchor) => `if (want === "quick") X.pop("pxQ", X.quickPop(), ${JSON.stringify(anchor)}, 460); else X.$("#pxQ")?.remove();`;

export const PROPOSALS = [
  { key: "A", name: "置き場: 今の行のまま、目的の区切りつき絵の札（1 段）・すぐに見るは下の段（✎ 選ぶ）", css: CSS + HIDE_QUICK,
    ops: [KIT, go("A", `${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="A" class="px-seg">' + X.groups().map((g, i) => (i ? '<i class="px-sep"></i>' : "") + g.defs.map((d) => X.chip(d)).join("")).join("") + "</span>");
      ${BAR}.insertAdjacentHTML("afterend", '<div data-px="A" class="px-row2"><span class="px-k">すぐに見る:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxAq">✎ 選ぶ</button></div>');`,
    QUICK_POP("#pxAq"))] },
  { key: "B", name: "見せ方: 形は「絵 時系列 ▾」1 つ → 目的ごとの絵の面（向く印）・すぐに見るは同じ行（✎ 選ぶ）", css: CSS + HIDE_QUICK,
    ops: [KIT, go("B", `const d = X.C.get(X.P().chart) || X.C.DEFS[0];
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="B" class="px-seg"><span class="px-k">グラフ</span><button type="button" class="px-pick" id="pxB">' + X.C.iconSvg(d.k, 18) + d.n + ' ▾<small>14 形</small></button><span class="px-k" style="margin-left:14px">すぐに見る:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxBq">✎ 選ぶ</button></span>');`,
    `if (want === "chart") X.pop("pxBg", X.gallery(), "#pxB", 1100); else X.$("#pxBg")?.remove(); ${QUICK_POP("#pxBq")}`)] },
  { key: "C", name: "減らし方: いまの組み方に向く形だけ札（最大 5）＋「ほかの形 ▾」・すぐに見るは同じ行", css: CSS + HIDE_QUICK,
    ops: [KIT, go("C", `const fit = X.C.DEFS.filter((d) => d.k !== "none" && (X.fits(d) || d.k === X.P().chart)).slice(0, 5);
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="C" class="px-seg"><span class="px-k">向く形</span>' + fit.map((d) => X.chip(d)).join("") + '<button type="button" class="px-chip" id="pxC">ほかの形 ' + (14 - fit.length) + ' ▾</button><span class="px-k" style="margin-left:14px">すぐに見る:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxCq">✎</button></span>');`,
    `if (want === "chart") X.pop("pxCg", X.gallery(), "#pxC", 1100); else X.$("#pxCg")?.remove(); ${QUICK_POP("#pxCq")}`)] },
  { key: "D", name: "流れ: 目的のタブ（推移・比べる・内訳・ばらつき・関係）→ その目的の形の札（2 段）・すぐに見るは右", css: CSS + HIDE_QUICK,
    ops: [KIT, go("D", `const cur = (X.C.get(X.P().chart) || {}).g || "trend", g = X.groups().find((x) => x.g === cur);
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="D" class="px-seg" style="flex-direction:column;align-items:flex-start;gap:6px"><span class="px-tabs">' + X.groups().map((x) => '<b class="' + (x.g === cur ? "on" : "") + '">' + x.n + "</b>").join("") + '</span><span class="px-seg">' + g.defs.map((d) => X.chip(d, { mark: true })).join("") + '</span></span><span data-px="D" class="pv-sp"></span><span data-px="D" class="px-seg"><span class="px-k">すぐに見る:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxDq">✎</button></span>');`,
    QUICK_POP("#pxDq"))] },
  { key: "E", name: "置き場: 左の面を「カラム｜すぐに見る」のタブに（縦の一覧で ☆）・形の行は絵の札", css: CSS + HIDE_QUICK + `#llPivot .pv-fields .pv-cap{display:none}`,
    ops: [KIT, go("E", `${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="E" class="px-seg">' + X.groups().map((g, i) => (i ? '<i class="px-sep"></i>' : "") + g.defs.map((d) => X.chip(d, { iconOnly: true })).join("")).join("") + "</span>");
      const f = X.$("#llPivot .pv-fields"); if (f) f.insertAdjacentHTML("afterbegin", '<div data-px="E" class="px-ftabs"><b>カラム</b><b class="on">すぐに見る 5</b></div><div data-px="E" class="px-side">' + X.pickList(X.PINS).replace(/<input type="checkbox" checked>/g, '<span class="px-star">★</span>').replace(/<input type="checkbox">/g, '<span class="px-star">☆</span>') + "</div>");
      const lst = X.$("#llPivot .pv-list"), srch = X.$("#llPvSearch"); if (lst) lst.style.display = "none"; if (srch) srch.style.display = "none";`)] },
  { key: "F", name: "見せ方: 絵だけの札（14・選んだ形だけ名前）を 1 段＋すぐに見るは同じ行（✎ 選ぶ）", css: CSS + HIDE_QUICK,
    ops: [KIT, go("F", `${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="F" class="px-seg">' + X.groups().map((g, i) => (i ? '<i class="px-sep"></i>' : "") + g.defs.map((d) => X.chip(d, { iconOnly: true })).join("")).join("") + '</span><span data-px="F" class="px-seg" style="margin-left:12px"><span class="px-k">すぐに見る:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxFq">✎</button></span>');`,
    QUICK_POP("#pxFq"))] },
  { key: "G", name: "統合: すぐに見る＝組み方（文の頭の組み方 ▾ をやめ、札の最後の「すべての組み方 ▾」で選ぶ・保存）・形は目的ごとの ▾", css: CSS + HIDE_QUICK + `#llPvPreset{display:none!important}`,
    ops: [KIT, go("G", `const d = X.C.get(X.P().chart) || X.C.DEFS[0];
      ${BAR}.insertAdjacentHTML("afterbegin", '<span data-px="G" class="px-seg"><button type="button" class="px-pick" id="pxG">' + X.C.iconSvg(d.k, 18) + d.n + ' ▾</button><span class="px-k" style="margin-left:14px">組み方:</span>' + X.quick() + '<button type="button" class="px-edit" id="pxGq">すべての組み方・保存 ▾</button></span>');`,
    `if (want === "chart") X.pop("pxGg", '<div class="px-gal" style="grid-template-columns:1fr">' + X.groups().map((x) => '<div class="px-seg" style="flex-wrap:wrap"><span class="px-gname" style="width:84px">' + x.n + "</span>" + x.defs.map((dd) => X.chip(dd, { mark: true })).join("") + "</div>").join("") + "</div>", "#pxG", 620); else X.$("#pxGg")?.remove();
      if (want === "quick") X.pop("pxGq2", X.quickPop().replace("すぐに見るに出す組み方", "組み方（☑＝グラフの形の行に出す）") + '<p class="px-sec">いまの組み方を保存</p><input class="pv-btn" style="width:100%;text-align:left;font-weight:400" value="名前">', "#pxGq", 460); else X.$("#pxGq2")?.remove();`)] },
];
