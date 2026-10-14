// 2026-10 初期画面（メニュー＋ダッシュボード）の提案・3 回目（最後の回。95 点に届かなくても、いちばん高い案に決めて足りない点を伝える）。
//   node program/tools/ui-proposals/2026-10-dashboard-3.mjs 出力フォルダ [1728x1152,1280x720]
// 2 回目（2026-10-dashboard-2.mjs）の 1 位は I（68.3 点）、2 位は H（66.5 点）。採点者が挙げた直すこと:
//   1 1728 の釣り合い（柱が伸びすぎ・片方の列が空く）／2 検索の添え書きが切れる／3 レールで「準備中」が消える／4 受信箱に対応の要らない行／
//   5 主ボタンが 2 つ（一覧で見る・続きを開く）／6 同じ行き先・数が 2〜3 か所（見出し帯とナビのマスタ管理・帯と受信箱の数）／7 棒の色に意味が無い
// 3 回目の新しい案（どれも土台に 1〜7 の直し: 柱は 200px で止める・添え書きは「ロット・画面を探す」・レールの検査実績は薄くして「準備中」・
//   受信箱は要対応の 3 行だけ（今週の動きは置いた見方の見出しへ・版はアプリの点へ）・主ボタンは受信箱の 1 行目だけ・
//   マスタ管理はナビだけ（見出し帯から外す）・数の帯は無し・棒は 1 色）。ホームの組み方で分ける:
// N1 I を土台: 左＝受信箱（行の頭に数）＋最近／右＝前回の続き＋置いた見方 3 つ（左右の下端を揃える）
// N2 H を土台: 左＝受信箱＋置いた見方の格子／右＝前回の続き＋最近
// N3 N1 の「前回の続き」を、前回のロットの横断の 3 枚（K。なぜ出ているかを見出しに）にする
// N4 N1 の受信箱を、列の揃った表（数・何・どこ・行動）にする
// N5 N1 の右を、データ源ごとの 1 行の札（J。数・小さな線・開く）にする
// 持ち越し: 2 回目の I・H（上位 2 案）

import path from "node:path";
import { pathToFileURL } from "node:url";
import { BRAND, STATUS, bars, card, inbox, shoot, svg, sparkline, WEEK, DEFECTS, EQUIP } from "./2026-10-dashboard.mjs";
import { CSS as CSS2, DAYS, PROPOSALS as SECOND } from "./2026-10-dashboard-2.mjs";

const OUT = path.resolve(process.argv[2] ?? "dashboard-3");
const VIEWS = (process.argv[3] ?? "1728x1152,1280x720").split(",").map((v) => v.split("x").map(Number));

// 見出し帯: マスタ管理はナビだけ。版の取り込みはアプリの点（橙）で知らせる
const header = () => `<header>${BRAND}<div style="flex:1"></div><div class="header-right">${STATUS}<i class="hsep"></i><button class="pill me-chip">開発者</button>
  <button class="btn-ghost on-dark app-btn" title="新しい版 3.32.0 を取り込みました">アプリ<i class="app-dot"></i> ▾</button><button class="quit">終了</button></div></header>`;
const item = (icon, label, short, on, badge = "", cls = "") => `<a class="${on ? "on " : ""}${cls}">${svg(icon, 17)}<span class="e-l">${label}</span><span class="e-s">${short}</span>${badge}</a>`;
const nav = () => `<nav class="e-nav">
  <button class="e-search">${svg("search", 15)}<span>ロット・画面を探す</span><kbd>Ctrl K</kbd></button>
  ${item("home", "ホーム", "ホーム", true)}
  <h4>データ</h4>
  ${item("list", "異常ロット一覧", "異常ロット", false, '<small class="bad" title="前回から 12 件">12</small>')}
  ${item("work", "作業実績", "作業実績", false, '<small class="warn" title="2 台に注意">⚠ 2</small>')}
  ${item("db", "検査実績", "検査実績", false, '<small class="plain">準備中</small>', "soon")}
  <a class="e-add">${svg("plus", 15)}<span class="e-l">データを足す</span><span class="e-s">足す</span></a>
  <h4>解析</h4>
  ${item("calc", "転写・ピッチ計算", "転写計算", false)}
  <div class="e-foot">${item("gear", "マスタ管理", "マスタ", false)}</div>
</nav>`;
const shell = (main) => `<style>${CSS2}${CSS}</style>${header()}<div class="e-shell">${nav()}<main class="d-main e-main">${main}</main></div>`;
const hello = `<div class="d-hello"><h2>ホーム</h2><small>前回 10/13 17:40 からの変化・品質データ 10/14 6:00 更新</small><span class="e-start">起動したら <b>ホーム ▾</b></span></div>`;

