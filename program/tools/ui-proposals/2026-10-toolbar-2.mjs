// 2026-10 件数の行を 1 段に（2 回目）。1 回目の上位 3 案（F・A・C）と、エッセンスを組み直した複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-toolbar-2.mjs --states crowded [--view 1536x864]
// 1 回目の画像で効いて見えたこと: F の「種類のタブ（数と ▾）」は押す所が種類ごとに決まり、1 段に収まる／B の「名前まで読める」は
// 押さずに何でまとめているかが分かる／C の「2 か所にある物（書式・選んだ値・色付け）を外す」は帯が短くなる／
// どの案も、拡大のつまみ（約 470px）が幅を食い、フル HD で頁送りが切れていた → 拡大を「🔍 100% ▾」に縮め、つまみは押して開く面に
// M2o は M2 で「まとめ」を開いた形（採点の参考。開いた面は件数の行の下に重ね、一覧を押し下げない）

import { BASE, PROPOSALS as R1 } from "./2026-10-toolbar.mjs";

const CROWD = `#llFormatNow,#llSlicerSum,#llMarkSum,#llGroupBar,#llSortBar`;
const ZOOM = `#llZoom .ll-ztrack,#llZoom .ll-zpm,#llZoomStep{display:none!important}
  #llZoom{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 9px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}
  #llZoom::after{content:"▾";font-size:11px;color:var(--muted)}`;
const keep = (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)}); };
setInterval(put, 120); put();`];
const TABS = `.tb-tabs{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);min-width:0;flex:0 1 auto!important}
  .tb-tabs .tb-k{padding:0 10px;font-size:12px;color:var(--muted);font-weight:700;white-space:nowrap}
  .tb-tabs .tb-chip{border:0;border-left:1px solid var(--line);border-radius:0;height:30px;min-width:0;flex:0 1 auto}
  .tb-tabs .tb-chip .tb-el{overflow:hidden;text-overflow:ellipsis}
  .tb-tabs .tb-chip.is-open{box-shadow:inset 0 -3px 0 currentColor}`;
const tab = (cls, n, kind, name, open = false) => `<button class="tb-chip ${cls}${open ? " is-open" : ""}" title="${kind}: ${name}"><span class="tb-n">${n}</span><span class="tb-el">${kind}${name ? ` <b>${name}</b>` : ""}</span><i>▾</i></button>`;
const NAMED = (open = false) => `<span id="tbM" class="tb-tabs"><span class="tb-k">効いている物</span>${tab("tb-lv", 3, "まとめ", "登録日時 › 設備 › 不良名", open)}${tab("tb-so", 1, "並べ替え", "重量 ▼")}`
  + `${tab("tb-sx", 2, "選んだ値", "設備 CR1・L-1")}${tab("tb-mk", 1, "色付け", "不良名 = 汚れ")}</span>`;
const POP = `<div class="tb-pop" style="position:fixed;z-index:60;background:#fff;border:1px solid #cfd9e3;border-radius:10px;box-shadow:0 18px 44px rgba(20,40,60,.22);padding:10px 12px;font-size:13px;width:470px">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><b style="color:#1f5f5a">まとめ（3 段）</b><small style="color:#6b7680">上の段から順に並べ、値が同じ行をまとめます</small></div>
  ${["登録日時", "設備", "不良名"].map((n, i) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid #eef2f5"><b class="tb-n" style="background:#2f7d78">${i + 1}</b><span style="flex:1">${n}</span>`
    + `<span style="display:inline-flex;border:1px solid #cfd9e3;border-radius:6px;overflow:hidden;font-size:12px"><i style="font-style:normal;padding:2px 8px;background:#e6f2ef;font-weight:800">▲ 小さい順</i><i style="font-style:normal;padding:2px 8px">▼ 大きい順</i></span><button class="tb-chip" style="height:24px">×</button></div>`).join("")}
  <div style="display:flex;gap:6px;margin-top:8px"><button class="tb-chip">＋ 段を足す・見せ方</button><button class="tb-chip">全部開く</button><button class="tb-chip">全部畳む</button><span style="flex:1"></span><button class="tb-chip">まとめない</button></div></div>`;
const popAt = ["script", `const go = () => { const t = document.querySelector("#tbM .tb-lv"); if (!t || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150);
  const r = t.getBoundingClientRect(); document.querySelectorAll(".tb-pop").forEach((x) => x.remove());
  document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(POP)}); const p = document.querySelector(".tb-pop"); p.style.left = r.left + "px"; p.style.top = (r.bottom + 6) + "px"; };
  setTimeout(go, 900);`];
const pick = (k) => R1.find((p) => p.key === k);

export const PROPOSALS = [
  pick("now"), pick("F"), pick("A"), pick("C"),
  {
    key: "M1", name: "F＋拡大を「🔍 100% ▾」に縮める（つまみは押して開く面に）",
    css: pick("F").css + ZOOM, ops: pick("F").ops,
  },
  {
    key: "M2", name: "F＋B 種類のタブに名前も（長いときは省略・全部は押して開く面）＋拡大を縮める",
    css: BASE + `${CROWD}{display:none!important}` + TABS + ZOOM, ops: [keep("tbM", NAMED(), "afterend", "#llFresh")],
  },
  {
    key: "M3", name: "A＋C 2 か所にある物を外し、まとめ・並べ替えを 1 つの要約に＋拡大を縮める",
    css: BASE + `${CROWD}{display:none!important}` + ZOOM,
    ops: [keep("tbM3", `<button id="tbM3" class="tb-sum" style="min-width:0">いまの表示 <span class="tb-chip tb-lv"><span class="tb-n">3</span><span class="tb-el">まとめ <b>登録日時 › 設備 › 不良名</b></span></span>`
      + `<span class="tb-chip tb-so"><span class="tb-n">1</span>並べ替え <b>重量 ▼</b></span><i>▾</i></button>`, "afterend", "#llFresh")],
  },
  {
    key: "M4", name: "F＋C タブはまとめ・並べ替えだけ（名前つき）。選んだ値・色付け・書式は上の段の数に任せる＋拡大を縮める",
    css: BASE + `${CROWD}{display:none!important}` + TABS + ZOOM,
    ops: [keep("tbM", `<span id="tbM" class="tb-tabs">${tab("tb-lv", 3, "まとめ", "登録日時 › 設備 › 不良名")}${tab("tb-so", 1, "並べ替え", "重量 ▼")}</span>`, "afterend", "#llFresh")],
  },
  {
    key: "M2o", name: "（参考）M2 で「まとめ」を開いた形（面は一覧に重ね、押し下げない）",
    css: BASE + `${CROWD}{display:none!important}` + TABS + ZOOM, ops: [keep("tbM", NAMED(true), "afterend", "#llFresh"), popAt],
  },
];
