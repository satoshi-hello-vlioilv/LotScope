/* =========================================================================
   パネルの色の組とグラフのスタイル（版 3.69.0。利用者の要望 2026-11-04 の 2・5）
   - 色の組: カラフル（8 組）・単色の濃淡（色相ごとに明るさの段を作る）・自分で作る（custom。fmt.pcolors に色の並び）。
     鍵はサーバーの dashboard.PALETTES と同じ（services/dashboard.py が保存のときに確かめる）
   - スタイル（fmt.style）: 描いたグラフ（SVG の字）に後から当てる。系列の色で塗った印（棒・面・点・線）だけを、色で見分けて変える
     （角丸・グラデーション・枠だけ・淡い塗り・影・太い線）。グラフの形ごとの描き方（lotlist-pivot-charts.js）は変えない
   ========================================================================= */
(function () {
  "use strict";

  /* ---- 色 ---- */
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim()); return m ? `#${m[1].toLowerCase()}` : ""; };
  const rgb = (c) => { const h = hex(c).slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
  /** c を白へ t（0〜1）だけ寄せる */
  const lighten = (c, t) => { const [r, g, b] = rgb(c); return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t); };
  /** HSL → #rrggbb（h 0〜360・s・l 0〜1） */
  function hsl(h, s, l) {
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  /** 1 つの色相の濃淡（濃い → 淡い 6 段。順位・大きさを見せる） */
  const ramp = (h, s) => [0.24, 0.34, 0.45, 0.58, 0.72, 0.85].map((l) => hsl(h, s, l));
  /** 字の背景との明るさの差を見る（WCAG の相対輝度） */
  const lum = (c) => { const v = rgb(c).map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };

  // カラフル（名前ごとに色を分ける）。前からの 3 組（落ち着いた・はっきり・色覚に配慮）は鍵も色もそのまま
  const COLORFUL = [
    ["calm", "落ち着いた", ["#3a6db0", "#c27a1e", "#159483", "#7458c4", "#5d8f1f", "#b2507f"]],
    ["vivid", "はっきり", ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]],
    ["cud", "色覚に配慮", ["#0072b2", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#56b4e9"]],
    ["biz", "ビジネス", ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e"]],
    ["pastel", "パステル", ["#7fa7d6", "#f2a678", "#93c47d", "#f6c85f", "#b79bd8", "#76c2c0", "#e99ab3", "#b4b48a"]],
    ["wa", "和の色", ["#165e83", "#eb6101", "#88a93a", "#e5a000", "#745399", "#00a3af", "#928c36", "#b94047"]],
    ["ocean", "海", ["#03396c", "#0f6fa8", "#3f9bc9", "#00a6a6", "#2ec4b6", "#8fc8e0"]],
    ["sunset", "夕焼け", ["#3d1c56", "#7b2d6b", "#c0392b", "#e67e22", "#e9b10f", "#b9842c"]],
    ["earth", "大地", ["#7a5230", "#b0844f", "#5e7c4b", "#8f8f5a", "#c98f2e", "#6b4f3f"]],
    ["neon", "鮮やか", ["#e5006a", "#f15a07", "#e8a800", "#2f74f0", "#7a2fe0", "#04b58c"]],
  ];
  // 単色の濃淡（色相・鮮やかさ）。前からの 3 組（藍・暖色・寒色）は鍵も色もそのまま
  const MONO = [
    ["mono", "藍", ["#1f3a5f", "#2f5583", "#4a73a6", "#7395c2", "#a3bbd9", "#cbd8ea"]],
    ["blue", "青", ramp(212, 0.62)],
    ["cool", "青緑", ["#0f4a46", "#16706a", "#23968c", "#55b8ad", "#92d3ca", "#c7e9e3"]],
    ["green", "緑", ramp(132, 0.42)],
    ["olive", "黄緑", ramp(78, 0.45)],
    ["gold", "黄", ramp(44, 0.7)],
    ["warm", "橙", ["#7a2e0e", "#a8461a", "#cf6a2c", "#e3934d", "#efbb80", "#f6dcb5"]],
    ["red", "赤", ramp(358, 0.55)],
    ["purple", "紫", ramp(272, 0.38)],
    ["gray", "灰", ramp(210, 0.1)],
  ];
  const PALETTES = Object.fromEntries([...COLORFUL, ...MONO].map(([k, n, c]) => [k, { n, c, mono: MONO.some((x) => x[0] === k) }]));
  const GROUPS = [["color", "カラフル", COLORFUL.map((x) => x[0])], ["mono", "単色の濃淡", MONO.map((x) => x[0])]];
  const CUSTOM_MAX = 10;
  /** 書式 → 色の組の色の並び（自分で作った組は fmt.pcolors。無ければ null＝データの種類の色） */
  function paletteOf(fm) {
    const f = fm || {};
    if (f.palette === "custom") { const cs = (f.pcolors || []).map(hex).filter(Boolean); return cs.length ? { n: "自分で作った組", c: cs, custom: true } : null; }
    return PALETTES[f.palette || ""] || null;
  }

  /* ---- スタイル ---- */
  const STYLES = [["", "標準", "そのまま塗る"], ["round", "角丸", "棒の角を丸める"], ["grad", "グラデーション", "上から下へ淡く → 濃く"],
    ["outline", "枠だけ", "淡い塗りと濃い枠"], ["soft", "淡い塗り", "色を少し淡くして重なりを見せる"], ["shadow", "影", "印の下に影を落とす"], ["bold", "太い線", "線を太く・点を大きく"]];
  let uid = 0;
  /**
   * 描いた SVG（字）にスタイルを当てる。colors … 系列の色（この色で塗った印だけを変える。軸・補助線・字は変えない）
   * 前の版の書式（style 無し）は何も変えない
   */
  function apply(svg, style, colors) {
    if (!style || !svg) return svg;
    const set = new Set((colors || []).map(hex).filter(Boolean));
    if (!set.size) return svg;
    const id = `ds${++uid}`, grads = new Map();
    const gid = (c) => { if (!grads.has(c)) grads.set(c, `${id}g${grads.size}`); return grads.get(c); };
    const out = svg.replace(/<(rect|path|circle|polygon)\b([^>]*?)(\/?)>/g, (all, tag, attrs, close) => {
      const fm = /\sfill="([^"]+)"/.exec(attrs), sm = /\sstroke="([^"]+)"/.exec(attrs);
      const fill = fm && hex(fm[1]), stroke = sm && hex(sm[1]);
      const filled = fill && set.has(fill), lined = !filled && stroke && set.has(stroke) && (!fm || fm[1] === "none");
      if (!filled && !lined) return all;
      let a = attrs;
      if (lined) {
        if (style === "bold") a = a.replace(/\sstroke-width="[^"]*"/, "") + ' stroke-width="3.6"';
        else if (style === "shadow") a += ` filter="url(#${id}s)"`;
        return `<${tag}${a}${close}>`;
      }
      if (style === "round" && tag === "rect" && !/\srx=/.test(a)) a += ' rx="4"';
      else if (style === "grad") a = a.replace(fm[0], ` fill="url(#${gid(fill)})"`);
      else if (style === "outline") a = a.replace(/\sstroke(-width)?="[^"]*"/g, "") + ` fill-opacity=".22" stroke="${fill}" stroke-width="1.6"`;
      else if (style === "soft") a += ' fill-opacity=".62"';
      else if (style === "shadow") a += ` filter="url(#${id}s)"`;
      else if (style === "bold" && tag === "circle") a = a.replace(/\sr="([\d.]+)"/, (m, r) => ` r="${(+r * 1.5).toFixed(1)}"`);
      if (style === "grad" && tag === "rect" && !/\srx=/.test(a)) a += ' rx="2"';
      return `<${tag}${a}${close}>`;
    });
    const defs = style === "grad" ? [...grads].map(([c, g]) => `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(c, 0.42)}"/><stop offset="1" stop-color="${c}"/></linearGradient>`).join("")
      : style === "shadow" ? `<filter id="${id}s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.6" flood-color="#1c2a36" flood-opacity=".28"/></filter>` : "";
    return defs ? out.replace(/(<svg\b[^>]*>)/, `$1<defs>${defs}</defs>`) : out;
  }

  /* ---- パネルの枠（見せ方）: 前からの 5 つ＋版 3.69.0 の 4 つ ---- */
  const FRAMES = [["card", "標準", "白い面"], ["emph", "目立たせる", "淡い藍の地と藍の枠（最初に見る数に）"], ["accent", "色の帯", "左に系列の色の帯"],
    ["plain", "枠なし", "地に溶け込む（補う数に）"], ["tint", "淡い地", "系列の色をごく淡く敷く"],
    ["top", "上の線", "上に系列の色の太い線"], ["float", "浮き", "影で面を浮かせる"], ["wash", "色の地", "系列の色のグラデーションを敷く"], ["night", "夜", "暗い地に明るい字（目を引く数・大きな画面に）"]];

  /* ---- テーマ（見せ方・スタイル・色の組の組み合わせの見本。組む所のデザインのタブの頭）: [名前, 色の組, スタイル, 見せ方] ---- */
  // 名前は色の組・見せ方の名前と重ねない（「ビジネス」「夜」がテーマと色の組・見せ方の両方にあり、どちらを押すか迷わせた: 作った後の採点）
  const THEMES = [["標準", "", "", "card"], ["端正", "biz", "round", "top"], ["和", "wa", "soft", "tint"], ["ナイト", "neon", "grad", "night"],
    ["やさしい", "pastel", "round", "float"], ["マリン", "ocean", "grad", "wash"], ["アース", "earth", "outline", "accent"], ["見分けやすい", "cud", "shadow", "card"]];
  /** テーマの見本の小さなグラフ（4 本の棒と線。見せ方の地と縁も描く） */
  function mini(cs, style, frame) {
    const c = (i) => cs[i % cs.length];
    const svg = `<svg viewBox="0 0 80 40" width="56" height="28" aria-hidden="true"><rect x="7" y="18" width="12" height="18" fill="${c(0)}"/><rect x="24" y="8" width="12" height="28" fill="${c(1)}"/>`
      + `<rect x="41" y="13" width="12" height="23" fill="${c(2)}"/><rect x="58" y="23" width="12" height="13" fill="${c(3)}"/><path d="M13 14 L30 4 L47 9 L64 19" fill="none" stroke="${c(4)}" stroke-width="1.6"/></svg>`;
    return `<span class="dt-mini fr-${frame || "card"}" style="--pc:${c(0)}">${apply(svg, style, cs)}</span>`;
  }

  window.DashStyle = { THEMES, mini,  PALETTES, GROUPS, CUSTOM_MAX, STYLES, FRAMES, paletteOf, apply, hex, lighten, lum, ramp };
})();
