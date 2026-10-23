// 評価関数（開発用。版 3.52.0。利用者の要望 2026-10-23: ダッシュボードのスライサーで日付を変える・帯の ON/OFF と編集・パネルに自由なスライサー）。
//   node program/tools/ui-eval-dslicer.mjs [1280x720]
// ① 日付: 帯の「日付…」で暦が札の真下に開く・始めと終わりの日を押すと当たる（期間 range）・作業実績の数字のパネルがサーバーへ同じ日付の範囲を
//    問い合わせた答えと同じ・札は「日付 10/1〜10/2」・期間の札と月の送りは選ばれていない・パネルの札も日付の言葉。暦の打つ欄（から・まで）でも当たる
// ② 「スライサー ▾」の面: 帯を OFF → 帯が消え、道具の行に「スライサー OFF」・どのパネルにも効かない（組んだままの数）→ ON で戻る。
//    出す物の「設備」を外す → 帯から設備の札が消える。見ているときの変更はこの PC だけ（ダッシュボードの組みは変わらない）
// ③ 編集中に帯を OFF → ダッシュボードの組み（layout.slicer.off）に入る
// ④ パネルのスライサー: 値の札の数と件数がサーバーと同じ・押すと同じデータのほかのパネルがその値で絞れる（サーバーへ in の条件で問い合わせた答えと同じ）・
//    自分は絞らない・ほかのデータのパネルは変わらない・札に「仕掛区分 保留」・もう一度押すと外れる・開き直しても選びが残る
// ⑤ 「＋ 列の値で絞るパネルを足す…」→ 編集に入り、スライサーのパネル（行の段 1 つ）が組む所で開く
// ⑥ 帯が 1 段・「スライサー ▾」と暦の面が窓に収まる
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const errors = [];
const VIEW = parseView(process.argv[2] || "1728x1152");
const ask = (p, x) => p.evaluate(async (y) => (await fetch("/api/dashboard/query", TPA.json("POST", { panel: y }))).json(), x);
const total = (d) => { const c = (d.cells || []).find((x) => !x.r.length && !x.c.length); return c ? c.v[0] : null; };
const ans = (p, id) => p.evaluate((i) => Dashboard._state().answers[i] || null, id);
const settle = async (p) => { await sleep(500); await waitDash(p); await sleep(400); };
const inWin = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; }, sel);
const WIP = "src:wip";
const KW = { id: "kw", x: 0, y: 0, w: 4, h: 2, title: "", visual: "kpi", source: "work", body: { rows: [], cols: [], measures: [{ agg: "lots" }] }, period: { column: "@workday", kind: "yesterday" } };
const KP = { id: "kp", x: 4, y: 0, w: 4, h: 2, title: "", visual: "kpi", source: WIP, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } };
const SP = { id: "sp", x: 0, y: 2, w: 4, h: 6, title: "", visual: "slicer", source: WIP, body: { rows: [{ column: "仕掛区分" }], cols: [], measures: [{ agg: "lots" }] } };
const CP = { id: "cp", x: 4, y: 2, w: 8, h: 6, title: "", visual: "column", source: WIP, body: { rows: [{ column: "@equip" }], cols: [], measures: [{ agg: "lots" }] } };
const LAYOUT = { rows: 8, panels: [KW, KP, SP, CP] };

