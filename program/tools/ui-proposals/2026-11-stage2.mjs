// 版 3.110.0 の画面の提案（3.109.0 の作った後の採点 2026-11-delegates-3109-ui.json の built.next_version で次の版に回した 3 つ）の案。
// マスタ管理の読めない行の面・確かめの窓・消した後の一言:
//   (1) マスタ管理でタブを替えたら、消した後の一言を消す（今はほかのタブの上に「設備マスタの…残り 1」が数秒残る）
//   (2) 置き場が手元のみのときの言葉を言い分ける（今は帯が「手元のみ」なのに、窓は「共有のフォルダの …json を直します」）
//   (3) 確かめの窓を Esc でやめた後、焦点を戻す（今は押した面の行が消えているので body に落ち、もう一度 Esc でマスタ管理まで閉じる）
//
// 撮り方（ui-variants.mjs。開発用サーバーに読めない行を足す TPA_UI_BAD_ROWS=1。開発用サーバーのマスタの置き場は手元のみ。段は TPA_PHASE）:
//   TPA_UI_BAD_ROWS=1 TPA_PHASE=confirm node program/tools/ui-variants.mjs 出力/confirm program/tools/ui-proposals/2026-11-stage2.mjs --states master --from master [--view 1536x864]
//     … 帯の札「⚠ 設備マスタの読めない行 2」を押して面を開き、1 つ目の行（18 行目 id 'x'）を押して確かめの窓を開いた所（言葉 (2) を見る）
//   TPA_PHASE=menu   … 面を開いた所（面の下の「消さずに直すときは…」の言葉 (2) を見る）
//   TPA_PHASE=esc    … 確かめの窓を Esc でやめた直後（焦点 (3) の行き先。輪は .v-focus で見せる〈合図の Esc は頁の中で送るので、本物の :focus-visible の輪は出ない〉）
//   TPA_PHASE=esc2   … 続けてもう一度 Esc（今と A・B・C・E・F はマスタ管理を閉じる〈重なった窓の決まり〉。D は面を閉じて札に戻る）
//   TPA_PHASE=after  … 確かめで消した直後（本当に消す。案ごとに --only で起こし直したサーバーで撮る）
//   TPA_PHASE=tab    … 消した直後にロールマスタのタブへ移った所（一言 (1) が残るか）
//
// 案の方向: A 足す（3 つをそのまま）／B 言葉で解く（一言は残し、何の行かを言う）／C 置き場を変える（一言を帯の中・窓に置き場の行）／
// D 流れを変える（Esc は開いた順の逆に 1 段ずつ戻る）／E 減らす（一言を出さず帯の札の数で知らせる・置き場は 1 語）／F 焦点を作業へ（表の行へ戻す・道まで言う）

const PHASE = process.env.TPA_PHASE || "confirm";

