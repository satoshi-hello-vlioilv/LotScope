// 式の正規表現を画面の JavaScript（static/js/list-formula.js の reOf と同じ: 長さ・regexRisk・new RegExp）が読めるか（版 3.113.0）。
// tests/test_screen_parts.py が呼ぶ（版 3.119.0。事例表 tests/fixtures/formula_regex_cases.json の js・jsWhy 欄と同じか）: 標準入力に正規表現の字の並び（JSON）→ 標準出力に [{pattern, js, why}]。TPA_LIST_FORMULA で list-formula.js の道を替えられる
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { console };
vm.createContext(ctx);
ctx.window = ctx;
ctx.WL = {};
vm.runInContext(fs.readFileSync(process.env.TPA_LIST_FORMULA || path.join(here, "..", "app", "static", "js", "list-formula.js"), "utf8"), ctx);
const F = ctx.WL.formula;
const RE_MAX = 200;
const pats = JSON.parse(fs.readFileSync(0, "utf8"));
const out = pats.map((p) => {
  try {
    if (p.length > RE_MAX) throw Error(`正規表現は${RE_MAX}文字までです`);
    const why = F.regexRisk(p);
    if (why) throw Error(why);
    new RegExp(p, "");
    return { pattern: p, js: true, why: "" };
  } catch (e) {
    return { pattern: p, js: false, why: String(e.message) };
  }
});
process.stdout.write(JSON.stringify(out));
