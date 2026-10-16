/* =========================================================================
   マスタ管理(設備マスタ / ロールマスタ)
   - 別ページに遷移せず、解析画面の上にオーバーレイで開く(SPA として一体化)。
   - 一覧は代表列のみ表示し、詳細な追加・修正はフォームダイアログに委ねる
     (Progressive Disclosure: 一度に見せる情報量を絞り、認知負荷を抑える)。
   - 保存/削除に成功したら解析画面を再計算し、マスタ変更を即座に反映する。
   - 置き場（手元のみ／共有）はサーバーの master_store が答える。共有のときは:
       ・開いている間は数秒ごとに版を見て、ほかの PC の変更を読み込む（読んだことを帯で言う）
       ・保存中の PC がいれば（409 locked）自動で待って保存し直す（錠は20秒で切れる）
       ・開いたあとに同じ行が変わった／消えた（409 conflict）ら、相手と自分の値を並べて選んでもらう
       ・共有に届かない（503）あいだは、追加・編集・削除を押せなくして理由を言う
   - 解析画面とは合図（イベント）だけでつながる（相手の変数・関数に触らない）:
       tpa:masters-changed … マスタが変わった（保存・削除・ほかの PC の変更を読んだ）→ 解析画面が計算し直す
       tpa:masters-closed  … 閉じた（検査計・自分の権限を直したかもしれない）→ 解析画面が引き直す
       tpa:settings-changed… 参照先を保存した → 解析画面・一覧が設定を取り直す
       tpa:error           … 解析画面のエラー欄に出してほしい失敗（detail は文言）
   ========================================================================= */
(function () {
"use strict";
const { $, esc: escapeHtml } = TPA;
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
const fail = (message) => emit("tpa:error", message);

const MASTER_DEFS = {
  equipment: {
    name: "equipment_master",
    label: "設備マスタ", group: "データ",
    api: "/api/masters/equipment",
    idField: "設備名",
    searchPlaceholder: "設備名・同一工程の名前で検索",
    // kind: 値の見せ方（cellHtml）。w: 列の幅（中身に合わせる）。grow: 余りを受ける列
    listColumns: [
      { key: "設備名", label: "設備名", kind: "name", w: "9em" },
      { key: "巻取方向", label: "巻取方向", kind: "rewind", w: "8em" },
      { key: "ライン方向", label: "ライン方向", kind: "line", w: "8.5em" },
      { key: "検査計", label: "検査計", kind: "meter", w: "6em" },
      { key: "同一工程", label: "同一工程とみなす名前", kind: "aliases", grow: true },
    ],
    searchKeys: ["設備名", "巻取方向", "ライン方向", "同一工程", "検査計"],
    emptyLabel: "設備",
    formFields: [
      { key: "設備名", label: "設備名", type: "text", required: true, placeholder: "例: L-3", full: true },
      { key: "巻取方向", label: "巻取方向", type: "select", options: ["", "上", "下", "-"] },
      { key: "ライン方向", label: "ライン方向", type: "select", options: ["", "←", "→", "-"] },
      { key: "検査計", label: "検査計", type: "select", options: ["", "有"],
        hint: "「有」の設備が発見設備の候補です。取り込んだロットの実績の設備のうち、検査計がある最後の設備を発見設備に自動で選びます（手ではどの設備でも選べます）。" },
      { key: "同一工程", label: "同一工程とみなす名前（LotDsp で別の名前・番号付きで出てくるとき）", type: "text", full: true,
        placeholder: "例: ANI*, ANF*　／　CAI*, CAF*, CAL*",
        hint: "カンマ区切り。* は「どんな文字でも・無くてもよい」（ANI* → ANI・ANI1・ANI12）、? は「どれか1文字」。取込ではこの設備名に読み替えます。番号に意味がある設備（L-1・L-2 など）は登録しないでください。" },
    ],
  },
  rolls: {
    name: "roll_master",
    label: "ロールマスタ", group: "データ",
    api: "/api/masters/rolls",
    idField: "ロール名",
    searchPlaceholder: "設備・ロール名・基準番号・材質で検索",
    listColumns: [
      { key: "設備", label: "設備", kind: "name", w: "9.5em" },
      { key: "ロール名", label: "ロール名", grow: true },
      { key: "入出位置", label: "入出位置", kind: "chip", w: "6.5em" },
      { key: "接触面", label: "接触面", kind: "chip", w: "6.5em" },
      { key: "ロール径MAX", label: "径 MAX", num: true, unit: "mm", w: "7.5em" },
      { key: "ロール径MIN", label: "径 MIN", num: true, unit: "mm", w: "7.5em" },
      { key: "基準番号", label: "基準番号", w: "11em" },
    ],
    searchKeys: ["設備", "ロール名", "基準番号", "備考", "ロール使用条件", "材質"],
    emptyLabel: "ロール",
    formFields: [
      { key: "設備", label: "設備", type: "text", required: true, placeholder: "例: TLV" },
      { key: "ロール名", label: "ロール名", type: "text", placeholder: "例: 入側ピンチロール" },
      { key: "入出位置", label: "入出位置", type: "select", options: ["ー", "入側", "出側"] },
      { key: "接触面", label: "接触面", type: "select", options: ["", "上", "下", "上下"] },
      { key: "ロール径MAX", label: "ロール径MAX (mm)", type: "text", placeholder: "数値、または ― " },
      { key: "ロール径MIN", label: "ロール径MIN (mm)", type: "text" },
      { key: "ロール面長", label: "ロール面長 (mm)", type: "text" },
      { key: "材質", label: "材質", type: "text" },
      { key: "硬度", label: "硬度", type: "text" },
      { key: "本数", label: "本数", type: "text" },
      { key: "駆動方式", label: "駆動方式", type: "text" },
      { key: "基準番号", label: "基準番号", type: "text" },
      { key: "ロール使用条件", label: "使用条件", type: "text", full: true },
      { key: "備考", label: "備考", type: "textarea", full: true },
    ],
  },
};

/* 勤務体系（直の時間帯。services/shifts.py）: 作業実績を「日＋直ごと」に数える決まり。WaveLog の勤務体系マスタの編集画面を移した（現場のマスタ）。
   ナビは定義の順に見出しを作るので、同じ「データ」の設備・ロールの直後に置く。 */
MASTER_DEFS.shifts = { name: "shift_patterns", label: "勤務体系", group: "データ", api: "/api/masters/shifts", custom: true, render: () => renderShifts() };
/* 参照先（読みに行く場所）。表ではなくカードで出す特別なタブ（custom）。中身は /api/settings の items */
MASTER_DEFS.paths = { name: "path_settings", label: "参照先", group: "つなぎ先", api: "/api/settings", custom: true, admin: true };
/* 作業実績（設備ごとの実績ファイル）: フォルダを探して設備を見つけ、設備ごとに表示する・しない・結ぶファイルを決める（管理のマスタ）。
   表示ルール（表示列・条件など）は行のキーに結ぶので、ファイルの名前が変わっても設備ごとの見え方は続く（services/work_log.py） */
MASTER_DEFS.worklog = { name: "work_log_files", label: "作業実績", group: "つなぎ先", api: "/api/masters/worklog", custom: true, admin: true,
  render: () => renderWorklog() };
/* マスタの置き場（共有フォルダ）。見るのはだれでも、変えるのは開発者・メンテナンス者（サーバーの門番 _release_place_gate）。
   ナビの項目には、頁を開かなくても分かるように今の状態の札（手元・共有・届かない）を添える。 */
MASTER_DEFS.place = { name: "master_place", label: "マスタの置き場", group: "管理", api: "/api/masters/place", custom: true, render: () => renderMasterPlace() };
/* アクセス権限（管理のマスタ）。判定はサーバー（services/access.py）の1箇所。画面は選択欄と印を出すだけ。 */
MASTER_DEFS.access = {
  name: "access_permissions", label: "アクセス権限", group: "管理", api: "/api/masters/access", idField: "ログインID", admin: true,
  parse: (d) => { mstate.meta.access = d; return d.items || []; },
  searchPlaceholder: "ログインID・PC名・権限区分で検索",
  listColumns: [
    { key: "ログインID", label: "ログインID", kind: "ident", w: "9em", anyText: "（だれでも）" },
    { key: "PC名", label: "PC名", kind: "ident", w: "9em", anyText: "（どの PC でも）" },
    { key: "権限区分", label: "権限区分", kind: "role", w: "8em" },
    { key: "マスタ編集", label: "マスタ編集", kind: "medit", w: "8em" },
    { key: "有効", label: "有効", kind: "enabled", w: "5em" },
    { key: "備考", label: "備考", grow: true },
  ],
  searchKeys: ["ログインID", "PC名", "権限区分", "マスタ編集", "備考"],
  emptyLabel: "権限",
  rowNote: (row) => (mstate.meta.access && row.id === mstate.meta.access.matchedId ? '<span class="m-chip c-me" title="この PC・このログインの権限を決めている行">あなた</span>' : ""),
  formFields: [
    { key: "ログインID", label: "ログインID（空＝だれでも）", type: "text", placeholder: "例: satoshi-harada" },
    { key: "PC名", label: "PC名（空＝どの PC でも）", type: "text", placeholder: "例: NLM-NGY-252134" },
    { key: "権限区分", label: "権限区分", type: "select", options: () => (mstate.meta.access || {}).roles || ["一般ユーザー"],
      hint: "開発者 > メンテナンス者 > 一般ユーザー > 設備作業者。自分の区分は自分では変えられず、自分と同格以上の区分は与えられません。" },
    { key: "マスタ編集", label: "マスタ編集", type: "select", options: () => (mstate.meta.access || {}).masterEditLevels || ["編集可"],
      hint: "非表示＝マスタ管理を出さない／閲覧のみ／部分的編集可＝設備・ロールだけ書ける／編集可＝参照先・アクセス権限も書ける。区分の上限を超えては与えられません（設備作業者は非表示まで）。" },
    { key: "有効", label: "有効", type: "select", options: ["有", "無"] },
    { key: "備考", label: "備考", type: "text", full: true },
  ],
};
/* 利用状況（だれが・どの PC で・どの版を）。見られる区分だけにタブを出す。 */
MASTER_DEFS.presence = { name: "presence", label: "利用状況", group: "管理", api: "/api/presence", custom: true, render: () => renderPresence(),
  visible: (me) => !!me.canViewPresence };
/* アプリの配布（版 3.4.0・WaveLog と同じ流れ）: ① 版を置く → ② 配る版を選ぶ → ③ 各 PC がそろう。
   答えるのは窓（desktop/src/distribute.rs）。置く・配るは開発者・メンテナンス者だけ（決めるのは services/access.py）。 */
MASTER_DEFS.release = { name: "release", label: "アプリの配布", group: "管理", api: "/__desktop/release", custom: true, render: () => renderRelease() };

const mstate = {
  tab: "equipment",
  data: { equipment: null, rolls: null, paths: null, worklog: null, shifts: null, access: null, presence: null, release: null },
  meta: {},           // タブごとの付き物（アクセス権限の選択欄・自分の行 など）
  me: null,           // /api/access/me（この PC・このログインの権限）
  loadedRev: { equipment: null, rolls: null, paths: null },   // 一覧を読んだときのマスタの版
  place: null,        // /api/masters/status の答え
  search: "",
  editing: null,      // 右の詳細に出している行 { tab, id(追加なら null), baseRev, orig } | null(=何も出していない)
  selId: null,        // 右に出す行（一覧を描き直しても同じ行を出す）。追加の前に選んでいた行は prevSel
  deleteTarget: null, // { tab, id, rev }
  pollTimer: null,
};
const MASTER_POLL_MS = 5000;
const LOCK_WAIT_LIMIT_MS = 30000;   // 錠（既定20秒）が切れるまで粘る長さ
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const whoText = (w) => [w && w.pc, w && w.login].filter(Boolean).join("／") || "ほかの PC";
const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : "");
const stamp = (iso) => String(iso || "").replace("T", " ").slice(0, 16);   // 2026-09-29 10:15
/* 保存中の PC を待っている間の文言（what: 保存・削除）。d は 409 locked の答え */
const lockWaitText = (d, what, name = (w) => w) =>
  `${name(whoText({ pc: d.holder_pc, login: d.holder_login }))} が保存中です。終わりしだい自動で${what}します（あと約${d.remaining}秒）…`;
const boldName = (w) => `<b>${escapeHtml(w)}</b>`;   // HTML の文言では相手の名前を太字に

/* サーバーへ。成否に関わらず {ok, status, data} で返す（画面が理由を読んで次の手を決める）。 */
async function masterRequest(url, opts) {
  try {
    const r = await fetch(url, opts);
    let data = {};
    try { data = await r.json(); } catch (_) { /* 本文なし */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: "アプリに届きません: " + e.message, kind: "network" } };
  }
}
/* 保存中の PC がいれば（409 locked）、錠が切れるまで待って送り直す。待っている間は onWait で言う。 */
async function withLockWait(send, onWait) {
  const until = Date.now() + LOCK_WAIT_LIMIT_MS;
  for (;;) {
    const res = await send();
    if (!(res.status === 409 && res.data.kind === "locked") || Date.now() > until) return res;
    onWait(res.data);
    await sleep(Math.min(2000, Math.max(500, (res.data.remaining || 1) * 1000)));
  }
}

/* ---------------- 開閉 ---------------- */
/* この PC・このログインで、そのタブのマスタへ書けるか（判定はサーバー。ここは答えを読むだけ）。 */
function canWrite(tab) {
  const me = mstate.me;
  if (!me) return true;
  if (me.revoked) return false;
  return MASTER_DEFS[tab].admin ? !!me.canEditAdminMaster : !!me.canEditFieldMaster;
}
function readOnlyWhy(tab) {
  const me = mstate.me || {};
  if (me.revoked) return "この PC は一時的に切断されています";
  return `権限「${me.role || "-"}」・マスタ編集「${me.masterEdit || "-"}」`;
}
const tabVisible = (k) => !MASTER_DEFS[k].visible || MASTER_DEFS[k].visible(mstate.me || {});
async function openMaster() {
  $("#masterOverlay").classList.remove("hidden");
  mstate.editing = null;   // 前に開いたときの詳細は、読み直した内容で出し直す
  try { mstate.me = await (await fetch("/api/access/me")).json(); } catch (_) { mstate.me = null; }
  if (!tabVisible(mstate.tab)) mstate.tab = "equipment";
  buildMasterTabs();
  await refreshPlace();
  await ensureTabLoaded(mstate.tab);
  renderMasterTable();
  // ほかの一覧のタブも裏で読んで件数を出す（開く前にどれだけあるか分かる）
  Promise.all(Object.keys(MASTER_DEFS).filter((k) => !MASTER_DEFS[k].custom && k !== mstate.tab && tabVisible(k)).map(ensureTabLoaded))
    .then(buildMasterTabs, () => {});
  clearInterval(mstate.pollTimer);
  mstate.pollTimer = setInterval(refreshPlace, MASTER_POLL_MS);
}
function closeMaster() {
  if (!leaveOk()) return;
  emit("tpa:masters-closed");   // 設備マスタ（検査計など）を直したかもしれない → 画面が引き直す
  $("#masterOverlay").classList.add("hidden");
  clearInterval(mstate.pollTimer);
  mstate.pollTimer = null;
  clearInterval(mstate.presenceTimer);
}

/* ---------------- 置き場の帯（どこの・いつのマスタか）と、ほかの PC の変更の取り込み ---------------- */
const shareDown = () => !!(mstate.place && mstate.place.mode === "shared" && !mstate.place.reachable);
async function refreshPlace() {
  const res = await masterRequest("/api/masters/status");
  if (!res.ok) return;
  mstate.place = res.data;
  const news = [];
  for (const tab of Object.keys(MASTER_DEFS)) {
    const m = res.data.masters[MASTER_DEFS[tab].name];
    const known = mstate.loadedRev[tab];
    if (!m || known == null || m.revision === known || !mstate.data[tab]) continue;
    // 読んだあとに版が進んだ＝ほかの PC（か自分の別の画面）が保存した
    if (MASTER_DEFS[tab].custom && settingsDirty()) {
      settingsNotice(`この間に <b>${escapeHtml(whoText(m.updated_by))}</b> が参照先を更新しました（${hhmm(m.updated_at)}）。保存するときに、直している項目が変わっていないかを確かめます。`);
      continue;
    }
    if (mstate.editing && mstate.editing.tab === tab && formDirty()) {
      showFormNotice("wait", `この間に <b>${escapeHtml(whoText(m.updated_by))}</b> が${MASTER_DEFS[tab].label}を更新しました（${hhmm(m.updated_at)}）。
        保存するときに、開いている行が変わっていないかを確かめます。`);
      continue;
    }
    mstate.data[tab] = null;
    if (mstate.editing && mstate.editing.tab === tab) mstate.editing = null;   // 直していない詳細は、読み込んだ新しい内容で出し直す
    await ensureTabLoaded(tab);
    if (tab === mstate.tab) renderMasterTable();
    news.push(`${MASTER_DEFS[tab].label}: ${whoText(m.updated_by)} の変更を読み込みました（${hhmm(m.updated_at)}）`);
    afterMasterChange();
  }
  paintPlace(news);
}
function paintPlace(news) {
  const p = mstate.place, el = $("#masterPlace");
  if (!p || !el) return;
  const cur = p.masters[MASTER_DEFS[mstate.tab].name] || {};
  let html;
  if (p.mode !== "shared") {
    html = `<span class="place-tag local">手元のみ</span><span class="place-meta">この PC のアプリの data/ に保存します（ほかの PC とは共有しません）</span>`;
  } else if (!p.reachable) {
    html = `<span class="place-tag off">共有に届きません</span><span class="place-dir">${escapeHtml(p.dir)}</span>
      <span class="place-meta">前に取り込んだ写しを表示中・届くまで保存できません</span>
      <button type="button" class="place-btn" id="masterPlaceRetry">もう一度つなぐ</button>`;
  } else {
    const by = cur.updated_by && (cur.updated_by.pc || cur.updated_by.login)
      ? `・最終更新 ${escapeHtml(whoText(cur.updated_by))} ${hhmm(cur.updated_at)}` : "";
    html = `<span class="place-tag shared">共有</span><span class="place-dir">${escapeHtml(p.dir)}</span>
      ${cur.revision != null ? `<span class="place-meta">版 ${cur.revision}${by}</span>` : ""}
      ${p.caution ? `<span class="place-caution" title="${escapeHtml(p.caution)}">⚠ 同期フォルダ（同時の保存で片方が消えることがあります）</span>` : ""}`;
  }
  html += '<button type="button" class="place-btn place-go" id="masterPlaceGo" title="マスタの置き場（共有フォルダ）を見る・変える。全員の PC がそろっているかも出ます">マスタの置き場 ›</button>';
  if (news && news.length) html += `<span class="place-news">${news.map(escapeHtml).join(" ／ ")}</span>`;
  el.innerHTML = html;
  const go = $("#masterPlaceGo");
  if (go) { go.onclick = () => goTab("place"); go.hidden = mstate.tab === "place"; }
  paintPlaceNav();
  const retry = $("#masterPlaceRetry");
  if (retry) retry.onclick = refreshPlace;
  const down = shareDown(), ro = !canWrite(mstate.tab);
  $("#masterAddBtn").disabled = down;
  $("#masterAddBtn").classList.toggle("hidden", ro);
  $("#masterAddBtn").title = down ? "共有フォルダに届かないため、いまは保存できません" : "";
  // 書けないときは「閲覧のみ」の札（理由つき）。行は押せば中身を見られる（保存はできない）
  const roTag = $("#masterRO");
  roTag.classList.toggle("hidden", !ro);
  roTag.textContent = "閲覧のみ";
  roTag.title = `${readOnlyWhy(mstate.tab)}のため、このマスタは書き換えられません`;
  paintDetailButtons();
}

