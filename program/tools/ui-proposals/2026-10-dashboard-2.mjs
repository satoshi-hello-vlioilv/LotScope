// 2026-10 初期画面（メニュー＋ダッシュボード）の提案・2 回目。1 回目（2026-10-dashboard.mjs）は 7 案とも 95 点に届かず（1 位 B 67.6 点）、案出しからやり直す。
//   node program/tools/ui-proposals/2026-10-dashboard-2.mjs 出力フォルダ [1728x1152,1280x720]
// 1 回目の採点で効いて見えたエッセンス（採点者の言葉）と、残った問題:
//   B 左のナビ（データ源が増えても縦に足すだけ・札で状態が見える・見出し帯が空く）／G いま見るべき事の受信箱（最初に見る物が 1 つ・押すとその絞り込みへ）／
//   D・F ロット番号から横断して移る／C 前回の続き／E ホームに置く
//   問題: 数の重複（ナビ・数の札・受信箱の 3 か所）・主従が逆（数の札が受信箱より上）・入口のカードがナビと同じ行き先の繰り返し・1728 で下が空く・
//   狭いときのレールが絵だけで札が絵に重なる・名前の不揃い（異常ロット／異常ロット一覧）・柱に日付の目盛りが無い・説明の最後の字だけ折れる
// 2 回目の新しい案（どれも土台に: 左のナビ＋ナビの上の常設の検索〈Ctrl＋K〉・狭いときのレールは絵＋短い名前・札は絵に重ねない・名前は画面名・入口のカードは無し・
//   柱に日付の目盛り・起動する画面を選べる）。ホームの主を何で組むかで分ける:
// H 受信箱が主＋細い数の帯＋置いた見方（グラフ）＋右に前回の続きと最近
// I 数を受信箱の行に溶かす（行の頭に大きな数）＋右に置いた見方を縦に
// J データ源ごとの要約の札（数・小さなグラフ・注意）を並べる（受信箱は上に 3 行）
// K ロットで横断を主に（ホームの頭に大きな検索と、打った所の横断の 3 枚）＋受信箱
// L 時間で分ける（左「きょう」: 受信箱・前回の続き／右「今週」: 数の帯・置いた見方）
// 持ち越し: 1 回目の B・G（2026-10-dashboard.mjs の PROPOSALS）

import path from "node:path";
import { pathToFileURL } from "node:url";
import { BRAND, RIGHT, bars, card, inbox, shoot, svg, sparkline, WEEK, DEFECTS, EQUIP, PROPOSALS as FIRST } from "./2026-10-dashboard.mjs";

const OUT = path.resolve(process.argv[2] ?? "dashboard-2");
const VIEWS = (process.argv[3] ?? "1728x1152,1280x720").split(",").map((v) => v.split("x").map(Number));

