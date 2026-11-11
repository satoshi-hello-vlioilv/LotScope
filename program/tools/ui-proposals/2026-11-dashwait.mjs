// ダッシュボードの待ちの見せ方の案（2026-11-dashwait。利用者の要望 2026-11-11）。
// 「パネルの更新表示が、くるくるとバーの両方出るのがうっとうしい。どちらかでよくて、何をしているか（写しているのか・どのデータを写しているのか・
//  計算しているのか・どの計算をしているのか）が分かると、どのくらい待てばよいか・処理が適切か判断の材料になる」
//
// 撮り方（待ちの所は ui-variants.mjs の STATES に無いので、shot-dashunit.mjs と同じく、この定義を直に node で流して撮る）:
//   node program/tools/ui-proposals/2026-11-dashwait.mjs 出力フォルダ [--view 1536x864] [--only now,A] [--scenes first,recount,copy,long]
//   2 回目の案は --only now,E2,G,H,I,J・3 回目の案は --only now,I2,I3,G2,K,L,R（作り物の段の知らせはどちらも FEED2）
//   → 出力フォルダ/場面-案.png と、場面ごとに全案を並べた sheet-場面.png
// 待っていない所（数が出た後）は今と同じ形か、ui-variants.mjs でも撮れる（案は待っている間だけ形を変える）:
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-11-dashwait.mjs --states dash --from dash
//
// 場面（どれも組み込みの「標準」〈long だけ稼働のガント・ABC の組み〉。問い合わせ /api/dashboard/query を Playwright で止めて待ちを作る）:
//   first   … 最初の画面を開いた所（仕掛は答えた・作業実績の 3 枚と合わせた表は数えている。数はまだ無い）。1.8 秒の所
//   recount … 1 分ごとの数え直し（前の数が出ている。作業実績の 3 枚と合わせた表を数え直している）。1.4 秒の所
//   copy    … 入れた直後に共有から写している所（作業実績 11 台のうち 5 台を写し終え、写した分の途中の数。1.5 秒ごとに引き直す）。4.5 秒の所
//   long    … 長い計算（稼働のガント〈直近 4 日・全設備〉と ABC 分析〈合金×調質〉を数え直している）。6.5 秒の所
//
// 段の知らせ: 今のサーバーは途中の段を知らせない（答えの failed[kind=copying]・mirrors[refreshing] だけ）。案は、窓（Rust）が
// パネルの問い合わせごとに段を記録し、画面が尋ねる道（例: GET /api/dashboard/progress?ask=…）で返す前提で、その答えを作り物（FEED）で差し込む。
// 作り物の数（台・MB・秒・前回）は 2026-11-dashwait.json の measured に書いた測定（窓の release・作業実績 20,000 行/台 × 11 台）に合わせた。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ 作り物の段の知らせ（サーバーが返す前提の物）
   panels: パネルの id → 段の様子 / sources: データ元ごとの様子（道具の行・データの札に出す案が使う）/ wait: 待っている枚数・全部の枚数・いちばん長いあと何秒 */
// 段: 1 写す・2 読む・3 数える（確かめる・控えを見るは数ミリ秒なので画面に出さない。measured）。frac … その段の進み（0〜1）
// verb … いま何をしているか・what … 何を（どのデータ・どの設備・どの計算）・sec … 経過・prev … 前回この組みを数えた時間・left … あと何秒・rate … 写す速さ
const P = (o) => ({ prev: null, rate: null, ...o });
export const FEED = {
  first: {
    panels: {
      workTotal: P({ step: 2, frac: 7 / 11, verb: "読んでいます", what: "作業実績 7/11 台", src: "作業実績", calc: "数字（前日の本数）", sec: 1.8, prev: 2.4, left: 0.6 }),
      workMonth: P({ step: 2, frac: 6 / 11, verb: "読んでいます", what: "作業実績 6/11 台", src: "作業実績", calc: "数字（今月の本数）", sec: 1.8, prev: 2.2, left: 0.5 }),
      workDays: P({ step: 2, frac: 5 / 11, verb: "読んでいます", what: "作業実績 5/11 台", src: "作業実績", calc: "時系列（作業日ごと）", sec: 1.8, prev: 3.6, left: 1.8 }),
      board: P({ step: 3, frac: 0.5, verb: "集計しています", what: "合わせた表 まとまり 2/2（作業実績）", src: "作業実績", calc: "合わせた表", sec: 1.8, prev: 2.8, left: 1.0 }),
    },
    sources: [{ name: "仕掛", done: true, at: "05:35" }, { name: "作業実績", step: 2, verb: "読んでいます", what: "7/11 台", frac: 7 / 11, left: 1.8 }],
    wait: { waiting: 4, total: 6, left: 1.8, frac: 0.55 },
  },
  recount: {
    panels: {
      workTotal: P({ step: 2, frac: 9 / 11, verb: "数え直しています", what: "作業実績 9/11 台", src: "作業実績", calc: "数字（前日の本数）", sec: 1.4, prev: 2.1, left: 0.7 }),
      workMonth: P({ step: 2, frac: 8 / 11, verb: "数え直しています", what: "作業実績 8/11 台", src: "作業実績", calc: "数字（今月の本数）", sec: 1.4, prev: 2.0, left: 0.6 }),
      workDays: P({ step: 2, frac: 6 / 11, verb: "数え直しています", what: "作業実績 6/11 台", src: "作業実績", calc: "時系列（作業日ごと）", sec: 1.4, prev: 3.3, left: 1.9 }),
      board: P({ step: 3, frac: 0.5, verb: "数え直しています", what: "合わせた表 まとまり 2/2", src: "作業実績", calc: "合わせた表", sec: 1.4, prev: 2.6, left: 1.2 }),
    },
    sources: [{ name: "仕掛", done: true, at: "05:36" }, { name: "作業実績", step: 2, verb: "数え直しています", what: "変わった 2 台を写し済み・9/11 台", frac: 9 / 11, left: 1.9 }],
    wait: { waiting: 4, total: 6, left: 1.9, frac: 0.6 },
  },
  copy: {
    panels: {
      workTotal: P({ step: 1, frac: 16 / 34, verb: "共有から写しています", what: "作業実績 5/11 台・16/34 MB", got: "5/11", src: "作業実績", calc: "数字（前日の本数）", sec: 4.5, rate: 3.6, left: 7, partial: true }),
      workMonth: P({ step: 1, frac: 16 / 34, verb: "共有から写しています", what: "作業実績 5/11 台・16/34 MB", got: "5/11", src: "作業実績", calc: "数字（今月の本数）", sec: 4.5, rate: 3.6, left: 7, partial: true }),
      workDays: P({ step: 1, frac: 16 / 34, verb: "共有から写しています", what: "作業実績 5/11 台・16/34 MB", got: "5/11", src: "作業実績", calc: "時系列（作業日ごと）", sec: 4.5, rate: 3.6, left: 7, partial: true }),
      board: P({ step: 1, frac: 16 / 34, verb: "共有から写しています", what: "作業実績 5/11 台・16/34 MB", got: "5/11", src: "作業実績", calc: "合わせた表", sec: 4.5, rate: 3.6, left: 7, partial: true }),
    },
    sources: [{ name: "仕掛", done: true, at: "05:35" }, { name: "作業実績", step: 1, verb: "共有から写しています", what: "5/11 台・16/34 MB（いま CR2）", frac: 16 / 34, rate: 3.6, left: 7 }],
    wait: { waiting: 4, total: 6, left: 7, frac: 0.47 },
  },
  long: {
    panels: {
      gantt: P({ step: 3, frac: 8 / 11, verb: "稼働のガントを組んでいます", what: "作業実績 8/11 台（いま HOT）", src: "作業実績", calc: "稼働のガント（直近 4 日）", sec: 6.5, prev: 9.8, left: 3.3 }),
      abc: P({ step: 3, frac: 0.88, verb: "ABC 分析を数えています", what: "11 台の作業を 11 品種に並べる", src: "作業実績", calc: "ABC 分析（合金×調質）", sec: 6.5, prev: 7.4, left: 0.9 }),
    },
    sources: [{ name: "作業実績", step: 3, verb: "数えています", what: "ガントと ABC", frac: 0.75, left: 3.3 }],
    wait: { waiting: 2, total: 4, left: 3.3, frac: 0.7 },
    open: true,   // C 案: 道具の行の「内訳 ▾」を押して開いた所
  },
};

// 長い計算の場面の組み（稼働のガント・ABC 分析・数字 2 つ）
export const LONG_LAYOUT = { rows: 8, panels: [
  { id: "k1", x: 0, y: 0, w: 6, h: 1, title: "前日の実績本数", visual: "kpi", source: "work", period: { column: "@workday", kind: "yesterday" }, fmt: { kmeta: "row" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } },
  { id: "k2", x: 6, y: 0, w: 6, h: 1, title: "仕掛ロット数", visual: "kpi", source: "src:wip", fmt: { kmeta: "row" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true } },
  { id: "gantt", x: 0, y: 1, w: 12, h: 4, title: "", visual: "gantt", source: "work", period: { column: "@workday", kind: "days", n: 4 }, ops: { color: "作業区分" }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } },
  { id: "abc", x: 0, y: 5, w: 12, h: 3, title: "", visual: "abc", source: "work", ops: { cls: ["合金", "調質"] }, body: { rows: [], cols: [], measures: [{ agg: "lots" }] } }] };

/* ------------------------------------------------------------------ 案に共通の作り（頁の中で動く）
   待っているパネル（今の画面の印 .db-spin〈数え直し中〉・.dp-wait〈まだ数が無い〉・.is-wait があるパネル）に、FEED の段を描く。
   今の画面の 3 つの印（見出しの回る印・上の縁の進みの線・道具の行の進みの棒）と添え書きの待ちの字は、案ごとに CSS で消す。
   描いた物は .dw-x（待ちが終われば消す）。200ms ごとに当て直す（パネルの描き直しで消えても戻る） */
