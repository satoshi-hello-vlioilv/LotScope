// 2026-10 色付け（条件付き書式）: 絞り込みの派生。作った条件に当たった所だけ、行を消さずに色を付ける（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-marks.mjs --states list
// 見本の色付けは 2 組: ①「不良名 ＝ 汚れ」→ 赤（条件の列のセル）②「重量 ≧ 3000 かつ 板厚 ＜ 1」→ 黄（行全体）。
// 当たった件数（全件で何行か）は凡例に出す（サーバーが markCounts で返す）。色は意味で固定: 赤＝悪い・黄＝注意・緑＝良い・青＝確かめる・紫・灰＝目立たせない。
//
// 方向（何で解くか）: A 置き場＝「条件」の面に「色付け」の区画を足し、条件を作る所に「色を付ける」／B 置き場＝道具の行に専用の「色付け」
// ／C 流れ＝条件の札ごとに「絞る｜色」を切り替える（1 つの並び）／D 入口＝列の見出しのメニューから「この列で色付け」／
// E 置き場＝スライサーのような横の面で一覧
// 5 案は「作る・並べる所をどこに置くか」に偏る → 2 案を足す: F 見せ方＝件数の行の下に凡例の帯を常に出し、帯の中で切り替え・作る
// （結果と操作を同じ所に）／G 流れ＝「列で絞り込む」の行に「絞る｜色付け」の切り替え（打った値に当たる所が光る＝探して目立たせる）

export const TONES = `
  .mk-red{--mk-bg:#fde4e1;--mk-ink:#a52a1f;--mk-bar:#d9473a}.mk-amber{--mk-bg:#fff1cf;--mk-ink:#7f5600;--mk-bar:#e3a21a}
  .mk-green{--mk-bg:#ddf3e4;--mk-ink:#1d6b3a;--mk-bar:#36a061}.mk-blue{--mk-bg:#e1ecfb;--mk-ink:#1f4f8a;--mk-bar:#3f7fd0}
  .ll-grid tbody td.mk-cell{background:var(--mk-bg)!important;color:var(--mk-ink)!important;font-weight:700}
  .ll-grid tbody tr.mk-row td{background:var(--mk-bg)!important}
  .ll-grid tbody tr.mk-row td:first-child{box-shadow:inset 4px 0 0 var(--mk-bar)}
  .mk-dot{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--mk-bar);flex:0 0 auto}
  .mk-legend{display:inline-flex;gap:6px;align-items:center}
  .mk-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:999px;background:var(--mk-bg);color:var(--mk-ink);font-size:12px;font-weight:700}
  .mk-chip i{font-style:normal;font-weight:600;opacity:.85}
  .mk-pop{position:fixed;z-index:80;background:#fff;border:1px solid #cfd9e3;border-radius:10px;box-shadow:0 18px 44px rgba(20,40,60,.22);padding:10px;font-size:13px;width:430px}
  .mk-pop h5{margin:2px 4px 6px;font-size:12px;color:#5d6b78;font-weight:800}
  .mk-rule{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px}
  .mk-rule:hover{background:#f2f5f8}.mk-rule span{flex:1}.mk-rule b{color:#16505a}
  .mk-rule small{color:#6b7680;font-size:11.5px;white-space:nowrap}
  .mk-sw{width:30px;height:17px;border-radius:9px;background:#3f6591;position:relative;flex:0 0 auto}.mk-sw::after{content:"";position:absolute;right:2px;top:2px;width:13px;height:13px;border-radius:50%;background:#fff}
  .mk-add{display:block;width:100%;margin-top:6px;padding:7px 10px;border:1px dashed #b9c7d4;border-radius:7px;background:#fafcfd;color:#3f6591;font-weight:700;text-align:left}
  .mk-tones{display:inline-flex;gap:4px}.mk-tones i{width:18px;height:18px;border-radius:5px;background:var(--mk-bar);display:inline-block}
  .mk-tones i.on{box-shadow:0 0 0 2px #fff,0 0 0 4px #3f6591}`;

