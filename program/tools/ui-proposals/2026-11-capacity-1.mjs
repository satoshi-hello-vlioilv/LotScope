// 設備の実力（基準の数）の改良案の 1 回目（2026-11-capacity.json の 1 回目の採点）。2 回目は 2026-11-capacity.mjs
// 設備の実力（直あたり・日あたり・稼働率）を組む所で作る — 改良案（1 回目）。撮るのは cap-shot.mjs（状態 cap・cap-edit）。
// 共通の土台: 値の計算の段（num_expr）に、セル（行）ごとの「基準の数」を変数として足す。
//   稼働直      … そのセルで実績のある（作業日・直）の数
//   稼働日      … そのセルで実績のある作業日の数
//   1日の直数   … その設備の勤務体系の直の数（試験のデータは CR2 だけ 2〈4,5直〉、ほかは 3）
//   期間の日数  … パネルの期間の日数（直近 14 日 → 14）
//   期間の直数  … 期間の日数 × 1日の直数
//   換算稼働日  … 稼働直 ÷ 1日の直数（直から換算した日数。月の稼働日数もこれ）
//   稼働率      … 稼働直 ÷ 期間の直数
// 表の数は、試験の作業実績から数えた本物の数（cap-shot.mjs が /api/dashboard/query に 設備×作業日×直 で問い合わせて数える）。

/** 頁の中の共通の部品（window.CX） */
function H() {
  if (window.CX) return;
  const CX = (window.CX = {});
  const C = window.CAP, E = Object.keys(C).sort();
  CX.E = E; CX.C = C;
  CX.n = (v, d = 1) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const K = (CX.K = {
    lots: (e) => e.lots, t: (e) => e.w / 1000, sh: (e) => e.shifts, dy: (e) => e.days, spd: (e) => e.spd, cal: (e) => e.cal, csh: (e) => e.calShifts,
    tps: (e) => e.w / 1000 / e.shifts, lps: (e) => e.lots / e.shifts, cdy: (e) => e.shifts / e.spd, tpd: (e) => e.w / 1000 / (e.shifts / e.spd),
    lpd: (e) => e.lots / (e.shifts / e.spd), rate: (e) => (e.shifts / e.calShifts) * 100, tpdy: (e) => e.w / 1000 / e.days });
  const sum = (f) => E.reduce((a, k) => a + f(C[k]), 0);
  CX.tot = (k) => {
    const S = { lots: sum(K.lots), t: sum(K.t), sh: sum(K.sh), dy: sum(K.dy), csh: sum(K.csh), cdy: sum(K.cdy) };
    return { lots: S.lots, t: S.t, sh: S.sh, dy: S.dy, cdy: S.cdy, csh: S.csh, spd: null, cal: C[E[0]].cal, tps: S.t / S.sh, lps: S.lots / S.sh,
      tpd: S.t / S.cdy, lpd: S.lots / S.cdy, rate: (S.sh / S.csh) * 100, tpdy: S.t / S.dy }[k];
  };
  CX.table = (cols, st) => {
    const head = `<tr><th class="pv-corner">設備</th>${cols.map((c) => `<th class="pv-mh ${c.cls || ""}">${c.h}</th>`).join("")}</tr>`;
    const cell = (c, v) => `<td class="${c.cls || ""}">${v == null ? "–" : CX.n(v, c.d ?? 1) + (c.unit || "")}</td>`;
    const body = E.map((k) => `<tr><th>${k}</th>${cols.map((c) => cell(c, K[c.k](C[k]))).join("")}</tr>`).join("");
    const g = `<tr class="is-grand"><th class="pv-gt">総計</th>${cols.map((c) => cell(c, CX.tot(c.k))).join("")}</tr>`;
    return `<table class="pv-table cx-t" style="${st || ""}"><thead>${head}</thead><tbody>${body}${g}</tbody></table>`;
  };
  CX.panel = (id) => document.querySelector(`#dashGrid .db-p[data-id="${id}"]`);
  CX.setTable = (id, cols) => {
    const box = CX.panel(id)?.querySelector(".dp-tbl"); if (!box) return;
    box.innerHTML = CX.table(cols, box.querySelector("table")?.getAttribute("style") || "");
  };
  CX.title = (id, t, sub) => {
    const p = CX.panel(id); if (!p) return; const h = p.querySelector("h3"); if (h) { h.textContent = t; h.title = t; }
    if (sub) { const s = p.querySelector(".db-psub"); if (s) { s.textContent = sub; s.title = sub; } }
    const nm = [...document.querySelectorAll("#dbEditor input")].find((x) => x.value === "設備ごとの実績（直近 14 日）");
    if (nm) { nm.value = t; nm.setAttribute("value", t); }
  };
  CX.style = (css) => document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
  CX.$ = (s) => document.querySelector(s);
  CX.setIn = (i, v, w) => { const el = CX.$(`#deSent [data-pc-in="${i}"]`); if (el) { el.value = v; el.setAttribute("value", v); if (w) el.style.width = w; } };
  CX.setUnit = (i, v) => { const el = CX.$(`#deSent [data-pc-unit="${i}"]`); if (el) { el.value = v; el.setAttribute("value", v); } };
  CX.setOut = (i, html) => { const el = CX.$(`#deSent [data-pc-out="${i}"]`); if (el) el.innerHTML = html; };
  CX.prev = (a, b) => `<span class="pc-prev" title="総計: 計算の前 → 後">${a}<i aria-hidden="true">→</i>${b}</span>`;
  CX.scrollTo = (sel, off = 150) => {
    const m = CX.$("#dbEditor .de-main"), f = CX.$(sel);
    if (m && f) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - off);
    window.scrollTo(0, 0);
  };
  CX.style(`
    .cx-t .cx-u{display:block;font-size:11.5px;font-weight:600;opacity:.85;margin-top:1px}
    .cx-t td.cx-m{color:#56616b;background:color-mix(in srgb,var(--surface) 88%,#e8edf2)}
    .cx-t td.cx-k{font-weight:800}
    .cx-def{grid-column:1 / -1;font-size:12px;color:#56616b;line-height:1.55;padding-top:5px;border-top:1px dashed #e2cfa6}
    .cx-def b{color:var(--ink)}
  `);
}

