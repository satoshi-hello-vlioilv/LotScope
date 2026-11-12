// 設備の実力（基準の数。版 3.103.0）の評価関数。本物の画面（開発用サーバー）で、1728・1536×864・1280×720 の 3 つの大きさで確かめる。
//
//   node program/tools/ui-eval-capacity.mjs [出力フォルダ]
//
// 数の答えは、app を使わない独立の答え（tools/capacity-truth.py: 作業実績のファイルを自分で読み、作業開始の日時から勤務体系で作業日と直を決めて数える）。
//   1. 設備の実力（直近 14 日）のパネル: 設備ごとの 重量÷稼働直・稼働率・稼働直 と総計（Σ分子÷Σ分母）が独立の答えと同じ。表の字（24.5t/直・21%・9直）も同じ数
//   2. 月の稼働日数（期間なし）: 設備 × 作業月の換算稼働日が独立の答えと同じ。終わりまで数えていない月（10 月）の見出しに「途中（10/1〜10/2）」
//   3. 見出しに「÷稼働直」を出さない（/直 はセルの単位）。稼働率と稼働直は別の列
//   4. 組む所: 見本「設備の実力」を押すと、行＝設備・値＝重量の合計（÷1000 ÷稼働直）・稼働率・稼働直・大きい順が入る（✓ が付く）。
//      値の計算の前→後（1,620.2t → 7.7t/直）の後の数が表の総計の字と同じ
//   5. 「÷ 稼働直 ▾」の面: 基準の数の名前・決め方・例・総計。当てるボタン・題の欄・値の札を覆わない。窓に収まる。総計が独立の答えと同じ
//   5'. 面の外を押すと閉じる
//   6. ② の見出し・見本・値の札が、組む所の中で一度に見える（固定のタブの下へ送られない）。見本は畳める
//   7. ＋ 基準の数を作る（稼働直÷稼働日）→ ＋ 基準の数を値に → 表の列の数が独立の答えと同じ（作った数はダッシュボードで共通）
//   8. 作業日・直の無いデータ（品質）で稼働直を使うと断る（黙って 0 にしない）
// 終了コード 0 で OK。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, sleep, waitDash, PROGRAM, CAP_LAYOUT, STATES } from "./ui-harness.mjs";

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), "ui-eval-capacity"));
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }, { width: 1280, height: 720 }];
const NOW = "2026-10-03 10:00:00";      // 開発用サーバーの「いま」（ui_server の DASHBOARD_NOW: 試験データの翌日の 10 時）
let bad = 0, ok = 0;
const check = (cond, what) => { if (cond) ok++; else { bad++; console.log(`NG ${what}`); } };
const near = (a, b, tol = 1e-6) => (a == null || b == null ? a == null && b == null : Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));
const fmt1 = (v, d) => v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });

/** 独立の答え（作業実績のファイルと勤務体系はサーバーの登録から。数えるのは capacity-truth.py） */
async function truth(page) {
  const { f, s } = await page.evaluate(async () => ({ f: await (await fetch("/api/worklog/files")).json(), s: await (await fetch("/api/masters/shifts")).json() }));
  const key = (x) => String(x || "").normalize("NFKC").trim().toUpperCase();
  const pat = (name) => s.items.find((p) => (p.equipment || []).some((e) => key(e) === key(name)) && p.segments.length) || s.items.find((p) => !(p.equipment || []).length && p.segments.length);
  const eqs = f.items.filter((x) => x.visible && x.state === "ok").map((x) => {
    const p = pat(x.name) || { segments: [] };
    return { name: x.name, path: path.join(f.folder, x.now || x.file), table: x.table || "", start: "BOX実績_作業開始_日付", weight: "重量",
      segments: p.segments.map((g) => ({ name: g.name, start: g.start, end: g.end, dayOffset: g.crosses ? g.dayOffset : null })) };
  }).filter((e) => fs.existsSync(e.path));
  const spec = path.join(OUT, "truth-in.json");
  fs.writeFileSync(spec, JSON.stringify({ now: NOW, equipment: eqs, views: [{ id: "eq14", kind: "equip", period: { kind: "days", n: 14 } }, { id: "month", kind: "equip_month", period: null }] }));
  const t = JSON.parse(execFileSync("python", [path.join(PROGRAM, "tools", "capacity-truth.py"), spec]).toString("utf8"));
  check(t.unread === 0, `独立の答えが読めない作業開始が ${t.unread} 行`);
  check(eqs.some((e) => e.segments.length === 2), "2 直の設備（CR2）が無い");
  return { t, eqs };
}

/** パネルの答え（画面が持っている答え。無ければ同じ組みをサーバーへ） */
async function answerOf(page, id) {
  return page.evaluate(async (pid) => {
    const p = Dashboard._layout ? Dashboard._layout().panels.find((x) => x.id === pid) : null;
    const panel = p || null;
    return panel ? (await fetch("/api/dashboard/query", TPA.json("POST", { panel }))).json() : null;
  }, id);
}

