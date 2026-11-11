// 評価関数（開発用。版 3.96.0。利用者の報告 2026-11-11）: 数字のパネルの「④ 置き方 → 期間・元の置き場」（fmt.kmeta）が、
// 組む所の見本・編集中・「編集を終える」で確定した所・保存して開き直した所で、どれも選んだとおり（期間を下・期間を上・横 1 列）に描かれるか。
//   node program/tools/ui-eval-kpimeta.mjs [--view 1728x1152]
// 置き方 3 つ × 値の並べ方 4 つ（主と添え〈値 2 つ〉・左右に 2 つ・上下に 2 つ・値 1 つ〈利用者のパネルと同じ形: 重量の合計 ÷1000・t・今月〉）×
// パネルの大きさ 3 つ（低い 4×1・普通 3×2・広い 5×2）× 窓の大きさ 3 つ（1728・1536×864・1280×720）。確かめること:
// 1. 期間・元の札が、数（単位まで）に対して選んだ側（下・上・右横）にある。4 つの状態で同じ
// 2. 組む所で見本を押すと、引き直しを待たずに（押して 150ms で）パネルがその形になる・引き直さない
// 3. 字がパネルからはみ出さない（数・単位・期間の札が中身の枠の中）・期間の札の字が 11px 以上で高さが潰れない（12px 以上）・単位 t が出ている。
//    どう縮めても入らない形（1280 の 1 段のパネル〈中身の高さ 20px ほど〉に数と期間を上下に置くなど）は、置き場を変えずに期間・元を出さず
//    （中身の高さが 主と添え 40px・2 つ並べる形 60px 未満のときだけ。主と添えの数は 14px 以上で入り、期間・元は説明〈title〉に）、パネルに「きつい」の印（data-ktight）がある
// 4. 選んだ置き方では字が小さくなりすぎる・入らないパネル（数が 16px 未満か、きついの印）は、組む所の ④ で知らせる（黙って横に変えない。
//    期間・元を出していなければ、そう言う）。入る形では知らせない
// 全部合えば終了コード 0
import { launch, parseView, sleep, waitDash } from "./ui-harness.mjs";

process.env.TPA_UI_BYPASS_CSP = "1";
const vi = process.argv.indexOf("--view");
const VIEWS = vi > 0 ? [process.argv[vi + 1]] : ["1728x1152", "1536x864", "1280x720"];
const W1 = { agg: "sum", column: "重量", expr: "÷1000", dec: 1, utext: "t", hideExpr: true };
const PERIOD = { column: "発生日", kind: "this_month" };
const ARR = { a: { kpair: "", ms: [W1, { agg: "lots", utext: "" }] }, s: { kpair: "side", ms: [W1, { agg: "lots", utext: "ロット" }] },
  k: { kpair: "stack", ms: [W1, { agg: "lots", utext: "ロット" }] }, o: { kpair: "", ms: [W1] } };
const SIZES = { low: [4, 1], norm: [3, 2], wide: [5, 2] };
const AT = { a: 0, s: 2, k: 4, o: 6 };
const panels = [];
for (const [ak, a] of Object.entries(ARR)) {
  let x = 0;
  for (const [sk, [w, h]] of Object.entries(SIZES)) {
    panels.push({ id: `${ak}-${sk}`, x, y: AT[ak], w, h, title: "今月累計異常ロット廃棄重量", visual: "kpi", source: "lot", period: PERIOD,
      body: { rows: [], cols: [], measures: a.ms, grand: true }, ...(a.kpair ? { fmt: { kpair: a.kpair } } : {}) });
    x += w;
  }
}
const LAYOUT = { rows: 8, panels };
const NAME = { "": "期間を下", top: "期間を上", row: "横 1 列" };
const REL = { "": "下", top: "上", row: "右横" };

let bad = 0, n = 0;
const fails = [];
const check = (name, ok, got) => { n++; if (!ok) { bad++; fails.push(name); console.log(`NG  ${name}: ${JSON.stringify(got)}`); } };

