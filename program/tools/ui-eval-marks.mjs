// 評価関数（開発用）: 色付け（条件付き書式）と、ロット番号の横の虫眼鏡（版 3.21.0）。
//   node program/tools/ui-eval-marks.mjs
// 色付け
//   ① 面で「不良名 ＝ 汚れ」を作る → 行は減らない・色の付いたセルは不良名の列で字が「汚れ」のセルとちょうど同じ・凡例の数はサーバーで絞った件数
//   ②「列で絞り込む」で 重量 ≧ 3000 を打ち「色を付ける」→ 絞り込みは外れ（全件）・色の付いた重量のセルは全部 3000 以上、付いていないのは 3000 未満か数でない
//   ③ 凡例の札で消す → 色が消える／付ける → 戻る ④ 当てる所を「行全体」→ 色の付いた行の数＝①のセルの数
//   ⑤ 開き直しても残る ⑥ 設備でまとめて（画面が行を並べ替える）も、色は「汚れ」のセルにだけ付く
//   ⑩ Excel に出力: 全件のうち、塗られた不良名のセルがちょうど「汚れ」のセル（数はサーバーで絞った件数）
// 虫眼鏡
//   ⑦ ロット番号の字のすぐ横（字と高さが揃う）・番号も虫眼鏡も切れない（列が虫眼鏡のぶん広い）
//   ⑧ 押すと WaveLog と同じ URL（その行のロット番号と鋳造番号の linkkey・既定のタブ 1＝進度情報）で開き、ロット番号を写す。
//      計算へ移らない（版 3.21.1。前は LotDsp の窓を操作していた） ⑨ 機能を切ると消える
// 全部合えば終了コード 0。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, openActive, sleep } from "./ui-harness.mjs";

// .xlsx の 1 枚目のシート → [[値, 書式の番号], …] の行の並び（Python の標準の zipfile と xml で読む）
const READ = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as ET
m = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
z = zipfile.ZipFile(sys.argv[1])
out = []
for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(m + "row"):
    row = {}
    for c in r.iter(m + "c"):
        t = c.find(m + "is/" + m + "t"); v = c.find(m + "v")
        row["".join(ch for ch in c.get("r") if ch.isalpha())] = [t.text if t is not None else v.text if v is not None else "", c.get("s") or "0"]
    out.append(row)
