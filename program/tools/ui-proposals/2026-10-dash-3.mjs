// 2026-10 ダッシュボード。3 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dash-3.mjs --states dash,dash-cond
// 2 回目（2026-10-dash-2.mjs）の 1 位は A2（75.3 点。合格点 90 に届かず）。採点者が挙げた直す所を本物の画面（今＝A3）に入れた:
//   ①濃淡の札の白い字（コントラスト 2.2）→ 字はいつも濃い色・地は淡い藍の濃淡まで ②0 の字を #5f6e7c に ③条件の欄の × を白地用の色に
//   ④直の列を固定の幅（72px）に・計を近づける ⑤最初に見る物: 題の行に「前日 0 本 CAL・SL1」の札を 1 つ（別の行は足さない）
// 案（名前は前の回と重ならない）:
//   A3 今のまま（本物）
//   M3 計の列にも棒（藍の系統の 1 色。直の濃淡と同じ調子）
//   R  計を仕掛のすぐ右へ（設備｜仕掛｜前日の計｜直ごと）。2 つの数を並べて見比べる
//   S  行を高くし字を大きく（1728 の下の空きを使う。1440 以下は今のまま）
//   T  表の幅を中身に合わせ（仕掛の棒を 420px まで）、右に「数え方」の面（何を数えたか・条件・元の時刻）を置き、題の下の説明の行を外す

const css = `
.pvM3{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.pvM3 span{width:64px;height:10px;background:var(--surface-4);border-radius:4px;overflow:hidden}
.pvM3 i{display:block;height:100%;background:rgba(63,101,145,.55);border-radius:4px}
@media (min-width:1441px){ .pvS .db-table th,.pvS .db-table td{padding:9px 12px;font-size:15px} .pvS .db-table td.db-lots .db-bar{height:16px} }
.pvT .db-grid{display:grid;grid-template-columns:minmax(0,auto) 300px;align-items:start}
.pvT .db-table .db-lots{min-width:0;width:420px}
.pvT .db-meta{display:none}
.pvT-side{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:14px 16px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--ro-ink)}
.pvT-side h4{margin:0;font-size:14px;color:var(--ink)}
.pvT-side dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 10px}
.pvT-side dt{font-weight:700;color:var(--ink)}
.pvT-side dd{margin:0}
`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const M3 = keep(`const t = document.querySelector("#dashBody .db-table"); if (!t || t.dataset.pv) return; t.dataset.pv = "1";
  const sums = [...t.querySelectorAll("tbody td.db-sum")], max = Math.max(1, ...sums.map((td) => +td.childNodes[0].textContent || 0));
  sums.forEach((td) => { const n = +td.childNodes[0].textContent || 0, flag = td.querySelector(".db-flag");
    td.innerHTML = '<div class="pvM3"><span><i style="width:' + (n / max * 100).toFixed(0) + '%"></i></span><b>' + n + "</b></div>"; if (flag) td.firstChild.appendChild(flag); });`);
const R = keep(`const t = document.querySelector("#dashBody .db-table"); if (!t || t.dataset.pv) return; t.dataset.pv = "1";
  const h1 = t.querySelector("thead tr:first-child"), h2 = t.querySelector("thead tr:last-child");
  const sumH = h2.querySelector(".db-sum"); const lotsH = h1.querySelector("th.db-lots");
  const th = document.createElement("th"); th.rowSpan = 2; th.className = "num db-sum db-grp"; th.innerHTML = "前日の計"; lotsH.after(th); sumH.remove();
  const grp = h1.querySelector("th.db-grp:not(.db-sum)"); if (grp) grp.colSpan = grp.colSpan - 1;
  t.querySelectorAll("tbody tr").forEach((tr) => { const s = tr.querySelector("td.db-sum"); const l = tr.querySelector("td.db-lots"); if (s && l) { s.classList.add("db-grp"); l.after(s); } });`);
const S = keep(`const b = document.querySelector("#dashBody"); if (b && !b.classList.contains("pvS")) b.classList.add("pvS");`);
const T = ["script", `{ let d = null; const run = async () => { const b = document.querySelector("#dashBody"), g = b && b.querySelector(".db-grid"); if (!g || g.dataset.pv) return;
  if (!d) d = await (await fetch("/api/dashboard")).json(); if (g.dataset.pv) return; g.dataset.pv = "1"; b.classList.add("pvT");
  const cond = (c) => c && c.filters && c.filters.length ? c.filters.map((f) => f.column + " " + f.op + " " + f.value).join("・") : "すべて";
  const at = d.wip.mirror && d.wip.mirror.at ? new Date(d.wip.mirror.at * 1000) : null, p = TPA.pad2;
  g.insertAdjacentHTML("beforeend", '<aside class="pvT-side"><h4>数え方</h4><dl><dt>仕掛</dt><dd>' + TPA.esc(d.wip.source.name) + " の「" + TPA.esc(d.wip.equipColumn) + "」の先頭の設備ごとのロット数（同じロットは 1）</dd>"
    + "<dt>前日</dt><dd>" + TPA.esc((d.work.days[0] || "").slice(5).replace("-", "/")) + "（現場歴。3 直の跨いだ後は前の日）の作業の数。作業開始が同じ行（分割したロット）は 1 本</dd>"
    + "<dt>直</dt><dd>設備ごとの勤務体系。時間帯に入らない作業は「直の外」</dd><dt>対象</dt><dd>仕掛: " + TPA.esc(cond(d.wip.condition)) + "<br>実績: " + TPA.esc(cond(d.work.condition)) + "</dd>"
    + "<dt>元</dt><dd>仕掛 " + (at ? (at.getMonth() + 1) + "/" + at.getDate() + " " + p(at.getHours()) + ":" + p(at.getMinutes()) : "-") + "・設備なし " + d.wip.noEquipment + "</dd></dl></aside>"); };
  run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];

export const PROPOSALS = [
  { key: "0", name: "今＝A3（本物の 1 枚の表。2 回目の指摘を入れた）", css: "", ops: [] },
  { key: "M3", name: "計の列にも棒（藍の系統の 1 色）", css, ops: [M3] },
  { key: "R", name: "計を仕掛のすぐ右へ（設備｜仕掛｜前日の計｜直ごと）", css, ops: [R] },
  { key: "S", name: "行を高くし字を大きく（1728 の下の空きを使う。1440 以下は今のまま）", css, ops: [S] },
  { key: "T", name: "表の幅を中身に合わせ、右に「数え方」の面（何を数えたか・条件・元の時刻）。題の下の説明の行を外す", css, ops: [T] },
];