/* ------------------------------------------------------------------ A: 値の計算の段に「÷ 基準」の札 */
function A_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直" }]);
}
function A_edit() {
  CX.style(`.cx-bq{font-family:inherit} .cx-sep{width:1px;align-self:stretch;margin:2px 4px;background:#e2cfa6}`);
  const chips = (i, on) => `<span class="pc-qs cx-bqs"><span class="cx-sep" aria-hidden="true"></span>${["÷稼働直", "÷稼働日", "÷換算稼働日"].map((q) =>
    `<button type="button" class="pc-q cx-bq${q === on ? " on" : ""}" title="${q.slice(1)}で割る（設備ごとに数えます）">${q}</button>`).join("")}</span>`;
  document.querySelectorAll("#deSent .pc-item").forEach((it, i) => it.querySelector(".pc-qs").insertAdjacentHTML("afterend", chips(i, "÷稼働直")));
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(0, "÷稼働直", "130px"); CX.setIn(1, "÷1000÷稼働直", "130px");
  CX.setOut(0, CX.prev("322", CX.n(CX.tot("lps"), 2) + "本/直")); CX.setOut(1, CX.prev("1,620,185", CX.n(CX.tot("tps"), 1) + "t/直"));
  CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  CX.$("#deSent .pc-band").insertAdjacentHTML("beforeend", `<div class="cx-def"><b>稼働直</b> 実績のある直の数（作業日×直）・<b>稼働日</b> 実績のある作業日の数・<b>換算稼働日</b> 稼働直÷1日の直数。どれも設備ごと・行ごとに数えます</div>`);
  CX.scrollTo("#deSent", 90);
}

