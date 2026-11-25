// 改良「計算列を集計表・グラフで使う」（利用者の改良依頼 2026-11-17 の 1「計算列を集計表・グラフで使えるようにしてほしい」）の案（回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面（ui-harness.mjs の calc-list 〜 calc-off。版 3.121.0 で足した）: 品質の表「仕掛」の表示列に計算列 3 つ
//   重量t＝[重量]/1000（数）・材調質＝concat([合金], "-", [調質])（字）・板厚区分＝if([板厚]>=1, "厚", "薄")（区分）を作り、
//   calc-list（一覧）→ calc-cols（表示列の窓で 重量t を選んだ所）→ pivot-calc（集計表・グラフ。合金ごとの重量の合計・縦棒）
//   → dash-calc（ダッシュボードの組む所。データを品質にし、板厚区分を行・重量t を値に入れた所）。
//
//   TPA_UI_EXE=…/ui_serve node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-calcpivot.mjs \
//     --from calc-list --states calc-list,calc-cols,pivot-calc,dash-calc          （--view 1536x864・--view 1280x720 でも）
//
// 今（版 3.120.0）: 一覧の「集計表・グラフ」のカラムの欄に計算列が出ない（窓の lot.rs の集計の道が calc: None で問い合わせ、画面も式を送らない）。
//   ダッシュボードの組む所には出る（式の印つき。値で合計できる）が、40 列の後ろに並び、送らないと見えない。
//
// どの案も中身は同じ（common_build）: 一覧の集計表が今の表の計算列の式（LotListColumns.calcFor と同じ形）を fields と問い合わせに添え、
//   窓（lot.rs の集計の道）が pivot::fields・pivot::query に calc を渡す（ダッシュボードと同じ formula::register の道）。
//   案の画面では、集計表の問い合わせを頁の中で同じ式つきのダッシュボードの道（POST /api/dashboard/fields・/api/dashboard/query）へ
//   回して、本物の数（窓が数えた数）を出す。案ごとに違うのは、計算列をどこに・どう見せ、どの流れで使わせるか。