const rect = (r) => r && { l: r.left, t: r.top, r: r.right, b: r.bottom };
const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

const app = await launch();
try {
  for (const view of VIEWS) {
    const tag = `${view.width}`;
    const page = await app.newPage("light", view, { screen: "dash" });
    await page.evaluate((l) => Dashboard._setLayout(l), CAP_LAYOUT); await sleep(500); await waitDash(page); await sleep(800);
    const has = await page.evaluate(() => typeof Dashboard._layout === "function");
    const capP = CAP_LAYOUT.panels[0], monP = CAP_LAYOUT.panels[1];
    const ask = async (panel) => page.evaluate(async (q) => (await fetch("/api/dashboard/query", TPA.json("POST", { panel: q }))).json(), panel);
    const a1 = has ? await answerOf(page, "cap") : await ask(capP), a2 = has ? await answerOf(page, "capMonth") : await ask(monP);
    if (view.width === 1728) {
      const { t } = await truth(page);
      // 1. 設備の実力（直近 14 日）
      const cells = Object.fromEntries(a1.cells.filter((c) => !c.c.length).map((c) => [c.r.join("|"), c.v]));
      let n = 0;
      for (const c of t.views.eq14.cells) {
        const v = cells[c.r.join("|")];
        check(!!v, `設備の実力: セル ${c.r.join("|") || "総計"} が無い`); if (!v) continue;
        check(near(v[0], c["重量/稼働直"] / 1000), `設備の実力 ${c.r[0] || "総計"} 重量÷稼働直 ${v[0]} / 独立の答え ${c["重量/稼働直"] / 1000}`);
        check(near(v[1], c["稼働率"]), `設備の実力 ${c.r[0] || "総計"} 稼働率 ${v[1]} / 独立の答え ${c["稼働率"]}`);
        check(v[2] === c["稼働直"], `設備の実力 ${c.r[0] || "総計"} 稼働直 ${v[2]} / 独立の答え ${c["稼働直"]}`);
        n++;
      }
      check(n >= 10, `比べたセルが少ない（${n}）`);
      // 表の字（総計の行）
      const g = t.views.eq14.cells.find((c) => !c.r.length);
      const row = await page.$$eval('#dashGrid .db-p[data-id="cap"] tr.is-grand td', (tds) => tds.map((x) => x.textContent.trim()));
      check(row[0] === `${fmt1(g["重量/稼働直"] / 1000, 1)}t/直` && row[1] === `${fmt1(g["稼働率"], 0)}%` && row[2] === `${g["稼働直"].toLocaleString("ja-JP")}直`,
        `設備の実力の総計の字 ${row.join(" ")} / 独立の答え ${fmt1(g["重量/稼働直"] / 1000, 1)}t/直 ${fmt1(g["稼働率"], 0)}% ${g["稼働直"]}直`);
      const mean = t.views.eq14.cells.filter((c) => c.r.length).reduce((s, c) => s + c["重量/稼働直"], 0) / t.views.eq14.cells.filter((c) => c.r.length).length;
      check(!near(cells[""][0], mean / 1000, 1e-3), "総計が行の比の平均になっている（Σ分子÷Σ分母でない）");
      // 2. 月の稼働日数
      const mc = {};
      a2.cells.forEach((c) => { mc[`${c.r[0] || ""}|${c.c[0] || ""}`] = c.v[0]; });
      let m = 0;
      for (const c of t.views.month.cells) {
        const k = c.r.length ? `${c.r[0]}|${c.r[1]}` : "|";
        check(near(mc[k], c["換算稼働日"]), `月の稼働日数 ${k}: ${mc[k]} / 独立の答え ${c["換算稼働日"]}`); m++;
      }
      check(m >= 40, `月の稼働日数の比べたセルが少ない（${m}）`);
      const heads = await page.$$eval('#dashGrid .db-p[data-id="capMonth"] thead th', (th) => th.map((x) => x.textContent));
      check(heads.some((h) => /2026\/10\s*途中（10\/1〜10\/2）/.test(h)), `途中の月の印が無い: ${heads.join(" / ")}`);
      check(!heads.some((h) => /2026\/09.*途中/.test(h)), "数え終えた月に途中の印");
      // 3. 見出し
      const h1 = await page.$$eval('#dashGrid .db-p[data-id="cap"] thead th', (th) => th.map((x) => x.textContent.trim()));
      check(!h1.some((x) => /÷|［/.test(x)), `見出しに式・割る数が出ている: ${h1.join(" / ")}`);
      check(h1.includes("稼働率") && h1.includes("稼働直"), `稼働率・稼働直の列が無い: ${h1.join(" / ")}`);
      const sub = await page.$eval('#dashGrid .db-p[data-id="cap"]', (el) => el.textContent);
      check(!/見本/.test(sub), "パネルに「見本…から組んだ」の字が出ている");
      // 8. 品質で稼働直
      const q = await ask({ id: "q", visual: "none", source: "lot", body: { rows: [{ column: "合金" }], measures: [{ agg: "base", base: "稼働直" }] } });
      check(q.error && /作業日と直のある作業実績だけ/.test(q.error), `品質で稼働直を断らない: ${JSON.stringify(q).slice(0, 120)}`);
      // 7. 作った数を作って値に足す（組む所の面で）
      globalThis.TRUTH = t;
    }
    // 4〜6. 組む所（cap-edit の状態から）
    const edit = STATES.find(([n]) => n === "cap-edit")[1];
    await edit(page);
    await page.screenshot({ path: path.join(OUT, `cap-edit-${tag}.png`) });
    const geo = await page.evaluate(() => {
      const r = (s) => { const e = typeof s === "string" ? document.querySelector(s) : s; if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
      return { pop: r("#dePerPop"), apply: r("[data-de-apply]"), title: r("#deTitle"), chips: [...document.querySelectorAll("#deSent .pv-slot[data-role=vals] .pv-chip")].map(r),
        vw: innerWidth, vh: innerHeight, items: [...document.querySelectorAll("#dePerPop .cp-it b")].map((x) => x.textContent),
        tot: [...document.querySelectorAll("#dePerPop .cp-it")].map((x) => [x.querySelector("b").textContent, x.querySelectorAll("em")[1]?.textContent]),
        prev: document.querySelector('#deSent [data-pc-out="0"] .pc-prev')?.textContent || "", per: document.querySelector('#deSent [data-de-per="0"]')?.textContent || "",
        grand: document.querySelector('#dashGrid .db-p[data-id="cap"] tr.is-grand td')?.textContent.trim() || "" };
    });
    check(!!geo.pop, `${tag}: 割る数の面が開かない`);
    if (geo.pop) {
      const P = rect(geo.pop);
      check(!hit(P, rect(geo.apply)), `${tag}: 面が「当てる」を覆う`);
      check(!hit(P, rect(geo.title)), `${tag}: 面が題の欄を覆う`);
      check(!geo.chips.some((c) => hit(P, rect(c))), `${tag}: 面が値の札を覆う`);
      check(P.l >= 0 && P.t >= 0 && P.r <= geo.vw && P.b <= geo.vh, `${tag}: 面が窓からはみ出す ${JSON.stringify(P)}`);
      check(["稼働直", "稼働日", "1日の直数", "期間の日数", "期間の直数", "換算稼働日", "稼働率"].every((x) => geo.items.includes(x)), `${tag}: 面の基準の数の名前 ${geo.items.join("・")}`);
      const g = globalThis.TRUTH && globalThis.TRUTH.views.eq14.cells.find((c) => !c.r.length);
      const tot = Object.fromEntries(geo.tot);
      if (g) check(tot["稼働直"] === g["稼働直"].toLocaleString("ja-JP") && tot["期間の直数"] === g["期間の直数"].toLocaleString("ja-JP"),
        `${tag}: 面の総計 稼働直 ${tot["稼働直"]}・期間の直数 ${tot["期間の直数"]} / 独立の答え ${g["稼働直"]}・${g["期間の直数"]}`);
    }
    check(/→/.test(geo.prev) && geo.prev.split("→")[1].trim() === geo.grand, `${tag}: 値の計算の前→後「${geo.prev}」の後が表の総計「${geo.grand}」と違う`);
    check(/÷\s*稼働直/.test(geo.per), `${tag}: 割る数の札「${geo.per}」`);
    // 6. ② の見出しから見本・値の札までが組む所の中に一度に見える
    // 面の外（組む所の題の欄）を押すと閉じる
    await page.mouse.click(...(await page.evaluate(() => { const r = document.querySelector("#deTitle").getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; }))); await sleep(200);
    check(!(await page.$("#dePerPop")), `${tag}: 面の外を押しても閉じない`);
    const fit = await page.evaluate(() => {
      const main = document.querySelector("#dbEditor .de-main"), st = [...document.querySelectorAll("#dbEditor .de-step")][1], tabs = document.querySelector("#dePtabs");
      main.scrollTop = Math.max(0, st.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - tabs.getBoundingClientRect().height - 4);
      const r = (e) => e.getBoundingClientRect();
      const chips = [...document.querySelectorAll("#deSent .pv-slot[data-role=vals] .pv-chip")], ex = document.querySelector("#deSent .cp-ex");
      return { step: r(st).top, tabs: r(tabs).bottom, chips: Math.max(...chips.map((c) => r(c).bottom)), main: Math.min(r(main).bottom, innerHeight), ex: ex ? r(ex).height : 0,
        on: [...document.querySelectorAll("#deSent .cp-exb.on b")].map((b) => b.textContent) };
    });
    check(fit.step >= fit.tabs - 1, `${tag}: ② の見出しが固定のタブの下へ送られる（${fit.step} < ${fit.tabs}）`);
    check(fit.chips <= fit.main, `${tag}: ② の見出しから値の札までが組む所に入らない（${fit.chips} > ${fit.main}）`);
    check(fit.ex > 0 && fit.ex <= 170, `${tag}: 見本の高さ ${fit.ex}px`);
    check(fit.on.length === 1 && /設備の実力/.test(fit.on[0]), `${tag}: 見本の ✓ ${fit.on.join("・")}`);
    // 見本は畳める
    await page.click("#deSent [data-de-extoggle]"); await sleep(250);
    const folded = await page.evaluate(() => document.querySelector("#deSent .cp-ex")?.getBoundingClientRect().height || 0);
    check(folded > 0 && folded < fit.ex - 30, `${tag}: 見本を畳んでも低くならない（${folded}）`);
    await page.click("#deSent [data-de-extoggle]"); await sleep(250);
    if (view.width === 1728) {
      // 4. 見本を押すと組みが入る（ほかの形から: 日あたり重量の推移 → 設備の実力）
      await page.click('#deSent [data-de-ex="daily"]'); await sleep(400);
      let b = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#deSent .pv-slot[data-role=rows] .pv-chip b")].map((x) => x.textContent) }));
      check(b.rows.join() === "作業日", `見本「日あたり重量の推移」の行 ${b.rows}`);
      await page.click('#deSent [data-de-ex="power"]'); await sleep(400); await waitDash(page); await sleep(800);
      b = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#deSent .pv-slot[data-role=rows] .pv-chip b")].map((x) => x.textContent),
        vals: [...document.querySelectorAll("#deSent .pv-slot[data-role=vals] .pv-chip")].map((x) => (x.classList.contains("is-base") ? "灰:" : "") + x.querySelector("b").textContent),
        per: document.querySelector('#deSent [data-de-per="0"]')?.textContent || "", sort: document.querySelector("#deSort select")?.value || "" }));
      check(b.rows.join() === "設備" && b.vals.join() === "重量,灰:稼働率,灰:稼働直" && /稼働直/.test(b.per) && b.sort === "desc", `見本「設備の実力」の組み ${JSON.stringify(b)}`);
      // 7. 基準の数を作って値に足す
      await page.click("#deSent [data-de-addbase]"); await page.waitForSelector("#dePerPop [data-cp-new]");
      await page.click("#dePerPop [data-cp-new]"); await sleep(200);
      await page.fill("#dePerPop [data-cp-oname]", "直あたり日");
      await page.fill("#dePerPop [data-cp-oexpr]", "[稼働直]÷[稼働日]");
      await page.click("#dePerPop [data-cp-osave]"); await sleep(400);
      const listed = await page.$$eval("#dePerPop .cp-it b", (x) => x.map((y) => y.textContent));
      check(listed.includes("直あたり日"), `作った数が面に並ばない: ${listed.join("・")}`);
      await page.click('#dePerPop [data-cp-pick="直あたり日"]'); await sleep(500); await waitDash(page); await sleep(900);
      const ans = await page.evaluate(async () => { const p = Dashboard._layout().panels.find((x) => x.id === "cap"); return { p, a: await (await fetch("/api/dashboard/query", TPA.json("POST", { panel: p }))).json(), bases: Dashboard._layout().bases }; });
      const j = ans.p.body.measures.findIndex((x) => x.agg === "base" && x.base === "直あたり日");
      check(j >= 0 && (ans.p.body.bases || []).some((x) => x.name === "直あたり日"), "作った数がパネルの値・写しに無い");
      check((ans.bases || []).some((x) => x.name === "直あたり日"), "作った数がダッシュボードで共通の並びに無い");
      const t = globalThis.TRUTH;
      for (const c of t.views.eq14.cells) {
        const cell = ans.a.cells.find((x) => x.r.join("|") === c.r.join("|") && !x.c.length);
        check(cell && near(cell.v[j], c["稼働直"] / c["稼働日"]), `作った数 稼働直÷稼働日 ${c.r[0] || "総計"}: ${cell && cell.v[j]} / 独立の答え ${c["稼働直"] / c["稼働日"]}`);
      }
      await page.screenshot({ path: path.join(OUT, `cap-own-${tag}.png`) });
    }
    await page.context().close();
  }
} finally { await app.close(); }
console.log(bad ? `NG ${ok + bad} 件中 ${bad} 件` : `OK（${ok} 件。画像: ${OUT}）`);
process.exit(bad ? 1 : 0);
