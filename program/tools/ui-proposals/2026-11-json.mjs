// 改良「JSON の列の展開」（利用者の依頼 2026-11-17「６）JSONデータ列に対応してほしい」）の案（回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面: TPA_UI_JSON=1 で tests/ui_window_scene.py が品質データと仕掛の表に JSON の列 5 つ（標準の 5 形）と壊れた行・空・違う形の行を足す。
//   設備別通過回数（① 名前→値）・測定値（② 値の並び。数でない値の混ざった行）・工程履歴（③ 表の並び）・仕様（④ 入れ子の辞書。壊れた行）・
//   設備別実績（⑤ 名前→表。NULL の行）。画面に出す数（形ごとの行の数・展開した行の数・設備ごとの合計）は、その作り物から数えた本当の数。
//
//   TPA_UI_JSON=1 TPA_UI_EXE=…/ui_serve node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-json.mjs \
//     --only A --from master --states master-sources,master-sources-join          （A: データ元のカード）
//     --only B --from columns --states columns                                     （B: 表示列の設定）
//     --only C,E --from list --states list                                         （C: 一覧の見出し・E: 展開の窓）
//     --only D,F --from dash-edit --states dash-edit,dash-panel                    （D・F: ダッシュボードの組む所。案の文が先にダッシュボードへ移る）
//   それぞれ --view 1536x864・--view 1280x720 でも撮る。
//
// 案は今の画面に「案の部品」を DOM で足して再現する（押しても動かない見本。数は作り物から数えた物）。中身の作り（Rust のどこで展開するか）は
// 各案の impl に書く。どの案も、展開の決め事（5 形の見分け・展開した行と列・合わない行の理由）は人の事例の表 tests/fixtures/json_expand_cases.json で決め、
// 窓（desktop/src/json_expand.rs）を cargo test --test json_expand_cases で突き合わせる（作るのは決めた後）。

