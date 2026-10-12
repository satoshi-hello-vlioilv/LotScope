// 2026-10 表示列の「この列の作り方」に、式に慣れていない人のための組み立て式の式ビルダーを置く（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-fxbuilder.mjs --states columns-fx
// ビルダーは本物（static/js/formula-builder.js の mount）。置き場と出し方だけを案ごとに組み替える近似。
//
// 方向（何で解くか）: A 見せ方＝「式を書く｜組み立てる」のタブ／B 置き場＝式の欄の下に畳んで置く／C 流れ＝別の小窓で組み立てて戻す／
// D 優先順位＝組み立てを先に、式の欄は下に畳む／E 減らし方＝よく使う形の札で雛形を入れるだけ
// 5 案は「組み立てる欄をどこに置くか」に偏る → 2 案を足す: F 電卓のように列・記号の札を押して式の欄へ足す（文を作らない）／
// G 先に「何を作るか（数・区分・文字）」を選び、その形の組み立てだけを出す

const MOUNT = (place, extra = "") => ["script", `
setInterval(() => {
  const step = document.querySelector('.lc-step[data-step="fx"]');
  if (!step || step.querySelector(".fb-host")) return;
  const fx = step.querySelector("#lcFormula"); if (!fx) return;
  const cols = [...document.querySelectorAll("#lcList li[data-col]")].map((li) => li.dataset.col).slice(0, 30);
  const host = document.createElement("div"); host.className = "fb-host";
  ${place}
  ${extra}
}, 250);`];
const fbIn = (h, kind = "if") => `{ const b = document.createElement("div"); b.className = "fb"; ${h}.append(b);
  FormulaBuilder.mount(b, { kind: "${kind}", columns: () => cols, preview: () => ["重", "軽", "重"], apply: () => {} }); }`;

export const PROPOSALS = [
  {
    key: "A", name: "「式を書く｜組み立てる」のタブで切り替え（組み立てるを開いたところ）",
    css: `.fxa-tabs{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden;margin-bottom:6px}
      .fxa-tabs b{padding:3px 12px;font-size:12.5px;color:var(--muted);font-weight:600}.fxa-tabs b.on{background:var(--h-input);color:#fff}
      .fb-host ~ #lcFormula{display:none}`,
    ops: [MOUNT(`fx.before(host); host.insertAdjacentHTML("afterbegin", '<span class="fxa-tabs"><b>式を書く</b><b class="on">組み立てる</b></span>'); ${fbIn("host")}`)],
  },
  {
    key: "B", name: "式の欄の下に「組み立てて作る ▸」を畳んで置く（開いたところ）",
    css: `.fxb-sum{display:block;margin:6px 0 4px;font-size:12.5px;font-weight:700;color:var(--h-input)}`,
    ops: [MOUNT(`step.querySelector("#lcFxState").after(host); host.insertAdjacentHTML("afterbegin", '<span class="fxb-sum">▾ 組み立てて作る（式に慣れていないとき）</span>'); ${fbIn("host")}`)],
  },
  {
    key: "C", name: "「組み立てる…」で別の小窓を開き、「式にする」で戻す（小窓を開いたところ）",
    css: `.fxc-btn{margin:4px 0;height:28px;padding:0 12px;border:1px solid var(--h-input);border-radius:6px;background:var(--input-soft);color:var(--h-input);font-weight:700}
      .fxc-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:300;width:640px;padding:14px;border-radius:12px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.35)}
      .fxc-modal h5{margin:0 0 8px;font-size:14px}`,
    ops: [MOUNT(`fx.after(host); host.innerHTML = '<button class="fxc-btn">組み立てて作る…</button>';
      const m = document.createElement("div"); m.className = "fxc-modal fb-host"; m.innerHTML = "<h5>式を組み立てる</h5>"; document.body.append(m); ${fbIn("m")}`)],
  },
  {
    key: "D", name: "組み立てを先に出し、式の欄は「式で見る・直す ▸」として下に畳む",
    css: `#lcFormula,#lcFxState{display:none}.fxd-sum{display:block;margin-top:6px;font-size:12.5px;font-weight:700;color:var(--h-input)}`,
    ops: [MOUNT(`fx.before(host); ${fbIn("host")} host.insertAdjacentHTML("beforeend", '<span class="fxd-sum">▸ 式で見る・直す（書き慣れた人向け）</span>');`)],
  },
  {
    key: "E", name: "よく使う形の札を押すと、式の欄に雛形が入る（組み立てる欄は無し）",
    css: `.fxe{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 6px}.fxe span{font-size:11.5px;color:var(--muted);margin-right:2px}
      .fxe b{padding:2px 9px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12px;font-weight:600;color:var(--h-input)}`,
    ops: [MOUNT(`fx.before(host); host.innerHTML = '<div class="fxe"><span>よく使う形</span><b>A ÷ B</b><b>もし … なら … そうでなければ …</b><b>A-B をつなぐ</b><b>左から n 文字</b><b>空なら -</b><b>小数 1 桁に丸める</b></div>';`)],
  },
  {
    key: "F", name: "電卓のように、列と記号の札を押して式の欄へ足す",
    css: `.fxf{display:flex;flex-direction:column;gap:4px;margin:6px 0}.fxf div{display:flex;flex-wrap:wrap;gap:3px}
      .fxf b{min-width:26px;text-align:center;padding:2px 7px;border:1px solid var(--line);border-radius:5px;background:#fff;font-size:12px;font-weight:600}
      .fxf .c b{color:var(--h-input)}.fxf small{font-size:11px;color:var(--muted)}`,
    ops: [MOUNT(`fx.after(host); host.innerHTML = '<div class="fxf"><small>列（押すと [列] を足す）</small><div class="c">' + cols.slice(0, 14).map((c) => "<b>" + c + "</b>").join("") + '</div><small>記号・関数</small><div><b>＋</b><b>−</b><b>×</b><b>÷</b><b>(</b><b>)</b><b>＝</b><b>&gt;=</b><b>if</b><b>round</b><b>concat</b><b>left</b><b>coalesce</b></div></div>';`)],
  },
  {
    key: "G", name: "先に「何を作るか（数・区分・文字）」を選び、その形の組み立てだけを出す",
    css: `.fxg{display:flex;gap:6px;margin:4px 0 6px}.fxg b{flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:12.5px;text-align:center}
      .fxg b small{display:block;font-size:11px;font-weight:500;color:var(--muted)}.fxg b.on{border-color:var(--h-input);box-shadow:inset 0 0 0 1px var(--h-input);background:var(--input-soft)}
      .fb-host .fb-kinds{display:none}`,
    ops: [MOUNT(`fx.before(host); host.innerHTML = '<div class="fxg"><b>数<small>計算・丸める</small></b><b class="on">区分<small>条件で分ける</small></b><b>文字<small>つなぐ・取り出す・空なら</small></b></div>'; ${fbIn("host")}`)],
  },
];
