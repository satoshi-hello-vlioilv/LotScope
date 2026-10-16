// 2026-10 アプリ名の副題（版 3.38.0。利用者の要望 4「QUALITY ANALYSIS・転写距離・ピッチ解析は、高機能化して合わなくなった。削除か合う文言に」）。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-subtitle.mjs --states dash,list
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-subtitle.mjs --states dash,list --view 1280x720
// 今: 見出しの左上に飾りの英字「QUALITY ANALYSIS」（10px・字間 .22em）と版の札、その下に「LotScope 転写距離・ピッチ解析」。
//   アプリは今、ダッシュボード（仕掛・実績）・異常ロット一覧（品質データ）・作業実績・仕掛・転写・ピッチ計算・集計表を持ち、
//   「品質の解析」「転写距離・ピッチ」は 6 つの画面のうち 1〜2 つしか言っていない。副題は窓の題名・ショートカットの説明（スタートで乗せると出る）・起動画面にも出る。
// 案の方向（減らし方・言い替え・置き場）:
//   S1 どちらも消す（名前と版の札だけ。飾りを減らす）
//   S2 英字を消し、副題を「生産・品質の見える化」（言い替え。今と同じ 10 字で、見出しの幅は変わらない）
//   S3 英字を消し、副題を「仕掛・実績・品質の見える化」（言い替え。何が見えるかを具体的に・データの 3 つの種類の色と同じ順）
//   S4 英字を「MANUFACTURING DATA」に、副題を消す（英字の飾りは残し、和名を外す）
//   S5 英字を消し、名前と版を 1 段に（置き場: 版の札を名前の右に。副題なし。見出しの左が 1 段で軽い）
//   S6 英字を消し、副題を「ロットの見える化と分析」（言い替え。名前 LotScope の意味を和名で）

const set = (eb, sub) => ["script", `{ const t = document.querySelector('.brand .eyebrow .eb-text'), s = document.querySelector('.brand h1 .brand-sub');
  ${eb === null ? "if (t) t.remove();" : `if (t) t.textContent = ${JSON.stringify(eb)};`}
  ${sub === null ? "if (s) s.remove();" : `if (s) s.textContent = ${JSON.stringify(sub)};`} }`];

export const PROPOSALS = [
  { key: "S0", name: "今（QUALITY ANALYSIS・転写距離・ピッチ解析）", css: "", ops: [] },
  { key: "S1", name: "どちらも消す（名前と版の札だけ）", css: "", ops: [set(null, null)] },
  { key: "S2", name: "英字を消し、副題「生産・品質の見える化」", css: "", ops: [set(null, "生産・品質の見える化")] },
  { key: "S3", name: "英字を消し、副題「仕掛・実績・品質の見える化」", css: "", ops: [set(null, "仕掛・実績・品質の見える化")] },
  { key: "S4", name: "英字を「MANUFACTURING DATA」に、副題を消す", css: "", ops: [set("MANUFACTURING DATA", null)] },
  {
    key: "S5", name: "英字・副題を消し、名前と版の札を 1 段に",
    css: `.brand{display:flex;align-items:center;gap:10px}.brand h1{order:0}.brand .eyebrow{order:1;display:flex;gap:6px;align-items:center}`,
    ops: [set(null, null)],
  },
  { key: "S6", name: "英字を消し、副題「ロットの見える化と分析」", css: "", ops: [set(null, "ロットの見える化と分析")] },
];
