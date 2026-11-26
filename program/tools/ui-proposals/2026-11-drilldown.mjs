// 改良「ダッシュボードの数から明細へ」（利用者の改良依頼 2026-11-17 の 7「ダッシュボードの表やグラフの数値から、簡易的(一時的)に明細まで見られるような機能が欲しいです。
// イメージはEXCELのピボットテーブルの集計されたデータのドリルダウン機能です。」）の案（回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面（ui-harness.mjs の状態 drill-entry 〜 drill-off。この比べのために readcol-off の後ろへ足した）:
//   drill-entry … 明細への入口が見える所（案の window.__drillEntry。今は横棒「保留」を右クリックしたメニュー。明細の項目は無い）
//   drill       … 合わせた表「設備ごとの仕掛と前日の実績」の L-1 の仕掛ロット数（231）から明細を開いた所（案の window.__drillGo("table")）
//   drill-chart … 横棒「仕掛区分ごとの仕掛ロット数」の 保留（216）から
//   drill-kpi   … 数字のパネル「仕掛ロット数」（1,200）から
//   drill-more  … 次の段（案の window.__drillMore）。A・B・C・D・E は明細を開いたまま別の数（横棒の 生産 654）を開いた所、F は覗きから「すべて見る」を押した所
//   drill-off   … 片付ける（案の window.__drillClose）
//
//   TPA_UI_EXE=/home/user/LotScope/desktop/target/debug/examples/ui_serve TPA_UI_PROGRAM=<作業場所>/program \
//     node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-drilldown.mjs \
//     --from drill-entry --states drill-entry,drill,drill-chart,drill-kpi,drill-more,drill-off   （--view 1536x864・--view 1280x720 でも。1 つずつ流す）
//
// 明細の行は、案の頁の中で本物の仕掛（GET /api/src/wip?page_size=5000。1,200 行）を読み、パネルと同じ決まりで選んだ行（見本ではない）:
//   L-1 … 残仕掛設備ｺｰｽ の先頭の設備を NFKC で読みそろえた名前が L-1（231 行）。保留 … 仕掛区分 ＝ 保留（216 行）。仕掛ロット数 … 全部（1,200 行）。
//   ロット番号の重なりの無い数（ロット数）を頁の中で数え、パネルの数と同じかを確かめの札に出す。CR1 のように、一覧の「＝」の絞り（字のまま 185）と
//   ダッシュボードの数（全角の ＣＲ１ も同じ設備に読む 186）が食い違う形があるので、窓の側の道はパネルと同じ鍵で行を選ぶ（common_build (1)）。
//
// どの案にも入れる直し（COMMON。採点のファイルの common_build）:
//   (1) 窓の側の道 POST /api/dashboard/drill {panel: 画面の asked(p)〈スライサー・パネルを絞る・パネルのスライサー込み〉, drill: {r: [鍵…], c: [鍵…], m: 値の番号, group: 合わせた表のまとまり, side: 合わせるの側}, sort, offset, limit}。
//       pivot::query_many に Ask.drill を足し、行ごとに作っている鍵（ks）がセルの鍵の頭と同じ行だけを、行の番号（rowid）と一緒に残す（小計・総計は鍵が短いだけで同じ道）。
//       答えは {columns, rows, total, lots, check: {cell, again}, conds}。again は残した行で同じ数え方をし直した数で、パネルの数と違えば知らせる
//   (2) 明細の列: 組みに使った列（行・列・値・条件・期間の列）を先に、その後は一覧の表示列の設定（同じデータ元の表の並び・隠し）。並べ替えは見出し、数千行は見える分だけ描く（virtual-rows.js）
//   (3) 一時的: 明細は画面の中だけ（覚えない・保存しない・組みを変えない）。閉じれば消える
//   (4) その先: 「一覧で開く」は同じ行を一覧の一時の絞り（ロット番号の in。1,000 件を超えたら tuple_in でなく行の番号の一時の絞り）で開く・Excel に出力（xlsx-writer.js）・コピー（TSV）
//   (5) 出せない形の知らせ: 値の計算（÷1000 など）は明細の合計の行に 前 → 後 を出す・割合／累計は元の行を出し「この数は割合です」・基準の数（稼働率など）は割る数が行ではないと言う・
//       別のデータと合わせる（差）は側ごとに 2 つ・ガントの棒は 1 つの作業・ABC は品種の行・上位 N の「その他」は残りの鍵・計算列は式つき

