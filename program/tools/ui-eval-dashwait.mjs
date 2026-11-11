// 評価関数（開発用。版 3.97.0。利用者の要望 2026-11-11: 「くるくるとバーの両方出るのがうっとうしい。どちらかでよくて、何をしているか・どのデータか・
// どの計算か・どのくらい待つか が分かると、待つ長さと処理が適切かの判断の材料になる」。2026-11-dashwait の 3 回目の採点で決めた I2）。
//   node program/tools/ui-eval-dashwait.mjs [1728x1152,1536x864,1280x720]
// 開発用サーバー（ui_server.py）を TPA_UI_SLOW_FILE で遅くし、本物の段の道（GET /api/dashboard/progress）で待ちを起こして、刻みごとに確かめる:
// 1. 印は 1 つ: 待っているパネルは題の頭の点が円になる（回る印 .db-spin・上の縁の進みの線・道具の行の棒は無い）。済めば元の点に戻り、題の字の位置は待つ前と同じ
// 2. 円と字は同じ数: 字の n/m（読む 7/11 台・まとまり 1/2 済み・ガント n/11 台）と円の量（--f）が刻みごとに同じ。n/m の無い段は輪だけ
// 3. 段の言葉: 作業実績を読む・合わせた表を組む・稼働のガントを組む（どのデータ・どの計算）。前回が無い初回は経過の秒、前回があれば「あと約 n 秒」「まもなく」と
//    説明に「前回 n.n 秒」、前回より長くかかれば「前回 n.n 秒より長くかかっています」と内側に茶色の輪・道具の行に「前回より長い n 枚」
// 4. ちらつかない: 待っている間、字の要素を作り直さない（同じ要素のまま中身だけ替える）
// 5. 狭くても切れない: 3 つの大きさで、字が添え書きの段・パネルからはみ出さず、最後まで n/m を残す。並んだ同じ形のパネル（前日・今月）は同じ言い方
// 6. 道具の行は「n / m 枚 済み・待っている k 枚」の字で、切れない
// 7. 写している間（答えを写し中の形にする）: パネルは「写し待ち」と「写した 5/11 台」（合わせた表も 5/11。前は仕掛の写しまで足して 6/12）・
//    道具の行に写しているデータの札が 1 つ（同じ円・同じ 5/11）。答えに copy の無い前の版の答えでも 5/11
// 8. Python に任せた問い合わせ（段 python）は「Python が数えています」と経過の秒だけ（n/m を推して作らない・円は輪だけ）
// 9. 順番待ち（Python はパネルを 1 つずつ数える）・写しを待つ間は前回と比べない（「前回より長くかかっています」「あと約」「まもなく」を出さない）。
//    前回と比べる時間・覚える前回は、数えている段にいた時間だけ（作った後の採点で見つけた割れ）
// 10. 本物の写し（開発用サーバーで共有から写す速さを落とす）: 道具の行の写す札に「共有から写しています n/m 台」と、速さが分かれば「あと約 n 秒」
//    （分かるまでは経過の秒）・札の説明に MB と MB/秒。札の n/m とパネルの「写した n/m」が同じ（作った後の採点: 写している間、あとどのくらいがどこにも出なかった）
// 全部合えば終了コード 0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SLOW = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tpa-dashwait-")), "slow.json");
process.env.TPA_UI_SLOW_FILE = SLOW;
process.env.TPA_UI_BYPASS_CSP = "1";
fs.writeFileSync(SLOW, "{}");
const { launch, parseView, sleep, waitDash } = await import("./ui-harness.mjs");
const slow = (o) => fs.writeFileSync(SLOW, JSON.stringify(o));

let n = 0, bad = 0;
const check = (name, ok, got) => { n++; if (!ok) { bad++; console.log(`NG  ${name}\n    ${JSON.stringify(got).slice(0, 900)}`); } else console.log(`OK  ${name}`); };

