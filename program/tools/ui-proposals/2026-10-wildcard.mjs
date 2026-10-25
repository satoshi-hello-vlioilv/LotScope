// 2026-10 絞り込みの比べ方（で始まらない・で終わらない）と、Excel の * ? を使える値。1 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-wildcard.mjs --states list-colfilter
// 今の画面で見えたこと（ui-check の画像・利用者の画像）:
//   ①比べ方の選びは 12 個が 1 列に並ぶだけで、字・数・空欄の区切りが無い ②「前方一致」はあるが「で始まらない」「で終わらない」が無い
//   ③値の欄は「値」とだけあり、* や ? が使えるか分からない（使えない。% と _ は SQL の印として黙って効いてしまう）
//   ④「含む」「前方一致」「＝ 一致」と言葉の型がそろっていない（〜を含む／漢語／記号）
// 案の方向（何で解くか）:
//   A 並べ方: 比べ方を「字・数・空欄」の段に分け、言葉を「〜で始まる／〜で始まらない」の型にそろえる。値の欄の薄い字で * ? を知らせる
//   B 知らせ方: A ＋ 条件の下に、いま書いた値の読み方を 1 行の文で返す（「CR で始まらない値」・* ? の意味）
//   C 減らし方: 比べ方は肯定の 6 つだけ。「当てはまる／当てはまらない」の 2 つの札で裏返す
//   D 流れ: 日本語の語順（値 → 比べ方）。「[CR] [で始まらない ▾]」と文のように読む。* ? は欄の右の「?」の札
//   E 置き場: A ＋ 値の欄の下に型の札（〜で始まる A*・〜で終わる *A・〜を含む *A*・1 字 ?）。押すと値に入る
//   F 見せ方: A ＋ 値の並びに、いまの条件に当たる値の印と数（「当たる 6 / 12」）。書いた値がどの値に当たるかを目で確かめる
const OPS_NOW = ["含む", "含まない", "＝ 一致", "≠ 不一致", "前方一致", "後方一致", "> より大きい", ">= 以上", "< より小さい", "<= 以下", "空欄", "空欄以外"];
const GROUPED = [["字", ["を含む", "を含まない", "と同じ", "と違う", "で始まる", "で始まらない", "で終わる", "で終わらない"]],
  ["数", ["> より大きい", ">= 以上", "< より小さい", "<= 以下"]], ["空欄", ["空欄", "空欄以外"]]];
const css = `
.wx-list{position:absolute;z-index:80;left:0;top:32px;min-width:190px;background:#fff;border:1px solid #8aa;box-shadow:0 8px 20px rgba(12,34,48,.25);border-radius:4px;padding:3px 0;font-size:13px}
.wx-list div{padding:3px 10px;white-space:nowrap}.wx-list .sel{background:#2f7d78;color:#fff}
.wx-list .grp{font-weight:700;color:#5d6b77;font-size:12px;padding:5px 8px 2px;border-top:1px solid #edf1f4}.wx-list .grp:first-child{border-top:0}
.wx-list .grp + div,.wx-list .grp ~ div{padding-left:18px}
.wx-sel{position:relative}
.wx-help{grid-column:1 / -1;font-size:12px;color:#40505d;background:#f4f8f8;border-radius:6px;padding:5px 8px;line-height:1.55}
.wx-help b{color:#1f5f5a}.wx-help code{font-family:Consolas,monospace;background:#e3efee;border-radius:3px;padding:0 4px;color:#1b2733;font-weight:700}
.wx-seg{display:flex;gap:0;margin-bottom:2px}.wx-seg button{flex:1;height:28px;border:1px solid #dbe3e9;background:#f6f9fb;font:inherit;font-size:12.5px;cursor:pointer}
.wx-seg button:first-child{border-radius:6px 0 0 6px}.wx-seg button:last-child{border-radius:0 6px 6px 0;border-left:0}
.wx-seg button.on{background:#e5f2f0;border-color:#2f7d78;color:#1f5f5a;font-weight:700}
.wx-q{width:26px;height:26px;border-radius:50%;border:1px solid #9fb3bf;background:#fff;color:#2f7d78;font-weight:800;font-size:13px}
.wx-tip{position:absolute;z-index:80;right:-8px;top:34px;width:280px;background:#1b2733;color:#fff;font-size:12px;border-radius:6px;padding:8px 10px;line-height:1.6}
.wx-tip code{background:rgba(255,255,255,.16);border-radius:3px;padding:0 4px;font-weight:700}
.wx-chips{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:4px}
.wx-chips button{height:24px;padding:0 8px;border:1px dashed #9fc5c0;border-radius:999px;background:#fff;font:inherit;font-size:12px;color:#1f5f5a;cursor:pointer}
.wx-chips code{font-family:Consolas,monospace;font-weight:700;margin-left:4px;color:#1b2733}
.wx-hit{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:#2f7d78;color:#fff;font-size:11px;font-weight:700}
.vf-it.wx-no{opacity:.45}.vf-it.wx-no .vf-lab{text-decoration:line-through}
.wx-count{font-size:12px;color:#1f5f5a;font-weight:700;margin-left:auto}
`;
const list = (items, sel) => `<div class="wx-list" role="listbox">${items.map((x) => Array.isArray(x)
  ? `<div class="grp">${x[0]}</div>` + x[1].map((o) => `<div class="${o === sel ? "sel" : ""}">${o}</div>`).join("")
  : `<div class="${x === sel ? "sel" : ""}">${x}</div>`).join("")}</div>`;
