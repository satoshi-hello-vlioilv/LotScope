// 設備の実力（基準の数。利用者の要望 2026-11-12）の改良案。撮るのは状態 cap・cap-edit（版 3.103.0 から ui-harness.mjs の STATES。
// 案を撮ったときは scratchpad の cap-shot.mjs〈ui-variants.mjs の写しに状態を足した物〉。after の文の中で window.CAP〈設備ごとの本物の数〉を使う）。
// 2 回目（このファイル）の I（見本から組む）＋ H の「÷ 基準 ▾」の面に決めた（採点 2026-11-capacity.json: I 80.6 点）。1 回目の案は 2026-11-capacity-1.mjs。
// 設備の実力（直あたり・日あたり・稼働率・月の稼働日数）— 改良案（2 回目）。撮るのは ../cap-shot.mjs（状態 cap・cap-edit）。
// 土台（どの案も同じ）: 1 つの「基準の数」の仕組み。決まった数（稼働直・稼働日・1日の直数・期間の日数・期間の直数）と、
// 名前を付けて作った数（換算稼働日＝稼働直÷1日の直数・稼働率＝稼働直÷期間の直数×100。ダッシュボードで共通）。
// 使い方は 2 つに分ける: 割る（あたり。値ごとに選ぶ）／値として足す（稼働直・稼働率などを表の列に）。打たずに選ぶ。
// 値の計算の前→後は、割った後の数と単位（表と同じ）。総計は Σ分子÷Σ分母。
// 新しい案: H（値ごとの「÷ 基準 ▾」の面）・I（見本から組む）・J（パネルの列の見出しから）・K（② の「あたり」の行）
// 持ち越して直した案: F2（← F。基準の数をカラムの欄の隣のタブに置き ÷・値 の手で使う）・G2（← G。文の型＋値ごとに変える・稼働率を値に）

