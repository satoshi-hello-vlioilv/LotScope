/* マスタ管理の「アクセス権限」→「見出しのタブ」（版 3.58.0。利用者の要望 2026-10-28「表示できるタブを権限管理できるように。
   多くのタブが出てきてもコントロールしやすいように」。決め方: ui-proposals/2026-10-unify*）。
   決まりは 2 段（判定はサーバーの services/access.py の hidden_tabs の 1 か所。画面は表を出して置くだけ）:
     ① 区分の決まり … 表（行＝タブ〈画面・グループごとに畳める〉／列＝区分）の升を押して ✓ 出す ⇄ ✕ 出さない。開発者の列はいつも全部
     ② 人ごとの例外 … 右の列に「＋だれ（出す）・−だれ（出さない）」の札。札を押して替える・外す、＋ で足す（その人のアクセス権限の行に置く）
   多くのタブでも: 名前で探す・グループで畳む・グループの見出しの升で列をまとめて出す／出さない・出さない物だけに絞る。
   区分の決まりは下書きにして「保存」で 1 回に置く（PUT /api/masters/tabaccess）。人ごとの例外は押したときにその人の行へ置く。 */
window.MasterTabAccess = (M) => {
"use strict";
const { $, escapeHtml, emit, mstate, masterRequest, withLockWait, lockWaitText, boldName, readOnlyWhy, shareDown } = M;
const DEV = "開発者";
const FOLD_KEY = "tpa.ta.folded.v1";
let draft = null;           // {tab: [出さない区分]}（保存していない区分の決まり）
let saved = "";             // 読んだときの決まり（変えたかの見張り）
let query = "", onlyHidden = false;
const folded = () => new Set(TPA.local.get(FOLD_KEY, []) || []);
const dirty = () => draft != null && JSON.stringify(norm(draft)) !== saved;
const norm = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v.length).sort(([a], [b]) => a.localeCompare(b)));
TPA.unsaved.watch("master:tabaccess", { scope: "master", dirty: () => mstate.tab === "access" && mstate.accessMode === "tabs" && dirty(),
  label: "見出しのタブの決まり", discard: () => { draft = null; }, save: () => save() });

/** 人ごと ⇄ 見出しのタブ の切り替え（アクセス権限の道具の段の左） */
const segHtml = (on) => `<div class="ta-seg" role="tablist" aria-label="アクセス権限の見方">
  <button type="button" role="tab" data-ta-mode="people" aria-selected="${on === "people"}" class="${on === "people" ? "on" : ""}">人ごと</button>
  <button type="button" role="tab" data-ta-mode="tabs" aria-selected="${on === "tabs"}" class="${on === "tabs" ? "on" : ""}">見出しのタブ</button></div>`;
function bindSeg(root) {
  root.querySelectorAll("[data-ta-mode]").forEach((b) => { b.onclick = async () => {
    const want = b.dataset.taMode; if (want === (mstate.accessMode || "people")) return;
    if (want === "people" && dirty() && !(await TPA.unsaved.leave("master:tabaccess", "人ごとの表へ移る"))) return;
    mstate.accessMode = want; M.renderMasterTable();
  }; });
}
/** 人ごとの表の道具の段に切り替えを差す（master.js が人ごとの表を描くたびに呼ぶ） */
M.accessToolbar = () => {
  const tb = document.querySelector("#masterOverlay .master-toolbar");
  tb.querySelector(".ta-seg")?.remove();
  if (mstate.tab !== "access") return;
  tb.insertAdjacentHTML("afterbegin", segHtml("people"));
  bindSeg(tb);
};

async function load() {
  const [r, a] = await Promise.all([masterRequest("/api/masters/tabaccess", { cache: "no-store" }), masterRequest("/api/masters/access", { cache: "no-store" })]);
  if (!r.ok || !a.ok) throw new Error((r.data || {}).error || (a.data || {}).error || "読めませんでした");
  mstate.data.tabaccess = r.data;
  mstate.meta.access = a.data; mstate.data.access = a.data.items || [];
  saved = JSON.stringify(norm(r.data.rules));
  if (draft == null) draft = JSON.parse(JSON.stringify(r.data.rules));
}
M.renderTabAccess = async (notice = null) => {
  const box = $("#masterSettings");
  if (!mstate.data.tabaccess) box.innerHTML = '<p class="ps-loading">見出しのタブの決まりを読んでいます…</p>';
  try { await load(); } catch (e) { box.innerHTML = `<p class="ps-loading">読めませんでした: ${escapeHtml(e.message)}</p>`; return; }
  if (mstate.tab !== "access" || mstate.accessMode !== "tabs") return;
  paint(notice);
};

