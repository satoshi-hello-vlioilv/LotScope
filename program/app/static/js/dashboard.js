/* =========================================================================
   ダッシュボード（版 3.37.0。最初の画面。版 3.36.0 の 1 枚の表を、グリッドのパネルの 1 つにした）
   - 利用者の要望（2026-10）: グリッドにパネルを置き、大きさを変え、パネルごとにいろいろなデータから条件を組んでグラフや表を作る
     （各一覧の集計表・グラフを組むのと同じ感じで。Power BI のように）。スクロールしない（どの大きさの窓でも全部が見える）
   - グリッド: 横 12 列 × 縦 rows 段（4〜16。既定 8）。段の高さ＝窓の高さを段の数で割る。パネルは {x, y, w, h}（列・段の数）
   - パネルの中身は dashboard-panels.js（大きさに合わせて描く）・組む所は dashboard-editor.js（変えるとグリッドの中のパネルがすぐ描き直る）
   - 数はサーバー（POST /api/dashboard/query。合わせた表〈版 3.38.0〉も同じ道）。出ているあいだは 1 分ごとに引き直す（サーバーは写しから数え、
     同じ組み・同じ写しなら前の答えを返す）
   - ダッシュボードの置き場は /api/dashboards（共通デフォルト・共通・ID・標準。集計表の組み方と同じ決まり）。組み込みの「標準」は書き換えられず、
     直したら「別名で保存」。最後に開いた物をこの PC で覚える（tpa.dash.v1）
   - 編集: 「編集」で入る。見出しを掴んで動かす・四隅の角で大きさ（版 3.41.0。前は右下だけ）・パネルを選んで 矢印＝動かす／Shift+矢印＝大きさ（右下の角）／Alt+Shift+矢印＝大きさ（左上の角）／Enter＝組む／Delete＝消す（2 回押し）。
     Ctrl+Z＝元に戻す。重なる所には置けない（影が赤になる）
   ========================================================================= */
