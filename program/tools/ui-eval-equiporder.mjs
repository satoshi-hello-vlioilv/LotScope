// 評価関数（開発用）: 作業実績の設備のタブの並び替え（版 3.28.0。置き場は 7 案＋2 回目で選んだ: ui-proposals/2026-10-equiporder* の M1）。
//   node program/tools/ui-eval-equiporder.mjs [画像を置くフォルダ]
// 利用者の要望: 作業実績の設備のタブの並び順を変えられるように。設備を管理（設定）からでも、タブを直接でも。
// ① 設備を管理できる人: タブの帯に案内とつかめる印。6 番目のタブを引いて 3 番目の前へ → タブの並びが替わり、サーバーの並び（/api/worklog/files）も同じ。
//    引いたあとのクリックで設備は切り替わらない。読み直しても同じ並び
// ② 選んだタブを Ctrl＋Shift＋→ で 1 つ右へ（サーバーも同じ）
// ③ マスタ管理の「作業実績」: 行の ⋮⋮ と案内。一覧の並び＝タブの並び。最後の行の ⋮⋮ を引いて先頭へ → 一覧が替わり、閉じるとタブも同じ並び
// ④ ⋮⋮ を選んで ↓ で 1 つ下へ
// ⑤ 「表示しない」設備は、タブを並べ替えても一覧の中の位置が動かない
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 800)}`}`); if (!ok) fails.push(name); };
const tabs = (p) => p.$$eval("#llEquipBar [data-equip]", (xs) => xs.map((x) => x.textContent.replace("!", "").trim()));
const selected = (p) => p.$eval("#llEquipBar [aria-selected=true]", (x) => x.textContent.replace("!", "").trim());
const server = (p, all = false) => p.evaluate(async (a) => (await (await fetch(`/api/worklog/files${a ? "?all=1" : ""}`, { cache: "no-store" })).json()).items.map((x) => x.name), all);
const rows = (p) => p.$$eval("#masterSettings .wl-tablelist tbody tr[data-key]", (xs) => xs.map((x) => x.querySelector(".wl-name").value));
/** el を引いて、to の左（axis x）か上（axis y）へ落とす */
async function dragTo(p, from, to, axis) {
  const a = await (await p.$(from)).boundingBox(), b = await (await p.$(to)).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
  const tx = axis === "x" ? b.x + 4 : b.x + b.width / 2, ty = axis === "x" ? b.y + b.height / 2 : b.y + 3;
  await p.mouse.move(a.x + a.width / 2 + (axis === "x" ? -8 : 0), a.y + a.height / 2 + (axis === "y" ? -8 : 0), { steps: 3 });
  await p.mouse.move(tx, ty, { steps: 12 }); await sleep(150);
  if (SHOT) await p.screenshot({ path: path.join(SHOT, `drag-${axis}.png`) });
  await p.mouse.up(); await sleep(900);
}
const move = (list, from, to) => { const x = list.slice(); x.splice(to, 0, x.splice(from, 1)[0]); return x; };

