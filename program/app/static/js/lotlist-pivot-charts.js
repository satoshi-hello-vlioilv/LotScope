/* =========================================================================
   集計表・グラフの描き方（版 3.27.0〜。組み方・表・覚えは lotlist-pivot.js。ここはグラフの形の登録と、答え → SVG だけ）
   - グラフの形は DEFS の 1 か所に登録する（鍵・名前・目的のまとまり・絵・説明・向く組み方・描く関数）。
     画面の形を選ぶ所（lotlist-pivot.js）・組み方のプリセット（services/pivot_presets.py の CHARTS）は、この鍵で揃える
   - 目的のまとまり（GROUPS）: 推移を見る・比べる・内訳を見る・ばらつきを見る・関係を見る・表。形が増えても、まず目的で選べる
   - 描く関数は ctx = {m: 表の形（buildModel）, d: サーバーの答え, s: 組み方, W, H, measName, dimName, label, compact} → {svg, legend, side}
     compact（版 3.37.0。ダッシュボードのパネル）: 余白を詰め、横の傾向の面（side）の分を空けない（パネルの大きさに収める）
   - 数え方はサーバー（services/pivot.py）。ここでは足し上げ・並べ替え・割合・管理限界（I 管理図）・回帰の直線だけを数える
   ========================================================================= */
