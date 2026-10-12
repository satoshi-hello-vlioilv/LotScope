// 2026-10 ピボット集計（2 回目: 1 回目の上位 3 案＋複合案 4 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pivot-2.mjs --states worklog
// 1 回目: A 81.0・G 77.5・C 72.5（A と G が僅差 → 複合案）。効いて見えたエッセンス:
//   A … 一覧と同じ場所・同じ絞り込みで、広い面に「カラムの札＋文＋表＋グラフ」（異常ロット一覧にも作業実績にも効く）
//   G … 作業実績の右の表に「値（ロット数＋合計）」とグラフを足すだけで、いちばん多い問い（日ごとの実績）がすぐ分かる
//   C … 一覧と集計を並べて見られる（ただし狭く、カラムの札を隠すと思い出させる）
//   F … 列の見出しから、その列での集計へ 1 手で入れる
import { CSS, chartHtml, fieldsHtml, sentenceHtml, tableHtml, PROPOSALS as FIRST } from "./2026-10-pivot.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const keep = (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)}); };
setInterval(put, 150); put();`];
const VIEWTABS = (on = 0) => `<span id="pvmTabs" class="pvm-tabs pv-mock"><b${on === 0 ? ' class="on"' : ""}>一覧</b><b${on === 1 ? ' class="on"' : ""}>集計表・グラフ</b></span>`;
const workPane = (extra = "") => ["script", `
const go = () => { const p = document.querySelector("#llWork"); if (!p || p.hidden || !document.querySelector("#llBody tr[data-i]")) { document.querySelector('#llWorkSwitch [data-wk-mode="day"]')?.click(); return setTimeout(go, 400); }
  if (document.getElementById("pvmG")) return; p.innerHTML = '<div id="pvmG" class="pv-mock" style="display:flex;flex-direction:column;gap:8px">'
   + ${JSON.stringify(`<div style="display:flex;justify-content:space-between;align-items:center"><b>日ごとの実績</b><span class="pvm-sel">新しい順 ▼</span></div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="pvm-w">値</span><span class="pvm-chip v">ロット数</span><span class="pvm-chip v">重量の合計<i>×</i></span><span class="pvm-sel">＋ 足す ▾</span></div>${chartHtml(500, 190, false)}${tableHtml(9)}`)} + ${JSON.stringify(extra)} + '</div>'; };
setTimeout(go, 900);`];
const replaceList = (html) => ["script", `
const go = () => { const w = document.querySelector("#lotListScreen .ll-grid-wrap"); if (!w || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150);
  if (document.getElementById("pvmA")) return; w.style.display = "none";
  w.insertAdjacentHTML("afterend", '<div id="pvmA" class="pv-mock" style="flex:1;min-width:0;min-height:0;padding:0">' + ${JSON.stringify(html)} + '</div>'); };
setTimeout(go, 600);`];
const QUICK = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="pvm-w">すぐに見る:</span><span class="pvm-sel">作業日ごとのロット数・重量</span><span class="pvm-sel">日×直のロット数</span><span class="pvm-sel">重量のヒストグラム</span><span class="pvm-sel">作業者×作業区分の件数</span></div>`;
const M3 = `<div class="pvm-ws">${fieldsHtml()}<div class="pvm-main">${sentenceHtml(false)}<div style="display:flex;gap:8px;align-items:center"><span class="pvm-tabs"><b class="on">時系列</b><b>縦棒</b><b>横棒</b><b>ヒストグラム</b><b>表だけ</b></span><span class="pvm-sp"></span>${QUICK}</div>${chartHtml(1300, 330)}<div class="pvm-out stack">${tableHtml(8)}</div></div></div>`;

export const PROPOSALS = [
  { key: "now", name: "今の作り", css: "", ops: [] },
  pick("A"), pick("G"), pick("C"),
  {
    key: "M1", name: "A＋G: 作業実績の右の表に値（ロット数＋合計）とグラフ、全体の集計は「一覧｜集計表・グラフ」",
    css: CSS + "#llWork{flex-basis:520px!important}", ops: [keep("pvmTabs", VIEWTABS(0), "afterend", "#llCount"),
      workPane('<span class="pvm-sel" style="align-self:flex-start">集計表・グラフで詳しく（この組み方のまま）→</span>')],
  },
  {
    key: "M2", name: "A＋C: 「一覧｜集計表・グラフ｜並べる」（並べると一覧の右に集計）",
    css: CSS + "#llWork{display:none!important}", ops: [keep("pvmTabs", '<span id="pvmTabs" class="pvm-tabs pv-mock"><b>一覧</b><b>集計表・グラフ</b><b class="on">並べる</b></span>', "afterend", "#llCount"),
      ["script", `
const go = () => { const row = document.querySelector("#llBodyRow"); if (!row || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150); if (document.getElementById("pvmC")) return;
  row.insertAdjacentHTML("beforeend", '<aside id="pvmC" class="pv-mock" style="flex:0 0 760px;order:99;display:grid;grid-template-columns:200px 1fr;gap:8px;overflow:hidden">'
   + ${JSON.stringify(`${fieldsHtml(8)}<div style="display:flex;flex-direction:column;gap:8px;min-width:0">${sentenceHtml()}${chartHtml(540, 200)}${tableHtml(8)}</div>`)} + '</aside>'); };
setTimeout(go, 700);`]],
  },
  {
    key: "M3", name: "A＋グラフを上に広く（形の札: 時系列・縦棒・横棒・ヒストグラム・表だけ）＋すぐに見る組み方",
    css: CSS, ops: [keep("pvmTabs", VIEWTABS(1), "afterend", "#llCount"), replaceList(M3)],
  },
  {
    key: "M4", name: "G＋F: 作業実績の右の表に値とグラフ＋列の見出しのメニュー「この列で集計」",
    css: CSS + "#llWork{flex-basis:520px!important}", ops: [workPane(),
      ["script", `
const go = () => { if (!document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150); if (document.getElementById("pvmF")) return;
  document.body.insertAdjacentHTML("beforeend", '<div id="pvmF" class="pv-mock" style="position:fixed;left:560px;top:280px;width:260px;background:#fff;border:1px solid #cfd9e3;border-radius:10px;box-shadow:0 18px 44px rgba(20,40,60,.22);padding:8px;font-size:13px">'
   + '<p style="margin:2px 6px 6px;font-weight:800">作業区分</p><div style="padding:6px 8px">この列を隠す</div><div style="padding:6px 8px">この列でまとめる（1段目に足す）</div><div style="padding:6px 8px;background:#f0f8f7;border-radius:6px;font-weight:800;color:#1d5f5a">▦ この列で集計する…</div><div style="padding:6px 8px;color:#6b7680">幅: 内容に合わせる（自動）</div></div>'); };
setTimeout(go, 900);`]],
  },
];
