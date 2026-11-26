// 評価関数（開発用）: 変換表の当てる列が多い・名前が長いときに切れない（版 3.124.0。利用者の依頼 2026-11-17 の 4「入力データの当てる列が複数の場合
// 表示しきれていません」。決め方: ui-proposals/2026-11-convcols の B）。
//   node program/tools/ui-eval-convmany.mjs [1728x1152,1536x864,1280x720]
// 撮るだけの変換表 CONV_MANY（ui-harness.mjs。入力 4 つ・当てる列 1・2・3・5・全角 10〜17 字の名前）と同梱の「課名」（入力 1 つに 4 列）・「管理分類」（入力 6 つ）で、
// 3 つの大きさごとに:
// ① 入力の札: 当てる列の名前の字が全部要素の幅に入る（scrollWidth ≦ clientWidth）・データの印が字に重ならない・札が行からはみ出さない・
//    並びが保存した順と同じ・当てる順の番号（::before の counter）・当てる列が 1 つの札は中身の幅（▾ が名前のすぐ後ろ）
// ② 入力の名前・表の名前の欄の字が全部入る。頭の段の見出し（入力の名前・比べ方・当てる列）が行の欄と縦にそろい、字のコントラストが 4.5 以上
// ③ 判定表の見出しが切れない（字のある見出しの字が見出しの幅に入り、見出しが表の見えている幅の中。入力 6 つの管理分類は行の ↑↓× の列だけ横送りの先でよい）。1280 でも判定表の行が全部（3 行）マスタの面を送らずに見える
// ④ 当てる列を選ぶ面（5 列の入力）: マスタ管理の窓の中に収まり面ごとは送らない・データ元の欄どうしが重ならない・選んだ列の名前が全部入り順が同じ・
//    「データに無い名前を足す」の欄と「足す」に届く（その点の一番上の要素が欄そのもの）・押した札が見えている
// ⑤ ↑ で順を替えて保存 → 保存した表の順と札の順が同じ（開き直しても）
// ⑥ 表示列の窓の変換表の帯（選ぶ ▾）: 表の名前・理由の字が切れない・列の一覧が 100px 以上残る
// 全部合えば終了コード 0。
import { launch, sleep, parseView, CONV_MANY, convMany } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 700)}`}`); if (!ok) fails.push(name); };
const VIEWS = (process.argv[2] || "1728x1152,1536x864,1280x720").split(",");