/* ------------------------------------------------------------------ 共通の部品（頁の中で動く。window.DR） */
function lib() {
  if (window.DR) return;
  const DR = (window.DR = { open: null, hist: [], tabs: [] });
  DR.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  DR.num = (n) => Number(n).toLocaleString("ja-JP");
  DR.keep = (fn, ms = 200) => { const t = () => { try { fn(); } catch (e) { console.warn("案:", e.message); } }; t(); setInterval(t, ms); };
  DR.load = async () => {
    if (DR.rows || DR.loading) return; DR.loading = true;
    try { const d = await (await fetch("/api/src/wip?page_size=5000", { cache: "no-store" })).json(); DR.rows = d.rows || []; DR.cols = (d.columns || []).map((c) => c.name || c); }
    catch (_) { DR.loading = false; }
  };
  DR.eq = (r) => String(r["残仕掛設備ｺｰｽ"] || "").trim().split(/\s+/)[0].normalize("NFKC");
  DR.cases = {
    table: { pid: "board", panel: "設備ごとの仕掛と前日の実績", cell: "L-1 · 仕掛ロット数", short: "L-1", value: 231, data: "仕掛",
      conds: [["設備", "L-1", "残仕掛設備ｺｰｽ の先頭（全角も同じ設備）"], ["まとまり", "仕掛ロット数", "合わせた表の 1 つ目"]], used: ["残仕掛設備ｺｰｽ"], pick: (r) => DR.eq(r) === "L-1" },
    chart: { pid: "wipClass", panel: "仕掛区分ごとの仕掛ロット数", cell: "保留", short: "保留", value: 216, data: "仕掛",
      conds: [["仕掛区分", "保留", ""]], used: ["仕掛区分"], pick: (r) => r["仕掛区分"] === "保留" },
    kpi: { pid: "wipTotal", panel: "仕掛ロット数", cell: "総計", short: "仕掛ロット数", value: 1200, data: "仕掛",
      conds: [], used: [], pick: () => true },
    chart2: { pid: "wipClass", panel: "仕掛区分ごとの仕掛ロット数", cell: "生産", short: "生産", value: 654, data: "仕掛",
      conds: [["仕掛区分", "生産", ""]], used: ["仕掛区分"], pick: (r) => r["仕掛区分"] === "生産" },
  };
  DR.LIST = ["ロット番号", "仕掛区分", "製造材質", "製造調質", "用途名", "残仕掛設備ｺｰｽ", "実績_設備ｺｰｽ", "設計_設備ｺｰｽ", "取引先", "納入先", "鋳造番号", "検査番号", "オーダー番号", "BOX設計_設備名", "設計_PIT炉番炉順"];
  DR.get = (kind) => {
    const c = DR.cases[kind], rows = (DR.rows || []).filter(c.pick);
    const lots = new Set(rows.map((r) => r["ロット番号"])).size;
    const cols = c.used.concat(DR.LIST.filter((x) => !c.used.includes(x)));
    return { kind, ...c, rows, lots, ok: lots === c.value, cols, hidden: (DR.cols || []).length - cols.length };
  };
  /** 確かめの札（行の数・ロット数がパネルの数と同じか） */
  DR.check = (d, short = false) => `<span class="dr-ok${d.ok ? "" : " is-bad"}" title="明細のロット番号の重なりの無い数と、パネルの数を比べました">${d.ok ? "✓" : "!"} ${DR.num(d.rows.length)} 行・${DR.num(d.lots)} ロット${short ? "" : `（パネルの数 ${DR.num(d.value)} と${d.ok ? "同じ" : "違います"}）`}</span>`;
  /** 絞りの札（パネルの条件・スライサー・この数の行と列） */
  DR.conds = (d) => {
    const base = [["データ", d.data, "パネル"], ["期間", "なし", "パネル"], ["スライサー", "期間 組んだまま・設備 すべて", "ダッシュボード"]];
    return `<div class="dr-conds">${base.map(([k, v, f]) => `<span class="dr-c is-base" title="${DR.esc(f)}の決まり"><i>${DR.esc(k)}</i>${DR.esc(v)}</span>`).join("")}`
      + (d.conds.length ? d.conds.map(([k, v, n]) => `<span class="dr-c is-cell" title="${DR.esc(n || "この数の行・列")}"><i>${DR.esc(k)}</i>＝ ${DR.esc(v)}</span>`).join("") : '<span class="dr-c is-cell"><i>この数</i>総計（すべての行）</span>')
      + "</div>";
  };
  /** 明細の表（組みに使った列を先に・見出しで並べ替え・数千行は見える分だけ描く） */
  DR.table = (d, { max = 60, sort = null, compact = false, ncol = 99 } = {}) => {
    let rows = d.rows.slice();
    if (sort) rows.sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), "ja") || String(a["ロット番号"]).localeCompare(String(b["ロット番号"])));
    const cols = d.cols.slice(0, ncol);
    const head = `<tr><th class="dr-n">#</th>${cols.map((c) => `<th class="${d.used.includes(c) ? "is-used" : ""}${sort === c ? " is-sort" : ""}" title="${d.used.includes(c) ? "この数の組みに使った列" : "一覧の表示列の並び"}">${d.used.includes(c) ? '<span class="dr-dot" aria-hidden="true"></span>' : ""}${DR.esc(c)}${sort === c ? " ▲" : ""}</th>`).join("")}</tr>`;
    const body = rows.slice(0, max).map((r, i) => `<tr><td class="dr-n">${i + 1}</td>${cols.map((c) => `<td class="${d.used.includes(c) ? "is-used" : ""}">${DR.esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("");
    const more = rows.length > max ? `<tr class="dr-more"><td colspan="${cols.length + 1}">… あと ${DR.num(rows.length - max)} 行（送ると読みます）</td></tr>` : "";
    // 計の行は表の外（送っても隠れず、下の行と重ならない）
    const sum = max > 5 ? `<div class="dr-sumline"><b>計</b> ${DR.num(d.rows.length)} 行・ロット数 ${DR.num(d.lots)}<span>列 ${cols.length}${d.hidden > 0 ? `（ほかに一覧で隠している ${d.hidden} 列）` : ""}</span></div>` : "";
    return `<div class="dr-tbox"><div class="dr-tw${compact ? " is-compact" : ""}"><table class="dr-t"><thead>${head}</thead><tbody>${body}${more}</tbody></table></div>${sum}</div>`;
  };
  DR.acts = ({ close = true, list = true, main = "list" } = {}) => `<div class="dr-acts">`
    + (list ? `<button type="button" class="${main === "list" ? "btn-primary" : "pv-btn"}" title="同じ行を、一覧の画面で一時の絞りとして開きます（一覧の覚えは変えません）">一覧で開く ›</button>` : "")
    + `<button type="button" class="pv-btn" title="明細の行を Excel のファイルに出力します">↓ Excel に出力</button><button type="button" class="pv-btn" title="明細の行を表の形でコピーします（Excel に貼れます）">コピー</button>`
    + (close ? '<span class="dr-sp"></span><button type="button" class="btn-ghost" data-dr-close>閉じる</button>' : "") + "</div>";
  DR.temp = '<span class="dr-temp">一時の表示です。閉じると消え、ダッシュボードの組みは変わりません</span>';
  /** 明細の元の数に印（表のセル・棒・数字） */
  DR.target = (kind) => {
    const p = (id) => document.querySelector(`#dashGrid .db-p[data-id="${id}"]`);
    if (kind === "table") return p("board")?.querySelector("tbody tr:first-child td.db-lots");
    if (kind === "chart") return [...(p("wipClass")?.querySelectorAll("svg rect") || [])].find((r) => r.querySelector("title")?.textContent.startsWith("保留"));
    if (kind === "chart2") return [...(p("wipClass")?.querySelectorAll("svg rect") || [])].find((r) => r.querySelector("title")?.textContent.startsWith("生産"));
    if (kind === "kpi") return p("wipTotal")?.querySelector(".dp-num");
    return null;
  };
  DR.mark = () => {
    document.querySelectorAll(".dr-src").forEach((e) => e.classList.remove("dr-src"));
    const k = DR.open && DR.open.kind; const el = k && DR.target(k); if (el) el.classList.add("dr-src");
  };
  DR.hover = (kind) => {   // 入口: 数の上に指を置いた形（押せる印）
    const el = DR.target(kind); if (!el) return null;
    el.classList.add("dr-hov");
    const host = el.closest(".db-p"); host?.classList.add("dr-hovp");
    return el;
  };
  DR.tip = (el, html, cls = "") => {   // 数の近くに出す小さな札（ページの座標）
    document.querySelector(".dr-tip")?.remove();
    const b = el.getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", `<div class="dr-tip ${cls}" style="left:${Math.round(b.left + Math.min(b.width, 160) + 8)}px;top:${Math.round(b.top - 6)}px">${html}</div>`);
  };
  DR.css = `
.dr-src{outline:2.5px solid #e08a00 !important;outline-offset:2px;border-radius:4px}
rect.dr-src{outline:none !important;stroke:#e08a00;stroke-width:3px}
.dr-hov{cursor:pointer}
td.dr-hov{background:#fff4dd !important;box-shadow:inset 0 0 0 1.5px #e0a030}
rect.dr-hov{stroke:#e0a030;stroke-width:2px}
.dp-num.dr-hov{text-decoration:underline dotted #e0a030 3px;text-underline-offset:6px}
.dr-tip{position:fixed;z-index:60;padding:6px 10px;border-radius:8px;background:#1f2d3a;color:#fff;font-size:12.5px;font-weight:700;line-height:1.5;box-shadow:0 6px 18px rgba(15,30,50,.25);white-space:nowrap;pointer-events:none}
.dr-tip small{display:block;font-weight:600;color:#cfd9e3;font-size:11.5px}
.dr-tip kbd{font:inherit;padding:0 5px;border:1px solid #6b7d8f;border-radius:4px;margin:0 2px}
.dr-ok{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;background:#e5f4ea;color:#17603a;font-size:12.5px;font-weight:800;white-space:nowrap}
.dr-ok.is-bad{background:#fdecec;color:#9b1c1c}
.dr-conds{display:flex;flex-wrap:wrap;gap:5px}
.dr-c{display:inline-flex;align-items:center;gap:5px;padding:2px 9px 2px 3px;border-radius:999px;border:1px solid #d6dee6;background:#f6f8fa;font-size:12.5px;font-weight:700;color:#2c3a48;white-space:nowrap}
.dr-c i{font-style:normal;font-size:11.5px;font-weight:800;padding:0 6px;border-radius:999px;background:#e4e9ef;color:#3e4f60}
.dr-c.is-cell{border-color:#e9c27a;background:#fff7e6}.dr-c.is-cell i{background:#f3dcae;color:#6b4300}
.dr-tbox{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}.dr-tbox .dr-tw{flex:1}
.dr-tw{overflow:auto;min-height:0;border:1px solid #dbe2ea;border-radius:8px;background:#fff}
.dr-t{border-collapse:separate;border-spacing:0;font-size:13px;width:max-content;min-width:100%}
.dr-t th,.dr-t td{padding:5px 10px;border-bottom:1px solid #eef1f4;white-space:nowrap;text-align:left}
.dr-t thead th{position:sticky;top:0;z-index:1;background:#f3f6f9;font-size:12.5px;font-weight:800;color:#3e4f60;border-bottom:1px solid #d6dee6;cursor:pointer}
.dr-t th.is-used{background:#fbeccc;color:#5a3a00}.dr-t td.is-used{background:#fffaf0;font-weight:700}
.dr-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#d48800;margin-right:5px;vertical-align:1px}
.dr-t .dr-n{color:#7a8794;font-variant-numeric:tabular-nums;text-align:right;width:1%}
.dr-t tbody tr:nth-child(even) td{background-color:#fafbfc}.dr-t tbody tr:nth-child(even) td.is-used{background:#fff6e3}
.dr-t tr.dr-more td{color:#5d6b78;font-size:12.5px;text-align:center;background:#fff}
.dr-sumline{display:flex;align-items:baseline;gap:8px;flex:none;padding:5px 10px;margin-top:-4px;border:1px solid #d6dee6;border-top:none;border-radius:0 0 8px 8px;background:#eef2f6;font-size:13px;font-weight:800;color:#1f2d3a}
.dr-sumline span{margin-left:auto;font-size:12px;font-weight:700;color:#5d6b78}
.dr-tw.is-compact .dr-t{font-size:12.5px}.dr-tw.is-compact .dr-t th,.dr-tw.is-compact .dr-t td{padding:4px 8px}
.dr-acts{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dr-acts .btn-primary,.dr-acts .pv-btn,.dr-acts .btn-ghost{height:32px;padding:0 14px;white-space:nowrap}
.dr-sp{flex:1}
.dr-temp{font-size:12px;color:#5d6b78}
.dr-x{width:30px;height:30px;border:1px solid #d6dee6;border-radius:8px;background:#fff;font-size:16px;line-height:1;color:#3e4f60;cursor:pointer;flex:none}
.dr-h{display:flex;align-items:center;gap:10px;min-width:0}
.dr-h h2{margin:0;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dr-h .dr-from{font-size:12.5px;color:#5d6b78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dr-big{font-size:26px;font-weight:800;color:#1f2d3a;font-variant-numeric:tabular-nums}.dr-big small{font-size:14px;margin-left:3px;color:#3e4f60}
.dr-line{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}
`;
  DR.start = (css) => {
    if (window.__drOn) return false; window.__drOn = true;
    document.head.append(Object.assign(document.createElement("style"), { textContent: DR.css + css }));
    DR.load();
    return true;
  };
}