/* ------------------------------------------------------------------ B: 基準の数の札（値つき）と見本を、値の計算の段の下に */
function B_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直" }]);
}
function B_edit() {
  CX.style(`
    .cx-pal{margin-top:8px;padding:8px 10px 9px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:12.5px}
    .cx-pal h5{margin:0 0 6px;font-size:12.5px;font-weight:800;color:var(--ink);display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
    .cx-pal h5 small{font-weight:600;color:#56616b;font-size:12px}
    .cx-vars,.cx-ex{display:flex;flex-wrap:wrap;gap:5px 6px;align-items:center}
    .cx-ex{margin-top:7px;padding-top:7px;border-top:1px dashed var(--line)}
    .cx-l{color:#56616b;font-size:12px;margin-right:2px;white-space:nowrap}
    .cx-var{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 4px 0 9px;border:1px solid #c9d3dc;border-radius:999px;background:var(--edit-field,#fffdf6);font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer;white-space:nowrap}
    .cx-var b{font-weight:800}
    .cx-var i{font-style:normal;min-width:22px;padding:1px 6px;border-radius:999px;background:var(--ll-pale);color:var(--ll-teal-dark);font-weight:800;font-variant-numeric:tabular-nums;text-align:center}
    .cx-exb{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer;white-space:nowrap}
    .cx-exb code{font:12px ui-monospace,Consolas,monospace;color:#6b4a10}
    .cx-exb.on{border-color:var(--pv-val);box-shadow:inset 0 0 0 1px var(--pv-val)}`);
  const e = CX.C.CR1;
  const v = [["稼働直", e.shifts, "実績のある直の数（作業日×直）"], ["稼働日", e.days, "実績のある作業日の数"], ["1日の直数", e.spd, "勤務体系の直の数"],
    ["期間の日数", e.cal, "パネルの期間の日数"], ["期間の直数", e.calShifts, "期間の日数×1日の直数"]];
  const ex = [["直あたり", "÷[稼働直]", 1], ["日あたり", "÷([稼働直]÷[1日の直数])", 0], ["稼働日あたり", "÷[稼働日]", 0], ["稼働率", "[稼働直]÷[期間の直数]", 0]];
  CX.$("#deSent .pc-band").insertAdjacentHTML("afterend", `<div class="cx-pal" role="group" aria-label="基準の数">
    <h5>基準の数<small>押すと、いま打っている計算の欄に入ります。数は設備ごと・行ごと（右の数は CR1 の例）</small></h5>
    <div class="cx-vars">${v.map(([n, x, t]) => `<button type="button" class="cx-var" title="${t}"><b>[${n}]</b><i>${x}</i></button>`).join("")}</div>
    <div class="cx-ex"><span class="cx-l">見本</span>${ex.map(([n, f, on]) => `<button type="button" class="cx-exb${on ? " on" : ""}" title="押すと計算の欄に入ります">${n}<code>${f}</code></button>`).join("")}</div></div>`);
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(0, "÷[稼働直]", "150px"); CX.setIn(1, "÷1000÷[稼働直]", "150px");
  CX.setOut(0, CX.prev("322", CX.n(CX.tot("lps"), 2) + "本/直")); CX.setOut(1, CX.prev("1,620,185", CX.n(CX.tot("tps"), 1) + "t/直"));
  CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  CX.scrollTo("#deSent .pc-band", 20);
}

