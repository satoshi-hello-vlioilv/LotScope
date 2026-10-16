// 2026-10 推奨アップデートの札と、使っている人への知らせ（版 3.35.0）。2 回目。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recommend-2.mjs --states update-recommended,update-recommended-work,master-release-recommended
//   （--view 1280x720 でも）
// 1 回目（2026-10-recommend.mjs・.json）の 1 位は C（一覧の上の細い帯・80.6 点）。採点者が挙げた直す所:
//   ①配布の画面で「推奨にする…」と「推奨を外す」が並ぶ（案の差し込みと本物が重なった）→ 本物を作ったので、配布の画面は差し込まない
//     （master-release-recommended は、配っている版に札が付いた形の作り物の答え）
//   ②見出しの札の「更新あり 3.13.0」と帯の言葉が違う → 札も「推奨 3.13.0」にし、帯と同じ色で 1 つの知らせにする
//   ③ボタンの並び（アプリのほかの窓と同じく「あとで」左・「更新して開き直す」右） ④どの画面でも出るか（作業実績でも撮る）
//   ⑤題と理由の強弱・注意の色（橙・赤）と分けた知らせの色 → 藍（入力・案内の色 --h-input）の淡い面と藍の縁に決める
//   ⑥「あとで」を押した後（帯を畳み、見出しの札だけが残る）を見せる → 材料 *- で撮る
// 新しい案（3 つ以上）:
//   J 見出しのすぐ下の細い帯（切断の帯と同じ置き場。どの画面でも同じ所に 1 行）
//   M 一覧の面のいちばん上（元データが古いときの帯と同じ置き場・同じ形。色だけ藍）
//   K 件数の行の札（「元データ …」の隣に「↻ 推奨 3.13.0 理由…」。押すと更新して開き直す）
//   L 見出しの中の 1 行（画面のタブの右に「推奨アップデート 3.13.0 ［更新して開き直す］」。理由は指を置くと出る）
// 持ち越し（直した）: C2（C の帯を藍にし、②③⑤を直した）

const NOTE = "ほかの PC がマスタの置き場に追従しない不具合を直しました";
const css = `
.rc-band{display:flex;align-items:center;gap:12px;min-width:0;padding:6px 8px 6px 14px;border-radius:8px;background:var(--input-soft);border:1px solid #b9cde2;border-left:4px solid var(--h-input);font-size:13px;color:var(--ink);flex:0 0 auto}
.rc-band > b{color:var(--h-input);font-size:13.5px;white-space:nowrap;flex:none}
.rc-band > span{color:#41566c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.rc-band > i{flex:1 1 0}
.rc-band button{flex:none;white-space:nowrap;height:28px;padding:0 12px}
.rc-c2{margin:0 0 8px}
.rc-m{margin:8px 16px 0}
.rc-j{border-radius:0;border-width:0 0 1px 0;border-left:0;padding:5px 18px;background:var(--input-soft);border-bottom-color:#b9cde2}
.rc-pill{background:var(--input-soft)!important;color:var(--h-input)!important;font-weight:700}
.rc-k{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 6px 0 12px;border-radius:999px;background:var(--input-soft);border:1px solid #b9cde2;color:var(--h-input);font-size:13px;white-space:nowrap;max-width:520px;min-width:0}
.rc-k > span{color:#41566c;overflow:hidden;text-overflow:ellipsis;min-width:0}
.rc-k button{height:24px;padding:0 10px;flex:none}
.rc-l{display:flex;align-items:center;gap:8px;margin-left:14px;padding:4px 6px 4px 12px;border-radius:999px;background:var(--input-soft);color:var(--h-input);font-size:13px;font-weight:700;white-space:nowrap;flex:none}
.rc-l button{height:26px;padding:0 10px}
`;
const btns = '<button type="button" class="btn-ghost">あとで</button><button type="button" class="btn-primary">更新して開き直す</button>';
const band = (cls) => `<div class="rc-band ${cls}" role="status" data-rc="1"><b>推奨アップデート 3.13.0</b><span title="${NOTE}">${NOTE}</span><i></i>${btns}</div>`;
// 画面は描き直すので、描き直すたびに差し込み直す（印 data-rc で 2 度は入れない）
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const put = (sel, where, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)}); if (el && !document.querySelector("[data-rc]")) el.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)});`);
// 見出しの札を帯と同じ言葉・色に（画面が札を描き直しても、字で確かめて当て直す）
const chip = keep(`const b = document.querySelector("#verNew"); if (b && !b.classList.contains("hidden") && b.textContent !== "推奨 3.13.0") { b.classList.add("rc-pill"); b.textContent = "推奨 3.13.0"; b.title = "推奨アップデート 3.13.0（${NOTE}）。押すと更新して開き直せます"; }`);

export const PROPOSALS = [
  { key: "0", name: "今（見出しの小さな「更新あり 3.13.0」だけ）", css: "", ops: [] },
  { key: "C2", name: "C を直す: 件数の行の上の細い帯（藍・題と理由の強弱・あとで左）＋見出しの札も「推奨 3.13.0」", css, ops: [chip, put("#lotListScreen .ll-status", "beforebegin", band("rc-c2"))] },
  { key: "J", name: "見出しのすぐ下の細い帯（切断の帯と同じ置き場。どの画面でも同じ所）＋見出しの札", css, ops: [chip, put("#revokedBar", "afterend", band("rc-j"))] },
  { key: "M", name: "一覧の面のいちばん上（元データが古いときの帯と同じ置き場・同じ形。色は藍）＋見出しの札", css, ops: [chip, put("#llStale", "afterend", band("rc-m"))] },
  { key: "K", name: "件数の行の札（「元データ」の隣。理由を短く・押すと更新）＋見出しの札", css, ops: [chip,
    put("#lotListScreen .ll-status > :last-child", "beforebegin", `<span class="rc-k" role="status" data-rc="1" title="${NOTE}"><b>↻ 推奨 3.13.0</b><span>${NOTE}</span><button type="button" class="btn-primary">更新</button></span>`)] },
  { key: "L", name: "見出しの中の 1 行（画面のタブの右。理由は指を置くと出る）", css, ops: [chip,
    put("header .screen-tabs", "afterend", `<div class="rc-l" role="status" data-rc="1" title="${NOTE}">推奨アップデート 3.13.0<button type="button" class="btn-primary">更新して開き直す</button></div>`)] },
  { key: "C2-", name: "（材料）C2 で「あとで」を押した後: 帯を畳み、見出しの札「推奨 3.13.0」だけが残る", css, ops: [chip] },
];
