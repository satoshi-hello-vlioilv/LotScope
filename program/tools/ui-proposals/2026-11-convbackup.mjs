// 改良「変換表のバックアップと戻す」（利用者の改良依頼 2026-11-17 の 5「変換表をアップデートして使っていますが、間違ってボタンを押して同梱版に戻されないか心配です。
// データを保存してもすべての表が保存できたのか1つの変換表が保存できているのかわからないし、全体バックアップも一部の表のバックアップもどちらも対応できるようにしてほしいです。
// いつのデータに戻してどうなるのか、より分かりやすく管理できるようにしてください。（管理者、メンテナンス者限定の機能でよいです）」）の案（回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面（ui-harness.mjs の状態 cvb 〜 cvb-off。この比べのために convx-off の後ろへ足した）:
//   cvb         … マスタ管理の変換表で「管理分類」を開いた所（左の一覧の下に 書き出す・取り込む・標準）
//   cvb-saved   … 変えずに「保存」を押した直後（知らせ）
//   cvb-hist    … 案の「履歴・戻す」を開いた所（[data-cvb-hist] を押す。今は何も起きない）
//   cvb-diff    … 案の「戻すと何が変わるか」を開いた所（[data-cvb-diff] を押す。今は何も起きない）
//   cvb-import  … 書き出したファイルの地取区分を 2 行にし、表を 1 つ足して「取り込む…」で読んだ所（取り込む前の確かめ）
//   cvb-std     … 「今の表を標準に」をした後（標準が「取り込んだ表」になり、「同梱に戻す」が出る）
//   cvb-bundled … 「同梱に戻す」を押した所（今はブラウザの確かめの窓を閉じる。案は頁の中で、何が変わるかを見せる）
//   cvb-plan    … 一覧の表示列の窓の変換表の帯（版 3.124.0 の採点の残り: 帯が高く、1536・1280 で下のリンク「変換表を直す（マスタ管理）」が隠れる）
//
//   TPA_UI_EXE=/home/user/LotScope/desktop/target/debug/examples/ui_serve TPA_UI_PROGRAM=<作業場所>/program \
//     node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-convbackup.mjs \
//     --from cvb --states cvb,cvb-saved,cvb-hist,cvb-diff,cvb-import,cvb-std,cvb-bundled,cvb-plan,cvb-off   （--view 1536x864・--view 1280x720 でも。1 つずつ流す）
//
// 履歴（戻せる時点）は、案の頁の中で作った見本（撮る場面には履歴が無い）。中身は今の変換表（/api/masters/conversions）を写して、
//   管理分類の行を減らす・出す値を 1 つ変える・課名の行を減らす などをした物で、「戻すと何が変わるか」の数（行の数・変わる行）は頁の中で本当に比べて数えた数。
//   時点: 11/26 10:42「管理分類」を保存する前（自動・1 表）・11/26 09:15 取り込む前（自動・全体）・11/25 17:30 月末のバックアップ（手で・全体）・
//   11/20 13:05 課名を直す前（手で・2 表）・11/12 08:50 同梱に戻す前（自動・全体）。
//
// どの案にも入れる直し（COMMON。採点のファイルの common_build）:
//   (1) 保存の知らせに範囲を書く（「管理分類」だけ＝この 1 表・ほかの 9 表は変えていない・前の形は履歴に残した）。知らせは送っても見える所（上に貼り付け）。
//       置き場が「手元のみ」のときに「ほかの PC には数秒で届きます」と言わない
//   (2) 「今の表を標準に」の後の標準の名前を「取り込んだ表」と言わない（自分で決めた表）
//   (3) 取り込む前の確かめに、表ごとの行の数（地取区分 5 行 → 2 行）と、取り込む前の今を自動で残すことを書く
//   (4) 表示列の窓の変換表の帯: 「変換表を直す ›」を帯の頭の行へ（いつも見える）、当てられない表は 1 行のまとめ（名前を並べる）に畳む。帯が低くなり、1536・1280 で列の一覧が残る
//   (5) 窓の側: 変換表を書く道（保存・足す・取り込む・標準に戻す・同梱に戻す・消す・戻す）は、書く直前の形を自動で残す（持ち方は案ごと）。
//       戻す・バックアップの道は、管理のマスタと同じ「編集可」（開発者・メンテナンス者）だけ。ほかの人には履歴の部品を出さない
// 案ごとに違うのは、履歴と戻すの置き場と流れ（A 履歴のタブ・B 取り消せる帯・C 1 つの窓に畳む・D 表ごとの版と状態・E 戻す手順の窓）。

