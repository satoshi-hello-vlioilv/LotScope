/* マスタ管理の「変換表」（版 3.42.0。前の版の conversions・前の版の conversions。決め方: ui-proposals/2026-10-conv*）。
   コードの読み替え（地取区分 0 → 0:一般 など）と、いくつかの列から区分を決める判定表（形状区分・管理分類・課名）を、
   左に表の一覧・右に判定表（入力ごとの列 × 行。セルは「＝ NFCE・NSCR」「T で始まらない」「≦ 30」の札）で見せ、その場で直す。
   - セルを押すと、そのセルの条件（並びの中は「または」）を直す欄が開く。出す値は行の右の欄（= で始まれば式。[入力の名前] で入力を読む）
   - 「試す」に入力の値を入れると、保存する前の表で答えと当たった行が出る（list-formula.js の convWith。一覧と同じ計算）
   - 保存するとマスタ（全員で 1 つ）に書き、この PC の一覧の式（conv）にすぐ効く（Conversions.take）
   master.js の部品は、master.js が読み終えたときに渡す（master-sources.js と同じ）。 */
window.MasterConv = (M) => {
"use strict";
const { $, escapeHtml: esc, emit, MASTER_DEFS, mstate, masterRequest, withLockWait, lockWaitText, boldName, readOnlyWhy, shareDown, canWrite } = M;
/* ナビは定義の順に見出しを作るので、「データ」の設備グループの後ろへ差し込む */
(() => {
  const keys = Object.keys(MASTER_DEFS), at = keys.indexOf("egroups") + 1, rest = keys.slice(at).map((k) => [k, MASTER_DEFS[k]]);
  rest.forEach(([k]) => delete MASTER_DEFS[k]);
  MASTER_DEFS.conv = { name: "conversions", label: "変換表", group: "データ", api: "/api/masters/conversions", custom: true, render: () => render() };
  rest.forEach(([k, v]) => { MASTER_DEFS[k] = v; });
})();
mstate.data.conv = null;
let draft = null, cell = null, tryVals = [], notice = null;     // 直している表・開いているセル {r, k}・試す値・知らせ [cls, html]
let incoming = null;                                              // 取り込む前に見せている表の並び（取り込む・やめるまで）
let hist = null;                                                  // 履歴の並び（GET /history。版 3.125.0）。読めなければ {canBackup: false}
let hw = null;                                                    // 開いている「履歴と戻す」の窓の状態
let savedAt = null;                                               // 最後に保存した表と時刻 {id, at}（表の頭の「✓ この表だけ保存 時刻」）

const IO_KIND = "tpa-conversions";                             // 書き出すファイルの種類（TPA.saveJson・pickJson）
const OP_ORDER = ["eq", "ne", "starts", "nstarts", "ends", "nends", "contains", "ncontains", "range", "empty", "filled"];
const OP_NAME = { eq: "と同じ", ne: "と違う", starts: "で始まる", nstarts: "で始まらない", ends: "で終わる", nends: "で終わらない",
  contains: "を含む", ncontains: "を含まない", range: "の範囲", empty: "空欄", filled: "空欄でない" };
const clone = (x) => JSON.parse(JSON.stringify(x));
const splitVals = (s) => String(s).split(/[,、，・]/).map((x) => x.trim()).filter((x, i, a) => x !== "" || a.length === 1);
/** 条件 1 つ → 札の字（＝ NFCE・NSCR／T で始まらない／≦ 30／8 〜 10） */
function testText(t) {
  const v = (t.v || []).map((x) => (x === "" ? "（空）" : x)).join("・");
  switch (t.op) {
    case "eq": return `＝ ${v}`;
    case "ne": return `≠ ${v}`;
    case "starts": return `${v} で始まる`;
    case "nstarts": return `${v} で始まらない`;
    case "ends": return `${v} で終わる`;
    case "nends": return `${v} で終わらない`;
    case "contains": return `${v} を含む`;
    case "ncontains": return `${v} を含まない`;
    case "empty": return "空欄";
    case "filled": return "空欄でない";
    case "range": {
      const lo = t.min != null && t.min !== "", hi = t.max != null && t.max !== "";
      if (lo && hi) return `${t.min}${t.minInc === false ? " ＜" : ""} 〜 ${t.maxInc === false ? "＜ " : ""}${t.max}`;
      if (lo) return `${t.minInc === false ? "＞" : "≧"} ${t.min}`;
      return `${t.maxInc === false ? "＜" : "≦"} ${t.max}`;
    }
  }
  return "?";
}
const outText = (o) => (o === "" ? "（空欄）" : String(o));
const isKeep = (x) => x.other === `=[${(x.inputs[0] || {}).name}]`;
const otherKind = (x) => (isKeep(x) ? "keep" : x.other === "" ? "blank" : String(x.other).startsWith("=") ? "formula" : "text");
function blank() {
  return { id: null, name: "", inputs: [{ name: "入力", type: "text", columns: [] }], rows: [{ when: {}, out: "" }], other: "=[入力]", apply: { mode: "replace" } };
}
const can = () => { const d = mstate.data.conv; return !!(d && d.canEdit) && !shareDown() && canWrite("conv"); };
const dis = () => (can() ? "" : ` disabled title="${esc(shareDown() ? "共有フォルダに届かないため、いまは保存できません" : readOnlyWhy("conv") + "のため変えられません")}"`);

/* 保存していない変更の見張り（版 3.43.0）: 下書きと、保存した表（新しい表なら空の表）を比べる。欄の値を下書きへ写してから比べる */
// 値を入れていない条件（セルを開いただけの「＝ 」）は比べない（保存するときも外す: cleanCell）
const filled = (t) => (!Array.isArray(t.v) || t.v.some((v) => v !== "")) && (t.op !== "range" || String(t.min ?? "") !== "" || String(t.max ?? "") !== "");
const rowsOf = (rows) => rows.map((r) => ({ out: r.out, when: Object.fromEntries(Object.entries(r.when || {}).map(([k, ts]) => [k, ts.filter(filled)]).filter(([, ts]) => ts.length)) }));
const shape = (x) => TPA.unsaved.key({ name: x.name, inputs: x.inputs, rows: rowsOf(x.rows), other: x.other, apply: x.apply });
function dirty() {
  if (mstate.tab !== "conv" || !draft || !mstate.data.conv || !$("#masterSettings .cv-editor")) return false;
  sync();
  const saved = draft.id ? mstate.data.conv.items.find((y) => y.id === draft.id) : blank();
  return !!saved && shape(draft) !== shape(saved);
}
TPA.unsaved.watch("master:conv", { scope: "master", dirty, label: () => `変換表「${(draft && draft.name) || "新しい表"}」`,
  discard: () => { draft = null; cell = null; }, save: async () => { await save(); return !dirty(); } });
async function load() {
  const r = await masterRequest("/api/masters/conversions", { cache: "no-store" });
  if (!r.ok) throw new Error(r.data.error || "変換表を読めませんでした");
  mstate.data.conv = r.data;
  window.Conversions?.take(r.data);          // この PC の一覧の式（conv）に、読んだ表を渡す
  return r.data;
}
/** 履歴の並び（全部の表）を読む。開発者・メンテナンス者でなければ canBackup が偽（履歴の部品を出さない） */
async function loadHist() {
  try {
    const r = await fetch("/api/masters/conversions/history", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    hist = r.ok ? d : { canBackup: false, state: [] };
  } catch { hist = { canBackup: false, state: [] }; }
  return hist;
}
const canBackup = () => !!(hist && hist.canBackup) && !shareDown();
async function render({ keep = false } = {}) {
  const box = $("#masterSettings");
  if (!keep) loadCols(true).then(() => { if (mstate.tab === "conv") paintColBtns(); });   // 列の印（どのデータにあるか）は読めたら出す
  if (!keep || !mstate.data.conv) {
    if (!mstate.data.conv) box.innerHTML = '<p class="ps-loading">変換表を読んでいます…</p>';
    try { await load(); } catch (e) { if (mstate.tab === "conv") box.innerHTML = `<p class="ps-loading">${esc(e.message)}</p>`; return; }
    if (mstate.tab !== "conv") return;
    const d = mstate.data.conv, sel = draft && draft.id;
    const now = d.items.find((x) => x.id === sel) || (draft && !draft.id ? null : d.items.find((x) => x.name === "管理分類") || d.items[0]);
    if (!keep) { draft = now ? clone(now) : blank(); cell = null; tryVals = []; }
  }
  paint();
  if (!keep) loadHist().then(() => { if (mstate.tab === "conv" && $("#masterSettings .cv-editor")) keepView(paint); });
}

/* ---------------- 描く ---------------- */
function listHtml(d) {
  const groups = [["replace", "コードの読み替え（列の値を作り替える）"], ["add", "判定して列を足す"]];
  return groups.map(([m, title]) => {
    const xs = d.items.filter((x) => ((x.apply || {}).mode === "replace" ? "replace" : "add") === m);
    if (!xs.length) return "";
    return `<div class="cv-lgrp">${title}</div>` + xs.map((x) => `<button type="button" class="sh-item${draft && x.id === draft.id ? " is-on" : ""}" data-cv-pick="${x.id}">`
      + `<b>${esc(x.name)}</b>${stateChip(x.name)}<small>${esc(window.Conversions ? window.Conversions.summary(x) : "")}</small></button>`).join("");
  }).join("") + (can() ? '<button type="button" class="sh-new" data-cv-new>＋ 変換表を足す</button>' : "");
}
/** 時刻の字（2026-11-26T10:42:00 → 11/26 10:42） */
const shortAt = (at) => { const m = String(at || "").match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? `${+m[1]}/${+m[2]} ${m[3]}:${m[4]}` : ""; };
/** 一覧の札（版 3.125.0。決め方: 2026-11-convbackup の D から持ち越し）: 同梱のプリセットと違えば「直した · 最後の保存」、同じなら「同梱のまま」 */
function stateChip(name) {
  const s = ((hist && hist.state) || []).find((x) => x.name === name);
  if (!s) return "";
  return s.edited ? `<span class="cv-stchip is-mine" title="同梱のプリセットと違います（最後の保存 ${esc(s.at || "")}）">${s.bundled ? "直した" : "足した表"}${shortAt(s.at) ? ` · ${shortAt(s.at)}` : ""}</span>`
    : '<span class="cv-stchip" title="同梱のプリセットと同じ中身です">同梱のまま</span>';
}
/* 一覧の頭の下（版 3.125.0。前は一覧の下で、1728 でも送った先・「同梱に戻す」の小さなリンクが「今の表を標準に」の隣にあった）:
   状態（標準・最後のバックアップ）と「⟲ 履歴と戻す…」（開発者・メンテナンス者だけ）、従のボタン 書き出す・取り込む。標準・同梱の操作は履歴と戻すの窓の中 */
function ioHtml(d) {
  const w = can(), b = canBackup();
  const last = b ? (hist.points || []).find((p) => !p.auto) : null;
  return `<div class="cv-io"><div class="cv-iostate">標準: <b>${d.customDefaults ? "自分で決めた表" : "同梱のプリセット"}</b>`
    + (b ? `<br>最後のバックアップ: <b>${last ? `<span class="cvh-nb">${esc(shortAt(last.at))}</span><span class="cvh-nb">（${last.scope === "all" ? "全体" : `${(last.scope || []).length} 表`}）</span>` : "まだありません"}</b>` : "") + "</div>"
    + (b ? '<button type="button" class="pv-btn cv-histbtn" data-cvb-hist title="変換表を書く前の形・手で取ったバックアップ・同梱のプリセットを選び、戻すと何が変わるかを見てから戻します">⟲ 履歴と戻す…</button>' : "")
    + `<div class="cv-iorow"><button type="button" class="pv-btn" data-cv-export title="今の変換表をすべて、1 つのファイル（JSON）に書き出します">↓ 書き出す</button>`
    + (w ? '<button type="button" class="pv-btn" data-cv-import title="書き出したファイルを読み、同じ名前の表は置き換え、無い名前は足します（読む前に表ごとの違いを見せます）">↑ 取り込む…</button>' : "") + "</div></div>";
}
function gridHtml(x) {
  const d = dis();
  // 出す値は番号の次（いちばん大事な列を、表が横に長くても切らない。2026-10-conv の 2 回目）
  const head = `<tr><th class="cv-no"></th><th>出す値</th>${x.inputs.map((inp) => `<th>${esc(inp.name)}${inp.type === "num" ? ' <small class="cv-thnum">数</small>' : ""}</th>`).join("")}<th class="cv-ra"></th></tr>`;
  // 出す値は 1 行の字の欄（textarea。版 3.124.0）: 表が窓より広いときは欄の幅を詰め、長い値は欄の中で折り返す（fitGrid。前の input は切れた）
  const outTd = (r, i) => `<td class="cv-out"><textarea class="ps-input" rows="1" data-cv-out="${i}" placeholder="（空欄）" title="${esc(r.out)}" aria-label="${i + 1} 行目の出す値"${d}>${esc(r.out)}</textarea></td>`;
  const rows = x.rows.map((r, i) => `<tr data-r="${i}"${cell && cell.r === i ? ' class="is-cell"' : ""}><td class="cv-no">${i + 1}</td>${outTd(r, i)}`
    + x.inputs.map((inp) => {
      const ts = (r.when || {})[inp.name] || [], on = cell && cell.r === i && cell.k === inp.name;
      return `<td class="cv-cond${on ? " is-on" : ""}"><button type="button" class="cv-cbtn" data-cv-cell="${i}|${esc(inp.name)}" title="押すと、この条件を直します（並べた条件は「または」）"${d}>`
        + chipsHtml(ts) + "</button></td>";
    }).join("")
    + `<td class="cv-ra"><button type="button" class="icon-btn" data-cv-up="${i}" title="上へ" aria-label="${i + 1} 行目を上へ"${d}>↑</button>`
    + `<button type="button" class="icon-btn" data-cv-down="${i}" title="下へ" aria-label="${i + 1} 行目を下へ"${d}>↓</button>`
    + `<button type="button" class="icon-btn" data-cv-rdel="${i}" title="この行を消す" aria-label="${i + 1} 行目を消す"${d}>×</button>`
    + `<button type="button" class="icon-btn cv-rmenu" data-cv-rmenu="${i}" title="この行を動かす・消す（上へ・下へ・消す）" aria-label="${i + 1} 行目の操作" aria-haspopup="menu"${d}>⋯</button></td></tr>`
    + (cell && cell.r === i ? `<tr class="cv-edrow"><td></td><td colspan="${x.inputs.length + 2}">${cellEditor(x, i, cell.k)}</td></tr>` : "")).join("");
  const cols = `<colgroup>${"<col>".repeat(x.inputs.length + 3)}</colgroup>`;
  return `<div class="cv-gridwrap"><table class="cv-grid">${cols}<thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
/** セルの札（並べた条件は「または」。条件が無ければ不問の –） */
function chipsHtml(ts) {
  return ts.length ? ts.map((t, k) => (k ? '<small class="cv-or">または</small>' : "") + `<span class="cv-c" title="${esc(testText(t))}">${testUnits(t)}</span>`).join("") : '<span class="cv-any" title="不問（この入力は見ません）">–</span>';
}
/** 札の字を、語の途中で折らない塊（値ごと・比べ方の言葉・範囲の両端）に分ける（版 3.124.0。狭い列で「T で始ま／らない」「＝／HOT」と折れていた）。
    塊の中は折らず、塊の間（値の「・」の後・比べ方の言葉の前）でだけ折る。字は testText と同じ */
function testUnits(t) {
  const u = (x) => `<span class="cv-cw">${esc(x)}</span>`, vs = (t.v || []).map((x) => (x === "" ? "（空）" : x));
  const vals = (pre = "") => vs.map((v, i) => u(`${i ? "" : pre}${v}${i < vs.length - 1 ? "・" : ""}`)).join("<wbr>");
  const after = (word) => `${vals()}<wbr>${u(` ${word}`)}`;
  switch (t.op) {
    case "eq": return vals("＝ ");
    case "ne": return vals("≠ ");
    case "starts": return after("で始まる");
    case "nstarts": return after("で始まらない");
    case "ends": return after("で終わる");
    case "nends": return after("で終わらない");
    case "contains": return after("を含む");
    case "ncontains": return after("を含まない");
    case "range": {   // 「30 ＜ 〜 75」は 〜 の前でだけ折る
      const lo = t.min != null && t.min !== "", hi = t.max != null && t.max !== "";
      if (lo && hi) return `${u(`${t.min}${t.minInc === false ? " ＜" : ""}`)}<wbr>${u(` 〜 ${t.maxInc === false ? "＜ " : ""}${t.max}`)}`;
      return u(testText(t));
    }
  }
  return u(testText(t));
}
function cellEditor(x, i, k) {
  const ts = (x.rows[i].when || {})[k] || [], inp = x.inputs.find((a) => a.name === k) || {};
  const opSel = (t, j) => `<select class="ps-input" data-cv-top="${j}" aria-label="比べ方">${OP_ORDER.map((o) => `<option value="${o}"${t.op === o ? " selected" : ""}>${OP_NAME[o]}</option>`).join("")}</select>`;
  const body = ts.map((t, j) => `<div class="cv-test">${j ? '<small class="cv-or">または</small>' : `<span class="cv-tk">${esc(k)}が</span>`}`
    + (t.op === "range"
      ? `<input class="ps-input cv-num" data-cv-tmin="${j}" value="${esc(t.min ?? "")}" placeholder="下" aria-label="下の端"><label class="cv-inc"><input type="checkbox" data-cv-tmininc="${j}"${t.minInc === false ? "" : " checked"}>以上</label>`
        + `<span>〜</span><input class="ps-input cv-num" data-cv-tmax="${j}" value="${esc(t.max ?? "")}" placeholder="上" aria-label="上の端"><label class="cv-inc"><input type="checkbox" data-cv-tmaxinc="${j}"${t.maxInc === false ? "" : " checked"}>以下</label>`
      : t.op === "empty" || t.op === "filled" ? ""
        : `<input class="ps-input" data-cv-tv="${j}" value="${esc((t.v || []).join("・"))}" placeholder="値（いくつかは ・ か , で区切る）" aria-label="値">`)
    + `<span class="cv-topx">${opSel(t, j)}<button type="button" class="icon-btn" data-cv-tdel="${j}" title="この条件を外す" aria-label="この条件を外す">×</button></span></div>`).join("");   // 比べ方と × は離さない
  return `<div class="cv-celled" data-cv-celled><div class="cv-celledhead"><b>${i + 1} 行目 ・ ${esc(k)}</b>${inp.type === "num" ? "<small>（数で比べます）</small>" : "<small>（字で比べます。前後の空白は見ません）</small>"}<span class="sp"></span>`
    + '<button type="button" class="pv-btn" data-cv-tadd>＋ または</button><button type="button" class="pv-btn" data-cv-tany>不問にする</button><button type="button" class="pv-btn" data-cv-close>閉じる</button></div>'
    + (body || '<small class="cv-hint">不問（この入力は見ません）。「＋ または」で条件を足します</small>') + "</div>";
}
/** 試すの答え（保存する前の表で。値が無ければ案内） */
function tryRes(x) {
  const F = window.WL && WL.formula, vals = x.inputs.map((_, i) => tryVals[i] ?? "");
  if (!F || !vals.some((v) => v !== "")) return '<small class="cv-hint">値を入れると、保存する前の表で答えを出します</small>';
  const numbered = { ...x, rows: x.rows.map((r, i) => ({ ...r, out: `=${i}` })), other: "=-1" };
  const hit = +F.convWith(numbered, vals), v = F.convWith(x, vals);
  return `<span class="cv-tryout">→ <b>${esc(v == null ? "（空欄）" : outText(v))}</b><small>${hit >= 0 ? `（${hit + 1} 行目に当たりました）` : "（どの行にも当たらず、どれにも当たらないときの値）"}</small></span>`;
}
function tryHtml(x) {
  return `<div class="cv-try"><span class="cv-lab">試す</span>${x.inputs.map((inp, i) => `<label>${esc(inp.name)}<input class="ps-input" data-cv-try="${i}" value="${esc(tryVals[i] ?? "")}" aria-label="試す値: ${esc(inp.name)}"></label>`).join("")}<span class="cv-tryres">${tryRes(x)}</span></div>`;
}
/** 入力の欄（版 3.124.0。1 行 1 入力の縦の表。決め方: ui-proposals/2026-11-convcols の B）: 頭の段に見出しと「＋ 入力」、行ごとに 名前・比べ方・当てる列の札・×。
    名前の欄の幅はいちばん長い名前に合わせ（--cv-nw）、見出しと縦の線をそろえる */
function insHtml(x, di) {
  return `<div class="cv-ins" style="--cv-nw:${nameWidth(x.inputs.map((i) => i.name))}px"><div class="cv-inshead">`
    + '<span class="cv-ih cv-ih-n">入力の名前</span><span class="cv-ih cv-ih-t">比べ方</span><span class="cv-ih cv-ih-c">当てる列（番号の順に、一覧に有る列へ当てます）</span><span class="sp"></span>'
    + (x.inputs.length < 8 ? `<button type="button" class="pv-btn" data-cv-iadd${di}>＋ 入力</button>` : "") + "</div>"
    + x.inputs.map((inp, i) => '<div class="cv-in">'
      + `<input class="ps-input" data-cv-iname="${i}" value="${esc(inp.name)}" aria-label="入力の名前" title="${esc(inp.name)}"${di}>`
      + `<select class="ps-input" data-cv-itype="${i}" aria-label="比べ方（字・数）"${di}><option value="text"${inp.type !== "num" ? " selected" : ""}>字</option><option value="num"${inp.type === "num" ? " selected" : ""}>数</option></select>`
      + colsBtn(inp, i, di)
      + (x.inputs.length > 1 ? `<button type="button" class="icon-btn" data-cv-idel="${i}" title="この入力を外す（行の条件からも外します）" aria-label="入力を外す"${di}>×</button>` : "") + "</div>").join("")
    + "</div>";
}
/** 名前の欄の幅（px）: いちばん長い名前が入る幅（120〜300px） */
let measureCtx = null;
function nameWidth(names) {
  measureCtx ||= document.createElement("canvas").getContext("2d");
  measureCtx.font = `800 12.5px ${getComputedStyle(document.body).fontFamily}`;
  measureCtx.letterSpacing = "0px";
  const w = Math.max(0, ...names.map((n) => measureCtx.measureText(String(n)).width));
  return Math.round(Math.min(300, Math.max(120, w + 20)));
}
const otherText = (x) => { const ok = otherKind(x); return ok === "keep" ? "元の値のまま" : ok === "blank" ? "（空欄）" : outText(x.other); };
function paint() {
  if (colPop && (colPop.d !== draft || !draft.inputs[colPop.i])) closeCols();
  const box = $("#masterSettings"), d = mstate.data.conv, x = draft, di = dis();
  const preset = x.id && d.items.find((y) => y.id === x.id)?.preset;
  const a = x.apply || {}, ok = otherKind(x);
  const expr = window.Conversions && x.name ? `conv('${x.name}', ${x.inputs.map((i) => `[${i.name}]`).join(", ")})` : "";
  box.innerHTML = `<section class="sh-page cv-page">
    <p class="ps-lead">表は<b>上から順</b>に見て、最初に当たった行の値を出します（行の中は「かつ」、1 つのセルに並べた条件は「または」）。一覧の「表示列」の帯から列に当てます。ここで直すと全員の一覧にすぐ効きます。</p>
    <div class="ps-result${notice ? ` ${notice[0]}` : " hidden"}" id="cvNotice" aria-live="polite">${notice ? notice[1] : ""}</div>
    ${incoming ? importHtml(d) : ""}
    <div class="sh-editor cv-editor">
      <aside class="sh-list" aria-label="登録済みの変換表"><div class="sh-list-head">登録済みの変換表</div>${ioHtml(d)}${listHtml(d)}</aside>
      <div class="sh-detail cv-detail">
        <div class="cv-top"><input class="ps-input cv-name" id="cvName" value="${esc(x.name)}" placeholder="変換表の名前（例: 地取区分）" aria-label="変換表の名前"${di}>
          ${preset ? '<span class="cv-tag">プリセット</span>' : x.id ? "" : '<span class="cv-tag">新しい表</span>'}<span class="sp"></span>
          ${savedAt && x.id && savedAt.id === x.id ? `<span class="cv-saved" title="保存したのはこの 1 表だけです（ほかの表は変えていません）">✓ この表だけ保存 ${esc(savedAt.at)}</span>` : ""}
          ${canBackup() && x.id ? '<button type="button" class="pv-btn" data-cvb-th title="この表を含む戻せる時点と、戻すとこの表がどう変わるか（開発者・メンテナンス者だけ）">履歴 ▾</button>' : ""}
          ${x.id ? '<button type="button" class="pv-btn cv-tmenu" data-cv-tmenu title="この表だけ書き出す・標準に戻す・この表を消す" aria-haspopup="menu" aria-label="この表のほかの操作">⋯</button>' : ""}
          ${can() ? `<button type="button" class="btn-primary" data-cv-save>${x.id ? "この表を保存" : "足す"}</button>` : ""}</div>
        <div class="cv-meta">
          <label>当て方<select class="ps-input" id="cvMode"${di}><option value="replace"${a.mode === "replace" ? " selected" : ""}>列の値を作り替える</option><option value="add"${a.mode !== "replace" ? " selected" : ""}>列を足す</option></select></label>
          ${a.mode === "replace" ? "" : `<label>足す列の名前<input class="ps-input" id="cvCol" value="${esc(a.column || "")}" placeholder="${esc(x.name || "例: 管理分類")}（{列} は元の列の名前）"${di}></label>
          <label>置き場<select class="ps-input" id="cvPlace"${di}>${[["left", "いちばん左"], ["after", "元の列の右"], ["end", "右の端"]].map(([k, n]) => `<option value="${k}"${(a.place || "end") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>`}
          <label>どれにも当たらないとき<select class="ps-input" id="cvOtherKind"${di}>${[["keep", "元の値のまま"], ["blank", "空欄"], ["text", "字を出す"], ["formula", "式"]].map(([k, n]) => `<option value="${k}"${ok === k ? " selected" : ""}>${n}</option>`).join("")}</select>
            ${ok === "text" || ok === "formula" ? `<input class="ps-input" id="cvOther" value="${esc(ok === "formula" ? String(x.other).slice(1) : x.other)}" aria-label="どれにも当たらないときの値"${di}>` : ""}</label>
        </div>
        ${insHtml(x, di)}
        ${gridHtml(x)}
        <div class="cv-foot2">${can() ? '<button type="button" class="pv-btn" data-cv-radd>＋ 行を足す</button>' : ""}<span class="cv-other">どれにも当たらないとき → <b>${esc(otherText(x))}</b></span>
          <span class="sp"></span>${expr ? `<code class="cv-expr" title="一覧の式ではこう書きます（表示列の「この列の作り方」でも）">${esc(expr)}</code>` : ""}</div>
        ${tryHtml(x)}
      </div></div></section>`;
  bind();
  fitGrid();
}
/** 取り込む前の確かめ（版 3.125.0 から表ごとの行の数と消える・変わる行）: どの表を置き換え・足すか。標準にもするかは押すボタンで選ぶ */
function importHtml(d) {
  const have = new Set(d.items.map((x) => x.name)), rep = incoming.filter((x) => have.has(x.name)), add = incoming.filter((x) => !have.has(x.name));
  const nrows = (x) => (Array.isArray(x.rows) ? x.rows.length : 0);
  const line = (x) => {
    const now = d.items.find((y) => y.name === x.name);
    if (!now) return `<li><span class="cv-imptag add">足す</span><b>「${esc(x.name)}」</b>${nrows(x)} 行</li>`;
    const c = rowCounts(now.rows || [], x.rows || []);
    return `<li><span class="cv-imptag rep">置き換え</span><b>「${esc(x.name)}」</b>${now.rows.length} 行 → ${nrows(x)} 行（${c.del || c.add || c.chg ? whatText(c) : "行は同じ"}）</li>`;
  };
  return `<div class="cv-imp" role="group" aria-label="取り込む前の確かめ"><b>${incoming.length} 表を取り込みます</b>`
    + `<ul class="cv-implist">${[...rep, ...add].map(line).join("")}</ul>`
    + `<small class="cv-impnote">ほかの ${d.items.length - rep.length} 表は変えません。取り込む前の今の ${d.items.length} 表は、自動で履歴に残します（「履歴と戻す」で戻せます）。</small>`
    + '<div class="cv-impbtns"><button type="button" class="btn-primary" data-cv-impgo>取り込む</button>'
    + '<button type="button" class="pv-btn" data-cv-impstd title="取り込んだ表を、「標準に戻す」で戻る中身にもします">取り込んで標準にもする</button>'
    + '<button type="button" class="pv-btn" data-cv-impno>やめる</button></div></div>';
}
/* 判定表は表の中だけを横に送る。送れる先があれば右に影（is-more）・セルを直す欄は見えている幅に収める */
function fitGrid() {
  const w = $("#masterSettings .cv-gridwrap"); if (!w) return;
  const mark = () => w.classList.toggle("is-more", w.scrollLeft + w.clientWidth < w.scrollWidth - 2);
  if (!w.dataset.fit) { w.dataset.fit = "1"; w.addEventListener("scroll", mark, { passive: true }); }
  layoutGrid(w);
  mark();
  const t = w.querySelector(".cv-grid"), ed = w.querySelector(".cv-celled");
  if (ed) ed.style.width = `${Math.max(320, Math.min(w.clientWidth, t ? t.offsetWidth : w.clientWidth) - 44)}px`;
}
/* 判定表の列の幅は画面で決める（版 3.124.0。表の自動の割り振りに任せると、空きがあるのに条件の札や見出しが折れ、狭い窓では右がはみ出した）。
   列ごとに 2 つの幅を測る: 折らない塊（値・比べ方の言葉・見出しの語・出す値の語）のいちばん広い幅＝最小、1 行に入る幅＝望む幅。
   見えている幅に、まず全部の列の最小を取り、残りを望む幅に足りない列へ足りない分の割合で配る（余りは最後の列へ流さない＝表は右に空きを残す）。
   最小の計でも入らなければ、行の ↑↓× を「⋯」の 1 つにまとめて（is-tight）測り直す。それでも入らなければ最小のまま横に送る（↑↓× は右に貼り付け） */
function layoutGrid(w) {
  const t = w.querySelector(".cv-grid"), cols = t && [...t.querySelectorAll("col")];
  const heads = t && [...t.querySelectorAll("thead th")];
  if (!cols || !heads || cols.length !== heads.length) return;
  const outs = [...t.querySelectorAll("[data-cv-out]")];
  const outW = outWidths(outs);                    // 出す値の欄の [最小, 望む]（枠と余白を含む）
  const measure = (mode) => {
    t.classList.add("cv-measure", mode);
    t.style.setProperty("--cv-outw", `${mode === "cv-m-min" ? outW[0] : outW[1]}px`);
    const ws = heads.map((h) => Math.ceil(h.getBoundingClientRect().width));
    t.classList.remove("cv-measure", mode);
    return ws;
  };
  t.style.tableLayout = ""; t.style.width = ""; cols.forEach((c) => { c.style.width = ""; });
  w.style.width = "100%";              // 見えている幅（枠は表に合わせるので、測る間だけ広げる）
  const avail = w.clientWidth - 2;   // 測りの丸めの分を残す
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  let lo, body, hi;
  // ↑↓× は、最小の幅でも入らないとき、または狭い表（900px 未満）で行の中身が 1 行に入らないときだけ「⋯」の 1 つにまとめる
  // （広い表では手を増やさず、長い値のセルを値の切れ目で折る）
  for (const tight of [false, true]) {
    t.classList.toggle("is-tight", tight);
    lo = measure("cv-m-min");
    body = measure("cv-m-body").map((v, i) => Math.max(v, lo[i]));   // 中身（行）が 1 行に入る幅。見出しは語の切れ目で折れてよい
    hi = measure("cv-m-max").map((v, i) => Math.max(v, body[i]));
    if (sum(lo) <= avail && (sum(body) <= avail || avail >= 900)) break;
  }
  // 幅を上げる: 足りない分の小さい列から順に目当ての幅まで満たす（1 行に入る列を多くする）。満たせない列には残りを足りない分の割合で
  const raise = (ws, goal, spare) => {
    const order = ws.map((v, i) => i).filter((i) => goal[i] > ws[i]).sort((a, b) => (goal[a] - ws[a]) - (goal[b] - ws[b]));
    const rest = [];
    for (const i of order) { const d = goal[i] - ws[i]; if (d <= spare && !rest.length) { ws[i] = goal[i]; spare -= d; } else rest.push(i); }
    const need = rest.reduce((a, i) => a + goal[i] - ws[i], 0);
    for (const i of rest) { const add = Math.floor(((goal[i] - ws[i]) * spare) / need); ws[i] += add; }
    return Math.max(0, avail - sum(ws));
  };
  const ws = lo.slice();
  let spare = avail - sum(ws);
  // 出す値（いちばん大事な列）は先に、見えている幅の 1/3 まで 1 行に。次にほかの列の中身を 1 行に、残りで出す値の長い値も
  if (spare > 0) spare = raise(ws, ws.map((v, i) => (i === 1 ? Math.max(v, Math.min(body[1], Math.floor(avail / 3))) : v)), spare);
  if (spare > 0) spare = raise(ws, body.map((v, i) => (i === 1 ? ws[1] : v)), spare);
  if (spare > 0) spare = raise(ws, body, spare);
  if (spare > 0) raise(ws, hi, spare);                // 余れば見出しも 1 行に（余りは最後の列へ流さない）
  cols.forEach((c, i) => { c.style.width = `${ws[i]}px`; });
  t.style.tableLayout = "fixed";
  t.style.width = `${ws.reduce((a, b) => a + b, 0)}px`;
  w.style.width = "";
  // 出す値の欄は列の幅いっぱい（列の余白 4px と線 1px を除く）
  t.style.setProperty("--cv-outw", `${Math.max(outW[0], ws[1]) - 5}px`);
}
/** 出す値の欄の幅 [最小, 望む]: 最小は値の中の折らない語（空白・括弧の前・/ ･ ・ _ の後で切れる）のいちばん広い幅、望む幅は 1 行に入る幅（560px まで） */
function outWidths(outs) {
  if (!outs.length) return [72, 120];
  measureCtx ||= document.createElement("canvas").getContext("2d");
  const cs = getComputedStyle(outs[0]);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  measureCtx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + 6;
  const tw = (x) => measureCtx.measureText(x).width;
  const vals = outs.map((el) => el.value || el.placeholder);
  const word = Math.max(0, ...vals.flatMap((v) => v.split(/\s+|(?=[（(［\[])|(?<=[/･・_,，、])/).map(tw)));
  const full = Math.max(0, ...vals.map(tw));
  const lo = Math.ceil(Math.min(300, Math.max(56, word + pad))) + 5;
  return [lo, Math.max(lo, Math.ceil(Math.min(560, Math.max(72, full + pad))) + 5)];
}
let gridResize = 0;
addEventListener("resize", () => { clearTimeout(gridResize); gridResize = setTimeout(() => { if (mstate.tab === "conv") fitGrid(); }, 120); });

/* ---------------- 当てる列を、取り込んでいるデータの列から選ぶ（版 3.44.0。利用者の要望 2026-10-17 の 3） ----------------
   入力の「当てる列」は、データ元ごとの実際の列（/api/data/columns。値の見本つき）から選ぶ。データで名前が違う同じ意味の列
   （品質データの「ｵｰﾀﾞｰ材質」・仕掛の「製造材質」など）は、みな選んでおけば、一覧ごとに有る方へ当たる（上から順。conversions.js の matchColumn）。
   選んだ列の札には、その列が有るデータの印（データの色と頭の字。ダッシュボードと同じ色）。どのデータにも無い名前は「!」（計算列の名前などは手で足せる） */
let dataCols = null, colPop = null;                                // データ元ごとの列 [{key, name, columns:[{column, samples}], error}]・開いている選ぶ面
const NORM = (v) => (window.Conversions ? Conversions.norm(v) : String(v));
const srcColor = (key) => (window.DashPanels ? DashPanels.colorOf(key) : "#5a6f77");
async function loadCols(force = false) {
  if (dataCols && !force) return dataCols;
  try { const r = await fetch("/api/data/columns", { cache: "no-store" }); const d = await r.json(); if (r.ok) dataCols = d.sources || []; } catch { /* 読めなければ印を出さない（手で書ける） */ }
  return dataCols;
}
/** 名前 a が有るデータ元の並び */
const whereIs = (a) => (dataCols || []).filter((s) => s.columns.some((c) => NORM(c.column) === NORM(a)));
function srcTags(a) {
  if (!dataCols) return "";
  const at = whereIs(a);
  return at.length ? at.map((s) => `<i class="cv-src" style="--c:${srcColor(s.key)}" title="${esc(s.name)}にある列">${esc(s.name.slice(0, 1))}</i>`).join("")
    : '<i class="cv-src is-none" title="取り込んでいるデータに、この名前の列はありません（計算列の名前なら、一覧で当たります）">!</i>';
}
function colsBtn(inp, i, di = "") {
  const cs = inp.columns || [];
  return `<button type="button" class="cv-colsbtn" data-cv-cols="${i}" aria-haspopup="dialog" title="当てる列を、取り込んでいるデータの列から選びます（いくつでも。上から順に、一覧に有る列へ当てます）"${di}>`
    + (cs.length ? cs.map((a) => `<span class="cv-alias"><b>${esc(a)}</b>${srcTags(a)}</span>`).join("") : `<span class="cv-colsph">${esc(inp.name)}（列を選ぶ）</span>`) + '<i class="cv-caret" aria-hidden="true">▾</i></button>';
}
const paintColBtns = () => draft && document.querySelectorAll("#masterSettings [data-cv-cols]").forEach((b) => { const i = +b.dataset.cvCols; if (draft.inputs[i]) b.outerHTML = colsBtn(draft.inputs[i], i, dis()); });
function closeCols() { if (!colPop) return; colPop.off(); colPop.el.remove(); colPop = null; }
function colPopHtml(i, q = "") {
  const inp = draft.inputs[i], cs = inp.columns || [], has = new Set(cs.map(NORM)), qq = NORM(q);
  // 同じ名前の列がほかのデータにも有れば、名前の右にそのデータの印（同じ列だと結び付けて見せる。2026-10-convcols の 1 回目の採点）
  const also = (s, col) => (dataCols || []).filter((o) => o !== s && o.columns.some((c) => NORM(c.column) === NORM(col)))
    .map((o) => `<i class="cv-src" style="--c:${srcColor(o.key)}" title="${esc(o.name)}にも同じ名前の列があります">${esc(o.name.slice(0, 1))}</i>`).join("");
  const srcs = (dataCols || []).map((s) => {
    const list = s.columns.filter((c) => !qq || NORM(c.column).includes(qq) || c.samples.some((v) => NORM(v).includes(qq)));
    return `<section class="cv-cpsrc" style="--c:${srcColor(s.key)}"><h5><i></i>${esc(s.name)}<small>${s.error && !s.columns.length ? esc(s.error) : `${list.length}${qq ? ` / ${s.columns.length}` : ""} 列`}</small></h5><div class="cv-cplist">`
      + list.map((c) => `<label class="cv-cpi${has.has(NORM(c.column)) ? " is-on" : ""}" title="${esc(c.column)}${c.samples.length ? `（値の例: ${esc(c.samples.join("・"))}）` : ""}"><input type="checkbox" data-cp-col="${esc(c.column)}"${has.has(NORM(c.column)) ? " checked" : ""}>`
        + `<b>${esc(c.column)}<span class="cv-also">${also(s, c.column)}</span></b><small>${esc(c.samples.join("・") || "（値なし）")}</small></label>`).join("")
      + (list.length ? "" : '<p class="cv-hint">当たる列がありません</p>') + "</div></section>";
  }).join("");
  return `<div class="cv-cphead"><b>「${esc(inp.name)}」に当てる列</b><small>名前が違う同じ意味の列は、データごとに選びます（上から順に当たります）</small><span class="sp"></span><button type="button" class="pv-btn" data-cp-close>閉じる</button></div>`
    + `<div class="cv-cpbar"><input type="search" class="ps-input cv-cpq" data-cp-q value="${esc(q)}" placeholder="列の名前・値で探す" aria-label="列を探す">`
    + `<div class="cv-cpchosen"><span class="cv-lab">選んだ列</span>${cs.length ? cs.map((a, k) => `<span class="cv-alias">${k ? '<button type="button" class="cv-cpup" data-cp-up="' + k + '" title="上へ（先に当てる）" aria-label="上へ">↑</button>' : ""}<b>${esc(a)}</b>${srcTags(a)}<button type="button" class="cv-cpx" data-cp-drop="${k}" title="外す" aria-label="「${esc(a)}」を外す">×</button></span>`).join("") : '<small class="cv-hint">まだありません（無ければ、入力の名前「' + esc(inp.name) + '」の列に当てます）</small>'}</div></div>`
    + `<div class="cv-cpsrcs">${dataCols ? srcs || '<p class="cv-hint">データ元がありません</p>' : '<p class="cv-hint">データの列を読んでいます…</p>'}</div>`
    + '<div class="cv-cpfoot"><input class="ps-input" data-cp-own placeholder="データに無い名前を足す（計算列など）" aria-label="手で足す列の名前"><button type="button" class="pv-btn" data-cp-add>足す</button></div>';
}
/** 面を札の下に、マスタ管理の窓の中へ収めて置く（窓の右端・下端から出さない。1 回目の採点: 窓の右へ 130px 出ていた）。
    札の下に面が入らないときは、マスタの面を送って札を上へ寄せてから置く（版 3.124.0。前は 1280×720 で面が窓の下を越え、「データに無い名前を足す」に届かなかった） */
function place(el, anchor) {
  const panel = document.querySelector("#masterOverlay .master-panel") || document.body, box = panel.getBoundingClientRect();
  const w = Math.min(820, box.width - 24);
  el.style.width = `${w}px`;
  el.style.maxHeight = "none";
  const need = Math.min(560, el.scrollHeight), scroller = $("#masterSettings");
  let r = anchor.getBoundingClientRect();
  if (scroller && box.bottom - 12 - (r.bottom + 6) < need) {
    const by = Math.max(0, Math.round(r.top - (box.top + 70)));
    if (by) { scroller.scrollTop += by; r = anchor.getBoundingClientRect(); }
  }
  const top = Math.round(r.bottom + 6);
  el.style.left = `${Math.round(Math.max(box.left + 12, Math.min(r.left, box.right - w - 12)))}px`;
  el.style.top = `${top}px`;
  el.style.maxHeight = `${Math.max(260, box.bottom - top - 12)}px`;
}
async function openCols(i, anchor) {
  if (colPop && colPop.i === i) { closeCols(); return; }
  closeCols();
  const el = document.createElement("div");
  el.className = "cv-colpop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "当てる列を選ぶ");
  document.body.append(el);
  colPop = { i, el, q: "", d: draft, off: TPA.dismissable(el, closeCols, { keep: $("#masterSettings .cv-ins") || anchor, event: "mousedown" }) };
  const draw = () => {
    if (!colPop || colPop.el !== el) return;
    const at = el.querySelector("[data-cp-q]"), caret = at && document.activeElement === at ? at.selectionStart : null, top = el.querySelector(".cv-cpsrcs")?.scrollTop || 0;
    el.innerHTML = colPopHtml(i, colPop.q);
    place(el, document.querySelector(`#masterSettings [data-cv-cols="${i}"]`) || anchor);
    const lists = el.querySelector(".cv-cpsrcs"); if (lists) lists.scrollTop = top;
    if (caret != null) { const n = el.querySelector("[data-cp-q]"); n.focus(); n.setSelectionRange(caret, caret); }
  };
  colPop.draw = draw;
  const set = (cs) => { draft.inputs[i].columns = cs; paintColBtns(); draw(); };
  el.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-cp-col]"); if (!cb) return;
    const name = cb.dataset.cpCol, cs = (draft.inputs[i].columns || []).filter((a) => NORM(a) !== NORM(name));
    set(cb.checked ? [...cs, name] : cs);
  });
  TPA.onTextIn(el, "[data-cp-q]", (x) => { colPop.q = x.value; draw(); });   // 変換中は描き直さない（版 3.46.0）
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-cp-own]") && !TPA.composing(e)) { e.preventDefault(); el.querySelector("[data-cp-add]").click(); } });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const cs = (draft.inputs[i].columns || []).slice(), ds = b.dataset;
    if (ds.cpClose != null) { closeCols(); document.querySelector(`#masterSettings [data-cv-cols="${i}"]`)?.focus(); return; }
    if (ds.cpDrop != null) { cs.splice(+ds.cpDrop, 1); set(cs); return; }
    if (ds.cpUp != null) { const k = +ds.cpUp; [cs[k - 1], cs[k]] = [cs[k], cs[k - 1]]; set(cs); return; }
    if (ds.cpAdd != null) {
      const v = el.querySelector("[data-cp-own]").value.trim();
      if (v && !cs.some((a) => NORM(a) === NORM(v))) set([...cs, v]);
    }
  });
  draw();
  requestAnimationFrame(() => el.querySelector("[data-cp-q]")?.focus());
  if (!dataCols) { await loadCols(); paintColBtns(); draw(); }
}

