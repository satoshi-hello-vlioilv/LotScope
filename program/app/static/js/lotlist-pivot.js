/* =========================================================================
   ピボット集計（集計表・グラフ。DataRelay のデータビュワーの集計表と同じ組み立て。版 3.23.0）
   - 形は 7 案＋2 回目で選んだ（program/tools/ui-proposals/2026-10-pivot*: M3）:
       件数の行の「一覧｜集計表・グラフ」で一覧の場所を集計に替える。左にカラムの札（行・列・値）、上に文
       「［行］ごとに、［列］別の［値］を出す」、その下にグラフの形の札（時系列・縦棒・横棒・ヒストグラム・表だけ）と
       「すぐに見る」組み方。グラフは横いっぱいに、表（小計・総計つき）はその下に。
   - 数え方はサーバーの 1 か所（services/pivot.py）。一覧と同じ絞り込み（検索・条件・列で絞り込む・スライサー）に当たる全件で数える。
     作業実績では「作業日（現場歴／太陽暦）」「直」と「ロット数（作業開始が同じ行を 1）」を使える（作業でまとめるのと同じ決め方）。
   - 行・列の段は、列の種類でまとめ方を選ぶ: 日付の列は 年月日・年月・年・月・曜日・時、数の列は 値のまま・区間（ヒストグラム）
   - 値は 件数・ロット数・数の列の 合計・平均・最小・最大（最大 4 つ。並べて出す）
   - 時系列は日付・年月・作業日の段で、間の日も空けて時の流れのまま描く（棒＝1 つ目の値・折れ線＝2 つ目以降で右の目盛り）
   - 覚え（この PC・範囲ごと）: tpa.lotlist.pivot.v1 {範囲: {view, rows, cols, measures, chart, sub, grand, chartAt}}
   一覧（lotlist.js）とは mount の引数だけでつながる: scope・api・query（絞り込みの問い合わせ字）・label・dateColumns・isWork・
   workParams（作業開始の列・日付の数え方）・conditions（Excel の出力の条件）・fileStem・toast・onView（一覧｜集計を替えた）
   ========================================================================= */
