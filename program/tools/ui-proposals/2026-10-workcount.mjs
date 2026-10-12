// 2026-10「作業実績」を作業（作業開始が同じ行＝分割したロットを 1 ロット）でまとめ、日・日＋直ごとのロット数を見せる形（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-workcount.mjs --states worklog
// 数はサーバーの答え（/api/worklog?work=1 の work）をそのまま使う（本物の数）。見せ方だけを案ごとに組み替える近似。
// 勤務体系は ui_server.py が入れる交替勤務(1,2,3直)。
//
// 方向（何で解くか）: A 置き場＝一覧の中の見出し行（日・直）／B 見せ方＝一覧の上の日×直の表（ピボット）／
// C 置き場＝一覧の右の空きに日×直の帯／D 流れ＝今の「並び・まとめ」の段（作業日 › 直 › 作業）として出す／
// E 減らし方＝一覧は変えず、件数の行に作業数と直ごとの数だけ
// 5 案を並べると「表（数字）で見せる」に偏り、量の比べやすさで解く案と、一覧と集計を行き来する流れの案が無い → 2 案を足す:
// F 見せ方＝日ごとの棒（直で積み上げ）で量を形で見せる／G 流れ＝「一覧｜日・直の集計」を切り替え、集計を全面に

export const HELPER = String.raw`
const WK = window.__wkOpt;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const WD = "日月火水木金土";
const dayText = (d, short) => { if (!d) return "日付なし"; const [y, m, dd] = d.split("-").map(Number); const w = WD[new Date(y, m - 1, dd).getDay()];
  return short ? m + "/" + dd + "(" + w + ")" : y + "/" + String(m).padStart(2, "0") + "/" + String(dd).padStart(2, "0") + "(" + w + ")"; };
let cache = {};
async function data(key) {
  if (!cache[key]) cache[key] = fetch("/api/worklog?equip=" + key + "&work=1&page_size=500").then((r) => r.json());
  return cache[key];
}
function shiftName(w, i) { return i >= 0 ? w.shifts[i].name : i === -2 ? "時刻なし" : "直の外"; }
function pivot(w, max = 99) {
  const days = [], by = {};
  w.buckets.forEach((b) => { if (!(b.day in by)) { by[b.day] = {}; days.push(b.day); } by[b.day][b.shift] = b; });
  const idx = w.shifts.map((_, i) => i).concat(w.buckets.some((b) => b.shift < 0) ? [-1] : []);
  return { days: days.slice(0, max), by, idx };
}
function pivotHtml(w, max) {
  const p = pivot(w, max), sum = (o, k) => Object.values(o).reduce((a, b) => a + b[k], 0);
  return '<table class="wk-pv"><thead><tr><th>日（現場歴）</th>' + p.idx.map((i) => '<th class="s' + i + '">' + esc(shiftName(w, i)) + "</th>").join("") + '<th class="tot">計</th></tr></thead><tbody>'
    + p.days.map((d) => "<tr><th>" + dayText(d, true) + "</th>" + p.idx.map((i) => { const b = p.by[d][i]; return '<td class="s' + i + '">' + (b ? b.works + (b.split ? '<small>' + b.rows + "行</small>" : "") : '<i>–</i>') + "</td>"; }).join("")
      + '<td class="tot"><b>' + sum(p.by[d], "works") + "</b></td></tr>").join("") + "</tbody></table>";
}
function barsHtml(w, max) {
  const p = pivot(w, max), tot = (d) => Object.values(p.by[d]).reduce((a, b) => a + b.works, 0), top = Math.max(1, ...p.days.map(tot));
  return '<div class="wk-bars">' + p.days.slice().reverse().map((d) => '<div class="wk-bar" title="' + dayText(d) + '"><b>' + tot(d) + '</b><span class="wk-stack" style="height:' + Math.round(tot(d) / top * 100) + '%">'
    + p.idx.map((i) => { const b = p.by[d][i]; return b ? '<i class="s' + i + '" style="flex:' + b.works + '"></i>' : ""; }).join("") + "</span><small>" + dayText(d, true).replace(/\(.\)/, "") + "</small></div>").join("")
    + '</div><div class="wk-legend">' + p.idx.map((i) => '<span><i class="s' + i + '"></i>' + esc(shiftName(w, i)) + "</span>").join("") + "</div>";
}
function bodyHtml(d, mode) {
  const w = d.work, cols = [...document.querySelectorAll("#llHead th[data-col]")].map((th) => th.dataset.col);
  const pv = pivot(w), out = []; let lastDay = null, lastShift = null, i = 0;
  while (i < d.rows.length) {
    const [key, day, sh] = w.rows[i]; let j = i + 1; while (j < d.rows.length && w.rows[j][0] === key) j++;
    if (mode.heads && day !== lastDay) { const all = Object.values(pv.by[day] || {}); const n = all.reduce((a, b) => a + b.works, 0), r = all.reduce((a, b) => a + b.rows, 0);
      out.push('<tr class="wk-h wk-hd"><td colspan="' + cols.length + '">' + (mode.tog ? "▾ " : "") + '<b>' + dayText(day) + '</b><span class="wk-n">' + n + 'ロット</span>' + (r > n ? '<small>（' + r + "行・分割を 1 と数えました）</small>" : "") + "</td></tr>"); lastDay = day; lastShift = null; }
    if (mode.shifts && sh !== lastShift) { const b = (pv.by[day] || {})[sh] || { works: 0, rows: 0 };
      out.push('<tr class="wk-h wk-hs s' + sh + '"><td colspan="' + cols.length + '">' + (mode.tog ? "▾ " : "") + "<b>" + esc(shiftName(w, sh)) + '</b><span class="wk-n">' + b.works + "ロット</span>" + (b.rows > b.works ? "<small>（" + b.rows + "行）</small>" : "") + "</td></tr>"); lastShift = sh; }
    for (let k = i; k < j; k++) {
      if (mode.merge && k > i) continue;
      const r = d.rows[k], first = k === i, split = j - i > 1;
      out.push('<tr class="' + (split ? (mode.merge ? "wk-m" : first ? "wk-s wk-s0" : k === j - 1 ? "wk-s wk-sl" : "wk-s") : "") + '">' + cols.map((c) => {
        let v = esc(r[c]);
        if (c === d.lotColumn) v = '<span class="ll-lot">' + v + "</span>" + (mode.merge && split ? '<span class="wk-plus" title="同じ作業開始の分割ロット">＋' + (j - i - 1) + "</span>" : "");
        return "<td>" + v + "</td>"; }).join("") + "</tr>");
    }
    i = j;
  }
  return out.join("");
}
async function apply() {
  const sel = document.querySelector("#llEquipBar [aria-selected=true]"), body = document.querySelector("#llBody");
  if (!sel || !body || !body.rows.length || (body.dataset.wk === sel.dataset.equip && (!WK.list || body.querySelector("[data-wkm]")))) return;
  body.dataset.wk = sel.dataset.equip;
  const d = await data(sel.dataset.equip), w = d.work;
  if (WK.list) { body.innerHTML = bodyHtml(d, WK.list); body.firstElementChild.dataset.wkm = "1"; }
  document.querySelectorAll(".wk-ui").forEach((x) => x.remove());
  WK.draw && WK.draw(d, w, { pivotHtml, barsHtml, dayText, shiftName, esc });
}
setInterval(apply, 300);
`;

