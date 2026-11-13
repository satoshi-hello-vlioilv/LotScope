// 評価関数（開発用）: 置き場の読めない行の知らせ（版 3.107.0。Rust 化の段 ① の 4 歩目・案 E3＋E4 の画面の部分）。
//   node program/tools/ui-eval-skiprows.mjs [撮る出力フォルダ]
// 開発用サーバーを、手元のマスタに読めない行（名前が数・版が読めない・中身に NaN・id が字）を足して起こし（ui_server.py の TPA_UI_BAD_ROWS）、
// 1728×1152・1536×864・1280×720 で:
// ① ダッシュボードの道具の行に知らせの札「⚠ 読めない行 n」（パネルの知らせ .db-warnb と同じ形）。title に「dashboards.json の … 行目（理由）が読めません」。
//    道具の行が 1 段のまま・札が行からはみ出さない・ほかの操作と重ならない。読める行（ダッシュボード）は今どおり出る
// ② 一覧の共有の書式の面の見出しに同じ札（display_formats.json）。読める書式は今どおり並ぶ
// ③ カードの窓のデザインの選びの横に同じ札（dashboards.json。カードの設計の中身に NaN の行）
// ④ 集計表の組み方の面の見出しに同じ札（pivot_presets.json）
// ⑤ マスタ管理の設備マスタの置き場の帯に「equipment_master.json の n 行目（id が数ではありません（'x'））が読めません」（前は表でない行だけ）
// ⑥ 前は一覧が 500 で出なかった形（名前が数の行）でも、一覧の答えが 200 で skipped を持つ（サーバーの答え）
// 撮る出力フォルダを渡すと、各所の画像（skip-<所>-<大きさ>.png）を置く。全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "";
if (out) fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const shot = async (p, name, clip) => { if (out) await p.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) }); };
/** 札の様子: 見えているか・title・入れ物の中か・ほかの子と重ならないか・入れ物が 1 段か */
const chip = (p, box) => p.evaluate((sel) => {
  const host = document.querySelector(sel); if (!host) return null;
  const c = host.querySelector(".tpa-skip"); if (!c) return { host: true };
  const r = c.getBoundingClientRect(), h = host.getBoundingClientRect(), s = getComputedStyle(c);
  const kids = [...host.children].filter((k) => k !== c && k.offsetParent && !k.contains(c)).map((k) => k.getBoundingClientRect());
  const overlap = kids.some((k) => k.width && k.height && r.left < k.right - 1 && k.left < r.right - 1 && r.top < k.bottom - 1 && k.top < r.bottom - 1);
  return { text: c.textContent, title: c.title, visible: r.width > 0 && r.height > 0, inside: r.left >= h.left - 1 && r.right <= h.right + 1 && r.top >= h.top - 1 && r.bottom <= h.bottom + 1,
           overlap, oneLine: r.height <= 24, font: parseFloat(s.fontSize), pageX: document.documentElement.scrollWidth <= innerWidth + 1, clip: { x: Math.max(0, h.left - 8), y: Math.max(0, h.top - 8), width: Math.min(innerWidth, h.width + 16), height: Math.min(innerHeight - Math.max(0, h.top - 8), h.height + 16 + 160) } };
}, box);

