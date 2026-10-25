"use strict";
/* =========================================================================
   品質異常のカード（行をダブルクリック → その1行を読みやすいカードで見る）
   - 窓は浮き窓（見出しを掴んで動かす・4辺と4隅で大きさ。画面の端とほかのカードへ吸い付く。Alt+矢印で細かく動かす・
     Alt+Shift+矢印で細かく大きさ。位置と大きさはこの PC に覚える）。後ろの一覧は隠さず触れたまま。
   - いくつも開ける（組み合わせて見る）: ダブルクリックは「残す」にしていないカードの中身を替える。「残す」にしたカード
     はそのまま残り、次のダブルクリックは新しいカードに開く（Ctrl＋ダブルクリックはいつも新しいカード）。
     2枚以上のとき「並べる ▾」で並べ方を絵で選び（横に並べる・縦に積む・格子・右半分に・重ねる）、「違いを強調」でほかのカードと
     値が違う項目に印を付ける。開いているカードは一覧の件数の横の「棚」に札で並ぶ（押すと前へ・📌・×・並べる・全部閉じる）。
   - 項目の置き方は「カードの設計」（版 3.55.0。card-form.js・/api/card-forms。決め方: ui-proposals/2026-10-cardform* の 2 回目の H）:
     方眼に項目を置き、四隅で大きさ・掴んで動かす。直すときもカードの大きさのまま（点線と取っ手が重なるだけ）。項目のダブルクリックで、
     カードの左の縁の外に「項目の面」（名前・中身・組み合わせの式・見栄え）が付き、線で項目と結ぶ。設計は表ごとに、自分だけ・全員・全員の既定へ
     名前を付けて置け、★標準を開いたときに当てる（ダッシュボードと同じ）。組み込みの標準（標準・要点・2 段）は表の列から組む。
   - 値の見え方（表示名・値の整え方・読み替えの色）は一覧のセルと同じもの（LotListColumns.cell）。
   - ◀ ▶（←→）で一覧の前後の行へ。同じロットの行が一覧にいくつかあれば、札でその行へ切り替える。
   ========================================================================= */