export const DAYS = [3, 5, 2, 6, 4, 7, 5, 9, 4, 6, 8, 5, 7, 10, 6, 4, 8, 11, 7, 9, 6, 12, 8, 10, 9, 13, 7, 11, 9, 14];
/** 日ごとの柱（日付の目盛りつき。高さは枠に合わせて伸びる） */
export const daily = (vals = DAYS) => {
  const max = Math.max(...vals);
  const ticks = ["9/15", "9/22", "9/29", "10/6", "10/13"];
  return `<div class="e-chart"><div class="e-y"><span>${max}</span><span>${Math.round(max / 2)}</span><span>0</span></div><div class="e-plot"><div class="d-cols">${vals.map((v) => `<i style="height:${(v / max) * 100}%"></i>`).join("")}</div>
    <div class="e-x">${ticks.map((t) => `<span>${t}</span>`).join("")}</div></div></div>`;
};
export const header = () => `<header>${BRAND}<div style="flex:1"></div>${RIGHT}</header>`;
/** 左のナビ（狭いときは絵＋短い名前のレール。札は名前の右・レールでは絵の右上の枠の外） */
export const nav = (on = "home") => `<nav class="e-nav">
  <button class="e-search">${svg("search", 15)}<span>ロット番号・画面を探す</span><kbd>Ctrl K</kbd></button>
  ${item("home", "home", "ホーム", "ホーム", on)}
  <h4>データ</h4>
  ${item("list", "list", "異常ロット一覧", "異常ロット", on, '<small class="bad" title="前回から 12 件">12</small>')}
  ${item("work", "work", "作業実績", "作業実績", on, '<small class="warn" title="2 台に注意">⚠ 2</small>')}
  ${item("db", "db", "検査実績", "検査実績", on, '<small class="plain">準備中</small>')}
  <a class="e-add">${svg("plus", 15)}<span class="e-l">データを足す</span><span class="e-s">足す</span></a>
  <h4>解析</h4>
  ${item("calc", "calc", "転写・ピッチ計算", "転写計算", on)}
  <div class="e-foot">${item("gear", "gear", "マスタ管理", "マスタ", on)}</div>
</nav>`;
export const item = (key, icon, label, short, on, badge = "") => `<a class="${key === on ? "on" : ""}">${svg(icon, 17)}<span class="e-l">${label}</span><span class="e-s">${short}</span>${badge}</a>`;
export const shell = (main, on) => `<style>${CSS}</style>${header()}<div class="e-shell">${nav(on)}<main class="d-main e-main">${main}</main></div>`;
export const hello = (title, sub) => `<div class="d-hello"><h2>${title}</h2><small>${sub}</small><span class="e-start">起動したら <b>ホーム ▾</b></span></div>`;
export const INBOX3 = `<ul class="d-inbox">
  ${inbox("bad", "新しい異常ロット 12 件", "前回（10/13 17:40）より後。汚れ 5・キズ 4・異物 3", "一覧で見る")}
  ${inbox("warn", "作業実績の 2 台に注意", "SL3 のファイルが見つからない・HOT の更新が 41 時間止まっている", "設備を見る")}
  ${inbox("info", "計算していない異常ロット 3 件", "発見設備に検査計がある異常ロットのうち、まだ計算していない物", "計算する")}
</ul>`;
export const INBOX5 = INBOX3.replace("</ul>", `${inbox("plain", "今週の異常ロット 48 件（先週より ＋9）", "汚れが先週の 1.6 倍。CR1 に多い", "集計表で見る")}
  ${inbox("ok", "新しい版 3.32.0 を取り込みました", "次に起動すると入れ替わります", "更新履歴")}</ul>`);
export const STRIP = `<div class="e-strip"><span><b>48</b> 件 今週の異常ロット <em class="bad">▲ ＋23%</em>${sparkline(WEEK, "var(--danger)")}</span><span><b>3</b> 件 計算待ち</span>
  <span><b>10</b>/12 台 作業実績が読める</span><span class="e-fresh">品質データ 10/14 6:00 更新</span></div>`;
export const CONTINUE = `<div class="e-cont">${svg("calc", 18)}<span><b>前回の続き</b> L7150C0 の転写計算<small>今日 9:12・仮の発生 8 TLV（83.8%）</small></span><button>続きを開く</button></div>`;
export const RECENT = card("最近", `<ul class="d-recent">
  <li>${svg("list", 14)}<b>汚れ・CR1 の今月</b><small>保存した見方・異常ロット一覧</small><time>昨日</time></li>
  <li>${svg("work", 14)}<b>CR2 の日＋直ごと</b><small>保存した見方・作業実績</small><time>10/11</time></li>
  <li>${svg("calc", 14)}<b>L0730C0</b><small>計算・仮の発生 5 L-2（71.2%）</small><time>10/10</time></li>
  <li>${svg("list", 14)}<b>キズ・L-1 の先月</b><small>保存した見方・異常ロット一覧</small><time>10/09</time></li>
  <li>${svg("calc", 14)}<b>L0409C9</b><small>計算・仮の発生 3 L-1（64.0%）</small><time>10/08</time></li></ul>`, { act: "すべて ›" });