process.env.TPA_UI_BAD_ROWS = "1";
const app = await launch();
try {
  // ⑥ サーバーの答え（前は名前が数の行で一覧が 500）
  const ask = async (u) => { const r = await fetch(app.base + u); return { status: r.status, d: await r.json().catch(() => null) }; };
  for (const [u, file] of [["/api/dashboards", "dashboards"], ["/api/dashboard-sets", "dashboards"], ["/api/masters/formats?source=lot", "display_formats"],
                           ["/api/pivot-presets?source=lot", "pivot_presets"], ["/api/card-forms?source=card:lotlist:x", "dashboards"]]) {
    const { status, d } = await ask(u);
    check(`⑥ ${u} は 200 で skipped を持つ（${file}.json）`, status === 200 && d && Array.isArray(d.skipped) && d.skipped.length > 0, { status, skipped: d && d.skipped });
  }
  for (const view of [parseView("1728x1152"), parseView("1536x864"), parseView("1280x720")]) {
    const tag = `${view.width}x${view.height}`;
    // ① ダッシュボード
    const p = await app.newPage("light", view, { screen: "dash" }).catch(async () => app.newPage("light", view));
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await sleep(800);
    const bar = await chip(p, "#dashBar");
    check(`① ${tag} ダッシュボードの道具の行に札（1 段・はみ出さない・重ならない・11px 以上）`, bar && bar.visible && bar.inside && !bar.overlap && bar.oneLine && bar.font >= 11 && bar.pageX
      && /読めない行 3/.test(bar.text) && /dashboards\.json の .*行目（「名前」が字ではありません（5））/.test(bar.title), bar);
    const barH = await p.evaluate(() => document.querySelector("#dashBar").getBoundingClientRect().height);
    check(`① ${tag} 道具の行の高さは 1 段（56px 以下）`, barH <= 56, barH);
    const panels = await p.evaluate(() => document.querySelector("#dashGrid")?.children.length || 0);
    check(`① ${tag} 読める行のダッシュボードは今どおり出る（パネルがある）`, panels > 0, panels);
    await shot(p, `skip-dash-${tag}`, bar && bar.clip);
    await p.context().close();
    // ② 共有の書式の面（一覧の道具の行の「書式 ▾」）
    const q = await app.newPage("light", view);
    q.on("pageerror", (e) => errors.push(e.message));
    await listChecks(q, tag, errors);
    check(`${tag} 頁の誤りが無い`, errors.length === 0, errors);
    await q.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);

async function listChecks(p, tag) {
  for (const part of [formatsPart, cardPart, presetsPart, masterPart]) {
    try { await part(p, tag); } catch (e) { check(`${tag} ${part.name} を開けた`, false, e.message.split("\n")[0]); await shot(p, `skip-${part.name}-${tag}`); }
    for (let i = 0; i < 3; i++) await p.keyboard.press("Escape");
    await sleep(300);
  }
}

async function formatsPart(p, tag) {
    await p.click("#llFormatBtn"); await p.waitForSelector("#llFormatPanel .fm-head"); await sleep(400);
    const fm = await chip(p, "#llFormatPanel .fm-head");
    const items = await p.evaluate(() => document.querySelectorAll("#llFormatPanel .fm-item").length);
    check(`② ${tag} 共有の書式の面の見出しに札（display_formats.json・はみ出さない・重ならない）`, fm && fm.visible && fm.inside && !fm.overlap && fm.oneLine
      && /display_formats\.json の \d+ 行目（「名前」が字ではありません（5））/.test(fm.title), fm);
    check(`② ${tag} 読める書式は今どおり並ぶ`, items >= 0, items);
    await shot(p, `skip-formats-${tag}`, await p.evaluate(() => { const r = document.querySelector("#llFormatPanel").getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth - Math.max(0, r.left - 8), r.width + 16), height: Math.min(innerHeight - Math.max(0, r.top - 8), r.height + 16) }; }));
}

async function cardPart(p, tag) {
    // ③ カードの窓（行をダブルクリック）
    await p.dblclick("#llBody tr[data-i] td:nth-child(3)"); await sleep(900);
    const cardTools = await p.evaluate(() => { const t = [...document.querySelectorAll(".tpa-skip")].find((x) => x.closest("[class*='lc-'], [class*='lk-'], [class*='cf-']")); return t ? "." + [...t.parentElement.classList].join(".") : ""; });
    const cf = cardTools ? await chip(p, cardTools) : null;
    check(`③ ${tag} カードの窓のデザインの選びの横に札（dashboards.json・はみ出さない・重ならない）`, cf && cf.visible && cf.inside && !cf.overlap && cf.oneLine
      && /dashboards\.json の .*「中身」に数でない値（NaN・Infinity）があります/.test(cf.title), { cardTools, cf });
    await shot(p, `skip-card-${tag}`, cf && cf.clip);
}

async function presetsPart(p, tag) {
    // ④ 集計表の組み方の面
    await p.click('#llViewSwitch [data-pv-view="pivot"]').catch(() => {}); await sleep(1200);
    await p.click("#llPivot [data-pv-qpick]").catch(() => {}); await sleep(900);
    const pv = await chip(p, ".pv-phead");
    check(`④ ${tag} 組み方の面の見出しに札（pivot_presets.json・はみ出さない・重ならない）`, pv && pv.visible && pv.inside && !pv.overlap && pv.oneLine
      && /pivot_presets\.json の .*行目（中身の段（rows）の part が並び・表です）/.test(pv.title), pv);
    await shot(p, `skip-presets-${tag}`, pv && pv.clip);
}

async function masterPart(p, tag) {
    // ⑤ マスタ管理の設備マスタ
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(600);
    await p.evaluate(() => document.querySelector('#masterTabs [data-tab="equipment"]')?.click()); await sleep(900);
    const band = await p.evaluate(() => { const c = document.querySelector("#masterPlace .place-caution, .master-place .place-caution"); return c ? c.textContent : ""; });
    check(`⑤ ${tag} マスタ管理の設備マスタの帯に理由つきの知らせ`, /equipment_master\.json の \d+ 行目（id が数ではありません（'x'））が読めません/.test(band), band);
    await shot(p, `skip-master-${tag}`, await p.evaluate(() => { const r = (document.querySelector(".master-place") || document.body).getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 60), width: innerWidth, height: Math.min(innerHeight - Math.max(0, r.top - 60), r.height + 260) }; }));
}
