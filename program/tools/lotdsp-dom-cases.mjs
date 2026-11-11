// 独立の答え（版 3.98.0）: LotDsp の HTML の事例（tests/fixtures/lotdsp_html_cases.json）を、Chromium の DOMParser（ブラウザの HTML の
// 読み方。Python の html.parser を使わない）で入れ子の無い表にし、各事例の "dom" に書く。表の作り方は取込と同じ約束（行・セルの字・
// script と style は読まない・br は空白・空白は 1 つに縮める〈JS の \s〉・空の行は除く）。
//   node program/tools/lotdsp-dom-cases.mjs
// Python の答えと違う事例は、program/tools/lotdsp-cases.py の DOM_DIFFERS に理由を書く（試験が理由の無い違いを止める）。
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/lotdsp_html_cases.json");
const table = JSON.parse(fs.readFileSync(FILE, "utf8"));
const b = await chromium.launch({ args: ["--no-sandbox"] });
const p = await (await b.newContext({ javaScriptEnabled: true })).newPage();
let differ = 0;
for (const [name, c] of Object.entries(table.cases)) {
  c.dom = await p.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const res = [];
    for (const t of doc.querySelectorAll("table")) {
      if (t.querySelector("table")) continue;
      const rows = [];
      for (const tr of t.rows) {
        const cells = [...tr.cells].map((cell) => {
          const cl = cell.cloneNode(true);
          cl.querySelectorAll("script,style").forEach((x) => x.remove());
          cl.querySelectorAll("br").forEach((x) => x.replaceWith(" "));
          return cl.textContent.replace(/\s+/g, " ").trim();
        });
        if (cells.some((x) => x)) rows.push(cells);
      }
      if (rows.length) res.push(rows);
    }
    return res;
  }, c.file ? fs.readFileSync(path.join(path.dirname(FILE), c.file), "utf8") : c.html);
  if (JSON.stringify(c.dom) !== JSON.stringify(c.python)) { differ++; console.log("DOM と違う:", name, JSON.stringify(c.python), "／", JSON.stringify(c.dom)); }
}
await b.close();
fs.writeFileSync(FILE, JSON.stringify(table, null, 1) + "\n");
console.log(`${Object.keys(table.cases).length} 例・DOM と違う ${differ} 例 → ${FILE}`);
