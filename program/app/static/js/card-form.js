"use strict";
/* =========================================================================
   カードの設計（版 3.55.0。利用者の要望 2026-10-25: Access のフォームのように、カードを見た目のまま設計する。
   置き場は services/card_forms.py・/api/card-forms。カードの窓は lotlist-card.js。決め方: ui-proposals/2026-10-cardform*）
   - 設計の形（body）: {cols: 方眼の列, row: 1 段の高さ px, theme: {accent, density, radius}, items: [{id, kind, col|expr|text, label, x, y, w, h, st}]}
     kind … field（列の値）・combo（組み合わせた項目: 表示列の作り方と同じ式 list-formula.js）・text（決まった字）・section（見出しの線）
     st … 見栄え {fs: s|m|l|xl, bold, color, bg, align, lab: top|left|none, border: line|none|strong}（色は鍵だけ。CSS の色の組 .cfv-c-鍵）
   - 組み込みの標準（開発側で決めた既定）: 表の列から組む（列は表ごとに違う）。標準・要点・2 段
   - 描く（view）と直す（edit）は同じ方眼・同じ大きさ（直すときは点線の枠と四隅の取っ手が重なるだけ）
   - 方眼の決まり（重ならない・方眼の外へ出ない・角を引いた大きさ）は TPA.grid（shared.js。ダッシュボードのパネルと同じ）
   ========================================================================= */
