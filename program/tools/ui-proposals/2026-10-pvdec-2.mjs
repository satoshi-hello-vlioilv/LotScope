// 2026-10-22 値の計算に桁の指定の 2 回目（版 3.50.1）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvdec-2.mjs --states worklog-pivot-calc --from worklog
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvdec-2.mjs --states dash-panel --from dash
// 1 回目（2026-10-pvdec.json）: 1 位 A（小数の選び ▾）78.6 点で届かず。指摘: 変えるのに 2 手・桁が字だけで形で見えない・計算と桁のまとまりが分かれにくい・
//   見本「972,365.3 → 972.365」が決めた桁と食い違う（全案）。C・E は札が横に長く、ダッシュボードの狭い組む所で切れる。C の選んだ札の色が計算の札と同じ
// 2 回目の土台（全案）: 変わり方の見本も決めた桁で書く（972,365.3 → 972.4）
// 案の方向:
//   A2 A を持ち越し、選びは段の後ろ（よく使う札の右）に、区切りの線と「表示」の言葉を前に（計算と桁のまとまりを分ける）
//   H  選び（▾）の中と閉じた字に、実際の総計をその桁で書いた見本（自動 972.365・整数 972・1 桁 972.4 …）。新しい
//   C2 桁の札を残し、選んだ札は濃い灰（計算の茶と分ける）。よく使う計算は「よく使う ▾」1 つに畳んで幅を空ける。新しい（C の手直し）
//   G  結果の数のすぐ横に −／＋ の札と「1 桁」の字（数を見ながら 1 手ずつ）。新しい
//   K  結果の数の札そのもの（「972,365.3 → 972.4 ▾」）を押して桁を選ぶ（結果を直接さわる。札 1 つ）。新しい
let seq = 0;
const watch = (sel, fn) => { const k = `pr${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const ON = `(it) => /重量|ロット数/.test((it.querySelector(".pc-name") || {}).textContent || "") && (it.closest("#llPivot") ? /重量/.test(it.textContent) : true)`;
const DEC = `(it) => (it.closest("#dbEditor") ? 0 : 1)`;
// 値の総計（重量 ÷1000 は 972.3654・ロット数は表の総計・ダッシュボードは 1,200）
const TOTAL = `(it, on) => { if (it.closest("#dbEditor")) return 1200; if (on) return 972.3654; const g = [...document.querySelectorAll("#llPivot .pv-table tr.is-grand td")].map((t) => parseFloat(t.textContent.replace(/,/g, ""))); return g[0] || 39; }`;
const F = (v, k) => `(${v}).toLocaleString("ja-JP", { minimumFractionDigits: ${k}, maximumFractionDigits: ${k} })`;
const TABLE = watch("#llPivot .pv-table tbody tr", `(tr) => { const tds = tr.querySelectorAll("td"); const td = tds[tds.length - 1]; if (!td) return; const v = parseFloat(td.textContent.replace(/,/g, "")); if (Number.isFinite(v)) td.textContent = v.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }`);
// 変わり方の見本を決めた桁で（全案）
const PREV = watch("#llPivot .pc-prev", `(p) => { if (!/→/.test(p.textContent)) return; const parts = p.innerHTML.split("</i>"); if (parts.length === 2) p.innerHTML = parts[0] + "</i>" + (972.3654).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }`);
const BASE = `.mk-l{color:var(--muted);font-size:12px;white-space:nowrap}.mk-div{width:1px;align-self:stretch;margin:2px 2px;background:#e2cfa6}
  .mk-sel{height:26px;border:1px solid var(--edit-line,#c9d3dc);border-radius:7px;background:var(--surface);font:inherit;font-size:12.5px;padding:0 4px;color:var(--ink)}
  .mk-seg{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden;flex:none}.mk-seg button{height:24px;padding:0 7px;border:0;border-left:1px solid var(--line);background:var(--surface);font:12px ui-monospace,Consolas,monospace;color:var(--ink)}
  .mk-seg button:first-child{border-left:0}.mk-seg button.on{background:#41525f;color:#fff}
  .mk-step{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:var(--surface);flex:none}
  .mk-step button{width:24px;height:24px;border:0;background:var(--surface);font-size:14px;font-weight:700;color:var(--ink)}.mk-step b{padding:0 6px;font-size:12px;border-left:1px solid var(--line);border-right:1px solid var(--line);line-height:24px;white-space:nowrap}
  .mk-more{height:24px;padding:0 8px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:12px;color:var(--ink);white-space:nowrap}
  .mk-kp{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 6px 0 10px;border:1px solid #9fd0c9;border-radius:999px;background:var(--ll-pale);color:var(--ll-teal-dark);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .mk-kp i{font-style:normal;font-weight:400;color:#56616b}.mk-kp em{font-style:normal;font-size:10.5px;padding:0 4px;border-radius:4px;background:#fff;color:var(--ll-teal-dark);border:1px solid #9fd0c9}`;
const out = (fn) => watch("#llPivot .pc-item, #dbEditor .pc-item", `(it) => { const on = (${ON})(it); const d = (${DEC})(it); const T = (${TOTAL})(it, on); const o = it.querySelector(".pc-out"); (${fn})(it, o, on, d, T); }`);
export const PROPOSALS = [
  {
    key: "A2", name: "A2 小数の選び（▾）を区切りの線と「表示」の後ろに",
    css: BASE, ops: [TABLE, PREV, out(`(it, o, on, d) => { (it.querySelector(".pc-qs") || o || it).insertAdjacentHTML("afterend", '<span class="mk-div"></span><span class="mk-l">表示 小数</span><select class="mk-sel" aria-label="小数の桁"><option' + (on ? '' : ' selected') + '>自動</option><option' + (on && d === 0 ? ' selected' : '') + '>整数</option><option' + (on && d === 1 ? ' selected' : '') + '>1 桁</option><option>2 桁</option><option>3 桁</option></select>'); }`)],
  },
  {
    key: "H", name: "H 選び（▾）に実際の総計をその桁で書いた見本",
    css: BASE, ops: [TABLE, PREV, out(`(it, o, on, d, T) => { const opt = (t, k, sel) => '<option' + (sel ? ' selected' : '') + '>' + t + '　' + ${F("T", "k")} + '</option>';
        (it.querySelector(".pc-qs") || o || it).insertAdjacentHTML("afterend", '<span class="mk-div"></span><span class="mk-l">表示</span><select class="mk-sel" aria-label="小数の桁">' + '<option' + (on ? '' : ' selected') + '>自動</option>' + opt("整数", 0, on && d === 0) + opt("1 桁", 1, on && d === 1) + opt("2 桁", 2, false) + opt("3 桁", 3, false) + '</select>'); }`)],
  },
  {
    key: "C2", name: "C2 桁の札（選んだ札は濃い灰）＋よく使う計算は「よく使う ▾」1 つに",
    css: BASE + `.pc-qs{display:none!important}`,
    ops: [TABLE, PREV, out(`(it, o, on, d) => { (o || it).insertAdjacentHTML("afterend", '<button class="mk-more" title="よく使う計算（÷1000・×100・÷60）">よく使う ▾</button><span class="mk-div"></span><span class="mk-l">小数</span><span class="mk-seg" role="radiogroup" aria-label="小数の桁">' + [["自動", null], ["整数", 0], [".0", 1], [".00", 2]].map(([t, k]) => '<button class="' + ((on ? k === d : k === null) ? 'on' : '') + '">' + t + '</button>').join("") + '</span>'); }`)],
  },
  {
    key: "G", name: "G 結果の数の横に −／＋ の札と「1 桁」の字",
    css: BASE, ops: [TABLE, PREV, out(`(it, o, on, d) => { (o || it).insertAdjacentHTML("afterend", '<span class="mk-step" role="group" aria-label="小数の桁"><button title="小数の桁を減らす">−</button><b>' + (on ? (d === 0 ? '整数' : d + ' 桁') : '自動') + '</b><button title="小数の桁を増やす">＋</button></span>'); }`)],
  },
  {
    key: "K", name: "K 結果の数の札そのものを押して桁を選ぶ（▾）",
    css: BASE, ops: [TABLE, out(`(it, o, on, d, T) => { const hasCalc = !!it.querySelector(".pc-prev"); const to = ${F("T", "on ? d : 3")}.replace(/\\.?0+$/, on ? "" : ""); const shown = on ? ${F("T", "d")} : (Number.isInteger(T) ? T.toLocaleString("ja-JP") : ${F("T", "3")});
        const chip = '<button class="mk-kp" title="押すと小数の桁を選べます（自動・整数・1〜3 桁）">' + (hasCalc ? '972,365.3<i>→</i>' : '計 ') + shown + '<em>' + (on ? (d === 0 ? '整数' : d + ' 桁') : '自動') + ' ▾</em></button>';
        if (o) o.innerHTML = chip; else it.insertAdjacentHTML("beforeend", chip); }`)],
  },
];
