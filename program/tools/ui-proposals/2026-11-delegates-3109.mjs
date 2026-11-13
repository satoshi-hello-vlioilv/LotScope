// 版 3.109.0 の画面の提案（3.108.0 の採点で次の版に回した 4 つ）の案。マスタ管理の読めない行の面:
//   (1) 消す確かめの面に行の中身（何のマスタ・行の要約・理由）を添える  (2) 消した後に一言を出す
//   (3) 一覧の面の × の色を、確かめの面の赤い「× 消す」にそろえる      (4) データ元・実績の設備の面の言葉「一覧では飛ばしています」を今の形に
//
// 撮り方（ui-variants.mjs。開発用サーバーに読めない行を足す TPA_UI_BAD_ROWS=1。段は TPA_PHASE で選ぶ）:
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=menu    node program/tools/ui-variants.mjs 出力/menu    program/tools/ui-proposals/2026-11-delegates-3109.mjs --states master --from master [--view 1536x864]
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=confirm node …（同じ）出力/confirm …  … 一覧の面の 1 つ目の × を押して確かめを開いた所
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=after   node …（同じ）出力/after   … 確かめで消した直後（本当に消す。案ごとに --only で撮り、案ごとに作り直したサーバーで消す）
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=src     node …（同じ）出力/src     … データ元のタブで、データ元の読めない行の面を開いた所
// 状態 master（ui-harness.mjs）はマスタ管理を開いて 900ms 待って撮る。案の文（下の run）は読み込みのときに入り、マスタ管理の帯に札が出たら
// 段の操作を自分で進める（待つのは 50ms おき）。データ元の読めない行は開発用サーバーに無いので、本物の部品（TPA.skipNote・openSkip）に
// 作った知らせ（データ元の 5 行目・id 31・キー 'b2'・確かめる間隔が数ではありません）を渡して開く。
//
// 案の方向: A 足す（面に中身・下に一言）／B 流れを変える（面の中で 2 度押し・結果も面の中）／C 置き場を変える（真ん中の確かめの窓）／
// D 見せ方（右に「消す」の札・結果を帯の札に残す）／E 減らす（言葉だけ: 頭に中身・件数の行に一言）／F 流れを変える（写しを残し「元に戻す」）

const PHASE = process.env.TPA_PHASE || "menu";