/* ------------------------------------------------------------------ 共通の部品（頁の中で動く。window.CB） */
function lib() {
  if (window.CB) return;
  const CB = (window.CB = { view: "edit", sel: "p3", row: null, items: null, open: null, band: null });
  CB.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  CB.keep = (fn, ms = 150) => { const t = () => { try { fn(); } catch (e) { console.warn("案:", e.message); } }; t(); setInterval(t, ms); };
  CB.page = () => document.querySelector("#masterSettings .cv-page");
  CB.name = () => (document.querySelector("#cvName") || {}).value || "";
  CB.load = async () => {
    if (CB.loading) return; CB.loading = true;
    try { const d = await (await fetch("/api/masters/conversions", { cache: "no-store" })).json(); CB.items = d.items || []; CB.build(); }
    catch (_) { CB.loading = false; }
  };
  /* 見本の履歴: 今の表を写して、少し違う形にした物（違いは下の diff で本当に数える） */
  CB.build = () => {
    const now = CB.items, clone = (x) => JSON.parse(JSON.stringify(x));
    const older = (mods) => now.map((x) => { const y = clone(x); if (mods[x.name]) mods[x.name](y); return y; });
    const out3 = (y) => { if (y.rows[2]) y.rows[2].out = "8-10mm"; };
    CB.points = [
      { id: "p1", day: "11/26（木）", time: "10:42", who: "山田（PC-03）", auto: true, why: "「管理分類」を保存する前", scope: ["管理分類"], tables: older({ "管理分類": out3 }) },
      { id: "p2", day: "11/26（木）", time: "09:15", who: "山田（PC-03）", auto: true, why: "取り込む前（変換表_2026-11-25.json）", scope: "all", tables: older({ "管理分類": (y) => { y.rows = y.rows.slice(0, -1); out3(y); } }) },
      { id: "p3", day: "11/25（水）", time: "17:30", who: "鈴木（PC-02）", auto: false, why: "月末のバックアップ", scope: "all", tables: older({ "管理分類": (y) => { y.rows = y.rows.slice(0, -2); out3(y); }, "課名": (y) => { y.rows = y.rows.slice(0, -1); } }) },
      { id: "p4", day: "11/20（金）", time: "13:05", who: "鈴木（PC-02）", auto: false, why: "課名を直す前", scope: ["管理分類", "課名"], tables: older({ "管理分類": (y) => { y.rows = y.rows.slice(0, -3); out3(y); }, "課名": (y) => { y.rows = y.rows.slice(0, -2); } }) },
      { id: "p5", day: "11/12（木）", time: "08:50", who: "山田（PC-03）", auto: true, why: "標準を同梱に戻す前", scope: "all", tables: older({ "管理分類": (y) => { y.rows = y.rows.slice(0, -4); }, "課名": (y) => { y.rows = y.rows.slice(0, -2); }, "地取区分": (y) => { if (y.rows[0]) y.rows[0].out += "（旧）"; } }) },
    ];
    CB.bundled = { id: "pb", day: "同梱", time: "", who: "アプリ 版 3.124.0", auto: true, why: "同梱のプリセット", scope: "all", preset: true,
      tables: older({ "管理分類": (y) => { y.rows = y.rows.slice(0, -5); out3(y); }, "課名": (y) => { y.rows = y.rows.slice(0, -3); } }).filter((x) => x.preset) };
  };
  CB.who = (p) => `<span class="cb-who">${CB.esc(p.who)}</span>`;   // 人と PC の名前は途中で折らない
  CB.point = (id) => (CB.points || []).concat(CB.bundled ? [CB.bundled] : []).find((p) => p.id === id);
  CB.nTables = () => (CB.items || []).length;
  CB.scopeText = (p) => (p.scope === "all" ? `全体 ${p.tables.length} 表` : `${p.scope.length} 表（${p.scope.join("・")}）`);
  /* 戻すと何が変わるか（表ごと）。行は並びの位置で比べる */
  CB.rowDiff = (n, s) => {
    const k = (r) => JSON.stringify(r), L = Math.max(n.rows.length, s.rows.length), rows = [];
    for (let i = 0; i < L; i++) {
      const a = n.rows[i], b = s.rows[i];
      if (!a) rows.push({ i, kind: "add", then: b.out }); else if (!b) rows.push({ i, kind: "del", now: a.out });
      else if (k(a) !== k(b)) rows.push({ i, kind: "chg", now: a.out, then: b.out });
    }
    return rows;
  };
  CB.diff = (p, only) => {
    const now = CB.items || [], snap = p.scope === "all" ? p.tables : p.tables.filter((t) => p.scope.includes(t.name)), out = [];
    for (const s of snap) {
      if (only && !only.includes(s.name)) continue;
      const n = now.find((x) => x.name === s.name);
      if (!n) { out.push({ name: s.name, st: "back", now: null, then: s.rows.length, rows: [] }); continue; }
      const rows = CB.rowDiff(n, s);
      out.push({ name: s.name, st: rows.length ? "chg" : "same", now: n.rows.length, then: s.rows.length, rows });
    }
    if (p.scope === "all" && !p.preset) for (const n of now) if (!snap.some((s) => s.name === n.name)) out.push({ name: n.name, st: "gone", now: n.rows.length, then: null, rows: [] });
    return out;
  };
  CB.what = (d) => {
    if (d.st === "same") return "変わりません";
    if (d.st === "back") return `表が戻ります（${d.then} 行）`;
    if (d.st === "gone") return "この時点に無い表（消えます）";
    const del = d.rows.filter((r) => r.kind === "del").length, add = d.rows.filter((r) => r.kind === "add").length, chg = d.rows.filter((r) => r.kind === "chg").length;
    return [del ? `${del} 行が消える` : "", add ? `${add} 行が戻る` : "", chg ? `出す値が ${chg} つ変わる` : ""].filter(Boolean).join("・");
  };
  CB.stChip = (st) => ({ chg: '<span class="cb-st is-chg">変わる</span>', same: '<span class="cb-st is-same">同じ</span>', back: '<span class="cb-st is-back">戻る</span>', gone: '<span class="cb-st is-gone">消える</span>' })[st];
  CB.kChip = (p) => (p.preset ? '<span class="cb-k is-pre">同梱</span>' : p.auto ? '<span class="cb-k is-auto">自動</span>' : '<span class="cb-k is-man">手で</span>');
  CB.scChip = (p) => `<span class="cb-sc">${p.scope === "all" ? "全体" : `${p.scope.length} 表`}</span>`;
  /** 戻せる時点の並び（新しい順）。sel は選んでいる時点 */
  CB.pointsHtml = (sel, { bundled = true, count = true } = {}) => (CB.points || []).concat(bundled && CB.bundled ? [CB.bundled] : []).map((p) => {
    const n = count ? CB.diff(p).filter((d) => d.st !== "same").length : 0;
    return `<button type="button" class="cb-pt${p.id === sel ? " is-on" : ""}" data-cvb-pt="${p.id}"><span class="cb-pt1"><b>${p.preset ? "同梱のプリセット" : `${p.day} ${p.time}`}</b>${CB.kChip(p)}${CB.scChip(p)}</span>`
      + `<span class="cb-pt2">${p.preset ? CB.esc(p.who) : `${CB.esc(p.why)} · ${CB.who(p)}`}</span>${count ? `<span class="cb-pt3">${n ? `今と違う表 ${n}` : "今と同じ"}</span>` : ""}</button>`;
  }).join("");
  /** 表ごとの違いの表（check: 選ぶ欄・open: 行まで開く表の名前） */
  CB.diffHtml = (p, { check = true, open = null, only = null } = {}) => {
    const all = CB.diff(p, only), ds = all.filter((d) => d.st !== "same"), same = all.filter((d) => d.st === "same");
    // 変わらない表は 1 行のまとめに畳む（名前は並べる。表が長くなって戻すボタンが下へ逃げない）
    const sameRow = same.length ? `<tr class="is-same cb-samerow">${check ? "<td></td>" : ""}<td colspan="5">${CB.stChip("same")} 変わらない ${same.length} 表: ${same.map((d) => `<span class="cb-who">${CB.esc(d.name)}</span>`).join("・")}</td></tr>` : "";
    return `<table class="cb-dt"><thead><tr>${check ? "<th></th>" : ""}<th>表</th><th>今</th><th>戻すと</th><th>変わる所</th><th></th></tr></thead><tbody>${ds.map((d) =>
      `<tr class="is-${d.st}">${check ? `<td><input type="checkbox" aria-label="${CB.esc(d.name)} を戻す"${d.st !== "same" ? " checked" : " disabled"}></td>` : ""}`
      + `<td><b>${CB.esc(d.name)}</b></td><td>${d.now == null ? "—" : `${d.now} 行`}</td><td>${d.then == null ? "—" : `${d.then} 行`}</td>`
      + `<td>${CB.stChip(d.st)} ${CB.esc(CB.what(d))}</td><td>${d.rows.length ? `<button type="button" class="cb-lnk" data-cvb-diff="${CB.esc(d.name)}">${open === d.name ? "行を閉じる ▴" : "行を見る ▾"}</button>` : ""}</td></tr>`
      + (open === d.name ? `<tr class="cb-rowsx"><td colspan="${check ? 6 : 5}">${CB.rowsHtml(d)}</td></tr>` : "")).join("")}${sameRow}</tbody></table>`;
  };
  CB.rowsHtml = (d) => `<table class="cb-rt"><thead><tr><th>行</th><th>今の出す値</th><th></th><th>戻すと</th></tr></thead><tbody>${d.rows.map((r) =>
    `<tr class="is-${r.kind}"><td>${r.i + 1}</td><td>${r.kind === "add" ? '<i class="cb-none">（無い）</i>' : CB.esc(r.now)}</td><td>${r.kind === "del" ? '<span class="cb-st is-gone">消える</span>' : r.kind === "add" ? '<span class="cb-st is-back">戻る</span>' : '<span class="cb-st is-chg">変わる</span>'}</td>`
    + `<td>${r.kind === "del" ? '<i class="cb-none">（行が無くなる）</i>' : CB.esc(r.then)}</td></tr>`).join("")}</tbody></table>`;
  /** 「同梱に戻す」が何を変えるか（表の中身は変えない・変わるのは「標準に戻す」で戻る先） */
  CB.bundledDiff = () => {
    const b = CB.bundled; if (!b) return [];
    return b.tables.map((s) => { const n = (CB.items || []).find((x) => x.name === s.name); return { name: s.name, now: n ? n.rows.length : null, then: s.rows.length, same: n && !CB.rowDiff(n, s).length }; });
  };
  CB.bundledHtml = () => {
    const ds = CB.bundledDiff(), ch = ds.filter((d) => !d.same);
    return `<p class="cb-say"><b>表の中身は変わりません。</b>変わるのは、表ごとの「標準に戻す」で戻る先だけです（今の標準: 自分で決めた ${CB.nTables()} 表 → 同梱のプリセット ${ds.length} 表）。</p>`
      + `<p class="cb-say">戻る先が変わる表: ${ch.length ? ch.map((d) => `<b>${CB.esc(d.name)}</b>（${d.now} 行 → 同梱 ${d.then} 行）`).join("・") : "ありません"}。今の標準は履歴に残すので、あとで戻せます。</p>`;
  };

  /* ---------------- 共通の直し (1)(2)(3)(4) ---------------- */
  CB.common = () => {
    if (!CB.items) { CB.load(); }
    const local = /手元のみ/.test((document.querySelector("#masterOverlay .mo-share, #masterOverlay header") || document.querySelector("#masterOverlay") || {}).textContent || "");
    const n = document.querySelector("#cvNotice.ok");
    if (n && !n.dataset.cb) {
      const m = n.textContent.match(/「(.+)」を保存しました（(\d+) 行）/);
      if (m) {
        n.dataset.cb = "1";
        n.innerHTML = `✓ <b>「${CB.esc(m[1])}」だけ</b>を保存しました（この 1 表・${m[2]} 行。ほかの ${Math.max(0, CB.nTables() - 1)} 表は変えていません）。保存する前の形は履歴に残しました。`
          + (local ? "この PC の一覧にすぐ効きます" : "この PC の一覧にすぐ効き、ほかの PC には数秒で届きます");
      }
    }
    const std = document.querySelector(".cv-std b");
    if (std && std.textContent === "取り込んだ表") std.textContent = "自分で決めた表";
    const imp = document.querySelector(".cv-imp");
    if (imp && !imp.dataset.cb && window.__cvbIncoming && CB.items) {
      imp.dataset.cb = "1";
      const lines = window.__cvbIncoming.map((x) => { const n0 = CB.items.find((y) => y.name === x.name);
        return `<li><b>「${CB.esc(x.name)}」</b>${n0 ? `置き換え: ${n0.rows.length} 行 → ${x.rows.length} 行（${CB.rowDiff(n0, x).length ? CB.what({ st: "chg", rows: CB.rowDiff(n0, x) }) : "同じ"}）` : `足す: ${x.rows.length} 行`}</li>`; }).join("");
      imp.querySelectorAll(":scope > div:not(.cv-impbtns)").forEach((e) => e.remove());
      setTimeout(() => imp.scrollIntoView({ block: "nearest" }), 50);   // 取り込む前の確かめは、押した所から離れた頁の上に出るので見える所へ
      imp.querySelector(":scope > b").insertAdjacentHTML("afterend", `<ul class="cb-implist">${lines}</ul><p class="cb-say">ほかの ${CB.nTables() - window.__cvbIncoming.filter((x) => CB.items.some((y) => y.name === x.name)).length} 表は変えません。取り込む前の今の ${CB.nTables()} 表は、自動で履歴に残します（あとで戻せます）。</p>`);
    }
    // (4) 表示列の窓の変換表の帯
    const box = document.querySelector("#lcConv");
    if (box && !box.hidden) {
      const bar = box.querySelector(".lc-cvbar"), more = bar && bar.querySelector("[data-cv-more]");
      if (bar && !bar.querySelector(".cb-cvlink")) {
        const a = Object.assign(document.createElement("a"), { href: "#", className: "cb-cvlink", textContent: "変換表を直す ›", title: "マスタ管理の変換表を開きます" });
        a.dataset.cvMaster = "";
        (more || bar.lastChild).before(a);
      }
      const pick = box.querySelector(".lc-cvpick");
      if (pick && !pick.dataset.cb) {
        pick.dataset.cb = "1";
        const none = [...pick.querySelectorAll(".lc-cvi.is-none")];
        pick.querySelector(".lc-cvmaster")?.remove();
        if (none.length) {
          const names = none.map((l) => l.querySelector("b").textContent);
          none.forEach((l) => l.remove());
          pick.insertAdjacentHTML("beforeend", `<details class="cb-cvnone"><summary>当てられない ${names.length} 表（この表に元の列がありません）: ${names.map((n) => `<span class="cb-who">${CB.esc(n)}</span>`).join("・")}</summary></details>`);
        }
      }
    }
  };
  /* 押した物（どの案も同じ印。頁の中の再描画に負けないよう、文書の捕まえる段で受ける） */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-cvb-hist],[data-cvb-diff],[data-cvb-pt],[data-cvb-close],[data-cvb-bundled],[data-cvb-pre-import],[data-cvb-pre-bundled],[data-cvb-tab],[data-cvb-undo],[data-cvb-noop]");
    if (!t) return;
    const ds = t.dataset;
    if (ds.cvbHist != null) CB.view = CB.view === "hist" ? "edit" : "hist";
    if (ds.cvbDiff != null) CB.row = CB.row === (ds.cvbDiff || "管理分類") ? null : (ds.cvbDiff || "管理分類");
    if (ds.cvbPt) { CB.sel = ds.cvbPt; CB.row = null; }
    if (ds.cvbClose != null) { CB.view = "edit"; CB.open = null; CB.row = null; }
    if (ds.cvbTab) CB.tab = ds.cvbTab;
    if (ds.cvbPreImport != null) { CB.view = "dlg"; CB.tab = "io"; }
    if (ds.cvbPreBundled != null) { CB.view = "dlg"; CB.tab = "std"; }
    if (ds.cvbBundled != null) CB.open = "bundled";
    if (ds.cvbUndo != null) CB.band = null;
    CB.hook && CB.hook(ds, t);
    CB.dirty = true;
    if (!t.matches("[data-cv-import],[data-cv-export],[data-cv-save]")) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  /* 「同梱に戻す」は案ごとの頁の中の確かめへ（ブラウザの confirm を出さない） */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cv-stdbundled]"); if (!b || !CB.onBundled) return;
    e.preventDefault(); e.stopPropagation(); CB.onBundled(); CB.dirty = true;
  }, true);
  CB.css = `
    .cv-page > #cvNotice{position:sticky;top:0;z-index:6;box-shadow:0 2px 6px rgba(20,40,70,.08)}
    .cb-st{display:inline-block;padding:0 7px;border-radius:999px;font-size:11.5px;font-weight:800;line-height:19px;white-space:nowrap}
    .cb-st.is-chg{background:#fdf1dc;color:#7a4b00}.cb-st.is-same{background:#eef1f5;color:#4b5866}.cb-st.is-back{background:#e3f4ea;color:#1d6b3c}.cb-st.is-gone{background:#fde7e7;color:#9b1c1c}
    .cb-k,.cb-sc{display:inline-block;padding:0 6px;border-radius:5px;font-size:11px;font-weight:800;line-height:18px;white-space:nowrap}
    .cb-k.is-auto{background:#eef1f5;color:#4b5866}.cb-k.is-man{background:#e5eefb;color:#1f4f8a}.cb-k.is-pre{background:#f1eafb;color:#55308f}
    .cb-sc{border:1px solid #cdd6e0;color:#34485c;background:#fff}
    .cb-pt{display:grid;gap:2px;width:100%;text-align:left;padding:8px 10px;border:1px solid #dbe2ea;border-radius:8px;background:#fff;font:inherit;color:#1d2a38;cursor:pointer}
    .cb-pt + .cb-pt{margin-top:6px}.cb-pt.is-on{border-color:#2f6db3;box-shadow:inset 3px 0 0 #2f6db3;background:#f3f8ff}
    .cb-pt1{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.cb-pt1 b{font-size:13.5px}
    .cb-pt2{font-size:12.5px;color:#3e4f60}.cb-pt3{font-size:12px;color:#5a6775}
    .cb-dt,.cb-rt{width:100%;border-collapse:collapse;font-size:13px}
    .cb-dt th,.cb-rt th{text-align:left;font-size:12px;color:#4b5866;font-weight:700;padding:5px 8px;border-bottom:1px solid #dbe2ea;white-space:nowrap}
    .cb-dt td,.cb-rt td{padding:6px 8px;border-bottom:1px solid #eef1f5;vertical-align:middle}
    .cb-dt td:nth-child(n+3):nth-child(-n+4){white-space:nowrap;font-variant-numeric:tabular-nums}
    .cb-dt tr.is-same td{color:#4b5866}.cb-samerow td{font-size:12.5px;line-height:1.6}
    .cb-rowsx > td{background:#f7f9fb;padding:6px 10px 10px}
    .cb-rt{background:#fff;border:1px solid #e3e8ee;border-radius:6px}.cb-rt td:first-child{width:3em;color:#5a6775;font-variant-numeric:tabular-nums}
    .cb-rt tr.is-del td:nth-child(2){text-decoration:line-through;color:#7d2121}
    .cb-none{color:#6b7785;font-style:normal}
    .cb-lnk{border:0;background:none;color:#1f5fa8;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;padding:2px 4px}
    .cb-say{margin:4px 0;font-size:13px;line-height:1.6;color:#2c3a48}
    .cb-implist{margin:6px 0 2px;padding-left:1.2em;font-size:13px;line-height:1.7}
    .cb-btn{font:inherit;font-size:13px;font-weight:700;border:1px solid #b9c6d6;background:#fff;color:#1f3d63;border-radius:7px;padding:5px 12px;cursor:pointer;white-space:nowrap}
    .cb-btn.is-danger{border-color:#d59a9a;color:#a12626}
    .cb-who{white-space:nowrap}
    .cb-btn:disabled,.btn-primary:disabled{opacity:.45;cursor:not-allowed}
    .cb-btn.is-main{background:#2f5b8f;border-color:#2f5b8f;color:#fff}
    .cb-note{font-size:12px;color:#4b5866}
    .cb-cvlink{font-size:12.5px;font-weight:700;color:var(--h-input,#1f5fa8);white-space:nowrap}
    .lc-cvpick{max-height:none}
    .cb-cvnone{grid-column:1/-1;margin-top:2px;padding:4px 6px;border-radius:6px;background:#f5f7f9;color:#4b5f72;font-size:12px}
    .cb-cvnone summary{cursor:pointer;line-height:1.5}
  `;
}
const S = (fn) => `(${fn})()`;

