// 評価関数（開発用）: 中身（Python）が止まった・起こす・起きた形と、面の行の焦点・共有に届かない帯（版 3.111.0。2026-11-stage2b-ui.json の 2 回目で決めた I）。
//   node program/tools/ui-eval-pydown.mjs [撮る出力フォルダ]
// 開発用サーバーを、手元のマスタに読めない行を足し（TPA_UI_BAD_ROWS）、共有に届かない形（TPA_UI_SHARE=down）で起こし、1728×1152・1536×864・1280×720 で、
// 本物のキーとマウスで:
// ① ふだん（動いている）: 知らせの段も札「中身停止」も無く、暇な「待機中」は出る
// ② 止まる（窓が知らせる tpa:python と、心拍の答えの python）: 見出しのすぐ下に 1 段の知らせの段（38px・字も釦も 1 段・切れない）。画面は 38px 縮み、
//    段の下から始まる（表に重ならない・窓の下にはみ出さない）。「接続 ●」・権限の札・「マスタ管理」は窓の答えのまま。段が出ている間は札を出さない。
//    見出しは 1 段で「終了」まで届く。1728 は見出しのタブの絵が残る
// ③ 待機中: 止まっている間は暇な「待機中」だけを隠し、計算中・エラーの札は出す。動いていれば「待機中」も出す
// ④ 送り位置: 一覧を送って行を選んだまま止まる・起きるで、送り位置（scrollTop）と選んだ行・焦点が変わらない
// ⑤ 「詳しく」（マウス）で接続の様子の面が窓の中に開き、Esc で閉じて「詳しく」に焦点が戻る
// ⑥ 「畳む」で段が消えて画面の高さが戻り、札「中身停止」（button）が残る。札を Enter・Space で押すと段が戻り、焦点は段の「もう一度起こす」
// ⑦ 「もう一度起こす」（マウス）: 段が「起きるのを待っています…」に替わり、起きたら「✓ 中身（Python）が動きました」を 2〜3 秒出してから畳む。
//    起きた後に権限を読み直し（/api/access/me）、札と「マスタ管理」は残る
// ⑧ 出さないタブ: 止まっていても窓の名乗りの出さないタブ（計算）は出さない。権限を 1 度も読めなければ決まりのあるタブを出さない（札「権限 ?」）
// ⑨ 面の行の焦点: キーボードは :focus-visible に藍の輪。マウスで確かめの窓の「やめる」を押すと押した行に輪と札「やめた行」、4 秒で消える（焦点は残る）・
//    キーを押しても消える
// ⑩ 共有に届かない帯: 1 段（道は末尾「…/<名前>」・全部は title・「写しを表示中・保存できません」）。ナビは名前の下の段に「届かない」（折れない）
// 版 3.111.0 の作った後の採点の直し:
// ⑪ 見出しのタブの並び（出ているタブ・「ほか N」・絵・詰めた形）が、ふだん・止まった（段）・畳んだ・起こしている（段・札）・起きた（「✓」の段）で同じ
// ⑫ キーで「もう一度起こす」を押すと、焦点は段に入る前の所（無ければ「接続 ●」）へ戻る（段そのものや body に落ちない）。起こしている間は回る印
// ⑬ ダッシュボード: 段が出ても数字のパネルの主の数は 16px 以上で、止まる前と同じ大きさ・並べ方（縮めるのはほかの段）
// ⑭ 頁の読み込みの途中に中身が止まった知らせ（window.__tpaPython）が来ても、画面のエラー無しに起き、段が出る
// ⑮ 権限を読んでいる最中（答えを遅らせた間）も、決まりのあるタブ（計算・実績・ダッシュボード）を出さない
// 撮る出力フォルダを渡すと pydown-<所>-<大きさ>.png を置く。全部合えば終了コード 0。
process.env.TPA_UI_BAD_ROWS = "1";
process.env.TPA_UI_SHARE = "down";
const { launch, sleep, PY_WHY } = await import("./ui-harness.mjs");
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "";
if (out) fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {}); };
const VIEWS = [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }, { width: 1280, height: 720 }];