// 受信箱は要対応だけ。行の頭に数（I）。主ボタンは 1 行目だけ
const row = (tone, num, unit, title, desc, go) => `<li class="d-in ${tone}"><i></i><span class="e-num">${num}<small>${unit}</small></span><span><b>${title}</b><small>${desc}</small></span><button>${go} ›</button></li>`;
const INBOX = `<ul class="d-inbox e-inn">
  ${row("bad", "12", "件", "新しい異常ロット", "前回（10/13 17:40）より後。汚れ 5・キズ 4・異物 3", "一覧で見る")}
  ${row("warn", "2", "台", "作業実績の設備に注意", "SL3 のファイルが見つからない・HOT の更新が 41 時間止まっている", "設備を見る")}
  ${row("info", "3", "件", "計算していない異常ロット", "発見設備に検査計がある異常ロットのうち、まだ計算していない物", "計算する")}</ul>`;
const TODO = card("いま見るべき事", INBOX, { sub: "3 件" });
// 受信箱を列の揃った表に（N4）
const TABLE = card("いま見るべき事", `<table class="e-todo"><thead><tr><th>数</th><th>何が</th><th>どこで</th><th></th></tr></thead><tbody>
  <tr class="bad"><td><b>12</b> 件</td><td>新しい異常ロット</td><td>汚れ 5・キズ 4・異物 3（前回 10/13 17:40 より後）</td><td><button class="p">一覧で見る ›</button></td></tr>
  <tr class="warn"><td><b>2</b> 台</td><td>作業実績の設備に注意</td><td>SL3 見つからない・HOT 41 時間止まっている</td><td><button>設備を見る ›</button></td></tr>
  <tr class="info"><td><b>3</b> 件</td><td>計算していない異常ロット</td><td>発見設備に検査計があり、まだ計算していない</td><td><button>計算する ›</button></td></tr></tbody></table>`, { sub: "3 件" });
const CONTINUE = `<div class="e-cont">${svg("calc", 18)}<span><b>前回の続き</b> L7150C0 の転写計算<small>今日 9:12・仮の発生 8 TLV（83.8%）</small></span><button>続きを開く</button></div>`;
const rec = (icon, name, what, when) => `<li>${svg(icon, 14)}<b>${name}</b><small>${what}</small><time>${when}</time></li>`;
const RECENT = (n = 10) => card("最近", `<ul class="d-recent">${[
  rec("list", "汚れ・CR1 の今月", "保存した見方・異常ロット一覧", "昨日"), rec("work", "CR2 の日＋直ごと", "保存した見方・作業実績", "10/11"),
  rec("calc", "L0730C0", "計算・仮の発生 5 L-2（71.2%）", "10/10"), rec("list", "キズ・L-1 の先月", "保存した見方・異常ロット一覧", "10/09"),
  rec("calc", "L0409C9", "計算・仮の発生 3 L-1（64.0%）", "10/08"), rec("work", "L-1 の日ごと", "保存した見方・作業実績", "10/07"),
  rec("calc", "L0016C6", "計算・仮の発生 2 L-1（58.3%）", "10/06"), rec("list", "異物・DL2 の今週", "保存した見方・異常ロット一覧", "10/04"),
  rec("calc", "L0222C5", "計算・仮の発生 4 L-2（77.0%）", "10/03"), rec("work", "TLV の日＋直ごと", "保存した見方・作業実績", "10/02"),
  rec("calc", "L0589C1", "計算・仮の発生 6 L-2（69.4%）", "10/01"), rec("list", "打痕・LS3 の今月", "保存した見方・異常ロット一覧", "9/30"),
  rec("calc", "L0770C2", "計算・仮の発生 7 CAL（61.0%）", "9/29"), rec("work", "DL2 の日ごと", "保存した見方・作業実績", "9/28")].slice(0, n).join("")}</ul>`, { act: "すべて ›" });
