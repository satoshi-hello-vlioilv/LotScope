"use strict";
/* =========================================================================
   LotDsp（ロット問い合わせ）を、ロットを指定して開く URL。WaveLog の static/js/core/base.js の
   buildLotDspUrl・lotDspLinkKey・WL.lotDspTab と同じ作り（同じ URL を作る）。
   - linkkey ＝「7 文字の固定幅のロット番号」＋半角スペース 3 つ＋「7 文字の固定幅の鋳造番号」
     （WaveLog が実機の URL から確かめた形）。この URL を開くと、LotDsp の側が linkkey を読んで検索まで行う
   - tab ＝開くタブの番号（TABS。名前は LotDsp の画面に並んでいる物。番号は URL へ渡す値なので変えない）。既定は 1（進度情報）
   - 場所は参照先マスタの「ロット問い合わせ（LotDsp）の URL」（http://…/LotDspWeb/）に #/lotdsp を付けた所
   DOM を使わない（評価関数 program/tools/lotdsp-url-check.mjs が node で確かめる）
   ========================================================================= */
(function (root) {
  const TABS = [[0, "ICAS情報"], [1, "進度情報"], [2, "製造情報"], [3, "試験情報"],
    [4, "品質情報"], [5, "クラッド情報"], [6, "焼鈍情報"], [7, "引当情報"]];
  const DEFAULT_TAB = "1";
  const field = (v) => String(v || "").slice(0, 7).padEnd(7, " ");
  /** linkkey（ロット番号・鋳造番号 → 7 字＋空白 3 つ＋7 字） */
  const linkKey = (lotNo, castingNo) => field(lotNo) + "   " + field(castingNo);
  /** 検索の画面の場所（設定の URL の # 以降は捨て、/#/lotdsp を付ける） */
  const searchBase = (url) => String(url || "").trim().replace(/#.*$/, "").replace(/\/+$/, "") + "/#/lotdsp";
  /** 開く URL。tab が TABS に無ければ既定のタブ */
  function build(url, lotNo, castingNo, tab) {
    const t = TABS.some(([n]) => String(n) === String(tab)) ? String(tab) : DEFAULT_TAB;
    return `${searchBase(url)}?linkkey=${encodeURIComponent(linkKey(lotNo, castingNo))}&tab=${encodeURIComponent(t)}`;
  }
  const label = (n) => { const t = TABS.find(([k]) => String(k) === String(n)); return t ? t[1] : ""; };
  root.LotDspUrl = { TABS, DEFAULT_TAB, linkKey, searchBase, build, label };
})(typeof window !== "undefined" ? window : globalThis);