/** 見本の色付けを表に当てる（描き直されるたびに）。①不良名＝汚れ → 赤のセル ②重量≧3000 かつ 板厚＜1 → 黄の行 */
export const PAINT = ["script", `
const paint = () => {
  const heads = [...document.querySelectorAll("#llHead th")].map((th) => th.dataset.col);
  const at = (c) => heads.indexOf(c);
  document.querySelectorAll("#llBody tr[data-i]").forEach((tr) => {
    const td = tr.children, txt = (c) => (td[at(c)] ? td[at(c)].textContent.trim() : "");
    if (txt("不良名") === "汚れ") td[at("不良名")].classList.add("mk-cell", "mk-red");
    const w = parseFloat(txt("重量")), t = parseFloat(txt("板厚"));
    if (w >= 3000 && t < 1) tr.classList.add("mk-row", "mk-amber");
  });
};
new MutationObserver(paint).observe(document.querySelector("#llBody"), { childList: true }); paint();`];
export const LEGEND = (where = "afterend", anchor = ".ll-lothint") => ["insert",
  `<span class="mk-legend" title="色付け（行は絞りません）"><span class="mk-chip mk-red"><span class="mk-dot"></span>不良名＝汚れ<i>361</i></span>`
  + `<span class="mk-chip mk-amber"><span class="mk-dot"></span>重量≧3000・板厚＜1<i>863</i></span></span>`, where, anchor];
/** 道具の近くに面（ポップオーバー）を開いた形で置く */
export const POP = (html, anchor, dx = 0) => ["script", `
const a = document.querySelector(${JSON.stringify(anchor)}).getBoundingClientRect();
document.body.insertAdjacentHTML("beforeend", '<div class="mk-pop" style="left:' + (a.left + ${dx}) + 'px;top:' + (a.bottom + 6) + 'px">' + ${JSON.stringify(html)} + '</div>');`];
export const RULES = `<div class="mk-rule"><span class="mk-dot mk-red"></span><span><b>不良名</b> ＝ 汚れ</span><small>セル・361 件</small><i class="mk-sw"></i></div>`
  + `<div class="mk-rule"><span class="mk-dot mk-amber"></span><span><b>重量</b> ≧ 3000 かつ <b>板厚</b> ＜ 1</span><small>行・863 件</small><i class="mk-sw"></i></div>`;

