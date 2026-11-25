// 画素の比べ（開発用。版 3.118.2）: 2 つのフォルダの同じ名前の PNG を Chromium の canvas で比べ、違う画素の数と囲み（x・y・幅・高さ）を出す。
//
//   node program/tools/ui-diff.mjs 前のフォルダ 後のフォルダ [出力.json] [--allow 理由の表.json] [--tol 2]
//
// 撮る相手を替えた（Python の開発用サーバー → 窓）ときに、画面が同じかを見る。時計の字（データの時刻・「n:nn の数」・写した時刻）は
// 撮るときに伏せる（ui-harness.mjs の shot・TPA_UI_MASK=1）ので、同じ相手で 2 回撮れば 0 画素になる。
// --allow の表（版 3.118.2 の作った後の採点の割れ C1 で、画像の名前だけの許しをやめた）:
//   {"画像の大きさ 2160x1440": {"名前（.png を除く）": {"why": "理由", "boxes": [[x, y, 幅, 高さ], …], "max": 許す画素の数}}, …}
// 違う画素が全部どれかの囲み（画像の画素の座標）の中にあり、数が max 以下なら「許す」に数える（理由は出力に残す）。囲みの外に 1 画素でも
// 違えば、または max を超えれば「違う」（同じ画像の別の所に出た違いを隠さない）。画像の大きさの節は比べる画像の幅×高さで選ぶ
// （1728×1152・1536×864・1280×720 を表示倍率 125% で撮った 2160x1440・1920x1080・1600x900）。表はリポジトリに置く
// （program/tools/ui-diff-allow/2026-11-stage4c.json。窓と Python の開発用サーバーの違いの理由）。
// --tol n: 色の 4 つの値の差がどれも n 以下の画素は同じに数える（既定 0＝1 でも違えば違う。同じ相手で撮っても、絵の縁の
// にじみが少し違うことがある: 版 3.118.2 の作った後の採点の割れ C7 の直しで、Python 同士の master-sources-join の丸の縁が 7 画素・差 1〜2、
// 1280 の list・headers の絞り込みの漏斗の絵の縁が 2 画素・差 8。窓と Python を比べるときは --tol 8。字が 1px ずれる・色が替わるのは差が大きく残る）。
// 終了コード: 許していない違いが無ければ 0。片方にしか無い画像も違いに数える。PIL に頼らない（Playwright の Chromium だけ）。

import fs from "node:fs";
import path from "node:path";
import { chromium } from "./ui-harness.mjs";

