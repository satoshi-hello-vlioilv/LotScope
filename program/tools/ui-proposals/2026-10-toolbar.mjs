// 2026-10 件数の行（機能のボタン類の段）を、効いている物が増えても 1 段のままにする（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-toolbar.mjs --states crowded
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-toolbar.mjs --states crowded --view 1536x864
// 困りごと（利用者の声と、今の画面 crowded の画像から）:
//   ・まとめ 3 段＋並べ替え＋スライサーで選んだ値＋色付け＋書式で、件数の行が 3 段になる（2 段目が段と並べ替えの札、3 段目は拡大と頁送りだけ）。
//     一覧が約 90px 下がり、上の段（絞り込み）と合わせて道具の帯が 4 段の厚さになる
//   ・性質の違う物が 1 本に平たく並ぶ: いま効いている物の要約（まとめ・並べ替え・選んだ値・色付け・書式）／見方の切り替え（一覧｜集計・表・元データ）／
//     行き来（拡大・頁送り）。選んだ値・色付け・書式は、上の段のボタンにも数が出ていて 2 か所にある
//   ・段の札には「まとめて表示中」「全部開く」「全部畳む」「まとめない」まで並び、札 1 つの幅が広い
//
// 方向（何で解くか）: A 減らし方＝効いている物を「いまの表示 ▾」1 つに畳む（数の札だけ見せ、押すと全部の札の面）
// ／B 見せ方＝種類ごとに 1 つの圧縮した札（「まとめ 登録日時›設備›不良名 ▾」「並べ替え 重量▼ ▾」。長い名は省略）
// ／C 置き場＝2 か所にある物（選んだ値・色付け・書式）を外し、拡大・頁送りは表の下の帯へ
// ／D 優先度＝順に並べて入り切らない札は「ほか n ▾」へ（Priority+）
// ／E 流れ＝1 行のまま横に送る（はみ出しは横のスクロール・端に影）
// 5 案は「件数の行の中で、どう詰めるか」に偏る → 2 案を足す:
// F 階層＝種類のタブ（まとめ 3・並べ替え 1・選んだ値 2・色付け 1）を 1 行に並べ、押した種類だけ詳細の札を下に開く（2 階層の段階的開示）
// G 置き場（入口へ）＝効いている物の数を上の段の入口のボタンに載せ（表の見せ方に「まとめ 3・並べ 1」）、件数の行は件数・見方・表・頁だけ

const CROWD = `#llFormatNow,#llSlicerSum,#llMarkSum,#llGroupBar,#llSortBar`;
export const BASE = `
  .ll-status{flex-wrap:nowrap!important;overflow:hidden}
  .tb-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface);
    font:inherit;font-size:12.5px;font-weight:700;color:var(--ink);white-space:nowrap;cursor:pointer;max-width:260px}
  .tb-chip b{font-weight:800}.tb-chip .tb-el{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .tb-chip i{font-style:normal;color:var(--muted);font-size:11px}
  .tb-n{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:999px;font-size:11px;font-weight:800;color:#fff}
  .tb-lv{border-color:#9fcbc5;background:#eef8f6;color:#1f5f5a}.tb-lv .tb-n{background:#2f7d78}
  .tb-so{border-color:#c9d3f1;background:#f5f7fe;color:#30447f}.tb-so .tb-n{background:#4a62b0}
  .tb-sx{border-color:#cfe0ea;background:#f2f8fb;color:#2c5a73}.tb-sx .tb-n{background:#3d7ea6}
  .tb-mk{border-color:#efc7c2;background:#fdf2f1;color:#8a2f25}.tb-mk .tb-n{background:#c9564a}
  .tb-fm{border-color:#b9d9c9;background:#f1f9f5;color:#2d6a4f}.tb-fm .tb-n{background:#3f8f68}
  .tb-sum{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 10px;border:1px solid #b9c7d4;border-radius:8px;background:var(--surface);font:inherit;font-size:12.5px;font-weight:800;color:var(--ink);white-space:nowrap}
  .tb-sum .tb-chip{height:22px;padding:0 7px;cursor:default}
  .tb-x{border:0;background:transparent;color:inherit;font-size:13px;padding:0 0 0 2px;cursor:pointer}`;

