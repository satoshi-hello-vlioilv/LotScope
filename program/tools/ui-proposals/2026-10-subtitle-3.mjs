// 2026-10 アプリ名の副題（版 3.38.0。利用者の要望 4）。3 回目（合格点 80 点。最後の回）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-subtitle-3.mjs --states dash,list
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-subtitle-3.mjs --states dash,list --view 1280x720
// 2 回目（2026-10-subtitle-2.mjs）の 1 位は S3b「仕掛・作業実績・品質の見える化」84.9 点（合格点 90 に届かず）・2 位 S10（どちらも外す）82.0 点。
// 採点者の指摘: S3b は言葉は良いが、名前の右に置くと見出しの左が広がり、タブの始まりが S10 より約 130px 右になる。
//   → 名前と版の札を 1 段目、12px の副題を 2 段目に置けば、左の幅は名前と札の幅に収まり、タブがずれない（階層化・整列・言葉が両立）。
//   ほかに S8 は推奨の札がある日に 1728 でも「終了」が画面の外へ出た（1 段にするなら幅に注意）。
// 1440px 以下（フル HD の 125%・150%）は今と同じ畳み方（英字と副題を畳み、版の札は名前の上）。広い窓だけ 2 段の形にする。
// 持ち越し: S3b・S10
// 新しい案（3 つ）: 2 段目に副題（名前と版の札が 1 段目）
//   S3c 「仕掛・作業実績・品質の見える化」 ／ S7c 「現場データの見える化」 ／ S11c 「仕掛・作業実績・品質」

const set = (sub) => ["script", `{ const t = document.querySelector('.brand .eyebrow .eb-text'), s = document.querySelector('.brand h1 .brand-sub');
  if (t) t.remove(); ${sub === null ? "if (s) s.remove();" : `if (s) s.textContent = ${JSON.stringify(sub)};`} }`];
/** 2 段: 1 段目＝名前と版の札（版の札・推奨の札を名前の右へ）・2 段目＝12px の副題（広い窓だけ） */
const twoRows = (sub) => ({
  css: `@media (min-width:1441px){
  .brand{display:flex;flex-direction:column;justify-content:center;gap:1px}
  .brand .pv-r1{display:flex;align-items:center;gap:8px}
  .brand .pv-r1 h1{margin:0}
  .brand .pv-r1 .eyebrow{display:flex;align-items:center;gap:6px;letter-spacing:.06em}
  .brand .pv-sub{font-size:12px;font-weight:500;letter-spacing:.04em;opacity:.78;line-height:1.2;white-space:nowrap}
}
@media (max-width:1440px){.brand .pv-sub{display:none}}`,
  ops: [set(null), ["script", `{ const b = document.querySelector('.brand'), h = b.querySelector('h1'), e = b.querySelector('.eyebrow');
    if (matchMedia('(min-width:1441px)').matches) { const r = document.createElement('div'); r.className = 'pv-r1'; b.prepend(r); r.append(h, e); }
    b.insertAdjacentHTML('beforeend', '<div class="pv-sub">' + ${JSON.stringify(sub)} + '</div>'); }`]],
});
const quiet = `.brand h1 .brand-sub{font-size:12px;opacity:.7;letter-spacing:.02em}`;

export const PROPOSALS = [
  { key: "S3c", name: "2 段目に「仕掛・作業実績・品質の見える化」（名前と版の札が 1 段目）", ...twoRows("仕掛・作業実績・品質の見える化") },
  { key: "S7c", name: "2 段目に「現場データの見える化」", ...twoRows("現場データの見える化") },
  { key: "S11c", name: "2 段目に「仕掛・作業実績・品質」", ...twoRows("仕掛・作業実績・品質") },
  { key: "S3b", name: "名前の右に「仕掛・作業実績・品質の見える化」（小さく・薄く。2 回目の 1 位）", css: quiet, ops: [set("仕掛・作業実績・品質の見える化")] },
  { key: "S10", name: "どちらも外す（副題は窓の題名・ショートカットだけ。2 回目の 2 位）", css: "", ops: [set(null)] },
];
