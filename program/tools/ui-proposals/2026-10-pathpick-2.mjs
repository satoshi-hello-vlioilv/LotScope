// 2026-10 フォルダ・ファイルの欄の補助（2 回目。1 回目の上位 3 案 A・D・E と、効いていたエッセンスを組み直した複合案 4 つ）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pathpick-2.mjs --states master-place,master-paths [--view 1536x864]
// 1 回目で効いて見えた所:
//   A の窓: 中身の印（マスタあり・.sqlite3 が 1 つ）と「よく使う場所」で、探させず・合っているかが選ぶ前に分かる
//   D の候補の札: 窓を開かずに 1 回押すだけで入る（いちばん短い）
//   E の区切りの札: どこまで届いているかが緑で見える（ただし欄を打てない形になり、貼り付けにくい）
//   C の打ちながらの候補: 覚えている人には速い（1 回目は鍵の案内が崩れて見えにくかった）
//   F の「エクスプローラーで開く」: 選んだ所をすぐ見に行ける
import { BTN, CSS, DLG, KIT, PATHS_BTN, PROPOSALS as R1, ROOT, go } from "./2026-10-pathpick.mjs";

const pick = (k) => R1.find((p) => p.key === k);
const CHIPS = (key) => `const g = X.$(".mp-form .dz-pl-grid"); if (!g) return;
  g.insertAdjacentHTML("afterend", '<div class="px-chips" data-px="${key}"><b>よく使う場所</b>'
  + '<span><code>${ROOT}\\\\【New】仕掛</code><small>品質データと同じ場所</small></span>'
  + '<span><code>${ROOT}\\\\【New】実績</code><small>作業実績のフォルダ</small></span>'
  + '<span><code>C:\\\\boxdrive\\\\Box\\\\(D)_仕上課\\\\90_アプリ開発</code><small>配布の置き場の上</small></span></div>');`;
const AC = (key) => `X.fill("#mpParent", "${ROOT}\\\\【New】"); const i = X.$("#mpParent"); const r = i.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="px-ac" data-px="${key}" style="position:fixed;left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px;width:' + r.width + 'px">'
  + '<span class="on">📁<b>${ROOT}\\\\【New】仕掛</b><em>届く・マスタあり</em></span><span>📁<b>${ROOT}\\\\【New】実績</b><em>届く</em></span><span>📁<b>${ROOT}\\\\【New】台帳</b><em>届く</em></span>'
  + '<small><span class="px-key">↓</span> で選ぶ・<span class="px-key">Tab</span> で補う</small></div>');`;
const PATHS_CHIPS = (key) => `const c = X.$('#masterSettings .ps-card[data-key="update.source"] .ps-row'); if (!c) return;
  c.insertAdjacentHTML("afterend", '<div class="px-chips" data-px="${key}"><b>よく使う場所</b><span><code>C:\\\\boxdrive\\\\Box\\\\(D)_仕上課\\\\90_アプリ開発\\\\90_Releases</code><small>BOX で見つかった版の置き場</small></span></div>');`;

export const PROPOSALS = [
  pick("A"), pick("D"), pick("E"),
  { key: "M1", name: "複合: A（参照… の窓・中身の印）＋ D（欄の下によく使う場所の札。窓の左と同じ出所）", css: CSS,
    ops: [KIT, go("M1b", BTN("M1b", "#mpParent", "📁 参照…", true)), go("M1c", CHIPS("M1c")),
      go("M1d", DLG("M1d", "置く場所を選ぶ", "マスタのフォルダを置く、上のフォルダを選びます").replace("(r.bottom + 8)", "(r.bottom + 70)")),
      go("M1p", PATHS_BTN("M1p", "📁 フォルダを選ぶ…")), go("M1q", PATHS_CHIPS("M1q"))] },
  { key: "M2", name: "複合: A（参照… の窓）＋ C（打つと下のフォルダが候補に。届く所に ✓）", css: CSS,
    ops: [KIT, go("M2b", BTN("M2b", "#mpParent", "📁 参照…")), go("M2a", AC("M2a")), go("M2p", PATHS_BTN("M2p", "📁 フォルダを選ぶ…"))] },
  { key: "M3", name: "複合: A（参照… の窓）＋ F（窓と欄に「エクスプローラーで開く」・貼った \"\" を外す）", css: CSS,
    ops: [KIT, go("M3b", BTN("M3b", "#mpParent", "📁 参照…", true)),
      go("M3d", DLG("M3d", "置く場所を選ぶ", "マスタのフォルダを置く、上のフォルダを選びます").replace("＋ 新しいフォルダ", "エクスプローラーで開く")),
      go("M3p", PATHS_BTN("M3p", "📁 フォルダを選ぶ…"))] },
  { key: "M4", name: "複合: D（よく使う場所の札）＋ E（区切りの札で届く所を緑に・区切りから選び直す）。窓は出さない", css: CSS,
    ops: [KIT, go("M4c", CHIPS("M4c")), ...pick("E").ops.slice(1)] },
];