/* ---------------- タブ ---------------- */
function buildMasterTabs() {
  const tabs = $("#masterTabs");
  let group = "";
  tabs.innerHTML = Object.keys(MASTER_DEFS).filter(tabVisible).map((k) => {
    const def = MASTER_DEFS[k];
    const rows = mstate.data[k];
    const count = k === "place" ? '<span class="tab-state"></span>' : rows && !def.custom ? `<span class="tab-count">${rows.length}</span>` : "";
    const head = def.group !== group ? `<span class="mg-lab">${(group = def.group)}</span>` : "";
    return `${head}<button class="tab${k === mstate.tab ? " active" : ""}" data-tab="${k}" role="tab" aria-selected="${k === mstate.tab}">${def.label}${count}</button>`;
  }).join("");
  tabs.querySelectorAll(".tab").forEach((b) => b.onclick = () => goTab(b.dataset.tab));
  paintPlaceNav();
}
function goTab(tab) {
  if (tab === mstate.tab || !leaveOk()) return;
  mstate.tab = tab;
  mstate.editing = null; mstate.selId = null;   // 行の番号はマスタごとなので、移ったら先頭から
  mstate.search = "";
  $("#masterSearch").value = "";
  buildMasterTabs();
  ensureTabLoaded(mstate.tab).then(renderMasterTable);
}
/* 置き場の今の状態 → [札の文字, 色の cls, 説明]。見出しの帯・ナビ・置き場の頁で同じ言葉を使う */
function placeState(p) {
  if (!p || p.mode !== "shared") return ["手元のみ", "local", "アプリの data/ に保存しています。ほかの PC とは共有していません。共有するときは、下で共有フォルダを選びます。"];
  if (p.reachable === false) return ["届かない", "off", "共有の置き場に届きません。前に取り込んだ写しを表示中で、届くまで保存できません。"];
  return ["共有", "shared", "共有フォルダに置き、全員の PC で同じマスタを使っています。"];
}
function paintPlaceNav() {
  const el = document.querySelector('#masterTabs [data-tab="place"] .tab-state');
  if (!el || !mstate.place) return;
  const [t, cls] = placeState(mstate.place);
  el.className = `tab-state ${cls}`;
  el.textContent = t === "手元のみ" ? "手元" : t;
}

async function ensureTabLoaded(tab) {
  if (mstate.data[tab]) return;
  const def = MASTER_DEFS[tab];
  // 自分で読んで描く頁（render。置き場・作業実績・利用状況・配布）は前もって読まない。描くときに 1 回だけ読む
  // （配布は共有の置き場を探すので遅い。前もって読むと、同じ重い問い合わせを 2 回待たせていた）
  if (def.render) return;
  const r = await fetch(def.api);
  const d = await r.json();
  mstate.data[tab] = def.parse ? def.parse(d) : d;
  const m = mstate.place && mstate.place.masters[def.name];
  mstate.loadedRev[tab] = m ? m.revision : null;
  buildMasterTabs();
}
async function reloadTab(tab) {
  await refreshPlace();
  mstate.data[tab] = null;
  await ensureTabLoaded(tab);
  if (tab === mstate.tab) renderMasterTable();
}

/* ---------------- 一覧表示 ---------------- */
function filteredRows(tab) {
  const def = MASTER_DEFS[tab];
  const rows = mstate.data[tab] || [];
  const q = mstate.search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => def.searchKeys.some((k) => String(r[k] || "").toLowerCase().includes(q)));
}

/* ---------------- 参照先（カード） ---------------- */
function settingsDirty() {
  return [...document.querySelectorAll("#masterSettings .ps-card input")].some((i) => i.value !== (i.dataset.saved || ""));
}
function settingsNotice(html) {
  const n = $("#psNotice"); if (!n) return;
  n.innerHTML = html; n.classList.remove("hidden");
}
function fmtDefault(v) { return v === null || v === undefined || v === "" ? "（空）" : String(v); }
function renderSettings() {
  const d = mstate.data.paths, box = $("#masterSettings");
  if (!d) { box.innerHTML = '<p class="ps-loading">読み込み中…</p>'; return; }
  const down = shareDown();
  const where = d.shared
    ? `ここで直すと <b>共有フォルダのマスタ</b>に保存され、<b>全員の PC にすぐ効きます</b>（アプリを起動し直さなくてよい）。`
    : `マスタの共有フォルダが決まっていないため、<b>この PC だけ</b>に保存します。`;
  box.innerHTML = `<p class="ps-lead">${where} 空にして保存すると、配った設定（既定）に戻ります。</p>
    <div class="ps-notice hidden" id="psNotice"></div>`
    + d.items.filter((it) => !it.page).map((it) => {     // page のある項目は、その頁（例: 作業実績）で直す
      const changed = it.source === "master";
      const by = changed && it.updated_by ? `${escapeHtml(whoText(it.updated_by))} ${stamp(it.updated_at)}` : "";
      return `<section class="ps-card${changed ? " is-changed" : ""}" data-key="${escapeHtml(it.key)}" data-rev="${it.rev ?? 0}"${it.check_url ? ` data-check="${escapeHtml(it.check_url)}"` : ""}>
        <div class="ps-head"><b>${escapeHtml(it.label)}</b>
          <span class="ps-badge ${changed ? "changed" : "default"}">${changed ? `マスタで変更（${by}）` : "既定（配った設定）"}</span></div>
        <p class="ps-hint">${escapeHtml(it.hint)}</p>
        <div class="ps-row">
          <input type="text" class="ps-input" value="${escapeHtml(it.value ?? "")}" data-saved="${escapeHtml(it.value ?? "")}"
                 placeholder="既定: ${escapeHtml(fmtDefault(it.default))}" spellcheck="false" aria-label="${escapeHtml(it.label)}">
          <button type="button" class="ps-check" title="保存する前に、その値で本当に読めるかを確かめます">確かめる</button>
          <button type="button" class="btn-primary ps-save"${down ? ' disabled title="共有フォルダに届かないため、いまは保存できません"' : !canWrite("paths") ? ` disabled title="${escapeHtml(readOnlyWhy("paths"))}のため保存できません"` : ""}>保存</button>
          <button type="button" class="ps-reset"${changed && !down && canWrite("paths") ? "" : " disabled"} title="マスタの値を消して、配った設定（既定）に戻します">既定に戻す</button>
        </div>
        <div class="ps-now">いま効いている値: <code>${escapeHtml(fmtDefault(it.effective))}</code></div>
        <div class="ps-result hidden" aria-live="polite"></div>
      </section>`;
    }).join("")
    + `<section class="ps-card is-readonly"><div class="ps-head"><b>マスタの共有フォルダ</b><span class="ps-badge default">この画面では変えません</span></div>
        <p class="ps-hint">マスタ（設備・ロール・この参照先）そのものの置き場です。ここで変えるとこの画面自体が別の場所を見てしまうため、設定ファイルで変えます:
          <code>${escapeHtml(d.config_file)}</code> の <code>master_share.dir</code> を直して、アプリを起動し直してください。</p>
        <div class="ps-now">いまの置き場: <code>${escapeHtml(d.share_dir || "（なし＝この PC の中だけ）")}</code></div></section>`
    + `<section class="ps-card is-readonly"><div class="ps-head"><b>調査の道具（LotDsp の項目）</b><span class="ps-badge default">読むだけ・何も書き換えない</span></div>
        <p class="ps-hint">LotDsp の API の応答に入っている項目の一覧と、それが LotDsp の画面のどの見出しかの紐づけを調べます（値は出しません）。
          開いた画面の「← アプリへ戻る」でここへ戻ります。</p>
        <div class="ps-row"><a class="btn-ghost ps-tool" href="/lotdsp-link">LotDsp の項目を調べる</a></div></section>`;
  box.querySelectorAll(".ps-card[data-key]").forEach(bindSettingCard);
}
/* 参照先の項目のうち、フォルダ・ファイルを指す物に付ける補助（版 3.29.0。kind → 窓の目的） */
const PATH_PICK = {
  sqlite: { purpose: "sqlite", title: "元ファイル（品質データ .sqlite3）を選ぶ", note: "共有の .sqlite3 ファイルを選びます。" },
  exe: { purpose: "exe", title: "ブラウザの実行ファイル（.exe）を選ぶ", note: "ふつうは空のままで構いません（Edge を自動で探します）。" },
  release: { purpose: "release", title: "更新の置き場を選ぶ", note: "版ごとのフォルダ（release.json がある）が並ぶフォルダを選びます（印: 版の置き場）。", chips: true, exclude: ["release"] },
};
function bindSettingCard(card) {
  const key = card.dataset.key, input = card.querySelector(".ps-input"), out = card.querySelector(".ps-result");
  const item = ((mstate.data.paths || {}).items || []).find((x) => x.key === key) || {}, pp = PATH_PICK[item.kind];
  if (pp) TPA.pathPick(input, { ...pp, chipsAfter: pp.chips ? card.querySelector(".ps-row") : null,
    disabled: !canWrite("paths") ? `${readOnlyWhy("paths")}のため、選べません` : false });
  const say = (kind, html) => { out.className = "ps-result " + kind; out.innerHTML = html; };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") card.querySelector(".ps-save").click(); });
  // 保存は、直したカードだけ主の色（黄）にする。並んだカードのどれを保存すればよいかが色で分かる
  input.addEventListener("input", () => card.querySelector(".ps-save").classList.toggle("is-dirty", input.value !== (input.dataset.saved || "")));
  card.querySelector(".ps-check").onclick = async () => {
    say("wait", "確かめています…");
    // 確かめる先は項目が決める（更新の置き場は、探す本人のデスクトップ版: /__desktop/update/probe）
    const r = await masterRequest(card.dataset.check || "/api/settings/check", TPA.json("POST", { key, value: input.value }));
    const d = r.status === 404 ? { ok: false, message: "デスクトップ版で開いたときだけ確かめられます。" } : (r.data || {});
    say(d.ok ? "ok" : "ng", `${d.ok ? "✓" : "✕"} ${escapeHtml(d.message || d.error || "確かめられませんでした")}`);
  };
  const send = async (value, baseRev) => {
    say("wait", "保存しています…");
    const res = await withLockWait(
      () => masterRequest(`/api/settings/${encodeURIComponent(key)}`, TPA.json("PUT", { value, base_rev: baseRev })),
      (d) => say("wait", lockWaitText(d, "保存", boldName)));
    if (res.status === 409 && res.data.kind === "conflict") {
      const cur = res.data.current;
      const theirs = cur ? `「${escapeHtml(cur["値"])}」（${escapeHtml(whoText(cur.updated_by))} ${stamp(cur.updated_at)}）` : "既定に戻されています";
      say("ng", `開いたあとに、ほかの PC がこの項目を変更しました。相手の値: ${theirs}
        <div class="ps-acts"><button type="button" class="ps-theirs">相手の値を読み込む</button><button type="button" class="ps-mine">自分の値で上書きする</button></div>`);
      out.querySelector(".ps-theirs").onclick = () => reloadTab("paths");
      out.querySelector(".ps-mine").onclick = () => send(value, cur ? cur.rev : 0);
      return;
    }
    if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした")); return; }
    await reloadTab("paths");
    const again = document.querySelector(`#masterSettings .ps-card[data-key="${CSS.escape(key)}"] .ps-result`);
    if (again) { again.className = "ps-result ok"; again.innerHTML = value === "" ? "✓ 既定に戻しました。すぐ効きます。" : "✓ 保存しました。すぐ効きます（ほかの PC にも数秒で届きます）。"; }
    emit("tpa:settings-changed", { key });
  };
  card.querySelector(".ps-save").onclick = () => send(input.value, +card.dataset.rev || 0);
  card.querySelector(".ps-reset").onclick = () => {
    if (confirm("この項目を配った設定（既定）に戻します。全員の PC に効きます。よろしいですか？")) send("", +card.dataset.rev || 0);
  };
}
/* ほかの画面から「参照先」を開く（異常ロット一覧で元ファイルが読めない・古いとき） */
async function openMasterAt(tab) {
  mstate.tab = tab;
  await openMaster();
}
window.openMasterAt = openMasterAt;

function renderMasterTable() {
  const def = MASTER_DEFS[mstate.tab], custom = !!def.custom;
  document.querySelector("#masterOverlay .master-toolbar").classList.toggle("hidden", custom);
  document.querySelector("#masterOverlay .master-table-wrap").classList.toggle("hidden", custom);
  $("#masterDetail").classList.toggle("hidden", custom);
  $("#masterSettings").classList.toggle("hidden", !custom);
  clearInterval(mstate.presenceTimer);
  if (custom) { (def.render || renderSettings)(); const go = $("#masterPlaceGo"); if (go) go.hidden = mstate.tab === "place"; return; }
  const rows = filteredRows(mstate.tab);
  $("#masterSearch").placeholder = def.searchPlaceholder || "検索";
  const widths = columnWidths(def, mstate.data[mstate.tab] || []);
  $("#masterHead").innerHTML = "<tr>" + def.listColumns.map((c, i) =>
    `<th class="${c.num ? "num" : ""}${c.grow ? " grow" : ""}"${widths[i] ? ` style="width:${widths[i]}px"` : ""}>${c.label}${c.unit ? `<small>${c.unit}</small>` : ""}</th>`).join("") + "</tr>";
  // 行のどこを押しても（Enter でも）右の詳細がその行になる。削除は右の詳細の「削除」か Delete キー（押し間違いを減らす）
  $("#masterBody").innerHTML = rows.map((row) => {
    const tds = def.listColumns.map((c, i) => `<td class="${c.num ? "num" : ""}${c.grow ? " grow" : ""}">${cellHtml(c, row[c.key])}${i === 0 && def.rowNote ? def.rowNote(row) : ""}</td>`).join("");
    return `<tr data-id="${row.id}" tabindex="0" aria-selected="false">${tds}</tr>`;
  }).join("");
  $("#masterEmpty").classList.toggle("hidden", rows.length > 0);
  const all = mstate.data[mstate.tab];
  $("#masterCount").textContent = all ? (rows.length === all.length ? `${all.length} 件` : `${rows.length} / ${all.length} 件`) : "";

  paintPlace();
  const rowOf = (id) => (mstate.data[mstate.tab] || []).find((r) => r.id === Number(id));
  $("#masterBody").querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.onclick = () => { if (Number(tr.dataset.id) !== mstate.selId && leaveOk()) openForm(mstate.tab, rowOf(tr.dataset.id), { focus: false }); };
    tr.onkeydown = (e) => {
      if (e.target !== tr) return;
      if (e.key === "Enter") { e.preventDefault(); if (Number(tr.dataset.id) === mstate.selId || leaveOk()) openForm(mstate.tab, rowOf(tr.dataset.id)); }
      else if (e.key === "Delete" && !shareDown() && canWrite(mstate.tab)) { e.preventDefault(); openDeleteConfirm(mstate.tab, rowOf(tr.dataset.id)); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
        if (next) { next.focus(); next.click(); }   // 矢印で行を移ると、右もその行になる（直している途中なら確かめる）
      }
    };
  });
  // 右の詳細: 直している途中（追加の途中も）はそのまま。そうでなければ選んでいた行（無ければ先頭）を出す
  const ed = mstate.editing;
  const keep = ed && ed.tab === mstate.tab && (ed.id == null || rowOf(ed.id));
  if (!keep) {
    const pick = rows.find((r) => r.id === mstate.selId) || rows[0];
    if (pick) openForm(mstate.tab, pick, { focus: false }); else showDetailEmpty();
  }
  markSelected();
}
/** 一覧で、右に出している行に印（藍の帯）を付ける */
function markSelected() {
  $("#masterBody").querySelectorAll("tr[data-id]").forEach((tr) => {
    const on = mstate.editing && mstate.editing.id != null && Number(tr.dataset.id) === mstate.editing.id;
    tr.classList.toggle("is-sel", !!on); tr.setAttribute("aria-selected", !!on);
  });
}
/* 列の幅: 見出しと（絞り込む前の）全部の値のうちいちばん長いものを、実際の文字の幅で測って決める
   （幅を決め打ちすると、長い設備名が入ったときに切れる）。grow の列は余りを受けるので測らない。c.w は最小の幅。 */
