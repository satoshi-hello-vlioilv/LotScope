// 改良「品質データもほかのデータ元と同じ汎用のデータに」（利用者の改良依頼 2026-11-17 の 2「品質データ（データ元の 1 つ）も、ほかのデータ元と同じ
// 汎用のデータとして扱いたい。品質データは消せないが、グループに入れたり、移したりはできるようにしたい」）の案（回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面（ui-harness.mjs の状態。master-sources-many の続きに qg-menu 〜 qg-off を足した）: データ元が多い形（台帳 8・工程 2・マスタ 2・結合した表 1）で、
//   master-sources-many（データ元の 1 行 1 件の表）→ qg-menu（品質の行を右クリック）→ qg-moved（メニューの「「工程」へ移す」を押した後。押せないときは Esc）
//   → qg-edit（品質の「変える…」の「名前とタブ」）→ qg-tab（見出しの「工程」のグループのタブ）→ qg-tab-lot（その札の「品質」を押した所）
//   → qg-tabmenu（札の「品質」〈無ければ最初の札〉を右クリック）。
//
//   TPA_UI_EXE=…/desktop/target/debug/examples/ui_serve TPA_UI_PROGRAM=…/program node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-qualitygroup.mjs \
//     --from master --states master-sources-many,qg-menu,qg-moved,qg-edit,qg-tab,qg-tab-lot,qg-tabmenu      （--view 1536x864・--view 1280x720 でも）
//
// 今（版 3.121.0）の品質の特別扱い（画面 master-sources.js・app.js・lotlist.js と窓 bundle.rs・sources_write.rs。2026-11-qualitygroup.json の findings_now）:
//   ⠿ が無く引けない・ほかの行を品質の前後へ落とせない・右クリックの上へ／下へ／「…」へ移す／新しいグループへ が押せない・欄にグループの項目が無い・
//   窓がグループを空にして返し、並びはいつも頭（bundle.rs の split_off(2)）・見出しの「品質」は決まったタブで、グループのタブの札に入れられない。
//
// どの案も中身は同じ（common_build）: 品質（key lot）をグループに入れられるようにする。窓は sources.groupable に lot を足し（sources_write.rs が
//   グループを残す）、並びを「頭に固定」から外す（bundle.rs の rest＝split_off(2) を、実績だけ固定に）。画面は canHide とは別に
//   movable（lot も動かせる。消せない・タブを外せないはそのまま）を持ち、⠿・引く・落とす・右クリック・Alt＋↑↓・欄のグループを lot にも。
//   見出しは、品質がグループに入ったら決まったタブ「品質」を出さず、そのグループのタブの札に「品質」を並べる（押すと品質の一覧。Alt＋1 もそのタブ）。
//   案の画面では、窓の答え（GET /api/sources）を頁の中で直して、品質のグループと並びを返す（sessionStorage。窓は変えない）。
//   案ごとに違うのは、「消せない・いつも出す」の見せ方と、グループへ入れる・移す手の置き場と流れ。