function H() {
  if (window.CX) return;
  const CX = (window.CX = {});
  const C = window.CAP, E = Object.keys(C).sort();
  CX.E = E; CX.C = C;
  CX.n = (v, d = 1) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const K = (CX.K = {
    lots: (e) => e.lots, t: (e) => e.w / 1000, sh: (e) => e.shifts, dy: (e) => e.days, spd: (e) => e.spd, cal: (e) => e.cal, csh: (e) => e.calShifts,
    tps: (e) => e.w / 1000 / e.shifts, lps: (e) => e.lots / e.shifts, cdy: (e) => e.shifts / e.spd, tpd: (e) => e.w / 1000 / (e.shifts / e.spd),
    rate: (e) => (e.shifts / e.calShifts) * 100 });
  const sum = (f) => E.reduce((a, k) => a + f(C[k]), 0);
  const S = { lots: sum(K.lots), t: sum(K.t), sh: sum(K.sh), dy: sum(K.dy), csh: sum(K.csh), cdy: sum(K.cdy) };
  CX.tot = (k) => ({ lots: S.lots, t: S.t, sh: S.sh, dy: S.dy, cdy: S.cdy, csh: S.csh, spd: null, cal: C[E[0]].cal, tps: S.t / S.sh, lps: S.lots / S.sh,
    tpd: S.t / S.cdy, rate: (S.sh / S.csh) * 100 }[k]);
  // 基準の数（決まった数と作った数）。例は CR1、総計は全設備（Σ）
  const e1 = C.CR1;
  CX.BASES = [
    { k: "sh", n: "稼働直", d: '<span class="nb">実績のある直の数</span><span class="nb">（作業日×直）</span>', ex: e1.shifts, tot: S.sh, dec: 0, u: "直" },
    { k: "dy", n: "稼働日", d: "実績のある作業日の数", ex: e1.days, tot: S.dy, dec: 0, u: "日" },
    { k: "cdy", n: "換算稼働日", d: "稼働直÷1日の直数", ex: K.cdy(e1), tot: S.cdy, dec: 1, u: "日", own: true },
    { k: "spd", n: "1日の直数", d: "勤務体系の直の数", ex: e1.spd, tot: null, dec: 0, u: "直" },
    { k: "cal", n: "期間の日数", d: "パネルの期間の日数", ex: e1.cal, tot: e1.cal, dec: 0, u: "日" },
    { k: "csh", n: "期間の直数", d: '<span class="nb">期間の日数×</span><span class="nb">1日の直数</span>', ex: e1.calShifts, tot: S.csh, dec: 0, u: "直" },
  ];
  CX.ADDS = [
    { k: "sh", n: "稼働直", d: "実績のある直の数" }, { k: "cdy", n: "換算稼働日", d: "稼働直÷1日の直数", own: true },
    { k: "rate", n: "稼働率", d: "稼働直÷期間の直数", own: true }, { k: "dy", n: "稼働日", d: "実績のある作業日の数" }];
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
    if (id === "cap") { const nm = [...document.querySelectorAll("#dbEditor input")].find((x) => x.value === "設備ごとの実績（直近 14 日）"); if (nm) { nm.value = t; nm.setAttribute("value", t); } }
  };
  CX.style = (css) => document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
  CX.$ = (s) => document.querySelector(s);
  CX.setIn = (i, v, w) => { const el = CX.$(`#deSent [data-pc-in="${i}"]`); if (el) { el.value = v; el.setAttribute("value", v); if (w) el.style.width = w; } };
  CX.setUnit = (i, v) => { const el = CX.$(`#deSent [data-pc-unit="${i}"]`); if (el) { el.value = v; el.setAttribute("value", v); } };
  CX.setOut = (i, html) => { const el = CX.$(`#deSent [data-pc-out="${i}"]`); if (el) el.innerHTML = html; };
  CX.prev = (a, b) => `<span class="pc-prev" title="総計: 計算の前 → 後">${a}<i aria-hidden="true">→</i>${b}</span>`;
  // 値の計算の前→後（割った後の数と単位。表の総計と同じ）
  CX.prevLots = () => CX.prev("322本", CX.n(CX.tot("lps"), 2) + "本/直");
  CX.prevW = () => CX.prev("1,620.2t", CX.n(CX.tot("tps"), 1) + "t/直");
  CX.scrollTo = (sel, off = 150) => {
    const m = CX.$("#dbEditor .de-main"), f = CX.$(sel);
    if (m && f) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - off);
    window.scrollTo(0, 0);
  };
  CX.months = () => [...new Set(E.flatMap((k) => Object.keys(C[k].month || {})))].sort();
  CX.style(`
    .cx-t td.cx-m{color:#56616b;background:color-mix(in srgb,var(--surface) 88%,#e8edf2)}
    .cx-t td.cx-k{font-weight:800}
    .nb{display:inline-block}
    .cx-dv{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer;white-space:nowrap}
    .cx-dv b{font-weight:800}
    .cx-dv.on{border-color:var(--pv-val);background:#fff7e6;color:#6b4a10;box-shadow:inset 0 0 0 1px var(--pv-val)}
    .cx-dv .x{margin-left:2px;color:#8a6a2f}
    .cx-pop{position:absolute;z-index:30;width:min(430px,calc(100% - 12px));padding:8px 0 6px;border:1px solid #c9d3dc;border-radius:10px;background:var(--surface);box-shadow:0 10px 28px rgba(20,35,50,.22);font-size:12.5px;white-space:normal}
    .cx-pop h5{margin:0 12px 6px;font-size:12.5px;font-weight:800;color:var(--ink)}
    .cx-pop .sec{margin:6px 12px 2px;font-size:11.5px;font-weight:800;color:#56616b}
    .cx-pop .it{display:grid;grid-template-columns:16px 1fr 46px 50px;gap:0 8px;align-items:center;padding:5px 12px;cursor:pointer}
    .cx-pop .it:hover{background:#f3f6f9}
    .cx-pop .it.on{background:#fff4dc}
    .cx-pop .it i{width:10px;height:10px;border-radius:50%;border:1.5px solid #8a96a2;justify-self:center}
    .cx-pop .it.on i{border-color:var(--pv-val);background:var(--pv-val)}
    .cx-pop .it b{font-weight:800}
    .cx-pop .it small{display:block;color:#56616b;font-size:12px}
    .cx-pop .it em{font-style:normal;text-align:right;font-variant-numeric:tabular-nums;color:#38434d}
    .cx-pop .hd{display:grid;grid-template-columns:16px 1fr 46px 50px;gap:0 8px;padding:0 12px 3px;font-size:11.5px;color:#56616b;border-bottom:1px solid var(--line-soft,#e3e8ee)}
    .cx-pop .hd span{text-align:right}
    .cx-pop .ft{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:4px;padding:6px 12px 0;border-top:1px solid var(--line-soft,#e3e8ee)}
    .cx-pop .ft button{height:26px;padding:0 10px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer}
    .cx-pb{height:26px;padding:0 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer;white-space:nowrap}
    .cx-pb small{margin-left:4px;color:#56616b;font-size:11.5px}
    .cx-pb.on{background:#fff7e6;border-color:var(--pv-val);color:#6b4a10;font-weight:800;box-shadow:inset 0 0 0 1px var(--pv-val)}
    .cx-bvchip.pv-chip{background:#5c6b78;border-color:#5c6b78;color:#fff}
    .cx-bvchip.pv-chip button{color:#fff}
  `);
  /** 割る数の面（数つき・総計・作った数・作る）。sel … 選んでいる名前 */
  CX.pop = (title, sel) => {
    const it = (b) => `<div class="it${b.n === sel ? " on" : ""}" role="option" aria-selected="${b.n === sel}"><i></i><span><b>${b.n}</b><small>${b.d}</small></span>`
      + `<em>${CX.n(b.ex, b.dec)}</em><em>${b.tot == null ? "–" : CX.n(b.tot, b.dec)}</em></div>`;
    return `<div class="cx-pop" role="listbox" aria-label="${title}"><h5>${title}</h5><div class="hd"><i></i><b>基準の数（行ごとに数える）</b><span>例 CR1</span><span>総計</span></div>`
      + CX.BASES.filter((b) => !b.own).map(it).join("") + `<div class="sec">作った数（このダッシュボードで共通）</div>`
      + CX.BASES.filter((b) => b.own).map(it).join("")
      + `<div class="ft"><button type="button">なし（割らない）</button><button type="button">＋ 基準の数を作る…</button></div></div>`;
  };
}

