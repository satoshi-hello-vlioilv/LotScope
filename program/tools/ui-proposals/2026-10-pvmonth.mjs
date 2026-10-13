// 2026-10 集計表・グラフ: 月ごと（年月）・月で区切る・月を選んで ◀ ▶ で送る・数値ラベル・組み方のプリセット（共通／ID・標準）の置き場（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvmonth.mjs --states worklog-pivot [--view 1536x864]
// 利用者の要望: グラフを月ごとに出す・月ごとに区切る・数値のラベルを出す。組み方は共通（全員）と ID（ログイン ID ごと）に登録でき、
// 標準のプリセットを作れる（ID の標準があればそれ、無ければ共通の標準）。月で区切る＝日のグラフに月の境目の線と月の名前＋表に月の小計、
// と、月を 1 つ選んで ◀ ▶ で送る、の両方。
// どの案も、グラフと表は本物（月で区切る・数値ラベルを実際に入れた状態: LotListPivot.setState）。案ごとに違うのは操作の置き場と見せ方だけ。
//
// 方向（何で解くか）: A 置き場＝グラフの形の行に、数値・月で区切る・月の ◀▶・組み方 ▾ を並べる
// ／B 置き場を役割で分ける＝月で区切るは表にも効くので文の小計・総計の横、数値と月の ◀▶ はグラフの枠の見出し、組み方は「すぐに見る」の札と同じ行の札
// ／C 減らし方＝グラフの設定を「表示 ▾」1 つに畳み、組み方も「組み方 ▾」1 つ
// ／D 流れ＝日の札から: 作業日の札のまとめ方に「日（月で区切る）」、月の ◀▶ は札のすぐ後ろ、組み方は左の面のタブ
// ／E 見せ方＝月をタブの帯で並べ（◀ すべて 6月 7月 … ▶）、押すだけで選ぶ。数値・月で区切るは押し込むボタン
// 5 案は「グラフの操作をどこに置くか」に寄る → 組み方の入口を変えた 2 案を足す:
// F 常に見せる＝左の面の上に組み方の一覧（標準★・共通／自分）を出したまま（探させない・思い出させない）
// G 統合＝道具の行の「プリセット ▾」（保存した見方）に集計の組み方も入れ、入口を増やさない

// 差し込む物は id の付いた包み（display:contents）に入れ、包みがあれば入れ直さない（描き直しで消えたら入れ直す）
const KEEP = (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(`<span id="${id}" style="display:contents">${html}</span>`)}); };
setInterval(put, 120); put();`];
// 本物の状態: 月で区切る・数値ラベルを入れる（集計表が出たら 1 回）
const REAL = ["script", `
const go = () => { const P = window.LotListPivot; if (!P || !P.on() || !document.querySelector("#llPivot .pv-table")) return;
  const s = P.stateOf(); if (s.split && s.labels) return; P.setState({ ...s, split: true, labels: true }); };
