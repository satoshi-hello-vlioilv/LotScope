// 2026-10 マスタ管理「作業実績」（フォルダ → 探す → 設備ごとに表示する・しない）の頁の 7 案。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-worklog-master.mjs --states master-worklog
// 試験用の作業実績は設備 12 台（SL3 はファイルが見つからない・HOT は 80 時間更新が止まっている）。頁は開くたびに描き直されるので、
// 組み替えは描いたあとに当てる（MutationObserver）。再現は近似: 置き場と見え方を比べるためのもの。
//
// 方向: A 今の作り（上にフォルダと探す・下に表）／B 流れ＝番号つきの段（① フォルダを決めて探す → ② 表示する設備を選ぶ）／
// C 見せ方＝設備ごとのカード／D 減らし方＝フォルダを 1 行の文にし、表の上に数の札／E 流れ＝直すべき物（見つからない・古い）を先に
// 5 案を並べると、どれも 1 列の頁で、ほかのマスタ（表＋右の詳細）と形を揃える解き方と、置き場を左右に分ける解き方が無い → 2 案を足す:
// F 置き場＝左にフォルダと探す・右に表／G 一定＝ほかのマスタと同じ「表＋右の詳細」

/** #masterSettings を描き直すたびに fn を当てる（当てた印は fn ごと。いくつ重ねても、どれも 1 回ずつ当たる） */
let marks = 0;
const after = (fn) => { const mark = `px${++marks}`; return ["script", `
  const box = document.querySelector('#masterSettings');
  const run = () => { const pg = box.querySelector('.wl-page'); if (!pg || pg.dataset.${mark}) return; pg.dataset.${mark} = '1'; (${fn})(box); };
  new MutationObserver(run).observe(box, { childList: true }); run();`]; };

