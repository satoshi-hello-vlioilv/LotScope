// 2026-10-dashsave の 2 回目（1 回目は 6 案とも 80 点に届かず。1 位 B 75.9 点・D 75.2・C 75.1）。決まり 2026-10-17。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashsave-2.mjs --states dash-save-pop,dash-saveas --from dash
// 1 回目の採点で低かった所: 全員の既定の添え書き「…（組み込みもここ）」の最後が 2 段目に落ちる（全案・面と窓の 2 か所）→ 添え書きを「全員に見える。開発者だけが直せる」
//   に縮めた（作り済み。全案に効く）。D は折れが無いが、見える人・直せる人が消えて「考えさせない」が低い。E の帯は 11px 未満の字・セットの列に入った
// 1 回目で効いた所（持ち越す）: B の 3 枚の札（使いやすさ・わかりやすさ）・C の主のボタンが行き先を言う（使いやすさ 26.0 で最高）
// 案の方向（新しい案は G・H・I）:
//   B2 持ち越し: B の札 ＋ C のボタンの言葉（「標準」〔全員の既定〕に上書き保存）
//   G 見せ方（新）: 札に人の印（1 人・みんな・鍵）と「見える」「直せる」の 2 行の見出しつきの字。＋ C のボタン
//   H 減らし方（新）: 置き場は 1 段の札（D）＋ 選んだ置き場の 1 行の説明だけを札の下に出す（見える人・直せる人は消さない）＋ C のボタン
//   I 流れ（新）: 置き場を先に（札）→ 名前 → ★ の順にし、行き先の帯を窓の下でボタンの直前に置く ＋ C のボタン
//   B3 置き場（面）: B2 ＋ ▾ の面の行に置き場の色の印（自分だけ＝青・全員（共有）＝緑・全員の既定＝茶）を付け、保存の窓の札と同じ色にそろえる
let seq = 0;
const watch = (sel, fn) => { const k = `d2s${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k} === el.innerHTML.length + "") return; (${fn})(el); el.dataset.${k} = el.innerHTML.length + ""; }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); run(); }`]; };
const CARDS = `
  .db-savepop{width:460px}
  .db-savepop .db-field:has(.db-radio){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .db-savepop .db-field:has(.db-radio) > span{grid-column:1/-1}
  .db-savepop .db-radio{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:2px 6px;border:1px solid #d5dde3;border-radius:8px;padding:7px 8px;background:#fff}
  .db-savepop .db-radio:has(input:checked){border-color:#2f7d78;background:#eef6f5;box-shadow:inset 0 0 0 1px #2f7d78}
  .db-savepop .db-radio b{min-width:0}
  .db-savepop .db-radio small{grid-column:1/-1;line-height:1.4}`;
// C: 主のボタンが行き先を言う（新しく → 「名前」〔置き場〕に保存／上書き → …に上書き保存）。帯の 1 行目（新しく・上書き）は消し、★の知らせだけを残す
const BTN = watch(".db-savepop", `(pop) => { const btn = pop.querySelector("[data-db-dosave]"), n = pop.querySelector("#dbSaveName"), s = pop.querySelector('input[name="dbScope"]:checked'), pl = pop.querySelector("#dbSavePlan");
  if (!btn || !n || !s) return; const w = s.closest("label").querySelector("b").textContent; const over = pl && /is-(over|swap)/.test(pl.className);
  const t = "「" + n.value + "」〔" + w + "〕に" + (over ? "上書き保存" : "保存"); if (btn.textContent !== t) btn.textContent = t;
  pl && [...pl.childNodes].forEach((c) => { if (c.nodeType === 3) c.textContent = ""; }); }`);
const BTN_CSS = `.db-saveplan > b{display:none}.db-saveplan:not(:has(.db-unstar)){display:none}.db-saveplan{background:#fbf3e4!important}`;
const ICONS = watch(".db-savepop", `(pop) => pop.querySelectorAll(".db-radio").forEach((l) => { if (l.querySelector(".d2i")) return; const k = l.querySelector("input").value;
  const ic = { me: "M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 15c0-3 3-5 6-5s6 2 6 5", all: "M5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM11 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM0.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M6.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4", default: "M3 7h10v8H3zM5 7V5a3 3 0 0 1 6 0v2" }[k];
  l.querySelector("b").insertAdjacentHTML("afterbegin", '<svg class="d2i" viewBox="0 0 16 16" aria-hidden="true"><path d="' + ic + '"/></svg>');
  const s = l.querySelector("small"), t = s.textContent.split("。"); s.innerHTML = '<i>見える</i>' + t[0].replace(/に?見える$/, "") + '<br><i>直せる</i>' + (t[1] || "").replace(/が?直せる$/, ""); })`);