/* ------------------------------------------------------------------ H: 値ごとの「÷ 基準 ▾」の面（新） */
function H_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "稼働直", k: "sh", d: 0, cls: "cx-m" }, { h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直", cls: "cx-k" }, { h: "稼働率", k: "rate", d: 0, unit: "%" }]);
}
function H_edit() {
  CX.style(`#deSent .pc-band{position:relative}`);
  const btn = (i, on) => `<button type="button" class="cx-dv${on ? " on" : ""}" data-cx-dv="${i}" aria-haspopup="listbox" title="この値を割る数（あたり）"><span>÷</span><b>${on || "基準"}</b><span aria-hidden="true">▾</span></button>`;
  document.querySelectorAll("#deSent .pc-item").forEach((it, i) => it.querySelector(".pc-in").insertAdjacentHTML("afterend", btn(i, "稼働直")));
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(1, "÷1000");
  CX.setOut(0, CX.prevLots()); CX.setOut(1, CX.prevW());
  CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  // 値として足す（割る数と分ける）: 稼働直・稼働率 を値の札に
  const vals = CX.$('#deSent .pv-slot[data-role="vals"]');
  vals.insertAdjacentHTML("afterbegin", `<span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働直</b><button type="button">×</button></span>`);
  vals.insertAdjacentHTML("beforeend", `<span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働率</b><button type="button">×</button></span>`
    + `<button type="button" class="pv-btn cx-addb">＋ 基準の数を値に ▾</button>`);
  CX.style(`.cx-addb{height:26px;padding:0 9px;font-size:12.5px} .cx-bnote{grid-column:1 / -1;font-size:12px;color:#56616b}`);
  CX.$("#deSent .pc-band").insertAdjacentHTML("beforeend", `<div class="cx-bnote"><span class="nb">灰の札（稼働直・稼働率）は基準の数を値にした物で、割る数は選べません。</span></div>`);
  // 重量の合計の「÷ 稼働直 ▾」を開いた所
  const b = CX.$('[data-cx-dv="1"]'), band = CX.$("#deSent .pc-band");
  CX.scrollTo("#deSent .pc-band", 200);
  // 面は頁の上に出す（組む所の縁で切れない）。下に入らなければボタンの上へ開く
  document.body.insertAdjacentHTML("beforeend", CX.pop("「重量の合計」を割る数（あたり）", "稼働直"));
  const pop = document.body.lastElementChild, rb = b.getBoundingClientRect();
  pop.style.position = "fixed"; pop.style.width = "430px";
  const h = pop.offsetHeight, below = rb.bottom + 4 + h <= innerHeight - 8;
  pop.style.top = `${below ? rb.bottom + 4 : Math.max(8, rb.top - 4 - h)}px`;
  pop.style.left = `${Math.max(8, Math.min(rb.left, innerWidth - 438))}px`;
}

