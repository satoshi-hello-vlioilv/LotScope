/* =========================================================================
   共有の書式（一覧の表示ルールに名前を付けて共有に置き、ほかの設備・ほかの PC で呼び出して当てる）
   - 置き場はサーバー（GET/POST/PUT/DELETE /api/masters/formats。services/display_formats.py）。全員で 1 つ
   - 中身を取り出す・当てる・元に戻すのは一覧の部品（window.LotList.formats: capture・places・apply・undo）
   - 当てた所には「どの書式の何版を当てたか」を覚える（KEY.applied）。共有の書式がその後で上書きされたら、札で知らせる
   - 書けるのは現場のマスタを書ける人（canEdit）。呼び出して当てるのは誰でも（当てた先はこの PC の覚え）
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const KEY = { applied: "tpa.lotlist.formatApplied.v1" };   // {範囲: {id, name, rev}}
  const F = () => window.LotList.formats;
  let panel = null, btn = null, list = { items: [], canEdit: false, shared: false }, to = "here", picked = new Set(), undo = null, busy = false;

  const applied = () => TPA.local.get(KEY.applied, {});
  function remember(places, f) {
    const all = applied();
    places.forEach((pl) => { if (f) all[pl.key] = { id: f.id, name: f.name, rev: f.rev }; else delete all[pl.key]; });
    TPA.local.set(KEY.applied, all);
  }
  /** いまの所に当てた書式と、その後で共有の書式が上書きされたか → {name, newer} か null */
  function hereState() {
    const pl = F().places()[0], a = pl && applied()[pl.key];
    if (!a) return null;
    const f = list.items.find((x) => x.id === a.id);
    return { name: f ? f.name : a.name, newer: !!(f && f.rev > a.rev), gone: !f, id: a.id };
  }
  const who = (f) => [f.updatedBy && f.updatedBy.pc, f.updatedBy && f.updatedBy.login].filter(Boolean).join("／");
  const when = (s) => String(s || "").slice(5, 16).replace("T", " ").replace("-", "/");

  async function fetchList() {
    const src = F().here().source;
    const r = await fetch(`/api/masters/formats?source=${src}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "共有の書式を読めませんでした");
    list = { items: d.items || [], canEdit: !!d.canEdit, shared: !!d.shared };
    paintButton();
  }
  /** 入口の札（いまの所に当てた書式の名前・共有で上書きされたら印）。件数の行の札は版 3.25.0 で外した（入口の札と同じ物が 2 か所にあった。
      件数の行を 1 段に収める比べ: ui-proposals/2026-10-toolbar*） */
  function paintButton() {
    if (!btn) return;
    const st = hereState();
    btn.querySelector(".fm-now").textContent = st ? st.name : "";
    btn.classList.toggle("has-now", !!st);
    btn.classList.toggle("is-newer", !!(st && st.newer));
    btn.title = st ? (st.newer ? `「${st.name}」が共有で上書きされています。開いて当て直せます` : `この所には共有の書式「${st.name}」を当てています`)
      : "表示列・並び・条件・スライサー・色付けに名前を付けて共有に置き、ほかの設備・ほかの PC で呼び出します";
  }

  /* ---------------- 窓（2026-10-formats の K3: 上から 当てる所 → 結果と元に戻す → 書式の一覧 → 置く） ----------------
     行の主の行動は「当てる」1 つ（上書き・削除は「…」で開く）。部品は札。設備を選ぶ欄では、各設備にいま当たっている書式を名前の横に */
  function render(msg) {
    const h = F().here(), places = F().places(), st = hereState(), work = h.source === "work", ap = applied();
    const chips = (f) => f.parts.length ? f.parts.map((p) => `<i>${esc(p)}</i>`).join("") : "<i>中身なし</i>";
    const items = list.items.map((f) => {
      const cur = st && st.id === f.id;
      return `<li class="fm-item${cur ? " is-current" : ""}" data-id="${f.id}">
        <div class="fm-main"><b>${esc(f.name)}</b>${cur ? `<span class="fm-tag${st.newer ? " is-newer" : ""}">${st.newer ? "更新あり" : "当てている"}</span>` : ""}
          <span class="fm-parts">${chips(f)}</span>
          <small class="fm-who">${esc(f.origin || f.table || "")}${f.origin || f.table ? " ・ " : ""}${esc(who(f))} ${esc(when(f.updatedAt))}${f.note ? " ・ " + esc(f.note) : ""}</small></div>
        <div class="fm-acts"><button type="button" class="fm-apply" data-act="apply">当てる</button>
          ${list.canEdit ? `<button type="button" class="fm-more" data-act="more" aria-expanded="false" title="上書き・削除">…</button>` : ""}</div>
        ${list.canEdit ? `<div class="fm-subs" hidden><button type="button" data-act="over">いまの表示（${esc(h.origin)}）で上書き</button>
          <button type="button" class="fm-del" data-act="del">共有から削除</button><small>削除しても、当てた所の表示はそのまま残ります</small></div>` : ""}</li>`;
    }).join("");
    const others = places.filter((p) => !p.here);
    const curOf = (p) => (ap[p.key] ? `<small class="fm-cur">${esc(ap[p.key].name)}</small>` : "");
    const toHtml = !work ? "" : `<fieldset class="fm-to"><legend>当てる所</legend>
        <label><input type="radio" name="fmTo" value="here"${to === "here" ? " checked" : ""}> この設備（${esc(places[0] ? places[0].label : "")}）</label>
        <label><input type="radio" name="fmTo" value="pick"${to === "pick" ? " checked" : ""}${others.length ? "" : " disabled"}> 設備を選ぶ（${picked.size + 1} / ${places.length} 台）</label>
        <div class="fm-equips"${to === "pick" ? "" : " hidden"}>
          <label class="fm-all"><input type="checkbox" data-all${others.length && others.every((p) => picked.has(p.key)) ? " checked" : ""}> 全部</label>
          ${others.map((p) => `<label><input type="checkbox" data-key="${esc(p.key)}"${picked.has(p.key) ? " checked" : ""}> ${esc(p.label)}${curOf(p)}</label>`).join("")}
        </div></fieldset>`;
    panel.innerHTML = `<div class="fm-head"><b>共有の書式</b>${list.shared ? '<span class="fm-shared">全員の PC</span>' : '<span class="fm-shared is-local">この PC だけ</span>'}
        <small>表示列・並び・条件・スライサー・色付けに名前を付けて共有に置き、ほかの${work ? "設備・ほかの" : ""} PC で呼び出します</small></div>
      ${toHtml}
      <p class="fm-msg" id="fmMsg" aria-live="polite"${msg ? "" : " hidden"}>${msg || ""}</p>
      <ul class="fm-list" role="list">${items || `<li class="fm-empty">まだ書式はありません。${list.canEdit ? "下で、いまの表示に名前を付けて置けます。" : ""}</li>`}</ul>
      ${list.canEdit ? `<form class="fm-save" id="fmSave"><label for="fmName">いまの表示（${esc(h.origin)}）を書式として置く</label>
          <div><input id="fmName" maxlength="40" autocomplete="off" placeholder="名前（例: 標準・検査用）" value="${esc(st && !st.gone ? st.name : "")}"><button type="submit">置く</button></div></form>`
        : '<p class="fm-note">書式を置く・上書きするのは、マスタを書ける人だけです（呼び出して当てるのは誰でもできます）。</p>'}`;
  }
  const say = (html, ng) => { const m = $("#fmMsg"); if (!m) return; m.hidden = false; m.innerHTML = html; m.classList.toggle("is-ng", !!ng); };

  function targets(f) {
    const places = F().places(f && f.table);
    return to === "pick" ? places.filter((p) => p.here || picked.has(p.key)) : places.slice(0, 1);
  }
  function applyOne(f) {
    const tg = targets(f);
    const r = F().apply(f.body, tg);
    remember(tg, f);
    undo = r.undo;
    paintButton(); render();
    const where = tg.length > 1 ? `${tg.length} 台の設備` : `「${esc(tg[0].label)}」`;
    say(`「${esc(f.name)}」を${where}に当てました${r.rules ? `（読み替えルール ${r.rules} 個も）` : ""}。 <button type="button" class="fm-undo" data-act="undo">元に戻す</button>`);
  }
  async function send(method, url, body) {
    const w = TPA.waiting({ title: "共有の書式を保存しています", from: list.shared ? "共有のマスタ" : "", now: "書き込んでいます…", delay: 350 });
    try {
      const r = await fetch(url, method === "DELETE" ? { method } : TPA.json(method, body));
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data: d };
    } finally { w.done(); }
  }
  async function save(name) {
    const h = F().here(), body = F().capture();
    if (!Object.keys(body).length) { say("置ける表示ルールがありません（表示列・並び・条件などを整えてから置いてください）", true); return; }
    const same = list.items.find((f) => f.name === name);
    if (same && !confirm(`書式「${name}」はもうあります。いまの表示で上書きしますか？（ほかの PC で呼び出す内容が変わります）`)) return;
    const res = same ? await send("PUT", `/api/masters/formats/${same.id}`, { body, base_rev: same.rev })
      : await send("POST", "/api/masters/formats", { name, source: h.source, table: h.table, origin: h.origin, body });
    await afterWrite(res, `「${esc(name)}」を共有に置きました（${(res.data.parts || []).join("・")}）`);
    if (res.ok) { remember(F().places().slice(0, 1), res.data); paintButton(); }
  }
  async function afterWrite(res, okText) {
    try { await fetchList(); } catch (_) { /* 一覧は次に開いたとき */ }
    render();
    if (res.ok) say(okText);
    else if (res.status === 409 && res.data.kind === "conflict") say("開いたあとに、ほかの PC がこの書式を直しました。読み直したので、もう一度してください。", true);
    else say(esc(res.data.error || "保存できませんでした"), true);
  }

  async function open() {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; btn.setAttribute("aria-expanded", "true");
    TPA.dismissable(panel, close, { keep: btn });
    panel.innerHTML = '<p class="fm-loading">共有の書式を読んでいます…</p>';
    try { await fetchList(); render(); } catch (e) { panel.innerHTML = `<p class="fm-msg is-ng">${esc(e.message)}</p>`; return; }
    panel.querySelector(".fm-apply, #fmName")?.focus();
  }
  function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }

  function bind() {
    panel.addEventListener("change", (e) => {
      const x = e.target;
      if (x.name === "fmTo") { to = x.value; render(); return; }
      if (x.hasAttribute("data-all")) { F().places().filter((p) => !p.here).forEach((p) => (x.checked ? picked.add(p.key) : picked.delete(p.key))); render(); return; }
      if (x.dataset.key) { if (x.checked) picked.add(x.dataset.key); else picked.delete(x.dataset.key); render(); }
    });
    panel.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#fmName").value.trim();
      if (!name) { say("名前を入れてください", true); $("#fmName").focus(); return; }
      if (!busy) { busy = true; save(name).finally(() => { busy = false; }); }
    });
    panel.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]"); if (!b || busy) return;
      if (b.dataset.act === "undo") { if (undo) { F().undo(undo); remember(undo.map((u) => u.place), null); undo = null; paintButton(); render(); say("当てる前の表示に戻しました"); } return; }
      const li = b.closest(".fm-item"), f = li && list.items.find((x) => x.id === +li.dataset.id); if (!f) return;
      if (b.dataset.act === "apply") { applyOne(f); return; }
      if (b.dataset.act === "more") { const sub = li.querySelector(".fm-subs"), on = sub.hidden; sub.hidden = !on; b.setAttribute("aria-expanded", String(on)); return; }
      busy = true;
      try {
        if (b.dataset.act === "over" && confirm(`書式「${f.name}」を、いまの表示（${F().here().origin}）で上書きします。ほかの PC で呼び出す内容が変わります。よろしいですか？`)) {
          const res = await send("PUT", `/api/masters/formats/${f.id}`, { body: F().capture(), base_rev: f.rev });
          await afterWrite(res, `「${esc(f.name)}」を上書きしました`);
          if (res.ok) { remember(F().places().slice(0, 1), res.data); paintButton(); }
        } else if (b.dataset.act === "del" && confirm(`書式「${f.name}」を共有から消します（当てた所の表示はそのまま残ります）。よろしいですか？`)) {
          await afterWrite(await send("DELETE", `/api/masters/formats/${f.id}?rev=${f.rev}`), `「${esc(f.name)}」を消しました`);
        }
      } finally { busy = false; }
    });
  }

  /** 一覧の道具の行に入口を置く（lotlist.js の mount のあと）。元・設備が替わったら refresh で札を描き直す */
  function mount() {
    const row = $("#llColBtn")?.parentElement; if (!row || $("#llFormatBtn")) return;
    btn = Object.assign(document.createElement("button"), { id: "llFormatBtn", type: "button", className: "fm-entry" });
    btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "llFormatPanel");
    btn.innerHTML = '<span class="fm-key">書式</span><b class="fm-now"></b><i class="hd-caret" aria-hidden="true">▾</i>';
    row.insertBefore(btn, $("#llViewBtn"));
    panel = Object.assign(document.createElement("div"), { id: "llFormatPanel", className: "fm-panel", hidden: true });
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "共有の書式");
    row.parentElement.append(panel);
    btn.onclick = open;
    bind();
  }
  /** 元・設備・表が替わった: 札を描き直す（共有の一覧は、開いたとき・初めてだけ読む） */
  async function refresh() {
    if (!btn) return;
    to = "here"; picked.clear(); undo = null;
    if (!panel.hidden) close();
    try { await fetchList(); } catch (_) { paintButton(); }
  }
  window.LotListFormats = { mount, refresh, open };
})();
