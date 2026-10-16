// 2026-10 推奨の札を付けるときに表がはみ出す（版 3.38.0。利用者の要望 3）。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recask-2.mjs --states master-release-recask
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recask-2.mjs --states master-release-recask --view 1280x720
// 1 回目（2026-10-recask.mjs・.json）の 1 位は A「行の下に広げる」77.2 点・2 位 F「表の上の帯」73.8 点。採点者が挙げた直す所:
//   ①1280 で、広げた行の分だけ 3.11.0 の行が窓の下へ押し出される（要らないスクロール −3）
//   ②書いた理由が各 PC でどう出るかが見えない（D の見本はボタンまで描いて主ボタンが 2 つに見えた）→ 灰色の 1 行の見本に
//   ③押した行と欄がひとまとまりに見えない → 同じ地でつなぐ ④左の青い縁が「新しい PC へ」の緑の縁と同じ形で色だけ違う
//   ⑤Enter で推奨にする・Esc でやめる の手がかりが無い
// 持ち越し（直した）: A2（A に ①〜⑤）・F2（F に ②〜⑤）
// 新しい案（3 つ）:
//   G その行の中で書く（置き場: 押した行の「置いた日時〜操作」の 4 つの欄を 1 つにまとめて欄とボタンを置く。行は増えない＝押し出さない）
//   P 知らせの形のまま書く（見せ方: 各 PC に出る帯〈↻ 推奨アップデート 3.12.0 ＋理由〉の形の中に欄を置く。書いた物がそのまま見え方）
//   N 先に付けて理由は後から（流れ: 「推奨にする」で札がすぐ付き、② の下の 1 段で理由を書き足す〈空なら各 PC には版だけ〉）

