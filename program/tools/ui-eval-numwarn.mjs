// 評価関数（開発用）: 配った設定の数の設定が数でないときの知らせ（版 3.106.0。作った後の採点の画面の割れ 2 つ）。
//   node program/tools/ui-eval-numwarn.mjs
// 開発用サーバーを、配った設定の作業実績の古さの時間を「abc」にして起こし（ui_server.py の TPA_UI_WORK_STALE）、マスタ管理 → データ元 → 実績で:
// ① 「接続」の段の要約に「古さの時間が数でない（36 時間で見ています）」の札・要約の値は「36 時間で警告」（前は「古さの警告なし」）・
//    古さの警告の欄の既定は「既定: 36」（前は「既定: abc」）で、欄の下に知らせ（技術の鍵 work_log.stale_hours を書かない）
// ② 「設備」の段の見出し（畳んだまま）に同じ札が「古い」「見つからない」の札と同じ形・同じ置き場で出る
// ③ 「設備」の段の「直すこと」の 1 行目に「設定が数でない」と知らせ、「接続の欄で直す」を押すと「接続」の段が開き、古さの警告の欄に移る
// ④ 1728×1152・1536×864・1280×720 で、札が見出しの段からはみ出さない・頁が横にはみ出さない
// ⑤ 数の設定が正しい形（環境を外した開発用サーバー）では札も知らせも出ない（ui-eval-sources.mjs が今までどおり通ることでも見る）
// 全部合えば終了コード 0。
import { launch, sleep, parseView } from "./ui-harness.mjs";

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? "OK " : "NG "} ${name}${ok ? "" : `: ${JSON.stringify(got).slice(0, 400)}`}`); if (!ok) fails.push(name); };
const TAG = "古さの時間が数でない（36 時間で見ています）";

async function openWork(p) {
  await p.click("#masterBtn"); await p.waitForSelector("#masterOverlay:not(.hidden)");
  await p.evaluate(() => document.querySelector('#masterTabs [data-tab="sources"]').click()); await sleep(1200);
  await p.click('#masterSettings [data-sr-edit="work"]'); await sleep(1500);
}
const sec = (p, id) => p.evaluate((k) => {
  const s = document.querySelector(`#masterSettings .sr-card.is-open .sr-sec[data-sec="${k}"]`);
  if (!s) return null;
  const head = s.querySelector(".sr-sh"), hr = head.getBoundingClientRect();
  const tags = [...head.querySelectorAll(".sr-tag")].map((t) => { const r = t.getBoundingClientRect(); return { text: t.textContent, cls: t.className, inside: r.right <= hr.right + 1 && r.bottom <= hr.bottom + 1 }; });
  return { open: s.classList.contains("is-open"), sum: head.querySelector(".sr-sum")?.textContent || "", tags };
}, id);

for (const env of [["TPA_UI_WORK_STALE", "abc"]]) process.env[env[0]] = env[1];
const app = await launch();
try {
  for (const view of [parseView("1728x1152"), parseView("1536x864"), parseView("1280x720")]) {
    const tag = `${view.width}×${view.height}`;
    const p = await app.newPage("light", view);
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await openWork(p);
    // ① 接続の段（実績の「変える…」で最初に開く段）
    const conn = await sec(p, "conn");
    check(`① ${tag} 接続の段の要約に札`, conn && conn.tags.some((t) => t.text === TAG && /is-warn/.test(t.cls)), conn);
    check(`① ${tag} 要約の値は 36 時間（「古さの警告なし」と言わない）`, conn && /36 時間で警告/.test(conn.sum) && !/古さの警告なし/.test(conn.sum), conn && conn.sum);
    const field = await p.evaluate(() => {
      const el = document.querySelector('#masterSettings .sr-card.is-open [data-sr-conn="stale"]');
      const warn = el?.closest("label")?.querySelector("[data-conn-warn]");
      return { ph: el?.placeholder, warn: warn?.textContent || "", size: warn ? parseFloat(getComputedStyle(warn).fontSize) : 0 };
    });
    check(`① ${tag} 古さの警告の欄の既定は 36・欄の下に知らせ（技術の鍵を書かない・11px 以上）`,
      field.ph === "既定: 36" && /「abc」が数ではないので、既定の 36 時間で見ています/.test(field.warn) && !/work_log/.test(field.warn) && field.size >= 11, field);
    // ② 設備の段の見出し（畳んだまま）
    const eq = await sec(p, "equip");
    check(`② ${tag} 設備の段は畳んだまま見出しに札（「古い」「見つからない」と同じ形）`,
      eq && !eq.open && eq.tags.some((t) => t.text === TAG && /sr-tag is-warn/.test(t.cls)) && eq.tags.some((t) => /古い/.test(t.text)), eq);
    check(`④ ${tag} 札が見出しの段からはみ出さない`, [...(conn?.tags || []), ...(eq?.tags || [])].every((t) => t.inside), { conn, eq });
    // ③ 直すことの 1 行目と、接続の欄への案内
    await p.click('#masterSettings [data-sr-sec="equip"]'); await sleep(1500);
    const todo = await p.evaluate(() => {
      const row = document.querySelector("#masterSettings .wl-todo > div");
      return row ? { chip: row.querySelector(".m-chip")?.textContent, text: row.textContent, button: !!row.querySelector("[data-wl-conn]") } : null;
    });
    check(`③ ${tag} 直すことの 1 行目に「設定が数でない」と案内のボタン`, todo && todo.chip === "設定が数でない" && /「abc」が数ではない/.test(todo.text) && !/work_log/.test(todo.text) && todo.button, todo);
    await p.click("#masterSettings [data-wl-conn]"); await sleep(600);
    const moved = await p.evaluate(() => {
      const a = document.activeElement, s = document.querySelector('#masterSettings .sr-card.is-open .sr-sec[data-sec="conn"]');
      const r = a?.getBoundingClientRect();
      return { conn: s?.classList.contains("is-open"), focus: a?.dataset?.srConn || "", seen: r ? r.top >= 0 && r.bottom <= innerHeight : false };
    });
    check(`③ ${tag} 押すと接続の段が開き、古さの警告の欄に移る（見える所）`, moved.conn && moved.focus === "stale" && moved.seen, moved);
    const over = await p.evaluate(() => { const b = document.scrollingElement; const m = document.querySelector("#masterSettings"); return b.scrollWidth > b.clientWidth + 1 || m.scrollWidth > m.clientWidth + 1; });
    check(`④ ${tag} 頁が横にはみ出さない`, !over, over);
    check(`${tag} 画面の失敗が無い`, errors.length === 0, errors);
    await p.context().close();
  }
} finally {
  await app.close();
}
console.log(fails.length ? `\n${fails.length} 件合いません` : "\nすべて合いました");
process.exit(fails.length ? 1 : 0);