/* ------------------------------------------------------------------ A: 「履歴とバックアップ」のタブ（置き場） */
function scriptA() {
  const CB = window.CB;
  if (CB.started) return; CB.started = true;   // 案は読み込みの前と後の 2 回当たるので、1 回だけ動かす
  CB.onBundled = () => { CB.open = "bundled"; };
  CB.keep(() => {
    CB.common();
    const page = CB.page(); if (!page || !CB.points) return;
    // 表の頭の「標準に戻す」は履歴の「標準（自分で決めた表）」へ移す（保存の隣に壊すボタンを置かない）
    page.querySelector("[data-cv-reset]")?.remove();
    let tabs = page.querySelector(".cba-tabs");
    if (!tabs) {
      page.querySelector(".sh-editor").insertAdjacentHTML("beforebegin", '<div class="cba-tabs" role="tablist"></div>');
      tabs = page.querySelector(".cba-tabs");
    }
    const key = `${CB.view}|${CB.sel}|${CB.row}|${CB.open}|${CB.name()}`;
    if (tabs.dataset.k === key && !CB.dirty) return;
    CB.dirty = false; tabs.dataset.k = key;
    tabs.innerHTML = `<button type="button" role="tab" class="cba-tab${CB.view !== "hist" ? " is-on" : ""}" data-cvb-close>表を直す</button>`
      + `<button type="button" role="tab" class="cba-tab${CB.view === "hist" ? " is-on" : ""}" data-cvb-hist>履歴とバックアップ <span class="cba-n">${CB.points.length}</span></button>`
      + `<span class="cba-sp"></span><span class="cb-note">開発者・メンテナンス者だけ。変換表を書くたびに、書く前の形を自動で残します（自動は 50 回分・手では消すまで）</span>`;
    page.classList.toggle("cba-hist", CB.view === "hist");
    page.querySelector(".cba-pane")?.remove();
    page.querySelector(".cba-conf")?.remove();
    if (CB.open === "bundled") {
      tabs.insertAdjacentHTML("afterend", `<div class="cba-conf" role="alertdialog"><b>標準を同梱のプリセットへ戻しますか？</b>${CB.bundledHtml()}
        <div class="cba-btns"><button type="button" class="cb-btn is-danger" data-cvb-close>標準を同梱に戻す</button><button type="button" class="cb-btn" data-cvb-close>やめる</button></div></div>`);
      page.querySelector(".cba-conf").scrollIntoView({ block: "nearest" });   // 押したリンクは一覧の下。確かめは頁の上なので見える所へ送る
    }
    if (CB.view !== "hist") return;
    const p = CB.point(CB.sel), ds = CB.diff(p), ch = ds.filter((d) => d.st !== "same");
    tabs.insertAdjacentHTML("afterend", `<div class="cba-pane">
      <aside class="cba-side"><div class="cba-h">戻せる時点（新しい順）</div>
        <div class="cba-mk"><button type="button" class="cb-btn" data-cvb-noop>＋ 全体をバックアップ</button><button type="button" class="cb-btn" data-cvb-noop>＋ 表を選んでバックアップ…</button></div>
        <div class="cba-list">${CB.pointsHtml(CB.sel)}</div></aside>
      <section class="cba-main"><div class="cba-title"><b>${p.preset ? "同梱のプリセット" : `${p.day} ${p.time}`}</b>${CB.kChip(p)}${CB.scChip(p)}<span class="cb-note">${CB.esc(p.preset ? p.who : `${p.why} · ${p.who}`)}</span></div>
        <p class="cba-sum">この時点に戻すと: <b>${ch.length} 表が変わります</b>（同じ ${ds.length - ch.length} 表）。この時点に入っているのは${CB.esc(CB.scopeText(p))}。</p>
        <div class="cba-btns"><button type="button" class="btn-primary" data-cvb-noop>選んだ ${ch.length} 表を戻す…</button>${p.scope === "all" ? `<button type="button" class="cb-btn" data-cvb-noop>全体（${p.tables.length} 表）をこの時点に戻す…</button>` : ""}
          <button type="button" class="cb-btn" data-cvb-noop>↓ この時点を書き出す</button><span class="cb-note">戻す前の今も自動で残すので、戻した後でも取り消せます</span></div>
        ${CB.diffHtml(p, { open: CB.row })}
      </section></div>`);
  });
}
const CSS_A = `
.cba-tabs{display:flex;align-items:center;gap:4px;margin:0 0 10px;border-bottom:1px solid #dbe2ea}
.cba-tab{font:inherit;font-size:14px;font-weight:800;color:#3e4f60;background:none;border:0;border-bottom:3px solid transparent;padding:7px 14px 6px;cursor:pointer;white-space:nowrap}
.cba-tab.is-on{color:#163a63;border-bottom-color:#2f6db3}
.cba-n{display:inline-block;min-width:20px;padding:0 6px;border-radius:999px;background:#e5eefb;color:#1f4f8a;font-size:11.5px;line-height:18px}
.cba-sp{flex:1}.cba-tabs .cb-note{padding-bottom:4px;text-align:right}
.cv-page.cba-hist > .sh-editor{display:none}
.cba-pane{display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);gap:16px;align-items:start}
.cba-side{display:flex;flex-direction:column;gap:8px;min-width:0}
.cba-h{font-size:12.5px;font-weight:800;color:#4b5866}
.cba-mk{display:flex;flex-wrap:wrap;gap:6px}
.cba-main{min-width:0;border:1px solid #dbe2ea;border-radius:10px;padding:12px 14px;background:#fff}
.cba-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cba-title b{font-size:16px}
.cba-sum{margin:8px 0;font-size:13.5px}
.cba-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 8px}
.cba-conf{margin:0 0 10px;padding:12px 14px;border:1px solid #e2b4b4;border-left:4px solid #c0392b;border-radius:9px;background:#fff8f7}
`;