(function () {
  "use strict";
  const { esc } = TPA;
  // 系列の色。ダッシュボードのパネルは draw の ctx.colors で替える（データの種類の色。描く間だけ差し替える: draw）
  let COLORS = ["#b5822a", "#2f7d78", "#4a62b0", "#c9564a", "#7658ae", "#5c8a2a", "#1f6aa8", "#8a5f18", "#5a6f77", "#d35d8e", "#0d8191", "#a5372c"];
  const ALERT = "#c9564a", WARN = "#b5822a", MUTED = "#6b7680";
  const ADDITIVE = new Set(["count", "lots", "sum"]);
  const SEP = "\u001f";
  const ALL = { type: "all", path: [] };        // 列の段の頭が空＝その行の全体（サーバーは段の頭の組をすべて数えるので、いつもある）
  const TIME_PARTS = new Set(["date", "ym", "year", "hour"]);

  /* ---- 字と目盛り ---- */
  const fmt = (v) => {
    if (v == null || v === "") return "";
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return v.toLocaleString("ja-JP");
    return v.toLocaleString("ja-JP", { maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 3 });
  };
  const short = (v) => (Math.abs(v) >= 1e8 ? `${+(v / 1e8).toFixed(1)}億` : Math.abs(v) >= 1e4 ? `${+(v / 1e4).toFixed(1)}万` : fmt(Math.round(v * 100) / 100));
  const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  /** 0 から始まる目盛りの最大（4 等分した目盛りがきりの良い数: 1・2・4・6・8・10 × 10^k） */
  const niceMax = (v) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); return [1, 2, 4, 6, 8, 10].map((k) => k * e).find((x) => x >= v); };
  /** 0 から始めない目盛り（管理図・箱ひげ・散布図）: きりの良い刻みで lo〜hi を 4〜6 つに分ける */
  function niceRange(lo, hi) {
    if (!(hi > lo)) { const pad = Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
    const raw = (hi - lo) / 4, e = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * e).find((x) => x >= raw);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = []; for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.round(t / step) * step);
    return { lo: a, hi: b, ticks };
  }
  const legendHtml = (items) => `<span class="pv-legend">${items.map(([name, color, kind]) => `<span><i class="${kind === "line" ? "is-line" : ""}" style="--c:${color}"></i>${esc(name)}</span>`).join("")}</span>`;
  /** 左（か右）の目盛りと横の補助線（0〜max を 4 等分） */
  function axisY(x0, y0, h, max, right, W, color = MUTED, fmtv = short) {
    // 目盛りの字が重ならない数だけ（低いグラフ＝ダッシュボードの小さなパネルは 3 つか 2 つ）
    return (h >= 110 ? [0, 0.25, 0.5, 0.75, 1] : h >= 54 ? [0, 0.5, 1] : [0, 1]).map((f) => { const y = y0 + h * (1 - f); return `${right ? "" : `<line x1="${x0}" x2="${W - 56}" y1="${y}" y2="${y}" class="pv-grid"/>`}<text x="${right ? W - 50 : x0 - 6}" y="${y + 4}" text-anchor="${right ? "start" : "end"}" fill="${color}" class="pv-ax">${esc(fmtv(max * f))}</text>`; }).join("");
  }
  /** 範囲の目盛り（niceRange）と補助線。y は値 → 縦の位置 */
  const axisRange = (r, x0, x1, y) => r.ticks.filter((t, i, a) => a.length < 3 || Math.abs(y(a[0]) - y(a[a.length - 1])) / (a.length - 1) >= 16 || i % 2 === 0).map((t) => `<line x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}" class="pv-grid"/><text x="${x0 - 6}" y="${y(t) + 4}" text-anchor="end" class="pv-ax">${esc(short(t))}</text>`).join("");
  const svgOf = (W, H, g, label) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
  const empty = (text) => ({ svg: `<div class="pv-cempty">${text}</div>`, legend: "", side: "" });
  /** 余白（詰めた形は小さく）と、横の傾向の面の幅（詰めた形は 0） */
  const pad = (ctx, wide, tight) => (ctx.compact ? tight : wide);
  const sideW = (ctx) => (ctx.compact ? 0 : 250);
  /** 数値ラベルの間引き: 字の幅が 1 本ぶんの幅に入らなければ、何本おきかに */
  const thinOf = (vals, slot, text = short) => Math.max(1, Math.ceil(Math.max(0, ...vals.map((v) => (v ? text(v).length * 6.2 + 4 : 0))) / Math.max(slot, 1)));
  const statsBox = (title, rows, note = "") => `<div class="pv-stats"><b>${esc(title)}</b><table>${rows.map(([k, v, cls]) => `<tr${cls ? ` class="${cls}"` : ""}><th>${esc(k)}</th><td>${esc(typeof v === "number" ? fmt(v) : v)}</td></tr>`).join("")}</table>${note ? `<small class="pv-cnote">${note}</small>` : ""}</div>`;

  /* ---- 答えの読み方 ---- */
  /** 答えが月で区切った形か（行の 1 段目が年月・2 段目が同じ列の日）→ 日の段の番号（1）か 0 */
  const isDay = (x) => !!x && ((x.column === "@workday" && !x.part) || (x.column !== "@workday" && !x.column.startsWith("@") && x.part === "date"));
  const dayAt = (d) => { const r = d.dims.rows; return r.length > 1 && r[0].part === "ym" && r[1].column === r[0].column && isDay(r[1]) ? 1 : 0; };
  const isTimeDim = (x) => !!x && (x.column === "@workday" || TIME_PARTS.has(x.part));
  const isTime = (d) => isTimeDim(d.dims.rows[dayAt(d)]);
  const dataRows = (m) => m.rows.filter((r) => r.type === "data" && r.path.length);
  const dataCols = (m, n = 12) => m.cols.filter((c) => c.type === "data" || c.type === "all").slice(0, n);
  const chartAt = (ctx) => Math.min(ctx.s.chartAt || 0, ctx.d.measures.length - 1);
  function tickText(k, part) {
    if (part === "date" && /^\d{4}-\d{2}-\d{2}$/.test(k)) return `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
    if (part === "ym" && /^\d{4}-\d{2}$/.test(k)) return `${k.slice(2, 4)}/${k.slice(5, 7)}`;
    return k;
  }
  /** 横の目盛り。時の段（日付・年月）は間も空けて並べる（無い日は値なし）。そうでなければ表の並びのまま（cat）。L は横に並べる段 */
  function axisOf(m, d, L) {
    const data = dataRows(m), x = d.dims.rows[L];
    if (!isTimeDim(x)) {
      const ticks = [...new Set(data.map((r) => r.path[L]))];
      const pos = new Map(ticks.map((k, i) => [k, i]));
      return { ticks, at: (k) => pos.get(k) ?? -1, part: "", cat: true };
    }
    const part = x.column === "@workday" ? ({ ym: "ym", year: "year" }[x.part] || "date") : x.part;
    const keys = [...new Set(data.map((r) => r.path[L]).filter(Boolean))].sort();
    if (!keys.length) return { ticks: [], at: () => -1, part };
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

  /* ================= 推移を見る ================= */
  /** 時系列・折れ線: 1 つ目の値＝棒（足し上げる値。折れ線の形では線）、2 つ目以降＝折れ線（右の目盛り）。列の段があれば 1 つ目の値を列ごとに
      （時系列の足し上げる値は積み上げの棒＝高さがその日の合計）。月で区切ったとき（日の段の上に年月の段）は、日を横に並べ、月の境目に線と月の名前。
      数値ラベルは 1 つ目の系列の上（入り切る本数だけ） */
  function trendChart(ctx, lines) {
    const { m, d, s, W, H } = ctx, L = dayAt(d), ax = axisOf(m, d, L), n = ax.ticks.length, months = L === 1 && ax.part === "date";
    if (!n) return empty("描く行がありません。");
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 60, 40), pt = months ? 30 : s.labels ? 22 : 12, pb = pad(ctx, 40, 26), iw = W - pl - pr, ih = H - pt - pb;
    const x = (i) => pl + iw * (i + 0.5) / Math.max(n, 1), bw = Math.max(2, Math.min(40, iw / Math.max(n, 1) * 0.7));
    const series = [], colsData = dataCols(m);
    const stack = !lines && m.nc > 0 && ADDITIVE.has(d.measures[0].agg);
    if (m.nc) colsData.forEach((c, k) => series.push({ name: m.colName(c), j: 0, c, axis: "left", kind: stack ? "stack" : "line", color: COLORS[(k + 1) % COLORS.length] }));
    else d.measures.forEach((mm, j) => series.push({ name: ctx.measName(mm), j, c: ALL, axis: j === 0 ? "left" : "right", kind: !lines && j === 0 && ADDITIVE.has(mm.agg) ? "bar" : "line", color: COLORS[j % COLORS.length] }));
    // 横に並べる段（日付など）ごとの値。その下にも段があれば、その段の小計（段の頭の組の数）を使う
    const at = (r) => ax.at(r.path[L]);
    const pick = (ser) => {
      const v = new Array(n).fill(null);
      const rowsAt = m.nr > L + 1 ? m.rows.filter((r) => r.type === "sub" && r.path.length === L + 1) : dataRows(m);
      rowsAt.forEach((r) => { const i = at(r); if (i >= 0) v[i] = m.value(r, ser.c, ser.j); });
      if (m.nr > L + 1 && !rowsAt.length) dataRows(m).forEach((r) => { const i = at(r); if (i >= 0) v[i] = (v[i] || 0) + (m.value(r, ser.c, ser.j) || 0); });
      return v;
    };
    // 時の段の足し上げる値（件数・ロット数・合計）は、無い日を 0 に（作業しなかった日＝0。線が途切れない）。平均などは無いまま
    series.forEach((q) => { q.v = pick(q); if (!ax.cat && ADDITIVE.has(d.measures[q.j].agg)) q.v = q.v.map((v) => v ?? 0); });
    const stacked = series.filter((q) => q.kind === "stack");
    const tops = stacked.length ? ax.ticks.map((_, i) => stacked.reduce((a, q) => a + (q.v[i] || 0), 0)) : [];
    const maxL = niceMax(Math.max(0, ...tops, ...series.filter((q) => q.axis === "left" && q.kind !== "stack").flatMap((q) => q.v.filter((v) => v != null))));
    const maxR = niceMax(Math.max(0, ...series.filter((q) => q.axis === "right").flatMap((q) => q.v.filter((v) => v != null))));
    const y = (v, q) => pt + ih * (1 - v / (q.axis === "left" ? maxL : maxR));
    let g = axisY(pl, pt, ih, maxL, false, W, series.some((q) => q.axis === "left" && q.kind === "bar") ? COLORS[0] : MUTED);
    if (series.some((q) => q.axis === "right")) g += axisY(pl, pt, ih, maxR, true, W, COLORS[1]);
    const lab = (k) => m.lab(L, k);
    if (stacked.length) ax.ticks.forEach((k, i) => {
      let base = 0;
      stacked.forEach((q) => { const v = q.v[i] || 0; if (!v) return; const y1 = y(base + v, q), y0 = y(base, q); g += `<rect x="${x(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${q.color}" opacity=".88"><title>${esc(lab(k))}: ${esc(q.name)} ${esc(fmt(v))}（計 ${esc(fmt(tops[i]))}）</title></rect>`; base += v; });
    });
    series.filter((q) => q.kind === "bar").forEach((q) => { q.v.forEach((v, i) => { if (v) g += `<rect x="${x(i) - bw / 2}" y="${y(v, q)}" width="${bw}" height="${Math.max(0, pt + ih - y(v, q))}" fill="${q.color}" opacity=".82"><title>${esc(lab(ax.ticks[i]))}: ${esc(q.name)} ${esc(fmt(v))}</title></rect>`; }); });
    series.filter((q) => q.kind === "line").forEach((q) => {
      let path = "", pen = false;
      q.v.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v, q).toFixed(1)}`; pen = true; });
      g += `<path d="${path}" fill="none" stroke="${q.color}" stroke-width="2.2"/>`;
      if (n <= 120) q.v.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v, q)}" r="2.8" fill="#fff" stroke="${q.color}" stroke-width="1.8"><title>${esc(lab(ax.ticks[i]))}: ${esc(q.name)} ${esc(fmt(v))}</title></circle>`; });
    });
    const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / (ax.cat ? 90 : 70)))));
    ax.ticks.forEach((k, i) => { if (i % every === 0) g += `<text x="${x(i)}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(ax.cat ? clip(lab(k), 12) : tickText(k, ax.part))}</text>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    // 月の境目（月で区切ったとき）: 月が替わる所に縦の点線、月の真ん中の上に「2026年9月」
    if (months) {
      let from = 0;
      ax.ticks.forEach((k, i) => {
        if (!(i === n - 1 || ax.ticks[i + 1].slice(0, 7) !== k.slice(0, 7))) return;
        if (i < n - 1) { const xb = (x(i) + x(i + 1)) / 2; g += `<line x1="${xb}" x2="${xb}" y1="${pt - 18}" y2="${pt + ih}" class="pv-msep"/>`; }
        const name = `${+k.slice(0, 4)}年${+k.slice(5, 7)}月`, half = name.length * 6;     // 月の名前は描く所（左右の目盛りの内側）に収める
        g += `<text x="${Math.min(W - pr - half, Math.max(pl + half, (x(from) + x(i)) / 2))}" y="${pt - 8}" text-anchor="middle" class="pv-mname">${esc(name)}</text>`;
        from = i + 1;
      });
    }
    let thin = 1;
    if (s.labels) {
      const lead = stacked.length ? { v: tops, y: (v) => y(v, stacked[0]) } : series[0] ? { v: series[0].v, y: (v) => y(v, series[0]) } : null;
      if (lead) {
        thin = thinOf(lead.v, iw / Math.max(n, 1));
        lead.v.forEach((v, i) => { if (v && i % thin === 0) g += `<text x="${x(i)}" y="${lead.y(v) - 5}" text-anchor="middle" class="pv-vl">${esc(short(v))}</text>`; });
      }
    }
    const legend = legendHtml(series.map((q) => [q.name + (series.some((r) => r.axis === "right") ? (q.axis === "left" ? "（左）" : "（右）") : ""), q.color, q.kind === "line" ? "line" : "bar"]))
      + `<small class="pv-cnote">${n} 刻み・${esc(ctx.dimName(d.dims.rows[L]))}${m.nr > L + 1 ? "（上の段の小計で描きます）" : ""}${thin > 1 ? `・数値は ${thin} 本おき${s.month ? "" : "（月を選ぶと全部出ます）"}` : ""}</small>`;
    return { svg: svgOf(W, H, g, lines ? "折れ線グラフ" : "時系列のグラフ"), legend };
  }
  /** 管理図（I 管理図・個々の値）: 行の葉を並びのまま点にし、中心線＝平均、管理限界＝平均 ± 3σ（σ＝隣どうしの差〈移動範囲〉の平均 ÷ 1.128）。
      限界の外の点は赤、中心線の同じ側に 9 点以上続く所（連）は橙（JIS Z 9020-2 の判定ルール 1・2） */
  function controlChart(ctx) {
    const { m, d, s, W, H } = ctx, j = chartAt(ctx);
    const pts = dataRows(m).map((r) => ({ r, v: m.value(r, ALL, j) })).filter((p) => p.v != null);
    if (pts.length < 3) return empty("管理図は、点（行の葉）が 3 つ以上あるときに描けます。行に日付・作業日・ロット番号などの順の段を入れてください。");
    const vs = pts.map((p) => p.v), n = vs.length, mean = vs.reduce((a, b) => a + b, 0) / n;
    const mr = vs.slice(1).reduce((a, v, i) => a + Math.abs(v - vs[i]), 0) / (n - 1), sigma = mr / 1.128;
    const ucl = mean + 3 * sigma, lcl = mean - 3 * sigma;
    // 判定: 限界の外（ルール 1）・中心線の同じ側に 9 点以上（ルール 2）
    const out = vs.map((v) => v > ucl || v < lcl), run = new Array(n).fill(false);
    for (let i = 0, k = 0; i < n; i = k) {
      const side = Math.sign(vs[i] - mean); k = i + 1;
      while (k < n && side !== 0 && Math.sign(vs[k] - mean) === side) k++;
      if (side !== 0 && k - i >= 9) for (let t = i; t < k; t++) run[t] = true;
    }
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 60, 44), pr = pad(ctx, 64, 56), pt = 14, pb = pad(ctx, 40, 26), iw = w - pl - pr, ih = H - pt - pb;
    const r = niceRange(Math.min(lcl, ...vs), Math.max(ucl, ...vs));
    const y = (v) => pt + ih * (1 - (v - r.lo) / (r.hi - r.lo)), x = (i) => pl + iw * (i + 0.5) / n;
    let g = axisRange(r, pl, w - pr, y);
    const hline = (v, cls, name) => `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" class="${cls}"/><text x="${w - pr + 4}" y="${y(v) + 4}" class="pv-ax ${cls}-t">${name} ${esc(short(v))}</text>`;
    g += hline(ucl, "pv-lim", "UCL") + hline(mean, "pv-cl", "CL") + (lcl > r.lo - 1e-9 ? hline(lcl, "pv-lim", "LCL") : "");
    g += `<path d="${vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="${COLORS[2]}" stroke-width="1.8"/>`;
    vs.forEach((v, i) => { const c = out[i] ? ALERT : run[i] ? WARN : COLORS[2]; g += `<circle cx="${x(i)}" cy="${y(v)}" r="${out[i] || run[i] ? 4.2 : 3}" fill="${out[i] || run[i] ? c : "#fff"}" stroke="${c}" stroke-width="1.8"><title>${esc(m.rowName(pts[i].r))}: ${esc(fmt(v))}${out[i] ? "（管理限界の外）" : run[i] ? "（中心線の同じ側に 9 点以上）" : ""}</title></circle>`; });
    if (s.labels) { const thin = thinOf(vs, iw / n); vs.forEach((v, i) => { if (i % thin === 0) g += `<text x="${x(i)}" y="${y(v) - 7}" text-anchor="middle" class="pv-vl">${esc(short(v))}</text>`; }); }
    const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / 80))));
    pts.forEach((p, i) => { if (i % every === 0) g += `<text x="${x(i)}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(clip(tickLabel(m, d, p.r), 12))}</text>`; });
    g += `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const nOut = out.filter(Boolean).length, nRun = run.filter(Boolean).length;
    const side = statsBox(`${ctx.measName(d.measures[j])} の管理図`, [["点の数", n], ["中心線（平均）", mean], ["UCL（＋3σ）", ucl], ["LCL（−3σ）", lcl], ["σ（移動範囲から）", sigma],
      ["管理限界の外", `${nOut} 点`, nOut ? "is-alert" : ""], ["同じ側に 9 点以上", `${nRun} 点`, nRun ? "is-warn" : ""]],
    "I 管理図: σ＝隣どうしの差の平均 ÷ 1.128。赤＝限界の外、橙＝中心線の同じ側に 9 点以上続く所");
    return { svg: svgOf(w, H, g, "管理図"), legend: legendHtml([[ctx.measName(d.measures[j]), COLORS[2], "line"], ["管理限界（±3σ）", ALERT, "line"]]), side };
  }
  /** 行の葉の横の字（時の段なら短く 6/4、そうでなければ行の名前） */
  const tickLabel = (m, d, r) => { const L = r.path.length - 1, x = d.dims.rows[L]; return x && isTimeDim(x) ? tickText(r.path[L], x.column === "@workday" ? ({ ym: "ym", year: "year" }[x.part] || "date") : x.part) : m.rowName(r); };

  /* ================= 比べる ================= */
  /** 縦棒・横棒: 行の葉ごとに、列の葉（1 つ目の値）か値（グラフにする値を選ぶ）の棒 */
  function barChart(ctx, dir, wanted) {
    const { m, d, s, W, H } = ctx, data = dataRows(m).slice(0, 80), colsData = dataCols(m), j = chartAt(ctx);
    const series = m.nc ? colsData.map((c, k) => ({ name: m.colName(c), c, j, color: COLORS[k % COLORS.length] })) : [{ name: ctx.measName(d.measures[j]), c: ALL, j, color: COLORS[j % COLORS.length] }];
    const vals = data.map((r) => series.map((q) => m.value(r, q.c, q.j) || 0));
    const max = niceMax(Math.max(0, ...vals.flat()));
    let g = "";
    if (dir === "column") {
      // 詰めた形で名前が 1 本の幅に入らない（隣とくっついて読める）ときは、斜めに書く
      const gw0 = (W - pad(ctx, 60, 44) - pad(ctx, 20, 10)) / Math.max(data.length, 1);
      const tilt = !!ctx.compact && data.some((r) => m.rowName(r).length * 12 + 6 > gw0);
      const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = s.labels ? 22 : 12, pb = tilt ? 48 : pad(ctx, 56, 30), iw = W - pl - pr, ih = H - pt - pb, gw = iw / Math.max(data.length, 1), bw = Math.max(2, Math.min(36, gw * 0.8 / series.length));
      g += axisY(pl, pt, ih, max, false, W + 36);
      const thin = thinOf(vals.flat(), bw);
      data.forEach((r, i) => {
        series.forEach((q, k) => {
          const v = vals[i][k], h = ih * v / max, bx = pl + gw * i + (gw - bw * series.length) / 2 + bw * k;
          g += `<rect x="${bx}" y="${pt + ih - h}" width="${bw}" height="${h}" fill="${ctx.rowColor && series.length === 1 ? ctx.rowColor(m.rowName(r)) : q.color}"><title>${esc(m.rowName(r))}${series.length > 1 ? ` / ${esc(q.name)}` : ""}: ${esc(fmt(v))}</title></rect>`;
          if (s.labels && v && (i * series.length + k) % thin === 0) g += `<text x="${bx + bw / 2}" y="${pt + ih - h - 4}" text-anchor="middle" class="pv-vl">${esc(short(v))}</text>`;
        });
        g += tilt ? `<text transform="translate(${pl + gw * (i + 0.5) + 4},${H - pb + 12}) rotate(-35)" text-anchor="end" class="pv-ax">${esc(clip(m.rowName(r), 8))}</text>`
          : `<text x="${pl + gw * (i + 0.5)}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(clip(m.rowName(r), Math.max(4, Math.floor(gw / 8))))}</text>`;
      });
      g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    } else {
      // 詰めた形: 名前の字の幅（いちばん長い名前。幅の 4 割まで）だけ左を空ける
      const longest = Math.max(2, ...data.map((r) => Math.min(20, m.rowName(r).length)));
      const pl = ctx.compact ? Math.round(Math.max(44, Math.min(W * 0.4, longest * 12.5 + 12))) : 160, pr = pad(ctx, 70, 52), pt = pad(ctx, 8, 4);
      const rh = (H - pad(ctx, 30, 8)) / Math.max(data.length, 1), bh = Math.max(3, Math.min(18, rh * 0.75 / series.length)), iw = W - pl - pr;
      const cut = ctx.compact ? Math.max(3, Math.floor((pl - 10) / 12.5)) : 20;
      data.forEach((r, i) => {
        g += `<text x="${pl - 8}" y="${pt + rh * (i + 0.5) + 4}" text-anchor="end" class="pv-ax">${esc(clip(m.rowName(r), cut))}</text>`;
        series.forEach((q, k) => { const v = vals[i][k], w = iw * v / max, by = pt + rh * i + (rh - bh * series.length) / 2 + bh * k; g += `<rect x="${pl}" y="${by}" width="${w}" height="${bh}" fill="${ctx.rowColor && series.length === 1 ? ctx.rowColor(m.rowName(r)) : q.color}"><title>${esc(m.rowName(r))}${series.length > 1 ? ` / ${esc(q.name)}` : ""}: ${esc(fmt(v))}</title></rect>`
          + (series.length === 1 || s.labels ? `<text x="${pl + w + 6}" y="${by + bh - 2}" class="${s.labels ? "pv-vl" : "pv-ax"}">${esc(fmt(v))}</text>` : ""); });
      });
    }
    const note = (wanted ? '<small class="pv-cnote">時系列は、行の 1 段目が日付（年月日・年月・年）か作業日のときに描けます。いまは棒で出しています</small>' : "")
      + (dataRows(m).length > 80 ? '<small class="pv-cnote">先頭 80 件まで描いています</small>' : "");
    return { svg: svgOf(W, H, g, "棒グラフ"), legend: legendHtml(series.map((q) => [q.name, q.color, "bar"])) + note };
  }
  /** パレート図: 行の葉を値の大きい順に並べた棒と、累積の割合の折れ線（右の目盛り 0〜100%）・80% の線。
      描き切れない分（下位）は「その他」にまとめて最後に（足し上げる値のときだけ。平均などは足せないので先頭だけ） */
  function paretoChart(ctx) {
    const { m, d, s, W, H } = ctx, j = chartAt(ctx), add = ADDITIVE.has(d.measures[j].agg);
    let items = dataRows(m).map((r) => ({ name: m.rowName(r), v: m.value(r, ALL, j) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (!items.length) return empty("パレート図にできる値（0 より大きい値）がありません。");
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 56, 44), pt = s.labels ? 24 : 14, pb = pad(ctx, 56, 30), iw = W - pl - pr, ih = H - pt - pb;
    const K = Math.min(items.length, Math.max(5, Math.min(30, Math.floor(iw / 38))));
    const total = items.reduce((a, x) => a + x.v, 0);
    if (items.length > K) items = add ? items.slice(0, K - 1).concat([{ name: `その他（${items.length - K + 1} 件）`, v: items.slice(K - 1).reduce((a, x) => a + x.v, 0), rest: true }]) : items.slice(0, K);
    let cum = 0;
    items.forEach((x) => { cum += x.v; x.cum = cum / total; });
    const max = niceMax(items[0].v), n = items.length, gw = iw / n, bw = Math.max(4, Math.min(48, gw * 0.78));
    const y = (v) => pt + ih * (1 - v / max), yp = (p) => pt + ih * (1 - p);
    let g = axisY(pl, pt, ih, max, false, W - pr + 56, COLORS[0]);
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => { g += `<text x="${W - pr + 6}" y="${yp(f) + 4}" class="pv-ax" fill="${COLORS[1]}">${f * 100}%</text>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${yp(0.8)}" y2="${yp(0.8)}" class="pv-p80"/><text x="${W - pr - 4}" y="${yp(0.8) - 4}" text-anchor="end" class="pv-ax pv-p80-t">80%</text>`;
    const k80 = items.findIndex((x) => x.cum >= 0.8 - 1e-9);
    items.forEach((x, i) => {
      const cx = pl + gw * (i + 0.5);
      g += `<rect x="${cx - bw / 2}" y="${y(x.v)}" width="${bw}" height="${pt + ih - y(x.v)}" fill="${x.rest ? "#a9b4be" : COLORS[0]}" opacity="${i <= k80 || x.rest ? 1 : 0.55}"><title>${esc(x.name)}: ${esc(fmt(x.v))}（${pct(x.v / total)}・累積 ${pct(x.cum)}）</title></rect>`;
      g += `<text x="${cx}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(clip(x.name, Math.max(3, Math.floor(gw / 8))))}</text>`;
      if (s.labels) g += `<text x="${cx}" y="${y(x.v) - 5}" text-anchor="middle" class="pv-vl">${esc(short(x.v))}</text>`;
    });
    g += `<path d="${items.map((x, i) => `${i ? "L" : "M"}${(pl + gw * (i + 0.5)).toFixed(1)},${yp(x.cum).toFixed(1)}`).join("")}" fill="none" stroke="${COLORS[1]}" stroke-width="2.2"/>`;
    items.forEach((x, i) => { g += `<circle cx="${pl + gw * (i + 0.5)}" cy="${yp(x.cum)}" r="3" fill="#fff" stroke="${COLORS[1]}" stroke-width="1.8"><title>累積 ${pct(x.cum)}</title></circle>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const note = `<small class="pv-cnote">大きい順・上位 ${k80 + 1} 件で ${pct(items[k80].cum)}（濃い棒）${add ? "" : "・平均などは足せないので、その他にまとめません"}</small>`;
    return { svg: svgOf(W, H, g, "パレート図"), legend: legendHtml([[ctx.measName(d.measures[j]), COLORS[0], "bar"], ["累積の割合（右）", COLORS[1], "line"]]) + note };
  }

  /* ================= 内訳を見る ================= */
  /** 積み上げ縦棒・100% 積み上げ: 行の葉ごとの棒を、列の葉（1 つ目の値）か値（足し上げる値が 2 つ以上）で積む。列が 12 を超えたら残りを「その他」に */
  function stackChart(ctx, share) {
    const { m, d, s, W, H } = ctx, data = dataRows(m).slice(0, 60), j = chartAt(ctx);
    let series;
    if (m.nc) {
      const cs = m.cols.filter((c) => c.type === "data");
      series = cs.slice(0, 12).map((c, k) => ({ name: m.colName(c), get: (r) => m.value(r, c, j) || 0, color: COLORS[k % COLORS.length] }));
      if (cs.length > 12) series.push({ name: `その他（${cs.length - 12}）`, get: (r) => cs.slice(12).reduce((a, c) => a + (m.value(r, c, j) || 0), 0), color: "#a9b4be" });
    } else {
      const ms = d.measures.map((x, k) => [x, k]).filter(([x]) => ADDITIVE.has(x.agg));
      series = (ms.length > 1 ? ms : [[d.measures[j], j]]).map(([x, k], i) => ({ name: ctx.measName(x), get: (r) => m.value(r, ALL, k) || 0, color: COLORS[i % COLORS.length] }));
    }
    const vals = data.map((r) => series.map((q) => Math.max(0, q.get(r)))), tops = vals.map((v) => v.reduce((a, b) => a + b, 0));
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = s.labels ? 22 : 12, pb = pad(ctx, 56, 30), iw = W - pl - pr, ih = H - pt - pb, gw = iw / Math.max(data.length, 1), bw = Math.max(4, Math.min(56, gw * 0.72));
    const max = share ? 1 : niceMax(Math.max(0, ...tops));
    let g = axisY(pl, pt, ih, max, false, W + 36, MUTED, share ? (v) => `${Math.round(v * 100)}%` : short);
    data.forEach((r, i) => {
      let base = 0;
      const cx = pl + gw * (i + 0.5), sum = tops[i] || 1;
      series.forEach((q, k) => {
        const raw = vals[i][k], v = share ? raw / sum : raw; if (!raw) return;
        const y1 = pt + ih * (1 - (base + v) / max), y0 = pt + ih * (1 - base / max);
        g += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${q.color}" opacity=".9"><title>${esc(m.rowName(r))} / ${esc(q.name)}: ${esc(fmt(raw))}（${pct(raw / sum)}）</title></rect>`;
        if (s.labels && share && y0 - y1 >= 14 && bw >= 30) g += `<text x="${cx}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle" class="pv-vl">${pct(raw / sum)}</text>`;
        base += v;
      });
      if (s.labels && !share && tops[i]) g += `<text x="${cx}" y="${pt + ih * (1 - tops[i] / max) - 4}" text-anchor="middle" class="pv-vl">${esc(short(tops[i]))}</text>`;
      g += `<text x="${cx}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(clip(m.rowName(r), Math.max(4, Math.floor(gw / 8))))}</text>`;
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const note = (series.length < 2 ? `<small class="pv-cnote">内訳を積むには、［列］に段を入れるか、足し上げる値（件数・ロット数・合計）を 2 つ以上にしてください</small>` : "")
      + (dataRows(m).length > 60 ? '<small class="pv-cnote">先頭 60 件まで描いています</small>' : "");
    return { svg: svgOf(W, H, g, share ? "100% 積み上げ棒グラフ" : "積み上げ棒グラフ"), legend: legendHtml(series.map((q) => [q.name, q.color, "bar"])) + note };
  }
  /** ドーナツ: 行の葉の割合（グラフにする値・列は全体）。大きい順に 9 つ＋その他。真ん中に合計 */
  function donutChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx);
    if (!ADDITIVE.has(d.measures[j].agg)) return empty("ドーナツ（内訳）は、足し上げる値（件数・ロット数・合計）で描けます。平均・最小・最大は割合にできません。");
    let items = dataRows(m).map((r) => ({ name: m.rowName(r), v: m.value(r, ALL, j) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (!items.length) return empty("割合にできる値（0 より大きい値）がありません。");
    const total = items.reduce((a, x) => a + x.v, 0);
    if (items.length > 10) items = items.slice(0, 9).concat([{ name: `その他（${items.length - 9} 件）`, v: items.slice(9).reduce((a, x) => a + x.v, 0), rest: true }]);
    const R = ctx.compact ? Math.max(20, Math.min(H / 2 - 6, W / 2 - 8, 160)) : Math.min(H / 2 - 12, 140), r0 = R * 0.58, cx = R + pad(ctx, 24, 8), cy = H / 2, w = cx + R + pad(ctx, 24, 8);
    let a = -Math.PI / 2, g = "";
    items.forEach((x, i) => {
      x.color = x.rest ? "#a9b4be" : ctx.rowColor ? ctx.rowColor(x.name) : COLORS[i % COLORS.length];
      const da = (x.v / total) * Math.PI * 2, b = a + da, big = da > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
      const path = items.length === 1 ? `M${p(R, 0)}A${R},${R} 0 1 1 ${p(R, Math.PI)}A${R},${R} 0 1 1 ${p(R, 0)}M${p(r0, 0)}A${r0},${r0} 0 1 0 ${p(r0, Math.PI)}A${r0},${r0} 0 1 0 ${p(r0, 0)}Z`
        : `M${p(R, a)}A${R},${R} 0 ${big} 1 ${p(R, b)}L${p(r0, b)}A${r0},${r0} 0 ${big} 0 ${p(r0, a)}Z`;
      g += `<path d="${path}" fill="${x.color}" stroke="#fff" stroke-width="1.5" fill-rule="evenodd"><title>${esc(x.name)}: ${esc(fmt(x.v))}（${pct(x.v / total)}）</title></path>`;
      if (da > 0.32) { const mid = (a + b) / 2, rr = (R + r0) / 2; g += `<text x="${cx + rr * Math.cos(mid)}" y="${cy + rr * Math.sin(mid) + 4}" text-anchor="middle" class="pv-dl">${pct(x.v / total)}</text>`; }
      a = b;
    });
    g += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="pv-dtot">${esc(short(total))}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="pv-ax">${esc(clip(ctx.measName(d.measures[j]), 14))}の計</text>`;
    const side = `<div class="pv-dlist">${items.map((x) => `<div><i style="--c:${x.color}"></i><span title="${esc(x.name)}">${esc(x.name)}</span><b>${esc(fmt(x.v))}</b><small>${pct(x.v / total)}</small></div>`).join("")}</div>`;
    return { svg: svgOf(w, H, g, "ドーナツグラフ"), legend: `<small class="pv-cnote">大きい順${items.some((x) => x.rest) ? "・10 位から下は「その他」" : ""}・合計 ${esc(fmt(total))}</small>`, side };
  }

  /* ================= ばらつきを見る ================= */
  /** ヒストグラム: 行の 1 段目が区間の列のとき。区間の幅を変えられ、横に傾向の数（平均・ばらつき・四分位） */
  function histChart(ctx) {
    const { m, d, s, W, H } = ctx, b = (d.bins || [])[0], x0 = d.dims.rows[0];
    if (!b || !x0 || x0.part !== "bin") return empty("ヒストグラムは、行の 1 段目を数のカラムの「区間」にすると描けます（グラフの形でヒストグラムを選ぶか、数のカラムの［行］を押して、まとめ方を「区間」に）。");
    const data = m.rows.filter((r) => r.type === "data" && r.path[0] !== "");
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 56, 44), pr = 16, pt = s.labels ? 22 : 12, pb = pad(ctx, 44, 28), iw = w - pl - pr, ih = H - pt - pb;
    const lo = b.origin, nb = Math.max(1, Math.round((b.max - lo) / b.width) + 1);
    const counts = new Array(nb).fill(0);
    data.forEach((r) => { const k = Math.round((Number(r.path[0]) - lo) / b.width); if (k >= 0 && k < nb) counts[k] = m.value(r, m.cols[m.cols.length - 1], 0) || 0; });
    const max = niceMax(Math.max(1, ...counts)), bw = iw / nb;
    let g = axisY(pl, pt, ih, max, false, w + 40);
    const thin = thinOf(counts, bw);
    counts.forEach((v, i) => {
      const h = ih * v / max;
      g += `<rect x="${pl + bw * i + 0.5}" y="${pt + ih - h}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${COLORS[2]}"><title>${esc(fmt(lo + b.width * i))}〜${esc(fmt(lo + b.width * (i + 1)))}: ${esc(fmt(v))}</title></rect>`;
      if (s.labels && v && i % thin === 0) g += `<text x="${pl + bw * (i + 0.5)}" y="${pt + ih - h - 4}" text-anchor="middle" class="pv-vl">${esc(short(v))}</text>`;
    });
    const every = Math.max(1, Math.ceil(nb / Math.max(4, Math.floor(iw / 60))));
    for (let i = 0; i <= nb; i += every) g += `<text x="${pl + bw * i}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(short(lo + b.width * i))}</text>`;
    const st0 = (d.stats || {})[b.column];
    if (st0 && st0.n) {   // 平均（縦の点線）と ±1σ の帯
      const xv = (v) => pl + iw * (v - lo) / (b.width * nb);
      g += `<rect x="${xv(st0.mean - st0.sd)}" y="${pt}" width="${Math.max(0, xv(st0.mean + st0.sd) - xv(st0.mean - st0.sd))}" height="${ih}" fill="#2f7d78" opacity=".08"/>`
        + `<line x1="${xv(st0.mean)}" x2="${xv(st0.mean)}" y1="${pt}" y2="${pt + ih}" stroke="#2f7d78" stroke-width="2" stroke-dasharray="4 3"><title>平均 ${esc(fmt(st0.mean))}</title></line>`;
    }
    g += `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const row = (k, v) => `<tr><th>${k}</th><td>${esc(fmt(v))}</td></tr>`;
    const side = `<div class="pv-stats"><b>${esc(ctx.label(b.column))} の傾向</b>`
      + (st0 ? `<table>${row("件数", st0.n)}${row("平均", st0.mean)}${row("標準偏差", st0.sd)}${row("最小", st0.min)}${row("25%", st0.q1)}${row("中央値", st0.median)}${row("75%", st0.q3)}${row("最大", st0.max)}</table>` : "<p>数に読める値がありません</p>")
      + `<label class="pv-binw">区間の幅<input type="number" min="0" step="any" value="${b.width}" data-pv-binw aria-label="区間の幅"><small>${b.auto ? "自動で決めた幅" : "決めた幅"}</small></label>`
      + `<button type="button" class="pv-link" data-pv-binauto${b.auto ? " disabled" : ""}>幅を自動に戻す</button>`
      + '<small class="pv-cnote">緑の点線は平均、淡い帯は平均±標準偏差</small></div>';
    return { svg: svgOf(w, H, g, "ヒストグラム"), legend: "", side };
  }
  /** 箱ひげ図: 行の葉ごとの数の列の分かれ方（サーバーの boxes: 四分位・ひげ・外れ値）。箱＝25〜75%・太線＝中央値・◆＝平均 */
  function boxChart(ctx) {
    const { m, d, s, W, H } = ctx;
    if (!d.box) return empty("箱ひげ図は、値に数のカラム（平均など）を入れると、行の段ごとのその数の分かれ方を描けます。");
    const byKey = new Map((d.boxes || []).map((b) => [b.r.join(SEP), b]));
    const items = dataRows(m).map((r) => ({ name: m.rowName(r), b: byKey.get(r.path.join(SEP)) })).filter((x) => x.b).slice(0, 40);
    if (!items.length) return empty(`「${esc(ctx.label(d.box))}」に数に読める値がありません。`);
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = s.labels ? 20 : 12, pb = pad(ctx, 56, 30), iw = W - pl - pr, ih = H - pt - pb, gw = iw / items.length, bw = Math.max(8, Math.min(46, gw * 0.55));
    const r = niceRange(Math.min(...items.map((x) => Math.min(x.b.lo, ...x.b.out))), Math.max(...items.map((x) => Math.max(x.b.hi, ...x.b.out))));
    const y = (v) => pt + ih * (1 - (v - r.lo) / (r.hi - r.lo));
    let g = axisRange(r, pl, W - pr, y);
    items.forEach((x, i) => {
      const b = x.b, cx = pl + gw * (i + 0.5), tip = `${x.name}（${b.n} 件）\n最大 ${fmt(b.max)} / 75% ${fmt(b.q3)} / 中央値 ${fmt(b.median)} / 25% ${fmt(b.q1)} / 最小 ${fmt(b.min)} / 平均 ${fmt(b.mean)}${b.outN ? ` / 外れ値 ${b.outN} 件` : ""}`;
      g += `<g><title>${esc(tip)}</title><line x1="${cx}" x2="${cx}" y1="${y(b.hi)}" y2="${y(b.q3)}" class="pv-wh"/><line x1="${cx}" x2="${cx}" y1="${y(b.q1)}" y2="${y(b.lo)}" class="pv-wh"/>`
        + `<line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${y(b.hi)}" y2="${y(b.hi)}" class="pv-wh"/><line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${y(b.lo)}" y2="${y(b.lo)}" class="pv-wh"/>`
        + `<rect x="${cx - bw / 2}" y="${y(b.q3)}" width="${bw}" height="${Math.max(1, y(b.q1) - y(b.q3))}" fill="${COLORS[2]}" fill-opacity=".18" stroke="${COLORS[2]}" stroke-width="1.5" rx="2"/>`
        + `<line x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${y(b.median)}" y2="${y(b.median)}" stroke="${COLORS[2]}" stroke-width="3"/>`
        + `<path d="M${cx},${y(b.mean) - 4.5}l4.5,4.5l-4.5,4.5l-4.5,-4.5z" fill="${COLORS[0]}"/></g>`;
      b.out.forEach((v) => { g += `<circle cx="${cx}" cy="${y(v)}" r="2.6" fill="#fff" stroke="${ALERT}" stroke-width="1.4"><title>${esc(x.name)}: 外れ値 ${esc(fmt(v))}</title></circle>`; });
      if (s.labels) g += `<text x="${cx + bw / 2 + 3}" y="${y(b.median) + 4}" class="pv-vl">${esc(short(b.median))}</text>`;
      g += `<text x="${cx}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(clip(x.name, Math.max(4, Math.floor(gw / 8))))}</text>`;
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    return { svg: svgOf(W, H, g, "箱ひげ図"), legend: `<span class="pv-legend"><span><b>${esc(ctx.label(d.box))}</b> の分かれ方</span></span><small class="pv-cnote">箱＝25〜75%・太線＝中央値・◆＝平均・ひげ＝箱の幅の 1.5 倍の内側の端・○＝外れ値${dataRows(m).length > 40 ? "・先頭 40 件まで" : ""}</small>` };
  }

  /* ================= 関係を見る ================= */
  /** ヒートマップ: 行の葉 × 列の葉の値（グラフにする値）を色の濃さで。字が入る幅なら数も */
  function heatChart(ctx) {
    const { m, d, s, W } = ctx, j = chartAt(ctx), rows = dataRows(m).slice(0, 80), cols = m.nc ? m.cols.filter((c) => c.type === "data").slice(0, 40) : [ALL];
    const vals = rows.map((r) => cols.map((c) => m.value(r, c, j)));
    const flat = vals.flat().filter((v) => v != null), lo = Math.min(0, ...flat), hi = Math.max(...flat, lo + 1e-9);
    // 詰めた形: 名前の字の幅だけ左を空け、行の高さをパネルの高さで割る（パネルに収める）
    const longest = Math.max(2, ...rows.map((r) => Math.min(22, m.rowName(r).length)));
    const pl = ctx.compact ? Math.round(Math.max(40, Math.min(W * 0.35, longest * 12.5 + 12))) : 170, pt = ctx.compact ? 26 : 46;
    const cw = Math.max(ctx.compact ? 14 : 18, Math.min(88, (W - pl - 10) / cols.length));
    const ch = ctx.compact ? Math.max(10, Math.min(30, (ctx.H - pt - 6) / Math.max(rows.length, 1))) : rows.length > 40 ? 18 : 24;
    const H = ctx.compact ? ctx.H : pt + ch * rows.length + 8, w = pl + cw * cols.length + 10;
    const color = (v) => { const t = (v - lo) / (hi - lo); return `hsl(174 ${Math.round(30 + 32 * t)}% ${Math.round(96 - 66 * t)}%)`; };
    let g = "";
    cols.forEach((c, k) => {
      const name = m.nc ? m.colName(c) : ctx.measName(d.measures[j]), cx = pl + cw * (k + 0.5);
      g += cw < 46 ? `<text transform="translate(${cx + 3},${pt - 6}) rotate(-45)" class="pv-ax">${esc(clip(name, 10))}</text>` : `<text x="${cx}" y="${pt - 8}" text-anchor="middle" class="pv-ax">${esc(clip(name, Math.floor(cw / 7)))}</text>`;
    });
    rows.forEach((r, i) => {
      const y0 = pt + ch * i;
      g += `<text x="${pl - 8}" y="${y0 + ch / 2 + 4}" text-anchor="end" class="pv-ax">${esc(clip(m.rowName(r), ctx.compact ? Math.max(3, Math.floor((pl - 10) / 12.5)) : 22))}</text>`;
      cols.forEach((c, k) => {
        const v = vals[i][k], x0 = pl + cw * k, t = v == null ? 0 : (v - lo) / (hi - lo);
        g += `<rect x="${x0 + 0.5}" y="${y0 + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="2" fill="${v == null ? "#f3f5f7" : color(v)}"><title>${esc(m.rowName(r))}${m.nc ? ` / ${esc(m.colName(c))}` : ""}: ${esc(v == null ? "なし" : fmt(v))}</title></rect>`;
        if (v != null && (s.labels || cw >= 40) && cw >= 30 && ch >= 14) g += `<text x="${x0 + cw / 2}" y="${y0 + ch / 2 + 4}" text-anchor="middle" class="pv-hv${t > 0.55 ? " is-dark" : ""}">${esc(short(v))}</text>`;
      });
    });
    const legend = `<span class="pv-legend"><span>${esc(ctx.measName(d.measures[j]))}</span><span class="pv-ramp" style="--a:${color(lo)};--b:${color(hi)}"><small>${esc(short(lo))}</small><i></i><small>${esc(short(hi))}</small></span></span>`
      + (m.nc ? "" : '<small class="pv-cnote">［列］に段を入れると、行×列の表になります</small>') + (dataRows(m).length > 80 ? '<small class="pv-cnote">先頭 80 行まで描いています</small>' : "");
    return { svg: svgOf(w, H, g, "ヒートマップ"), legend };
  }
  /** 散布図: 行の葉ごとに、1 つ目の値を横・2 つ目の値を縦にした点。最小二乗の直線と相関係数 */
  function scatterChart(ctx) {
    const { m, d, s, W, H } = ctx;
    if (d.measures.length < 2) return empty("散布図は、値を 2 つ入れると描けます（1 つ目＝横・2 つ目＝縦。行の葉ごとに 1 点）。");
    const pts = dataRows(m).map((r) => ({ r, x: m.value(r, ALL, 0), y: m.value(r, ALL, 1) })).filter((p) => p.x != null && p.y != null);
    if (pts.length < 2) return empty("両方の値がある点が 2 つ未満です。");
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 64, 48), pr = 18, pt = 14, pb = pad(ctx, 48, 30), iw = w - pl - pr, ih = H - pt - pb;
    const rx = niceRange(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))), ry = niceRange(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)));
    const X = (v) => pl + iw * (v - rx.lo) / (rx.hi - rx.lo), Y = (v) => pt + ih * (1 - (v - ry.lo) / (ry.hi - ry.lo));
    let g = axisRange(ry, pl, w - pr, Y);
    rx.ticks.forEach((t) => { g += `<line x1="${X(t)}" x2="${X(t)}" y1="${pt}" y2="${pt + ih}" class="pv-grid"/><text x="${X(t)}" y="${pt + ih + 16}" text-anchor="middle" class="pv-ax">${esc(short(t))}</text>`; });
    const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0), syy = pts.reduce((a, p) => a + (p.y - my) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
    const slope = sxx ? sxy / sxx : 0, icpt = my - slope * mx, r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    pts.forEach((p) => { g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.4" fill="${COLORS[2]}" fill-opacity=".55" stroke="${COLORS[2]}" stroke-width="1"><title>${esc(m.rowName(p.r))}: ${esc(fmt(p.x))}, ${esc(fmt(p.y))}</title></circle>`; });
    if (s.labels && n <= 60) pts.forEach((p) => { g += `<text x="${X(p.x) + 5}" y="${Y(p.y) - 5}" class="pv-vl">${esc(clip(m.rowName(p.r), 10))}</text>`; });
    if (sxx && n >= 3) {
      const ya = Math.max(ry.lo, Math.min(ry.hi, icpt + slope * rx.lo)), yb = Math.max(ry.lo, Math.min(ry.hi, icpt + slope * rx.hi));
      const xa = slope ? (ya - icpt) / slope : rx.lo, xb = slope ? (yb - icpt) / slope : rx.hi;
      g += `<line x1="${X(xa)}" y1="${Y(ya)}" x2="${X(xb)}" y2="${Y(yb)}" stroke="${ALERT}" stroke-width="1.8" stroke-dasharray="6 4"><title>y = ${fmt(slope)} x ${icpt < 0 ? "−" : "＋"} ${fmt(Math.abs(icpt))}</title></line>`;
    }
    const xn = ctx.measName(d.measures[0]), yn = ctx.measName(d.measures[1]);
    g += `<text x="${pl + iw / 2}" y="${H - 8}" text-anchor="middle" class="pv-axn">${esc(xn)} →</text><text transform="translate(14,${pt + ih / 2}) rotate(-90)" text-anchor="middle" class="pv-axn">${esc(yn)} →</text>`;
    const strength = Math.abs(r) >= 0.7 ? "強い" : Math.abs(r) >= 0.4 ? "中くらいの" : Math.abs(r) >= 0.2 ? "弱い" : "ほとんど無い";
    const side = statsBox("関係の強さ", [["点の数", n], ["相関係数 r", Math.round(r * 1000) / 1000], ["R²", Math.round(r * r * 1000) / 1000], ["傾き", slope], ["切片", icpt]],
      `${strength}${Math.abs(r) >= 0.2 ? (r > 0 ? "正の" : "負の") : ""}相関。赤の点線は最小二乗の直線（1 点＝行の葉${dataRows(m).length > n ? `・値の無い ${dataRows(m).length - n} 点は除く` : ""}）`);
    return { svg: svgOf(w, H, g, "散布図"), legend: legendHtml([[`${xn} × ${yn}`, COLORS[2], "bar"]]), side };
  }

  /* ---- 登録（目的のまとまり → 形）。icon は 20×20 の絵（線の太さは CSS）。one＝グラフにする値を 1 つ選ぶ形 ----
     fit(f): いまの組み方に向くか（"" なら向く・字は向く組み方の説明）。f = {rows, cols, meas, numMeas, addMeas, additive, time, bin}（lotlist-pivot.js の fitInfo） */
  const GROUPS = [["trend", "推移を見る"], ["compare", "比べる・順位"], ["part", "内訳を見る"], ["dist", "ばらつきを見る"], ["rel", "関係を見る"], ["table", "表"]];
  const DEFS = [
    { k: "time", n: "時系列", g: "trend", tip: "日付・年月・作業日の段を、時の流れのまま（間の日も空けて）描きます。1 つ目の値は棒、2 つ目からは折れ線",
      icon: "M3 17h14M5 15v-4M8 15V8M11 15v-3M14 15V6M4 9l4-3 3 4 5-6", fit: (f) => (f.time ? "" : "行の 1 段目が日付・作業日のとき"), draw: (c) => (isTime(c.d) ? trendChart(c, false) : barChart(c, "column", true)) },
    { k: "line", n: "折れ線", g: "trend", tip: "値の移り変わりを線で描きます（列の段があれば列ごとの線）。平均などの比べにも",
      icon: "M3 15l4-5 3 3 4-6 3 3", fit: (f) => (f.time ? "" : "行の 1 段目が日付・作業日のとき（種類の段なら縦棒）"), draw: (c) => trendChart(c, true) },
    { k: "control", n: "管理図", g: "trend", one: true, tip: "並びのままの値に、中心線（平均）と管理限界（±3σ）を引き、外れた点・偏りを色で知らせます（I 管理図）",
      icon: "M3 5h14M3 15h14M3 10h14M4 11l3-3 3 4 3-5 3 3", fit: (f) => (f.time && !f.additive ? "" : "行が日付・作業日の段で、値が平均などのとき（ばらつきの管理）"), draw: controlChart },
    { k: "column", n: "縦棒", g: "compare", one: true, tip: "行の段ごとに縦の棒で比べます", icon: "M3 17h14M5 15V9M9 15V5M13 15v-4M16 15V8",
      fit: (f) => (f.rows && !f.time && !f.bin ? "" : "行が種類の段（設備・不良名など）のとき"), draw: (c) => barChart(c, "column", false) },
    { k: "bar", n: "横棒", g: "compare", one: true, tip: "行の段ごとに横の棒で比べます（名前が長いとき）", icon: "M3 3v14M3 5h10M3 9h14M3 13h6",
      fit: (f) => (f.rows && !f.time && !f.bin ? "" : "行が種類の段で、名前が長いとき"), draw: (c) => barChart(c, "bar", false) },
    { k: "pareto", n: "パレート図", g: "compare", one: true, tip: "大きい順の棒と累積の割合の線で、上位のどれだけで全体の 80% になるか（重点の項目）を見ます",
      icon: "M3 17h14M4 15V5M7 15V8M10 15v-4M13 15v-2M4 6c4-3 9-3 12-3", fit: (f) => (f.rows && !f.time && !f.bin && f.additive ? "" : "行が種類の段（不良名・設備など）で、値が件数・ロット数・合計のとき"), draw: paretoChart },
    { k: "stack", n: "積み上げ", g: "part", one: true, tip: "行の段ごとの棒を、列の段（か 2 つ以上の足し上げる値）で積み上げます。高さ＝合計",
      icon: "M3 17h14M5 15v-4M5 11V7M10 15V9M10 9V4M15 15v-3M15 12V9", fit: (f) => (f.rows && (f.cols || f.addMeas > 1) && f.additive ? "" : "列に段があり（か足し上げる値が 2 つ以上）、値が件数・ロット数・合計のとき"), draw: (c) => stackChart(c, false) },
    { k: "stack100", n: "100%積み上げ", g: "part", one: true, tip: "積み上げを 100% にそろえ、行の段ごとの内訳の割合を比べます",
      icon: "M3 3h14M3 17h14M5 17V3M10 17V3M15 17V3M5 10h5M10 7h5M15 12h0", fit: (f) => (f.rows && (f.cols || f.addMeas > 1) && f.additive ? "" : "列に段があり（か足し上げる値が 2 つ以上）、値が件数・ロット数・合計のとき"), draw: (c) => stackChart(c, true) },
    { k: "donut", n: "ドーナツ", g: "part", one: true, tip: "行の段の割合を輪で見ます（大きい順に 9 つ＋その他）。足し上げる値のとき",
      icon: "M10 3a7 7 0 1 0 7 7h-4a3 3 0 1 1-3-3zM12 3.3a7 7 0 0 1 4.7 4.7h-4.2", fit: (f) => (f.rows && f.additive && !f.time && !f.bin && !f.cols ? "" : "行が種類の段（列なし）で、値が件数・ロット数・合計のとき"), draw: donutChart },
    { k: "hist", n: "ヒストグラム", g: "dist", tip: "数の列を区間に分け、件数の山で傾向（ばらつき・偏り）を見ます",
      icon: "M3 17h14M4 15v-3M7 15V8M10 15V4M13 15V9M16 15v-4", fit: (f) => (f.bin ? "" : "行の 1 段目が数のカラムの区間のとき（選ぶと区間に分けます）"), draw: histChart },
    { k: "box", n: "箱ひげ図", g: "dist", tip: "行の段ごとに、数の列の分かれ方（中央値・四分位・外れ値）を並べて比べます",
      icon: "M6 3v3M6 14v3M4 6h4v8H4zM4 10h4M14 5v2M14 13v3M12 7h4v6h-4zM12 9h4", fit: (f) => (f.numMeas && f.rows && !f.time && !f.bin ? "" : "行が種類の段で、値に数のカラム（平均など）があるとき"), draw: boxChart },
    { k: "heat", n: "ヒートマップ", g: "rel", one: true, tip: "行×列の値を色の濃さで見ます（日×直・曜日×時など、偏りの場所を探す）",
      icon: "M3 3h4v4H3zM8 3h4v4H8zM13 3h4v4h-4zM3 8h4v4H3zM8 8h4v4H8zM13 8h4v4h-4zM3 13h4v4H3zM8 13h4v4H8zM13 13h4v4h-4z", fit: (f) => (f.rows && f.cols ? "" : "行と列の両方に段があるとき"), draw: heatChart },
    { k: "scatter", n: "散布図", g: "rel", tip: "2 つの値の関係を点で見ます（1 つ目＝横・2 つ目＝縦。行の葉ごとに 1 点）。相関係数と直線つき",
      icon: "M3 3v14h14M6 13h.1M8 10h.1M10 11h.1M12 7h.1M14 6h.1M9 14h.1", fit: (f) => (f.numMeas >= 2 ? "" : "値に数のカラムが 2 つあるとき"), draw: scatterChart },
    { k: "none", n: "表だけ", g: "table", tip: "グラフを出さず、表だけを広く出します", icon: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12", fit: () => "", draw: null },
  ];
  /* ---- 答え → 表の形（行・列の葉。小計・総計を入れる）と表（集計表・ダッシュボードのパネルで同じ。版 3.37.0 で lotlist-pivot.js から移した） ---- */
  function buildModel(d, s) {
    const nr = d.dims.rows.length, nc = d.dims.cols.length, M = d.measures.length, split = dayAt(d) === 1;
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
        // 月で区切ったときは、月（1 段目）の小計はいつも出す
        if (s.sub || (axis === "r" && split)) for (let lv = s.sub ? n - 1 : 1; lv >= 1; lv--) {
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
  /** names: {measName, dimName}（値・段の見せる名前。一覧は列の表示名を使う） */
  function tableHtml(m, d, { measName, dimName }) {
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
  const byKey = new Map(DEFS.map((x) => [x.k, x]));
  const iconSvg = (k, size = 18) => { const x = byKey.get(k); return x ? `<svg class="pv-ico" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><path d="${x.icon}"/></svg>` : ""; };
  /** 描く（形が分からなければ縦棒）。高さ: 横棒は行の数で伸ばす・ほかは 300 */
  /** ctx.H があればその高さ（ダッシュボードのパネル: パネルの大きさに合わせる） */
  /** ctx.colors があれば、描く間だけ系列の色を替える（描くのは同じ流れの中で終わるので、ほかの描き方に漏れない）。
      ctx.rowColor(名前) があれば、1 系列の棒を行ごとの色で塗る（ダッシュボード: 同じ種類はどのパネルでも同じ色） */
  function draw(kind, ctx) {
    const def = byKey.get(kind) || byKey.get("column");
    const H = ctx.H || (kind === "bar" ? Math.max(260, Math.min(900, 26 * dataRows(ctx.m).length + 60)) : kind === "donut" ? 320 : 300);
    const keep = COLORS;
    if (ctx.colors) COLORS = ctx.colors;
    try { return def.draw({ ...ctx, H }); } finally { COLORS = keep; }
  }
  window.LotListPivotCharts = { DEFS, GROUPS, get: (k) => byKey.get(k), draw, iconSvg, fmt, short, dayAt, isDay, isTimeDim, ADDITIVE, COLORS, buildModel, tableHtml };
})();
