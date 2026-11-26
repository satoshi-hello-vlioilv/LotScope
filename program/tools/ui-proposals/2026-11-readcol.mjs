// 改良「読み替えルールだけで作る列」（利用者の改良依頼 2026-11-17 の 3「表示列の読み替えルールのさらなる汎用化（もはや読み替えではなく、扱いが変換表に近い）。
// 表示列の読み替えルールは元データがあるときにしか使えませんが、計算列として新しく列を追加した際でも読み替えルールだけでデータが成り立つ場合は
// その結果だけ表示することができるようにしてください」）の案（回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面（ui-harness.mjs の readcol-list 〜 readcol-off。この比べのために足した）: 品質の表「仕掛」に、式の無い作った列「管理区分」と、
//   ほかの列（合金・板厚）を条件にした読み替えルール「管理区分」（合金＝A5052 かつ 板厚≧1 → 5052厚板〈良い〉／合金が A3 で始まる → 3000系〈注意〉／どれにも → その他〈目立たせない〉）を付けた形。
//   readcol-list（一覧）→ readcol-cols（表示列の窓で 管理区分 を選び ③ 読み替え を開いた所）→ readcol-rule（「ルールを編集」の窓）
//   → readcol-new（「＋ 列を作る」で新しい列「区分」を足した直後）。
//
//   TPA_UI_EXE=…/ui_serve TPA_UI_PROGRAM=…/program node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-readcol.mjs \
//     --from readcol-list --states readcol-list,readcol-cols,readcol-rule,readcol-new      （--view 1536x864・--view 1280x720 でも。1 つずつ流す）
//
// どの案も中身は同じ（採点のファイルの common_build）: 式の無い作った列に、ルールを「作り方」として付けられる（ルールで作る列）。
//   ルールは同じ意味の式（lotlist-rules.js の toFormula。この列＝空欄）にして、並べ替え・値で絞る・スライサー・集計表・ダッシュボードへ送る（今は画面だけで、窓は知らない）。
//   ルールの色は今の読み替えと同じく一覧のセルに出す。表示列の窓の札（値のある行・値の種類・結果）はルールの答えで数える。
//   案の画面では、窓へ送る形は作らず（撮る画面に出ない）、表示列の窓・作り方の窓・ルールの窓の見え方と流れを DOM で組み替える。
//   数（件数）は頁の中で一覧の 500 行をルールで判定して数えた本物の数。