export const PIN = (title, body, act = "開く ›", cls = "") => card(`${svg("pin", 13)} ${title}`, body, { act, cls: `e-pin ${cls}` });
export const PINS2 = `${PIN("不良名ごと（直近 30 日）", bars(DEFECTS))}${PIN("設備ごと（直近 30 日）", bars(EQUIP, "var(--h-xfer)"))}`;
export const PIN_DAILY = PIN("日ごとの異常ロット（直近 30 日）", daily(), "時系列で開く ›", "grow");
export const lotCard = (title, kv, act) => card(title, `<div class="d-kv">${kv.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("")}</div>`, { act });

export const CSS = `
  .e-shell{display:grid;grid-template-columns:232px minmax(0,1fr);height:calc(100vh - var(--header-h))}
  .e-main{height:100%;display:flex;flex-direction:column}
  .e-nav{background:#e3eaef;border-right:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:2px;overflow:auto}
  .e-nav h4{margin:12px 10px 4px;font-size:11px;letter-spacing:.12em;color:var(--faint)}
  .e-nav a{position:relative;display:flex;align-items:center;gap:10px;min-height:36px;padding:0 10px;border-radius:8px;color:var(--h-meta);font-weight:700;font-size:13.5px}
  .e-nav a.on{background:var(--surface);color:var(--h-input);box-shadow:inset 3px 0 0 var(--h-input),var(--shadow-sm)}
  .e-nav a .e-s{display:none}
  .e-nav a small{margin-left:auto;font-size:11px;font-weight:800;padding:1px 7px;border-radius:999px;white-space:nowrap}
  .e-nav small.bad{background:var(--danger);color:#fff}.e-nav small.warn{background:var(--warn-soft);color:var(--warn-ink)}.e-nav small.plain{background:var(--surface-4);color:var(--muted);font-weight:700}
  .e-nav .e-add{color:var(--muted);font-weight:600;border:1px dashed #c4d0d8}
  .e-nav .e-foot{margin-top:auto;border-top:1px solid var(--line);padding-top:8px}
  .e-search{display:flex;align-items:center;gap:8px;height:34px;margin-bottom:8px;padding:0 10px;border:1px solid var(--edit-line);border-radius:8px;background:var(--edit-field);color:var(--muted);font:inherit;font-size:12.5px;text-align:left}
  .e-search span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .e-search kbd{font:700 10px/1 "Segoe UI",sans-serif;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:2px 4px;color:var(--muted);background:#fff}
  .d-hello{flex:none}.e-start{margin-left:auto;font-size:12.5px;color:var(--muted)}.e-start b{color:var(--h-input)}
  .e-strip{flex:none;display:flex;align-items:center;gap:22px;padding:8px 16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-sm);font-size:12.5px;color:var(--muted)}
  .e-strip span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.e-strip b{font-size:19px;color:var(--ink);font-variant-numeric:tabular-nums}
  .e-strip em{font-style:normal;font-weight:800}.e-strip em.bad{color:var(--danger)}.e-strip .e-fresh{margin-left:auto}
  .e-cont{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:var(--radius);background:var(--input-soft);color:var(--h-input)}
  .e-cont span{display:grid;color:var(--ink);font-size:13.5px}.e-cont small{color:var(--muted);font-size:12px}
  .e-cont button{margin-left:auto;height:30px;border:0;border-radius:7px;background:var(--h-input);color:#fff;font:inherit;font-weight:800;padding:0 14px;white-space:nowrap}
  .d-in.plain i{background:var(--h-meta)}
  .e-cols2{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:12px}
  .e-stack{display:flex;flex-direction:column;gap:12px;min-height:0}
  .e-pins{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .d-card.grow{flex:1;display:flex;flex-direction:column;min-height:150px}.d-card.grow .e-chart{flex:1}
  .e-chart{display:grid;grid-template-columns:auto 1fr;gap:6px;min-height:110px}
  .e-y{display:flex;flex-direction:column;justify-content:space-between;font-size:11px;color:var(--faint);padding-bottom:18px;text-align:right}
  .e-plot{display:flex;flex-direction:column;min-height:0}.e-plot .d-cols{flex:1;height:auto;border-bottom:1px solid var(--line)}
  .e-x{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);padding-top:4px}
  .e-pin .d-card-h h3{display:flex;align-items:center;gap:6px}.e-pin .d-card-h h3 svg{color:var(--faint)}
  .e-inn .d-in{grid-template-columns:62px 1fr auto}.e-inn .d-in i{display:none}
  .e-num{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;text-align:center;color:var(--h-meta);line-height:1}
  .e-num small{display:block;font-size:10.5px;font-weight:700;color:var(--muted)}
  .d-in.bad .e-num{color:var(--danger)}.d-in.warn .e-num{color:var(--warn-ink)}.d-in.info .e-num{color:var(--h-input)}
  .e-src{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;flex:1;min-height:0}
  .e-src .d-card{display:flex;flex-direction:column;gap:6px}
  .e-src .e-big{display:flex;gap:22px}.e-src .e-big span{display:grid;font-size:12px;color:var(--muted)}.e-src .e-big b{font-size:24px;color:var(--ink);font-variant-numeric:tabular-nums}
  .e-src .e-warn{font-size:12.5px;color:var(--warn-ink);font-weight:700}
  .e-src .ghost{border:1px dashed var(--line);background:var(--surface-2);box-shadow:none;color:var(--muted);justify-content:center;align-items:center}
  .e-hero{flex:none;display:grid;gap:10px}
  .e-hero .d-bigsearch{margin:0;max-width:none}
  .e-lot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .e-tl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;flex:1;min-height:0}
  .e-tl > div{display:flex;flex-direction:column;gap:12px;min-height:0}
  .e-tl h3.e-when{margin:0;font-size:13px;letter-spacing:.08em;color:var(--faint)}
  @media (max-width:1440px){
    .brand h1 .brand-sub{display:none}
    .e-shell{grid-template-columns:84px minmax(0,1fr)}
    .e-nav{padding:8px 6px}
    .e-nav h4,.e-nav .e-l{display:none}
    .e-nav a{flex-direction:column;justify-content:center;gap:3px;min-height:54px;padding:6px 2px}
    .e-nav a .e-s{display:block;font-size:10.5px;line-height:1.2;text-align:center}
    .e-nav a small{position:absolute;top:3px;right:3px;margin:0;padding:0 5px;font-size:10px;line-height:15px}
    .e-nav small.plain{display:none}
    .e-nav h4 + a,.e-nav .e-add{margin-top:6px}
    .e-search{justify-content:center;padding:0}.e-search span{display:none}
    .d-hello small{display:none}
    .e-strip{gap:14px}.e-strip .d-spark{display:none}
    .e-cols2{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}
    .e-lot{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
`;

