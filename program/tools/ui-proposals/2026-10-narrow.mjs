// 2026-10 表示の下限を広げる（フル HD・150% の 1280×720 でも崩れない）。版 3.32.0。決め方は CLAUDE.md（別のエージェントが撮って採点・95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-narrow.mjs --view 1280x720 --states list,crowded,worklog-many,calc3d
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-narrow.mjs --states list,worklog-many,calc3d        （利用者の PC でも崩さない）
// 利用者の声: 画面が小さい・拡大率が大きい PC が増えた。ボタンの幅が足らず見切れ・はみ出し、3D の模型と解説文の被り、設備が増えると 1 段の段が 2 段以上。
// 今の画面（1280×720 で撮った画像と ui-eval-narrow.mjs の数）:
//   見出し帯: 右の「マスタ管理」「アプリ」「終了」の字が縦に折れる。ロットを取り込むと（計算のタブにロット番号）「アプリ」「終了」が画面の外へ出て押せない
//   道具の行: 11 個のボタンが入りきらず、右端の「Excel に出力」が枠の外で切れる（検索の欄を縮めても、まだ約 80px 足りない）
//   設備のタブ: 24 台で 2 段になる（1 段は 12 台ほど）。並べ替えの案内の字も場所を取る
//   3D: 凡例が模型の上に重なって 3〜4 段に折れ、模型の下半分を覆う。札（全長・内径・テール…）どうしが重なって読めない
// 直す前に済ませた不具合（どの案でも同じ。案の比べには入れない）: 見出し帯のボタンの字を折らない／道具の行の右の組が中身より細く縮まない／
//   カードの窓が見出し帯を覆わない／巻取の列の「自動」の印を ▾ に重ねない
//
// 方向（何で解くか）:
// A 省く＝狭いときは字を短くする（副題を畳む・「データ元:」を省く・「表示の設定」→「設定」など）。設備は 1 段のまま横に送る（◀ ▶）。3D は凡例を「凡例」の札に畳み、重なる札は大事な方を残す
// B しまう＝入りきらない物を「⋯」「ほか N ▾」にしまう（見出し帯の開発者・マスタ管理・アプリ、道具の行の後ろの物、入りきらない設備）。3D の凡例は頭の行のボタンから出す
// C 置き場を変える＝状態（データ元・接続・待機中）を窓の下の帯へ、Excel を件数の行へ。設備は表の左に縦の一覧。3D の凡例は左のメニューの下へ
// D 構造＝画面のタブを左の縦のレールへ（見出し帯を無くす。ダッシュボードなど画面が増えても縦に足せる）。道具の行は絵だけのボタン。設備は横に送る。凡例は右の説明へ
// E 詰める＝狭いときは字と余白を 1 段小さく（全体を 0.9 倍の密度）。設備のタブも詰める。3D の札・凡例も小さく
// 5 案は「1 段に収める」に寄る → 方向の違う 2 案を足す:
// F 2 段を許す＝狭いときは見出し帯を 2 段・道具の行を「絞る｜見せる」の 2 段に整えて折る。設備も 2 段を整えて見せる。凡例は 3D の下の帯
// G 先回り（文脈で出す）＝その画面で使う物だけを見出し帯に出す（計算の画面ではロットの札と状態、一覧では件数）。道具の行はいま効いている物と主の 4 つだけを出し、残りは「道具 ▾」。
//   設備は「いま・前に見た・並びの近く」を出し、残りは検索できる面。3D は札を見ている工程の物だけ・凡例は初めの 1 回だけ出す

const MEDIA = "@media (max-width:1440px)";

export const KIT = ["script", `
(() => {
  if (window.__nw) return;
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const prio = (el) => el.matches(".title.active") ? 0 : el.matches(".red,.title.origin,.title.found") ? 1 : el.matches(".title") ? 2 : el.matches(".off,.edge") ? 3 : el.matches(".flow") ? 4 : 5;
  window.__nw = {
    $, $$,
    /** 案の部品を入れる（描き直しで消えたら入れ直す） */
    mount(key, build) { const run = () => { try { build(); } catch (_) {} }; run(); setInterval(run, 250); },
    /** 3D の札の重なりをほどく: 大事な札（見ている工程の名・赤）から置き、重なる札・枠の外の札・凡例に重なる札は隠す */
    declutter(avoidLegend = true) {
      setInterval(() => {
        const st = $("#explainStage"); if (!st) return;
        const sr = st.getBoundingClientRect();
        const lg = avoidLegend ? [...st.querySelectorAll(".x-legend")].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect()) : [];
        const labels = [...st.querySelectorAll(".x-label")].filter((x) => x.style.display !== "none");
        labels.forEach((x) => x.classList.remove("nw-hide"));
        const kept = [...lg];
        const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        labels.sort((a, b) => prio(a) - prio(b)).forEach((x) => {
          const r = x.getBoundingClientRect();
          const out = r.left < sr.left || r.right > sr.right || r.top < sr.top || r.bottom > sr.bottom;
          if (out || kept.some((k) => hit(r, k))) x.classList.add("nw-hide"); else kept.push(r);
        });
      }, 120);
    },
  };
})();`];

