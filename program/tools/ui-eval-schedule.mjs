// 評価関数（開発用）: スケジュールのタブ（版 3.57.0。ScheduleView を移した。上の段の形は ui-proposals/2026-10-schedule.json の 3 回目 U3）。
//   node program/tools/ui-eval-schedule.mjs [1728x1152|1536x864|1280x720]   （省くと 3 つの大きさ全部）
// ① 見出しに「スケジュール」のタブ。設備のタブ（L-1・L-2・L-3・HOTコイル作業順）。見出しの帯の「終了」が画面に収まる
// ② 上の段の主の数・区分の札の数が、サーバーの答え（/api/src/sch の schedule.summary）と同じ
// ③ 区分の札を押すと、その区分の行だけ（件数がサーバーに同じ条件を問うた件数と同じ・行の区分）。「仕掛に無い」は当たらなかったロットだけ。「すべて」で戻る
// ④ 設備停止・点検の行に色（sd-stop・sd-inspect）。完了予定の順のとき日付の境に線（sd-daybreak）
// ⑤ HOT: 設備の札を押すとその設備だけ・釜番の札を押すとその釜番だけ（件数がサーバーと同じ）。帯の釜番の字は帯の中か、帯の上の段で、同じ段の字が重ならない
// ⑥ 上の段は 1 段（折り返さない）で、横にはみ出さない
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const VIEWS = process.argv[2] ? [process.argv[2]] : ["1728x1152", "1536x864", "1280x720"];
const app = await launch();
const count = (p) => p.$eval("#llCount", (x) => +x.textContent.replace(/[^0-9]/g, ""));
const settle = async (p) => { await sleep(300); await p.waitForFunction(() => !document.querySelector("#llBody")?.closest(".is-loading"), null, { timeout: 8000 }).catch(() => {}); await sleep(800); };
const ask = (p, q) => p.evaluate(async (q) => (await (await fetch("/api/src/sch?" + new URLSearchParams({ page_size: 2000, ...q }))).json()), q);
const kinds = (p) => p.$$eval("#llBody tr[data-i]", (trs) => trs.map((tr) => (tr.classList.contains("sd-stop") ? "設備停止" : tr.classList.contains("sd-inspect") ? "点検" : "製造")));
try {
  for (const v of VIEWS) {
    const p = await app.newPage("light", parseView(v));
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.evaluate(() => { TPA.local.set("tpa.sch.equip.v1", "L-1"); document.dispatchEvent(new CustomEvent("tpa:show-screen", { detail: "src:sch" })); });
    await p.waitForSelector("#llSched:not([hidden]) .sd-row", { timeout: 20000 }); await settle(p);
    const tab = await p.$eval('.screen-tabs [data-screen="src:sch"]', (b) => b.textContent.trim()).catch(() => "");
    const chips = await p.$$eval("#llEquipBar [data-equip]", (bs) => bs.map((b) => b.textContent.trim()));
    check(`${v} ① スケジュールのタブ・設備のタブ`, tab.includes("スケジュール") && chips.join("|") === "L-1|L-2|L-3|HOTコイル作業順", { tab, chips });
    const quit = await p.$eval("#quitBtn", (b) => b.getBoundingClientRect().right <= innerWidth + 1);
    check(`${v} ① 見出しの帯の「終了」が画面に収まる`, quit, quit);

    const d = await ask(p, { equip: "L-1" }), sm = d.schedule.summary;
    const top = await p.evaluate(() => ({ lead: document.querySelector("#llSched .sd-lead b").textContent, chips: Object.fromEntries([...document.querySelectorAll("#llSched [data-sd-pick]")].map((b) => [b.dataset.sdPick, b.querySelector("b")?.textContent || ""])) }));
    check(`${v} ② 主の数と区分の札の数がサーバーと同じ`, +top.lead === sm.count && +top.chips.inspect === sm.inspect && +top.chips.stop === sm.stop && +top.chips.miss === sm.missLots.length, { top, sm });
    const k0 = await kinds(p);
    check(`${v} ④ 設備停止・点検の行に色`, k0.filter((x) => x === "設備停止").length === sm.stop && k0.filter((x) => x === "点検").length === sm.inspect, k0);
    // 一覧は見える行だけを描く（virtual-rows.js）ので、送りながら探す
    const brk = await p.evaluate(async () => {
      const w = document.querySelector(".ll-grid-wrap");
      for (let y = 0; y <= w.scrollHeight; y += Math.max(100, w.clientHeight / 2)) {
        w.scrollTop = y; await new Promise((r) => setTimeout(r, 120));
        const tr = document.querySelector("#llBody tr.sd-daybreak");
        if (tr) { const prev = tr.previousElementSibling; w.scrollTop = 0; return { day: tr.children[1].textContent.slice(0, 5), prev: prev && prev.children[1].textContent.slice(0, 5) }; }
      }
      w.scrollTop = 0; return null;
    });
    check(`${v} ④ 日付の境に線（日付が変わる行）`, !!brk && brk.day !== brk.prev, brk);

    for (const [key, word] of [["stop", "設備停止"], ["inspect", "点検"]]) {
      await p.click(`#llSched [data-sd-pick="${key}"]`); await settle(p);
      const sv = (await ask(p, { equip: "L-1", filters: JSON.stringify([{ column: "区分", op: "in", value: JSON.stringify([word]) }]) })).count;
      const ks = await kinds(p);
      check(`${v} ③ 「${word}」の札で絞る（件数がサーバーと同じ・その区分の行だけ）`, (await count(p)) === sv && sv > 0 && ks.every((x) => x === word), { got: await count(p), sv, ks });
    }
    await p.click('#llSched [data-sd-pick="miss"]'); await settle(p);
    const lots = await p.$$eval("#llBody tr[data-i] .ll-lot", (bs) => bs.map((b) => b.dataset.lot));
    check(`${v} ③ 「仕掛に無い」の札は当たらなかったロットだけ`, lots.length > 0 && lots.every((l) => sm.missLots.includes(l)), { lots, miss: sm.missLots });
    await p.click('#llSched [data-sd-pick=""]'); await settle(p);
    check(`${v} ③ 「すべて」で戻る`, (await count(p)) === d.count, { got: await count(p), all: d.count });
    const row = await p.$eval("#llSched .sd-row", (r) => { const kids = [...r.children].map((c) => c.getBoundingClientRect()); return { h: r.getBoundingClientRect().height, sw: r.scrollWidth, cw: r.clientWidth, one: Math.max(...kids.map((k) => k.top)) - Math.min(...kids.map((k) => k.top)) < 12 }; });
    check(`${v} ⑥ 上の段が 1 段で、はみ出さない（設備）`, row.one && row.sw <= row.cw + 1, row);

    // HOT
    await p.click('#llEquipBar [data-equip="__HOT__"]');
    await p.waitForSelector("#llSched[data-mode=hot] .sd-tl", { timeout: 20000 }); await settle(p);
    const all = (await ask(p, { equip: "__HOT__" })).count;
    check(`${v} ⑤ HOT の主の数がサーバーと同じ`, +(await p.$eval("#llSched .sd-lead b", (b) => b.textContent)) === all && (await count(p)) === all, all);
    await p.click('#llSched [data-sd-pick="eq:L-2"]'); await settle(p);
    const sv2 = (await ask(p, { equip: "__HOT__", filters: JSON.stringify([{ column: "設備", op: "in", value: '["L-2"]' }]) })).count;
    check(`${v} ⑤ 設備の札「L-2」で絞る`, (await count(p)) === sv2 && sv2 > 0 && sv2 < all, { got: await count(p), sv2 });
    await p.click('#llSched [data-sd-pick="eq:"]'); await settle(p);
    const kama = await p.$eval("#llSched .sd-kchip[data-sd-kama]:not([data-sd-kama=__all])", (b) => b.dataset.sdKama);
    await p.click(`#llSched .sd-kchip[data-sd-kama="${kama}"]`); await settle(p);
    const sv3 = (await ask(p, { equip: "__HOT__", filters: JSON.stringify([{ column: "釜番", op: "in", value: JSON.stringify([kama]) }]) })).count;
    check(`${v} ⑤ 釜番の札で絞る`, (await count(p)) === sv3 && sv3 > 0, { got: await count(p), sv3, kama });
    await p.click('#llSched .sd-kchip[data-sd-kama="__all"]'); await settle(p);
    const tl = await p.evaluate(() => [...document.querySelectorAll("#llSched .sd-track")].map((t) => {
      const tags = [...t.querySelectorAll(".sd-tag")].map((x) => ({ r: x.className, b: x.getBoundingClientRect() }));
      const overlap = tags.some((a, i) => tags.some((c, j) => j > i && a.r === c.r && a.b.left < c.b.right && c.b.left < a.b.right));
      const blks = [...t.querySelectorAll(".sd-blk")];
      const labelled = blks.filter((b) => !b.classList.contains("is-tight") || tags.some((x) => x.b.left <= b.getBoundingClientRect().right && x.b.right >= b.getBoundingClientRect().left)).length;
      return { overlap, blks: blks.length, labelled };
    }));
    check(`${v} ⑤ 帯の釜番の字が重ならない`, tl.every((x) => !x.overlap), tl);
    check(`${v} ⑤ 帯の釜番の字は 8 割以上の帯に出る（帯の中か上の段）`, tl.every((x) => !x.blks || x.labelled / x.blks >= 0.8), tl);
    const hrow = await p.$eval("#llSched .sd-row", (r) => ({ sw: r.scrollWidth, cw: r.clientWidth }));
    check(`${v} ⑥ 上の段がはみ出さない（HOT）`, hrow.sw <= hrow.cw + 1, hrow);
    check(`${v} 画面のエラーが無い`, !errors.length, errors);
    await p.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
