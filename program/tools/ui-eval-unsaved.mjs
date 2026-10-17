// 評価関数（開発用）: 保存していない変更の警告（版 3.43.0。static/js/unsaved.js。利用者の要望 2026-10:
// マスタに限らず、設定を変えたまま保存せずに閉じる・別の画面へ移る操作に警告を出す）。
//   node program/tools/ui-eval-unsaved.mjs
// ① 直していなければ聞かない: マスタ管理の各タブ（勤務体系・設備グループ・変換表・データ元を開いた所・作業実績・参照先・設備マスタの行）を
//    開いただけで、タブを移る・閉じるときに窓が出ない（誤って出ると、人は窓を読まずに押すようになる）
// ② マスタ: 変換表の名前を変えて閉じる → 窓に「変換表「…」」・焦点は「戻る」・Esc で戻る（マスタ管理は開いたまま・直した名前のまま）→
//    「保存せずに進む」で閉じ、開き直すと元の名前。勤務体系の名前を変えてタブを移る → 「保存して進む」で保存され（サーバーの答え）、移る
//    変換表の中で、ほかの表を押したときも聞く
// ③ ダッシュボード: 編集でパネルの題を変えて当て、品質異常のタブを押す → 窓・戻るでダッシュボードのまま → 保存せずに進むで移り、戻ると元の題
// ④ 表示列の窓: 列を隠して × → 窓 → 保存せずに進むで閉じ、列は隠れない。Esc でも聞く。直していなければ × ですぐ閉じる
// ⑤ 終了ボタン・窓の ×: 直していれば窓（戻るで終わらない）・アプリを閉じる（beforeunload）を止める。直していなければ止めない
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const errors = [];
const dialog = (p) => p.evaluate(() => { const c = document.querySelector(".us-card"); return c ? { items: [...c.querySelectorAll("li")].map((x) => x.textContent), focus: document.activeElement.dataset.us || "", save: !!c.querySelector('[data-us="save"]') } : null; });
const press = async (p, which) => { await p.click(`.us-card [data-us="${which}"]`); await sleep(700); };
const tab = (p, key) => p.$eval(`#masterTabs [data-tab="${key}"]`, (b) => b.click());
const masterOpen = (p) => p.$eval("#masterOverlay", (o) => !o.classList.contains("hidden"));
const beforeUnloadBlocked = (p) => p.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });

