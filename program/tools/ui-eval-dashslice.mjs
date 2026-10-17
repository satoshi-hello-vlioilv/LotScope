// 評価関数（開発用）: ダッシュボードの版 3.41.0（利用者の要望 2026-10）。
//   node program/tools/ui-eval-dashslice.mjs
// ① 折れ線（設備 3 つの系列）で、数値ラベルがどの系列にも付く（系列の色の字）・系列ごとに「出さない」「下」「破線」が効く・書式の見本の色＝描いた線の色
// ② 組む所の外枠がはみ出さない（中の物が外枠の下に出ない）・どの入力に焦点が移っても外枠が送られない（見出しの やめる・当てる が隠れない）
// ③ 保存: 押してすぐ「保存しています…」・往復は書く 1 回だけ（全部を読み直さない）・中身が同じなら、パネルを描き直さない。組み替え（動かす）で描き直すのは動かしたパネルだけ
// ④ 合わせた表の行を引いて並べる: 下へ引いても上へ引いても、線の出た所（指の高さが札の真ん中より上ならその札の前）に入る・ゴーストと線が出る・Esc でやめる。
//    設備グループの見出し（ライン別）で、表と行の札がグループごとにまとまる。グループの見出しを引くと、グループごと並ぶ
// ⑤ 四隅のどの角でも大きさが変わる（向かいの角は動かない）・Alt＋Shift＋矢印で左上の角
// ⑥ スライサー: 先月＋L ラインで、効くパネルの数がサーバーへ同じ組み（期間＝先月・設備＝L ラインの設備の計）を問い合わせた答えと合う。
//    期間を組んでいない仕掛のパネルは期間が変わらない・「スライサーに従わない」パネルは変わらない・◀ で 2 か月前（名前が月）・外すと戻る・開き直しても覚えている。
//    スライサーは道具の行の下の細い帯（3 回目で決めた C2）。1280×720 でも 1728 と同じ札の形で 1 段に収まり、題が切れない。編集のときは帯を出さない。パネルの見出しに効いている印
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const ask = (p, panel) => p.evaluate(async (x) => (await fetch("/api/dashboard/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: x }) })).json(), panel);
const total = (d) => (d.cells.find((c) => !c.r.length && !c.c.length) || { v: [null] }).v[0];
const state = (p) => p.evaluate(() => Dashboard._state());
const errors = [];

async function openEditor(p, id) {
  if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(300); }
  await p.focus(P(id)); await p.keyboard.press("Enter");
  await p.waitForSelector(id === "board" ? "#deBoard .de-rowi[data-de-row]" : "#deFields .pv-f"); await waitDash(p); await sleep(300);
}
async function leaveEdit(p) {
  await p.click("[data-de-cancel]").catch(() => {}); await sleep(300);
  await p.click("[data-db-leave]").catch(() => {}); await sleep(300);
  if (await p.$("[data-db-discard]")) { await p.click("[data-db-discard]"); await sleep(500); }
  await waitDash(p);
}

const app = await launch();
try {
  const p = await app.newPage("light", parseView("1728x1152"), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));

  // ① 系列ごとの数値ラベル
  await openEditor(p, "workDays");
  await p.click("[data-de-eqopen]"); await p.waitForSelector("[data-ck-deq]"); await sleep(300);
  for (const n of ["CR1", "L-1", "L-2"]) await p.evaluate((n) => document.querySelector(`[data-ck-deq="${n}"]`).click(), n);
  await p.click("[data-de-eqopen]"); await sleep(500); await waitDash(p);
  await p.evaluate(() => { if (!document.querySelector('[data-de-vis="line"]')) document.querySelector("[data-de-formmore]").click(); document.querySelector('[data-de-vis="line"]').click(); });
  await sleep(700); await waitDash(p);
  await p.evaluate(() => document.querySelector('input[data-de-flabels][value="top"]').click()); await sleep(700); await waitDash(p);
  const lab = () => p.evaluate((sel) => {
    const svg = document.querySelector(`${sel} .dp-chart svg`), lines = [...svg.querySelectorAll("path[fill=none]")].map((x) => ({ c: x.getAttribute("stroke"), dash: x.getAttribute("stroke-dasharray") }));
    const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
    const by = {}; svg.querySelectorAll("text.pv-vl").forEach((t) => { const c = t.style.fill || ""; by[c] = (by[c] || 0) + 1; });
    const sw = Object.fromEntries([...document.querySelectorAll("#dbEditor [data-de-scol]")].map((i) => [i.dataset.deScol, i.value]));
    return { lines: lines.map((l) => ({ ...l, n: by[rgb(l.c)] || 0 })), sw, opts: [...document.querySelectorAll("input[data-de-flabels]")].map((x) => x.value) };
  }, P("workDays"));
  let a = await lab();
  check("① 線の形の数値は 自動・なし・付ける の 3 つ（棒の中・両方を出さない）", JSON.stringify(a.opts) === JSON.stringify(["", "none", "top"]), a.opts);
  check("① 3 つの系列のどれにも数値ラベルが付く（系列の色の字）", a.lines.length === 3 && a.lines.every((l) => l.n >= 3), a.lines);
  const drawn = await p.evaluate(() => [...document.querySelectorAll('#dashGrid .db-p[data-id="workDays"] .dp-legend i')].map((i) => getComputedStyle(i).getPropertyValue("--c").trim()));
  check("① 書式の「系列」の見本の色＝描いた線の色（凡例と同じ順）", JSON.stringify(Object.values(a.sw)) === JSON.stringify(a.lines.map((l) => l.c)) && JSON.stringify(drawn) === JSON.stringify(a.lines.map((l) => l.c)), { sw: a.sw, lines: a.lines, drawn });
  const serSet = async (name, kind, value) => { await p.evaluate(([n, k, v]) => { const row = document.querySelector(`#dbEditor [data-de-ser="${n}"]`); row.querySelector(`input[data-de-${k}][value="${v}"]`).click(); }, [name, kind, value]); await sleep(600); await waitDash(p); };
  await serSet("L-1", "slab", "off"); await serSet("L-2", "slab", "below"); await serSet("L-2", "sdash", "1");
  a = await lab();
  const l1 = a.lines.find((l) => a.sw["L-1"] === l.c), l2 = a.lines.find((l) => a.sw["L-2"] === l.c), cr = a.lines.find((l) => a.sw.CR1 === l.c);
  check("① 系列ごと: L-1 は出さない・CR1 は付いたまま・L-2 は破線", l1.n === 0 && cr.n >= 3 && l2.n >= 1 && l2.dash && !cr.dash, a.lines);
  const below = await p.evaluate((sel) => { const svg = document.querySelector(`${sel} .dp-chart svg`); const c = document.querySelector('#dbEditor [data-de-scol="L-2"]').value;
    const n = parseInt(c.slice(1), 16), rgb = `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
    const pts = [...svg.querySelectorAll("circle")].filter((x) => x.getAttribute("stroke") === c).map((x) => [+x.getAttribute("cx"), +x.getAttribute("cy")]);
    const ts = [...svg.querySelectorAll("text.pv-vl")].filter((t) => t.style.fill === rgb).map((t) => [+t.getAttribute("x"), +t.getAttribute("y")]);
    return ts.filter(([x, y]) => { const pt = pts.find((q) => Math.abs(q[0] - x) < 0.5); return pt && y > pt[1]; }).length / Math.max(1, ts.length); }, P("workDays"));
  check("① L-2 の数値は点の下（重なる所だけ上へ逃げる）", below >= 0.6, below);
  // ② 組む所の外枠
  const pane = await p.evaluate(async () => {
    const pane = document.querySelector("#dbEditor"), head = pane.querySelector(".de-head"), out = { over: pane.scrollHeight - pane.clientHeight, moved: [] };
    for (const i of [...pane.querySelectorAll("input,select,button")].slice(0, 400)) { i.focus(); if (pane.scrollTop || head.getBoundingClientRect().top < pane.getBoundingClientRect().top - 1) out.moved.push(i.outerHTML.slice(0, 80)); pane.scrollTop = 0; }
    return out;
  });
  check("② 組む所の外枠から中の物がはみ出さない", pane.over <= 0, pane);
  check("② どの入力に焦点が移っても、外枠が送られない（見出しが隠れない）", !pane.moved.length, pane.moved.slice(0, 3));
  // 当てて、名前を付けて保存 → ③
  await p.click("[data-de-apply]"); await sleep(500);
  await p.click("[data-db-saveas]"); await sleep(200); await p.click("[data-db-dosave]");
  await p.waitForFunction(() => !document.querySelector(".db-savepop")); await sleep(800); await waitDash(p);
  await p.evaluate(() => {
    window.__req = []; const f = window.fetch; window.fetch = (...x) => { window.__req.push(`${(x[1] && x[1].method) || "GET"} ${String(x[0]).split("?")[0]}`); return f(...x); };
    window.__paints = new Set(); new MutationObserver((ms) => ms.forEach((m) => { const pp = m.target.closest && m.target.closest(".db-pb"); if (pp) window.__paints.add(pp.closest(".db-p").dataset.id); })).observe(document.querySelector("#dashGrid"), { childList: true, subtree: true });
  });
  await p.focus(P("wipTotal")); await p.keyboard.press("Shift+ArrowLeft"); await sleep(600);
  const moved = await p.evaluate(() => [...window.__paints]);
  check("③ 組み替え（1 枚の大きさを変える）で描き直すのは、そのパネルだけ", moved.length <= 1 && (!moved.length || moved[0] === "wipTotal"), moved);
  const sv = await p.evaluate(async () => {
    window.__req = []; window.__paints = new Set();
    const b = document.querySelector("[data-db-save]"); b.click();
    const now = { text: b.textContent, disabled: b.disabled, msg: document.querySelector("#dashBar .db-msg").textContent };
    await new Promise((ok) => { const t0 = performance.now(); const f = () => ((document.querySelector("#dashBar .db-msg") || {}).textContent || "").includes("保存しました") || performance.now() - t0 > 8000 ? ok() : requestAnimationFrame(f); f(); });
    await new Promise((ok) => setTimeout(ok, 400));
    return { now, req: window.__req.filter((x) => x.includes("/api/dashboards")), paints: [...window.__paints], saved: document.querySelector("#dashBar .db-msg").textContent };
  });
  check("③ 押してすぐ「保存しています…」（ボタンは押せない）", sv.now.disabled && sv.now.text.includes("保存しています") && sv.now.msg.includes("保存しています"), sv.now);
  check("③ 往復は書く 1 回だけ（ダッシュボードの並びを読み直さない）", JSON.stringify(sv.req) === JSON.stringify([`PUT ${"/api/dashboards/"}${(await state(p)).id}`]), sv.req);
  check("③ 保存してもパネルを描き直さない（中身が同じ）", !sv.paints.length && sv.saved.includes("保存しました"), sv);
  await p.reload(); await waitDash(p); await sleep(400);
  const kept = (await state(p)).layout.panels.find((x) => x.id === "workDays");
  check("③ 開き直すと、保存した系列ごとの書式が残る", JSON.stringify(kept.fmt.series) === JSON.stringify({ "L-1": { label: "off" }, "L-2": { dash: true, label: "below" } }), kept.fmt);

  // ⑤ 四隅
  await p.click("[data-db-editmode]"); await sleep(400);
  const corner = async (id, dir, dx, dy) => {
    const z = await p.evaluate(([s, d]) => { const e = document.querySelector(`${s} [data-rz="${d}"]`).getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; }, [P(id), dir]);
    const cw = await p.evaluate(() => { const g = document.querySelector("#dashGrid").getBoundingClientRect(); return [(g.width + 10) / 12, (g.height + 10) / Dashboard._state().layout.rows]; });
    await p.mouse.move(...z); await p.mouse.down(); await p.mouse.move(z[0] + dx * cw[0], z[1] + dy * cw[1], { steps: 8 }); await sleep(100); await p.mouse.up(); await sleep(400);
    const q = (await state(p)).layout.panels.find((x) => x.id === id); return { x: q.x, y: q.y, w: q.w, h: q.h };
  };
  let b0 = (await state(p)).layout.panels.find((x) => x.id === "workMonth");
  let r = await corner("workMonth", "nw", 1, 0);
  check("⑤ 左上の角を右へ 1 マス: 左の端が動き、右の端はそのまま", r.x === b0.x + 1 && r.x + r.w === b0.x + b0.w && r.y === b0.y, { b0, r });
  r = await corner("workMonth", "sw", -1, 0);
  check("⑤ 左下の角を左へ 1 マス: 戻る", r.x === b0.x && r.w === b0.w, r);
  b0 = (await state(p)).layout.panels.find((x) => x.id === "wipClass");
  r = await corner("wipClass", "ne", 0, 1);
  check("⑤ 右上の角を下へ 1 マス: 上の端が動き、下の端はそのまま", r.y === b0.y + 1 && r.y + r.h === b0.y + b0.h, { b0, r });
  r = await corner("wipClass", "se", 0, 0);
  await p.focus(P("wipClass")); await p.keyboard.press("Alt+Shift+ArrowUp"); await sleep(400);
  r = (await state(p)).layout.panels.find((x) => x.id === "wipClass");
  check("⑤ Alt＋Shift＋↑ で左上の角（上へ 1 マス伸びる）", r.y === b0.y && r.h === b0.h, { b0, r });
  const hs = await p.evaluate((s) => [...document.querySelectorAll(`${s} [data-rz]`)].map((e) => getComputedStyle(e).cursor), P("wipClass"));
  check("⑤ 取っ手は四隅に 4 つ（斜めの矢印の形）", hs.length === 4 && hs.every((c) => /resize/.test(c)), hs);

  // ④ 行を引いて並べる・設備グループの見出し
  await openEditor(p, "board");
  await p.waitForSelector("#deBoard .de-rowi[data-de-row]");
  await p.selectOption("[data-de-btree]", "ライン別"); await sleep(1200); await waitDash(p); await sleep(300);
  const tree = await p.evaluate((s) => ({ heads: [...document.querySelectorAll(`${s} tr.db-gtr span`)].map((x) => x.textContent),
    list: [...document.querySelectorAll("#deBoard [data-de-rgrp]")].map((x) => x.dataset.deRgrp), cr: [...document.querySelectorAll('#deBoard [data-de-rgrp="CR ライン"] [data-de-row]')].map((x) => x.dataset.deRow) }), P("board"));
  check("④ 見出し（ライン別）: 表に CR ライン・L ライン・グループなし の行が出る", tree.heads.slice(0, 3).join(",") === "CR ライン,L ライン,（グループなし）" || tree.heads.join(",").startsWith("CR ライン,L ライン"), tree);
  check("④ 行の札もグループごと（CR ラインの下に CR1・CR2）", tree.list.join(",").startsWith("CR ライン,L ライン") && tree.cr.join(",") === "CR1,CR2", tree);
  const rest = () => p.evaluate(() => [...document.querySelectorAll('#deBoard .de-rgrp.is-none [data-de-row]')].map((x) => x.dataset.deRow));
  const drag = async (from, to, frac, look = false) => {
    const g = await p.evaluate(([f, t, fr]) => { const lis = [...document.querySelectorAll('#deBoard .de-rgrp.is-none [data-de-row]')], m = document.querySelector("#dbEditor .de-main");
      m.scrollTop = Math.max(0, lis[0].getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 120);
      const a = lis[f].querySelector("[data-de-grip]").getBoundingClientRect(), b = lis[t].getBoundingClientRect(); return { a: [a.x + a.width / 2, a.y + a.height / 2], b: [b.x + 80, b.y + b.height * fr] }; }, [from, to, frac]);
    await p.mouse.move(...g.a); await p.mouse.down(); await p.mouse.move(g.a[0], g.a[1] + 6, { steps: 2 }); await p.mouse.move(...g.b, { steps: 8 }); await sleep(150);
    const mid = look ? await p.evaluate(() => { const l = document.querySelector(".de-dropline"), gh = document.querySelector(".de-ghost"); return { line: !!l && !l.hidden, ghost: !!gh, src: !!document.querySelector(".de-rowi.is-src") }; }) : null;
    return { g, mid };
  };
  let r0 = await rest(); let d = await drag(0, 2, 0.75, true);
  check("④ 引いている間、ゴースト・入る所の線・元の所の空きが出る", d.mid.line && d.mid.ghost && d.mid.src, d.mid);
  await p.mouse.up(); await sleep(1000); await waitDash(p);
  let r1 = await rest();
  check("④ 下へ: 3 つ目の札の下半分へ落とすと、3 つ目の後ろに入る", JSON.stringify(r1.slice(0, 3)) === JSON.stringify([r0[1], r0[2], r0[0]]), { r0, r1 });
  r0 = r1; await drag(2, 0, 0.25); await p.mouse.up(); await sleep(1000); await waitDash(p); r1 = await rest();
  check("④ 上へ: 1 つ目の札の上半分へ落とすと、1 つ目の前に入る（下へと同じ決まり）", JSON.stringify(r1.slice(0, 3)) === JSON.stringify([r0[2], r0[0], r0[1]]), { r0, r1 });
  r0 = r1; await drag(0, 1, 0.75); await p.keyboard.press("Escape"); await p.mouse.up(); await sleep(600); r1 = await rest();
  check("④ Esc でやめると並びは変わらない", JSON.stringify(r0) === JSON.stringify(r1) && !(await p.$(".de-ghost")), { r0, r1 });
  const tbl = await p.evaluate((s) => [...document.querySelectorAll(`${s} tbody tr:not(.db-gtr) th[scope=row]`)].map((x) => x.textContent), P("board"));
  check("④ 表の行も同じ並び（行の札と同じ）", JSON.stringify(tbl.filter((k) => r1.includes(k)).slice(0, 4)) === JSON.stringify(r1.slice(0, 4)), { tbl, r1 });
  // グループごと: L ラインを CR ラインの前へ
  const gg = await p.evaluate(() => { const a = document.querySelector('#deBoard [data-de-rgrp="L ライン"] .de-rgh [data-de-grip]').getBoundingClientRect(), b = document.querySelector('#deBoard [data-de-rgrp="CR ライン"]').getBoundingClientRect(); return { a: [a.x + 4, a.y + a.height / 2], b: [b.x + 60, b.y + 8] }; });
  await p.mouse.move(...gg.a); await p.mouse.down(); await p.mouse.move(gg.a[0], gg.a[1] - 6, { steps: 2 }); await p.mouse.move(...gg.b, { steps: 8 }); await p.mouse.up(); await sleep(1000); await waitDash(p);
  const heads = await p.evaluate((s) => [...document.querySelectorAll(`${s} tr.db-gtr span`)].map((x) => x.textContent), P("board"));
  check("④ グループの見出しを引くと、グループごと並ぶ（L ライン → CR ライン）", heads[0] === "L ライン" && heads[1] === "CR ライン", heads);
  await p.click("[data-de-apply]"); await sleep(400);
  const o = (await state(p)).layout.panels.find((x) => x.id === "board").order;
  check("④ 当てると組みに入る（tree・glist・手で並べた順）", o.tree === "ライン別" && o.glist[0] === "L ライン" && o.by === "manual", o);
  await leaveEdit(p);

  // ⑥ スライサー
  await p.evaluate(() => { const k = "tpa.dash.v1"; const m = TPA.local.get(k, {}); delete m.slice; TPA.local.set(k, m); });
  await p.reload(); await waitDash(p); await sleep(500);
  const L = await p.evaluate(async () => { const d = await (await fetch("/api/dashboard/equip-tree")).json(); return d.sets.find((x) => x.name === "ライン別").groups.find((g) => g.name === "L ライン").members; });
  const base = (await state(p)).layout.panels;
  await p.click('[data-ds-period="last_month"]'); await sleep(400); await waitDash(p);
  await p.click('[data-ds-group="L ライン"]'); await sleep(600); await waitDash(p); await sleep(300);
  const st = await state(p);
  const want = async (id) => {
    const q = JSON.parse(JSON.stringify(base.find((x) => x.id === id)));
    if (q.period && q.period.kind) q.period = { column: q.period.column, kind: "last_month", n: 7 };
    q.equips = L.slice(); q.esplit = "sum";
    return total(await ask(p, q));
  };
  for (const id of ["workTotal", "workMonth"]) {
    const got = total(st.answers[id]), w = await want(id);
    check(`⑥ ${id}: 先月＋L ラインの数がサーバーと同じ（${w}）`, got === w, { got, w, period: st.answers[id].period });
  }
  const wip = st.answers.wipTotal;
  check("⑥ 仕掛（期間を組んでいない）は期間が変わらず、設備だけ L ライン", !wip.period && total(wip) === await want("wipTotal"), { wip: total(wip), period: wip.period });
  const bd = st.answers.board.groups;
  check("⑥ 合わせた表: 前日のまとまりは先月に・仕掛のまとまりは期間なしのまま", bd[1].period && bd[1].period.kind === "last_month" && !bd[0].period, bd.map((g) => g.period));
  const marks = await p.evaluate(() => [...document.querySelectorAll("#dashGrid .db-p")].map((e) => [e.dataset.id, !!e.querySelector(".db-ph .db-sbadge")]));
  check("⑥ 効いているパネルの見出しに印（6 枚とも）", marks.every((m) => m[1]), marks);
  const hits = await p.textContent(".ds-hits");
  check("⑥ 道具の行に「6 / 6 枚に効いています」", /6 \/ 6/.test(hits), hits);
  await p.click('[data-ds-back="1"]'); await sleep(500); await waitDash(p);
  const two = (await state(p)).answers.workTotal.period;
  check("⑥ ◀ で 2 か月前（8 月）", two && two.kind === "month" && two.n === 2 && /8月/.test(two.name) && (await p.textContent(".ds-month b")).includes("8月"), { two, label: await p.textContent(".ds-month b") });
  await p.click('[data-ds-back="-1"]'); await sleep(500); await waitDash(p);
  check("⑥ ▶ で先月に戻る", (await state(p)).answers.workTotal.period.kind === "last_month", (await state(p)).answers.workTotal.period);
  await p.reload(); await waitDash(p); await sleep(500);
  check("⑥ 開き直しても、スライサーを覚えている（この PC の見え方）", (await state(p)).answers.workTotal.period.kind === "last_month" && !!(await p.$('.ds-chip.on[data-ds-group="L ライン"]')), (await state(p)).answers.workTotal.period);
  // 従わないパネル
  await p.evaluate(() => { const l = Dashboard._state().layout; l.panels.find((x) => x.id === "workMonth").noslice = true; Dashboard._setLayout(l); }); await sleep(800); await waitDash(p);
  const ns = (await state(p)).answers.workMonth.period;
  check("⑥ 「スライサーに従わない」パネルは組んだまま（今月）", ns.kind === "this_month" && !(await p.$(`${P("workMonth")} .db-sbadge`)), ns);
  await p.click("[data-ds-clear]"); await sleep(600); await waitDash(p);
  const cl = await state(p);
  check("⑥ 外すと組んだまま（前日・すべての設備）に戻る", cl.answers.workTotal.period.kind === "yesterday" && total(cl.answers.workTotal) === total(await ask(p, base.find((x) => x.id === "workTotal"))), cl.answers.workTotal.period);
  // 設備… の面: グループの見出しでまとめて選ぶ
  await p.click("[data-ds-pick]"); await p.waitForSelector(".db-slicepop [data-ds-gck]"); await sleep(200);
  await p.click('.db-slicepop [data-ds-gck="CR ライン"]'); await sleep(600); await waitDash(p);
  const crOn = await p.evaluate(() => [...document.querySelectorAll(".db-slicepop [data-ds-eq]:checked")].map((x) => x.dataset.dsEq));
  check("⑥ 「設備…」の面で、グループの見出しのチェックでそのグループの設備がまとめて入る", crOn.join(",") === "CR1,CR2", crOn);
  await p.click(".db-slicepop [data-ds-done]"); await sleep(300);
  await p.click("[data-ds-clear]"); await sleep(500);
  await p.close();

  // 1280×720: 帯（3 回目で決めた C2）に、1728 と同じ札の形で 1 段に収まる
  const q = await app.newPage("light", parseView("1280x720"), { screen: "dash" });
  q.on("pageerror", (e) => errors.push(e.message));
  await q.click('[data-ds-period="last_month"]'); await sleep(400); await waitDash(q);
  await q.click('[data-ds-group="L ライン"]'); await sleep(600); await waitDash(q);
  const fit = await q.evaluate(() => { const w = document.querySelector("#dashSlicer"), r = w.getBoundingClientRect();
    const cut = [...w.querySelectorAll("button,select,small")].filter((b) => { const x = b.getBoundingClientRect(); return x.width && (x.right > r.right + 1 || x.bottom > r.bottom + 1); }).map((b) => b.textContent.trim());
    return { strip: w.classList.contains("ds-strip") && !w.hidden, compact: !!w.querySelector(".is-compact"), cut, oneRow: r.height < 40, over: w.scrollWidth > w.clientWidth + 1, hits: (w.querySelector(".ds-hits") || {}).textContent }; });
  check("⑥ 1280×720: スライサーの帯に、1728 と同じ札の形で 1 段に収まる（切れる物が無い・効いている枚数も出る）", fit.strip && !fit.compact && !fit.cut.length && fit.oneRow && !fit.over && /6 \/ 6/.test(fit.hits || ""), fit);
  const titles = await q.evaluate(() => [...document.querySelectorAll("#dashGrid .db-ph h3")].filter((h) => h.scrollWidth > h.clientWidth + 1).map((h) => h.textContent));
  check("⑥ 1280×720: スライサーが効いても、パネルの題が切れない（印は絵だけに畳む）", !titles.length, titles);
  await q.click("[data-db-editmode]"); await sleep(400);
  const ed = await q.evaluate(() => ({ hidden: document.querySelector("#dashSlicer").hidden, mini: (document.querySelector("#dashBar .ds-mini") || {}).textContent || "" }));
  check("⑥ 編集のときは帯を出さず、道具の行に「スライサー … ×」", ed.hidden && /スライサー/.test(ed.mini), ed);
  await q.click("[data-db-leave]"); await sleep(400);
  // 数は、居る段の高さいっぱい（添え書きや印に押されて縮まない。前は添え書きがはみ出して 14px まで縮んだ）。14px より小さくしない
  const kp = await q.evaluate(() => [...document.querySelectorAll('#dashGrid .dp-kpi.is-row')].map((k) => ({ f: parseFloat(k.querySelector(".dp-num").style.fontSize), h: k.closest(".db-pb").clientHeight })));
  check("⑥ 1280×720: 1 段の数字のパネルの数が段の高さいっぱい（85% 以上・14px 以上）", kp.length >= 3 && kp.every((x) => x.f >= 14 && x.f >= x.h * 0.85), kp);
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} 件` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