/* ------------------------------------------------------------------ C: 値の札に「あたり」の選び（表し方の隣） */
function C_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "ロット数（直あたり）", k: "lps", d: 2, unit: "本" }, { h: "重量の合計（直あたり）", k: "tps", d: 1, unit: "t" }]);
}
function C_edit() {
  CX.style(`.cx-per{font-weight:800} .pv-chip select.cx-per.on{background:#fff;color:#6b4a10;border-color:#fff}
    #deSent .pv-chip.v select{max-width:5.6em} #deSent .pv-chip.v select.cx-per{max-width:6.8em} #deSent .pv-chip.v > b{flex:none;white-space:nowrap}
    .cx-perhint{display:block;margin:4px 2px 0;font-size:12px;color:#56616b}`);
  const sel = (i) => `<select class="de-show cx-per on" aria-label="あたり" title="何あたりで出すか（設備ごと・行ごとに数えた基準の数で割ります）">
    <option value="">あたり</option><option selected>直あたり</option><option>日あたり（直から換算）</option><option>稼働日あたり</option><option>期間の日あたり</option><option>稼働率（期間の直に対する%）</option></select>`;
  document.querySelectorAll('#deSent .pv-chip.v [data-de-show]').forEach((s, i) => s.insertAdjacentHTML("beforebegin", sel(i)));
  CX.$("#deSent .pv-sent").insertAdjacentHTML("afterend", `<small class="cx-perhint">直あたり＝値÷稼働直（実績のある直の数）・日あたり＝値÷(稼働直÷1日の直数)。設備ごと・行ごとに数えます</small>`);
  CX.setUnit(0, "本"); CX.setUnit(1, "t");
  CX.setOut(1, CX.prev("1,620,185", "1,620.2t"));
  CX.scrollTo("#deSent", 90);
}

/* ------------------------------------------------------------------ D: 基準の数をカラムの札に（表にも並べ、値の計算で [稼働直] と書く） */
function D_panel() {
  CX.title("cap", "設備ごとの稼働と直あたり重量");
  CX.setTable("cap", [{ h: "稼働直", k: "sh", d: 0, cls: "cx-m" }, { h: "稼働日", k: "dy", d: 0, cls: "cx-m" }, { h: "重量の合計", k: "t", d: 1, unit: "t" }, { h: "重量の合計［÷稼働直］", k: "tps", d: 1, unit: "t", cls: "cx-k" }]);
}
function D_edit() {
  CX.style(`.cx-fg{margin:8px 0 4px;padding:0 2px;font-size:12.5px;font-weight:800;color:#41525f;line-height:1.4}
    .cx-fg small{display:block;font-weight:600;font-size:12px;color:#56616b}`);
  const f = (col, n, d, used) => `<div class="pv-f is-special${used ? " is-used" : ""}" title="${d}"><span><b>${n}</b><small>${d}</small></span><i></i><button type="button" class="pv-r r-vals${used ? " on" : ""}" aria-pressed="${used}">値</button><i></i></div>`;
  CX.$('#deFields .pv-f[data-dnd-col="@shift"]').insertAdjacentHTML("afterend", `<div class="cx-fg">基準の数（稼働）<small>値に置くと設備ごとに数える</small></div>`
    + f("sh", "稼働直", "実績のある直の数（作業日×直）", true) + f("dy", "稼働日", "実績のある作業日の数", true) + f("spd", "1日の直数", "勤務体系の直の数", false)
    + f("cal", "期間の日数", "パネルの期間の日数", false) + f("csh", "期間の直数", "期間の日数×1日の直数", false));
  // 文の値の札: 稼働直・稼働日 を前に、重量の合計を 2 つ（2 つ目は ÷[稼働直]）
  const vals = CX.$('#deSent .pv-slot[data-role="vals"]'), lots = vals.querySelector('[data-dnd-i="0"]'), w = vals.querySelector('[data-dnd-i="1"]');
  const mk = (n) => `<span class="pv-chip v" data-dnd-role="vals" tabindex="0"><b>${n}</b><button type="button">×</button></span>`;
  lots.outerHTML = mk("稼働直") + mk("稼働日");
  w.insertAdjacentHTML("afterend", w.outerHTML);
  const items = CX.$("#deSent .pc-band");
  const one = items.querySelector('.pc-item[data-pc-i="1"]');
  one.querySelector(".pc-name").textContent = "重量の合計";
  const two = one.cloneNode(true); one.after(two);
  items.querySelector('.pc-item[data-pc-i="0"]').querySelector(".pc-name").textContent = "稼働直";
  const lotsItem = items.querySelector('.pc-item[data-pc-i="0"]'); const dy = lotsItem.cloneNode(true); dy.querySelector(".pc-name").textContent = "稼働日"; lotsItem.after(dy);
  [lotsItem, dy].forEach((x) => { x.querySelector(".pc-in").value = ""; x.querySelector(".pc-uin").value = x === dy ? "日" : "直"; });
  const ins = items.querySelectorAll(".pc-in:not(.pc-uin)");
  ins[3].value = "÷1000÷[稼働直]"; ins[3].style.width = "150px"; ins[2].value = "÷1000";
  items.querySelectorAll(".pc-uin")[3].value = "t";
  const hd = items.querySelectorAll(".pc-item")[3].querySelectorAll("[data-pc-head]"); if (hd.length === 2) { hd[0].classList.add("on"); hd[1].classList.remove("on"); }
  items.querySelectorAll(".pc-out")[3].innerHTML = CX.prev("1,620,185", CX.n(CX.tot("tps"), 1) + "t");
  CX.scrollTo("#deSent", 100);
  const fl = CX.$("#deFields"); const g = CX.$("#deFields .cx-fg"); if (fl && g) fl.scrollTop = Math.max(0, g.offsetTop - fl.offsetTop - 110);
}

