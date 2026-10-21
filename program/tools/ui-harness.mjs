// 画面の撮影の共通部分（開発用。ui-check.mjs・ui-variants.mjs が使う。元は Inventor の同じ名前の道具）。
//
// 窓の代わりの開発用サーバー（ui_server.py。試験用の品質データ 1500 行）を起こし、Playwright の Chromium（WebView2 と同じ系統）で、
// 利用者の画面と同じ大きさ（2160×1440・表示倍率 125% → 1728×1152）の頁を開く。
// 窓だけが答える /__desktop/*（ショートカットの様子など）は作り物で答える（デスクトップのショートカットだけが欠けた PC）。
// 状態（STATES）は、品質異常 → … → 作業実績 → … → 更新履歴 → 表示列の設定 → マスタ管理 → 待ちの窓 の順に 1 つの頁で進める。
// 起動画面（desktop/splash。窓が出す）は別の頁で、窓の代わりに splash.brand・step・fail を呼んで進める（SPLASH_STATES）。

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
export const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
export const PROGRAM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPLASH = path.resolve(PROGRAM, "../desktop/splash/index.html");
export const VIEW = { width: 1728, height: 1152 }; // 利用者の PC。フル HD（1920×1080）・125% なら 1536×864
/** "1536x864" → { width, height }（無ければ利用者の PC の大きさ） */
export const parseView = (text) => (text ? Object.fromEntries(text.split("x").map((v, i) => [i ? "height" : "width", Number(v)])) : VIEW);
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const DESK = "C:\\Users\\user\\Desktop";
const START = "C:\\Users\\user\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs";
/** 窓の答えの作り物（この PC のアプリはある・スタートにだけショートカットがある） */
const INSTALL = {
  installed: true, runningFromApp: true, name: "LotScope", appDir: "C:\\Users\\user\\AppData\\Local\\LotScope\\app",
  shortcut: { links: [`${START}\\LotScope.lnk`], places: [DESK, START], ask: false, declined: false },
};
/** 配布の置き場の作り物（版が 3 つ置いてあり、3.12.0 を配っている） */
const BOX = "C:\\Users\\user\\Box\\LotScope";
const RELEASE = {
  reachable: true, found: BOX, adjusted: false, folder: BOX, appFolder: BOX, problems: [],
  distributed: { schema: 1, app_id: "defect-analyzer", version: "3.12.0", entry: "LotScope.exe", setAt: "2026-10-06T16:40:00", setBy: "user", setPc: "PC-01", previous: "3.11.0",
    // 全員が使うマスタの置き場（版 3.34.0。配る版を決めた人の置き場）
    masters: { dir: "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters", setAt: "2026-10-15T14:30:00", setBy: "user", setPc: "PC-01" } },
  versions: ["3.13.0", "3.12.0", "3.11.0"].map((v, i) => ({ version: v, placedAt: `2026-10-0${8 - i * 2}T12:30:00`, placedPc: "PC-01", placedBy: "user", source: "desktop-windows", zip: `LotScope-${v}-windows.zip`, bytes: 6816621, dir: `${BOX}\\${v}` })),
  entry: { exists: true, path: `${BOX}\\LotScope.exe` },
  me: { canRelease: true, role: "開発者" },
};
// まとめて見る（並び・まとめ）の状態で使う段: 設備 ▲ → 不良名 ▲、繰り返しを省く
const ARRANGE = { "仕掛": { levels: [{ column: "設備", dir: "asc", lot: false }, { column: "不良名", dir: "asc", lot: false }], heads: false, suppress: true } };

// 推奨アップデートの札が付いた配る版（3.13.0）を取り込み済み（窓の /__desktop/update の答えの作り物）
const UPDATE_RECOMMENDED = {
  state: "ready", ready: "3.13.0", direction: "up", current: "3.12.0", source: BOX, found: BOX, checkedAt: "2026-10-15 09:12", failed: [], notes: [],
  distributed: { ...RELEASE.distributed, version: "3.13.0", previous: "3.12.0", setAt: "2026-10-15T09:05:00",
    recommended: { note: "ほかの PC がマスタの置き場に追従しない不具合を直しました", setAt: "2026-10-15T09:06:00", setBy: "user", setPc: "PC-01" } },
};

// 列の見出しの札の状態（headers）: 登録日（発生日の表示名）・設備・不良名の 3 段、重量の並べ替え、計算列 3 つ、狭い列の幅、絞り込み 1 つ
const HEADERS = {
  arrange: { "仕掛": { levels: [{ column: "発生日", dir: "asc", lot: false }, { column: "設備", dir: "asc", lot: false }, { column: "不良名", dir: "asc", lot: false }], heads: true, suppress: false } },
  layout: { "lotlist:仕掛": { order: ["発生日", "切断長", "設備", "不良名", "ロット番号", "客先", "材調質", "製造寸法", "重量", "板厚", "板幅"],
    hidden: [], widths: { "発生日": 92, "切断長": 58, "設備": 76, "不良名": 70, "ロット番号": 104, "客先": 96, "材調質": 92, "製造寸法": 112 }, locks: [],
    names: { "発生日": "登録日時" }, formats: {}, aligns: {}, rules: {},
    formulas: { "切断長": "[長さ]*2", "材調質": "[合金] & \"-\" & [調質]", "製造寸法": "[板厚] & \"x\" & [板幅]" } } },
  sorts: { "仕掛": [{ column: "重量", dir: "desc" }] },
  active: { "仕掛": [{ column: "不良名", op: "not_empty", value: "" }] },
};

// 件数の行が混んだ所（crowded。headers の続き）: スライサーで設備を 2 つ選び、色付けを 1 つ（不良名が汚れ）
const CROWDED = {
  slicer: { open: { lot: false }, place: "left", tables: { "仕掛": [{ column: "設備", sel: ["CR1", "L-1"] }, { column: "不良名", sel: [] }] } },
  marks: { tables: { "仕掛": [{ id: "m1", conds: [{ column: "不良名", op: "eq", value: "汚れ" }], tone: "red", target: "cells", on: true }] } },
};

// 並べ替えの状態（sorted）: まとめず、重量 ▼ → 板厚 ▲ の 2 つで並べ、不良名が空欄でない行に絞る
// 版 3.46.0: 稼働のガントチャート（前日・全設備・作業区分で色分け）と ABC 分析・換算係数（合金）を並べたダッシュボード（保存しない: Dashboard._setLayout）
const OPS_LAYOUT = { rows: 8, panels: [
  // 直近 4 日（版 3.47.0）: 焼鈍炉 ANF の作業終了の書き忘れ（区間なし）・いま炉の中（作業中）と、ほかの設備の前から続く作業が入る
  { id: "gantt", x: 0, y: 0, w: 12, h: 5, title: "", visual: "gantt", source: "work", period: { column: "@workday", kind: "days", n: 4 }, ops: { color: "作業区分" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } },
  { id: "abc", x: 0, y: 5, w: 12, h: 3, title: "", visual: "abc", source: "work", ops: { cls: ["合金", "調質"] }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } }] };
// 積み上げ横棒（版 3.48.0）: 設備ごとの直の内訳（直近 7 日）と、作業区分ごとの直の割合（100%）。設備は手で並べた順（CR2・CR1 を先に）
const HSTACK_LAYOUT = { rows: 8, panels: [
  { id: "hs", x: 0, y: 0, w: 7, h: 8, title: "", visual: "hstack", source: "work", period: { column: "@workday", kind: "days", n: 7 }, eorder: ["CR2", "CR1"],
    body: { rows: [{ column: "@equip", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }] }, fmt: { labels: "inside" } },
  { id: "hs100", x: 7, y: 0, w: 5, h: 8, title: "", visual: "hstack100", source: "work", period: { column: "@workday", kind: "days", n: 7 },
    body: { rows: [{ column: "作業区分", part: "" }], cols: [{ column: "@shift", part: "" }], measures: [{ agg: "lots" }] } }] };
// 組み合わせのグラフ（直近 14 日のロット数＝棒・重量の平均＝線〈右〉）と、設備ごとの組み合わせ（本数・速度の平均）
const COMBO_LAYOUT = { rows: 8, panels: [
  { id: "combo", x: 0, y: 0, w: 7, h: 8, title: "", visual: "combo", source: "work", period: { column: "@workday", kind: "days", n: 14 }, body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "avg", column: "重量" }] },
    fmt: { series: { "重量の平均": { kind: "line", axis: "right", dash: true } } } },
  { id: "combo2", x: 7, y: 0, w: 5, h: 8, title: "", visual: "combo", source: "work", body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }, { agg: "avg", column: "速度" }] } }] };
const SORTED = { sorts: { "仕掛": [{ column: "重量", dir: "desc" }, { column: "板厚", dir: "asc" }] }, active: { "仕掛": [{ column: "不良名", op: "not_empty", value: "" }] } };

