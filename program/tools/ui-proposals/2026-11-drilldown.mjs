// 改良「ダッシュボードの数から明細へ」（利用者の改良依頼 2026-11-17 の 7「ダッシュボードの表やグラフの数値から、簡易的(一時的)に明細まで見られるような機能が欲しいです。
// イメージはEXCELのピボットテーブルの集計されたデータのドリルダウン機能です。」）の案（回 1 は A〜F、回 2 は G〜L、回 3 は M〜R。決まり 2026-10-17・合格点 80・最大 3 回）。
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

/* ================================================================== 2 回目（rounds[1]）。1 回目の採点の指摘（advice）を受けて:
   どの案も 入口は 押す 1 手・ダブルクリック・右クリックのメニューの項目「この数の明細を見る」のどれでも開く（lib2 の DR.entry）。
   入口の札は押す数を覆わない（棒・数字は数の字の右、表のセルは行の上。入らなければ上）。押した数の橙の枠と、その行の名前（L-1・保留）は
   明細を開いても覆わない（置き場は押したパネルを避けて決める）。言い方は「明細 · パネルの題 · 数の名前」にそろえる（総計も「総計」）。
   持ち越し: 範囲の札・確かめの札・一時の言葉・前の明細の札・C の窓の中のまとまり（パンくず → 題と行の数と確かめ → 範囲 → 表と計 → 押す手） */
function lib2() {
  const DR = window.DR;
  if (DR.r2) return; DR.r2 = true;
  /** 押す数と、その字（棒の右の数・セルの数・数字）を合わせた四角 */
  DR.union = (kind) => {
    const el = DR.target(kind); if (!el) return null;
    const rs = [el.getBoundingClientRect()];
    if (el.tagName === "rect") { const t = el.nextElementSibling; if (t && t.tagName === "text") rs.push(t.getBoundingClientRect()); }
    return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  };
  /** 押した数の行（表は tr、棒はその棒と字、数字はパネルの数の段）。明細の置き場はこの四角を覆わない */
  DR.rowBox = (kind) => {
    const el = DR.target(kind); if (!el) return null;
    if (el.tagName === "TD") return el.closest("tr").getBoundingClientRect();
    const u = DR.union(kind), lab = el.tagName === "rect" ? [...el.parentNode.querySelectorAll("text.pv-ax")].find((t) => Math.abs(t.getBoundingClientRect().top + t.getBoundingClientRect().height / 2 - (u.top + u.bottom) / 2) < 14) : null;
    const l = lab ? lab.getBoundingClientRect().left : u.left;
    return { left: Math.min(l, u.left), top: u.top, right: u.right, bottom: u.bottom };
  };
  DR.panelBox = (kind) => DR.target(kind)?.closest(".db-p")?.getBoundingClientRect();
  DR.name = (kind) => { const c = DR.cases[kind]; return `${c.cell === "総計" ? c.panel : c.short} ${DR.num(c.value)}${c.pid === "wipTotal" || c.pid === "wipClass" || c.pid === "board" ? " ロット" : ""}`; };
  /** 入口の札: 押す数を覆わない所（棒・数字は字の右、入らなければ上。表のセルは上） */
  DR.entry = (kind, extra = "") => {
    const el = DR.hover(kind); if (!el) return;
    document.querySelector(".dr-tip")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="dr-tip dr-tip2" style="left:-999px;top:-999px">${DR.esc(DR.name(kind))}<small>押す・ダブルクリックで明細</small><small>右クリックのメニューにも${extra}</small></div>`);
    const tip = document.querySelector(".dr-tip"), w = tip.offsetWidth, h = tip.offsetHeight, u = DR.union(kind), pb = DR.panelBox(kind);
    let left = u.right + 12, top = (u.top + u.bottom) / 2 - h / 2, side = "is-r";
    if (el.tagName === "TD" || left + w > pb.right - 6) { left = Math.max(pb.left + 8, Math.min(u.left, pb.right - w - 8)); top = u.top - h - 10; side = "is-up"; }
    tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(top)}px`; tip.classList.add(side);
  };
  DR.clear = () => { document.querySelectorAll(".dr-tip").forEach((e) => e.remove()); document.querySelectorAll(".dr-hov").forEach((e) => e.classList.remove("dr-hov")); document.querySelectorAll(".dr-hovp").forEach((e) => e.classList.remove("dr-hovp")); };
  DR.title = (d) => `明細 · ${DR.esc(d.panel)} · ${DR.esc(d.cell)}`;
  DR.css2 = `
.dr-tip2{white-space:nowrap}
.dp-num.dr-src{outline-offset:-2px !important;background:rgba(224,138,0,.12);border-radius:6px}
.dr-tip2.is-r::before{content:"";position:absolute;left:-6px;top:50%;margin-top:-6px;border:6px solid transparent;border-left:none;border-right-color:#1f2d3a}
.dr-tip2.is-up::after{content:"";position:absolute;left:18px;bottom:-6px;border:6px solid transparent;border-bottom:none;border-top-color:#1f2d3a}
.dr-prevs{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:12px;font-weight:700;color:#5d6b78}
.dr-prevs .dr-c{cursor:pointer;font:inherit;font-size:12px}
.dr-crumb{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#5d6b78;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dr-crumb b{color:#1f2d3a}
.dr-ttl{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}.dr-ttl h2{margin:0;font-size:18px;white-space:nowrap}
.dr-ft{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}
`;
  /** 前の明細の札（押すとその明細に戻る） */
  DR.prevs = (list, cur) => { const xs = list.filter((k) => k !== cur); return xs.length ? `<div class="dr-prevs">前の明細: ${xs.map((k) => `<button type="button" class="dr-c">${DR.esc(DR.cases[k].short)} ${DR.num(DR.cases[k].value)}</button>`).join("")}</div>` : ""; };
  /** C の窓の中のまとまり（パンくず → 題と行の数と確かめ → 範囲 → 表と計 → 押す手と一時の言葉） */
  DR.body = (d, { list = [], compact = false, close = true } = {}) => `
    <div class="dr-h"><nav class="dr-crumb"><span>ダッシュボード</span>›<span>${DR.esc(d.panel)}</span>›<b>${DR.esc(d.cell)}</b></nav><span class="dr-sp"></span>${close ? '<button type="button" class="dr-x" data-dr-close aria-label="閉じる" title="閉じる（Esc）">×</button>' : ""}</div>
    <div class="dr-ttl"><h2>${DR.title(d)}</h2><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d)}</div>
    ${DR.prevs(list, d.kind)}${DR.conds(d)}${DR.table(d, { compact })}
    <div class="dr-ft">${DR.acts({ close: false })}${DR.temp}</div>`;
  /** 押した数の行と、そのパネルを覆わない四角（候補: 左・右・上・下。広い方） */
  DR.freeRect = (kind, g, minW = 420, minH = 260) => {
    const p = DR.panelBox(kind), gap = 10, c = [
      { left: g.left, top: g.top, right: p.left - gap, bottom: g.bottom },
      { left: p.right + gap, top: g.top, right: g.right, bottom: g.bottom },
      { left: g.left, top: g.top, right: g.right, bottom: p.top - gap },
      { left: g.left, top: p.bottom + gap, right: g.right, bottom: g.bottom }];
    const ok = c.filter((r) => r.right - r.left >= minW && r.bottom - r.top >= minH);
    return ok.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0] || null;
  };
  DR.go = (k, keepList = true) => { DR.clear(); if (DR.open && keepList && !DR.tabs.includes(DR.open.kind)) DR.tabs.push(DR.open.kind); if (!DR.tabs.includes(k)) DR.tabs.push(k); DR.open = { kind: k }; DR.dirty = true; };
  DR.start2 = (css) => { if (!DR.start(DR.css2 + css)) return false; window.__drillEntry = () => DR.entry("chart"); window.__drillMore = () => DR.go("chart2"); window.__drillClose = () => { DR.open = null; DR.tabs = []; DR.dirty = true; }; window.__drillGo = (k) => DR.go(k); return true; };
}