export const PROPOSALS = [
  { key: "H", name: "受信箱が主＋細い数の帯＋置いた見方＋右に前回の続きと最近",
    body: () => shell(`${hello("ホーム", "前回 10/13 17:40 からの変化")}${STRIP}
      <div class="e-cols2"><div class="e-stack">${card("いま見るべき事", INBOX3, { sub: "3 件" })}<div class="e-pins">${PINS2}</div>${PIN_DAILY}</div>
      <div class="e-stack">${CONTINUE}${RECENT}</div></div>`) },
  { key: "I", name: "数を受信箱の行に溶かす（行の頭に大きな数）＋右に置いた見方",
    body: () => shell(`${hello("ホーム", "前回 10/13 17:40 からの変化・品質データ 10/14 6:00 更新")}
      <div class="e-cols2"><div class="e-stack">${card("いま見るべき事", INBOX5.replace('class="d-inbox"', 'class="d-inbox e-inn"')
        .replace(/<li class="d-in (\w+)"><i><\/i>/g, (m, t) => `<li class="d-in ${t}"><i></i><span class="e-num">${{ bad: "12<small>件</small>", warn: "2<small>台</small>", info: "3<small>件</small>", plain: "48<small>今週</small>", ok: "✓" }[t]}</span>`), { sub: "5 件" })}
        ${CONTINUE}${RECENT}</div>
      <div class="e-stack">${PIN("不良名ごと（直近 30 日）", bars(DEFECTS))}${PIN_DAILY}</div></div>`) },
  { key: "J", name: "データ源ごとの要約の札（数・小さなグラフ・注意）＋上に受信箱 3 行",
    body: () => shell(`${hello("ホーム", "前回 10/13 17:40 からの変化")}${card("いま見るべき事", INBOX3, { sub: "3 件" })}
      <div class="e-src">
        ${card(`${svg("list", 15)} 異常ロット一覧`, `<div class="e-big"><span>今週<b>48</b></span><span>新着<b>12</b></span><span>計算待ち<b>3</b></span></div>${daily()}`, { act: "開く ›" })}
        ${card(`${svg("work", 15)} 作業実績`, `<div class="e-big"><span>読める設備<b>10/12</b></span><span>今週のロット<b>284</b></span></div><div class="e-warn">⚠ SL3 見つからない・HOT 41 時間止まっている</div>${bars([["CR1", 94], ["CR2", 93], ["L-1", 97], ["DL2", 61]], "var(--h-pitch)")}`, { act: "開く ›" })}
        ${card(`${svg("calc", 15)} 転写・ピッチ計算`, `${CONTINUE}<div class="e-big"><span>計算待ち<b>3</b></span><span>今月の計算<b>27</b></span></div>`, { act: "開く ›" })}
        ${card(`${svg("db", 15)} 検査実績（準備中）`, `<span>データを足すと、ここに要約が出ます</span>`, { cls: "ghost" })}</div>`) },
  { key: "K", name: "ロットで横断を主に（大きな検索と横断の 3 枚）＋受信箱",
    body: () => shell(`<div class="e-hero"><div class="d-bigsearch">${svg("search", 22)}<span>L7150C0</span><small>ロット番号・鋳造 No.・オーダー No.（Ctrl＋K でどこからでも）</small></div>
      <div class="e-lot">${lotCard("異常（品質データ）", [["登録日", "2026/09/26"], ["不良名", '<span class="d-pill">汚れ</span>'], ["設備", "KEN（検査計）"]], "一覧で ›")}
        ${lotCard("作業実績（10 工程）", [["最初", "9/17 HOT"], ["最後", "9/26 KEN"], ["止まった設備", "なし"]], "作業実績で ›")}
        ${lotCard("転写計算", [["仮の発生", "8 TLV（83.8%）"], ["次点", "6 L-2（81.6%）"], ["実転写距離", "3.73 m"]], "3D で ›")}</div></div>
      <div class="e-cols2"><div class="e-stack">${card("いま見るべき事", INBOX3, { sub: "3 件" })}${PIN_DAILY}</div><div class="e-stack">${RECENT}</div></div>`) },
  { key: "L", name: "時間で分ける（左 きょう: 受信箱・前回の続き／右 今週: 数の帯・置いた見方）",
    body: () => shell(`${hello("ホーム", "10/14（火）9:30")}
      <div class="e-tl"><div><h3 class="e-when">きょう（前回 10/13 17:40 から）</h3>${card("いま見るべき事", INBOX3, { sub: "3 件" })}${CONTINUE}${RECENT}</div>
      <div><h3 class="e-when">今週</h3>${STRIP}${PIN_DAILY}${PIN("不良名ごと（今週）", bars(DEFECTS))}</div></div>`) },
  ...FIRST.filter((p) => ["B", "G"].includes(p.key)),
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await shoot(PROPOSALS, OUT, VIEWS);