function columnWidths(def, rows) {
  const family = getComputedStyle(document.body).fontFamily;
  const px = parseFloat(getComputedStyle(document.body).fontSize) || 14;
  const text = (t, weight, size) => TPA.textWidth(t, `${weight} ${size}px ${family}`);
  const em = (w) => (w ? parseFloat(w) * 14 : 0);
  return def.listColumns.map((c) => {
    if (c.grow) return 0;
    const head = text(c.label + (c.unit ? ` ${c.unit}` : ""), 700, 12.5);
    const chipPad = ["rewind", "line", "meter", "chip", "role", "medit", "enabled"].includes(c.kind) ? 20 : 0;
    const shown = (v) => (c.kind === "rewind" ? (REWIND[v] || [v])[0] : c.kind === "line" ? (LINE[v] || [v])[0]
      : c.kind === "enabled" ? "有効" : v);
    // 空の欄に出す文言（「（どの PC でも）」など）も測る。「あなた」の印が付く最初の列はその分も見込む
    const vals = rows.map((r) => String(r[c.key] ?? "").trim() || c.anyText || "").filter(Boolean);
    const extra = def.rowNote && def.listColumns[0] === c ? 52 : 0;
    const body = vals.reduce((m, v) => Math.max(m, text(shown(v), c.kind === "name" || chipPad ? 700 : 400, chipPad ? 12.5 : px) + chipPad), 0);
    return Math.ceil(Math.max(head, body + extra, em(c.w) - 28) + 28 + 2);   // 28 = 左右の余白
  });
}
/* ---------------- 利用状況（WaveLog の接続状況を移したもの） ----------------
   だれが・どの PC で・どの版を使っているか。最新版は「使っている人たち（開発者を除く）の版のうちいちばん新しいもの」。
   切断（一時的にマスタへ書けなくする）・切断を解く・使わなくなった PC の記録を消す。できるかはサーバーの答え（can）。
   開いているあいだは 10 秒ごとに読み直す。 */
mstate.presenceFilter = "all";
mstate.presenceView = "status";          // status: PC ごとの状況 / history: 使用の履歴
mstate.historyKey = "";                  // 使用の履歴を 1 台に絞るとき（PC ごとの状況の行の「履歴」から）
mstate.historyLimit = 300;
function ago(iso) {
  if (!iso) return "-";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 90) return "いま";
  if (sec < 3600) return `${Math.round(sec / 60)} 分前`;
  if (sec < 86400) return `${Math.round(sec / 3600)} 時間前`;
  return String(iso).slice(0, 10).replaceAll("-", "/");
}
const hours = (sec) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} 時間` : `${Math.round((sec || 0) / 60)} 分`);
/* 利用状況のタブの中の切り替え（PC ごとの状況・使用の履歴）。いま見ている方を濃くする */
function presenceViews(active) {
  return `<div class="pz-views" role="tablist" aria-label="利用状況の見方">${[["status", "PC ごとの状況"], ["history", "使用の履歴"]].map(([k, t]) =>
    `<button class="pz-view${k === active ? " on" : ""}" role="tab" aria-selected="${k === active}" data-view="${k}">${t}</button>`).join("")}</div>`;
}
function bindPresenceViews(box) {
  box.querySelectorAll(".pz-view").forEach((b) => { b.onclick = () => { mstate.presenceView = b.dataset.view; mstate.historyKey = ""; renderPresence(); }; });
}
function renderPresence() {
  clearInterval(mstate.presenceTimer);
  return mstate.presenceView === "history" ? renderHistory() : renderPresenceStatus();
}
async function renderPresenceStatus() {
  const box = $("#masterSettings");
  const res = await masterRequest("/api/presence");
  if (!res.ok) { box.innerHTML = `<p class="ps-loading">${escapeHtml(res.data.error || "利用状況を読めませんでした。")}</p>`; return; }
  const d = res.data, fl = d.fleet, can = d.can || {};
  mstate.data.presence = d;
  const f = mstate.presenceFilter;
  const items = fl.items.filter((x) => f === "all" || (f === "online" && x.online) || (f === "outdated" && x.outdated));
  const verState = (x) => !x.counted ? chip("対象外", "c-plain", "開発者の PC は試しの版を使うので最新版に数えません")
    : x.outdated ? chip("要更新", "c-warn", `最新版は ${fl.latest}`) : chip("最新", "c-meter");
  const acts = (x) => {
    const b = [];
    if (x.revoked) b.push(`<button class="pz-btn" data-pz="allow" data-key="${escapeHtml(x.key)}">切断を解く</button>`);
    else if (x.online && x.key !== d.me && (x.role === "開発者" ? can.canDisconnectDeveloper : can.canDisconnect))
      b.push(`<button class="pz-btn danger" data-pz="cut" data-key="${escapeHtml(x.key)}">切断</button>`);
    if (!x.online && can.canForget) b.push(`<button class="pz-btn" data-pz="forget" data-key="${escapeHtml(x.key)}">記録を消す</button>`);
    b.unshift(`<button class="pz-btn" data-hist="${escapeHtml(x.key)}" title="この PC・ログインID の使用の履歴（いつ・どの版で・何分）">履歴</button>`);
    return b.join("");
  };
  box.innerHTML = presenceViews("status") + `
    <div class="pz-summary">
      <div class="pz-kpi"><span>最新版</span><b>${escapeHtml(fl.latest || "-")}</b></div>
      <div class="pz-kpi"><span>いま使っている</span><b>${fl.online}</b><i>台</i></div>
      <div class="pz-kpi${fl.outdated ? " warn" : ""}"><span>要更新</span><b>${fl.outdated}</b><i>台</i></div>
      <div class="pz-kpi"><span>記録</span><b>${fl.total}</b><i>台</i></div>
      <p class="pz-where">${d.shared ? "共有フォルダ" : "この PC の中だけ（共有フォルダが決まっていません）"}: <code>${escapeHtml(d.dir)}</code>・
        最新版は、使っている人たち（開発者を除く）の版のうちいちばん新しいもの。${d.readable ? "" : "<b>記録を読めませんでした。</b>"}</p>
    </div>
    <div class="pz-filter" role="tablist">${[["all", "すべて"], ["online", "いま使っている"], ["outdated", "要更新だけ"]].map(([k, t]) =>
      `<button class="pz-f${k === f ? " on" : ""}" data-f="${k}">${t}</button>`).join("")}</div>
    <div class="master-table-wrap pz-wrap"><table class="master-table pz-table">
      <thead><tr><th>状態</th><th>PC名</th><th>ログインID</th><th>権限区分</th><th>版</th><th>最後</th><th>回数・時間</th><th class="grow"></th></tr></thead>
      <tbody>${items.map((x) => `<tr class="${x.key === d.me ? "is-me" : ""}">
        <td>${x.revoked ? chip("切断中", "c-off", `${x.revoked.by} が切断・あと約 ${Math.ceil(x.revoked.remainingSec / 60)} 分`) : x.online ? chip("● 使用中", "c-on") : '<span class="m-none">使っていない</span>'}</td>
        <td><b class="m-name">${escapeHtml(x.pc || "-")}</b>${x.key === d.me ? '<span class="m-chip c-me">あなた</span>' : ""}</td>
        <td><span class="m-ident">${escapeHtml(x.login || "-")}</span></td>
        <td>${cellHtml({ kind: "role" }, x.role)}</td>
        <td><span class="pz-ver">${escapeHtml(x.version || "-")}</span> ${verState(x)}</td>
        <td title="${escapeHtml(x.lastAt || "")}">${ago(x.lastAt)}</td>
        <td>${x.sessions || 0} 回・${hours(x.totalSec)}</td>
        <td class="pz-acts">${acts(x)}</td></tr>`).join("")}</tbody></table>
      ${items.length ? "" : '<div class="master-empty">該当する PC はありません。</div>'}</div>`;
  box.querySelectorAll(".pz-f").forEach((b) => { b.onclick = () => { mstate.presenceFilter = b.dataset.f; renderPresence(); }; });
  box.querySelectorAll(".pz-btn[data-pz]").forEach((b) => { b.onclick = () => presenceAct(b.dataset.pz, b.dataset.key, b); });
  box.querySelectorAll(".pz-btn[data-hist]").forEach((b) => { b.onclick = () => { mstate.presenceView = "history"; mstate.historyKey = b.dataset.hist; mstate.historyLimit = 300; renderPresence(); }; });
  bindPresenceViews(box);
  clearInterval(mstate.presenceTimer);
  mstate.presenceTimer = setInterval(() => { if (mstate.tab === "presence" && mstate.presenceView === "status" && !$("#masterOverlay").classList.contains("hidden")) renderPresence(); }, 10000);
}

/* ---------------- 使用の履歴（起動ごと: いつ・だれ・どの PC・どの版・何分） ----------------
   新しい順。同じ日は日付を薄くして、日の区切りを目で追えるようにする。版が前の使い始めから変わった行には「更新」の札。
   下に保存期間（残す日数）と「古い記録を今すぐ整理」（記録を消せる区分だけ）。 */
const PZ_WEEK = "日月火水木金土";
const pzDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "-" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}（${PZ_WEEK[d.getDay()]}）`; };
const pzTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "-" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
async function renderHistory() {
  const box = $("#masterSettings");
  const q = new URLSearchParams({ limit: mstate.historyLimit });
  if (mstate.historyKey) q.set("key", mstate.historyKey);
  const res = await masterRequest("/api/presence/sessions?" + q);
  if (!res.ok) { box.innerHTML = presenceViews("history") + `<p class="ps-loading">${escapeHtml(res.data.error || "使用の履歴を読めませんでした。")}</p>`; bindPresenceViews(box); return; }
  const d = res.data, can = d.can || {}, items = d.items || [];
  const who = items[0] && mstate.historyKey ? `${items[0].pc} ／ ${items[0].login}` : mstate.historyKey;
  let lastDay = "";
  const rows = items.map((x) => {
    const day = pzDay(x.start), same = day === lastDay;
    lastDay = day;
    const ver = `<span class="pz-ver">${escapeHtml(x.version || "-")}</span>`
      + (x.changedFrom ? chip(`更新 ${x.changedFrom} →`, "c-meter", `前の使い始めは ${x.changedFrom}。この使い始めから ${x.version}`) : "");
    return `<tr><td class="${same ? "pz-same" : ""}">${day}</td>
      <td class="pz-time">${pzTime(x.start)}〜${x.live ? chip("● 使用中", "c-on") : pzTime(x.end)}</td>
      <td class="num">${hours(x.sec || 0)}</td>
      <td><b class="m-name">${escapeHtml(x.pc || "-")}</b></td><td><span class="m-ident">${escapeHtml(x.login || "-")}</span></td>
      <td>${x.role ? cellHtml({ kind: "role" }, x.role) : '<span class="m-none">-</span>'}</td><td>${ver}</td></tr>`;
  }).join("");
  const [lo, hi] = d.range || [30, 3650];
  box.innerHTML = presenceViews("history") + `
    <div class="pz-hhead">${mstate.historyKey
      ? `<span class="pz-only">${escapeHtml(who)} の履歴だけ</span><button class="pz-btn" id="pzAll">すべての PC に戻す</button>`
      : "<span>すべての PC の使い始め（新しい順）</span>"}</div>
    <div class="master-table-wrap pz-wrap"><table class="master-table pz-table pz-history">
      <thead><tr><th>日付</th><th>時刻</th><th class="num">使った時間</th><th>PC名</th><th>ログインID</th><th>権限区分</th><th class="grow">版</th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${items.length ? "" : '<div class="master-empty">まだ使用の履歴がありません（版 3.3.0 から記録します）。</div>'}</div>
    ${d.more ? '<div class="pz-more"><button class="pz-btn" id="pzMore">さらに表示</button></div>' : ""}
    <section class="ps-card pz-keep"><div class="ps-head"><b>保存期間</b></div>
      <p class="ps-hint">使用の履歴は <b>${d.historyDays} 日</b>残します。それより古い記録は、各 PC が使い始めるときに自分の分を自動で消します。
        使わなくなった PC の古い記録は「古い記録を今すぐ整理」で消せます。</p>
      ${can.canForget ? `<div class="ps-row"><label class="pz-days">残す日数 <input type="number" id="pzDays" min="${lo}" max="${hi}" value="${d.historyDays}"> 日</label>
        <button class="btn-primary ps-save" id="pzDaysSave">保存</button>
        <button class="pz-btn danger" id="pzPrune">古い記録を今すぐ整理</button></div>
        <div class="ps-result hidden" id="pzKeepMsg" aria-live="polite"></div>`
        : '<p class="ps-hint">残す日数を変える・整理するのは、メンテナンス者以上です。</p>'}
    </section>`;
  bindPresenceViews(box);
  const all = $("#pzAll"); if (all) all.onclick = () => { mstate.historyKey = ""; renderPresence(); };
  const more = $("#pzMore"); if (more) more.onclick = () => { mstate.historyLimit += 300; renderPresence(); };
  const say = (cls, t) => { const m = $("#pzKeepMsg"); m.className = `ps-result ${cls}`; m.textContent = t; };
  const save = $("#pzDaysSave");
  if (save) save.onclick = async () => {
    const r = await masterRequest("/api/presence/retention", TPA.json("POST", { days: $("#pzDays").value }));
    if (!r.ok) { say("ng", "✕ " + (r.data.error || "保存できませんでした。")); return; }
    await renderPresence();
    say("ok", `✓ 使用の履歴を ${r.data.historyDays} 日残すようにしました（全員の PC に効きます）。`);
  };
  const prune = $("#pzPrune");
  if (prune) prune.onclick = async () => {
    if (!confirm(`${d.historyDays} 日より古い使用の履歴を、すべての PC の分まとめて消します。よろしいですか？`)) return;
    const r = await masterRequest("/api/presence/prune", TPA.json("POST", {}));
    if (!r.ok) { say("ng", "✕ " + (r.data.error || "整理できませんでした。")); return; }
    await renderPresence();
    say("ok", `✓ ${r.data.files} ファイル（${r.data.sessions} 回分）を消しました。`);
  };
}
/* ---------------- 作業実績（フォルダ → 探す → 設備ごとに表示する・しない） ----------------
   形は 7 案＋2 回目で選んだ（program/tools/ui-proposals/2026-10-worklog-master*.mjs・.json）:
   ① フォルダとファイル名の決まり（参照先の work_log.*）と「探す」を 1 行に
   ② 直すこと（見つからない・古い・名前が変わった・登録していないファイル）と次の手を表の上に（表を見て回らせない）
   ③ 数の札（設備・表示・見つからない・古い）と、静かな表（表示の切り替え・設備名・ファイル・最後の更新・表。「登録を消す」は行に乗せたときだけ）
   見つからない行は、フォルダにある登録していないファイルから選んで結び直す（勝手には結ばない）。 */
