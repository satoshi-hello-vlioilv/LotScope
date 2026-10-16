// 2026-10 推奨アップデートの札と、使っている人への知らせ（版 3.35.0）。3 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recommend-3.mjs --states update-recommended,update-recommended-work,master-release-recommended
//   （--view 1280x720 でも）
// 2 回目（2026-10-recommend-2.mjs）の 1 位は M（面のいちばん上の帯・89.2 点。2 回目の合格点 90 に 0.8 点足りない）。採点者が挙げた直す所:
//   ①帯が厚い（約 46px・一覧を約 59px 押し下げる）→ 高さ 32px・ボタン 24px・上下の余白を詰める
//   ②色と字だけで知らせている → 形の印「↻」（更新の印）を帯と見出しの札の両方に付ける
//   ③畳んだ後の見出しの札を押すと何が起きるか分からない → 札の字を「↻ 推奨 3.13.0」にし、押すと帯が戻る（指を置くと「押すと知らせを開きます」）
//   ④撮る材料の食い違い（配布の画面が 3.12.0 を配っていた）→ master-release-recommended は 3.13.0 を配り、推奨の札が付いた形に直した
// 持ち越し（直した）: M2（M に ①②③）・C3（C2 の帯の端を道具の行にそろえ、①②③）
// 新しい案（3 つ）:
//   Q 面のいちばん下の帯（一覧の下。目の流れの終わり。押し下げない代わりに一覧の高さが縮む）
//   R M2 をさらに詰める（「あとで」を × にし、手は「更新して開き直す」の 1 つ。題と理由を 1 本の文に）
//   T M2 ＋「何が変わる？」（更新履歴の窓を開いて新しい版の中身を見せる）
// 材料（順位に入れない）: M2-（M2 で「あとで」を押した後: 見出しの札「↻ 推奨 3.13.0」だけ。押すと帯が戻る）

const NOTE = "ほかの PC がマスタの置き場に追従しない不具合を直しました";
const css = `
.rc-band{display:flex;align-items:center;gap:10px;min-width:0;height:32px;box-sizing:border-box;padding:0 4px 0 10px;border-radius:8px;background:var(--input-soft);border:1px solid #b9cde2;border-left:4px solid var(--h-input);font-size:13px;color:var(--ink);flex:0 0 auto}
.rc-band > .rc-ic{flex:none;width:18px;height:18px;border-radius:50%;background:var(--h-input);color:#fff;font:700 12px/18px sans-serif;text-align:center}
.rc-band > b{color:var(--h-input);font-size:13.5px;white-space:nowrap;flex:none}
.rc-band > span{color:#41566c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.rc-band > i{flex:1 1 0}
.rc-band button{flex:none;white-space:nowrap;height:24px;padding:0 10px;font-size:12.5px}
.rc-band .rc-x{border:0;background:none;color:#41566c;font-size:16px;width:24px;padding:0;cursor:pointer}
.rc-band .rc-more{border:0;background:none;color:var(--h-input);text-decoration:underline;padding:0 4px;cursor:pointer}
.rc-m{margin:6px 16px 0}
.rc-c3{margin:0 0 6px}
.rc-q{margin:6px 16px 8px}
.rc-pill{background:var(--input-soft)!important;color:var(--h-input)!important;font-weight:700}
`;
const ic = '<em class="rc-ic" aria-hidden="true">↻</em>';
const later = '<button type="button" class="btn-ghost">あとで</button>';
const go = '<button type="button" class="btn-primary">更新して開き直す</button>';
const band = (cls, inner) => `<div class="rc-band ${cls}" role="status" data-rc="1">${ic}${inner}</div>`;
const std = `<b>推奨アップデート 3.13.0</b><span title="${NOTE}">${NOTE}</span><i></i>${later}${go}`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const put = (sel, where, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)}); if (el && !document.querySelector("[data-rc]")) el.insertAdjacentHTML(${JSON.stringify(where)}, ${JSON.stringify(html)});`);
const chip = keep(`const b = document.querySelector("#verNew"); if (b && !b.classList.contains("hidden") && b.textContent !== "↻ 推奨 3.13.0") { b.classList.add("rc-pill"); b.textContent = "↻ 推奨 3.13.0"; b.title = "推奨アップデート 3.13.0（${NOTE}）。押すと知らせを開きます"; }`);
// C3: 件数の行の上。帯の左右の端を道具の行（#llFilterBar の枠）にそろえる
const c3 = keep(`const s = document.querySelector("#lotListScreen .ll-status"), f = document.querySelector("#llFilterBar"); if (!s || !f || document.querySelector("[data-rc]")) return;
  s.insertAdjacentHTML("beforebegin", ${JSON.stringify(band("rc-c3", std))});
  const b = document.querySelector("[data-rc]"), r = f.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect();
  b.style.marginLeft = (r.left - p.left) + "px"; b.style.marginRight = (p.right - r.right) + "px";`);

export const PROPOSALS = [
  { key: "0", name: "今（見出しの小さな「更新あり 3.13.0」だけ）", css: "", ops: [] },
  { key: "M2", name: "M を直す: 面のいちばん上の帯を 32px に・↻ の印・見出しの札「↻ 推奨 3.13.0」（押すと帯が戻る）", css, ops: [chip, put("#llStale", "afterend", band("rc-m", std))] },
  { key: "C3", name: "C2 を直す: 件数の行の上の帯（端を道具の行にそろえる）・32px・↻ の印", css, ops: [chip, c3] },
  { key: "Q", name: "面のいちばん下の帯（一覧の下。押し下げない）・32px・↻ の印", css, ops: [chip, put("#lotListScreen .ll-panel", "beforeend", band("rc-q", std))] },
  { key: "R", name: "M2 をさらに詰める（あとで を × に。手は 1 つ。題と理由を 1 本の文に）", css, ops: [chip,
    put("#llStale", "afterend", band("rc-m", `<b>推奨アップデート 3.13.0</b><span title="${NOTE}">— ${NOTE}</span><i></i>${go}<button type="button" class="rc-x" aria-label="あとで（閉じる）" title="あとで（4 時間は出しません）">×</button>`))] },
  { key: "T", name: "M2 ＋「何が変わる？」（更新履歴の窓で新しい版の中身を見せる）", css, ops: [chip,
    put("#llStale", "afterend", band("rc-m", `<b>推奨アップデート 3.13.0</b><span title="${NOTE}">${NOTE}</span><button type="button" class="rc-more">何が変わる？</button><i></i>${later}${go}`))] },
  { key: "M2-", name: "（材料）M2 で「あとで」を押した後: 見出しの札「↻ 推奨 3.13.0」だけ（押すと帯が戻る）", css, ops: [chip] },
];
