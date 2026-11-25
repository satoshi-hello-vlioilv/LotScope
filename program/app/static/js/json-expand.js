/* JSON の列を分ける窓（版 3.120.0。利用者の依頼 2026-11-17「６）JSONデータ列に対応してほしい」。案出し 2 回の採点で決めた K の形と first_fixes 1〜5）。
   1 枚の窓で左から右へ: ① 列（元の表の JSON に見える列と、形の割合の帯）→ ② 分け方（5 つの標準の形。説明・例・分けてできる行の数・合う割合・おすすめ）と
   足す列の名前・設備マスタの照らし合わせ → ③ 見本と確かめ（分けた見本・合わない行の数と理由と例）。下の段に できる表（元 › 列。何行 → 何行）と「表を作る」。
   - 開く所: 品質・仕掛などの一覧の道具の行の「{ } JSON」と、ダッシュボードの組む所のカラムの欄の「{ } JSON の列 n · 分ける…」（同じ窓）
   - どの表から作るかは窓の頭の札で選ぶ（ダッシュボードから開いたときは、組んでいるパネルのデータを先に選ぶ）
   - 表を作る: データ元に「元 › 列」の表（結合した表と同じ形。見出しのタブには出さない）を足す。同じ元・同じ列の表があれば決まりを直す。
     一覧から開いたときは、ダッシュボードに「鍵ごとの値の合計」のパネルも足せる（足したら知らせる）。組む所から開いたときは、そのパネルのデータにする
   - 数は窓（desktop/src/json_expand.rs）の答え: POST /api/sources/json/probe（先頭 500 行の見分け）・POST /api/sources/json/preview（全部の行で試す） */