const app = await launch();
try {
  const p = await app.newPage("light", VIEW, { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p);
  await p.evaluate(() => { const m = JSON.parse(localStorage.getItem("tpa.dash.v1") || "{}"); delete m.slice; delete m.pick; delete m.bar; localStorage.setItem("tpa.dash.v1", JSON.stringify(m)); });
  await p.evaluate((l) => Dashboard._setLayout(l), LAYOUT); await settle(p);

  /* ① 日付 */
  const one = await p.evaluate(() => document.querySelectorAll("#dashSlicer .ds-bar").length === 1 && document.querySelector("#dashSlicer .ds-bar").getBoundingClientRect().height < 40);
  check("⑥ 帯は 1 段", one);
  check("⑥「スライサー ▾」が窓に収まる", await inWin(p, "#dashSlicer [data-ds-cfg]"));
  await p.click("[data-ds-date]"); await sleep(400);
  const under = await p.evaluate(() => { const c = document.querySelector("[data-ds-date]").getBoundingClientRect(), q = document.querySelector(".db-calpop"); if (!q) return null; const r = q.getBoundingClientRect(); return { dy: r.top - c.bottom, dx: r.left - c.left }; });
  check("① 暦が日付の札の真下に開く", under && under.dy >= 0 && under.dy < 16 && Math.abs(under.dx) < 40, under);
  check("⑥ 暦の面が窓に収まる", await inWin(p, ".db-calpop"));
  await p.click('[data-ds-day="2026-10-01"]'); await sleep(200);
  check("① 始めの日を押すと、終わりの日を待つ（まだ当たらない）", await p.$(".db-calpop") && !(await p.evaluate(() => (JSON.parse(localStorage.getItem("tpa.dash.v1") || "{}").slice || {})["b:standard"])));
  await p.click('[data-ds-day="2026-10-02"]'); await settle(p);
  const want = total(await ask(p, { ...KW, period: { column: "@workday", kind: "range", from: "2026-10-01", to: "2026-10-02" } }));
  const got = total(await ans(p, "kw"));
  check("① 終わりの日を押すと当たり、数がサーバーの日付の範囲の答えと同じ", want != null && got === want, { want, got });
  const bar = await p.evaluate(() => ({ date: document.querySelector("[data-ds-date]").textContent.trim(), dateOn: document.querySelector("[data-ds-date]").classList.contains("on"),
    chips: [...document.querySelectorAll("#dashSlicer [data-ds-period].on")].length, month: !!document.querySelector("#dashSlicer .ds-month.on"),
    badge: (document.querySelector('#dashGrid .db-p[data-id="kw"] .db-sbadge') || {}).textContent || "" }));
  check("① 札は「日付 10/1〜10/2」・期間の札と月の送りは選ばれていない", bar.date === "日付 10/1〜10/2" && bar.dateOn && !bar.chips && !bar.month, bar);
  check("① パネルの札も日付の言葉", /10\/1〜10\/2/.test(bar.badge), bar.badge);
  await p.click("[data-ds-date]"); await sleep(300);
  await p.fill("[data-ds-from]", "2026-09-28"); await p.dispatchEvent("[data-ds-from]", "change"); await p.fill("[data-ds-to]", "2026-09-30"); await settle(p);
  const want2 = total(await ask(p, { ...KW, period: { column: "@workday", kind: "range", from: "2026-09-28", to: "2026-09-30" } }));
  check("① 暦の打つ欄（から・まで）でも当たる", total(await ans(p, "kw")) === want2, { want2, got: total(await ans(p, "kw")) });

  /* ② 「スライサー ▾」 */
  const base = total(await ask(p, KW));
  await p.click("#dashSlicer [data-ds-cfg]"); await sleep(400);
  check("⑥「スライサー ▾」の面が窓に収まる", await inWin(p, ".db-cfgpop"));
  await p.click(".db-cfgpop [data-ds-on]"); await settle(p);
  const off = await p.evaluate(() => ({ hidden: document.querySelector("#dashSlicer").hidden, btn: (document.querySelector("#dashBar [data-ds-cfg]") || {}).textContent || "", layout: Dashboard._state().layout.slicer || null }));
  check("② 帯を OFF → 帯が消え、道具の行に「スライサー OFF」", off.hidden && /スライサー OFF/.test(off.btn), off);
  check("② 帯が OFF ならパネルに効かない（組んだままの数）", total(await ans(p, "kw")) === base, { base, got: total(await ans(p, "kw")) });
  check("② 見ているときの変更はこの PC だけ（ダッシュボードの組みは変わらない）", !off.layout, off.layout);
  if (!(await p.$(".db-cfgpop"))) { await p.click("#dashBar [data-ds-cfg]"); await sleep(300); }
  await p.click(".db-cfgpop [data-ds-on]"); await settle(p);
  check("② ON で帯と日付が戻る", !(await p.evaluate(() => document.querySelector("#dashSlicer").hidden)) && total(await ans(p, "kw")) === want2);
  if (!(await p.$(".db-cfgpop"))) { await p.click("#dashSlicer [data-ds-cfg]"); await sleep(300); }
  await p.click('.db-cfgpop [data-ds-part="equip"]'); await sleep(400);
  check("② 出す物の「設備」を外すと、帯から設備の札が消える", !(await p.$("#dashSlicer [data-ds-all]")) && !!(await p.$("#dashSlicer [data-ds-date]")));
  await p.click('.db-cfgpop [data-ds-part="equip"]'); await sleep(300);
  check("② 戻すと設備の札が出る", !!(await p.$("#dashSlicer [data-ds-all], #dashSlicer [data-ds-gsel]")));
  await p.keyboard.press("Escape"); await sleep(200);
  await p.evaluate(() => { const m = JSON.parse(localStorage.getItem("tpa.dash.v1") || "{}"); delete m.slice; localStorage.setItem("tpa.dash.v1", JSON.stringify(m)); });

  /* ④ パネルのスライサー */
  await p.evaluate((l) => Dashboard._setLayout(l), LAYOUT); await settle(p);
  const wantS = await ask(p, SP);
  const cards = await p.$$eval('#dashGrid .db-p[data-id="sp"] [data-db-spv]', (bs) => bs.map((b) => [b.dataset.dbSpv, b.querySelector(".sp-n").textContent.replace(/,/g, "")]));
  const lab = wantS.labels[0] || {}, sv = Object.fromEntries(wantS.cells.filter((c) => c.r.length === 1).map((c) => [String(lab[c.r[0]] ?? c.r[0]), String(c.v[0])]));
  check("④ 値の札の数と件数がサーバーと同じ", cards.length === Object.keys(sv).length && cards.every(([v, n]) => sv[v] === n), { cards, sv });
  const kp0 = total(await ans(p, "kp")), kw0 = total(await ans(p, "kw"));
  await p.click('#dashGrid .db-p[data-id="sp"] [data-db-spv="保留"]'); await settle(p);
  const inF = [{ column: "仕掛区分", op: "in", value: JSON.stringify(["保留"]) }];
  const wantK = total(await ask(p, { ...KP, filters: inF })), gotK = total(await ans(p, "kp"));
  check("④ 押すと同じデータのほかのパネルがその値で絞れる（サーバーの in の答えと同じ）", wantK === gotK && gotK !== kp0, { wantK, gotK, kp0 });
  const cpTot = (await ans(p, "cp")).cells.filter((c) => c.r.length === 1).reduce((a, c) => a + c.v[0], 0);
  check("④ グラフのパネルも絞れる（設備ごとの計＝絞った数）", cpTot === wantK, { cpTot, wantK });
  check("④ ほかのデータ（作業実績）のパネルは変わらない", total(await ans(p, "kw")) === kw0);
  const after = await p.$$eval('#dashGrid .db-p[data-id="sp"] [data-db-spv]', (bs) => bs.map((b) => [b.dataset.dbSpv, b.querySelector(".sp-n").textContent.replace(/,/g, ""), b.classList.contains("on")]));
  check("④ 自分は絞らない（札の件数はそのまま・選んだ札は濃い地）", after.every(([v, n]) => sv[v] === n) && after.filter((x) => x[2]).map((x) => x[0]).join() === "保留", after);
  const badge = await p.$eval('#dashGrid .db-p[data-id="kp"] .db-sbadge', (x) => x.textContent).catch(() => "");
  check("④ 絞られたパネルに「仕掛区分 保留」の札", /仕掛区分 保留/.test(badge), badge);
  await p.reload(); await waitDash(p); await p.evaluate((l) => Dashboard._setLayout(l), LAYOUT); await settle(p);
  check("④ 開き直しても選びが残る（この PC の見え方）", total(await ans(p, "kp")) === wantK, total(await ans(p, "kp")));
  await p.click('#dashGrid .db-p[data-id="sp"] [data-db-spv="保留"]'); await settle(p);
  check("④ もう一度押すと外れる", total(await ans(p, "kp")) === kp0, { got: total(await ans(p, "kp")), kp0 });

  /* ③ 編集中の OFF・⑤ パネルを足す */
  await p.click("[data-db-editmode]"); await sleep(400);
  await p.click("#dashBar [data-ds-cfg]"); await sleep(300);
  await p.click(".db-cfgpop [data-ds-on]"); await sleep(400);
  check("③ 編集中に帯を OFF → ダッシュボードの組み（layout.slicer.off）に入る", (await p.evaluate(() => (Dashboard._state().layout.slicer || {}).off)) === true);
  if (!(await p.$(".db-cfgpop"))) { await p.click("#dashBar [data-ds-cfg]"); await sleep(300); }
  await p.click(".db-cfgpop [data-ds-addpanel]"); await sleep(1200); await settle(p);
  const ed = await p.evaluate(() => { const st = Dashboard._state(); const q = st.layout.panels[st.layout.panels.length - 1]; return { v: q.visual, rows: q.body.rows, open: !!document.querySelector("#dbEditor") }; });
  check("⑤「＋ 列の値で絞るパネルを足す…」でスライサーのパネル（行の段 1 つ）が組む所で開く", ed.v === "slicer" && ed.rows.length === 1 && ed.open, ed);
  check("頁の誤りが無い", !errors.length, errors);
} finally { await app.close(); }
console.log(fails.length ? `NG ${fails.length} 件` : "OK（すべて合いました）");
process.exit(fails.length ? 1 : 0);