const BASE_CSS = `
  .x-label.nw-hide{visibility:hidden!important}
  .nw-btn{height:30px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;font-weight:700;padding:0 10px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
  .nw-dark{height:32px;border:1px solid var(--on-dark-line);border-radius:8px;background:var(--on-dark-fill);color:#fff;font:inherit;font-size:12.5px;font-weight:700;padding:0 12px;white-space:nowrap}
  .nw-n{display:inline-grid;place-items:center;min-width:1.5em;height:1.4em;border-radius:999px;background:var(--surface-4);color:var(--muted);font-size:11px;font-weight:800;padding:0 .35em}
  .nw-arrow{flex:none;width:26px;height:30px;margin-bottom:4px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--h-input);font-weight:800}
  .nw-fade{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 18px,#000 calc(100% - 18px),transparent);mask-image:linear-gradient(90deg,transparent 0,#000 18px,#000 calc(100% - 18px),transparent)}
`;
const LEGEND_CHIP = `.x-legend{right:auto!important;max-width:calc(100% - 20px);flex-wrap:nowrap!important;padding:3px 10px!important}
  .x-legend > span{display:none!important}
  .x-legend::before{content:"凡例 ▸（色と形の意味）";font-weight:700;color:var(--h-xfer);font-size:12px}`;
// 設備のタブを 1 段で横に送る（◀ ▶・端をぼかす）
const EQUIP_SCROLL = `.eq-chips{flex-wrap:nowrap!important;overflow:hidden;scroll-behavior:smooth}
  .eq-hint{display:none!important}`;
const equipArrows = (key) => ["script", `window.__nw.mount("${key}", () => { const X = window.__nw, box = X.$("#llEquipBar .eq-chips");
  if (!box || box.parentElement.querySelector("[data-nw=${key}]")) return;
  box.classList.add("nw-fade"); box.scrollLeft = 0;
  box.insertAdjacentHTML("beforebegin", '<button class="nw-arrow" data-nw="${key}" title="前の設備へ" disabled style="opacity:.4">◀</button>');
  box.insertAdjacentHTML("afterend", '<button class="nw-arrow" data-nw="${key}" title="次の設備へ（ほか 12 台）">▶</button>'); });`];

