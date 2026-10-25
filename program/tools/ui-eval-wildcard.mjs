// 評価関数（開発用）: 絞り込みの で始まらない・で終わらない と、Excel と同じ * ?（版 3.54.0。決め方: ui-proposals/2026-10-wildcard の B）。
//   node program/tools/ui-eval-wildcard.mjs [1280x720]
// ① 値で絞るの比べ方が段（字・数・空かどうか）に分かれ、字の段に「で始まらない」「で終わらない」がある（言葉は「〜で始まる」の型）
// ② 字の比べ方では、値が空なら * ? の使い方、値を打つと読み方（「C」＋1 字＋…）と「並んだ値のうち n / m」が出る。n は面の値を同じ型で数えた数
// ③ 「で始まらない」「C?*」で OK → 一覧の件数がサーバーに同じ条件を問うた件数と同じ・条件の面の字が「設備 「C?*」で始まらない」
// ④ 値を検索に「L-*」→ 面の値が L- で始まる値だけ（* ? の型）
// ⑤ 一覧を検索に「L00?1C1」→ 件数がサーバーと同じ（* ? が検索にも効く）・「%」は字そのもの（前は全部に当たった）
// ⑥ 面は窓に収まり、OK に届く（1280×720）
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const app = await launch();
const count = (p) => p.$eval("#llCount", (x) => +x.textContent.replace(/[^0-9]/g, ""));
const settle = async (p) => { await sleep(300); await p.waitForFunction(() => !document.querySelector("#llBody")?.closest(".is-loading"), null, { timeout: 8000 }).catch(() => {}); await sleep(700); };
const openTh = async (p, c) => {
  await p.$eval(`#llHead th[data-col="${c}"]`, (th) => th.scrollIntoView({ inline: "center", block: "nearest" }));
  await p.click(`#llHead th[data-fcol="${c}"] [data-th-filter]`); await p.waitForSelector(".vf-pop [data-vf-v]"); await sleep(200);
};
const server = (p, q) => p.evaluate(async (q) => (await (await fetch("/api/lotlist?" + new URLSearchParams({ ...q, table: document.querySelector("#llTable")?.value || "", page_size: 1 }))).json()).count, q);
try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  await openTh(p, "設備");
  await p.click(".vf-pop [data-vf-ctog]"); await sleep(250);
  const groups = await p.$$eval(".vf-pop [data-vf-op] optgroup", (gs) => gs.map((g) => [g.label, [...g.children].map((o) => o.textContent)]));
  const text = (groups.find((g) => g[0].startsWith("字")) || [0, []])[1];
  check("① 比べ方が段に分かれ、字の段に で始まらない・で終わらない", groups.length >= 3 && text.includes("で始まらない") && text.includes("で終わらない") && text.includes("で始まる"), groups);
  check("① 段の名前と項目の字が重ならない（「空欄」の段の下に「空欄」が来ない）", groups.every(([g, items]) => !items.includes(g)), groups);
  const legend = await p.$eval(".vf-pop .vf-read", (x) => x.textContent);
  check("② 値が空なら * ? の使い方", /\*\s*何文字でも/.test(legend) && /\?\s*1 字/.test(legend), legend);
  await p.selectOption(".vf-pop [data-vf-op]", "not_starts"); await sleep(250);
  await p.fill(".vf-pop [data-vf-val]", "C?*"); await sleep(250);
  const read = await p.$eval(".vf-pop .vf-read", (x) => x.textContent);
  const vals = await p.$$eval(".vf-pop .vf-it .vf-lab", (xs) => xs.map((x) => x.textContent));
  const want = vals.filter((v) => !/^c./i.test(v)).length;
  check("② 読み方「C」＋1 字＋何文字でも で始まらない値", /「C」＋1 字＋何文字でも で始まらない値/.test(read), read);
  check("② 並んだ値のうち当たる数が、面の値を同じ型で数えた数", read.includes(`${want} / ${vals.length}`), { read, want, n: vals.length });
  await p.click(".vf-pop [data-vf-ok]"); await settle(p);
  const sv = await server(p, { filters: JSON.stringify([{ column: "設備", op: "not_starts", value: "C?*" }]) });
  check("③ 件数がサーバーに同じ条件を問うた件数と同じ", (await count(p)) === sv && sv > 0, { got: await count(p), sv });
  await p.click("#llCondBtn"); await sleep(250);
  const cond = await p.$eval("#llCondList", (x) => x.textContent);
  check("③ 条件の面の字が「設備 「C?*」で始まらない」", /設備\s*「C\?\*」で始まらない/.test(cond), cond);
  await p.keyboard.press("Escape"); await sleep(150);
  await p.evaluate(() => document.querySelector('#llCondList [data-cond-x]')?.click()); await settle(p);

  await openTh(p, "設備");
  await p.fill(".vf-pop [data-vf-search]", "L-*"); await sleep(300);
  const hits = await p.$$eval(".vf-pop .vf-it .vf-lab", (xs) => xs.map((x) => x.textContent));
  check("④ 値を検索の「L-*」で、L- で始まる値だけ", hits.length > 0 && hits.every((v) => /^L-/i.test(v)), hits);
  const r = await p.evaluate(() => { const el = document.querySelector(".vf-pop"), b = el.querySelector("[data-vf-ok]").getBoundingClientRect(), a = el.getBoundingClientRect(); return { a: [a.top, a.bottom, a.right], ok: [b.bottom, b.right], W: innerWidth, H: innerHeight }; });
  check("⑥ 面は窓に収まり OK に届く", r.a[0] >= 0 && r.a[1] <= r.H && r.ok[0] <= r.H && r.a[2] <= r.W, r);
  await p.keyboard.press("Escape"); await sleep(200);

  for (const q of ["L00?1C1", "%"]) {
    await p.fill("#llSearch", q); await p.press("#llSearch", "Enter"); await settle(p);
    const s = await server(p, { search: q });
    check(`⑤ 一覧を検索「${q}」の件数がサーバーと同じ`, (await count(p)) === s, { got: await count(p), s });
    if (q === "%") check("⑤「%」は字そのもの（全件には当たらない）", s < 1500, s);
    else check("⑤ * ? が検索に効く（当たる行がある・全件ではない）", s > 0 && s < 1500, s);
  }
  check("画面のエラーが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