const PIN = (title, sub, body, act = "開く ›") => card(`${svg("pin", 13)} ${title}`, body, { sub, act, cls: "e-pin" });
const daily = () => {
  const max = Math.max(...DAYS);
  return `<div class="e-chart" style="height:180px"><div class="e-y"><span>${max}</span><span>${max / 2}</span><span>0</span></div><div class="e-plot"><div class="d-cols">${DAYS.map((v) => `<i style="height:${(v / max) * 100}%"></i>`).join("")}</div>
    <div class="e-x"><span>9/15</span><span>9/22</span><span>9/29</span><span>10/6</span><span>10/13</span></div></div></div>`;
};
const P_WEEK = PIN("日ごとの異常ロット", `直近 30 日・今週 48 件（先週より ＋9）`, daily(), "時系列で開く ›");
const P_SHIFT = PIN("作業実績 CR2 の直ごと", "今週のロット数", bars([["1直", 94], ["2直", 93], ["3直", 97], ["4直", 12], ["5直", 9]]));
const P_DEF = PIN("不良名ごと", "直近 30 日", bars(DEFECTS));
const P_EQ = PIN("設備ごと", "直近 30 日", bars(EQUIP));
const lot = (title, kv, act) => card(title, `<div class="d-kv">${kv.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("")}</div>`, { act });
const CROSS = `<section class="e-cross"><h3>前回のロット <b>L7150C0</b><small>今日 9:12 に計算した物（Ctrl＋K で別のロットへ）</small></h3><div class="e-lot3">
  ${lot("異常（品質データ）", [["登録日", "2026/09/26"], ["不良名", "汚れ"], ["設備", "KEN"]], "一覧で ›")}
  ${lot("作業実績（10 工程）", [["最初", "9/17 HOT"], ["最後", "9/26 KEN"]], "作業実績で ›")}
  ${lot("転写計算", [["仮の発生", "8 TLV（83.8%）"], ["実転写距離", "3.73 m"]], "3D で ›")}</div></section>`;
const src = (icon, name, nums, spark, act = "開く ›", cls = "") => `<div class="e-srow ${cls}">${svg(icon, 17)}<b>${name}</b><span class="e-sn">${nums}</span>${spark}<span class="d-act">${act}</span></div>`;
const SOURCES = card("データ", `<div class="e-srcs">
  ${src("list", "異常ロット一覧", "<em>今週 48 件</em>・先週より ＋9", sparkline(WEEK, "var(--h-input)"))}
  ${src("work", "作業実績", "<em>12 台</em>・今週 284 ロット", sparkline([40, 42, 38, 45, 41, 39, 44, 43, 40, 46, 42, 41, 45, 47], "var(--h-input)"))}
  ${src("calc", "転写・ピッチ計算", "<em>今月 27 件</em>を計算", sparkline([1, 2, 1, 3, 2, 2, 4, 1, 3, 2, 3, 2, 1, 2], "var(--h-input)"))}
  ${src("db", "検査実績", "準備中（データを足すと、ここに出ます）", "", "", "soon")}</div>`);