export const PROPOSALS = [
  { key: "0", name: "今（不具合だけ直した。比べるための土台。案ではない）", css: "", ops: [] },
  {
    key: "A", name: "省く: 狭いときは字を短く・設備は横に送る・凡例は札に畳む",
    css: BASE_CSS + `${MEDIA}{
      .brand h1 .brand-sub,.brand .eyebrow{display:none}
      .screen-tab{padding:0 12px}
      .screen-tabs{margin-left:16px}
      .header-right{gap:6px}
      #llFilterBar .filter-search-row{gap:6px}
      ${EQUIP_SCROLL}
    }
    ${LEGEND_CHIP}`,
    ops: [KIT, ["script", `window.__nw.mount("A", () => { const X = window.__nw;
      const m = X.$("#modeBadge"); if (m && !m.dataset.nw && innerWidth <= 1440) { m.dataset.nw = 1; m.title = m.textContent; m.textContent = m.textContent.replace(/^データ元:\\s*/, ""); }
      const set = (sel, t) => { const b = X.$(sel); if (b && innerWidth <= 1440 && !b.dataset.nw) { b.dataset.nw = 1; b.title = (b.title ? b.title + "\\n" : "") + b.textContent.trim();
        [...b.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).forEach((n) => { n.textContent = t; }); } };
      set("#llAdhocToggle", "列で絞る"); set("#llViewBtn", "見せ方 ▾"); set("#llProfileBtn", "設定 ▾"); set("#llExcelBtn", "Excel");
      const pk = X.$("#llPresetBtn .fb-preset-key"); if (pk && innerWidth <= 1440 && X.$("#llPresetName")?.textContent === "なし") { X.$("#llPresetName").style.display = "none"; }
    });`], equipArrows("A"), ["script", "window.__nw.declutter()"]],
  },
  {
    key: "B", name: "しまう: 入りきらない物を ⋯・その他・ほか N に",
    css: BASE_CSS + `${MEDIA}{
      .brand h1 .brand-sub{display:none}
      #meChip,#masterBtn,#appBtn,.hsep{display:none!important}
      #llProfileBtn,#llExcelBtn{display:none!important}
      .eq-hint{display:none!important}
      .eq-chips{flex-wrap:nowrap!important;overflow:hidden}
    }
    .x-legend{display:none!important}`,
    ops: [KIT, ["script", `window.__nw.mount("B", () => { const X = window.__nw; if (innerWidth > 1440) return;
      if (!X.$("[data-nw=B-more]")) X.$("#quitBtn").insertAdjacentHTML("beforebegin", '<button class="nw-dark" data-nw="B-more" title="開発者（権限）・マスタ管理・アプリ">⋯ メニュー</button>');
      const row = X.$("#llFilterBar .filter-search-row-actions"); if (row && !X.$("[data-nw=B-tools]")) X.$("#llViewBtn").insertAdjacentHTML("afterend", '<button class="nw-btn" data-nw="B-tools" title="表示の設定・Excel に出力">その他 <span class="nw-n">2</span> ▾</button>');
      const chips = X.$$("#llEquipBar .eq-chip"); if (chips.length > 14 && !X.$("[data-nw=B-eq]")) { chips.slice(13).forEach((c) => { if (c.getAttribute("aria-selected") !== "true") c.style.display = "none"; });
        X.$("#llEquipBar .eq-chips").insertAdjacentHTML("afterend", '<button class="nw-btn" data-nw="B-eq" style="margin-bottom:4px">ほか ' + (chips.length - 13) + ' 台 ▾</button>'); }
      const h = X.$("#explain .explain-h"); if (h && !X.$("[data-nw=B-lg]")) X.$("#explainTextToggle")?.insertAdjacentHTML("beforebegin", '<button class="nw-btn" data-nw="B-lg" style="height:28px">凡例 ▾</button>');
    });`], ["script", "window.__nw.declutter(false)"]],
  },
  {
    key: "C", name: "置き場を変える: 状態は下の帯・Excel は件数の行・設備は左の一覧",
    css: BASE_CSS + `
      body{--foot:26px}
      .hstat,.hsep{display:none!important}
      .ll-screen,.layout{height:calc(100vh - var(--header-h) - var(--foot))!important}
      .nw-foot{position:fixed;left:0;right:0;bottom:0;height:var(--foot);display:flex;align-items:center;gap:16px;padding:0 16px;background:#dfe7ec;border-top:1px solid var(--line);font-size:12px;color:var(--muted);z-index:40}
      .nw-foot b{color:var(--ink);font-weight:700}.nw-foot .ok{color:var(--ok);font-weight:800}
      #llExcelBtn{display:none!important}
      .nw-xl{height:28px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ok);font:inherit;font-size:12.5px;font-weight:800;padding:0 10px;white-space:nowrap}
      ${MEDIA}{ .brand h1 .brand-sub{display:none} }
      #lotListScreen .ll-panel{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto auto auto 1fr}
      #lotListScreen .ll-panel > *{grid-column:2}
      #llEquipBar:not([hidden]){grid-column:1;grid-row:1 / -1;flex-direction:column;align-items:stretch;gap:2px;padding:10px 8px;width:118px;border-bottom:0;border-right:1px solid var(--line);overflow:auto}
      #llEquipBar .eq-chips{flex-direction:column;flex-wrap:nowrap!important;gap:1px}
      #llEquipBar .eq-chip{height:26px!important;border-radius:6px!important;border:0!important;margin:0!important;text-align:left;box-shadow:none!important}
      #llEquipBar .eq-chip[aria-selected=true]{background:var(--ll-teal)!important;color:#fff!important}
      #llEquipBar .eq-lab{padding:0 4px 4px}
      #llEquipBar .eq-hint{display:none!important}
      #llEquipBar .eq-manage{margin:6px 0 0;order:9}
      .explain-menu .nw-lg{margin-top:auto;font-size:10.5px;color:var(--muted);display:grid;gap:3px;padding:6px 4px 0;border-top:1px solid var(--line-soft)}
      .x-legend{display:none!important}`,
    ops: [KIT, ["script", `window.__nw.mount("C", () => { const X = window.__nw;
      if (!X.$(".nw-foot")) document.body.insertAdjacentHTML("beforeend", '<div class="nw-foot"><span>データ元 <b>LotDsp（直接）</b></span><span>接続 <span class="ok">●</span></span><span>待機中</span><span style="margin-left:auto">QUALITY ANALYSIS ' + (X.$("#verBadge")?.textContent || "") + '</span></div>');
      const pg = X.$("#lotListScreen .ll-pager"); if (pg && !X.$("[data-nw=C-xl]")) pg.insertAdjacentHTML("afterend", '<button class="nw-xl" data-nw="C-xl" title="Excel に出力">⤓ Excel</button>');
      const menu = X.$("#explainMenu"); if (menu && menu.children.length && !menu.querySelector(".nw-lg")) menu.insertAdjacentHTML("beforeend", '<div class="nw-lg"><b>凡例</b><span>❙❙ 汚れ（2 か所）</span><span>↻ 1 周して写る</span><span>▭ その工程のオフ</span><span>┄ 間隔の広がり</span></div>');
    });`], ["script", "window.__nw.declutter(false)"]],
  },
  {
    key: "D", name: "縦のレール: 画面のタブを左へ（見出し帯を無くす）・道具は絵のボタン",
    css: BASE_CSS + `
      body{display:grid;grid-template-columns:76px minmax(0,1fr);--header-h:0px}
      body > header{grid-row:1 / span 9;height:100vh!important;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:10px 6px;gap:10px}
      body > header .brand{text-align:center}.brand .eyebrow{display:none}.brand h1{font-size:13px!important;justify-content:center}.brand h1 .brand-sub{display:none}
      .screen-tabs{flex-direction:column;margin:8px 0 0!important;height:auto!important;gap:4px;align-self:stretch}
      .screen-tab{flex-direction:column;height:auto!important;padding:8px 2px!important;border-radius:9px!important;font-size:11px!important;gap:3px!important;text-align:center;white-space:normal!important;line-height:1.25}
      .screen-tab svg{width:20px!important;height:20px!important}
      .screen-tab small{font-size:9.5px!important;padding:0 4px!important}
      .header-right{flex-direction:column;margin-top:auto;gap:6px!important}
      .hstat{flex-direction:column;height:auto!important;border-radius:10px!important;padding:4px 0!important}
      .hstat .pill{border:0!important;font-size:10.5px!important;padding:2px 4px!important;white-space:normal!important;text-align:center}
      #modeBadge{display:none}.hsep{display:none}
      .header-right > button{font-size:11px!important;padding:0 4px!important;height:28px!important;width:64px}
      #lotListScreen,#calcScreen{grid-column:2}
      .ll-screen,.layout{height:100vh!important}
      #llColBtn,#llViewBtn,#llProfileBtn,#llExcelBtn,#llMarkBtn,#llSlicerBtn{font-size:0!important;width:34px;padding:0!important;display:inline-grid;place-items:center}
      #llColBtn::before{content:"▥";font-size:15px}#llViewBtn::before{content:"☰";font-size:15px}#llProfileBtn::before{content:"⚙";font-size:15px}
      #llExcelBtn::before{content:"⤓";font-size:16px;color:var(--ok)}#llMarkBtn::before{content:"🎨";font-size:13px}#llSlicerBtn::before{content:"▤";font-size:15px}
      ${EQUIP_SCROLL}
      .x-legend{display:none!important}
      .explain-text .nw-lg{font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 10px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line-soft)}`,
    ops: [KIT, equipArrows("D"), ["script", `window.__nw.mount("D", () => { const X = window.__nw, t = X.$("#explainText");
      if (t && t.children.length && !t.querySelector(".nw-lg")) t.insertAdjacentHTML("afterbegin", '<div class="nw-lg"><b>凡例</b><span>❙❙ 汚れ</span><span>↻ 1 周して写る</span><span>▭ オフ</span><span>┄ 間隔の広がり</span></div>');
      const e = X.$("#explainBody"); if (e) e.classList.remove("text-closed"); });`], ["script", "window.__nw.declutter(false)"]],
  },
  {
    key: "E", name: "詰める: 狭いときは字と余白を 1 段小さく（0.9 倍の密度）",
    css: BASE_CSS + `${MEDIA}{
      :root{--fs-xs:10.5px;--fs-sm:11.5px;--fs-md:13px;--fs-lg:14px;--fs-xl:16px;--header-h:46px}
      .ll-screen{--ll-h:27px;--ll-fs:12px}
      .brand .eyebrow{font-size:9px}
      .screen-tab{padding:0 11px;height:36px;font-size:13px}
      .hstat{height:28px}.hstat .pill{padding:2px 7px}
      .btn-ghost.on-dark,.quit{height:28px;padding:0 9px}
      .header-right{gap:4px}
      #llFilterBar .filter-search-row{gap:5px;padding:5px 8px}
      .ll-screen .generic-filter-bar button{padding:0 8px}
      .eq-chip{padding:0 8px;font-size:12px;height:30px}
      .eq-hint{display:none}
      .x-label{font-size:10.5px!important;padding:1px 5px!important}
      .x-legend{font-size:10px!important;gap:2px 8px!important;padding:3px 8px!important}
    }`,
    ops: [KIT],
  },
  {
    key: "F", name: "2 段を許す: 見出し帯・道具の行・設備を、整えて 2 段に",
    css: BASE_CSS + `${MEDIA}{
      :root{--header-h:86px}
      body > header{flex-wrap:wrap;align-content:space-between;padding-top:6px}
      .brand{order:1}.header-right{order:2;margin-left:auto}
      .screen-tabs{order:3;flex-basis:100%;margin:0!important;height:40px!important}
      #llFilterBar .filter-search-row{flex-wrap:wrap;row-gap:6px}
      .filter-search-row-actions > :first-child{margin-left:0!important}
      #llFilterBar .filter-adhoc-toggle{margin-right:calc(100% - 900px)}
      .eq-hint{display:none}
      .eq-chips{row-gap:0}
      .x-legend{position:static!important;margin:0;border-radius:0!important;border-top:1px solid var(--line)}
      .explain-stage{display:flex;flex-direction:column}
      .explain-stage > div:first-of-type{flex:1}
    }`,
    ops: [KIT, ["script", "window.__nw.declutter(false)"]],
  },
  {
    key: "G", name: "先回り: いま使う物だけを出す（道具 ▾・設備は前に見た物＋検索・3D は見ている工程の札だけ）",
    css: BASE_CSS + `${MEDIA}{
      .brand h1 .brand-sub{display:none}
      #meChip{display:none!important}
      #llAdhocToggle,#llColBtn,#llViewBtn,#llProfileBtn{display:none!important}
      .eq-hint{display:none!important}
      .eq-chips{flex-wrap:nowrap!important;overflow:hidden}
      .x-label.muted:not(.tip){display:none!important}
    }
    .x-legend{display:none!important}
    .nw-first{position:absolute;left:12px;bottom:10px;padding:5px 10px;border-radius:8px;background:var(--surface);border:1px solid var(--line);font-size:11.5px;color:var(--muted);box-shadow:var(--shadow-sm)}`,
    ops: [KIT, ["script", `window.__nw.mount("G", () => { const X = window.__nw; if (innerWidth > 1440) return;
      if (X.$("#llExcelBtn") && !X.$("[data-nw=G-tools]")) X.$("#llExcelBtn").insertAdjacentHTML("beforebegin", '<button class="nw-btn" data-nw="G-tools" title="列で絞り込む・表示列・表の見せ方・表示の設定">道具 <span class="nw-n">4</span> ▾</button>');
      const chips = X.$$("#llEquipBar .eq-chip"); if (chips.length > 10 && !X.$("[data-nw=G-eq]")) { chips.slice(8).forEach((c) => { if (c.getAttribute("aria-selected") !== "true") c.style.display = "none"; });
        X.$("#llEquipBar .eq-chips").insertAdjacentHTML("afterend", '<label class="nw-btn" data-nw="G-eq" style="margin-bottom:4px;font-weight:600;color:var(--muted)">🔍 設備を探す（全 ' + chips.length + ' 台）</label>'); }
      const st = X.$("#explainStage"); if (st && st.querySelector("canvas") && !st.querySelector(".nw-first")) st.insertAdjacentHTML("beforeend", '<div class="nw-first">初めての方へ: 赤い 2 本線が汚れ、↻ が 1 周して写る所です（×）</div>');
    });`], ["script", "window.__nw.declutter(true)"]],
  },
];
