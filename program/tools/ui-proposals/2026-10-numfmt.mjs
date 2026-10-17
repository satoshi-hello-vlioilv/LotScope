// 2026-10 値の表示形式（版 3.43.0。利用者の要望 3: ダッシュボードの値に単位を付ける・書式を Excel の書式設定と同じくらい多彩に・
// パネルの中の右寄せ・中央寄せ）。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-numfmt.mjs --states dash-kpi-fmt
//   （1280x720 でも: --view 1280x720）
// 今の物を撮って見えたこと（作る前・版 3.42.0。dash-panel-fmt）:
//   ・書式の「数の形」は 小数の桁（自動・整数・0.1…）と 単位（自動〈万・億〉・そのまま・千・万）の 2 つの選びだけ。数の後ろに「本」「kg」を付ける・
//     負の数を ▲ や赤で出す・% で出す・桁区切りを外す、はどこにも無い。数字（KPI）と表は「数の形」しか出ず、置き場（左・中央・右）・字の大きさ・色は無い
//   ・合わせた表・集計表の形（表）には書式の欄そのものが無い
// 案の方向（何で解くか）:
//   A 置き場・流れ（Excel の書式設定の順）: 分類の選び → その分類の細かい所（小数・桁区切り・負の数・前後の字・単位で割る）→ 見本 → 配置 → 字（作った物）
//   B 見せ方（結果を先に）: 見本を書式の頭に大きく出し、選びはその下（何がどう変わるかを先に見る）
//   C 減らし方（よく使う形を札で）: 「1,234」「1,234.5」「1,234本」「12.3%」「▲1,234」「¥1,234」の札を分類の下に並べ、押すだけで決まる。細かい所は札の下
//   D 流れの変え方（札で分ける）: 「表示形式」「配置と字」の 2 枚の札。開いている札の中身だけを出す（縦に短く）
//   E 置き場（Excel と同じ形）: 分類を左の縦の一覧（標準・数値・通貨・％・指数・ユーザー定義）、右にその細かい所
//   F 見せ方（分類を横の札）: 分類の選び（select）を横に並んだ札にする（どれがあるかが一目で分かる・1 回で選べる）
let seq = 0;
const watch = (sel, fn) => { const k = `nf${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

const rowOf = (label) => `[...el.querySelectorAll(".de-row")].find((r) => (r.querySelector(".de-l") || {}).textContent === ${JSON.stringify(label)})`;

export const PROPOSALS = [
  { key: "A", name: "A 分類 → 細かい所 → 見本 → 配置 → 字（作った物）", css: "", ops: [] },
  {
    key: "B", name: "B 見本を頭に大きく",
    css: `.nfB-sample{display:flex;gap:18px;align-items:baseline;padding:10px 12px;margin:4px 0 8px;border-radius:9px;background:var(--input-soft);font-variant-numeric:tabular-nums}
      .nfB-sample b{font-size:22px}.nfB-sample small{color:var(--muted)}`,
    ops: [watch("#dbEditor .de-fmt", `(el) => { const s = ${rowOf("見本")}; if (!s) return; const sp = s.querySelector(".de-nsample");
      const box = document.createElement("div"); box.className = "nfB-sample"; box.innerHTML = sp.innerHTML.replace(/<span>/, "<span><b>").replace(/<\\/span>/, "</b></span>");
      el.prepend(box); s.remove(); }`)],
  },
  {
    key: "C", name: "C よく使う形の札（押すだけ）＋細かい所",
    css: `.nfC-chips{display:flex;flex-wrap:wrap;gap:6px}.nfC-chips button{height:30px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font:inherit;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer}
      .nfC-chips button.on{border-color:var(--h-input);background:var(--input-soft);color:var(--h-input)}`,
    ops: [watch("#dbEditor .de-fmt", `(el) => { const r = el.querySelector(".de-row"); if (!r) return;
      r.insertAdjacentHTML("afterend", '<div class="de-row"><span class="de-l">よく使う形</span><span class="nfC-chips"><button>1,234</button><button class="on">1,234.5本</button><button>1,234本</button><button>12.3%</button><button>▲1,234</button><button>¥1,234</button></span></div>'); }`)],
  },
  {
    key: "D", name: "D 「表示形式」「配置と字」の 2 枚の札",
    css: `.nfD-tabs{display:flex;gap:0;margin:2px 0 8px;border-bottom:2px solid var(--line)}.nfD-tabs span{padding:6px 14px;font-weight:700;color:var(--muted);margin-bottom:-2px}
      .nfD-tabs span.on{color:var(--h-input);border-bottom:2px solid var(--h-input)}`,
    ops: [watch("#dbEditor .de-fmt", `(el) => { el.insertAdjacentHTML("afterbegin", '<div class="nfD-tabs"><span class="on">表示形式</span><span>配置と字</span></div>');
      [${rowOf("配置")}, ${rowOf("字")}].forEach((r) => r && (r.style.display = "none")); }`)],
  },
  {
    key: "E", name: "E 分類を左の縦の一覧（Excel と同じ形）",
    css: `.nfE{display:grid;grid-template-columns:140px 1fr;gap:12px;align-items:start}.nfE-list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;overflow:hidden}
      .nfE-list span{padding:5px 10px;font-size:13px}.nfE-list span.on{background:var(--h-input);color:#fff;font-weight:700}.nfE-right{display:flex;flex-direction:column;gap:6px;min-width:0}`,
    ops: [watch("#dbEditor .de-fmt", `(el) => { const first = el.querySelector(".de-row"); const cat = first && first.querySelector("[data-de-fncat]"); if (!cat) return;
      const rows = [...el.querySelectorAll(".de-row")]; const until = rows.findIndex((r) => (r.querySelector(".de-l") || {}).textContent === "配置");
      const mine = rows.slice(0, until < 0 ? rows.length : until);
      const g = document.createElement("div"); g.className = "nfE";
      g.innerHTML = '<div class="nfE-list">' + [...cat.options].map((o) => '<span class="' + (o.selected ? "on" : "") + '">' + o.textContent + "</span>").join("") + '</div><div class="nfE-right"></div>';
      first.before(g); cat.style.display = "none"; g.append(cat); const right = g.querySelector(".nfE-right"); mine.forEach((r) => right.append(r)); first.querySelector(".de-l").textContent = ""; }`)],
  },
  {
    key: "F", name: "F 分類を横の札",
    css: "",
    ops: [watch("#dbEditor .de-fmt", `(el) => { const cat = el.querySelector("[data-de-fncat]"); if (!cat) return;
      const segs = document.createElement("span"); segs.className = "de-segs";
      segs.innerHTML = [...cat.options].map((o) => '<label class="de-seg' + (o.selected ? " on" : "") + '">' + o.textContent + "</label>").join("");
      const r = cat.closest(".de-row"); cat.style.display = "none"; cat.after(segs);
      const div = [...r.children].findIndex((x) => x.textContent === "単位で割る");
      if (div >= 0) { const nr = document.createElement("div"); nr.className = "de-row"; nr.innerHTML = '<span class="de-l"></span>'; [...r.children].slice(div).forEach((x) => nr.append(x)); r.after(nr); } }`)],
  },
];
