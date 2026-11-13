// 評価関数（開発用）: 置き場の読めない行の知らせ（版 3.107.0。Rust 化の段 ① の 4 歩目・案 E3＋E4 の画面の部分と、作った後の採点の直し）。
//   node program/tools/ui-eval-skiprows.mjs [撮る出力フォルダ]
// 開発用サーバーを、手元のマスタに読めない行（版が読めない・中身に NaN・id が字）と、型だけが違う行（名前が数）を足して起こし
// （ui_server.py の TPA_UI_BAD_ROWS）、1728×1152・1536×864・1280×720 で:
// ① ダッシュボードの道具の行に「⚠ 保存したダッシュボード・ダッシュボードのセットの読めない行 2」の札（.db-warnb の形・押せるボタン）。1 段・はみ出さない・重ならない
// ② 札を押す（Enter でも）と理由の面（TPA.menu の形）が開き、何行目・生の値の要約・理由を言う。マスタを直せる人には × の行（消す）、
//    一般ユーザーには「管理者（マスタを直せる人）に知らせてください」（権限で言葉を分ける）
// ③ 数は今の面の元に当たる行だけ: 共有の書式の面（品質）は品質の行だけを数え、作業実績の行は面の「ほかの画面の行」で言う。カードはカードの設計の行だけ
// ④ 組み方の面の見出しに札（pivot_presets.json）
// ⑤ マスタ管理の設備マスタの置き場の帯（押すと同じ面）・面から読めない行を消すと帯から消える（前に画面で消せた行は今も消せる）
// ⑥ 型だけが違う行（名前が数の書式・ダッシュボード）は隔てずに一覧に出て、直せる（PUT が 200。作った後の採点の割れ 1）。前は名前が数で一覧が 500
// ⑦ 版 3.108.0: マスタ管理の帯の札もほかの 4 か所と同じ「⚠ 設備マスタの読めない行 2」（TPA.skipWhat の 1 か所の言葉）。id が字の行も
//    何行目かで消す道（/api/masters/rows/…）で面から消せる（前は理由を言うだけ）。マスタ管理の中で開いた一般ユーザーの面は
//    「マスタ管理か…で直せます」と言わず「管理者がこの画面で消すか…」と言う
// 撮る出力フォルダを渡すと、各所の画像（skip-<所>-<大きさ>.png。面を開いた所は skip-<所>-open-<大きさ>.png）を置く。全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "";
if (out) fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 500)}`}`); if (!ok) fails.push(name); };
const shot = async (p, name, clip) => { if (out) await p.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) }).catch(() => {}); };
/** 札の様子: 押せるボタンか・入れ物の中か・ほかの子と重ならないか・1 段か */
const chip = (p, box) => p.evaluate((sel) => {
  const host = document.querySelector(sel); if (!host) return null;
  const c = host.querySelector(".tpa-skip"); if (!c) return { host: true };
  const r = c.getBoundingClientRect(), h = host.getBoundingClientRect(), s = getComputedStyle(c);
  const kids = [...host.children].filter((k) => k !== c && k.offsetParent && !k.contains(c)).map((k) => k.getBoundingClientRect());
  const overlap = kids.some((k) => k.width && k.height && r.left < k.right - 1 && k.left < r.right - 1 && r.top < k.bottom - 1 && k.top < r.bottom - 1);
  return { text: c.textContent, button: c.tagName === "BUTTON", visible: r.width > 0 && r.height > 0, inside: r.left >= h.left - 1 && r.right <= h.right + 1 && r.top >= h.top - 1 && r.bottom <= h.bottom + 1,
           overlap, oneLine: r.height <= 24, font: parseFloat(s.fontSize), pageX: document.documentElement.scrollWidth <= innerWidth + 1,
           clip: { x: Math.max(0, h.left - 8), y: Math.max(0, h.top - 8), width: Math.min(innerWidth - Math.max(0, h.left - 8), h.width + 16), height: Math.min(innerHeight - Math.max(0, h.top - 8), h.height + 16 + 160) } };
}, box);
/** 札を押して開いた面の中身（頭・まとまり・項目と押せるか） */
const openMenu = async (p, sel, how = "click") => {
  if (how === "enter") { await p.focus(`${sel} .tpa-skip`); await p.keyboard.press("Enter"); } else await p.click(`${sel} .tpa-skip`);
  await sleep(300);
  return p.evaluate(() => {
    const m = document.querySelector(".tpa-menu"); if (!m) return null;
    const r = m.getBoundingClientRect();
    return { head: m.querySelector(".tm-head")?.textContent || "", groups: [...m.querySelectorAll(".tm-group")].map((g) => g.textContent),
             items: [...m.querySelectorAll("button[role=menuitem]")].map((b) => ({ text: b.textContent, title: b.title, disabled: b.disabled })),
             inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, clip: { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 40), width: Math.min(innerWidth - Math.max(0, r.left - 8), r.width + 16), height: Math.min(innerHeight - Math.max(0, r.top - 40), r.height + 56) } };
  });
};
const closeMenu = async (p) => { await p.keyboard.press("Escape"); await sleep(200); };
/** 開いた面の字: 切れ（scrollWidth ＞ clientWidth）とコントラスト（項目の字・下の小さな字。押せない項目も） */
const menuText = (p) => p.evaluate(() => {
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; } return "rgb(255,255,255)"; };
  const cr = (el) => { const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const m = document.querySelector(".tpa-menu"); if (!m) return null;
  const parts = [...m.querySelectorAll(".tm-head, button[role=menuitem] > span, button[role=menuitem] small")];
  const cut = parts.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 40));
  const low = parts.filter((e) => cr(e) < 4.5 || parseFloat(getComputedStyle(e.closest("button") || e).opacity) < 1).map((e) => `${e.textContent.slice(0, 30)} ${cr(e).toFixed(2)}`);
  return { cut, low };
});
/** 札の形（色・角・字の大きさ・高さ） */
const chipShape = (p, sel) => p.evaluate((s) => { const c = document.querySelector(`${s} .tpa-skip`); if (!c) return null; const k = getComputedStyle(c);
  return [k.backgroundColor, k.borderTopColor, k.borderRadius, k.fontSize, k.fontWeight, Math.round(c.getBoundingClientRect().height)].join(" "); }, sel);
