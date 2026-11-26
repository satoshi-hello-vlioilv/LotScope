// 評価関数（開発用。版 3.123.0）: ルールで作る列（表示列の窓の「≡ ルールで作る」）の決まりを、事例の表で確かめる。
//   node program/tools/rule-formula-check.mjs     … 全部合えば OK（終了コード 0）
//
// 事例の表 program/tests/fixtures/rule_formula_cases.json は、人が仕様から書いた物（ルールの行・試す行・その行の答え want）と、
// 画面のルール → 式（lotlist-rules.js の formulaOf。この列＝空欄）の答え expr（凍った答え）を持つ。ここでは画面の側で 3 つを突き合わせる:
//   1. 画面がルールから作る式が、表の expr と同じ（変わったら表を見直す）
//   2. その式を画面の式（list-formula.js）で動かした答えが want と同じ（窓へ送るのはこの式。並べ替え・集計表の答え）
//   3. 一覧のセルの道（ルールの判定 match → 出す字 textOf）の答えも want と同じ（セルの字と、並べ替え・集計表の値が食い違わない）
// 窓の側（desktop/src/formula.rs）は `cargo test --test rule_formula_cases` が同じ表の expr を動かして want と突き合わせる。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = path.resolve(HERE, "../app/static/js");
const TABLE = path.resolve(HERE, "../tests/fixtures/rule_formula_cases.json");

// lotlist-rules.js は窓（ブラウザ）の部品なので、使わない口（DOM・置き場・保存していない変更の見張り）は空の物で代える
const store = {};
const ctx = { console };
ctx.window = ctx; ctx.WL = {};
ctx.TPA = {
  $: () => null, $$: () => [], esc: (s) => String(s),
  local: { get: (k, d) => (k in store ? JSON.parse(store[k]) : d), set: (k, v) => { store[k] = JSON.stringify(v); } },
  clone: (x) => JSON.parse(JSON.stringify(x)),
  unsaved: { watch() {}, leave: async () => true },
};
vm.createContext(ctx);
for (const f of ["list-formula.js", "lotlist-rules.js"]) vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
const F = ctx.WL.formula, R = ctx.LotListRules;

const table = JSON.parse(fs.readFileSync(TABLE, "utf8"));
const write = process.argv.includes("--write-expr");   // 画面の式を表の expr に書く（決まりを変えたときだけ。want は人が書く）
const bad = [];
let n = 0;
for (const c of table.cases) {
  const { expr, notes } = c.rule.length ? R.formulaOf(c.rule, { column: c.column, computed: true }) : { expr: "''", notes: [] };
  if (write) { c.expr = expr; c.notes = notes; continue; }
  if (expr !== c.expr) bad.push(`${c.name}: 画面の式が表と違う\n    画面 ${expr}\n    表   ${c.expr}`);
  const chk = F.check(expr);
  if (!chk.ok) { bad.push(`${c.name}: 画面の式が読めない（${chk.error}）。ルールで作る列の式はいつも読める（読めない部分は空欄にする）`); continue; }
  const run = F.compile(expr);
  table.rows.forEach((row, i) => {
    n++;
    const want = c.want[i];
    const v = run.run(Object.assign({}, row)), got = v == null ? "" : String(v);
    if (got !== want) bad.push(`${c.name}: 行 ${i + 1}（${row["ロット番号"]}）の式の答え ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    const hit = R.match(c.rule, row, c.column), cell = hit ? String(R.textOf(hit, row) ?? "") : "";
    if (cell !== want) bad.push(`${c.name}: 行 ${i + 1}（${row["ロット番号"]}）のセルの答え ${JSON.stringify(cell)} ≠ ${JSON.stringify(want)}`);
  });
  for (const must of c.notesHave || []) if (!notes.some((t) => t.includes(must))) bad.push(`${c.name}: 知らせに「${must}」が無い（${notes.join(" / ")}）`);
}
if (write) {
  fs.writeFileSync(TABLE, JSON.stringify(table, null, 1) + "\n");
  console.log(`表の expr を書きました（${table.cases.length} 件）`);
  process.exit(0);
}
if (bad.length) { console.log(bad.join("\n")); console.log(`FAILED ${bad.length}`); process.exit(1); }
if (table.cases.length < 10 || n < 60) { console.log(`事例が少なすぎる（${table.cases.length} 件・${n} 行）`); process.exit(1); }
console.log(`OK ルールで作る列 ${table.cases.length} 件 × ${table.rows.length} 行（式の答え・セルの答え）`);