/** 頁の中: パネルの数と期間の札の置き場（下・上・右横）と収まり */
const measure = (ids) => ids.map((id) => {
  const el = document.querySelector(`#dashGrid .db-p[data-id="${CSS.escape(id)}"]`);
  if (!el) return { id, err: "パネルが無い" };
  const body = el.querySelector(".db-pb"), meta = body.querySelector(".dp-kmeta");
  const parts = [...body.querySelectorAll(".dp-kpair, .dp-ksub, .dp-num")];
  if (!meta || !parts.length) return { id, err: meta ? "数が無い" : "期間の札が無い", html: body.innerHTML.slice(0, 160) };
  const tight = body.querySelector(".dp-kpi")?.dataset.ktight || "", note = (document.querySelector("#deKNote:not([hidden])") || {}).textContent || "";
  // 入る高さが無くて添え書きを出していない形（きついの印に hid）: 置き場は測れない。数が読めて、中身が説明（title）に残るかを見る
  if (meta.hidden) { const num = body.querySelector(".dp-num"), nr = num.getBoundingClientRect(), br = body.getBoundingClientRect();
    return { id, hid: true, tight, note, H: Math.round(body.clientHeight), numPx: parseFloat(num.style.fontSize), titled: !!body.querySelector(".dp-kpi")?.title,
      inside: nr.top >= br.top - 1 && nr.bottom <= br.bottom + 1 && nr.right <= br.right + 1, unit: num.querySelector("small")?.textContent || "" }; }
  const rs = parts.map((x) => x.getBoundingClientRect()), m = meta.getBoundingClientRect(), b = body.getBoundingClientRect();
  const u = { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), btm: Math.max(...rs.map((r) => r.bottom)) };
  const rel = m.top >= u.btm - 1 ? "下" : m.bottom <= u.t + 1 ? "上" : m.left >= u.r - 1 ? "右横" : "重なり";
  const z = el.getBoundingClientRect().width / el.offsetWidth || 1;      // 組む所は縮めて見せることがある（transform）
  const inside = [...rs, m].every((r) => r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1);
  const nums = [...body.querySelectorAll(".dp-num")];
  return { id, rel, inside, over: body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1,
    metaPx: parseFloat(getComputedStyle(meta).fontSize), metaH: Math.round(m.height / z), numPx: Math.min(...nums.map((x) => parseFloat(x.style.fontSize || getComputedStyle(x).fontSize))),
    unit: nums[0].querySelector("small")?.textContent || "", tight, H: Math.round(body.clientHeight), W: Math.round(body.clientWidth), z: +z.toFixed(2), note };
});

/** 添え書きを出していない形: どう縮めても入らない高さのときだけ・単位 t・中身は説明に・きついの印。
    入る高さの下限: 主と添え＝数 14px（15）＋間 4＋添え書き 17＝36 → 40px 未満だけ。数が 14px 以上でパネルに入る。
    左右・上下に 2 つ＝名前 16＋数 15（上下は数 2 つ 32）＋間 6＋添え書き 17＝54〜55 → 60px 未満だけ（名前と 2 つの数は、きついの印と組む所の知らせで見る） */
const checkHid = (tag, r) => { const pair = /^[ks]-/.test(r.id);
  check(`${tag} 期間・元を出さないのは入る高さが無いときだけ（主と添えは数が 14px 以上で入る・期間・元は説明に）`,
    r.H < (pair ? 60 : 40) && (pair || (r.numPx >= 14 && r.inside)) && r.unit === "t" && r.titled && /hid/.test(r.tight), r); };
const verify = (v, state, rows, want) => {
  for (const r of rows) {
    const tag = `${v} ${state} ${r.id} ${NAME[want]}`;
    if (r.err) { check(`${tag} 描けている`, false, r); continue; }
    if (r.hid) { checkHid(tag, r); continue; }
    check(`${tag} 期間の札が数の${REL[want]}`, r.rel === REL[want], r);
    check(`${tag} はみ出さない（入らない形はきついの印）・期間の札 11px 以上で潰れない・単位 t`, ((r.inside && !r.over) || !!r.tight) && r.metaPx >= 11 && r.metaH >= 12 && r.unit === "t", r);
  }
};

