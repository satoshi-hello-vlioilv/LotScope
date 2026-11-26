// 画面の撮影の共通部分（開発用。ui-check.mjs・ui-variants.mjs が使う。元は Inventor の同じ名前の道具）。
//
// 開発用サーバーを起こし、Playwright の Chromium（WebView2 と同じ系統）で、
// 利用者の画面と同じ大きさ（2160×1440・表示倍率 125% → 1728×1152）の頁を開く。
// 開発用サーバー（版 3.118.2）: 既定は窓（desktop/examples/ui_serve.rs。製品の窓と同じ lib の答えの振り分け〈src/shell.rs〉と Lot。
// 場面は tests/ui_window_scene.py が作る: 試験用の品質データ 1500 行・作業実績 12 台・仕掛 1200 ロット・作り物の CM3）。
// 前の Python の開発用サーバーは版 3.119.0（段 ⑤）で消した。作業フォルダ（tpa-ui-*）は閉じるときに消し、
// ポートは OS に選ばせる。窓は TPA_UI_EXE（無ければ cargo の作業フォルダの debug/examples/ui_serve。組むのは ui-all.mjs か
// `cd desktop && cargo build --example ui_serve`）。
// 窓だけが答える /__desktop/*（ショートカットの様子など）は作り物で答える（デスクトップのショートカットだけが欠けた PC）。
// 状態（STATES）は、品質異常 → … → 作業実績 → … → 更新履歴 → 表示列の設定 → マスタ管理 → 待ちの窓 の順に 1 つの頁で進める。
// 起動画面（desktop/splash。窓が出す）は別の頁で、窓の代わりに splash.brand・step・fail を呼んで進める（SPLASH_STATES）。

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
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

// 計算列を集計表・グラフで使う所（calc-list 〜 calc-off。版 3.121.0 の比べ）: 品質の表「仕掛」に計算列 4 つ（数・字・区分・読めない式）。並びは元の列のすぐ後ろ
export const CALC_LAYOUT = { "lotlist:仕掛": { order: ["ロット番号", "発生日", "設備", "不良名", "重量", "重量t", "板厚", "板厚区分", "合金", "調質", "材調質", "板幅", "寸法", "客先"],
  hidden: [], widths: {}, locks: [], names: {}, formats: {}, aligns: {}, rules: {},
  formulas: { "重量t": "[重量]/1000", "材調質": "concat([合金], \"-\", [調質])", "板厚区分": "if([板厚]>=1, \"厚\", \"薄\")",
    "寸法": "[板厚] & \"x\" & [板幅]" } } };   // 寸法は読めない式（& は式に無い）。読めない計算列の見せ方の比べ

// 読み替えの列（readcol-*。2026-11 の比べ）: 式の無い作った列「管理区分」に、ほかの列（合金・板厚）を条件にした読み替えルールだけを付けた形
const RC_RULE = { rows: [
  { conditions: [{ join: "and", left: { kind: "column", column: "合金" }, op: "eq", right: { kind: "value", value: "A5052" } },
    { join: "and", left: { kind: "column", column: "板厚" }, op: "ge", right: { kind: "value", value: "1" } }], text: "5052厚板", color: "ok" },
  { conditions: [{ join: "and", left: { kind: "column", column: "合金" }, op: "startsWith", right: { kind: "value", value: "A3" } }], text: "3000系", color: "warn" },
  { conditions: [], text: "その他", color: "muted" }], self: "raw" };
export const READCOL = { r: { "管理区分": RC_RULE }, l: { "lotlist:仕掛": { ...CALC_LAYOUT["lotlist:仕掛"],
  order: ["ロット番号", "発生日", "設備", "不良名", "合金", "板厚", "管理区分", "重量", "重量t", "調質", "板幅", "客先"],
  formulas: { "重量t": "[重量]/1000", "管理区分": "" }, rules: { "管理区分": "管理区分" }, ruleCols: { "管理区分": "管理区分" } } } };   // ruleCols: ルールで作る列（版 3.123.0。式は画面がルールからそろえる）

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
// ウォーターフォール図（版 3.50.0）: 設備ごとの積み増し＋計・前との差（増加と減少・計なし）・値の計算 ÷1000
const WATERFALL_LAYOUT = { rows: 8, panels: [
  { id: "wf1", x: 0, y: 0, w: 6, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "lots" }] }, fmt: { labels: "top" } },
  { id: "wf2", x: 6, y: 0, w: 6, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 14 }, body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "lots", show: "diff" }] }, fmt: { labels: "top" } },
  { id: "wf3", x: 0, y: 4, w: 12, h: 4, title: "", visual: "waterfall", source: "work", period: { column: "@workday", kind: "days", n: 7 }, body: { rows: [{ column: "@equip", part: "" }], cols: [], measures: [{ agg: "sum", column: "重量", expr: "÷1000" }] }, fmt: { labels: "top" } }] };
// 設備の実力（版 3.103.0。基準の数: 2026-11-capacity）: 見本「設備の実力」（重量÷稼働直・稼働率・稼働直）・「月の稼働日数」（設備×作業月の換算稼働日）と、作業日ごとの本数
const CAP_PERIOD = { column: "@workday", kind: "days", n: 14 };
const CAP_EQ = [{ column: "@equip", part: "" }];
export const CAP_LAYOUT = { rows: 8, panels: [
  { id: "cap", x: 0, y: 0, w: 6, h: 5, title: "設備の実力（直あたり重量）", visual: "none", source: "work", period: CAP_PERIOD, sort: "desc",
    body: { rows: CAP_EQ, cols: [], grand: true, measures: [{ agg: "sum", column: "重量", expr: "÷1000", per: "稼働直", utext: "t/直", hideExpr: true, dec: 1 },
      { agg: "base", base: "稼働率", utext: "%", dec: 0 }, { agg: "base", base: "稼働直", utext: "直", dec: 0 }],
    bases: [{ name: "稼働率", expr: "[稼働直]÷[期間の直数]×100", unit: "%" }] } },
  { id: "capMonth", x: 6, y: 0, w: 6, h: 5, title: "月ごとの稼働日数（換算稼働日）", visual: "none", source: "work",
    body: { rows: CAP_EQ, cols: [{ column: "@workday", part: "ym" }], grand: true, measures: [{ agg: "base", base: "換算稼働日", utext: "日", dec: 1 }],
      bases: [{ name: "換算稼働日", expr: "[稼働直]÷[1日の直数]", each: true, unit: "日" }] } },
  { id: "capDays", x: 0, y: 5, w: 12, h: 3, title: "日あたり重量の推移（直近 14 日）", visual: "time", source: "work", period: CAP_PERIOD,
    body: { rows: [{ column: "@workday", part: "" }], cols: [], measures: [{ agg: "sum", column: "重量", expr: "÷1000", per: "換算稼働日", utext: "t/日", hideExpr: true, dec: 1 }],
      bases: [{ name: "換算稼働日", expr: "[稼働直]÷[1日の直数]", each: true, unit: "日" }] } }] };
const SORTED = { sorts: { "仕掛": [{ column: "重量", dir: "desc" }, { column: "板厚", dir: "asc" }] }, active: { "仕掛": [{ column: "不良名", op: "not_empty", value: "" }] } };

/** サーバーとブラウザーを起こす。{ browser, newPage(テーマ, 大きさ), close() } */
export async function launch() {
  const { base, stop } = await startServer();
  const browser = await chromium.launch();
  return {
    browser,
    base,
    /** 品質異常が出た頁（まとめていない・拡大していない・覚えた設定の無い、まっさらな状態）。
        最初の画面はダッシュボード（版 3.37.0）なので、頁の印 #screen=list で一覧から始める（読み直しても一覧のまま）。
        screen: "dash" ならダッシュボードから（パネルが描き終わるまで待つ） */
    async newPage(theme, view = VIEW, { screen = "list" } = {}) {
      const context = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, colorScheme: theme, locale: "ja-JP", bypassCSP: !!process.env.TPA_UI_BYPASS_CSP });
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
      const context = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, colorScheme: theme, locale: "ja-JP", bypassCSP: !!process.env.TPA_UI_BYPASS_CSP });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.warn(`[${theme}] page error: ${e.message}`));
      await page.goto(pathToFileURL(SPLASH).href);
      await page.evaluate(() => window.splash.brand("LotScope", "転写距離・ピッチ解析"));
      return page;
    },
    async close() {
      await browser.close();
      await stop();
    },
  };
}

/** 開発用サーバーの相手はいつも窓（版 3.119.0。前の Python の開発用サーバーと TPA_UI_SERVER=python の枝は段 ⑤ で消した。
    TPA_UI_SERVER に window でない字を渡したら、黙って窓で流さずに止める） */
if (process.env.TPA_UI_SERVER && process.env.TPA_UI_SERVER !== "window") {
  throw new Error(`TPA_UI_SERVER=${process.env.TPA_UI_SERVER} は使えません（版 3.119.0 から開発用サーバーは窓だけ）`);
}
export const SERVER = "window";
/** 窓の開発用サーバーの実行ファイル（cargo build --example ui_serve） */
export const UI_EXE = process.env.TPA_UI_EXE
  || path.join(process.env.CARGO_TARGET_DIR || path.resolve(PROGRAM, "../desktop/target"), "debug", "examples", process.platform === "win32" ? "ui_serve.exe" : "ui_serve");

/** 作業フォルダの持ち主の印（作業フォルダの横の 作業フォルダ.owner に node の PID。版 3.118.2 の作った後の採点の割れ C10） */
const ownerOf = (work) => `${work}.owner`;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
/** 前に node が SIGKILL などで後始末できずに残した作業フォルダ（持ち主の PID がもう居ない tpa-ui-*）を消す。持ち主の印の無い物には触れない */
export function sweepStale(dir = os.tmpdir()) {
  const gone = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^tpa-ui-.+\.owner$/.test(f)) continue;
    const owner = path.join(dir, f), work = owner.slice(0, -".owner".length);
    const pid = Number(fs.readFileSync(owner, "utf-8").trim());
    if (pid && alive(pid)) continue;
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(owner, { force: true });
    gone.push(work);
  }
  return gone;
}
const removeWork = (work) => { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(ownerOf(work), { force: true }); };