/* ------------------------------------------------------------------ E: 専用の形「設備の実力」（③ 形で選ぶ。ガント・ABC と同じ組みの形） */
function E_view() {
  CX.style(`
    .cx-cap{display:grid;grid-template-columns:max-content 1fr 118px 70px;gap:0 14px;align-items:center;height:100%;padding:2px 4px 0;font-size:14px;font-variant-numeric:tabular-nums}
    .cx-cap .h{font-size:12px;font-weight:700;color:#56616b;padding-bottom:4px;border-bottom:1px solid var(--line)}
    .cx-cap .h.r{text-align:right}
    .cx-cap .n{font-weight:800}
    .cx-cap .b{display:flex;align-items:center;gap:8px}
    .cx-cap .b span{height:14px;border-radius:3px;background:#2f7d78}
    .cx-cap .b em{font-style:normal;font-weight:800;min-width:46px}
    .cx-cap .r{display:flex;align-items:center;gap:6px}
    .cx-cap .r s{flex:1;height:8px;border-radius:4px;background:#e3e8ee;position:relative;text-decoration:none}
    .cx-cap .r s::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);border-radius:4px;background:#8a6a2f}
    .cx-cap .r em{font-style:normal;font-weight:700;min-width:34px;text-align:right}
    .cx-cap .c{color:#56616b;text-align:right;font-size:13px}
    .cx-cap .g{border-top:1px solid var(--line);padding-top:3px;font-weight:800}`);
  const p = CX.panel("cap"); if (!p) return;
  CX.title("cap", "設備の実力（直あたり重量）", "実績・全設備　直近 14 日 9/20〜10/3（現場歴）　稼働率＝稼働直÷期間の直数");
  const E = [...CX.E].sort((a, b) => CX.K.tps(CX.C[b]) - CX.K.tps(CX.C[a])), max = Math.max(...E.map((k) => CX.K.tps(CX.C[k])));
  const row = (k, e, g) => `<span class="n${g}">${k}</span><span class="b${g}"><span style="width:${(CX.K.tps(e) / max) * 72}%"></span><em>${CX.n(CX.K.tps(e), 1)}t</em></span>`
    + `<span class="r${g}"><s style="--w:${CX.K.rate(e)}%"></s><em>${CX.n(CX.K.rate(e), 0)}%</em></span><span class="c${g}">${e.shifts}/${e.calShifts}直</span>`;
  const body = `<div class="cx-cap"><span class="h">設備</span><span class="h">直あたり重量（t/直）</span><span class="h">稼働率</span><span class="h r">稼働直</span>`
    + E.map((k) => row(k, CX.C[k], "")).join("")
    + `<span class="n g">全設備</span><span class="b g"><em>${CX.n(CX.tot("tps"), 1)}t</em></span><span class="r g"><em>${CX.n(CX.tot("rate"), 0)}%</em></span><span class="c g">${CX.tot("sh")}/${CX.tot("csh")}直</span></div>`;
  p.querySelector(".db-pb").innerHTML = body;
}
function E_edit() {
  CX.style(`.cx-sec{margin:6px 0 8px;display:grid;grid-template-columns:max-content 1fr;gap:8px 12px;align-items:center;font-size:13px}
    .cx-sec .de-l{font-weight:800;color:var(--ink);font-size:13px}
    .cx-sec label.ck{display:inline-flex;gap:6px;align-items:center;margin-right:12px}
    .cx-sec .de-hint{grid-column:2}
    .cx-sec > .de-segs{justify-self:start}
    .cx-vis{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:8px;background:var(--h-input);color:#fff;font-weight:800;font-size:13.5px}`);
  const seg = (list, on) => `<span class="de-segs">${list.map((x) => `<label class="de-seg${x === on ? " on" : ""}">${x}</label>`).join("")}</span>`;
  CX.$("#deSent").hidden = true; const so = CX.$("#deSort"); if (so) so.hidden = true;
  const vb = [...document.querySelectorAll("#deVis button")].find((x) => x.textContent.trim() === "表"); if (vb) vb.innerHTML = "▤ 設備の実力";
  CX.$("#deSent").insertAdjacentHTML("beforebegin", `<div class="cx-sec" role="group" aria-label="設備の実力の出し方">
    <span class="de-l">形</span><span><span class="cx-vis">▤ 設備の実力</span> <small class="de-hint">③ 形で選んだ形</small></span>
    <span class="de-l">量</span>${seg(["ロット数", "重量", "両方"], "重量")}
    <span class="de-l">あたり</span>${seg(["直", "日（直から換算）", "稼働日", "期間の日"], "直")}
    <span class="de-l">添える</span><span><label class="ck"><input type="checkbox" checked>稼働率</label><label class="ck"><input type="checkbox" checked>稼働直の数</label><label class="ck"><input type="checkbox">元の量</label></span>
    <span class="de-l">並べ方</span>${seg(["あたりの大きい順", "設備の順"], "あたりの大きい順")}
    <small class="de-hint">直あたり＝重量÷稼働直（実績のある直の数）・稼働率＝稼働直÷期間の直数（期間の日数×勤務体系の直の数）</small></div>`);
  CX.scrollTo(".cx-sec", 140);
}