/* ------------------------------------------------------------------ I: 見本から組む（② の頭に見本の札。組んだ後はふつうの組み方）（新） */
function I_panel() {
  CX.style(`
    .cx-cap{display:grid;grid-template-columns:max-content 1fr 132px max-content;gap:0 14px;align-items:center;height:100%;padding:2px 4px 0;font-size:14px;font-variant-numeric:tabular-nums}
    .cx-cap .h{font-size:12px;font-weight:700;color:#56616b;padding-bottom:4px;border-bottom:1px solid var(--line);white-space:nowrap}
    .cx-cap .h.r{text-align:right}
    .cx-cap .n{font-weight:800}
    .cx-cap .b{display:flex;align-items:center;gap:8px}
    .cx-cap .b span{height:14px;border-radius:3px;background:#2f7d78}
    .cx-cap .b em{font-style:normal;font-weight:800;min-width:46px}
    .cx-cap .r{display:flex;align-items:center;gap:6px}
    .cx-cap .r s{flex:1;height:8px;border-radius:4px;background:#e3e8ee;position:relative;text-decoration:none}
    .cx-cap .r s::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);border-radius:4px;background:#8a6a2f}
    .cx-cap .r em{font-style:normal;font-weight:700;min-width:38px;text-align:right}
    .cx-cap .c{color:#56616b;text-align:right;font-size:13px}
    .cx-cap .g{border-top:1px solid var(--line);padding-top:3px;font-weight:800}
    .cx-mt th,.cx-mt td{font-variant-numeric:tabular-nums}`);
  const p = CX.panel("cap"); if (!p) return;
  CX.title("cap", "設備の実力（直あたり重量）", "実績・全設備　直近 14 日 9/20〜10/3（現場歴）　見本「設備の実力」から組んだ表");
  const E = [...CX.E].sort((a, b) => CX.K.tps(CX.C[b]) - CX.K.tps(CX.C[a])), max = Math.max(...E.map((k) => CX.K.tps(CX.C[k])));
  const row = (k, e, g) => `<span class="n${g}">${k}</span><span class="b${g}"><span style="width:${(CX.K.tps(e) / max) * 72}%"></span><em>${CX.n(CX.K.tps(e), 1)}t/直</em></span>`
    + `<span class="r${g}"><s style="--w:${CX.K.rate(e)}%"></s><em>${CX.n(CX.K.rate(e), 0)}%</em></span><span class="c${g}">${e.shifts}/${e.calShifts}</span>`;
  p.querySelector(".db-pb").innerHTML = `<div class="cx-cap"><span class="h">設備</span><span class="h">重量の合計 ÷稼働直</span><span class="h">稼働率</span><span class="h r">稼働直/期間の直数</span>`
    + E.map((k) => row(k, CX.C[k], "")).join("")
    + `<span class="n g">総計</span><span class="b g"><em>${CX.n(CX.tot("tps"), 1)}t/直</em></span><span class="r g"><em>${CX.n(CX.tot("rate"), 0)}%</em></span><span class="c g">${CX.tot("sh")}/${CX.tot("csh")}</span></div>`;
  // 右のパネル: 見本「月ごとの稼働日数」（行＝設備・列＝作業月・値＝換算稼働日＝稼働直÷1日の直数）
  const q = CX.panel("capBar"); if (!q) return;
  const ms = CX.months().slice(-3);
  q.querySelector("h3").textContent = "月ごとの稼働日数（換算稼働日）";
  const sub = q.querySelector(".db-psub"); if (sub) sub.textContent = "実績・全設備　期間で絞らない　稼働直÷1日の直数（見本「月の稼働日数」）";
  const tb = `<div class="dp-tbl"><table class="pv-table cx-mt" style="font-size:15px;--dp-pad:9px 8px"><thead><tr><th class="pv-corner">設備</th>${ms.map((m) => `<th class="pv-mh">${+m.slice(5)}月</th>`).join("")}</tr></thead><tbody>`
    + CX.E.map((k) => `<tr><th>${k}</th>${ms.map((m) => `<td>${CX.n((CX.C[k].month[m] || 0) / CX.C[k].spd, 1)}日</td>`).join("")}</tr>`).join("")
    + `<tr class="is-grand"><th class="pv-gt">総計</th>${ms.map((m) => `<td>${CX.n(CX.E.reduce((a, k) => a + (CX.C[k].month[m] || 0) / CX.C[k].spd, 0), 1)}日</td>`).join("")}</tr></tbody></table></div>`;
  const pb = q.querySelector(".db-pb"); pb.innerHTML = tb;
  // 行の高さをパネルの高さに合わせる（見出し＋設備＋総計が全部入る）
  const rows = CX.E.length + 2, rh = Math.max(18, Math.floor((pb.clientHeight - 4) / rows));
  const fs = Math.max(12, Math.min(15, rh - 9)), pad = Math.max(1, Math.floor((rh - fs * 1.35) / 2));
  const t = pb.querySelector("table"); t.style.fontSize = `${fs}px`; t.style.setProperty("--dp-pad", `${pad}px 8px`);
  t.querySelectorAll("th,td").forEach((c) => { c.style.padding = `${pad}px 8px`; c.style.lineHeight = "1.35"; });
}
function I_edit() {
  CX.style(`
    .cx-ex2{margin:4px 0 8px;padding:8px 10px;border:1px solid #c9d3dc;border-radius:10px;background:color-mix(in srgb,var(--surface) 80%,#eef3f7)}
    .cx-ex2 h5{margin:0 0 6px;font-size:12.5px;font-weight:800;color:var(--ink);display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
    .cx-ex2 h5 small{font-weight:600;color:#56616b;font-size:12px}
    .cx-exl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .cx-exb2{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font:inherit;text-align:left;cursor:pointer}
    .cx-exb2 b{font-size:12.5px;font-weight:800;color:var(--ink)}
    .cx-exb2 small{font-size:12px;color:#56616b}
    .cx-exb2.on{border-color:var(--h-input);box-shadow:inset 0 0 0 1px var(--h-input);background:var(--input-soft)}`);
  const ex = [["設備の実力", "重量÷稼働直・稼働率・稼働直", 1], ["月の稼働日数", "設備×作業月の換算稼働日", 0], ["日あたり重量の推移", "作業日ごとの 重量÷換算稼働日", 0], ["直あたりロット数", "設備ごとの ロット数÷稼働直", 0]];
  CX.$("#deSent").insertAdjacentHTML("beforebegin", `<div class="cx-ex2" role="group" aria-label="見本から組む"><h5>見本から組む<small>押すと、このパネルの行・値・計算・並べ方が入ります（あとで自由に直せます）</small></h5>`
    + `<div class="cx-exl">${ex.map(([n, d, on]) => `<button type="button" class="cx-exb2${on ? " on" : ""}"><b>${on ? "✓ " : ""}${n}</b><small>${d}</small></button>`).join("")}</div></div>`);
  // 入った組み: 値＝稼働直（基準の数）・重量の合計（÷1000 ÷稼働直）・稼働率（基準の数）
  const vals = CX.$('#deSent .pv-slot[data-role="vals"]');
  vals.querySelector('[data-dnd-i="0"]').outerHTML = "";
  vals.insertAdjacentHTML("beforeend", `<span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働率</b><button type="button">×</button></span><span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働直</b><button type="button">×</button></span>`);
  const band = CX.$("#deSent .pc-band"); band.querySelector('.pc-item[data-pc-i="0"]').remove();
  const it = band.querySelector('.pc-item[data-pc-i="1"]');
  it.querySelector(".pc-in").insertAdjacentHTML("afterend", `<button type="button" class="cx-dv on" title="この値を割る数（あたり）"><span>÷</span><b>稼働直</b><span aria-hidden="true">▾</span></button>`);
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(1, "÷1000"); CX.setOut(1, CX.prevW()); CX.setUnit(1, "t/直");
  const vb = [...document.querySelectorAll("#deVis button")].find((x) => x.textContent.trim() === "表"); if (vb) vb.innerHTML = "▦ 表（数を棒で）";
  const so = CX.$("#deSort select"); if (so) { const o = [...so.options].find((x) => /大きい/.test(x.textContent)); if (o) so.value = o.value; }
  CX.scrollTo(".cx-ex2", 56);
}

