// 2026-10 マスタの置き場を配る版で指定する（版 3.34.0）。3 回目（最後の回。95 点に届かなくても、いちばん高い案に決めて足りない点を伝える）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-masterpin-3.mjs --states master-place,master-release
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-masterpin-3.mjs --states master-place,master-release --view 1280x720
// 2 回目（2026-10-masterpin-2.mjs）の 1 位は H と C2（72.9 点）・3 位 I（72.8 点）。採点者が挙げた直す所:
//   ①ずれた形で「この PC の置き場を全員に配る」が 1280 で切れる（全案 −5×2） ②見出し帯の「置き場を変える ›」と帯の「マスタの置き場を変える…」が紛れる
//   ③マスタの置き場の画面で、帯の「変える…」と下の「置き場を変える」の欄で手が 2 つ ④I は 2 つの画面で形がそろわない・行に地も縁も無く弱い
//   ⑤帯を流れより上に置くと最初に見る物が 2 つ（D2） ⑥見出しの札は切れ、この PC の状態を 2 か所で言う（K）
// 3 回目で共通にした事:
//   ・ずれたときの手は短く「この PC をそろえる」（主）・「この置き場を配る」（従）。1280 でも 1 段に収まる
//   ・見出し帯のボタンを「マスタの置き場 ›」に（置き場の画面へ行く）。配布の画面の帯のボタンも同じ言葉「マスタの置き場 ›」＝同じ所へ行く同じ物
//   ・マスタの置き場の画面の帯には「変える」手を置かない（下の「置き場を変える」の欄が 1 つだけの手）。ずれたときだけ直す 2 つの手
//   ・帯は流れ（①②③）の下（最初に見るのは流れ）
// 新しい案（3 つ）:
//   P 状態の札を 1 つに: マスタの置き場の画面の上の札（この PC の置き場）に「全員（配る版）」の行を足し、1 つの札で 2 つを比べる。配布の画面は H3 の帯
//   S ずれたときだけ帯: そろっているときは ②配る版の札に「マスタも配っています ✓」の 1 行（置き場の字は指を置くと出る）。ずれたときだけ橙の帯と 2 つの手
//   R 流れの下の「全員にそろう物」の帯: 配る版とマスタの置き場を 1 つの帯に 2 つ並べる（版 3.12.0 ｜ マスタ \\…\Masters ✓）。マスタの置き場の画面は P の札
// 持ち越し（直した）: H3（H に共通の直しを当てた）・I3（I の 2 行に地と縁を付け、置き場の画面も同じ 2 行の形）
// 材料（順位に入れない。ずれた形）: H3!・P!・S!