/** 頁の中: 入力の札ごとの測り（はみ出し・重なり・並び・番号・▾ の位置）と、名前の欄・見出しのそろい・コントラスト */
function inputsMeasure() {
  const R = (el) => el.getBoundingClientRect();
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) > 0.9) return c; } return [255, 255, 255]; };
  const contrast = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(bg(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const rows = [...document.querySelectorAll("#masterSettings .cv-ins .cv-in")].map((row) => {
    const btn = row.querySelector("[data-cv-cols]"), name = row.querySelector("[data-cv-iname]"), rr = R(row), br = R(btn);
    const aliases = [...btn.querySelectorAll(".cv-alias")].map((a) => {
      const b = a.querySelector("b"), ar = R(a), bR = R(b);
      return { name: b.textContent, fits: b.scrollWidth <= b.clientWidth + 1, inBtn: ar.left >= br.left - 1 && ar.right <= br.right + 1,
        marks: [...a.querySelectorAll(".cv-src")].every((s) => R(s).left >= bR.right - 1 && R(s).right <= ar.right + 1),
        num: /counter/.test(getComputedStyle(b, "::before").content) };
    });
    const caret = btn.querySelector(".cv-caret");
    return { input: name.value, nameFits: name.scrollWidth <= name.clientWidth + 1, aliases,
      btnInRow: br.left >= rr.left - 1 && br.right <= rr.right + 1 && br.bottom <= rr.bottom + 1,
      tail: Math.round(br.right - R(caret).right), single: aliases.length === 1,
      x: { name: Math.round(R(name).left), type: Math.round(R(row.querySelector("[data-cv-itype]")).left), cols: Math.round(br.left) } };
  });
  const h = (c) => document.querySelector(`#masterSettings .cv-inshead .${c}`);
  const head = { name: Math.round(R(h("cv-ih-n")).left), type: Math.round(R(h("cv-ih-t")).left), cols: Math.round(R(h("cv-ih-c")).left),
    contrast: Math.min(...[...document.querySelectorAll("#masterSettings .cv-ih")].map(contrast)) };
  const nm = document.querySelector("#cvName");
  return { rows, head, tableName: nm.scrollWidth <= nm.clientWidth + 1 };
}
/** 頁の中: 判定表の見出しが切れない・見えている行の数（マスタの面を送らずに） */
function gridMeasure() {
  const w = document.querySelector("#masterSettings .cv-gridwrap"), wr = w.getBoundingClientRect();
  const panel = document.querySelector("#masterOverlay .master-panel").getBoundingClientRect();
  const ths = [...w.querySelectorAll("thead th")].filter((th) => th.textContent.trim()).map((th) => { const r = th.getBoundingClientRect();
    return { t: th.textContent.trim(), fits: th.scrollWidth <= th.clientWidth + 1, inside: r.left >= wr.left - 1 && r.right <= wr.right + 1 }; });
  const rows = [...w.querySelectorAll("tbody tr[data-r]")];
  return { ths, rows: rows.length, seen: rows.filter((r) => r.getBoundingClientRect().bottom <= Math.min(panel.bottom, wr.bottom) + 1).length,
    scroll: document.querySelector("#masterSettings").scrollTop };
}
const pickTable = (p, name) => p.evaluate((n) => [...document.querySelectorAll("[data-cv-pick]")].find((b) => b.querySelector("b")?.textContent === n)?.click(), name);

const app = await launch();
try {
  for (const v of VIEWS) {
    const VIEW = parseView(v), tag = `［${v}］`;
    const p = await app.newPage("light", VIEW);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
    await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)"); await sleep(600);
    await convMany(p, true); await sleep(700);

    // ①②: CONV_MANY
    const m = await p.evaluate(inputsMeasure);
    const all = m.rows.flatMap((r) => r.aliases);
    check(`${tag}① 当てる列の名前が全部入り、札の中・印が字に重ならない（1・2・3・5 列）`, m.rows.map((r) => r.aliases.length).join() === "1,2,3,5"
      && all.every((a) => a.fits && a.inBtn && a.marks) && m.rows.every((r) => r.btnInRow), m.rows);
    check(`${tag}① 並びが保存した順と同じで、当てる順の番号がある`, m.rows.every((r, i) => r.aliases.map((a) => a.name).join("|") === CONV_MANY.inputs[i].columns.join("|")) && all.every((a) => a.num),
      m.rows.map((r) => r.aliases.map((a) => a.name)));
    const one = m.rows.find((r) => r.single);
    check(`${tag}① 当てる列が 1 つの札は中身の幅（▾ が名前のすぐ後ろ）`, one && one.tail <= 12, one);
    check(`${tag}② 入力の名前・表の名前の字が全部入る`, m.tableName && m.rows.every((r) => r.nameFits), { table: m.tableName, rows: m.rows.map((r) => [r.input, r.nameFits]) });
    check(`${tag}② 見出し（入力の名前・比べ方・当てる列）が行の欄と縦にそろう（±10px）`, m.rows.every((r) => Math.abs(r.x.name - m.head.name) <= 10 && Math.abs(r.x.type - m.head.type) <= 10 && Math.abs(r.x.cols - m.head.cols) <= 10),
      { head: m.head, rows: m.rows.map((r) => r.x) });
    check(`${tag}② 見出しの字のコントラストが 4.5 以上`, m.head.contrast >= 4.5, m.head.contrast);
    // ③
    const g = await p.evaluate(gridMeasure);
    check(`${tag}③ 判定表の見出しが切れない（CONV_MANY）`, g.ths.every((t) => t.fits && t.inside), g.ths);
    check(`${tag}③ 判定表の行が全部、マスタの面を送らずに見える`, g.scroll === 0 && g.seen === g.rows && g.rows === CONV_MANY.rows.length, g);

    // ④ 選ぶ面（5 列の入力）
    await p.click('[data-cv-cols="3"]'); await p.waitForSelector(".cv-cpi"); await sleep(500);
    const pop = await p.evaluate(() => {
      const R = (el) => el.getBoundingClientRect(), el = document.querySelector(".cv-colpop"), r = R(el), m = R(document.querySelector("#masterOverlay .master-panel"));
      const secs = [...el.querySelectorAll(".cv-cpsrc")].map(R);
      let overlap = 0;
      for (let i = 0; i < secs.length; i++) for (let j = i + 1; j < secs.length; j++) {
        const a = secs[i], b = secs[j], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) overlap++;
      }
      const hit = (q) => { const n = el.querySelector(q), rr = R(n), at = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2); return !!at && (at === n || n.contains(at)); };
      const chosen = [...el.querySelectorAll(".cv-cpchosen .cv-alias b")].map((b) => ({ name: b.textContent, fits: b.scrollWidth <= b.clientWidth + 1, num: /counter/.test(getComputedStyle(b, "::before").content) }));
      const anchor = R(document.querySelector('#masterSettings [data-cv-cols="3"]'));
      return { box: { l: r.left - m.left, r: m.right - r.right, b: m.bottom - r.bottom, t: r.top - m.top }, scroll: el.scrollHeight - el.clientHeight, overlap, secs: secs.length,
        chosen, own: hit("[data-cp-own]"), add: hit("[data-cp-add]"), anchor: anchor.bottom > m.top + 40 && anchor.top < r.top };
    });
    check(`${tag}④ 面がマスタ管理の窓の中に収まり、面ごとは送らない`, pop.box.l >= 0 && pop.box.r >= 0 && pop.box.b >= 0 && pop.box.t >= 0 && pop.scroll <= 1, pop);
    check(`${tag}④ データ元の欄どうしが重ならない`, pop.secs >= 3 && pop.overlap === 0, pop);
    check(`${tag}④ 選んだ列の名前が全部入り、順と番号が同じ`, pop.chosen.map((c) => c.name).join("|") === CONV_MANY.inputs[3].columns.join("|") && pop.chosen.every((c) => c.fits && c.num), pop.chosen);
    check(`${tag}④ 「データに無い名前を足す」の欄と「足す」に届く・押した札が見えている`, pop.own && pop.add && pop.anchor, pop);
    // ⑤ ↑ で順を替えて保存
    await p.click('.cv-colpop [data-cp-up="1"]'); await sleep(300);
    const want = [CONV_MANY.inputs[3].columns[1], CONV_MANY.inputs[3].columns[0], ...CONV_MANY.inputs[3].columns.slice(2)];
    await p.click(".cv-colpop [data-cp-close]"); await sleep(200);
    await p.click("[data-cv-save]"); await sleep(1200);
    const saved = await p.evaluate(async (n) => (await (await fetch("/api/masters/conversions")).json()).items.find((x) => x.name === n).inputs[3].columns, CONV_MANY.name);
    await pickTable(p, "課名"); await sleep(500); await pickTable(p, CONV_MANY.name); await sleep(600);
    const shown = await p.$$eval('#masterSettings [data-cv-cols="3"] .cv-alias b', (xs) => xs.map((b) => b.textContent));
    check(`${tag}⑤ ↑ で替えた順が保存され、開き直しても札の順が同じ`, saved.join("|") === want.join("|") && shown.join("|") === want.join("|"), { saved, shown, want });

    // ①③ 同梱の課名（入力 1 つに 4 列）と管理分類（入力 6 つ）
    for (const name of ["課名", "管理分類"]) {
      await pickTable(p, name); await sleep(600);
      const k = await p.evaluate(inputsMeasure), kg = await p.evaluate(gridMeasure);
      const ka = k.rows.flatMap((r) => r.aliases);
      check(`${tag}① ${name}: 当てる列の名前が全部入り、印が重ならない`, ka.length >= 4 && ka.every((a) => a.fits && a.inBtn && a.marks) && k.rows.every((r) => r.btnInRow && r.nameFits), k.rows);
      check(`${tag}③ ${name}: 判定表の見出しが切れない`, kg.ths.every((t) => t.fits && t.inside), kg.ths);
    }

    // ⑥ 表示列の窓の変換表の帯
    await p.click("#masterCloseBtn"); await sleep(500);
    await p.click("#tabList").catch(() => {}); await sleep(300);
    await p.click("#llColBtn"); await sleep(700);
    await p.click("[data-cv-more]"); await sleep(500);
    const band = await p.evaluate(() => {
      const items = [...document.querySelectorAll("#lcConv .lc-cvi")].map((l) => { const r = l.getBoundingClientRect();
        return { t: l.textContent.trim().slice(0, 30), ok: [...l.querySelectorAll("b, small")].every((x) => x.scrollWidth <= x.clientWidth + 1 && x.getBoundingClientRect().right <= r.right + 1) }; });
      const list = document.querySelector("#lcList").getBoundingClientRect(), foot = document.querySelector("#llColumnPanel").getBoundingClientRect();
      return { items, mine: items.some((x) => x.t.includes("当てる列が多い")), list: Math.round(Math.min(list.bottom, foot.bottom) - list.top) };
    });
    check(`${tag}⑥ 表示列の窓の変換表の帯: 表の名前・理由が切れない`, band.mine && band.items.every((x) => x.ok), band.items.filter((x) => !x.ok));
    check(`${tag}⑥ 帯を開いても列の一覧が 100px 以上残る`, band.list >= 100, band.list);
    check(`${tag}頁の誤りが無い`, !errors.length, errors);
    await p.click("#lcClose").catch(() => {}); await sleep(300);
    await convMany(p, false);
    await p.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
