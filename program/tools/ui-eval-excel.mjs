// 評価関数（開発用）: 一覧の「Excel に出力」が、いまの絞り込みに当たる全件を表示列の見え方のまま出すか（版 3.20.0）。
//   node program/tools/ui-eval-excel.mjs
// ① 品質異常: 設備＝CR1 で絞り、表示名を 1 つ変え、出力 → 行の数＝件数・見出しに表示名・ロット番号の並び＝サーバーの並び
// ② 作業実績: 日＋直ごとにまとめて出力 → 一覧のシートの行＝行の数・「日・直ごとのロット数」の合計＝右の表の合計・出力の条件のシート
// .xlsx は Python の標準の zipfile と xml で読み戻す。全部合えば終了コード 0。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, sleep } from "./ui-harness.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xl-"));
const READ = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as ET
m = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
z = zipfile.ZipFile(sys.argv[1])
names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find(m + "sheets")]
def rows(i):
    out = []
    for r in ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml")).iter(m + "row"):
        cells = {}
        for c in r.iter(m + "c"):
            t = c.find(m + "is/" + m + "t"); v = c.find(m + "v")
            col = "".join(ch for ch in c.get("r") if ch.isalpha())
            cells[col] = (t.text if t is not None else v.text if v is not None else "")
        out.append(cells)
    return out
print(json.dumps({"names": names, "sheets": [rows(i + 1) for i in range(len(names))]}, ensure_ascii=False))`;
const readXlsx = (f) => JSON.parse(execFileSync("python3", ["-c", READ, f], { encoding: "utf8", maxBuffer: 64 << 20 }));
async function save(p, click) {
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), click()]);
  const f = path.join(dir, dl.suggestedFilename()); await dl.saveAs(f); return f;
}

const app = await launch();
let ok = false;
try {
  const p = await app.newPage("light");
  // ① 品質異常（設備＝CR1・発生日の表示名を「登録日」に）
  await p.evaluate(async () => {
    TPA.local.set("tpa.lotlist.layout.v1", { "lotlist:仕掛": { order: [], hidden: ["備考"], widths: {}, locks: [], names: { "発生日": "登録日" }, formats: {}, aligns: {}, rules: {}, formulas: {} } });
    TPA.local.set("tpa.lotlist.active.v1", { "仕掛": [{ column: "設備", op: "eq", value: "CR1" }] });
    await TPA.saveUiState();
  });
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  const want = await p.evaluate(async () => {
    const d = await (await fetch("/api/lotlist?page_size=5000&filters=" + encodeURIComponent(JSON.stringify([{ column: "設備", op: "eq", value: "CR1" }])))).json();
    return { count: d.count, lots: d.rows.map((r) => String(r["ロット番号"] ?? "")) };
  });
  const f1 = await save(p, () => p.click("#llExcelBtn"));
  const x1 = readXlsx(f1), head = Object.values(x1.sheets[0][0]), body = x1.sheets[0].slice(1);
  const lotCol = Object.keys(x1.sheets[0][0]).find((k) => x1.sheets[0][0][k] === "ロット番号");
  const r1 = { names: x1.names, rows: body.length, want: want.count, head: head.slice(0, 4), noHidden: !head.includes("備考"),
    sameOrder: JSON.stringify(body.map((r) => r[lotCol] ?? "")) === JSON.stringify(want.lots),
    cond: x1.sheets[x1.sheets.length - 1].map((r) => Object.values(r).join(": ")).filter((t) => /条件|件数/.test(t)) };
  const ok1 = r1.rows === want.count && head.includes("登録日") && r1.noHidden && r1.sameOrder && x1.names.join("|") === "品質異常|出力の条件";
  // ② 作業実績（日＋直ごと）
  await p.click("#tabWork"); await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  await p.click('#llWorkSwitch [data-wk-mode="dayshift"]'); await p.waitForSelector("#llWork .wk-pv"); await sleep(600);
  const tot = await p.evaluate(() => ({ rows: +document.querySelector("#llCount").textContent.match(/（([\d,]+)行）/)[1].replace(/,/g, ""),
    works: +document.querySelector("#llWork .wk-sum .wk-tot").textContent }));
  const f2 = await save(p, () => p.click("#llExcelBtn"));
  const x2 = readXlsx(f2), sum = x2.sheets[1], last = sum[sum.length - 1];
  const totCol = Object.keys(sum[0]).find((k) => String(sum[0][k]).startsWith("計"));
  const r2 = { names: x2.names, rows: x2.sheets[0].length - 1, want: tot, head: Object.values(x2.sheets[0][0]).slice(0, 4), total: last[totCol], first: Object.values(last)[0] };
  const ok2 = r2.rows === tot.rows && +r2.total === tot.works && r2.first === "合計" && r2.head[0].startsWith("作業日") && r2.head[1] === "直" && x2.names.length === 3;
  ok = ok1 && ok2;
  console.log(JSON.stringify({ lot: r1, work: r2 }), ok ? "OK" : `NG${ok1 ? "" : " 品質異常"}${ok2 ? "" : " 作業実績"}`);
} finally {
  await app.close();
}
process.exit(ok ? 0 : 1);
