// 2026-10 タイムライン（期間を 2 点のスライダーで絞る）・スライサーの値の並べ替え・狭い幅で字が切れない（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-timeline.mjs --states slicer [--view 1536x864]
// 利用者の要望: スライサーの値（押すとボタンとして効く行）の並びを変えたい。スライサーの幅を縮めたときに字が切れないように。
//   時間を示す列を選んで使う「タイムライン」（2 点を動かすスライダーで期間を決めて絞る）を、スライサーと同じ列の足し方でオプションとして。
// 今の画面（画像で見えたこと）: 値の並びは値の順（SortKey）で決まっていて変えられない。幅 200px では「24/08/12 23:48:54」のような
//   長い値が「…」で切れ、何の値か読めない。発生日は書き方がばらばら（2025.1.13・2024年10月28日・20241007）で、スライサーにすると
//   1000 通りの値が 1 行ずつ並び、期間で選ぶには何百回も押す。
// 案は、左に置いたスライサー（幅 220px に縮めた所）に、発生日のタイムライン（本物の件数を日付で読んでまとめた物）と、値の並びの操作を当てて比べる。
//
// 方向（何で解くか）: A 借りる＝Excel のタイムラインと同じ（年・四半期・月・日の目盛りのタイル＋両端の取っ手）、値の並びは ⋯ のメニュー
// ／B 見せ方＝件数の山（ヒストグラム）の下に 2 点のスライダー・期間の字・日付の欄、値の並びはカードの「並び ▾」
// ／C 減らし方＝スライダーと期間の字だけ（山も欄も無し）、値の並びは値の上の見出し（値 ▲｜件数）を押す
// ／D 流れ＝よく使う期間の札（直近 7 日・30 日・今月・先月・今年・全期間）→ 日付の欄 → スライダーで微調整、値の並びは ⋯
// ／E 置き場＝タイムラインは表の上の全幅の帯（スライサーの面とは別）、値の並びは ⋯
// 5 案は「タイムラインをスライダーの形で置く」に寄る → 方向の違う 2 案を足す:
// F 値の側で解く＝値の行を ⋮⋮ で引いて手で並べる（並びは「手で」に）。タイムラインは B を小さく（山を低く・欄なし）
// G 期間を値の帯で選ぶ＝タイムラインも値の行（月ごとの件数の帯）にして、始めの月と終わりの月を押して範囲（間は塗る）。値の並びは探す欄の横の札（値順｜件数順）