const args = process.argv.slice(2);
const tolAt = args.indexOf("--tol");
const TOL = tolAt >= 0 ? Number(args.splice(tolAt, 2)[1]) : 0;
if (!(TOL >= 0 && TOL < 64)) throw new Error("--tol は 0〜63");
const allowAt = args.indexOf("--allow");
const allowTable = allowAt >= 0 ? JSON.parse(fs.readFileSync(args.splice(allowAt, 2)[1], "utf-8")) : {};
/** 許しの形を確かめる（囲みと上限の無い許し・名前だけの許しは受けない） */
for (const [size, rows] of Object.entries(allowTable)) {
  if (size.startsWith("_")) continue;
  if (!/^\d+x\d+$/.test(size) || typeof rows !== "object") throw new Error(`許しの表の節は画像の大きさ（2160x1440 など）: ${size}`);
  for (const [name, a] of Object.entries(rows)) {
    const ok = a && typeof a.why === "string" && a.why && Array.isArray(a.boxes) && a.boxes.length && a.boxes.every((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
      && Number.isFinite(a.max) && a.max > 0;
    if (!ok) throw new Error(`許しは {why, boxes: [[x, y, 幅, 高さ], …], max}: ${size} ${name}`);
  }
}
const allowOf = (w, h, key) => (allowTable[`${w}x${h}`] || {})[key] || null;
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
/** 2 枚の PNG（base64）と許す囲み → { w, h, diff, box, inside, outside }（大きさが違えば diff は -1）。inside は囲みの中の違う画素・outside は外 */
const compare = (x, y, boxesOf) => page.evaluate(async ([x, y, table, tol]) => {
  const load = (s) => new Promise((done, fail) => { const i = new Image(); i.onload = () => done(i); i.onerror = fail; i.src = `data:image/png;base64,${s}`; });
  const [i1, i2] = await Promise.all([load(x), load(y)]);
  if (i1.width !== i2.width || i1.height !== i2.height) return { w: i1.width, h: i1.height, w2: i2.width, h2: i2.height, diff: -1, box: null, inside: 0, outside: 0 };
  const boxes = table[`${i1.width}x${i1.height}`] || [];
  const c = document.getElementById("c");
  c.width = i1.width; c.height = i1.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
  let diff = 0, inside = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < d1.length; p += 4) {
    if (Math.abs(d1[p] - d2[p]) > tol || Math.abs(d1[p + 1] - d2[p + 1]) > tol || Math.abs(d1[p + 2] - d2[p + 2]) > tol || Math.abs(d1[p + 3] - d2[p + 3]) > tol) {
      diff++;
      const k = p / 4, x = k % c.width, y = (k - x) / c.width;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      if (boxes.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) inside++;
    }
  }
  return { w: c.width, h: c.height, diff, box: diff ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, inside, outside: diff - inside };
}, [x, y, boxesOf, TOL]);

const rows = [];
for (const n of names) {
  const key = n.replace(/\.png$/, "");
  if (!A.has(n) || !B.has(n)) { rows.push({ name: key, only: A.has(n) ? "前だけ" : "後だけ", diff: -1, allowed: "" }); continue; }
  // 画像の大きさごとの、この画像の許す囲み（大きさは比べる中で決まるので、全部の節の囲みを渡す）
  const boxesOf = Object.fromEntries(Object.entries(allowTable).filter(([k]) => !k.startsWith("_")).map(([size, t]) => [size, (t[key] && t[key].boxes) || []]));
  const r = await compare(fs.readFileSync(path.join(a, n)).toString("base64"), fs.readFileSync(path.join(b, n)).toString("base64"), boxesOf);
  const al = r.diff > 0 ? allowOf(r.w, r.h, key) : null;
  // 許すのは、違う画素が全部囲みの中で、上限以下のときだけ
  const ok = al && r.outside === 0 && r.inside <= al.max;
  const over = al && !ok ? (r.outside ? `囲みの外に ${r.outside} 画素` : `囲みの中が ${r.inside} 画素（上限 ${al.max}）`) : "";
  rows.push({ name: key, ...r, ratio: r.diff > 0 ? Math.round((r.diff / (r.w * r.h)) * 1e6) / 1e4 : 0, allowed: ok ? al.why : "", over });
}
await browser.close();
const same = rows.filter((r) => r.diff === 0).length;
const differ = rows.filter((r) => r.diff !== 0);
const unexplained = differ.filter((r) => !r.allowed);
const summary = { a, b, tol: TOL, images: rows.length, same, differ: differ.length, allowed: differ.length - unexplained.length, unexplained: unexplained.length };
for (const r of differ) console.log(`${r.allowed ? "許す" : "違う"} ${r.name} ${r.only || `${r.diff} 画素（${r.ratio}%）`} ${r.box ? JSON.stringify(r.box) : ""}${r.allowed ? ` … ${r.allowed}` : ""}${r.over ? ` … 許しの外: ${r.over}` : ""}`);
console.log(`SUMMARY images=${summary.images} same=${summary.same} differ=${summary.differ} allowed=${summary.allowed} unexplained=${summary.unexplained}`);
if (outArg) fs.writeFileSync(outArg, JSON.stringify({ summary, rows }, null, 1));
process.exit(unexplained.length ? 1 : 0);
