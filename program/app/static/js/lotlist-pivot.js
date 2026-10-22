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
   - 版 3.26.0〜: 作業日の年月・年／月で区切る（日の段の上に年月の段・月の小計・グラフに月の境目）／月を選ぶ（◀ ▶）／数値ラベル／
     組み方のプリセット（共通・ログイン ID ごと・標準。サーバー: services/pivot_presets.py）。置き場は 7 案＋2 回目で選んだ
     （ui-proposals/2026-10-pvmonth* の M4）: 組み方は文の頭の「☆ 組み方 ▾」、数値ラベル・月で区切る・◀ 月 ▶ はグラフの見出しの右
   - 版 3.27.0〜: グラフの形を 14 に（登録と描き方は lotlist-pivot-charts.js）。置き場は 7 案＋2 回目で選んだ（ui-proposals/2026-10-pvcharts* の M1）:
     グラフの形の行に「グラフ ［絵］時系列 ▾」（目的の行に並べた面）・すぐに見るの札・「組み方 ▾」（文の頭から移した）。
     組み方は 共通デフォルト（開発者・組み込みの物）・共通・ID。すぐに見る＝組み方から ID ごとに選んだ並び（/api/pivot-quick）
   - 覚え（この PC・範囲ごと）: tpa.lotlist.pivot.v1 {範囲: {view, rows, cols, measures, chart, sub, grand, chartAt, split, labels, month, preset}}
   一覧（lotlist.js）とは mount の引数だけでつながる: scope・api・query（絞り込みの問い合わせ字）・label・dateColumns・isWork・lotColumn・
   workParams（作業開始の列・日付の数え方）・conditions（Excel の出力の条件）・fileStem・toast・onView（一覧｜集計を替えた）
   ========================================================================= */