const SHAPES = new Set();

process.env.TPA_UI_BAD_ROWS = "1";
const app = await launch();
try {
  // ⑥ サーバーの答え: 型だけが違う行は一覧に出て直せる・読めない行は skipped（今の面の元・道の id・要約つき）
  const ask = async (u, init) => { const r = await fetch(app.base + u, init); return { status: r.status, d: await r.json().catch(() => null) }; };
  const fm = await ask("/api/masters/formats?source=lot");
  check("⑥ 名前が数の書式は一覧に出る（名前は str() の字 \"5\"）", fm.status === 200 && fm.d.items.some((x) => x.name === "5" && x.id === 900), fm.d && fm.d.items.map((x) => x.name));
  check("⑥ 読めない行は skipped（何行目・理由・要約・元・id）", fm.d && fm.d.skipped.some((s) => s.id === 901 && s.source === "lot" && /版（rev）が読めません/.test(s.why) && /版の読めない書式/.test(s.summary)), fm.d && fm.d.skipped);
  const put = await ask("/api/masters/formats/900", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "直した書式" }) });
  check("⑥ 名前が数の書式を直せる（PUT 200）", put.status === 200 && put.d.name === "直した書式", put);
  const dash = await ask("/api/dashboards");
  check("⑥ 名前が数のダッシュボードは一覧に出る", dash.status === 200 && dash.d.items.some((x) => x.id === 900 && x.name === "5"), dash.status);
  for (const view of [parseView("1728x1152"), parseView("1536x864"), parseView("1280x720")]) {
    const tag = `${view.width}x${view.height}`;
    const errors = [];
    // ① ② ダッシュボード
    const p = await app.newPage("light", view, { screen: "dash" }).catch(async () => app.newPage("light", view));
    p.on("pageerror", (e) => errors.push(e.message));
    await sleep(800);
    const bar = await chip(p, "#dashBar");
    check(`① ${tag} ダッシュボードの道具の行に押せる札（何の行かを言う・数は今の面の 2・1 段・はみ出さない・重ならない・11px 以上）`,
      bar && bar.button && bar.visible && bar.inside && !bar.overlap && bar.oneLine && bar.font >= 11 && bar.pageX && bar.text === "⚠ ダッシュボードの読めない行 2", bar);
    SHAPES.add(await chipShape(p, "#dashBar"));
    const barH = await p.evaluate(() => document.querySelector("#dashBar").getBoundingClientRect().height);
    check(`① ${tag} 道具の行の高さは 1 段（56px 以下）`, barH <= 56, barH);
    await shot(p, `skip-dash-${tag}`, bar && bar.clip);
    const m1 = await openMenu(p, "#dashBar", "enter");
    const t1 = await menuText(p);
    check(`② ${tag} 面の字が切れない・コントラスト 4.5 以上（直せる人）`, t1 && !t1.cut.length && !t1.low.length, t1);
    check(`② ${tag} 札を Enter で押すと理由の面（何の行か・何行目・要約・理由・消す・ほかの画面の行・画面に収まる）`, m1 && m1.inView && /保存したダッシュボード・ダッシュボードのセットの読めない行（dashboards\.json）/.test(m1.head)
      && m1.items.some((x) => /行目 id 903・名前 '版の読めないダッシュボード'/.test(x.text) && /保存したダッシュボード・版（rev）が読めません/.test(x.title) && !x.disabled)
      && m1.groups.includes("ほかの画面の行") && m1.items.some((x) => /壊れたカード/.test(x.text)), m1);
    await shot(p, `skip-dash-open-${tag}`, m1 && m1.clip);
    await closeMenu(p);
    // 一般ユーザーの言葉（権限で分ける: マスタを直せない人）
    await p.evaluate(() => { TPA.me = { ...(TPA.me || {}), canEditFieldMaster: false }; });
    const m2 = await openMenu(p, "#dashBar");
    const t2 = await menuText(p);
    check(`② ${tag} 面の字が切れない・コントラスト 4.5 以上（一般ユーザー・押せない項目も）`, t2 && !t2.cut.length && !t2.low.length, t2);
    check(`② ${tag} 一般ユーザーには「管理者に知らせてください」と消す行を出さない`, m2 && m2.items.some((x) => /管理者（マスタを直せる人）に知らせてください/.test(x.text)) && m2.items.filter((x) => /行目/.test(x.text)).every((x) => x.disabled), m2);
    await shot(p, `skip-dash-user-${tag}`, m2 && m2.clip);
    await closeMenu(p);
    await p.context().close();
    // ③ ④ ⑤ 一覧の画面
    const q = await app.newPage("light", view);
    q.on("pageerror", (e) => errors.push(e.message));
    for (const part of [formatsPart, cardPart, presetsPart, masterPart]) {
      try { await part(q, tag); } catch (e) { check(`${tag} ${part.name} を開けた`, false, e.message.split("\n")[0]); await shot(q, `skip-${part.name}-${tag}`); }
      for (let i = 0; i < 3; i++) await q.keyboard.press("Escape");
      await sleep(300);
    }
    check(`${tag} 頁の誤りが無い`, errors.length === 0, errors);
    check(`${tag} 札の形が 4 か所で同じ（ダッシュボード・書式・組み方・マスタ管理の帯。カードは今の表に当たる行が無い）`, SHAPES.size === 1 && !SHAPES.has(null), [...SHAPES]);
    SHAPES.clear();
    await q.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);

