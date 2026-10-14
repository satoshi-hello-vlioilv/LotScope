// 2026-10 初期画面（メニュー＋ダッシュボード）の提案。7 案の作り物の画面を作って撮る（作るのは提案まで。決めた後に本物を作る）。
//   node program/tools/ui-proposals/2026-10-dashboard.mjs 出力フォルダ [1728x1152,1280x720]
// 画面の構造ごと変わる案なので、今の画面に当てる（ui-variants.mjs）のではなく、アプリの CSS（色・字・部品）を読み込んだ作り物の頁を撮る。
// 数は試験用のデータ（ui_server.py: 品質データ 1500 行・作業実績 12 台〈1 台は見つからない・1 台は更新が止まった〉）に合わせた作り物。
//
// 利用者の声: コンテンツが増え、さらに広げる（ダッシュボード・別の実績データ・ほかのデータベース）と、今の初期画面（異常ロット一覧）は使いづらい。
//   メニュー＋ダッシュボードを初期画面にする形か。
// 今の形: 見出し帯に画面のタブ 3 つ（異常ロット一覧・転写・ピッチ計算・作業実績）。起動すると異常ロット一覧。マスタ管理・アプリは右上。
//   一覧と作業実績は同じ部品（表・絞り込み・集計表・グラフ）で、データ源だけが違う → データ源が増えても同じ部品で見られる作り。
//
// 方向（何で解くか）:
// A 置き場＝ホームのタブを足し、ホームはダッシュボード（数の札・小さなグラフ・各画面への入口）。タブはそのまま
// B 構造＝左のナビ（ホーム／データ: 異常ロット・作業実績・＋足す／解析: 転写・ピッチ／管理）＋ホームはダッシュボード。狭いときは絵だけのレールに畳む
// C 減らし方＝ランチャー（大きな入口のカードと、前回の続きだけ。数は出さない）
// D 流れ＝起動は前回の画面のまま。どこからでも Ctrl＋K の「探す・移る」（ロット番号・設備・画面・保存した見方）
// E 見せ方を利用者に＝自分で置くダッシュボード（集計表・グラフの「ホームに置く」で並べる）
// 5 案は「入口をどう並べるか」に寄る → 方向の違う 2 案を足す:
// F ロットで横断＝初期画面は大きな検索。ロット番号から、異常・作業実績・計算を 1 枚に横断して見る（データ源が増えても、ロットで結ぶ）
// G 例外から＝初期画面は「いま見るべき事」（新しい異常・更新が止まった設備・計算待ちのロット・新しい版）の受信箱。押すとその画面のその絞り込みへ

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, PROGRAM } from "../ui-harness.mjs";

const OUT = path.resolve(process.argv[2] ?? "dashboard");
const VIEWS = (process.argv[3] ?? "1728x1152,1280x720").split(",").map((v) => v.split("x").map(Number));
const CSS = ["app.css", "lotlist.css", "lotlist-pivot.css"].map((f) => pathToFileURL(path.join(PROGRAM, "app/static/css", f)).href);

