// 評価関数（開発用）: 推奨アップデートの札と、使っている人への控えめな知らせ（版 3.35.0）。
//   node program/tools/ui-eval-recommend.mjs
// 窓（/__desktop/update・/__desktop/release）の答えを作り物にして、画面だけを確かめる（札を書くのは desktop/src/distribute.rs。cargo test が確かめる）。
// ① 配る版に推奨の札が付き、この PC がまだその版でない → 一覧の面のいちばん上に 1 段の帯（↻・題・理由・あとで・更新して開き直す）。
//    見出しの札は「↻ 推奨 3.13.0」（11px 以上・淡くしない）。一覧を覆わない（帯は一覧の上にあり、重ならない）
// ② 作業実績の画面でも、同じ所（面のいちばん上）に出る
// ③ 「あとで」→ 帯が畳まれ、見出しの札だけ残る。開き直しても（4 時間は）畳んだまま。札を押すと帯が戻る
// ④ 「更新して開き直す」→ /__desktop/update/apply へ送る（取り込み済みのとき）。まだ取り込んでいないときは「取り込みの様子」（更新履歴の窓）
// ⑤ 札が無い・この PC がもう配る版 → 帯も「推奨」の札も出ない
// ⑥ 配布の画面: 配っている版に「推奨にする…」→ 理由を書いて「推奨にする」で /__desktop/release/recommend へ {version, on:true, note}。
//    札が付いた版は「推奨」の札・②の札「推奨アップデート」・理由の行・「推奨を外す」（{on:false}）。両方のボタンは並ばない
// ⑦ 1728×1152・1280×720 で、帯が 1 段（高さ 34px 以下）・ボタンの字が折れない・窓の外へはみ出さない
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const NOTE = "ほかの PC がマスタの置き場に追従しない不具合を直しました";
const BOX = "C:\\Users\\user\\Box\\LotScope";
const recommended = { note: NOTE, setAt: "2026-10-15T09:06:00", setBy: "user", setPc: "PC-01" };
const update = (over = {}) => ({ state: "ready", ready: "3.13.0", direction: "up", current: "3.12.0", source: BOX, found: BOX, failed: [], notes: [],
  distributed: { version: "3.13.0", previous: "3.12.0", setAt: "2026-10-15T09:05:00", setBy: "user", recommended }, ...over });
const release = (rec) => ({
  reachable: true, found: BOX, adjusted: false, folder: BOX, appFolder: BOX, problems: [],
  distributed: { schema: 1, app_id: "defect-analyzer", version: "3.13.0", entry: "LotScope.exe", setAt: "2026-10-15T09:05:00", setBy: "user", previous: "3.12.0", ...(rec ? { recommended: rec } : {}) },
  versions: ["3.13.0", "3.12.0"].map((v) => ({ version: v, placedAt: "2026-10-08T12:30:00", placedPc: "PC-01", placedBy: "user", source: "desktop-windows", bytes: 6816621 })),
  entry: { exists: true, path: `${BOX}\\LotScope.exe` }, me: { canRelease: true, role: "開発者", current: "3.12.0" },
});

