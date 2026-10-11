// 2026-10「起動画面」2 回目（1 回目は 1 位 S2 79.5 が 80 点に届かず、S6 77.5 と僅差）。1 回目の上位 3 案（S2・S6・S4）と複合 4 案。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-splash-2.mjs --states splash,splash-fail
//
// 抜き出したエッセンス:
//   S2 … 名乗り（アイコン・名前・版）を中央に大きく。走っている間は「いまの 1 段と細い帯」だけ（読む量が少ない）。止まったら白い面に「次にすること」
//   S6 … 次に出るアプリの画面の骨組みを先に見せる（窓が切り替わっても目が迷わない・待ちが短く感じる）
//   S4 … 4 段のどこまで済んだかが一目で分かる（段ごとの状態）
//   S7 … 時間の手掛かり（前の起動の秒）  S1 … 版の札
// 組み直した複合案:
//   W1 = S2 ＋ 段ごとに区切った帯（4 つの区切りが段の状態の色。S4 の一目で分かる状態を、帯 1 本に畳む）
//   W2 = S6 の骨組みを藍で沈めた地 ＋ S2 の名乗り ＋ 区切った帯（アプリが現れる手前の姿）
//   W3 = S2 ＋ S4 の横の段取り（段の名前つき・パスは出さない）＋ S7 の前の起動の秒
//   W4 = S6 の明るい骨組み ＋ 浮かぶカードに名乗りと区切った帯（明るいまま、アプリと同じ地で待つ）
// どの複合案も、止まったときの箱に「理由をコピー」を付ける（問い合わせるとき理由を写せる）。

import { build, FAIL, PROPOSALS as FIRST } from "./2026-10-splash.mjs";

/** 区切った帯（[data-seg] の中の i が、段ごとの状態の色）と、止まったときの「理由をコピー」 */
const SEG = ["script", `
  const steps = [...document.querySelectorAll("ol li")];
  const segs = () => document.querySelectorAll("[data-seg]").forEach((bar) => {
    if (bar.children.length !== steps.length) bar.innerHTML = steps.map(() => "<i></i>").join("");
    steps.forEach((li, i) => { if (bar.children[i].className !== li.className) bar.children[i].className = li.className; });
  });
  new MutationObserver(segs).observe(document.querySelector("ol"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  segs();
  const fail = window.splash.fail;
  window.splash.fail = (title, detail) => {
    fail(title, detail);
    const pre = document.querySelector("#fail pre");
    const b = Object.assign(document.createElement("button"), { type: "button", className: "copy", textContent: "理由をコピー" });
    pre.before(b);
  };`];
const SEGCSS = `
 .seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
 .seg i{height:5px;border-radius:99px;background:rgba(255,255,255,.16);position:relative;overflow:hidden}
 .seg i.ok,.seg i.warn{background:#7fd3c9}
 .seg i.warn{background:var(--amber)}
 .seg i.bad{background:#ff8a7a}
 .seg i.now{background:rgba(127,211,201,.25)}
 .seg i.now::after{content:"";position:absolute;inset:0;width:40%;background:#7fd3c9;border-radius:99px;animation:run 1.2s ease-in-out infinite}
 @keyframes run{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
 @media (prefers-reduced-motion:reduce){.seg i.now::after{animation:none;width:50%}}
 .copy{float:right;margin-top:-22px;height:26px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font:600 12px inherit;cursor:pointer}
`;
const HERO = `
 body{background:radial-gradient(ellipse at 50% 35%,#2b5f79 0%,#1c3550 55%,#0f1f30 100%);color:#fff}
 .hero{display:flex;flex-direction:column;align-items:center;text-align:center;width:min(760px,90vw)}
 .hero img{width:112px;height:112px;filter:drop-shadow(0 12px 28px rgba(0,0,0,.4))}
 .hero h1{font-size:44px;margin:22px 0 0;letter-spacing:.01em;font-weight:700}
 .hero .sub{font-size:18px;opacity:.82;margin-top:2px}
 .ver{margin-top:12px;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.2em;opacity:.6}
 .run{width:440px;margin-top:56px}
 .nowl{display:flex;justify-content:space-between;margin-top:12px;font-size:14px;opacity:.92}
 .nowl [data-count]{font-variant-numeric:tabular-nums;opacity:.7}
 .nowd{margin-top:2px;font-size:12px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
 .el{position:fixed;right:24px;bottom:18px;font:12px Consolas,monospace;opacity:.45}
 .panel{display:none}
 body.is-fail .run{display:none}
 body.is-fail .panel{display:block;margin-top:34px;width:min(820px,90vw);background:#fff;color:var(--ink);border-radius:16px;padding:24px 28px;text-align:left;box-shadow:0 24px 60px rgba(0,0,0,.35)}
 body.is-fail .hero img{width:72px;height:72px}
 body.is-fail .hero h1{font-size:30px;margin-top:12px}
 #title{font-size:20px} #lead{color:var(--muted);font-size:13.5px}
 ol{display:none}
`;
const HERO_HTML = (run) => `<div class="hero"><span data-put="img"></span><span data-put="#name"></span><span data-put="#subtitle"></span><span class="ver" data-ver></span>
  <div class="run">${run}</div>
  <div class="panel"><span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span></div>
  <span data-put="#elapsed"></span></div>`;