/* ------------------------------------------------------------------ B: 確かめずに進め、取り消せる帯（流れの変え方） */
function scriptB() {
  const CB = window.CB;
  if (CB.started) return; CB.started = true;   // 案は読み込みの前と後の 2 回当たるので、1 回だけ動かす
  CB.onBundled = () => { CB.band = "bundled"; const b = document.querySelector(".cv-std b"); if (b) b.textContent = "同梱のプリセット"; document.querySelector("[data-cv-stdbundled]")?.remove(); };
  CB.hook = (ds) => { if (ds.cvbDiff != null && CB.view !== "hist") { CB.view = "hist"; CB.row = "管理分類"; } };
  CB.keep(() => {
    CB.common();
    const page = CB.page(); if (!page || !CB.points) return;
    // 保存の知らせは取り消しの帯にする
    const n = page.querySelector("#cvNotice.ok");
    if (n && n.dataset.cb && !n.querySelector("[data-cvb-undo]") && !CB.band) {
      n.insertAdjacentHTML("beforeend", ' <span class="cbb-acts"><button type="button" class="cb-btn" data-cvb-undo>元に戻す</button><button type="button" class="cb-btn" data-cvb-pt="p1" data-cvb-hist>違いを見る</button></span>');
    }
    const io = page.querySelector(".cv-io");
    if (io && !io.querySelector(".cbb-io")) {
      io.insertAdjacentHTML("afterbegin", `<div class="cbb-io"><button type="button" class="cb-btn cbb-hist" data-cvb-hist>⟲ 戻せる時点 <b>${CB.points.length}</b></button>
        <div class="cbb-bk"><span>バックアップ</span><button type="button" class="cb-btn" data-cvb-noop>全体</button><button type="button" class="cb-btn" data-cvb-noop>この表だけ</button></div></div>`);
    }
    const key = `${CB.view}|${CB.sel}|${CB.row}|${CB.band}`;
    if (page.dataset.cbk === key && !CB.dirty && (CB.view !== "hist" || page.querySelector(".cbb-drawer"))) return;
    CB.dirty = false; page.dataset.cbk = key;
    page.querySelector(".cbb-drawer")?.remove(); page.querySelector(".cbb-band")?.remove();
    if (CB.band === "bundled") {
      page.querySelector(".sh-editor").insertAdjacentHTML("beforebegin", `<div class="cbb-band" role="status"><span>✓ 標準を同梱のプリセットに戻しました。<b>表の中身は変わっていません</b>（変わったのは、表ごとの「標準に戻す」で戻る先だけ。${CB.bundledDiff().filter((d) => !d.same).map((d) => CB.esc(d.name)).join("・")} の戻る先が同梱の形に）。</span>
        <span class="cbb-acts"><button type="button" class="cb-btn is-main" data-cvb-undo>元に戻す</button><button type="button" class="cb-btn" data-cvb-hist>履歴を見る</button></span></div>`);
    }
    if (CB.view !== "hist") return;
    const p = CB.point(CB.sel), ds = CB.diff(p), ch = ds.filter((d) => d.st !== "same");
    page.querySelector(".sh-editor").insertAdjacentHTML("beforeend", `<div class="cbb-drawer" role="dialog" aria-label="戻せる時点"><div class="cbb-dh"><b>戻せる時点</b><span class="cb-note">書くたびに自動で残します（20 回分）</span><button type="button" class="cb-btn" data-cvb-close>閉じる</button></div>
      <div class="cbb-dl">${CB.pointsHtml(CB.sel, { bundled: false })}</div>
      <div class="cbb-dd"><div class="cbb-dt"><b>${p.day} ${p.time}</b> ${CB.kChip(p)}${CB.scChip(p)} <span class="cb-note">${CB.esc(p.why)}</span></div>
        <div class="cba-btns"><span class="cb-say">戻すと <b>${ch.length} 表が変わります</b>。戻した後も、帯の「元に戻す」で今に戻れます。</span><button type="button" class="btn-primary" data-cvb-noop>この時点に戻す</button></div>
        ${CB.diffHtml(p, { check: false, open: CB.row })}</div></div>`);
  });
}
const CSS_B = `
.cv-page .sh-editor{position:relative}
.cbb-acts{display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle}
.cbb-io{display:grid;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed #d4dbe3}
.cbb-hist{justify-self:stretch;text-align:left}
.cbb-bk{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#3e4f60}.cbb-bk span{margin-right:auto;font-weight:700}
.cbb-band{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 10px;padding:9px 12px;border-radius:9px;background:#eaf5ee;border:1px solid #bfe0cb;font-size:13.5px;color:#1f3d2c;position:sticky;top:0;z-index:6}
.cbb-band > span:first-child{flex:1 1 420px;min-width:0}
.cbb-drawer{position:absolute;top:0;right:0;bottom:0;width:min(560px,62%);display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:8px;padding:12px;background:#fff;border-left:1px solid #cfd8e2;box-shadow:-8px 0 24px rgba(20,40,70,.14);z-index:7;overflow:auto}
.cbb-dh{display:flex;align-items:center;gap:8px}.cbb-dh .cb-note{flex:1}
.cbb-dl{display:grid;grid-template-columns:1fr 1fr;gap:6px}.cbb-dl .cb-pt + .cb-pt{margin-top:0}
.cbb-dd{border-top:1px solid #e3e8ee;padding-top:8px;min-width:0}
.cbb-dd .cba-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 8px}.cbb-dd .cba-btns .cb-say{flex:1 1 240px;margin:0}
`;

