/* =========================================================================
   ダッシュボードのスライサー（版 3.41.0。利用者の要望 6: 今月と先月など、時間や設備を切り替えて表示を簡単に入れ替える）
   - 期間: 組んだまま・今日・前日・直近 7 日・今月・先月 の札と、月を送る ◀ ▶（n か月前。サーバーの期間 month）
   - 設備: 設備グループの札（すべて・CR ライン・L ライン…。押すとそのグループの設備だけ）と、「設備…」の面（グループの見出しの下に設備のチェック）
   - 当て方（どのパネルに効くか）は dashboard-filter.js の slice。状態はこの PC の見え方（dashboard.js がダッシュボードごとに覚える）
   ここは字（HTML）を作るだけ。押した物の読み取りと覚えは dashboard.js
   ========================================================================= */
(function () {
  "use strict";
  const { esc } = TPA;
  const PERIODS = [["", "組んだまま", "パネルごとに組んだ期間で数えます"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 7 日"], ["this_month", "今月"], ["last_month", "先月"]];
  const NONE = "（グループなし）";

  /** いまの期間が今月から何か月前か（今月 0・先月 1・n か月前 n。月でなければ null） */
  const backOf = (per) => (!per || !per.kind ? null : per.kind === "this_month" ? 0 : per.kind === "last_month" ? 1 : per.kind === "month" ? per.n || 1 : null);
  /** n か月前 → 期間 */
  const periodBack = (k) => (k <= 0 ? { kind: "this_month" } : k === 1 ? { kind: "last_month" } : { kind: "month", n: k });
  /** n か月前の月の名前（today は答えの「いま」。'YYYY-MM-DD'） */
  function monthName(k, today) {
    const d = /^(\d{4})-(\d{2})/.exec(today || "") || [0, new Date().getFullYear(), new Date().getMonth() + 1];
    const t = +d[1] * 12 + (+d[2] - 1) - k, y = Math.floor(t / 12), m = (t % 12) + 1;
    return y === +d[1] ? `${m}月` : `${y}年${m}月`;
  }
  /** まとめ方の設備グループ（重なる設備は先のグループ）と、どこにも入らない設備 → [{name, members}] */
  function groupsOf(tree, set) {
    const st = (tree.sets || []).find((x) => x.name === set) || (tree.sets || [])[0];
    if (!st) return [];
    const used = new Set(), out = st.groups.map((g) => ({ name: g.name, members: g.members.filter((n) => !used.has(n) && used.add(n)) })).filter((g) => g.members.length);
    const rest = (tree.names || []).filter((n) => !used.has(n));
    return rest.length ? out.concat([{ name: NONE, members: rest, none: true }]) : out;
  }
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  /** 道具の行に入れるスライサー。sl … いまの状態 {period, equips, set}・info = {tree, today, hits: 効くパネルの数, total, open} */
  function barHtml(sl, info) {
    const s = sl || {}, per = s.period || {}, eq = s.equips || [], k = backOf(per);
    const chips = PERIODS.map(([kind, n, tip]) => {
      const on = (per.kind || "") === kind && (kind !== "days" || (per.n || 7) === 7);
      return `<button type="button" class="ds-chip${on ? " on" : ""}" data-ds-period="${kind}" aria-pressed="${on}"${tip ? ` title="${esc(tip)}"` : ""}>${n}</button>`;
    }).join("");
    const month = `<span class="ds-month${k != null && k > 1 ? " on" : ""}" role="group" aria-label="月を送る">`
      + `<button type="button" class="ds-step" data-ds-back="1" title="前の月へ（${esc(monthName((k ?? 0) + 1, info.today))}）" aria-label="前の月へ">◀</button>`
      + `<b title="${k == null ? "月で見るときは ◀ で前の月へ" : esc(monthName(k, info.today))}">${k == null ? "月" : esc(monthName(k, info.today))}</b>`
      + `<button type="button" class="ds-step" data-ds-back="-1"${k == null || k <= 0 ? " disabled" : ""} title="次の月へ" aria-label="次の月へ">▶</button></span>`;
    const gs = groupsOf(info.tree || {}, s.set).filter((g) => !g.none);
    const gchips = `<button type="button" class="ds-chip${eq.length ? "" : " on"}" data-ds-all aria-pressed="${!eq.length}" title="すべての設備">すべて</button>`
      + gs.map((g) => { const on = eq.length > 0 && same(eq, g.members); return `<button type="button" class="ds-chip${on ? " on" : ""}" data-ds-group="${esc(g.name)}" aria-pressed="${on}" title="${esc(g.name)}: ${esc(g.members.join("・"))}">${esc(g.name)}</button>`; }).join("");
    const custom = eq.length && !gs.some((g) => same(eq, g.members));
    const pick = `<button type="button" class="ds-chip ds-pick${custom ? " on" : ""}" data-ds-pick aria-haspopup="dialog" aria-expanded="${!!info.open}" title="設備を 1 台ずつ選びます（設備グループの見出しで、まとめて選べます）">${custom ? `設備 ${eq.length}` : "設備…"}<i aria-hidden="true">▾</i></button>`;
    const active = !!(per.kind || eq.length);
    const state = active ? `<small class="ds-hits" title="スライサーが効いているパネルの数（期間を組んでいないパネル・設備を見分けられないパネル・「スライサーに従わない」パネルには効きません）">${info.hits} / ${info.total} 枚に効いています</small>`
      + `<button type="button" class="ds-clear" data-ds-clear title="スライサーを外して、組んだままに戻します">× 外す</button>` : "";
    return `<div class="ds-bar${active ? " is-on" : ""}" role="group" aria-label="スライサー"><span class="ds-l">期間</span><span class="ds-chips">${chips}</span>${month}`
      + `<span class="ds-sep" aria-hidden="true"></span><span class="ds-l">設備</span><span class="ds-chips">${gchips}${pick}</span>${state}</div>`;
  }

  /** 詰めた形（道具の行に入り切らないとき。1280 など）: 期間・設備を選ぶ欄（select）にし、月の ◀ ▶ と「外す」は残す */
  function compactHtml(sl, info) {
    const s = sl || {}, per = s.period || {}, eq = s.equips || [], k = backOf(per);
    const pv = per.kind === "month" ? `month:${per.n}` : per.kind === "days" && (per.n || 7) !== 7 ? "" : per.kind || "";
    const popt = PERIODS.map(([kind, n]) => `<option value="${kind}"${pv === kind ? " selected" : ""}>${n}</option>`).join("")
      + (per.kind === "month" ? `<option value="month:${per.n}" selected>${esc(monthName(k, info.today))}</option>` : "");
    const gs = groupsOf(info.tree || {}, s.set).filter((g) => !g.none), gon = gs.find((g) => eq.length && same(eq, g.members));
    const gopt = `<option value=""${eq.length ? "" : " selected"}>すべて</option>${gs.map((g) => `<option value="${esc(g.name)}"${gon === g ? " selected" : ""}>${esc(g.name)}</option>`).join("")}`
      + (eq.length && !gon ? `<option value="@custom" selected>設備 ${eq.length}</option>` : "") + `<option value="@pick">設備を選ぶ…</option>`;
    const active = !!(per.kind || eq.length);
    return `<div class="ds-bar is-compact${active ? " is-on" : ""}" role="group" aria-label="スライサー"><label class="ds-l">期間<select data-ds-psel aria-label="期間">${popt}</select></label>`
      + `<span class="ds-month${k != null && k > 1 ? " on" : ""}" role="group" aria-label="月を送る"><button type="button" class="ds-step" data-ds-back="1" aria-label="前の月へ" title="前の月へ">◀</button>`
      + `<button type="button" class="ds-step" data-ds-back="-1"${k == null || k <= 0 ? " disabled" : ""} aria-label="次の月へ" title="次の月へ">▶</button></span>`
      + `<label class="ds-l">設備<select data-ds-gsel aria-label="設備">${gopt}</select></label><button type="button" class="ds-pickhold" data-ds-pick hidden aria-hidden="true" tabindex="-1"></button>`
      + (active ? `<button type="button" class="ds-clear" data-ds-clear title="スライサーを外して、組んだままに戻します（${info.hits} / ${info.total} 枚に効いています）">× 外す</button>` : "") + "</div>";
  }
  /** 「設備…」の面: 設備グループの見出しの下に設備のチェック（見出しのチェックでグループをまとめて） */
  function pickHtml(sl, info) {
    const s = sl || {}, eq = new Set(s.equips || []), tree = info.tree || {};
    if (!tree.names) return '<p class="df-none">設備を数えています…</p>';
    const sets = (tree.sets || []).map((x) => x.name);
    const head = `<div class="db-pophead"><b>設備で絞る</b><small>選んだ設備だけを数えます（どれも選ばなければ、すべての設備）</small></div>`
      + (sets.length > 1 ? `<label class="db-field">まとめ方<select data-ds-set>${sets.map((n) => `<option${n === (s.set || sets[0]) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : "");
    const gs = groupsOf(tree, s.set);
    const list = (gs.length ? gs : [{ name: "", members: tree.names }]).map((g) => {
      const n = g.members.filter((m) => eq.has(m)).length, all = n === g.members.length && n > 0;
      const gh = g.name ? `<label class="ds-gh"><input type="checkbox" data-ds-gck="${esc(g.name)}"${all ? " checked" : ""}${n && !all ? " data-mixed" : ""}><b>${esc(g.name)}</b><small>${n ? `${n} / ` : ""}${g.members.length} 台</small></label>` : "";
      return `<div class="ds-g${g.name ? "" : " is-flat"}">${gh}<div class="ds-ms">${g.members.map((m) => `<label class="ds-m"><input type="checkbox" data-ds-eq="${esc(m)}"${eq.has(m) ? " checked" : ""}>${esc(m)}</label>`).join("")}</div></div>`;
    }).join("");
    return `${head}<div class="ds-list">${list}</div><div class="db-popacts"><button type="button" class="df-link" data-ds-all>すべての設備に戻す</button><span class="db-sp"></span><button type="button" class="btn-primary" data-ds-done>閉じる</button></div>`;
  }
  /** チェックの途中（グループの一部を選んだ）を見せる */
  const mixed = (root) => root.querySelectorAll("[data-mixed]").forEach((x) => { x.indeterminate = true; });

  window.DashSlicer = { barHtml, compactHtml, same, pickHtml, mixed, groupsOf, periodBack, backOf, monthName, NONE };
})();
