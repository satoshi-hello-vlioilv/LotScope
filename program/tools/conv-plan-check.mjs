// 評価関数（開発用）: 変換表を一覧の列に当てる計画（static/js/conversions.js の plan・applyTo）。node で流す（tests/test_screen_parts.py からも）。
//   node program/tools/conv-plan-check.mjs
// プリセット（app/master_defaults/conversions.json）を、SymfoNavi のクエリ（LOTACH.RNE）の列の名前の表に当てて:
// 1. コードの読み替え（作り替え）は、名前の違う列（ｺﾝﾏ5本ｶｰﾄﾞ区分）にも当たり、無い列（納期符号）は「列がありません」
// 2. 形状区分・管理分類はいちばん左に足し、管理分類は形状区分の列を読む（無ければ形状区分の conv を中に書く）
// 3. 課名は設備の列ごとに「列名_課」を、その列の右に足す
// 4. 当てた後の式で一覧の行を計算すると、M 言語と同じ答え（例の行）
// 5. 当てた所にもう 1 度当てても、並びも式も変わらない（done）
// 最後の行が OK なら合っている。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), JS = path.resolve(HERE, "../app/static/js");
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["list-formula.js", "conversions.js"]) vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
const rows = JSON.parse(fs.readFileSync(path.resolve(HERE, "../app/master_defaults/conversions.json"), "utf8"));
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
ctx.Conversions.take({ revision: 1, items: rows.map((r) => ({ name: r["名前"], inputs: J(r["入力"], []), rows: J(r["判定"], []), other: r["その他"], apply: J(r["当て方"], {}) })) });
const C = ctx.Conversions, F = ctx.WL.formula;
let bad = 0;
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) bad++; };

// LOTACH.RNE の列（抜粋）
const COLS = ["BOX番号", "設計_設備ｺｰｽ", "実績_設備ｺｰｽ", "形状", "表面", "ｺﾝﾏ5本ｶｰﾄﾞ区分", "地取区分", "特急区分", "BOX実績_設備名", "BOX設計_設備名",
  "ﾛｯﾄ番号", "用途ｺｰﾄﾞ", "ｵｰﾀﾞｰ材質", "ｵｰﾀﾞｰ調質", "ｵｰﾀﾞｰ板厚", "ｵｰﾀﾞｰ板幅"];
const NAMES = rows.map((r) => r["名前"]);
const plans = C.planAll(NAMES, COLS, {});
const P = Object.fromEntries(plans.map((p) => [p.name, p]));
check("1. ｺﾝﾏ5本区分は ｺﾝﾏ5本ｶｰﾄﾞ区分 の列を作り替える", P["ｺﾝﾏ5本区分"].ok && P["ｺﾝﾏ5本区分"].targets[0].column === "ｺﾝﾏ5本ｶｰﾄﾞ区分"
  && P["ｺﾝﾏ5本区分"].targets[0].formula === "conv('ｺﾝﾏ5本区分', [ｺﾝﾏ5本ｶｰﾄﾞ区分])", P["ｺﾝﾏ5本区分"]);
check("1. 納期符号・保留区分は列が無いので当てられない（足りない入力を言う）", !P["納期符号"].ok && P["納期符号"].missing[0] === "納期符号" && !P["保留区分"].ok, [P["納期符号"], P["保留区分"]]);
check("2. 形状区分は 表面・形状・用途ｺｰﾄﾞ から、いちばん左に足す", P["形状区分"].targets[0].formula === "conv('形状区分', [表面], [形状], [用途ｺｰﾄﾞ])" && P["形状区分"].targets[0].place === "left", P["形状区分"]);
check("2. まとめて当てると、管理分類は先に足した形状区分の列を読む", P["管理分類"].targets[0].formula.startsWith("conv('管理分類', [形状区分], [ｵｰﾀﾞｰ材質]"), P["管理分類"].targets[0]);
const alone = C.plan("管理分類", COLS, {});
check("2. 管理分類だけを当てるときは、形状区分の conv を中に書く",
  alone.targets[0].formula === "conv('管理分類', conv('形状区分', [表面], [形状], [用途ｺｰﾄﾞ]), [ｵｰﾀﾞｰ材質], [ｵｰﾀﾞｰ調質], [ｵｰﾀﾞｰ板厚], [ｵｰﾀﾞｰ板幅], [用途ｺｰﾄﾞ])"
  && alone.inputs[0].table === "形状区分", alone);
