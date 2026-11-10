// 評価関数（開発用。版 3.92.0。利用者の要望 2026-11-10 の 1〜5）: 本物の画面で、ダッシュボードの次を 3 つの大きさ（1728・1536×864・1280×720）で確かめる。
//   node program/tools/ui-eval-dashunit.mjs
// 1. 表: 上位 6 の後に「その他（n 行）」・総計＝上位＋その他（足せる値）。値ごとの単位で、重量の列だけに t・ロット数の列に t も「.0」も無い。
//    見出しに式を出さない値（hideExpr）は見出しに「÷1000」が無い
// 2. 数字のパネルの 2 つの値（fmt.kpair=side）: 数が 2 つ・同じ大きさ・単位と仕切りの線の間が 8px 以上・パネルからはみ出さない。
//    添え書きを上（kmeta=top）にすると、添え書きが数より上
// 3. 組む所: 組んでいるパネルが確定後と同じ大きさ（空きに入らなければ同じ並びのまま縮める。札で言う）・④ 置き方の見本の札が 6 つ・左右に 2 つが選ばれている
// 4. 待っている間（問い合わせを 3 秒遅らせる）: パネルに進みの線（is-wait）・添え書きの段に理由と秒（言い方は 1 つ）・題が切れない・
//    道具の行に「n 枚中 k 枚 済み」と待っているパネルの札（見える札＋ほか n 枚＝待っている枚数）・待つ間にグリッドが下へずれない
// 全部合えば終了コード 0
import { launch, parseView, sleep, waitDash } from "./ui-harness.mjs";
import { LAYOUT } from "./shot-dashunit.mjs";

process.env.TPA_UI_BYPASS_CSP = "1";
const layout = JSON.parse(JSON.stringify(LAYOUT));
{
  const [t1, , k2] = layout.panels;
  t1.body.measures = [{ ...t1.body.measures[0], utext: "t", hideExpr: true }, { agg: "lots", utext: "" }];
  k2.body.measures = [{ ...k2.body.measures[0], utext: "t", hideExpr: true }, { agg: "lots", utext: "ロット" }];
  k2.fmt = { kpair: "side" };
}
let bad = 0, n = 0;
const check = (name, ok, got) => { n++; console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got)}`}`); if (!ok) bad++; };

