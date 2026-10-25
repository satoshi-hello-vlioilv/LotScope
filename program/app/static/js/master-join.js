/* データ元の結合の欄（版 3.53.0。services/data_join.py・routes/sources.py。決め方: ui-proposals/2026-10-join*〈2 回目の G〉）。
   マスタ管理の「データ元」で開いたカードの中に置き、ほかのデータ元（製造条件マスタ など）の列を、自由に組んだ鍵で合わせる。
   1 件の流れ（上から）: 相手 → 鍵（この元の列 ＝ 相手の列。いくつでも） → 方式（ベン図の 4 枚。残る行の数つき） → 持ってくる列 → 当たった数
   - 相手を選ぶと、名前の同じ列を鍵に入れておく（無ければ空の 1 行）
   - 組み終えた所から「試す」（POST /api/sources/join/preview）で、当たった・当たらない・相手だけ・相手の鍵の重なりを数え、
     方式の 4 枚にそれぞれ残る行の数を出す。言葉は選んだ方式に合わせる（外れる／空のまま残る／足す）
   - ベン図: 実線の円＝この元・点線の円＝相手（色だけに頼らない）。塗った所が残る行
   - 決まりは画面の外へは持たない。value() が置く形（[{with, how, on: [[この列, 相手の列]], cols}]）を返す
   使い方: MasterJoin.mount(箱, { self: データ元, sources: 全部のデータ元, can: 書けるか, request: masterRequest, onChange }) → { value() }
   結合した表（版 3.54.0）: self.base（元のキー）があれば「この元」は元の表。足す前は self.key を空にして、元に当てて試す */
