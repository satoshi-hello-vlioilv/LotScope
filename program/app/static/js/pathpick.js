/* フォルダ・ファイルの欄の補助（版 3.29.0。7 案＋2 回目で選んだ M1: ui-proposals/2026-10-pathpick*）。
   欄の横の「参照…」で、アプリの中のフォルダを選ぶ窓を開く（よく使う場所・中身の印つき）。欄の下には、よく使う場所の札（押すと入る）。
   窓の中身はサーバー（services/folder_browse.py）が読む。アプリの中身はこの PC で動くので、見えるのはこの PC のエクスプローラーと同じ所。

     TPA.pathPick(input, { purpose, title, note, pattern, chipsAfter, exclude, onPick })
       purpose   … 欄の目的。master（マスタの置き場）・release（配布の置き場）・worklog（作業実績）・folder・sqlite・exe
                     （印と、選ぶ物〈フォルダかファイルか〉が変わる）
       chipsAfter… よく使う場所の札を置く所（この要素の後ろ）。省けば札は出さない
       exclude   … 札に出さない場所の鍵（例 ["master"]。いまの置き場そのものは上のフォルダに選べない）
       disabled  … 使えないとき（字なら、その理由をボタンの説明に）
       onPick(path, item) … 選んだとき。省けば欄に入れて input を起こす（欄の確かめがそのまま走る）。item は窓の行（印 mark つき）か札
   欄はそのまま打てる（覚えている人・貼る人はいままでどおり）。貼った "…"・file:/// は整える。 */
