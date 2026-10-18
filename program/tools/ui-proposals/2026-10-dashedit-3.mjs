// 2026-10-18 ダッシュボードの組む所の 3 回目（版 3.45.0。利用者の要望 2・3・6）。決まり 2026-10-17（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-dashedit-3.mjs --states dash-cond,dash-kpi-fmt   （1536x864・1280x720 でも）
// 2 回目（2026-10-dashedit.json の 2 回目）: 1 位 D2・E2 79.3 点で届かず。指摘: 「単位」の 3 行下に「単位で割る」があり同じ言葉が別の物に・
//   見本と計算の間に 1 行ぶんの空き・取っ手の点の帯が右の「並べ方」「計算」の字にくっつく・D2 と E2 を合わせると届きそう
// 3 回目の土台（全案に入れた）: D2＋E2（カラム名は 2 行まで折り返す・カラムの見出しに「⇔ 名前に合わせる」の札〈押すと 1 行に入る幅へ一度で。動く〉）・
//   「単位で割る」を「千・万で割る」に・計算の名前を上にそろえる（空きを無くす）・右の組み立ての左に間（取っ手が字にくっつかない）
// 案の方向:
//   A3 土台のまま（計算は式の欄＋札）
//   B3 計算は 演算子の選び＋数の欄＋札（2 回目の B2 を持ち越し）
//   C3 チャンク（「計算と単位」を見本のすぐ下に、淡い枠でまとめる: 数の値そのものを変える物と、見せ方〈表示形式〉を分ける）。新しい
//   D3 整列（書式の名前の列を右寄せにし、欄の左端を 1 本の線にそろえる）。新しい
//   E3 視覚化（計算の欄の横に「21 → 210」の形で、いまの数が計算でどう変わるかを出す）。新しい
let seq = 0;
const watch = (sel, fn) => { const k = `dh${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
export const PROPOSALS = [
  { key: "A", name: "A3 名前は 2 行＋名前に合わせる・千・万で割る・計算は式の欄＋札（土台）", css: "", ops: [] },
  {
    key: "B", name: "B3 計算は 演算子の選び＋数の欄＋札",
    css: `.cg-op{height:30px;border:1px solid var(--edit-line);background:var(--edit-field);border-radius:7px;padding:0 6px;font:inherit;font-size:13px}.cg-num{width:96px!important}`,
    ops: [watch("#dbEditor .de-fcalc", `(c) => { const i = c.querySelector("[data-de-fexpr]"); if (!i) return; const m = /^([×÷+\\-])\\s*(.*)$/.exec(i.value) || ["", "", ""];
      i.insertAdjacentHTML("beforebegin", '<select class="cg-op" aria-label="計算"><option' + (m[1] ? "" : " selected") + '>なし</option><option' + (m[1] === "×" ? " selected" : "") + '>× かける</option><option' + (m[1] === "÷" ? " selected" : "") + '>÷ わる</option><option>＋ たす</option><option>− ひく</option><option>式…</option></select><input class="de-ntx cg-num" placeholder="数" value="' + m[2] + '">');
      i.style.display = "none"; const msg = c.querySelector(".de-cmsg"); if (msg) msg.textContent = m[1] ? "値" + m[1] + m[2] + " を出します" : "選ぶと数に計算を当てます（よく使う物は右の札）"; }`)],
  },
  {
    key: "C", name: "C3 「計算と単位」を見本の下に淡い枠でまとめる",
    css: `#dbEditor .dh-box{grid-column:1/-1;display:grid;grid-template-columns:subgrid;row-gap:8px;padding:8px 0;margin:0 -8px;border:1px solid var(--line-soft);border-radius:8px;background:var(--surface-2);position:relative}
      #dbEditor .dh-box > *{margin-left:8px}#dbEditor .dh-cap{grid-column:1/-1;font-size:11.5px;font-weight:800;color:var(--muted)}`,
    ops: [watch("#deFmt .de-ngrid", `(g) => { const kids = [...g.children]; const at = kids.findIndex((k) => /表示形式/.test(k.textContent) && k.classList.contains("de-gl")); if (at <= 0) return;
      const box = document.createElement("div"); box.className = "dh-box"; box.innerHTML = '<span class="dh-cap">数そのものを変える（計算と単位）</span>'; kids.slice(0, at).forEach((k) => box.append(k)); g.prepend(box); }`)],
  },
  {
    key: "D", name: "D3 書式の名前の列を右寄せにして欄の左端をそろえる",
    css: `#dbEditor .de-gl{text-align:right;justify-self:end}#dbEditor .de-ngrid{column-gap:12px}#dbEditor .de-fmt .de-l,#dbEditor .de-row > .de-l{text-align:right}`,
    ops: [],
  },
  {
    key: "E", name: "E3 計算の欄の横に「21 → 210」の形で変わり方を出す",
    css: `.dh-prev{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;background:var(--ll-pale);color:var(--ll-teal-dark);font-weight:700;font-variant-numeric:tabular-nums}.dh-prev i{font-style:normal;color:var(--muted);font-weight:400}`,
    ops: [watch("#dbEditor .de-fcalc", `(c) => { const i = c.querySelector("[data-de-fexpr]"); if (!i) return; const st = Dashboard._state(), id = DashEditor.panelId(), a = st.answers[id];
      const raw = a && a.cells ? ((a.cells.find((x) => !x.r.length && !x.c.length) || { v: [0] }).v[0]) : 0, fn = NumFormat.expr(i.value).fn, out = fn ? fn(raw) : raw;
      i.insertAdjacentHTML("afterend", '<span class="dh-prev"></span>'); const box = i.nextElementSibling;
      const upd = () => { const a2 = Dashboard._state().answers[DashEditor.panelId()], r = a2 && a2.cells ? ((a2.cells.find((x) => !x.r.length && !x.c.length) || { v: [0] }).v[0]) : raw, f2 = NumFormat.expr(i.value).fn;
        box.innerHTML = r.toLocaleString() + '<i>→</i>' + (f2 ? f2(r) : r).toLocaleString() + (f2 ? "" : '<i>（計算なし）</i>'); };
      upd(); i.addEventListener("input", () => setTimeout(upd, 50)); setInterval(upd, 400); }`)],
  },
];