(function () {
  const { esc } = TPA;
  const FS = [["s", "小"], ["m", "中"], ["l", "大"], ["xl", "特大"]];
  const ALIGN = [["left", "左"], ["center", "中"], ["right", "右"]];
  const LAB = [["top", "上"], ["left", "左"], ["none", "出さない"]];
  const BORDER = [["line", "細い線"], ["strong", "太い線"], ["none", "線なし"]];
  // 色の鍵（サーバーの card_forms.COLORS・BGS と同じ）。名前は人の言葉で
  const COLORS = [["", "標準"], ["ink", "黒"], ["muted", "灰"], ["blue", "藍"], ["teal", "青緑"], ["green", "緑"], ["amber", "琥珀"], ["red", "赤"], ["purple", "紫"]];
  const BGS = [["", "標準"], ["white", "白"], ["pale", "淡い灰"], ["blue", "淡い藍"], ["teal", "淡い青緑"], ["green", "淡い緑"], ["amber", "淡い琥珀"], ["red", "淡い赤"], ["gray", "灰"]];
  const DENSITY = [["compact", "詰める"], ["normal", "標準"], ["roomy", "ゆったり"]];
  const LONG = /備考|コメント|メモ|内容|詳細|所見|理由/;
  const style = (st = {}) => ({ fs: "m", bold: false, color: "", bg: "", align: "left", lab: "top", border: "line", ...st });
  let uid = 0;
  const newId = () => `i${Date.now().toString(36)}${(++uid).toString(36)}`;

  /* ---------------- 組み込みの標準（列から組む） ---------------- */
  /** cols: 出す列（並び）。label(c): 列の表示名。→ 組み込みの設計の並び [{id: "b:鍵", name, builtin: true, body}] */
  function builtins(cols) {
    const field = (c, x, y, w, h, st) => ({ id: newId(), kind: "field", col: c, label: "", x, y, w, h, st: style(st) });
    const flow = (list, per, y0, st = {}, h = 1) => {     // per 個ずつ並べる（長い字の列は 1 段まるごと・2 段）
      const out = []; let x = 0, y = y0; const w = 12 / per;
      list.forEach((c) => {
        if (LONG.test(c)) { if (x) { y += h; x = 0; } out.push(field(c, 0, y, 12, 2, st)); y += 2; return; }
        out.push(field(c, x, y, w, h, st)); x += w; if (x >= 12) { x = 0; y += h; }
      });
      return { items: out, next: x ? y + h : y };
    };
    const std = flow(cols, 3, 0);
    const key = cols.slice(0, 3), rest = flow(cols.slice(3), 4, 3);
    const two = flow(cols, 2, 0, { lab: "left" });
    const body = (items, extra = {}) => ({ cols: 12, row: 48, theme: { accent: "blue", density: "normal", radius: 9 }, items, ...extra });
    return [
      { id: "b:standard", name: "標準", builtin: true, body: body(std.items) },
      { id: "b:key", name: "要点", builtin: true, body: body(key.map((c, i) => field(c, i * 4, 0, 4, 2, { fs: "xl", bold: true, color: i ? "" : "red" }))
        .concat([{ id: newId(), kind: "section", text: "そのほか", label: "", x: 0, y: 2, w: 12, h: 1, st: style() }], rest.items)) },
      { id: "b:two", name: "2 段", builtin: true, body: body(two.items, { row: 40 }) },
    ];
  }

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
    return { text: it.text || "", color: "" };
  }
  const cache = new Map();
  function compiled(expr) {
    if (cache.has(expr)) return cache.get(expr);
    let c = null; try { c = window.WL.formula.compile(expr); } catch (_) { c = null; }
    if (cache.size > 200) cache.clear();
    cache.set(expr, c); return c;
  }
  const labelOf = (it, ctx) => it.label || (it.kind === "field" ? ctx.label(it.col) : it.kind === "combo" ? "組み合わせ" : "");
  /** 設計 body を、入れ物 host に描く（edit: 直すとき＝点線・取っ手・選んだ印）。sel: 選んでいる項目の id */
  function render(host, body, ctx, { edit = false, sel = null, hideEmpty = false } = {}) {
    const th = body.theme || {};
    host.className = `cfv cfv-d-${th.density || "normal"} cfv-a-${th.accent || "blue"}${edit ? " is-edit" : ""}`;
    host.style.setProperty("--cf-cols", body.cols || 12);
    host.style.setProperty("--cf-row", `${body.row || 48}px`);
    host.style.setProperty("--cf-r", `${th.radius ?? 9}px`);
    const rows = Math.max(1, ...body.items.map((it) => it.y + it.h));
    host.style.setProperty("--cf-rows", edit ? rows + 2 : rows);
    host.innerHTML = body.items.map((it) => {
      const st = style(it.st), v = valueOf(it, ctx), empty = !String(v.text ?? "").trim();
      if (hideEmpty && empty && it.kind !== "section" && it.kind !== "text" && !edit) return "";
      const lab = labelOf(it, ctx);
      const cls = `cfv-i k-${it.kind} fs-${st.fs} al-${st.align} lab-${st.lab} bd-${st.border}${st.bold ? " is-bold" : ""}${st.color ? ` cfv-c-${st.color}` : ""}${st.bg ? ` cfv-b-${st.bg}` : ""}`
        + `${empty ? " is-empty" : ""}${it.id === sel ? " is-sel" : ""}${v.bad ? " is-bad" : ""}`;
      const pos = `grid-column:${it.x + 1} / span ${it.w};grid-row:${it.y + 1} / span ${it.h}`;
      const inner = it.kind === "section" ? `<b class="cfv-sec">${esc(it.text || lab)}</b>`
        : it.kind === "text" ? `<span class="cfv-txt">${esc(it.text)}</span>`
        : `${st.lab === "none" ? "" : `<small class="cfv-l">${esc(lab)}${it.kind === "combo" && edit ? '<i class="cfv-tag">組み合わせ</i>' : ""}</small>`}`
          + `<b class="cfv-v${v.color ? " cell-" + v.color : ""}" title="${esc(v.text)}">${empty ? "—" : esc(v.text)}</b>`;
      return `<div class="${cls}" data-id="${esc(it.id)}" style="${pos}"${edit ? ' tabindex="0"' : ""}>${inner}`
        + (edit ? ["nw", "ne", "sw", "se"].map((d) => `<i class="cfv-rz" data-rz="${d}" aria-hidden="true"></i>`).join("") : "") + "</div>";
    }).join("") + (body.items.length ? "" : '<p class="cfv-none">項目がありません。「＋ 項目」で足します。</p>');
  }

  /* ---------------- 直す（掴んで動かす・四隅で大きさ。方眼の決まりは TPA.grid） ---------------- */
  /** host（render で描いた入れ物）の上で、項目を引いて動かす・四隅で大きさを変える。
      get() → いまの body。onChange(新しい body, 何をしたか)。onSelect(id)。onOpen(id)（ダブルクリック） */
  function attach(host, { get, onChange, onSelect, onOpen, say = () => {} }) {
    let drag = null;
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
      if (e.button !== 0) return;
      const el = e.target.closest(".cfv-i"); if (!el || !host.contains(el)) return;
      const it = get().items.find((x) => x.id === el.dataset.id); if (!it) return;
      onSelect(it.id);
      const rz = e.target.closest("[data-rz]");
      e.preventDefault();
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
      drag.r = r; drag.ok = TPA.grid.fits(r, b.items, drag.id, b.cols);
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
      onChange(b, d.dir ? "大きさを変えました" : "動かしました");
    };
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
    host.addEventListener("dblclick", (e) => { const el = e.target.closest(".cfv-i"); if (el) { e.preventDefault(); onOpen(el.dataset.id); } });
    // キー: 矢印＝動かす・Shift＋矢印＝右下の角・Alt＋Shift＋矢印＝左上の角（ダッシュボードと同じ）・Enter＝中身・Delete＝外す
    host.addEventListener("keydown", (e) => {
      const el = e.target.closest(".cfv-i"); if (!el || e.target !== el) return;
      const b = get(), it = b.items.find((x) => x.id === el.dataset.id); if (!it) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) {
        e.preventDefault(); e.stopPropagation();
        const r = e.shiftKey && e.altKey ? TPA.grid.sized(it, dir[0] ? "w" : "n", dir[0], dir[1], b.cols, 200)
          : e.shiftKey ? { ...it, w: Math.max(1, it.w + dir[0]), h: Math.max(1, it.h + dir[1]) } : { ...it, x: it.x + dir[0], y: it.y + dir[1] };
        if (r.x < 0 || r.y < 0 || r.x + r.w > b.cols || !TPA.grid.fits(r, b.items, it.id, b.cols)) { say("そこへは動かせません（ほかの項目か、方眼の端）"); return; }
        const nb = TPA.clone(b); Object.assign(nb.items.find((x) => x.id === it.id), { x: r.x, y: r.y, w: r.w, h: r.h });
        onChange(nb, e.shiftKey ? "大きさを変えました" : "動かしました", it.id);
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); onOpen(it.id); }
      if (e.key === "Delete") { e.preventDefault(); const nb = TPA.clone(b); nb.items = nb.items.filter((x) => x.id !== it.id); onChange(nb, "外しました"); }
    });
  }
  /** 空いている所（w × h が入る、上から・左から最初の所） */
  function freeSpot(body, w = 3, h = 1) {
    for (let y = 0; y < 200; y++) for (let x = 0; x + w <= body.cols; x++) { const r = { x, y, w, h }; if (TPA.grid.fits(r, body.items, null, body.cols)) return r; }
    return { x: 0, y: Math.max(0, ...body.items.map((i) => i.y + i.h)), w, h };
  }
  window.CardForm = { FS, ALIGN, LAB, BORDER, COLORS, BGS, DENSITY, style, newId, builtins, render, attach, freeSpot, valueOf, labelOf, compiled };
})();