/** 窓の開発用サーバー（場面の台本 tests/ui_window_scene.py が作業フォルダに場面を作り、ui_serve を起こす）→ { server, ready(出力), grace } */
function startWindow(env, work) {
  if (!fs.existsSync(UI_EXE)) throw new Error(`窓の開発用サーバーがありません（${UI_EXE}）。cd desktop && cargo build --example ui_serve で組んでください`);
  const server = spawn("python", ["-u", path.join(PROGRAM, "tests/ui_window_scene.py"), "serve", work, UI_EXE], { stdio: ["pipe", "pipe", "inherit"], env });
  // 「LISTEN http://…」の行で待ち受けを始めた。止めるときは標準入力を閉じ、台本が窓を止めて作業フォルダを消すのを 10 秒まで待つ
  return { server, ready: (buf) => buf.match(/LISTEN (http:\/\/127\.0\.0\.1:\d+)/)?.[1] || null, grace: 10000 };
}

/** いまの作業フォルダ（TPA_UI_MASK=1 の shot が画面の字の中の作業フォルダを決めた字に差し替える。版 3.118.2 の作った後の採点の割れ C8） */
let maskWork = "";
/** 画面に出る作業フォルダの代わりの字（TPA_UI_MASK=1） */
export const MASK_WORK = "/tmp/tpa-ui-mask";
/** 差し替える字の組: 作業フォルダの道（書いたまま・実の道）→ MASK_WORK、名前だけ（「参照…」の窓のパンくずの段）→ tpa-ui-mask */
const maskWorks = () => (maskWork ? [[maskWork, MASK_WORK], [fs.realpathSync(maskWork), MASK_WORK], [path.basename(maskWork), path.basename(MASK_WORK)]] : []);

/** 開発用サーバーを作業フォルダ（tpa-ui-*。乱数の名前で、並べて流してもぶつからない）で起こす → { base, stop, work }。
    stop は子を止めて作業フォルダを消す */
export async function startServer() {
  sweepStale();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tpa-ui-"));
  fs.writeFileSync(ownerOf(work), String(process.pid));
  maskWork = work;
  const env = { ...process.env, TPA_UI_WORK: work };
  let started;
  try {
    started = startWindow(env, work);
  } catch (e) {
    removeWork(work);
    throw e;
  }
  const { server, ready, grace } = started;
  // 道具が close を呼ばずに終わった（例外・process.exit）ときも、子を止めて作業フォルダを消す（版 3.118.2）。node が SIGKILL で消えたときは、
  // 台本が標準入力の閉じたのを見て作業フォルダを消し、残った物は次に起こすときの sweepStale が消す
  const atExit = () => { try { server.kill("SIGKILL"); } catch { /* 済み */ } try { removeWork(work); } catch { /* 済み */ } };
  process.once("exit", atExit);
  const stop = async () => {
    process.off("exit", atExit);
    if (server.exitCode === null && server.signalCode === null) {
      const gone = new Promise((done) => server.once("exit", done));
      server.stdin.end();
      const t = setTimeout(() => server.kill(), grace);
      await gone;
      clearTimeout(t);
    }
    removeWork(work);
  };
  let base;
  try {
    base = await new Promise((done, fail) => {
      let buf = "";
      server.stdout.on("data", (d) => {
        buf += d.toString();
        const b = ready(buf);
        if (b) done(b);
      });
      server.once("exit", (c) => fail(new Error(`開発用サーバーが終わりました（${c}）`)));
    });
  } catch (e) {
    await stop();
    throw e;
  }
  server.stdout.resume();
  return { base, stop, work };
}

/** 時計の字（版 3.118.2。撮るたびに変わる字だけ。作った後の採点の割れ C3・C7 で要素ごと伏せるのをやめ、要素の中の時刻などの字だけにした）。
    TPA_UI_MASK=1 のとき shot がこの字だけを span で包み、数字を 0 にして伏せる（画素の比べ ui-diff.mjs で、相手の違いと雑音を分ける）。
    元・設備・期間・条件・件数・目標の字（.db-psub・.dp-kmeta・.db-meta の時刻の外）は伏せないので、相手の違いは比べに出る */