/* ------------------------------------------------------------------ J: パネルの列の見出しから（右クリック・▾ の面で割る・列を足す）（新） */
function J_menu(editing) {
  document.querySelectorAll(".cx-menu").forEach((x) => x.remove());
  CX.style(`
    .cx-th{position:relative}
    .cx-th .cx-tv{margin-left:6px;padding:0 5px;border-radius:4px;background:rgba(255,255,255,.18);font-size:11px}
    .cx-menu{position:fixed;z-index:60;min-width:220px;padding:5px 0;border:1px solid #c9d3dc;border-radius:9px;background:var(--surface);box-shadow:0 10px 28px rgba(20,35,50,.25);font-size:13px;color:var(--ink)}
    .cx-menu .mi{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:6px 12px;white-space:nowrap}
    .cx-menu .mi.on{background:#eef3f7}
    .cx-menu .mi small{color:#56616b;font-size:12px}
    .cx-menu hr{margin:4px 0;border:0;border-top:1px solid var(--line-soft,#e3e8ee)}
    .cx-menu .cap{padding:3px 12px 2px;font-size:11.5px;font-weight:800;color:#56616b}
    .cx-sub{min-width:300px}
    .cx-sub .mi{display:grid;grid-template-columns:14px 1fr 40px 48px;gap:0 8px}
    .cx-sub .mi i{font-style:normal;color:var(--pv-val);font-weight:800}
    .cx-sub .mi em{font-style:normal;text-align:right;font-variant-numeric:tabular-nums;color:#38434d}
    .cx-sub .mi.hd{font-size:11.5px;color:#56616b;padding-top:2px;padding-bottom:2px}`);
  const p = CX.panel("cap"); if (!p) return;
  const th = [...p.querySelectorAll("thead th")].find((x) => /重量/.test(x.textContent)); if (!th) return;
  th.classList.add("cx-th"); th.style.outline = "2px solid #e6a52e"; th.style.outlineOffset = "-2px";
  const r = th.getBoundingClientRect();
  const top = r.bottom + 2, left = Math.min(r.left, innerWidth - 560);
  const m = document.createElement("div"); m.className = "cx-menu"; m.style.top = `${top}px`; m.style.left = `${left}px`;
  m.innerHTML = `<div class="cap">「重量の合計」の列</div><div class="mi">大きい順に並べる</div><div class="mi">小さい順に並べる</div><hr>`
    + `<div class="mi on"><span>÷ 割る（あたり）</span><small>${editing ? "稼働直 ▸" : "▸"}</small></div><div class="mi"><span>＋ 隣に基準の数の列を足す</span><small>▸</small></div><hr>`
    + `<div class="mi"><span>値の計算・単位…</span><small>組む所で</small></div><div class="mi"><span>列の値をコピー</span><small></small></div>`;
  document.body.append(m);
  const s = document.createElement("div"); s.className = "cx-menu cx-sub";
  const mr = m.getBoundingClientRect(), on = m.querySelector(".mi.on").getBoundingClientRect();
  s.style.top = `${on.top - 30}px`; s.style.left = `${mr.right - 4}px`;
  s.innerHTML = `<div class="cap">割る数（行ごとに数える）</div><div class="mi hd"><span></span><span></span><em>例 CR1</em><em>総計</em></div>`
    + CX.BASES.map((b) => `<div class="mi${b.n === "稼働直" ? " on" : ""}"><i>${b.n === "稼働直" && editing ? "✓" : ""}</i><span>${b.n}${b.own ? " <small>作った数</small>" : ""}</span><em>${CX.n(b.ex, b.dec)}</em><em>${b.tot == null ? "–" : CX.n(b.tot, b.dec)}</em></div>`).join("")
    + `<hr><div class="mi"><i></i><span>＋ 基準の数を作る…</span><em></em><em></em></div>`;
  document.body.append(s);
  const sr = s.getBoundingClientRect(); if (sr.right > innerWidth - 8) s.style.left = `${mr.left - sr.width + 4}px`;
  if (sr.bottom > innerHeight - 8) s.style.top = `${innerHeight - 8 - sr.height}px`;
}
function J_view() { J_menu(false); }
function J_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "ロット数", k: "lots", d: 0, unit: "本" }, { h: "稼働直", k: "sh", d: 0, cls: "cx-m" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直", cls: "cx-k" }]);
}
function J_edit() {
  // 組む所: 列の見出しで選んだ「÷ 稼働直」が値の計算の段に札で出る（同じ物が 2 か所で直せる）
  const it = CX.$('#deSent .pc-item[data-pc-i="1"]');
  it.querySelector(".pc-in").insertAdjacentHTML("afterend", `<button type="button" class="cx-dv on" title="この値を割る数（あたり）"><span>÷</span><b>稼働直</b><span aria-hidden="true">▾</span></button>`);
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(1, "÷1000"); CX.setOut(1, CX.prevW()); CX.setUnit(1, "t/直");
  const vals = CX.$('#deSent .pv-slot[data-role="vals"]');
  vals.querySelector('[data-dnd-i="1"]').insertAdjacentHTML("beforebegin", `<span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働直</b><button type="button">×</button></span>`);
  CX.setUnit(0, "本");
  document.querySelectorAll(".cx-menu").forEach((x) => x.remove());
  CX.scrollTo("#deSent", 90);
}