const ICON_CSS = `.d2i{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.4;vertical-align:-2px;margin-right:5px}
  .db-savepop .db-radio small i{font-style:normal;font-weight:700;color:var(--h-meta);margin-right:5px}`;
const ONE_ROW = `.db-savepop .db-radio small{display:none}
  .db-savepop .db-field:has(.db-radio){flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px}
  .db-savepop .db-field:has(.db-radio) > span{flex:0 0 100%}
  .db-savepop .db-radio{border:1px solid #c9d3da;border-radius:999px;padding:3px 12px;background:#fff}
  .db-savepop .db-radio input{position:absolute;opacity:0;width:1px;height:1px}
  .db-savepop .db-radio:has(input:checked){background:#e5eef6;border-color:#4d6e96;color:#24446a}
  .db-savepop .db-radio b{min-width:0}
  .d2who{flex:0 0 100%;font-size:12.5px;color:var(--muted);font-weight:400;padding:2px 2px 0}`;
const WHO = watch(".db-savepop", `(pop) => { const f = pop.querySelector(".db-field:has(.db-radio)"); if (!f) return; let w = f.querySelector(".d2who"); if (!w) { w = document.createElement("span"); w.className = "d2who"; f.append(w); }
  const s = f.querySelector(".db-radio:has(input:checked) small"); const t = s ? s.textContent : ""; if (w.textContent !== t) w.textContent = t; }`);
const FLOW = watch(".db-savepop", `(pop) => { const f = pop.querySelector(".db-field:has(.db-radio)"), n = pop.querySelector(".db-field:has(#dbSaveName)"), pl = pop.querySelector("#dbSavePlan"), acts = pop.querySelector(".db-popacts");
  if (f && n && f.nextElementSibling !== n) n.before(f); if (pl && acts && pl.nextElementSibling !== acts) acts.before(pl); }`);
const SCOPE_COLOR = { me: "#3d6fa8", all: "#2f7d78", default: "#8a5a14" };
const MARKS = watch(".db-pickpop, .db-savepop", `(pop) => { const c = ${JSON.stringify(SCOPE_COLOR)}; const map = { "自分だけ": "me", "全員（共有）": "all", "全員の既定": "default" };
  pop.querySelectorAll(".db-lgh b, .db-radio b").forEach((b) => { if (b.querySelector(".d2m")) return; const k = map[b.textContent.trim()] || (b.closest(".db-radio") && b.closest(".db-radio").querySelector("input").value); if (!c[k]) return;
    b.insertAdjacentHTML("afterbegin", '<i class="d2m" style="background:' + c[k] + '"></i>'); }); }`);
const MARK_CSS = `.d2m{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:0}`;

export const PROPOSALS = [
  { key: "B2", name: "B2 持ち越し: 3 枚の札 ＋ 主のボタンが行き先を言う（「標準」〔全員の既定〕に上書き保存）", css: CARDS + BTN_CSS, ops: [BTN] },
  { key: "G", name: "G 見せ方: 札に人の印と「見える」「直せる」の 2 行 ＋ 行き先を言うボタン", css: CARDS + BTN_CSS + ICON_CSS + `.db-savepop{width:540px}.db-savepop .db-radio b{white-space:nowrap}`, ops: [ICONS, BTN] },
  { key: "H", name: "H 減らす: 置き場は 1 段の札 ＋ 選んだ置き場の説明 1 行だけ ＋ 行き先を言うボタン", css: ONE_ROW + BTN_CSS, ops: [WHO, BTN] },
  { key: "I", name: "I 流れ: 置き場（札）→ 名前 → ★ の順・★の知らせはボタンの直前 ＋ 行き先を言うボタン", css: CARDS + BTN_CSS + `.db-savepop .db-saveplan{margin-top:2px}`, ops: [FLOW, BTN] },
  { key: "B3", name: "B3 置き場の色: B2 ＋ 面の見出しと札に置き場の色の印（自分だけ＝青・全員（共有）＝緑・全員の既定＝茶）", css: CARDS + BTN_CSS + MARK_CSS, ops: [MARKS, BTN] },
];
