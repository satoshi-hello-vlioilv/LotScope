// 2026-10 並べ替えの見え方・外し方と、条件＋並べ替えをまとめて保存・読み出す所（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sortview.mjs --states sorted,headers
// 困りごと（利用者の声と、今の画面の画像から）:
//   ・見出しを押すと ▲ → ▼ → ▲ と回るだけで、並べ替えを外せない（外す所は「表の見せ方」の奥の「その中の並び」だけ）
//   ・効いている並べ替えが、見出しの細い印でしか分からない（まとめの段は件数の行に札があるのに、並べ替えには無い）
//   ・「プリセット」は条件だけを覚える。並べ替えを含めて名前を付けて保存し、呼び出す所が無い
// どの案も、見出しの 3 回目の押下で並べ替えを外す（▲ → ▼ → 外す。不具合の直し）は同じ。
//
// 方向（何で解くか）: A 置き場＝件数の行に並べ替えの札（まとめの段の札と同じ形）＋プリセットに「条件と並べ替えを保存」
// ／B 置き場＝道具の行に専用の「並べ替え」の入口（数の札・開くと一覧と保存）／C 見せ方＝見出しの印を番号の札で強め、
// 保存は「表示の設定」の中に／D 流れ＝「条件」の面に並べ替えの区画を足し、条件と並べ替えを 1 つの組として保存
// ／E 減らし方＝プリセットを「見方」（条件・並べ替え・まとめ・スライサー）に置き換える
// 5 案は「札・面をどこに置くか」に偏る → 2 案を足す: F 見せ方＝保存した見方を道具の行の下に札で並べ、1 押しで切り替える
// （探させない・思い出させない）／G 流れ＝保存しなくても戻れる「戻す・やり直す」と、最近の見方の履歴（保存は履歴からピン留め）

export const BASE = `
  .sv-bar{display:inline-flex;align-items:center;gap:6px}
  .sv-key{padding:2px 10px;border-radius:999px;background:#eef1fb;color:#3a4f8f;font-size:12.5px;font-weight:800;white-space:nowrap}
  .sv-chip{display:inline-flex;align-items:center;gap:3px;height:26px;padding:0 3px 0 4px;border:1px solid #c9d3f1;border-radius:999px;background:#f5f7fe;color:#30447f;font-size:12.5px;font-weight:800}
  .sv-n{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;background:#4a62b0;color:#fff;font-size:11px;margin-right:2px}
  .sv-chip button{height:20px;min-width:20px;padding:0 4px;border:0;border-radius:999px;background:transparent;color:#30447f;font-size:12px;cursor:pointer}
  .sv-btn{height:26px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);font-size:12.5px;padding:0 9px;font-family:inherit}
  .sv-pop{position:fixed;z-index:80;background:#fff;border:1px solid #cfd9e3;border-radius:10px;box-shadow:0 18px 44px rgba(20,40,60,.22);padding:10px;font-size:13px;width:440px}
  .sv-pop h5{margin:4px 4px 6px;font-size:12px;color:#5d6b78;font-weight:800;display:flex;gap:8px;align-items:baseline}
  .sv-pop h5 small{font-weight:500;color:#7a8692}
  .sv-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px}
  .sv-row:hover{background:#f2f5f8}.sv-row span{flex:1;min-width:0}.sv-row b{color:#16505a}
  .sv-row small{color:#6b7680;font-size:11.5px;white-space:nowrap}
  .sv-row.is-cur{background:#e8f4f2}
  .sv-mark{width:14px;height:14px;border-radius:50%;border:2px solid #9fb0bf;flex:0 0 auto}
  .sv-row.is-cur .sv-mark{border-color:#2f7d78;box-shadow:inset 0 0 0 2px #fff,inset 0 0 0 12px #2f7d78}
  .sv-save{display:block;width:100%;margin-top:6px;padding:7px 10px;border:1px dashed #b9c7d4;border-radius:7px;background:#fafcfd;color:#3f6591;font-weight:700;text-align:left;font-family:inherit;font-size:13px}
  .sv-sep{height:1px;background:#e3e8ee;margin:8px 0}
  .sv-sort{display:flex;align-items:center;gap:6px;padding:5px 8px}
  .sv-sort .sv-seg{display:inline-flex;border:1px solid #cfd9e3;border-radius:6px;overflow:hidden}
  .sv-sort .sv-seg i{font-style:normal;padding:2px 8px;font-size:12px}.sv-sort .sv-seg i.on{background:#e6ecfa;color:#30447f;font-weight:800}
  .sv-what{display:flex;flex-wrap:wrap;gap:4px;margin:2px 8px 6px}
  .sv-what i{font-style:normal;font-size:11.5px;padding:1px 7px;border-radius:999px;background:#eef2f5;color:#4b5966}`;

