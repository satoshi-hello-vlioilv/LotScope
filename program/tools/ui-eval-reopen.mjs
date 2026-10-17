// 評価関数（開発用）: 開き直したとき、閉じる前の見え方に戻るか（版 3.33.0）。
//   node program/tools/ui-eval-reopen.mjs
// 品質異常と作業実績で、画面の操作で次を変えてから、2 とおりに開き直し、同じに戻るかを数える。
//   スライサー: 開閉（画面ごと）・足した列・選んだ値・置き場・字の大きさ／一覧の拡大（画面ごと）／畳んだまとまり（まとめた表で）
// 開き直し ① 窓を閉じて開く（同じ PC の覚え〈localStorage〉は残り、この窓のあいだの覚え〈sessionStorage〉は消える）
//         ② WebView の作業場所が消えた PC（覚えは空。サーバーの画面の設定の控えから戻す）
// 全部合えば終了コード 0。
import { launch, sleep } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const ARRANGE = { "仕掛": { levels: [{ column: "設備", dir: "asc", lot: false }], heads: true, suppress: false } };

const ready = async (p) => { await p.waitForSelector("#llBody tr[data-i]", { timeout: 30000 }); await sleep(1500); };
async function go(p, tab) { await p.click(tab); await ready(p); }

/** 今の見え方（比べる物） */
const look = (p) => p.evaluate(() => {
  const slicer = document.querySelector("#llSlicer");
  const open = !!slicer && !slicer.hidden;
  return {
    slicerOpen: open,
    cards: open ? [...slicer.querySelectorAll(".sx-card")].map((c) => c.dataset.col) : null,
    picked: open ? [...slicer.querySelectorAll(".sx-v.is-on[data-v]")].map((b) => b.dataset.v) : null,
    place: open ? slicer.querySelector('[data-place][aria-checked="true"]')?.dataset.place : null,
    slicerZoom: open ? slicer.querySelector("[data-zoom] b")?.textContent : null,
    zoom: document.querySelector("#llZoomBtnValue").textContent,
    gridZoom: document.querySelector("#llGrid").style.zoom || "1",
    shut: [...document.querySelectorAll("#llBody tr.ll-ghead[aria-expanded='false']")].length,
    count: document.querySelector("#llCount")?.textContent.trim(),
  };
});

async function zoomTo(p, times) {
  await p.click("#llZoomBtn"); await p.waitForSelector("#llZoomPop:not([hidden])");
  for (let i = 0; i < times; i++) await p.click("#llZoomPlus");
  await p.keyboard.press("Escape"); await sleep(300);
}

const app = await launch();
try {
  const page = await app.newPage("light");
  const base = new URL(page.url()).origin;
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  // まとめた表（畳むまとまりを作る）
  await page.evaluate(async (a) => { TPA.local.set("tpa.lotlist.arrange.v1", a); await TPA.saveUiState(); }, ARRANGE);
  await page.reload(); await ready(page);

  // 品質異常: スライサーを開き、設備を足して 2 つ選び、上に置き、字を 120%。一覧を 120%。まとまりを 1 つ畳む
  await page.click("#llSlicerBtn"); await sleep(400);
  await page.selectOption("#llSlicerAdd", "設備"); await sleep(1200);
  const vals = await page.$$eval('#llSlicer .sx-card[data-col="設備"] .sx-v[data-v]', (b) => b.filter((x) => +x.dataset.n > 0).slice(0, 2).map((x) => x.dataset.v));
  for (const v of vals) { await page.click(`#llSlicer .sx-card[data-col="設備"] .sx-v[data-v="${v}"]`); await sleep(900); }
  await page.click('#llSlicer [data-place="top"]'); await sleep(400);
  await page.click("#llSlicer [data-zoom]"); await sleep(200);
  for (let i = 0; i < 2; i++) { await page.click("[data-zp]"); await sleep(100); }
  await page.keyboard.press("Escape"); await sleep(300);
  await zoomTo(page, 2);
  const head = await page.$("#llBody tr.ll-ghead .ll-gtog");
  if (head) { await head.click(); await sleep(500); }
  const list = await look(page);
  // 作業実績: スライサーは閉じたまま、一覧を 90%（品質異常と別に覚えるか）
  await go(page, "#tabWork");
  await page.click("#llZoomBtn"); await page.waitForSelector("#llZoomPop:not([hidden])");
  await page.click("#llZoomMinus"); await page.keyboard.press("Escape"); await sleep(300);
  const work = await look(page);
  await go(page, "#tabList");
  check("（前提）変えた所が画面に出ている", list.slicerOpen && list.picked.length === 2 && list.place === "top" && list.slicerZoom === "120%"
    && list.zoom === "120%" && list.shut === 1 && !work.slicerOpen && work.zoom === "90%", { list, work });
  await page.evaluate(() => TPA.saveUiState()); await sleep(300);

  const compare = async (tag, p) => {
    const l = await look(p);
    check(`${tag} 品質異常: スライサーの開閉・足した列・選んだ値`, l.slicerOpen === list.slicerOpen && JSON.stringify(l.cards) === JSON.stringify(list.cards)
      && JSON.stringify(l.picked) === JSON.stringify(list.picked), { now: l, was: list });
    check(`${tag} 品質異常: スライサーの置き場・字の大きさ`, l.place === list.place && l.slicerZoom === list.slicerZoom, { now: l, was: list });
    check(`${tag} 品質異常: 選んだ値で絞った件数`, l.count === list.count, { now: l.count, was: list.count });
    check(`${tag} 品質異常: 一覧の拡大 ${list.zoom}`, l.zoom === list.zoom && l.gridZoom === list.gridZoom, { now: [l.zoom, l.gridZoom], was: [list.zoom, list.gridZoom] });
    check(`${tag} 品質異常: 畳んだまとまり`, l.shut === list.shut, { now: l.shut, was: list.shut });
    await go(p, "#tabWork");
    const w = await look(p);
    check(`${tag} 作業実績: スライサーは閉じたまま・一覧の拡大 ${work.zoom}`, w.slicerOpen === work.slicerOpen && w.zoom === work.zoom && w.gridZoom === work.gridZoom, { now: w, was: work });
  };

  // ① 窓を閉じて開く: 同じ PC の覚えは残る・この窓のあいだの覚えは消える
  const again = await page.context().newPage();
  await page.close();
  await again.goto(`${base}/#screen=list`); await ready(again);   // 最初の画面はダッシュボード（版 3.37.0）。一覧から始める
  await compare("①", again);
  await again.context().close();

  // ② 作業場所が消えた PC: 覚えは空。サーバーの控えから戻す
  const ctx = await app.browser.newContext({ viewport: { width: 1728, height: 1152 }, deviceScaleFactor: 1.25, locale: "ja-JP" });
  await ctx.route("**/__desktop/**", (r) => r.fulfill({ status: 404, json: { error: "作り物の窓は答えません" } }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: "", headers: { "Content-Type": "text/css" } }));
  const fresh = await ctx.newPage();
  fresh.on("pageerror", (e) => errors.push(e.message));
  await fresh.goto(`${base}/#screen=list`); await ready(fresh);
  await compare("②", fresh);
  await ctx.close();
  check("頁の誤りが無い", !errors.length, errors);
} catch (e) {
  console.error(e); fails.push(String(e).slice(0, 200));
} finally {
  await app.close();
}
console.log(fails.length ? `NG ${fails.length} 件: ${fails.join(" / ")}` : "OK");
process.exit(fails.length ? 1 : 0);