/** サーバーとブラウザーを起こす。{ browser, newPage(テーマ, 大きさ), close() } */
export async function launch() {
  const port = 8765 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn("python", ["-u", path.join(PROGRAM, "tools/ui_server.py"), String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((done, fail) => { server.stdout.once("data", done); server.once("exit", (c) => fail(new Error(`ui_server.py が終わりました（${c}）`))); });
  const browser = await chromium.launch();
  return {
    browser,
    base,
    /** 品質異常が出た頁（まとめていない・拡大していない・覚えた設定の無い、まっさらな状態）。
        最初の画面はダッシュボード（版 3.37.0）なので、頁の印 #screen=list で一覧から始める（読み直しても一覧のまま）。
        screen: "dash" ならダッシュボードから（パネルが描き終わるまで待つ） */
    async newPage(theme, view = VIEW, { screen = "list" } = {}) {
      const context = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, colorScheme: theme, locale: "ja-JP" });
      await context.route("**/__desktop/**", (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p === "/__desktop/install") return route.fulfill({ json: INSTALL });
        if (p === "/__desktop/release") return route.fulfill({ json: RELEASE });
        return route.fulfill({ status: 404, json: { error: "作り物の窓は答えません" } });
      });
      await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, body: "", headers: { "Content-Type": "text/css" } }));
      // 前の頁で変えた画面の設定（サーバーの控え。スライサー・並びなど）を消して、まっさらから始める（案どうしで混ざらない）
      const saved = await (await context.request.get(`${base}/api/ui-state`)).json();
      await context.request.post(`${base}/api/ui-state`, { data: { changed: {}, removed: Object.keys(saved.keys) } });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.warn(`[${theme}] page error: ${e.message}`));
      await page.goto(`${base}/#screen=${screen}`);
      if (screen === "dash") await waitDash(page);
      else await page.waitForSelector("#llBody tr[data-i]", { timeout: 30000 });
      await sleep(500);
      return page;
    },
    /** 起動画面（窓が名前を伝えた直後。まだ段取りは進んでいない） */
    async newSplash(theme, view = VIEW) {
      const context = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, colorScheme: theme, locale: "ja-JP" });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.warn(`[${theme}] page error: ${e.message}`));
      await page.goto(pathToFileURL(SPLASH).href);
      await page.evaluate(() => window.splash.brand("LotScope", "転写距離・ピッチ解析"));
      return page;
    },
    async close() {
      await browser.close();
      server.kill();
    },
  };
}

/** ダッシュボードのパネルが描き終わるまで待つ（数えています・写しています の札が消える） */
export async function waitDash(page, timeout = 30000) {
  await page.waitForSelector("#dashGrid .db-p", { timeout });
  await page.waitForFunction(() => {
    const ps = [...document.querySelectorAll("#dashGrid .db-p")];
    return ps.length && ps.every((p) => !p.querySelector(".dp-wait, .db-spin"));
  }, null, { timeout });
}

/** 開いている浮かぶ窓・メニューを閉じる（次の状態の前に） */
async function closeAll(page) {
  // 前の状態で直した物（保存していない変更）は捨ててから閉じる（版 3.43.0。捨てないと、閉じる・移る前の確かめの窓で止まる）
  await page.evaluate(() => { if (window.TPA && TPA.unsaved) TPA.unsaved.pending("*").forEach((w) => { try { w.discard && w.discard(); } catch (_) { /* 撮るだけ */ } }); document.querySelector('.us-card [data-us="discard"]')?.click(); }).catch(() => {});
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
  // Esc で閉じない窓（表示列の設定・マスタ管理）は閉じるボタンで
  for (const sel of ["#llFxPanel:not([hidden]) [data-act=close]", "#llColumnPanel:not([hidden]) #lcClose", "#masterOverlay:not(.hidden) #masterCloseBtn"]) {
    const b = await page.$(sel);
    if (b) await b.click().catch(() => {});
  }
  await sleep(300);
}

