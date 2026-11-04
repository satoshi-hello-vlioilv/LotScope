// 2026-11 ダッシュボードの色の組（Office 並みに多く・自分で作る）とグラフのスタイル・見せ方（利用者の要望 2026-11-04 の 2・5）。1 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-11-dashstyle.mjs --from dash --states dash-panel-fmt
//   （--view 1536x864・1280x720 でも）
// 今を撮って見えた問題（scratchpad の sty/now/dash-panel-fmt-light-now.png・sty/base/*.png）:
//   ① 色の組は 7 つ（データの種類・落ち着いた・はっきり・色覚に配慮・藍／暖色／寒色の濃淡）だけ。自分で作れない
//   ② 見せ方（枠）5 つは、どれも白い面に近く、選んでも変わり映えしない。グラフそのもの（棒・線）の見た目は選べない
//   ③ 色の組は「書式」を開いて、組む所のいちばん下（系列の上）まで送らないと見えない（組む所の高さの 2 画面目）
//   ④ 見せ方（枠）と色の組が離れている（見せ方は ④ の頭・色の組は書式の底）。「見た目」を変える物が 1 か所に無い
// 中身（どの案も同じ。土台に作ってある）: 色の組 カラフル 11（前の 3＋ビジネス・パステル・和の色・海・夕焼け・大地・鮮やか）・単色の濃淡 10・自分の色（色を直す・足す・外す）、
//   スタイル 7（標準・角丸・グラデーション・枠だけ・淡い塗り・影・太い線。見本の絵はそのスタイルで描く）、見せ方 9（＋上の線・浮き・色の地・夜）
// 案（方向を散らす: 置き場〈書式の中・新しい段・タブ・パネルの上〉／見せ方〈格子・組み合わせの見本・選びの面〉／手の数）:
//   A 書式の中の格子（土台そのまま。書式を開くと スタイル → 色の組〈カラフル・単色・自分〉の順）
//   B 「デザイン」の段: ④ を「④ デザイン（見せ方・スタイル・色の組）」と「⑤ 書式（数値・軸…）」に分け、デザインは畳まずにいつも出す
//   C 組み合わせの見本（テーマ）: ④ の頭に 8 枚の見本（枠×スタイル×色の組を 1 枚の小さなグラフで）。押すと 3 つを一度に当てる。細かくは下の「選び直す」
//   D 組む所の上のタブ「データと数え方｜デザイン｜書式」。デザインのタブに大きな見本（スタイルと色の組を 2 列の格子）
//   E 選びの面（Excel の「色の変更」）: ④ に 1 段「見せ方 ▾・スタイル ▾・色の組 ▾」。色の組 ▾ を開くと、名前と 8 色の帯の縦の並び（カラフル／単色／自分で作る…）
//   F パネルの上の道具: 組んでいるパネルの右上に「デザイン」の面を浮かせ（パネルの横）、スタイルと色の組をパネルを見ながら選ぶ。組む所は今のまま

