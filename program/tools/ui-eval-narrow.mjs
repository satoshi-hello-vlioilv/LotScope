// 評価関数（開発用）: 狭い画面・大きい表示倍率でも画面が崩れない（版 3.32.0。表示の下限をフル HD・150% の 1280×720 に広げた）。
//   node program/tools/ui-eval-narrow.mjs [出力フォルダ]     … 出力フォルダを渡すと、見つけた所を撮る（状態-幅.png）
// 利用者の PC（1728×1152）・フル HD・125%（1536×864）・フル HD・150%（1280×720）で、主な状態ごとに数える:
// ① 折れ: ボタン・タブ・札の字が、1 つの字の並びのまま 2 行以上に折れている（「マスタ管理」が「マ／ス／タ」になる など）
// ② 切れ: 押せる物・札が、画面の外や、はみ出しを隠す枠（overflow: hidden）の外へ出て、全部は見えない（スクロールで届く枠の中は数えない）
// ③ 段: 1 段のはずの段（見出し帯・道具の行・件数の行・設備のタブ・3D の頭の行）が 2 段以上になっている
// ④ 重なり: 3D の札どうし・札と凡例が重なっている／札が 3D の枠の外へ出ている（計算の 3D。見えている札だけ）
// ⑤ 届く: 見出し帯の操作（画面のタブ・マスタ管理・アプリ・終了）がどれも画面の中にあって押せる
// ⑥ 名前: 縮めて出す名前（書式の名前・効いている物の名前）が、出ているのに 3 字も読めない（「異…」のように 1〜2 字で切れる）
// 全部 0 なら終了コード 0。
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : "";
const VIEWS = [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }, { width: 1280, height: 720 }];
const STATES = ["list", "crowded", "sorted", "card", "calc", "worklog", "worklog-work", "worklog-pivot", "slicer", "profile", "columns", "master", "master-place", "master-release", "calc3d", "worklog-many"];