const SEGRUN = '<div class="seg" data-seg></div><div class="nowl"><span data-now></span><span data-count></span></div><div class="nowd" data-nowd></div>';
// アプリの骨組み（見出しの帯・頁・表の行）
const SKELETON = `<div class="appbar"><i class="sk-logo"></i><i class="sk-name"></i><span class="tab on"></span><span class="tab"></span></div>
  <div class="sk">${"<i></i>".repeat(3)}${'<i style="width:96%"></i><i style="width:92%"></i><i style="width:97%"></i><i style="width:90%"></i><i style="width:95%"></i>'.repeat(4)}</div>`;
const SKCSS = `
 .appbar{position:fixed;left:0;right:0;top:0;height:52px;display:flex;align-items:center;gap:14px;padding:0 18px;background:linear-gradient(110deg,#1c3550,#2b5f79)}
 .appbar i{display:block;border-radius:6px;background:rgba(255,255,255,.18)}
 .appbar .sk-logo{width:30px;height:30px} .appbar .sk-name{width:200px;height:16px}
 .appbar .tab{width:150px;height:30px;border-radius:8px 8px 0 0;background:rgba(255,255,255,.1);margin-left:12px;align-self:flex-end}
 .appbar .tab.on{background:#eef2f5;margin-left:24px}
 .sk{position:fixed;left:12px;right:12px;top:64px;bottom:12px;background:#fff;border-radius:10px;padding:18px;overflow:hidden}
 .sk i{display:block;height:14px;border-radius:6px;margin:0 0 18px;background:linear-gradient(90deg,#eef2f5 0%,#f7f9fb 40%,#eef2f5 80%);background-size:200% 100%;animation:sh 1.4s linear infinite}
 .sk i:nth-child(1){width:220px;height:22px} .sk i:nth-child(2){height:44px;margin-bottom:26px}
 .sk i:nth-child(3){height:30px;background:#dfe6ec}
 @keyframes sh{to{background-position:-200% 0}}
 @media (prefers-reduced-motion:reduce){.sk i{animation:none}}
`;

const pick = (key) => FIRST.find((p) => p.key === key);

