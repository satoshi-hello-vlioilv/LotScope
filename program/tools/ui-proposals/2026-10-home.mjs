// 2026-10「初期画面（異常ロット一覧）を有料の製品の水準に」1 回目の 7 案（H1〜H5 ＋ 方向の違う H6・H7）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-home.mjs --states list,calc
//
// 今の画面で見えた困りごと（版 3.16.0・1728×1152）:
//   ・見出しの帯の右に、状態（データ元・接続・待機中）と操作（マスタ管理・アプリ・終了）と自分の区分が、同じ形の札で 7 つ並ぶ（どれが押せるか・何の状態か分からない）
//   ・頁の頭に「異常ロット一覧」（タブと同じ名前）と、70 字の説明の文がいつも出る（読む量。慣れた人には要らない）
//   ・「仕掛」の選択は何の選択か書いていない。元データの時刻の札は右端に離れている

const HINT = "ロット番号を押すと、計算へ移って取り込みます";

export const PROPOSALS = [
  { key: "H0", name: "今の形（基準）", css: "", ops: [] },
  {
    key: "H1", name: "磨き上げ（状態を 1 つの札にまとめる・頁の頭を 1 行に）",
    css: `
 .header-right{gap:6px}
 .hstat{display:flex;align-items:center;height:32px;padding:0 4px;border-radius:999px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.16)}
 .hstat .pill{border:0;background:transparent!important;padding:3px 10px;color:#dfe9f2;font-size:12.5px}
 .hstat .pill + .pill{border-left:1px solid rgba(255,255,255,.18);border-radius:0}
 .hstat #conn.conn-ok{color:#9ff0c8}
 .hsep{width:1px;height:22px;background:rgba(255,255,255,.22);margin:0 6px}
 #quitBtn{background:transparent;border-color:transparent;opacity:.85}
 .ll-head{padding:12px 18px 4px}
 .ll-title{display:flex;align-items:center;gap:14px}
 .ll-title p{display:none}
 .ll-title h2{font-size:17px}
 .hhint{font-size:12.5px;font-weight:600;color:var(--h-input);background:var(--input-soft);padding:3px 10px;border-radius:999px}
 .tlabel{font-size:12.5px;color:var(--muted);font-weight:700}
`,
    ops: [
      ["insert", '<span class="hstat" id="hstat"></span><i class="hsep"></i>', "afterbegin", ".header-right"],
      ["move", "#modeBadge", "append", "#hstat"], ["move", "#conn", "append", "#hstat"], ["move", "#status", "append", "#hstat"],
      ["insert", `<span class="hhint">${HINT}</span>`, "beforeend", ".ll-title"],
      ["insert", '<span class="tlabel">表</span>', "beforebegin", "#llTable"],
    ],
  },
  {
    key: "H2", name: "頁の頭を数の見出しに（件数を大きく）",
    css: `
 .ll-head{padding:16px 18px 6px;align-items:flex-end}
 .ll-title p{display:none}
 .ll-title{display:flex;align-items:baseline;flex-wrap:wrap;column-gap:18px}
 .ll-title h2{font-size:16px;color:var(--muted)}
 .ll-title #llCount{font-size:30px;font-weight:800;color:var(--ink);letter-spacing:.01em}
 .hcap{flex-basis:100%;font-size:12.5px;color:var(--muted);margin-top:2px}
`,
    ops: [["move", "#llCount", "append", ".ll-title"], ["insert", `<span class="hcap">${HINT}</span>`, "beforeend", ".ll-title"]],
  },
  {
    key: "H3", name: "左の縦のナビ（画面の切り替え・管理を左に）",
    css: `
 body{display:grid;grid-template-columns:88px minmax(0,1fr);grid-template-rows:var(--header-h) minmax(0,1fr)}
 header{grid-column:1/-1}
 .rail{grid-row:2;grid-column:1;display:flex;flex-direction:column;gap:6px;padding:12px 8px;background:#18304a}
 .rail .screen-tabs{flex-direction:column;margin:0;height:auto;align-self:stretch;gap:6px}
 .rail .screen-tab{flex-direction:column;height:auto;padding:12px 4px;border-radius:10px;font-size:12px;gap:6px;white-space:normal;text-align:center;line-height:1.25}
 .rail .screen-tab svg{width:22px;height:22px}
 .rail .screen-tab[aria-selected="true"]{background:#fff;color:var(--h-input)}
 .ll-screen,.layout{grid-column:2;grid-row:2}
 .rail-bottom{margin-top:auto;display:flex;flex-direction:column;gap:6px}
 .rail .btn-ghost.on-dark{height:auto;padding:8px 2px;font-size:12px;white-space:normal}
 .ll-title p{display:none}
`,
    ops: [
      ["insert", '<nav class="rail" id="rail"><div class="rail-bottom" id="railBottom"></div></nav>', "afterend", "header"],
      ["move", ".screen-tabs", "prepend", "#rail"], ["move", "#masterBtn", "append", "#railBottom"], ["move", "#appBtn", "append", "#railBottom"],
    ],
  },
  {
    key: "H4", name: "頁の頭を畳んで表を広く（元データ・表は件数の行へ）",
    css: `
 .ll-head{display:none}
 .ll-screen .generic-filter-bar{margin-top:12px}
 .ll-status .ll-table{height:26px;font-size:12.5px}
 .ll-status .ll-fresh{height:26px;font-size:12px}
 .ll-count{font-size:15px}
`,
    ops: [["move", "#llTable", "after", "#llCount"], ["move", "#llFresh", "after", "#llTable"]],
  },
  {
    key: "H5", name: "明るい見出しの帯（白地・下線のタブ）",
    css: `
 header{background:#fff;color:var(--ink);border-bottom:1px solid var(--line);box-shadow:0 1px 2px rgba(20,40,55,.05)}
 .brand .eyebrow{color:var(--h-input);opacity:.9}
 .ver-badge{color:var(--h-input);border-color:var(--line);background:var(--surface-3)}
 .brand h1{color:#1c3550}
 .screen-tabs{align-self:stretch;height:auto}
 .screen-tab{background:transparent;color:var(--muted);border-radius:0;height:var(--header-h);border-bottom:3px solid transparent}
 .screen-tab:hover{background:var(--surface-3);color:var(--ink)}
 .screen-tab[aria-selected="true"]{background:transparent;color:var(--h-input);border-bottom-color:var(--h-input)}
 .screen-tab small{background:var(--input-soft);color:var(--h-input)}
 .pill{border-color:var(--line);color:var(--ink)}
 .pill.conn-ok{background:var(--ok-soft);border-color:#bfe3cf;color:var(--ok-ink)}
 .me-chip{background:var(--surface-3);color:var(--ink)}
 .btn-ghost.on-dark{border-color:var(--line);color:var(--ink);background:#fff}
 .btn-ghost.on-dark:hover{background:var(--surface-3)}
 .quit{border-color:var(--line);background:#fff;color:var(--muted)}
 .ll-title p{display:none}
`,
    ops: [],
  },
  // ---- 5 案の方向: H1・H5 は見出しの帯の形と色、H2・H4 は頁の頭の形（量）、H3 は置き場（ナビの構え）。どれも「画面の枠の形」を変える案。
  //      偏りを崩す 2 案: H6 は「開いた時点で、データの要点（多い不良・設備）を先に出す（先回り）」、H7 は「状態を周辺（下の帯）へ追い出す」。
  {
    key: "H6", name: "要点のカードを先に出す（多い不良・設備・元データ）",
    css: `
 .ll-title p{display:none}
 .ins{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:8px 16px 0}
 .ins > div{border:1px solid var(--line);border-radius:10px;padding:9px 14px;background:var(--surface-1)}
 .ins small{display:block;color:var(--muted);font-size:12px;font-weight:700}
 .ins b{font-size:20px;font-weight:800;color:var(--ink)}
 .ins em{font-style:normal;color:var(--muted);font-size:12.5px;margin-left:6px}
 .ins .ll-fresh{margin-top:2px}
`,
    ops: [
      ["insert", '<div class="ins" id="ins"><div><small>件数</small><b data-k="n"></b></div><div><small>多い不良名（この頁）</small><b data-k="不良名"></b></div><div><small>多い設備（この頁）</small><b data-k="設備"></b></div><div id="insFresh"><small>元データ</small></div></div>', "afterend", ".ll-head"],
      ["move", "#llFresh", "append", "#insFresh"],
      ["script", `
        const paint = () => {
          const heads = [...document.querySelectorAll("#llHead th")].map((th) => th.textContent.replace("⠿", "").trim());   // 見出しの先頭は動かす取っ手（⠿）
          const rows = [...document.querySelectorAll("#llBody tr[data-i]")];
          document.querySelector('[data-k="n"]').textContent = document.querySelector("#llCount").textContent;
          for (const col of ["不良名", "設備"]) {
            const i = heads.findIndex((h) => h.startsWith(col)); if (i < 0) continue;
            const n = new Map(); rows.forEach((r) => { const v = r.children[i]?.textContent.trim(); if (v) n.set(v, (n.get(v) || 0) + 1); });
            const top = [...n].sort((a, b) => b[1] - a[1]).slice(0, 2);
            document.querySelector('[data-k="' + col + '"]').innerHTML = top.map(([v, c]) => v + "<em>" + c + " 件</em>").join("　");
          }
        };
        new MutationObserver(paint).observe(document.querySelector("#llBody"), { childList: true });
        paint();`],
    ],
  },
  {
    key: "H7", name: "状態を下の帯へ（見出しは名前・切り替え・操作だけ）",
    css: `
 .sbar{position:fixed;left:0;right:0;bottom:0;height:30px;display:flex;align-items:center;gap:2px;padding:0 12px;background:#f7f9fb;border-top:1px solid var(--line);z-index:5}
 .sbar .pill{border:0;background:transparent!important;color:var(--muted)!important;padding:2px 10px;font-size:12px}
 .sbar .pill + .pill,.sbar .ll-fresh{border-left:1px solid var(--line)!important;border-radius:0}
 .sbar #conn.conn-ok{color:var(--ok-ink)!important}
 .sbar .ll-fresh{height:22px;border:0;background:transparent;font-size:12px;color:var(--muted);font-weight:600}
 .sbar .me-chip{margin-left:auto;color:var(--ink)!important;font-weight:700}
 .ll-screen,.layout{height:calc(100vh - var(--header-h) - 30px)}
 .ll-title p{display:none}
`,
    ops: [
      ["insert", '<footer class="sbar" id="sbar"></footer>', "beforeend", "body"],
      ["move", "#conn", "append", "#sbar"], ["move", "#status", "append", "#sbar"], ["move", "#modeBadge", "append", "#sbar"],
      ["move", "#llFresh", "append", "#sbar"], ["move", "#meChip", "append", "#sbar"],
    ],
  },
];
