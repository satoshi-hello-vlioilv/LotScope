// 2026-10 マスタの置き場を配る版で指定する（版 3.34.0）。2 回目。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-masterpin-2.mjs --states master-place,master-release
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-masterpin-2.mjs --states master-place,master-release --view 1280x720
// 1 回目（2026-10-masterpin.mjs・.json）の 1 位は C（74.5 点）。採点者が挙げた直す所:
//   ①「置き場を変える…」が配布の置き場とマスタの置き場の 2 つを指して紛れる ②帯が 3 段で 1280×720 で版の一覧を押し出す
//   ③2 つの画面で題・ボタンの言葉・形がそろっていない ④ずれたときの直し方が「この PC の置き場を配る」の一方向だけ
//   ⑤C は配布の画面で淡い 1 行だけで目立たない（変えるには画面を移る） ⑥流れの札に入れると字が折れ、手順のように読める
// 2 回目で共通にした事: ボタンは「マスタの置き場を変える…」（配布の置き場の「置き場を変える…」と言葉を分ける）。帯は 1 行（説明は札に指を置くと出る）。
//   2 つの画面で同じ題「全員のマスタの置き場」・同じ形・同じ札。ずれたときは橙の縁と「この PC は別: …\\Apps\\LotScope」の札（字で言う）、手は「全員の置き場にそろえる」と「この PC の置き場を全員に配る」の 2 つ
// 新しい案（3 つ）:
//   H 1 行の帯: 配布の画面は流れの下、マスタの置き場の画面は上の帯の下。同じ形・同じ言葉
//   I 置き場の 2 行: 配布の画面のいちばん上の「置き場 …」の行を「配布の置き場」「全員のマスタの置き場」の 2 行に並べる（同じ形の行。ボタンの言葉も分ける）
//   K 見出しの札: マスタ管理の見出し帯（どのタブでも見える）に「全員: \\…\Masters ✓」の札。配布の画面は H の 1 行
// 持ち越し（直した）: C2（C の配布の画面の 1 行を H の帯に。変える手もその場に）・D2（D の帯を 1 行に縮め、言葉をそろえた）
// 材料（順位に入れない。ずれた形）: H!（H でこの PC が別の置き場）・I!（I で同じく）
// 試験用の画面は、この PC が手元のみ。「この PC も同じ」の形は、この PC が配る版の置き場を使っているときの再現（札だけを描く）

const PIN_FULL = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters";
const MINE_FULL = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Apps\\LotScope";
// パスは先頭（サーバー）と末尾の 2 段を残して真ん中を縮める（どの置き場かは末尾で分かる。全文は札に指を置くと出る）。
// 1280×720 で右端を「…」で切ると、末尾（Masters か LotScope か）が読めなかった（2 回目の下見で見えた）
const PIN = "\\\\nlmsrvngy03\\…\\検査データ\\Masters";
const MINE = "…\\Apps\\LotScope";
const TIP = "2026-10-15 14:30 user（PC-01）が配りました。配る版と一緒に全員の PC へ届き、各 PC は起動したとき・30 分ごとに受け取って、数秒でこの置き場へ移ります。マスタの置き場を変えると、ここも新しい置き場になります。";
const css = `
.pin-row{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;min-width:0;padding:8px 12px;margin-bottom:12px;border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:10px;background:var(--surface)}
.pin-row > b{font-size:13.5px;color:var(--h-input);white-space:nowrap;flex:none}
.pin-row code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 6px;border-radius:4px;white-space:nowrap;flex:none}
.pin-row .m-chip{flex:none;white-space:nowrap}
.pin-row .pin-sp{flex:1 1 0}
.pin-row .pz-btn{flex:none;white-space:nowrap}
.pin-row.is-off{border-left-color:var(--accent);background:var(--amber-soft)}
.pin-row .pin-mine{font-size:12px;color:var(--amber-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.pin-place{margin:10px 0 0}
.dz-where2{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.dz-where2 > div{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;font-size:13px;color:var(--ro-ink);min-width:0}
.dz-where2 > div > b{width:11em;flex:none;color:var(--ink)}
.dz-where2 code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 6px;border-radius:4px;white-space:nowrap;flex:none}
.dz-where2 .m-chip{flex:none}
.dz-where2 .pz-btn{flex:none;white-space:nowrap}
.dz-where2 .is-off code{outline:2px solid var(--accent)}
.mh-pin{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:2px 10px;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-size:12.5px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
.mh-pin code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis}
`;
const chip = (t, c) => `<span class="m-chip ${c}">${t}</span>`;
const esc = (s) => s.replace(/\\/g, "\\\\");
/** 1 行の帯（2 つの画面で同じ）。off: この PC が別の置き場 */
const row = (off = false) => `<div class="pin-row${off ? " is-off" : ""}" title="${TIP}"><b>全員のマスタの置き場</b><code title="${PIN_FULL}">${PIN}</code>`
  + (off ? `<span class="m-chip c-warn" title="${MINE_FULL}">この PC は別: ${MINE}</span><span class="pin-sp"></span><button type="button" class="pz-btn dz-go">全員の置き場にそろえる</button><button type="button" class="pz-btn">この PC の置き場を全員に配る</button>`
    : `${chip("✓ この PC も同じ", "c-on")}<span class="pin-sp"></span><button type="button" class="pz-btn">マスタの置き場を変える…</button>`) + "</div>";

