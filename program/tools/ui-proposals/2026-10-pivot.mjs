// 2026-10 ピボット集計（DataRelay のデータビュワーの集計表・グラフを移す）の置き場と見せ方（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pivot.mjs --states worklog
// 利用者の要望: DataRelay のピボット集計を入れる。作業実績では、作業日ごとのロット数（重複の無い作業開始）だけでなく、
// 指定した数の列の合計（例: BOX実績_良品重量 の合計）で「その日どれだけの重量を作業できたか」を簡単に分かるように。
// 時系列のグラフ・ヒストグラムで傾向を見る機能を、ピボット集計で作る。
// 見本の組み方: 行＝作業日（現場歴）、値＝ロット数・重量の合計（2 つ）、グラフ＝時系列（棒＝重量・折れ線＝ロット数）。
// 組み立ては DataRelay と同じ「［行］ごとに、［列］別の［値］を出す」の文と、左のカラムの札（行・列・値）。
//
// 方向（何で解くか）: A 置き場＝件数の行の「一覧｜集計表｜グラフ」で、一覧の場所を集計に替える（DataRelay と同じ 3 つ）
// ／B 置き場＝道具の行の「集計」から大きな浮く窓（一覧を残す）／C 置き場＝一覧の右の面（日×直の表の所）を集計に広げる（並べて見る）
// ／D 置き場＝画面のタブに「集計」を足す（元の一覧を選ぶ）／E 置き場＝一覧の下に集計の帯（上下に分ける）
// 5 案は「どこに置くか」に偏る → 2 案を足す: F 流れ＝列の見出しのメニュー「この列で集計」から、その列を行に置いた集計を小窓で
// （探させない入口）／G 減らし方＝作業実績の右の日×直の表そのものを、値（ロット数＋合計）とグラフの切り替えで集計にする（新しい画面を足さない）

const DAYS = Array.from({ length: 14 }, (_, i) => { const d = new Date(2026, 9, 12 - i); return { d, lots: 14 + ((i * 7) % 9) + (i % 3 ? 2 : 0), w: 0 }; });
DAYS.forEach((x, i) => { x.w = Math.round(x.lots * (2650 + ((i * 523) % 900))); });
const WD = "日月火水木金土";
const dt = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
const nf = (n) => n.toLocaleString("ja-JP");
const sumL = DAYS.reduce((a, b) => a + b.lots, 0), sumW = DAYS.reduce((a, b) => a + b.w, 0);