window.MasterJoin = (() => {
  "use strict";
  const esc = (s) => TPA.esc(s);
  const HOWS = [["inner", "内部結合", "両方にある行だけ"], ["left", "左外部結合", "この元の行は全部残す"],
    ["right", "右外部結合", "相手の行は全部残す"], ["full", "完全外部結合", "両方の行を全部残す"]];
  const HOW_NAME = Object.fromEntries(HOWS.map(([k, n]) => [k, n]));
  const norm = (s) => String(s || "").normalize("NFKC").trim().toUpperCase();
  let uid = 0;
  /** ベン図（左の実線の円＝この元・右の点線の円＝相手。塗った所が残る行） */
  function venn(how, size = 40) {
    const id = `jv${++uid}`, L = how === "left" || how === "full", R = how === "right" || how === "full";
    return `<svg class="jn-v" viewBox="0 0 60 36" width="${size}" height="${Math.round(size * 0.6)}" aria-hidden="true">`
      + `<defs><clipPath id="${id}"><circle cx="23" cy="18" r="13"/></clipPath></defs>`
      + `<circle cx="23" cy="18" r="13" fill="${L ? "#9fc2ea" : "#fff"}"/><circle cx="37" cy="18" r="13" fill="${R ? "#9fc2ea" : "#fff"}"/>`
      + `<circle cx="37" cy="18" r="13" clip-path="url(#${id})" fill="#3f7fcf"/>`
      + '<circle cx="23" cy="18" r="13" fill="none" stroke="#2c5f99" stroke-width="1.8"/>'
      + '<circle cx="37" cy="18" r="13" fill="none" stroke="#a5661a" stroke-width="1.8" stroke-dasharray="3.2 2.4"/></svg>';
  }
  /** 閉じたカードの 1 行（結合ごと）。stats があれば当たった数も */
  function summary(s, names) {
    return (s.joins || []).map((j, i) => {
      const st = (s.joinStats || [])[i];
      return `<div class="jn-card">${venn(j.how, 36)}<span>結合 <b>${esc(names[j.with] || j.with)}</b> を<b class="jn-how">${HOW_NAME[j.how]}</b>`
        + `（${j.on.map(([a, b]) => `${esc(a)} = ${esc(b)}`).join("・")}）</span>`
        + (st ? `<span class="jn-ok">${st.hit.toLocaleString()} / ${st.rows.toLocaleString()} 行が当たる</span>` : "") + "</div>";
    }).join("");
  }
  /** 方式ごとに残る行の数（試した方式の答えから: 当たった行の出る数 m・相手が無い行 miss・相手だけ ro） */
  function counts(st) {
    if (!st) return null;
    const ro = st.rightOnly == null ? null : st.rightOnly;
    const m = st.out - (st.how === "left" || st.how === "full" ? st.miss : 0) - (st.how === "right" || st.how === "full" ? ro || 0 : 0);
    return { inner: m, left: m + st.miss, right: ro == null ? null : m + ro, full: ro == null ? null : m + st.miss + ro };
  }
  const sample = (st) => (st.missSample || []).length ? `（例: ${st.missSample.slice(0, 2).map((r) => r.map((v) => (v == null || v === "" ? "空" : v)).join(" / ")).map(esc).join("・")}）` : "";
  /** 当たった数の帯。言葉は選んだ方式に合わせる */
  function resultHtml(st, how, selfName, name) {
    const out = [`<b class="ok">✓ ${st.hit.toLocaleString()} 行が当たりました</b><span>（${esc(selfName)} ${st.rows.toLocaleString()} 行のうち）</span>`];
    if (st.miss) out.push(`<span class="ng">${st.miss.toLocaleString()} 行は相手が無いので${how === "inner" || how === "right" ? "外れます" : "、持ってくる列が空のまま残ります"}${sample(st)}</span>`);
    if (st.rightOnly && (how === "right" || how === "full")) out.push(`<span class="ng">${esc(name)}だけの ${st.rightOnly.toLocaleString()} 行を足します（${esc(selfName)}の列は空）</span>`);
    if (st.rightDup) out.push(`<span class="warn">⚠ ${esc(name)}に鍵が同じ組が ${st.rightDup.toLocaleString()} あります。当たった行が 2 行以上に増えます（相手の行を 1 つにするか、鍵を足してください）</span>`);
    return out.join("");
  }

  function mount(box, { self, sources, can, request, onChange = () => {} }) {
    // 結合した表（版 3.54.0）: 「この元」は元（self.base）の表。足す前の結合した表は key が空で、元に当てて試す
    const targets = sources.filter((d) => d.kind === "file" && d.key !== self.key && d.key !== self.base);
    const selfCols = self.key || self.base;
    const nameOf = (k) => (sources.find((d) => d.key === k) || {}).name || k;
    let items = (self.joins || []).map((j) => ({ ...j, on: j.on.map((p) => [...p]), cols: [...(j.cols || [])] }));
    const stats = [], cols = {};
    let note = "", timer = 0, seq = 0;
    const dis = can ? "" : " disabled";
    /** 列の手がかり（元のままの列。写しがまだ無ければ写し終えるまで待って読み直す） */
    function columns(key) {
      if (cols[key]) return cols[key];
      const c = cols[key] = { list: null, error: "" };
      request(`/api/sources/${encodeURIComponent(key)}/columns`, { cache: "no-store" }).then((r) => {
        if (r.ok) c.list = r.data.columns || [];
        else if (r.data && r.data.kind === "copying") { c.error = "ファイルを手元へ写しています…"; setTimeout(() => { delete cols[key]; if (box.isConnected) paint(); }, 2000); }
        else c.error = (r.data && r.data.error) || "列を読めませんでした";
        if (box.isConnected) paint();
      });
      return c;
    }
    /** i 件目の結合で「この元」が持つ列（元の列＋前の結合で持ってきた列） */
    function leftCols(i) {
      const base = columns(selfCols).list;
      if (!base) return null;
      const out = [...base];
      items.slice(0, i).forEach((j) => {
        const r = j.with && columns(j.with).list;
        if (!r) return;
        const keys = new Set(j.on.map((p) => p[1]));
        (j.cols.length ? r.filter((c) => j.cols.includes(c)) : r.filter((c) => !keys.has(c)))
          .forEach((c) => out.push(out.includes(c) ? `${c}（${nameOf(j.with)}）` : c));
      });
      return out;
    }
    const complete = (j) => j.with && j.on.length && j.on.every(([a, b]) => a && b);
    const value = () => items.filter(complete).map((j) => ({ with: j.with, how: j.how, on: j.on.map((p) => [...p]), cols: [...j.cols] }));
    function changed({ structure = true } = {}) {
      stats.length = 0; note = "";
      if (structure) paint(); else paintResults();
      onChange(value());
      clearTimeout(timer); timer = setTimeout(preview, 450);
    }
    /** 試す: 組み終えた結合までを当てて数える（組み終えていない結合があれば、その前まで） */
    async function preview() {
      const upto = items.findIndex((j) => !complete(j));
      const joins = value().slice(0, upto < 0 ? items.length : upto);
      if (!joins.length) return;
      const my = ++seq;
      note = "wait"; paintResults();
      const r = await request("/api/sources/join/preview", TPA.json("POST", self.key ? { key: self.key, joins } : { base: self.base, joins }));
      if (my !== seq || !box.isConnected) return;
      stats.length = 0;
      if (r.ok) { (r.data.stats || []).forEach((s, i) => { stats[i] = s; }); note = ""; }
      else if (r.data && r.data.kind === "copying") { note = "相手のファイルを手元へ写しています…（写し終えると数が出ます）"; setTimeout(preview, 2000); }
      else note = `✕ ${(r.data && r.data.error) || "数えられませんでした"}`;
      paintResults();
    }
    const opt = (list, cur, empty) => `${empty != null ? `<option value=""${cur ? "" : " selected"}>${esc(empty)}</option>` : ""}`
      + (list || []).map((c) => `<option${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("")
      + (cur && list && !list.includes(cur) ? `<option selected>${esc(cur)}（ありません）</option>` : "");
    function itemHtml(j, i) {
      const L = leftCols(i), rc = j.with ? columns(j.with) : null, R = rc && rc.list, other = j.with ? nameOf(j.with) : "相手";
      const keys = new Set(j.on.map((p) => p[1]));
      const head = `<div class="jn-top"><label class="jn-with"><span class="jn-lab">相手</span><select data-jn-with${dis}>`
        + `<option value=""${j.with ? "" : " selected"}>選んでください…</option>${targets.map((d) => `<option value="${esc(d.key)}"${d.key === j.with ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>`
        + (rc && rc.error ? `<span class="jn-msg">${esc(rc.error)}</span>` : "")
        + (can ? `<button type="button" class="jn-del" data-jn-del title="この結合を外す（保存すると効きます）">外す</button>` : "") + "</div>";
      if (!j.with) return `<div class="jn-item" data-jn-i="${i}">${head}</div>`;
      const keyRows = j.on.map(([a, b], k) => `<div class="jn-k" data-jn-key="${k}"><span class="jn-side l">${esc(self.name)}</span>`
        + `<select data-jn-l${dis}>${opt(L, a, "列を選ぶ…")}</select><b class="jn-eq" aria-label="が同じ">＝</b><span class="jn-side r">${esc(other)}</span>`
        + `<select data-jn-r${dis}>${opt(R, b, "列を選ぶ…")}</select>`
        + (can && j.on.length > 1 ? `<button type="button" class="jn-x" data-jn-delkey title="この鍵を外す" aria-label="この鍵を外す">×</button>` : "<span></span>") + "</div>").join("");
      const n = counts(stats[i]);
      const cards = HOWS.map(([k, name, tip]) => `<button type="button" role="radio" aria-checked="${k === j.how}" data-jn-how="${k}"${dis}>`
        + `${venn(k, 54)}<span><b>${name}</b><small>${k === "left" ? `${esc(self.name)}の行は全部残す` : k === "right" ? `${esc(other)}の行は全部残す` : tip}</small>`
        + `<em>${n && n[k] != null ? `${n[k].toLocaleString()} 行` : "　"}</em></span></button>`).join("");
      const bring = (R || []).filter((c) => !keys.has(c));
      const chips = bring.map((c) => `<label class="jn-c"><input type="checkbox" data-jn-col="${esc(c)}"${!j.cols.length || j.cols.includes(c) ? " checked" : ""}${dis}>${esc(c)}</label>`).join("");
      return `<div class="jn-item" data-jn-i="${i}">${head}
        <div class="jn-keys"><span class="jn-lab">鍵（全部が同じ値の行を合わせる）</span>${keyRows}
          ${can ? '<button type="button" class="jn-addk" data-jn-addkey>＋ 鍵を足す</button>' : ""}</div>
        <div class="jn-hows"><span class="jn-lab">方式（どの行を残すか）<small>実線の円＝${esc(self.name)}・点線の円＝${esc(other)}・塗った所が残る行</small></span>
          <div class="jn-cards" role="radiogroup" aria-label="結合の方式">${cards}</div></div>
        <div class="jn-cols"><span class="jn-lab">持ってくる列</span>${chips || '<span class="jn-msg">列を読んでいます…</span>'}</div>
        <div class="jn-res" data-jn-res aria-live="polite"></div></div>`;
    }
    function paintResults() {
      items.forEach((j, i) => {
        const el = box.querySelector(`[data-jn-i="${i}"] [data-jn-res]`); if (!el) return;
        const st = stats[i];
        el.className = `jn-res${st ? "" : note.startsWith("✕") ? " is-ng" : " is-wait"}`;
        el.innerHTML = st ? resultHtml(st, j.how, self.name, nameOf(j.with))
          : !complete(j) ? "鍵の列を両方とも選ぶと、当たる行の数を出します。"
            : note === "wait" ? "数えています…" : esc(note || "数えています…");
        const n = counts(st);
        box.querySelectorAll(`[data-jn-i="${i}"] [data-jn-how]`).forEach((b) => { b.querySelector("em").textContent = n && n[b.dataset.jnHow] != null ? `${n[b.dataset.jnHow].toLocaleString()} 行` : "　"; });
      });
    }
    function paint() {
      const focus = document.activeElement && box.contains(document.activeElement) ? focusPath(document.activeElement) : null;
      box.innerHTML = `<div class="jn-h"><b>結合</b><small>ほかのデータ元の列を、鍵が同じ行から持ってきます（上から順に重ねます）</small></div>`
        + items.map(itemHtml).join("")
        + (can ? `<button type="button" class="pz-btn jn-add" data-jn-add${targets.length ? "" : ' disabled title="合わせられるデータ元がありません（データ元を足すと選べます）"'}>＋ 結合を足す${items.length ? "（この答えに、さらに重ねる）" : ""}</button>` : "")
        + (!items.length && !can ? '<p class="jn-msg">結合はありません。</p>' : "");
      paintResults();
      if (focus) { const el = box.querySelector(focus); if (el) el.focus(); }
    }
    const focusPath = (el) => {
      const it = el.closest("[data-jn-i]"), k = el.closest("[data-jn-key]");
      const attr = ["data-jn-with", "data-jn-l", "data-jn-r", "data-jn-how", "data-jn-col", "data-jn-addkey", "data-jn-add"].find((a) => el.hasAttribute(a));
      if (!attr) return null;
      const v = el.getAttribute(attr);
      return `${it ? `[data-jn-i="${it.dataset.jnI}"] ` : ""}${k ? `[data-jn-key="${k.dataset.jnKey}"] ` : ""}[${attr}${v ? `="${CSS.escape(v)}"` : ""}]`;
    };
    /** 相手を選んだ: 名前の同じ列を鍵に入れておく（無ければ空の 1 行） */
    function suggest(j, i) {
      const L = leftCols(i), R = columns(j.with).list;
      if (!L || !R) { j.on = [["", ""]]; j.pending = true; return; }
      const byName = new Map(R.map((c) => [norm(c), c]));
      const same = L.map((c) => [c, byName.get(norm(c))]).filter(([, b]) => b);
      j.on = same.length ? same.slice(0, 3) : [["", ""]];
      j.pending = false;
    }
    box.addEventListener("change", (e) => {
      const t = e.target, it = t.closest("[data-jn-i]"); if (!it) return;
      const i = +it.dataset.jnI, j = items[i];
      if (t.matches("[data-jn-with]")) { j.with = t.value; j.cols = []; suggest(j, i); changed(); return; }
      const k = t.closest("[data-jn-key]");
      if (k && t.matches("[data-jn-l]")) { j.on[+k.dataset.jnKey][0] = t.value; changed(); return; }
      if (k && t.matches("[data-jn-r]")) { j.on[+k.dataset.jnKey][1] = t.value; changed(); return; }
      if (t.matches("[data-jn-col]")) {
        const all = [...it.querySelectorAll("[data-jn-col]")], on = all.filter((x) => x.checked).map((x) => x.dataset.jnCol);
        j.cols = on.length === all.length ? [] : on;
        changed({ structure: false });
      }
    });
    box.addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t || t.disabled) return;
      if (t.matches("[data-jn-add]")) { items.push({ with: "", how: "left", on: [], cols: [] }); paint(); box.querySelector(`[data-jn-i="${items.length - 1}"] [data-jn-with]`)?.focus(); onChange(value()); return; }
      const it = t.closest("[data-jn-i]"); if (!it) return;
      const i = +it.dataset.jnI, j = items[i];
      if (t.matches("[data-jn-del]")) { items.splice(i, 1); changed(); return; }
      if (t.matches("[data-jn-addkey]")) { j.on.push(["", ""]); paint(); box.querySelector(`[data-jn-i="${i}"] [data-jn-key="${j.on.length - 1}"] [data-jn-l]`)?.focus(); onChange(value()); return; }
      if (t.matches("[data-jn-delkey]")) { j.on.splice(+t.closest("[data-jn-key]").dataset.jnKey, 1); changed(); return; }
      if (t.matches("[data-jn-how]") && t.dataset.jnHow !== j.how) {
        j.how = t.dataset.jnHow;
        box.querySelectorAll(`[data-jn-i="${i}"] [data-jn-how]`).forEach((b) => b.setAttribute("aria-checked", String(b === t)));
        // 数は方式によらず同じ答えから出せる（試し直さない）。言葉だけ替える
        const keep = stats[i]; paintResults(); onChange(value());
        if (keep) { clearTimeout(timer); timer = setTimeout(preview, 450); }
      }
    });
    // 方式の札は ← → でも替えられる（ラジオの作法）
    box.addEventListener("keydown", (e) => {
      const t = e.target.closest("[data-jn-how]"); if (!t || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const all = [...t.parentElement.querySelectorAll("[data-jn-how]")], n = all[(all.indexOf(t) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      n.click(); n.focus();
    });
    // 相手の列を読み終えたら、相手を選んだ直後の鍵の見当を入れ直す
    const heal = () => items.forEach((j, i) => { if (j.pending && columns(j.with).list && leftCols(i)) { suggest(j, i); changed(); } });
    const tick = setInterval(() => { if (!box.isConnected) clearInterval(tick); else heal(); }, 400);
    paint();
    if (items.length) { clearTimeout(timer); timer = setTimeout(preview, 50); }
    return { value };
  }
  return { mount, summary, venn };
})();
