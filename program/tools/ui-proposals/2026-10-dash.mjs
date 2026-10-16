// 2026-10 ダッシュボード（設備別の仕掛ロット数・前日〈現場歴〉の設備別・直ごとの実績本数。集計対象は条件で。版 3.36.0）。1 回目。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dash.mjs --states dash,dash-cond
//   （--view 1280x720 でも）
// 今の画面（土台。dash・dash-cond）で見えたこと:
//   ①仕掛（左）と前日の実績（右）が別の 2 枚で、設備の並びが違う（左は多い順・右は名前の順）。同じ設備の数を左右で探して見比べる
//   ②前日の表は 0 と数が同じ重さで並び、どこが動いたか一目で分からない ③仕掛の棒は橙（色付け・注意の色）で、案内の藍とずれる
//   ④1280×720 では見出しのタブが 5 つになり、題（LotScope）が切れ「終了」が窓の外へ出る ⑤条件の札が「条件: 条件なし（すべて）」と言葉が重なる
//   ⑥画面の下半分が空く（1728）
// 案（何で解くか）:
//   A 設備の軸で 1 枚の表（設備｜仕掛の棒と数｜前日の直ごと・計）。並びは仕掛の多い順。前日の数は濃淡
//   B 2 枚のまま、前日の表を濃淡に・仕掛の棒を藍に・並びを左右でそろえる（設備の名前の順）
//   C 上に要約の札 3 つ（仕掛・前日の本数・前日 0 本の設備）、下に A の表
//   D A ＋ 見出しのタブを足さない（ブランド「LotScope」を押すとダッシュボード。タブは 4 つのまま）
//   E A ＋ 見出しを詰める（1440 以下は状態の札の「データ元」「待機中」を畳み〈接続の点だけ残す〉、タブの字を 14px に）
// 共通: 条件の札は「対象: すべて」／「対象: 製造材質 ＝ A1100」の言葉にする

const css = `
.pv-tbl{border-collapse:collapse;width:100%;font-size:13.5px}
.pv-tbl th,.pv-tbl td{padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:left}
.pv-tbl thead th{font-size:12.5px;color:var(--muted)}
.pv-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
.pv-tbl .grp{border-left:2px solid var(--line)}
.pv-heat{border-radius:4px}
.pv-zero{color:#c3ccd4}
.pv-bar{display:flex;align-items:center;gap:8px}
.pv-bar span{flex:1;height:12px;background:var(--surface-4);border-radius:4px;overflow:hidden;min-width:80px}
.pv-bar i{display:block;height:100%;background:var(--h-input);border-radius:4px}
.pv-bar b{width:3.5em;text-align:right;font-variant-numeric:tabular-nums}
.pv-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gap);margin-bottom:var(--gap)}
.pv-kpi{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:12px 16px;display:flex;flex-direction:column;gap:2px}
.pv-kpi small{color:var(--muted);font-size:12.5px;font-weight:700}
.pv-kpi b{font-size:26px;font-variant-numeric:tabular-nums}
.pv-kpi b small{font-size:13px;margin-left:4px}
.pv-kpi.warn b{color:#a3322a}
.pv-cond{max-width:360px;height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface-3);font:inherit;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.db-bar i.pvB{background:var(--h-input)}
`;
const narrowHeader = `@media (max-width:1440px){ #modeBadge,#status{display:none!important} .screen-tab{font-size:14px;padding:0 10px!important;gap:5px!important} .screen-tabs{margin-left:10px!important} }`;

