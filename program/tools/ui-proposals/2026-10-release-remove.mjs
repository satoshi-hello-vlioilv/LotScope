// 2026-10 マスタ管理「アプリの配布」に「版を消す」を足す 7 案（版 3.19.0）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-release-remove.mjs --states master-release
// 試験用の置き場は版 3 つ（3.13.0・配っている 3.12.0・前に配った 3.11.0）。頁は開くたびに描き直されるので、組み替えは描いたあとに当てる。
// 土台（master.js）は行ごとの赤枠「消す」と 2 回押し。押したあとの様子を比べるため、3.11.0 の行は押した後の形で撮る。
//
// 方向: A 置き場＝行の右端に「消す」・その場で 2 回押し（土台）／B 見せ方＝乗せた行にだけ出る小さな「消す」／
// C 流れ＝押すとすぐ消えたように見せ、数秒「元に戻す」／D 減らし方＝表の上の「古い版を片付ける」1 つ／E 置き場＝行を選んで表の下で消す
// 5 案を並べると、どれも人が消す・消す口が見えている解き方 → 方向の違う 2 案を足す:
// F 見せ方＝行末の「…」の中へしまう（ふだんは見せない）／G 減らし方＝人が消さない（置ける版の数を決め、古い版を自動で片付ける）

let marks = 0;
const after = (fn) => { const mark = `px${++marks}`; return ["script", `
  const box = document.querySelector('#masterSettings');
  const run = () => { const t = box.querySelector('.dz-flow') && box.querySelector('.pz-table'); if (!t || t.dataset.${mark}) return; t.dataset.${mark} = '1'; (${fn})(box); };
  new MutationObserver(run).observe(box, { childList: true }); run();`]; };
const row = (v) => `[...box.querySelectorAll('.pz-table tbody tr')].find((r) => r.querySelector('.pz-ver').textContent === '${v}')`;
const armOld = after(`(box) => { const b = ${row("3.11.0")}.querySelector('[data-remove]'); b.classList.add('is-armed'); b.textContent = 'もう一度押すと消す'; }`);

export const PROPOSALS = [
  { key: "A", name: "行の右端に赤枠の「消す」・その場で 2 回押し（土台）", css: "", ops: [armOld] },
  {
    key: "B", name: "乗せた行にだけ出る小さな「消す」（3.11.0 に乗せた形）",
    css: `.pz-btn.dz-rm{visibility:hidden;border-color:transparent;background:none;height:22px;padding:0 6px;font-size:12px}
      .pz-table tr.px-hover .pz-btn.dz-rm,.pz-table tr:hover .pz-btn.dz-rm{visibility:visible}
      .pz-table tr.px-hover{background:var(--surface-5)}`,
    ops: [after(`(box) => { ${row("3.11.0")}.classList.add('px-hover'); }`), armOld],
  },
  {
    key: "C", name: "押すとすぐ消えたように見せ、数秒「元に戻す」（3.11.0 を押した直後）",
    css: `.px-gone td{color:var(--muted);text-decoration:line-through;background:var(--surface-5)}
      .px-gone td.pz-acts{text-decoration:none}
      .px-undo{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink)}
      .px-undo b{color:var(--danger)}`,
    ops: [after(`(box) => { const r = ${row("3.11.0")}; r.classList.add('px-gone');
      r.querySelector('.pz-acts').innerHTML = '<span class="px-undo"><b>消しました</b><button type="button" class="pz-btn dz-go">元に戻す（4 秒）</button></span>'; }`)],
  },
  {
    key: "D", name: "表の上の「古い版を片付ける」1 つ（配る版と前に配った版は残す）",
    css: `.pz-btn.dz-rm{display:none}
      .px-tidy{display:flex;align-items:center;gap:10px;margin:10px 0 6px;font-size:13px;color:var(--muted)}`,
    ops: [after(`(box) => { box.querySelector('.pz-wrap').insertAdjacentHTML('beforebegin',
      '<div class="px-tidy"><button type="button" class="pz-btn dz-rm" style="display:inline-block">古い版を片付ける（0 版）</button>配っている版・前に配った版・それより新しい版は残します</div>'); }`)],
  },
  {
    key: "E", name: "行を選んで、表の下の「選んだ版を消す」",
    css: `.pz-btn.dz-rm{display:none}
      .px-pick{width:16px;height:16px;vertical-align:middle;margin-right:8px}
      .px-bulk{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:13px;color:var(--muted)}`,
    ops: [after(`(box) => {
      box.querySelectorAll('.pz-table tbody tr').forEach((r) => { const live = r.classList.contains('is-live');
        r.firstElementChild.insertAdjacentHTML('afterbegin', '<input type="checkbox" class="px-pick"' + (live ? ' disabled title="配っている版は消せません"' : '') + '>'); });
      ${row("3.13.0")}.querySelector('.px-pick').checked = true;
      box.querySelector('.pz-wrap').insertAdjacentHTML('beforeend', '<div class="px-bulk"><button type="button" class="pz-btn dz-rm" style="display:inline-block">選んだ版を消す（1 版）</button>配っている版は選べません</div>'); }`)],
  },
  {
    key: "F", name: "行末の「…」の中へしまう（3.11.0 の「…」を開いた形）",
    css: `.pz-btn.dz-rm{display:none}
      .px-more{position:relative;display:inline-block}
      .px-menu{position:absolute;right:0;top:30px;z-index:5;min-width:150px;padding:4px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 8px 24px rgba(10,30,50,.18);text-align:left}
      .px-menu button{display:block;width:100%;height:30px;border:0;background:none;text-align:left;padding:0 10px;font-size:13px;color:var(--danger);cursor:pointer;font-family:inherit}`,
    ops: [after(`(box) => {
      box.querySelectorAll('.pz-table tbody tr:not(.is-live) .pz-acts').forEach((c) => c.insertAdjacentHTML('beforeend', '<span class="px-more"><button type="button" class="pz-btn">…</button></span>'));
      ${row("3.11.0")}.querySelector('.px-more').insertAdjacentHTML('beforeend', '<div class="px-menu"><button type="button">この版を置き場から消す</button></div>'); }`)],
  },
  {
    key: "G", name: "人が消さない（置いておく版の数を決め、古い版を自動で片付ける）",
    css: `.pz-btn.dz-rm{display:none}
      .px-keep{display:flex;align-items:center;gap:8px;margin:10px 0 6px;font-size:13px;color:var(--ink)}
      .px-keep select{height:26px;border:1px solid var(--line);border-radius:6px;font-family:inherit}
      .px-keep small{color:var(--muted)}`,
    ops: [after(`(box) => { box.querySelector('.pz-wrap').insertAdjacentHTML('beforebegin',
      '<div class="px-keep">置いておく版 <select><option>5 版</option></select><small>超えたら、配っている版・前に配った版を除く古い版から自動で消します</small></div>'); }`)],
  },
];
