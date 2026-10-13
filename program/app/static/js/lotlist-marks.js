"use strict";
/* =========================================================================
   色付け（条件付き書式）: 絞り込みの派生。作った条件に当たった所だけ、行を消さずに色を付ける
   - 1 組 ＝ 条件の並び（かつ。絞り込みと同じ列・比べ方・値）＋色＋当てる所（条件の列のセル／行全体）＋使う／使わない
   - 判定はサーバー（lot_list.mark_rows・desktop の lotlist.rs）。絞り込みと同じ式なので、「絞ると出る行」と「色が付く行」は食い違わない。
     答えは、組ごとに「このページで当たった行の位置」と「絞り込んだ全件で当たった数」（凡例に出す）
   - 当たった印は、受け取った直後に行そのもの（WeakMap）へ結ぶ（画面が段のために行を並べ替えても外れない）
   - 同じセル・行に何組も当たったら、上の組が勝つ（並びが優先の順）
   - 表ごとにこの PC に覚える（スライサーと同じ）。表示の設定の書き出し・読み込みと共有の書式にも入る（setupOf・setSetup）
   - 画面（7 案＋2 回目で選んだ: program/tools/ui-proposals/2026-10-marks*.mjs の M2）:
       道具の行の入口「●● 色付け n ▾」（閉じていても効いている色と数が見える）→ 面: 組の一覧（使う／使わない・色・当てる所・順・消す）
       と「色付けを作る」（列・比べ方・値。条件を足すと「かつ」・色・当てる所）／件数の行の凡例の札（全件で当たった数。押すと消す／付ける）
       ／「列で絞り込む」の行の「色を付ける」（打っている条件を、絞り込む代わりに色に。lotlist.js）
   一覧（lotlist.js）とは mount の引数だけでつながる: table（覚えの範囲）・columns・label・condText・ops・paintOps・noValue・colOption・onChange・toast
   ========================================================================= */
