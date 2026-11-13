// 版 3.111.0 の画面の案（段 ② の残り S10・S11 の下ごしらえと、3.110.0 の作った後の採点が次の版に回した 2 つ）:
//   (1) 読めない行の面（TPA.menu .tpa-skipmenu）の行のキーボードの焦点に輪か線を足す。マウスで確かめの窓の「やめる」を押して面が開き直ったときも、
//       押した行に一時の印を付ける（今は :focus-visible の淡い緑の地だけ。マウスでやめると印が無い）
//   (2) 共有に届かない形の 1280 で、マスタ管理の帯（「共有に届きません」・道・説明・「もう一度つなぐ」・札・「マスタの置き場 ›」）と
//       左のナビ（「マスタの置き場 届かない」）を 1 段に収める（今は帯が 2 段・ナビの札が「届かな／い」と語の途中で折れる）
//   (3) 心拍の札（見出しの「接続 ●」）を窓の答えにし、Python（中身）の様子は別に見せる（S10）。今は Python が止まると、窓も画面も動いているのに
//       「未接続 ○」・権限の札が空・「マスタ管理」が消える・下に赤い帯（実物の窓で測った: scratchpad/deleg-3111/measure/broken/shot-12s.png）
//
// 撮り方（ui-variants.mjs。段は TPA_PHASE）:
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=esc    node program/tools/ui-variants.mjs 出力/esc    program/tools/ui-proposals/2026-11-stage2b.mjs --states master --from master [--view 1280x720]
//     … 帯の札「⚠ 設備マスタの読めない行 2」→ 1 つ目の行 → 確かめの窓を Esc でやめた直後（面が開き直り、押した行にキーボードの焦点。(1) の輪）
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=cancel … 同じ所で確かめの窓の「やめる」をマウスで押した直後（(1) の一時の印）
//   TPA_UI_BAD_ROWS=1 TPA_UI_SHARE=down TPA_PHASE=down … 共有に届かない形のマスタ管理（(2) の帯とナビ）
//   TPA_PHASE=pydown node program/tools/ui-variants.mjs 出力/pydown 2026-11-stage2b.mjs --states list … Python が止まった形の見出し（(3)）
//   TPA_PHASE=pyok … Python が動いているいつもの形の見出し（(3) の案がふだんの見た目を崩さないか）
//
// 再現の決まり: 合図の Esc は頁の中で送るので本物の :focus-visible は出ない。キーボードの焦点は .v-kbd（今は今の :focus-visible と同じ淡い緑の地）、
// マウスでやめた行は .v-was で描く。(3) の Python が止まった形は、今（now）は実物の窓と同じ答え（心拍 503・/api/access/me 503・赤い帯）を
// fetch の差し替えで起こし、案は窓が答える形（心拍 200・権限は窓・Python の様子は別の答えの欄 python: "stopped"）を描く。
//
// 案の方向: A 足す（今の形に足すだけ）／B 言葉で解く（2 つの状態を字で並べる）／C 置き場を変える（Python の様子はアプリのメニューへ）／
// D 減らす（1 つの印・出し入れの一言だけ）／E 流れを変える（札を押すと接続の様子の面）／F 位置で見せる（右下の小さな札・左の線）

const PHASE = process.env.TPA_PHASE || "esc";
// 回（2026-11-13 の 1 回目は 77.1 点で 80 に届かず、手順 6 で 2 回目を出した）。既定は 2 回目。TPA_ROUND=1 で 1 回目の 6 案を撮り直せる
const ROUND = process.env.TPA_ROUND || "2";

