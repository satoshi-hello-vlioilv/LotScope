/* =========================================================================
   ダッシュボード（版 3.37.0。最初の画面。版 3.36.0 の 1 枚の表を、グリッドのパネルの 1 つにした）
   - 利用者の要望（2026-10）: グリッドにパネルを置き、大きさを変え、パネルごとにいろいろなデータから条件を組んでグラフや表を作る
     （各一覧の集計表・グラフを組むのと同じ感じで。Power BI のように）。スクロールしない（どの大きさの窓でも全部が見える）
   - グリッド: 横 12 列 × 縦 rows 段（4〜16。既定 8）。段の高さ＝窓の高さを段の数で割る。パネルは {x, y, w, h}（列・段の数）
   - パネルの中身は dashboard-panels.js（大きさに合わせて描く）・組む所は dashboard-editor.js（変えるとグリッドの中のパネルがすぐ描き直る）
   - 数はサーバー（POST /api/dashboard/query。1 枚の表は /api/dashboard）。出ているあいだは 1 分ごとに引き直す（サーバーは写しから数え、
     同じ組み・同じ写しなら前の答えを返す）
   - ダッシュボードの置き場は /api/dashboards（共通デフォルト・共通・ID・標準。集計表の組み方と同じ決まり）。組み込みの「標準」は書き換えられず、
     直したら「別名で保存」。最後に開いた物をこの PC で覚える（tpa.dash.v1）
   - 編集: 「編集」で入る。見出しを掴んで動かす・右下の角で大きさ・パネルを選んで 矢印＝動かす／Shift+矢印＝大きさ／Enter＝組む／Delete＝消す（2 回押し）。
     Ctrl+Z＝元に戻す。重なる所には置けない（影が赤になる）
   ========================================================================= */
