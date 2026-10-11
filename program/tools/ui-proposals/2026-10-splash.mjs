// 2026-10「起動画面を有料の製品の水準に」1 回目の 7 案（S1〜S5 ＋ 方向の違う S6・S7）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-splash.mjs --states splash,splash-fail
//
// 版 3.16.0 の起動画面（desktop/splash/index.html）の部品（#name・#subtitle・#elapsed・#title・#lead・ol の段・#fail・img）を、案の骨組みの
// data-put の所へ動かして組み替える（窓が呼ぶ splash.brand・step・fail はそのまま動く）。どの案にも共通の写し（COMMON）:
//   [data-ver] … 版（splash.version）  [data-bar] … 進み具合の幅（済んだ段＋いまの段の半分）  [data-count] … 「2 / 4」
//   [data-now] … いまの段の名前  [data-nowd] … いまの段の説明  body.is-fail … 止まった
//   [data-eta] … 前の起動の秒から見込んだ残り（S7）

export const COMMON = `
  const steps = [...document.querySelectorAll("ol li")];
  window.splash.version = (v) => put("[data-ver]", "VER " + v);
  const t0 = performance.now();
  const put = (sel, text) => document.querySelectorAll(sel).forEach((e) => { if (e.textContent !== text) e.textContent = text; }); // 変わったときだけ（見張りが自分の書き換えで回り続けない）
  const paint = () => {
    const done = steps.filter((li) => li.className === "ok" || li.className === "warn").length;
    const now = steps.find((li) => li.className === "now" || li.className === "bad");
    const p = Math.min(100, Math.round(((done + (now && now.className === "now" ? 0.5 : 0)) / steps.length) * 100));
    document.querySelectorAll("[data-bar]").forEach((e) => (e.style.width = p + "%"));
    document.documentElement.style.setProperty("--p", p);
    put("[data-count]", Math.min(steps.length, done + 1) + " / " + steps.length);
    put("[data-now]", now ? now.querySelector(".t").textContent : "準備ができました");
    put("[data-nowd]", now ? now.querySelector(".d").textContent : "");
    document.body.classList.toggle("is-fail", !document.querySelector("#fail").classList.contains("hidden"));
    const eta = Math.max(1, Math.round(4.2 - (performance.now() - t0) / 1000));
    put("[data-eta]", "あと約 " + eta + " 秒");
  };
  new MutationObserver(paint).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true, attributeFilter: ["class"] });
  setInterval(paint, 250);
  paint();
`;

/** 骨組み（html）を組み、data-put="#id" の所へ今の部品を動かす */
export const build = (html) => ["script", `
  const box = document.createElement("div");
  box.innerHTML = ${JSON.stringify(html)};
  for (const s of box.querySelectorAll("[data-put]")) { const el = document.querySelector(s.dataset.put); if (el) s.replaceWith(el); }
  document.querySelector("section.card").replaceWith(...box.childNodes);
  ${COMMON}`];

// 共通の見た目（失敗の箱: 次にすることを主に、理由は等幅の控えに。どの案も同じ物を使う）
export const FAIL = `
 .fail{background:#fff;border:1px solid #f0d9a8;border-left:4px solid var(--amber);color:var(--ink);border-radius:10px;padding:14px 16px;font-size:14px}
 .fail > b{display:block;color:var(--warn);font-size:13px;letter-spacing:.04em}
 .fail > div{font-size:15px;font-weight:600;margin:2px 0 10px;line-height:1.7}
 .fail > b + pre{margin-top:4px}
 .fail pre{background:#f5f7f9;border-radius:8px;padding:10px 12px;font-size:12px;color:var(--muted);max-height:150px}
`;