/** 要素が出来るまで待って、何度描き直されても 1 つだけ置く（件数の行は描き直される） */
const keep = (id, html, where, anchor) => ["script", `
const put = () => { if (document.getElementById(${JSON.stringify(id)})) return; const a = document.querySelector(${JSON.stringify(anchor)}); if (!a) return;
  a.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)}); };
setInterval(put, 120); put();`];
const lv = `<button class="tb-chip tb-lv" title="まとめ: 登録日時 › 設備 › 不良名"><span class="tb-n">3</span><span class="tb-el">まとめ <b>登録日時 › 設備 › 不良名</b></span><i>▾</i></button>`;
const so = `<button class="tb-chip tb-so"><span class="tb-n">1</span>並べ替え <b>重量 ▼</b><i>▾</i></button>`;
const sx = `<button class="tb-chip tb-sx"><span class="tb-el">設備 <b>CR1・L-1</b></span><span class="tb-x" aria-label="外す">×</span></button>`;
const mk = `<button class="tb-chip tb-mk"><span class="tb-el">● 不良名 = 汚れ</span><b>43</b></button>`;
const fm = `<button class="tb-chip tb-fm">書式 <b>異常ロット表示</b><i>▾</i></button>`;

export const PROPOSALS = [
  { key: "now", name: "今の作り（効いている物が増えると件数の行が折り返して 3 段）", css: "", ops: [] },
  {
    key: "A", name: "減らし方: 効いている物を「いまの表示 ▾」1 つに畳む（数の札だけ・押すと全部の札の面）",
    css: BASE + `${CROWD}{display:none!important}`,
    ops: [keep("tbA", `<button id="tbA" class="tb-sum" title="押すと、まとめ・並べ替え・選んだ値・色付け・書式の札を全部出します（そこで外す・直す）">いまの表示
      <span class="tb-chip tb-lv"><span class="tb-n">3</span>まとめ</span><span class="tb-chip tb-so"><span class="tb-n">1</span>並べ替え</span>
      <span class="tb-chip tb-sx"><span class="tb-n">2</span>選んだ値</span><span class="tb-chip tb-mk"><span class="tb-n">1</span>色付け</span><span class="tb-chip tb-fm">書式</span><i>▾</i></button>`, "afterend", "#llFresh")],
  },
  {
    key: "B", name: "見せ方: 種類ごとに 1 つの圧縮した札（長い名は省略・押すとその種類の面）",
    css: BASE + `${CROWD}{display:none!important}`,
    ops: [keep("tbB", `<span id="tbB" style="display:inline-flex;gap:6px;min-width:0">${fm}${lv}${so}${sx}${mk}</span>`, "afterend", "#llFresh")],
  },
  {
    key: "C", name: "置き場: 2 か所にある物（選んだ値・色付け・書式）を外し、拡大・頁送りは表の下の帯へ",
    css: BASE + `#llFormatNow,#llSlicerSum,#llMarkSum{display:none!important}
      #llGroupBar .ll-gchip,#llGroupBar [data-gall],#llGroupBar [data-goff]{display:none!important}
      .tb-foot{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin:-8px 16px 8px;padding:4px 8px;border-top:1px solid var(--line)}`,
    ops: [["script", `const go = () => { const r = document.querySelector(".ll-statusright"), b = document.querySelector("#llBodyRow"); if (!r || !b) return setTimeout(go, 100);
        if (!document.querySelector(".tb-foot")) { const f = document.createElement("div"); f.className = "tb-foot"; b.after(f); f.append(r); } }; go();`],
      keep("tbC", `<button id="tbC" class="tb-chip" title="全部開く・全部畳む・まとめない">⋯</button>`, "beforeend", "#llGroupBar")],
  },
  {
    key: "D", name: "優先度: 順に並べ、入り切らない札は「ほか n ▾」へ（Priority+）",
    css: BASE + `#llSortBar,#llSlicerSum,#llMarkSum,#llFormatNow{display:none!important}
      #llGroupBar [data-gall],#llGroupBar [data-goff],#llGroupBar .ll-gadd{display:none!important}`,
    ops: [keep("tbD", `<button id="tbD" class="tb-chip" title="入り切らない札: 並べ替え・選んだ値・色付け・書式">ほか <b>4</b> ▾</button>`, "afterend", "#llSortBar")],
  },
  {
    key: "E", name: "流れ: 1 行のまま横に送る（はみ出しは横のスクロール・端に影と ◀▶）",
    css: BASE + `.tb-scroll{display:flex;align-items:center;gap:6px 12px;min-width:0;flex:1 1 auto!important;overflow-x:auto;scrollbar-width:none;
        -webkit-mask-image:linear-gradient(90deg,#000 92%,transparent);mask-image:linear-gradient(90deg,#000 92%,transparent)}
      .tb-scroll > *{flex-shrink:0;white-space:nowrap}.tb-arrow{flex:0 0 auto!important;width:26px;height:26px;border:1px solid var(--line);border-radius:6px;background:var(--surface)}`,
    ops: [["script", `const go = () => { const st = document.querySelector(".ll-status"), r = document.querySelector(".ll-statusright"), sw = document.querySelector("#llViewSwitch");
        if (!st || !r || !sw || !document.querySelector("#llGroupBar:not([hidden])")) return setTimeout(go, 120);
        if (document.querySelector(".tb-scroll")) return; const box = document.createElement("div"); box.className = "tb-scroll";
        [...st.children].filter((x) => x !== r && x.id !== "llCount" && x !== sw).forEach((x) => box.append(x)); st.insertBefore(box, r);
        const a = document.createElement("button"); a.className = "tb-arrow"; a.textContent = "▶"; st.insertBefore(a, r); }; go();`]],
  },
  {
    key: "F", name: "階層: 種類のタブ（まとめ 3・並べ替え 1・選んだ値 2・色付け 1・書式）を 1 行に、押した種類だけ詳細の札を下に開く",
    css: BASE + `${CROWD}{display:none!important}
      .tb-tabs{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
      .tb-tabs .tb-k{padding:0 10px;font-size:12px;color:var(--muted);font-weight:700}
      .tb-tabs .tb-chip{border:0;border-left:1px solid var(--line);border-radius:0;height:30px}`,
    ops: [keep("tbF", `<span id="tbF" class="tb-tabs"><span class="tb-k">効いている物</span>
      <button class="tb-chip tb-lv"><span class="tb-n">3</span>まとめ<i>▾</i></button><button class="tb-chip tb-so"><span class="tb-n">1</span>並べ替え<i>▾</i></button>
      <button class="tb-chip tb-sx"><span class="tb-n">2</span>選んだ値<i>▾</i></button><button class="tb-chip tb-mk"><span class="tb-n">1</span>色付け<i>▾</i></button>
      <button class="tb-chip tb-fm">書式<i>▾</i></button></span>`, "afterend", "#llFresh")],
  },
  {
    key: "G", name: "入口へ: 効いている物の数を上の段の入口のボタンに載せ、件数の行は件数・見方・表・頁だけ",
    css: BASE + `${CROWD}{display:none!important}
      .tb-badge{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;margin-left:4px;border-radius:999px;font-size:11px;font-weight:800;color:#fff}`,
    ops: [["script", `const go = () => { const v = document.querySelector("#llViewBtn"), f = document.querySelector("#llFormatBtn .fm-now"); if (!v) return setTimeout(go, 120);
        if (!v.querySelector(".tb-badge")) v.insertAdjacentHTML("beforeend", '<b class="tb-badge" style="background:#2f7d78">まとめ 3</b><b class="tb-badge" style="background:#4a62b0">並べ 1</b>');
        if (f && !f.textContent) f.textContent = "異常ロット表示"; }; setInterval(go, 200); go();`]],
  },
];
