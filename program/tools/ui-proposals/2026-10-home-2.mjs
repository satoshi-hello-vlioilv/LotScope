// 2026-10「初期画面（異常ロット一覧）」2 回目（1 回目は 1 位 H1 78.5 が 80 点に届かず、H7 77.0 と僅差）。1 回目の上位 3 案（H1・H7・H5）と複合 4 案。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-home-2.mjs --states list,calc
//
// 抜き出したエッセンス:
//   H1 … 状態（データ元・接続・待機中）を 1 つの札にまとめ、操作（マスタ管理・アプリ・終了）と形で分ける。頁の頭を 1 行（題＋押すと何が起きるかの札＋「表」）
//   H7 … 見出しの帯には名前・切り替え・操作だけ（状態は周辺へ）
//   H5 … 明るく軽い見出しの帯・下線のタブ
//   H4 … 頁の頭を畳み、表の行を増やす  H2 … 件数を見出しに
// 組み直した複合案:
//   X1 = H1 の見出しの帯 ＋ H4 の畳んだ頁の頭（押すと何が起きるかの札・表・元データは件数の行へ）
//   X2 = H7 の下の帯 ＋ H1 の 1 行の頁の頭
//   X3 = H5 の明るい帯 ＋ H1 のまとめた状態の札と 1 行の頁の頭
//   X4 = H1 ＋ H2 の件数を題の横に（件数の行から件数を外す）＋ 終了を静かに

import { PROPOSALS as FIRST } from "./2026-10-home.mjs";

const pick = (key) => FIRST.find((p) => p.key === key);
const H1 = pick("H1"), H4 = pick("H4"), H5 = pick("H5"), H7 = pick("H7");
const HEADER_OPS = H1.ops.slice(0, 4);   // 状態を 1 つの札に（hstat）
const HINT = '<span class="hhint">ロット番号を押すと、計算へ移って取り込みます</span>';

export const PROPOSALS = [
  H1, H7, H5,
  {
    key: "X1", name: "H1 の帯＋頁の頭を畳む（札・表・元データは件数の行へ）",
    css: `${H1.css}${H4.css}
 .ll-status{gap:12px}
 .ll-status .hhint{font-size:12px;padding:2px 10px}
 .ll-status .tlabel{margin-left:6px}
`,
    ops: [...HEADER_OPS, ["insert", '<span class="tlabel">表</span>', "beforebegin", "#llTable"], ...H4.ops,
      ["move", ".tlabel", "before", "#llTable"], ["insert", HINT, "afterend", "#llFresh"]],
  },
  {
    key: "X2", name: "H7 の下の帯＋H1 の 1 行の頁の頭",
    css: `${H7.css}
 .ll-head{padding:12px 18px 4px}
 .ll-title{display:flex;align-items:center;gap:14px}
 .ll-title h2{font-size:17px}
 .hhint{font-size:12.5px;font-weight:600;color:var(--h-input);background:var(--input-soft);padding:3px 10px;border-radius:999px}
 .tlabel{font-size:12.5px;color:var(--muted);font-weight:700}
`,
    ops: [...H7.ops, ["insert", HINT, "beforeend", ".ll-title"], ["insert", '<span class="tlabel">表</span>', "beforebegin", "#llTable"]],
  },
  {
    key: "X3", name: "H5 の明るい帯＋H1 の状態の札と 1 行の頁の頭",
    css: `${H5.css}${H1.css}
 .hstat{background:var(--surface-3);border-color:var(--line)}
 .hstat .pill{color:var(--ink)}
 .hstat .pill + .pill{border-left-color:var(--line)}
 .hstat #conn.conn-ok{color:var(--ok-ink)}
 .hsep{background:var(--line)}
 #quitBtn{color:var(--muted)}
`,
    ops: [...H1.ops],
  },
  {
    key: "X4", name: "H1＋件数を題の横に（H2）・終了を静かに",
    css: `${H1.css}
 .ll-title #llCount{font-size:22px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
 .ll-title h2{color:var(--muted);font-size:15px}
`,
    ops: [...H1.ops, ["move", "#llCount", "after", ".ll-title h2"]],
  },
];
