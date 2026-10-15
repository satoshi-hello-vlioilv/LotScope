// 評価関数（開発用）: 全員のマスタの置き場（配る版の覚え distribute.json の masters。版 3.34.0）を画面で見せ、直せるか。
//   node program/tools/ui-eval-masterpin.mjs
// 試験用の画面は、この PC が手元のみで、配る版の覚えの置き場（\\nlmsrvngy03\…\Masters）には届かない（＝ずれた形・届かない形）。
// ① アプリの配布: いちばん上が「配布の置き場」「全員のマスタの置き場」の同じ形の 2 行。全員の行に置き場の字（末尾まで読める）・
//    「この PC は別」の札・届かない札。ボタンは「配布の置き場を変える…」と「この PC の置き場を配る」（言葉が分かれている）
// ② マスタの置き場: 上の札の下に同じ形の行（同じ題・同じ札）。「置き場を変える」の欄に、変えると配る版の覚えにも書くと書いてある
// ③ 見出し帯のボタンは「マスタの置き場 ›」（帯の「配布の置き場を変える…」と紛れない）
// ④ 「この PC の置き場を配る」を押すと /__desktop/release/masters へ送り、配布の画面を読み直す
// ⑤ 1728×1152・1280×720 で、行が窓の外へはみ出さない（横に送らない）
// 全部合えば終了コード 0。
import { launch, sleep } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const tab = async (p, key) => { await p.evaluate((k) => document.querySelector(`#masterTabs [data-tab="${k}"]`).click(), key); await sleep(1500); };
const look = (p) => p.evaluate(() => {
  const box = document.querySelector("#masterSettings .pin-2"), lines = box ? [...box.querySelectorAll(".pin-line")] : [];
  const pane = document.querySelector("#masterSettings");
  return {
    lines: lines.map((l) => ({ head: l.querySelector("b")?.textContent, code: l.querySelector("code")?.textContent || "",
      codeCut: (() => { const c = l.querySelector("code"); return c ? c.scrollWidth > c.clientWidth + 1 : false; })(),
      chips: [...l.querySelectorAll(".m-chip")].map((c) => c.textContent), buttons: [...l.querySelectorAll("button")].map((b) => b.textContent), off: l.classList.contains("is-off") })),
    over: pane ? pane.scrollWidth > pane.clientWidth + 1 : null,
    head: document.querySelector("#masterPlaceGo")?.textContent || "",
    note: [...document.querySelectorAll("#masterSettings .mp-sub")].map((x) => x.textContent).join(" "),
    text: (document.querySelector("#masterSettings .pin-2")?.textContent || "").replace(/\s+/g, " "),
  };
});

const app = await launch();
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1280, height: 720 }]) {
    const tag = `${view.width}×${view.height}`;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    let posted = null;
    await p.context().route("**/__desktop/release/masters", (r) => { posted = r.request().postDataJSON(); r.fulfill({ json: { masters: { dir: "", setAt: "2026-10-15T15:00:00" }, version: "3.12.0" } }); });
    await p.click("#masterBtn"); await sleep(900);
    await tab(p, "release");
    const rel = await look(p);
    const [a, b] = rel.lines;
    check(`① ${tag} 配布の画面のいちばん上が「配布の置き場」「全員のマスタの置き場」の 2 行`, rel.lines.length === 2 && a.head === "配布の置き場" && b.head === "全員のマスタの置き場", rel.lines);
    check(`① ${tag} 全員の行: 置き場の字が末尾まで読める・この PC は別・届かない札・ずれた行は橙`,
      /Masters$/.test(b.code) && !b.codeCut && b.chips.some((c) => /この PC は別/.test(c)) && b.chips.some((c) => /届きません/.test(c)) && b.off, b);
    check(`① ${tag} ボタンの言葉が分かれている（配布の置き場を変える…）・手元のみの PC には「この PC の置き場を配る」を出さず、理由を出す`,
      a.buttons.includes("配布の置き場を変える…") && !b.buttons.length && /手元のみ（配れません）/.test(rel.text), { a: a.buttons, b: b.buttons, text: rel.text });
    check(`③ ${tag} 見出し帯のボタンは「マスタの置き場 ›」`, rel.head === "マスタの置き場 ›", rel.head);
    check(`⑤ ${tag} 配布の画面が横にはみ出さない`, rel.over === false, rel.over);
    // ④ 共有の置き場を使っている PC の形にして（mstate.place を共有に）、「この PC の置き場を配る」で /__desktop/release/masters へ送る
    await p.evaluate(async () => {
      const r = await fetch("/api/masters/status"); const d = await r.json();
      d.mode = "shared"; d.dir = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Apps\\LotScope";
      const orig = window.fetch; window.fetch = (u, o) => (String(u).startsWith("/api/masters/status") ? Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } })) : orig(u, o));
    });
    await p.click("#masterCloseBtn"); await sleep(400); await p.click("#masterBtn"); await sleep(900);   // 開き直すと置き場を読み直す
    await tab(p, "release");
    const shared = await look(p);
    const pinBtn = shared.lines[1] ? shared.lines[1].buttons : [];
    check(`④ ${tag} 共有の置き場の PC には「この PC の置き場を配る」が出る`, pinBtn.includes("この PC の置き場を配る"), shared.lines[1]);
    if (pinBtn.includes("この PC の置き場を配る")) { await p.click('#masterSettings [data-pin="publish"]'); await sleep(1500); }
    check(`④ ${tag} 押すと /__desktop/release/masters へ送る（この PC の置き場＝空で送る）`, posted && posted.dir === "", posted);
    await tab(p, "place");
    const pl = await look(p);
    check(`② ${tag} マスタの置き場の画面に同じ形の行（同じ題・同じ札）`, pl.lines.length === 1 && pl.lines[0].head === "全員のマスタの置き場"
      && pl.lines[0].chips.some((c) => /この PC は別/.test(c)), pl.lines);
    check(`② ${tag} 「置き場を変える」の欄に、配る版の覚えにも書くと書いてある`, /配る版の覚えにも/.test(pl.note), pl.note);
    check(`⑤ ${tag} マスタの置き場の画面が横にはみ出さない`, pl.over === false, pl.over);
    check(`${tag} 頁の誤りが無い`, !errors.length, errors);
    await p.context().close();
  }
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