/** 帯と見出しの札の様子 */
const look = (p) => p.evaluate(() => {
  const band = document.querySelector("#recBand"), chip = document.querySelector("#verNew"), panel = document.querySelector("#lotListScreen .ll-panel");
  const r = band && !band.hidden ? band.getBoundingClientRect() : null, body = document.querySelector("#llBody")?.getBoundingClientRect();
  const first = panel ? [...panel.children].find((c) => !c.hidden && getComputedStyle(c).display !== "none") : null;
  return {
    shown: !!r, text: band && !band.hidden ? band.textContent.replace(/\s+/g, " ").trim() : "",
    buttons: band && !band.hidden ? [...band.querySelectorAll("button")].map((b) => b.textContent) : [],
    wrapped: band ? [...band.querySelectorAll("button")].some((b) => b.getBoundingClientRect().height > 30) : false,
    height: r ? Math.round(r.height) : 0, over: r ? r.right > innerWidth + 0.5 || r.left < -0.5 : false,
    above: r && body ? r.bottom <= body.top : null, top: first ? first.id === "recBand" || first.id === "llEquipBar" : null,
    chip: chip && !chip.classList.contains("hidden") ? chip.textContent : "", chipRec: !!chip && chip.classList.contains("is-rec"),
    // 見出しの札が読める（11px 以上・上の段で淡くされていない。3 回目の採点で、紺の上で淡く 10px だった）
    chipFont: chip ? parseFloat(getComputedStyle(chip).fontSize) : 0,
    chipAlpha: (() => { let a = 1; for (let e = chip; e; e = e.parentElement) a *= Number(getComputedStyle(e).opacity); return a; })(),
  };
});

