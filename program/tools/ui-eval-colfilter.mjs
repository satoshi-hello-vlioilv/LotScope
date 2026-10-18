// 評価関数（開発用）: 一覧の列の値で絞る（版 3.45.0。利用者の要望 2026-10-18 の 1: Excel のフィルタのように、重複の無い値にチェック）。
//   node program/tools/ui-eval-colfilter.mjs [1280x720]
// ① 見出しの下の値で絞る段の ▾ で面が開き、値と件数がサーバーの値の一覧（/slicer）と同じ
// ②（すべて選択）を外すと OK は押せない → CR1・DL2 を入れて OK → 件数＝2 つの件数の和・見出しの ▼ が白い地（絞っている）・条件の面に「設備 = CR1・DL2」
// ③ 開き直すと CR1・DL2 にチェック。「L-」で検索して OK → 検索に当たる値（L-1・L-2）だけで絞る
// ④ 検索して「いまの選びに足す」→ 前の選び（L-1・L-2）に CR1 が足される
// ⑤ 条件で絞る（不良名 含む「汚」）と値（設備）の両方 → サーバーに同じ条件を問うた件数と同じ
// ⑥ 右クリックの「値で絞る…」で開く・「この列の絞り込みを外す」で全件に戻る
// ⑦ 面の ▼ 大きい順で並べ替え（見出しの印）・Esc で閉じる（何も変わらない）
// ⑧ 作業実績・仕掛でも同じ（値の件数がサーバーと合う・絞ると件数が合う）
// ⑨ 計算列（式の列）も値で絞れる（一覧の行の見えている値が、選んだ値だけになる）
// ⑩ 面は画面に収まる（右端の列で開いても）
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
  await p.hover(`#llHead th[data-col="${c}"]`); await sleep(150);
  await p.click(`#llHead th[data-fcol="${c}"] [data-th-filter]`); await p.waitForSelector(".vf-pop [data-vf-v]"); await sleep(150);
};
const pop = (p) => p.evaluate(() => { const el = document.querySelector(".vf-pop"); if (!el) return null; const r = el.getBoundingClientRect();
  return { vals: [...el.querySelectorAll(".vf-it")].map((x) => [x.querySelector("[data-vf-v]").dataset.vfV, +(x.querySelector(".vf-n b")?.textContent.replace(/,/g, "") || 0), x.querySelector("input").checked]),
    ok: !el.querySelector("[data-vf-ok]").disabled, r: [r.left, r.top, r.right, r.bottom], W: innerWidth, H: innerHeight }; });
