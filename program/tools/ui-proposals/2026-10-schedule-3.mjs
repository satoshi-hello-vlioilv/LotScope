// 2026-10「スケジュール」のタブの数の札・HOT の札と図の 3 回目（2 回目 2026-10-schedule-2.mjs は 1 位 T2 73.8 点で合格点に届かず）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-schedule-3.mjs --from sch --states sch,sch-hot
// 2 回目の採点で効いた所: T2 の「主の数（製造件数）を最初に・区分の札（色が行と同じ・押して絞る）・右に時刻」。
// 足りなかった所: HOT の抜き出し方が 1 行で切れる（−5）・設備と HOT で形がそろわない（統一感）・帯の釜番が色だけ（作りで直した: 帯の上の段に字）・HOT の段が重い。
// 持ち越し 1 案（U1 = T2＋HOT をそろえる）＋新しい 4 案（U2 2 段・U3 次の停止を札に・U4 HOT は図の左に設備・U5 札の型で強弱）。
// 今の札の中身 → {名前: {v: 値の HTML, s: 下の字, el}}
const READ = `
  const C = {};
  document.querySelectorAll('#llSched .sd-card').forEach((c) => { const l = (c.querySelector('.sd-label') || {}).textContent || '';
    C[l.trim()] = { v: (c.querySelector('.sd-value') || {}).innerHTML || '', s: (c.querySelector('.sd-sub') || {}).textContent || '', el: c, t: (c.querySelector('.sd-rule') || {}).innerHTML || '' }; });
  const box = document.querySelector('#llSched'), mode = box.dataset.mode;
  const pick = (k) => Object.keys(C).find((x) => x.startsWith(k)) || '';`;

// 札が描かれるたび（設備を替えた・取り直した）に組み替える（案は頁を開いたときに当たるので、札の中身を見張る）
const WATCH = (body) => `
  const run = () => { const box = document.querySelector('#llSched');
    if (!box || box.hidden || !box.querySelector('.sd-card') || box.querySelector('.sx-done')) return;
    obs.disconnect();
    setTimeout(() => { try { document.querySelectorAll('.sx-sumline').forEach((x) => x.remove()); ${body.replace(/`/g, "\`").replace(/\$\{/g, "\${")} } finally {
      box.insertAdjacentHTML('beforeend', '<i class="sx-done" hidden></i>'); obs.observe(box, { childList: true, subtree: true }); } }, 400); };
  const obs = new MutationObserver(run);
  const start = () => { const box = document.querySelector('#llSched'); if (box) { obs.observe(box, { childList: true, subtree: true, attributes: true }); run(); } };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', start) : start();`;

const COMPACT = `
  .sd-strip{padding:6px 16px;gap:6px}
  .sd-strip[data-mode="line"]{flex-wrap:nowrap;align-items:stretch}
  .sd-card{flex-direction:row;align-items:baseline;gap:8px;min-width:0;padding:4px 12px}
  .sd-card.is-wide{min-width:0}
  .sd-value{font-size:var(--fs-lg)}
  .sd-cards{flex-wrap:nowrap}
  .sd-eqcard{flex-direction:column;align-items:flex-start;gap:0;border-top-width:3px}
  .sd-card.is-lead{flex-direction:column;align-items:flex-start;gap:0}
  .sd-card.is-info{flex:1 1 0;min-width:0;flex-direction:column;gap:0}
  .sd-card.is-info .sd-rule{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--fs-xs)}`;


// 2 回目の共通: S1 の 1 段の帯＋HOT の設備の札を中身の幅の小さな札に（0 本は淡く）
const BAND = COMPACT + `
  .sd-strip[data-mode="hot"] .sd-eqcard{flex:0 0 auto;flex-direction:row;align-items:baseline;gap:8px;border-top-width:1px;border-left:4px solid var(--eqc);padding:4px 12px}
  .sd-strip[data-mode="hot"] .sd-eqcard .sd-sub{font-size:var(--fs-xs)}
  .sd-strip[data-mode="hot"] .sd-card.is-lead{flex:0 0 auto}
  .sd-strip[data-mode="hot"] .sd-card.is-info .sd-rule{-webkit-line-clamp:1}`;