const PIN_FULL = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters";
const MINE_FULL = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Apps\\LotScope";
const PIN = "\\\\nlmsrvngy03\\…\\検査データ\\Masters";
const MINE = "…\\Apps\\LotScope";
const TIP = "2026-10-15 14:30 user（PC-01）が配りました。配る版と一緒に全員の PC へ届き、各 PC は起動したとき・30 分ごとに受け取って、数秒でこの置き場へ移ります。マスタの置き場を変えると、ここも新しい置き場になります。";
const css = `
.pin-row{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;min-width:0;padding:8px 12px;margin-bottom:12px;border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:10px;background:var(--surface)}
.pin-row > b{font-size:13.5px;color:var(--h-input);white-space:nowrap;flex:none}
.pin-row code,.pin-2 code,.pin-cmp code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 6px;border-radius:4px;white-space:nowrap;flex:none}
.pin-row .m-chip{flex:none;white-space:nowrap}
.pin-row .pin-sp{flex:1 1 0}
.pin-row .pz-btn{flex:none;white-space:nowrap}
.pin-row.is-off{border-left-color:var(--accent);background:var(--amber-soft)}
.pin-row.pin-place{margin:10px 0 0}
.pin-2{display:flex;flex-direction:column;gap:0;margin:0 0 12px;border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:10px;background:var(--surface)}
.pin-2 > div{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;font-size:13px;color:var(--ro-ink);min-width:0;padding:7px 12px}
.pin-2 > div + div{border-top:1px solid var(--line)}
.pin-2 > div > b{width:10.5em;flex:none;color:var(--ink)}
.pin-2 .is-off{background:var(--amber-soft)}
.pin-2 .pin-sp{flex:1 1 0}
.pin-2 .pz-btn,.pin-2 .m-chip{flex:none;white-space:nowrap}
.pin-cmp{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:8px;font-size:13px;color:var(--ro-ink)}
.pin-cmp > span:nth-child(odd){color:var(--muted)}
.pin-step{display:block;margin-top:4px;font-size:12.5px;color:var(--ok-ink)}
.pin-both{display:flex;align-items:center;gap:14px;flex-wrap:nowrap;padding:8px 12px;margin-bottom:12px;border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:10px;background:var(--surface);font-size:13px}
.pin-both > b{color:var(--h-input);white-space:nowrap}
.pin-both .pin-sep{width:1px;align-self:stretch;background:var(--line)}
.pin-both code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 6px;border-radius:4px;white-space:nowrap}
.pin-both .pin-sp{flex:1 1 0}
.pin-both .pz-btn,.pin-both .m-chip{flex:none;white-space:nowrap}
`;
const chip = (t, c, tip = "") => `<span class="m-chip ${c}"${tip ? ` title="${tip}"` : ""}>${t}</span>`;
const esc = (s) => s.replace(/\\/g, "\\\\");
const fix = '<button type="button" class="pz-btn dz-go">この PC をそろえる</button><button type="button" class="pz-btn">この置き場を配る</button>';
const off = () => chip(`この PC は別: ${MINE}`, "c-warn", MINE_FULL);
/** 1 行の帯。where: release（配布の画面。「マスタの置き場 ›」で置き場の画面へ）／place（置き場の画面。変える手は下の欄だけ） */
const row = (where, isOff = false) => `<div class="pin-row${isOff ? " is-off" : ""}${where === "place" ? " pin-place" : ""}" title="${TIP}"><b>全員のマスタの置き場</b><code title="${PIN_FULL}">${PIN}</code>`
  + (isOff ? `${off()}<span class="pin-sp"></span>${fix}` : `${chip("✓ この PC も同じ", "c-on")}<span class="pin-sp"></span>${where === "release" ? '<button type="button" class="pz-btn">マスタの置き場 ›</button>' : ""}`) + "</div>";

// 画面は読み終えてから描き直す（中身を入れ替える）ので、描き直すたびに差し込み直す（印 data-pin で 2 度は入れない）
const keep = (body) => ["script", `{ const run = () => { ${body} }; run();
  new MutationObserver(run).observe(document.querySelector("#masterOverlay") || document.body, { childList: true, subtree: true }); }`];
const mark = (html) => html.replace(/^<(\w+)/, '<$1 data-pin="1"');
const before = (sel, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)});
  if (el && !(el.previousElementSibling && el.previousElementSibling.dataset.pin)) el.insertAdjacentHTML("beforebegin", ${JSON.stringify(mark(html))});`);
const after = (sel, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)});
  if (el && !(el.nextElementSibling && el.nextElementSibling.dataset.pin)) el.insertAdjacentHTML("afterend", ${JSON.stringify(mark(html))});`);
// 言葉を分ける: 配布の画面の「置き場を変える…」→「配布の置き場を変える…」、見出し帯の「置き場を変える ›」→「マスタの置き場 ›」
const words = keep(`const b = document.querySelector("#dzPlaceBtn"); if (b && b.textContent !== "配布の置き場を変える…") b.textContent = "配布の置き場を変える…";
  const g = document.querySelector("#masterPlaceGo"); if (g && g.textContent !== "マスタの置き場 ›") g.textContent = "マスタの置き場 ›";`);
const releaseRow = (isOff) => before("#masterSettings .dz-new", row("release", isOff));
const placeRow = (isOff) => after("#masterSettings .mp-now", row("place", isOff));
// P: マスタの置き場の画面の上の札に、この PC と全員（配る版）の 2 行を並べて比べる
const placeCompare = (isOff) => keep(`const n = document.querySelector("#masterSettings .mp-now > div"); if (!n || n.querySelector(".pin-cmp")) return;
  n.insertAdjacentHTML("beforeend", ${JSON.stringify(`<div class="pin-cmp" data-pin="1"><span>この PC</span><span>${isOff ? `<code>${MINE_FULL}</code>` : `<code>${PIN}</code>`}</span>`
    + `<span>全員（配る版）</span><span><code title="${PIN_FULL}">${PIN}</code> ${isOff ? off() + " " + fix : chip("✓ 同じ", "c-on")}</span></div>`)});`);
