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

const S = (fn) => `(${lib})(); (${fn})();`;
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
];