/* ------------------------------------------------------------------ G: 重ねる面（押した数の反対側に寄せる。グリッドは縮めない） */
function scriptG() {
  const DR = window.DR; if (!DR.start2(window.__drCSS)) return;
  DR.keep(() => {
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}|${window.innerWidth}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelector(".drg")?.remove();
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), g = document.querySelector("#dashGrid").getBoundingClientRect(), p = DR.panelBox(d.kind), vw = window.innerWidth;
    const right = (p.left + p.right) / 2 < vw / 2;   // 押したパネルが左なら右に、右なら左に寄せる
    // 面は押したパネルの上の縁からグリッドの下まで。幅はパネルの縁にそろえ、パネルを半分だけ覆う形をなるべく作らない（押したパネルは覆わない）
    const top = p.top, want = Math.min(780, Math.max(460, vw * 0.44));
    const ps = [...document.querySelectorAll("#dashGrid .db-p")].map((e) => e.getBoundingClientRect());
    const edges = right ? ps.map((r) => r.left).filter((x) => x >= p.right + 4) : ps.map((r) => r.right).filter((x) => x <= p.left - 4);
    const cands = [...new Set(edges)].map((x) => right ? { left: x, right: g.right } : { left: g.left, right: x })
      .filter((c) => c.right - c.left >= 420)
      .map((c) => ({ ...c, part: ps.filter((r) => r.bottom > top + 2 && r.right > c.left + 2 && r.left < c.right - 2 && !(r.left >= c.left - 2 && r.right <= c.right + 2)).length }));
    cands.sort((a, b) => a.part - b.part || Math.abs(a.right - a.left - want) - Math.abs(b.right - b.left - want));
    const c = cands[0] || (right ? { left: g.right - want, right: g.right } : { left: g.left, right: g.left + want });
    document.body.insertAdjacentHTML("beforeend", `<aside class="drg ${right ? "is-r" : "is-l"}" style="left:${c.left}px;top:${top}px;width:${c.right - c.left}px;height:${g.bottom - top}px" aria-label="明細">${DR.body(d, { list: DR.tabs })}</aside>`);
  });
}
const CSS_G = `
.drg{position:fixed;z-index:30;display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:#fff;border:1px solid #c9d3de;border-radius:10px;box-shadow:0 12px 36px rgba(15,30,50,.24);box-sizing:border-box}
.drg.is-r{border-left:3px solid #e08a00}.drg.is-l{border-right:3px solid #e08a00}
`;

