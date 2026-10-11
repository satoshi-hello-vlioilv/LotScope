// 2026-10「起動画面」3 回目の見直し（版 3.18.0。利用者から「いまいち」）。新しいアイコン（青緑の地に 3 つの山）で 7 案。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-splash-3.mjs --states splash,splash-fail
//
// 今の形（W1: 中央の名乗り＋段ごとに区切った帯）を画像で見て、いまいちな所:
//   ・1728×1152 の藍一色の中に、小さな名乗りがぽつんと浮く（画面の 9 割が何も無い暗い面。寂しく、アプリらしさが無い）
//   ・アイコンの藍の地が、起動画面の藍の地に溶けて見えない（新しいアイコンは青緑の地で、ここは解ける）
//   ・進み具合の帯が細く（5px）暗く、名乗りから離れて置かれ、目が拾わない
// 方向（何で解くか）: P1 変えない（新しいアイコンだけ）／P2 見せ方＝背景にアイコンと同じ周期の山の模様／P3 置き場＝左寄せの大きな名乗り（編集の頁のよう）／
// P4 強め方＝アイコンに光の輪・帯を太く広く／P5 置き場＝白いカードに名乗りと帯をまとめる
// 5 案を並べると、どれも「名乗り＋帯」を並べ替えるだけで、進み具合そのものの見せ方を変える案と、量を減らす案が無い → 2 案を足す:
// P6 進み具合＝周期の山の線が、段が進むごとに左から描かれていく（模様と進み具合を 1 つに）／P7 減らし方＝アイコンだけを大きく、字は最小

/** 周期の山の線（SVG のパス）。n 個の山を幅 w・高さ h に */
function wave(n, w, h, base, top) {
  const step = w / n;
  let d = `M0 ${base}`;
  for (let i = 0; i < n; i++) {
    const x = i * step + step / 2;
    d += ` L${x - step * 0.22} ${base} L${x} ${top} L${x + step * 0.22} ${base}`;
  }
  return d + ` L${w} ${base}`;
}
const BG_WAVE = `<svg class="px-wave" viewBox="0 0 1600 400" preserveAspectRatio="none" aria-hidden="true">
  <path d="${wave(9, 1600, 330, 330, 120)}"/><path class="b" d="${wave(9, 1600, 380, 380, 210)}"/></svg>`;
const WAVE_CSS = `.px-wave{position:fixed;left:-2%;right:-2%;bottom:0;width:104%;height:42vh;z-index:0;pointer-events:none}
  .px-wave path{fill:none;stroke:rgba(127,211,201,.16);stroke-width:3;vector-effect:non-scaling-stroke}
  .px-wave path.b{stroke:rgba(127,211,201,.08)}
  .hero{position:relative;z-index:1}`;
const RUN_STRONG = `.run{width:520px;margin-top:44px}.seg{gap:8px}.seg i{height:8px}.step{font-size:15px}`;
/** 進み具合（済んだ段の数）を data-done に写す */
const DONE = ["script", `
  const seg = document.querySelector('#seg');
  const put = () => { const n = [...seg.children].filter((i) => i.className === 'ok' || i.className === 'warn').length; document.body.dataset.done = n; };
  new MutationObserver(put).observe(seg, { subtree: true, attributes: true, childList: true }); put();`];

export const PROPOSALS = [
  { key: "P1", name: "今の形のまま（新しいアイコンだけ）", css: "", ops: [] },
  { key: "P2", name: "背景にアイコンと同じ周期の山の模様", css: WAVE_CSS + RUN_STRONG, ops: [["insert", BG_WAVE, "afterbegin", "body"]] },
  {
    key: "P3", name: "左寄せの大きな名乗り（編集の頁のよう）＋右に模様",
    css: WAVE_CSS + `body{place-content:center start;padding-left:12vw}
      .hero{align-items:flex-start;text-align:left;width:min(760px,70vw)}
      .logo{width:96px;height:96px}
      h1{font-size:64px;margin-top:26px}.sub{font-size:22px}
      .run{width:560px;margin-top:48px}.seg i{height:7px}
      .px-wave{left:40%;width:62%;height:70vh;bottom:8vh}`,
    ops: [["insert", BG_WAVE, "afterbegin", "body"]],
  },
  {
    key: "P4", name: "アイコンに光の輪・帯を太く広く（今の形を強める）",
    css: RUN_STRONG + `.logo{width:148px;height:148px;filter:drop-shadow(0 0 42px rgba(47,138,128,.65)) drop-shadow(0 14px 30px rgba(0,0,0,.35))}
      h1{font-size:50px}`,
    ops: [],
  },
  {
    key: "P5", name: "白いカードに名乗りと帯をまとめる",
    css: `.hero{background:#fff;color:var(--ink);padding:44px 56px 34px;border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.4);width:min(640px,90vw)}
      .sub,.ver{color:var(--muted);opacity:1}.step{color:var(--ink)}.detail{color:var(--muted);opacity:1}
      .seg i{background:#e3ebf2}.seg i.now{background:#cfe7e3}.seg i.ok{background:var(--teal)}.seg i.now::after{background:var(--teal)}
      .run{width:100%;margin-top:34px}
      body.is-fail .hero{background:transparent;box-shadow:none;color:#fff}`,
    ops: [],
  },
  {
    key: "P6", name: "周期の山の線が、段が進むごとに描かれていく（模様＝進み具合）",
    css: WAVE_CSS + `.seg,.step .count{display:none}
      .px-wave{height:30vh;bottom:6vh}
      .px-wave path{stroke:rgba(127,211,201,.12);stroke-width:4}
      .px-wave path.b{display:none}
      .px-wave .on{stroke:var(--mint);stroke-width:4;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .6s ease}
      body[data-done="1"] .px-wave .on{stroke-dashoffset:.75}body[data-done="2"] .px-wave .on{stroke-dashoffset:.5}
      body[data-done="3"] .px-wave .on{stroke-dashoffset:.25}body[data-done="4"] .px-wave .on{stroke-dashoffset:0}
      .run{margin-top:40px}`,
    ops: [["insert", BG_WAVE, "afterbegin", "body"],
      ["script", `const p = document.querySelector('.px-wave path'); const on = p.cloneNode(); on.setAttribute('class', 'on'); on.setAttribute('pathLength', '1'); p.after(on);`], DONE],
  },
  {
    key: "P7", name: "アイコンだけを大きく、字は最小",
    css: `.logo{width:200px;height:200px}h1{font-size:26px;margin-top:28px;font-weight:600;opacity:.9}.sub{font-size:14px}
      .run{width:300px;margin-top:36px}.detail{display:none}`,
    ops: [],
  },
];
