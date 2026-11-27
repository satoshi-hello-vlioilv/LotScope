// 評価関数（開発用）: 変換表の履歴と戻す（版 3.125.0。利用者の改良依頼 2026-11-17 の 5。決め方: ui-proposals/2026-11-convbackup の案 F）。
//   node program/tools/ui-eval-convbackup.mjs
// ① 表を保存すると、書く前の形が時点として残る（自動・その表の scope）。変えずにもう一度保存しても、時点は増えない（版 3.127.0 から 1 つも増えない）
// ② 戻すと何が変わるか: 窓の答え（GET /history/<id>）の行の数・消える／戻る／変わる行が、保存の前後の表を node で並びの位置で比べた
//    独立の答えと同じ。窓（画面）の表の「今・戻すと」の行の数と行の差の行の数も同じ
// ③ この表だけ戻す（表の頭の「履歴 ▾」→ 時点 → 「「管理分類」をこの時点に戻す」）: その表は時点の形・ほかの表は変わらない
// ④ 戻したことを取り消せる（「元に戻す」）: 戻す前の形に戻る
// ⑤ 全体を戻す（窓の「全体（n 表と標準）をこの時点に戻す」）: 全部の表が時点の形・後で足した表は消える。
//    版 3.127.0: 全体の窓でも表を選んで「＋ この表だけ」のバックアップ（選んだ表だけの手の時点）
// ⑥ 標準を同梱のプリセットにする前の確かめ: 表ごとに 今の表・今の標準・決めた後 の行の数が出る。押すと標準が同梱・表の中身は変わらない
// ⑦ 取り込む前の確かめに表ごとの行の数（5 行 → 2 行（3 行が消える））
// ⑧ 1728・1536×864・1280×720 で: 窓が画面に収まる・同梱のプリセットの札が送らずに見える・表の頭が 1 段（保存した印が出た形）・
//    ボタンと札の字が折れない・時点の札の名前が切れない・一覧の頭の下の状態とボタンが送らずに見える
// ⑨ 権限: マスタ編集「部分的編集可」の人には 履歴と戻す・履歴 ▾ が無く、戻す・バックアップ・標準の道は 403。表の保存はできる（前のまま）
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const errors = [];
const J = (m, b) => ({ method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

/** 独立の答え: 並びの位置で行を比べる（今 → 時点） */
function rowDiff(now, then) {
  const out = { del: 0, add: 0, chg: 0, rows: [] };
  for (let i = 0; i < Math.max(now.length, then.length); i++) {
    const a = now[i], b = then[i];
    if (a && !b) { out.del++; out.rows.push({ i, kind: "del" }); } else if (!a && b) { out.add++; out.rows.push({ i, kind: "add" }); }
    else if (JSON.stringify({ when: a.when, out: a.out }) !== JSON.stringify({ when: b.when, out: b.out })) { out.chg++; out.rows.push({ i, kind: "chg" }); }
  }
  return out;
}
const strip = (x) => ({ name: x.name, inputs: x.inputs, rows: x.rows, other: x.other, apply: x.apply });

const app = await launch();
try {
  const p = await app.newPage("light", parseView("1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  const api = (path, init) => p.evaluate(async ({ path, init }) => { const r = await fetch(path, init); return { status: r.status, body: await r.json().catch(() => null) }; }, { path, init });
  const items = async () => (await api("/api/masters/conversions")).body.items;
  const openConv = async () => {
    if (!(await p.$("#masterOverlay:not(.hidden)"))) { await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); }
    await p.waitForSelector('#masterTabs [data-tab="conv"]');
    await p.evaluate(() => [...document.querySelectorAll("#masterTabs .tab")].find((b) => b.dataset.tab !== "conv")?.click()); await sleep(400);
    await p.$eval('#masterTabs [data-tab="conv"]', (b) => b.click()); await p.waitForSelector("[data-cv-save]"); await sleep(800);
  };
  const pick = async (name) => { await p.evaluate((n) => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === n)?.click(), name); await sleep(700); };

  // ① 保存すると時点が増える
  const before = await items();
  const h0 = (await api("/api/masters/conversions/history")).body;
  await openConv(); await pick("管理分類");
  // 2 行を消し、3 行目の出す値を変えて保存（画面で）
  await p.click('[data-cv-rdel="34"]'); await p.click('[data-cv-rdel="33"]'); await sleep(200);
  await p.fill('[data-cv-out="2"]', "8-10mm（試し）"); await p.press('[data-cv-out="2"]', "Tab");
  await p.click("[data-cv-save]"); await p.waitForSelector("#cvNotice.ok"); await sleep(800);
  const note = await p.$eval("#cvNotice", (x) => x.textContent);
  check("① 保存の知らせが範囲を言う（この 1 表・ほかの表は変えていない・履歴に残した）", /「管理分類」だけ/.test(note) && /この 1 表/.test(note) && /ほかの \d+ 表は変えていません/.test(note) && /履歴に残しました/.test(note), note);
  const h1 = (await api("/api/masters/conversions/history")).body;
  const auto = h1.points[0];
  check("① 保存すると時点が 1 つ増える（自動・「管理分類」を保存する前・scope は管理分類）", h1.points.length === h0.points.length + 1 && auto.auto && /「管理分類」を保存する前/.test(auto.why) && JSON.stringify(auto.scope) === '["管理分類"]', { n0: h0.points.length, n1: h1.points.length, auto });
  await p.click("[data-cv-save]"); await sleep(1200);
  const h1b = (await api("/api/masters/conversions/history")).body;
  // 版 3.127.0: 中身の変わらない保存では時点を増やさない（前は「今と同じ」時点が 1 つ増え、並びの頭を占めた。決まりは窓の conv_history::changes_content）
  check("① 変えずにもう一度保存しても、時点は増えない（並びの頭はさっきの「保存する前」のまま）", h1b.points.length === h1.points.length && h1b.points[0].id === auto.id, { n1: h1.points.length, n1b: h1b.points.length, top: h1b.points[0] });
  // 開いて閉じただけ（直していない）の保存も 2 回目以降と同じ: もう 1 回押しても増えない・知らせは保存した
  await p.click("[data-cv-save]"); await sleep(1200);
  const h1c = (await api("/api/masters/conversions/history")).body;
  check("① 3 回目の変えない保存でも時点は増えない", h1c.points.length === h1.points.length, { n1: h1.points.length, n1c: h1c.points.length });
  const mid = await items();

  // ② 差: 窓の答え ＝ 独立の答え ＝ 画面
  const det = (await api(`/api/masters/conversions/history/${auto.id}`)).body;
  const tk = det.tables.find((t) => t.name === "管理分類"), ind = rowDiff(mid.find((x) => x.name === "管理分類").rows, before.find((x) => x.name === "管理分類").rows);
  check("② 窓の答えの行の差 ＝ 独立に数えた答え（消える 0・戻る 2・変わる 1）", tk && tk.del === ind.del && tk.add === ind.add && tk.chg === ind.chg && tk.rows.length === ind.rows.length
    && tk.rows.every((r, i) => r.i === ind.rows[i].i && r.kind === ind.rows[i].kind) && ind.add === 2 && ind.chg === 1, { tk, ind });
  check("② ほかの表は「同じ」", det.tables.filter((t) => t.name !== "管理分類").every((t) => t.st === "same"), det.tables.map((t) => [t.name, t.st]));
  await p.click("[data-cvb-th]"); await p.waitForSelector(".cvh-dlg .cvh-pt"); await sleep(800);
  await p.click(`.cvh-dlg [data-cvh-pt="${auto.id}"]`); await sleep(900);
  const ui = await p.evaluate(() => {
    const tr = [...document.querySelectorAll(".cvh-dt tbody tr")].find((r) => r.querySelector("b")?.textContent === "管理分類");
    const td = tr ? [...tr.children].map((c) => c.textContent.trim()) : [];
    return { td, rows: document.querySelectorAll(".cvh-rt tbody tr").length, go: document.querySelector("[data-cvh-go]")?.textContent, pins: [...document.querySelectorAll(".cvh-pins .cvh-pt b")].map((b) => b.textContent) };
  });
  check("② 画面の表: 今 33 行 → 戻すと 35 行・行の差 3 行（窓の答えと同じ）", ui.td.includes(`${tk.now} 行`) && ui.td.includes(`${tk.then} 行`) && ui.rows === tk.rows.length, { ui, tk: [tk.now, tk.then, tk.rows.length] });
  check("② 表の頭の「履歴 ▾」で開くと、その表だけを戻すボタン・同梱のプリセットが頭に", /「管理分類」をこの時点に戻す/.test(ui.go || "") && ui.pins.includes("同梱のプリセット"), ui);

  // ③ この表だけ戻す
  await p.click("[data-cvh-go]"); await p.waitForSelector(".cvh-msg.ok", { timeout: 8000 }); await sleep(900);
  const after3 = await items();
  const k3 = after3.find((x) => x.name === "管理分類"), kb = before.find((x) => x.name === "管理分類");
  check("③ 「管理分類」は時点の形（保存する前）に戻る", JSON.stringify(strip(k3)) === JSON.stringify(strip(kb)), { now: k3.rows.length, want: kb.rows.length });
  check("③ ほかの表は変わらない", after3.filter((x) => x.name !== "管理分類").every((x) => JSON.stringify(strip(x)) === JSON.stringify(strip(mid.find((y) => y.name === x.name)))), after3.length);
  const msg = await p.$eval(".cvh-msg", (x) => x.textContent);
  check("③ 戻した知らせと「元に戻す」", /戻しました/.test(msg) && !!(await p.$("[data-cvh-undo]")), msg);
  // ④ 取り消す
  await p.click("[data-cvh-undo]"); await sleep(1500);
  const after4 = await items();
  check("④ 「元に戻す」で、戻す前の形（33 行・変えた出す値）に戻る", JSON.stringify(strip(after4.find((x) => x.name === "管理分類"))) === JSON.stringify(strip(mid.find((x) => x.name === "管理分類"))), after4.find((x) => x.name === "管理分類").rows.length);

  // ⑤ 全体を戻す（手で取った全体のバックアップ → 表を足す → 全体を戻す）
  await p.click('.cvh-dlg [data-cvh-all]').catch(() => {}); await sleep(800);
  await p.click('.cvh-dlg [data-cvh-mk="all"]'); await sleep(1500);
  const hb = (await api("/api/masters/conversions/history")).body, man = hb.points.find((x) => !x.auto);
  check("⑤ 「＋ 全体をバックアップ」で手の時点（全体）が残る", man && man.scope === "all" && man.tables === after4.length, man);
  // 版 3.127.0: 全体の窓にも一部の表のバックアップの入口（表を選んで「＋ この表だけ」）。既定はいま開いている表
  const mk = await p.evaluate(() => ({ sel: document.querySelector(".cvh-dlg [data-cvh-mkname]")?.value || "", btn: document.querySelector('.cvh-dlg [data-cvh-mk="pick"]')?.textContent || "",
    all: !!document.querySelector('.cvh-dlg [data-cvh-mk="all"]'), filtered: !!document.querySelector(".cvh-dlg .cvh-filter") }));
  check("⑤ 全体の窓に「表を選んで ＋ この表だけ」（既定はいま開いている表「管理分類」）", !mk.filtered && mk.all && mk.sel === "管理分類" && /＋ この表だけ/.test(mk.btn), mk);
  await p.selectOption(".cvh-dlg [data-cvh-mkname]", "課名"); await sleep(150);
  await p.click('.cvh-dlg [data-cvh-mk="pick"]'); await sleep(1500);
  const hk = (await api("/api/masters/conversions/history")).body, one = hk.points[0];
  const okMsg = await p.$eval(".cvh-dlg .cvh-msg", (x) => x.textContent).catch(() => "");
  check("⑤ 選んだ表「課名」だけの手の時点が残る（scope は課名・知らせ「「課名」だけをバックアップしました」）",
    hk.points.length === hb.points.length + 1 && !one.auto && JSON.stringify(one.scope) === '["課名"]' && /「課名」だけをバックアップしました/.test(okMsg), { one, okMsg });
  const base = await items();
  await api("/api/masters/conversions", J("POST", { name: "試しの表", inputs: [{ name: "x", type: "text", columns: ["x"] }], rows: [{ when: { x: [{ op: "eq", v: ["1"] }] }, out: "一" }], other: "", apply: { mode: "add", column: "試し", place: "end" } }));
  const ka = base.find((x) => x.name === "課名");
  await api(`/api/masters/conversions/${ka.id}`, J("PUT", { ...strip(ka), rows: ka.rows.slice(0, -1), base_rev: ka.rev }));
  await p.click('.cvh-dlg [data-cvb-close]'); await sleep(300);
  await openConv(); await p.click("[data-cvb-hist]"); await p.waitForSelector(".cvh-dlg .cvh-pt"); await sleep(800);
  await p.click(`.cvh-dlg [data-cvh-pt="${man.id}"]`); await sleep(1000);
  const gone = await p.evaluate(() => [...document.querySelectorAll(".cvh-dt tbody tr")].map((r) => r.textContent).join(" | "));
  check("⑤ 全体の時点の差に、後で足した表が「消える」・課名が「変わる」", /試しの表.*消える/.test(gone) && /課名.*変わる/.test(gone), gone.slice(0, 400));
  await p.click("[data-cvh-goall]"); await p.waitForSelector(".cvh-msg.ok", { timeout: 8000 }); await sleep(900);
  const after5 = await items();
  check("⑤ 全体を戻すと、全部の表が時点の形・足した表は消える", after5.length === base.length && after5.every((x) => JSON.stringify(strip(x)) === JSON.stringify(strip(base.find((y) => y.name === x.name) || {}))), after5.map((x) => x.name));

  // ⑥ 同梱のプリセットを標準にする前の確かめ
  await api("/api/masters/conversions/defaults", J("POST", { from: "current" }));
  await p.click('.cvh-dlg [data-cvb-close]'); await openConv(); await p.click("[data-cvb-hist]"); await p.waitForSelector(".cvh-dlg .cvh-pt"); await sleep(600);
  await p.click(".cvh-dlg [data-cvb-bundled]"); await p.waitForSelector("[data-cvh-std]"); await sleep(400);
  const conf = await p.evaluate(() => ({ head: document.querySelector(".cvh-conf")?.textContent || "", rows: [...document.querySelectorAll(".cvh-dt tbody tr")].map((r) => r.textContent) }));
  check("⑥ 確かめ: 表の中身は変わらない・表ごとに行の数（今の表・今の標準・決めた後）", /表の中身は変わりません/.test(conf.head) && conf.rows.length >= 8 && conf.rows.every((t) => (t.match(/行/g) || []).length >= 3), conf);
  const itemsStd = await items();
  await p.click("[data-cvh-std]"); await sleep(1500);
  const ls = (await api("/api/masters/conversions")).body;
  check("⑥ 押すと標準が同梱・表の中身は変わらない", !ls.customDefaults && JSON.stringify(ls.items.map(strip)) === JSON.stringify(itemsStd.map(strip)), ls.customDefaults);
  const hs = (await api("/api/masters/conversions/history")).body;
  check("⑥ 前の標準は時点に残る（同梱のプリセットを標準にする前）", /同梱のプリセットを標準にする前/.test(hs.points[0].why), hs.points[0]);
  await p.click('.cvh-dlg [data-cvb-close]');

  // ⑦ 取り込む前の確かめ
  const doc = { kind: "tpa-conversions", version: 1, items: (await api("/api/masters/conversions/export")).body.items };
  const ji = doc.items.find((x) => x.name === "地取区分"); ji.rows = ji.rows.slice(0, 2); doc.items = [ji];
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tpa-cvb-")), "imp.json"); fs.writeFileSync(f, JSON.stringify(doc));
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click("[data-cv-import]")]);
  await chooser.setFiles(f); await p.waitForSelector(".cv-imp"); await sleep(300);
  const imp = await p.$eval(".cv-imp", (x) => x.textContent);
  check("⑦ 取り込む前に 5 行 → 2 行（3 行が消える）・ほかの表は変えない・履歴に残す", /地取区分」5 行 → 2 行（3 行が消える）/.test(imp) && /ほかの \d+ 表は変えません/.test(imp) && /履歴に残します/.test(imp), imp);
  await p.click("[data-cv-impno]"); await sleep(300);

  // ⑧ 3 つの大きさ
  for (const v of ["1728x1152", "1536x864", "1280x720"]) {
    const [w, h] = v.split("x").map(Number);
    await p.setViewportSize({ width: w, height: h }); await sleep(500);
    await openConv(); await pick("管理分類");
    await p.click("[data-cv-save]"); await p.waitForSelector(".cv-saved"); await sleep(500);
    const head = await p.evaluate(() => {
      const kids = [...document.querySelectorAll("#masterSettings .cv-top > :not(.sp)")].filter((e) => e.offsetParent);
      const tops = kids.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2));
      const io = document.querySelector("#masterSettings .cv-io").getBoundingClientRect(), box = document.querySelector("#masterSettings").getBoundingClientRect();
      const broken = [...document.querySelectorAll("#masterSettings .cv-top button, #masterSettings .cv-io button, #masterSettings .cv-saved, #masterSettings .cv-stchip")].filter((e) => e.offsetParent && e.getClientRects().length && e.getBoundingClientRect().height > 40).map((e) => e.textContent);
      return { oneLine: Math.max(...tops) - Math.min(...tops) <= 8, io: io.bottom <= box.bottom, broken };
    });
    check(`⑧ ${v}: 表の頭が 1 段（保存した印つき）・一覧の頭の下の状態とボタンが送らずに見える・字が折れない`, head.oneLine && head.io && !head.broken.length, head);
    await p.click("[data-cvb-hist]"); await p.waitForSelector(".cvh-dlg .cvh-pt"); await sleep(900);
    const win = await p.evaluate(() => {
      const vw = innerWidth, vh = innerHeight, card = document.querySelector(".cvh-card").getBoundingClientRect();
      const pin = document.querySelector(".cvh-pins .cvh-pt").getBoundingClientRect(), left = document.querySelector(".cvh-left").getBoundingClientRect();
      const over = [...document.querySelectorAll(".cvh-card *")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "hidden").map((e) => e.className);
      const wrapped = [...document.querySelectorAll(".cvh-card button:not(.cvh-pt), .cvh-st, .cvh-k, .cvh-sc, .cvh-nb, .cvh-pt1 b")].filter((e) => e.offsetParent && [...e.getClientRects()].length > 1 || (e.tagName === "BUTTON" && e.offsetParent && e.getBoundingClientRect().height > 40)).map((e) => e.textContent);
      return { inView: card.left >= 0 && card.top >= 0 && card.right <= vw && card.bottom <= vh, pinVisible: pin.bottom <= left.bottom && pin.bottom <= vh, over, wrapped };
    });
    check(`⑧ ${v}: 窓が画面に収まる・同梱のプリセットの札が送らずに見える・はみ出し・ボタンと札の字の折れが無い`, win.inView && win.pinVisible && !win.over.length && !win.wrapped.length, win);
    await p.click('.cvh-dlg [data-cvb-close]'); await sleep(300);
  }
  await p.setViewportSize({ width: 1728, height: 1152 });

  // ⑨ 権限（最後に: 自分の権限を下げると戻せないので）
  const acc = (await api("/api/masters/access")).body, mine = acc.items.find((x) => x.id === acc.matchedId);
  const add = await api(`/api/masters/access/${mine.id}`, J("PUT", { ...mine, "マスタ編集": "部分的編集可", base_rev: mine.rev }));
  check("⑨ （準備）この PC の人（今の権限の行）のマスタ編集を「部分的編集可」にする", add.status < 300, add);
  await sleep(2500);
  const deny = await p.evaluate(async () => {
    const J = (m, b) => ({ method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const s = async (path, init) => (await fetch(path, init)).status;
    return {
      backup: await s("/api/masters/conversions/history", J("POST", {})),
      restore: await s("/api/masters/conversions/history/bundled/restore", J("POST", { names: ["管理分類"] })),
      defaults: await s("/api/masters/conversions/defaults", J("POST", { from: "bundled" })),
      list: (await (await fetch("/api/masters/conversions/history")).json()).canBackup,
    };
  });
  check("⑨ 戻す・バックアップ・標準の道は 403・canBackup は偽", deny.backup === 403 && deny.restore === 403 && deny.defaults === 403 && deny.list === false, deny);
  await p.click("#masterCloseBtn").catch(() => {}); await sleep(300); await openConv(); await pick("管理分類"); await sleep(800);
  const noUi = await p.evaluate(() => ({ hist: !!document.querySelector("[data-cvb-hist]"), th: !!document.querySelector("[data-cvb-th]"), save: !!document.querySelector("[data-cv-save]") }));
  check("⑨ 画面に 履歴と戻す・履歴 ▾ が無い（表を保存するボタンはある）", !noUi.hist && !noUi.th && noUi.save, noUi);
  await p.click("[data-cv-save]"); await p.waitForSelector("#cvNotice.ok", { timeout: 8000 }).catch(() => {});
  const saved = await p.$eval("#cvNotice", (x) => x.className + " " + x.textContent).catch(() => "");
  check("⑨ 表の保存の権限は前のまま（部分的編集可で保存できる）", /\bok\b/.test(saved), saved);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