const NOTE_HINT = "Enter で推奨にする・Esc でやめる";
const base = `
.rv-on > td{background:var(--input-soft) !important}
.rv-row > td{padding:0 12px 8px !important;background:var(--input-soft) !important;border-top:0 !important}
.rv-box{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}
.rv-box > b{flex:none;color:var(--h-input);font-size:13px;white-space:nowrap}
.rv-box .dz-rec-ask{display:flex;flex:1 1 auto;min-width:0;gap:8px}
.rv-box .dz-rec-ask .ps-input{flex:1 1 auto;width:auto;min-width:0;height:30px}
.rv-box .dz-rec-ask .pz-btn{flex:none;white-space:nowrap}
.rv-sub{display:flex;gap:12px;align-items:baseline;margin-top:4px;font-size:12px;color:var(--muted);min-width:0}
.rv-sub .rv-pv{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-sub .rv-pv b{color:var(--h-input);font-weight:700}
.rv-sub kbd{font:inherit;padding:0 4px;border:1px solid var(--line);border-radius:4px;background:var(--surface)}
.rv-wait{color:var(--h-input);font-size:12.5px;white-space:nowrap;font-weight:700}
`;
const watch = (move) => ["script", `{ const run = () => { document.querySelectorAll('.dz-rec-ask:not([data-rv])').forEach((ask) => { ask.dataset.rv = '1'; (${move})(ask); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];
/** 灰色の 1 行の見本（各 PC の一覧の上に出る字）と、キーの手がかり */
const sub = (ver) => `'<div class="rv-sub"><span class="rv-pv">各 PC の知らせ: <b>↻ 推奨アップデート ' + ${ver} + '</b>　<span class="rv-note"></span></span><span><kbd>Enter</kbd> 推奨にする・<kbd>Esc</kbd> やめる</span></div>'`;
const syncNote = "const inp = ask.querySelector('input'), note = box.querySelector('.rv-note'); const sync = () => { note.textContent = inp.value || '（理由を書くと、ここに出ます）'; }; inp.addEventListener('input', sync); sync(); inp.focus();";

export const PROPOSALS = [
  {
    key: "A2", name: "行の下に広げる（同じ地でつなぐ・見本の 1 行・キーの手がかり・詰める）", css: base,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-on');
      const row = document.createElement('tr'); row.className = 'rv-row';
      row.innerHTML = '<td colspan="6"><div class="rv-box"><b>推奨の理由</b></div>' + ${sub("ver")} + '</td>';
      tr.after(row); const box = row; row.querySelector('.rv-box').append(ask);
      td.innerHTML = '<span class="rv-wait">↓ 理由を書く</span>';
      ${syncNote}
    }`)],
  },
  {
    key: "F2", name: "表の上の帯で書く（見本の 1 行・キーの手がかり）",
    css: base + `.rv-band{margin:0 0 8px;padding:8px 12px;border:1px solid #c5d4e6;border-radius:8px;background:var(--input-soft)}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-on');
      const box = document.createElement('div'); box.className = 'rv-band';
      box.innerHTML = '<div class="rv-box"><b>配っている版 ' + ver + ' を推奨にする理由</b></div>' + ${sub("ver")};
      box.querySelector('.rv-box').append(ask); document.querySelector('.pz-wrap').before(box);
      td.innerHTML = '<span class="rv-wait">↑ 理由を書く</span>';
      ${syncNote}
    }`)],
  },
  {
    key: "G", name: "その行の中で書く（4 つの欄を 1 つにまとめる・行は増えない）", css: base + `.rv-cell{padding-top:6px !important;padding-bottom:6px !important}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-on');
      const cells = [...tr.children]; cells.slice(2, 5).forEach((c) => c.remove());
      td.colSpan = 4; td.className = 'rv-cell';
      const box = td; td.innerHTML = '<div class="rv-box"><b>推奨の理由</b></div>' + ${sub("ver")};
      td.querySelector('.rv-box').append(ask);
      ${syncNote}
    }`)],
  },
  {
    key: "P", name: "知らせの形のまま書く（各 PC に出る帯の中に欄）",
    css: base + `
.rv-row .rec-band{margin:0;height:auto;min-height:38px;padding:4px 6px 4px 10px;gap:8px}
.rv-row .rec-band .dz-rec-ask{display:flex;flex:1 1 auto;min-width:0;gap:8px}
.rv-row .rec-band .ps-input{flex:1 1 auto;width:auto;min-width:0;height:28px;background:#fff}
.rv-row .rv-cap{display:block;margin:2px 0 0 2px;font-size:12px;color:var(--muted)}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-on');
      const row = document.createElement('tr'); row.className = 'rv-row';
      row.innerHTML = '<td colspan="6"><div class="rec-band"><em class="rec-ic" aria-hidden="true">↻</em><b>推奨アップデート ' + ver + '</b></div><small class="rv-cap">各 PC の一覧の上に、この帯で出ます（理由を書いて「推奨にする」。<kbd>Enter</kbd> 推奨にする・<kbd>Esc</kbd> やめる）</small></td>';
      tr.after(row); row.querySelector('.rec-band').append(ask);
      td.innerHTML = '<span class="rv-wait">↓ 帯に理由を書く</span>';
      ask.querySelector('input').focus();
    }`)],
  },
  {
    key: "N", name: "先に付けて理由は後から（② の下の 1 段で書き足す）",
    css: base + `
.rv-after{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:6px 12px;border:1px solid #c5d4e6;border-radius:8px;background:var(--input-soft);font-size:13px}
.rv-after > b{color:var(--h-input);white-space:nowrap}
.rv-after .ps-input{flex:1 1 auto;min-width:0;height:30px}
.rv-after .pz-btn{flex:none;white-space:nowrap}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.children[1].insertAdjacentHTML('beforeend', '<span class="m-chip c-rec">↻ 推奨</span>');
      td.innerHTML = '<button type="button" class="pz-btn">推奨を外す</button>';
      const step = document.querySelectorAll('.dz-step')[1];
      step.querySelector('span').insertAdjacentHTML('beforeend', '<span class="m-chip c-rec">↻ 推奨アップデート</span>');
      const box = document.createElement('div'); box.className = 'rv-after';
      box.innerHTML = '<b>✓ ' + ver + ' を推奨にしました。理由を添える</b><input class="ps-input" value="' + ask.querySelector('input').value + '" placeholder="（空なら各 PC には版だけ出ます）"><button type="button" class="pz-btn dz-go">理由を保存</button>';
      document.querySelector('.dz-flow').after(box);
    }`)],
  },
];
