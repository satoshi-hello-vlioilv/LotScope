// 2026-10 ダッシュボード。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dash-2.mjs --states dash,dash-cond
// 1 回目（2026-10-dash.mjs・.json）: 1 位 E 46.5 点。設備の軸で 1 枚の表（A 系）は加点が上位（75 点前後）だったが、案の再現で欠けた所
//   （条件の札が押せない・直の外の列が無い・元の時刻と合計が消えた）で −20 点ずつ引かれた。採点者が挙げた直す所:
//   ①条件の札を押せる（欄は札のすぐ下）②直の外の列を残す ③元の時刻・設備なしの行と合計を残す ④1280 の見出しは状態を隠さずに収める
//   ⑤0 を読める字（4.5 以上）に・仕掛があるのに前日 0 本の設備には色だけに頼らない印 ⑥直の列を固定の幅にして計を近づける・空き
// 2 回目の土台（今＝本物に作った A2）: ①〜⑥を本物の画面に入れた（dashboard.js の table）。見出しは 1440 以下でタブの絵を外し字を 14px（状態の札はそのまま）
// 案:
//   A2 今のまま（本物の 1 枚の表）
//   L  気にする所から並べる（前日 0 本・読めない設備を上に、その中は仕掛の多い順。0 本の行は淡い赤の地）
//   M  計の列にも棒（前日の本数を横の棒で。仕掛の棒と同じ形・別の色）
//   N  勤務体系ごとに分ける（交替勤務(1,2,3直) と CR2 の 4,5直 で見出しを分け、「–」の升を出さない）
//   C2 上に要約の札 3 つ（仕掛・前日の本数・前日 0 本の設備〈名前つき〉）、下に表（中の「前日 0 本」の行は札へ移す）

const css = `
.pvM{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.pvM span{width:70px;height:10px;background:var(--surface-4);border-radius:4px;overflow:hidden}
.pvM i{display:block;height:100%;background:var(--ok);border-radius:4px}
.pvL-row > *{background:#fdf1ee}
.pvN-head th{background:var(--surface-3);font-size:12.5px;color:var(--ro-ink);text-align:left!important}
.pv-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gap)}
.pv-kpi{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:12px 16px;display:flex;flex-direction:column;gap:2px}
.pv-kpi small{color:var(--muted);font-size:12.5px;font-weight:700}
.pv-kpi b{font-size:26px;font-variant-numeric:tabular-nums}
.pv-kpi b small{font-size:13px;margin-left:4px;color:var(--muted)}
.pv-kpi em{font-style:normal;font-size:13px;color:#7a2d22}
.pv-kpi.warn b{color:#a3322a}
`;
const page = (kind) => `{
const K = ${JSON.stringify(kind)};
let data = null;
const run = async () => {
  const card = document.querySelector("#dashBody .db-card"); if (!card || card.dataset.pv) return;
  if (!data) { data = await (await fetch("/api/dashboard")).json(); }
  if (card.dataset.pv || !card.isConnected) return; card.dataset.pv = "1";
  const body = card.querySelector(".db-table tbody"); if (!body) return;
  const rows = [...body.rows];
  const work = Object.fromEntries((data.work.items || []).map((x) => [x.equipment, x]));
  const name = (tr) => tr.querySelector("th").textContent.trim();
  if (K === "L") {
    const bad = rows.filter((tr) => tr.querySelector(".db-flag, .db-ng, .db-na"));
    bad.reverse().forEach((tr) => { tr.classList.add("pvL-row"); body.prepend(tr); });
  }
  if (K === "M") {
    const max = Math.max(1, ...(data.work.items || []).map((x) => (x.total && x.total.works) || 0));
    rows.forEach((tr) => { const td = tr.querySelector(".db-sum"); if (!td) return; const w = work[name(tr)], n = (w && w.total && w.total.works) || 0;
      const flag = td.querySelector(".db-flag"); td.innerHTML = '<div class="pvM"><span><i style="width:' + (n / max * 100).toFixed(0) + '%"></i></span><b>' + n + "</b></div>"; if (flag) td.firstChild.appendChild(flag); });
  }
  if (K === "N") {
    const groups = {}; rows.forEach((tr) => { const w = work[name(tr)]; const g = (w && w.pattern) || "（作業実績なし・読めない）"; (groups[g] = groups[g] || []).push(tr); });
    const cols = card.querySelectorAll(".db-table thead tr:last-child th").length + 2;
    body.innerHTML = "";
    Object.entries(groups).forEach(([g, trs]) => { body.insertAdjacentHTML("beforeend", '<tr class="pvN-head"><th colspan="' + cols + '">勤務体系: ' + TPA.esc(g) + "</th></tr>"); trs.forEach((tr) => body.appendChild(tr)); });
  }
  if (K === "C2") {
    const zero = (data.work.items || []).filter((x) => !x.error && x.total && !x.total.works && (data.wip.items || []).some((y) => y.equipment === x.equipment && y.lots)).map((x) => x.equipment);
    const works = (data.work.items || []).reduce((a, x) => a + ((x.total && x.total.works) || 0), 0);
    const warn = card.querySelector(".db-warn"); if (warn) warn.remove();
    card.insertAdjacentHTML("beforebegin", '<div class="pv-cards"><div class="pv-kpi"><small>仕掛</small><b>' + (data.wip.total || 0).toLocaleString() + '<small>ロット</small></b></div>'
      + '<div class="pv-kpi"><small>前日の実績（' + ((data.work.days || [])[0] || "").slice(5).replace("-", "/") + '・現場歴）</small><b>' + works + '<small>本</small></b></div>'
      + '<div class="pv-kpi' + (zero.length ? " warn" : "") + '"><small>仕掛があるのに前日 0 本の設備</small><b>' + zero.length + '<small>台</small></b><em>' + zero.join("・") + "</em></div></div>");
  }
};
new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); run();
}`;

export const PROPOSALS = [
  { key: "0", name: "今＝A2（本物の 1 枚の表）", css: "", ops: [] },
  { key: "L", name: "気にする所から並べる（前日 0 本・読めない設備を上に。淡い赤の地）", css, ops: [["script", page("L")]] },
  { key: "M", name: "計の列にも棒（前日の本数を横の棒で。仕掛の棒と同じ形・別の色）", css, ops: [["script", page("M")]] },
  { key: "N", name: "勤務体系ごとに分ける（見出しの行で分け、「–」の升を減らす）", css, ops: [["script", page("N")]] },
  { key: "C2", name: "上に要約の札 3 つ（仕掛・前日の本数・前日 0 本の設備〈名前つき〉）、下に表", css, ops: [["script", page("C2")]] },
];