/** 頁の中で動く文（案の設定 V と段 PHASE）。TPA.openSkip・skipDelete を案の形に替え、段の操作を進める */
function run(V, PHASE) {
  const RED = "#b42318";
  const done = { phase: false };
  const css = document.createElement("style");
  css.textContent = `
    .v-toast{position:fixed;left:50%;bottom:120px;width:max-content;transform:translateX(-50%);z-index:200;display:flex;align-items:center;gap:12px;max-width:min(960px,calc(100vw - 32px));
      padding:10px 16px;border-radius:10px;background:#1f2a35;color:#fff;font-size:13px;line-height:1.45;box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .v-toast b{color:#9be7b0;font-weight:800}
    .v-toast button{flex:none;border:1px solid #9fb3c4;background:transparent;color:#fff;border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer}
    .v-dlg-back{position:fixed;inset:0;z-index:190;background:rgba(15,23,32,.35);display:flex;align-items:center;justify-content:center}
    .v-dlg{width:min(520px,calc(100vw - 32px));background:var(--surface,#fff);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.3);padding:18px 20px 16px;color:var(--ink,#16202b)}
    .v-dlg h3{margin:0 0 12px;font-size:16px;font-weight:800}
    .v-dlg dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0 0 12px;font-size:13px}
    .v-dlg dt{color:#5b6773;font-weight:700}.v-dlg dd{margin:0;overflow-wrap:anywhere}
    .v-dlg p{margin:0 0 14px;font-size:12px;color:#4f5b66;line-height:1.5}
    .v-dlg .v-btns{display:flex;justify-content:flex-end;gap:10px}
    .v-dlg .v-btns button{min-width:96px;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:1px solid #c5ced9;background:#fff;color:#16202b}
    .v-dlg .v-btns .v-del{background:${RED};border-color:${RED};color:#fff}
    .v-done-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 10px;border-radius:999px;background:#e5f5ea;color:#1e6b3a;border:1px solid #9fd3ae;font-size:11.5px;font-weight:800;white-space:nowrap}
    .v-count-note{margin-left:10px;color:#1e6b3a;font-weight:700;font-size:13px}
    ${V.redX ? `.tpa-skipmenu button:not(:disabled):not(.is-danger) .tm-ico{color:${RED};font-weight:800}` : ""}
    ${V.pill ? `.tpa-skipmenu button:not(:disabled) kbd{font:700 11.5px/1 system-ui,sans-serif;color:${RED};border:1px solid #f0b8b2;background:#fdecea;border-radius:999px;padding:3px 8px}` : ""}
    .tpa-skipmenu button .v-row{display:block;color:#3c4752;font-weight:600;overflow-wrap:anywhere;white-space:normal}`;
  document.head.append(css);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 50) { const x = f(); if (x) return x; await wait(50); } return null; };
  const toast = (html, withUndo) => {
    document.querySelector(".v-toast")?.remove();
    const el = document.createElement("div"); el.className = "v-toast"; el.setAttribute("role", "status");
    el.innerHTML = `<span>${html}</span>${withUndo ? '<button type="button">元に戻す</button>' : ""}`;
    document.body.append(el);
  };
  const SRC_FILES = ["data_sources", "work_log_files"];
  // 何行目・中身・理由（面と確かめと一言で同じ言葉）
  const rowText = (s) => `${s.row} 行目${s.summary ? `（${s.summary}）` : ""}`;

  function install() {
    const T = window.TPA;
    if (!T || T.__v) return !!T;
    T.__v = true;
    if (V.confirm === "orig") return true;   // 今の画面: 部品は替えず、段の操作だけ進める
    const origOpen = T.openSkip.bind(T);
    // 面の言葉: データ元・実績の設備は読みでは使う（版 3.108.0 から隔てない）
    T.openSkip = function (btn) {
      const r = origOpen(btn);
      const m = document.querySelector(".tpa-skipmenu"); if (!m) return r;
      window.__vRect = m.getBoundingClientRect();   // 2 度押し（B）は同じ所に開き直す
      const it = window.__vSkips?.get(btn.dataset.skip);
      const file = it?.file || btn.dataset.vfile || "";
      m.querySelectorAll(".tm-group").forEach((g) => {
        if (g.textContent.startsWith("この画面の行") && SRC_FILES.includes(file)) g.textContent = V.srcGroup;
      });
      if (SRC_FILES.includes(file) && V.srcFoot) {
        const last = [...m.querySelectorAll("button[role=menuitem]")].pop();
        last?.insertAdjacentHTML("afterend", `<p class="tm-group" style="border-top:0;padding-top:0;font-weight:600;color:#4f5b66">${T.esc(V.srcFoot)}</p>`);
      }
      if (V.pill) m.querySelectorAll("button[role=menuitem]:not(:disabled)").forEach((b) => {
        if (!b.querySelector("kbd")) b.insertAdjacentHTML("beforeend", "<kbd>消す</kbd>");
        b.querySelector(".tm-ico").textContent = "";
      });
      // 「× の行は…」の言葉も札に合わせる（× を外したので）
      if (V.pill) m.querySelectorAll("button[role=menuitem]:disabled > span").forEach((sp) => {
        if (sp.firstChild && sp.firstChild.nodeType === 3) sp.firstChild.textContent = sp.firstChild.textContent.replace("× の行は押すと消せます", "「消す」の行は押すと消せます");
      });
      return r;
    };
    T.skipDelete = async function (it, s, url) {
      const what = T.skipWhat(it.file, s.source || "");
      const ask = () => new Promise((resolve) => {
        if (V.confirm === "dialog") {
          const back = document.createElement("div"); back.className = "v-dlg-back";
          back.innerHTML = `<div class="v-dlg" role="dialog" aria-modal="true"><h3>${T.esc(what)}の読めない行を消しますか</h3>
            <dl><dt>ファイル</dt><dd>${T.esc(it.file)}.json の ${s.row} 行目</dd><dt>中身</dt><dd>${T.esc(s.summary || "（要約なし）")}</dd>
            <dt>理由</dt><dd>${T.esc(s.why)}</dd></dl><p>消すと元に戻せません。消さずに直すときは、共有のフォルダの ${T.esc(it.file)}.json を直します。</p>
            <div class="v-btns"><button type="button" class="v-no">やめる</button><button type="button" class="v-del">× 消す</button></div></div>`;
          document.body.append(back);
          back.querySelector(".v-no").onclick = () => { back.remove(); resolve(false); };
          back.querySelector(".v-del").onclick = () => { back.remove(); resolve(true); };
          back.querySelector(".v-del").focus();
          return;
        }
        let yes = false;
        const anchor = window.__vRect;
        const items = [];
        if (V.confirm === "inline") {
          // 面の中で 2 度押し: 開いていた面の同じ所に、押した行を確かめに替えて開き直す
          items.push({ group: `${s.row} 行目を消しますか（元に戻せません）` },
            { icon: "", label: s.summary || `${s.row} 行目`, why: `${what}・${s.why}`, disabled: true },
            { icon: "×", label: "消す", danger: true, run: () => { yes = true; } }, { icon: "", label: "やめる（面に戻る）", run: () => {} });
          T.menu({ x: anchor ? anchor.left : innerWidth / 2 - 160, y: anchor ? anchor.top : innerHeight / 3, head: `${what}の読めない行（${it.file}.json）`, cls: "tpa-skipmenu", items,
            onClose: () => setTimeout(() => resolve(yes), 0) });
          return;
        }
        const head = V.confirm === "words" ? `${what}の ${rowText(s)}を消しますか（元に戻せません）` : `${what}の ${s.row} 行目を消しますか`;
        if (V.confirm === "content" || V.confirm === "keep") {
          items.push({ icon: "≡", label: s.summary || "（要約なし）", why: `${it.file}.json の ${s.row} 行目・${s.why}`, disabled: true },
            { sep: true });
        }
        items.push({ icon: "×", label: "消す", danger: true, run: () => { yes = true; },
                     note: V.confirm === "keep" ? "消した行は、この PC の作業場所に写しを残します（あとで元に戻せます）" : V.confirm === "content" ? "元に戻せません" : "" },
                   { icon: "", label: "やめる", run: () => {} });
        T.menu({ x: innerWidth / 2 - 160, y: innerHeight / 3, head, cls: "tpa-skipmenu", items, onClose: () => setTimeout(() => resolve(yes), 0) });
      });
      if (!(await ask())) return;
      const r = await fetch(url, { method: "DELETE" }); const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || `消せませんでした（${r.status}）`); return; }
      if (it.reload) await it.reload(); else location.reload();
      await wait(150);
      const left = Math.max(0, (it.d.skipped || []).length - 1);
      const msg = `${what}の ${rowText(s)}を消しました`;
      if (V.after === "toast") toast(`<b>✓</b> ${T.esc(msg)}。${left ? `読めない行は残り ${left}` : "読めない行はもうありません"}`);
      else if (V.after === "undo") toast(`<b>✓</b> ${T.esc(msg)}（写しを残しました）`, true);
      else if (V.after === "chip") {
        const chip = document.querySelector(".master-place .tpa-skip");
        const html = `<span class="v-done-chip" role="status">✓ ${s.row} 行目を消しました</span>`;
        if (chip) chip.insertAdjacentHTML("beforebegin", html); else document.querySelector("#masterPlaceGo")?.insertAdjacentHTML("beforebegin", html);
      } else if (V.after === "count") {
        document.querySelector(".v-count-note")?.remove();
        const cnt = [...document.querySelectorAll("#masterOverlay *")].find((e) => e.children.length === 0 && /^\d+ 件$/.test(e.textContent.trim()));
        cnt?.insertAdjacentHTML("afterend", `<span class="v-count-note" role="status">✓ ${T.esc(msg)}</span>`);
      } else if (V.after === "menu") {
        // 結果も面の中: 帯の札の下に面を開き直し、いちばん上に「✓ 消しました」
        const chip = document.querySelector(".master-place .tpa-skip");
        if (chip) {
          T.openSkip(chip);
          const m = document.querySelector(".tpa-skipmenu");
          m?.querySelector(".tm-head")?.insertAdjacentHTML("afterend", `<p class="tm-group" role="status" style="border-top:0;padding-top:0;color:#1e6b3a">✓ ${T.esc(msg)}</p>`);
        }
      }
    };
    // 札の覚え（skipNote の SKIPS は閉じた中にあるので、作った札のマスタの名前を札に書いておく）
    const origNote = T.skipNote.bind(T);
    T.skipNote = function (d, file, opts) {
      const h = origNote(d, file, opts);
      return h.replace('class="', `data-vfile="${file}" class="`);
    };
    return true;
  }

  async function drive() {
    if (!(await until(install, 8000))) return;
    const chip = await until(() => document.querySelector("#masterOverlay:not(.hidden) .master-place .tpa-skip"), 15000);
    if (!chip || done.phase) return;
    done.phase = true;
    if (PHASE === "src") {
      document.querySelector('#masterTabs [data-tab="sources"]')?.click();
      await wait(120);
      const place = document.querySelector(".master-place");
      const d = { skipped: [{ row: 5, id: 31, key: "k31", summary: "id 31・キー 'b2'・表示名 '小'", why: "確かめる間隔が数ではありません（['x']）", source: "" }] };
      place.querySelectorAll(".tpa-skip").forEach((e) => e.remove());
      place.querySelector("#masterPlaceGo")?.insertAdjacentHTML("beforebegin", window.TPA.skipNote(d, "data_sources", {}));
      await wait(50);
      place.querySelector(".tpa-skip").click();
      return;
    }
    chip.click();
    if (PHASE === "menu") return;
    const x = await until(() => [...document.querySelectorAll(".tpa-skipmenu button[role=menuitem]:not(:disabled)")][0], 2000);
    x?.click();
    if (PHASE === "confirm") return;
    await wait(80);
    const del = await until(() => document.querySelector(".v-dlg .v-del") || [...document.querySelectorAll(".tpa-menu button.is-danger")][0], 2000);
    del?.click();
  }
  drive();
}

