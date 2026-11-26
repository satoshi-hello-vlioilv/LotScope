// 改良「変換表の見切れ」（利用者の依頼 2026-11-17 の 4「画像のように入力データの当てる列が複数の場合表示しきれていません。修正をお願いします」）の案
// （回 1。決まり 2026-10-17・合格点 80・最大 3 回）。
//
// 撮る場面（ui-harness.mjs の状態 convx-ka 〜 convx-off。この比べのために master-conv-cols の後ろへ足した）:
//   convx-ka   … 同梱の「課名」（入力 1 つに当てる列 4 つ: BOX実績_設備名・BOX設計_設備名・設備名・設備）。利用者の画像にいちばん近い形
//   convx      … 撮るだけの変換表 CONV_MANY（入力 4 つ。当てる列 1・2・3・5。列・入力の名前は全角 10〜17 字。データに有る列と無い列〈!〉）
//   convx-cell … その表の 1 行目・4 つ目の入力（切断巾（コンマ5本分割））のセルを開いた所
//   convx-cols … 4 つ目の入力（当てる列 5 つ）の「当てる列を選ぶ面」
//   convx-plan … 一覧（品質）の表示列の窓の、変換表の帯を「選ぶ ▾」で開いた所（一覧に当てる計画。列が無い表の理由の字）
//
//   TPA_UI_EXE=/home/user/LotScope/desktop/target/debug/examples/ui_serve TPA_UI_PROGRAM=<作業場所>/program \
//     node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-11-convcols.mjs \
//     --from convx-ka --states convx-ka,convx,convx-cell,convx-cols,convx-plan            （--view 1536x864・--view 1280x720 でも。1 つずつ流す）
//
// 今（版 3.123.0）の見切れ（2026-11-convcols.json の findings_now）: 入力の札 .cv-colsbtn が max-width:300px・overflow:hidden・折り返さないので、
//   当てる列が 2 つ以上だと 2 つ目から先が「設..」「コ…」に潰れ、データの印（品・ス）が重なり、▾ が消える。入力の名前の欄は 88px で「作業開始の年」で切れる。
//   当てる列を選ぶ面は、選んだ列が「コンマ5本分割_…」と同じ字に切れて 4 つの見分けが付かず、選んだ列が 3 段になると下のデータ元の欄の見出しと列が重なる。
//   1280 では面が窓の下の縁を越える。表示列の窓の変換表の帯は、表の名前と「列がありません（…）」の理由が … で切れる。表の名前の欄（280px）も切れる。
//
// どの案にも入れる直し（COMMON）: 表の名前・入力の名前の欄は中身の幅（上限つき）・データの印は潰さない・選ぶ面の選んだ列は名前を全部・
//   選ぶ面のデータ元の欄は重ならない（行の高さを決めて面の中で送る）・面が窓の下に入らないときは見ている所を上へ送ってから開く・
//   表示列の窓の変換表の帯は理由を折り返して全部・式（conv(…)）も折り返して全部。
// 案ごとに違うのは、入力の欄の「当てる列」の見せ方と置き場（A 折り返す・B 縦の表・C 1 つ＋ほか n 列・D 判定表の見出しへ・E 入力ごとのカード）。

/* ------------------------------------------------------------------ どの案にも入れる直し */
const COMMON_CSS = `
.cv-name{field-sizing:content;flex:0 1 auto;min-width:280px;max-width:min(620px,100%)}
.cv-in [data-cv-iname]{field-sizing:content;width:auto;min-width:88px;max-width:260px}
.cv-src{flex:none}
.cv-colsbtn .cv-caret{flex:none}
.cv-cpchosen .cv-alias{height:auto;min-height:24px;white-space:normal}
.cv-cpchosen .cv-alias b{max-width:none;overflow:visible;white-space:normal;overflow-wrap:anywhere}
.cv-colpop > .cv-cpsrcs{flex:1 1 auto;min-height:170px;overflow:auto}
.cv-cpsrcs{grid-template-rows:none;grid-auto-rows:minmax(170px,1fr)}
.lc-cvi{grid-template-columns:18px minmax(0,1fr);align-items:start;row-gap:0}
.lc-cvi input{grid-row:span 2;margin-top:3px}
.lc-cvi b{white-space:normal}
.lc-cvi small{grid-column:2}
.cv-colsbtn .cv-alias b{text-align:left}
.lc-cvi small{white-space:normal;overflow:visible;overflow-wrap:anywhere}
.cv-expr{white-space:normal;overflow-wrap:anywhere;max-width:none}
`;
/** 選ぶ面が窓の下の縁を越えるときは、マスタの面を送って札を上へ寄せ、面を札の下に置き直す（描き直すたびに） */
function commonScript() {
  const fit = () => {
    const el = document.querySelector(".cv-colpop"); if (!el) return;
    const panel = document.querySelector("#masterOverlay .master-panel"), box = document.querySelector("#masterSettings");
    const name = (el.querySelector(".cv-cphead b")?.textContent || "").replace(/^「|」に当てる列$/g, "");
    const i = [...document.querySelectorAll("#masterSettings [data-cv-iname]")].findIndex((x) => x.value === name);
    const a = document.querySelector(`#masterSettings [data-cv-cols="${i}"]`);
    if (!panel || !box || !a) return;
    const P = panel.getBoundingClientRect(), need = Math.min(560, el.scrollHeight);
    let r = a.getBoundingClientRect();
    if (P.bottom - 12 - (r.bottom + 6) < need) {
      box.scrollTop += Math.max(0, r.top - (P.top + 70));
      r = a.getBoundingClientRect();
    }
    const top = Math.round(r.bottom + 6);
    el.style.top = `${top}px`;
    el.style.maxHeight = `${Math.max(240, P.bottom - top - 12)}px`;
  };
  let pend = false;
  new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; fit(); }); })
    .observe(document.body, { childList: true, subtree: true });
}
const S = (fn) => `(${fn})()`;