export const CSS = `
  .pv-mock{font-size:13px;color:#1d2b36}
  .pv-mock *{box-sizing:border-box}
  .pvm-ws{display:grid;grid-template-columns:230px 1fr;gap:10px;min-height:0;height:100%}
  .pvm-fields{border:1px solid #d6dee6;border-radius:10px;background:#f7f9fb;padding:8px;overflow:hidden;display:flex;flex-direction:column;gap:6px}
  .pvm-fields b.cap{font-size:12.5px}.pvm-fields small{color:#6b7680;font-size:11.5px}
  .pvm-fields input{height:28px;border:1px solid #c9d4de;border-radius:6px;padding:0 8px;font-size:12.5px;background:#fff}
  .pvm-f{display:grid;grid-template-columns:1fr auto auto auto;gap:3px;align-items:center;padding:4px 6px;border-radius:7px;background:#fff;border:1px solid #e3e8ee}
  .pvm-f span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:12.5px}.pvm-f span small{display:block;font-weight:400}
  .pvm-f.on{border-color:#7fb4ae;background:#f0f8f7}
  .pvm-r{height:22px;min-width:24px;border:1px solid #c9d4de;border-radius:5px;background:#fff;font-size:11px;color:#56636f;padding:0 4px}
  .pvm-r.on.r-rows{background:#2f7d78;border-color:#2f7d78;color:#fff}.pvm-r.on.r-cols{background:#4a62b0;border-color:#4a62b0;color:#fff}.pvm-r.on.r-vals{background:#b5822a;border-color:#b5822a;color:#fff}
  .pvm-main{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
  .pvm-sent{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border:1px solid #d6dee6;border-radius:10px;background:#fff}
  .pvm-slot{display:inline-flex;gap:4px;align-items:center;min-height:30px;padding:2px 6px;border:1.5px dashed #b9c7d4;border-radius:8px;background:#fafcfd}
  .pvm-chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:999px;font-weight:800;font-size:12.5px;color:#fff}
  .pvm-chip.r{background:#2f7d78}.pvm-chip.c{background:#4a62b0}.pvm-chip.v{background:#b5822a}.pvm-chip i{font-style:normal;opacity:.8}
  .pvm-w{color:#56636f;font-weight:700}.pvm-sp{flex:1}
  .pvm-sel{height:28px;border:1px solid #c9d4de;border-radius:6px;padding:0 8px;background:#fff;font-size:12.5px;display:inline-flex;align-items:center}
  .pvm-ph{color:#8a96a0;font-size:12px}
  .pvm-out{display:grid;grid-template-columns:minmax(300px,0.9fr) 1.1fr;gap:10px;min-height:0;flex:1}
  .pvm-out.stack{grid-template-columns:1fr}
  .pvm-tbl{border:1px solid #d6dee6;border-radius:10px;overflow:hidden;background:#fff;align-self:start;max-height:100%}
  .pvm-tbl table{border-collapse:collapse;width:100%;font-size:12.5px}
  .pvm-tbl th,.pvm-tbl td{padding:4px 10px;border-bottom:1px solid #edf1f4;text-align:right;white-space:nowrap}
  .pvm-tbl thead th{background:#4a5a68;color:#fff;text-align:center;font-weight:700}
  .pvm-tbl tbody th{text-align:left;font-weight:700;background:#f7f9fb}
  .pvm-tbl tr.g td,.pvm-tbl tr.g th{background:#eef3f7;font-weight:800;border-top:2px solid #c9d4de}
  .pvm-chart{border:1px solid #d6dee6;border-radius:10px;background:#fff;padding:8px 10px;min-height:0}
  .pvm-chart h5{margin:0 0 4px;font-size:12.5px;display:flex;gap:10px;align-items:center}.pvm-chart h5 small{font-weight:400;color:#6b7680}
  .pvm-leg{display:inline-flex;gap:10px;font-size:11.5px;color:#56636f}.pvm-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
  .pvm-tabs{display:inline-flex;border:1px solid #c9d4de;border-radius:8px;overflow:hidden;background:#fff}
  .pvm-tabs b{padding:3px 12px;font-size:12.5px;color:#56636f;font-weight:700;border-left:1px solid #e3e8ee}.pvm-tabs b:first-child{border-left:0}
  .pvm-tabs b.on{background:#3f6591;color:#fff}
  .pvm-panel{position:fixed;z-index:85;background:#fff;border:1px solid #9fb4c2;border-radius:12px;box-shadow:0 30px 80px rgba(10,30,45,.35);display:flex;flex-direction:column;overflow:hidden}
  .pvm-head{background:linear-gradient(110deg,#1c3550,#2b5f79);color:#fff;padding:10px 16px}.pvm-head small{opacity:.8;font-size:11px;letter-spacing:.12em;display:block}.pvm-head b{font-size:16px}
  .pvm-body{flex:1;min-height:0;padding:10px}
`;

const FIELD_LIST = [["作業日（現場歴）", "日付 · 121 種類", "rows"], ["直", "4 種類", ""], ["作業区分", "3 種類", ""], ["作業者", "3 種類", ""], ["合金", "3 種類", ""],
  ["調質", "3 種類", ""], ["ロット数", "重複の無い作業開始", "vals"], ["重量", "数 · 合計・平均…", "vals"], ["板幅", "数", ""], ["入側板厚", "数", ""], ["速度", "数", ""]];