const OPS = { rows: 8, panels: [
  { id: "k1", x: 0, y: 0, w: 6, h: 1, title: "前日の実績本数", visual: "kpi", source: "work", period: { column: "@workday", kind: "yesterday" }, fmt: { kmeta: "row" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } },
  { id: "k2", x: 6, y: 0, w: 6, h: 1, title: "仕掛ロット数", visual: "kpi", source: "src:wip", fmt: { kmeta: "row" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } },
  { id: "gantt", x: 0, y: 1, w: 12, h: 4, title: "", visual: "gantt", source: "work", period: { column: "@workday", kind: "days", n: 4 }, ops: { color: "作業区分" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } },
  { id: "abc", x: 0, y: 5, w: 12, h: 3, title: "", visual: "abc", source: "work", ops: { cls: ["合金", "調質"] }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } }] };

/** 頁の中: 待っているパネルの様子（字・円・説明・字の要素の通し番号・はみ出し・題の位置） */
function sample() {
  window.__dwN = window.__dwN || 0;
  const pct = (el) => parseFloat((el && el.style.getPropertyValue("--f")) || "0");
  const panels = [...document.querySelectorAll("#dashGrid .db-p")].map((p) => {
    const dot = p.querySelector(".db-ph .db-dot"), st = p.querySelector(".db-wst"), c = p.querySelector(".db-wcenter:not([hidden])");
    const host = st && st.parentElement, pb = p.querySelector(".db-pb"), h3 = p.querySelector(".db-ph h3");
    const node = st || c;
    if (node && !node.__dw) node.__dw = ++window.__dwN;
    let out = false;
    if (st) {
      const hr = host.getBoundingClientRect(), sr = st.getBoundingClientRect(), pr = p.getBoundingClientRect();
      out = host.scrollWidth > host.clientWidth + 1 || sr.right > pr.right + 0.5 || (pb.contains(host) && hr.bottom > pb.getBoundingClientRect().bottom + 1);
    }
    return { id: p.dataset.id, wait: p.classList.contains("is-wait"), busy: !!p.dataset.wait, text: (st || c || {}).textContent || "",
      pie: !!(dot && dot.classList.contains("is-pie")), ring: !!(dot && dot.classList.contains("is-ring")), over: !!(dot && dot.classList.contains("is-over")),
      f: pct(dot), cf: pct(c && c.querySelector(".db-dot")), title: (dot && dot.title) || "", node: node ? node.__dw : 0, out,
      spin: !!p.querySelector(".db-spin"), line: getComputedStyle(p, "::before").content, own: !!p.querySelector(".db-dot.is-own"),
      h3: h3 ? Math.round(h3.getBoundingClientRect().left * 2) / 2 : null };
  });
  const b = document.querySelector("#dashBar .db-wbar");
  return { panels, bar: b && !b.hidden ? b.textContent : "", barFit: !b || b.scrollWidth <= b.clientWidth + 1, barOld: !!document.querySelector("#dashBar .db-wpg, #dashBar .db-witem"),
    chips: [...document.querySelectorAll("#dashBar .db-wcopy")].map((x) => ({ text: x.textContent, f: pct(x.querySelector(".db-dot")) })) };
}
/** 字の n/m（「7/11 台」「1/2 済み」「写した 5/11 台」）→ 割合（無ければ null） */
const ratio = (t) => { const m = /(\d+)\/(\d+)/.exec(t); return m ? Math.round((+m[1] / +m[2]) * 100) : null; };

/** 待ちを起こして終わるまで刻みごとに見る（every: 刻みごとの見る所） */
async function watch(page, label, act) {
  const ticks = [];
  await act();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await sleep(250);
    const s = await page.evaluate(sample);
    ticks.push(s);
    if (ticks.length > 4 && !s.panels.some((p) => p.busy)) break;
  }
  return ticks;
}

