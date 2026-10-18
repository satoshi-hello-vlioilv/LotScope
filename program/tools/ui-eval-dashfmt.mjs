// 評価関数（開発用）: ダッシュボードの版 3.43.0（利用者の要望 2026-10）。
//   node program/tools/ui-eval-dashfmt.mjs
// ① パネルの題を変えられる: 組む所の題の欄に打つと、パネルの見出しがその場で変わり、当てる → 名前を付けて保存 → 開き直しても残る。カラムの検索も当たる
//    （前は TPA.onText の受け取りを値と取り違え、打つたびに止まっていた）
// ② 値の表示形式（Excel の書式コード）: 数字（前日の実績本数）に 数値・桁区切り・小数 1 桁・後ろに「本」を当てると、パネルの数がその形（自動の単位を重ねない）・
//    ユーザー定義の [赤]"▲" で負の数の見本が赤・コードの知らせ（日付のコード）・合わせた表のセルにも当たる・集計表の形のセルにも当たる
// ③ 配置と字: 数字を右寄せ・下・特大・色 → 数の右端がパネルの右に寄る・数が大きくなる・色が付く。表は中央寄せ
// ④ 1280×720 でも、組む所の表示形式の欄が切れない（横に送らない）
// 全部合えば終了コード 0。
import { launch, sleep, parseView, waitDash } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (id) => `#dashGrid .db-p[data-id="${id}"]`;
const errors = [];

async function openEditor(p, id) {
  if (!(await p.$("#dashScreen.is-edit"))) { await p.click("[data-db-editmode]"); await sleep(300); }
  await p.focus(P(id)); await p.keyboard.press("Enter");
  await p.waitForSelector(id === "board" ? "#deBoard .de-rowi[data-de-row]" : "#deFields .pv-f"); await waitDash(p); await sleep(300);
}
// 選びの欄（select）は値を入れて change。札（ラジオ: 表示形式の分類・負の数）は、その値の札を押す
const pick = (p, sel, value) => p.evaluate(([s, v]) => { const x = document.querySelector(s); if (x.type === "radio") { document.querySelector(`${s}[value="${v}"]`).click(); return; }
  x.focus(); x.value = v; x.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, value]);
const radio = (p, attr, value) => p.evaluate(([a, v]) => document.querySelector(`#dbEditor input[${a}][value="${v}"]`).click(), [attr, value]);
const typeIn = async (p, sel, text) => { await p.fill(sel, text); await p.evaluate((s) => document.querySelector(s).dispatchEvent(new Event("change", { bubbles: true })), sel); await sleep(400); };