/* ------------------------------------------------------------------ H: 高さを引ける下の引き出し（既定は押した数の行のすぐ下から。明細のタブ） */
function scriptH() {
  const DR = window.DR; if (!DR.start2(window.__drCSS)) return;
  DR.keep(() => {
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}|${window.innerHeight}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelector(".drh")?.remove();
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), vh = window.innerHeight, row = DR.rowBox(d.kind);
    const top = Math.round(Math.min(vh * 0.62, Math.max(vh * 0.36, row.bottom + 14)));   // 押した数の行が隠れない高さ（引いて変えられる）
    const tabs = DR.tabs.map((t, i) => { const x = DR.cases[t]; return `<button type="button" class="drb-tab${t === d.kind ? " is-on" : ""}" title="${DR.esc(x.panel)} の ${DR.esc(x.cell)}"><span class="drb-n">明細 ${i + 1}</span>${DR.esc(x.short)} <b>${DR.num(x.value)}</b><span class="drb-x" aria-label="この明細を閉じる">×</span></button>`; }).join("");
    document.body.insertAdjacentHTML("beforeend", `<section class="drh" style="top:${top}px" aria-label="明細">
      <div class="drh-grip" title="引いて高さを変えます（ダブルクリックで元の高さ）"><i></i></div>
      <div class="drb-bar"><span class="drb-lab">明細</span><div class="drb-tabs" role="tablist">${tabs}</div><span class="dr-sp"></span>${DR.temp}<button type="button" class="dr-x" data-dr-close aria-label="明細をすべて閉じる" title="明細をすべて閉じる（Esc）">×</button></div>
      <div class="drh-body"><div class="dr-ttl"><h2>${DR.title(d)}</h2><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d)}<span class="dr-sp"></span>${DR.acts({ close: false })}</div>${DR.conds(d)}${DR.table(d, { compact: true })}</div></section>`);
  });
}
const CSS_H = `
.drh{position:fixed;left:12px;right:12px;bottom:0;z-index:30;display:flex;flex-direction:column;min-height:0;background:#fff;border:1px solid #c9d3de;border-bottom:none;border-radius:10px 10px 0 0;box-shadow:0 -10px 28px rgba(15,30,50,.22);overflow:hidden}
.drh-grip{height:10px;display:grid;place-items:center;cursor:ns-resize;background:#eef2f6}.drh-grip i{width:46px;height:4px;border-radius:2px;background:#9aa7b2}
.drh .drb-bar{display:flex;align-items:center;gap:8px;padding:2px 8px 0 12px;background:#eef2f6;border-bottom:1px solid #d6dee6;min-width:0}
.drb-lab{font-size:13px;font-weight:800;color:#3e4f60}
.drb-tabs{display:flex;gap:2px;min-width:0;overflow:hidden}
.drb-tab{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 12px;border:1px solid #d6dee6;border-bottom:none;border-radius:8px 8px 0 0;background:#f7f9fb;font:inherit;font-size:13px;font-weight:700;color:#3e4f60;white-space:nowrap;cursor:pointer}
.drb-tab.is-on{background:#fff;color:#1f2d3a;box-shadow:inset 0 3px 0 #e08a00;margin-bottom:-1px;height:31px}
.drb-n{font-size:11.5px;color:#6b7a88;font-weight:800}
.drb-x{margin-left:2px;width:18px;height:18px;border-radius:4px;display:inline-grid;place-items:center;color:#6b7a88}
.drh .drb-bar .dr-x{width:26px;height:26px;margin-bottom:3px}
.drh-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:7px;padding:8px 12px 10px}
.drh-body .dr-ttl h2{font-size:16px}
`;

/* ------------------------------------------------------------------ I: 幕の無い動かせる窓（押した数の反対側。窓の中は 1 回目の C のまとまり） */
function scriptI() {
  const DR = window.DR; if (!DR.start2(window.__drCSS)) return;
  // 入口は右クリックのメニュー（今のメニューを押した数の字の右へ寄せ、数を覆わない）
  window.__drillEntry = () => {
    const el = DR.target("chart"); if (!el) return;
    const u = DR.union("chart"); DR.hover("chart");
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: u.right + 14, clientY: u.top, button: 2 }));
    setTimeout(() => {
      const m = document.querySelector(".tpa-menu"); if (!m) return;
      m.querySelector("button")?.insertAdjacentHTML("beforebegin", `<button type="button" class="dri-mi"><span aria-hidden="true">☰</span><span>この数の明細を見る<small>${DR.esc(DR.name("chart"))}</small></span><kbd>押す・ダブルクリック</kbd></button>`);
      const h = m.offsetHeight, top = Math.max(8, Math.min(u.top - 36, window.innerHeight - h - 8));
      Object.assign(m.style, { left: `${Math.round(u.right + 14)}px`, top: `${Math.round(top)}px` });
    }, 150);
  };
  DR.keep(() => {
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}|${window.innerWidth}x${window.innerHeight}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelector(".dri")?.remove(); document.querySelector(".tpa-menu")?.remove();
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), g = document.querySelector("#dashGrid").getBoundingClientRect(), p = DR.panelBox(d.kind), row = DR.rowBox(d.kind), vw = window.innerWidth;
    const right = (p.left + p.right) / 2 < vw / 2;
    const room = right ? g.right - Math.max(row.right, p.left + 40) - 14 : Math.min(row.left, p.right) - g.left - 14;
    const W = Math.round(Math.max(460, Math.min(860, vw * 0.5, room))), H = Math.round(Math.min(640, g.height * 0.9));
    const left = right ? g.right - W : g.left, top = Math.round(Math.max(g.top, Math.min(g.bottom - H, (row.top + row.bottom) / 2 - H / 2)));
    document.body.insertAdjacentHTML("beforeend", `<section class="dri" style="left:${left}px;top:${top}px;width:${W}px;height:${H}px" aria-label="明細">
      <div class="dri-bar" title="引いて動かします"><span class="dri-grip" aria-hidden="true">⠿</span><span>明細</span><span class="dr-sp"></span><span class="dri-note">幕なし（後ろのダッシュボードも押せます）</span></div>
      <div class="dri-in">${DR.body(d, { list: DR.tabs })}</div><span class="dri-rz" aria-hidden="true"></span></section>`);
  });
}
const CSS_I = `
.dri{position:fixed;z-index:40;display:flex;flex-direction:column;background:#fff;border:1px solid #b9c5d1;border-radius:12px;box-shadow:0 18px 44px rgba(15,30,50,.28);overflow:hidden}
.dri-bar{display:flex;align-items:center;gap:8px;height:30px;padding:0 12px;background:#eef2f6;border-bottom:1px solid #d6dee6;font-size:12.5px;font-weight:800;color:#3e4f60;cursor:move}
.dri-grip{font-size:15px;color:#7a8794}.dri-note{font-size:12px;font-weight:600;color:#5d6b78}
.dri-in{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px 14px 12px}
.dri-rz{position:absolute;right:3px;bottom:3px;width:12px;height:12px;border-right:2.5px solid #9aa7b2;border-bottom:2.5px solid #9aa7b2;cursor:nwse-resize}
.tpa-menu .dri-mi{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;border-radius:6px;background:#fff4dd;font:inherit;font-size:13.5px;font-weight:800;color:#5a3a00;text-align:left;cursor:pointer;margin-bottom:4px}
.tpa-menu .dri-mi small{display:block;font-size:11.5px;font-weight:700;color:#7a5a1e}
.tpa-menu .dri-mi kbd{font:inherit;font-size:11.5px;color:#6b4300}
`;