export const KIT = ["script", `
(() => {
  const $ = (s) => document.querySelector(s);
  const T = window.__tl = {
    $, data: null, from: "2025-04-01", to: "2025-09-30",
    load() { if (T.data || T.busy) return; T.busy = 1;
      fetch("/api/lotlist/slicer?column=" + encodeURIComponent("発生日") + "&key=date&table=" + encodeURIComponent("仕掛")).then((r) => r.json()).then((d) => {
        T.data = (d.values || []).filter((x) => /^\\d{4}-\\d{2}-\\d{2}$/.test(x.value)).map((x) => [x.value, x.count]);
        T.bad = (d.values || []).filter((x) => !/^\\d{4}-\\d{2}-\\d{2}$/.test(x.value)).reduce((n, x) => n + x.count, 0); }); },
    months() { const by = new Map(); (T.data || []).forEach(([d, n]) => { const m = d.slice(0, 7); by.set(m, (by.get(m) || 0) + n); });
      const ks = [...by.keys()].sort(); if (!ks.length) return []; const out = []; let [y, m] = ks[0].split("-").map(Number); const [ey, em] = ks[ks.length - 1].split("-").map(Number);
      while (y < ey || (y === ey && m <= em)) { const k = y + "-" + String(m).padStart(2, "0"); out.push([k, by.get(k) || 0]); m++; if (m > 12) { m = 1; y++; } } return out; },
    inSel: (k) => k >= T.from.slice(0, 7) && k <= T.to.slice(0, 7),
    total() { return (T.data || []).filter(([d]) => d >= T.from && d <= T.to).reduce((n, [, c]) => n + c, 0); },
    pos() { const ms = T.months(); const i = ms.findIndex(([k]) => k === T.from.slice(0, 7)), j = ms.findIndex(([k]) => k === T.to.slice(0, 7));
      return [i / ms.length * 100, (j + 1) / ms.length * 100]; },
    bars(h) { const ms = T.months(), max = Math.max(1, ...ms.map((x) => x[1]));
      return '<div class="tl-bars" style="height:' + h + 'px">' + ms.map(([k, n]) => '<i class="' + (T.inSel(k) ? "on" : "") + '" style="height:' + Math.max(2, Math.round(n / max * h)) + 'px" title="' + k + ' ' + n + '"></i>').join("") + "</div>"; },
    slider() { const [a, b] = T.pos(); return '<div class="tl-track"><span class="tl-fill" style="left:' + a + '%;width:' + (b - a) + '%"></span><b class="tl-h" style="left:' + a + '%"></b><b class="tl-h" style="left:' + b + '%"></b></div>'; },
    axis() { const ms = T.months(); const ys = [...new Set(ms.map(([k]) => k.slice(0, 4)))];
      return '<div class="tl-axis">' + ys.map((y) => '<span style="flex:' + ms.filter(([k]) => k.startsWith(y)).length + '">' + y + "</span>").join("") + "</div>"; },
    label: () => T.from.replace(/-/g, "/") + " 〜 " + T.to.replace(/-/g, "/"),
    days: () => Math.round((new Date(T.to) - new Date(T.from)) / 864e5) + 1,
    head: (extra) => '<div class="sx-ch"><span class="sx-grip">⋮⋮</span><b>発生日<small class="tl-tag">期間</small></b><button class="sx-clr" type="button">期間 ×</button><button class="sx-more-btn" type="button">⋯</button><button class="sx-rm" type="button">外す</button></div>' + (extra || ""),
    card(inner, cls) { return '<section class="sx-card tl-card ' + (cls || "") + '" data-px-tl>' + T.head() + inner + "</section>"; },
    tiles() { const ms = T.months().slice(-14); return '<div class="tl-tiles">' + ms.map(([k]) => '<span class="' + (T.inSel(k) ? "on" : "") + '"><small>' + (k.endsWith("-01") || k === ms[0][0] ? k.slice(0, 4) : "&nbsp;") + "</small>" + (+k.slice(5)) + "月</span>").join("") + "</div>"; },
    menuOrder: () => '<div class="px-menu"><small>選び方</small><span>◉ 1 つだけ選ぶ</span><span>☑ いくつでも選ぶ</span><hr><small>値の並び</small><span class="hov">● 値の順（既定）</span><span>件数の多い順</span><span>件数の少ない順</span><span>値の逆順</span><span>手で並べる（⋮⋮ を引く）</span><hr><span>☐ 0 件の値を隠す</span></div>',
  };
  T.load();
  T.mount = (key, build) => setInterval(() => { if (T.data && document.querySelector(".sx-card") && !document.querySelector("[data-px='" + key + "']")) try { build(); } catch (e) { console.warn(e); } }, 150);
})();`];

