// 2026-10 アプリ名の副題（版 3.38.0。利用者の要望 4）。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-subtitle-2.mjs --states dash,list
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-subtitle-2.mjs --states dash,list --view 1280x720
// 1 回目（2026-10-subtitle.mjs・.json）の 1 位は S3「仕掛・実績・品質の見える化」83.2 点・2 位 S2 82.1 点。採点者が挙げた直す所:
//   ①タブの言葉に合わせる（実績 → 作業実績） ②副題が長く、見出しの左が広がってタブの始まりが右へずれる → 字を小さく・薄く・短く
//   ③S5（名前と版を 1 段）は 1728 で軽くきれいだが、1280 で「終了」が画面の外 → 広い窓だけにする
//   ④窓の題名・ショートカット・起動画面も同じ文言に（brand.json の subtitle 1 か所）
// 持ち越し（直した）: S3b（「仕掛・作業実績・品質の見える化」を小さく・薄く）
// 新しい案（4 つ）:
//   S7 「現場データの見える化」（短い言い替え。今の副題より 1 字短く、タブの始まりがずれない）
//   S8 広い窓だけ名前と版を 1 段＋短い副題「仕掛・作業実績・品質」（1440 以下は今の 2 段）
//   S9 英字の段を和字の小さな案内に「仕掛・作業実績・品質データ」（版の札と同じ段）。名前の横の副題は外す
//   S10 どちらも外し、副題は窓の題名・ショートカットにだけ残す（見出しは名前と版だけ。今の 2 段の形のまま）

const set = (eb, sub, ebCss = "") => ["script", `{ const t = document.querySelector('.brand .eyebrow .eb-text'), s = document.querySelector('.brand h1 .brand-sub');
  ${eb === null ? "if (t) t.remove();" : `if (t) { t.textContent = ${JSON.stringify(eb)}; ${ebCss ? `t.classList.add(${JSON.stringify(ebCss)});` : ""} }`}
  ${sub === null ? "if (s) s.remove();" : `if (s) s.textContent = ${JSON.stringify(sub)};`} }`];
const quiet = `.brand h1 .brand-sub{font-size:12px;opacity:.7;letter-spacing:.02em}`;

export const PROPOSALS = [
  { key: "S3b", name: "「仕掛・作業実績・品質の見える化」（小さく・薄く）", css: quiet, ops: [set(null, "仕掛・作業実績・品質の見える化")] },
  { key: "S7", name: "「現場データの見える化」（短い言い替え）", css: "", ops: [set(null, "現場データの見える化")] },
  {
    key: "S8", name: "広い窓だけ名前と版を 1 段＋「仕掛・作業実績・品質」",
    css: `@media (min-width:1441px){.brand{display:flex;align-items:center;gap:10px}.brand .eyebrow{order:1;display:flex;gap:6px;align-items:center}}${quiet}`,
    ops: [set(null, "仕掛・作業実績・品質")],
  },
  {
    key: "S9", name: "英字の段を和字の小さな案内「仕掛・作業実績・品質データ」に（名前の横は外す）",
    css: `.brand .eyebrow .eb-text.pv-ja{letter-spacing:.06em;font-size:11px;opacity:.85}`,
    ops: [set("仕掛・作業実績・品質データ", null, "pv-ja")],
  },
  { key: "S10", name: "どちらも外す（副題は窓の題名・ショートカットだけ）", css: "", ops: [set(null, null)] },
];