// ---------------------------------------------------------------- 共通の部品
const ICON = {
  home: '<path d="M2.5 7.5 8 3l5.5 4.5V13h-3.5V9.5h-4V13H2.5z"/>',
  list: '<path d="M2 3.5h12M2 8h12M2 12.5h8"/>',
  calc: '<path d="M3 13V8M8 13V3M13 13V6"/>',
  work: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>',
  db: '<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/>',
  search: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/>',
  bell: '<path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 13.5a1.6 1.6 0 0 0 3 0"/>',
  pin: '<path d="M6 2.5h4l-.6 4 2.1 2H4.5l2.1-2zM8 8.5V14"/>',
};
const svg = (k, s = 16) => `<svg viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const STATUS = '<div class="hstat"><span class="pill">データ元: LotDsp（直接）</span><span class="pill conn-ok">接続 ●</span><span class="pill">待機中</span></div>';
const RIGHT = `<div class="header-right">${STATUS}<i class="hsep"></i><button class="pill me-chip">開発者</button><button class="btn-ghost on-dark">マスタ管理</button><button class="btn-ghost on-dark">アプリ ▾</button><button class="quit">終了</button></div>`;
const BRAND = '<div class="brand"><div class="eyebrow">QUALITY ANALYSIS <button class="ver-badge">VER3.32.0</button></div><h1>LotScope<span class="brand-sub">転写距離・ピッチ解析</span></h1></div>';
const tabs = (on, extra = []) => `<nav class="screen-tabs">${[...extra, ["list", "異常ロット一覧"], ["calc", "転写・ピッチ計算"], ["work", "作業実績"]]
  .map(([k, t]) => `<button class="screen-tab" aria-selected="${k === on}">${svg(k, 15)}${t}</button>`).join("")}</nav>`;
const header = (on, extra) => `<header>${BRAND}${tabs(on, extra)}${RIGHT}</header>`;

// 数の札（KPI）。tone: 注意 warn・悪い bad・良い ok・ふつう
const kpi = (label, value, unit, sub, tone = "", spark = "") => `<div class="d-kpi ${tone}"><div class="d-kpi-l">${label}</div>
  <div class="d-kpi-v"><b>${value}</b><small>${unit}</small>${spark}</div><div class="d-kpi-s">${sub}</div></div>`;
const sparkline = (vals, color = "var(--h-xfer)") => {
  const w = 96, h = 26, max = Math.max(...vals), pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * (h - 3) - 1}`).join(" ");
  return `<svg class="d-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
};
const WEEK = [6, 9, 4, 12, 7, 11, 14, 8, 10, 13, 9, 16, 12, 18];
const bars = (rows, color = "var(--h-input)") => {
  const max = Math.max(...rows.map((r) => r[1]));
  return `<div class="d-bars">${rows.map(([k, v]) => `<div class="d-bar"><span>${k}</span><i style="width:${(v / max) * 100}%;background:${color}"></i><b>${v}</b></div>`).join("")}</div>`;
};
const DEFECTS = [["汚れ", 64], ["キズ", 58], ["異物", 51], ["打痕", 44], ["ロール跡", 39], ["ヘコミ", 31]];
const EQUIP = [["CR1", 42], ["L-1", 38], ["DL2", 33], ["LS3", 29], ["TLV", 27], ["ﾛｰﾙ1", 24]];
const column = (vals) => {
  const max = Math.max(...vals);
  return `<div class="d-cols">${vals.map((v, i) => `<i style="height:${(v / max) * 100}%" title="${i}"></i>`).join("")}</div>`;
};
const card = (title, body, { sub = "", act = "", cls = "" } = {}) => `<section class="d-card ${cls}"><div class="d-card-h"><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ""}${act ? `<span class="d-act">${act}</span>` : ""}</div>${body}</section>`;
const entry = (icon, title, desc, meta, tone = "") => `<button class="d-entry ${tone}"><span class="d-ei">${svg(icon, 22)}</span><span class="d-et"><b>${title}</b><small>${desc}</small></span><span class="d-em">${meta}</span></button>`;
const inbox = (tone, title, desc, go) => `<li class="d-in ${tone}"><i></i><span><b>${title}</b><small>${desc}</small></span><button>${go} ›</button></li>`;
const ENTRIES = [
  entry("list", "異常ロット一覧", "品質データの異常ロットを絞り込み、ロット番号から計算へ", "新着 12 件"),
  entry("work", "作業実績", "設備ごとの作業実績（12 台）。日・直でまとめる", "⚠ 2 台", "warn"),
  entry("calc", "転写・ピッチ計算", "ロット番号を入れて、汚れの発生設備を 3D でたどる", "前回 L7150C0"),
  entry("plus", "データを足す", "別の実績・データベースをつなぐ（同じ表・集計表で見る）", "管理者", "ghost"),
];
const INBOX = `<ul class="d-inbox">
  ${inbox("bad", "新しい異常ロット 12 件", "前回（10/13 17:40）より後に登録。汚れ 5・キズ 4・異物 3", "一覧で見る")}
  ${inbox("warn", "作業実績 SL3 のファイルが見つかりません", "名前が変わったか、消されました。結ぶファイルを選び直せます", "選び直す")}
  ${inbox("warn", "作業実績 HOT の更新が 41 時間止まっています", "最後の更新 10/12 20:15（36 時間を過ぎると知らせます）", "設備を見る")}
  ${inbox("info", "計算していない異常ロット 3 件", "発見設備に検査計がある異常ロットのうち、まだ計算していない物", "計算する")}
  ${inbox("ok", "新しい版 3.32.0 を取り込みました", "次に起動すると入れ替わります（更新履歴）", "更新履歴")}
