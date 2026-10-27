/* スケジュール（CM3 の設備ごとの作業予定。ScheduleView を移した。版 3.57.0）の一覧の部品。
   一覧そのもの（列・並べ替え・絞り込み・スライサー・色付け・カード・Excel・表示列）は lotlist.js の仕組みのまま。
   ここはスケジュールだけの物:
     - 設備のタブ（設備＋HOT コイル作業順。作業実績の設備のタブと同じ札）と「CM3 の画面を開く」
     - 設備の数の札（製造件数・ロット数・点検・設備停止・仕掛と一致・完了予定の範囲・CM3 の更新）
     - HOT コイル作業順の札（設備ごとの本数・釜番）・作業の流れの図（設備ごとの帯。帯の字は釜番）・釜番の札（押すとその釜番だけ）
     - 行の区分の色（設備停止・点検）・次工程が自分の設備・日付の境の線
     - 表示列の既定（ScheduleView の既定の列: 前工程・釜番を パス の後ろに、設備・開始予定は隠す）
   数・行はサーバー（routes/schedule.py）が答えた物をそのまま見せる（画面で数え直さない）。 */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = TPA.esc;
  const EQ_KEY = "tpa.sch.equip.v1", TL_KEY = "tpa.sch.timeline.v1";
  const HOT = "__HOT__";
  // 設備の色（ScheduleView と同じ。L-1 青・L-2 緑・L-3 橙。ほかは順に）・釜番の色（淡い 16 色。完了予定の早い釜番から順に）
  const EQ_COLORS = { "L-1": "#2563eb", "L-2": "#16a34a", "L-3": "#ea580c" };
  const EQ_FALLBACK = ["#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];
  const KAMA_PALETTE = ["#ffd6a5", "#caffbf", "#9bf6ff", "#bdb2ff", "#ffc6ff", "#fdffb6", "#a0c4ff", "#ffadad",
    "#d0f4de", "#e4c1f9", "#fcf6bd", "#a9def9", "#f1c0e8", "#cfbaf0", "#b9fbc0", "#fbe0c3"];
  // 時刻の順に並んでいるとき（並べ替えを決めていない・No・完了予定の ▲）だけ、日付の境に線を引く
  const TIME_COLUMNS = new Set(["No", "完了予定", "完了予定日時", "開始予定", "開始予定日時", "HOT順"]);

  let meta = null;                  // /api/schedule の答え（設備・HOT・自動更新の間隔）
  let hotAll = null;                // HOT コイル作業順の全部の行（札・図・釜番の札は、絞り込む前の全部で描く）
  let hotSig = "";
  const sel = { kama: new Set(), offEq: new Set() };    // HOT: 選んだ釜番・隠した設備（一覧の絞り込みに足す）
  let onChange = () => {};

  const eqColor = (eq) => EQ_COLORS[eq] || EQ_FALLBACK[Math.max(0, ((meta && meta.hot.equipments) || []).indexOf(eq)) % EQ_FALLBACK.length];
  const kamaKey = (v) => String(v == null ? "" : v).trim();
  let kamaColors = new Map();
  const kamaColor = (v) => (kamaKey(v) ? kamaColors.get(kamaKey(v)) || "#e5e7eb" : "#e5e7eb");
  /** "2026-10-03 08:12" → 時刻（現場の時刻のまま） */
  const timeOf = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(String(s || "")); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN; };
  const range = (list) => { const t = list.map((r) => r["完了予定"]).filter(Boolean); return t.length ? `${t[0]} ～ ${t[t.length - 1]}` : "-"; };

  /* ---------------- 設備（/api/schedule） ---------------- */
  async function loadMeta() {
    const r = await fetch("/api/schedule", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "スケジュールの設備を読めませんでした");
    meta = d;
    return equips();
  }
  /** 設備のタブの並び（設備 → HOT コイル作業順）。作業実績の設備と同じ形 {key, name, state} */
  function equips() {
    if (!meta) return null;
    const list = meta.equipments.map((e) => ({ key: e.key, name: e.name, state: "ok", viewUrl: e.viewUrl }));
    if (meta.hot.equipments.length) list.push({ key: HOT, name: meta.hot.title, state: "ok", hot: true });
    return list;
  }
  const savedEquip = () => TPA.local.get(EQ_KEY, "");
  const saveEquip = (k) => TPA.local.set(EQ_KEY, k);
  const isHot = (S) => S.equip === HOT;

  /* ---------------- 設備のタブ ---------------- */
  function renderBar(bar, S) {
    bar.hidden = false; bar.dataset.kind = "sch";
    bar.classList.remove("is-sortable");
    const list = S.equips;
    if (list == null) { bar.innerHTML = '<span class="eq-lab">設備</span><span class="eq-wait">設備を読んでいます…</span>'; return; }
    const chips = list.map((e) => `<button type="button" role="tab" class="eq-chip${e.hot ? " sd-hotchip" : ""}" data-equip="${esc(e.key)}" aria-selected="${e.key === S.equip}"`
      + ` tabindex="${e.key === S.equip ? 0 : -1}" title="${esc(e.hot ? `${meta.hot.equipments.join("・")} で前工程が ${meta.hot.prevValue} のロットを、完了予定の順にまとめた一覧` : `${e.name} の作業予定（CM3）`)}">`
      + (e.hot ? "" : `<i class="sd-eqdot" style="--eqc:${eqColor(e.key)}" aria-hidden="true"></i>`) + `${esc(e.name)}</button>`).join("");
    const cur = list.find((e) => e.key === S.equip);
    const link = cur && cur.viewUrl ? `<a class="eq-manage sd-cm3" href="${esc(cur.viewUrl)}" target="_blank" rel="noopener" title="${esc(cur.name)} の CM3 の画面を、いつものブラウザで開きます">CM3 の画面を開く ↗</a>` : "";
    const auto = meta ? `<span class="eq-hint sd-auto" title="この画面を開いている間、CM3 から取り直し、変わっていれば出し直します（参照先の「スケジュールを取り直す間隔」）">自動更新 ${meta.autoRefreshSec} 秒</span>` : "";
    bar.innerHTML = `<span class="eq-lab" id="llEquipLab">設備</span><div class="eq-chips" role="tablist" aria-labelledby="llEquipLab">${chips}</div>${auto}${link}`;
  }

  /* ---------------- 行の飾り ---------------- */
  const KIND = { "設備停止": "sd-stop", "点検": "sd-inspect" };
  function timeSorted(S) {
    const s = S.sorts || [];
    return !s.length || (TIME_COLUMNS.has(s[0].column) && s[0].dir !== "desc");
  }
  /** 行の class（設備停止・点検・次工程が自分の設備・日付の境）。prev はその上の行 */
  function rowClass(r, prev, S) {
    const k = [KIND[r["区分"]] || (r["次工程"] && r["次工程"] === r["設備"] ? "sd-self" : "")];
    const day = String(r["完了予定"] || "").slice(0, 5);
    if (prev && timeSorted(S) && day && day !== String(prev["完了予定"] || "").slice(0, 5)) k.push("sd-daybreak");
    return k.filter(Boolean).join(" ");
  }

  /* ---------------- 絞り込みに足す（HOT の札で選んだ釜番・隠した設備） ---------------- */
  function filters(S) {
    if (!isHot(S)) return [];
    const out = [];
    if (sel.kama.size) out.push({ column: "釜番", op: "in", value: JSON.stringify([...sel.kama]) });
    if (sel.offEq.size && meta) out.push({ column: "設備", op: "in", value: JSON.stringify(meta.hot.equipments.filter((e) => !sel.offEq.has(e))) });
    return out;
  }

  /* ---------------- 上の札（設備の数・HOT の札と図） ---------------- */
  function paint(S, extra) {
    const box = $("#llSched"); if (!box) return;
    if (!S.src.cm3 || !extra) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.dataset.mode = isHot(S) ? "hot" : "line";
    if (isHot(S)) { paintHot(S, extra, box); return; }
    const m = extra.summary || {};
    const card = (label, value, cls = "", tip = "") => `<div class="sd-card${cls}"${tip ? ` title="${esc(tip)}"` : ""}><span class="sd-label">${esc(label)}</span><b class="sd-value">${value}</b></div>`;
    box.innerHTML = card("製造件数", esc(m.count), "", "設備停止・点検を除いた製造の行の数（2 パス目も 1 件と数える）")
      + card("ロット数", esc(m.lots))
      + card("点検", esc(m.inspect), m.inspect ? " is-inspect" : "")
      + card("設備停止", esc(m.stop), m.stop ? " is-stop" : "")
      + card("仕掛と一致", extra.joined ? `${esc(m.hit ?? "-")}<small> / ${esc(m.count)}</small>` : "未結合", "", "仕掛（データ元「仕掛」）に同じロットがある製造の行の数。結合はマスタ管理の「データ元」で決めます")
      + card("完了予定", `${esc(m.first || "-")}<small> ～ </small>${esc(m.last || "-")}`, " is-wide")
      + card("CM3 の更新・取得", `${esc((m.updateTime || "-").slice(5, 16))}<small> ・ </small>${esc((m.fetchedAt || "-").slice(11, 16))}`, " is-wide",
        m.error ? `いまは CM3 に届きません（${m.error}）。前に取れた予定を出しています` : "");
  }

  async function fetchHotAll(S) {
    const sig = String((S.source && S.source.copiedAt) || "");
    if (hotAll && sig === hotSig) return hotAll;
    const r = await fetch(`${S.src.api}?equip=${HOT}&page_size=2000`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HOT コイル作業順を読めませんでした");
    hotAll = (d.rows || []).slice().sort((a, b) => a["HOT順"] - b["HOT順"]);
    hotSig = sig;
    kamaColors = new Map();
    hotAll.forEach((r) => { const k = kamaKey(r["釜番"]); if (k && !kamaColors.has(k)) kamaColors.set(k, KAMA_PALETTE[kamaColors.size % KAMA_PALETTE.length]); });
    [...sel.kama].forEach((k) => { if (!kamaColors.has(k) && k !== "") sel.kama.delete(k); });
    return hotAll;
  }

  function paintHot(S, extra, box) {
    const me = S;
    fetchHotAll(S).then((all) => { if (me === S && isHot(S)) drawHot(S, extra, box, all); })
      .catch((e) => { box.innerHTML = `<div class="sd-note is-warn">${esc(e.message)}</div>`; });
  }
  function drawHot(S, extra, box, all) {
    const h = extra.hot || {}, eqs = h.equipments || [], c = h.counts || {};
    const per = (eq) => all.filter((r) => r["設備"] === eq);
    let cards = `<div class="sd-card is-lead"><span class="sd-label">対象ロット（前工程 ${esc(h.prevValue || "HOT")}）</span><b class="sd-value">${S.count}${S.count !== all.length ? `<small> / ${all.length}</small>` : ""}</b>`
      + `<span class="sd-sub">${esc(range(all))}</span></div>`;
    eqs.forEach((eq) => {
      const list = per(eq);
      cards += `<button type="button" class="sd-card sd-eqcard${sel.offEq.has(eq) ? " is-off" : ""}${list.length ? "" : " is-empty"}" data-sd-eq="${esc(eq)}" style="--eqc:${eqColor(eq)}" aria-pressed="${!sel.offEq.has(eq)}"`
        + ` title="押すと一覧にこの設備を出す・出さないを切り替えます"><span class="sd-label"><i class="sd-eqdot" aria-hidden="true"></i>${esc(eq)}</span><b class="sd-value">${list.length}<small> 本</small></b>`
        + `<span class="sd-sub">${list.length ? esc(range(list)) : "予定なし"}</span></button>`;
    });
    const notes = [];
    if (!h.kamaColumn) notes.push(`仕掛に「${h.kamaConfigured || "設計_PIT炉番炉順"}」の列が無いため、釜番は空欄です`);
    if (!h.resultColumn) notes.push("仕掛に「実績_設備ｺｰｽ」の列が無いため、前工程を見分けられません");
    if (c.noMaster) notes.push(`仕掛に無いロット ${c.noMaster} 件は前工程が分からないため除きました`);
    if (c.otherNext) notes.push(`前工程が HOT でも次の設備が別のロット ${c.otherNext} 件は除きました`);
    (h.errors || []).forEach((e) => notes.push(e));
    const rule = `${eqs.join("・")} の予定から、前工程（実績_設備ｺｰｽ の最後）が ${h.prevValue || "HOT"} で、次の設備（残仕掛設備ｺｰｽ の最初）がその設備のロットの 1 パス目を、完了予定の順に`;
    cards += `<div class="sd-card is-info" title="${esc(rule)}"><span class="sd-label">抜き出し方</span><span class="sd-rule">${esc(rule)}</span></div>`;
    const tlOn = TPA.local.get(TL_KEY, true) !== false;
    // 除いたロット・読めない列の知らせは、抜き出し方の文と分けて 1 行に（狭い窓でも切らない。状態が見えないままにしない）
    box.innerHTML = `<div class="sd-cards">${cards}</div>` + (notes.length ? `<p class="sd-notes" role="status">${esc(notes.join("／"))}</p>` : "")
      + `<div class="sd-tlwrap"><div class="sd-tlhead"><b>作業の流れ</b><span>設備ごとの並び。帯の字は釜番、帯の長さは開始予定（前の行の完了予定）～完了予定。帯を押すとその釜番だけを出します。</span>`
      + `<button type="button" class="sd-tltoggle" data-sd-tl aria-pressed="${tlOn}">${tlOn ? "図を隠す" : "図を出す"}</button></div>${tlOn ? timeline(all, eqs) : ""}</div>`
      + kamaChips(all);
    fitBlocks(box);
  }
  /** 帯に入らない釜番の字は出さない（切れた字を見せない。色で釜番の札と結び、字は乗せると出る） */
  function fitBlocks(box) {
    requestAnimationFrame(() => $$(".sd-blk", box).forEach((b) => b.classList.toggle("is-tight", b.scrollWidth > b.clientWidth + 1)));
  }

  function timeline(all, eqs) {
    const blocks = all.map((r) => {
      const e = timeOf(r["完了予定日時"]);
      let s = timeOf(r["開始予定日時"]);
      if (Number.isNaN(e)) return null;
      if (Number.isNaN(s) || s >= e) s = e - 10 * 60000;
      return { r, s, e };
    }).filter(Boolean);
    if (!blocks.length) return '<div class="sd-note">図に描ける予定がありません</div>';
    let t0 = Math.min(...blocks.map((b) => b.s)), t1 = Math.max(...blocks.map((b) => b.e));
    const pad = Math.max(10 * 60000, (t1 - t0) * 0.01);
    t0 -= pad; t1 += pad;
    const span = t1 - t0, pct = (t) => `${(((t - t0) / span) * 100).toFixed(3)}%`;
    const hours = span / 3600000, step = hours <= 12 ? 1 : hours <= 24 ? 2 : hours <= 48 ? 3 : 6;
    const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
    const ticks = [];
    for (let t = first.getTime(); t < t1; t += 3600000) {
      const d = new Date(t);
      if (d.getHours() % step) continue;
      ticks.push({ t, day: d.getHours() === 0, label: d.getHours() === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : `${TPA.pad2(d.getHours())}:00` });
    }
    const now = Date.now();
    let h = `<div class="sd-tl"><div class="sd-axis">${ticks.map((k) => `<span class="${k.day ? "is-day" : ""}" style="left:${pct(k.t)}">${k.label}</span>`).join("")}</div>`;
    eqs.forEach((eq, li) => {
      const grid = ticks.map((k) => `<i class="sd-grid${k.day ? " is-day" : ""}" style="left:${pct(k.t)}"></i>`).join("");
      const nowLine = now > t0 && now < t1 && li === 0 ? `<i class="sd-now" style="left:${pct(now)}" title="いま"></i>` : "";
      const bl = blocks.filter((b) => b.r["設備"] === eq).map((b) => {
        const k = kamaKey(b.r["釜番"]), dim = sel.kama.size && !sel.kama.has(k);
        const tip = `${eq}　${b.r["開始予定"] || "?"} ～ ${b.r["完了予定"]}\nロット ${b.r["ロットNo"]}\n釜番 ${k || "なし"}\n${b.r["材質"] || ""} ${b.r["入側板厚"] || ""}→${b.r["出側板厚"] || ""} × ${b.r["冷延幅"] || ""}`;
        return `<button type="button" class="sd-blk${dim ? " is-dim" : ""}" data-sd-kama="${esc(k)}" title="${esc(tip)}" style="left:${pct(b.s)};width:calc(${(((b.e - b.s) / span) * 100).toFixed(3)}% - 1px);background:${kamaColor(k)}">${esc(k || b.r["ロットNo"])}</button>`;
      }).join("");
      h += `<div class="sd-lane"><span class="sd-ln"><i class="sd-eqdot" style="--eqc:${eqColor(eq)}" aria-hidden="true"></i>${esc(eq)}</span><div class="sd-track">${grid}${nowLine}${bl}</div></div>`;
    });
    return h + "</div>";
  }

  function kamaChips(all) {
    const groups = new Map();
    all.forEach((r) => {
      const k = kamaKey(r["釜番"]), g = groups.get(k) || { n: 0, eq: {}, list: [] };
      g.n++; g.eq[r["設備"]] = (g.eq[r["設備"]] || 0) + 1; g.list.push(r);
      groups.set(k, g);
    });
    if (!groups.size) return "";
    return `<div class="sd-kama" role="group" aria-label="釜番"><span class="sd-klab">釜番</span>`
      + `<button type="button" class="sd-kchip${sel.kama.size ? "" : " is-on"}" data-sd-kama="__all" aria-pressed="${!sel.kama.size}">すべて</button>`
      + [...groups.entries()].map(([k, g]) => {
        const eqText = Object.keys(g.eq).map((e) => e + (g.eq[e] > 1 ? `×${g.eq[e]}` : "")).join(" ");
        return `<button type="button" class="sd-kchip${sel.kama.has(k) ? " is-on" : ""}" data-sd-kama="${esc(k)}" aria-pressed="${sel.kama.has(k)}" title="${esc(range(g.list))}">`
          + `<i class="sd-kdot" style="background:${kamaColor(k)}" aria-hidden="true"></i>${esc(k || "（釜番なし）")}<b>${g.n}</b><small>${esc(eqText)}</small></button>`;
      }).join("") + "</div>";
  }

  function toggleKama(k) {
    if (k === "__all") sel.kama.clear();
    else if (sel.kama.has(k)) sel.kama.delete(k);
    else sel.kama.add(k);
    onChange();
  }

  /* ---------------- 表示列の既定（ScheduleView の既定の列） ---------------- */
  const PREV = 'regreplace(trim([実績_設備ｺｰｽ]), "^.* ", "")';
  const NEXT = 'if(split(trim([残仕掛設備ｺｰｽ]), " ", 1) = "", "完了", split(trim([残仕掛設備ｺｰｽ]), " ", 1))';
  // 日時・区分・停止の文が「…」で切れない幅（px。月/日 時:分 が 1 行に入る）
  const WIDTHS = { "完了予定": 100, "開始予定": 100, "区分": 76, "停止内容": 200 };
  function defaults(id) {
    const C = window.LotListColumns;
    C.setDefault(`${id}:予定`, { order: ["No", "完了予定", "区分", "ロットNo", "パス", "総パス", "前工程", "設計_PIT炉番炉順", "材質", "入側板厚", "出側板厚", "圧下率",
      "冷延幅", "製品板厚", "製品幅", "形状", "用途名", "次工程", "停止内容"],
      hidden: ["設備", "開始予定", "完了予定日時", "開始予定日時", "実績_設備ｺｰｽ", "次の設備"],
      names: { "設計_PIT炉番炉順": "釜番" }, formulas: { "前工程": PREV, "次の設備": NEXT }, widths: WIDTHS,
      formats: { "圧下率": { type: "number", decimals: 1, suffix: "%" } } });
    C.setDefault(`${id}:HOT`, { order: ["HOT順", "設備", "開始予定", "完了予定", "No", "ロットNo", "パス", "前工程", "釜番"], widths: WIDTHS,
      hidden: ["区分", "停止内容", "総パス", "完了予定日時", "開始予定日時", "実績_設備ｺｰｽ", "設計_PIT炉番炉順"],
      formats: { "圧下率": { type: "number", decimals: 1, suffix: "%" } } });
  }

  let fitTimer = 0;
  addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { const b = $("#llSched"); if (b && !b.hidden) fitBlocks(b); }, 150); });
  function mount({ changed }) {
    onChange = () => { changed(); };
    const box = $("#llSched");
    box?.addEventListener("click", (e) => {
      const eq = e.target.closest("[data-sd-eq]");
      if (eq) { const k = eq.dataset.sdEq; if (sel.offEq.has(k)) sel.offEq.delete(k); else sel.offEq.add(k); onChange(); return; }
      const km = e.target.closest("[data-sd-kama]");
      if (km) { toggleKama(km.dataset.sdKama); return; }
      if (e.target.closest("[data-sd-tl]")) { TPA.local.set(TL_KEY, TPA.local.get(TL_KEY, true) === false); onChange(); }
    });
  }
  /** 設備を替えた・元を離れた（HOT の選びは HOT の中だけ） */
  function reset() { sel.kama.clear(); sel.offEq.clear(); }

  window.LotListSchedule = { HOT, loadMeta, equips, savedEquip, saveEquip, renderBar, rowClass, filters, paint, defaults, mount, reset,
    autoSec: () => (meta ? meta.autoRefreshSec : 60), eqColor, kamaColor };
})();