/** 見出し・段・画面の様子 */
const look = (p) => p.evaluate(() => {
  const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  const bar = document.querySelector("#pyBar"), br = bar.getBoundingClientRect();
  const kids = [...bar.children].filter(vis).map((c) => c.getBoundingClientRect());
  const mid = br.top + br.height / 2;
  const scr = document.querySelector('[id$="Screen"]:not(.hidden)'), sr = scr.getBoundingClientRect();
  const head = document.querySelector("header").getBoundingClientRect();
  const tabs = [...document.querySelectorAll(".screen-tabs .screen-tab")].filter(vis);
  const quit = document.querySelector("#quitBtn").getBoundingClientRect();
  const st = document.querySelector("#status"), pill = document.querySelector("#pyPill");
  return {
    bar: vis(bar), barH: Math.round(br.height), barOne: kids.every((k) => Math.abs(k.top + k.height / 2 - mid) < 4 && k.height <= 30),
    barCut: [...bar.querySelectorAll("button, b")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
    barText: bar.textContent.replace(/\s+/g, " ").trim(), buttons: [...bar.querySelectorAll("button")].map((b) => b.textContent), ok: bar.classList.contains("is-ok"),
    screenTop: Math.round(sr.top), screenBottom: Math.round(sr.bottom), screenH: Math.round(sr.height), barBottom: Math.round(br.bottom), headBottom: Math.round(head.bottom),
    inner: innerHeight, pageY: document.documentElement.scrollHeight <= innerHeight + 1,
    conn: document.querySelector("#conn").textContent.trim(), chip: document.querySelector("#meChip").textContent.trim(), master: vis(document.querySelector("#masterBtn")),
    status: { text: st.textContent.trim(), shown: vis(st) }, pill: { shown: vis(pill), text: pill.textContent.trim(), button: pill.tagName === "BUTTON" },
    icons: tabs.filter((t) => { const s = t.querySelector("svg"); return s && s.getBoundingClientRect().width > 0; }).length, tabs: tabs.length,
    more: !!document.querySelector(".screen-tabs .tab-more"), quitIn: quit.right <= innerWidth + 1 && quit.bottom <= head.bottom + 1,
    headOne: [...document.querySelectorAll("header .hstat, header #meChip, header #masterBtn, header #quitBtn")].filter(vis).every((e) => e.getBoundingClientRect().bottom <= head.bottom + 1),
    bodyOn: document.body.classList.contains("py-band-on"), focus: document.activeElement?.dataset?.py || document.activeElement?.id || document.activeElement?.tagName,
    tabSig: JSON.stringify({ shown: tabs.map((t) => t.dataset.screen), more: document.querySelector(".screen-tabs .tab-more")?.textContent || "",
      tight: document.querySelector(".screen-tabs").classList.contains("is-tight"), icons: tabs.filter((t) => { const s = t.querySelector("svg"); return s && s.getBoundingClientRect().width > 0; }).length }),
    spin: !!document.querySelector("#pyBar .wait-spin, #pyPill:not([hidden]) .wait-spin"),
    headOver: document.querySelector("header").scrollWidth > document.querySelector("header").clientWidth + 1,
  };
});
/** 送り位置と選んだ行（焦点を置いたロットの行。段の釦へ焦点が移った後は、前に置いた行の印で見る）・カードに選んだ行 */
const keep = (p) => p.evaluate(() => {
  const a = document.activeElement?.closest?.("#llBody tr[data-i]");
  if (a) document.body.dataset.keepRow = a.dataset.i;
  return { top: document.querySelector(".ll-grid-wrap")?.scrollTop, row: document.body.dataset.keepRow || "",
           rowShown: !!document.querySelector(`#llBody tr[data-i="${document.body.dataset.keepRow}"]`),
           carded: [...document.querySelectorAll("#llBody tr.is-carded")].map((t) => t.dataset.i).join(",") };
});
/** 窓（main.rs の band）が知らせる中身の様子 */
const tell = (p, state, why = "") => p.evaluate(([s, w]) => window.dispatchEvent(new CustomEvent("tpa:python", { detail: { state: s, why: w } })), [state, why]);

const app = await launch();
try {
  for (const view of VIEWS) {
    const tag = `${view.width}x${view.height}`;
    const p = await app.newPage("light", view);
    // 心拍の答えに中身の様子を添える（窓の答えと同じ形。開発用サーバーは Python なので、ここで足す）・「もう一度起こす」は 1.5 秒で起きる
    let PY = { state: "ready", why: "" }, retries = 0, meReads = 0;
    p.on("request", (r) => { if (new URL(r.url()).pathname === "/api/access/me") meReads++; });
    await p.route("**/api/heartbeat", async (route) => {
      const r = await route.fetch(); const j = await r.json().catch(() => ({}));
      await route.fulfill({ json: { ...j, python: PY } });
    });
    await p.route("**/__desktop/backend/retry", async (route) => {
      retries++; PY = { state: "starting", why: "" };
      setTimeout(() => { PY = { state: "ready", why: "" }; tell(p, "ready").catch(() => {}); }, 1500);
      await route.fulfill({ json: { ok: true } });
    });
    await sleep(3500);   // 心拍が 1 度は通る
    // ① ふだん
    const a = await look(p);
    check(`① ${tag} ふだんは段も札「中身停止」も無く、暇な「待機中」は出る`, !a.bar && !a.pill.shown && a.status.shown && a.status.text === "待機中" && !a.bodyOn && a.conn === "接続 ●", a);
    await shot(p, `pydown-ok-${tag}`);
    // ④ の支度: 一覧を送り、行を押して選ぶ
    await p.evaluate(() => { const w = document.querySelector(".ll-grid-wrap"); if (w) w.scrollTop = 600; });
    await sleep(500);
    // 選んだ行: 一覧の真ん中の行のロット番号に焦点（押すと計算の画面へ移るので、焦点だけ置く）
    await p.evaluate(() => { const w = document.querySelector(".ll-grid-wrap").getBoundingClientRect();
      const tr = document.elementFromPoint(w.left + w.width / 2, w.top + w.height / 2)?.closest("tr[data-i]"); tr?.querySelector(".ll-lot")?.focus({ preventScroll: true }); });
    await sleep(400);
    const keep0 = await keep(p);
    // ② 止まる
    PY = { state: "stopped", why: PY_WHY };
    await tell(p, "stopped", PY_WHY); await sleep(500);
    const b = await look(p);
    check(`④ ${tag} 止まった知らせで焦点は選んだ行のまま（段へ移さない）`, (await p.evaluate(() => document.activeElement?.closest?.("#llBody tr[data-i]")?.dataset.i)) === keep0.row, keep0);
    check(`② ${tag} 見出しのすぐ下に 1 段の知らせの段（38px・字も釦も 1 段・切れない）`, b.bar && b.barH === 38 && b.barOne && !b.barCut.length && b.headBottom === b.barBottom - 38 && /中身（Python）が止まっています/.test(b.barText)
      && b.buttons.join("|") === "もう一度起こす|詳しく|畳む", b);
    check(`② ${tag} 画面は 38px 縮み段の下から始まる（表に重ならない・窓の下にはみ出さない）`, b.screenTop >= b.barBottom && b.screenBottom <= b.inner && b.screenH === a.screenH - 38 && b.pageY, { a: a.screenH, b });
    check(`② ${tag} 「接続 ●」・権限の札・「マスタ管理」は窓の答えのまま・段が出ている間は札を出さない`, b.conn === "接続 ●" && b.chip && b.chip !== "権限 ?" && b.master && !b.pill.shown, b);
    check(`② ${tag} 見出しは 1 段で「終了」まで届く${view.width === 1728 ? "・タブの絵が残る" : ""}`, b.quitIn && b.headOne && (view.width !== 1728 || b.icons === b.tabs), b);
    await shot(p, `pydown-stopped-${tag}`);
    const sigs = { normal: a.tabSig, stopped: b.tabSig };
    // 心拍が同じ様子を答えても描き直さない（焦点が外れない）
    await p.focus('#pyBar [data-py="more"]'); await sleep(3500);
    check(`② ${tag} 心拍が来ても段を描き直さず焦点が残る`, (await look(p)).focus === "more", await look(p));
    // ③ 待機中
    await p.evaluate(() => setStatus("計算中…", "busy")); const c1 = await look(p);
    await p.evaluate(() => setStatus("エラー", "err")); const c2 = await look(p);
    await p.evaluate(() => setStatus("待機中")); const c3 = await look(p);
    check(`③ ${tag} 止まっている間は「待機中」だけを隠し、計算中・エラーの札は出す`, c1.status.shown && c2.status.shown && !c3.status.shown, [c1.status, c2.status, c3.status]);
    // ④ 送り位置
    const keep1 = await keep(p);
    check(`④ ${tag} 段が出ても送り位置と選んだ行は同じ`, keep0.top > 0 && keep0.row && keep1.rowShown && JSON.stringify(keep0) === JSON.stringify(keep1), { keep0, keep1 });
    // ⑤ 詳しく（マウス）
    await p.click('#pyBar [data-py="more"]'); await sleep(300);
    const pop = await p.evaluate(() => { const e = document.querySelector("#connPop"); if (!e) return null; const r = e.getBoundingClientRect();
      return { in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, text: e.textContent.replace(/\s+/g, " "), focus: document.activeElement?.dataset?.cp,
        restartBg: getComputedStyle(e.querySelector(".py-restart")).backgroundColor, barBg: getComputedStyle(document.querySelector('#pyBar [data-py="restart"]')).backgroundColor }; });
    check(`⑤ ${tag} 「詳しく」で接続の様子の面が窓の中に開く（理由・止まっています・もう一度起こすは段と同じ茶）`, pop && pop.in && /止まっています/.test(pop.text) && pop.text.includes("ModuleNotFoundError")
      && pop.focus === "restart" && pop.restartBg === pop.barBg, pop);
    await shot(p, `pydown-pop-${tag}`);
    await p.keyboard.press("Escape"); await sleep(250);
    const e1 = await look(p);
    check(`⑤ ${tag} Esc で面を閉じ「詳しく」に焦点が戻る`, !(await p.$("#connPop")) && e1.focus === "more", e1);
    // ⑥ 畳む → 札 → Enter・Space
    await p.click('#pyBar [data-py="fold"]'); await sleep(300);
    const f1 = await look(p);
    check(`⑥ ${tag} 畳むと段が消えて画面の高さが戻り、札「中身停止」（button）が残り焦点は札`, !f1.bar && f1.screenH === a.screenH && f1.pill.shown && f1.pill.text === "中身停止" && f1.pill.button && f1.focus === "pyPill", f1);
    check(`⑥ ${tag} 畳んだ形も見出しは 1 段で「終了」まで届く`, f1.quitIn && f1.headOne, f1);
    await shot(p, `pydown-folded-${tag}`);
    sigs.folded = f1.tabSig;
    // 畳んだまま起こしている形（札「中身」と回る印）
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("tpa:python", { detail: { state: "starting", why: "" } }))); await sleep(300);
    const fs0 = await look(p);
    sigs.foldedStarting = fs0.tabSig;
    check(`⑫ ${tag} 畳んだまま起こしている間は札に回る印・見出しからはみ出さない`, fs0.pill.shown && fs0.spin && !fs0.headOver, fs0);
    await shot(p, `pydown-folded-starting-${tag}`);
    await p.evaluate((why) => window.dispatchEvent(new CustomEvent("tpa:python", { detail: { state: "stopped", why } })), PY_WHY); await sleep(300);
    check(`⑥ ${tag} 畳んだ形の札は見出しからはみ出さない`, !f1.headOver, f1);
    await p.keyboard.press("Enter"); await sleep(300);
    const f2 = await look(p);
    check(`⑥ ${tag} 札を Enter で押すと段が戻り、焦点は段の「もう一度起こす」`, f2.bar && !f2.pill.shown && f2.focus === "restart", f2);
    await p.click('#pyBar [data-py="fold"]'); await sleep(300);
    await p.focus("#pyPill"); await p.keyboard.press("Space"); await sleep(300);
    const f3 = await look(p);
    check(`⑥ ${tag} 札を Space で押しても段が戻る`, f3.bar && f3.focus === "restart", f3);
    // ⑦ もう一度起こす（キー: 段に入る前の焦点は見出しの権限の札）
    const reads0 = meReads;
    await p.focus("#meChip"); await p.focus('#pyBar [data-py="restart"]'); await p.keyboard.press("Enter"); await sleep(400);
    const g1 = await look(p);
    sigs.starting = g1.tabSig;
    check(`⑫ ${tag} キーで「もう一度起こす」を押すと焦点は段に入る前の所（権限の札）へ戻る・段に回る印`, g1.focus === "meChip" && g1.spin, g1);
    check(`⑦ ${tag} 「もう一度起こす」で段が「起きるのを待っています…」に替わる（窓の口へ 1 回）`, g1.bar && /起きるのを待っています/.test(g1.barText) && !g1.buttons.length && retries === 1, { g1, retries });
    await shot(p, `pydown-starting-${tag}`);
    await sleep(1600);
    const g2 = await look(p);
    sigs.ok = g2.tabSig;
    check(`⑦ ${tag} 起きたら段に「✓ 中身（Python）が動きました」`, g2.bar && g2.ok && /動きました/.test(g2.barText), g2);
    await shot(p, `pydown-back-${tag}`);
    await sleep(2800);
    const g3 = await look(p);
    check(`⑦ ${tag} 2〜3 秒で段を畳み、画面の高さが戻る・札も無い・「待機中」が出る`, !g3.bar && !g3.pill.shown && g3.screenH === a.screenH && g3.status.shown, g3);
    check(`⑦ ${tag} 起きた後に権限を読み直し、札と「マスタ管理」は残る`, meReads > reads0 && g3.chip && g3.chip !== "権限 ?" && g3.master, { meReads, reads0, g3 });
    const keep2 = await keep(p);
    check(`④ ${tag} 段が消えても送り位置と選んだ行は同じ`, JSON.stringify(keep0) === JSON.stringify(keep2), { keep0, keep2 });
    sigs.after = g3.tabSig;
    check(`⑪ ${tag} 見出しのタブの並びは中身の様子で動かない（ふだん・段・畳む・起こす・起きた）`, Object.values(sigs).every((x) => x === sigs.normal), sigs);
    check(`⑫ ${tag} 起きて段が畳まれても焦点は body に落ちない`, g3.focus !== "BODY", g3);

    // ⑧ 出さないタブ（窓の名乗りに出さないタブ「計算」）: 止まっていても出さない・起きた後も
    await p.route("**/api/access/me", async (route) => {
      const r = await route.fetch(); const j = await r.json().catch(() => ({}));
      await route.fulfill({ json: { ...j, hiddenTabs: ["calc"] } });
    });
    await p.evaluate(() => loadMe()); await sleep(800);
    PY = { state: "stopped", why: PY_WHY }; await tell(p, "stopped", PY_WHY); await sleep(800);
    const h1 = await p.evaluate(() => ({ calc: document.querySelector('.screen-tabs [data-screen="calc"]').hasAttribute("data-denied"), chip: document.querySelector("#meChip").textContent }));
    check(`⑧ ${tag} 止まっていても窓の名乗りの出さないタブ（計算）は出さない・札は区分`, h1.calc && h1.chip && h1.chip !== "権限 ?", h1);
    await p.unroute("**/api/access/me");
    await p.context().close();

    // ⑧ 権限を 1 度も読めない（窓が名乗りを決められず、中身も止まった）: 決まりのあるタブを出さない
    const q = await app.newPage("light", view);
    await q.route("**/api/access/me", (route) => route.fulfill({ status: 503, json: { error: "アプリの中身（Python）が答えません。", kind: "backend_unavailable" } }));
    await q.reload(); await q.waitForFunction(() => document.querySelector("#meChip")?.textContent === "権限 ?", null, { timeout: 30000 }); await sleep(1200);
    const h2 = await q.evaluate(() => ({ chip: document.querySelector("#meChip").textContent, master: !document.querySelector("#masterBtn").classList.contains("hidden"),
      denied: ["dash", "calc", "work"].every((s) => document.querySelector(`.screen-tabs [data-screen="${s}"]`)?.hasAttribute("data-denied")) }));
    check(`⑧ ${tag} 権限を 1 度も読めなければ決まりのあるタブを出さない（札「権限 ?」・「マスタ管理」は隠す）`, h2.chip === "権限 ?" && !h2.master && h2.denied, h2);
    await shot(q, `pydown-meunknown-${tag}`);
    await q.context().close();

    // ⑬ ダッシュボードの数字のパネル: 段が出ても主の数は 16px 以上・同じ大きさ・同じ並べ方
    const dsh = await app.newPage("light", view, { screen: "dash" });
    await sleep(2500);
    const kpis = () => dsh.evaluate(() => [...document.querySelectorAll("#dashGrid .db-p")].map((el) => {
      const k = el.querySelector(".dp-kpi"); if (!k) return null;
      const n = k.querySelector(".dp-num"); return { id: el.dataset.id, cls: k.className, pair: k.querySelector(".dp-kpair")?.className || "", size: n ? parseFloat(getComputedStyle(n).fontSize) : null };
    }).filter(Boolean));
    const kpA = await kpis();
    await tell(dsh, "stopped", PY_WHY); await sleep(2500);
    const kpB = await kpis();
    const same = kpA.length > 0 && kpA.length === kpB.length && kpA.every((x, i) => x.cls === kpB[i].cls && x.pair === kpB[i].pair && x.size === kpB[i].size);
    check(`⑬ ${tag} ダッシュボード: 段が出ても数字のパネルの主の数は 16px 以上・止まる前と同じ大きさと並べ方`, same && kpB.every((x) => x.size == null || x.size >= 16), { kpA, kpB });
    const dl = await look(dsh);
    check(`⑬ ${tag} ダッシュボード: 段の下から始まり窓の下にはみ出さない`, dl.bar && dl.screenTop >= dl.barBottom && dl.screenBottom <= dl.inner && dl.pageY, dl);
    await shot(dsh, `pydown-dash-${tag}`);
    await dsh.context().close();

    // ⑭ 頁の読み込みの途中に中身が止まった知らせが来た（窓は読み込み中の頁に window.__tpaPython を置く）
    const early = await app.newPage("light", view);
    const errs = [];
    early.on("pageerror", (e) => errs.push(e.message));
    await early.addInitScript((why) => { window.__tpaPython = { state: "stopped", why }; }, PY_WHY);
    await early.reload(); await early.waitForSelector("#llBody tr[data-i]", { timeout: 30000 }); await sleep(800);
    const ea = await look(early);
    check(`⑭ ${tag} 読み込みの途中に中身が止まった知らせが来ても、画面のエラー無しに起きて段が出る`, !errs.length && ea.bar && ea.chip && ea.chip !== "確認中", { errs, ea });
    await early.context().close();

    // ⑮ 権限を読んでいる最中（答えを 3 秒遅らせる）も、決まりのあるタブを出さない
    const slow = await app.newPage("light", view);
    await slow.route("**/api/access/me", async (route) => { await sleep(3000); await route.continue(); });
    await slow.reload(); await sleep(1200);
    const s1 = await slow.evaluate(() => ({ me: !!state.me, shown: [...document.querySelectorAll(".screen-tabs [data-screen]")].filter((b) => !b.hasAttribute("data-denied") && b.offsetParent).map((b) => b.dataset.screen) }));
    check(`⑮ ${tag} 権限を読んでいる最中は、決まりのあるタブ（ダッシュボード・品質・計算・実績）を出さない`, !s1.me && !["dash", "list", "calc", "work"].some((k) => s1.shown.includes(k)), s1);
    await slow.waitForSelector("#llBody tr[data-i]", { timeout: 30000 }); await sleep(500);
    const s2 = await slow.evaluate(() => ({ me: !!state.me, screen: state.screen, list: !document.querySelector("#tabList").hasAttribute("data-denied") }));
    check(`⑮ ${tag} 読めたら頁の印の最初の画面（品質）を開く`, s2.me && s2.screen === "list" && s2.list, s2);
    await slow.context().close();

    // ⑨ ⑩ マスタ管理（共有に届かない形・読めない行の面）
    const m = await app.newPage("light", view);
    await m.click("#masterBtn"); await m.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(1200);
    const band = await m.evaluate(() => {
      const el = document.querySelector("#masterPlace"); const r = el.getBoundingClientRect();
      const kids = [...el.children].filter((k) => k.offsetParent && k.getBoundingClientRect().width > 0).map((k) => k.getBoundingClientRect());
      const dir = el.querySelector(".place-dir"), meta = el.querySelector(".place-meta");
      const st = document.querySelector('#masterTabs [data-tab="place"] .tab-state'), nm = document.querySelector('#masterTabs [data-tab="place"]');
      const range = document.createRange(); range.selectNodeContents(st);
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      const nameTop = Math.min(...[...nm.childNodes].filter((n) => n !== st && (n.nodeType === 3 ? n.textContent.trim() : true)).map((n) => { const rr = document.createRange(); rr.selectNode(n); return rr.getBoundingClientRect().top; }));
      return { one: kids.every((k) => Math.abs(k.top - kids[0].top) < 8), h: Math.round(r.height), dir: dir?.textContent, dirTitle: dir?.title, meta: meta?.textContent,
               nav: st?.textContent, navLines: lines, below: st.getBoundingClientRect().top > nameTop + 4 };
    });
    check(`⑩ ${tag} 共有に届かない帯は 1 段（道は末尾・全部は title・写しを表示中・保存できません）`, band.one && /^…\//.test(band.dir) && band.dirTitle.length > band.dir.length && band.meta === "写しを表示中・保存できません", band);
    check(`⑩ ${tag} ナビは名前の下の段に「届かない」（折れない）`, band.nav === "届かない" && band.navLines === 1 && band.below, band);
    await shot(m, `pydown-band-${tag}`);
    // ⑨ マウスで「やめる」
    await m.click(".master-place .tpa-skip"); await sleep(400);
    await m.click(".tpa-skipmenu button[role=menuitem]:not(:disabled) .tm-ico.is-del"); await m.waitForSelector(".tpa-confirm"); await sleep(200);
    await m.click('.tpa-confirm [data-act="no"]'); await sleep(500);
    const w1 = await m.evaluate(() => { const b = document.activeElement; const s = getComputedStyle(b), a = getComputedStyle(b, "::after");
      return { row: b.matches(".tpa-skipmenu button[role=menuitem]"), was: b.classList.contains("was"), after: a.content, ring: s.boxShadow, fv: b.matches(":focus-visible") }; });
    check(`⑨ ${tag} マウスで「やめる」を押すと押した行に藍の輪と札「やめた行」`, w1.row && w1.was && w1.after.includes("やめた行") && /inset/.test(w1.ring), w1);
    await shot(m, `pydown-was-${tag}`);
    await sleep(4200);
    const w2 = await m.evaluate(() => { const b = document.activeElement; return { row: b.matches(".tpa-skipmenu button[role=menuitem]"), was: b.classList.contains("was") }; });
    check(`⑨ ${tag} 札は 4 秒で消える（焦点はその行のまま）`, w2.row && !w2.was, w2);
    // キーで: Enter → 確かめの窓 → Esc で戻った行は :focus-visible の輪
    await m.keyboard.press("Enter"); await m.waitForSelector(".tpa-confirm"); await sleep(200);
    await m.keyboard.press("Escape"); await sleep(500);
    const k1 = await m.evaluate(() => { const b = document.activeElement; return { row: b.matches(".tpa-skipmenu button[role=menuitem]"), fv: b.matches(":focus-visible"), was: b.classList.contains("was"), ring: getComputedStyle(b).boxShadow }; });
    check(`⑨ ${tag} キーでやめた行は :focus-visible の藍の輪（札は付けない）`, k1.row && k1.fv && !k1.was && /inset/.test(k1.ring), k1);
    await shot(m, `pydown-kbd-${tag}`);
    // マウスでやめた後にキーを押すと札は消える
    await m.keyboard.press("Enter"); await m.waitForSelector(".tpa-confirm"); await sleep(200);
    await m.click('.tpa-confirm [data-act="no"]'); await sleep(500);
    await m.keyboard.press("ArrowDown"); await sleep(200);
    check(`⑨ ${tag} マウスでやめた後にキーを押すと札は消える`, !(await m.$(".tpa-skipmenu button.was")), null);
    await m.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