/* ------------------------------------------------------------------ C: 壊す操作を 1 つの窓に畳む（減らし方） */
function scriptC() {
  const CB = window.CB;
  if (CB.started) return; CB.started = true;   // 案は読み込みの前と後の 2 回当たるので、1 回だけ動かす
  CB.tab = "back";
  CB.onBundled = () => { CB.open = "bundled"; };
  CB.keep(() => {
    CB.common();
    const page = CB.page(); if (!page || !CB.points) return;
    if (page.querySelector(".cv-imp")) { if (CB.view === "dlg") { CB.view = "edit"; CB.dirty = true; } }
    // 表の頭: 保存のほかは「⋯」へ
    const top = page.querySelector(".cv-top");
    if (top && !top.querySelector(".cbc-more")) {
      top.querySelector("[data-cv-reset]")?.setAttribute("hidden", "");
      top.querySelector("[data-cv-delete]")?.setAttribute("hidden", "");
      top.querySelector("[data-cv-save]")?.insertAdjacentHTML("beforebegin", '<button type="button" class="cb-btn cbc-more" data-cvb-noop title="標準に戻す・この表を消す・この表だけ書き出す" aria-haspopup="menu">⋯</button>');
    }
    const io = page.querySelector(".cv-io");
    if (io && !io.dataset.cb) {
      io.dataset.cb = "1";
      const stdName = (io.querySelector(".cv-std b") || {}).textContent || "";
      [...io.children].forEach((c) => c.remove());   // 隠すだけだと、同じ印のボタンが 2 つになる（書き出す・取り込むは窓の中へ）
      io.insertAdjacentHTML("afterbegin", `<button type="button" class="cb-btn cbc-open" data-cvb-hist>🛡 バックアップと戻す…</button>
        <span class="cb-note">最後のバックアップ: ${CB.points[2].day} ${CB.points[2].time}（全体）</span>
        <span class="cb-note cbc-std">標準: ${CB.esc(stdName)}</span>
        <button type="button" hidden data-cvb-pre-import></button><button type="button" hidden data-cvb-pre-bundled></button>`);
    }
    if (CB.view === "hist") { CB.view = "dlg"; CB.tab = "back"; }
    const key = `${CB.view}|${CB.tab}|${CB.sel}|${CB.row}|${CB.open}`;
    if (page.dataset.cbk === key && !CB.dirty && (CB.view !== "dlg" || page.querySelector(".cbc-dlg"))) return;
    CB.dirty = false; page.dataset.cbk = key;
    page.querySelector(".cbc-dlg")?.remove();
    if (CB.view !== "dlg") return;
    const tabs = [["back", "戻す"], ["make", "バックアップを取る"], ["io", "書き出す・取り込む"], ["std", "標準（同梱）"]];
    let body = "";
    if (CB.tab === "back") {
      const p = CB.point(CB.sel), ch = CB.diff(p).filter((d) => d.st !== "same");
      body = `<div class="cbc-two"><div class="cbc-list">${CB.pointsHtml(CB.sel)}</div><div class="cbc-det"><div class="cba-title"><b>${p.preset ? "同梱のプリセット" : `${p.day} ${p.time}`}</b>${CB.kChip(p)}${CB.scChip(p)}</div>
        <p class="cb-say">${CB.esc(p.why)} · ${CB.esc(p.who)}。戻すと <b>${ch.length} 表が変わります</b>。</p>${CB.diffHtml(p, { open: CB.row })}
        <label class="cbc-ok"><input type="checkbox"> 上の違いを見て、戻してよいと確かめた</label>
        <div class="cba-btns"><button type="button" class="btn-primary" disabled>選んだ表を戻す</button><span class="cb-note">戻す前の今は自動で残します</span></div></div></div>`;
    } else if (CB.tab === "io") {
      body = `<p class="cb-say">ファイルに書き出す（別の PC・別の置き場へ運ぶとき）。取り込むときは、取り込む前に表ごとの違いを見せます。</p>
        <div class="cba-btns"><button type="button" class="pv-btn" data-cv-export>↓ 全部を書き出す</button><button type="button" class="pv-btn" data-cvb-noop>↓ この表だけ書き出す</button><button type="button" class="pv-btn" data-cv-import>↑ 取り込む…</button></div>`;
    } else if (CB.tab === "std") {
      body = CB.open === "bundled" ? `<div class="cba-conf"><b>標準を同梱のプリセットへ戻しますか？</b>${CB.bundledHtml()}<label class="cbc-ok"><input type="checkbox"> 表の中身は変わらず、戻る先だけが変わることを確かめた</label>
          <div class="cba-btns"><button type="button" class="cb-btn is-danger" disabled>標準を同梱に戻す</button><button type="button" class="cb-btn" data-cvb-close>やめる</button></div></div>`
        : `<p class="cb-say">標準は、表ごとの「標準に戻す」で戻る先です。今の標準: <b>${CB.esc(((page.querySelector(".cbc-std") || {}).textContent || "").replace(/^標準: /, ""))}</b></p>
        <div class="cba-btns"><button type="button" class="cb-btn" data-cvb-noop>今の表を標準にする…</button><button type="button" class="cb-btn is-danger" data-cvb-bundled>標準を同梱に戻す…</button></div>`;
    } else {
      body = `<p class="cb-say">今の形を名前を付けて残します。全体（${CB.nTables()} 表）か、選んだ表だけ。</p><div class="cbc-pick">${(CB.items || []).map((x) => `<label><input type="checkbox"${x.name === "管理分類" ? " checked" : ""}> ${CB.esc(x.name)}（${x.rows.length} 行）</label>`).join("")}</div>
        <div class="cba-btns"><button type="button" class="btn-primary" data-cvb-noop>全体をバックアップ</button><button type="button" class="cb-btn" data-cvb-noop>選んだ 1 表をバックアップ</button></div>`;
    }
    page.insertAdjacentHTML("beforeend", `<div class="cbc-dlg" role="dialog" aria-label="バックアップと戻す"><div class="cbc-card"><div class="cbc-head"><b>変換表のバックアップと戻す</b><span class="cb-note">開発者・メンテナンス者だけ</span><button type="button" class="cb-btn" data-cvb-close>閉じる</button></div>
      <div class="cbc-tabs">${tabs.map(([k, n]) => `<button type="button" class="cbc-tab${CB.tab === k ? " is-on" : ""}" data-cvb-tab="${k}">${n}</button>`).join("")}</div><div class="cbc-body">${body}</div></div></div>`);
  });
}
const CSS_C = `
.cv-io{display:grid;gap:6px}
.cbc-open{justify-self:stretch}
.cbc-dlg{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(15,30,50,.32)}
.cbc-card{width:min(1100px,94vw);max-height:88vh;display:grid;grid-template-rows:auto auto minmax(0,1fr);background:#fff;border-radius:12px;box-shadow:0 18px 48px rgba(10,25,45,.3);overflow:hidden}
.cbc-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e3e8ee}.cbc-head b{font-size:16px}.cbc-head .cb-note{flex:1}
.cbc-tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid #e3e8ee}
.cbc-tab{font:inherit;font-size:13.5px;font-weight:800;color:#3e4f60;background:none;border:0;border-bottom:3px solid transparent;padding:8px 12px;cursor:pointer;white-space:nowrap}
.cbc-tab.is-on{color:#163a63;border-bottom-color:#2f6db3}
.cbc-body{overflow:auto;padding:12px 16px 16px}
.cbc-two{display:grid;grid-template-columns:minmax(240px,300px) minmax(0,1fr);gap:14px;align-items:start}
.cbc-ok{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:13px}
.cbc-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 12px;font-size:13px}
.cba-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cba-title b{font-size:16px}
.cba-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
.cba-conf{padding:12px 14px;border:1px solid #e2b4b4;border-left:4px solid #c0392b;border-radius:9px;background:#fff8f7}
`;

