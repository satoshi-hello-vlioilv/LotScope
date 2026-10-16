// 2026-10 推奨の札を付けるときに表がはみ出す（版 3.38.0。利用者の要望 3）。3 回目（合格点 80 点。最後の回）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recask-3.mjs --states master-release-recask
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recask-3.mjs --states master-release-recask --view 1280x720
// 2 回目（2026-10-recask-2.mjs）の 1 位は P「知らせの形のまま書く」82.4 点・2 位 A2 81.6 点・G「その行の中で書く」77.6 点（合格点 90 に届かず）。
// 採点者の指摘:
//   ①P・A2・F2・N は行が増える分、1280 で 3.11.0 の行が窓の下へ押し出される（−3）。押し出さないのは G だけ
//   ②G は 1280 で「やめる」が表の右の枠に接して右の縁が欠ける（−5）→ 右の余白を 12px 足す
//   ③G は書いている間、置いた日時・ZIP・大きさが消え、列の見出しと中身が合わない
//   ④G の「押し出さない」に P の「各 PC に出る帯の形の見本」を合わせる ⑤P・A2 を残すなら、開いたときに 3.11.0 の行を窓に見せるか 1 段に抑える
//   ⑥N は理由を書く前に配られてしまい順が逆 → 外す
// 新しい案（3 つ）:
//   Q 右の 3 つの欄（元の ZIP・大きさ・操作）だけを 1 つにまとめ、帯の形の欄にする（置いた日時は残る。行は増えない・右の余白 12px）
//   G2 G に P の帯の形を合わせる（置いた日時〜操作の 4 つの欄を 1 つにまとめた帯。行は増えない・右の余白 12px・日時は帯の中に小さく残す）
//   Y 行そのものを帯に（版の欄から右を淡い藍の帯にして、その中で書く。版と「配っている」は残る・行は増えない）
// 持ち越し（直した）: P2（P を 1 段の帯＋手がかりの 1 行にし、開いたら 3.11.0 の行まで見せる）・A3（A2 の見本と手がかりを欄と同じ 1 段に詰め、開いたら 3.11.0 まで見せる）

const base = `
.rv-on > td{background:var(--input-soft) !important}
.rv-band{display:flex;align-items:center;gap:8px;min-width:0;height:34px;padding:0 6px 0 10px;border:1px solid #c5d4e6;border-radius:8px;background:#fff;margin-right:12px}
.rv-band .rec-ic{flex:none;width:18px;height:18px;border-radius:50%;background:var(--h-input);color:#fff;font:700 12px/18px sans-serif;text-align:center;font-style:normal}
.rv-band > b{flex:none;color:var(--h-input);font-size:13px;white-space:nowrap}
.rv-band .dz-rec-ask{display:flex;flex:1 1 auto;min-width:0;gap:6px}
.rv-band .dz-rec-ask .ps-input{flex:1 1 auto;width:auto;min-width:0;height:26px}
.rv-band .dz-rec-ask .pz-btn{flex:none;white-space:nowrap;height:26px}
.rv-band small{flex:none;color:var(--muted);font-size:11.5px;white-space:nowrap}
.rv-row > td{padding:0 12px 8px !important;background:var(--input-soft) !important;border-top:0 !important}
.rv-cap{display:block;margin-top:3px;font-size:12px;color:var(--muted)}
.rv-wait{color:var(--h-input);font-size:12.5px;white-space:nowrap;font-weight:700}
`;
const watch = (move) => ["script", `{ const run = () => { document.querySelectorAll('.dz-rec-ask:not([data-rv])').forEach((ask) => { ask.dataset.rv = '1'; (${move})(ask); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];
const band = (ver, extra = "") => `'<div class="rv-band" title="Enter で推奨にする・Esc でやめる"><em class="rec-ic" aria-hidden="true">↻</em><b>推奨アップデート ' + ${ver} + '</b>${extra}</div>'`;
const seeNext = "setTimeout(() => { const n = tr.parentElement.lastElementChild; n && n.scrollIntoView({ block: 'nearest' }); }, 0);";

export const PROPOSALS = [
  {
    key: "Q", name: "右の 3 つの欄だけを帯の形の欄に（置いた日時は残る・行は増えない）", css: base,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-on'); [...tr.children].slice(3, 5).forEach((c) => c.remove()); td.colSpan = 3;
      td.innerHTML = ${band("ver")}; td.querySelector('.rv-band').append(ask); ask.querySelector('input').focus();
    }`)],
  },
  {
    key: "G2", name: "4 つの欄を 1 つの帯に（日時は帯の中に小さく・行は増えない）", css: base,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent, when = tr.children[2].textContent.trim().split(' ').slice(0, 2).join(' ');
      tr.classList.add('rv-on'); [...tr.children].slice(2, 5).forEach((c) => c.remove()); td.colSpan = 4;
      td.innerHTML = ${band("ver", "<small>' + when + ' に置いた版</small>")}; td.querySelector('.rv-band').append(ask); ask.querySelector('input').focus();
    }`)],
  },
  {
    key: "Y", name: "行そのものを帯に（版と「配っている」は残る・行は増えない）",
    css: base + `
.rv-y > td{background:#eef3fa !important;border-top:1px solid #c5d4e6;border-bottom:1px solid #c5d4e6}
.rv-y > td:first-child{box-shadow:inset 4px 0 0 var(--h-input)}
.rv-y .rv-band{border:0;background:transparent;padding:0;height:32px}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-y'); [...tr.children].slice(2, 5).forEach((c) => c.remove()); td.colSpan = 4;
      td.innerHTML = ${band("ver", "<small>Enter 推奨にする・Esc やめる</small>")}; td.querySelector('.rv-band').append(ask); ask.querySelector('input').focus();
    }`)],
  },
  {
    key: "P2", name: "知らせの帯の形で書く（行の下に 1 段・手がかり 1 行・3.11.0 まで見せる）", css: base,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
      tr.classList.add('rv-on');
      const row = document.createElement('tr'); row.className = 'rv-row';
      row.innerHTML = '<td colspan="6">' + ${band("ver")} + '<small class="rv-cap">各 PC の一覧の上に、この帯で出ます（Enter 推奨にする・Esc やめる）</small></td>';
      tr.after(row); row.querySelector('.rv-band').append(ask);
      td.innerHTML = '<span class="rv-wait">↓ 帯に理由を書く</span>';
      ask.querySelector('input').focus(); ${seeNext}
    }`)],
  },
  {
    key: "A3", name: "行の下に 1 段の欄（見本と手がかりは欄の右に詰める・3.11.0 まで見せる）",
    css: base + `.rv-row .rv-line{display:flex;align-items:center;gap:8px}.rv-row .rv-line > b{flex:none;color:var(--h-input);font-size:13px}
.rv-row .rv-line .dz-rec-ask{display:flex;flex:1 1 auto;min-width:0;gap:6px}.rv-row .rv-line .ps-input{flex:1 1 auto;width:auto;min-width:0;height:28px}
.rv-row .rv-line small{flex:none;color:var(--muted);font-size:11.5px;white-space:nowrap}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), tr = td.closest('tr');
      tr.classList.add('rv-on');
      const row = document.createElement('tr'); row.className = 'rv-row';
      row.innerHTML = '<td colspan="6"><div class="rv-line"><b>推奨の理由</b><small>Enter 推奨にする・Esc やめる</small></div></td>';
      tr.after(row); row.querySelector('.rv-line b').after(ask);
      td.innerHTML = '<span class="rv-wait">↓ 理由を書く</span>';
      ask.querySelector('input').focus(); ${seeNext}
    }`)],
  },
];