(() => {
  const { $, esc } = TPA;
  const P = window.DashPanels, E = window.DashEditor;
  const KEY = "tpa.dash.v1";
  const POLL_MS = 60000, RETRY_MS = 4000, COLS = 12, GAP = 10, HISTORY = 30;
  const SCOPE_NAME = { me: "自分", all: "共通", default: "共通デフォルト" };
  const S = {
    list: [], login: "", canEditCommon: false, canEditDefault: false, standardId: null, rowsRange: [4, 16],
    id: null, layout: null, saved: "", edit: false, history: [], sel: "", sources: [],
    answers: new Map(), board: null, at: 0, timer: null, active: false, loading: false, msg: "", confirm: "", pop: null, editing: "",
  };

  /* ---------------- 覚え・置き場 ---------------- */
  const mem = () => TPA.local.get(KEY, {});
  const remember = (patch) => TPA.local.set(KEY, { ...mem(), ...patch });
  const current = () => S.list.find((x) => String(x.id) === String(S.id)) || null;
  const dirty = () => !!S.layout && JSON.stringify(S.layout) !== S.saved;
  const panelOf = (id) => (S.layout ? S.layout.panels.find((x) => x.id === id) : null);
  const qkey = (p) => JSON.stringify([p.visual, p.source, p.equip, p.body, p.filters, p.search, p.period, p.basis]);

  async function loadList() {
    const r = await fetch("/api/dashboards", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "ダッシュボードを読めませんでした");
    Object.assign(S, { list: d.items || [], login: d.login || "", canEditCommon: !!d.canEditCommon, canEditDefault: !!d.canEditDefault,
      standardId: d.standardId, rowsRange: d.rowsRange || [4, 16] });
  }
  async function loadSources() {
    try { const d = await (await fetch("/api/dashboard/sources", { cache: "no-store" })).json(); S.sources = d.items || []; } catch (_) { S.sources = []; }
  }
  /** 開く: 覚えた物 → 標準 → 組み込み */
  function open(id, { keepEdit = false } = {}) {
    const it = S.list.find((x) => String(x.id) === String(id)) || S.list.find((x) => String(x.id) === String(S.standardId)) || S.list[S.list.length - 1];
    if (!it) return;
    S.id = it.id; S.layout = TPA.clone(it.body); S.saved = JSON.stringify(S.layout); S.history = []; S.sel = "";
    if (!keepEdit) S.edit = false;
    remember({ id: it.id });
    paint(); refresh();
  }

  /* ---------------- 数を引く ---------------- */
  async function queryPanel(p) {
    const k = qkey(p), old = S.answers.get(p.id);
    S.answers.set(p.id, { ...(old || {}), key: k, busy: true });
    paintPanel(p.id);
    let a;
    try {
      const r = await fetch("/api/dashboard/query", TPA.json("POST", { panel: p }));
      const d = await r.json().catch(() => ({}));
      a = r.ok ? { key: k, d } : { key: k, err: d.error || `読めませんでした（${r.status}）`, kind: d.kind || "error", d: old && old.key === k ? old.d : null };
    } catch (e) { a = { key: k, err: String(e), kind: "error" }; }
    const now = panelOf(p.id);
    if (!now || qkey(now) !== k) return;                 // 引いている間に組みが変わった（新しい方が引き直す）
    S.answers.set(p.id, a);
    paintPanel(p.id);
    if (a.kind === "copying") setTimeout(() => { const q = panelOf(p.id); if (q && S.active && qkey(q) === k) queryPanel(q); }, RETRY_MS);
  }
  async function loadBoard() {
    try { S.board = await (await fetch("/api/dashboard", { cache: "no-store" })).json(); } catch (e) { S.board = { error: String(e) }; }
    S.layout && S.layout.panels.filter((p) => p.visual === "board").forEach((p) => paintPanel(p.id));
  }
  /** 全部を引き直す（force でなければ、組みが変わったパネルだけ） */
  function refresh(force = true) {
    if (!S.layout) return;
    S.at = Date.now();
    const ps = S.layout.panels;
    if (ps.some((p) => p.visual === "board") && (force || !S.board)) loadBoard();
    ps.filter((p) => p.visual !== "board").forEach((p) => { const a = S.answers.get(p.id); if (force || !a || a.key !== qkey(p)) queryPanel(p); });
    paintBar();
  }

  /* ---------------- 描く ---------------- */
  function paint() {
    const box = $("#dashScreen");
    if (!box) return;
    paintBar();
    const g = $("#dashGrid");
    if (!S.layout) { g.innerHTML = `<p class="db-wait">${esc(S.msg || "読んでいます…")}</p>`; return; }
    box.classList.toggle("is-edit", S.edit);
    g.style.setProperty("--rows", S.layout.rows);
    g.style.gridTemplateRows = `repeat(${S.layout.rows}, minmax(0, 1fr))`;
    const ids = new Set(S.layout.panels.map((p) => p.id));
    [...g.querySelectorAll(".db-p")].forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
    S.layout.panels.forEach((p) => {
      let el = g.querySelector(`.db-p[data-id="${CSS.escape(p.id)}"]`);
      if (!el) {
        el = document.createElement("section");
        el.className = "db-p"; el.dataset.id = p.id;
        el.innerHTML = '<div class="db-ph"></div><div class="db-pb"></div><div class="db-pf" hidden></div><i class="db-rz" data-rz aria-hidden="true"></i>';
        g.append(el);
        if (ro) ro.observe(el);
      }
      place(el, p);
    });
    paintCells();
    S.layout.panels.forEach((p) => paintPanel(p.id));
  }
  function place(el, p) {
    el.style.gridColumn = `${p.x + 1} / span ${p.w}`;
    el.style.gridRow = `${p.y + 1} / span ${p.h}`;
    el.tabIndex = 0;
    el.classList.toggle("is-sel", S.edit && S.sel === p.id);
    el.classList.toggle("is-editing", S.editing === p.id);
  }
  /** 編集のとき: 空いたマスの印（押すと、そこにパネルを足す） */
  function paintCells() {
    const g = $("#dashGrid");
    g.querySelectorAll(".db-cell").forEach((x) => x.remove());
    if (!S.edit) return;
    const used = occupancy();
    for (let y = 0; y < S.layout.rows; y++) for (let x = 0; x < COLS; x++) {
      if (used[y][x]) continue;
      const c = document.createElement("button");
      c.type = "button"; c.className = "db-cell"; c.dataset.cell = `${x},${y}`; c.tabIndex = -1;
      c.style.gridColumn = `${x + 1}`; c.style.gridRow = `${y + 1}`;
      c.setAttribute("aria-label", `空き（${x + 1} 列・${y + 1} 段）にパネルを足す`);
      g.prepend(c);
    }
  }
  function titleOf(p) { return p.title || E.autoTitle(p); }
  function metaOf(p, a) {
    if (p.visual === "board") return "";
    const src = (S.sources.find((x) => x.key === p.source) || {}).name || (a && a.d && a.d.sourceName) || p.source;
    const equip = p.equip ? ((S.sources.find((x) => x.key === "work") || {}).equips || []).find((e) => e.key === p.equip)?.name : "";
    const per = a && a.d ? P.periodText(p, a.d) : "";
    const cond = (p.filters || []).length ? `条件 ${p.filters.length}` : "";
    return [src + (equip ? `・${equip}` : p.source === "work" ? "・全設備" : ""), per, cond].filter(Boolean).join("　");
  }
  const NARROW = 360;      // これより狭いパネルの見出しは、操作を「⋯」1 つに畳む（ボタンが見出しからはみ出さない）
  function headHtml(p, a, width) {
    const meta = metaOf(p, a);
    const warn = a && a.d ? P.notes(a.d).concat(a.err ? [`いまの数は前の物です（${a.err}）`] : []) : [];
    const badge = warn.length ? `<span class="db-warnb" title="${esc(warn.join("\n"))}" aria-label="${esc(warn.join("。"))}">⚠ ${warn.length}</span>` : "";
    const dot = p.visual === "board" ? "" : `<i class="db-dot" style="--c:${P.colorOf(p.source)}" aria-hidden="true"></i>`;
    const tools = S.edit && width < NARROW
      ? `<button type="button" class="db-pbtn db-more" data-db-more aria-haspopup="true" title="このパネルの操作（組む・複製・消す）" aria-label="このパネルの操作">⋯</button>`
      : S.edit
      ? `<button type="button" class="db-pbtn" data-db-edit title="このパネルを組む（Enter）">組む</button><button type="button" class="db-pbtn" data-db-dup title="同じパネルを空いた所に足す">複製</button>`
        + `<button type="button" class="db-pbtn is-danger${S.confirm === "del:" + p.id ? " is-armed" : ""}" data-db-del title="このパネルを消す（Delete。もう一度押すと消えます）">${S.confirm === "del:" + p.id ? "消す？" : "消す"}</button>`
      : p.visual === "board" ? boardConds() : `<button type="button" class="db-pbtn db-quiet" data-db-edit title="このパネルを組み直す（編集に入ります）">組む</button>`;
    return `${dot}<h3 title="${esc(titleOf(p))}">${esc(titleOf(p))}</h3>${meta ? `<small class="db-pm" title="${esc(meta)}">${esc(meta)}</small>` : ""}<span class="db-sp"></span>`
      + badge + (a && a.busy ? '<i class="db-spin" aria-label="読んでいます"></i>' : "") + tools;
  }
  function paintPanel(id) {
    const p = panelOf(id), el = document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(id)}"]`);
    if (!p || !el) return;
    const a = p.visual === "board" ? null : S.answers.get(id);
    el.querySelector(".db-ph").innerHTML = headHtml(p, a, el.clientWidth);
    el.setAttribute("aria-label", titleOf(p));
    const body = el.querySelector(".db-pb"), foot = el.querySelector(".db-pf");
    const size = { w: body.clientWidth, h: body.clientHeight };
    let note = "";
    if (p.visual === "board") note = P.board(body, S.board, size.h);
    else if (!a || (!a.d && !a.err)) body.innerHTML = '<p class="dp-wait">数えています…</p>';
    else if (a.err && !a.d) body.innerHTML = errHtml(a);
    else {
      body.classList.toggle("is-busy", !!a.busy);
      note = P.render(body, p, a.d, size);
    }
    foot.hidden = !note; foot.textContent = note || ""; foot.title = note || "";
    if (note && body.clientHeight < size.h - 2) {          // 下の知らせの分だけ低くなった: もう一度、新しい高さで描く
      if (p.visual === "board") P.board(body, S.board, body.clientHeight);
      else if (a && a.d) P.render(body, p, a.d, { w: body.clientWidth, h: body.clientHeight });
    }
  }
  function errHtml(a) {
    if (a.kind === "copying") return '<p class="dp-wait">共有から写しています。写し終えると出ます…</p>';
    return `<div class="dp-err"><b>数えられませんでした</b><span>${esc(a.err)}</span><button type="button" class="pv-btn" data-db-edit>パネルを組み直す</button></div>`;
  }

  /* ---------------- 道具の行 ---------------- */
  function paintBar() {
    const bar = $("#dashBar"); if (!bar) return;   // 道具の行（.db-tools）
    const it = current(), std = it && String(it.id) === String(S.standardId);
    const t = S.at ? new Date(S.at) : null, when = t ? `${TPA.pad2(t.getHours())}:${TPA.pad2(t.getMinutes())}` : "";
    const pick = `<button type="button" class="db-pick" data-db-pick aria-haspopup="true" aria-expanded="${S.pop === "pick"}" title="ほかのダッシュボードを開く・標準にする・名前を変える・消す">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`
      + `<b>${esc(it ? it.name : "ダッシュボード")}</b>${it ? `<small>${esc(SCOPE_NAME[it.scope] || "")}${it.builtin ? "・組み込み" : ""}</small>` : ""}${std ? '<i class="db-std" title="標準（最初に開く物）">★</i>' : ""}<i aria-hidden="true">▾</i></button>`;
    const msg = `<span class="db-msg" aria-live="polite">${esc(S.msg)}</span>`;
    if (!S.edit) {
      bar.innerHTML = pick + msg + `<span class="db-sp"></span><small class="db-when" title="出ているあいだは 1 分ごとに引き直します">${when ? `${when} の数` : ""}</small>`
        + `<button type="button" class="pv-btn" data-db-refresh title="いま引き直す">↻ 引き直す</button>`
        + `<button type="button" class="btn-primary db-editbtn" data-db-editmode title="パネルを足す・動かす・大きさを変える・組む">編集</button>`;
      return;
    }
    const rows = `<label class="pv-ck" title="グリッドの段の数（多いほど 1 段が低い）">段<select data-db-rows>${Array.from({ length: S.rowsRange[1] - S.rowsRange[0] + 1 }, (_, i) => S.rowsRange[0] + i)
      .map((n) => `<option${n === S.layout.rows ? " selected" : ""}${n < minRows() ? " disabled" : ""}>${n}</option>`).join("")}</select></label>`;
    const canSave = it && !it.builtin && it.canEdit;
    const leave = S.confirm === "leave"
      ? `<span class="db-armed">変えた所を捨てますか</span><button type="button" class="btn-ghost" data-db-stay>戻る</button><button type="button" class="pv-btn is-danger" data-db-discard>捨てる</button>`
      : `<button type="button" class="btn-ghost" data-db-leave>${dirty() ? "やめる" : "編集を終える"}</button>`;
    bar.innerHTML = pick + `<span class="db-editing">編集中</span>`
      + `<button type="button" class="pv-btn" data-db-add title="空いた所にパネルを足して、組む所を開きます">＋ パネル</button>${rows}`
      + `<button type="button" class="pv-btn" data-db-undo${S.history.length ? "" : " disabled"} title="元に戻す（Ctrl+Z）">元に戻す</button>`
      + msg + `<span class="db-sp"></span>${leave}`
      + (canSave ? `<button type="button" class="btn-primary" data-db-save${dirty() ? "" : " disabled"}>保存</button>` : "")
      + `<button type="button" class="${canSave ? "pv-btn" : "btn-primary"}" data-db-saveas aria-haspopup="true" title="${it && it.builtin ? "組み込みの物は書き換えられないので、名前を付けて保存します" : "名前を付けて、別のダッシュボードとして保存します"}">名前を付けて保存…</button>`;
  }
  const say = (t) => { S.msg = t || ""; const m = document.querySelector("#dashBar .db-msg"); if (m) m.textContent = S.msg; clearTimeout(say.t); if (t) say.t = setTimeout(() => { S.msg = ""; const n = document.querySelector("#dashBar .db-msg"); if (n) n.textContent = ""; }, 6000); };

  /* ---------------- 浮かぶ面（ダッシュボードを選ぶ・名前を付けて保存・1 枚の表の条件） ---------------- */
  let popEl = null, popOff = null;
  function closePop() { if (popOff) popOff(); popOff = null; if (popEl) popEl.remove(); popEl = null; S.pop = null; paintBar(); }
  function openPop(kind, anchor, html, cls = "") {
    closePop();
    S.pop = kind;
    popEl = document.createElement("div");
    popEl.className = `db-pop ${cls}`; popEl.setAttribute("role", "dialog");
    popEl.innerHTML = html;
    document.body.append(popEl);
    TPA.placeBelow(popEl, anchor);
    popOff = TPA.dismissable(popEl, closePop, { keep: { contains: (t) => !!(t && t.closest && t.closest(`[data-db-${kind}]`)) } });
    popEl.addEventListener("click", onPopClick);
    paintBar();
    return popEl;
  }
  function pickHtml() {
    const it = current();
    const groups = [["me", "自分（この ID）"], ["all", "共通"], ["default", "共通デフォルト"]];
    const row = (x) => `<button type="button" class="db-li${String(x.id) === String(S.id) ? " on" : ""}" data-db-open="${esc(String(x.id))}">`
      + `<b>${esc(x.name)}</b>${String(x.id) === String(S.standardId) ? '<i class="db-std" title="標準（最初に開く物）">★</i>' : ""}<small>${x.body.panels.length} 枚${x.builtin ? "・組み込み" : ""}</small></button>`;
    const list = groups.map(([k, n]) => { const xs = S.list.filter((x) => x.scope === k); return xs.length ? `<div class="db-lg"><span>${n}</span>${xs.map(row).join("")}</div>` : ""; }).join("");
    const canStd = it && !it.builtin && it.canEdit && String(it.id) !== String(S.standardId);
    const canDel = it && !it.builtin && it.canEdit;
    return `<div class="db-pophead"><b>ダッシュボード</b><small>★＝標準（アプリを開いたときに出す物。自分 → 共通 → 共通デフォルトの順に決まります）</small></div>${list}`
      + `<div class="db-popacts">${canStd ? '<button type="button" class="pv-btn" data-db-std>★ いまの物を標準にする</button>' : ""}`
      + `<button type="button" class="pv-btn" data-db-new title="パネルの無いダッシュボードを、編集で作り始めます">＋ 空から作る</button>`
      + (canDel ? `<button type="button" class="pv-btn is-danger${S.confirm === "remove" ? " is-armed" : ""}" data-db-remove>${S.confirm === "remove" ? "もう一度押すと消えます" : "いまの物を消す"}</button>` : "") + "</div>";
  }
  function saveAsHtml() {
    const it = current();
    const opt = (k, n, ok, why) => `<label class="db-radio${ok ? "" : " is-off"}" title="${esc(ok ? "" : why)}"><input type="radio" name="dbScope" value="${k}"${k === "me" ? " checked" : ""}${ok ? "" : " disabled"}>${n}</label>`;
    return `<div class="db-pophead"><b>名前を付けて保存</b><small>いまのパネルの並び・組みを、新しいダッシュボードとして置きます</small></div>`
      + `<label class="db-field">名前<input id="dbSaveName" maxlength="40" value="${esc(it && !it.builtin ? `${it.name} のコピー` : "わたしのダッシュボード")}"></label>`
      + `<div class="db-field"><span>置き場</span>${opt("me", "自分（この ID だけ）", !!S.login, "ログイン ID が分かりません")}${opt("all", "共通（全員）", S.canEditCommon, "共通に置けるのは、マスタを書ける権限の人だけです")}`
      + `${S.canEditDefault ? opt("default", "共通デフォルト（開発者）", true, "") : ""}</div>`
      + `<label class="pv-ck"><input type="checkbox" id="dbSaveStd" checked>標準にする（アプリを開いたときに、これを出す）</label>`
      + `<div class="db-popacts"><span class="db-sp"></span><button type="button" class="btn-primary" data-db-dosave>保存</button></div><p class="db-poperr" aria-live="polite"></p>`;
  }
  /* 1 枚の表の集計対象（全員で 1 つ。版 3.36.0 の条件。マスタ dashboard_settings） */
  const condText = (c) => (c && c.filters && c.filters.length ? c.filters.map((f) => TPA.condLabel(f)).join("・") : "すべて");
  function boardConds() {
    const w = (S.board || {}).wip || {}, k = (S.board || {}).work || {};
    const b = (panel, c) => `<button type="button" class="db-cond${c && c.filters && c.filters.length ? " is-on" : ""}" data-db-cond="${panel}" aria-haspopup="true" title="${esc(condText(c))}">${panel === "wip" ? "仕掛" : "実績"}の対象: ${esc(condText(c))}</button>`;
    return b("wip", w.condition) + b("work", k.condition)
      + (w.source && w.source.screen ? `<button type="button" class="db-pbtn db-quiet" data-db-goto="${esc(w.source.screen)}">${esc(w.source.name)}を開く ›</button>` : "");
  }
  function condHtml(panel) {
    const p = (S.board || {})[panel] || {}, c = p.condition || { filters: [] }, cols = p.columns || [];
    const colOpts = (cur) => [`<option value="">列を選ぶ</option>`, ...cols.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`)].join("");
    const opOpts = (cur) => TPA.FILTER_OPS.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    const row = (f) => `<div class="db-crow"><select data-f="column">${colOpts(f.column)}</select><select data-f="op">${opOpts(f.op || "eq")}</select>
      <input data-f="value" value="${esc(f.value || "")}" placeholder="値"><button type="button" class="icon-btn" data-db-crowdel aria-label="この条件を外す">×</button></div>`;
    return `<div class="db-pophead"><b>${panel === "wip" ? "仕掛" : "前日の実績"}を数えるロットの条件</b><small>全員で 1 つ（この表だけに効きます）</small></div>`
      + `<div class="db-crows" data-panel="${panel}">${(c.filters.length ? c.filters : [{}]).map(row).join("")}</div>`
      + `<div class="db-popacts"><button type="button" class="pv-btn" data-db-crowadd>＋ 条件を足す</button><span class="db-sp"></span><button type="button" class="btn-primary" data-db-condsave="${panel}">保存して数え直す</button></div>`
      + `<p class="db-poperr" aria-live="polite"></p><template>${row({})}</template>`;
  }
  async function saveCond(panel) {
    const filters = [...popEl.querySelectorAll(".db-crow")].map((r) => ({ column: r.querySelector('[data-f="column"]').value, op: r.querySelector('[data-f="op"]').value,
      value: r.querySelector('[data-f="value"]').value })).filter((f) => f.column);
    const err = popEl.querySelector(".db-poperr");
    err.textContent = "保存しています…";
    const r = await fetch(`/api/dashboard/${panel}`, TPA.json("PUT", { filters, base_rev: (((S.board || {})[panel] || {}).condition || {}).rev || 0 }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = "✕ " + (d.error || (r.status === 409 ? "ほかの PC が先に条件を変えました。開き直してください。" : "保存できませんでした")); return; }
    closePop(); S.board = null; loadBoard();
  }
  async function onPopClick(e) {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.dbOpen) { if (S.edit && dirty()) { say("編集中の変えた所を保存するか、やめてから開いてください"); return; } closePop(); open(t.dataset.dbOpen); return; }
    if (t.hasAttribute("data-db-std")) { await writeLayout("PUT", current().id, { standard: true }, "標準にしました"); closePop(); return; }
    if (t.hasAttribute("data-db-new")) { closePop(); startBlank(); return; }
    if (t.hasAttribute("data-db-remove")) {
      if (S.confirm !== "remove") { S.confirm = "remove"; popEl.innerHTML = pickHtml(); return; }
      S.confirm = ""; const it = current(); closePop();
      const r = await fetch(`/api/dashboards/${it.id}?rev=${it.rev}`, { method: "DELETE" });
      if (!r.ok) { say("消せませんでした: " + ((await r.json().catch(() => ({}))).error || r.status)); return; }
      await loadList(); open(S.standardId); say(`「${it.name}」を消しました`); return;
    }
    if (t.hasAttribute("data-db-dosave")) { saveAs(); return; }
    if (t.hasAttribute("data-db-crowadd")) { popEl.querySelector(".db-crows").insertAdjacentHTML("beforeend", popEl.querySelector("template").innerHTML); return; }
    if (t.hasAttribute("data-db-crowdel")) { t.closest(".db-crow").remove(); return; }
    if (t.dataset.dbCondsave) { saveCond(t.dataset.dbCondsave); return; }
    const mid = popEl && popEl.dataset.panel;
    if (mid && t.hasAttribute("data-db-edit")) { closePop(); openEditor(mid); return; }
    if (mid && t.hasAttribute("data-db-dup")) { closePop(); duplicate(mid); return; }
    if (mid && t.hasAttribute("data-db-del")) { if (S.confirm === "del:" + mid) { closePop(); remove(mid); } else { S.confirm = "del:" + mid; popEl.innerHTML = moreHtml(mid); } }
  }
  const moreHtml = (id) => `<button type="button" class="db-li" data-db-edit><b>組む</b><small>Enter</small></button><button type="button" class="db-li" data-db-dup><b>複製</b></button>`
    + `<button type="button" class="db-li is-danger${S.confirm === "del:" + id ? " is-armed" : ""}" data-db-del><b>${S.confirm === "del:" + id ? "もう一度押すと消えます" : "消す"}</b><small>Delete</small></button>`;

  /* ---------------- 保存 ---------------- */
  async function writeLayout(method, id, body, done) {
    const r = await fetch(id ? `/api/dashboards/${id}` : "/api/dashboards", TPA.json(method, body));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = d.error || (r.status === 409 ? "ほかの PC が先に直しました。開き直してから直してください。" : `保存できませんでした（${r.status}）`);
      return { error: why };
    }
    await loadList();
    S.id = d.id; remember({ id: d.id });
    S.layout = TPA.clone(d.body); S.saved = JSON.stringify(S.layout);
    paint(); say(done);
    return { ok: d };
  }
  async function save() {
    const it = current(); if (!it || it.builtin) return;
    const r = await writeLayout("PUT", it.id, { body: S.layout, base_rev: it.rev }, "保存しました");
    if (r.error) say("✕ " + r.error);
  }
  async function saveAs() {
    const name = (popEl.querySelector("#dbSaveName").value || "").trim(), scope = (popEl.querySelector('input[name="dbScope"]:checked') || {}).value || "me";
    const err = popEl.querySelector(".db-poperr");
    if (!name) { err.textContent = "名前を入れてください"; return; }
    err.textContent = "保存しています…";
    const r = await writeLayout("POST", null, { name, scope, standard: popEl.querySelector("#dbSaveStd").checked, body: S.layout }, `「${name}」を保存しました`);
    if (r.error) { err.textContent = "✕ " + r.error; return; }
    closePop();
  }

  /* ---------------- 編集: 置き場の計算 ---------------- */
  function occupancy(skip = "") {
    const g = Array.from({ length: S.layout.rows }, () => new Array(COLS).fill(""));
    S.layout.panels.forEach((p) => { if (p.id === skip) return; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (g[y]) g[y][x] = p.id; });
    return g;
  }
  const fits = (r, skip) => {
    if (r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > COLS || r.y + r.h > S.layout.rows) return false;
    const g = occupancy(skip);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g[y][x]) return false;
    return true;
  };
  /** 空いた所（大きい方から: w×h → 小さくしていく）。無ければ null */
  function freeSpot(w = 4, h = 2) {
    for (const [ww, hh] of [[w, h], [3, 2], [2, 2], [3, 1], [2, 1], [1, 1]]) {
      for (let y = 0; y + hh <= S.layout.rows; y++) for (let x = 0; x + ww <= COLS; x++) if (fits({ x, y, w: ww, h: hh })) return { x, y, w: ww, h: hh };
    }
    return null;
  }
  const minRows = () => Math.max(S.rowsRange[0], ...(S.layout ? S.layout.panels.map((p) => p.y + p.h) : [0]));
  function commit(mut, why = "") {
    S.history.push(JSON.stringify(S.layout));
    if (S.history.length > HISTORY) S.history.shift();
    mut(S.layout);
    S.confirm = "";
    paint();
    refresh(false);
    if (why) say(why);
  }
  function undo() {
    if (!S.history.length) return;
    S.layout = JSON.parse(S.history.pop());
    if (S.editing && !panelOf(S.editing)) closeEditor();
    paint(); refresh(false); say("元に戻しました");
  }
  const newId = () => { let i = S.layout.panels.length + 1; while (panelOf(`p${i}`)) i++; return `p${i}`; };
  function addPanel(at) {
    const spot = at ? { ...at, w: 1, h: 1 } : freeSpot();
    if (!spot) { say("空きがありません。パネルを小さくするか、段を増やしてください"); return; }
    // 押したマスなら、そこから右下へ空いている分だけ広げる（4×2 まで）
    if (at) { for (const [w, h] of [[4, 2], [3, 2], [2, 2], [4, 1], [3, 1], [2, 1]]) if (fits({ x: at.x, y: at.y, w, h })) { spot.w = w; spot.h = h; break; } }
    const src = (S.sources.find((x) => x.place) || {}).key || "work";
    const p = { id: newId(), ...spot, title: "", visual: "kpi", source: src, equip: "", body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true, labels: true }, filters: [], search: "", period: null, sort: "", top: 0, basis: "work" };
    commit((L) => L.panels.push(p));
    S.sel = p.id; openEditor(p.id);
  }
  function duplicate(id) {
    const p = panelOf(id); if (!p) return;
    const spot = freeSpot(p.w, p.h);
    if (!spot) { say("空きがありません。パネルを小さくするか、段を増やしてください"); return; }
    commit((L) => L.panels.push({ ...TPA.clone(p), id: newId(), ...spot }), "複製しました");
  }
  function remove(id) {
    if (S.confirm !== "del:" + id) { S.confirm = "del:" + id; paintPanel(id); return; }
    if (S.editing === id) closeEditor();
    commit((L) => { L.panels = L.panels.filter((x) => x.id !== id); }, "消しました（元に戻す で戻せます）");
    S.answers.delete(id);
  }
  function startBlank() {
    S.id = null; S.layout = { rows: 8, panels: [] }; S.saved = ""; S.history = []; S.edit = true; S.sel = "";
    paint(); say("「＋ パネル」か、空いたマスを押してパネルを足します");
  }

  /* ---------------- 編集: 掴んで動かす・大きさを変える ---------------- */
  let drag = null;
  function cellSize() {
    const g = $("#dashGrid").getBoundingClientRect();
    return { g, cw: (g.width - GAP * (COLS - 1)) / COLS, ch: (g.height - GAP * (S.layout.rows - 1)) / S.layout.rows };
  }
  function ghost(r, ok) {
    let el = $("#dbGhost");
    if (!el) { el = document.createElement("div"); el.id = "dbGhost"; el.className = "db-ghost"; $("#dashGrid").append(el); }
    el.style.gridColumn = `${r.x + 1} / span ${r.w}`; el.style.gridRow = `${r.y + 1} / span ${r.h}`;
    el.classList.toggle("is-bad", !ok);
    el.textContent = `${r.w} × ${r.h}${ok ? "" : "（重なるので置けません）"}`;
  }
  function onDown(e) {
    if (!S.edit || e.button !== 0) return;
    const el = e.target.closest(".db-p"); if (!el) return;
    const rz = e.target.closest("[data-rz]"), head = e.target.closest(".db-ph");
    if (!rz && (!head || e.target.closest("button,select,input"))) return;
    const p = panelOf(el.dataset.id); if (!p) return;
    e.preventDefault();
    S.sel = p.id;
    const { cw, ch } = cellSize();
    drag = { id: p.id, mode: rz ? "size" : "move", x0: e.clientX, y0: e.clientY, r0: { x: p.x, y: p.y, w: p.w, h: p.h }, cw: cw + GAP, ch: ch + GAP, r: null };
    el.classList.add("is-drag");
    document.body.classList.add("db-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }
  function onMove(e) {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.x0) / drag.cw), dy = Math.round((e.clientY - drag.y0) / drag.ch), r0 = drag.r0;
    const r = drag.mode === "move"
      ? { ...r0, x: Math.max(0, Math.min(COLS - r0.w, r0.x + dx)), y: Math.max(0, Math.min(S.layout.rows - r0.h, r0.y + dy)) }
      : { ...r0, w: Math.max(1, Math.min(COLS - r0.x, r0.w + dx)), h: Math.max(1, Math.min(S.layout.rows - r0.y, r0.h + dy)) };
    drag.r = r; drag.ok = fits(r, drag.id);
    ghost(r, drag.ok);
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    document.body.classList.remove("db-dragging");
    const d = drag; drag = null;
    $("#dbGhost")?.remove();
    document.querySelectorAll(".db-p.is-drag").forEach((x) => x.classList.remove("is-drag"));
    if (!d) return;
    if (d.r && d.ok && JSON.stringify(d.r) !== JSON.stringify(d.r0)) commit((L) => Object.assign(L.panels.find((x) => x.id === d.id), d.r));
    else { if (d.r && !d.ok) say("ほかのパネルと重なるので置けません"); paint(); }
  }
  function onKey(e) {
    if (!S.active) return;
    if (S.edit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest("input,select,textarea")) { e.preventDefault(); undo(); return; }
    const el = e.target.closest && e.target.closest(".db-p");
    if (!S.edit || !el || e.target !== el) return;
    const p = panelOf(el.dataset.id); if (!p) return;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir) {
      e.preventDefault();
      const r = e.shiftKey ? { ...p, w: p.w + dir[0], h: p.h + dir[1] } : { ...p, x: p.x + dir[0], y: p.y + dir[1] };
      if (fits(r, p.id)) { commit((L) => Object.assign(L.panels.find((x) => x.id === p.id), { x: r.x, y: r.y, w: r.w, h: r.h })); focusPanel(p.id); }
      else say(e.shiftKey ? "それ以上は大きくできません（ほかのパネルか、グリッドの端）" : "そこへは動かせません（ほかのパネルか、グリッドの端）");
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); openEditor(p.id); return; }
    if (e.key === "Delete") { e.preventDefault(); remove(p.id); }
  }
  const focusPanel = (id) => requestAnimationFrame(() => document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(id)}"]`)?.focus());

  /* ---------------- 組む所（dashboard-editor.js） ---------------- */
  let editBase = null;      // 組む前のパネル（やめたら戻す）
  function openEditor(id) {
    const p = panelOf(id); if (!p) return;
    if (p.visual === "board") { say("この表は組み替えられません。条件は表の上の「対象」で変えます"); return; }
    if (!S.edit) { S.edit = true; }
    S.editing = id; S.sel = id; editBase = TPA.clone(p);
    $("#dashScreen").classList.add("has-editor");
    focusFrame(id);
    paint();
    E.open({ panel: p, sources: S.sources, toast: say,
      onChange: (np) => { Object.assign(panelOf(id), np, { x: panelOf(id).x, y: panelOf(id).y, w: panelOf(id).w, h: panelOf(id).h }); paintPanel(id); clearTimeout(openEditor.t); openEditor.t = setTimeout(() => { const q = panelOf(id); if (q) queryPanel(q); }, 250); },
      onApply: (np) => {
        const cur = panelOf(id), base = editBase; closeEditor();
        if (!cur) return;
        Object.assign(cur, base);           // 元に戻す の履歴に「組む前」を残してから当てる
        commit((L) => Object.assign(L.panels.find((x) => x.id === id), np, { x: cur.x, y: cur.y, w: cur.w, h: cur.h }), "当てました（保存するまでは、この PC の画面だけです）");
      },
      onCancel: () => { const cur = panelOf(id); if (cur && editBase) Object.assign(cur, editBase); closeEditor(); paint(); refresh(false); },
    });
  }
  /** 焦点（2026-10-grid の 1 回目で 1 位の D）: 組む間、組むパネルをグリッドの左の空きに大きく出し（グリッドの大きさの 1.5 倍まで・
      窓に収まる大きさ）、ほかのパネルは淡い幕で覆う。組む所は右に重ねる（グリッドは縮めない＝ほかのパネルの字が切れない） */
  function focusFrame(id) {
    const el = document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(id)}"]`), g = $("#dashGrid");
    if (!el || !g) return;
    const r = el.getBoundingClientRect(), gr = g.getBoundingClientRect(), ed = 720 + 24;
    const aw = Math.max(320, innerWidth - ed - gr.left - 16), ah = gr.height;
    const w = Math.min(aw, Math.max(520, r.width * 1.5)), h = Math.min(ah, Math.max(340, r.height * 1.5));
    Object.assign(el.style, { position: "fixed", left: `${Math.round(gr.left + (aw - w) / 2)}px`, top: `${Math.round(gr.top + (ah - h) / 2)}px`, width: `${Math.round(w)}px`, height: `${Math.round(h)}px` });
    el.classList.add("is-focus");
    if (!$("#dbScrim")) $("#dashScreen").insertAdjacentHTML("beforeend", '<div id="dbScrim" class="db-scrim" aria-hidden="true"></div>');
  }
  function unfocus() {
    document.querySelectorAll("#dashGrid .db-p.is-focus").forEach((el) => { el.classList.remove("is-focus"); ["position", "left", "top", "width", "height"].forEach((k) => { el.style[k] = ""; }); });
    $("#dbScrim")?.remove();
  }
  function closeEditor() {
    S.editing = ""; editBase = null; E.close(); unfocus();
    $("#dashScreen")?.classList.remove("has-editor");
    requestAnimationFrame(() => paint());
  }

  /* ---------------- 押す ---------------- */
  function onClick(e) {
    const t = e.target; if (!t.closest) return;
    const b = t.closest("button"); const pEl = t.closest(".db-p");
    if (S.edit && pEl && !b && !S.editing) { S.sel = pEl.dataset.id; document.querySelectorAll("#dashGrid .db-p").forEach((x) => x.classList.toggle("is-sel", x === pEl)); }
    if (!b) return;
    if (b.hasAttribute("data-db-pick")) { if (S.pop === "pick") closePop(); else { S.confirm = ""; openPop("pick", b, pickHtml(), "db-pickpop"); } return; }
    if (b.hasAttribute("data-db-refresh")) { refresh(true); return; }
    if (b.hasAttribute("data-db-editmode")) { S.edit = true; S.confirm = ""; paint(); say("見出しを掴んで動かし、右下の角で大きさを変えます。空いたマスを押すとパネルを足せます"); return; }
    if (b.hasAttribute("data-db-leave")) { if (dirty()) { S.confirm = "leave"; paintBar(); } else { S.edit = false; closeEditor(); paint(); } return; }
    if (b.hasAttribute("data-db-stay")) { S.confirm = ""; paintBar(); return; }
    if (b.hasAttribute("data-db-discard")) { S.confirm = ""; closeEditor(); const id = S.id; S.edit = false; if (id != null) open(id); else open(S.standardId); return; }
    if (b.hasAttribute("data-db-save")) { save(); return; }
    if (b.hasAttribute("data-db-saveas")) { if (S.pop === "saveas") closePop(); else { openPop("saveas", b, saveAsHtml(), "db-savepop"); popEl.querySelector("#dbSaveName").select(); } return; }
    if (b.hasAttribute("data-db-add")) { addPanel(); return; }
    if (b.hasAttribute("data-db-undo")) { undo(); return; }
    if (b.dataset.cell) { const [x, y] = b.dataset.cell.split(",").map(Number); addPanel({ x, y }); return; }
    if (b.dataset.dbGoto) { document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: b.dataset.dbGoto })); return; }
    if (b.dataset.dbCond) { if (S.pop === "cond") closePop(); else openPop("cond", b, condHtml(b.dataset.dbCond), "db-condpop"); return; }
    const id = pEl && pEl.dataset.id;
    if (!id) return;
    if (b.hasAttribute("data-db-more")) { if (S.pop === "more") closePop(); else { const el = openPop("more", b, moreHtml(id), "db-morepop"); el.dataset.panel = id; } return; }
    if (b.hasAttribute("data-db-edit")) { openEditor(id); return; }
    if (b.hasAttribute("data-db-dup")) { duplicate(id); return; }
    if (b.hasAttribute("data-db-del")) remove(id);
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches && t.matches("[data-db-rows]")) { const n = +t.value; if (n >= minRows()) commit((L) => { L.rows = n; }); }
  }

  /* ---------------- 大きさが変わったら描き直す（窓・グリッドの段・パネルそのもの〈焦点など〉） ---------------- */
  let ro = null, roT = 0;
  const sizes = new Map();
  function watchSize() {
    if (ro || typeof ResizeObserver === "undefined") return;
    ro = new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(() => {
      if (!S.active || !S.layout || drag) return;
      S.layout.panels.forEach((p) => {      // 大きさが変わったパネルだけ描き直す
        const el = document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(p.id)}"]`); if (!el) return;
        const k = `${el.clientWidth}x${el.clientHeight}`;
        if (sizes.get(p.id) !== k) { sizes.set(p.id, k); paintPanel(p.id); }
      });
    }, 120); });
    ro.observe($("#dashGrid"));
    document.querySelectorAll("#dashGrid .db-p").forEach((el) => ro.observe(el));
  }

  let bound = false;
  function bind() {
    if (bound) return; bound = true;
    const box = $("#dashScreen");
    box.addEventListener("click", onClick);
    box.addEventListener("change", onChange);
    $("#dashGrid").addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    watchSize();
  }

  async function start() {
    bind();
    if (S.loading) return;
    S.loading = true;
    try {
      await Promise.all([loadList(), loadSources()]);
      if (!S.layout) open(mem().id);
      else { paint(); refresh(false); }
    } catch (e) { S.msg = String(e.message || e); paint(); }
    S.loading = false;
  }

  window.Dashboard = {
    activate() {
      S.active = true;
      start();
      if (S.layout) refresh(Date.now() - S.at > POLL_MS / 2);
      clearInterval(S.timer);
      S.timer = setInterval(() => { if (!S.editing && !drag) refresh(true); }, POLL_MS);
    },
    deactivate() { S.active = false; clearInterval(S.timer); S.timer = null; closePop(); },
    /** 評価関数・試験から: いまの組みと答え */
    /** 案を撮る道具（ui-variants.mjs）から: 組みを置き換えて描く（保存はしない） */
    _setLayout(l) { S.layout = TPA.clone(l); S.saved = JSON.stringify(S.layout); S.answers.clear(); paint(); refresh(true); },
    _state: () => ({ id: S.id, edit: S.edit, layout: TPA.clone(S.layout), answers: Object.fromEntries([...S.answers].map(([k, v]) => [k, v.d || { error: v.err }])) }),
  };
})();
