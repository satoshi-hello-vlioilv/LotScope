/* =========================================================================
   表の行を、見える分と上下に 1 ページずつ（合わせて約 3 ページ）だけ描く（版 3.24.0。品質異常・作業実績の一覧）
   - 描かない行の高さは、上と下の空きの行（tr.vr-pad）で埋める。表の高さ・スクロールの長さ・つまみの位置は全部描いたときと同じ
   - 送って、描いてある所の端まで半ページを切ったら、見えている所を真ん中に描き直す（残る行はそのまま。足りない端だけ足し、離れた端を外す）
   - 行の高さは描いたときに測って覚える（まだ描いていない行は、測った行の平均で見積もる）。見積もりと違って行がずれたら、
     見ていた行が同じ所に残るようにスクロールを直す（ブラウザーの自動の合わせ〈overflow-anchor〉は切ってある: lotlist.css）
   - 数はすべて見た目の px（表に CSS の zoom を掛けて拡大しても、スクロールと同じ尺）。空きの行の高さだけ zoom で割って CSS の px にする
   使い方: const v = VirtualRows.create({ scroller, body, span, zoom })
     v.set(items, { keepHeights })   items: [{ key, html() }]（いま出す行だけ。畳んだ行は渡さない）。keepHeights: 測った高さを残す（畳む・開くとき）
     v.scrollTo(key)                 その行まで送る（見えていれば動かさない）
     v.reflow()                      高さを測り直して描き直す（拡大を変えたとき）
     v.rendered(key)                 その行を描いているか
   続きをまだ読んでいない一覧（版 3.56.0）: create の more = { left: () => 読んでいない行の数, need: (足りない行の数) => 読み足す }
     読んでいない行も、見積もりの高さで下の空きに入れる（スクロールの長さ・つまみは全部の行のぶん。どこへ飛んでも止まらない）。
     見えている所（と下の 1 ページ）が読んだ所の端を越えたら need を呼ぶ。読み足したら呼ぶ側が set(… keepHeights) で渡し直す。
     v.busy(on): 読み足している間、読んでいない所の空きに「読み込んでいます」の段を出す
   ========================================================================= */