async function formatsPart(p, tag) {
  await p.click("#llFormatBtn"); await p.waitForSelector("#llFormatPanel .fm-head"); await sleep(400);
  const fm = await chip(p, "#llFormatPanel .fm-head");
  check(`③ ${tag} 共有の書式の面の札は品質の行だけを数える（1）・はみ出さない・重ならない`, fm && fm.button && fm.visible && fm.inside && !fm.overlap && fm.oneLine
    && fm.text === "⚠ 共有の書式の読めない行 1", fm);
  SHAPES.add(await chipShape(p, "#llFormatPanel .fm-head"));
  await shot(p, `skip-formats-${tag}`, await p.evaluate(() => { const r = document.querySelector("#llFormatPanel").getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth - Math.max(0, r.left - 8), r.width + 16), height: Math.min(innerHeight - Math.max(0, r.top - 8), r.height + 16) }; }));
  const m = await openMenu(p, "#llFormatPanel .fm-head");
  check(`③ ${tag} 面に作業実績の行は「ほかの画面の行」で出る`, m && m.groups.includes("ほかの画面の行") && m.items.some((x) => /作業実績の壊れた書式/.test(x.text)), m);
  await closeMenu(p);
}

async function cardPart(p, tag) {
  await p.dblclick("#llBody tr[data-i] td:nth-child(3)"); await sleep(900);
  const sel = await p.evaluate(() => { const t = [...document.querySelectorAll(".tpa-skip")].find((x) => x.closest("[class*='lc-'], [class*='lk-'], [class*='cf-']")); return t ? "." + [...t.parentElement.classList].join(".") : ""; });
  const cf = sel ? await chip(p, sel) : null;
  // カードの面の元（card:lotlist:…）に当たる読めない行は無いので札は出ない（前は dashboards.json の全部の行を数えて「3」）
  check(`③ ${tag} カードの窓は今の表のカードの設計の行だけを数える（当たる行が無いので札を出さない）`, !cf, { sel, cf });
  await shot(p, `skip-card-${tag}`, await p.evaluate(() => { const t = document.querySelector("[data-cf=pick]"); if (!t) return undefined; const r = t.closest("div").getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 8), width: innerWidth, height: Math.min(80, innerHeight - Math.max(0, r.top - 8)) }; }));
}