/* ------------------------------------------------------------------ D: 表ごとの版と状態を見せる（見せ方） */
function scriptD() {
  const CB = window.CB;
  if (CB.started) return; CB.started = true;   // 案は読み込みの前と後の 2 回当たるので、1 回だけ動かす
  CB.onBundled = () => { CB.open = "bundled"; };
  const STATE = { "管理分類": ["直した", "11/26 10:42"], "課名": ["直した", "11/20 13:05"], "地取区分": ["直した", "11/12 08:50"] };
  CB.keep(() => {
    CB.common();
    const page = CB.page(); if (!page || !CB.points) return;
    page.querySelectorAll("[data-cv-pick]").forEach((b) => {
      if (b.querySelector(".cbd-st")) return;
      const nm = b.querySelector("b").textContent, s = STATE[nm];
      b.insertAdjacentHTML("beforeend", s ? `<span class="cbd-st is-mine">直した · ${s[1]}</span>` : '<span class="cbd-st">同梱のまま</span>');
    });
    const head = page.querySelector(".sh-list-head");
    if (head && !head.querySelector(".cbd-all")) head.insertAdjacentHTML("beforeend", '<button type="button" class="cb-lnk cbd-all" data-cvb-noop title="全部の表をいまの形で残す・全体のバックアップから戻す">全体のバックアップ…</button>');
    const save = page.querySelector("[data-cv-save]");
    if (save && save.textContent === "保存") save.textContent = "この表を保存";
    page.querySelector("[data-cv-reset]")?.setAttribute("hidden", "");
    const top = page.querySelector(".cv-top");
    const key = `${CB.view}|${CB.row}|${CB.open}|${CB.name()}`;
    if (top && top.dataset.cbk === key && !CB.dirty && page.querySelector(".cbd-strip")) return;
    CB.dirty = false; if (top) top.dataset.cbk = key;
    page.querySelector(".cbd-strip")?.remove(); page.querySelector(".cbd-hist")?.remove(); page.querySelector(".cbd-conf")?.remove();
    const nm = CB.name(), mine = (CB.points || []).filter((p) => p.scope === "all" || p.scope.includes(nm));
    if (top) top.insertAdjacentHTML("afterend", `<div class="cbd-strip"><span class="cbd-ver">版 7</span><span class="cbd-last">最後の保存 <b>11/26 10:42</b> <span class="cb-who">山田（PC-03）</span></span><span class="cbd-sep"></span>
      <button type="button" class="cb-btn" data-cvb-hist aria-expanded="${CB.view === "hist"}">履歴 ${mine.length} ${CB.view === "hist" ? "▴" : "▾"}</button>
      <button type="button" class="cb-btn" data-cvb-noop title="この表だけを、今の形で残します">バックアップ</button><button type="button" class="cb-btn" data-cvb-noop title="同梱のプリセットとの違いを見てから、戻すかを決めます">同梱と比べる…</button></div>`);
    if (CB.view === "hist" && top) {
      const rows = mine.map((p) => { const d = CB.diff(p, [nm])[0]; return { p, d }; });
      page.querySelector(".cbd-strip").insertAdjacentHTML("afterend", `<div class="cbd-hist"><div class="cbd-hh"><b>「${CB.esc(nm)}」の履歴（新しい順）</b><span class="cb-note">どの版に戻しても、戻す前の今を残します</span><button type="button" class="cb-btn" data-cvb-close>閉じる</button></div>
        <table class="cb-dt cbd-t"><thead><tr><th>いつ</th><th>何をした前か</th><th>この版に戻すと</th><th></th></tr></thead><tbody>${rows.map(({ p, d }, i) =>
        `<tr><td class="cbd-when"><b>${p.day} ${p.time}</b><br>${CB.kChip(p)}${CB.scChip(p)}</td><td>${CB.esc(p.why)} · ${CB.who(p)}</td><td><span class="cbd-n">${d.now} → ${d.then} 行</span> ${CB.stChip(d.st)} ${CB.esc(CB.what(d))}</td>`
        + `<td class="cbd-act"><button type="button" class="cb-lnk"${i === 2 ? ' data-cvb-diff="管理分類"' : " data-cvb-noop"}>${CB.row && i === 2 ? "閉じる ▴" : "比べる ▾"}</button><button type="button" class="cb-btn" data-cvb-noop>戻す</button></td></tr>`
        + (CB.row && i === 2 ? `<tr class="cb-rowsx"><td colspan="4">${CB.rowsHtml(d)}</td></tr>` : "")).join("")}</tbody></table>
        <p class="cb-note">全部の表をまとめて戻すときは、一覧の上の「全体のバックアップ…」から。</p></div>`);
    }
    if (CB.open === "bundled") {
      const io = page.querySelector(".cv-io");
      io && io.insertAdjacentHTML("afterend", `<div class="cbd-conf cba-conf"><b>標準を同梱に戻しますか？</b>${CB.bundledHtml()}<div class="cba-btns"><button type="button" class="cb-btn is-danger" data-cvb-close>同梱に戻す</button><button type="button" class="cb-btn" data-cvb-close>やめる</button></div></div>`);
    }
  });
}
const CSS_D = `
.cbd-st{display:block;margin-top:3px;font-size:11.5px;font-weight:800;color:#5a6775}
.cbd-st.is-mine{color:#8a4d00}
.sh-list-head{display:flex;align-items:center;gap:6px}.cbd-all{margin-left:auto}
.cbd-strip{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:-2px 0 10px;padding:6px 10px;border-radius:8px;background:#f3f6f9;font-size:13px;color:#2c3a48}
.cbd-ver{padding:0 7px;border-radius:5px;background:#163a63;color:#fff;font-size:11.5px;font-weight:800;line-height:19px}
.cbd-sep{flex:1}
.cbd-hist{margin:0 0 12px;padding:8px 10px;border:1px solid #dbe2ea;border-radius:9px;background:#fff}
.cbd-hh{display:flex;align-items:center;gap:8px;margin-bottom:4px}.cbd-hh .cb-note{flex:1}
.cbd-when{white-space:nowrap}.cbd-n{white-space:nowrap;font-variant-numeric:tabular-nums;margin-right:4px}
.cbd-act{white-space:nowrap;text-align:right}
.cbd-t{table-layout:fixed}.cbd-t th:nth-child(1){width:150px}.cbd-t th:nth-child(2){width:26%}.cbd-t th:nth-child(4){width:118px}
.cbd-t td{overflow-wrap:anywhere}.cbd-t.cb-dt td:nth-child(3):nth-child(n){white-space:normal}   /* 共通の表の「数の列は折らない」を、この表の 3 列目（変わる所）では外す */
.cbd-last{white-space:nowrap}
.cba-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
.cba-conf{margin-top:8px;padding:10px 12px;border:1px solid #e2b4b4;border-left:4px solid #c0392b;border-radius:9px;background:#fff8f7}
.cbd-conf .cb-say{font-size:12.5px}
`;

