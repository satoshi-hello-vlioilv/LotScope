// 2026-10-dashsave（版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 1）: ダッシュボードの保存先の分かりにくさ。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashsave.mjs --states dash-save-pop,dash-saveas --from dash
// 今の物（版 3.48.0）で見えたこと: 面に「標準」が 3 つ（共通・共通デフォルト・組み込み）並び、どれが開くかは★1 つだけで、★の勝ち負けの決まりは
//   小さな字の 1 行。「名前を付けて保存」は名前が「〜 のコピー」・置き場が自分から始まり、同じ名前「標準」にしても「保存」のままで、増えることが見えない。
//   共通と共通デフォルトは「全員」と「開発者」の言葉だけで、どちらも全員に見えることと、違いが「だれが直せるか」「★の強さ」であることが分からない。
// 動き（どの案も同じ。作り済み）: 同じ置き場の同じ名前は上書き・組み込みと同じ名前は組み込みの代わり・先の置き場の★に負けるときは外す選び。
// 案の方向:
//   A 言葉（作り済みの形）: 置き場の名前を「自分だけ・全員（共有）・全員の既定」にし、だれに見えて・だれが直せるかを添える・行き先の札（新しく／上書き）
//   B 見せ方: 置き場を 3 枚の札（カード）に。札の中に見える人・直せる人
//   C 流れの変え方: 行き先を主のボタンの言葉にする（「標準〔全員の既定〕に上書き保存」）。行き先の帯は★の知らせだけ
//   D 減らし方: 添え書きを消し（ボタンの title だけ）、置き場は 1 段の札。行き先の帯は残す
//   E 置き場（開いたとき）: 面と保存の窓のいちばん上に「アプリを開くと: ★ 標準〔全員（共有）〕」を出し、★の勝ち負けを先に見せる
//   F 表で比べる: 置き場を 3 行の小さな表（置き場・見える人・直せる人・★の強さ）に
let seq = 0;
const watch = (sel, fn) => { const k = `ds${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); run(); }`]; };

const CARDS = `
  .db-savepop{width:460px}
  .db-savepop .db-field:has(.db-radio){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .db-savepop .db-field:has(.db-radio) > span{grid-column:1/-1}
  .db-savepop .db-radio{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:2px 6px;border:1px solid #d5dde3;border-radius:8px;padding:7px 8px;background:#fff}
  .db-savepop .db-radio:has(input:checked){border-color:#2f7d78;background:#eef6f5;box-shadow:inset 0 0 0 1px #2f7d78}
  .db-savepop .db-radio b{min-width:0}
  .db-savepop .db-radio small{grid-column:1/-1;line-height:1.4}`;
const TOP_STAR = watch(".db-pickpop, .db-savepop", `(pop) => { if (pop.querySelector(".ds-top")) return; const b = document.querySelector("[data-db-pick] small"); const it = document.querySelector(".db-pickpop .db-li.is-std b");
  const name = it ? it.textContent : "標準"; const where = it ? it.closest(".db-lg").querySelector(".db-lgh b").textContent : (b ? b.textContent : "");
  const h = pop.querySelector(".db-pcol:last-child .db-pophead, .db-pophead"); if (h) h.insertAdjacentHTML("afterend", '<div class="ds-top"><span>アプリを開くと</span><b>★ ' + name + '</b><small>〔' + where + '〕</small></div>'); }`);
const TOP_CSS = `.ds-top{display:flex;align-items:baseline;gap:8px;background:#fbf3e4;border:1px solid #e6cf9e;border-radius:8px;padding:5px 9px;margin:4px 0 6px;font-size:12.5px}
  .ds-top span{color:var(--muted)}.ds-top b{color:#7a4d10}.ds-top small{color:var(--muted)}`;