/* ------------------------------------------------------------------ 共通の部品（頁の中で動く。window.RC） */
function lib() {
  if (window.RC) return;
  const R = (window.RC = { counts: null, first: "" });
  R.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  R.keep = (fn, ms = 150) => { const t = () => { try { fn(); } catch (e) { console.warn("案:", e.message); } }; t(); setInterval(t, ms); };
  R.RULE = "管理区分";
  R.VALUES = [["5052厚板", "ok", "合金 ＝「A5052」かつ 板厚 ≧「1」"], ["3000系", "warn", "合金 が「A3」で始まる"], ["その他", "muted", "どれにも当てはまらないとき"]];
  /* 一覧の 500 行をルールで判定して、値ごとの件数を数える（本物の数） */
  R.load = async () => {
    if (R.loading) return; R.loading = true;
    try {
      const d = await (await fetch("/api/lotlist?table=" + encodeURIComponent("仕掛") + "&page=1&page_size=500")).json();
      const rows = d.rows || [], c = {};
      rows.forEach((row, i) => { const hit = window.LotListRules.match(R.RULE, row, R.RULE); const v = hit ? hit.text : ""; c[v] = (c[v] || 0) + 1; if (i === 0) R.first = v; });
      R.counts = c; R.total = rows.length;
      R.top = rows.slice(0, 12).map((row) => { const hit = window.LotListRules.match(R.RULE, row, R.RULE); return hit ? [hit.text, hit.color] : ["", ""]; });
    } catch (_) { R.loading = false; }
  };
  R.n = (v) => (R.counts ? R.counts[v] || 0 : 0);
  R.focus = () => (document.querySelector("#llColumnPanel:not([hidden]) #lcDetail .lc-cardhead b") || {}).textContent || "";
  R.inCols = () => R.focus() === R.RULE;
  R.newOpen = () => { const p = document.querySelector("#llFxPanel:not([hidden])"); return p && /「区分」/.test((p.querySelector(".lr-title") || {}).textContent || "") ? p : null; };
  R.rulePanel = () => document.querySelector("#llRulePanel:not([hidden])");
  R.step = (k) => document.querySelector(`#lcDetail .lc-step[data-step="${k}"]`);
  R.setNow = (k, text, set = true) => { const n = R.step(k) && R.step(k).querySelector(".lc-now"); if (n && n.textContent !== text) { n.textContent = text; n.classList.toggle("is-set", set); } };
  R.openStep = (k) => {
    document.querySelectorAll("#lcDetail .lc-step").forEach((s) => { const on = s.dataset.step === k; s.classList.toggle("is-open", on); const h = s.querySelector("h4"); if (h) h.setAttribute("aria-expanded", on); });
  };
  /* 値の札（色つき）。一覧のセルと同じ色の名前（cell-ok など） */
  R.chip = (v, color) => `<span class="rc-chip cell-${color}">${R.esc(v)}</span>`;
  /* どの案も: 右の札・列の行の見本・結果の段を、ルールの答えで数えた形に（common_build の (3)） */
  R.common = () => {
    if (!R.counts) { R.load(); return; }
    if (!R.inCols()) return;
    const dl = document.querySelector("#lcDetail .lc-card dl");
    if (dl && !dl.dataset.rc) {
      dl.dataset.rc = "1";
      const dd = dl.querySelectorAll("dd");
      if (dd[0]) dd[0].textContent = `${R.RULE}（ルールで作る列。見出しを押すと、ルールの答えで並べ替えます）`;
      if (dd[1]) dd[1].textContent = `${R.total - R.n("")} / ${R.total}（空欄 ${R.n("")}）`;
      if (dd[2]) dd[2].textContent = `ルールで決まる ${R.VALUES.length} つの値`;
    }
    const smp = document.querySelector(`#lcList li[data-col="${R.RULE}"] .lc-sample`);
    if (smp && smp.querySelector(".lc-none")) smp.innerHTML = R.chip(R.first, (R.VALUES.find(([v]) => v === R.first) || [, "muted"])[1]);
    R.setNow("result", `${R.VALUES.length} つの値（${R.VALUES.map(([v]) => v).join("・")}）`);
    const res = R.step("result");
    if (res && !res.dataset.rc) {
      res.dataset.rc = "1";
      res.querySelectorAll(":scope > :not(h4)").forEach((e) => e.remove());
      res.insertAdjacentHTML("beforeend", `<table class="rc-res"><tr><th>ルールの答え</th><th>件数（先頭 ${R.total} 行）</th></tr>${R.VALUES.map(([v, c]) => `<tr><td>${R.chip(v, c)}</td><td>${R.n(v)} 件</td></tr>`).join("")}</table>`);
    }
  };
  R.css = `
    .rc-chip{display:inline-block;padding:1px 8px;border-radius:999px;font-weight:800;font-size:12.5px;line-height:1.5;white-space:nowrap}
    .rc-chip.cell-ok{background:#e3f4ea;color:#1d6b3c}.rc-chip.cell-warn{background:#fdf1dc;color:#7a4b00}.rc-chip.cell-muted{background:#eef1f5;color:#56606c}
    .rc-res{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}.rc-res th{text-align:left;color:#56606c;font-weight:700;padding:4px 6px;border-bottom:1px solid #dfe5ec}
    .rc-res td{padding:5px 6px;border-bottom:1px solid #eef1f5}
    .rc-note{display:block;margin:6px 0 2px;color:#3e4a57;font-size:12.5px;line-height:1.55}
    .rc-btn{font:inherit;font-size:13px;font-weight:700;border:1px solid #b9c6d6;background:#fff;color:#1f3d63;border-radius:6px;padding:5px 12px;cursor:pointer;white-space:nowrap}
    .rc-btn.is-main{background:#2f5b8f;border-color:#2f5b8f;color:#fff}
    .rc-tag{margin-left:6px;padding:0 7px;border-radius:999px;background:#efe8fb;color:#4f2f8a;font-size:11px;font-weight:800;white-space:nowrap}
  `;
}
const LIB = `(${lib})();`;