/* ------------------------------------------------------------------ A: 押すと右の面（グリッドが左へ縮む。組む所と同じ置き場） */
function scriptA() {
  const DR = window.DR; if (!DR.start(window.__drCSS)) return;
  window.__drillEntry = () => { const el = DR.hover("chart"); if (el) DR.tip(el, `保留 216 ロット<small>押すと明細（元の行）を右に出します</small>`); };
  window.__drillGo = (k) => { document.querySelector(".dr-tip")?.remove(); document.querySelectorAll(".dr-hov").forEach((e) => e.classList.remove("dr-hov")); if (DR.open) DR.hist.push(DR.open.kind); DR.open = { kind: k }; DR.dirty = true; };
  window.__drillMore = () => window.__drillGo("chart2");
  window.__drillClose = () => { DR.open = null; DR.hist = []; DR.dirty = true; };
  DR.keep(() => {
    const stage = document.querySelector("#dashScreen .db-stage"); if (!stage) return;
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.hist.length}|${!!DR.rows}` : "";
    if (stage.dataset.drk === k && !DR.dirty) return; DR.dirty = false; stage.dataset.drk = k;
    stage.querySelector(".dra")?.remove();
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), back = DR.hist.length ? DR.get(DR.hist[DR.hist.length - 1]) : null;
    stage.insertAdjacentHTML("beforeend", `<aside class="dra" aria-label="明細">
      <div class="dr-h">${back ? `<button type="button" class="pv-btn" title="前に開いた明細へ">‹ ${DR.esc(back.short)}</button>` : ""}<h2>明細 · ${DR.esc(d.cell)}</h2><span class="dr-sp"></span><button type="button" class="dr-x" data-dr-close aria-label="閉じる">×</button></div>
      <div class="dr-from">${DR.esc(d.panel)} の数から</div>
      <div class="dr-line"><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d)}</div>
      ${DR.conds(d)}
      ${DR.table(d)}
      <div class="dra-ft">${DR.acts()}${DR.temp}</div></aside>`);
  });
}
const CSS_A = `
.dra{flex:0 0 clamp(440px,40%,760px);min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:#fff;border:1px solid #d6dee6;border-radius:10px;box-shadow:0 8px 24px rgba(15,30,50,.12)}
.dra .dr-tw{flex:1}
.dra-ft{display:flex;flex-direction:column;gap:6px}
`;

/* ------------------------------------------------------------------ B: ダブルクリックで下の引き出し（Excel の新しいシートのように、明細をタブで重ねる） */
function scriptB() {
  const DR = window.DR; if (!DR.start(window.__drCSS)) return;
  window.__drillEntry = () => { const el = DR.hover("chart"); if (el) DR.tip(el, `保留 216 ロット<small>ダブルクリックで明細（Excel のピボットと同じ）</small>`); };
  window.__drillGo = (k) => { document.querySelector(".dr-tip")?.remove(); document.querySelectorAll(".dr-hov").forEach((e) => e.classList.remove("dr-hov")); if (!DR.tabs.includes(k)) DR.tabs.push(k); DR.open = { kind: k }; DR.dirty = true; };
  window.__drillMore = () => window.__drillGo("chart2");
  window.__drillClose = () => { DR.open = null; DR.tabs = []; DR.dirty = true; };
  DR.keep(() => {
    const scr = document.querySelector("#dashScreen"); if (!scr) return;
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}` : "";
    if (scr.dataset.drk === k && !DR.dirty) return; DR.dirty = false; scr.dataset.drk = k;
    scr.querySelector(".drb")?.remove(); scr.classList.toggle("has-drb", !!DR.open);
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind);
    const tabs = DR.tabs.map((t, i) => { const x = DR.get(t); return `<button type="button" class="drb-tab${t === DR.open.kind ? " is-on" : ""}" title="${DR.esc(x.panel)} の ${DR.esc(x.cell)}"><span class="drb-n">明細 ${i + 1}</span>${DR.esc(x.short)} <b>${DR.num(x.value)}</b><span class="drb-x" aria-label="この明細を閉じる">×</span></button>`; }).join("");
    scr.insertAdjacentHTML("beforeend", `<section class="drb" aria-label="明細">
      <div class="drb-bar"><span class="drb-lab">明細</span><div class="drb-tabs" role="tablist">${tabs}</div><span class="dr-sp"></span>${DR.temp}<button type="button" class="dr-x" data-dr-close aria-label="明細をすべて閉じる" title="明細をすべて閉じる">×</button></div>
      <div class="drb-body"><div class="drb-side"><div class="dr-from">${DR.esc(d.panel)} の</div><div class="drb-cell">${DR.esc(d.cell)}</div><div class="dr-line"><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d, true)}</div><div class="dr-acts"><button type="button" class="btn-primary">一覧で開く ›</button><button type="button" class="pv-btn" title="明細の行を Excel のファイルに出力します">↓ Excel</button><button type="button" class="pv-btn">コピー</button></div>${DR.conds(d)}</div>${DR.table(d, { compact: true })}</div></section>`);
  });
}
const CSS_B = `
.drb{position:fixed;left:12px;right:12px;bottom:0;height:min(46vh,520px);z-index:30;min-height:0;display:flex;flex-direction:column;background:#fff;border:1px solid #c9d3de;border-radius:10px;border-bottom:none;border-radius:10px 10px 0 0;box-shadow:0 -10px 28px rgba(15,30,50,.22);overflow:hidden}
.drb-bar{display:flex;align-items:center;gap:8px;padding:6px 8px 0 12px;background:#eef2f6;border-bottom:1px solid #d6dee6;min-width:0}
.drb-lab{font-size:13px;font-weight:800;color:#3e4f60}
.drb-tabs{display:flex;gap:2px;min-width:0;overflow:hidden}
.drb-tab{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 12px;border:1px solid #d6dee6;border-bottom:none;border-radius:8px 8px 0 0;background:#f7f9fb;font:inherit;font-size:13px;font-weight:700;color:#3e4f60;white-space:nowrap;cursor:pointer}
.drb-tab.is-on{background:#fff;color:#1f2d3a;box-shadow:inset 0 3px 0 #e08a00;margin-bottom:-1px;height:33px}
.drb-n{font-size:11.5px;color:#6b7a88;font-weight:800}
.drb-x{margin-left:2px;width:18px;height:18px;border-radius:4px;display:inline-grid;place-items:center;color:#6b7a88}
.drb-bar .dr-x{width:26px;height:26px;margin-bottom:4px}
.drb-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(220px,260px) minmax(0,1fr);gap:12px;padding:10px 12px}
.drb-side{display:flex;flex-direction:column;gap:7px;min-width:0;overflow:auto}
.drb-cell{font-size:16px;font-weight:800;color:#1f2d3a}
.drb-side .dr-big{font-size:22px}.drb-side{gap:6px}
.drb-same{font-size:12px;color:#3e4f60}
.drb-side .dr-acts{gap:6px}.drb-side .dr-acts .btn-primary,.drb-side .dr-acts .pv-btn{height:30px;padding:0 10px}
.drb-side .dr-line{gap:6px 8px}
`;

