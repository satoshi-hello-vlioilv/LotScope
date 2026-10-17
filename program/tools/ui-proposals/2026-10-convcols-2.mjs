// 2026-10-17 変換表の入力の「当てる列」（版 3.44.0。利用者の要望 3）の 2 回目（1 回目は 1 位 A 79.2 点で合格点 80 点に届かず。2026-10-convcols.json）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-convcols-2.mjs --states master-conv-cols   （1280x720 でも）
// 1 回目の採点で低かった所: 面がマスタ管理の窓の右・下へ出る（整列 6）・説明が題と同じ強さ（階層 7）・1280 で各段に 4 件ほどしか見えない・
//   同じ名前の列が 3 段に別々に出て、同じ列だと結び付かない
// 持ち越し（A2）: A に、窓の中に収める・説明を短く従の調子・探す欄と選んだ列を 1 段に（列の並びを高く）・同じ名前の列にほかのデータの印、を足した（作った物）
// 新しい案（何で解くか）:
//   F 置き場（右の引き出し）: マスタ管理の窓の右端に、上から下までの縦長の面。データ元の段は縦に重ねる（縦に長く見える）
//   G 見せ方（表）: 行＝列の名前・列＝データ元の表に ✓（どの名前がどのデータに有るかを 1 枚で）
//   H 減らし方（データ元のタブ）: データ元をタブで 1 つずつ。1 つのデータの列を 2 列に並べて多く見せる
//   I 流れの変え方（選んだ列を左に）: 左に選んだ列の縦の並び（当たる順）、右に探す欄とデータ元の段
let seq = 0;
const watch = (sel, fn) => { const k = `c2${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A2", name: "A2 窓の中の浮かぶ面・データ元の段＋同じ名前の印（作った物）", css: "", ops: [] },
  {
    key: "F", name: "F 窓の右端の縦長の引き出し",
    css: `.cv-colpop{width:470px!important}.cv-colpop > .cv-cpsrcs{display:flex!important;flex-direction:column;gap:10px;overflow:auto}.cv-cpsrcs .cv-cpsrc{flex:none;min-height:auto}.cv-cpsrcs .cv-cplist{flex:none;max-height:none;overflow:visible}
      .cv-cpbar{flex-direction:column}.cv-cpbar .cv-cpq{flex:none}`,
    ops: [watch(".cv-colpop", `(el) => { const go = () => { const m = document.querySelector("#masterOverlay .master-panel").getBoundingClientRect();
      Object.assign(el.style, { left: (m.right - 470 - 1) + "px", top: (m.top + 56) + "px", maxHeight: (m.height - 57) + "px", height: (m.height - 57) + "px", borderRadius: "0 0 12px 0" }); };
      go(); new MutationObserver(go).observe(el, { attributes: true, attributeFilter: ["style"] }); }`)],
  },
  {
    key: "G", name: "G 表（行＝列の名前・列＝データ元に ✓）",
    css: `.c2-mx{border-collapse:collapse;width:100%;font-size:12.5px}.c2-mx th,.c2-mx td{padding:3px 8px;border-bottom:1px solid var(--line-soft);text-align:center}.c2-mx th:first-child,.c2-mx td:first-child{text-align:left}
      .c2-mx thead th{position:sticky;top:0;background:var(--surface);border-bottom:2px solid var(--line)}.c2-mx thead th i{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--c);margin-right:4px}
      .c2-mx td.on{color:var(--h-input);font-weight:800}.c2-mx td.off{color:#c3ccd4}.cv-cpsrcs.c2-wrap{display:block;overflow:auto}`,
    ops: [watch(".cv-cpsrcs", `(box) => { const secs = [...box.querySelectorAll(".cv-cpsrc")]; if (!secs.length) return;
      const heads = secs.map((s) => ({ c: s.style.getPropertyValue("--c"), n: s.querySelector("h5").childNodes[1].textContent.trim(), cols: new Set([...s.querySelectorAll(".cv-cpi b")].map((b) => b.firstChild.textContent)) }));
      const names = [...new Set(heads.flatMap((h) => [...h.cols]))];
      box.className = "cv-cpsrcs c2-wrap";
      box.innerHTML = '<table class="c2-mx"><thead><tr><th>列の名前</th>' + heads.map((h) => '<th style="--c:' + h.c + '"><i></i>' + h.n + '</th>').join("") + '</tr></thead><tbody>'
        + names.map((n) => '<tr><td><label><input type="checkbox"> <b>' + n + '</b></label></td>' + heads.map((h) => h.cols.has(n) ? '<td class="on">✓</td>' : '<td class="off">–</td>').join("") + '</tr>').join("") + '</tbody></table>'; }`)],
  },
  {
    key: "H", name: "H データ元のタブ（1 つずつ・2 列に並べる）",
    css: `.c2-tabs{display:flex;gap:4px;border-bottom:2px solid var(--line)}.c2-tabs span{padding:6px 14px;border-radius:8px 8px 0 0;font-size:13px;font-weight:700;color:var(--muted);display:flex;gap:6px;align-items:center}
      .c2-tabs span i{width:9px;height:9px;border-radius:50%;background:var(--c)}.c2-tabs span.on{color:var(--ink);background:#eef3f8;box-shadow:inset 0 -3px 0 var(--c)}
      .cv-cpsrcs.c2-one{grid-template-columns:1fr!important}.c2-one .cv-cpsrc:not(:first-child){display:none}.c2-one .cv-cpsrc h5{display:none}.c2-one .cv-cplist{display:grid;grid-template-columns:1fr 1fr;align-content:start;column-gap:12px}`,
    ops: [watch(".cv-cpsrcs", `(box) => { const secs = [...box.querySelectorAll(".cv-cpsrc")]; if (!secs.length) return; box.classList.add("c2-one");
      box.insertAdjacentHTML("beforebegin", '<div class="c2-tabs">' + secs.map((s, i) => '<span class="' + (i ? "" : "on") + '" style="--c:' + s.style.getPropertyValue("--c") + '"><i></i>' + s.querySelector("h5").childNodes[1].textContent.trim() + ' <small>' + s.querySelectorAll(".cv-cpi").length + '</small></span>').join("") + '</div>'); }`)],
  },
  {
    key: "I", name: "I 左に選んだ列の縦の並び・右に探す欄とデータ元",
    css: `.cv-colpop.c2-two{display:grid!important;grid-template-columns:220px minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;column-gap:12px}
      .c2-two .cv-cphead{grid-column:1/-1}.c2-two .cv-cpchosen{grid-column:1;grid-row:2/5;flex-direction:column;align-items:stretch;justify-content:flex-start;border-radius:8px}
      .c2-two .cv-cpchosen .cv-alias{height:28px;justify-content:space-between}.c2-two .cv-cpq{grid-column:2;grid-row:2}.c2-two .cv-cpsrcs{grid-column:2;grid-row:3;grid-template-columns:repeat(3,minmax(0,1fr))!important;min-height:0}.c2-two .cv-cpfoot{grid-column:2;grid-row:4}`,
    ops: [watch(".cv-cpbar", `(bar) => { const pop = bar.closest(".cv-colpop"); const q = bar.querySelector(".cv-cpq"), ch = bar.querySelector(".cv-cpchosen"); pop.insertBefore(ch, bar); pop.insertBefore(q, bar); bar.remove(); pop.classList.add("c2-two"); }`)],
  },
];