export const PROPOSALS = [
  pick("S2"), pick("S6"), pick("S4"),
  {
    key: "W1", name: "S2＋段ごとに区切った帯",
    css: `${FAIL}${HERO}${SEGCSS}`,
    ops: [build(HERO_HTML(SEGRUN)), SEG],
  },
  {
    key: "W2", name: "沈めた骨組みの地＋S2 の名乗り＋区切った帯",
    css: `${FAIL}${HERO}${SEGCSS}${SKCSS}
 body{background:#0f1f30}
 .backdrop{position:fixed;inset:0;opacity:.16;filter:blur(1.5px)}
 .veil{position:fixed;inset:0;background:radial-gradient(ellipse at 50% 42%,rgba(43,95,121,.78) 0%,rgba(28,53,80,.92) 55%,rgba(15,31,48,.97) 100%)}
 .hero{position:relative}
`,
    ops: [build(`<div class="backdrop">${SKELETON}</div><div class="veil"></div>${HERO_HTML(SEGRUN)}`), SEG],
  },
  {
    key: "W3", name: "S2＋名前つきの横の段取り＋前の起動の秒",
    css: `${FAIL}${HERO}${SEGCSS}
 .run{width:620px}
 .steps4{display:grid;grid-template-columns:repeat(4,1fr);margin-top:10px;font-size:12.5px}
 .steps4 span{opacity:.5;text-align:left}
 .steps4 span.ok,.steps4 span.warn{opacity:.8}
 .steps4 span.now{opacity:1;font-weight:700}
 .steps4 span.bad{opacity:1;color:#ff8a7a;font-weight:700}
 .last{margin-top:14px;font-size:12px;opacity:.55}
`,
    ops: [build(HERO_HTML(`<div class="seg" data-seg></div><div class="steps4" data-names></div><div class="nowd" data-nowd style="margin-top:10px;text-align:center"></div><div class="last">前回の起動 3.4 秒</div>`)), SEG,
      ["script", `
        const steps = [...document.querySelectorAll("ol li")];
        const names = () => { const box = document.querySelector("[data-names]");
          if (box.children.length !== steps.length) box.innerHTML = steps.map((li) => "<span>" + li.querySelector(".t").textContent + "</span>").join("");
          steps.forEach((li, i) => { if (box.children[i].className !== li.className) box.children[i].className = li.className; }); };
        new MutationObserver(names).observe(document.querySelector("ol"), { subtree: true, attributes: true, attributeFilter: ["class"] });
        names();`]],
  },
  {
    key: "W4", name: "明るい骨組み＋浮かぶカードに名乗りと区切った帯",
    css: `${FAIL}${SEGCSS}${SKCSS}
 body{display:block;place-items:normal;background:#eef2f5}
 .float{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:560px;background:#fff;border-radius:18px;padding:30px 32px 26px;box-shadow:0 30px 80px rgba(12,34,48,.3)}
 .fh{display:flex;align-items:center;gap:16px}
 .fh img{width:64px;height:64px}
 .fh h1{margin:0;font-size:26px;color:#1c3550}
 .fh .sub{color:var(--muted);font-size:14px}
 .fh .ver{margin-left:auto;align-self:flex-start;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;color:var(--faint)}
 .seg{margin-top:26px}
 .seg i{background:#e6edf2} .seg i.ok{background:var(--teal)} .seg i.now{background:#d5ece9} .seg i.now::after{background:var(--teal)} .seg i.bad{background:var(--red)}
 .nl{display:flex;justify-content:space-between;margin-top:12px;font-size:14px;font-weight:600}
 .nl [data-count]{color:var(--faint);font-variant-numeric:tabular-nums}
 .nowd{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .float .el{position:absolute;right:32px;bottom:14px;font:11px Consolas,monospace;color:var(--faint)}
 ol,#title,#lead{display:none}
 body.is-fail .float{width:780px}
 body.is-fail #title{display:block;font-size:20px;margin-top:22px} body.is-fail #lead{display:block;color:var(--muted);font-size:13.5px}
 body.is-fail .seg,body.is-fail .nl,body.is-fail .nowd{display:none}
 body.is-fail .fail{margin-top:12px}
`,
    ops: [build(`${SKELETON}<div class="float"><div class="fh"><span data-put="img"></span><div><span data-put="#name"></span><span data-put="#subtitle"></span></div><span class="ver" data-ver></span></div>
      <div class="seg" data-seg></div><div class="nl"><span data-now></span><span data-count></span></div><div class="nowd" data-nowd></div>
      <span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span><span data-put="#elapsed"></span></div>`), SEG],
  },
];