/* ------------------------------------------------------------------ 共通の部品（頁の中で動く。window.CP） */
function lib() {
  if (window.CP) return;
  const P = (window.CP = {});
  const esc = (P.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
  /** fn を繰り返し当てる（画面が描き直しても案の部品を保つ） */
  P.keep = (fn, ms = 150) => { const t = () => { try { fn(); } catch (e) { console.warn("案:", e.message); } }; t(); setInterval(t, ms); };
  const TARGET = "lotlist:仕掛";
  P.FORMULA = { "重量t": "[重量]/1000", "材調質": 'concat([合金], "-", [調質])', "板厚区分": 'if([板厚]>=1, "厚", "薄")' };
  P.DEP = { "重量t": "重量", "材調質": "調質", "板厚区分": "板厚" };
  P.ctx = () => (window.LotListColumns && LotListColumns.formulaContext ? LotListColumns.formulaContext((k) => k === TARGET) : { formulas: {}, names: {} });
  P.isCalc = (c) => c in P.ctx().formulas;
  /* 集計表の問い合わせに式を添える（作るときは lot.rs が calc を受ける。案では同じ式つきのダッシュボードの道で窓に数えさせる） */
  const of = window.fetch.bind(window);
  window.fetch = async (u, o) => {
    const url = typeof u === "string" ? u : (u && u.url) || "";
    if (/^\/api\/lotlist\/pivot\?/.test(url) && !P.off) {
      const q = new URLSearchParams(url.split("?")[1]), ctx = P.ctx();
      if (!Object.keys(ctx.formulas).length) return of(u, o);
      const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
      if (q.get("fields") === "1") {
        const d = await (await of(u, o)).json();
        const f = await (await of("/api/dashboard/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "lot", equip: "", calc: ctx }) })).json();
        d.fields = (d.fields || []).concat((f.fields || []).filter((x) => x.calc));
        return json(d);
      }
      const arr = (k) => { try { return JSON.parse(q.get(k) || "[]"); } catch (_) { return []; } };
      const rows = arr("rows"), cols = arr("cols"), measures = arr("measures");
      if ([...rows, ...cols, ...measures].some((d) => d && d.column in ctx.formulas)) {
        const panel = { id: "cp", source: "lot", equip: "", calc: ctx, search: q.get("search") || "", filters: arr("filters"), body: { rows, cols, measures, sub: true, grand: true } };
        return of("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel }) });
      }
    }
    return of(u, o);
  };
  /** 集計表で計算列を使って見せる（撮る状態 pivot-calc が 合金を行・重量を値に入れたら、1 度だけ 重量 → 重量t・板厚区分を列に） */
  P.useInPivot = () => {
    if (P.used) return;
    const f = (c, r) => document.querySelector(`#llPvFields .pv-f[data-col="${c}"] [data-pv-add="${r}"]`);
    const on = (c) => document.querySelector(`#llPivot .pv-slot [title^="${c}"]`);
    if (!f("重量t", "vals") || !f("重量", "vals") || !f("重量", "vals").classList.contains("on") || !document.querySelector('#llPivot .pv-slot[data-role="rows"] .pv-chip')) return;
    P.used = true;
    f("重量", "vals").click();
    setTimeout(() => { f("重量t", "vals")?.click(); setTimeout(() => f("板厚区分", "cols")?.click(), 120); }, 120);
    // 使った計算列の札が見える所まで欄を送る（狭い画面では、撮る状態が押した 重量 のあたりへ送られている）
    setTimeout(() => P.reveal("#llPvFields"), 900);
    void on;
  };
  /** 欄の 1 つ目の計算列の札が見えるように送る（1 度だけ。組む所は札が出たら） */
  P.reveal = (box) => { const x = P.cards(box)[0], list = document.querySelector(box); if (!x || !list) return; const sc = list.closest(".pv-list") || list; const r = x.getBoundingClientRect(), b = sc.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) sc.scrollTop += r.top - b.top - 80; };
  P.keep(() => {
    if (!P.dashSeen && P.cards("#deFields").length && document.querySelector('#deFields .pv-f[data-dnd-col="重量t"] .pv-r.on')) P.dashSeen = Date.now();
    if (P.dashSeen && Date.now() - P.dashSeen < 5000) P.reveal("#deFields");    // 組み直しで欄が描き直る間は送り直す
  }, 300);
  /** 札（一覧の集計表 #llPvFields・組む所 #deFields）の計算列の札 */
  P.cards = (box) => [...document.querySelectorAll(`${box} .pv-f`)].filter((x) => P.isCalc(x.dataset.col || x.dataset.dndCol || ""));
  P.colOf = (x) => x.dataset.col || x.dataset.dndCol || "";
  /** 札の名前の横に「式」の印（組む所の今の印 sx-calc と同じ形・同じ色） */
  P.mark = (card) => { const b = card.querySelector("b"); if (b && !b.querySelector(".sx-calc")) b.insertAdjacentHTML("beforeend", '<small class="sx-calc">式</small>'); };
  /** 元の列の札のすぐ下へ動かす */
  P.underDep = (box) => P.cards(box).forEach((x) => {
    const dep = document.querySelector(`${box} .pv-f[data-col="${P.DEP[P.colOf(x)]}"], ${box} .pv-f[data-dnd-col="${P.DEP[P.colOf(x)]}"]`);
    if (dep && dep.nextElementSibling !== x) dep.after(x);
    x.classList.add("cp-under");
  });
  /** 札の欄の頭（ロット数・件数の後ろ）へ「計算列」のまとまりを作る */
  P.group = (box, addBtn) => {
    const list = document.querySelector(box); if (!list) return;
    const cards = P.cards(box); if (!cards.length) return;
    let head = list.querySelector(".cp-ghead");
    if (!head) {
      head = document.createElement("div"); head.className = "cp-ghead";
      head.innerHTML = `<b>計算列</b><small>表示列で作った列</small><span class="cp-n"></span>${addBtn ? '<button type="button" class="cp-add" title="式から列を作る">＋ 作る</button>' : ""}`;
      const raw = document.createElement("div"); raw.className = "cp-ghead is-raw"; raw.innerHTML = "<b>元の列</b><small>データの列</small>";
      list.prepend(raw); list.prepend(head);
    }
    head.querySelector(".cp-n").textContent = String(cards.length);
    const specials = [...list.querySelectorAll(".pv-f.is-special")];
    const anchor = specials[specials.length - 1];
    if (anchor && head.previousElementSibling !== anchor) anchor.after(head);
    let at = head;
    cards.forEach((x) => { if (at.nextElementSibling !== x) at.after(x); at = x; x.classList.add("cp-in"); });
    const raw = list.querySelector(".cp-ghead.is-raw");
    if (raw && at.nextElementSibling !== raw) at.after(raw);
  };
  /** 札に種類の印（数・字・日付・式）と、計算列は式の中身を下の段に */
  P.kinds = (box) => [...document.querySelectorAll(`${box} .pv-f`)].forEach((x) => {
    const span = x.querySelector(":scope > span"); if (!span || x.querySelector(".cp-k")) return;
    const c = P.colOf(x), calc = P.isCalc(c), sm = span.querySelector("small"), t = sm ? sm.textContent : "";
    const sp = x.classList.contains("is-special"), cnt = sp && /ロット数|件数/.test(span.textContent);
    const k = calc ? ["fx", "ƒx"] : cnt ? ["sp", "Σ"] : sp ? ["s", "設"] : /日付/.test(t) || x.classList.contains("is-date") ? ["d", "日"] : /^数/.test(t) || x.classList.contains("is-num") ? ["n", "123"] : ["s", "字"];
    span.insertAdjacentHTML("afterbegin", `<i class="cp-k k-${k[0]}" aria-hidden="true">${k[1]}</i>`);
    x.classList.add("cp-kinded");
    if (calc) {
      x.classList.add("cp-fx");
      if (sm) sm.innerHTML = `<code>= ${esc(P.ctx().formulas[c])}</code><span>${esc(t.replace(/^式の列 · /, ""))}</span>`;
    }
  });
  /** 組む所: データが品質のとき、案の数を同じに（撮る状態の行と値は今と同じ） */
  P.inDash = () => !!document.querySelector("#deFields .pv-f");
}

const BASE_CSS = `
#deFields .pv-f > span > b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.cp-fxmark{margin-left:5px;padding:0 4px;border-radius:4px;background:var(--input-soft);color:var(--h-input);font-size:10px;font-weight:800}
`;

/* ------------------------------------------------------------------ A: 元の列のすぐ下に並べる（式の印） */
function propA() {
  CP.keep(() => {
    CP.cards("#llPvFields").forEach(CP.mark);
    CP.underDep("#llPvFields"); CP.underDep("#deFields");
    CP.useInPivot();
  });
}
const CSS_A = `
.pv-f.cp-under{margin-left:10px;border-left:3px solid var(--h-input)}
#deFields .pv-f.cp-under{margin-left:6px}
.pv-f.cp-under > span b{white-space:nowrap}
#llPvFields .pv-f.cp-under > span b::before{content:"└ ";color:var(--muted);font-weight:400}
`;

/* ------------------------------------------------------------------ B: カラムの欄の頭に「計算列」のまとまり（＋ 計算列 もここ） */
function propB() {
  CP.keep(() => {
    CP.cards("#llPvFields").forEach(CP.mark);
    CP.group("#llPvFields", true); CP.group("#deFields", true);
    // 組む所の検索の横の「＋ 計算列」は、まとまりの頭に移した（同じ置き場）
    document.querySelectorAll("[data-de-calcnew]").forEach((b) => { if (!b.closest(".cp-ghead")) b.classList.add("cp-hide"); });
    CP.useInPivot();
  });
}
const CSS_B = `
.cp-ghead{display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;column-gap:6px;margin:8px 2px 4px;padding:6px 2px 2px;border-top:1px solid var(--line, #d7dee7)}
.cp-ghead b{font-size:13px;white-space:nowrap}
.cp-ghead small{grid-row:2;grid-column:1 / -1;font-size:11.5px;color:var(--muted, #5b6776);white-space:nowrap}
.cp-ghead .cp-n{font:700 11.5px system-ui;color:var(--h-input);background:var(--input-soft);border-radius:9px;padding:0 7px}
.cp-ghead .cp-add{grid-column:4;white-space:nowrap;border:1px solid var(--h-input);background:#fff;color:var(--h-input);border-radius:6px;font:700 12px system-ui;padding:2px 8px;cursor:pointer}
.cp-ghead.is-raw{grid-template-columns:auto 1fr}
.cp-ghead.is-raw small{grid-row:1;grid-column:2}
.pv-f.cp-in{border-left:3px solid var(--h-input)}
.cp-hide{display:none !important}
`;

/* ------------------------------------------------------------------ C: 一覧の計算列の見出しから集計表へ（Σ の面） */
function propC() {
  CP.keep(() => {
    // 一覧: 計算列の見出しに Σ（押すと面。撮る絵では 重量t の面を開いた所）
    document.querySelectorAll("#llHead th.is-calc").forEach((th) => {
      if (!th.querySelector(".cp-sig")) th.insertAdjacentHTML("beforeend", '<button type="button" class="cp-sig" title="この計算列で集計表・グラフを組む">Σ</button>');
    });
    const th = document.querySelector('#llHead th.is-calc[data-col="重量t"]');
    const listOn = th && !document.querySelector("#lotListScreen.is-pivot") && document.querySelector("#lotListScreen") && document.querySelector("#lotListScreen").offsetParent && !document.querySelector("#llColumnPanel:not([hidden])");
    let pop = document.getElementById("cpPop");
    if (listOn && !pop) {
      pop = document.createElement("div"); pop.id = "cpPop"; pop.className = "cp-pop";
      pop.innerHTML = `<div class="cp-ph"><b>重量t を集計する</b><small>計算列 = ${CP.esc(CP.FORMULA["重量t"])}・数</small></div>`
        + '<button type="button" class="cp-pb is-main"><b>値（合計）に置いて集計表へ</b><small>いまの絞り込みの 1,500 行で数える</small></button>'
        + '<button type="button" class="cp-pb"><b>行に置いて集計表へ</b><small>値の区間（ヒストグラム）ごとの件数</small></button>'
        + '<button type="button" class="cp-pb"><b>ダッシュボードのパネルにする…</b><small>組む所を開き、値に入れておく</small></button>';
      document.body.append(pop);
      th.querySelector(".cp-sig")?.classList.add("on");
    }
    if (pop) {
      if (!listOn) { pop.remove(); document.querySelectorAll(".cp-sig.on").forEach((b) => b.classList.remove("on")); }
      else { const r = th.getBoundingClientRect(); pop.style.left = `${Math.min(r.left, innerWidth - 340)}px`; pop.style.top = `${r.bottom + 4}px`; }
    }
    // 集計表: 一覧の計算列は名前の横に「一覧の式」
    CP.cards("#llPvFields").forEach(CP.mark);
    CP.useInPivot();
  });
}
const CSS_C = `
#llHead th.is-calc{position:relative}
#llHead th.is-calc:hover,#llHead th.is-calc:has(.cp-sig.on){padding-right:24px !important}
.cp-sig{display:none}
#llHead th.is-calc:hover .cp-sig,.cp-sig.on{display:block}
.cp-sig{position:absolute;right:16px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:5px;border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.14);color:#fff;font:800 12px system-ui;line-height:18px;padding:0;cursor:pointer}
.cp-sig.on{background:#fff;color:var(--h-input)}
.cp-pop{position:fixed;z-index:60;width:320px;background:#fff;border:1px solid #c5ced9;border-radius:10px;box-shadow:0 10px 30px rgba(16,32,48,.22);padding:10px;display:flex;flex-direction:column;gap:6px}
.cp-ph{display:flex;flex-direction:column;gap:2px;padding:0 2px 4px;border-bottom:1px solid #e3e8ee}
.cp-ph b{font-size:14px}.cp-ph small{font-size:12px;color:#5b6776}
.cp-pb{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;border:1px solid #d7dee7;background:#f7f9fb;border-radius:8px;padding:6px 10px;cursor:pointer}
.cp-pb b{font-size:13px;color:#16202b}.cp-pb small{font-size:11.5px;color:#5b6776}
.cp-pb.is-main{border-color:var(--h-input);background:var(--input-soft)}
`;

/* ------------------------------------------------------------------ D: 札に種類の印（数・字・日付・式）と式の中身（一覧の集計表と組む所で同じ形） */
function propD() {
  CP.keep(() => {
    CP.kinds("#llPvFields"); CP.kinds("#deFields");
    // 計算列は数える物（ロット数・件数）のすぐ後ろ（見出しは付けない。ƒx の印と左の線で分かる）
    ["#llPvFields", "#deFields"].forEach((box) => {
      const sp = [...document.querySelectorAll(`${box} .pv-f.is-special`)]; let at = sp[sp.length - 1];
      if (at) CP.cards(box).forEach((x) => { if (at.nextElementSibling !== x) at.after(x); at = x; });
    });
    CP.useInPivot();
  });
}
const CSS_D = `
.pv-f.cp-kinded > span{display:grid;grid-template-columns:auto 1fr;column-gap:7px;align-items:center}
.pv-f.cp-kinded > span > b,.pv-f.cp-kinded > span > small{grid-column:2;min-width:0}
#deFields .pv-f.cp-kinded > span{column-gap:5px}
#deFields .cp-k{width:22px;font-size:10px}
.cp-k{grid-row:1 / span 2;width:26px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font:800 11px system-ui;font-style:normal;background:#eef1f5;color:#3b4756}
.cp-k.k-n{background:#e6f0fb;color:#1f5a96}.cp-k.k-d{background:#eaf5ec;color:#2b6a3a}.cp-k.k-fx{background:var(--input-soft);color:var(--h-input)}.cp-k.k-sp{background:#fbefdf;color:#8a5208}
.pv-f.cp-fx{border-left:3px solid var(--h-input)}
.pv-f.cp-fx small code{font:11px ui-monospace,Menlo,Consolas,monospace;color:#3b4756;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:100%}
.pv-f.cp-fx small{display:flex;flex-direction:column;min-width:0}
.pv-f.cp-fx b .sx-calc{display:none}
`;

/* ------------------------------------------------------------------ E: 「すぐに見る」に計算列の組み方（作った計算列から自動で 2 つ） */
function propE() {
  CP.keep(() => {
    CP.cards("#llPvFields").forEach(CP.mark);
    const row = document.querySelector("#llPivot .pv-quickbig") || document.querySelector("#llPivot .pv-quick")?.parentElement;
    if (row && !row.querySelector(".cp-q")) {
      const one = row.querySelector(".pv-quick");
      const add = (text, tip) => { const b = one ? one.cloneNode(false) : document.createElement("button"); b.removeAttribute("data-pv-quick"); b.className = "pv-quick cp-q"; b.title = tip; b.innerHTML = `<i class="cp-qfx">ƒx</i><span>${text}</span>`; return b; };
      const before = row.querySelector(".pv-quick");
      if (innerWidth < 1600) [...row.querySelectorAll(".pv-quick:not(.cp-q)")].slice(-2).forEach((b) => b.classList.add("cp-hide"));   // 狭い画面: 既定の後ろ 2 つは「組み方 ▾」へ（1 段に収める）
      [add("板厚区分ごとの重量t", "計算列 重量t の合計を値・板厚区分を行に"), add("材調質ごとの件数", "計算列 材調質を行に")].forEach((b) => (before ? before.before(b) : row.append(b)));
    }
    CP.useInPivot();
  });
}
const CSS_E = `
.cp-hide{display:none !important}
.cp-q{border-color:var(--h-input) !important}
.cp-qfx{font:800 10.5px system-ui;font-style:normal;color:var(--h-input);background:var(--input-soft);border-radius:4px;padding:0 4px;margin-right:4px}
`;

/* ------------------------------------------------------------------ F: 表示列の窓の「この列の作り方」の下に「集計表・グラフで使う」 */
function propF() {
  CP.keep(() => {
    const box = document.getElementById("lcDetail");
    const fx = box && box.querySelector('.lc-step[data-step="fx"]');
    const name = box && (box.querySelector(".lc-head b, .lc-dtitle, h3, b") || {}).textContent;
    if (fx && /重量t|材調質|板厚区分/.test(box.textContent.slice(0, 40)) && !box.querySelector(".cp-use")) {
      fx.insertAdjacentHTML("afterend", `<section class="cp-use"><div class="cp-uh"><i>Σ</i><b>集計表・グラフで使う</b><small>この列は集計表・グラフとダッシュボードのカラムに「式」の札で並びます</small></div>`
        + '<div class="cp-ub"><span class="cp-ul">集計表で</span><button type="button" class="cp-btn is-main">値（合計）に置く</button><button type="button" class="cp-btn">行に置く</button><span class="cp-ul">｜</span><button type="button" class="cp-btn">パネルにする…</button></div>'
        + '<small class="cp-un">数の列なので 合計・平均・最小・最大 にできます（集計表の値の札で替える）</small></section>');
    }
    void name;
    CP.cards("#llPvFields").forEach(CP.mark);
    CP.useInPivot();
  });
}
const CSS_F = `
.cp-use{margin:0 0 10px;border:1px solid var(--h-input);border-radius:10px;background:var(--input-soft);padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.cp-uh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.cp-uh i{font:800 12px system-ui;font-style:normal;color:#fff;background:var(--h-input);border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center}
.cp-uh b{font-size:15px}.cp-uh small{font-size:12px;color:#3b4756;flex-basis:100%;padding-left:30px}
.cp-ub{display:flex;gap:6px;align-items:center;flex-wrap:nowrap;padding-left:30px}
.cp-ul{font-size:12px;color:#3b4756;white-space:nowrap}
.cp-btn{white-space:nowrap;border:1px solid #c5ced9;background:#fff;border-radius:7px;padding:5px 10px;font:700 12.5px system-ui;color:#16202b;cursor:pointer}
.cp-btn.is-main{background:var(--h-input);border-color:var(--h-input);color:#fff}
.cp-un{font-size:11.5px;color:#5b6776;padding-left:30px}
`;


/* ================================================================== 回 2（採点 1 回目の first_fixes・next_round を受けて）
   どの案にも共通の直し（lib2。作るときも一緒に直す）:
   ① 1280 で、すぐに見るの札が長く「組み方 ▾」が 2 段目へ折れる → 入らない札を後ろから「組み方 ▾」へ（1 段に収める）
   ② 表の小数の桁を値ごとにそろえる（547.056 と 1,116.7 → 547.1 と 1,116.7）
   ③ 一覧・表示列の窓の計算列の値の小数の誤差を丸める（3.7053000000000003 → 3.7053）
   ④ 組む所・集計表の値の計算の単位の欄の見本（書式のまま）が切れない
   ⑤ 撮る状態が押した札の所へ欄が送られ、札が上の縁で半分に切れる → 計算列のまとまりの見出しを欄の上の縁にそろえる */
function lib2() {
  if (window.CP2) return;
  const Q = (window.CP2 = {});
  const P = window.CP;
  // 組む所の読めない式の札（is-off）は data-dnd-col が無いので、名前の字で見分ける
  P.colOf = (x) => x.dataset.col || x.dataset.dndCol || ((x.querySelector("b") || {}).firstChild || {}).textContent?.trim() || "";
  P.cards = (box) => [...document.querySelectorAll(`${box} .pv-f`)].filter((x) => P.isCalc(P.colOf(x)));
  // ① すぐに見るの行を 1 段に
  Q.oneLine = () => {
    const pre = document.getElementById("llPvPreset"), pick = document.querySelector("#llPivot [data-pv-pick]");
    if (!pre || !pick) return;
    const row = pre.parentElement;
    if (pre.getBoundingClientRect().top > pick.getBoundingClientRect().top + 8) {
      const chips = [...row.querySelectorAll(".pv-quick:not(.cp-hide):not(.cp-q)")];
      if (chips.length) chips[chips.length - 1].classList.add("cp-hide");
    }
  };
  // ② 表の小数の桁を値ごとにそろえる（いちばん少ない桁へ。今は 1 つの値の表）
  Q.sameDec = () => {
    const cells = [...document.querySelectorAll(".pv-table td")].filter((td) => /^-?[\d,]+(\.\d+)?$/.test(td.textContent.trim()));
    const decs = cells.map((td) => (td.textContent.trim().split(".")[1] || "").length).filter((n) => n > 0);
    if (!decs.length) return;
    const d = Math.min(...decs);
    cells.forEach((td) => {
      const t = td.textContent.trim(), n = (t.split(".")[1] || "").length;
      if (n > d) { const v = Number(t.replace(/,/g, "")); td.textContent = v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }); }
    });
  };
  // ③ 小数の誤差を丸める（12 桁で丸めて、後ろの 0 を落とす）
  Q.round = () => {
    for (const root of document.querySelectorAll("#llBody, #lcList, #lcDetail")) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue;
        if (/^-?\d+\.\d{9,}$/.test(t.trim())) n.nodeValue = String(Number(Number(t).toPrecision(12)));
      }
    }
  };
  // ⑤ 計算列のまとまりの見出しを、欄の上の縁にそろえる（まとまりが欄に入りきっていないときだけ）
  Q.alignHead = (box) => {
    const list = document.querySelector(box), head = list && list.querySelector(".cp2-head");
    if (!head) return;
    const cards = P.cards(box), last = cards[cards.length - 1] || head;
    const lr = list.getBoundingClientRect(), hr = head.getBoundingClientRect(), er = last.getBoundingClientRect();
    if (hr.top < lr.top - 1 || er.bottom > lr.bottom + 1) list.scrollTop += hr.top - lr.top - 2;
  };
  Q.fixes = () => { Q.oneLine(); Q.sameDec(); Q.round(); };
  /** 計算列の札を強める: ƒx の形の印（計算列だけ）・式の 1 行・読めない式は薄くして理由 */
  Q.fx = (box, { formula = true } = {}) => P.cards(box).forEach((x) => {
    const c = P.colOf(x), span = x.querySelector(":scope > span"), b = span && span.querySelector("b");
    if (!span || !b) return;
    b.querySelector(".sx-calc")?.remove();
    if (!span.querySelector(".cp2-fx")) span.insertAdjacentHTML("afterbegin", '<i class="cp2-fx" aria-hidden="true">ƒx</i>');
    x.classList.add("cp2-card");
    const f = P.ctx().formulas[c] || "";
    x.title = `${c}（計算列。一覧の表示列で作った列）\n= ${f}`;
    const bad = x.classList.contains("is-off") || /式が読めません/.test(x.textContent) || c === "寸法";
    const sm = span.querySelector("small");
    if (bad) {
      x.classList.add("cp2-bad");
      if (sm && !sm.dataset.cp2) { sm.dataset.cp2 = 1; sm.innerHTML = '<span class="cp2-why">式が読めません · 表示列で直す</span>'; }
      x.querySelectorAll(".pv-r").forEach((r) => r.classList.add("cp-hide"));
    } else if (formula && sm && !sm.dataset.cp2) {
      sm.dataset.cp2 = 1; const kind = sm.textContent.replace(/^式の列 · /, "");
      sm.innerHTML = `<span class="cp2-f">= ${P.esc(f)}</span><span class="cp2-k"> · ${P.esc(kind)}</span>`;
    }
  });
  /** 欄の頭（ロット数・件数の後ろ）に計算列のまとまり。読めない式は最後。btn: 作る口の言葉（置き場で分ける） */
  Q.group = (box, { btn = "", sub = "一覧の表示列で作った列" } = {}) => {
    const list = document.querySelector(box); if (!list) return;
    const cards = P.cards(box).sort((a, b) => a.classList.contains("cp2-bad") - b.classList.contains("cp2-bad"));
    if (!cards.length) return;
    let head = list.querySelector(".cp2-head");
    if (!head) {
      head = document.createElement("div"); head.className = "cp2-head";
      head.innerHTML = `<span class="cp2-hl"><i class="cp2-fx">ƒx</i><b>計算列</b><span class="cp2-n"></span></span><small>${sub}</small>${btn ? `<button type="button" class="cp2-add">${btn}</button>` : ""}`;
      const raw = document.createElement("div"); raw.className = "cp2-head is-raw"; raw.innerHTML = '<span class="cp2-hl"><b>元の列</b></span><small>データの列</small>';
      list.prepend(raw); list.prepend(head);
    }
    head.querySelector(".cp2-n").textContent = String(cards.filter((x) => !x.classList.contains("cp2-bad")).length);
    const sp = [...list.querySelectorAll(".pv-f.is-special")], anchor = sp[sp.length - 1];
    if (anchor && head.previousElementSibling !== anchor) anchor.after(head);
    let at = head;
    cards.forEach((x) => { if (at.nextElementSibling !== x) at.after(x); at = x; });
    const raw = list.querySelector(".cp2-head.is-raw");
    if (raw && at.nextElementSibling !== raw) at.after(raw);
  };
  /** 計算列を使ったら（撮る状態の後）、まとまりを見える所へ（組み直しで描き直る間は送り直す） */
  Q.reveal = () => {
    if (!Q.t0 && P.used) Q.t0 = Date.now();
    if (Q.t0 && Date.now() - Q.t0 < 4000) Q.alignHead("#llPvFields");
    if (!Q.d0 && document.querySelector('#deFields .pv-f[data-dnd-col="重量t"] .pv-r.on')) Q.d0 = Date.now();
    if (Q.d0 && Date.now() - Q.d0 < 5000) Q.alignHead("#deFields");
  };
  /** 作る口の言葉（置き場で分ける。集計表は一覧の列、組む所はパネルだけの列） */
  Q.BTN_LIST = "＋ 一覧の列を作る";
  Q.BTN_DASH = "＋ このパネルだけの列";
}
const CSS_R2 = `
.pc-uin{width:7.2em !important;min-width:7.2em}
.cp-hide{display:none !important}
.cp2-fx{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:18px;border-radius:5px;background:var(--h-input);color:#fff;font:800 11px/1 system-ui;font-style:italic;margin-right:6px;vertical-align:-3px}
.pv-f.cp2-card{border-left:3px solid var(--h-input)}
.pv-f.cp2-card > span{min-width:0;display:grid !important;grid-template-columns:auto minmax(0,1fr);column-gap:0;align-items:center}
.pv-f.cp2-card > span > .cp2-fx{grid-row:1 / span 2;margin-right:6px}
.pv-f.cp2-card > span > b,.pv-f.cp2-card > span > small{grid-column:2;min-width:0}
.pv-f.cp2-card > span > b{display:block !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-f.cp2-card > span > small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp2-f{font:11.5px ui-monospace,Menlo,Consolas,monospace;color:#2f3b49}
.cp2-k{color:#5b6776}
.pv-f.cp2-bad{background:#f6f7f9;border-left-color:#b9c2cd}
.pv-f.cp2-bad b{color:#5b6776}
.pv-f.cp2-bad .cp2-fx{background:#8a96a3}
.cp2-why{color:#a33a1c;font-weight:700}
.pv-f.cp2-bad > span > small{white-space:normal;overflow:visible}
.cp2-head{display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:2px;margin:8px 2px 4px;padding:6px 2px 2px;border-top:1px solid #d7dee7}
.cp2-head .cp2-hl{display:inline-flex;align-items:center;white-space:nowrap}
.cp2-head b{font-size:13px}
.cp2-head small{font-size:11.5px;color:#5b6776;white-space:nowrap}
.cp2-head .cp2-n{margin-left:6px;font:700 11.5px system-ui;color:var(--h-input);background:var(--input-soft);border-radius:9px;padding:0 7px}
.cp2-head .cp2-add,.cp2-foot .cp2-add{flex-basis:100%;text-align:left;border:0;background:none;color:var(--h-input);font:700 12px system-ui;padding:2px 0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.cp2-head.is-raw .cp2-hl b{color:#3b4756}
#deFields .pv-f > span > b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

/* ------------------------------------------------------------------ G: B 改（first_fixes 1〜4 と 6） */
function propG() {
  const P = CP, Q = CP2;
  P.keep(() => {
    Q.fx("#llPvFields"); Q.fx("#deFields");
    Q.group("#llPvFields", { btn: Q.BTN_LIST }); Q.group("#deFields", { btn: Q.BTN_DASH, sub: "一覧で作った列・このパネルの列" });
    document.querySelectorAll("[data-de-calcnew]").forEach((b) => b.classList.add("cp-hide"));   // 組む所の検索の横の口は、まとまりの見出しへ移した
    // 従の道（first_fixes 6）: 表示列の窓の計算列の詳細に 1 行
    const box = document.getElementById("lcDetail"), fx = box && box.querySelector('.lc-step[data-step="fx"]');
    if (fx && /重量t|材調質|板厚区分/.test(box.textContent.slice(0, 40)) && !box.querySelector(".cp2-use")) {
      fx.insertAdjacentHTML("afterend", '<div class="cp2-use"><i class="cp2-fx">ƒx</i><span>集計表・グラフとダッシュボードのカラムの頭（計算列）に並びます</span><button type="button" class="cp2-go">集計表で値に置く</button></div>');
    }
    P.useInPivot(); Q.reveal(); Q.fixes();
  });
}
const CSS_G = `
.cp2-use{display:flex;align-items:center;gap:8px;margin:-2px 0 10px;padding:8px 12px;border:1px solid #d7dee7;border-radius:10px;background:#f7f9fb;font-size:12.5px;color:#2f3b49}
.cp2-use span{flex:1;min-width:0}
.cp2-go{white-space:nowrap;border:1px solid var(--h-input);background:#fff;color:var(--h-input);border-radius:7px;padding:4px 10px;font:700 12.5px system-ui;cursor:pointer}
`;

/* ------------------------------------------------------------------ H: カラムの欄の上に「すべて｜ƒx 計算列｜元の列」のタブ（計算列のタブを押した所） */
function propH() {
  const P = CP, Q = CP2;
  const tabs = (after, n, raw, mode) => {
    const at = document.querySelector(after); if (!at) return;
    let t = at.parentElement.querySelector(".cp2-tabs");
    if (!t) { t = document.createElement("div"); t.className = "cp2-tabs"; t.setAttribute("role", "tablist"); at.after(t); }
    const html = `<button type="button" role="tab" aria-selected="${mode === "all"}" class="${mode === "all" ? "on" : ""}">すべて</button>`
      + `<button type="button" role="tab" aria-selected="${mode === "fx"}" class="${mode === "fx" ? "on" : ""}"><i class="cp2-fx">ƒx</i>計算列<span class="cp2-n">${n}</span></button>`
      + `<button type="button" role="tab" aria-selected="${mode === "raw"}" class="${mode === "raw" ? "on" : ""}">元の列<span class="cp2-n">${raw}</span></button>`;
    if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  };
  P.keep(() => {
    Q.fx("#llPvFields"); Q.fx("#deFields");
    for (const [box, search, btn] of [["#llPvFields", "#llPvSearch", Q.BTN_LIST], ["#deFields", ".de-fsearch", Q.BTN_DASH]]) {
      const list = document.querySelector(box); if (!list) continue;
      const cards = P.cards(box), ok = cards.filter((x) => !x.classList.contains("cp2-bad")).length;
      if (!cards.length) continue;
      const raws = [...list.querySelectorAll(".pv-f:not(.is-special)")].filter((x) => !cards.includes(x));
      const mode = (box === "#llPvFields" ? P.used : document.querySelector('#deFields .pv-f[data-dnd-col="重量t"] .pv-r.on')) ? "fx" : "all";
      tabs(search, ok, raws.length, mode);
      const sp = [...list.querySelectorAll(".pv-f.is-special")]; let at = sp[sp.length - 1];
      cards.sort((a, b) => a.classList.contains("cp2-bad") - b.classList.contains("cp2-bad")).forEach((x) => { if (at && at.nextElementSibling !== x) at.after(x); at = x; });
      raws.forEach((x) => x.classList.toggle("cp-hide", mode === "fx"));
      sp.forEach((x) => x.classList.toggle("cp-hide", mode === "fx" && !/ロット数|件数/.test(x.textContent)));
      let foot = list.querySelector(".cp2-foot");
      if (mode === "fx" && !foot) { foot = document.createElement("div"); foot.className = "cp2-foot"; foot.innerHTML = `<button type="button" class="cp2-add">${btn}</button><small>元の列 ${raws.length} は「元の列」のタブに</small>`; }
      if (foot && at && at.nextElementSibling !== foot) at.after(foot);
      if (mode === "fx") list.scrollTop = 0;
    }
    document.querySelectorAll("[data-de-calcnew]").forEach((b) => b.classList.add("cp-hide"));
    P.useInPivot(); Q.fixes();
  });
}
const CSS_H = `
.cp2-tabs{display:flex;margin:6px 0 4px;border:1px solid #c5ced9;border-radius:8px;overflow:hidden;background:#fff}
.de-fsearch + .cp2-tabs{margin:6px 0 4px}
.cp2-tabs button{flex:1 1 auto;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:3px;border:0;border-right:1px solid #c5ced9;background:#fff;padding:5px 4px;font:700 12px system-ui;color:#3b4756;white-space:nowrap;cursor:pointer}
.cp2-tabs button:last-child{border-right:0}
.cp2-tabs button.on{background:var(--h-input);color:#fff}
.cp2-tabs button.on .cp2-fx{background:#fff;color:var(--h-input)}
.cp2-tabs .cp2-fx{width:18px;height:16px;font-size:10px;margin-right:1px}
.cp2-tabs .cp2-n{font-weight:700;opacity:.85;margin-left:3px}
.cp2-foot{display:flex;flex-direction:column;gap:2px;margin:6px 4px}
.cp2-foot small{font-size:11.5px;color:#5b6776}
`;

/* ------------------------------------------------------------------ J: 頭のまとまり＋どの列から作ったか（元の列に「→ ƒx 重量t」・計算列に「重量 から」） */
function propJ() {
  const P = CP, Q = CP2;
  const deps = (c) => { const f = P.ctx().formulas[c] || ""; return [...new Set([...f.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]))]; };
  const from = (box) => {
    P.cards(box).forEach((x) => {
      const c = P.colOf(x), sm = x.querySelector(":scope > span small"); if (!sm || x.classList.contains("cp2-bad") || sm.dataset.cpj) return;
      sm.dataset.cpj = 1; const kind = sm.textContent.replace(/^式の列 · /, "");
      sm.innerHTML = `<span class="cpj-from">${deps(c).map(P.esc).join("・")} から</span><span class="cp2-k"> · ${P.esc(kind)}</span>`;
    });
    const made = {};
    Object.keys(P.ctx().formulas).filter((c) => c !== "寸法").forEach((c) => deps(c).forEach((d) => { (made[d] = made[d] || []).push(c); }));
    document.querySelectorAll(`${box} .pv-f`).forEach((x) => {
      const c = P.colOf(x); if (!made[c] || P.isCalc(c) || x.querySelector(".cpj-to")) return;
      const b = x.querySelector(":scope > span b"); if (b) b.insertAdjacentHTML("afterend", `<span class="cpj-to">→ ƒx ${made[c].map(P.esc).join("・")}</span>`);
    });
  };
  P.keep(() => {
    Q.fx("#llPvFields", { formula: false }); Q.fx("#deFields", { formula: false });
    Q.group("#llPvFields", { btn: Q.BTN_LIST }); Q.group("#deFields", { btn: Q.BTN_DASH, sub: "一覧で作った列・このパネルの列" });
    from("#llPvFields"); from("#deFields");
    document.querySelectorAll("[data-de-calcnew]").forEach((b) => b.classList.add("cp-hide"));
    P.useInPivot(); Q.reveal(); Q.fixes();
  });
}
const CSS_J = `
.cpj-from{color:#2f3b49;font-weight:700}
.cpj-to{display:block;font-size:11px;color:var(--h-input);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
`;

/* ------------------------------------------------------------------ K: 文の真上に「ƒx 計算列」の帯（計算列は欄から出して横に並べる） */
function propK() {
  const P = CP, Q = CP2;
  const cards0 = P.cards;
  // 帯へ移した札も数える
  P.cards = (box) => { const a = cards0(box); if (a.length) return a; const s = document.querySelector(box === "#deFields" ? "#deSent" : "#llPvHead"); const st = s && s.parentElement.querySelector(".cpk-strip"); return st ? [...st.querySelectorAll(".pv-f")] : a; };
  const strip = (box, above, btn) => {
    const host = document.querySelector(above); if (!host) return;
    const list = document.querySelector(box); if (!list) return;
    let s = host.parentElement.querySelector(".cpk-strip");
    const fresh = cards0(box);
    if (box === "#deFields" && !document.querySelector('#deFields .pv-f[data-dnd-col="重量t"] .pv-r.on') && !s) return;   // 組む所: 撮る状態が札を押し終えてから帯へ
    if (!s) {
      if (!fresh.length) return;
      s = document.createElement("div"); s.className = "cpk-strip";
      s.innerHTML = `<span class="cpk-l"><i class="cp2-fx">ƒx</i><b>計算列</b></span><div class="cpk-cards"></div><button type="button" class="cpk-add">${btn}</button>`;
      host.before(s);
    } else if (host.previousElementSibling !== s) host.before(s);
    const wrap = s.querySelector(".cpk-cards");
    if (fresh.length) { wrap.querySelectorAll(".pv-f").forEach((x) => x.remove()); fresh.sort((a, b) => a.classList.contains("cp2-bad") - b.classList.contains("cp2-bad")).forEach((x) => wrap.append(x)); }
  };
  P.useInPivot = () => {
    if (P.used) return;
    const f = (c, r) => document.querySelector(`.cpk-strip .pv-f[data-col="${c}"] [data-pv-add="${r}"], #llPvFields .pv-f[data-col="${c}"] [data-pv-add="${r}"]`);
    const w = document.querySelector('#llPvFields .pv-f[data-col="重量"] [data-pv-add="vals"]');
    if (!f("重量t", "vals") || !w || !w.classList.contains("on") || !document.querySelector('#llPivot .pv-slot[data-role="rows"] .pv-chip')) return;
    P.used = true; w.click();
    setTimeout(() => { f("重量t", "vals")?.click(); setTimeout(() => f("板厚区分", "cols")?.click(), 150); }, 150);
  };
  P.keep(() => {
    Q.fx("#llPvFields", { formula: false }); Q.fx("#deFields", { formula: false });
    strip("#llPvFields", "#llPvHead", Q.BTN_LIST); strip("#deFields", "#deSent", Q.BTN_DASH);
    document.querySelectorAll(".cpk-strip .pv-f").forEach((x) => { if (!x.classList.contains("cp2-card")) x.classList.add("cp2-card"); });
    document.querySelectorAll("[data-de-calcnew]").forEach((b) => b.classList.add("cp-hide"));
    P.useInPivot(); Q.fixes();
  });
}
const CSS_K = `
.cpk-strip{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;margin:0 0 8px;padding:6px 10px;border:1px solid #c9d6e6;border-left:4px solid var(--h-input);border-radius:10px;background:#f4f8fc;overflow-x:auto}
.cpk-l{display:inline-flex;align-items:center;white-space:nowrap}.cpk-l b{font-size:13px}
.cpk-cards{display:flex;gap:6px;flex-wrap:nowrap}
.cpk-strip .pv-f{margin:0;flex:none;display:flex;align-items:center;gap:4px;padding:3px 6px;min-height:0;border-left-width:1px;background:#fff}
.cpk-strip .pv-f > span{display:flex !important;align-items:baseline;gap:6px;white-space:nowrap}
.cpk-strip .pv-f > span > b{display:inline !important}
.cpk-strip .pv-f > span > small{display:inline}
.cpk-strip .pv-f > span .cp2-fx{display:none}
.cpk-strip .pv-f > i{display:none}
.cpk-strip .pv-f .pv-r{flex:none;min-width:26px;height:24px;margin-left:2px}
.cpk-strip .pv-f > span .cp2-why{white-space:nowrap}
.cpk-add{flex:none;margin-left:auto;white-space:nowrap;border:0;background:none;color:var(--h-input);font:700 12px system-ui;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
#deSent ~ .cpk-strip,.cpk-strip:has(+ #deSent){flex-wrap:wrap;overflow:visible}
.cpk-strip:has(+ #deSent) .cpk-cards{flex-wrap:wrap}
`;

/* ------------------------------------------------------------------ M: 文の［値］の「＋ 値 ▾」の面に計算列を先に（文から選ぶ流れ。欄は G のまとまり） */
function propM() {
  const P = CP, Q = CP2;
  P.keep(() => {
    Q.fx("#llPvFields"); Q.fx("#deFields");
    Q.group("#llPvFields", { btn: Q.BTN_LIST }); Q.group("#deFields", { btn: Q.BTN_DASH, sub: "一覧で作った列・このパネルの列" });
    document.querySelectorAll("[data-de-calcnew]").forEach((b) => b.classList.add("cp-hide"));
    const slot = document.querySelector('#llPivot .pv-slot[data-role="vals"]');
    if (slot && !(slot.nextElementSibling && slot.nextElementSibling.classList.contains("cpm-add"))) slot.insertAdjacentHTML("afterend", '<button type="button" class="cpm-add" aria-haspopup="true">＋ 値 ▾</button>');
    const btn = document.querySelector("#llPivot .cpm-add");
    let pop = document.getElementById("cpmPop");
    const show = P.used && btn && btn.offsetParent && document.querySelector("#lotListScreen.is-pivot");
    if (show && !pop) {
      const f = P.ctx().formulas, on = (c) => !!document.querySelector(`#llPvFields .pv-f[data-col="${c}"] [data-pv-add="vals"].on`);
      const row = (fx, name, sub, c, agg) => `<button type="button" class="cpm-i${c && on(c) ? " on" : ""}">${fx ? '<i class="cp2-fx">ƒx</i>' : '<i class="cpm-sp"></i>'}<b>${P.esc(name)}</b><small>${P.esc(sub)}</small><em>${agg}</em></button>`;
      pop = document.createElement("div"); pop.id = "cpmPop"; pop.className = "cpm-pop";
      pop.innerHTML = '<div class="cpm-h"><b>値に足す</b><small>合計・平均は値の札で替えられます</small></div>'
        + '<div class="cpm-g">ƒx 計算列（一覧の表示列で作った列）</div>'
        + row(true, "重量t", `= ${f["重量t"]}`, "重量t", "合計")
        + row(true, "材調質", "字 · 9 種類", "材調質", "種類の数")
        + row(true, "板厚区分", "字 · 2 種類", "板厚区分", "種類の数")
        + '<div class="cpm-g">数える物・数の列</div>'
        + row(false, "件数", "行の数", "", "") + row(false, "ロット数", "重複の無いロット番号", "", "")
        + row(false, "重量", "数", "重量", "合計") + row(false, "板幅", "数 · 677 種類", "板幅", "合計") + row(false, "数量", "数 · 99 種類", "数量", "合計")
        + '<div class="cpm-more">ほかの数の列 2 つ…</div>';
      document.body.append(pop);
    }
    if (pop) {
      if (!show) pop.remove();
      else { const r = btn.getBoundingClientRect(); pop.style.left = `${Math.min(r.left, innerWidth - 336)}px`; pop.style.top = `${r.bottom + 6}px`; btn.classList.add("on"); }
    }
    P.useInPivot(); Q.reveal(); Q.fixes();
  });
}
const CSS_M = `
.cpm-add{margin-left:4px;border:1px dashed #b59a5b;background:#fff;color:#7a4f06;border-radius:8px;padding:3px 8px;font:700 12.5px system-ui;white-space:nowrap;cursor:pointer}
.cpm-add.on{border-style:solid;background:#fdf6e9}
.cpm-pop{position:fixed;z-index:60;width:320px;background:#fff;border:1px solid #c5ced9;border-radius:10px;box-shadow:0 10px 30px rgba(16,32,48,.22);padding:8px;display:flex;flex-direction:column;gap:2px}
.cpm-h{display:flex;flex-direction:column;padding:2px 6px 6px;border-bottom:1px solid #e3e8ee;margin-bottom:4px}.cpm-h b{font-size:14px}.cpm-h small{font-size:11.5px;color:#5b6776}
.cpm-g{font:700 11.5px system-ui;color:#5b6776;padding:6px 6px 2px}
.cpm-i{display:grid;grid-template-columns:24px auto 1fr auto;align-items:center;gap:6px;text-align:left;border:0;background:none;border-radius:7px;padding:4px 6px;cursor:pointer}
.cpm-i:hover,.cpm-i.on{background:var(--input-soft)}
.cpm-i b{font-size:13px;white-space:nowrap}.cpm-i small{font-size:11.5px;color:#5b6776;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.cpm-i em{font-style:normal;font-size:11.5px;color:#7a4f06;white-space:nowrap}
.cpm-i.on em::after{content:" ✓";color:var(--h-input);font-weight:800}
.cpm-i .cp2-fx{margin:0}
.cpm-sp{display:block;width:22px}
.cpm-more{font-size:11.5px;color:var(--h-input);padding:4px 6px}
`;

const S = (fn) => `(${lib})(); (${fn})();`;
const S2 = (fn) => `(${lib})(); (${lib2})(); (${fn})();`;
export const PROPOSALS = [
  {
    key: "A", name: "元の列のすぐ下に並べる（式の印）", css: BASE_CSS + CSS_A, ops: [["script", S(propA)]],
    direction: "置き場（計算列を、式が読む元の列の真下へ）",
    shots: "pivot-calc（集計表のカラムの欄で 重量t が 重量 の下・板厚区分が 板厚 の下・材調質が 調質 の下。重量t を値・板厚区分を列にした表とグラフ）・dash-calc（組む所も同じ並び）",
    impl: "common_build に加え、札の並びを画面で直す（fields の答えの deps の 1 つ目の列の後ろへ。組む所・一覧の集計表で同じ関数）。",
  },
  {
    key: "B", name: "カラムの欄の頭に「計算列」のまとまり（＋ 計算列 もここ）", css: BASE_CSS + CSS_B, ops: [["script", S(propB)]],
    direction: "チャンク・置き場（計算列だけを欄の頭にまとめ、作る口も同じ所に）",
    shots: "pivot-calc・dash-calc（ロット数・件数の下に「計算列 3」の見出しと 3 枚、その下に「元の列」）",
    impl: "common_build に加え、札の欄（lotlist-pivot.js の fieldsHtml・dashboard-editor.js の fieldsHtml）を 特別 → 計算列 → 元の列 の 3 つに分けて描く。一覧の集計表の「＋ 計算列」は表示列の「この列の作り方」の窓（llFxPanel）を開き、作ったら札を読み直す。組む所の「＋ 計算列」（パネルだけの列）は見出しへ移す。",
  },
  {
    key: "C", name: "一覧の計算列の見出しの Σ から集計表へ", css: BASE_CSS + CSS_C, ops: [["script", S(propC)]],
    direction: "流れの変え方（列を見ている所から 1 手で集計へ）",
    shots: "calc-list（重量t の見出しの Σ を押して開いた面）・pivot-calc（式の印つきの札で使った所）",
    impl: "common_build に加え、一覧の見出しの計算列（th.is-calc）に Σ を足し、面の 3 つのボタンで集計表の組み方（行・値）を入れて集計表へ替える／ダッシュボードの組む所を値に入れて開く（Dashboard.addPanel の今の道）。",
  },
  {
    key: "D", name: "札に種類の印（123・字・日・ƒx）と式の中身", css: BASE_CSS + CSS_D, ops: [["script", S(propD)]],
    direction: "見せ方（何の列かを形と色で。計算列は式をその場で読める）",
    shots: "pivot-calc・dash-calc（どの札も左に種類の印。計算列は ƒx と左の線、下の段に「= [重量]/1000」）",
    impl: "common_build に加え、札（両方の fieldsHtml）に種類の印を足す（fields の numeric・date・calc から。画面だけ）。式は計算列の式の組（ctx.formulas）から。",
  },
  {
    key: "E", name: "「すぐに見る」に計算列の組み方を足す", css: BASE_CSS + CSS_E, ops: [["script", S(propE)]],
    direction: "減らし方（作った計算列の組み方をはじめから出し、探させない）",
    shots: "pivot-calc（すぐに見るの頭に ƒx の札 2 つ: 重量t の合計（板厚区分ごと）・材調質ごとの件数。カラムの欄は今の並びに式の印）",
    impl: "common_build に加え、すぐに見るの並び（quickBtn）の頭に、今の表の計算列から作る組み方を足す（数の計算列は 合計 を値に・種類の少ない計算列〈60 種類まで〉を行に。組み方のプリセットの役 $calcnum・$calcfew）。",
  },
  {
    key: "F", name: "表示列の窓の「この列の作り方」の下に「集計表・グラフで使う」", css: BASE_CSS + CSS_F, ops: [["script", S(propF)]],
    direction: "流れの変え方（列を作った所から集計へ。作った列がどこで使えるかを作る所で言う）",
    shots: "calc-cols（表示列の窓で 重量t を選んだ所。作り方の段の下に「集計表・グラフで使う」とボタン 3 つ）・pivot-calc",
    impl: "common_build に加え、表示列の窓の計算列の詳細（lotlist-columns.js の detail）に段を足し、ボタンで窓を閉じて集計表の組み方を入れる／組む所を開く。",
  },
  /* ---- 回 2 ---- */
  {
    key: "G", round: 2, name: "B 改: 欄の頭の「ƒx 計算列」のまとまり（first_fixes 1〜4・6）", css: BASE_CSS + CSS_R2 + CSS_G, ops: [["script", S2(propG)]],
    direction: "チャンク・置き場（B を持ち越し、印・言葉・読めない式・従の道を直す）",
    shots: "calc-cols（表示列の窓の 1 行「集計表で値に置く」）・pivot-calc・dash-calc",
    impl: "B と同じく両方の fieldsHtml を 数える物 → ƒx 計算列 → 元の列 で描く。計算列の札だけに ƒx の形の印と式の 1 行（全部は札の吹き出し）。作る口の言葉を置き場で分ける（集計表＝「＋ 一覧の列を作る」で表示列の「この列の作り方」の窓、組む所＝「＋ このパネルだけの列」）。読めない式の計算列はまとまりの最後に薄く、理由「式が読めません · 表示列で直す」。計算列が 0 の表は見出しの代わりに「計算列はまだありません ＋ 一覧の列を作る」の 1 行。表示列の窓の計算列の詳細に 1 行の従の道（集計表で値に置く）。",
  },
  {
    key: "H", round: 2, name: "カラムの欄の上に「すべて｜ƒx 計算列｜元の列」のタブ", css: BASE_CSS + CSS_R2 + CSS_H, ops: [["script", S2(propH)]],
    direction: "減らし方（欄を計算列だけに絞る。タブを押した所）",
    shots: "pivot-calc・dash-calc（どちらも「ƒx 計算列」のタブを押した所: 数える物と計算列だけ、下に作る口と「元の列 n は元の列のタブに」）",
    impl: "両方の札の欄の検索の下にタブ（すべて・計算列 n・元の列 n）。覚えはこの PC・範囲ごと（tpa.lotlist.pivot.v1 の fieldTab）。すべてのタブでは G と同じ並び（計算列が頭）。計算列が 0 の表はタブを出さない。",
  },
  {
    key: "J", round: 2, name: "頭のまとまり＋どの列から作ったか（元の列に「→ ƒx 重量t」・計算列に「重量 から」）", css: BASE_CSS + CSS_R2 + CSS_J, ops: [["script", S2(propJ)]],
    direction: "見せ方（作った列と元の列のつながりを両方の札に出す）",
    shots: "pivot-calc・dash-calc",
    impl: "G のまとまりに加え、fields の答えの deps（計算列が読む列）から、計算列の札の下の段に「重量 から · 数」、元の列の札に「→ ƒx 重量t」を出す（両方の fieldsHtml）。式の全部は札の吹き出し。",
  },
  {
    key: "K", round: 2, name: "文の真上に「ƒx 計算列」の帯（計算列は欄から出して横に並べる）", css: BASE_CSS + CSS_R2 + CSS_K, ops: [["script", S2(propK)]],
    direction: "置き場（左の欄ではなく、組む文の真上）",
    shots: "pivot-calc（文の上の帯に 重量t・材調質・板厚区分・寸法〈読めない〉の札。行・列・値のボタンはそのまま）・dash-calc（組む所の文の上）",
    impl: "集計表の頭（llPvHead）と組む所の文（deSent）の上に計算列の札の帯を描き、左の欄からは計算列を外す。帯は集計表では 1 段（入らなければ横に送る）、組む所では折り返す。作る口は帯の右。",
  },
  {
    key: "M", round: 2, name: "文の［値］の「＋ 値 ▾」の面に計算列を先に（文から選ぶ。欄は G のまとまり）", css: BASE_CSS + CSS_R2 + CSS_M, ops: [["script", S2(propM)]],
    direction: "流れの変え方（左の欄を探さず、組む文の枠から選ぶ）",
    shots: "pivot-calc（「＋ 値 ▾」を開いた面: 計算列 3 が先、数える物・数の列が後。重量t に ✓）・dash-calc（G と同じ欄）",
    impl: "文の値の枠の後ろに「＋ 値 ▾」（行・列の枠にも「＋ 行 ▾」）。面は fields から作り、計算列（数は合計・字は種類の数）を先に並べる。押すと addMeasure・addDim の今の道。左の欄は G と同じ。",
  },
];