export const PROPOSALS = [
  {
    key: "S0", name: "今の形（基準）", css: "", ops: [],
  },
  {
    key: "S1", name: "磨き上げ（2 段組・進み具合の帯・版）",
    css: `${FAIL}
 .card{width:min(1040px,92vw);grid-template-columns:340px 1fr;border-radius:18px;box-shadow:0 30px 80px rgba(4,14,26,.45)}
 .side{padding:40px 32px}
 .side img{width:88px;height:88px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.3))}
 .side h1{font-size:28px;margin-top:20px;letter-spacing:.01em}
 .side .sub{font-size:15px;opacity:.85}
 .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;font-size:12px;opacity:.75}
 .foot .el{margin:0;padding:0;opacity:1}
 .ver{font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.14em;padding:5px 9px;border:1px solid rgba(255,255,255,.35);border-radius:999px}
 .main{padding:34px 36px 30px}
 #title{font-size:22px}
 #lead{font-size:13.5px;margin-top:2px}
 .prog{display:flex;align-items:center;gap:12px;margin:18px 0 6px}
 .track{flex:1;height:6px;border-radius:99px;background:#e6edf2;overflow:hidden}
 .track i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--teal),#45a39c);transition:width .5s ease}
 .prog span{font:600 12px "Segoe UI",sans-serif;color:var(--muted);font-variant-numeric:tabular-nums}
 li{padding:11px 12px;border-radius:10px;border-top:0;margin-top:2px;align-items:flex-start}
 li.now{background:#eef7f6}
 .d{font-family:Consolas,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;word-break:normal}
 body.is-fail .track i{background:var(--amber)}
`,
    ops: [build(`<section class="card" aria-labelledby="title">
  <div class="side"><span data-put="img"></span><span data-put="#name"></span><span data-put="#subtitle"></span>
    <div class="foot"><span class="ver" data-ver></span><span data-put="#elapsed"></span></div></div>
  <div class="main"><span data-put="#title"></span><span data-put="#lead"></span>
    <div class="prog"><div class="track"><i data-bar></i></div><span data-count></span></div>
    <span data-put="ol"></span><span data-put="#fail"></span></div></section>`)],
  },
  {
    key: "S2", name: "中央の名乗り＋細い帯（製品のスプラッシュ）",
    css: `${FAIL}
 body{background:radial-gradient(ellipse at 50% 35%,#2b5f79 0%,#1c3550 55%,#0f1f30 100%);color:#fff}
 .hero{display:flex;flex-direction:column;align-items:center;text-align:center;width:min(760px,90vw)}
 .hero img{width:112px;height:112px;filter:drop-shadow(0 12px 28px rgba(0,0,0,.4))}
 .hero h1{font-size:44px;margin:22px 0 0;letter-spacing:.01em;font-weight:700}
 .hero .sub{font-size:18px;opacity:.82;margin-top:2px}
 .ver{margin-top:12px;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.2em;opacity:.6}
 .run{width:420px;margin-top:56px}
 .track{height:4px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}
 .track i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7fd3c9,#e6a52e);border-radius:99px;transition:width .5s ease}
 .now{display:flex;justify-content:space-between;margin-top:12px;font-size:14px;opacity:.9}
 .now [data-count]{font-variant-numeric:tabular-nums;opacity:.7}
 .nowd{margin-top:2px;font-size:12px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .el{position:fixed;right:24px;bottom:18px;font:12px Consolas,monospace;opacity:.45}
 .panel{display:none}
 body.is-fail .run{display:none}
 body.is-fail .panel{display:block;margin-top:34px;width:min(820px,90vw);background:#fff;color:var(--ink);border-radius:16px;padding:24px 28px;text-align:left;box-shadow:0 24px 60px rgba(0,0,0,.35)}
 body.is-fail .hero img{width:72px;height:72px}
 body.is-fail .hero h1{font-size:30px;margin-top:12px}
 #title{font-size:20px} #lead{color:var(--muted);font-size:13.5px}
 ol{display:none}
`,
    ops: [build(`<div class="hero"><span data-put="img"></span><span data-put="#name"></span><span data-put="#subtitle"></span><span class="ver" data-ver></span>
  <div class="run"><div class="track"><i data-bar></i></div><div class="now"><span data-now></span><span data-count></span></div><div class="nowd" data-nowd></div></div>
  <div class="panel"><span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span></div>
  <span data-put="#elapsed"></span></div>`)],
  },
  {
    key: "S3", name: "全面の左右分割（名乗りの面＋縦の段取り）",
    css: `${FAIL}
 body{display:grid;grid-template-columns:42% 1fr;place-items:stretch;background:#fff}
 .brandside{display:flex;flex-direction:column;justify-content:center;padding:0 7vw;color:#fff;background:linear-gradient(160deg,#13263a,#1c3550 50%,#2b5f79);position:relative}
 .brandside img{width:104px;height:104px}
 .brandside h1{font-size:46px;margin:26px 0 0;line-height:1.15}
 .brandside .sub{font-size:19px;opacity:.82;margin-top:6px}
 .ver{margin-top:28px;font:600 12px/1 "Segoe UI",sans-serif;letter-spacing:.2em;opacity:.6}
 .brandside .el{position:absolute;left:7vw;bottom:36px;font:12px Consolas,monospace;opacity:.55}
 .stepside{display:flex;flex-direction:column;justify-content:center;padding:0 8vw 0 6vw}
 #title{font-size:28px} #lead{color:var(--muted);font-size:14px;margin-top:4px}
 ol{margin-top:30px;position:relative}
 li{border-top:0;padding:0 0 26px;position:relative}
 li:not(:last-child)::before{content:"";position:absolute;left:13px;top:30px;bottom:2px;width:2px;background:var(--line)}
 li.ok:not(:last-child)::before{background:var(--teal)}
 .mark{width:28px;height:28px;font-size:13px;margin-top:0;background:#fff}
 .t{font-size:16px}
 .d{font-family:Consolas,monospace;font-size:12.5px}
 .fail{margin-top:4px}
`,
    ops: [build(`<div class="brandside"><span data-put="img"></span><span data-put="#name"></span><span data-put="#subtitle"></span><span class="ver" data-ver></span><span data-put="#elapsed"></span></div>
  <div class="stepside"><span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span></div>`)],
  },
  {
    key: "S4", name: "横の段取り（ステッパー）のカード",
    css: `${FAIL}
 .card4{width:min(980px,92vw);background:#fff;border-radius:20px;box-shadow:0 30px 80px rgba(4,14,26,.45);overflow:hidden}
 .top{display:flex;align-items:center;gap:18px;padding:28px 36px;border-bottom:1px solid var(--line)}
 .top img{width:64px;height:64px}
 .top h1{font-size:26px;margin:0;color:var(--navy)}
 .top .sub{color:var(--muted);font-size:14px}
 .top .ver{margin-left:auto;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;color:var(--faint);padding:6px 10px;border:1px solid var(--line);border-radius:99px}
 .body4{padding:26px 36px 30px}
 #title{font-size:20px} #lead{color:var(--muted);font-size:13.5px}
 ol{display:grid;grid-template-columns:repeat(4,1fr);margin:26px 0 8px;position:relative}
 li{flex-direction:column;align-items:center;text-align:center;border-top:0;padding:0 8px;gap:8px;position:relative}
 li:not(:last-child)::after{content:"";position:absolute;top:15px;left:calc(50% + 22px);right:calc(-50% + 22px);height:2px;background:var(--line)}
 li.ok:not(:last-child)::after{background:var(--teal)}
 .mark{width:32px;height:32px;font-size:14px;margin:0}
 .t{font-size:14px}
 .d{font-size:11.5px;font-family:Consolas,monospace;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .foot4{display:flex;justify-content:space-between;color:var(--faint);font-size:12px;margin-top:14px}
 .foot4 .el{font-family:Consolas,monospace}
 .fail{margin-top:16px}
`,
    ops: [build(`<section class="card4"><div class="top"><span data-put="img"></span><div><span data-put="#name"></span><span data-put="#subtitle"></span></div><span class="ver" data-ver></span></div>
  <div class="body4"><span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span>
  <div class="foot4"><span>準備ができたら、この窓がそのままアプリになります</span><span data-put="#elapsed"></span></div></div></section>`),
      ["script", `document.querySelector("#name").style.cssText="display:block;font-size:26px;font-weight:700;color:#1c3550";`]],
  },
  {
    key: "S5", name: "見出し帯つきカード（段ごとに状態の文字）",
    css: `${FAIL}
 .card5{width:min(900px,90vw);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(4,14,26,.45)}
 .band{position:relative;display:flex;align-items:center;gap:16px;padding:22px 30px;color:#fff;background:linear-gradient(110deg,#1c3550,#2b5f79)}
 .band img{width:56px;height:56px}
 .band h1{font-size:24px;margin:0}
 .band .sub{opacity:.82;font-size:14px}
 .band .ver{margin-left:auto;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;opacity:.7}
 .band .track{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.12)}
 .band .track i{display:block;height:100%;width:0;background:var(--amber);transition:width .5s}
 .b5{padding:22px 30px 24px}
 #title{font-size:19px} #lead{color:var(--muted);font-size:13px}
 li{align-items:center}
 li > span:last-child{flex:1;min-width:0}
 li::after{margin-left:auto;font-size:12px;font-weight:700;color:var(--faint);white-space:nowrap}
 li.ok::after{content:"完了";color:var(--teal)} li.now::after{content:"実行中";color:#1f6f8b} li.wait::after{content:"待機"}
 li.bad::after{content:"失敗";color:var(--red)} li.warn::after{content:"注意";color:var(--warn)}
 .d{font-family:Consolas,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .f5{display:flex;justify-content:flex-end;color:var(--faint);font:12px Consolas,monospace}
`,
    ops: [build(`<section class="card5"><div class="band"><span data-put="img"></span><div><span data-put="#name"></span><span data-put="#subtitle"></span></div><span class="ver" data-ver></span><div class="track"><i data-bar></i></div></div>
  <div class="b5"><span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span><div class="f5"><span data-put="#elapsed"></span></div></div></section>`)],
  },
  // ---- 5 案の方向: S1・S3・S4・S5 は「段取りを全部見せる」、S2 だけ「いまの 1 段と帯」。どれも「起動画面という別の画面」。
  //      偏りを崩す 2 案: S6 は「次に出るアプリの画面の骨組みを先に見せる（画面の連続）」、S7 は「段取りではなく残りの時間で語る」。
  {
    key: "S6", name: "アプリの骨組みを先に見せる（画面の連続）",
    css: `${FAIL}
 body{display:block;place-items:normal;background:#eef2f5}
 .appbar{height:52px;display:flex;align-items:center;gap:14px;padding:0 18px;color:#fff;background:linear-gradient(110deg,#1c3550,#2b5f79)}
 .appbar img{width:30px;height:30px}
 .appbar h1{font-size:18px;margin:0;display:inline}
 .appbar .sub{display:inline;font-size:12.5px;opacity:.78;margin-left:10px}
 .appbar .tab{width:150px;height:30px;border-radius:8px 8px 0 0;background:rgba(255,255,255,.1);margin-left:24px;align-self:flex-end}
 .appbar .tab:first-of-type{background:#eef2f5;opacity:.9}
 .appbar .ver{margin-left:auto;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;opacity:.6}
 .sk{margin:12px;height:calc(100vh - 76px);background:#fff;border-radius:10px;padding:18px;overflow:hidden}
 .sk i{display:block;height:14px;border-radius:6px;margin:0 0 18px;background:linear-gradient(90deg,#eef2f5 0%,#f7f9fb 40%,#eef2f5 80%);background-size:200% 100%;animation:sh 1.4s linear infinite}
 .sk i:nth-child(1){width:220px;height:22px} .sk i:nth-child(2){height:44px;margin-bottom:26px}
 .sk i:nth-child(3){height:30px;background:#dfe6ec}
 @keyframes sh{to{background-position:-200% 0}}
 .float{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;background:#fff;border-radius:16px;padding:24px 28px;box-shadow:0 24px 70px rgba(12,34,48,.28)}
 #title{font-size:18px} #lead{color:var(--muted);font-size:13px}
 .track{height:6px;border-radius:99px;background:#e6edf2;overflow:hidden;margin:16px 0 8px}
 .track i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--teal),#45a39c);transition:width .5s}
 .nl{display:flex;justify-content:space-between;font-size:13.5px;font-weight:600}
 .nl [data-count]{color:var(--faint);font-variant-numeric:tabular-nums}
 .nowd{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 ol{display:none}
 .float .el{position:absolute;right:28px;top:26px;font:12px Consolas,monospace;color:var(--faint)}
 body.is-fail .float{width:760px} body.is-fail .track,body.is-fail .nl,body.is-fail .nowd{display:none} body.is-fail .fail{margin-top:14px}
`,
    ops: [build(`<div class="appbar"><span data-put="img"></span><div><span data-put="#name"></span><span data-put="#subtitle"></span></div><span class="tab"></span><span class="tab"></span><span class="ver" data-ver></span></div>
  <div class="sk">${"<i></i>".repeat(3)}${'<i style="width:96%"></i><i style="width:92%"></i><i style="width:97%"></i><i style="width:90%"></i><i style="width:95%"></i>'.repeat(4)}</div>
  <div class="float"><span data-put="#title"></span><span data-put="#lead"></span><div class="track"><i data-bar></i></div>
    <div class="nl"><span data-now></span><span data-count></span></div><div class="nowd" data-nowd></div><span data-put="ol"></span><span data-put="#fail"></span><span data-put="#elapsed"></span></div>`)],
  },
  {
    key: "S7", name: "残りの時間で語る（輪の進み具合）",
    css: `${FAIL}
 body{background:linear-gradient(160deg,#13263a,#1c3550 50%,#2b5f79);color:#fff}
 .c7{display:flex;flex-direction:column;align-items:center;text-align:center}
 .ring{position:relative;width:180px;height:180px;border-radius:50%;display:grid;place-items:center;
   background:conic-gradient(#7fd3c9 calc(var(--p,0)*1%),rgba(255,255,255,.12) 0)}
 .ring::before{content:"";position:absolute;inset:8px;border-radius:50%;background:#1d3a55}
 .ring img{position:relative;width:96px;height:96px}
 .c7 h1{font-size:34px;margin:28px 0 0}
 .c7 .sub{opacity:.8;font-size:16px}
 .eta{margin-top:30px;font-size:22px;font-weight:700}
 .nowd7{margin-top:4px;font-size:13.5px;opacity:.65}
 .ver{position:fixed;left:24px;bottom:18px;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.2em;opacity:.55}
 .el{position:fixed;right:24px;bottom:18px;font:12px Consolas,monospace;opacity:.45}
 ol,.panel{display:none}
 body.is-fail .eta,body.is-fail .nowd7{display:none}
 body.is-fail .panel{display:block;margin-top:30px;width:min(820px,90vw);background:#fff;color:var(--ink);border-radius:16px;padding:22px 26px;text-align:left}
 #title{font-size:19px} #lead{color:var(--muted);font-size:13px}
`,
    ops: [build(`<div class="c7"><div class="ring"><span data-put="img"></span></div><span data-put="#name"></span><span data-put="#subtitle"></span>
  <div class="eta" data-eta></div><div class="nowd7"><span data-now></span></div>
  <div class="panel"><span data-put="#title"></span><span data-put="#lead"></span><span data-put="ol"></span><span data-put="#fail"></span></div>
  <span class="ver" data-ver></span><span data-put="#elapsed"></span></div>`)],
  },
];
