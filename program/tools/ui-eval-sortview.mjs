// 評価関数（開発用）: 並べ替えの外し方と、条件＋並べ替えをまとめた「保存した見方」の保存と読み出し（版 3.22.0 で直した不具合の再現と確かめ）。
//   node program/tools/ui-eval-sortview.mjs
// 1. 見出しを 3 回押す → ▲ → ▼ → 外れる（以前は ▲ → ▼ → ▲ と回るだけで外せなかった）。Shift で 2 つ目を足し、3 回目でその列だけ外れる
// 2. 件数の行の並べ替えの札: 2 つ並べると札が 2 つ出る・▲▼ で向きが替わる・× でその列だけ外れる・「並べ替えを外す」で全部外れる
// 3. 保存した見方: 条件 1・並べ替え 2・まとめ 1 段・スライサーの選択・検索を保存 → 全部を外す → プリセットから呼ぶ → 同じ形に戻る
//    （サーバーへ渡す問い合わせ＝件数も同じ）。変えると「変更あり」、もう一度押すと戻る。保存した見方は「表示の設定」の範囲に入る
// 全部合えば終了コード 0。
import { launch, openActive, sleep } from "./ui-harness.mjs";

const app = await launch();
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) fails.push(name); };
try {
  const p = await app.newPage("light");
  const sorts = () => p.evaluate(() => JSON.stringify((TPA.local.get("tpa.lotlist.sorts.v1", {}))["仕掛"] || []));
  const head = (c, mod) => p.click(`#llHead th[data-col="${c}"]`, mod ? { modifiers: [mod] } : {}).then(() => sleep(700));
  // 1. 見出し
  const seen = [];
  for (let i = 0; i < 3; i++) { await head("重量"); seen.push(await sorts()); }
  check("見出し 3 回で ▲ → ▼ → 外す", seen[0] === '[{"column":"重量","dir":"asc"}]' && seen[1] === '[{"column":"重量","dir":"desc"}]' && seen[2] === "[]", seen);
  await head("重量"); await head("板厚", "Shift");
  const two = await sorts();
  await head("板厚", "Shift"); await head("板厚", "Shift");
  const shiftOff = await sorts();
  check("Shift で足し、3 回目でその列だけ外す", two === '[{"column":"重量","dir":"asc"},{"column":"板厚","dir":"asc"}]' && shiftOff === '[{"column":"重量","dir":"asc"}]', { two, shiftOff });
  // 2. 件数の行の札
  await head("板厚", "Shift");
  const chips = await p.$$eval("#llSortBar .ll-schip", (xs) => xs.map((x) => x.textContent.replace(/\s+/g, "")));
  check("件数の行に並べ替えの札が 2 つ（番号・名前・向き）", chips.length === 2 && chips[0].startsWith("1重量▲") && chips[1].startsWith("2板厚▲"), chips);
  await openActive(p, "sort"); await p.click('#llSortBar [data-sdir="重量"]'); await sleep(700);
  const flipped = await sorts();
  await openActive(p, "sort"); await p.click('#llSortBar [data-sx="板厚"]'); await sleep(700);
  const dropped = await sorts();
  await openActive(p, "sort"); await p.click("#llSortBar [data-soff]"); await sleep(700);
  const off = await sorts(), barHidden = await p.$eval("#llSortBar", (x) => x.hidden);
  check("札の ▲▼・×・並べ替えを外す", flipped === '[{"column":"重量","dir":"desc"},{"column":"板厚","dir":"asc"}]' && dropped === '[{"column":"重量","dir":"desc"}]' && off === "[]" && barHidden, { flipped, dropped, off, barHidden });

  // 3. 保存した見方: 条件・並べ替え・まとめ・スライサー・検索を作る
  await p.evaluate(() => {
    TPA.local.set("tpa.lotlist.active.v1", { "仕掛": [{ column: "不良名", op: "not_empty", value: "" }] });
    TPA.local.set("tpa.lotlist.sorts.v1", { "仕掛": [{ column: "重量", dir: "desc" }, { column: "板厚", dir: "asc" }] });
    TPA.local.set("tpa.lotlist.arrange.v1", { "仕掛": { levels: [{ column: "設備", dir: "asc", lot: false }], heads: true, suppress: false } });
    TPA.local.set("tpa.lotlist.slicer.v1", { open: { all: false }, place: "left", tables: { "仕掛": [{ column: "工程", key: "", sel: ["圧延"] }] } });
    return TPA.saveUiState();
  });
  await p.reload(); await p.waitForSelector("#llBody tr[data-i]"); await sleep(600);
  await p.fill("#llSearch", "A"); await sleep(900);
  const state = () => p.evaluate(() => ({
    count: document.querySelector("#llCount").textContent,
    filters: JSON.stringify(TPA.local.get("tpa.lotlist.active.v1", {})["仕掛"] || []),
    sorts: JSON.stringify(TPA.local.get("tpa.lotlist.sorts.v1", {})["仕掛"] || []),
    levels: JSON.stringify(((TPA.local.get("tpa.lotlist.arrange.v1", {})["仕掛"]) || {}).levels || []),
    slicer: JSON.stringify((((TPA.local.get("tpa.lotlist.slicer.v1", {}).tables) || {})["仕掛"] || []).map((c) => c.sel)),
    search: document.querySelector("#llSearch").value,
  }));
  const before = await state();
  await p.click("#llPresetBtn"); await sleep(300);
  const tags = await p.$$eval(".fb-preset-tags i", (xs) => xs.map((x) => x.textContent));
  check("いまの形の札（保存すると入る物）", JSON.stringify(tags) === JSON.stringify(["条件 1", "並べ替え 2", "まとめ 1段", "スライサー 1", "検索「A」"]), tags);
  p.once("dialog", (d) => d.accept("不良あり・重い順"));
  await p.click("#llViewSave"); await sleep(500);
  const saved = await p.evaluate(() => (TPA.local.get("tpa.lotlist.views.v1", []) || []).map((v) => v.name));
  check("保存した見方が 1 つ入る", JSON.stringify(saved) === '["不良あり・重い順"]', saved);
  // 全部を外す（条件・まとめ・並べ替え・スライサー・検索）
  await openActive(p, "sort"); await p.click("#llSortBar [data-soff]"); await sleep(600);
  await openActive(p, "group"); await p.click('#llGroupBar [data-goff]'); await sleep(600);
  await p.click("#llCondBtn"); await sleep(200); await p.click("#llClearFilters"); await sleep(600);
  await p.fill("#llSearch", ""); await sleep(900);
  await p.evaluate(() => window.LotListSlicer.clearAll()); await sleep(200);
  await p.evaluate(() => document.querySelector("#llSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))); await sleep(900);
  const cleared = await state();
  const btnName = await p.$eval("#llPresetName", (x) => x.textContent);
  const note = await p.$eval("#llPresetNote", (x) => (x.hidden ? "" : x.textContent));
  check("外すと「変更あり」", note === "変更あり" && btnName === "不良あり・重い順", { btnName, note });
  // 呼び出す
  await p.click("#llPresetBtn"); await sleep(300);
  await p.click('.fb-preset-menu [data-preset-key^="v:"]'); await sleep(1400);
  const after = await state();
  check("外した状態は違う形", cleared.count !== before.count && cleared.sorts === "[]", cleared);
  check("呼び出すと同じ形（条件・並べ替え・まとめ・スライサー・検索・件数）", JSON.stringify(after) === JSON.stringify(before), { before, after });
  const note2 = await p.$eval("#llPresetNote", (x) => (x.hidden ? "" : x.textContent));
  check("呼び出した後は「変更あり」が消える", note2 === "", note2);
  const prof = await p.evaluate(() => (window.TPA_UI_PROFILE.keys || []).includes("tpa.lotlist.views.v1"));
  check("保存した見方は「表示の設定」の範囲", prof, prof);
  // 管理の窓: 名前を直す・削除
  await p.click("#llPresetBtn"); await sleep(300); await p.click("#llPresetManage"); await sleep(400);
  const rows = await p.$$eval("#llViewRows tr[data-id]", (xs) => xs.length);
  check("管理の窓に保存した見方の行", rows === 1, rows);
  // 行のボタン（当てる・上書き・削除）に、窓の見た目が当たっている（版 3.27.0 で直した: 版 3.14.0 から既定のボタンの見た目のままだった）。
  // 角の丸み・左右の余白・同じ行の欄と同じ高さ（28px）・字が既定の黒でない（当てる＝藍）
  const btns = await p.$$eval("#llPresetModal :is(.ll-pm-vapply, .ll-pm-vput, .ll-pm-vdel, .ll-pm-apply, .ll-pm-del)", (xs) => xs.map((x) => {
    const c = getComputedStyle(x); return { text: x.textContent, radius: parseFloat(c.borderTopLeftRadius), pad: parseFloat(c.paddingLeft), h: Math.round(x.getBoundingClientRect().height), color: c.color, cursor: c.cursor };
  }));
  check("管理の窓の行のボタンに見た目が当たっている（角の丸み・余白・高さ 28px・押せる形）", btns.length >= 3 && btns.every((b) => b.radius >= 6 && b.pad >= 10 && b.h === 28 && b.cursor === "pointer")
    && btns.find((b) => b.text === "当てる").color !== "rgb(0, 0, 0)", btns);
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
