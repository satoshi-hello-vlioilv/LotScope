/* マスタ管理の「変換表」（版 3.42.0。services/conversions.py・routes/conversions.py。決め方: ui-proposals/2026-10-conv*）。
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
}

/* ---------------- 描く ---------------- */
function listHtml(d) {
  const groups = [["replace", "コードの読み替え（列の値を作り替える）"], ["add", "判定して列を足す"]];
  return groups.map(([m, title]) => {
    const xs = d.items.filter((x) => ((x.apply || {}).mode === "replace" ? "replace" : "add") === m);
    if (!xs.length) return "";
    return `<div class="cv-lgrp">${title}</div>` + xs.map((x) => `<button type="button" class="sh-item${draft && x.id === draft.id ? " is-on" : ""}" data-cv-pick="${x.id}">`
      + `<b>${esc(x.name)}</b><small>${esc(window.Conversions ? window.Conversions.summary(x) : "")}</small></button>`).join("");
  }).join("") + (can() ? '<button type="button" class="sh-new" data-cv-new>＋ 変換表を足す</button>' : "") + ioHtml(d);
}
/* 書き出す・取り込む・標準（版 3.43.0）。標準は「標準に戻す」で戻る中身。取り込んだ表を標準にでき、同梱のプリセットへも戻せる */
function ioHtml(d) {
  const w = can();
  return `<div class="cv-io"><div class="cv-iorow"><button type="button" class="pv-btn" data-cv-export title="今の変換表をすべて、1 つのファイル（JSON）に書き出します">↓ 書き出す</button>`
    + (w ? '<button type="button" class="pv-btn" data-cv-import title="書き出したファイルを読み、同じ名前の表は置き換え、無い名前は足します（読む前に中身を見せます）">↑ 取り込む…</button>' : "") + "</div>"
    + `<div class="cv-std"><span>標準: <b>${d.customDefaults ? "取り込んだ表" : "同梱のプリセット"}</b></span>`
    + (w ? '<button type="button" class="cv-link" data-cv-stdnow title="今の表をすべて標準にします（「標準に戻す」でこの中身へ戻ります）">今の表を標準に</button>'
      + (d.customDefaults ? '<button type="button" class="cv-link" data-cv-stdbundled title="標準を、アプリに同梱のプリセットへ戻します">同梱に戻す</button>' : "") : "")
    + "</div></div>";
}
function gridHtml(x) {
  const d = dis();
  // 出す値は番号の次（いちばん大事な列を、表が横に長くても切らない。2026-10-conv の 2 回目）
  const head = `<tr><th class="cv-no"></th><th>出す値</th>${x.inputs.map((inp) => `<th>${esc(inp.name)}${inp.type === "num" ? ' <small>数</small>' : ""}</th>`).join("")}<th class="cv-ra"></th></tr>`;
  const outTd = (r, i) => `<td class="cv-out"><input class="ps-input" data-cv-out="${i}" value="${esc(r.out)}" placeholder="（空欄）" title="${esc(r.out)}" aria-label="${i + 1} 行目の出す値"${d}></td>`;
  const rows = x.rows.map((r, i) => `<tr data-r="${i}"${cell && cell.r === i ? ' class="is-cell"' : ""}><td class="cv-no">${i + 1}</td>${outTd(r, i)}`
    + x.inputs.map((inp) => {
      const ts = (r.when || {})[inp.name] || [], on = cell && cell.r === i && cell.k === inp.name;
      return `<td class="cv-cond${on ? " is-on" : ""}"><button type="button" class="cv-cbtn" data-cv-cell="${i}|${esc(inp.name)}" title="押すと、この条件を直します（並べた条件は「または」）"${d}>`
        + chipsHtml(ts) + "</button></td>";
    }).join("")
    + `<td class="cv-ra"><button type="button" class="icon-btn" data-cv-up="${i}" title="上へ" aria-label="${i + 1} 行目を上へ"${d}>↑</button>`
    + `<button type="button" class="icon-btn" data-cv-down="${i}" title="下へ" aria-label="${i + 1} 行目を下へ"${d}>↓</button>`
    + `<button type="button" class="icon-btn" data-cv-rdel="${i}" title="この行を消す" aria-label="${i + 1} 行目を消す"${d}>×</button></td></tr>`
    + (cell && cell.r === i ? `<tr class="cv-edrow"><td></td><td colspan="${x.inputs.length + 2}">${cellEditor(x, i, cell.k)}</td></tr>` : "")).join("");
  return `<div class="cv-gridwrap"><table class="cv-grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
/** セルの札（並べた条件は「または」。条件が無ければ不問の –） */
function chipsHtml(ts) {
  return ts.length ? ts.map((t, k) => (k ? '<small class="cv-or">または</small>' : "") + `<span class="cv-c">${esc(testText(t))}</span>`).join("") : '<span class="cv-any" title="不問（この入力は見ません）">–</span>';
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
    + opSel(t, j) + `<button type="button" class="icon-btn" data-cv-tdel="${j}" title="この条件を外す" aria-label="この条件を外す">×</button></div>`).join("");
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
      <aside class="sh-list" aria-label="登録済みの変換表"><div class="sh-list-head">登録済みの変換表</div>${listHtml(d)}</aside>
      <div class="sh-detail cv-detail">
        <div class="cv-top"><input class="ps-input cv-name" id="cvName" value="${esc(x.name)}" placeholder="変換表の名前（例: 地取区分）" aria-label="変換表の名前"${di}>
          ${preset ? '<span class="cv-tag">プリセット</span>' : x.id ? "" : '<span class="cv-tag">新しい表</span>'}<span class="sp"></span>
          ${can() && preset ? '<button type="button" class="pv-btn" data-cv-reset title="同梱のプリセットの中身に戻します">標準に戻す</button>' : ""}
          ${can() && x.id ? '<button type="button" class="pz-btn danger" data-cv-delete>この表を消す</button>' : ""}
          ${can() ? `<button type="button" class="btn-primary" data-cv-save>${x.id ? "保存" : "足す"}</button>` : ""}</div>
        <div class="cv-meta">
          <label>当て方<select class="ps-input" id="cvMode"${di}><option value="replace"${a.mode === "replace" ? " selected" : ""}>列の値を作り替える</option><option value="add"${a.mode !== "replace" ? " selected" : ""}>列を足す</option></select></label>
          ${a.mode === "replace" ? "" : `<label>足す列の名前<input class="ps-input" id="cvCol" value="${esc(a.column || "")}" placeholder="${esc(x.name || "例: 管理分類")}（{列} は元の列の名前）"${di}></label>
          <label>置き場<select class="ps-input" id="cvPlace"${di}>${[["left", "いちばん左"], ["after", "元の列の右"], ["end", "右の端"]].map(([k, n]) => `<option value="${k}"${(a.place || "end") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>`}
          <label>どれにも当たらないとき<select class="ps-input" id="cvOtherKind"${di}>${[["keep", "元の値のまま"], ["blank", "空欄"], ["text", "字を出す"], ["formula", "式"]].map(([k, n]) => `<option value="${k}"${ok === k ? " selected" : ""}>${n}</option>`).join("")}</select>
            ${ok === "text" || ok === "formula" ? `<input class="ps-input" id="cvOther" value="${esc(ok === "formula" ? String(x.other).slice(1) : x.other)}" aria-label="どれにも当たらないときの値"${di}>` : ""}</label>
        </div>
        <div class="cv-ins"><span class="cv-lab">入力</span>${x.inputs.map((inp, i) => `<span class="cv-in">`
          + `<input class="ps-input" data-cv-iname="${i}" value="${esc(inp.name)}" aria-label="入力の名前"${di}>`
          + `<select class="ps-input" data-cv-itype="${i}" aria-label="比べ方（字・数）"${di}><option value="text"${inp.type !== "num" ? " selected" : ""}>字</option><option value="num"${inp.type === "num" ? " selected" : ""}>数</option></select>`
          + colsBtn(inp, i, di)
          + (x.inputs.length > 1 ? `<button type="button" class="icon-btn" data-cv-idel="${i}" title="この入力を外す（行の条件からも外します）" aria-label="入力を外す"${di}>×</button>` : "") + "</span>").join("")}
          ${x.inputs.length < 8 ? `<button type="button" class="pv-btn" data-cv-iadd${di}>＋ 入力</button>` : ""}</div>
        ${gridHtml(x)}
        <div class="cv-foot2">${can() ? '<button type="button" class="pv-btn" data-cv-radd>＋ 行を足す</button>' : ""}<span class="cv-other">どれにも当たらないとき → <b>${esc(otherText(x))}</b></span>
          <span class="sp"></span>${expr ? `<code class="cv-expr" title="一覧の式ではこう書きます（表示列の「この列の作り方」でも）">${esc(expr)}</code>` : ""}</div>
        ${tryHtml(x)}
      </div></div></section>`;
  bind();
  fitGrid();
}
/** 取り込む前の確かめ: どの表を置き換え・足すか。標準にもするかは押すボタンで選ぶ */
function importHtml(d) {
  const have = new Set(d.items.map((x) => x.name)), rep = incoming.filter((x) => have.has(x.name)), add = incoming.filter((x) => !have.has(x.name));
  const names = (xs) => xs.map((x) => `「${esc(x.name)}」`).join("");
  return `<div class="cv-imp" role="group" aria-label="取り込む前の確かめ"><b>${incoming.length} 表を取り込みます</b>`
    + (rep.length ? `<div><span class="cv-imptag rep">置き換え ${rep.length}</span>${names(rep)}</div>` : "")
    + (add.length ? `<div><span class="cv-imptag add">足す ${add.length}</span>${names(add)}</div>` : "")
    + '<div class="cv-impbtns"><button type="button" class="btn-primary" data-cv-impgo>取り込む</button>'
    + '<button type="button" class="pv-btn" data-cv-impstd title="取り込んだ表を、「標準に戻す」で戻る中身にもします">取り込んで標準にもする</button>'
    + '<button type="button" class="pv-btn" data-cv-impno>やめる</button></div></div>';
}
/* 判定表は表の中だけを横に送る。送れる先があれば右に影（is-more）・セルを直す欄は見えている幅に収める */
function fitGrid() {
  const w = $("#masterSettings .cv-gridwrap"); if (!w) return;
  const mark = () => w.classList.toggle("is-more", w.scrollLeft + w.clientWidth < w.scrollWidth - 2);
  w.addEventListener("scroll", mark, { passive: true }); mark();
  const ed = w.querySelector(".cv-celled"); if (ed) ed.style.width = `${Math.max(320, w.clientWidth - 44)}px`;
}

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
/** 面を札の下に、マスタ管理の窓の中へ収めて置く（窓の右端・下端から出さない。1 回目の採点: 窓の右へ 130px 出ていた） */
function place(el, anchor) {
  const box = (document.querySelector("#masterOverlay .master-panel") || document.body).getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const w = Math.min(820, box.width - 24), top = Math.round(r.bottom + 6);
  el.style.width = `${w}px`;
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
    incoming = items; notice = null; paint(); return;
  }
  if (ds.cvImpno != null) { incoming = null; paint(); return; }
  if (ds.cvImpgo != null || ds.cvImpstd != null) {
    const res = await withLockWait(() => masterRequest("/api/masters/conversions/import", TPA.json("POST", { items: incoming, asDefault: ds.cvImpstd != null })),
      (r) => say("wait", lockWaitText(r, "取り込み", boldName)));
    if (!res.ok) { say("ng", "✕ " + esc(res.data.error || "取り込めませんでした。")); return; }
    incoming = null;
    const at = draft && draft.name;
    if (!(await after(res, `✓ 取り込みました（置き換え ${res.data.replaced}・足す ${res.data.added}）${ds.cvImpstd != null ? "。標準にもしました" : ""}`))) return;
    draft = clone(res.data.items.find((y) => y.name === at) || res.data.items[0]); cell = null; tryVals = []; paint(); return;
  }
  if (ds.cvStdnow != null || ds.cvStdbundled != null) {
    const now = ds.cvStdnow != null;
    if (!confirm(now ? "今の変換表をすべて標準にします（「標準に戻す」でこの中身へ戻ります）。よろしいですか？" : "標準を、アプリに同梱のプリセットへ戻します。よろしいですか？")) return;
    const res = await masterRequest("/api/masters/conversions/defaults", TPA.json("POST", { from: now ? "current" : "bundled" }));
    if (await after(res, now ? "✓ 今の表を標準にしました" : "✓ 標準を同梱のプリセットに戻しました")) paint();
  }
}
function bind() {
  $("#masterSettings .cv-page").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const ds = b.dataset;
    if (["cvExport", "cvImport", "cvImpno", "cvImpgo", "cvImpstd", "cvStdnow", "cvStdbundled"].some((k) => ds[k] != null)) { e.stopPropagation(); io(ds); }
  }, true);
  const box = $("#masterSettings .cv-editor"), x = draft;
  const redraw = () => soon(() => { if (draft !== x || !$("#masterSettings .cv-editor")) return; sync(); keepView(paint); });
  box.addEventListener("change", (e) => {
    const t = e.target, ds = t.dataset;
    if (ds.cvIname != null) { renameInput(+ds.cvIname, t.value.trim()); redraw(); return; }
    if (ds.cvItype != null) { x.inputs[+ds.cvItype].type = t.value; redraw(); return; }
    if (ds.cvOut != null) { x.rows[+ds.cvOut].out = t.value; t.title = t.value; return; }
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
      keepView(paint); return; }
    if (ds.cvClose != null) { cleanCell(); cell = null; keepView(paint); return; }
    if (ds.cvTany != null) { delete x.rows[cell.r].when[cell.k]; cell = null; keepView(paint); return; }
    if (ds.cvTadd != null) { x.rows[cell.r].when[cell.k].push({ op: "eq", v: [""] }); keepView(paint); return; }
    if (ds.cvTdel != null) { x.rows[cell.r].when[cell.k].splice(+ds.cvTdel, 1); if (!x.rows[cell.r].when[cell.k].length) delete x.rows[cell.r].when[cell.k]; keepView(paint); return; }
    if (ds.cvRadd != null) { cleanCell(); x.rows.push({ when: {}, out: "" }); cell = null; keepView(paint); return; }
    if (ds.cvRdel != null) { x.rows.splice(+ds.cvRdel, 1); cell = null; keepView(paint); return; }
    if (ds.cvUp != null || ds.cvDown != null) {
      const i = +(ds.cvUp ?? ds.cvDown), j = ds.cvUp != null ? i - 1 : i + 1;
      if (j < 0 || j >= x.rows.length) return;
      [x.rows[i], x.rows[j]] = [x.rows[j], x.rows[i]]; cell = null; keepView(paint); return;
    }
    if (ds.cvIadd != null) { let n = "入力" + (x.inputs.length + 1); while (x.inputs.some((a) => a.name === n)) n += "'"; x.inputs.push({ name: n, type: "text", columns: [] }); keepView(paint); return; }
    if (ds.cvIdel != null) { const old = x.inputs.splice(+ds.cvIdel, 1)[0]; x.rows.forEach((r) => { if (r.when) delete r.when[old.name]; }); cell = null; keepView(paint); return; }
    if (ds.cvCols != null) { openCols(+ds.cvCols, b); return; }
    if (ds.cvSave != null) { await save(); return; }
    if (ds.cvReset != null) { await reset(); return; }
    if (ds.cvDelete != null) { await remove(); }
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
  if (!(await after(res, `✓ 「${esc(x.name)}」を保存しました（${x.rows.length} 行）。この PC の一覧にすぐ効き、ほかの PC には数秒で届きます`))) return;
  const id = x.id || res.data.created;
  draft = clone(res.data.items.find((y) => y.id === id) || x); paint();
}
async function reset() {
  const x = draft;
  if (!confirm(`変換表「${x.name}」を、同梱のプリセットの中身に戻します。直した所は消えます。よろしいですか？`)) return;
  const res = await masterRequest(`/api/masters/conversions/${x.id}/preset`, TPA.json("POST", { base_rev: x.rev }));
  if (!(await after(res, `✓ 「${esc(x.name)}」を標準（プリセット）に戻しました`))) return;
  draft = clone(res.data.items.find((y) => y.id === x.id)); tryVals = []; paint();
}
async function remove() {
  const x = draft;
  if (!confirm(`変換表「${x.name}」を消します。この表を使う列（conv('${x.name}', …)）は空になります。よろしいですか？`)) return;
  const res = await masterRequest(`/api/masters/conversions/${x.id}?rev=${x.rev}`, { method: "DELETE" });
  if (!(await after(res, `✓ 「${esc(x.name)}」を消しました`))) return;
  draft = res.data.items[0] ? clone(res.data.items[0]) : blank(); paint();
}
};
