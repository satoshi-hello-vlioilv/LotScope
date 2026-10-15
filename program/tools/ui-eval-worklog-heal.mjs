// 評価関数（開発用）: 作業実績が「読めない」ままにならないか（版 3.33.0。入れた直後に、再起動するまで読めないことがあった）。
//   node program/tools/ui-eval-worklog-heal.mjs
// 画面が作業実績を開いたあとで、サーバーの側だけが変わる（共有のファイルが一瞬見えなかった・ほかの PC やマスタの置き場の切り替えで
// 設備の登録が変わった）。画面は知らせを受けないので、利用者のする操作だけで、開き直さずに一覧が出るかを数える。
// ① 一瞬見えなかったファイルが、また見えるようになった → 何もしなくても（少し待つと）一覧が出る
// ② 同じ形で、マスタ管理の「作業実績」を開いて状態を確かめ、閉じる → すぐ一覧が出る
// ③ 設備の登録が作り直された（キーが変わった。共有のマスタへ置き場を変えたときなど） → マスタ管理を開いて閉じると、同じ設備の一覧が出る
// ④ 同じ形で、何もしなくても（少し待つと）同じ設備の一覧が出る。読めないあいだは「見つかりしだい開きます」と出る
// ⑤ 見ている設備のファイルだけが一瞬見えない → ほかの設備へ移らない（前の写しで一覧は出たまま）。見えたら印が消える
// ⑥ 読めないうちの最初の 30 秒は「待っている」と出す（「読めませんでした」と言わない） ⑦ 30 秒たっても読めなければ「読めませんでした」と理由
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };

/** サーバーの側だけで、作業実績の決まり（ファイル名の決まり）を置く（画面へは知らせない＝ほかの PC・一瞬の不在の代わり） */
const setSetting = (p, key, value) => p.evaluate(async ([k, v]) => {
  const it = (await (await fetch("/api/settings")).json()).items.find((x) => x.key === k);
  const r = await fetch(`/api/settings/${k}`, TPA.json("PUT", { value: v, base_rev: it.rev || 0 }));
  return r.status;
}, [key, value]);
const setPattern = (p, value) => setSetting(p, "work_log.pattern", value);
/** 一覧が出ているか（行の数・知らせの字） */
const state = (p) => p.evaluate(() => ({
  rows: document.querySelectorAll("#llBody tr[data-i]").length,
  note: (document.querySelector("#llNote:not([hidden])")?.textContent || "").replace(/\s+/g, " ").slice(0, 160),
  waiting: !!document.querySelector("#llNote:not([hidden]).is-wait"),
  // 「元: …」の行と案内の行が、別の行に出ているか（版 3.33.0 は字がつながって「…KEN.sqlite3見つかりしだい…」と出た）
  apart: (() => { const n = document.querySelector("#llNote:not([hidden])"), h = n && n.querySelector(".ll-heal"), f = n && n.querySelector(".ll-from");
    return h && f ? h.getBoundingClientRect().top >= f.getBoundingClientRect().bottom - 1 : null; })(),
  equip: document.querySelector('#llEquipBar .eq-chip[aria-selected="true"]')?.textContent || "",
  missing: document.querySelectorAll("#llEquipBar .eq-chip.is-missing").length,
}));
/** 一覧が出るまで待つ（出なければ最後の様子） */
async function until(p, ms) {
  const end = Date.now() + ms;
  let s;
  do { s = await state(p); if (s.rows > 0 && !s.note) return { ok: true, ...s }; await sleep(500); } while (Date.now() < end);
  return { ok: false, ...s };
}
async function openCloseMaster(p) {
  const b = await p.$("[data-ll-settings]");
  if (b) await b.click(); else await p.click("#masterBtn");
  await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(1500);
  await p.click("#masterCloseBtn"); await sleep(300);
}