/* ------------------------------------------------------------------ F: 組む所のタブ「基準の数」（決めた数・作った数の一覧。値の計算で [名前]） */
function F_panel() {
  CX.title("cap", "設備ごとの日あたり重量");
  CX.setTable("cap", [{ h: "稼働直", k: "sh", d: 0, cls: "cx-m" }, { h: "換算稼働日", k: "cdy", d: 1, cls: "cx-m" }, { h: "重量の合計", k: "tpd", d: 1, unit: "t/日", cls: "cx-k" }]);
}
function F_edit() {
  CX.style(`
    .cx-tab .cx-n{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:var(--input-soft);color:var(--h-input);font-size:11.5px}
    .cx-pane{padding:4px 2px 10px;font-size:13px}
    .cx-pane p{margin:2px 0 10px;color:#56616b;font-size:12.5px;line-height:1.55}
    .cx-bt{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    .cx-bt th,.cx-bt td{padding:6px 8px;border-bottom:1px solid var(--line-soft,#e3e8ee);text-align:left;white-space:nowrap}
    .cx-bt thead th{font-size:12px;color:#56616b;font-weight:700}
    .cx-bt td.v{text-align:right;font-weight:800}
    .cx-bt td.d{white-space:normal;color:#38434d}
    .cx-bt code{font:12.5px ui-monospace,Consolas,monospace;color:#6b4a10}
    .cx-bt tr.sep td{padding:10px 8px 4px;font-size:12px;font-weight:800;color:#56616b;border-bottom:0}
    .cx-bt .nm{font-weight:800;color:var(--ink)}
    .cx-bt .ed{margin-left:4px;color:#56616b;font-size:12px}
    .cx-add{margin-top:8px}
    .cx-use{margin-top:12px;padding:8px 10px;border:1px solid #ecdcbc;border-radius:10px;background:var(--pv-val-bg);font-size:12.5px;line-height:1.7}
    .cx-use code{font:12.5px ui-monospace,Consolas,monospace;color:#6b4a10;font-weight:700}`);
  const tabs = CX.$("#dePtabs");
  tabs.querySelectorAll(".de-ptab").forEach((b) => { b.classList.remove("on"); b.setAttribute("aria-selected", "false"); });
  tabs.querySelector('[data-de-pane="data"]').insertAdjacentHTML("afterend", `<button type="button" role="tab" class="de-ptab on cx-tab" aria-selected="true">基準の数<span class="cx-n">2 作った</span></button>`);
  const pane = CX.$('.de-pane[data-pane="data"]'); pane.hidden = true; pane.style.display = "none";
  const e = CX.C.CR1, t = (k) => CX.tot(k);
  const row = (n, d, v, g, own) => `<tr><td><span class="nm">[${n}]</span>${own ? '<button type="button" class="pv-btn ed">✎</button>' : ""}</td><td class="d">${d}</td><td class="v">${v}</td><td class="v">${g}</td></tr>`;
  pane.insertAdjacentHTML("afterend", `<div class="de-pane cx-pane" role="tabpanel">
    <p>値の計算で <code>÷[稼働直]</code> のように [名前] で使える数です。どれも設備ごと・行ごと（表のその行の作業日・直）に数えます。</p>
    <table class="cx-bt"><thead><tr><th>名前</th><th>決め方</th><th>例 CR1</th><th>総計</th></tr></thead><tbody>
    ${row("稼働直", "実績のある直の数（作業日×直）", e.shifts, t("sh"))}
    ${row("稼働日", "実績のある作業日の数", e.days, t("dy"))}
    ${row("1日の直数", "勤務体系の直の数（マスタ管理の勤務体系）", e.spd, "–")}
    ${row("期間の日数", "パネルの期間（直近 14 日）の日数", e.cal, e.cal)}
    ${row("期間の直数", "期間の日数 × 1日の直数", e.calShifts, t("csh"))}
    <tr class="sep"><td colspan="4">作った数（このダッシュボードで共通）</td></tr>
    ${row("換算稼働日", "<code>[稼働直]÷[1日の直数]</code>　月の稼働日数にも", CX.n(CX.K.cdy(e), 1), CX.n(t("cdy"), 1), true)}
    ${row("稼働率", "<code>[稼働直]÷[期間の直数]×100</code>", CX.n(CX.K.rate(e), 1) + "%", CX.n(t("rate"), 1) + "%", true)}
    </tbody></table>
    <button type="button" class="pv-btn cx-add">＋ 基準の数を作る</button>
    <div class="cx-use"><b>このパネルで使っている所</b><br>重量の合計 <code>÷1000÷[換算稼働日]</code> → 日あたり ${CX.n(t("tpd"), 1)}t（総計）</div></div>`);
  const m = CX.$("#dbEditor .de-main"); if (m) m.scrollTop = 0;
}