function engine() {
  const W = (window.__dw = window.__dw || { scene: null, render: null, bar: null });
  W.busy = (el) => !!el.querySelector(".db-spin, .dp-wait") || el.classList.contains("is-wait");
  W.left = (f) => (f.left == null ? "" : f.left < 1 ? "まもなく" : `あと約 ${f.left < 10 ? Math.ceil(f.left) : Math.round(f.left / 5) * 5} 秒`);
  W.why = (f) => (f.prev ? `前回 ${f.prev} 秒` : f.rate ? `${f.rate} MB/秒` : "");
  W.eta = (f) => { const a = W.left(f), b = W.why(f); return a + (b ? `（${b}）` : ""); };
  W.STEP = ["", "写す", "読む", "数える"];
  // 添え書きの段（見出しの下の 2 行目。数字のパネルは数の横の添え書き）。今の画面が待ちの字を置く所と同じ
  W.host = (el) => {
    const st = el.querySelector(".db-wst");
    if (st) return st.parentElement;
    const sub = el.querySelector(".db-psub");
    if (sub && sub.hidden && el.querySelector(".dp-wait")) { sub.hidden = false; sub.dataset.dwonly = "1"; }
    return sub && !sub.hidden ? sub : el.querySelector(".dp-kmeta:not([hidden])") || sub;
  };
  /** 置き場 host の中に cls の要素を 1 つ（中身が同じなら触らない） */
  W.slot = (el, cls, html, host, tag = "span", where = "append") => {
    if (!host) return null;
    let n = el.querySelector(`.${cls}`);
    if (n && n.parentElement !== host) { n.remove(); n = null; }
    if (!n) { n = document.createElement(tag); n.className = `${cls} dw-x`; host[where](n); }
    if (n.dataset.h !== html) { n.innerHTML = html; n.dataset.h = html; }
    return n;
  };
  /** 添え書きの段に置く。入らなければ短い言い方（lv 1）、それでも入らなければ待っている間だけ添え書きの字を隠して待ちの字だけ（lv 2。元の添え書きは説明に） */
  W.place = (el, cls, full, short) => {
    const host = W.host(el); if (!host) return;
    const key = el.dataset.id + "|" + cls;
    const pb = el.querySelector(".db-pb");
    // 箱からあふれる・パネルの中身の枠（数字のパネルの低い 1 段）で切れる
    const over = () => {
      const box = pb.getBoundingClientRect(), r = host.getBoundingClientRect();
      return host.scrollWidth > host.clientWidth + 1 || host.scrollHeight > host.clientHeight + 1 || (pb.contains(host) && (r.bottom > box.bottom + 1 || r.top < box.top - 1));
    };
    const apply = (l) => {
      if (l >= 2 && !host.classList.contains("dw-tight")) {   // 元の添え書きは説明に残す
        host.title = [...host.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() || host.title;
        host.classList.add("dw-tight");
      }
      if (l < 2) host.classList.remove("dw-tight");
      W.slot(el, cls, l ? short : full, host);
    };
    // 入らなければ短い言い方（1）→ 待っている間だけ添え書きと入れ替え（2）。同じ刻みの中で入る形まで進め、パネルごとに覚える（引き直しで添え書きが作り直されても戻らない）
    let lv = (W.lvs = W.lvs || {})[key] || 0;
    apply(lv);
    while (lv < 2 && over()) apply(++lv);
    W.lvs[key] = lv;
  };
  W.clear = (el) => {
    el.querySelectorAll(".dw-tight").forEach((h) => h.classList.remove("dw-tight"));
    Object.keys(W.lvs || {}).forEach((k) => { if (k.startsWith(el.dataset.id + "|")) delete W.lvs[k]; });
    el.querySelectorAll(".dw-x").forEach((n) => n.remove());
    const sub = el.querySelector(".db-psub[data-dwonly]");
    if (sub) { delete sub.dataset.dwonly; if (!sub.textContent.trim()) sub.hidden = true; }
  };
  W.barSlot = (cls, html) => {
    const bar = document.querySelector("#dashBar"); const wb = bar && bar.querySelector(".db-wbar");
    let n = bar && bar.querySelector(`.${cls}`);
    if (!html) { if (n) n.remove(); return null; }
    if (!bar || !wb) return null;
    if (!n) { n = document.createElement("span"); n.className = `${cls} dw-x`; wb.after(n); }
    if (n.dataset.h !== html) { n.innerHTML = html; n.dataset.h = html; }
    return n;
  };
  W.tick = () => {
    const sc = W.scene;
    document.querySelectorAll("#dashGrid .db-p").forEach((el) => {
      const f = sc && sc.panels[el.dataset.id];
      const on = !!f && W.busy(el);
      el.classList.toggle("dw-on", on);
      if (!on) { if (el.querySelector(".dw-x") || el.querySelector(".db-psub[data-dwonly]")) W.clear(el); return; }
      if (W.render) W.render(el, f, sc);
    });
    if (W.bar) W.bar(sc && document.querySelector("#dashGrid .db-p.dw-on") ? sc : null);
  };
  if (!W.timer) W.timer = setInterval(W.tick, 200);
}
const ENGINE = `(${engine})()`;
const js = (fn) => ["script", `(${fn})()`];

// 今の 3 つの印と待ちの字を消す CSS
const OFF = `
#dashGrid .db-p.dw-on .db-spin{display:none!important}
#dashGrid .db-p.dw-on.is-wait::before{display:none!important}
#dashBar .db-wbar{display:none!important}
#dashGrid .db-p.dw-on .db-wst{display:none!important}
#dashGrid .db-p.dw-on .dp-wait{display:none!important}
#dashGrid .dw-tight{font-size:0!important}
#dashGrid .dw-tight > .dw-x{font-size:12px;margin-left:0!important}`;
// 道具の行の字（数え終えた枚数と、いちばん長いあと何秒）。A・D・F が使う
const BAR_TEXT = `
#dashBar .dw-bt{flex:1 1 auto;min-width:0;margin-left:14px;font-size:12.5px;color:#3b4652;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#dashBar .dw-bt b{color:#24384d}`;
function barText() {
  const W = window.__dw;
  W.bar = (sc) => W.barSlot("dw-bt", sc ? `<b>${sc.wait.total - sc.wait.waiting} / ${sc.wait.total} 枚 済み</b>・待っている ${sc.wait.waiting} 枚・${W.left(sc.wait)}` : "");
}

/* ------------------------------------------------------------------ 案 */
export const PROPOSALS = [
  { key: "now", name: "今（回る印＋上の縁の線＋道具の行の棒）", css: "", ops: [] },

  // A 減らし方: 動く印を全部やめ、字だけ。置き場は今の待ちの字と同じ添え書きの段。何を・どのデータを・あと何秒（前回）を 1 行で
  { key: "A", name: "字だけ（印をやめ、添え書きの段に 段・データ・あと何秒）", css: OFF + BAR_TEXT + `
    .dwA{display:inline;margin-left:8px;color:#2f557f;white-space:nowrap}
    .dwA b{font-weight:700}
    .dwA i{font-style:normal;color:#4a5866}`,
    ops: [["script", ENGINE], js(barText), js(() => {
      const W = window.__dw;
      W.render = (el, f) => W.place(el, "dwA", `<b>${f.verb}</b> ${f.what}・<i>${W.eta(f)}</i>`, `<b>${W.STEP[f.step]}</b> ${f.what.split("・")[0]}・<i>${W.left(f)}</i>`);
    })] },

  // B 見せ方: パネルの下の縁に、段（写す・読む・数える）を 3 つに区切った確定の進みの線（動くのはこれ 1 本）。字は添え書きの段に段の番号つき
  { key: "B", name: "下の縁に段を区切った進みの線 1 本＋添え書きに「段 2/3 読む」", css: OFF + BAR_TEXT + `
    #dashGrid .db-p.dw-on{position:relative}
    .dwB-line{position:absolute;left:10px;right:10px;bottom:3px;height:5px;display:flex;gap:3px;z-index:3;pointer-events:none}
    .dwB-line i{flex:1;border-radius:3px;background:#dfe6ee;position:relative;overflow:hidden}
    .dwB-line i::after{content:"";position:absolute;inset:0;width:var(--f,0%);background:#3f6591;transition:width .3s}
    .dwB{display:inline;margin-left:8px;color:#2f557f;white-space:nowrap}
    .dwB em{font-style:normal;font-weight:700;margin-right:4px;padding:0 5px;border-radius:8px;background:#e6edf5}
    .dwB i{font-style:normal;color:#4a5866}`,
    ops: [["script", ENGINE], js(barText), js(() => {
      const W = window.__dw;
      W.render = (el, f) => {
        const seg = [1, 2, 3].map((k) => `<i style="--f:${k < f.step ? 100 : k === f.step ? Math.round(f.frac * 100) : 0}%" title="${W.STEP[k]}"></i>`).join("");
        W.slot(el, "dwB-line", seg, el, "div");
        W.place(el, "dwB", `<em>${f.step}/3 ${W.STEP[f.step]}</em>${f.what}・<i>${W.eta(f)}</i>`, `<em>${f.step}/3 ${W.STEP[f.step]}</em>${f.what.split("・")[0]}・<i>${W.left(f)}</i>`);
      };
    })] },

  // C 置き場: 動く印は道具の行の 1 本だけ（全体の進み）。字も道具の行に「いま何を・どのデータを・あと何秒」。パネルは薄くなるだけ＋短い言葉。
  //   「内訳 ▾」を押すとパネルごとの段・経過・前回の表（長い計算の場面では開いた所を撮る）
  { key: "C", name: "道具の行に 1 本だけ（全体の進み＋いまの段）・押すとパネルごとの内訳", css: OFF + `
    #dashBar .dwC{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;margin-left:14px;font-size:12.5px;color:#24384d;white-space:nowrap;overflow:hidden}
    .dwC-pg{flex:0 0 120px;height:6px;border-radius:3px;background:#e3e9ee;position:relative;overflow:hidden}
    .dwC-pg::after{content:"";position:absolute;inset:0;width:var(--f);background:#3f6591}
    .dwC-t{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .dwC-t i{font-style:normal;color:#4a5866}
    .dwC-more{flex:0 0 auto;height:24px;padding:0 9px;border:1px solid #c5ced9;border-radius:6px;background:#fff;font:inherit;font-size:12px;font-weight:700;color:#3b4652}
    .dwC-p{display:inline;margin-left:8px;color:#2f557f;white-space:nowrap}
    .dwC-pop{position:fixed;z-index:50;width:max-content;max-width:calc(100vw - 24px);background:#fff;border:1px solid #c5ced9;border-radius:8px;box-shadow:0 8px 24px rgba(20,40,60,.18);padding:10px 12px;font-size:12.5px;color:#24384d}
    .dwC-pop h4{margin:0 0 6px;font-size:13px}
    .dwC-pop table{width:100%;border-collapse:collapse}
    .dwC-pop th{font-weight:600;color:#4a5866;text-align:left;padding:3px 6px;border-bottom:1px solid #e3e9ee;font-size:12px}
    .dwC-pop td{padding:4px 6px;border-bottom:1px solid #eef2f5;white-space:nowrap}
    .dwC-pop td.n{text-align:right;font-variant-numeric:tabular-nums}`,
    ops: [["script", ENGINE], js(() => {
      const W = window.__dw;
      W.render = (el, f) => W.place(el, "dwC-p", `<b>${W.STEP[f.step]}</b>途中`, `<b>${W.STEP[f.step]}</b>途中`);
      W.bar = (sc) => {
        if (!sc) { W.barSlot("dwC", ""); document.querySelector(".dwC-pop")?.remove(); return; }
        const s = sc.sources.find((x) => !x.done) || {};
        W.barSlot("dwC", `<i class="dwC-pg" style="--f:${Math.round(sc.wait.frac * 100)}%"></i><span class="dwC-t"><b>${s.name}</b> ${s.verb} ${s.what}・待っている ${sc.wait.waiting} 枚・<i>${W.eta({ left: sc.wait.left, rate: s.rate })}</i></span><button type="button" class="dwC-more">内訳 ▾</button>`);
        const pop = document.querySelector(".dwC-pop");
        if (sc.open && !pop) {
          const rows = [...document.querySelectorAll("#dashGrid .db-p.dw-on")].map((el) => {
            const f = sc.panels[el.dataset.id]; const t = el.querySelector(".db-ph h3")?.textContent || "";
            return `<tr><td>${t}</td><td>${W.STEP[f.step]}・${f.calc}</td><td>${f.what}</td><td class="n">${f.sec} 秒</td><td class="n">${f.prev ? f.prev + " 秒" : "—"}</td></tr>`;
          }).join("");
          const b = document.querySelector(".dwC-more").getBoundingClientRect();
          const n = document.createElement("div"); n.className = "dwC-pop dw-x";
          n.innerHTML = `<h4>待っているパネル</h4><table><tr><th>パネル</th><th>段・計算</th><th>何を</th><th>経過</th><th>前回</th></tr>${rows}</table>`;
          document.body.append(n);
          n.style.top = `${b.bottom + 6}px`; n.style.left = `${Math.max(12, Math.min(b.right, innerWidth - 12) - n.offsetWidth)}px`;
        }
      };
    })] },

  // D 流れの見せ方: 段の並び（写す → 読む → 数える）をパネルの中に。数がまだ無いパネルは中身の所に大きく、前の数があるパネルは添え書きの段に小さく
  { key: "D", name: "段の並び（✓写す → ●読む → 数える）をパネルの中に・数が無ければ大きく", css: OFF + BAR_TEXT + `
    .dwD{display:inline-flex;align-items:center;gap:6px;margin-left:8px;color:#4a5866;white-space:nowrap}
    .dwD s{text-decoration:none;color:#8a96a3}
    .dwD u{text-decoration:none;color:#2f6b45}
    .dwD b{color:#2f557f}
    .dwD i{font-style:normal}
    .dwD-big{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#24384d;font-size:13px;pointer-events:none}
    .dwD-steps{display:flex;align-items:center;gap:6px}
    .dwD-steps span{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;background:#eef2f5;color:#6b7785;font-weight:600}
    .dwD-steps span.done{background:#e3f1e8;color:#2f6b45}
    .dwD-steps span.now{background:#3f6591;color:#fff}
    .dwD-steps em{font-style:normal;color:#a3adb8}
    .dwD-what{font-size:13px;color:#24384d}
    .dwD-eta{font-size:12.5px;color:#4a5866}`,
    ops: [["script", ENGINE], js(barText), js(() => {
      const W = window.__dw;
      W.render = (el, f) => {
        const body = el.querySelector(".db-pb"), empty = !!el.querySelector(".dp-wait") && body && body.clientHeight >= 140;   // 低いパネル（数字の 1 段）は添え書きの段に小さく
        if (empty) {
          const steps = [1, 2, 3].map((k) => `<span class="${k < f.step ? "done" : k === f.step ? "now" : ""}">${k < f.step ? "✓ " : ""}${W.STEP[k]}${k === f.step ? ` ${Math.round(f.frac * 100)}%` : ""}</span>`).join("<em>→</em>");
          W.slot(el, "dwD-big", `<div class="dwD-steps">${steps}</div><div class="dwD-what"><b>${f.verb}</b> ${f.what}</div><div class="dwD-eta">${f.sec} 秒・${W.eta(f)}</div>`, el.querySelector(".db-pb"), "div");
          el.querySelector(".dwD")?.remove();
        } else {
          el.querySelector(".dwD-big")?.remove();
          const st = [1, 2, 3].map((k) => (k < f.step ? `<u>✓${W.STEP[k]}</u>` : k === f.step ? `<b>● ${W.STEP[k]} ${f.what}</b>` : `<s>${W.STEP[k]}</s>`)).join("<s>→</s>");
          W.place(el, "dwD", `${st}<i>・${W.eta(f)}</i>`, `<b>● ${W.STEP[f.step]} ${f.what.split("・")[0]}</b><i>・${W.left(f)}</i>`);
        }
      };
    })] },

  // E 置き場（責任で分ける）: 写すのはデータ元の仕事なので、道具の行にデータ元ごとの札（中に確定の進み 1 本）。パネルは自分の計算だけを字で
  { key: "E", name: "データ元の札（写す・読むの進み）＋パネルは自分の計算を字で", css: OFF + `
    #dashBar .dwE{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;margin-left:14px;font-size:12.5px;white-space:nowrap;overflow:hidden}
    .dwE-c{flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px;border-radius:13px;background:#eef2f5;color:#24384d;overflow:hidden}
    .dwE-c.ok{background:#f2f5f2;color:#3d5a45}
    .dwE-c b{font-weight:700}
    .dwE-c span{overflow:hidden;text-overflow:ellipsis}
    .dwE-pg{flex:0 0 70px;height:6px;border-radius:3px;background:#d6dee7;position:relative;overflow:hidden}
    .dwE-pg::after{content:"";position:absolute;inset:0;width:var(--f);background:#3f6591}
    .dwE-p{display:inline;margin-left:8px;color:#2f557f;white-space:nowrap}
    .dwE-p i{font-style:normal;color:#4a5866}`,
    ops: [["script", ENGINE], js(() => {
      const W = window.__dw;
      W.render = (el, f) => {
        const t = f.step === 1 ? `<b>${f.src}の写し待ち</b>・<i>いまの数は写した ${f.got} 台の分</i>` : `<b>${f.verb}</b> ${f.what}・<i>${W.eta(f)}</i>`;
        const sh = f.step === 1 ? `<b>写し待ち</b>・<i>写した ${f.got} 台の分</i>` : `<b>${W.STEP[f.step]}</b> ${f.what.split("・")[0]}・<i>${W.left(f)}</i>`;
        W.place(el, "dwE-p", t, sh);
      };
      W.bar = (sc) => W.barSlot("dwE", sc ? sc.sources.map((s) => (s.done
        ? `<span class="dwE-c ok"><b>${s.name}</b> ✓ ${s.at} の数</span>`
        : `<span class="dwE-c" title="${s.rate ? `写す速さ ${s.rate} MB/秒` : ""}"><b>${s.name}</b><i class="dwE-pg" style="--f:${Math.round(s.frac * 100)}%"></i><span>${s.verb} ${s.what}・${W.left(s)}</span></span>`)).join("") : "");
    })] },

  // F 見せ方: 回る印を、満ちていく円（確定の進み）に替える。円は見出しの今の回る印の所に 1 つ、字は添え書きの段に
  { key: "F", name: "回る印を満ちていく円に替える（見出しに 1 つ）＋添え書きに段とあと何秒", css: OFF + BAR_TEXT + `
    .dwF-ring{flex:0 0 auto;width:16px;height:16px;border-radius:50%;background:conic-gradient(#3f6591 var(--f), #dfe6ee 0);-webkit-mask:radial-gradient(circle,transparent 4px,#000 4.5px);mask:radial-gradient(circle,transparent 4px,#000 4.5px)}
    .dwF-n{flex:0 0 auto;font-size:12px;font-weight:700;color:#2f557f;font-variant-numeric:tabular-nums}
    .dwF{display:inline;margin-left:8px;color:#2f557f;white-space:nowrap}
    .dwF i{font-style:normal;color:#4a5866}`,
    ops: [["script", ENGINE], js(barText), js(() => {
      const W = window.__dw;
      W.render = (el, f) => {
        const all = ((f.step - 1) + f.frac) / 3;
        const ph = el.querySelector(".db-ph"), before = ph && ph.querySelector(".db-filt, [data-db-filter], .db-pbtn");
        if (ph) {
          let r = ph.querySelector(".dwF-ring");
          if (!r) { r = document.createElement("i"); r.className = "dwF-ring dw-x"; r.setAttribute("aria-hidden", "true"); (before ? before.before(r) : ph.append(r)); }
          r.style.setProperty("--f", `${Math.round(all * 100)}%`);
          let n = ph.querySelector(".dwF-n");
          if (!n) { n = document.createElement("span"); n.className = "dwF-n dw-x"; r.after(n); }
          n.textContent = `${Math.round(all * 100)}%`;
        }
        W.place(el, "dwF", `${f.verb} ${f.what}・<i>${W.eta(f)}</i>`, `${W.STEP[f.step]} ${f.what.split("・")[0]}・<i>${W.left(f)}</i>`);
      };
    })] },
];

/* ================================================================== 2 回目（1 回目の採点の evaluator_next を受けて）
   どの案にも共通（採点の指摘 1〜7）:
   - 今の 3 つの印（回る印・上の縁の線・道具の行の棒）はやめる。印は 1 種類で、待ちの字のすぐそばだけ
   - 字の順は全部のパネルで「段（どの計算・どのデータを何する）→ 何を（n/m）→ あとどのくらい」。同じ段は同じ言葉
     （写し待ち・作業実績を読む・合わせた表を組む・稼働のガントを組む・ABC 分析の品種を並べる）
   - あとどのくらい: 「まもなく」「あと約 n 秒」（前回 n 秒）だけ。前回を超えたら「前回 n 秒より長くかかっています（n 秒）」
   - 写すのはデータ元の仕事: 道具の行の札に写している間だけ 1 回（写すだけ。読む・数えるは出さない）。パネルは「写し待ち・いまの数は写した 5/11 台の分」
   - 添え書き（期間・元）は消さない。待ちの字は添え書きの後ろ。入らなければ（前回 n 秒）を省き、それでも入らなければ
     データの名前（作業実績を）を省く（データは添え書きの「実績」が言う）。データの名前を省くときは、その画面の全部のパネルで省く
   - 数のまだ無い大きなパネル（中身の高さ 140px 以上）は、中身の真ん中に同じ字の順で
   - 道具の行は「2 / 6 枚 済み・待っている 4 枚・あと約 2 秒」の字（写している間はその前にデータ元の札） */
const D2 = (o) => ({ data: "", calc: "", extra: "", frac: null, prev: null, over: false, ...o });
export const FEED2 = {
  first: { panels: {
    workTotal: D2({ data: "作業実績を", verb: "読む", what: "7/11 台", frac: 7 / 11, sec: 1.8, prev: 2.4, left: 0.6 }),
    workMonth: D2({ data: "作業実績を", verb: "読む", what: "6/11 台", frac: 6 / 11, sec: 1.8, prev: 2.2, left: 0.5 }),
    workDays: D2({ data: "作業実績を", verb: "読む", what: "5/11 台", frac: 5 / 11, sec: 1.8, prev: 3.6, left: 1.8 }),
    board: D2({ calc: "合わせた表を", verb: "組む", what: "まとまり 1/2 済み", frac: 1 / 2, sec: 1.8, prev: 2.8, left: 1.0 }) },
    wait: { done: 2, total: 6, waiting: 4, left: 1.8 } },
  recount: { panels: {
    workTotal: D2({ data: "作業実績を", verb: "読む", what: "9/11 台", frac: 9 / 11, sec: 1.4, prev: 2.1, left: 0.7 }),
    workMonth: D2({ data: "作業実績を", verb: "読む", what: "8/11 台", frac: 8 / 11, sec: 1.4, prev: 2.0, left: 0.6 }),
    workDays: D2({ data: "作業実績を", verb: "読む", what: "6/11 台", frac: 6 / 11, sec: 1.4, prev: 3.3, left: 1.9 }),
    board: D2({ calc: "合わせた表を", verb: "組む", what: "まとまり 1/2 済み", frac: 1 / 2, sec: 1.4, prev: 2.6, left: 1.2 }) },
    wait: { done: 2, total: 6, waiting: 4, left: 1.9 } },
  copy: { panels: Object.fromEntries(["workTotal", "workMonth", "workDays", "board"].map((id) => [id, D2({ copy: true, n: 5, of: 11, frac: 5 / 11, sec: 4.5, left: 7 })])),
    source: { name: "作業実績", n: 5, of: 11, mb: [16, 34], rate: 3.6, now: "CR2", left: 7, sec: 4.5, total: 11.5 },
    wait: { done: 2, total: 6, waiting: 4, left: 7 } },
  long: { panels: {
    gantt: D2({ calc: "稼働のガントを", verb: "組む", what: "8/11 台", extra: "（いま HOT）", frac: 8 / 11, sec: 6.5, prev: 9.8, left: 3.3 }),
    abc: D2({ calc: "ABC 分析の品種を", verb: "並べる", what: "11 品種", sec: 6.5, prev: 5.1, over: true }) },
    wait: { done: 2, total: 4, waiting: 2, left: 3.3, over: 1 }, open: true },
};

function engine2() {
  const W = (window.__dw = window.__dw || {});
  W.busy = (el) => !!el.querySelector(".db-spin, .dp-wait") || el.classList.contains("is-wait");
  W.secs = (n) => `${n < 10 ? Math.ceil(n) : Math.round(n / 5) * 5} 秒`;
  W.eta = (f) => (f.over ? `<i class="dw-over">前回 ${f.prev} 秒より長くかかっています（${f.sec} 秒）</i>` : f.left < 1 ? "まもなく" : `あと約 ${W.secs(f.left)}`);
  /** 字（段 → 何を → あとどのくらい）。o.detail: （前回 n 秒）といま何の設備か・o.data: データの名前 */
  W.words = (f, o) => {
    const keep = (x, on) => (on === false ? "" : x);
    // 写し待ち: あと何秒は道具の行の札が言うので先に省き、途中の数だということ（写した n/m 台の分）を残す
    if (f.copy) { const l = o.lv || 0;
      return { step: "写し待ち", what: l >= 4 ? "" : l >= 3 ? `${f.n}/${f.of} 台分` : o.data ? `いまの数は写した ${f.n}/${f.of} 台の分` : `写した ${f.n}/${f.of} 台の分`, eta: l >= 2 ? "" : W.eta(f), detail: "", lv: l }; }
    return { step: (f.calc || (o.data ? f.data : "")) + f.verb, what: keep(f.what + (o.detail ? f.extra : ""), o.what), eta: keep(W.eta(f), o.eta),
             detail: o.detail && f.prev && !f.over ? `（前回 ${f.prev} 秒）` : "", lv: o.lv || 0 };
  };
  /** 段 → 何を → あとどのくらい を「・」でつなぐ（空の所は飛ばす） */
  W.join = (step, what, eta, detail) => [`<b>${step}</b>${what ? ` ${what}` : ""}`, eta].filter(Boolean).join("・") + (detail || "");
  /** パネルごとに省く順: 0 そのまま → 1（前回 n 秒）を省く → 2 何を（n/m）を省く → 3 あとどのくらいの字も省く → 4 段の言葉だけ。データの名前は画面ぜんぶで省く。全文は字の説明（title） */
  W.opt = (lv) => ({ detail: lv < 1, data: !W.dropData, what: lv < 2, eta: lv < 3, lv });
  // 印の進み: 字の n/m と同じ数。n/m の無い段は経過÷前回（超えたら満ちて「長い」の色）
  W.frac = (f) => (f.frac != null ? f.frac : f.prev ? Math.min(1, f.sec / f.prev) : 0);
  W.host = (el) => {
    const st = el.querySelector(".db-wst");
    if (st) return st.parentElement;
    const sub = el.querySelector(".db-psub");
    if (sub && sub.hidden && el.querySelector(".dp-wait")) { sub.hidden = false; sub.dataset.dwonly = "1"; }
    return sub && !sub.hidden ? sub : el.querySelector(".dp-kmeta:not([hidden])") || sub;
  };
  W.slot = (el, cls, html, host, tag = "span") => {
    if (!host) return null;
    let n = el.querySelector(`.${cls}`);
    if (n && n.parentElement !== host) { n.remove(); n = null; }
    if (!n) { n = document.createElement(tag); n.className = `${cls} dw-x`; host.append(n); }
    if (n.dataset.h !== html) { n.innerHTML = html; n.dataset.h = html; }
    return n;
  };
  W.over = (el, host) => {
    const pb = el.querySelector(".db-pb"), box = pb.getBoundingClientRect(), r = host.getBoundingClientRect();
    return host.scrollWidth > host.clientWidth + 1 || host.scrollHeight > host.clientHeight + 1 || (pb.contains(host) && (r.bottom > box.bottom + 1 || r.top < box.top - 1));
  };
  W.clear = (el) => {
    el.querySelectorAll(".dw-x").forEach((n) => n.remove());
    el.querySelectorAll(".dw-hidedot").forEach((n) => n.classList.remove("dw-hidedot"));
    const sub = el.querySelector(".db-psub[data-dwonly]");
    if (sub) { delete sub.dataset.dwonly; if (!sub.textContent.trim()) sub.hidden = true; }
  };
  W.barSlot = (cls, html) => {
    const bar = document.querySelector("#dashBar"), wb = bar && bar.querySelector(".db-wbar");
    let n = bar && bar.querySelector(`.${cls}`);
    if (!html) { if (n) n.remove(); return null; }
    if (!bar || !wb) return null;
    if (!n) { n = document.createElement("span"); n.className = `${cls} dw-x`; wb.after(n); }
    if (n.dataset.h !== html) { n.innerHTML = html; n.dataset.h = html; }
    return n;
  };
  W.barText = (sc) => `<b>${sc.wait.done} / ${sc.wait.total} 枚 済み</b>・待っている ${sc.wait.waiting} 枚・${sc.wait.left < 1 ? "まもなく" : `あと約 ${W.secs(sc.wait.left)}`}${sc.wait.over ? `・<i class="dw-over">前回より長い ${sc.wait.over} 枚</i>` : ""}`;
  W.tick = () => {
    const sc = W.scene;
    if (sc !== W.lastScene) { W.lastScene = sc; W.dropData = false; W.dropDetail = {}; }
    const els = [...document.querySelectorAll("#dashGrid .db-p")];
    for (const el of els) {
      const f = sc && sc.panels[el.dataset.id], on = !!f && W.busy(el);
      el.classList.toggle("dw-on", on);
      if (!on) { if (el.querySelector(".dw-x, .dw-hidedot") || el.querySelector(".db-psub[data-dwonly]")) W.clear(el); continue; }
      const pb = el.querySelector(".db-pb"), big = !!el.querySelector(".dp-wait") && pb.clientHeight >= 140;
      if (W.mark) W.mark(el, f);                                  // 案ごとの印（題の左の円など）
      if (big) {                                                   // 数のまだ無い大きなパネル: 中身の真ん中
        el.querySelector(".dw-t")?.remove();
        const w = W.words(f, { detail: true, data: !W.dropData });
        W.slot(el, "dw-c", W.center(f, w), pb, "div");
        continue;
      }
      el.querySelector(".dw-c")?.remove();
      const host = W.host(el); if (!host) continue;
      // 省く段は、同じ形（添え書きの段か数の横か）で同じ幅のパネルどうしでそろえる（並んだ同じ形のパネルで言い方が違わない）
      const gk = (host.classList.contains("dp-kmeta") ? "k" : "s") + Math.round(el.clientWidth / 20);
      let lv = W.dropDetail[gk] || 0;
      const put = () => { const n = W.slot(el, "dw-t", W.inline(f, W.words(f, W.opt(lv))), host); if (n) n.title = W.inline(f, W.words(f, { detail: true, data: true })).replace(/<[^>]+>/g, ""); };
      put();
      if (lv < 1 && W.over(el, host)) { lv = 1; put(); }
      if (!W.dropData && W.over(el, host)) { W.dropData = true; put(); }   // データの名前は、次の刻みで全部のパネルが省く
      while (lv < 4 && W.over(el, host)) { lv++; put(); }
      W.dropDetail[gk] = Math.max(W.dropDetail[gk] || 0, lv);
    }
    W.bar(sc && document.querySelector("#dashGrid .db-p.dw-on") ? sc : null);
  };
  // 既定の字の形（案が替える）
  W.inline = (f, w) => W.join(w.step, w.what, w.eta, w.detail);
  W.center = (f, w) => `<div class="dw-c1"><b>${w.step}</b> ${w.what}</div><div class="dw-c2">${w.eta}${w.detail}</div>`;
  W.chip = (s) => `<b>${s.name}</b> 共有から写しています ${s.n}/${s.of} 台・あと約 ${W.secs(s.left)}`;
  W.bar = (sc) => {
    W.barSlot("dw-chip", sc && sc.source ? W.chip(sc.source) : "");
    W.barSlot("dw-bt", sc ? W.barText(sc) : "");
    const chip = document.querySelector("#dashBar .dw-chip"), bt = document.querySelector("#dashBar .dw-bt");
    if (chip && bt && chip.nextElementSibling !== bt) chip.after(bt);
    if (chip && sc && sc.source) chip.title = `${sc.source.mb[0]}/${sc.source.mb[1]} MB・${sc.source.rate} MB/秒・いま ${sc.source.now}`;
    if (W.bar2) W.bar2(sc);
  };
  if (!W.timer2) { clearInterval(W.timer); W.timer2 = setInterval(W.tick, 200); }
}
const ENGINE2 = `(${engine2})()`;
const OFF2 = OFF + `
#dashGrid .dw-t{margin-left:10px;color:#2f557f;white-space:nowrap}
#dashGrid .dw-t b,#dashGrid .dw-c b{font-weight:700;color:#24467a}
.dw-over{font-style:normal;color:#8a4b00;font-weight:700}
#dashGrid .dw-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:#2f557f;font-size:14px;pointer-events:none}
#dashGrid .dw-c2{font-size:13px;color:#3b4652}
#dashBar .dw-bt{flex:0 1 auto;min-width:0;margin-left:14px;font-size:12.5px;color:#3b4652;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#dashBar .dw-bt b{color:#24384d}
#dashBar .dw-chip{flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:7px;height:26px;margin-left:14px;padding:0 11px;border-radius:13px;background:#e9eff6;color:#24384d;font-size:12.5px;white-space:nowrap;overflow:hidden}
#dashBar .dw-chip + .dw-bt{margin-left:10px}`;
// 線の印（確定の進み。字の n/m と同じ数）
const LINE = `.dw-line{flex:0 0 auto;display:inline-block;width:56px;height:4px;border-radius:2px;background:#dfe6ee;position:relative;overflow:hidden;vertical-align:middle}
.dw-line::after{content:"";position:absolute;inset:0;width:var(--f);background:#3f6591}
.dw-line.is-over::after{background:#b36b00}`;

PROPOSALS.push(
  // E2（1 回目の E を直した形・持ち越し）: 印はデータ元の札の線 1 本だけ（写している間だけ）。パネルは字だけ
  { key: "E2", round: 2, name: "E を直した形: 写すはデータ元の札に 1 回だけ・パネルは字だけ（段→何を→あと）", css: OFF2 + LINE,
    ops: [["script", ENGINE2], js(() => {
      const W = window.__dw;
      W.chip = (s) => `<b>${s.name}</b><i class="dw-line" style="--f:${Math.round((s.n / s.of) * 100)}%"></i>共有から写しています ${s.n}/${s.of} 台・あと約 ${W.secs(s.left)}`;
    })] },

  // G（新）: 字の下に、字と同じ n/m の確定の下線（印はどこでもこの 1 種類。写している札・中身の真ん中も同じ下線）
  { key: "G", round: 2, name: "字の下線が進む（n/m と同じ長さの下線 1 種類を、パネル・真ん中・写す札で）", css: OFF2 + `
    .dw-u{padding-bottom:0;background:linear-gradient(#3f6591,#3f6591) 0 100%/var(--f) 2px no-repeat,linear-gradient(#d3dce6,#d3dce6) 0 100%/100% 2px no-repeat}
    .dw-u.is-over{background:linear-gradient(#b36b00,#b36b00) 0 100%/100% 2px no-repeat}
    #dashGrid .dw-c .dw-u{padding-bottom:6px;background-size:var(--f) 3px,100% 3px}`,
    ops: [["script", ENGINE2], js(() => {
      const W = window.__dw;
      const u = (f, html) => `<span class="dw-u${f.over ? " is-over" : ""}" style="--f:${Math.round(W.frac(f) * 100)}%">${html}</span>`;
      W.inline = (f, w) => [u(f, `<b>${w.step}</b>${w.what ? ` ${w.what}` : ""}`), w.eta].filter(Boolean).join("・") + w.detail;
      W.center = (f, w) => `<div class="dw-c1">${u(f, `<b>${w.step}</b> ${w.what}`)}</div><div class="dw-c2">${w.eta}${w.detail}</div>`;
      W.chip = (s) => `<b>${s.name}</b> <span class="dw-u" style="--f:${Math.round((s.n / s.of) * 100)}%">共有から写しています ${s.n}/${s.of} 台</span>・あと約 ${W.secs(s.left)}`;
    })] },

  // H（新）: 経過と前回の目盛り。字の後ろに短い目盛り（満ちる＝経過÷前回、写す段は経過÷見込み）。前回を超えると満ちて色が替わり字も言い替える
  { key: "H", round: 2, name: "経過と前回の目盛り（前回より長いと色と字で言う）", css: OFF2 + LINE + `
    .dw-g{display:inline-flex;align-items:center;gap:5px;margin-left:6px;color:#3b4652}
    #dashGrid .dw-c .dw-line{width:120px;height:5px}`,
    ops: [["script", ENGINE2], js(() => {
      const W = window.__dw;
      const g = (f) => { const tot = f.prev || (f.sec + (f.left || 0)); const fr = f.over ? 1 : Math.min(1, f.sec / tot);
        return `<span class="dw-g"><i class="dw-line${f.over ? " is-over" : ""}" style="--f:${Math.round(fr * 100)}%"></i>${f.sec} 秒／${f.prev ? `前回 ${f.prev} 秒` : `見込み約 ${W.secs(tot)}`}</span>`; };
      const go = (f) => `<span class="dw-g"><i class="dw-line is-over" style="--f:100%"></i></span>`;
      // 省く順: 何を → 目盛りの字（目盛りの線は残す）
      const gl = (f) => (f.over ? go(f) : g(f).replace(/<\/i>.*<\/span>$/, "</i></span>"));
      W.inline = (f, w) => (w.lv >= 4 ? `<b>${w.step}</b>` : [`<b>${w.step}</b>${w.what ? ` ${w.what}` : ""}`, w.lv >= 3 ? gl(f) : f.over ? go(f) + " " + w.eta : g(f)].join("・"));
      W.center = (f, w) => `<div class="dw-c1"><b>${w.step}</b> ${w.what}</div><div class="dw-c2">${f.over ? go(f) + " " + w.eta : g(f)}</div>`;
      W.chip = (s) => `<b>${s.name}</b><i class="dw-line" style="--f:${Math.round((s.sec / s.total) * 100)}%"></i>共有から写しています ${s.n}/${s.of} 台・${s.sec} 秒／見込み約 ${W.secs(s.total)}`;
    })] },

  // I（新）: 題の左の色の点を、待っている間だけ字の n/m と同じだけ満ちる小さな円に替える（印はこの円 1 種類。写す札も同じ円）
  { key: "I", round: 2, name: "題の左の点が満ちる円になる（n/m と同じ）＋添え書きの後ろに字", css: OFF2 + `
    .dw-hidedot{display:none!important}
    .dw-pie{flex:0 0 auto;width:13px;height:13px;border-radius:50%;background:conic-gradient(#3f6591 var(--f),#d3dce6 0);box-shadow:inset 0 0 0 1.5px #3f6591}
    .dw-pie.is-over{background:#b36b00;box-shadow:none}
    #dashGrid .dw-c .dw-pie{width:26px;height:26px}
    #dashBar .dw-chip .dw-pie{width:12px;height:12px}`,
    ops: [["script", ENGINE2], js(() => {
      const W = window.__dw;
      const pie = (f) => `<i class="dw-pie${f.over ? " is-over" : ""}" style="--f:${Math.round(W.frac(f) * 100)}%"></i>`;
      W.mark = (el, f) => {
        const ph = el.querySelector(".db-ph"), dot = ph && ph.querySelector(".db-dot");
        if (dot) dot.classList.add("dw-hidedot");
        let p = ph && ph.querySelector(".dw-pie");
        const html = pie(f);
        if (ph && (!p || p.dataset.h !== html)) { p?.remove(); ph.insertAdjacentHTML("afterbegin", html); p = ph.querySelector(".dw-pie"); p.classList.add("dw-x"); p.dataset.h = html; }
      };
      W.center = (f, w) => `<div>${pie(f)}</div><div class="dw-c1"><b>${w.step}</b> ${w.what}</div><div class="dw-c2">${w.eta}${w.detail}</div>`;
      W.chip = (s) => `<i class="dw-pie" style="--f:${Math.round((s.n / s.of) * 100)}%"></i><b>${s.name}</b> 共有から写しています ${s.n}/${s.of} 台・あと約 ${W.secs(s.left)}`;
    })] },

  // J（E2 ＋ 1 回目の C の内訳を 2 手目に）: パネルは E2 と同じ字。道具の行の「内訳 ▾」でパネルごとの 段・何を・経過・前回 の表
  { key: "J", round: 2, name: "E2 ＋ 道具の行の「内訳 ▾」でパネルごとの段・経過・前回（2 手目）", css: OFF2 + LINE + `
    #dashBar .dwJ-more{flex:0 0 auto;height:24px;margin-left:8px;padding:0 9px;border:1px solid #c5ced9;border-radius:6px;background:#fff;font:inherit;font-size:12px;font-weight:700;color:#3b4652}
    .dwJ-pop{position:fixed;z-index:50;width:max-content;max-width:calc(100vw - 24px);background:#fff;border:1px solid #c5ced9;border-radius:8px;box-shadow:0 8px 24px rgba(20,40,60,.18);padding:10px 12px;font-size:12.5px;color:#24384d}
    .dwJ-pop h4{margin:0 0 6px;font-size:13px}
    .dwJ-pop table{border-collapse:collapse}
    .dwJ-pop th{font-weight:600;color:#4a5866;text-align:left;padding:1px 8px;border-bottom:1px solid #e3e9ee;font-size:12px}
    .dwJ-pop td{padding:1px 8px;line-height:1.35;border-bottom:1px solid #eef2f5;white-space:nowrap}
    .dwJ-pop td.n{text-align:right;font-variant-numeric:tabular-nums}`,
    ops: [["script", ENGINE2], js(() => {
      const W = window.__dw;
      W.chip = (s) => `<b>${s.name}</b><i class="dw-line" style="--f:${Math.round((s.n / s.of) * 100)}%"></i>共有から写しています ${s.n}/${s.of} 台・あと約 ${W.secs(s.left)}`;
      W.bar2 = (sc) => {
        W.barSlot("dwJ-more", sc ? "内訳 ▾" : "");
        const b = document.querySelector("#dashBar .dwJ-more"), bt = document.querySelector("#dashBar .dw-bt");
        if (b && bt && bt.nextElementSibling !== b) bt.after(b);
        const pop = document.querySelector(".dwJ-pop");
        if (!sc || !sc.open) { if (pop) { pop.remove(); document.querySelectorAll(".dwJ-hide").forEach((x) => x.classList.remove("dwJ-hide")); } return; }
        if (pop || !b) return;
        const rows = [...document.querySelectorAll("#dashGrid .db-p.dw-on")].map((el) => {
          const f = sc.panels[el.dataset.id], w = W.words(f, { detail: true, data: true });
          return `<tr><td>${el.querySelector(".db-ph h3")?.textContent || ""}</td><td>${w.step}</td><td>${w.what}</td><td class="n">${f.sec} 秒</td><td class="n">${f.prev ? `${f.prev} 秒` : "—"}</td><td>${f.over ? '<i class="dw-over">前回より長い</i>' : f.left < 1 ? "まもなく" : `あと約 ${W.secs(f.left)}`}</td></tr>`;
        }).join("");
        const n = document.createElement("div"); n.className = "dwJ-pop dw-x";
        n.innerHTML = `<h4>待っているパネル</h4><table><tr><th>パネル</th><th>段</th><th>何を</th><th>経過</th><th>前回</th><th>あとどのくらい</th></tr>${rows}</table>`;
        document.body.append(n);
        const r = b.getBoundingClientRect();
        n.style.top = `${r.bottom + 6}px`; n.style.left = `${Math.max(12, Math.min(r.right, innerWidth - 12) - n.offsetWidth)}px`;
      };
    })] },
);

/* ================================================================== 3 回目（2 回目の採点の evaluator_next を受けて）
   2 回目の共通の決まりはそのまま（作り物の段の知らせも FEED2）。替えた所（どの案にも共通）:
   - 縮めるとき最後まで残すのは「途中の数か」と n/m。省く順: （前回 n 秒）→ データの名前（画面ぜんぶ）→ あとどのくらい（道具の行が言う）→ 段の言葉を短く。
     読む: 「作業実績を読む 9/11 台・まもなく（前回 2.1 秒）」→ … →「読む 9/11 台」→「読む 9/11」
     写している間: 「写し待ち いまの数は写した 5/11 台の分・あと約 7 秒」→「写し待ち 写した 5/11 台の分」→「写した 5/11 台分」→「途中 5/11」
   - 秒は小数 1 桁にそろえる（前回 2.0 秒）
   - 印は 1 種類（案ごと）。字のすぐそば、または題の頭。n/m と同じだけ満ちる。前回を超えたら満ちて外の輪・枠が茶色＋字の言い替え（色だけにしない） */
function r3common() {
  const W = window.__dw;
  const s1 = (n) => Number(n).toFixed(1);
  W.eta = (f) => (f.over ? `<i class="dw-over">前回 ${s1(f.prev)} 秒より長くかかっています（${s1(f.sec)} 秒）</i>` : f.left < 1 ? "まもなく" : `あと約 ${W.secs(f.left)}`);
  W.opt = (lv) => ({ lv, detail: lv < 1, data: !W.dropData });
  W.words = (f, o) => {
    const lv = o.lv || 0, data = o.data !== false;
    if (f.copy) {
      if (lv >= 4) return { step: "途中", what: `${f.n}/${f.of}`, eta: "", detail: "", lv };
      if (lv >= 3) return { step: "", what: `写した ${f.n}/${f.of} 台分`, eta: "", detail: "", lv };
      return { step: "写し待ち", what: `${data && lv < 2 ? "いまの数は" : ""}写した ${f.n}/${f.of} 台の分`, eta: lv >= 2 ? "" : W.eta(f), detail: "", lv };
    }
    const n = f.what;                                                      // 7/11 台・まとまり 1/2 済み・11 品種
    const short = n.replace(/^まとまり /, "").replace(/ 済み$/, "").replace(/ (台|品種)$/, "");
    if (lv >= 4) return { step: f.verb, what: f.over ? n : short, eta: f.over ? W.eta(f) : "", detail: "", lv };
    return { step: lv >= 3 ? f.verb : (f.calc || (data ? f.data : "")) + f.verb, what: n + (o.detail ? f.extra : ""), eta: lv >= 2 && !f.over ? "" : W.eta(f),
             detail: o.detail && f.prev && !f.over ? `（前回 ${s1(f.prev)} 秒）` : "", lv };
  };
  W.txt = (w) => [[w.step ? `<b>${w.step}</b>` : "", w.what].filter(Boolean).join(" "), w.eta].filter(Boolean).join("・") + (w.detail || "");
  W.inline = (f, w) => W.txt(w);
  W.center = (f, w) => `<div class="dw-c1">${[w.step ? `<b>${w.step}</b>` : "", w.what].filter(Boolean).join(" ")}</div><div class="dw-c2">${w.eta}${w.detail}</div>`;
  /** パネルのデータの色（題の左の点の色。合わせた表は枠の色） */
  W.dc = (el) => (el && ((el.querySelector(".db-ph .db-dot") || {}).style || { getPropertyValue: () => "" }).getPropertyValue("--c")) || (el && el.style.getPropertyValue("--pc")) || "#3f6591";
  W.workColor = () => W.dc(document.querySelector("#dashGrid .db-p.dw-on"));
  W.chip = (s) => `${W.markHtml ? W.markHtml({ frac: s.n / s.of }, W.workColor()) : ""}<b>${s.name}</b> 共有から写しています ${s.n}/${s.of} 台・あと約 ${W.secs(s.left)}`;
}
const R3 = (fn) => [["script", ENGINE2], js(r3common), js(fn)];
const CSS3 = OFF2 + `
.dw-over{font-style:normal;color:#8a4b00;font-weight:700}
#dashBar .dw-chip{gap:7px}`;

/* 内訳（2 手目）: 道具の行の「内訳 ▾」。面は窓の右下に出して、道具の行・期間の段・上の数字のパネルを覆わない */
function drawer() {
  const W = window.__dw;
  W.bar2 = (sc) => {
    W.barSlot("dwJ-more", sc ? "内訳 ▾" : "");
    const b = document.querySelector("#dashBar .dwJ-more"), bt = document.querySelector("#dashBar .dw-bt");
    if (b && bt && bt.nextElementSibling !== b) bt.after(b);
    const pop = document.querySelector(".dwJ-pop");
    if (!sc || !sc.open) { if (pop) { pop.remove(); document.querySelectorAll(".dwJ-hide").forEach((x) => x.classList.remove("dwJ-hide")); } return; }
    if (pop || !b) return;
    const s1 = (n) => Number(n).toFixed(1);
    const rows = [...document.querySelectorAll("#dashGrid .db-p.dw-on")].map((el) => {
      const f = sc.panels[el.dataset.id], w = W.words(f, { detail: false, data: true });
      return `<tr><td>${W.markHtml ? W.markHtml(f, W.dc(el)) : ""}</td><td>${el.querySelector(".db-ph h3")?.textContent || ""}</td><td>${w.step}</td><td>${f.what}${f.extra}</td><td class="n">${s1(f.sec)} 秒</td><td class="n">${f.prev ? `${s1(f.prev)} 秒` : "—"}</td><td>${f.over ? '<i class="dw-over">前回より長い</i>' : f.left < 1 ? "まもなく" : `あと約 ${W.secs(f.left)}`}</td></tr>`;
    }).join("");
    // 浮かべずに、グリッドの上に帯として差し込む（何も覆わない。グリッドがその分だけ低くなる）
    const n = document.createElement("div"); n.className = "dwJ-pop dw-x";
    n.innerHTML = `<h4><button type="button" class="dwJ-x" aria-label="内訳を閉じる">×</button></h4><table><tr><th></th><th>待っているパネル</th><th>段</th><th>何を</th><th>経過</th><th>前回</th><th>あとどのくらい</th></tr>${rows}</table>`;
    const g = document.querySelector("#dashGrid"), st = g.closest(".db-stage") || g;
    // 開いている間は、すぐ上の期間・設備の段（スライサー）の代わりに出す（高さを増やさない。閉じれば戻る）
    const band = st.previousElementSibling && st.previousElementSibling.id !== "dashBar" ? st.previousElementSibling : null;
    if (band) { band.classList.add("dwJ-hide"); n.dataset.band = "1"; }
    st.before(n);
  };
}
const DRAWER_CSS = `
#dashBar .dwJ-more{flex:0 0 auto;height:24px;margin-left:8px;padding:0 9px;border:1px solid #c5ced9;border-radius:6px;background:#fff;font:inherit;font-size:12px;font-weight:700;color:#3b4652}
.dwJ-hide{display:none!important}
.dwJ-pop{flex:0 0 auto;display:flex;align-items:flex-start;gap:14px;background:#fff;border:1px solid #c5ced9;border-radius:8px;padding:3px 10px;font-size:12px;color:#24384d}
.dwJ-pop h4{order:2;display:flex;align-items:center;gap:6px;margin:0;font-size:12px;white-space:nowrap;color:#4a5866;font-weight:600}
.dwJ-pop table{order:1;flex:1;width:100%}
.dwJ-x{border:0;background:none;font-size:16px;line-height:1;color:#4a5866;cursor:pointer}
.dwJ-pop table{border-collapse:collapse}
.dwJ-pop th{font-weight:600;color:#4a5866;text-align:left;padding:1px 8px;border-bottom:1px solid #e3e9ee;font-size:12px}
.dwJ-pop td{padding:1px 8px;line-height:1.35;border-bottom:1px solid #eef2f5;white-space:nowrap;vertical-align:middle}
.dwJ-pop td.n{text-align:right;font-variant-numeric:tabular-nums}`;

// I の円（データの色で満ちる・16px・前回を超えたら外の輪が茶色）
const PIE_CSS = `
.dw-hidedot{display:none!important}
.dw-pie{flex:0 0 auto;display:inline-block;vertical-align:middle;width:16px;height:16px;border-radius:50%;background:conic-gradient(var(--dc) var(--f),#e6ebf0 0);box-shadow:inset 0 0 0 1.5px var(--dc)}
.dw-pie.is-over{background:var(--dc);box-shadow:0 0 0 2px #fff,0 0 0 4px #b36b00}
#dashGrid .dw-c .dw-pie{width:30px;height:30px}
.dwJ-pop .dw-pie{width:13px;height:13px}`;
function pieMark() {
  const W = window.__dw;
  W.markHtml = (f, dc) => `<i class="dw-pie${f.over ? " is-over" : ""}" style="--f:${Math.round(W.frac(f) * 100)}%;--dc:${dc}" aria-hidden="true"></i>`;
}
function pieTitle() {   // 題の左の点を、待っている間だけ同じ色の円に
  const W = window.__dw;
  W.mark = (el, f) => {
    const ph = el.querySelector(".db-ph"), dot = ph && ph.querySelector(".db-dot");
    const dc = W.dc(el);
    if (dot) dot.classList.add("dw-hidedot");
    const html = W.markHtml(f, dc);
    let p = ph && ph.querySelector(".dw-pie");
    if (ph && (!p || p.dataset.h !== html)) { p?.remove(); ph.insertAdjacentHTML("afterbegin", html); p = ph.querySelector(".dw-pie"); p.classList.add("dw-x"); p.dataset.h = html; }
  };
  const c = W.center;
  W.center = (f, w) => `<div>${W.markHtml(f, W.cur || "#3f6591")}</div>` + c(f, w);
  const m0 = W.mark;
  W.mark = (el, f) => { W.cur = W.dc(el); m0(el, f); };
}

PROPOSALS.push(
  // I2（2 回目の I を直した形）: 題の左の点が、データの色のまま n/m だけ満ちる 16px の円になる
  { key: "I2", round: 3, name: "I を直した形: 題の左の点がデータの色で満ちる円（16px）", css: CSS3 + PIE_CSS,
    ops: R3(() => {}).concat([js(pieMark), js(pieTitle)]) },

  // I3（I2 ＋ 内訳を 2 手目に。面は窓の右下）
  { key: "I3", round: 3, name: "I2 ＋ 道具の行の「内訳 ▾」（グリッドの上の帯。何も覆わない）", css: CSS3 + PIE_CSS + DRAWER_CSS,
    ops: R3(() => {}).concat([js(pieMark), js(pieTitle), js(drawer)]) },

  // G2（2 回目の G を直した形）: 下線をやめ、字の左に短い進みの線（n/m の長さ。データの色）
  { key: "G2", round: 3, name: "G を直した形: 字の左に短い進みの線（n/m・データの色。リンクに見えない）", css: CSS3 + `
    .dw-bar{flex:0 0 auto;display:inline-block;vertical-align:middle;width:28px;height:6px;margin:0 6px 2px 0;border-radius:3px;background:linear-gradient(var(--dc),var(--dc)) 0 0/var(--f) 100% no-repeat,#e3e8ee}
    .dw-bar.is-over{background:var(--dc);box-shadow:0 0 0 1.5px #fff,0 0 0 3px #b36b00}
    #dashGrid .dw-c .dw-bar{width:120px;height:8px;margin:0 0 4px}`,
    ops: R3(() => {
      const W = window.__dw;
      W.markHtml = (f, dc) => `<i class="dw-bar${f.over ? " is-over" : ""}" style="--f:${Math.round(W.frac(f) * 100)}%;--dc:${dc}" aria-hidden="true"></i>`;
      W.mark = (el) => { W.cur = W.dc(el); };
      W.inline = (f, w) => W.markHtml(f, W.cur) + W.txt(w);
      const c = W.center; W.center = (f, w) => `<div>${W.markHtml(f, W.cur)}</div>` + c(f, w);
    }) },

  // K（新）: 待ちの字そのものを札にし、札の地が n/m だけ満ちる。写している間は数を薄くして札は「途中」から言う
  { key: "K", round: 3, name: "字の札が満ちる（札の地が n/m）・写している間は数を薄くして「途中」の札", css: CSS3 + `
    .dw-pill{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:10px;border:1px solid #c9d5e2;color:#24384d;white-space:nowrap;
      background:linear-gradient(var(--dt),var(--dt)) 0 0/var(--f) 100% no-repeat,#fff}
    .dw-pill.is-over{border:2px solid #b36b00}
    #dashGrid .dw-c .dw-pill{height:28px;padding:0 14px;font-size:14px;border-radius:14px}
    #dashGrid .db-p.dw-part .dp-num{opacity:.45}
    #dashBar .dw-chip{background:none;padding:0;gap:0}
    #dashBar .dw-chip .dw-pill{margin-right:4px}`,
    ops: R3(() => {
      const W = window.__dw;
      const tint = (dc) => `color-mix(in srgb, ${dc} 22%, #fff)`;
      W.pill = (f, dc, html) => `<span class="dw-pill${f.over ? " is-over" : ""}" style="--f:${Math.round(W.frac(f) * 100)}%;--dt:${tint(dc)}">${html}</span>`;
      W.markHtml = null;
      W.mark = (el, f) => { W.cur = W.dc(el); el.classList.toggle("dw-part", !!f.copy); };
      const c0 = W.clear; W.clear = (el) => { el.classList.remove("dw-part"); c0(el); };
      W.inline = (f, w) => {
        const head = [w.step ? `<b>${w.step}</b>` : "", w.what].filter(Boolean).join(" ");
        return W.pill(f, W.cur, head) + (w.eta ? `・${w.eta}` : "") + (w.detail || "");
      };
      W.center = (f, w) => `<div class="dw-c1">${W.pill(f, W.cur, [w.step ? `<b>${w.step}</b>` : "", w.what].filter(Boolean).join(" "))}</div><div class="dw-c2">${w.eta}${w.detail}</div>`;
      W.chip = (s) => `<span class="dw-pill" style="--f:${Math.round((s.n / s.of) * 100)}%;--dt:${tint(W.workColor())}"><b>${s.name}</b> 共有から写しています ${s.n}/${s.of} 台</span>・あと約 ${W.secs(s.left)}`;
    }) },

  // L（新）: 題の点はそのまま（データの色を残す）。待ちの字の頭に、データの色で n/m だけ満ちる円
  { key: "L", round: 3, name: "字の頭に円（題の色の点はそのまま・円はデータの色で n/m）", css: CSS3 + PIE_CSS + `
    #dashGrid .dw-t .dw-pie{width:15px;height:15px;margin:0 5px 2px 0}
    #dashBar .dw-chip .dw-pie{width:14px;height:14px}`,
    ops: R3(() => {}).concat([js(pieMark), js(() => {
      const W = window.__dw;
      W.mark = (el) => { W.cur = W.dc(el); };
      W.inline = (f, w) => W.markHtml(f, W.cur) + W.txt(w);
      const c = W.center; W.center = (f, w) => `<div>${W.markHtml(f, W.cur)}</div>` + c(f, w);
    })]) },

  // R（新）: 段の 3 つの升（写す・読む・数える）。済んだ段は塗り・いまの段は n/m まで塗る。どの段かと進みを 1 つの印で
  { key: "R", round: 3, name: "段の 3 つの升（写す・読む・数える）を字の頭に・いまの段は n/m まで塗る", css: CSS3 + `
    .dw-steps{display:inline-flex;gap:2px;vertical-align:middle;margin:0 6px 2px 0}
    .dw-steps i{width:13px;height:13px;border-radius:2px;box-shadow:inset 0 0 0 1.5px var(--dc);background:linear-gradient(var(--dc),var(--dc)) 0 0/var(--f) 100% no-repeat,#fff}
    .dw-steps i.is-over{box-shadow:0 0 0 1.5px #fff,0 0 0 3px #b36b00;background:var(--dc)}
    #dashGrid .dw-c .dw-steps{gap:4px;margin:0 0 4px}
    #dashGrid .dw-c .dw-steps i{width:22px;height:22px;border-radius:4px}`,
    ops: R3(() => {
      const W = window.__dw;
      const stepOf = (f) => (f.copy ? 1 : /読む/.test(f.verb) ? 2 : 3);
      W.markHtml = (f, dc) => { const k = f.k || stepOf(f), fr = Math.round(W.frac(f) * 100);
        return `<span class="dw-steps" style="--dc:${dc}" title="写す → 読む → 数える">${[1, 2, 3].map((i) => `<i class="${i === k && f.over ? "is-over" : ""}" style="--f:${i < k ? 100 : i === k ? (f.over ? 100 : fr) : 0}%"></i>`).join("")}</span>`; };
      W.mark = (el) => { W.cur = W.dc(el); };
      W.inline = (f, w) => W.markHtml(f, W.cur) + W.txt(w);
      const c = W.center; W.center = (f, w) => `<div>${W.markHtml(f, W.cur)}</div>` + c(f, w);
      W.chip = (s) => `${W.markHtml({ k: 1, frac: s.n / s.of }, W.workColor())}<b>${s.name}</b> 共有から写しています ${s.n}/${s.of} 台・あと約 ${W.secs(s.left)}`;
    }) },
);

/* ------------------------------------------------------------------ 撮る（この定義を直に流したとき） */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

function applyOps(ops) {
  const pick = (selector) => { const el = document.querySelector(selector); if (!el) throw new Error("見つからない: " + selector); return el; };
  const place = (node, where, target) => ({ before: () => target.before(node), after: () => target.after(node), prepend: () => target.prepend(node), append: () => target.append(node) })[where]();
  for (const [kind, a, b, c] of ops) {
    if (kind === "move") place(pick(a), b, pick(c));
    else if (kind === "class") pick(a).className = b;
    else if (kind === "insert") pick(c).insertAdjacentHTML(b, a);
    else if (kind === "attr") { if (c === null) pick(a).removeAttribute(b); else pick(a).setAttribute(b, c); }
    else if (kind === "script") new Function(a)();
  }
}

async function main() {
  process.env.TPA_UI_BYPASS_CSP = "1";
  const { launch, parseView, waitDash, sleep } = await import("../ui-harness.mjs");
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const OUT = path.resolve(args[0] || "dashwait");
  const VIEW = parseView(opt("view", ""));
  const ONLY = (opt("only", "") || "").split(",").filter(Boolean);
  const SCENES = (opt("scenes", "first,recount,copy,long")).split(",");
  const TAKE = PROPOSALS.filter((p) => !ONLY.length || ONLY.includes(p.key));
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launch();
  try {
    for (const p of TAKE) {
      const page = await app.newPage("light", VIEW, { screen: "dash" });
      const install = `(() => { const go = () => { const css = ${JSON.stringify(p.css || "")};
        if (css && !document.getElementById("dw-css")) document.head.append(Object.assign(document.createElement("style"), { id: "dw-css", textContent: css }));
        (${applyOps})(${JSON.stringify(p.ops || [])}); };
        document.readyState === "loading" ? addEventListener("DOMContentLoaded", go) : go(); })()`;
      await page.addInitScript(install);
      await page.evaluate(install);
      const std = await page.evaluate(() => Dashboard._state().layout);
      for (const scene of SCENES) {
        const held = [];
        const workIds = scene === "long" ? ["gantt", "abc"] : ["workTotal", "workMonth", "workDays", "board"];
        // 先に組みを置いて数を出しておく（数え直し・長い計算は前の数がある所から）
        const layout = scene === "long" ? LONG_LAYOUT : std;
        await page.evaluate(() => { (window.__dw = window.__dw || {}).scene = null; });
        if (scene !== "first" && scene !== "copy") { await page.evaluate((l) => Dashboard._setLayout(l), layout); await sleep(500); await waitDash(page); await sleep(500); }
        await page.route("**/api/dashboard/query**", async (route) => {
          let id = "";
          try { id = route.request().postDataJSON().panel.id; } catch (_) { /* 本文が無い */ }
          if (!workIds.includes(id)) return route.continue();
          if (scene !== "copy") { held.push(route); return; }       // 止める（撮った後に流す）
          // 写している: 本物の答えに、写し終えていない 6 台を「写しています」で足す（写した 5 台だけの途中の数）
          const resp = await route.fetch(); const j = await resp.json();
          const cut = (a) => { if (!a || !Array.isArray(a.mirrors)) return; const names = ["CR2", "L-2", "LS3", "CAL", "HOT", "SL1"];
            a.mirrors = a.mirrors.slice(0, 5); a.failed = (a.failed || []).filter((f) => !names.includes(f.name)).concat(names.map((n) => ({ name: n, kind: "copying", error: "共有から写しています", status: 503 }))); };
          if (Array.isArray(j.groups)) j.groups.forEach((g) => { if (g && g.mirrors && g.mirrors.length > 3) cut(g); }); else cut(j);
          await sleep(300);
          return route.fulfill({ response: resp, json: j });
        });
        await page.evaluate((s) => { (window.__dw = window.__dw || {}).scene = s; }, (p.round >= 2 ? FEED2 : FEED)[scene]);
        const wait = { first: 1800, recount: 1400, copy: 4500, long: 6500 }[scene];
        if (scene === "first" || scene === "copy") await page.evaluate((l) => Dashboard._setLayout(l), layout);
        else await page.click("[data-db-refresh]");
        await sleep(wait);
        await page.screenshot({ path: path.join(OUT, `${scene}-${p.key}.png`) });
        console.log(`${scene}-${p.key}`);
        await page.evaluate(() => { (window.__dw = window.__dw || {}).scene = null; });
        await page.unroute("**/api/dashboard/query**");
        for (const r of held) await r.continue().catch(() => {});
        await sleep(400);
        await waitDash(page).catch(() => {});
        await sleep(300);
      }
      // 元の組みに戻す（次の案のため）
      await page.evaluate((l) => Dashboard._setLayout(l), std); await sleep(300);
      await page.context().close();
    }
    // 場面ごとの一覧
    for (const scene of SCENES) {
      const shown = PROPOSALS.filter(({ key }) => fs.existsSync(path.join(OUT, `${scene}-${key}.png`)));
      const cols = Math.min(3, shown.length), tileH = Math.round((640 * VIEW.height) / VIEW.width);
      const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#e9edf2;color:#16202b;font:15px system-ui,sans-serif}
        h1{margin:0 0 14px;font-size:20px} main{display:grid;grid-template-columns:repeat(${cols},640px);gap:16px} figure{margin:0}
        figcaption{margin-bottom:6px} img{width:640px;height:${tileH}px;border:1px solid #c5ced9;border-radius:6px}</style>
        <h1>${scene}（${VIEW.width}×${VIEW.height}）</h1><main>${shown.map(({ key, name }) => `<figure><figcaption><b>${key}</b> ${name}</figcaption><img src="${encodeURIComponent(`${scene}-${key}.png`)}"></figure>`).join("")}</main>`;
      const file = path.join(OUT, `sheet-${scene}.html`);
      fs.writeFileSync(file, html);
      const pg = await app.browser.newPage({ viewport: { width: cols * 656 + 24, height: 400 } });
      await pg.goto(pathToFileURL(file).href);
      await pg.waitForFunction(() => [...document.images].every((i) => i.complete));
      await pg.screenshot({ path: path.join(OUT, `sheet-${scene}.png`), fullPage: true });
      await pg.close();
      fs.rmSync(file);
    }
  } finally {
    await app.close();
  }
}
