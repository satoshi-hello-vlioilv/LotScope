// 画素の比べ（開発用。版 3.118.2）: 2 つのフォルダの同じ名前の PNG を Chromium の canvas で比べ、違う画素の数と囲み（x・y・幅・高さ）を出す。
//
//   node program/tools/ui-diff.mjs 前のフォルダ 後のフォルダ [出力.json] [--allow 理由の表.json]
//
// 撮る相手を替えた（Python の開発用サーバー → 窓）ときに、画面が同じかを見る。時計の字（データの時刻・「n:nn の数」・写した時刻）は
// 撮るときに伏せる（ui-harness.mjs の shot・TPA_UI_MASK=1）ので、同じ相手で 2 回撮れば 0 画素になる。
// --allow の表 {"名前（.png を除く）": "差を許す理由"} に載った画像は、違っても「許す」に数える（理由は出力に残す）。
// 終了コード: 許していない違いが無ければ 0。片方にしか無い画像も違いに数える。PIL に頼らない（Playwright の Chromium だけ）。

import fs from "node:fs";
import path from "node:path";
import { chromium } from "./ui-harness.mjs";

const args = process.argv.slice(2);
const allowAt = args.indexOf("--allow");
const allow = allowAt >= 0 ? JSON.parse(fs.readFileSync(args.splice(allowAt, 2)[1], "utf-8")) : {};
const [a, b, outArg] = args;
if (!a || !b) {
  console.error("使い方: node program/tools/ui-diff.mjs 前のフォルダ 後のフォルダ [出力.json] [--allow 理由の表.json]");
  process.exit(2);
}
const pngs = (d) => new Set(fs.readdirSync(d).filter((f) => f.endsWith(".png")));
const A = pngs(a), B = pngs(b);
const names = [...new Set([...A, ...B])].sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
/** 2 枚の PNG（base64）→ { w, h, diff, box }（大きさが違えば diff は -1） */
const compare = (x, y) => page.evaluate(async ([x, y]) => {
  const load = (s) => new Promise((done, fail) => { const i = new Image(); i.onload = () => done(i); i.onerror = fail; i.src = `data:image/png;base64,${s}`; });
  const [i1, i2] = await Promise.all([load(x), load(y)]);
  if (i1.width !== i2.width || i1.height !== i2.height) return { w: i1.width, h: i1.height, w2: i2.width, h2: i2.height, diff: -1, box: null };
  const c = document.getElementById("c");
  c.width = i1.width; c.height = i1.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
  let diff = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < d1.length; p += 4) {
    if (d1[p] !== d2[p] || d1[p + 1] !== d2[p + 1] || d1[p + 2] !== d2[p + 2] || d1[p + 3] !== d2[p + 3]) {
      diff++;
      const k = p / 4, x = k % c.width, y = (k - x) / c.width;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  return { w: c.width, h: c.height, diff, box: diff ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}, [x, y]);

const rows = [];
for (const n of names) {
  const key = n.replace(/\.png$/, "");
  if (!A.has(n) || !B.has(n)) { rows.push({ name: key, only: A.has(n) ? "前だけ" : "後だけ", diff: -1, allowed: allow[key] || "" }); continue; }
  const r = await compare(fs.readFileSync(path.join(a, n)).toString("base64"), fs.readFileSync(path.join(b, n)).toString("base64"));
  rows.push({ name: key, ...r, ratio: r.diff > 0 ? Math.round((r.diff / (r.w * r.h)) * 1e6) / 1e4 : 0, allowed: r.diff ? allow[key] || "" : "" });
}
await browser.close();
const same = rows.filter((r) => r.diff === 0).length;
const differ = rows.filter((r) => r.diff !== 0);
const unexplained = differ.filter((r) => !r.allowed);
const summary = { a, b, images: rows.length, same, differ: differ.length, allowed: differ.length - unexplained.length, unexplained: unexplained.length };
for (const r of differ) console.log(`${r.allowed ? "許す" : "違う"} ${r.name} ${r.only || `${r.diff} 画素（${r.ratio}%）`} ${r.box ? JSON.stringify(r.box) : ""}${r.allowed ? ` … ${r.allowed}` : ""}`);
console.log(`SUMMARY images=${summary.images} same=${summary.same} differ=${summary.differ} allowed=${summary.allowed} unexplained=${summary.unexplained}`);
if (outArg) fs.writeFileSync(outArg, JSON.stringify({ summary, rows }, null, 1));
process.exit(unexplained.length ? 1 : 0);