/* ------------------------------------------------------------------ C: 右クリックの「この数の明細…」とダブルクリックで、真ん中の窓 */
function scriptC() {
  const DR = window.DR; if (!DR.start(window.__drCSS)) return;
  window.__drillEntry = () => {
    const el = DR.target("chart"); if (!el) return;
    const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 2 }));
    setTimeout(() => {
      const m = document.querySelector(".tpa-menu"); if (!m) return;
      const first = m.querySelector("button");
      first?.insertAdjacentHTML("beforebegin", '<button type="button" class="drc-mi"><span aria-hidden="true">☰</span><span>この数の明細を見る…<small>保留 · 216 ロット</small></span><kbd>ダブルクリック</kbd></button>');
    }, 120);
  };
  window.__drillGo = (k) => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); document.querySelector(".tpa-menu")?.remove(); if (DR.open) DR.hist.push(DR.open.kind); DR.open = { kind: k }; DR.dirty = true; };
  window.__drillMore = () => window.__drillGo("chart2");
  window.__drillClose = () => { DR.open = null; DR.hist = []; DR.dirty = true; };
  DR.keep(() => {
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.hist.length}|${!!DR.rows}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelector(".drc")?.remove();
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), prev = DR.hist.length ? DR.get(DR.hist[DR.hist.length - 1]) : null;
    document.body.insertAdjacentHTML("beforeend", `<div class="drc" role="dialog" aria-modal="true" aria-label="明細"><div class="drc-win">
      <div class="dr-h"><nav class="drc-crumb"><span>ダッシュボード</span>›<span>${DR.esc(d.panel)}</span>›<b>${DR.esc(d.cell)}</b></nav><span class="dr-sp"></span><button type="button" class="dr-x" data-dr-close aria-label="閉じる">×</button></div>
      <div class="drc-top"><div class="dr-line"><h2 class="drc-title">${DR.esc(d.cell)} の明細</h2><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d)}</div>
        ${prev ? `<button type="button" class="pv-btn drc-prev" title="この窓で前に見た明細">‹ 前の明細: ${DR.esc(prev.short)}（${DR.num(prev.value)}）</button>` : ""}</div>
      ${DR.conds(d)}
      ${DR.table(d, { max: 80 })}
      <div class="drc-ft">${DR.temp}<span class="dr-sp"></span>${DR.acts({ close: false })}<button type="button" class="btn-ghost" data-dr-close>閉じる</button></div></div></div>`);
  });
}
const CSS_C = `
.drc{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(22,32,43,.38)}
.drc-win{width:min(1180px,calc(100vw - 48px));height:min(820px,calc(100vh - 48px));display:flex;flex-direction:column;gap:9px;padding:14px 18px;background:#fff;border-radius:12px;box-shadow:0 18px 48px rgba(15,30,50,.3)}
.drc-crumb{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#5d6b78;min-width:0;white-space:nowrap;overflow:hidden}.drc-crumb b{color:#1f2d3a}
.drc-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.drc-title{margin:0;font-size:19px}
.drc-win .dr-tw{flex:1}
.drc-ft{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.drc-ft .dr-acts{flex:none}.drc-ft .btn-ghost{height:32px;padding:0 14px}
.tpa-menu .drc-mi{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;border-radius:6px;background:#fff4dd;font:inherit;font-size:13.5px;font-weight:800;color:#5a3a00;text-align:left;cursor:pointer;margin-bottom:4px}
.tpa-menu .drc-mi small{display:block;font-size:11.5px;font-weight:700;color:#7a5a1e}
.tpa-menu .drc-mi kbd{font:inherit;font-size:11.5px;color:#6b4300}
`;

