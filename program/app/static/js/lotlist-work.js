/* =========================================================================
   作業実績の「作業でまとめる」（日ごと・日＋直ごとのロット数）
   - 作業開始（既定の列 BOX実績_作業開始_日付）が同じ行は、その工程で幅・丈で分割したロット。1 作業＝1 ロットと数える
     （数え方・日・直の決め方はサーバーの 1 か所: services/work_summary.py・shifts.py。ここは受け取った数を描くだけ）。
   - 形は 7 案＋2 回目で選んだ（program/tools/ui-proposals/2026-10-workcount*.mjs・.json）:
       件数の行に「まとめない｜日ごと｜日＋直ごと」の切り替え → 一覧は作業開始の新しい順で、分割した行を 1 行に畳む（「＋n」で開く）
       一覧の右に日×直の表（帯）。日・直の数を押すと、一覧をその日・直に絞る（数の帯は絞らない＝ほかの日もすぐ押せる）
   - 日付は現場歴（日を跨ぐ直の跨いだ後を前の日に数える。WaveLog と同じ）と太陽暦を選べる（跨ぐ直があるときだけ選び口を出す）
   - 覚えは範囲（設備と表）ごとにこの PC: まとめ方・日付の数え方・並び・作業開始の列。押した日・直はその場だけ
   一覧（lotlist.js）とは mount の引数だけでつながる: scope・isWork・reload・toast・openMaster
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const KEY = "tpa.worklog.count.v1";
  const MODES = [["none", "まとめない", "1 行ずつ並べます（今までどおり）"],
    ["day", "日ごと", "作業開始が同じ行（分割したロット）を 1 ロットと数え、日ごとのロット数を右に出します"],
    ["dayshift", "日＋直ごと", "作業開始が同じ行（分割したロット）を 1 ロットと数え、日と直ごとのロット数を右に出します"]];
  const BASIS = { work: ["現場歴", "日を跨ぐ直（3直など）の跨いだ後を、前の日として数えます（勤務体系の「日付の数え方」）。1 回の直が 2 日に割れません"],
    cal: ["太陽暦", "暦の日付のまま数えます（日を跨ぐ直は 2 日に割れます）"] };
  const OUTSIDE = -1, NO_TIME = -2;
  const WD = "日月火水木金土";
  let host = null, work = null;
  const picks = {};             // 範囲 → {day, shift}（押した日・直。その場だけ）

  /* ---- 覚え ---- */
  const all = () => TPA.local.get(KEY, {});
  const conf = () => Object.assign({ mode: "none", basis: "work", order: "desc", start: "" }, all()[host.scope()] || {});
  function setConf(patch) { const a = all(); a[host.scope()] = Object.assign(conf(), patch); TPA.local.set(KEY, a); }
  const pick = () => picks[host.scope()] || null;
  const on = () => !!host && host.isWork() && conf().mode !== "none";

  /** 一覧の問い合わせに足す引数（まとめないときは無し） */
  function params() {
    if (!on()) return {};
    const c = conf(), p = pick(), q = { work: "1", basis: c.basis, order: c.order };
    if (c.start) q.start = c.start;
    if (p) { q.day = p.day || "-"; if (p.shift != null) q.shift = String(p.shift); }
    return q;
  }

  /* ---- 字 ---- */
  /** 'YYYY-MM-DD' → 9/29(火)（long は 2026/09/29(火)）。new Date('YYYY-MM-DD') は UTC で読まれ日がずれるので、字のまま組む */
  function dayText(d, long) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
    if (!m) return "日付なし";
    const w = WD[new Date(+m[1], m[2] - 1, +m[3]).getDay()];
    return long ? `${m[1]}/${m[2]}/${m[3]}(${w})` : `${+m[2]}/${+m[3]}(${w})`;
  }
  const shiftName = (i) => (i >= 0 ? (work.shifts[i] || {}).name || `直${i + 1}` : i === NO_TIME ? "時刻なし" : work.shifts.length ? "直の外" : "");
  const shiftTip = (i) => (i >= 0 ? (() => { const s = work.shifts[i]; return `${s.name} ${s.start}〜${s.crosses ? "翌" : ""}${s.end}`; })()
    : i === NO_TIME ? "作業開始に時刻が無い（日付だけの）作業。直を決められません" : "作業開始の時刻が、どの直の時間帯にも入らない作業（直の間の空き時間など）");
  const pickText = (p) => `${p.day ? dayText(p.day) : "日付なし"}${p.shift != null && conf().mode === "dayshift" ? " " + shiftName(p.shift) : ""}`;

  /* ---- 件数の行の切り替えと、押した日・直の札 ---- */
  function paintSwitch() {
    const box = $("#llWorkSwitch"); if (!box) return;
    box.hidden = !host.isWork();
    if (box.hidden) return;
    const m = conf().mode, p = on() ? pick() : null;
    box.innerHTML = `<span class="wk-seg" role="radiogroup" aria-label="作業でまとめる">${MODES.map(([k, txt, tip]) =>
      `<button type="button" role="radio" aria-checked="${k === m}" data-wk-mode="${k}" title="${esc(tip)}">${txt}</button>`).join("")}</span>`
      + (p ? `<button type="button" class="wk-pickchip" data-wk-unpick title="押すと絞り込みを外し、全部の日に戻します">${esc(pickText(p))}に絞り込み中<b aria-hidden="true">×</b></button>` : "");
  }

  /* ---- 右の帯（日×直の表） ---- */
  function pivot() {
    const days = [], by = {};
    work.buckets.forEach((b) => { if (!(b.day in by)) { by[b.day] = {}; days.push(b.day); } by[b.day][b.shift] = b; });
    const ds = conf().mode === "dayshift" && work.shifts.length;
    const extra = [OUTSIDE, NO_TIME].filter((i) => work.buckets.some((b) => b.shift === i));
    return { days, by, cols: ds ? work.shifts.map((_, i) => i).concat(extra) : [] };
  }
  const sum = (list, k) => list.reduce((a, b) => a + (b ? b[k] : 0), 0);
  function cellTip(day, list) {
    const n = sum(list, "works"), r = sum(list, "rows"), s = sum(list, "split");
    return `${n}ロット（${r}行${s ? `・うち分割した作業 ${s}` : ""}）`;
  }
  function tableHtml() {
    const P = pivot(), c = conf(), p = pick(), basis = BASIS[c.basis] || BASIS.work;
    const max = Math.max(1, ...work.buckets.filter((b) => b.day).map((b) => (P.cols.length ? b.works : sum(Object.values(P.by[b.day]), "works"))));
    const tint = (n) => ` style="--wk-a:${(n / max).toFixed(2)}"`;
    const sel = (d, s) => p && p.day === d && (s === undefined ? p.shift == null : p.shift === s);
    const head = `<tr><th scope="col" class="wk-dh" title="${esc(basis[1])}">日<small>（${basis[0]}）</small></th>`
      + P.cols.map((i) => `<th scope="col" class="wk-s wk-s${i >= 0 ? i % 6 : "x"}" title="${esc(shiftTip(i))}">${esc(shiftName(i))}</th>`).join("")
      + `<th scope="col" class="wk-tot">${P.cols.length ? "計" : "ロット"}</th>${P.cols.length ? "" : '<th scope="col" class="wk-rows" title="登録の行の数（分割したロットも 1 行ずつ）">行</th>'}</tr>`;
    const totals = `<tr class="wk-sum"><th scope="row">合計<small>${P.days.length}日</small></th>`
      + P.cols.map((i) => { const l = work.buckets.filter((b) => b.shift === i); return `<td title="${esc(shiftName(i))} の合計 ${cellTip("", l)}">${sum(l, "works")}</td>`; }).join("")
      + `<td class="wk-tot" title="${esc(cellTip("", work.buckets))}">${work.total.works}</td>${P.cols.length ? "" : `<td class="wk-rows">${work.total.rows}</td>`}</tr>`;
    const rows = P.days.map((d) => {
      const list = Object.values(P.by[d]), n = sum(list, "works"), dkey = esc(d || "-");
      return `<tr${sel(d) ? ' class="is-pick"' : ""}><th scope="row"><button type="button" data-wk-day="${dkey}" title="${esc(dayText(d, true))}: ${esc(cellTip(d, list))}\n押すと、一覧をこの日に絞ります">${esc(dayText(d))}</button></th>`
        + P.cols.map((i) => {
          const b = P.by[d][i];
          if (!b) return '<td class="wk-0">–</td>';
          return `<td${tint(b.works)}${sel(d, i) ? ' class="is-pick"' : ""}><button type="button" data-wk-day="${dkey}" data-wk-shift="${i}" title="${esc(dayText(d, true))} ${esc(shiftName(i))}: ${esc(cellTip(d, [b]))}\n押すと、一覧をこの日・直に絞ります">${b.works}</button></td>`;
        }).join("")
        + `<td class="wk-tot"${P.cols.length ? "" : tint(n)}>${n}</td>${P.cols.length ? "" : `<td class="wk-rows">${sum(list, "rows")}</td>`}</tr>`;
    }).join("");
    return `<table class="wk-pv"><thead>${head}${totals}</thead><tbody>${rows || `<tr><td colspan="${P.cols.length + 3}" class="wk-none">当たる作業がありません</td></tr>`}</tbody></table>`;
  }
  /** 帯の上の案内（直が決まっていない・時刻が無い・作業開始が読めない） */
  function notesHtml() {
    const out = [], t = work.total, c = conf();
    if (c.mode === "dayshift" && !work.shifts.length) {
      out.push(`<div class="wk-note is-ask"><b>直の時間帯（勤務体系）がまだ決まっていません。</b>日ごとの数だけを出しています。`
        + (work.canEditShifts ? `<span class="wk-acts"><button type="button" class="btn-primary" data-wk-template="1">交替勤務(1,2,3直)を全設備に当てる</button>`
          + '<button type="button" data-wk-master>マスタ管理で決める…</button></span>'
          : '<small>マスタ管理の「勤務体系」で、マスタを書ける人が決めます。</small>') + "</div>");
    }
    if (c.mode === "dayshift" && work.shifts.length && t.noTime) out.push(`<div class="wk-note">時刻の無い作業が ${t.noTime} あります（直を決められないので「時刻なし」に数えました）。</div>`);
    if (t.noStamp) out.push(`<div class="wk-note">作業開始が空か日時と読めない行が ${t.noStamp} あります（空の行は 1 行ずつ、同じ字の行は 1 作業と数えました）。</div>`);
    return out.join("");
  }
  function startPick() {
    const cand = Array.from(new Set([work.column, ...(work.candidates || [])].filter(Boolean)));
    return `<label class="wk-start" title="この列の値が同じ行を 1 作業（1 ロット）と数えます。日・直もこの列の日時で決めます${work.timeColumn ? `\n時刻は「${work.timeColumn}」から読みます` : ""}">作業開始の列`
      + `<select data-wk-start>${work.column ? "" : '<option value="">選んでください…</option>'}${cand.map((x) => `<option value="${esc(x)}"${x === work.column ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>`;
  }
  function paintPane() {
    const pane = $("#llWork"); if (!pane) return;
    pane.hidden = !on() || !work;
    if (pane.hidden) return;
    const c = conf(), crosses = work.shifts.some((s) => s.crosses);
    const order = `<button type="button" class="wk-order" data-wk-order title="作業開始の${c.order === "desc" ? "新しい順です。押すと古い順" : "古い順です。押すと新しい順"}にします（一覧と表の両方）">${c.order === "desc" ? "新しい順 ▼" : "古い順 ▲"}</button>`;
    const basis = crosses ? `<span class="wk-seg sm" role="radiogroup" aria-label="日付の数え方">${Object.entries(BASIS).map(([k, [txt, tip]]) =>
      `<button type="button" role="radio" aria-checked="${k === c.basis}" data-wk-basis="${k}" title="${esc(tip)}">${txt}</button>`).join("")}</span>` : "";
    if (!work.column) {
      pane.innerHTML = `<h3 class="wk-title">日・直ごとのロット数</h3><div class="wk-note is-ask"><b>作業開始の列が見つかりません。</b>`
        + `同じ作業と見る日時の列（例: BOX実績_作業開始_日付）を選んでください。</div>${startPick()}`;
      return;
    }
    pane.innerHTML = `<div class="wk-head"><h3 class="wk-title">${c.mode === "dayshift" && work.shifts.length ? "日・直" : "日"}ごとのロット数</h3>${order}</div>`
      + `<p class="wk-sub">分割したロット（作業開始が同じ行）は 1 と数えます。数を押すと一覧をその日${c.mode === "dayshift" && work.shifts.length ? "・直" : ""}に絞ります。</p>`
      + (work.pattern && c.mode === "dayshift" ? `<div class="wk-meta"><span title="この設備で使う勤務体系（マスタ管理の「勤務体系」）">直: <b>${esc(work.pattern.name)}</b></span>${basis}</div>`
        : crosses ? `<div class="wk-meta">${basis}</div>` : "")
      + notesHtml() + `<div class="wk-table">${tableHtml()}</div>` + startPick();
  }

  /* ---- 操作 ---- */
  function choose(patch, { keepPick = false } = {}) {
    setConf(patch);
    if (!keepPick) delete picks[host.scope()];
    paintSwitch();
    host.reload();
  }
  function setPick(day, shift) {
    const p = pick(), same = p && p.day === day && p.shift === shift;
    if (same) delete picks[host.scope()]; else picks[host.scope()] = { day, shift };
    paintSwitch(); host.reload();
  }
  async function applyTemplate() {
    const r = await fetch("/api/masters/shifts", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    const t = r && (r.templates || []).find((x) => x.label === "交替勤務(1,2,3直)");
    if (!t) { host.toast("テンプレートを読めませんでした"); return; }
    const res = await fetch("/api/masters/shifts", TPA.json("POST", { name: t.label, segments: t.segments }));
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { host.toast("勤務体系を置けませんでした: " + (d.error || res.status)); return; }
    host.toast("交替勤務(1,2,3直)を全設備に当てました（マスタ管理の「勤務体系」で直せます）");
    host.reload();
  }
  function bind() {
    $("#llWorkSwitch")?.addEventListener("click", (e) => {
      const m = e.target.closest("[data-wk-mode]");
      if (m) { if (m.dataset.wkMode !== conf().mode) choose({ mode: m.dataset.wkMode }); return; }
      if (e.target.closest("[data-wk-unpick]")) { delete picks[host.scope()]; paintSwitch(); host.reload(); }
    });
    const pane = $("#llWork");
    pane?.addEventListener("click", (e) => {
      const d = e.target.closest("[data-wk-day]");
      if (d) { const day = d.dataset.wkDay === "-" ? "" : d.dataset.wkDay; setPick(day, d.dataset.wkShift != null ? +d.dataset.wkShift : null); return; }
      const b = e.target.closest("[data-wk-basis]");
      if (b) { if (b.dataset.wkBasis !== conf().basis) choose({ basis: b.dataset.wkBasis }); return; }
      if (e.target.closest("[data-wk-order]")) { choose({ order: conf().order === "desc" ? "asc" : "desc" }, { keepPick: true }); return; }
      if (e.target.closest("[data-wk-template]")) { applyTemplate(); return; }
      if (e.target.closest("[data-wk-master]")) host.openMaster("shifts");
    });
    pane?.addEventListener("change", (e) => { if (e.target.matches("[data-wk-start]")) choose({ start: e.target.value }); });
  }

  /* ---- 一覧から ---- */
  function update(w) { work = on() ? w || null : null; paintSwitch(); paintPane(); }
  function mount(h) {
    host = h; bind();
    // マスタ管理で勤務体系を直した → まとめているなら数え直す（直の時間帯が変わる）
    document.addEventListener("tpa:masters-changed", () => { if (on() && !$("#lotListScreen").classList.contains("hidden")) host.reload(); });
  }
  /** 作業開始の列の見出しを押した: 新しい順 ⇄ 古い順 */
  const toggleOrder = () => choose({ order: conf().order === "desc" ? "asc" : "desc" }, { keepPick: true });

  /** Excel に出力（lotlist-export.js）へ渡す物: 日付の数え方・直の名前・日×直の表（右の表と同じ数）。まとめていなければ null */
  function exportInfo() {
    if (!on() || !work || !work.column) return null;
    const c = conf(), p = pick();
    return { basisLabel: (BASIS[c.basis] || BASIS.work)[0], withShift: c.mode === "dayshift" && work.shifts.length > 0,
      dayText: (d) => dayText(d, true), shiftName, pivot, data: work,
      conditions: [["作業でまとめる", `${(MODES.find((m) => m[0] === c.mode) || [])[1]}（作業開始「${work.column}」が同じ行を 1 ロット）`],
        ["日付の数え方", (BASIS[c.basis] || BASIS.work)[0] + (work.pattern ? `・直: ${work.pattern.name}` : "")],
        ...(p ? [["右の表で絞った日・直", pickText(p)]] : [])] };
  }
  window.LotListWork = { mount, params, on, update, toggleOrder, exportInfo, conf: () => conf(), data: () => work, dayText, shiftName: (i) => (work ? shiftName(i) : "") };
})();