setInterval(go, 200);`];

export const CSS = `
  .mx-ck{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:12.5px;font-weight:700;color:var(--ink);white-space:nowrap}
  .mx-ck input{margin:0;accent-color:var(--h-input)}
  .mx-on{background:color-mix(in srgb,var(--h-input) 12%,var(--surface));border-color:var(--h-input);color:var(--h-input)}
  .mx-nav{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);height:30px}
  .mx-nav button{border:0;background:transparent;width:28px;height:30px;font-size:12px;color:var(--h-input);cursor:pointer}
  .mx-nav button:disabled{color:#b8c2cb}
  .mx-nav span{padding:0 10px;font-size:12.5px;font-weight:700;border-inline:1px solid var(--line);line-height:30px;min-width:6.5em;text-align:center;white-space:nowrap}
  .mx-pre{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:12.5px;font-weight:700;white-space:nowrap;max-width:300px}
  .mx-pre .mx-pn{overflow:hidden;text-overflow:ellipsis;font-weight:400}
  .mx-star{color:#b5822a}
  .mx-k{font-size:12px;color:var(--muted);font-weight:700;white-space:nowrap}
  .mx-chip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:12.5px;white-space:nowrap}
  .mx-chip.is-std{border-color:#b5822a;background:#fbf4e6}
  .mx-chip small{color:var(--muted);font-size:11px}
  .mx-add{border-style:dashed;color:var(--h-input);font-weight:700}
  .mx-strip{display:flex;align-items:center;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);width:max-content}
  .mx-strip button{border:0;border-left:1px solid var(--line);background:transparent;height:30px;padding:0 14px;font:inherit;font-size:12.5px;font-weight:700;color:var(--muted)}
  .mx-strip button:first-child{border-left:0}
  .mx-strip button.on{background:var(--h-input);color:#fff}
  .mx-side{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:8px;margin-bottom:8px;display:flex;flex-direction:column;gap:4px}
  .mx-side .mx-h{display:flex;justify-content:space-between;align-items:baseline}
  .mx-side .mx-g{font-size:11px;color:var(--muted);font-weight:700;margin-top:4px}
  .mx-side .mx-it{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;font-size:12.5px;border:1px solid transparent}
  .mx-side .mx-it.is-std{background:#fbf4e6;border-color:#e8d3a6}
  .mx-side .mx-it span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mx-ftabs{display:flex;border-bottom:1px solid var(--line);margin:-2px 0 6px}
  .mx-ftabs b{padding:4px 12px;font-size:13px;color:var(--muted)}
  .mx-ftabs b.on{color:var(--h-input);box-shadow:inset 0 -3px 0 var(--h-input)}
`;
const LBL = (id) => `<label id="${id}" class="mx-ck mx-on"><input type="checkbox" checked>数値ラベル</label>`;
const SPL = (id) => `<label id="${id}" class="mx-ck mx-on"><input type="checkbox" checked>月で区切る</label>`;
const NAV = (id, cls = "") => `<span id="${id}" class="mx-nav ${cls}" title="月を 1 つ選ぶ（◀ ▶ で前後の月へ）"><button disabled>◀</button><span>すべての月 ▾</span><button>▶</button></span>`;
const PRE = (id) => `<button id="${id}" class="mx-pre" title="組み方（共通・自分）を呼ぶ・保存する"><span class="mx-star">★</span>組み方<span class="mx-pn">作業日ごとのロット数・重量（標準）</span>▾</button>`;
const SIDE = (id) => `<div id="${id}" class="mx-side"><div class="mx-h"><b>組み方</b><small class="pv-link">＋ 今の形を保存</small></div>`
  + `<div class="mx-g">自分（taro）</div><div class="mx-it is-std"><span class="mx-star">★</span><span>月ごとの重量（標準）</span></div><div class="mx-it"><span>日×直のロット数</span></div>`
  + `<div class="mx-g">共通</div><div class="mx-it"><span class="mx-star">☆</span><span>作業日ごとのロット数・重量</span></div><div class="mx-it"><span>重量のヒストグラム</span></div></div>`;

export const PROPOSALS = [
  { key: "A", name: "置き場: グラフの形の行に全部（数値・月で区切る・月 ◀▶・組み方 ▾）", css: CSS,
    ops: [REAL, KEEP("mxA1", LBL("mxA1a") + SPL("mxA1b") + NAV("mxA1c"), "afterend", "#llPivot .pv-tabs"), KEEP("mxA2", PRE("mxA2"), "beforeend", "#llPivot .pv-bar")] },
  { key: "B", name: "役割で分ける: 月で区切るは文の小計の横・数値と月 ◀▶ はグラフの見出し・組み方は札の行", css: CSS + `.pv-chead .mx-nav{margin-left:auto}`,
    ops: [REAL, KEEP("mxB1", SPL("mxB1"), "beforebegin", '#llPivot .pv-sent [data-pv-opt="sub"]'),
      KEEP("mxB2", LBL("mxB2a") + NAV("mxB2b"), "beforeend", "#llPivot .pv-chead"),
      KEEP("mxB3", `<span id="mxB3" style="display:contents"><span class="mx-k">組み方:</span><span class="mx-chip is-std"><span class="mx-star">★</span>月ごとの重量 <small>自分</small></span><span class="mx-chip">日×直のロット数 <small>自分</small></span><span class="mx-chip">作業日ごとのロット数・重量 <small>共通</small></span><span class="mx-chip mx-add">＋ 保存 ▾</span></span>`, "beforeend", "#llPivot .pv-bar")] },
  { key: "C", name: "減らし方: 「表示 ▾」1 つと「組み方 ▾」1 つに畳む", css: CSS,
    ops: [REAL, KEEP("mxC1", `<button id="mxC1" class="mx-pre">表示<span class="mx-pn">数値・月で区切る・すべての月</span>▾</button>`, "afterend", "#llPivot .pv-tabs"),
      KEEP("mxC2", PRE("mxC2"), "afterbegin", "#llPivot .pv-sent")] },
  { key: "D", name: "流れ: 日の札から（まとめ方に「日（月で区切る）」・札のすぐ後ろに月 ◀▶）・組み方は左の面のタブ", css: CSS,
    ops: [REAL, ["script", `setInterval(() => { const o = document.querySelector('#llPivot .pv-slot[data-role="rows"] select option[value=""]'); if (o && o.textContent !== "日（月で区切る）") o.textContent = "日（月で区切る）"; }, 120);`],
      KEEP("mxD1", NAV("mxD1"), "afterend", '#llPivot .pv-slot[data-role="rows"]'), KEEP("mxD2", LBL("mxD2"), "afterend", "#llPivot .pv-tabs"),
      KEEP("mxD3", `<div id="mxD3" class="mx-ftabs"><b class="on">カラム</b><b>組み方 4</b></div>`, "afterbegin", "#llPivot .pv-fields")] },
  { key: "E", name: "見せ方: 月をタブの帯で並べる（◀ すべて 6月 … 10月 ▶）・押し込むボタン・組み方は Excel の横", css: CSS,
    ops: [REAL, KEEP("mxE1", LBL("mxE1a").replace('type="checkbox" checked', 'type="checkbox" checked hidden') + SPL("mxE1b").replace('type="checkbox" checked', 'type="checkbox" checked hidden'), "afterend", "#llPivot .pv-tabs"),
      KEEP("mxE2", `<div id="mxE2" class="mx-strip"><button>◀</button><button class="on">すべての月</button><button>6月</button><button>7月</button><button>8月</button><button>9月</button><button>10月</button><button>▶</button></div>`, "beforeend", "#llPivot .pv-bar"),
      KEEP("mxE3", PRE("mxE3"), "beforebegin", "#llPivot .pv-sent [data-pv-xlsx]")] },
  { key: "F", name: "常に見せる: 左の面の上に組み方の一覧（★標準・自分／共通）", css: CSS,
    ops: [REAL, KEEP("mxF1", LBL("mxF1a") + SPL("mxF1b") + NAV("mxF1c"), "afterend", "#llPivot .pv-tabs"), KEEP("mxF2", SIDE("mxF2"), "afterbegin", "#llPivot .pv-fields")] },
  { key: "G", name: "統合: 道具の行の「プリセット ▾」に集計の組み方も入れる・グラフの操作はグラフの見出し", css: CSS + `.pv-chead .mx-ck:first-of-type{margin-left:auto}`,
    ops: [REAL, KEEP("mxG1", LBL("mxG1a") + SPL("mxG1b") + NAV("mxG1c"), "beforeend", "#llPivot .pv-chead"),
      ["script", `setInterval(() => { const b = document.querySelector("#llPresetBtn"); if (b) { const n = document.querySelector("#llPresetName"); if (n) n.textContent = "★ 月ごとの重量（集計の組み方）"; } }, 120);`]] },
];