async function presetsPart(p, tag) {
  await p.click('#llViewSwitch [data-pv-view="pivot"]').catch(() => {}); await sleep(1200);
  await p.click("#llPivot [data-pv-qpick]").catch(() => {}); await sleep(900);
  const pv = await chip(p, ".pv-phead");
  check(`④ ${tag} 組み方の面の見出しに押せる札（pivot_presets.json・はみ出さない・重ならない）`, pv && pv.button && pv.visible && pv.inside && !pv.overlap && pv.oneLine
    && pv.text === "⚠ 組み方の読めない行 1", pv);
  SHAPES.add(await chipShape(p, ".pv-phead"));
  await shot(p, `skip-presets-${tag}`, pv && pv.clip);
}

async function masterPart(p, tag) {
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(600);
  await p.evaluate(() => document.querySelector('#masterTabs [data-tab="equipment"]')?.click()); await sleep(900);
  const band = await p.evaluate(() => {
    const c = document.querySelector(".master-place .tpa-skip"), go = document.querySelector("#masterPlaceGo"); if (!c) return null;
    const a = c.getBoundingClientRect(), b = go.getBoundingClientRect();
    return { text: c.textContent, title: c.title, button: c.tagName === "BUTTON", oneLine: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 8 };
  });
  check(`⑤⑦ ${tag} マスタ管理の設備マスタの帯に押せる札（何の行かを言う・1 段・「マスタの置き場 ›」と同じ段・理由は title と面）`, band && band.button && band.oneLine
    && band.text === "⚠ 設備マスタの読めない行 2"
    && /equipment_master\.json の \d+ 行目（id が数ではありません（'x'））・\d+ 行目（数でない値（NaN・Infinity）があります）が読めません/.test(band.title), band);
  const bandLine = await p.evaluate(() => { const c = document.querySelector(".master-place .tpa-skip"), h = document.querySelector(".master-place"); if (!c || !h) return null;
    const r = c.getBoundingClientRect(), b = h.getBoundingClientRect(); return { chipH: Math.round(r.height), bandH: Math.round(b.height), inside: r.right <= b.right + 1, pageX: document.documentElement.scrollWidth <= innerWidth + 1 }; });
  check(`⑦ ${tag} 帯の札が 1 段（高さ 24px 以下・帯からはみ出さない・横に送らない）`, bandLine && bandLine.chipH <= 24 && bandLine.inside && bandLine.pageX, bandLine);
  SHAPES.add(await chipShape(p, ".master-place"));
  await shot(p, `skip-master-${tag}`, await p.evaluate(() => { const r = (document.querySelector(".master-place") || document.body).getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 60), width: innerWidth, height: Math.min(innerHeight - Math.max(0, r.top - 60), r.height + 260) }; }));
  await p.click(".master-place .tpa-skip"); await sleep(300);
  const t3 = await menuText(p);
  check(`⑤ ${tag} マスタ管理の面の字が切れない・コントラスト 4.5 以上`, t3 && !t3.cut.length && !t3.low.length, t3);
  const m = await p.evaluate(() => { const m = document.querySelector(".tpa-menu"); return m ? [...m.querySelectorAll("button[role=menuitem]")].map((b) => ({ text: b.textContent, disabled: b.disabled })) : null; });
  check(`⑤⑦ ${tag} 帯を押すと面: id で引ける行（902）も id が字の行も消せる（何行目かで消す道）`, m && m.some((x) => /id 902/.test(x.text) && !x.disabled) && m.some((x) => /id 'x'/.test(x.text) && !x.disabled)
    && m.some((x) => /× の行は押すと消せます/.test(x.text)), m);
  await shot(p, `skip-master-open-${tag}`);
  await closeMenu(p);
  // ⑦ マスタ管理の中で開いた一般ユーザーの面（もうマスタ管理の中にいるので「マスタ管理か…」と言わない）
  await p.evaluate(() => { window.__me = TPA.me; TPA.me = { ...(TPA.me || {}), canEditFieldMaster: false }; });
  await p.click(".master-place .tpa-skip"); await sleep(300);
  const mu = await p.evaluate(() => { const m = document.querySelector(".tpa-menu"); return m ? [...m.querySelectorAll("button[role=menuitem]")].map((b) => ({ text: b.textContent, title: b.title, disabled: b.disabled })) : null; });
  const tu = await menuText(p);
  check(`⑦ ${tag} マスタ管理の中の一般ユーザーの面は「この画面で消すか」と言い「マスタ管理か」と言わない・消す行を出さない`, mu
    && mu.some((x) => /管理者（マスタを直せる人）に知らせてください/.test(x.text) && /管理者がこの画面で消すか/.test(x.text + x.title) && !/マスタ管理か/.test(x.text + x.title))
    && mu.filter((x) => /行目/.test(x.text)).every((x) => x.disabled), mu);
  check(`⑦ ${tag} 一般ユーザーの面の字が切れない・コントラスト 4.5 以上`, tu && !tu.cut.length && !tu.low.length, tu);
  await shot(p, `skip-master-user-${tag}`);
  await closeMenu(p);
  await p.evaluate(() => { TPA.me = window.__me; });
  await p.click(".master-place .tpa-skip"); await sleep(300);
  if (tag === "1280x720") {
    // 面から消す（確かめの面で「消す」）→ 帯からその行が消える（前に画面で消せた行は今も消せる。割れ 1）
    await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button[role=menuitem]")].find((b) => /id 902/.test(b.textContent))?.click()); await sleep(300);
    await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button[role=menuitem]")].find((b) => b.textContent.includes("消す"))?.click()); await sleep(1500);
    const after = await p.evaluate(async () => (await (await fetch("/api/masters/status")).json()).masters.equipment_master.skipped || []);
    check(`⑤ ${tag} 面から消すと読めない行が 1 つ減る（id が字の行だけが残る）`, after.length === 1 && /id 'x'/.test(after[0].summary), after);
    // ⑦ id が字の行も面から消せる（何行目かで消す道）→ 帯から札が消える
    const bandNow = await p.evaluate(() => document.querySelector(".master-place .tpa-skip")?.textContent || "");
    check(`⑦ ${tag} 消した後の帯の札は「⚠ 設備マスタの読めない行 1」`, bandNow === "⚠ 設備マスタの読めない行 1", bandNow);
    await p.click(".master-place .tpa-skip"); await sleep(300);
    await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button[role=menuitem]")].find((b) => /id 'x'/.test(b.textContent))?.click()); await sleep(300);
    await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button[role=menuitem]")].find((b) => b.textContent.includes("消す"))?.click()); await sleep(1500);
    const after2 = await p.evaluate(async () => (await (await fetch("/api/masters/status")).json()).masters.equipment_master.skipped || []);
    const gone = await p.evaluate(() => !document.querySelector(".master-place .tpa-skip"));
    check(`⑦ ${tag} id が字の行も面から消せる（読めない行が 0・帯の札が消える）`, after2.length === 0 && gone, { after2, gone });
    await shot(p, `skip-master-after-${tag}`, await p.evaluate(() => { const r = (document.querySelector(".master-place") || document.body).getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 60), width: innerWidth, height: Math.min(innerHeight - Math.max(0, r.top - 60), r.height + 260) }; }));
  }
}
