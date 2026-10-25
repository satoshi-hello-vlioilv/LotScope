"use strict";
/* =========================================================================
   カードの設計（版 3.55.0。利用者の要望 2026-10-25: Access のフォームのように、カードを見た目のまま設計する。
   置き場は services/card_forms.py・/api/card-forms。カードの窓は lotlist-card.js。決め方: ui-proposals/2026-10-cardform*）
   - 設計の形（body）: {cols: 方眼の列, row: 1 段の高さ px, theme: {accent, density, radius}, tabs?: [{id, name}],
       items: [{id, kind, tab?, col|expr|text|cols, label, x, y, w, h, st, fold?, shut?}]}
     kind … field（列の値）・combo（組み合わせた項目: 表示列の作り方と同じ式 list-formula.js）・text（決まった字）・section（見出しの線）・
            dates（日付の列を集め、いまの行の日付の順に並べて間の日数を出す。版 3.56.0）
     分けて出す（版 3.56.0）: tabs が 2 つ以上なら、タブごとに別の方眼（項目の tab）。見出しの線に fold を付けると畳める（アコーディオン。
       畳むと次の見出しまでの段を詰める。shut ははじめから畳んでおく）
     st … 見栄え {fs: s|m|l|xl, bold, color, bg, align, lab: 名前と値の置き方（LAB の 8 つ）, border: line|none|strong}（色は鍵だけ。CSS の色の組 .cfv-c-鍵）
   - 組み込みの標準（開発側で決めた既定）: 表の列から組む（列は表ごとに違う）。標準・タブで分ける・畳める見出し・似た名前をまとめる・
     日付をまとめる・要点・2 段・明細・フォーム・4 列・5 列・6 列
   - 描く（view）と直す（edit）は同じ方眼・同じ大きさ（直すときは点線の枠と四隅の取っ手が重なるだけ）
   - 方眼の決まり（重ならない・方眼の外へ出ない・角を引いた大きさ）は TPA.grid（shared.js。ダッシュボードのパネルと同じ）
   ========================================================================= */