(function () {
  const KEY = "tpa.lotlist.marks.v1";
  const MAX = 8;                // サーバーの MAX_MARKS と同じ
  // 色は意味で固定（色彩の約束: 赤＝悪い・黄＝注意・緑＝良い・青＝確かめる・紫＝分ける・灰＝目立たせない）
  const TONES = [["red", "赤（悪い）"], ["amber", "黄（注意）"], ["green", "緑（良い）"], ["blue", "青（確かめる）"], ["violet", "紫（分ける）"], ["gray", "灰（目立たせない）"]];
  const TARGETS = [["cells", "条件の列のセル"], ["row", "行全体"]];
  const { $, esc } = TPA;
  let host = null;
  let draft = null;             // 作りかけの組（面を開いているあいだ）{conds, tone, target}
  let menuOff = null;
  let hit = new WeakMap();      // 行 → 当たった組の id の並び（上の組から）
  let counts = {};              // 組の id → 全件で当たった数（当てられない組は null）

  /* ---- 覚え: {tables: {表: [{id, conds: [{column, op, value}], tone, target, on}]}} ---- */
  const load = () => { const s = TPA.local.get(KEY, {}); return { tables: (s && s.tables) || {} }; };
  let st = load();
  const save = () => TPA.local.set(KEY, st);
  const clean = (r) => ({
    id: String(r.id || Math.random().toString(36).slice(2, 10)),
    conds: (Array.isArray(r.conds) ? r.conds : []).filter((f) => f && f.column && f.op).map((f) => ({ column: String(f.column), op: String(f.op), value: String(f.value ?? "") })),
    tone: TONES.some((t) => t[0] === r.tone) ? r.tone : "red",
    target: TARGETS.some((t) => t[0] === r.target) ? r.target : "cells",
    on: r.on !== false,
  });
  const rules = () => (st.tables[host.table()] || []);
  const setRules = (list) => { const t = host.table(); if (list.length) st.tables[t] = list.map(clean); else delete st.tables[t]; save(); };
  /** サーバーへ送る組（使っていて、条件のある物だけ。並びは優先の順） */
  const live = () => rules().filter((r) => r.on && r.conds.length).slice(0, MAX);

  /** 問い合わせに足す marks（無ければ ""） */
  function param() { const l = live(); return l.length ? JSON.stringify(l.map((r) => r.conds)) : ""; }
  /** 答えを受け取った: 当たった印を行そのものに結ぶ（並べ替える前の行の並びで呼ぶ） */
  function take(rows, marks, markCounts) {
    hit = new WeakMap(); counts = {};
    const l = live();
    if (!Array.isArray(marks)) return;
    l.forEach((r, k) => {
      counts[r.id] = markCounts ? markCounts[k] : null;
      (marks[k] || []).forEach((i) => { const row = rows[i]; if (!row) return; const a = hit.get(row) || []; a.push(r.id); hit.set(row, a); });
    });
  }
  const used = (r) => new Set(r.conds.map((f) => f.column));
  const ruleOf = (id) => rules().find((r) => r.id === id);
  /** 行の色（行全体の組のうち、いちばん上の物）→ クラス名の字（無ければ ""） */
  function rowClass(row) {
    const r = (hit.get(row) || []).map(ruleOf).find((x) => x && x.target === "row");
    return r ? `mk-row mk-${r.tone}` : "";
  }
  /** セルの色（その列を条件に使うセルの組のうち、いちばん上の物）→ " mk-cell mk-…"（無ければ ""） */
  function cellClass(row, col) {
    const r = (hit.get(row) || []).map(ruleOf).find((x) => x && x.target === "cells" && used(x).has(col));
    return r ? ` mk-cell mk-${r.tone}` : "";
  }
  /** 組を人の読める字に（「重量 ≧ 3000 かつ 板厚 ＜ 1」） */
  const text = (r) => r.conds.map((f) => host.condText(f)).join(" かつ ");
  const toneName = (t) => (TONES.find((x) => x[0] === t) || TONES[0])[1];
  const targetName = (t) => (TARGETS.find((x) => x[0] === t) || TARGETS[0])[1];
  const countOf = (r) => (r.id in counts ? counts[r.id] : undefined);

  /* ---- 操作 ---- */
  function add(conds, opt = {}) {
    if (!conds.length) return null;
    const list = rules();
    if (list.length >= MAX) { host.toast(`色付けは 1 つの表で ${MAX} 組までです（使わない組を消してください）`); return null; }
    const taken = new Set(list.map((r) => r.tone));        // 色は、まだ使っていない物から（組どうしを見分けやすく）
    const r = clean({ conds, tone: opt.tone || (TONES.find((t) => !taken.has(t[0])) || TONES[0])[0], target: opt.target || "cells" });
    setRules(list.concat(r)); paint(); host.onChange();
    return r;
  }
  function update(id, patch) { setRules(rules().map((r) => (r.id === id ? { ...r, ...patch } : r))); paint(); host.onChange(); }
  function remove(id) { setRules(rules().filter((r) => r.id !== id)); paint(); host.onChange(); }
  function move(id, to) {
    const list = rules().slice(), i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    const [r] = list.splice(i, 1); list.splice(Math.max(0, Math.min(list.length, to)), 0, r);
    setRules(list); paint(); host.onChange();
  }

  /* ---- 画面: 入口・凡例 ---- */
  function paint() {
    if (!host) return;
    const b = $("#llMarkBtn");
    if (b) {
      const all = rules(), on = live();
      b.classList.toggle("is-on", on.length > 0);
      b.innerHTML = `<span class="mk-dots" aria-hidden="true">${on.length ? on.map((r) => `<i class="mk-${r.tone}"></i>`).join("") : '<i class="mk-none"></i>'}</span>色付け`
        + (all.length ? `<b>${on.length}</b>` : "") + '<i class="hd-caret" aria-hidden="true">▾</i>';
      b.title = all.length ? `色付け ${all.length} 組（使っている ${on.length} 組）。行は絞らず、条件に当たった所に色を付けます`
        : "条件に当たった所に色を付けます（行は絞りません。絞り込みと同じ条件で作ります）";
    }
    const sum = $("#llMarkSum");
    if (sum) {
      const all = rules();
      sum.hidden = !all.length;
      // 件数の行の「効いている物」のタブ（lotlist-active.js）が読む数・要約・色（使っている先頭の組の色）
      sum.dataset.count = all.length;
      sum.dataset.summary = all.map((r) => text(r) + (r.on ? "" : "（消している）")).join(" ／ ");
      sum.dataset.tone = (all.find((r) => r.on) || {}).tone || "";
      sum.innerHTML = all.map((r) => {
        const n = countOf(r), t = text(r);
        const tip = `${t}（${targetName(r.target)}・${toneName(r.tone)}）\n${r.on ? (n == null ? "" : `全件で ${n.toLocaleString()} 行に当たります。`) + "押すと消します" : "押すと付けます"}（行は絞りません）`;
        return `<button type="button" class="mk-chip mk-${r.tone}${r.on ? "" : " is-off"}" data-mk-chip="${esc(r.id)}" aria-pressed="${r.on}" title="${esc(tip)}">`
          + `<span class="mk-dot"></span><span class="mk-chip-t">${esc(t)}</span>${r.on && n != null ? `<i>${n.toLocaleString()}</i>` : ""}</button>`;
      }).join("");
    }
    if (!$("#llMarkMenu")?.hidden) renderMenu();
  }

  /* ---- 画面: 面（一覧と作る所） ---- */
  const newCond = (column = "") => ({ column, op: "eq", value: "" });
  const condOk = (f) => f.column && f.op && (host.noValue(f.op) || String(f.value).trim() !== "");
  function freshDraft() {
    const taken = new Set(rules().map((r) => r.tone));
    return { conds: [newCond()], tone: (TONES.find((t) => !taken.has(t[0])) || TONES[0])[0], target: "cells" };
  }
  const tonePick = (cur, attr) => `<span class="mk-tones" role="radiogroup" aria-label="色">${TONES.map(([k, name]) =>
    `<button type="button" class="mk-tone mk-${k}" role="radio" aria-checked="${k === cur}" ${attr}="${k}" title="${name}"></button>`).join("")}</span>`;
  const targetPick = (cur, attr) => `<select ${attr} aria-label="当てる所">${TARGETS.map(([k, name]) => `<option value="${k}"${k === cur ? " selected" : ""}>${name}</option>`).join("")}</select>`;
  function renderMenu() {
    const m = $("#llMarkMenu"); if (!m) return;
    const list = rules(), cols = host.columns();
    if (!draft) draft = freshDraft();
    const rows = list.map((r, i) => {
      const n = countOf(r), missing = r.conds.some((f) => cols.length && !cols.includes(f.column));
      return `<li class="mk-item${r.on ? "" : " is-off"}" data-id="${esc(r.id)}">
        <label class="mk-on" title="${r.on ? "使っています（外すと色を消します）" : "使っていません（付けると色を付けます）"}"><input type="checkbox" data-mk-on${r.on ? " checked" : ""} aria-label="この色付けを使う"></label>
        <span class="mk-dot mk-${r.tone}" aria-hidden="true"></span>
        <span class="mk-text">${esc(text(r))}</span>
        <small class="mk-n">${missing ? '<em title="この表に無い列を使っているので、当てません">この表に無い列</em>' : `${targetName(r.target)}${r.on && n != null ? `・${n.toLocaleString()} 件` : ""}`}</small>
        <span class="mk-tools">${tonePick(r.tone, "data-mk-tone")}${targetPick(r.target, "data-mk-target")}
          <button type="button" data-mk-up${i ? "" : " disabled"} title="上へ（同じ所に当たったときに優先します）" aria-label="上へ">↑</button>
          <button type="button" class="mk-x" data-mk-x title="この色付けを消します" aria-label="消す">×</button></span></li>`;
    }).join("");
    const conds = draft.conds.map((f, i) => `<div class="mk-cond" data-ci="${i}">${i ? '<span class="mk-and">かつ</span>' : ""}
        <select data-c-col aria-label="列"><option value="">列を選ぶ…</option>${cols.map(host.colOption).join("")}</select>
        <select data-c-op aria-label="比べ方">${host.ops.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <input data-c-val autocomplete="off" aria-label="値" placeholder="${host.noValue(f.op) ? "値は要りません" : "値"}"${host.noValue(f.op) ? " disabled" : ""} value="${esc(f.value)}">
        ${draft.conds.length > 1 ? '<button type="button" class="mk-x" data-c-x aria-label="この条件を外す" title="この条件を外す">×</button>' : ""}</div>`).join("");
    m.innerHTML = `<p class="mk-head">色付け<small>行は絞らず、条件に当たった所に色を付けます。同じ所に何組も当たったら、上の組の色です</small></p>
      ${list.length ? `<ol class="mk-list">${rows}</ol>` : '<p class="mk-empty">まだありません。下で条件を作るか、「列で絞り込む」の行の「色を付ける」で作れます</p>'}
      <section class="mk-make" aria-label="色付けを作る"><h5>色付けを作る<small>条件は絞り込みと同じです（並べると「かつ」）</small></h5>
        ${conds}
        <button type="button" class="mk-addc" data-c-add${draft.conds.length >= 6 ? " disabled" : ""}>＋ 条件を足す（かつ）</button>
        <div class="mk-style"><span>色</span>${tonePick(draft.tone, "data-d-tone")}<span>当てる所</span>${targetPick(draft.target, "data-d-target")}</div>
        <div class="mk-acts"><button type="button" class="mk-go" data-mk-make>色を付ける</button></div></section>`;
    draft.conds.forEach((f, i) => {
      const row = m.querySelector(`.mk-cond[data-ci="${i}"]`);
      row.querySelector("[data-c-col]").value = f.column;
      const op = row.querySelector("[data-c-op]"); op.value = f.op; host.paintOps(op, f.column);
    });
    paintMake();
  }
  function paintMake() {
    const b = $("#llMarkMenu [data-mk-make]"); if (!b) return;
    const ok = draft.conds.filter(condOk).length;
    b.disabled = !ok || rules().length >= MAX;
    b.title = rules().length >= MAX ? `1 つの表で ${MAX} 組までです` : ok ? "この条件に当たった所に色を付けます（行は絞りません）" : "列と値を選ぶと付けられます";
  }
  function onMenu(e) {
    const t = e.target, item = t.closest(".mk-item"), id = item && item.dataset.id, cond = t.closest(".mk-cond"), ci = cond ? +cond.dataset.ci : -1;
    if (e.type === "click") {
      if (t.closest("[data-mk-tone]") && id) { update(id, { tone: t.closest("[data-mk-tone]").dataset.mkTone }); return; }
      if (t.closest("[data-mk-up]") && id) { move(id, rules().findIndex((r) => r.id === id) - 1); return; }
      if (t.closest("[data-mk-x]") && id) { remove(id); return; }
      if (t.closest("[data-c-add]")) { draft.conds.push(newCond()); renderMenu(); return; }
      if (t.closest("[data-c-x]")) { draft.conds.splice(ci, 1); renderMenu(); return; }
      if (t.closest("[data-d-tone]")) { draft.tone = t.closest("[data-d-tone]").dataset.dTone; renderMenu(); return; }
      if (t.closest("[data-mk-make]")) {
        const conds = draft.conds.filter(condOk).map((f) => ({ ...f, value: host.noValue(f.op) ? "" : String(f.value).trim() }));
        if (add(conds, { tone: draft.tone, target: draft.target })) { draft = null; host.toast("色を付けました（行は絞りません）"); }
      }
      return;
    }
    if (t.matches("[data-mk-on]") && id) { update(id, { on: t.checked }); return; }
    if (t.matches("[data-mk-target]") && id) { update(id, { target: t.value }); return; }
    if (t.matches("[data-d-target]")) { draft.target = t.value; return; }
    if (ci < 0) return;
    const f = draft.conds[ci];
    if (t.matches("[data-c-col]")) { f.column = t.value; renderMenu(); return; }
    if (t.matches("[data-c-op]")) { f.op = t.value; if (host.noValue(f.op)) f.value = ""; renderMenu(); return; }
    if (t.matches("[data-c-val]")) { f.value = t.value; paintMake(); }
  }
  function closeMenu(byEsc) {
    const m = $("#llMarkMenu"); if (!m || m.hidden) return;
    m.hidden = true; $("#llMarkBtn").setAttribute("aria-expanded", "false");
    if (menuOff) menuOff(); menuOff = null;
    if (byEsc) $("#llMarkBtn").focus();
  }
  function toggleMenu() {
    const m = $("#llMarkMenu"), b = $("#llMarkBtn");
    if (!m.hidden) { closeMenu(); return; }
    m.hidden = false; renderMenu(); TPA.placeBelow(m, b);
    b.setAttribute("aria-expanded", "true");
    menuOff = TPA.dismissable(m, closeMenu, { keep: b });
  }
  function bind() {
    $("#llMarkBtn").addEventListener("click", toggleMenu);
    const m = $("#llMarkMenu");
    ["click", "change", "input"].forEach((ev) => m.addEventListener(ev, (e) => { if (ev === "input" && !e.target.matches("[data-c-val]")) return; onMenu(e); }));
    $("#llMarkSum").addEventListener("click", (e) => {
      const c = e.target.closest("[data-mk-chip]"); if (!c) return;
      const r = ruleOf(c.dataset.mkChip); if (r) update(r.id, { on: !r.on });
    });
  }

  function mount(h) { host = h; bind(); paint(); }
  /** 一覧の元・表が替わった: 前の答えの印を捨てる */
  function reset() { hit = new WeakMap(); counts = {}; draft = null; closeMenu(); paint(); }
  /** 表示の設定（lotlist-profile.js）: 範囲 t の組の並びと、その置き換え */
  const setupOf = (t) => (st.tables[t] || []).map(clean);
  function setSetup(t, list) {
    const rs = (Array.isArray(list) ? list : []).map(clean).filter((r) => r.conds.length).slice(0, MAX);
    if (rs.length) st.tables[t] = rs; else delete st.tables[t];
    save();
  }
  /** Excel に出力: 送った組の並び（答えの marks と同じ順）の、色・当てる所・条件の列 */
  const exportPlan = () => live().map((r) => ({ tone: r.tone, whole: r.target === "row", cols: [...used(r)] }));
  /** Excel に出力の「出力の条件」: [[色付け: 色, 条件]] */
  const summary = () => live().map((r) => [`色付け: ${(TONES.find((t) => t[0] === r.tone) || TONES[0])[1]}`, text(r) + `（${(TARGETS.find((t) => t[0] === r.target) || TARGETS[0])[1]}）`]);
  window.LotListMarks = { mount, reset, paint, param, take, rowClass, cellClass, rules, add, update, remove, move, text, countOf, setupOf, setSetup, summary, exportPlan, closeMenu, TONES, TARGETS, MAX };
})();
