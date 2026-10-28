// 評価関数（開発用）: データ元を 1 つの仕組みに（版 3.58.0。利用者の要望 2026-10-28。決め方: ui-proposals/2026-10-unify-2 の C3・D1）。
//   node program/tools/ui-eval-unify.mjs
// ① マスタ管理のナビに参照先・作業実績が無く、データ元が 1 つ。見出しのタブは「品質」「実績」（データ元の名前）
// ② 品質の名前を欄で変えると見出しのタブも変わる・空にすると元の名前に戻る
// ③ 接続の段: 品質の確かめる間隔を 120 にして保存 → サーバーの接続の設定（参照先の項目）に入る・段の要約に出る → 空にして既定へ
// ④ 実績を開くと、接続（フォルダ・決まり・間隔・警告）・設備（作業実績の頁と同じ表）・ロット番号の列・結合の段が 1 つの欄に並ぶ
// ⑤ ロット番号の列: 選びに実際の列と「自動（見つけた列: …）」「なし」。なし を保存 → サーバーの lotSet が "-"・要約が「なし」→ 自動に戻す
// ⑥ グループを消す（台帳）→ 中の元はグループなしへ・元は消えない
// ⑦ そのほかの接続: ロット問い合わせ・更新の置き場・ブラウザの 3 行。開いて保存 → 既定に戻す
// ⑧ 見出しのタブの権限: 一般ユーザーの「実績」を ✕ にして保存 → サーバーの決まり。人の段・人ごとの例外の札。
//    出さないタブ（/api/access/me の hiddenTabs）は見出しから消える
// ⑨ 1728・1536・1280 で、データ元の頁（実績を開いた所）と権限の表が横にはみ出さない・段の要約が 1 段
// 全部合えば終了コード 0。
import { launch, sleep, parseView, manySources, showField } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const items = (p) => p.evaluate(async () => Object.fromEntries((await (await fetch("/api/sources", { cache: "no-store" })).json()).items.map((x) => [x.key, x])));
const openMaster = async (p, tab = "sources") => {
  if (await p.evaluate(() => document.querySelector("#masterOverlay").classList.contains("hidden"))) { await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); }
  await p.evaluate((t) => document.querySelector(`#masterTabs [data-tab="${t}"]`).click(), tab); await sleep(900);
};
const edit = async (p, key) => { await p.click(`#masterSettings [data-sr-edit="${key}"]`); await p.waitForSelector("#masterSettings .sr-card.is-open .sr-acc"); await sleep(500); };
const save = async (p) => { await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(1800); };
const tabName = (p, screen) => p.$eval(`.screen-tabs [data-screen="${screen}"] .tab-name`, (x) => x.textContent).catch(() => null);
const fit = (p) => p.evaluate(() => {
  const b = document.querySelector("#masterSettings");
  const sums = [...b.querySelectorAll(".sr-sum")].filter((x) => x.offsetParent).map((x) => ({ h: Math.round(x.getBoundingClientRect().height), t: x.textContent.slice(0, 30) }));
  return { over: b.scrollWidth > b.clientWidth + 1, twoLine: sums.filter((x) => x.h > 24) };
});

