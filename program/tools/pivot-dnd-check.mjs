// 評価関数（開発用。版 3.50.0）: 行・列・値の札を引いて組み替える決まり（static/js/pivot-dnd.js の move・remove）。node で流す（tests/test_screen_parts.py からも）。
//   node program/tools/pivot-dnd-check.mjs
// 1. 同じ枠の中の並べ替え（前へ・後へ・同じ所は動かない）  2. 行 ⇔ 列へ移す（差し込む所・満ちていれば置いた札と入れ替える）
// 3. カラムの札から足す（別の枠にあれば移す・同じ枠なら並べ替え・満ちていれば断る）  4. 値 ⇔ 行・列は動かさない  5. 外す
// 6. 札の数は増えも減りもしない（同じ札が 2 つにならない）。全部合えば終了コード 0
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js");
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(JS, "pivot-dnd.js"), "utf8"), ctx, { filename: "pivot-dnd.js" });
const D = ctx.PivotDnd;
let bad = 0, n = 0;
const names = (L) => ({ rows: L.rows.map((x) => x.column), cols: L.cols.map((x) => x.column), vals: L.vals.map((x) => x.column || x.agg) });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, ok, got) => { n++; console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) bad++; };
const d = (c) => ({ column: c, part: "" });
const base = () => ({ rows: [d("設備"), d("作業日"), d("直")], cols: [d("作業区分")], vals: [{ agg: "lots" }, { agg: "sum", column: "重量" }] });
const MAX = { rows: 3, cols: 3, vals: 4 };
const run = (from, to) => D.move(base(), from, to, MAX);

let r = run({ role: "rows", i: 0 }, { role: "rows", index: 2 });
check("1 設備を作業日の後へ", eq(names(r.lists).rows, ["作業日", "設備", "直"]), names(r.lists || base()));
r = run({ role: "rows", i: 2 }, { role: "rows", index: 0 });
check("1 直をいちばん前へ", eq(names(r.lists).rows, ["直", "設備", "作業日"]), names(r.lists || base()));
check("1 同じ所（前・後ろの隙間）は動かない", !run({ role: "rows", i: 1 }, { role: "rows", index: 1 }).lists && !run({ role: "rows", i: 1 }, { role: "rows", index: 2 }).lists);
r = run({ role: "rows", i: 0 }, { role: "rows", index: 3 });
check("1 いちばん後ろへ", eq(names(r.lists).rows, ["作業日", "直", "設備"]), names(r.lists || base()));
r = run({ role: "vals", i: 1 }, { role: "vals", index: 0 });
check("1 値の並べ替え（グラフにする値の順）", eq(names(r.lists).vals, ["重量", "lots"]), names(r.lists || base()));

r = run({ role: "cols", i: 0 }, { role: "rows", index: 1 });
check("2 列の作業区分を行の 2 つ目へ（行が満ちていれば入れ替え）", eq(names(r.lists), { rows: ["設備", "作業区分", "直"], cols: ["作業日"], vals: ["lots", "重量"] }) && /入れ替え/.test(r.msg), [names(r.lists), r.msg]);
r = run({ role: "rows", i: 1 }, { role: "cols", index: 0 });
check("2 行の作業日を列の前へ", eq(names(r.lists), { rows: ["設備", "直"], cols: ["作業日", "作業区分"], vals: ["lots", "重量"] }), names(r.lists));
r = D.move({ rows: [d("設備")], cols: [], vals: [] }, { role: "rows", i: 0 }, { role: "cols", index: 0 }, MAX);
check("2 行をみな列へ移すと行は空（呼ぶ側が知らせる）", eq(names(r.lists), { rows: [], cols: ["設備"], vals: [] }));

