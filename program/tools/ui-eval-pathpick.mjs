// 評価関数（開発用）: フォルダ・ファイルの欄の補助（版 3.29.0。7 案＋2 回目で選んだ: ui-proposals/2026-10-pathpick* の M1）。
//   node program/tools/ui-eval-pathpick.mjs [画像を置くフォルダ]
// 利用者の要望: マスタの置き場の「置き場を変える」で、参照ボタンなどのフォルダ・ファイルの設定に対する補助が欲しい。
// ① マスタの置き場: 欄の横に「参照…」、欄の下によく使う場所の札（品質データ・作業実績・配布の置き場）。札を押すと欄に入り、すぐ確かめる
// ② 参照… の窓: 欄が空なら、このアプリで使っている場所の 1 つ上から始まる。左によく使う場所。マスタのあるフォルダに「マスタあり」の印
// ③ マスタのあるフォルダを選ぶと、上のフォルダと名前に分けて入り、「この置き場に切り替える」になる
// ④ 2 回押すと中へ・Backspace で上へ・区切りで戻る・届かないアドレスを打つと、届いた所まで上がって理由が出る・Esc は窓だけ閉じる
// ⑤ データ元: 品質データの元ファイル（.sqlite3）は「📄 参照…」でファイルを選ぶ（ほかのファイルは出ない）。選ぶと欄に入る（版 3.36.0 から参照先には出さない）
// ⑥ 作業実績: いまのフォルダから始まり、決まりに合うファイルの数が印に出る
// ⑦ 窓が画面に収まる（1728×1152・1536×864）・頁の誤りが無い
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep, walk } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 800)}`}`); if (!ok) fails.push(name); };
const shot = async (p, name) => { if (SHOT) await p.screenshot({ path: path.join(SHOT, `${name}.png`) }); };
const idle = (p) => p.waitForFunction(() => { const d = document.querySelector(".pp-dlg"); return d && !d.querySelector(".pp-list[aria-busy]"); }, null, { timeout: 10000 }).then(() => sleep(250));
const dlg = (p) => p.evaluate(() => {
  const d = document.querySelector(".pp-dlg"); if (!d) return null;
  const r = d.getBoundingClientRect();
  return { crumbs: [...d.querySelectorAll(".pp-c")].map((x) => x.textContent), here: d.querySelector(".pp-c.is-here")?.textContent || "",
    rows: [...d.querySelectorAll(".pp-row-i")].map((x) => ({ name: x.querySelector(".pp-nm").textContent, mark: x.querySelector(".pp-mk")?.textContent || "", file: x.classList.contains("is-file") })),
    side: [...d.querySelectorAll(".pp-pl span")].map((x) => x.textContent.trim()), state: d.querySelector(".pp-state")?.textContent || "",
    stateCls: d.querySelector(".pp-state")?.className || "", addr: d.querySelector(".pp-addr").value,
    inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) };
});
const row = (name) => `.pp-dlg .pp-row-i:has(.pp-nm:text-is("${name}"))`;