/* ------------------------------------------------------------------ K: ② の「あたり」の行（期間のすぐ下。期間と同じ行の型）（新） */
function K_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "稼働直", k: "sh", d: 0, cls: "cx-m" }, { h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直", cls: "cx-k" }]);
}
function K_edit() {
  CX.style(`
    .cx-per{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;align-items:center;margin:4px 0 10px;padding:8px 10px;border:1px solid #c9d3dc;border-radius:10px;background:color-mix(in srgb,var(--surface) 80%,#eef3f7);font-size:13px}
    .cx-per .de-l{font-weight:800;color:var(--ink)}
    .cx-pills{display:flex;flex-wrap:wrap;gap:5px}
    .cx-per .de-seg small{margin-left:5px;font-weight:600;color:#56616b;font-size:11.5px}
    .cx-per .de-seg.on small{color:var(--h-input)}
    .cx-per .row{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}
    .cx-per label.ck{display:inline-flex;gap:5px;align-items:center;white-space:nowrap}
    .cx-per .de-hint{grid-column:2}`);
  const seg = (list, on) => `<span class="cx-pills" role="radiogroup">${list.map(([x, t]) => `<button type="button" role="radio" class="cx-pb${x === on ? " on" : ""}">${x}${t ? `<small>${t}</small>` : ""}</button>`).join("")}</span>`;
  const t = (k) => CX.n(CX.tot(k), k === "cdy" ? 1 : 0);
  CX.$("#deSent").insertAdjacentHTML("afterend", `<div class="cx-per" role="group" aria-label="あたり（基準の数で割る）">
    <span class="de-l">あたり</span>${seg([["なし", ""], ["稼働直", t("sh")], ["稼働日", t("dy")], ["換算稼働日", t("cdy")], ["期間の日数", "14"]], "稼働直")}
    <span class="de-l">割る値</span><span class="row"><label class="ck"><input type="checkbox" checked>ロット数</label><label class="ck"><input type="checkbox" checked>重量の合計</label></span>
    <span class="de-l">表に出す</span><span class="row"><label class="ck"><input type="checkbox" checked>稼働直</label><label class="ck"><input type="checkbox">稼働日</label><label class="ck"><input type="checkbox">稼働率</label><button type="button" class="pv-btn" style="height:24px;font-size:12px">基準の数…</button></span>
    <small class="de-hint"><span class="nb">札の数は総計。</span><span class="nb">稼働直＝実績のある直の数（作業日×直）を、</span><span class="nb">行ごとに数えて割ります。</span></small></div>`);
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(1, "÷1000"); CX.setOut(0, CX.prevLots()); CX.setOut(1, CX.prevW());
  CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  CX.scrollTo("#deSent .pc-band", 30);
}