r = run({ item: d("合金"), roles: ["rows", "cols"] }, { role: "cols", index: 0 });
check("3 カラムの札を列の前に足す", eq(names(r.lists).cols, ["合金", "作業区分"]), names(r.lists));
r = run({ item: d("作業区分"), roles: ["rows", "cols"] }, { role: "cols", index: 1 });
check("3 同じ枠に既にある札は動かない（同じ所）", !r.lists);
r = D.move({ rows: [d("設備")], cols: [d("作業区分")], vals: [] }, { item: d("作業区分"), roles: ["rows", "cols"] }, { role: "rows", index: 0 }, MAX);
check("3 列にある札を行へ置くと、行へ移る（2 つにならない）", eq(names(r.lists), { rows: ["作業区分", "設備"], cols: [], vals: [] }), names(r.lists));
r = run({ item: d("合金"), roles: ["rows", "cols"] }, { role: "rows", index: 0 });
check("3 満ちた行へは足さない（理由の字）", !r.lists && /3 つまで/.test(r.msg), r.msg);
r = run({ item: { agg: "avg", column: "速度" }, roles: ["rows", "cols", "vals"] }, { role: "vals", index: 1 });
check("3 数のカラムを値の間に足す", eq(names(r.lists).vals, ["lots", "速度", "重量"]), names(r.lists));
r = run({ item: { agg: "sum", column: "重量" }, roles: ["rows", "cols", "vals"] }, { role: "vals", index: 0 });
check("3 同じ値はふやさず、並べ替える", eq(names(r.lists).vals, ["重量", "lots"]), names(r.lists));
r = run({ item: d("作業者"), roles: ["rows", "cols"] }, { role: "vals", index: 0 });
check("3 数でないカラムは値に置けない（置ける役だけ）", !r.lists && r.msg, r.msg);

r = D.move({ rows: [d("設備")], cols: [], vals: [{ agg: "lots" }] }, { item: { agg: "sum", column: "重量" }, roles: ["vals"] }, { role: "vals", index: 1 }, { rows: 1, cols: 2, vals: 1 });
check("3 1 つだけ置ける値（合わせた表のまとまり）は置き換える", eq(names(r.lists).vals, ["重量"]), names(r.lists || base()));
r = D.move({ rows: [d("設備")], cols: [], vals: [] }, { item: d("作業日"), roles: ["rows"] }, { role: "rows", index: 0 }, { rows: 1, cols: 0, vals: 1 });
check("3 1 つだけ置ける軸（合わせるデータ）は置き換える", eq(names(r.lists).rows, ["作業日"]), names(r.lists || base()));
r = run({ role: "vals", i: 0 }, { role: "rows", index: 0 });
check("4 値の札は行に置けない", !r.lists && /置けません/.test(r.msg), r.msg);
r = run({ role: "rows", i: 0 }, { role: "vals", index: 0 });
check("4 行の札は値に置けない", !r.lists && /置けません/.test(r.msg), r.msg);

const L5 = D.remove(base(), { role: "rows", i: 1 });
check("5 外す", eq(names(L5).rows, ["設備", "直"]));
check("5 無い札は外さない", D.remove(base(), { role: "cols", i: 3 }) === null);

// 6. どの動かし方でも、札の数は保たれる（総当たり）
let kept = true;
for (const fr of ["rows", "cols", "vals"]) for (let i = 0; i < base()[fr].length; i++) for (const tr of ["rows", "cols", "vals"]) for (let k = 0; k <= base()[tr].length; k++) {
  const x = run({ role: fr, i }, { role: tr, index: k });
  if (!x.lists) continue;
  const all = [...x.lists.rows, ...x.lists.cols, ...x.lists.vals].map((y) => y.column || y.agg);
  if (all.length !== 6 || new Set(all).size !== 6 || x.lists.rows.length > 3 || x.lists.cols.length > 3) { kept = false; console.log("  崩れた:", fr, i, tr, k, JSON.stringify(names(x.lists))); }
}
check("6 総当たりで札が増えも減りもせず、上限を超えない", kept);
console.log(bad ? `NG ${n} 件中 ${bad} 件が違う` : `OK（${n} 件）`);
process.exit(bad ? 1 : 0);