/* ------------------------------------------------------------------ 共通の部品（頁の中で動く。window.JX） */
function lib() {
  if (window.JX) return;
  const J = (window.JX = {});
  const esc = (J.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
  /** fn を繰り返し当てる（画面が描き直しても案の部品を保つ） */
  J.keep = (fn, ms = 250) => { const t = () => { try { fn(); } catch (e) { console.warn("案:", e.message); } }; t(); setInterval(t, ms); };
  J.SHAPES = [
    { k: "dict", n: "①", name: "名前→値", eg: '{"ANF":0.365}', how: "鍵ごとに行へ。「鍵」「値」の 2 列" },
    { k: "list", n: "②", name: "値の並び", eg: "[3,5,8]", how: "要素ごとに行へ。「値」の 1 列" },
    { k: "rows", n: "③", name: "表の並び", eg: '[{"設備":"L-1","回":2}]', how: "要素ごとに行へ。中の名前が列に" },
    { k: "nest", n: "④", name: "入れ子の辞書", eg: '{"寸法":{"幅":1200}}', how: "平らにして列を足す（寸法.幅）。行は増えない" },
    { k: "dictrows", n: "⑤", name: "名前→表", eg: '{"ANF":{"回":1}}', how: "鍵ごとに行へ、中を列に" },
  ];
  // 作り物（tests/ui_window_scene.py の json_cells）から数えた本当の数。lot＝品質 1,500 行・wip＝仕掛 1,200 行
  const mk = (n) => (n === 1500
    ? [
      { col: "設備別通過回数", shape: "dict", ok: 1459, empty: 30, broken: 6, other: 5, rows: 7970, keys: 9, note: "" },
      { col: "測定値", shape: "list", ok: 1500, empty: 0, broken: 0, other: 0, rows: 4471, note: "数でない値 38 行" },
      { col: "工程履歴", shape: "rows", ok: 1500, empty: 0, broken: 0, other: 0, rows: 3015, note: "" },
      { col: "仕様", shape: "nest", ok: 1487, empty: 0, broken: 13, other: 0, rows: 1500, note: "列 +3" },
      { col: "設備別実績", shape: "dictrows", ok: 1475, empty: 25, broken: 0, other: 0, rows: 5633, note: "" },
    ]
    : [
      { col: "設備別通過回数", shape: "dict", ok: 1167, empty: 24, broken: 5, other: 4, rows: 6332, keys: 9, note: "" },
      { col: "測定値", shape: "list", ok: 1200, empty: 0, broken: 0, other: 0, rows: 3575, note: "数でない値 30 行" },
      { col: "工程履歴", shape: "rows", ok: 1200, empty: 0, broken: 0, other: 0, rows: 2418, note: "" },
      { col: "仕様", shape: "nest", ok: 1190, empty: 0, broken: 10, other: 0, rows: 1200, note: "列 +3" },
      { col: "設備別実績", shape: "dictrows", ok: 1180, empty: 20, broken: 0, other: 0, rows: 4498, note: "" },
    ]);
  J.COLS = { lot: mk(1500), wip: mk(1200) };
  J.SUMS = { wip: [["CR1", 933.4], ["TLV", 893.9], ["L-1", 892.3], ["HOT", 886.4], ["ANF", 885.2], ["DL2", 881.4], ["L-2", 878.3], ["LS3", 869.1], ["KEN", 829.7]] };
  J.shapeOf = (k) => J.SHAPES.find((s) => s.k === k);
  const fmt = (J.fmt = (n) => Number(n).toLocaleString("ja-JP"));
  const pct = (J.pct = (a, b) => { const p = (a * 100) / b; return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`; });
  /** 形の割合の帯（色だけで分けない: 字でも書く） */
  J.bar = (c, total, wide) => {
    const seg = (n, cls, t) => (n ? `<i class="jx-s ${cls}" style="flex:${n}" title="${t} ${fmt(n)} 行"></i>` : "");
    const s = J.shapeOf(c.shape);
    const words = [`<b>${s.n} ${s.name} ${pct(c.ok, total)}</b>`]
      .concat(c.empty ? [`空 ${pct(c.empty, total)}`] : [], c.broken ? [`<em>壊れ ${c.broken}</em>`] : [], c.other ? [`<em>違う形 ${c.other}</em>`] : []);
    return `<span class="jx-bar${wide ? " is-wide" : ""}"><span class="jx-strip">${seg(c.ok, "ok", s.name)}${seg(c.empty, "empty", "空")}${seg(c.broken, "ng", "壊れ")}${seg(c.other, "warn", "違う形")}</span>`
      + `<span class="jx-words">${words.join("・")}</span></span>`;
  };
  /** 5 つの分け方の札（設備別通過回数に当てたときの答え）。pick＝選んだ形 */
  J.patterns = (pick, total, rows, mode) => {
    const ans = {
      dict: [`${fmt(rows)} 行`, "合う 97%", "is-fit"],
      list: ["合いません", "並びは 0.3%", ""],
      rows: ["合いません", "0%", ""],
      nest: [`${fmt(total)} 行・列 +9`, "横に広げる（ANF・CR1 …）", "is-alt"],
      dictrows: ["合いません", "値が表でない", ""],
    };
    return J.SHAPES.map((s) => {
      const [n, t, cls] = ans[s.k];
      return `<button type="button" role="radio" class="jx-pat ${cls}${s.k === pick ? " is-on" : ""}" aria-checked="${s.k === pick}">`
        + `<span class="jx-pn">${s.n}</span><span class="jx-pb"><b>${s.name}${cls === "is-fit" ? '<small class="jx-rec">おすすめ</small>' : ""}</b>`
        + `${mode === "long" ? `<small>${esc(s.how)}</small>` : ""}<code>${esc(s.eg)}</code></span><em>${n}<small>${t}</small></em></button>`;
    }).join("");
  };
  /** 展開の見本（元の 2 行 → 9 行）。kk・vv＝列の名前 */
  J.preview = (kk = "設備", vv = "通過回数", lot = "L0001C1", max = 9) => {
    const r1 = { ANF: 1.069, CR1: 1, DL2: 0.728, HOT: 2, KEN: 0.455, LS3: 0.366 }, r2 = { DL2: 1, KEN: 2, "L-1": 1.128 };
    const out = [];
    Object.entries(r1).forEach(([k, v], i) => out.push([i === 0, lot, k, v, 1]));
    Object.entries(r2).forEach(([k, v], i) => out.push([i === 0, "L0002C2", k, v, 2]));
    return `<table class="jx-prev"><thead><tr><th>元</th><th>ロット番号</th><th class="is-new">${esc(kk)}<small>鍵</small></th><th class="is-new is-num">${esc(vv)}<small>値・数</small></th></tr></thead><tbody>`
      + out.slice(0, max).map(([first, l, k, v, n]) => `<tr class="${first ? "is-first" : ""} r${n}"><td>${first ? `${n} 行目` : ""}</td><td>${l}</td><td>${k}</td><td class="is-num">${v}</td></tr>`).join("")
      + "</tbody></table>";
  };
  /** 合わない行の知らせ（黙って捨てない） */
  J.issues = (c, total, compact) => `<div class="jx-iss" role="status">`
    + `<span class="jx-ok">✓ ${fmt(c.ok)} 行を ${fmt(c.rows)} 行に分けます</span>`
    + `<span class="jx-mute">空 ${fmt(c.empty)} 行は分けずに 1 行のまま残します</span>`
    + `<span class="jx-ng">⚠ ${fmt(c.broken + c.other)} 行は分けられません — 壊れた JSON ${c.broken}${compact ? "" : '（例: 12 行目 <code>{"ANF":0.797,…"L</code> 閉じていない）'}・違う形 ${c.other}${compact ? "" : "（並び <code>[1, 2]</code>）"}`
    + `<button type="button" class="jx-link">その行を見る</button></span></div>`;
  /** 設備ごとの通過回数の合計の横棒（結果の見本） */
  J.bars = (list) => {
    const max = Math.max(...list.map((x) => x[1]));
    return `<div class="jx-chart">${list.map(([k, v]) => `<div class="jx-cr"><span>${k}</span><i style="width:${((v / max) * 100).toFixed(1)}%"></i><b>${v.toFixed(1)}</b></div>`).join("")}</div>`;
  };
}

const BASE_CSS = `
.jx-bar{display:flex;flex-direction:column;gap:3px;min-width:0}
.jx-strip{display:flex;height:8px;border-radius:4px;overflow:hidden;background:#e9eef4;min-width:60px}
.jx-s{display:block;height:100%}.jx-s.ok{background:#3f7fcf}.jx-s.empty{background:#b8c3cf}.jx-s.ng{background:#c8382c}.jx-s.warn{background:#d98b1e}
.jx-words{font-size:12px;color:#4c5864;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.jx-words b{color:#16202b;font-weight:700}.jx-words em{font-style:normal;color:#a02c22;font-weight:600}
.jx-pat{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid #cfd9e4;border-radius:9px;background:#fff;font:inherit;color:#16202b;text-align:left;min-width:0;cursor:pointer}
.jx-pat.is-on{border:2px solid #3f7fcf;background:#f2f7fd;padding:5px 8px}
.jx-pat:not(.is-fit):not(.is-alt){color:#4c5864}
.jx-pn{font-size:18px;font-weight:700;color:#2d5f9e;flex:none}
.jx-pb{display:flex;flex-direction:column;min-width:0;flex:1}
.jx-pb b{font-size:13.5px;display:flex;gap:6px;align-items:center;white-space:nowrap}
.jx-pb small{font-size:12px;color:#4c5864;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jx-pb code{font-size:11.5px;color:#4c5864;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,Consolas,monospace}
.jx-pat em{font-style:normal;font-size:13px;font-weight:700;display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap;flex:none}
.jx-pat em small{font-size:11.5px;font-weight:400;color:#4c5864}
.jx-pat.is-fit em{color:#1d6b3a}
.jx-pb .jx-rec{font-size:11px;font-weight:700;color:#fff;background:#1d7a44;border-radius:9px;padding:0 7px;line-height:18px}
.jx-prev{border-collapse:collapse;font-size:12.5px;width:100%}
.jx-prev th{background:#eef3f8;color:#2b3947;font-weight:700;text-align:left;padding:3px 8px;border-bottom:1px solid #cfd9e4;white-space:nowrap}
.jx-prev th small{font-weight:400;color:#4c5864;margin-left:5px;font-size:11.5px}
.jx-prev th.is-new{background:#e1ecf9;color:#1f4f8a}
.jx-prev td{padding:2px 8px;border-bottom:1px solid #edf1f5;white-space:nowrap}
.jx-prev td:first-child{color:#4c5864;font-size:12px}
.jx-prev tr.is-first td{border-top:2px solid #c3d2e3}
.jx-prev tr.r2 td{background:#fafbfd}
.jx-prev .is-num{text-align:right;font-variant-numeric:tabular-nums}
.jx-iss{display:flex;flex-direction:column;gap:3px;font-size:13px;padding:7px 10px;border-radius:8px;background:#f6f8fb;border:1px solid #dde5ee}
.jx-ok{color:#1d6b3a;font-weight:700}.jx-mute{color:#4c5864}.jx-ng{color:#8a2a1f}
.jx-iss code{font-size:12px;background:#fff;border:1px solid #e1d3d0;border-radius:4px;padding:0 4px}
.jx-link{border:0;background:none;color:#2d5f9e;text-decoration:underline;font:inherit;cursor:pointer;padding:0 0 0 6px}
.jx-lab{font-size:12.5px;font-weight:700;color:#4c5864}
.jx-chart{display:flex;flex-direction:column;gap:6px;padding:4px 0}
.jx-cr{display:grid;grid-template-columns:44px 1fr 56px;align-items:center;gap:8px;font-size:13px}
.jx-cr span{text-align:right;color:#3a4653}.jx-cr i{display:block;height:20px;background:#3f7fcf;border-radius:0 3px 3px 0}.jx-cr b{font-variant-numeric:tabular-nums}
.jx-name{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}
.jx-name input{width:110px;padding:3px 7px;border:1px solid #cfd9e4;border-radius:6px;font:inherit}
.jx-btn{padding:5px 12px;border-radius:7px;border:1px solid #c5ced9;background:#fff;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.jx-btn.pri{background:#2d5f9e;color:#fff;border-color:#2d5f9e;font-weight:700}
.jx-tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;border-radius:9px;padding:0 7px;line-height:18px;background:#e1ecf9;color:#1f4f8a;white-space:nowrap}
`;

/* ------------------------------------------------------------------ A: データ元のカードに「JSON の列」の段 */
function propA() {
  const J = window.JX;
  const C = J.COLS.lot, total = 1500, c = C[0];
  J.keep(() => {
    const card = document.querySelector('#masterSettings .sr-card.is-open[data-key="lot"]');
    if (!card) return;
    const join = card.querySelector('.sr-sec[data-sec="join"]');
    if (!join) return;
    // 結合の段は畳み、JSON の段を開く（開くのは 1 つ）
    card.querySelectorAll('.sr-sec:not([data-sec="json"])').forEach((s) => {
      s.classList.remove("is-open"); const sb = s.querySelector(".sr-sb"); if (sb) sb.hidden = true;
      const car = s.querySelector(".sr-car"); if (car) car.textContent = "▸"; s.querySelector(".sr-sh")?.setAttribute("aria-expanded", "false");
    });
    const mine = card.querySelector('.sr-sec[data-sec="json"]');
    if (mine) {
      mine.classList.add("is-open"); mine.querySelector(".sr-sb").hidden = false; mine.querySelector(".sr-car").textContent = "▾";
      if (!mine.dataset.seen) { mine.dataset.seen = 1; mine.scrollIntoView({ block: "start" }); }
      return;
    }
    const rows = C.map((x, i) => `<div class="jxa-col${i === 0 ? " is-on" : ""}" role="radio" aria-checked="${i === 0}" tabindex="0"><span class="jxa-rd" aria-hidden="true"></span><b>${x.col}</b>${J.bar(x, total)}`
      + `<span class="jxa-st">${i === 0 ? '<span class="jx-tag">展開する</span>' : '<span class="jxa-off">しない</span>'}</span></div>`).join("");
    join.insertAdjacentHTML("afterend", `<section class="sr-sec is-open" data-sec="json">
      <button type="button" class="sr-sh" aria-expanded="true"><span class="sr-car" aria-hidden="true">▾</span><b>JSON の列</b><span class="sr-sum">5 列を見つけました · 設備別通過回数 を ① で展開（1,500 → 7,970 行）</span></button>
      <div class="sr-sb"><div class="jxa">
        <div class="jxa-h"><b>JSON の列を展開</b><small>中身の先頭 500 行を読み、形ごとの行の数を数えました。展開すると、元の行を鍵の数だけ並べた表「品質 › 設備別通過回数」ができます</small></div>
        <div class="jxa-cols"><span class="jx-lab">見つけた列（押して選ぶ）</span>${rows}</div>
        <div class="jxa-how"><span class="jx-lab">設備別通過回数 の分け方 <small>中身に合う形を先に選んであります</small></span>
          <div class="jxa-pats" role="radiogroup" aria-label="分け方">${J.patterns("dict", total, c.rows, "short")}</div></div>
        <div class="jxa-two"><div class="jxa-l"><span class="jx-lab">列の名前</span><div class="jx-name">鍵<input value="設備" aria-label="鍵の列の名前">値<input value="通過回数" aria-label="値の列の名前"></div>
          ${J.issues(c, total, false)}</div>
          <div class="jxa-r"><span class="jx-lab">見本（元の 2 行 → 9 行）</span>${J.preview()}</div></div>
        <div class="jxa-out"><span>できる表</span><b>品質 › 設備別通過回数</b><small>データ元の一覧に「展開した表」として並び、集計表・ダッシュボード・計算列で、ふつうの列と同じに合計・平均できます</small></div>
      </div></div></section>`);
  });
}
const CSS_A = `
.jxa{display:flex;flex-direction:column;gap:12px;padding:10px 12px;border:1px solid #d7e1ec;border-radius:8px;background:#fbfcfe}
.jxa-h{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.jxa-h b{font-size:15px}.jxa-h small{font-size:12.5px;color:#4c5864}
.jxa-cols{display:flex;flex-direction:column;gap:4px}
.jxa-col{display:grid;grid-template-columns:14px 130px minmax(0,1fr) 72px;align-items:center;gap:8px;padding:4px 8px;border-radius:7px;font-size:13.5px;cursor:pointer;text-align:left}
.jxa-rd{width:13px;height:13px;border-radius:50%;border:1.5px solid #7b8896;box-sizing:border-box}.jxa-col.is-on .jxa-rd{border:4px solid #2d5f9e}
.jxa-col.is-on{background:#eaf2fc;outline:1px solid #b9d0ea}
.jxa-st{text-align:right}.jxa-off{font-size:12px;color:#4c5864}
.jxa-how{display:flex;flex-direction:column;gap:6px}.jxa-how .jx-lab small{font-weight:400;margin-left:8px}
.jxa-pats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.jxa-pats .jx-pat{display:grid;grid-template-columns:22px minmax(0,1fr);gap:0 6px;align-items:start}
.jxa-pats .jx-pat em{grid-column:2;flex-direction:row;gap:6px;align-items:baseline;flex-wrap:wrap;white-space:normal;min-width:0}
.jxa-pats .jx-pat em small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.jxa-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}
.jxa-l,.jxa-r{display:flex;flex-direction:column;gap:8px;min-width:0}
.jxa-out{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:#eef6ef;border:1px solid #c9e2cf;font-size:13px}
.jxa-out b{font-size:14px}.jxa-out small{color:#3d4a3f;font-size:12.5px}
@media (max-width:1400px){.jxa-two{grid-template-columns:1fr}}
`;

/* ------------------------------------------------------------------ B: 表示列の設定（列の詳細）に「JSON の展開」の段 */
function propB() {
  const J = window.JX;
  const total = 1500, c = J.COLS.lot[0];
  let picked = false;
  J.keep(() => {
    const list = document.querySelector("#lcList");
    if (!list) return;
    const li = list.querySelector('li[data-col="設備別通過回数"]');
    if (!li) return;
    if (!picked) { picked = true; li.scrollIntoView({ block: "center" }); li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); li.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 })); li.click(); return; }
    // 左の並び: 展開してできる 2 つの列を、元の列の下に字下げで
    if (!list.querySelector(".jxb-kid")) {
      const kid = (n, t) => `<li class="jxb-kid"><span class="jxb-tree">└</span><b>${n}</b><span class="jx-tag">展開</span><small>${t}</small></li>`;
      li.insertAdjacentHTML("afterend", kid("設備別通過回数.設備", "鍵・9 種類") + kid("設備別通過回数.通過回数", "値・数"));
    }
    const card = document.querySelector(".lc-card");
    if (!card || card.parentElement.querySelector(".jxb")) return;
    const dd = [...card.querySelectorAll("dt")].find((d) => d.textContent === "値の種類");
    if (dd) dd.nextElementSibling.innerHTML = 'JSON <span class="jx-tag">① 名前→値 97%</span>';
    card.parentElement.querySelectorAll(".lc-step.is-open").forEach((s) => s.classList.remove("is-open"));
    card.insertAdjacentHTML("afterend", `<section class="lc-step is-open jxb"><h4 role="button" tabindex="0" aria-expanded="true"><i>{ }</i>JSON の展開<span class="lc-now is-set">① で展開・1,500 → 7,970 行</span><b class="lc-chev" aria-hidden="true"></b></h4>
      <div class="jxb-in">
        <div class="jxb-row"><span class="jx-lab">中身</span>${J.bar(c, total, true)}</div>
        <div class="jxb-row"><span class="jx-lab">分け方</span><div class="jxb-seg" role="radiogroup">${J.SHAPES.map((s) => `<button type="button" role="radio" aria-checked="${s.k === "dict"}" class="${s.k === "dict" ? "is-on" : ""}" title="${J.esc(s.how)}">${s.n} ${s.name}</button>`).join("")}</div></div>
        <div class="jxb-row"><span class="jx-lab">列の名前</span><div class="jx-name">鍵<input value="設備">値<input value="通過回数"></div></div>
        <div class="jxb-row is-top"><span class="jx-lab">見本</span>${J.preview("設備", "通過回数", "L0001C1", innerHeight < 800 ? 3 : 6)}</div>
        ${J.issues(c, total, true)}
        <small class="jxb-note">この一覧の行は 1 ロット × 設備の数に増えます（7,970 行）。元に戻すときは「しない」</small>
      </div></section>`);
  });
}
const CSS_B = `
.jxb-kid{display:grid;grid-template-columns:28px minmax(0,auto) auto minmax(0,1fr);gap:6px;align-items:center;padding:5px 10px 5px 60px;font-size:13.5px;background:#f3f8fe;border-bottom:1px solid #e3eaf2;list-style:none}
.jxb-kid small{color:#4c5864;font-size:12px;white-space:nowrap}.jxb-tree{color:#7b8896}
.jxb .jxb-in{display:flex;flex-direction:column;gap:9px;padding:10px 14px 12px}
.jxb-row{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px;align-items:center}.jxb-row.is-top{align-items:start}
.jxb-seg{display:flex;flex-wrap:wrap;gap:0;border:1px solid #cfd9e4;border-radius:8px;overflow:hidden;width:max-content;max-width:100%}
.jxb-seg button{border:0;border-right:1px solid #cfd9e4;background:#fff;padding:4px 9px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.jxb-seg button:last-child{border-right:0}.jxb-seg button.is-on{background:#2d5f9e;color:#fff;font-weight:700}
.jxb-note{font-size:12px;color:#4c5864}
.jxb h4 i{font-style:normal}
`;

/* ------------------------------------------------------------------ C: 一覧の見出しの { } と、その場の展開の面（Power Query の展開の形） */
function propC() {
  const J = window.JX;
  const total = 1500, c = J.COLS.lot[0];
  let scrolled = false;
  J.keep(() => {
    const head = document.querySelector("#llHead");
    const th = head && head.querySelector('th[data-col="設備別通過回数"]');
    if (!th) return;
    const wrap = th.closest(".ll-grid-wrap");
    if (!scrolled && wrap) { scrolled = true; wrap.scrollLeft = Math.max(0, th.offsetLeft - wrap.clientWidth * 0.32); }
    J.COLS.lot.forEach((x) => {
      const h = head.querySelector(`th[data-col="${x.col}"]`);
      if (h) h.classList.add("jxc-th");
      if (h && !h.querySelector(".jxc-ic")) h.insertAdjacentHTML("afterbegin", `<span class="jxc-ic${x.col === c.col ? " is-on" : ""}" title="JSON の列。押すと分け方を選べます">{ }</span>`);
    });
    const r = th.getBoundingClientRect();
    let pop = document.querySelector(".jxc-pop");
    if (!pop) {
      document.body.insertAdjacentHTML("beforeend", `<div class="jxc-pop" role="dialog" aria-label="設備別通過回数 を展開">
        <div class="jxc-h"><b>{ } 設備別通過回数 を展開</b><button type="button" class="jxc-x" aria-label="閉じる">×</button></div>
        <div class="jxc-det"><span class="jx-lab">中身（先頭 500 行）</span>${J.bar(c, total, true)}</div>
        <div class="jxc-pats" role="radiogroup" aria-label="分け方">${J.patterns("dict", total, c.rows, "long")}</div>
        <div class="jxc-prev"><span class="jx-lab">見本 <small>元の 2 行 → 9 行。鍵「設備」・値「通過回数」（見出しを押して名前を変える）</small></span>${J.preview("設備", "通過回数", "L0001C1", innerHeight < 800 ? 3 : 6)}</div>
        ${J.issues(c, total, true)}
        <div class="jxc-acts"><button type="button" class="jx-btn">やめる</button><span style="flex:1"></span><button type="button" class="jx-btn">新しい表にする…</button><button type="button" class="jx-btn pri">この一覧で展開する</button></div>
      </div>`);
      pop = document.querySelector(".jxc-pop");
    }
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    const top = r.bottom + 4; pop.style.maxHeight = `${innerHeight - top - 8}px`;
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  });
}
const CSS_C = `
th[data-col]{position:sticky}#llHead th.jxc-th{padding-left:30px}.jxc-ic{position:absolute;left:6px;top:50%;transform:translateY(-50%);display:inline-block;font:700 11px/16px ui-monospace,Consolas,monospace;color:#fff;background:#4f7fb8;border-radius:4px;padding:0 3px;margin-right:5px;vertical-align:1px}
.jxc-ic.is-on{background:#e6a52e;color:#16202b}
.jxc-pop{position:fixed;z-index:9000;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 16px);overflow:auto;background:#fff;border:1px solid #b9c6d4;border-radius:10px;box-shadow:0 12px 32px rgba(20,35,55,.25);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.jxc-h{display:flex;align-items:center}.jxc-h b{font-size:15px;flex:1}.jxc-x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#4c5864}
.jxc-det{display:flex;flex-direction:column;gap:4px}
.jxc-pats{display:flex;flex-direction:column;gap:5px}
.jxc-prev{display:flex;flex-direction:column;gap:4px}.jxc-prev small{font-weight:400;margin-left:6px}
.jxc-acts{display:flex;gap:8px;align-items:center}
@media (max-height:760px){.jxc-pats .jx-pb small:not(.jx-rec){display:none}.jxc-pop{gap:7px;padding:9px 12px;width:min(640px,calc(100vw - 24px))}.jxc-pats{display:grid;grid-template-columns:1fr 1fr}.jxc-pats .jx-pat:first-child{grid-column:1/-1}}
`;

/* ------------------------------------------------------------------ D: ダッシュボードの組む所のカラムの札から JSON を開く */
function propD() {
  const J = window.JX;
  const c = J.COLS.wip[0], total = 1200;
  if (!window.__jxDash) { window.__jxDash = 1; setTimeout(() => document.querySelector("#tabDash")?.click(), 60); }
  J.keep(() => {
    const fields = document.querySelector("#deFields");
    if (!fields || fields.querySelector(".jxd")) return;
    // 元の 5 つの JSON の札は札の並びから外し、上のまとまりに寄せる
    J.COLS.wip.forEach((x) => [...fields.querySelectorAll(".pv-f")].filter((f) => f.querySelector("b")?.firstChild?.textContent === x.col).forEach((f) => f.remove()));
    const sub = (n, t, roles) => `<div class="pv-f jxd-sub${n === "› 通過回数" || n === "› 設備" ? " is-used" : ""}"><span><b>${n}</b><small>${t}</small></span>${roles}</div>`;
    const rb = (k, on) => `<button type="button" class="pv-r r-${{ 行: "rows", 列: "cols", 値: "vals" }[k]}${on ? " on" : ""}" aria-pressed="${!!on}">${k}</button>`;
    const others = J.COLS.wip.slice(1).map((x) => `<div class="jxd-c"><span class="jxd-car">▸</span><b>${x.col}</b><small>${J.shapeOf(x.shape).n} ${J.shapeOf(x.shape).name} · ${J.fmt(x.rows)} 行</small></div>`).join("");
    fields.insertAdjacentHTML("afterbegin", `<div class="jxd"><div class="jxd-h"><b>{ } JSON の列 5</b><small>開くと分けた列を使えます</small></div>
      <div class="jxd-c is-open"><span class="jxd-car">▾</span><b>設備別通過回数</b><small>${J.fmt(c.total || 1200)} 行 → ${J.fmt(c.rows)} 行</small></div>
      <div class="jxd-pick"><button type="button" class="jxd-how" title="分け方を選ぶ（① 〜 ⑤。合う割合つき）">① 名前→値 ▾</button><small class="jxd-fit">合う 97%</small></div>
      ${sub("› 設備", "鍵 · 9 種類", rb("行", true) + rb("列") + "<i></i>")}
      ${sub("› 通過回数", "値 · 数", "<i></i><i></i>" + rb("値", true))}
      <div class="jxd-warn" role="status">⚠ 9 行は分けられず数えていません（壊れ 5・違う形 4）<button type="button" class="jx-link">見る</button></div>
      ${others}</div>`);
  });
  // 文と図: 「設備別通過回数 › 設備 ごとに、通過回数 の合計 を出す」の見本
  J.keep(() => {
    const ed = document.querySelector("#dbEditor");
    if (!ed) return;
    const nm = document.querySelector("#deTitle");
    if (nm && nm.value !== "設備ごとの通過回数の合計") nm.value = "設備ごとの通過回数の合計";
    const chips = [...ed.querySelectorAll(".pv-chip")];
    chips.forEach((ch) => {
      const b = ch.querySelector("b");
      if (/仕掛区分/.test(ch.textContent) && !ch.dataset.jx) { ch.dataset.jx = 1; if (b) b.textContent = "設備別通過回数 › 設備"; }
      if (/ロット数/.test(ch.textContent) && !ch.dataset.jx) { ch.dataset.jx = 1; if (b) b.textContent = "› 通過回数"; }
    });
    ed.querySelectorAll(".de-main b, .de-main span, .de-main label").forEach((x) => { if (x.children.length === 0 && x.textContent === "ロット数" && !x.closest("#deFields")) x.textContent = "通過回数"; });
    const panel = document.querySelector('#dashGrid .db-p[data-id="wipClass"]');
    const body = panel && panel.querySelector(".db-pb");
    if (panel && !panel.querySelector(".jxd-res")) {
      const t = panel.querySelector(".db-ph h3");
      if (t && !t.dataset.jx) { t.dataset.jx = 1; t.textContent = "設備ごとの通過回数の合計"; }
      if (body) body.innerHTML = `<div class="jxd-res"><small>仕掛 › 設備別通過回数（① で 1,167 行を 6,332 行に） · 計 7,949.8 回</small>${J.bars(J.SUMS.wip)}</div>`;
    }
  });
}
const CSS_D = `
.jxd{display:flex;flex-direction:column;gap:4px;padding:6px;margin-bottom:8px;border:1px solid #b9d0ea;border-radius:8px;background:#f3f8fe}
.jxd-h{display:flex;flex-direction:column}.jxd-h b{font-size:13.5px}.jxd-h small{font-size:12px;color:#4c5864}
.jxd-c{display:grid;grid-template-columns:12px minmax(0,1fr);gap:0 5px;align-items:center;padding:4px 6px;border-radius:6px;background:#fff;border:1px solid #dbe4ee;font-size:13px}
.jxd-c b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.jxd-c small{grid-column:2;font-size:11.5px;color:#4c5864;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.jxd-car{color:#4c5864;font-size:11px}
.jxd-c.is-open{border-color:#3f7fcf}
.jxd-pick{display:flex;gap:6px;align-items:center;padding-left:12px;min-width:0}.jxd-fit{font-size:12px;color:#1d6b3a;font-weight:700;white-space:nowrap}
.jxd-how{border:1px solid #9db9d8;background:#fff;border-radius:6px;padding:2px 8px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.jxd-sub{margin-left:12px}
.jxd-warn{font-size:12px;color:#8a2a1f;padding-left:12px}
.jxd-res{display:flex;flex-direction:column;gap:6px;padding:4px 18px 10px;height:100%;box-sizing:border-box}.jxd-res small{font-size:12px;color:#4c5864}
.jxd-res .jx-chart{flex:1 1 0;min-height:0;justify-content:space-around;gap:2px}.jxd-res .jx-cr{flex:1 1 0;min-height:0;max-height:34px}.jxd-res .jx-cr i{height:min(20px,100%)}
`;

/* ------------------------------------------------------------------ E: 展開の窓（1 枚の窓で左から右へ: 列 → 分け方 → 見本と確かめ） */
function propE() {
  const J = window.JX;
  const total = 1500, c = J.COLS.lot[0];
  J.keep(() => {
    const colBtn = document.querySelector("#llColBtn");
    if (colBtn && !document.querySelector(".jxe-open")) colBtn.insertAdjacentHTML("beforebegin", '<button type="button" class="jxe-open" title="JSON の列を行・列に分けた表を作ります">{ } JSON<span class="jxe-long"> を展開…</span></button>');
    if (document.querySelector(".jxe") || !document.querySelector("#llBody tr")) return;
    const cols = J.COLS.lot.map((x, i) => `<button type="button" class="jxe-col${i === 0 ? " is-on" : ""}"><b>${x.col}</b>${J.bar(x, total)}</button>`).join("");
    document.body.insertAdjacentHTML("beforeend", `<div class="jxe-back"></div><div class="jxe" role="dialog" aria-label="JSON の列を展開">
      <div class="jxe-h"><b>JSON の列を展開</b><small>品質 · 中身の先頭 500 行を読みました</small><span style="flex:1"></span><button type="button" class="jxe-x" aria-label="閉じる">×</button></div>
      <div class="jxe-body">
        <section><h5><i>1</i>列</h5><div class="jxe-cols">${cols}</div></section>
        <section><h5><i>2</i>分け方</h5><div class="jxe-pats" role="radiogroup">${J.patterns("dict", total, c.rows, "long")}</div>
          <div class="jx-name">鍵の列<input value="設備">値の列<input value="通過回数"></div></section>
        <section><h5><i>3</i>見本と確かめ</h5>${J.preview()}${J.issues(c, total, false)}</section>
      </div>
      <div class="jxe-f"><span>できる表 <b>品質 › 設備別通過回数</b>（1,500 行 → 7,970 行）。データ元に並び、集計表・ダッシュボードで使えます</span><span style="flex:1"></span><button type="button" class="jx-btn">やめる</button><button type="button" class="jx-btn pri">表を作る</button></div>
    </div>`);
  });
}
const CSS_E = `
.jxe-open{border:1px solid #9db9d8;background:#f2f7fd;color:#1f4f8a;border-radius:7px;padding:0 10px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap;margin-right:6px;height:32px}
@media (max-width:1600px){.jxe-long{display:none}}
.jxe-back{position:fixed;inset:0;background:rgba(16,28,44,.38);z-index:8990}
.jxe{position:fixed;z-index:9000;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1240px,calc(100vw - 32px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 16px 40px rgba(20,35,55,.3);overflow:hidden}
.jxe-h{display:flex;align-items:baseline;gap:12px;padding:12px 18px;background:#1e3a57;color:#fff}.jxe-h b{font-size:17px}.jxe-h small{font-size:12.5px;color:#d6e2ee}
.jxe-x{border:0;background:none;color:#fff;font-size:22px;line-height:1;cursor:pointer}
.jxe-body{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1.1fr);gap:0;overflow:auto;min-height:0}
.jxe-body section{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-right:1px solid #e3eaf2;min-width:0}
.jxe-body section:last-child{border-right:0}
.jxe-body h5{margin:0;font-size:14px;display:flex;gap:7px;align-items:center}.jxe-body h5 i{font-style:normal;display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#2d5f9e;color:#fff;font-size:12px}
.jxe-cols{display:flex;flex-direction:column;gap:5px}
.jxe-col{display:flex;flex-direction:column;gap:3px;text-align:left;border:1px solid #d7e1ec;border-radius:8px;background:#fff;padding:6px 9px;font:inherit;font-size:13.5px;cursor:pointer;min-width:0}
.jxe-col.is-on{border:2px solid #3f7fcf;background:#f2f7fd;padding:5px 8px}
.jxe-pats{display:flex;flex-direction:column;gap:5px}
.jxe-f{display:flex;align-items:center;gap:8px;padding:10px 18px;border-top:1px solid #e3eaf2;background:#f6f8fb;font-size:13px}
.jxe-pats .jx-pb small{white-space:normal}
@media (max-height:760px){.jxe-pats .jx-pb small:not(.jx-rec){display:none}.jxe-body section{padding:8px 12px;gap:6px}}
`;

/* ------------------------------------------------------------------ F: 自動で展開（何も選ばない。札にはじめから分けた列が並ぶ） */
function propF() {
  const J = window.JX;
  if (!window.__jxDash) { window.__jxDash = 1; setTimeout(() => document.querySelector("#tabDash")?.click(), 60); }
  J.keep(() => {
    const fields = document.querySelector("#deFields");
    if (!fields || fields.querySelector(".jxf-n")) return;
    const cards = [...fields.querySelectorAll(".pv-f")];
    const find = (col) => cards.find((f) => f.querySelector("b")?.firstChild?.textContent === col);
    const rb = (k, on) => `<button type="button" class="pv-r r-${{ 行: "rows", 列: "cols", 値: "vals" }[k]}${on ? " on" : ""}" aria-pressed="${!!on}">${k}</button>`;
    // JSON の列の札を、分けた列の札に置き換える（元の札の場所のまま。名前は「元の列.鍵」）
    const auto = {
      設備別通過回数: [["設備別通過回数.鍵", "9 種類", rb("行", true) + rb("列") + "<i></i>", true], ["設備別通過回数.値", "数", "<i></i><i></i>" + rb("値", true), true]],
      測定値: [["測定値.値", "数 · 数でない 30 行", "<i></i><i></i>" + rb("値")]],
      工程履歴: [["工程履歴.設備", "9 種類", rb("行") + rb("列") + "<i></i>"], ["工程履歴.回", "数", "<i></i><i></i>" + rb("値")], ["工程履歴.日", "日付", rb("行") + rb("列") + "<i></i>"]],
      仕様: [["仕様.寸法.幅", "数 · 3 種類", rb("行") + rb("列") + rb("値")], ["仕様.寸法.厚", "数 · 3 種類", rb("行") + rb("列") + rb("値")], ["仕様.検査.者", "2 種類", rb("行") + rb("列") + "<i></i>"]],
      設備別実績: [["設備別実績.鍵", "9 種類", rb("行") + rb("列") + "<i></i>"], ["設備別実績.回", "数", "<i></i><i></i>" + rb("値")], ["設備別実績.分", "数", "<i></i><i></i>" + rb("値")]],
    };
    const first = find("設備別通過回数");
    Object.entries(auto).forEach(([col, list]) => {
      const f = find(col);
      if (!f) return;
      f.insertAdjacentHTML("beforebegin", list.map(([n, t, r, used]) => `<div class="pv-f jxf-f${used ? " is-used" : ""}"><span><b>${n}</b><small><i class="jxf-mk">JSON</i>${t}</small></span>${r}</div>`).join(""));
      f.remove();
    });
    fields.insertAdjacentHTML("afterbegin", `<div class="jxf-n" role="note"><b>JSON の列を 5 つ見つけ、中身の形で分けました</b><small>札の「JSON」の印。分け方は データ元 › JSON の列 で変えられます</small></div>`);
    // 使う札を見える所へ
    const used = fields.querySelector(".jxf-f");
    if (used && first !== null) { const n = fields.querySelector(".jxf-n"); n.after(...[...fields.querySelectorAll(".jxf-f")].slice(0, 2)); }
  });
  J.keep(() => {
    const ed = document.querySelector("#dbEditor");
    if (!ed) return;
    const nm = document.querySelector("#deTitle");
    if (nm && nm.value !== "設備ごとの通過回数の合計") nm.value = "設備ごとの通過回数の合計";
    [...ed.querySelectorAll(".pv-chip")].forEach((ch) => {
      const b = ch.querySelector("b");
      if (/仕掛区分/.test(ch.textContent) && !ch.dataset.jx) { ch.dataset.jx = 1; if (b) b.textContent = "設備別通過回数.鍵"; }
      if (/ロット数/.test(ch.textContent) && !ch.dataset.jx) { ch.dataset.jx = 1; if (b) b.textContent = "設備別通過回数.値"; }
    });
    ed.querySelectorAll(".de-main b, .de-main span, .de-main label").forEach((x) => { if (x.children.length === 0 && x.textContent === "ロット数" && !x.closest("#deFields")) x.textContent = "設備別通過回数.値"; });
    const panel = document.querySelector('#dashGrid .db-p[data-id="wipClass"]');
    const body = panel && panel.querySelector(".db-pb");
    if (panel && !panel.querySelector(".jxd-res")) {
      const t = panel.querySelector(".db-ph h3");
      if (t && !t.dataset.jx) { t.dataset.jx = 1; t.textContent = "設備ごとの通過回数の合計"; }
      if (body) body.innerHTML = `<div class="jxd-res">${J.bars(J.SUMS.wip)}<small class="jxf-foot">ⓘ 設備別通過回数 は 1,167 行を 6,332 行に分けて数えました。空 24 行・分けられない 9 行（壊れ 5・違う形 4）は数えていません <button type="button" class="jx-link">見る</button></small></div>`;
    }
  });
}
const CSS_F = `
.jxf-n{display:flex;flex-direction:column;gap:2px;padding:6px 8px;margin-bottom:6px;border-radius:7px;background:#f3f8fe;border:1px solid #b9d0ea}
.jxf-n b{font-size:12.5px}.jxf-n small{font-size:12px;color:#4c5864}
.jxf-mk{font-style:normal;font-size:11px;font-weight:700;color:#1f4f8a;background:#e1ecf9;border-radius:4px;padding:0 4px;margin-right:5px}
.jxd-res{display:flex;flex-direction:column;gap:6px;padding:4px 18px 10px;height:100%;box-sizing:border-box}
.jxd-res .jx-chart{flex:1 1 0;min-height:0;justify-content:space-around;gap:2px}.jxd-res .jx-cr{flex:1 1 0;min-height:0;max-height:34px}.jxd-res .jx-cr i{height:min(20px,100%)}
.jxf-foot{font-size:12px;color:#4c5864}
`;

const S = (fn) => `(${lib})(); (${fn})();`;
export const PROPOSALS = [
  {
    key: "A", name: "データ元のカードに「JSON の列」の段", css: BASE_CSS + CSS_A, ops: [["script", S(propA)]],
    shots: "master-sources-join（品質データのカードを開いた所）",
    impl: "データ元ごとの設定（sources の「JSON」: [{列, 形, 鍵の名前, 値の名前, 道筋}]）に持つ。窓は join.rs と同じ形で、写しのファイルから展開した表を作業場所の db_cache/expands に 1 つのファイルとして組み（SQLite の json_each・json_tree。形の見分けと壊れた行の数は新しい desktop/src/json_expand.rs）、元の写しの大きさ・時刻と決まりが変わったときだけ組み直す。展開した表は「結合した表」と同じくデータ元の一覧に並ぶので、集計表・ダッシュボード・計算列・スライサーは今の道（lotlist.rs・pivot.rs・dashboard.rs）のまま読む。",
  },
  {
    key: "B", name: "表示列の設定の列の詳細に「JSON の展開」の段", css: BASE_CSS + CSS_B, ops: [["script", S(propB)]],
    shots: "columns（表示列の設定で 設備別通過回数 を選んだ所）",
    impl: "表示列の設定（一覧の書式 columns.expand: {列: {形, 鍵, 値}}）に持つ。一覧の問い合わせ（lotlist.rs の SELECT）に json_each の横結合を足して行を増やし、できる列（列.鍵・列.値）を計算列と同じ札で出す。集計表・ダッシュボードは書式の展開を問い合わせに載せて同じ SQL で数える（pivot.rs・dashboard.rs に expand を渡す）。見分けは desktop/src/json_expand.rs。",
  },
  {
    key: "C", name: "一覧の見出しの { } から、その場で分け方を選ぶ面", css: BASE_CSS + CSS_C, ops: [["script", S(propC)]],
    shots: "list（一覧。JSON の列まで横に送り、設備別通過回数 の { } を押した所）",
    impl: "見出しの { } は列の見分け（desktop/src/json_expand.rs の detect: 先頭 500 行の形を数える。一覧の列の札〈search_index の札〉と一緒に覚える）で出す。「この一覧で展開する」は B と同じ一覧の書式の expand、「新しい表にする…」は A と同じ db_cache/expands の展開した表。どちらも問い合わせは SQLite の json_each。",
  },
  {
    key: "D", name: "ダッシュボードの組む所のカラムの札で JSON を開く", css: BASE_CSS + CSS_D, ops: [["script", S(propD)]],
    shots: "dash-panel（組む所。上に JSON の列のまとまり、設備別通過回数 を開いて › 設備 を行・› 通過回数 を値に置いた所。パネルは設備ごとの通過回数の合計）",
    impl: "パネルの組み（dashboard の panel.expand: {列, 形}）に持ち、dashboard.rs・pivot.rs の問い合わせが json_each を横結合して数える。札（› 鍵・› 値）は組む所のカラムの札の答え（/api/dashboard/fields）に、json_expand.rs の見分けから足す。一覧・計算列からは使えない（パネルだけ）。",
  },
  {
    key: "E", name: "展開の窓（1 枚の窓で 列 → 分け方 → 見本と確かめ）", css: BASE_CSS + CSS_E, ops: [["script", S(propE)]],
    shots: "list（一覧の道具の行の「{ } JSON を展開…」から開いた窓）",
    impl: "窓で決めた展開を、A と同じくデータ元（「展開した表」の役割）として sources に足す。組むのは join.rs と同じ形の db_cache/expands（json_each・json_tree）で、集計表・ダッシュボード・計算列は今の道で読む。窓の数（形ごとの行・合わない行・見本）は新しい GET /api/sources/{key}/json?col=… が json_expand.rs で答える。",
  },
  {
    key: "F", name: "自動で展開（何も選ばない。札にはじめから分けた列が並ぶ）", css: BASE_CSS + CSS_F, ops: [["script", S(propF)]],
    shots: "dash-panel（組む所。JSON の列の札が 設備別通過回数.鍵・.値 などに置き換わり、パネルの下に数えなかった行の添え書き）",
    impl: "列の札を作るとき（search_index の札・/api/dashboard/fields）に json_expand.rs が先頭 500 行で形を決め（いちばん多い形が 90% 以上なら自動）、問い合わせが札の名前（列.鍵）を見たときだけ json_each で展開する。変える所はデータ元のカードの「JSON の列」（A の段を小さくした物）だけ。",
  },
];