/* ------------------------------------------------------------------ F2: 基準の数をカラムの欄の隣のタブに（÷・値 の手。定義・例・総計・作った数）（← F） */
function F2_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "稼働直", k: "sh", d: 0, cls: "cx-m" }, { h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直", cls: "cx-k" }]);
}
function F2_edit() {
  CX.style(`
    .cx-lt{display:flex;gap:2px;margin:0 0 6px;border-bottom:2px solid var(--line-soft,#e3e8ee)}
    .cx-lt button{height:30px;padding:0 10px;border:0;border-bottom:3px solid transparent;margin-bottom:-2px;background:none;font:inherit;font-size:13px;font-weight:800;color:var(--h-meta);cursor:pointer}
    .cx-lt button.on{color:var(--h-input);border-bottom-color:var(--h-input)}
    .cx-bl .tip{margin:0 2px 6px;font-size:12px;color:#56616b;line-height:1.5}
    .cx-bl .tip b{color:#6b4a10}
    .cx-bl .sec{margin:8px 2px 4px;font-size:12px;font-weight:800;color:#41525f}
    .cx-bf{display:grid;grid-template-columns:1fr auto;gap:2px 6px;align-items:center;padding:6px 8px;margin-bottom:5px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
    .cx-bf b{font-size:13px;font-weight:800}
    .cx-bf small{grid-column:1 / -1;font-size:12px;color:#56616b;line-height:1.4}
    .cx-bf .nums{grid-column:1 / -1;font-size:12px;color:#38434d;font-variant-numeric:tabular-nums;white-space:nowrap}
    .cx-bf .acts{grid-column:2;grid-row:1;display:flex;gap:4px}
    .cx-bf .acts button{width:30px;height:26px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font:inherit;font-size:12.5px;font-weight:800;color:var(--ink);cursor:pointer}
    .cx-bf .acts button.dv.on{background:var(--pv-val);border-color:var(--pv-val);color:#fff}
    .cx-bf .acts button.vl.on{background:#5c6b78;border-color:#5c6b78;color:#fff}
    .cx-bf.own b::after{content:" ✎";color:#56616b;font-weight:600}
    .cx-mk{font-size:12px;color:#56616b}
    #deSent .pv-chip.cx-sel{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--h-input)}`);
  const aside = CX.$("#deFields").closest("aside") || CX.$("#deFields").parentElement;
  const head = aside.firstElementChild;
  const fl = CX.$("#deFields"); fl.style.display = "none";
  const srch = CX.$("#deSearch")?.closest(".de-fsearch"); if (srch) srch.style.display = "none";
  [...aside.children].forEach((c) => { if (c !== fl && c !== srch && c !== head) c.style.display = "none"; });
  head.style.display = "none";
  const one = (b, dv, vl) => `<div class="cx-bf${b.own ? " own" : ""}"><b>${b.n}</b><small>${b.d}</small><span class="nums">例 CR1 ${CX.n(b.ex, b.dec)}　総計 ${b.tot == null ? "–" : CX.n(b.tot, b.dec)}</span>`
    + `<span class="acts"><button type="button" class="dv${dv ? " on" : ""}" title="選んでいる値を、この数で割る（あたり）">÷</button><button type="button" class="vl${vl ? " on" : ""}" title="この数を値として表に出す">値</button></span></div>`;
  const rate = { n: "稼働率", d: "稼働直÷期間の直数×100", ex: CX.K.rate(CX.C.CR1), tot: CX.tot("rate"), dec: 1, own: true };
  aside.insertAdjacentHTML("afterbegin", `<div class="cx-lt" role="tablist"><button type="button" role="tab">カラム</button><button type="button" role="tab" class="on">基準の数</button></div>`
    + `<div class="cx-bl"><p class="tip"><span class="nb"><b>÷</b> は選んでいる値</span><span class="nb">（重量の合計）を割り、</span><span class="nb"><b>値</b> は表に列で出します。</span></p>`
    + CX.BASES.filter((b) => !b.own).map((b) => one(b, b.n === "稼働直", b.n === "稼働直")).join("")
    + `<div class="sec">作った数（共通）</div>` + one(CX.BASES.find((b) => b.n === "換算稼働日"), false, false) + one(rate, false, false)
    + `<button type="button" class="pv-btn" style="width:100%;height:28px;font-size:12.5px">＋ 基準の数を作る</button></div>`);
  CX.$('#deSent .pv-chip.v[data-dnd-i="1"]')?.classList.add("cx-sel");
  const vals = CX.$('#deSent .pv-slot[data-role="vals"]');
  vals.insertAdjacentHTML("afterbegin", `<span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働直</b><button type="button">×</button></span>`);
  const it = CX.$('#deSent .pc-item[data-pc-i="1"]'), it0 = CX.$('#deSent .pc-item[data-pc-i="0"]');
  const tag = `<button type="button" class="cx-dv on" title="割る数（左の基準の数の ÷ で替える）"><span>÷</span><b>稼働直</b><span class="x" aria-label="外す">×</span></button>`;
  it.querySelector(".pc-in").insertAdjacentHTML("afterend", tag); it0.querySelector(".pc-in").insertAdjacentHTML("afterend", tag);
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(1, "÷1000"); CX.setOut(0, CX.prevLots()); CX.setOut(1, CX.prevW()); CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  CX.scrollTo("#deSent", 90);
}

