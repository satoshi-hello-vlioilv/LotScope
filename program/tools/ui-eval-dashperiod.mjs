// 評価関数（開発用）: ダッシュボードの期間の種類（版 3.69.0。利用者の要望 2026-11-04 の 4）。
//   node program/tools/ui-eval-dashperiod.mjs [--view 1728x1152]
// 組む所の「期間」で、今日を含まない n 日・直近 n か月（今月を含む）・今年・昨年・直近 n 年（今年を含む）を選べ、
// パネルの答えの範囲（サーバーが決めた from〜to）が、その元の「今日」から JS で別に数えた範囲と同じか。
// 数の欄の単位（日・か月・年）と上限・種類を替えたときの数・パネルの添え書きの言葉・パネルを絞る面にも同じ種類が並ぶか。
// 件数がサーバーへ同じ組みを直接問い合わせた答えと同じか。頁の誤りが無いこと。全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), panel);
const iso = (d) => d.toISOString().slice(0, 10);
const day = (s) => new Date(`${s}T00:00:00Z`);
const add = (s, n) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** その元の今日（today）から、種類ごとの正しい範囲（サーバーとは別に数える） */
function want(kind, n, today) {
  const [y, m] = [+today.slice(0, 4), +today.slice(5, 7)];
  if (kind === "days_before") return [add(today, -n), add(today, -1)];
  if (kind === "months") { const t = y * 12 + (m - 1) - (n - 1); return [`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`, today]; }
  if (kind === "this_year") return [`${y}-01-01`, today];
  if (kind === "last_year") return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  if (kind === "years") return [`${y - n + 1}-01-01`, today];
  return null;
}

const viewArg = process.argv.includes("--view") ? process.argv[process.argv.indexOf("--view") + 1] : "1728x1152";
const app = await launch();
const errors = [];
try {
  const p = await app.newPage("light", parseView(viewArg), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p); await sleep(1500);
  const panels = (await p.evaluate(() => Dashboard._state().layout)).panels;
  const target = panels.find((x) => x.id === "workTotal") || panels.find((x) => x.source === "work" && x.visual === "kpi");
  check("作業実績の数字のパネルがある", !!target, panels.map((x) => [x.id, x.source, x.visual]));
  const set = (sel, v) => p.evaluate(([q, x]) => { const el = document.querySelector(q); el.value = x; el.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
  await p.click("[data-db-editmode]"); await sleep(400);
  await p.focus(P(target.id)); await p.keyboard.press("Enter"); await p.waitForSelector("#deFields .pv-f"); await sleep(800);
  const kinds = await p.$$eval("[data-de-pkind] option", (os) => os.map((o) => [o.value, o.textContent]));
  for (const k of ["days_before", "months", "this_year", "last_year", "years"]) check(`組む所の期間に「${(kinds.find((x) => x[0] === k) || [, "（無い）"])[1]}」がある`, kinds.some((x) => x[0] === k), kinds);
  // 今日（その元の）: 「今日」を選んだ答えの範囲
  await set("[data-de-pkind]", "today"); await sleep(1500);
  const ansOf = async () => { await sleep(1800); return p.evaluate((id) => Dashboard._state().answers[id], target.id); };
  const a0 = await ansOf();
  const today = a0 && a0.period && a0.period.ranges && a0.period.ranges[0] && a0.period.ranges[0].from;
  check("前提: 今日の範囲が答えにある", !!today, a0 && a0.period);
  const cases = [["days_before", 5, "日"], ["months", 2, "か月"], ["this_year", 0, ""], ["last_year", 0, ""], ["years", 2, "年"]];
  let prevKind = "today";
  for (const [kind, n, unit] of cases) {
    await set("[data-de-pkind]", kind); await sleep(500);
    const box = await p.evaluate(() => { const i = document.querySelector("[data-de-pn]"); return i ? { max: i.max, v: i.value, after: (i.nextSibling && i.nextSibling.textContent || "").trim() } : null; });
    if (unit) {
      check(`${kind}: 数の欄の単位は「${unit}」`, box && box.after.startsWith(unit), box);
      const def = { days_before: 7, months: 3, years: 3 }[kind];
      if (prevKind === "days_before" && kind === "months") check(`${kind}: 単位が替わると数は既定（${def}）に戻る`, box && +box.v === def, box);
      await set("[data-de-pn]", String(n));
    } else check(`${kind}: 数の欄が無い`, !box, box);
    prevKind = kind;
    const a = await ansOf();
    const r = a && a.period && a.period.ranges && a.period.ranges[0];
    const w = want(kind, n, today);
    check(`${kind}${n ? ` ${n}` : ""}: 答えの範囲 ${r && r.from}〜${r && r.to} が、今日 ${today} から数えた ${w.join("〜")} と同じ`, r && r.from === w[0] && r.to === w[1], { r, w });
    const panel = await p.evaluate((id) => Dashboard._state().layout.panels.find((x) => x.id === id), target.id);   // 組んでいる間は組む所の中身がそのまま入る
    check(`${kind}: パネルの期間が組む所の選びのとおり`, panel.period && panel.period.kind === kind, panel.period);
    const direct = await ask(p, panel);
    const cnt = (x) => JSON.stringify((x.cells || []).map((c) => c.v));
    check(`${kind}: 件数がサーバーへ直接問い合わせた答えと同じ`, cnt(direct) === cnt(a), { direct: cnt(direct), a: cnt(a) });
    const sub = await p.$eval(P(target.id), (el) => el.textContent);
    const word = { days_before: `直近 ${n} 日（今日を除く）`, months: `直近 ${n} か月`, this_year: "今年", last_year: "昨年", years: `直近 ${n} 年` }[kind];
    check(`${kind}: パネルに「${word}」と出る`, sub.includes(word), sub.slice(0, 300));
  }
  // 数の上限（サーバーと同じ）
  await set("[data-de-pkind]", "years"); await sleep(300); await set("[data-de-pn]", "99"); await sleep(300);
  const yv = await p.$eval("[data-de-pn]", (i) => [i.max, i.value]);
  check("直近 n 年の上限は 10 年（サーバーと同じ）", yv[0] === "10" && yv[1] === "10", yv);
  // パネルを絞る面にも同じ種類が並ぶ
  await p.evaluate(() => { const b = document.querySelector("[data-de-cancel]") || [...document.querySelectorAll("#dashEditor button")].find((x) => /やめる/.test(x.textContent)); b && b.click(); }); await sleep(600);
  // 編集を終えて（変えた所は捨てる）見る形に戻り、パネルの「絞る」から開く
  await p.evaluate(() => document.querySelector("[data-db-leave]")?.click()); await sleep(400);
  await p.evaluate(() => document.querySelector("[data-db-discard]")?.click()); await sleep(1500);
  await p.evaluate((s) => document.querySelector(`${s} [data-db-filter]`).click(), P(target.id)); await p.waitForSelector(".df-perb, [data-sec=per]"); await sleep(600);
  await p.evaluate(() => { const h = document.querySelector('[data-sec="per"] .df-sech'); h && h.click(); }); await sleep(500);
  const fk = await p.$$eval("[data-df-pkind] option", (os) => os.map((o) => o.value));
  check("パネルを絞る面の期間にも新しい種類が並ぶ", ["days_before", "months", "this_year", "last_year", "years"].every((k) => fk.includes(k)), fk);
  check("頁の誤りが無い", errors.length === 0, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK すべて");
process.exit(fails.length ? 1 : 0);