/* ------------------------------------------------------------------ D: 押したパネルが裏返って明細（狭いパネルは一時的に広がる。「‹ 数に戻る」） */
function scriptD() {
  const DR = window.DR; if (!DR.start(window.__drCSS)) return;
  window.__drillEntry = () => { const el = DR.hover("chart"); if (!el) return; const b = el.getBoundingClientRect(); document.body.insertAdjacentHTML("beforeend", `<span class="drd-chip" style="left:${Math.round(b.right + 44)}px;top:${Math.round(b.top - 3)}px">明細 ›</span>`); DR.tip(el, "押すと、このパネルが裏返って明細になります", "is-low"); };
  window.__drillGo = (k) => { document.querySelectorAll(".dr-tip,.drd-chip").forEach((e) => e.remove()); document.querySelectorAll(".dr-hov").forEach((e) => e.classList.remove("dr-hov")); DR.open = { kind: k }; DR.dirty = true; };
  window.__drillMore = () => window.__drillGo("chart2");
  window.__drillClose = () => { DR.open = null; DR.dirty = true; };
  DR.keep(() => {
    const grid = document.querySelector("#dashGrid"); if (!grid) return;
    const k = DR.open ? `${DR.open.kind}|${!!DR.rows}|${window.innerWidth}x${window.innerHeight}` : "";
    if (grid.dataset.drk === k && !DR.dirty) return; DR.dirty = false; grid.dataset.drk = k;
    grid.querySelector(".drd")?.remove(); grid.querySelectorAll(".drd-under").forEach((e) => e.classList.remove("drd-under"));
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), pe = grid.querySelector(`.db-p[data-id="${d.pid}"]`); if (!pe) return;
    const g = grid.getBoundingClientRect(), b = pe.getBoundingClientRect();
    // 狭い・低いパネルは一時的に広げる（幅はグリッドの 6 割・高さは 7 割まで。グリッドの中に収める）
    // 広げるのは、グリッドの 45% より狭い・低いパネルだけ（広いパネルはそのままの枠で裏返す。隣のパネルの操作を覆わない）
    const w = b.width < g.width * 0.45 ? Math.min(g.width, g.width * 0.6) : b.width, h = b.height < g.height * 0.45 ? Math.min(g.height, g.height * 0.7) : b.height;
    const left = Math.min(b.left - g.left, g.width - w), top = Math.min(b.top - g.top, g.height - h), grown = w > b.width + 2 || h > b.height + 2;
    pe.classList.add("drd-under");
    grid.insertAdjacentHTML("beforeend", `<section class="drd${grown ? " is-grown" : ""}" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px" aria-label="${DR.esc(d.panel)} の明細">
      <div class="dr-h"><button type="button" class="pv-btn drd-back" data-dr-close>‹ 数に戻る</button><h2>${DR.esc(d.panel)}</h2><span class="drd-side">裏: 明細</span><span class="dr-sp"></span>${grown ? '<span class="drd-grow">一時的に広げています</span>' : ""}</div>
      <div class="dr-line"><span class="drd-cell">${DR.esc(d.cell)}</span><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d)}</div>
      ${DR.conds(d)}${DR.table(d, { compact: true })}<div class="drd-ft">${DR.acts({ close: false })}${DR.temp}</div></section>`);
  });
}
const CSS_D = `
.db-p.drd-under{visibility:hidden}
.drd{position:absolute;z-index:6;display:flex;flex-direction:column;gap:7px;padding:10px 12px;background:#fff;border:2px solid #e08a00;border-radius:10px;box-shadow:0 10px 30px rgba(15,30,50,.22);box-sizing:border-box;animation:drdflip .25s ease-out}
@keyframes drdflip{from{transform:perspective(900px) rotateY(-12deg);opacity:.5}to{transform:none;opacity:1}}
.drd .dr-tw{flex:1}
.drd-side{font-size:11.5px;font-weight:800;padding:1px 8px;border-radius:999px;background:#fbeccc;color:#6b4300;white-space:nowrap}
.drd-grow{font-size:12px;color:#5d6b78;white-space:nowrap}
.drd-cell{font-size:16px;font-weight:800;padding:1px 10px;border-radius:6px;background:#fff4dd;color:#5a3a00}
.drd-ft{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}
.drd-back{height:30px;font-size:13px}
.drd-chip{position:fixed;z-index:59;padding:2px 9px;border-radius:999px;background:#e08a00;color:#fff;font-size:12.5px;font-weight:800}
.dr-tip.is-low{transform:translateY(34px)}
`;