export function fieldsHtml(n = FIELD_LIST.length) {
  return `<div class="pvm-fields"><b class="cap">カラム</b><small>札を押すと上の文に入ります</small><input placeholder="カラムを検索">`
    + FIELD_LIST.slice(0, n).map(([name, sub, on]) => `<div class="pvm-f${on ? " on" : ""}"><span>${name}<small>${sub}</small></span>`
      + ["rows", "cols", "vals"].map((r) => `<button class="pvm-r r-${r}${on === r ? " on" : ""}">${{ rows: "行", cols: "列", vals: "値" }[r]}</button>`).join("") + "</div>").join("") + "</div>";
}
export function sentenceHtml(chartPick = true) {
  return `<div class="pvm-sent"><span class="pvm-slot"><span class="pvm-chip r">作業日（現場歴）<i>×</i></span></span><span class="pvm-w">ごとに、</span>`
    + `<span class="pvm-slot"><span class="pvm-ph">＋ 列</span></span><span class="pvm-w">別の</span><span class="pvm-slot"><span class="pvm-chip v">ロット数<i>×</i></span><span class="pvm-chip v">重量の合計<i>×</i></span></span><span class="pvm-w">を出す</span>`
    + `<span class="pvm-sp"></span>${chartPick ? '<span class="pvm-sel">グラフ: 時系列 ▾</span>' : ""}<span class="pvm-sel">☑ 総計</span><span class="pvm-sel">Excel に出力</span></div>`;
}
export function tableHtml(n = 10) {
  return `<div class="pvm-tbl"><table><thead><tr><th>作業日（現場歴）</th><th>ロット数</th><th>重量の合計</th></tr></thead><tbody>`
    + DAYS.slice(0, n).map((x) => `<tr><th>${dt(x.d)}</th><td>${x.lots}</td><td>${nf(x.w)}</td></tr>`).join("")
    + `<tr class="g"><th>総計（${DAYS.length}日）</th><td>${sumL}</td><td>${nf(sumW)}</td></tr></tbody></table></div>`;
}
export function chartHtml(w = 620, h = 250, title = true) {
  const ds = DAYS.slice().reverse(), pl = 54, pr = 46, pt = 10, pb = 34, iw = w - pl - pr, ih = h - pt - pb;
  const mw = Math.max(...ds.map((x) => x.w)), ml = Math.max(...ds.map((x) => x.lots));
  const bw = iw / ds.length * 0.62;
  const x = (i) => pl + iw * (i + 0.5) / ds.length;
  const bars = ds.map((d, i) => `<rect x="${x(i) - bw / 2}" y="${pt + ih * (1 - d.w / mw)}" width="${bw}" height="${ih * d.w / mw}" fill="#b5822a" opacity=".78"/>`).join("");
  const line = `<polyline fill="none" stroke="#2f7d78" stroke-width="2.4" points="${ds.map((d, i) => `${x(i)},${pt + ih * (1 - d.lots / ml)}`).join(" ")}"/>`
    + ds.map((d, i) => `<circle cx="${x(i)}" cy="${pt + ih * (1 - d.lots / ml)}" r="3" fill="#fff" stroke="#2f7d78" stroke-width="2"/>`).join("");
  const grid = [0, 0.5, 1].map((f) => `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih * (1 - f)}" y2="${pt + ih * (1 - f)}" stroke="#e3e8ee"/><text x="${pl - 6}" y="${pt + ih * (1 - f) + 4}" font-size="10" text-anchor="end" fill="#6b7680">${nf(Math.round(mw * f / 1000))}t</text><text x="${w - pr + 6}" y="${pt + ih * (1 - f) + 4}" font-size="10" fill="#2f7d78">${Math.round(ml * f)}</text>`).join("");
  const xl = ds.map((d, i) => (i % 2 ? "" : `<text x="${x(i)}" y="${h - 14}" font-size="10" text-anchor="middle" fill="#56636f">${d.d.getMonth() + 1}/${d.d.getDate()}</text>`)).join("");
  return `<div class="pvm-chart">${title ? `<h5>時系列 <small>作業日ごと</small><span class="pvm-leg"><span><i style="background:#b5822a"></i>重量の合計（左）</span><span><i style="background:#2f7d78"></i>ロット数（右）</span></span></h5>` : ""}`
    + `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${grid}${bars}${line}${xl}</svg></div>`;
}
/** 一覧の表の場所（.ll-grid-wrap）を集計に替える（一覧の表を隠し、同じ場所に描く） */
const replaceList = (html) => ["script", `
const go = () => { const w = document.querySelector("#lotListScreen .ll-grid-wrap"); if (!w || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150);
  if (document.getElementById("pvmA")) return; w.style.display = "none";
  w.insertAdjacentHTML("afterend", '<div id="pvmA" class="pv-mock" style="flex:1;min-width:0;min-height:0;padding:0">' + ${JSON.stringify(html)} + '</div>'); };
setTimeout(go, 600);`];
const keep = (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)}); };
setInterval(put, 150); put();`];
const panel = (html, rect) => ["script", `
const go = () => { if (!document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150); if (document.getElementById("pvmP")) return;
  document.body.insertAdjacentHTML("beforeend", '<div id="pvmP" class="pvm-panel pv-mock" style="${rect}">' + ${JSON.stringify(html)} + '</div>'); };
