// 評価関数（開発用。版 3.47.0）: グラフの字（項目の名前・軸の字）を、余白があるのに「…」で切っていないか。
// 利用者の要望（2026-10-21 の 2 回目の 5）: 「余白があるのにグラフのラベルを出し切れず途中省略するケースがある。余白がある場合はしっかり表示してほしい」。
//   node program/tools/ui-eval-labels.mjs [画像を置くフォルダ]
// 長い名前（4〜22 字。全角・半角まじり）の項目を持つ答えを作り、集計表・ダッシュボードと同じ描き方（LotListPivotCharts.draw）で、
// 項目の名前を軸に出す形を、ダッシュボードのパネルの大きさ（詰めた形）と一覧の集計表の大きさで描き、字ごとに測る:
//   ① 余白があるのに切った字 … 「…」で切った字のうち、全部の字の幅が、そこで使える幅に入る物（0 で合格）
//        横軸の字（真ん中ぞろえ）… 隣の字の真ん中までの近い方の 2 倍 − 4px（隣が無ければ図の端まで）
//        縦の名前（右ぞろえ。横棒）… 字の右の端から図の左の端まで − 2px
//   ② 字の重なり … 同じ段の字どうしが 1px より多く重なる（0 で合格）
//   ③ はみ出し … 字が図（svg）の外へ 1px より多く出る（0 で合格）
// 全部合えば終了コード 0。
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./ui-harness.mjs";

const SHOT = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 1600)}`}`); if (!ok) fails.push(name); };

const KINDS = ["column", "lollipop", "pareto", "bar", "line", "combo", "area", "stack", "stack100", "heat", "donut", "treemap"];
// 大きさ: ダッシュボードのパネル（詰めた形）3 つと、一覧の集計表（詰めない形）
const SIZES = [{ W: 420, H: 240, compact: true }, { W: 660, H: 300, compact: true }, { W: 980, H: 360, compact: true }, { W: 1240, H: 320, compact: false }];
const NAMES = {
  few: ["A1100-H14 箔用", "A5052-O 試作ロット", "A3004-H24", "ＣＲ２ 再処理（ロール替え後）", "L-1"],
  many: ["A1100-H14 箔用", "A5052-O 試作ロット", "A3004-H24", "ＣＲ２ 再処理", "L-1", "TLV 通常", "LS3-速度落とし", "DL2 検査待ち", "ﾛｰﾙ1 出荷待ち", "8･10mm 厚板",
    "パイラー材", "クレーン材"],
};