/* ------------------------------------------------------------------ E: 一覧の画面へ（見出しに一時のタブ。一覧と同じ表示列・並べ替え・Excel） */
function scriptE() {
  const DR = window.DR; if (!DR.start(window.__drCSS)) return;
  window.__drillEntry = () => { const el = DR.hover("chart"); if (el) DR.tip(el, `保留 216 ロット<small>ダブルクリックで一覧の一時のタブに明細を開きます</small>`); };
  window.__drillGo = (k) => { document.querySelector(".dr-tip")?.remove(); document.querySelectorAll(".dr-hov").forEach((e) => e.classList.remove("dr-hov")); if (!DR.tabs.includes(k)) DR.tabs.push(k); DR.open = { kind: k }; DR.dirty = true; };
  window.__drillMore = () => window.__drillGo("chart2");
  window.__drillClose = () => { DR.open = null; DR.tabs = []; DR.dirty = true; };
  DR.keep(() => {
    const nav = document.querySelector("header .screen-tabs"); if (!nav) return;
    const wip = [...nav.querySelectorAll(".screen-tab")].find((b) => b.querySelector(".tab-name")?.textContent.trim() === "仕掛");
    if (DR.open) { document.querySelector("#tabDash")?.setAttribute("aria-selected", "false"); wip?.setAttribute("aria-selected", "true"); }   // 明細を開いている間は、一覧（仕掛）のタブを選んだ形
    wip?.classList.toggle("dre-on", !!DR.open);
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    nav.querySelectorAll(".dre-tab").forEach((e) => e.remove()); document.querySelector(".dre")?.remove();
    if (!DR.open) { document.querySelector("#tabDash")?.setAttribute("aria-selected", "true"); wip?.setAttribute("aria-selected", "false"); }
    if (!DR.open || !DR.rows) return;
    // 見出しに新しいタブは足さない（1280 で見出しの右の操作が押し出される）。元のデータの一覧のタブ（仕掛）を選んだ形にし、上の縁を橙にする（字に重なる札は付けない）
    const d = DR.get(DR.open.kind), top = document.querySelector("header").getBoundingClientRect().bottom;
    document.body.insertAdjacentHTML("beforeend", `<div class="dre" style="top:${top}px">
      <div class="dre-band"><span class="dre-lab">明細（一時の絞り）</span><span class="dre-say">仕掛の一覧を、ダッシュボードの「<b>${DR.esc(d.panel)}</b>」の <b>${DR.esc(d.cell)}</b>（${DR.num(d.value)}）の行だけにしています。閉じると元の一覧に戻り、一覧と組みの覚えは変わりません</span><span class="dr-sp"></span>${DR.tabs.length > 1 ? `<span class="dre-prev">前の明細: ${DR.tabs.filter((t) => t !== DR.open.kind).map((t) => `<button type="button" class="dr-c">${DR.esc(DR.get(t).short)} ${DR.num(DR.get(t).value)}</button>`).join("")}</span>` : ""}<button type="button" class="pv-btn">‹ ダッシュボードへ戻る</button><button type="button" class="btn-ghost" data-dr-close>明細を閉じる</button></div>
      <div class="dre-bar"><span class="dr-big">${DR.num(d.rows.length)}<small>件</small></span>${DR.check(d)}${DR.conds(d)}<span class="dr-sp"></span><input class="dre-search" placeholder="明細を検索（* ? も）" aria-label="明細を検索"><button type="button" class="pv-btn">表示列…</button><button type="button" class="pv-btn">↓ Excel に出力</button><button type="button" class="pv-btn">コピー</button></div>
      ${DR.table(d, { max: 80 })}</div>`);
  });
}
const CSS_E = `
.screen-tab.dre-on{box-shadow:inset 0 3px 0 #e08a00}
.dre{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;background:var(--bg, #eef2f5)}
.dre-band{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:9px;border:1px solid #e6c98f;background:#fff8e8;font-size:13.5px;color:#3d2c08}
.dre-band .pv-btn,.dre-band .btn-ghost{height:30px;white-space:nowrap}
.dre-lab{padding:0 9px;border-radius:999px;background:#7a4b00;color:#fff;font-size:12px;font-weight:800;line-height:22px;white-space:nowrap}
.dre-say{flex:1 1 380px;min-width:0}
.dre-bar{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding:8px 12px;border-radius:9px;background:#fff;border:1px solid #dbe2ea}
.dre-bar .pv-btn{height:30px;white-space:nowrap}
.dre-search{height:30px;width:200px;border:1px solid #cfd8e1;border-radius:7px;padding:0 10px;font:inherit;font-size:13px}
.dre .dr-tw{flex:1}
.dre-prev{display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:#5a3a00;white-space:nowrap}.dre-prev .dr-c{cursor:pointer;font:inherit;font-size:12px}
`;