/** 要素が出来るまで待って、何度描き直されても 1 つだけ置く（件数の行・道具の行は描き直される） */
export const keep = (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)}); };
setInterval(put, 120); put();`];
/** 道具の近くに面（ポップオーバー）を開いた形で置く（一覧が出てから） */
export const pop = (html, anchor, dx = 0) => ["script", `
const go = () => { const el = document.querySelector(${JSON.stringify(anchor)}); if (!el || !document.querySelector("#llBody tr[data-i]")) return setTimeout(go, 150);
  const a = el.getBoundingClientRect(); document.querySelectorAll(".sv-pop").forEach((x) => x.remove());
  document.body.insertAdjacentHTML("beforeend", '<div class="sv-pop" style="left:' + (a.left + ${dx}) + 'px;top:' + (a.bottom + 6) + 'px">' + ${JSON.stringify(html)} + '</div>'); };
setTimeout(go, 900);`];

export const CHIPS = `<span class="sv-bar" id="svSortBar"><span class="sv-key" title="見出しを押した並べ替え">並べ替え</span>`
  + `<span class="sv-chip"><b class="sv-n">1</b>重量<button>▼</button><button>×</button></span><i class="ll-gsep">›</i>`
  + `<span class="sv-chip"><b class="sv-n">2</b>板厚<button>▲</button><button>×</button></span><button class="sv-btn">並べ替えを外す</button></span>`;
export const VIEWS = (cur = 1) => [["不良あり・重い順", "条件 1・並べ替え 2"], ["CR1 の今月", "条件 2・スライサー 1"], ["検査待ち（新しい順）", "条件 1・並べ替え 1・まとめ 1"]]
  .map(([n, w], i) => `<div class="sv-row${i + 1 === cur ? " is-cur" : ""}"><i class="sv-mark"></i><span><b>${n}</b></span><small>${w}</small></div>`).join("");
export const SAVE = (what) => `<button class="sv-save">＋ いまの${what}を名前を付けて保存…</button>`;
const SORTLIST = `<div class="sv-sort"><b class="sv-n">1</b><span style="flex:1">重量</span><span class="sv-seg"><i>▲ 小さい順</i><i class="on">▼ 大きい順</i></span><button class="sv-btn">×</button></div>`
  + `<div class="sv-sort"><b class="sv-n">2</b><span style="flex:1">板厚</span><span class="sv-seg"><i class="on">▲ 小さい順</i><i>▼ 大きい順</i></span><button class="sv-btn">×</button></div>`;

export const PROPOSALS = [
  { key: "now", name: "今の作り（見出しは ▲⇄▼ だけ・外すのは表の見せ方の奥・プリセットは条件だけ）", css: "", ops: [] },
  {
    key: "A", name: "件数の行に並べ替えの札（段の札と同じ形）＋プリセットに「条件と並べ替えを保存」",
    css: BASE, ops: [keep("svSortBar", CHIPS, "beforebegin", "#llGroupBar"),
      pop(`<h5>プリセット<small>押すと、条件と並べ替えがその形に入れ替わります</small></h5><div class="sv-row"><i class="sv-mark"></i><span><b>なし</b></span></div>${VIEWS()}<div class="sv-sep"></div>${SAVE("条件と並べ替え")}`, "#llPresetBtn")],
  },
  {
    key: "B", name: "道具の行に専用の「並べ替え ②」（開くと一覧・外す・保存）",
    css: BASE + ".sv-entry{display:inline-flex;align-items:center;gap:6px;font-weight:700}.sv-entry b{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:999px;background:#4a62b0;color:#fff;font-size:12px}",
    ops: [keep("svEntry", `<button id="svEntry" class="sv-entry">⇅ 並べ替え <b>2</b> ▾</button>`, "afterend", "#llCondBtn"),
      pop(`<h5>並べ替え<small>見出しを押しても足せます（Shift で 2 つ目）</small></h5>${SORTLIST}<div class="sv-sort"><button class="sv-btn">全部外す</button></div><div class="sv-sep"></div><h5>保存した並べ替えと条件</h5>${VIEWS()}${SAVE("条件と並べ替え")}`, "#llCondBtn", 90)],
  },
  {
    key: "C", name: "見出しの印を番号の札で強める＋保存は「表示の設定」の中",
    css: BASE + `#llHead th[data-sort]{box-shadow:inset 0 -4px 0 #6b84d6}
      #llHead th[data-sort="desc"]::after,#llHead th[data-sort="asc"]::after{display:inline-grid;place-items:center;margin-left:4px;padding:0 5px;height:18px;border-radius:5px;background:#e6ecfa;color:#30447f;font-size:11px;font-weight:800}
      #llHead th[data-sort="desc"]::after{content:"①▼"}#llHead th[data-sort="asc"]::after{content:"②▲"}`,
    ops: [pop(`<h5>表示の設定</h5><div class="sv-row"><span><b>書き出し…</b></span></div><div class="sv-row"><span><b>読み込み…</b></span></div><div class="sv-sep"></div><h5>保存した見方<small>条件・並べ替え</small></h5>${VIEWS()}${SAVE("条件と並べ替え")}`, "#llProfileBtn", -260)],
  },
  {
    key: "D", name: "「条件」の面に並べ替えの区画（条件と並べ替えを 1 つの組で保存）",
    css: BASE + ".fb-cond-btn .sv-also{color:#30447f;font-weight:800;margin-left:2px}",
    ops: [keep("svAlso", `<span id="svAlso" class="sv-also">・並べ替え 2</span>`, "afterend", "#llCondCount"),
      pop(`<h5>効いている条件（1）</h5><div class="sv-row"><span><b>不良名</b> 空欄以外</span><small>×</small></div><div class="sv-sep"></div><h5>並べ替え（2）<small>見出しの 3 回目でも外せます</small></h5>${SORTLIST}`
        + `<div class="sv-sep"></div>${SAVE("条件と並べ替え")}<div class="sv-row"><span>条件を全部外す</span></div><div class="sv-row"><span>並べ替えを全部外す</span></div>`, "#llCondBtn")],
  },
  {
    key: "E", name: "プリセットを「見方」に置き換え（条件・並べ替え・まとめ・スライサーをまるごと）",
    css: BASE, ops: [["script", `const go = () => { const k = document.querySelector("#llPresetBtn .fb-preset-key"); if (!k) return setTimeout(go, 100); k.textContent = "見方"; document.querySelector("#llPresetName").textContent = "不良あり・重い順"; }; go();`],
      pop(`<h5>見方<small>押すと、条件・並べ替え・まとめ・スライサーがその形になります</small></h5><div class="sv-row"><i class="sv-mark"></i><span><b>何も絞らない・元の順</b></span></div>${VIEWS()}`
        + `<div class="sv-what"><i>条件 1</i><i>並べ替え 2</i><i>まとめ なし</i><i>スライサー なし</i></div>${SAVE("見方")}<div class="sv-row"><span>見方を直す・消す…</span></div>`, "#llPresetBtn")],
  },
  {
    key: "F", name: "保存した見方を道具の行の下に札で並べ、1 押しで切り替える",
    css: BASE + `.sv-shelf{display:flex;align-items:center;gap:6px;padding:6px 18px 0;flex-wrap:wrap}
      .sv-tab{height:28px;padding:0 12px;border:1px solid #cfd9e3;border-radius:999px;background:#fff;font-weight:700;font-size:12.5px;color:#30404f;font-family:inherit}
      .sv-tab.is-cur{background:#2f7d78;border-color:#2f7d78;color:#fff}.sv-tab small{font-weight:500;opacity:.8;margin-left:4px}
      .sv-tab.add{border-style:dashed;color:#3f6591;background:#fafcfd}`,
    ops: [keep("svShelf", `<div id="svShelf" class="sv-shelf"><span class="sv-key" style="background:#e8f4f2;color:#1d5f5a">見方</span>`
      + `<button class="sv-tab">元の順</button><button class="sv-tab is-cur">不良あり・重い順<small>条件1・並べ替え2</small></button><button class="sv-tab">CR1 の今月</button><button class="sv-tab">検査待ち（新しい順）</button>`
      + `<button class="sv-tab add">＋ いまの見方を保存</button></div>`, "afterend", "#llFilterBar"),
    keep("svSortBar", CHIPS, "beforebegin", "#llGroupBar")],
  },
  {
    key: "G", name: "戻す・やり直す＋最近の見方の履歴（保存は履歴からピン留め）",
    css: BASE + ".sv-undo{display:inline-flex;gap:2px}.sv-undo button{height:34px;width:34px;border:1px solid var(--line);border-radius:7px;background:#fff;font-size:16px}",
    ops: [keep("svUndo", `<span id="svUndo" class="sv-undo"><button title="1 つ前の条件・並べ替えに戻す">↶</button><button title="やり直す">↷</button><button title="最近の見方">🕘</button></span>`, "beforebegin", "#llPresetBtn"),
      keep("svSortBar", CHIPS, "beforebegin", "#llGroupBar"),
      pop(`<h5>最近の見方<small>条件・並べ替えを変えるたびに自動で残ります（☆で保存）</small></h5>`
        + `<div class="sv-row is-cur"><span><b>不良名 空欄以外</b>・重量▼・板厚▲</span><small>いま ☆</small></div><div class="sv-row"><span><b>不良名 空欄以外</b>・重量▼</span><small>1 分前 ☆</small></div><div class="sv-row"><span>（条件なし）・重量▲</span><small>3 分前 ☆</small></div>`
        + `<div class="sv-sep"></div><h5>保存した見方（☆）</h5>${VIEWS(0)}`, "#llPresetBtn", -80)],
  },
];