// 状態: [名前, そこへ行く操作, 次に押すべきもの（新しい画面の data-next → 前の画面の部品 の順に探す）]
export const STATES = [
  ["list", async () => {}, "[data-next], #llBody .ll-lot"],
  // 版 3.45.0: 見出しの下の値で絞る段の ▾ で開く「値で絞る」（設備。CR1・DL2・L-1 を選び、条件で絞るを開いた所）
  ["list-colfilter", async (p) => {
    await p.click('#llHead th[data-fcol="設備"] [data-th-filter]'); await p.waitForSelector(".vf-pop [data-vf-v]"); await sleep(200);
    await p.click(".vf-pop [data-vf-all]");
    for (const v of ["CR1", "DL2", "L-1"]) await p.click(`.vf-pop [data-vf-v="${v}"]`);
    await p.click(".vf-pop [data-vf-ctog]"); await sleep(250);
  }, "[data-next], .vf-pop [data-vf-ok]"],
  // 版 3.45.0: 見出しのタブの名前と並び（品質異常を「異常ロット」に変え、仕掛を 2 番目へ。作業実績のタブを右クリックしたメニュー）
  ["tabs-menu", async (p) => {
    await p.keyboard.press("Escape"); await sleep(150);
    await p.evaluate(() => { TPA.local.set("tpa.tabs.v1", { order: ["dash", "src:wip", "list", "calc", "work"], names: { list: "異常ロット" } }); document.dispatchEvent(new CustomEvent("tpa:sources-changed")); });
    await sleep(600);
    const b = await (await p.$('.screen-tabs [data-screen="work"]')).boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" }); await sleep(400);
  }, "[data-next], .tpa-menu button"],
  ["grouped", async (p) => {
    await p.keyboard.press("Escape");
    await p.evaluate(() => TPA.local.set("tpa.tabs.v1", {}));
    await p.evaluate((a) => localStorage.setItem("tpa.lotlist.arrange.v1", JSON.stringify(a)), ARRANGE);
    await p.reload();
    await p.waitForSelector("#llBody tr[data-i]");
    await sleep(500);
  }, '[data-next], #llActiveTabs [data-kind="group"]'],
  // 列の見出しの札（段・並べ替え・式・絞り込み）: 列を狭め、3 段でまとめ、並べ替えと計算列を足したところ（利用者の画面の再現）
  ["headers", async (p) => {
    // 画面の設定はサーバーの控えと同期する（TPA.local）。控えへ書き終えてから読み直す
    await p.evaluate(async ({ arrange, layout, sorts, active }) => {
      TPA.local.set("tpa.lotlist.arrange.v1", arrange); TPA.local.set("tpa.lotlist.layout.v1", layout);
      TPA.local.set("tpa.lotlist.sorts.v1", sorts); TPA.local.set("tpa.lotlist.active.v1", active);
      await TPA.saveUiState();
    }, HEADERS);
    await p.reload();
    await p.waitForSelector("#llBody tr[data-i]");
    await sleep(600);
  }, "[data-next], #llHead th"],
  // 件数の行が混んだ所（利用者の画面の再現: 3 段のまとめ＋並べ替え＋スライサーで選んだ値＋色付け＋共有の書式の札）。件数の行を 1 段に収める比べ
  ["crowded", async (p) => {
    await p.evaluate(async (c) => {
      TPA.local.set("tpa.lotlist.slicer.v1", c.slicer); TPA.local.set("tpa.lotlist.marks.v1", c.marks);
      await TPA.saveUiState();
    }, CROWDED);
    await p.reload();
    await p.waitForSelector("#llBody tr[data-i]");
    // 共有の書式を当てた所（上の段の「書式」に名前が出る。試験のサーバーには共有の書式が無いので、名前だけ当てた形にする）
    await p.evaluate(() => { const b = document.querySelector("#llFormatBtn"); if (b) { b.querySelector(".fm-now").textContent = "異常ロット表示"; b.classList.add("has-now"); } });
    await sleep(700);
  }, '[data-next], #llActiveTabs [data-kind="group"]'],
  ["viewmenu", async (p) => { await p.click("#llViewBtn"); await sleep(400); }, "[data-next], #llLvAdd"],
  // 並べ替え（まとめずに 2 つのキー: 重量 ▼ → 板厚 ▲）と条件 1 つ。並べ替えの見え方・外し方、条件と並べ替えの保存の入口を見る
  ["sorted", async (p) => {
    await closeAll(p);
    await p.evaluate(async ({ sorts, active }) => {
      TPA.local.set("tpa.lotlist.arrange.v1", {}); TPA.local.set("tpa.lotlist.sorts.v1", sorts); TPA.local.set("tpa.lotlist.active.v1", active);
      await TPA.saveUiState();
    }, SORTED);
    await p.reload();
    await p.waitForSelector("#llBody tr[data-i]");
    await sleep(600);
  }, '[data-next], #llActiveTabs [data-kind="sort"]'],
  // 並べ替えの状態で「プリセット」を開いたところ（保存した見方・いまの形の札・保存）
  ["sorted-preset", async (p) => { await p.click("#llPresetBtn"); await sleep(400); }, "[data-next], #llViewSave"],
  ["card", async (p) => { await closeAll(p); await p.dblclick("#llBody tr[data-i] td:nth-child(3)"); await sleep(600); }, "[data-next], .lk-pin"],
  ["calc", async (p) => { await closeAll(p); await p.click("#tabCalc"); await sleep(500); }, "[data-next], #query"],
  // 作業実績（設備ごとの実績。設備を札で替える）: 開いた直後（前に見た設備か、読める最初の設備）
  ["worklog", async (p) => { await closeAll(p); await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(700); }, "[data-next], #llEquipBar [aria-selected=false]"],
  // 作業実績を作業でまとめる（日＋直ごと。右に日×直のロット数）と、表の数を押してその日・直に絞ったところ
  ["worklog-work", async (p) => { await p.click('#llWorkSwitch [data-wk-mode="dayshift"]'); await p.waitForSelector("#llWork .wk-pv"); await sleep(600); }, "[data-next], #llWork [data-wk-shift]"],
  ["worklog-pick", async (p) => { await p.click("#llWork tbody tr:nth-child(4) [data-wk-shift]"); await sleep(900); }, "[data-next], #llWorkSwitch [data-wk-unpick]"],
  // 集計表・グラフ（ピボット集計）: すぐに見る「作業日ごとのロット数・重量」（時系列）と、重量のヒストグラム
  ["worklog-pivot", async (p) => { await p.click("#llWorkSwitch [data-wk-unpick]").catch(() => {}); await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-quick", { state: "attached" });
    await quick(p); await p.waitForSelector("#llPivot .pv-table"); await sleep(700); }, "[data-next], #llPivot [data-pv-pick]"],
  ["worklog-hist", async (p) => { await pickChart(p, "hist"); await sleep(1000); }, "[data-next], #llPivot [data-pv-binw]"],
  // 版 3.27.0: グラフの形を選ぶ所を開いた所（形が 14 に増えた）と、すぐに見るを選ぶ所を開いた所（ID ごとに選ぶ）。
  // 改良案（ui-variants）は body の data-ui-pick を見て、案の開いた形を出す
  ["pivot-pick", async (p) => { await closeAll(p); await quick(p); await sleep(800);
    await p.evaluate(() => { document.body.dataset.uiPick = "chart"; }); await p.click("#llPivot [data-pv-pick]").catch(() => {}); await sleep(500); }, "[data-next], #llPvChartPop [data-pv-chart]"],
  ["pivot-quickpick", async (p) => { await closeAll(p); await p.evaluate(() => { document.body.dataset.uiPick = "quick"; }); await p.click("#llPivot [data-pv-qpick]").catch(() => {}); await sleep(500); },
    "[data-next], #llPvPresetPop [data-pv-pin]"],
  // 共有の書式（作業実績の道具の行の「書式 ▾」）: 開いたところ・設備を選ぶところ・当てたところ（元に戻すが出る）
  ["formats", async (p) => { await closeAll(p); await p.evaluate(() => { delete document.body.dataset.uiPick; }); await p.click('#llViewSwitch [data-pv-view="list"]').catch(() => {}); await sleep(300); await p.click("#llFormatBtn"); await p.waitForSelector("#llFormatPanel .fm-item"); await sleep(400); }, "[data-next], #llFormatPanel .fm-apply"],
  ["formats-pick", async (p) => { await p.click('#llFormatPanel input[name="fmTo"][value="pick"]'); await sleep(300);
    for (const n of [1, 2, 3]) await p.click(`#llFormatPanel .fm-equips label:nth-of-type(${n + 1}) input`).catch(() => {}); await sleep(300); }, "[data-next], #llFormatPanel .fm-apply"],
  ["formats-applied", async (p) => { await p.click("#llFormatPanel .fm-item:first-child .fm-apply"); await sleep(900); }, "[data-next], #llFormatPanel .fm-undo"],
  ["appmenu", async (p) => { await p.click("#appBtn"); await sleep(500); }, "[data-next], #amShortcut"],
  ["changelog", async (p) => { await closeAll(p); await p.click("#verBadge"); await sleep(600); }, "[data-next], #clClose"],
  // スライサー（設備で CR1・L-1 を選び、不良名を足したところ）と、表示の設定（道具の行の「表示の設定 ▾」）
  ["slicer", async (p) => { await closeAll(p); await p.click("#tabList"); await sleep(300); await p.click("#llSlicerBtn"); await sleep(400);
    // 試験の覚え（TPA_UI_STATE）で既に足してある列・選んである値は、そのまま（足し直す・押し直すと外れる）
    for (const c of ["設備", "不良名"]) if (!(await p.$(`#llSlicer .sx-card[data-col="${c}"]`))) { await p.selectOption("#llSlicerAdd", c); await sleep(700); }
    for (const v of ["CR1", "L-1"]) { const b = `#llSlicer .sx-card[data-col="設備"] .sx-v[data-v="${v}"]`; await p.waitForSelector(b);
      if ((await p.$eval(b, (x) => x.getAttribute("aria-pressed"))) !== "true") { await p.click(b); await sleep(700); } } }, "[data-next], #llSlicerAdd"],
  // タイムライン（版 3.31.0）: 発生日を「タイムライン（期間で選ぶ）」で足し、始めの取っ手を 4 割の所まで引いたところ
  ["slicer-time", async (p) => {
    if (!(await p.$('#llSlicer .tl-card[data-col="発生日"]'))) {
      await p.$eval("#llSlicerAdd", (s) => { const o = s.querySelector('option[data-kind="time"][value="発生日"]'); if (o) { o.selected = true; s.dispatchEvent(new Event("change", { bubbles: true })); } });
      await p.waitForSelector('#llSlicer .tl-card[data-col="発生日"] [data-tl-track]'); await sleep(500);
    }
    const b = await (await p.$('#llSlicer .tl-card[data-col="発生日"] [data-tl-track]')).boundingBox();
    await p.mouse.move(b.x + 1, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2, { steps: 5 }); await p.mouse.up();
    await sleep(1200);
  }, '[data-next], #llSlicer .tl-card [data-tl-h="lo"]'],
  ["profile", async (p) => { await p.click("#llProfileBtn"); await sleep(600); }, "[data-next], #llProfileMenu button"],
  // 表示列の設定（一覧の「表示列」）: 開いた直後・列を 1 つ選んだところ
  ["columns", async (p) => { await closeAll(p); await p.click("#tabList"); await sleep(300); await p.click("#llColBtn"); await sleep(600); }, "[data-next], #lcSave"],
  ["columns-detail", async (p) => { await p.click('#lcList li[data-col="発生日"]').catch(() => p.click("#lcList li[data-col]")); await sleep(500); }, "[data-next], #lcSave"],
  // 版 3.42.0: 表示列の設定の変換表の帯で「選ぶ」を開き、まとめて当てた所（当てた列の行に札）
  ["columns-conv", async (p) => { await p.click("[data-cv-more]"); await sleep(300); const b = await p.$("[data-cv-apply]:not([disabled])"); if (b) await b.click(); await sleep(600); }, "[data-next], #lcSave"],
  // 版 3.44.0: 表示列の窓の列の一覧で、作った列（変換表で足した列）を右クリックしたメニュー（作った列が無ければ 3 行目）
  ["columns-menu", async (p) => {
    await p.click('[data-cv-more][aria-expanded="true"]').catch(() => {}); await sleep(200);   // 変換表の選びを畳む（列の一覧を見せる）
    const row = (await p.$("#lcList li[data-col]:has(.lc-del)")) || (await p.$("#lcList li[data-col]:nth-child(3)"));
    await row.scrollIntoViewIfNeeded(); await sleep(100);
    const b = await row.boundingBox(); await p.mouse.click(b.x + 90, b.y + b.height / 2, { button: "right" }); await sleep(400);
  }, "[data-next], .tpa-menu button"],
  // 表示列の「この列の作り方」（いまの式の要約と「作り方を作る…」）を開いたところ
  ["columns-fx", async (p) => { await p.keyboard.press("Escape"); await sleep(150); await p.click('#lcList li[data-col="重量"]').catch(() => {}); await sleep(300); await p.click('.lc-step[data-step="fx"] > h4'); await sleep(500); }, "[data-next], #lcFxOpen"],
  // この列の作り方の窓（表示ルールと同じ組み立て）: 2 行（重量 ≧ 3000 かつ 板厚 ＜ 1 → 重・薄／重量 ≧ 3000 → 重）＋どれにも当てはまらないとき（軽）
  ["columns-fxpanel", async (p) => { await p.click("#lcFxOpen"); await sleep(500); await buildWeight(p); await sleep(400); }, "[data-next], #llFxPanel [data-act=save]"],
  // 同じ窓の「式を書く」（組み立てた式が入る。部品から作る・書き方）
  ["columns-fxwrite", async (p) => { await p.click('#llFxPanel [data-tab="write"]'); await sleep(500); }, "[data-next], #llFxPanel [data-act=save]"],
  // マスタ管理: 設備・参照先・アクセス権限・利用状況・アプリの配布（タブは DOM で押す。区分ごとにタブを隠す案でも同じ所へ行けるように）
  ["master", async (p) => { await closeAll(p); await p.click("#masterBtn"); await sleep(900); }, "[data-next], #masterAddBtn"],
  ["master-paths", async (p) => { await tab(p, "paths"); await sleep(900); }, "[data-next], #masterSettings button"],
  ["master-worklog", async (p) => { await tab(p, "worklog"); await sleep(900); }, "[data-next], #wlScan"],
  // データ元（版 3.36.0）: 品質データ・作業実績・仕掛の表と、仕掛を「変える…」で開いた欄
  ["master-sources", async (p) => { await tab(p, "sources"); await sleep(1100); }, "[data-next], #srAdd"],
  ["master-sources-edit", async (p) => { await p.click('[data-sr-edit="wip"]'); await sleep(700); }, "[data-next], #srSave"],
  ["master-shifts", async (p) => { await tab(p, "shifts"); await sleep(900); }, "[data-next], [data-sh-save]"],
  // 版 3.39.0: 設備グループ（ダッシュボードで設備を合算する組。まだ無いときは、足す所が開く）
  ["master-egroups", async (p) => { await tab(p, "egroups"); await sleep(900); }, "[data-next], [data-eg-save]"],
  // 版 3.40.0: ルールで決めたグループ（L ライン: 名前が L- で始まる）を開いた所
  ["master-egroups-rule", async (p) => { await p.evaluate(() => [...document.querySelectorAll("[data-eg-pick]")].find((b) => b.textContent.includes("L ライン")).click()); await sleep(600); }, "[data-next], [data-eg-save]"],
  // 版 3.42.0: 変換表（管理分類の判定表）と、1 行目の「形状区分」のセルを開いて直す所・試すに値を入れた所
  ["master-conv", async (p) => { await tab(p, "conv"); await sleep(900); }, "[data-next], [data-cv-save]"],
  ["master-conv-cell", async (p) => {
    await p.click(`[data-cv-cell="0|ｵｰﾀﾞｰ材質"]`); await sleep(300);
    for (const [i, v] of [[0, "4HIｺｲﾙ"], [1, "A1100"], [3, "0.5"], [4, "1200"], [5, "F975"]]) await p.fill(`[data-cv-try="${i}"]`, v);
    await sleep(300);
  }, "[data-next], [data-cv-close]"],
  // 版 3.44.0: 入力（ｵｰﾀﾞｰ材質）の当てる列を選ぶ面（データ元ごとの実際の列と値の見本）
  ["master-conv-cols", async (p) => { await p.click("[data-cv-close]").catch(() => {}); await sleep(200); await p.click('[data-cv-cols="1"]'); await p.waitForSelector(".cv-cpi"); await sleep(400); }, "[data-next], [data-cp-close]"],
  ["master-place", async (p) => { await p.keyboard.press("Escape"); await tab(p, "place"); await sleep(900); }, "[data-next], #mpGo"],
  // マスタの置き場の「📁 参照…」の窓（版 3.29.0。よく使う場所・中身の印）
  ["master-place-pick", async (p) => { await p.click("#mpForm .pp-open"); await sleep(1300); }, "[data-next], .pp-dlg .pp-go"],
  ["master-access", async (p) => { await p.click('.pp-dlg [data-pp="close"]').catch(() => {}); await tab(p, "access"); await sleep(800); }, "[data-next], #masterAddBtn"],
  ["master-presence", async (p) => { await tab(p, "presence"); await sleep(800); }, "[data-next], #masterSettings button"],
  ["master-release", async (p) => { await tab(p, "release"); await sleep(900); }, "[data-next], #masterSettings button"],
  // 待ちの窓（TPA.waiting）: 配布の置き場を初めて読むときと同じ文で、すぐ出す
  ["waiting", async (p) => {
    await p.evaluate(() => { window.__wait = TPA.waiting({ title: "アプリの配布の置き場を読んでいます", from: "C:\\boxdrive\\Box\\(D)_仕上課\\90_アプリ開発\\90_Releases",
      now: "置き場のフォルダをたどり、置いてある版（release.json）を集めています…", background: true, delay: 0,
      note: "BOX・共有の置き場は、読むのに数秒〜数十秒かかることがあります。2 回目からは前に読んだ内容をすぐ出し、裏で確かめ直します。" }); });
    await sleep(2300);
  }, "[data-next], .tpa-wait button"],
  // 版 3.32.0: 計算の 3D（ロット L7150C0 を取り込み、汚れ位置 A・B を入れて、仮の発生設備の 3D と説明を出した所）。
  // 狭い画面（フル HD・150% の 1280×720）で、3D の札どうし・札と凡例が重ならないかを見る（ui-eval-narrow.mjs）
  ["calc3d", async (p) => {
    await p.evaluate(() => window.__wait?.done?.()); await closeAll(p);
    await p.click("#tabCalc"); await sleep(300);
    await p.evaluate((html) => importLotdspHtml(html, "L7150C0", "試験の見本"), fs.readFileSync(path.join(PROGRAM, "tests/fixtures/lotdsp_progress_L7150C0.html"), "utf-8"));
    await p.waitForFunction(() => document.querySelector("#foundEquipment")?.value);
    await p.fill("#soilA", "660"); await p.press("#soilA", "Tab"); await p.fill("#soilB", "663.73"); await p.press("#soilB", "Tab");
    await p.waitForSelector("#explainStage canvas"); await sleep(1500);
  }, "[data-next], #explainTextToggle"],
  // 版 3.32.0: 作業実績の設備が多い所（24 台。試験の 12 台に、作り物の 12 台を足して答える）。設備のタブが 1 段に収まるかを見る
  ["worklog-many", async (p) => {
    await p.route("**/api/worklog/files*", async (route) => {
      const res = await route.fetch(), d = await res.json();
      const base = (d.items || []).filter((x) => x.state !== "missing");
      const more = Array.from({ length: 12 }, (_, i) => ({ ...base[i % base.length], key: `extra-${i}`, name: `${["FS", "AP", "NS", "LS", "CR", "SL"][i % 6]}${i + 4}` }));
      await route.fulfill({ response: res, json: { ...d, items: [...(d.items || []), ...more] } });
    });
    await p.reload(); await p.waitForSelector("#llBody tr[data-i]");
    await p.click("#tabWork"); await p.waitForSelector("#llEquipBar .eq-chip"); await sleep(900);
  }, "[data-next], #llEquipBar [aria-selected=false]"],
  // 版 3.35.0: 推奨アップデートの札が付いた版（3.13.0）が配られ、この PC が取り込み済み（開き直せば新しい版）。品質異常で使っている所
  ["update-recommended", async (p) => {
    await p.route("**/__desktop/update", (route) => route.fulfill({ json: UPDATE_RECOMMENDED }));
    await p.click("#tabList"); await sleep(400);
    await p.evaluate(() => pollUpdate()); await sleep(900);
  }, "[data-next], #verNew"],
  // ダッシュボード（版 3.37.0 からグリッドのパネル・最初の画面）: 組み込みの標準を見る所・1 枚の表の条件の面・編集・パネルを組む所（仕掛区分ごと）
  ["dash", async (p) => {
    // 前の案の撮影で入れ替えた・外した組み込みの標準を戻す（版 3.48.0。案ごとに同じサーバーで続けてたどるので）
    const reset = await p.evaluate(async () => {
      const d = await (await fetch("/api/dashboards")).json();
      if (!(d.hidden || []).length && !(d.items || []).some((x) => x.replaces)) return false;
      for (const x of (d.items || []).filter((y) => y.replaces)) await fetch(`/api/dashboards/${x.id}`, { method: "DELETE" });
      for (const scope of ["default", "me"]) await fetch("/api/dashboards-hidden", TPA.json("PUT", { scope, keys: [] }));
      TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState(); return true;
    });
    if (reset) await p.reload();
    await closeAll(p); await p.click("#tabDash"); await waitDash(p); await sleep(400);
  }, "[data-next], [data-db-editmode]"],
  // 版 3.46.0: 稼働（ガント）と ABC 分析・換算係数のパネル
  ["dash-ops", async (p) => { await p.evaluate((l) => Dashboard._setLayout(l), OPS_LAYOUT); await sleep(500); await waitDash(p); await sleep(600); }, "[data-next], [data-db-editmode]"],
  // 版 3.47.0: 組む所の ABC の品種（合金 × 調質 の組み合わせの札）
  ["dash-ops-edit", async (p) => {
    await p.click("[data-db-editmode]"); await sleep(400);
    await p.click('#dashGrid .db-p[data-id="abc"] [data-db-edit]'); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(600);
  }, "[data-next], [data-de-apply]"],
  // 版 3.48.0: 組む所の ABC で、全設備の時間をリードタイムにし、出す項目の「換算本数」「下の段」を外した所（パネルも描き直る）
  ["dash-ops-lead", async (p) => {
    await p.click('.de-seg:has([data-de-ospan][value="lead"])'); await sleep(300);
    await p.click('[data-de-ohide="conv"]'); await p.click('[data-de-ohide="foot"]'); await waitDash(p); await sleep(900);
  }, "[data-next], [data-de-apply]"],
  // 版 3.48.0: ガントのパネルを組む所で、設備の並びを「手で並べる」にした所（設備の札と ← →）
  ["dash-eorder", async (p) => {
    await p.click("[data-de-cancel]"); await sleep(400);
    await p.click('#dashGrid .db-p[data-id="gantt"] [data-db-edit]'); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
    await p.click('.de-seg:has([data-de-eord][value="hand"])'); await p.waitForSelector("[data-de-eomove]"); await sleep(300);
    await p.click('[data-de-eomove="4"][data-d="-1"]'); await waitDash(p); await sleep(900);
  }, "[data-next], [data-de-apply]"],
  // 版 3.46.0: 組み合わせのグラフと、組む所の書式の「系列」（系列ごとの形・目盛り）
  ["dash-combo", async (p) => {
    await p.evaluate((l) => Dashboard._setLayout(l), COMBO_LAYOUT); await sleep(500); await waitDash(p);
    await p.click("[data-db-editmode]"); await sleep(400);
    await p.click('#dashGrid .db-p[data-id="combo"] [data-db-edit]'); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(600);
    await p.evaluate(() => { const m = document.querySelector("#dbEditor .de-main"), f = document.querySelector("#dbEditor .de-sers");
      if (m && f) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 160); }); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  // 版 3.46.0: ダッシュボードのセット（標準のセット「現場の朝」＝標準・稼働・品種の ABC をタブで）と、セットの面
  ["dash-set", async (p) => {
    await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);
    await p.click("[data-db-leave]").catch(() => {}); await p.click("[data-db-discard]").catch(() => {}); await sleep(300);
    await p.evaluate(async ([ops]) => {
      // 前の案で作ったセット・ダッシュボードを片付けてから作る（撮影は案ごとに同じサーバーで続けてたどるので、名前がぶつかる）
      for (const x of (await (await fetch("/api/dashboard-sets")).json()).items || []) await fetch(`/api/dashboard-sets/${x.id}`, { method: "DELETE" });
      for (const x of ((await (await fetch("/api/dashboards")).json()).items || []).filter((y) => !y.builtin)) await fetch(`/api/dashboards/${x.id}`, { method: "DELETE" });
      const mk = async (name, panels) => (await (await fetch("/api/dashboards", TPA.json("POST", { name, scope: "all", body: { rows: 8, panels } }))).json()).id;
      const g = await mk("稼働", [{ ...ops.panels[0], h: 8 }]), a = await mk("品種の ABC", [{ ...ops.panels[1], y: 0, h: 8 }]);
      await fetch("/api/dashboard-sets", TPA.json("POST", { name: "現場の朝", scope: "default", standard: true, body: { items: ["b:standard", String(g), String(a)] } }));
      await fetch("/api/dashboard-sets", TPA.json("POST", { name: "品質の会議", scope: "default", body: { items: ["b:standard", String(a)] } }));
      TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState();
    }, [OPS_LAYOUT]);
    // 開き直すと頁の印（#screen=list）で一覧が開くので、ダッシュボードへ移ってから待つ
    await p.reload(); await p.click("#tabDash"); await waitDash(p); await sleep(800);
  }, "[data-next], [data-db-tab]"],
  ["dash-set-pop", async (p) => { await p.click("[data-db-pick]"); await sleep(500); }, "[data-next], [data-db-setsave]"],
  // 後片付け（撮らない）: セットとセットのために作ったダッシュボードを消し、標準のダッシュボードに戻す（ほかの状態の道具の行に、セットのタブを出さない）
  ["dash-set-off", async (p) => {
    await p.keyboard.press("Escape");
    await p.evaluate(async () => {
      const sets = (await (await fetch("/api/dashboard-sets")).json()).items || [];
      for (const x of sets) await fetch(`/api/dashboard-sets/${x.id}`, { method: "DELETE" });
      const ds = (await (await fetch("/api/dashboards")).json()).items || [];
      for (const x of ds.filter((y) => !y.builtin)) await fetch(`/api/dashboards/${x.id}`, { method: "DELETE" });
      TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState();
    });
    // 開き直すと頁の印（#screen=list）で一覧が開くので、ダッシュボードへ移ってから待つ（版 3.48.0 で直した: 前は待ち切れなかった）
    await p.reload(); await p.click("#tabDash"); await waitDash(p); await sleep(400);
  }, "[data-next], [data-db-editmode]"],
  // 版 3.48.0: 積み上げ横棒・100%積み上げ横棒（設備 × 直・作業区分 × 直）と、組み込みの標準を入れ替えた所・外した所の面
  ["dash-hstack", async (p) => { await p.evaluate((l) => Dashboard._setLayout(l), HSTACK_LAYOUT); await sleep(500); await waitDash(p); await sleep(600); }, "[data-next], [data-db-editmode]"],
  ["dash-swap-pop", async (p) => {
    await p.evaluate(async (l) => {
      await fetch("/api/dashboards", TPA.json("POST", { name: "標準", scope: "default", standard: true, body: { ...l, replaces: "standard" } }));
      TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState();
    }, HSTACK_LAYOUT);
    await p.reload(); await p.click("#tabDash"); await waitDash(p); await sleep(500);
    await p.click("[data-db-pick]"); await sleep(500);
  }, "[data-next], [data-db-unswap]"],
  ["dash-hide-pop", async (p) => {
    await p.click("[data-db-remove]"); await sleep(200); await p.click("[data-db-remove]"); await sleep(900);
    await p.click("[data-db-pick]"); await sleep(500);
  }, "[data-next], [data-db-unhide]"],
  // 後片付け（撮らない）: 入れ替えた物・外した組み込みを戻す
  ["dash-swap-off", async (p) => {
    await p.keyboard.press("Escape");
    await p.evaluate(async () => {
      for (const x of ((await (await fetch("/api/dashboards")).json()).items || []).filter((y) => !y.builtin)) await fetch(`/api/dashboards/${x.id}`, { method: "DELETE" });
      for (const scope of ["default", "me"]) await fetch("/api/dashboards-hidden", TPA.json("PUT", { scope, keys: [] }));
      TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState();
    });
    await p.reload(); await p.click("#tabDash"); await waitDash(p); await sleep(400);
  }, "[data-next], [data-db-editmode]"],
  // 版 3.44.0: パネル（仕掛区分ごと）を右クリックしたメニュー
  ["dash-menu", async (p) => {
    const b = await (await p.$('#dashGrid .db-p[data-id="wipClass"]')).boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" }); await sleep(400);
  }, "[data-next], .tpa-menu button"],
  // 版 3.39.0: パネルを絞る面（見出しの「絞る」→ 設備・値で絞る〈製造材質の値の候補〉）
  ["dash-filter", async (p) => {
    await p.keyboard.press("Escape"); await closeAll(p);
    await p.evaluate(() => document.querySelector('#dashGrid .db-p[data-id="wipClass"] [data-db-filter]').click()); await p.waitForSelector("[data-df-col]"); await sleep(1500);
    await p.evaluate(() => { const s = document.querySelector("[data-df-col]"); s.value = "製造材質"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.waitForSelector(".df-vf [data-vf-v]"); await sleep(400);
  }, "[data-next], [data-df-close]"],
  ["dash-edit", async (p) => { await closeAll(p); await p.evaluate(() => window.DashFilter && DashFilter.close()); await p.click("[data-db-editmode]"); await sleep(500); }, "[data-next], .db-cell"],
  // 版 3.44.0: 編集で空いたマスを右クリックしたメニュー（ここにパネルを足す・貼り付け）
  ["dash-gridmenu", async (p) => {
    // 空いたマスが無ければ（組み込みの標準は埋まっている）、パネルの間のすき間を右クリック
    const c = await p.$(".db-cell"), b = c ? await c.boundingBox() : await (await p.$('#dashGrid .db-p[data-id="wipClass"]')).boundingBox();
    await p.mouse.click(c ? b.x + b.width / 2 : b.x + b.width + 5, b.y + b.height / 2, { button: "right" }); await sleep(400);
  }, "[data-next], .tpa-menu button"],
  ["dash-panel", async (p) => {
    await p.keyboard.press("Escape"); await sleep(150);
    // 組む: 見出しの「組む」（狭いパネルは「⋯」に畳まれるので、選んで Enter）
    const b = await p.$('#dashGrid .db-p[data-id="wipClass"] [data-db-edit]');
    if (b) await b.click(); else { await p.focus('#dashGrid .db-p[data-id="wipClass"]'); await p.keyboard.press("Enter"); }
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  // 版 3.45.0: 組む所の条件（製造材質の値で絞る面を開き、A5052 を外した所。カラムの欄を広げた形）
  ["dash-cond", async (p) => {
    await p.focus("#dbEditor .de-split"); await p.keyboard.press("Shift+ArrowRight"); await sleep(400);   // カラムの欄を 64px 広げる
    await p.selectOption("#deCond [data-de-fpick]", "製造材質"); await p.waitForSelector(".vf-pop [data-vf-v]"); await sleep(300);
    await p.click('.vf-pop [data-vf-v="A5052"]'); await sleep(300);
  }, "[data-next], .vf-pop [data-vf-ok]"],
  // 版 3.39.0: 組む所の書式（直近 14 日の実績本数の時系列を組み、書式の所まで送る。案の置き方が書式を別の所に出すなら tpa-show-fmt で知らせる）
  ["dash-panel-fmt", async (p) => {
    await p.click("[data-de-cancel]"); await sleep(400);
    await p.evaluate(() => TPA.local.set("tpa.dash.editor.v1", {}));
    await p.focus('#dashGrid .db-p[data-id="workDays"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
    // 組む所の中だけを送る（scrollIntoView は外の枠まで送り、組む所の見出し〈やめる・当てる〉が窓の上に出ていた: 2026-10-dashmore の 1 回目の採点）
    await p.evaluate(() => { document.dispatchEvent(new CustomEvent("tpa-show-fmt"));
      const m = document.querySelector("#dbEditor .de-main"), f = document.querySelector("#deFmt");
      if (m && f && f.offsetParent) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 120);
      window.scrollTo(0, 0); }); await sleep(500);
  }, "[data-next], [data-de-apply]"],
  // 版 3.38.0: 合わせた表（設備ごとの仕掛と前日の実績）を組む所。表全体（行の段・並び・行の札）と、列のまとまり ②（前日の実績本数）
  ["dash-board", async (p) => {
    await p.click("[data-de-cancel]"); await sleep(400);
    const b = await p.$('#dashGrid .db-p[data-id="board"] [data-db-edit]');
    if (b) await b.click(); else { await p.focus('#dashGrid .db-p[data-id="board"]'); await p.keyboard.press("Enter"); }
    await p.waitForSelector("#deBoard .de-rowi[data-de-row]"); await waitDash(p); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  ["dash-board-group", async (p) => { await p.click('[data-de-tab="1"]'); await p.waitForSelector("#deFields .pv-f"); await sleep(600); }, "[data-next], [data-de-apply]"],
  // 版 3.40.0: 設備を 3 つ選んだパネル（直近 14 日）の出し方（重ねる＝設備ごとの系列）・並べる・別のデータと合わせる（実績の札・全体の札）・
  // 設備グループ（ライン別）→ 設備の 2 段の表と小計
  ["dash-split", async (p) => {
    await p.click("[data-de-cancel]"); await sleep(400);
    await p.focus('#dashGrid .db-p[data-id="workDays"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
    await p.click("[data-de-eqopen]"); await p.waitForSelector("[data-ck-deq]"); await sleep(300);
    for (const n of ["CR1", "L-1", "L-2"]) await p.evaluate((n) => document.querySelector(`[data-ck-deq="${n}"]`).click(), n);
    await p.click("[data-de-eqopen]"); await sleep(600); await waitDash(p); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  ["dash-facet", async (p) => { await p.evaluate(() => document.querySelector('input[data-de-split][value="facet"]').click()); await sleep(800); await waitDash(p); await sleep(400); }, "[data-next], [data-de-apply]"],
  ["dash-link", async (p) => { await p.evaluate(() => document.querySelector('input[data-de-linkmode][value="link"]').click()); await p.waitForSelector("#deFields .pv-f"); await sleep(1200); await waitDash(p); await sleep(400); }, "[data-next], [data-de-apply]"],
  ["dash-link-whole", async (p) => { await p.click('[data-de-tab="-1"]'); await sleep(800); await waitDash(p); await sleep(300); }, "[data-next], [data-de-apply]"],
  ["dash-subtotal", async (p) => {
    await p.click("[data-de-cancel]"); await sleep(400);
    await p.focus('#dashGrid .db-p[data-id="workDays"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
    await p.evaluate(() => document.querySelector('[data-de-vis="none"]').click()); await sleep(300);
    await p.click('[data-de-x="rows"][data-i="0"]'); await sleep(300);
    await p.click('[data-de-add="rows"][data-col="@egroup"]'); await sleep(300);
    await p.click('[data-de-add="rows"][data-col="@equip"]'); await sleep(300);
    await p.click("[data-de-sub]"); await sleep(800); await waitDash(p); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  // 版 3.41.0: ダッシュボードのスライサー（期間＝先月・設備＝L ライン）・「設備…」の面・系列ごとの書式（設備 3 つの折れ線・数値を付ける）・
  // 合わせた表の行を設備グループの見出しの下に（ライン別）まとめて引いている途中（ゴーストと入る所の線）・四隅の取っ手
  ["dash-slicer", async (p) => {
    await p.click("[data-de-cancel]").catch(() => {}); await sleep(400);
    await p.click("[data-db-leave]").catch(() => {}); await sleep(300);
    if (await p.$("[data-db-discard]")) { await p.click("[data-db-discard]"); await sleep(600); }
    await waitDash(p);
    if (await p.$('[data-ds-period="last_month"]')) await p.click('[data-ds-period="last_month"]'); else await p.selectOption("[data-ds-psel]", "last_month");
    await sleep(400); await waitDash(p);
    if (await p.$('[data-ds-group="L ライン"]')) await p.click('[data-ds-group="L ライン"]'); else await p.selectOption("[data-ds-gsel]", "L ライン");
    await sleep(600); await waitDash(p); await sleep(400);
  }, "[data-next], #dashSlicer, [data-ds-clear]"],
  ["dash-slicer-pick", async (p) => {
    if (await p.$("[data-ds-pick]:not([hidden])")) await p.click("[data-ds-pick]"); else await p.selectOption("[data-ds-gsel]", "@pick");
    await p.waitForSelector(".db-slicepop [data-ds-eq]"); await sleep(400);
  }, "[data-next], [data-ds-done]"],
  ["dash-series", async (p) => {
    await p.keyboard.press("Escape"); await sleep(200);
    if (await p.$("[data-ds-clear]")) { await p.click("[data-ds-clear]"); await sleep(500); await waitDash(p); }
    await p.click("[data-db-editmode]"); await sleep(400);
    await p.focus('#dashGrid .db-p[data-id="workDays"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
    await p.click("[data-de-eqopen]"); await p.waitForSelector("[data-ck-deq]"); await sleep(300);
    for (const n of ["CR1", "L-1", "L-2"]) await p.evaluate((n) => document.querySelector(`[data-ck-deq="${n}"]`).click(), n);
    await p.click("[data-de-eqopen]"); await sleep(600); await waitDash(p);
    await p.evaluate(() => { if (!document.querySelector('[data-de-vis="line"]')) document.querySelector("[data-de-formmore]").click(); document.querySelector('[data-de-vis="line"]').click(); });
    await sleep(800); await waitDash(p);
    await p.evaluate(() => document.querySelector('input[data-de-flabels][value="top"]').click()); await sleep(800); await waitDash(p); await sleep(300);
    await p.evaluate(() => { document.dispatchEvent(new CustomEvent("tpa-show-series"));
      const m = document.querySelector("#dbEditor .de-main"), f = document.querySelector("#dbEditor .de-sers") || document.querySelector("#deFmt");
      if (m && f && f.offsetParent) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 260);
      window.scrollTo(0, 0); }); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  ["dash-tree", async (p) => {
    await p.click("[data-de-cancel]"); await sleep(400);
    await p.focus('#dashGrid .db-p[data-id="board"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#deBoard .de-rowi[data-de-row]"); await waitDash(p); await sleep(300);
    await p.selectOption("[data-de-btree]", "ライン別"); await sleep(1200); await waitDash(p); await sleep(400);
    // 「グループなし」の 1 つ目を 3 つ目の下へ引いている途中（指を離さずに撮る）
    const r = await p.evaluate(() => { const m = document.querySelector("#dbEditor .de-main"), lis = [...document.querySelectorAll("#deBoard [data-de-row]")].filter((x) => x.closest(".de-rgrp.is-none"));
      if (!lis.length) return null; m.scrollTop = Math.max(0, lis[0].getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 200);
      const g = lis[0].querySelector("[data-de-grip]").getBoundingClientRect(), t = lis[2].getBoundingClientRect(); return { a: [g.x + g.width / 2, g.y + g.height / 2], b: [t.x + 80, t.y + t.height * 0.8] }; });
    if (!r) return;
    await p.mouse.move(...r.a); await p.mouse.down(); await p.mouse.move(r.a[0], r.a[1] + 8, { steps: 2 }); await p.mouse.move(...r.b, { steps: 6 }); await sleep(300);
  }, "[data-next], [data-de-apply]"],
  ["dash-corners", async (p) => {
    await p.keyboard.press("Escape"); await p.mouse.up(); await sleep(300);
    await p.click("[data-de-cancel]").catch(() => {}); await sleep(500); await waitDash(p);
    const b = await p.evaluate(() => { const e = document.querySelector('#dashGrid .db-p[data-id="wipClass"] .db-pb').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; });
    await p.mouse.click(...b); await p.mouse.move(b[0] + 5, b[1]); await sleep(300);
  }, "[data-next], .db-cell"],
  // 版 3.43.0: 数字のパネル（前日の実績本数）を組み、書式の表示形式を「数値・小数 1 桁」・単位を「本/日」にした所（版 3.45.0 から数字の後ろの字は単位の欄）（書式の所まで送る）
  ["dash-kpi-fmt", async (p) => {
    await p.focus('#dashGrid .db-p[data-id="workTotal"]'); await p.keyboard.press("Enter");
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(300);
    const pick = (sel, v) => p.evaluate(([s, x]) => { const e = document.querySelector(s); e.focus(); e.value = x; e.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
    await p.click('#dbEditor input[data-de-fncat][value="num"]', { force: true }); await sleep(300);
    await pick("#dbEditor [data-de-fndec]", "1"); await sleep(300);
    await p.fill("#dbEditor [data-de-futext]", "本/日"); await sleep(600); await waitDash(p);   // 版 3.45.0: 数字の後ろの字は単位の欄
    await p.fill("#dbEditor [data-de-fexpr]", "×10"); await sleep(700); await waitDash(p);       // 版 3.45.0: 数の計算（値×10）
    await p.evaluate(() => { document.dispatchEvent(new CustomEvent("tpa-show-fmt"));
      const m = document.querySelector("#dbEditor .de-main"), f = document.querySelector("#deFmt");
      if (m && f && f.offsetParent) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 120);
      window.scrollTo(0, 0); }); await sleep(400);
  }, "[data-next], [data-de-apply]"],
  // 仕掛（データ元 wip。版 3.36.0）: 見出しの「仕掛」のタブで、品質異常と同じ部品の一覧
  ["wip", async (p) => { await closeAll(p); await p.click('[data-screen="src:wip"]'); await sleep(3000); }, "[data-next], #llSearch"],
  // 同じ知らせを作業実績の画面で（どの画面でも同じ所に出るか）
  ["update-recommended-work", async (p) => {
    await p.route("**/__desktop/update", (route) => route.fulfill({ json: UPDATE_RECOMMENDED }));
    await p.click("#tabWork"); await sleep(2500);
    await p.evaluate(() => pollUpdate()); await sleep(900);
  }, "[data-next], #verNew"],
  // 配布の画面で、配っている版（3.13.0）に推奨の札が付いている所（update-recommended の知らせと同じ版）
  ["master-release-recommended", async (p) => {
    await p.route(/\/__desktop\/release(\?|$)/, (route) => route.fulfill({ json: { ...RELEASE, distributed: { ...RELEASE.distributed,
      version: "3.13.0", previous: "3.12.0", setAt: "2026-10-15T09:05:00",
      recommended: { note: "ほかの PC がマスタの置き場に追従しない不具合を直しました", setAt: "2026-10-15T09:06:00", setBy: "user", setPc: "PC-01" } } } }));
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
    await tab(p, "release"); await sleep(900);
  }, "[data-next], #masterSettings button"],
  // 版 3.38.1: 配っている版（推奨の札なし）の「推奨にする」を押した直後（要望: 理由の欄でボタンが見切れる → 欄は無くし、押すだけで付く）
  ["master-release-recask", async (p) => {
    let rec = null;
    await p.route(/\/__desktop\/release(\?|$)/, (route) => route.fulfill({ json: { ...RELEASE, distributed: { ...RELEASE.distributed,
      version: "3.13.0", previous: "3.12.0", setAt: "2026-10-15T09:05:00", ...(rec ? { recommended: rec } : {}) } } }));
    await p.route("**/__desktop/release/recommend", (route) => {
      const b = route.request().postDataJSON();
      rec = b.on ? { setAt: "2026-10-16T22:21:00", setBy: "user", setPc: "PC-01" } : null;
      return route.fulfill({ json: { version: b.version, recommended: rec } });
    });
    await tab(p, "paths"); await sleep(300); await tab(p, "release"); await p.waitForSelector("[data-rec-on]"); await sleep(500);
    await p.click("[data-rec-on]"); await p.waitForSelector("[data-rec-off]"); await sleep(500);
  }, "[data-next], [data-rec-off]"],
  // 版 3.43.0: 保存していない変更の窓（変換表の名前を変えて、勤務体系のタブを押した所）
  ["unsaved", async (p) => {
    await tab(p, "conv"); await p.waitForSelector("[data-cv-save]"); await sleep(400);
    await p.fill("#cvName", "管理分類（直した）"); await p.press("#cvName", "Tab");
    await tab(p, "shifts"); await p.waitForSelector(".us-card"); await sleep(300);
  }, "[data-next], .us-card [data-us=back]"],
];

// 起動画面の状態（窓が伝える事実の作り物。main.rs の start と同じ順・同じ文）: 中身を起こしている途中と、Python が無くて止まったところ
const APP = "C:\\Users\\user\\AppData\\Local\\LotScope\\app\\program";
const PY = "C:\\Users\\user\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
export const SPLASH_STATES = [
  ["splash", async (p) => {
    await p.evaluate(([app, py]) => { splash.version?.("3.16.0"); splash.step("program", "ok", app); splash.step("python", "ok", py); splash.step("backend", "now", "Python でアプリの中身を読み込んでいます…"); }, [APP, PY]);
    await sleep(1300);
  }, "[data-next]"],
  // 実際の流れと同じく、まっさらな起動画面から: 中身は見つかり、Python を探している段で止まる
  ["splash-fail", async (p) => {
    await p.reload();
    await p.evaluate(([app]) => {
      splash.brand("LotScope", "転写距離・ピッチ解析");
      splash.version?.("3.16.0");
      splash.step("program", "ok", app);
    }, [APP]);
    await sleep(1500);   // 探して見つからないまでの間（経過の秒が 0 にならないように）
    await p.evaluate(() => {
      splash.step("python", "bad", "見つかりません");
      splash.fail("Python が見つかりません", "Python が見つかりません。\n探した場所:\nPATH の python.exe\npy ランチャー（py -3）\nC:\\Users\\user\\AppData\\Local\\Programs\\Python\\Python3*\\python.exe\nMicrosoft Store の入口だけがあり、Python は入っていません（使いません）:\nC:\\Users\\user\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe");
    });
    await sleep(300);
  }, "[data-next]"],
];
export const SPLASH_NAMES = SPLASH_STATES.map(([name]) => name);

/** 起動画面の状態を順に進める（walk と同じ形） */
export async function walkSplash(page, visit, only = null) {
  for (const [name, go, next] of SPLASH_STATES) {
    await go(page);
    if (!only || only.includes(name)) await visit(name, next);
  }
}

/** すぐに見るの最初の札を押す（改良案で札を別の所へ写しても効くよう、頁の中で押す） */
const quick = (p) => p.evaluate(() => document.querySelector("#llPivot .pv-quick:not([disabled])").click());

/** 集計表・グラフの形を選ぶ（形の札が見えていれば押す。無ければ形を選ぶ所〈[data-pv-pick]〉を開いて押す） */
export async function pickChart(p, kind) {
  const sel = `#llPivot [data-pv-chart="${kind}"], #llPvChartPop [data-pv-chart="${kind}"]`;
  if (!(await p.$(sel).then((b) => b && b.isVisible()))) await p.click("#llPivot [data-pv-pick]").catch(() => {});
  await p.click(sel);
}

/** 件数の行の「効いている物」のタブ（まとめ group・並べ替え sort・選んだ値 slicer・色付け marks）を押して、その札の面を開く（開いていればそのまま）。
    札（#llGroupBar・#llSortBar・#llSlicerSum・#llMarkSum）は版 3.25.0 からこの面の中にある */
export async function openActive(p, kind) {
  const open = await p.evaluate((k) => { const pp = document.querySelector("#llActivePop"); return !!pp && !pp.hidden && pp.dataset.kind === k; }, kind);
  if (!open) { await p.click(`#llActiveTabs [data-kind="${kind}"]`); await sleep(250); }
}

/** この列の作り方の窓で、重量の列の作り方を組み立てる（表示ルールと同じ組み立て。状態 columns-fxpanel と評価関数 ui-eval-formula.mjs）:
    1 行目 重量 ≧ 3000 かつ 板厚 ＜ 1 → 重・薄／2 行目 重量 ≧ 3000 → 重／どれにも当てはまらないとき → 軽 */
export async function buildWeight(p) {
  const P = "#llFxPanel .lr-rows", row = (i) => `${P} .lr-row[data-row="${i}"]`;
  await p.click('#llFxPanel [data-act="row"]'); await p.click('#llFxPanel [data-act="default"]'); await sleep(150);
  await p.selectOption(`${row(0)} .lr-op[data-path="0.0"]`, "ge");
  await p.fill(`${row(0)} .lr-val[data-path="0.0"][data-side="right"]`, "3000");
  await p.click(`${row(0)} .lr-row-then .lr-cond-add[data-join="and"]`); await sleep(100);
  await p.selectOption(`${row(0)} .lr-kind[data-path="0.1"][data-side="left"]`, "column");
  await p.selectOption(`${row(0)} .lr-col[data-path="0.1"]`, "板厚");
  await p.selectOption(`${row(0)} .lr-op[data-path="0.1"]`, "lt");
  await p.fill(`${row(0)} .lr-val[data-path="0.1"][data-side="right"]`, "1");
  await p.fill(`${row(0)} .lr-text`, "重・薄");
  await p.selectOption(`${row(1)} .lr-op[data-path="1.0"]`, "ge");
  await p.fill(`${row(1)} .lr-val[data-path="1.0"][data-side="right"]`, "3000");
  await p.fill(`${row(1)} .lr-text`, "重");
  await p.fill(`${row(2)} .lr-text`, "軽");
}

/** マスタ管理のタブを押す（見えていなくても押す） */
function tab(p, key) {
  return p.$eval(`#masterTabs [data-tab="${key}"]`, (b) => b.click());
}

/** 状態を順に進め、各状態で visit(名前, 次に押すべきもの) を呼ぶ（only を渡せば、その状態だけ） */
export async function walk(page, visit, only = null, from = "") {
  page.setDefaultTimeout(5000);   // 見つからない部品で 30 秒止まらない
  const last = only ? Math.max(...STATES.map(([name], i) => (only.includes(name) ? i : -1))) : STATES.length - 1;
  // from（版 3.46.0）… その状態からたどる（前の状態の積み重ねが要らない状態だけを撮るとき。ダッシュボードの状態は "dash" から）
  const first = from ? Math.max(0, STATES.findIndex(([name]) => name === from)) : 0;
  for (const [name, go, next] of STATES.slice(first, last + 1)) {   // 撮る状態のうち最後の物まで（その先へは進まない）
    try {
      await go(page);
    } catch (e) {
      console.warn(`${name}: ${e.message.split("\n")[0]}`);
    }
    if (!only || only.includes(name)) await visit(name, next);
  }
}

/**
 * 画面の中で測る（page.evaluate に渡す。next: 主の行動の選び方）。
 *   next      … その状態で次に押すべきもの（主の行動）が、スクロールせずに見えているか・大きさ（px²）・押せるか
 *   primaries … 見えている主のボタン（塗りの .btn-primary）の数（1 つが望ましい: どれを押すか迷わない）
 *   controls  … 見えている操作の数（Hick の法則: 選択肢が多いほど迷う）と、スクロールしないと見えない操作の数
 *   text      … 見えている文字数（読む量）
 *   hidden    … 開いている浮かぶ窓・メニューの中で、スクロールしないと見えない高さ（px）
 *   cut       … 開いている浮かぶ窓・メニューが画面の下・右からはみ出した長さ（px。0 でないと届かない所がある）
 *   fonts     … 使っている文字の大きさの種類と、いちばん小さい文字（px）
 *   contrast  … 見えている文字のコントラスト比の最小（WCAG。4.5 未満は読みにくい）
 *   list      … 一覧（表）が画面に占める割合（ほかの欄が重なっている部分は除く）
 */
export function measure(nextSelector) {
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest("[hidden], .hidden");
  };
  const inView = (r) => r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  // 色 → [r, g, b, a]（0〜255）。color-mix() の結果は color(srgb r g b / a)（0〜1）で返るので、255 倍する
  const rgb = (c) => {
    const n = (c.match(/[\d.]+/g) ?? []).map(Number);
    return c.startsWith("color(srgb") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : n;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // 文字の後ろの色（半透明は重ねる。グラデーション・画像の上は測らない）
  function backdrop(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return null;
      const [r, g, b, a = 1] = rgb(s.backgroundColor);
      if (a > 0) layers.push([r, g, b, a]);
      if (a >= 1) break;
    }
    let base = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
    return base;
  }
  // 開いている浮かぶ窓（重なる窓・メニュー）。あればその中だけを数える
  const DIALOGS = ".master-form-overlay:not(.hidden), .master-overlay:not(.hidden), #llColumnPanel:not([hidden]), #llFxPanel:not([hidden]), #llRulePanel:not([hidden])";
  const pops = [...document.querySelectorAll(`${DIALOGS}, .ll-viewmenu:not([hidden]), .app-menu:not(.hidden), .fb-cond-menu:not([hidden])`)].filter(visible);
  // 重なる窓（いちばん上の 1 枚）。あればその中だけを数える
  const dialog = pops.filter((el) => el.matches(DIALOGS)).sort((a, b) => (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0] ?? null;
  const scope = (el) => !dialog || dialog.contains(el);
  const controls = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, summary, [role=button]")].filter(visible);
  const seen = controls.filter((el) => inView(el.getBoundingClientRect()));
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    if (t && visible(n.parentElement) && scope(n.parentElement) && inView(n.parentElement.getBoundingClientRect())) texts.push([n.parentElement, t]);
  }
  const sizes = new Map();
  let minContrast = 99, worst = "";
  for (const [el, t] of texts) {
    const s = getComputedStyle(el);
    sizes.set(s.fontSize, (sizes.get(s.fontSize) ?? 0) + t.length);
    const bg = backdrop(el);
    if (!bg) continue;
    const [r, g, b, a = 1] = rgb(s.color);
    if (a === 0) continue;                       // わざと透明にした字（繰り返しを省いた値）は読ませる字ではない
    const fg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    const c = ratio(fg, bg);
    if (c < minContrast) [minContrast, worst] = [c, t.slice(0, 24)];
  }
  // 書いた順に探す（新しい画面の data-next を、前の画面の部品より先に）
  const next = (nextSelector ?? "").split(",").map((sel) => sel.trim()).filter(Boolean)
    .map((sel) => [...document.querySelectorAll(sel)].find((el) => visible(el) && scope(el))).find(Boolean) ?? null;
  const primaries = [...document.querySelectorAll(".btn-primary")].filter((el) => visible(el) && scope(el) && inView(el.getBoundingClientRect())).length;
  const nr = next?.getBoundingClientRect();
  const boxes = pops.map((el) => (/overlay/.test(el.className) ? el.firstElementChild : el)).filter(Boolean);
  const hidden = Math.max(0, ...boxes.map((el) => el.scrollHeight - el.clientHeight));
  const cut = Math.max(0, ...boxes.map((el) => { const r = el.getBoundingClientRect(); return Math.max(r.bottom - innerHeight, r.right - innerWidth); }));
  // 一覧の見えている面積: 一覧の枠から、上に重なる欄（浮かぶ窓など）を 8px 刻みで除く
  let list = 0;
  const wrap = document.querySelector("#lotListScreen:not([hidden]) .ll-grid-wrap");
  const box = wrap && visible(wrap) ? wrap.getBoundingClientRect() : null;
  if (box && !dialog) {
    let shown = 0, all = 0;
    for (let y = Math.max(0, box.top) + 4; y < Math.min(innerHeight, box.bottom); y += 8) {
      for (let x = Math.max(0, box.left) + 4; x < Math.min(innerWidth, box.right); x += 8) {
        all++;
        if (document.elementFromPoint(x, y)?.closest(".ll-grid-wrap")) shown++;
      }
    }
    list = all ? (shown / all) * ((box.width * box.height) / (innerWidth * innerHeight)) : 0;
  }
  return {
    next: next ? { selector: nextSelector, visible: visible(next) && inView(nr), enabled: !next.disabled, area: Math.round(nr.width * nr.height), top: Math.round(nr.top) } : null,
    primaries,
    controls: { visible: (dialog ? seen.filter(scope) : seen).length, belowFold: controls.filter((el) => scope(el) && !inView(el.getBoundingClientRect())).length },
    text: { visible: texts.reduce((n, [, t]) => n + t.length, 0) },
    hidden: Math.round(hidden),
    cut: Math.round(cut),
    fonts: { kinds: sizes.size, min: Math.min(...[...sizes.keys()].map(parseFloat)) },
    contrast: { min: Number(minContrast.toFixed(2)), worst },
    list: Number(list.toFixed(2)),
  };
}