/* ------------------------------------------------------------------ 共通の部品（頁の中で動く。window.QG） */
function lib() {
  if (window.QG) return;
  const Q = (window.QG = {});
  const KEY = "qg.lotGroup", NEAR = "qg.lotNear";
  Q.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  Q.group = () => { try { return sessionStorage.getItem(KEY) || ""; } catch (_) { return ""; } };
  Q.keep = (fn, ms = 150) => { const t = () => { try { fn(); } catch (e) { console.warn("案:", e.message); } }; t(); setInterval(t, ms); };
  Q.data = null;        // 窓の答え（GET /api/sources。master.js の mstate は 1 つの関数に包まれていて外から見えないので、答えを写して持つ）
  Q.items = () => (Q.data && Q.data.items) || [];
  Q.can = () => !!(Q.data && Q.data.canEdit);
  Q.lotName = () => ((Q.items().find((x) => x.key === "lot") || (state.sources || []).find((x) => x.key === "lot")) || {}).name || "品質";
  Q.BUILTIN = ["lot", "work", "wip", "sch"];
  Q.LOCK = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><rect x="2" y="5.2" width="8" height="5.6" rx="1.2" fill="currentColor"/><path d="M3.9 5.2V3.8a2.1 2.1 0 0 1 4.2 0v1.4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  /* 窓の答えを直す（作るときは窓が lot のグループと並びを持つ） */
  const of = window.fetch.bind(window);
  window.fetch = async (u, o) => {
    const url = typeof u === "string" ? u : (u && u.url) || "";
    const method = ((o && o.method) || "GET").toUpperCase();
    if (method === "GET" && /^\/api\/sources(\?|$)/.test(url)) {
      const r = await of(u, o);
      const d = await r.clone().json().catch(() => null);
      const g = Q.group();
      if (d && d.items) Q.data = d;
      if (!d || !d.items || !g) return r;
      const lot = d.items.find((x) => x.key === "lot");
      if (!lot) return r;
      lot.group = g; lot.groupSet = g;
      const rest = d.items.filter((x) => x !== lot);
      let near = null; try { near = JSON.parse(sessionStorage.getItem(NEAR) || "null"); } catch (_) { /* 撮るだけ */ }
      let at = near ? rest.findIndex((x) => x.key === near[0]) + (near[1] ? 1 : 0) : -1;
      if (at < 0) { const last = rest.map((x) => x.group || "").lastIndexOf(g); at = last >= 0 ? last + 1 : rest.length; }
      rest.splice(at, 0, lot);
      d.items = rest;
      return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return of(u, o);
  };

  /* 動かす: lot はグループと並びを覚え、データ元の頁を読み直す（作るときは master-sources.js の moveTo が lot も受ける。
     案の頁では master-sources.js の中が外から見えないので、タブを行き来して読み直させ、知らせの帯を出す） */
  Q.moveHook = null;     // 案が足す（opt を直す）
  Q.move = async (opt = {}) => {
    if (Q.moveHook) opt = Q.moveHook(opt) || opt;
    const { group = "", near = null, after = false } = opt;
    try { sessionStorage.setItem(KEY, group); sessionStorage.setItem(NEAR, near ? JSON.stringify([near, after]) : ""); } catch (_) { /* 撮るだけ */ }
    document.dispatchEvent(new CustomEvent("tpa:sources-changed", { detail: { key: "lot" } }));
    const text = `✓ ${Q.esc(Q.lotName())}を${group ? `「${Q.esc(group)}」` : "グループなし"}の${near ? "その位置" : "最後"}へ動かしました。見出しのタブの並びも同じになります（${Q.esc(Q.lotName())}は消せません）。`;
    document.querySelector('#masterTabs [data-tab="equipment"]')?.click();
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector('#masterTabs [data-tab="sources"]')?.click();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const n = document.getElementById("srNotice");
      if (n && document.querySelector('#masterSettings tr.sr-row[data-key="lot"]')) { n.className = "ps-result ok"; n.innerHTML = text; break; }
    }
  };

  /* 右クリックのメニュー: 品質も上へ・下へ・グループへ移す（タブを外す・消すは今のまま押せない） */
  const om = TPA.menu.bind(TPA);
  Q.menuHook = null;     // 案が足す（opts を受けて直す）
  TPA.menu = (opts) => {
    if (opts && opts.head === `データ元「${Q.lotName()}」`) {
      const items = Q.items(), s = items.find((v) => v.key === "lot") || {};
      const mates = items.filter((v) => (v.group || "") === (s.group || "") && v.key !== "work"), i = mates.findIndex((v) => v.key === "lot");
      opts.items = opts.items.filter(Boolean).map((it) => {
        if (it.label === "上へ") return { ...it, disabled: i <= 0, why: i <= 0 ? "グループのいちばん上です" : "", run: () => Q.move({ group: s.group || "", near: mates[i - 1].key, after: false }) };
        if (it.label === "下へ") return { ...it, disabled: i >= mates.length - 1, why: i >= mates.length - 1 ? "グループのいちばん下です" : "", run: () => Q.move({ group: s.group || "", near: mates[i + 1].key, after: true }) };
        if (it.icon === "→") { const g = (it.label.match(/^「(.*)」へ移す$/) || [])[1] || ""; return { ...it, disabled: false, run: () => Q.move({ group: g }) }; }
        if (it.icon === "←") return { ...it, run: () => Q.move({ group: "" }) };
        if (it.label === "新しいグループへ…") return { ...it, disabled: false, run: () => { const n = prompt("グループの名前"); if (n) Q.move({ group: n.trim() }); } };
        return it;
      });
    }
    if (Q.menuHook) Q.menuHook(opts);
    return om(opts);
  };

  /* 品質の行に ⠿（引ける）。落とす先は今の行・見出しの手（moveTo が lot を受ける） */
  Q.keep(() => {
    const tr = document.querySelector('#masterSettings tr.sr-row[data-key="lot"]');
    if (!tr || tr.dataset.qg || !Q.can()) return;
    tr.dataset.qg = "1";
    tr.querySelector(".sr-gp").innerHTML = '<span class="sr-grip" title="つかんで並べ替え・グループへ移す（選んで Alt＋↑↓ でも）" tabindex="0" data-sr-grip>⠿</span>';
    tr.draggable = true;
    tr.addEventListener("dragstart", (e) => { tr.classList.add("is-drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "lot"); });
    tr.addEventListener("dragend", () => { tr.classList.remove("is-drag"); });
  });

  /* 欄の「名前とタブ」にグループ（ほかの元と同じ項目） */
  Q.keep(() => {
    const sb = document.querySelector('#masterSettings .sr-card.is-open[data-key="lot"] .sr-sec[data-sec="name"] .sr-sb');
    if (!sb || sb.querySelector("[data-qg-group]")) return;
    const groups = [...new Set(Q.items().map((x) => x.group).filter(Boolean))];
    const hint = sb.querySelector(".ps-hint");
    if (hint && Q.group()) hint.textContent = `見出しの「${Q.group()}」のタブの中に、札で並びます（${Q.lotName()}はアプリの決まったデータ元なので、消せません・タブはいつも出ます）。`;
    else if (hint) hint.textContent = `見出しのタブ「${Q.lotName()}」はいつも出ます（消せません）。グループに入れると、そのグループのタブの中に札で並びます。`;
    sb.insertAdjacentHTML("beforeend", `<label data-qg-group><span>グループ（空ならグループなし）</span><input class="ps-input" data-sr="group" value="${Q.esc(Q.group())}" list="qgGroups" maxlength="24" placeholder="例: 台帳"><datalist id="qgGroups">${groups.map((g) => `<option value="${Q.esc(g)}">`).join("")}</datalist></label>`);
  });

  /* 見出し: 品質がグループに入ったら、決まったタブ「品質」を出さず、グループのタブの札に「品質」 */
  Q.members = (g) => (state.sources || []).filter((d) => d.listed && d.group === g && (d.key === "lot" || (d.api || "").startsWith("/api/src/")));
  Q.chip = (m, on) => m.key === "lot"
    ? `<button type="button" role="tab" class="eq-chip qg-lotchip" data-equip="list" aria-selected="${on}" tabindex="${on ? 0 : -1}" title="${Q.esc(Q.lotName())}（アプリの決まったデータ元。消せません）">${Q.esc(m.name)}</button>`
    : `<button type="button" role="tab" class="eq-chip" data-equip="${Q.esc(m.screen)}" aria-selected="false" tabindex="-1" title="${Q.esc(m.name)}">${Q.esc(m.name)}</button>`;
  Q.barHtml = (g, lotOn) => `<span class="eq-lab" id="llEquipLab">${Q.esc(g)}</span><div class="eq-chips" role="tablist" aria-labelledby="llEquipLab">${Q.members(g).map((m) => Q.chip(m, lotOn)).join("")}</div>`
    + '<button type="button" class="eq-manage" data-ll-settings title="データ元を足す・外す・並べる・グループを変える・ほかのデータと結合する（マスタ管理の「データ元」）">データ元を管理…</button>';
  Q.keep(() => {
    const g = Q.group(), tl = document.getElementById("tabList");
    if (tl) tl.classList.toggle("qg-gone", !!g);
    if (!g) return;
    const gt = document.querySelector(`.screen-tabs [data-screen="grp:${CSS.escape(g)}"]`);
    if (gt && state.screen === "list" && gt.getAttribute("aria-selected") !== "true") gt.setAttribute("aria-selected", "true");
    const bar = document.getElementById("llEquipBar");
    if (!bar) return;
    if (bar.dataset.kind === "grp" && (bar.querySelector("#llEquipLab") || {}).textContent === g && !bar.querySelector('[data-equip="list"]')) {
      const cur = (bar.querySelector('.eq-chip[aria-selected="true"]') || {}).dataset?.equip;
      bar.innerHTML = Q.barHtml(g, false);
      if (cur) bar.querySelector(`[data-equip="${CSS.escape(cur)}"]`)?.setAttribute("aria-selected", "true");
    }
    if (state.screen === "list" && (bar.hidden || bar.dataset.kind !== "qg")) {
      bar.hidden = false; bar.dataset.kind = "qg"; bar.innerHTML = Q.barHtml(g, true);
    }
  });
  document.addEventListener("click", (e) => {
    const c = e.target.closest && e.target.closest("#llEquipBar .eq-chip");
    if (!c || !Q.group()) return;
    if (c.dataset.equip === "list") { e.stopPropagation(); e.preventDefault(); showScreen("list"); return; }
    if (document.getElementById("llEquipBar").dataset.kind === "qg") { e.stopPropagation(); e.preventDefault(); document.dispatchEvent(new CustomEvent("tpa:pick-master", { detail: c.dataset.equip })); }
  }, true);
}

const BASE_CSS = `
.qg-gone{display:none!important}
`;

/* ------------------------------------------------------------------ A ほかの元と同じ行に（⠿・メニュー・欄のグループ。それだけ） */
function propA() { /* 共通の部品だけ */ }

/* ------------------------------------------------------------------ B 「標準・消せない」を錠の印でそろえる（見せ方） */
function propB() {
  const Q = window.QG;
  Q.keep(() => {
    for (const key of Q.BUILTIN) {
      const tr = document.querySelector(`#masterSettings tr.sr-row[data-key="${key}"]`);
      if (!tr || tr.dataset.qgb) continue;
      tr.dataset.qgb = "1";
      const fx = tr.querySelector(".sr-fixed");
      if (fx) fx.outerHTML = `<span class="sr-sw on qg-locksw" role="switch" aria-checked="true" aria-disabled="true" title="アプリの決まったタブなので、いつも出ます（出す人はアクセス権限の「見出しのタブ」で決めます）"><i></i><span>出す</span>${Q.LOCK}</span>`;
      const nm = tr.querySelector(".sr-nm b");
      if (nm) nm.insertAdjacentHTML("afterend", `<span class="qg-std" title="アプリの標準のデータ元です。消せません（グループに入れる・移す・並べるはほかの元と同じ）">${Q.LOCK}標準</span>`);
    }
  });
}
const CSS_B = `
.qg-locksw{cursor:default} .qg-locksw i{background:#8fb5b1!important} .qg-locksw span{color:#3f6461!important;font-weight:700}
.qg-locksw svg{color:#6f7f8b;margin-left:-2px}
.qg-std{display:inline-flex;align-items:center;gap:3px;margin-left:8px;padding:1px 7px;border-radius:999px;background:#eef2f5;color:#4f5d69;font-size:11.5px;font-weight:700;vertical-align:middle}
`;

/* ------------------------------------------------------------------ C 「グループ」の列で選ぶ（引かずに 1 手） */
function propC() {
  const Q = window.QG;
  Q.keep(() => {
    const tb = document.querySelector("#masterSettings table.sr-table");
    if (!tb || tb.dataset.qgc) return;
    tb.dataset.qgc = "1";
    const can = Q.can();
    const groups = [...new Set(Q.items().map((x) => x.group).filter(Boolean))];
    tb.querySelector("colgroup col.c-sw")?.insertAdjacentHTML("afterend", '<col class="c-qgg">');
    tb.querySelector("thead th:nth-child(5)")?.insertAdjacentHTML("afterend", "<th>グループ</th>");
    tb.querySelectorAll("td[colspan]").forEach((td) => { td.colSpan = td.colSpan + 1; });
    tb.querySelectorAll("tr.sr-row").forEach((tr) => {
      const s = Q.items().find((x) => x.key === tr.dataset.key) || {};
      const fixed = s.key === "work";
      const cell = fixed || s.kind === "view" ? `<td class="qg-gc"><span class="qg-gnone" title="${fixed ? "実績は設備ごとのタブがあるので、グループに入れません" : "結合した表は元と同じグループに並びます"}">—</span></td>`
        : `<td class="qg-gc"><select class="qg-gsel" data-qg-g="${Q.esc(s.key)}" aria-label="${Q.esc(s.name)}のグループ"${can ? "" : " disabled"}><option value="">なし</option>${groups.map((g) => `<option${g === (s.group || "") ? " selected" : ""}>${Q.esc(g)}</option>`).join("")}<option value="+">＋ 新しいグループ…</option></select></td>`;
      tr.children[4].insertAdjacentHTML("afterend", cell);
    });
    tb.querySelectorAll("[data-qg-g]").forEach((sel) => {
      sel.onchange = () => {
        const key = sel.dataset.qgG, v = sel.value;
        if (key !== "lot") return;       // 案の頁では品質だけ動かす（ほかの元は今の右クリック・⠿ と同じ道で作る）
        if (v === "+") { const n = prompt("グループの名前"); if (n) Q.move({ group: n.trim() }); } else Q.move({ group: v });
      };
    });
  });
}
const CSS_C = `
.sr-table col.c-qgg{width:96px}
.qg-gsel{height:26px;width:88px;max-width:88px;border:1px solid #c9d3dc;border-radius:6px;background:#fff;font:inherit;font-size:12px;color:var(--ink);padding:0 4px}
.qg-gnone{color:#8d9ba6;font-size:12px;padding-left:8px}
`;

/* ------------------------------------------------------------------ D 見出しのタブ・札からもグループへ入れる・出す（流れの変え方） */
function propD() {
  const Q = window.QG;
  const groupsOf = () => [...new Set((state.sources || []).map((x) => x.group).filter(Boolean))];
  const menuFor = (key, x, y) => {
    const s = (state.sources || []).find((d) => d.key === key || d.screen === key);
    if (!s) return;
    const g = s.key === "lot" ? Q.group() : s.group || "";
    TPA.menu({ x, y, head: `タブ「${s.name}」`, items: [
      { group: "グループ" },
      ...groupsOf().filter((x) => x !== g).map((x) => ({ label: `「${x}」へ移す`, icon: "→", run: () => {} })),
      ...(g ? [{ label: `「${g}」から出す（1 つのタブに）`, icon: "←", run: () => {} }] : []),
      { label: "新しいグループへ…", icon: "＋", run: () => {} },
      { sep: true },
      { label: "データ元で直す…", icon: "✎", run: () => window.openMasterAt && window.openMasterAt("sources") },
      ...(s.key === "lot" ? [{ foot: `${s.name}はアプリの決まったデータ元なので、消す・タブを外すはできません` }] : []),
    ] });
  };
  document.addEventListener("contextmenu", (e) => {
    const c = e.target.closest && e.target.closest("#llEquipBar[data-kind='grp'] .eq-chip, #llEquipBar[data-kind='qg'] .eq-chip, .screen-tabs .screen-tab[data-screen^='src:'], .screen-tabs #tabList");
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    const r = c.getBoundingClientRect();
    menuFor(c.dataset.equip === "list" || c.id === "tabList" ? "lot" : c.dataset.equip || c.dataset.screen, r.left, r.bottom + 4);
  }, true);
  /* 札の帯に「右クリックでグループへ」の添え書き */
  Q.keep(() => {
    const bar = document.getElementById("llEquipBar");
    if (!bar || bar.hidden || !/^(grp|qg)$/.test(bar.dataset.kind || "") || bar.querySelector(".qg-dhint")) return;
    bar.querySelector(".eq-manage")?.insertAdjacentHTML("beforebegin", '<span class="qg-dhint" title="タブ・札を右クリックすると、グループへ移す・出すができます">右クリックでグループへ移す・出す</span>');
  });
}
const CSS_D = `
.qg-dhint{align-self:center;margin-left:auto;margin-right:8px;font-size:12px;color:#6f7f8b;white-space:nowrap}
`;

/* ------------------------------------------------------------------ E 行を選んで、上の帯の「グループへ移す ▾」（まとめて。右クリックした行も選ぶ） */
function propE() {
  const Q = window.QG;
  const sel = (Q.sel = Q.sel || new Set());
  const paintBar = () => {
    const top = document.querySelector("#masterSettings .sr-top");
    if (!top) return;
    let bar = document.querySelector("#masterSettings .qg-ebar");
    if (!bar) { top.insertAdjacentHTML("afterend", '<div class="qg-ebar" aria-live="polite"></div>'); bar = document.querySelector("#masterSettings .qg-ebar"); }
    const names = Q.items().filter((x) => sel.has(x.key)).map((x) => x.name);
    const groups = [...new Set(Q.items().map((x) => x.group).filter(Boolean))];
    bar.classList.toggle("is-on", names.length > 0);
    bar.innerHTML = names.length
      ? `<b>${names.length} 件を選んでいます</b><span class="qg-enames">${Q.esc(names.join("・"))}</span><label>グループへ移す <select class="qg-esel"><option value="" disabled selected>選ぶ</option>${groups.map((g) => `<option>${Q.esc(g)}</option>`).join("")}<option value="-">グループから出す</option><option value="+">＋ 新しいグループ…</option></select></label><button type="button" class="sr-gren qg-eclear">選ぶのをやめる</button>`
      : '<span class="qg-ehint">行の □ を選ぶと（右クリックした行も）、まとめてグループへ移せます</span>';
    bar.querySelector(".qg-eclear")?.addEventListener("click", () => { sel.clear(); document.querySelectorAll("#masterSettings [data-qg-ck]").forEach((c) => { c.checked = false; }); paintBar(); });
    const s = bar.querySelector(".qg-esel");
    if (s) s.onchange = async () => { const v = s.value; if (sel.has("lot")) await Q.move({ group: v === "-" ? "" : v }); sel.clear(); };
  };
  Q.keep(() => {
    const tb = document.querySelector("#masterSettings table.sr-table");
    if (!tb) return;
    if (!document.querySelector("#masterSettings .qg-ebar")) paintBar();
    tb.querySelectorAll("tr.sr-row").forEach((tr) => {
      if (tr.dataset.qge) return;
      tr.dataset.qge = "1";
      const s = Q.items().find((x) => x.key === tr.dataset.key) || {};
      if (s.key === "work" || s.kind === "view") return;
      tr.querySelector(".sr-gp").insertAdjacentHTML("afterbegin", `<input type="checkbox" class="qg-ck" data-qg-ck="${Q.esc(s.key)}" aria-label="${Q.esc(s.name)}を選ぶ"${sel.has(s.key) ? " checked" : ""}>`);
      tr.querySelector("[data-qg-ck]").onchange = (e) => { if (e.target.checked) sel.add(s.key); else sel.delete(s.key); paintBar(); };
      tr.addEventListener("contextmenu", () => { sel.add(s.key); const c = tr.querySelector("[data-qg-ck]"); if (c) c.checked = true; paintBar(); }, true);
    });
  });
}
const CSS_E = `
.sr-table col.c-gp{width:46px}
.sr-gp{white-space:nowrap}
.qg-ck{width:14px;height:14px;margin:0 4px 0 0;vertical-align:-2px;accent-color:#2f6f8f}
.qg-ebar{display:flex;align-items:center;gap:10px;min-height:34px;margin:0 0 8px;padding:4px 12px;border-radius:8px;background:#f4f7fa;border:1px dashed #cfd8e0;font-size:12.5px;color:#4f5d69}
.qg-ebar.is-on{background:#e8f2f8;border:1px solid #a9c8dc;color:var(--ink)}
.qg-ebar .qg-enames{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3d4b57}
.qg-ebar label{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-weight:700;white-space:nowrap}
.qg-esel{height:28px;border:1px solid #9fbdd1;border-radius:6px;background:#fff;font:inherit;font-size:12.5px;padding:0 6px}
`;

/* ------------------------------------------------------------------ F 品質は入ったグループの頭に（グループのタブは品質から開く。階層） */
function propF() {
  const Q = window.QG;
  // 並び: グループへ入れたら、そのグループの頭（near が無いとき）
  Q.moveHook = (opt) => {
    if (opt.group && !opt.near) {
      const first = Q.items().find((x) => x.key !== "lot" && (x.group || "") === opt.group);
      if (first) return { ...opt, near: first.key, after: false };
    }
    return opt;
  };
  Q.keep(() => {
    const tr = document.querySelector('#masterSettings tr.sr-row[data-key="lot"]');
    if (!tr || !Q.group() || tr.querySelector(".qg-head")) return;
    tr.querySelector(".sr-nm b")?.insertAdjacentHTML("afterend", '<span class="qg-head" title="グループのタブを開くと、まずこの元を出します">グループの頭</span>');
  });
  Q.keep(() => {
    const bar = document.getElementById("llEquipBar"), c = bar && bar.querySelector(".qg-lotchip");
    if (!c || c.querySelector(".qg-star")) return;
    c.insertAdjacentHTML("afterbegin", '<i class="qg-star" aria-hidden="true">★</i>');
    c.title += "\nグループのタブを開くと、まずここを出します";
  });
  // 見出しのグループのタブを押したら品質から（撮る状態 qg-tab は showScreen("grp:…") で開く）
  const ss = window.showScreen;
  window.showScreen = function (name, opts) {
    if (Q.group() && name === `grp:${Q.group()}` && !window.__qgFromChip) return ss("list", opts);
    return ss(name, opts);
  };
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#llEquipBar .eq-chip:not(.qg-lotchip)")) { window.__qgFromChip = true; setTimeout(() => { window.__qgFromChip = false; }, 600); } }, true);
}
const CSS_F = `
.qg-head{display:inline-block;margin-left:8px;padding:0 7px;border-radius:999px;background:#eaf1f7;color:#2f5d7c;font-size:11.5px;font-weight:700;vertical-align:1px}
.qg-star{font-style:normal;color:#c28a00;margin-right:4px;font-size:11px}
`;

const S = (fn) => `(${lib})(); if (!window.__qgP) { window.__qgP = 1; (${fn})(); }`;
export const PROPOSALS = [
  {
    key: "A", name: "ほかの元と同じ行に（⠿・右クリック・欄のグループ）", css: BASE_CSS, ops: [["script", S(propA)]],
    direction: "減らし方（品質だけの違いを、消す・タブを外す の 2 つに減らす）",
  },
  {
    key: "B", name: "標準の元に「錠・標準」の印をそろえる（消せない・いつも出すを形で）", css: BASE_CSS + CSS_B, ops: [["script", S(propB)]],
    direction: "見せ方（消せない・いつも出すを、同じ形のスイッチと錠の印で）",
  },
  {
    key: "C", name: "表に「グループ」の列（選ぶだけで入れる・移す）", css: BASE_CSS + CSS_C, ops: [["script", S(propC)]],
    direction: "置き場（グループを行の中の 1 つの欄に。引かずに 1 手）",
  },
  {
    key: "D", name: "見出しのタブ・札の右クリックからもグループへ", css: BASE_CSS + CSS_D, ops: [["script", S(propD)]],
    direction: "流れの変え方（使っている所＝見出しから入れる・出す）",
  },
  {
    key: "E", name: "行を選んで、上の帯の「グループへ移す ▾」（まとめて）", css: BASE_CSS + CSS_E, ops: [["script", S(propE)]],
    direction: "流れの変え方・減らし方（選んでまとめて。右クリックした行も選ぶ）",
  },
  {
    key: "F", name: "品質は入ったグループの頭に（グループのタブは品質から開く）", css: BASE_CSS + CSS_F, ops: [["script", S(propF)]],
    direction: "階層（主の元を頭に。グループのタブを開くと品質）",
  },
];
