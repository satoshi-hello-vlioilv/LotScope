/* マスタ管理の「データ元」（版 3.36.0。services/data_sources.py・routes/sources.py。決め方: ui-proposals/2026-10-sources*）。
   アプリが読む共有のデータ（品質データ・作業実績・仕掛・足した元）を 1 列のカードで見せ、場所・表・設備の列・見出しのタブを直す。
   - カードには場所の全部（ファイル名は太字）・状態（写した時刻・行の数）・表・設備の列・見出しのタブ。カードを押す（か「変える…」）と、
     そのカードが直す欄に変わる（要約と欄を 2 度出さない）
   - 品質データの場所は参照先の lot_list.source・lot_list.table（PUT /api/settings/<項目>）。直すのはここだけ（参照先には出さない）。
     作業実績のフォルダは「作業実績」のタブで直す（探すと一緒に）
   - 仕掛・足した元はこのマスタ（PUT /api/sources/<キー>・POST /api/sources で足す・DELETE で消す〈仕掛は既定に戻す〉）
   master.js の部品（mstate・masterRequest・withLockWait・canWrite・shareDown など）は、master.js が読み終えたときに渡す
   （master.js は 1 つの関数に包まれているため。このファイルは master.js より前に読む）。 */
window.MasterSources = (M) => {
"use strict";
const { $, escapeHtml, emit, MASTER_DEFS, mstate, masterRequest, withLockWait, lockWaitText, boldName, readOnlyWhy,
  shareDown, goTab, ensureTabLoaded, saveBy } = M;
/* ナビは定義の順に見出しを作るので、「つなぎ先」の参照先・作業実績の後ろへ差し込む（後ろの定義をいったん外して付け直す） */
(() => {
  const keys = Object.keys(MASTER_DEFS), at = keys.indexOf("worklog") + 1, rest = keys.slice(at).map((k) => [k, MASTER_DEFS[k]]);
  rest.forEach(([k]) => delete MASTER_DEFS[k]);
  MASTER_DEFS.sources = { name: "data_sources", label: "データ元", group: "つなぎ先", api: "/api/sources", custom: true, admin: true,
    render: () => renderSources() };
  rest.forEach(([k, v]) => { MASTER_DEFS[k] = v; });
})();
mstate.data.sources = null;
let openKey = null;     // いま直す欄に変えているカード（"+" は足す欄）
let openSnap = "";      // 開いたときの欄の値（保存していない変更の見張り。版 3.43.0）
const formNow = () => JSON.stringify([...document.querySelectorAll("#masterSettings .sr-card.is-open [data-sr]")].map((x) => x.value));
const srDirty = () => mstate.tab === "sources" && openKey != null && !!document.querySelector("#masterSettings .sr-card.is-open [data-sr]") && formNow() !== openSnap;
TPA.unsaved.watch("master:sources", { scope: "master", dirty: srDirty, discard: () => { openKey = null; },
  label: () => (openKey === "+" ? "データ元を足す欄" : `データ元「${((mstate.data.sources || { items: [] }).items.find((x) => x.key === openKey) || {}).name || openKey}」の欄`),
  save: () => saveBy("#masterSettings .sr-card.is-open [data-sr-save]", srDirty, "#masterSettings .sr-card.is-open [data-sr-result]") });

const sepOf = (p) => (String(p).includes("\\") ? "\\" : "/");
const whereOf = (s) => (s.kind === "folder" ? s.place + sepOf(s.place) + (s.pattern || "") : s.place);
/* 場所の全部。ファイル名（最後の区切りの後ろ）を太字に */
const fullPath = (p) => {
  const s = String(p || ""), i = s.search(/[^\\/]+$/);
  return `<span class="sr-path">${i < 0 ? escapeHtml(s) || "（決まっていません）" : escapeHtml(s.slice(0, i)) + `<b>${escapeHtml(s.slice(i))}</b>`}</span>`;
};
const when = (sec) => { const d = new Date(sec * 1000), p = TPA.pad2; return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
/* 状態: 写した時刻と行の数（言葉で）。点の色だけに頼らない */
function stateOf(s) {
  const m = s.mirror;
  if (s.kind === "folder") return `<span class="sr-state ok"><i></i>設備 ${s.equipCount != null ? s.equipCount : "-"} 台を設備ごとに写す</span>`;
  if (!m || !m.mirrored) return '<span class="sr-state"><i></i>まだ開いていません（開くと写します）</span>';
  if (m.unreachable) return `<span class="sr-state ng"><i></i>届きません・写した ${when(m.copiedAt || m.at)} の物で見ています</span>`;
  return `<span class="sr-state ok"><i></i>写した ${when(m.copiedAt || m.at)}${s.rows != null ? `・${s.rows.toLocaleString()} 行` : ""}</span>`;
}
const tabOf = (s) => (s.screen === "list" ? "品質異常" : s.screen === "work" ? "作業実績" : s.listed ? s.name : "出さない");
const roleChip = (s) => (s.name.includes(s.role) ? "" : `<span class="sr-role">${escapeHtml(s.role)}</span>`);

async function renderSources({ notice = null } = {}) {
  const box = $("#masterSettings");
  if (!mstate.data.sources) box.innerHTML = '<p class="ps-loading">データ元を読んでいます…</p>';
  const r = await masterRequest("/api/sources", { cache: "no-store" });
  if (mstate.tab !== "sources") return;
  if (!r.ok) { box.innerHTML = `<p class="ps-loading">データ元を読めませんでした: ${escapeHtml(r.data.error || "")}</p>`; return; }
  const d = mstate.data.sources = r.data;
  mstate.loadedRev.sources = d.revision;
  if (openKey && openKey !== "+" && !d.items.some((s) => s.key === openKey)) openKey = null;
  paintSources(notice);
}
function paintSources(notice = null) {
  const d = mstate.data.sources, box = $("#masterSettings"), can = d.canEdit && !shareDown();
  const card = (s) => {
    if (s.key === openKey) return `<section class="sr-card is-open" data-key="${escapeHtml(s.key)}">
      <div class="sr-name"><b>${escapeHtml(s.name)}</b>${roleChip(s)}</div><div class="sr-facts">${stateOf(s)}</div><span></span>${formOf(s, can)}</section>`;
    return `<section class="sr-card" data-key="${escapeHtml(s.key)}" data-sr-open="${escapeHtml(s.key)}" title="押すと直す欄になります">
      <div class="sr-name"><b>${escapeHtml(s.name)}</b>${roleChip(s)}</div>
      <div class="sr-where">${fullPath(whereOf(s))}</div>
      <button type="button" class="pz-btn sr-edit" data-sr-edit="${escapeHtml(s.key)}">${can ? "変える…" : "見る"}</button>
      <div class="sr-facts">${stateOf(s)}<span>表 <b>${escapeHtml(s.table || "自動")}</b></span>
        <span>${s.equipColumn ? `設備の列 <b>${escapeHtml(s.equipColumn)}</b>（${escapeHtml(s.equipMode)}）` : "設備は見分けない"}</span>
        <span>見出しのタブ <b>${escapeHtml(tabOf(s))}</b></span></div></section>`;
  };
  box.innerHTML = `<section class="sr-page">
    <p class="ps-lead">アプリが読む共有のデータです。どれも手元へ写してから読みます（共有を直接は読みません）。場所を変えると、全員の PC で次に読むときから新しい場所を読みます。</p>
    <div class="ps-result${notice ? ` ${notice[0]}` : " hidden"}" id="srNotice" aria-live="polite">${notice ? notice[1] : ""}</div>
    <div class="sr-cards">${d.items.map(card).join("")}
      ${openKey === "+" ? `<section class="sr-card is-open" data-key=""><div class="sr-name"><b>データ元を足す</b></div><div></div><span></span>${formOf(null, can)}</section>` : ""}</div>
    ${can && openKey !== "+" ? '<div class="sr-add"><button type="button" class="btn-primary" id="srAdd">＋ データ元を足す</button><small>共有の .sqlite3 ファイルを 1 つ選んで、品質異常と同じ形で見られるようにします。</small></div>' : ""}
  </section>`;
  box.querySelectorAll("[data-sr-open]").forEach((c) => { c.onclick = async (e) => { if (e.target.closest("a") || !(await TPA.unsaved.leave("master:sources", "ほかのデータ元を開く"))) return; openKey = c.dataset.srOpen; paintSources(); }; });
  const add = $("#srAdd"); if (add) add.onclick = async () => { if (!(await TPA.unsaved.leave("master:sources", "データ元を足す"))) return; openKey = "+"; paintSources(); };
  const open = box.querySelector(".sr-card.is-open");
  if (open) bindSourceForm(open, d.items.find((x) => x.key === openKey) || null, can);
}

/* 直す欄（開いたカードの中）。s: データ元（null なら足す） */
function formOf(s, can) {
  const d = mstate.data.sources, dis = can ? "" : " disabled";
  if (s && s.kind === "folder") return `<div class="sr-form"><p class="ps-hint sr-w">フォルダとファイル名の決まりは「作業実績」のタブで直します（直すと、そのまま設備を探し直します）。</p>
    <div class="sr-acts"><button type="button" class="pz-btn" data-sr-work>作業実績を開く ›</button><button type="button" class="btn-ghost" data-sr-close>閉じる</button></div></div>`;
  const isLot = s && s.key === "lot";
  const v = s || { name: "", role: "その他", place: "", table: "", equipColumn: "", equipMode: "そのまま", listed: true };
  const opt = (list, cur) => list.map((x) => `<option${x === cur ? " selected" : ""}>${escapeHtml(x)}</option>`).join("");
  const reset = s && (isLot ? s.placeChanged : s.key === "wip" && s.id) && can;
  return `<div class="sr-form">
    ${isLot ? "" : `<label><span>表示名</span><input class="ps-input" data-sr="name" value="${escapeHtml(v.name)}"${dis}></label>`}
    ${s && s.builtin ? "" : `<label><span>役割</span><select data-sr="role"${dis}>${opt(d.roles, v.role)}</select></label>`}
    ${isLot ? "" : `<label><span>見出しのタブ</span><select data-sr="listed"${dis}><option value="1"${v.listed ? " selected" : ""}>出す</option><option value="0"${v.listed ? "" : " selected"}>出さない</option></select></label>`}
    <label class="sr-w"><span>場所（共有の .sqlite3）</span><span class="sr-row"><input class="ps-input" data-sr="place" value="${escapeHtml(v.place)}" spellcheck="false"${dis}
      ${v.placeDefault ? ` placeholder="既定: ${escapeHtml(v.placeDefault)}"` : ""}></span></label>
    <label><span>表（空なら自動）</span><input class="ps-input" data-sr="table" value="${escapeHtml(v.table)}" placeholder="自動"${dis}></label>
    <label><span>設備の列（空なら見分けない）</span><input class="ps-input" data-sr="equip" value="${escapeHtml(v.equipColumn)}"${dis}></label>
    <label><span>設備の取り出し方</span><select data-sr="mode"${dis}>${opt(d.equipModes, v.equipMode)}</select></label>
    <div class="sr-acts">
      <button type="button" class="ps-check" data-sr-check>確かめる</button>
      <button type="button" class="btn-primary" data-sr-save${dis}>${s ? "保存" : "足す"}</button>
      ${reset ? '<button type="button" class="ps-reset" data-sr-reset title="配った設定（既定）に戻します">既定に戻す</button>' : ""}
      ${s && !s.builtin && can ? '<button type="button" class="pz-btn danger" data-sr-del>このデータ元を消す</button>' : ""}
      <span class="sr-sp"></span><button type="button" class="btn-ghost" data-sr-close>閉じる</button>
    </div>
    <div class="ps-result hidden sr-w" data-sr-result aria-live="polite"></div></div>`;
}
function bindSourceForm(card, s, can) {
  const q = (k) => card.querySelector(`[data-sr="${k}"]`), val = (k) => (q(k) ? q(k).value.trim() : "");
  const out = card.querySelector("[data-sr-result]");
  const say = (cls, html) => { if (!out) return; out.className = `ps-result ${cls} sr-w`; out.innerHTML = html; };
  card.querySelectorAll("[data-sr-close]").forEach((b) => { b.onclick = async () => { if (!(await TPA.unsaved.leave("master:sources", "欄を閉じる"))) return; openKey = null; paintSources(); }; });
  const work = card.querySelector("[data-sr-work]"); if (work) work.onclick = () => goTab("worklog");
  openSnap = formNow();
  if (!q("place")) return;
  TPA.pathPick(q("place"), { purpose: "sqlite", title: "データ元のファイル（.sqlite3）を選ぶ", note: "共有の .sqlite3 ファイルを選びます。",
    disabled: can ? false : `${readOnlyWhy("sources")}のため、選べません` });
  q("place").focus();
  card.querySelector("[data-sr-check]").onclick = async () => {
    say("wait", "確かめています…");
    const res = await masterRequest("/api/sources/check", TPA.json("POST", { place: val("place") || (s && s.placeDefault) || "", table: val("table"), equipColumn: val("equip") }));
    const x = res.data || {};
    say(x.ok ? "ok" : "ng", `${x.ok ? "✓" : "✕"} ${escapeHtml(x.message || x.error || "確かめられませんでした")}`);
  };
  card.querySelector("[data-sr-save]").onclick = () => saveSource(s, { name: val("name"), role: val("role"), place: val("place"), table: val("table"),
    equipColumn: val("equip"), equipMode: val("mode"), listed: q("listed") ? q("listed").value === "1" : true }, say);
  const del = card.querySelector("[data-sr-del]");
  if (del) del.onclick = () => { if (confirm(`データ元「${s.name}」を消します。全員の PC で見出しのタブが無くなります。よろしいですか？`)) removeSource(s, say); };
  const reset = card.querySelector("[data-sr-reset]");
  if (reset) reset.onclick = () => { if (confirm(`${s.name}の場所を、配った設定（既定）に戻します。全員の PC に効きます。よろしいですか？`)) resetSource(s, say); };
}
/* 既定に戻す: 品質データは参照先の場所・表を消す、仕掛はこのマスタの行を消す */
async function resetSource(s, say) {
  if (s.key !== "lot") { removeSource(s, say); return; }
  say("wait", "戻しています…");
  if (!mstate.data.paths) await ensureTabLoaded("paths");
  const items = (mstate.data.paths && mstate.data.paths.items) || [];
  for (const k of ["lot_list.source", "lot_list.table"]) {
    const it = items.find((i) => i.key === k) || {};
    if (it.source !== "master") continue;
    const res = await withLockWait(() => masterRequest(`/api/settings/${encodeURIComponent(k)}`, TPA.json("PUT", { value: "", base_rev: it.rev || 0 })),
      (x) => say("wait", lockWaitText(x, "保存", boldName)));
    if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "戻せませんでした")); return; }
    emit("tpa:settings-changed", { key: k });
  }
  mstate.data.paths = null;
  renderSources({ notice: ["ok", "✓ 品質データの場所を既定に戻しました。"] });
}

