// 2026-10 推奨の札を付けるときに表がはみ出す（版 3.38.0。利用者の要望 3）。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recask.mjs --states master-release-recask
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recask.mjs --states master-release-recask --view 1280x720
// 今（画像 master-release-recask）: 「推奨にする…」を押すと、表の最後の列（ボタンの列）に 22em の理由の欄と 2 つのボタンが入る。
//   1280×720 では「推奨にする」「やめる」が表の右端で切れ（表の枠の中で横に送らないと押せない）、1728 でも欄が狭く、書いた理由の頭が見えない。
// 案の方向（置き場・見せ方・流れ）:
//   A 行の下に広げる（置き場: 表の中の 1 行。幅いっぱいの欄）
//   B ② 配る版の札の中で書く（置き場: 流れの札。推奨の札と理由が出る所で書く）
//   C 列の中で折り返す（減らし方: 置き場は今のまま。欄を縮め、ボタンを欄の下へ）
//   D 行の下に、各 PC に出る知らせの見本つき（見せ方: 書いている理由が、一覧の面の帯でどう見えるかをその場で見せる）
//   E ボタンの下に浮かぶ小さな面（置き場: ポップオーバー。表の形は変えない）
//   F 表の上の帯で書く（流れの変え方: 配っている版への操作として表の上に 1 段）

const base = `
.rv-row td{padding:0 12px 12px !important;background:var(--surface-2,#f6f8fb);border-top:0 !important}
.rv-box{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:8px;background:var(--surface)}
.rv-box > b{flex:none;color:var(--h-input);font-size:13.5px;white-space:nowrap}
.rv-box .dz-rec-ask{display:flex;flex:1 1 auto;min-width:0;gap:8px}
.rv-box .dz-rec-ask .ps-input{flex:1 1 auto;width:auto;min-width:0}
.rv-box .dz-rec-ask .pz-btn{flex:none;white-space:nowrap}
.rv-wait{color:var(--muted);font-size:12.5px;white-space:nowrap}
`;
/** 「推奨にする…」を押して出た理由の欄（.dz-rec-ask）を、出るたびに案の置き場へ移す（画面は描き直すので見張る） */
const watch = (move) => ["script", `{ const run = () => { document.querySelectorAll('.dz-rec-ask:not([data-rv])').forEach((ask) => { ask.dataset.rv = '1'; (${move})(ask); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`];

/** 行の下に 1 行足して、そこへ欄を移す（A・D 共通） */
const underRow = (preview) => `(ask) => {
  const td = ask.closest('td'), tr = td.closest('tr'), ver = tr.querySelector('.pz-ver').textContent;
  const row = document.createElement('tr'); row.className = 'rv-row';
  row.innerHTML = '<td colspan="6"><div class="rv-box"><b>' + ver + ' を推奨にする理由</b></div>${preview ? `<div class="rv-pv"><small>各 PC の一覧の上に、こう出ます</small><div class="rec-band"><em class="rec-ic" aria-hidden="true">↻</em><b>推奨アップデート ' + ver + '</b><span class="rec-note"></span><span class="rec-sp"></span><button type="button" class="btn-ghost" tabindex="-1">あとで</button><button type="button" class="btn-primary" tabindex="-1">更新して開き直す</button></div></div>` : ""}</td>';
  tr.after(row); row.querySelector('.rv-box').append(ask);
  td.innerHTML = '<span class="rv-wait">↓ 下の欄で理由を書きます</span>';
  const inp = ask.querySelector('input'); inp.style.width = ''; inp.focus();
  ${preview ? "const note = row.querySelector('.rec-note'); const sync = () => { note.textContent = inp.value || '（理由を書くと、ここに出ます）'; note.style.opacity = inp.value ? 1 : .6; }; inp.addEventListener('input', sync); sync();" : ""}
}`;