const app = await launch();
try {
  const errors = [];
  const p = await app.newPage("light", parseView("1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  await manySources(p, true); await sleep(500);
  // ①
  await openMaster(p);
  const nav = await p.$$eval("#masterTabs .tab", (bs) => bs.map((b) => b.dataset.tab));
  const labs = await p.$$eval("#masterTabs .mg-lab", (xs) => xs.map((x) => x.textContent));
  check("① ナビに参照先・作業実績が無く、データ元の見出しの下にデータ元", !nav.includes("paths") && !nav.includes("worklog") && nav.includes("sources") && labs.includes("データ元") && !labs.includes("つなぎ先"), { nav, labs });
  check("① 見出しのタブは「品質」「実績」", (await tabName(p, "list")) === "品質" && (await tabName(p, "work")) === "実績", [await tabName(p, "list"), await tabName(p, "work")]);
  // ②
  await edit(p, "lot");
  await showField(p, '#masterSettings .sr-card.is-open [data-sr="name"]');
  await p.fill('#masterSettings .sr-card.is-open [data-sr="name"]', "品質異常"); await save(p);
  check("② 品質の名前を変えると、データ元と見出しのタブの名前が変わる", (await items(p)).lot.name === "品質異常" && (await tabName(p, "list")) === "品質異常", [(await items(p)).lot.name, await tabName(p, "list")]);
  await edit(p, "lot");
  await showField(p, '#masterSettings .sr-card.is-open [data-sr="name"]');
  await p.fill('#masterSettings .sr-card.is-open [data-sr="name"]', ""); await save(p);
  check("② 空にすると元の名前（品質）に戻る", (await items(p)).lot.name === "品質" && (await tabName(p, "list")) === "品質", (await items(p)).lot.name);
  // ③
  await edit(p, "lot");
  await showField(p, '#masterSettings .sr-card.is-open [data-sr-conn="refresh"]');
  await p.fill('#masterSettings .sr-card.is-open [data-sr-conn="refresh"]', "120"); await save(p);
  const ref = (await items(p)).lot.conn.find((f) => f.id === "refresh");
  check("③ 品質の確かめる間隔を 120 にすると、参照先の項目（lot_list.refresh_seconds）に入る", ref.value === 120 && ref.item === "lot_list.refresh_seconds" && ref.bind === "settings", ref);
  await edit(p, "lot");
  const sum = await p.$eval('#masterSettings .sr-sec[data-sec="conn"] .sr-sum', (x) => x.textContent);
  check("③ 接続の段の要約に「120 秒ごと」とファイル名", /120 秒ごと/.test(sum) && /SIKADEF\.sqlite3/.test(sum), sum);
  await p.fill('#masterSettings .sr-card.is-open [data-sr-conn="refresh"]', ""); await save(p);
  check("③ 空にして保存すると既定へ戻る", (await items(p)).lot.conn.find((f) => f.id === "refresh").value === "", (await items(p)).lot.conn.find((f) => f.id === "refresh"));
  // ④
  await edit(p, "work");
  const secs = await p.$$eval("#masterSettings .sr-card.is-open .sr-sec", (xs) => xs.map((x) => x.dataset.sec));
  const conn = await p.$$eval('#masterSettings .sr-card.is-open .sr-sec[data-sec="conn"] [data-sr-conn]', (xs) => xs.map((x) => x.dataset.srConn));
  check("④ 実績: 名前とタブ・接続・設備・ロット番号の列・結合の 5 段、接続はフォルダ・決まり・間隔・警告", secs.join() === "name,conn,equip,lot,join" && conn.join() === "folder,pattern,refresh,stale", { secs, conn });
  await p.click('#masterSettings [data-sr-sec="equip"]'); await sleep(1500);
  const eq = await p.evaluate(() => ({ rows: document.querySelectorAll("#masterSettings .sr-wl tr[data-id]").length, src: !!document.querySelector("#masterSettings .sr-wl .wl-src:not([hidden])"),
    sum: document.querySelector('#masterSettings .sr-sec[data-sec="equip"] .sr-sum').textContent, tags: [...document.querySelectorAll('#masterSettings .sr-sec[data-sec="equip"] .sr-tag')].map((t) => Math.round(t.getBoundingClientRect().width)) }));
  check("④ 設備の段: 12 台の表（フォルダの欄は接続の段にだけ）・要約に直すことの札（字の幅）", eq.rows === 12 && !eq.src && /12 台/.test(eq.sum) && eq.tags.length === 2 && eq.tags.every((w) => w < 160), eq);
  const one = await p.$$eval('#masterSettings .sr-sec[data-sec="equip"] .sr-sh', (bs) => bs.length);
  check("④ 段を開く入口は見出し 1 つ（「直す」ボタンが並ばない）", one === 1 && !(await p.$('#masterSettings .sr-sec .sr-sh ~ button')), one);
  await p.click("#masterSettings .sr-card.is-open [data-sr-close]"); await sleep(400);
  // ⑤
  const all = await items(p), odd = Object.values(all).find((x) => x.name === "製造条件マスタ");
  await edit(p, odd.key);
  await p.click('#masterSettings [data-sr-sec="lot"]'); await sleep(1200);
  const opts = await p.$$eval('#masterSettings [data-sr-conn="lot"] option', (os) => os.map((o) => [o.value, o.textContent]));
  check("⑤ ロット番号の列の選び: 自動（見つけた列…）・なし・実際の列", opts[0][0] === "" && /^自動（/.test(opts[0][1]) && opts[1][0] === "-" && opts.some(([v]) => v === "材質"), opts.slice(0, 5));
  await p.selectOption('#masterSettings [data-sr-conn="lot"]', "-"); await save(p);
  check("⑤ 「なし」を保存すると、サーバーの lotSet が「-」", (await items(p))[odd.key].lotSet === "-", (await items(p))[odd.key].lotSet);
  await edit(p, odd.key);
  const lotSum = await p.$eval('#masterSettings .sr-sec[data-sec="lot"] .sr-sum', (x) => x.textContent);
  check("⑤ 段の要約が「なし」", /なし/.test(lotSum), lotSum);
  await p.click('#masterSettings [data-sr-sec="lot"]'); await sleep(900);
  await p.selectOption('#masterSettings [data-sr-conn="lot"]', ""); await save(p);
  check("⑤ 自動に戻す", (await items(p))[odd.key].lotSet === "", (await items(p))[odd.key].lotSet);
  // ⑥
  const inGrp = Object.values(await items(p)).filter((x) => x.group === "台帳").map((x) => x.key);
  p.once("dialog", (d) => d.accept());
  await p.click('#masterSettings [data-sr-gdel="台帳"]'); await sleep(1800);
  const after = await items(p);
  check("⑥ グループを消すと、中の元はグループなしへ（元は残る）", inGrp.length > 0 && inGrp.every((k) => after[k] && !after[k].group), inGrp.map((k) => after[k] && after[k].group));
  // ⑦
  const oth = await p.$$eval("#masterSettings tr.sr-orow", (xs) => xs.map((x) => x.dataset.other));
  check("⑦ そのほかの接続: ロット問い合わせ・更新の置き場・ブラウザの 3 行", oth.join() === "lotdsp_import.url,update.source,lotdsp_import.direct.browser", oth);
  await p.click('#masterSettings button[data-oth-open="lotdsp_import.url"]'); await sleep(500);
  await p.fill("#masterSettings .sr-other [data-oth]", "http://example.invalid/LotDspWeb/");
  await p.click("#masterSettings .sr-other [data-oth-save]"); await sleep(1500);
  const lu = await p.evaluate(async () => (await (await fetch("/api/sources", { cache: "no-store" })).json()).others.find((o) => o.key === "lotdsp_import.url"));
  check("⑦ 開いて保存すると、その項目に入る（行にいま効いている値）", lu.value === "http://example.invalid/LotDspWeb/" && (await p.$eval('#masterSettings tr[data-other="lotdsp_import.url"] .sr-fname', (x) => x.textContent)) === lu.value, lu);
  await p.click('#masterSettings button[data-oth-open="lotdsp_import.url"]'); await sleep(500);
  p.once("dialog", (d) => d.accept());
  await p.click("#masterSettings .sr-other [data-oth-reset]"); await sleep(1500);
  const lu2 = await p.evaluate(async () => (await (await fetch("/api/sources", { cache: "no-store" })).json()).others.find((o) => o.key === "lotdsp_import.url"));
  check("⑦ 既定に戻す", lu2.value === "" || lu2.value == null, lu2);
  // ⑧
  await p.evaluate(async () => {
    const put = (b) => fetch("/api/masters/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    await put({ "ログインID": "maint-b", "権限区分": "メンテナンス者", "有効": "有" });
    await put({ "ログインID": "user-a", "権限区分": "一般ユーザー", "有効": "有", "タブの例外": { sch: "出さない" } });
  });
  await openMaster(p, "access");
  await p.click('[data-ta-mode="tabs"]'); await p.waitForSelector(".ta-mx"); await sleep(600);
  const people = await p.$$eval(".ta-pp", (bs) => bs.map((b) => b.textContent));
  check("⑧ 人の段: 例外の無い人も並ぶ（maint-b）・例外の数（user-a 例外 1）", people.some((t) => t.startsWith("maint-b")) && people.some((t) => /user-a.*例外 1/.test(t)), people);
  const chip = await p.$eval('.ta-mx tr:has([data-ta-ex="sch"]) .ta-chip', (x) => x.textContent).catch(() => null);
  check("⑧ スケジュールの行に「−user-a」の札", chip === "−user-a", chip);
  await p.click('.ta-mx [data-ta-cell="work"][data-role="一般ユーザー"]'); await sleep(300);
  await p.click("#taSave"); await sleep(1500);
  const rules = await p.evaluate(async () => (await (await fetch("/api/masters/tabaccess", { cache: "no-store" })).json()).rules);
  check("⑧ 一般ユーザーの実績を ✕ にして保存すると、サーバーの決まりに入る", (rules.work || []).includes("一般ユーザー"), rules.work);
  await p.click('.ta-pp:has-text("user-a")'); await sleep(400);
  const rows = await p.$$eval(".ta-mx tbody tr:not(.ta-g) th", (xs) => xs.map((x) => x.textContent));
  check("⑧ 人を押すと、その人の例外のあるタブだけ", rows.join() === "スケジュール", rows);
  // 出さないタブ（hiddenTabs）を受けた人の見出し
  await p.route("**/api/access/me*", async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: { ...j, hiddenTabs: ["work"] } }); });
  await p.click("#masterCloseBtn"); await sleep(400);
  await p.reload(); await sleep(4000);
  const denied = await p.evaluate(() => { const b = document.querySelector('.screen-tabs [data-screen="work"]'); return { denied: b.hasAttribute("data-denied"), shown: getComputedStyle(b).display !== "none" }; });
  check("⑧ 出さないタブ（実績）は見出しから消える", denied.denied && !denied.shown, denied);
  await p.unroute("**/api/access/me*");
  await p.context().close();
  // ⑨
  for (const v of ["1728x1152", "1536x864", "1280x720"]) {
    const q = await app.newPage("light", parseView(v));
    q.on("pageerror", (e) => errors.push(e.message));
    await openMaster(q);
    await edit(q, "work");
    const f1 = await fit(q);
    check(`⑨ ${v} 実績を開いたデータ元の頁が横にはみ出さない・段の要約が 1 段`, !f1.over && !f1.twoLine.length, f1);
    await openMaster(q, "access");
    await q.click('[data-ta-mode="tabs"]'); await q.waitForSelector(".ta-mx"); await sleep(500);
    const f2 = await q.evaluate(() => { const b = document.querySelector("#masterSettings"); return { over: b.scrollWidth > b.clientWidth + 1,
      h: Math.round(document.querySelector(".ta-top").getBoundingClientRect().height) }; });
    check(`⑨ ${v} 権限の表が横にはみ出さない・道具の段が 1 段（高さ 48px 以下）`, !f2.over && f2.h <= 48, f2);
    await q.context().close();
  }
  check("頁の誤りが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 300));
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
