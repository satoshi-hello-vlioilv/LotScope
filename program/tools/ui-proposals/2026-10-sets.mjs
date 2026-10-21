// 2026-10-21 ダッシュボードのセット（版 3.46.0。利用者の要望 7: 開発者の標準のセットを複数・個人の切り替えのパターン）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sets.mjs --states dash-set,dash-set-pop   （1536x864・1280x720 でも）
// 作った物（A）を撮って見えたこと（自分で画像を見た）: 道具の行の左に「▦ 現場の朝 セット・共通デフォルト ★ ▾」、その右にダッシュボードのタブ（標準・稼働・品種の ABC）。
//   ▾ の面は上に「セット」（使わない・標準のセット・操作）、下に「ダッシュボード」（今までの面）
// 案の方向（何で解くか）:
//   A 作った物
//   B 置き場: タブを道具の行の下（スライサーの帯の上）の段に（道具の行を短く）
//   C 減らし方: セットの札は名前だけ（「セット・共通デフォルト」の添え字を外す）・タブを主に
//   D 見せ方: タブを札（ピル）の並びに（選んだ物は藍の塗り）
//   E 置き場: 面を 2 列（左＝セット・右＝ダッシュボード）
//   F 流れ: タブの右端に「＋」（いまのダッシュボードをセットに入れる・作る）を常に出す
let seq = 0;
const watch = (sel, fn) => { const k = `st${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A 作った物（セットの札＋右にタブ・面は上にセット）", css: "", ops: [] },
  {
    key: "B", name: "B タブを道具の行の下の段に",
    css: `.st-row{display:flex;gap:2px;align-items:flex-end;height:32px;border-bottom:2px solid var(--line-soft);margin:0 0 4px}.db-tools > .db-tabs{display:none}`,
    ops: [watch("#dashBar .db-tabs", `(t) => { const bar = document.querySelector("#dashBar"); let row = document.querySelector(".st-row"); if (!row) { row = document.createElement("div"); row.className = "st-row"; bar.after(row); } row.innerHTML = t.innerHTML; }`)],
  },
  { key: "C", name: "C セットの札は名前だけ・タブを主に", css: `.db-pick.is-set small{display:none}.db-tab{font-size:14px;padding:0 16px}`, ops: [] },
  {
    key: "D", name: "D タブを札（ピル）の並びに",
    css: `.db-tabs{border-bottom:0;align-items:center;gap:4px;height:34px}.db-tab{height:28px;border:1px solid var(--line);border-radius:999px;margin:0;background:var(--surface)}.db-tab.on{background:#24446a;color:#fff;border-color:#24446a;box-shadow:none}`,
    ops: [],
  },
  {
    key: "E", name: "E 面を 2 列（左＝セット・右＝ダッシュボード）",
    css: `.db-pickpop{width:760px;display:grid;grid-template-columns:1fr 1fr;column-gap:16px;align-content:start}.db-pickpop > *{grid-column:auto}.db-pickpop .db-popsep{display:none}`,
    ops: [watch(".db-pickpop", `(p) => { const kids = [...p.children], i = kids.findIndex((x) => x.classList.contains("db-popsep")); if (i < 0) return;
      const L = document.createElement("div"), R = document.createElement("div"); L.style.cssText = R.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0";
      kids.slice(0, i).forEach((x) => L.append(x)); kids.slice(i + 1).forEach((x) => R.append(x)); p.prepend(L, R); }`)],
  },
  {
    key: "F", name: "F タブの右端に「＋」（セットに入れる・作る）",
    css: `.st-plus{height:26px;width:28px;margin:0 0 2px 4px;border:1px dashed var(--line);border-radius:6px;background:transparent;color:var(--muted);font-weight:700;cursor:pointer}`,
    ops: [watch("#dashBar .db-tabs", `(t) => { if (t.querySelector(".st-plus")) return; t.insertAdjacentHTML("beforeend", '<button type="button" class="st-plus" title="いまのダッシュボードをセットに入れる・セットを作る">＋</button>'); }`)],
  },
];