export const CSS = `
  #llSlicer{flex-basis:220px !important}
  .sx-v span{white-space:normal !important;overflow:visible !important;text-overflow:clip !important;word-break:break-all;line-height:1.3;padding:3px 0}
  .sx-v{align-items:center}
  .sx-ch > b{white-space:normal !important;word-break:break-all}
  .tl-tag{margin-left:5px;padding:0 4px;border-radius:4px;background:#e4f1ee;color:#1f6f63;font-size:10px;font-weight:800;vertical-align:1px}
  .tl-card .tl-range{font-size:12.5px;font-weight:700;color:var(--h-input);font-variant-numeric:tabular-nums;line-height:1.35}
  .tl-card .tl-range small{display:block;font-weight:400;color:var(--muted);font-size:11px}
  .tl-bars{display:flex;align-items:flex-end;gap:1px;margin:6px 0 0}
  .tl-bars i{flex:1;background:#cfd8e1;border-radius:1px 1px 0 0}
  .tl-bars i.on{background:#3f6591}
  .tl-track{position:relative;height:18px;margin:2px 6px 0}
  .tl-track::before{content:"";position:absolute;left:0;right:0;top:8px;height:3px;border-radius:2px;background:#d6dee6}
  .tl-fill{position:absolute;top:8px;height:3px;background:#3f6591;border-radius:2px}
  .tl-h{position:absolute;top:2px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#fff;border:2px solid #3f6591;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.25)}
  .tl-axis{display:flex;font-size:10.5px;color:var(--muted);margin:0 6px}
  .tl-axis span{border-left:1px solid #c8d2dc;padding-left:3px;overflow:hidden;white-space:nowrap}
  .tl-inputs{display:flex;align-items:center;gap:4px;margin-top:6px;font-size:11.5px;color:var(--muted)}
  .tl-inputs input{width:0;flex:1;height:24px;border:1px solid var(--edit-line);border-radius:5px;background:var(--edit-field);font:inherit;font-size:11.5px;padding:0 4px;color:var(--ink)}
  .tl-chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
  .tl-chips span{border:1px solid var(--line);border-radius:999px;padding:1px 7px;font-size:11px;color:var(--h-input);background:var(--surface)}
  .tl-chips span.on{background:var(--h-input);border-color:var(--h-input);color:#fff;font-weight:700}
  .tl-grain{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:11px;margin:4px 0}
  .tl-grain span{padding:1px 6px;color:var(--muted)}
  .tl-grain span.on{background:var(--h-input);color:#fff;font-weight:700}
  .tl-tiles{display:flex;overflow:hidden;gap:1px;margin-top:4px;position:relative}
  .tl-tiles span{flex:0 0 30px;text-align:center;font-size:11px;background:#e8edf2;color:var(--muted);padding:1px 0 4px;display:flex;flex-direction:column}
  .tl-tiles span small{font-size:9.5px;color:var(--muted);height:12px}
  .tl-tiles span.on{background:#3f6591;color:#fff;font-weight:700}
  .tl-tiles span.on small{color:#dfe8f2}
  .px-menu{position:absolute;z-index:40;left:120px;top:30px;background:var(--surface);border:1px solid var(--pop-line);border-radius:9px;box-shadow:0 14px 34px var(--pop-shadow);padding:5px;display:grid;min-width:180px;font-size:12px}
  .px-menu span{padding:5px 9px;border-radius:6px}
  .px-menu span.hov{background:var(--surface-4);font-weight:700;color:var(--h-input)}
  .px-menu small{color:var(--muted);padding:4px 9px 1px;font-size:10.5px;font-weight:700}
  .px-menu hr{border:0;border-top:1px solid var(--line);margin:3px 0}
  .px-rel{position:relative}
  .px-ord{display:inline-flex;align-items:center;gap:3px;height:22px;border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:11px;color:var(--h-input);background:var(--surface);white-space:nowrap}
  .px-vh{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);padding:0 8px 2px}
  .px-vh b{color:var(--h-input)}
  .px-vg{color:#9aa7b3;font-weight:800;letter-spacing:-2px;margin-right:2px}
  .px-seg2{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:11px;margin-bottom:4px}
  .px-seg2 span{padding:1px 7px;color:var(--muted);background:var(--surface)}
  .px-seg2 span.on{background:var(--h-input);color:#fff;font-weight:700}
  .tl-band{margin:0 16px 8px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);display:grid;grid-template-columns:200px 1fr;gap:4px 16px;align-items:center}
  .tl-band .tl-bars{grid-column:2}
  .tl-band .tl-track,.tl-band .tl-axis{grid-column:2}
  .tl-mrow{display:flex;justify-content:space-between;align-items:center;min-height:22px;padding:0 8px;border:1px solid var(--line);border-radius:5px;font-size:12px;background:var(--surface);margin-bottom:2px;position:relative;overflow:hidden}
  .tl-mrow.on{background:var(--input-soft);border-color:var(--h-input);color:var(--h-input);font-weight:700}
  .tl-mrow.end{box-shadow:inset 3px 0 0 #3f6591}
`;
const go = (key, build) => ["script", `window.__tl.mount(${JSON.stringify(key)}, () => { const T = window.__tl; ${build}
  document.querySelector("#llSlicer .sx-card").setAttribute("data-px", ${JSON.stringify(key)}); });`];
/** タイムラインのカードを先頭のカードの前に入れる */
const PUT = (html) => `T.$("#llSlicer .sx-card").insertAdjacentHTML("beforebegin", ${html});`;
/** 設備のカードの ⋯ のメニューを開いた形（値の並び） */
const MENU = `const c = [...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl])")][0]; c.classList.add("px-rel"); c.insertAdjacentHTML("beforeend", T.menuOrder());`;