/* ---------------- 描き直しても、見ている所と焦点を保つ（版 3.44.0。利用者の要望 2026-10-17 の 1） ----------------
   条件の値を直した直後に別の欄を押すと、描き直しで判定表（.cv-gridwrap）が作り直され、送り位置が上まで戻り、押した欄も消えていた。
   - 値だけの直し（条件の値・出す値・当てる列・試す）は描き直さず、そこから決まる字（セルの札・試すの答え・どれにも当たらないとき）だけを替える（live）
   - 形が変わる直し（入力の名前・比べ方・行や条件を足す など）は描き直すが、判定表とマスタの面の送り位置と、焦点の欄・打っていた位置を戻す（keepView）
   - 欄を離れたこと（change）で描き直すときは、押している間は待つ（押したボタン・欄が描き直しで消えて、押したことが無くなるため: soon） */
const focusKey = (el) => {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const kv = Object.entries(el.dataset).find(([k]) => k.startsWith("cv"));
  return kv ? `[data-${kv[0].replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}="${CSS.escape(kv[1])}"]` : null;
};
function keepView(fn) {
  const box = $("#masterSettings"), g = box.querySelector(".cv-gridwrap"), a = document.activeElement;
  const at = { top: box.scrollTop, gt: g ? g.scrollTop : 0, gl: g ? g.scrollLeft : 0 };
  const key = a && a !== document.body && box.contains(a) ? focusKey(a) : null;
  const caret = key && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  const g2 = box.querySelector(".cv-gridwrap");
  box.scrollTop = at.top;
  if (g2) { g2.scrollTop = at.gt; g2.scrollLeft = at.gl; }
  const n = key && box.querySelector(key);
  if (n) { n.focus({ preventScroll: true }); if (caret && n.setSelectionRange) { try { n.setSelectionRange(...caret); } catch { /* 数の欄は位置を持たない */ } } }
}
let pressing = false;
document.addEventListener("pointerdown", () => { pressing = true; }, true);
document.addEventListener("pointerup", () => { setTimeout(() => { pressing = false; }, 0); }, true);
function soon(fn) {
  if (!pressing) { fn(); return; }
  const go = () => { document.removeEventListener("pointerup", go, true); setTimeout(fn, 0); };   // 押し終えた後（click の後）に
  document.addEventListener("pointerup", go, true);
}
/** 値だけを直した後: 描き直さず、値から決まる字だけを替える */
function live() {
  const box = $("#masterSettings"), x = draft; if (!box || !x) return;
  if (cell) {
    const b = [...box.querySelectorAll("[data-cv-cell]")].find((el) => el.dataset.cvCell === `${cell.r}|${cell.k}`);
    if (b) b.innerHTML = chipsHtml(((x.rows[cell.r] || {}).when || {})[cell.k] || []);
  }
  const res = box.querySelector(".cv-tryres"); if (res) res.innerHTML = tryRes(x);
  const other = box.querySelector(".cv-other b"); if (other) other.textContent = otherText(x);
  if (cell) fitGrid();   // 札の字が変われば列の幅を決め直す
}