const CLOCK = String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?|\d{1,2}/\d{1,2} \d{1,2}:\d{2}(:\d{2})?|\d{1,2}:\d{2}(:\d{2})?`;
export const TIME_TEXT = [
  // 件数の行の元データの時刻・古さの知らせ・ダッシュボードの「n:nn の数」と元の時刻・データ元の表の写した時刻
  { sel: "#llFresh, #llStale, .db-when, .db-meta, .sr-state small", re: CLOCK, why: "時刻（写した・確かめた・数えた時刻）" },
  // スケジュールの「取得 hh:mm」（.sd-meta の最後の太字。予定の元の更新と完了予定は作り物の決めた時刻なので伏せない）
  { sel: ".sd-meta > b:last-of-type", re: CLOCK, why: "予定の元から取った時刻" },
  { sel: "#llPivot", re: String.raw`\d+ms`, why: "集計表のかかった時間" },
  // ダッシュボードの待ちの経過・残りの秒（「数え直し・29.8 秒」「あと約 3 秒」。撮った時にまだ数え直していたパネル）
  { sel: "#dashGrid .db-p, #dashBar", re: String.raw`\d+(\.\d+)? 秒`, why: "ダッシュボードの待ちの秒" },
  { sel: "#elapsed", re: String.raw`\d+(\.\d+)? 秒`, why: "起動画面の経過の秒" },
  // 作り物の CM3（予定の元）のポート: 起こすたびに OS が選ぶ
  { sel: "body", re: String.raw`127\.0\.0\.1:\d+`, why: "作り物の予定の元のポート" },
];

/** 頁を撮る（TPA_UI_MASK=1 なら作業フォルダの字を決めた字にし、時計の字を伏せ、動く絵を止める。ui-check.mjs）。
    差し替えは頁の中の MutationObserver が描き直しのたびに当て直す（時計の字は頁が刻みごとに書き直すので、1 度当てるだけでは撮る前に
    戻ることがあった: 件数の行の元データの時刻・起動画面の経過の秒。MutationObserver は描く前に呼ばれる） */
export async function shot(page, file) {
  if (process.env.TPA_UI_MASK !== "1") return page.screenshot({ path: file });
  await page.evaluate(([rules, works, as]) => {
    const swap = (t) => works.reduce((x, [w, to]) => (w && x.includes(w) ? x.split(w).join(to) : x), t);
    const apply = () => {
      // 作業フォルダ（乱数の名前）を決めた字に（字・入力欄の値・薄い見本の字）
      const all = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = all.nextNode(); n; n = all.nextNode()) { const t = swap(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
      for (const el of document.querySelectorAll("input, textarea")) {
        const t = swap(el.value); if (t !== el.value) el.value = t;
        const ph = el.getAttribute("placeholder"); if (ph && swap(ph) !== ph) el.setAttribute("placeholder", swap(ph));
      }
      // 時計の字だけを span.tpa-mask で包み、数字を 0 にそろえる（字の幅が撮った時刻で変わり、後ろの部品がずれるのを止める）
      for (const { sel, re } of rules) {
        for (const el of document.querySelectorAll(sel)) {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const nodes = [];
          for (let n = w.nextNode(); n; n = w.nextNode()) if (!n.parentElement?.closest(".tpa-mask")) nodes.push(n);
          for (const n of nodes) {
            const t = n.nodeValue, ms = [...t.matchAll(new RegExp(re, "g"))];
            if (!ms.length) continue;
            const f = document.createDocumentFragment();
            let at = 0;
            for (const m of ms) {
              if (m.index > at) f.append(t.slice(at, m.index));
              const s = document.createElement("span");
              s.className = "tpa-mask";
              s.textContent = m[0].replace(/\d/g, "0");
              f.append(s);
              at = m.index + m[0].length;
            }
            if (at < t.length) f.append(t.slice(at));
            n.replaceWith(f);
          }
        }
      }
    };
    window.__tpaMask = apply;
    if (!window.__tpaMaskObs) {
      let busy = false;
      window.__tpaMaskObs = new MutationObserver(() => { if (busy) return; busy = true; try { window.__tpaMask(); } finally { busy = false; } });
      window.__tpaMaskObs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });
    }
    apply();
  }, [TIME_TEXT, maskWorks(), MASK_WORK]).catch(() => {});
  // ダッシュボードの道具の行の一言（「見出しで動かす・四隅で大きさ・空いたマスで足す」など）は 6 秒で消える。撮った時にまだ出ているかが撮る速さで
  // 替わるので、消えるのを待つ（7 秒まで。版 3.118.2 の作った後の直しで、Python 同士でも dash-ops-ranks-each が違った）
  await page.waitForFunction(() => !(document.querySelector("#dashBar .db-msg")?.textContent || "").trim(), null, { timeout: 7000 }).catch(() => {});
  return page.screenshot({ path: file, mask: [page.locator(".tpa-mask")], maskColor: "#888", animations: "disabled", caret: "hide" });
}

/** ダッシュボードのパネルが描き終わるまで待つ（数えています・写しています の札が消える） */
export async function waitDash(page, timeout = 30000) {
  await page.waitForSelector("#dashGrid .db-p", { timeout });
  await page.waitForFunction(() => {
    const ps = [...document.querySelectorAll("#dashGrid .db-p")];
    return ps.length && ps.every((p) => !p.dataset.wait);    // 待っているパネルの印（版 3.97.0。前は回る印 .db-spin と中身の「数えています…」）
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
  // 版 3.54.0: 同じ面の条件で「で始まらない」に「C?*」を打った所（読み方と、並んだ値のうち当たる数）
  ["list-wildcard", async (p) => {
    await p.selectOption(".vf-pop [data-vf-op]", "not_starts").catch(() => {}); await sleep(200);
    await p.fill(".vf-pop [data-vf-val]", "C?*").catch(() => {}); await sleep(300);
  }, "[data-next], .vf-pop [data-vf-ok]"],
  // 版 3.45.0: 見出しのタブの名前と並び（品質異常を「異常ロット」に変え、仕掛を 2 番目へ。作業実績のタブを右クリックしたメニュー）
  ["tabs-menu", async (p) => {
    await p.keyboard.press("Escape"); await sleep(150);
    await p.evaluate(() => { TPA.local.set("tpa.tabs.v1", { order: ["dash", "src:wip", "list", "calc", "work"], names: { list: "異常ロット" } }); document.dispatchEvent(new CustomEvent("tpa:sources-changed")); });
    await sleep(600);
    const b = await (await p.$('.screen-tabs [data-screen="work"]')).boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" }); await sleep(400);
  }, "[data-next], .tpa-menu button"],
  // 版 3.53.0: 見出しの「マスタ」のタブ（役割「マスタ」のデータ元を、作業実績の設備のタブと同じ形で並べる。製造条件マスタを開いた所）
  ["mst-tab", async (p) => {
    await p.keyboard.press("Escape"); await sleep(150);
    await p.evaluate(() => { TPA.local.set("tpa.tabs.v1", {}); document.dispatchEvent(new CustomEvent("tpa:sources-changed")); });
    await sleep(700);
    await p.evaluate(() => { const t = document.querySelector('.screen-tabs [data-screen="mst"]'); if (t) t.click(); else document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:m0000001" })); });
    await p.waitForSelector("#llBody tr[data-i]"); await sleep(900);
  }, "[data-next], #llEquipBar .eq-chip"],
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
  // 版 3.55.0: カードの配置を編集している所（作る前は「配置を編集」。作った後はカードの設計〈見た目のまま〉）
  ["card-edit", async (p) => {
    await p.click(".ll-cardwin:not([hidden]) [data-edit], .ll-cardwin:not([hidden]) [data-cf=edit]").catch(() => {}); await sleep(500);
    const it = await p.$(".ll-cardwin:not([hidden]) .cfv-i:nth-child(4)");     // 作った後: 4 つ目の項目をダブルクリック（項目の面を開いた所）
    if (it) { await it.dblclick(); await sleep(400); }
  }, "[data-next], [data-card=done], [data-cf=done]"],
  // 版 3.55.0: カード全体の見栄え（名前と値の置き方を全部に当てる 8 つの見本の札）と、組み込みの「フォーム」（名前が枠の線に乗る）
  ["card-look", async (p) => { await p.click(".cf-side [data-sd=close]").catch(() => {}); await p.click(".ll-cardwin:not([hidden]) [data-cf=look]"); await sleep(400); }, "[data-next], .cf-look [data-lk]"],
  ["card-builtin", async (p) => {
    await p.keyboard.press("Escape"); await sleep(150); await p.click(".ll-cardwin:not([hidden]) [data-cf=done]"); await sleep(300);
    await p.selectOption(".ll-cardwin:not([hidden]) [data-cf=pick]", "b:form"); await sleep(500);
  }, "[data-next], [data-cf=pick]"],
  // 版 3.56.0: 組み込みの「タブで分ける」で 2 つ目のタブ（製造条件）を出した所・「畳める見出し」（そのほかは畳んである）・「5 列」
  ["card-tabs", async (p) => {
    await p.selectOption(".ll-cardwin:not([hidden]) [data-cf=pick]", "b:tabs"); await sleep(400);
    await p.click(".ll-cardwin:not([hidden]) .cfv-tab:nth-child(2)").catch(() => {}); await sleep(300);
  }, "[data-next], .cfv-tab"],
  ["card-fold", async (p) => { await p.selectOption(".ll-cardwin:not([hidden]) [data-cf=pick]", "b:fold"); await sleep(400); }, "[data-next], [data-fold]"],
  ["card-dense", async (p) => { await p.selectOption(".ll-cardwin:not([hidden]) [data-cf=pick]", "b:dense5"); await sleep(400); }, "[data-next], [data-cf=pick]"],
  ["calc", async (p) => { await closeAll(p); await p.click("#tabCalc"); await sleep(500); }, "[data-next], #query"],
  // 作業実績（設備ごとの実績。設備を札で替える）: 開いた直後（前に見た設備か、読める最初の設備）
  ["worklog", async (p) => { await closeAll(p); await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(700); }, "[data-next], #llEquipBar [aria-selected=false]"],
  // 作業実績を作業でまとめる（日＋直ごと。右に日×直のロット数）と、表の数を押してその日・直に絞ったところ
  ["worklog-work", async (p) => { await p.click('#llWorkSwitch [data-wk-mode="dayshift"]'); await p.waitForSelector("#llWork .wk-pv"); await sleep(600); }, "[data-next], #llWork [data-wk-shift]"],
  ["worklog-pick", async (p) => { await p.click("#llWork tbody tr:nth-child(4) [data-wk-shift]"); await sleep(900); }, "[data-next], #llWorkSwitch [data-wk-unpick]"],
  // 集計表・グラフ（ピボット集計）: すぐに見る「作業日ごとのロット数・重量」（時系列）と、重量のヒストグラム
  ["worklog-pivot", async (p) => { await p.click("#llWorkSwitch [data-wk-unpick]").catch(() => {}); await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPivot .pv-quick", { state: "attached" });
    await quick(p); await p.waitForSelector("#llPivot .pv-table"); await sleep(700); }, "[data-next], #llPivot [data-pv-pick]"],
  // 版 3.50.0: 札を引いている途中（カラムの札「作業区分」を文の［列］の枠の上まで引き、離さずに撮る。次の状態の頭で Esc で止める）
  ["worklog-pivot-dnd", async (p) => {
    const fe = await p.$('#llPivot .pv-f[data-dnd-col="作業区分"] > span'); await fe.scrollIntoViewIfNeeded();   // 狭い画面では欄の外にある
    const f = await fe.boundingBox(), s = await (await p.$('#llPivot .pv-slot[data-role="cols"]')).boundingBox();
    await p.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await p.mouse.down(); await p.mouse.move(f.x + f.width / 2 + 12, f.y + f.height / 2 + 6, { steps: 3 });
    await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2, { steps: 10 }); await sleep(300);
  }, "[data-next], #llPivot .pv-slot.is-drop-on"],
  // 版 3.50.0: 値の計算の段で、重量の合計に ÷1000 を当てた所（次の状態の頭で外す）
  ["worklog-pivot-calc", async (p) => {
    await p.keyboard.press("Escape"); await p.mouse.up(); await sleep(200);
    await p.fill('#llPivot [data-pc-in="1"]', "÷1000"); await p.keyboard.press("Enter"); await sleep(400);
    await p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy")); await sleep(700);
  }, "[data-next], #llPivot .pc-prev"],
  // 版 3.50.1: 値の計算の段で、重量（÷1000）の小数を 1 桁にした所（表・変わり方の数が 1 桁にそろう）
  ["worklog-pivot-dec", async (p) => {
    await p.click('#llPivot [data-pc-dec="1"][data-pc-di="1"]'); await sleep(300);
    await p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy")); await sleep(500);
  }, "[data-next], #llPivot .pc-dec .on"],
  ["worklog-hist", async (p) => { await p.keyboard.press("Escape"); await p.mouse.up(); await sleep(200);
    if (await p.$('#llPivot [data-pc-in="1"]')) { await p.fill('#llPivot [data-pc-in="1"]', ""); await p.keyboard.press("Enter"); await sleep(600); }
    if (await p.$('#llPivot [data-pc-dec=""][data-pc-di="1"]:not(.on)')) { await p.click('#llPivot [data-pc-dec=""][data-pc-di="1"]'); await sleep(600); }
    await pickChart(p, "hist"); await sleep(1000); }, "[data-next], #llPivot [data-pv-binw]"],
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
  // 版 3.58.0: 参照先・作業実績の頁はデータ元にまとめた（そのほかの接続の欄・実績の設備の段）
  ["master-paths", async (p) => { await tab(p, "sources"); await p.waitForSelector('#masterSettings button[data-oth-open="update.source"]'); await p.click('#masterSettings button[data-oth-open="update.source"]'); await sleep(900); }, "[data-next], #masterSettings button"],
  ["master-worklog", async (p) => { await tab(p, "sources"); await p.waitForSelector('#masterSettings [data-sr-edit="work"]'); await p.click('#masterSettings [data-sr-edit="work"]'); await sleep(500); await p.click('#masterSettings [data-sr-sec="equip"]'); await sleep(1200); }, "[data-next], [data-wl-scan]"],
  // データ元（版 3.36.0）: 品質データ・作業実績・仕掛の表と、仕掛を「変える…」で開いた欄
  ["master-sources", async (p) => { await tab(p, "sources"); await sleep(1100); }, "[data-next], #srAdd"],
  ["master-sources-edit", async (p) => { await p.click('[data-sr-edit="wip"]'); await sleep(700); }, "[data-next], #srSave"],
  // 版 3.53.0: 品質データのカードを開いた所（結合: 製造条件マスタを 合金＝材質・調質＝質別 の 2 つの鍵で左外部結合した形。作った後は欄の中で組む）
  ["master-sources-join", async (p) => {
    await p.click("#masterSettings .sr-card.is-open [data-sr-close]").catch(() => {}); await sleep(300);
    await p.click('[data-sr-edit="lot"]'); await sleep(700);
    if (await p.$("[data-jn-add]")) await joinDemo(p);
  }, "[data-next], [data-sr-save]"],
  // 版 3.53.0: 組んだ結合を保存した所（閉じた品質データのカードに、結合ごとの 1 行）。次の状態の前に結合を外す（後の状態の一覧に列を足さない）
  ["master-sources-joined", async (p) => {
    if (await p.$("#masterSettings .sr-card.is-open [data-jn-box]")) { await p.click("#masterSettings .sr-card.is-open [data-sr-save]"); await sleep(2500); }
  }, "[data-next], #srAdd"],
  // 版 3.54.0: データ元が多い形（利用者の画面と同じ台帳のマスタ 10 件・結合した表 1 件。見出しのタブに出さない物も）。master-sources-many-off が片付ける
  ["master-sources-many", async (p) => { await manySources(p, true); await tab(p, "equipment"); await sleep(300); await tab(p, "sources"); await sleep(1300); }, "[data-next], #srAdd"],
  // 版 3.122.0: 品質データもほかのデータ元と同じ汎用のデータに（消せないが、グループに入れる・移す。決め方: ui-proposals/2026-11-qualitygroup の K）:
  // qg-list（表の頭へ送った所）→ 品質の行を右クリックしたメニュー（グループ（押すと移す）のまとまり）→ 「工程」を押した後（移した直後の帯）
  // → 品質の欄の「名前とタブ」（グループの札・押せない消す）→ 見出しの「工程 › 品質」のタブ（1 手で品質）→ 札の「スラブ」→ 札の「品質」を右クリック（何も出ない）。
  // qg-off が品質をグループなしの頭へ戻し、マスタ管理のデータ元へ戻る（次の master-sources-many-off のため）
  ["qg-list", async (p) => { await p.evaluate(() => document.querySelector("#masterSettings .sr-page")?.scrollIntoView({ block: "start" })); await sleep(300); }, "[data-next], #srAdd"],
  ["qg-menu", async (p) => {
    await p.click("#masterSettings .sr-card.is-open [data-sr-close]").catch(() => {}); await sleep(300);
    await p.evaluate(() => document.querySelector("#masterSettings .sr-page")?.scrollIntoView({ block: "start" })); await sleep(200);
    await p.click('#masterSettings tr.sr-row[data-key="lot"] .sr-nm', { button: "right" }); await sleep(400);
  }, "[data-next], .tpa-menu button"],
  ["qg-moved", async (p) => {
    // メニューの「グループ（押すと移す）」のまとまりの「工程」（版 3.121.0 までの形は「「工程」へ移す」）
    const ok = await p.evaluate(() => { const b = [...document.querySelectorAll(".tpa-menu button")].find((x) => (x.querySelector("span")?.textContent.trim() === "工程" || x.textContent.includes("「工程」へ移す")) && !x.disabled); if (b) b.click(); return !!b; });
    if (!ok) await p.keyboard.press("Escape");
    await sleep(1500);
    await p.evaluate(() => document.querySelector('#masterSettings tr.sr-row[data-key="lot"]')?.scrollIntoView({ block: "center" })); await sleep(200);
  }, "[data-next], #srAdd"],
  ["qg-edit", async (p) => { await p.click('[data-sr-edit="lot"]'); await sleep(700); await p.click('#masterSettings .sr-card.is-open [data-sr-sec="name"]').catch(() => {}); await sleep(400); }, "[data-next], [data-sr-save]"],
  ["qg-tab", async (p) => { await closeAll(p); await p.evaluate(() => showScreen("grp:工程")); await sleep(1600); }, "[data-next], #llEquipBar button"],
  ["qg-tab-lot", async (p) => {
    // 札の「スラブ」へ移ってから「品質」へ戻る（グループの中で品質もほかの札と同じに切り替わる）
    await p.evaluate(() => [...document.querySelectorAll("#llEquipBar .eq-chip")].find((b) => b.textContent.trim() === "スラブ")?.click()); await sleep(1200);
    await p.evaluate(() => document.querySelector('#llEquipBar [data-equip="list"]')?.click()); await sleep(1600);
  }, "[data-next], #llEquipBar button"],
  ["qg-off", async (p) => {
    await closeAll(p);
    await p.evaluate(async () => {
      const items = (await (await fetch("/api/sources")).json()).items || [], lot = items.find((x) => x.key === "lot");
      if (lot && lot.group) await fetch("/api/sources/lot/quick", TPA.json("POST", { "グループ": "", base_rev: lot.rev || 0 }));
      await fetch("/api/sources/order", TPA.json("POST", { keys: ["lot", ...items.filter((x) => x.key !== "lot" && x.key !== "work").map((x) => x.key)] }));
      document.dispatchEvent(new CustomEvent("tpa:sources-changed"));
    });
    await sleep(800); await p.evaluate(() => showScreen("list")); await sleep(300);
    await p.click("#masterBtn"); await sleep(900); await tab(p, "sources"); await sleep(900);
  }, "[data-next], #srAdd"],
  ["master-sources-many-off", async (p) => { await manySources(p, false); }, "[data-next], #srAdd"],
  ["master-shifts", async (p) => {
    await p.evaluate(async () => { const it = ((await (await fetch("/api/sources")).json()).items || []).find((x) => x.key === "lot");
      if (it && it.joins && it.joins.length) await fetch("/api/sources/lot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "結合": [], "設備の列": it.equipColumn, "設備の取り出し方": it.equipMode, base_rev: it.rev || 0 }) }); });
    await tab(p, "shifts"); await sleep(900);
  }, "[data-next], [data-sh-save]"],
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
  // 2026-11-17 の 4（利用者の報告: 入力の当てる列が複数のとき見切れる）: 当てる列が 1・2・3・5 列・名前が長い形を、撮るだけの変換表（CONV_MANY）で見る。
  // convx-ka … 同梱の「課名」（1 つの入力に当てる列 4 つ）・convx … CONV_MANY（入力 4 つ。当てる列 1・2・3・5・全角 10〜17 字）・
  // convx-cell … 4 つ目の入力のセルを開いた所・convx-cols … 5 列の入力の「当てる列を選ぶ面」・convx-kanri … 入力 6 つの管理分類の判定表・convx-plan … 一覧の表示列の窓の変換表の帯を「選ぶ ▾」で開いた所。
  // convx-off が CONV_MANY を消す（--from convx-ka で撮る）
  ["convx-ka", async (p) => {
    await closeAll(p); await p.click("#masterBtn"); await sleep(900); await tab(p, "conv"); await p.waitForSelector("[data-cv-pick]");
    await p.evaluate(() => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === "課名")?.click()); await sleep(600);
  }, "[data-next], [data-cv-save]"],
  ["convx", async (p) => { await convMany(p, true); await sleep(600); }, "[data-next], [data-cv-save]"],
  ["convx-cell", async (p) => { await p.click(`[data-cv-cell="0|${CONV_MANY.inputs[3].name}"]`); await sleep(500); }, "[data-next], [data-cv-close]"],
  ["convx-cols", async (p) => {
    await p.click("[data-cv-close]").catch(() => {}); await sleep(300);
    await p.click('[data-cv-cols="3"]'); await p.waitForSelector(".cv-cpi"); await sleep(500);
  }, "[data-next], [data-cp-close]"],
  // 入力 6 つの同梱の「管理分類」（判定表の列の幅の割り振り: 条件の札・見出しが語の途中で折れない・1280 でも ↑↓× まで横に送らずに入る。版 3.124.0 の作った後の採点）
  ["convx-kanri", async (p) => {
    await p.click(".cv-colpop [data-cp-close]").catch(() => {}); await sleep(200);
    await p.evaluate(() => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === "管理分類")?.click()); await sleep(700);
    await p.evaluate(() => { document.querySelector("#masterSettings .cv-gridwrap")?.scrollIntoView({ block: "start" }); }); await sleep(300);
  }, "[data-next], [data-cv-save]"],
  ["convx-plan", async (p) => {
    await closeAll(p); await p.click("#tabList"); await sleep(300); await p.click("#llColBtn"); await sleep(700);
    await p.click("[data-cv-more]"); await sleep(500);
  }, "[data-next], #lcSave"],
  ["convx-off", async (p) => { await closeAll(p); await convMany(p, false); }, "[data-next], #llBody .ll-lot"],
  // 2026-11-17 の 5（利用者の改良依頼: 変換表を誤って同梱に戻さない・保存の範囲・全体と一部のバックアップ・戻す前に何がどう変わるか）。--from cvb で撮る:
  // cvb … 管理分類を開いた所（左の一覧の下に 書き出す・取り込む・標準）・cvb-saved … 変えずに「保存」を押した直後の知らせ・
  // cvb-hist … 案の「履歴・バックアップ」を開いた所（案の部品 [data-cvb-hist] があれば押す。今は何も起きない）・
  // cvb-diff … 案の「戻す前に比べる」を開いた所（[data-cvb-diff]）・cvb-import … 書き出したファイルの地取区分を 2 行にし、表を 1 つ足して「取り込む…」で読んだ所（取り込む前の確かめ）・
  // cvb-std … 「今の表を標準に」をした後（道で。版 3.124.0 は標準が「取り込んだ表」・「同梱に戻す」が出る。版 3.125.0 は「自分で決めた表」）・cvb-bundled … 「同梱に戻す」を押した所（今は確かめの窓〈ブラウザの confirm〉を閉じる。
  // 案は頁の中の確かめを出す。案の [data-cvb-pre-bundled] があれば先に押し、[data-cvb-bundled] があればそれを押す）・cvb-plan … 一覧の表示列の窓の変換表の帯（convx-plan と同じ。版 3.124.0 の残り: 1536 で下のリンクが半分隠れる）。cvb-off が標準を同梱へ戻す
  ["cvb", async (p) => {
    await closeAll(p);
    await convHistorySeed(p);   // 版 3.125.0 の画面（履歴の道がある）なら、戻せる時点を 3 つ作る（月末のバックアップ・管理分類と課名を直す前）
    await p.click("#masterBtn"); await sleep(900); await tab(p, "conv"); await p.waitForSelector("[data-cv-pick]");
    await p.evaluate(() => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === "管理分類")?.click()); await sleep(700);
  }, "[data-next], [data-cv-save]"],
  ["cvb-saved", async (p) => { await p.click("[data-cv-save]"); await p.waitForSelector("#cvNotice.ok", { timeout: 8000 }); await sleep(500); }, "[data-next], [data-cv-save]"],
  ["cvb-hist", async (p) => { await p.click("[data-cvb-hist]", { timeout: 1500 }).catch(() => {}); await sleep(700); }, "[data-next], [data-cv-save]"],
  ["cvb-diff", async (p) => {
    if (await p.$(".cvh-dlg")) {   // 版 3.125.0: 窓の左の「月末のバックアップ」を押す（右に戻すと何が変わるか。変わる行のある最初の表は行まで開く）
      await p.evaluate(() => [...document.querySelectorAll("[data-cvh-pt]")].find((b) => b.textContent.includes("月末"))?.click()); await sleep(900);
      if (!(await p.$(".cvh-rowsx"))) await p.click("[data-cvb-diff]").catch(() => {});
      await sleep(400); return;
    }
    await p.click("[data-cvb-diff]", { timeout: 1500 }).catch(() => {}); await sleep(700);
  }, "[data-next], [data-cv-save]"],
  // 2 回目（2026-11-convbackup の rounds[1]）: 表の頭の「この表の履歴 ▾」（[data-cvb-th]）を押した所。今と 1 回目の案は何も起きない
  ["cvb-th", async (p) => {
    await p.click("[data-cvb-close]", { timeout: 800 }).catch(() => {}); await sleep(200);
    await p.click("[data-cvb-th]", { timeout: 1500 }).catch(() => {}); await sleep(700);
  }, "[data-next], [data-cv-save]"],
  ["cvb-import", async (p) => {
    await p.click("[data-cvb-close]", { timeout: 800 }).catch(() => {}); await sleep(200);
    const doc = await p.evaluate(async () => ({ kind: "tpa-conversions", version: 1, items: (await (await fetch("/api/masters/conversions/export")).json()).items }));
    const ji = doc.items.find((x) => x.name === "地取区分"); if (ji) ji.rows = ji.rows.slice(0, 2);
    doc.items = [ji, { name: "試しの表", inputs: [{ name: "x", type: "text", columns: ["x"] }], rows: [{ when: { x: [{ op: "eq", v: ["1"] }] }, out: "一" }], other: "", apply: { mode: "add", column: "試し", place: "end" } }].filter(Boolean);
    const file = path.join(os.tmpdir(), `tpa-cvb-${process.pid}.json`); fs.writeFileSync(file, JSON.stringify(doc));   // 名前は英字（日本語はファイルが空で届く）
    await p.evaluate((items) => { window.__cvbIncoming = items; document.querySelector("[data-cvb-pre-import]")?.click(); }, doc.items); await sleep(300);   // 案が取り込むを面の中へ移したときは、面を開いてから
    const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click("[data-cv-import]")]);
    await chooser.setFiles(file); await p.waitForSelector(".cv-imp, [data-cvb-imp]", { timeout: 5000 }); await sleep(500);
    fs.rmSync(file, { force: true });
  }, "[data-next], [data-cv-impno]"],
  ["cvb-std", async (p) => {
    await p.click("[data-cv-impno]", { timeout: 1500 }).catch(() => {}); await sleep(300);
    // 「今の表を標準に」は道で（案によってはボタンを面の中へ移すので）。変換表のタブを開き直して管理分類を選ぶ
    await p.evaluate(async () => { await fetch("/api/masters/conversions/defaults", TPA.json("POST", { from: "current" })); });
    await tab(p, "equipment"); await tab(p, "conv"); await p.waitForSelector("[data-cv-pick]");
    await p.evaluate(() => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === "管理分類")?.click()); await sleep(900);
  }, "[data-next], [data-cv-save]"],
  ["cvb-bundled", async (p) => {
    await p.evaluate(() => document.querySelector("[data-cvb-pre-bundled]")?.click()); await sleep(400);   // 案が「同梱に戻す」を面の中へ移したとき
    if (!(await p.$("[data-cvb-bundled]")) && (await p.$("[data-cvb-hist]"))) { await p.click("[data-cvb-hist]"); await p.waitForSelector("[data-cvb-bundled]", { timeout: 5000 }); await sleep(700); }   // 版 3.125.0: 履歴と戻すの窓の上の段
    if (await p.$("[data-cvb-bundled]")) { await p.click("[data-cvb-bundled]"); await sleep(700); return; }
    p.once("dialog", (d) => d.dismiss().catch(() => {}));   // 今は確かめの窓（ブラウザの confirm）を閉じる（標準は変えない）
    await p.click("[data-cv-stdbundled]"); await sleep(700);
  }, "[data-next], [data-cv-save]"],
  ["cvb-plan", async (p) => {
    await closeAll(p); await p.click("#tabList"); await sleep(300); await p.click("#llColBtn"); await sleep(700);
    await p.click("[data-cv-more]"); await sleep(500);
  }, "[data-next], #lcSave"],
  ["cvb-off", async (p) => {
    await p.click(".cvh-dlg [data-cvb-close]").catch(() => {});
    await closeAll(p);
    await convHistorySeed(p, false);   // 月末のバックアップの形（全体）に戻す
    await p.evaluate(async () => { await fetch("/api/masters/conversions/defaults", TPA.json("POST", { from: "bundled" })); document.dispatchEvent(new CustomEvent("tpa:masters-changed")); });
  }, "[data-next], #llBody .ll-lot"],
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
  // 版 3.51.0: ABC の段を A・B・C に限らない（線 4 本 → A〜E の 5 段）。パネルと、組む所の「ABC線」の段まで送った所
  ["dash-ops-ranks", async (p) => {
    const l = JSON.parse(JSON.stringify(OPS_LAYOUT)); l.panels[1].ops.lims = [40, 60, 80, 95];
    await p.evaluate((x) => Dashboard._setLayout(x), l); await sleep(500); await waitDash(p); await sleep(600);
  }, "[data-next], [data-db-editmode]"],
  ["dash-ops-ranks-edit", async (p) => {
    await p.click("[data-db-editmode]"); await sleep(400);
    await p.click('#dashGrid .db-p[data-id="abc"] [data-db-edit]'); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(600);
    await p.evaluate(() => { const r = document.querySelector("[data-de-abcrow], [data-de-oa]"); if (r) r.closest(".de-row").scrollIntoView({ block: "center" }); }); await sleep(300);
  }, "[data-next], [data-de-apply]"],
  // 線 26 本（A〜AA の 27 段）で組む所を開いた所（線の札が折り返しても組む所に収まるか）。前の dash-ops-ranks-edit の続き
  ["dash-ops-ranks-many", async (p) => {
    const l = JSON.parse(JSON.stringify(OPS_LAYOUT)); l.panels[1].ops.lims = Array.from({ length: 26 }, (_, i) => Math.round((i + 1) * 3.5 * 10) / 10);
    await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);
    await p.evaluate((x) => Dashboard._setLayout(x), l); await sleep(500); await waitDash(p); await sleep(400);
    if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(300); }
    await p.click('#dashGrid .db-p[data-id="abc"] [data-db-edit]'); await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(600);
    await p.evaluate(() => { const r = document.querySelector("[data-de-abcrow]"); if (r) r.scrollIntoView({ block: "center" }); }); await sleep(300);
  }, "[data-next], [data-de-apply]"],
  // 品種ごとに切り替えた所（線の札が隠れ「品種ごとに A, B, C …（いま n 段）」）と、線で分けるへ戻して同じ線（60%）を打った所（赤い欄と知らせ）
  ["dash-ops-ranks-each", async (p) => {
    await p.click('.de-seg:has([data-de-rankby][value="each"])'); await waitDash(p); await sleep(700);
    await p.evaluate(() => { const r = document.querySelector("[data-de-abcrow]"); if (r) r.scrollIntoView({ block: "center" }); }); await sleep(300);
  }, "[data-next], [data-de-apply]"],
  ["dash-ops-ranks-err", async (p) => {
    await p.click('.de-seg:has([data-de-rankby][value=""])'); await waitDash(p); await sleep(600);
    const f = await p.$('[data-de-lim="0"]'), v = await p.$eval('[data-de-lim="1"]', (x) => x.value).catch(() => "60");
    if (f) { await f.fill(v); await f.press("Enter"); } await sleep(400);
    await p.evaluate(() => { const r = document.querySelector("[data-de-abcrow]"); if (r) r.scrollIntoView({ block: "center" }); }); await sleep(300);
  }, "[data-next], [data-de-apply]"],
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
  // 版 3.50.0: ウォーターフォール図（直近 7 日の設備ごとのロット数・直近 14 日の作業日ごとの前との差・重量の合計 ÷1000）
  ["dash-waterfall", async (p) => { await p.evaluate((l) => Dashboard._setLayout(l), WATERFALL_LAYOUT); await sleep(500); await waitDash(p); await sleep(700); }, "[data-next], [data-db-editmode]"],
  // 版 3.103.0: 設備の実力（基準の数）。cap … 3 枚のパネル（設備の実力・月の稼働日数〈10 月は途中〉・日あたり重量の推移）。
  // cap-edit … 設備の実力を組む所で開き、② の頭の見本と値の計算の段を出して、重量の合計の「÷ 稼働直 ▾」の面を開いた所
  ["cap", async (p) => { await p.evaluate((l) => Dashboard._setLayout(l), CAP_LAYOUT); await sleep(500); await waitDash(p); await sleep(700); }, "[data-next], [data-db-editmode]"],
  ["cap-edit", async (p) => {
    if (!(await p.$('#dashGrid .db-p[data-id="cap"]'))) { await p.evaluate((l) => Dashboard._setLayout(l), CAP_LAYOUT); await sleep(500); await waitDash(p); }
    if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(400); }
    const b = await p.$('#dashGrid .db-p[data-id="cap"] [data-db-edit]');
    if (b) await b.click(); else { await p.focus('#dashGrid .db-p[data-id="cap"]'); await p.keyboard.press("Enter"); }
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(600);
    await p.evaluate(() => { const m = document.querySelector("#dbEditor .de-main"), f = document.querySelector("#deSent .cp-ex") || document.querySelector("#deSent"), t = document.querySelector("#dePtabs");
      // 見本の頭が固定のタブの下に潜らない所まで送る（作った後の採点 3 回目: 1536 で見本の札の名前が半分切れた）
      if (m && f) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - (t ? t.offsetHeight : 40) - 10); window.scrollTo(0, 0); });
    await sleep(300);
    await p.click('#deSent [data-de-per="0"]'); await p.waitForSelector("#dePerPop .cp-it"); await sleep(1200);
  }, "[data-next], [data-de-apply], #dePerPop [data-cp-pick]"],
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
  // 版 3.49.0（利用者の要望 2026-10-21 の 4 回目の 1）: 組み込みの「標準」を直して「名前を付けて保存」を重ねた形（共通に「標準」★・共通デフォルトに「標準」
  // 「標準ダッシュボード」）の面と、同じ名前「標準」を共通デフォルトへ名前を付けて保存しようとした所。dash-save-off が片付ける
  ["dash-save-pop", async (p) => {
    await p.evaluate(async (l) => {
      const mk = (name, scope, standard) => fetch("/api/dashboards", TPA.json("POST", { name, scope, standard, body: l }));
      await mk("標準", "default", false); await mk("標準ダッシュボード", "default", false); await mk("標準", "all", true);
      TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState();
    }, HSTACK_LAYOUT);
    await p.reload(); await p.click("#tabDash"); await waitDash(p); await sleep(500);
    await p.click("[data-db-pick]"); await sleep(500);
  }, "[data-next], [data-db-open]"],
  ["dash-saveas", async (p) => {
    await p.keyboard.press("Escape"); await sleep(200);
    await p.click("[data-db-editmode]"); await sleep(400);
    await p.click("[data-db-saveas]"); await sleep(400);
    await p.fill("#dbSaveName", "標準"); await p.dispatchEvent("#dbSaveName", "input");
    await p.check('input[name="dbScope"][value="default"]'); await sleep(400);
  }, "[data-next], [data-db-dosave]"],
  // 後片付け（撮らない）
  ["dash-save-off", async (p) => {
    await p.keyboard.press("Escape");
    await p.click("[data-db-leave]").catch(() => {}); await p.click("[data-db-discard]").catch(() => {});
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
  // 版 3.70.0: 組む所のデザインのタブ（テーマ「夜」を当てた所。テーマ・見せ方・スタイル・色の組）
  ["dash-panel-design", async (p) => {
    await p.evaluate(() => document.querySelector('[data-de-pane="design"]')?.click()); await sleep(400);
    await p.evaluate(() => document.querySelector('[data-de-theme="3"]')?.click()); await sleep(900);
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
  // 版 3.52.0（2026-10-dslicer の G）: 日付の暦（10/1〜10/2 を選んだ後に開き直した所）・「スライサー ▾」の面・パネルのスライサー（仕掛区分で保留を選んだ所）。
  // dash-dslicer-off が片付ける（覚えた日付・選び・帯の設定を消して頁を開き直す）
  ["dash-dslicer-cal", async (p) => {
    await p.keyboard.press("Escape"); await sleep(200);
    await p.click("#dashSlicer [data-ds-date]"); await p.waitForSelector("[data-ds-day]"); await sleep(200);
    await p.click('[data-ds-day="2026-10-01"]'); await sleep(150); await p.click('[data-ds-day="2026-10-02"]'); await sleep(600); await waitDash(p);
    await p.click("#dashSlicer [data-ds-date]"); await p.waitForSelector("[data-ds-day]"); await sleep(400);
  }, "[data-next], [data-ds-done]"],
  ["dash-dslicer-cfg", async (p) => {
    await p.keyboard.press("Escape"); await sleep(200);
    await p.click("#dashSlicer [data-ds-cfg]"); await p.waitForSelector(".db-cfgpop [data-ds-on]"); await sleep(400);
  }, "[data-next], [data-ds-done]"],
  ["dash-dslicer-panel", async (p) => {
    await p.keyboard.press("Escape"); await sleep(200);
    await p.evaluate(() => { const L = Dashboard._state().layout, q = L.panels.find((x) => x.id === "wipClass") || L.panels.find((x) => x.source === "src:wip" && x.visual !== "kpi");
      if (q) { q.visual = "slicer"; q.title = ""; q.body = { rows: [{ column: "仕掛区分" }], cols: [], measures: [{ agg: "lots" }] }; } Dashboard._setLayout(L); });
    await sleep(600); await waitDash(p); await sleep(400);
    const v = await p.$('[data-db-spv="保留"]'); if (v) { await v.click(); await sleep(600); await waitDash(p); await sleep(400); }
  }, "[data-next], [data-db-spv]"],
  ["dash-dslicer-off", async (p) => {
    await p.evaluate(() => { const m = JSON.parse(localStorage.getItem("tpa.dash.v1") || "{}"); delete m.slice; delete m.pick; delete m.bar; localStorage.setItem("tpa.dash.v1", JSON.stringify(m)); });
    await p.reload(); await waitDash(p); await sleep(400);
    await p.keyboard.press("Escape"); await sleep(100);
    if (await p.$('[data-ds-period="last_month"]')) await p.click('[data-ds-period="last_month"]'); else await p.selectOption("[data-ds-psel]", "last_month");
    await sleep(400); await waitDash(p);
  }, "[data-next]"],
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
    await tab(p, "equipment"); await sleep(300); await tab(p, "release"); await p.waitForSelector("[data-rec-on]"); await sleep(500);
    await p.click("[data-rec-on]"); await p.waitForSelector("[data-rec-off]"); await sleep(500);
  }, "[data-next], [data-rec-off]"],
  // 版 3.43.0: 保存していない変更の窓（変換表の名前を変えて、勤務体系のタブを押した所）
  ["unsaved", async (p) => {
    await tab(p, "conv"); await p.waitForSelector("[data-cv-save]"); await sleep(400);
    await p.fill("#cvName", "管理分類（直した）"); await p.press("#cvName", "Tab");
    await tab(p, "shifts"); await p.waitForSelector(".us-card"); await sleep(300);
  }, "[data-next], .us-card [data-us=back]"],
  // 版 3.57.0: スケジュール（CM3 の作業予定。作り物の CM3: L-1・L-2・L-3）。設備 L-1 の予定と、HOT コイル作業順（--from sch で撮る）
  ["sch", async (p) => {
    await p.keyboard.press("Escape").catch(() => {});
    await p.evaluate(() => { TPA.local.set("tpa.sch.equip.v1", "L-1"); document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:sch" })); });
    await p.waitForSelector('#llEquipBar [data-equip="L-1"][aria-selected="true"]', { timeout: 20000 });
    await p.waitForSelector("#llSched:not([hidden]) .sd-row", { timeout: 20000 }); await sleep(900);
  }, "[data-next], #llEquipBar [data-equip]"],
  ["sch-hot", async (p) => {
    await p.click('#llEquipBar [data-equip="__HOT__"]');
    await p.waitForSelector("#llSched[data-mode=hot] .sd-tl", { timeout: 20000 }); await sleep(900);
  }, "[data-next], #llSched [data-sd-pick], #llSched [data-sd-kama]"],
  // 版 3.120.0: JSON の列を分ける窓（場面 TPA_UI_JSON=1 の JSON の列 5 つ。JSON の列の無い場面では窓を開けず、そのまま撮る）。
  // 仕掛の一覧の道具の行の「{ } JSON」→ 窓（① 設備別通過回数 を勧めた形）・合わない行と設備マスタに無い鍵（CR1）を開いた所・
  // 表を作る（新しいダッシュボードに作る）→ 知らせ（json-toast）→ 足したパネルへ「見る」・そのパネルを組む所（入口と「›」の札）・組む所から開いた窓。json-off が片付ける
  ["json", async (p) => {
    await closeAll(p);
    await p.evaluate(() => document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:wip" })));
    await p.waitForSelector("#llBody .ll-lot", { timeout: 30000 }); await sleep(1200);
    if (!(await p.$("#llJsonBtn:not([hidden])"))) return;
    await p.click("#llJsonBtn");
    await p.waitForSelector("#jxWin .jx-prev", { timeout: 30000 }); await sleep(500);
  }, "[data-next], #jxWin [data-jx-make]"],
  ["json-check", async (p) => {
    if (!(await p.$("#jxWin .jx-prev"))) return;
    await p.click("#jxWin [data-jx-issues]").catch(() => {}); await sleep(200);
    await p.click("#jxWin [data-jx-miss]").catch(() => {}); await sleep(400);
  }, "[data-next], #jxWin [data-jx-make]"],
  // 表を作った直後の知らせ（「…を作り、新しいダッシュボード「…」に「…」を足しました 見る」）
  ["json-toast", async (p) => {
    if (!(await p.$("#jxWin [data-jx-make]:not([disabled])"))) return;
    await p.click("#jxWin [data-jx-make]");
    await p.waitForSelector(".tpa-toast [data-jx-jump]", { timeout: 60000 }); await sleep(500);
  }, "[data-next], .tpa-toast [data-jx-jump]"],
  ["json-made", async (p) => {
    if (!(await p.$(".tpa-toast [data-jx-jump]"))) return;
    await p.click(".tpa-toast [data-jx-jump]");
    await waitDash(p); await sleep(1200);
  }, "[data-next], [data-db-editmode]"],
  ["json-dash", async (p) => {
    const id = await p.evaluate(() => { const s = window.Dashboard && Dashboard._layout(); const x = s && [...s.panels].reverse().find((y) => /通過回数の合計/.test(y.title || "")); return x ? x.id : ""; });
    if (!id) return;
    if (!(await p.$(".db-editing"))) { await p.click("[data-db-editmode]"); await sleep(500); }
    const b = await p.$(`#dashGrid .db-p[data-id="${id}"] [data-db-edit]`);
    if (b) await b.click(); else { await p.focus(`#dashGrid .db-p[data-id="${id}"]`); await p.keyboard.press("Enter"); }
    await p.waitForSelector("#deFields .pv-f", { timeout: 30000 }); await p.waitForSelector("#deFields .de-json", { timeout: 20000 }).catch(() => {}); await sleep(600);
  }, "[data-next], [data-de-apply]"],
  ["json-dashwin", async (p) => {
    if (!(await p.$("#deFields [data-de-json]"))) return;
    await p.click("#deFields [data-de-json]");
    await p.waitForSelector("#jxWin .jx-prev", { timeout: 30000 }); await sleep(500);
  }, "[data-next], #jxWin [data-jx-make]"],
  // 片付け（作った表と、組み込みの標準を入れ替えた物を消す。次の撮影は前と同じ形から）
  ["json-off", async (p) => {
    await closeAll(p);
    const again = await p.evaluate(async () => {
      const items = ((await (await fetch("/api/sources", { cache: "no-store" })).json()).items || []).filter((x) => x.expand);
      for (const x of items) await fetch(`/api/sources/${encodeURIComponent(x.key)}?rev=${x.rev || ""}`, { method: "DELETE" });
      const d = await (await fetch("/api/dashboards")).json();
      for (const x of (d.items || []).filter((y) => y.replaces || (!y.builtin && / › /.test(y.name || "")))) await fetch(`/api/dashboards/${x.id}`, { method: "DELETE" });
      TPA.local.set("tpa.dash.v1", {});
      return items.length > 0;
    });
    if (again) { await p.reload(); await sleep(1500); }
  }, "[data-next], #llSearch"],
  // 版 3.121.0 の比べ（利用者の依頼 2026-11-17 の 1「計算列を集計表・グラフで使う」。--from calc-list で撮る）:
  // 品質の一覧に計算列 3 つ（重量t＝数・材調質＝字・板厚区分＝区分）を作った所 → 表示列の窓でその列を選んだ所 → 集計表・グラフ（合金ごとの重量の合計）
  // → ダッシュボードの組む所（品質のデータ。計算列を行と値に入れた所）。calc-off が片付ける
  ["calc-list", async (p) => {
    await closeAll(p);
    await p.evaluate(async (l) => { TPA.local.set("tpa.lotlist.layout.v1", l); TPA.local.set("tpa.lotlist.pivot.v1", {}); await TPA.saveUiState(); }, CALC_LAYOUT);
    await p.goto(p.url().replace(/#.*$/, "") + "#screen=list"); await p.reload();
    await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  }, "[data-next], #llHead th.is-calc"],
  ["calc-cols", async (p) => {
    await p.click("#llColBtn"); await sleep(600);
    await p.click('#lcList li[data-col="重量t"]').catch(() => {}); await sleep(500);
  }, "[data-next], #lcSave"],
  ["pivot-calc", async (p) => {
    await closeAll(p);
    await p.click('#llViewSwitch [data-pv-view="pivot"]'); await p.waitForSelector("#llPvFields .pv-f[data-col]");
    await p.click('#llPvFields .pv-f[data-col="合金"] [data-pv-add="rows"]'); await sleep(400);
    // 版 3.121.0 から計算列が欄の頭（ƒx 計算列）に並ぶ: 重量t を値・板厚区分を列に（案の比べの時は、案の定義が 重量 → 重量t に替えていた）
    await p.click('#llPvFields .pv-f[data-col="重量t"] [data-pv-add="vals"]'); await sleep(400);
    await p.click('#llPvFields .pv-f[data-col="板厚区分"] [data-pv-add="cols"]'); await sleep(600);
    await p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy")); await sleep(300);
    await pickChart(p, "column").catch(() => {}); await sleep(300); await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("#llPvOut.is-busy")); await sleep(900);
  }, "[data-next], #llPivot [data-pv-pick]"],
  ["dash-calc", async (p) => {
    await closeAll(p);
    await p.evaluate(() => showScreen("dash")); await waitDash(p); await sleep(500);
    await p.click("[data-db-editmode]"); await sleep(500);
    const b = await p.$('#dashGrid .db-p[data-id="wipClass"] [data-db-edit]');
    if (b) await b.click(); else { await p.focus('#dashGrid .db-p[data-id="wipClass"]'); await p.keyboard.press("Enter"); }
    await p.waitForSelector("#deFields .pv-f"); await waitDash(p); await sleep(400);
    await p.selectOption("[data-de-src]", "lot"); await p.waitForSelector('#deFields .pv-f[data-dnd-col="板厚区分"]', { timeout: 30000 }); await sleep(400);
    await p.click('#deFields .pv-f[data-dnd-col="板厚区分"] [data-de-add="rows"]').catch(() => {}); await sleep(500);
    await p.click('#deFields .pv-f[data-dnd-col="重量t"] [data-de-add="vals"]').catch(() => {}); await sleep(500);
    await p.click('#deFields [data-de-add="vals"][data-col="@lots"]').catch(() => {}); await sleep(500);   // ロット数を外し、値は 重量t だけ
    await p.fill("#deTitle", "板厚区分ごとの重量t（品質）").catch(() => {}); await p.keyboard.press("Tab").catch(() => {}); await sleep(300);   // 題を中身に合わせる（版 3.121.0）
    await waitDash(p); await sleep(900);
  }, "[data-next], [data-de-apply]"],
  ["calc-off", async (p) => {
    await closeAll(p);
    await p.evaluate(async () => { TPA.local.set("tpa.lotlist.layout.v1", {}); TPA.local.set("tpa.lotlist.pivot.v1", {}); TPA.local.set("tpa.dash.v1", {}); await TPA.saveUiState(); });
    await p.goto(p.url().replace(/#.*$/, "") + "#screen=list"); await p.reload(); await sleep(1500);
  }, "[data-next], #llSearch"],
  // 2026-11 読み替えの列（利用者の改良依頼 2026-11-17 の 3「表示列の読み替えルールのさらなる汎用化」。比べは ui-proposals/2026-11-readcol）:
  // 品質の表「仕掛」に、式の無い作った列「管理区分」と読み替えルール「管理区分」（合金・板厚を条件に 5052厚板・3000系・その他）を付けた形（READCOL）。
  // readcol-list（一覧の 管理区分 の列）→ readcol-cols（表示列の窓で 管理区分 を選び ③ 読み替え を開いた所）→ readcol-rule（「ルールを編集」の窓）
  // → readcol-new（「＋ 列を作る」で新しい列「区分」を足した直後に開く作り方の窓）。readcol-off が片付ける。--from readcol-list で撮る
  ["readcol-list", async (p) => {
    await closeAll(p);
    await p.evaluate(async ({ l, r }) => { TPA.local.set("tpa.lotlist.layout.v1", l); TPA.local.set("tpa.lotlist.rules.v1", r); TPA.local.set("tpa.lotlist.pivot.v1", {}); await TPA.saveUiState(); }, READCOL);
    await p.goto(p.url().replace(/#.*$/, "") + "#screen=list"); await p.reload();
    await p.waitForSelector("#llBody tr[data-i]"); await sleep(800);
  }, "[data-next], #llHead th.is-calc"],
  ["readcol-cols", async (p) => {
    await p.click("#llColBtn"); await sleep(600);
    await p.click('#lcList li[data-col="管理区分"]').catch(() => {}); await sleep(400);
    // ③ 読み替えの段（版 3.122.0 までの形）か、ルールで作る列なら作り方の段（版 3.123.0 から ③ は無い）を開く
    await p.evaluate(() => { const st = document.querySelector('.lc-step[data-step="rule"]') ? "rule" : "fx"; const s = document.querySelector(`.lc-step[data-step="${st}"]`); if (s && !s.classList.contains("is-open")) s.querySelector("h4").click(); }); await sleep(500);
  }, "[data-next], #lcSave"],
  ["readcol-rule", async (p) => { await p.click("#lcRuleEdit").catch(() => {}); await sleep(700); }, "[data-next], #llRulePanel [data-act=save]"],
  ["readcol-new", async (p) => {
    // ルールの窓を閉じ（直していないので聞かれない）、表示列の窓の「＋ 列を作る」で名前「区分」を答える
    await p.evaluate(() => document.querySelector('#llRulePanel:not([hidden]) [data-act="close"]')?.click()); await sleep(400);
    p.once("dialog", (d) => d.accept("区分").catch(() => {}));
    await p.evaluate(() => document.querySelector("#lcAddCol")?.click()); await sleep(1000);
    // 版 3.123.0: 作り方の窓は「保存したルール」のタブで開く。ルールのカード（管理区分）を押して選んだ所（3 行と件数・試した結果）
    await p.evaluate(() => document.querySelector('#llFxPanel:not([hidden]) .lr-rcard[data-rule="管理区分"]')?.click()); await sleep(600);
  }, "[data-next], #llFxPanel [data-act=save]"],
  ["readcol-off", async (p) => {
    await closeAll(p);
    await p.evaluate(async () => { TPA.local.set("tpa.lotlist.layout.v1", {}); TPA.local.set("tpa.lotlist.rules.v1", {}); TPA.local.set("tpa.lotlist.pivot.v1", {}); await TPA.saveUiState(); });
    await p.goto(p.url().replace(/#.*$/, "") + "#screen=list"); await p.reload(); await sleep(1500);
  }, "[data-next], #llSearch"],
  // 利用者の改良依頼 2026-11-17 の 7（ダッシュボードの表・グラフの数から、一時的に明細〈元の行〉を見る。Excel のピボットのドリルダウン）。--from drill-entry で撮る:
  // drill-entry … 明細への入口（案の window.__drillEntry があれば呼ぶ。今は「仕掛区分ごと」の棒「保留」を右クリックしたメニュー〈明細の項目は無い〉）・
  // drill … 合わせた表のセル（設備ごとの表の L-1 の仕掛ロット数 231）から明細を開いた所・drill-chart … 横棒「保留」（216）から・drill-kpi … 数字のパネル「仕掛ロット数」（1,200）から・
  // drill-more … 明細を開いたまま、案の次の段（並べ替え・全部を見る・一覧で開く などの先。案の window.__drillMore）を押した所。
  // 案は window.__drillGo(kind)（kind は table・chart・kpi）で、案の入口を押した後の形にする。今は何も起きない（ダブルクリックしても数のまま）。drill-off が片付ける
  ["drill-entry", async (p) => {
    await STATES.find(([n]) => n === "dash")[1](p);
    await p.evaluate(() => document.querySelector("#dashGrid")?.scrollIntoView({ block: "start" })); await sleep(300);
    if (await p.evaluate(() => typeof window.__drillEntry === "function")) { await p.evaluate(() => window.__drillEntry()); await sleep(700); return; }
    // 版 3.126.0: 横棒「保留」を右クリック（メニューのいちばん上に「この数の明細を見る」。版 3.125.0 までは明細の項目が無い）
    const bar = await p.$('#dashGrid .db-p[data-id="wipClass"] svg [data-dr*="保留"]') || await p.$('#dashGrid .db-p[data-id="wipClass"] svg rect:nth-of-type(2)');
    const b = bar && await bar.boundingBox(); if (b) { await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" }); }
    await sleep(500);
  }, "[data-next], .tpa-menu button"],
  // 版 3.126.0 の本物: drill … 合わせた表の L-1 の仕掛ロット数を押す（左の 2 枚を覆う）・drill-chart … Esc で閉じて横棒「保留」（合わせた表を覆う）・
  // drill-kpi … 数字「仕掛ロット数」（上の段の下の全幅。タブが 2 つ）・drill-more … すべて閉じて、合わせた表の 5 つの設備を順に押す
  // （タブが 5 つ。古いタブを「前の 1 ▾」に畳む形）。明細の面の下になったパネルの数は押せない（押したパネルとほかの見えるパネルの数は押せる）
  ...["drill", "drill-chart", "drill-kpi"].map((name) => [name, async (p) => {
    if (await p.$(".tpa-menu")) { await p.keyboard.press("Escape"); await sleep(150); }
    const kind = { drill: "table", "drill-chart": "chart", "drill-kpi": "kpi" }[name];
    if (await p.evaluate(() => typeof window.__drillGo === "function")) { await p.evaluate((k) => window.__drillGo(k), kind); await sleep(900); return; }
    if (kind === "chart" && await p.$("#dashDrill")) { await p.keyboard.press("Escape"); await sleep(300); }
    const sel = { table: '#dashGrid .db-p[data-id="board"] tbody tr:first-child td.db-lots', chart: '#dashGrid .db-p[data-id="wipClass"] svg [data-dr*="保留"]', kpi: '#dashGrid .db-p[data-id="wipTotal"] .dp-num' }[kind];
    const el = await p.$(sel); if (el) await el.click().catch(() => {});
    await p.waitForSelector("#dashDrill .dd-t, #dashDrill .dd-msg.is-no", { timeout: 8000 }).catch(() => {}); await sleep(600);
  }, "[data-next], [data-db-editmode]"]),
  ["drill-more", async (p) => {
    if (await p.evaluate(() => typeof window.__drillMore === "function")) { await p.evaluate(() => window.__drillMore()); await sleep(900); return; }
    await p.evaluate(() => window.DashDrill?.closeAll()); await sleep(300);
    for (let i = 1; i <= 5; i++) {
      const el = await p.$(`#dashGrid .db-p[data-id="board"] tbody tr:nth-child(${i}) td.db-lots`); if (el) await el.click().catch(() => {});
      await sleep(500);
    }
    await p.waitForSelector("#dashDrill .dd-t", { timeout: 8000 }).catch(() => {}); await sleep(700);
  }, "[data-next], [data-db-editmode]"],
  ["drill-off", async (p) => {
    await p.evaluate(() => { window.__drillClose?.(); window.DashDrill?.closeAll(); }); await closeAll(p);
    await p.goto(p.url().replace(/#.*$/, "") + "#screen=list"); await p.reload(); await sleep(1200);
  }, "[data-next], #llSearch"],
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
async function tab(p, key) {
  // マスタ管理を開いた直後は、開く処理があとから既定のタブを選び直すことがある（版 3.118.2 の作った後の直しで、窓の相手の
  // master-release-recommended が 1 度「設備マスタ」のまま撮られた）。押したタブが選ばれ、1 秒たっても選ばれたままになるまで押し直す（8 回まで）
  const sel = `#masterTabs [data-tab="${key}"]`;
  const on = () => p.$eval(sel, (b) => b.classList.contains("active")).catch(() => false);
  for (let i = 0; i < 8; i++) {
    if (!(await on())) await p.$eval(sel, (b) => b.click());
    await sleep(300);
    if (!(await on())) continue;
    await sleep(700);                 // 選ばれたまま残るか（開く処理の後からの選び直しに負けない）
    if (await on()) return;
  }
}

/** データ元が多い形（on: 足す／false: 足した物を消す）。利用者の画面にあった台帳のマスタ（共有の .sqlite3。写していない形）と、
    品質データに製造条件マスタを合わせた「結合した表」（版 3.54.0）。グループ・見出しのタブに出さない物も混ぜる */
export const MANY_SOURCES = [
  ["組成", "QSOSEI", "台帳", "有"], ["QP直角度NLM", "QSQUARE", "台帳", "有"], ["QP直角度NLM（J）", "QSQUAREJ", "台帳", "無"], ["用途", "QYOTO", "台帳", "有"],
  ["材調", "QZAICYO", "台帳", "無"], ["材質一覧", "QZAILIST", "台帳", "有"], ["材質", "QZAISHITSU", "台帳", "無"], ["リピート", "REPEAT", "台帳", "有"],
  ["スラブ", "QSLAB", "工程", "有"], ["圧延予定", "QROLLPLAN", "工程", "無"],
];
export async function manySources(p, on) {
  await p.evaluate(async ({ on, list }) => {
    const items = (await (await fetch("/api/sources")).json()).items || [];
    const mine = new Set([...list.map((x) => x[0]), "品質データ＋製造条件"]);
    for (const it of items.filter((x) => !x.builtin && mine.has(x.name))) await fetch(`/api/sources/${it.key}?rev=${it.rev || ""}`, { method: "DELETE" });
    if (!on) { document.dispatchEvent(new CustomEvent("tpa:sources-changed")); return; }
    let n = 10;
    for (const [name, file, group, shown] of list) {
      await fetch("/api/sources", TPA.json("POST", { "表示名": name, "役割": "マスタ", "場所": `\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳\\${file}.sqlite3`,
        "画面": shown, "グループ": group, "並び": String(n++) }));
    }
    const mst = items.find((x) => x.name === "製造条件マスタ");
    if (mst) await fetch("/api/sources", TPA.json("POST", { "表示名": "品質データ＋製造条件", "役割": "その他", "元": "lot", "並び": String(n++),
      "結合": [{ with: mst.key, how: "left", on: [["合金", "材質"], ["調質", "質別"]], cols: [] }] }));
    document.dispatchEvent(new CustomEvent("tpa:sources-changed"));
  }, { on, list: MANY_SOURCES });
}

/** 撮るだけの変換表（2026-11-17 の 4）: 入力 4 つで、当てる列が 1・2・3・5 列。列・入力の名前は全角で 10〜17 字（試験のデータに有る列と、無い列〈!〉の両方） */
export const CONV_MANY = {
  name: "作業の区切り（当てる列が多い見本）",
  inputs: [
    { name: "作業開始の年月日時分秒", type: "text", columns: ["BOX実績_作業開始_年月日時分秒"] },
    { name: "子カードの区分", type: "text", columns: ["親子管理_子カード10", "ｺﾝﾏ5本ｶｰﾄﾞ区分"] },
    { name: "設備の名前（設計と実績）", type: "text", columns: ["BOX実績_設備名", "BOX設計_設備名", "設備"] },
    { name: "切断巾（コンマ5本分割）", type: "num", columns: ["コンマ5本分割_切断巾1", "コンマ5本分割_切断巾2", "コンマ5本分割_切断巾3", "コンマ5本分割_切断巾10", "切断巾_予備の列（手で足した名前）"] },
  ],
  rows: [
    { when: { "作業開始の年月日時分秒": [{ op: "filled" }], "設備の名前（設計と実績）": [{ op: "starts", v: ["CR", "L-"] }], "切断巾（コンマ5本分割）": [{ op: "range", min: "800", max: "1250" }] }, out: "冷延・標準巾" },
    { when: { "子カードの区分": [{ op: "eq", v: ["3", "9"] }], "切断巾（コンマ5本分割）": [{ op: "range", min: "1250" }] }, out: "子カード・広巾" },
    { when: { "設備の名前（設計と実績）": [{ op: "eq", v: ["HOT"] }] }, out: "熱延" },
  ],
  other: "", apply: { mode: "add", column: "作業の区切り", place: "end" },
};
/** 変換表の履歴の見本（版 3.125.0）: 全体を手でバックアップ（月末のバックアップ）→ 管理分類の後ろ 2 行を消し 3 行目の出す値を変えて保存 →
    課名の後ろ 1 行を消して保存（どちらも書く前の形が自動で残る）。on が偽なら月末のバックアップの形に全体を戻す。履歴の道が無い画面では何もしない */
export async function convHistorySeed(p, on = true) {
  await p.evaluate(async (on) => {
    const h = await fetch("/api/masters/conversions/history", { cache: "no-store" });
    if (!h.ok) return;
    const J = (m, b) => ({ method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const hist = await h.json(), month = (hist.points || []).find((x) => x.why === "月末のバックアップ");
    if (!on) { if (month) await fetch(`/api/masters/conversions/history/${month.id}/restore`, J("POST", { all: true })); return; }
    if (month) await fetch(`/api/masters/conversions/history/${month.id}/restore`, J("POST", { all: true }));
    else await fetch("/api/masters/conversions/history", J("POST", { why: "月末のバックアップ" }));
    const items = (await (await fetch("/api/masters/conversions", { cache: "no-store" })).json()).items || [];
    const put = (x, rows) => fetch(`/api/masters/conversions/${x.id}`, J("PUT", { name: x.name, inputs: x.inputs, rows, other: x.other, apply: x.apply, base_rev: x.rev }));
    const k = items.find((x) => x.name === "管理分類"), ka = items.find((x) => x.name === "課名");
    if (k) await put(k, k.rows.slice(0, -2).map((r, i) => (i === 2 ? { ...r, out: String(r.out).replace("·", "-") } : r)));
    if (ka) await put(ka, ka.rows.slice(0, -1));
  }, on);
}

/** CONV_MANY を足す（on）・消す。足したら変換表のタブを開き直してその表を選ぶ */
export async function convMany(p, on) {
  await p.evaluate(async ({ on, x }) => {
    const items = (await (await fetch("/api/masters/conversions")).json()).items || [];
    for (const it of items.filter((y) => y.name === x.name)) await fetch(`/api/masters/conversions/${it.id}?rev=${it.rev}`, { method: "DELETE" });
    if (on) await fetch("/api/masters/conversions", TPA.json("POST", x));
    const d = await (await fetch("/api/masters/conversions", { cache: "no-store" })).json();
    window.Conversions?.take(d); document.dispatchEvent(new CustomEvent("tpa:masters-changed"));
  }, { on, x: CONV_MANY });
  if (!on) return;
  await tab(p, "equipment"); await tab(p, "conv"); await p.waitForSelector("[data-cv-pick]");
  await p.evaluate((n) => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === n)?.click(), CONV_MANY.name);
}

/** 結合の欄で、製造条件マスタを 合金＝材質・調質＝質別 の 2 つの鍵で合わせる（状態 master-sources-join と評価関数 ui-eval-join.mjs） */
export async function joinDemo(p) {
  await openJoinSec(p);
  await p.click("[data-jn-add]"); await sleep(300);
  const j = "#masterSettings .jn-item:last-of-type";
  await p.selectOption(`${j} [data-jn-with]`, { label: "製造条件マスタ" }); await sleep(900);
  await p.selectOption(`${j} [data-jn-key="0"] [data-jn-l]`, "合金");
  await p.selectOption(`${j} [data-jn-key="0"] [data-jn-r]`, "材質");
  await p.click(`${j} [data-jn-addkey]`); await sleep(150);
  await p.selectOption(`${j} [data-jn-key="1"] [data-jn-l]`, "調質");
  await p.selectOption(`${j} [data-jn-key="1"] [data-jn-r]`, "質別");
  await sleep(1500);   // 「試す」の数（当たった・当たらない）が出るまで
}

/** 欄（sel）を含む段を開く（版 3.58.0: データ元の欄は畳める段。畳んだ段の欄は見えないので、触る前に開く）。sel の要素を返す */
export async function showField(p, sel) {
  await p.evaluate((q) => { const el = document.querySelector(q); const sec = el && el.closest(".sr-sec");
    if (sec && !sec.classList.contains("is-open")) sec.querySelector(".sr-sh").click(); }, sel);
  await sleep(150);
  return p.$(sel);
}

/** 開いた欄の「結合」の段を開く（版 3.58.0: 欄は畳める段。結合は 5 つ目の段） */
export async function openJoinSec(p) {
  const b = await p.$('#masterSettings .sr-card.is-open [data-sr-sec="join"][aria-expanded="false"]');
  if (b) { await b.click(); await sleep(200); }
}

/** 状態を順に進め、各状態で visit(名前, 次に押すべきもの) を呼ぶ（only を渡せば、その状態だけ）。
    返すのは進め方（go）が投げた状態の名前の並び（版 3.118.3: ui-check --states が終了コードに使う。前は console.warn だけ） */
export async function walk(page, visit, only = null, from = "") {
  const failed = [];
  page.setDefaultTimeout(5000);   // 見つからない部品で 30 秒止まらない
  const last = only ? Math.max(...STATES.map(([name], i) => (only.includes(name) ? i : -1))) : STATES.length - 1;
  // from（版 3.46.0）… その状態からたどる（前の状態の積み重ねが要らない状態だけを撮るとき。ダッシュボードの状態は "dash" から）
  const first = from ? Math.max(0, STATES.findIndex(([name]) => name === from)) : 0;
  for (const [name, go, next] of STATES.slice(first, last + 1)) {   // 撮る状態のうち最後の物まで（その先へは進まない）
    try {
      await go(page);
    } catch (e) {
      console.warn(`${name}: ${e.message.split("\n")[0]}`);
      failed.push(name);
    }
    if (!only || only.includes(name)) await visit(name, next);
  }
  return failed;
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