export const CSS = `
.wk-ui{font-size:13px;color:var(--ink)}
.wk-pv{border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.wk-pv th,.wk-pv td{padding:3px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.wk-pv thead th{position:sticky;top:0;background:#f3f7f9;font-weight:700;color:var(--muted);font-size:12px}
.wk-pv tbody th{text-align:left;font-weight:600;color:var(--ink)}
.wk-pv td small{margin-left:4px;color:var(--muted);font-size:10.5px}
.wk-pv td i{color:#c3ccd3;font-style:normal}
.wk-pv .tot{background:#eef6f5;font-weight:800;color:#0f5f5a}
.wk-pv thead .s0{color:#1f6fb2}.wk-pv thead .s1{color:#b26a00}.wk-pv thead .s2{color:#4a3fa0}
#llBody tr.wk-h td{background:#f1f6f8;font-weight:600;padding:5px 10px;border-top:1px solid #d6e2e8}
#llBody tr.wk-hd td{background:#e5eff3;font-size:14px}
#llBody tr.wk-hs td{padding-left:28px}
#llBody tr.wk-hs.s0 td{box-shadow:inset 4px 0 #8cc3ec}#llBody tr.wk-hs.s1 td{box-shadow:inset 4px 0 #f0bf6a}#llBody tr.wk-hs.s2 td{box-shadow:inset 4px 0 #9a90dc}
.wk-n{margin-left:10px;padding:1px 9px;border-radius:999px;background:var(--ll-teal);color:#fff;font-weight:800;font-size:12.5px}
#llBody tr.wk-h small{margin-left:6px;color:var(--muted);font-weight:500}
.wk-plus{margin-left:6px;padding:0 6px;border-radius:6px;background:#e3eef8;color:#1f5f99;font-size:11.5px;font-weight:800}
#llBody tr.wk-s td:first-child{box-shadow:inset 3px 0 #7fb2dd}
#llBody tr.wk-s:not(.wk-sl) td{border-bottom-color:transparent}
.wk-bars{display:flex;align-items:flex-end;gap:4px;height:120px;padding:4px 0}
.wk-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:14px;font-size:10.5px;color:var(--muted)}
.wk-bar b{color:var(--ink);font-size:11px}
.wk-stack{display:flex;flex-direction:column-reverse;width:100%;max-width:26px;border-radius:3px 3px 0 0;overflow:hidden}
.wk-stack i,.wk-legend i{display:block}
.wk-stack i.s0,.wk-legend i.s0{background:#8cc3ec}.wk-stack i.s1,.wk-legend i.s1{background:#f0bf6a}.wk-stack i.s2,.wk-legend i.s2{background:#9a90dc}.wk-stack i.s-1,.wk-legend i.s-1{background:#c9d1d8}
.wk-legend{display:flex;gap:14px;font-size:12px;color:var(--muted)}.wk-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.wk-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--ll-teal);background:#eef7f6;color:#0f5f5a;font-weight:700;font-size:13px}
.wk-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.wk-seg b{padding:4px 12px;font-size:13px;color:var(--muted);font-weight:600}.wk-seg b.on{background:var(--ll-teal);color:#fff}
`;