(() => {
  const esc = (s) => TPA.esc(s);
  const FILE = { sqlite: "ファイル", exe: "ファイル" };
  const ICON = { app: { master: "🗂", oldmaster: "🗂", quality: "📌", worklog: "📌", release: "☁" }, pc: "🖥" };
  let placesP = null;   // よく使う場所（頁で 1 回。窓を開くたびに読み直す）
  const loadPlaces = (fresh = false) => {
    if (!placesP || fresh) placesP = fetch("/api/fs/places", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => d.items || []).catch(() => []);
    return placesP;
  };
  const browse = (path, purpose, pattern) => fetch("/api/fs/browse", TPA.json("POST", { path, purpose, pattern }))
    .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) })).catch((e) => ({ ok: false, error: "アプリに届きません: " + e.message }));
  /** 貼った字を整える（前後の "" ' と空白、file:/// を外す。サーバーの clean と同じ考え。%USERPROFILE% はサーバーで） */
  const tidy = (s) => {
    let t = String(s || "").trim().replace(/^["']+|["']+$/g, "").trim();
    if (/^file:/i.test(t)) {
      try {
        const u = new URL(t), p = decodeURIComponent(u.pathname);
        t = u.host && u.host !== "localhost" ? `\\\\${u.host}${p.replace(/\//g, "\\")}` : /^\/[A-Za-z]:/.test(p) ? p.slice(1).replace(/\//g, "\\") : p;
      } catch (_) { /* そのまま */ }
    }
    return t;
  };
  /** 1 つ上のフォルダ（字の上で。共有は \\サーバー\共有 より上へは行かない） */
  const up = (p) => { const m = /^(\\\\[^\\]+\\[^\\]+)$/.test(p) ? null : p.match(/^(.*)[\\/][^\\/]+$/); const u = m ? m[1] || p.slice(0, 1) : p; return /^[A-Za-z]:$/.test(u) ? u + "\\" : u; };
  const same = (a, b) => tidy(a).replace(/[\\/]+$/, "").toLowerCase() === tidy(b).replace(/[\\/]+$/, "").toLowerCase();
  const when = (iso) => String(iso || "").replace("T", " ").replace(/-/g, "/");

  /* ---------------- 欄の下の札（よく使う場所） ---------------- */
  async function paintChips(box, input, o) {
    const items = (await loadPlaces()).filter((x) => x.group === "app" && x.reach !== false && !(o.exclude || []).includes(x.key));
    const shown = items.filter((x) => !same(x.path, input.value));
    box.hidden = !shown.length;
    box.innerHTML = shown.length ? `<b class="pp-chips-h">よく使う場所</b>` + shown.map((x, i) =>
      `<button type="button" class="pp-chip" data-i="${i}" title="${esc(x.path)}"><code>${esc(x.path)}</code><small>${esc(x.label)}</small></button>`).join("") : "";
    box.querySelectorAll(".pp-chip").forEach((b) => { b.onclick = () => pick(input, o, shown[+b.dataset.i].path, shown[+b.dataset.i]); });
  }
  function pick(input, o, path, item) {
    if (o.onPick) o.onPick(path, item || {});
    else { input.value = path; input.dispatchEvent(new Event("input", { bubbles: true })); }
    input.focus();
    if (o._chips) paintChips(o._chips, input, o);
  }

  /* ---------------- 参照… の窓 ---------------- */
  let open = null;      // いま開いている窓（1 つだけ）
  function openDialog(input, btn, o) {
    if (open) open.close();
    const kind = FILE[o.purpose] ? "file" : "folder", what = FILE[o.purpose] || "フォルダ";
    const dlg = document.createElement("div");
    dlg.className = "pp-dlg";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-label", o.title || `${what}を選ぶ`);
    dlg.innerHTML = `<div class="pp-hd"><b>${esc(o.title || `${what}を選ぶ`)}</b><small>${esc(o.note || "")}</small>
        <button type="button" class="pp-x" data-pp="close" aria-label="閉じる">×</button></div>
      <div class="pp-bar"><button type="button" class="pp-up" data-pp="up" title="上のフォルダへ（Backspace）">↑</button><nav class="pp-crumb" aria-label="いまのフォルダ"></nav></div>
      <div class="pp-body"><nav class="pp-side" aria-label="よく使う場所"></nav>
        <div class="pp-main"><div class="pp-state is-wait" aria-live="polite">読んでいます…</div><div class="pp-list" role="listbox" tabindex="0" aria-label="フォルダの中" aria-busy="true"></div></div></div>
      <div class="pp-ft"><input class="pp-addr" spellcheck="false" autocomplete="off" aria-label="アドレス（打って Enter でそこへ）" placeholder="アドレスを打つ・貼る（Enter でそこへ）">
        <button type="button" class="pp-btn" data-pp="close">やめる</button><button type="button" class="pp-go" data-pp="go">この${what}を選ぶ</button></div>`;
    document.body.appendChild(dlg);
    const $ = (s) => dlg.querySelector(s), list = $(".pp-list"), addr = $(".pp-addr"), go = $(".pp-go");
    const st = { cur: null, sel: -1, seq: 0 };
    const place = () => {
      const r = (btn.closest(".pp-row") || input).getBoundingClientRect(), w = Math.min(820, innerWidth - 24);
      dlg.style.width = `${w}px`;
      const below = innerHeight - r.bottom - 14, above = r.top - 14, h = Math.min(520, Math.max(below, above));
      dlg.style.height = `${Math.max(300, h)}px`;
      dlg.style.left = `${Math.round(Math.max(12, Math.min(r.left, innerWidth - w - 12)))}px`;
      dlg.style.top = `${Math.round(below >= Math.min(420, above) ? r.bottom + 6 : Math.max(8, r.top - 6 - Math.max(300, h)))}px`;
    };
    place();
    /** 選ぶ物（行を選んでいればその行、フォルダを選ぶ欄で選んでいなければ、いまのフォルダ） */
    const chosen = () => {
      const e = st.cur && st.cur.entries[st.sel];
      if (kind === "file") return e && !e.dir ? e : null;
      return e && e.dir ? e : st.cur && st.cur.path ? { path: st.cur.path, name: st.cur.path, dir: true, mark: st.cur.mark } : null;
    };
    // 下の欄は、選ぶ物のアドレス（打っている途中は書き換えない。移ったあと〈force〉は、届いた所に合わせる）
    const paintFoot = (force = false) => {
      const c = chosen();
      go.disabled = !c;
      go.title = c ? c.path : kind === "file" ? "選ぶファイルを押してください" : "";
      if (force || document.activeElement !== addr) addr.value = c ? c.path : (st.cur && st.cur.path) || "";
    };
    const selectRow = (i, scroll = true) => {
      st.sel = i;
      list.querySelectorAll(".pp-row-i").forEach((r) => r.setAttribute("aria-selected", String(+r.dataset.i === i)));
      if (scroll) list.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
      paintFoot();
    };
    const say = (cls, text) => { const s = $(".pp-state"); s.className = `pp-state ${cls}`; s.textContent = text; s.hidden = !text; };
    const paint = (d) => {
      st.cur = d; st.sel = -1;
      list.removeAttribute("aria-busy");   // 開いた直後から読み終えるまでは「読んでいます…」（最初の読みの前も）
      $(".pp-crumb").innerHTML = (d.crumbs || []).map((c, i, a) => `<button type="button" class="pp-c${i === a.length - 1 ? " is-here" : ""}" data-path="${esc(c.path)}">${esc(c.name)}</button>`).join('<i aria-hidden="true">›</i>')
        || '<span class="pp-c-none">左の場所から選ぶか、下にアドレスを打ってください</span>';
      $(".pp-up").disabled = !d.parent;
      const rows = (d.entries || []).map((e, i) => `<div class="pp-row-i${e.dir ? "" : " is-file"}" role="option" data-i="${i}" aria-selected="false">
          <span class="pp-ic" aria-hidden="true">${e.dir ? "📁" : "📄"}</span><span class="pp-nm">${esc(e.name)}</span>
          ${e.mark ? `<em class="pp-mk is-${e.mark.tone}">${esc(e.mark.text)}</em>` : "<span></span>"}<time>${esc(when(e.mtime))}</time></div>`).join("");
      const empty = d.path && !(d.entries || []).length ? `<p class="pp-empty">${kind === "file" ? `選べるファイル（${o.purpose === "exe" ? ".exe" : ".sqlite3"}）もフォルダもありません` : "中にフォルダはありません"}${d.others ? `（ファイル ${d.others} 個）` : ""}</p>` : "";
      list.innerHTML = rows + empty + (d.more ? `<p class="pp-empty">ほか ${d.more} 件（アドレスを打って絞ってください）</p>` : "");
      const here = d.mark ? `このフォルダ: ${d.mark.text}` : "";
      say(d.problem ? "is-ng" : here ? "is-ok" : "", d.problem || d.error || here);
      if (d.file) selectRow((d.entries || []).findIndex((e) => e.name === d.file));
      paintFoot(true);
      paintSide();
    };
    const goTo = async (path) => {
      const my = ++st.seq;
      say("is-wait", "読んでいます…");
      list.setAttribute("aria-busy", "true");
      const d = await browse(path, o.purpose, typeof o.pattern === "function" ? o.pattern() : o.pattern || "");
      if (my !== st.seq || !dlg.isConnected) return;
      paint(d.ok === false && !d.crumbs ? { problem: d.error || "読めませんでした。", entries: [] } : d);
    };
    let places = [];
    const paintSide = () => {
      const grp = (g, h) => { const xs = places.filter((x) => x.group === g); return xs.length ? `<h5>${h}</h5>` + xs.map((x) => {
        const i = places.indexOf(x), on = st.cur && st.cur.path && same(x.path, st.cur.path);
        return `<button type="button" class="pp-pl${on ? " is-on" : ""}${x.reach === false ? " is-off" : ""}" data-pl="${i}" title="${esc(x.path)}${x.reach === false ? "（届きません）" : ""}">
          <span>${g === "pc" ? ICON.pc : ICON.app[x.key] || "📌"} ${esc(x.label)}</span><small>${esc(x.path)}</small></button>`; }).join("") : ""; };
      $(".pp-side").innerHTML = grp("app", "このアプリで使っている場所") + grp("pc", "この PC");
    };
    loadPlaces(true).then((xs) => { places = xs; if (dlg.isConnected) paintSide(); });

    const choose = () => {
      const c = chosen();
      if (!c) return;
      close();
      pick(input, o, c.path, c);
    };
    dlg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pp],[data-path],[data-pl],.pp-row-i");
      if (!b) return;
      if (b.dataset.pp === "close") close();
      else if (b.dataset.pp === "go") choose();
      else if (b.dataset.pp === "up") { if (st.cur && st.cur.parent) goTo(st.cur.parent); }
      else if (b.dataset.path) goTo(b.dataset.path);
      else if (b.dataset.pl) goTo(places[+b.dataset.pl].path);
      else selectRow(+b.dataset.i, false);
    });
    // フォルダは 2 回押す（Enter）と中へ、ファイルは 2 回押すと選ぶ
    list.addEventListener("dblclick", (e) => {
      const r = e.target.closest(".pp-row-i"); if (!r) return;
      const x = st.cur.entries[+r.dataset.i];
      if (x.dir) goTo(x.path); else { selectRow(+r.dataset.i); choose(); }
    });
    list.addEventListener("keydown", (e) => {
      const n = (st.cur && st.cur.entries.length) || 0;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (n) selectRow(Math.max(0, Math.min(n - 1, st.sel + (e.key === "ArrowDown" ? 1 : -1)))); }
      else if (e.key === "Enter") { e.preventDefault(); const x = st.cur && st.cur.entries[st.sel]; if (x && x.dir && !e.ctrlKey) goTo(x.path); else choose(); }
      else if (e.key === "Backspace") { e.preventDefault(); if (st.cur && st.cur.parent) goTo(st.cur.parent); }
    });
    addr.addEventListener("keydown", (e) => { if (e.key === "Enter" && !TPA.composing(e)) { e.preventDefault(); goTo(tidy(addr.value)); } });
    const off = TPA.dismissable(dlg, () => close(), { keep: btn, event: "mousedown" });
    const onResize = () => place();
    addEventListener("resize", onResize);
    function close() {
      if (!dlg.isConnected) return;
      off(); removeEventListener("resize", onResize);
      dlg.remove(); btn.setAttribute("aria-expanded", "false");
      if (open && open.dlg === dlg) open = null;
      btn.focus();
    }
    open = { dlg, close, btn };
    btn.setAttribute("aria-expanded", "true");
    loadPlaces().then((xs) => {
      // 始める所: 欄の値（ファイルならそのフォルダでファイルを選んだ形）。空なら、このアプリで使っている最初の届く場所
      // （フォルダを選ぶ欄はその 1 つ上から: その場所と並ぶフォルダが見え、置く場所を決めやすい）
      const v = tidy(input.value), first = xs.find((x) => x.group === "app" && x.reach) || xs.find((x) => x.reach);
      if (v) goTo(v);
      else if (first) goTo(kind === "folder" && first.group === "app" ? up(first.path) : first.path);
      else paint({ entries: [], crumbs: [] });
    });
    requestAnimationFrame(() => list.focus());
  }

  /** 欄に補助を付ける（参照… のボタン・よく使う場所の札）。同じ欄に 2 回付けない。 */
  TPA.pathPick = (input, o = {}) => {
    if (!input || input.dataset.pathPick) return;
    input.dataset.pathPick = "1";
    const row = document.createElement("span");
    row.className = "pp-row";
    input.before(row);
    row.append(input);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pp-open";
    btn.textContent = FILE[o.purpose] ? "📄 参照…" : "📁 参照…";
    btn.title = `${FILE[o.purpose] || "フォルダ"}を選ぶ窓を開きます（中身を見ながら選べます）`;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.disabled = input.disabled || !!o.disabled;
    if (o.disabled && typeof o.disabled === "string") btn.title = o.disabled;
    row.append(btn);
    btn.onclick = () => (open && open.btn === btn ? open.close() : openDialog(input, btn, o));
    input.addEventListener("paste", () => setTimeout(() => {
      const t = tidy(input.value);
      if (t !== input.value) { input.value = t; input.dispatchEvent(new Event("input", { bubbles: true })); }
    }));
    if (o.chipsAfter && !input.disabled && !o.disabled) {
      const box = document.createElement("div");
      box.className = "pp-chips";
      box.hidden = true;
      o.chipsAfter.after(box);
      o._chips = box;
      paintChips(box, input, o);
      input.addEventListener("input", () => paintChips(box, input, o));
    }
  };
  TPA.pathTidy = tidy;
})();