/* ------------------------------------------------------------------ J: 押したパネルを残し、ほかのパネルの所に明細（ほかは薄く） */
function scriptJ() {
  const DR = window.DR; if (!DR.start2(window.__drCSS)) return;
  DR.keep(() => {
    DR.mark();
    const grid = document.querySelector("#dashGrid"); if (!grid) return;
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}|${window.innerWidth}x${window.innerHeight}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelector(".drj")?.remove(); grid.querySelectorAll(".db-p").forEach((e) => e.classList.remove("drj-dim", "drj-keep"));
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), g = grid.getBoundingClientRect(), r = DR.freeRect(d.kind, g);
    if (!r) return;
    grid.querySelectorAll(".db-p").forEach((e) => e.classList.add(e.dataset.id === d.pid ? "drj-keep" : "drj-dim"));
    document.body.insertAdjacentHTML("beforeend", `<section class="drj" style="left:${r.left}px;top:${r.top}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px" aria-label="明細">${DR.body(d, { list: DR.tabs })}</section>`);
  });
}
const CSS_J = `
#dashGrid .db-p.drj-dim{opacity:.28;filter:saturate(.4)}
#dashGrid .db-p.drj-keep{box-shadow:0 0 0 2px #e08a00,0 8px 24px rgba(15,30,50,.16)}
.drj{position:fixed;z-index:30;display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:#fff;border:1px solid #c9d3de;border-radius:10px;box-shadow:0 10px 30px rgba(15,30,50,.2);box-sizing:border-box}
`;

