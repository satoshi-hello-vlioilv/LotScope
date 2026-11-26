// 評価関数（開発用）: ダッシュボードの数から明細へ（版 3.126.0。利用者の改良依頼 2026-11-17 の 7。決め方 ui-proposals/2026-11-drilldown の P）。
//   node program/tools/ui-eval-drill.mjs        （3 つの大きさ 1728・1536×864・1280×720 で流す。1 つだけなら引数に 1280x720 など）
// ① 数を押すと明細: 合わせた表のセル（L-1・CR1）・まとまりの計（総計）・前日の実績の直のセル（作業実績・設備ごとのファイル）・横棒（保留）・数字（仕掛ロット数・前日の実績本数）で、
//    明細の行の数・ロット数・確かめ（明細から数え直した数）が、パネルの数（画面の答え）と同じで、サーバーへ別に尋ねた答え（同じ組みの /api/dashboard/drill）とも同じ。
//    独立の答え: 仕掛の全部の行を一覧の道（/api/src/wip）で読み、パネルと同じ決まり（残仕掛設備ｺｰｽ の先頭の設備を NFKC で読みそろえ・仕掛区分）で数えた数とも同じ
// ② ダブルクリック・右クリックの「この数の明細を見る」でも開く（右クリックのメニューの項目に押した数の名前）
// ③ タブ: 別の数を押すとタブが増える・同じ数は増えない・5 つ目からは「前の n ▾」・× でそのタブ・Esc でいまのタブ・「すべて閉じる」で全部
// ④ 一時的: 開いて閉じた後、組みが変わっていない（保存していない変更の印が出ない・Dashboard._dirty() が偽・覚えた見え方に明細が無い）
// ⑤ 一覧で開く: 同じ件数の一覧（仕掛の一覧の件数が明細の行の数・帯「明細（一時の絞り）」）。外すと元の件数
// ⑥ 出せない形: 稼働のガントのパネルの数を押すと、理由の 1 行（空の明細を出さない）。差（別のデータと合わせる）はサーバーが理由を返す
// ⑦ 置き場: 明細の面は押したパネルに重ならず、ほかのパネルの縁にそろう（途中に縁を置かない）。押した数の印（dd-src）と押したパネルの縁が見えている
// ⑧ 3 つの大きさで、面の頭の帯・題の行・範囲の札・押す手が切れない・はみ出さない・重ならない・語の途中で折れない。表の高さは行の高さの倍数
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const VIEWS = process.argv[2] ? [process.argv[2]] : ["1728x1152", "1536x864", "1280x720"];
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const errors = [];

/** 明細の面の今（タブ・答え・置き場） */
const drillNow = (p) => p.evaluate(() => {
  const box = document.querySelector("#dashDrill"), st = window.DashDrill._state();
  if (!box) return { open: false, ...st };
  const r = box.getBoundingClientRect(), cur = st.tabs[st.cur] || {};
  return { open: true, ...st, cur: cur, rect: [r.left, r.top, r.right, r.bottom],
    tabsShown: box.querySelectorAll(".dd-tab").length, more: box.querySelector(".dd-more")?.textContent || "",
    rows: box.querySelectorAll(".dd-t tbody tr:not(.dd-pad)").length, msg: box.querySelector(".dd-msg")?.textContent || "" };
});
const waitDrill = (p) => p.waitForFunction(() => { const s = window.DashDrill && window.DashDrill._state(); const t = s && s.tabs[s.cur]; return t && !t.loading && (t.total != null || t.unsupported || t.err); }, null, { timeout: 15000 });
/** 画面の答えのセルの数（パネルの数） */
const cellOf = (p, id, r, c = [], m = 0, g = null) => p.evaluate(({ id, r, c, m, g }) => {
  const a = Dashboard._state().answers[id]; const d = g == null ? a : a.groups[g];
  const x = (d.cells || []).find((y) => JSON.stringify(y.r) === JSON.stringify(r) && JSON.stringify(y.c) === JSON.stringify(c));
  return x ? x.v[m] : null;
}, { id, r, c, m, g });
/** 別に尋ねた答え（同じ組み） */
const askDrill = (p, id, drill) => p.evaluate(async ({ id, drill }) => {
  const r = await fetch("/api/dashboard/drill", TPA.json("POST", { panel: Dashboard._asked(id), drill: { ...drill, limit: 1 } })); return r.json();
}, { id, drill });
const clickDr = async (p, sel, how = "click") => { const el = await p.$(sel); if (!el) return false; if (how === "dbl") await el.dblclick(); else await el.click(); await waitDrill(p).catch(() => {}); await sleep(250); return true; };