const CSS = `
  .header-right .app-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin:0 0 6px 2px}
  .e-nav a.soon{opacity:.6}.e-nav a.soon svg{opacity:.7}
  .d-in.bad button{background:var(--h-input);color:#fff;border-color:var(--h-input)}
  .d-in:not(.bad) button{background:var(--surface);color:var(--h-input)}
  .e-cont button{background:var(--surface);color:var(--h-input);border:1px solid var(--line)}
  .d-bar i{background:var(--h-input)!important}
  .e-pin .d-card-h{flex-wrap:wrap}.e-pin .d-card-h h3{white-space:nowrap}.e-pin .d-card-h small{color:var(--muted);order:3;flex-basis:100%}
  .e-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:12px;align-items:start}
  .e-grid > div{display:flex;flex-direction:column;gap:12px}
  .e-pins2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .e-todo{width:100%;border-collapse:collapse;font-size:13px}
  .e-todo th{text-align:left;font-size:11.5px;color:var(--faint);font-weight:700;padding:0 10px 6px;border-bottom:1px solid var(--line)}
  .e-todo td{padding:9px 10px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
  .e-todo td:first-child{white-space:nowrap;border-left:4px solid var(--h-meta);color:var(--muted)}.e-todo td:first-child b{font-size:20px;color:var(--ink)}
  .e-todo tr.bad td:first-child{border-left-color:var(--danger)}.e-todo tr.bad b{color:var(--danger)!important}
  .e-todo tr.warn td:first-child{border-left-color:var(--accent)}.e-todo tr.info td:first-child{border-left-color:var(--h-input)}
  .e-todo td:nth-child(2){font-weight:800}.e-todo td:nth-child(3){color:var(--muted);font-size:12.5px}.e-todo td:last-child{text-align:right;white-space:nowrap}
  .e-todo button{height:28px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--h-input);font:inherit;font-size:12.5px;font-weight:700;padding:0 12px}
  .e-todo button.p{background:var(--h-input);color:#fff;border-color:var(--h-input)}
  .e-cross{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:12px 16px}
  .e-cross h3{margin:0 0 8px;font-size:14.5px;display:flex;align-items:baseline;gap:8px}.e-cross h3 small{color:var(--muted);font-size:12px;font-weight:600}
  .e-lot3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.e-lot3 .d-card{box-shadow:none;border:1px solid var(--line-soft);padding:8px 10px}
  .e-lot3 .d-card-h h3{font-size:12.5px}.e-lot3 .d-kv{font-size:12px}
  .e-srcs{display:grid}
  .e-srow{display:grid;grid-template-columns:20px auto 1fr auto auto;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line-soft);color:var(--h-meta)}
  .e-srow b{color:var(--ink);font-size:14px}.e-srow .e-sn{color:var(--muted);font-size:12.5px}.e-srow em{font-style:normal;font-weight:800;color:var(--ink)}
  .e-srow.soon{opacity:.6}
  @media (max-width:1440px){
    .e-nav a.soon small.plain{display:block;position:static;background:none;color:var(--muted);font-size:9.5px;font-weight:700;padding:0;line-height:1.1}
    .e-grid{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}
    .e-lot3{grid-template-columns:1fr}
    .e-srow{grid-template-columns:20px auto 1fr auto}.e-srow .d-spark{display:none}
  }
`;

export const PROPOSALS = [
  { key: "N1", name: "I を土台: 左 受信箱（行の頭に数）＋最近／右 前回の続き＋置いた見方 3 つ",
    body: () => shell(`${hello}<div class="e-grid"><div>${TODO}${RECENT(14)}</div><div>${CONTINUE}${P_WEEK}${P_DEF}${P_EQ}</div></div>`) },
  { key: "N2", name: "H を土台: 左 受信箱＋置いた見方の格子／右 前回の続き＋最近",
    body: () => shell(`${hello}<div class="e-grid"><div>${TODO}<div class="e-pins2">${P_DEF}${P_EQ}</div>${P_WEEK}</div><div>${CONTINUE}${RECENT(14)}${P_SHIFT}</div></div>`) },
  { key: "N3", name: "N1 の前回の続きを、前回のロットの横断の 3 枚に（なぜ出ているかを見出しに）",
    body: () => shell(`${hello}<div class="e-grid"><div>${TODO}${RECENT(14)}</div><div>${CROSS}${P_WEEK}${P_DEF}</div></div>`) },
  { key: "N4", name: "N1 の受信箱を、列の揃った表（数・何が・どこで・行動）に",
    body: () => shell(`${hello}<div class="e-grid"><div>${TABLE}${RECENT(14)}</div><div>${CONTINUE}${P_WEEK}${P_DEF}${P_EQ}</div></div>`) },
  { key: "N5", name: "N1 の右を、データ源ごとの 1 行の札（数・小さな線・開く）に",
    body: () => shell(`${hello}<div class="e-grid"><div>${TODO}${RECENT(14)}</div><div>${CONTINUE}${SOURCES}${P_WEEK}${P_DEF}</div></div>`) },
  ...SECOND.filter((p) => ["I", "H"].includes(p.key)),
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await shoot(PROPOSALS, OUT, VIEWS);
