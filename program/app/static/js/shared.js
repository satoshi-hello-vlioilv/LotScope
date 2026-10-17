/* =========================================================================
   画面の共通部品（どのファイルも同じ書き方を写さない）
   - window.TPA の1つだけを出す。上の階層に名前を置かない（app.js・master.js は上の階層で $ などを
     宣言しているので、ここで宣言するとぶつかって読み込めなくなる）。
   - 最初に読み込む（index.html）。list-formula.js は WaveLog と同じものを保つため使わない。
   ========================================================================= */
(function () {
  "use strict";
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /* 覚える場所（localStorage / sessionStorage）。プライベート・容量切れ・止められた PC でも投げずに既定で動く。
     get/set は JSON で、getRaw/setRaw は文字のまま（以前から文字で覚えている項目のため）。
     changed(k): 中身が変わったときだけ呼ぶ（localStorage は画面の設定の控えへ送る。下の uiState）。 */
  const store = (area, changed = () => {}) => {
    const setRaw = (k, v) => { try { if (area().getItem(k) === String(v)) return; area().setItem(k, String(v)); changed(k); } catch (_) { /* 覚えられなくても動く */ } };
    return {
      get(k, d) { try { const v = JSON.parse(area().getItem(k)); return v == null ? d : v; } catch (_) { return d; } },
      set: (k, v) => setRaw(k, JSON.stringify(v)),
      getRaw(k, d = null) { try { const v = area().getItem(k); return v == null ? d : v; } catch (_) { return d; } },
      setRaw,
      remove(k) { try { if (area().getItem(k) == null) return; area().removeItem(k); changed(k); } catch (_) { /* 覚えられなくても動く */ } },
    };
  };

  /* 画面の設定の控え（app/services/ui_state.py）。localStorage は画面の置き場（オリジン）ごとに別なので、
     WebView の作業場所が消えても戻せるように・以前のブラウザ版（ポートの置き場）で使い込んだ設定を引き継ぐために、
     覚え直すたびに「変わった名前だけ」を控えに重ね、開くときに控えの版（rev）が進んでいれば戻す（サーバーが TPA_UI_STATE として画面に埋める）。
     - 控えに入れるのは tpa. で始まる名前だけ。どの版の控えと揃っているかは tpa. で始まらない名前（REV）に覚える
     - 送ったあと、控えの版が自分の続き（＋1）でなければ、ほかの窓も重ねている。REV を進めず、次に開くとき控え全体から戻す
     - 一度も揃えたことのない画面に設定があれば、それは前の版から使ってきた設定。控えは足りない名前だけ補い、手元をすべて重ねる
       （先に開いたデスクトップ版の「まだ何も決めていない設定」で、使い込んだ設定を消さない） */
  const uiState = (() => {
    const PREFIX = "tpa.", REV = "tpaUiRev", DELAY_MS = 1500, URL = "/api/ui-state";
    const ls = () => window.localStorage;
    const appKeys = () => { const out = []; for (let i = 0; i < ls().length; i++) { const k = ls().key(i); if (k && k.startsWith(PREFIX)) out.push(k); } return out; };
    const pending = new Set();                         // 送っていない名前
    // 閉じる瞬間の送り方。使えない・投げる WebView（Linux の WebKitGTK は自前の仕組み tpa:// 宛てで投げる）では false → fetch で送る
    const sendBeacon = (url, body) => { try { return !!navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "application/json" })); } catch (_) { return false; } };
    let timer = null;
    function save(beacon) {
      clearTimeout(timer); timer = null;
      if (!pending.size) return Promise.resolve();
      try {
        const changed = {}, removed = [], keys = [...pending];
        keys.forEach((k) => { const v = ls().getItem(k); if (v == null) removed.push(k); else changed[k] = v; });
        pending.clear();
        const body = JSON.stringify({ changed, removed }), base = +ls().getItem(REV) || 0;
        if (beacon && sendBeacon(URL, body)) return Promise.resolve();
        return fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 })
          .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
          // 自分の続きなら控えと揃っている。そうでなくても「一度は送れた」（前の版の設定は控えに入った）印に 0 を置き、
          // 次に開くとき控え全体から戻す（印が無いままだと、開くたびに前の版の設定として重ね続ける）
          .then((d) => { if (d.rev === base + 1) ls().setItem(REV, String(d.rev)); else if (ls().getItem(REV) == null) ls().setItem(REV, "0"); })
          .catch(() => { keys.forEach((k) => pending.add(k)); });   // 送れなかった名前は次に送る（戻り値: 送り終えたら解決）
      } catch (_) { /* 送れなくても画面は動く */ }
      return Promise.resolve();
    }
    function touched(k) {
      if (!String(k).startsWith(PREFIX)) return;
      pending.add(k); clearTimeout(timer); timer = setTimeout(save, DELAY_MS);
    }
    (function restore() {
      try {
        const snap = window.TPA_UI_STATE;
        if (!snap) return;                                   // 控えを埋めていない画面（LotDsp 照合など）は戻さない
        const rev = ls().getItem(REV), keys = snap.keys || {}, local = appKeys();
        if (rev == null && local.length) {                   // 前の版から使ってきた設定
          Object.entries(keys).forEach(([k, v]) => { if (ls().getItem(k) == null) ls().setItem(k, v); });
          local.forEach(touched);
        } else if (rev == null && !local.length && !(snap.rev || 0)) {
          // 入れたばかりの PC（画面の設定も控えも無い）: 開発者が置いた一覧の表示の初期設定を当てる（services/ui_defaults.py）
          const defs = (window.TPA_UI_PROFILE || {}).defaults || {};
          Object.entries(defs).forEach(([k, v]) => { ls().setItem(k, v); touched(k); });
        } else if ((snap.rev || 0) > (+rev || 0)) {
          local.forEach((k) => { if (!(k in keys)) ls().removeItem(k); });
          Object.entries(keys).forEach(([k, v]) => ls().setItem(k, v));
          ls().setItem(REV, String(snap.rev));
        }
      } catch (_) { /* 戻せなくても既定で動く */ }
    })();
    addEventListener("pagehide", () => save(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(true); });
    return { touched, flush: () => save(false) };
  })();

  let measureCtx = null;

  /* 重なって開く窓（更新履歴・マスタ管理とその上のフォーム・削除の確認・取込ダイアログ）。
     Esc はいちばん上に開いている1枚だけを閉じる（登録した順＝重なる順。後から登録した物ほど上）。
     ほかが先に Esc を使った（preventDefault）ときは何もしない（メニュー・問い合わせ中のモーダルが先）。 */
  const layers = [];
  const isShown = (el) => !el.hidden && !el.classList.contains("hidden");
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const top = layers.filter((l) => isShown(l.el)).pop();
    if (top) { e.preventDefault(); top.close(); }
  });

  /* 書き出したファイルの置き場所の知らせ（右下・閉じるまで残る）。どこから書き出しても（表示列・並び・表示の設定・計算の CSV）同じ所に出る。
     デスクトップ版は窓（desktop/src/main.rs の on_download）が保存し終えたとき tpa:saved {path, ok} を送るので、置いた場所の全文と
     「フォルダを開く」「パスをコピー」を出す。届かないとき（ブラウザで開いたとき）は、ブラウザのダウンロード先に置いたと言う。 */
  const saved = (() => {
    let el = null, fallback = 0;
    const close = () => { if (el) { el.remove(); el = null; } };
    const show = (ok, title, body, path) => {
      close();
      el = document.createElement("div");
      el.className = `tpa-saved${ok ? "" : " is-ng"}`;
      el.setAttribute("role", "status");
      el.innerHTML = `<button type="button" class="tpa-saved-x" aria-label="閉じる" title="閉じる">×</button>
        <b class="tpa-saved-t">${TPA.esc(title)}</b>${body}
        ${path ? `<div class="tpa-saved-acts"><button type="button" class="is-main" data-act="reveal">フォルダを開く</button><button type="button" data-act="copy">パスをコピー</button></div>` : ""}
        <small class="tpa-saved-msg" aria-live="polite"></small>`;
      document.body.appendChild(el);
      const box = el, msg = (t) => { box.querySelector(".tpa-saved-msg").textContent = t; };
      box.querySelector(".tpa-saved-x").onclick = close;
      box.querySelectorAll("[data-act]").forEach((b) => b.onclick = async () => {
        if (b.dataset.act === "copy") {
          try { await navigator.clipboard.writeText(path); msg("パスをコピーしました。"); } catch (_) { msg("コピーできませんでした。パスを選んで写してください。"); }
          return;
        }
        try {
          const r = await fetch("/__desktop/reveal", TPA.json("POST", { path }));
          if (!r.ok) msg(((await r.json().catch(() => ({}))).error) || "フォルダを開けませんでした。");
        } catch (_) { msg("フォルダを開けませんでした。"); }
      });
    };
    window.addEventListener("tpa:saved", (e) => {
      clearTimeout(fallback);
      const { path, ok } = e.detail || {};
      if (!ok || !path) { show(false, "✕ 書き出せませんでした", '<span class="tpa-saved-p">保存先に書き込めなかったか、途中で止まりました。もう一度書き出してください。</span>', ""); return; }
      const name = String(path).split(/[\\/]/).pop();
      show(true, `✓ 書き出しました「${name}」`, `<span class="tpa-saved-l">置いた場所</span><code class="tpa-saved-p">${TPA.esc(path)}</code>`, path);
    });
    return {
      /** 書き出しを始めた（name: ファイルの名前）。デスクトップ版の知らせが来なければ、ブラウザのダウンロード先と言う */
      expect(name) {
        clearTimeout(fallback);
        fallback = setTimeout(() => show(true, `✓ 書き出しました「${name}」`,
          '<span class="tpa-saved-p">ブラウザのダウンロード先（ふつうは「ダウンロード」フォルダ）に置きました。ブラウザのダウンロードの一覧（Ctrl＋J）からも開けます。</span>', ""), 2500);
      },
    };
  })();

  /* 条件の比べ方（一覧の条件・ダッシュボードのパネルの条件で同じ。サーバーは services/lot_list.py の ALLOWED_OPS） */
  const FILTER_OPS = [
    ["contains", "含む"], ["not_contains", "含まない"], ["eq", "＝ 一致"], ["neq", "≠ 不一致"],
    ["starts", "前方一致"], ["ends", "後方一致"], ["gt", "> より大きい"], ["gte", ">= 以上"], ["lt", "< より小さい"], ["lte", "<= 以下"], ["empty", "空欄"], ["not_empty", "空欄以外"],
    // 日付と読める列だけ: 今日から数えて N 日（週・か月・年）以内（サーバーが ToDate(列) >= 今日−N で絞る）
    ["within_days", "日以内（今日から）"], ["within_weeks", "週間以内（今日から）"], ["within_months", "か月以内（今日から）"], ["within_years", "年以内（今日から）"],
  ];
  const REL_UNIT = { within_days: "日", within_weeks: "週間", within_months: "か月", within_years: "年" };
  const opLabel = (op) => (FILTER_OPS.find((x) => x[0] === op) || [op, op])[1];
  const opShort = (op) => opLabel(op).split(" ")[0];
  const noValueOp = (op) => op === "empty" || op === "not_empty";
  const relText = (f) => `${f.value}${REL_UNIT[f.op]}以内` + (String(f.value) === "0" && f.op === "within_days" ? "（今日）" : "");
  const condLabel = (f) => (f.op in REL_UNIT ? `${f.column} ${relText(f)}` : noValueOp(f.op) ? `${f.column} ${opShort(f.op)}` : `${f.column} ${opShort(f.op)} ${f.value}`);

  window.TPA = {
    FILTER_OPS, REL_UNIT, opLabel, opShort, noValueOp, relText, condLabel,
    /** HTML に差し込む文字を無害にする（& < > " ' ）。 */
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]),
    $: (s, r = document) => r.querySelector(s),
    $$: (s, r = document) => [...r.querySelectorAll(s)],
    local: store(() => window.localStorage, uiState.touched),
    /** 画面の設定の控えを今すぐ送る（待たずに。試験・終了の前） */
    saveUiState: () => uiState.flush(),
    session: store(() => window.sessionStorage),
    /** JSON を送る fetch の2つめの引数。例: fetch(url, TPA.json("POST", {names})) */
    json: (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    pad2: (n) => String(n).padStart(2, "0"),
    /** 文字の幅（px）を測る（列の幅を中身に合わせるため）。font は CSS の font と同じ書き方。 */
    textWidth(text, font) {
      if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
      measureCtx.font = font;
      return measureCtx.measureText(String(text)).width;
    },
    /** 作ったファイルを保存させ、置いた場所を右下に知らせる。 */
    download(blob, name) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      saved.expect(name);
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
    },
    /** 設定を JSON のファイルに書き出す（形は WaveLog と同じ {kind, version, savedAt, items}）。読むのは pickJson。 */
    saveJson(kind, items, name) {
      const body = JSON.stringify({ kind, version: 1, savedAt: new Date().toISOString(), items }, null, 1);
      TPA.download(new Blob([body], { type: "application/json" }), name);
    },
    /** saveJson で書いた設定のファイルを選ばせて読む → items（1件以上）。選ばずに閉じたら null。
        別の種類（kind）・壊れたファイルは、何が違うかを言う Error で投げる（what: 「表示列」など、誤りの文に使う名前）。
        kind が null なら種類を問わない（表示列: WaveLog など、前から読めていたファイルを読めなくしない）。 */
    pickJson(kind, what) {
      return new Promise((resolve, reject) => {
        // 選ぶ間だけ頁に付ける（頁に付けない欄は、ブラウザによって選んだ後の change が届かない。版 3.43.0）
        const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json", hidden: true });
        document.body.appendChild(input);
        input.addEventListener("cancel", () => { input.remove(); resolve(null); });
        input.addEventListener("change", async () => {
          input.remove();
          const file = input.files[0]; if (!file) { resolve(null); return; }
          try {
            let d;
            try { d = JSON.parse(await file.text()); } catch (_) { throw new Error(`「${file.name}」は設定のファイル（JSON）として読めません`); }
            if (!d || (kind && d.kind !== kind)) throw new Error(`「${file.name}」は${what}の設定ファイルではありません`);
            const items = Array.isArray(d.items) ? d.items.filter((x) => x && typeof x === "object") : [];
            if (!items.length) throw new Error(`「${file.name}」に${what}の設定が入っていません`);
            resolve(items);
          } catch (e) { reject(e); }
        });
        input.click();
      });
    },
    /** 値だけの深い写し（設定・下書きを元と切り離す）。 */
    clone: (v) => JSON.parse(JSON.stringify(v)),
    /* 日本語入力（IME）の変換中か。変換中の input・keydown（確定の Enter も）は、まだ打ち終わっていない字なので扱わない */
    composing: (e) => !!(e && (e.isComposing || e.keyCode === 229)),
    /** 打った字に応じて fn(el) を呼ぶ。変換中は呼ばず、確定したとき（compositionend）に呼ぶ。
        変換中に欄を描き直す・探しに行くと、未確定の字が強制確定されてしまう（ローマ字で打てない） */
    onText(el, fn) {
      el.addEventListener("input", (e) => { if (!TPA.composing(e)) fn(el, e); });
      el.addEventListener("compositionend", (e) => fn(el, e));
    },

    /** 欄の大きさ（右下の角で広げた高さ・幅）をこの PC に覚え、欄を作り直しても当て直す（key ごと）。
        詳しい所を描き直す画面（表示列の「この列の作り方」など）では、打つたびに欄が作り直されて元の大きさへ戻っていた。
        初めの 1 回（当て直した大きさの知らせ）は覚えない。窓が閉じて 0 になったときも覚えない */
    keepSize(el, key, { width = false } = {}) {
      if (!el || typeof ResizeObserver === "undefined") return;
      const k = `tpa.ui.size.${key}.v1`, saved = TPA.local.get(k, null);
      if (saved && saved.h) el.style.height = saved.h + "px";
      if (width && saved && saved.w) el.style.width = saved.w + "px";
      let first = true;
      new ResizeObserver(() => {
        if (first) { first = false; return; }
        const r = el.getBoundingClientRect();
        if (r.height < 8 || !el.isConnected) return;
        TPA.local.set(k, { h: Math.round(r.height), ...(width ? { w: Math.round(r.width) } : {}) });
      }).observe(el);
    },

    /** 重なって開く窓を登録する。Esc（いちばん上の1枚）と、backdrop なら窓の外側（背景）を押したときに close()。 */
    layer(el, close, { backdrop = true } = {}) {
      const entry = { el, close };
      layers.push(entry);
      if (backdrop) el.addEventListener("click", (e) => { if (e.target === el) close(); });
      return () => { const i = layers.indexOf(entry); if (i >= 0) layers.splice(i, 1); };   // 窓を捨てるとき（いくつも開くカード）
    },

    /** 開いたメニューを、外側を押す・Esc で閉じる。onClose(byEsc) を1度だけ呼ぶ。戻り値は見張りを外す関数。
        開いた操作そのものの押下で閉じないよう、見張りは次の描画から。keep の中を押しても閉じない（開いたボタン）。
        event: 外側の押下を click で見るか mousedown で見るか（選択欄・つまみを触るメニューは mousedown）。 */
    dismissable(el, onClose, { keep = null, event = "click" } = {}) {
      let live = true;
      const outside = (e) => { if (!el.contains(e.target) && !(keep && keep.contains(e.target))) done(false); };
      const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(true); } };
      const off = () => {
        live = false; cancelAnimationFrame(raf);
        document.removeEventListener(event, outside, true); document.removeEventListener("keydown", key, true);
      };
      const done = (byEsc) => { if (live) { off(); onClose(byEsc); } };
      const raf = requestAnimationFrame(() => {
        if (live) { document.addEventListener(event, outside, true); document.addEventListener("keydown", key, true); }
      });
      return off;
    },
    /** メニューを基準の要素の下に置く（左端か右端をそろえ、画面の左右からはみ出さない）。 */
    placeBelow(el, anchor, align = "left") {
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth, top = Math.round(r.bottom + 6);
      el.style.top = `${top}px`;
      // 中でスクロールする窓は、置いた位置から画面の下端までに収める（下が切れて届かない所を作らない）
      if (/auto|scroll/.test(getComputedStyle(el).overflowY)) el.style.maxHeight = `${Math.max(160, innerHeight - top - 8)}px`;
      el.style.left = `${Math.round(Math.max(8, Math.min(align === "right" ? r.right - w : r.left, innerWidth - w - 8)))}px`;
    },
    /** 引いて並べ替える（版 3.28.0。作業実績の設備のタブ・マスタ管理の設備の一覧）。中身を描き直しても効くよう、root に 1 回だけ付ける。
        items(): 並べる要素の並び／keyOf(el): 要素の鍵／handle: つかめる所（CSS の選び方。省けば要素そのもの）／axis: "x"（横に並ぶ）か "y"（か、それを返す関数）
        onOrder(keys): 並びが変わったとき（鍵の並び）。5px より動かしたときだけ引いたとみなし、そのあとのクリックは食べる（タブが切り替わらない）。
        引いている間は、要素に is-dragging・差し込む所に縦か横の線（.tpa-sort-mark）。Esc で取りやめ */
    sortable(root, { items, keyOf, handle = null, axis: axisOpt = "x", enabled = () => true, onOrder }) {
      let drag = null, axis = "x";
      const mark = () => drag.mark || (drag.mark = document.body.appendChild(Object.assign(document.createElement("div"), { className: `tpa-sort-mark is-${axis}` })));
      const stop = () => { if (!drag) return; drag.el.classList.remove("is-dragging"); drag.mark?.remove(); document.body.classList.remove("tpa-sorting"); drag = null; };
      root.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || !enabled()) return;
        const grip = handle ? e.target.closest(handle) : null, el = items().find((x) => x.contains(e.target));
        if (!el || (handle && !grip) || e.target.closest("input,select,textarea,label")) return;
        axis = typeof axisOpt === "function" ? axisOpt() : axisOpt;   // 置き場で向きが変わる物（スライサーのカード）は引き始めに読む
        drag = { el, x: e.clientX, y: e.clientY, on: false, at: -1, id: e.pointerId };
      });
      addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return; drag.on = true; drag.el.classList.add("is-dragging"); document.body.classList.add("tpa-sorting"); }
        e.preventDefault();
        const list = items(), pos = axis === "x" ? e.clientX : e.clientY;
        let at = list.findIndex((x) => { const r = x.getBoundingClientRect(); return pos < (axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2); });
        if (at < 0) at = list.length;
        drag.at = at;
        const ref = list[Math.min(at, list.length - 1)].getBoundingClientRect(), end = at >= list.length, m = mark();
        if (axis === "x") Object.assign(m.style, { left: `${(end ? ref.right : ref.left) - 2}px`, top: `${ref.top}px`, height: `${ref.height}px`, width: "" });
        else Object.assign(m.style, { top: `${(end ? ref.bottom : ref.top) - 2}px`, left: `${ref.left}px`, width: `${ref.width}px`, height: "" });
      }, { passive: false });
      addEventListener("pointerup", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const { on, el, at } = drag;
        stop();
        if (!on) return;
        // 引いた後のクリックは食べる。離した所が押した所と違うとクリックは起きないので、食べる見張りはこの入力の間だけ
        // （残すと次の本物のクリックを食べる。クリックは pointerup と同じ入力の中で続けて届くので、次の順番で外す）
        const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
        addEventListener("click", eat, { capture: true, once: true });
        setTimeout(() => removeEventListener("click", eat, { capture: true }), 0);
        const keys = items().map(keyOf), from = keys.indexOf(keyOf(el));
        if (from < 0 || at < 0) return;
        const to = at > from ? at - 1 : at;
        if (to === from) return;
        keys.splice(to, 0, keys.splice(from, 1)[0]);
        onOrder(keys);
      });
      addEventListener("keydown", (e) => { if (drag && e.key === "Escape") { e.preventDefault(); stop(); } }, true);
      addEventListener("pointercancel", stop);
    },
    /** 並びの中の 1 つを前後へ動かした鍵の並び（キーで動かすとき）。動かせなければ null */
    moveKey(keys, key, step) {
      const i = keys.indexOf(key), j = i + step;
      if (i < 0 || j < 0 || j >= keys.length) return null;
      const out = keys.slice(); out.splice(j, 0, out.splice(i, 1)[0]);
      return out;
    },
    /** 右クリックのメニュー（版 3.44.0。表示列の窓・ダッシュボードで同じ形）。押した位置に出し、外側・Esc で閉じる。
        items: [{ label, run, key?（右に添えるキーの字）, icon?（左の 1 字）, danger?, disabled?, why?（押せない理由・説明）, on?（いま効いている印 ✓）} |
                { group: "見出し" }（まとまりの見出し。前に線） | { sep: true }（線）]
        head: いちばん上の太字（何に対するメニューか）。矢印・Home・End で移り、Enter で押す。戻り値: 閉じる関数 */
    menu({ x, y, head = "", items, onClose = null }) {
      document.querySelector(".tpa-menu")?._close?.();
      const m = document.createElement("div");
      m.className = "tpa-menu"; m.setAttribute("role", "menu");
      const acts = [];
      m.innerHTML = (head ? `<p class="tm-head">${TPA.esc(head)}</p>` : "") + items.filter(Boolean).map((it) => {
        if (it.sep) return '<hr class="tm-sep">';
        if (it.group) return `<p class="tm-group">${TPA.esc(it.group)}</p>`;
        acts.push(it);
        return `<button type="button" role="menuitem" data-i="${acts.length - 1}" class="${it.danger ? "is-danger" : ""}${it.on ? " is-on" : ""}"${it.disabled ? " disabled" : ""}${it.why ? ` title="${TPA.esc(it.why)}"` : ""}>`
          + `<i class="tm-ico" aria-hidden="true">${it.on ? "✓" : TPA.esc(it.icon || "")}</i><span>${TPA.esc(it.label)}${it.disabled && it.why ? `<small class="tm-why">${TPA.esc(it.why)}</small>` : ""}</span>${it.key ? `<kbd>${TPA.esc(it.key)}</kbd>` : ""}</button>`;
      }).join("");
      document.body.append(m);
      // 下に入らなければ、押した所の上に開く（押した行をメニューで覆わない）。上にも入らなければ画面に収める
      TPA.placeAt(m, x, y + m.offsetHeight > innerHeight - 8 && y - m.offsetHeight >= 8 ? y - m.offsetHeight : y);
      let off = null;
      const close = () => { if (!m.isConnected) return; off?.(); m.remove(); onClose?.(); };
      m._close = close;
      off = TPA.dismissable(m, close, { event: "mousedown" });
      m.addEventListener("contextmenu", (e) => e.preventDefault());
      m.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-i]"); if (!b || b.disabled) return;
        close(); acts[+b.dataset.i].run();
      });
      m.addEventListener("keydown", (e) => {
        const bs = [...m.querySelectorAll("button:not(:disabled)")], i = bs.indexOf(document.activeElement);
        const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: bs.length - 1 }[e.key];
        if (go == null) return;
        e.preventDefault(); bs[(go + bs.length) % bs.length]?.focus();
      });
      requestAnimationFrame(() => m.querySelector("button:not(:disabled)")?.focus({ preventScroll: true }));
      return close;
    },
    /** メニューを押した位置に置く（画面からはみ出さない）。 */
    placeAt(el, x, y) {
      el.style.left = `${Math.round(Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)))}px`;
      el.style.top = `${Math.round(Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)))}px`;
    },

    /** 動かせる・大きさを変えられる窓（表示列・読み替えルール・カード）。位置と大きさを key でこの PC に覚え、
        [data-drag] の見出しを掴んで動かせる（見出しが画面に残る範囲）。w・h・top は覚えが無いときの大きさと上端、
        align は覚えが無いときの左右の置き場（center＝真ん中／right＝右寄せ。後ろの一覧を隠しすぎない窓）。
        大きさは4辺と4隅の取っ手（CSS の resize は overflow:clip の窓では効かないので使わない）。
        細かく合わせる: 動かす・変えるあいだは画面の端とほかの窓（[data-float]）の辺へ 8px で吸い付き（Alt を押すと吸い付かない）、
        位置と大きさを窓の隅に数で出す。窓の中で Alt+矢印＝動かす・Alt+Shift+矢印＝大きさ（10px。Ctrl も押すと 1px）。
        戻り値: place() 覚えた位置に置く（画面が変わっていれば収める）／ remember() いまの位置と大きさを覚える（隠す前に）／
                rect() いまの位置と大きさ／ setRect({x,y,w,h}, keep) 置く（画面に収める。keep=false なら覚えない）。 */
    floatPanel(panel, { key = "", w = 1200, h = 780, top = 40, align = "center", minW = 400, minH = 300 }) {
      const SNAP = 8, KEY_STEP = 10;
      panel.dataset.float = "";
      const remember = () => {
        if (panel.hidden || !key) return;
        const b = panel.getBoundingClientRect();
        if (b.width < minW || b.height < minH) return;   // 出ていない・畳まれた大きさは覚えない
        TPA.local.set(key, { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) });
      };
      const rect = () => { const b = panel.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
      const apply = (r) => {
        const pw = Math.max(minW, Math.min(innerWidth - 8, Math.round(r.w))), ph = Math.max(minH, Math.min(innerHeight - 8, Math.round(r.h)));
        Object.assign(panel.style, { width: pw + "px", height: ph + "px",
          left: Math.round(Math.max(0, Math.min(r.x, innerWidth - 80))) + "px", top: Math.round(Math.max(0, Math.min(r.y, innerHeight - 40))) + "px" });
      };
      /* 吸い付く先の線（画面の端・ほかの窓の辺）。x の線と y の線 */
      const guides = () => {
        const xs = [0, innerWidth], ys = [0, innerHeight];
        document.querySelectorAll("[data-float]").forEach((el) => {
          if (el === panel || el.hidden || !el.isConnected) return;
          const b = el.getBoundingClientRect(); if (!b.width) return;
          xs.push(b.left, b.right); ys.push(b.top, b.bottom);
        });
        return { xs, ys };
      };
      const snap = (v, lines) => { let best = v, d = SNAP + 1; lines.forEach((l) => { const k = Math.abs(l - v); if (k < d) { d = k; best = l; } }); return best; };
      let readout = null, readTimer = null;
      const showRead = () => {
        if (!readout) { readout = document.createElement("div"); readout.className = "fp-read"; panel.append(readout); }
        const r = rect();
        readout.textContent = `${Math.round(r.x)}, ${Math.round(r.y)}　${Math.round(r.w)} × ${Math.round(r.h)}`;
        readout.hidden = false; clearTimeout(readTimer); readTimer = setTimeout(() => { if (readout) readout.hidden = true; }, 1200);
      };
      /* 掴んで動かす・大きさを変える（edge: "move" か n/s/e/w の組み合わせ） */
      const grab = (e, edge) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const r0 = rect(), x0 = e.clientX, y0 = e.clientY, g = guides();
        document.body.classList.add("fp-busy");
        panel.classList.add("is-moving");
        const move = (ev) => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0, free = ev.altKey;
          let { x, y, w: rw, h: rh } = r0;
          if (edge === "move") {
            x += dx; y += dy;
            if (!free) {
              const sx = snap(x, g.xs), sx2 = snap(x + rw, g.xs) - rw, sy = snap(y, g.ys), sy2 = snap(y + rh, g.ys) - rh;
              x = sx !== x ? sx : sx2; y = sy !== y ? sy : sy2;
            }
          } else {
            if (edge.includes("e")) { rw = Math.max(minW, r0.w + dx); if (!free) rw = snap(x + rw, g.xs) - x; }
            if (edge.includes("s")) { rh = Math.max(minH, r0.h + dy); if (!free) rh = snap(y + rh, g.ys) - y; }
            if (edge.includes("w")) { let nx = Math.min(r0.x + r0.w - minW, r0.x + dx); if (!free) nx = snap(nx, g.xs); rw = r0.x + r0.w - nx; x = nx; }
            if (edge.includes("n")) { let ny = Math.min(r0.y + r0.h - minH, r0.y + dy); if (!free) ny = snap(ny, g.ys); rh = r0.y + r0.h - ny; y = ny; }
          }
          apply({ x, y, w: rw, h: rh }); showRead();
        };
        const up = () => {
          document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
          document.body.classList.remove("fp-busy"); panel.classList.remove("is-moving"); remember();
        };
        document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      };
      panel.querySelector("[data-drag]").addEventListener("mousedown", (e) => { if (!e.target.closest("button,input,select,label,a")) grab(e, "move"); });
      ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach((edge) => {
        const hd = document.createElement("i");
        hd.className = `fp-h fp-${edge}`; hd.setAttribute("aria-hidden", "true");
        hd.addEventListener("mousedown", (e) => grab(e, edge));
        panel.append(hd);
      });
      panel.addEventListener("keydown", (e) => {
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!dir || !e.altKey || e.target.closest("input,select,textarea")) return;
        e.preventDefault(); e.stopPropagation();
        const step = e.ctrlKey ? 1 : KEY_STEP, r = rect();
        if (e.shiftKey) apply({ ...r, w: r.w + dir[0] * step, h: r.h + dir[1] * step });
        else apply({ ...r, x: r.x + dir[0] * step, y: r.y + dir[1] * step });
        showRead(); remember();
      });
      new ResizeObserver(remember).observe(panel);
      return {
        remember, rect,
        setRect(r, keep = true) { apply(r); if (keep) remember(); },
        place() {
          let r = key ? TPA.local.get(key, null) : null;
          if (!r || r.w < minW || r.h < minH) r = null;
          // 出すときは見出し帯（画面のタブ・マスタ管理・終了）を覆わない。低い画面（フル HD・150% の 720px など）では、上ではなく高さを縮める
          // （以前は高さを窓に合わせて上端を 12px まで上げ、カードが見出し帯の操作を隠した。版 3.32.0。評価関数 ui-eval-narrow.mjs）
          const floor = Math.round(document.querySelector("body > header")?.getBoundingClientRect().bottom || 0) + 8;
          const pw = Math.min(innerWidth - 24, r ? r.w : w), ph = Math.max(Math.min(minH, innerHeight - floor - 12), Math.min(innerHeight - floor - 12, r ? r.h : h));
          Object.assign(panel.style, { width: pw + "px", height: ph + "px",
            left: Math.max(12, Math.min(r ? r.x : align === "right" ? innerWidth - pw - 24 : (innerWidth - pw) / 2, innerWidth - pw - 12)) + "px",
            top: Math.max(floor, Math.min(r ? r.y : top, innerHeight - ph - 12)) + "px" });
        },
      };
    },

    /** ドラッグで並べ替える（計算の表の見出し・列表示の窓の行・一覧のカードの項目で同じ）。鍵は各要素の data-col。
        axis: 前後どちらに入るかを上下（vertical）で決めるか左右（horizontal）で決めるか。
        canDrop(鍵, 相手の鍵) が偽の相手には落とせない（同じまとまりの中だけ など）。onDrop(鍵, 相手の鍵, 後ろか)。
        落とす先には drop-before／drop-after、掴んでいる要素には dragging のクラスが付く。 */
    dragSort(root, selector, { axis = "horizontal", canDrop = () => true, onDrop }) {
      let dragKey = null;
      const clear = () => root.querySelectorAll(".drop-before,.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
      const isAfter = (el, e) => { const r = el.getBoundingClientRect(); return axis === "vertical" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2; };
      root.querySelectorAll(selector).forEach((el) => {
        el.addEventListener("dragstart", (e) => { dragKey = el.dataset.col; e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); });
        el.addEventListener("dragend", () => { dragKey = null; el.classList.remove("dragging"); clear(); });
        el.addEventListener("dragover", (e) => {
          if (!dragKey || dragKey === el.dataset.col || !canDrop(dragKey, el.dataset.col)) return;
          e.preventDefault(); clear(); el.classList.add(isAfter(el, e) ? "drop-after" : "drop-before");
        });
        el.addEventListener("drop", (e) => {
          if (!dragKey) return;
          e.preventDefault(); const k = dragKey, after = isAfter(el, e); clear(); onDrop(k, el.dataset.col, after);
        });
      });
    },

    /** 権限区分 → 色の鍵（見出しの札 role-*・マスタの札 c-*）。登録が無い区分は一般ユーザー（user）。 */
    roleKey: (role) => ({ "開発者": "dev", "メンテナンス者": "maint", "設備作業者": "op" })[role] || "user",

    /** 待ちの窓（WAITING）。時間がかかると分かっている処理のあいだ、画面の上に「何を・どれを・いま何をしているか・何秒たったか」を出す。
        delay ms のうちに済めば出さない（速い処理でちらつかせない）。出ているあいだは後ろを触れない（Esc で後ろの窓も閉じない）。
        background: 窓だけ閉じて処理は続けてよい処理なら、「裏で続ける」（Esc でも）を出す（読むだけの処理。書き換える処理には出さない）。
        const w = TPA.waiting({ title, subject, from, now, note, delay, background });  w.now("いまのこと"); w.done();
        出ていたかは w.shown（済んだあとに「待たせた」ことを言うかどうかに使える）。 */
    waiting({ title, subject = "", from = "", now = "", note = "", delay = 350, background = false } = {}) {
      let el = null, timer = 0, tick = 0, done = false, back = false, prev = null;
      const t0 = performance.now();
      const sec = () => Math.floor((performance.now() - t0) / 1000);
      const blockEsc = (e) => {
        if (e.key !== "Escape" || !el) return;
        e.preventDefault(); e.stopPropagation();
        if (background) hide(true);
      };
      const hide = (toBack) => {
        if (toBack) back = true;
        clearInterval(tick);
        window.removeEventListener("keydown", blockEsc, true);
        if (el) { el.remove(); el = null; if (prev && prev.isConnected) prev.focus(); }
      };
      const show = () => {
        if (done || back) return;
        prev = document.activeElement;
        el = document.createElement("div");
        el.className = "fetch-overlay tpa-wait";
        el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-busy", "true");
        el.setAttribute("aria-label", title);
        el.innerHTML = `<div class="fetch-card" tabindex="-1">
            <div class="fetch-head"><h3>${TPA.esc(title)}</h3>${subject ? `<b class="fetch-lot">${TPA.esc(subject)}</b>` : ""}</div>
            ${from ? `<div class="fetch-route wait-from" title="${TPA.esc(from)}">${TPA.esc(from)}</div>` : ""}
            <div class="wait-now" aria-live="polite"><i class="wait-spin" aria-hidden="true"></i><span></span></div>
            ${note ? `<p class="wait-note" title="${TPA.esc(note)}">${TPA.esc(note)}</p>` : ""}
            <div class="fetch-foot"><span class="fetch-time" aria-label="経過">0 秒</span>
              ${background ? '<button type="button" class="btn-ghost wait-back" title="この窓を閉じます。処理は裏で続き、済むと画面に出ます">裏で続ける <kbd>Esc</kbd></button>' : ""}</div></div>`;
        document.body.append(el);
        el.querySelector(".wait-now span").textContent = now || "お待ちください…";
        el.querySelector(".wait-back")?.addEventListener("click", () => hide(true));
        window.addEventListener("keydown", blockEsc, true);
        el.querySelector(".fetch-card").focus();
        tick = setInterval(() => { if (el) el.querySelector(".fetch-time").textContent = `${sec()} 秒`; }, 250);
        api.shown = true;
      };
      const api = {
        shown: false,
        /** いま何をしているか（段が進んだら差し替える） */
        now(text) { now = text; if (el) el.querySelector(".wait-now span").textContent = text; },
        /** 済んだ（出ていれば閉じる）。何度呼んでもよい */
        done() { done = true; clearTimeout(timer); hide(false); },
        /** 「裏で続ける」を押したか */
        get background() { return back; },
      };
      timer = setTimeout(show, Math.max(0, delay));
      return api;
    },
  };
})();