/* ------------------------------------------------------------------ A: 札を折り返す（見せ方） */
const CSS_A = `
.cv-ins{align-items:flex-start}
.cv-in{flex-wrap:nowrap;max-width:100%;box-sizing:border-box}
.cv-colsbtn{flex:0 1 auto;min-width:0;max-width:none;flex-wrap:wrap;overflow:visible;height:auto;row-gap:3px;padding:3px 6px}
.cv-colsbtn .cv-alias b{max-width:none;overflow:visible}
`;

/* ------------------------------------------------------------------ B: 入力を 1 行 1 つの縦の表に（置き場） */
const CSS_B = `
.cv-ins{flex-direction:column;align-items:stretch;gap:4px}
.cv-ins > .cv-lab{align-self:flex-start}
.cv-ins > [data-cv-iadd]{align-self:flex-start}
.cv-in{display:flex;width:100%;box-sizing:border-box;gap:6px;padding:4px 6px}
.cv-in [data-cv-iname]{field-sizing:fixed;width:15em;max-width:none}
.cv-colsbtn{flex:1;max-width:none;flex-wrap:wrap;overflow:visible;height:auto;row-gap:3px;padding:3px 6px;counter-reset:cva}
.cv-colsbtn .cv-alias b{max-width:none;overflow:visible}
.cv-colsbtn .cv-alias::before{counter-increment:cva;content:counter(cva);margin-right:4px;color:#5c6b7a;font-size:11px;font-weight:800}
.cv-colsbtn .cv-caret{margin-left:auto}
`;
function scriptB() {
  // 表の頭に見出し（入力の名前・比べ方・当てる列〈上から順〉）
  const go = () => {
    const ins = document.querySelector("#masterSettings .cv-ins"); if (!ins || ins.querySelector(".cvx-bhead")) return;
    const lab = ins.querySelector(".cv-lab");
    lab.insertAdjacentHTML("afterend", '<div class="cvx-bhead"><span style="width:15em">入力の名前</span><span style="width:48px">比べ方</span><span>当てる列（番号の順に、一覧に有る列へ当てます）</span></div>');
  };
  const st = document.createElement("style");
  st.textContent = ".cvx-bhead{display:flex;gap:6px;padding:0 7px;font-size:11.5px;font-weight:800;color:#5c6b7a}.cvx-bhead span{flex:none}";
  document.head.append(st);
  let pend = false;
  new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; go(); }); }).observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ C: 1 つ目の列＋「ほか n 列」（減らし方） */
const CSS_C = `
.cv-colsbtn{max-width:none}
.cv-colsbtn .cv-alias b{max-width:none;overflow:visible}
.cv-colsbtn .cvx-hide{display:none}
.cvx-more{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;background:#244569;color:#fff;font-size:11.5px;font-weight:800;white-space:nowrap}
`;
function scriptC() {
  const go = () => {
    for (const b of document.querySelectorAll("#masterSettings [data-cv-cols]")) {
      const as = [...b.querySelectorAll(":scope > .cv-alias")];
      if (as.length < 2 || b.querySelector(".cvx-more")) continue;
      as.slice(1).forEach((a) => a.classList.add("cvx-hide"));
      as[0].insertAdjacentHTML("afterend", `<span class="cvx-more">ほか ${as.length - 1} 列</span>`);
      b.title = "当てる列（上から順）:\n" + as.map((a, k) => `${k + 1}. ${a.querySelector("b").textContent}`).join("\n") + "\n押すと選び直します";
    }
  };
  let pend = false;
  new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; go(); }); }).observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ D: 当てる列を判定表の見出しへ（流れの変え方） */
