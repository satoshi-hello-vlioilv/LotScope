// 2026-10-18 見出しのタブの名前と並び（版 3.45.0。利用者の要望 4）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-tabs.mjs --states tabs-menu   （1536x864・1280x720 でも）
// 今の物（版 3.44.0）で見えたこと: タブの名前と並びは決まっていて変えられない（作業実績の設備のタブは引いて並べ替えられるのに、見出しのタブはできない）
// 案の方向（何で解くか）:
//   A 慣れた型（つかんで引く＋右クリックのメニュー: 名前を変える・左へ・右へ・元に戻す。F2・Ctrl＋Shift＋← →）。作った物
//   B 見せ方（乗せたタブに ⠿ のつかむ印と ✎ を出す: 操作があると分かる）
//   C 減らし方（メニューを名前と元に戻すだけにし、並びは引くだけ）
//   D 置き場（タブの右端に「⚙」を置き、押すと名前の欄と ↑↓ の並ぶ設定の面）
//   E 見せ方（名前を変えたタブに小さな点を付け、元の名前と違うと分かる）
let seq = 0;
const watch = (sel, fn) => { const k = `tb${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 引いて並べ替え＋右クリックのメニュー（作った物）", css: "", ops: [] },
  {
    key: "B", name: "B 乗せたタブに ⠿ と ✎ を出す",
    css: `.screen-tab{position:relative}.screen-tab .tb-grip{position:absolute;left:3px;top:50%;transform:translateY(-50%);font-size:11px;letter-spacing:-2px;opacity:.6}.screen-tab .tb-pen{margin-left:2px;font-size:12px;opacity:.7}
      .screen-tab[data-screen="work"] .tb-grip,.screen-tab[data-screen="work"] .tb-pen{display:inline}`,
    ops: [["script", `document.querySelectorAll(".screen-tab").forEach((b) => { if (b.dataset.screen !== "work") return; b.insertAdjacentHTML("afterbegin", '<i class="tb-grip">⠿</i>'); b.insertAdjacentHTML("beforeend", '<i class="tb-pen">✎</i>'); });`]],
  },
  {
    key: "C", name: "C メニューは名前だけ（並びは引くだけ）",
    css: "", ops: [watch(".tpa-menu", `(m) => { [...m.querySelectorAll("button")].filter((b) => /左へ|右へ/.test(b.textContent)).forEach((b) => b.remove()); const s = m.querySelectorAll(".tm-sep"); if (s[0]) s[0].remove(); }`)],
  },
  {
    key: "D", name: "D 右端の ⚙ から設定の面（名前の欄と ↑↓）",
    css: `.tb-gear{align-self:center;margin-left:4px;width:30px;height:30px;border-radius:7px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-size:15px}
      .tb-panel{position:fixed;top:56px;left:420px;z-index:70;width:360px;padding:12px;border:1px solid var(--pop-line);border-radius:10px;background:#fff;box-shadow:0 12px 30px var(--pop-shadow);display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ink)}
      .tb-panel b{font-size:14px}.tb-row{display:grid;grid-template-columns:20px 1fr 28px 28px;gap:6px;align-items:center}.tb-row input{height:28px;border:1px solid var(--line);border-radius:6px;padding:0 8px;font:inherit}.tb-row span{text-align:center;border:1px solid var(--line);border-radius:6px;height:26px;line-height:24px}`,
    ops: [watch(".tpa-menu", `(m) => m.remove()`), ["script", `document.querySelector(".screen-tabs").insertAdjacentHTML("beforeend", '<button class="tb-gear" type="button" title="タブの名前と並び">⚙</button>');
      document.body.insertAdjacentHTML("beforeend", '<div class="tb-panel"><b>タブの名前と並び</b>' + [...document.querySelectorAll(".screen-tab")].map((b, i) => '<div class="tb-row"><span style="border:0">' + (i + 1) + '</span><input value="' + b.querySelector(".tab-name").textContent + '"><span>↑</span><span>↓</span></div>').join("") + '<div style="display:flex;gap:6px;justify-content:flex-end"><button class="pv-btn">元に戻す</button><button class="btn-primary">閉じる</button></div></div>');`]],
  },
  {
    key: "E", name: "E 名前を変えたタブに点（元と違う印）",
    css: `.screen-tab.is-renamed .tab-name::after{content:"";display:inline-block;width:6px;height:6px;margin-left:5px;border-radius:50%;background:var(--accent);vertical-align:middle}`,
    ops: [],
  },
];