export const PROPOSALS = [
  { key: "A", name: "A 言葉: 自分だけ・全員（共有）・全員の既定＋だれに見えて・だれが直せるか・行き先の札（作り済みの形）", css: "", ops: [] },
  { key: "B", name: "B 見せ方: 置き場を 3 枚の札（カード）に。札の中に見える人・直せる人", css: CARDS, ops: [] },
  { key: "C", name: "C 流れ: 行き先を主のボタンの言葉に（「標準〔全員の既定〕に上書き保存」）。帯は★の知らせだけ",
    css: `.db-saveplan > b,.db-saveplan > b + *{display:none}.db-saveplan.is-new:not(:has(.db-unstar)),.db-saveplan.is-over:not(:has(.db-unstar)){display:none}.db-saveplan{background:#fbf3e4!important}`,
    ops: [watch(".db-savepop", `(pop) => { const btn = pop.querySelector("[data-db-dosave]"), n = pop.querySelector("#dbSaveName"), s = pop.querySelector('input[name="dbScope"]:checked'), pl = pop.querySelector("#dbSavePlan");
      if (!btn || !n || !s) return; const w = s.closest("label").querySelector("b").textContent; const over = pl && /is-(over|swap)/.test(pl.className);
      const t = "「" + n.value + "」〔" + w + "〕に" + (over ? "上書き保存" : "保存"); if (btn.textContent !== t) btn.textContent = t;
      pl && [...pl.childNodes].forEach((c) => { if (c.nodeType === 3) c.textContent = ""; }); }`)] },
  { key: "D", name: "D 減らす: 添え書きを消し（title だけ）、置き場は 1 段の札。行き先の帯は残す",
    css: `.db-savepop .db-radio small,.db-lgh small{display:none}
      .db-savepop .db-field:has(.db-radio){flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px}
      .db-savepop .db-field:has(.db-radio) > span{flex:0 0 100%}
      .db-savepop .db-radio{border:1px solid #c9d3da;border-radius:999px;padding:3px 11px;background:#fff}
      .db-savepop .db-radio input{position:absolute;opacity:0;width:1px;height:1px}
      .db-savepop .db-radio:has(input:checked){background:#e5eef6;border-color:#4d6e96;color:#24446a}
      .db-savepop .db-radio b{min-width:0}`,
    ops: [watch(".db-savepop", `(pop) => pop.querySelectorAll(".db-radio").forEach((l) => { const s = l.querySelector("small"); if (s) l.title = s.textContent; })`)] },
  { key: "E", name: "E 開いたとき: 面と保存の窓の上に「アプリを開くと: ★ 標準〔全員（共有）〕」を出す（A ＋）", css: TOP_CSS, ops: [TOP_STAR] },
  { key: "F", name: "F 表で比べる: 置き場を 3 行の小さな表（置き場・見える人・直せる人）に",
    css: `.db-savepop{width:470px}
      .db-savepop .db-field:has(.db-radio){display:grid;grid-template-columns:auto 1fr 1fr;gap:0;border:1px solid #d5dde3;border-radius:8px;overflow:hidden}
      .db-savepop .db-field:has(.db-radio) > span{grid-column:1/-1;background:#f3f6f8;padding:4px 0;display:grid;font-size:11.5px}.db-savepop .db-field:has(.db-radio) > span i{padding:0 8px}
      .db-savepop .db-radio{display:contents}
      .db-savepop .db-radio > *{padding:6px 8px;border-top:1px solid #edf1f4}
      .db-savepop .db-radio input{margin:0 0 0 8px;align-self:center;padding:0;border:0}
      .db-savepop .db-radio b{display:none}
      .db-savepop .db-radio small{font-size:12px}
      .ds-c1{font-weight:700;font-size:13px}`,
    ops: [watch(".db-savepop", `(pop) => { const f = pop.querySelector(".db-field:has(.db-radio)"); if (!f || f.querySelector(".ds-c1")) return;
      f.querySelector(":scope > span").innerHTML = "<i></i><i style='font-style:normal'>置き場</i><i style='font-style:normal'>見える人</i><i style='font-style:normal'>直せる人</i>";
      f.style.gridTemplateColumns = "1.6em 8em 1fr 1fr";
      f.querySelectorAll(".db-radio").forEach((l) => { const b = l.querySelector("b").textContent, s = l.querySelector("small").textContent.split("。");
        l.querySelector("small").remove(); l.insertAdjacentHTML("beforeend", "<span class='ds-c1'>" + b + "</span><small>" + s[0].replace(/^.*?(全員|この ID)/, "$1") + "</small><small>" + (s[1] || "").replace(/^.*?(自分|マスタ|開発者)/, "$1") + "</small>"); });
      f.querySelector(":scope > span").style.gridTemplateColumns = "1.6em 8em 1fr 1fr"; }`)] },
];