/* ------------------------------------------------------------------ E: 戻す手順の窓（① いつ → ② どの表 → ③ 確かめて戻す。流れの変え方） */
function scriptE() {
  const CB = window.CB;
  if (CB.started) return; CB.started = true;   // 案は読み込みの前と後の 2 回当たるので、1 回だけ動かす
  CB.step = 1;
  CB.onBundled = () => { CB.view = "wiz"; CB.step = 3; CB.src = "bundled"; };
  CB.hook = (ds) => {
    if (ds.cvbHist != null) { CB.view = "wiz"; CB.step = 1; CB.src = null; }
    if (ds.cvbDiff != null && CB.view === "wiz" && CB.step < 3) { CB.step = 3; CB.row = "管理分類"; }
    if (ds.cvbClose != null) { CB.view = "edit"; CB.src = null; }
  };
  CB.keep(() => {
    CB.common();
    const page = CB.page(); if (!page || !CB.points) return;
    const io = page.querySelector(".cv-io");
    if (io && !io.querySelector(".cbe-io")) {
      io.insertAdjacentHTML("afterbegin", '<div class="cbe-io"><button type="button" class="cb-btn" data-cvb-noop>⤓ バックアップ…</button><button type="button" class="cb-btn" data-cvb-hist>⟲ 戻す…</button></div>');
    }
    const rs = page.querySelector("[data-cv-reset]");
    if (rs && !rs.dataset.cb) { rs.dataset.cb = "1"; rs.textContent = "標準に戻す…"; rs.title = "戻す手順の窓で、標準と比べてから戻します"; }
    const key = `${CB.view}|${CB.step}|${CB.sel}|${CB.row}|${CB.src}`;
    if (page.dataset.cbk === key && !CB.dirty && (CB.view !== "wiz" || page.querySelector(".cbe-dlg"))) return;
    CB.dirty = false; page.dataset.cbk = key;
    page.querySelector(".cbe-dlg")?.remove();
    if (CB.view !== "wiz") return;
    const steps = ["いつの形に", "どの表を", "確かめて戻す"];
    const stepper = `<ol class="cbe-steps">${steps.map((s, i) => `<li class="${i + 1 === CB.step ? "is-on" : i + 1 < CB.step ? "is-done" : ""}"><span>${i + 1 < CB.step ? "✓" : i + 1}</span>${s}</li>`).join("")}</ol>`;
    let body;
    if (CB.src === "bundled") {
      body = `<h3 class="cbe-h">標準を同梱のプリセットへ戻す</h3>${CB.bundledHtml()}<table class="cb-dt"><thead><tr><th>表</th><th>今の表</th><th>戻る先（今の標準）</th><th>戻る先（同梱）</th></tr></thead><tbody>${CB.bundledDiff().map((d) =>
        `<tr class="${d.same ? "is-same" : ""}"><td><b>${CB.esc(d.name)}</b></td><td>${d.now} 行</td><td>${d.now} 行</td><td>${d.then} 行 ${d.same ? CB.stChip("same") : CB.stChip("chg")}</td></tr>`).join("")}</tbody></table>
        <div class="cbe-foot"><span class="cb-note">今の標準は履歴に残します</span><button type="button" class="cb-btn" data-cvb-close>やめる</button><button type="button" class="cb-btn is-danger" data-cvb-close>標準を同梱に戻す</button></div>`;
    } else if (CB.step === 1) {
      body = `<div class="cbe-pts">${CB.pointsHtml(CB.sel)}</div><div class="cbe-foot"><span class="cb-note">自動の時点は、変換表を書くたびに残ります（30 日分）。手で取ったバックアップは消すまで残ります</span><button type="button" class="cb-btn" data-cvb-close>やめる</button><button type="button" class="btn-primary" data-cvb-diff>次へ ›</button></div>`;
    } else {
      const p = CB.point(CB.sel), ds = CB.diff(p), ch = ds.filter((d) => d.st !== "same");
      body = `<div class="cbe-pick"><b>${p.day} ${p.time}</b> ${CB.kChip(p)}${CB.scChip(p)} <span class="cb-note">${CB.esc(p.why)} · ${CB.esc(p.who)}</span><button type="button" class="cb-lnk" data-cvb-hist>変える</button></div>
        <p class="cb-say">② 戻す表: 今と違う <b>${ch.length} 表</b>を選んでいます（同じ ${ds.length - ch.length} 表は変わらないので外しています）。③ 戻すと次のとおり変わります。</p>
        ${CB.diffHtml(p, { open: CB.row })}
        <div class="cbe-foot"><span class="cb-note">戻す前の今（${CB.nTables()} 表）を自動で残すので、戻した後でもこの窓で今に戻せます</span><button type="button" class="cb-btn" data-cvb-hist>‹ 前へ</button><button type="button" class="btn-primary" data-cvb-close>${ch.length} 表をこの時点に戻す</button></div>`;
    }
    page.insertAdjacentHTML("beforeend", `<div class="cbe-dlg" role="dialog" aria-label="変換表を戻す"><div class="cbe-card"><div class="cbe-head"><b>変換表を戻す</b><span class="cb-note">開発者・メンテナンス者だけ</span><button type="button" class="cb-btn" data-cvb-close>閉じる</button></div>
      ${CB.src === "bundled" ? "" : stepper}<div class="cbe-body">${body}</div></div></div>`);
  });
}
const CSS_E = `
.cbe-io{display:flex;gap:6px;margin-bottom:6px}.cbe-io .cb-btn{flex:1}
.cbe-dlg{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(15,30,50,.32)}
.cbe-card{width:min(980px,94vw);max-height:88vh;display:grid;grid-template-rows:auto auto minmax(0,1fr);background:#fff;border-radius:12px;box-shadow:0 18px 48px rgba(10,25,45,.3);overflow:hidden}
.cbe-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e3e8ee}.cbe-head b{font-size:16px}.cbe-head .cb-note{flex:1}
.cbe-steps{display:flex;gap:0;margin:0;padding:10px 16px;list-style:none;border-bottom:1px solid #eef1f5}
.cbe-steps li{flex:1;display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:#5a6775}
.cbe-steps li span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;border:2px solid #c3ccd6;font-size:12px}
.cbe-steps li.is-on{color:#163a63}.cbe-steps li.is-on span{border-color:#2f6db3;background:#2f6db3;color:#fff}
.cbe-steps li.is-done span{border-color:#2e8b57;color:#2e8b57}
.cbe-body{overflow:auto;padding:12px 16px 14px;display:grid;gap:8px;align-content:start}
.cbe-pts{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}.cbe-pts .cb-pt + .cb-pt{margin-top:0}
.cbe-foot{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:6px}.cbe-foot .cb-note{flex:1 1 300px}
.cbe-pick{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 10px;border-radius:8px;background:#f3f6f9}
.cbe-h{margin:0;font-size:15px}
`;