export const PROPOSALS = [
  { key: "A", name: "上にフォルダと探す・下に設備の表（今の作り）", css: "", ops: [] },
  {
    key: "B", name: "番号つきの段（① フォルダを決めて探す → ② 表示する設備を選ぶ）",
    css: `.wl-page{counter-reset:st}
      .px-step{display:flex;align-items:baseline;gap:10px;margin:4px 0 -2px;font-size:15px;font-weight:800;color:var(--ink)}
      .px-step i{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--h-input);color:#fff;font-style:normal;font-size:13px}
      .px-step small{font-size:12.5px;font-weight:400;color:var(--muted)}`,
    ops: [after(`(box) => {
      box.querySelector('.wl-src').insertAdjacentHTML('beforebegin', '<div class="px-step"><i>1</i>フォルダを決めて探す<small>実績_＊＊＊.sqlite3 の ＊＊＊ を設備として並べます</small></div>');
      box.querySelector('.wl-sum').insertAdjacentHTML('beforebegin', '<div class="px-step"><i>2</i>表示する設備を選ぶ<small>作業実績のタブで選べるのは「表示」にした設備だけです</small></div>');
    }`)],
  },
  {
    key: "C", name: "設備ごとのカード（表示の切り替え・ファイル・更新をカードに）",
    css: `.wl-tablelist thead{display:none}
      .wl-tablelist tbody{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:10px}
      .wl-tablelist tr{display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
      .wl-tablelist td{display:block;border:0!important;padding:0!important}
      .wl-tablelist td:nth-child(1){grid-column:2;grid-row:1}.wl-tablelist td:nth-child(2){grid-column:1;grid-row:1}
      .wl-tablelist td:nth-child(3){grid-column:1 / -1;font-size:12px}.wl-tablelist td:nth-child(4){grid-column:1 / -1;font-size:12px;color:var(--muted);text-align:left}
      .wl-tablelist td:nth-child(5),.wl-tablelist td:nth-child(6){display:none}.wl-tablelist td:nth-child(7){grid-column:1 / -1;text-align:right}
      .wl-switch span{display:none}`,
    ops: [],
  },
  {
    key: "D", name: "フォルダを 1 行の文に・表の上に数の札（減らす）",
    css: `.wl-src{grid-template-columns:auto minmax(0,1fr) 190px auto;align-items:center;padding:8px 12px}
      .wl-field{flex-direction:row;align-items:center;gap:8px}.wl-field span{white-space:nowrap}
      .wl-how{display:none}.wl-sum small{display:none}
      .px-chips{display:inline-flex;gap:6px}.px-chips span{padding:2px 10px;border-radius:999px;font-size:12.5px;font-weight:700;background:var(--surface-5)}
      .px-chips .ng{background:var(--danger-bg);color:#a33a2c}.px-chips .warn{background:var(--warn-soft);color:var(--warn-ink)}`,
    ops: [after(`(box) => {
      const rows = [...box.querySelectorAll('.wl-tablelist tbody tr')];
      const off = rows.filter((r) => r.classList.contains('is-off')).length, miss = rows.filter((r) => r.classList.contains('is-missing')).length;
      box.querySelector('.wl-sum').innerHTML = '<b>設備 ' + rows.length + ' 台</b><span class="px-chips"><span>表示 ' + (rows.length - off) + '</span>' + (miss ? '<span class="ng">見つからない ' + miss + '</span>' : '') + '<span class="warn">古い 1</span></span>';
    }`)],
  },
  {
    key: "E", name: "直すべき物を先に（見つからない・古い設備と、次の手）",
    css: `.px-todo{display:grid;gap:6px;padding:10px 14px;border:1px solid var(--amber-line);border-left:4px solid #dc7f2a;border-radius:10px;background:var(--amber-pale)}
      .px-todo b{font-size:14px}.px-todo div{display:flex;align-items:center;gap:10px;font-size:13px}
      .px-todo button{height:26px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font-family:inherit;font-size:12.5px}`,
    ops: [after(`(box) => {
      box.querySelector('.wl-sum').insertAdjacentHTML('beforebegin', '<div class="px-todo"><b>直すことが 2 つあります</b>'
        + '<div><span class="m-chip c-off">見つからない</span>SL3: 実績_SL3.sqlite3 がフォルダにありません<button>結ぶファイルを選ぶ</button></div>'
        + '<div><span class="m-chip c-warn">古い</span>HOT: 80 時間、更新されていません（元のアプリが止まっていないか確かめてください）</div></div>');
    }`)],
  },
  {
    key: "F", name: "左にフォルダと探す・右に設備の表（置き場を分ける）",
    css: `.wl-page{display:grid;grid-template-columns:320px minmax(0,1fr);gap:12px;align-items:start}
      .wl-src{grid-column:1;grid-row:1 / span 4;grid-template-columns:1fr}
      .wl-src .btn-primary{justify-self:stretch}
      .wl-page > *:not(.wl-src){grid-column:2}`,
    ops: [],
  },
  {
    key: "G", name: "ほかのマスタと同じ「表＋右の詳細」（押した設備を右で直す）",
    css: `.wl-page{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:start}
      .wl-page > *{grid-column:1}.px-detail{grid-column:2;grid-row:1 / span 5;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);display:grid;gap:10px;font-size:13px}
      .px-detail h4{margin:0;font-size:15px}.px-detail label{display:grid;gap:3px;color:var(--muted);font-size:12px;font-weight:700}
      .px-detail input{height:30px;border:1px solid var(--edit-line);border-radius:6px;padding:0 8px;font-family:inherit}
      .wl-tablelist td:nth-child(5),.wl-tablelist th:nth-child(5),.wl-tablelist td:nth-child(6),.wl-tablelist th:nth-child(6),.wl-tablelist td:nth-child(7){display:none}
      .wl-tablelist tbody tr:first-child td{background:var(--input-soft)}`,
    ops: [after(`(box) => {
      box.querySelector('.wl-page').insertAdjacentHTML('beforeend', '<aside class="px-detail"><h4>ANF</h4><label>設備名<input value="ANF"></label>'
        + '<label>ファイル<input value="実績_ANF.sqlite3" readonly></label><label>表（空なら自動）<input placeholder="自動"></label>'
        + '<label>表示<span>作業実績のタブで選べる</span></label><div><button class="btn-primary">保存</button></div></aside>');
    }`)],
  },
];