const app = await launch();
try {
  const page = await app.newPage("light");
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const pattern = await page.evaluate(async () => (await (await fetch("/api/settings")).json()).items.find((x) => x.key === "work_log.pattern").value);

  // ① ② ファイルが一瞬見えない（決まりに合うファイルが 0 件）ときに作業実績を開き、また見えるようになる
  await setPattern(page, "無い_*.sqlite3");
  await page.click("#tabWork"); await sleep(2500);
  const gone = await state(page);
  check("（前提）見えないあいだは、設備が見つからないと出る", gone.rows === 0 && gone.missing > 0, gone);
  await setPattern(page, pattern);
  const self = await until(page, 25000);
  check("① また見えるようになったら、何もしなくても 25 秒までに一覧が出る", self.ok, self);

  await page.click("#tabList"); await sleep(800);
  await setPattern(page, "無い_*.sqlite3");
  await page.click("#tabWork"); await sleep(2500);
  await setPattern(page, pattern);
  await openCloseMaster(page);
  const viaMaster = await until(page, 4000);
  check("② マスタ管理で状態を確かめて閉じると、すぐ一覧が出る", viaMaster.ok, viaMaster);

  // ③ ④ 設備の登録が作り直される（キーが変わる）。画面は前のキーのまま問い合わせる（設備のタブを押して引き直す）
  const rekey = async () => {
    await page.evaluate(async () => {
      const d = await (await fetch("/api/masters/worklog")).json();
      for (const x of d.items) await fetch(`/api/masters/worklog/${x.id}?rev=${x.rev}`, { method: "DELETE" });
      await fetch("/api/masters/worklog/scan", TPA.json("POST", {}));
    });
    await page.click('#llEquipBar .eq-chip[aria-selected="true"]'); await sleep(1500);
    return state(page);
  };
  const before = await until(page, 8000);
  const stale = await rekey();
  check("（前提）前のキーのままでは読めない（登録に無い）と出る", stale.rows === 0 && /登録されていません/.test(stale.note), stale);
  check("（状態が見える）読めないあいだは「見つかりしだい開きます」と出る", /見つかりしだい開きます/.test(stale.note), stale);
  await openCloseMaster(page);
  const after = await until(page, 4000);
  check("③ 登録が作り直されても、マスタ管理を開いて閉じると同じ設備の一覧が出る", after.ok && after.equip === before.equip, { before, after });
  await rekey();
  const healed = await until(page, 15000);
  check("④ 同じ形で、何もしなくても 15 秒までに同じ設備の一覧が出る", healed.ok && healed.equip === before.equip, { before, healed });
  // ⑤ 見ている設備のファイルだけが一瞬見えない（書き手が入れ替えている途中の形: ファイルを横へ動かす）
  //    → ほかの設備へ移らない。前の写しがあるので一覧は出たまま。見えたら印（!）が消える
  const mine = await until(page, 8000);
  const name = mine.equip;
  const folder = await page.evaluate(async () => (await (await fetch("/api/worklog/files")).json()).folder);
  const file = path.join(folder, `実績_${name}.sqlite3`), aside = path.join(folder, `仮_${name}.sqlite3`);
  fs.renameSync(file, aside);
  await sleep(11000);                                   // サーバーがフォルダの中身を覚える 10 秒を過ぎてから
  await page.click("#tabList"); await sleep(600); await page.click("#tabWork"); await sleep(2500);
  const blink = await state(page);
  fs.renameSync(aside, file);
  check("⑤ 見ている設備のファイルが一瞬見えなくても、ほかの設備へ移らない（前の写しで一覧は出たまま）",
    blink.equip.replace("!", "") === name && blink.rows > 0, { name, blink });
  await sleep(11000);
  await page.click("#tabList"); await sleep(600); await page.click("#tabWork");
  const back = await until(page, 8000);
  check("⑤ 見えたら、同じ設備のまま印（!）が消える", back.ok && back.equip === name, { name, back });
  // ⑥ ⑦ 読み込みを待っている／本当に読めなかったを分ける（版 3.34.0。利用者の声: 設備を切り替えると、待てば読めるのに「読めませんでした」が出る）
  //    フォルダに届かない形にして、まだ開いていない設備を開く（前の写しが無いので読めない）
  const folder0 = await page.evaluate(async () => (await (await fetch("/api/settings")).json()).items.find((x) => x.key === "work_log.folder").value);
  await setSetting(page, "work_log.folder", "/無い/実績のフォルダ");
  await sleep(10500);                                   // サーバーがフォルダの中身を覚える 10 秒を過ぎてから
  const fresh = await page.$$eval("#llEquipBar .eq-chip", (cs) => cs.map((c) => c.textContent.replace("!", "")));
  const pick = fresh[fresh.length - 1];
  await page.click(`#llEquipBar .eq-chip:has-text("${pick}")`).catch(async () => { await page.click("#llEquipBar .eq-more"); await page.click(`#llEquipMenu [data-equip]:last-child`); });
  await sleep(3000);
  const early = await state(page);
  check("⑥ 読めないうちの最初の 30 秒は「待っている」と出し、「読めませんでした」とは言わない",
    early.waiting && !/読めませんでした/.test(early.note) && /読み込んで|待って/.test(early.note), early);
  await sleep(30000);
  const late = await state(page);
  check("⑦ 30 秒たっても読めなければ「読めませんでした」と理由を出す（探し直しは続く）",
    !late.waiting && /読めませんでした/.test(late.note) && /届きません/.test(late.note), late);
  check("⑦ 「元: …」の行と「見つかりしだい開きます」の行が別の行に出る", late.apart === true, late);
  await setSetting(page, "work_log.folder", folder0);
  check("頁の誤りが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
