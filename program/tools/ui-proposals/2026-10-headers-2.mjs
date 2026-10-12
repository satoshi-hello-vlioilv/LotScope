// 2026-10 列の見出しの札（2 回目）。1 回目の上位 3 案（D・G・A）と、エッセンスを組んだ複合案 4 つ。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-headers-2.mjs --states headers
// H1: D（ふだんは細い印・乗せたら札）＋B の「▲ だけ」をいつも（並べ替えの向きは見える。番号・段・式は乗せたとき）
// H2: H1 ＋乗せたときの札を見出しの下に浮かせる（列名を覆わない）
// H3: G（見出しは色の下線だけ）＋下線の右端に段の番号を小さく
// H4: E＋D（幅が足りる列は今のまま札を出し、足りない列だけ印にして乗せたら札）
import { PROPOSALS as FIRST } from "./2026-10-headers.mjs";

const pick = (k) => FIRST.find((p) => p.key === k);
const WRAP = pick("D").ops[0];
const QUIET = `.ll-grid thead th.is-level{box-shadow:inset 0 -3px 0 #8fe0d6}
  .ll-grid thead th.is-calc > .th-in > span:first-child{font-style:italic}`;

export const PROPOSALS = [
  pick("D"), pick("G"), pick("A"),
  {
    key: "H1", name: "ふだんは細い印＋並べ替えの ▲▼ だけ、乗せたら札（D＋B）",
    css: QUIET + `.th-marks > i:not(.ll-sort){display:none}
      .th-marks .ll-sort{font-size:0!important;margin-left:3px}.th-marks .ll-sort::first-letter{font-size:10px}
      .ll-grid thead th:hover .th-marks{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:inline-flex;padding:1px 4px;border-radius:5px;background:#21384a;box-shadow:0 1px 4px rgba(0,0,0,.3)}
      .ll-grid thead th:hover .th-marks > i{display:inline-block!important}.ll-grid thead th:hover .th-marks .ll-sort{font-size:11px!important}`,
    ops: [WRAP],
  },
  {
    key: "H2", name: "H1＋乗せたときの札を見出しの下に浮かせる（列名を覆わない）",
    css: QUIET + `.th-marks > i:not(.ll-sort){display:none}
      .th-marks .ll-sort{font-size:0!important;margin-left:3px}.th-marks .ll-sort::first-letter{font-size:10px}
      .ll-grid thead th:is(:hover,.wk-hover) .th-marks{position:absolute;left:50%;top:100%;transform:translate(-50%,4px);z-index:5;display:inline-flex;gap:3px;padding:3px 6px;border-radius:6px;background:#21384a;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap}
      .ll-grid thead th:is(:hover,.wk-hover) .th-marks > i{display:inline-block!important}.ll-grid thead th:is(:hover,.wk-hover) .th-marks .ll-sort{font-size:11px!important}`,
    ops: [WRAP, ["script", `setTimeout(() => { const th = [...document.querySelectorAll("#llHead th")].find((x) => x.querySelector(".ll-lvmark") && x.offsetWidth < 90); if (th) th.classList.add("wk-hover"); }, 1500)`]],
  },
  {
    key: "H3", name: "見出しは色の下線だけ＋下線の右端に段の番号（G＋）",
    css: pick("G").css + `.ll-grid thead th.is-level::after{content:attr(data-lv);position:absolute;right:3px;bottom:3px;font-size:9px;font-weight:800;color:#8fe0d6;line-height:1}`,
    ops: [WRAP, ["script", `const lv = () => document.querySelectorAll("#llHead th.is-level").forEach((th) => { const m = th.querySelector(".ll-lvmark"); if (m) th.dataset.lv = m.textContent.replace("段", ""); });
      new MutationObserver(lv).observe(document.querySelector("#llHead"), { childList: true, subtree: true }); lv();`]],
  },
  {
    key: "H4", name: "幅の足りる列は今のまま札、足りない列だけ印にして乗せたら札（E＋D）",
    css: `.ll-grid thead th{container-type:inline-size}
      @container (max-width: 130px){ .th-marks{display:none} }
      .ll-grid thead th:hover .th-marks{display:inline-flex!important;position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:1px 4px;border-radius:5px;background:#21384a}
      ` + QUIET,
    ops: [WRAP],
  },
];