export const PROPOSALS = [
  { key: "A", name: "借りる: Excel と同じ（年・四半期・月・日の目盛り＋月のタイルの両端を引く）・値の並びは ⋯", css: CSS,
    ops: [KIT, go("A", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>' + T.total() + ' 件</small></div><span class="tl-grain"><span>年</span><span>四半期</span><span class="on">月</span><span>日</span></span>' + T.tiles())`) + MENU)] },
  { key: "B", name: "見せ方: 件数の山＋2 点のスライダー＋期間の字・日付の欄・値の並びはカードの「並び ▾」", css: CSS,
    ops: [KIT, go("B", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>' + T.days() + ' 日・' + T.total() + ' 件</small></div>' + T.bars(34) + T.slider() + T.axis() + '<div class="tl-inputs"><input value="' + T.from + '">〜<input value="' + T.to + '"></div>')`)
      + `[...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-more-btn")].forEach((b) => b.insertAdjacentHTML("beforebegin", '<span class="px-ord" title="値の並び">並び: 件数 ▾</span>'));`)] },
  { key: "C", name: "減らし方: スライダーと期間の字だけ・値の並びは値の上の見出し（値｜件数 ▼）を押す", css: CSS,
    ops: [KIT, go("C", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>' + T.total() + ' 件</small></div>' + T.slider() + T.axis())`)
      + `[...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-vals")].forEach((v) => v.insertAdjacentHTML("beforebegin", '<div class="px-vh"><span>値</span><b>件数 ▼</b></div>'));`)] },
  { key: "D", name: "流れ: よく使う期間の札 → 日付の欄 → スライダーで微調整・値の並びは ⋯", css: CSS,
    ops: [KIT, go("D", PUT(`T.card('<div class="tl-chips"><span>直近 7 日</span><span>30 日</span><span>今月</span><span>先月</span><span>今年</span><span>全期間</span></div><div class="tl-inputs"><input value="' + T.from + '">〜<input value="' + T.to + '"></div>' + T.slider() + T.axis() + '<div class="tl-range"><small>' + T.days() + ' 日・' + T.total() + ' 件</small></div>')`) + MENU)] },
  { key: "E", name: "置き場: タイムラインは表の上の全幅の帯（スライサーの面とは別）・値の並びは ⋯", css: CSS,
    ops: [KIT, go("E", `T.$("#llBodyRow").insertAdjacentHTML("beforebegin", '<section class="tl-band" data-px-tl>' + T.head().replace('class="sx-ch"', 'class="sx-ch" style="grid-row:1 / span 3;flex-wrap:wrap"') + T.bars(30) + T.slider() + T.axis() + '</section>');
      T.$(".tl-band .sx-ch").insertAdjacentHTML("beforeend", '<div class="tl-range" style="flex-basis:100%">' + T.label() + '<small>' + T.days() + ' 日・' + T.total() + ' 件</small></div>');` + MENU)] },
  { key: "F", name: "値の側で解く: 値の行を ⋮⋮ で引いて手で並べる・タイムラインは小さな山＋スライダー", css: CSS,
    ops: [KIT, go("F", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>' + T.total() + ' 件</small></div>' + T.bars(20) + T.slider() + T.axis())`)
      + `[...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-v:not(.sx-all) > span")].forEach((s) => s.insertAdjacentHTML("afterbegin", '<i class="px-vg">⋮⋮</i>'));
      [...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-more-btn")].forEach((b) => b.insertAdjacentHTML("beforebegin", '<span class="px-ord">手で並べた</span>'));`)] },
  { key: "G", name: "期間を値の帯で選ぶ: 月ごとの件数の行の始めと終わりを押す・値の並びは探す欄の横の札（値順｜件数順）", css: CSS,
    ops: [KIT, go("G", PUT(`T.card('<div class="tl-range">' + T.label() + '<small>始めの月と終わりの月を押す</small></div><div style="max-height:220px;overflow:auto;margin-top:4px">' + T.months().slice(-12).reverse().map(([k, n]) => '<div class="tl-mrow' + (T.inSel(k) ? " on" : "") + ((k === T.from.slice(0, 7) || k === T.to.slice(0, 7)) ? " end" : "") + '"><span>' + k.replace("-", "/") + '</span><i style="font-style:normal">' + n + '</i></div>').join("") + '</div>')`)
      + `[...document.querySelectorAll("#llSlicer .sx-card:not([data-px-tl]) .sx-vals")].forEach((v) => v.insertAdjacentHTML("beforebegin", '<span class="px-seg2"><span>値順</span><span class="on">件数順</span><span>手で</span></span>'));`)] },
];