const BASE = { redX: true, pill: false, srcGroup: "この画面の行（一覧・読みでは使っています。この行に当たる直す・並べ替え・探し直しは止めています）", srcFoot: "" };
const DEFS = [
  { key: "A", name: "確かめの面に中身・下に一言（足す）",
    V: { ...BASE, confirm: "content", after: "toast" } },
  { key: "B", name: "面の中で 2 度押し・結果も面の中（流れを変える）",
    V: { ...BASE, confirm: "inline", after: "menu", srcGroup: "この画面の行",
         srcFoot: "データ元・実績の設備の読めない行は、一覧と読みでは今の値のまま使います。この行に当たる直す・並べ替え・探し直しは、消すか直すまで止めます" } },
  { key: "C", name: "真ん中の確かめの窓（置き場を変える）",
    V: { ...BASE, confirm: "dialog", after: "toast" } },
  { key: "D", name: "右に「消す」の札・結果は帯の札に（見せ方）",
    V: { ...BASE, redX: false, pill: true, confirm: "content", after: "chip" } },
  { key: "E", name: "言葉だけ（頭に中身・件数の行に一言。減らす）",
    V: { ...BASE, confirm: "words", after: "count", srcGroup: "この画面の行（読みでは使っています。直す・並べ替えは止めています）" } },
  { key: "F", name: "写しを残して「元に戻す」（流れを変える。サーバーも要る）",
    V: { ...BASE, confirm: "keep", after: "undo" } },
];

export const PROPOSALS = DEFS.map(({ key, name, V }) => ({ key, name, css: "", ops: [["script", `(${run})(${JSON.stringify(V)}, ${JSON.stringify(PHASE)})`]] }));
// 今の画面（比べる元。案の文を当てない）
PROPOSALS.unshift({ key: "now", name: "今（3.108.0）", css: "", ops: [["script", `(${run})(${JSON.stringify({ redX: false, pill: false, confirm: "orig", after: "orig", srcGroup: "この画面の行（一覧では飛ばしています）", srcFoot: "" })}, ${JSON.stringify(PHASE)})`]] });
