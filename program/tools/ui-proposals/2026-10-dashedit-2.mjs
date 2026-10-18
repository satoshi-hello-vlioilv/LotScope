// 2026-10-18 ダッシュボードの組む所の 2 回目: 幅・条件・計算と単位（版 3.45.0。利用者の要望 2・3・6）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashedit-2.mjs --states dash-cond,dash-kpi-fmt   （1536x864・1280x720 でも）
// 1 回目（2026-10-dashedit.json）: 1 位 A 72.2 点で届かず。残った所: 取っ手が淡く短い線で見つけにくい・単位の欄と「後ろに」の 2 か所に単位を書く所がある・
//   単位の欄の字が切れる（−5）・E の「演算子を選ぶ形」は思い出させないが、すぐ押せる札が消えた
// 2 回目の土台（全案に入れた）: 取っ手はいつも見える縦の点の帯（乗せると青緑で長く）・数字のパネルは後ろの字を「単位」の 1 か所に（表示形式の「後ろに」は出さない。
//   見本にも単位を添える）・単位の欄を広げ、字が切れない
// 案の方向:
//   A2 土台のまま（計算は式の欄＋札）。持ち越し
//   B2 計算を「演算子の選び＋数の欄＋札」に（選べば書き方を思い出さない。式で書くは選びの「式…」）。新しい（1 回目の E と A を合わせた）
//   C2 取っ手の上に小さな「⇔」（幅を変えられると字で分かる。他の部品に重ねない）。新しい
//   D2 カラム名を 2 行まで折り返す（幅を変えなくても読める）。新しい
//   E2 カラムの見出しに「⇔ 名前に合わせる」の札（押すと、いちばん長いカラム名が入る幅に一度で）。新しい
let seq = 0;
const watch = (sel, fn) => { const k = `dg${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A2 点の帯の取っ手・単位は 1 か所・計算は式の欄＋札（土台）", css: "", ops: [] },
  {
    key: "B", name: "B2 計算は 演算子の選び＋数の欄＋札（式で書くは選びの「式…」）",
    css: `.cg-op{height:30px;border:1px solid var(--edit-line);background:var(--edit-field);border-radius:7px;padding:0 6px;font:inherit;font-size:13px}.cg-num{width:96px!important}`,
    ops: [watch("#dbEditor .de-fcalc", `(c) => { const i = c.querySelector("[data-de-fexpr]"); if (!i) return; const m = /^([×÷+\\-])\\s*(.*)$/.exec(i.value) || ["", "", ""];
      i.insertAdjacentHTML("beforebegin", '<select class="cg-op" aria-label="計算"><option' + (m[1] ? "" : " selected") + '>なし</option><option' + (m[1] === "×" ? " selected" : "") + '>× かける</option><option' + (m[1] === "÷" ? " selected" : "") + '>÷ わる</option><option>＋ たす</option><option>− ひく</option><option>式…</option></select><input class="de-ntx cg-num" placeholder="数" value="' + m[2] + '">');
      i.style.display = "none"; const msg = c.querySelector(".de-cmsg"); if (msg) msg.textContent = m[1] ? "値" + m[1] + m[2] + " を出します" : "選ぶと数に計算を当てます（よく使う物は右の札）"; }`)],
  },
  {
    key: "C", name: "C2 取っ手の上に小さな「⇔」",
    css: `.de-split::before,.de-wgrip::before{content:"⇔";position:absolute;top:calc(50% - 46px);left:50%;transform:translateX(-50%);font-size:10px;line-height:1;color:#5d7383}
      .de-wgrip::before{left:4px}`,
    ops: [],
  },
  {
    key: "D", name: "D2 カラム名を 2 行まで折り返す",
    css: `#deFields .pv-f > span > b{white-space:normal!important;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.25}`,
    ops: [],
  },
  {
    key: "E", name: "E2 カラムの見出しに「⇔ 名前に合わせる」の札",
    css: `.cg-fit{margin-left:auto;height:22px;padding:0 8px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--h-input);font:inherit;font-size:11.5px;white-space:nowrap}.de-fields .pv-cap{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}.de-fields .pv-cap small{flex-basis:100%}`,
    ops: [watch("#dbEditor .de-fields .pv-cap", `(c) => { const b = c.querySelector("b"); if (b) b.insertAdjacentHTML("afterend", '<button type="button" class="cg-fit" title="いちばん長いカラム名が入る幅にします">⇔ 名前に合わせる</button>'); }`)],
  },
];