export const PROPOSALS = [
  { key: "R0", name: "今（表の最後の列に欄とボタン）", css: "", ops: [] },
  {
    key: "A", name: "行の下に広げる（幅いっぱいの欄・ボタンは欄の右）",
    css: base,
    ops: [watch(underRow(false))],
  },
  {
    key: "B", name: "② 配る版の札の中で書く（推奨の札と理由が出る所）",
    css: base + `
.dz-step .rv-card{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.dz-step .rv-card > small{color:var(--h-input)}
.dz-step .rv-card .dz-rec-ask{display:flex;gap:6px;flex-wrap:wrap}
.dz-step .rv-card .dz-rec-ask .ps-input{flex:1 1 100%;width:auto;min-width:0}
.dz-step .rv-card .dz-rec-ask .pz-btn{flex:none}
.dz-step.rv-on{border-color:var(--h-input);box-shadow:0 0 0 2px color-mix(in srgb,var(--h-input) 20%,transparent)}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'); const step = document.querySelectorAll('.dz-step')[1];
      const box = document.createElement('div'); box.className = 'rv-card'; box.innerHTML = '<small>推奨の理由（各 PC の知らせに出ます）</small>';
      box.append(ask); step.append(box); step.classList.add('rv-on');
      td.innerHTML = '<span class="rv-wait">↑ ② の札で理由を書きます</span>';
      ask.querySelector('input').focus();
    }`)],
  },
  {
    key: "C", name: "列の中で折り返す（欄を縮め、ボタンを欄の下へ）",
    css: `
.pz-acts .dz-rec-ask{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;width:100%;max-width:26em;margin-left:auto}
.pz-acts .dz-rec-ask .ps-input{flex:1 1 100%;width:auto;min-width:0}
.pz-acts .dz-rec-ask .pz-btn{flex:none}`,
    ops: [],
  },
  {
    key: "D", name: "行の下に広げ、各 PC に出る知らせの見本を並べる",
    css: base + `
.rv-pv{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.rv-pv > small{color:var(--muted);font-size:12px}
.rv-pv .rec-band{margin:0;pointer-events:none}`,
    ops: [watch(underRow(true))],
  },
  {
    key: "E", name: "ボタンの下に浮かぶ小さな面（表の形は変えない）",
    css: `
.rv-pop{position:fixed;z-index:60;width:min(520px,calc(100vw - 32px));padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 10px 30px rgba(20,35,55,.22)}
.rv-pop > b{display:block;margin-bottom:8px;color:var(--h-input);font-size:13.5px}
.rv-pop .dz-rec-ask{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.rv-pop .dz-rec-ask .ps-input{flex:1 1 100%;width:auto}
.rv-pop::before{content:"";position:absolute;top:-7px;right:40px;width:12px;height:12px;background:var(--surface);border-left:1px solid var(--line);border-top:1px solid var(--line);transform:rotate(45deg)}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), r = td.getBoundingClientRect(), ver = td.closest('tr').querySelector('.pz-ver').textContent;
      td.innerHTML = '<button type="button" class="pz-btn is-on" aria-expanded="true">推奨にする…</button>';
      const pop = document.createElement('div'); pop.className = 'rv-pop'; pop.innerHTML = '<b>' + ver + ' を推奨にする理由</b>';
      pop.append(ask); document.body.append(pop);
      const b = td.querySelector('button').getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.left = Math.max(16, Math.min(innerWidth - w - 16, b.right - w + 24)) + 'px'; pop.style.top = (b.bottom + 10) + 'px';
      ask.querySelector('input').focus();
    }`)],
  },
  {
    key: "F", name: "表の上の帯で書く（配っている版への操作として 1 段）",
    css: base + `.dz-put + .rv-band{margin:0 0 10px}`,
    ops: [watch(`(ask) => {
      const td = ask.closest('td'), ver = td.closest('tr').querySelector('.pz-ver').textContent;
      const band = document.createElement('div'); band.className = 'rv-band';
      band.innerHTML = '<div class="rv-box"><b>配っている版 ' + ver + ' を推奨にする</b></div>';
      band.firstChild.append(ask); document.querySelector('.pz-wrap').before(band);
      td.innerHTML = '<span class="rv-wait">↑ 表の上で理由を書きます</span>';
      ask.querySelector('input').focus();
    }`)],
  },
];