let seq = 0;
const watch = (sel, fn) => { const k = `ds${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} || !window.DashStyle) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
// sel の中に印 mark が無ければ fn で入れ直す（組む所は描き直すたびに中身を作り直すので、そのたびに入れ直す）
const keep = (sel, mark, fn) => ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (window.DashStyle && !el.querySelector(${JSON.stringify(mark)})) { try { (${fn})(el); } catch (e) { if (!document.querySelector(".pv-err")) document.body.insertAdjacentHTML("beforeend", '<div class="pv-err" style="position:fixed;top:0;left:0;z-index:9999;background:red;color:#fff;font-size:20px">' + e.message + '</div>'); } } }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];
// 案の部品（頁の中で動く）。DashStyle と組む所の札（.de-sty・.de-pal・.de-frame）で描く
const kit = ["script", `Object.defineProperty(window, "__ds", { configurable: true, get() { return window.__dsv || (window.__dsv = (() => {
  const S = window.DashStyle, c0 = "#2f7d78";
  const mini = (cs, st, bg) => { const svg = '<svg viewBox="0 0 96 48" width="96" height="48" aria-hidden="true"><rect x="8" y="22" width="14" height="22" fill="' + cs[0] + '"/><rect x="28" y="10" width="14" height="34" fill="' + cs[1 % cs.length] + '"/><rect x="48" y="16" width="14" height="28" fill="' + cs[2 % cs.length] + '"/><rect x="68" y="28" width="14" height="16" fill="' + cs[3 % cs.length] + '"/><path d="M15 18 L35 6 L55 12 L75 22" fill="none" stroke="' + cs[4 % cs.length] + '" stroke-width="1.8"/></svg>';
    return '<span class="pv-mini" style="background:' + (bg || '#fff') + '">' + S.apply(svg, st, cs) + '</span>'; };
  const ico = (k) => S.apply('<svg viewBox="0 0 34 20" width="34" height="20" aria-hidden="true"><rect x="2" y="9" width="7" height="11" fill="' + c0 + '"/><rect x="13" y="4" width="7" height="16" fill="' + c0 + '"/><rect x="24" y="12" width="7" height="8" fill="' + c0 + '"/><path d="M5 7 L16 2 L28 9" fill="none" stroke="' + c0 + '" stroke-width="1.6"/></svg>', k, [c0]);
  const sty = (cur = "") => '<div class="de-stys">' + S.STYLES.map(([k, n]) => '<button type="button" class="de-sty' + (k === cur ? ' on' : '') + '">' + ico(k) + '<span>' + n + '</span></button>').join('') + '</div>';
  const pbtn = (k, n, cs, on) => '<button type="button" class="de-pal' + (on ? ' on' : '') + '"><span>' + cs.slice(0, 6).map((c) => '<i style="background:' + c + '"></i>').join('') + '</span>' + n + '</button>';
  const pals = (cur = "") => '<div class="de-palbox">' + S.GROUPS.map(([g, gn, keys]) => '<div class="de-palg"><small>' + gn + '</small><div class="de-pals">' + (g === 'color' ? pbtn('', 'データの種類', [c0, '#b5822a', '#4a62b0', '#c9564a', '#7658ae', '#5c8a2a'], cur === '') : '') + keys.map((k) => pbtn(k, S.PALETTES[k].n, S.PALETTES[k].c, cur === k)).join('') + '</div></div>').join('') + '<div class="de-palg"><small>自分で作る</small><div class="de-pals">' + pbtn('custom', '自分の色', ['#c9d4de'], false) + '</div></div></div>';
  const frames = () => '<span class="de-frames">' + S.FRAMES.map(([k, n], i) => '<label class="de-frame' + (i === 0 ? ' on' : '') + '"><i class="fr-' + k + '"></i>' + n + '</label>').join('') + '</span>';
  const THEMES = [["標準", "", "", "#fff", "card"], ["ビジネス", "biz", "round", "#fff", "top"], ["和の色", "wa", "soft", "#fbf8f1", "tint"], ["夜", "neon", "grad", "#1d2733", "night"],
    ["パステル", "pastel", "round", "#fff", "float"], ["海", "ocean", "grad", "#eef6fa", "wash"], ["大地", "earth", "outline", "#fff", "accent"], ["色覚に配慮", "cud", "shadow", "#fff", "card"]];
  const themes = () => '<div class="pv-themes">' + THEMES.map(([n, pal, st, bg], i) => '<button type="button" class="pv-theme' + (i === 3 ? ' on' : '') + '">' + mini(pal ? S.PALETTES[pal].c : [c0, "#b5822a", "#4a62b0", "#c9564a", "#7658ae"], st, bg) + '<b>' + n + '</b></button>').join('') + '</div>';
  const palRows = () => S.GROUPS.map(([g, gn, keys]) => '<div class="pv-dgh">' + gn + '</div>' + keys.map((k, i) => '<button type="button" class="pv-drow' + (k === 'wa' ? ' on' : '') + '"><span class="pv-strip">' + S.PALETTES[k].c.concat(S.PALETTES[k].c).slice(0, 8).map((c) => '<i style="background:' + c + '"></i>').join('') + '</span>' + S.PALETTES[k].n + '</button>').join('')).join('') + '<div class="pv-dgh">自分で作る</div><button type="button" class="pv-drow"><span class="pv-strip"><i style="background:#c2185b"></i><i style="background:#2f7d78"></i><i style="background:#e5a000"></i></span>自分の色… <small>色を直す・足す</small></button>';
  return { S, mini, sty, pals, frames, themes, palRows };
})()); } });`];
const base = `
.pv-mini{display:inline-flex;border-radius:6px;border:1px solid var(--edit-line);padding:2px}
.pv-themes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:4px 0 8px}
.pv-theme{display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px;border:1px solid var(--edit-line);border-radius:9px;background:var(--edit-field);font:inherit;font-size:12px;cursor:pointer}
.pv-theme.on{border-color:var(--h-input);box-shadow:0 0 0 2px color-mix(in srgb,var(--h-input) 30%,transparent)}
.pv-theme b{font-size:12px;color:var(--h-meta)}
.pv-sec{border:1px solid var(--line-soft,#e3e8ee);border-radius:10px;padding:8px 10px;margin:6px 0;background:#fbfcfd}
.pv-sec h4{margin:0 0 6px;font-size:13px;display:flex;gap:8px;align-items:baseline}
.pv-sec h4 small{font-weight:600;color:var(--muted)}
.pv-strip{display:inline-flex;border-radius:3px;overflow:hidden;margin-right:8px}
.pv-strip i{width:12px;height:16px}
.pv-drow{display:flex;align-items:center;width:100%;height:30px;padding:0 8px;border:0;background:none;font:inherit;font-size:12.5px;font-weight:700;color:var(--ink);cursor:pointer;border-radius:6px}
.pv-drow:hover,.pv-drow.on{background:var(--input-soft)}
.pv-drow small{margin-left:6px;color:var(--muted);font-weight:600}
.pv-dgh{font-size:11.5px;font-weight:800;color:var(--muted);padding:6px 8px 2px}
.pv-dd{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--edit-line);border-radius:8px;background:var(--edit-field);font:inherit;font-size:12.5px;font-weight:700;color:var(--h-meta)}
.pv-dd.open{border-color:var(--h-input);color:var(--h-input)}
.pv-ddpop{position:absolute;z-index:50;width:300px;max-height:460px;overflow:auto;background:#fff;border:1px solid var(--edit-line);border-radius:10px;box-shadow:0 12px 30px rgba(28,42,54,.22);padding:6px}`;
// 書式を開き、組む所の中だけを sel の所へ送る
// 状態（dash-panel-fmt）は書式を開いたあと tpa-show-fmt を知らせてから #deFmt へ送るので、その後で案の置き場へ送り直す
const scrollTo = (sel, off = 60) => ["script", `document.addEventListener("tpa-show-fmt", () => setTimeout(() => { const m = document.querySelector("#dbEditor .de-main"), f = document.querySelector(${JSON.stringify(sel)}); if (m && f) m.scrollTop = Math.max(0, f.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - ${off}); }, 150))`];
const openFmt = ["script", `{ const b = document.querySelector("[data-de-fmtopen]"); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); }`];
// 土台の書式から スタイル・色の組 の段を外す（ほかの置き場へ移す案）
const hideFmtDesign = `#deFmt .de-row:has(.de-stys),#deFmt .de-row:has(.de-palbox){display:none}`;

export const PROPOSALS = [
  { key: "A", name: "書式の中の格子（土台）", css: base, ops: [kit, openFmt, scrollTo("#deFmt .de-stys", 90)] },
  { key: "B", name: "デザインの段（見せ方・スタイル・色の組をいつも出す）", css: base + hideFmtDesign + `#deLook .de-row:first-child{display:none}`,
    ops: [kit, keep("#dbEditor .de-main", ".pv-design", `(f) => { const h = '<div class="de-step pv-step"><i>4</i>デザイン<small>見せ方・スタイル・色の組</small></div><div class="pv-design"><div class="de-row de-top"><span class="de-l">見せ方</span>' + __ds.frames() + '</div><div class="de-row de-top"><span class="de-l">スタイル</span>' + __ds.sty() + '</div><div class="de-row de-top"><span class="de-l">色の組</span>' + __ds.pals() + '</div></div><div class="de-step pv-step"><i>5</i>書式<small>数値・軸・単位・系列</small></div>';
      const st = [...document.querySelectorAll("#dbEditor .de-step")].find((x) => /見せ方・書式/.test(x.textContent)); if (st) st.hidden = true; const lk = document.querySelector("#deLook"); if (lk) lk.insertAdjacentHTML("beforebegin", h); }`), scrollTo(".pv-step", 20)] },
  { key: "C", name: "組み合わせの見本（テーマ 8 枚＋選び直す）", css: base + hideFmtDesign,
    ops: [kit, keep("#deLook", ".pv-themes", `(l) => { l.insertAdjacentHTML("afterbegin", '<div class="de-row de-top"><span class="de-l">テーマ</span><div style="flex:1;min-width:0">' + __ds.themes() + '<small class="de-hint">押すと見せ方・スタイル・色の組を一度に当てます。下で 1 つずつ選び直せます</small></div></div><div class="de-row de-top"><span class="de-l">スタイル</span>' + __ds.sty() + '</div><div class="de-row de-top"><span class="de-l">色の組</span>' + __ds.pals() + '</div>'); }`), scrollTo(".pv-themes", 40)] },
  { key: "D", name: "組む所の上のタブ（データと数え方｜デザイン｜書式）", css: base + `#dbEditor .de-main>*:not(.pv-tabs):not(.pv-tabbody){display:none!important}
.pv-tabs{display:flex;gap:2px;border-bottom:2px solid var(--line-soft,#e3e8ee);margin:0 0 10px;position:sticky;top:0;background:var(--surface);z-index:2}
.pv-tabs button{height:36px;padding:0 16px;border:0;background:none;font:inherit;font-size:13.5px;font-weight:800;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-2px}
.pv-tabs button.on{color:var(--h-input);border-bottom-color:var(--h-input)}
.pv-tabbody .de-sty{min-width:96px}.pv-tabbody .de-pal{height:34px}`,
    ops: [kit, keep("#dbEditor .de-main", ".pv-tabs", `(m) => { (() => m.insertAdjacentHTML("afterbegin", '<div class="pv-tabs" role="tablist"><button>データと数え方</button><button class="on">デザイン</button><button>書式</button></div><div class="pv-tabbody"><div class="pv-sec"><h4>見せ方<small>パネルの枠と地</small></h4>' + __ds.frames() + '</div><div class="pv-sec"><h4>スタイル<small>棒・線・点の描き方</small></h4>' + __ds.sty() + '</div><div class="pv-sec"><h4>色の組<small>系列・項目の色</small></h4>' + __ds.pals() + '</div></div>'))(); }`)] },
  { key: "E", name: "選びの面（見せ方 ▾・スタイル ▾・色の組 ▾）", css: base + hideFmtDesign + `#deLook .de-row:has(.de-frames){display:none}`,
    ops: [kit, keep("#deLook", ".pv-dd", `(l) => { const S = __ds.S; l.insertAdjacentHTML("afterbegin", '<div class="de-row" style="position:relative;flex-wrap:wrap;gap:6px"><span class="de-l">デザイン</span><button type="button" class="pv-dd">見せ方 <span class="pv-strip"><i style="background:#1d2733"></i></span>夜 ▾</button><button type="button" class="pv-dd">スタイル ' + __ds.mini(["#165e83","#eb6101","#88a93a","#e5a000","#745399"], "grad").replace('width="96" height="48"','width="40" height="20"') + 'グラデーション ▾</button><button type="button" class="pv-dd open" id="pvPalDd">色の組 <span class="pv-strip">' + S.PALETTES.wa.c.slice(0,6).map((c)=>'<i style="background:'+c+'"></i>').join('') + '</span>和の色 ▾</button><div class="pv-ddpop" style="top:82px;left:70px">' + __ds.palRows() + '</div></div>'); }`), scrollTo("#deLook", 40)] },
  { key: "F", name: "パネルの上のデザインの面（パネルを見ながら選ぶ）", css: base + hideFmtDesign + `.pv-float{position:fixed;z-index:60;width:330px;background:#fff;border:1px solid var(--edit-line);border-radius:12px;box-shadow:0 14px 34px rgba(28,42,54,.24);padding:10px 12px}
.pv-float h4{margin:0 0 8px;font-size:13.5px;display:flex;justify-content:space-between}
.pv-float .de-sty{min-width:64px;font-size:11.5px}.pv-float .de-palg small{font-size:11px}
.pv-fbtn{position:absolute;right:120px;top:9px;height:24px;padding:0 9px;border-radius:6px;border:1px solid var(--h-input);background:var(--input-soft);color:var(--h-input);font:inherit;font-size:12px;font-weight:800}`,
    ops: [kit, watch("#dashGrid .db-p.is-focus", `(p) => { setTimeout(() => { if (!p.classList.contains("is-focus")) return; document.querySelectorAll(".pv-float,.pv-fbtn").forEach((e) => e.remove()); const r = p.getBoundingClientRect(); p.insertAdjacentHTML("beforeend", '<button type="button" class="pv-fbtn">🖌 デザイン</button>');
      document.body.insertAdjacentHTML("beforeend", '<div class="pv-float" style="left:' + Math.round(r.left + 16) + 'px;top:' + Math.round(r.top + 44) + 'px"><h4>デザイン<small>このパネル</small></h4><div class="de-row de-top"><span class="de-l" style="width:52px">見せ方</span>' + __ds.frames() + '</div><div style="margin:6px 0">' + __ds.sty() + '</div>' + __ds.pals() + '</div>'); }, 400); }`), scrollTo("#deLook", 40)] },
];