// 区分の札（S6 の持ち越し。押すとその区分の行だけ。色は一覧の行の色と同じ）
const CHIPS = `
  .ux-chips{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;flex:1 1 auto}
  .ux-chips .sd-kchip b{font-size:var(--fs-md)}
  .ux-chips .k-stop{border-color:#e6bcb6;background:var(--sd-stop-bg);color:var(--sd-stop-ink)}
  .ux-chips .k-insp{border-color:#ecd29a;background:var(--sd-insp-bg);color:var(--sd-insp-ink)}
  .ux-chips .k-miss{border-style:dashed}
  .ux-meta{margin-left:auto;font-size:var(--fs-sm);color:var(--muted);white-space:nowrap}
  .ux-meta b{color:var(--ink);font-variant-numeric:tabular-nums}
  .ux-lead{display:flex;align-items:baseline;gap:6px;padding-right:8px;margin-right:4px;border-right:1px solid var(--line);white-space:nowrap}
  .ux-lead b{font-size:var(--fs-xl);font-weight:800}
  .ux-lead span{font-size:var(--fs-sm);color:var(--muted)}`;
const G = `const g = (k) => ((C[pick(k)] || {}).v || '-').replace(/<[^>]+>/g, '');
  const hm = g('仕掛と一致').match(/(\\d+)\\s*\\/\\s*(\\d+)/), miss = hm ? hm[2] - hm[1] : '-';
  const upd = g('CM3 の更新'), [u1, u2] = upd.split('・').map((x) => x.trim());`;
const CHIPROW = (lead) => G + `
  box.querySelectorAll(':scope > .sd-card').forEach((c) => c.style.display = 'none');
  box.insertAdjacentHTML('afterbegin', '<div class="ux-chips">' + ${lead} + '<span class="sd-klab">区分</span><button class="sd-kchip is-on">すべて</button><button class="sd-kchip k-insp">点検 <b>' + g('点検') + '</b></button><button class="sd-kchip k-stop">設備停止 <b>' + g('設備停止') + '</b></button><button class="sd-kchip k-miss">仕掛に無い <b>' + miss + '</b></button><span class="ux-meta">完了予定 <b>' + g('完了予定') + '</b>　CM3 の更新 <b>' + (u1 || '-') + '</b>・取得 <b>' + (u2 || '-') + '</b></span></div>');`;

// HOT も設備と同じ形にそろえる: 主の数（対象 n 本）＋押して絞る丸い札（設備。0 本は淡く）＋右に完了予定の範囲。抜き出し方は切らずに全文（2 行まで折り返す）
const HOTROW = `
  .ux-hotrule{margin:0;font-size:var(--fs-sm);color:var(--muted);line-height:1.5}
  .sd-strip[data-mode="hot"] .sd-cards{display:none}
  .ux-chips .k-eq{border-left:4px solid var(--eqc)}
  .ux-chips .k-eq.is-empty{opacity:.55}`;
const HOTJS = `
  const lead = C[pick('対象ロット')] || {};
  const eqs = Object.keys(C).filter((k) => /^L-/.test(k));
  box.insertAdjacentHTML('afterbegin', '<div class="ux-chips"><span class="ux-lead"><b>' + lead.v.replace(/<[^>]+>/g, '').replace(/\\s*\\/.*/, '') + '</b><span>本 対象（前工程 HOT）</span></span><span class="sd-klab">設備</span><button class="sd-kchip is-on">すべて</button>'
    + eqs.map((e) => { const n = C[e].v.replace(/<[^>]+>/g, '').trim(); return '<button class="sd-kchip k-eq' + (/^0/.test(n) ? ' is-empty' : '') + '" style="--eqc:' + (C[e].el.style.getPropertyValue('--eqc')) + '">' + e + ' <b>' + n + '</b></button>'; }).join('')
    + '<span class="ux-meta">完了予定 <b>' + lead.s + '</b></span></div>');
  const rule = (C['抜き出し方'] || {}).t || '';
  box.querySelector('.ux-chips').insertAdjacentHTML('afterend', '<p class="ux-hotrule">抜き出し方: ' + rule + '</p>');`;
const LEAD = `'<span class="ux-lead"><b>' + g('製造件数') + '</b><span>件 製造・ロット ' + g('ロット数') + '</span></span>'`;

// 帯の段の高さは今の形のまま（帯の上の段に釜番の字を出すので、COMPACT の詰めた高さを戻す）
const LANES = `.sd-lane{height:50px}.sd-track{height:22px}.sd-blk{line-height:18px}`;

