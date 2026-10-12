// 評価関数（開発用）: Excel（.xlsx）を組む部品（static/js/xlsx-writer.js）が、正しい .xlsx を書くか。
//   node program/tools/xlsx-check.mjs [出力.xlsx]
// 日本語・空・数（先頭の 0 は字のまま）・記号（& < > "）・使えない字・長い表（列 30・行 2000）・同じシート名を書き、
// Python の標準の zipfile と xml で読み戻して、セルの値・型・見出しの固定・オートフィルター・シート名を突き合わせる。
// 書いた .xlsx を残したいときは出力の場所を渡す（Excel で開いて見るため）。全部合えば終了コード 0。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/static/js/xlsx-writer.js");
const ctx = { console, TextEncoder, Blob, Response, CompressionStream, Uint8Array, Uint32Array, DataView, ArrayBuffer, Date, Math, String, Number, Array, Set };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(JS, "utf8"), ctx, { filename: "xlsx-writer.js" });

const big = [["ロット番号", ...Array.from({ length: 29 }, (_, i) => `列${i + 1}`)]];
for (let r = 0; r < 2000; r++) big.push([`L${String(r).padStart(4, "0")}C1`, ...Array.from({ length: 29 }, (_, i) => (i % 3 ? String(r * i) : `値${r}-${i}`))]);
const sheets = [
  { name: "一覧", rows: [["ロット番号", "重量", "備考", "板厚"], ["L0001C1", "1200.5", "速度落とし & 再確認 <要>", "007"], ["L0002C2", "", '"引用"', "0.3"], ["L0003C3", "-12", "制御字\u0001あり", "1e-05"], ["L0004C4", "12345678901234567", "", "abc"]] },
  { name: "一覧", rows: big },
  { name: "出力の条件", header: false, rows: [["一覧", "異常ロット一覧"], ["条件", "設備 ＝ CR1"]] },
];
const bytes = await ctx.XlsxWriter.build(sheets);
const out = process.argv[2] || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xlsx-")), "check.xlsx");
fs.writeFileSync(out, bytes);
const py = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as ET
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
wb = ET.fromstring(z.read("xl/workbook.xml"))
names = [s.get("name") for s in wb.find("m:sheets", ns)]
def cells(i):
    root = ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml"))
    out = {}
    for c in root.iter("{%s}c" % ns["m"]):
        t = c.get("t"); v = c.find("m:v", ns); s = c.find("m:is/m:t", ns)
        out[c.get("r")] = ("s", s.text or "") if t == "inlineStr" else ("n", v.text) if v is not None else ("e", "")
    pane = root.find("m:sheetViews/m:sheetView/m:pane", ns)
    af = root.find("m:autoFilter", ns)
    return out, pane is not None and pane.get("state") == "frozen", af.get("ref") if af is not None else None
a, pa, fa = cells(1); b, pb, fb = cells(2); c, pc, fc = cells(3)
print(json.dumps({"names": names, "A1": a["A1"], "B2": a["B2"], "C2": a["C2"], "D2": a["D2"], "B3": a.get("B3"), "C4": a["C4"], "D4": a["D4"], "B5": a["B5"],
  "pane": [pa, pb, pc], "filter": [fa, fb, fc], "bigLast": b["AD2001"], "bigCount": len(b), "cond": c["B2"], "files": len(z.namelist())}, ensure_ascii=False))
`;
const got = JSON.parse(execFileSync("python3", ["-c", py, out], { encoding: "utf8" }));
const want = {
  names: ["一覧", "一覧(2)", "出力の条件"], A1: ["s", "ロット番号"], B2: ["n", "1200.5"], C2: ["s", "速度落とし & 再確認 <要>"], D2: ["s", "007"],
  C4: ["s", "制御字あり"], D4: ["n", "1e-05"], B5: ["s", "12345678901234567"], pane: [true, true, false], filter: ["A1:D5", "A1:AD2001", null],
  bigLast: ["n", String(1999 * 28)], bigCount: 2001 * 30, cond: ["s", "設備 ＝ CR1"], files: 8,
};
let ng = 0;
for (const [k, v] of Object.entries(want)) {
  const same = JSON.stringify(got[k]) === JSON.stringify(v);
  if (!same) ng++;
  console.log(`${same ? "OK" : "NG"} ${k}: ${JSON.stringify(got[k])}${same ? "" : `（期待: ${JSON.stringify(v)}）`}`);
}
console.log(`空のセルは書かない: B3=${JSON.stringify(got.B3)}`, got.B3 == null ? "OK" : "NG");
if (got.B3 != null) ng++;
console.log(`${(bytes.length / 1024).toFixed(0)} KB → ${out}`);
console.log(ng ? `FAILED ${ng}` : "OK");
process.exit(ng ? 1 : 0);