const sel = (label, items, selTxt, open = true) => `<span class="wx-sel"><select data-vf-op aria-label="比べ方"><option>${label}</option></select>${open ? list(items, selTxt) : ""}</span>`;
const inp = (v, ph) => `<input data-vf-val value="${v}" placeholder="${ph}" aria-label="比べる値">`;
const x = '<button type="button" class="vf-x" title="この条件を外す">×</button>';
/** 条件の行を置き換える（1 行目だけ） */
const row = (html, extra = "", pre = "") => ["script", `
  const go = () => { const r = document.querySelector('.vf-pop .vf-crow:not([data-wx])'); if (!r) return; r.dataset.wx = 1; ${pre}
    r.innerHTML = ${JSON.stringify(html)}; ${extra} };
  new MutationObserver(go).observe(document.documentElement, { childList: true, subtree: true });`];
// 「CR」で始まらない（値の並びで当たる値を見せる案のため、どの値が当たるかも決めておく）
const MATCH = "const hit = (v) => !/^CR/i.test(v.normalize('NFKC').replace(/\\s/g,''));";
export const PROPOSALS = [
  { key: "now", name: "今（12 個を 1 列・値は「値」）", css, ops: [row(sel("前方一致", OPS_NOW, "前方一致") + inp("CR", "値") + x)] },
  { key: "A", name: "字・数・空欄の段と、言葉の型をそろえる・値の欄に * ?", css,
    ops: [row(sel("で始まらない", GROUPED, "で始まらない") + inp("CR", "値（* 何文字でも・? 1 字）") + x)] },
  { key: "B", name: "A ＋ 書いた値の読み方を 1 行の文で返す", css,
    ops: [row(sel("で始まらない", GROUPED, "で始まらない", false) + inp("C?1*", "値（* ? が使えます）") + x
      + '<p class="wx-help">→ <b>「C」＋1 字＋「1」で始まらない</b>値<br><code>*</code> 何文字でも　<code>?</code> 1 字　<code>~*</code> * そのもの</p>')] },
  { key: "C", name: "肯定の 6 つ＋「当てはまる／当てはまらない」の札で裏返す", css,
    ops: [row(sel("で始まる", ["を含む", "と同じ", "で始まる", "で終わる", "> より大きい", ">= 以上", "< より小さい", "<= 以下", "空欄"], "で始まる") + inp("CR", "値（* ? が使えます）") + x, "", "r.insertAdjacentHTML('beforebegin', '<div class=\\'wx-seg\\'><button type=\\'button\\'>当てはまる</button><button type=\\'button\\' class=\\'on\\'>当てはまらない</button></div>');")] },
  { key: "D", name: "語順を日本語に（値 → 比べ方）・* ? は「?」の札", css,
    ops: [row(inp("CR", "値") + sel("で始まらない", GROUPED, "で始まらない", false) + '<span style="position:relative"><button type="button" class="wx-q" title="* ? の使い方">?</button>'
        + '<span class="wx-tip"><code>*</code> は何文字でも、<code>?</code> は 1 字に当たります。<br>例: <code>A*5</code> … A で始まり 5 で終わる<br><code>~*</code> と書くと * そのもの</span></span>' + x, "", "r.style.gridTemplateColumns = '1fr minmax(0,44%) auto auto';")] },
  { key: "E", name: "A ＋ 値の欄の下に型の札（押すと値に入る）", css,
    ops: [row(sel("と同じ", GROUPED, "と同じ", false) + inp("CR*", "値（* ? が使えます）") + x
      + '<div class="wx-chips"><button type="button">始まる<code>A*</code></button><button type="button">終わる<code>*A</code></button><button type="button">含む<code>*A*</code></button><button type="button">1 字<code>?</code></button></div>')] },
  { key: "F", name: "A ＋ 値の並びに当たる値の印と数", css,
    ops: [row(sel("で始まらない", GROUPED, "で始まらない", false) + inp("CR", "値（* 何文字でも・? 1 字）") + x
      + '<p class="wx-help" style="display:flex;gap:8px;align-items:center;white-space:nowrap">条件に当たる値 <b class="wx-count" style="margin-left:0">6 / 8</b><span style="color:#5d6b77">薄い値は外れます</span></p>',
      `${MATCH} document.querySelectorAll('.vf-pop .vf-it').forEach((it) => { const v = it.querySelector('.vf-lab').textContent; if (!hit(v)) it.classList.add('wx-no'); });`)] },
];