const app = await launch();
try {
  const p = await app.newPage("light", { width: 1728, height: 1152 });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.waitForFunction(() => !!window.LotListPivotCharts);
  const all = [];
  for (const [setName, names] of Object.entries(NAMES)) {
    for (const size of SIZES) {
      const res = await p.evaluate(({ names, size, kinds }) => {
        const C = window.LotListPivotCharts;
        // 答え: 行の段＝項目（名前）・列の段（積み上げ・ヒートマップの形だけ）＝3 つ・値＝ロット数と重量の平均
        const cols = ["通常", "再処理", "試作"];
        const mk = (withCols) => {
          const cells = [];
          names.forEach((n, i) => {
            if (withCols) cols.forEach((c, k) => cells.push({ r: [n], c: [c], v: [10 + ((i * 7 + k * 5) % 23), 300 + i * 11] }));
            cells.push({ r: [n], c: [], v: [30 + ((i * 13) % 41), 300 + i * 11] });
          });
          if (withCols) cols.forEach((c) => cells.push({ r: [], c: [c], v: [100, 300] }));
          cells.push({ r: [], c: [], v: [500, 320] });
          return { dims: { rows: [{ column: "品種", name: "品種" }], cols: withCols ? [{ column: "区分", name: "区分" }] : [] }, measures: [{ agg: "lots" }, { agg: "avg", column: "重量" }],
            orders: [names, ...(withCols ? [cols] : [])], labels: [{}, {}], cells, count: 500, truncated: { rows: false, cols: false }, bins: [], stats: {}, months: [] };
        };
        const out = [];
        for (const kind of kinds) {
          const withCols = ["stack", "stack100", "heat"].includes(kind);
          const d = mk(withCols), s = { sub: false, grand: true, labels: false };
          let svg = "";
          try {
            const m = C.buildModel(d, s);
            svg = C.draw(kind, { m, d, s, W: size.W, H: size.H, measName: (x) => (x.agg === "lots" ? "ロット数" : `${x.column}の平均`), dimName: (x) => x.name || x.column, label: (c) => c, compact: size.compact, fmt: {} }).svg;
          } catch (e) { out.push({ kind, error: String(e) }); continue; }
          const box = document.createElement("div");
          box.className = size.compact ? "dp-chart" : "pv-chartbox";
          box.style.cssText = `position:absolute;left:0;top:0;width:${size.W}px;background:#fff`;
          box.innerHTML = svg;
          document.body.appendChild(box);
          const root = box.querySelector("svg");
          const sb = root.getBoundingClientRect();
          const texts = [...root.querySelectorAll("text")].filter((t) => t.textContent.trim() && !t.closest("title"));
          // 字の幅を測る（同じ class・同じ置き方の字を図に足して測る）
          const widthOf = (t, str) => { const x = t.cloneNode(false); x.textContent = str; t.parentNode.appendChild(x); const w = x.getComputedTextLength(); x.remove(); return w; };
          const rot = (t) => /rotate/.test(t.getAttribute("transform") || "");
          const clipped = [], overlaps = [], outside = [];
          const boxes = texts.map((t) => ({ t, r: t.getBoundingClientRect(), y: Math.round(+(t.getAttribute("y") || 0)), anchor: t.getAttribute("text-anchor") || "start", cls: t.getAttribute("class") || "" }));
          for (const b of boxes) {
            const s0 = b.t.textContent;
            if (b.r.left < sb.left - 1 || b.r.right > sb.right + 1 || b.r.top < sb.top - 1 || b.r.bottom > sb.bottom + 1) outside.push({ text: s0, cls: b.cls, l: Math.round(b.r.left - sb.left), r: Math.round(sb.right - b.r.right) });
            if (!s0.endsWith("…")) continue;
            const full = names.find((n) => n.startsWith(s0.slice(0, -1)) && n !== s0) || cols.find((n) => n.startsWith(s0.slice(0, -1)));
            if (!full) continue;
            const fw = widthOf(b.t, full);
            let avail = null;
            if (/pv-tm/.test(b.cls)) {
              // 四角の中の名前（ツリーマップ）: その四角の右の端まで
              const r = b.t.previousElementSibling && b.t.previousElementSibling.getBoundingClientRect();
              avail = r ? r.right - b.r.left - 4 : null;
            } else if (rot(b.t)) {
              // 斜め・縦の字（右の端が置き場）: 図の下の端まで（字の高さの分を引き、傾きで割る）と、図の左の端まで（字の上の端の分を引く）の短い方
              const tf = b.t.getAttribute("transform"), m = /rotate\(-?(\d+)\)/.exec(tf), a = (+m[1] * Math.PI) / 180, [tx, ty] = /translate\(([-\d.]+),([-\d.]+)\)/.exec(tf).slice(1).map(Number);
              const px = parseFloat(getComputedStyle(b.t).fontSize);
              avail = Math.min((size.H - ty - px * Math.cos(a) - 2) / Math.sin(a), Math.cos(a) > 0.01 ? (tx - px * Math.sin(a) * 0.8 - 1) / Math.cos(a) : Infinity);
            } else if (b.anchor === "middle") {
              const x = +b.t.getAttribute("x");
              const same = boxes.filter((o) => o !== b && o.y === b.y && o.anchor === "middle" && !rot(o.t)).map((o) => +o.t.getAttribute("x"));
              const near = Math.min(...same.map((ox) => Math.abs(ox - x)), 2 * Math.min(x, sb.width - x));
              avail = near * (same.length ? 1 : 1) - 4;
              if (same.length) avail = Math.min(avail, 2 * Math.min(x, sb.width - x));
            } else if (b.anchor === "end") avail = +b.t.getAttribute("x") - 2;
            else avail = sb.width - +b.t.getAttribute("x") - 2;
            if (avail != null && fw <= avail) clipped.push({ text: s0, full, need: Math.round(fw), avail: Math.round(avail), cls: b.cls });
          }
          // 重なり: 同じ段（y が同じ）の軸の字どうし
          const ax = boxes.filter((b) => /pv-ax/.test(b.cls) && !rot(b.t));
          for (let i = 0; i < ax.length; i++) for (let j = i + 1; j < ax.length; j++) {
            const a = ax[i].r, c = ax[j].r;
            if (ax[i].y !== ax[j].y) continue;
            const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
            if (ox > 1 && oy > 1) overlaps.push([ax[i].t.textContent, ax[j].t.textContent, Math.round(ox)]);
          }
          out.push({ kind, clipped, overlaps, outside, n: texts.length });
          box.remove();
        }
        return out;
      }, { names, size, kinds: KINDS });
      for (const r of res) all.push({ set: setName, size: `${size.W}×${size.H}${size.compact ? "" : "（一覧）"}`, ...r });
    }
  }
  const errs = all.filter((r) => r.error);
  check("どの形も描ける", !errs.length && !errors.length, { errs, errors });
  const clipped = all.flatMap((r) => (r.clipped || []).map((c) => ({ where: `${r.kind} ${r.size} ${r.set}`, ...c })));
  console.log(`  切った字のうち、余白に入る物: ${clipped.length}`);
  for (const c of clipped.slice(0, 40)) console.log(`    ${c.where}: 「${c.text}」→「${c.full}」 要る ${c.need}px ／ 使える ${c.avail}px`);
  check("① 余白があるのに切った字が無い", clipped.length === 0, clipped.length);
  const ov = all.flatMap((r) => (r.overlaps || []).map((o) => ({ where: `${r.kind} ${r.size} ${r.set}`, o })));
  check("② 同じ段の字が重ならない", ov.length === 0, ov.slice(0, 12));
  const outside = all.flatMap((r) => (r.outside || []).map((o) => ({ where: `${r.kind} ${r.size} ${r.set}`, ...o })));
  check("③ 字が図の外へはみ出さない", outside.length === 0, outside.slice(0, 12));
  if (SHOT) {
    // 見本: パネルの大きさで縦棒・横棒・パレート図を並べて撮る
    await p.evaluate(({ names }) => {
      const C = window.LotListPivotCharts;
      const cells = names.map((n, i) => ({ r: [n], c: [], v: [30 + ((i * 13) % 41), 300 + i * 11] })).concat([{ r: [], c: [], v: [500, 320] }]);
      const d = { dims: { rows: [{ column: "品種", name: "品種" }], cols: [] }, measures: [{ agg: "lots" }, { agg: "avg", column: "重量" }], orders: [names], labels: [{}], cells, count: 500, truncated: { rows: false, cols: false }, bins: [], stats: {}, months: [] };
      const s = { sub: false, grand: true, labels: false }, m = C.buildModel(d, s);
      document.body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,660px);gap:12px;padding:12px;background:#f3f5f6">${["column", "bar", "pareto", "combo"].map((k) => `<div class="dp-chart" style="background:#fff">${C.draw(k, { m, d, s, W: 660, H: 300, measName: (x) => (x.agg === "lots" ? "ロット数" : "重量の平均"), dimName: (x) => x.name, label: (c) => c, compact: true, fmt: {} }).svg}</div>`).join("")}</div>`;
    }, { names: NAMES.few });
    await sleep(200);
    await p.screenshot({ path: path.join(SHOT, "labels.png"), clip: { x: 0, y: 0, width: 1360, height: 660 } });
  }
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件 NG` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