(function () {
  "use strict";
  const { $, $$, esc } = TPA;
  const KEY = "tpa.lotlist.pivot.v1";
  const PART_NAME = { "": "値のまま", date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const DATE_PARTS = ["date", "ym", "year", "month", "weekday", "hour", ""];
  const NUM_PARTS = ["", "bin"];
  const AGGS = [["sum", "合計"], ["avg", "平均"], ["min", "最小"], ["max", "最大"]];
  const CHARTS = [["time", "時系列", "日付・年月・作業日の段を、時の流れのまま（間の日も空けて）描きます"], ["column", "縦棒", "行の段ごとに縦の棒で比べます"],
    ["bar", "横棒", "行の段ごとに横の棒で比べます（名前が長いとき）"], ["hist", "ヒストグラム", "数の列を区間に分け、件数の山で傾向（ばらつき・偏り）を見ます"],
    ["none", "表だけ", "グラフを出さず、表だけを広く出します"]];
  const COLORS = ["#b5822a", "#2f7d78", "#4a62b0", "#c9564a", "#7658ae", "#5c8a2a", "#1f6aa8", "#8a5f18", "#5a6f77", "#d35d8e", "#0d8191", "#a5372c"];
  const ADDITIVE = new Set(["count", "lots", "sum"]);
  const MAX_DIMS = 3, MAX_MEASURES = 4, SEP = "\u001f";
  let host = null, fields = null, fieldsSig = "", answer = null, seq = 0, fq = "", timer = 0, resizeObs = null;

  /* ---- 覚え ---- */
  const all = () => TPA.local.get(KEY, {});
  const blank = () => ({ view: "list", rows: [], cols: [], measures: [], chart: "time", sub: true, grand: true, chartAt: 0 });
  const st = () => Object.assign(blank(), all()[host.scope()] || {});
  function save(patch) { const a = all(); a[host.scope()] = Object.assign(st(), patch); TPA.local.set(KEY, a); }
  const isOn = () => !!host && st().view === "pivot";

  /* ---- カラムの手がかり（値の種類の数・数の列か・日付の列か）。範囲と表が替わったら読み直す ---- */
  async function loadFields() {
    const sig = host.scope() + "|" + host.fieldsKey();
    if (fields && sig === fieldsSig) return fields;
    const r = await fetch(`${host.api()}/pivot?fields=1&${host.base()}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "カラムを読めませんでした");
    fieldsSig = sig; fields = d.fields || [];
    return fields;
  }
  const fieldOf = (c) => (fields || []).find((f) => f.column === c) || null;
  const isDate = (c) => host.dateColumns().includes(c);
  const isNum = (c) => !!(fieldOf(c) || {}).numeric;
  /* 作業実績の特別なカラム。作業日は作業開始の日（日付の数え方＝現場歴／太陽暦は、作業でまとめるのと同じ） */
  const workdayName = () => `作業日（${(host.workParams().basis || "work") === "cal" ? "太陽暦" : "現場歴"}）`;
  const WORK = () => [["@workday", workdayName(), "作業開始の日。日を跨ぐ直の数え方（現場歴／太陽暦）は、作業でまとめるのと同じです"], ["@shift", "直", "作業開始の時刻が入る直（マスタ管理の勤務体系）"]];
  const dimName = (d) => (d.column === "@workday" ? workdayName() : d.column === "@shift" ? "直" : host.label(d.column) + (d.part ? `（${PART_NAME[d.part]}）` : ""));
  const measName = (m) => (m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : `${host.label(m.column)}の${(AGGS.find((a) => a[0] === m.agg) || [])[1] || "合計"}`);
  function partsOf(col) {
    if (col.startsWith("@")) return [""];
    if (isDate(col)) return DATE_PARTS;
    if (isNum(col)) return NUM_PARTS;
    return [""];
  }
  function defaultPart(col) {
    if (col.startsWith("@")) return "";
    if (isDate(col)) return "date";
    const f = fieldOf(col);
    return f && f.numeric && (f.many || f.kinds > 30) ? "bin" : "";
  }

  /* ---- 組み方を変える ---- */
  function setDims(role, list) { save({ [role]: list.slice(0, MAX_DIMS) }); refresh(); }
  function addDim(role, col) {
    const s = st(), other = role === "rows" ? "cols" : "rows";
    if (s[role].some((d) => d.column === col)) { setDims(role, s[role].filter((d) => d.column !== col)); return; }   // もう一度押すと外す
    if (s[role].length >= MAX_DIMS) { host.toast(`${role === "rows" ? "行" : "列"}の段は ${MAX_DIMS} つまでです`); return; }
    save({ [other]: s[other].filter((d) => d.column !== col) });
    setDims(role, s[role].concat([{ column: col, part: defaultPart(col) }]));
  }
  function addMeasure(m) {
    const s = st(), same = (x) => x.agg === m.agg && x.column === m.column;
    if (s.measures.some(same)) { save({ measures: s.measures.filter((x) => !same(x)) }); refresh(); return; }
    if (s.measures.length >= MAX_MEASURES) { host.toast(`値は ${MAX_MEASURES} つまでです`); return; }
    save({ measures: s.measures.concat([m]) }); refresh();
  }
  function setView(v) {
    save({ view: v });
    host.onView(v === "pivot");
    paintSwitch();
    if (v === "pivot") refresh(true);
  }

  /* ---- 読む ---- */
  function query() {
    const s = st(), p = new URLSearchParams(host.query());
    p.set("rows", JSON.stringify(s.rows)); p.set("cols", JSON.stringify(s.cols));
    p.set("measures", JSON.stringify(s.measures.length ? s.measures : [{ agg: "count" }]));
    Object.entries(host.workParams()).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }
  /** 一覧が読み直された（絞り込み・範囲が変わった）ときに呼ばれる。集計表を見ていなければ何もしない */
  function refresh(now) {
    if (!isOn()) return;
    clearTimeout(timer);
    timer = setTimeout(load, now ? 0 : 120);
  }
  async function load() {
    const me = ++seq, pane = $("#llPivot");
    if (!pane || !isOn()) return;
    try { await loadFields(); } catch (e) { if (me === seq) { fields = fields || []; paint(null, e.message); } return; }
    const s = st();
    paint(answer, "", true);
    if (!s.rows.length) { answer = null; if (me === seq) paint(null); return; }
    const qs = query();
    try {
      const r = await fetch(`${host.api()}/pivot?${qs}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (me !== seq) return;
      if (!r.ok) throw new Error(d.error || "集計できませんでした");
      answer = d; fq = qs;
      paint(d);
    } catch (e) { if (me === seq) paint(null, e.message); }
  }

  /* ---- 件数の行の「一覧｜集計表・グラフ」 ---- */
  function paintSwitch() {
    const box = $("#llViewSwitch"); if (!box) return;
    const v = st().view;
    box.innerHTML = [["list", "一覧", "行を 1 つずつ並べます"], ["pivot", "集計表・グラフ", "いまの絞り込みに当たる全件を、行・列・値で集計し、表とグラフにします"]]
      .map(([k, n, tip]) => `<button type="button" role="tab" aria-selected="${v === k}" data-pv-view="${k}" title="${esc(tip)}">${n}</button>`).join("");
  }

  /* ---- 描く ---- */
  const fmt = (v) => {
    if (v == null || v === "") return "";
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return v.toLocaleString("ja-JP");
    return v.toLocaleString("ja-JP", { maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 3 });
  };
  function fieldsHtml(s) {
    const used = (c) => (s.rows.some((d) => d.column === c) ? "rows" : s.cols.some((d) => d.column === c) ? "cols" : "");
    const meas = (agg, col = "") => s.measures.some((m) => m.agg === agg && m.column === col);
    const anyVal = (c) => s.measures.some((m) => m.column === c);
    const ql = ($("#llPvSearch")?.value || "").trim().toLowerCase();
    const hit = (name) => !ql || name.toLowerCase().includes(ql);
    const btn = (role, col, on, extra = "") => `<button type="button" class="pv-r r-${role}${on ? " on" : ""}" data-pv-add="${role}" data-col="${esc(col)}" aria-pressed="${on}" ${extra}>${{ rows: "行", cols: "列", vals: "値" }[role]}</button>`;
    let html = "";
    // 作業実績の特別なカラム（作業日・直・ロット数）と、件数
    const special = (host.isWork() ? WORK().map(([c, n, tip]) => `<div class="pv-f is-special${used(c) ? " is-used" : ""}" title="${esc(tip)}"><span><b>${n}</b><small>${c === "@workday" ? "作業開始の日" : "勤務体系の直"}</small></span>${btn("rows", c, used(c) === "rows")}${btn("cols", c, used(c) === "cols")}<i></i></div>`).join("") : "")
      + `<div class="pv-f is-special${meas("lots") ? " is-used" : ""}" title="${host.isWork() ? "作業開始が同じ行（分割したロット）を 1 と数えます" : "ロット番号が同じ行を 1 と数えます"}"><span><b>ロット数</b><small>${host.isWork() ? "重複の無い作業開始" : "重複の無いロット番号"}</small></span><i></i><i></i>${btn("vals", "@lots", meas("lots"))}</div>`
      + `<div class="pv-f is-special${meas("count") ? " is-used" : ""}" title="当たる行の数"><span><b>件数</b><small>行の数</small></span><i></i><i></i>${btn("vals", "@count", meas("count"))}</div>`;
    if (hit("作業日 直 ロット数 件数")) html += special;
    html += (fields || []).filter((f) => hit(f.column) || hit(host.label(f.column))).map((f) => {
      const c = f.column, u = used(c), date = isDate(c);
      const sub = date ? "日付" : f.numeric ? `数${f.many ? "" : ` · ${f.kinds} 種類`}` : f.many ? "1,000 種類以上" : `${f.kinds} 種類`;
      return `<div class="pv-f${u || anyVal(c) ? " is-used" : ""}${date ? " is-date" : ""}${f.numeric ? " is-num" : ""}" data-col="${esc(c)}"><span title="${esc(c)}"><b>${esc(host.label(c))}</b><small>${sub}</small></span>`
        + btn("rows", c, u === "rows") + btn("cols", c, u === "cols") + (f.numeric ? btn("vals", c, anyVal(c), 'title="合計を値に足します（値の札で平均・最小・最大に替えられます）"') : "<i></i>") + "</div>";
    }).join("");
    return html || '<p class="pv-none">当たるカラムがありません</p>';
  }
  function dimChip(d, role, i) {
    const parts = partsOf(d.column);
    const sel = parts.length > 1 ? `<select data-pv-part="${role}" data-i="${i}" aria-label="まとめ方">${parts.map((p) => `<option value="${p}"${(d.part || "") === p ? " selected" : ""}>${PART_NAME[p]}</option>`).join("")}</select>` : "";
    const name = d.column === "@workday" ? workdayName() : d.column === "@shift" ? "直" : host.label(d.column);
    return `<span class="pv-chip ${role === "rows" ? "r" : "c"}" title="${esc(dimName(d))}"><b>${esc(name)}</b>${sel}<button type="button" data-pv-x="${role}" data-i="${i}" aria-label="「${esc(name)}」を外す">×</button></span>`;
  }
  function measChip(m, i) {
    const sel = m.agg === "count" || m.agg === "lots" ? "" : `<select data-pv-agg="${i}" aria-label="集計のしかた">${AGGS.map(([k, n]) => `<option value="${k}"${m.agg === k ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    const name = m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : host.label(m.column);
    return `<span class="pv-chip v" title="${esc(measName(m))}"><b>${esc(name)}</b>${sel}<button type="button" data-pv-mx="${i}" aria-label="「${esc(measName(m))}」を外す">×</button></span>`;
  }
  function sentenceHtml(s) {
    const slot = (role, html, ph) => `<span class="pv-slot" data-role="${role}">${html || `<span class="pv-ph">${ph}</span>`}</span>`;
    return `<div class="pv-sent">${slot("rows", s.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］を押す")}<span class="pv-w">ごとに、</span>`
      + `${slot("cols", s.cols.map((d, i) => dimChip(d, "cols", i)).join(""), "＋ 列")}<span class="pv-w">別の</span>`
      + `${slot("vals", s.measures.map(measChip).join(""), "件数")}<span class="pv-w">を出す</span><span class="pv-sp"></span>`
      + `<label class="pv-ck"><input type="checkbox" data-pv-opt="sub"${s.sub ? " checked" : ""}>小計</label><label class="pv-ck"><input type="checkbox" data-pv-opt="grand"${s.grand ? " checked" : ""}>総計</label>`
      + `<button type="button" class="pv-btn" data-pv-xlsx${answer && s.rows.length ? "" : " disabled"} title="この集計表を Excel（.xlsx）に出します（出力の条件のシートつき）">Excel に出力</button>`
      + `<button type="button" class="pv-link" data-pv-clear${s.rows.length || s.cols.length || s.measures.length ? "" : " disabled"}>すべて外す</button></div>`;
  }
  /** 量を表す数の列（重量 → 数量・長さ・枚数 → 最初の数の列）。すぐに見る組み方とヒストグラムが同じ選び方をする */
  function preferredNumeric() {
    const nums = (fields || []).filter((f) => f.numeric && !isDate(f.column));
    return nums.find((f) => /重量|重さ|質量/.test(f.column)) || nums.find((f) => /数量|長さ|枚数/.test(f.column)) || nums[0] || null;
  }
  /* すぐに見る組み方（種類の少ない列・数の列・日付の列から。作業実績は作業日ごとのロット数・重量を先頭に） */
  function quickPicks() {
    const F = fields || [], few = F.filter((f) => !f.numeric && !isDate(f.column) && f.kinds >= 2 && f.kinds <= 12).sort((a, b) => a.kinds - b.kinds);
    const weight = preferredNumeric();
    const date = F.find((f) => isDate(f.column));
    const out = [];
    if (host.isWork()) {
      out.push({ name: `作業日ごとのロット数${weight ? `・${host.label(weight.column)}` : ""}`, rows: [{ column: "@workday", part: "" }], cols: [],
        measures: [{ agg: "lots" }].concat(weight ? [{ agg: "sum", column: weight.column }] : []), chart: "time" });
      out.push({ name: "日×直のロット数", rows: [{ column: "@workday", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }], chart: "time" });
    } else if (date) {
      out.push({ name: `${host.label(date.column)}（年月）ごとの件数`, rows: [{ column: date.column, part: "ym" }], cols: [], measures: [{ agg: "count" }, { agg: "lots" }], chart: "time" });
    }
    if (weight) out.push({ name: `${host.label(weight.column)}のヒストグラム`, rows: [{ column: weight.column, part: "bin" }], cols: [], measures: [{ agg: "count" }], chart: "hist" });
    if (few.length >= 2) out.push({ name: `${host.label(few[0].column)}×${host.label(few[1].column)}の件数`, rows: [{ column: few[0].column, part: "" }], cols: [{ column: few[1].column, part: "" }], measures: [{ agg: "count" }], chart: "column" });
    else if (few.length) out.push({ name: `${host.label(few[0].column)}ごとの件数`, rows: [{ column: few[0].column, part: "" }], cols: [], measures: [{ agg: "count" }], chart: "column" });
    return out.slice(0, 4);
  }
  function barHtml(s) {
    const picks = quickPicks();
    return `<div class="pv-bar"><span class="pv-tabs" role="radiogroup" aria-label="グラフの形">${CHARTS.map(([k, n, tip]) => `<button type="button" role="radio" aria-checked="${s.chart === k}" data-pv-chart="${k}" title="${esc(tip)}">${n}</button>`).join("")}</span>`
      + `<span class="pv-sp"></span>${picks.length ? `<span class="pv-w">すぐに見る:</span>${picks.map((p, i) => `<button type="button" class="pv-quick" data-pv-quick="${i}">${esc(p.name)}</button>`).join("")}` : ""}</div>`;
  }
  /** 全体を描く（busy は読み直している間: 前の答えのまま薄くする） */
  function paint(d, err = "", busy = false) {
    const pane = $("#llPivot"); if (!pane || !host) return;
    const s = st();
    if (!pane.firstChild) {
      pane.innerHTML = `<aside class="pv-fields"><div class="pv-cap"><b>カラム</b><small>札を押すと上の文に入ります（もう一度押すと外れます）</small></div>`
        + '<input id="llPvSearch" type="search" placeholder="カラムを検索" autocomplete="off" aria-label="カラムを検索"><div class="pv-list" id="llPvFields"></div></aside>'
        + '<div class="pv-main"><div id="llPvHead"></div><div class="pv-msg" id="llPvMsg" hidden></div><div class="pv-out" id="llPvOut"></div></div>';
    }
    $("#llPvFields").innerHTML = fieldsHtml(s);
    $("#llPvHead").innerHTML = sentenceHtml(s) + barHtml(s);
    const msg = $("#llPvMsg"), out = $("#llPvOut");
    out.classList.toggle("is-busy", busy);
    if (busy) return;
    const notes = [];
    if (err) notes.push(`<b>集計できませんでした:</b> ${esc(err)}`);
    if (d && d.truncated && (d.truncated.rows || d.truncated.cols)) {
      const parts = [d.truncated.rows ? `行は ${d.truncated.rows.toLocaleString()} 種類のうち先頭 2,000 種類` : "", d.truncated.cols ? `列は ${d.truncated.cols.toLocaleString()} 種類のうち先頭 120 種類` : ""].filter(Boolean);
      notes.push(`種類が多いので、${parts.join("・")}だけを出しています（条件で絞るか、まとめ方を粗くしてください）。`);
    }
    if (d && d.note) notes.push(esc(d.note));
    msg.hidden = !notes.length; msg.innerHTML = notes.join("<br>");
    if (!s.rows.length) { out.innerHTML = emptyHtml(); return; }
    if (!d) { out.innerHTML = ""; return; }
    const model = buildModel(d, s);
    out.innerHTML = (s.chart === "none" ? "" : `<div class="pv-chart" id="llPvChart"></div>`)
      + `<div class="pv-tablebox"><table class="pv-table">${tableHtml(model, d)}</table></div>`
      + `<div class="pv-hint">${esc(hintText(model, d))}</div>`;
    if (s.chart !== "none") paintChart(model, d, s);
  }
  function emptyHtml() {
    const picks = quickPicks();
    return `<div class="pv-empty"><b>左のカラムの［行］を押すと、値ごとの件数が出ます</b><span>種類の少ないカラムが行・列に向いています。日付のカラムは年月日・年月などで、数のカラムは区間（ヒストグラム）でまとめられます。`
      + `${host.isWork() ? "作業実績では「作業日」「直」「ロット数」も使えます。" : ""}${picks.length ? "すぐに見るなら:" : ""}</span>`
      + (picks.length ? `<div class="pv-quickbig">${picks.map((p, i) => `<button type="button" class="pv-quick" data-pv-quick="${i}">${esc(p.name)}</button>`).join("")}</div>` : "") + "</div>";
  }

  /* ---- 答え → 表の形（行・列の葉。小計・総計を入れる） ---- */
  function buildModel(d, s) {
    const nr = d.dims.rows.length, nc = d.dims.cols.length, M = d.measures.length;
    const cellMap = new Map(d.cells.map((x) => [x.r.join(SEP) + "\u001e" + x.c.join(SEP), x.v]));
    const lab = (i, k) => (d.labels[i] || {})[k] ?? k;
    const leaves = (n, off, axis) => {
      if (!n) return [{ type: "all", path: [] }];
      const have = new Set(d.cells.filter((x) => x[axis].length === n).map((x) => x[axis].join(SEP)));
      const rank = Array.from({ length: n }, (_, i) => new Map((d.orders[off + i] || []).map((k, j) => [k, j])));
      const paths = [...have].map((p) => p.split(SEP)).sort((a, b) => { for (let i = 0; i < n; i++) { const x = rank[i].get(a[i]) ?? 1e9, y = rank[i].get(b[i]) ?? 1e9; if (x !== y) return x - y; } return 0; });
      const out = [];
      paths.forEach((p, k) => {
        out.push({ type: "data", path: p });
        // この段の頭が次の葉で変わる所に小計（下の段から）
        if (s.sub) for (let lv = n - 1; lv >= 1; lv--) {
          const next = paths[k + 1];
          if (!next || next.slice(0, lv).join(SEP) !== p.slice(0, lv).join(SEP)) out.push({ type: "sub", path: p.slice(0, lv) });
        }
      });
      if (s.grand) out.push({ type: "grand", path: [] });
      return out;
    };
    const rows = leaves(nr, 0, "r"), cols = leaves(nc, nr, "c");
    const value = (r, c, j) => { const v = cellMap.get(r.path.join(SEP) + "\u001e" + c.path.join(SEP)); return v ? v[j] : null; };
    return { nr, nc, M, rows, cols, value, lab, rowName: (r) => r.path.map((k, i) => lab(i, k)).join(" / "), colName: (c) => c.path.map((k, i) => lab(nr + i, k)).join(" / ") };
  }
  function tableHtml(m, d) {
    const { nr, nc, M, rows, cols } = m;
    const mNames = d.measures.map((x) => measName(x));
    // 見出し: 列の段ごとの行（同じ頭はまとめる）＋値の名前の行（値が 2 つ以上か、列が無いとき）
    let head = "";
    const withMeasRow = M > 1 || !nc;
    const headRows = nc + (withMeasRow ? 1 : 0);
    const corner = `<th class="pv-corner" rowspan="${headRows}" colspan="${Math.max(1, nr)}">${esc(d.dims.rows.map((x) => dimName(x)).join(" ＞ "))}${nc ? `<small>${esc(d.dims.cols.map((x) => dimName(x)).join(" ＞ "))} →</small>` : ""}</th>`;
    for (let lv = 0; lv < nc; lv++) {
      let tr = lv === 0 ? corner : "";
      for (let i = 0; i < cols.length;) {
        const c = cols[i];
        if (c.type === "grand") { if (lv === 0) tr += `<th class="pv-gt" rowspan="${nc}" colspan="${M}">総計</th>`; i++; continue; }
        if (c.type === "sub" && c.path.length <= lv) { if (c.path.length === lv) tr += `<th class="pv-st" rowspan="${nc - lv}" colspan="${M}">${esc(m.lab(nr + lv - 1, c.path[lv - 1]))} 小計</th>`; i++; continue; }
        let j = i + 1;
        const pref = c.path.slice(0, lv + 1).join(SEP);
        while (j < cols.length && cols[j].type !== "grand" && cols[j].path.length > lv && cols[j].path.slice(0, lv + 1).join(SEP) === pref) j++;
        tr += `<th colspan="${(j - i) * M}">${esc(m.lab(nr + lv, c.path[lv]))}</th>`;
        i = j;
      }
      head += `<tr>${tr}</tr>`;
    }
    if (withMeasRow) head += `<tr>${nc ? "" : corner}${cols.map(() => mNames.map((n) => `<th class="pv-mh">${esc(n)}</th>`).join("")).join("")}</tr>`;
    // 本文: 行の見出し（同じ頭は縦にまとめる）＋数
    const span = (i, lv) => { let j = i + 1; const pref = rows[i].path.slice(0, lv + 1).join(SEP); while (j < rows.length && rows[j].type === "data" && rows[j].path.slice(0, lv + 1).join(SEP) === pref) j++; return j - i; };
    const body = rows.map((r, i) => {
      let th = "";
      if (r.type === "grand") th = `<th colspan="${Math.max(1, nr)}" class="pv-gt">総計</th>`;
      else if (r.type === "sub") th = `<th colspan="${nr}" class="pv-st">${esc(m.rowName(r))} 小計</th>`;   // 段の数に関わらず全段にまたがらせる（列がずれない）
      else if (!nr) th = "<th>（全体）</th>";
      else for (let lv = 0; lv < nr; lv++) {
        const prev = rows[i - 1];
        const cont = prev && prev.type === "data" && prev.path.slice(0, lv + 1).join(SEP) === r.path.slice(0, lv + 1).join(SEP);
        if (!cont) th += `<th rowspan="${lv === nr - 1 ? 1 : span(i, lv)}">${esc(m.lab(lv, r.path[lv]))}</th>`;
      }
      const tds = cols.map((c) => d.measures.map((_, j) => { const v = m.value(r, c, j); return `<td class="${c.type === "grand" ? "pv-gtc" : c.type === "sub" ? "pv-stc" : ""}">${fmt(v)}</td>`; }).join("")).join("");
      return `<tr class="${r.type === "grand" ? "is-grand" : r.type === "sub" ? "is-sub" : ""}">${th}${tds}</tr>`;
    }).join("");
    return `<thead>${head}</thead><tbody>${body}</tbody>`;
  }
  function hintText(m, d) {
    const nData = m.rows.filter((r) => r.type === "data").length, nCol = m.cols.filter((c) => c.type === "data" || c.type === "all").length;
    return `行 ${nData.toLocaleString()} × 列 ${nCol.toLocaleString()} ・ ${d.measures.map((x) => measName(x)).join("・")} ・ ${d.count.toLocaleString()} 行から（一覧と同じ絞り込み）`
      + (d.shiftPattern ? ` ・ 直: ${d.shiftPattern}` : "") + (d.timing ? ` ・ ${d.timing.server}ms` : "");
  }

  /* ---- グラフ（SVG） ---- */
  const TIME_PARTS = new Set(["date", "ym", "year", "hour"]);
  function isTime(d) { const x = d.dims.rows[0]; return !!x && (x.column === "@workday" || TIME_PARTS.has(x.part)); }
  /** 時系列の横の目盛り: 日付・年月は間も空けて並べる（無い日は値なし） */
  function timeAxis(m, d) {
    const data = m.rows.filter((r) => r.type === "data");
    const x = d.dims.rows[0], part = x.column === "@workday" ? "date" : x.part;
    const keys = [...new Set(data.map((r) => r.path[0]).filter(Boolean))];
    if (!keys.length) return { ticks: [], at: () => -1 };
    let ticks = keys;
    if (part === "date" && /^\d{4}-\d{2}-\d{2}$/.test(keys[0])) {
      const days = [], a = new Date(keys[0] + "T00:00:00"), b = new Date(keys[keys.length - 1] + "T00:00:00");
      for (let t = new Date(a); t <= b && days.length < 2000; t.setDate(t.getDate() + 1)) days.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
      ticks = days;
    } else if (part === "ym" && /^\d{4}-\d{2}$/.test(keys[0])) {
      const out = []; let [y, mo] = keys[0].split("-").map(Number); const [y2, m2] = keys[keys.length - 1].split("-").map(Number);
      while ((y < y2 || (y === y2 && mo <= m2)) && out.length < 600) { out.push(`${y}-${String(mo).padStart(2, "0")}`); mo++; if (mo > 12) { mo = 1; y++; } }
      ticks = out;
    }
    const pos = new Map(ticks.map((k, i) => [k, i]));
    return { ticks, at: (k) => pos.get(k) ?? -1, part };
  }
  function paintChart(m, d, s) {
    const box = $("#llPvChart"); if (!box) return;
    const W = Math.max(600, box.clientWidth - 20), H = s.chart === "bar" ? Math.max(260, Math.min(900, 26 * m.rows.filter((r) => r.type === "data").length + 60)) : 300;
    let svg = "", legend = "", side = "";
    if (s.chart === "hist") ({ svg, side } = histChart(m, d, W, H));
    else if (s.chart === "time" && isTime(d)) ({ svg, legend } = timeChart(m, d, W, H));
    else ({ svg, legend } = barChart(m, d, W, H, s.chart === "bar" ? "bar" : "column", s.chart === "time"));
    box.innerHTML = `<div class="pv-chead">${legend}</div><div class="pv-cbody">${svg}${side}</div>`;
    if (!resizeObs && typeof ResizeObserver !== "undefined") {
      let w0 = box.clientWidth;
      resizeObs = new ResizeObserver(() => { const b = $("#llPvChart"); if (b && Math.abs(b.clientWidth - w0) > 30 && answer) { w0 = b.clientWidth; paintChart(buildModel(answer, st()), answer, st()); } });
      resizeObs.observe($("#llPivot"));
    }
  }
  /* 目盛りの最大（4 等分した目盛りがきりの良い数になる物: 1・2・4・6・8・10 × 10^k） */
  const niceMax = (v) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); return [1, 2, 4, 6, 8, 10].map((k) => k * e).find((x) => x >= v); };
  const legendHtml = (items) => `<span class="pv-legend">${items.map(([name, color, kind]) => `<span><i class="${kind === "line" ? "is-line" : ""}" style="--c:${color}"></i>${esc(name)}</span>`).join("")}</span>`;
  function axisY(x0, y0, h, max, right, W, color = "#6b7680") {
    return [0, 0.25, 0.5, 0.75, 1].map((f) => { const y = y0 + h * (1 - f); return `${right ? "" : `<line x1="${x0}" x2="${W - 56}" y1="${y}" y2="${y}" class="pv-grid"/>`}<text x="${right ? W - 50 : x0 - 6}" y="${y + 4}" text-anchor="${right ? "start" : "end"}" fill="${color}" class="pv-ax">${esc(short(max * f))}</text>`; }).join("");
  }
  const short = (v) => (Math.abs(v) >= 1e8 ? `${+(v / 1e8).toFixed(1)}億` : Math.abs(v) >= 1e4 ? `${+(v / 1e4).toFixed(1)}万` : fmt(Math.round(v * 100) / 100));
  /** 時系列: 1 つ目の値＝棒（足し上げる値）か折れ線、2 つ目以降＝折れ線（右の目盛り）。列の段があれば 1 つ目の値を列ごとの折れ線に */
  function timeChart(m, d, W, H) {
    const ax = timeAxis(m, d), n = ax.ticks.length, pl = 60, pr = 60, pt = 12, pb = 40, iw = W - pl - pr, ih = H - pt - pb;
    const data = m.rows.filter((r) => r.type === "data" && r.path.length);
    const x = (i) => pl + iw * (i + 0.5) / Math.max(n, 1), bw = Math.max(2, Math.min(40, iw / Math.max(n, 1) * 0.7));
    // 系列: 列の段があれば列ごと（1 つ目の値）、無ければ値ごと
    const series = [];
    const colsData = m.cols.filter((c) => c.type === "data" || c.type === "all");
    // 列の段があれば列ごと（1 つ目の値）: 足し上げる値は積み上げの棒（棒の高さ＝その日の合計）、平均などは折れ線
    const stack = m.nc > 0 && ADDITIVE.has(d.measures[0].agg);
    if (m.nc) colsData.slice(0, 12).forEach((c, k) => series.push({ name: m.colName(c), j: 0, c, axis: "left", kind: stack ? "stack" : "line", color: COLORS[(k + 1) % COLORS.length] }));
    else d.measures.forEach((mm, j) => series.push({ name: measName(mm), j, c: colsData[0], axis: j === 0 ? "left" : "right", kind: j === 0 && ADDITIVE.has(mm.agg) ? "bar" : "line", color: COLORS[j % COLORS.length] }));
    // 上の段（日付など）ごとの値。段が 2 つ以上なら上の段の小計を使う
    const at = (r) => ax.at(r.path[0]);
    const pick = (ser) => {
      const v = new Array(n).fill(null);
      const rowsAt = m.nr > 1 ? m.rows.filter((r) => r.type === "sub" && r.path.length === 1) : data;
      rowsAt.forEach((r) => { const i = at(r); if (i >= 0) v[i] = m.value(r, ser.c, ser.j); });
      if (m.nr > 1 && !rowsAt.length) data.forEach((r) => { const i = at(r); if (i >= 0) v[i] = (v[i] || 0) + (m.value(r, ser.c, ser.j) || 0); });
      return v;
    };
    // 足し上げる値（件数・ロット数・合計）は、無い日を 0 にする（作業しなかった日＝0。線が途切れない）。平均・最小・最大は無いまま
    series.forEach((s) => { s.v = pick(s); if (ADDITIVE.has(d.measures[s.j].agg)) s.v = s.v.map((v) => v ?? 0); });
    const stacked = series.filter((s) => s.kind === "stack");
    const tops = stacked.length ? ax.ticks.map((_, i) => stacked.reduce((a, s) => a + (s.v[i] || 0), 0)) : [];
    const maxL = niceMax(Math.max(0, ...tops, ...series.filter((s) => s.axis === "left" && s.kind !== "stack").flatMap((s) => s.v.filter((v) => v != null))));
    const maxR = niceMax(Math.max(0, ...series.filter((s) => s.axis === "right").flatMap((s) => s.v.filter((v) => v != null))));
    const y = (v, s) => pt + ih * (1 - v / (s.axis === "left" ? maxL : maxR));
    let g = axisY(pl, pt, ih, maxL, false, W, series.some((s) => s.axis === "left" && s.kind === "bar") ? COLORS[0] : "#6b7680");
    if (series.some((s) => s.axis === "right")) g += axisY(pl, pt, ih, maxR, true, W, COLORS[1]);
    const lab = (k) => m.lab(0, k);
    if (stacked.length) ax.ticks.forEach((k, i) => {
      let base = 0;
      stacked.forEach((s) => { const v = s.v[i] || 0; if (!v) return; const y1 = y(base + v, s), y0 = y(base, s); g += `<rect x="${x(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${s.color}" opacity=".88"><title>${esc(lab(k))}: ${esc(s.name)} ${esc(fmt(v))}（計 ${esc(fmt(tops[i]))}）</title></rect>`; base += v; });
    });
    series.filter((s) => s.kind === "bar").forEach((s) => { s.v.forEach((v, i) => { if (v) g += `<rect x="${x(i) - bw / 2}" y="${y(v, s)}" width="${bw}" height="${Math.max(0, pt + ih - y(v, s))}" fill="${s.color}" opacity=".82"><title>${esc(lab(ax.ticks[i]))}: ${esc(s.name)} ${esc(fmt(v))}</title></rect>`; }); });
    series.filter((s) => s.kind === "line").forEach((s) => {
      let dpath = "", pen = false;
      s.v.forEach((v, i) => { if (v == null) { pen = false; return; } dpath += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v, s).toFixed(1)}`; pen = true; });
      g += `<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="2.2"/>`;
      if (n <= 120) s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v, s)}" r="2.8" fill="#fff" stroke="${s.color}" stroke-width="1.8"><title>${esc(lab(ax.ticks[i]))}: ${esc(s.name)} ${esc(fmt(v))}</title></circle>`; });
    });
    const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / 70))));
    ax.ticks.forEach((k, i) => { if (i % every === 0) g += `<text x="${x(i)}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(tickText(k, ax.part))}</text>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const legend = legendHtml(series.map((s) => [s.name + (series.some((q) => q.axis === "right") ? (s.axis === "left" ? "（左）" : "（右）") : ""), s.color, s.kind === "line" ? "line" : "bar"]))
      + `<small class="pv-cnote">${n} 刻み・${esc(dimName(d.dims.rows[0]))}${m.nr > 1 ? "（上の段の小計で描きます）" : ""}</small>`;
    return { svg: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="時系列のグラフ">${g}</svg>`, legend };
  }
  function tickText(k, part) {
    if (part === "date" && /^\d{4}-\d{2}-\d{2}$/.test(k)) return `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
    if (part === "ym" && /^\d{4}-\d{2}$/.test(k)) return `${k.slice(2, 4)}/${k.slice(5, 7)}`;
    return k;
  }
  /** 縦棒・横棒: 行の葉ごとに、列の葉（1 つ目の値）か値ごと（値を選ぶ）の棒 */
  function barChart(m, d, W, H, dir, wanted) {
    const s = st(), data = m.rows.filter((r) => r.type === "data").slice(0, 80);
    const colsData = m.cols.filter((c) => c.type === "data" || c.type === "all").slice(0, 12);
    const j = Math.min(s.chartAt || 0, d.measures.length - 1);
    const series = m.nc ? colsData.map((c, k) => ({ name: m.colName(c), c, j, color: COLORS[k % COLORS.length] })) : [{ name: measName(d.measures[j]), c: colsData[0], j, color: COLORS[j % COLORS.length] }];
    const vals = data.map((r) => series.map((x) => m.value(r, x.c, x.j) || 0));
    const max = niceMax(Math.max(0, ...vals.flat()));
    let g = "";
    if (dir === "column") {
      const pl = 60, pr = 20, pt = 12, pb = 56, iw = W - pl - pr, ih = H - pt - pb, gw = iw / Math.max(data.length, 1), bw = Math.max(2, Math.min(36, gw * 0.8 / series.length));
      g += axisY(pl, pt, ih, max, false, W + 36);
      data.forEach((r, i) => {
        series.forEach((x, k) => { const v = vals[i][k], h = ih * v / max, bx = pl + gw * i + (gw - bw * series.length) / 2 + bw * k; g += `<rect x="${bx}" y="${pt + ih - h}" width="${bw}" height="${h}" fill="${x.color}"><title>${esc(m.rowName(r))}${series.length > 1 ? ` / ${esc(x.name)}` : ""}: ${esc(fmt(v))}</title></rect>`; });
        g += `<text x="${pl + gw * (i + 0.5)}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(clip(m.rowName(r), Math.max(4, Math.floor(gw / 8))))}</text>`;
      });
      g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    } else {
      const pl = 160, pr = 70, pt = 8, rh = (H - 30) / Math.max(data.length, 1), bh = Math.max(3, Math.min(18, rh * 0.75 / series.length)), iw = W - pl - pr;
      data.forEach((r, i) => {
        g += `<text x="${pl - 8}" y="${pt + rh * (i + 0.5) + 4}" text-anchor="end" class="pv-ax">${esc(clip(m.rowName(r), 20))}</text>`;
        series.forEach((x, k) => { const v = vals[i][k], w = iw * v / max, by = pt + rh * i + (rh - bh * series.length) / 2 + bh * k; g += `<rect x="${pl}" y="${by}" width="${w}" height="${bh}" fill="${x.color}"><title>${esc(m.rowName(r))}${series.length > 1 ? ` / ${esc(x.name)}` : ""}: ${esc(fmt(v))}</title></rect>`
          + (series.length === 1 ? `<text x="${pl + w + 6}" y="${by + bh - 2}" class="pv-ax">${esc(fmt(v))}</text>` : ""); });
      });
    }
    const pickMeas = !m.nc && d.measures.length > 1 ? `<label class="pv-ck">グラフにする値<select data-pv-chartat>${d.measures.map((x, k) => `<option value="${k}"${k === j ? " selected" : ""}>${esc(measName(x))}</option>`).join("")}</select></label>` : "";
    const note = (wanted ? '<small class="pv-cnote">時系列は、行の 1 段目が日付（年月日・年月・年）か作業日のときに描けます。いまは棒で出しています</small>' : "")
      + (m.rows.filter((r) => r.type === "data").length > 80 ? '<small class="pv-cnote">先頭 80 件まで描いています</small>' : "");
    return { svg: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="棒グラフ">${g}</svg>`, legend: (series.length > 1 ? legendHtml(series.map((x) => [x.name, x.color, "bar"])) : legendHtml([[series[0].name, series[0].color, "bar"]])) + pickMeas + note };
  }
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  /** ヒストグラム: 行の 1 段目が区間の列のとき。区間の幅を変えられ、横に傾向の数（平均・ばらつき・四分位） */
  function histChart(m, d, W, H) {
    const b = (d.bins || [])[0], x0 = d.dims.rows[0];
    if (!b || !x0 || x0.part !== "bin") {
      return { svg: '<div class="pv-cempty">ヒストグラムは、行の 1 段目を数のカラムの「区間」にすると描けます（上の「すぐに見る」か、数のカラムの［行］を押して、まとめ方を「区間」に）。</div>', side: "" };
    }
    const data = m.rows.filter((r) => r.type === "data" && r.path[0] !== "");
    const sw = 250, w = W - sw, pl = 56, pr = 16, pt = 12, pb = 44, iw = w - pl - pr, ih = H - pt - pb;
    const lo = b.origin, nb = Math.max(1, Math.round((b.max - lo) / b.width) + 1);
    const counts = new Array(nb).fill(0);
    data.forEach((r) => { const k = Math.round((Number(r.path[0]) - lo) / b.width); if (k >= 0 && k < nb) counts[k] = m.value(r, m.cols[m.cols.length - 1], 0) || 0; });
    const max = niceMax(Math.max(1, ...counts)), bw = iw / nb;
    let g = axisY(pl, pt, ih, max, false, w + 40);
    counts.forEach((v, i) => { const h = ih * v / max; g += `<rect x="${pl + bw * i + 0.5}" y="${pt + ih - h}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${COLORS[2]}"><title>${esc(fmt(lo + b.width * i))}〜${esc(fmt(lo + b.width * (i + 1)))}: ${esc(fmt(v))}</title></rect>`; });
    const every = Math.max(1, Math.ceil(nb / Math.max(4, Math.floor(iw / 60))));
    for (let i = 0; i <= nb; i += every) g += `<text x="${pl + bw * i}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(short(lo + b.width * i))}</text>`;
    const st0 = (d.stats || {})[b.column];
    // 平均（縦の線）と ±1σ の帯
    if (st0 && st0.n) {
      const xv = (v) => pl + iw * (v - lo) / (b.width * nb);
      g += `<rect x="${xv(st0.mean - st0.sd)}" y="${pt}" width="${Math.max(0, xv(st0.mean + st0.sd) - xv(st0.mean - st0.sd))}" height="${ih}" fill="#2f7d78" opacity=".08"/>`
        + `<line x1="${xv(st0.mean)}" x2="${xv(st0.mean)}" y1="${pt}" y2="${pt + ih}" stroke="#2f7d78" stroke-width="2" stroke-dasharray="4 3"><title>平均 ${esc(fmt(st0.mean))}</title></line>`;
    }
    g += `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const row = (k, v) => `<tr><th>${k}</th><td>${esc(fmt(v))}</td></tr>`;
    const side = `<div class="pv-stats"><b>${esc(host.label(b.column))} の傾向</b>`
      + (st0 ? `<table>${row("件数", st0.n)}${row("平均", st0.mean)}${row("標準偏差", st0.sd)}${row("最小", st0.min)}${row("25%", st0.q1)}${row("中央値", st0.median)}${row("75%", st0.q3)}${row("最大", st0.max)}</table>` : "<p>数に読める値がありません</p>")
      + `<label class="pv-binw">区間の幅<input type="number" min="0" step="any" value="${b.width}" data-pv-binw aria-label="区間の幅"><small>${b.auto ? "自動で決めた幅" : "決めた幅"}</small></label>`
      + `<button type="button" class="pv-link" data-pv-binauto${b.auto ? " disabled" : ""}>幅を自動に戻す</button>`
      + '<small class="pv-cnote">緑の点線は平均、淡い帯は平均±標準偏差</small></div>';
    return { svg: `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="ヒストグラム">${g}</svg>`, side };
  }

  /* ---- 操作 ----
     枠（#llPivot）は作り直さないので、押す・変える・打つの見張りは mount で 1 回だけ付ける（中身は描くたびに作り直す）。
     版 3.24.0 までは中身を作るたびに付け足していたので、設備を替えて集計を開くたびに見張りが 1 つずつ増え、
     「押すと入る・もう一度で外す」札（行・列・値）が偶数個のときは入れてすぐ外し、押しても何も起きなかった（× は段をいくつも外した） */
  function bind(pane) {
    pane.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      const s = st();
      if (b.dataset.pvAdd) {
        const role = b.dataset.pvAdd, col = b.dataset.col;
        if (role === "vals") addMeasure(col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : { agg: "sum", column: col });
        else addDim(role, col);
        return;
      }
      if (b.dataset.pvX) { const role = b.dataset.pvX; setDims(role, s[role].filter((_, i) => i !== +b.dataset.i)); return; }
      if (b.dataset.pvMx != null) { save({ measures: s.measures.filter((_, i) => i !== +b.dataset.pvMx) }); refresh(); return; }
      if (b.dataset.pvChart) { setChart(b.dataset.pvChart); return; }
      if (b.dataset.pvQuick != null) { const p = quickPicks()[+b.dataset.pvQuick]; if (p) { save({ rows: p.rows, cols: p.cols, measures: p.measures, chart: p.chart }); refresh(true); } return; }
      if (b.hasAttribute("data-pv-clear")) { save({ rows: [], cols: [], measures: [] }); refresh(true); return; }
      if (b.hasAttribute("data-pv-xlsx")) { exportXlsx(); return; }
      if (b.hasAttribute("data-pv-binauto")) { save({ rows: s.rows.map((d, i) => (i === 0 ? { column: d.column, part: "bin" } : d)) }); refresh(true); }
    });
    pane.addEventListener("change", (e) => {
      const t = e.target, s = st();
      if (t.dataset.pvPart) { const role = t.dataset.pvPart; setDims(role, s[role].map((d, i) => (i === +t.dataset.i ? { column: d.column, part: t.value } : d))); return; }
      if (t.dataset.pvAgg != null) { save({ measures: s.measures.map((m, i) => (i === +t.dataset.pvAgg ? { agg: t.value, column: m.column } : m)) }); refresh(); return; }
      if (t.dataset.pvOpt) { save({ [t.dataset.pvOpt]: t.checked }); if (answer) paint(answer); return; }
      if (t.hasAttribute("data-pv-chartat")) { save({ chartAt: +t.value }); if (answer) paintChart(buildModel(answer, st()), answer, st()); return; }
      if (t.hasAttribute("data-pv-binw")) { const w = Math.max(0, +t.value || 0); save({ rows: s.rows.map((d, i) => (i === 0 ? { ...d, width: w, origin: null } : d)) }); refresh(true); }
    });
    TPA.onText(pane, (_, e) => { if (e.target.id === "llPvSearch") $("#llPvFields").innerHTML = fieldsHtml(st()); });
  }
  /** グラフの形。ヒストグラムを選んだのに区間の段が無ければ、数のカラム（値の列か、数の行）を区間にして件数を数える */
  function setChart(k) {
    const s = st();
    if (k === "hist" && !(s.rows[0] && s.rows[0].part === "bin")) {
      const col = (s.rows.find((d) => isNum(d.column)) || {}).column || (s.measures.find((m) => m.column) || {}).column || (preferredNumeric() || {}).column;
      if (!col) { host.toast("ヒストグラムにできる数のカラムがありません"); return; }
      save({ chart: k, rows: [{ column: col, part: "bin" }], cols: [], measures: [{ agg: "count" }] });
      host.toast(`「${host.label(col)}」を区間に分けて、件数のヒストグラムにしました`);
      refresh(true); return;
    }
    save({ chart: k });
    if (answer) paint(answer); else refresh(true);
  }
  /** Excel に出力: 集計表（見出しは段をつないだ字）＋出力の条件 */
  async function exportXlsx() {
    if (!answer || !window.XlsxWriter) return;
    const s = st(), m = buildModel(answer, s), d = answer;
    const head = d.dims.rows.map((x) => dimName(x)).concat(m.cols.flatMap((c) => d.measures.map((x) => {
      const cn = c.type === "grand" ? "総計" : c.type === "sub" ? `${m.colName(c)} 小計` : m.colName(c);
      return [cn, measName(x)].filter(Boolean).join(" / ");
    })));
    const rows = m.rows.map((r) => {
      const keys = Array.from({ length: Math.max(1, m.nr) }, (_, lv) => (r.type === "grand" ? (lv ? "" : "総計") : r.type === "sub" ? (lv < r.path.length ? m.lab(lv, r.path[lv]) : lv === r.path.length ? "小計" : "") : m.nr ? m.lab(lv, r.path[lv]) : "（全体）"));
      return keys.concat(m.cols.flatMap((c) => d.measures.map((_, j) => m.value(r, c, j))));
    });
    const cond = [["項目", "内容"], ["集計", `${d.dims.rows.map(dimName).join(" ＞ ")}ごとに、${d.dims.cols.map(dimName).join(" ＞ ") || "（列なし）"}別の${d.measures.map(measName).join("・")}`],
      ["数えた行", `${d.count.toLocaleString()} 行`], ...host.conditions()];
    const bytes = await window.XlsxWriter.build([{ name: "集計", rows: [head, ...rows], header: true }, { name: "出力の条件", rows: cond, header: true }]);
    const p = (n) => String(n).padStart(2, "0"), t = new Date();
    TPA.download(new Blob([bytes], { type: window.XlsxWriter.MIME }), `${host.fileStem()}_集計_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}.xlsx`);
  }

  /* ---- 一覧から ---- */
  function mount(h) {
    host = h;
    const pane = $("#llPivot"); if (pane) bind(pane);
    $("#llViewSwitch")?.addEventListener("click", (e) => { const b = e.target.closest("[data-pv-view]"); if (b && b.dataset.pvView !== st().view) setView(b.dataset.pvView); });
    paintSwitch();
  }
  /** 範囲（表・設備）が替わった: その範囲の組み方に替え、一覧｜集計を合わせる */
  function sync() { answer = null; fields = null; paintSwitch(); host.onView(isOn()); const pane = $("#llPivot"); if (pane) pane.innerHTML = ""; }
  /** 保存した見方（lotlist.js）: 範囲の組み方を取り出す・入れる */
  const stateOf = () => { const s = st(); return { view: s.view, rows: s.rows, cols: s.cols, measures: s.measures, chart: s.chart, sub: s.sub, grand: s.grand, chartAt: s.chartAt }; };
  function setState(v) { if (!v || typeof v !== "object") return; save({ ...blank(), ...v }); sync(); if (isOn()) refresh(true); }
  window.LotListPivot = { mount, refresh, sync, on: isOn, stateOf, setState, _buildModel: buildModel };
})();
