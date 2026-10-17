// 評価関数（開発用）: 表示の設定の書き出し（版 3.32.1）。
//   node program/tools/ui-eval-profile.mjs
// ① 名前: 「表示の設定 ▾ → 書き出し…」で出るファイルの名前が「アプリ名_表示の設定_年-月-日.json」（app/brand.json の名前・今日の日付）。
//    中身は品質異常と作業実績の両方の表示なので、片方の画面の名前（品質異常・作業実績）を名乗らない
// ② どの画面から: 品質異常から書き出しても、作業実績から書き出しても、同じ名前
// ③ 中身: kind が tpa-lotlist-display で、items が 1 件以上（{key, value}）。知らせの文に、書き出した名前が出る
// 全部合えば終了コード 0。
import fs from "node:fs";
import { launch, sleep } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const brand = JSON.parse(fs.readFileSync(new URL("../app/brand.json", import.meta.url), "utf-8"));
const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
const want = `${brand.name}_表示の設定_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.json`;

/** 表示の設定のメニューから書き出す → { name, body, msg }。保存に渡した名前と中身は、TPA.download を包んで受け取る
    （ヘッドレスのブラウザは、頁に付けないリンクからの保存の名前を「download」にするので、保存されたファイルの名前では見ない） */
async function exportFrom(p) {
  await p.evaluate(() => {
    window.__dl = null;
    if (!TPA.download.__wrapped) {
      const real = TPA.download;
      TPA.download = Object.assign((blob, name) => { blob.text().then((t) => { window.__dl = { name, text: t }; }); return real(blob, name); }, { __wrapped: true });
    }
  });
  await p.click("#llProfileBtn"); await p.waitForSelector('#llProfileMenu [data-act="export"]');
  await p.click('#llProfileMenu [data-act="export"]');
  await p.waitForFunction(() => window.__dl);
  const dl = await p.evaluate(() => window.__dl);
  const msg = await p.$eval("#llProfileMsg", (x) => x.textContent);
  await p.keyboard.press("Escape");
  return { name: dl.name, body: JSON.parse(dl.text), msg };
}

const app = await launch();
try {
  const page = await app.newPage("light");
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  // 表示の設定を 1 つ持たせる（まっさらな PC は書き出す物が 0 件）: 重量 ▼ で並べる
  await page.evaluate(() => TPA.local.set("tpa.lotlist.sorts.v1", { "仕掛": [{ column: "重量", dir: "desc" }] }));
  const list = await exportFrom(page);
  check(`① 品質異常から: 名前が「${want}」`, list.name === want, list.name);
  check("① 片方の画面の名前を名乗らない", !/品質異常|作業実績/.test(list.name), list.name);
  check("③ 中身: kind が tpa-lotlist-display・items が 1 件以上（key と value）",
    list.body.kind === "tpa-lotlist-display" && Array.isArray(list.body.items) && list.body.items.length > 0
      && list.body.items.every((x) => typeof x.key === "string" && typeof x.value === "string"), { kind: list.body.kind, n: list.body.items?.length });
  check("③ 知らせの文に、書き出した名前が出る", list.msg.includes(want), list.msg);
  await page.click("#tabWork"); await page.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  const work = await exportFrom(page);
  check("② 作業実績から書き出しても同じ名前", work.name === want, work.name);
  check("頁の誤りが無い", !errors.length, errors);
  await page.context().close();
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