setTimeout(go, 900);`];
const WS = (out = "") => `<div class="pvm-ws">${fieldsHtml()}<div class="pvm-main">${sentenceHtml()}<div class="pvm-out ${out}">${tableHtml(12)}${chartHtml()}</div></div></div>`;
const VIEWTABS = `<span id="pvmTabs" class="pvm-tabs pv-mock"><b>一覧</b><b class="on">集計表・グラフ</b></span>`;

export const PROPOSALS = [
  { key: "now", name: "今の作り（作業実績の右に日×直のロット数だけ。集計・グラフは無い）", css: "", ops: [] },
  {
    key: "A", name: "件数の行の「一覧｜集計表・グラフ」で、一覧の場所を集計に替える（DataRelay と同じ）",
    css: CSS, ops: [keep("pvmTabs", VIEWTABS, "afterend", "#llCount"), replaceList(WS())],
  },
  {
    key: "B", name: "道具の行の「集計」から大きな浮く窓（一覧を後ろに残す）",
    css: CSS, ops: [keep("pvmBtn", '<button id="pvmBtn" class="pvm-sel pv-mock" style="height:34px;font-weight:700">▦ 集計・グラフ</button>', "beforebegin", "#llColBtn"),
      panel(`<div class="pvm-head"><small>集計・グラフ</small><b>作業実績：CR1・実績</b></div><div class="pvm-body">${WS()}</div>`, "left:120px;top:110px;width:1490px;height:900px")],
  },
  {
    key: "C", name: "一覧の右の面を集計に広げる（一覧と並べて見る）",
    css: CSS + "#llWork{display:none!important}",
    ops: [["script", `
const go = () => { const row = document.querySelector("#llBodyRow"); if (!row || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150); if (document.getElementById("pvmC")) return;
  row.insertAdjacentHTML("beforeend", '<aside id="pvmC" class="pv-mock" style="flex:0 0 640px;order:99;display:flex;flex-direction:column;gap:8px;overflow:hidden;border:1px solid #d6dee6;border-radius:10px;padding:8px;background:#fbfcfd">'
   + ${JSON.stringify(`<div style="display:flex;justify-content:space-between;align-items:center"><b>集計</b><span class="pvm-sel">組み方 ▾</span></div>${sentenceHtml()}${chartHtml(600, 210)}${tableHtml(8)}`)} + '</aside>'); };