export const PROPOSALS = [
  { key: "U0", name: "今の形（2 回目の後、帯に入らない釜番の字を帯の上の段に出す形にした）", css: "", ops: [] },
  {
    key: "U1", name: "設備も HOT も「主の数＋押して絞る丸い札＋右に時刻」にそろえる（2 回目の T2 を持ち越し・HOT を同じ形に）",
    css: LANES + BAND + CHIPS + HOTROW, ops: [["script", WATCH(READ + `if (mode === 'line') {` + CHIPROW(LEAD) + `} else {` + HOTJS + `}`)]],
  },
  {
    key: "U2", name: "U1 を 2 段に（1 段目: 主の数と札、2 段目: 完了予定・CM3 の時刻を小さく左寄せ。狭い窓でも詰めない）",
    css: LANES + BAND + CHIPS + HOTROW + `
  .ux-chips{flex-wrap:wrap;row-gap:4px}
  .ux-meta{margin-left:0;flex:1 1 100%;font-size:var(--fs-xs)}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') {` + CHIPROW(LEAD) + `} else {` + HOTJS + `}`)]],
  },
  {
    key: "U3", name: "U1＋設備停止の札に「次 12:05」（次にいつ止まるかを札の中で先回り）",
    css: LANES + BAND + CHIPS + HOTROW + `.ux-chips .k-stop small{color:var(--sd-stop-ink);margin-left:2px}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') {` + CHIPROW(LEAD) + `
  const head = [...document.querySelectorAll('#llHead tr:first-child th')].map((t) => t.textContent.replace('⠿', '').trim());
  const tr = document.querySelector('#llBody tr.sd-stop');
  if (tr) { const t = tr.children[head.indexOf('完了予定')].textContent.trim().slice(6); box.querySelector('.ux-chips .k-stop').insertAdjacentHTML('beforeend', '<small>次 ' + t + '</small>'); }
  } else {` + HOTJS + `}`)]],
  },
  {
    key: "U4", name: "HOT は図の左に設備と本数・範囲（札の段の代わり）、上は主の数と抜き出し方の全文。設備は U1",
    css: LANES + BAND + CHIPS + `
  .sd-strip[data-mode="hot"] .sd-cards{display:none}
  .sd-ln{flex-basis:132px;display:flex;flex-direction:column;justify-content:flex-end;line-height:1.25;padding-bottom:2px;align-self:flex-end}
  .sd-ln span{white-space:nowrap}
  .sd-ln small{font-size:var(--fs-xs);color:var(--muted);font-weight:500}
  .sd-ln b{font-size:var(--fs-sm)}
  .sd-axis{margin-left:132px}
  .ux-hothead{display:flex;align-items:baseline;gap:12px}
  .ux-hothead p{margin:0;font-size:var(--fs-sm);color:var(--muted);line-height:1.5}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') {` + CHIPROW(LEAD) + `} else {
  document.querySelectorAll('#llSched .sd-lane').forEach((ln) => { const n = ln.querySelector('.sd-ln'), eq = n.textContent.trim(), c = C[eq]; if (c) n.innerHTML = '<span>' + n.innerHTML + ' <b>' + c.v.replace(/<[^>]+>/g, '') + '</b></span><small>' + (c.s === '予定なし' ? '予定なし' : c.s.replace(' ～ ', '～')) + '</small>'; });
  const lead = C[pick('対象ロット')] || {};
  box.insertAdjacentHTML('afterbegin', '<div class="ux-hothead"><span class="ux-lead"><b>' + lead.v.replace(/<[^>]+>/g, '').replace(/\\s*\\/.*/, '') + '</b><span>本 対象・' + lead.s + '</span></span><p>抜き出し方: ' + ((C['抜き出し方'] || {}).t || '') + '</p></div>');
  }`)]],
  },
  {
    key: "U5", name: "札の型のまま強弱を付ける（主の札を大きく・設備停止は赤・点検は黄の地・仕掛に無いは点線。HOT も同じ札）",
    css: LANES + BAND + `
  .sd-strip > .sd-card:first-child, .sd-card.is-lead{border-color:var(--h-input);box-shadow:inset 3px 0 0 var(--h-input)}
  .sd-strip > .sd-card:first-child .sd-value{font-size:var(--fs-xl)}
  .sd-card.is-stop{background:var(--sd-stop-bg);border-color:#e6bcb6}
  .sd-card.is-inspect{background:var(--sd-insp-bg);border-color:#ecd29a}
  .sd-card.ux-miss{border-style:dashed}
  .sd-strip[data-mode="hot"] .sd-card.is-info{display:none}
  .ux-hotrule{margin:0;font-size:var(--fs-sm);color:var(--muted);line-height:1.5}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') { const c = C[pick('仕掛と一致')]; if (c) { c.el.classList.add('ux-miss'); } } else {
  box.querySelector('.sd-cards').insertAdjacentHTML('afterend', '<p class="ux-hotrule">抜き出し方: ' + ((C['抜き出し方'] || {}).t || '') + '</p>'); }`)]],
  },
];