/** 見た目: 面の中の部品が面に収まり、字が切れず、語の途中で折れない */
const layout = (p) => p.evaluate(() => {
  const box = document.querySelector("#dashDrill"); if (!box) return { bad: ["面が無い"] };
  const B = box.getBoundingClientRect(), bad = [];
  const inside = (el, name) => { const r = el.getBoundingClientRect(); if (r.width && (r.left < B.left - 1 || r.right > B.right + 1 || r.top < B.top - 1 || r.bottom > B.bottom + 1)) bad.push(`${name} が面の外`); };
  for (const [sel, name] of [[".dd-strip", "頭の帯"], [".dd-ttl", "題の行"], [".dd-chips", "範囲の札"], [".dd-ft", "押す手"], [".dd-sum", "計の行"], [".dd-tw", "表"]]) { const el = box.querySelector(sel); if (el) inside(el, name); }
  for (const el of box.querySelectorAll(".dd-strip > *:not(.dd-sp), .dd-tab, .dd-ft > *, .dd-c, .dd-ttl > *, .dd-sum, .dd-all, .dd-inb")) {
    if (el.hidden || !el.getClientRects().length) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") bad.push(`切れる: ${el.textContent.trim().slice(0, 20)}`);
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    if (el.getClientRects().length && el.getBoundingClientRect().height > lh * 1.8 && !el.matches(".dd-ttl")) bad.push(`折れる: ${el.textContent.trim().slice(0, 20)}`);
  }
  // 頭の帯の部品が重ならない
  const parts = [...box.querySelectorAll(".dd-strip > *:not(.dd-sp):not([hidden]), .dd-tab")].filter((x) => !x.classList.contains("dd-tabs")).map((x) => [x.textContent.trim().slice(0, 12), x.getBoundingClientRect()]);
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { const a = parts[i][1], b = parts[j][1]; if (a.width && b.width && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 && !(a.left <= b.left && a.right >= b.right) && !(b.left <= a.left && b.right >= a.right)) bad.push(`重なる: ${parts[i][0]} と ${parts[j][0]}`); }
  // 表の高さ＝見出し＋行の高さの倍数（行の途中で切らない）
  const tw = box.querySelector(".dd-tw"), th = box.querySelector(".dd-t thead")?.getBoundingClientRect().height || 0;
  if (tw) { const k = (tw.clientHeight - th) / 27; if (Math.abs(k - Math.round(k)) > 0.15 && tw.scrollHeight > tw.clientHeight + 2) bad.push(`表の高さが行の倍数でない（${tw.clientHeight}）`); }
  // 押した数の印と、押したパネルの縁
  const src = document.querySelector("#dashGrid .dd-src"), keep = document.querySelector("#dashGrid .db-p.dd-keep");
  if (!src || !keep) bad.push("押した数の印・押したパネルの縁が無い");
  else {
    const K = keep.getBoundingClientRect(), S = src.getBoundingClientRect();
    const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    if (hit(K, B)) bad.push("面が押したパネルに重なる");
    if (S.bottom > innerHeight || S.right > innerWidth) bad.push("押した数が画面の外");
    // 面の縁はパネルの縁にそろう（面に半分だけ掛かるパネルが無い）
    for (const pe of document.querySelectorAll("#dashGrid .db-p")) { const R = pe.getBoundingClientRect(); if (hit(R, B) && (R.left < B.left - 2 || R.right > B.right + 2 || R.top < B.top - 2 || R.bottom > B.bottom + 2)) bad.push(`面が「${pe.querySelector("h3")?.textContent}」の途中に縁を置く`); }
  }
  if (B.right > innerWidth + 1 || B.bottom > innerHeight + 1) bad.push("面が画面の外");
  return { bad };
});

/** 独立の答え: 仕掛の全部の行を一覧の道で読み、パネルと同じ決まりで数える */
const truth = (p) => p.evaluate(async () => {
  const d = await (await fetch("/api/src/wip?page_size=5000", { cache: "no-store" })).json();
  const eq = (r) => String(r["残仕掛設備ｺｰｽ"] || "").trim().split(/\s+/)[0].normalize("NFKC").toUpperCase();
  const by = (f) => (d.rows || []).filter(f).length;
  return { all: (d.rows || []).length, L1: by((r) => eq(r) === "L-1"), CR1: by((r) => eq(r) === "CR1"), hold: by((r) => r["仕掛区分"] === "保留") };
});

