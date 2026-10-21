// 評価関数（開発用）: 絞り込み・検索の欄で日本語入力（IME）ができるか（版 3.46.0。利用者の要望 2026-10-21 の 4:
//   「フィルタ入力時の変換が勝手にかかって、ローマ字打ち、漢字変換ができない」）。
//   node program/tools/ui-eval-ime.mjs [1728x1152]
// 本物の Chromium の IME の道（CDP の Input.imeSetComposition＝変換中の字・Input.insertText＝確定）で、欄ごとに
//   ① 変換中（「かん」）に欄が作り直されない（同じ欄のまま・焦点もそのまま。作り直すと未確定の字が確定されてしまう）
//   ② 待っても（裏で値を読み直す・描き直す間も）変換が続く
//   ③ 確定すると、欄の字は「漢字」だけ（変換中の「かん」が残らない）
//   ④ 確定した字で絞り込み・検索が効く（欄ごとの確かめ。効いた所が分かる物だけ）
// を確かめる。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1728x1152");
const app = await launch();

/** sel の欄で「かん」→（待つ）→「漢字」と打つ。→ {mid: 変換中の様子, end: 確定後の様子} */
async function ime(p, cdp, sel, wait = 900) {
  await p.waitForSelector(sel, { state: "visible" });
  await p.click(sel);
  await p.evaluate((s) => { const e = document.querySelector(s); e.select?.(); e.__ime = 1; }, sel);
  await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 }); await sleep(120);
  await cdp.send("Input.imeSetComposition", { text: "かん", selectionStart: 2, selectionEnd: 2 }); await sleep(wait);
  const mid = await p.evaluate(() => { const a = document.activeElement; return { same: !!(a && a.__ime), v: a ? a.value : null }; });
  await cdp.send("Input.insertText", { text: "漢字" }); await sleep(wait);
  const end = await p.evaluate((s) => { const a = document.activeElement, e = document.querySelector(s); return { same: !!(a && a.__ime), v: e ? e.value : null }; }, sel);
  return { mid, end };
}
function judge(name, r) {
  check(`${name}: ① 変換中も同じ欄のまま（作り直さない）`, r.mid.same && r.mid.v === "かん", r.mid);
  check(`${name}: ③ 確定した字は「漢字」だけ`, r.end.v === "漢字", r.end);
}

