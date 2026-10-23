// 2026-10-23 ダッシュボードのスライサーの改良 2 回目（1 回目は 1 位 A 79.1 点で合格点 80 点に届かず）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-dslicer2.mjs --states dash-slicer --from dash
// 1 回目の採点で見えた弱い所（2026-10-dslicer.json の rounds[0]）:
//   A: ⚙ が字の無い印で、帯の OFF・出す物の編集がそこにあると推し量らせる／暦の面が札の真下からずれる／当てるまで 4 手／
//      パネルのスライサーの値の下が大きく空く。B・D: 1280 で帯の右端がはみ出す・折れる。C: 畳むと状態が見えない。E: OFF の帯を薄く残すと食い違う
// 案の方向（日付の選び方 × 帯の ON/OFF・編集の置き場 × パネルのスライサーの見せ方）:
//   F（A を直した物）札「日付…」→ 札の真下に暦。始めと終わりを押せば当たる（当てるの手を省く）／帯の右端は字のある「スライサー ▾」／縦の値の札をパネルの高さに広げる
//   G（新）帯の右端の「スライサー ▾」の面の中で ON/OFF・出す物（期間・日付・設備）・パネルのスライサーを足す、を 1 か所に／値の札は 2 列の格子
//   H（新）帯の中に ◀ 10/20 ▶ の日の送り（月の送りと同じ形）＋「日付…」／値は横に並ぶ札（件数の棒つき）を 3 列で
//   I（新）日付はタイムライン（Excel のタイムラインの型: 日の柱を引いて範囲）の面／値は縦の札
//   J（新）帯の左端に ON/OFF のスイッチ（字つき）・右端に「編集」。パネルのスライサーは見出しに「効くパネル 5 枚」と、選びの数を出すチェックの並び＋件数の棒
import { watch, VALS, BASE, afterMonth, barEnd, barStart, panel, datePicked } from "./2026-10-dslicer.mjs";

const CSS2 = BASE + `.mk-dchip{position:relative}.mk-slc{height:26px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:12.5px;font-weight:700;color:#1f3f60;white-space:nowrap}
  .mk-slc i{font-style:normal;font-size:10px;margin-left:4px}
  .mk-vals.tall{gap:6px;flex:1}.mk-vals.tall .mk-v{height:34px}.mk-foot{margin-top:auto;font-size:12px;color:#5b6872}
  .mk-g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}.mk-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.mk-g2 .mk-v,.mk-g3 .mk-v{height:34px}
  .mk-step{display:inline-flex;align-items:center;height:26px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12.5px;font-weight:700;color:#24446a;white-space:nowrap}
  .mk-step b{padding:0 8px}.mk-step span{padding:0 7px;color:#5b6872}.mk-step.on{background:#24446a;color:#fff;border-color:#24446a}.mk-step.on span{color:#dbe6f0}
  .mk-tl{display:flex;align-items:flex-end;gap:2px;height:46px;margin:6px 0 4px}.mk-tl span{flex:1;background:#c9d6e2;border-radius:2px 2px 0 0}.mk-tl span.in{background:#24446a}
  .mk-tlx{display:flex;justify-content:space-between;font-size:11.5px;color:#5b6872}
  .mk-row{display:flex;align-items:center;gap:8px;height:28px}.mk-row .mk-sw{margin-left:auto}.mk-off i{background:#9aa6b0!important}.mk-off i::after{left:2px;right:auto}
  .mk-h{font-size:12px;font-weight:700;color:#5b6872;margin:8px 0 2px}
  .mk-cb{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:6px;height:30px;font-size:13px;position:relative}.mk-cb em{font-style:normal;color:#5b6872;font-variant-numeric:tabular-nums}
  .mk-cb i{position:absolute;left:24px;bottom:2px;height:3px;background:#9db6cc;border-radius:2px}`;
// 札の真下に面を出す（1 回目の採点: 暦の面が札の真下から左にずれた）
// 面は撮る前の操作（期間・設備の札を押す）を妨げないよう、押せない形で出し、札の今の位置へ置き直し続ける
const under = (sel, html) => ["script", `{ document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); const p = document.querySelector(".mk-pop"); p.style.pointerEvents = "none"; p.style.visibility = "hidden";
  setInterval(() => { const c = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent); if (!c) { p.style.visibility = "hidden"; return; } const r = c.getBoundingClientRect();
    p.style.top = (r.bottom + 6) + "px"; p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 12)) + "px"; p.style.visibility = "visible"; }, 100); }`];
const days = (a, b) => Array.from({ length: 31 }, (_, i) => `<span class="${i + 1 === a || i + 1 === b ? "end" : i + 1 > a && i + 1 < b ? "in" : ""}">${i + 1}</span>`).join("");
const cal = `<div class="mk-pop"><div style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><b>2026年10月</b><span style="margin-left:auto">◀ ▶</span></div>`
  + `<div class="mk-cal">${"日月火水木金土".split("").map((d) => `<b>${d}</b>`).join("")}${"<span></span>".repeat(4)}${days(5, 20)}</div>`
  + `<div style="margin-top:8px;font-size:12px;color:#5b6872">始めの日と終わりの日を押すと当たります（1 日だけは同じ日を 2 回）</div></div>`;