(function () {
  "use strict";
  const AHEAD = 1;       // 見える分の上と下に先に描くページの数
  const MARGIN = 0.5;    // 描いてある所の端まで、これ（ページ）を切ったら描き直す

  function create({ scroller, body, span, zoom = () => 1, more = null }) {
    let items = [], off = [0];         // off[k]: k 行目の上端（tbody の上から・見た目の px）
    let from = 0, to = 0;              // 描いている範囲 [from, to)
    const heights = new Map();         // key → 測った高さ
    let est = 0, frame = 0;
    let loading = false;
    const pad = (cls) => `<tr class="vr-pad ${cls}" aria-hidden="true"><td colspan="${span()}"></td></tr>`;
    const left = () => (more ? Math.max(0, more.left() || 0) : 0);

    const measure = () => {
      let sum = 0, n = 0;
      for (const [, h] of heights) { sum += h; n++; if (n >= 400) break; }
      est = n ? sum / n : est || 28;
      off = new Array(items.length + 1);
      off[0] = 0;
      for (let k = 0; k < items.length; k++) off[k + 1] = off[k] + (heights.get(items[k].key) ?? est);
    };
    /** y（tbody の上から）にある行の番号 */
    const at = (y) => {
      let lo = 0, hi = items.length - 1;
      if (hi < 0) return 0;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (off[m] <= y) lo = m; else hi = m - 1; }
      return lo;
    };
    /** 見えている所（tbody の上から）: 上端と高さ。見出し（thead）は貼り付いて上を覆うので、その分を引く */
    const viewport = () => {
      const head = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
      return { top: scroller.scrollTop, h: Math.max(1, scroller.clientHeight - head) };
    };
    const pads = () => [body.querySelector(":scope > tr.vr-top"), body.querySelector(":scope > tr.vr-bottom")];
    const setPad = (tr, px) => {
      const z = zoom() || 1, h = Math.max(0, px) / z;
      tr.hidden = h < 0.5;
      tr.firstElementChild.style.height = `${h}px`;
    };
    const html = (a, b) => { let s = ""; for (let k = a; k < b; k++) s += items[k].html(); return s; };
    /** 新しく描いた行の高さを覚える */
    const learn = (first, a, b) => {
      let tr = first;
      for (let k = a; k < b && tr; k++, tr = tr.nextElementSibling) { const h = tr.getBoundingClientRect().height; if (h > 0) heights.set(items[k].key, h); }
    };

    /** [a, b) を描く。重なる所の行は残し、端だけ足す・外す */
    function paint(a, b) {
      let [top, bottom] = pads();
      if (!top || !bottom || b <= from || a >= to) {
        body.innerHTML = pad("vr-top") + html(a, b) + pad("vr-bottom");
        [top, bottom] = pads();
        learn(top.nextElementSibling, a, b);
      } else {
        for (let k = from; k < a; k++) top.nextElementSibling.remove();
        for (let k = b; k < to; k++) bottom.previousElementSibling.remove();
        if (a < from) {
          top.insertAdjacentHTML("afterend", html(a, from));
          learn(top.nextElementSibling, a, from);
        }
        if (b > to) {
          const last = bottom.previousElementSibling;
          bottom.insertAdjacentHTML("beforebegin", html(to, b));
          learn(last && last !== top ? last.nextElementSibling : top.nextElementSibling, to, b);
        }
      }
      from = a; to = b;
    }
    /** 見えている所を真ん中に、上下 AHEAD ページを足して描く。force: 端に余裕があっても描き直す */
    function update(force = false) {
      frame = 0;
      if (!items.length) {
        if (body.firstChild) body.innerHTML = "";
        from = to = 0; return;
      }
      if (!scroller.clientHeight) return;     // 画面を隠している間（別のタブ・集計表）は描かない。出たときに大きさの見張りが呼ぶ
      const v = viewport(), n = items.length;
      const needA = v.top - v.h * MARGIN, needB = v.top + v.h * (1 + MARGIN);
      // 読んだ所の端（と下の 1 ページ）を越えて見ている: 足りない行の数を伝えて読み足してもらう（読み足すまでは空きのまま）
      const reach = v.top + v.h * (1 + AHEAD);
      if (more && left() && reach > off[n]) more.need(Math.ceil((reach - off[n]) / (est || 28)));
      const ok = !force && body.firstChild && (from === 0 || off[from] <= needA) && (to === n || off[to] >= needB);
      if (ok) return;
      // 見ていた行（見えている所の上端の行）と、その中のどこを見ていたか。描いて高さが分かったら、同じ所に戻す
      const anchor = at(v.top), delta = v.top - off[anchor];
      const atEnd = v.top > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;   // いちばん下に居たら、下に留める
      const a = Math.max(0, at(v.top - v.h * AHEAD)), b = Math.min(n, at(v.top + v.h * (1 + AHEAD)) + 1);
      paint(a, b);
      measure();
      const [top, bottom] = pads();
      setPad(top, off[from]); setPad(bottom, off[n] - off[to] + left() * est);
      bottom.classList.toggle("is-more", left() > 0); bottom.classList.toggle("is-loading", loading && left() > 0);
      const want = atEnd ? scroller.scrollHeight - scroller.clientHeight : off[anchor] + delta;
      if (Math.abs(scroller.scrollTop - want) > 0.5 && v.top > 0) scroller.scrollTop = want;
    }
    /** 描き直す。初めは見積もりの高さで範囲を決めるので、測った高さで足りない端をもう 1 度埋める */
    function redraw(keepTop = false) {
      const y = scroller.scrollTop;
      from = to = 0; measure();
      if (keepTop && items.length) {      // 送った所に留める（中を空にすると表が縮み、ブラウザーがスクロールを上へ戻すので、先に全部の高さの空きを置く）
        body.innerHTML = pad("vr-top") + pad("vr-bottom");
        const [top, bottom] = pads(); setPad(top, 0); setPad(bottom, off[items.length] + left() * est);
        scroller.scrollTop = y;            // 描くのは update（空きの行は残し、間に行を描く）
      } else body.innerHTML = "";
      update(true); update();
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => update()); };
    scroller.addEventListener("scroll", schedule, { passive: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(schedule).observe(scroller);

    return {
      set(list, { keepHeights = false } = {}) {
        if (!keepHeights) heights.clear();
        items = list;
        redraw(keepHeights);
      },
      reflow() { heights.clear(); redraw(); },
      busy(on) { loading = !!on; const b = body.querySelector(":scope > tr.vr-bottom"); if (b) b.classList.toggle("is-loading", loading && left() > 0); },
      scrollTo(key) {
        const k = items.findIndex((x) => x.key === key); if (k < 0) return false;
        // 描くと高さが分かって位置がずれる（見積もりと違う）ので、見える所に入るまで合わせ直す（離れた所ほど何回か要る）
        for (let pass = 0; pass < 6; pass++) {
          const v = viewport();
          if (off[k] < v.top) scroller.scrollTop = off[k];
          else if (off[k + 1] > v.top + v.h - 1) scroller.scrollTop = Math.ceil(off[k + 1] - v.h) + 2;     // 下の端は 2px の余り（小数の丸めで 1px 欠けない）
          else if (pass) break;
          update(true);
        }
        return true;
      },
      rendered: (key) => { const k = items.findIndex((x) => x.key === key); return k >= from && k < to; },
      get size() { return items.length; },
    };
  }
  window.VirtualRows = { create };
})();