export const PROPOSALS = [
  { key: "now", name: "今の作り（条件は絞り込むだけ。色は付けられない）", css: "", ops: [] },
  {
    key: "A", name: "「条件」の面に「色付け」の区画（作る所に「色を付ける」）",
    css: TONES, ops: [PAINT, LEGEND(),
      POP(`<h5>絞り込み（0）</h5><p style="margin:2px 8px 8px;color:#6b7680">いまは絞り込んでいません</p><h5>色付け（2）<small style="font-weight:400"> 行は絞らず、当たった所に色</small></h5>${RULES}`
        + `<button class="mk-add">＋ 条件を作る（適用・登録・色を付ける）</button>`, "#llCondBtn")],
  },
  {
    key: "B", name: "道具の行に専用の「色付け」",
    css: TONES + `.mk-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid #cfd9e3;border-radius:8px;background:#fff;font-weight:700;color:#2c4660;margin-left:6px}
      .mk-btn b{background:#3f6591;color:#fff;border-radius:9px;padding:0 6px;font-size:11px}`,
    ops: [PAINT, LEGEND(), ["insert", '<button class="mk-btn" id="mkBtn"><span class="mk-tones"><i class="mk-red" style="width:9px;height:9px"></i><i class="mk-amber" style="width:9px;height:9px"></i></span>色付け<b>2</b> ▾</button>', "afterend", "#llSlicerBtn"],
      POP(`<h5>色付け（行は絞らず、当たった所に色）</h5>${RULES}<button class="mk-add">＋ 色付けを作る（列・比べ方・値・色）</button>`, "#mkBtn")],
  },
  {
    key: "C", name: "条件の札ごとに「絞る｜色」を切り替える",
    css: TONES + `.mk-seg{display:inline-flex;border:1px solid #cfd9e3;border-radius:6px;overflow:hidden;font-size:11.5px}.mk-seg i{font-style:normal;padding:2px 7px;color:#5d6b78}.mk-seg i.on{background:#3f6591;color:#fff;font-weight:700}`,
    ops: [PAINT, LEGEND(),
      POP(`<h5>条件（2）</h5><div class="mk-rule"><span class="mk-dot mk-red"></span><span><b>不良名</b> ＝ 汚れ</span><span class="mk-seg"><i>絞る</i><i class="on">色</i></span></div>`
        + `<div class="mk-rule"><span class="mk-dot mk-amber"></span><span><b>重量</b> ≧ 3000 かつ <b>板厚</b> ＜ 1</span><span class="mk-seg"><i>絞る</i><i class="on">色</i></span></div>`
        + `<button class="mk-add">条件を検索して足す</button>`, "#llCondBtn")],
  },
  {
    key: "D", name: "列の見出しのメニューから「この列で色付け」",
    css: TONES + `.mk-ctx{width:250px}.mk-ctx div{padding:7px 10px;border-radius:6px}.mk-ctx div.on{background:#eaf1f8;font-weight:700;color:#1f4f8a}`,
    ops: [PAINT, LEGEND(), ["script", `const th = document.querySelector('#llHead th[data-col="不良名"]').getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", '<div class="mk-pop mk-ctx" style="left:' + th.left + 'px;top:' + (th.bottom + 4) + 'px"><div>小さい順に並べる</div><div>大きい順に並べる</div><div>この列でまとめる</div><div class="on">この列で色付け…</div><div>この列を隠す</div></div>');`]],
  },
  {
    key: "E", name: "スライサーのような横の面で色付けを並べる",
    css: TONES + `.mk-side{position:fixed;right:22px;top:250px;width:300px;background:#fff;border:1px solid #cfd9e3;border-radius:10px;padding:10px;box-shadow:0 8px 24px rgba(20,40,60,.12);font-size:13px;z-index:70}`,
    ops: [PAINT, LEGEND(), ["insert", `<aside class="mk-side"><h5 style="margin:2px 4px 6px;font-size:12px;color:#5d6b78">色付け</h5>${RULES}<button class="mk-add">＋ 色付けを作る</button></aside>`, "beforeend", "body"]],
  },
  {
    key: "F", name: "件数の行の下に凡例の帯（帯の中で切り替え・作る）",
    css: TONES + `.mk-band{display:flex;align-items:center;gap:8px;margin:4px 0 6px;padding:5px 10px;border-radius:8px;background:#f6f8fa;border:1px solid #e3e9ef;font-size:12.5px}
      .mk-band>b{color:#5d6b78;font-weight:800;margin-right:4px}.mk-band .mk-chip{cursor:pointer}.mk-band .mk-chip.off{opacity:.45;text-decoration:line-through}
      .mk-band .mk-plus{border:1px dashed #b9c7d4;border-radius:999px;padding:2px 10px;color:#3f6591;font-weight:700;background:#fff}`,
    ops: [PAINT, ["insert", `<div class="mk-band"><b>色付け</b><span class="mk-chip mk-red"><span class="mk-dot"></span>不良名＝汚れ<i>361</i></span>`
      + `<span class="mk-chip mk-amber"><span class="mk-dot"></span>重量≧3000・板厚＜1<i>863</i></span><span class="mk-plus">＋ 色付けを作る</span>`
      + `<small style="color:#6b7680;margin-left:auto">札を押すと消す／付ける・行は絞りません</small></div>`, "afterend", ".ll-status"]],
  },
  {
    key: "G", name: "「列で絞り込む」の行に「絞る｜色付け」の切り替え",
    css: TONES + `.mk-seg{display:inline-flex;border:1px solid #cfd9e3;border-radius:7px;overflow:hidden;font-size:12.5px;height:30px}.mk-seg i{font-style:normal;padding:0 10px;display:grid;place-items:center;color:#5d6b78}.mk-seg i.on{background:#3f6591;color:#fff;font-weight:700}`,
    ops: [PAINT, LEGEND(), ["script", `document.querySelector("#llAdhocRow").hidden = false; const c = document.querySelector("#llAdhocColumn");
      c.innerHTML = "<option>不良名</option>"; document.querySelector("#llAdhocValue").value = "汚れ";`],
      ["insert", '<span class="mk-seg"><i>絞る</i><i class="on">色付け</i></span><span class="mk-tones"><i class="mk-red on"></i><i class="mk-amber"></i><i class="mk-green"></i><i class="mk-blue"></i></span>', "afterbegin", "#llAdhocRow"]],
  },
];