const app = await launch();
try {
  for (const view of VIEWS) {
    console.log(`--- ${view}`);
    const p = await app.newPage("light", parseView(view), { screen: "dash" });
    p.on("pageerror", (e) => errors.push(`${view}: ${e.message}`));
    await p.evaluate(() => { window.__clip = {}; navigator.clipboard.writeText = async (t) => { window.__clip.text = t; }; });
    await waitDash(p); await sleep(500);
    const T = await truth(p);
    const keyOf = (p2, sel) => p2.$eval(sel, (el) => JSON.parse(el.dataset.dr));

    // ① 合わせた表のセル（L-1）
    const l1 = `${P("board")} tbody tr:first-child td.db-lots`, k1 = await keyOf(p, l1);
    await clickDr(p, l1);
    let s = await drillNow(p);
    const c1 = await cellOf(p, "board", k1.r, k1.c, 0, 0), a1 = await askDrill(p, "board", { g: 0, r: k1.r, c: k1.c });
    check(`① 合わせた表の ${k1.r[0]}: 明細 ${s.cur.total} 行・${s.cur.lots} ロット＝パネル ${c1}＝別に尋ねた ${a1.lots}`, s.open && s.cur.lots === c1 && s.cur.total === a1.total && a1.check.same === true && (k1.r[0] !== "L-1" || c1 === T.L1), { s: s.cur, c1, a1: a1.check, T });
    const lay1 = await layout(p); check("⑦⑧ 合わせた表のセル: 置き場と見た目", !lay1.bad.length, lay1.bad);
    // 全角の ＣＲ１ も CR1 の明細に入る（独立の答えと同じ）
    const cr = await p.$$eval(`${P("board")} tbody tr`, (trs) => trs.findIndex((tr) => tr.querySelector("th")?.textContent.trim() === "CR1") + 1);
    if (cr > 0) { await clickDr(p, `${P("board")} tbody tr:nth-child(${cr}) td.db-lots`); s = await drillNow(p); check(`① CR1（全角の ＣＲ１ も同じ設備）: 明細 ${s.cur.lots}＝独立の答え ${T.CR1}`, s.cur.lots === T.CR1 && s.cur.check.same === true, s.cur); }
    // まとまりの計（総計）
    const tot = `${P("board")} thead th small[data-dr]`;
    if (await p.$(tot)) { await clickDr(p, tot); s = await drillNow(p); check(`① 合わせた表の計（総計）: ${s.cur.lots}＝独立の答え ${T.all}`, s.cur.lots === T.all && s.cur.check.same === true, s.cur); }
    // 前日の実績の直のセル（作業実績・設備ごとのファイル）
    const shift = await p.$(`${P("board")} tbody tr:first-child td.db-s[data-dr]`);
    if (shift) {
      const ks = JSON.parse(await shift.getAttribute("data-dr")), cs = await cellOf(p, "board", ks.r, ks.c, 0, ks.g);
      await shift.click(); await waitDrill(p); await sleep(200); s = await drillNow(p);
      const as = await askDrill(p, "board", { g: ks.g, r: ks.r, c: ks.c });
      check(`① 前日の実績の ${ks.r[0]}・${ks.c.join("")}（作業実績）: 明細 ${s.cur.lots}＝パネル ${cs}＝別に尋ねた ${as.lots}`, s.cur.lots === cs && as.lots === cs && as.check.same === true, { s: s.cur, cs, as: as.check });
    }
    // ③ 同じ数は増えない・5 つ目からは「前の n ▾」
    const n0 = (await drillNow(p)).tabs.length;
    await clickDr(p, l1); s = await drillNow(p);
    check("③ 同じ数を押してもタブは増えない（そのタブへ移る）", s.tabs.length === n0, { n0, n: s.tabs.length });
    for (let i = 2; i <= 6; i++) await clickDr(p, `${P("board")} tbody tr:nth-child(${i}) td.db-lots`);
    s = await drillNow(p);
    check(`③ タブが多いとき、古いタブを「前の n ▾」に畳む（${s.tabs.length} 個・出す ${s.tabsShown}）`, s.tabs.length > 4 && s.tabsShown <= 4 && /前の \d+/.test(s.more), s);
    const lay2 = await layout(p); check("⑧ タブが多いとき: 頭の帯が切れない・重ならない", !lay2.bad.length, lay2.bad);
    // × でそのタブ・Esc でいまのタブ・すべて閉じる
    const before = s.tabs.length;
    await p.click("#dashDrill .dd-tab.is-on .dd-tabx"); await sleep(200); s = await drillNow(p);
    check("③ × でそのタブを閉じる", s.tabs.length === before - 1, s.tabs.length);
    await p.keyboard.press("Escape"); await sleep(200); s = await drillNow(p);
    check("③ Esc でいまのタブを閉じる", s.tabs.length === before - 2, s.tabs.length);
    await p.click("#dashDrill [data-dd-all]"); await sleep(200); s = await drillNow(p);
    check("③ 「すべて閉じる」で明細が消える", !s.open && !s.tabs.length, s);

    // ① 横棒（保留）・独立の答え
    const bar = `${P("wipClass")} svg [data-dr*="保留"]`, kb = await keyOf(p, bar);
    await clickDr(p, bar); s = await drillNow(p);
    const cb = await cellOf(p, "wipClass", kb.r, kb.c, kb.m);
    check(`① 横棒「保留」: 明細 ${s.cur.lots}＝パネル ${cb}＝独立の答え ${T.hold}`, s.cur.lots === cb && cb === T.hold && s.cur.check.same === true, { s: s.cur, cb, T });
    const lay3 = await layout(p); check("⑦⑧ 横棒: 置き場と見た目", !lay3.bad.length, lay3.bad);
    await p.keyboard.press("Escape"); await sleep(200);
    // ② ダブルクリック
    await clickDr(p, `${P("wipTotal")} .dp-num`, "dbl"); s = await drillNow(p);
    const ck = await cellOf(p, "wipTotal", [], [], 0);
    check(`② ダブルクリックで数字「仕掛ロット数」: 明細 ${s.cur.lots}＝パネル ${ck}＝独立の答え ${T.all}・タブは 1 つ`, s.open && s.cur.lots === ck && ck === T.all && s.tabs.length === 1, { s, ck });
    const lay4 = await layout(p); check("⑦⑧ 数字のパネル: 置き場（上の段の下）と見た目", !lay4.bad.length, lay4.bad);
    // 作業実績の数字（前日の実績本数。設備をまたぐ）
    await clickDr(p, `${P("workTotal")} .dp-num`); s = await drillNow(p);
    const cw = await cellOf(p, "workTotal", [], [], 0);
    check(`① 数字「前日の実績本数」（設備をまたぐ作業実績）: 明細の作業数 ${s.cur.lots}＝パネル ${cw}`, s.cur.lots === cw && s.cur.check.same === true, s.cur);
    const listOff = await p.$eval("#dashDrill [data-dd-list]", (b) => ({ off: b.disabled, why: b.title }));
    check("⑤ 設備をまたぐ明細は「一覧で開く」を押せず、理由が出る", listOff.off && /設備をまたぐ/.test(listOff.why), listOff);
    await p.click("#dashDrill [data-dd-all]"); await sleep(200);
    // ② 右クリックの「この数の明細を見る」
    const bb = await (await p.$(bar)).boundingBox();
    await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: "right" }); await sleep(300);
    const item = await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button")].map((b) => b.textContent).find((t) => t.includes("この数の明細を見る")) || "");
    check("② 右クリックのメニューに「この数の明細を見る」（押した数の名前）", /保留/.test(item), item);
    await p.evaluate(() => [...document.querySelectorAll(".tpa-menu button")].find((b) => b.textContent.includes("この数の明細を見る"))?.click());
    await waitDrill(p); await sleep(200); s = await drillNow(p);
    check("② メニューから開く", s.open && s.cur.lots === T.hold, s.cur);
    // コピー（全部の行・見出しつき）
    await p.click("#dashDrill [data-dd-copy]"); await p.waitForFunction(() => window.__clip.text, null, { timeout: 15000 });
    const lines = (await p.evaluate(() => window.__clip.text)).split("\n");
    check(`⑤ コピー: 見出し＋${T.hold} 行のタブ区切り`, lines.length === T.hold + 1 && lines[0].includes("\t") && lines[0].includes("仕掛区分"), lines.slice(0, 2));
    // ④ 一時的: 組みが変わっていない
    const dirty = await p.evaluate(() => Dashboard._dirty());
    check("④ 明細を開いても、ダッシュボードの組みは変わらない（保存していない変更なし）", !dirty && !(await p.$('.us-card')), dirty);
    // ⑤ 一覧で開く
    await p.click("#dashDrill [data-dd-list]");
    await p.waitForFunction(() => document.querySelector("#llDrillBand") && !document.querySelector("#lotListScreen.hidden"), null, { timeout: 15000 }).catch(() => {});
    await p.waitForFunction(() => window.LotList && document.querySelector("#llBody tr[data-i]"), null, { timeout: 15000 }).catch(() => {});
    await sleep(800);
    const listed = await p.evaluate(async () => { const u = LotList.pageUrl(1, 1); const d = await (await fetch(u)).json(); return { count: d.count, band: document.querySelector("#llDrillBand")?.textContent || "", src: LotList.source() }; });
    check(`⑤ 一覧で開く: 仕掛の一覧の件数 ${listed.count}＝明細 ${T.hold}・帯「明細（一時の絞り）」`, listed.count === T.hold && /一時の絞り/.test(listed.band), listed);
    const bandOk = await p.evaluate(() => { const b = document.querySelector("#llDrillBand"); const r = b.getBoundingClientRect(); return [...b.children].every((x) => { const q = x.getBoundingClientRect(); return q.right <= r.right + 1 && q.left >= r.left - 1; }) && r.right <= innerWidth; });
    check("⑧ 一覧の帯が画面に収まる", bandOk, bandOk);
    await p.click("[data-ll-droff]"); await sleep(1200);
    const off = await p.evaluate(async () => { const d = await (await fetch(LotList.pageUrl(1, 1))).json(); return { count: d.count, band: !!document.querySelector("#llDrillBand") }; });
    check(`⑤ 明細の絞りを外すと元の件数（${off.count}）`, off.count === T.all && !off.band, off);
    await p.evaluate(() => showScreen("dash")); await waitDash(p); await sleep(500);
    check("④ 画面を移ると明細は消える（一時的）", !(await drillNow(p)).open, await drillNow(p));
    // ⑥ 出せない形: ガント
    const ok6 = await p.evaluate(async () => {
      const L = Dashboard._layout(); const q = { ...Dashboard._asked("workDays"), visual: "gantt" };
      const a = await (await fetch("/api/dashboard/drill", TPA.json("POST", { panel: q, drill: { r: [], c: [] } }))).json();
      const sides = { ...Dashboard._asked("workDays"), visual: "column", link: { sides: [{ source: "work", key: { column: "@workday", part: "" }, measure: { agg: "lots" }, role: "target" }, { source: "work", key: { column: "@workday", part: "" }, measure: { agg: "lots" }, role: "actual" }], extra: ["diff"] } };
      const b = await (await fetch("/api/dashboard/drill", TPA.json("POST", { panel: sides, drill: { r: [], c: [], side: 2 } }))).json();
      return { a: a.unsupported || "", b: b.unsupported || b.error || "", L: !!L };
    });
    check("⑥ 出せない形は理由の 1 行（ガント・差）", /ガント/.test(ok6.a) && /差/.test(ok6.b), ok6);
    // ⑥ 画面: ガントのパネルの数を押すと理由が出る（ガントの棒は数の印を持たない形なので、ここでは窓の理由を画面の面で出せることを見る）
    await p.evaluate(() => { const el = document.querySelector('#dashGrid .db-p[data-id="workDays"]'); DashDrill.open({ panelId: "workDays", title: "試し", panel: { ...Dashboard._asked("workDays"), visual: "gantt" }, drill: { r: [], c: [] }, dr: "x" }); });
    await waitDrill(p); await sleep(200);
    const msg = await p.evaluate(() => document.querySelector("#dashDrill .dd-msg.is-no")?.textContent || "");
    check("⑥ 出せない形は面に理由が出る（空の表を出さない）", /明細を出せません/.test(msg) && !(await p.$("#dashDrill .dd-t")), msg);
    await p.evaluate(() => DashDrill.closeAll());
    // ④ 覚えた見え方に明細が無い（一時的）
    const saved = await p.evaluate(async () => { await TPA.saveUiState?.(); const s = await (await fetch("/api/ui-state")).json(); const keys = JSON.stringify(s); return keys.includes("rowid") || keys.includes("DashDrill") || /"dr":/.test(keys); });   // 覚えてよいのは初めの知らせを出したかの印（tpa.drill.hint）だけ
    check("④ 明細は覚えない（画面の覚えに明細が無い）", !saved, saved);
    await p.context().close();
  }
  check("頁のエラーが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