const app = await launch();
try {
  const p = await app.newPage("light", parseView("1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());

  // ① 直していなければ聞かない
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(800);
  const quiet = [];
  await p.click("#masterBody tr[data-id]"); await sleep(300);
  for (const [key, ready, extra] of [["shifts", "[data-sh-save]"], ["egroups", "[data-eg-save]"], ["conv", "[data-cv-save]", async () => { await p.click('[data-cv-cell="0|形状区分"]'); await sleep(300); }],
    ["sources", "[data-sr-open]", async () => { await p.click("[data-sr-open]"); await sleep(400); }], ["worklog", "#wlFolder"], ["paths", ".ps-card"]]) {
    await tab(p, key); await p.waitForSelector(ready, { timeout: 15000 }); await sleep(500);
    if (extra) await extra();
    const pend = await p.evaluate(() => TPA.unsaved.pending("*").map((w) => w.key));
    if (pend.length) quiet.push([key, pend]);
  }
  await tab(p, "equipment"); await sleep(600);
  check("① 開いただけ（直していない）なら、どのタブも保存していない変更と見なさない", !quiet.length && !(await dialog(p)), quiet);
  await p.click("#masterCloseBtn"); await sleep(500);
  check("① 直していなければ、閉じるときに窓を出さずに閉じる", !(await masterOpen(p)) && !(await dialog(p)), null);
  check("⑤ 直していなければ、アプリを閉じるのを止めない", !(await beforeUnloadBlocked(p)), null);

  // ② 変換表の名前を変えて閉じる
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(500);
  await tab(p, "conv"); await p.waitForSelector("[data-cv-save]"); await sleep(400);
  const name0 = await p.$eval("#cvName", (x) => x.value);
  await p.fill("#cvName", name0 + "（試し）"); await p.press("#cvName", "Tab");
  await p.click("#masterCloseBtn"); await sleep(400);
  let dg = await dialog(p);
  check("② 変換表を直して閉じると窓・何が保存されていないか・焦点は「戻る」", !!dg && dg.items.some((t) => t.includes(`変換表「${name0}（試し）」`)) && dg.focus === "back" && dg.save, dg);
  await p.keyboard.press("Escape"); await sleep(400);
  check("② Esc で戻る: マスタ管理は開いたまま・直した名前のまま", !(await dialog(p)) && (await masterOpen(p)) && (await p.$eval("#cvName", (x) => x.value)) === name0 + "（試し）", null);
  check("⑤ 直していれば、アプリを閉じる（beforeunload）を止める", await beforeUnloadBlocked(p), null);
  await p.click('[data-cv-pick]:not(.is-on)'); await sleep(400);
  dg = await dialog(p);
  check("② 変換表の中で、ほかの表を押したときも聞く", !!dg && dg.items.length === 1, dg);
  await press(p, "back");
  await p.click("#masterCloseBtn"); await sleep(400);
  await press(p, "discard");
  check("② 「保存せずに進む」で閉じる", !(await masterOpen(p)), null);
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(500);
  await tab(p, "conv"); await p.waitForSelector("[data-cv-save]"); await sleep(500);
  const back = await p.evaluate(async () => (await (await fetch("/api/masters/conversions")).json()).items.map((x) => x.name));
  check("② 保存せずに進んだので、名前は元のまま（サーバーにも無い）", back.includes(name0) && !back.includes(name0 + "（試し）"), back);
  // 勤務体系: 名前を変えてタブを移る → 保存して進む
  await tab(p, "shifts"); await p.waitForSelector("[data-sh-save]"); await sleep(500);
  const sh0 = await p.$eval("#shName", (x) => x.value);
  await p.fill("#shName", sh0 + "改");
  await tab(p, "egroups"); await sleep(400);
  dg = await dialog(p);
  check("② 勤務体系を直してタブを移ると窓", !!dg && dg.items.some((t) => t.includes("勤務体系")), dg);
  await press(p, "save"); await sleep(800);
  const shifts = await p.evaluate(async () => (await (await fetch("/api/masters/shifts")).json()).items.map((x) => x.name));
  const moved = await p.evaluate(() => document.querySelector('#masterTabs [data-tab="egroups"]').getAttribute("aria-selected") === "true" || !!document.querySelector("[data-eg-save]"));
  check("② 「保存して進む」で保存され（サーバーの答え）、移る", shifts.includes(sh0 + "改") && moved, { shifts, moved });
  await p.click("#masterCloseBtn"); await sleep(400);

  // ③ ダッシュボード
  await p.click("#tabDash"); await waitDash(p); await sleep(400);
  await p.click("[data-db-editmode]"); await sleep(300);
  await p.focus('#dashGrid .db-p[data-id="workTotal"]'); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await sleep(300);
  await p.click("#deTitle", { clickCount: 3 }); await p.keyboard.type("題を変えた"); await sleep(300);
  await p.click("[data-de-apply]"); await sleep(400);
  await p.click("#tabList"); await sleep(400);
  dg = await dialog(p);
  check("③ ダッシュボードを直して品質異常へ移ると窓（組み込みは保存できないので「保存して進む」は出さない）", !!dg && dg.items.some((t) => t.includes("ダッシュボード")) && !dg.save, dg);
  await press(p, "back");
  check("③ 戻るでダッシュボードのまま", await p.$eval("#tabDash", (t) => t.getAttribute("aria-selected") === "true"), null);
  await p.click("#tabList"); await sleep(300); await press(p, "discard"); await sleep(400);
  const onList = await p.$eval("#tabList", (t) => t.getAttribute("aria-selected") === "true");
  await p.click("#tabDash"); await waitDash(p); await sleep(400);
  const title = await p.evaluate(() => Dashboard._state().layout.panels.find((x) => x.id === "workTotal").title);
  check("③ 保存せずに進むで移り、戻ると元の題", onList && title !== "題を変えた", { onList, title });

  // ④ 表示列の窓
  await p.click("#tabList"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(300);
  await p.click("#llColBtn"); await p.waitForSelector("#lcList li[data-col]"); await sleep(300);
  await p.click("#lcClose"); await sleep(300);
  check("④ 直していなければ × ですぐ閉じる", !(await dialog(p)) && (await p.$eval("#lcClose", (b) => b.closest("[hidden]") != null || b.offsetParent === null)), null);
  await p.click("#llColBtn"); await p.waitForSelector("#lcList li[data-col]"); await sleep(300);
  const col = await p.$eval("#lcList li[data-col] .lc-vis:not([disabled])", (x) => x.closest("li").dataset.col);
  await p.click(`#lcList li[data-col="${col}"] .lc-vis`); await sleep(300);
  await p.click("#lcClose"); await sleep(300);
  dg = await dialog(p);
  check("④ 列を隠して × → 窓", !!dg && dg.items.some((t) => t.includes("表示列")), dg);
  await press(p, "back");
  await p.focus("#lcFilter"); await p.keyboard.press("Escape"); await sleep(300);
  check("④ Esc でも聞く", !!(await dialog(p)), null);
  await press(p, "discard");
  const shown = await p.evaluate((c) => [...document.querySelectorAll("#llHead th")].some((th) => (th.dataset.col || th.textContent).includes(c)), col);
  check("④ 保存せずに進むで閉じ、列は隠れない", shown && (await p.$eval("#lcClose", (b) => b.offsetParent === null)), { col, shown });

  // ⑤ 終了ボタン
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(400);
  await tab(p, "conv"); await p.waitForSelector("[data-cv-save]"); await sleep(400);
  await p.fill("#cvName", "終了の試し"); await p.press("#cvName", "Tab");
  await p.evaluate(() => document.querySelector("#quitBtn").click()); await sleep(400);
  dg = await dialog(p);
  check("⑤ 直して終了を押すと窓（戻るで終わらない）", !!dg, dg);
  if (dg) await press(p, "back");
  check("⑤ 戻ったので、まだ動いている", await p.evaluate(() => !window.__tpaQuitting), null);
  await p.evaluate(() => window.dispatchEvent(new CustomEvent("tpa:close-requested"))); await sleep(400);
  dg = await dialog(p);
  check("⑤ 窓の ×（窓が tpa:close-requested を知らせる）でも窓", !!dg && dg.items.some((t) => t.includes("終了の試し")), dg);
  if (dg) await press(p, "back");
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
