// 2026-10-21 稼働のガントと稼働率・ABC 分析と換算係数 の 2 回目（1 回目は 7 案とも 80 点に届かず。1 位 F 65.1 点）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-ops-2.mjs --states dash-ops --from dash   （1536x864・1280x720 でも）
// 1 回目の採点で、どの案にも共通した減点は作った物の不具合として直した（A に入っている）:
//   パレート図の右の目盛りの % が切れる → 右の余白を広く・A と B の線の字が近ければ上下へ逃がす／1280 で ABC の 3 行目とパレート図が出ない → 表の行を詰め、見出しは 1 段・
//   パレート図は低くても出す／棒の白い字のコントラスト（琥珀 3.4）→ 濃い色の組（4.5 以上）・字 11px／全体の稼働率が足の小さな字 → いちばん上の右に大きく／
//   ガントの色と ABC の色が同じ色で別の意味 → ABC は藍の濃淡（順位）・ガントは藍を使わない／「1.7/24h」が何の割り算か → 列の見出しに「稼働/勤務 h」と説明
// 案の方向（新しい案は C・D・E・F）:
//   A 直した作った物
//   B 持ち越し（1 回目 D）: 棒の字を出さず細い棒
//   C 置き場（新）: 全体の稼働率をパネルの見出しの題の横へ札で（いちばん最初に見る所）
//   D 見せ方（新）: 行を 1 つおきに淡い縞・直の境の線を濃く（どの設備の行か・どの直かを追いやすく）
//   E 減らし方（新）: ABC の設備の札を 1 つの選ぶ欄に（札の段を短く）
//   F 見せ方（新）: 稼働率が低い設備（20% 未満）の名前の前に ▲ の印と琥珀の字（形と色の両方で知らせる）
let seq = 0;
const watch = (sel, fn) => { const k = `oq${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 直した作った物（全体の稼働率を上の右・濃い色の組・ABC は藍の濃淡）", css: "", ops: [] },
  { key: "B", name: "B 持ち越し: 棒の字を出さず細い棒", css: `.og-bl{display:none}`, ops: [watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-bar").forEach((r) => { if (r.dataset.thin) return; r.dataset.thin = 1; const h = +r.getAttribute("height"), y = +r.getAttribute("y"); r.setAttribute("y", y + h * 0.22); r.setAttribute("height", h * 0.56); }); }`)] },
  {
    key: "C", name: "C 全体の稼働率を見出しの題の横へ札で",
    css: `.og-total{display:none}.oq-badge{display:inline-flex;align-items:baseline;gap:6px;margin-left:10px;padding:1px 10px;border-radius:999px;background:#e8f1ef;border:1px solid #b9d4cf;font-size:12px;color:var(--muted);white-space:nowrap}.oq-badge b{font-size:16px;color:var(--ink)}`,
    ops: [watch(".db-p", `(p) => { const t = p.querySelector(".og-total"), h = p.querySelector(".db-ph h3"); if (!t || !h) return; p.querySelector(".oq-badge")?.remove();
      const v = t.querySelector(".og-totv").textContent; h.insertAdjacentHTML("afterend", '<span class="oq-badge">全体の稼働率<b>' + v + '</b></span>'); }`)],
  },
  { key: "D", name: "D 行を 1 つおきに淡い縞・直の境を濃く", css: `.og-row:nth-of-type(even) .og-on{fill:#e3eeec}.og-row:nth-of-type(even) .og-off{opacity:.8}.og-sep{stroke:#8fa9a5;stroke-width:1.2}.og-day{stroke:#5f6f76}`, ops: [] },
  {
    key: "E", name: "E ABC の設備の札を 1 つの選ぶ欄に",
    css: `.oa-tabs{display:none}.oq-sel{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}.oq-sel select{height:26px;font:inherit;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:0 6px}`,
    ops: [watch(".oa-wrap", `(w) => { const tabs = w.querySelector(".oa-tabs"); if (!tabs || w.querySelector(".oq-sel")) return; const opts = [...tabs.querySelectorAll(".oa-tab")].map((b) => '<option' + (b.classList.contains("on") ? " selected" : "") + '>' + b.textContent + '</option>').join("");
      tabs.insertAdjacentHTML("afterend", '<label class="oq-sel">設備<select>' + opts + '</select></label>'); }`)],
  },
  {
    key: "F", name: "F 稼働率が低い設備（20% 未満）に ▲ の印と琥珀の字",
    css: `.oq-low{fill:#8a4b12!important;font-weight:800}`,
    ops: [watch(".og-svg", `(svg) => { svg.querySelectorAll(".og-row").forEach((g) => { const r = g.querySelector(".og-rate"), n = g.querySelector(".og-name"); if (!r || !n || n.dataset.low) return; const v = parseFloat(r.textContent);
      if (!isNaN(v) && v < 20) { n.dataset.low = 1; n.firstChild.textContent = "▲ " + n.firstChild.textContent; n.classList.add("oq-low"); r.classList.add("oq-low"); } }); }`)],
  },
];