const app = await launch();
try {
  for (const v of ["1728x1152", "1536x864", "1280x720"]) {
    const page = await app.newPage("light", parseView(v), { screen: "dash" });
    await page.evaluate((l) => Dashboard._setLayout(l), layout); await sleep(600); await waitDash(page); await sleep(700);
    // 1. 表
    const tbl = await page.evaluate(() => {
      const p = document.querySelector('#dashGrid .db-p[data-id="t1"]');
      const heads = [...p.querySelectorAll("thead th")].map((x) => x.textContent);
      const rows = [...p.querySelectorAll("tbody tr")].map((tr) => ({ cls: tr.className, cells: [...tr.cells].map((c) => c.textContent.trim()) }));
      return { heads, rows };
    });
    const num = (s) => Number(String(s).replace(/[^\d.-]/g, ""));
    const data = tbl.rows.filter((r) => !/is-other|is-grand/.test(r.cls)), other = tbl.rows.find((r) => /is-other/.test(r.cls)), grand = tbl.rows.find((r) => /is-grand/.test(r.cls));
    const w = (r) => num(r.cells[r.cells.length - 2]), l = (r) => num(r.cells[r.cells.length - 1]);
    check(`${v} 1 表に「その他（n 行）」と総計`, !!other && !!grand && /その他（\d+ 行）/.test(other.cells[0]), tbl.rows.map((r) => r.cells[0]));
    if (other && grand) {
      check(`${v} 1 総計＝上位＋その他（重量・ロット数）`, Math.abs(data.reduce((a, r) => a + w(r), 0) + w(other) - w(grand)) < 0.2 && data.reduce((a, r) => a + l(r), 0) + l(other) === l(grand), [w(grand), l(grand)]);
      check(`${v} 1 重量の列だけに t・ロット数に t も .0 も無い`, tbl.rows.every((r) => /t$/.test(r.cells[r.cells.length - 2]) && !/t$|\.0$/.test(r.cells[r.cells.length - 1])), tbl.rows.slice(0, 2));
    }
    check(`${v} 1 見出しに式（÷1000）を出さない`, !tbl.heads.some((h) => /÷|値÷/.test(h)) && tbl.heads.some((h) => /重量の合計/.test(h)), tbl.heads);
    // 2. 数字のパネルの 2 つの値
    const kp = await page.evaluate(() => {
      const p = document.querySelector('#dashGrid .db-p[data-id="k2"]'), pair = p.querySelector(".dp-kpair.is-side");
      if (!pair) return null;
      const kv = [...pair.querySelectorAll(".dp-kv")], nums = kv.map((x) => x.querySelector(".dp-num"));
      const unit0 = nums[0].querySelector("small").getBoundingClientRect(), line = kv[1].getBoundingClientRect().left;
      const pr = p.getBoundingClientRect();
      return { n: kv.length, sizes: nums.map((x) => parseFloat(getComputedStyle(x).fontSize)), gap: line - unit0.right,
        inside: kv.every((x) => { const r = x.getBoundingClientRect(); return r.right <= pr.right + 1 && r.bottom <= pr.bottom + 1; }), texts: nums.map((x) => x.textContent) };
    });
    check(`${v} 2 数字のパネルに 2 つの値が同じ大きさで並ぶ`, !!kp && kp.n === 2 && kp.sizes[0] === kp.sizes[1], kp);
    check(`${v} 2 単位と仕切りの線の間が 8px 以上・はみ出さない`, !!kp && kp.gap >= 8 && kp.inside, kp);
    // 3. 組む所
    await page.click("[data-db-editmode]"); await sleep(500);
    await page.focus('#dashGrid .db-p[data-id="k2"]');
    const before = await page.evaluate(() => { const r = document.querySelector('#dashGrid .db-p[data-id="k2"]').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    await page.keyboard.press("Enter");
    await page.waitForSelector("#deFields .pv-f"); await waitDash(page); await sleep(600);
    const ed = await page.evaluate(() => {
      const el = document.querySelector('#dashGrid .db-p[data-id="k2"]'), r = el.getBoundingClientRect(), edr = document.querySelector("#dbEditor").getBoundingClientRect();
      const tag = document.querySelector("#dbFocusTag");
      return { w: el.offsetWidth, h: el.offsetHeight, vw: r.width, vh: r.height, right: r.right, edLeft: edr.left, tag: tag ? tag.textContent : "",
        thumbs: document.querySelectorAll("#deKLay .de-kth").length, on: [...document.querySelectorAll("#deKLay .de-kth.on")].map((x) => x.textContent) };
    });
    check(`${v} 3 組む所のパネルは確定後と同じ大きさで描く（縮めるのは見え方だけ）`, Math.abs(ed.w - before.w) <= 1 && Math.abs(ed.h - before.h) <= 1 && ed.vw <= ed.w + 1, [before, ed]);
    check(`${v} 3 組む所の下に隠れない・札で言う`, ed.right <= ed.edLeft && /確定後/.test(ed.tag), ed);
    check(`${v} 3 ④ 置き方の見本が 6 つ・左右に 2 つと期間を下が選ばれている`, ed.thumbs === 6 && ed.on.some((t) => /左右に 2 つ/.test(t)) && ed.on.some((t) => /期間を下/.test(t)), ed);
    // 期間を上にする
    await page.click('#deKLay [data-de-klay="kmeta"][data-v="top"]'); await sleep(700);
    const top = await page.evaluate(() => { const p = document.querySelector('#dashGrid .db-p[data-id="k2"]'), m = p.querySelector(".dp-kmeta"), pr = p.querySelector(".dp-kpair");
      return m && pr ? m.getBoundingClientRect().bottom <= pr.getBoundingClientRect().top + 1 : null; });
    check(`${v} 2 添え書きを上にすると数より上`, top === true, top);
    await page.click("[data-de-cancel]").catch(() => {}); await sleep(400);
    await page.keyboard.press("Escape"); await sleep(300);
    await page.click("[data-db-leave]").catch(() => {}); await sleep(600);
    // 4. 待っている間
    const gridTop0 = await page.evaluate(() => document.querySelector("#dashGrid").getBoundingClientRect().top);
    await page.route("**/api/dashboard/query**", async (r) => { await sleep(3000); await r.continue().catch(() => {}); });
    await page.click("[data-db-refresh]"); await sleep(1800);
    const wt = await page.evaluate(() => {
      const ps = [...document.querySelectorAll("#dashGrid .db-p")];
      return { gridTop: document.querySelector("#dashGrid").getBoundingClientRect().top,
        panels: ps.map((p) => { const h = p.querySelector(".db-ph h3"); return { id: p.dataset.id, w: p.clientWidth, wait: p.classList.contains("is-wait"), sec: (p.querySelector(".db-wsec") || {}).textContent || "",
          why: (p.querySelector(".db-wst") || {}).textContent || "", cut: h ? h.scrollWidth > h.clientWidth + 1 : false,
          op: (() => { let o = 1; for (let x = p.querySelector(".db-wst"); x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; })() }; }),
        bar: (() => { const b = document.querySelector("#dashBar .db-wbar"); return b && !b.hidden ? b.textContent : ""; })() };
    });
    check(`${v} 4 待っているパネルに進みの線と理由`, wt.panels.every((p) => p.wait && /数え/.test(p.why)), wt.panels);
    check(`${v} 4 どのパネルも添え書きの段に理由と秒（言い方は 1 つ）・題は切れない`, wt.panels.every((p) => !p.sec && /^(数え直し中|数えています) \d+\.\d 秒$/.test(p.why) && !p.cut), wt.panels);
    const wb = await page.evaluate(() => { const b = document.querySelector("#dashBar .db-wbar"); const shown = [...b.querySelectorAll(".db-witem")].filter((x) => !x.hidden).length;
      const more = b.querySelector(".db-wmore"), m = more && !more.hidden ? +(more.textContent.match(/\d+/) || [0])[0] : 0, tot = b.querySelectorAll(".db-witem").length;
      const n = b.querySelector(".db-wnames"), vis = [...b.querySelectorAll(".db-witem")].filter((x) => !x.hidden), nr = n.getBoundingClientRect();
      // どの札も中身が札に収まり（理由と秒が札の外へあふれない）・札どうしが重ならず・段の中に見える（作った後の採点し直しで見つけた見逃し）
      const inner = vis.every((x) => x.scrollWidth <= x.clientWidth + 1), apart = vis.every((x, i) => !i || vis[i - 1].getBoundingClientRect().right <= x.getBoundingClientRect().left + 0.5);
      const seen = vis.every((x) => x.getBoundingClientRect().right <= nr.right + 0.5 && /\d+\.\d 秒）$/.test(x.textContent));
      return { shown, m, tot, inner, apart, seen, fit: n.scrollWidth <= n.clientWidth + 1 && b.scrollWidth <= b.clientWidth + 1 }; });
    check(`${v} 4 待ちの字は薄くした中身に入らない（字のコントラストを保つ）`, wt.panels.every((p) => p.op === 1), wt.panels.map((p) => p.op));
    check(`${v} 4 道具の行の札は切れず・重ならず、見える札＋ほか n 枚＝待っている枚数`, wb.fit && wb.inner && wb.apart && wb.seen && wb.shown + wb.m === wb.tot, wb);
    check(`${v} 4 道具の行に「n 枚中 k 枚 済み」と待っているパネル`, /4 枚中 \d 枚 済み/.test(wt.bar) && /待っている:/.test(wt.bar), wt.bar);
    check(`${v} 4 待つ間にグリッドが下へずれない`, Math.abs(wt.gridTop - gridTop0) < 1, [gridTop0, wt.gridTop]);
    await page.unroute("**/api/dashboard/query**");
    await sleep(3500);
    const done = await page.evaluate(() => ({ wait: document.querySelectorAll("#dashGrid .db-p.is-wait").length, bar: (document.querySelector("#dashBar .db-wbar") || {}).hidden }));
    check(`${v} 4 答えが届けば待ちの字・線が消える`, done.wait === 0 && done.bar === true, done);
    await page.close();
  }
} finally {
  await app.close();
}
console.log(bad ? `NG ${n} 件中 ${bad} 件が違う` : `OK（${n} 件）`);
process.exit(bad ? 1 : 0);
