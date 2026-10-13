// 2026-10 作業実績: 設備のタブの並びを変えられるようにする（タブを直接・設備を管理から。7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-equiporder.mjs --states worklog,master-worklog [--view 1536x864]
// 利用者の要望: 作業実績の設備のタブの並び順を変更できるように。設備を管理（設定）からでも、タブを直接でも、どちらでも並び替えられるように。
// 今の画面（画像で見えたこと）: タブ 12 個は登録の順のまま動かせず、動かせる手がかりも無い。設備を管理の一覧にも並びの列・動かす取っ手が無い。
// 並びは全員で 1 つ（マスタ「作業実績の設備」の並び）。動かせるのは設備を管理できる人（タブの上でも同じ）。
// 案は、タブの帯と設備を管理の一覧の両方に、動かし方を当てた形（動かしている途中の形）で比べる。
//
// 方向（何で解くか）: A 直接つかむ＝タブもそのまま引いて動かす・一覧は行の取っ手 ⋮⋮ を引く（動かしている所に差し込みの線）
// ／B 流れ＝「⇄ 並べ替え」を押すと並べ替えの間だけ ◀ ▶ が出る（終わったら「完了」）・一覧は ▲ ▼
// ／C 置き場＝タブを右クリックした小さなメニュー（左へ・右へ・先頭へ・末尾へ）・一覧は ▲ ▼
// ／D 数で＝一覧に「並び」の番号の欄（打つと並ぶ）・タブは引いて動かす
// ／E 見せ方＝設備を管理の上に「タブの並び」の帯（タブと同じ見た目の札を引いて並べる）・タブは引いて動かす
// 5 案は「1 つずつ動かす」に寄る → 方向の違う 2 案を足す:
// F 手を離さない＝選んだタブを Alt＋← → で動かす（引くのが苦手な人・タッチパッド）＋一覧は ▲ ▼
// G 決まりで並べる＝「名前順・登録順・自分で並べる」を選ぶ（自分で並べるときだけ引く）

