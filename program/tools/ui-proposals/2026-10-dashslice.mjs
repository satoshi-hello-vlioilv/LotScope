// 2026-10 ダッシュボードの改良（版 3.41.0）: スライサー・系列ごとの書式・行を引いて並べる（ゴースト・設備グループの見出し）・四隅の取っ手。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashslice.mjs --states dash-slicer,dash-slicer-pick,dash-series,dash-tree,dash-corners
//   （1280x720 でも: --view 1280x720）
// 今の物を撮って見えたこと（作る前・版 3.40.0。scratchpad の before-labels.png・利用者の画像）:
//   ・設備 3 つの折れ線で、数値ラベルが 1 つ目の系列（CR1）にしか付かない。「両方」「棒の中」は線では効かない
//   ・書式の「系列の色」の見本の色が線の色と違う（見本 CR1＝青緑・線 CR1＝琥珀）
//   ・組む所の外枠が 20px はみ出していて（札の中の隠したラジオ）、押した所によって外枠ごと送られ、見出し（やめる・当てる）が隠れ下が空く
//   ・行の札の引いて落とすで、下へ引くと落とした札の後ろ、上へ引くと前に入る（向きで食い違う）。入る所の印は札の上の線だけで、引いている物が見えない
//   ・大きさは右下の角だけ。保存は押してから 2 回の往復（書く・全部を読み直す）と 6 枚の描き直しが済むまで、画面が変わらない
// 案の方向（何で解くか）:
//   A0 置き場＝道具の行の中（入らなければ詰めた形）・印＝見出しの札・系列＝1 行に札・並べ＝ゴーストと線（土台）
//   A1 置き場: スライサーを道具の行の下の 1 段（全幅の帯）に。どの大きさでも全部の札が出る
//   A2 見せ方: 効いているパネルの印を、見出しの札でなく枠の上の藍の線に（字を減らす）・系列の書式は選ぶ欄の表
//   A3 流れ: 期間を月の札の並び（今日・前日・直近 7 日｜5 月〜10 月）にし、◀ ▶ を無くす（月を 1 回で選ぶ）
//   A4 置き場: 左に縦のスライサーの面（一覧の画面のスライサーと同じ置き場・形）
//   A5 減らし方: 道具の行は「スライサー ▾」1 つと効いている札だけ。札を押すと面が開く・並べるときの線に「ここへ（n 番目）」
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// A1: 道具の行の下の帯
const strip = ["script", `{ const put = () => { const bar = document.querySelector("#dashBar"), w = bar && bar.querySelector("#dashSlicer"); if (!w) return;
  let st = document.querySelector("#pvStrip"); if (!st) { st = document.createElement("div"); st.id = "pvStrip"; st.className = "pv-strip"; bar.after(st); }
  w.remove(); st.innerHTML = Dashboard._slicerHtml(false); };
  new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); put(); }`];
const stripCss = `.pv-strip{flex:0 0 auto;min-width:0}.pv-strip .ds-bar{width:100%;box-sizing:border-box}`;

// A2: 枠の上の線（見出しの札は隠す）・系列の書式は選ぶ欄
const lineCss = `.db-sbadge{display:none!important}.db-p.is-sliced{box-shadow:inset 0 3px 0 var(--h-input),var(--shadow-sm)}
.db-p.is-sliced .db-ph h3::after{content:" ⧩";color:var(--h-input);font-size:12px}`;
const serSel = watch("#dbEditor .de-ser", `(row) => { row.querySelectorAll(".de-segs").forEach((sg) => { const on = sg.querySelector("label.on") || sg.querySelector("label");
  const sel = document.createElement("select"); sel.className = "pv-sersel"; [...sg.querySelectorAll("label")].forEach((l) => { const o = document.createElement("option"); o.textContent = l.textContent; o.selected = l === on; sel.append(o); }); sg.replaceWith(sel); }); }`);
const serCss = `.pv-sersel{height:26px;border:1px solid var(--edit-line);border-radius:7px;background:var(--edit-field);font:inherit;font-size:12.5px;padding:0 6px}`;