</ul>`;
const KPIS = `<div class="d-kpis">
  ${kpi("今週の異常ロット", "48", "件", "先週より ＋9（＋23%）", "bad", sparkline(WEEK, "var(--danger)"))}
  ${kpi("新着（前回から）", "12", "件", "汚れ 5・キズ 4・異物 3", "warn")}
  ${kpi("計算待ち", "3", "件", "検査計のある発見設備", "")}
  ${kpi("作業実績", "10/12", "台", "1 台見つからない・1 台止まっている", "warn")}
</div>`;
const CHARTS = `<div class="d-grid2">
  ${card("不良名ごとの異常ロット", bars(DEFECTS), { sub: "直近 30 日・287 件", act: "集計表で開く ›" })}
  ${card("設備ごとの異常ロット", bars(EQUIP, "var(--h-xfer)"), { sub: "直近 30 日", act: "集計表で開く ›" })}
  ${card("日ごとの異常ロット", column([3, 5, 2, 6, 4, 7, 5, 9, 4, 6, 8, 5, 7, 10, 6, 4, 8, 11, 7, 9, 6, 12, 8, 10, 9, 13, 7, 11, 9, 14]), { sub: "直近 30 日", act: "時系列で開く ›", cls: "wide" })}
</div>`;
const RECENT = card("最近", `<ul class="d-recent">
  <li>${svg("calc", 14)}<b>L7150C0</b><small>計算・仮の発生 8 TLV（83.8%）</small><time>今日 9:12</time></li>
  <li>${svg("list", 14)}<b>汚れ・CR1 の今月</b><small>保存した見方（異常ロット一覧）</small><time>昨日</time></li>
  <li>${svg("work", 14)}<b>CR2 の日＋直ごと</b><small>作業実績・保存した見方</small><time>10/11</time></li>
  <li>${svg("calc", 14)}<b>L0730C0</b><small>計算・仮の発生 5 L-2（71.2%）</small><time>10/10</time></li></ul>`, { act: "すべて ›" });

const PAGE_CSS = `
  body{overflow:hidden}
  .d-main{height:calc(100vh - var(--header-h));overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
  .d-hello{display:flex;align-items:baseline;gap:14px}
  .d-hello h2{margin:0;font-size:20px;color:var(--ink)}.d-hello small{color:var(--muted);font-size:12.5px}
  .d-hello .d-act{margin-left:auto}
  .d-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .d-kpi{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:12px 16px;border-left:4px solid var(--h-meta)}
  .d-kpi.bad{border-left-color:var(--danger)}.d-kpi.warn{border-left-color:var(--accent)}.d-kpi.ok{border-left-color:var(--ok)}
  .d-kpi-l{font-size:12.5px;color:var(--muted);font-weight:700}
  .d-kpi-v{display:flex;align-items:baseline;gap:4px;margin:2px 0}.d-kpi-v b{font-size:28px;font-variant-numeric:tabular-nums}.d-kpi-v small{color:var(--muted)}
  .d-spark{margin-left:auto;align-self:center}
  .d-kpi-s{font-size:12px;color:var(--muted)}
  .d-kpi.bad .d-kpi-s{color:var(--danger)}
  .d-card{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:12px 16px;min-width:0}
  .d-card-h{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}.d-card-h h3{margin:0;font-size:14.5px}.d-card-h small{color:var(--faint);font-size:12px}
  .d-act{margin-left:auto;color:var(--h-input);font-weight:700;font-size:12.5px;white-space:nowrap}
  .d-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.d-card.wide{grid-column:1 / -1}
  .d-bars{display:grid;gap:5px}.d-bar{display:grid;grid-template-columns:72px 1fr 36px;align-items:center;gap:8px;font-size:12.5px}
  .d-bar i{height:12px;border-radius:3px;display:block}.d-bar b{text-align:right;font-variant-numeric:tabular-nums}
  .d-cols{display:flex;align-items:flex-end;gap:3px;height:90px}.d-cols i{flex:1;background:var(--h-input);border-radius:2px 2px 0 0;opacity:.85}
  .d-entries{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .d-entry{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;gap:4px 12px;text-align:left;padding:14px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);cursor:pointer;font:inherit;color:var(--ink);box-shadow:var(--shadow-sm)}
  .d-entry:hover{border-color:var(--h-input)}
  .d-ei{grid-row:1 / 3;width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:var(--input-soft);color:var(--h-input)}
  .d-et{display:grid;gap:2px}.d-et b{font-size:15px}.d-et small{color:var(--muted);font-size:12px;line-height:1.45}
  .d-em{grid-column:2;font-size:12px;font-weight:700;color:var(--h-xfer)}
  .d-entry.warn .d-em{color:var(--warn-ink)}.d-entry.ghost{border-style:dashed;background:var(--surface-2);box-shadow:none}.d-entry.ghost .d-ei{background:var(--surface-4);color:var(--muted)}
  .d-inbox{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .d-in{display:grid;grid-template-columns:6px 1fr auto;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--line-soft);border-radius:8px;background:var(--surface-1)}
  .d-in i{align-self:stretch;border-radius:3px;background:var(--h-meta)}.d-in.bad i{background:var(--danger)}.d-in.warn i{background:var(--accent)}.d-in.info i{background:var(--h-input)}.d-in.ok i{background:var(--ok)}
  .d-in span{display:grid;gap:1px}.d-in b{font-size:13.5px}.d-in small{color:var(--muted);font-size:12px}
  .d-in button{height:28px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--h-input);font:inherit;font-size:12.5px;font-weight:700;padding:0 12px;white-space:nowrap}
  .d-in.bad button{background:var(--h-input);color:#fff;border-color:var(--h-input)}
  .d-recent{list-style:none;margin:0;padding:0;display:grid}
  .d-recent li{display:grid;grid-template-columns:18px auto 1fr auto;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid var(--line-soft);font-size:13px;color:var(--h-meta)}
  .d-recent b{color:var(--ink)}.d-recent small{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.d-recent time{color:var(--faint);font-size:12px}
  .d-two{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:12px;align-items:start}
  /* 左のナビ */
  .d-shell{display:grid;grid-template-columns:220px minmax(0,1fr);height:calc(100vh - var(--header-h))}
  .d-shell .d-main{height:100%}
  .d-nav{background:#e3eaef;border-right:1px solid var(--line);padding:12px 10px;display:flex;flex-direction:column;gap:2px;overflow:auto}
  .d-nav h4{margin:12px 8px 4px;font-size:11px;letter-spacing:.12em;color:var(--faint)}
  .d-nav a{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border-radius:8px;color:var(--h-meta);font-weight:700;font-size:13.5px;text-decoration:none}
  .d-nav a.on{background:var(--surface);color:var(--h-input);box-shadow:inset 3px 0 0 var(--h-input),var(--shadow-sm)}
  .d-nav a small{margin-left:auto;font-size:11px;font-weight:800;padding:1px 7px;border-radius:999px;background:var(--surface-4);color:var(--muted)}
  .d-nav a small.bad{background:var(--danger);color:#fff}.d-nav a small.warn{background:var(--warn-soft);color:var(--warn-ink)}
  .d-nav a.add{color:var(--muted);font-weight:600;border:1px dashed var(--line)}
  .d-nav .d-navfoot{margin-top:auto;border-top:1px solid var(--line);padding-top:8px}
  @media (max-width:1440px){ .d-shell{grid-template-columns:64px minmax(0,1fr)} .d-nav h4,.d-nav a span,.d-nav a small:not(.bad){display:none} .d-nav a{justify-content:center;padding:0;position:relative}
    .d-nav a small.bad{position:absolute;top:2px;right:4px;padding:0 4px} .brand h1 .brand-sub{display:none}
    .d-kpis{grid-template-columns:repeat(2,minmax(0,1fr))} .d-entries{grid-template-columns:repeat(2,minmax(0,1fr))} }
  /* ランチャー */
  .d-launch{max-width:1100px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:18px;padding-top:24px}
  .d-launch .d-entries{grid-template-columns:repeat(2,minmax(0,1fr))}.d-launch .d-entry{padding:22px 24px}.d-launch .d-ei{width:56px;height:56px}
  .d-continue{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:var(--radius);background:var(--h-input);color:#fff}
  .d-continue b{font-size:16px}.d-continue small{opacity:.85}.d-continue button{margin-left:auto;height:34px;border:0;border-radius:8px;background:#fff;color:var(--h-input);font:inherit;font-weight:800;padding:0 16px}
  /* 探す・移る（Ctrl＋K） */
  .d-veil{position:fixed;inset:0;background:rgba(20,35,50,.35);display:grid;place-items:start center;padding-top:90px;z-index:50}
  .d-palette{width:min(720px,92vw);background:var(--surface);border-radius:12px;box-shadow:0 24px 60px rgba(10,30,50,.35);overflow:hidden}
  .d-palette .d-q{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);font-size:16px}
  .d-palette .d-q span{flex:1;color:var(--ink)}.d-palette .d-q kbd{font-size:11px;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:1px 5px;color:var(--muted)}
  .d-palette h5{margin:8px 16px 4px;font-size:11px;letter-spacing:.1em;color:var(--faint)}
  .d-palette li{list-style:none;display:flex;align-items:center;gap:10px;padding:8px 16px;font-size:13.5px}.d-palette li.on{background:var(--input-soft)}
  .d-palette li small{color:var(--muted);margin-left:auto;font-size:12px}.d-palette ul{margin:0;padding:0 0 6px}
  /* ロットで横断 */
  .d-bigsearch{display:flex;align-items:center;gap:12px;max-width:900px;margin:10px auto 0;width:100%;height:56px;padding:0 18px;border-radius:14px;border:2px solid var(--edit-focus);background:var(--edit-field);box-shadow:0 0 0 5px var(--focus-ring);font-size:18px}
  .d-bigsearch span{flex:1;color:var(--ink);font-weight:700}.d-bigsearch small{font-size:12px;color:var(--muted)}
  .d-lot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .d-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px}.d-kv span{color:var(--muted)}.d-kv b{font-variant-numeric:tabular-nums}
  .d-pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:800;background:var(--danger-bg);color:var(--danger)}
  /* ピン留め */
  .d-pinbar{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--muted)}
  .d-pinbar b{color:var(--ink)}.d-pinbar button{height:28px;border:1px dashed var(--line);border-radius:7px;background:var(--surface-2);font:inherit;color:var(--muted);padding:0 12px}
  .d-card .d-pin{color:var(--faint)}
`;

const page = (title, body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title>
${CSS.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}<style>${PAGE_CSS}</style><body>${body}</body></html>`;
const homeTab = [["home", "ホーム"]];

export const PROPOSALS = [
  { key: "A", name: "ホームのタブ＋ダッシュボード（数の札・グラフ・入口）",
    body: () => `${header("home", homeTab)}<main class="d-main">
      <div class="d-hello"><h2>ホーム</h2><small>10/14（火）9:30・品質データ 10/14 6:00 更新</small><span class="d-act">表示する札を選ぶ ›</span></div>
      ${KPIS}<div class="d-entries">${ENTRIES.join("")}</div><div class="d-two">${CHARTS}${RECENT}</div></main>` },
  { key: "B", name: "左のナビ（データ・解析・管理）＋ホームはダッシュボード。狭いときはレール",
    body: () => `<header>${BRAND}<div style="flex:1"></div>${RIGHT}</header><div class="d-shell"><nav class="d-nav">
      <a class="on">${svg("home")}<span>ホーム</span></a>
      <h4>データ</h4><a>${svg("list")}<span>異常ロット</span><small class="bad">12</small></a><a>${svg("work")}<span>作業実績</span><small class="warn">⚠2</small></a>
      <a>${svg("db")}<span>検査実績</span><small>準備中</small></a><a class="add">${svg("plus")}<span>データを足す</span></a>
      <h4>解析</h4><a>${svg("calc")}<span>転写・ピッチ計算</span></a>
      <div class="d-navfoot"><a>${svg("gear")}<span>マスタ管理</span></a></div></nav>
      <main class="d-main"><div class="d-hello"><h2>ホーム</h2><small>10/14（火）9:30・品質データ 10/14 6:00 更新</small><span class="d-act">表示する札を選ぶ ›</span></div>
      ${KPIS}<div class="d-two"><div style="display:grid;gap:12px">${card("いま見るべき事", INBOX, { sub: "5 件" })}${CHARTS}</div>${RECENT}</div></main></div>` },
  { key: "C", name: "ランチャー（大きな入口と、前回の続きだけ）",
    body: () => `${header("home", homeTab)}<main class="d-main"><div class="d-launch">
      <div class="d-continue">${svg("calc", 22)}<span><b>前回の続き: L7150C0 の転写計算</b><br><small>今日 9:12・仮の発生 8 TLV（83.8%）</small></span><button>続きを開く</button></div>
      <div class="d-entries">${ENTRIES.join("")}</div>${RECENT}</div></main>` },
  { key: "D", name: "前回の画面のまま＋どこからでも Ctrl＋K で探す・移る",
    body: () => `${header("list")}<main class="d-main" style="filter:saturate(.6) blur(.4px)">
      <div class="d-card" style="height:100%;display:grid;place-items:center;color:var(--faint)">（前回の画面: 異常ロット一覧）</div></main>
      <div class="d-veil"><div class="d-palette"><div class="d-q">${svg("search", 18)}<span>L715</span><kbd>Ctrl</kbd><kbd>K</kbd></div>
      <h5>ロット</h5><ul><li class="on">${svg("calc", 14)}<b>L7150C0</b> を計算する<small>Enter</small></li><li>${svg("list", 14)}<b>L7150C0</b> を異常ロット一覧で見る</li><li>${svg("work", 14)}<b>L7150C0</b> の作業実績（10 工程）</li></ul>
      <h5>画面・保存した見方</h5><ul><li>${svg("list", 14)}汚れ・CR1 の今月<small>保存した見方</small></li><li>${svg("work", 14)}作業実績: CR2 の日＋直ごと<small>保存した見方</small></li><li>${svg("home", 14)}ダッシュボード<small>Alt+0</small></li></ul>
      <h5>操作</h5><ul><li>${svg("gear", 14)}マスタ管理を開く</li></ul></div></div>` },
  { key: "E", name: "自分で置くダッシュボード（集計表・グラフを「ホームに置く」）",
    body: () => `${header("home", homeTab)}<main class="d-main">
      <div class="d-hello"><h2>ホーム</h2><small>自分で置いた 4 つ（全員の標準: 品質課の見方）</small><span class="d-act">${svg("pin", 13)} 置き方を変える ›</span></div>
      <div class="d-pinbar">置いた物は、一覧・作業実績の「集計表・グラフ」で <b>📌 ホームに置く</b> を押すと増えます <button>＋ 標準の見方から選ぶ</button></div>
      <div class="d-grid2">${card("📌 不良名ごと（直近 30 日）", bars(DEFECTS), { act: "開く ›" })}${card("📌 設備ごと（直近 30 日）", bars(EQUIP, "var(--h-xfer)"), { act: "開く ›" })}
      ${card("📌 日ごとの異常ロット", column([3, 5, 2, 6, 4, 7, 5, 9, 4, 6, 8, 5, 7, 10, 6, 4, 8, 11, 7, 9, 6, 12, 8, 10, 9, 13, 7, 11, 9, 14]), { act: "開く ›", cls: "wide" })}
      ${card("📌 CR2 の日＋直ごとのロット数", bars([["1直", 94], ["2直", 93], ["3直", 97], ["4直", 12], ["5直", 9]], "var(--h-pitch)"), { act: "開く ›" })}${RECENT}</div></main>` },
  { key: "F", name: "ロットで横断（大きな検索 → 異常・作業実績・計算を 1 枚に）",
    body: () => `${header("home", [["home", "ロットを探す"]])}<main class="d-main">
      <div class="d-bigsearch">${svg("search", 22)}<span>L7150C0</span><small>ロット番号・鋳造 No.・オーダー No.</small></div>
      <div class="d-lot">${card("異常（品質データ）", `<div class="d-kv"><span>登録日</span><b>2026/09/26</b><span>不良名</span><b><span class="d-pill">汚れ</span></b><span>設備</span><b>KEN（検査計）</b><span>客先</span><b>客先A</b></div>`, { act: "一覧で ›" })}
        ${card("作業実績（10 工程）", `<div class="d-kv"><span>最初</span><b>9/17 HOT</b><span>最後</span><b>9/26 KEN</b><span>止まった設備</span><b>なし</b><span>作業者</span><b>A・B・C</b></div>`, { act: "作業実績で ›" })}
        ${card("転写計算", `<div class="d-kv"><span>仮の発生</span><b>8 TLV（83.8%）</b><span>次点</span><b>6 L-2（81.6%）</b><span>実転写距離</span><b>3.73 m</b></div>`, { act: "3D で ›" })}</div>
      <div class="d-two">${card("同じ設備・同じ不良の最近のロット", bars([["L0730C0", 3], ["L0409C9", 2], ["L0016C6", 2]], "var(--danger)"), { act: "一覧で ›" })}${RECENT}</div></main>` },
  { key: "G", name: "例外から（いま見るべき事の受信箱 → その画面のその絞り込みへ）",
    body: () => `${header("home", [["home", "いま見る事"]])}<main class="d-main">
      <div class="d-hello"><h2>いま見るべき事 <small style="font-size:14px;color:var(--danger);font-weight:800">5 件</small></h2><small>前回 10/13 17:40 からの変化</small><span class="d-act">済みにした物を見る ›</span></div>
      <div class="d-two">${card("要対応", INBOX)}<div style="display:grid;gap:12px">${KPIS.replace('class="d-kpis"', 'class="d-kpis" style="grid-template-columns:1fr 1fr"')}${RECENT}</div></div>
      <div class="d-entries">${ENTRIES.join("")}</div></main>` },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [width, height] of VIEWS) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.25, locale: "ja-JP" });
      const p = await ctx.newPage();
      for (const prop of PROPOSALS) {
        const file = path.join(OUT, `${prop.key}.html`);
        fs.writeFileSync(file, page(prop.name, prop.body()));
        await p.goto(pathToFileURL(file).href);
        await p.waitForTimeout(300);
        await p.screenshot({ path: path.join(OUT, `home-${prop.key}-${width}.png`) });
        console.log(`home-${prop.key}-${width}.png`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