/* ---------------- 操作 ---------------- */
function sync() {
  const x = draft, v = (id) => { const el = $(id); return el ? el.value : null; };
  if (v("#cvName") != null) x.name = v("#cvName").trim();
  const mode = v("#cvMode");
  if (mode) x.apply = mode === "replace" ? { mode } : { mode, column: v("#cvCol") ?? x.apply.column ?? "", place: v("#cvPlace") || x.apply.place || "end" };
  const ok = v("#cvOtherKind"), first = (x.inputs[0] || {}).name;
  if (ok === "keep") x.other = `=[${first}]`;
  else if (ok === "blank") x.other = "";
  else if (ok === "text") x.other = v("#cvOther") ?? (otherKind(x) === "text" ? x.other : "その他");
  else if (ok === "formula") x.other = "=" + (v("#cvOther") ?? (otherKind(x) === "formula" ? String(x.other).slice(1) : `[${first}]`));
}
function renameInput(i, name) {
  const x = draft, old = x.inputs[i].name;
  if (!name || name === old || x.inputs.some((a) => a.name === name)) return;
  x.inputs[i].name = name;
  x.rows.forEach((r) => { if (r.when && old in r.when) { r.when[name] = r.when[old]; delete r.when[old]; } });
  if (x.other === `=[${old}]`) x.other = `=[${name}]`;
  if (cell && cell.k === old) cell.k = name;
}
const say = (cls, html) => { notice = [cls, html]; const n = $("#cvNotice"); if (n) { n.className = `ps-result ${cls}`; n.innerHTML = html; } };
function fileName(now = new Date()) {
  const app = document.querySelector('meta[name="tpa-app"]')?.content || "アプリ", p = (n) => String(n).padStart(2, "0");
  return `${app}_変換表_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}
async function io(ds) {
  if (ds.cvExport != null) {
    const r = await masterRequest("/api/masters/conversions/export", { cache: "no-store" });
    if (!r.ok) { say("ng", "✕ " + esc(r.data.error || "書き出せませんでした")); return; }
    TPA.saveJson(IO_KIND, r.data.items, fileName());
    say("ok", `✓ ${r.data.items.length} 表を書き出しました`); return;
  }
  if (ds.cvImport != null) {
    let items;
    try { items = await TPA.pickJson(IO_KIND, "変換表"); } catch (e) { say("ng", "✕ " + esc(e.message)); return; }
    if (!items) return;
    incoming = items; notice = null; paint(); $("#masterSettings .cv-imp")?.scrollIntoView({ block: "nearest" }); return;
  }
  if (ds.cvImpno != null) { incoming = null; paint(); return; }
  if (ds.cvImpgo != null || ds.cvImpstd != null) {
    const res = await withLockWait(() => masterRequest("/api/masters/conversions/import", TPA.json("POST", { items: incoming, asDefault: ds.cvImpstd != null })),
      (r) => say("wait", lockWaitText(r, "取り込み", boldName)));
    if (!res.ok) { say("ng", "✕ " + esc(res.data.error || "取り込めませんでした。")); return; }
    incoming = null;
    const at = draft && draft.name;
    if (!(await after(res, `✓ 取り込みました（置き換え ${res.data.replaced}・足す ${res.data.added}）${ds.cvImpstd != null ? "。標準にもしました" : ""}。取り込む前の形は履歴に残しました`))) return;
    draft = clone(res.data.items.find((y) => y.name === at) || res.data.items[0]); cell = null; tryVals = []; paint(); return;
  }
}
function bind() {
  $("#masterSettings .cv-page").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const ds = b.dataset;
    if (["cvExport", "cvImport", "cvImpno", "cvImpgo", "cvImpstd"].some((k) => ds[k] != null)) { e.stopPropagation(); io(ds); }
    if (ds.cvbHist != null) { e.stopPropagation(); openHist(null); }
    if (ds.cvbTh != null) { e.stopPropagation(); if (draft && draft.id) openHist(draft.name); }
    if (ds.cvTmenu != null) { e.stopPropagation(); tableMenu(b); }
  }, true);
  const box = $("#masterSettings .cv-editor"), x = draft;
  const redraw = () => soon(() => { if (draft !== x || !$("#masterSettings .cv-editor")) return; sync(); keepView(paint); });
  box.addEventListener("change", (e) => {
    const t = e.target, ds = t.dataset;
    if (ds.cvIname != null) { renameInput(+ds.cvIname, t.value.trim()); redraw(); return; }
    if (ds.cvItype != null) { x.inputs[+ds.cvItype].type = t.value; redraw(); return; }
    if (ds.cvOut != null) { const v = t.value.replace(/[\r\n]+/g, ""); if (v !== t.value) t.value = v; x.rows[+ds.cvOut].out = v; t.title = v; fitGrid(); return; }
    const ts = cell && ((x.rows[cell.r].when ||= {})[cell.k] ||= []);
    if (ts) {
      if (ds.cvTop != null) { const j = +ds.cvTop, was = ts[j]; ts[j] = t.value === "range" ? { op: "range", min: "", max: "" } : ["empty", "filled"].includes(t.value) ? { op: t.value } : { op: t.value, v: was.v || [""] }; redraw(); return; }
      if (ds.cvTv != null) { ts[+ds.cvTv].v = splitVals(t.value); live(); return; }
      if (ds.cvTmin != null) { ts[+ds.cvTmin].min = t.value.trim(); live(); return; }
      if (ds.cvTmax != null) { ts[+ds.cvTmax].max = t.value.trim(); live(); return; }
      if (ds.cvTmininc != null) { if (t.checked) delete ts[+ds.cvTmininc].minInc; else ts[+ds.cvTmininc].minInc = false; live(); return; }
      if (ds.cvTmaxinc != null) { if (t.checked) delete ts[+ds.cvTmaxinc].maxInc; else ts[+ds.cvTmaxinc].maxInc = false; live(); return; }
    }
    if (["cvOther", "cvCol"].includes(t.id)) { sync(); live(); return; }
    if (["cvMode", "cvPlace", "cvOtherKind"].includes(t.id)) redraw();
  });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-cv-out]") && !TPA.composing(e)) e.preventDefault(); });   // 出す値は 1 行
  box.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.cvTry == null) return;
    tryVals[+t.dataset.cvTry] = t.value;
    live();
  });
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const ds = b.dataset;
    if ((ds.cvPick || ds.cvNew != null) && !(await TPA.unsaved.leave("master:conv", "ほかの表へ移る"))) return;
    if (ds.cvPick) { const it = mstate.data.conv.items.find((y) => y.id === +ds.cvPick); draft = clone(it); cell = null; tryVals = []; notice = null; paint(); return; }
    if (ds.cvNew != null) { draft = blank(); cell = null; tryVals = []; notice = null; paint(); $("#cvName").focus(); return; }
    sync();
    if (ds.cvCell) { const [r, ...k] = ds.cvCell.split("|"); const same = cell && cell.r === +r && cell.k === k.join("|"); cleanCell(); cell = same ? null : { r: +r, k: k.join("|") };
      if (cell && !((x.rows[cell.r].when || {})[cell.k] || []).length) ((x.rows[cell.r].when ||= {})[cell.k] = [{ op: "eq", v: [""] }]);
      keepView(paint); if (cell) $("#masterSettings .cv-celled")?.scrollIntoView({ block: "nearest" }); return; }
    if (ds.cvClose != null) { cleanCell(); cell = null; keepView(paint); return; }
    if (ds.cvTany != null) { delete x.rows[cell.r].when[cell.k]; cell = null; keepView(paint); return; }
    if (ds.cvTadd != null) { x.rows[cell.r].when[cell.k].push({ op: "eq", v: [""] }); keepView(paint); return; }
    if (ds.cvTdel != null) { x.rows[cell.r].when[cell.k].splice(+ds.cvTdel, 1); if (!x.rows[cell.r].when[cell.k].length) delete x.rows[cell.r].when[cell.k]; keepView(paint); return; }
    if (ds.cvRadd != null) { cleanCell(); x.rows.push({ when: {}, out: "" }); cell = null; keepView(paint); return; }
    if (ds.cvRdel != null) { x.rows.splice(+ds.cvRdel, 1); cell = null; keepView(paint); return; }
    if (ds.cvRmenu != null) {   // 狭い表では ↑↓× を「⋯」の 1 つに（同じボタンを押す）
      const i = +ds.cvRmenu, r = b.getBoundingClientRect(), go = (k) => () => document.querySelector(`#masterSettings [data-cv-${k}="${i}"]`)?.click();
      TPA.menu({ x: r.left, y: r.bottom + 2, head: `${i + 1} 行目`, items: [
        { label: "上へ", icon: "↑", disabled: i === 0, why: i === 0 ? "いちばん上です" : "", run: go("up") },
        { label: "下へ", icon: "↓", disabled: i >= x.rows.length - 1, why: i >= x.rows.length - 1 ? "いちばん下です" : "", run: go("down") },
        { sep: true },
        { label: "この行を消す", icon: "×", danger: true, run: go("rdel") },
      ] });
      return;
    }
    if (ds.cvUp != null || ds.cvDown != null) {
      const i = +(ds.cvUp ?? ds.cvDown), j = ds.cvUp != null ? i - 1 : i + 1;
      if (j < 0 || j >= x.rows.length) return;
      [x.rows[i], x.rows[j]] = [x.rows[j], x.rows[i]]; cell = null; keepView(paint); return;
    }
    if (ds.cvIadd != null) { let n = "入力" + (x.inputs.length + 1); while (x.inputs.some((a) => a.name === n)) n += "'"; x.inputs.push({ name: n, type: "text", columns: [] }); keepView(paint); return; }
    if (ds.cvIdel != null) { const old = x.inputs.splice(+ds.cvIdel, 1)[0]; x.rows.forEach((r) => { if (r.when) delete r.when[old.name]; }); cell = null; keepView(paint); return; }
    if (ds.cvCols != null) { openCols(+ds.cvCols, b); return; }
    if (ds.cvSave != null) { await save(); return; }
    // 標準に戻す・この表を消すは表の頭の「⋯」から（版 3.125.0。保存の隣に壊すボタンを置かない）
  });
}
/* 開いていたセルの、値を入れなかった条件は外す（条件が残らなければ不問）。空欄を比べるときは「空欄」を選ぶ */
function cleanCell() {
  if (!cell) return;
  const r = draft.rows[cell.r], ts = ((r && r.when) || {})[cell.k];
  if (!ts) return;
  const kept = ts.filter((t) => !Array.isArray(t.v) || t.v.some((v) => v !== ""))
    .filter((t) => t.op !== "range" || String(t.min ?? "") !== "" || String(t.max ?? "") !== "");
  if (kept.length) r.when[cell.k] = kept; else delete r.when[cell.k];
}
async function after(res, okText) {
  if (res.status === 409 && res.data.kind === "conflict") { mstate.data.conv = null; notice = ["ng", "開いたあとに、ほかの PC がこの変換表を直しました。読み直したので、もう一度直してください。"]; await render(); return false; }
  if (!res.ok) { say("ng", "✕ " + esc(res.data.error || "保存できませんでした。")); return false; }
  mstate.data.conv = res.data; window.Conversions?.take(res.data);
  emit("tpa:masters-changed");
  notice = ["ok", okText]; return true;
}
async function save() {
  cleanCell(); cell = null;
  const x = draft, body = { name: x.name, inputs: x.inputs, rows: x.rows, other: x.other, apply: x.apply };
  const res = await withLockWait(() => masterRequest(x.id ? `/api/masters/conversions/${x.id}` : "/api/masters/conversions",
    TPA.json(x.id ? "PUT" : "POST", x.id ? { ...body, base_rev: x.rev } : body)), (r) => say("wait", lockWaitText(r, "保存", boldName)));
  const others = Math.max(0, res.data.items.length - 1), shared = res.data.shared;
  if (!(await after(res, `✓ <b>「${esc(x.name)}」だけ</b>を保存しました（この 1 表・${x.rows.length} 行。ほかの ${others} 表は変えていません）。`
    + `${canBackup() ? "保存する前の形は履歴に残しました。" : ""}この PC の一覧にすぐ効き${shared ? "、ほかの PC には数秒で届きます" : "ます"}`))) return;
  const id = x.id || res.data.created;
  const t = new Date(); savedAt = { id, at: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` };
  loadHist().then(() => { if (mstate.tab === "conv" && $("#masterSettings .cv-editor")) keepView(paint); });
  draft = clone(res.data.items.find((y) => y.id === id) || x); paint();
}
/** 表の頭の「⋯」: この表だけ書き出す・標準に戻す…（履歴と戻すの窓で標準と比べてから）・この表を消す */
function tableMenu(b) {
  const x = draft, r = b.getBoundingClientRect(), d = mstate.data.conv, preset = x.id && d.items.find((y) => y.id === x.id)?.preset;
  const std = hist && hist.customDefaults ? "standard" : "bundled";
  TPA.menu({ x: r.left, y: r.bottom + 2, head: `「${x.name}」`, items: [
    { label: "この表だけ書き出す", icon: "↓", run: () => exportOne(x) },
    { label: "標準に戻す…（違いを見てから）", icon: "⟲", disabled: !canBackup() || !preset,
      why: !preset ? "同梱のプリセット・標準に無い表です" : !canBackup() ? "開発者・メンテナンス者だけです" : "", run: () => openHist(x.name, std) },
    { sep: true },
    { label: "この表を消す…", icon: "×", danger: true, disabled: !can(), why: can() ? "" : "書き換えられません", run: () => remove() },
  ] });
}
function exportOne(x) {
  const one = { name: x.name, inputs: x.inputs, rows: x.rows, other: x.other, apply: x.apply };
  TPA.saveJson(IO_KIND, [one], fileName().replace(/\.json$/, `_${x.name}.json`));
  say("ok", `✓ 「${esc(x.name)}」だけを書き出しました（1 表・${x.rows.length} 行）`);
}
async function remove() {
  const x = draft;
  if (!confirm(`変換表「${x.name}」を消します。この表を使う列（conv('${x.name}', …)）は空になります。よろしいですか？`)) return;
  const res = await masterRequest(`/api/masters/conversions/${x.id}?rev=${x.rev}`, { method: "DELETE" });
  if (!(await after(res, `✓ 「${esc(x.name)}」を消しました${canBackup() ? "（消す前の形は履歴に残しました）" : ""}`))) return;
  loadHist();

  draft = res.data.items[0] ? clone(res.data.items[0]) : blank(); paint();
}
/* ---------------- 履歴と戻す（版 3.125.0。利用者の改良依頼 2026-11-17 の 5。決め方: ui-proposals/2026-11-convbackup の案 F） ----------------
   窓 1 枚: 上の段に「戻せる時点」と「標準」の違いと標準の操作、左に戻せる時点（頭に同梱のプリセット・標準を固定。その下に手で取る・
   新しい順の時点）、右に押した時点に戻すと表ごと・行ごとにどう変わるか（窓が比べた答え: GET /history/<id>）と戻すボタン。
   表の頭の「履歴 ▾」は同じ窓をその表を含む時点だけ・その表の違いだけで開く。戻すと、戻す前の形も時点に残り、「元に戻す」で取り消せる。
   開発者・メンテナンス者だけ（窓の道も 403）。 */
const rowKey = (r) => JSON.stringify({ when: r.when || {}, out: r.out });
/** 行を並びの位置で比べた数（窓の conv_history::diff_tables と同じ決まり。取り込む前の確かめで使う） */
function rowCounts(now, then) {
  const c = { del: 0, add: 0, chg: 0 };
  for (let i = 0; i < Math.max(now.length, then.length); i++) {
    if (now[i] && !then[i]) c.del++; else if (!now[i] && then[i]) c.add++; else if (rowKey(now[i]) !== rowKey(then[i])) c.chg++;
  }
  return c;
}
/** 違いの言葉（2 行が消える・1 行が戻る・出す値か条件が 1 行変わる・入力・当て方が変わる） */
function whatText(d) {
  if (d.st === "same") return "変わりません";
  if (d.st === "back") return `表が戻ります（${d.then} 行）`;
  if (d.st === "gone") return `この時点に無い表なので、消えます（${d.now} 行）`;
  return [d.del ? `${d.del} 行が消える` : "", d.add ? `${d.add} 行が戻る` : "", d.chg ? `${d.chg} 行が変わる` : "", d.setup ? "入力・当て方が変わる" : ""]
    .filter(Boolean).map((w) => `<span class="cvh-nb">${w}</span>`).join("・") || "変わりません";
}
const stChip = (st) => ({ chg: '<span class="cvh-st is-chg">変わる</span>', same: '<span class="cvh-st is-same">同じ</span>', back: '<span class="cvh-st is-back">戻る</span>', gone: '<span class="cvh-st is-gone">消える</span>' })[st] || "";
const ptTitle = (p) => (p.id === "bundled" ? "同梱のプリセット" : p.id === "standard" ? "標準（自分で決めた表）" : shortAt(p.at));
const ptWho = (p) => (p.by && (p.by.login || p.by.pc) ? `<span class="cvh-nb">${esc([p.by.login, p.by.pc && `（${p.by.pc}）`].filter(Boolean).join(""))}</span>` : "");
const kindChip = (p) => (p.bundled ? (p.id === "standard" ? '<span class="cvh-k is-std">標準</span>' : '<span class="cvh-k is-pre">同梱</span>') : p.auto ? '<span class="cvh-k is-auto">自動</span>' : '<span class="cvh-k is-man">手で</span>');
const scopeChip = (p) => `<span class="cvh-sc">${p.scope === "all" ? "全体" : `${(p.scope || []).length} 表`}</span>`;
async function openHist(name, sel = null) {
  hw = { name, sel, list: null, det: null, open: null, picks: null, mode: "diff", msg: null, busy: false };
  drawHist();
  await reloadHist(sel);
}
function closeHist() {
  if (!hw) return;
  hw = null;
  document.querySelector(".cvh-dlg")?.remove();
  document.removeEventListener("keydown", histKey, true);
}
function histKey(e) { if (e.key === "Escape" && hw) { e.stopPropagation(); e.preventDefault(); closeHist(); } }
async function reloadHist(sel) {
  if (!hw) return;
  const q = hw.name ? `?name=${encodeURIComponent(hw.name)}` : "";
  const r = await fetch(`/api/masters/conversions/history${q}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!hw) return;
  if (!r.ok) { hw.msg = ["ng", `✕ ${esc(d.error || "履歴を読めませんでした")}`]; drawHist(); return; }
  hw.list = d;
  const all = [d.bundled, d.standardPoint, ...(d.points || [])].filter(Boolean);
  // はじめは、今と違ういちばん新しい時点（無ければいちばん新しい時点・同梱）
  hw.sel = sel && all.some((p) => p.id === sel) ? sel : ((d.points || []).find((p) => p.changed) || (d.points || [])[0] || d.bundled || {}).id;
  await loadDet();
}
async function loadDet() {
  if (!hw || !hw.sel) { drawHist(); return; }
  const q = hw.name ? `?name=${encodeURIComponent(hw.name)}` : "";
  const r = await fetch(`/api/masters/conversions/history/${encodeURIComponent(hw.sel)}${q}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!hw) return;
  hw.det = r.ok ? d : null;
  if (!r.ok) hw.msg = ["ng", `✕ ${esc(d.error || "違いを読めませんでした")}`];
  const ch = hw.det ? hw.det.tables.filter((t) => t.st !== "same") : [];
  hw.picks = new Set(ch.map((t) => t.name));
  hw.open = (ch.find((t) => t.rows.length) || {}).name || null;     // 変わる行のある最初の表は、はじめから行まで開く
  drawHist();
}
function ptCard(p) {
  const diff = hw.name && p.diff ? (p.diff.st === "same" ? "今と同じ" : whatTextPlain(p.diff)) : (p.changed ? `今と違う表 ${p.changed}` : "今と同じ");
  return `<button type="button" class="cvh-pt${p.id === hw.sel && hw.mode === "diff" ? " is-on" : ""}" data-cvh-pt="${esc(p.id)}" aria-pressed="${p.id === hw.sel}">`
    + `<span class="cvh-pt1"><b>${esc(ptTitle(p))}</b>${kindChip(p)}${p.bundled ? "" : scopeChip(p)}</span>`
    + `<span class="cvh-pt2">${p.bundled ? esc(p.id === "standard" ? "各表の「標準に戻す」の戻る先" : "アプリに入っている元の形") : `${esc(p.why)}${ptWho(p) ? " · " + ptWho(p) : ""}`}</span>`
    + `<span class="cvh-pt3">${diff}</span></button>`;
}
const whatTextPlain = (d) => whatText(d).replace(/<[^>]+>/g, "");
function rowsHtml(t) {
  return `<table class="cvh-rt"><thead><tr><th>行</th><th>今の出す値</th><th></th><th>戻すと</th></tr></thead><tbody>${t.rows.map((r) =>
    `<tr class="is-${r.kind}"><td>${r.i + 1}</td><td>${r.kind === "add" ? '<i class="cvh-none">（無い）</i>' : esc(outText(r.now ?? ""))}</td>`
    + `<td>${r.kind === "del" ? stChip("gone") : r.kind === "add" ? stChip("back") : stChip("chg")}</td>`
    + `<td>${r.kind === "del" ? '<i class="cvh-none">（行が無くなる）</i>' : esc(outText(r.then ?? ""))}</td></tr>`).join("")}</tbody></table>`;
}
function detHtml() {
  const d = hw.det, p = d && d.point;
  if (!d) return '<p class="cvh-hint">左の時点を押すと、戻すと何が変わるかをここに出します</p>';
  const ch = d.tables.filter((t) => t.st !== "same"), same = d.tables.filter((t) => t.st === "same");
  const virt = p.bundled, file = !virt, one = hw.name;
  const picks = [...hw.picks];
  const go = one ? `「${esc(one)}」をこの${virt ? "形" : "時点"}に戻す` : `選んだ ${picks.length} 表を戻す`;
  const std = d.standard && !d.standard.same ? `<p class="cvh-say cvh-stdline">全体を戻すと、標準も <b>${esc(d.standard.now)}</b> → <b>${esc(d.standard.then)}</b> に戻ります。</p>` : "";
  return `<div class="cvh-dhead"><div class="cvh-title"><b>${esc(ptTitle(p))}</b>${kindChip(p)}${virt ? "" : scopeChip(p)}<span class="cvh-note">${virt ? esc(p.why) : `${esc(p.why)}${ptWho(p) ? " · " + ptWho(p) : ""}`}</span></div>`
    + `<p class="cvh-say">この${virt ? "形" : "時点"}に戻すと: <b>${one ? (ch.length ? whatText(ch[0]) : "変わりません") : `${ch.length} 表が変わります`}</b>${one ? "（ほかの表は変えません）" : `（同じ ${same.length} 表は変わりません）`}</p>${one ? "" : std}`
    + `<div class="cvh-go"><button type="button" class="btn-primary" data-cvh-go${(one ? ch.length : picks.length) && !hw.busy ? "" : " disabled"}>${go}</button>`
    + (!one && file && p.scope === "all" ? `<button type="button" class="pv-btn" data-cvh-goall${hw.busy ? " disabled" : ""}>全体（${p.tables} 表と標準）をこの時点に戻す</button>` : "")
    + '<span class="cvh-note">戻す前の今も自動で残すので、戻した後でも取り消せます</span></div></div>'
    + `<table class="cvh-dt"><thead><tr>${one ? "" : "<th></th>"}<th>表</th><th>今</th><th>戻すと</th><th>変わる所</th><th></th></tr></thead><tbody>${ch.map((t) =>
      `<tr class="is-${t.st}">${one ? "" : `<td><input type="checkbox" data-cvh-pick="${esc(t.name)}" aria-label="「${esc(t.name)}」を戻す"${hw.picks.has(t.name) ? " checked" : ""}></td>`}`
      + `<td><b>${esc(t.name)}</b></td><td>${t.now == null ? "—" : `${t.now} 行`}</td><td>${t.then == null ? "—" : `${t.then} 行`}</td><td>${stChip(t.st)} ${whatText(t)}</td>`
      + `<td>${t.rows.length ? `<button type="button" class="cvh-lnk" data-cvb-diff="${esc(t.name)}" aria-expanded="${hw.open === t.name}">${hw.open === t.name ? "行を閉じる ▴" : "行を見る ▾"}</button>` : ""}</td></tr>`
      + (hw.open === t.name ? `<tr class="cvh-rowsx"><td colspan="${one ? 5 : 6}">${rowsHtml(t)}</td></tr>` : "")).join("")}`
    + (same.length ? `<tr class="is-same cvh-samerow"><td colspan="${one ? 5 : 6}">${stChip("same")} ${one ? "変わりません" : `変わらない ${same.length} 表: ${same.map((t) => `<span class="cvh-nb">${esc(t.name)}</span>`).join("・")}`}</td></tr>` : "")
    + "</tbody></table>";
}
/** 標準を決める前の確かめ（右の欄）: 表ごとに 今の表・戻る先（今の標準）・決めた後の戻る先 の行の数 */
function stdHtml() {
  const d = mstate.data.conv, L = hw.list || {}, now = hw.mode === "std-now";
  const items = d.items, rows = (n) => (items.find((x) => x.name === n) || { rows: [] }).rows.length;
  const tbl = hw.stdRows || [];
  const head = now ? "今の表を標準にしますか？" : "同梱のプリセットを標準にしますか？";
  const say = now ? `今の ${items.length} 表を、各表の「標準に戻す」の戻る先にします。` : "各表の「標準に戻す」の戻る先を、アプリに入っている同梱のプリセットにします。";
  return `<div class="cvh-dhead cvh-conf"><div class="cvh-title"><b>${head}</b></div><p class="cvh-say"><b>表の中身は変わりません。</b>${say}今の標準（${esc(L.standard || "")}）は時点に残すので、あとで戻せます。</p>`
    + `<div class="cvh-go"><button type="button" class="pv-btn ${now ? "" : "is-danger"}" data-cvh-std="${now ? "current" : "bundled"}"${hw.busy ? " disabled" : ""}>${now ? "今の表を標準にする" : "同梱のプリセットを標準にする"}</button><button type="button" class="pv-btn" data-cvh-stdno>やめる</button></div></div>`
    + `<table class="cvh-dt"><thead><tr><th>表</th><th>今の表</th><th>戻る先（今の標準）</th><th>決めた後の戻る先</th></tr></thead><tbody>${tbl.map((t) => {
      const after = now ? rows(t.name) : t.bundled;
      return `<tr class="${after === t.std ? "is-same" : ""}"><td><b>${esc(t.name)}</b></td><td>${rows(t.name)} 行</td><td>${t.std == null ? "—" : `${t.std} 行`}</td><td>${after == null ? "—" : `${after} 行`} ${after === t.std ? stChip("same") : stChip("chg")}</td></tr>`;
    }).join("")}</tbody></table>`;
}
async function loadStdRows() {
  // 戻る先の行の数は、同梱・標準の時点の違い（窓の答え）から読む
  const get = async (id) => { const r = await fetch(`/api/masters/conversions/history/${id}`, { cache: "no-store" }); return r.ok ? (await r.json()).tables : []; };
  const b = await get("bundled"), s = hw.list && hw.list.standardPoint ? await get("standard") : null;
  const names = new Set([...b.map((t) => t.name), ...(s || []).map((t) => t.name)]);
  hw.stdRows = [...names].map((n) => ({ name: n, bundled: (b.find((t) => t.name === n) || {}).then ?? null, std: ((s || b).find((t) => t.name === n) || {}).then ?? null }));
}
function drawHist() {
  if (!hw) return;
  let el = document.querySelector(".cvh-dlg");
  if (!el) {
    el = document.createElement("div");
    el.className = "cvh-dlg";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    document.body.append(el);
    el.addEventListener("click", histClick);
    el.addEventListener("change", (e) => { const c = e.target.closest("[data-cvh-pick]"); if (!c || !hw) return; if (c.checked) hw.picks.add(c.dataset.cvhPick); else hw.picks.delete(c.dataset.cvhPick); drawHist(); });
    document.addEventListener("keydown", histKey, true);
  }
  const L = hw.list, keepTop = el.querySelector(".cvh-right")?.scrollTop || 0, keepLeft = el.querySelector(".cvh-list")?.scrollTop || 0;
  el.setAttribute("aria-label", hw.name ? `「${hw.name}」の履歴と戻す` : "変換表の履歴と戻す");
  const pins = L ? [L.bundled, L.standardPoint].filter(Boolean) : [];
  el.innerHTML = `<div class="cvh-card"><div class="cvh-head"><b>${hw.name ? `「${esc(hw.name)}」の履歴と戻す` : "変換表の履歴と戻す"}</b><span class="cvh-note">開発者・メンテナンス者だけ</span><span class="sp"></span><button type="button" class="pv-btn" data-cvb-close>閉じる</button></div>`
    + `<div class="cvh-std"><p><b>戻せる時点</b>は、変換表を書くたびに自動で残した書く前の形（新しい ${L ? L.keep.auto : 50} 回分）・手で取ったバックアップ・同梱のプリセットです。`
    + `<b>標準</b>は各表の「標準に戻す」の戻る先で 1 つだけ（いま: <b>${esc((L && L.standard) || "")}</b>）。バックアップを取っても標準は変わりません。</p>`
    + `<span class="cvh-stdbtns"><button type="button" class="pv-btn" data-cvh-stdnow>今の表を標準にする…</button><button type="button" class="pv-btn" data-cvb-bundled>同梱のプリセットを標準にする…</button></span></div>`
    + (hw.msg ? `<div class="ps-result ${hw.msg[0]} cvh-msg" aria-live="polite">${hw.msg[1]}</div>` : "")
    + (hw.name ? `<div class="cvh-filter">「${esc(hw.name)}」を含む時点だけを出しています <button type="button" class="cvh-lnk" data-cvh-all>全部の表の時点 ›</button></div>` : "")
    + `<div class="cvh-two"><aside class="cvh-left"><div class="cvh-pins">${pins.map(ptCard).join("")}</div>`
    + `<div class="cvh-mk"><button type="button" class="pv-btn" data-cvh-mk="all">＋ 全体をバックアップ</button>${hw.name ? `<button type="button" class="pv-btn" data-cvh-mk="one">＋ この表だけ</button>` : ""}</div>`
    + `<div class="cvh-h">戻せる時点（新しい順）${L && L.unreadable ? `<small>（読めない時点 ${L.unreadable} は飛ばしました）</small>` : ""}</div>`
    + `<div class="cvh-list">${L ? (L.points.length ? L.points.map(ptCard).join("") : '<p class="cvh-hint">まだありません。変換表を書くと、書く前の形がここに残ります</p>') : '<p class="cvh-hint">読んでいます…</p>'}</div></aside>`
    + `<section class="cvh-right">${hw.mode === "diff" ? detHtml() : stdHtml()}</section></div></div>`;
  const r = el.querySelector(".cvh-right"); if (r) r.scrollTop = keepTop;
  const l = el.querySelector(".cvh-list"); if (l) l.scrollTop = keepLeft;
}
async function histClick(e) {
  const b = e.target.closest("button"); if (!b || b.disabled || !hw) return;
  const ds = b.dataset;
  if (ds.cvbClose != null) { closeHist(); return; }
  if (ds.cvhAll != null) { hw.name = null; hw.msg = null; await reloadHist(hw.sel); return; }
  if (ds.cvhPt) { hw.sel = ds.cvhPt; hw.mode = "diff"; hw.msg = null; drawHist(); await loadDet(); return; }
  if (ds.cvbDiff != null) { hw.open = hw.open === ds.cvbDiff ? null : ds.cvbDiff; drawHist(); return; }
  if (ds.cvhStdnow != null || ds.cvbBundled != null) { hw.mode = ds.cvhStdnow != null ? "std-now" : "std-bundled"; hw.msg = null; await loadStdRows(); drawHist(); return; }
  if (ds.cvhStdno != null) { hw.mode = "diff"; drawHist(); return; }
  if (ds.cvhMk) {
    const names = ds.cvhMk === "one" && hw.name ? [hw.name] : null;
    hw.busy = true; drawHist();
    const r = await fetch("/api/masters/conversions/history", TPA.json("POST", { names, why: names ? `「${hw.name}」を手で残した形` : "手で取った全体のバックアップ" }));
    const d = await r.json().catch(() => ({}));
    hw.busy = false;
    hw.msg = r.ok ? ["ok", `✓ ${names ? `「${esc(hw.name)}」` : `全体（${(mstate.data.conv.items || []).length} 表）`}をバックアップしました（時点 ${esc(shortAt((d.history.points || []).find((p) => p.id === d.created)?.at))}）`] : ["ng", `✕ ${esc(d.error || "バックアップを残せませんでした")}`];
    loadHist().then(() => keepView(paint));
    await reloadHist(hw.sel); return;
  }
  if (ds.cvhStd) {
    hw.busy = true; drawHist();
    const res = await masterRequest("/api/masters/conversions/defaults", TPA.json("POST", { from: ds.cvhStd }));
    hw.busy = false;
    if (!(await after(res, ds.cvhStd === "current" ? "✓ 今の表を標準にしました（前の標準は時点に残しました）" : "✓ 標準を同梱のプリセットにしました（表の中身は変えていません。前の標準は時点に残しました）"))) { hw.msg = notice; drawHist(); return; }
    hw.msg = notice; hw.mode = "diff"; paint(); loadHist();
    await reloadHist(hw.sel); return;
  }
  if (ds.cvhGo != null || ds.cvhGoall != null || ds.cvhUndo != null) {
    const all = ds.cvhGoall != null || (ds.cvhUndo != null && ds.cvhAllundo === "1");
    const id = ds.cvhUndo != null ? ds.cvhUndo : hw.sel;
    const names = ds.cvhUndo != null ? JSON.parse(ds.cvhNames || "[]") : hw.name ? [hw.name] : [...hw.picks];
    const p = hw.det && hw.det.point, label = ds.cvhUndo != null ? "戻す前の形" : `${ptTitle(p)}${p.bundled ? "" : " の形"}`;
    hw.busy = true; drawHist();
    const body = all ? { all: true } : { names };
    if (ds.cvhUndo == null && hw.det) body.revision = hw.det.revision;
    const res = await masterRequest(`/api/masters/conversions/history/${encodeURIComponent(id)}/restore`, TPA.json("POST", body));
    hw.busy = false;
    if (!(await after(res, `✓ ${all ? "全体" : `${res.data && res.data.restored} 表`}を${esc(label)}に戻しました`))) { hw.msg = notice; drawHist(); return; }
    const before = res.data.before;
    hw.msg = ["ok", `✓ ${all ? "全体" : names.map((n) => `「${esc(n)}」`).join("")}を${esc(label)}に戻しました。戻す前の形も時点に残しました`
      + (before && ds.cvhUndo == null ? ` <button type="button" class="pv-btn" data-cvh-undo="${esc(before)}" data-cvh-names="${esc(JSON.stringify(names))}" data-cvh-allundo="${all ? 1 : 0}">元に戻す</button>` : "")];
    const at = draft && draft.name;
    draft = clone(res.data.items.find((y) => y.name === at) || res.data.items[0] || blank()); cell = null; tryVals = []; savedAt = null;
    paint(); loadHist().then(() => keepView(paint));
    await reloadHist(hw.sel);
  }
}
};