const wlAgo = (sec) => { if (!sec) return "-"; const d = new Date(sec * 1000), p = TPA.pad2; return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const wlState = (x) => (x.stale ? chip("古い", "c-warn", `${Math.round(x.ageHours)} 時間、更新されていません（元のアプリ・ファイルを書く仕組みが止まっていないか確かめてください）`) + " " : "")
  + wlFileState(x);
const wlFileState = (x) => x.state === "ok" ? "" : x.state === "renamed" ? chip("名前が変わった", "c-warn", `登録の名前「${x.file}」→ いま「${x.now}」。同じファイルをたどって読みます（「探す」で登録の名前も直ります）`)
  : x.state === "missing" ? chip("見つからない", "c-off", `「${x.file}」がフォルダにありません。右の選択で、結ぶファイルを選び直してください`) : chip("確かめられない", "c-plain", "フォルダに届きません");
/** 設備の並び替え（⋮⋮ を引く・⋮⋮ を選んで ↑↓）。枠（#masterSettings）は作り直さないので 1 回だけ付ける */
function bindWorklogOrder(box) {
  if (box.dataset.wlOrder) return;
  box.dataset.wlOrder = "1";
  const rows = () => [...box.querySelectorAll(".wl-tablelist tbody tr[data-key]")];
  const save = async (keys, focusKey = "") => {
    const res = await withLockWait(() => masterRequest("/api/masters/worklog/order", TPA.json("PUT", { keys })), () => {});
    if (!res.ok) { renderWorklog({ notice: ["ng", "✕ " + escapeHtml(res.data.error || "並びを保存できませんでした。")] }); return; }
    emit("tpa:worklog-changed");
    await renderWorklog({ notice: ["ok", "✓ 設備の並びを変えました（作業実績のタブも同じ並びです）"] });
    if (focusKey) box.querySelector(`tr[data-key="${CSS.escape(focusKey)}"] [data-wl-grip]`)?.focus();
  };
  TPA.sortable(box, { items: rows, keyOf: (tr) => tr.dataset.key, handle: "[data-wl-grip]", axis: "y",
    enabled: () => mstate.tab === "worklog" && !!box.querySelector("[data-wl-grip]"), onOrder: (keys) => save(keys) });
  box.addEventListener("keydown", (e) => {
    const g = e.target.closest("[data-wl-grip]");
    if (!g || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const k = g.closest("tr").dataset.key, keys = TPA.moveKey(rows().map((tr) => tr.dataset.key), k, e.key === "ArrowDown" ? 1 : -1);
    if (keys) save(keys, k);
  });
}
async function renderWorklog({ fresh = false, notice = null } = {}) {
  const box = $("#masterSettings");
  if (!mstate.data.worklog) box.innerHTML = '<p class="ps-loading">作業実績のフォルダを読んでいます…</p>';
  const r = await masterRequest("/api/masters/worklog" + (fresh ? "?fresh=1" : ""), { cache: "no-store" });
  if (mstate.tab !== "worklog") return;
  if (!r.ok) { box.innerHTML = `<p class="ps-loading">作業実績の登録を読めませんでした: ${escapeHtml(r.data.error || "")}</p>`; return; }
  const d = mstate.data.worklog = r.data;
  mstate.loadedRev.worklog = d.revision;
  const can = d.canEdit && !shareDown(), dis = can ? "" : ` disabled title="${escapeHtml(shareDown() ? "共有フォルダに届かないため、いまは保存できません" : readOnlyWhy("worklog") + "のため変えられません")}"`;
  const paths = mstate.data.paths && mstate.data.paths.items;
  const rev = (k) => ((paths || []).find((i) => i.key === k) || {}).rev || 0;
  const loose = d.new || [];
  const looseOpts = loose.map((f) => `<option value="${escapeHtml(f.file)}">${escapeHtml(f.file)}</option>`).join("");
  // 並び（版 3.28.0。ui-proposals/2026-10-equiporder* の M1）: 行の ⋮⋮ をつかんで引く・⋮⋮ を選んで ↑↓。作業実績のタブと同じ並び（全員で 1 つ）
  const sortable = can && d.items.length > 1;
  const rows = d.items.map((x) => `<tr data-id="${x.id}" data-rev="${x.rev}" data-key="${escapeHtml(x.key)}" class="${x.visible ? "" : "is-off"}${x.state === "missing" ? " is-missing" : ""}">
      ${sortable ? `<td class="wl-gripcell"><button type="button" class="wl-grip" data-wl-grip aria-label="「${escapeHtml(x.name)}」を動かす（↑↓）" title="つかんで並べ替え（選んで ↑↓ でも）">⋮⋮</button></td>` : ""}
      <td class="wl-vis"><label class="wl-switch" title="作業実績のタブで、この設備を選べるようにするか（いま: ${x.visible ? "表示する" : "表示しない"}）"><input type="checkbox" data-wl="vis" aria-label="${escapeHtml(x.name)} を表示する"${x.visible ? " checked" : ""}${dis}><i aria-hidden="true"></i></label></td>
      <td><input class="wl-name" data-wl="name" value="${escapeHtml(x.name)}" aria-label="設備名"${dis}></td>
      <td class="wl-file"><span class="m-ident">${escapeHtml(x.now || x.file)}</span> ${wlState(x)}
        ${x.state === "missing" && can && loose.length ? `<select data-wl="relink" aria-label="結ぶファイル"><option value="">結ぶファイルを選ぶ…</option>${looseOpts}</select>` : ""}</td>
      <td class="num">${wlAgo(x.mtime)}</td><td class="num">${x.size == null ? "-" : MB(x.size)}</td>
      <td><input class="wl-table" data-wl="table" value="${escapeHtml(x.table)}" placeholder="自動" aria-label="表（空なら自動）"${dis}></td>
      <td class="pz-acts">${can ? '<button type="button" class="pz-btn danger wl-del" data-wl="del" title="この設備の登録を消します（この設備の表示ルールは、同じキーの行が無くなるので使われなくなります）">登録を消す</button>' : ""}</td></tr>`).join("");
  const shown = d.items.filter((x) => x.visible).length;
  const miss = d.items.filter((x) => x.state === "missing"), old = d.items.filter((x) => x.stale), moved = d.items.filter((x) => x.state === "renamed");
  /* 直すこと（次の手つき）。無ければ出さない */
  const todo = d.error ? [] : [
    ...miss.map((x) => `<div><span class="m-chip c-off">見つからない</span><span><b>${escapeHtml(x.name)}</b>: ${escapeHtml(x.file)} がフォルダにありません</span>`
      + (can && loose.length ? `<button type="button" class="pz-btn" data-wl-go="${x.id}">結ぶファイルを選ぶ</button>` : "<small>名前が変わったか、消されました</small>") + "</div>"),
    ...old.map((x) => `<div><span class="m-chip c-warn">古い</span><span><b>${escapeHtml(x.name)}</b>: ${Math.round(x.ageHours)} 時間、更新されていません（ファイルを書く元のアプリ・仕組みが止まっていないか確かめてください）</span></div>`),
    ...(moved.length ? [`<div><span class="m-chip c-warn">名前が変わった</span><span>${moved.map((x) => `<b>${escapeHtml(x.name)}</b>（${escapeHtml(x.file)} → ${escapeHtml(x.now)}）`).join("・")}。同じファイルをたどって読んでいます</span>`
      + (can ? '<button type="button" class="pz-btn" data-wl-scan>登録の名前を直す</button>' : "") + "</div>"] : []),
    ...(loose.length ? [`<div><span class="m-chip c-plain">登録していない</span><span>${loose.length} 個（${loose.map((f) => escapeHtml(f.equipment)).join("・")}）</span>`
      + (can ? '<button type="button" class="pz-btn" data-wl-scan>設備として足す</button>' : "") + "</div>"] : []),
  ];
  const tally = [`<span class="wl-n">表示 ${shown}</span>`, miss.length ? `<span class="wl-n is-ng">見つからない ${miss.length}</span>` : "",
    old.length ? `<span class="wl-n is-warn">古い ${old.length}</span>` : "", shown < d.items.length ? `<span class="wl-n">表示しない ${d.items.length - shown}</span>` : ""].join("");
  box.innerHTML = `<section class="wl-page">
    <div class="wl-src">
      <label class="wl-field"><span>フォルダ</span><input class="ps-input" id="wlFolder" value="${escapeHtml(d.folder)}" spellcheck="false"${dis}></label>
      <label class="wl-field wl-pat" title="* の所が設備名になります（例: 実績_CR1.sqlite3 → CR1）"><span>ファイル名の決まり</span><input class="ps-input" id="wlPattern" value="${escapeHtml(d.pattern)}" spellcheck="false"${dis}></label>
      <button type="button" class="btn-primary" id="wlScan" title="フォルダの中で決まりに合うファイルを探し、新しい設備を足し、名前が変わったファイルをたどって登録を直します"${dis}>探す</button>
    </div>
    <div class="ps-result${notice ? ` ${notice[0]}` : " hidden"}" id="wlNotice" aria-live="polite">${notice ? notice[1] : ""}</div>
    ${d.error ? `<div class="dz-bad"><b>フォルダに届きません。</b>${escapeHtml(d.error)}<br>場所・ネットワークのつながりを確かめてください。前に写した設備は、写しのまま見られます。</div>` : ""}
    ${todo.length ? `<div class="wl-todo" role="region" aria-label="直すこと"><b>直すことが ${todo.length} つあります</b>${todo.join("")}</div>` : ""}
    <div class="wl-sum"><b>設備 ${d.items.length} 台</b>${tally}
      <small>表示ルール（表示列・条件・並び）は設備ごとに覚えます。ファイルの名前が変わっても、同じ設備のまま続きます。</small>
      ${sortable ? '<small class="wl-sorthint">⋮⋮ をつかんで並べ替え（選んで ↑↓ でも）。作業実績のタブも同じ並びになります</small>' : ""}</div>
    <div class="master-table-wrap pz-wrap"><table class="master-table wl-tablelist">
      <thead><tr>${sortable ? '<th class="wl-gripcell" aria-label="並び"></th>' : ""}<th>表示</th><th>設備名</th><th>ファイル</th><th class="num">最後の更新</th><th class="num">大きさ</th><th>表</th><th class="grow"></th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${d.items.length ? "" : `<div class="master-empty">まだ設備がありません。上のフォルダを確かめて「探す」を押すと、${escapeHtml(d.pattern)} に合うファイルを設備として並べます。</div>`}</div>
  </section>`;
  const say = (cls, html) => { const n = $("#wlNotice"); n.className = `ps-result ${cls}`; n.innerHTML = html; };
  const changed = () => emit("tpa:worklog-changed");
  bindWorklogOrder(box);
  const scan = async () => {
    const w = TPA.waiting({ title: "作業実績のフォルダを探しています", from: $("#wlFolder").value, now: "決まりに合うファイルを探し、設備の登録に当てています…",
      note: "共有のフォルダを読むので、数秒かかることがあります。" });
    const res = await withLockWait(() => masterRequest("/api/masters/worklog/scan", TPA.json("POST", {})), (x) => w.now(lockWaitText(x, "登録")));
    w.done();
    if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "探せませんでした。")); return; }
    const k = res.data.result, parts = [`ファイル ${k.files} 個を見つけました`];
    if (k.added.length) parts.push(`新しく ${k.added.length} 台を足しました（${k.added.map(escapeHtml).join("・")}）`);
    if (k.renamed.length) parts.push(`名前が変わった ${k.renamed.length} 台をたどりました（${k.renamed.map((x) => `${escapeHtml(x.from)} → ${escapeHtml(x.to)}`).join("・")}）`);
    if (k.missing.length) parts.push(`見つからない ${k.missing.length} 台（${k.missing.map(escapeHtml).join("・")}）: 表の選択で結ぶファイルを選び直せます`);
    changed();
    renderWorklog({ notice: [k.missing.length ? "wait" : "ok", "✓ " + parts.join("。")] });
  };
  /* フォルダ・決まりを直したら、参照先へ保存してから探す（1 つの押下で済む）。直していなければ探すだけ */
  $("#wlScan") && ($("#wlScan").onclick = async () => {
    if (!mstate.data.paths) { await ensureTabLoaded("paths"); }
    const its = (mstate.data.paths && mstate.data.paths.items) || [];
    for (const [key, val, now] of [["work_log.folder", $("#wlFolder").value.trim(), d.folder], ["work_log.pattern", $("#wlPattern").value.trim(), d.pattern]]) {
      if (val === now) continue;
      const it = its.find((i) => i.key === key) || {};
      const res = await withLockWait(() => masterRequest(`/api/settings/${encodeURIComponent(key)}`, TPA.json("PUT", { value: val, base_rev: it.rev || rev(key) })),
        (x) => say("wait", lockWaitText(x, "保存", boldName)));
      if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした。")); return; }
      mstate.data.paths = null;
      emit("tpa:settings-changed", { key });
    }
    scan();
  });
  TPA.pathPick($("#wlFolder"), { purpose: "worklog", pattern: () => $("#wlPattern").value, title: "作業実績のフォルダを選ぶ",
    note: "設備ごとの実績ファイルが並ぶフォルダを選びます（印: 決まりに合うファイルの数）。選んだら「探す」で設備を並べます。",
    chipsAfter: box.querySelector(".wl-src"), exclude: ["worklog"] });
  ["#wlFolder", "#wlPattern"].forEach((sel) => $(sel)?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#wlScan").click(); }));
  box.querySelectorAll("[data-wl-scan]").forEach((b) => b.addEventListener("click", scan));
  /* 「結ぶファイルを選ぶ」: その行の選択欄へ（行は表の中のまま。並びを変えない） */
  box.querySelectorAll("[data-wl-go]").forEach((b) => b.addEventListener("click", () => {
    const sel = box.querySelector(`tr[data-id="${b.dataset.wlGo}"] [data-wl="relink"]`);
    if (sel) { sel.scrollIntoView({ block: "center" }); sel.focus(); if (sel.showPicker) try { sel.showPicker(); } catch (_) { /* 選択欄を開けない WebView は、選ぶだけ */ } }
  }));
  /* 行を直す（表示・設備名・表・結ぶファイル）。行の版がずれていたら（ほかの PC が先に直した）、読み直して言う */
  const put = async (tr, body, what) => {
    const res = await withLockWait(() => masterRequest(`/api/masters/worklog/${tr.dataset.id}`, TPA.json("PUT", { ...body, base_rev: +tr.dataset.rev })),
      (x) => say("wait", lockWaitText(x, "保存", boldName)));
    if (res.status === 409 && res.data.kind === "conflict") { renderWorklog({ notice: ["ng", "開いたあとに、ほかの PC がこの設備を直しました。読み直したので、もう一度直してください。"] }); return; }
    if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした。")); return; }
    tr.dataset.rev = res.data.rev; changed();
    if (what) renderWorklog({ notice: ["ok", `✓ ${escapeHtml(what)}`] });
  };
  box.querySelectorAll("tr[data-id]").forEach((tr) => {
    const name = () => tr.querySelector(".wl-name").value.trim();
    tr.querySelector('[data-wl="vis"]').onchange = (e) => put(tr, { "表示": e.target.checked ? "有" : "無" }, `「${name()}」を${e.target.checked ? "表示する" : "表示しない"}にしました`);
    const commit = (el, field, label) => {
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") el.blur(); });
      el.addEventListener("change", () => put(tr, { [field]: el.value.trim() }, `「${name()}」の${label}を直しました`));
    };
    commit(tr.querySelector(".wl-name"), "設備名", "設備名");
    commit(tr.querySelector(".wl-table"), "表", "表");
    tr.querySelector('[data-wl="relink"]')?.addEventListener("change", (e) => { if (e.target.value) put(tr, { "ファイル名": e.target.value }, `「${name()}」を「${e.target.value}」に結びました`); });
    tr.querySelector('[data-wl="del"]')?.addEventListener("click", async () => {
      if (!confirm(`「${name()}」の登録を消します。フォルダのファイルは消しません（次に「探す」と、新しい設備として足されます）。よろしいですか？`)) return;
      const res = await masterRequest(`/api/masters/worklog/${tr.dataset.id}?rev=${tr.dataset.rev}`, { method: "DELETE" });
      if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "消せませんでした。")); return; }
      changed(); renderWorklog({ notice: ["ok", `✓ 「${escapeHtml(name())}」の登録を消しました`] });
    });
  });
  if (!paths) ensureTabLoaded("paths").catch(() => {});   // フォルダを直したときの行の版（参照先）を用意しておく
}

/* ---------------- 勤務体系（親: 勤務体系 / 子: 勤務区分。WaveLog の master-data.js の勤務体系の画面を移した） ----------------
   現場の言い方どおりの 2 階層で直す（日勤 → 日勤 8:15-17:05 ／ 交替勤務(1,2,3直) → 1直 7:00-15:00 …）。
   - 時刻は input[type=time]（表記ゆれ・全角数字が入らない）。よくある体系はテンプレートからひと押し
   - 24 時間の帯で、どの時間帯が埋まっているか・抜けているかを色で見せる（数字を見比べさせない）
   - 日を跨ぐ区分（終了 <= 開始）だけ「日付の数え方」を出す（跨がない区分に効かない欄を置かない）
   - 適用設備は作業実績の設備の札の入切。どれも選ばなければ全設備共通（設備を選んだ体系があれば、その設備ではそちらが先）
   下書き（mstate.shiftDraft）に写してから描き直す（押すたびに欄の値を失わない）。 */
const SHIFT_DAYOFF = [[-1, "前の日として数える（−1日）"], [0, "暦どおり（0日）"], [1, "翌日として数える（＋1日）"]];
const hmMin = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
const shiftCross = (g) => { const a = hmMin(g.start), b = hmMin(g.end); return a != null && b != null && b <= a; };
const shiftDraftOf = (p) => (p ? { id: p.id, rev: p.rev, name: p.name, equipment: [...p.equipment], note: p.note || "",
  segments: p.segments.map((g) => ({ name: g.name, start: g.start, end: g.end, dayOffset: g.crosses ? g.dayOffset : null })) }
  : { id: null, rev: 0, name: "", equipment: [], note: "", segments: [] });