/* ------------------------------------------------------------------ G: 文に「［稼働直］あたりで」の枠（すべての値に効く。基準の数も表に並べる） */
function G_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "稼働直（基準）", k: "sh", d: 0, cls: "cx-m" }, { h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直" }]);
}
function G_edit() {
  CX.style(`
    .pv-chip.cx-pc{background:#41525f;border-color:#41525f;color:#fff}
    .pv-chip.cx-pc button{color:#fff}
    .cx-pers{display:flex;flex-wrap:wrap;align-items:center;gap:6px 6px;margin:6px 2px 0;font-size:12.5px}
    .cx-pers .cx-l{color:#56616b;font-size:12px;white-space:nowrap}
    .cx-pb{height:26px;padding:0 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer;white-space:nowrap}
    .cx-pb.on{background:#41525f;border-color:#41525f;color:#fff;font-weight:700}
    .cx-pers label{display:inline-flex;align-items:center;gap:5px;margin-left:6px;white-space:nowrap}
    .cx-pers small{flex-basis:100%;color:#56616b;font-size:12px}`);
  const s = CX.$("#deSent .pv-sent"), last = [...s.querySelectorAll(".pv-w")].pop();
  last.insertAdjacentHTML("beforebegin", `<span class="pv-w" style="order:7">を</span><span class="pv-slot" data-role="per" style="order:7"><span class="pv-chip cx-pc" tabindex="0"><b>稼働直</b><button type="button" aria-label="「稼働直あたり」を外す">×</button></span></span><span class="pv-w" style="order:7">あたりで</span>`);
  last.textContent = "出す";
  s.insertAdjacentHTML("afterend", `<div class="cx-pers" role="radiogroup" aria-label="何あたりで出すか"><span class="cx-l">あたり</span>
    ${["なし", "稼働直", "稼働日", "日（直から換算）", "期間の日"].map((x) => `<button type="button" class="cx-pb${x === "稼働直" ? " on" : ""}">${x}</button>`).join("")}
    <label><input type="checkbox" checked>基準の数も表に出す</label>
    <small>稼働直＝実績のある直の数（作業日×直）。すべての値をこれで割ります（値の計算の ÷1000 などはその前に当たります）</small></div>`);
  CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  CX.setOut(1, CX.prev("1,620,185", "1,620.2t"));
  CX.scrollTo("#deSent", 90);
}

