// 評価関数（開発用）: 画面の式（static/js/list-formula.js）の答えを出す（版 3.38.0）。tests/test_screen_parts.py が、事例表
// tests/fixtures/formula_cases.json（窓の式〈desktop/src/formula.rs〉も cargo test --test formula_cases で同じ表と比べる）の js 欄と同じかを見る
// （版 3.119.0。表は凍った答え: 画面の式を直したら、この道具の答えで表の js 欄を直す）。TPA_LIST_FORMULA で list-formula.js の道を替えられる（変異の試験）。
//   node program/tools/formula-parity.mjs 入力.json   … 入力 [{expr, row}] → 標準出力へ [{ok, value | error}]
//   入力は {cases: [{expr, row}], tables: {名前: 変換表}} でもよい（版 3.42.0。式の conv が引く変換表）
// value は数（有限）・字・null。数でない数（Infinity）は字 "Infinity" にして返す（JSON に書けないため）。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js");
const ctx = { console };
ctx.window = ctx; ctx.WL = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.env.TPA_LIST_FORMULA || path.join(JS, "list-formula.js"), "utf8"), ctx, { filename: "list-formula.js" });
const F = ctx.WL.formula;
const given = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cases = Array.isArray(given) ? given : given.cases;
const tables = Array.isArray(given) ? {} : given.tables || {};
F.setTables((name) => (Object.prototype.hasOwnProperty.call(tables, name) ? tables[name] : null));
const out = cases.map(({ expr, row }) => {
  const chk = F.check(expr);
  if (!chk.ok) return { ok: false, error: chk.error };
  const v = F.compile(expr).run(row);
  return { ok: true, value: typeof v === "number" && !Number.isFinite(v) ? `#${String(v)}` : v === undefined ? null : v, text: v == null ? "" : String(v) };
});
process.stdout.write(JSON.stringify(out));