/* ------------------------------------------------------------------ F: 押すと数の横に覗き（5 行と確かめ）→「すべて見る」で大きく */
function scriptF() {
  const DR = window.DR; if (!DR.start(window.__drCSS)) return;
  window.__drillEntry = () => { const el = DR.hover("chart"); if (el) DR.tip(el, `保留 216 ロット<small>押すと、ここに明細の頭 5 行</small>`); };
  window.__drillGo = (k) => { document.querySelector(".dr-tip")?.remove(); document.querySelectorAll(".dr-hov").forEach((e) => e.classList.remove("dr-hov")); DR.open = { kind: k, full: false }; DR.dirty = true; };
  window.__drillMore = () => { DR.open = { kind: (DR.open && DR.open.kind) || "kpi", full: true }; DR.dirty = true; };
  window.__drillClose = () => { DR.open = null; DR.dirty = true; };
  DR.keep(() => {
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.open.full}|${!!DR.rows}|${window.innerWidth}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelector(".drf")?.remove();
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), el = DR.target(DR.open.kind); if (!el) return;
    if (DR.open.full) {
      const g = document.querySelector("#dashGrid").getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", `<section class="drf is-full" style="left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px" aria-label="明細">
        <div class="dr-h"><h2>明細 · ${DR.esc(d.panel)} · ${DR.esc(d.cell)}</h2><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d)}<span class="dr-sp"></span><button type="button" class="pv-btn">‹ 小さく</button><button type="button" class="dr-x" data-dr-close aria-label="閉じる">×</button></div>
        ${DR.conds(d)}${DR.table(d, { max: 80 })}<div class="drd-ft">${DR.acts({ close: false })}${DR.temp}</div></section>`);
      return;
    }
    const b = el.getBoundingClientRect(), W = 560, H = 330;
    let left = b.right + 12; if (left + W > window.innerWidth - 12) left = Math.max(12, b.left - W - 12);
    let top = Math.max(60, Math.min(b.top - 20, window.innerHeight - H - 12));
    document.body.insertAdjacentHTML("beforeend", `<section class="drf" style="left:${left}px;top:${top}px;width:${W}px" aria-label="明細の覗き">
      <div class="dr-h"><h2>${DR.esc(d.cell)}</h2><span class="dr-big">${DR.num(d.value)}<small>ロット</small></span><span class="dr-sp"></span><button type="button" class="dr-x" data-dr-close aria-label="閉じる">×</button></div>
      <div class="dr-line">${DR.check(d, true)}<span class="drf-of">${DR.esc(d.panel)}</span></div>
      ${DR.conds(d)}${DR.table(d, { max: 5, compact: true, ncol: 5 })}
      <div class="dr-acts"><button type="button" class="btn-primary">すべて見る（${DR.num(d.rows.length)} 行）›</button><button type="button" class="pv-btn">一覧で開く</button><button type="button" class="pv-btn">コピー</button></div></section>`);
  });
}
const CSS_F = `
.drf{position:fixed;z-index:40;display:flex;flex-direction:column;gap:7px;padding:10px 12px;background:#fff;border:1px solid #c9d3de;border-radius:10px;box-shadow:0 12px 32px rgba(15,30,50,.25);box-sizing:border-box}
.drf.is-full{border:2px solid #e08a00}.drf.is-full .dr-tw{flex:1}
.drf .dr-h h2{font-size:16px}
.drf-of{font-size:12px;color:#5d6b78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.drd-ft{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}
`;

const LIB = `(${lib})()`;
const R = (fn, css) => [["script", LIB], ["script", `window.__drCSS = ${JSON.stringify(css)};`], ["script", `(${fn})()`]];
export const PROPOSALS = [
  { key: "now", name: "今（版 3.125.0）", css: "", ops: [] },
  { key: "A", name: "押すと右の面（グリッドが左へ縮み、数と明細を並べて見る）", css: "", ops: R(scriptA, CSS_A) },
  { key: "B", name: "ダブルクリックで下の引き出し（Excel の新しいシートのように明細をタブで重ねる）", css: "", ops: R(scriptB, CSS_B) },
  { key: "C", name: "右クリックの「この数の明細…」・ダブルクリックで真ん中の窓（パンくずと前の明細）", css: "", ops: R(scriptC, CSS_C) },
  { key: "D", name: "押したパネルが裏返って明細（狭いパネルは一時的に広がる）", css: "", ops: R(scriptD, CSS_D) },
  { key: "E", name: "一覧の画面へ一時の絞りで（元のデータの一覧のタブに「明細」の札。一覧と同じ表示列・検索・Excel。閉じると元の一覧）", css: "", ops: R(scriptE, CSS_E) },
  { key: "F", name: "押すと数の横に覗き（頭 5 行と確かめ）→「すべて見る」で大きく", css: "", ops: R(scriptF, CSS_F) },
];