const dchip = `<button class="ds-chip on mk-dchip" title="日・期間を選ぶ">日付 10/5〜10/20</button>`;
const slc = `<button class="mk-slc" title="帯を出す・出さない／出す物／パネルのスライサーを足す">スライサー<i>▾</i></button>`;
const card = (cls) => VALS.map(([v, n], i) => `<span class="mk-v${i === 1 ? " on" : ""}"><span>${v}</span><span>${n}</span><i style="width:${Math.round(n / 191 * 100)}%"></i></span>`).join("");
const head = (sub) => `<div class="mk-sph">仕掛区分<small>${sub}</small><a class="mk-x">× 選びを外す</a></div>`;
const foot = `<div class="mk-foot">同じデータ（仕掛）の 3 枚のパネルに効いています</div>`;

export const PROPOSALS = [
  { key: "F", name: "F（A を直した物）札「日付…」の真下に暦・押せば当たる／字のある「スライサー ▾」／縦の値の札をパネルの高さに", css: CSS2,
    ops: [datePicked, afterMonth(dchip), barEnd(slc), panel(`<div class="mk-sp">${head("スライサー")}<div class="mk-vals tall">${card()}</div>${foot}</div>`), under(".mk-dchip", cal)] },
  { key: "G", name: "G「スライサー ▾」の面に ON/OFF・出す物・パネルのスライサーを足すを 1 か所に／値の札は 2 列の格子", css: CSS2,
    ops: [datePicked, afterMonth(dchip), barEnd(slc), panel(`<div class="mk-sp">${head("スライサー")}<div class="mk-g2">${card()}</div>${foot}</div>`),
      under(".mk-slc", `<div class="mk-pop" style="width:260px"><div class="mk-row"><b>帯のスライサー</b><span class="mk-sw"><i></i>出す</span></div><div class="mk-h">出す物</div>`
        + `<label class="mk-ck"><input type="checkbox" checked>期間</label><label class="mk-ck"><input type="checkbox" checked>日付</label><label class="mk-ck"><input type="checkbox" checked>設備</label>`
        + `<div class="mk-h">パネルのスライサー</div><button class="mk-add" style="width:100%">＋ 列の値で絞るパネルを足す…</button></div>`)] },
  { key: "H", name: "H 帯の中に ◀ 10/20 ▶ の日の送り＋「日付…」／値は横に並ぶ札（件数の棒）を 3 列で", css: CSS2,
    ops: [datePicked, afterMonth(`<span class="mk-step on"><span>◀</span><b>10/20</b><span>▶</span></span><button class="ds-chip">日付…</button>`), barEnd(slc),
      panel(`<div class="mk-sp">${head("スライサー")}<div class="mk-g3">${card()}</div>${foot}</div>`)] },
  { key: "I", name: "I 日付はタイムライン（日の柱を引いて範囲）の面／値は縦の札", css: CSS2,
    ops: [datePicked, afterMonth(dchip), barEnd(slc), panel(`<div class="mk-sp">${head("スライサー")}<div class="mk-vals tall">${card()}</div>${foot}</div>`),
      under(".mk-dchip", `<div class="mk-pop" style="width:420px"><div style="display:flex;align-items:center"><b>日付</b><small style="margin-left:8px;color:#5b6872">柱を引いて範囲を選ぶ</small><span style="margin-left:auto;font-weight:700;color:#24446a">10/5〜10/20</span></div>`
        + `<div class="mk-tl">${Array.from({ length: 31 }, (_, i) => `<span class="${i + 1 >= 5 && i + 1 <= 20 ? "in" : ""}" style="height:${30 + ((i * 37) % 60)}%"></span>`).join("")}</div><div class="mk-tlx"><span>10/1</span><span>10/8</span><span>10/15</span><span>10/22</span><span>10/31</span></div></div>`)] },
  { key: "J", name: "J 帯の左端に字つきの ON/OFF・右端に「編集」／パネルのスライサーはチェックの並び＋件数の棒・効くパネルの数", css: CSS2,
    ops: [datePicked, afterMonth(dchip), barStart(`<span class="mk-sw"><i></i>スライサー</span>`), barEnd(`<button class="mk-slc">編集</button>`),
      panel(`<div class="mk-sp"><div class="mk-sph">仕掛区分<small>1 / 5 を選んでいます</small><a class="mk-x">× 選びを外す</a></div>${VALS.map(([v, n], i) => `<label class="mk-cb"><input type="checkbox"${i === 1 ? " checked" : ""}><span>${v}</span><em>${n}</em><i style="width:${Math.round(n / 191 * 60)}%"></i></label>`).join("")}${foot}</div>`)] },
];
