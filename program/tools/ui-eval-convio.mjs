// 評価関数（開発用）: マスタの変換表の版 3.43.0（利用者の要望 2026-10）。
//   node program/tools/ui-eval-convio.mjs
// ① メモが無い: 行の「!」の印・行の備考（✎）・表の備考の欄が無い
// ② 条件を消せる: セルを開くと、条件ごとの × が白い面の上で見える（枠と字のコントラスト 3 以上）・押すとその条件だけが外れ、残りは残る
// ③ 書き出す → 取り込む: 書き出したファイルは全部の表・形は {kind: tpa-conversions, items}。中身を変えたファイルを取り込むと、
//    取り込む前に「置き換え・足す」の表の名前が出る・「取り込んで標準にもする」で取り込み、標準が「取り込んだ表」になる・標準に戻すと取り込んだ中身・
//    「同梱に戻す」で同梱のプリセットへ
// 全部合えば終了コード 0。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpa-convio-"));

const app = await launch();
try {
  const p = await app.newPage("light", parseView("1728x1152"));
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
  await p.$eval('#masterTabs [data-tab="conv"]', (b) => b.click()); await p.waitForSelector("[data-cv-save]"); await sleep(400);

  // ① メモが無い
  const memo = await p.evaluate(() => ({ marks: document.querySelectorAll(".cv-note").length, rowNote: document.querySelectorAll("[data-cv-noteed]").length, note: !!document.querySelector("#cvNote") }));
  check("① 行の「!」・行の備考・表の備考が無い", !memo.marks && !memo.rowNote && !memo.note, memo);

  // ② 条件を消す（13 行目の設備 = 課名の表の 3 つの条件のセルに似た形: 管理分類の 4 行目の形状区分〈HOT・2HI〉）
  await p.click('[data-cv-cell="3|形状区分"]'); await sleep(300);
  await p.click("[data-cv-tadd]"); await sleep(200);
  await p.fill('[data-cv-tv="1"]', "4HI板"); await p.press('[data-cv-tv="1"]', "Tab"); await sleep(300);
  const before = await p.$$eval("#masterSettings .cv-test", (xs) => xs.length);
  const look = await p.evaluate(() => {
    const b = document.querySelector('[data-cv-tdel="0"]'), s = getComputedStyle(b), bg = getComputedStyle(b.closest(".cv-celled")).backgroundColor;
    const lum = (c) => { const [r, g, bl] = c.match(/[\d.]+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const ratio = (a, c) => (Math.max(lum(a), lum(c)) + 0.05) / (Math.min(lum(a), lum(c)) + 0.05);
    return { text: ratio(s.color, bg), border: ratio(s.borderTopColor, bg), w: b.getBoundingClientRect().width };
  });
  check("② 条件ごとの × が見える（字のコントラスト 4.5 以上・枠 1.3 以上）", look.text >= 4.5 && look.border >= 1.3 && look.w >= 20, look);
  await p.click('[data-cv-tdel="0"]'); await sleep(300);
  const after = await p.evaluate(() => ({ n: document.querySelectorAll("#masterSettings .cv-test").length, v: document.querySelector('[data-cv-tv="0"]')?.value }));
  check("② × で、その条件だけが外れる（残りは残る）", after.n === before - 1 && after.v === "4HI板", { before, after });

  // ③ 書き出す
  // 保存に渡した名前と中身は TPA.download を包んで受け取る（ヘッドレスのブラウザは、頁に付けないリンクからの保存の名前を「download」にする: ui-eval-profile.mjs と同じ）
  await p.evaluate(() => { const real = TPA.download; TPA.download = (blob, name) => { blob.text().then((t) => { window.__dl = { name, text: t }; }); return real(blob, name); }; });
  await p.click("[data-cv-export]"); await p.waitForFunction(() => window.__dl);
  const got = await p.evaluate(() => window.__dl), file = got.name, doc = JSON.parse(got.text);
  check("③ 書き出したファイル: 名前・形・全部の表", /_変換表_\d{4}-\d{2}-\d{2}\.json$/.test(file) && doc.kind === "tpa-conversions" && doc.items.length >= 8 && !("id" in doc.items[0]), { file, kind: doc.kind, n: doc.items.length });
  // 地取区分を 2 行にし、新しい表を足したファイルを取り込む（標準にもする）
  const ji = doc.items.find((x) => x.name === "地取区分");
  ji.rows = ji.rows.slice(0, 2);
  doc.items = [ji, { name: "試しの表", inputs: [{ name: "x", type: "text", columns: ["x"] }], rows: [{ when: { x: [{ op: "eq", v: ["1"] }] }, out: "一" }], other: "", apply: { mode: "add", column: "試し", place: "end" } }];
  // 試験のブラウザへ渡すファイルの名前は英字（日本語の名前は、選んだ後のファイルが空で届く）
  const mine = path.join(dir, "import.json"); fs.writeFileSync(mine, JSON.stringify(doc));
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click("[data-cv-import]")]);
  await chooser.setFiles(mine); await p.waitForSelector(".cv-imp", { timeout: 5000 }); await sleep(200);
  const pre = await p.$eval(".cv-imp", (x) => x.textContent);
  check("③ 取り込む前に、置き換え・足す表の名前が出る", /置き換え 1/.test(pre) && pre.includes("地取区分") && /足す 1/.test(pre) && pre.includes("試しの表"), pre);
  await p.click("[data-cv-impstd]"); await sleep(900);
  const done = await p.evaluate(() => ({ note: document.querySelector("#cvNotice").textContent, std: document.querySelector(".cv-std").textContent, list: [...document.querySelectorAll("[data-cv-pick] b")].map((b) => b.textContent) }));
  check("③ 取り込み、標準が「取り込んだ表」になる", /置き換え 1・足す 1/.test(done.note) && done.std.includes("取り込んだ表") && done.list.includes("試しの表"), done);
  const d1 = await p.evaluate(async () => (await (await fetch("/api/masters/conversions")).json()).items.find((x) => x.name === "地取区分"));
  check("③ 同じ名前の表は置き換え（地取区分が 2 行）", d1.rows.length === 2 && d1.preset, d1);
  // 同梱に戻す
  await p.click("[data-cv-stdbundled]"); await sleep(800);
  const std = await p.$eval(".cv-std", (x) => x.textContent);
  check("③ 「同梱に戻す」で標準が同梱のプリセット", std.includes("同梱のプリセット"), std);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
