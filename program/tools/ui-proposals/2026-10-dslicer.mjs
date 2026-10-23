// 2026-10-23 ダッシュボードのスライサーの改良（版 3.52.0。利用者の要望 1・2）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-dslicer.mjs --states dash-slicer --from dash
// 今の画像で見えた問題（sl0-*/dash-slicer-light-now.png）: 期間は決まった札（今日・前日・直近 7 日・今月・先月）と月の ◀ ▶ だけで、
//   「10/15 の日」「10/1〜10/20」のような日付を選べない・スライサーの帯はいつも出ていて消せない・何を出すかを替えられない・
//   列の値（仕掛区分・品種など）で絞るスライサーが無い（パネルの「絞る」はそのパネルだけ）
// 土台（全案）: 帯のスライサーは ダッシュボードごとに ON/OFF と出す物（期間・設備）を持つ（保存する）。日付は期間 range（from〜to）で、どのパネルにも効く。
//   パネルのスライサーは、列の値の札を押すと、同じ列を持つ全部のパネルを絞る（選んだ値はこの PC で覚える）
// 案の方向（日付の選び方 × ON/OFF・編集の置き場 × パネルのスライサーの見せ方）:
//   A 札「日付…」→ 暦の面で日・期間／帯の右端の ⚙（出す物・OFF）／パネルのスライサー＝縦の値の札（Excel のスライサーの型・件数の棒）
//   B 帯に日付の欄（10/1 〜 10/23）をそのまま／帯の左端のスイッチ（ON/OFF）と「編集」／パネルのスライサー＝折り返す値の札
//   C 札「日付…」と ◀ 日 ▶（1 日ずつ送る）／道具の行の「スライサー ▾」1 つに畳み、面の中で ON/OFF・出す物／パネルのスライサー＝チェックの並び
//   D 期間の札の中に「日付を選ぶ ▾」（暦）／編集のときだけ帯の各部に × と「＋ スライサー」／パネルのスライサー＝値の札＋検索
//   E 帯をパネルの上の段（グリッドの 1 行目）に置くスライサーのパネルにする／帯は OFF にできる／列のスライサーも同じ形で並べる
export let seq = 0;
export const watch = (sel, fn) => { const k = `dz${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const VALS = [["生産", 191], ["保留", 59], ["再処理", 41], ["出荷待ち", 36], ["検査待ち", 29]];
export const BASE = `.mk-date{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:1px solid #9db6cc;border-radius:999px;background:#fff;font-size:13px;color:#1f3f60;white-space:nowrap}
  .mk-date input{width:92px;height:22px;border:1px solid var(--edit-line,#c9d3dc);border-radius:5px;background:var(--edit-field,#fffdf6);font:12.5px ui-monospace,Consolas,monospace;padding:0 4px}
  .mk-gear{width:30px;height:28px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:15px;color:#41525f}
  .mk-sw{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#41525f;white-space:nowrap}.mk-sw i{width:30px;height:16px;border-radius:999px;background:#2f7d78;position:relative}.mk-sw i::after{content:"";position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff}
  .mk-ed{height:28px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:12.5px;color:#1f3f60}
  .mk-pop{position:absolute;z-index:50;background:#fff;border:1px solid #c7d3de;border-radius:10px;box-shadow:0 10px 30px rgba(20,40,60,.18);padding:12px;font-size:13px;color:var(--ink)}
  .mk-cal{display:grid;grid-template-columns:repeat(7,30px);gap:2px;text-align:center;font-size:12px}.mk-cal b{color:#5b6872;font-weight:600}.mk-cal span{height:26px;line-height:26px;border-radius:6px}
  .mk-cal .in{background:#dbe8f3}.mk-cal .end{background:#24446a;color:#fff;font-weight:700}
  .mk-sp{display:flex;flex-direction:column;height:100%;padding:10px 14px;gap:6px}.mk-sph{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:var(--ink)}
  .mk-sph small{font-weight:400;color:#5b6872;font-size:12px}.mk-sph .mk-x{margin-left:auto;font-size:12px;color:#1f5e8a;font-weight:400}
  .mk-vals{display:flex;flex-direction:column;gap:4px;overflow:hidden}.mk-v{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;height:26px;padding:0 10px;border:1px solid #c9d6e2;border-radius:7px;background:#fff;font-size:13px;position:relative;overflow:hidden}
  .mk-v.on{background:#24446a;border-color:#24446a;color:#fff}.mk-v i{position:absolute;left:0;bottom:0;height:3px;background:#9db6cc}.mk-v.on i{background:#8fb3d6}
  .mk-wrap{display:flex;flex-wrap:wrap;gap:6px}.mk-c{height:26px;padding:0 10px;border:1px solid #c9d6e2;border-radius:999px;background:#fff;font-size:13px}.mk-c.on{background:#24446a;border-color:#24446a;color:#fff}.mk-c small{opacity:.75;margin-left:4px}
  .mk-ck{display:flex;align-items:center;gap:8px;font-size:13px;height:22px}.mk-ck em{margin-left:auto;font-style:normal;color:#5b6872;font-variant-numeric:tabular-nums}
  .mk-srch{height:26px;border:1px solid var(--edit-line,#c9d3dc);border-radius:7px;background:var(--edit-field,#fffdf6);padding:0 8px;font-size:12.5px}
  .mk-ex{display:inline-flex;align-items:center;gap:4px;margin-left:2px}.mk-ex b{font-size:11px;color:#a5372c;cursor:pointer}
  .mk-add{height:28px;padding:0 10px;border:1px dashed #8aa0b6;border-radius:8px;background:#fff;font-size:12.5px;color:#1f3f60}`;
// 帯の「先月」の右（月の送り）の後ろに差し込む
export const afterMonth = (html) => watch(".ds-bar .ds-month", `(m) => m.insertAdjacentHTML("afterend", ${JSON.stringify(html)})`);
export const barEnd = (html) => watch(".ds-bar", `(b) => b.insertAdjacentHTML("beforeend", ${JSON.stringify(html)})`);
export const barStart = (html) => watch(".ds-bar", `(b) => b.insertAdjacentHTML("afterbegin", ${JSON.stringify(html)})`);
// 「仕掛区分ごとの仕掛ロット数」のパネル（左の背の高いパネル）をスライサーのパネルに見立てる（1 段のパネルでは札が潰れた: 自分で見た 1 回目の崩れ）
export const panel = (inner) => watch('#dashGrid .db-p[data-id="wipClass"]', `(p) => { p.innerHTML = ${JSON.stringify(inner)}; p.style.overflow = "hidden"; }`);
// 日付を選んだ形: 期間の札・月の送りの「選んでいる」印を外す（日付と先月が両方選ばれて見えた: 自分で見た 1 回目の崩れ）
export const datePicked = watch(".ds-bar [data-ds-period].on, .ds-bar .ds-month.on", `(e) => { e.classList.remove("on"); e.setAttribute("aria-pressed", "false"); }`);
const vlist = `<div class="mk-sp"><div class="mk-sph">仕掛区分<small>スライサー・全パネルに効く</small><a class="mk-x">× 選びを外す</a></div><div class="mk-vals">${VALS.map(([v, n], i) => `<span class="mk-v${i === 1 ? " on" : ""}"><span>${v}</span><span>${n}</span><i style="width:${Math.round(n / 191 * 100)}%"></i></span>`).join("")}</div></div>`;
const vwrap = `<div class="mk-sp"><div class="mk-sph">仕掛区分<small>で絞る</small><a class="mk-x">× 外す</a></div><div class="mk-wrap">${VALS.map(([v, n], i) => `<span class="mk-c${i === 1 ? " on" : ""}">${v}<small>${n}</small></span>`).join("")}</div></div>`;
const vck = `<div class="mk-sp"><div class="mk-sph">仕掛区分<small>1 / 5 を選んでいます</small></div>${VALS.map(([v, n], i) => `<label class="mk-ck"><input type="checkbox"${i === 1 ? " checked" : ""}>${v}<em>${n}</em></label>`).join("")}</div>`;
const vsearch = `<div class="mk-sp"><div class="mk-sph">仕掛区分<small>スライサー</small><a class="mk-x">× 外す</a></div><input class="mk-srch" placeholder="値を検索"><div class="mk-wrap">${VALS.map(([v, n], i) => `<span class="mk-c${i === 1 ? " on" : ""}">${v}<small>${n}</small></span>`).join("")}</div></div>`;
const cal = `<div class="mk-pop" style="top:150px;left:560px"><div style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><b>2026年10月</b><span style="margin-left:auto">◀ ▶</span></div><div class="mk-cal">${"日月火水木金土".split("").map((d) => `<b>${d}</b>`).join("")}${"<span></span>".repeat(4)}${Array.from({ length: 31 }, (_, i) => `<span class="${i + 1 === 5 || i + 1 === 20 ? "end" : i + 1 > 5 && i + 1 < 20 ? "in" : ""}">${i + 1}</span>`).join("")}</div><div style="margin-top:8px;display:flex;gap:6px;align-items:center"><span class="mk-date"><input value="2026-10-05">〜<input value="2026-10-20"></span><button class="mk-ed">当てる</button></div></div>`;
export const PROPOSALS = [
  { key: "A", name: "A 札「日付…」で暦の面／帯の右端の ⚙／パネルのスライサーは縦の値の札（件数の棒）", css: BASE,
    ops: [datePicked, afterMonth(`<button class="ds-chip on" title="日・期間を選ぶ">10/5〜10/20</button>`), barEnd(`<button class="mk-gear" title="スライサーを編集（出す物・OFF）">⚙</button>`), panel(vlist),
      ["script", `setTimeout(() => document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(cal)}), 50)`]] },
  { key: "B", name: "B 帯に日付の欄（から〜まで）をそのまま／左端のスイッチと「編集」／パネルのスライサーは折り返す値の札", css: BASE,
    ops: [datePicked, afterMonth(`<span class="mk-date">日付<input value="2026-10-05">〜<input value="2026-10-20"></span>`), barStart(`<span class="mk-sw"><i></i>スライサー</span>`), barEnd(`<button class="mk-ed">編集</button>`), panel(vwrap)] },
  { key: "C", name: "C ◀ 日 ▶ で 1 日ずつ送る＋日付…／道具の行の「スライサー ▾」1 つに畳む／パネルのスライサーはチェックの並び", css: BASE + `.ds-bar{display:none!important}.db-when::after{content:"スライサー: 10/20（◀ 日 ▶）・L ライン ▾";display:inline-flex;align-items:center;height:28px;margin-left:10px;padding:0 10px;border:1px solid #9db6cc;border-radius:8px;background:#fff;font-size:12.5px;color:#1f3f60;vertical-align:middle}`,
    ops: [panel(vck)] },
  { key: "D", name: "D 期間の札の中に「日付を選ぶ ▾」／編集のときだけ帯の各部に × と「＋ スライサー」／パネルのスライサーは値の札＋検索", css: BASE,
    ops: [datePicked, afterMonth(`<button class="ds-chip on">日付を選ぶ ▾ 10/5〜10/20</button>`), watch(".ds-bar .ds-l", `(l) => l.insertAdjacentHTML("afterend", '<span class="mk-ex"><b title="この部分を外す">×</b></span>')`),
      barEnd(`<button class="mk-add">＋ スライサー</button>`), panel(vsearch)] },
  { key: "E", name: "E 帯は OFF にでき、スライサーはグリッドのパネルとして並べる（期間・設備・列の値を同じ形で）", css: BASE + `.ds-bar{opacity:.35}`,
    ops: [barStart(`<span class="mk-sw" style="opacity:1"><i style="background:#9aa6b0"></i>帯 OFF</span>`), panel(`<div class="mk-sp"><div class="mk-sph">期間<small>スライサー</small></div><div class="mk-wrap"><span class="mk-c">今日</span><span class="mk-c">前日</span><span class="mk-c">今月</span><span class="mk-c on">10/5〜10/20</span></div><div class="mk-sph" style="margin-top:6px">仕掛区分</div><div class="mk-wrap">${VALS.map(([v, n], i) => `<span class="mk-c${i === 1 ? " on" : ""}">${v}<small>${n}</small></span>`).join("")}</div></div>`)] },
];
