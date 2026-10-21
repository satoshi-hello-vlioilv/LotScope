/* =========================================================================
   ダッシュボードの稼働のパネル（版 3.46.0。利用者の要望 2026-10-21 の 1・2）。数はサーバー（services/operation.py・routes/dashboard.py の _ops_answer）
   - 稼働（gantt）: 選んだ設備（選ばなければすべて）を 1 枚のガントチャートに並べ、行の右に稼働率（勤務時間＝直の時間に対する稼働の割合）。
     横は期間の時間。勤務時間の外は斜線の地（稼働率の分母に入らない時間）・直の境に細い線・作業は棒（色分けの列を選べば、その値ごとの色）
   - ABC 分析と換算係数（abc）: 設備ごと（札で切り替え。全設備も）に、品種を量の大きい順に並べ、累積構成比で A・B・C に分け、
     1 本あたりの平均作業時間 ÷ 基準 ＝ 換算係数 と、換算本数を出す。広いパネルは左にパレート図（棒＝ABC の色・線＝累積構成比）
   パネルの大きさに合わせて描く（スクロールしない）。入らない設備・品種は「ほか n」と下に出す
   ========================================================================= */
(function () {
  "use strict";
  const { esc } = TPA;
  const WORK = "#2f7d78";
  // ABC は順位なので 1 つの色（藍）の濃淡（A＝濃い → C＝淡い。字は A・B が白・C が墨）。ガントの色分けとは色を分ける（同じ色で別の意味にしない: 2026-10-ops の 1 回目の採点）
  const RANK = { A: { c: "#24446a", n: "A", f: "#fff" }, B: { c: "#4d6e96", n: "B", f: "#fff" }, C: { c: "#c3ccd5", n: "C", f: "#1b2733" } };
  // ガントの棒の色分け: 白い字が 4.5 以上で読める濃さ（琥珀 #c27a1e は 3.4 で読みにくかった）。藍は ABC の色なので使わない
  const CATS = ["#9a5f12", "#0f6f63", "#5e46a8", "#4a7318", "#953f68", "#5a6f77", "#7a5410", "#2f5f7a"];
  const ms = (s) => Date.parse(String(s).replace(" ", "T"));
  const pad2 = (n) => String(n).padStart(2, "0");
  const pct = (r) => (r == null ? "–" : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
  const hours = (min) => (min >= 600 ? `${Math.round(min / 60)}` : `${(min / 60).toFixed(1)}`) + " 時間";
  const hm = (t) => { const d = new Date(t); return `${d.getHours()}:${pad2(d.getMinutes())}`; };
  const WD = "日月火水木金土";
  const dayText = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
  /** 字の幅のおおよそ（全角 1・半角 0.58。11〜13px の字の幅を px で） */
  const textW = (s, px) => [...String(s)].reduce((w, ch) => w + (/[ -~｡-ﾟ]/.test(ch) ? 0.58 : 1), 0) * px;

  /* ---------------- 稼働（ガントチャート） ---------------- */
  function gantt(box, p, d, W, H) {
    const eqs = d.equips || [];
    if (!eqs.length) { box.innerHTML = '<p class="dp-empty">当たる設備がありません</p>'; return ""; }
    const r0 = d.range || [], lo = ms(`${r0[0]} 00:00:00`), hi0 = ms(`${r0[1]} 00:00:00`) + 86400000;
    // 横の範囲: 勤務時間の最初〜最後（無ければ作業日の 0 時〜翌 0 時）。作業がはみ出せば広げる
    let x0 = Infinity, x1 = -Infinity;
    eqs.forEach((e) => { (e.windows || []).forEach((w) => { x0 = Math.min(x0, ms(w[0])); x1 = Math.max(x1, ms(w[1])); }); (e.ops || []).forEach((o) => { x0 = Math.min(x0, ms(o[0])); x1 = Math.max(x1, ms(o[1])); }); });
    if (!Number.isFinite(x0)) { x0 = lo; x1 = hi0; }
    const span = Math.max(3600000, x1 - x0);
    const cats = [...new Set(eqs.flatMap((e) => (e.ops || []).map((o) => o[3]).filter(Boolean)))];
    const colorOf = new Map(cats.map((c, i) => [c, CATS[i % CATS.length]]));
    const legend = cats.length > 1 || (cats.length === 1 && (p.ops || {}).color);
    const AX = 38, FOOT = 20;
    const LW = Math.max(44, Math.min(120, Math.max(...eqs.map((e) => textW(e.name, 12.5))) + 14));
    const RW = W >= 620 ? 156 : W >= 420 ? 92 : 56;
    const TW = Math.max(60, W - LW - RW - 8);
    const avail = H - AX - FOOT;
    let rh = Math.min(64, Math.floor(avail / eqs.length));
    let shown = eqs;
    if (rh < 14) { rh = 14; shown = eqs.slice(0, Math.max(1, Math.floor(avail / 14))); }
    const X = (t) => LW + ((t - x0) / span) * TW;
    const g = [];
    // 時刻の目盛り（幅に合わせて 1・2・3・6・12 時間おき）と、日の境（2 日以上のとき日付）
    const days = (x1 - x0) / 86400000, stepH = [1, 2, 3, 4, 6, 12, 24].find((h) => (TW / (span / 3600000)) * h >= (days > 1.5 ? 34 : 30)) || 24;
    const first = new Date(x0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime(); t <= x1; t += 3600000) {
      const dt = new Date(t), h = dt.getHours();
      if (t < x0) continue;
      const x = X(t), midnight = h === 0;
      if (midnight) g.push(`<line class="og-day" x1="${x}" x2="${x}" y1="${AX + 1}" y2="${AX + shown.length * rh}"/>`);   // 目盛りの字「0」に掛けない
      if (h % stepH === 0) g.push(`<text class="og-tick" x="${x}" y="${AX - 4}" text-anchor="middle">${h}</text>`);
      if (midnight && days > 1.05) g.push(`<text class="og-dayl" x="${x + 3}" y="11">${dayText(t)}</text>`);
    }
    if (days <= 1.05) g.push(`<text class="og-dayl" x="${LW}" y="11">${dayText(x0 + 6 * 3600000)}</text>`);
    g.push(`<text class="og-tick og-unit" x="${LW - 6}" y="${AX - 4}" text-anchor="end">時</text>`);
    g.push(`<text class="og-head" x="${LW + TW + 10}" y="${AX - 4}">稼働率${RW >= 156 ? '<tspan class="og-headsub" dx="40">稼働/勤務 h</tspan>' : ""}<title>稼働率 ＝ 作業していた時間 ÷ 勤務時間（直の時間）</title></text>`);
    shown.forEach((e, i) => {
      const y = AX + i * rh, bh = Math.max(8, Math.round(rh * 0.62)), by = y + (rh - bh) / 2;
      g.push(`<g class="og-row${i % 2 ? " is-alt" : ""}" data-i="${i}"><rect class="og-off" x="${LW}" y="${y + 1}" width="${TW}" height="${rh - 2}"/>`);
      (e.windows || []).forEach((w, k) => {
        const a = X(ms(w[0])), b = X(ms(w[1]));
        g.push(`<rect class="og-on" x="${a}" y="${y + 1}" width="${Math.max(0, b - a)}" height="${rh - 2}"><title>${esc(`${w[2]}（${w[3].slice(5).replace("-", "/")}）${hm(ms(w[0]))}〜${hm(ms(w[1]))}`)}</title></rect>`);
        if (k) g.push(`<line class="og-sep" x1="${a}" x2="${a}" y1="${y + 1}" y2="${y + rh - 1}"/>`);
      });
      (e.ops || []).forEach((o) => {
        const a = X(ms(o[0])), b = Math.max(a + 1.5, X(ms(o[1]))), c = o[3] ? colorOf.get(o[3]) || WORK : WORK;
        const min = Math.round((ms(o[1]) - ms(o[0])) / 60000);
        const tip = `${o[2] || "作業"}${o[4] > 1 ? `（${o[4]} 本に分割）` : ""}\n${hm(ms(o[0]))}〜${hm(ms(o[1]))}（${min} 分）${o[3] ? `\n${(p.ops || {}).color || ""}: ${o[3]}` : ""}`;
        g.push(`<rect class="og-bar" x="${a}" y="${by}" width="${b - a}" height="${bh}" rx="2" fill="${c}"><title>${esc(tip)}</title></rect>`);
        if (o[2] && rh >= 18 && b - a > textW(o[2], 11) + 8) g.push(`<text class="og-bl" x="${a + 4}" y="${by + bh / 2 + 3.6}">${esc(o[2])}</text>`);
      });
      g.push(`<text class="og-name" x="${LW - 8}" y="${y + rh / 2 + 4}" text-anchor="end">${esc(e.name)}<title>${esc(`${e.name}　勤務体系: ${e.pattern || "なし（稼働率を出せません）"}`)}</title></text>`);
      // 稼働率: 数（太字）と細い棒（勤務時間に対する割合）。広いときは稼働／勤務の時間も
      const rx = LW + TW + 10, rate = e.rate, bw = RW >= 156 ? RW - 42 - 66 - 10 : RW >= 92 ? RW - 42 - 10 : 0;
      const tipR = e.rate == null ? `${e.name}: 勤務体系が無いので稼働率を出せません（マスタ管理の「勤務体系」）` : `${e.name}: 稼働 ${hours(e.busyMin)} ／ 勤務 ${hours(e.shiftMin)}${e.outsideMin ? `（勤務時間の外の稼働 ${hours(e.outsideMin)}）` : ""}`;
      g.push(`<text class="og-rate" x="${rx}" y="${y + rh / 2 + 4.5}">${pct(rate)}<title>${esc(tipR)}</title></text>`);
      if (bw > 14 && rate != null) {
        const bx = rx + 42;
        g.push(`<rect class="og-rtrack" x="${bx}" y="${y + rh / 2 - 3}" width="${bw}" height="6" rx="3"/><rect class="og-rfill" x="${bx}" y="${y + rh / 2 - 3}" width="${Math.min(1, rate) * bw}" height="6" rx="3"/>`);
        if (RW >= 156) g.push(`<text class="og-rsub" x="${bx + bw + 6}" y="${y + rh / 2 + 4}">${(e.busyMin / 60).toFixed(1)}/${(e.shiftMin / 60).toFixed(0)}<title>${esc(tipR)}</title></text>`);
      }
      g.push("</g>");
    });
    // いま（期間が今日を含むとき）
    const now = ms(d.now || "");
    if (now > x0 && now < x1) g.push(`<line class="og-now" x1="${X(now)}" x2="${X(now)}" y1="${AX - 2}" y2="${AX + shown.length * rh}"/><text class="og-nowl" x="${X(now) + 3}" y="${AX - 16}">いま</text>`);
    const leg = legend ? `<span class="og-leg">${cats.slice(0, 8).map((c) => `<span><i style="background:${colorOf.get(c)}"></i>${esc(c)}</span>`).join("")}${cats.length > 8 ? `<span>ほか ${cats.length - 8}</span>` : ""}</span>` : "";
    box.innerHTML = `<div class="og-wrap"><svg class="og-svg" viewBox="0 0 ${W} ${AX + shown.length * rh + 2}" width="${W}" height="${AX + shown.length * rh + 2}" role="img" aria-label="設備の稼働のガントチャート">`
      + `<defs><pattern id="ogHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3f4f5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#dde1e4" stroke-width="2"/></pattern></defs>`
      + g.join("") + "</svg>"
      + `<div class="og-foot"><span class="og-key"><span><i class="og-k-on"></i>勤務時間</span><span><i class="og-k-off"></i>勤務の外</span>${legend ? "" : `<span><i style="background:${WORK}"></i>作業</span>`}</span>${leg}</div></div>`;
    const more = eqs.length - shown.length;
    return more > 0 ? `ほか ${more} 台（パネルを高くすると出ます）` : "";
  }

  /* ---------------- ABC 分析と換算係数 ---------------- */
  const picked = new Map();          // パネルの id → 見ている設備（"" は全設備）。この画面のあいだだけ覚える
  const qtyName = (q) => (q === "lots" ? "本数" : q === "time" ? "作業時間" : `${q}の計`);
  const qtyText = (q, v) => (v == null ? "–" : q === "time" ? `${(v / 60).toFixed(1)}h` : (Math.round(v * 10) / 10).toLocaleString("ja-JP"));
  function abc(box, p, d, W, H) {
    const eqs = d.equips || [];
    if (!eqs.length) { box.innerHTML = '<p class="dp-empty">当たる設備がありません</p>'; return ""; }
    const o = p.ops || {}, q = d.qty || o.qty || "lots";
    if (!d.cls) { box.innerHTML = '<p class="dp-empty">品種の列を選んでください（組む所の「品種の列」）</p>'; return ""; }
    const want = picked.has(p.id) ? picked.get(p.id) : eqs.length > 1 ? "" : eqs[0].name;
    const cur = want === "" ? { name: "全設備", ...d.all } : eqs.find((e) => e.name === want) || eqs[0];
    const tabs = eqs.length > 1 ? `<div class="oa-tabs" role="tablist" aria-label="設備">${[{ name: "" }].concat(eqs).map((e) => {
      const on = (e.name || "") === (want === "" ? "" : cur.name);
      return `<button type="button" role="tab" class="oa-tab${on ? " on" : ""}" aria-selected="${on}" data-oa-eq="${esc(e.name)}">${esc(e.name || "全設備")}</button>`;
    }).join("")}</div>` : "";
    const items = cur.items || [];
    const wide = W >= 680, chartW = wide ? Math.round(Math.min(W * 0.42, 420)) : 0;
    const tabH = tabs ? 30 : 0, footH = 20, headH = 24;
    const rows = items.slice(0, Math.max(1, Math.floor((H - tabH - footH - headH) / 17)));
    const narrow = W - chartW < 460;
    const head = `<tr><th scope="col" title="品種の列: ${esc(d.cls)}">${esc(d.cls)}</th><th scope="col">${qtyName(q)}</th>${narrow ? "" : '<th scope="col">構成比</th>'}<th scope="col">累積</th><th scope="col" title="累積構成比で A（〜${o.a || 70}%）・B（〜${o.b || 90}%）・C">ABC</th>`
      + `<th scope="col" title="1 本あたりの平均作業時間（作業開始〜作業終了）">平均作業</th><th scope="col" title="平均作業時間 ÷ 基準の作業時間">換算係数</th>${narrow ? "" : '<th scope="col" title="本数 × 換算係数">換算本数</th>'}</tr>`;
    const body = rows.map((x) => {
      const r = RANK[x.rank] || RANK.C;
      return `<tr class="oa-r-${x.rank}"><th scope="row" title="${esc(x.key || "（空欄）")}">${esc(x.key || "（空欄）")}</th><td>${qtyText(q, x.qty)}</td>${narrow ? "" : `<td>${x.share.toFixed(1)}%</td>`}`
        + `<td><span class="oa-cum"><i style="width:${Math.min(100, x.cum)}%;background:${r.c}"></i></span>${x.cum.toFixed(1)}%</td><td><b class="oa-rank" style="--rc:${r.c};--rf:${r.f}">${r.n}</b></td>`
        + `<td>${x.avg == null ? "–" : `${x.avg.toFixed(1)} 分`}</td><td class="oa-f${x.factor != null && Math.abs(x.factor - 1) >= 0.15 ? " is-far" : ""}">${x.factor == null ? "–" : x.factor.toFixed(2)}</td>${narrow ? "" : `<td>${x.conv == null ? "–" : x.conv.toFixed(1)}</td>`}</tr>`;
    }).join("");
    const counts = ["A", "B", "C"].map((k) => [k, items.filter((x) => x.rank === k).length]);
    const base = cur.base || {};
    const foot = `<div class="oa-foot"><span>${counts.map(([k, n]) => `<b class="oa-rank is-s" style="--rc:${RANK[k].c};--rf:${RANK[k].f}">${k}</b>${n} 品種`).join("　")}</span>`
      + `<span title="換算係数の基準">基準: ${esc(base.name || "–")}${base.minutes ? ` ${base.minutes.toFixed(1)} 分 ＝ 1.00` : ""}</span>`
      + `<span>換算本数の計 <b>${(cur.conv || 0).toFixed(1)}</b>（実本数 ${cur.lots || 0}）</span><span class="oa-rest"></span></div>`;
    const chart = wide && H - tabH - footH >= 96 ? pareto(items.slice(0, Math.max(3, Math.min(items.length, Math.floor(chartW / 22)))), chartW, H - tabH - footH, o) : "";
    box.innerHTML = `<div class="oa-wrap">${tabs}<div class="oa-main">${chart}<div class="oa-tbl"><table class="oa-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="8" class="dp-empty">当たる作業がありません</td></tr>`}</tbody></table></div></div>${foot}</div>`;
    // 入る行だけ（描いた高さで測る）。入らない品種は下に「ほか n 品種」
    const tw = box.querySelector(".oa-tbl"), tb = box.querySelector(".oa-table tbody");
    let rest = items.length - rows.length;
    while (tw && tb && tb.rows.length > 1 && tw.scrollHeight > tw.clientHeight + 1) { tb.deleteRow(-1); rest++; }
    if (rest > 0) box.querySelector(".oa-rest").textContent = `ほか ${rest} 品種（パネルを高くすると出ます）`;
    // 品種が少なくて下が空くときは、行を高くして埋める（17〜28px。2026-10-ops の 3 回目で決めた G: 表の下が大きく空いていた）
    else if (tw && tb && tb.rows.length) {
      const free = tw.clientHeight - tw.querySelector("thead").offsetHeight, rh = Math.max(17, Math.min(28, Math.floor(free / tb.rows.length) - 1));
      if (rh > 17) tw.style.setProperty("--oa-rh", `${rh}px`);
    }
    if (!box.dataset.oaBound) {
      box.dataset.oaBound = "1";
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-oa-eq]"); if (!b) return;
        picked.set(p.id, b.dataset.oaEq);
        box.dispatchEvent(new CustomEvent("dash:repaint", { bubbles: true }));
      });
    }
    return "";
  }
  /** パレート図（棒＝量の大きい順・ABC の色。線＝累積構成比。A・B の線） */
  function pareto(items, W, H, o) {
    if (!items.length || H < 80) return "";
    const L = 34, R = 48, T = 12, B = 22, iw = W - L - R, ih = H - T - B, n = items.length, bw = iw / n;
    const max = Math.max(...items.map((x) => x.qty)) || 1;
    const y = (v) => T + ih - (v / max) * ih, yc = (c) => T + ih - (c / 100) * ih;
    const g = [`<line class="oa-ax" x1="${L}" x2="${L + iw}" y1="${T + ih}" y2="${T + ih}"/>`];
    // A・B の線の字は、近ければ A を線の下・B を線の上へ逃がす（低いパネルで重なった）
    const near = yc(o.a || 70) - yc(o.b || 90) < 12;
    [[o.a || 70, "A", near ? 11 : 4], [o.b || 90, "B", near ? -3 : 4]].forEach(([v, k, dy]) => g.push(`<line class="oa-lim" x1="${L}" x2="${L + iw}" y1="${yc(v)}" y2="${yc(v)}"/><text class="oa-liml" x="${L + iw + 4}" y="${yc(v) + dy}">${k} ${v}%</text>`));
    items.forEach((x, i) => {
      const r = RANK[x.rank] || RANK.C, h = T + ih - y(x.qty);
      g.push(`<rect x="${L + i * bw + bw * 0.14}" y="${y(x.qty)}" width="${bw * 0.72}" height="${Math.max(0, h)}" fill="${r.c}" rx="1.5"><title>${esc(`${x.key || "（空欄）"}: ${x.rank}・構成比 ${x.share.toFixed(1)}%・累積 ${x.cum.toFixed(1)}%`)}</title></rect>`);
      if (bw >= 24) g.push(`<text class="oa-xl" x="${L + i * bw + bw / 2}" y="${T + ih + 13}" text-anchor="middle">${esc(String(x.key || "空").slice(0, Math.max(2, Math.floor(bw / 9))))}</text>`);
    });
    const pts = items.map((x, i) => `${L + i * bw + bw / 2},${yc(x.cum)}`).join(" ");
    g.push(`<polyline class="oa-line" points="${pts}"/>` + items.map((x, i) => `<circle class="oa-dot" cx="${L + i * bw + bw / 2}" cy="${yc(x.cum)}" r="2.6"/>`).join(""));
    g.push(`<text class="oa-axl" x="${L - 4}" y="${T + 4}" text-anchor="end">${(Math.round(max * 10) / 10).toLocaleString("ja-JP")}</text><text class="oa-axl" x="${L - 4}" y="${T + ih + 4}" text-anchor="end">0</text>`);
    if (yc(o.b || 90) - T > 16) g.push(`<text class="oa-axl" x="${L + iw + 4}" y="${T + 4}">100%</text>`);   // B の線の字と重なるなら出さない
    return `<svg class="oa-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="パレート図（品種の量の大きい順と累積構成比）">${g.join("")}</svg>`;
  }

  /** 見出しの題の横の札: 稼働のパネルは全体の稼働率と内訳（いちばん最初に見る数。2026-10-ops の 3 回目で決めた G。
      前は図のいちばん上の右の字で、題から離れていた）。dashboard.js が見出しを描くたびに呼ぶ */
  function badge(p, d) {
    if (p.visual !== "gantt" || !d || d.kind !== "gantt" || !d.total) return "";
    const t = d.total;
    return `<span class="og-badge" title="全部の設備の稼働 ÷ 勤務時間（直の時間）">全体の稼働率<b>${pct(t.rate)}</b><small>稼働 ${hours(t.busyMin || 0)} ／ 勤務 ${hours(t.shiftMin || 0)}</small></span>`;
  }

  window.DashOps = { gantt, abc, badge, RANK };
})();