/* ------------------------------------------------------------------ L: 覗き（押した行の下・一時の言葉つき）→「すべて見る」で H の引き出し */
function scriptL() {
  const DR = window.DR; if (!DR.start2(window.__drCSS)) return;
  window.__drillGo = (k) => { DR.go(k); DR.open.full = false; };
  window.__drillMore = () => { DR.open = { kind: (DR.open && DR.open.kind) || "kpi", full: true }; DR.dirty = true; };
  DR.keep(() => {
    DR.mark();
    const k = DR.open ? `${DR.open.kind}|${DR.open.full}|${DR.tabs.join()}|${!!DR.rows}|${window.innerWidth}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelectorAll(".drl,.drh").forEach((e) => e.remove());
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), vh = window.innerHeight, vw = window.innerWidth, row = DR.rowBox(d.kind), p = DR.panelBox(d.kind);
    if (DR.open.full) {   // すべて見る: H と同じ引き出し（押した数の行のすぐ下から）
      const top = Math.round(Math.min(vh * 0.62, Math.max(vh * 0.36, row.bottom + 14)));
      document.body.insertAdjacentHTML("beforeend", `<section class="drh" style="top:${top}px" aria-label="明細"><div class="drh-grip" title="引いて高さを変えます"><i></i></div>
        <div class="drh-body">${DR.body(d, { list: DR.tabs, compact: true })}</div></section>`);
      return;
    }
    // 覗き: 押した行（名前と数）の下。行の左にそろえ、パネルの外へははみ出させても画面の中に収める
    const W = 540, NEED = 300, below = vh - row.bottom - 22 >= NEED;
    const left = Math.round(Math.max(12, Math.min(row.left, vw - W - 12)));
    const top = below ? Math.round(row.bottom + 10) : Math.round(Math.max(60, row.top - 10 - NEED)), H = below ? Math.min(420, vh - top - 12) : Math.min(420, row.top - 10 - top);
    document.body.insertAdjacentHTML("beforeend", `<section class="drl ${below ? "is-below" : "is-above"}" style="left:${left}px;top:${top}px;width:${W}px;max-height:${H}px" aria-label="明細の覗き">
      <span class="drl-arrow" style="left:${Math.round(Math.min(W - 30, Math.max(14, (row.left + row.right) / 2 - left - 6)))}px"></span>
      <div class="dr-h"><h2>${DR.title(d)}</h2><span class="dr-sp"></span><button type="button" class="dr-x" data-dr-close aria-label="閉じる" title="閉じる（Esc）">×</button></div>
      <div class="dr-line"><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.check(d, true)}</div>
      ${DR.conds(d)}${DR.table(d, { max: 5, compact: true, ncol: 5 })}
      <div class="dr-acts"><button type="button" class="btn-primary">すべて見る（${DR.num(d.rows.length)} 行）›</button><button type="button" class="pv-btn">一覧で開く ›</button><button type="button" class="pv-btn">コピー</button></div>
      <div class="dr-temp">一時の表示です。閉じると消え、ダッシュボードの組みは変わりません</div></section>`);
  });
}
const CSS_L = CSS_H + `
.drl{position:fixed;z-index:40;display:flex;flex-direction:column;gap:7px;padding:12px 12px 10px;background:#fff;border:1px solid #c9d3de;border-top:3px solid #e08a00;border-radius:10px;box-shadow:0 12px 32px rgba(15,30,50,.25);box-sizing:border-box}
.drl .dr-h h2{font-size:15px}
.drl-arrow{position:absolute;top:-10px;width:0;height:0;border:7px solid transparent;border-top:none;border-bottom-color:#e08a00}
.drl.is-above{border-top:1px solid #c9d3de;border-bottom:3px solid #e08a00}.drl.is-above .drl-arrow{top:auto;bottom:-10px;border-bottom:none;border-top:7px solid #e08a00}
.drl .dr-tbox{min-height:120px}
.drh .drh-body{gap:8px}
`;

/* ================================================================== 3 回目（rounds[2]。最後の回）。2 回目の採点の指摘（advice）を受けて、どの案も:
   ・置き場は「パネルを丸ごと覆う」: 押したパネルの右・左・下・上のどれかの四角を、そこに掛かるパネルの外の縁まで広げ（パネルの途中に縁を置かない）、
     押したパネルに掛かる形は捨て、いちばん広い物を選ぶ（DR.cover）。数字のパネル（上の段）を押したときは上の段の下の全幅になる
   ・押したパネルは橙の縁と影で目立たせ、ほかのパネルは薄くしない（J の強調を G の置き場へ）
   ・数字のパネルの印は枠でなく、薄い橙の地と下線（字に線が被らない。字の外に余白）
   ・一時の言葉の置き場は面の頭の帯 1 か所、確かめの札は 1 つの形「✓ パネルと同じ n ロット」
   ・1280 で表の行を増やす: 題・行の数・確かめを 1 行、範囲の札を 1 行（データは頭の帯へ） */
function lib3() {
  const DR = window.DR;
  if (DR.r3) return; DR.r3 = true;
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const uni = (rs) => ({ left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) });
  /** 押したパネルを覆わず、ほかのパネルを丸ごと覆ういちばん広い四角（パネルの縁にそろう） */
  DR.cover = (kind) => {
    const g = document.querySelector("#dashGrid").getBoundingClientRect(), pe = DR.target(kind)?.closest(".db-p"); if (!pe) return null;
    const p = pe.getBoundingClientRect();
    const ps = [...document.querySelectorAll("#dashGrid .db-p")].filter((e) => e !== pe).map((e) => e.getBoundingClientRect());
    const cs = [{ left: p.right + 1, top: p.top, right: g.right, bottom: g.bottom }, { left: g.left, top: p.top, right: p.left - 1, bottom: g.bottom },
      { left: g.left, top: p.bottom + 1, right: g.right, bottom: g.bottom }, { left: g.left, top: g.top, right: g.right, bottom: p.top - 1 }];
    let best = null;
    for (const c of cs) {
      if (c.right - c.left < 40 || c.bottom - c.top < 40) continue;
      let box = c;
      for (let i = 0; i < 12; i++) { const hs = ps.filter((r) => hit(r, box)); if (!hs.length) { box = null; break; } const u = uni(hs); if (u.left === box.left && u.top === box.top && u.right === box.right && u.bottom === box.bottom) break; box = u; }
      if (!box || hit(box, p) || box.right - box.left < 440 || box.bottom - box.top < 260) continue;
      const area = (box.right - box.left) * (box.bottom - box.top);
      if (!best || area > best.area) best = { ...box, area };
    }
    return best;
  };
  DR.keepPanel = (kind) => {
    document.querySelectorAll("#dashGrid .db-p.dr3-keep").forEach((e) => e.classList.remove("dr3-keep"));
    DR.target(kind)?.closest(".db-p")?.classList.add("dr3-keep");
  };
  DR.ok3 = (d) => `<span class="dr-ok${d.ok ? "" : " is-bad"}" title="明細のロット番号の重なりの無い数（${DR.num(d.lots)}）と、パネルの数（${DR.num(d.value)}）を比べました">${d.ok ? "✓ パネルと同じ" : "! パネルと違う"} ${DR.num(d.lots)} ロット</span>`;
  DR.chips3 = (d) => {
    const cell = d.conds.length ? d.conds.map(([k, v]) => `<span class="dr-c is-cell"><i>${DR.esc(k === "まとまり" ? "列" : k)}</i>${DR.esc(v)}</span>`).join("") : '<span class="dr-c is-cell"><i>この数</i>総計</span>';
    return `<div class="dr3-chips"><span class="dr-c is-base" title="パネルの期間"><i>期間</i>なし</span><span class="dr-c is-base" title="ダッシュボードのスライサー（期間 組んだまま・設備 すべて）"><i>スライサー</i>なし</span>${cell}</div>`;
  };
  DR.prev3 = (cur) => { const xs = DR.tabs.filter((k) => k !== cur); return xs.length ? `<span class="dr3-prev">前の明細 ${xs.map((k) => `<button type="button" class="dr-c">${DR.esc(DR.cases[k].short)} ${DR.num(DR.cases[k].value)}</button>`).join("")}</span>` : ""; };
  DR.TEMP3 = '<span class="dr3-temp" title="閉じると消え、ダッシュボードの組みは変わりません">一時の表示（組みは変わりません）</span>';
  /** 面の中（頭の帯 → 題の行 → 範囲の札 → [足す物] → 表と計 → 押す手） */
  DR.body3 = (d, { strip = null, extra = "", head = null, foot = true } = {}) =>
    (strip ?? `<div class="dr3-strip"><b>明細</b><span class="dr3-from" title="${DR.esc(d.panel)} の数から">${DR.esc(d.data)}</span>${DR.TEMP3}${DR.prev3(d.kind)}<span class="dr-sp"></span><button type="button" class="dr-x" data-dr-close aria-label="閉じる" title="閉じる（Esc）">×</button></div>`)
    + `<div class="dr3-in">${head ?? `<div class="dr3-ttl"><h2>${DR.esc(d.cell === "総計" ? `${d.panel} · 総計` : d.cell)}</h2><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.ok3(d)}</div>`}
      ${DR.chips3(d)}${extra}${DR.table(d, { compact: true })}${foot ? `<div class="dr3-ft">${DR.acts({ close: false })}</div>` : ""}</div>`;
  DR.css3 = `
#dashGrid .db-p.dr3-keep{box-shadow:0 0 0 2px #e08a00,0 10px 26px rgba(15,30,50,.18);border-color:#e08a00}
#dashGrid .dp-num.dr-src{outline:none !important;background:none;box-shadow:none;padding:0;margin:0}
#dashGrid .dp-kpi:has(.dr-src){background:rgba(224,138,0,.16);border-radius:6px;outline:0}
#dashGrid td.dr-src{outline-offset:1px}
.dr3{position:fixed;z-index:30;display:flex;flex-direction:column;background:#fff;border:1px solid #c9d3de;border-radius:10px;box-shadow:0 10px 30px rgba(15,30,50,.2);box-sizing:border-box;overflow:hidden}
.dr3-strip{display:flex;align-items:center;gap:8px;flex:none;height:32px;padding:0 6px 0 12px;background:#eef2f6;border-bottom:1px solid #d6dee6;font-size:12.5px;color:#3e4f60;white-space:nowrap;min-width:0}
.dr3-strip b{font-size:13px;color:#1f2d3a}
.dr3-from{font-weight:700;color:#3e4f60;flex:0 1 auto;min-width:0;overflow:hidden}
.dr3-temp{font-size:12px;color:#5d6b78;flex:none}
.dr3-strip .dr-x{width:24px;height:24px;font-size:15px}
.dr3-prev{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:#5d6b78;flex:none}.dr3-prev .dr-c{cursor:pointer;font:inherit;font-size:12px;padding:0 8px}
.dr3-in{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;padding:8px 12px 10px}
.dr3-ttl{display:flex;align-items:center;gap:10px;flex:none;white-space:nowrap;min-width:0}
.dr3-ttl h2{margin:0;font-size:16px;flex:0 1 auto;min-width:0;overflow:hidden}
.dr3-ttl .dr-big{font-size:22px}
.dr3-chips{display:flex;gap:5px;flex:none;white-space:nowrap}
.dr3-ft{display:flex;align-items:center;gap:8px;flex:none}
.dr3-ft .dr-acts .btn-primary,.dr3-ft .dr-acts .pv-btn{height:30px;padding:0 12px}
.dr3 .dr-tw.is-compact .dr-t th,.dr3 .dr-tw.is-compact .dr-t td{padding:4px 8px}
`;
  /** 面を置く（kind の cover に、HTML を作る fn で） */
  DR.place3 = (cls, fn) => {
    const k = DR.open ? `${DR.open.kind}|${DR.tabs.join()}|${!!DR.rows}|${window.innerWidth}x${window.innerHeight}` : "";
    if (document.body.dataset.drk === k && !DR.dirty) return; DR.dirty = false; document.body.dataset.drk = k;
    document.querySelectorAll(".dr3").forEach((e) => e.remove());
    document.querySelectorAll("#dashGrid .db-p.dr3-keep").forEach((e) => e.classList.remove("dr3-keep"));
    if (!DR.open || !DR.rows) return;
    const d = DR.get(DR.open.kind), r = DR.cover(d.kind); if (!r) return;
    DR.keepPanel(d.kind);
    document.body.insertAdjacentHTML("beforeend", `<section class="dr3 ${cls}" style="left:${r.left}px;top:${r.top}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px" aria-label="明細">${fn(d)}</section>`);
  };
  DR.start3 = (css) => { if (!DR.start2(DR.css3 + css)) return false; return true; };
}

/* ------------------------------------------------------------------ M: パネルの縁にそろえて重ねる面＋押したパネルの強調（G の置き場＋J の強調） */
function scriptM() {
  const DR = window.DR; if (!DR.start3(window.__drCSS)) return;
  DR.keep(() => { DR.mark(); DR.place3("is-m", (d) => DR.body3(d)); });
}
const CSS_M = ``;

/* ------------------------------------------------------------------ N: M の面に「内訳」の 1 行（明細の多い値。原因探しの手がかり。押すとその値で明細を絞る） */
function scriptN() {
  const DR = window.DR; if (!DR.start3(window.__drCSS)) return;
  const COLS = ["製造材質", "用途名", "仕掛区分", "製造調質"];
  const inner = (d) => {
    const col = COLS.find((c) => !d.used.includes(c)), m = new Map();
    d.rows.forEach((r) => { const v = r[col] ?? "（空）"; m.set(v, (m.get(v) || 0) + 1); });
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), max = top[0] ? top[0][1] : 1;
    return `<div class="drn-in"><button type="button" class="drn-col" title="内訳を見る列を替えます">内訳 ${DR.esc(col)} ▾</button>${top.map(([v, n]) => `<button type="button" class="drn-v" title="${DR.esc(v)} の ${n} 行だけを見る"><span class="drn-bar" style="width:${Math.round((n / max) * 34)}px"></span>${DR.esc(v)} <b>${n}</b></button>`).join("")}${m.size > 3 ? `<span class="drn-more">ほか ${m.size - 3}</span>` : ""}</div>`;
  };
  DR.keep(() => { DR.mark(); DR.place3("is-n", (d) => DR.body3(d, { extra: inner(d) })); });
}
const CSS_N = `
.drn-in{display:flex;align-items:center;gap:5px;flex:none;white-space:nowrap}
.drn-col{height:26px;padding:0 8px;border:1px solid #c9d3de;border-radius:6px;background:#f6f8fa;font:inherit;font-size:12px;font-weight:800;color:#3e4f60;cursor:pointer}
.drn-v{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px 0 6px;border:1px solid #d6dee6;border-radius:999px;background:#fff;font:inherit;font-size:12.5px;font-weight:700;color:#2c3a48;cursor:pointer}
.drn-v b{font-variant-numeric:tabular-nums}
.drn-bar{display:inline-block;height:8px;border-radius:2px;background:#7f9bb8}
.drn-more{font-size:12px;color:#5d6b78}
`;

/* ------------------------------------------------------------------ P: M の面の頭を明細のタブに（何度も開くと Excel のシートのように並ぶ） */
function scriptP() {
  const DR = window.DR; if (!DR.start3(window.__drCSS)) return;
  const strip = (d) => `<div class="dr3-strip drp-strip"><b>明細</b><div class="drp-tabs" role="tablist">${DR.tabs.map((t) => { const x = DR.cases[t]; return `<button type="button" class="drp-tab${t === d.kind ? " is-on" : ""}" title="${DR.esc(x.panel)} の ${DR.esc(x.cell)}">${DR.esc(x.short)} <b>${DR.num(x.value)}</b><span class="drp-x" aria-label="この明細を閉じる">×</span></button>`; }).join("")}</div><span class="dr-sp"></span>${DR.TEMP3}<button type="button" class="dr-x" data-dr-close aria-label="明細をすべて閉じる" title="明細をすべて閉じる（Esc）">×</button></div>`;
  DR.keep(() => { DR.mark(); DR.place3("is-p", (d) => DR.body3(d, { strip: strip(d), head: `<div class="dr3-ttl"><h2 title="${DR.esc(d.panel)} の数から">${DR.esc(d.cell === "総計" ? `${d.panel} · 総計` : d.cell)}</h2><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span>${DR.ok3(d)}</div>` })); });
}
const CSS_P = `
.drp-strip{align-items:flex-end;height:36px;padding-top:4px}
.drp-strip > b,.drp-strip > .dr3-temp,.drp-strip > .dr-x{align-self:center}
.drp-tabs{display:flex;gap:2px;min-width:0}
.drp-tab{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 6px 0 10px;border:1px solid #d6dee6;border-bottom:none;border-radius:7px 7px 0 0;background:#f7f9fb;font:inherit;font-size:12.5px;font-weight:700;color:#3e4f60;white-space:nowrap;cursor:pointer}
.drp-tab.is-on{background:#fff;color:#1f2d3a;box-shadow:inset 0 3px 0 #e08a00;height:31px;margin-bottom:-1px}
.drp-x{width:16px;height:16px;display:inline-grid;place-items:center;color:#6b7a88}
`;

/* ------------------------------------------------------------------ Q: 上の段（数字のパネル）の下を全部覆い、押した数の行を面の頭に写す（置き場がいつも同じ） */
function scriptQ() {
  const DR = window.DR; if (!DR.start3(window.__drCSS)) return;
  DR.cover = (kind) => {   // 置き場はいつも上の段の下の全幅（押したのが上の段なら、その下。そうでなければ押した行を頭に写す）
    const g = document.querySelector("#dashGrid").getBoundingClientRect(), top = document.querySelector('#dashGrid .db-p[data-id="wipTotal"]').getBoundingClientRect();
    return { left: g.left, top: top.bottom + 10, right: g.right, bottom: g.bottom };
  };
  DR.keepPanel = (kind) => {   // 覆ったパネルには橙の縁を付けない（縁と影が面の外へはみ出す）。上の段を押したときだけ
    document.querySelectorAll("#dashGrid .db-p.dr3-keep").forEach((e) => e.classList.remove("dr3-keep"));
    const pe = DR.target(kind)?.closest(".db-p"); if (pe && pe.dataset.id === "wipTotal") pe.classList.add("dr3-keep");
  };
  const snap = (d) => {
    if (d.pid === "wipTotal") return "";
    const el = DR.target(d.kind); if (!el) return "";
    const v = d.value, name = d.short;
    return `<div class="drq-snap" title="押した数（${DR.esc(d.panel)}）"><span class="drq-lab">押した数</span><span class="drq-name">${DR.esc(name)}</span><span class="drq-bar"><i style="width:${Math.round((v / 654) * 100)}%"></i></span><b class="drq-v">${DR.num(v)}</b><span class="drq-p">${DR.esc(d.panel)}</span></div>`;
  };
  DR.keep(() => { DR.mark(); DR.place3("is-q", (d) => DR.body3(d, { extra: snap(d) })); });
}
const CSS_Q = `
.drq-snap{display:flex;align-items:center;gap:10px;flex:none;padding:4px 10px;border:1.5px solid #e08a00;border-radius:8px;background:#fff8ec;white-space:nowrap}
.drq-lab{font-size:11.5px;font-weight:800;padding:1px 7px;border-radius:999px;background:#f3dcae;color:#6b4300}
.drq-name{font-weight:800;color:#1f2d3a}.drq-v{font-variant-numeric:tabular-nums}
.drq-bar{width:160px;height:10px;border-radius:5px;background:#e6ebf0;overflow:hidden}.drq-bar i{display:block;height:100%;background:#3f6591}
.drq-p{font-size:12px;color:#5d6b78}
`;

/* ------------------------------------------------------------------ R: 明細が一時のパネルになる（ダッシュボードのパネルと同じ形: 題の帯の右に押す手・添え書きに一時の言葉） */
function scriptR() {
  const DR = window.DR; if (!DR.start3(window.__drCSS)) return;
  const strip = (d) => `<div class="drr-ph"><i class="db-dot" style="--c:#e08a00" aria-hidden="true"></i><h3 title="${DR.esc(d.panel)} の数から">${DR.esc(d.cell === "総計" ? `${d.panel} · 総計` : d.cell)}</h3><span class="dr-big">${DR.num(d.rows.length)}<small>行</small></span><span class="dr-sp"></span>`
    + `<button type="button" class="db-pbtn drr-main" title="同じ行を一覧の画面で開きます">一覧で開く ›</button><button type="button" class="db-pbtn" title="Excel に出力">↓ Excel</button><button type="button" class="db-pbtn">コピー</button><button type="button" class="dr-x" data-dr-close aria-label="閉じる" title="閉じる（Esc）">×</button></div>`
    + `<div class="drr-sub"><span class="drr-lab">明細</span>${DR.ok3(d)}${DR.TEMP3}</div>`;
  // 前の明細の札は範囲の札の行の右（題の帯の 2 行目に入れると、狭い面で切れる）
  const chips = DR.chips3;
  DR.chips3 = (d) => chips(d).replace(/<\/div>$/, `<span class="dr-sp"></span>${DR.prev3(d.kind)}</div>`);
  DR.keep(() => { DR.mark(); DR.place3("is-r", (d) => DR.body3(d, { strip: strip(d), head: "", foot: false })); });
}
const CSS_R = `
.dr3.is-r{background:var(--surface,#fff);border:2px solid #e08a00;box-shadow:0 10px 28px rgba(15,30,50,.18)}
.drr-ph{display:flex;align-items:center;gap:8px;flex:none;padding:8px 10px 0 12px;white-space:nowrap;min-width:0}
.drr-ph h3{margin:0;font-size:14px;flex:0 1 auto;min-width:0;overflow:hidden}
.drr-ph .dr-big{font-size:18px}.drr-ph .dr-big small{font-size:12px}
.drr-ph .db-pbtn{height:26px}
.drr-ph .drr-main{background:#e08a00;border-color:#e08a00;color:#fff}
.drr-ph .dr-x{width:26px;height:26px;font-size:15px}
.drr-sub{display:flex;align-items:center;gap:8px;flex:none;padding:4px 12px 0 12px;font-size:12px;color:#5d6b78;white-space:nowrap}
.drr-lab{font-size:11.5px;font-weight:800;padding:1px 8px;border-radius:999px;background:#e08a00;color:#fff}
.dr3.is-r .dr3-in{padding-top:4px}
`;

const LIB = `(${lib})()`;
const R = (fn, css) => [["script", LIB], ["script", `window.__drCSS = ${JSON.stringify(css)};`], ["script", `(${fn})()`]];
const R3 = (fn, css) => [["script", LIB], ["script", `(${lib2})()`], ["script", `(${lib3})()`], ["script", `window.__drCSS = ${JSON.stringify(css)};`], ["script", `(${fn})()`]];
const R2 = (fn, css) => [["script", LIB], ["script", `(${lib2})()`], ["script", `window.__drCSS = ${JSON.stringify(css)};`], ["script", `(${fn})()`]];
export const PROPOSALS = [
  { key: "now", name: "今（版 3.125.0）", css: "", ops: [] },
  { key: "A", name: "押すと右の面（グリッドが左へ縮み、数と明細を並べて見る）", css: "", ops: R(scriptA, CSS_A) },
  { key: "B", name: "ダブルクリックで下の引き出し（Excel の新しいシートのように明細をタブで重ねる）", css: "", ops: R(scriptB, CSS_B) },
  { key: "C", name: "右クリックの「この数の明細…」・ダブルクリックで真ん中の窓（パンくずと前の明細）", css: "", ops: R(scriptC, CSS_C) },
  { key: "D", name: "押したパネルが裏返って明細（狭いパネルは一時的に広がる）", css: "", ops: R(scriptD, CSS_D) },
  { key: "E", name: "一覧の画面へ一時の絞りで（元のデータの一覧のタブに「明細」の札。一覧と同じ表示列・検索・Excel。閉じると元の一覧）", css: "", ops: R(scriptE, CSS_E) },
  { key: "F", name: "押すと数の横に覗き（頭 5 行と確かめ）→「すべて見る」で大きく", css: "", ops: R(scriptF, CSS_F) },
  // 2 回目（rounds[1]）。どの案も 入口は 押す・ダブルクリック・右クリックのメニューの項目、入口の札は数を覆わない、押した数の行とパネルは覆わない
  { key: "G", name: "重ねる面（押した数の反対側に寄せ、グリッドは縮めない。窓の中は C のまとまり）", css: "", ops: R2(scriptG, CSS_G) },
  { key: "H", name: "高さを引ける下の引き出し（既定は押した数の行のすぐ下から。明細のタブ）", css: "", ops: R2(scriptH, CSS_H) },
  { key: "I", name: "幕の無い動かせる窓（押した数の反対側。入口は数の右に寄せた右クリックのメニューにも）", css: "", ops: R2(scriptI, CSS_I) },
  { key: "J", name: "押したパネルを残し、ほかのパネルの所に明細（ほかは薄く）", css: "", ops: R2(scriptJ, CSS_J) },
  { key: "L", name: "覗き（押した行の下・一時の言葉つき）→「すべて見る」で引き出し", css: "", ops: R2(scriptL, CSS_L) },
  // 3 回目（rounds[2]）。どの案も 置き場はパネルを丸ごと覆う（縁にそろう）・押したパネルは橙の縁と影・数字の印は地と下線・一時の言葉は頭の帯・確かめの札は 1 つの形
  { key: "M", name: "パネルの縁にそろえて重ねる面＋押したパネルの強調（G の置き場に J の強調）", css: "", ops: R3(scriptM, CSS_M) },
  { key: "N", name: "M の面に「内訳」の 1 行（明細の多い値。押すとその値で明細を絞る）", css: "", ops: R3(scriptN, CSS_N) },
  { key: "P", name: "M の面の頭を明細のタブに（何度も開くとシートのように並ぶ）", css: "", ops: R3(scriptP, CSS_P) },
  { key: "Q", name: "上の段の下をいつも同じ置き場で覆い、押した数を面の頭に写す", css: "", ops: R3(scriptQ, CSS_Q) },
  { key: "R", name: "明細が一時のパネルになる（パネルと同じ題の帯に押す手。橙の縁）", css: "", ops: R3(scriptR, CSS_R) },
];