/** 頁の中で動く文（案の設定 V と段 PHASE）。今の部品（TPA.openSkip・skipDelete・confirmBox・toast）を包み、段の操作を進める */
function run(V, PHASE) {
  const done = { phase: false };
  const css = document.createElement("style");
  css.textContent = `
    .v-focus{outline:3px solid #2f6fd6 !important;outline-offset:2px !important;border-radius:6px}
    tr.v-focus{outline:none !important}tr.v-focus>td{box-shadow:inset 0 3px 0 #2f6fd6,inset 0 -3px 0 #2f6fd6 !important}tr.v-focus>td:first-child{box-shadow:inset 3px 3px 0 #2f6fd6,inset 0 -3px 0 #2f6fd6 !important}tr.v-focus>td:last-child{box-shadow:inset -3px 3px 0 #2f6fd6,inset 0 -3px 0 #2f6fd6 !important}
    .v-done-chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 10px;border-radius:999px;background:#e5f5ea;color:#1e6b3a;
      border:1px solid #9fd3ae;font-size:12px;font-weight:800;white-space:nowrap;max-width:46vw;overflow:hidden;text-overflow:ellipsis}
    .v-flash{background:#e5f5ea !important;color:#1e6b3a !important;border-color:#9fd3ae !important}`;
  document.head.append(css);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 25) { const x = f(); if (x) return x; await wait(25); } return null; };
  const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  const local = () => !!document.querySelector("#masterPlace .place-tag.local");
  const focusOn = (el) => { document.querySelectorAll(".v-focus").forEach((x) => x.classList.remove("v-focus")); if (!el) return; el.focus({ preventScroll: true }); el.classList.add("v-focus"); };
  const badge = () => document.querySelector("#masterOverlay:not(.hidden) .master-place .tpa-skip");
  // 帯は見張り（paintPlace）が innerHTML を作り直すので、札に戻した焦点は描き直しで消える（1280 の A・B で輪が消えた）。
  // 札に焦点を戻した後 3 秒は、描き直された札へ焦点を当て直す（作るときも、札の data-skip ではなくマスタの名前で探し直す要がある）
  let keepUntil = 0;
  new MutationObserver(() => {
    if (Date.now() > keepUntil || document.activeElement !== document.body) return;
    const b = keepWhat === "row" ? firstRow() : badge(); if (b && keepWhat === "row" && !b.hasAttribute("tabindex")) b.tabIndex = -1; if (b) { b.focus({ preventScroll: true }); b.classList.add("v-focus"); }
  }).observe(document.body, { childList: true, subtree: true });
  let keepWhat = "badge";
  const firstRow = () => document.querySelector("#masterOverlay .master-table-wrap tbody tr");
  const keepBadge = (what = "badge") => { keepWhat = what; keepUntil = Date.now() + 3000; };

  function install() {
    const T = window.TPA;
    if (!T || T.__v) return !!T;
    T.__v = true;
    if (V.key === "now") return true;   // 今の画面: 部品は替えず、段の操作だけ進める
    // (2) 置き場の言葉: 「共有のフォルダの X.json」を置き場ごとの言葉に
    const placeWords = (file) => (!local() ? `共有のフォルダの ${file}.json`
      : V.words === "data" ? `この PC の data/ の ${file}.json`
      : V.words === "path" ? `この PC（手元のみ）の data/${file}.json`
      : V.words === "place" ? `置き場（手元のみ）の ${file}.json`
      : `マスタの置き場（手元のみ）の ${file}.json`);
    const fixWords = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        n.textContent = n.textContent.replace(/共有のフォルダの (\S+?)\.json/g, (_, f) => placeWords(f))
          .replace(/共有のフォルダのファイル/g, local() ? (V.words === "data" || V.words === "path" ? "この PC の data/ のファイル" : "マスタの置き場（手元のみ）のファイル") : "共有のフォルダのファイル");
      }
    };
    let lastBadge = null, lastRow = 0, lastWhat = "";
    const origOpen = T.openSkip.bind(T);
    T.openSkip = function (btn) {
      lastBadge = btn;
      const r = origOpen(btn);
      const m = document.querySelector(".tpa-skipmenu");
      if (m) {
        fixWords(m);
        m.querySelectorAll("button[role=menuitem]").forEach((b, i) => b.addEventListener("click", () => { lastRow = i; }, true));
      }
      return r;
    };
    // 面を Esc で閉じたら札へ（どの案も。今は body に落ちる）
    const origMenu = T.menu.bind(T);
    T.menu = function (o) {
      if (o.cls !== "tpa-skipmenu") return origMenu(o);
      const onClose = o.onClose;
      return origMenu({ ...o, onClose: () => { onClose?.(); setTimeout(() => { if (document.activeElement === document.body && lastBadge?.isConnected) focusOn(lastBadge); }, 0); } });
    };
    const origConfirm = T.confirmBox.bind(T);
    T.confirmBox = async function (o) {
      lastWhat = (o.title || "").replace(/の読めない行を消しますか$/, "");
      const file = ((o.rows || []).find((r) => r[0] === "ファイル") || ["", ""])[1].split(".json")[0];
      let rows = o.rows, note = o.note;
      if (V.placeRow) rows = [...rows, ["置き場", local() ? "手元のみ（この PC の data/）" : "共有のフォルダ"]];
      note = note.replace(/共有のフォルダの (\S+?)\.json/g, (_, f) => placeWords(f));
      if (V.words === "place-page") note = local() ? `消すと元に戻せません。消さずに直すときは、${placeWords(file)} を直します（場所は「マスタの置き場 ›」）。` : note;
      const yes = await origConfirm({ ...o, rows, note });
      if (!yes) {
        // (3) Esc・やめるの後の焦点
        if (V.back === "menu" && lastBadge?.isConnected) {
          T.openSkip(lastBadge);
          await wait(30);
          const bs = [...document.querySelectorAll(".tpa-skipmenu button[role=menuitem]")];
          focusOn(bs[lastRow] || bs[0]);
        } else if (V.back === "row") {
          const r = firstRow(); if (r && !r.hasAttribute("tabindex")) r.tabIndex = -1;
          focusOn(r || lastBadge); keepBadge("row");
        } else if (lastBadge?.isConnected) { focusOn(lastBadge); keepBadge(); }
      }
      return yes;
    };
    // (1) 消した後の一言
    const origToast = T.toast.bind(T);
    T.toast = function (text, opts = {}) {
      if (V.after === "none") {   // E: 一言は出さず、帯の札を一瞬緑にして数の変化を見せる
        const b = badge();
        if (b) { b.classList.add("v-flash"); setTimeout(() => b.classList.remove("v-flash"), 2500); }
        return null;
      }
      if (V.after === "band") {   // C: 帯の中（札の左）に置く。帯はタブごとに描き直すので、タブを替えると消える
        document.querySelector(".v-done-chip")?.remove();
        const at = badge() || document.querySelector("#masterPlaceGo");
        // 帯は 1 段に収める（1280 で長い一言は帯を 2 段に折った）: 札は「✓ 18 行目を消しました（残り n）」、全文は title
        const t = `${text}${opts.rest ? ` ${opts.rest}` : ""}`;
        const row = (text.match(/\d+ 行目/) || ["行"])[0];
        const left = (opts.rest || "").replace(/^読めない行は/, "").replace(/^もうありません$/, "残りなし");
        const short = `✓ ${row}を消しました${left ? `（${left}）` : ""}`;
        at?.insertAdjacentHTML("beforebegin", `<span class="v-done-chip" role="status" title="${T.esc(t)}">${T.esc(short)}</span>`);
        setTimeout(() => document.querySelector(".v-done-chip")?.remove(), 6000);
        return null;
      }
      const rest = V.after === "name" && opts.rest ? opts.rest.replace(/^読めない行は/, `${lastWhat}の読めない行は`) : opts.rest;
      return origToast(text, { ...opts, rest });
    };
    // タブを替えたら一言を消す（A・C・D・F）。B は残し、何の行かを言う。E は一言が無い
    document.addEventListener("click", (e) => {
      if (!e.target.closest?.("#masterTabs .tab")) return;
      if (V.tabClear) { document.querySelector(".tpa-toast")?.remove(); document.querySelector(".v-done-chip")?.remove(); }
    }, true);
    return true;
  }

  async function drive() {
    if (!(await until(install, 8000))) return;
    const chip = await until(badge, 15000);
    if (!chip || done.phase) return;
    done.phase = true;
    chip.click();
    if (PHASE === "menu") return;
    const row = await until(() => document.querySelector(".tpa-skipmenu button[role=menuitem]:not(:disabled)"), 2000);
    row?.click();
    const box = await until(() => document.querySelector(".tpa-confirm"), 2000);
    if (!box || PHASE === "confirm") return;
    if (PHASE === "esc" || PHASE === "esc2") {
      esc();
      await wait(80);
      if (PHASE === "esc2") esc();
      return;
    }
    box.querySelector(".tpa-confirm-ok")?.click();
    await until(() => document.querySelector(".tpa-toast, .v-done-chip, .v-flash"), 2500);
    if (PHASE === "tab") document.querySelector('#masterTabs [data-tab="rolls"]')?.click();
  }
  drive();
}