const CSS_D = `
.cv-grid th{vertical-align:top;white-space:normal}
.cv-grid th .cvx-thn{display:block;white-space:nowrap}
.cv-grid th .cv-colsbtn{display:flex;flex-direction:column;align-items:stretch;gap:2px;max-width:none;width:auto;min-width:180px;margin-top:4px;padding:3px 4px;overflow:visible;height:auto;font-weight:400;counter-reset:cva;box-sizing:border-box}
.cv-grid th .cv-colsbtn .cv-alias{justify-content:flex-start;height:auto;min-height:20px;background:#fff}
.cv-grid th .cv-colsbtn .cv-alias b{max-width:none;overflow:visible;white-space:nowrap;flex:1}
.cv-grid th .cv-colsbtn .cv-alias::before{counter-increment:cva;content:counter(cva);margin-right:4px;color:#5c6b7a;font-size:11px;font-weight:800}
.cv-grid th .cv-colsbtn .cv-caret{align-self:flex-end}
.cv-grid th .cv-colsph{white-space:normal}
.cv-ins .cvx-dnote{font-size:12px;color:#5c6b7a}
`;
function scriptD() {
  const go = () => {
    const ths = [...document.querySelectorAll("#masterSettings .cv-grid thead th")];
    if (!ths.length) return;
    for (const b of document.querySelectorAll("#masterSettings .cv-ins [data-cv-cols]")) {
      const th = ths[+b.dataset.cvCols + 2]; if (!th) continue;
      if (!th.querySelector(".cvx-thn")) th.innerHTML = `<span class="cvx-thn">${th.innerHTML}</span>`;
      th.querySelector(".cv-colsbtn")?.remove();
      th.append(b);
    }
    const ins = document.querySelector("#masterSettings .cv-ins");
    if (ins && !ins.querySelector(".cvx-dnote")) ins.insertAdjacentHTML("beforeend", '<span class="cvx-dnote">当てる列は、判定表の見出しで選びます</span>');
  };
  let pend = false;
  new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; go(); }); }).observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ E: 入力ごとのカード（置き場＋見せ方） */
const CSS_E = `
.cv-ins{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;align-items:start}
.cv-ins > .cv-lab{grid-column:1/-1}
.cv-ins > [data-cv-iadd]{justify-self:start;align-self:start}
.cv-in{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:4px 4px;padding:6px 8px;border-radius:9px;background:#f7fafc}
.cv-in [data-cv-iname]{field-sizing:fixed;width:100%;min-width:0;max-width:none}
.cv-in .cv-colsbtn{grid-column:1/-1;grid-row:2;display:flex;flex-direction:column;align-items:stretch;gap:2px;max-width:none;overflow:visible;height:auto;padding:4px;counter-reset:cva}
.cv-in .cv-colsbtn::before{content:"当てる列（番号の順に当てます）";text-align:left;font-size:11px;font-weight:800;color:#5c6b7a;padding:0 2px 2px}
.cv-in .cv-colsbtn .cv-alias{height:auto;min-height:21px;justify-content:flex-start}
.cv-in .cv-colsbtn .cv-alias b{max-width:none;overflow:visible;white-space:normal;overflow-wrap:anywhere;flex:1}
.cv-in .cv-colsbtn .cv-alias::before{counter-increment:cva;content:counter(cva);margin-right:4px;color:#5c6b7a;font-size:11px;font-weight:800}
.cv-in .cv-colsbtn .cv-caret{position:absolute;right:8px;top:5px}
.cv-in .cv-colsbtn{position:relative}
`;

export const PROPOSALS = [
  { key: "now", name: "今（版 3.123.0）", css: "", ops: [] },
  { key: "A", name: "札を折り返す（入力の札の中で当てる列を全部の名前で並べ、入らなければ次の段へ）", css: COMMON_CSS + CSS_A, ops: [["script", S(commonScript)]] },
  { key: "B", name: "入力を 1 行 1 つの縦の表に（名前・比べ方・当てる列〈番号つき〉を列にそろえる）", css: COMMON_CSS + CSS_B, ops: [["script", S(commonScript)], ["script", S(scriptB)]] },
  { key: "C", name: "1 つ目の列＋「ほか n 列」（札は短く、全部は選ぶ面と札の説明で）", css: COMMON_CSS + CSS_C, ops: [["script", S(commonScript)], ["script", S(scriptC)]] },
  { key: "D", name: "当てる列を判定表の見出しへ（列ごとに、何がその列に当たるかを縦に並べる）", css: COMMON_CSS + CSS_D, ops: [["script", S(commonScript)], ["script", S(scriptD)]] },
  { key: "E", name: "入力ごとのカード（カードの中に当てる列を縦に番号つきで）", css: COMMON_CSS + CSS_E, ops: [["script", S(commonScript)]] },
];
