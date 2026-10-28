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
  shareDown, goTab, ensureTabLoaded, saveBy, renderWorklog } = M;
/* ナビは定義の順に見出しを作るので、「つなぎ先」の参照先・作業実績の後ろへ差し込む（後ろの定義をいったん外して付け直す） */
(() => {
  const keys = Object.keys(MASTER_DEFS), at = keys.indexOf("worklog") + 1, rest = keys.slice(at).map((k) => [k, MASTER_DEFS[k]]);
  rest.forEach(([k]) => delete MASTER_DEFS[k]);
  MASTER_DEFS.sources = { name: "data_sources", label: "データ元", group: "データ", api: "/api/sources", custom: true, admin: true,
    render: () => renderSources() };
  rest.forEach(([k, v]) => { MASTER_DEFS[k] = v; });
})();
mstate.data.sources = null;
let openKey = null;     // いま直す欄に変えているカード（"+" は足す欄）
let openSnap = "";      // 開いたときの欄の値（保存していない変更の見張り。版 3.43.0）
const formNow = () => JSON.stringify([...document.querySelectorAll("#masterSettings .sr-card.is-open [data-sr], #masterSettings .sr-card.is-open [data-sr-conn]")].map((x) => x.value));
const othDirty = () => { const i = document.querySelector("#masterSettings .sr-other [data-oth]"); return !!i && i.value !== (i.dataset.saved || ""); };
const srDirty = () => mstate.tab === "sources" && ((openKey != null && !!document.querySelector("#masterSettings .sr-card.is-open [data-sr], #masterSettings .sr-card.is-open [data-sr-conn]") && formNow() !== openSnap) || othDirty());
TPA.unsaved.watch("master:sources", { scope: "master", dirty: srDirty, discard: () => { openKey = null; openOther = null; },
  label: () => (openOther && !openKey ? "そのほかの接続の欄" : openKey === "+" ? "データ元を足す欄" : openKey === "+view" ? "結合した表を作る欄" : `データ元「${((mstate.data.sources || { items: [] }).items.find((x) => x.key === openKey) || {}).name || openKey}」の欄`),
  save: () => saveBy("#masterSettings .sr-card.is-open [data-sr-save], #masterSettings .sr-card.is-open [data-oth-save]", srDirty, "#masterSettings .sr-card.is-open [data-sr-result], #masterSettings .sr-card.is-open [data-oth-result]") });

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
  // ほかの画面の「データ元を開く」から来たとき: その元を開いて見せる（"others" は、そのほかの接続の見出しへ送る）
  const focus = mstate.focus; mstate.focus = "";
  if (focus && focus !== "others" && d.items.some((s) => s.key === focus)) { openKey = focus; openOther = null; openSec = "conn"; }
  paintSources(notice);
  if (focus === "others") box.querySelector(".sr-oh")?.scrollIntoView({ block: "start" });
  else if (focus) box.querySelector(".sr-card.is-open:not(.sr-other)")?.scrollIntoView({ block: "nearest" });
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
    if (!canHide(s)) return `<span class="sr-fixed" title="${escapeHtml(s.name)}のタブはアプリの決まったタブなので、いつも出ます（出す人はアクセス権限の「見出しのタブ」で決めます）">いつも出す</span>`;
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
      <tbody>${body}${openKey === "+" || openKey === "+view" ? formRow(null, openKey) : ""}${q ? "" : othersRows(d, COLS)}</tbody></table>
    ${q && !body ? `<p class="ps-hint">「${escapeHtml(q)}」に当たるデータ元はありません。</p>` : ""}
  </section>`;
  bindList(box, d, can);
  bindOthers(box, d);
  const open = box.querySelector(".sr-card.is-open:not(.sr-other)");
  if (open) bindSourceForm(open, d.items.find((x) => x.key === openKey) || null, can, openKey === "+view");
}
/* そのほかの接続（版 3.58.0。データ元ではない所: ロット問い合わせ・更新の置き場・ブラウザ。前の「参照先」のタブ）。
   データ元の行と同じ形（名前・いま効いている値・変える…）で並べ、開くとその行が欄になる。値は参照先の項目（PUT /api/settings/<項目>） */
let openOther = null;
const OTHER_PICK = {
  exe: { purpose: "exe", title: "ブラウザの実行ファイル（.exe）を選ぶ", note: "ふつうは空のままで構いません（Edge を自動で探します）。" },
  release: { purpose: "release", title: "更新の置き場を選ぶ", note: "版ごとのフォルダ（release.json がある）が並ぶフォルダを選びます（印: 版の置き場）。", exclude: ["release"] },
};
const otherName = (o) => String(o.label || o.key).replace(/（.*$/, "");
function othersRows(d, cols) {
  const list = d.others || [];
  if (!list.length) return "";
  const can = d.othersCanEdit && !shareDown();
  const head = `<tr class="sr-gh sr-oh"><td colspan="${cols}"><b>そのほかの接続</b><small>データ元ではない所（${list.map(otherName).join("・")}）</small></td></tr>`;
  return head + list.map((o) => {
    const eff = connText(o.effective), changed = o.source === "master";
    if (o.key === openOther) return `<tr class="sr-formrow"><td colspan="${cols}"><section class="sr-card is-open sr-other" data-other="${escapeHtml(o.key)}">
      <div class="sr-name"><b>${escapeHtml(otherName(o))}</b><span class="ps-badge ${changed ? "changed" : "default"}">${changed ? "マスタで変更" : "既定（配った設定）"}</span></div>
      <div class="sr-form"><p class="ps-hint sr-w">${escapeHtml(o.hint || "")}</p>
        <label class="sr-w"><span>${escapeHtml(o.label)}</span><span class="sr-row"><input class="ps-input" data-oth value="${escapeHtml(connText(o.value))}" data-saved="${escapeHtml(connText(o.value))}" spellcheck="false"
          placeholder="既定: ${escapeHtml(connText(o.default) || "（空）")}"${can ? "" : " disabled"}></span><small class="sr-conn-h">いま効いている値: ${escapeHtml(eff || "（空）")}</small></label>
        <div class="sr-acts sr-w"><button type="button" class="ps-check" data-oth-check>確かめる</button><button type="button" class="btn-primary" data-oth-save${can ? "" : " disabled"}>保存</button>
          <button type="button" class="ps-reset" data-oth-reset${changed && can ? "" : " disabled"} title="マスタの値を消して、配った設定（既定）に戻します">既定に戻す</button>
          ${o.key === "lotdsp_import.url" ? '<a class="btn-ghost" href="/lotdsp-link" title="LotDsp の API の項目と画面の見出しの紐づけを調べます（読むだけ）">LotDsp の項目を調べる</a>' : ""}
          <span class="sr-sp"></span><button type="button" class="btn-ghost" data-oth-close>閉じる</button></div>
        <div class="ps-result hidden sr-w" data-oth-result aria-live="polite"></div></div></section></td></tr>`;
    return `<tr class="sr-row sr-orow" data-other="${escapeHtml(o.key)}"><td class="sr-gp"></td><td class="sr-nm" data-oth-open="${escapeHtml(o.key)}"><b>${escapeHtml(otherName(o))}</b></td>
      <td class="sr-file" colspan="${cols - 3}" title="${escapeHtml(eff)}"><span class="sr-fname">${escapeHtml(eff || "（空）")}</span>${changed ? "" : ' <span class="sr-dflt">既定</span>'}</td>
      <td class="sr-ac"><button type="button" class="pz-btn sr-edit" data-oth-open="${escapeHtml(o.key)}">${can ? "変える…" : "見る"}</button></td></tr>`;
  }).join("");
}
function bindOthers(box, d) {
  box.querySelectorAll("[data-oth-open]").forEach((b) => { b.onclick = async () => {
    if (!(await TPA.unsaved.leave("master:sources", "ほかの接続を開く"))) return; openKey = null; openOther = b.dataset.othOpen; paintSources(); }; });
  const card = box.querySelector(".sr-other");
  if (!card) return;
  const o = (d.others || []).find((x) => x.key === card.dataset.other), input = card.querySelector("[data-oth]"), out = card.querySelector("[data-oth-result]");
  const say = (cls, html) => { out.className = `ps-result ${cls} sr-w`; out.innerHTML = html; };
  const pp = OTHER_PICK[o.kind];
  if (pp) TPA.pathPick(input, { ...pp, disabled: d.othersCanEdit ? false : `${readOnlyWhy("paths")}のため、選べません` });
  input.focus({ preventScroll: true });
  card.scrollIntoView({ block: "nearest" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") card.querySelector("[data-oth-save]").click(); });
  card.querySelector("[data-oth-close]").onclick = async () => { if (!(await TPA.unsaved.leave("master:sources", "欄を閉じる"))) return; openOther = null; paintSources(); };
  card.querySelector("[data-oth-check]").onclick = async () => {
    say("wait", "確かめています…");
    const r = await masterRequest(o.check_url || "/api/settings/check", TPA.json("POST", { key: o.key, value: input.value }));
    const x = r.status === 404 ? { ok: false, message: "デスクトップ版で開いたときだけ確かめられます。" } : (r.data || {});
    say(x.ok ? "ok" : "ng", `${x.ok ? "✓" : "✕"} ${escapeHtml(x.message || x.error || "確かめられませんでした")}`);
  };
  const send = async (value) => {
    say("wait", "保存しています…");
    const res = await withLockWait(() => masterRequest(`/api/settings/${encodeURIComponent(o.key)}`, TPA.json("PUT", { value, base_rev: o.rev || 0 })),
      (x) => say("wait", lockWaitText(x, "保存", boldName)));
    if (res.status === 409 && res.data.kind === "conflict") { say("ng", "開いたあとに、ほかの PC がこの項目を変えました。読み直してから直してください。"); return; }
    if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした")); return; }
    emit("tpa:settings-changed", { key: o.key });
    mstate.data.paths = null;
    openOther = null;
    renderSources({ notice: ["ok", value === "" ? `✓ ${escapeHtml(otherName(o))}を既定に戻しました。` : `✓ ${escapeHtml(otherName(o))}を保存しました。すぐ効きます（ほかの PC にも数秒で届きます）。`] });
  };
  card.querySelector("[data-oth-save]").onclick = () => send(input.value.trim());
  card.querySelector("[data-oth-reset]").onclick = () => { if (confirm(`${otherName(o)}を配った設定（既定）に戻します。全員の PC に効きます。よろしいですか？`)) send(""); };
}
const notice = (cls, html) => { const n = $("#srNotice"); if (!n) return; n.className = `ps-result ${cls}`; n.innerHTML = html; };
function bindList(box, d, can) {
  const open = async (key, why) => { if (!(await TPA.unsaved.leave("master:sources", why))) return; if (key !== openKey) openSec = "conn"; openKey = key; openOther = null; paintSources(); };
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
    { label: "変える…", icon: "✎", run: () => { if (key !== openKey) openSec = "conn"; openKey = key; openOther = null; paintSources(); } },
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
    return `<label class="sr-conn sr-w2" data-conn-f="${f.id}"><span>${escapeHtml(f.label)}</span>
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
    if (pp) TPA.pathPick(el, { ...pp, start: () => connText(f.effective ?? f.default), pattern: f.kind === "folder" ? () => (card.querySelector('[data-sr-conn="pattern"]') || {}).value || "" : undefined,
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
  // 段の要約も、読めた列で中身と同じ言葉に（「自動（見つけた列: …）」）
  const sum = sel.closest(".sr-card")?.querySelector('.sr-sec[data-sec="lot"] .sr-sum');
  if (sum && !cur) sum.textContent = `自動（${auto ? `見つけた列: ${auto}` : "見つかる列は無い"}）`;
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

/* 直す欄（開いた行の中。版 3.58.0。決め方: ui-proposals/2026-10-unify-2 の C3）。s: データ元（null なら足す）。isView: 結合した表を作る。
   どの元も同じ 5 つの畳める段（名前とタブ・接続・設備・ロット番号の列・結合）。段の見出しは 1 つのボタンで、今の値の要約を出す
   （開かなくても値が読める）。押した段だけ開く（ほかは畳む。どの段を開いたかは、ほかの元を開いても続く） */
let openSec = "conn";     // 開いている段（同じ元を描き直しても続く。ほかの元を開くと「接続」から）
const tailOf = (p) => { const parts = String(p || "").split(/[\\/]/).filter(Boolean); return parts.length > 2 ? `…${sepOf(p)}${parts.slice(-2).join(sepOf(p))}` : String(p || ""); };
const fixedTab = (s) => s && !canHide(s);
const groupable = (s) => !s || (s.key !== "lot" && s.key !== "work");
const connOf = (s) => (s ? s.conn || [] : mstate.data.sources.newConn || []);
/** 接続の段の要約: 場所（後ろの 2 つ。全部は題に）・決まり・間隔・警告 */
function connSummary(list) {
  const f = (id) => list.find((x) => x.id === id), eff = (id) => connText((f(id) || {}).effective ?? (f(id) || {}).value);
  const where = eff("place") || eff("folder") || eff("url");
  const bits = [where ? `<span class="sr-sum-p" title="${escapeHtml(where)}">${escapeHtml(tailOf(where))}</span>` : '<span class="sr-sum-bad">場所が決まっていません</span>'];
  if (eff("pattern")) bits.push(escapeHtml(eff("pattern")));
  if (eff("table")) bits.push(`表 ${escapeHtml(eff("table"))}`);
  if (eff("equipments")) bits.push(`設備 ${escapeHtml(eff("equipments"))}`);
  if (eff("refresh")) bits.push(`${escapeHtml(eff("refresh"))} 秒ごと`);
  if (f("stale")) bits.push(+eff("stale") ? `${escapeHtml(eff("stale"))} 時間で警告` : "古さの警告なし");
  return bits.join("<i>・</i>");
}
function lotSummary(s) {
  const v = connText(((connOf(s).find((x) => x.id === "lot")) || {}).value);
  return v === "-" ? "なし（ロット番号の列は無い）" : v ? `この列: <b>${escapeHtml(v)}</b>` : "自動（名前で探す）";
}
function equipSummary(s) {
  if (s.kind === "folder") {
    const wl = mstate.data.worklog;
    if (!wl) return `${s.equipCount ?? "-"} 台を表示`;
    const bad = wl.items.filter((x) => x.state === "missing" || x.stale);
    return `<b>${wl.items.length} 台</b>（表示 ${wl.items.filter((x) => x.visible).length}）` + bad.map((x) => `<span class="sr-tag ${x.state === "missing" ? "is-bad" : "is-warn"}">${escapeHtml(x.name)} ${x.state === "missing" ? "見つからない" : "古い"}</span>`).join("");
  }
  return s.equipColumn ? `設備の列 <b>${escapeHtml(s.equipColumn)}</b>（${escapeHtml(s.equipMode)}）` : "設備は見分けない";
}
function formOf(s, can, isView = false) {
  const d = mstate.data.sources, dis = can ? "" : " disabled";
  const view = isView || (s && s.kind === "view");
  const v = s || { name: "", role: "その他", equipColumn: "", equipMode: "そのまま", listed: true, groupSet: "", base: "" };
  const opt = (list, cur) => list.map((x) => `<option${x === cur ? " selected" : ""}>${escapeHtml(x)}</option>`).join("");
  const groups = [...new Set(d.items.map((x) => x.group).filter(Boolean).concat(newGroups))];
  // 段 1: 名前とタブ
  const bases = d.items.filter((x) => x.kind === "file");
  const curBase = v.base || (bases.some((b) => b.key === viewBase) ? viewBase : (bases[0] || {}).key);
  const nameSec = `<label><span>表示名${s && s.builtin ? "（空なら元の名前）" : ""}</span><input class="ps-input" data-sr="name" value="${escapeHtml(v.name)}" placeholder="${view ? "例: 品質＋製造条件" : s && s.builtin ? escapeHtml(s.name) : "例: 製造条件マスタ"}" maxlength="24"${dis}></label>`
    + (view ? `<label><span>元（この表の行）</span><select data-sr="base"${dis}${s ? ' title="元を替えるときは、結合した表を作り直してください"' : ""}>${bases.map((b) => `<option value="${escapeHtml(b.key)}"${b.key === curBase ? " selected" : ""}${s && b.key !== curBase ? " disabled" : ""}>${escapeHtml(b.name)}${b.listed ? "" : "（出さない）"}</option>`).join("")}</select></label>`
      : s && s.builtin ? "" : `<label><span>役割</span><select data-sr="role"${dis}>${opt(d.roles, v.role)}</select></label>`)
    + (fixedTab(s) ? `<p class="ps-hint">見出しのタブ「${escapeHtml(v.name)}」はアプリの決まったタブなので、いつも出ます（出す人はアクセス権限の「見出しのタブ」で決めます）。</p>`
      : `<label><span>見出しのタブ</span><select data-sr="listed"${dis}><option value="1"${v.listed ? " selected" : ""}>出す</option><option value="0"${v.listed ? "" : " selected"}>出さない（結合・ダッシュボードだけに使う）</option></select></label>`)
    + (groupable(s) ? `<label><span>グループ（空ならグループなし）</span><input class="ps-input" data-sr="group" value="${escapeHtml(v.groupSet === "-" ? "" : v.groupSet || "")}" list="srGroups" maxlength="24" placeholder="例: 台帳"${dis}>
      <datalist id="srGroups">${groups.map((g) => `<option value="${escapeHtml(g)}">`).join("")}</datalist></label>` : "");
  const nameSum = `${escapeHtml(v.name || (view ? "（名前を入れる）" : "（名前を入れる）"))}<i>・</i>${fixedTab(s) ? "いつも出す" : v.listed ? "タブに出す" : "タブに出さない"}${v.group ? `<i>・</i>グループ ${escapeHtml(v.group)}` : ""}${view ? `<i>・</i>元 ${escapeHtml((bases.find((b) => b.key === curBase) || {}).name || "")}` : ""}`;
  // 段 2: 接続（結合した表は元の物を使うので持たない）
  const conn = view ? [] : connOf(s).filter((f) => f.id !== "lot");
  const connSec = conn.length ? `<div class="sr-cgrid">${conn.map((f) => connField(f, can, s ? "" : "_new")).join("")}</div>`
    + (s && s.kind === "folder" ? '<p class="ps-hint">フォルダ・ファイル名の決まりを保存すると、設備を探し直して「設備」の段に並べます。</p>' : "") : "";
  // 段 3: 設備（実績はフォルダで見つけた設備の一覧〈作業実績の頁と同じ部品〉。1 ファイルの元は設備の列）
  const equipSec = !s && view ? "" : s && s.kind === "folder" ? '<div class="sr-wl" data-sr-wl><p class="ps-loading">設備を読んでいます…</p></div>'
    : s && (s.kind === "cm3" || view) ? ""
    : `<div class="sr-cgrid"><label><span>設備の列（空なら見分けない）</span><input class="ps-input" data-sr="equip" value="${escapeHtml(v.equipColumn)}"${dis}></label>
      <label><span>設備の取り出し方</span><select data-sr="mode"${dis}>${opt(d.equipModes, v.equipMode)}</select></label></div>`;
  // 段 4: ロット番号の列
  const lotF = connOf(s).find((f) => f.id === "lot");
  const lotSec = lotF ? `<div class="sr-cgrid">${connField(lotF, can, s ? "" : "_new")}</div><p class="ps-hint">${escapeHtml(lotF.hint || "")}</p>` : "";
  // 段 5: 結合（足す欄では出さない: キーが決まってから。結合した表は作るときから組む）
  const joinSec = s || view ? '<div class="jn" data-jn-box></div><input type="hidden" data-sr="joins">' : '<p class="ps-hint">ほかのデータ元との結合は、足した後でこの行を開くと組めます。</p>';
  const joinSum = s && (s.joins || []).length ? escapeHtml(s.joinText || `${s.joins.length} つ`) : view && !s ? "相手を選ぶ" : "なし";
  const secs = [["name", "名前とタブ", nameSum, nameSec], ["conn", "接続", conn.length ? connSummary(conn) : "", connSec],
    ["equip", "設備", equipSec ? (s ? equipSummary(s) : "設備の列で見分ける") : "", equipSec], ["lot", "ロット番号の列", lotSec ? lotSummary(s) : "", lotSec],
    ["join", "結合", joinSum, joinSec]].filter((x) => x[3]);
  const first = secs.some((x) => x[0] === openSec) ? openSec : (view ? "name" : secs.some((x) => x[0] === "conn") ? "conn" : secs[0][0]);
  const isLot = s && s.key === "lot";
  const reset = s && (isLot ? s.placeChanged : s.key === "wip" && s.id) && can;
  return `<div class="sr-form">
    <div class="sr-acc sr-w">${secs.map(([id, title, sum, body]) => `<section class="sr-sec${id === first ? " is-open" : ""}" data-sec="${id}">
      <button type="button" class="sr-sh" data-sr-sec="${id}" aria-expanded="${id === first}"><span class="sr-car" aria-hidden="true">${id === first ? "▾" : "▸"}</span><b>${title}</b><span class="sr-sum">${sum}</span></button>
      <div class="sr-sb"${id === first ? "" : " hidden"}>${body}</div></section>`).join("")}</div>
    <div class="sr-acts sr-w">
      ${view ? "" : `<button type="button" class="ps-check" data-sr-check title="保存する前に、その場所で本当に読めるかを確かめます">確かめる</button>`}
      <button type="button" class="btn-primary" data-sr-save${dis}>${s ? "保存" : view ? "作る" : "足す"}</button>
      ${reset ? '<button type="button" class="ps-reset" data-sr-reset title="配った設定（既定）に戻します">既定に戻す</button>' : ""}
      ${s && !s.builtin && can ? `<button type="button" class="pz-btn danger" data-sr-del>${view ? "この結合した表を消す" : "このデータ元を消す"}</button>` : ""}
      <span class="sr-sp"></span><button type="button" class="btn-ghost" data-sr-close>閉じる</button>
    </div>
    <div class="ps-result hidden sr-w" data-sr-result aria-live="polite"></div></div>`;
}
function bindSourceForm(card, s, can, isView = false) {
  const q = (k) => card.querySelector(`[data-sr="${k}"]`), val = (k) => (q(k) ? q(k).value.trim() : "");
  const out = card.querySelector("[data-sr-result]");
  const say = (cls, html) => { if (!out) return; out.className = `ps-result ${cls} sr-w`; out.innerHTML = html; };
  const view = isView || (s && s.kind === "view");
  card.querySelectorAll("[data-sr-close]").forEach((b) => { b.onclick = async () => { if (!(await TPA.unsaved.leave("master:sources", "欄を閉じる"))) return; openKey = null; paintSources(); }; });
  // 段の開け閉め（押した段だけ開く）
  const openSecAt = (id, focus = false) => {
    openSec = id;
    card.querySelectorAll(".sr-sec").forEach((sec) => {
      const on = sec.dataset.sec === id;
      sec.classList.toggle("is-open", on);
      sec.querySelector(".sr-sh").setAttribute("aria-expanded", String(on));
      sec.querySelector(".sr-car").textContent = on ? "▾" : "▸";
      sec.querySelector(".sr-sb").hidden = !on;
    });
    if (!focus) return;
    // 開いた段の見出しから見せる（下の段を開いても、中身が保存の段の下に隠れない）
    const sec = card.querySelector(`.sr-sec[data-sec="${id}"]`);
    sec.scrollIntoView({ block: "start" });
    sec.querySelector(".sr-sb input:not([type=hidden]), .sr-sb select")?.focus({ preventScroll: true });
  };
  card.querySelectorAll("[data-sr-sec]").forEach((b) => { b.onclick = () => openSecAt(b.dataset.srSec, true); });
  bindConn(card, s || { key: "+", conn: mstate.data.sources.newConn || [] }, can);
  // 実績の設備: 作業実績の頁と同じ部品を、この段の中に描く（読めたら段の要約も今の台数・直すことに）
  const wl = card.querySelector("[data-sr-wl]");
  if (wl && renderWorklog) renderWorklog({ box: wl, embed: true }).then(() => { const sum = card.querySelector('.sr-sec[data-sec="equip"] .sr-sum'); if (sum && mstate.data.worklog) sum.innerHTML = equipSummary(s); });
  let jbox = card.querySelector("[data-jn-box]");
  const mountJoin = () => {
    if (!jbox) return;
    // 元を替えたら、前の欄の受け口ごと捨てて新しい箱に組む（前の欄が押した手を受け続けない）
    const fresh = jbox.cloneNode(false); jbox.replaceWith(fresh); jbox = fresh;
    // 結合した表を作るとき: 「この元」は選んだ元（キーはまだ無い）。作った後は自分のキー（サーバーが元の表に当てる）
    const self = view ? { ...(s || {}), key: s ? s.key : "", base: val("base"), name: (mstate.data.sources.items.find((x) => x.key === val("base")) || {}).name || "元", joins: s ? s.joins : [] } : s;
    const j = MasterJoin.mount(jbox, { self, sources: mstate.data.sources.items, can, request: masterRequest, onChange: (x) => { q("joins").value = JSON.stringify(x); } });
    q("joins").value = JSON.stringify(j.value());
    if (view && !s && !j.value().length) card.querySelector("[data-jn-add]")?.click();     // 作るときは、相手を選ぶ所から
  };
  if (jbox && (s || view)) mountJoin();
  if (view && !s && q("base")) q("base").onchange = mountJoin;
  openSnap = formNow();
  const joinsNow = () => JSON.parse(val("joins") || "[]");
  const first = card.querySelector(".sr-sec.is-open .sr-sb input:not([type=hidden]), .sr-sec.is-open .sr-sb select");
  if (first) first.focus();
  const chk = card.querySelector("[data-sr-check]");
  if (chk) chk.onclick = async () => {
    say("wait", "確かめています…");
    const c = (id) => card.querySelector(`[data-sr-conn="${id}"]`);
    const main = ["place", "folder", "url"].find((id) => c(id));
    let res;
    if (!s || s.kind === "file") {        // 1 ファイルの元: 表・設備の列まで確かめる
      const f = connOf(s).find((x) => x.id === "place") || {};
      res = await masterRequest("/api/sources/check", TPA.json("POST", { place: (c("place") || {}).value?.trim() || connText(f.default), table: (c("table") || {}).value?.trim() || "",
        equipColumn: val("equip"), role: val("role") || (s && s.role) || "" }));
    } else {
      res = await masterRequest(`/api/sources/${encodeURIComponent(s.key)}/conn/check`, TPA.json("POST", { field: main, value: c(main).value.trim() }));
    }
    const x = res.data || {};
    say(x.ok ? "ok" : "ng", `${x.ok ? "✓" : "✕"} ${escapeHtml(x.message || x.error || "確かめられませんでした")}`);
  };
  card.querySelector("[data-sr-save]").onclick = () => {
    const base = s || {};
    const f = { name: val("name"), role: val("role") || base.role || "その他", listed: q("listed") ? q("listed").value === "1" : true, group: val("group"),
      base: val("base") || base.base || "", joins: q("joins") ? joinsNow() : [], equipColumn: q("equip") ? val("equip") : base.equipColumn || "",
      equipMode: q("mode") ? val("mode") : base.equipMode || "そのまま", conn: connChanges(card, s || { conn: mstate.data.sources.newConn || [] }) };
    saveSource(s, f, say);
  };
  const del = card.querySelector("[data-sr-del]");
  if (del) del.onclick = () => { if (confirm(view ? `結合した表「${s.name}」を消します。元と相手のデータ元は消えません。よろしいですか？` : `データ元「${s.name}」を消します。全員の PC で見出しのタブが無くなります。よろしいですか？`)) removeSource(s, say); };
  const reset = card.querySelector("[data-sr-reset]");
  if (reset) reset.onclick = () => { if (confirm(`${s.name}の場所を、配った設定（既定）に戻します。全員の PC に効きます。よろしいですか？`)) resetSource(s, say); };
}
/* 既定に戻す: 品質は接続の設定の場所・表を空に（参照先の既定へ）、仕掛はこのマスタの行を消す */
async function resetSource(s, say) {
  if (s.key !== "lot") { removeSource(s, say); return; }
  say("wait", "戻しています…");
  const list = (s.conn || []).filter((f) => (f.id === "place" || f.id === "table") && connText(f.value) !== "").map((f) => ({ field: f.id, value: "", rev: f.rev || 0 }));
  const bad = await saveConnSettings(s, list, say);
  if (bad) { say("ng", "✕ " + escapeHtml(bad.data.error || "戻せませんでした")); return; }
  renderSources({ notice: ["ok", `✓ ${escapeHtml(s.name)}の場所を既定に戻しました。`] });
}

async function saveSource(s, f, say) {
  say("wait", "保存しています…");
  // 参照先に結ぶ接続の設定（品質・実績・スケジュール）を先に置き、残り（このマスタの行）を 1 回で置く
  const bad = s ? await saveConnSettings(s, f.conn.settings, say) : null;
  if (bad) {
    say("ng", bad.status === 409 && bad.data.kind === "conflict" ? "開いたあとに、ほかの PC がこの設定を変えました。読み直してから直してください。" : "✕ " + escapeHtml(bad.data.error || "保存できませんでした"));
    return;
  }
  const body = { "表示名": f.name, "画面": f.listed ? "有" : "無", "結合": f.joins, "設備の列": f.equipColumn, "設備の取り出し方": f.equipMode, ...f.conn.row };
  if (!s || !s.builtin) Object.assign(body, { "役割": f.role, "元": f.base });
  if (groupable(s)) body["グループ"] = f.group;
  const res = await withLockWait(() => masterRequest(s ? `/api/sources/${encodeURIComponent(s.key)}` : "/api/sources", TPA.json(s ? "PUT" : "POST", { ...body, base_rev: s ? s.rev || 0 : 0 })),
    (x) => say("wait", lockWaitText(x, "保存", boldName)));
  if (res.status === 409 && res.data.kind === "conflict") { say("ng", "開いたあとに、ほかの PC がこのデータ元を変えました。読み直してから直してください。"); return; }
  if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした")); return; }
  const key = s ? s.key : res.data.row["キー"];
  emit("tpa:settings-changed", { key: `sources.${key}` });
  emit("tpa:sources-changed", { key });
  // 実績のフォルダ・決まりを変えたら、開いたまま設備の段で探し直した設備を見せる（次の手を先に出す）
  const rescan = s && s.kind === "folder" && f.conn.settings.some((c) => c.field === "folder" || c.field === "pattern");
  openKey = rescan ? s.key : null;
  if (rescan) { openSec = "equip"; mstate.data.worklog = null; }
  if (f.group) newGroups = newGroups.filter((g) => g !== f.group);
  renderSources({ notice: ["ok", rescan ? `✓ ${escapeHtml(f.name || s.name)}を保存し、新しいフォルダで設備を探し直しました。`
    : s ? `✓ ${escapeHtml(f.name || s.name)}を保存しました。全員の PC で次に読むときから効きます。`
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
