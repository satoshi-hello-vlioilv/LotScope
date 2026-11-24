// 撮る・採点する道具（ui-harness.mjs を使う本）を全部流す台本（開発用。版 3.118.2）。
//
//   node program/tools/ui-all.mjs 出力フォルダ [--server window|python] [--jobs 3] [--only 本,…] [--skip 本,…] [--base 基準の results.json] [--no-build]
//
// 本ごとに、作業のフォルダ（出力フォルダ/run/本）を今のフォルダにして node で流し、終了コード・秒・「OK／NG」の行の数を
// 出力フォルダの results.json と table.md に書く（出力は logs/本.log）。結果は終了コードで読む（最後の 1 行で判断しない）。
// 相手（開発用サーバー）は ui-harness.mjs の TPA_UI_SERVER（既定は窓）。窓の相手のときは、最初に窓の開発用サーバーを組む
// （cargo build --example ui_serve。--no-build で組まない）。窓にまだ無い口を使う本（PYTHON_ONLY）は、窓の表でも Python の相手で流し、表に印を付ける。
// --base に前の表（Python の相手で流した基準）を渡すと、基準でも落ちていた本を「前から」と分けて数える（窓だけで落ちる本が 0 かを見る）。

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const PROGRAM = path.resolve(TOOLS, "..");
const DESKTOP = path.resolve(PROGRAM, "../desktop");

/** 窓にまだ無い口を使う本 → 理由（窓の表でも Python の相手で流す。版 3.118.3 で窓へ） */
export const PYTHON_ONLY = {
  "ui-eval-dashwait.mjs": "遅くする口（TPA_UI_SLOW_FILE）が窓にまだ無い（版 3.118.3 で feature testing の下に置く）",
};

/** 引数の要る本の引数（OUT は本ごとの出力のフォルダ）。ほかは引数なし（既定の大きさ・出力なし） */
const ARGS = {
  "ui-check.mjs": (out) => [out, "light"],
  "ui-variants.mjs": (out) => [out, path.join(TOOLS, "ui-proposals/2026-11-stage2b.mjs"), "--states", "list"],
  "shot-dashunit.mjs": (out) => [out],
  "shot-unify.mjs": (out) => [out],
};

function opts(argv) {
  const o = { out: "", server: process.env.TPA_UI_SERVER === "python" ? "python" : "window", jobs: 3, only: null, skip: [], base: "", build: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") o.server = argv[++i];
    else if (a === "--jobs") o.jobs = Number(argv[++i]);
    else if (a === "--only") o.only = argv[++i].split(",").map(norm);
    else if (a === "--skip") o.skip = argv[++i].split(",").map(norm);
    else if (a === "--base") o.base = argv[++i];
    else if (a === "--no-build") o.build = false;
    else if (!o.out) o.out = a;
    else throw new Error(`知らない引数: ${a}`);
  }
  if (!o.out) {
    console.error("使い方: node program/tools/ui-all.mjs 出力フォルダ [--server window|python] [--jobs 3] [--only 本,…] [--skip 本,…] [--base 基準.json] [--no-build]");
    process.exit(2);
  }
  if (!["window", "python"].includes(o.server)) throw new Error(`--server は window か python: ${o.server}`);
  return o;
}
const norm = (n) => (n.endsWith(".mjs") ? n : `${n}.mjs`);

