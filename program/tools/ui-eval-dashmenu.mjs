// 評価関数（開発用）: ダッシュボードの右クリックのメニュー（版 3.44.0。利用者の要望 2026-10-17 の 6）。
//   node program/tools/ui-eval-dashmenu.mjs [1280x720]
// ① パネルを右クリック: ブラウザーのメニューを出さず、見出しがパネルの題のメニュー（見る・写す・組む・消す）
// ② パネルの画像: パネルの所だけの画像（大きさがパネルと同じ）をクリップボードへ
// ③ 表の値をコピー: 表のパネル（設備ごとの仕掛と前日の実績）はタブ区切りの行（見出し・設備の行）。数字のパネルでは押せず理由が出る
// ④ 題を変える: 編集に入り、題が変わる（保存するまでは、この PC の画面だけ）
// ⑤ 消す（元に戻すで戻る）・複製（空きが無ければ押せず理由・空いたら 1 つ増える）
// ⑥ パネルをコピー → ほかのダッシュボード（新しく作った空の物）の空いた所を右クリック →「貼り付け」で同じ組みのパネルが、押したマスに入る
// ⑦ 空いたマスを右クリック →「ここにパネルを足す」で、そのマスにパネルが足される
// ⑧ キー: パネルに焦点を置いて Shift+F10 で開き、↓ で次の項目・Esc で閉じる
// ⑨ 右下の端のパネルで開いても、メニューは画面に収まる
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1280x720");
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
let answer = "";
const menu = (p) => p.evaluate(() => { const m = document.querySelector(".tpa-menu"); if (!m) return null; const r = m.getBoundingClientRect();
  return { head: m.querySelector(".tm-head")?.textContent, items: [...m.querySelectorAll("button")].map((b) => ({ t: b.querySelector("span").firstChild.textContent, off: b.disabled, why: b.title })), r: [r.left, r.top, r.right, r.bottom], W: innerWidth, H: innerHeight }; });
