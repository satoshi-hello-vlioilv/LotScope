// 評価関数（開発用。版 3.52.1。脆弱性の確認 2026-10-23: 表示列の設定の揃え・幅・読み替えの色に細工した字を入れると JS が動いた）。
//   node program/tools/ui-eval-xss.mjs
// 表示列の設定（この PC の覚え。共有の書式・初期設定・取り込んだ表示の設定もここに入る）の揃え（aligns）・幅（widths）・
// 読み替えのルールの色（rules の color）に「x'"><img src=x onerror=…>」を入れて一覧を開き、表示列の窓で列を選び、
// ① JS が 1 度も動かない ② 細工した <img> が頁に無い ③ 一覧は描けている（行がある）④ 画面に CSP が付き、あとから入れた onerror は動かないを確かめる。全部合えば終了コード 0。
import { launch, sleep } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 600)}`}`); if (!ok) fails.push(name); };
const P = (n) => `x'"><img src=x class=xss onerror=__x(${n})>`;
const app = await launch();
try {
  const p = await app.newPage("light", { width: 1728, height: 1152 });
  const hits = new Set();
  p.on("console", (m) => { if (m.text().startsWith("XSS-HIT")) hits.add(m.text().split(" ")[1]); });
  await p.addInitScript(() => { window.__x = (n) => console.log("XSS-HIT " + n); });
  await p.waitForSelector("#llBody tr[data-i]", { timeout: 30000 });
  // いま開いている表の列で細工する（表の鍵は覚えの中から探す。無ければ一覧が使う鍵の形）
  const cols = await p.$$eval("#llHead th[data-col]", (ths) => ths.map((t) => t.dataset.col).filter(Boolean));
  await p.evaluate(({ cols, pl }) => {
    const key = "tpa.lotlist.layout.v1", all = JSON.parse(localStorage.getItem(key) || "{}");
    const targets = new Set(Object.keys(all).concat(["lotlist:仕掛"]));
    Object.keys(localStorage).forEach((k) => { if (k.startsWith("tpa.lotlist")) { try { Object.keys(JSON.parse(localStorage.getItem(k)) || {}).forEach((t) => t.startsWith("lotlist:") && targets.add(t)); } catch (_) { /* 字の覚え */ } } });
    const aligns = {}, widths = {}, rules = {};
    cols.forEach((c, i) => {
      aligns[c] = { data: pl[0], head: pl[1] };
      widths[c] = pl[2];
      rules[c] = [{ conditions: [], text: "", color: pl[3] }];
    });
    targets.forEach((t) => { all[t] = { ...(all[t] || {}), aligns, widths, rules }; });
    localStorage.setItem(key, JSON.stringify(all));
  }, { cols, pl: [P(1), P(2), P(3), P(4)] });
  p.on("pageerror", (e) => console.log("pageerror: " + e.message));
  await p.reload(); await sleep(6000);
  if (await p.$("#llColBtn")) {
    await p.click("#llColBtn"); await sleep(600);
    const li = await p.$("#lcList li[data-col]"); if (li) { await li.click(); await sleep(600); }
    await p.keyboard.press("Escape"); await sleep(300);
  }
  check("① 細工した揃え・幅・色で JS が動かない", !hits.size, [...hits]);
  check("② 細工した <img> が頁に無い", !(await p.$("img.xss")), "");
  check("③ 一覧は描けている", (await p.$$("#llBody tr[data-i]")).length > 0, "");
  // ④ 画面（HTML）に CSP（版 3.52.1）: 印の無いインラインの <script>・onerror などは動かない。アプリの <script> は印つきで動く
  const r = await p.request.get(p.url().split("#")[0]);
  const csp = r.headers()["content-security-policy"] || "";
  check("④ 画面に CSP（script-src 'self' と印）", /script-src 'self' 'nonce-[^']+'/.test(csp) && /object-src 'none'/.test(csp), csp);
  const ran = await p.evaluate(() => { const s = document.createElement("div"); s.innerHTML = '<img src=x onerror="window.__inl=1">'; document.body.append(s); return new Promise((d) => setTimeout(() => d(!!window.__inl), 300)); });
  check("④ CSP で、あとから入れた onerror は動かない", !ran, ran);
  check("④ アプリの印つき <script> は動いている（画面の設定が読めている）", await p.evaluate(() => typeof window.TPA_UI_STATE === "object"), "");
} finally { await app.close(); }
console.log(fails.length ? `NG ${fails.length} 件` : "OK（すべて合いました）");
process.exit(fails.length ? 1 : 0);