/** ui-harness.mjs を import する本（道具そのもの・この台本・画素の比べ ui-diff.mjs を除く） */
export function tools() {
  return fs.readdirSync(TOOLS).filter((f) => f.endsWith(".mjs") && f !== "ui-harness.mjs" && f !== "ui-all.mjs" && f !== "ui-diff.mjs")
    .filter((f) => /from\s+["']\.\/ui-harness\.mjs["']|import\(["']\.\/ui-harness\.mjs["']\)/.test(fs.readFileSync(path.join(TOOLS, f), "utf-8")))
    .sort();
}

/** 出力の「OK」「NG」の行の数（✓・✗ も）。結果の判断は終了コード（この数は表の添え書き） */
function marks(text) {
  const lines = text.split(/\r?\n/);
  const ok = lines.filter((l) => /(^|\s)(OK|✓)(\s|$|:)/.test(l)).length;
  const ng = lines.filter((l) => /(^|\s)(NG|✗|FAIL)(\s|$|:)/.test(l)).length;
  return { ok, ng };
}

function runOne(name, o) {
  const run = path.join(o.out, "run", name.replace(/\.mjs$/, ""));
  fs.mkdirSync(run, { recursive: true });
  const shots = path.join(run, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const args = [path.join(TOOLS, name), ...(ARGS[name] ? ARGS[name](shots) : [])];
  const server = PYTHON_ONLY[name] ? "python" : o.server;
  const log = path.join(o.out, "logs", name.replace(/\.mjs$/, ".log"));
  const t0 = Date.now();
  return new Promise((done) => {
    // 本ごとに自分のプロセスの組（detached）で起こし、本が終わったら組ごと止める（本が残した子〈開発用サーバー〉が標準エラーをつかんだまま待ちを止めない）
    const child = spawn(process.execPath, args, { cwd: run, env: { ...process.env, TPA_UI_SERVER: server }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    child.on("exit", () => { setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* 済み */ } }, 3000); });
    let text = "";
    child.stdout.on("data", (d) => { text += d; });
    child.stderr.on("data", (d) => { text += d; });
    const limit = setTimeout(() => { text += "\n[ui-all] 60 分で止めました\n"; child.kill("SIGKILL"); }, 60 * 60 * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(limit);
      fs.writeFileSync(log, text);
      const sec = Math.round((Date.now() - t0) / 100) / 10;
      const r = { name, code: code ?? -1, signal: signal || "", sec, server, ...marks(text), pythonOnly: PYTHON_ONLY[name] || "" };
      console.log(`${r.code === 0 ? "PASS" : "FAIL"} ${name} code=${r.code} ${sec}s server=${server} OK行=${r.ok} NG行=${r.ng}`);
      done(r);
    });
  });
}

async function main() {
  const o = opts(process.argv.slice(2));
  o.out = path.resolve(o.out);
  fs.mkdirSync(path.join(o.out, "logs"), { recursive: true });
  if (o.server === "window" && o.build) {
    console.log("窓の開発用サーバーを組みます（cargo build --example ui_serve）");
    execFileSync("cargo", ["build", "--example", "ui_serve"], { cwd: DESKTOP, stdio: "inherit" });
  }
  let list = tools();
  if (o.only) list = list.filter((n) => o.only.includes(n));
  list = list.filter((n) => !o.skip.includes(n));
  const base = o.base ? JSON.parse(fs.readFileSync(o.base, "utf-8")) : null;
  const before = new Map((base?.results || []).map((r) => [r.name, r]));
  const results = [];
  const queue = [...list];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.max(1, o.jobs) }, async () => {
    while (queue.length) results.push(await runOne(queue.shift(), o));
  }));
  results.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of results) {
    const b = before.get(r.name);
    r.before = b ? b.code : null;
    r.kind = r.code === 0 ? "pass" : b && b.code !== 0 ? "前から" : "this";
  }
  const sum = {
    server: o.server, at: new Date().toISOString(), total: results.length, pass: results.filter((r) => r.code === 0).length,
    fail: results.filter((r) => r.code !== 0).length, failOld: results.filter((r) => r.kind === "前から").length,
    failNew: results.filter((r) => r.kind === "this").length, pythonOnly: results.filter((r) => r.pythonOnly).map((r) => r.name),
    minutes: Math.round((Date.now() - t0) / 6000) / 10, base: o.base || "",
  };
  fs.writeFileSync(path.join(o.out, "results.json"), JSON.stringify({ summary: sum, results }, null, 2));
  const rows = results.map((r) => `| ${r.name} | ${r.code} | ${r.sec} | ${r.server}${r.pythonOnly ? "（窓にまだ無い口）" : ""} | ${r.ok} | ${r.ng} | ${r.before ?? ""} | ${r.kind} |`);
  fs.writeFileSync(path.join(o.out, "table.md"), [
    `# ui-all（相手 ${o.server}）`, "",
    `本 ${sum.total}・終了コード 0 が ${sum.pass}・0 でない ${sum.fail}（基準でも落ちていた「前から」${sum.failOld}・この相手だけ ${sum.failNew}）・${sum.minutes} 分`, "",
    "| 本 | 終了コード | 秒 | 相手 | OK 行 | NG 行 | 基準の終了コード | 分け |", "|---|---|---|---|---|---|---|---|", ...rows, ""].join("\n"));
  console.log(`SUMMARY server=${sum.server} total=${sum.total} pass=${sum.pass} fail=${sum.fail} failOld=${sum.failOld} failNew=${sum.failNew} minutes=${sum.minutes}`);
  process.exit(sum.fail ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