const rclickAt = (p, x, y) => p.evaluate(({ x, y }) => { const t = document.elementFromPoint(x, y); const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }); t.dispatchEvent(e); return e.defaultPrevented; }, { x, y });
const rclick = async (p, sel) => { const b = await (await p.$(sel)).boundingBox(); const ok = await rclickAt(p, b.x + b.width / 2, b.y + b.height / 2); await sleep(250); return ok; };
const choose = async (p, text) => { await p.evaluate((t) => [...document.querySelectorAll(".tpa-menu button")].find((b) => b.textContent.includes(t)).click(), text); await sleep(400); };
const count = (p) => p.$$eval("#dashGrid .db-p", (xs) => xs.length);
const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => (d.type() === "prompt" ? d.accept(answer) : d.accept()));
  await p.evaluate(() => {   // クリップボードを受け取る（試験のブラウザーは書けない）
    window.__clip = {}; navigator.clipboard.writeText = async (t) => { window.__clip.text = t; };
    navigator.clipboard.write = async (items) => { const b = await items[0].getType("image/png"); const bm = await createImageBitmap(b); window.__clip.img = [bm.width, bm.height]; };
  });
  const prevented = await rclick(p, P("wipClass"));
  const m1 = await menu(p);
  const title = await p.$eval(`${P("wipClass")} h3`, (h) => h.textContent);
  check("① 右クリックでパネルのメニュー（ブラウザーのメニューは出さない）", prevented && m1 && m1.head === title && ["引き直す", "画像をコピー", "表の値をコピー", "組む", "複製", "パネルをコピー", "消す"].every((w) => m1.items.some((x) => x.t.includes(w))), m1);
  await choose(p, "パネルの画像をコピー"); await p.waitForFunction(() => window.__clip.img, null, { timeout: 15000 });
  const img = await p.evaluate(() => window.__clip.img), box = await (await p.$(P("wipClass"))).boundingBox();
  check("② パネルの所だけの画像（大きさがパネルと同じ）", Math.abs(img[0] - box.width * 1.25) <= 3 && Math.abs(img[1] - box.height * 1.25) <= 3, { img, box });
  const kpi = await p.$$eval("#dashGrid .db-p", (xs) => xs.find((x) => !x.querySelector(".db-pb table"))?.dataset.id);
  await rclick(p, P(kpi));
  const m2 = await menu(p), tsvItem = m2.items.find((x) => x.t.includes("表の値をコピー"));
  check("③ 表の無いパネルでは「表の値をコピー」は押せず理由が出る", tsvItem.off && tsvItem.why.length > 0, tsvItem);
  await p.keyboard.press("Escape"); await sleep(150);
  const board = await p.$$eval("#dashGrid .db-p", (xs) => xs.find((x) => x.querySelector(".db-pb table"))?.dataset.id);
  await rclick(p, P(board)); await choose(p, "表の値をコピー");
  const tsv = await p.evaluate(() => window.__clip.text || ""), lines = tsv.split("\r\n");
  check("③ 表の値をコピー: タブ区切りの行", lines.length >= 5 && lines.every((l) => l.includes("\t")) && /L-1/.test(tsv), lines.slice(0, 3));

  answer = "試しの題";
  await rclick(p, P("wipClass")); await choose(p, "題を変える");
  const t2 = await p.$eval(`${P("wipClass")} h3`, (h) => h.textContent), edit = await p.$eval("#dashScreen", (x) => x.classList.contains("is-edit"));
  check("④ 題を変える（編集に入る）", t2 === "試しの題" && edit, { t2, edit });
  await rclick(p, P("wipClass"));
  const dup0 = (await menu(p)).items.find((x) => x.t === "複製"); await p.keyboard.press("Escape");
  check("⑤ 空きが無いとき、複製は押せず理由が出る", dup0.off && /空き/.test(dup0.why), dup0);
  await rclick(p, P("wipClass")); await choose(p, "このパネルを消す");
  const gone = !(await p.$(P("wipClass")));
  await p.keyboard.press("Control+z"); await sleep(400);
  check("⑤ 消す → 元に戻すで戻る", gone && !!(await p.$(P("wipClass"))), { gone });
  const other = await p.$$eval("#dashGrid .db-p", (xs) => xs.map((x) => x.dataset.id).find((i) => i !== "wipClass"));
  await rclick(p, P(other)); await choose(p, "このパネルを消す");
  const n0 = await count(p);
  await rclick(p, P("wipClass")); await choose(p, "複製");
  check("⑤ 空いたら、複製で 1 つ増える", (await count(p)) === n0 + 1, { n0, now: await count(p) });

  // ⑥ パネルをコピー → 空のダッシュボードへ貼り付け（押したマスに入る）
  await rclick(p, P("wipClass")); await choose(p, "パネルをコピー");
  const clip = await p.evaluate(() => JSON.parse(localStorage.getItem("tpa.dash.clip.v1") || "null"));
  check("⑥ パネルをコピー（この PC に覚える）", clip && clip.name === "試しの題" && clip.panel.visual, clip && clip.name);
  await p.click("[data-db-pick]"); await sleep(300);
  const blank = await p.$("[data-db-blank], [data-db-new]");
  if (blank) await blank.click(); else await p.evaluate(() => document.querySelectorAll(".db-pickpop button").forEach((b) => { if (/新しく|白紙|空の/.test(b.textContent)) b.click(); }));
  await sleep(600);
  const cell = await p.$('.db-cell[data-cell="2,1"]');
  if (!cell) check("⑥ 空のダッシュボードに空いたマスがある", false, await count(p));
  else {
    const b = await cell.boundingBox(); await rclickAt(p, b.x + b.width / 2, b.y + b.height / 2); await sleep(250);
    const m3 = await menu(p);
    check("⑥⑦ 空いた所のメニュー: ここにパネルを足す・貼り付け「題」", m3 && m3.items.some((x) => x.t === "ここにパネルを足す") && m3.items.some((x) => x.t === "貼り付け「試しの題」" && !x.off), m3);
    await choose(p, "貼り付け");
    const pasted = await p.evaluate(() => [...document.querySelectorAll("#dashGrid .db-p")].map((x) => [x.querySelector("h3").textContent, x.style.gridColumn, x.style.gridRow]));
    check("⑥ 貼り付けたパネルが、押したマスに入る", pasted.length === 1 && pasted[0][0] === "試しの題" && pasted[0][1].startsWith("3 ") && pasted[0][2].startsWith("2 "), pasted);
    const c2 = await p.$('.db-cell[data-cell="0,5"]'), b2 = await c2.boundingBox();
    await rclickAt(p, b2.x + b2.width / 2, b2.y + b2.height / 2); await sleep(250); await choose(p, "ここにパネルを足す");
    await p.evaluate(() => window.DashEditor && document.querySelector("[data-de-cancel], [data-de-close]")?.click()); await sleep(400);
    const added = await p.evaluate(() => [...document.querySelectorAll("#dashGrid .db-p")].map((x) => [x.style.gridColumn, x.style.gridRow]));
    check("⑦ ここにパネルを足す: そのマスに入る", added.length === 2 && added.some(([c, r]) => c.startsWith("1 ") && r.startsWith("6 ")), added);
  }
  // ⑧ キー
  const first = await p.$eval("#dashGrid .db-p", (x) => x.dataset.id);
  await p.focus(P(first)); await p.keyboard.press("Shift+F10"); await sleep(250);
  const k1 = await p.evaluate(() => document.activeElement.closest(".tpa-menu") ? document.activeElement.textContent : "");
  await p.keyboard.press("ArrowDown"); const k2 = await p.evaluate(() => document.activeElement.textContent);
  await p.keyboard.press("Escape"); await sleep(150);
  check("⑧ Shift+F10 で開き、↓ で次の項目・Esc で閉じる", k1 && k2 && k1 !== k2 && !(await menu(p)), { k1, k2 });
  // ⑨ 右下の端
  const vw = VIEW.width, vh = VIEW.height;
  await rclickAt(p, vw - 30, vh - 30); await sleep(250);
  const m9 = await menu(p);
  check("⑨ 右下の端で開いても、メニューは画面に収まる", m9 && m9.r[0] >= 0 && m9.r[1] >= 0 && m9.r[2] <= vw && m9.r[3] <= vh, m9 && m9.r);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