function shiftBar(segs) {
  const pct = (v) => (v / 1440) * 100;
  return segs.map((g, i) => {
    const a = hmMin(g.start), b = hmMin(g.end);
    if (a == null || b == null || a === b) return "";
    const parts = b <= a ? [[a, 1440], [0, b]] : [[a, b]];
    return parts.map(([x, y]) => `<span class="sh-piece sh-c${i % 6}" style="left:${pct(x)}%;width:${pct(y) - pct(x)}%" title="${escapeHtml(g.name)} ${escapeHtml(g.start)}〜${escapeHtml(g.end)}"></span>`).join("");
  }).join("");
}
/** 24 時間のうち、どの区分にも入らない時間（分）。区分の重なりも数える（直は重ならない決まり） */
function shiftCoverage(segs) {
  const used = new Array(1440).fill(0);
  segs.forEach((g) => { const a = hmMin(g.start), b = hmMin(g.end); if (a == null || b == null || a === b) return;
    for (let m = a; m !== b; m = (m + 1) % 1440) used[m]++; });
  return { gap: used.filter((x) => !x).length, over: used.filter((x) => x > 1).length };
}
async function renderShifts({ notice = null, keep = false } = {}) {
  const box = $("#masterSettings");
  if (!keep || !mstate.data.shifts) {
    if (!mstate.data.shifts) box.innerHTML = '<p class="ps-loading">勤務体系を読んでいます…</p>';
    const r = await masterRequest("/api/masters/shifts", { cache: "no-store" });
    if (mstate.tab !== "shifts") return;
    if (!r.ok) { box.innerHTML = `<p class="ps-loading">勤務体系を読めませんでした: ${escapeHtml(r.data.error || "")}</p>`; return; }
    mstate.data.shifts = r.data;
    mstate.loadedRev.shifts = r.data.revision;
    const sel = mstate.shiftDraft && mstate.shiftDraft.id;
    const now = r.data.items.find((x) => x.id === sel) || (mstate.shiftDraft && !mstate.shiftDraft.id ? null : r.data.items[0]);
    if (!keep) mstate.shiftDraft = shiftDraftOf(now || null);
  }
  const d = mstate.data.shifts, dr = mstate.shiftDraft;
  const can = d.canEdit && !shareDown() && canWrite("shifts"), dis = can ? "" : ` disabled title="${escapeHtml(shareDown() ? "共有フォルダに届かないため、いまは保存できません" : readOnlyWhy("shifts") + "のため変えられません")}"`;
  const cov = shiftCoverage(dr.segments);
  const eqs = Array.from(new Set([...(d.equipments || []), ...dr.equipment]));
  const segRow = (g, i) => {
    const cross = shiftCross(g), off = g.dayOffset == null ? d.dayOffsetDefault : g.dayOffset;
    return `<div class="sh-seg" data-i="${i}"><i class="sh-dot sh-c${i % 6}" aria-hidden="true"></i>
      <input class="sh-name" value="${escapeHtml(g.name)}" placeholder="例: 1直" aria-label="区分の名称"${dis}>
      <span class="sh-time"><input type="time" class="sh-start" value="${escapeHtml(g.start)}" aria-label="開始"${dis}><span>〜</span><input type="time" class="sh-end" value="${escapeHtml(g.end)}" aria-label="終了"${dis}></span>
      <span class="sh-next">${cross ? "翌日" : ""}</span>
      ${cross ? `<select class="sh-off" title="日を跨いだ後の時間帯を、どの日として数えるか（作業実績の「現場歴」）"${dis}>${SHIFT_DAYOFF.map(([v, t]) => `<option value="${v}"${v === off ? " selected" : ""}>${t}</option>`).join("")}</select>`
        : '<span class="sh-off is-na" title="日を跨がない区分なので、日付の数え方はありません">—</span>'}
      <span class="sh-acts">${can ? `<button type="button" data-sh="up" title="上へ"${i ? "" : " disabled"}>▲</button><button type="button" data-sh="down" title="下へ"${i < dr.segments.length - 1 ? "" : " disabled"}>▼</button><button type="button" data-sh="del" title="この区分を消します">×</button>` : ""}</span></div>`;
  };
  box.innerHTML = `<section class="sh-page">
    <p class="ps-lead">勤務体系（日勤・交替勤務など）の中に、直の時間帯を並べます。作業実績を<b>「日＋直ごと」</b>にまとめるとき、作業開始の時刻が入る直で数えます。
      終了が開始より前（または同じ）の区分は翌日へ跨ぐ直で、<b>跨いだ後の時間帯は「日付の数え方」で決めた日</b>として数えます（3直 23:00〜翌7:00 を 1 つの日にまとめるため）。
      適用設備を選ばなければ全設備共通、設備を選んだ体系があればその設備ではそちらが先です。</p>
    <div class="ps-result${notice ? ` ${notice[0]}` : " hidden"}" id="shNotice" aria-live="polite">${notice ? notice[1] : ""}</div>
    <div class="sh-editor">
      <aside class="sh-list" aria-label="登録済みの勤務体系"><div class="sh-list-head">登録済みの勤務体系</div>
        ${d.items.length ? d.items.map((p) => `<button type="button" class="sh-item${p.id === dr.id ? " is-on" : ""}" data-sh-pick="${p.id}"><b>${escapeHtml(p.name)}</b>
          <small>${escapeHtml(p.equipmentText)}・${p.segments.length}区分</small></button>`).join("") : '<p class="sh-empty">まだありません。右のテンプレートから作れます。</p>'}
        ${can ? '<button type="button" class="sh-new" data-sh-new>＋ 勤務体系を足す</button>' : ""}</aside>
      <div class="sh-detail">
        <div class="sh-mode">${dr.id ? `直している体系 <b>${escapeHtml(dr.name)}</b>` : "<b>新しい勤務体系</b>"}
          ${can ? `<span class="sh-tmpl">テンプレート: ${d.templates.map((t, i) => `<button type="button" data-sh-tmpl="${i}" title="${escapeHtml(t.segments.map((g) => `${g.name} ${g.start}〜${g.end}`).join(" / "))}">${escapeHtml(t.label)}</button>`).join("")}</span>` : ""}</div>
        <label class="sh-field"><span>勤務体系の名称</span><input id="shName" class="ps-input" value="${escapeHtml(dr.name)}" placeholder="例: 交替勤務(1,2,3直)"${dis}></label>
        <div class="sh-field"><span>適用設備</span><div class="sh-eqs">
          <span class="sh-eqsum">${dr.equipment.length ? `<b>${dr.equipment.length}</b> 設備に当てる` : "<b>全設備共通</b>（どれも選んでいないので既定として使います）"}</span>
          ${eqs.map((n) => `<button type="button" class="sh-eq" data-sh-eq="${escapeHtml(n)}" aria-pressed="${dr.equipment.includes(n)}"${dis}>${escapeHtml(n)}</button>`).join("") || '<small>作業実績の設備がまだありません</small>'}</div></div>
        <div class="sh-barwrap"><div class="sh-bar" title="24 時間のうち、どの時間帯がどの区分か">${shiftBar(dr.segments)}</div>
          <div class="sh-scale"><span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>24時</span></div>
          <small class="sh-cov${cov.gap || cov.over ? " is-warn" : ""}">${!dr.segments.length ? "区分がありません" : cov.over ? `区分が ${Math.round(cov.over / 6) / 10} 時間重なっています（早い区分に数えます）` : cov.gap ? `どの区分にも入らない時間が ${Math.round(cov.gap / 6) / 10} 時間あります（その時刻の作業は「直の外」に数えます）` : "24 時間がすき間なく区分に入っています"}</small></div>
        <div class="sh-segs">${dr.segments.length ? '<div class="sh-seg sh-seghead"><i></i><span>区分の名称</span><span>時間帯</span><span></span><span>日付の数え方</span><span></span></div>' + dr.segments.map(segRow).join("") : '<p class="sh-empty">区分がありません。「＋ 区分を足す」かテンプレートから入れてください。</p>'}</div>
        <div class="sh-foot">${can ? '<button type="button" data-sh-add>＋ 区分を足す</button>' : ""}<span class="sh-gap"></span>
          ${can && dr.id ? '<button type="button" class="pz-btn danger" data-sh-delete>この勤務体系を消す</button>' : ""}
          ${can ? `<button type="button" class="btn-primary" data-sh-save>${dr.id ? "保存" : "足す"}</button>` : ""}</div>
      </div></div></section>`;
  const say = (cls, html) => { const n = $("#shNotice"); n.className = `ps-result ${cls}`; n.innerHTML = html; };
  /* 欄の値を下書きへ（押す前に毎回） */
  const sync = () => {
    dr.name = $("#shName").value;
    dr.segments = [...box.querySelectorAll(".sh-seg[data-i]")].map((el) => {
      const off = el.querySelector("select.sh-off");
      return { name: el.querySelector(".sh-name").value, start: el.querySelector(".sh-start").value, end: el.querySelector(".sh-end").value, dayOffset: off ? +off.value : null };
    });
  };
  const redraw = () => renderShifts({ keep: true });
  box.querySelector(".sh-editor").addEventListener("change", (e) => { if (e.target.matches(".sh-start,.sh-end,.sh-off")) { sync(); redraw(); } });
  box.querySelector(".sh-editor").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.shPick) { mstate.shiftDraft = shiftDraftOf(d.items.find((x) => x.id === +b.dataset.shPick)); redraw(); return; }
    if (b.hasAttribute("data-sh-new")) { mstate.shiftDraft = shiftDraftOf(null); redraw(); return; }
    sync();
    if (b.dataset.shTmpl != null) { const t = d.templates[+b.dataset.shTmpl]; dr.name = dr.name || t.label; dr.segments = t.segments.map((g) => ({ dayOffset: null, ...g })); redraw(); return; }
    if (b.dataset.shEq != null) { const n = b.dataset.shEq; dr.equipment = dr.equipment.includes(n) ? dr.equipment.filter((x) => x !== n) : dr.equipment.concat([n]); redraw(); return; }
    if (b.hasAttribute("data-sh-add")) { const last = dr.segments[dr.segments.length - 1]; dr.segments.push({ name: "", start: last ? last.end : "08:00", end: "", dayOffset: null }); redraw(); return; }
    const row = b.closest(".sh-seg[data-i]"), i = row ? +row.dataset.i : -1;
    if (b.dataset.sh === "del") { dr.segments.splice(i, 1); redraw(); return; }
    if (b.dataset.sh === "up" || b.dataset.sh === "down") { const j = i + (b.dataset.sh === "up" ? -1 : 1); [dr.segments[i], dr.segments[j]] = [dr.segments[j], dr.segments[i]]; redraw(); return; }
    if (b.hasAttribute("data-sh-save")) {
      const body = { name: dr.name, equipment: dr.equipment, segments: dr.segments, note: dr.note };
      const res = await withLockWait(() => masterRequest(dr.id ? `/api/masters/shifts/${dr.id}` : "/api/masters/shifts",
        TPA.json(dr.id ? "PUT" : "POST", dr.id ? { ...body, base_rev: dr.rev } : body)), (x) => say("wait", lockWaitText(x, "保存", boldName)));
      if (res.status === 409 && res.data.kind === "conflict") { mstate.shiftDraft = null; renderShifts({ notice: ["ng", "開いたあとに、ほかの PC がこの勤務体系を直しました。読み直したので、もう一度直してください。"] }); return; }
      if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "保存できませんでした。")); return; }
      const id = dr.id || res.data.created;
      mstate.data.shifts = null; mstate.shiftDraft = { id };
      emit("tpa:masters-changed");
      renderShifts({ notice: ["ok", `✓ 「${escapeHtml(dr.name)}」を保存しました（${dr.segments.length}区分）。作業実績の「日＋直ごと」にすぐ効きます`] });
      return;
    }
    if (b.hasAttribute("data-sh-delete")) {
      if (!confirm(`勤務体系「${dr.name}」を消します。よろしいですか？`)) return;
      const res = await masterRequest(`/api/masters/shifts/${dr.id}?rev=${dr.rev}`, { method: "DELETE" });
      if (!res.ok) { say("ng", "✕ " + escapeHtml(res.data.error || "消せませんでした。")); return; }
      mstate.data.shifts = null; mstate.shiftDraft = null; emit("tpa:masters-changed");
      renderShifts({ notice: ["ok", `✓ 「${escapeHtml(dr.name)}」を消しました`] });
    }
  });
}

/* ---------------- アプリの配布（① 版を置く → ② 配る版を選ぶ → ③ 各 PC がそろう） ----------------
   並びは作業の順（左→右・上→下）。判定は窓（distribute.rs）と Python（権限）で、ここは答えを並べるだけ。
   置いている間は進み具合を出す（共有へ十数 MB を写す。反応が無いと止まったように見える）。 */
const MB = (b) => `${(Number(b || 0) / 1048576).toFixed(1)} MB`;
const RELEASE_STAGE = { send: "ZIP を送っています", check: "ZIP の中身を確かめています（このアプリの物か・版・exe・同梱の Python）",
  copy: "置き場へ写しています", finish: "写した物を確かめて仕上げています" };
mstate.releaseBusy = null;      // 置いている最中 { name, size, p }
mstate.releaseSeq = 0;
/* 配布の頁を開く（タブを開いたとき・置いた／配ったあと）。置き場（BOX）をたどるのは遅いので:
   1) 覚えた答え（この画面で前に開いた・窓の裏の確認がたどった: ?cached=1）をすぐ描き、札で「最新を確かめています」と言う
   2) 裏でたどり直し（cached なし）、違っていれば描き直す（同じなら札を「最新」にするだけ。置き場を変える欄を開いていれば描き直さない）
   覚えも無い（窓が起きた直後など）ときと、置いた・配ったあと（fresh）は、たどり終えるまで待ちの窓（TPA.waiting）で何を待っているかを言う */
async function renderRelease({ fresh = false } = {}) {
  const box = $("#masterSettings"), seq = ++mstate.releaseSeq;
  const live = () => seq === mstate.releaseSeq && mstate.tab === "release";
  const get = (cached) => masterRequest("/__desktop/release" + (cached ? "?cached=1" : ""), { cache: "no-store" });
  const nope = () => { box.innerHTML = '<p class="ps-loading">アプリの配布は、デスクトップ版の窓の中でだけ使えます。</p>'; };
  const wait = () => TPA.waiting({ title: "アプリの配布の置き場を読んでいます", from: releaseSource(), background: !fresh,
    now: fresh ? "置いた・配った結果を、置き場からたどり直しています…" : "置き場のフォルダをたどり、置いてある版（release.json）を集めています…",
    note: "BOX・共有の置き場は、読むのに数秒〜数十秒かかることがあります。2 回目からは前に読んだ内容をすぐ出し、裏で確かめ直します。" });
  if (mstate.data.release && !fresh) paintRelease(mstate.data.release, "checking");
  else if (!fresh) {
    const w = wait(), first = await get(true);
    w.done();
    if (!live()) return;
    if (!first.ok) { nope(); return; }
    mstate.data.release = first.data;
    paintRelease(first.data, first.data.cached ? "checking" : "fresh");
    if (!first.data.cached) return;              // いまたどった答え（確かめ直すまでもない）
  }
  const w = fresh ? wait() : null, r = await get(false);
  w?.done();
  if (!live()) return;
  if (!r.ok) { if (mstate.data.release) paintReleaseFresh(mstate.data.release, "ng"); else nope(); return; }
  const same = mstate.data.release && releaseSig(mstate.data.release) === releaseSig(r.data);
  mstate.data.release = r.data;
  const editing = mstate.releaseBusy || ($("#dzPlaceBox") && !$("#dzPlaceBox").hidden);
  if (same || (editing && !fresh)) paintReleaseFresh(r.data, "fresh"); else paintRelease(r.data, "fresh");
}
/** 置き場の答えの中身の印（時刻・覚えたかを除く）。同じなら描き直さない */
const releaseSig = (d) => JSON.stringify({ ...d, cached: 0, checkedAt: 0 });
/** 待ちの窓に出す置き場（参照先の「更新の置き場」。読んでいなければ空） */
function releaseSource() {
  const it = ((mstate.data.paths && mstate.data.paths.items) || []).find((i) => i.key === "update.source");
  return it ? String(it.effective || "") : "";
}
/** 置き場の答えが「いつの物か」の札（確かめている最中・確かめた最新・確かめられなかった） */
function releaseFreshHtml(d, state) {
  const at = escapeHtml(String(d.checkedAt || "").slice(11, 16)), when = at ? `${at} に` : "前に";   // 時刻が分からないときは「前に」
  if (state === "checking") return `<span class="dz-fresh is-checking" title="前に読んだ内容を表示しています。置き場をたどり直し、変わっていれば描き直します"><i class="wait-spin" aria-hidden="true"></i>最新を確かめています（${when}読んだ内容を表示中）</span>`;
  if (state === "ng") return `<span class="dz-fresh is-ng" title="置き場をたどり直せませんでした。表示は${when}読んだ内容です">確かめられませんでした（${when}読んだ内容）</span>`;
  return `<span class="dz-fresh" title="置き場をたどって確かめた内容です">✓ ${at ? `${at} に確かめた` : "確かめた"}最新</span>`;
}
function paintReleaseFresh(d, state) {
  const el = document.querySelector("#masterSettings .dz-fresh");
  if (el) el.outerHTML = releaseFreshHtml(d, state);
}
function paintRelease(d, freshness) {
  const box = $("#masterSettings");
  const me = d.me || {};
  const placeBtn = me.canRelease && !mstate.releaseBusy
    ? '<button type="button" class="pz-btn dz-place-btn" id="dzPlaceBtn" aria-expanded="false" aria-controls="dzPlaceBox" title="配布の置き場の場所・フォルダの名前を変えます（置いてある版を写して、全員の PC の参照先を切り替えます）">配布の置き場を変える…</button>' : "";
  if (!d.reachable) {
    box.innerHTML = `<p class="dz-where">${releaseFreshHtml(d, freshness)}</p><div class="dz-bad"><b>更新の置き場に届きません。</b>${escapeHtml(d.why || "")}<br>
      「参照先」タブの「更新の置き場」を確かめてください（BOX の同期・権限も）。各 PC は届かないあいだ、いまの版のまま開きます。
      ${placeBtn ? `<div class="dz-bad-acts">${placeBtn}<small>置き場の場所・名前を変えたときは、ここから新しい置き場へ切り替えられます。</small></div>` : ""}</div>
      <div class="dz-place" id="dzPlaceBox" hidden></div>`;
    bindReleasePlace(d);
    return;
  }
  const dist = d.distributed, cur = dist && dist.version, prev = dist && dist.previous;
  const rec = dist && dist.recommended;   // 推奨アップデートの札（配っている版にだけ付く。版 3.35.0）
  const step3 = !cur ? "配る版が決まるまでは、置き場のいちばん新しい版を取り込みます（版 3.3.0 までと同じ）"
    : me.current === cur ? `この PC は配る版（<b>${escapeHtml(cur)}</b>）で動いています`
      : `この PC は開き直すと <b>${escapeHtml(me.current)} → ${escapeHtml(cur)}</b> になります`;
  const flow = `<ol class="dz-flow" aria-label="配布の流れ">
    <li class="dz-step"><b>① 版を置く</b><span>${d.versions.length} 版を置いてあります</span><small>GitHub Releases の ZIP を選ぶ</small></li>
    <li class="dz-arrow" aria-hidden="true"></li>
    <li class="dz-step${cur ? " is-set" : ""}"><b>② 配る版を選ぶ</b><span>${cur ? `配る版 <b>${escapeHtml(cur)}</b>${rec ? chip("↻ 推奨アップデート", "c-rec") : ""}` : "まだ決めていません"}</span>
      ${rec ? `<small class="dz-rec-note" title="${escapeHtml(rec.note || "")}">理由: ${escapeHtml(rec.note || "（書いていません）")}</small>` : ""}
      <small>${cur ? escapeHtml(`${dist.setAt || ""} ${dist.setBy || ""}`.trim()) + (prev ? `・前は ${escapeHtml(prev)}` : "") : "一覧の「この版を配る」で決める"}</small></li>
    <li class="dz-arrow" aria-hidden="true"></li>
    <li class="dz-step${cur && me.current !== cur ? " is-pending" : ""}"><b>③ 各 PC がそろう</b><span>${step3}</span>
      <small>起動したとき・30 分ごとに確かめ、取り込んでから開き直したときにそろいます（データ・設定は触りません）</small></li></ol>`;
  const entry = d.entry && d.entry.exists
    ? `<div class="dz-new"><b>新しい PC へ</b><span>このアドレスを渡し、ダブルクリックしてもらいます（ZIP の展開は要りません）:
        <code>${escapeHtml(d.entry.path)}</code><button type="button" class="pz-btn" id="dzCopy">アドレスをコピー</button>
        <small>配る版がその PC の作業場所へ写って開き、「この PC に入れる」でショートカットを作れます。BOX の見え方が人で違っても、その人に見えるアドレスで構いません。</small></span></div>`
    : `<div class="dz-new"><b>新しい PC へ</b><span>配る版を決めると、置き場に配る入口（exe）を置き、ここに渡すアドレスが出ます。</span></div>`;
  const busy = mstate.releaseBusy;
  const put = busy ? `<div class="dz-progress" id="dzProgress"><div class="dz-ptitle"></div><div class="dz-bar"><i></i></div><div class="dz-pmeta"></div>
      <small>置き終わるまでお待ちください。途中で閉じても、置きかけの版は配られません。</small></div>`
    : me.canRelease ? `<label class="btn-primary dz-pick"><input type="file" accept=".zip,application/zip" id="dzZip" hidden>ZIP から版を置く…</label>
      <small>置くだけでは配りません（試してから「この版を配る」）。同じ版はもう一度置けません。置き場: <code>${escapeHtml(d.folder)}</code></small>`
      : `<small>版を置く・配る版を決めるのは、開発者・メンテナンス者だけです（この PC は「${escapeHtml(me.role || "-")}」）。</small>`;
  const rows = d.versions.map((v) => {
    const tags = [v.version === cur ? chip("配っている", "c-on") : "", v.version === cur && rec ? chip("↻ 推奨", "c-rec") : "", v.version === prev ? chip("前に配った", "c-plain") : "",
      v.version === me.current ? chip("この PC", "c-me") : ""].join("");
    const act = me.canRelease && !busy && v.version !== cur
      ? `<button type="button" class="pz-btn${cur && cmpVer(v.version, cur) < 0 ? "" : " dz-go"}" data-dist="${escapeHtml(v.version)}">${cur && cmpVer(v.version, cur) < 0 ? "この版に戻す" : "この版を配る"}</button>`
        + `<button type="button" class="pz-btn dz-rm" data-remove="${escapeHtml(v.version)}" title="置き場からこの版を消します（配っている版は消せません）">消す</button>`
      : me.canRelease && !busy ? (rec
        ? '<button type="button" class="pz-btn" data-rec-off title="各 PC への知らせを止めます（配る版はそのまま）">推奨を外す</button>'
        : '<button type="button" class="pz-btn" data-rec-on title="この版を使っていない PC に、更新を促す控えめな知らせを出します">推奨にする…</button>') : "";
    return `<tr class="${v.version === cur ? "is-live" : ""}"><td><b class="pz-ver">${escapeHtml(v.version)}</b></td><td>${tags}</td>
      <td>${escapeHtml(stamp(v.placedAt) || "-")} ${escapeHtml([v.placedPc, v.placedBy].filter(Boolean).join("／"))}</td>
      <td><span class="m-ident">${escapeHtml(v.source || v.zip || "-")}</span></td><td class="num">${MB(v.bytes)}</td><td class="pz-acts">${act}</td></tr>`;
  }).join("");
  // いちばん上は 2 行（配布の置き場・全員のマスタの置き場）。配る版と一緒に全員へそろう物を、同じ形の行で並べる（版 3.34.0）
  const pin = dist && dist.masters, pinOpt = { canPin: !!me.canRelease, distributed: !!cur };
  box.innerHTML = `<div class="pin-2"><div class="pin-line"><b>配布の置き場</b><code title="${escapeHtml(d.found)}">${escapeHtml(d.found)}</code>${d.adjusted ? '<small class="pin-note">（この PC での BOX の見え方に合わせて探しました）</small>' : ""}${chip("届いています", "c-on")}${releaseFreshHtml(d, freshness)}<span class="pin-sp"></span>${placeBtn}</div>
    <div class="pin-masters">${pinLine(pin, pinOpt)}</div></div>
    <div class="dz-place" id="dzPlaceBox" hidden></div>
    ${flow}${entry}<div class="dz-put">${put}</div>
    <div class="master-table-wrap pz-wrap"><table class="master-table pz-table">
      <thead><tr><th>版</th><th>状態</th><th>置いた日時・PC／人</th><th>元の ZIP</th><th class="num">大きさ</th><th class="grow"></th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${d.versions.length ? "" : '<div class="master-empty">まだ版を置いていません。上の「ZIP から版を置く…」で置いてください。</div>'}</div>
    ${(d.problems || []).length ? `<p class="ps-hint">読めない物: ${d.problems.map(escapeHtml).join("<br>")}</p>` : ""}`;
  const zip = $("#dzZip"); if (zip) zip.onchange = () => { placeRelease(zip.files && zip.files[0]); zip.value = ""; };
  const copy = $("#dzCopy"); if (copy) copy.onclick = () => navigator.clipboard.writeText(d.entry.path).then(() => { copy.textContent = "コピーしました"; });
  box.querySelectorAll("[data-dist]").forEach((b) => { b.onclick = () => distributeRelease(b.dataset.dist, d); });
  box.querySelectorAll("[data-remove]").forEach((b) => { b.onclick = () => armRemove(b); });
  const recOn = box.querySelector("[data-rec-on]"); if (recOn) recOn.onclick = () => askRecommend(recOn.closest("td"), cur);
  const recOff = box.querySelector("[data-rec-off]"); if (recOff) recOff.onclick = () => setRecommended(cur, false, "");
  const paintPin = () => { const m = box.querySelector(".pin-masters"); if (!m) return; m.innerHTML = pinLine(pin, pinOpt); bindPinLine(m, pin || {}, () => renderRelease({ fresh: true })); };
  paintPin();
  if (!mstate.placeInfo) loadPlaceInfo().then(() => { if (mstate.tab === "release") paintPin(); });   // 置き場ごとに使っている PC の数（あとから）
  bindReleasePlace(d);
  paintReleaseProgress();
}
/* ---------------- 配布の置き場を変える（場所・フォルダの名前） ----------------
   ① 上のフォルダと名前を入れる（いまの置き場から始める）。打つたびにサーバーが確かめ、写す量・切り替えるだけか・使えない理由を出す。
   ② 変える: いまの置き場を新しい場所の隣の一時フォルダへ写し、写し終えてから名前を付ける（services/release_place.py）
      → 参照先「更新の置き場」（update.source）を新しい場所に書き換える（全員の PC に効く・行の版と書き込みの門番が効く）。
   前の置き場は消さない（ほかの PC が持っている前の入口のアドレス・戻すときのため）。 */