// 画面は読み終えてから描き直す（中身を入れ替える）ので、描き直すたびに差し込み直す（印 data-pin で 2 度は入れない）
const keep = (body) => ["script", `{ const run = () => { ${body} }; run();
  new MutationObserver(run).observe(document.querySelector("#masterSettings") || document.body, { childList: true, subtree: true }); }`];
const before = (sel, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)});
  if (el && !(el.previousElementSibling && el.previousElementSibling.dataset.pin)) el.insertAdjacentHTML("beforebegin", ${JSON.stringify(html.replace(/^<(\w+)/, '<$1 data-pin="1"'))});`);
const after = (sel, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)});
  if (el && !(el.nextElementSibling && el.nextElementSibling.dataset.pin)) el.insertAdjacentHTML("afterend", ${JSON.stringify(html.replace(/^<(\w+)/, '<$1 data-pin="1"'))});`);
// 配布の画面の「置き場を変える…」を「配布の置き場を変える…」に（言葉を分ける）
const renameReleaseBtn = keep(`const b = document.querySelector("#dzPlaceBtn"); if (b && b.textContent !== "配布の置き場を変える…") b.textContent = "配布の置き場を変える…";`);
const releaseRow = (off) => [before("#masterSettings .dz-new", row(off)), renameReleaseBtn];
const placeRow = (off) => after("#masterSettings .mp-now", row(off).replace('class="pin-row', 'class="pin-row pin-place'));
// I: いちばん上の「置き場 …」の行を、2 行（配布の置き場・全員のマスタの置き場）に
const twoLines = (off) => keep(`const w = document.querySelector("#masterSettings .dz-where"); if (!w || w.dataset.pin) return;
  w.dataset.pin = "1"; const code = w.querySelector("code"); const fresh = w.querySelector(".dz-fresh");
  const box = document.createElement("div"); box.className = "dz-where2"; box.dataset.pin = "1";
  box.innerHTML = '<div><b>配布の置き場</b>' + (code ? code.outerHTML : "") + '<span class="m-chip c-on">届いています</span>' + (fresh ? fresh.outerHTML : "") + '<button type="button" class="pz-btn">配布の置き場を変える…</button></div>'
    + '<div class="${off ? "is-off" : ""}" title="${TIP}"><b>全員のマスタの置き場</b><code>${esc(PIN)}</code>${off ? '<span class="m-chip c-warn">この PC は別: ' + esc(MINE) + '</span><button type="button" class="pz-btn dz-go">全員の置き場にそろえる</button><button type="button" class="pz-btn">この PC の置き場を全員に配る</button>' : '<span class="m-chip c-on">✓ この PC も同じ</span><button type="button" class="pz-btn">マスタの置き場を変える…</button>'}</div>';
  w.hidden = true; w.after(box);`);
// K: マスタ管理の見出し帯の札（どのタブでも）
const headPin = ["script", `{ const put = () => { const t = document.querySelector("#masterOverlay .master-head"); if (!t || t.querySelector(".mh-pin")) return;
    const x = t.querySelector("button:last-of-type, [aria-label=閉じる]");
    const html = '<span class="mh-pin" title="${TIP}">全員のマスタ <code>${esc(PIN)}</code> ✓ この PC も同じ</span>';
    if (x) x.insertAdjacentHTML("beforebegin", html); else t.insertAdjacentHTML("beforeend", html); };
  put(); new MutationObserver(put).observe(document.body, { childList: true, subtree: true }); }`];

export const PROPOSALS = [
  { key: "0", name: "今（マスタの置き場は配布の画面に出ない）", css: "", ops: [] },
  { key: "H", name: "1 行の帯: 配布の画面は流れの下、マスタの置き場の画面は上の帯の下（同じ題・形・札。ボタンは「マスタの置き場を変える…」）",
    css, ops: [...releaseRow(false), placeRow(false)] },
  { key: "I", name: "置き場の 2 行: 配布の画面の上の行を「配布の置き場」「全員のマスタの置き場」の 2 行に（同じ形の行）。マスタの置き場の画面は H の帯",
    css, ops: [twoLines(false), placeRow(false)] },
  { key: "K", name: "見出しの札: マスタ管理の見出し帯に「全員のマスタ …✓」（どのタブでも見える）＋配布の画面に H の帯",
    css, ops: [headPin, ...releaseRow(false)] },
  { key: "C2", name: "C を直す: マスタの置き場の画面に帯（直す手つき）、配布の画面にも同じ 1 行の帯（変える手はその場に）",
    css, ops: [...releaseRow(false), before("#masterSettings .mp-sec", row(false))] },
  { key: "D2", name: "D を直す: 両方の画面に同じ 1 行の帯（題「全員のマスタの置き場」・ボタンの言葉をそろえた）。配布の画面は上の置き場の行のすぐ下",
    css, ops: [after("#masterSettings .dz-where", row(false)), renameReleaseBtn, placeRow(false)] },
  { key: "H!", name: "（材料）H でこの PC が別の置き場: 橙の縁・「この PC は別」・「この PC: …」・2 つの手",
    css, ops: [...releaseRow(true), placeRow(true)] },
  { key: "I!", name: "（材料）I でこの PC が別の置き場",
    css, ops: [twoLines(true), placeRow(true)] },
];