try {
  const p = await app.newPage("light", VIEW);
  p.on("pageerror", (e) => errors.push(e.message));
  const cdp = await p.context().newCDPSession(p);
  const clear = async (sel) => { await p.fill(sel, ""); await sleep(400); };

  // 1. 一覧を検索
  judge("一覧を検索", await ime(p, cdp, "#llSearch"));
  check("一覧を検索: ④ 確定した字で絞った（0 件の知らせか、件数が変わる）", await p.evaluate(() => /漢字/.test(document.querySelector("#llActiveTabs")?.textContent || "") || /0/.test(document.querySelector("#llCount")?.textContent || "")), "");
  await clear("#llSearch");

  // 2. 列で絞り込む
  await p.click("#llAdhocToggle"); await sleep(300);
  await p.selectOption("#llAdhocColumn", "不良名"); await sleep(300);
  judge("列で絞り込む", await ime(p, cdp, "#llAdhocValue"));
  await clear("#llAdhocValue"); await p.click("#llAdhocClose"); await sleep(200);

  // 3. 条件を検索して足す
  await p.click("#llCondBtn"); await sleep(250); await p.click("#llAddCond"); await sleep(300);
  judge("条件を検索して足す", await ime(p, cdp, "#llTokenSearch"));
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await sleep(200);

  // 4. 条件を作る（値）
  await p.click("#llCondBtn"); await sleep(250); await p.click("#llFilterToggle"); await sleep(300);
  judge("条件を作る（値）", await ime(p, cdp, "#llFilterValue"));
  await p.click("#llFilterBodyClose").catch(() => {}); await sleep(200);

  // 5. 列の値で絞る（Excel のフィルタ）: 値の検索・条件の値
  await p.hover('#llHead th[data-col="不良名"]'); await sleep(150);
  await p.click('#llHead th[data-fcol="不良名"] [data-th-filter]'); await p.waitForSelector(".vf-pop [data-vf-v]");
  judge("列の値で絞る（値を検索）", await ime(p, cdp, ".vf-pop [data-vf-search]"));
  await p.fill(".vf-pop [data-vf-search]", ""); await sleep(300);
  const r5 = await ime(p, cdp, ".vf-pop [data-vf-search]").then(async () => {
    await p.fill(".vf-pop [data-vf-search]", ""); await p.click(".vf-pop [data-vf-search]");
    await cdp.send("Input.imeSetComposition", { text: "よご", selectionStart: 2, selectionEnd: 2 }); await sleep(600);
    await cdp.send("Input.insertText", { text: "汚" }); await sleep(600);
    return p.evaluate(() => [...document.querySelectorAll(".vf-pop .vf-it [data-vf-v]")].map((x) => x.dataset.vfV));
  });
  check("列の値で絞る: ④ 確定した字（汚）で値の並びが絞れる", r5.length >= 1 && r5.every((v) => v.includes("汚")), r5);
  await p.click(".vf-pop [data-vf-ctog]"); await sleep(250);
  judge("列の値で絞る（条件の値）", await ime(p, cdp, ".vf-pop .vf-crow [data-vf-val]"));
  await p.keyboard.press("Escape"); await sleep(200);

  // 6. スライサーの値を探す
  await p.click("#llSlicerBtn"); await sleep(400);
  if (!(await p.$('#llSlicer .sx-card[data-col="不良名"]'))) { await p.selectOption("#llSlicerAdd", "不良名"); await sleep(700); }
  judge("スライサーの値を探す", await ime(p, cdp, '#llSlicer .sx-card[data-col="不良名"] .sx-q'));
  await clear('#llSlicer .sx-card[data-col="不良名"] .sx-q');
  await p.click("#llSlicerBtn"); await sleep(300);

  // 7. 表示列の窓の「列名で絞り込み」
  await p.click("#llColBtn"); await sleep(600);
  const colQ = await p.$('#llColumnPanel input[type="search"]') ? '#llColumnPanel input[type="search"]' : 'input[placeholder="列名で絞り込み"]';
  judge("表示列の列名で絞り込み", await ime(p, cdp, colQ));
  await p.click("#lcClose").catch(() => {}); await sleep(300);
  await p.click('.us-card [data-us="discard"]').catch(() => {}); await sleep(200);

  // 8. 集計表のカラムを検索
  await p.click('#llViewSwitch [data-pv-view="pivot"]'); await sleep(900);
  const pq = '#llPivot input[placeholder="カラムを検索"]';
  if (await p.$(pq)) judge("集計表のカラムを検索", await ime(p, cdp, pq));
  await p.click('#llViewSwitch [data-pv-view="list"]').catch(() => {}); await sleep(300);

  // 9. ダッシュボード: パネルを絞る（値の検索）・組む所のカラムの検索・組む所の条件の値の検索
  await p.click("#tabDash"); await waitDash(p); await sleep(300);
  await p.evaluate(() => document.querySelector('#dashGrid .db-p[data-id="wipClass"] [data-db-filter]').click()); await p.waitForSelector("[data-df-col]"); await sleep(800);
  await p.evaluate(() => { const s = document.querySelector("[data-df-col]"); s.value = "製造材質"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForSelector(".df-vf [data-vf-search]"); await sleep(300);
  judge("ダッシュボードの絞る（値を検索）", await ime(p, cdp, ".df-vf [data-vf-search]"));
  await p.evaluate(() => window.DashFilter && DashFilter.close()); await p.keyboard.press("Escape"); await sleep(300);
  await p.click("[data-db-editmode]"); await sleep(500);
  const b = await p.$('#dashGrid .db-p[data-id="wipClass"] [data-db-edit]');
  if (b) await b.click(); else { await p.focus('#dashGrid .db-p[data-id="wipClass"]'); await p.keyboard.press("Enter"); }
  await p.waitForSelector("#deFields .pv-f"); await sleep(500);
  judge("組む所のカラムを検索", await ime(p, cdp, '#dbEditor input[placeholder="カラムを検索"]'));
  await p.fill('#dbEditor input[placeholder="カラムを検索"]', ""); await sleep(300);
  await p.selectOption("#deCond [data-de-fpick]", "製造材質"); await p.waitForSelector(".vf-pop [data-vf-search]"); await sleep(300);
  judge("組む所の条件（値を検索）", await ime(p, cdp, ".vf-pop [data-vf-search]"));
  await p.keyboard.press("Escape"); await sleep(200);
  await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);
  await p.click('.us-card [data-us="discard"]').catch(() => {}); await sleep(300);

  // 10. マスタ管理: 検索・設備グループの設備を探す・変換表の当てる列を探す
  await p.keyboard.press("Escape"); await p.click("[data-db-leave]").catch(() => {}); await p.click("[data-db-discard]").catch(() => {}); await sleep(300);
  await p.click("#masterBtn"); await sleep(900);
  const ms = '#masterOverlay input[type="search"][aria-label="マスタの中を検索"]';
  if (await p.$(ms)) judge("マスタの中を検索", await ime(p, cdp, ms));
  await p.evaluate(() => document.querySelector('[data-master-tab="egroups"], [data-tab="egroups"]')?.click()); await sleep(900);
  const eg = '#masterOverlay input[placeholder="設備を探す"]';
  if (await p.$(eg)) judge("設備グループの設備を探す", await ime(p, cdp, eg));
  await p.evaluate(() => document.querySelector('[data-master-tab="conv"], [data-tab="conv"]')?.click()); await sleep(900);
  if (await p.$('[data-cv-cols="1"]')) {
    await p.click('[data-cv-cols="1"]'); await p.waitForSelector("[data-cp-q]"); await sleep(400);
    judge("変換表の当てる列を探す", await ime(p, cdp, "[data-cp-q]"));
  }
  check("頁のエラーが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