const splitPath = (p) => {
  const s = String(p || "").trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i < 0 ? ["", s] : [s.slice(0, i) || s.slice(0, i + 1), s.slice(i + 1)];
};
/* 置き場の欄（上のフォルダ＋フォルダの名前）で、参照… の窓・よく使う場所の札から選んだとき（版 3.29.0）。
   選んだのが既に置き場（印のあるフォルダ・前の置き場）なら、上のフォルダと名前に分けて入れる（＝写さずに切り替える）。
   ふつうのフォルダなら、その中に置く（上のフォルダに入れ、名前はそのまま） */
const placePick = (parentSel, nameSel, again = []) => (path, item) => {
  const isPlace = (item.mark && item.mark.tone === "ok") || again.includes(item.key);
  const [parent, name] = isPlace ? splitPath(path) : [path, null];
  $(parentSel).value = parent;
  if (name) $(nameSel).value = name;
  $(parentSel).dispatchEvent(new Event("input", { bubbles: true }));
};
function bindReleasePlace(d) {
  const btn = $("#dzPlaceBtn"), box = $("#dzPlaceBox");
  if (!btn || !box) return;
  btn.onclick = () => {
    if (box.hidden) openReleasePlace(d); else box.hidden = true;
    btn.setAttribute("aria-expanded", String(!box.hidden));
  };
}
function openReleasePlace(d) {
  const box = $("#dzPlaceBox"), cur = d.found || String(d.folder || "").split(";")[0] || "";
  const [parent, name] = splitPath(cur), sep = cur.includes("/") && !cur.includes("\\") ? "/" : "\\";
  const canCopy = !!(d.reachable && d.found);
  box.hidden = false;
  box.innerHTML = `<div class="dz-pl-head"><b>配布の置き場を変える</b><small>置く場所（上のフォルダ）とフォルダの名前を決めます。いまの置き場から始めているので、変えたい所だけ直してください。</small></div>
    <div class="dz-pl-grid">
      <label class="dz-pl-f">置く場所（上のフォルダ）<input id="dzPlParent" class="ps-input" value="${escapeHtml(parent)}" spellcheck="false" autocomplete="off"></label>
      <span class="dz-pl-sep" aria-hidden="true">${escapeHtml(sep)}</span>
      <label class="dz-pl-f">フォルダの名前<input id="dzPlName" class="ps-input" value="${escapeHtml(name)}" spellcheck="false" autocomplete="off" maxlength="120"></label>
    </div>
    <p class="dz-pl-new">新しい置き場 <code id="dzPlDest"></code></p>
    <div class="dz-tree" id="dzPlTree" aria-label="変えたあとのフォルダの形"></div>
    <label class="dz-pl-copy"><input type="checkbox" id="dzPlCopy"${canCopy ? " checked" : " disabled"}>
      置いてある版・配る版・配る入口を、そのまま新しい置き場へ写す<small>${canCopy ? "前の置き場は消さずに残します（あとで要らなければ手で消せます）" : "いまの置き場に届かないので写せません（切り替えるだけになります）"}</small></label>
    <div class="dz-pl-state" id="dzPlState" aria-live="polite"></div>
    <div class="dz-pl-acts"><button type="button" class="btn-primary" id="dzPlGo" disabled>この置き場に変える</button><button type="button" class="pz-btn" id="dzPlCancel">やめる</button></div>`;
  const say = (cls, html) => { const s = $("#dzPlState"); s.className = `dz-pl-state ${cls}`; s.innerHTML = html; };
  const args = () => ({ from: canCopy ? d.found : "", parent: $("#dzPlParent").value, name: $("#dzPlName").value, copy: $("#dzPlCopy").checked });
  let seq = 0, timer = null, last = null;
  const check = async () => {
    const a = args(), my = ++seq;
    $("#dzPlDest").textContent = `${a.parent.trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "")}${sep}${a.name.trim()}`;
    say("wait", "確かめています…");
    const r = await masterRequest("/api/release/place/check", TPA.json("POST", a));
    if (my !== seq) return;               // 打ち続けているあいだの古い答えは捨てる
    last = r.data || {};
    $("#dzPlTree").innerHTML = placeTree(d, a, last, sep);
    const go = $("#dzPlGo");
    go.disabled = !last.ok;
    go.textContent = last.mode === "copy" ? "写して、この置き場に変える" : "この置き場に切り替える";
    if (!last.ok) say("ng", "✕ " + escapeHtml(last.problem || last.error || "変えられません。"));
    else say("ok", "✓ " + escapeHtml(last.note || "") + (last.mode === "copy" ? `<small>写す量 ${last.files} ファイル・${MB(last.bytes)}</small>` : ""));
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(check, 350); };
  TPA.pathPick($("#dzPlParent"), { purpose: "release", title: "配布の置き場を置く場所を選ぶ",
    note: "置き場のフォルダを入れる、上のフォルダを選びます。版の置き場（印のあるフォルダ）を選ぶと、そこへ切り替えます。",
    chipsAfter: box.querySelector(".dz-pl-grid"), exclude: ["release"], onPick: placePick("#dzPlParent", "#dzPlName") });
  $("#dzPlParent").addEventListener("input", later);
  $("#dzPlName").addEventListener("input", later);
  $("#dzPlCopy").addEventListener("change", check);
  $("#dzPlCancel").onclick = () => { box.hidden = true; $("#dzPlaceBtn")?.setAttribute("aria-expanded", "false"); };
  $("#dzPlGo").onclick = () => { if (last && last.ok) moveReleasePlace(d, args(), last, say); };
  check();
  requestAnimationFrame(() => $("#dzPlName").focus());
}
/* 変えたあとのフォルダの形（木）。いまの置き場は灰（残す）、新しい置き場は藍（写す／切り替えるだけ／空のまま）、中身は置いてある版。
   上のフォルダが同じなら1本の木、違えば2本並べる。使えないときは新しい置き場を赤で示す。 */
function placeTree(d, a, pl, sep) {
  const clean = (x) => String(x || "").trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
  const [curParent, curName] = splitPath(d.found || ""), newParent = clean(a.parent), newName = String(a.name || "").trim() || "（名前）";
  const same = curParent && curParent.toLowerCase() === newParent.toLowerCase();
  const dist = d.distributed && d.distributed.version;
  const vers = (d.versions || []).map((v) => `<li>📁 ${escapeHtml(v.version)}${v.version === dist ? '<em class="dz-t-dist">配る版</em>' : ""}</li>`).join("");
  const inside = `<ul>${vers}<li>📄 配る版の覚え・配る入口（exe）</li></ul>`;
  const mode = !pl.ok ? ["is-ng", "使えません"] : pl.mode === "copy" ? ["is-copy", "← いまの置き場を写す"] : pl.mode === "switch" ? ["is-switch", "← 既に置き場（写さずに切り替える）"] : ["is-empty", "← 空のまま切り替える"];
  const oldLi = d.found ? `<li class="dz-t-old">📁 ${escapeHtml(curName)}<em>いまの置き場・消さずに残す</em></li>` : "";
  const newLi = `<li class="dz-t-new ${mode[0]}">📁 <b>${escapeHtml(newName)}</b><em>${mode[1]}</em>${pl.ok && pl.mode !== "empty" ? inside : ""}</li>`;
  const root = (path, items) => `<ul class="dz-t-root"><li>📁 ${escapeHtml(path || "（場所）")}<ul>${items}</ul></li></ul>`;
  return same ? root(newParent, oldLi + newLi) : (d.found ? root(curParent, oldLi) : "") + root(newParent, newLi);
}
/* 置き場を変える。確かめない（版 3.19.0）: 押す前に、変えたあとのフォルダの木と写す量を出していて、前の置き場は消さずに残す */
async function moveReleasePlace(d, a, pl, say) {
  const go = $("#dzPlGo"); go.disabled = true;
  const r = await masterRequest("/api/release/place/move", TPA.json("POST", a));
  if (!r.ok) { say("ng", "✕ " + escapeHtml(r.data.error || "変えられませんでした。")); go.disabled = false; return; }
  if (r.data.started) {
    for (;;) {                           // 写し終えるまで進み具合を出す（共有・BOX へ数十〜数百 MB）
      await new Promise((res) => setTimeout(res, 400));
      const p = (await masterRequest("/api/release/place/progress")).data || {};
      if (p.state === "failed") { say("ng", "✕ " + escapeHtml(p.error || "写せませんでした。") + "<small>写しかけの物は片付けました。前の置き場はそのままです。</small>"); go.disabled = false; return; }
      if (p.state !== "running") break;
      const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
      say("wait", `写しています… ${p.files || 0} / ${p.totalFiles || 0} ファイル・${MB(p.done)} / ${MB(p.total)}（経過 ${Math.round(p.elapsed || 0)} 秒）`
        + `<div class="dz-bar"><i style="width:${pct.toFixed(0)}%"></i></div>`);
    }
  }
  say("wait", "参照先「更新の置き場」を書き換えています…");
  const st = await masterRequest("/api/settings", { cache: "no-store" });
  const item = ((st.data || {}).items || []).find((x) => x.key === "update.source") || {};
  const res = await withLockWait(
    () => masterRequest("/api/settings/update.source", TPA.json("PUT", { value: r.data.dest, base_rev: item.rev || 0 })),
    (dd) => say("wait", lockWaitText(dd, "保存", boldName)));
  if (!res.ok) {
    say("ng", `✕ ${r.data.started ? "写し終えましたが、" : ""}参照先を書き換えられませんでした: ${escapeHtml(res.data.error || "")}<br>`
      + `「参照先」タブの「更新の置き場」に <code>${escapeHtml(r.data.dest)}</code> を入れて保存してください。`);
    return;
  }
  emit("tpa:settings-changed", { key: "update.source" });
  await renderRelease({ fresh: true });
  releaseNotice("ok", `✓ 配布の置き場を ${r.data.dest} に変えました。全員の PC が次に確かめたときから、新しい置き場を見ます。`
    + "\n新しい PC へ渡すアドレスも変わりました（下の「アドレスをコピー」で写し直してください）。"
    + (r.data.started ? `\n前の置き場（${d.found}）は残しています。要らなければ、全員がそろったあとで手で消してください。` : ""));
}
/* ---------------- マスタの置き場（共有フォルダ）を変える（services/master_place.py） ----------------
   頁は上から「いまの置き場」→「置き場を変える」→「これまでの置き場」。形は配布の置き場を変えると同じ（上のフォルダ＋名前・木・確かめる）。
   変える: いまのマスタを新しい場所へ写してから、この PC を切り替える。ほかの PC は前の置き場の印（_MOVED.json）をたどって移る。 */