export const KIT = ["script", `
(() => {
  const $ = (s) => document.querySelector(s);
  window.__eq = {
    $,
    /** 案を入れる: build() が HTML を入れる（data-px の物が消えたら入れ直す） */
    mount(key, build) { setInterval(() => { if (!document.querySelector("[data-px='" + key + "']")) try { build(); } catch (_) {} }, 150); },
    tabs: () => [...document.querySelectorAll("#llEquipBar .eq-chip")],
    rows: () => [...document.querySelectorAll(".wl-tablelist tbody tr")],
  };
})();`];
export const CSS = `
  .px-ins{display:inline-block;width:3px;height:26px;border-radius:2px;background:var(--h-input);margin:0 2px;vertical-align:middle;box-shadow:0 0 0 3px color-mix(in srgb,var(--h-input) 18%,transparent)}
  .px-lift{transform:translateY(-4px) rotate(-2deg);box-shadow:0 8px 18px rgba(20,40,60,.22)!important;background:var(--surface)!important;border:1px solid var(--h-input)!important;border-radius:8px!important;opacity:.95}
  .px-ghost{opacity:.35;border:1px dashed var(--line)!important}
  .px-hint{font-size:11.5px;color:var(--muted);margin-left:10px;white-space:nowrap}
  .px-btn{height:26px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:inherit;font-size:12px;font-weight:700;color:var(--h-input);padding:0 10px;margin-left:8px;white-space:nowrap}
  .px-btn.on{background:var(--h-input);color:#fff;border-color:var(--h-input)}
  .px-arr{display:inline-flex;gap:1px;margin-left:4px}
  .px-arr b{width:16px;height:16px;border-radius:4px;background:var(--surface-4);color:var(--h-input);font-size:9px;display:inline-flex;align-items:center;justify-content:center}
  .px-menu{position:fixed;z-index:80;background:var(--surface);border:1px solid var(--pop-line);border-radius:9px;box-shadow:0 14px 34px var(--pop-shadow);padding:5px;display:grid;min-width:170px;font-size:12.5px}
  .px-menu span{padding:6px 10px;border-radius:6px;display:flex;justify-content:space-between;gap:12px}
  .px-menu span:first-child{background:var(--surface-4)}
  .px-menu small{color:var(--muted)}
  .px-menu hr{border:0;border-top:1px solid var(--line);margin:3px 0}
  .px-grip{color:#8a97a3;font-weight:800;letter-spacing:-2px;cursor:grab;padding:0 6px;font-size:14px}
  .px-ud{display:inline-flex;gap:3px}.px-ud b{width:24px;height:24px;border:1px solid var(--line);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:var(--h-input);background:var(--surface)}
  .px-num{width:46px;height:28px;border:1px solid var(--edit-line);border-radius:6px;background:var(--edit-field);text-align:center;font:inherit;font-variant-numeric:tabular-nums}
  tr.px-row-lift td{background:color-mix(in srgb,var(--h-input) 8%,var(--surface))!important;box-shadow:0 6px 14px rgba(20,40,60,.14)}
  tr.px-row-ins td{border-top:3px solid var(--h-input)!important}
  .px-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface-1);margin:6px 0}
  .px-strip b{font-size:12.5px;margin-right:6px}
  .px-strip span{height:28px;display:inline-flex;align-items:center;padding:0 12px;border:1px solid var(--line);border-radius:7px 7px 0 0;background:var(--surface);font-weight:700;font-size:12.5px}
  .px-strip small{color:var(--muted);margin-left:8px}
  .px-sel{height:26px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:inherit;font-size:12px;padding:0 6px;margin-left:8px}
  .px-focus{outline:3px solid color-mix(in srgb,var(--h-input) 55%,transparent);outline-offset:1px;border-radius:7px}
  .px-key{font-size:10.5px;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 4px;background:var(--surface);margin:0 1px}
`;
export const go = (key, build) => ["script", `window.__eq.mount(${JSON.stringify(key)}, () => { const X = window.__eq; ${build} });`];
// タブの帯: 3 つ目（CR1）の前に差し込みの線、6 つ目（HOT）をつかんで持ち上げた形
export const DRAG_TABS = (key, hint) => `const t = X.tabs(); if (t.length < 7) return;
  t[5].classList.add("px-lift"); t[5].setAttribute("data-px", ${JSON.stringify(key)});
  t[2].insertAdjacentHTML("beforebegin", '<i class="px-ins" data-px=${JSON.stringify(key)}></i>');
  ${hint ? `X.$("#llEquipBar .eq-chips").insertAdjacentHTML("afterend", '<span class="px-hint" data-px=${JSON.stringify(key)}>${hint}</span>');` : ""}`;
// 一覧の先頭の列に物を足す（見出しにも）
export const ROW_COL = (key, head, cell) => `const rows = X.rows(); if (!rows.length) return;
  const th = X.$(".wl-tablelist thead tr"); th.insertAdjacentHTML("afterbegin", '<th data-px=${JSON.stringify(key)}>${head}</th>');
  rows.forEach((tr, i) => tr.insertAdjacentHTML("afterbegin", '<td data-px=${JSON.stringify(key)}>' + (${cell})(i) + '</td>'));`;
const UD = `(i) => '<span class="px-ud"><b>▲</b><b>▼</b></span>'`;