(function () {
  "use strict";
  const { $, $$, esc } = TPA;
  const KEY = "tpa.lotlist.pivot.v1";
  const PART_NAME = { "": "値のまま", date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const DATE_PARTS = ["date", "ym", "year", "month", "weekday", "hour", ""];
  const NUM_PARTS = ["", "bin"];
  const WORKDAY_PARTS = ["", "ym", "year"], WORKDAY_NAME = { "": "日", ym: "年月", year: "年" };   // 作業日のまとめ（版 3.26.0〜: 月ごと・年ごと）
  const AGGS = [["sum", "合計"], ["avg", "平均"], ["min", "最小"], ["max", "最大"]];
  const C = window.LotListPivotCharts, { fmt, dayAt, isDay } = C;   // グラフの形の登録と描き方（lotlist-pivot-charts.js）
  const MAX_DIMS = 3, MAX_MEASURES = 4;
  const DND = window.PivotDnd;      // 札を引いて組み替える（版 3.50.0。pivot-dnd.js）
  let host = null, fields = null, fieldsSig = "", answer = null, seq = 0, fq = "", timer = 0, resizeObs = null;

  /* ---- 覚え ---- */
  const all = () => TPA.local.get(KEY, {});
  // split: 月で区切る（日の段の上に同じ列の年月の段を足し、表に月の小計・グラフに月の境目）・labels: グラフに数値・month: 選んだ月（"" は全部）
  const blank = () => ({ view: "list", rows: [], cols: [], measures: [], chart: "time", sub: true, grand: true, chartAt: 0, split: false, labels: false, month: "", preset: null });
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
  const dimName = (d) => (d.column === "@workday" ? workdayName() + (d.part ? `（${WORKDAY_NAME[d.part]}）` : "") : d.column === "@shift" ? "直" : host.label(d.column) + (d.part ? `（${PART_NAME[d.part]}）` : ""));
  /** 月で区切る・月を選ぶのは、行の 1 段目が日の段（日付の列の年月日・作業日の日）のとき */
  const canMonth = (s) => isDay(s.rows[0]);
  const measName = (m) => C.measLabel(m, host.label);
  function partsOf(col) {
    if (col === "@workday") return WORKDAY_PARTS;
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
  /** 値の計算（版 3.50.0。要望 2: 値ごとの四則演算。サーバーが表し方の前に当てる）。読めない式は入れず、理由を返す */
  function setExpr(i, text) {
    const s = st(), m = s.measures[i]; if (!m) return "";
    const t = String(text || "").trim(), ex = window.NumFormat ? NumFormat.expr(t) : { error: "" };
    if (t && ex.error) return ex.error;
    const next = { ...m }; if (t) next.expr = t; else delete next.expr;
    save({ measures: s.measures.map((x, k) => (k === i ? next : x)) }); refresh();
    return "";
  }
  function setView(v) {
    save({ view: v });
    host.onView(v === "pivot");
    paintSwitch();
    if (v === "pivot") refresh(true);
  }

  /* ---- 組み方のプリセット（共通デフォルト・共通・ID ごと・標準。置き場はサーバーの 1 か所: services/pivot_presets.py・/api/pivot-presets） ----
     元（lot＝品質異常・work＝作業実績）ごとに読む。当てるとき、この設備・この表に無いカラムの段・値は外して知らせる。
     共通デフォルト: 開発者が置いた物と、組み込みの物（id が "b:…"。列は役 $weight などで書き、resolve がこの表の列に当てはめる）。
     標準: 組み方が空のまま集計表を開くと、その範囲で 1 回だけ当てる（自分の ID → 共通 → 共通デフォルトの標準。決めはサーバー）。
     すぐに見る: グラフの形の行に並べる組み方。ID ごとに選び（/api/pivot-quick）、選んでいなければ既定（共通デフォルトの物） */
  // 置き場の言葉と印は shared.js の TPA.scope（ダッシュボードと同じ。版 3.49.0）。★は「最初に当てる」
  const SCOPE_NAME = TPA.scope.NAME;
  const presets = { source: "", items: [], login: "", canEditCommon: false, canEditDefault: false, standardId: null, quick: [], quickCustom: false, quickDefault: [], loaded: false, version: 0 };
  const autoTried = new Set();
  const sourceOf = () => (host.isWork() ? "work" : "lot");
  /** 組み方の中身（サーバーの clean_body と同じ形・同じ並び。いまの形と保存した形を比べる） */
  function bodyOf(s) {
    const dims = (v) => (v || []).map((d) => { const x = { column: d.column, part: d.part || "" }; ["width", "origin"].forEach((k) => { if (typeof d[k] === "number") x[k] = d[k]; }); return x; });
    return { rows: dims(s.rows), cols: dims(s.cols), measures: (s.measures || []).map((m) => (m.agg === "count" || m.agg === "lots" ? { agg: m.agg } : { agg: m.agg, column: m.column || "" })),
      chart: s.chart || "time", sub: !!s.sub, grand: !!s.grand, chartAt: Math.max(0, parseInt(s.chartAt, 10) || 0), split: !!s.split, labels: !!s.labels };
  }
  const sameBody = (a, b) => JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b));
  async function loadPresets(force = false) {
    const src = sourceOf();
    if (!force && presets.loaded && presets.source === src) return presets;
    const r = await fetch(`/api/pivot-presets?source=${src}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "組み方を読めませんでした");
    Object.assign(presets, { source: src, items: d.items || [], login: d.login || "", canEditCommon: !!d.canEditCommon, canEditDefault: !!d.canEditDefault,
      standardId: d.standardId ?? null, quick: (d.quick || []).map(String), quickCustom: !!d.quickCustom, quickDefault: (d.quickDefault || []).map(String), loaded: true, version: presets.version + 1 });
    return presets;
  }
  /** いまの組み方に当たるプリセット（同じ中身）か、最後に当てたプリセット（変えたあと） */
  function presetNow() {
    const s = st(), same = items().find((p) => !p.missing.length && p.body && p.body.rows && sameBody(p.body, s));
    if (same) return { item: same, changed: false };
    const last = items().find((p) => p.id === s.preset);
    return last ? { item: last, changed: true } : { item: null, changed: false };
  }
  /** 当てる（p は役を当てはめた物: items()）。この表に無いカラムの段・値は外す（外した物を知らせる）。行の段が 1 つも残らなければ当てない */
  function applyPreset(p, { quiet = false } = {}) {
    const b = p.body || {}, ok = (c) => !!c && (c.startsWith("@") ? host.isWork() || c === "@lots" || c === "@count" : !!fieldOf(c));
    const lost = [...p.missing];
    const keep = (list) => (list || []).filter((d) => (ok(d.column) ? true : (d.column && lost.push(host.label(d.column)), false)));
    const rows = keep(b.rows), cols = keep(b.cols);
    const measures = (b.measures || []).filter((m) => (m.agg === "count" || m.agg === "lots" || ok(m.column) ? true : (m.column && lost.push(host.label(m.column)), false)));
    if (!rows.length) { host.toast(`組み方「${p.name}」の行の段（${lost.join("・") || "—"}）がこの表に無いので、当てられません`); return false; }
    save({ ...bodyOf({ ...blank(), ...b }), rows, cols, measures, month: "", preset: p.id });
    if (lost.length) host.toast(`組み方「${p.name}」を当てました。この表に無い ${lost.join("・")} は外しました`);
    else if (!quiet) host.toast(`組み方「${p.name}」を当てました`);
    refresh(true);
    return true;
  }
  /** 標準を当てる（組み方が空のまま集計表を開いたとき。範囲ごとに 1 回だけ。「すべて外す」のあとは当てない） */
  async function applyStandard() {
    const key = host.scope();
    if (autoTried.has(key) || st().rows.length) return false;
    autoTried.add(key);
    try { await loadPresets(); } catch { return false; }
    const p = itemOf(presets.standardId);
    if (!p || st().rows.length) return false;
    const ok = applyPreset(p, { quiet: true });
    if (ok) host.toast(`最初に当てる組み方「${p.name}」〔${SCOPE_NAME[p.scope]}〕を当てました`);
    return ok;
  }
  /** 書く（POST・PUT・DELETE）。誤りは知らせて、一覧を読み直す */
  async function writePreset(method, id, body) {
    const url = "/api/pivot-presets" + (id ? `/${id}` : "");
    const r = await fetch(url, method === "DELETE" ? { method } : TPA.json(method, body));
    const d = await r.json().catch(() => ({}));
    await loadPresets(true).catch(() => {});
    if (!r.ok) { host.toast(d.error || "組み方を保存できませんでした"); return null; }
    return d;
  }
  /** すぐに見るの並びを置く（ID ごと。keys が null なら既定に戻す）。置けたら描き直す */
  async function setQuick(keys) {
    const r = await fetch("/api/pivot-quick", TPA.json("PUT", keys ? { source: sourceOf(), keys } : { source: sourceOf(), reset: true }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { host.toast(d.error || "すぐに見るを覚えられませんでした"); return false; }
    await loadPresets(true).catch(() => {});
    paintHead();
    return true;
  }

  /* ---- 読む ---- */
  function query() {
    const s = st(), p = new URLSearchParams(host.query());
    // 月で区切る: 日の段の上に同じ列の年月の段を足して頼む（月の小計は、今の小計の数え方のまま正しく出る。ロット数・平均も月ごとに数える）
    const rows = s.split && canMonth(s) ? [{ column: s.rows[0].column, part: "ym" }].concat(s.rows) : s.rows;
    p.set("rows", JSON.stringify(rows)); p.set("cols", JSON.stringify(s.cols));
    if (s.month && canMonth(s)) p.set("month", s.month);
    p.set("measures", JSON.stringify(s.measures.length ? s.measures : [{ agg: "count" }]));
    if (BOXY.has(s.chart) && boxColumn(s)) p.set("box", boxColumn(s));   // 箱ひげ図・バイオリン・X̄-R: 値の数のカラムの分かれ方（四分位・密度）も頼む
    Object.entries(host.workParams()).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }
  const BOXY = new Set(["box", "violin", "xbar"]);     // 行ごとの分かれ方（boxes）を頼む形
  /** 箱ひげ図に描く数のカラム（値のうち最初の数のカラム） */
  const boxColumn = (s) => (s.measures.find((m) => m.column && isNum(m.column)) || {}).column || "";
  /** 一覧が読み直された（絞り込み・範囲が変わった）ときに呼ばれる。集計表を見ていなければ何もしない */
  function refresh(now) {
    if (!isOn()) return;
    clearTimeout(timer);
    timer = setTimeout(load, now ? 0 : 120);
  }
  async function load() {
    const me = ++seq, pane = $("#llPivot");
    if (!pane || !isOn()) return;
    // カラムの手がかりと組み方（すぐに見るの並び）を一緒に読む。組み方を読めなくても集計は続ける
    const pre = loadPresets().catch(() => null);
    try { await loadFields(); } catch (e) { if (me === seq) { fields = fields || []; paint(null, e.message); } return; }
    await pre;
    if (!st().rows.length && await applyStandard()) return;   // 標準を当てた（当てた組み方で読み直す）
    if (me !== seq) return;
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
      window.PivotCalc.remember(d, d.measures);     // 計算の変わり方（計算の前の総計）を覚える
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
  function fieldsHtml(s) {
    const used = (c) => (s.rows.some((d) => d.column === c) ? "rows" : s.cols.some((d) => d.column === c) ? "cols" : "");
    const meas = (agg, col = "") => s.measures.some((m) => m.agg === agg && m.column === col);
    const anyVal = (c) => s.measures.some((m) => m.column === c);
    const ql = ($("#llPvSearch")?.value || "").trim().toLowerCase();
    const hit = (name) => !ql || name.toLowerCase().includes(ql);
    const btn = (role, col, on, extra = "") => `<button type="button" class="pv-r r-${role}${on ? " on" : ""}" data-pv-add="${role}" data-col="${esc(col)}" aria-pressed="${on}" ${extra}>${{ rows: "行", cols: "列", vals: "値" }[role]}</button>`;
    let html = "";
    // 作業実績の特別なカラム（作業日・直・ロット数）と、件数
    const fa = DND.fieldAttrs;
    const special = (host.isWork() ? WORK().map(([c, n, tip]) => `<div class="pv-f is-special${used(c) ? " is-used" : ""}" title="${esc(tip)}"${fa(c, ["rows", "cols"])}><span><b>${n}</b><small>${c === "@workday" ? "作業開始の日" : "勤務体系の直"}</small></span>${btn("rows", c, used(c) === "rows")}${btn("cols", c, used(c) === "cols")}<i></i></div>`).join("") : "")
      + `<div class="pv-f is-special${meas("lots") ? " is-used" : ""}" title="${host.isWork() ? "作業開始が同じ行（分割したロット）を 1 と数えます" : "ロット番号が同じ行を 1 と数えます"}"${fa("@lots", ["vals"])}><span><b>ロット数</b><small>${host.isWork() ? "重複の無い作業開始" : "重複の無いロット番号"}</small></span><i></i><i></i>${btn("vals", "@lots", meas("lots"))}</div>`
      + `<div class="pv-f is-special${meas("count") ? " is-used" : ""}" title="当たる行の数"${fa("@count", ["vals"])}><span><b>件数</b><small>行の数</small></span><i></i><i></i>${btn("vals", "@count", meas("count"))}</div>`;
    if (hit("作業日 直 ロット数 件数")) html += special;
    html += (fields || []).filter((f) => hit(f.column) || hit(host.label(f.column))).map((f) => {
      const c = f.column, u = used(c), date = isDate(c);
      const sub = date ? "日付" : f.numeric ? `数${f.many ? "" : ` · ${f.kinds} 種類`}` : f.many ? "1,000 種類以上" : `${f.kinds} 種類`;
      return `<div class="pv-f${u || anyVal(c) ? " is-used" : ""}${date ? " is-date" : ""}${f.numeric ? " is-num" : ""}" data-col="${esc(c)}"${fa(c, f.numeric ? ["rows", "cols", "vals"] : ["rows", "cols"])}><span title="${esc(c)}"><b>${esc(host.label(c))}</b><small>${sub}</small></span>`
        + btn("rows", c, u === "rows") + btn("cols", c, u === "cols") + (f.numeric ? btn("vals", c, anyVal(c), 'title="合計を値に足します（値の札で平均・最小・最大に替えられます）"') : "<i></i>") + "</div>";
    }).join("");
    return html || '<p class="pv-none">当たるカラムがありません</p>';
  }
  function dimChip(d, role, i) {
    const parts = partsOf(d.column);
    const pn = d.column === "@workday" ? WORKDAY_NAME : PART_NAME;
    const sel = parts.length > 1 ? `<select data-pv-part="${role}" data-i="${i}" aria-label="まとめ方">${parts.map((p) => `<option value="${p}"${(d.part || "") === p ? " selected" : ""}>${pn[p]}</option>`).join("")}</select>` : "";
    const name = d.column === "@workday" ? workdayName() : d.column === "@shift" ? "直" : host.label(d.column);
    return `<span class="pv-chip ${role === "rows" ? "r" : "c"}" title="${esc(dimName(d))}"${DND.chipAttrs(role, i)}><b>${esc(name)}</b>${sel}<button type="button" data-pv-x="${role}" data-i="${i}" aria-label="「${esc(name)}」を外す">×</button></span>`;
  }
  function measChip(m, i) {
    const sel = m.agg === "count" || m.agg === "lots" ? "" : `<select data-pv-agg="${i}" aria-label="集計のしかた">${AGGS.map(([k, n]) => `<option value="${k}"${m.agg === k ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    const name = m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : host.label(m.column);
    return `<span class="pv-chip v" title="${esc(measName(m))}"${DND.chipAttrs("vals", i)}><b>${esc(name)}</b>${sel}<button type="button" data-pv-mx="${i}" aria-label="「${esc(measName(m))}」を外す">×</button></span>`;
  }
  /** 行と列を入れ替える札（版 3.50.0。列に段があるときだけ押せる: 列が空のまま入れ替えると行が空になり、何も出ない） */
  const swapBtn = (rows, cols, attr) => `<button type="button" class="pv-swap" aria-label="行と列を入れ替える" ${attr}${cols.length ? "" : " disabled"} title="${cols.length ? "行の段と列の段を入れ替えます" : "列に段を入れると、行と入れ替えられます"}"><i aria-hidden="true">⇄</i><span class="pv-swl">入れ替え</span></button>`;
  /** 値の計算の段（版 3.50.0。pivot-calc.js。文のすぐ下） */
  const calcHtml = (s) => window.PivotCalc.html(s.measures, { name: (m) => C.measLabel({ ...m, expr: undefined }, host.label), answer, num: fmt });
  function sentenceHtml(s) {
    const slot = (role, html, ph) => `<span class="pv-slot" data-role="${role}">${html || `<span class="pv-ph">${ph}</span>`}</span>`;
    return `<div class="pv-sent">${slot("rows", s.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］を押す")}<span class="pv-w">ごとに、</span>${swapBtn(s.rows, s.cols, "data-pv-swap")}`
      + `${slot("cols", s.cols.map((d, i) => dimChip(d, "cols", i)).join(""), "＋ 列")}<span class="pv-w">別の</span>`
      + `${slot("vals", s.measures.map(measChip).join(""), "件数")}<span class="pv-w">を出す</span><span class="pv-sp"></span>`
      + `<label class="pv-ck"><input type="checkbox" data-pv-opt="sub"${s.sub ? " checked" : ""}>小計</label><label class="pv-ck"><input type="checkbox" data-pv-opt="grand"${s.grand ? " checked" : ""}>総計</label>`
      + `<button type="button" class="pv-btn" data-pv-xlsx${answer && s.rows.length ? "" : " disabled"} title="この集計表を Excel（.xlsx）に出します（出力の条件のシートつき）">Excel に出力</button>`
      + `<button type="button" class="pv-link" data-pv-clear${s.rows.length || s.cols.length || s.measures.length ? "" : " disabled"}>すべて外す</button></div>`;
  }
  /* ---- 列の役（組み込みの組み方の $weight など。services/pivot_presets.py の BUILTINS）。表が替わると当てはまる列も替わる ----
     $weight … 量の数の列（重量 → 数量・長さ・枚数 → 最初の数の列）  $num2 … 2 つ目の数の列（厚さ・幅・長さ・速度を先に）
     $date … 日付の列  $few1・$few2 … 種類の少ない（2〜12 種類）字の列（少ない順）  $lot … ロット番号の列 */
  const ROLE_NAME = { $date: "日付の列", $weight: "量の数の列（重量など）", $num2: "2 つ目の数の列", $few1: "種類の少ない列", $few2: "2 つ目の種類の少ない列", $lot: "ロット番号の列" };
  let rolesMemo = null, rolesSig = "";
  function roles() {
    if (rolesMemo && rolesSig === fieldsSig) return rolesMemo;
    const F = fields || [], nums = F.filter((f) => f.numeric && !isDate(f.column));
    const weight = nums.find((f) => /重量|重さ|質量/.test(f.column)) || nums.find((f) => /数量|長さ|枚数/.test(f.column)) || nums[0];
    const rest = nums.filter((f) => f !== weight), num2 = rest.find((f) => /厚|幅|長さ|速度/.test(f.column)) || rest[0];
    const few = F.filter((f) => !f.numeric && !isDate(f.column) && f.kinds >= 2 && f.kinds <= 12).sort((a, b) => a.kinds - b.kinds);
    const lot = host.lotColumn() || (F.find((f) => /ロット/.test(f.column) && f.kinds > 12) || {}).column;
    rolesSig = fieldsSig;
    rolesMemo = { $date: (F.find((f) => isDate(f.column)) || {}).column, $weight: weight && weight.column, $num2: num2 && num2.column,
      $few1: few[0] && few[0].column, $few2: few[1] && few[1].column, $lot: lot };
    return rolesMemo;
  }
  const preferredNumeric = () => { const c = roles().$weight; return c ? fieldOf(c) : null; };
  /** 組み方の役を、この表の列に当てはめる → {body, name, missing（当てはまらなかった役の説明）} */
  function resolve(p) {
    const R = roles(), missing = [];
    const col = (c) => { if (!c || !c.startsWith("$")) return c; if (!R[c] && !missing.includes(ROLE_NAME[c] || c)) missing.push(ROLE_NAME[c] || c); return R[c] || null; };
    const b = p.body || {};
    const dims = (list) => (list || []).map((d) => ({ ...d, column: col(d.column) }));
    const body = { ...b, rows: dims(b.rows), cols: dims(b.cols), measures: (b.measures || []).map((m) => (m.column ? { ...m, column: col(m.column) } : m)) };
    const name = String(p.name || "").replace(/\$(date|weight|num2|few1|few2|lot)/g, (k) => (R[k] ? host.label(R[k]) : ROLE_NAME[k] || k));
    return { ...p, body, name, missing };
  }
  /** 組み方の一覧（役を当てはめた物。fields・組み方が変わったら作り直す） */
  let itemsMemo = null, itemsSig = "";
  function items() {
    const sig = fieldsSig + "|" + presets.version;
    if (!itemsMemo || itemsSig !== sig) { itemsSig = sig; itemsMemo = presets.items.map(resolve); }
    return itemsMemo;
  }
  const itemOf = (id) => items().find((p) => String(p.id) === String(id)) || null;
  /** すぐに見るに並べる組み方（ID ごとの選び。選んでいなければ既定: services/pivot_presets.py の default_quick） */
  const quickItems = () => presets.quick.map(itemOf).filter(Boolean);
  /** すぐに見るの札（当てはまらない役がある物は押せない。いまの組み方に当たる物は印） */
  function quickBtn(p) {
    const now = presetNow(), hit = now.item && now.item.id === p.id, on = hit && !now.changed, moved = hit && now.changed;
    const tip = p.missing.length ? `この表には ${p.missing.join("・")} が無いので使えません` : `${p.name}〔${SCOPE_NAME[p.scope]}${p.builtin ? "・組み込み" : ""}〕を当てます`;
    const std = String(p.id) === String(presets.standardId);
    const note = (std ? "\n★＝最初に当てる（組み方が空のまま集計表を開くと当てる）" : "") + (moved ? "\nいまは、当てたあとに変えています（押すと当て直します）" : "");
    return `<button type="button" class="pv-quick${on ? " is-on" : moved ? " is-moved" : ""}" data-pv-quick="${esc(String(p.id))}" title="${esc(tip + note)}"${p.missing.length ? " disabled" : ""}>`
      + `${C.iconSvg((p.body || {}).chart, 15)}<span>${esc(p.name)}</span>${std ? '<i class="pv-star is-std" aria-label="最初に当てる">★</i>' : ""}</button>`;
  }
  /* ---- グラフの形の行（7 案＋2 回目で選んだ: ui-proposals/2026-10-pvcharts* の M1）:
     「グラフ ［絵］時系列 ▾」（押すと目的ごとの行に 14 形を並べた面）・すぐに見るの札（★＝標準）・「組み方 ▾」（すぐに見るに出す ☑・当てる・保存の面）。
     すぐに見る＝組み方の一覧から ID ごとに選んだ物なので、入口は「組み方 ▾」1 つ（版 3.26.0 の文の頭の「☆ 組み方 ▾」はここへ移した） */
  function barHtml(s) {
    const picks = quickItems(), def = C.get(s.chart) || C.DEFS[0], { item, changed } = presetNow();
    // いまの組み方の名前は、すぐに見るの札に無いときだけボタンに出す（札にあれば札の印＝当てた・点線＝変えた）
    const pname = item && !picks.some((p) => p.id === item.id) ? `: ${item.name}${changed ? "（変えた）" : ""}` : "";
    const ptip = item ? `いまの組み方「${item.name}」〔${SCOPE_NAME[item.scope]}${item.standard ? "・★最初に当てる" : ""}〕${changed ? "を当てたあとに変えています" : ""}\n` : "";
    return `<div class="pv-bar"><span class="pv-k">グラフ</span><button type="button" id="llPvChartBtn" class="pv-cpick" data-pv-pick aria-haspopup="true" aria-expanded="${!!popOf("chart")}" title="${esc(def.tip)}\n押すと、ほかのグラフの形を目的ごとに選べます">`
      + `${C.iconSvg(def.k, 18)}<b>${esc(def.n)}</b><i aria-hidden="true">▾</i></button>`
      + `<span class="pv-k pv-qk">すぐに見る:</span>${picks.length ? picks.map(quickBtn).join("") : '<span class="pv-qnone">（なし。「組み方 ▾」で ☑ を付けると並びます）</span>'}`
      + `<button type="button" id="llPvPreset" class="pv-pbtn${item && !changed ? " is-on" : ""}" data-pv-qpick aria-haspopup="true" aria-expanded="${!!popOf("preset")}" title="${esc(ptip)}組み方（行・列・値・グラフの形・小計・総計・月で区切る・数値ラベル）を当てる・保存する・すぐに見るに出す物を選ぶ">`
      + `組み方<span class="pv-pname">${esc(pname)}</span>${pname && item.standard ? '<i class="pv-star is-std" aria-label="最初に当てる">★</i>' : ""}<i aria-hidden="true">▾</i></button></div>`;
  }
  /** 文とグラフの形の行だけを描き直す（組み方・すぐに見るを替えたとき） */
  function paintHead() { const h = $("#llPvHead"); if (h && host) window.PivotCalc.keepFocus(h, () => { h.innerHTML = sentenceHtml(st()) + calcHtml(st()) + barHtml(st()); }); }
  /** 全体を描く（busy は読み直している間: 前の答えのまま薄くする） */
  function paint(d, err = "", busy = false) {
    const pane = $("#llPivot"); if (!pane || !host) return;
    const s = st();
    if (!pane.firstChild) {
      pane.innerHTML = `<aside class="pv-fields" data-dnd-trash><div class="pv-cap"><b>カラム</b><small>札を押すか、上の文へ引くと入ります（文の札は引いて並べ替え・行と列の入れ替え。ここへ戻すと外れます）</small></div>`
        + '<input id="llPvSearch" type="search" placeholder="カラムを検索" autocomplete="off" aria-label="カラムを検索"><div class="pv-list" id="llPvFields"></div></aside>'
        + '<div class="pv-main"><div id="llPvHead"></div><div class="pv-msg" id="llPvMsg" hidden></div><div class="pv-out" id="llPvOut"></div></div>';
    }
    $("#llPvFields").innerHTML = fieldsHtml(s);
    paintHead();
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
    const tbar = s.chart === "none" ? optsHtml(s, d, false) : "";
    out.innerHTML = (s.chart === "none" ? (tbar ? `<div class="pv-chead pv-tbar">${tbar}</div>` : "") : `<div class="pv-chart" id="llPvChart"></div>`)
      + `<div class="pv-tablebox"><table class="pv-table">${tableHtml(model, d)}</table></div>`
      + `<div class="pv-hint">${esc(hintText(model, d))}</div>`;
    if (s.chart !== "none") paintChart(model, d, s);
  }
  function emptyHtml() {
    const picks = quickItems();
    return `<div class="pv-empty"><b>左のカラムの［行］を押すと、値ごとの件数が出ます</b><span>種類の少ないカラムが行・列に向いています。日付のカラムは年月日・年月などで、数のカラムは区間（ヒストグラム）でまとめられます。`
      + `${host.isWork() ? "作業実績では「作業日」「直」「ロット数」も使えます。" : ""}${picks.length ? "すぐに見るなら:" : ""}</span>`
      + (picks.length ? `<div class="pv-quickbig">${picks.map(quickBtn).join("")}</div>` : "") + "</div>";
  }

  /* ---- グラフの見出しの右（表だけのときは表の上）: 数値ラベル・月で区切る・◀ 月 ▶。月の物は行の 1 段目が日の段のときだけ ---- */
  const monthName = (k) => `${+k.slice(0, 4)}年${+k.slice(5, 7)}月`;
  /** ◀ ▶ で送る順: 月を古い順に並べ、最後に「すべての月」（◀ で新しい月から遡る・▶ で戻る） */
  const monthSeq = () => ((answer && answer.months) || []).concat([""]);
  function setMonth(k) { save({ month: k }); refresh(true); }
  function optsHtml(s, d, chart) {
    const lab = chart ? `<label class="pv-ck"><input type="checkbox" data-pv-opt="labels"${s.labels ? " checked" : ""}>数値ラベル</label>` : "";
    if (!canMonth(s) || !d) return lab ? `<span class="pv-copts">${lab}</span>` : "";
    const months = d.months || [], seq = months.concat([""]), i = seq.indexOf(s.month);
    const list = s.month && !months.includes(s.month) ? months.concat([s.month]) : months;
    const nav = `<span class="pv-mnav" title="月を 1 つ選ぶ（◀ ▶ で前後の月へ。◀ は新しい月から遡る）"><button type="button" data-pv-mstep="-1" aria-label="前の月"${i <= 0 ? " disabled" : ""}>◀</button>`
      + `<select data-pv-month aria-label="月を選ぶ"><option value="">すべての月</option>${list.map((k) => `<option value="${k}"${k === s.month ? " selected" : ""}>${monthName(k)}</option>`).join("")}</select>`
      + `<button type="button" data-pv-mstep="1" aria-label="次の月"${i < 0 || i >= seq.length - 1 ? " disabled" : ""}>▶</button></span>`;
    return `<span class="pv-copts">${lab}<label class="pv-ck" title="日の段の上に年月の段を足します（表に月の小計・グラフに月の境目の線と月の名前）"><input type="checkbox" data-pv-opt="split"${s.split ? " checked" : ""}>月で区切る</label>${months.length ? nav : ""}</span>`;
  }
  /* ---- 浮かぶ面（グラフの形・組み方）。開くのはいつも 1 つ。ボタンの下に開き、外を押すか Esc で閉じる ---- */
  let pop = null;   // {kind, el, off}
  const popOf = (kind) => (pop && pop.kind === kind ? pop.el : null);
  function closePop() {
    if (!pop) return;
    const { el, off, anchorId } = pop; pop = null;
    off && off(); el.remove(); $("#" + anchorId)?.setAttribute("aria-expanded", "false");
  }
  function openPop(kind, anchor, label, onClick) {
    if (popOf(kind)) { closePop(); return null; }
    closePop();
    const el = document.createElement("div");
    el.className = `pv-ppop is-${kind}`; el.id = kind === "chart" ? "llPvChartPop" : "llPvPresetPop";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", label);
    document.body.append(el);
    // 開いたボタンは描き直しで作り直されるので、要素ではなく印（data-pv-pick・data-pv-qpick）で「外ではない」を見分ける
    // （外を押したとして閉じ、同じ押しでまた開く、を起こさない）
    const mark = anchor.hasAttribute("data-pv-pick") ? "[data-pv-pick]" : "[data-pv-qpick]";
    pop = { kind, el, anchorId: anchor.id, off: TPA.dismissable(el, closePop, { keep: { contains: (t) => !!(t && t.closest && t.closest(mark)) } }) };
    el.addEventListener("click", onClick);
    el.addEventListener("change", onClick);
    anchor.setAttribute("aria-expanded", "true");
    return el;
  }
  const placePop = (el, anchorId) => { const a = $("#" + anchorId); if (el && a) TPA.placeBelow(el, a); };

  /* ---- グラフの形の面: 目的の行（推移を見る・比べる・内訳・ばらつき・関係・表）に形の札。いまの組み方に向く形に「向く」 ----
     向くかどうかは形の登録（lotlist-pivot-charts.js の fit）が決める。向かない形も押せる（足りない段・値は setChart が入れて知らせる） */
  function fitInfo(s) {
    const r0 = s.rows[0], ms = s.measures.length ? s.measures : [{ agg: "count" }];
    return { rows: s.rows.length, cols: s.cols.length, meas: ms.length, numMeas: ms.filter((m) => m.column && isNum(m.column)).length,
      addMeas: ms.filter((m) => C.ADDITIVE.has(m.agg)).length, additive: C.ADDITIVE.has(ms[0].agg), time: !!r0 && C.isTimeDim(r0), bin: !!r0 && r0.part === "bin" };
  }
  function paintChartPop() {
    const el = popOf("chart"); if (!el) return;
    const s = st(), f = fitInfo(s);
    el.innerHTML = '<div class="pv-phead"><b>グラフの形</b><small>目的から選びます。<span class="pv-fit">向く</span>＝いまの組み方（行・列・値）に向く形。向かない形を選ぶと、足りない段・値を入れて知らせます</small></div>'
      + C.GROUPS.map(([g, gn]) => `<div class="pv-cgrp"><span class="pv-cgn">${gn}</span><span class="pv-cgi">${C.DEFS.filter((x) => x.g === g).map((x) => {
        const why = x.fit(f), on = s.chart === x.k;
        return `<button type="button" class="pv-cbtn${on ? " on" : ""}" data-pv-chart="${x.k}" aria-pressed="${on}" title="${esc(x.tip + (why ? `\n向く組み方: ${why}` : ""))}">${C.iconSvg(x.k, 17)}<span>${x.n}</span>${!why && !on && x.k !== "none" ? '<i class="pv-fit">向く</i>' : ""}</button>`;
      }).join("")}</span></div>`).join("");
  }
  function toggleChartPop(anchor) {
    const el = openPop("chart", anchor, "グラフの形", (e) => {
      const b = e.type === "click" && e.target.closest("[data-pv-chart]"); if (!b) return;
      closePop(); setChart(b.dataset.pvChart);
    });
    if (!el) return;
    paintChartPop(); placePop(el, anchor.id);
    el.querySelector(".pv-cbtn.on, .pv-cbtn")?.focus();
  }

  /* ---- 組み方の面: すぐに見るに出す物（☑・この順・▲▼）／組み方の一覧（自分だけ・全員（共有）・全員の既定。押すと当てる・★最初に当てる・上書き・名前・削除）／いまの形を保存 ---- */
  const tags = (b) => [b.rows && b.rows.length ? b.rows.map((d) => (d.column ? dimName(d) : "—")).join(" ＞ ") : "", (C.get(b.chart) || {}).n, b.split ? "月で区切る" : "", b.labels ? "数値ラベル" : ""].filter(Boolean).join(" · ");
  async function togglePresetPop(anchor) {
    const el = openPop("preset", anchor, "組み方", onPresetClick);
    if (!el) return;
    el.innerHTML = '<p class="pv-pnote">読んでいます…</p>';
    placePop(el, anchor.id);
    try { await loadPresets(true); } catch (e) { if (popOf("preset")) el.innerHTML = `<p class="pv-pnote">${esc(e.message)}</p>`; return; }
    paintPresetPop();
  }
  function paintPresetPop() {
    const el = popOf("preset"); if (!el) return;
    const s = st(), now = presetNow(), all = items(), quick = presets.quick;
    const pinned = (p) => quick.includes(String(p.id));
    const row = (p) => `<div class="pv-pi${p.id === (now.item || {}).id ? " is-now" : ""}${p.missing.length ? " is-miss" : ""}">`
      + `<label class="pv-pq" title="すぐに見るに出す（自分の ID ごと）"><input type="checkbox" data-pv-pin="${esc(String(p.id))}"${pinned(p) ? " checked" : ""}${presets.login ? "" : " disabled"} aria-label="「${esc(p.name)}」をすぐに見るに出す"></label>`
      + `<button type="button" class="pv-papply" data-pv-papply="${esc(String(p.id))}"${p.missing.length ? ` disabled title="この表には ${esc(p.missing.join("・"))} が無いので使えません"` : ' title="この組み方を当てます"'}>${C.iconSvg((p.body || {}).chart, 15)}<b>${esc(p.name)}${p.standard ? ` <i class="pv-star is-std${String(p.id) === String(presets.standardId) ? "" : " is-off"}" aria-label="最初に当てる" title="${String(p.id) === String(presets.standardId) ? "最初に当てる組み方" : `★を付けていますが、先の置き場の★が先に効いています（${TPA.scope.RULE}）`}">${String(p.id) === String(presets.standardId) ? "★" : "☆"}</i>` : ""}</b><small>${esc(tags(p.body || {}))}</small></button>`
      + (p.canEdit ? `<span class="pv-pact"><button type="button" data-pv-pstd="${p.id}" aria-pressed="${p.standard}" title="${p.standard ? "★を外す" : `〔${SCOPE_NAME[p.scope]}〕で最初に当てる組み方にする（組み方が空のまま集計表を開くと当てる）`}">${p.standard ? "★最初に当てる" : "☆最初に当てる"}</button>`
        + `<button type="button" data-pv-pover="${p.id}" title="いまの組み方で上書きします"${s.rows.length ? "" : " disabled"}>上書き</button><button type="button" data-pv-pren="${p.id}">名前</button><button type="button" data-pv-pdel="${p.id}">削除</button></span>` : "")
      + "</div>";
    const sec = (k, list, empty) => `<p class="pv-psec">${TPA.scope.head(k, k === "me" && presets.login ? `（${esc(presets.login)}）` : "")}</p>` + (list.length ? list.map(row).join("") : `<p class="pv-pnote">${empty}</p>`);
    const order = quick.map(itemOf).filter(Boolean);
    const std = itemOf(presets.standardId);
    el.innerHTML = `<div class="pv-phead"><b>組み方</b><small>名前を押すと当てます（この表に無いカラムは外します）。☑＝グラフの形の行の「すぐに見る」に出す（${presets.login ? `${esc(presets.login)} の分。ほかの PC でも同じ` : "ログイン ID が分からないので選べません"}）。`
      + `★＝最初に当てる: 組み方が空のまま集計表を開くと当てます${std ? `（いまは「${esc(std.name)}」）` : ""}。${TPA.scope.RULE}</small></div>`
      + `<div class="pv-qorder"><p class="pv-psec">すぐに見るの並び${presets.quickCustom ? "" : "（全員の既定のまま）"}</p>`
      + (order.length ? order.map((p, i) => `<span class="pv-qo">${C.iconSvg((p.body || {}).chart, 14)}<span>${esc(p.name)}</span><button type="button" data-pv-qmove="${i}" data-d="-1" aria-label="「${esc(p.name)}」を前へ"${i ? "" : " disabled"}>◀</button><button type="button" data-pv-qmove="${i}" data-d="1" aria-label="「${esc(p.name)}」を後ろへ"${i < order.length - 1 ? "" : " disabled"}>▶</button></span>`).join("") : '<span class="pv-pnote">何も出していません。下の ☑ で選びます</span>')
      + (presets.quickCustom ? '<button type="button" class="pv-link" data-pv-qreset title="自分の選びを消し、開発者が決めた全員の既定の並びに戻します">全員の既定に戻す</button>' : "") + "</div>"
      + sec("me", all.filter((p) => p.scope === "me"), presets.login ? "まだありません。下でいまの形を保存できます" : "ログイン ID が分からないので置けません")
      + sec("all", all.filter((p) => p.scope === "all"), "まだありません")
      + sec("default", all.filter((p) => p.scope === "default"), "ありません")
      + `<div class="pv-psave"><p class="pv-psec">いまの組み方を保存</p>`
      + `<input id="llPvPName" type="text" maxlength="40" placeholder="名前（例: 月ごとの重量。同じ名前に入れ直すなら、上の「上書き」）" aria-label="組み方の名前">`
      + `<span class="pv-pto">${TPA.scope.ORDER.filter((k) => k !== "default" || presets.canEditDefault).map((k) => {
        const ok = k === "me" || (k === "all" ? presets.canEditCommon : presets.canEditDefault);
        const tip = ok ? `${TPA.scope.who(k)}${k === "default" ? "。すぐに見るを選んでいない人に並びます" : ""}` : "全員（共有）に置けるのは、マスタを書ける権限（部分的編集可から）の人だけです";
        return `<label title="${tip}"><input type="radio" name="llPvPScope" value="${k}"${k === "me" ? " checked" : ""}${ok ? "" : " disabled"}>${TPA.scope.icon(k)}${SCOPE_NAME[k]}</label>`;
      }).join("")}<i class="pv-pbr" aria-hidden="true"></i>`
      + `<label><input type="checkbox" id="llPvPQuick"${presets.login ? " checked" : " disabled"}>すぐに見るに出す</label><label><input type="checkbox" id="llPvPStd">★ 最初に当てる</label></span>`
      + `<button type="button" class="pv-btn" data-pv-psave${s.rows.length ? "" : ' disabled title="行の段が 1 つも無い組み方は保存できません"'}>保存</button></div>`;
  }
  async function onPresetClick(e) {
    const t = e.target;
    if (e.type === "change") {   // ☑ すぐに見るに出す（外す）。並びの最後に足す
      if (!t.dataset.pvPin) return;
      const id = t.dataset.pvPin, keys = presets.quick.filter((k) => k !== id).concat(t.checked ? [id] : []);
      if (await setQuick(keys)) paintPresetPop();
      return;
    }
    const b = t.closest("button"); if (!b || b.disabled) return;
    const find = (id) => itemOf(id);
    if (b.dataset.pvPapply) { const p = find(b.dataset.pvPapply); if (p) { closePop(); await loadFields().catch(() => {}); applyPreset(p); } return; }
    if (b.dataset.pvQmove != null) {
      const i = +b.dataset.pvQmove, j = i + +b.dataset.d, keys = presets.quick.map(itemOf).filter(Boolean).map((p) => String(p.id));
      if (j < 0 || j >= keys.length) return;
      [keys[i], keys[j]] = [keys[j], keys[i]];
      if (await setQuick(keys)) paintPresetPop();
      return;
    }
    if (b.hasAttribute("data-pv-qreset")) { if (await setQuick(null)) { host.toast("すぐに見るを全員の既定の並びに戻しました"); paintPresetPop(); } return; }
    if (b.dataset.pvPstd) { const p = find(b.dataset.pvPstd); if (p && await writePreset("PUT", p.id, { standard: !p.standard, base_rev: p.rev })) host.toast(p.standard ? `「${p.name}」の★を外しました` : `「${p.name}」を〔${SCOPE_NAME[p.scope]}〕で最初に当てる組み方にしました`); paintPresetPop(); paintHead(); return; }
    if (b.dataset.pvPover) {
      const p = find(b.dataset.pvPover);
      if (p && confirm(`組み方「${p.name}」を、いまの形で上書きします。よろしいですか？`) && await writePreset("PUT", p.id, { body: bodyOf(st()), base_rev: p.rev })) { save({ preset: p.id }); host.toast(`「${p.name}」をいまの形で上書きしました`); }
      paintPresetPop(); paintHead(); return;
    }
    if (b.dataset.pvPren) {
      const p = find(b.dataset.pvPren), name = p && (prompt("組み方の新しい名前", p.name) || "").trim();
      if (name && name !== p.name && await writePreset("PUT", p.id, { name, base_rev: p.rev })) host.toast(`名前を「${name}」にしました`);
      paintPresetPop(); paintHead(); return;
    }
    if (b.dataset.pvPdel) {
      const p = find(b.dataset.pvPdel);
      if (p && confirm(`組み方「${p.name}」〔${SCOPE_NAME[p.scope]}〕を消します。よろしいですか？`) && await writePreset("DELETE", `${p.id}?rev=${p.rev}`)) host.toast(`「${p.name}」を消しました`);
      paintPresetPop(); paintHead(); return;
    }
    if (b.hasAttribute("data-pv-psave")) {
      const el = popOf("preset"), name = ($("#llPvPName").value || "").trim(), scope = (el.querySelector('input[name="llPvPScope"]:checked') || {}).value || "me";
      const standard = $("#llPvPStd").checked, quick = $("#llPvPQuick").checked;
      if (!name) { $("#llPvPName").focus(); host.toast("名前を入れてください"); return; }
      const d = await writePreset("POST", "", { name, source: sourceOf(), scope, standard, body: bodyOf(st()) });
      if (d) {
        save({ preset: d.id });
        if (quick) await setQuick(presets.quick.concat([String(d.id)]));
        host.toast(`組み方「${name}」を〔${SCOPE_NAME[scope]}〕に保存しました${standard ? "（★最初に当てる）" : ""}${quick ? "。すぐに見るに出しました" : ""}`);
      }
      paintPresetPop(); paintHead();
    }
  }

  /* ---- 答え → 表の形・表（描き方はグラフと同じ lotlist-pivot-charts.js の 1 か所。ダッシュボードのパネルも同じ物を使う） ---- */
  const buildModel = C.buildModel;
  const tableHtml = (m, d) => C.tableHtml(m, d, { measName, dimName });
  function hintText(m, d) {
    const nData = m.rows.filter((r) => r.type === "data").length, nCol = m.cols.filter((c) => c.type === "data" || c.type === "all").length;
    return `行 ${nData.toLocaleString()} × 列 ${nCol.toLocaleString()} ・ ${d.measures.map((x) => measName(x)).join("・")} ・ ${d.count.toLocaleString()} 行から（一覧と同じ絞り込み）`
      + (d.month ? ` ・ ${monthName(d.month)}だけ` : "") + (d.shiftPattern ? ` ・ 直: ${d.shiftPattern}` : "") + (d.timing ? ` ・ ${d.timing.server}ms` : "");
  }

  /* ---- グラフ（描き方は lotlist-pivot-charts.js の 1 か所。ここは枠と見出しと、大きさが変わったときの描き直し） ---- */
  function paintChart(m, d, s) {
    const box = $("#llPvChart"); if (!box) return;
    const W = Math.max(600, box.clientWidth - 20);
    const { svg, legend = "", side = "" } = C.draw(s.chart, { m, d, s, W, measName, dimName, label: host.label });
    const def = C.get(s.chart), j = Math.min(s.chartAt || 0, d.measures.length - 1);
    // グラフにする値（値が 2 つ以上で、1 つの値を描く形のとき）
    const pickMeas = def && def.one && d.measures.length > 1 && !(m.nc === 0 && s.chart === "stack") ? `<label class="pv-ck">グラフにする値<select data-pv-chartat>${d.measures.map((x, k) => `<option value="${k}"${k === j ? " selected" : ""}>${esc(measName(x))}</option>`).join("")}</select></label>` : "";
    box.innerHTML = `<div class="pv-chead">${legend}${pickMeas}${optsHtml(s, d, true)}</div><div class="pv-cbody">${svg}${side}</div>`;
    if (!resizeObs && typeof ResizeObserver !== "undefined") {
      let w0 = box.clientWidth;
      resizeObs = new ResizeObserver(() => { const b = $("#llPvChart"); if (b && Math.abs(b.clientWidth - w0) > 30 && answer) { w0 = b.clientWidth; paintChart(buildModel(answer, st()), answer, st()); } });
      resizeObs.observe($("#llPivot"));
    }
  }

  /* ---- 操作 ----
     枠（#llPivot）は作り直さないので、押す・変える・打つの見張りは mount で 1 回だけ付ける（中身は描くたびに作り直す）。
     版 3.24.0 までは中身を作るたびに付け足していたので、設備を替えて集計を開くたびに見張りが 1 つずつ増え、
     「押すと入る・もう一度で外す」札（行・列・値）が偶数個のときは入れてすぐ外し、押しても何も起きなかった（× は段をいくつも外した） */
  function bind(pane) {
    // 札を引いて組み替える（版 3.50.0）: 文の札の並べ替え・行 ⇔ 列・カラムの札から置く・カラムの欄へ戻して外す
    DND.attach(pane, {
      lists: () => { const s = st(); return { rows: s.rows, cols: s.cols, vals: s.measures }; },
      max: { rows: MAX_DIMS, cols: MAX_DIMS, vals: MAX_MEASURES },
      itemOf: (col, role) => (role === "vals" ? (col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : { agg: "sum", column: col }) : { column: col, part: defaultPart(col) }),
      commit: (L, msg) => { save({ rows: L.rows, cols: L.cols, measures: L.vals }); refresh(true); if (msg) host.toast(msg); },
      toast: (t) => host.toast(t),
    });
    window.PivotCalc.bind(pane, setExpr);
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
      if (b.hasAttribute("data-pv-swap")) { save({ rows: s.cols, cols: s.rows }); refresh(true); return; }
      if (b.dataset.pvMx != null) { save({ measures: s.measures.filter((_, i) => i !== +b.dataset.pvMx) }); refresh(); return; }
      if (b.dataset.pvChart) { setChart(b.dataset.pvChart); return; }
      if (b.dataset.pvQuick != null) { const p = itemOf(b.dataset.pvQuick); if (p) applyPreset(p, { quiet: true }); return; }
      if (b.hasAttribute("data-pv-clear")) { save({ rows: [], cols: [], measures: [], month: "", preset: null }); refresh(true); return; }
      if (b.dataset.pvMstep) { const seq = monthSeq(), i = seq.indexOf(s.month); const to = seq[i + +b.dataset.pvMstep]; if (to !== undefined) setMonth(to); return; }
      if (b.hasAttribute("data-pv-qpick")) { togglePresetPop(b); return; }
      if (b.hasAttribute("data-pv-pick")) { toggleChartPop(b); return; }
      if (b.hasAttribute("data-pv-xlsx")) { exportXlsx(); return; }
      if (b.hasAttribute("data-pv-binauto")) { save({ rows: s.rows.map((d, i) => (i === 0 ? { column: d.column, part: "bin" } : d)) }); refresh(true); }
    });
    pane.addEventListener("change", (e) => {
      const t = e.target, s = st();
      if (t.dataset.pvPart) { const role = t.dataset.pvPart; setDims(role, s[role].map((d, i) => (i === +t.dataset.i ? { column: d.column, part: t.value } : d))); return; }
      if (t.dataset.pvAgg != null) { save({ measures: s.measures.map((m, i) => (i === +t.dataset.pvAgg ? { agg: t.value, column: m.column } : m)) }); refresh(); return; }
      if (t.dataset.pvOpt === "split") { save({ split: t.checked }); refresh(true); return; }   // 年月の段を足す・外すので読み直す
      if (t.dataset.pvOpt) { save({ [t.dataset.pvOpt]: t.checked }); if (answer) paint(answer); return; }
      if (t.hasAttribute("data-pv-month")) { setMonth(t.value); return; }
      if (t.hasAttribute("data-pv-chartat")) { save({ chartAt: +t.value }); if (answer) paintChart(buildModel(answer, st()), answer, st()); return; }
      if (t.hasAttribute("data-pv-binw")) { const w = Math.max(0, +t.value || 0); save({ rows: s.rows.map((d, i) => (i === 0 ? { ...d, width: w, origin: null } : d)) }); refresh(true); }
    });
    TPA.onText(pane, (_, e) => { if (e.target.id === "llPvSearch") $("#llPvFields").innerHTML = fieldsHtml(st()); });
  }
  /** グラフの形を替える。その形に要る段・値が無ければ、向く物を入れて知らせる（入れ方を推測させない）:
      ヒストグラム＝数のカラムを区間に・箱ひげ図＝値に数のカラムの平均（行が無ければ種類の少ない列）・散布図＝2 つの数のカラムの平均（行はロット番号）・
      管理図＝行が無ければ日付の段・パレート図／ドーナツ／積み上げ＝行が無ければ種類の少ない列・ヒートマップ＝列が無ければ直か種類の少ない列 */
  function setChart(k) {
    const s = st(), R = roles(), patch = { chart: k }, said = [];
    const num = (c) => !!c && isNum(c);
    const timeDim = host.isWork() ? { column: "@workday", part: "" } : R.$date ? { column: R.$date, part: "date" } : null;
    const fewDim = R.$few1 ? { column: R.$few1, part: "" } : null;
    if (k === "hist" && !(s.rows[0] && s.rows[0].part === "bin")) {
      const col = (s.rows.find((d) => isNum(d.column)) || {}).column || (s.measures.find((m) => m.column) || {}).column || R.$weight;
      if (!col) { host.toast("ヒストグラムにできる数のカラムがありません"); return; }
      Object.assign(patch, { rows: [{ column: col, part: "bin" }], cols: [], measures: [{ agg: "count" }] });
      said.push(`「${host.label(col)}」を区間に分けて、件数のヒストグラムにしました`);
    }
    if (BOXY.has(k) && !s.measures.some((m) => num(m.column))) {
      if (!R.$weight) { host.toast(`${C.get(k).n}にできる数のカラムがありません`); return; }
      patch.measures = [{ agg: "avg", column: R.$weight }].concat(s.measures).slice(0, MAX_MEASURES);
      said.push(`値に「${host.label(R.$weight)}」の平均を入れ、その分かれ方を描きます`);
    }
    // 版 3.39.0 で足した形: 足りない段・値を入れて知らせる（ほかの形と同じ）
    const addOnly = (ms) => ms.length && ms.every((m) => C.ADDITIVE.has(m.agg));
    if ((k === "sankey" || k === "treemap") && !addOnly(s.measures)) {
      patch.measures = [{ agg: "count" }];
      said.push("値を件数にしました（流れ・内訳は足し上げる値で描きます）");
    }
    if (k === "sankey" && s.rows.length < 2 && !s.cols.length) {
      const base = s.rows.length ? s.rows : fewDim ? [fewDim] : [];
      const next = [R.$few2, R.$few1].filter((c) => c && !base.some((d) => d.column === c)).map((c) => ({ column: c, part: "" }))[0];
      if (base.length && next) { patch.rows = base.concat([next]); said.push(`行に「${dimName(base[0])}」→「${dimName(next)}」の 2 段を入れました（から → へ）`); }
    }
    if (k === "swimlane" && s.rows.length < 2 && !s.cols.length && timeDim) {
      const lane = s.rows.length && !C.isTimeDim(s.rows[0]) ? s.rows[0] : fewDim;
      if (lane) { patch.rows = [lane, timeDim]; said.push(`行に「${dimName(lane)}」（レーン）と「${dimName(timeDim)}」（横）を入れました`); }
    }
    if (k === "xbar" && timeDim && !(s.rows[0] && C.isTimeDim(s.rows[0]))) {
      patch.rows = [timeDim];
      said.push(`行を「${dimName(timeDim)}」にしました（日ごとの群の平均と範囲）`);
    }
    if ((k === "diag45" || k === "bubble") && s.measures.filter((m) => num(m.column)).length < 2) {
      if (!R.$weight || !R.$num2) { host.toast(`${C.get(k).n}にできる数のカラムが 2 つありません`); return; }
      patch.measures = [{ agg: "avg", column: R.$weight }, { agg: "avg", column: R.$num2 }].concat(k === "bubble" ? [{ agg: "count" }] : []);
      said.push(`値を「${host.label(R.$weight)}」と「${host.label(R.$num2)}」の平均${k === "bubble" ? "・件数（円の大きさ）" : ""}にしました`);
      if (!s.rows.length && R.$lot) { patch.rows = [{ column: R.$lot, part: "" }]; said.push("行はロットごと"); }
    } else if (k === "bubble" && s.measures.length < 3) {
      patch.measures = s.measures.concat([{ agg: "count" }]).slice(0, MAX_MEASURES);
      said.push("円の大きさに件数を足しました");
    }
    if (k === "scatter" && s.measures.filter((m) => num(m.column)).length < 2) {
      if (!R.$weight || !R.$num2) { host.toast("散布図にできる数のカラムが 2 つありません"); return; }
      patch.measures = [{ agg: "avg", column: R.$weight }, { agg: "avg", column: R.$num2 }];
      said.push(`値を「${host.label(R.$weight)}」と「${host.label(R.$num2)}」の平均にしました（1 つ目＝横・2 つ目＝縦）`);
      if (!s.rows.length && R.$lot) { patch.rows = [{ column: R.$lot, part: "" }]; said.push("行はロットごと"); }
    }
    // 行が無いか、ヒストグラムの区間の段のまま別の形にしたとき（区間は形の都合で入れた物）は、その形に向く段に替える
    if ((!s.rows.length || (k !== "hist" && s.rows[0].part === "bin" && s.chart === "hist")) && !patch.rows) {
      const want = k === "control" || k === "line" || k === "time" ? timeDim : ["pareto", "donut", "stack", "stack100", "hstack", "hstack100", "box", "column", "bar", "heat"].includes(k) ? fewDim : null;
      if (want) { patch.rows = [want]; said.push(`行に「${dimName(want)}」を入れました`); }
    }
    if (k === "heat" && !s.cols.length) {
      const rows = patch.rows || s.rows, used = (c) => rows.some((d) => d.column === c);
      const col = host.isWork() && !used("@shift") ? { column: "@shift", part: "" } : [R.$few1, R.$few2].filter((c) => c && !used(c)).map((c) => ({ column: c, part: "" }))[0];
      if (col) { patch.cols = [col]; said.push(`列に「${dimName(col)}」を入れました`); }
    }
    const reload = patch.rows || patch.cols || patch.measures || BOXY.has(k) !== BOXY.has(s.chart);   // 頼む中身が替わる（箱ひげは四分位も頼む）
    save(patch);
    if (said.length) host.toast(`${C.get(k).n}: ${said.join("。")}`);
    if (reload || !answer) refresh(true); else paint(answer);
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
      ["数えた行", `${d.count.toLocaleString()} 行`], ...(d.month ? [["月", `${monthName(d.month)}だけ`]] : []), ...host.conditions()];
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
  function sync() { closePop(); answer = null; fields = null; paintSwitch(); host.onView(isOn()); const pane = $("#llPivot"); if (pane) pane.innerHTML = ""; }
  /** 保存した見方（lotlist.js）: 範囲の組み方を取り出す・入れる */
  const stateOf = () => { const s = st(); return { view: s.view, rows: s.rows, cols: s.cols, measures: s.measures, chart: s.chart, sub: s.sub, grand: s.grand, chartAt: s.chartAt, split: s.split, labels: s.labels, month: s.month }; };
  function setState(v) { if (!v || typeof v !== "object") return; save({ ...blank(), ...v }); sync(); if (isOn()) refresh(true); }
  // _items・_apply は評価関数（ui-eval-pivot-charts.mjs）が組み込みの組み方を 1 つずつ当てるため
  window.LotListPivot = { mount, refresh, sync, on: isOn, stateOf, setState, _buildModel: buildModel,
    _items: () => items().map((p) => ({ id: String(p.id), name: p.name, scope: p.scope, builtin: !!p.builtin, chart: (p.body || {}).chart, missing: p.missing })),
    _apply: (id) => { const p = itemOf(id); return p ? applyPreset(p, { quiet: true }) : false; } };
})();
