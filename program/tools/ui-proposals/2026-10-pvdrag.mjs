// 2026-10-22 集計の組み替え（D&D）と値ごとの計算（版 3.50.0。利用者の要望 1・2）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvdrag.mjs --states worklog-pivot,worklog-pivot-dnd --from worklog
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pvdrag.mjs --states dash-panel --from dash
// 今の画像で見えた問題: 文の札（作業日・ロット数・重量）は × で外すしか無く、引けそうな手がかりが無い。一覧の集計表の値には計算の置き場が無い。
//   ダッシュボードの「計算」は ④ 書式の奥にパネル全体で 1 つ（値が 2 つあると両方に当たる・合わせた表では出ない）
// 土台（全案）: 札を引いて並べ替え・行 ⇔ 列・カラムの札から置く・欄へ戻して外す（pivot-dnd.js。引いている間は影・置ける枠の色・差し込む線）。
//   計算は値ごと（measures の expr。サーバーで表し方の前に当てる）。案は「引けることの見せ方」と「計算の置き場」を変える
// 案の方向:
//   A 札の左に ⋮⋮ のつまみ（引ける印）＋ 値の札の「ƒx」→ 札の下に小さな面（式の欄・よく使う札・変わり方）… 置き場: 札から開く面
//   B つまみ無し（札そのものを掴む）＋ 値の札の中に短い計算の欄（いつも見える）… 置き場: 札の中
//   C つまみ＋ 文のすぐ下に「値の計算」の段（値ごとに 欄・札・変わり方を並べる）＋ 行 ⇔ 列を一度で入れ替える ⇄ … 置き場: 別の段（まとまり）
//   D つまみ＋ 札の ▾ で開く 1 つのメニュー（集計のしかた・表し方・計算・並び・外す）。札には計算の印「÷1000」… 置き場: 札のメニューに集める
//   E つまみ＋ 結果の表の値の見出しに「ƒx」（出た数を見ながら、その列の見出しで直す）… 置き場: 結果の上（直接さわる）
let seq = 0;
const watch = (sel, fn) => { const k = `pd${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
// 計算を入れた値の札（一覧: 重量・ダッシュボード: ロット数）。見本の数は、いまの表の総計から
const TARGET = `(c) => { const n = (c.querySelector("b") || {}).textContent || ""; return /重量/.test(n) || (c.closest("#dbEditor") && /ロット数/.test(n)); }`;
const EXPR = `(c) => (c.closest("#dbEditor") ? "÷10" : "÷1000")`;
const PREV = `(c) => (c.closest("#dbEditor") ? "1,200 → 120" : "1,186,104 → 1,186.1")`;
const GRIP = `.pv-chip[data-dnd-role]::before{content:"";width:6px;height:12px;margin:0 2px 0 -4px;flex:none;opacity:.75;background:radial-gradient(circle,#fff 1.1px,transparent 1.3px) 0 0/3px 4px}`;
const POP = `.mk-pop{position:absolute;z-index:30;width:300px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 10px 26px rgba(20,40,60,.18);font-size:12.5px;color:var(--ink)}
  .mk-pop b{display:block;margin-bottom:6px;font-size:12.5px}.mk-pop .mk-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
  .mk-in{height:28px;width:120px;padding:0 8px;border:1px solid var(--edit-line,#c9d3dc);border-radius:7px;font:13px ui-monospace,Consolas,monospace;background:var(--edit-field,#fffdf6)}
  .mk-c{height:24px;padding:0 8px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font:12px ui-monospace,Consolas,monospace;color:var(--ink)}
  .mk-prev{display:inline-flex;gap:6px;padding:2px 10px;border-radius:999px;background:var(--ll-pale);color:var(--ll-teal-dark);font-weight:700;font-variant-numeric:tabular-nums}
  .mk-hint{color:var(--muted);font-size:11.5px}`;
const BADGE = `.mk-badge{white-space:nowrap;flex:none;display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;background:rgba(255,255,255,.92);color:#6b4a10;font:700 11.5px ui-monospace,Consolas,monospace}`;
const popHtml = `'<div class="mk-pop" role="dialog"><b>' + (c.querySelector("b").textContent) + ' の計算</b><div class="mk-row"><input class="mk-in" value="' + (${EXPR})(c) + '"><span class="mk-prev">' + (${PREV})(c) + '</span></div>'
  + '<div class="mk-row"><span class="mk-hint">よく使う:</span><button class="mk-c">÷1000</button><button class="mk-c">×100</button><button class="mk-c">÷60</button><button class="mk-c">×1.08</button></div>'
  + '<div class="mk-row mk-hint">演算子から書くと前に値が入ります（÷1000 ＝ 値÷1000）。空にすると計算なし</div></div>'`;
const POP_E = `'<div class="mk-pop" role="dialog"><b>重量の合計 の計算</b><div class="mk-row"><input class="mk-in" value="÷1000"><span class="mk-prev">1,186,104 → 1,186.1</span></div>'
  + '<div class="mk-row"><span class="mk-hint">よく使う:</span><button class="mk-c">÷1000</button><button class="mk-c">×100</button><button class="mk-c">÷60</button><button class="mk-c">×1.08</button></div>'
  + '<div class="mk-row mk-hint">演算子から書くと前に値が入ります（÷1000 ＝ 値÷1000）。空にすると計算なし</div></div>'`;
export const PROPOSALS = [
  {
    key: "A", name: "A つまみ ⋮⋮ ＋ 値の札の ƒx から小さな面",
    css: GRIP + POP + `.mk-fx{white-space:nowrap;flex:none;height:20px;min-width:20px;padding:0 5px;border:0;border-radius:5px;background:rgba(255,255,255,.92);color:#6b4a10;font:700 11.5px ui-monospace,Consolas,monospace;cursor:pointer}.pv-sent,.de-sent{position:relative}`,
    ops: [watch(".pv-chip.v", `(c) => { const on = (${TARGET})(c); const x = c.querySelector("button:last-of-type"); x.insertAdjacentHTML("beforebegin", '<button class="mk-fx" title="値の計算（四則演算）">' + (on ? "ƒx " + (${EXPR})(c) : "ƒx") + '</button>');
      if (on && !document.querySelector(".mk-pop")) { const s = c.closest(".pv-sent"); const r = c.getBoundingClientRect(), sr = s.getBoundingClientRect(); s.insertAdjacentHTML("beforeend", ${popHtml}); const pop = s.lastElementChild; pop.style.left = Math.min(r.left - sr.left, sr.width - 310) + "px"; pop.style.top = (r.bottom - sr.top + 6) + "px"; } }`)],
  },
  {
    key: "B", name: "B 札そのものを掴む ＋ 値の札の中に短い計算の欄",
    css: `.mk-cin{flex:none;height:20px;width:62px;padding:0 5px;border:0;border-radius:5px;background:rgba(255,255,255,.92);color:var(--ink);font:12px ui-monospace,Consolas,monospace}.mk-cin::placeholder{color:#8a8f96}
      .pv-chip[data-dnd-role]:hover{transform:translateY(-1px);box-shadow:0 3px 8px rgba(20,40,60,.25)}`,
    ops: [watch(".pv-chip.v", `(c) => { const on = (${TARGET})(c); c.querySelector("button:last-of-type").insertAdjacentHTML("beforebegin", '<input class="mk-cin" placeholder="計算" title="値の計算（÷1000・×100 など）" value="' + (on ? (${EXPR})(c) : "") + '">'); }`),
      watch(".pv-cap small", `(s) => { s.textContent = "札を押すか、上の文へ引くと入ります。文の札は掴んで並べ替え・行と列の入れ替え（ここへ戻すと外れます）"; }`)],
  },
  {
    key: "C", name: "C つまみ ＋ 文の下に「値の計算」の段 ＋ 行 ⇔ 列の ⇄",
    css: GRIP + POP + `.mk-band{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:6px;padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:var(--pv-val-bg)}
      .mk-band > b{font-size:12px;color:#6b4a10}.mk-v{display:inline-flex;align-items:center;gap:6px;font-size:12.5px}.mk-v .mk-in{width:86px;height:26px}
      .mk-swap{height:24px;min-width:26px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink);font-size:13px;cursor:pointer}`,
    ops: [watch(".pv-sent", `(s) => { const vals = [...s.querySelectorAll(".pv-chip.v")]; if (!vals.length) return;
        const rows = s.querySelector('.pv-slot[data-role="rows"]'); if (rows && s.querySelector('.pv-slot[data-role="cols"]')) rows.nextElementSibling.insertAdjacentHTML("afterend", '<button class="mk-swap" title="行と列を入れ替える">⇄</button>');
        s.insertAdjacentHTML("afterend", '<div class="mk-band"><b>値の計算</b>' + vals.map((c) => { const on = (${TARGET})(c); return '<span class="mk-v">' + c.querySelector("b").textContent + '<input class="mk-in" placeholder="例: ÷1000" value="' + (on ? (${EXPR})(c) : "") + '">' + (on ? '<span class="mk-prev">' + (${PREV})(c) + '</span>' : "") + '</span>'; }).join("")
          + '<span class="mk-hint">よく使う: ÷1000・×100・÷60</span></div>'); }`)],
  },
  {
    key: "D", name: "D つまみ ＋ 札の ▾ で 1 つのメニュー（集計・表し方・計算・並び・外す）",
    css: GRIP + POP + BADGE + `.mk-dd{width:20px;height:20px;border:0;border-radius:50%;background:rgba(255,255,255,.25);color:#fff;font-size:11px;cursor:pointer}.pv-sent,.de-sent{position:relative}
      .mk-menu{width:270px}.mk-menu .mk-sec{margin-top:8px;padding-top:8px;border-top:1px solid var(--line-soft,#e4e9ee)}.mk-menu .mk-k{display:block;margin-bottom:4px;color:var(--muted);font-size:11.5px;font-weight:700}
      .mk-seg{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}.mk-seg span{padding:3px 8px;font-size:12px}.mk-seg span.on{background:var(--pv-val);color:#fff}`,
    ops: [watch(".pv-chip.v", `(c) => { const on = (${TARGET})(c); c.querySelectorAll("select").forEach((x) => (x.style.display = "none"));
        c.querySelector("button:last-of-type").insertAdjacentHTML("beforebegin", (on ? '<span class="mk-badge">' + (${EXPR})(c) + '</span>' : "") + '<button class="mk-dd" title="集計のしかた・表し方・計算・並び">▾</button>');
        if (on && !document.querySelector(".mk-pop")) { const s = c.closest(".pv-sent"); const r = c.getBoundingClientRect(), sr = s.getBoundingClientRect();
          s.insertAdjacentHTML("beforeend", '<div class="mk-pop mk-menu"><b>' + c.querySelector("b").textContent + '</b>' + (/ロット数|件数/.test(c.querySelector("b").textContent) ? '<div>' : '<span class="mk-k">集計のしかた</span><span class="mk-seg"><span class="on">合計</span><span>平均</span><span>最小</span><span>最大</span><span>…</span></span><div class="mk-sec">') + '<span class="mk-k">計算</span><div class="mk-row"><input class="mk-in" value="' + (${EXPR})(c) + '"><span class="mk-prev">' + (${PREV})(c) + '</span></div><div class="mk-row"><button class="mk-c">÷1000</button><button class="mk-c">×100</button><button class="mk-c">÷60</button></div></div>'
            + '<div class="mk-sec"><span class="mk-k">表し方</span><span class="mk-seg"><span class="on">そのまま</span><span>%</span><span>累計</span><span>差</span><span>順位</span></span></div>'
            + '<div class="mk-sec mk-row"><button class="mk-c">◀ 前へ</button><button class="mk-c">後へ ▶</button><span class="mk-hint">（引いても並べ替え）</span></div></div>');
          const pop = s.lastElementChild; pop.style.left = Math.min(r.left - sr.left, sr.width - 280) + "px"; pop.style.top = (r.bottom - sr.top + 6) + "px"; } }`)],
  },
  {
    key: "E", name: "E つまみ ＋ 結果の表の値の見出しの ƒx で直す（札には印）",
    css: GRIP + POP + BADGE + `.mk-hfx{display:inline-flex;align-items:center;margin-left:6px;height:20px;padding:0 6px;border:1px solid rgba(255,255,255,.55);border-radius:5px;color:#fff;font:700 11.5px ui-monospace,Consolas,monospace;cursor:pointer}
      .pv-tablebox{position:relative}.dp-body,.db-pb{position:relative}`,
    ops: [watch(".pv-chip.v", `(c) => { if ((${TARGET})(c)) c.querySelector("button:last-of-type").insertAdjacentHTML("beforebegin", '<span class="mk-badge">' + (${EXPR})(c) + '</span>'); }`),
      watch("#llPivot .pv-table th.pv-mh, #llPivot .pv-table th.pv-gt", `(th) => { const t = th.textContent; if (/重量/.test(t)) { th.insertAdjacentHTML("beforeend", '<span class="mk-hfx">ƒx ÷1000</span>'); if (!document.querySelector(".mk-pop")) { const box = th.closest(".pv-tablebox"); const r = th.getBoundingClientRect(), br = box.getBoundingClientRect();
        box.insertAdjacentHTML("beforeend", ${POP_E}); const pop = box.lastElementChild; pop.style.left = Math.max(0, r.right - br.left - 310) + "px"; pop.style.top = (r.bottom - br.top + 4) + "px"; } }
        else if (/ロット数/.test(t)) th.insertAdjacentHTML("beforeend", '<span class="mk-hfx">ƒx</span>'); }`)],
  },
];