export const SWITCH = `<span class="wk-ui wk-seg" title="作業開始が同じ行（分割したロット）を 1 ロットと数えます"><b>まとめない</b><b>日ごと</b><b class="on">日＋直ごと</b></span>`;
const total = "d.work.total.works + 'ロット（' + d.work.total.rows + '行）'";
export const opt = (o) => ["script", `window.__wkOpt = { ${o} };` + HELPER];

export const PROPOSALS = [
  {
    key: "A", name: "一覧の中に日・直の見出し行（分割ロットは 1 行に畳み「＋n」）",
    css: CSS,
    ops: [opt(`list: { heads: true, shifts: true, merge: true, tog: true },
      draw: (d) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", ${JSON.stringify(SWITCH)});
        document.querySelector("#llCount").textContent = "全 " + ${total}; }`)],
  },
  {
    key: "B", name: "一覧の上に日×直の表（ピボット）・一覧は作業ごとに畳む",
    css: CSS + `.wk-top{display:flex;gap:16px;align-items:flex-start;margin:0 0 8px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fbfdfe;max-height:212px;overflow:auto}`,
    ops: [opt(`list: { merge: true },
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", ${JSON.stringify(SWITCH)});
        document.querySelector("#llCount").textContent = "全 " + ${total};
        document.querySelector("#llBodyRow").insertAdjacentHTML("beforebegin", '<div class="wk-ui wk-top">' + h.pivotHtml(w, 30) + "</div>"); }`)],
  },
  {
    key: "C", name: "一覧の右の空きに日×直の集計の帯（押すとその日・直に絞る）",
    css: CSS + `.wk-side{flex:none;width:330px;margin-left:12px;border:1px solid var(--line);border-radius:8px;background:#fbfdfe;overflow:auto;padding:8px}
      .wk-side h5{margin:2px 4px 8px;font-size:13px}`,
    ops: [opt(`list: { merge: true },
      draw: (d, w, h) => { document.querySelector("#llCount").textContent = "全 " + ${total};
        document.querySelector("#llBodyRow").insertAdjacentHTML("beforeend", '<aside class="wk-ui wk-side"><h5>日・直ごとのロット数 <small>（分割は 1）</small></h5>' + h.pivotHtml(w, 60) + "</aside>"); }`)],
  },
  {
    key: "D", name: "今の「並び・まとめ」の段として（作業日 › 直 › 作業）",
    css: CSS + `#llGroupBar{display:flex!important}`,
    ops: [opt(`list: { heads: true, shifts: true, merge: false, tog: true },
      draw: (d) => { const g = document.querySelector("#llGroupBar"); g.hidden = false;
        g.innerHTML = '<span class="ll-gchip">まとめて表示中</span><span class="ll-glv"><b class="ll-glvn">1</b>作業日（現場歴）<button>▼</button><button>×</button></span><i class="ll-gsep">›</i><span class="ll-glv"><b class="ll-glvn">2</b>直<button>▲</button><button>×</button></span><i class="ll-gsep">›</i><span class="ll-glv"><b class="ll-glvn">3</b>作業（作業開始）<button>×</button></span><button class="ll-gadd">＋ 段・見せ方</button><button>まとめない</button>';
        document.querySelector("#llCount").textContent = "全 " + d.count + "件・" + d.work.total.works + "作業"; }`)],
  },
  {
    key: "E", name: "一覧は変えず、件数の行に作業数と今日（最新の日）の直ごとの数",
    css: CSS + `.wk-today{display:inline-flex;gap:6px;align-items:center}.wk-today span{padding:1px 8px;border-radius:6px;background:#f1f5f8;font-weight:700}`,
    ops: [opt(`list: { merge: false },
      draw: (d, w, h) => { const b = w.buckets.filter((x) => x.day === w.buckets[0].day);
        document.querySelector("#llCount").insertAdjacentHTML("afterend", '<span class="wk-ui wk-chip">作業 ' + w.total.works + 'ロット<small>（行 ' + w.total.rows + '・分割 ' + w.total.split + '）</small></span><span class="wk-ui wk-today">' + h.dayText(w.buckets[0].day, true) + b.map((x) => '<span>' + h.esc(h.shiftName(w, x.shift)) + ' ' + x.works + '</span>').join("") + "</span>"); }`)],
  },
  {
    key: "F", name: "一覧の上に日ごとの棒（直で積み上げ）",
    css: CSS + `.wk-top{margin:0 0 8px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fbfdfe}`,
    ops: [opt(`list: { merge: true },
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", ${JSON.stringify(SWITCH)});
        document.querySelector("#llCount").textContent = "全 " + ${total};
        document.querySelector("#llBodyRow").insertAdjacentHTML("beforebegin", '<div class="wk-ui wk-top">' + h.barsHtml(w, 45) + "</div>"); }`)],
  },
  {
    key: "G", name: "「一覧｜日・直の集計」を切り替え、集計を全面に",
    css: CSS + `#llBodyRow{display:none!important}.wk-full{flex:1;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px 14px}
      .wk-full .wk-pv{font-size:14px}.wk-full .wk-pv th,.wk-full .wk-pv td{padding:5px 18px}`,
    ops: [opt(`list: null,
      draw: (d, w, h) => { document.querySelector("#llCount").insertAdjacentHTML("afterend", '<span class="wk-ui wk-seg"><b>一覧</b><b class="on">日・直の集計</b></span>');
        document.querySelector("#llCount").textContent = "全 " + ${total};
        document.querySelector("#llBodyRow").insertAdjacentHTML("afterend", '<div class="wk-ui wk-full">' + h.pivotHtml(w, 60) + "</div>"); }`)],
  },
];
