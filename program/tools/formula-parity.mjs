// 評価関数（開発用）: 画面の式（static/js/list-formula.js）の答えを出す。サーバーの式（services/formula.py）が同じ答えかを
// tests/test_formula_parity.py が突き合わせる（版 3.38.0。ダッシュボードで計算列を使うため、同じ式をサーバーでも計算する）。
//   node program/tools/formula-parity.mjs 入力.json   … 入力 [{expr, row}] → 標準出力へ [{ok, value | error}]
// value は数（有限）・字・null。数でない数（Infinity）は字 "Infinity" にして返す（JSON に書けないため）。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js");
const ctx = { console };
ctx.window = ctx; ctx.WL = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(JS, "list-formula.js"), "utf8"), ctx, { filename: "list-formula.js" });
const F = ctx.WL.formula;
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = cases.map(({ expr, row }) => {
  const chk = F.check(expr);
  if (!chk.ok) return { ok: false, error: chk.error };
  const v = F.compile(expr).run(row);
  return { ok: true, value: typeof v === "number" && !Number.isFinite(v) ? `#${String(v)}` : v === undefined ? null : v, text: v == null ? "" : String(v) };
});
process.stdout.write(JSON.stringify(out));