// 画面の中で描く（/api/dashboard の答えから）。kind: A・B・C
const page = (kind) => `{
const K = ${JSON.stringify(kind)};
const esc = (s) => TPA.esc(s);
const cond = (c) => "対象: " + (c && c.filters && c.filters.length ? c.filters.map((f) => f.column + " " + f.op + " " + f.value).join("・") : "すべて");
const heat = (n, max) => n ? "background:rgba(63,101,145," + (0.12 + 0.5 * n / Math.max(1, max)).toFixed(2) + ")" + (n / max > 0.6 ? ";color:#fff" : "") : "";
function table(d) {
  const wip = Object.fromEntries((d.wip.items || []).map((x) => [x.equipment, x.lots]));
  const work = Object.fromEntries((d.work.items || []).map((x) => [x.equipment, x]));
  const names = []; (d.work.items || []).forEach((x) => (x.shifts || []).forEach((s) => { if (!names.includes(s.name)) names.push(s.name); }));
  const eqs = [...new Set([...(d.wip.items || []).map((x) => x.equipment), ...(d.work.items || []).map((x) => x.equipment)])];
  eqs.sort((a, b) => (wip[b] || 0) - (wip[a] || 0) || a.localeCompare(b));
  const maxW = Math.max(1, ...Object.values(wip)), maxS = Math.max(1, ...(d.work.items || []).flatMap((x) => (x.shifts || []).map((s) => s.works)));
  const day = (d.work.days || [])[0] || "";
  return '<section class="db-card"><div class="db-head"><h3>設備ごとの仕掛と前日の実績<small>前日 ' + esc(day.slice(5).replace("-", "/")) + '・現場歴</small></h3><span class="db-sp"></span>'
    + '<button class="pv-cond">仕掛の' + esc(cond(d.wip.condition)) + '</button><button class="pv-cond">実績の' + esc(cond(d.work.condition)) + '</button><button type="button" class="pz-btn">仕掛を開く ›</button></div>'
    + '<table class="pv-tbl"><thead><tr><th rowspan="2">設備</th><th rowspan="2">仕掛ロット数</th><th class="grp" colspan="' + (names.length + 1) + '">前日の実績本数（作業開始が同じ行は 1 本）</th></tr><tr>'
    + names.map((n, i) => '<th class="num' + (i ? "" : " grp") + '">' + esc(n) + "</th>").join("") + '<th class="num">計</th></tr></thead><tbody>'
    + eqs.map((e) => { const w = work[e], by = w ? Object.fromEntries((w.shifts || []).map((s) => [s.name, s.works])) : {};
        return "<tr><th>" + esc(e) + '</th><td><div class="pv-bar"><span><i style="width:' + ((wip[e] || 0) / maxW * 100).toFixed(1) + '%"></i></span><b>' + (wip[e] || 0) + "</b></div></td>"
          + (w && w.error ? '<td class="grp" colspan="' + (names.length + 1) + '" style="white-space:normal;color:#a3322a;font-size:12.5px">' + esc(w.error) + "</td>"
            : names.map((n, i) => n in by ? '<td class="num' + (i ? "" : " grp") + (by[n] ? "" : " pv-zero") + '"><span class="pv-heat" style="padding:2px 8px;' + heat(by[n], maxS) + '">' + by[n] + "</span></td>" : '<td class="num pv-zero' + (i ? "" : " grp") + '">–</td>').join("")
              + '<td class="num"><b>' + (w ? w.total.works : "–") + "</b></td>") + "</tr>"; }).join("") + "</tbody></table></section>";
}
function kpis(d) {
  const zero = (d.work.items || []).filter((x) => !x.error && x.total && !x.total.works).length;
  const works = (d.work.items || []).reduce((a, x) => a + ((x.total && x.total.works) || 0), 0);
  return '<div class="pv-cards"><div class="pv-kpi"><small>仕掛</small><b>' + (d.wip.total || 0).toLocaleString() + '<small>ロット</small></b></div>'
    + '<div class="pv-kpi"><small>前日の実績</small><b>' + works + '<small>本</small></b></div>'
    + '<div class="pv-kpi' + (zero ? " warn" : "") + '"><small>前日に 0 本の設備</small><b>' + zero + '<small>台</small></b></div></div>';
}
let data = null;
const paint = () => { const box = document.querySelector("#dashBody"), g = box && box.querySelector(".db-grid"); if (!g || !data || g.dataset.pv) return;
  if (K === "B") { // 2 枚のまま: 棒を藍・並びを名前の順・前日の表を濃淡
    box.querySelectorAll(".db-bar i").forEach((i) => i.classList.add("pvB"));
    const ul = box.querySelector(".db-bars"); if (ul) [...ul.children].sort((a, b) => a.querySelector(".db-eq").textContent.localeCompare(b.querySelector(".db-eq").textContent)).forEach((li) => ul.appendChild(li));
    const cells = [...box.querySelectorAll(".db-table td.num:not(.db-sum)")], max = Math.max(1, ...cells.map((c) => +c.textContent || 0));
    cells.forEach((c) => { const n = +c.textContent || 0; if (n) c.innerHTML = '<span class="pv-heat" style="padding:2px 8px;' + heat(n, max) + '">' + n + "</span>"; });
    box.querySelectorAll(".db-cond").forEach((b, i) => { b.textContent = cond(i ? data.work.condition : data.wip.condition); });
    g.dataset.pv = "1"; return; }
  const ed = box.querySelector(".db-editor"); box.innerHTML = (K === "C" ? kpis(data) : "") + table(data); if (ed) box.querySelector(".db-card").appendChild(ed);
};
const tick = async () => { if (!data && document.querySelector("#dashBody .db-grid")) data = await (await fetch("/api/dashboard")).json(); paint(); };
new MutationObserver(tick).observe(document.body, { childList: true, subtree: true }); tick();
}`;
// D: 見出しのタブを足さない（ブランドを押すとダッシュボード）
const brandHome = ["script", `{ const run = () => { const t = document.querySelector("#tabDash"); if (t && !t.dataset.pv) { t.dataset.pv = "1"; t.style.cssText = "width:1px;min-width:1px;padding:0;margin:0;overflow:hidden;opacity:0"; }
  const b = document.querySelector("header .brand h1"); if (b && !b.dataset.pv) { b.dataset.pv = "1"; b.style.cursor = "pointer"; b.title = "ダッシュボード（Alt+0）";
    b.insertAdjacentHTML("beforeend", '<small style="display:block;font-size:10px;font-weight:700;opacity:.8;letter-spacing:.08em">⌂ ダッシュボード</small>'); } };
  run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];

export const PROPOSALS = [
  { key: "0", name: "今（2 枚。左は多い順の棒・右は名前の順の表。タブ 5 つ）", css: "", ops: [] },
  { key: "A", name: "設備の軸で 1 枚の表（設備｜仕掛の棒と数｜前日の直ごと〈濃淡〉・計）。並びは仕掛の多い順", css, ops: [["script", page("A")]] },
  { key: "B", name: "2 枚のまま、前日の表を濃淡・仕掛の棒を藍・並びを左右で名前の順にそろえる", css, ops: [["script", page("B")]] },
  { key: "C", name: "上に要約の札 3 つ（仕掛・前日の本数・前日 0 本の設備）、下に A の表", css, ops: [["script", page("C")]] },
  { key: "D", name: "A ＋ 見出しのタブを足さない（ブランド「LotScope」を押すとダッシュボード。タブは 4 つのまま）", css, ops: [["script", page("A")], brandHome] },
  { key: "E", name: "A ＋ 見出しを詰める（1440 以下は状態の札の「データ元」「待機中」を畳み〈接続の点だけ〉、タブの字を 14px に）", css: css + narrowHeader, ops: [["script", page("A")]] },
];