export const PROPOSALS = [
  { key: "A", name: "直接つかむ: タブを引いて動かす（差し込みの線）・一覧は行の取っ手 ⋮⋮ を引く", css: CSS,
    ops: [KIT, go("At", DRAG_TABS("At", "タブはつかんで並べ替えられます")),
      go("Am", `${ROW_COL("Am", "", `(i) => '<span class="px-grip" title="つかんで並べ替え">⋮⋮</span>'`)}
        const r = X.rows(); if (r[5]) r[5].classList.add("px-row-lift"); if (r[2]) r[2].classList.add("px-row-ins");`)] },
  { key: "B", name: "流れ: 「⇄ 並べ替え」を押した間だけ ◀ ▶（完了で終わる）・一覧は ▲ ▼", css: CSS,
    ops: [KIT, go("Bt", `const t = X.tabs(); if (!t.length) return;
      t.forEach((x) => x.insertAdjacentHTML("beforeend", '<span class="px-arr" data-px="Bt"><b>◀</b><b>▶</b></span>'));
      X.$("#llEquipBar .eq-chips").insertAdjacentHTML("afterend", '<button class="px-btn on" data-px="Bt">⇄ 並べ替え中 ・ 完了</button>');`),
      go("Bm", ROW_COL("Bm", "並び", UD))] },
  { key: "C", name: "置き場: タブを右クリック → 左へ・右へ・先頭へ・末尾へ・一覧は ▲ ▼", css: CSS,
    ops: [KIT, go("Ct", `const t = X.tabs(); if (t.length < 7) return; const r = t[5].getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", '<div class="px-menu" data-px="Ct" style="left:' + (r.left + 10) + 'px;top:' + (r.bottom + 4) + 'px"><span>← 左へ<small>Ctrl+←</small></span><span>右へ →<small>Ctrl+→</small></span><span>⇤ 先頭へ</span><span>末尾へ ⇥</span><hr><span>設備を管理…</span></div>');
      t[5].classList.add("px-focus");`), go("Cm", ROW_COL("Cm", "並び", UD))] },
  { key: "D", name: "数で: 一覧に「並び」の番号の欄（打つと並ぶ）・タブは引いて動かす", css: CSS,
    ops: [KIT, go("Dt", DRAG_TABS("Dt", "")), go("Dm", ROW_COL("Dm", "並び", `(i) => '<input class="px-num" value="' + (i + 1) + '">'`))] },
  { key: "E", name: "見せ方: 設備を管理の上に「タブの並び」の帯（タブと同じ札を引く）・タブも引く", css: CSS,
    ops: [KIT, go("Et", DRAG_TABS("Et", "つかんで並べ替え")),
      go("Em", `const sum = X.$(".wl-sum"); if (!sum || !X.rows().length) return; const names = X.rows().map((tr) => tr.querySelector(".wl-name")?.value || "");
      sum.insertAdjacentHTML("afterend", '<div class="px-strip" data-px="Em"><b>タブの並び</b>' + names.map((n, i) => '<span class="' + (i === 5 ? "px-lift" : "") + '">' + n + '</span>' + (i === 1 ? '<i class="px-ins"></i>' : "")).join("") + '<small>つかんで並べ替え（作業実績のタブと同じ並び）</small></div>');`)] },
  { key: "F", name: "手を離さない: 選んだタブを Alt＋← → で動かす・一覧は ▲ ▼（キーでも）", css: CSS,
    ops: [KIT, go("Ft", `const t = X.tabs(); if (t.length < 2) return; t[0].classList.add("px-focus");
      X.$("#llEquipBar .eq-chips").insertAdjacentHTML("afterend", '<span class="px-hint" data-px="Ft">選んだタブは <span class="px-key">Alt</span>＋<span class="px-key">←</span><span class="px-key">→</span> で動かせます</span>');`),
      go("Fm", ROW_COL("Fm", "並び", UD))] },
  { key: "G", name: "決まりで並べる: 「名前順・登録順・自分で並べる」を選ぶ（自分で並べるときだけ引く）", css: CSS,
    ops: [KIT, go("Gt", `${DRAG_TABS("Gt", "")}
      X.$("#llEquipBar .eq-chips").insertAdjacentHTML("afterend", '<select class="px-sel" data-px="Gt"><option>自分で並べる</option><option>名前順</option><option>登録順</option></select>');`),
      go("Gm", `const sum = X.$(".wl-sum"); if (!sum || !X.rows().length) return; sum.insertAdjacentHTML("beforeend", '<select class="px-sel" data-px="Gm"><option>タブの並び: 自分で並べる</option><option>名前順</option><option>登録順</option></select>');
      ${ROW_COL("Gm", "", `(i) => '<span class="px-grip">⋮⋮</span>'`)}`)] },
];
