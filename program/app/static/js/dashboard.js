/* ダッシュボード（版 3.36.0。services/dashboard.py・routes/dashboard.py）。
   2 つのパネル: 設備別の仕掛ロット数（データ元の役割「仕掛」）と、前日（現場歴）の設備別・直ごとの実績本数（作業実績。分割したロットは 1 本）。
   集計対象のロットは、パネルごとの条件（全員で 1 つ。マスタ dashboard_settings）で決める。条件の形は一覧と同じ（列・比べ方・値）。
   画面に出たときに読み、出ているあいだは 1 分ごとに読み直す（共有を直接は読まない。サーバーの写しから数える）。 */
(() => {
  const { $, esc } = TPA;
  const OPS = [["eq", "＝ 一致"], ["neq", "≠ 不一致"], ["contains", "含む"], ["not_contains", "含まない"], ["starts", "前方一致"], ["ends", "後方一致"],
    ["gt", "> より大きい"], ["gte", ">= 以上"], ["lt", "< より小さい"], ["lte", "<= 以下"], ["empty", "空欄"], ["not_empty", "空欄以外"]];
  const opLabel = (op) => (OPS.find((x) => x[0] === op) || [op, op])[1];
  const POLL_MS = 60000;
  let data = null, timer = null, editing = null, busy = false;

  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${+m[2]}/${+m[3]}` : iso || ""; };
  const ago = (sec) => { if (!sec) return ""; const d = new Date(sec * 1000), p = TPA.pad2; return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const condText = (c) => (c && c.filters && c.filters.length
    ? c.filters.map((f) => `${f.column} ${opLabel(f.op)}${["empty", "not_empty"].includes(f.op) ? "" : ` ${f.value}`}`).join("・") : "すべて");

  async function load() {
    if (busy) return;
    busy = true;
    try { data = await (await fetch("/api/dashboard", { cache: "no-store" })).json(); } catch (e) { data = { error: String(e) }; }
    busy = false;
    paint();
  }

  /* 1 枚の表（2026-10-dash の 2 回目で決めた形の土台）: 設備の行に、仕掛のロット数（棒と数）と前日の直ごとの本数・計を並べる。
     並びは仕掛の多い順（同じなら名前の順）。前日の数は濃淡（数が多いほど濃い藍）、0 は「0」の字で（淡くしすぎない）。
     仕掛があるのに前日 0 本の設備は、計の所に「0 本」の札（色だけに頼らない） */
  function table(d) {
    const w = d.wip || {}, k = d.work || {}, wipItems = w.items || [], workItems = k.items || [];
    const lots = Object.fromEntries(wipItems.map((x) => [x.equipment, x.lots]));
    const work = Object.fromEntries(workItems.map((x) => [x.equipment, x]));
    const names = [];
    workItems.forEach((x) => (x.shifts || []).forEach((s) => { if (!names.includes(s.name)) names.push(s.name); }));
    // 勤務体系の時間帯に入らない作業（直の外）も計には入るので、ある日だけ列を出す（計と列の和を合わせる）
    const OUT = "直の外", anyOut = workItems.some((x) => x.outside);
    if (anyOut) names.push(OUT);
    const eqs = [...new Set([...wipItems.map((x) => x.equipment), ...workItems.map((x) => x.equipment)])]
      .sort((a, b) => (lots[b] || 0) - (lots[a] || 0) || a.localeCompare(b, "ja"));
    // 仕掛があるのに前日 0 本の設備（題の横の札。表の行と同じ順）
    const zero = eqs.filter((e) => { const x = work[e]; return x && !x.error && x.total && !x.total.works && lots[e]; });
    const maxL = Math.max(1, ...Object.values(lots));
    const maxS = Math.max(1, ...workItems.flatMap((x) => (x.shifts || []).map((s) => s.works)));
    const heat = (n) => (n ? ` style="--h:${(0.1 + 0.35 * n / maxS).toFixed(2)}"` : "");   // 字はいつも濃い色（地は淡い藍の濃淡まで）
    const day = k.days && k.days.length === 1 ? k.days[0] : "";
    const works = workItems.reduce((a, x) => a + ((x.total && x.total.works) || 0), 0);
    const wipMeta = w.error ? `<span class="db-ng">${esc(w.error)}</span>`
      : `設備は「${esc(w.equipColumn || "（なし）")}」の${(w.source || {}).equipMode === "前方一致" ? "先頭の設備" : "値"}・元 ${esc(ago(w.mirror && w.mirror.at))}${w.noEquipment ? `・設備なし ${w.noEquipment}` : ""}`;
    const rows = eqs.map((e) => {
      const x = work[e], n = lots[e] || 0;
      const lead = `<th scope="row">${esc(e)}</th><td class="db-lots"><div><span class="db-bar"><i style="width:${(n / maxL * 100).toFixed(1)}%"></i></span><b>${n ? n.toLocaleString() : "–"}</b></div></td>`;
      if (!x) return `<tr>${lead}<td class="db-grp db-na" colspan="${names.length + 1}">作業実績の設備にありません</td></tr>`;
      if (x.error) return `<tr>${lead}<td class="db-grp db-ng" colspan="${names.length + 1}">${esc(x.error)}</td></tr>`;
      const by = Object.fromEntries((x.shifts || []).map((s) => [s.name, s.works]));
      if (anyOut) by[OUT] = x.outside || 0;
      const t = (x.total && x.total.works) || 0;
      return `<tr>${lead}${names.map((m, i) => (m in by ? `<td class="num db-s${i ? "" : " db-grp"}${by[m] ? "" : " is-zero"}"><span${heat(by[m])}>${by[m]}</span></td>`
        : `<td class="num db-s is-na${i ? "" : " db-grp"}" title="この設備の勤務体系に無い直">–</td>`)).join("")}
        <td class="num db-sum">${t}${!t && n ? '<em class="db-flag" title="仕掛があるのに、前日は 0 本でした">0 本</em>' : ""}</td></tr>`;
    }).join("");
    return `<section class="db-card">
      <div class="db-head"><h3>設備ごとの仕掛と前日の実績<small>前日 ${esc(md(day) || "-")}・現場歴</small></h3>
        ${zero.length ? `<span class="db-warn" title="仕掛があるのに、前日は 0 本だった設備"><b>前日 0 本</b>${zero.map(esc).join("・")}</span>` : ""}<span class="db-sp"></span>
        ${condBtn("wip", w.condition)}${condBtn("work", k.condition)}
        ${w.source && w.source.screen ? `<button type="button" class="pz-btn" data-db-open="${esc(w.source.screen)}">${esc(w.source.name)}を開く ›</button>` : ""}</div>
      <p class="db-meta">仕掛: ${wipMeta}　／　前日の実績: 作業開始が同じ行（分割したロット）は 1 本。直は設備ごとの勤務体系で決めます。</p>
      ${w.missingColumn ? `<p class="db-ng">設備の列「${esc(w.missingColumn)}」が表にありません。「マスタ管理」の「データ元」で直してください。</p>` : ""}
      <div class="db-tablewrap"><table class="db-table">
        <thead><tr><th rowspan="2">設備</th><th rowspan="2" class="db-lots">仕掛ロット数<small>計 ${(w.total || 0).toLocaleString()}</small></th>
          <th class="db-grp" colspan="${names.length + 1}">前日の実績本数<small>計 ${works.toLocaleString()} 本</small></th></tr>
          <tr>${names.map((m, i) => `<th class="num db-s${i ? "" : " db-grp"}">${esc(m)}</th>`).join("")}<th class="num db-sum">計</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${names.length + 3}" class="db-none">数える設備がありません。</td></tr>`}</tbody></table></div></section>`;
  }

  const condBtn = (panel, c) => `<button type="button" class="db-cond${c && c.filters && c.filters.length ? " is-on" : ""}${editing === panel ? " is-open" : ""}" data-db-cond="${panel}" aria-expanded="${editing === panel}" title="${esc(condText(c))}">${panel === "wip" ? "仕掛" : "実績"}の対象: ${esc(condText(c))}</button>`;

  function condEditor(panel) {
    const p = data[panel], c = p.condition || { filters: [] }, cols = (panel === "wip" ? p.columns : p.columns) || [];
    const colOpts = (cur) => [`<option value="">列を選ぶ</option>`, ...cols.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`)].join("");
    const opOpts = (cur) => OPS.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    const row = (f) => `<div class="db-crow"><select data-f="column">${colOpts(f.column)}</select><select data-f="op">${opOpts(f.op || "eq")}</select>
      <input data-f="value" value="${esc(f.value || "")}" placeholder="値"><button type="button" class="icon-btn" data-db-del aria-label="この条件を外す">×</button></div>`;
    return `<div class="db-editor" data-panel="${panel}"><b>${panel === "wip" ? "仕掛" : "前日の実績"}を数えるロットの条件（全員で 1 つ）</b>
      <div class="db-crows">${(c.filters.length ? c.filters : [{}]).map(row).join("")}</div>
      <div class="db-cacts"><button type="button" class="pz-btn" data-db-addrow>＋ 条件を足す</button><span class="db-sp"></span>
        <button type="button" class="btn-ghost" data-db-cancel>やめる</button><button type="button" class="btn-primary" data-db-save>保存して数え直す</button></div>
      <small class="db-msg" aria-live="polite"></small></div>`;
  }

  function paint() {
    const box = $("#dashBody");
    if (!box) return;
    if (!data) { box.innerHTML = '<p class="db-wait">数えています…</p>'; return; }
    if (data.error) { box.innerHTML = `<p class="db-ng">読めませんでした: ${esc(data.error)}</p>`; return; }
    box.innerHTML = `<div class="db-grid">${table(data)}</div>`;
    if (editing) box.querySelector(".db-head").insertAdjacentHTML("afterend", condEditor(editing));   // 条件の欄は札のすぐ下（表の上）
  }

  async function saveCond(ed) {
    const panel = ed.dataset.panel, filters = [...ed.querySelectorAll(".db-crow")].map((r) => ({
      column: r.querySelector('[data-f="column"]').value, op: r.querySelector('[data-f="op"]').value, value: r.querySelector('[data-f="value"]').value,
    })).filter((f) => f.column);
    const msg = ed.querySelector(".db-msg");
    msg.textContent = "保存しています…";
    const r = await fetch(`/api/dashboard/${panel}`, TPA.json("PUT", { filters, base_rev: (data[panel].condition || {}).rev || 0 }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { msg.textContent = "✕ " + (d.error || (r.status === 409 ? "ほかの PC が先に条件を変えました。開き直してください。" : "保存できませんでした")); return; }
    editing = null; data = null; paint(); load();
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest || !t.closest("#dashScreen")) return;
    const open = t.closest("[data-db-open]");
    if (open) { document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: open.dataset.dbOpen })); return; }
    const cond = t.closest("[data-db-cond]");
    if (cond) { editing = editing === cond.dataset.dbCond ? null : cond.dataset.dbCond; paint(); return; }
    const ed = t.closest(".db-editor");
    if (!ed) return;
    if (t.closest("[data-db-addrow]")) { ed.querySelector(".db-crows").insertAdjacentHTML("beforeend", condEditor(ed.dataset.panel).match(/<div class="db-crow">[\s\S]*?<\/div>/)[0].replace(/ selected/g, "").replace(/value="[^"]*" placeholder/, 'value="" placeholder')); return; }
    if (t.closest("[data-db-del]")) { t.closest(".db-crow").remove(); return; }
    if (t.closest("[data-db-cancel]")) { editing = null; paint(); return; }
    if (t.closest("[data-db-save]")) saveCond(ed);
  });

  window.Dashboard = {
    activate() { paint(); load(); clearInterval(timer); timer = setInterval(() => { if (!editing) load(); }, POLL_MS); },
    deactivate() { clearInterval(timer); timer = null; },
  };
})();