const LIB = S(lib);
export const PROPOSALS = [
  { key: "now", name: "今（版 3.124.0）", css: "", ops: [] },
  { key: "A", name: "「履歴とバックアップ」のタブ（時点を選ぶと、表ごとに戻すと何が変わるかを並べ、選んだ表か全体を戻す）", css: "", ops: [["script", LIB], ["script", `document.head.append(Object.assign(document.createElement("style"),{textContent:window.CB.css+${JSON.stringify(CSS_A)}}))`], ["script", S(scriptA)]] },
  { key: "B", name: "確かめずに進め、取り消せる帯（壊す操作の後に「元に戻す」と違いを見る。時点は右から出る面）", css: "", ops: [["script", LIB], ["script", `document.head.append(Object.assign(document.createElement("style"),{textContent:window.CB.css+${JSON.stringify(CSS_B)}}))`], ["script", S(scriptB)]] },
  { key: "C", name: "壊す操作を 1 つの窓に畳む（一覧の下は「バックアップと戻す…」だけ。戻す・同梱は違いを見て確かめてから）", css: "", ops: [["script", LIB], ["script", `document.head.append(Object.assign(document.createElement("style"),{textContent:window.CB.css+${JSON.stringify(CSS_C)}}))`], ["script", S(scriptC)]] },
  { key: "D", name: "表ごとの版と状態を見せる（一覧に「直した・同梱のまま」、表の頭に版と最後の保存、この表の履歴）", css: "", ops: [["script", LIB], ["script", `document.head.append(Object.assign(document.createElement("style"),{textContent:window.CB.css+${JSON.stringify(CSS_D)}}))`], ["script", S(scriptD)]] },
  { key: "E", name: "戻す手順の窓（① いつの形に → ② どの表を → ③ 確かめて戻す）", css: "", ops: [["script", LIB], ["script", `document.head.append(Object.assign(document.createElement("style"),{textContent:window.CB.css+${JSON.stringify(CSS_E)}}))`], ["script", S(scriptE)]] },
];