setTimeout(go, 700);`]],
  },
  {
    key: "D", name: "画面のタブに「集計」を足す（元の一覧を選んで集計する）",
    css: CSS, ops: [keep("pvmTab", '<button id="pvmTab" class="screen-tab" style="color:#fff;font-weight:800;padding:0 22px;background:rgba(255,255,255,.14);border-radius:10px 10px 0 0">▦ 集計</button>', "afterend", "#tabWork"),
      panel(`<div class="pvm-body" style="padding:14px 18px"><div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><b style="font-size:15px">集計</b><span class="pvm-sel">元: 作業実績 CR1・実績 ▾</span><span class="pvm-sel">条件: 一覧と同じ（条件 1）</span></div>${WS()}</div>`, "left:0;top:64px;width:100%;height:calc(100% - 64px);border-radius:0;box-shadow:none;border:0")],
  },
  {
    key: "E", name: "一覧の下に集計の帯（上下に分け、境目で高さを変える）",
    css: CSS + "#lotListScreen .ll-grid-wrap{flex:0 0 46%!important}",
    ops: [["script", `
const go = () => { const w = document.querySelector("#lotListScreen .ll-grid-wrap"); if (!w || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150); if (document.getElementById("pvmE")) return;
  const row = document.querySelector("#llBodyRow"); row.style.flexDirection = "column";
  w.insertAdjacentHTML("afterend", '<div id="pvmE" class="pv-mock" style="flex:1;min-height:0;border-top:4px double #c9d4de;padding-top:6px;display:grid;grid-template-columns:1fr 1.2fr;gap:10px">'
   + ${JSON.stringify(`<div style="display:flex;flex-direction:column;gap:6px;min-height:0">${sentenceHtml()}${tableHtml(7)}</div>${chartHtml(700, 240)}`)} + '</div>'); };
setTimeout(go, 700);`]],
  },
  {
    key: "F", name: "列の見出しのメニュー「この列で集計」から、その列を行に置いた集計を小窓で",
    css: CSS, ops: [panel(`<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between"><b>「作業日」で集計</b><span class="pvm-sel">詳しく組む…</span></div>`
      + `<div style="display:flex;gap:6px;align-items:center"><span class="pvm-w">値</span><span class="pvm-chip v">ロット数</span><span class="pvm-chip v">重量の合計</span><span class="pvm-sel">＋</span><span class="pvm-sp"></span><span class="pvm-tabs"><b class="on">表</b><b>時系列</b><b>ヒストグラム</b></span></div>${tableHtml(9)}</div>`,
      "left:470px;top:240px;width:560px;height:520px")],
  },
  {
    key: "G", name: "作業実績の右の日×直の表そのものを、値（ロット数＋合計）とグラフで集計にする（画面を足さない）",
    css: CSS + "#llWork{flex-basis:520px!important}",
    ops: [["script", `
const go = () => { const p = document.querySelector("#llWork"); if (!p || p.hidden || !document.querySelector("#llBody tr[data-i]")) { document.querySelector('#llWorkSwitch [data-wk-mode="day"]')?.click(); return setTimeout(go, 400); }
  if (document.getElementById("pvmG")) return; p.innerHTML = '<div id="pvmG" class="pv-mock" style="display:flex;flex-direction:column;gap:8px">'
   + ${JSON.stringify(`<div style="display:flex;justify-content:space-between;align-items:center"><b>日ごとの実績</b><span class="pvm-tabs"><b class="on">表</b><b>時系列</b><b>ヒストグラム</b></span></div><div style="display:flex;gap:6px;align-items:center"><span class="pvm-w">値</span><span class="pvm-chip v">ロット数</span><span class="pvm-sel">＋ 重量の合計 ▾</span></div>${chartHtml(500, 200, false)}${tableHtml(9)}<span class="pvm-sel" style="align-self:flex-start">集計表で詳しく組む…</span>`)} + '</div>'; };
setTimeout(go, 900);`]],
  },
];