const app = await launch();
try {
  const p = await app.newPage("light", parseView("1728x1152"), { screen: "dash" });
  p.on("pageerror", (e) => errors.push(e.message));
  await waitDash(p);

  // ① 題
  await openEditor(p, "workTotal");
  await p.click("#deTitle", { clickCount: 3 }); await p.keyboard.type("昨日の本数（全設備）"); await sleep(500);
  const head = await p.$eval(`${P("workTotal")} .db-ph`, (h) => h.textContent).catch(() => p.$eval(P("workTotal"), (x) => x.textContent));
  check("① 題の欄に打つと、パネルの見出しがその場で変わる", head.includes("昨日の本数（全設備）"), head);
  await p.fill("#deSearch", "重量"); await sleep(300);
  const hits = await p.$$eval("#deFields .pv-f b", (bs) => bs.map((b) => b.textContent));
  check("① カラムの検索が当たる（重量）", hits.length >= 1 && hits.every((t) => t.includes("重量")), hits);
  await p.fill("#deSearch", ""); await sleep(200);

  // ② 表示形式: 数値・桁区切り・小数 1 桁・後ろに本
  const fmtOpen = await p.$("#dbEditor [data-de-fncat]");
  if (!fmtOpen) { await p.click("#dbEditor [data-de-fmtopen]"); await sleep(200); }
  await pick(p, "#dbEditor [data-de-fncat]", "num"); await sleep(500);
  await pick(p, "#dbEditor [data-de-fndec]", "1"); await sleep(400);
  // 版 3.45.0: 数字のパネルの後ろの字は「単位」の 1 か所（表示形式の「後ろに」は出さない）
  check("② 数字のパネルには表示形式の「後ろに」が無い（単位の欄で決める）", !(await p.$("#dbEditor [data-de-nsuf]")) && !!(await p.$("#dbEditor [data-de-futext]")), "");
  await p.fill("#dbEditor [data-de-futext]", "本/日"); await sleep(600); await waitDash(p);
  const st = await p.evaluate(() => Dashboard._state());
  const fm = st.layout.panels.find((x) => x.id === "workTotal").fmt || {};
  const v = (st.answers.workTotal.cells.find((c) => !c.r.length && !c.c.length) || { v: [0] }).v[0];
  const want = `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}本/日`;
  const num = await p.$eval(`${P("workTotal")} .dp-num`, (b) => b.textContent);
  check("② 表示形式のコードが組まれる（#,##0.0）・単位は「本/日」", fm.num === "#,##0.0" && fm.utext === "本/日", fm);
  check(`② 数字がその形（${want}）・自動の単位「本」を重ねない`, num === want, num);
  const sample = await p.$eval("#deNumSample", (x) => x.textContent);
  check("② 見本に、いまの数・負の数・0 が出る（単位も添えて）", sample.includes(want) && sample.includes(`-${want}`) && sample.includes("0.0本/日"), sample);
  await p.click("#dbEditor [data-de-futextx]"); await sleep(400);     // 単位を自動に戻す（下のユーザー定義のコードに字を入れるので）
  // ユーザー定義: [赤]"▲" → 見本の負の数が赤・日付のコードは知らせる
  await pick(p, "#dbEditor [data-de-fncat]", "custom"); await sleep(400);
  await typeIn(p, "#dbEditor [data-de-ncode]", '#,##0"本";[赤]"▲"#,##0"本"');
  const red = await p.$$eval("#deNumSample td span", (xs) => xs.map((x) => [x.textContent, getComputedStyle(x).color]));
  check("② ユーザー定義の [赤]\"▲\": 見本の負の数が ▲ で赤", red.some(([t, c]) => t.startsWith("▲") && c === "rgb(198, 40, 40)"), red);
  await typeIn(p, "#dbEditor [data-de-ncode]", "yyyy/mm/dd");
  const warn = await p.$eval("#deNumSample", (x) => x.textContent);
  check("② 日付のコードは使えないと知らせる", warn.includes("日付・時刻の書式は使えません"), warn);
  await typeIn(p, "#dbEditor [data-de-ncode]", '#,##0"本"');

  // ③ 配置と字
  await radio(p, "data-de-falign", "right"); await sleep(300);
  await radio(p, "data-de-fvalign", "bottom"); await sleep(300);
  const small = await p.$eval(`${P("workTotal")} .dp-num`, (b) => parseFloat(getComputedStyle(b).fontSize));
  await radio(p, "data-de-fnsize", "xl"); await sleep(300);
  await p.evaluate(() => { const c = document.querySelector("#dbEditor [data-de-fncolor]"); c.value = "#2e7d32"; c.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(600); await waitDash(p);
  const geo = await p.evaluate((sel) => {
    const box = document.querySelector(`${sel} .db-pb`) || document.querySelector(sel), n = document.querySelector(`${sel} .dp-num`);
    const b = box.getBoundingClientRect(), r = n.getBoundingClientRect();
    return { gapR: Math.round(b.right - r.right), gapL: Math.round(r.left - b.left), gapB: Math.round(b.bottom - r.bottom), gapT: Math.round(r.top - b.top), size: parseFloat(getComputedStyle(n).fontSize), color: getComputedStyle(n).color };
  }, P("workTotal"));
  check("③ 右寄せ: 数の右の空きが左の空きより小さい", geo.gapR < geo.gapL, geo);
  check("③ 特大: 数の字が大きくなる（入りきる範囲で）", geo.size >= small, { small, geo });
  check("③ 字の色", geo.color === "rgb(46, 125, 50)", geo);
  await p.click("[data-de-apply]"); await sleep(500); await waitDash(p);

  // 表（合わせた表）: 表示形式と中央寄せ
  await openEditor(p, "board");
  const tabWhole = await p.$("#deTabs [data-de-tab='-1']");
  if (tabWhole) { await tabWhole.click(); await sleep(400); }
  if (!(await p.$("#dbEditor [data-de-fncat]"))) { await p.click("#dbEditor [data-de-fmtopen]").catch(() => {}); await sleep(300); }
  const hasFmt = !!(await p.$("#dbEditor [data-de-fncat]"));
  check("② 合わせた表にも表示形式の欄がある", hasFmt, null);
  if (hasFmt) {
    await pick(p, "#dbEditor [data-de-fncat]", "custom"); await sleep(300);
    await typeIn(p, "#dbEditor [data-de-ncode]", '0"台"'); await waitDash(p);
    await radio(p, "data-de-falign", "center"); await sleep(500); await waitDash(p);
    const cells = await p.$$eval(`${P("board")} td.num`, (tds) => tds.slice(0, 6).map((td) => [td.textContent.trim(), getComputedStyle(td).textAlign]));
    check("② 合わせた表のセルが表示形式（台）・③ 中央寄せ", cells.length > 0 && cells.filter(([t]) => t !== "–" && t !== "").every(([t, a]) => /台$/.test(t) && a === "center"), cells);
    await p.click("[data-de-apply]"); await sleep(500); await waitDash(p);
  }

  // 名前を付けて保存 → 開き直しても題・書式が残る
  await p.click("[data-db-saveas]"); await sleep(300);
  await p.fill("#dbSaveName", "書式の確かめ"); await p.keyboard.press("Enter"); await sleep(1200);
  await p.reload(); await waitDash(p); await sleep(500);
  const again = await p.evaluate(() => { const s = Dashboard._state(), w = s.layout.panels.find((x) => x.id === "workTotal"); return { title: w.title, fmt: w.fmt, num: document.querySelector('#dashGrid .db-p[data-id="workTotal"] .dp-num').textContent }; });
  check("① ② 開き直しても題・表示形式・配置が残る", again.title === "昨日の本数（全設備）" && again.fmt.num === '#,##0"本"' && again.fmt.align === "right" && /本$/.test(again.num), again);

  // ④ 1280×720: 組む所の表示形式の欄が切れない
  const q = await app.newPage("light", parseView("1280x720"), { screen: "dash" });
  await waitDash(q);
  await openEditor(q, "workTotal");
  if (!(await q.$("#dbEditor [data-de-fncat]"))) { await q.click("#dbEditor [data-de-fmtopen]"); await sleep(200); }
  await pick(q, "#dbEditor [data-de-fncat]", "num"); await sleep(400);
  const cut = await q.evaluate(() => {
    const ed = document.querySelector("#dbEditor .de-main"), r = ed.getBoundingClientRect();
    const bad = [...document.querySelectorAll("#dbEditor .de-fmt .de-row > *")].filter((x) => { const b = x.getBoundingClientRect(); return b.width && (b.right > r.right + 1 || b.left < r.left - 1); }).map((x) => x.outerHTML.slice(0, 80));
    return { bad, scroll: ed.scrollWidth > ed.clientWidth + 1 };
  });
  check("④ 1280×720: 表示形式の欄が切れない・横に送らない", !cut.bad.length && !cut.scroll, cut);
  await q.context().close();
  check("頁の誤りが無い", !errors.length, errors);
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件` : "OK");
process.exit(fails.length ? 1 : 0);
