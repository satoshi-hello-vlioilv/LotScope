/* =========================================================================
   ダッシュボードのパネルを組む所（版 3.37.0。グリッドは dashboard.js・描き方は dashboard-panels.js）
   集計表・グラフ（lotlist-pivot.js）と同じ組み方: 左にカラムの札（行・列・値）、右に文「［行］ごとに、［列］別の［値］を出す」と形。
   変えるたびに、グリッドの中のそのパネルがすぐ描き直る（パネルの大きさのまま。プレビューを別に持たない）。
   ほかに: データ（データ元・作業実績の設備・作業日の数え方）・条件（一覧と同じ形）・期間（今日・前日・直近 n 日・今月・先月）・
   並べ方（大きい順・小さい順）と上位いくつ・題
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const C = window.LotListPivotCharts, P = window.DashPanels;
  const MAX_DIMS = 3, MAX_MEASURES = 4;
  const AGGS = [["sum", "合計"], ["avg", "平均"], ["min", "最小"], ["max", "最大"]];
  const DATE_PARTS = ["date", "ym", "year", "month", "weekday", "hour", ""], NUM_PARTS = ["", "bin"], WORKDAY_PARTS = ["", "ym", "year"];
  const PART_NAME = { "": "値のまま", date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const WORKDAY_NAME = { "": "日", ym: "年月", year: "年" };
  const EXTRA = [{ k: "kpi", n: "数字", tip: "値の総計を大きな数で出します（行の段は要りません）", icon: "M4 15V5l-2 2M8 6a2 2 0 1 1 4 0c0 2-4 4-4 9h4M14 5h4l-3 4a3 3 0 1 1-2 5" },
    { k: "none", n: "表", tip: "集計表（行・列・値）を、パネルの大きさに詰めて出します", icon: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12" }];
  const PERIODS = [["", "期間で絞らない"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 n 日（今日を含む）"], ["this_month", "今月"], ["last_month", "先月"]];
  let host = null, p = null, sources = [], fields = null, fieldsKey = "", fieldsErr = "", q = "";

  const srcOf = (k) => sources.find((x) => x.key === k) || null;
  const isWork = () => p.source === "work";
  const special = () => (fields && fields.special) || [];
  const fieldOf = (c) => ((fields && fields.fields) || []).find((f) => f.column === c) || null;
  const isDate = (c) => (c === "@workday") || !!(fieldOf(c) || {}).date;
  const isNum = (c) => !!(fieldOf(c) || {}).numeric;
  function partsOf(c) {
    if (c === "@workday") return WORKDAY_PARTS;
    if (c.startsWith("@")) return [""];
    if (isDate(c)) return DATE_PARTS;
    if (isNum(c)) return NUM_PARTS;
    return [""];
  }
  function defaultPart(c) {
    if (c.startsWith("@")) return "";
    if (isDate(c)) return "date";
    const f = fieldOf(c);
    return f && f.numeric && (f.many || f.kinds > 30) ? "bin" : "";
  }
  const dimLabel = (d) => (d.column === "@equip" ? "設備" : d.column === "@workday" ? "作業日" : d.column === "@shift" ? "直" : d.column);

  /** 題が空のときの名前（組み方から作る。パネルの見出しにも同じ物） */
  function autoTitle(x) {
    if (x.visual === "board") return "設備ごとの仕掛と前日の実績";
    const b = x.body || {}, ms = (b.measures || []).map(P.measName).join("・") || "ロット数";
    const pr = x.period && x.period.kind ? `${x.period.kind === "days" ? `直近 ${x.period.n || 7} 日` : (PERIODS.find((k) => k[0] === x.period.kind) || [, ""])[1]}の` : "";
    const src = (srcOf(x.source) || {}).name || "";
    if (!(b.rows || []).length) return `${pr}${src ? src + "の" : ""}${ms}`;
    return `${pr}${b.rows.map(dimLabel).join("・")}ごとの${(b.cols || []).length ? b.cols.map(dimLabel).join("・") + "別の" : ""}${ms}`;
  }

  /* ---- 変える（変えるたびに host.onChange でグリッドのパネルを描き直す） ---- */
  function changed(repaintFields = true) { host.onChange(TPA.clone(p)); paint(repaintFields); }
  function addDim(role, col) {
    const b = p.body, other = role === "rows" ? "cols" : "rows";
    if (b[role].some((d) => d.column === col)) { b[role] = b[role].filter((d) => d.column !== col); changed(); return; }
    if (b[role].length >= MAX_DIMS) { host.toast(`${role === "rows" ? "行" : "列"}の段は ${MAX_DIMS} つまでです`); return; }
    b[other] = b[other].filter((d) => d.column !== col);
    b[role] = b[role].concat([{ column: col, part: defaultPart(col) }]);
    if (p.visual === "kpi" && role === "rows") p.visual = C.isTimeDim(b.rows[0]) ? "time" : "column";   // 行を入れたら数字はグラフに
    changed();
  }
  function addMeasure(m) {
    const ms = p.body.measures, same = (x) => x.agg === m.agg && (x.column || "") === (m.column || "");
    if (ms.some(same)) { p.body.measures = ms.filter((x) => !same(x)); if (!p.body.measures.length) p.body.measures = [{ agg: "lots" }]; changed(); return; }
    if (ms.length >= MAX_MEASURES) { host.toast(`値は ${MAX_MEASURES} つまでです`); return; }
    p.body.measures = ms.concat([m]); changed();
  }
  function setVisual(k) {
    p.visual = k;
    const b = p.body;
    if (k !== "kpi" && k !== "none" && !b.rows.length) {   // 行の段が要る形: 向く段を 1 つ入れる（作業実績は作業日・ほかは設備か種類の少ない列）
      const sp = special().map((x) => x.column);
      const pick = (k === "time" || k === "line" || k === "control") ? (sp.includes("@workday") ? "@workday" : ((fields && fields.fields) || []).find((f) => f.date)?.column)
        : sp.includes("@equip") ? "@equip" : ((fields && fields.fields) || []).filter((f) => !f.numeric && !f.date && f.kinds >= 2 && f.kinds <= 30).sort((a, c) => a.kinds - c.kinds)[0]?.column;
      if (pick) { b.rows = [{ column: pick, part: defaultPart(pick) }]; host.toast(`この形には行の段が要るので「${dimLabel(b.rows[0])}」を入れました`); }
    }
    b.grand = k === "none" || k === "kpi";
    changed();
  }
  async function setSource(key, equip = "") {
    if (key === p.source && equip === p.equip) return;
    const keepPeriod = p.period && p.period.column === "@workday" && key === "work";
    Object.assign(p, { source: key, equip, filters: [], search: "", period: keepPeriod ? p.period : null });
    p.body = { ...p.body, rows: [], cols: [], measures: [{ agg: "lots" }] };
    if (p.visual !== "kpi" && p.visual !== "none") p.visual = "kpi";
    await loadFields(); changed();
  }

  async function loadFields() {
    const key = `${p.source}|${p.equip}`;
    if (fields && fieldsKey === key) return;
    fields = null; fieldsErr = ""; fieldsKey = key; paint();
    try {
      const r = await fetch(`/api/dashboard/fields?source=${encodeURIComponent(p.source)}&equip=${encodeURIComponent(p.equip || "")}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (fieldsKey !== key) return;
      if (!r.ok) { fieldsErr = d.error || "カラムを読めませんでした"; if (d.kind === "copying") setTimeout(() => { if (fieldsKey === key) { fieldsKey = ""; loadFields().then(() => paint()); } }, 4000); }
      else fields = d;
    } catch (e) { fieldsErr = String(e); }
    paint();
  }

  /* ---- 描く ---- */
  const btn = (role, col, on, extra = "") => `<button type="button" class="pv-r r-${role}${on ? " on" : ""}" data-de-add="${role}" data-col="${esc(col)}" aria-pressed="${on}" ${extra}>${{ rows: "行", cols: "列", vals: "値" }[role]}</button>`;
  function fieldsHtml() {
    if (fieldsErr) return `<p class="pv-none">${esc(fieldsErr)}</p>`;
    if (!fields) return '<p class="pv-none">カラムを読んでいます…</p>';
    const b = p.body, used = (c) => (b.rows.some((d) => d.column === c) ? "rows" : b.cols.some((d) => d.column === c) ? "cols" : "");
    const meas = (agg, col = "") => b.measures.some((m) => m.agg === agg && (m.column || "") === col);
    const ql = q.trim().toLowerCase(), hit = (n) => !ql || n.toLowerCase().includes(ql);
    let html = special().filter((x) => hit(x.name)).map((x) => `<div class="pv-f is-special${used(x.column) ? " is-used" : ""}" title="${esc(x.hint || "")}"><span><b>${esc(x.name)}</b><small>${esc(x.hint || "")}</small></span>`
      + `${btn("rows", x.column, used(x.column) === "rows")}${btn("cols", x.column, used(x.column) === "cols")}<i></i></div>`).join("");
    if (hit("ロット数 件数")) {
      html += `<div class="pv-f is-special${meas("lots") ? " is-used" : ""}"><span><b>ロット数</b><small>${isWork() ? "作業の数（作業開始が同じ行は 1）" : "重複の無いロット番号"}</small></span><i></i><i></i>${btn("vals", "@lots", meas("lots"))}</div>`
        + `<div class="pv-f is-special${meas("count") ? " is-used" : ""}"><span><b>件数</b><small>行の数</small></span><i></i><i></i>${btn("vals", "@count", meas("count"))}</div>`;
    }
    html += fields.fields.filter((f) => hit(f.column)).map((f) => {
      const c = f.column, u = used(c), anyVal = b.measures.some((m) => m.column === c);
      const sub = f.date ? "日付" : f.numeric ? `数${f.many ? "" : ` · ${f.kinds} 種類`}` : f.many ? "1,000 種類以上" : `${f.kinds} 種類`;
      return `<div class="pv-f${u || anyVal ? " is-used" : ""}" title="${esc(c)}"><span><b>${esc(c)}</b><small>${sub}</small></span>`
        + btn("rows", c, u === "rows") + btn("cols", c, u === "cols") + (f.numeric ? btn("vals", c, anyVal, 'title="合計を値に足します（値の札で平均・最小・最大に替えられます）"') : "<i></i>") + "</div>";
    }).join("");
    return html || '<p class="pv-none">当たるカラムがありません</p>';
  }
  function dimChip(d, role, i) {
    const parts = partsOf(d.column), pn = d.column === "@workday" ? WORKDAY_NAME : PART_NAME;
    const sel = parts.length > 1 ? `<select data-de-part="${role}" data-i="${i}" aria-label="まとめ方">${parts.map((x) => `<option value="${x}"${(d.part || "") === x ? " selected" : ""}>${pn[x]}</option>`).join("")}</select>` : "";
    return `<span class="pv-chip ${role === "rows" ? "r" : "c"}"><b>${esc(dimLabel(d))}</b>${sel}<button type="button" data-de-x="${role}" data-i="${i}" aria-label="「${esc(dimLabel(d))}」を外す">×</button></span>`;
  }
  function measChip(m, i) {
    const sel = m.agg === "count" || m.agg === "lots" ? "" : `<select data-de-agg="${i}" aria-label="集計のしかた">${AGGS.map(([k, n]) => `<option value="${k}"${m.agg === k ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    const name = m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : m.column;
    return `<span class="pv-chip v"><b>${esc(name)}</b>${sel}<button type="button" data-de-mx="${i}" aria-label="「${esc(P.measName(m))}」を外す">×</button></span>`;
  }
  function sentenceHtml() {
    const b = p.body, slot = (role, html, ph) => `<span class="pv-slot" data-role="${role}">${html || `<span class="pv-ph">${ph}</span>`}</span>`;
    const kpi = p.visual === "kpi";
    return `<div class="pv-sent de-sent">${kpi ? '<span class="pv-w">全体の</span>' : `${slot("rows", b.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］")}<span class="pv-w">ごとに、</span>`
      + `${slot("cols", b.cols.map((d, i) => dimChip(d, "cols", i)).join(""), "＋ 列")}<span class="pv-w">別の</span>`}`
      + `${slot("vals", b.measures.map(measChip).join(""), "ロット数")}<span class="pv-w">を出す</span></div>`;
  }
  function visualsHtml() {
    const all = EXTRA.concat(C.DEFS.filter((x) => x.k !== "none"));
    const ico = (x) => (x.icon && !C.get(x.k) ? `<svg class="pv-ico" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="${x.icon}"/></svg>` : C.iconSvg(x.k, 17));
    return `<div class="de-vis" role="radiogroup" aria-label="形">${all.map((x) => `<button type="button" class="pv-cbtn${p.visual === x.k ? " on" : ""}" role="radio" aria-checked="${p.visual === x.k}" data-de-vis="${x.k}" title="${esc(x.tip || "")}">${ico(x)}<span>${esc(x.n)}</span></button>`).join("")}</div>`;
  }
  function condHtml() {
    const cols = ((fields && fields.fields) || []).map((f) => f.column);
    const colOpts = (cur) => [`<option value="">列を選ぶ</option>`, ...cols.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`)].join("");
    const opOpts = (cur) => TPA.FILTER_OPS.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    const rows = p.filters.map((f, i) => `<div class="db-crow" data-i="${i}"><select data-de-f="column">${colOpts(f.column)}</select><select data-de-f="op">${opOpts(f.op || "eq")}</select>`
      + `<input data-de-f="value" value="${esc(f.value || "")}" placeholder="値"${TPA.noValueOp(f.op) ? " disabled" : ""}><button type="button" class="icon-btn" data-de-fdel="${i}" aria-label="この条件を外す">×</button></div>`).join("");
    const dates = [...(special().some((x) => x.column === "@workday") ? [["@workday", "作業日（勤務体系で決めた日）"]] : []), ...((fields && fields.fields) || []).filter((f) => f.date).map((f) => [f.column, f.column])];
    const pr = p.period || {}, kind = pr.kind || "";
    const period = `<div class="de-row"><label class="de-l">期間</label><select data-de-pkind aria-label="期間">${PERIODS.map(([k, n]) => `<option value="${k}"${k === kind ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + (kind === "days" ? `<input type="number" min="1" max="3660" data-de-pn value="${pr.n || 7}" aria-label="日の数" class="de-n">日` : "")
      + (kind ? `<select data-de-pcol aria-label="期間で絞る日付">${dates.map(([c, n]) => `<option value="${esc(c)}"${c === pr.column ? " selected" : ""}>${esc(n)}</option>`).join("") || '<option value="">（日付の列がありません）</option>'}</select>` : "")
      + "</div>";
    return `${period}<div class="de-row de-top"><label class="de-l">条件</label><div class="db-crows">${rows || '<small class="de-hint">すべての行を数えます</small>'}</div></div>`
      + `<div class="de-row"><span class="de-l"></span><button type="button" class="pv-btn" data-de-fadd${cols.length ? "" : " disabled"}>＋ 条件を足す</button></div>`;
  }
  function sortHtml() {
    const emph = `<label class="pv-ck" title="最初に見る数に（淡い藍の地と藍の枠）"><input type="checkbox" data-de-emph${p.emph ? " checked" : ""}>目立たせる</label>`;
    if (p.visual === "kpi") return `<div class="de-row"><span class="de-l">見せ方</span>${emph}</div>`;
    return `<div class="de-row"><label class="de-l">並べ方</label><select data-de-sort aria-label="並べ方">${[["", "決まった順（名前・日付）"], ["desc", "値の大きい順"], ["asc", "値の小さい順"]].map(([k, n]) => `<option value="${k}"${(p.sort || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + `<label class="pv-ck">上位<input type="number" min="0" max="60" data-de-top value="${p.top || 0}" class="de-n" aria-label="上位いくつ（0＝パネルに入るだけ）"></label><small class="de-hint">0＝パネルに入るだけ</small>${emph}</div>`;
  }
  function dataHtml() {
    const src = srcOf(p.source);
    const equips = src && src.equips ? `<select data-de-equip aria-label="設備"><option value="">すべての設備</option>${src.equips.map((e) => `<option value="${esc(e.key)}"${e.key === p.equip ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : "";
    const basis = isWork() ? `<select data-de-basis aria-label="作業日の数え方"><option value="work"${p.basis !== "cal" ? " selected" : ""}>現場歴</option><option value="cal"${p.basis === "cal" ? " selected" : ""}>太陽暦</option></select>` : "";
    return `<div class="de-row"><label class="de-l">データ</label><select data-de-src aria-label="データ">${sources.map((x) => `<option value="${esc(x.key)}"${x.key === p.source ? " selected" : ""}${x.place ? "" : " disabled"}>${esc(x.name)}${x.place ? "" : "（場所が未設定）"}</option>`).join("")}</select>${equips}${basis}</div>`;
  }

  function paint(repaintFields = true) {
    const el = $("#dbEditor"); if (!el || !p) return;
    if (!el.firstChild) {
      el.innerHTML = `<div class="de-head" data-drag><b>パネルを組む</b><input id="deTitle" class="de-title" autocomplete="off" aria-label="題" maxlength="60">`
        + `<span class="db-sp"></span><button type="button" class="btn-ghost" data-de-cancel>やめる</button><button type="button" class="btn-primary" data-de-apply>当てる</button></div>`
        + `<div class="de-body"><aside class="pv-fields de-fields"><div class="pv-cap"><b>カラム</b><small>札を押すと右の文に入ります（もう一度押すと外れます）</small></div>`
        + `<input id="deSearch" type="search" placeholder="カラムを検索" autocomplete="off" aria-label="カラムを検索"><div class="pv-list" id="deFields"></div></aside>`
        + `<div class="de-main"><div id="deData"></div><div id="deSent"></div><div id="deVis"></div><div id="deCond"></div><div id="deSort"></div><p class="de-msg" id="deMsg" aria-live="polite"></p></div></div>`;
      TPA.onText($("#deSearch"), (v) => { q = v; $("#deFields").innerHTML = fieldsHtml(); });
      TPA.onText($("#deTitle"), (v) => { p.title = v.slice(0, 60); host.onChange(TPA.clone(p)); });
    }
    const t = $("#deTitle");
    if (document.activeElement !== t) t.value = p.title || "";
    t.placeholder = autoTitle(p);
    if (repaintFields) $("#deFields").innerHTML = fieldsHtml();
    $("#deData").innerHTML = dataHtml();
    $("#deSent").innerHTML = sentenceHtml();
    $("#deVis").innerHTML = visualsHtml();
    if (!el.contains(document.activeElement) || !document.activeElement.closest("#deCond")) $("#deCond").innerHTML = condHtml();
    $("#deSort").innerHTML = sortHtml();
  }
  function message(text) { const m = $("#deMsg"); if (m) m.textContent = text || ""; }

  function bind(el) {
    el.addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t || !p) return;
      if (t.hasAttribute("data-de-cancel")) { host.onCancel(); return; }
      if (t.hasAttribute("data-de-apply")) { host.onApply(TPA.clone(p)); return; }
      if (t.dataset.deAdd) {
        const role = t.dataset.deAdd, col = t.dataset.col;
        if (role === "vals") addMeasure(col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : { agg: "sum", column: col });
        else addDim(role, col);
        return;
      }
      if (t.dataset.deX) { p.body[t.dataset.deX].splice(+t.dataset.i, 1); changed(); return; }
      if (t.dataset.deMx != null) { p.body.measures.splice(+t.dataset.deMx, 1); if (!p.body.measures.length) p.body.measures = [{ agg: "lots" }]; changed(); return; }
      if (t.dataset.deVis) { setVisual(t.dataset.deVis); return; }
      if (t.hasAttribute("data-de-fadd")) { p.filters.push({ column: "", op: "eq", value: "" }); $("#deCond").innerHTML = condHtml(); return; }
      if (t.dataset.deFdel != null) { p.filters.splice(+t.dataset.deFdel, 1); $("#deCond").innerHTML = condHtml(); changed(false); }
    });
    el.addEventListener("change", (e) => {
      const t = e.target; if (!p) return;
      if (t.matches("[data-de-src]")) { setSource(t.value, ""); return; }
      if (t.matches("[data-de-equip]")) { setSource(p.source, t.value); return; }
      if (t.matches("[data-de-basis]")) { p.basis = t.value; changed(false); return; }
      if (t.matches("[data-de-part]")) { p.body[t.dataset.dePart][+t.dataset.i].part = t.value; changed(false); return; }
      if (t.matches("[data-de-agg]")) { p.body.measures[+t.dataset.deAgg].agg = t.value; changed(false); return; }
      if (t.matches("[data-de-pkind]")) {
        const dates = special().some((x) => x.column === "@workday") ? "@workday" : (((fields && fields.fields) || []).find((f) => f.date) || {}).column || "";
        p.period = t.value ? { column: (p.period && p.period.column) || dates, kind: t.value, n: (p.period && p.period.n) || 7 } : null;
        $("#deCond").innerHTML = condHtml(); changed(false); return;
      }
      if (t.matches("[data-de-pcol]")) { p.period.column = t.value; changed(false); return; }
      if (t.matches("[data-de-pn]")) { p.period.n = Math.max(1, Math.min(3660, +t.value || 7)); changed(false); return; }
      if (t.matches("[data-de-sort]")) { p.sort = t.value; changed(false); return; }
      if (t.matches("[data-de-emph]")) { p.emph = t.checked; changed(false); return; }
      if (t.matches("[data-de-top]")) { p.top = Math.max(0, Math.min(60, +t.value || 0)); changed(false); return; }
      const row = t.closest(".db-crow");
      if (row && t.dataset.deF) {
        const f = p.filters[+row.dataset.i]; f[t.dataset.deF] = t.value;
        if (t.dataset.deF === "op") row.querySelector('[data-de-f="value"]').disabled = TPA.noValueOp(t.value);
        if (f.column) changed(false);
      }
    });
  }

  window.DashEditor = {
    /** 開く。h = {panel, sources, onChange(panel), onApply(panel), onCancel(), toast(text)} */
    async open(h) {
      host = h; sources = h.sources || [];
      p = TPA.clone(h.panel);
      p.body = Object.assign({ rows: [], cols: [], measures: [{ agg: "lots" }], grand: false, labels: true, chartAt: 0 }, p.body || {});
      p.filters = p.filters || []; p.title = p.title || "";
      const el = $("#dbEditor");
      if (!el.dataset.bound) { bind(el); el.dataset.bound = "1"; }
      el.innerHTML = ""; el.hidden = false; q = "";
      paint();
      await loadFields();
      const t = $("#deTitle");
      if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(0, 0); t.scrollLeft = 0; }   // 字の頭から見せる（欄が狭いと末尾へ送られて頭が欠ける）
    },
    close() { const el = $("#dbEditor"); if (el) { el.hidden = true; el.innerHTML = ""; } host = null; p = null; },
    isOpen: () => !!p,
    panelId: () => (p ? p.id : ""),
    message, autoTitle,
    setSources(list) { sources = list || []; },
  };
})();