/** 頁の中で数える（page.evaluate に渡す） */
function inspect() {
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const name = (el) => (el.id ? `#${el.id}` : el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/)[0]}` : el.tagName.toLowerCase())
    + `「${(el.textContent || el.value || el.title || "").trim().replace(/\s+/g, " ").slice(0, 14)}」`;
  // 浮かぶ面・窓（中は折り返してよい・別の枠で測る）は数えない。開いている窓があれば、その中だけを数える
  const DIALOG = ".master-overlay:not(.hidden), .master-form-overlay:not(.hidden), #llColumnPanel:not([hidden]), #llFxPanel:not([hidden])";
  const dialog = [...document.querySelectorAll(DIALOG)].find(shown) || null;
  const inScope = (el) => (dialog ? dialog.contains(el) : true);

  // ① 折れ: 字の並び（テキストノード）1 つが、2 行以上に分かれて描かれている
  const folded = [];
  for (const el of document.querySelectorAll("button, [role=tab], .pill, .x-label, .eq-chip, .ll-count, :is(header, .filter-search-row, .ll-status) label")) {
    if (!shown(el) || !inScope(el) || el.closest(".x-legend, .lr-rows, .cl-body, .explain-text, .fm-item, td")) continue;
    if (el.matches(".x-label.cand-list")) continue;   // 候補ロールの並びは、わざと折り返す札
    for (const t of el.childNodes) {
      if (t.nodeType !== 3 || !t.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(t);
      const tops = [...r.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top));
      if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 6) { folded.push(name(el)); break; }
    }
  }
  // ② 切れ: はみ出しを隠す枠・画面の外。スクロールできる枠の中なら、その枠までで止める（スクロールで届く）
  const cut = [];
  const W = innerWidth, H = innerHeight;
  for (const el of document.querySelectorAll("button, [role=tab], select, input:not([type=hidden]), .pill, .x-label, .eq-chip")) {
    if (!shown(el) || !inScope(el)) continue;
    const r = el.getBoundingClientRect();
    let bad = "", scrolled = false;
    for (let n = el.parentElement; n && !bad && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      const scrolls = /(auto|scroll)/.test(s.overflowX + s.overflowY);
      const clips = /(hidden|clip)/.test(s.overflowX) || /(hidden|clip)/.test(s.overflowY);
      if (!clips && !scrolls) continue;
      const b = n.getBoundingClientRect();
      const out = (/(hidden|clip|auto|scroll)/.test(s.overflowX) && (r.right > b.right + 1 || r.left < b.left - 1))
        || (/(hidden|clip|auto|scroll)/.test(s.overflowY) && (r.bottom > b.bottom + 1 || r.top < b.top - 1));
      if (out && !scrolls) bad = `枠 ${name(n)} の外`;
      if (scrolls) { scrolled = true; break; }   // スクロールで届く（表の行・長い面）
    }
    if (!bad && !scrolled && (r.right > W + 1 || r.left < -1)) bad = "画面の外";
    if (bad) cut.push(`${name(el)}（${bad}）`);
  }
  // ③ 段: 子の縦の中心がいくつの段に分かれるか
  const lines = (box) => {
    if (!shown(box)) return 0;
    const mids = [...box.children].filter((x) => shown(x) && !/^(absolute|fixed)$/.test(getComputedStyle(x).position)).map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
    let n = 0, last = -1e9; for (const m of mids) { if (m - last > 10) n++; last = m; }
    return n;
  };
  const ROWS = { "見出し帯": "header", "見出し帯の右": "header .header-right", "画面のタブ": "header .screen-tabs", "道具の行": "#llFilterBar .filter-search-row",
    "件数の行": "#lotListScreen .ll-status", "設備のタブ": "#llEquipBar .eq-chips", "設備の行": "#llEquipBar", "3D の頭の行": "#explain .explain-h", "表の上の行": "#calcScreen .sheet-head" };
  const rows = {};
  if (!dialog) for (const [k, sel] of Object.entries(ROWS)) { const n = lines(document.querySelector(sel)); if (n > 1) rows[k] = n; }
  // ④ 重なり（3D）
  const overlap = [];
  const stage = document.querySelector("#explainStage");
  if (!dialog && shown(stage)) {
    const sr = stage.getBoundingClientRect();
    const labels = [...stage.querySelectorAll(".x-label")].filter((el) => shown(el) && el.style.display !== "none");
    const legend = [...stage.querySelectorAll(".x-legend")].filter(shown);
    const rect = (el) => el.getBoundingClientRect();
    const hit = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    for (let i = 0; i < labels.length; i++) {
      const a = rect(labels[i]);
      if (a.left < sr.left - 1 || a.right > sr.right + 1 || a.top < sr.top - 1 || a.bottom > sr.bottom + 1) overlap.push(`${name(labels[i])} が枠の外`);
      for (const lg of legend) if (hit(a, rect(lg)) > 6) overlap.push(`${name(labels[i])} と凡例`);
      for (let j = i + 1; j < labels.length; j++) if (hit(a, rect(labels[j])) > 6) overlap.push(`${name(labels[i])} と ${name(labels[j])}`);
    }
  }
  // ⑤ 見出し帯の操作が画面の中で押せる
  const reach = [];
  if (!dialog) for (const el of document.querySelectorAll("header button")) {
    if (!el.offsetParent || el.closest(".hidden")) continue;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
    if (r.right > W + 1 || r.left < -1 || !(top && (el === top || el.contains(top)))) reach.push(name(el));
  }
  // ⑥ 名前（出ているのに 3 字も読めない。畳んで出さないのはよい）
  const names = [];
  for (const el of document.querySelectorAll(".fm-entry.has-now .fm-now, #llActiveTabs .ll-aname")) {
    if (!shown(el) || !el.textContent.trim()) continue;
    const em = parseFloat(getComputedStyle(el).fontSize) || 13;
    if (el.scrollWidth > el.clientWidth && el.clientWidth < em * 3) names.push(`${name(el.closest("button") || el)}（${Math.round(el.clientWidth)}px）`);
  }
  return { folded, cut, rows, overlap, reach, names };
}

const fails = [];
const app = await launch();
try {
  for (const view of VIEWS) {
    const p = await app.newPage("light", view);
    const tag = `${view.width}×${view.height}`;
    await walk(p, async (state) => {
      const got = await p.evaluate(inspect);
      const bad = got.folded.length + got.cut.length + Object.keys(got.rows).length + got.overlap.length + got.reach.length + got.names.length;
      console.log(`${bad ? "NG" : "OK"} ${tag} ${state}` + (bad ? `: ${JSON.stringify(got)}` : ""));
      if (bad) {
        fails.push(`${tag} ${state}`);
        if (OUT) await p.screenshot({ path: path.join(OUT, `${state}-${view.width}.png`) });
      }
    }, STATES);
    await p.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `\nNG ${fails.length} か所: ${fails.join("・")}` : "\nすべて OK");
process.exit(fails.length ? 1 : 0);
