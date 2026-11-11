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
  /* 前後から除く空白: Python の str.strip と JS の trim のどちらでも空白の字（サーバーの lotdsp_rules.SITE_SPACES・窓の lotdsp.rs と同じ。
     版 3.98.0: 場所の組み立ては site_base の 1 つの決まり。事例の表 tests/fixtures/lotdsp_rules_cases.json） */
  const SPACES = "\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
  const trim = (s) => { let a = 0, b = s.length; while (a < b && SPACES.includes(s[a])) a++; while (b > a && SPACES.includes(s[b - 1])) b--; return s.slice(a, b); };
  /** LotDsp の場所（前後の空白を除き、# から後ろを捨て、末尾の / を除く） */
  const siteBase = (url) => trim(String(url || "")).replace(/#[\s\S]*$/, "").replace(/\/+$/, "");
  /** 検索の画面の場所（場所に /#/lotdsp を付ける。場所が空なら空） */
  const searchBase = (url) => { const b = siteBase(url); return b ? b + "/#/lotdsp" : ""; };
  /** 開く URL。tab が TABS に無ければ既定のタブ */
  function build(url, lotNo, castingNo, tab) {
    const t = TABS.some(([n]) => String(n) === String(tab)) ? String(tab) : DEFAULT_TAB;
    return `${searchBase(url)}?linkkey=${encodeURIComponent(linkKey(lotNo, castingNo))}&tab=${encodeURIComponent(t)}`;
  }
  const label = (n) => { const t = TABS.find(([k]) => String(k) === String(n)); return t ? t[1] : ""; };
  root.LotDspUrl = { TABS, DEFAULT_TAB, linkKey, siteBase, searchBase, build, label };

  /* 取込の結果の札（app.js の paintImportReport が使う。版 3.98.0）。字だけを組む（esc は呼ぶ側が渡す）。
     - 取り込まなかった行は理由（report.skipped の reason）ごとにまとめる。「設備マスタに無い」理由の行にだけ「マスタ管理で設備を足して
       取り込み直す」を添える（前はどの行も「設備マスタに無い」と書き、設備名が空の行も「№11 」と出した）
     - 札の題は report.source（どの道で読んだか。前は API で読んでも「LotDsp 進度情報」と書いた） */
  function report(rep, via, hm, esc) {
    const e = esc || ((s) => String(s));
    const list = (xs, f) => xs.map(f).join("、");
    const name = (x) => (x.equipment ? `№${x.no} ${e(x.equipment)}` : `№${x.no}`);
    const skipped = rep.skipped || [], planned = rep.planned || [], warnings = rep.warnings || [], renamed = rep.renamed || [];
    const details = [];
    const reasons = [];
    skipped.forEach((x) => { const r = x.reason || "理由なし"; if (!reasons.includes(r)) reasons.push(r); });
    reasons.forEach((r) => {
      const xs = skipped.filter((x) => (x.reason || "理由なし") === r);
      const fix = /設備マスタに無い/.test(r) ? "。要るならマスタ管理で設備を足して取り込み直す" : "";
      details.push({ tone: "warn", html: `⚠ 取り込まなかった行（${e(r)}）: ${list(xs, name)}${fix}` });
    });
    warnings.forEach((w) => details.push({ tone: "warn", html: `⚠ ${e(w)}` }));
    if (planned.length) details.push({ tone: "plan", html: `◌ 未実績（設計の設備名だけ）: ${list(planned, name)}` });
    if (renamed.length) details.push({ tone: "alias", html: `⇄ 読み替え: ${list(renamed, (x) => `№${x.no} ${e(x.from)}→<b>${e(x.to)}</b>`)}` });
    // 題は字のまま（note が逃がして title に入れる）
    const title = `${rep.source || "LotDsp 進度情報"}（${via}・${hm}）・実績 ${rep.actual_rows} 行・巻出し方向は初期値「${rep.default_unwind}」（違う工程は表で直す）`;
    return { details, title, warn: skipped.length + warnings.length, planned: planned.length, renamed: renamed.length };
  }
  root.LotDspReport = { report };
})(typeof window !== "undefined" ? window : globalThis);