(() => {
  const { $, esc } = TPA;
  const P = window.DashPanels, E = window.DashEditor, Q = window.DashFilter, D = window.DashSlicer;
  const KEY = "tpa.dash.v1";
  const POLL_MS = 60000, RETRY_MS = 4000, COLS = 12, GAP = 10, HISTORY = 30;
  const SCOPE_NAME = { me: "自分", all: "共通", default: "共通デフォルト" };
  const S = {
    list: [], login: "", canEditCommon: false, canEditDefault: false, standardId: null, rowsRange: [4, 16],
    id: null, layout: null, saved: "", edit: false, history: [], sel: "", sources: [],
    tree: null, answers: new Map(), at: 0, timer: null, active: false, loading: false, msg: "", confirm: "", pop: null, editing: "",
  };

  /* ---------------- 覚え・置き場 ---------------- */
  const mem = () => TPA.local.get(KEY, {});
  const remember = (patch) => TPA.local.set(KEY, { ...mem(), ...patch });
  const current = () => S.list.find((x) => String(x.id) === String(S.id)) || null;
  const dirty = () => !!S.layout && JSON.stringify(S.layout) !== S.saved;
  const panelOf = (id) => (S.layout ? S.layout.panels.find((x) => x.id === id) : null);
  /* この PC の絞り込み（版 3.39.0。パネルを絞る: dashboard-filter.js）。ダッシュボードごと・パネルごとに覚える（tpa.dash.v1 の quick） */
  const quickOf = (id) => ((mem().quick || {})[String(S.id)] || {})[id] || null;
  function setQuick(id, q) {
    const all = { ...(mem().quick || {}) }, mine = { ...(all[String(S.id)] || {}) };
    if (Q.isEmpty(q)) delete mine[id]; else mine[id] = q;
    all[String(S.id)] = mine;
    remember({ quick: all });
  }
  /* スライサー（版 3.41.0。利用者の要望 6）: ダッシュボード全体の期間・設備。この PC の見え方として、ダッシュボードごとに覚える（tpa.dash.v1 の slice） */
  const sliceState = () => ((mem().slice || {})[String(S.id)]) || null;
  function setSlice(v) {
    const all = { ...(mem().slice || {}) }, x = { ...(v || {}) };
    if (!x.period || !x.period.kind) delete x.period;
    if (!(x.equips || []).length) delete x.equips;
    if (x.period || x.equips || x.set) all[String(S.id)] = x; else delete all[String(S.id)];
    remember({ slice: all });
    refresh(false); paintBar();
    if (popEl && S.pop === "slice") { popEl.innerHTML = D.pickHtml(sliceState(), sliceInfo()); D.mixed(popEl); }
  }
  const canEquip = (src) => !!(S.sources.find((x) => x.key === src) || {}).equip;
  const sliceOf = (p) => (p.noslice ? null : sliceState());
  /** 答えの「いま」（月の名前を、サーバーのいまで決める） */
  const today = () => { for (const a of S.answers.values()) { const n = a && a.d && (a.d.now || ((a.d.groups || [])[0] || {}).now); if (n) return n.slice(0, 10); } return ""; };
  function sliceInfo() {
    const sl = sliceState(), ps = S.layout ? S.layout.panels : [];
    const hits = ps.filter((p) => { const h = Q.sliceHits(p, sl, canEquip); return h.period || h.equip; }).length;
    return { tree: S.tree || {}, today: today(), hits, total: ps.length, open: S.pop === "slice" };
  }
  async function loadTree() {
    try { const r = await fetch("/api/dashboard/equip-tree", { cache: "no-store" }); if (r.ok) S.tree = await r.json(); } catch (_) { /* 設備の札が出ないだけ */ }
    paintBar();
    if (S.layout) S.layout.panels.forEach((p) => paintPanel(p.id, true));     // 添え書きの設備をグループの名前で（設備グループが分かってから）
    if (popEl && S.pop === "slice") { popEl.innerHTML = D.pickHtml(sliceState(), sliceInfo()); D.mixed(popEl); }
  }
  /** 数えるときのパネル（組んだパネル＋スライサー＋この PC のパネルの絞り込み） */
  const asked = (p) => Q.merge(Q.slice(p, sliceOf(p), canEquip), quickOf(p.id));
  const qkey = (p0) => { const p = asked(p0); return JSON.stringify(p.visual === "board" ? [p.visual, p.rows, p.groups, p.equips, p.egroup, p.filters] : [p.visual, p.source, p.equip, p.equips, p.egroup, p.esplit, p.link, p.body, p.filters, p.search, p.period, p.basis, p.calc]); };   // 数を引き直す組み（題・見せ方・書式・置き場は入れない）

  async function loadList() {
    const r = await fetch("/api/dashboards", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "ダッシュボードを読めませんでした");
    Object.assign(S, { list: d.items || [], login: d.login || "", canEditCommon: !!d.canEditCommon, canEditDefault: !!d.canEditDefault,
      standardId: d.standardId, rowsRange: d.rowsRange || [4, 16] });
  }
  async function loadSources() {
    try { const d = await (await fetch("/api/dashboard/sources", { cache: "no-store" })).json(); S.sources = d.items || []; S.egroupSets = d.egroupSets || []; } catch (_) { S.sources = []; S.egroupSets = []; }
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
  // 答えに通し番号を付ける（描き直すかの決め手。版 3.41.0: 組み替え・保存のたびに全部のパネルを描き直していた）
  let ansSeq = 0;
  const setAnswer = (id, a) => { a.n = ++ansSeq; S.answers.set(id, a); };
  async function queryPanel(p) {
    const k = qkey(p), old = S.answers.get(p.id);
    setAnswer(p.id, { ...(old || {}), key: k, busy: true });
    paintPanel(p.id);
    let a;
    try {
      const r = await fetch("/api/dashboard/query", TPA.json("POST", { panel: asked(p) }));
      const d = await r.json().catch(() => ({}));
      a = r.ok ? { key: k, d } : { key: k, err: d.error || `読めませんでした（${r.status}）`, kind: d.kind || "error", d: old && old.key === k ? old.d : null };
    } catch (e) { a = { key: k, err: String(e), kind: "error" }; }
    const now = panelOf(p.id);
    if (!now || qkey(now) !== k) return;                 // 引いている間に組みが変わった（新しい方が引き直す）
    setAnswer(p.id, a);
    paintPanel(p.id);
    if (S.editing === p.id && E.isOpen()) E.answered();
    const copying = a.kind === "copying" || (a.d && (a.d.groups || []).some((g) => g.kind === "copying"));   // 合わせた表はまとまりごと
    if (copying) setTimeout(() => { const q = panelOf(p.id); if (q && S.active && qkey(q) === k) queryPanel(q); }, RETRY_MS);
  }
  /** 全部を引き直す（force でなければ、組みが変わったパネルだけ） */
  function refresh(force = true) {
    if (!S.layout) return;
    S.at = Date.now();
    const ps = S.layout.panels;
    ps.forEach((p) => { const a = S.answers.get(p.id); if (force || !a || a.key !== qkey(p)) queryPanel(p); });
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
        el.innerHTML = '<div class="db-ph"></div><div class="db-psub"></div><div class="db-pq" hidden></div><div class="db-pb"></div><div class="db-pf" hidden></div>' + ["nw", "ne", "sw", "se"].map((d) => `<i class="db-rz" data-rz="${d}" aria-hidden="true"></i>`).join("");
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
    const frame = p.frame || (p.emph ? "emph" : "card");
    el.classList.toggle("is-emph", frame === "emph");
    ["accent", "plain", "tint"].forEach((f) => el.classList.toggle(`is-frame-${f}`, frame === f));
    el.style.setProperty("--pc", P.seriesColors(p.visual === "board" ? { ...p, source: ((p.groups || [])[0] || {}).source } : p)[0]);
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
  /* スライサーで期間を替えたパネルは、題の期間の言葉（前日・今月など）をスライサーの期間に置き換えて見せる（版 3.41.0。2026-10-dashslice の 1 回目の採点:
     先月を選ぶと「前日の実績本数」に先月の数が出て、言葉と数が食い違った）。置き換えた所は印を付け、元の題は札の説明に残す */
  /** パネルが組んだ期間の短い言葉（前日・今月・直近 14 日。合わせた表は期間を組んだ最初のまとまり） */
  const ownPeriod = (p) => { const o = (p.visual === "board" ? p.groups || [] : p.link ? p.link.sides || [] : [p]).find((x) => x.period && x.period.kind); return o ? sliceWord(o.period) : ""; };
  const PERIOD_WORD = /前日|昨日|今日|本日|今月|先月|直近\s*\d+\s*日/;
  function titleHtml(p) {
    const t = titleOf(p), hit = Q.sliceHits(p, sliceOf(p), canEquip);
    if (!hit.period || !PERIOD_WORD.test(t)) return esc(t);
    const m = PERIOD_WORD.exec(t);
    return `${esc(t.slice(0, m.index))}<mark class="db-tsw" title="スライサーで「${esc(m[0])}」から替えています">${esc(sliceWord(sliceState().period))}</mark>${esc(t.slice(m.index + m[0].length))}`;
  }
  const SPLIT_NAME = { series: "設備ごとの系列", facet: "設備ごとに並べる", sum: "合算" };
  function metaOf(p, a) {
    if (p.visual === "board") return "";
    const name = (k) => (S.sources.find((x) => x.key === k) || {}).name || k;
    if (p.link && (p.link.sides || []).length) {     // 別のデータを合わせたパネル（版 3.40.0）: データごとの役割・元・作り方
      const role = { target: "目標", actual: "実績" };
      return p.link.sides.map((x) => `${role[x.role] ? role[x.role] + " " : ""}${x.title || name(x.source)}${x.build === "cum" ? "（積み上げ）" : ""}`).join(" ／ ");
    }
    const src = name(p.source) || (a && a.d && a.d.sourceName);
    const equip = p.equip ? ((S.sources.find((x) => x.key === "work") || {}).equips || []).find((e) => e.key === p.equip)?.name
      : (p.equips || []).length ? eqWord(p.equips) : "";
    const split = a && a.d && a.d.esplit && (p.equips || []).length !== 1 ? `（${SPLIT_NAME[a.d.esplit] || ""}）` : "";
    const per = a && a.d ? P.periodText(p, a.d) : "";
    const cond = (p.filters || []).length ? `条件 ${p.filters.length}` : "";
    return [src + (equip ? `・${equip}` : p.source === "work" ? "・全設備" : "") + split, per, cond].filter(Boolean).join("　");
  }
  const NARROW = 360;      // これより狭いパネルの見出しは、操作を「⋯」1 つに畳む（ボタンが見出しからはみ出さない）
  function headHtml(p, a, width, fold = false) {
    const warn = a && a.d ? P.notes(a.d).concat(a.err ? [`いまの数は前の物です（${a.err}）`] : []) : [];
    const badge = warn.length ? `<span class="db-warnb" title="${esc(warn.join("\n"))}" aria-label="${esc(warn.join("。"))}">⚠ ${warn.length}</span>` : "";
    const dot = p.visual === "board" ? "" : `<i class="db-dot" style="--c:${P.colorOf(p.source)}" aria-hidden="true"></i>`;
    const tools = S.edit && (width < NARROW || fold)
      ? `<button type="button" class="db-pbtn db-more" data-db-more aria-haspopup="true" title="このパネルの操作（組む・複製・消す）" aria-label="このパネルの操作">⋯</button>`
      : S.edit
      ? `<button type="button" class="db-pbtn" data-db-edit title="このパネルを組む（Enter）">組む</button><button type="button" class="db-pbtn" data-db-dup title="同じパネルを空いた所に足す">複製</button>`
        + `<button type="button" class="db-pbtn is-danger${S.confirm === "del:" + p.id ? " is-armed" : ""}" data-db-del title="このパネルを消す（Delete。もう一度押すと消えます）">${S.confirm === "del:" + p.id ? "消す？" : "消す"}</button>`
      : `<button type="button" class="db-pbtn db-quiet" data-db-edit title="このパネルを組み直す（編集に入ります）">組む</button>`;
    // 絞る（見ているとき・編集のときとも。この PC の見え方）。効いていれば数を出す（状態が見える）
    const qn = Q.chips(quickOf(p.id)).length;
    const filt = (width < NARROW || fold) && S.edit ? "" : `<button type="button" class="db-pbtn db-filt${qn ? " is-on" : ""}" data-db-filter aria-haspopup="dialog" title="このパネルだけを、設備・期間・値で絞ります（この PC の見え方）">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.2V13l-3 1.2V8.2z"/></svg>${qn ? `絞り込み ${qn}` : "絞る"}</button>`;
    return `${dot}<h3 title="${esc(titleOf(p))}">${titleHtml(p)}</h3><span class="db-sp"></span>`
      + badge + (a && a.busy ? '<i class="db-spin" aria-label="読んでいます"></i>' : "") + filt + tools;
  }
  /** パネルを描く。組み・答え・大きさ・編集の様子が前に描いた時と同じなら描かない（force で必ず） */
  function paintPanel(id, force = false) {
    const p = panelOf(id), el = document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(id)}"]`);
    if (!p || !el) return;
    const a1 = S.answers.get(id), bd = el.querySelector(".db-pb");
    const sig = JSON.stringify([{ ...p, x: 0, y: 0 }, a1 ? a1.n : 0, el.clientWidth, el.clientHeight, bd.clientWidth, bd.clientHeight, S.edit, S.confirm, quickOf(id), sliceOf(p), S.sources.length]);
    if (!force && el._sig === sig) return;
    el._sig = sig;
    // 形を替えた直後は、前の形の答え（合わせた表の答えとふつうの答えは形が違う）では描かない（引き直した答えを待つ）
    const a0 = S.answers.get(id), a = a0 && a0.d && (p.visual === "board") !== !!a0.d.groups ? { ...a0, d: null, err: "" } : a0;
    const ph = el.querySelector(".db-ph");
    ph.innerHTML = headHtml(p, a, el.clientWidth);
    el.setAttribute("aria-label", titleOf(p));
    // 添え書き（元・期間・条件）は見出しの下の 2 行目（見出しは題と操作だけで 1 行）。数字の形は数の下に出す
    const meta = metaOf(asked(p), a), subEl = el.querySelector(".db-psub");
    subEl.hidden = !meta || p.visual === "kpi"; subEl.textContent = meta; subEl.title = meta;
    // 効いている絞り込みの札（見出しの下。× で 1 つずつ外す）
    const qc = Q.chips(quickOf(id)), qEl = el.querySelector(".db-pq"), hit = Q.sliceHits(p, sliceOf(p), canEquip), sl = sliceState();
    // スライサーが効いているパネルには札（外すのは道具の行のスライサーで）
    // スライサーが効いているパネルは、見出しの題の横に札（段を増やさない: 1 段の数字のパネルで数が隠れた）。外すのは道具の行のスライサーで
    // 期間は「元の期間→スライサーの期間」（前日→9月・今月→9月。2 回目の採点: 前日と今月のパネルが同じ題と数に見えた）
    const sw = hit.period || hit.equip ? [hit.period ? `${ownPeriod(p) ? ownPeriod(p) + "→" : ""}${sliceWord(sl.period)}` : "", hit.equip ? eqWord(sl.equips) : ""].filter(Boolean).join("・") : "";
    el.classList.toggle("is-sliced", !!sw);
    const h3 = el.querySelector(".db-ph h3");
    const badgeHtml = sw ? `<span class="db-sbadge" title="ダッシュボードのスライサー（${esc(sw)}）で数えています。道具の行で外せます"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.2V13l-3 1.2V8.2z"/></svg>${esc(sw)}</span>` : "";
    if (sw && h3) h3.insertAdjacentHTML("afterend", badgeHtml);
    // 編集で題が切れるなら、操作を「⋯」1 つに畳む（2026-10-dashslice の 2 回目の採点: 1280 の数字のパネルで題が「前日の実績…」と切れた）
    const t3 = el.querySelector(".db-ph h3");
    if (S.edit && t3 && t3.scrollWidth > t3.clientWidth + 1 && !ph.querySelector("[data-db-more]")) {
      ph.innerHTML = headHtml(p, a, el.clientWidth, true);
      if (sw) ph.querySelector("h3").insertAdjacentHTML("afterend", badgeHtml);
    }
    qEl.hidden = !qc.length;
    qEl.innerHTML = qc.map((c) => `<span class="db-qchip">${esc(c.text)}<button type="button" data-db-qdrop="${esc(c.key)}" aria-label="「${esc(c.text)}」の絞り込みを外す">×</button></span>`).join("");
    const body = el.querySelector(".db-pb"), foot = el.querySelector(".db-pf");
    const size = { w: body.clientWidth, h: body.clientHeight };
    let note = "";
    if (!a || (!a.d && !a.err)) body.innerHTML = '<p class="dp-wait">数えています…</p>';
    else if (a.err && !a.d) body.innerHTML = errHtml(a);
    else {
      body.classList.toggle("is-busy", !!a.busy);
      note = p.visual === "board" ? P.board(body, p, a.d, size.h) : P.render(body, p, a.d, size, p.visual === "kpi" ? meta : "");
    }
    foot.hidden = !note; foot.textContent = note || ""; foot.title = note || "";
    if (note && body.clientHeight < size.h - 2) {          // 下の知らせの分だけ低くなった: もう一度、新しい高さで描く
      if (a && a.d && p.visual === "board") P.board(body, p, a.d, body.clientHeight);
      else if (a && a.d) P.render(body, p, a.d, { w: body.clientWidth, h: body.clientHeight }, p.visual === "kpi" ? meta : "");
    }
  }
  const sliceWord = (per) => (per.kind === "days" ? `直近 ${per.n || 7} 日` : per.kind === "month" || per.kind === "this_month" || per.kind === "last_month" ? D.monthName(D.backOf(per), today()) : { today: "今日", yesterday: "前日" }[per.kind] || "");
  /** 設備の並びの短い字: 設備グループとちょうど同じならグループの名前（スライサーの札と同じ言葉）、ほかは 3 つまで */
  const eqWord = (list) => { const g = D.groupsOf(S.tree || {}, (sliceState() || {}).set).find((x) => !x.none && D.same(x.members, list)); return g ? g.name : `${list.slice(0, 3).join("・")}${list.length > 3 ? ` ほか ${list.length - 3}` : ""}`; };
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
      bar.innerHTML = pick + `<div class="ds-wrap" id="dashSlicer">${D.barHtml(sliceState(), sliceInfo())}</div>` + msg + `<span class="db-sp"></span><small class="db-when" title="出ているあいだは 1 分ごとに引き直します">${when ? `${when} の数` : ""}</small>`
        + `<button type="button" class="pv-btn" data-db-refresh title="いま引き直す">↻ 引き直す</button>`
        + `<button type="button" class="btn-primary db-editbtn" data-db-editmode title="パネルを足す・動かす・大きさを変える・組む">編集</button>`;
      // 入り切らなければ（1280 など）詰めた形に
      const w = bar.querySelector("#dashSlicer");
      if (w && w.scrollWidth > w.clientWidth + 1) w.innerHTML = D.compactHtml(sliceState(), sliceInfo());
      return;
    }
    const rows = `<label class="pv-ck" title="グリッドの段の数（多いほど 1 段が低い）">段<select data-db-rows>${Array.from({ length: S.rowsRange[1] - S.rowsRange[0] + 1 }, (_, i) => S.rowsRange[0] + i)
      .map((n) => `<option${n === S.layout.rows ? " selected" : ""}${n < minRows() ? " disabled" : ""}>${n}</option>`).join("")}</select></label>`;
    const canSave = it && !it.builtin && it.canEdit;
    const leave = S.confirm === "leave"
      ? `<span class="db-armed">変えた所を捨てますか</span><button type="button" class="btn-ghost" data-db-stay>戻る</button><button type="button" class="pv-btn is-danger" data-db-discard>捨てる</button>`
      : `<button type="button" class="btn-ghost" data-db-leave>${dirty() ? "やめる" : "編集を終える"}</button>`;
    const sl = sliceState(), sw = sl ? [sl.period && sl.period.kind ? sliceWord(sl.period) : "", (sl.equips || []).length ? eqWord(sl.equips) : ""].filter(Boolean).join("・") : "";
    bar.innerHTML = pick + `<span class="db-editing">編集中</span>`
      + (sw ? `<button type="button" class="ds-mini" data-ds-clear title="スライサー（${esc(sw)}）が効いています。押すと外します">スライサー ${esc(sw)} ×</button>` : "")
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
  /** anchor … 開く元の要素か、その選び方（字）。前の面を閉じると道具の行を描き直すので、要素はそのあとで探し直す
      （描き直しで外れた要素の下に開いて、面が左上に出ていた: 2026-10-dashslice の 1 回目の採点） */
  function openPop(kind, anchor, html, cls = "") {
    const sel = typeof anchor === "string" ? anchor : null;
    closePop();
    if (sel || !anchor.isConnected) anchor = document.querySelector(sel || `[data-db-${kind}]`) || anchor;
    S.pop = kind;
    popEl = document.createElement("div");
    popEl.className = `db-pop ${cls}`; popEl.setAttribute("role", "dialog");
    popEl.innerHTML = html;
    document.body.append(popEl);
    TPA.placeBelow(popEl, anchor);
    popOff = TPA.dismissable(popEl, closePop, { keep: { contains: (t) => !!(t && t.closest && t.closest(kind === "slice" ? "[data-ds-pick]" : `[data-db-${kind}]`)) } });
    popEl.addEventListener("click", onPopClick);
    popEl.addEventListener("change", onPopChange);
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
  /** スライサーの「設備…」の面のチェック */
  function onPopChange(e) {
    const x = e.target, sl = { ...(sliceState() || {}) }, eq = new Set(sl.equips || []);
    if (x.matches("[data-ds-set]")) { setSlice({ ...sl, set: x.value }); return; }
    if (x.matches("[data-ds-eq]")) { if (x.checked) eq.add(x.dataset.dsEq); else eq.delete(x.dataset.dsEq); }
    else if (x.matches("[data-ds-gck]")) { const g = D.groupsOf(S.tree || {}, sl.set).find((y) => y.name === x.dataset.dsGck); (g ? g.members : []).forEach((m) => (x.checked ? eq.add(m) : eq.delete(m))); }
    else return;
    const names = (S.tree && S.tree.names) || [];
    setSlice({ ...sl, equips: names.filter((n) => eq.has(n)) });
  }
  async function onPopClick(e) {
    const t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-ds-done")) { closePop(); return; }
    if (t.hasAttribute("data-ds-all")) { setSlice({ ...(sliceState() || {}), equips: [] }); return; }
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
    const mid = popEl && popEl.dataset.panel;
    if (mid && t.hasAttribute("data-db-edit")) { closePop(); openEditor(mid); return; }
    if (mid && t.hasAttribute("data-db-dup")) { closePop(); duplicate(mid); return; }
    if (mid && t.hasAttribute("data-db-del")) { if (S.confirm === "del:" + mid) { closePop(); remove(mid); } else { S.confirm = "del:" + mid; popEl.innerHTML = moreHtml(mid); } }
  }
  const moreHtml = (id) => `<button type="button" class="db-li" data-db-edit><b>組む</b><small>Enter</small></button><button type="button" class="db-li" data-db-dup><b>複製</b></button>`
    + `<button type="button" class="db-li is-danger${S.confirm === "del:" + id ? " is-armed" : ""}" data-db-del><b>${S.confirm === "del:" + id ? "もう一度押すと消えます" : "消す"}</b><small>Delete</small></button>`;

  /* ---------------- 保存 ---------------- */
  /** 置き場へ書く。local（中身だけの上書き）なら並びを読み直さず、答えの 1 件だけを差し替える（版 3.41.0: 保存のたびに全部のダッシュボードを読み直し、
      全部のパネルを描き直していた）。描き直すのは、サーバーが直した中身が今の組みと違うときだけ */
  async function writeLayout(method, id, body, done, { local = false } = {}) {
    const r = await fetch(id ? `/api/dashboards/${id}` : "/api/dashboards", TPA.json(method, body));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = d.error || (r.status === 409 ? "ほかの PC が先に直しました。開き直してから直してください。" : `保存できませんでした（${r.status}）`);
      return { error: why };
    }
    const i = local ? S.list.findIndex((x) => String(x.id) === String(d.id)) : -1;
    if (i >= 0) S.list[i] = d; else await loadList();
    S.id = d.id; remember({ id: d.id });
    const same = canon(d.body) === canon(S.layout);
    if (!same) S.layout = TPA.clone(d.body);
    S.saved = JSON.stringify(S.layout);
    if (same) paintBar(); else paint();
    say(done);
    return { ok: d };
  }
  /** 鍵の順によらない字（サーバーは鍵を並べて返す） */
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
  let saving = false;
  async function save() {
    const it = current(); if (!it || it.builtin || saving) return;
    saving = true;
    // 押したらすぐ「保存しています…」（共有のマスタが遅くても、押せたかが分かる）
    const btn = document.querySelector("[data-db-save]");
    if (btn) { btn.disabled = true; btn.textContent = "保存しています…"; }
    say("保存しています…");
    try {
      const r = await writeLayout("PUT", it.id, { body: S.layout, base_rev: it.rev }, "保存しました", { local: !S.layout.panels.some((x) => x.legacy) });   // 前の版の 1 枚の表は、並びを読み直して前の版の条件を入れ直す
      if (r.error) { say("✕ " + r.error); paintBar(); }
    } finally { saving = false; }
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
    drag = { id: p.id, mode: rz ? "size" : "move", dir: rz ? rz.dataset.rz || "se" : "", x0: e.clientX, y0: e.clientY, r0: { x: p.x, y: p.y, w: p.w, h: p.h }, cw: cw + GAP, ch: ch + GAP, r: null };
    el.classList.add("is-drag");
    document.body.classList.add("db-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }
  /** 角（nw・ne・sw・se）を dx・dy マス引いた大きさ（向かいの角は動かない。1 マスより小さく・グリッドの外へはしない） */
  function sized(r0, dir, dx, dy) {
    const r = { ...r0 };
    if (dir.includes("e")) r.w = Math.max(1, Math.min(COLS - r0.x, r0.w + dx));
    if (dir.includes("w")) { const x = Math.max(0, Math.min(r0.x + r0.w - 1, r0.x + dx)); r.w = r0.x + r0.w - x; r.x = x; }
    if (dir.includes("s")) r.h = Math.max(1, Math.min(S.layout.rows - r0.y, r0.h + dy));
    if (dir.includes("n")) { const y = Math.max(0, Math.min(r0.y + r0.h - 1, r0.y + dy)); r.h = r0.y + r0.h - y; r.y = y; }
    return r;
  }
  function onMove(e) {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.x0) / drag.cw), dy = Math.round((e.clientY - drag.y0) / drag.ch), r0 = drag.r0;
    const r = drag.mode === "move"
      ? { ...r0, x: Math.max(0, Math.min(COLS - r0.w, r0.x + dx)), y: Math.max(0, Math.min(S.layout.rows - r0.h, r0.y + dy)) }
      : sized(r0, drag.dir, dx, dy);
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
      // Shift＋矢印＝右下の角・Alt＋Shift＋矢印＝左上の角（版 3.41.0。四隅から大きさを変えるのと同じ）
      const r = e.shiftKey && e.altKey ? sized(p, dir[0] ? "w" : "n", dir[0], dir[1]) : e.shiftKey ? { ...p, w: p.w + dir[0], h: p.h + dir[1] } : { ...p, x: p.x + dir[0], y: p.y + dir[1] };
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
  /** パネルの中身を np に置き換える（置き場 x・y・w・h は今のまま）。形を替えると項目が変わる（合わせた表 ↔ ふつうのパネル）ので、無くなった項目は消す */
  function replacePanel(cur, np) {
    const at = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
    Object.keys(cur).forEach((k) => { if (!(k in np)) delete cur[k]; });
    return Object.assign(cur, np, at);
  }
  function openEditor(id) {
    const p = panelOf(id); if (!p) return;
    if (!S.edit) { S.edit = true; }
    S.editing = id; S.sel = id; editBase = TPA.clone(p);
    $("#dashScreen").classList.add("has-editor");
    focusFrame(id);
    paint();
    E.open({ panel: p, sources: S.sources, toast: say, answer: () => (S.answers.get(id) || {}).d, egroupSets: () => S.egroupSets || [],
      onChange: (np) => { replacePanel(panelOf(id), np); place(document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(id)}"]`), panelOf(id)); paintPanel(id); clearTimeout(openEditor.t); openEditor.t = setTimeout(() => { const q = panelOf(id); if (q) queryPanel(q); }, 250); },
      onApply: (np) => {
        const cur = panelOf(id), base = editBase; closeEditor();
        if (!cur) return;
        replacePanel(cur, base);           // 元に戻す の履歴に「組む前」を残してから当てる
        commit((L) => replacePanel(L.panels.find((x) => x.id === id), np), "当てました（保存するまでは、この PC の画面だけです）");
      },
      onCancel: () => { const cur = panelOf(id); if (cur && editBase) replacePanel(cur, editBase); closeEditor(); paint(); refresh(false); },
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

  /* ---------------- パネルを絞る（dashboard-filter.js） ---------------- */
  function openFilter(id, anchor) {
    const p = panelOf(id); if (!p) return;
    if (Q.isOpen()) { Q.close(); return; }
    const a = S.answers.get(id), keys = p.visual === "board" && a && a.d && a.d.groups ? P.boardKeys(p, a.d) : null;
    Q.open({ anchor, panel: p, quick: quickOf(id), sources: S.sources, boardKeys: keys, canMove: S.edit,
      onChange: (q) => { setQuick(id, q); refresh(false); paintPanel(id); },
      onMove: () => {          // この PC の絞り込みを、組んだ条件へ移す（保存すると全員に効く）
        const q = quickOf(id); if (!q) return;
        setQuick(id, null);
        commit((L) => { const x = L.panels.find((y) => y.id === id); Object.assign(x, Q.merge(x, q)); }, "絞り込みをパネルの条件にしました（保存すると全員に効きます）");
      } });
  }

  /* ---------------- 押す ---------------- */
  function onClick(e) {
    const t = e.target; if (!t.closest) return;
    const b = t.closest("button"); const pEl = t.closest(".db-p");
    if (S.edit && pEl && !b && !S.editing) { S.sel = pEl.dataset.id; document.querySelectorAll("#dashGrid .db-p").forEach((x) => x.classList.toggle("is-sel", x === pEl)); }
    if (!b) return;
    if (b.hasAttribute("data-db-pick")) { if (S.pop === "pick") closePop(); else { S.confirm = ""; openPop("pick", b, pickHtml(), "db-pickpop"); } return; }
    if (b.hasAttribute("data-db-refresh")) { refresh(true); return; }
    // スライサー
    if (b.dataset.dsPeriod != null) { const k = b.dataset.dsPeriod; setSlice({ ...(sliceState() || {}), period: k ? { kind: k, ...(k === "days" ? { n: 7 } : {}) } : null }); return; }
    if (b.dataset.dsBack != null) { const k0 = D.backOf((sliceState() || {}).period); setSlice({ ...(sliceState() || {}), period: D.periodBack(Math.max(0, (k0 ?? 0) + +b.dataset.dsBack)) }); return; }
    if (b.hasAttribute("data-ds-all")) { setSlice({ ...(sliceState() || {}), equips: [] }); return; }
    if (b.dataset.dsGroup != null) {
      const g = D.groupsOf(S.tree || {}, (sliceState() || {}).set).find((x) => x.name === b.dataset.dsGroup), cur = (sliceState() || {}).equips || [];
      const on = g && cur.length === g.members.length && g.members.every((m) => cur.includes(m));
      setSlice({ ...(sliceState() || {}), equips: on || !g ? [] : g.members.slice() }); return;
    }
    if (b.hasAttribute("data-ds-pick")) { if (S.pop === "slice") closePop(); else { const el = openPop("slice", "#dashSlicer [data-ds-pick]:not([hidden])", D.pickHtml(sliceState(), sliceInfo()), "db-slicepop"); D.mixed(el); if (!S.tree) loadTree(); } return; }
    if (b.hasAttribute("data-ds-clear")) { setSlice({ set: (sliceState() || {}).set }); say("スライサーを外しました"); return; }
    if (b.hasAttribute("data-db-editmode")) { S.edit = true; S.confirm = ""; paint(); say("見出しで動かす・四隅で大きさ・空いたマスで足す"); return; }
    if (b.hasAttribute("data-db-leave")) { if (dirty()) { S.confirm = "leave"; paintBar(); } else { S.edit = false; closeEditor(); paint(); } return; }
    if (b.hasAttribute("data-db-stay")) { S.confirm = ""; paintBar(); return; }
    if (b.hasAttribute("data-db-discard")) { S.confirm = ""; closeEditor(); const id = S.id; S.edit = false; if (id != null) open(id); else open(S.standardId); return; }
    if (b.hasAttribute("data-db-save")) { save(); return; }
    if (b.hasAttribute("data-db-saveas")) { if (S.pop === "saveas") closePop(); else { openPop("saveas", b, saveAsHtml(), "db-savepop"); popEl.querySelector("#dbSaveName").select(); } return; }
    if (b.hasAttribute("data-db-add")) { addPanel(); return; }
    if (b.hasAttribute("data-db-undo")) { undo(); return; }
    if (b.dataset.cell) { const [x, y] = b.dataset.cell.split(",").map(Number); addPanel({ x, y }); return; }
    const id = pEl && pEl.dataset.id;
    if (!id) return;
    if (b.hasAttribute("data-db-filter")) { openFilter(id, b); return; }
    if (b.dataset.dbQdrop) { setQuick(id, Q.drop(quickOf(id), b.dataset.dbQdrop)); refresh(false); paintPanel(id); return; }
    if (b.hasAttribute("data-db-more")) { if (S.pop === "more") closePop(); else { const el = openPop("more", b, moreHtml(id), "db-morepop"); el.dataset.panel = id; } return; }
    if (b.hasAttribute("data-db-edit")) { openEditor(id); return; }
    if (b.hasAttribute("data-db-dup")) { duplicate(id); return; }
    if (b.hasAttribute("data-db-del")) remove(id);
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches && t.matches("[data-ds-psel]")) { const [k, n] = t.value.split(":"); setSlice({ ...(sliceState() || {}), period: k ? { kind: k, ...(k === "days" ? { n: 7 } : n ? { n: +n } : {}) } : null }); return; }
    if (t.matches && t.matches("[data-ds-gsel]")) {
      if (t.value === "@pick") { const el = openPop("slice", "#dashSlicer [data-ds-gsel]", D.pickHtml(sliceState(), sliceInfo()), "db-slicepop"); D.mixed(el); return; }
      if (t.value === "@custom") return;
      const g = D.groupsOf(S.tree || {}, (sliceState() || {}).set).find((x) => x.name === t.value);
      setSlice({ ...(sliceState() || {}), equips: g ? g.members.slice() : [] }); return;
    }
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
    window.addEventListener("resize", () => { clearTimeout(bind.rt); bind.rt = setTimeout(() => { if (S.active) paintBar(); }, 150); });
    // マスタ（設備グループなど）が変わったら、選び（まとめ方）を読み直し、出ていれば数え直す（版 3.39.0）
    document.addEventListener("tpa:masters-changed", () => { loadTree(); loadSources().then(() => { if (S.active && S.layout) refresh(true); }); });
    watchSize();
  }

  async function start() {
    bind();
    if (S.loading) return;
    S.loading = true;
    try {
      await Promise.all([loadList(), loadSources()]);
      loadTree();
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
    /** 案を撮る道具から: スライサーの字（compact で詰めた形）。置き場を替える案が、道具の行の外に描くため */
    _slicerHtml: (compact = false) => (compact ? D.compactHtml : D.barHtml)(sliceState(), sliceInfo()),
    _setLayout(l) { S.layout = TPA.clone(l); S.saved = JSON.stringify(S.layout); S.answers.clear(); paint(); refresh(true); },
    _state: () => ({ id: S.id, edit: S.edit, layout: TPA.clone(S.layout), answers: Object.fromEntries([...S.answers].map(([k, v]) => [k, v.d || { error: v.err }])) }),
  };
})();