check("3. 課名は設備の列ごと（BOX実績_設備名_課・BOX設計_設備名_課）を、その列の右に",
  JSON.stringify(P["課名"].targets.map((t) => [t.column, t.place, t.after])) === JSON.stringify([["BOX実績_設備名_課", "after", "BOX実績_設備名"], ["BOX設計_設備名_課", "after", "BOX設計_設備名"]]), P["課名"].targets);
// 当てた形
const ok = plans.filter((p) => p.ok);
const done = C.applyTo(ok, { formulas: {}, order: COLS });
check("2・3. 並び: 管理分類・形状区分がいちばん左（後に当てた物が左）、課名は設備の列の右",
  done.order[0] === "管理分類" && done.order[1] === "形状区分" && done.order[done.order.indexOf("BOX実績_設備名") + 1] === "BOX実績_設備名_課", done.order);
const second = C.planAll(NAMES, done.order, done.formulas).filter((p) => p.ok);
const again = C.applyTo(second, done);
check("5. もう 1 度当てても並び・式は同じ・done", JSON.stringify(again) === JSON.stringify(done) && second.every((p) => p.done), second.filter((p) => !p.done).map((p) => p.targets));
// 4. 当てた後の式で行を計算（作り替えの列は元の値を読む・形状区分の列を足した後の管理分類は [形状区分] を読む）
const row = { "表面": "41", "形状": "3", "用途ｺｰﾄﾞ": "F975", "ｵｰﾀﾞｰ材質": "A1100", "ｵｰﾀﾞｰ調質": "H24", "ｵｰﾀﾞｰ板厚": "0.5", "ｵｰﾀﾞｰ板幅": "1200",
  "地取区分": 2, "特急区分": "0", "ｺﾝﾏ5本ｶｰﾄﾞ区分": "9", "BOX実績_設備名": "CAS2", "BOX設計_設備名": "(TLV)" };
// 管理分類は [形状区分]（計算列）を読む: 一覧の baseRow と同じく、計算列の式を元の値で 1 段だけ計算した行で
const look = new Proxy({}, { get: (_, k) => (k in row ? row[k] : done.formulas[k] ? F.compile(done.formulas[k]).run(row) : undefined) });
const val = (col) => F.compile(done.formulas[col]).run(look);
check("4. 1 行の答え（M 言語と同じ）", JSON.stringify(["形状区分", "管理分類", "地取区分", "特急区分", "ｺﾝﾏ5本ｶｰﾄﾞ区分", "BOX実績_設備名_課", "BOX設計_設備名_課"].map(val))
  === JSON.stringify(["4HIｺｲﾙ", "ｸﾘﾔｰ材", "2:再手配", "", "9:0.5本残", "鋳造課", "(TLV)"]), ["形状区分", "管理分類", "地取区分", "特急区分", "ｺﾝﾏ5本ｶｰﾄﾞ区分", "BOX実績_設備名_課", "BOX設計_設備名_課"].map(val));
const withCol = C.plan("管理分類", [...COLS, "形状区分"], {});
check("2. 形状区分の列があれば [形状区分] を読む", withCol.targets[0].formula.startsWith("conv('管理分類', [形状区分], "), withCol.targets[0].formula);
check("summary: コードは「0 → 0:一般」、判定表は出す値", C.summary(C.get("地取区分")).startsWith("0 → 0:一般・2 → 2:再手配") && C.summary(C.get("形状区分")).startsWith("HOT・2HI・箔"), [C.summary(C.get("地取区分")), C.summary(C.get("形状区分"))]);
console.log(bad ? `NG ${bad} 件` : "OK 変換表を当てる計画は合っています");
process.exit(bad ? 1 : 0);