/** 刻みごとの確かめ（1・2・4・5・6） */
function checkTicks(v, label, ticks, steady) {
  const waits = ticks.flatMap((s) => s.panels.filter((p) => p.wait).map((p) => ({ ...p, bar: s.bar })));
  check(`${v} ${label}: 待ちが見えた`, waits.length > 0, ticks.length);
  check(`${v} ${label}: 印は題の頭の円 1 つ（回る印・上の縁の線・道具の行の棒なし）`,
    waits.every((p) => p.pie && !p.spin && (p.line === "none" || p.line === "normal")) && ticks.every((s) => !s.barOld), waits.filter((p) => !p.pie || p.spin).slice(0, 3));
  const mism = waits.filter((p) => { const r = ratio(p.text); return r == null ? !(p.ring || p.f === 0) && !p.over : Math.abs(r - (p.cf || p.f)) > 1; });
  check(`${v} ${label}: 円の量と字の n/m が同じ数（n/m の無い段は輪だけ）`, mism.length === 0, mism.slice(0, 4).map((p) => [p.id, p.text, p.f, p.cf, p.ring]));
  // 字の要素を作り直さない: 待っている 1 回の間に、パネルごとの字の要素は 1 つ（数字のパネルで添え書きを描き直す時の 1 回までは許す）
  const per = {};
  waits.forEach((p) => { if (p.node) (per[p.id] = per[p.id] || new Set()).add(p.node); });
  check(`${v} ${label}: 字の要素を刻みごとに作り直さない（ちらつかない）`, Object.values(per).every((x) => x.size <= 2), Object.fromEntries(Object.entries(per).map(([k, x]) => [k, x.size])));
  const qbad = waits.filter((p) => /順番待ち|写し待ち|写した/.test(p.text) && /前回.*長|あと約|まもなく/.test(p.text));
  check(`${v} ${label}: 順番待ち・写しを待つ間は前回と比べない（前回より長い・あと約・まもなく を出さない）`, qbad.length === 0, qbad.slice(0, 3).map((p) => [p.id, p.text]));
  const outs = waits.filter((p) => p.out);
  check(`${v} ${label}: 字が添え書きの段・パネルからはみ出さない`, outs.length === 0, outs.slice(0, 3).map((p) => [p.id, p.text]));
  const lost = waits.filter((p) => p.f > 0 && p.text && !/\d+\/\d+/.test(p.text));
  check(`${v} ${label}: 縮めても n/m を残す`, lost.length === 0, lost.slice(0, 3).map((p) => [p.id, p.text]));
  const bars = ticks.filter((s) => s.bar);
  check(`${v} ${label}: 道具の行は「n / m 枚 済み・待っている k 枚」の字で切れない`, bars.length > 0 && bars.every((s) => /\d+ \/ \d+ 枚 済み・待っている \d+ 枚/.test(s.bar) && s.barFit), bars.slice(-1).map((s) => [s.bar, s.barFit]));
  if (steady) {
    // 点のあるパネルは、点（9px）と同じ場所に円（16px）を置くので題が動かない。点の無い合わせた表は、待っている間だけ円を足す（題が円の分だけ右へ）
    const shift = waits.filter((p) => { const s0 = steady.panels.find((x) => x.id === p.id); return !p.own && s0 && s0.h3 != null && p.h3 != null && Math.abs(s0.h3 - p.h3) > 0.5; });
    check(`${v} ${label}: 円にしても題の字の位置は待つ前と同じ（点のあるパネル）`, shift.length === 0, shift.slice(0, 3).map((p) => [p.id, p.h3]));
  }
  const end = ticks[ticks.length - 1];
  check(`${v} ${label}: 済めば待ちの字が消え、円は元の点に戻る`, !end.bar && end.panels.every((p) => !p.wait && !p.pie && !p.own && !p.text), end.panels.filter((p) => p.wait || p.pie || p.text));
  return waits;
}