// A3: 月の札の並び
const months = watch("#dashSlicer .ds-bar:not(.is-compact)", `(bar) => { const chips = bar.querySelector(".ds-chips"); bar.querySelector(".ds-month")?.remove();
  chips.querySelectorAll('[data-ds-period="this_month"],[data-ds-period="last_month"]').forEach((b) => b.remove());
  const sep = document.createElement("span"); sep.className = "ds-sep"; chips.append(sep);
  ["5月", "6月", "7月", "8月", "9月", "10月"].forEach((m) => { const b = document.createElement("button"); b.type = "button"; b.className = "ds-chip" + (m === "9月" ? " on" : ""); b.textContent = m; chips.append(b); }); }`);

// A4: 左に縦の面
const side = ["script", `{ const put = () => { const bar = document.querySelector("#dashBar"), w = bar && bar.querySelector("#dashSlicer"); const stage = document.querySelector(".db-stage"); if (!w || !stage) return;
  let st = document.querySelector("#pvSide"); if (!st) { st = document.createElement("aside"); st.id = "pvSide"; st.className = "pv-side"; stage.prepend(st); }
  w.remove(); st.innerHTML = '<b class="pv-sh">スライサー</b>' + Dashboard._slicerHtml(false); };
  new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true }); put(); }`];
const sideCss = `.pv-side{flex:0 0 190px;display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);padding:10px;overflow:auto;min-height:0}
.pv-sh{font-size:13px}.pv-side .ds-bar{flex-direction:column;align-items:stretch;height:auto;border:0;padding:0;background:transparent;gap:6px}
.pv-side .ds-chips{flex-wrap:wrap;display:flex}.pv-side .ds-sep{width:auto;height:1px;margin:4px 0}.pv-side .ds-month{align-self:flex-start}.pv-side .ds-hits{white-space:normal}`;

// A5: 1 つのボタンと効いている札
const one = watch("#dashSlicer", `(w) => { const put = () => { if (w.querySelector(".pv-one")) return; const on = w.querySelector(".ds-chip.on[data-ds-period]:not([data-ds-period=''])"), g = w.querySelector(".ds-chip.on[data-ds-group]");
  const words = [on && on.textContent, g && g.textContent].filter(Boolean);
  w.innerHTML = '<span class="pv-one"><button type="button" class="ds-chip' + (words.length ? " on" : "") + '">⧩ スライサー ▾</button>' + words.map((x) => '<span class="db-qchip">' + x + '<button type="button">×</button></span>').join("") + '</span>'; };
  put(); new MutationObserver(put).observe(w, { childList: true }); }`);
const oneCss = `.pv-one{display:inline-flex;align-items:center;gap:6px}`;
const lineLabel = watch(".de-dropline", `(l) => { l.insertAdjacentHTML("beforeend", '<span class="pv-dl">ここへ（' + (Number(document.querySelectorAll("#deBoard .de-rowi").length) ? 3 : 1) + ' 番目）</span>'); }`);
const lineLabelCss = `.pv-dl{position:absolute;right:8px;top:-10px;background:var(--h-input);color:#fff;font-size:11.5px;font-weight:800;padding:1px 7px;border-radius:999px}`;

export const PROPOSALS = [
  { key: "A0", name: "土台（道具の行の中・見出しの札・系列は札・ゴーストと線）", css: "", ops: [] },
  { key: "A1", name: "スライサーを道具の行の下の帯（全幅）に", css: stripCss, ops: [strip] },
  { key: "A2", name: "印は枠の上の線・系列の書式は選ぶ欄", css: lineCss + serCss, ops: [serSel] },
  { key: "A3", name: "期間は月の札の並び（◀ ▶ なし）", css: "", ops: [months] },
  { key: "A4", name: "左に縦のスライサーの面", css: sideCss, ops: [side] },
  { key: "A5", name: "「スライサー ▾」1 つと効いている札・線に「ここへ」", css: oneCss + lineLabelCss, ops: [one, lineLabel] },
];
