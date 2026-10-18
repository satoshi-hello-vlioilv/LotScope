// 2026-10-18 一覧の列を値で絞る・ダッシュボードの絞る の 2 回目（版 3.45.0。利用者の要望 1・5・6）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-colfilter-2.mjs --states list-colfilter,dash-filter   （1536x864・1280x720 でも）
// 1 回目（2026-10-colfilter.json）: 1 位 C 75.8 点（Excel の順: 検索→値→条件）で届かず。全案に残った減点と低い項目:
//   ダッシュボードの絞る面は 1280 で値のチェックが面の下に隠れる（要らないスクロール）・設備（枠のカードの格子・「すべての設備」）と値（帯の行・「（すべて選択）」）で形と言葉が違う（統一感 14）・
//   見出しの ▼ が乗せるまで見えず探させる（B はいつも出したが、列名が 6 か所切れた）
// 2 回目の土台（全案に入れた）: 面の中は C の順（並べ替え→検索→値のチェック→条件で絞る）。ダッシュボードの絞る面は 設備・期間・値と条件 を畳める段にし、
//   開くのは 1 つ（畳んだ段の見出しにいまの選びの要約）。設備も同じ「値で絞る」の部品（（すべて選択）・件数の帯）。
// 案の方向（▼ を探させない・列名を切らない の解き方）:
//   A2 見せ方（▼ は乗せた時と絞っている列。件数の行に「列の見出しの ▼ で値を選んで絞れます」の一言）。持ち越し＋一言
//   B2 見せ方（見出しの右下の角に小さな ▾ をいつも淡く。列名の幅は取らない）。新しい
//   C2 置き場（見出しの下に「絞る」の細い段: 列ごとの ▾ がいつも見える。Excel のフィルタの行の形）。新しい
//   D2 置き場（道具の行の「列で絞り込む」を「▾ 列の値で絞る」にして入口を 1 つ見せる）。新しい
//   E2 見せ方（列名の後ろに余りがある見出しだけ ▼ を淡くいつも出す。狭い列は乗せた時だけ）。新しい
let seq = 0;
const watch = (sel, fn) => { const k = `cg${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const HINT = `.cf-hint{display:inline-flex;align-items:center;gap:4px;margin-left:10px;padding:2px 8px;border-radius:999px;background:var(--ll-pale);color:var(--ll-teal-dark);font-size:12.5px;white-space:nowrap}.cf-hint svg{width:11px;height:11px;fill:currentColor}`;
export const PROPOSALS = [
  {
    key: "A", name: "A2 ▼は乗せた時と絞っている列＋件数の行に一言（土台: Excel の順・畳める段）",
    css: HINT + `#llCardHint{display:none!important}`,
    ops: [watch("#llCardHint", `(h) => h.insertAdjacentHTML("afterend", '<span class="cf-hint"><svg viewBox="0 0 16 16"><path d="M2.5 3h11l-4.2 5.2V13l-2.6-1.4V8.2z"/></svg>列の見出しの ▼ で値を選んで絞れます</span>')`)],
  },
  {
    key: "B", name: "B2 見出しの右下の角に小さな ▾ をいつも淡く（列名の幅は取らない）",
    css: `.ll-grid thead th .th-filter{opacity:.55;top:auto;bottom:1px;right:9px;transform:none;width:13px;height:13px;background:transparent!important;border-radius:3px}
      .ll-grid thead th .th-filter svg{width:9px;height:9px}.ll-grid thead th .th-filter.on{opacity:1;background:#fff!important}.ll-grid thead th:hover .th-filter{opacity:1}
      .ll-grid thead th:has(.th-filter.on) > .th-in{padding-right:0}`,
    ops: [],
  },
  {
    key: "C", name: "C2 見出しの下に「絞る」の細い段（列ごとの ▾ がいつも見える）",
    css: `.ll-grid thead tr.cf-frow th{top:var(--cf-top,34px);height:20px;padding:0 4px;background:#e9eff3!important;color:var(--h-meta);border-bottom:1px solid var(--line);font-size:11.5px;font-weight:600;text-align:right;cursor:pointer}
      .ll-grid thead tr.cf-frow th.on{background:var(--ll-pale)!important;color:var(--ll-teal-dark)}.ll-grid thead tr.cf-frow th span{display:inline-flex;align-items:center;gap:3px}
      .ll-grid thead tr:first-child th .th-filter{opacity:0!important}`,
    ops: [watch("#llHead tr:first-child", `(tr) => { const h = tr.getBoundingClientRect().height; tr.parentElement.style.setProperty("--cf-top", h + "px");
      const row = document.createElement("tr"); row.className = "cf-frow";
      row.innerHTML = [...tr.children].map((th) => '<th class="' + (th.querySelector(".th-filter.on") ? "on" : "") + '"><span>' + (th.querySelector(".th-filter.on") ? "絞り中 " : "") + '▾</span></th>').join(""); tr.after(row); }`)],
  },
  {
    key: "D", name: "D2 道具の行の入口を「▾ 列の値で絞る」に（入口を 1 つ見せる）",
    css: `#llAdhocToggle.cf-entry{font-weight:700;color:var(--ll-teal-dark);border-color:#9fd3cb;background:var(--ll-pale)}`,
    ops: [watch("#llAdhocToggle", `(b) => { b.classList.add("cf-entry"); b.textContent = "▾ 列の値で絞る"; b.title = "列を選んで、値にチェックを入れて絞ります（列の見出しの ▼ と同じ面）"; }`)],
  },
  {
    key: "E", name: "E2 列名の後ろに余りがある見出しだけ ▼ を淡くいつも出す",
    css: `.ll-grid thead th.cf-room .th-filter{opacity:.6}.ll-grid thead th.cf-room .th-filter.on,.ll-grid thead th:hover .th-filter{opacity:1}`,
    ops: [watch("#llHead tr:first-child", `(tr) => [...tr.children].forEach((th) => { const s = th.querySelector(".th-in > span"); if (s && s.scrollWidth + 34 <= th.clientWidth - 8) th.classList.add("cf-room"); })`)],
  },
];