const VIEWS = (process.argv[2] || "1728x1152,1536x864,1280x720").split(",");
const app = await launch();
try {
  for (const v of VIEWS) {
    if (v === VIEWS[0]) {
      // ---- 本物の写し: 作業実績の写しは、最初にダッシュボードを開いたときに始まる。共有から写す速さを 1 台 8 KB/秒（約 9 秒）に落として開く
      slow({ copy: 8000 });
      const p0 = await app.newPage("light", parseView(v));
      await p0.click("#tabDash");
      const ct = [];
      for (let t0 = Date.now(); Date.now() - t0 < 45000;) {
        await sleep(400);
        const s = await p0.evaluate(() => ({ chips: [...document.querySelectorAll("#dashBar .db-wcopy")].map((x) => ({ text: x.textContent, title: x.title })),
          panels: [...document.querySelectorAll("#dashGrid .db-p")].map((p) => ({ id: p.dataset.id, text: (p.querySelector(".db-wst, .db-wcenter:not([hidden])") || {}).textContent || "" })) }));
        ct.push(s);
        if (ct.length > 5 && !s.chips.length && !s.panels.some((p) => /写/.test(p.text))) break;
      }
      const chips = ct.flatMap((s) => s.chips);
      check(`${v} 本物の写し: 道具の行に写す札（共有から写しています n/m 台）`, chips.length > 0 && chips.every((c) => /共有から写しています \d+\/\d+ 台・/.test(c.text)), chips.slice(0, 2));
      check(`${v} 本物の写し: 速さが分かれば札に「あと約 n 秒」か「まもなく」`, chips.some((c) => /あと約 \d+ 秒|まもなく/.test(c.text)), chips.map((c) => c.text).slice(-4));
      check(`${v} 本物の写し: 速さが分かるまでは経過の秒（推さない）`, chips.every((c) => /あと約|まもなく|\d+\.\d 秒/.test(c.text)), chips.map((c) => c.text).slice(0, 3));
      check(`${v} 本物の写し: 札の説明に MB と MB/秒`, chips.some((c) => / MB・[\d.]+ MB\/秒/.test(c.title)), chips.map((c) => c.title).slice(-1));
      const same = ct.filter((s) => s.chips.length).every((s) => { const m = /(\d+)\/(\d+) 台/.exec(s.chips[0].text);
        return s.panels.filter((p) => /写した/.test(p.text)).every((p) => p.text.includes(`${m[1]}/${m[2]}`)); });
      check(`${v} 本物の写し: 札の n/m とパネルの「写した n/m」が同じ`, same, ct.filter((s) => s.chips.length).slice(-2));
      const pq = ct.flatMap((s) => s.panels).filter((p) => /写し|写した/.test(p.text) && /前回.*長|あと約|まもなく/.test(p.text));
      check(`${v} 本物の写し: パネルの写し待ちは前回と比べず、あとどのくらいは札だけ`, pq.length === 0, pq.slice(0, 3));
      // 1 台も写し終えていない間は数が出ていない。「いまの数は写した 0/11 台の分」と言わない（版 3.97.0 の主のセッションの確かめで見つけた食い違い）
      const z = ct.flatMap((s) => s.panels).filter((p) => /写した 0\//.test(p.text));
      check(`${v} 本物の写し: 0 台のときは「いまの数は」と言わない`, z.every((p) => !/いまの数は/.test(p.text)), z.slice(0, 3));
      slow({});
      await waitDash(p0, 60000).catch(() => {});
      await p0.close();
    }
    slow({});
    const page = await app.newPage("light", parseView(v), { screen: "dash" });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const std = await page.evaluate(() => Dashboard._state().layout);
    const steady = await page.evaluate(sample);
    // ---- 標準: 数え直し（控えを使わない＝ファイルが変わった後）・初回は前回が無い
    slow({ open: 0.2, nocache: true });
    const w1 = checkTicks(v, "数え直し（前回なし）", await watch(page, "a", () => page.click("[data-db-refresh]")), steady);
    const read = w1.filter((p) => /作業実績を読む|読む/.test(p.text) && /\d+\/1[01]/.test(p.text));
    check(`${v} 段の言葉: 作業実績を 1 台ずつ読む（n/11 台）`, read.length > 0, w1.slice(0, 6).map((p) => p.text));
    check(`${v} 段の言葉: 合わせた表を組む（まとまり k/2 済み）`, w1.some((p) => p.id === "board" && /組む/.test(p.text) && /\d\/2 済み|\d\/2$/.test(p.text)), w1.filter((p) => p.id === "board").slice(0, 3).map((p) => p.text));
    // 前回はサーバーが組みごとに覚える（同じサーバーで続けて撮る 2 つ目の大きさからは、もう前回がある）
    if (v === VIEWS[0]) check(`${v} 前回が無い初回は「あと約」を出さず経過の秒`, w1.every((p) => !/あと約|まもなく/.test(p.text)) && w1.some((p) => /\d+\.\d 秒/.test(p.text) || p.text), w1.slice(0, 4).map((p) => p.text));
    // ---- 2 回目: 同じ遅さ → 前回があるので「あと約 n 秒」「まもなく」・説明に前回 n.n 秒
    await sleep(400);
    const tw2 = await watch(page, "b", () => page.click("[data-db-refresh]"));
    const w2 = checkTicks(v, "数え直し（前回あり）", tw2, steady);
    check(`${v} 前回があれば「あと約 n 秒」か「まもなく」・説明に「前回 n.n 秒」`, w2.some((p) => /あと約 \d+ 秒|まもなく/.test(p.text)) && w2.some((p) => /前回 \d+\.\d 秒/.test(p.title)), w2.slice(0, 6).map((p) => [p.text, p.title]));
    // 同じ刻みで並んだ同じ形のパネル（前日・今月）は、省いた段が同じ（データの名前・あとどのくらい・前回の有無がそろう）
    const feat = (t) => [/実績を/.test(t), /（前回/.test(t), /あと約|まもなく|\d+\.\d 秒|前回より長/.test(t)].join("");
    const pairs = [];
    for (const s of tw2) { const a = s.panels.find((p) => p.id === "workTotal"), b = s.panels.find((p) => p.id === "workMonth");
      if (a && b && a.wait && b.wait && a.text && b.text && !/順番待ち/.test(a.text + b.text)) pairs.push([a.text, b.text]); }
    check(`${v} 並んだ同じ形のパネル（前日・今月）は同じ段まで省く`, pairs.every(([a, b]) => feat(a) === feat(b)), pairs.filter(([a, b]) => feat(a) !== feat(b)).slice(0, 3));
    // ---- 3 回目: 前より遅い → 前回より長い（茶色の輪と言い替え・道具の行）
    slow({ open: 0.55, nocache: true });
    await sleep(400);
    const t3 = await watch(page, "c", () => page.click("[data-db-refresh]"));
    const w3 = checkTicks(v, "数え直し（前回より長い）", t3, steady);
    check(`${v} 前回より長くかかれば言い替え（色だけにしない）と内側の茶色の輪`, w3.some((p) => p.over && /前回 \d+\.\d 秒より長く|前回より長い/.test(p.text)), w3.filter((p) => p.over).slice(0, 3).map((p) => p.text));
    check(`${v} 道具の行に「前回より長い n 枚」`, t3.some((s) => /前回より長い \d+ 枚/.test(s.bar)), t3.map((s) => s.bar).filter(Boolean).slice(-2));
    // ---- 稼働のガント・ABC 分析: どの計算かを言う
    slow({});
    await page.evaluate((l) => Dashboard._setLayout(l), OPS); await sleep(500); await waitDash(page, 60000); await sleep(500);
    const steadyOps = await page.evaluate(sample);
    slow({ ops: 0.25, nocache: true });
    const w4 = checkTicks(v, "稼働のガント・ABC", await watch(page, "d", () => page.click("[data-db-refresh]")), steadyOps);
    check(`${v} 段の言葉: 稼働のガントを組む n/11 台（円も同じ数）`, w4.some((p) => p.id === "gantt" && /ガントを組む|組む/.test(p.text) && /\d+\/11/.test(p.text)), w4.filter((p) => p.id === "gantt").slice(0, 3).map((p) => p.text));
    check(`${v} 段の言葉: ABC 分析は設備を読む n/11 か品種を並べる（n/m なしは輪だけ）`, w4.some((p) => p.id === "abc" && /読む \d+\/11|ABC 分析の品種を並べる|並べる|順番待ち/.test(p.text)), w4.filter((p) => p.id === "abc").slice(0, 3).map((p) => p.text));
    slow({});
    // ---- 写している間（答えを写し中の形にする: 作業実績 11 台のうち 5 台を写し終えた）。copy を付ける今の答えと、付けない前の版の答え
    for (const withCopy of [true, false]) {
      await page.evaluate((l) => Dashboard._setLayout(l), std); await sleep(400); await waitDash(page, 60000); await sleep(300);
      const names = ["CR2", "L-2", "LS3", "CAL", "HOT", "SL1"];
      await page.route("**/api/dashboard/query**", async (route) => {
        let id = ""; try { id = route.request().postDataJSON().panel.id; } catch (_) { /* 本文なし */ }
        if (!["workTotal", "workMonth", "workDays", "board"].includes(id)) return route.continue();
        const resp = await route.fetch(); const j = await resp.json();
        const cut = (a) => { if (!a || !Array.isArray(a.mirrors) || a.mirrors.length < 3) return null;
          a.mirrors = a.mirrors.slice(0, 5); a.failed = (a.failed || []).filter((f) => !names.includes(f.name)).concat(names.map((x) => ({ name: x, kind: "copying", error: "共有から写しています", status: 503 })));
          const c = { name: a.sourceName || "作業実績", done: 5, total: 11 }; if (withCopy) a.copy = c; return c; };
        if (Array.isArray(j.groups)) { const c = j.groups.map(cut).find(Boolean); if (withCopy && c) j.copy = c; } else cut(j);
        await sleep(200);
        return route.fulfill({ response: resp, json: j });
      });
      await page.evaluate((l) => Dashboard._setLayout(l), std);
      await sleep(3500);
      const s = await page.evaluate(sample);
      await page.unroute("**/api/dashboard/query**");
      const tag = withCopy ? "写している間" : "写している間（copy の無い前の版の答え）";
      const cp = s.panels.filter((p) => ["workTotal", "workMonth", "workDays", "board"].includes(p.id));
      check(`${v} ${tag}: 4 枚とも写し待ちで「写した 5/11」（合わせた表も 6/12 でない）`, cp.every((p) => p.wait && /写し/.test(p.text) && /5\/11/.test(p.text) && !/6\/12/.test(p.text)), cp.map((p) => [p.id, p.text]));
      check(`${v} ${tag}: 円も 5/11（45%）`, cp.every((p) => Math.abs(p.f - 45) <= 1), cp.map((p) => [p.id, p.f]));
      check(`${v} ${tag}: 道具の行に写しているデータの札が 1 つ（同じ円・同じ 5/11）・切れない`, s.chips.length === 1 && /共有から写しています 5\/11 台/.test(s.chips[0].text) && Math.abs(s.chips[0].f - 45) <= 1 && s.barFit, [s.chips, s.bar]);
      await sleep(2000); await page.evaluate((l) => Dashboard._setLayout(l), std); await waitDash(page, 60000).catch(() => {}); await sleep(300);
    }
    // ---- Python に任せた問い合わせ（段 python）: 経過だけ・n/m を作らない
    slow({ open: 0.25, nocache: true });
    await page.route("**/api/dashboard/progress**", async (route) => {
      const asks = new URL(route.request().url()).searchParams.get("ask").split(",");
      return route.fulfill({ json: { asks: Object.fromEntries(asks.map((a) => [a, { stage: "python", elapsedMs: 1500, prevMs: null, done: false }])) } });
    });
    await page.click("[data-db-refresh]"); await sleep(1500);
    const sp = await page.evaluate(sample);
    await page.unroute("**/api/dashboard/progress**");
    const py = sp.panels.filter((p) => p.wait);
    check(`${v} Python に任せた形は「Python が数えています」と経過の秒だけ（n/m なし・円は輪だけ）`, py.length > 0 && py.every((p) => /Python が数えています/.test(p.text) && !/\d+\/\d+/.test(p.text) && p.ring), py.map((p) => [p.id, p.text, p.ring]));
    slow({});
    await waitDash(page, 60000).catch(() => {});
    check(`${v} 頁の誤りが無い`, errs.length === 0, errs);
    await page.close();
  }
} finally {
  await app.close();
  fs.rmSync(path.dirname(SLOW), { recursive: true, force: true });
}
console.log(bad ? `NG ${n} 件中 ${bad} 件が違う` : `OK（${n} 件）`);
process.exit(bad ? 1 : 0);