/* ------------------------------------------------------------------ G2: 文の型「［値］を［稼働直 ▾］あたりで出す」＋値ごとに変える・稼働率を値に（← G） */
function G2_panel() {
  CX.title("cap", "設備ごとの直あたり実績");
  CX.setTable("cap", [{ h: "稼働直（基準）", k: "sh", d: 0, cls: "cx-m" }, { h: "ロット数", k: "lps", d: 2, unit: "本/直" }, { h: "重量の合計", k: "tps", d: 1, unit: "t/直", cls: "cx-k" }, { h: "稼働率", k: "rate", d: 0, unit: "%" }]);
}
function G2_edit() {
  CX.style(`
    .pv-chip.cx-pc{background:#fff7e6;border:1px solid var(--pv-val);color:#6b4a10;box-shadow:inset 0 0 0 1px var(--pv-val)}
    .pv-chip.cx-pc button{color:#6b4a10}
    .cx-pers{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 2px 0;font-size:12.5px}
    .cx-pers .cx-l{color:#56616b;font-size:12px;white-space:nowrap}
    .cx-pers label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
    .cx-pers .lk{color:var(--h-input);font-weight:700;text-decoration:underline;cursor:pointer;white-space:nowrap}
    .cx-pers small.h{flex-basis:100%;color:#56616b;font-size:12px}
    .cx-vt{flex:none;margin-left:4px;padding:0 5px;border-radius:4px;background:rgba(255,255,255,.22);font-size:11.5px;font-weight:700;white-space:nowrap}
    #deSent .pv-chip.v > b{flex:none;white-space:nowrap} #deSent .pv-chip.v select{max-width:5.4em}`);
  const s = CX.$("#deSent .pv-sent"), last = [...s.querySelectorAll(".pv-w")].pop();
  last.insertAdjacentHTML("beforebegin", `<span class="pv-w" style="order:7">を</span><span class="pv-slot" data-role="per" style="order:7"><span class="pv-chip cx-pc" tabindex="0"><b>稼働直</b></span></span><span class="pv-w" style="order:7">あたりで</span>`);
  last.textContent = "出す";
  // 値ごとの基準（札の後ろの小さな「／直」。押すとその値だけ変えられる）
  document.querySelectorAll('#deSent .pv-chip.v[data-dnd-i] > b').forEach((b) => b.insertAdjacentHTML("afterend", `<span class="cx-vt" title="この値の基準（押すとこの値だけ変える）">／直</span>`));
  const t = (k) => CX.n(CX.tot(k), k === "cdy" ? 1 : 0);
  s.insertAdjacentHTML("afterend", `<div class="cx-pers" role="radiogroup" aria-label="何あたりで出すか"><span class="cx-l">あたり</span>
    ${[["なし", ""], ["稼働直", t("sh")], ["稼働日", t("dy")], ["換算稼働日", t("cdy")], ["期間の日数", "14"]].map(([x, n]) => `<button type="button" class="cx-pb${x === "稼働直" ? " on" : ""}">${x}${n ? `<small>${n}</small>` : ""}</button>`).join("")}
    <label><input type="checkbox" checked>基準の数も表に出す</label><span class="lk">＋ 基準の数を値に</span>
    <small class="h"><span class="nb">札の数は総計。</span><span class="nb">値ごとに変えるときは、値の札の「／直」を押します。</span></small></div>`);
  // 稼働率を足した後の形: 値の札に灰の「稼働率」
  const vals = CX.$('#deSent .pv-slot[data-role="vals"]');
  vals.insertAdjacentHTML("beforeend", `<span class="pv-chip v cx-bvchip" data-dnd-role="vals" tabindex="0"><b>稼働率</b><button type="button">×</button></span>`);
  CX.$('#deSent .pc-q[data-pc-q="÷1000"][data-pc-qi="1"]')?.classList.add("on");
  CX.setIn(1, "÷1000"); CX.setOut(0, CX.prevLots()); CX.setOut(1, CX.prevW());
  CX.setUnit(0, "本/直"); CX.setUnit(1, "t/直");
  CX.scrollTo("#deSent", 90);
}

const go = (...fns) => fns.map((f) => `(${f})();`).join("");
export const PROPOSALS = [
  { key: "now", name: "今（基準の数は無い）", css: "", ops: [] },
  { key: "H", name: "値ごとの「÷ 基準 ▾」の面（新）", css: "", ops: [], after: { cap: go(H, H_panel), "cap-edit": go(H, H_panel, H_edit) } },
  { key: "I", name: "見本から組む（新）", css: "", ops: [], after: { cap: go(H, I_panel), "cap-edit": go(H, I_panel, I_edit) } },
  { key: "J", name: "パネルの列の見出しから（新）", css: "", ops: [], after: { cap: `window.J_menu = ${J_menu};` + go(H, J_view), "cap-edit": `window.J_menu = ${J_menu};` + go(H, J_panel, J_edit) } },
  { key: "K", name: "② の「あたり」の行（新）", css: "", ops: [], after: { cap: go(H, K_panel), "cap-edit": go(H, K_panel, K_edit) } },
  { key: "F2", name: "基準の数をカラムの欄の隣のタブに（← F）", css: "", ops: [], after: { cap: go(H, F2_panel), "cap-edit": go(H, F2_panel, F2_edit) } },
  { key: "G2", name: "文の型＋値ごとに変える・稼働率を値に（← G）", css: "", ops: [], after: { cap: go(H, G2_panel), "cap-edit": go(H, G2_panel, G2_edit) } },
];