print(json.dumps(out, ensure_ascii=False))`;

const app = await launch();
let ok = false;
const out = {};
try {
  const p = await app.newPage("light");
  const total = await p.evaluate(async () => (await (await fetch("/api/lotlist?page_size=1")).json()).count);
  const count = () => p.$eval("#llCount", (x) => +x.textContent.replace(/[^0-9]/g, ""));
  const settle = async () => { await sleep(300); await p.waitForFunction(() => !document.querySelector("#lotListScreen").classList.contains("is-loading")); await sleep(500); };
  /** 列 c のセル: [字, 色が付いているか] */
  const cells = (c) => p.evaluate((col) => {
    const at = [...document.querySelectorAll("#llHead tr:first-child th")].findIndex((th) => th.dataset.col === col);
    // 比べるのは先頭の 60 行（描く行の数は見える所の高さで変わる: 見出しの段の数でも 1 行ずれる。色付けの正しさだけを比べる）
    return [...document.querySelectorAll("#llBody tr[data-i]")].filter((tr) => +tr.dataset.i < 60).map((tr) => [tr.children[at].textContent.trim(), tr.children[at].classList.contains("mk-cell")]);
  }, c);
  const server = (f) => p.evaluate(async (fl) => (await (await fetch("/api/lotlist?page_size=1&filters=" + encodeURIComponent(JSON.stringify(fl)))).json()).count, f);

  // ① 面で作る
  await p.click("#llMarkBtn"); await sleep(300);
  await p.selectOption("#llMarkMenu .mk-cond [data-c-col]", "不良名"); await sleep(200);
  await p.selectOption("#llMarkMenu .mk-cond [data-c-op]", "eq"); await sleep(200);
  await p.fill("#llMarkMenu .mk-cond [data-c-val]", "汚れ");
  await p.click("#llMarkMenu [data-mk-make]"); await settle();
  await p.keyboard.press("Escape");
  const c1 = await cells("不良名");
  const hit1 = c1.filter(([, m]) => m).length;
  out.one = { count: await count(), total, hit: hit1, wrong: c1.filter(([t, m]) => m !== (t === "汚れ")).length,
    legend: await p.$eval("#llMarkSum .mk-chip i", (x) => +x.textContent.replace(/[^0-9]/g, "")), want: await server([{ column: "不良名", op: "eq", value: "汚れ" }]) };
  const ok1 = out.one.count === total && hit1 > 0 && out.one.wrong === 0 && out.one.legend === out.one.want;

  // ② 列で絞り込む → 色を付ける
  await p.click("#llAdhocToggle"); await sleep(200);
  await p.selectOption("#llAdhocColumn", "重量"); await p.selectOption("#llAdhocOp", "gte");
  await p.fill("#llAdhocValue", "3000"); await p.keyboard.press("Enter"); await settle();
  const narrowed = await count();
  await p.click("#llAdhocPaint"); await settle();
  const c2 = await cells("重量");
  const num = (t) => (/^-?[\d.]+(e-?\d+)?$/i.test(t) ? Number(t) : NaN);
  out.two = { narrowed, count: await count(), hit: c2.filter(([, m]) => m).length,
    wrong: c2.filter(([t, m]) => (m ? !(num(t) >= 3000) : num(t) >= 3000 && !t.endsWith("..."))).length, adhocValue: await p.inputValue("#llAdhocValue") };
  const ok2 = narrowed < total && out.two.count === total && out.two.hit > 0 && out.two.wrong === 0 && out.two.adhocValue === "";

  // ③ 凡例の札で消す／付ける
  await openActive(p, "marks"); await p.click("#llMarkSum .mk-chip >> nth=0"); await settle();
  const offHit = (await cells("不良名")).filter(([, m]) => m).length;
  await openActive(p, "marks"); await p.click("#llMarkSum .mk-chip >> nth=0"); await settle();
  const onHit = (await cells("不良名")).filter(([, m]) => m).length;
  out.three = { offHit, onHit };
  const ok3 = offHit === 0 && onHit === hit1;

  // ④ 当てる所を行全体に
  await p.click("#llMarkBtn"); await sleep(300);
  await p.selectOption("#llMarkMenu .mk-item >> nth=0 >> [data-mk-target]", "row"); await settle();
  await p.keyboard.press("Escape");
  out.four = { rows: await p.$$eval("#llBody tr.mk-row", (x) => x.filter((tr) => +tr.dataset.i < 60).length) };
  const ok4 = out.four.rows === hit1;

  // ⑤ 開き直す
  await p.evaluate(() => TPA.saveUiState());
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await settle();
  out.five = { rows: await p.$$eval("#llBody tr.mk-row", (x) => x.filter((tr) => +tr.dataset.i < 60).length), chips: await p.$$eval("#llMarkSum .mk-chip", (x) => x.length) };
  const ok5 = out.five.rows === hit1 && out.five.chips === 2;

  // ⑥ 設備でまとめる（画面が行を並べ替える）: 行全体を元のセルに戻して確かめる
  await p.click("#llMarkBtn"); await sleep(300);
  await p.selectOption("#llMarkMenu .mk-item >> nth=0 >> [data-mk-target]", "cells"); await settle();
  await p.keyboard.press("Escape");
  await p.click("#llViewBtn"); await sleep(300);
  await p.selectOption("#llLvAdd", "設備"); await settle();
  await p.keyboard.press("Escape");
  const c6 = await cells("不良名");
  out.six = { hit: c6.filter(([, m]) => m).length, wrong: c6.filter(([t, m]) => m !== (t === "汚れ")).length };
  const ok6 = out.six.hit > 0 && out.six.wrong === 0;

  // ⑩ Excel に出力（全件。塗りは画面と同じ組・同じ優先）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-"));
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.click("#llExcelBtn")]);
  const file = path.join(dir, dl.suggestedFilename()); await dl.saveAs(file);
  const sheet = JSON.parse(execFileSync("python3", ["-c", READ, file], { encoding: "utf8", maxBuffer: 64 << 20 }));
  const col = Object.keys(sheet[0]).find((k) => sheet[0][k][0] === "不良名");
  const body = sheet.slice(1).map((r) => r[col] || ["", "0"]);
  out.ten = { rows: body.length, painted: body.filter(([, st]) => st !== "0").length, wrong: body.filter(([v, st]) => (st !== "0") !== (v === "汚れ")).length, want: out.one.want };
  const ok10 = out.ten.rows === total && out.ten.painted === out.one.want && out.ten.wrong === 0;

  // ⑦ 虫眼鏡の置き場
  await p.evaluate(() => { localStorage.clear(); });
  const lens = await app.newPage("light");
  const place = await lens.$$eval("#llBody .ll-lotcol", (tds) => tds.filter((td) => td.querySelector(".ll-lot")).map((td) => {
    const n = td.querySelector(".ll-lot"), l = td.querySelector(".ll-lens"), c = td.getBoundingClientRect();
    if (!l) return { missing: true };
    const a = n.getBoundingClientRect(), b = l.getBoundingClientRect();
    return { gap: b.left - a.right, mid: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2), cut: n.scrollWidth > n.clientWidth + 1 || b.right > c.right + 0.5 };
  }));
  out.seven = { lenses: place.length, missing: place.filter((x) => x.missing).length, far: place.filter((x) => !x.missing && !(x.gap >= 0 && x.gap <= 8)).length,
    tilt: place.filter((x) => !x.missing && x.mid > 3).length, cut: place.filter((x) => x.cut).length, hint: await lens.$eval(".ll-lothint", (x) => x.textContent) };
  const ok7 = place.length > 0 && !out.seven.missing && !out.seven.far && !out.seven.tilt && !out.seven.cut && out.seven.hint.includes("LotDsp を開くだけ");

  // ⑧ 押す → WaveLog と同じ URL で開き、ロット番号を写す（開く先と写しは作り物で受ける）
  await lens.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; };
    window.__copied = ""; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
    state.config = Object.assign({}, state.config, { lotdsp_url: "http://nlmfangyweb1a/LotDspWeb/" }); });
  const row = await lens.$eval("#llBody tr[data-i] .ll-lens", (b) => ({ lot: b.dataset.lens, cast: b.dataset.cast }));
  const castShown = await lens.evaluate(() => { const at = [...document.querySelectorAll("#llHead th")].findIndex((th) => th.dataset.col === "鋳造番号");
    return document.querySelector("#llBody tr[data-i]").children[at].textContent.trim(); });
  await lens.click("#llBody tr[data-i] .ll-lens"); await sleep(500);
  const field = (v) => String(v || "").slice(0, 7).padEnd(7, " ");
  const want = `http://nlmfangyweb1a/LotDspWeb/#/lotdsp?linkkey=${encodeURIComponent(field(row.lot) + "   " + field(row.cast))}&tab=1`;
  out.eight = { row, castShown, opened: await lens.evaluate(() => window.__opened), copied: await lens.evaluate(() => window.__copied),
    flash: await lens.$eval("#llFlash", (x) => x.textContent), stay: await lens.$eval("#lotListScreen", (x) => !x.classList.contains("hidden")), want };
  const ok8 = !!row.cast && row.cast === castShown && out.eight.opened.length === 1 && out.eight.opened[0] === want && out.eight.copied === row.lot
    && out.eight.flash.includes(row.lot) && out.eight.stay;

  // ⑨ 機能を切る
  await lens.click("#llViewBtn"); await sleep(300);
  await lens.click("#llFeatLens"); await sleep(400);
  await lens.keyboard.press("Escape");
  out.nine = { lenses: await lens.$$eval("#llBody .ll-lens", (x) => x.length), hint: await lens.$eval(".ll-lothint", (x) => x.textContent) };
  const ok9 = out.nine.lenses === 0 && !out.nine.hint.includes("LotDsp");

  const each = { ok1, ok2, ok3, ok4, ok5, ok6, ok7, ok8, ok9, ok10 };
  ok = Object.values(each).every(Boolean);
  console.log(JSON.stringify(out), JSON.stringify(each), ok ? "OK" : "NG");
} finally {
  await app.close();
}
process.exit(ok ? 0 : 1);