async function renderMasterPlace() {
  const box = $("#masterSettings");
  const r = await masterRequest("/api/masters/place", { cache: "no-store" });
  if (mstate.tab !== "place") return;
  if (!r.ok) { box.innerHTML = `<p class="ps-loading">置き場を読めませんでした: ${escapeHtml(r.data.error || "")}</p>`; return; }
  const d = r.data, [tag, cls, what] = placeState(d), shared = d.mode === "shared";
  mstate.placeInfo = d;
  const where = shared ? `<code>${escapeHtml(d.dir)}</code>` : "<b>この PC の中だけ</b>";
  const from = !shared ? "" : d.override ? "この PC で選んだ置き場です（設定ファイルより先に使います）。" : "設定ファイル（master_share.dir）で決めた置き場です。";
  const hist = (d.history || []).map((h) => `<li><span>${h.dir ? `<code>${escapeHtml(h.dir)}</code>` : "この PC の中だけ（手元のみ）"}</span>
    <small>${escapeHtml(stamp(h.until) || "")} まで${h.by && (h.by.pc || h.by.login) ? `・${escapeHtml(whoText(h.by))} が変えた` : ""}</small></li>`).join("");
  const rel = mstate.data.release && mstate.data.release.distributed;
  box.innerHTML = `<section class="mp-page">
    <div class="mp-now"><span class="mp-tag ${cls}">${tag}</span><div><div class="mp-where">${where}</div><small>${escapeHtml(what)}${from ? " " + escapeHtml(from) : ""}</small></div></div>
    <div class="pin-2 pin-masters">${pinLine(d.pin, { canPin: d.canChange, distributed: !!(rel || d.pin) })}</div>
    <div class="mp-sec"><h3>置き場を変える</h3><small class="mp-sub">変えると、配る版の覚えにも新しい置き場を書きます。全員の PC が、起動したとき・30 分ごとに受け取って移ります。</small>${d.canChange ? '<div class="dz-place mp-form" id="mpForm"></div>'
      : `<p class="mp-why">${escapeHtml(d.why || "この PC では置き場を変えられません。")}<br>変えるときは、開発者・メンテナンス者の PC から変えてください。</p>`}</div>
    <div class="mp-sec"><h3>これまでの置き場</h3><small class="mp-sub">前の置き場のマスタは消さずに残しています。戻すときは、上で前の置き場を選ぶと写さずに切り替わります。</small>
      ${hist ? `<ul class="mp-hist">${hist}</ul>` : '<p class="mp-none">まだ変えていません。</p>'}</div>
  </section>`;
  bindPinLine(box.querySelector(".pin-masters"), d.pin || {}, () => renderMasterPlace());
  if (d.canChange) openMasterPlaceForm(d);
}
function openMasterPlaceForm(d) {
  const form = $("#mpForm"), cur = d.mode === "shared" ? d.dir : "";
  const [parent, name] = cur ? splitPath(cur) : ["", "Masters"], sep = cur.includes("/") && !cur.includes("\\") ? "/" : "\\";
  form.innerHTML = `<div class="dz-pl-head"><small>${cur ? "いまの置き場から始めています。変えたい所だけ直してください。"
      : "共有フォルダ（全員の PC から届く所）と、マスタを入れるフォルダの名前を決めます。"}</small></div>
    <div class="dz-pl-grid">
      <label class="dz-pl-f">置く場所（上のフォルダ）<input id="mpParent" class="ps-input" value="${escapeHtml(parent)}" placeholder="例: \\\\サーバー\\共有\\検査データ" spellcheck="false" autocomplete="off"></label>
      <span class="dz-pl-sep" aria-hidden="true">${escapeHtml(sep)}</span>
      <label class="dz-pl-f">フォルダの名前<input id="mpName" class="ps-input" value="${escapeHtml(name)}" spellcheck="false" autocomplete="off" maxlength="120"></label>
    </div>
    <div class="dz-tree" id="mpTree" aria-label="変えたあとのフォルダの形"></div>
    <div class="dz-pl-state" id="mpState" aria-live="polite"></div>
    <div class="dz-pl-acts"><button type="button" class="btn-primary" id="mpGo" disabled>写して、この置き場に変える</button></div>`;
  const say = (c, html) => { const st = $("#mpState"); st.className = `dz-pl-state ${c}`; st.innerHTML = html; };
  const args = () => ({ parent: $("#mpParent").value, name: $("#mpName").value });
  let seq = 0, timer = null, last = null;
  const check = async () => {
    const a = args(), my = ++seq;
    if (!a.parent.trim()) { last = null; $("#mpGo").disabled = true; $("#mpTree").innerHTML = ""; say("", "置く場所（上のフォルダ）を入れると、変えられるかを確かめます。"); return; }
    const dest = `${a.parent.trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "")}${sep}${a.name.trim()}`;
    if (cur && dest.toLowerCase() === cur.toLowerCase()) {
      last = null; $("#mpGo").disabled = true; $("#mpTree").innerHTML = "";
      say("", "いまの置き場です。変えるときは、置く場所かフォルダの名前を直してください。"); return;
    }
    say("wait", "確かめています…");
    const r = await masterRequest("/api/masters/place/check", TPA.json("POST", a));
    if (my !== seq) return;               // 打ち続けているあいだの古い答えは捨てる
    last = r.data || {};
    $("#mpTree").innerHTML = masterPlaceTree(cur, a, last, sep);
    const go = $("#mpGo");
    go.disabled = !last.ok;
    go.textContent = last.mode === "switch" ? "この置き場に切り替える" : "写して、この置き場に変える";
    if (!last.ok) say("ng", "✕ " + escapeHtml(last.problem || last.error || "変えられません。"));
    else say(last.caution ? "wait" : "ok", (last.caution ? `⚠ ${escapeHtml(last.caution)}<br>` : "") + "✓ " + escapeHtml(last.note || "")
      + "<small>変えたあと、ほかの PC はマスタを読みに行くついでに（数秒ごと）新しい置き場へ移ります。前の置き場のマスタは消しません。</small>");
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(check, 350); };
  TPA.pathPick($("#mpParent"), { purpose: "master", title: "マスタの置き場を置く場所を選ぶ",
    note: "マスタのフォルダを入れる、上のフォルダを選びます。マスタのあるフォルダ（印つき）を選ぶと、そこへ切り替えます。",
    chipsAfter: form.querySelector(".dz-pl-grid"), exclude: ["master"], onPick: placePick("#mpParent", "#mpName", ["oldmaster"]) });
  $("#mpParent").addEventListener("input", later);
  $("#mpName").addEventListener("input", later);
  $("#mpGo").onclick = () => { if (last && last.ok) moveMasterPlace(cur, args(), last, say); };
  check();
}
/* 変えたあとのフォルダの形。いまの置き場は灰（残す）、新しい置き場は藍（写す／切り替えるだけ）、使えないときは赤 */
function masterPlaceTree(cur, a, pl, sep) {
  const clean = (x) => String(x || "").trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
  const [curParent, curName] = cur ? splitPath(cur) : ["", ""], newParent = clean(a.parent), newName = String(a.name || "").trim() || "（名前）";
  const same = curParent && curParent.toLowerCase() === newParent.toLowerCase();
  const mode = !pl.ok ? ["is-ng", "使えません"] : pl.mode === "switch" ? ["is-switch", "← 既にマスタがある（写さずに切り替える）"]
    : ["is-copy", `← ${cur ? "いまの置き場" : "この PC"}のマスタを写す（${pl.files} ファイル・${Math.max(1, Math.round((pl.bytes || 0) / 1024))} KB）`];
  const oldLi = cur ? `<li class="dz-t-old">📁 ${escapeHtml(curName)}<em>いまの置き場・消さずに残す</em></li>` : "";
  const newLi = `<li class="dz-t-new ${mode[0]}">📁 <b>${escapeHtml(newName)}</b><em>${escapeHtml(mode[1])}</em></li>`;
  const root = (path, items) => `<ul class="dz-t-root"><li>📁 ${escapeHtml(path || "（場所）")}<ul>${items}</ul></li></ul>`;
  return same ? root(newParent, oldLi + newLi) : (cur ? root(curParent, oldLi) : "") + root(newParent, newLi);
}
/* 確かめない（版 3.19.0）: 押す前に変えたあとの木を出していて、前の置き場は消さずに残す */
async function moveMasterPlace(cur, a, pl, say) {
  const go = $("#mpGo"); go.disabled = true;
  say("wait", pl.mode === "switch" ? "切り替えています…" : "写しています…");
  const r = await masterRequest("/api/masters/place/move", TPA.json("POST", a));
  if (!r.ok) { say("ng", "✕ " + escapeHtml(r.data.error || "変えられませんでした。")); go.disabled = false; return; }
  // 配る版の覚えにも新しい置き場を書く（全員の PC が更新を確かめるたびに受け取って移る。版 3.34.0）。窓の外・配る版がまだ無いときは書けない
  const pin = await pinMasters(r.data.dest);
  Object.keys(mstate.data).forEach((k) => { mstate.data[k] = null; });   // マスタは新しい置き場から読み直す
  mstate.loadedRev = {};
  await refreshPlace();
  buildMasterTabs();
  await renderMasterPlace();
  const warn = [r.data.warning, pin.ok ? "" : `配る版の覚えに新しい置き場を書けませんでした（${pin.why}）。ほかの PC は前の置き場の印をたどって移ります。`].filter(Boolean).join("\n");
  const done = `✓ マスタの置き場を ${r.data.dest} に変えました。` + (pin.ok ? "配る版の覚えにも書いたので、全員の PC が数秒〜30 分で移ります。" : "") + (warn ? `\n${warn}` : "");
  $("#mpState")?.insertAdjacentHTML("beforebegin", `<div class="ps-result ${warn ? "wait" : "ok"}" style="white-space:pre-line">${escapeHtml(done)}</div>`);
  emit("tpa:settings-changed", { key: "master_place" });
}
/* ---------------- 全員のマスタの置き場（配る版の覚え distribute.json の masters。版 3.34.0） ----------------
   配る版と一緒に全員の PC へ届き、各 PC はその置き場へ移る（MasterStore.follow_moved）。この PC の置き場（mstate.place.dir）と比べ、
   ずれていれば直す 2 つの手: 「この PC をそろえる」（この PC を全員の置き場へ切り替える）・「この置き場を配る」（この PC の置き場を全員に） */
const samePlace = (a, b) => String(a || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase() === String(b || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
/** 長いパスは先頭（サーバー）と末尾の 2 段を残して真ん中を縮める（どの置き場かは末尾で分かる。全文は title に） */
function shortPath(p, keep = 2) {
  const s = String(p || ""), unc = s.startsWith("\\\\"), parts = s.replace(/^\\\\/, "").split(/[\\/]/).filter(Boolean);
  if (parts.length <= keep + 1) return s;
  return (unc ? "\\\\" : "") + [parts[0], "…", ...parts.slice(-keep)].join("\\");
}
/** 置き場ごとの「いま使っている PC」（/api/masters/place の using）から、その置き場の台数と、ほかの置き場に残っている台数 */
function pinCount(dir) {
  const using = (mstate.placeInfo && mstate.placeInfo.using) || [];
  const here = using.find((u) => samePlace(u.dir, dir)), rest = using.filter((u) => !samePlace(u.dir, dir) && u.pcs.length);
  const names = (list) => list.map((x) => x.pc || x.login).join("・");
  const others = rest.reduce((n, u) => n + u.pcs.length, 0);
  if (here && !here.reachable) return chip("この PC から届きません", "c-warn", `${dir} に届きません（この PC の見え方・つながりを確かめてください）。届かないあいだ、この PC は今の置き場のまま使います`);
  return (here ? chip(`使っている PC ${here.pcs.length} 台`, "c-plain", here.pcs.length ? `いまこの置き場を使っている PC: ${names(here.pcs)}` : "いまこの置き場を使っている PC はありません") : "")
    + (others ? chip(`前の置き場に ${others} 台`, "c-warn", rest.map((u) => `${u.dir}: ${names(u.pcs)}`).join("\n") + "\n（起動したとき・30 分ごとに、全員の置き場へ移ります）") : "");
}
/** 全員のマスタの置き場の行（配る版の覚えの masters。pin が無ければ、まだ配っていない）。I3（ui-proposals/2026-10-masterpin*: 3 回の比べで 1 位）。
    そろっているときは軽く、ずれているときだけ橙の行と直す 2 つの手（この PC をそろえる・この PC の置き場を配る） */
function pinLine(pin, { canPin, distributed }) {
  const mine = (mstate.place && mstate.place.mode === "shared" && mstate.place.dir) || "";
  // この PC が手元のみなら、配る置き場が無い（窓は空の置き場を書かない）。ボタンは出さず、理由を出す
  const publish = canPin && distributed && !mine ? '<span class="pin-none" title="この PC のマスタは手元のみ（この PC の中だけ）なので、全員へ配れません。全員へ配るには、マスタの置き場を共有フォルダにしてください">この PC は手元のみ（配れません）</span>'
    : canPin && distributed ? `<button type="button" class="pz-btn" data-pin="publish" title="この PC の置き場（${escapeHtml(mine || "手元のみ")}）を、配る版の覚えに書いて全員に配ります">この PC の置き場を配る</button>` : "";
  if (!pin || !pin.dir) {
    return `<div class="pin-line"><b>全員のマスタの置き場</b><span class="pin-none">${distributed ? "まだ配っていません（各 PC は、前の置き場の印をたどって移ります）" : "配る版を決めると、決めた人の PC の置き場を一緒に全員へ配ります"}</span><span class="pin-sp"></span>${publish}</div>`;
  }
  const off = !samePlace(pin.dir, mine);
  const who = [pin.setBy, pin.setPc].filter(Boolean).join("・");
  const tip = `${stamp(pin.setAt) || ""}${who ? ` ${who}` : ""} が配りました。配る版と一緒に全員の PC へ届き、各 PC は起動したとき・30 分ごとに受け取って、数秒でこの置き場へ移ります。マスタの置き場を変えると、ここも新しい置き場になります。`;
  const using = ((mstate.placeInfo && mstate.placeInfo.using) || []).find((u) => samePlace(u.dir, pin.dir));
  const reach = !using || using.reachable;   // 届かない置き場へは、そろえられない（そろえる手を出さない）
  const fix = canPin && reach ? '<button type="button" class="pz-btn dz-go" data-pin="follow" title="この PC のマスタの置き場を、全員の置き場に切り替えます（写さずに切り替える）">この PC をそろえる</button>' + publish : canPin ? publish : "";
  return `<div class="pin-line${off ? " is-off" : ""}" title="${escapeHtml(tip)}"><b>全員のマスタの置き場</b><code title="${escapeHtml(pin.dir)}">${escapeHtml(shortPath(pin.dir))}</code>`
    + (off ? chip(`この PC は別: ${mine ? shortPath(mine, 2) : "手元のみ"}`, "c-warn", mine || "この PC の中だけ（手元のみ）") : chip("✓ この PC も同じ", "c-on"))
    + pinCount(pin.dir) + `<span class="pin-sp"></span>${off ? fix : ""}</div>`;
}
/** 行の手（data-pin）を結ぶ。done: 済んだら描き直す */
function bindPinLine(box, pin, done) {
  box.querySelectorAll("[data-pin]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      let ok, why = "";
      if (b.dataset.pin === "follow") {
        const s = String(pin.dir).replace(/[\\/]+$/, ""), i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
        const r = await masterRequest("/api/masters/place/move", TPA.json("POST", { parent: s.slice(0, i), name: s.slice(i + 1) }));
        ok = r.ok; why = r.data && r.data.error;
        if (ok) { Object.keys(mstate.data).forEach((k) => { if (k !== "release") mstate.data[k] = null; }); mstate.loadedRev = {}; emit("tpa:settings-changed", { key: "master_place" }); }
      } else {
        const r = await pinMasters("");
        ok = r.ok; why = r.why;
      }
      await refreshPlace();
      await loadPlaceInfo();
      if (!ok) { b.disabled = false; b.title = `できませんでした: ${why || ""}`; b.textContent = "できませんでした"; return; }
      done();
    };
  });
}
/** マスタの置き場の答え（/api/masters/place: この PC の置き場・配る版の覚えの置き場・置き場ごとに使っている PC）を読む */
async function loadPlaceInfo() {
  const r = await masterRequest("/api/masters/place", { cache: "no-store" });
  if (r.ok) mstate.placeInfo = r.data;
  return r.ok ? r.data : null;
}
/** 全員が使うマスタの置き場を、配る版の覚え（distribute.json の masters）に書く（desktop/src/distribute.rs の set_masters）。
    dir が空なら、この PC がいま使う置き場。→ {ok, why, masters} */
async function pinMasters(dir = "") {
  try {
    const r = await fetch("/__desktop/release/masters", TPA.json("POST", { dir }));
    const d = await r.json().catch(() => ({}));
    if (r.ok) mstate.data.release = null;      // 配布の画面は次に開いたとき読み直す
    return r.ok ? { ok: true, masters: d.masters } : { ok: false, why: d.error || (r.status === 404 ? "デスクトップ版の窓の中でだけ書けます" : `答え ${r.status}`) };
  } catch (e) { return { ok: false, why: e.message }; }
}
const cmpVer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function paintReleaseProgress() {
  const root = $("#dzProgress"), b = mstate.releaseBusy;
  if (!root || !b) return;
  const p = b.p || {}, stage = p.state === "running" ? p.stage || "check" : "send";
  const pct = stage === "copy" && p.total ? (p.done / p.total) * 100 : stage === "finish" ? 100 : null;
  root.querySelector(".dz-ptitle").textContent = RELEASE_STAGE[stage];
  root.querySelector(".dz-bar").classList.toggle("is-indet", pct === null);
  root.querySelector(".dz-bar i").style.width = pct === null ? "" : `${pct.toFixed(0)}%`;
  root.querySelector(".dz-pmeta").textContent = `${b.name}（${MB(b.size)}）`
    + (stage === "copy" && p.total ? `・${MB(p.done)} / ${MB(p.total)}` : "") + (p.elapsed != null ? `・経過 ${Math.round(p.elapsed)} 秒` : "");
}
async function placeRelease(file) {
  if (!file || mstate.releaseBusy) return;
  mstate.releaseBusy = { name: file.name, size: file.size, p: {} };
  paintRelease(mstate.data.release, "fresh");
  const poll = setInterval(async () => {
    try { mstate.releaseBusy.p = await (await fetch("/__desktop/release/progress", { cache: "no-store" })).json(); paintReleaseProgress(); } catch (_) { /* 次の問い合わせで */ }
  }, 400);
  let msg;
  try {
    // 本文は読み終えたバイト列で送る（ファイルのまま渡すと、WebView によっては本文を読む所で落ちる: Linux の WebKitGTK で確かめた）
    const body = await file.arrayBuffer();
    const r = await fetch("/__desktop/release/place?name=" + encodeURIComponent(file.name), { method: "POST", headers: { "Content-Type": "application/zip" }, body });
    const j = await r.json().catch(() => ({ error: `置けませんでした（${r.status}）` }));
    if (!r.ok) throw new Error(j.error || `置けませんでした（${r.status}）`);
    msg = ["ok", `✓ 版 ${j.version} を置きました（${MB(j.bytes)}）。試してから、一覧の「この版を配る」を押してください。`];
  } catch (e) {
    msg = ["ng", "✕ " + e.message];
  } finally {
    clearInterval(poll);
    mstate.releaseBusy = null;
  }
  await renderRelease({ fresh: true });
  releaseNotice(...msg);
}
/* 配る版を決める・戻す。確かめない（版 3.19.0）: 前の版へ戻すのも、同じ一覧で選び直すだけ */
async function distributeRelease(version, d) {
  const cur = d.distributed && d.distributed.version, back = cur && cmpVer(version, cur) < 0;
  // 配るのは置き場の ZIP の指紋を確かめ、配る入口（exe）を取り出して置く（BOX では数十秒）。書き換えるので裏へは回さない
  const w = TPA.waiting({ title: `版 ${version} を${back ? "配る版に戻しています" : "配っています"}`, subject: version, from: d.found || "",
    now: "置き場の ZIP の指紋を確かめ、配る入口（exe）を置いています…",
    note: "置き場（BOX・共有）へ書くので、数秒〜数十秒かかります。終わるまでこの画面はそのままにしてください。" });
  const r = await masterRequest("/__desktop/release/distribute", TPA.json("POST", { version }));
  w.done();
  await renderRelease({ fresh: true });
  if (!r.ok) { releaseNotice("ng", "✕ " + (r.data.error || "配る版を決められませんでした。")); return; }
  releaseNotice((r.data.notes || []).length ? "ng" : "ok", `✓ 配る版を ${r.data.version} にしました${cur ? `（前は ${cur}）` : ""}。`
    + "全員の PC が次に確かめたとき（起動・30 分ごと）に取り込み、開き直したときにそろいます。"
    + (cur ? `戻すときは、一覧の ${cur} の「この版に戻す」を押すだけです。` : "") + (r.data.notes || []).map((n) => `\n${n}`).join(""));
}
/* 推奨アップデートの札（版 3.35.0）。配っている版にだけ付け、理由を 1 行添える（各 PC の知らせに出る）。
   札は配る版の覚え（distribute.json）に書き、配る版を変えると外れる（新しい版は、改めて推奨にするかを決める） */
