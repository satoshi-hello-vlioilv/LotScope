// 2026-10-22 値の計算に桁の指定（版 3.50.1。利用者の要望）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvdec.mjs --states worklog-pivot-calc --from worklog
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvdec.mjs --states dash-panel --from dash
// 今の画像で見えた問題: ÷1000 を当てた後の表の数が「17.982」「22.38」「20.36」と桁がそろわず、縦に読みにくい。段に桁を決める所が無い
// 土台（全案）: 桁は値ごと（measures の dec）。値は丸めず、表・グラフ・数字のパネル・Excel の表示形式だけをその桁にそろえる。
//   案の画像は、重量の合計を「1 桁」にした所（表の数も 1 桁で再現する）。案は「桁を決める操作の形と置き場」を変える
// 案の方向:
//   A 小数の選び（▾ 自動・整数・1 桁・2 桁・3 桁）を計算の欄のすぐ横に … 慣れた型（選ぶ箱）
//   B Excel の「小数点以下の表示桁数を増やす・減らす」と同じ 2 つの札（←.0 ・.00→）と、いまの桁の字 … Excel の型
//   C 桁の札（自動・整数・.0・.00・.000）を並べて 1 つ選ぶ（押した札が点く）… 見える選び（隠れない）
//   D 数を入れる欄（小数 [1] 桁。上下の矢印でも）… 打つ
//   E いまの総計を各桁で書いた見本（972｜972.4｜972.37｜972.365）から選ぶ … 結果で選ぶ（直接さわる）
let seq = 0;
const watch = (sel, fn) => { const k = `pq${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
// 桁を決めた値（一覧: 重量・ダッシュボード: ロット数）。表の数もその桁で再現（一覧の重量の列）
const ON = `(it) => /重量|ロット数/.test((it.querySelector(".pc-name") || {}).textContent || "") && (it.closest("#llPivot") ? /重量/.test(it.textContent) : true)`;
const DEC = `(it) => (it.closest("#dbEditor") ? 0 : 1)`;
const TABLE = watch("#llPivot .pv-table tbody tr", `(tr) => { const tds = tr.querySelectorAll("td"); const td = tds[tds.length - 1]; if (!td) return; const v = parseFloat(td.textContent.replace(/,/g, "")); if (Number.isFinite(v)) td.textContent = v.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }`);
const BASE = `.mk-l{color:var(--muted);font-size:12px}.mk-sel{height:26px;border:1px solid var(--edit-line,#c9d3dc);border-radius:7px;background:var(--edit-field,#fffdf6);font:inherit;font-size:12.5px;padding:0 4px}
  .mk-b{height:24px;min-width:34px;padding:0 6px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:12px ui-monospace,Consolas,monospace;color:var(--ink);cursor:pointer}
  .mk-seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}.mk-seg button{height:24px;padding:0 8px;border:0;border-left:1px solid var(--line);background:var(--surface);font:12px ui-monospace,Consolas,monospace;color:var(--ink)}
  .mk-seg button:first-child{border-left:0}.mk-seg button.on{background:var(--pv-val);color:#fff}
  .mk-num{width:44px;height:26px;border:1px solid var(--edit-line,#c9d3dc);border-radius:7px;background:var(--edit-field,#fffdf6);font:13px ui-monospace,Consolas,monospace;text-align:center}
  .mk-now{font-size:12px;color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}`;
const after = (html) => `(it) => { const on = (${ON})(it); const d = (${DEC})(it); const out = it.querySelector(".pc-out"); (out || it).insertAdjacentHTML(out ? "afterend" : "beforeend", (${html})(on, d)); }`;
export const PROPOSALS = [
  {
    key: "A", name: "A 小数の選び（▾）を計算の欄の横に",
    css: BASE, ops: [TABLE, watch("#llPivot .pc-item, #dbEditor .pc-item", after(`(on, d) => '<span class="mk-l">小数</span><select class="mk-sel" aria-label="小数の桁"><option' + (on ? '' : ' selected') + '>自動</option><option' + (on && d === 0 ? ' selected' : '') + '>整数</option><option' + (on && d === 1 ? ' selected' : '') + '>1 桁</option><option>2 桁</option><option>3 桁</option></select>'`))],
  },
  {
    key: "B", name: "B Excel と同じ「桁を減らす・増やす」の 2 つの札",
    css: BASE, ops: [TABLE, watch("#llPivot .pc-item, #dbEditor .pc-item", after(`(on, d) => '<span class="mk-l">小数</span><button class="mk-b" title="小数の桁を減らす">←.0</button><span class="mk-now">' + (on ? d + ' 桁' : '自動') + '</span><button class="mk-b" title="小数の桁を増やす">.00→</button>'`))],
  },
  {
    key: "C", name: "C 桁の札（自動・整数・.0・.00・.000）を並べて 1 つ選ぶ",
    css: BASE, ops: [TABLE, watch("#llPivot .pc-item, #dbEditor .pc-item", after(`(on, d) => '<span class="mk-l">小数</span><span class="mk-seg" role="radiogroup" aria-label="小数の桁">' + [["自動", null], ["整数", 0], [".0", 1], [".00", 2], [".000", 3]].map(([t, k]) => '<button class="' + ((on ? k === d : k === null) ? 'on' : '') + '">' + t + '</button>').join("") + '</span>'`))],
  },
  {
    key: "D", name: "D 数を入れる欄（小数 [1] 桁）",
    css: BASE, ops: [TABLE, watch("#llPivot .pc-item, #dbEditor .pc-item", after(`(on, d) => '<span class="mk-l">小数</span><input class="mk-num" type="number" min="0" max="6" placeholder="自動" value="' + (on ? d : '') + '" aria-label="小数の桁"><span class="mk-l">桁</span>'`))],
  },
  {
    key: "E", name: "E いまの総計を各桁で書いた見本から選ぶ",
    css: BASE + `.mk-seg button{font-variant-numeric:tabular-nums}`,
    ops: [TABLE, watch("#llPivot .pc-item, #dbEditor .pc-item", after(`(on, d) => { const g = [...document.querySelectorAll("#llPivot .pv-table tr.is-grand td")].map((t) => parseFloat(t.textContent.replace(/,/g, "")));
        const base = it.closest("#dbEditor") ? 1200 : on ? 972.3654 : (g[0] || 39); const xs = [["自動", null]].concat([0, 1, 2, 3].map((k) => [base.toLocaleString("ja-JP", { minimumFractionDigits: k, maximumFractionDigits: k }), k]));
        return '<span class="mk-l">表示</span><span class="mk-seg" role="radiogroup" aria-label="小数の桁（見本）">' + xs.map(([t, k]) => '<button title="' + (k == null ? "自動" : k + " 桁") + '" class="' + ((on ? k === d : k === null) ? 'on' : '') + '">' + t + '</button>').join("") + '</span>'; }`))],
  },
];