const go = (...fns) => fns.map((f) => `(${f})();`).join("");
export const PROPOSALS = [
  { key: "now", name: "今（基準の数は無い）", css: "", ops: [] },
  { key: "A", name: "値の計算の段に「÷稼働直」の札", css: "", ops: [], after: { cap: go(H, A_panel), "cap-edit": go(H, A_panel, A_edit) } },
  { key: "B", name: "基準の数の札（値つき）と見本", css: "", ops: [], after: { cap: go(H, B_panel), "cap-edit": go(H, B_panel, B_edit) } },
  { key: "C", name: "値の札に「あたり」の選び", css: "", ops: [], after: { cap: go(H, C_panel), "cap-edit": go(H, C_panel, C_edit) } },
  { key: "D", name: "基準の数をカラムの札に（表に並べる）", css: "", ops: [], after: { cap: go(H, D_panel), "cap-edit": go(H, D_panel, D_edit) } },
  { key: "E", name: "専用の形「設備の実力」", css: "", ops: [], after: { cap: go(H, E_view), "cap-edit": go(H, E_view, E_edit) } },
  { key: "F", name: "組む所のタブ「基準の数」", css: "", ops: [], after: { cap: go(H, F_panel), "cap-edit": go(H, F_panel, F_edit) } },
  { key: "G", name: "文に「［稼働直］あたりで」の枠", css: "", ops: [], after: { cap: go(H, G_panel), "cap-edit": go(H, G_panel, G_edit) } },
];