async function saveSource(s, f, say) {
  say("wait", "保存しています…");
  const putRow = (key, body) => withLockWait(() => masterRequest(key ? `/api/sources/${encodeURIComponent(key)}` : "/api/sources",
    TPA.json(key ? "PUT" : "POST", body)), (x) => say("wait", lockWaitText(x, "保存", boldName)));
  let res;
  if (s && s.key === "lot") {
    if (!mstate.data.paths) await ensureTabLoaded("paths");
    const items = (mstate.data.paths && mstate.data.paths.items) || [];
    for (const [k, value, now] of [["lot_list.source", f.place, s.place], ["lot_list.table", f.table, s.table]]) {
      if (value === now) continue;
      const it = items.find((i) => i.key === k) || {};
      res = await withLockWait(() => masterRequest(`/api/settings/${encodeURIComponent(k)}`, TPA.json("PUT", { value, base_rev: it.rev || 0 })),
        (x) => say("wait", lockWaitText(x, "保存", boldName)));
      if (!res.ok) break;
      emit("tpa:settings-changed", { key: k });
    }
    if (!res || res.ok) res = await putRow("lot", { "設備の列": f.equipColumn, "設備の取り出し方": f.equipMode, base_rev: s.rev || 0 });
    mstate.data.paths = null;
  } else {
    res = await putRow(s ? s.key : null, { "表示名": f.name, "役割": f.role || (s && s.role) || "その他", "場所": f.place, "表": f.table,
      "設備の列": f.equipColumn, "設備の取り出し方": f.equipMode, "画面": f.listed ? "有" : "無", base_rev: s ? s.rev || 0 : 0 });
  }
  if (res && res.status === 409 && res.data.kind === "conflict") { say("ng", "開いたあとに、ほかの PC がこのデータ元を変えました。読み直してから直してください。"); return; }
  if (res && !res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした")); return; }
  const key = s ? s.key : res.data.row["キー"];
  emit("tpa:settings-changed", { key: `sources.${key}` });
  emit("tpa:sources-changed", { key });
  openKey = null;
  renderSources({ notice: ["ok", s ? `✓ ${escapeHtml(s.name)}を保存しました。全員の PC で次に読むときから効きます。` : "✓ データ元を足しました。見出しにタブが出ます。"] });
}
async function removeSource(s, say) {
  say("wait", "消しています…");
  const res = await withLockWait(() => masterRequest(`/api/sources/${encodeURIComponent(s.key)}?rev=${s.rev || ""}`, { method: "DELETE" }),
    (x) => say("wait", lockWaitText(x, "削除", boldName)));
  if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "消せませんでした")); return; }
  emit("tpa:settings-changed", { key: `sources.${s.key}` });
  emit("tpa:sources-changed", { key: s.key });
  openKey = null;
  renderSources({ notice: ["ok", s.builtin ? "✓ 既定に戻しました。" : `✓ データ元「${escapeHtml(s.name)}」を消しました。`] });
}
};