const groupsOf = (tabs) => {
  const out = [["画面", tabs.filter((t) => t.kind === "screen")], ["グループなし", tabs.filter((t) => t.kind !== "screen" && !t.group)]];
  [...new Set(tabs.filter((t) => t.group).map((t) => t.group))].forEach((g) => out.push([g, tabs.filter((t) => t.group === g)]));
  return out.filter(([, xs]) => xs.length);
};
const hidden = (key, role) => role !== DEV && (draft[key] || []).includes(role);
/** 人ごとの例外（アクセス権限の行の「タブの例外」）→ {タブ: [[人の名前, 出す|出さない, 行]]} */
function exceptions() {
  const out = {};
  (mstate.data.access || []).forEach((row) => {
    let ex = {};
    try { ex = JSON.parse(row["タブの例外"] || "{}") || {}; } catch (_) { ex = {}; }
    Object.entries(ex).forEach(([k, v]) => { (out[k] = out[k] || []).push([who(row), v, row]); });
  });
  return out;
}
const who = (row) => row["ログインID"] || (row["PC名"] ? `PC ${row["PC名"]}` : "（だれでも）");

function paint(notice = null) {
  const d = mstate.data.tabaccess, box = $("#masterSettings"), can = d.canEdit && !shareDown();
  const roles = [DEV, ...d.roles], ex = exceptions(), fold = folded(), q = query.trim();
  const hit = (t) => (!q || (TPA.wild.has(q) ? TPA.wild.test("contains", q, t.name) : t.name.toLowerCase().includes(q.toLowerCase())))
    && (!onlyHidden || d.roles.some((r) => hidden(t.key, r)) || (ex[t.key] || []).length);
  const nHidden = Object.values(draft).reduce((a, v) => a + v.length, 0), nEx = Object.values(ex).reduce((a, v) => a + v.length, 0);
  const cell = (t, r) => {
    if (r === DEV) return '<td class="ta-c"><span class="ta-ck lock" title="開発者はいつも全部のタブを見ます（決める人を締め出さない）">✓</span></td>';
    const off = hidden(t.key, r);
    return `<td class="ta-c"><button type="button" class="ta-ck ${off ? "off" : "on"}" data-ta-cell="${escapeHtml(t.key)}" data-role="${escapeHtml(r)}" aria-pressed="${!off}"${can ? "" : " disabled"}
      title="${escapeHtml(`${t.name} を ${r} に${off ? "出さない（押すと出す）" : "出す（押すと出さない）"}`)}">${off ? "✕" : "✓"}</button></td>`;
  };
  const exCell = (t) => `<td class="ta-ex">${(ex[t.key] || []).map(([name, v, row]) => `<button type="button" class="ta-chip ${v === "出す" ? "s" : "h"}" data-ta-ex="${escapeHtml(t.key)}" data-row="${row.id}"${can ? "" : " disabled"}
      title="${escapeHtml(`${name} だけ、区分（${row["権限区分"]}）の決まりと違って${v}。押して替える・外す`)}">${v === "出す" ? "＋" : "−"}${escapeHtml(name)}</button>`).join("")}`
    + (can ? `<button type="button" class="ta-add" data-ta-add="${escapeHtml(t.key)}" title="${escapeHtml(t.name)} を、ある人だけ出す・出さない">＋</button>` : "") + "</td>";
  const body = groupsOf(d.tabs).map(([g, xs]) => {
    const vis = xs.filter(hit); if (!vis.length) return "";
    const shut = fold.has(g) && !q;
    const gcell = (r) => {
      if (r === DEV) return '<td class="ta-c"></td>';
      const off = xs.filter((t) => hidden(t.key, r)).length;
      return `<td class="ta-c"><button type="button" class="ta-gall" data-ta-gall="${escapeHtml(g)}" data-role="${escapeHtml(r)}"${can ? "" : " disabled"}
        title="${escapeHtml(`${g} の ${xs.length} 個を ${r} に${off === xs.length ? "全部出す" : "全部出さない"}`)}">${off === 0 ? "全部 ✓" : off === xs.length ? "全部 ✕" : `✕ ${off}`}</button></td>`;
    };
    return `<tr class="ta-g"><th scope="rowgroup"><button type="button" class="ta-fold" data-ta-fold="${escapeHtml(g)}" aria-expanded="${!shut}">${shut ? "▸" : "▾"}</button>${escapeHtml(g)} <small>${xs.length}</small></th>${roles.map(gcell).join("")}<td></td></tr>`
      + (shut ? "" : vis.map((t) => `<tr${t.listed === false ? ' class="is-off"' : ""}><th scope="row" title="${escapeHtml(t.listed === false ? `${t.name}（見出しに出していないデータ元）` : t.name)}">${escapeHtml(t.name)}</th>${roles.map((r) => cell(t, r)).join("")}${exCell(t)}</tr>`).join(""));
  }).join("");
  box.innerHTML = `<section class="ta-page">
    <div class="ta-top">${segHtml("tabs")}
      <input type="search" class="ps-input ta-search" id="taSearch" value="${escapeHtml(query)}" placeholder="タブの名前で探す（* ? も）" aria-label="タブの名前で探す" autocomplete="off">
      <label class="ta-only"><input type="checkbox" id="taOnly"${onlyHidden ? " checked" : ""}> 出さない・例外のある物だけ</label>
      <span class="ta-sum">タブ ${d.tabs.length} 個・出さない <b>${nHidden}</b> か所・人ごとの例外 <b>${nEx}</b></span>
      <span class="ta-sp"></span>
      ${can ? `<button type="button" class="btn-primary" id="taSave"${dirty() ? "" : " disabled"}>保存</button>` : `<span class="ta-ro">${escapeHtml(readOnlyWhy("access"))}のため見るだけ</span>`}
    </div>
    <div class="ps-result${notice ? ` ${notice[0]}` : " hidden"}" id="taNotice" aria-live="polite">${notice ? notice[1] : ""}</div>
    <table class="ta-mx"><colgroup><col class="c-name">${roles.map(() => '<col class="c-role">').join("")}<col class="c-ex"></colgroup>
      <thead><tr><th>タブ</th>${roles.map((r) => `<th>${escapeHtml(r)}${r === DEV ? "<small>いつも全部</small>" : ""}</th>`).join("")}<th>人ごとの例外 <small>＋出す・−出さない</small></th></tr></thead>
      <tbody>${body}</tbody></table>
    ${q && !body ? `<p class="ps-hint">「${escapeHtml(q)}」に当たるタブはありません。</p>` : ""}
    <p class="ps-hint ta-foot">✓ 出す・✕ 出さない。出さないタブは、その人の見出しから外れ、一覧・集計・ダッシュボードのパネルでも読めません。
      あとから足したデータ元は、決めるまで全員に出ます。人ごとの例外は、区分の決まりより先に効きます（アクセス権限の行に置きます）。</p>
  </section>`;
  bind(box, can);
}
const say = (cls, html) => { const n = $("#taNotice"); if (!n) return; n.className = `ps-result ${cls}`; n.innerHTML = html; };
function bind(box, can) {
  bindSeg(box);
  const s = $("#taSearch");
  if (s) TPA.onText(s, (el) => { query = el.value; const at = el.selectionStart; paint(); const n = $("#taSearch"); if (n) { n.focus(); try { n.setSelectionRange(at, at); } catch (_) { /* 選べない */ } } });
  $("#taOnly").onchange = (e) => { onlyHidden = e.target.checked; paint(); };
  box.querySelectorAll("[data-ta-fold]").forEach((b) => { b.onclick = () => { const f = folded(), g = b.dataset.taFold; if (f.has(g)) f.delete(g); else f.add(g); TPA.local.set(FOLD_KEY, [...f]); paint(); }; });
  if (!can) return;
  const flip = (key, role, off) => { const set = new Set(draft[key] || []); if (off) set.add(role); else set.delete(role); draft[key] = mstate.data.tabaccess.roles.filter((r) => set.has(r)); };
  box.querySelectorAll("[data-ta-cell]").forEach((b) => { b.onclick = () => { flip(b.dataset.taCell, b.dataset.role, !hidden(b.dataset.taCell, b.dataset.role)); paint(); box.querySelector(`[data-ta-cell="${CSS.escape(b.dataset.taCell)}"][data-role="${CSS.escape(b.dataset.role)}"]`)?.focus(); }; });
  box.querySelectorAll("[data-ta-gall]").forEach((b) => { b.onclick = () => {
    const xs = groupsOf(mstate.data.tabaccess.tabs).find(([g]) => g === b.dataset.taGall)[1], r = b.dataset.role;
    const allOff = xs.every((t) => hidden(t.key, r));
    xs.forEach((t) => flip(t.key, r, !allOff)); paint();
  }; });
  $("#taSave").onclick = () => save();
  box.querySelectorAll("[data-ta-add]").forEach((b) => { b.onclick = () => addMenu(b.dataset.taAdd, b); });
  box.querySelectorAll("[data-ta-ex]").forEach((b) => { b.onclick = () => chipMenu(b.dataset.taEx, +b.dataset.row, b); });
}
async function save() {
  const d = mstate.data.tabaccess, rules = Object.fromEntries(d.tabs.map((t) => [t.key, draft[t.key] || []]));
  say("wait", "保存しています…");
  const res = await withLockWait(() => masterRequest("/api/masters/tabaccess", TPA.json("PUT", { rules, base_rev: d.revision })), (x) => say("wait", lockWaitText(x, "保存", boldName)));
  if (res.status === 409) { draft = null; await M.renderTabAccess(["ng", "開いたあとに、ほかの PC がタブの決まりを変えました。読み直したので、もう一度直してください。"]); return false; }
  if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした")); return false; }
  draft = null; emit("tpa:masters-changed");
  await M.renderTabAccess(["ok", "✓ 見出しのタブの決まりを保存しました。全員の PC で、次にマスタ管理を閉じたとき・開き直したときから効きます。"]);
  return true;
}
/** 人ごとの例外を置く（その人のアクセス権限の行の「タブの例外」） */
async function putException(row, key, value) {
  let ex = {};
  try { ex = JSON.parse(row["タブの例外"] || "{}") || {}; } catch (_) { ex = {}; }
  if (value) ex[key] = value; else delete ex[key];
  const body = { ...Object.fromEntries(["ログインID", "PC名", "権限区分", "マスタ編集", "有効", "備考"].map((k) => [k, row[k] || ""])), "タブの例外": ex, base_rev: row.rev };
  const res = await withLockWait(() => masterRequest(`/api/masters/access/${row.id}`, TPA.json("PUT", body)), (x) => say("wait", lockWaitText(x, "保存", boldName)));
  if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "置けませんでした")); return; }
  emit("tpa:masters-changed");
  const name = (mstate.data.tabaccess.tabs.find((t) => t.key === key) || {}).name || key;
  await M.renderTabAccess(["ok", value ? `✓ ${escapeHtml(who(row))} だけ「${escapeHtml(name)}」を${value}にしました。` : `✓ ${escapeHtml(who(row))} の「${escapeHtml(name)}」の例外を外しました（区分の決まりに戻ります）。`]);
}
function addMenu(key, at) {
  const r = at.getBoundingClientRect(), has = new Set((exceptions()[key] || []).map(([, , row]) => row.id));
  const people = (mstate.data.access || []).filter((row) => !has.has(row.id) && row["権限区分"] !== DEV);
  TPA.menu({ x: r.left, y: r.bottom + 2, head: "だれだけ例外にするか", items: people.length ? people.flatMap((row) => [
    { label: `${who(row)}（${row["権限区分"]}）だけ出す`, icon: "＋", run: () => putException(row, key, "出す") },
    { label: `${who(row)}（${row["権限区分"]}）だけ出さない`, icon: "−", run: () => putException(row, key, "出さない") },
  ]) : [{ label: "例外にできる人がいません（人ごとの表で足してください）", disabled: true }] });
}
function chipMenu(key, id, at) {
  const row = (mstate.data.access || []).find((x) => x.id === id); if (!row) return;
  const r = at.getBoundingClientRect();
  TPA.menu({ x: r.left, y: r.bottom + 2, head: `${who(row)}（${row["権限区分"]}）`, items: [
    { label: "だけ出す", icon: "＋", run: () => putException(row, key, "出す") },
    { label: "だけ出さない", icon: "−", run: () => putException(row, key, "出さない") },
    { sep: true },
    { label: "例外を外す（区分の決まりに戻す）", icon: "↺", run: () => putException(row, key, "") },
  ] });
}
};
