/* =========================================================================
   件数の行の「効いている物」のタブと、その面（版 3.25.0。7 案＋2 回目で選んだ: program/tools/ui-proposals/2026-10-toolbar* の M2）
   - 件数の行は効いている物が増えても 1 段: まとめ・並べ替え・選んだ値（スライサー）・色付けを、種類ごとに 1 つのタブ
     （数・種類・中身の名前）にする。狭いときは名前から省略し（種類と数は残す）、全部はタブの説明（title）に入れる
   - タブを押すと、その種類の札（今までの札そのもの。▲▼・×・外す・段を足す…）を下の面で開く。面は一覧に重ね、押し下げない。
     札の作りと押した時の処理は各部品のまま（まとめ・並べ替え＝lotlist.js、選んだ値＝lotlist-slicer.js、色付け＝lotlist-marks.js）。
     各部品は札の箱に数（data-count）と要約（data-summary）を書く。ここはそれを読んでタブを描くだけ（札が描き直されたら描き直す）
   - 拡大は「🔍 100% ▾」のボタンにし、つまみ・−・＋・刻み・100%に戻すは押して開く面に（拡大の処理は lotlist.js の setZoom のまま）
   ========================================================================= */
(function () {
  "use strict";
  const { $, esc } = TPA;
  const KINDS = [
    { kind: "group", bar: "#llGroupBar", name: "まとめ", tip: "押すと、段の順・▲▼・外す・段を足す・全部開く／畳むの札を開きます" },
    { kind: "sort", bar: "#llSortBar", name: "並べ替え", tip: "押すと、並べ替えの札（▲▼・外す）を開きます" },
    { kind: "slicer", bar: "#llSlicerSum", name: "選んだ値", tip: "スライサーで選んだ値。押すと、列ごとの札（× で外す）を開きます" },
    { kind: "marks", bar: "#llMarkSum", name: "色付け", tip: "押すと、色付けの札（押すと消す／付ける）を開きます" },
  ];
  let tabs = null, pop = null, open = "", off = null, zoomOff = null;

  /** 札の箱（各部品が描く）からタブを描く。開いている種類が消えたら面を閉じる */
  function paint() {
    const live = KINDS.map((k) => ({ ...k, el: $(k.bar) })).filter((k) => k.el && !k.el.hidden && +(k.el.dataset.count || 0) > 0);
    tabs.hidden = !live.length;
    tabs.innerHTML = live.length ? '<span class="ll-akey" aria-hidden="true">効いている物</span>' + live.map((k) => {
      const n = +k.el.dataset.count, sum = k.el.dataset.summary || "", tone = k.el.dataset.tone || "";
      return `<button type="button" class="ll-atab is-${k.kind}${tone ? ` mk-${tone}` : ""}${open === k.kind ? " is-open" : ""}" data-kind="${k.kind}"`
        + ` aria-haspopup="dialog" aria-expanded="${open === k.kind}" aria-controls="llActivePop" title="${esc(`${k.name} ${n}: ${sum}\n${k.tip}`)}">`
        + `<b class="ll-an">${n}</b><span class="ll-akind">${k.name}</span><span class="ll-aname">${esc(sum)}</span><i aria-hidden="true">▾</i></button>`;
    }).join("") : "";
    fit();
    if (!open) return;
    const tab = tabs.querySelector(`[data-kind="${open}"]`);
    if (!tab) close(false); else TPA.placeBelow(pop, tab);
  }
  /** 入りきらないときは、前置き（効いている物）と中身の名前を畳む（種類と数は残す。全部はタブの説明に。版 3.32.0） */
  function fit() {
    tabs.classList.remove("is-tight", "is-tighter");
    const over = () => !tabs.hidden && tabs.scrollWidth > tabs.clientWidth + 1;
    if (over()) tabs.classList.add("is-tight");
    if (over()) tabs.classList.add("is-tighter");
  }
  function show(kind) {
    if (off) off();
    open = kind; pop.dataset.kind = kind; pop.hidden = false;
    paint();
    off = TPA.dismissable(pop, (byEsc) => close(byEsc), { keep: tabs });
  }
  /** 面を閉じる。toTab: Esc で閉じたときは、その種類のタブへフォーカスを戻す（キーボードで続けて操作できる） */
  function close(toTab) {
    if (off) { off(); off = null; }
    const was = open; open = ""; pop.hidden = true;
    paint();
    if (toTab) tabs.querySelector(`[data-kind="${was}"]`)?.focus();
  }

  /* ---- 拡大の面 ---- */
  function toggleZoom() {
    const b = $("#llZoomBtn"), z = $("#llZoomPop");
    if (!z.hidden) { closeZoom(false); return; }
    z.hidden = false; b.setAttribute("aria-expanded", "true");
    TPA.placeBelow(z, b, "right");
    zoomOff = TPA.dismissable(z, (byEsc) => closeZoom(byEsc), { keep: b });
    requestAnimationFrame(() => $("#llZoomRange").focus());
  }
  function closeZoom(toBtn) {
    if (zoomOff) { zoomOff(); zoomOff = null; }
    $("#llZoomPop").hidden = true; $("#llZoomBtn").setAttribute("aria-expanded", "false");
    if (toBtn) $("#llZoomBtn").focus();
  }

  function mount() {
    tabs = $("#llActiveTabs"); pop = $("#llActivePop");
    if (!tabs || !pop) return;
    tabs.addEventListener("click", (e) => {
      const t = e.target.closest("[data-kind]"); if (!t) return;
      if (open === t.dataset.kind) close(false); else show(t.dataset.kind);
    });
    // 「＋ 段・見せ方」は表の見せ方の窓を開く（面は閉じる）
    pop.addEventListener("click", (e) => { if (e.target.closest("[data-gedit]")) close(false); });
    // 札が描き直された・出た・消えた → タブを描き直す（各部品は札の箱に数と要約を書くだけ）
    const watch = new MutationObserver(() => paint());
    KINDS.forEach((k) => { const el = $(k.bar); if (el) watch.observe(el, { attributes: true, attributeFilter: ["hidden", "data-count", "data-summary", "data-tone"], childList: true }); });
    addEventListener("resize", () => { if (open) paint(); else fit(); });
    $("#llZoomBtn")?.addEventListener("click", toggleZoom);
    paint();
  }
  window.LotListActive = { mount, close: () => close(false) };
})();