const ids = panels.map((p) => p.id);
const app = await launch();
const t0 = Date.now();
try {
  for (const v of VIEWS) {
    const page = await app.newPage("light", parseView(v), { screen: "dash" });
    await page.evaluate((l) => Dashboard._setLayout(l), LAYOUT); await sleep(600); await waitDash(page); await sleep(700);
    verify(v, "置いた直後", await page.evaluate(measure, ids), "");
    for (const want of ["top", "row", ""]) {
      await page.click("[data-db-editmode]"); await sleep(500); await waitDash(page);
      for (const id of ids) {
        await page.focus(`#dashGrid .db-p[data-id="${id}"]`); await page.keyboard.press("Enter");
        await page.waitForSelector("#deKLay .de-kth"); await waitDash(page); await sleep(250);
        // 開いた直後（まだ見本を押していない）も、入らない置き方なら ④ で知らせている
        const [r0] = await page.evaluate(measure, [id]);
        check(`${v} 組む所 ${id} 開いた直後も、入らない置き方なら ④ で知らせる`, !!r0.err || (!r0.tight ? !r0.note : /小さ|出していません/.test(r0.note)), r0);
        let asked = 0;
        const count = (r) => { if (r.url().includes("/api/dashboard/query")) asked++; };
        page.on("request", count);
        // 見本を押した直後（150ms。引き直しを待たない）に、パネルがその形になる。最後に押すのが、この回の置き方
        for (const k of [...["", "top", "row"].filter((x) => x !== want), want]) {
          await page.click(`#deKLay [data-de-klay="kmeta"][data-v="${k}"]`); await sleep(150);
          const [r] = await page.evaluate(measure, [id]);
          const tag = `${v} 組む所 ${id} ${NAME[k]}`;
          if (r.err) { check(`${tag} 描けている`, false, r); continue; }
          if (r.hid) { checkHid(tag, r); check(`${tag} 期間・元を出していないことを ④ で知らせる`, /出していません/.test(r.note), r); }
          else {
          check(`${tag} 押してすぐ期間の札が数の${REL[k]}`, r.rel === REL[k], r);
          check(`${tag} はみ出さない（入らない形はきついの印）・期間の札 11px 以上で潰れない・単位 t`, ((r.inside && !r.over) || !!r.tight) && r.metaPx >= 11 && r.metaH >= 12 && r.unit === "t", r);
          check(`${tag} 字が 16px 未満になる・入らない置き方は ④ で知らせる`, (r.numPx >= 16 && !r.tight) || /小さ/.test(r.note), r);
          check(`${tag} 入る置き方では ④ で知らせない`, !!r.tight || !r.note, r);
          }
          const on = await page.evaluate(() => [...document.querySelectorAll('#deKLay .de-kth.on[data-de-klay="kmeta"]')].map((x) => x.dataset.v));
          check(`${tag} 押した見本が選ばれている`, on.length === 1 && on[0] === k, on);
        }
        page.off("request", count);
        check(`${v} 組む所 ${id} 置き方を替えても引き直さない`, asked === 0, asked);
        await page.click("[data-de-apply]"); await sleep(400);
      }
      await waitDash(page); await sleep(500);
      verify(v, "編集中", await page.evaluate(measure, ids), want);
      await page.click("[data-db-save]"); await page.waitForFunction(() => /保存しました|入れ替えました/.test(document.querySelector("#dashBar .db-msg")?.textContent || ""), null, { timeout: 15000 });
      await sleep(300);
      await page.click("[data-db-leave]"); await sleep(600); await waitDash(page); await sleep(400);
      verify(v, "確定後", await page.evaluate(measure, ids), want);
      const saved = await page.evaluate(() => Dashboard._state().layout.panels.map((p) => (p.fmt || {}).kmeta || ""));
      check(`${v} 確定後 組みに残った置き方が ${NAME[want]}`, saved.every((x) => x === want), saved);
      await page.reload(); await waitDash(page); await sleep(900);
      verify(v, "開き直した所", await page.evaluate(measure, ids), want);
      const back = await page.evaluate(() => Dashboard._state().layout.panels.map((p) => (p.fmt || {}).kmeta || ""));
      check(`${v} 開き直した所 保存した置き方が ${NAME[want]}`, back.length === ids.length && back.every((x) => x === want), back);
    }
    await page.close();
  }
} finally {
  await app.close();
}
const byState = {};
for (const f of fails) { const k = f.split(" ").slice(0, 2).join(" "); byState[k] = (byState[k] || 0) + 1; }
if (bad) console.log("違う数（窓の大きさ・状態ごと）:", JSON.stringify(byState));
console.log(bad ? `NG ${n} 件中 ${bad} 件が違う（${Math.round((Date.now() - t0) / 1000)} 秒）` : `OK（${n} 件・${Math.round((Date.now() - t0) / 1000)} 秒）`);
process.exit(bad ? 1 : 0);
