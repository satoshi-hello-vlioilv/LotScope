/* マスタ管理の「データ元」（版 3.36.0。services/data_sources.py・routes/sources.py。決め方: ui-proposals/2026-10-sources*）。
   アプリが読む共有のデータ（品質データ・作業実績・仕掛・足した元）を 1 列のカードで見せ、場所・表・設備の列・見出しのタブを直す。
   - カードには場所の全部（ファイル名は太字）・状態（写した時刻・行の数）・表・設備の列・見出しのタブ。カードを押す（か「変える…」）と、
     そのカードが直す欄に変わる（要約と欄を 2 度出さない）
   - 品質データの場所は参照先の lot_list.source・lot_list.table（PUT /api/settings/<項目>）。直すのはここだけ（参照先には出さない）。
     作業実績のフォルダは「作業実績」のタブで直す（探すと一緒に）
   - 仕掛・足した元はこのマスタ（PUT /api/sources/<キー>・POST /api/sources で足す・DELETE で消す〈仕掛は既定に戻す〉）
   - 結合（版 3.53.0）: 開いた欄の「結合」の段（master-join.js）で、ほかのデータ元の列を自由に組んだ鍵で合わせる。どの元も「結合」はこのマスタの行に置く
     （品質データ・作業実績も）。閉じたカードには結合ごとに 1 行（ベン図・相手・方式・鍵・当たった数）
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
  label: () => (openKey === "+" ? "データ元を足す欄" : openKey === "+view" ? "結合した表を作る欄" : `データ元「${((mstate.data.sources || { items: [] }).items.find((x) => x.key === openKey) || {}).name || openKey}」の欄`),
  save: () => saveBy("#masterSettings .sr-card.is-open [data-sr-save]", srDirty, "#masterSettings .sr-card.is-open [data-sr-result]") });

const sepOf = (p) => (String(p).includes("\\") ? "\\" : "/");
const whereOf = (s) => (s.kind === "folder" ? s.place + sepOf(s.place) + (s.pattern || "") : s.place);
const fileOf = (p) => String(p || "").split(/[\\/]/).pop();
const dirOf = (p) => { const x = String(p || ""); const i = x.search(/[^\\/]+$/); return i > 0 ? x.slice(0, i - 1) : ""; };
/* 場所の全部。ファイル名（最後の区切りの後ろ）を太字に（開いた欄） */
const fullPath = (p) => {
  const s = String(p || ""), i = s.search(/[^\\/]+$/);
  return `<span class="sr-path">${i < 0 ? escapeHtml(s) || "（決まっていません）" : escapeHtml(s.slice(0, i)) + `<b>${escapeHtml(s.slice(i))}</b>`}</span>`;
};
const when = (sec) => { const d = new Date(sec * 1000), p = TPA.pad2; return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const hm = (sec) => { const d = new Date(sec * 1000), p = TPA.pad2; return `${p(d.getHours())}:${p(d.getMinutes())}`; };
/* 状態: 行の数（言葉で）と写した時刻（淡く。日付は題に）。点の色だけに頼らない */
function stateOf(s) {
  const m = s.mirror;
  if (s.kind === "folder") return `<span class="sr-state ok" title="設備ごとに写して読みます"><i></i>${s.equipCount != null ? s.equipCount : "-"} 台</span>`;
  if (s.kind === "cm3") return m && m.mirrored ? `<span class="sr-state ${m.unreachable ? "ng" : "ok"}" title="CM3 から最後に取った ${when(m.checkedAt || m.copiedAt)}"><i></i>${s.equipCount != null ? `${s.equipCount} 設備` : "取った"} <small>${hm(m.checkedAt || m.copiedAt)}</small></span>`
    : '<span class="sr-state" title="開くと CM3 から取ります"><i></i>まだ取っていない</span>';
  if (s.kind === "view" && s.broken) return '<span class="sr-state ng"><i></i>元がありません</span>';
  if (!m || !m.mirrored) return `<span class="sr-state" title="開くと共有から手元へ写します"><i></i>${s.kind === "view" ? "まだ組んでいない" : "まだ写していない"}</span>`;
  const at = m.copiedAt || m.at;
  if (s.kind === "view" && s.rows == null) return `<span class="sr-state" title="元を写した ${when(at)}。開くと元の写しに結合を当てて組み、行の数が出ます"><i></i>開くと組む</span>`;
  if (m.unreachable) return `<span class="sr-state ng" title="共有に届きません。写した ${when(at)} の物で見ています"><i></i>届かない <small>${hm(at)}</small></span>`;
  return `<span class="sr-state ok" title="写した ${when(at)}"><i></i>${s.rows != null ? `${s.rows.toLocaleString()} 行` : "写した"} <small>${hm(at)}</small></span>`;
}
const roleChip = (s) => (s.kind === "view" ? '<span class="sr-role is-view">結合した表</span>' : s.group || s.name.includes(s.role) ? "" : `<span class="sr-role">${escapeHtml(s.role)}</span>`);
const canHide = (s) => s.key !== "lot" && s.key !== "work";

/* ---- 一覧（版 3.54.0。決め方: ui-proposals/2026-10-srclist*）: 1 行 1 件の表。グループごとの見出し行（畳める・名前を変える）・
   見出しのタブのスイッチ（1 手で出し入れ）・⠿ を引いて並べ替え／グループへ移す・結合した表は元の下に └ で・相手には「← … で使う」。
   ファイルの列はファイル名だけ（共有の道はグループの見出しに 1 度・行の題に全部）。数は表から数える ---- */
const COLLAPSE_KEY = "tpa.sr.collapsed.v1";
let search = "";              // 名前・ファイルで探す
let newGroups = [];           // ＋ グループで作った、まだ中が空のグループ（この画面だけ）
let dragKey = null;
let viewBase = "";            // 行のメニューの「この元で結合した表を作る」で選んだ元
const collapsed = () => new Set(TPA.local.get(COLLAPSE_KEY, []) || []);
function toggleCollapsed(g) { const c = collapsed(); if (c.has(g)) c.delete(g); else c.add(g); TPA.local.set(COLLAPSE_KEY, [...c]); paintSources(); }
const hits = (s) => { const q = search.trim(); if (!q) return true; const t = `${s.name} ${fileOf(whereOf(s))} ${s.group || ""}`;
  return TPA.wild.has(q) ? TPA.wild.test("contains", q, t) : t.toLowerCase().includes(q.toLowerCase()); };
/** グループごとの並び（グループなし → グループは最初の元の順 → まだ空のグループ）。結合した表は、同じグループの元の下へ */
function grouped(items) {
  const names = ["", ...new Set(items.filter((s) => s.group).map((s) => s.group)), ...newGroups.filter((g) => !items.some((s) => s.group === g))];
  return names.map((g) => {
    const list = items.filter((s) => (s.group || "") === g), out = [];
    list.filter((s) => !(s.kind === "view" && list.some((b) => b.key === s.base))).forEach((s) => {
      out.push(s);
      list.filter((v) => v.kind === "view" && v.base === s.key).forEach((v) => out.push(v));
    });
    return { g, list: out };
  });
}
async function renderSources({ notice = null } = {}) {
  const box = $("#masterSettings");
  if (!mstate.data.sources) box.innerHTML = '<p class="ps-loading">データ元を読んでいます…</p>';
  const r = await masterRequest("/api/sources", { cache: "no-store" });
  if (mstate.tab !== "sources") return;
  if (!r.ok) { box.innerHTML = `<p class="ps-loading">データ元を読めませんでした: ${escapeHtml(r.data.error || "")}</p>`; return; }
  const d = mstate.data.sources = r.data;
  mstate.loadedRev.sources = d.revision;
  if (openKey && openKey !== "+" && openKey !== "+view" && !d.items.some((s) => s.key === openKey)) openKey = null;
  paintSources(notice);
}
function paintSources(notice = null) {
  const d = mstate.data.sources, box = $("#masterSettings"), can = d.canEdit && !shareDown();
  const names = Object.fromEntries(d.items.map((x) => [x.key, x.name]));
  const shown = d.items.filter((s) => s.listed).length, cc = collapsed(), q = search.trim();
  const COLS = 7;
  const formRow = (s, key) => `<tr class="sr-formrow"><td colspan="${COLS}"><section class="sr-card is-open" data-key="${escapeHtml(key)}">
      <div class="sr-name"><b>${s ? escapeHtml(s.name) : key === "+view" ? "結合した表を作る" : "データ元を足す"}</b>${s ? roleChip(s) : ""}</div><div class="sr-facts">${s ? stateOf(s) : ""}</div><span></span>
      ${formOf(s, can, key === "+view")}</section></td></tr>`;
  const joinCell = (s) => {
    const st = (s.joinStats || [])[0], j = (s.joins || [])[0];
    // 結合した表は「＋ 相手」（元の表に足した物）、自分に結合を持つ元は「相手 を合わせた」（同じ字が 2 行に並ばない。2026-10-srclist の 2 回目の採点）
    if (j) return `<span class="sr-j" title="${s.kind === "view" ? "元の表に足した相手" : "この元に合わせた相手"}: ${escapeHtml(s.joinText)}">${MasterJoin.venn(j.how, 22)}<span>${s.kind === "view" ? "＋ " : ""}${escapeHtml(names[j.with] || j.with)}${s.joins.length > 1 ? ` ほか ${s.joins.length - 1}` : ""}</span>`
      + (st ? `<em>${st.hit.toLocaleString()}/${st.rows.toLocaleString()}</em>` : "") + "</span>";
    const by = (s.usedBy || []).length;
    return by ? `<span class="sr-used" title="${escapeHtml(s.usedBy.map((k) => names[k] || k).join("・"))} が、このデータ元を使っています">← ${by === 1 ? escapeHtml(names[s.usedBy[0]] || "") : `${by} つの結合`}で使う</span>` : "";
  };
  const sw = (s) => {
    if (!canHide(s)) return `<span class="sr-fixed" title="${escapeHtml(s.name)}のタブ（${s.key === "lot" ? "品質異常" : "作業実績"}）はアプリの決まったタブなので、いつも出ます">いつも出す</span>`;
    const lock = !can;
    return `<button type="button" class="sr-sw${s.listed ? " on" : ""}" role="switch" aria-checked="${s.listed}" data-sr-show="${escapeHtml(s.key)}"${lock ? " disabled" : ""}
      title="${!canHide(s) ? `${escapeHtml(s.name)}のタブはいつも出ます` : s.listed ? "見出しのタブに出しています（押すと出さない。結合・ダッシュボードには使えます）" : "見出しのタブに出していません（押すと出す）"}"><i></i><span>${s.listed ? "出す" : "出さない"}</span></button>`;
  };
  const row = (s) => {
    if (s.key === openKey) return formRow(s, s.key);
    const nested = s.kind === "view" && d.items.some((b) => b.key === s.base && (b.group || "") === (s.group || ""));
    const file = s.kind === "view" ? `元: ${escapeHtml(s.baseName || "（ありません）")}` : escapeHtml(fileOf(whereOf(s)) || "（決まっていません）");
    return `<tr class="sr-row${s.listed ? "" : " is-off"}" data-key="${escapeHtml(s.key)}" data-group="${escapeHtml(s.group || "")}"${can && canHide(s) ? ' draggable="true"' : ""}>
      <td class="sr-gp">${can && canHide(s) ? '<span class="sr-grip" title="つかんで並べ替え・グループへ移す（選んで Alt＋↑↓ でも）" tabindex="0" data-sr-grip>⠿</span>' : ""}</td>
      <td class="sr-nm" data-sr-open="${escapeHtml(s.key)}" title="${escapeHtml(`表 ${s.table || "自動"}・${s.equipColumn ? `設備の列 ${s.equipColumn}（${s.equipMode}）` : "設備は見分けない"}\n押すと直す欄になります`)}">${nested ? '<span class="sr-tree" aria-hidden="true">└</span>' : ""}<b>${escapeHtml(s.name)}</b>${roleChip(s)}</td>
      <td class="sr-file" title="${escapeHtml(s.kind === "view" ? `${s.baseName || ""} の写しに結合を当てた表` : whereOf(s))}"><span class="sr-fname">${file}</span></td>
      <td>${stateOf(s)}</td><td>${sw(s)}</td><td class="sr-jc">${joinCell(s)}</td>
      <td class="sr-ac"><button type="button" class="pz-btn sr-edit" data-sr-edit="${escapeHtml(s.key)}">${can ? "変える…" : "見る"}</button></td></tr>`;
  };
  const body = grouped(d.items).map(({ g, list }) => {
    const vis = list.filter(hits);
    if (q && !vis.length) return "";
    const on = list.filter((s) => s.listed).length, dirs = [...new Set(list.filter((s) => s.kind === "file").map((s) => dirOf(s.place)))];
    const shut = cc.has(g) && !q;
    const head = `<tr class="sr-gh" data-group="${escapeHtml(g)}"><td colspan="${COLS}" title="${g ? `見出しの「${escapeHtml(g)}」のタブの中に、出すデータ元が札で並びます` : "見出しに 1 つずつタブが出ます"}"><button type="button" class="sr-gt" data-sr-fold="${escapeHtml(g)}" aria-expanded="${!shut}">${shut ? "▸" : "▾"}</button>`
      + `<b>${g ? escapeHtml(g) : "グループなし"}</b><small>${list.length} 件・出す ${on}${g && dirs.length === 1 && dirs[0] ? `・${escapeHtml(dirs[0])}` : ""}</small>`
      + (g && can ? `<button type="button" class="sr-gren" data-sr-rename="${escapeHtml(g)}">名前を変える</button><button type="button" class="sr-gren is-danger" data-sr-gdel="${escapeHtml(g)}" title="グループをやめます（中のデータ元は消えず、グループなしへ移ります）">グループを消す</button>` : "")
      + (can && list.some(canHide) ? `<span class="sr-gall"><button type="button" class="sr-gren" data-sr-all="1" data-g="${escapeHtml(g)}"${on === list.filter(canHide).length + list.filter((x) => !canHide(x)).length ? " disabled" : ""}>全部出す</button>`
        + `<button type="button" class="sr-gren" data-sr-all="0" data-g="${escapeHtml(g)}"${list.filter((x) => canHide(x) && x.listed).length ? "" : " disabled"}>全部出さない</button></span>` : "") + "</td></tr>";
    const rows = shut ? "" : vis.map(row).join("") + (!list.length ? `<tr class="sr-empty" data-group="${escapeHtml(g)}"><td colspan="${COLS}">⠿ を引いてデータ元を入れます（入れると見出しにこのグループのタブが出ます）</td></tr>` : "");
    return head + rows;
  }).join("");
  box.innerHTML = `<section class="sr-page">
    <div class="sr-top"><p class="ps-lead" title="どれも手元へ写してから読みます（共有を直接は読みません）。⠿ を引くか、右クリック・Alt＋↑↓ で並べ替え・グループへ移せます">共有のデータ ${d.items.length} 件（見出しに出す ${shown}）${can ? "・⠿ で並べ替え" : ""}</p>
      <input type="search" class="ps-input sr-search" id="srSearch" value="${escapeHtml(search)}" placeholder="名前・ファイルで探す（* ? も）" aria-label="データ元を名前・ファイルで探す" autocomplete="off">
      ${can ? '<button type="button" class="pz-btn" id="srGroup" title="グループを作り、データ元を引いて入れます。グループは見出しで 1 つのタブになり、中に札で並びます">＋ グループ</button><button type="button" class="pz-btn" id="srView" title="見出しに出さないデータ元どうしも、任意の鍵で合わせて 1 つの表として見られます">＋ 結合した表</button><button type="button" class="btn-primary" id="srAdd">＋ データ元を足す</button>' : ""}</div>
    <div class="ps-result${notice ? ` ${notice[0]}` : " hidden"}" id="srNotice" aria-live="polite">${notice ? notice[1] : ""}</div>
    <table class="sr-table"><colgroup><col class="c-gp"><col class="c-nm"><col class="c-file"><col class="c-st"><col class="c-sw"><col><col class="c-ac"></colgroup>
      <thead><tr><th></th><th>名前</th><th>ファイル</th><th>状態</th><th>見出しのタブ</th><th>結合</th><th></th></tr></thead>
      <tbody>${body}${openKey === "+" || openKey === "+view" ? formRow(null, openKey) : ""}</tbody></table>
    ${q && !body ? `<p class="ps-hint">「${escapeHtml(q)}」に当たるデータ元はありません。</p>` : ""}
  </section>`;
  bindList(box, d, can);
  const open = box.querySelector(".sr-card.is-open");
  if (open) bindSourceForm(open, d.items.find((x) => x.key === openKey) || null, can, openKey === "+view");
}
const notice = (cls, html) => { const n = $("#srNotice"); if (!n) return; n.className = `ps-result ${cls}`; n.innerHTML = html; };
function bindList(box, d, can) {
  const open = async (key, why) => { if (!(await TPA.unsaved.leave("master:sources", why))) return; openKey = key; paintSources(); };
  box.querySelectorAll("[data-sr-open], [data-sr-edit]").forEach((c) => { c.onclick = (e) => { if (e.target.closest("a")) return; open(c.dataset.srOpen || c.dataset.srEdit, "ほかのデータ元を開く"); }; });
  box.querySelectorAll("[data-sr-fold]").forEach((b) => { b.onclick = () => toggleCollapsed(b.dataset.srFold); });
  const sr = $("#srSearch");
  if (sr) TPA.onText(sr, (el) => { search = el.value; const at = el.selectionStart; paintSources(); const n = $("#srSearch"); if (n) { n.focus(); try { n.setSelectionRange(at, at); } catch (_) { /* 選べない */ } } });
  const add = $("#srAdd"); if (add) add.onclick = () => open("+", "データ元を足す");
  const view = $("#srView"); if (view) view.onclick = () => open("+view", "結合した表を作る");
  const grp = $("#srGroup"); if (grp) grp.onclick = () => askName("", (name) => { if (!newGroups.includes(name)) newGroups.push(name); paintSources(); notice("ok", `✓ グループ「${escapeHtml(name)}」を作りました。⠿ を引いてデータ元を入れてください（入れるまでは保存されません）。`); });
  box.querySelectorAll("[data-sr-rename]").forEach((b) => { b.onclick = () => askName(b.dataset.srRename, (name) => renameGroup(b.dataset.srRename, name), b); });
  box.querySelectorAll("[data-sr-gdel]").forEach((b) => { b.onclick = () => deleteGroup(b.dataset.srGdel); });
  box.querySelectorAll("[data-sr-show]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); const s = d.items.find((x) => x.key === b.dataset.srShow);
    quick(s, { "画面": s.listed ? "無" : "有" }, s.listed ? `✓ ${escapeHtml(s.name)}を見出しのタブから外しました（結合・ダッシュボードには使えます）。` : `✓ ${escapeHtml(s.name)}を見出しのタブに出しました。`); }; });
  box.querySelectorAll("[data-sr-all]").forEach((b) => { b.onclick = () => showAll(b.dataset.g, b.dataset.srAll === "1"); });
  if (!can) return;
  // 右クリック（⠿ で Shift＋F10 でも）: 並べ替え・グループへ移す・出し入れ・結合した表を作る（引く手のほかの道。2026-10-srclist の 2 回目の採点）
  box.querySelectorAll("tr.sr-row").forEach((tr) => {
    tr.addEventListener("contextmenu", (e) => { e.preventDefault(); rowMenu(tr.dataset.key, e.clientX, e.clientY); });
    tr.querySelector("[data-sr-grip]")?.addEventListener("keydown", (e) => {
      if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") { e.preventDefault(); const r = e.target.getBoundingClientRect(); rowMenu(tr.dataset.key, r.left, r.bottom + 2); }
    });
  });
  // 引いて並べ替え・グループへ移す（行・グループの見出し・空のグループへ落とす）
  box.querySelectorAll("tr.sr-row[draggable]").forEach((tr) => {
    tr.addEventListener("dragstart", (e) => { dragKey = tr.dataset.key; tr.classList.add("is-drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragKey); });
    tr.addEventListener("dragend", () => { dragKey = null; tr.classList.remove("is-drag"); box.querySelectorAll(".drop-before,.drop-after,.drop-in").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-in")); });
  });
  box.querySelectorAll("tr.sr-row, tr.sr-gh, tr.sr-empty").forEach((tr) => {
    tr.addEventListener("dragover", (e) => {
      if (!dragKey || tr.dataset.key === dragKey || (tr.classList.contains("sr-row") && !canHide(d.items.find((x) => x.key === tr.dataset.key) || {}))) return;
      e.preventDefault();
      box.querySelectorAll(".drop-before,.drop-after,.drop-in").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-in"));
      if (!tr.classList.contains("sr-row")) { tr.classList.add("drop-in"); return; }
      const r = tr.getBoundingClientRect();
      tr.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
    });
    tr.addEventListener("drop", (e) => {
      if (!dragKey) return;
      e.preventDefault();
      const g = tr.dataset.group || "", after = tr.classList.contains("drop-after"), into = !tr.classList.contains("sr-row");
      moveTo(dragKey, into ? { group: g } : { group: g, near: tr.dataset.key, after });
    });
  });
  box.querySelectorAll("[data-sr-grip]").forEach((h) => {
    h.addEventListener("keydown", (e) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const key = h.closest("tr").dataset.key, s = d.items.find((x) => x.key === key), mates = d.items.filter((x) => (x.group || "") === (s.group || "") && canHide(x));
      const i = mates.findIndex((x) => x.key === key), j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (j < 0 || j >= mates.length) return;
      moveTo(key, { group: s.group || "", near: mates[j].key, after: e.key === "ArrowDown" }, true);
    });
  });
}
/** 行のメニュー（右クリック・Shift＋F10） */
function rowMenu(key, x, y) {
  const items = mstate.data.sources.items, s = items.find((v) => v.key === key);
  if (!s) return;
  const mates = items.filter((v) => (v.group || "") === (s.group || "") && canHide(v)), i = mates.findIndex((v) => v.key === key);
  const groups = [...new Set(items.map((v) => v.group).filter(Boolean).concat(newGroups))].filter((g) => g !== (s.group || ""));
  TPA.menu({ x, y, head: `データ元「${s.name}」`, items: [
    { label: "変える…", icon: "✎", run: () => { openKey = key; paintSources(); } },
    { label: s.listed ? "見出しのタブに出さない" : "見出しのタブに出す", icon: s.listed ? "○" : "●", disabled: !canHide(s), why: canHide(s) ? "" : "いつも出るタブです",
      run: () => quick(s, { "画面": s.listed ? "無" : "有" }, `✓ ${escapeHtml(s.name)}を見出しのタブ${s.listed ? "から外しました" : "に出しました"}。`) },
    { sep: true },
    { label: "上へ", icon: "↑", key: "Alt+↑", disabled: !canHide(s) || i <= 0, why: i <= 0 ? "グループのいちばん上です" : "", run: () => moveTo(key, { group: s.group || "", near: mates[i - 1].key, after: false }) },
    { label: "下へ", icon: "↓", key: "Alt+↓", disabled: !canHide(s) || i >= mates.length - 1, why: i >= mates.length - 1 ? "グループのいちばん下です" : "", run: () => moveTo(key, { group: s.group || "", near: mates[i + 1].key, after: true }) },
    { sep: true },
    ...groups.map((g) => ({ label: `「${g}」へ移す`, icon: "→", disabled: !canHide(s), run: () => moveTo(key, { group: g }) })),
    ...(s.group ? [{ label: "グループから出す", icon: "←", run: () => moveTo(key, { group: "" }) }] : []),
    { label: "新しいグループへ…", icon: "＋", disabled: !canHide(s), run: () => askName("", (name) => moveTo(key, { group: name })) },
    ...(s.kind === "file" ? [{ sep: true }, { label: "この元で結合した表を作る…", icon: "⊕", run: () => { openKey = "+view"; viewBase = key; paintSources(); } }] : []),
  ] });
}
/** グループの全部を出す・出さない（いつも出る元はそのまま） */
async function showAll(g, on) {
  const list = mstate.data.sources.items.filter((s) => (s.group || "") === g && canHide(s) && s.listed !== on);
  for (const s of list) if (!(await quick(s, { "画面": on ? "有" : "無" }))) return;
  await renderSources({ notice: ["ok", `✓ ${g ? `「${escapeHtml(g)}」` : "グループなし"}の ${list.length} 件を見出しのタブ${on ? "に出しました" : "から外しました"}。`] });
}
/** グループの名前を聞く（見出しの行の中で打つ。Enter で決める・Esc でやめる）。at が無ければ上の帯に出す */
function askName(cur, done, at = null) {
  const host = at ? at.closest("td") : $("#srNotice");
  if (!host) return;
  if (!at) { host.className = "ps-result"; }
  const wrap = document.createElement("span");
  wrap.className = "sr-ask";
  wrap.innerHTML = `<input class="ps-input" maxlength="24" value="${escapeHtml(cur)}" placeholder="グループの名前（例: 台帳）" aria-label="グループの名前"><button type="button" class="btn-primary">${cur ? "変える" : "作る"}</button><button type="button" class="btn-ghost">やめる</button>`;
  if (at) at.replaceWith(wrap); else { host.innerHTML = ""; host.append(wrap); }
  const inp = wrap.querySelector("input"), [okB, noB] = wrap.querySelectorAll("button");
  const ok = () => { const v = inp.value.trim().replace(/\s+/g, " ").slice(0, 24); if (!v || v === cur) { paintSources(); return; } done(v); };
  okB.onclick = ok; noB.onclick = () => paintSources();
  inp.addEventListener("keydown", (e) => { if (TPA.composing(e)) return; if (e.key === "Enter") { e.preventDefault(); ok(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); paintSources(); } });
  inp.focus(); inp.select();
}
/** その場で変える（見出しのタブ・グループ）。行の版で送り、ほかの PC が先に変えていれば読み直す */
async function quick(s, change, okText) {
  const res = await withLockWait(() => masterRequest(`/api/sources/${encodeURIComponent(s.key)}/quick`, TPA.json("POST", { ...change, base_rev: s.rev || 0 })),
    (x) => notice("wait", lockWaitText(x, "保存", boldName)));
  if (!res.ok) { notice("ng", res.status === 409 ? "開いたあとに、ほかの PC がこのデータ元を変えました。読み直しました。" : "✕ " + escapeHtml(res.data.error || "変えられませんでした")); await renderSources(); return false; }
  emit("tpa:sources-changed", { key: s.key });
  if (okText) await renderSources({ notice: ["ok", okText] });
  return true;
}
/** グループの名前を変える・消す（版 3.58.0: サーバーが 1 回の錠でまとめて置き換える。POST /api/sources/groups。to が空なら消す） */
async function regroup(from, to) {
  if (!mstate.data.sources.items.some((s) => s.group === from)) {     // まだ空のグループ（この画面で作っただけ）
    newGroups = to ? newGroups.map((g) => (g === from ? to : g)) : newGroups.filter((g) => g !== from);
    paintSources(); return true;
  }
  const res = await withLockWait(() => masterRequest("/api/sources/groups", TPA.json("POST", { from, to })), (x) => notice("wait", lockWaitText(x, "保存", boldName)));
  if (!res.ok) { notice("ng", "✕ " + escapeHtml(res.data.error || "変えられませんでした")); await renderSources(); return false; }
  emit("tpa:sources-changed", { group: to || from });
  return true;
}
async function renameGroup(from, to) {
  if (!(await regroup(from, to))) return;
  newGroups = newGroups.map((g) => (g === from ? to : g));
  const c = collapsed(); if (c.delete(from)) { c.add(to); TPA.local.set(COLLAPSE_KEY, [...c]); }
  await renderSources({ notice: ["ok", `✓ グループ「${escapeHtml(from)}」を「${escapeHtml(to)}」にしました。見出しのタブの名前も変わります。`] });
}
async function deleteGroup(g) {
  const n = mstate.data.sources.items.filter((s) => s.group === g).length;
  if (n && !confirm(`グループ「${g}」を消します。中の ${n} 件のデータ元は消えず、グループなしへ移ります（見出しには 1 つずつタブが出ます）。よろしいですか？`)) return;
  if (!(await regroup(g, ""))) return;
  newGroups = newGroups.filter((x) => x !== g);
  await renderSources({ notice: ["ok", `✓ グループ「${escapeHtml(g)}」を消しました${n ? `。${n} 件のデータ元はグループなしへ移りました` : ""}。`] });
}
/** 動かす: key を group へ（near の前・後ろ。無ければグループの最後）。グループが変われば先にグループを、それから並びを置く */
async function moveTo(key, { group, near = null, after = false }, keepFocus = false) {
  const items = mstate.data.sources.items, s = items.find((x) => x.key === key);
  if (!s || !canHide(s)) return;
  if (s.key === "wip" || s.kind !== "folder") {
    // 役割「マスタ」の元をグループなしへ出すときは「-」（グループを消した印。「マスタ」へ自動で戻らない。版 3.58.0）
    const want = !group && s.role === "マスタ" ? "-" : group;
    if ((s.groupSet || "") !== want && !(s.role === "マスタ" && !s.groupSet && group === "マスタ")) {
      if (!(await quick(s, { "グループ": want }))) return;
    }
  }
  const order = items.filter((x) => canHide(x) && x.key !== key).map((x) => x.key);
  let at = near ? order.indexOf(near) + (after ? 1 : 0) : -1;
  if (at < 0) {   // グループの最後（そのグループの最後の元の後ろ・無ければいちばん後ろ）
    const last = [...items].reverse().find((x) => x.key !== key && canHide(x) && (x.group || "") === group);
    at = last ? order.indexOf(last.key) + 1 : order.length;
  }
  order.splice(at, 0, key);
  const res = await withLockWait(() => masterRequest("/api/sources/order", TPA.json("POST", { keys: order })), (x) => notice("wait", lockWaitText(x, "保存", boldName)));
  if (!res.ok) { notice("ng", "✕ " + escapeHtml(res.data.error || "並べ替えられませんでした")); await renderSources(); return; }
  newGroups = newGroups.filter((g) => g !== group);
  emit("tpa:sources-changed", { key });
  await renderSources({ notice: ["ok", `✓ ${escapeHtml(s.name)}を${group ? `「${escapeHtml(group)}」` : "グループなし"}の${near ? "その位置" : "最後"}へ動かしました。見出しのタブの並びも同じになります。`] });
  if (keepFocus) $(`#masterSettings tr[data-key="${CSS.escape(key)}"] [data-sr-grip]`)?.focus();
}

/* 接続の設定（版 3.58.0。s.conn: services/data_sources.conn_of）。品質・実績・スケジュール・足した元の「どこを・どう読むか」を同じ欄の形で出す。
   置き場は項目ごとに決まっている（bind: settings は参照先の項目〈PUT /api/sources/<キー>/conn〉・row はこのマスタの行〈行の PUT に入れる〉）。
   画面はその違いを見せない（どちらも同じ欄・同じ「保存」） */
const CONN_PICK = {
  sqlite: { purpose: "sqlite", title: "データ元のファイル（.sqlite3）を選ぶ", note: "共有の .sqlite3 ファイルを選びます。" },
  folder: { purpose: "worklog", title: "実績のフォルダを選ぶ", note: "設備ごとの .sqlite3 が並ぶフォルダを選びます（印: 実績のファイルがある）。", exclude: ["worklog"] },
};
const connText = (v) => (v === null || v === undefined ? "" : String(v));
const connWide = (f) => ["sqlite", "folder", "url", "text"].includes(f.kind) && f.id !== "client_ip" && f.id !== "table";
function connField(f, can, at = "") {
  const dis = can ? "" : " disabled", id = `srConn_${f.id}${at}`;
  const tip = f.hint ? ` title="${escapeHtml(f.hint)}"` : "";
  if (f.kind === "lotcol") {
    const v = connText(f.value);
    // 列の中身は開いた後に読む（loadLotCols）。それまでは、決めてある列だけを選べる形で出す
    return `<label class="sr-conn" data-conn-f="${f.id}"${tip}><span>${escapeHtml(f.label)}</span>
      <select data-sr-conn="${f.id}" data-saved="${escapeHtml(v)}" id="${id}"${dis}><option value="">自動</option><option value="-"${v === "-" ? " selected" : ""}>なし（ロット番号の列は無い）</option>
        ${v && v !== "-" ? `<option value="${escapeHtml(v)}" selected>${escapeHtml(v)}</option>` : ""}</select>
      <small class="sr-conn-h" data-lot-auto>${v === "-" ? "ロット番号として扱う列はありません" : v ? "この列をロット番号として扱います" : "名前で見つけた列を使います"}</small></label>`;
  }
  const v = connText(f.value), dflt = connText(f.default);
  const num = f.kind === "int" || f.kind === "number";
  const range = num && f.min != null ? `${f.min}〜${f.max}` : "";
  return `<label class="sr-conn${connWide(f) ? " sr-w" : ""}" data-conn-f="${f.id}"${tip}><span>${escapeHtml(f.label)}</span>
    <span class="sr-row"><input class="ps-input" data-sr-conn="${f.id}" data-saved="${escapeHtml(v)}" id="${id}" value="${escapeHtml(v)}" spellcheck="false"${num ? ' inputmode="decimal"' : ""}
      placeholder="${escapeHtml(dflt ? `既定: ${dflt}` : num ? range : "")}"${dis}></span>
    ${f.id === "stale" ? '<small class="sr-conn-h">最後の更新からこの時間を過ぎたら知らせる（0 は知らせない）</small>' : range ? `<small class="sr-conn-h">${range}${f.kind === "int" && /秒/.test(f.label) ? " 秒" : ""}・空なら既定</small>` : ""}</label>`;
}
/* 欄の補助（参照… の窓）と、ロット番号の列の選びを付ける */
function bindConn(card, s, can) {
  card.querySelectorAll("[data-sr-conn]").forEach((el) => {
    const f = (s.conn || []).find((x) => x.id === el.dataset.srConn) || {};
    const pp = CONN_PICK[f.kind];
    if (pp) TPA.pathPick(el, { ...pp, pattern: f.kind === "folder" ? () => (card.querySelector('[data-sr-conn="pattern"]') || {}).value || "" : undefined,
      disabled: can ? false : `${readOnlyWhy("sources")}のため、選べません` });
  });
  const lot = card.querySelector('[data-sr-conn="lot"]');
  if (lot) loadLotCols(s, lot);
}
/* ロット番号の列の選び: その元の実際の列を並べ、自動で見つけた列を「自動（見つけた列: …）」に書く。読めない（写す前）なら、決めてある値のまま */
async function loadLotCols(s, sel) {
  const r = await masterRequest(`/api/sources/${encodeURIComponent(s.base || s.key)}/columns`, { cache: "no-store" });
  if (!sel.isConnected || !r.ok) return;
  const cur = sel.value, auto = r.data.autoLot || "", hint = sel.parentElement.querySelector("[data-lot-auto]");
  const cols = (r.data.columns || []).filter((c) => !String(c).startsWith("@"));
  sel.innerHTML = `<option value="">自動（${auto ? `見つけた列: ${escapeHtml(auto)}` : "見つかる列は無い"}）</option><option value="-">なし（ロット番号の列は無い）</option>`
    + `<optgroup label="この列をロット番号にする">${cols.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</optgroup>`
    + (cur && cur !== "-" && !cols.includes(cur) ? `<option value="${escapeHtml(cur)}">${escapeHtml(cur)}（表に無い列）</option>` : "");
  sel.value = cur;
  const say = () => { if (hint) hint.textContent = sel.value === "-" ? "ロット番号として扱う列はありません（押して計算へ取り込む・虫眼鏡・ロットでまとめるを出さない）"
    : sel.value ? `「${sel.value}」をロット番号として扱います` : auto ? `名前で見つけた「${auto}」を使います` : "名前で見つかる列が無いので、ロット番号として扱う列はありません"; };
  sel.onchange = say; say();
  openSnap = formNow();     // 中身を読み替えただけ（直した印にしない）
}
/* 欄の値 → [参照先に置く項目, 行に置く列]。直していない項目は送らない */
function connChanges(card, s) {
  const settings = [], row = {};
  for (const f of s.conn || []) {
    const el = card.querySelector(`[data-sr-conn="${f.id}"]`);
    if (!el) continue;
    const v = el.value.trim();
    if (v === (el.dataset.saved || "")) continue;
    if (f.bind === "settings") settings.push({ field: f.id, value: v, rev: f.rev || 0 });
    else row[f.item] = v;
  }
  return { settings, row };
}
async function saveConnSettings(s, list, say) {
  for (const c of list) {
    const res = await withLockWait(() => masterRequest(`/api/sources/${encodeURIComponent(s.key)}/conn`, TPA.json("PUT", { field: c.field, value: c.value, base_rev: c.rev })),
      (x) => say("wait", lockWaitText(x, "保存", boldName)));
    if (!res.ok) return res;
    const f = (s.conn || []).find((x) => x.id === c.field);
    if (f) emit("tpa:settings-changed", { key: f.item });
  }
  return null;
}

/* 直す欄（開いた行の中）。s: データ元（null なら足す）。isView: 結合した表を作る（版 3.54.0: 元＋結合。場所は持たない） */
function formOf(s, can, isView = false) {
  const d = mstate.data.sources, dis = can ? "" : " disabled";
  const view = isView || (s && s.kind === "view");
  // 結合の段（足す欄では出さない: キーが決まってから。足した後で開くと組める。結合した表は作るときから組む）
  const joinBox = s || view ? '<div class="jn sr-w" data-jn-box></div><input type="hidden" data-sr="joins">' : "";
  const groups = [...new Set(d.items.map((x) => x.group).filter(Boolean).concat(newGroups))];
  const groupField = (v) => `<label><span>グループ（空ならグループなし）</span><input class="ps-input" data-sr="group" value="${escapeHtml(v)}" list="srGroups" maxlength="24" placeholder="例: 台帳"${dis}>
    <datalist id="srGroups">${groups.map((g) => `<option value="${escapeHtml(g)}">`).join("")}</datalist></label>`;
  if (s && s.kind === "folder") return `<div class="sr-form"><p class="ps-hint sr-w">フォルダとファイル名の決まりは「作業実績」のタブで直します（直すと、そのまま設備を探し直します）。</p>
    ${joinBox}
    <div class="sr-acts"><button type="button" class="btn-primary" data-sr-save${dis}>保存</button><button type="button" class="pz-btn" data-sr-work>作業実績を開く ›</button>
      <span class="sr-sp"></span><button type="button" class="btn-ghost" data-sr-close>閉じる</button></div>
    <div class="ps-result hidden sr-w" data-sr-result aria-live="polite"></div></div>`;
  // スケジュール（版 3.57.0）: 場所は CM3（参照先で直す）。ここで直すのは表示名・見出しのタブ・仕掛との結合だけ
  if (s && s.kind === "cm3") return `<div class="sr-form">
    <label><span>表示名</span><input class="ps-input" data-sr="name" value="${escapeHtml(s.name)}"${dis}></label>
    <label><span>見出しのタブ</span><select data-sr="listed"${dis}><option value="1"${s.listed ? " selected" : ""}>出す</option><option value="0"${s.listed ? "" : " selected"}>出さない</option></select></label>
    <p class="ps-hint sr-w">CM3 の URL・設備・点検の行の言葉・取り直す間隔は「参照先」で直します。仕掛と突き合わせる鍵（既定: ロットNo = 仕掛のロット番号）と持ってくる列は、下の結合で決めます。</p>
    ${joinBox}
    <div class="sr-acts"><button type="button" class="btn-primary" data-sr-save${dis}>保存</button><button type="button" class="pz-btn" data-sr-paths>参照先を開く ›</button>
      <span class="sr-sp"></span><button type="button" class="btn-ghost" data-sr-close>閉じる</button></div>
    <div class="ps-result hidden sr-w" data-sr-result aria-live="polite"></div></div>`;
  const isLot = s && s.key === "lot";
  const v = s || { name: "", role: "その他", place: "", table: "", equipColumn: "", equipMode: "そのまま", listed: true, groupSet: "", base: "" };
  const opt = (list, cur) => list.map((x) => `<option${x === cur ? " selected" : ""}>${escapeHtml(x)}</option>`).join("");
  const reset = s && (isLot ? s.placeChanged : s.key === "wip" && s.id) && can;
  const listed = isLot ? "" : `<label><span>見出しのタブ</span><select data-sr="listed"${dis}><option value="1"${v.listed ? " selected" : ""}>出す</option><option value="0"${v.listed ? "" : " selected"}>出さない（結合・ダッシュボードだけに使う）</option></select></label>`;
  const acts = (check) => `<div class="sr-acts">
      ${check ? '<button type="button" class="ps-check" data-sr-check>確かめる</button>' : ""}
      <button type="button" class="btn-primary" data-sr-save${dis}>${s ? "保存" : view ? "作る" : "足す"}</button>
      ${reset ? '<button type="button" class="ps-reset" data-sr-reset title="配った設定（既定）に戻します">既定に戻す</button>' : ""}
      ${s && !s.builtin && can ? `<button type="button" class="pz-btn danger" data-sr-del>${view ? "この結合した表を消す" : "このデータ元を消す"}</button>` : ""}
      <span class="sr-sp"></span><button type="button" class="btn-ghost" data-sr-close>閉じる</button>
    </div>
    <div class="ps-result hidden sr-w" data-sr-result aria-live="polite"></div>`;
  if (view) {
    const bases = d.items.filter((x) => x.kind === "file");
    const cur = v.base || (bases.some((b) => b.key === viewBase) ? viewBase : (bases[0] || {}).key);
    return `<div class="sr-form">
    <p class="ps-hint sr-w">元の表に、ほかのデータ元の列を鍵で合わせた 1 つの表です。元も相手も、見出しのタブに出していなくてかまいません（DataRelay の「結合」と同じ考え）。</p>
    <label><span>表示名</span><input class="ps-input" data-sr="name" value="${escapeHtml(v.name)}" placeholder="例: 品質データ＋製造条件"${dis}></label>
    <label><span>元（この表の行）</span><select data-sr="base"${dis}${s ? ' title="元を替えるときは、結合した表を作り直してください"' : ""}>${bases.map((b) => `<option value="${escapeHtml(b.key)}"${b.key === cur ? " selected" : ""}${s && b.key !== cur ? " disabled" : ""}>${escapeHtml(b.name)}${b.listed ? "" : "（出さない）"}</option>`).join("")}</select></label>
    ${listed}${groupField(v.groupSet === "-" ? "" : v.groupSet || "")}
    ${joinBox}${acts(false)}</div>`;
  }
  return `<div class="sr-form">
    ${isLot ? "" : `<label><span>表示名</span><input class="ps-input" data-sr="name" value="${escapeHtml(v.name)}"${dis}></label>`}
    ${s && s.builtin ? "" : `<label><span>役割</span><select data-sr="role"${dis}>${opt(d.roles, v.role)}</select></label>`}
    ${listed}${isLot || (s && s.key === "work") ? "" : groupField(v.groupSet === "-" ? "" : v.groupSet || "")}
    <label class="sr-w"><span>場所（共有の .sqlite3）</span><span class="sr-row"><input class="ps-input" data-sr="place" value="${escapeHtml(v.place)}" spellcheck="false"${dis}
      ${v.placeDefault ? ` placeholder="既定: ${escapeHtml(v.placeDefault)}"` : ""}></span></label>
    <label><span>表（空なら自動）</span><input class="ps-input" data-sr="table" value="${escapeHtml(v.table)}" placeholder="自動"${dis}></label>
    <label><span>設備の列（空なら見分けない）</span><input class="ps-input" data-sr="equip" value="${escapeHtml(v.equipColumn)}"${dis}></label>
    <label><span>設備の取り出し方</span><select data-sr="mode"${dis}>${opt(d.equipModes, v.equipMode)}</select></label>
    ${joinBox || '<p class="ps-hint sr-w">ほかのデータ元との結合は、足した後でこの行を開くと組めます（見出しに出さない元どうしを合わせるときは「＋ 結合した表」）。</p>'}
    ${acts(true)}</div>`;
}
function bindSourceForm(card, s, can, isView = false) {
  const q = (k) => card.querySelector(`[data-sr="${k}"]`), val = (k) => (q(k) ? q(k).value.trim() : "");
  const out = card.querySelector("[data-sr-result]");
  const say = (cls, html) => { if (!out) return; out.className = `ps-result ${cls} sr-w`; out.innerHTML = html; };
  card.querySelectorAll("[data-sr-close]").forEach((b) => { b.onclick = async () => { if (!(await TPA.unsaved.leave("master:sources", "欄を閉じる"))) return; openKey = null; paintSources(); }; });
  const work = card.querySelector("[data-sr-work]"); if (work) work.onclick = () => goTab("worklog");
  const paths = card.querySelector("[data-sr-paths]"); if (paths) paths.onclick = () => goTab("paths");
  let jbox = card.querySelector("[data-jn-box]");
  const view = isView || (s && s.kind === "view");
  const mountJoin = () => {
    if (!jbox) return;
    // 元を替えたら、前の欄の受け口ごと捨てて新しい箱に組む（前の欄が押した手を受け続けない）
    const fresh = jbox.cloneNode(false); jbox.replaceWith(fresh); jbox = fresh;
    // 結合した表を作るとき: 「この元」は選んだ元（キーはまだ無い）。作った後は自分のキー（サーバーが元の表に当てる）
    const self = view ? { ...(s || {}), key: s ? s.key : "", base: val("base"), name: (mstate.data.sources.items.find((x) => x.key === val("base")) || {}).name || "元", joins: s ? s.joins : [] } : s;
    const j = MasterJoin.mount(jbox, { self, sources: mstate.data.sources.items, can, request: masterRequest, onChange: (v) => { q("joins").value = JSON.stringify(v); } });
    q("joins").value = JSON.stringify(j.value());
    if (view && !s && !j.value().length) card.querySelector("[data-jn-add]")?.click();     // 作るときは、相手を選ぶ所から
  };
  if (jbox && (s || view)) mountJoin();
  if (view && !s && q("base")) q("base").onchange = mountJoin;
  openSnap = formNow();
  const joinsNow = () => JSON.parse(val("joins") || "[]");
  if (view) {
    q("name").focus();
    card.querySelector("[data-sr-save]").onclick = () => saveSource(s, { name: val("name"), role: (s && s.role) || "その他", base: val("base"), place: "", table: "",
      equipColumn: (s && s.equipColumn) || "", equipMode: (s && s.equipMode) || "そのまま", listed: q("listed").value === "1", group: val("group"), joins: joinsNow() }, say);
    const del = card.querySelector("[data-sr-del]");
    if (del) del.onclick = () => { if (confirm(`結合した表「${s.name}」を消します。元と相手のデータ元は消えません。よろしいですか？`)) removeSource(s, say); };
    return;
  }
  if (!q("place")) {     // 作業実績: 結合だけを直す
    const sv = card.querySelector("[data-sr-save]");
    if (sv) sv.onclick = () => saveSource(s, { joins: joinsNow(), equipColumn: s.equipColumn, equipMode: s.equipMode, name: s.name, place: "", table: "", listed: true }, say);
    return;
  }
  TPA.pathPick(q("place"), { purpose: "sqlite", title: "データ元のファイル（.sqlite3）を選ぶ", note: "共有の .sqlite3 ファイルを選びます。",
    disabled: can ? false : `${readOnlyWhy("sources")}のため、選べません` });
  q("place").focus();
  card.querySelector("[data-sr-check]").onclick = async () => {
    say("wait", "確かめています…");
    const res = await masterRequest("/api/sources/check", TPA.json("POST", { place: val("place") || (s && s.placeDefault) || "", table: val("table"), equipColumn: val("equip"),
      role: val("role") || (s && s.role) || "" }));
    const x = res.data || {};
    say(x.ok ? "ok" : "ng", `${x.ok ? "✓" : "✕"} ${escapeHtml(x.message || x.error || "確かめられませんでした")}`);
  };
  card.querySelector("[data-sr-save]").onclick = () => saveSource(s, { name: val("name"), role: val("role"), place: val("place"), table: val("table"),
    equipColumn: val("equip"), equipMode: val("mode"), listed: q("listed") ? q("listed").value === "1" : true, joins: q("joins") ? joinsNow() : [], group: val("group") }, say);
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
    if (!res || res.ok) res = await putRow("lot", { "設備の列": f.equipColumn, "設備の取り出し方": f.equipMode, "結合": f.joins, base_rev: s.rev || 0 });
    mstate.data.paths = null;
  } else if (s && s.kind === "folder") {
    res = await putRow("work", { "設備の列": f.equipColumn, "設備の取り出し方": f.equipMode, "結合": f.joins, base_rev: s.rev || 0 });
  } else {
    res = await putRow(s ? s.key : null, { "表示名": f.name, "役割": f.role || (s && s.role) || "その他", "場所": f.place, "表": f.table,
      "設備の列": f.equipColumn, "設備の取り出し方": f.equipMode, "画面": f.listed ? "有" : "無", "結合": f.joins || [], "グループ": f.group || "",
      "元": f.base || "", "並び": (s && s.order) || "", base_rev: s ? s.rev || 0 : 0 });
  }
  if (res && res.status === 409 && res.data.kind === "conflict") { say("ng", "開いたあとに、ほかの PC がこのデータ元を変えました。読み直してから直してください。"); return; }
  if (res && !res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした")); return; }
  const key = s ? s.key : res.data.row["キー"];
  emit("tpa:settings-changed", { key: `sources.${key}` });
  emit("tpa:sources-changed", { key });
  openKey = null;
  if (f.group) newGroups = newGroups.filter((g) => g !== f.group);
  renderSources({ notice: ["ok", s ? `✓ ${escapeHtml(s.name)}を保存しました。全員の PC で次に読むときから効きます。`
    : `✓ ${f.base ? "結合した表を作りました" : "データ元を足しました"}。${f.listed ? (f.group ? `見出しの「${escapeHtml(f.group)}」のタブに札が出ます。` : "見出しにタブが出ます。") : "見出しのタブには出しません。"}`] });
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