const REC_NOTE_MAX = 120;
function askRecommend(cell, version) {
  cell.innerHTML = `<span class="dz-rec-ask"><input type="text" class="ps-input" maxlength="${REC_NOTE_MAX}" placeholder="理由（各 PC の知らせに出ます。例: 〇〇の不具合を直しました）">
    <button type="button" class="pz-btn dz-go" data-rec-put>推奨にする</button><button type="button" class="pz-btn" data-rec-cancel>やめる</button></span>`;
  const input = cell.querySelector("input"), put = () => setRecommended(version, true, input.value);
  input.focus();
  input.onkeydown = (e) => { if (e.key === "Enter") put(); else if (e.key === "Escape") renderRelease(); };
  cell.querySelector("[data-rec-put]").onclick = put;
  cell.querySelector("[data-rec-cancel]").onclick = () => renderRelease();
}
async function setRecommended(version, on, note) {
  const r = await masterRequest("/__desktop/release/recommend", TPA.json("POST", { version, on, note }));
  await renderRelease({ fresh: true });
  if (!r.ok) { releaseNotice("ng", "✕ " + (r.data.error || "推奨の札を変えられませんでした。")); return; }
  releaseNotice("ok", on ? `✓ ${version} を推奨アップデートにしました。まだこの版でない PC に、次に確かめたとき（起動・30 分ごと）から控えめな知らせが出ます。`
    : `✓ ${version} の推奨の札を外しました（配る版はそのままです）。`);
}
/* 版を消す。確かめの窓は出さず、その場の 2 回押しで確かめる（1 回目でボタンが「もう一度押すと消す」に変わり、4 秒で戻る）。
   消している間は、その行を打ち消し線と「消しています…」にする（待ちの窓で表を隠さない・2026-10-release-remove の K4）。
   消した版は GitHub Releases の ZIP からもう一度置ける。配っている版にはボタンを出さない（窓も断る） */
const REMOVE_ARM_MS = 4000;
function armRemove(btn) {
  if (btn.classList.contains("is-armed")) { removeRelease(btn); return; }
  btn.classList.add("is-armed");
  btn.textContent = "もう一度押すと消す";
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove("is-armed"); btn.textContent = "消す"; } }, REMOVE_ARM_MS);
}
async function removeRelease(btn) {
  const version = btn.dataset.remove, row = btn.closest("tr");
  row.classList.add("is-removing");
  btn.closest("td").innerHTML = '<span class="dz-removing"><i class="wait-spin" aria-hidden="true"></i>消しています…</span>';
  const r = await masterRequest("/__desktop/release/remove", TPA.json("POST", { version }));
  await renderRelease({ fresh: true });
  if (!r.ok) { releaseNotice("ng", "✕ " + (r.data.error || "版を消せませんでした。")); return; }
  releaseNotice((r.data.notes || []).length ? "ng" : "ok", `✓ 版 ${version} を置き場から消しました。もう一度使うときは、GitHub Releases の ZIP から置き直せます。`
    + (r.data.notes || []).map((n) => `\n${n}`).join(""));
}
function releaseNotice(cls, text) {
  const put = document.querySelector("#masterSettings .dz-put");
  if (put) put.insertAdjacentHTML("beforeend", `<div class="ps-result ${cls}" style="white-space:pre-line">${escapeHtml(text)}</div>`);
}

/* 意味のある札（色は cls）。title は乗せたときの説明（任意） */
function chip(t, cls, title = "") { return `<span class="m-chip ${cls}"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(t)}</span>`; }
async function presenceAct(kind, key, btn) {
  const url = { cut: "/api/presence/disconnect", allow: "/api/presence/allow", forget: "/api/presence/forget" }[kind];
  let body = { key };
  if (kind === "cut") {
    // 切断は理由を添えて確かめる（その場の欄。相手の画面の帯に出る）
    const cell = btn.closest("td");
    clearInterval(mstate.presenceTimer);
    cell.innerHTML = `<input class="pz-reason" placeholder="理由（相手の画面に出ます）" maxlength="200">
      <button class="pz-btn danger" data-go="1">切断する</button><button class="pz-btn" data-no="1">やめる</button>`;
    cell.querySelector(".pz-reason").focus();
    cell.querySelector("[data-no]").onclick = () => renderPresence();
    cell.querySelector("[data-go]").onclick = async () => {
      body.reason = cell.querySelector(".pz-reason").value;
      const r = await masterRequest(url, TPA.json("POST", body));
      if (!r.ok) fail(r.data.error || "切断できませんでした。");
      renderPresence();
    };
    return;
  }
  const r = await masterRequest(url, TPA.json("POST", body));
  if (!r.ok) fail(r.data.error || "できませんでした。");
  renderPresence();
}

/* 値の見せ方: 意味のある札にして、読まずに見分けられるようにする（未設定は目立たせ、「なし」は淡く）。 */
const REWIND = { "上": ["上巻き", "c-up"], "下": ["下巻き", "c-down"] };
const LINE = { "←": ["← 左へ", "c-line"], "→": ["右へ →", "c-line"] };
function cellHtml(c, raw) {
  const v = String(raw ?? "").trim();
  const none = (t = "—") => `<span class="m-none">${t}</span>`;
  const unset = '<span class="m-unset" title="まだ決めていません">未設定</span>';
  switch (c.kind) {
    case "name": return `<b class="m-name">${escapeHtml(v)}</b>`;
    case "rewind": return REWIND[v] ? chip(...REWIND[v]) : v === "-" ? none("なし") : unset;
    case "line": return LINE[v] ? chip(...LINE[v]) : v === "-" ? none("なし") : unset;
    case "meter": return v === "有" ? chip("◉ 有", "c-meter") : none();
    case "aliases": return v ? v.split(/[,、，]/).map((x) => x.trim()).filter(Boolean).map((x) => `<code class="m-code">${escapeHtml(x)}</code>`).join(" ") : none();
    case "chip": return v && v !== "ー" && v !== "-" ? chip(v, "c-plain") : none();
    case "ident": return v ? `<span class="m-ident">${escapeHtml(v)}</span>` : none(c.anyText || "—");
    case "role": return chip(v || "一般ユーザー", `c-${TPA.roleKey(v)}`);
    case "medit": return chip(v || "編集可", { "非表示": "c-off", "閲覧のみ": "c-view", "部分的編集可": "c-part" }[v || ""] || "c-full");
    case "enabled": return v === "無" ? chip("無効", "c-off") : chip("有効", "c-meter");
    default: return v ? escapeHtml(v) : none();
  }
}
TPA.onText($("#masterSearch"), (el) => { mstate.search = el.value; renderMasterTable(); });
$("#masterBtn").onclick = openMaster;
$("#masterCloseBtn").onclick = closeMaster;
TPA.layer($("#masterOverlay"), closeMaster);
$("#masterAddBtn").onclick = () => { if (!leaveOk()) return; mstate.prevSel = mstate.selId; openForm(mstate.tab, null); };

/* ---------------- 追加・編集フォーム ---------------- */
/* 右の詳細に行（row）を出す。row が無ければ追加の空の欄。focus: 最初の欄へ移るか（行を押しただけなら移らない） */
function openForm(tab, row, { focus = true } = {}) {
  const def = MASTER_DEFS[tab];
  mstate.editing = { tab, id: row ? row.id : null, baseRev: row ? (row.rev ?? null) : null };
  mstate.selId = row ? row.id : null;
  hideFormNotice();
  const name = row ? row[def.idField] || row[def.listColumns[0].key] || "" : "";
  $("#masterFormTitle").textContent = row ? `「${name}」を直す` : `${def.label}に追加`;
  $("#masterFormError").classList.add("hidden");
  $("#masterFormBody").innerHTML = def.formFields.map((f) => {
    const val = row ? escapeHtml(row[f.key]) : "";
    const req = f.required ? '<span class="req">*必須</span>' : "";
    let input;
    if (f.type === "select") {
      const opts = typeof f.options === "function" ? f.options(row) : f.options;
      input = `<select data-field="${f.key}">` + opts.map((o) =>
        `<option value="${escapeHtml(o)}"${(row ? (row[f.key] || "") : "") === o ? " selected" : ""}>${o ? escapeHtml(o) : "(空欄)"}</option>`).join("") + "</select>";
    } else if (f.type === "textarea") {
      input = `<textarea data-field="${f.key}" placeholder="${escapeHtml(f.placeholder || "")}">${val}</textarea>`;
    } else {
      input = `<input type="text" data-field="${f.key}" value="${val}" placeholder="${escapeHtml(f.placeholder || "")}">`;
    }
    const hint = f.hint ? `<small class="f-hint">${escapeHtml(f.hint)}</small>` : "";
    return `<div class="f-field${f.full ? " full" : ""}"><label>${f.label}${req}</label>${input}${hint}</div>`;
  }).join("");
  // 書けないときは見るだけ（欄は止め、保存・削除は出さない）
  const ro = !canWrite(tab);
  $("#masterFormBody").querySelectorAll("input,select,textarea").forEach((el) => { el.disabled = ro; });
  if (ro && row) $("#masterFormTitle").textContent = `「${name}」（閲覧のみ）`;
  showDetail(true);
  mstate.editing.orig = JSON.stringify(formValues());   // 直したかどうか（formDirty）の物差し
  paintDetailButtons();
  markSelected();
  if (focus) $("#masterFormBody").querySelector("input,select,textarea")?.focus();
}
/** 右の詳細の欄と、空のときの案内を切り替える */
function showDetail(on) {
  ["#masterFormBody", "#masterFormFoot"].forEach((sel) => $(sel).classList.toggle("hidden", !on));
  $("#masterFormTitle").parentElement.classList.toggle("hidden", !on);
  $("#masterDetailEmpty").classList.toggle("hidden", on);
}
function showDetailEmpty() { mstate.editing = null; hideFormNotice(); showDetail(false); markSelected(); }
/** 保存・削除・元に戻すを、いまの状態（書けるか・届くか・直したか）に合わせる */
function paintDetailButtons() {
  const ed = mstate.editing; if (!ed) return;
  const ro = !canWrite(ed.tab), down = shareDown(), dirty = formDirty();
  const why = down ? "共有フォルダに届かないため、いまは保存できません" : "";
  $("#masterFormSaveBtn").classList.toggle("hidden", ro);
  $("#masterFormSaveBtn").disabled = down;
  $("#masterFormSaveBtn").title = why;
  $("#masterFormDelBtn").classList.toggle("hidden", ro || ed.id == null);
  $("#masterFormDelBtn").disabled = down;
  $("#masterFormCancelBtn").classList.toggle("hidden", ro || (!dirty && ed.id != null));   // 直していない行では出さない（押しても何も起きない）
  $("#masterFormCancelBtn").textContent = ed.id == null ? "やめる" : "元に戻す";
}
/** 右の詳細を直したか（保存していない変更があるか） */
function formDirty() {
  const ed = mstate.editing;
  return !!ed && !!ed.orig && JSON.stringify(formValues()) !== ed.orig;
}
/** 直している途中なら、捨ててよいかを聞く（行・タブを移る・閉じる前） */
function leaveOk() {
  if (!formDirty()) return true;
  if (!confirm("右の詳細に保存していない変更があります。捨てて移りますか？")) return false;
  mstate.editing = null;
  return true;
}
function showFormNotice(kind, html) { const n = $("#masterFormNotice"); n.className = "master-notice " + kind; n.innerHTML = html; }
function hideFormNotice() { const n = $("#masterFormNotice"); n.className = "master-notice hidden"; n.innerHTML = ""; }
function formValues() {
  const data = {};
  $("#masterFormBody").querySelectorAll("[data-field]").forEach((el) => { data[el.dataset.field] = el.value; });
  return data;
}
function setFormValues(row) {
  $("#masterFormBody").querySelectorAll("[data-field]").forEach((el) => { el.value = row[el.dataset.field] ?? ""; });
}
/* 開いたあとに、同じ行がほかの PC で変わった／消えた。相手と自分の値を並べ、次の手を選んでもらう。 */
function showConflict(def, mine, current, message) {
  if (!current) {
    showFormNotice("conflict", `<b>${escapeHtml(message)}</b><br>入力した内容は、新しい行として追加し直せます。
      <div class="acts"><button type="button" class="primary" id="cfAddNew">新しい行として追加し直す</button>
      <button type="button" id="cfClose">閉じて一覧を読み直す</button></div>`);
    $("#cfAddNew").onclick = () => { mstate.editing.id = null; mstate.editing.baseRev = null; hideFormNotice();
      $("#masterFormTitle").textContent = `${def.label}に追加`; paintDetailButtons(); };
    $("#cfClose").onclick = () => { const t = mstate.editing.tab; mstate.editing = null; mstate.selId = null; reloadTab(t); };
    return;
  }
  const diff = def.formFields.filter((f) => String(current[f.key] ?? "") !== String(mine[f.key] ?? ""));
  const rows = diff.map((f) => `<tr><th>${escapeHtml(f.label)}</th><td class="theirs">${escapeHtml(current[f.key] || "（空欄）")}</td>
    <td>${escapeHtml(mine[f.key] || "（空欄）")}</td></tr>`).join("");
  showFormNotice("conflict", `<b>${escapeHtml(message)}</b>
    ${diff.length ? `<table><thead><tr><th>項目</th><th>相手の内容（いま保存されている）</th><th>あなたの入力</th></tr></thead><tbody>${rows}</tbody></table>`
      : "<br>内容は同じです。そのまま保存できます。"}
    <div class="acts"><button type="button" id="cfTheirs">相手の内容を読み込む（入力は捨てる）</button>
    <button type="button" class="primary" id="cfMine">自分の内容で上書きする</button></div>`);
  $("#cfTheirs").onclick = () => { setFormValues(current); mstate.editing.baseRev = current.rev; hideFormNotice(); };
  $("#cfMine").onclick = () => { mstate.editing.baseRev = current.rev; hideFormNotice(); $("#masterFormSaveBtn").click(); };
}
// 元に戻す: 保存してある内容を出し直す（追加の途中なら、やめて前に選んでいた行へ）
$("#masterFormCancelBtn").onclick = () => { const ed = mstate.editing; mstate.editing = null; if (ed && ed.id == null) mstate.selId = mstate.prevSel ?? null; renderMasterTable(); };
$("#masterFormDelBtn").onclick = () => { const ed = mstate.editing; const row = ed && (mstate.data[ed.tab] || []).find((r) => r.id === ed.id); if (row) openDeleteConfirm(ed.tab, row); };
$("#masterFormBody").addEventListener("input", paintDetailButtons);
$("#masterFormBody").addEventListener("change", paintDetailButtons);
$("#masterFormBody").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); $("#masterFormSaveBtn").click(); } });   // Ctrl+Enter で保存

$("#masterFormSaveBtn").onclick = async () => {
  const editing = mstate.editing;
  const { tab } = editing;
  const def = MASTER_DEFS[tab];
  const data = formValues();
  const err = $("#masterFormError");
  err.classList.add("hidden");

  const missing = def.formFields.find((f) => f.required && !String(data[f.key] || "").trim());
  if (missing) {
    err.textContent = `${missing.label} は必須です。`;
    err.classList.remove("hidden");
    return;
  }

  $("#masterFormSaveBtn").disabled = true;
  try {
    const id = editing.id;
    const url = id ? `${def.api}/${id}` : def.api;
    const body = id ? { ...data, base_rev: editing.baseRev } : data;
    const res = await withLockWait(
      () => masterRequest(url, TPA.json(id ? "PUT" : "POST", body)),
      (d) => showFormNotice("wait", lockWaitText(d, "保存", boldName)));
    if (res.status === 409 && res.data.kind === "conflict") { showConflict(def, data, res.data.current, res.data.error); return; }
    if (!res.ok) throw new Error(res.data.error || "保存に失敗しました。");
    hideFormNotice();
    mstate.editing = null;
    if (!id && res.data && res.data.id != null) mstate.selId = res.data.id;
    await reloadTab(tab);
    afterMasterChange();
  } catch (e) {
    hideFormNotice();
    err.textContent = e.message;
    err.classList.remove("hidden");
  } finally {
    $("#masterFormSaveBtn").disabled = false;
  }
};

/* ---------------- 削除確認 ---------------- */
function openDeleteConfirm(tab, row) {
  const def = MASTER_DEFS[tab];
  mstate.deleteTarget = { tab, id: row.id, rev: row.rev ?? null };
  $("#masterDeleteMsg").textContent = `${def.label}「${row[def.idField] || row.id}」を削除します。この操作は取り消せません。よろしいですか？`;
  $("#masterDeleteOverlay").classList.remove("hidden");
}
function closeDeleteConfirm() { $("#masterDeleteOverlay").classList.add("hidden"); mstate.deleteTarget = null; }
$("#masterDeleteCancelBtn").onclick = closeDeleteConfirm;
TPA.layer($("#masterDeleteOverlay"), closeDeleteConfirm);
$("#masterDeleteConfirmBtn").onclick = async () => {
  const { tab, id, rev } = mstate.deleteTarget;
  const def = MASTER_DEFS[tab];
  const msg = $("#masterDeleteMsg");
  $("#masterDeleteConfirmBtn").disabled = true;
  try {
    const res = await withLockWait(
      () => masterRequest(`${def.api}/${id}${rev != null ? `?rev=${rev}` : ""}`, { method: "DELETE" }),
      (d) => { msg.textContent = lockWaitText(d, "削除"); });
    if (res.status === 409 && res.data.kind === "conflict") {
      // 開いたあとに変わった行は消さない。最新を見てから、もう一度選んでもらう
      closeDeleteConfirm();
      await reloadTab(tab);
      fail(`${res.data.error} 削除はしていません。一覧の最新の内容を確かめてから、もう一度削除してください。`);
      return;
    }
    if (!res.ok) throw new Error(res.data.error || "削除に失敗しました。");
    closeDeleteConfirm();
    if (mstate.selId === id) { mstate.selId = null; mstate.editing = null; }
    await reloadTab(tab);
    afterMasterChange();
  } catch (e) {
    fail(e.message);
    closeDeleteConfirm();
  } finally {
    $("#masterDeleteConfirmBtn").disabled = false;
  }
};

/* ---------------- 解析画面への反映（解析画面が計算し直す） ---------------- */
function afterMasterChange() { emit("tpa:masters-changed"); }

// データ元のタブ（master-sources.js。版 3.36.0）に部品を渡して登録する
if (window.MasterSources) window.MasterSources({ $, escapeHtml, emit, MASTER_DEFS, mstate, masterRequest, withLockWait, lockWaitText, boldName,
  canWrite, readOnlyWhy, shareDown, chip, goTab, ensureTabLoaded });
})();