/* ------------------------------------------------------------------ A 「＋ 列を作る」で作り方を選ぶ（流れの変え方） */
function propA() {
  const R = window.RC;
  R.keep(() => {
    R.common();
    if (R.inCols()) {
      R.setNow("fx", `ルール「${R.RULE}」で作る`);
      R.setNow("rule", "作り方のルール（色も）");
      const rs = R.step("rule");
      if (rs && !rs.dataset.rcA) { rs.dataset.rcA = "1"; rs.querySelector(".lc-field")?.insertAdjacentHTML("beforebegin", '<small class="rc-note">この列は式の無い作った列なので、ルールの答えがそのまま列の値になります（並べ替え・絞り込み・集計表でも同じ値）。</small>'); }
    }
    const rp = R.rulePanel();
    if (rp) { const sub = rp.querySelector(".lr-usage"); if (sub && !sub.dataset.rcA) { sub.dataset.rcA = "1"; sub.textContent = `使っている列: 仕掛・${R.RULE}（このルールで作る列。直すと列の値も変わります）`; } }
    const fx = R.newOpen();
    if (fx && !document.querySelector(".rcA-pop")) {
      fx.style.visibility = "hidden";
      const btn = document.querySelector("#lcAddCol"), b = btn.getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", `<div class="rcA-pop" style="left:${Math.round(b.left)}px;top:${Math.round(b.bottom + 6)}px" role="dialog" aria-label="新しい列の作り方">
        <b class="rcA-h">新しい列「区分」をどう作りますか</b>
        <button type="button" class="rcA-opt is-on"><i>≡</i><span><b>ルールで値を決める</b><small>条件 → 値・色。式を書きません（元データが無くても作れます）</small></span></button>
        <div class="rcA-sub"><span>保存したルール</span><button type="button" class="rc-btn">${R.RULE} <small>3 行</small></button><button type="button" class="rc-btn">＋ 新しいルール…</button></div>
        <button type="button" class="rcA-opt"><i>ƒx</i><span><b>式で計算する</b><small>[重量]/1000・concat など</small></span></button>
        <button type="button" class="rcA-opt"><i>⇄</i><span><b>変換表（マスタ）で足す</b><small>当てられる変換表 1</small></span></button>
      </div>`);
    }
  });
}
const CSS_A = `.rcA-pop{position:fixed;z-index:9999;width:430px;background:#fff;border:1px solid #c5ced9;border-radius:10px;box-shadow:0 12px 32px rgba(16,32,52,.22);padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13.5px}
  .rcA-h{font-size:14.5px;color:#16202b}
  .rcA-opt{display:flex;gap:10px;align-items:flex-start;text-align:left;font:inherit;border:1px solid #d5dde7;border-radius:8px;background:#fff;padding:8px 10px;cursor:pointer}
  .rcA-opt.is-on{border-color:#2f5b8f;background:#eef4fb;box-shadow:inset 3px 0 0 #2f5b8f}
  .rcA-opt i{flex:0 0 26px;height:26px;border-radius:6px;background:#e7eef8;color:#244569;font-style:normal;font-weight:800;display:grid;place-items:center}
  .rcA-opt span{display:flex;flex-direction:column;gap:2px}.rcA-opt small{color:#56606c;font-size:12px}
  .rcA-sub{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:-2px 0 2px 36px}.rcA-sub>span{color:#56606c;font-size:12px}.rcA-sub small{color:#56606c;font-weight:600}`;

/* ------------------------------------------------------------------ B 作り方の段で「式｜ルール」を選ぶ（置き場: ルールを作り方へ） */
function propB() {
  const R = window.RC;
  R.keep(() => {
    R.common();
    if (R.inCols()) {
      R.setNow("fx", `ルール「${R.RULE}」`);
      const fx = R.step("fx"), rs = R.step("rule");
      if (rs) rs.style.display = "none";
      if (fx && !fx.dataset.rcB) {
        fx.dataset.rcB = "1"; R.openStep("fx");
        fx.querySelectorAll(":scope > :not(h4)").forEach((e) => (e.style.display = "none"));
        fx.insertAdjacentHTML("beforeend", `<div class="rcB-body">
          <div class="rcB-seg" role="radiogroup" aria-label="作り方"><button type="button" role="radio">ƒx 式で作る</button><button type="button" role="radio" class="is-on" aria-checked="true">≡ ルールで作る</button></div>
          <div class="rcB-pick"><span>ルール</span><select><option>${R.RULE}</option><option>＋ 新しいルールを作る…</option></select></div>
          <ol class="rcB-rows">${R.VALUES.map(([v, c, how]) => `<li><span class="rcB-how">${R.esc(how)}</span><span class="rcB-to">→</span>${R.chip(v, c)}<span class="rcB-n">${R.n(v)} 件</span></li>`).join("")}</ol>
          <small class="rc-note">上から順に見て、最初に当てはまった値がこの列の値です（色も）。並べ替え・絞り込み・集計表でも同じ値を使います。</small></div>`);
      }
      // 本物の「ルールを編集」（#lcRuleEdit。押すとルールの窓）を作り方の段のルールの横へ移す（読み替えの段は畳んで隠す）
      const ed = document.querySelector("#lcRuleEdit"), pick = fx && fx.querySelector(".rcB-pick");
      if (ed && pick && ed.parentElement !== pick) pick.append(ed);
    }
    const fxp = R.newOpen();
    if (fxp && !fxp.dataset.rcB) {
      fxp.dataset.rcB = "1";
      const tabs = fxp.querySelector(".lr-tabs");
      tabs.querySelectorAll("button").forEach((b) => b.classList.remove("is-on", "on", "active"));
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", "false"));
      tabs.insertAdjacentHTML("afterbegin", `<button type="button" role="tab" aria-selected="true" class="rcB-tab">保存したルールを使う<small>名前を付けたルール（色つき）から</small></button>`);
      fxp.querySelectorAll(".lr-pane").forEach((p) => (p.style.display = "none"));
      tabs.insertAdjacentHTML("afterend", `<div class="rcB-pane">
        <p class="rc-note">この列の値を、保存したルールの答えにします。ルールを直すと、使っている列がみな変わります。</p>
        <div class="rcB-card is-on"><div><b>${R.RULE}</b><small>3 行・合金・板厚を見る・使っている列 1（仕掛・管理区分）</small></div>
          <div class="rcB-vals">${R.VALUES.map(([v, c]) => R.chip(v, c)).join("")}</div><button type="button" class="rc-btn is-main">この列に使う</button></div>
        <button type="button" class="rc-btn">＋ 新しいルールを作る…</button></div>`);
    }
    // 試した結果（左）も、選んだルールの答えに
    const tr = fxp && fxp.querySelector(".lr-try");
    if (tr && R.top && !tr.querySelector(".rcB-try")) {
      tr.innerHTML = `<div class="lr-try-head"><b>試した結果</b><small>先頭12件・ルール「${R.RULE}」の答え</small></div>
        <ul class="lr-try-list rcB-try">${R.top.map(([v, c], k) => `<li class="is-hit"><code>${k + 1}件目</code><span aria-hidden="true">→</span>${R.chip(v, c)}</li>`).join("")}</ul>`;
    }
  });
}
const CSS_B = `.rcB-body{display:flex;flex-direction:column;gap:10px;padding:4px 14px 14px}
  .rcB-seg{display:inline-flex;border:1px solid #b9c6d6;border-radius:7px;overflow:hidden;align-self:flex-start}
  .rcB-seg button{font:inherit;font-size:13px;font-weight:700;border:0;background:#fff;color:#1f3d63;padding:6px 14px;cursor:pointer}
  .rcB-seg button.is-on{background:#2f5b8f;color:#fff}
  .rcB-pick{display:flex;gap:8px;align-items:center}.rcB-pick>span{font-weight:700;min-width:60px}.rcB-pick select{font:inherit;padding:4px 8px;min-width:180px;border:1px solid #c5ced9;border-radius:6px}
  .rcB-rows{list-style:none;margin:0;padding:0;border:1px solid #e1e7ee;border-radius:8px}
  .rcB-rows li{display:grid;grid-template-columns:1fr 18px auto 64px;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid #eef1f5;font-size:13px}
  .rcB-rows li:first-child{border-top:0}.rcB-how{color:#3e4a57}.rcB-to{color:#7b8794}.rcB-n{text-align:right;color:#3e4a57;font-variant-numeric:tabular-nums}
  .rcB-tab.rcB-tab{background:#2f5b8f;color:#fff}.rcB-tab small{color:#dfe9f5}
  .rcB-pane{display:flex;flex-direction:column;gap:10px;padding:10px 0}
  .rcB-card{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;border:1px solid #2f5b8f;background:#f3f7fc;border-radius:8px;padding:10px 12px}
  .rcB-card>div:first-child{display:flex;flex-direction:column;gap:2px}.rcB-card small{color:#56606c;font-size:12px}.rcB-vals{display:flex;gap:4px}
  .rcB-pane>.rc-btn{align-self:flex-start}
  .rcB-try li{display:grid;grid-template-columns:1fr 24px 96px;align-items:center;padding:5px 8px;font-size:13px}.rcB-try li .rc-chip{justify-self:start}`;

/* ------------------------------------------------------------------ C 作り方の組み立てとルールを 1 つに（減らし方: 組み立ての窓を 1 つに・言葉を「ルール」に） */
function propC() {
  const R = window.RC;
  R.keep(() => {
    R.common();
    if (R.inCols()) {
      R.setNow("fx", `組み立て（ルール「${R.RULE}」）`);
      R.setNow("rule", "作り方のルールで決まる", false);
      const h = R.step("rule") && R.step("rule").querySelector("h4");
      if (h && !h.dataset.rcC) { h.dataset.rcC = "1"; h.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.includes("読み替え")) n.textContent = "色・読み替え"; }); }
      const rs = R.step("rule");
      if (rs && !rs.dataset.rcC) { rs.dataset.rcC = "1"; rs.querySelector(".lc-field")?.insertAdjacentHTML("beforebegin", `<small class="rc-note">この列は「この列の作り方」をルール「${R.RULE}」で組み立てています。値と色はそこで決まるので、ここで別のルールを重ねなくて構いません。</small>`); }
    }
    const rp = R.rulePanel();
    if (rp && !rp.dataset.rcC) {
      rp.dataset.rcC = "1";
      const t = rp.querySelector(".lr-title"); if (t) t.textContent = `ルール「${R.RULE}」`;
      const eb = rp.querySelector(".lc-eyebrow"); if (eb) eb.textContent = "ルール（作り方の組み立てと同じ。名前を付けてほかの列でも使う）";
      rp.querySelector(".lr-mode")?.insertAdjacentHTML("beforebegin", `<div class="lr-tabs rcC-tabs"><button type="button" class="is-on">組み立てる<small>条件で分ける・色</small></button><button type="button">式を書く<small>計算・文字の加工など</small></button></div>`);
    }
    const fx = R.newOpen();
    if (fx && !fx.dataset.rcC) {
      fx.dataset.rcC = "1";
      const lead = fx.querySelector(".lr-pane[data-pane=build] .lr-head");
      const bar = `<div class="rcC-bar"><span>ルールから始める</span><select><option>（使わない）</option><option>${R.RULE}（3 行）</option></select>
        <label><input type="checkbox"> 名前を付けてルールに保存（ほかの列でも使う）</label></div>`;
      if (lead) lead.insertAdjacentHTML("afterend", bar); else fx.querySelector(".lr-rows")?.insertAdjacentHTML("beforebegin", bar);
      fx.querySelectorAll(".lr-row .lr-text").forEach((inp) => inp.insertAdjacentHTML("afterend", '<select class="rcC-color" aria-label="色"><option>色なし</option><option>● 良い</option><option>● 悪い</option><option>● 注意</option><option>● 目立たせない</option></select>'));
      const eb = fx.querySelector(".lc-eyebrow"); if (eb) eb.textContent = "この列の作り方（ルール）";
    }
  });
}
const CSS_C = `.rcC-bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:4px 0 10px;padding:8px 10px;border:1px dashed #b9c6d6;border-radius:8px;background:#f7f9fc;font-size:13px}
  .rcC-bar>span{font-weight:700}.rcC-bar select{font:inherit;padding:3px 6px;border:1px solid #c5ced9;border-radius:6px}.rcC-bar label{display:flex;gap:4px;align-items:center;color:#3e4a57}
  .rcC-color{font:inherit;font-size:13px;padding:4px 6px;border:1px solid #c5ced9;border-radius:6px;background:#fffdf5;max-width:120px}
  .rcC-tabs{margin:0 0 8px}`;

/* ------------------------------------------------------------------ D ルールの表を札で見せる（見せ方: 条件 → 値 → 件数を形で） */
function propD() {
  const R = window.RC;
  R.keep(() => {
    R.common();
    // 一覧の見出し: ルールで作る列の印（≡）
    const th = document.querySelector(`#llHead tr:first-child th[data-col="${R.RULE}"]`);
    if (th && !th.querySelector(".rcD-mk")) th.insertAdjacentHTML("beforeend", '<i class="rcD-mk" title="ルールで作る列" aria-label="ルールで作る列">≡</i>');
    if (R.inCols()) {
      R.setNow("fx", `ルール「${R.RULE}」で作る`);
      const nm = document.querySelector(`#lcList li[data-col="${R.RULE}"] .lc-name`);
      if (nm && !nm.querySelector(".rc-tag")) nm.insertAdjacentHTML("beforeend", `<span class="rc-tag" title="ルール「${R.RULE}」で作る列">≡ ルール ${R.RULE}</span>`);
      const card = document.querySelector("#lcDetail .lc-card");
      if (card && !card.dataset.rcD) {
        card.dataset.rcD = "1";
        const max = Math.max(1, ...R.VALUES.map(([v]) => R.n(v)));
        card.querySelector("dl").insertAdjacentHTML("afterend", `<div class="rcD-tbl"><div class="rcD-cap"><b>≡ ルール「${R.RULE}」で作る列</b><button type="button" class="rc-btn">ルールを編集</button></div>
          ${R.VALUES.map(([v, c, how]) => `<div class="rcD-row"><span class="rcD-how">${R.esc(how)}</span>${R.chip(v, c)}<span class="rcD-bar"><i class="cell-${c}" style="width:${Math.round((R.n(v) / max) * 100)}%"></i></span><span class="rcD-n">${R.n(v)}</span></div>`).join("")}</div>`);
      }
    }
    const rp = R.rulePanel();
    if (rp && R.counts && !rp.querySelector(".rcD-sum")) {
      const tot = R.total;
      rp.querySelector(".lr-try-list")?.insertAdjacentHTML("beforebegin", `<div class="rcD-sum"><small>先頭 ${tot} 行の答え</small><div class="rcD-stack">${R.VALUES.map(([v, c]) => `<i class="cell-${c}" style="flex:${R.n(v)}" title="${v} ${R.n(v)} 件"></i>`).join("")}</div>
        <div class="rcD-leg">${R.VALUES.map(([v, c]) => `${R.chip(v, c)}<b>${R.n(v)}</b>`).join("")}</div></div>`);
    }
    const fx = R.newOpen();
    if (fx && !fx.dataset.rcD) {
      fx.dataset.rcD = "1";
      fx.querySelector(".lr-rows")?.insertAdjacentHTML("beforebegin", `<div class="rcD-start"><span>保存したルールから始める</span><button type="button" class="rc-btn">≡ ${R.RULE} <small>${R.VALUES.map(([v]) => v).join("・")}</small></button><button type="button" class="rc-btn">＋ 新しいルール…</button></div>`);
    }
  });
}
const CSS_D = `.rcD-mk{position:absolute;left:4px;top:2px;font-style:normal;font-weight:800;font-size:11px;line-height:1;color:#e4d8ff}
  .rcD-tbl{margin-top:10px;border-top:1px solid #e1e7ee;padding-top:8px;display:flex;flex-direction:column;gap:6px}
  .rcD-cap{display:flex;justify-content:space-between;align-items:center;gap:8px}.rcD-cap b{color:#4f2f8a}
  .rcD-row{display:grid;grid-template-columns:minmax(0,1fr) auto 110px 40px;gap:8px;align-items:center;font-size:13px}
  .rcD-how{color:#3e4a57;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rcD-n{text-align:right;font-variant-numeric:tabular-nums}
  .rcD-bar{height:10px;background:#eef1f5;border-radius:5px;overflow:hidden}.rcD-bar i,.rcD-stack i{display:block;height:100%}
  .rcD-bar i.cell-ok,.rcD-stack i.cell-ok{background:#3c9a62}.rcD-bar i.cell-warn,.rcD-stack i.cell-warn{background:#d99a2b}.rcD-bar i.cell-muted,.rcD-stack i.cell-muted{background:#a7b1bd}
  .rcD-sum{margin:6px 0 8px;display:flex;flex-direction:column;gap:5px}.rcD-sum small{color:#56606c}
  .rcD-stack{display:flex;height:12px;border-radius:6px;overflow:hidden}.rcD-leg{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:12.5px}.rcD-leg b{margin-right:6px}
  .rcD-start{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:2px 0 10px;font-size:13px}.rcD-start>span{font-weight:700}.rcD-start small{color:#56606c;font-weight:600}`;

/* ------------------------------------------------------------------ E ルールの窓・読み替えの段から列を作る（流れの変え方: 入口をルールの側に） */
function propE() {
  const R = window.RC;
  R.keep(() => {
    R.common();
    if (R.inCols()) {
      R.setNow("fx", `ルール「${R.RULE}」の答え`);
      const rs = R.step("rule");
      if (rs && !rs.dataset.rcE) {
        rs.dataset.rcE = "1";
        rs.querySelector(".lc-hint")?.insertAdjacentHTML("beforebegin", `<div class="rcE-make"><button type="button" class="rc-btn">＋ このルールの答えで新しい列を作る</button><small>元の値を使わないルール（ほかの列だけを見る）なら、その答えだけの列にできます</small></div>`);
      }
    }
    const rp = R.rulePanel();
    if (rp && !rp.dataset.rcE) {
      rp.dataset.rcE = "1";
      const save = rp.querySelector("[data-act=save]");
      save?.insertAdjacentHTML("beforebegin", `<button type="button" class="rc-btn rcE-foot" title="このルールの答えだけを値にする列を、表に足します">＋ このルールで列を作る</button>`);
      const sub = rp.querySelector(".lr-usage"); if (sub) sub.textContent = `使っている列: 仕掛・${R.RULE}（このルールの答えだけの列）`;
    }
    const fx = R.newOpen();
    if (fx && !document.querySelector(".rcE-menu")) {
      fx.style.visibility = "hidden";
      const b = document.querySelector("#lcAddCol").getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", `<div class="rcE-menu tpa-menu" style="left:${Math.round(b.left)}px;top:${Math.round(b.bottom + 4)}px" role="menu">
        <button type="button" role="menuitem"><span>ƒx</span>式で作る…<small>組み立てる・式を書く</small></button>
        <div class="rcE-sep">ルールの答えで作る</div>
        <button type="button" role="menuitem" class="is-hot"><span>≡</span>${R.RULE}<small>5052厚板・3000系・その他</small></button>
        <button type="button" role="menuitem"><span>＋</span>新しいルールを作って足す…</button>
        <div class="rcE-sep"></div>
        <button type="button" role="menuitem"><span>⇄</span>変換表（マスタ）で足す…<small>当てられる 1</small></button></div>`);
    }
  });
}
const CSS_E = `.rcE-make{display:flex;flex-direction:column;gap:4px;margin:8px 0}.rcE-make .rc-btn{align-self:flex-start}.rcE-make small{color:#56606c;font-size:12px}
  .rcE-foot{margin-right:auto}
  .rcE-menu{position:fixed;z-index:9999;min-width:330px;background:#fff;border:1px solid #c5ced9;border-radius:8px;box-shadow:0 10px 28px rgba(16,32,52,.2);padding:6px;display:flex;flex-direction:column;font-size:13.5px}
  .rcE-menu button{display:grid;grid-template-columns:24px 1fr;column-gap:8px;text-align:left;font:inherit;border:0;background:none;padding:6px 8px;border-radius:6px;cursor:pointer}
  .rcE-menu button small{grid-column:2;color:#56606c;font-size:12px}.rcE-menu button span{grid-row:span 2;font-weight:800;color:#244569}
  .rcE-menu button.is-hot{background:#eef4fb}
  .rcE-sep{border-top:1px solid #e1e7ee;margin:4px 2px;padding-top:4px;font-size:11.5px;color:#56606c;font-weight:700}`;

/* ------------------------------------------------------------------ F ルールを変換表の帯に並べる（置き場: 変換表に寄せる） */
function propF() {
  const R = window.RC;
  R.keep(() => {
    R.common();
    const conv = document.querySelector("#llColumnPanel:not([hidden]) #lcConv");
    if (conv && !conv.hidden && !conv.querySelector(".rcF-list")) {
      const txt = conv.querySelector(".lc-cvtxt");
      if (txt) txt.innerHTML = "当てられる 変換表 <b>1</b>（マスタ）・ルール <b>1</b>（この PC。列を足した）";
      const mode = R.newOpen() ? "new" : "cols";
      conv.insertAdjacentHTML("beforeend", `<div class="rcF-list${mode === "new" ? " is-new" : ""}">
        <div class="rcF-g">マスタの変換表</div>
        <div class="rcF-r"><span class="lc-cvtag is-add">変換表</span><b>管理分類</b><small>合金・調質・板厚 → 管理分類</small><button type="button" class="rc-btn">列を足す</button></div>
        <div class="rcF-g">ルール（この PC。条件 → 値・色）</div>
        <div class="rcF-r is-on"><span class="rc-tag">ルール</span><b>${R.RULE}</b><small>合金・板厚 → ${R.VALUES.map(([v]) => v).join("・")}</small><button type="button" class="rc-btn" disabled>✓ 列「${R.RULE}」を足した</button></div>
        <div class="rcF-r"><span class="rc-tag">ルール</span><b>＋ 新しいルールを作って足す…</b><small></small></div></div>`);
    }
    if (R.inCols()) {
      R.setNow("fx", `ルール「${R.RULE}」で足した列`);
      const nm = document.querySelector(`#lcList li[data-col="${R.RULE}"] .lc-name`);
      if (nm && !nm.querySelector(".rc-tag")) nm.insertAdjacentHTML("beforeend", `<span class="rc-tag" title="ルール「${R.RULE}」で足した列">＋列 ${R.RULE}</span>`);
    }
    const fx = R.newOpen();
    if (fx && !fx.dataset.rcF) {
      fx.dataset.rcF = "1";
      fx.querySelector(".lr-rows")?.insertAdjacentHTML("beforebegin", `<div class="rcF-hint">条件で区分を作るなら、表示列の窓の帯「変換表・ルール」から足せます（色つき・ほかの列でも使える）。<button type="button" class="rc-btn">帯で選ぶ…</button></div>`);
    }
  });
}
const CSS_F = `.rcF-list{display:flex;flex-direction:column;gap:4px;margin-top:8px;font-size:13px}
  .rcF-g{font-size:11.5px;font-weight:800;color:#56606c;margin-top:4px}
  .rcF-r{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:5px 8px;border:1px solid #e1e7ee;border-radius:7px;background:#fff}
  .rcF-r.is-on{border-color:#8f74c6;background:#f7f3fd}.rcF-r small{color:#56606c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rcF-r .lc-cvtag,.rcF-r .rc-tag{margin-left:0}
  .rcF-hint{margin:2px 0 10px;padding:8px 10px;border-radius:8px;background:#f7f3fd;border:1px solid #d8ccef;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}`;

const mk = (key, name, fn, css) => ({ key, name, css: "", ops: [["script", `${LIB} (() => { const s = document.createElement("style"); s.textContent = window.RC.css + ${JSON.stringify(css)}; document.head.append(s); })(); (${fn})();`]] });
export const PROPOSALS = [
  mk("A", "「＋ 列を作る」で作り方を選ぶ（ルール・式・変換表）", propA, CSS_A),
  mk("B", "作り方の段で「式｜ルール」を選ぶ（読み替えの段を作り方へ）", propB, CSS_B),
  mk("C", "作り方の組み立てとルールを 1 つに（色・ルールに保存）", propC, CSS_C),
  mk("D", "ルールの表を札で見せる（条件 → 値 → 件数）", propD, CSS_D),
  mk("E", "ルールの窓・読み替えの段から列を作る", propE, CSS_E),
  mk("F", "ルールを変換表の帯に並べて足す", propF, CSS_F),
];