/** 頁の中で動く文（案の設定 V と段 PHASE） */
function run(V, PHASE) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 25) { const x = f(); if (x) return x; await wait(25); } return null; };
  const css = document.createElement("style");
  css.textContent = `
    /* 今の :focus-visible（淡い緑の地だけ） */
    .tpa-menu button.v-kbd{background:var(--ll-pale);outline:none}
    ${V.css || ""}`;
  document.head.append(css);
  const PY_WHY = "アプリの中身（Python）がすぐに終わりました。ModuleNotFoundError: No module named 'flask'";

  // ---------------- (3) 心拍の札と Python の様子 ----------------
  // ui-variants は list の状態を、案を当てた直後に撮る（待ちが無い）ので、(3) は待たずに同期で描く（頁はもう state.me を読み終えている）
  function py() {
    const down = PHASE === "pydown";
    if (V.key === "now") {
      if (!down) return;
      // 今の窓（実物で測った形）: 心拍は 503 で「未接続 ○」・権限の読みは Python へ回り 503（state.me が誤りの答えになり、札は空・「マスタ管理」は隠れる）・
      // 帯は main.rs の FAIL_BAND_JS と同じ形
      const of = window.fetch;
      window.fetch = (u, o) => /\/api\/(heartbeat|access\/me)/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ error: "アプリの中身（Python）が答えません。", kind: "backend_unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } }))
        : of(u, o);
      setConn(false);
      const chip = document.querySelector("#meChip"); chip.textContent = ""; chip.className = "pill me-chip role-";
      document.querySelector("#masterBtn").classList.add("hidden");
      const d = document.createElement("div"); d.id = "tpa-backend-fail"; d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#9b1c1c;color:#fff;padding:8px 16px;font:14px/1.6 sans-serif;display:flex;gap:12px;align-items:flex-start";
      const t = document.createElement("div"); t.style.cssText = "flex:1;white-space:pre-wrap";
      t.textContent = "アプリの中身（Python）が起動できません。画面・ダッシュボード・一覧は使えます。\n" + PY_WHY;
      const b = (label) => { const x = document.createElement("button"); x.type = "button"; x.textContent = label; x.style.cssText = "font:inherit;padding:2px 10px;border:1px solid #fff;background:transparent;color:#fff;border-radius:4px"; return x; };
      d.append(t, b("もう一度起こす"), b("✕")); document.body.append(d);
      return;
    }
    // 案: 心拍は窓の答え（200）。「接続 ●」は窓と画面のつながり。Python の様子は心拍の答えの python 欄から別に描く
    const of = window.fetch;
    window.fetch = (u, o) => String(u).includes("/api/heartbeat")
      ? of(u, o).then(async (r) => { const j = await r.json().catch(() => ({})); return new Response(JSON.stringify({ ...j, python: down ? "stopped" : "ready", pythonWhy: down ? PY_WHY : "" }), { status: 200, headers: { "Content-Type": "application/json" } }); })
      : of(u, o);
    const conn = document.querySelector("#conn");
    const keep = (sel, paint) => { paint(); new MutationObserver(() => { if (!document.querySelector(sel)) paint(); }).observe(document.body, { childList: true, subtree: true }); };
    if (V.py === "pill") {          // A: 札を 1 つ足す（止まったときだけ）＋下の帯を細い 1 段のアンバーに
      conn.title = "画面とアプリ（窓）がつながっています";
      if (!down) return;
      conn.insertAdjacentHTML("afterend", `<span class="pill v-pyoff" title="${TPA.esc(PY_WHY)}">中身 停止</span>`);
      document.body.insertAdjacentHTML("beforeend", `<div class="v-pyband" role="status"><b>中身（Python）が止まっています</b><span>ほとんどの画面は使えます。一部の形だけ使えません</span><button type="button">もう一度起こす</button><button type="button" aria-label="閉じる">✕</button></div>`);
    } else if (V.py === "words") {  // B: 札の中に 2 つの状態を字で並べる（ふだんも「接続 ● ｜ 中身 ●」）
      const paint = () => { conn.dataset.v = "1"; conn.innerHTML = `<span class="v-seg">接続 ●</span><span class="v-seg v-py${down ? " off" : ""}" role="button" tabindex="0" title="${down ? TPA.esc(PY_WHY) + "（押すと起こし直します）" : "中身（Python）も動いています"}">中身 ${down ? "○" : "●"}</span>`; };   // 1280 で「中身 停止 ○」は「終了」を窓の外へ押した（自分で画像を見て直した）。止まりは ● → ○ の形と title で言う
      keep("#conn[data-v] .v-py", paint);
    } else if (V.py === "menu") {   // C: 札は窓だけ。Python の様子はアプリのメニューの頭（止まったら「アプリ」に点）
      if (!down) return;
      // 「アプリ」の点はショートカットが欠けた印（開発用サーバーでも付いている）なので、点ではなく字の ⚠ で見分ける（自分で画像を見て直した）
      document.querySelector("#appDot")?.insertAdjacentHTML("beforebegin", '<i class="v-appwarn" aria-label="中身が止まっています">⚠</i>');
      document.querySelector("#appBtn").title = "中身（Python）が止まっています・ショートカット・更新履歴";
      document.querySelector("#appBtn").click();
      keep("#appMenu .v-pyrow", () => document.querySelector("#appMenu")?.insertAdjacentHTML("afterbegin", `<button type="button" class="is-warn v-pyrow"><b>⚠ 中身（Python）が止まっています</b><small>ほとんどの画面は使えます。押すと起こし直します（一部の形だけ使えません）</small></button><div class="am-sep"></div>`));
    } else if (V.py === "toast") {  // D: 印は増やさない。止まった・戻ったときに一言だけ（「接続 ●」は窓）
      if (!down) return;
      TPA.toast("中身（Python）が止まりました。ほとんどの画面はこのまま使えます", { rest: "一部の形だけ使えません", ms: 60000 });
    } else if (V.py === "pop") {    // E: 札を押すと接続の様子の面（窓・写し・中身）。止まったら札に ⚠
      conn.setAttribute("role", "button"); conn.tabIndex = 0;
      const paint = () => { conn.dataset.v = "1"; conn.innerHTML = down ? `接続 ● <span class="v-warn" aria-label="中身が止まっています">⚠</span>` : `接続 ●<span class="v-chev" aria-hidden="true">▾</span>`; };
      keep("#conn[data-v]", paint);
      if (!down) return;
      const r = conn.getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", `<div class="v-connpop" role="dialog" aria-label="接続の様子" style="top:${r.bottom + 8}px;left:${Math.max(8, Math.min(innerWidth - 368, r.right - 300))}px">
        <div class="v-ch">接続の様子</div>
        <div class="v-cr"><i class="ok"></i><b>画面と窓</b><span>つながっています</span></div>
        <div class="v-cr"><i class="ok"></i><b>品質・実績の写し</b><span>写し終えています</span></div>
        <div class="v-cr off"><i></i><b>中身（Python）</b><span>止まっています</span></div>
        <p>${TPA.esc(PY_WHY)}<br>ほとんどの画面は使えます。窓が読めない一部の形（例: https のスケジュール）だけ使えません。</p>
        <div class="v-ca"><button type="button" class="btn-primary">もう一度起こす</button></div></div>`);
    } else if (V.py === "corner") { // F: 右下に小さな札（帯の代わり。表の下の端を覆わない幅）
      if (!down) return;
      document.body.insertAdjacentHTML("beforeend", `<div class="v-pycorner" role="status" title="${TPA.esc(PY_WHY)}"><span>⚠ 中身（Python）停止中・一部の形だけ使えません</span><button type="button">もう一度起こす</button><button type="button" aria-label="閉じる">✕</button></div>`);
    }
  }

  // ---------------- (1) 読めない行の面の焦点・(2) 共有に届かない帯とナビ ----------------
  const badge = () => document.querySelector("#masterOverlay:not(.hidden) .master-place .tpa-skip");
  const LONG = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters";   // 現場の長さの道（開発用サーバーの want.json と同じ）。今も案も同じ道で撮る
  function fixBand() {   // (2) 案ごとの帯とナビ（帯は innerHTML で描き直されるので、印は札そのものに付けて当て直す）
    const el = document.querySelector("#masterPlace");
    const d0 = el?.querySelector(".place-dir");
    if (d0 && !d0.dataset.long) { d0.dataset.long = "1"; d0.textContent = LONG; }
    if (V.key === "now" || !V.band) return;
    const off = el?.querySelector(".place-tag.off");
    if (off && !off.dataset.v) {
      off.dataset.v = "1";
      const dir = el.querySelector(".place-dir"), meta = el.querySelector(".place-meta"), retry = el.querySelector("#masterPlaceRetry");
      const full = `${dir?.textContent || ""}（前に取り込んだ写しを表示中・届くまで保存できません）`;
      if (V.band === "title") { off.title = full; dir?.remove(); meta && (meta.textContent = "写しを表示中・保存できません"); }
      if (V.band === "ellipsis") { dir?.classList.add("v-dir-ell"); dir && (dir.title = dir.textContent); meta?.remove(); off.title = full; }
      if (V.band === "button") { dir?.remove(); meta?.remove(); off.title = full; if (retry) { retry.textContent = "↻ もう一度つなぐ"; } off.textContent = "共有に届きません（写しを表示中）"; }
      if (V.band === "one") { dir?.remove(); meta?.remove(); off.textContent = "共有に届きません・写しを表示中"; off.title = full; }
      if (V.band === "base") { if (dir) { dir.title = dir.textContent; dir.textContent = "…/" + dir.textContent.split(/[\\/]/).filter(Boolean).pop(); } meta && (meta.textContent = "写しを表示中"); off.title = full; }
    }
    const st = document.querySelector('#masterTabs [data-tab="place"] .tab-state.off');
    if (st && !st.dataset.v) {
      st.dataset.v = "1";
      st.title = "共有の置き場に届きません";
      if (V.nav === "x") st.textContent = "✕";
      if (V.nav === "dot") { st.textContent = ""; st.classList.add("v-dot"); st.setAttribute("aria-label", "届かない"); }
      if (V.nav === "short") st.textContent = "不通";
      if (V.nav === "below") st.classList.add("v-below");
    }
  }
  async function master() {
    await until(() => window.TPA && TPA.openSkip, 8000);
    new MutationObserver(fixBand).observe(document.body, { childList: true, subtree: true });
    fixBand();
    if (PHASE === "down") { await until(() => document.querySelector("#masterPlace .place-tag"), 15000); fixBand(); return; }
    const chip = await until(badge, 15000);
    if (!chip) return;
    chip.click();
    const row = await until(() => document.querySelector(".tpa-skipmenu button[role=menuitem]:not(:disabled)"), 3000);
    const label = row?.textContent;
    row?.click();
    const box = await until(() => document.querySelector(".tpa-confirm"), 3000);
    if (!box) return;
    if (PHASE === "esc") (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    else box.querySelector('[data-act="no"]').click();
    const again = await until(() => [...document.querySelectorAll(".tpa-skipmenu button[role=menuitem]")].find((b) => b.textContent === label), 3000);
    await wait(120);   // openSkip の 2 つの rAF の後に焦点が置かれる
    if (!again) return;
    if (PHASE === "esc") again.classList.add("v-kbd");          // キーボードの焦点（本物は :focus-visible）
    else if (V.key !== "now") again.classList.add("v-was");     // マウスでやめた行の一時の印（今は無い）
  }

  (async () => {
    if (PHASE === "pydown" || PHASE === "pyok") return py();
    return master();
  })();
}

// 共通の形（見出し帯の中の小さな札・下の細い帯）
const BASE = `
  .v-pyoff{background:#7a4b00 !important;color:#ffe2a8 !important;border-color:#ffd58a !important;font-weight:700}
  .v-pyband{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;gap:12px;padding:6px 16px;background:#fff3d6;border-top:2px solid #e0a020;color:#4a3700;font-size:13.5px}
  .v-pyband span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .v-pyband button{height:26px;padding:0 10px;border-radius:6px;border:1px solid #c9a24a;background:#fff;color:#4a3700;font:inherit;font-weight:700}
  .hstat .v-seg + .v-seg{margin-left:8px;padding-left:8px;border-left:1px solid rgba(255,255,255,.3)}
  .hstat .v-py.off{color:#ffd58a;font-weight:800;cursor:pointer}
  .app-btn .v-appwarn{font-style:normal;color:#ffd58a;font-weight:800;margin-left:4px}
  .v-pyrow b{color:#8a5a00}
  .hstat #conn .v-warn{color:#ffd58a;font-weight:800;margin-left:2px}
  .hstat #conn .v-chev{margin-left:4px;opacity:.7;font-size:10px}
  .v-connpop{position:fixed;z-index:200;width:360px;background:var(--surface);border:1px solid var(--pop-line);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:10px 12px;font-size:13px;color:var(--ink)}
  .v-connpop .v-ch{font-weight:800;margin-bottom:6px}
  .v-connpop .v-cr{display:grid;grid-template-columns:14px 140px 1fr;align-items:center;gap:6px;padding:4px 0;border-top:1px solid var(--line-soft)}
  .v-connpop .v-cr i{width:9px;height:9px;border-radius:50%;background:#b0b8c0}.v-connpop .v-cr i.ok{background:#1f8a55}
  .v-connpop .v-cr.off i{background:transparent;border:2px solid #c07a00}.v-connpop .v-cr.off span{color:#8a5a00;font-weight:700}
  .v-connpop p{margin:8px 0 6px;color:var(--muted);font-size:12.5px;line-height:1.5}
  .v-connpop .v-ca{display:flex;justify-content:flex-end}
  .v-pycorner{position:fixed;right:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:8px;max-width:min(560px,calc(100vw - 24px));padding:6px 8px 6px 12px;border-radius:10px;background:#fff3d6;border:1px solid #e0a020;color:#4a3700;font-size:13px;box-shadow:0 6px 18px rgba(0,0,0,.18)}
  .v-pycorner span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}
  .v-pycorner button{height:26px;padding:0 10px;border-radius:6px;border:1px solid #c9a24a;background:#fff;color:#4a3700;font:inherit;font-weight:700;white-space:nowrap}
  .master-place .v-dir-ell{max-width:24vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;word-break:normal}
  .master-tabs .tab .tab-state.v-dot{width:10px;height:10px;padding:0;border-radius:50%;background:#e0a020;display:inline-block}
  .master-tabs .tab .tab-state.v-dot:empty{display:inline-block}
  .master-tabs .tab .tab-state{white-space:nowrap}
`;

const DEFS = [
  { key: "A", name: "足す（行に藍の輪・マウスでやめた行も同じ輪 2 秒／帯の道を title・ナビの札「✕」／止まったら札「中身 停止」と細いアンバーの帯）",
    V: { py: "pill", band: "title", nav: "x",
      css: `.tpa-skipmenu button.v-kbd,.tpa-skipmenu button.v-was{background:var(--ll-pale);box-shadow:inset 0 0 0 2px #2f5f9f}` } },
  { key: "B", name: "言葉で解く（行の左に太い線・やめた行に「やめた行」の字／帯は道を…で切る・ナビの札「不通」／札に「接続 ● ｜ 中身 ●」をいつも）",
    V: { py: "words", band: "ellipsis", nav: "short",
      css: `.tpa-skipmenu button.v-kbd{background:var(--ll-pale);box-shadow:inset 4px 0 0 #2f5f9f}
            .tpa-skipmenu button.v-was{box-shadow:inset 4px 0 0 #8a97a3;background:#f3f5f7}
            .tpa-skipmenu button.v-was::after{content:"やめた行";flex:none;font-size:11.5px;color:#55616c;border:1px solid #c3ccd4;border-radius:9px;padding:0 6px;margin-left:6px}` } },
  { key: "C", name: "置き場を変える（行に外側の輪・やめた行は淡いアンバーの地／帯の「もう一度つなぐ」を札の隣・道は title・ナビは点だけ／Python の様子はアプリのメニューの頭と「アプリ ⚠」）",
    V: { py: "menu", band: "button", nav: "dot",
      css: `.tpa-skipmenu button.v-kbd{background:var(--ll-pale);outline:2px solid #2f5f9f;outline-offset:-2px}
            .tpa-skipmenu button.v-was{background:#fff3d6}` } },
  { key: "D", name: "減らす（キーボードとマウスで同じ 1 つの輪／帯は 1 語「共有に届きません・写しを表示中」・ナビの札「✕」／印は増やさず止まった・戻ったときの一言だけ）",
    V: { py: "toast", band: "one", nav: "x",
      css: `.tpa-skipmenu button.v-kbd,.tpa-skipmenu button.v-was{background:var(--ll-pale);box-shadow:inset 0 0 0 2px #2f5f9f}` } },
  { key: "E", name: "流れを変える（行に輪＋左の線・やめた行は輪のまま押せる／帯は道を末尾だけ・ナビの札を名前の下の段／札を押すと接続の様子の面〈窓・写し・中身〉）",
    V: { py: "pop", band: "base", nav: "below",
      css: `.tpa-skipmenu button.v-kbd,.tpa-skipmenu button.v-was{background:var(--ll-pale);box-shadow:inset 0 0 0 2px #2f5f9f,inset 5px 0 0 #2f5f9f}
            .master-tabs .tab[data-tab="place"]{flex-wrap:wrap}
            .master-tabs .tab .tab-state.v-below{margin-left:0;flex-basis:100%;width:max-content;max-width:max-content}` } },
  { key: "F", name: "位置で見せる（行の左に線と太字・やめた行は灰の線／帯は道を title・説明を短く・ナビの札「不通」／右下に小さな札「中身（Python）停止中」）",
    V: { py: "corner", band: "title", nav: "short",
      css: `.tpa-skipmenu button.v-kbd{background:var(--ll-pale);box-shadow:inset 4px 0 0 #2f5f9f;font-weight:800}
            .tpa-skipmenu button.v-was{box-shadow:inset 4px 0 0 #8a97a3;background:#f3f5f7}` } },
];

const ROUND1 = DEFS.map(({ key, name, V }) => ({ key, name, css: BASE, ops: [["script", `(${run})(${JSON.stringify({ key, ...V })}, ${JSON.stringify(PHASE)})`]] }));
ROUND1.unshift({ key: "now", name: "今（3.110.0）", css: "", ops: [["script", `(${run})(${JSON.stringify({ key: "now" })}, ${JSON.stringify(PHASE)})`]] });


// ======================================================================================================
// 2 回目（2026-11-13。1 回目の採点の result_note の直し方 1〜4 を全案に入れ、Python の見せ方で方向を分けた）
//   (1) 焦点: キーボードは本物の :focus-visible に 2px の藍の輪（A・D・E の輪）。マウスで「やめる」を押して面が開き直ったときは、同じ輪＋右端の札「やめた行」
//       （B の札。形と字で分かる。色だけにしない）。札は 4 秒か、別の行へ焦点が移るか、キーを押すと消える（輪は焦点がある間）
//   (2) 帯: 「共有に届きません」・道は末尾だけ「…/Masters」（全部は title）・「写しを表示中・保存できません」（A）・「もう一度つなぐ」・札・「マスタの置き場 ›」。
//       ナビは名前の下の段に「届かない」（E。帯と同じ言葉）
//   (3) Python: 見出しに字の札「中身 停止」（A）を出し、押すと「接続の様子」の面（E）。起こし直しは今（帯のボタン 1 手）より手を増やさない。
//       ふだん（動いている）の見出しは 1 px も増やさない。下の帯を残す案は固定で覆わず、画面の高さを縮める。✕・畳むで閉じても札は残る
//   段（TPA_PHASE）: esc・cancel・down・pydown・pyok は 1 回目と同じ撮り方（ui-variants.mjs）。manual・manual-down は何も進めず、案の部品だけを当てる
//   （本物のキーとマウスで撮る台本 scratchpad/deleg-3111/round2/shoot-real.mjs が使う: 本物の :focus-visible・やめた行の札が消える秒・
//   「もう一度起こす」を押した後・閉じた後）
// 案の方向: G 1 回目の上位 2 案を合わせる（A の札＋E の面。最初に止まったとき面を 1 度だけ開く）／H 札の中で起こす（↻ を札の隣に置き、いつも 1 手）／
// I 置き場を上へ（見出しの下に、切断の帯〈#revokedBar〉と同じ置き場・形の知らせの段。画面を縮める）／J 置き換えて幅を変えない（「接続 ●」の札が
// 「中身 停止 ↻」に替わる）／K 今の置き場のまま縮める（下の帯を画面の流れに入れ、表に重ねない）
function run2(V, PHASE) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 25) { const x = f(); if (x) return x; await wait(25); } return null; };
  const now = V.key === "now";
  const css = document.createElement("style");
  css.textContent = now
    ? `.tpa-menu button.v-kbd{background:var(--ll-pale);outline:none}`   // 今の :focus-visible（淡い緑の地だけ）
    : `.tpa-skipmenu button[role=menuitem]:focus-visible,.tpa-skipmenu button.v-kbd,.tpa-skipmenu button.v-was{background:var(--ll-pale);outline:none;box-shadow:inset 0 0 0 2px #2f5f9f}
       .tpa-skipmenu button.v-was::after{content:"やめた行";flex:none;align-self:center;font-size:11.5px;font-weight:700;color:#2f4a6b;background:#fff;border:1px solid #9fb3c8;border-radius:9px;padding:0 7px;margin-left:6px;line-height:18px}
       .master-tabs .tab[data-tab="place"]{flex-wrap:wrap}
       .master-tabs .tab .tab-state.v-below{margin-left:0;flex-basis:100%;width:max-content;max-width:max-content}
       .hstat .pill.v-pyoff{background:#7a4b00;color:#ffe2a8;font-weight:800;cursor:pointer;font:inherit;font-size:var(--fs-sm);border-left:1px solid rgba(255,255,255,.18)}
       .hstat .pill.v-pyoff:hover{background:#8f5900}
       .hstat .pill.v-pyoff.is-wait{background:rgba(255,255,255,.12);color:#dfe9f2;font-weight:700}
       .hstat .v-rs{border:0;border-left:1px solid rgba(255,255,255,.18);background:#7a4b00;color:#ffe2a8;font:inherit;font-size:var(--fs-sm);font-weight:800;padding:3px 10px;cursor:pointer}
       .hstat .v-rs:last-child{border-radius:0 999px 999px 0}
       .hstat .v-rs:hover{background:#8f5900}
       .v-connpop{position:fixed;z-index:200;width:360px;background:var(--surface);border:1px solid var(--pop-line);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:10px 12px;font-size:13px;color:var(--ink)}
       .v-connpop .v-ch{display:flex;align-items:center;font-weight:800;margin-bottom:6px}.v-connpop .v-ch span{flex:1}
       .v-connpop .v-ch button{border:0;background:none;font-size:15px;color:var(--muted);cursor:pointer;padding:0 4px}
       .v-connpop .v-cr{display:grid;grid-template-columns:14px 130px 1fr;align-items:center;gap:6px;padding:4px 0;border-top:1px solid var(--line-soft)}
       .v-connpop .v-cr i{width:9px;height:9px;border-radius:50%;background:#1f8a55}
       .v-connpop .v-cr.off i{background:transparent;border:2px solid #c07a00}.v-connpop .v-cr.off span{color:#8a5a00;font-weight:700}
       .v-connpop p{margin:8px 0 6px;color:var(--muted);font-size:12.5px;line-height:1.5}
       .v-connpop .v-ca{display:flex;justify-content:flex-end}
       .v-pybar{display:flex;align-items:center;gap:12px;padding:0 18px;height:38px;box-sizing:border-box;background:#fff3d6;color:#4a3700;font-size:var(--fs-sm)}
       .v-pybar.top{position:relative;z-index:40;border-bottom:1px solid #e9c46a}
       .v-pybar.bottom{position:fixed;left:0;right:0;bottom:0;z-index:40;border-top:2px solid #e0a020}
       .v-pybar b{font-weight:800;white-space:nowrap}.v-pybar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
       .v-pybar button{height:26px;padding:0 10px;border-radius:6px;border:1px solid #c9a24a;background:#fff;color:#4a3700;font:inherit;font-weight:700;white-space:nowrap;cursor:pointer}
       .v-pybar button.v-restart{background:#7a4b00;border-color:#7a4b00;color:#fff}
       body.v-bar-on [id$="Screen"]{height:calc(100vh - var(--header-h) - 38px) !important}
       .tpa-toast.v-ok{background:#1e6b3a}
       .hstat #status.v-idle-hide{display:none}`;
  document.head.append(css);
  const PY_WHY = "アプリの中身（Python）がすぐに終わりました。ModuleNotFoundError: No module named 'flask'";
  const down0 = PHASE === "pydown" || PHASE === "manual-down";
  const fit = () => { try { if (typeof fitTabs === "function") fitTabs(); } catch (_) { /* 撮るだけ */ } };

  // ---------------- (3) Python ----------------
  let py = down0 ? "stopped" : "ready", opened = false;
  const conn = () => document.querySelector("#conn");
  const hstat = () => document.querySelector(".hstat");
  function closePop() { document.querySelector(".v-connpop")?.remove(); }
  function openPop(anchor) {
    closePop();
    const r = (anchor || conn()).getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", `<div class="v-connpop" role="dialog" aria-label="接続の様子" style="top:${r.bottom + 8}px;left:${Math.max(8, Math.min(innerWidth - 368, r.right - 300))}px">
      <div class="v-ch"><span>接続の様子</span><button type="button" class="v-close" aria-label="閉じる">✕</button></div>
      <div class="v-cr"><i></i><b>画面と窓</b><span>つながっています</span></div>
      <div class="v-cr off"><i></i><b>中身（Python）</b><span>止まっています</span></div>
      <p>${TPA.esc(PY_WHY)}<br>画面・ダッシュボード・一覧・マスタ管理は使えます。窓が読めない一部の形（例: https のスケジュール）だけ使えません。</p>
      <div class="v-ca"><button type="button" class="btn-primary v-restart">もう一度起こす</button></div></div>`);
    const pop = document.querySelector(".v-connpop");
    // 下に入らなければ上に開く（K の下の帯の「詳しく」から開くと、窓の外へ出て見えなかった。自分で画像を見て直した）
    if (r.bottom + 8 + pop.offsetHeight > innerHeight - 8) pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`;
    pop.querySelector(".v-close").onclick = closePop;
    pop.querySelector(".v-restart").onclick = restart;
    const off = (e) => { if (!pop.isConnected) { document.removeEventListener("mousedown", off, true); return; } if (!pop.contains(e.target) && !e.target.closest(".v-pyoff")) { closePop(); document.removeEventListener("mousedown", off, true); } };
    document.addEventListener("mousedown", off, true);
    const esc = (e) => { if (e.key === "Escape" && pop.isConnected) { closePop(); (anchor || conn())?.focus?.(); document.removeEventListener("keydown", esc, true); } };
    document.addEventListener("keydown", esc, true);
  }
  function restart() {
    py = "starting"; closePop(); paint();
    // 起きたら札「中身 起動中…」が消えて「接続 ●」だけに戻る。一言（TPA.toast）は一覧の表の行に浮いて重なったので出さない（自分で画像を見て外した）
    setTimeout(() => { py = "ready"; paint(); }, 1500);
  }
  function bar(where) {   // I・K: 流れの中の知らせの段（画面を 38px 縮める）
    document.querySelector(".v-pybar")?.remove();
    document.body.classList.toggle("v-bar-on", py !== "ready" && !closedBar);
    if (py === "ready" || closedBar) return;
    const html = `<div class="v-pybar ${where}" role="status"><b>⚠ 中身（Python）が${py === "starting" ? "起きるのを待っています…" : "止まっています"}</b>
      <span>画面・ダッシュボード・一覧・マスタ管理は使えます（窓が読めない一部の形だけ使えません）</span>
      ${py === "stopped" ? `<button type="button" class="v-restart">もう一度起こす</button><button type="button" class="v-more">詳しく</button><button type="button" class="v-close" title="畳みます（見出しの「中身 停止」の札は残ります）">畳む</button>` : ""}</div>`;
    if (where === "top") document.querySelector("#revokedBar").insertAdjacentHTML("beforebegin", html);
    else document.body.insertAdjacentHTML("beforeend", html);
    const b = document.querySelector(".v-pybar");
    b.querySelector(".v-restart") && (b.querySelector(".v-restart").onclick = restart);
    b.querySelector(".v-more") && (b.querySelector(".v-more").onclick = (e) => openPop(e.currentTarget));
    b.querySelector(".v-close") && (b.querySelector(".v-close").onclick = () => { closedBar = true; paint(); });
  }
  let closedBar = false;
  function paint() {
    const c = conn(), h = hstat();
    // 見出しは幅の際にあり、止まった印を足すと 1728 でタブの絵が消え、1280 では「スケジュール」が「ほか 1 ▾」に入った（H は 2 つ）（自分で画像を見て確かめた）。
    // 止まっている間は、暇なときの「待機中」の札を隠して幅を返す（計算中・エラーなど、暇でないときの札は出す）。5 案とも。これで 1280 は G・I・J・K が
    // タブを全部残し（H は「ほか 1」）、1728 は J だけが絵を残す（G・H・I・K は「接続 ●」と「中身 停止」が並ぶぶん、止まっている間だけ絵が消える）
    const st = document.querySelector("#status");
    if (st) st.classList.toggle("v-idle-hide", py !== "ready" && st.textContent.trim() === "待機中");
    h.querySelectorAll(".v-pyoff:not(#conn),.v-rs").forEach((x) => x.remove());   // J は #conn そのものに v-pyoff を付けるので消さない（押した後に札ごと消えていた）
    if (V.py === "j") {   // J: 「接続 ●」の札そのものが替わる（窓とのつながりが切れたら、今と同じ「未接続 ○」が先）
      c.dataset.v = "1";
      // 見出しは 1728 でも幅の際にあり、「中身 停止」と ↻ だけでもタブが詰め直された（自分で画像を見て直した）。止まっている間は、暇なときの
      // 「待機中」の札だけを隠して幅をそろえる（計算中・エラーなど、暇でないときの札は出す）

      if (py === "ready") { c.className = "pill conn-ok"; c.textContent = "接続 ●"; c.title = "画面とアプリ（窓）がつながっています"; }
      else {
        c.className = "pill v-pyoff" + (py === "starting" ? " is-wait" : ""); c.textContent = py === "starting" ? "中身 起動中…" : "中身 停止";
        c.title = py === "starting" ? "中身（Python）を起こしています" : `窓とはつながっています。${PY_WHY}（押すと接続の様子）`;
        c.setAttribute("role", "button"); c.tabIndex = 0; c.onclick = () => py === "stopped" && openPop(c);
        // 幅を変えないため、起こすボタンは字なしの ↻（title・aria-label で言う）。1 回目の撮影で「↻ 起こす」の字のぶん 1728 でもタブが詰め直された
        if (py === "stopped") c.insertAdjacentHTML("afterend", `<button type="button" class="v-rs v-restart" title="中身（Python）をもう一度起こします" aria-label="中身をもう一度起こす">↻</button>`);
      }
    } else if (py !== "ready") {   // G・H・I・K: 「接続 ●」はそのまま（窓）。隣に字の札「中身 停止」
      c.insertAdjacentHTML("afterend", `<button type="button" class="pill v-pyoff${py === "starting" ? " is-wait" : ""}" title="${py === "starting" ? "中身（Python）を起こしています" : TPA.esc(PY_WHY) + "（押すと接続の様子）"}">${py === "starting" ? "中身 起動中…" : "中身 停止"}</button>`);
      const pill = h.querySelector(".v-pyoff");
      pill.onclick = () => { if (py !== "stopped") return; if (V.py === "i" || V.py === "k") { if (closedBar) { closedBar = false; paint(); } else openPop(pill); } else openPop(pill); };
      if (V.py === "h" && py === "stopped") pill.insertAdjacentHTML("afterend", `<button type="button" class="v-rs v-restart" title="中身（Python）をもう一度起こします">↻ 起こす</button>`);
    }
    h.querySelector(".v-rs")?.addEventListener("click", restart);
    if (V.py === "i") bar("top");
    if (V.py === "k") bar("bottom");
    if (V.py === "g" && py === "stopped" && !opened) { opened = true; openPop(h.querySelector(".v-pyoff")); }   // 最初に止まったときだけ面を 1 度開く
    fit();
  }
  function pyInstall() {
    if (PHASE !== "pydown" && PHASE !== "pyok" && PHASE !== "manual-down" && PHASE !== "manual-ok") return;
    if (now) {
      if (!down0) return;
      let stopped = true;   // 今の窓: 止まっている間は心拍・権限の読みが 503。「もう一度起こす」で起きたら 200
      const of0 = window.fetch;
      window.fetch = (u, o) => stopped && /\/api\/(heartbeat|access\/me)/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ error: "アプリの中身（Python）が答えません。", kind: "backend_unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } }))
        : of0(u, o);
      // 今の窓（実物で測った形）。「もう一度起こす」を押すと帯を消し、起きたら「接続 ●」に戻る（権限の札は頁を読み直すまで空のまま。今の app.js は
      // 起きた後に権限を読み直さない）
      setConn(false);
      const chip = document.querySelector("#meChip"); chip.textContent = ""; chip.className = "pill me-chip role-";
      document.querySelector("#masterBtn").classList.add("hidden");
      const d = document.createElement("div"); d.id = "tpa-backend-fail"; d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#9b1c1c;color:#fff;padding:8px 16px;font:14px/1.6 sans-serif;display:flex;gap:12px;align-items:flex-start";
      const t = document.createElement("div"); t.style.cssText = "flex:1;white-space:pre-wrap";
      t.textContent = "アプリの中身（Python）が起動できません。画面・ダッシュボード・一覧は使えます。\n" + PY_WHY;
      const b = (label, cls, f) => { const x = document.createElement("button"); x.type = "button"; x.className = cls; x.textContent = label; x.style.cssText = "font:inherit;padding:2px 10px;border:1px solid #fff;background:transparent;color:#fff;border-radius:4px"; x.onclick = f; return x; };
      d.append(t, b("もう一度起こす", "v-restart", () => { d.remove(); setTimeout(() => { stopped = false; setConn(true); }, 1500); }), b("✕", "v-close", () => d.remove()));
      document.body.append(d);
      return;
    }
    // 心拍は窓の答え（200）。止まっている間も「接続 ●」と権限の札・「マスタ管理」は窓の me のまま
    const of = window.fetch;
    window.fetch = (u, o) => String(u).includes("/api/heartbeat")
      ? of(u, o).then(async (r) => { const j = await r.json().catch(() => ({})); return new Response(JSON.stringify({ ...j, python: py, pythonWhy: py === "ready" ? "" : PY_WHY }), { status: 200, headers: { "Content-Type": "application/json" } }); })
      : of(u, o);
    // 心拍のたびに app.js の setConn が #conn を書き直す（J の置き換えが消える）ので包む
    const sc = window.setConn;
    window.setConn = (ok) => { sc(ok); if (ok && V.py === "j" && py !== "ready") paint(); };
    paint();
  }

  // ---------------- (1) 焦点・(2) 帯とナビ ----------------
  const LONG = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters";
  function fixBand() {
    const el = document.querySelector("#masterPlace");
    const d0 = el?.querySelector(".place-dir");
    if (d0 && !d0.dataset.long) { d0.dataset.long = "1"; d0.textContent = LONG; }
    if (now) return;
    const off = el?.querySelector(".place-tag.off");
    if (off && !off.dataset.v) {
      off.dataset.v = "1";
      const dir = el.querySelector(".place-dir"), meta = el.querySelector(".place-meta");
      off.title = `${LONG} に届きません。前に取り込んだ写しを表示中で、届くまで保存できません`;
      if (dir) { dir.title = dir.textContent; dir.textContent = "…/" + dir.textContent.split(/[\\/]/).filter(Boolean).pop(); }
      if (meta) meta.textContent = "写しを表示中・保存できません";
    }
    const st = document.querySelector('#masterTabs [data-tab="place"] .tab-state.off');
    if (st && !st.dataset.v) { st.dataset.v = "1"; st.classList.add("v-below"); st.title = "共有の置き場に届きません"; }
  }
  let lastHow = "", howAt = 0;
  function focusInstall() {
    if (now || !window.TPA || TPA.__v2) return;
    TPA.__v2 = true;
    const orig = TPA.confirmBox.bind(TPA);
    TPA.confirmBox = (o) => orig({ ...o, onClose: (h) => { lastHow = h; howAt = Date.now(); o.onClose?.(h); } });
    // マウスで「やめる」を押した後に面が開き直り、押した行に焦点が来たら: 同じ輪＋札「やめた行」。4 秒か、別の行・キーで消す
    let timer = 0;
    const clear = () => { document.querySelectorAll(".v-was").forEach((x) => x.classList.remove("v-was")); clearTimeout(timer); };
    document.addEventListener("focusin", (e) => {
      const b = e.target.closest?.(".tpa-skipmenu button[role=menuitem]");
      if (!b) return;
      if (lastHow === "cancel" && Date.now() - howAt < 1500) {
        lastHow = ""; clear(); b.classList.add("v-was"); timer = setTimeout(clear, 4000);
        b.addEventListener("focusout", clear, { once: true });
      }
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key !== "Escape") clear(); }, true);
  }
  const badge = () => document.querySelector("#masterOverlay:not(.hidden) .master-place .tpa-skip");
  async function master() {
    await until(() => window.TPA && TPA.openSkip, 8000);
    focusInstall();
    new MutationObserver(fixBand).observe(document.body, { childList: true, subtree: true });
    fixBand();
    if (PHASE === "manual" || PHASE === "down") return;
    const chip = await until(badge, 15000);
    if (!chip) return;
    chip.click();
    const row = await until(() => document.querySelector(".tpa-skipmenu button[role=menuitem]:not(:disabled)"), 3000);
    const label = row?.textContent;
    row?.click();
    const box = await until(() => document.querySelector(".tpa-confirm"), 3000);
    if (!box) return;
    if (PHASE === "esc") (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    else box.querySelector('[data-act="no"]').click();
    const again = await until(() => [...document.querySelectorAll(".tpa-skipmenu button[role=menuitem]")].find((b) => b.textContent === label), 3000);
    await wait(120);
    if (again && PHASE === "esc") again.classList.add("v-kbd");   // 合図の Esc は :focus-visible を起こさないので描く（本物のキーは shoot-real.mjs）
  }
  if (PHASE.startsWith("py") || PHASE.startsWith("manual-")) pyInstall(); else master();
}

const DEFS2 = [
  { key: "G", name: "1 回目の上位を合わせる（札「中身 停止」→ 接続の様子の面。最初に止まったときだけ面を 1 度開く）", V: { py: "g" } },
  { key: "H", name: "札の中で起こす（「中身 停止」の隣に「↻ 起こす」。いつも 1 手・面は札を押して）", V: { py: "h" } },
  { key: "I", name: "置き場を上へ（見出しの下に切断の帯と同じ置き場の知らせの段・画面を縮める・畳んでも札は残る）", V: { py: "i" } },
  { key: "J", name: "置き換えて幅を変えない（「接続 ●」の札が「中身 停止」と字なしの「↻」に替わり、止まっている間は暇なときの「待機中」を隠す）", V: { py: "j" } },
  { key: "K", name: "今の置き場のまま縮める（下の帯を画面の流れに入れて表に重ねない・畳んでも札は残る）", V: { py: "k" } },
];
const ROUND2 = DEFS2.map(({ key, name, V }) => ({ key, name, css: "", ops: [["script", `(${run2})(${JSON.stringify({ key, ...V })}, ${JSON.stringify(PHASE)})`]] }));
ROUND2.unshift({ key: "now", name: "今（3.110.0）", css: "", ops: [["script", `(${run2})(${JSON.stringify({ key: "now" })}, ${JSON.stringify(PHASE)})`]] });

export const PROPOSALS = ROUND === "1" ? ROUND1 : ROUND2;
