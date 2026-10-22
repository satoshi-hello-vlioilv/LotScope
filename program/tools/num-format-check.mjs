// 評価関数（開発用。版 3.43.0）: 数の表示形式（static/js/num-format.js）が、Excel の「セルの書式設定 → 表示形式」と同じ字を出すかを
// 形ごとに突き合わせる（期待の字は Excel の書式コードの決まり〈Microsoft のヘルプ「数値の表示形式のコード」〉から決めた字）。画面の選び → コード（build）も確かめる。
//   node program/tools/num-format-check.mjs     … 全部合えば OK（終了コード 0）
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js");
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(JS, "num-format.js"), "utf8"), ctx, { filename: "num-format.js" });
const N = ctx.NumFormat;

// [コード, 値, 期待の字, 期待の色（省けば ""）]
const cases = [
  ["0", 1234.56, "1235"], ["0.00", 1234.5, "1234.50"], ["#,##0", 1234567.8, "1,234,568"], ["#,##0.0", -1234.56, "-1,234.6"],
  ["#,##0", 0, "0"], ["#,###", 0, ""], ["#.##", 0.5, ".5"], ["0.##", 2, "2."], ["0.0#", 2.345, "2.35"], ["0.???", 1.5, "1.5  "],
  ["000", 7, "007"], ["000-0000", 1234567, "123-4567"], ["#,##0,", 1234567, "1,235"], ['0.0,,"百万"', 12345678, "12.3百万"],
  ["0%", 0.256, "26%"], ["0.0%", 0.25, "25.0%"], ["0.00E+00", 12345, "1.23E+04"], ["0.00E+00", 0.000123, "1.23E-04"], ["##0.0E+0", 12345, "12.3E+3"],
  ['#,##0"本"', 1500, "1,500本"], ['"¥"#,##0', 1500, "¥1,500"], ["\\$#,##0", 99, "$99"], ['#,##0" 件"', 3, "3 件"],
  ["#,##0;(#,##0)", -1500, "(1,500)"], ['#,##0;"▲"#,##0', -1500, "▲1,500"], ['#,##0;"▲"#,##0', 1500, "1,500"],
  ["#,##0;[赤]-#,##0", -3, "-3", "#c62828"], ["[Red]0.0", -1.25, "-1.3", "#c62828"], ["[Blue]#,##0;[Red]#,##0", -5, "5", "#c62828"],
  ['0;-0;"ゼロ"', 0, "ゼロ"], ['0;-0;"ゼロ"', -2, "-2"], ['0;-0;;@"様"', "山田", "山田様"], ["0;;", -4, ""],
  ['[>=1000]#,##0,"千";0', 25000, "25千"], ['[>=1000]#,##0,"千";0', 999, "999"], ['[<0][赤]"不足 "0;0', -7, "不足 7", "#c62828"],
  ["General", 1234.5, "1234.5"], ["G/標準", 0.1 + 0.2, "0.3"], ['G/標準"本"', 12, "12本"], ["0.0", -0.04, "0.0"], ["0", 2.5, "3"],
  ["0.0", 1.05, "1.1"], ["#,##0.00", 1e6, "1,000,000.00"], ["_(#,##0_)", 12, " 12 "], ["0*-", 5, "5"],
];
let bad = 0;
for (const [code, v, want, color = ""] of cases) {
  const got = N.format(v, code);
  if (got.text !== want || (got.color || "") !== color) { bad++; console.log(`NG ${JSON.stringify(code)} ${v} → ${JSON.stringify(got.text)} ${got.color || ""}（期待 ${JSON.stringify(want)} ${color}）`); }
}
// 画面の選び → コード → 字
const built = [
  [{ cat: "num", dec: 1, sep: true }, 1234.56, "1,234.6"], [{ cat: "num", dec: 0, sep: false, suf: "本" }, 1234, "1234本"],
  [{ cat: "num", dec: 0, neg: "tri" }, -1234, "▲1,234"], [{ cat: "num", dec: 0, neg: "paren" }, -1234, "(1,234)"],
  [{ cat: "num", dec: 0, neg: "redtri" }, -1234, "▲1,234"], [{ cat: "cur", dec: 0 }, 1500, "¥1,500"], [{ cat: "cur", dec: 0, pre: "$" }, 15, "$15"],
  [{ cat: "pct", dec: 1 }, 0.1234, "12.3%"], [{ cat: "sci", dec: 2 }, 12345, "1.23E+04"], [{ cat: "custom", code: "0.0" }, 2, "2.0"], [{ cat: "" }, 2, ""],
];
for (const [ui, v, want] of built) {
  const code = N.build(ui), got = code ? N.text(v, code) : "";
  if (got !== want) { bad++; console.log(`NG build ${JSON.stringify(ui)} → ${code} → ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`); }
}
// 知らせ: 日付のコード・囲んでいない英字・使えない [ ]
const warns = [["yyyy/mm/dd", true], ['0"kg"', false], ["0 kg", true], ["[緑]0", false], ["[Font]0", true]];
for (const [code, want] of warns) if ((N.check(code).length > 0) !== want) { bad++; console.log(`NG check ${code}: ${N.check(code)}`); }
if (!N.hasLiteral('#,##0"本"') || N.hasLiteral("#,##0;(#,##0)")) { bad++; console.log("NG hasLiteral"); }
// 値の計算（版 3.45.0）: 演算子から書くと前に値・全角・かっこ・累乗・0 で割る（null）・読めない式は知らせ
// 事例はサーバー（services/num_expr.py。tests/test_num_expr.py）と同じ表（tests/fixtures/num_expr_cases.json）
const exprs = JSON.parse(fs.readFileSync(path.resolve(JS, "../../../tests/fixtures/num_expr_cases.json"), "utf8")).cases;
for (const [src, x, want] of exprs) {
  const r = N.expr(src), got = want === "err" ? (r.error ? "err" : r.fn(x)) : want === "none" ? (r.fn ? "fn" : "none") : r.fn ? r.fn(x) : r.error;
  if (got !== want) { bad++; console.log(`NG expr ${JSON.stringify(src)}(${x}) → ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`); }
}
cases.push(...exprs);
console.log(bad ? `NG ${cases.length + built.length + warns.length + 1} 件中 ${bad} 件が違う` : `OK（${cases.length + built.length + warns.length + 1} 件が Excel の決まりと同じ）`);
process.exit(bad ? 1 : 0);