const app = await launch();
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
    const big = view.width === 1728;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await walk(p, async () => {}, ["master-place"]);
    await p.waitForSelector("#mpForm .pp-open"); await sleep(1200);
    if (!big) {
      await p.click("#mpForm .pp-open"); await idle(p);
      const d = await dlg(p);
      check("1536×864: 参照… の窓が画面に収まる", d && d.inView, d && d.rect);
      await shot(p, "place-dlg-1536");
      continue;
    }
    // ① 札
    const chips = await p.$$eval("#mpForm .pp-chip", (xs) => xs.map((x) => ({ label: x.querySelector("small").textContent, path: x.querySelector("code").textContent })));
    check("マスタの置き場: 欄の横に「参照…」・下によく使う場所の札（品質データ・作業実績・配布の置き場）", ["品質データのフォルダ", "作業実績のフォルダ", "配布の置き場"].every((l) => chips.some((c) => c.label === l)), chips);
    await shot(p, "place");
    const wl = chips.find((c) => c.label === "作業実績のフォルダ");
    await p.click(`#mpForm .pp-chip:has(small:text-is("作業実績のフォルダ"))`); await sleep(1200);
    const st1 = await p.evaluate(() => ({ v: document.querySelector("#mpParent").value, s: document.querySelector("#mpState").textContent, c: document.querySelector("#mpState").className }));
    check("札を押すと欄に入り、すぐ確かめる（✓ か ✕ が出る）", st1.v === wl.path && /is-|ok|ng/.test(st1.c) && /[✓✕]/.test(st1.s), st1);
    // ② 窓（欄を空にしてから）
    await p.fill("#mpParent", ""); await p.dispatchEvent("#mpParent", "input"); await sleep(400);
    await p.click("#mpForm .pp-open"); await idle(p);
    let d = await dlg(p);
    check("空の欄で開くと、このアプリで使っている場所の 1 つ上（共有）から始まり、左によく使う場所", d.here === "共有" && d.side.some((x) => x.includes("品質データのフォルダ")) && d.side.some((x) => x.includes("作業実績のフォルダ")), d);
    const old = d.rows.find((r) => r.name === "Masters_旧");
    check("マスタのあるフォルダに「マスタあり」の印・ほかのフォルダには付かない", old && old.mark === "マスタあり" && d.rows.filter((r) => r.mark).length === 1, d.rows);
    check("窓が画面に収まる（1728×1152）", d.inView, d.rect);
    await shot(p, "place-dlg");
    // ③ マスタのあるフォルダを選ぶ → 切り替え
    await p.click(row("Masters_旧")); await sleep(150);
    await p.click(".pp-dlg .pp-go"); await sleep(1300);
    const st3 = await p.evaluate(() => ({ parent: document.querySelector("#mpParent").value, name: document.querySelector("#mpName").value, go: document.querySelector("#mpGo").textContent, open: !!document.querySelector(".pp-dlg") }));
    check("マスタのあるフォルダを選ぶと、上のフォルダと名前に分けて入り「この置き場に切り替える」", st3.parent.endsWith("共有") && st3.name === "Masters_旧" && st3.go.includes("切り替える") && !st3.open, st3);
    // ④ 中へ・上へ・届かない所・Esc
    await p.click("#mpForm .pp-open"); await idle(p);
    d = await dlg(p);
    check("欄に値があれば、そこから始まる", d.here === "共有", d.here);
    await p.dblclick(row("検査データ")); await idle(p);
    const inside = (await dlg(p)).here;
    await p.focus(".pp-dlg .pp-list"); await p.keyboard.press("Backspace"); await idle(p);
    const back = (await dlg(p)).here;
    check("2 回押すと中へ・Backspace で上へ", inside === "検査データ" && back === "共有", { inside, back });
    const base = (await dlg(p)).addr;
    await p.fill(".pp-dlg .pp-addr", `${base}/無い/もっと無い`); await p.press(".pp-dlg .pp-addr", "Enter"); await idle(p);
    d = await dlg(p);
    check("届かないアドレスを打つと、届いた所まで上がり理由が出る（下の欄も届いた所＝選ぶ物）", d.here === "共有" && d.stateCls.includes("is-ng") && d.state.includes("見つかりません") && d.addr === base, d);
    await shot(p, "place-dlg-miss");
    await p.keyboard.press("Escape"); await sleep(300);
    const esc = await p.evaluate(() => ({ dlg: !!document.querySelector(".pp-dlg"), master: !document.querySelector("#masterOverlay")?.classList.contains("hidden") }));
    check("Esc は窓だけ閉じる（マスタ管理は開いたまま）", !esc.dlg && esc.master, esc);
    // ⑤ データ元の「そのほかの接続」（更新の置き場・ブラウザ。版 3.58.0 で参照先のタブから移した）と、データ元の接続の設定（品質の元ファイル）
    await p.evaluate(() => document.querySelector('[data-tab="sources"]')?.click());
    await p.waitForSelector('#masterSettings [data-oth-open="update.source"]'); await sleep(400);
    const btns = [];
    for (const k of ["update.source", "lotdsp_import.direct.browser"]) {
      await p.click(`#masterSettings button[data-oth-open="${k}"]`); await sleep(500);
      btns.push(`${k}:${await p.$eval("#masterSettings .sr-other .pp-open", (b) => b.textContent).catch(() => "-")}`);
    }
    check("そのほかの接続: 更新の置き場は「📁 参照…」、ブラウザは「📄 参照…」",
      btns.join() === ["update.source:📁 参照…", "lotdsp_import.direct.browser:📄 参照…"].join(), btns);
    await p.click("#masterSettings [data-oth-close]"); await sleep(300);
    await p.click('#masterSettings [data-sr-edit="lot"]'); await sleep(400);
    await p.click('#masterSettings .sr-card.is-open [data-conn-f="place"] .pp-open'); await idle(p);
    d = await dlg(p);
    check("データ元の元ファイルの窓: 品質データのフォルダで .sqlite3 だけが出る", d.here === "台帳" && d.rows.every((r) => r.file && r.name.endsWith(".sqlite3")) && d.rows.some((r) => r.name === "SIKADEF.sqlite3"), d);
    await shot(p, "paths-dlg");
    await p.dblclick(row("SIKADEF.sqlite3")); await sleep(400);
    const st5 = await p.evaluate(() => { const c = document.querySelector("#masterSettings .sr-card.is-open");
      return { v: c.querySelector('[data-sr-conn="place"]').value, open: !!document.querySelector(".pp-dlg") }; });
    check("ファイルを 2 回押すと欄に入り、窓が閉じる", st5.v.endsWith("SIKADEF.sqlite3") && !st5.open, st5);
    // ⑥ 実績（データ元の実績の接続の段。欄が空でも既定のフォルダから始まる）
    await p.click("#masterSettings .sr-card.is-open [data-sr-close]"); await sleep(400);
    await p.click('.us-overlay [data-us="discard"]').catch(() => {}); await sleep(400);    // 直した欄（保存していない）を捨てて閉じる
    await p.click('#masterSettings [data-sr-edit="work"]'); await sleep(600);
    await p.click('#masterSettings .sr-card.is-open [data-conn-f="folder"] .pp-open'); await idle(p);
    d = await dlg(p);
    check("実績: いまのフォルダから始まり、決まりに合うファイルの数が出る", d.here === "【New】実績" && /実績のファイル \d+ 個/.test(d.state), d);
    await shot(p, "worklog-dlg");
    await p.keyboard.press("Escape");
    check("頁の誤りが無い", !errors.length, errors);
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG: ${fails.join("・")}` : "OK");
process.exit(fails.length ? 1 : 0);
