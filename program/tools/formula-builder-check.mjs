// 評価関数（開発用）: 式ビルダー（static/js/formula-builder.js）で組み立てた物が、式の決まり（list-formula.js。WaveLog と同じ）で
// 読めて、思ったとおりの値になるかを、形ごとに突き合わせる。
//   node program/tools/formula-builder-check.mjs     … 全部合えば OK（終了コード 0）
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js");
const ctx = { console };
ctx.window = ctx; ctx.WL = {};
vm.createContext(ctx);
for (const f of ["list-formula.js", "formula-builder.js"]) vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
const { build } = ctx.FormulaBuilder, F = ctx.WL.formula;

const row = { "開始": "2026/10/01 8:15:00", "終了": "2026/10/01 9:45:30", "重量": 1200, "板幅": 400, "合金": "A5052", "調質": "H24", "備考": "", "客先": null, "ロット番号": "L0123C4", "名": "O'Neil" };
const C = (col) => ({ col }), V = (val) => ({ val });
const cases = [
  ["割り算", { kind: "calc", terms: [C("重量"), { ...C("板幅"), op: "/" }], decimals: "" }, "[重量] / [板幅]", 3],
  ["掛けて丸める", { kind: "calc", terms: [C("重量"), { ...V("0.001"), op: "*" }, { ...V("2"), op: "+" }], decimals: 1 }, "round([重量] * 0.001 + 2, 1)", 3.2],
  ["以上なら", { kind: "if", left: C("重量"), cmp: ">=", right: V("1000"), then: V("重"), else: V("軽") }, "if([重量] >= 1000, '重', '軽')", "重"],
  ["同じなら（文字）", { kind: "if", left: C("合金"), cmp: "=", right: V("A1100"), then: V("1100"), else: C("合金") }, null, "A5052"],
  ["含む", { kind: "if", left: C("ロット番号"), cmp: "contains", right: V("C4"), then: V("○"), else: V("") }, null, "○"],
  ["空欄（空文字）", { kind: "if", left: C("備考"), cmp: "empty", then: V("なし"), else: C("備考") }, null, "なし"],
  ["空欄（値が無い）", { kind: "if", left: C("客先"), cmp: "empty", then: V("未定"), else: C("客先") }, null, "未定"],
  ["空欄でない", { kind: "if", left: C("合金"), cmp: "notempty", then: V("有"), else: V("無") }, null, "有"],
  ["つなぐ（区切り）", { kind: "join", terms: [C("合金"), C("調質")], sep: "-" }, "concat([合金], '-', [調質])", "A5052-H24"],
  ["つなぐ（区切りなし）", { kind: "join", terms: [C("合金"), V("/"), C("調質")], sep: "" }, null, "A5052/H24"],
  ["1 つだけ", { kind: "join", terms: [C("重量")], sep: "-" }, "text([重量])", "1200"],
  ["左から", { kind: "cut", from: C("ロット番号"), how: "left", count: 5 }, "left([ロット番号], 5)", "L0123"],
  ["右から", { kind: "cut", from: C("ロット番号"), how: "right", count: 2 }, null, "C4"],
  ["途中", { kind: "cut", from: C("ロット番号"), how: "mid", start: 2, count: 4 }, "mid([ロット番号], 2, 4)", "0123"],
  ["空なら", { kind: "fill", from: C("客先"), alt: V("-") }, "coalesce([客先], '-')", "-"],
  ["丸める", { kind: "round", from: C("重量"), decimals: 0 }, "round([重量], 0)", 1200],
  ["文字数", { kind: "count", from: C("ロット番号"), how: "len", what: V("") }, "len([ロット番号])", 7],
  ["字の数", { kind: "count", from: C("ロット番号"), how: "count", what: V("C") }, "count([ロット番号], 'C')", 1],
  ["バイト数", { kind: "count", from: V("ｱ漢"), how: "lenb", what: V("") }, "lenb('ｱ漢')", 3],
  ["時間の差（分）", { kind: "span", from: C("開始"), to: C("終了"), unit: "m" }, "datediff([開始], [終了], 'm')", 90.5],
  ["時間の差（時間）", { kind: "span", from: C("開始"), to: C("終了"), unit: "h" }, null, 1.5083333333333333],
  ["' を含む文字", { kind: "if", left: C("名"), cmp: "=", right: V("O'Neil"), then: V("it's"), else: V("") }, `if([名] = "O'Neil", "it's", '')`, "it's"],
  ["' と \" を両方含む文字", { kind: "fill", from: C("備考"), alt: V(`a'b"c`) }, `coalesce([備考], concat('a', "'", 'b"c'))`, `a'b"c`],
];
let ng = 0;
for (const [name, spec, want, value] of cases) {
  const f = build(spec), chk = F.check(f), got = chk.ok ? F.compile(f).run(row) : `（読めない: ${chk.error}）`;
  const okText = want == null || f === want, okVal = String(got) === String(value);
  if (!okText || !okVal) ng++;
  console.log(`${okText && okVal ? "OK" : "NG"} ${name}: ${f} → ${JSON.stringify(got)}${okText ? "" : `（式の期待: ${want}）`}${okVal ? "" : `（値の期待: ${JSON.stringify(value)}）`}`);
}
console.log(ng ? `FAILED ${ng}/${cases.length}` : `OK ${cases.length}/${cases.length}`);
process.exit(ng ? 1 : 0);