(function () {
  const { $, $$, esc } = TPA;
  const KEY = { layouts: "tpa.lotlist.card.v1", rect: "tpa.lotlist.cardRect.v1", diff: "tpa.lotlist.cardDiff.v1", pick: "tpa.lotlist.cardForm.v1" };
  const CF = () => window.CardForm;
  const MAX_CARDS = 8, CASCADE = 28, Z_BASE = 72;   // 表示列の窓（80）より下に重ねる
  const LC = () => window.LotListColumns;
  const layouts = TPA.local.get(KEY.layouts, {});

  let P = null;                          // 一覧から渡る「いまの一覧」（mount）
  const cards = [];                      // 開いているカード（開いた順）
  let zTop = Z_BASE, serial = 0;
  let diffOn = !!TPA.local.get(KEY.diff, false);    // 既定は使わない（違う項目が多いと、どれも目立って印の意味が薄れる）

  /* ---------------- 配置（表ごと・どのカードも同じ） ---------------- */
  const blank = () => ({ order: [], hidden: null, spans: {}, heights: {}, cols: 0, size: "m", hideEmpty: false });
  const layout = () => Object.assign(blank(), layouts[P.target()] || {});
  function saveLayout(patch) { layouts[P.target()] = Object.assign(layout(), patch); TPA.local.set(KEY.layouts, layouts); renderAll(); }
  /* 項目の並びと顔ぶれ。hidden が null（まだ隠す・戻すをしていない）なら、一覧の表示列で隠した列を隠す */
  function fields() {
    const t = P.target(), lot = P.lotColumn(), L = layout();
    const all = LC().ordered(t, P.columns(), lot).filter((c) => c !== lot);   // ロット番号は見出しに出す
    const known = new Set(all);
    const order = L.order.filter((c) => known.has(c));
    all.forEach((c) => { if (!order.includes(c)) order.push(c); });           // 新しい列は後ろへ
    const hidden = new Set(L.hidden || LC().get(t).hidden);
    return { L, shown: order.filter((c) => !hidden.has(c)), hidden: order.filter((c) => hidden.has(c)) };
  }
  /* ---------------- 1枚の窓 ---------------- */
  const seg = (name, list, cur, label) => `<span class="lk-seg" role="radiogroup" aria-label="${label}"><em>${label}</em>`
    + list.map(([v, l]) => `<button type="button" role="radio" data-${name}="${v}" aria-checked="${String(v) === String(cur)}">${l}</button>`).join("") + "</span>";
  function makeCard() {
    const el = document.createElement("section");
    const card = { el, win: null, row: null, sig: "", idx: -1, pinned: false, editing: false, no: ++serial, tracks: 0 };
    el.className = "ll-cardwin"; el.hidden = true; el.tabIndex = -1;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "品質データのカード");
    el.innerHTML = `
      <div class="lc-head lk-head" data-drag title="見出しを掴んで動かせます（画面の端・ほかのカードへ吸い付きます。Alt を押すと吸い付きません）。&#10;大きさは4辺と4隅で変えられます。Alt+矢印＝動かす・Alt+Shift+矢印＝大きさ（Ctrl も押すと 1px ずつ）">
        <div class="lk-title"><small class="lc-eyebrow">品質データのカード<b class="lk-no" data-k="no"></b></small>
          <h3><span data-k="lot">-</span></h3><p class="lc-lead" data-k="sub"></p></div>
        <div class="lk-nav">
          <button type="button" class="lk-pin" data-card="pin" aria-pressed="false" title="このカードを残します。次のダブルクリックは新しいカードに開きます（組み合わせて見られます）">📌 残す</button>
          <button type="button" class="lk-tile" data-card="tile" hidden aria-haspopup="true" title="開いているカードの並べ方を、絵で選びます">並べる ▾</button>
          <button type="button" class="lk-pick" data-card="pick" title="一覧でロット番号を押したときと同じく、計算画面でこのロットを取り込みます">計算画面で開く</button>
          <button type="button" data-card="prev" title="一覧の前の行（←）" aria-label="前の行">◀</button>
          <button type="button" data-card="next" title="一覧の次の行（→）" aria-label="次の行">▶</button>
        </div>
        <button type="button" class="lc-x" data-card="close" title="このカードを閉じる（Esc）" aria-label="閉じる">×</button>
      </div>
      <div class="lk-sibs" data-k="sibs" hidden></div>
      <div class="lk-tools" data-k="tools"></div>
      <div class="lk-body"><div class="cfv" data-k="grid"></div></div>`;
    document.body.append(el);
    card.win = TPA.floatPanel(el, { key: KEY.rect, w: 760, h: 720, top: 70, align: "right", minW: 300, minH: 220 });
    const q = (k) => $(`[data-k="${k}"]`, el);
    card.q = q;
    // カードの設計を直すときの取っ手（掴んで動かす・四隅・ダブルクリック・キー）。直していないカードでは何もしない
    CF().attach(q("grid"), { get: () => ED.body, say: (m) => P.toast?.(m), enabled: () => !!ED && ED.card === card,
      onChange: (b, what, keep) => { if (what) commit(b); else renderForm(card); if (keep) focusItem(keep); },
      onSelect: (id) => { if (ED.sel !== id) { ED.sel = id; CF().select(q("grid"), id); if (side) openSide(id); } },
      onOpen: (id) => { ED.sel = id; CF().select(q("grid"), id); openSide(id); } });
    el.addEventListener("mousedown", () => raise(card), true);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const act = b.dataset.card;
      if (act === "close") closeCard(card);
      else if (act === "pin") { card.pinned = !card.pinned; renderAll(); }
      else if (act === "tile") openLayouts(b);
      else if (act === "pick") { if (card.row) P.onPick(String(card.row[P.lotColumn()] ?? "")); }
      else if (act === "prev" || act === "next") step(card, act === "prev" ? -1 : 1);
      else if (b.dataset.i && b.closest('[data-k="sibs"]')) setRow(card, +b.dataset.i);
      else if (b.dataset.cf) formAction(card, b.dataset.cf, b);
    });
    el.addEventListener("change", (e) => {
      if (e.target.dataset.k === "hideEmpty") saveLayout({ hideEmpty: e.target.checked });
      else if (e.target.dataset.cf === "pick") pickDesign(e.target.value);
    });
    // ←→ で前後の行（入力欄の矢印・Alt＝窓を動かす は奪わない）。Esc はこのカードだけを閉じる
    el.addEventListener("keydown", (e) => {
      if (ED && ED.card === card && (e.ctrlKey || e.metaKey) && !e.target.closest("input,select,textarea")) {     // 直しているとき: Ctrl＋Z・Ctrl＋S
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); formAction(card, "undo"); return; }
        if (k === "s") { e.preventDefault(); if (canOverwrite()) saveOver(); else saveAsPop($('[data-cf="save"]', el)); return; }
      }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (ED && ED.card === card) { if (side) closeSide(); else stopEdit(); return; } closeCard(card); return; }
      if (e.target.closest("input,select,textarea") || e.altKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(card, e.key === "ArrowLeft" ? -1 : 1); }
    });
    return card;
  }
  function raise(card) {
    if (+card.el.style.zIndex === zTop) return;
    zTop = Math.min(zTop + 1, Z_BASE + MAX_CARDS + 1);
    if (zTop >= Z_BASE + MAX_CARDS + 1) {   // 上限まで来たら、重なり順を保ったまま詰め直す
      cards.slice().sort((a, b) => (+a.el.style.zIndex || 0) - (+b.el.style.zIndex || 0)).forEach((c, i) => { c.el.style.zIndex = Z_BASE + i; });
      zTop = Z_BASE + cards.length;
    }
    card.el.style.zIndex = zTop;
    renderShelf();                          // 棚の「前のカード」の印も合わせる
  }

  /* ---------------- 描く ---------------- */
  let sentinel = null;      // Esc の重なり順の代わり（カードが1枚でも開いていれば「見えている」。一覧に居るときの Esc は前のカードを閉じる）
  function renderAll() { if (sentinel) sentinel.hidden = !cards.length; cards.forEach(render); renderShelf(); P.onShow(cards.map((c) => c.idx), cards.length ? top().idx : -1); }
  const top = () => cards.reduce((a, c) => ((+c.el.style.zIndex || 0) >= (+a.el.style.zIndex || 0) ? c : a), cards[0]);
  /* 2枚以上のとき: ほかのカードと値が違う列 */
  function diffCols() {
    if (!diffOn || cards.length < 2) return null;
    const t = P.target(), out = new Set();
    const rowsShown = cards.map((c) => c.row).filter(Boolean);
    fields().shown.forEach((c) => { if (new Set(rowsShown.map((r) => LC().cell(t, c, r).text)).size > 1) out.add(c); });
    return out;
  }
  function render(card) {
    const { el, q, row, idx } = card;
    if (el.hidden) return;
    const t = P.target(), lot = P.lotColumn(), rows = P.rows();
    const lotVal = row && lot ? String(row[lot] ?? "") : "";
    q("no").textContent = cards.length > 1 ? `　${cards.indexOf(card) + 1} / ${cards.length}` : "";
    q("lot").textContent = lotVal || "（ロット番号なし）";
    q("sub").textContent = idx >= 0 ? `このページの ${idx + 1} / ${rows.length} 行目`
      : "この行はいまの一覧にありません（絞り込み・並べ替え・ページが変わりました）。表示は開いたときの値です";
    $('[data-card="prev"]', el).disabled = idx <= 0;
    $('[data-card="next"]', el).disabled = idx < 0 || idx >= rows.length - 1;
    const pin = $('[data-card="pin"]', el);
    pin.setAttribute("aria-pressed", String(card.pinned));
    pin.textContent = card.pinned ? "📌 残しています" : "📌 残す";
    pin.title = card.pinned ? "このカードは残しています。押すと残すのをやめ、次のダブルクリックでこのカードの中身が替わります"
      : "このカードを残します。次のダブルクリックは新しいカードに開きます（組み合わせて見られます）";
    el.classList.toggle("is-pinned", card.pinned);
    $('[data-card="tile"]', el).hidden = cards.length < 2;
    // 同じロットの行（一覧のこのページにあるもの）
    const k = row ? P.lotKey(row) : "";
    const sibs = k ? rows.map((r, i) => [r, i]).filter(([r]) => P.lotKey(r) === k) : [];
    const sb = q("sibs");
    sb.hidden = sibs.length < 2;
    sb.innerHTML = sibs.length < 2 ? "" : `<em>同じロットの行 ${sibs.length}件</em>`
      + sibs.map(([, i], n) => `<button type="button" data-i="${i}" aria-pressed="${i === idx}" title="一覧の ${i + 1} 行目">${n + 1}</button>`).join("");
    $('[data-card="pick"]', el).disabled = !lotVal;
    renderForm(card);
  }

  /* ================= カードの設計（版 3.55.0。card-form.js・/api/card-forms。決め方: ui-proposals/2026-10-cardform* の 2 回目の H） =================
     見るとき: 上の 1 段に「デザイン ▾（選ぶ）・空欄を隠す・デザインを直す」。直すとき: 同じ高さの 1 段が編集の帯（＋ 項目 ▾・見栄え ▾・元に戻す・
     保存 ▾・終える）になり、方眼はカードの大きさのまま（点線と四隅の取っ手が重なるだけ）。項目のダブルクリック（Enter）で、カードの左の縁の外に
     「項目の面」が付き、線で項目と結ぶ（左に空きが無ければ右。カードを動かす・中を送ると付いていく）。直すのは 1 枚のカードだけ（ほかのカードは見るまま） */
  const FORMS = {};          // 表の鍵 → {list: 置いた設計, standardId, canEditCommon, canEditDefault, login, loaded}
  let ED = null;             // 直している: {card, key, base（元の設計の id）, name, body（下書き）, saved（保存した形の字）, sel, hist: []}
  const formKey = () => (P.formKey ? P.formKey() : P.target());
  const sourceOf = (k = formKey()) => `card:${k}`;
  async function loadForms(force = false) {
    const k = formKey();
    if (FORMS[k] && FORMS[k].loaded && !force) return FORMS[k];
    FORMS[k] = FORMS[k] || { list: [], standardId: null, loaded: false };
    try {
      const r = await fetch(`/api/card-forms?source=${encodeURIComponent(sourceOf(k))}`, { cache: "no-store" });
      const d = await r.json();
      if (r.ok) Object.assign(FORMS[k], { list: d.items || [], standardId: d.standardId, canEditCommon: d.canEditCommon, canEditDefault: d.canEditDefault, login: d.login, loaded: true });
    } catch (_) { FORMS[k].loaded = true; }
    return FORMS[k];
  }
  /** 選べる設計（自分・全員・全員の既定に置いた物 → 組み込み）。組み込みは表の列（表示列の並び・顔ぶれ）から組む */
  function designs() {
    const f = FORMS[formKey()] || { list: [] };
    return f.list.concat(CF().builtins(fields().shown));
  }
  function pickedId() {
    const k = formKey(), f = FORMS[k] || {}, m = TPA.local.get(KEY.pick, {}) || {};
    return m[k] || (f.standardId != null ? String(f.standardId) : "b:standard");
  }
  function current() {
    const all = designs(), id = pickedId();
    return all.find((x) => String(x.id) === String(id)) || all.find((x) => x.id === "b:standard");
  }
  function pickDesign(id) {
    const m = { ...(TPA.local.get(KEY.pick, {}) || {}) }; m[formKey()] = String(id); TPA.local.set(KEY.pick, m);
    renderAll();
  }
  const scopeName = (x) => (x.builtin ? "組み込み" : TPA.scope.NAME[x.scope] || "");
  function ctxOf(card) {
    const t = P.target(), row = card.row;
    return { row, cell: (c) => LC().cell(t, c, row), label: (c) => LC().label(t, c), rowFor: () => LC().rowFor(t, row) };
  }
  function renderForm(card) {
    const { q } = card, L = layout(), editing = ED && ED.card === card;
    const d = editing ? null : current(), body = editing ? ED.body : d.body;
    const tools = q("tools");
    tools.classList.toggle("is-editing", !!editing);
    if (editing) {
      tools.innerHTML = `<b class="cf-ing" title="四隅で大きさ・掴んで動かす・ダブルクリック（Enter）で中身と見栄え。矢印＝動かす・Shift＋矢印＝大きさ・Delete＝外す">デザインを直しています</b>`
        + `<span class="cf-name" title="${esc(ED.name)}">「${esc(ED.name)}」${dirty() ? "<i>変更あり</i>" : ""}</span><span class="lc-sp"></span>`
        + '<button type="button" data-cf="add" aria-haspopup="menu" title="置いていない列・組み合わせた項目（式）・見出しの線・字を足します">＋ 項目 ▾</button>'
        + '<button type="button" data-cf="look" aria-haspopup="dialog" title="カード全体の色・詰め具合・角の丸み・方眼の大きさ">見栄え ▾</button>'
        + `<button type="button" data-cf="undo"${ED.hist.length ? "" : " disabled"} title="1 つ前に戻します（Ctrl＋Z）">元に戻す</button>`
        + '<button type="button" data-cf="save" aria-haspopup="menu" title="上書き・名前を付けて保存（自分だけ・全員・全員の既定）・★標準">保存 ▾</button>'
        + '<button type="button" data-cf="done" class="lc-primary">終える</button>';
    } else {
      const all = designs(), cur = d;
      const opt = (x) => `<option value="${esc(x.id)}"${String(x.id) === String(cur.id) ? " selected" : ""}>${esc(x.name)}（${esc(scopeName(x))}${x.standard ? "・★" : ""}）</option>`;
      tools.innerHTML = `<label class="cf-pick">デザイン<select data-cf="pick" aria-label="カードのデザイン">${all.map(opt).join("")}</select></label>`
        + `<label class="lk-check"><input type="checkbox" data-k="hideEmpty"${L.hideEmpty ? " checked" : ""}>空欄を隠す</label><span class="lc-sp"></span>`
        + '<button type="button" data-cf="edit" title="このカードの見た目のまま、項目の置き場・大きさ・名前・中身・見栄えを直します">デザインを直す</button>';
    }
    const host = q("grid");
    CF().render(host, body, ctxOf(card), { edit: !!editing, sel: editing ? ED.sel : null, hideEmpty: L.hideEmpty, diff: diffCols() });
    if (side) placeSide();
  }
  const focusItem = (id) => requestAnimationFrame(() => ED && ED.card.q("grid").querySelector(`.cfv-i[data-id="${CSS.escape(id)}"]`)?.focus());
  const dirty = () => !!ED && JSON.stringify(ED.body) !== ED.saved;
  function commit(b) {
    if (!ED) return;
    ED.hist.push(ED.body); if (ED.hist.length > 50) ED.hist.shift();
    ED.body = b;
    if (ED.sel && !b.items.some((x) => x.id === ED.sel)) { ED.sel = null; closeSide(); }
    renderForm(ED.card);
    if (side) fillSide();
  }
  async function startEdit(card) {
    if (ED && ED.card !== card && !(await stopEdit())) return;
    const d = current();
    ED = { card, key: formKey(), base: d.id, builtin: !!d.builtin, name: d.name, body: TPA.clone(d.body), saved: JSON.stringify(d.body), sel: null, hist: [], item: d };
    raise(card);
    renderForm(card);
  }
  async function stopEdit(force = false) {
    if (!ED) return true;
    if (!force && dirty() && !(await TPA.unsaved.leave("list", "デザインを直すのを終える"))) return false;
    const card = ED.card; ED = null; closeSide();
    renderAll(); card.el.focus({ preventScroll: true });
    return true;
  }
  TPA.unsaved.watch("list:cardform", { scope: "list", dirty: () => dirty(),
    label: () => `カードのデザイン「${ED ? ED.name : ""}」`, canSave: () => !!ED && canOverwrite(),
    save: async () => { await saveOver(); return !dirty(); }, discard: () => { if (ED) { const c = ED.card; ED = null; closeSide(); render(c); } } });
  const canOverwrite = () => !!ED && !ED.builtin && !!(ED.item && ED.item.canEdit);

  function formAction(card, act, b) {
    if (act === "edit") startEdit(card);
    else if (!ED || ED.card !== card) return;
    else if (act === "done") stopEdit();
    else if (act === "undo") { if (ED.hist.length) { ED.body = ED.hist.pop(); renderForm(card); if (side) fillSide(); } }
    else if (act === "add") addMenu(b);
    else if (act === "look") lookPop(b);
    else if (act === "save") saveMenu(b);
  }
  /* ---- ＋ 項目 ▾ ---- */
  function addMenu(anchor) {
    const placed = new Set(ED.body.items.filter((x) => x.kind === "field").map((x) => x.col)), t = P.target();
    const cols = LC().ordered(t, P.columns(), P.lotColumn()).filter((c) => !placed.has(c));
    const r = anchor.getBoundingClientRect();
    const put = (it, w = 4, h = 1) => { const at = CF().freeSpot(ED.body, w, h), b = TPA.clone(ED.body), id = CF().newId(); b.items.push({ id, label: "", st: CF().style(), ...it, ...at }); ED.sel = id; commit(b); openSide(id); };
    TPA.menu({ x: r.left, y: r.bottom + 2, head: "項目を足す（空いた所に置きます）", items: [
      { group: cols.length ? `置いていない列（${cols.length}）` : "置いていない列はありません" },
      ...cols.slice(0, 40).map((c) => ({ label: LC().label(t, c), icon: "▢", run: () => put({ kind: "field", col: c }, 4, LONG_RE.test(c) ? 2 : 1) })),
      { sep: true },
      { label: "組み合わせた項目（式）…", icon: "ƒ", run: () => put({ kind: "combo", label: "組み合わせ", expr: cols[0] || P.columns()[0] ? `[${cols[0] || P.columns()[0]}]` : "''" }) },
      { label: "見出しの線", icon: "―", run: () => put({ kind: "section", text: "見出し" }, 12, 1) },
      { label: "字（決まった文）", icon: "T", run: () => put({ kind: "text", text: "字" }, 4, 1) },
    ] });
  }
  const LONG_RE = /備考|コメント|メモ|内容|詳細|所見|理由/;
  /* ---- 見栄え ▾（カード全体） ---- */
  let lookEl = null, lookOff = null;
  function closeLook() { lookEl?.remove(); lookEl = null; lookOff?.(); lookOff = null; }
  /** 名前のある項目の置き方が 1 つにそろっていればその鍵（ばらばらなら空） */
  const labAll = () => { const s = new Set(ED.body.items.filter((x) => x.kind === "field" || x.kind === "combo").map((x) => CF().style(x.st).lab)); return s.size === 1 ? [...s][0] : ""; };
  function lookPop(anchor) {
    if (lookEl) { closeLook(); return; }
    lookEl = document.createElement("div"); lookEl.className = "cf-look"; lookEl.setAttribute("role", "dialog"); lookEl.setAttribute("aria-label", "カード全体の見栄え");
    document.body.append(lookEl);
    const paint = () => {
      const th = ED.body.theme || {};
      const seg = (k, list, cur) => `<span class="cf-seg">${list.map(([v, n]) => `<button type="button" data-lk="${k}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${n}</button>`).join("")}</span>`;
      lookEl.innerHTML = '<h5>カード全体の見栄え</h5>'
        + `<div class="cf-row"><span>色</span><span class="cf-sws">${CF().COLORS.filter(([k]) => k && k !== "ink" && k !== "muted").map(([k, n]) => `<button type="button" class="cf-sw cfv-sw-${k}" data-lk="accent" data-v="${k}" aria-pressed="${k === (th.accent || "blue")}" title="${n}"></button>`).join("")}</span></div>`
        + `<div class="cf-row"><span>詰め具合</span>${seg("density", CF().DENSITY, th.density || "normal")}</div>`
        + `<div class="cf-row"><span>角の丸み</span>${seg("radius", [[0, "角"], [5, "少し"], [9, "標準"], [14, "丸く"]], th.radius ?? 9)}</div>`
        + `<div class="cf-row"><span>1 段の高さ</span>${seg("row", [[40, "低い"], [48, "標準"], [60, "高い"]], ED.body.row)}</div>`
        + `<div class="cf-row"><span>方眼の列</span>${seg("cols", [[8, "8"], [12, "12"], [16, "16"], [24, "24"]], ED.body.cols)}</div>`
        + `<div class="cf-row cf-full"><span>名前と値の置き方（全部の項目に当てる）</span>${CF().labPicker('data-lk="lab"', labAll())}</div>`;
    };
    paint();
    TPA.placeBelow(lookEl, anchor, "right");
    lookEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lk]"); if (!b || !ED) return;
      const nb = TPA.clone(ED.body), k = b.dataset.lk, v = b.dataset.v;
      if (k === "lab") nb.items.forEach((it) => { if (it.kind === "field" || it.kind === "combo") it.st = { ...CF().style(it.st), lab: v }; });
      else if (k === "row") nb.row = +v;
      else if (k === "cols") {
        const n = +v, f = n / nb.cols;    // 列を替えるときは置き場を比で直す（重なれば下へ積む）
        nb.cols = n;
        const out = [];
        nb.items.forEach((it) => { const r = { ...it, x: Math.min(n - 1, Math.round(it.x * f)), w: Math.max(1, Math.round(it.w * f)) }; r.w = Math.min(r.w, n - r.x);
          while (!TPA.grid.fits(r, out, r.id, n)) r.y += 1; out.push(r); });
        nb.items = out;
      } else nb.theme = { ...(nb.theme || {}), [k]: k === "radius" ? +v : v };
      commit(nb); paint();
    });
    lookOff = TPA.dismissable(lookEl, closeLook, { keep: anchor });
  }
  /* ---- 保存 ▾ ---- */
  function saveMenu(anchor) {
    const f = FORMS[ED.key] || {}, r = anchor.getBoundingClientRect(), it = ED.item || {};
    TPA.menu({ x: r.left, y: r.bottom + 2, head: `デザイン「${ED.name}」`, items: [
      { label: "上書き保存", icon: "💾", key: "Ctrl+S", disabled: !canOverwrite(), why: ED.builtin ? "組み込みは上書きできません。名前を付けて保存してください" : !it.canEdit ? "この置き場には書けません。名前を付けて保存してください" : "", run: () => saveOver() },
      { label: "名前を付けて保存…", icon: "＋", run: () => saveAsPop(anchor) },
      { sep: true },
      { label: it.standard ? "★標準を外す" : "★標準にする（開いたときに当てる）", icon: "★", disabled: !canOverwrite(), why: canOverwrite() ? "" : "保存した自分の・書ける置き場のデザインだけです", run: () => setStandard(!it.standard) },
      { label: "このデザインを消す", icon: "🗑", danger: true, disabled: !canOverwrite(), why: canOverwrite() ? "" : "組み込み・書けない置き場のデザインは消せません", run: () => removeDesign() },
      { sep: true },
      { label: "変更を捨てて元に戻す", icon: "↺", disabled: !dirty(), run: () => { ED.body = JSON.parse(ED.saved); ED.hist = []; renderForm(ED.card); if (side) fillSide(); } },
    ].concat(f.loaded ? [] : [{ group: "置いた設計を読めていません（つながっていない可能性）" }]) });
  }
  async function send(method, url, body) {
    const r = await fetch(url, TPA.json(method, body)); const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "保存できませんでした");
    return d;
  }
  async function saveOver() {
    if (!canOverwrite()) { P.toast?.("このデザインは上書きできません。名前を付けて保存してください"); return; }
    try {
      const d = await send("PUT", `/api/card-forms/${ED.item.id}`, { body: ED.body, base_rev: ED.item.rev });
      await afterSave(d, `「${d.name}」を上書きしました`);
    } catch (e) { P.toast?.(String(e.message || e)); }
  }
  async function afterSave(d, msg) {
    await loadForms(true);
    pickDesign(d.id);
    if (ED) { ED.base = d.id; ED.item = d; ED.name = d.name; ED.builtin = false; ED.saved = JSON.stringify(d.body); ED.body = TPA.clone(d.body); }
    renderAll(); P.toast?.(msg);
  }
  async function setStandard(on) {
    try { const d = await send("PUT", `/api/card-forms/${ED.item.id}`, { standard: on, base_rev: ED.item.rev }); await loadForms(true); ED.item = d; renderAll(); P.toast?.(on ? `「${d.name}」を★標準にしました（${TPA.scope.NAME[d.scope]}）` : "★標準を外しました"); }
    catch (e) { P.toast?.(String(e.message || e)); }
  }
  async function removeDesign() {
    try {
      await send("DELETE", `/api/card-forms/${ED.item.id}?rev=${ED.item.rev}`, {});
      await loadForms(true); pickDesign("b:standard");
      const c = ED.card; ED = null; closeSide(); render(c); P.toast?.("デザインを消しました（組み込みの標準に戻しました）");
    } catch (e) { P.toast?.(String(e.message || e)); }
  }
  let saveEl = null, saveOff = null;
  function closeSaveAs() { saveEl?.remove(); saveEl = null; saveOff?.(); saveOff = null; }
  function saveAsPop(anchor) {
    closeSaveAs();
    const f = FORMS[ED.key] || {}, ok = { me: !!f.login, all: !!f.canEditCommon, default: !!f.canEditDefault };
    saveEl = document.createElement("div"); saveEl.className = "cf-look cf-saveas"; saveEl.setAttribute("role", "dialog"); saveEl.setAttribute("aria-label", "名前を付けて保存");
    const first = TPA.scope.ORDER.find((k) => ok[k]) || "me";
    saveEl.innerHTML = `<h5>名前を付けて保存</h5><label><span>名前</span><input class="cf-in" data-sv="name" maxlength="40" value="${esc(ED.builtin ? `${ED.name}（直した）` : ED.name)}"></label>`
      + `<div class="cf-scopes">${TPA.scope.ORDER.map((k) => `<label class="cf-sc${ok[k] ? "" : " is-off"}"><input type="radio" name="cfsc" value="${k}"${k === first ? " checked" : ""}${ok[k] ? "" : " disabled"}>${TPA.scope.head(k)}</label>`).join("")}</div>`
      + '<label class="lk-check"><input type="checkbox" data-sv="std">★標準にする（この表のカードを開いたときに当てる）</label>'
      + '<p class="cf-err" data-sv="err" hidden></p><div class="cf-acts"><button type="button" data-sv="cancel">やめる</button><button type="button" class="lc-primary" data-sv="ok">保存</button></div>';
    document.body.append(saveEl);
    TPA.placeBelow(saveEl, anchor, "right");
    const q = (k) => saveEl.querySelector(`[data-sv="${k}"]`);
    q("name").focus(); q("name").select();
    const go = async () => {
      const name = q("name").value.trim(), scope = (saveEl.querySelector("input[name=cfsc]:checked") || {}).value;
      if (!name) { q("err").hidden = false; q("err").textContent = "名前を入れてください"; return; }
      try {
        // 同じ置き場の同じ名前は上書き（ダッシュボードと同じ。2 つに増やさない）
        const same = (f.list || []).find((x) => x.scope === scope && x.name === name && x.canEdit);
        const d = same ? await send("PUT", `/api/card-forms/${same.id}`, { body: ED.body, standard: q("std").checked || same.standard, base_rev: same.rev })
          : await send("POST", "/api/card-forms", { name, source: sourceOf(ED.key), scope, standard: q("std").checked, body: ED.body });
        closeSaveAs(); await afterSave(d, `「${d.name}」を${TPA.scope.NAME[d.scope]}に保存しました`);
      } catch (e) { q("err").hidden = false; q("err").textContent = String(e.message || e); }
    };
    q("ok").onclick = go; q("cancel").onclick = closeSaveAs;
    q("name").addEventListener("keydown", (e) => { if (e.key === "Enter" && !TPA.composing(e)) { e.preventDefault(); go(); } });
    saveOff = TPA.dismissable(saveEl, closeSaveAs, { keep: anchor });
  }
  /* ---- 項目の面（カードの左の縁の外。線で項目と結ぶ） ---- */
  let side = null, sideRaf = 0;
  function closeSide() { if (!side) return; side.el.remove(); side.link.remove(); cancelAnimationFrame(sideRaf); side = null; }
  function openSide(id) {
    if (!ED) return;
    if (!side) {
      const el = document.createElement("aside"), link = document.createElement("i");
      el.className = "cf-side"; el.setAttribute("role", "dialog"); link.className = "cf-link"; link.setAttribute("aria-hidden", "true");
      document.body.append(link, el);
      side = { el, link, id };
      bindSide(el);
      const loop = () => { if (!side) return; placeSide(); sideRaf = requestAnimationFrame(loop); };   // カードを動かす・中を送ると付いていく
      sideRaf = requestAnimationFrame(loop);
    }
    side.id = id;
    fillSide();
    side.el.querySelector("[data-sd=label]")?.focus();
  }
  const itemOf = (id) => ED && ED.body.items.find((x) => x.id === id);
  function fillSide() {
    const it = itemOf(side.id); if (!it) { closeSide(); return; }
    const t = P.target(), st = CF().style(it.st), cur = (k, v) => String(st[k]) === String(v);
    const seg = (k, list) => `<span class="cf-seg">${list.map(([v, n]) => `<button type="button" data-st="${k}" data-v="${v}" aria-pressed="${cur(k, v)}">${n}</button>`).join("")}</span>`;
    const sws = (k, list, cls) => `<span class="cf-sws">${list.map(([v, n]) => `<button type="button" class="cf-sw ${cls}${v || "none"}" data-st="${k}" data-v="${v}" aria-pressed="${cur(k, v)}" title="${n}"></button>`).join("")}</span>`;
    const kindName = { field: "列", combo: "組み合わせた項目", text: "字", section: "見出しの線" }[it.kind];
    const cols = LC().ordered(t, P.columns(), "");
    let what = "";
    if (it.kind === "field") what = `<label><span>列</span><select data-sd="col">${cols.map((c) => `<option value="${esc(c)}"${c === it.col ? " selected" : ""}>${esc(LC().label(t, c))}</option>`).join("")}</select></label>`;
    else if (it.kind === "combo") {
      const chk = window.WL.formula.check(it.expr);
      what = `<label class="cf-w"><span>中身（式）</span><textarea data-sd="expr" rows="2" spellcheck="false">${esc(it.expr)}</textarea></label>`
        + `<label><span>列を入れる</span><select data-sd="ins"><option value="">選ぶと式の後ろに [列] を足す</option>${cols.map((c) => `<option value="${esc(c)}">${esc(LC().label(t, c))}</option>`).join("")}</select></label>`
        + `<p class="cf-hint${chk.ok ? "" : " is-ng"}">${chk.ok ? `表示列の作り方と同じ書き方です（例: [合金] + ' / ' + [調質]。+ は数なら足し、字ならつなぐ）。いまの行: <b>${esc(CF().valueOf(it, ctxOf(ED.card)).text || "（空）")}</b>` : esc(chk.error)}</p>`;
    } else what = `<label><span>字</span><input data-sd="text" value="${esc(it.text || "")}" maxlength="400"></label>`;
    side.el.innerHTML = `<header><b>${esc(kindName)}「${esc(CF().labelOf(it, { label: (c) => LC().label(t, c) }) || it.text || "")}」</b><button type="button" class="lc-x" data-sd="close" title="閉じる（Esc）" aria-label="閉じる">×</button></header>`
      + (it.kind === "section" || it.kind === "text" ? "" : `<label><span>名前</span><input data-sd="label" value="${esc(it.label)}" maxlength="60" placeholder="${esc(it.kind === "field" ? LC().label(t, it.col) : "組み合わせ")}"></label>`)
      + what
      + `<div class="cf-row"><span>字の大きさ</span>${seg("fs", CF().FS)}</div>`
      + `<div class="cf-row"><span>太さ</span><span class="cf-seg"><button type="button" data-st="bold" data-v="false" aria-pressed="${!st.bold}">標準</button><button type="button" data-st="bold" data-v="true" aria-pressed="${st.bold}">太字</button></span></div>`
      + `<div class="cf-row"><span>字の色</span>${sws("color", CF().COLORS, "cfv-tx-")}</div>`
      + `<div class="cf-row"><span>地の色</span>${sws("bg", CF().BGS, "cfv-bg-")}</div>`
      + `<div class="cf-row"><span>揃え</span>${seg("align", CF().ALIGN)}</div>`
      + (it.kind === "section" || it.kind === "text" ? "" : `<div class="cf-row cf-full"><span>名前と値の置き方</span>${CF().labPicker('data-st="lab"', st.lab)}</div>`)
      + `<div class="cf-row"><span>枠</span>${seg("border", CF().BORDER)}</div>`
      + `<footer><span class="cf-size">${it.w} × ${it.h} 升（四隅で変えられます）</span><button type="button" class="cf-del" data-sd="del">この項目を外す</button></footer>`;
  }
  function edit(fn) { const b = TPA.clone(ED.body), it = b.items.find((x) => x.id === side.id); if (!it) return; fn(it); commit(b); }
  function bindSide(el) {
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || !ED) return;
      if (b.dataset.sd === "close") { closeSide(); focusItem(ED.sel); return; }
      if (b.dataset.sd === "del") { const id = side.id; edit(() => {}); const nb = TPA.clone(ED.body); nb.items = nb.items.filter((x) => x.id !== id); commit(nb); closeSide(); return; }
      if (b.dataset.st) { const k = b.dataset.st, v = b.dataset.v; edit((it) => { it.st = { ...CF().style(it.st), [k]: k === "bold" ? v === "true" : v }; }); }
    });
    el.addEventListener("change", (e) => {
      const x = e.target; if (!ED) return;
      if (x.dataset.sd === "col") edit((it) => { it.col = x.value; });
      else if (x.dataset.sd === "ins" && x.value) { const v = x.value; x.value = ""; edit((it) => { it.expr = `${String(it.expr || "").trim()}${String(it.expr || "").trim() ? " + ' ' + " : ""}[${v}]`; }); }
    });
    // 打った字は確定してから入れる（変換中に面を作り直さない。版 3.46.0 と同じ）。名前・式・字は面を作り直さず、カードだけ描き直す
    TPA.onTextIn(el, "[data-sd=label],[data-sd=text],[data-sd=expr]", (x) => {
      const k = x.dataset.sd, b = TPA.clone(ED.body), it = b.items.find((y) => y.id === side.id); if (!it) return;
      it[k] = x.value; ED.hist.push(ED.body); ED.body = b; renderForm(ED.card);
      if (k === "expr") { const p = el.querySelector(".cf-hint"), chk = window.WL.formula.check(x.value); if (p) { p.classList.toggle("is-ng", !chk.ok); p.innerHTML = chk.ok ? `いまの行: <b>${esc(CF().valueOf(it, ctxOf(ED.card)).text || "（空）")}</b>` : esc(chk.error); } }
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSide(); if (ED) focusItem(ED.sel); } });
  }
  /** 面をカードの左の縁の外へ（空きが無ければ右・どちらも無ければカードの中の右上）。線は面から選んだ項目の真ん中へ */
  function placeSide() {
    if (!side || !ED) return;
    const it = ED.card.q("grid").querySelector(`.cfv-i[data-id="${CSS.escape(side.id)}"]`);
    const wr = ED.card.el.getBoundingClientRect(), w = side.el.offsetWidth, h = side.el.offsetHeight, gap = 14;
    const r = it ? it.getBoundingClientRect() : wr;
    const left = wr.left - w - gap >= 8, right = wr.right + w + gap <= innerWidth - 8;
    const x = left ? wr.left - w - gap : right ? wr.right + gap : Math.max(8, wr.right - w - 12);
    const y = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - 40));
    side.el.style.left = `${Math.round(x)}px`; side.el.style.top = `${Math.round(y)}px`;
    side.el.classList.toggle("is-inside", !left && !right);
    const cy = Math.max(wr.top + 4, Math.min(wr.bottom - 4, r.top + r.height / 2));
    const vis = it && r.bottom > wr.top && r.top < wr.bottom && (left || right);
    side.link.hidden = !vis;
    if (vis) {
      const a = left ? x + w : wr.right, bx = left ? wr.left : x;     // 線はカードの縁まで（ほかの項目の上を渡らない。項目は選んだ印で分かる）
      side.link.style.left = `${Math.round(Math.min(a, bx))}px`; side.link.style.width = `${Math.max(0, Math.round(Math.abs(bx - a)))}px`;
      side.link.style.top = `${Math.round(cy)}px`;
    }
  }

  /* ---------------- 行・枚数・並べる ---------------- */
  const sigOf = (r) => JSON.stringify(r);
  function setRow(card, i) {
    const rows = P.rows(); if (!rows[i]) return;
    card.row = rows[i]; card.sig = sigOf(card.row); card.idx = i;
    renderAll();
  }
  function openCard() {
    const card = makeCard(), prev = cards[cards.length - 1];
    cards.push(card);
    card.win.place();
    card.el.hidden = false;
    if (prev) {               // 前のカードから少しずらして重ねる（どれも見える）。覚えた位置は変えない
      const r = prev.win.rect();
      // 右へずらすと画面からはみ出すなら左へ（右寄せの窓が一覧の左側を覆わないように、少しずつ）
      const x = r.x + r.w + CASCADE <= innerWidth - 8 ? r.x + CASCADE : Math.max(8, r.x - CASCADE);
      const y = r.y + r.h + CASCADE <= innerHeight - 8 ? r.y + CASCADE : Math.max(60, r.y - CASCADE);
      card.win.setRect({ x, y, w: r.w, h: r.h }, false);
    }
    return card;
  }
  /* i 行目をカードで出す。another: いつも新しいカードに（Ctrl＋ダブルクリック） */
  function show(i, { another = false } = {}) {
    if (!P.rows()[i]) return;
    let card = another ? null : [...cards].reverse().find((c) => !c.pinned) || null;
    if (!card && cards.length >= MAX_CARDS) {
      card = cards.find((c) => !c.pinned) || null;
      if (!card) { P.toast?.(`カードは ${MAX_CARDS} 枚までです。どれかを閉じるか「残す」を外してください`); return; }
    }
    if (!card) card = openCard();
    raise(card);
    setRow(card, i);
    if (!(FORMS[formKey()] || {}).loaded) loadForms().then(() => renderAll());
    renderShelf();
    if (!card.el.contains(document.activeElement)) card.el.focus({ preventScroll: true });
  }
  function step(card, d) { if (card.idx >= 0) setRow(card, Math.max(0, Math.min(P.rows().length - 1, card.idx + d))); }
  /* ---------------- 並べ方（絵で選ぶ）と棚 ---------------- */
  const LAYOUTS = [
    ["row", "横に並べる", "左から右へ1列に並べます（比べるとき）"],
    ["col", "縦に積む", "上から下へ積みます"],
    ["grid", "格子", "縦横に敷き詰めます（枚数が多いとき）"],
    ["right", "右半分に", "画面の右半分に並べ、左の一覧を見えたままにします"],
    ["stack", "重ねる", "少しずつずらして重ねます（見出しが全部見える）"],
  ];
  const layoutPic = (k) => `<span class="lk-lay lk-lay-${k}" aria-hidden="true"><i></i><i></i><i></i>${k === "grid" ? "<i></i>" : ""}</span>`;
  /* 開いているカードを、一覧の画面の中に並べる（kind: LAYOUTS の鍵）。小さくなりすぎる並べ方は格子に替える */
  function tile(kind = "row") {
    const n = cards.length; if (n < 2) return;
    const scr = $("#lotListScreen"), top0 = scr ? Math.max(8, scr.getBoundingClientRect().top + 8) : 60;
    const gap = 8, area = { x: 8, y: top0, w: innerWidth - 16, h: innerHeight - top0 - 8 };
    if (kind === "right") { area.w = Math.round(innerWidth / 2) - 12; area.x = innerWidth - area.w - 8; }
    if (kind === "stack") {
      const w = Math.round(area.w * 0.55), h = Math.round(area.h * 0.8), step = 34;
      cards.forEach((c, k) => { c.win.setRect({ x: area.x + area.w - w - (n - 1 - k) * step, y: area.y + k * step, w, h }, false); raise(c); });
      return;
    }
    let cols = kind === "row" ? n : kind === "col" ? 1 : kind === "right" ? (n <= 3 ? 1 : 2) : Math.ceil(Math.sqrt(n));
    let rowsN = Math.ceil(n / cols);
    if ((area.w - gap * (cols - 1)) / cols < 300 || (area.h - gap * (rowsN - 1)) / rowsN < 220) { cols = Math.ceil(Math.sqrt(n)); rowsN = Math.ceil(n / cols); }
    const w = (area.w - gap * (cols - 1)) / cols, h = (area.h - gap * (rowsN - 1)) / rowsN;
    cards.forEach((c, k) => c.win.setRect({ x: area.x + (k % cols) * (w + gap), y: area.y + Math.floor(k / cols) * (h + gap), w, h }, false));
  }
  let layMenu = null, layOff = null;
  function closeLayouts() { layMenu?.remove(); layMenu = null; if (layOff) layOff(); layOff = null; }
  function openLayouts(anchor) {
    if (layMenu) { closeLayouts(); return; }
    layMenu = document.createElement("div");
    layMenu.className = "lk-laymenu"; layMenu.setAttribute("role", "menu");
    layMenu.innerHTML = `<p>並べ方<small>押すとすぐ並びます（${cards.length}枚）</small></p><div class="lk-lays">`
      + LAYOUTS.map(([k, name, tip]) => `<button type="button" role="menuitem" data-lay="${k}" title="${tip}">${layoutPic(k)}<span>${name}</span></button>`).join("") + "</div>";
    document.body.append(layMenu);
    TPA.placeBelow(layMenu, anchor, "right");
    layMenu.addEventListener("click", (e) => { const b = e.target.closest("[data-lay]"); if (b) { tile(b.dataset.lay); closeLayouts(); } });
    layOff = TPA.dismissable(layMenu, closeLayouts, { keep: anchor });
  }
  /* 棚: 一覧の件数の横に、開いているカードを札で並べる（どのカードがあるか・残しているか が一目で分かり、押すとそのカードが前に来る） */
  function renderShelf() {
    const sh = $("#llCardShelf"); if (!sh) return;
    sh.hidden = !cards.length;
    if (!cards.length) { sh.innerHTML = ""; return; }
    const lot = P.lotColumn(), front = top();
    sh.innerHTML = `<b class="lk-sh-n">カード ${cards.length}枚</b>` + cards.map((c, k) => {
      const name = c.row && lot ? String(c.row[lot] ?? "") || "（ロット番号なし）" : "-";
      return `<span class="lk-sh-c${c.pinned ? " is-pinned" : ""}${c === front ? " is-front" : ""}">`
        + `<button type="button" data-sh="pin" data-k="${k}" aria-pressed="${c.pinned}" title="${c.pinned ? "残しています（押すと残すのをやめます）" : "このカードを残します"}">📌</button>`
        + `<button type="button" data-sh="front" data-k="${k}" title="このカードを前に出します">${esc(name)}</button>`
        + `<button type="button" data-sh="x" data-k="${k}" title="このカードを閉じます" aria-label="閉じる">×</button></span>`;
    }).join("")
      + (cards.length > 1 ? `<button type="button" class="lk-sh-b" data-sh="lay" aria-haspopup="true" title="並べ方を絵で選びます">${layoutPic("row")}並べる ▾</button>`
        + `<button type="button" class="lk-sh-b lk-sh-diff" data-sh="diff" aria-pressed="${diffOn}" title="開いているカードの中で、値が違う項目に印を付けます">違いを強調</button>` : "")
      + '<button type="button" class="lk-sh-b" data-sh="all" title="開いているカードをすべて閉じます">全部閉じる</button>';
  }
  function bindShelf() {
    const sh = $("#llCardShelf"); if (!sh) return;
    sh.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sh]"); if (!b) return;
      const c = cards[+b.dataset.k], a = b.dataset.sh;
      if (a === "front" && c) { raise(c); c.el.focus({ preventScroll: true }); c.el.classList.remove("is-flash"); void c.el.offsetWidth; c.el.classList.add("is-flash"); renderShelf(); }
      else if (a === "pin" && c) { c.pinned = !c.pinned; renderAll(); }
      else if (a === "x" && c) closeCard(c);
      else if (a === "lay") openLayouts(b);
      else if (a === "diff") { diffOn = !diffOn; TPA.local.set(KEY.diff, diffOn); renderAll(); }
      else if (a === "all") close();
    });
  }
  /* 一覧が読み直された（絞り込み・並べ替え・ページ・表示列）: 同じ行を探し直し、無ければ開いたときの値のまま */
  function refresh() {
    if (!cards.length) return;
    const rows = P.rows();
    cards.forEach((c) => { c.idx = rows.findIndex((r) => sigOf(r) === c.sig); if (c.idx >= 0) c.row = rows[c.idx]; });
    renderAll();
  }
  function closeCard(card) {
    const k = cards.indexOf(card); if (k < 0) return;
    if (ED && ED.card === card) { ED = null; closeSide(); }
    if (cards.length === 1) card.win.remember();     // 最後の1枚の位置と大きさを、次に開くときの形にする
    card.el.hidden = true; card.el.remove();
    cards.splice(k, 1);
    renderAll();
    if (cards.length) top().el.focus({ preventScroll: true });
  }
  function close() { [...cards].forEach(closeCard); }
  window.LotListCard = {
    /** p: { rows(), target(), columns(), lotColumn(), lotKey(row), onPick(lot), onShow(行の番号の並び, いま前のカードの行), toast(文) } */
    mount(p) {
      P = p;
      // Esc の重なり順は最初に決める（後から開く窓＝マスタ管理などが上）。カードの窓は開くたびに作るので、目印の1つで受ける
      sentinel = document.createElement("i"); sentinel.hidden = true; document.body.append(sentinel);
      TPA.layer(sentinel, () => { if (cards.length) closeCard(top()); }, { backdrop: false });
      bindShelf();
    },
    show, refresh, close,
    isOpen: () => cards.length > 0,
  };
})();
