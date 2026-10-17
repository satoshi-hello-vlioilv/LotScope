// 2026-10 ダッシュボードの改良（版 3.40.0）の置き方・見せ方。3 回目（合格点 80 点。最後の回）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashlink-3.mjs --states dash-split,dash-facet,dash-link,dash-link-whole,dash-subtotal,master-egroups,master-egroups-rule,appmenu
//   （1280x720 でも: --view 1280x720）
// 2 回目（2026-10-dashlink-2.mjs）の 1 位は R4 83.0 点（合格点 90 に届かず）。土台で直した所:
//   ①全案: 目標の棒の数値ラベルの上を実績の線が通る → 線の点がラベルの所を通るときは棒の中へ（入らなければ出さない）
//   ②R4（合わせ方をデータのカードにし「→ 45度線の横軸／グラフの棒」）と R1（① の頭の「数える物: 1 つのデータ／別のデータと合わせる」）を土台に入れた。
//     2 択は合わせた後も同じ所に残る（「1 つのデータ」で戻る）。撮る手順はこの 2 択を押す（隠した行を押さない）
//   ③出し方の言葉を形と合わせる: 重ねる → 系列に分ける・並べる → 図を並べる。1280 で 1 段に収まるよう「グループ合算」に詰めた
//   ④ルールのグループを開いた状態も撮る（master-egroups-rule）
// 避ける所（1・2 回目）: 印刷を道具の行に字のボタンで足す（1280 で案内が切れる）・見出し帯に足す・浮くボタン・出し方の札を設備の右へ（段が減らず揃いが崩れる）・
//   札に「3 系列」を足して広げる（折り返す）
// 持ち越し: S0＝直した土台（R4＋R1 を入れた物）
// 新しい案（4 つ）:
//   S1 状態を見せる: 出し方の説明の行の頭に、いまの結果「いま 3 系列（CR1・L-1・L-2）」「いま 3 枚」「いま 1 つ」（札は広げない）
//   S2 置き場: 印刷・画像はアプリのメニューに加え、ダッシュボードの道具の行の右端に絵だけのボタン 2 つ（⎙・⤓。title に名前とキー）
//   S3 見せ方: 設備グループのマスタで、ルールの行の右に「→ いま 3 設備: L-1・L-2・L-3」（読める大きさ）・小計は札（押すと入切）
//   S4 S1＋S3 を合わせた物
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };

// S1: いまの結果を説明の行の頭に
const nowLine = watch("#dbEditor .de-splitwhy", `(el) => { const btn = document.querySelector("#dbEditor .de-eqbtn"); const on = document.querySelector("#dbEditor input[data-de-split]:checked"); if (!btn || !on) return;
  const t = btn.textContent.replace(/[▾▴]/g, "").trim(); const names = btn.classList.contains("is-on") ? t : "すべての設備";
  const n = btn.classList.contains("is-on") ? t.split("・").length + (/ほか (\\d+)/.test(t) ? +RegExp.$1 - 1 : 0) : 0;
  const v = on.value, head = v === "series" ? (n ? "いま " + n + " 系列（" + names + "）" : "いま設備ごとの系列") : v === "facet" ? (n ? "いま " + n + " 枚（" + names + "）" : "いま設備ごとの図") : v === "sum" ? "いま 1 つ（" + names + " の計）" : "いまグループごと";
  el.insertAdjacentHTML("afterbegin", '<b class="pv-now">' + head + '</b>　'); }`);
const nowCss = `#dbEditor .pv-now{color:var(--h-input);font-weight:800}`;

// S2: 道具の行の右端に絵だけのボタン
const dashIcons = watch("#dashBar", `(bar) => { const put = () => { if (bar.querySelector(".pv-dbhc")) return; bar.insertAdjacentHTML("beforeend", '<span class="pv-dbhc"><button type="button" class="pv-ib" title="画面を印刷（Ctrl＋P）" aria-label="画面を印刷">⎙</button><button type="button" class="pv-ib" title="画面を画像で保存（Ctrl＋Shift＋S）" aria-label="画面を画像で保存">⤓</button></span>'); };
  put(); new MutationObserver(put).observe(bar, { childList: true }); }`);
const iconCss = `.pv-dbhc{display:inline-flex;gap:4px;margin-left:8px;flex:0 0 auto}
.pv-ib{width:32px;height:32px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font-size:16px;cursor:pointer;color:var(--ink)}`;

// S3: ルールの右に当たる設備・小計は札
const ruleHits = watch(".eg-rule", `(row) => { const v = row.querySelector("[data-eg-rv]").value; if (!v) return; const hits = [...document.querySelectorAll(".sh-eq.is-rule[aria-pressed=true]")].map((b) => b.textContent.replace("≈", "").trim());
  row.insertAdjacentHTML("beforeend", '<span class="pv-hit">→ いま ' + hits.length + ' 設備: ' + hits.join("・") + '</span>'); }`);
const s3Css = `.eg-rule .pv-hit{font-size:12.5px;color:var(--ink);font-weight:600;margin-left:8px}
#dbEditor .de-subrow .pv-ck{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--edit-line);border-radius:999px;background:var(--edit-field);font-weight:700}
#dbEditor .de-subrow .pv-ck:has(input:checked){border-color:var(--h-input);background:var(--input-soft);color:var(--h-input)}`;

export const PROPOSALS = [
  { key: "S0", name: "直した土台（カードの合わせ方・数える物の 2 択・系列に分ける）", css: "", ops: [] },
  { key: "S1", name: "S0＋出し方の説明の頭に「いま 3 系列」", css: nowCss, ops: [nowLine] },
  { key: "S2", name: "S0＋道具の行の右端に印刷・画像の絵のボタン", css: iconCss, ops: [dashIcons] },
  { key: "S3", name: "S0＋ルールの右に当たる設備・小計は札", css: s3Css, ops: [ruleHits] },
  { key: "S4", name: "S1＋S3", css: nowCss + s3Css, ops: [nowLine, ruleHits] },
];