(() => {
  "use strict";
  const esc = (s) => TPA.esc(String(s ?? ""));
  const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
  const pct = (a, b) => { if (!b) return "0%"; const p = (a * 100) / b; return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`; };
  const SHAPES = [
    { k: "dict", n: "①", name: "名前→値", how: "鍵ごとに行へ・「鍵」「値」の 2 列", eg: '{"ANF":0.365}' },
    { k: "list", n: "②", name: "値の並び", how: "要素ごとに行へ・「値」の 1 列", eg: "[3,5,8]" },
    { k: "rows", n: "③", name: "表の並び", how: "要素ごとに行へ・中の名前が列に", eg: '[{"設備":"L-1","回":2}]' },
    { k: "nest", n: "④", name: "入れ子の辞書", how: "列を足す（寸法.幅）・行は増えない", eg: '{"寸法":{"幅":1200}}' },
    { k: "dictrows", n: "⑤", name: "名前→表", how: "鍵ごとに行へ・中を列に", eg: '{"ANF":{"回":1}}' },
  ];
  const shapeOf = (k) => SHAPES.find((s) => s.k === k) || SHAPES[0];
  const KEYED = new Set(["dict", "dictrows"]);
  const VALUED = new Set(["dict", "list"]);

  let st = null;              // 開いている窓の状態
  let probes = new Map();     // 元 → 見分けの答え（Promise）
  let srcList = null;         // GET /api/sources の答え（Promise）
  document.addEventListener("tpa:sources-changed", () => { srcList = null; });

  async function getJson(url, body) {
    const r = await fetch(url, body ? TPA.json("POST", body) : { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `読めませんでした（${r.status}）`), { status: r.status, data: d });
    return d;
  }
  /** データ元の並び（元にできる表・作った分けた表） */
  function sources() {
    if (!srcList) srcList = getJson("/api/sources").then((d) => d.items || []).catch((e) => { srcList = null; throw e; });
    return srcList;
  }
  /** 元の見分け（先頭 500 行。覚える） */
  function probe(base) {
    if (!probes.has(base)) probes.set(base, getJson("/api/sources/json/probe", { base }).catch((e) => { probes.delete(base); throw e; }));
    return probes.get(base);
  }
  const bases = (items) => items.filter((x) => x.kind === "file");
  const viewFor = (items, base, col) => items.find((x) => x.kind === "view" && x.base === base && parse(x.expand).列 === col);
  function parse(t) { try { return t ? (typeof t === "string" ? JSON.parse(t) : t) : {}; } catch (_) { return {}; } }

  /* ---------------- 窓 ---------------- */
  /** 開く。o = {base: 元のキー, from: "list"|"dash", onDone(view)} */
  async function open(o = {}) {
    close();
    st = { from: o.from || "list", onDone: o.onDone || null, base: o.base || "lot", col: "", shape: "", key: "", value: "", path: "", items: [], probe: null,
      pre: null, err: "", busy: false, show: "", panel: o.from !== "dash", ask: 0, missingOpen: "" };
    document.body.insertAdjacentHTML("beforeend", '<div class="jx-back" data-jx-close></div><section class="jx" id="jxWin" role="dialog" aria-modal="true" aria-label="JSON の列を分ける"></section>');
    const win = document.getElementById("jxWin");
    win.addEventListener("click", onClick);
    win.addEventListener("input", onInput);
    win.addEventListener("change", onInput);
    document.querySelector(".jx-back").addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    paint();
    try { st.items = await sources(); } catch (e) { st.err = e.message; }
    if (!st) return;
    if (!bases(st.items).some((b) => b.key === st.base)) st.base = (bases(st.items)[0] || {}).key || "lot";
    // 札に出す元: 先頭 500 行に JSON の列がある元だけ（見分けは覚える。読めない元は出さない）
    const keys = bases(st.items).map((b) => b.key);
    const got = await Promise.all(keys.map((k) => probe(k).then((d) => (d.columns || []).length > 0).catch(() => false)));
    if (!st) return;
    st.withJson = new Set(keys.filter((k, i) => got[i]));
    if (!st.withJson.has(st.base) && st.withJson.size) st.base = [...st.withJson][0];
    await pickBase(st.base);
  }
  function close() {
    document.getElementById("jxWin")?.remove();
    document.querySelector(".jx-back")?.remove();
    document.removeEventListener("keydown", onKey, true);
    st = null;
  }
  function onKey(e) {
    if (!st) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  }
  async function pickBase(base) {
    Object.assign(st, { base, probe: null, pre: null, col: "", err: "", show: "", missingOpen: "" });
    paint();
    try { st.probe = await probe(base); } catch (e) { if (st) { st.err = e.message; paint(); } return; }
    if (!st || st.base !== base) return;
    const cols = st.probe.columns || [];
    if (cols.length) pickCol(cols[0].column); else paint();
  }
  function pickCol(col) {
    const c = (st.probe.columns || []).find((x) => x.column === col); if (!c) return;
    const had = viewFor(st.items, st.base, col), spec = parse(had && had.expand);
    const sug = c.suggest || {};
    const taken = new Set((st.probe.baseColumns || []).map((x) => x.toLowerCase()));
    const free = (n) => (taken.has(String(n).toLowerCase()) ? `${n}2` : n);
    Object.assign(st, { col, shape: spec.形 || c.best || "dict", key: spec.鍵 || free(sug.鍵 || "鍵"), value: spec.値 || free(sug.値 || "値"), path: spec.道筋 || "", show: "", missingOpen: "" });
    ask();
  }
  /** 試す（全部の行）。名前だけ替えたときは問い合わせない（見出しはその場で替える） */
  async function ask() {
    const n = ++st.ask;
    st.busy = true; paint();
    try {
      const d = await getJson("/api/sources/json/preview", { base: st.base, 展開: spec() });
      if (!st || n !== st.ask) return;
      st.pre = d; st.err = "";
    } catch (e) { if (!st || n !== st.ask) return; st.err = e.message; st.pre = null; }
    st.busy = false; paint();
  }
  const spec = () => ({ 列: st.col, 形: st.shape, 鍵: st.key.trim(), 値: st.value.trim(), 道筋: st.path.trim() });

  /* ---------------- 描く ---------------- */
  function bar(c) {
    const t = c.total || 1, fit = (c.fit || {})[c.best] || 0;
    const seg = (n, cls, w) => (n ? `<i class="jx-s ${cls}" style="flex:${n}" title="${w} ${fmt(n)} 行"></i>` : "");
    const s = shapeOf(c.best);
    const words = [`<b>${s.n} ${s.name} ${pct(fit, t)}</b>`].concat(c.empty ? [`空 ${pct(c.empty, t)}`] : [], c.broken ? [`<em>壊れ ${fmt(c.broken)}</em>`] : [], c.other ? [`<em>違う形 ${fmt(c.other)}</em>`] : []);
    return `<span class="jx-bar"><span class="jx-strip">${seg(fit, "ok", s.name)}${seg(c.empty, "empty", "空")}${seg(c.broken, "ng", "壊れ")}${seg(c.other, "warn", "違う形")}</span><span class="jx-words">${words.join(" · ")}</span></span>`;
  }
  function baseChips() {
    const bs = bases(st.items).filter((b) => !st.withJson || st.withJson.has(b.key) || b.key === st.base);
    if (!bs.length) return "";
    return `<span class="jx-bases" role="radiogroup" aria-label="どの表から作るか">${bs.map((b) => `<button type="button" role="radio" aria-checked="${b.key === st.base}" class="${b.key === st.base ? "is-on" : ""}" data-jx-base="${esc(b.key)}">${esc(b.name)}</button>`).join("")}</span>`;
  }
  function colsHtml() {
    if (!st.probe) return `<p class="jx-wait">${st.err ? esc(st.err) : "中身を読んでいます…"}</p>`;
    const cols = st.probe.columns || [];
    if (!cols.length) return `<p class="jx-none">${esc(st.probe.name || "")}には JSON の列が見つかりません（先頭 ${fmt(st.probe.read)} 行の中で、{ か [ で始まる値が半分を超える列）。上の札で表を替えられます</p>`;
    return cols.map((c) => `<button type="button" class="jx-col${c.column === st.col ? " is-on" : ""}" data-jx-col="${esc(c.column)}" aria-pressed="${c.column === st.col}"><b>${esc(c.column)}</b>${bar(c)}</button>`).join("");
  }
  function patsHtml() {
    const pre = st.pre, rows = pre ? pre.rows : 0, best = pre ? pre.probe.best : "";
    return SHAPES.map((s) => {
      const x = pre && pre.shapes[s.k];
      const fit = x ? x.fit : 0, on = s.k === st.shape;
      const few = fit * 2 < rows && s.k !== best;
      const split = x ? x.out - (rows - fit) : 0;   // 分けた行（分けずに残す行は入れない。③ の「n 行を m 行に分けます」の m と同じ）
      const n = !pre ? "…" : !fit ? "合いません" : few ? `${fmt(fit)} 行だけ合う` : s.k === "nest" ? `${fmt(rows)} 行・列 +${fmt(x.cols)}` : `${fmt(split)} 行に`;
      const sub = !pre ? "" : !fit ? `中身は ${shapeOf(best).n} ${shapeOf(best).name}` : `合う ${pct(fit, rows)}`;
      const cls = !pre ? "" : s.k === best ? " is-fit" : fit ? " is-alt" : " is-no";
      return `<button type="button" role="radio" aria-checked="${on}" class="jx-pat${cls}${on ? " is-on" : ""}" data-jx-shape="${s.k}">`
        + `<span class="jx-pn">${s.n}</span><span class="jx-pb"><b>${s.name}${pre && s.k === best ? '<i class="jx-rec">おすすめ</i>' : ""}</b><small>${esc(s.how)}</small><code>${esc(s.eg)}</code></span>`
        + `<em>${n}<small>${esc(sub)}</small></em></button>`;
    }).join("");
  }
  function namesHtml() {
    const keyed = KEYED.has(st.shape), valued = VALUED.has(st.shape);
    const km = st.pre && st.pre.keyMaster;
    let master = "";
    if (keyed && km && km.master) {
      const miss = km.missing || [];
      master = `<div class="jx-km">設備マスタに ${fmt(km.in)} / ${fmt(km.keys)}${miss.length ? " · " : ""}${miss.slice(0, 4).map((m) => `<button type="button" class="jx-miss${st.missingOpen === m.key ? " is-on" : ""}" data-jx-miss="${esc(m.key)}" title="設備マスタに無い鍵です。押すと、この鍵を含む行の例を ③ に出します">${esc(m.key)} が無い</button>`).join(" ")}${miss.length > 4 ? ` ほか ${miss.length - 4}` : ""}`
        + (miss.length ? `<span class="jx-kmw">（設備マスタに無い設備名。綴りの違い・新しい設備なら）<button type="button" class="jx-link" data-jx-master>設備マスタに足す…</button></span>` : "") + "</div>";
    }
    return `<div class="jx-names">${keyed ? `<label>鍵の列<input data-jx-name="key" value="${esc(st.key)}" maxlength="40" aria-label="鍵の列の名前"></label>` : ""}`
      + `${valued ? `<label>値の列<input data-jx-name="value" value="${esc(st.value)}" maxlength="40" aria-label="値の列の名前"></label>` : ""}`
      + `<label class="jx-path" title="深い入れ子は、その中（寸法.幅 など。並びは番号）へ降りてから分けます">道筋<input data-jx-path value="${esc(st.path)}" placeholder="（なし）" aria-label="道筋"></label></div>${master}`;
  }
  /** 足す列の見出し（名前の欄に打った字をすぐ出す） */
  function heads() {
    const cols = (st.pre && st.pre.cols) || [];
    if (st.shape === "dict") return [st.key.trim() || "鍵", st.value.trim() || "値"];
    if (st.shape === "list") return [st.value.trim() || "値"];
    if (st.shape === "dictrows") return [st.key.trim() || "鍵", ...cols.slice(1)];
    return cols;
  }
  function previewHtml() {
    const pre = st.pre;
    if (!pre) return `<p class="jx-wait">${st.err ? `<span class="jx-err">✕ ${esc(st.err)}</span>` : st.col ? "試しています…" : ""}</p>`;
    const hs = heads(), more = hs.length > 4, show = hs.slice(0, 4), lot = pre.lotColumn;
    const isKey = (i) => i === 0 && KEYED.has(st.shape);
    const head = `<tr><th>元</th>${lot ? `<th>${esc(lot)}</th>` : ""}${show.map((h, i) => `<th class="is-new${isKey(i) ? "" : " is-num"}" data-jx-head="${i}">${esc(h)}<small>${isKey(i) ? "鍵" : VALUED.has(st.shape) ? "値" : "列"}</small></th>`).join("")}${more ? `<th class="is-new">…<small>ほか ${hs.length - 4}</small></th>` : ""}</tr>`;
    let body = "";
    const cell = (v) => (v === null || v === undefined ? '<span class="jx-null">（空）</span>' : esc(v));
    const rowsOf = (list) => list.map((r) => r.out.map((o, j) => `<tr class="${j === 0 ? "is-first" : ""}"><td>${j === 0 ? `${fmt(r.row)} 行目` : ""}</td>${lot ? `<td>${j === 0 ? esc(r.lot) : ""}</td>` : ""}${o.slice(0, 4).map((v, i) => `<td class="${isKey(i) ? "" : "is-num"}">${cell(v)}</td>`).join("")}${more ? "<td></td>" : ""}</tr>`).join("")
      + (r.n > r.out.length ? `<tr class="jx-moreline"><td></td>${lot ? "<td></td>" : ""}<td colspan="${show.length + (more ? 1 : 0)}">… ほか ${fmt(r.n - r.out.length)} 行</td></tr>` : "")).join("");
    const miss = st.missingOpen && ((pre.keyMaster || {}).missing || []).find((m) => m.key === st.missingOpen);
    if (miss) {
      body = `<tr class="jx-cap"><td colspan="${show.length + 2 + (more ? 1 : 0)}">「${esc(miss.key)}」を含む行（${fmt(miss.rows)} 行。設備マスタに無い鍵）<button type="button" class="jx-link" data-jx-miss="${esc(miss.key)}">見本に戻す</button></td></tr>`
        + rowsOf(miss.examples.map((x) => ({ row: x.row, lot: x.lot, out: [x.out], n: 1 })));
    } else {
      body = rowsOf(pre.sample || []);
    }
    const s = pre.stats, bad = s.broken + s.other, made = s.out - (s.rows - s.fit);
    const issues = (pre.issues || []).map((x) => `<li><span class="jx-row">${fmt(x.row)} 行目${x.lot ? ` ${esc(x.lot)}` : ""}</span><code>${esc(x.text)}</code><span class="jx-why">${x.kind === "broken" ? "壊れた JSON: " : ""}${esc(x.reason)}</span></li>`).join("");
    const words = [s.broken ? `壊れた JSON ${fmt(s.broken)}` : "", s.other ? `違う形 ${fmt(s.other)}` : ""].filter(Boolean).join(" · ");
    return `<table class="jx-prev"><thead>${head}</thead><tbody>${body}</tbody></table>`
      + `<div class="jx-iss" role="status"><span class="jx-ok">✓ ${fmt(s.fit)} 行を ${fmt(made)} 行に分けます</span>`
      + (s.rows - s.fit ? `<span class="jx-mute">分けずに残す ${fmt(s.rows - s.fit)} 行（${[s.empty ? `空 ${fmt(s.empty)}` : "", s.broken ? `壊れ ${fmt(s.broken)}` : "", s.other ? `違う形 ${fmt(s.other)}` : ""].filter(Boolean).join(" · ")}）は足した列を空のまま 1 行で残し、合わせて ${fmt(s.out)} 行</span>` : "")
      + (s.text && VALUED.has(st.shape) ? `<span class="jx-mute">数でない値 ${fmt(s.text)} 個は字のまま（合計には入りません）</span>` : "")
      + (bad ? `<span class="jx-ng">▲ 分けずに残す ${fmt(s.rows - s.fit)} 行のうち ${fmt(bad)} 行は分けられません（${words}）<button type="button" class="jx-link" data-jx-issues aria-expanded="${st.show === "issues"}">${st.show === "issues" ? "閉じる" : "見る"}</button></span>` : "")
      + (bad && st.show === "issues" ? `<ul class="jx-issues">${issues}${bad > (pre.issues || []).length ? `<li class="jx-mute">ほか ${fmt(bad - (pre.issues || []).length)} 行（足した列は空のまま 1 行で残します）</li>` : ""}</ul>` : "")
      + (pre.renamed || []).map((r) => `<span class="jx-mute">「${esc(r.from)}」は元の表にもあるので「${esc(r.to)}」にします</span>`).join("")
      + "</div>";
  }
  const tableName = () => { const b = bases(st.items).find((x) => x.key === st.base); return `${b ? b.name : st.base} › ${st.col}`.slice(0, 24); };
  /** 作るパネルの数と中身（版 3.121.0。前は「合計」1 枚しか言わず、実際は 5 枚できた。dashboard.js の addJsonPanel と同じ並び） */
  const panelsText = () => (KEYED.has(st.shape) ? "5 枚（合計と平均の棒・表・数字 2 枚）" : "3 枚（合計・平均・ロット数の数字）");
  const panelTitle = () => (KEYED.has(st.shape) ? `${st.key.trim() || "鍵"}ごとの${st.value.trim() || "値"}の合計` : `${st.value.trim() || "値"}の合計`);
  function footHtml() {
    const pre = st.pre, can = !!pre && pre.stats.fit > 0 && !st.busy;
    const had = viewFor(st.items, st.base, st.col);
    const ps = pre && pre.stats, keep = ps ? ps.rows - ps.fit : 0;
    const out = ps ? `：${fmt(ps.out - keep)} 行${keep ? ` ＋ 分けずに残す ${fmt(keep)} 行 ＝ ${fmt(ps.out)} 行` : ""}（元 ${fmt(pre.rows)} 行）` : "";
    const panelOk = VALUED.has(st.shape);
    const pan = st.from === "dash" ? `<span class="jx-mute" title="作ると、組んでいるパネルのデータにします">このパネルで${KEYED.has(st.shape) ? "鍵ごとの値の合計" : "値の合計"}にします</span>`
      : `<label class="jx-ck${panelOk ? "" : " is-off"}"><input type="checkbox" data-jx-panel${st.panel && panelOk ? " checked" : ""}${panelOk ? "" : " disabled"}>新しいダッシュボードに「${esc(panelTitle())}」など ${panelsText()}のパネルを作る</label>`;
    return `<div class="jx-fl"><span class="jx-out">できる表 <b>${esc(st.col ? tableName() : "")}</b>${out}${had ? '<small>（作ってある表の決まりを直します）</small>' : ""}</span>${pan}</div><span class="jx-sp"></span>`
      + `<button type="button" class="btn-ghost" data-jx-close>やめる</button><button type="button" class="btn-primary" data-jx-make${can ? "" : " disabled"}>${st.busy ? "…" : st.from === "dash" ? (had ? "表を直してパネルに使う" : "表を作ってパネルに使う") : had ? "表を直す" : "表を作る"}</button>`;
  }
  function paint() {
    const win = document.getElementById("jxWin"); if (!win || !st) return;
    const focus = document.activeElement && win.contains(document.activeElement) ? document.activeElement.dataset : null;
    const name = focus && (focus.jxName || (focus.jxPath !== undefined ? "path" : ""));
    win.innerHTML = `<header class="jx-h"><b>{ } JSON の列を分ける</b>${baseChips()}<small>${st.probe ? `中身の先頭 ${fmt(st.probe.read)} 行を読みました` : ""}</small><span class="jx-sp"></span><button type="button" class="jx-x" data-jx-close aria-label="閉じる">×</button></header>`
      + `<div class="jx-body"><section class="jx-s1"><h5><i>1</i>列<small class="jx-h5n">帯は先頭 ${fmt((st.probe && st.probe.read) || 500)} 行の割合</small></h5><div class="jx-cols">${colsHtml()}</div></section>`
      + `<section class="jx-s2"><h5><i>2</i>分け方</h5>${st.col ? `<div class="jx-pats" role="radiogroup" aria-label="分け方">${patsHtml()}</div>${namesHtml()}` : ""}</section>`
      + `<section class="jx-s3"><h5><i>3</i>見本と確かめ${st.busy ? '<i class="wait-spin" aria-hidden="true"></i>' : ""}</h5><div class="jx-pv">${st.col ? previewHtml() : ""}</div></section></div>`
      + `<footer class="jx-f">${footHtml()}</footer>`;
    if (name) {
      const el = win.querySelector(name === "path" ? "[data-jx-path]" : `[data-jx-name="${name}"]`);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  }
  /** 名前を打った: 見出しと下の段だけを描き直す（問い合わせない。打っている欄を作り直さない） */
  function paintNames() {
    const win = document.getElementById("jxWin"); if (!win) return;
    const pv = win.querySelector(".jx-pv"); if (pv && st.pre) pv.innerHTML = previewHtml();
    const f = win.querySelector(".jx-f"); if (f) f.innerHTML = footHtml();
  }

  /* ---------------- 操作 ---------------- */
  let pathTimer = 0;
  function onInput(e) {
    const x = e.target;
    if (x.dataset.jxName) { st[x.dataset.jxName] = x.value; paintNames(); return; }
    if (x.matches("[data-jx-path]")) { st.path = x.value; clearTimeout(pathTimer); pathTimer = setTimeout(() => st && ask(), 400); return; }
    if (x.matches("[data-jx-panel]")) st.panel = x.checked;
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !st) return;
    if (b.hasAttribute("data-jx-close")) { close(); return; }
    if (b.dataset.jxBase) { if (b.dataset.jxBase !== st.base) pickBase(b.dataset.jxBase); return; }
    if (b.dataset.jxCol) { if (b.dataset.jxCol !== st.col) pickCol(b.dataset.jxCol); return; }
    if (b.dataset.jxShape) { if (b.dataset.jxShape !== st.shape) { st.shape = b.dataset.jxShape; st.missingOpen = ""; st.show = ""; ask(); } return; }
    if (b.hasAttribute("data-jx-issues")) { st.show = st.show === "issues" ? "" : "issues"; paint(); return; }
    if (b.dataset.jxMiss) { st.missingOpen = st.missingOpen === b.dataset.jxMiss ? "" : b.dataset.jxMiss; paint(); return; }
    if (b.hasAttribute("data-jx-make")) make();
    if (b.hasAttribute("data-jx-master")) { close(); if (window.openMasterAt) window.openMasterAt("equipment"); }
  }
  /** 表を作る: データ元に足す（同じ元・同じ列の表があれば決まりを直す）→ 分けた表を組んでおく → パネル */
  async function make() {
    if (!st || !st.pre || st.busy) return;
    const s = { ...st }, sp = JSON.stringify(spec());
    st.busy = true; paintNames();
    const had = viewFor(st.items, st.base, st.col);
    let key = had ? had.key : "";
    try {
      const body = had ? { 表示名: had.name, 元: st.base, 展開: sp, 結合: had.joins || [], 画面: had.listed ? "有" : "無", 設備の列: had.equipColumn || "", 設備の取り出し方: had.equipMode || "そのまま", base_rev: had.rev || 0 }
        : { 表示名: tableName(), 元: st.base, 展開: sp, 結合: [], 画面: "無", base_rev: 0 };
      const r = await fetch(had ? `/api/sources/${encodeURIComponent(had.key)}` : "/api/sources", TPA.json(had ? "PUT" : "POST", body));
      const a = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(a.error || `作れませんでした（${r.status}）`);
      key = key || (a.row || {})["キー"];
      // 分けた表を今のうちに組む（ダッシュボードのパネルがすぐ数えられる・行の数がデータ元の一覧に出る）
      await fetch(`/api/src/${encodeURIComponent(key)}?page=1`, { cache: "no-store" }).catch(() => {});
    } catch (e) {
      if (st) { st.busy = false; st.err = e.message; paint(); TPA.toast(`✕ ${e.message}`); }
      return;
    }
    srcList = null;
    document.dispatchEvent(new CustomEvent("tpa:sources-changed", { detail: { key } }));
    const view = { key, source: `src:${key}`, name: had ? had.name : tableName(), col: s.col, shape: s.shape, keyCol: (st.pre.cols || [])[0], valueCol: st.shape === "dict" ? (st.pre.cols || [])[1] : st.shape === "list" ? (st.pre.cols || [])[0] : "", title: panelTitle() };
    const from = s.from, onDone = s.onDone, wantPanel = s.panel && from !== "dash" && VALUED.has(s.shape);
    close();
    if (from === "dash" && onDone) { onDone(view); return; }
    if (wantPanel && window.Dashboard && Dashboard.addJsonPanel) {
      const got = await Dashboard.addJsonPanel(view);
      if (got && got.ok) {
        TPA.toast(`「${view.name}」を作り、新しいダッシュボード「${got.name}」に「${view.title}」など ${got.count || 5} 枚のパネルを足しました`, { rest: "見る → ダッシュボード", ms: 15000 });
        showJump(view.title);
        return;
      }
      TPA.toast(`「${view.name}」を作りました。${(got && got.why) || "パネルは足せませんでした"}`);
      return;
    }
    TPA.toast(`「${view.name}」を作りました（データ元に並びます。集計表・ダッシュボードで使えます）`);
  }
  /** 足したパネルへ行く札（知らせの横。押すとダッシュボードを開いてそのパネルへ） */
  function showJump(title) {
    const t = document.querySelector(".tpa-toast"); if (!t) return;
    t.querySelector(".tpa-toast-rest")?.remove();
    t.insertAdjacentHTML("beforeend", ' <button type="button" class="jx-jump" data-jx-jump>見る</button>');
    t.querySelector("[data-jx-jump]").onclick = () => {
      t.remove();
      if (typeof showScreen === "function") showScreen("dash");
      setTimeout(() => window.Dashboard && Dashboard.focusPanelTitled && Dashboard.focusPanelTitled(title), 300);
    };
  }

  window.JsonExpand = {
    open, close, probe, sources,
    isOpen: () => !!st,
    /** 元のキー（ダッシュボードの source: lot・src:wip・分けた表 src:<キー>）→ 見分けに使う元のキー（分けた表は元の元） */
    baseOf(source, list) {
      const k = source === "lot" ? "lot" : String(source || "").replace(/^src:/, "");
      const it = (list || []).find((x) => x.key === source || x.key === `src:${k}`);
      return it && it.base ? it.base : k;
    },
    SHAPES,
    /** 分けた表の添え書き（ダッシュボードのパネル）: [元 › 列 を 形 で分けた（n → m 行）, 数えていない行の字] */
    note(item, list) {
      const e = parse(item && item.expand); if (!e.列) return null;
      const st2 = (item.expandStats || {}).stats;
      const base = (list || []).find((x) => x.key === (item.base === "lot" ? "lot" : `src:${item.base}`));
      const head = `${base ? base.name : item.base} › ${e.列} を ${shapeOf(e.形).n} ${shapeOf(e.形).name} で分けた`;
      if (!st2) return [head, "", ""];
      const made = st2.out - (st2.rows - st2.fit);
      const keep = st2.rows - st2.fit;
      return [head, `（${fmt(st2.fit)} 行を ${fmt(made)} 行に）`, keep ? `▲ 分けずに残した ${fmt(keep)} 行は数えていません` : ""];
    },
  };
})();