const DEFS = [
  { key: "A", name: "3 つをそのまま（タブで一言を消す・手元は「この PC の data/」・Esc で札へ）",
    V: { words: "data", back: "badge", after: "toast", tabClear: true } },
  { key: "B", name: "言葉で解く（一言は残し「設備マスタの読めない行は残り n」・Esc で札へ）",
    V: { words: "data", back: "badge", after: "name", tabClear: false } },
  { key: "C", name: "置き場を変える（一言を帯の中に・窓に「置き場」の行・Esc で札へ）",
    V: { words: "place", back: "badge", after: "band", tabClear: true, placeRow: true } },
  { key: "D", name: "流れを変える（Esc は開いた順の逆に 1 段ずつ: 窓 → 面 → 札）",
    V: { words: "data", back: "menu", after: "toast", tabClear: true } },
  { key: "E", name: "減らす（一言を出さず帯の札を一瞬緑に・置き場は「マスタの置き場（手元のみ）」の 1 語）",
    V: { words: "place-page", back: "badge", after: "none", tabClear: true } },
  { key: "F", name: "焦点を作業へ（Esc で表の行へ・言葉は道まで「data/equipment_master.json」）",
    V: { words: "path", back: "row", after: "toast", tabClear: true } },
];

export const PROPOSALS = DEFS.map(({ key, name, V }) => ({ key, name, css: "", ops: [["script", `(${run})(${JSON.stringify({ key, ...V })}, ${JSON.stringify(PHASE)})`]] }));
// 今の画面（比べる元。部品を包まず、段の操作だけ進める）
PROPOSALS.unshift({ key: "now", name: "今（3.109.0）", css: "", ops: [["script", `(${run})(${JSON.stringify({ key: "now" })}, ${JSON.stringify(PHASE)})`]] });