// I3: 2 行の帯（地と縁つき）。配布の画面は上の「置き場」の行を置き換え、置き場の画面は全員の行だけを同じ形で
const twoLines = (isOff) => keep(`const w = document.querySelector("#masterSettings .dz-where"); if (!w || w.dataset.pin) return;
  w.dataset.pin = "1"; const code = w.querySelector("code"); const fresh = w.querySelector(".dz-fresh");
  const box = document.createElement("div"); box.className = "pin-2"; box.dataset.pin = "1";
  box.innerHTML = '<div><b>配布の置き場</b>' + (code ? code.outerHTML : "") + '<span class="m-chip c-on">届いています</span>' + (fresh ? fresh.outerHTML : "") + '<span class="pin-sp"></span><button type="button" class="pz-btn">配布の置き場を変える…</button></div>'
    + ${JSON.stringify(`<div class="${isOff ? "is-off" : ""}" title="${TIP}"><b>全員のマスタの置き場</b><code title="${PIN_FULL}">${PIN}</code>${isOff ? off() + '<span class="pin-sp"></span>' + fix : chip("✓ この PC も同じ", "c-on") + '<span class="pin-sp"></span><button type="button" class="pz-btn">マスタの置き場 ›</button>'}</div>`)};
  w.hidden = true; w.after(box);`);
const placeTwo = (isOff) => after("#masterSettings .mp-now", `<div class="pin-2" style="margin:10px 0 0" title="${TIP}"><div class="${isOff ? "is-off" : ""}"><b>全員のマスタの置き場</b><code title="${PIN_FULL}">${PIN}</code>`
  + (isOff ? `${off()}<span class="pin-sp"></span>${fix}` : chip("✓ この PC も同じ", "c-on")) + "</div></div>");
// S: そろっているときは ②の札に 1 行
const stepLine = keep(`const s = document.querySelectorAll("#masterSettings .dz-step")[1]; if (!s || s.querySelector(".pin-step")) return;
  s.insertAdjacentHTML("beforeend", ${JSON.stringify(`<span class="pin-step" title="${PIN_FULL}">✓ マスタの置き場も一緒に配っています</span>`)});`);
// R: 流れの下に「全員にそろう物」
const both = before("#masterSettings .dz-new", `<div class="pin-both" title="${TIP}"><b>全員にそろう物</b><span>配る版 <b>3.12.0</b></span><span class="pin-sep"></span>`
  + `<span>マスタの置き場 <code title="${PIN_FULL}">${PIN}</code></span>${chip("✓ この PC も同じ", "c-on")}<span class="pin-sp"></span><button type="button" class="pz-btn">マスタの置き場 ›</button></div>`);

export const PROPOSALS = [
  { key: "0", name: "今（マスタの置き場は配布の画面に出ない）", css: "", ops: [] },
  { key: "H3", name: "H を直す: 1 行の帯（配布の画面は流れの下・置き場の画面は上の札の下）。言葉を分け、置き場の画面の帯に変える手を置かない",
    css, ops: [words, releaseRow(false), placeRow(false)] },
  { key: "I3", name: "I を直す: 2 行の帯（配布の置き場／全員のマスタの置き場。地と縁つき）。置き場の画面も同じ形",
    css, ops: [words, twoLines(false), placeTwo(false)] },
  { key: "P", name: "状態の札を 1 つに: 置き場の画面の上の札で「この PC」と「全員（配る版）」を並べて比べる。配布の画面は H3 の帯",
    css, ops: [words, releaseRow(false), placeCompare(false)] },
  { key: "S", name: "ずれたときだけ帯: そろっているときは ②の札に「✓ マスタの置き場も一緒に配っています」。ずれたときだけ橙の帯と 2 つの手",
    css, ops: [words, stepLine, placeRow(false)] },
  { key: "R", name: "全員にそろう物の帯: 流れの下に「配る版 3.12.0 ｜ マスタの置き場 …」を 1 つの帯に。置き場の画面は P の札",
    css, ops: [words, both, placeCompare(false)] },
  { key: "H3!", name: "（材料）H3 でこの PC が別の置き場（橙・「この PC は別: …」・この PC をそろえる／この置き場を配る）",
    css, ops: [words, releaseRow(true), placeRow(true)] },
  { key: "P!", name: "（材料）P でこの PC が別の置き場",
    css, ops: [words, releaseRow(true), placeCompare(true)] },
  { key: "I3!", name: "（材料）I3 でこの PC が別の置き場",
    css, ops: [words, twoLines(true), placeTwo(true)] },
];
