/* =========================================================================
   ダッシュボードのパネルの中身（版 3.37.0。グリッドと組み立ては dashboard.js・dashboard-editor.js）
   パネルの大きさに合わせて描く（スクロールしない）:
     数字（kpi）   … 値の総計を大きく。字の大きさはパネルの高さと幅で決める。値が 2 つ以上なら 2 つ目からは下に小さく
     グラフ        … 集計表と同じ描き方（lotlist-pivot-charts.js）を、パネルの幅・高さ・詰めた形（compact）で。
                     種類の段（設備・仕掛区分など）は、入る数だけ（大きい順にしていれば上位）を描き、残りの数を下に出す
     表（none）    … 集計表と同じ表。字と行の高さを詰めて収め、それでも入らない行は「ほか n 行」
     合わせた表（board）… 行の段を共通にして列のまとまりを横に並べる（版 3.38.0。設備ごとの仕掛と前日の実績はこの形）。表と同じ詰め方
   数え方はサーバー（POST /api/dashboard/query → services/pivot.py の query_many）。ここは答えを描くだけ
   ========================================================================= */
(function () {
  "use strict";
  const { esc } = TPA;
  const C = window.LotListPivotCharts;
  const PART_NAME = { date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const CATEGORY = new Set(["column", "bar", "pareto", "donut", "stack", "stack100", "box"]);   // 種類の段を並べる形（入る数だけ描く）
  /* 色（2026-10-grid の 2 回目）: 色＝データの種類。仕掛（データ元）＝藍・作業実績＝青緑・品質データ＝琥珀（1 枚の表の仕掛の棒・実績の濃淡も同じ）。
     種類の少ない段（8 つまで。仕掛区分など）の 1 系列の棒・ドーナツは、名前ごとに決まった色（どのパネルでも同じ名前は同じ色） */
  const SOURCE_COLOR = { lot: "#b5822a", work: "#2f7d78", src: "#3f6591" };
  const kindOf = (src) => (src === "lot" ? "lot" : src === "work" ? "work" : "src");
  const colorOf = (src) => SOURCE_COLOR[kindOf(src)];
  // 名前ごとの色は、データの種類の色（藍・青緑・琥珀）を使わない（区分の色が「作業実績」などと読めないように。2026-10-grid の 2 回目の指摘）
  // 警告の赤（前日 0 本の札・読めない）と近い赤・桃も使わない（3 回目の指摘）
  const CAT = ["#7658ae", "#5c8a2a", "#8a5f18", "#5a6f77", "#7a7a1f", "#8e4f76"];
  const hash = (t) => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
  /** その図の名前の並び → 名前ごとの色（名前で決まる色。図の中で同じ色が重なれば次の色へ＝同じ図に同じ色は出さない） */
  function catColors(names) {
    const used = new Set(), map = new Map();
    names.forEach((n) => { let i = hash(n) % CAT.length; for (let k = 0; k < CAT.length && used.has(i); k++) i = (i + 1) % CAT.length; used.add(i); map.set(n, CAT[i]); });
    return (n) => map.get(n) || CAT[hash(n) % CAT.length];
  }

  /* ---- 名前（集計表と同じ言葉。列はそのままの名前） ---- */
  const workdayName = (p) => `作業日（${(p && p.basis) === "cal" ? "太陽暦" : "現場歴"}）`;
  const dimName = (x, p) => (x.column === "@equip" ? "設備" : x.column === "@shift" ? "直"
    : x.column === "@workday" ? workdayName(p) + (x.part ? `（${{ ym: "年月", year: "年" }[x.part] || ""}）` : "")
      : x.column + (x.part ? `（${PART_NAME[x.part] || x.part}）` : ""));
  const measName = (m) => (m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : `${m.column}の${{ sum: "合計", avg: "平均", min: "最小", max: "最大" }[m.agg] || "合計"}`);
  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${+m[2]}/${+m[3]}` : iso || ""; };
  /** 期間の見せ方（「前日 10/15（現場歴）」「直近 14 日 10/2〜10/15」）。設備で日が違えば、いちばん多い範囲 */
  function periodText(p, d) {
    const pr = d && d.period;
    if (!pr) return "";
    const r = (pr.ranges || [])[0], basis = pr.column === "@workday" ? `（${(p && p.basis) === "cal" ? "太陽暦" : "現場歴"}）` : `（${pr.column}）`;
    const span = r ? (r.from === r.to ? md(r.from) : `${md(r.from)}〜${md(r.to)}`) : "";
    const name = pr.kind === "days" ? `直近 ${pr.n} 日` : pr.name;
    return `${name} ${span}${basis}${(pr.ranges || []).length > 1 ? "・設備で日が違います" : ""}`;
  }

  /* ---- 表の形（集計表と同じ buildModel）。種類の段は並べ替え・上位 N を当てる ---- */
  function modelOf(p, d) {
    const b = p.body || {};
    const s = { sub: false, grand: !!b.grand, chart: p.visual, chartAt: b.chartAt || 0, labels: b.labels !== false, split: false, month: "" };
    const m = C.buildModel(d, s);
    return { m, s };
  }
  /** 行の葉を並べ替え（大きい順・小さい順）、入る数（fit）か上位 N（top）に切る → {m, rest}（rest＝描かなかった行の数） */
  function trimRows(m, p, fit) {
    const data = m.rows.filter((r) => r.type === "data"), other = m.rows.filter((r) => r.type !== "data");
    const j = Math.min((p.body || {}).chartAt || 0, Math.max(0, m.M - 1)), all = m.cols.find((c) => c.type === "all") || m.cols[m.cols.length - 1] || { type: "all", path: [] };
    const val = (r) => { const v = m.value(r, { type: "all", path: [] }, j); return v == null ? (m.value(r, all, j) || 0) : v; };
    let rows = data.slice();
    if (p.sort === "desc") rows.sort((a, b) => val(b) - val(a));
    else if (p.sort === "asc") rows.sort((a, b) => val(a) - val(b));
    const limit = Math.max(1, Math.min(p.top || Infinity, fit || Infinity));
    const rest = Math.max(0, rows.length - limit);
    rows = rows.slice(0, limit);
    return { m: { ...m, rows: rows.concat(other) }, rest, total: data.length };
  }

  /* ---- 数字（kpi） ---- */
  function kpi(box, p, d, W, H, sub0 = "") {
    const cell = (d.cells || []).find((x) => !x.r.length && !x.c.length);
    const vals = cell ? cell.v : [];
    const main = vals[0], ms = d.measures || [];
    const text = main == null ? "–" : C.fmt(main);
    const unit = ms[0] ? (ms[0].agg === "lots" ? (p.source === "work" ? "本" : "ロット") : ms[0].agg === "count" ? "件" : "") : "";
    // 字の大きさ: 高さの 5 割・幅に収まる大きさ（数字 1 字 ≒ 0.6em・単位は 1 字 ≒ 0.34em〈字の 0.32 倍の大きさ〉）の小さい方。14〜88px
    // 低いパネル（1 段）は、数と添え書きを横に並べる（縦に積むと数が小さくなり、添え書きが下で切れる）
    const row = H < 96 && W >= 240;
    const room = row ? H : H - (sub0 ? 20 : 0);    // 添え書き（期間・元）の行の分
    const wide = row ? W * 0.55 : W - 8;   // 横に並べるときは、数に幅の 55% まで（残りは添え書き）
    const size = Math.round(Math.max(14, Math.min(88, room * (row ? 0.78 : vals.length > 1 ? 0.42 : 0.56), wide / Math.max(2, text.length * 0.62 + unit.length * 0.36 + 0.2))));
    const sub = vals.slice(1, 4).map((v, i) => `<span><small>${esc(measName(ms[i + 1]))}</small><b>${esc(C.fmt(v))}</b></span>`).join("");
    box.innerHTML = `<div class="dp-kpi${row ? " is-row" : ""}"><b class="dp-num" style="font-size:${size}px">${esc(text)}<small>${unit}</small></b>`
      + (sub && room > size + 40 ? `<div class="dp-ksub">${sub}</div>` : "")
      + (sub0 ? `<small class="dp-kmeta" title="${esc(sub0)}" style="-webkit-line-clamp:${Math.max(1, Math.min(2, Math.floor(H / 16)))}">${esc(sub0)}</small>` : "") + "</div>";
    // 描いた後に、いま居る面に収まるまで数を小さくする（測った時と面の大きさが違っても、はみ出さない）
    const num = box.querySelector(".dp-num"), limit = box.clientHeight || H;
    for (let f = size; f > 12 && (box.scrollHeight > limit + 1 || box.scrollWidth > box.clientWidth + 1); f -= 2) num.style.fontSize = `${f - 2}px`;
  }

  /* ---- グラフ ---- */
  function fitCount(kind, W, H) {
    if (kind === "bar") return Math.max(2, Math.floor((H - 8) / 17));
    if (kind === "donut") return 10;
    if (kind === "box") return Math.max(2, Math.floor((W - 54) / 34));
    return Math.max(2, Math.floor((W - 54) / 26));     // 縦棒・パレート・積み上げ: 1 本 26px まで
  }
  function chart(box, p, d, W, H) {
    const { m: m0, s } = modelOf(p, d);
    if (!m0.rows.some((r) => r.type === "data")) { box.innerHTML = '<p class="dp-empty">当たる行がありません（条件・期間を見直してください）</p>'; return ""; }
    let m = m0, note = "";
    const kind = p.visual;
    if (CATEGORY.has(kind) || kind === "heat") {
      const fit = kind === "heat" ? Math.max(2, Math.floor((H - 30) / 12)) : fitCount(kind, W, H);
      const t = trimRows(m0, p, fit);
      m = t.m;
      if (t.rest) note = `${p.sort ? (p.sort === "desc" ? "大きい順" : "小さい順") + "に" : ""}${t.total - t.rest} / ${t.total} を描いています`;
    }
    // 凡例を描く高さ（列の段・値が 2 つ以上のときだけ。低いパネルでは出さない）
    const wantLegend = (m.nc > 0 || d.measures.length > 1) && H >= 150 && kind !== "donut";
    const gh = Math.max(60, H - (wantLegend ? 20 : 0));
    const src = colorOf(p.source), colors = [src, ...C.COLORS.filter((c) => c !== src)];
    const r0 = (d.dims.rows || [])[0], few = m.nr === 1 && m.nc === 0 && r0 && !r0.column.startsWith("@") && !C.isTimeDim(r0) && m.rows.filter((r) => r.type === "data").length <= 8;
    const out = C.draw(kind, { m, d, s, W, H: gh, measName, dimName: (x) => dimName(x, p), label: (c) => c, compact: true, colors, rowColor: few ? catColors(m.rows.filter((r) => r.type === "data").map((r) => m.rowName(r)).sort()) : null });
    const sideOk = out.side && kind === "donut" && W - (Math.min(gh / 2 - 6, W / 2 - 8, 160) * 2 + 16) >= 150;
    const legend = wantLegend ? `<div class="dp-legend">${(out.legend || "").replace(/<small class="pv-cnote">[\s\S]*?<\/small>/g, "")}</div>` : "";
    box.innerHTML = `${legend}<div class="dp-chart">${out.svg}${sideOk ? out.side : ""}</div>`;
    return note;
  }

  /* ---- 表（集計表と同じ表を、字と行の高さを詰めて収める） ---- */
  function table(box, p, d, W, H) {
    const { m: m0 } = modelOf(p, d);
    const t = trimRows(m0, p, Infinity);
    box.innerHTML = `<div class="dp-tbl"><table class="pv-table">${C.tableHtml(t.m, d, { measName, dimName: (x) => dimName(x, p) })}</table></div>`;
    return moreText(fitRows(box.querySelector(".dp-tbl"), H), "行");
  }
  /** 表を高さ H に収める: 字を 14 → 11px まで詰め、それでも入らなければ下の行を隠す → 隠した行の数 */
  function fitRows(wrap, H) {
    if (!wrap || !shrink(wrap, H)) return 0;
    const rows = [...wrap.querySelector("table").tBodies[0].rows];
    const keepLast = rows.length && rows[rows.length - 1].classList.contains("is-grand") ? 1 : 0;
    let hidden = 0;
    for (let i = rows.length - 1 - keepLast; i > 0 && wrap.scrollHeight > H + 1; i--) { rows[i].hidden = true; hidden++; }
    return hidden;
  }
  const moreText = (n, what) => (n ? `ほか ${n} ${what}（パネルを大きくすると出ます）` : "");

  /* ---- 合わせた表（visual board。版 3.38.0）。行の段（既定は設備）を共通にして、列のまとまり（それぞれほかのパネルと同じ組み方で数えた答え）を
     横に並べる。版 3.36.0 の「設備ごとの仕掛と前日の実績」は、この形の標準の組み（仕掛ロット数〈棒〉＋前日の直ごとの実績本数〈濃淡・計・0 本の印〉）。
     行の並び: 値の大きい順（どのまとまりの計で）・名前の順・設備の並び（作業実績の設備の並び）・手で並べる（list。隠す hide） ---- */
  const ago = (sec) => { if (!sec) return ""; const t = new Date(sec * 1000), z = TPA.pad2; return `${t.getMonth() + 1}/${t.getDate()} ${z(t.getHours())}:${z(t.getMinutes())}`; };
  const cellOf = (a, r, c) => ((a.cells || []).find((x) => x.r.length === r.length && x.c.length === c.length && x.r.every((k, i) => k === r[i]) && x.c.every((k, i) => k === c[i])) || {}).v;
  const unitOf = (g) => (g.measure.agg === "lots" ? (g.source === "work" ? "本" : "ロット") : g.measure.agg === "count" ? "件" : "");
  const groupColor = (g) => g.color || colorOf(g.source);
  /** まとまりの題（空なら組み方から: 「前日 10/15 の実績本数（現場歴）」「仕掛のロット数」） */
  function groupTitle(g, a) {
    if (g.title) return g.title;
    const word = g.measure.agg === "lots" ? (g.source === "work" ? "実績本数" : "ロット数") : measName(g.measure);
    const pr = a && a.period, r = pr && (pr.ranges || [])[0];
    if (pr && r) {
      const name = pr.kind === "days" ? `直近 ${pr.n} 日` : pr.name, span = r.from === r.to ? md(r.from) : `${md(r.from)}〜${md(r.to)}`;
      return `${name} ${span} の${word}${pr.column === "@workday" ? `（${g.basis === "cal" ? "太陽暦" : "現場歴"}）` : ""}`;
    }
    return `${(a && a.sourceName) || ""}${a && a.sourceName ? "の" : ""}${word}`;
  }
  /** 1 つのまとまりの答え → {rows: Map(行の鍵 → {label, v: [列ごとの値], total}), cols: [{key, label}], total, missing: Set, failed: Map, none} */
  function groupModel(g, a, rowDim) {
    const out = { rows: new Map(), cols: [], total: null, failed: new Map(), parts: null, none: 0, err: a && a.error ? a : null };
    if (!a || a.error) return out;
    const nc = (a.dims.cols || []).length, labels = a.labels || [], orders = a.orders || [];
    if (nc) {
      const leaves = (a.cells || []).filter((x) => x.r.length === 1 && x.c.length === nc).map((x) => JSON.stringify(x.c));
      const rank = (path) => path.map((k, i) => (orders[1 + i] || []).indexOf(k));
      out.cols = [...new Set(leaves)].map((j) => JSON.parse(j)).sort((x, y) => { const p = rank(x), q = rank(y); for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; })
        .map((path) => ({ path, label: path.map((k, i) => (labels[1 + i] || {})[k] ?? k).join("・") }));
      // 直の段: 勤務体系の直は、前日に作業が無くても列に並べる（勤務体系の順。直の外・時刻なしは後ろ）
      if (nc === 1 && a.dims.cols[0].column === "@shift" && (a.shifts || []).length) {
        const have = new Set(out.cols.map((c) => c.label)), at = (c) => { const i = a.shifts.indexOf(c.label); return i < 0 ? 1e6 + out.cols.indexOf(c) : i; };
        out.cols = out.cols.concat(a.shifts.filter((n) => !have.has(n)).map((n) => ({ path: ["\u0000" + n], label: n }))).sort((x, y) => at(x) - at(y));
        out.shiftsOf = new Map((a.parts || []).map((x) => [x.name, new Set(x.shifts || [])]));
      }
    }
    for (const k of orders[0] || []) {
      const label = (labels[0] || {})[k] ?? k;
      if (rowDim === "@equip" && k === "") { out.none = (cellOf(a, [k], []) || [0])[0] || 0; continue; }   // 設備の分からない行は表に出さず、数だけ言う
      out.rows.set(label, { v: out.cols.map((c) => (cellOf(a, [k], c.path) || [null])[0]), total: (cellOf(a, [k], []) || [null])[0] });
    }
    out.total = (cellOf(a, [], []) || [null])[0];
    (a.failed || []).concat(a.skipped || []).forEach((f) => out.failed.set(f.name, f.error));
    if (a.parts) out.parts = new Set(a.parts.map((x) => x.name));
    return out;
  }
  function boardOrder(p, keys, models, equipOrder) {
    const o = p.order || {}, by = o.by || "value", hide = new Set(o.hide || []);
    const name = (a, b) => a.localeCompare(b, "ja");
    const shown = keys.filter((k) => !hide.has(k));
    if (by === "name") return shown.sort(name);
    if (by === "equip" || by === "manual") {
      const list = by === "manual" ? (o.list || []) : (equipOrder || []), at = (k) => { const i = list.indexOf(k); return i < 0 ? Infinity : i; };
      return shown.sort((a, b) => at(a) - at(b) || name(a, b));
    }
    const m = models[Math.min(o.group || 0, models.length - 1)], val = (k) => { const r = m && m.rows.get(k); return r && r.total != null ? r.total : 0; };
    return shown.sort((a, b) => (o.dir === "asc" ? val(a) - val(b) : val(b) - val(a)) || name(a, b));
  }
  /** 合わせた表の行の鍵（いまの並び。隠した行も入れる）。組む所の行の札に使う */
  function boardKeys(p, d) {
    const gs = p.groups || [], rowDim = (p.rows || {}).column || "@equip";
    const models = gs.map((g, i) => groupModel(g, ((d && d.groups) || [])[i], rowDim));
    const keys = [...new Set(models.flatMap((m) => [...m.rows.keys(), ...(rowDim === "@equip" ? [...m.failed.keys()] : [])]))];
    return boardOrder({ ...p, order: { ...(p.order || {}), hide: [] } }, keys, models, d && d.equipOrder);
  }
  /** 合わせた表を描く（d = {groups: [答え], equipOrder}）→ 下に出す知らせの字 */
  function board(box, p, d, H) {
    if (!d) { box.innerHTML = '<p class="dp-wait">数えています…</p>'; return ""; }
    const gs = p.groups || [], rowDim = (p.rows || {}).column || "@equip";
    const models = gs.map((g, i) => groupModel(g, (d.groups || [])[i], rowDim));
    const keys = [...new Set(models.flatMap((m) => [...m.rows.keys(), ...(rowDim === "@equip" ? [...m.failed.keys()] : [])]))];
    const order = boardOrder(p, keys, models, d.equipOrder);
    // 0 の印: まとまりの計が 0（行が無い＝0）で、ほかのまとまりに数がある行
    const zeroOf = (gi, k) => { const r = models[gi].rows.get(k); return !(r && r.total) && models.some((m, j) => j !== gi && ((m.rows.get(k) || {}).total || 0) > 0); };
    const flags = gs.map((g, gi) => (g.zero && !models[gi].err ? order.filter((k) => zeroOf(gi, k) && !models[gi].failed.has(k) && !(models[gi].parts && !models[gi].parts.has(k))) : []));
    const span = (gi) => Math.max(1, models[gi].cols.length + (models[gi].cols.length && gs[gi].total ? 1 : 0));
    const fmtN = (n) => (n == null ? "–" : C.fmt(n));
    const groupCells = (g, gi, k) => {
      const m = models[gi], r = m.rows.get(k), col = groupColor(g), grp = gi ? " db-grp" : "";
      if (m.err) return `<td class="db-ng${grp}" colspan="${span(gi)}">${gi === 0 || k === order[0] ? esc(m.err.error) : ""}</td>`;
      if (m.failed.has(k)) return `<td class="db-ng${grp}" colspan="${span(gi)}">${esc(m.failed.get(k))}</td>`;
      if (!r && m.parts && !m.parts.has(k)) return `<td class="db-na${grp}" colspan="${span(gi)}">${esc((d.groups[gi] || {}).sourceName || "")}の${rowDim === "@equip" ? "設備" : "行"}にありません</td>`;
      const maxOf = (vals) => Math.max(1, ...vals.filter((v) => typeof v === "number"));
      if (!m.cols.length) {
        const v = r ? r.total : 0;
        if (g.look === "bar") {
          const mx = maxOf([...m.rows.values()].map((x) => x.total));
          return `<td class="db-lots${grp}" style="--gc:${col}"><div><span class="db-bar"><i style="width:${((v || 0) / mx * 100).toFixed(1)}%"></i></span><b>${v ? fmtN(v) : "–"}</b></div></td>`;
        }
        return `<td class="num db-s${grp}${v ? "" : " is-zero"}" style="--gc:${col}">${g.look === "heat" && v ? `<span style="--h:${(0.1 + 0.35 * v / maxOf([...m.rows.values()].map((x) => x.total))).toFixed(2)}">${fmtN(v)}</span>` : fmtN(v || 0)}</td>`;
      }
      const mx = maxOf([...m.rows.values()].flatMap((x) => x.v));
      const cells = m.cols.map((c, ci) => {
        const v = r ? r.v[ci] : 0, gl = ci ? "" : grp;
        const own = m.shiftsOf && m.shiftsOf.get(k);
        if (own && own.size && !own.has(c.label) && (d.groups[gi].shifts || []).includes(c.label)) return `<td class="num db-s is-na${gl}" title="この設備の勤務体系に無い直">–</td>`;
        const n = v || 0;
        return `<td class="num db-s${gl}${n ? "" : " is-zero"}" style="--gc:${col}">${g.look === "heat" && n ? `<span style="--h:${(0.1 + 0.35 * n / mx).toFixed(2)}">${fmtN(n)}</span>` : g.look === "bar" && n ? `<span class="db-mini"><i style="width:${(n / mx * 100).toFixed(1)}%"></i></span>${fmtN(n)}` : fmtN(n)}</td>`;
      }).join("");
      const t = r ? r.total || 0 : 0;
      return cells + (g.total ? `<td class="num db-sum">${fmtN(t)}${flags[gi].includes(k) ? `<em class="db-flag" title="ほかのまとまりに数があるのに、${esc(groupTitle(g, d.groups[gi]))}が 0 でした">0 ${unitOf(g)}</em>` : ""}</td>` : "");
    };
    const rowName = rowDim === "@equip" ? "設備" : dimName(p.rows || { column: rowDim }, p);
    const rowList = order.map((k) => `<tr><th scope="row">${esc(k)}</th>${gs.map((g, gi) => groupCells(g, gi, k)).join("")}</tr>`);
    const head1 = gs.map((g, gi) => {
      const m = models[gi], a = (d.groups || [])[gi] || {}, cls = gi ? "db-grp" : "";
      const tip = [a.sourceName, ...(a.mirrors || []).slice(0, 1).map((x) => x && x.at ? `元 ${ago(x.at)}` : ""), m.none ? `${rowDim === "@equip" ? "設備なし" : "空欄"} ${C.fmt(m.none)}` : ""].filter(Boolean).join("・");
      return `<th class="${cls}${m.cols.length ? "" : (g.look === "bar" ? " db-lots" : " num")}" colspan="${span(gi)}"${m.cols.length ? "" : ' rowspan="2"'} title="${esc(tip)}">${esc(groupTitle(g, a))}<small>計 ${m.total == null ? "–" : C.fmt(m.total)}${unitOf(g) ? ` ${unitOf(g)}` : ""}</small></th>`;
    }).join("");
    const head2 = gs.map((g, gi) => (models[gi].cols.length ? models[gi].cols.map((c, ci) => `<th class="num db-s${ci || !gi ? "" : " db-grp"}">${esc(c.label)}</th>`).join("") + (g.total ? '<th class="num db-sum">計</th>' : "") : "")).join("");
    const thead = `<thead><tr><th rowspan="2">${esc(rowName)}</th>${head1}</tr><tr>${head2}</tr></thead>`;
    const warn = gs.map((g, gi) => (flags[gi].length ? `<span class="db-warn" title="ほかのまとまりに数があるのに、${esc(groupTitle(g, d.groups[gi]))}が 0 だった${rowDim === "@equip" ? "設備" : "行"}"><b>${esc(groupTitle(g, d.groups[gi]).replace(/ .*$/, ""))} 0 ${unitOf(g)}</b>${flags[gi].map(esc).join("・")}</span>` : "")).join("");
    const meta = models.map((m, gi) => { const a = (d.groups || [])[gi] || {}, at = (a.mirrors || [])[0]; return `${esc(a.sourceName || "")}${at && at.at ? ` 元 ${esc(ago(at.at))}` : ""}${m.none ? `・${rowDim === "@equip" ? "設備なし" : "空欄"} ${C.fmt(m.none)}` : ""}`; }).filter(Boolean).join("　");
    box.innerHTML = `<div class="db-boardhead">${warn}<span class="db-sp"></span><small class="db-meta" title="${esc(meta)}">${meta}</small></div><div class="dp-flow"></div>`;
    const head = box.querySelector(".db-boardhead"), flow = box.querySelector(".dp-flow"), avail = H - (head ? head.offsetHeight + 4 : 0);
    flow.style.maxHeight = avail + "px";
    const cols = 1 + gs.reduce((n, g, gi) => n + span(gi), 0);
    if (!rowList.length) { flow.innerHTML = `<table class="db-table">${thead}<tbody><tr><td colspan="${cols}" class="dp-empty">当たる行がありません。</td></tr></tbody></table>`; return ""; }
    // 入らなければ、字を詰める → 行を 2〜3 つの列に分けて横に並べる（幅が足りるとき）→ 下の行を隠す の順（2026-10-grid の 2 回目。どの行も見えるように）
    const W = box.clientWidth;
    for (let k = 1; k <= 3; k++) {
      if (k > 1 && W / k < 470) break;
      const per = Math.ceil(rowList.length / k);
      flow.style.setProperty("--k", k);
      flow.innerHTML = Array.from({ length: k }, (_, i) => `<div class="dp-tbl"><table class="db-table">${thead}<tbody>${rowList.slice(i * per, (i + 1) * per).join("")}</tbody></table></div>`).join("");
      if (!shrink(flow, avail)) return "";
    }
    return moreText([...flow.querySelectorAll(".dp-tbl")].reduce((a, t) => a + fitRows(t, avail), 0), rowDim === "@equip" ? "設備" : "行");
  }
  /** 字を 14 → 11px まで詰めて高さに入るか試す → 入らなければ true（詰めた最後のまま） */
  /** 表を高さ H に合わせる: 入る中でいちばん大きな字（15 → 11px）にし、まだ下が空けば行の上下の余白で埋める（縦長のパネルの下が空かない）。
      11px でも入らなければ true（呼んだ所が列に分ける・行を隠す） */
  function shrink(wrap, H) {
    const tbs = [...wrap.querySelectorAll("table")];
    const set = (fs, pv) => tbs.forEach((tb) => { tb.style.fontSize = fs + "px"; tb.style.setProperty("--dp-pad", `${pv}px ${fs >= 13 ? 8 : 6}px`); });
    for (const fs of [15, 14, 13, 12, 11.5, 11]) {
      const pv = fs >= 14 ? 5 : fs >= 13 ? 4 : fs >= 12 ? 3 : 2;
      set(fs, pv);
      if (wrap.scrollHeight > H + 1) continue;
      const rows = Math.max(...tbs.map((tb) => tb.rows.length)), spare = H - wrap.scrollHeight;
      if (spare > rows * 2) { set(fs, pv + Math.min(9, Math.floor(spare / rows / 2))); if (wrap.scrollHeight > H + 1) set(fs, pv); }
      return false;
    }
    return true;
  }

  /** パネルの中身を描く（sub: 数字の形の下に出す添え書き〈期間・元〉）→ 下に出す知らせの字（描かなかった行など） */
  function render(box, p, d, size, sub = "") {
    const W = Math.max(60, Math.floor(size.w)), H = Math.max(40, Math.floor(size.h));
    if (p.visual === "kpi") { kpi(box, p, d, W, H, sub); return ""; }
    if (p.visual === "none") return table(box, p, d, W, H);
    return chart(box, p, d, W, H);
  }

  /** パネルの知らせ（読めなかった設備・効かない条件・ロット数の注意）。見出しの ⚠ の札に出す（中身の上に被せない） */
  function notes(d) {
    const out = [];
    const bad = [...(d.failed || []), ...(d.skipped || [])];
    if (bad.length) out.push(`読めない設備: ${bad.map((x) => x.name).join("・")}`);
    if ((d.ignoredFilters || []).length) out.push(`効かない条件（表に無い列）: ${d.ignoredFilters.join("・")}`);
    if (d.note) out.push(d.note);
    return out;
  }

  window.DashPanels = { render, board, notes, periodText, measName, dimName, md, colorOf, kindOf, groupTitle, unitOf, boardKeys, SOURCE_COLOR };
})();