(function () {
  const { esc } = TPA;
  const FS = [["s", "小"], ["m", "中"], ["l", "大"], ["xl", "特大"]];
  const ALIGN = [["left", "左"], ["center", "中"], ["right", "右"]];
  // 名前と値の置き方（サーバーの card_forms.LAB と同じ鍵）。[鍵, 短い名前, どんな時に向くか]
  const LAB = [["top", "上", "名前の下に値（既定）"], ["bottom", "下", "値の下に名前（数を大きく見せる）"], ["left", "左", "名前｜値（名前の幅をそろえる）"],
    ["spread", "両端", "名前を左・値を右の端（明細・帳票）"], ["legend", "枠の上", "名前を枠の線に乗せる（Access のフォーム）"], ["tag", "札", "名前を色の札にして値の前"],
    ["inline", "続ける", "「名前：値」を 1 行に続ける"], ["none", "出さない", "値だけ"]];
  const BORDER = [["line", "細い線"], ["strong", "太い線"], ["none", "線なし"]];
  // 色の鍵（サーバーの card_forms.COLORS・BGS と同じ）。名前は人の言葉で
  const COLORS = [["", "標準"], ["ink", "黒"], ["muted", "灰"], ["blue", "藍"], ["teal", "青緑"], ["green", "緑"], ["amber", "琥珀"], ["red", "赤"], ["purple", "紫"]];
  const BGS = [["", "標準"], ["white", "白"], ["pale", "淡い灰"], ["blue", "淡い藍"], ["teal", "淡い青緑"], ["green", "淡い緑"], ["amber", "淡い琥珀"], ["red", "淡い赤"], ["gray", "灰"]];
  const DENSITY = [["compact", "詰める"], ["normal", "標準"], ["roomy", "ゆったり"]];
  const LONG = /備考|コメント|メモ|内容|詳細|所見|理由/;
  // 組み込みの「標準」のまとまり（列の名前で分ける。当たらない列は「そのほか」）
  const GROUPS = [["不良", /不良|異常|欠陥|ロット|設備|発生/], ["製造条件", /合金|調質|材質|質別|品種|板厚|板幅|厚さ|幅|重量|長さ|比重|鋳造|寸法|数量/],
    ["検査", /検査|判定|担当|工程|入力|確認/]];
  const style = (st = {}) => ({ fs: "m", bold: false, color: "", bg: "", align: "left", lab: "top", border: "line", ...st });
  let uid = 0;
  const newId = () => `i${Date.now().toString(36)}${(++uid).toString(36)}`;

  /* ---------------- 分けて出す: タブ・畳める見出し ---------------- */
  /** タブ（2 つ以上のときだけ分ける）・いまのタブ（無い id なら先頭）・そのタブの項目 */
  const tabsOf = (body) => (Array.isArray(body.tabs) && body.tabs.length >= 2 ? body.tabs : null);
  const tabOf = (body, want) => { const ts = tabsOf(body); return ts ? (ts.some((t) => t.id === want) ? want : ts[0].id) : ""; };
  const inTab = (body, tab) => { const ts = tabsOf(body); if (!ts) return body.items; const t = tabOf(body, tab); return body.items.filter((it) => (it.tab || ts[0].id) === t); };
  /** 畳んだ見出し（shut: 畳んでいる見出しの id）の下を、次の見出しまで隠して詰める。→ {hidden: 隠す項目の id, y(段) → 詰めた段, count: 見出し → 隠した項目の数} */
  function foldMap(items, shut) {
    const secs = items.filter((it) => it.kind === "section").sort((a, b) => a.y - b.y), ranges = [], count = new Map();
    secs.forEach((s, k) => {
      if (!s.fold || !shut.has(s.id)) return;
      const a = s.y + s.h, b = k + 1 < secs.length ? secs[k + 1].y : Infinity;
      ranges.push([a, b]); count.set(s.id, items.filter((it) => it.kind !== "section" && it.y >= a && it.y < b).length);
    });
    const hidden = new Set(items.filter((it) => ranges.some(([a, b]) => it.y >= a && it.y < b)).map((it) => it.id));
    const end = Math.max(0, ...items.map((it) => it.y + it.h));
    const gone = (y) => ranges.reduce((n, [a, b]) => n + Math.max(0, Math.min(y, b, end) - a), 0);
    return { hidden, y: (y) => y - gone(y), count };
  }
  /** はじめに畳んでおく見出し（shut）と、この PC で開いた・畳んだ物（mine: {id: true=畳む/false=開く}）→ 畳んでいる見出しの id */
  const shutSet = (body, mine = {}) => new Set(body.items.filter((it) => it.kind === "section" && it.fold && (it.id in mine ? mine[it.id] : !!it.shut)).map((it) => it.id));

  /* ---------------- 日付をまとめる（dates） ---------------- */
  const DATE_RE = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:\D{1,3}(\d{1,2})[:時](\d{2}))?/;
  const DATE8 = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?/;
  const parseDate = (t) => {
    const s = String(t || "").trim(), m = DATE_RE.exec(s) || DATE8.exec(s);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return Number.isNaN(d.getTime()) || +m[2] < 1 || +m[2] > 12 ? null : d;
  };
  /** 日付の列の値を、いまの行の日付の順に（読めない・空の値は後ろ） */
  function datesOf(it, ctx) {
    return (it.cols || []).map((c, k) => { const t = ctx.row ? ctx.cell(c).text : ""; return { col: c, k, label: ctx.label(c), text: t, d: parseDate(t) }; })
      .sort((a, b) => (a.d && b.d ? a.d - b.d || a.k - b.k : a.d ? -1 : b.d ? 1 : a.k - b.k));
  }
  /** 前の日付からの間（「＋3日」「＋5時間」「同じ日」） */
  const gapText = (a, b) => {
    const ms = b - a, day = 864e5;
    if (ms < 0) return "";
    if (ms < day) { const h = Math.round(ms / 36e5); return h ? `＋${h}時間` : "同じ日"; }
    return `＋${Math.round(ms / day)}日`;
  };

  /* ---------------- 組み込みの標準（列から組む） ---------------- */
  // 日付の列（サーバーの日付の列〈dateColumns〉に、名前で見た列を足す）
  const DATE_COL = /日付|日時|年月日|発生日|検査日|入力日|作業日|開始日|終了日|期限|時刻|_日$|日$/;
  /** 似た名前の列のまとまり: 末尾の番号を除いた名前（項目01〜項目20 → 項目）か、「_」の前の頭（BOX実績_作業開始 → BOX実績）が
      3 つ以上で同じ列。→ [{name, cols: [{col, short}]}]（short: まとまりの名前を除いた短い名前。番号だけになるときは番号） */
  function families(cols) {
    const by = new Map(), add = (k, c, short) => { if (!k) return; if (!by.has(k)) by.set(k, []); by.get(k).push({ col: c, short }); };
    cols.forEach((c) => {
      const m = /^(.*?)[\s_\-#№]*([0-9０-９]+)$/.exec(c);
      if (m && m[1]) { add(m[1], c, m[2]); return; }
      const u = /^([^_]{1,20})_(.+)$/.exec(c);
      if (u) add(u[1], c, u[2]);
    });
    return [...by.entries()].filter(([, l]) => l.length >= 3).map(([name, l]) => ({ name, cols: l }));
  }
  /** cols: 出す列（並び）。opt.dates: サーバーが日付と見た列。→ 組み込みの設計の並び [{id: "b:鍵", name, note, builtin: true, body}] */
  function builtins(cols, { dates = [] } = {}) {
    let n = 0;                     // 組み込みの項目の印は決まった形（描くたびに変えない。直す前後で同じ項目と分かる）
    const bid = () => `b${(++n).toString(36)}`;
    const field = (c, x, y, w, h, st, label = "") => ({ id: bid(), kind: "field", col: c, label, x, y, w, h, st: style(st) });
    const section = (text, y, extra = {}) => ({ id: bid(), kind: "section", text, label: "", x: 0, y, w: 12, h: 1, st: style(), ...extra });
    const flow = (list, per, y0, st = {}, h = 1, span = 12) => {     // per 個ずつ並べる（長い字の列は 1 段まるごと・2 段）
      const out = []; let x = 0, y = y0; const w = span / per;
      list.forEach((c) => {
        const col = typeof c === "string" ? c : c.col, label = typeof c === "string" ? "" : c.label || "";
        if (LONG.test(col)) { if (x) { y += h; x = 0; } out.push(field(col, 0, y, span, 2, st, label)); y += 2; return; }
        out.push(field(col, x, y, w, h, st, label)); x += w; if (x >= span) { x = 0; y += h; }
      });
      return { items: out, next: x ? y + h : y };
    };
    // 列を意味のまとまり（不良・製造条件・検査・そのほか）に分ける
    const grouped = (list) => {
      const g = GROUPS.map(([name]) => [name, []]).concat([["そのほか", []]]);
      list.forEach((c) => { const i = GROUPS.findIndex(([, re]) => re.test(c)); g[i < 0 ? g.length - 1 : i][1].push(c); });
      return g.filter((x) => x[1].length);
    };
    const emphasize = (items) => {           // いちばん先に見る物（不良名）だけ赤く大きく
      const key = items.find((x) => /不良名|異常名|不良/.test(x.col)) || items[0];
      if (key) key.st = style({ fs: "l", bold: true, color: "red" });
    };
    /** まとまりごとに見出しの線（opt.fold: 畳める・shutRest: 「そのほか」ははじめ畳む） */
    const sectioned = (list, { fold = false, shutRest = false, y0 = 0 } = {}) => {
      const used = grouped(list);
      if (used.length < 2) return flow(list, 3, y0);
      const items = []; let y = y0;
      used.forEach(([name, l], gi) => {
        items.push(section(name, y, fold ? { fold: true, shut: shutRest && name === "そのほか" } : {})); y += 1;
        const f = flow(l, 3, y, gi ? {} : { fs: "l", bold: true });
        if (!gi) emphasize(f.items);
        items.push(...f.items); y = f.next;
      });
      return { items, next: y };
    };
    const std = sectioned(cols);
    // タブで分ける: まとまりを 1 つずつのタブに（1 つのタブが TAB_MAX を超えたら「そのほか 1・2 …」に割る）
    const TAB_MAX = 36, tabs = [], tabbed = [];
    grouped(cols).forEach(([name, l], gi) => {
      const parts = l.length > TAB_MAX ? Array.from({ length: Math.ceil(l.length / TAB_MAX) }, (_, k) => l.slice(k * TAB_MAX, (k + 1) * TAB_MAX)) : [l];
      parts.forEach((part, k) => {
        const id = `t${tabs.length + 1}`;
        tabs.push({ id, name: parts.length > 1 ? `${name} ${k + 1}` : name });
        const f = flow(part, 3, 0, gi || k ? {} : { fs: "l", bold: true });
        if (!gi && !k) emphasize(f.items);
        f.items.forEach((it) => { it.tab = id; }); tabbed.push(...f.items);
      });
    });
    // 似た名前をまとめる: まとまりに入らない列は標準の形で上に、似た名前は畳める見出しの下に 6 つずつ（名前は短く: 番号だけ等）
    const fams = families(cols), inFam = new Set(fams.flatMap((f) => f.cols.map((x) => x.col)));
    const famTop = sectioned(cols.filter((c) => !inFam.has(c)));
    let fy = famTop.next; const famItems = [...famTop.items];
    fams.forEach((f) => {
      famItems.push(section(`${f.name}（${f.cols.length}）`, fy, { fold: true })); fy += 1;
      const g = flow(f.cols.map((x) => ({ col: x.col, label: x.short })), 6, fy, { lab: "top" });
      famItems.push(...g.items); fy = g.next;
    });
    // 日付をまとめる: 日付の列を 1 つの項目に集め、いまの行の日付の順に並べて間の日数を出す（上に置く）。ほかは標準の形
    const dset = new Set(dates.filter((c) => cols.includes(c)));
    cols.forEach((c) => { if (DATE_COL.test(c)) dset.add(c); });
    const dcols = cols.filter((c) => dset.has(c));
    const dateBody = dcols.length >= 2 ? (() => {
      const rest = sectioned(cols.filter((c) => !dset.has(c)), { y0: 2 });
      return [{ id: bid(), kind: "dates", cols: dcols, label: `日付（${dcols.length}）`, x: 0, y: 0, w: 12, h: 2, st: style() }].concat(rest.items);
    })() : null;
    const key = cols.slice(0, 3), rest = flow(cols.slice(3), 4, 3);
    const two = flow(cols, 2, 0, { lab: "left" });
    const ledger = flow(cols, 2, 0, { lab: "spread", border: "none" }), form = flow(cols, 3, 0, { lab: "legend" });
    // 多くの列を 1 画面に: 4・5・6 列（名前を左・値を右の両端、低い段・詰める）
    const dense = (per, span) => flow(cols, per, 0, { lab: "spread", fs: "s" }, 1, span).items;
    const body = (items, extra = {}) => ({ cols: 12, row: 48, theme: { accent: "blue", density: "normal", radius: 9 }, items, ...extra });
    const compact = { theme: { accent: "blue", density: "compact", radius: 5 } };
    return [
      { id: "b:standard", name: "標準", note: "まとまりごとに見出しの線・3 列", builtin: true, body: body(std.items) },
      { id: "b:tabs", name: "タブで分ける", note: "まとまりごとにタブ（多ければ 2 つに割る）", builtin: true, body: body(tabbed, { tabs }) },
      { id: "b:fold", name: "畳める見出し", note: "見出しを押して開く・畳む（そのほかは畳んでおく）", builtin: true, body: body(sectioned(cols, { fold: true, shutRest: true }).items) },
      ...(fams.length ? [{ id: "b:family", name: "似た名前をまとめる", note: `${fams.map((f) => f.name).join("・")} を畳める見出しの下に 6 列`, builtin: true, body: body(famItems) }] : []),
      ...(dateBody ? [{ id: "b:dates", name: "日付をまとめる", note: `日付 ${dcols.length} 列を日付の順に並べ、間の日数`, builtin: true, body: body(dateBody) }] : []),
      { id: "b:key", name: "要点", note: "先頭の 3 つを大きく", builtin: true, body: body(key.map((c, i) => field(c, i * 4, 0, 4, 2, { fs: "xl", bold: true, color: i ? "" : "red" }))
        .concat([section("そのほか", 2)], rest.items)) },
      { id: "b:two", name: "2 段", note: "名前を左に 2 列", builtin: true, body: body(two.items, { row: 40 }) },
      { id: "b:ledger", name: "明細", note: "名前と値を両端に 2 列", builtin: true, body: body(ledger.items, { row: 36, ...compact }) },
      { id: "b:form", name: "フォーム", note: "名前を枠の線に乗せる", builtin: true, body: body(form.items, { row: 52, theme: { accent: "blue", density: "roomy", radius: 5 } }) },
      { id: "b:dense4", name: "4 列", note: "多くの列を 1 画面に（4 列）", builtin: true, body: body(dense(4, 12), { row: 32, ...compact }) },
      { id: "b:dense5", name: "5 列", note: "多くの列を 1 画面に（5 列）", builtin: true, body: body(dense(5, 20), { cols: 20, row: 32, ...compact }) },
      { id: "b:dense6", name: "6 列", note: "多くの列を 1 画面に（6 列）", builtin: true, body: body(dense(6, 24), { cols: 24, row: 32, ...compact }) },
    ];
  }

  /** 名前と値の置き方を、小さな見本の札で選ぶ（文字でなく形で選ぶ）。attr: ボタンの data-属性名（例 'data-st="lab"'）。cur: いまの鍵 */
  const labPicker = (attr, cur) => `<span class="cf-lps">${LAB.map(([v, n, why]) => `<button type="button" class="cf-lp" ${attr} data-v="${v}" aria-pressed="${v === cur}" title="${why}">`
    + `<span class="cfv-i lab-${v}">${v === "none" ? "" : '<small class="cfv-l">名前</small>'}<b class="cfv-v">値</b></span><em>${n}</em></button>`).join("")}</span>`;

  /* ---------------- 描く ---------------- */
  /** 項目の値（字と、読み替えの色）。ctx: {t, row, cell(c) → {text, color, raw}, rowFor() → 式が見る行} */
  function valueOf(it, ctx) {
    if (it.kind === "field") return ctx.row ? ctx.cell(it.col) : { text: "", color: "" };
    if (it.kind === "combo") {
      if (!ctx.row) return { text: "", color: "" };
      const f = window.WL && window.WL.formula, c = f ? compiled(it.expr) : null;
      if (!c) return { text: "（式を読めません）", color: "", bad: true };
      const v = c.run(ctx.rowFor());
      return { text: v == null ? "" : String(v), color: "" };
    }
    if (it.kind === "dates") { const l = datesOf(it, ctx); return { text: l.filter((x) => x.text).map((x) => x.text).join(" "), color: "", list: l }; }
    return { text: it.text || "", color: "" };
  }
  const cache = new Map();
  function compiled(expr) {
    if (cache.has(expr)) return cache.get(expr);
    let c = null; try { c = window.WL.formula.compile(expr); } catch (_) { c = null; }
    if (cache.size > 200) cache.clear();
    cache.set(expr, c); return c;
  }
  const labelOf = (it, ctx) => it.label || (it.kind === "field" ? ctx.label(it.col) : it.kind === "combo" ? "組み合わせ" : it.kind === "dates" ? "日付" : "");
  /** 日付のまとまりの中身: 日付の順の札と、間の日数 */
  function datesHtml(list) {
    let prev = null;
    return `<ol class="cfv-dates">${list.map((x) => {
      const gap = prev && x.d ? gapText(prev, x.d) : ""; if (x.d) prev = x.d;
      return `${gap ? `<li class="cfv-gap" aria-hidden="true">${gap}</li>` : ""}<li class="cfv-date${x.d ? "" : " is-none"}"><small>${esc(x.label)}</small><b>${esc(x.text || "—")}</b></li>`;
    }).join("")}</ol>`;
  }
  /** 設計 body を、入れ物 host に描く（edit: 直すとき＝点線・取っ手・選んだ印）。sel: 選んでいる項目の id */
  /** tab: 出すタブ（tabs が 2 つ以上のとき）。shut: 畳んでいる見出しの id（見るときだけ効く。直すときは全部出す） */
  function render(host, body, ctx, { edit = false, sel = null, hideEmpty = false, diff = null, tab = "", shut = null } = {}) {
    const th = body.theme || {};
    host.className = `cfv cfv-d-${th.density || "normal"} cfv-a-${th.accent || "blue"}${edit ? " is-edit" : ""}`;
    host.style.setProperty("--cf-cols", body.cols || 12);
    host.style.setProperty("--cf-row", `${body.row || 48}px`);
    host.style.setProperty("--cf-r", `${th.radius ?? 9}px`);
    const list = inTab(body, tab), fm = !edit && shut && shut.size ? foldMap(list, shut) : null;
    const Y = (y) => (fm ? fm.y(y) : y);
    const rows = Math.max(1, ...list.filter((it) => !fm || !fm.hidden.has(it.id)).map((it) => Y(it.y) + it.h));
    host.style.setProperty("--cf-rows", edit ? rows + 2 : rows);
    host.innerHTML = list.map((it) => {
      if (fm && fm.hidden.has(it.id)) return "";
      const st = style(it.st), v = valueOf(it, ctx), empty = !String(v.text ?? "").trim();
      if (hideEmpty && empty && it.kind !== "section" && it.kind !== "text" && !edit) return "";
      const lab = labelOf(it, ctx);
      const cls = `cfv-i k-${it.kind} fs-${st.fs} al-${st.align} lab-${st.lab} bd-${st.border}${st.bold ? " is-bold" : ""}${st.color ? ` cfv-c-${st.color}` : ""}${st.bg ? ` cfv-b-${st.bg}` : ""}`
        + `${empty ? " is-empty" : ""}${it.h > 1 ? " is-tall" : ""}${it.id === sel ? " is-sel" : ""}${v.bad ? " is-bad" : ""}${diff && it.kind === "field" && diff.has(it.col) ? " is-diff" : ""}`;
      const pos = `grid-column:${it.x + 1} / span ${it.w};grid-row:${Y(it.y) + 1} / span ${it.h}`;
      const closed = !!(shut && shut.has(it.id) && !edit), n = fm && fm.count.get(it.id);
      const inner = it.kind === "section" ? (it.fold
        ? (edit ? `<b class="cfv-sec is-fold"><i class="cfv-tw" aria-hidden="true">▾</i>${esc(it.text || lab)}<i class="cfv-tag">畳める${it.shut ? "・はじめは畳む" : ""}</i></b>`
          : `<button type="button" class="cfv-sec is-fold" data-fold="${esc(it.id)}" aria-expanded="${!closed}" title="${closed ? "開きます" : "畳みます（この PC に覚えます）"}"><i class="cfv-tw" aria-hidden="true">${closed ? "▸" : "▾"}</i>${esc(it.text || lab)}${closed && n ? `<small class="cfv-foldn">${n} 項目</small>` : ""}</button>`)
        : `<b class="cfv-sec">${esc(it.text || lab)}</b>`)
        : it.kind === "text" ? `<span class="cfv-txt">${esc(it.text)}</span>`
        : it.kind === "dates" ? `${st.lab === "none" ? "" : `<small class="cfv-l">${esc(lab)}</small>`}${datesHtml(v.list || [])}`
        : `${st.lab === "none" ? "" : `<small class="cfv-l">${esc(lab)}${it.kind === "combo" && edit ? '<i class="cfv-tag">組み合わせ</i>' : ""}${diff && it.kind === "field" && diff.has(it.col) ? '<i class="cfv-diff" title="ほかのカードと値が違います">違い</i>' : ""}</small>`}`
          + `<b class="cfv-v${v.color ? " cell-" + v.color : ""}" title="${esc(v.text)}">${empty ? "—" : esc(v.text)}</b>`;
      return `<div class="${cls}" data-id="${esc(it.id)}" style="${pos}"${edit ? ' tabindex="0"' : ""}>${inner}`
        + (edit ? ["nw", "ne", "sw", "se"].map((d) => `<i class="cfv-rz" data-rz="${d}" aria-hidden="true"></i>`).join("") : "") + "</div>";
    }).join("") + (body.items.length ? "" : '<p class="cfv-none">項目がありません。「＋ 項目」で足します。</p>');
    fit(host);
  }
  /** タブの札（2 つ以上のときだけ）。edit: 直すとき（名前を変える・外す・足す） */
  function tabsHtml(body, tab, { edit = false } = {}) {
    const ts = tabsOf(body);
    if (!ts && !edit) return "";
    const cur = tabOf(body, tab), count = (id) => inTab(body, id).filter((it) => it.kind !== "section").length;
    return (ts || [{ id: "", name: "すべて" }]).map((t) => `<button type="button" role="tab" class="cfv-tab" data-tab="${esc(t.id)}" aria-selected="${t.id === cur}"`
      + ` title="${esc(t.name)}（${count(t.id)} 項目）${edit && ts ? "。ダブルクリックで名前を変える" : ""}。Ctrl＋PageUp／PageDown で隣のタブ">${esc(t.name)}<small>${count(t.id)}</small>`
      + `${edit && ts ? `<i class="cfv-tabx" data-tabx="${esc(t.id)}" role="button" aria-label="「${esc(t.name)}」のタブを外す" title="タブを外す（中の項目は先頭のタブへ）">×</i>` : ""}</button>`).join("")
      + (edit ? '<button type="button" class="cfv-tabadd" data-tabadd title="タブを足す（項目を分けて出す）">＋ タブ</button>' : "");
  }
  /** 値が項目の幅に入らないときは「…」で切らない（Access の「縮小して全体を表示」と同じ考え）。
      まず 1 段のまま字を小さくし（下限は元の 70%）、それでも入らないときだけ折り返す（折るのは区切りの字の後ろ。日付の途中では折らない） */
  function fit(host) {
    const over = [...host.querySelectorAll(".cfv-i:not(.k-section):not(.k-text):not(.k-dates) .cfv-v")].filter((v) => v.scrollWidth > v.clientWidth + 1);
    over.forEach((v) => {
      const el = v.parentElement, base = parseFloat(getComputedStyle(v).fontSize);
      const size = (k) => { v.style.fontSize = `${Math.round(base * k * 10) / 10}px`; };
      for (const k of [0.92, 0.84, 0.77, 0.7]) { size(k); if (v.scrollWidth <= v.clientWidth + 1) return; }
      v.classList.add("is-wrap");
      for (const k of [0.84, 0.77, 0.7]) { size(k); if (el.scrollHeight <= el.clientHeight + 1 && v.scrollWidth <= v.clientWidth + 1) return; }
    });
  }

  /* ---------------- 直す（掴んで動かす・四隅で大きさ。方眼の決まりは TPA.grid） ---------------- */
  /** host（render で描いた入れ物）の上で、項目を引いて動かす・四隅で大きさを変える。
      get() → いまの body。onChange(新しい body, 何をしたか)。onSelect(id)。onOpen(id)（ダブルクリック） */
  function attach(host, { get, onChange, onSelect, onOpen, say = () => {}, enabled = () => true, tab = () => "" }) {
    let drag = null, last = { id: "", t: 0 };
    const peers = (b) => inTab(b, tab());       // 重なりは同じタブの中で見る
    const cell = () => {
      const b = get(), cs = getComputedStyle(host), gap = parseFloat(cs.columnGap) || 8;
      const w = (host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * (b.cols - 1)) / b.cols;
      return { cw: w + gap, ch: b.row + (parseFloat(cs.rowGap) || 8) };
    };
    const ghost = (r, ok) => {
      let g = host.querySelector(".cfv-ghost");
      if (!g) { g = document.createElement("div"); g.className = "cfv-ghost"; host.append(g); }
      g.style.gridColumn = `${r.x + 1} / span ${r.w}`; g.style.gridRow = `${r.y + 1} / span ${r.h}`;
      g.classList.toggle("is-bad", !ok);
      g.textContent = ok ? `${r.w} × ${r.h}` : "重なるので置けません";
    };
    host.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !enabled()) return;
      const el = e.target.closest(".cfv-i"); if (!el || !host.contains(el)) return;
      const it = get().items.find((x) => x.id === el.dataset.id); if (!it) return;
      // ダブルクリックは自分で数える（掴むために pointer を捕まえると、dblclick の的が項目でなくなるため）
      const now = performance.now(), twice = !e.target.closest("[data-rz]") && last.id === it.id && now - last.t < 450;
      last = twice ? { id: "", t: 0 } : { id: it.id, t: now };
      e.preventDefault(); el.focus({ preventScroll: true });       // 押した項目に焦点（矢印・Ctrl＋Z・Enter がすぐ効く）
      if (twice) { onOpen(it.id); return; }
      onSelect(it.id);
      const rz = e.target.closest("[data-rz]");
      const { cw, ch } = cell();
      drag = { id: it.id, dir: rz ? rz.dataset.rz : "", x0: e.clientX, y0: e.clientY, r0: { x: it.x, y: it.y, w: it.w, h: it.h }, cw, ch, r: null, ok: true };
      host.setPointerCapture?.(e.pointerId);
      document.body.classList.add("cfv-dragging");
    });
    host.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const b = get(), dx = Math.round((e.clientX - drag.x0) / drag.cw), dy = Math.round((e.clientY - drag.y0) / drag.ch);
      if (!dx && !dy && !drag.r) return;
      const rows = 200, r0 = drag.r0;
      const r = drag.dir ? TPA.grid.sized(r0, drag.dir, dx, dy, b.cols, rows)
        : { ...r0, x: Math.max(0, Math.min(b.cols - r0.w, r0.x + dx)), y: Math.max(0, Math.min(rows - r0.h, r0.y + dy)) };
      drag.r = r; drag.ok = TPA.grid.fits(r, peers(b), drag.id, b.cols);
      ghost(r, drag.ok);
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null;
      document.body.classList.remove("cfv-dragging");
      host.querySelector(".cfv-ghost")?.remove();
      if (!d.r || JSON.stringify(d.r) === JSON.stringify(d.r0)) return;
      if (!d.ok) { say("ほかの項目と重なるので置けません"); onChange(get(), "") ; return; }
      const b = TPA.clone(get());
      Object.assign(b.items.find((x) => x.id === d.id), d.r);
      onChange(b, d.dir ? "大きさを変えました" : "動かしました", d.id);     // 描き直した後も同じ項目に焦点（Ctrl＋Z・矢印がすぐ効く）
    };
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
    // キー: 矢印＝動かす・Shift＋矢印＝右下の角・Alt＋Shift＋矢印＝左上の角（ダッシュボードと同じ）・Enter＝中身・Delete＝外す
    host.addEventListener("keydown", (e) => {
      const el = e.target.closest(".cfv-i"); if (!el || e.target !== el || !enabled()) return;
      const b = get(), it = b.items.find((x) => x.id === el.dataset.id); if (!it) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) {
        e.preventDefault(); e.stopPropagation();
        const r = e.shiftKey && e.altKey ? TPA.grid.sized(it, dir[0] ? "w" : "n", dir[0], dir[1], b.cols, 200)
          : e.shiftKey ? { ...it, w: Math.max(1, it.w + dir[0]), h: Math.max(1, it.h + dir[1]) } : { ...it, x: it.x + dir[0], y: it.y + dir[1] };
        if (r.x < 0 || r.y < 0 || r.x + r.w > b.cols || !TPA.grid.fits(r, peers(b), it.id, b.cols)) { say("そこへは動かせません（ほかの項目か、方眼の端）"); return; }
        const nb = TPA.clone(b); Object.assign(nb.items.find((x) => x.id === it.id), { x: r.x, y: r.y, w: r.w, h: r.h });
        onChange(nb, e.shiftKey ? "大きさを変えました" : "動かしました", it.id);
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); onOpen(it.id); }
      if (e.key === "Delete") { e.preventDefault(); const nb = TPA.clone(b); nb.items = nb.items.filter((x) => x.id !== it.id); onChange(nb, "外しました"); }
    });
  }
  /** 選んだ項目の印だけを付け替える（描き直さない。掴んでいる項目の要素を残す） */
  function select(host, id) {
    host.querySelectorAll(".cfv-i.is-sel").forEach((x) => x.classList.remove("is-sel"));
    if (id) host.querySelector(`.cfv-i[data-id="${CSS.escape(id)}"]`)?.classList.add("is-sel");
  }
  /** 空いている所（w × h が入る、上から・左から最初の所。tab: そのタブの中で） */
  function freeSpot(body, w = 3, h = 1, tab = "") {
    const list = inTab(body, tab);
    for (let y = 0; y < 200; y++) for (let x = 0; x + w <= body.cols; x++) { const r = { x, y, w, h }; if (TPA.grid.fits(r, list, null, body.cols)) return r; }
    return { x: 0, y: Math.max(0, ...list.map((i) => i.y + i.h)), w, h };
  }
  window.CardForm = { tabsOf, tabOf, inTab, shutSet, tabsHtml, families, dateLike: (c) => DATE_COL.test(c), labPicker, FS, ALIGN, LAB, BORDER, COLORS, BGS, DENSITY, style, newId, builtins, render, attach, select, freeSpot, valueOf, labelOf, compiled };
})();