const app = await launch();
try {
  const p = await app.newPage("light", { width: 1728, height: 1152 });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  // ① タブを引く
  const t0 = await tabs(p), sel0 = await selected(p);
  const bar = await p.evaluate(() => ({ sortable: document.querySelector("#llEquipBar").classList.contains("is-sortable"), hint: document.querySelector("#llEquipBar .eq-hint")?.textContent || "" }));
  check("タブの帯に、つかめる印と案内（設備を管理できる人）", bar.sortable && bar.hint.includes("つかんで並べ替え"), bar);
  await dragTo(p, "#llEquipBar [data-equip]:nth-child(6)", "#llEquipBar [data-equip]:nth-child(3)", "x");
  const t1 = await tabs(p), s1 = await server(p);
  check(`6 番目のタブ（${t0[5]}）を引いて 3 番目の前へ → タブもサーバーも同じ並び`, t1.join() === move(t0, 5, 2).join() && s1.join() === t1.join(), { t0, t1, s1 });
  check("引いたあとのクリックで設備は切り替わらない", (await selected(p)) === sel0, { sel0, now: await selected(p) });
  await p.reload(); await p.waitForSelector("#tabWork"); await sleep(600);
  if ((await p.$eval("#tabWork", (x) => x.getAttribute("aria-selected"))) !== "true") await p.click("#tabWork");
  await p.waitForSelector("#llEquipBar [data-equip]"); await sleep(600);
  check("読み直しても同じ並び", (await tabs(p)).join() === t1.join(), await tabs(p));
  // ② Ctrl＋Shift＋→
  await p.focus("#llEquipBar [aria-selected=true]");
  const i2 = (await tabs(p)).indexOf(await selected(p));
  await p.keyboard.press("Control+Shift+ArrowRight"); await sleep(900);
  const t2 = await tabs(p), s2 = await server(p);
  check("選んだタブを Ctrl＋Shift＋→ で 1 つ右へ（サーバーも同じ・設備は選んだまま）", t2.join() === move(t1, i2, i2 + 1).join() && s2.join() === t2.join() && (await selected(p)) === t1[i2], { t1, t2, i2 });
  // ⑤ のための「表示しない」設備（一覧の 4 番目）
  const allBefore = await server(p, true);
  // ③ マスタ管理
  await p.click("#llEquipBar [data-ll-settings]"); await p.waitForSelector("#masterSettings .wl-tablelist [data-wl-grip]"); await sleep(500);
  const r0 = await rows(p), note = await p.$eval("#masterSettings .wl-sorthint", (x) => x.textContent);
  check("マスタ管理の一覧: 行の ⋮⋮ と案内・一覧の並び＝タブの並び", r0.join() === allBefore.join() && note.includes("タブも同じ並び"), { r0, allBefore, note });
  await dragTo(p, "#masterSettings .wl-tablelist tbody tr:last-child [data-wl-grip]", "#masterSettings .wl-tablelist tbody tr:first-child", "y");
  await p.waitForSelector("#masterSettings .wl-tablelist [data-wl-grip]"); await sleep(400);
  const r1 = await rows(p);
  check("最後の行の ⋮⋮ を引いて先頭へ → 一覧が替わる", r1.join() === move(r0, r0.length - 1, 0).join(), { r0, r1 });
  // ④ ⋮⋮ を選んで ↓
  await p.focus("#masterSettings .wl-tablelist tbody tr:first-child [data-wl-grip]");
  await p.keyboard.press("ArrowDown"); await sleep(1200); await p.waitForSelector("#masterSettings .wl-tablelist [data-wl-grip]");
  const r2 = await rows(p);
  check("⋮⋮ を選んで ↓ で 1 つ下へ（選んだまま）", r2.join() === move(r1, 0, 1).join()
    && (await p.evaluate(() => document.activeElement?.closest("tr")?.querySelector(".wl-name")?.value)) === r1[0], { r1, r2 });
  // ⑤ 表示しない設備は動かない: 4 番目を表示しないにしてから、タブで並べ替える
  // 一覧の 4 番目の「表示」を切る（利用者と同じ操作。直すと tpa:worklog-changed でタブを読み直す）
  const hid = r2[3];
  await p.click('#masterSettings .wl-tablelist tbody tr:nth-child(4) .wl-switch'); await sleep(1200);
  await p.waitForSelector("#masterSettings .wl-tablelist [data-wl-grip]");
  await p.click("#masterCloseBtn"); await sleep(1200);   // マスタ管理で直すたびに tpa:worklog-changed でタブを読み直している
  const t5 = await tabs(p);
  check("マスタ管理で並べ替えた並びが、タブにも出る（表示しない設備は出ない）", t5.join() === r2.filter((n) => n !== hid).join(), { t5, r2, hid });
  await dragTo(p, "#llEquipBar [data-equip]:nth-child(1)", "#llEquipBar [data-equip]:nth-child(6)", "x");
  const all5 = await server(p, true);
  check(`表示しない設備（${hid}）は、タブを並べ替えても一覧の 4 番目のまま`, all5.indexOf(hid) === 3 && all5.length === r2.length, { all5, hid });
  if (SHOT) await p.screenshot({ path: path.join(SHOT, "tabs.png") });
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