const app = await launch();
try {
  for (const view of [parseView("1728x1152"), parseView("1280x720")]) {
    const tag = `${view.width}×${view.height}`;
    const page = await app.newPage("light", view);
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    let answer = update(), applied = 0;
    await page.route("**/__desktop/update", (route) => route.fulfill({ json: answer }));
    await page.route("**/__desktop/update/apply", (route) => { applied++; return route.fulfill({ json: { ok: true } }); });
    await page.evaluate(() => { TPA.local.remove("tpa.recommend.later"); pollUpdate(); }); await sleep(800);

    // ① 一覧の面のいちばん上に 1 段の帯
    const a = await look(page);
    check(`① ${tag} 帯が出る（↻・題・理由）`, a.shown && /↻/.test(a.text) && /推奨アップデート 3\.13\.0/.test(a.text) && a.text.includes(NOTE), a);
    check(`① ${tag} 手は「あとで」「更新して開き直す」（あとで が左）`, JSON.stringify(a.buttons) === JSON.stringify(["あとで", "更新して開き直す"]), a);
    check(`① ${tag} 見出しの札は「↻ 推奨 3.13.0」（帯と同じ藍）`, a.chip === "↻ 推奨 3.13.0" && a.chipRec, a);
    check(`① ${tag} 見出しの札は 11px 以上で、淡くされていない`, a.chipFont >= 11 && a.chipAlpha === 1, a);
    check(`⑦ ${tag} 帯は 1 段（34px 以下）・ボタンの字が折れない・はみ出さない`, a.height > 0 && a.height <= 34 && !a.wrapped && !a.over, a);
    check(`① ${tag} 一覧を覆わない（帯は一覧の上・面のいちばん上）`, a.above === true && a.top === true, a);

    // ② 作業実績の画面でも同じ所
    await page.click("#tabWork"); await sleep(2500);
    const w = await look(page);
    check(`② ${tag} 作業実績の画面でも面のいちばん上に出る`, w.shown && w.top === true && w.above === true, w);
    await page.click("#tabList"); await sleep(800);

    // ③ あとで → 札だけ。開き直しても畳んだまま。札を押すと帯が戻る
    await page.click("#recBand [data-rec-later]"); await sleep(300);
    const later = await look(page);
    check(`③ ${tag} 「あとで」で帯が畳まれ、見出しの札だけ残る`, !later.shown && later.chip === "↻ 推奨 3.13.0", later);
    await page.reload(); await page.waitForSelector("#llBody tr[data-i]"); await sleep(1200);
    const reopened = await look(page);
    check(`③ ${tag} 開き直しても（4 時間は）畳んだまま`, !reopened.shown && reopened.chip === "↻ 推奨 3.13.0", reopened);
    await page.click("#verNew"); await sleep(300);
    const back = await look(page);
    check(`③ ${tag} 見出しの札を押すと帯が戻る（開き直さない）`, back.shown && applied === 0, { back, applied });

    // ④ 更新して開き直す
    await page.click("#recBand [data-rec-go]"); await sleep(500);
    check(`④ ${tag} 「更新して開き直す」で /__desktop/update/apply へ送る`, applied === 1, { applied });
    await page.reload(); await page.waitForSelector("#llBody tr[data-i]"); await sleep(400);
    answer = update({ state: "staging", ready: null, detail: "3.13.0" });
    await page.evaluate(() => pollUpdate()); await sleep(600);
    const staging = await look(page);
    check(`④ ${tag} まだ取り込んでいないときは「取り込みの様子」（開き直すと言わない）`, staging.shown && staging.buttons.includes("取り込みの様子") && !staging.buttons.includes("更新して開き直す"), staging);

    // ⑤ 出ない形
    answer = update({ current: "3.13.0", state: "latest", ready: null });
    await page.evaluate(() => pollUpdate()); await sleep(600);
    const same = await look(page);
    check(`⑤ ${tag} この PC がもう配る版なら、帯も推奨の札も出ない`, !same.shown && !same.chipRec, same);
    answer = update({ distributed: { version: "3.13.0", previous: "3.12.0" } });
    await page.evaluate(() => pollUpdate()); await sleep(600);
    const plain = await look(page);
    check(`⑤ ${tag} 推奨の札が無ければ、帯は出ず、札はこれまでの「更新あり 3.13.0」`, !plain.shown && plain.chip === "更新あり 3.13.0" && !plain.chipRec, plain);

    // ⑥ 配布の画面
    if (view.width === 1728) {
      let rec = null; const sent = [];
      await page.route(/\/__desktop\/release(\?|$)/, (route) => route.fulfill({ json: release(rec) }));
      await page.route("**/__desktop/release/recommend", async (route) => {
        const b = route.request().postDataJSON(); sent.push(b);
        rec = b.on ? { ...recommended, note: b.note } : null;
        return route.fulfill({ json: { version: b.version, recommended: rec } });
      });
      await page.click("#masterBtn"); await page.waitForSelector("#masterOverlay:not(.hidden)");
      await page.evaluate(() => document.querySelector('#masterTabs [data-tab="release"]').click()); await sleep(1500);
      const row = () => page.evaluate(() => {
        const live = document.querySelector("#masterSettings tr.is-live");
        return { tags: live ? [...live.querySelectorAll(".m-chip")].map((c) => c.textContent) : [], acts: live ? [...live.querySelectorAll("button")].map((b) => b.textContent) : [],
          step: document.querySelectorAll("#masterSettings .dz-step")[1]?.textContent.replace(/\s+/g, " ") || "" };
      });
      const off = await row();
      check("⑥ 札の無い配っている版に「推奨にする…」だけ（「推奨を外す」は並ばない）", JSON.stringify(off.acts) === JSON.stringify(["推奨にする…"]), off);
      await page.click("#masterSettings [data-rec-on]");
      await page.fill("#masterSettings .dz-rec-ask input", NOTE);
      await page.click("#masterSettings [data-rec-put]"); await sleep(1500);
      check("⑥ 理由を書いて「推奨にする」→ {version, on:true, note} を送る", sent.length === 1 && sent[0].version === "3.13.0" && sent[0].on === true && sent[0].note === NOTE, sent);
      const on = await row();
      check("⑥ 付いた版に「推奨」の札・②に「推奨アップデート」と理由・「推奨を外す」だけ",
        on.tags.includes("↻ 推奨") && /推奨アップデート/.test(on.step) && on.step.includes(NOTE) && JSON.stringify(on.acts) === JSON.stringify(["推奨を外す"]), on);
      await page.click("#masterSettings [data-rec-off]"); await sleep(1500);
      const removed = await row();
      check("⑥ 「推奨を外す」→ {on:false} を送り、札が消える", sent.length === 2 && sent[1].on === false && !removed.tags.includes("↻ 推奨"), { sent, removed });
    }
    check(`${tag} 頁の誤りが無い`, !errors.length, errors);
    await page.context().close();
  }
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