const setV = (p, v, on) => p.evaluate(([v, on]) => { const x = document.querySelector(`.vf-pop [data-vf-v="${CSS.escape(v)}"]`); if (x.checked !== on) x.click(); }, [v, on]);
const server = (p, api, q) => p.evaluate(async ([api, q]) => { const r = await fetch(`${api}?` + new URLSearchParams(q)); return r.json(); }, [api, q]);
const table = (p) => p.evaluate(() => document.querySelector("#llTable")?.value || "");
try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  const all = await count(p);
  await openTh(p, "設備");
  const s1 = await server(p, "/api/lotlist/slicer", { column: "設備", table: await table(p) });
  const v1 = await pop(p);
  check("① 値と件数がサーバーの値の一覧と同じ", JSON.stringify(v1.vals.map((x) => [x[0], x[1]])) === JSON.stringify(s1.values.map((x) => [x.value, x.count])), { got: v1.vals.slice(0, 5), want: s1.values.slice(0, 5) });
  await p.click(".vf-pop [data-vf-all]"); await sleep(100);
  check("② 何も選ばないと OK は押せない", !(await pop(p)).ok, "");
  await setV(p, "CR1", true); await setV(p, "DL2", true);
  await p.click(".vf-pop [data-vf-ok]"); await settle(p);
  const want2 = s1.values.filter((x) => ["CR1", "DL2"].includes(x.value)).reduce((a, x) => a + x.count, 0);
  check("② CR1・DL2 で絞った件数が件数の和", (await count(p)) === want2, { got: await count(p), want2 });
  const fr = await p.$eval('#llHead th[data-fcol="設備"]', (th) => [th.classList.contains("on"), th.textContent]);
  check("② 値で絞る段の設備の所が絞っている形（青緑・「CR1・DL2」）", fr[0] && /CR1・DL2/.test(fr[1]), fr);
  await p.click("#llCondBtn"); await sleep(250);
  const condText = await p.$eval("#llCondList", (x) => x.textContent);
  check("② 条件の面に「設備 = CR1・DL2」", /設備\s*＝\s*CR1・DL2/.test(condText), condText);
  await p.keyboard.press("Escape"); await sleep(150);

  await openTh(p, "設備");
  const v3 = await pop(p);
  check("③ 開き直すと CR1・DL2 にチェック", v3.vals.filter((x) => x[2]).map((x) => x[0]).join() === "CR1,DL2", v3.vals.filter((x) => x[2]));
  await p.fill(".vf-pop [data-vf-search]", "L-"); await sleep(250);
  await p.click(".vf-pop [data-vf-ok]"); await settle(p);
  const want3 = s1.values.filter((x) => x.value.includes("L-")).reduce((a, x) => a + x.count, 0);
  check("③ 検索して OK → 検索に当たる値だけ", (await count(p)) === want3, { got: await count(p), want3 });

  await openTh(p, "設備");
  await p.fill(".vf-pop [data-vf-search]", "CR1"); await sleep(250);
  await p.click(".vf-pop [data-vf-addmode]"); await sleep(100);
  await p.click(".vf-pop [data-vf-ok]"); await settle(p);
  const want4 = s1.values.filter((x) => x.value.includes("L-") || x.value === "CR1").reduce((a, x) => a + x.count, 0);
  check("④ いまの選びに足す", (await count(p)) === want4, { got: await count(p), want4 });

  await openTh(p, "不良名");
  await p.click(".vf-pop [data-vf-ctog]"); await sleep(150);
  await p.selectOption(".vf-pop .vf-crow [data-vf-op]", "contains");
  await p.fill(".vf-pop .vf-crow [data-vf-val]", "汚"); await sleep(100);
  await p.click(".vf-pop [data-vf-ok]"); await settle(p);
  const f5 = [{ column: "設備", op: "in", value: JSON.stringify(s1.values.filter((x) => x.value.includes("L-") || x.value === "CR1").map((x) => x.value)) }, { column: "不良名", op: "contains", value: "汚" }];
  const a5 = await server(p, "/api/lotlist", { table: await table(p), filters: JSON.stringify(f5), page_size: 1 });
  check("⑤ 値＋条件の件数がサーバーと同じ", (await count(p)) === a5.count && a5.count > 0, { got: await count(p), server: a5.count });

  const b6 = await (await p.$('#llHead th[data-col="設備"]')).boundingBox();
  await p.mouse.click(b6.x + 20, b6.y + b6.height / 2, { button: "right" }); await sleep(250);
  await p.evaluate(() => [...document.querySelectorAll(".ll-colmenu button")].find((b) => b.textContent.includes("値で絞る")).click());
  await p.waitForSelector(".vf-pop [data-vf-v]");
  check("⑥ 右クリックの「値で絞る…」で開く", !!(await pop(p)), "");
  await p.keyboard.press("Escape"); await sleep(150);
  await p.mouse.click(b6.x + 20, b6.y + b6.height / 2, { button: "right" }); await sleep(250);
  await p.evaluate(() => [...document.querySelectorAll(".ll-colmenu button")].find((b) => b.textContent.includes("この列の絞り込みを外す")).click()); await settle(p);
  await openTh(p, "不良名"); await p.click(".vf-pop [data-vf-clear]"); await settle(p);
  check("⑥ 絞り込みを外すと全件に戻る", (await count(p)) === all, { got: await count(p), all });

  const before7 = await count(p);
  await openTh(p, "重量"); await p.click('.vf-pop [data-vf-sort="desc"]'); await settle(p);
  check("⑦ 面の ▼ 大きい順で並べ替え", await p.$eval('#llHead th[data-col="重量"]', (th) => th.dataset.sort === "desc"), "");
  await p.keyboard.press("Escape"); await sleep(200);
  check("⑦ Esc で閉じる（件数は変わらない）", !(await pop(p)) && (await count(p)) === before7, "");

  // ⑩ 右端の列で開いても画面に収まる
  const lastCol = await p.$$eval("#llHead th[data-col]", (xs) => xs[xs.length - 1].dataset.col);
  await openTh(p, lastCol);
  const v10 = await pop(p);
  check("⑩ 面が画面に収まる", v10.r[0] >= 0 && v10.r[1] >= 0 && v10.r[2] <= v10.W && v10.r[3] <= v10.H, v10.r.concat([v10.W, v10.H]));
  await p.click(".vf-pop [data-vf-ctog]"); await sleep(250);
  const ok10 = await p.$eval(".vf-pop [data-vf-ok]", (b) => { const r = b.getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; });
  check("⑩ 条件で絞るを開いても OK が窓の中", ok10[0] >= 0 && ok10[1] <= ok10[2], ok10);
  await p.keyboard.press("Escape");

  // ⑧ 作業実績・仕掛
  for (const [tab, api] of [["#tabWork", "/api/worklog"], ['[data-screen="src:wip"]', "/api/src/wip"]]) {
    await p.click(tab); await p.waitForSelector("#llBody tr[data-i]", { timeout: 15000 }); await settle(p);
    const col = await p.$$eval("#llHead th[data-col]", (xs) => (xs.find((x) => /設備|作業者|仕掛区分|製造材質/.test(x.dataset.col)) || xs[2]).dataset.col);
    await openTh(p, col);
    const params = tab === "#tabWork" ? { equip: await p.evaluate(() => document.querySelector("#llEquipBar [aria-selected=true]")?.dataset.equip || "") } : {};
    const sv = await server(p, `${api}/slicer`, { ...params, column: col, table: await table(p) });
    const pv = await pop(p);
    check(`⑧ ${tab}: 値と件数がサーバーと同じ（${col}）`, JSON.stringify(pv.vals.map((x) => [x[0], x[1]])) === JSON.stringify(sv.values.map((x) => [x.value, x.count])), { got: pv.vals.slice(0, 4), want: (sv.values || []).slice(0, 4), err: sv.error });
    await p.click(".vf-pop [data-vf-all]"); await setV(p, sv.values[0].value, true);
    await p.click(".vf-pop [data-vf-ok]"); await settle(p);
    check(`⑧ ${tab}: 1 つの値で絞ると件数が合う`, (await count(p)) === sv.values[0].count, { got: await count(p), want: sv.values[0].count });
    await openTh(p, col); await p.click(".vf-pop [data-vf-clear]"); await settle(p);
  }

  // ⑨ 計算列: 品質異常に式の列（材調質 = 合金-調質）を足して、値で絞る
  await p.click("#tabList"); await p.waitForSelector("#llBody tr[data-i]"); await settle(p);
  await p.evaluate(async () => {
    const k = "tpa.lotlist.layout.v1", all = TPA.local.get(k, {}), t = `lotlist:${document.querySelector("#llTable").value}`;
    const l = all[t] || {}; l.formulas = { ...(l.formulas || {}), "材調質": 'IF([板厚] < 1, "薄", "厚")' }; l.order = ["材調質", ...(l.order || []).filter((x) => x !== "材調質")];
    all[t] = l; TPA.local.set(k, all); await TPA.saveUiState();
  });
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await settle(p);
  await openTh(p, "材調質");
  const v9 = await pop(p);
  const pickV = v9.vals.find((x) => x[1] > 0)[0];
  await p.click(".vf-pop [data-vf-all]"); await setV(p, pickV, true);
  await p.click(".vf-pop [data-vf-ok]"); await settle(p);
  const seen = await p.$$eval('#llBody tr[data-i]', (trs) => { const i = [...document.querySelectorAll("#llHead th")].findIndex((th) => th.dataset.col === "材調質"); return [...new Set(trs.map((tr) => tr.children[i]?.textContent.trim()))]; });
  check("⑨ 計算列の値で絞れる（見えている値が選んだ値だけ）", seen.length === 1 && seen[0] === pickV && (await count(p)) === v9.vals.find((x) => x[0] === pickV)[1], { seen, pickV, n: await count(p) });

  check("画面のエラーが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
