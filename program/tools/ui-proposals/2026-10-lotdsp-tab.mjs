// 2026-10 虫眼鏡で開く LotDsp のタブ（0 ICAS情報〜7 引当情報。既定は 1 進度情報。WaveLog の WL.lotDspTab と同じ）を選ぶ所（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-lotdsp-tab.mjs --states list,viewmenu
// 虫眼鏡はロット番号の字のすぐ横（利用者の指示）。WaveLog では「使用設備の設定」の窓の中で選ぶ。
//
// 方向（何で解くか）: A 置き場＝表の見せ方→機能の虫眼鏡のスイッチの下に選択欄／B 見せ方＝同じ所に 8 つの札を並べる（選択欄を開かずに見える）
// ／C 置き場＝件数の行の案内の札の中で選ぶ（「進度情報 ▾」）／D 流れ＝虫眼鏡に乗せると小さな吹き出しで 8 タブ、押したタブで開く
// ／E 置き場＝表示の設定 ▾ のメニューに置く
// 5 案は「どこに選ぶ所を置くか」に偏る → 2 案を足す: F 流れ＝左クリックは決めたタブ、右クリックでその場でタブを選んで開く
// ／G 減らし方＝選ばせない（進度情報に固定。WaveLog の既定と同じ）

const TABS = ["ICAS情報", "進度情報", "製造情報", "試験情報", "品質情報", "クラッド情報", "焼鈍情報", "引当情報"];
const SELECT = `<select style="height:28px">${TABS.map((t, i) => `<option${i === 1 ? " selected" : ""}>Tab ${i}：${t}</option>`).join("")}</select>`;
const AFTER_LENS = (html) => ["script", `
const put = () => { const l = document.querySelector("#llFeatLens"); if (!l || document.querySelector(".tab-pick")) return;
  l.closest("label").insertAdjacentHTML("afterend", ${JSON.stringify(html)}); document.querySelector("#llViewMenu").scrollTop = 99999; };
new MutationObserver(put).observe(document.querySelector("#llViewMenu"), { childList: true, subtree: true }); put();`];
const CHIPS = `<span class="tab-chips">${TABS.map((t, i) => `<i class="${i === 1 ? "on" : ""}">${t}</i>`).join("")}</span>`;
const POP = (html, at) => ["script", `
const go = () => { const a = document.querySelector(${JSON.stringify(at)}); if (!a) return setTimeout(go, 200); const r = a.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="tab-pop" style="left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px">' + ${JSON.stringify(html)} + '</div>'); };
go();`];
const LIST = `<b>LotDsp で開くタブ</b>${TABS.map((t, i) => `<div class="${i === 1 ? "on" : ""}">Tab ${i}：${t}</div>`).join("")}`;
const BASE = `.tab-pick{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center;margin:4px 0 6px 28px;font-size:12.5px;color:var(--muted)}
  .tab-chips{display:flex;flex-wrap:wrap;gap:4px}.tab-chips i{font-style:normal;padding:2px 8px;border:1px solid #cfd9e3;border-radius:999px;font-size:12px;color:#3f5870}
  .tab-chips i.on{background:var(--h-input);border-color:var(--h-input);color:#fff;font-weight:700}
  .tab-pop{position:fixed;z-index:90;background:#fff;border:1px solid #cfd9e3;border-radius:9px;box-shadow:0 12px 30px rgba(20,40,60,.2);padding:6px;font-size:12.5px;min-width:170px}
  .tab-pop b{display:block;padding:3px 8px;color:#5d6b78;font-size:11.5px}.tab-pop div{padding:4px 8px;border-radius:6px}.tab-pop div.on{background:#eaf1f8;color:#1f4f8a;font-weight:700}`;

export const PROPOSALS = [
  { key: "now", name: "今の作り（タブは選べない。進度情報で開く）", css: "", ops: [] },
  { key: "A", name: "表の見せ方→機能の虫眼鏡のスイッチの下に選択欄", css: BASE, ops: [AFTER_LENS(`<div class="tab-pick"><span>開くタブ</span>${SELECT}</div>`)] },
  { key: "B", name: "同じ所に 8 つの札を並べる", css: BASE, ops: [AFTER_LENS(`<div class="tab-pick"><span>開くタブ</span>${CHIPS}</div>`)] },
  {
    key: "C", name: "件数の行の案内の札の中で選ぶ",
    css: BASE + `.ll-lothint select{height:22px;font-size:12px;border-radius:999px;border:1px solid #b9c9da;background:#fff;color:#2c4660;margin:0 2px}`,
    ops: [["script", `const h = document.querySelector(".ll-lothint"); if (h) h.innerHTML = h.innerHTML.replace("LotDsp を開くだけ", "LotDsp の ${SELECT.replace(/"/g, '\\"').replace(/Tab \d：/g, "")} を開くだけ");`]],
  },
  { key: "D", name: "虫眼鏡に乗せると吹き出しで 8 タブ（押したタブで開く）", css: BASE, ops: [POP(LIST, "#llBody tr[data-i]:nth-child(3) .ll-lens")] },
  { key: "E", name: "表示の設定 ▾ のメニューに置く", css: BASE, ops: [POP(`<b>表示の設定</b><div>書き出す…</div><div>読み込む…</div><div>初期設定に戻す</div><div style="border-top:1px solid #e3e9ef;margin-top:4px;padding-top:8px">LotDsp で開くタブ ${SELECT}</div>`, "#llProfileBtn")] },
  { key: "F", name: "右クリックでその場でタブを選んで開く（左クリックは決めたタブ）", css: BASE, ops: [POP(LIST.replace("LotDsp で開くタブ", "このロットを開くタブ（右クリック）"), "#llBody tr[data-i]:nth-child(3) .ll-lens")] },
  { key: "G", name: "選ばせない（進度情報に固定）", css: "", ops: [] },
];
