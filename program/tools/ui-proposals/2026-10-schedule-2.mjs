// 2026-10「スケジュール」のタブの数の札・HOT の札と図の置き方の 2 回目（1 回目 2026-10-schedule.mjs は 1 位 S1 69.6 点で合格点に届かず）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-schedule-2.mjs --from sch --states sch,sch-hot
// 1 回目の採点で効いた所: S1 の 1 段の帯（一覧が広い）・S6 の押して絞る区分の札（色が行の色と同じ・「仕掛に無い」が直に分かる）。
// 足りなかった所: 最初に見る物が無い（階層化・視覚化）・HOT の札が重い・帯の釜番の字が切れる（作りで直した）・1280 で除いた数の知らせが消える（作りで直した）。
// 持ち越し 2 案（T1・T2）＋新しい 4 案（T3 先回り・T4 割合の帯・T5 HOT は図を主に・T6 件数の行へ）。
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
  .sd-card.is-info .sd-rule{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--fs-xs)}
  .sd-lane{height:22px}.sd-track{height:18px}.sd-blk{line-height:14px}`;


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
// 一覧の設備停止の行（完了予定・停止内容）
const STOPS = `const head = [...document.querySelectorAll('#llHead tr:first-child th')].map((t) => t.textContent.replace('⠿', '').trim());
  const ci = (n) => head.indexOf(n);
  const stops = [...document.querySelectorAll('#llBody tr.sd-stop')].map((tr) => ({ t: tr.children[ci('完了予定')].textContent.trim(), s: tr.children[ci('停止内容')].textContent.trim() }));`;

export const PROPOSALS = [
  { key: "T0", name: "今の形（1 回目の後、釜番の字・除いた数の知らせ・0 本の札を直した）", css: "", ops: [] },
  { key: "T1", name: "1 段の帯（1 回目の S1 を持ち越し。HOT の設備の札も小さく）", css: BAND, ops: [] },
  {
    key: "T2", name: "主の数＋押して絞る区分の札（S1＋S6。製造件数を最初に・CM3 の時刻は右）",
    css: BAND + CHIPS, ops: [["script", WATCH(READ + `if (mode === 'line') {` + CHIPROW(`'<span class="ux-lead"><b>' + g('製造件数') + '</b><span>件 製造・ロット ' + g('ロット数') + '</span></span>'`) + `}`)]],
  },
  {
    key: "T3", name: "先回り: 次の設備停止を最初に（いつ・何で止まるか）＋区分の札",
    css: BAND + CHIPS + `
  .ux-next{display:flex;align-items:baseline;gap:8px;padding:2px 12px 2px 10px;margin-right:6px;border:1px solid #e6bcb6;border-left:4px solid var(--sd-stop-bar);border-radius:8px;background:var(--surface);white-space:nowrap}
  .ux-next span{font-size:var(--fs-xs);color:var(--sd-stop-ink)}
  .ux-next b{font-size:var(--fs-lg);color:var(--sd-stop-ink)}
  .ux-next em{font-style:normal;font-size:var(--fs-sm);color:var(--ink)}`,
    ops: [["script", WATCH(READ + STOPS + `if (mode === 'line') {` + CHIPROW(`(stops[0] ? '<span class="ux-next"><span>次の設備停止</span><b>' + stops[0].t + '</b><em>' + stops[0].s + '</em></span>' : '') + '<span class="ux-lead"><b>' + g('製造件数') + '</b><span>件 製造</span></span>'`) + `}`)]],
  },
  {
    key: "T4", name: "割合の帯で見せる（製造・点検・設備停止・仕掛に無いの割合を 1 本の帯に）",
    css: BAND + CHIPS + `
  .ux-bar{display:flex;align-items:center;gap:10px;flex:0 0 340px}
  .ux-bar i{display:flex;height:12px;flex:1;border-radius:6px;overflow:hidden;background:var(--surface-4)}
  .ux-bar i s{display:block;height:100%}
  .ux-bar .p-lot{background:#8fa3b8}.ux-bar .p-miss{background:repeating-linear-gradient(45deg,#8fa3b8 0 3px,#cbd5e1 3px 6px)}.ux-bar .p-insp{background:#e0b100}.ux-bar .p-stop{background:#c0392b}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') {` + G + `
  const n = { lot: +g('製造件数') - (+miss || 0), miss: +miss || 0, insp: +g('点検'), stop: +g('設備停止') }, all = n.lot + n.miss + n.insp + n.stop;
  const seg = (k) => '<s class="p-' + k + '" style="width:' + (n[k] / all * 100).toFixed(1) + '%"></s>';
  box.querySelectorAll(':scope > .sd-card').forEach((c) => c.style.display = 'none');
  box.insertAdjacentHTML('afterbegin', '<div class="ux-chips"><span class="ux-lead"><b>' + g('製造件数') + '</b><span>件 製造・ロット ' + g('ロット数') + '</span></span><span class="ux-bar"><i>' + seg('lot') + seg('miss') + seg('insp') + seg('stop') + '</i></span><button class="sd-kchip k-insp">点検 <b>' + n.insp + '</b></button><button class="sd-kchip k-stop">設備停止 <b>' + n.stop + '</b></button><button class="sd-kchip k-miss">仕掛に無い <b>' + n.miss + '</b></button><span class="ux-meta">完了予定 <b>' + g('完了予定') + '</b>　CM3 <b>' + (u1 || '-') + '</b></span></div>');
  }`)]],
  },
  {
    key: "T5", name: "HOT は図を主に（設備の本数を図の左に・札の段を無くす）＋設備は T2",
    css: BAND + CHIPS + `
  .sd-strip[data-mode="hot"] .sd-cards{display:none}
  .sd-ln{flex-basis:104px;display:flex;align-items:baseline;gap:6px;white-space:nowrap}
  .sd-ln small{font-size:var(--fs-sm);color:var(--ink);font-weight:800}
  .sd-axis{margin-left:104px}.sd-lane{height:28px}
  .ux-hotlead{font-size:var(--fs-sm);color:var(--muted);white-space:nowrap}.ux-hotlead b{font-size:var(--fs-lg);color:var(--ink)}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') {` + CHIPROW(`'<span class="ux-lead"><b>' + g('製造件数') + '</b><span>件 製造・ロット ' + g('ロット数') + '</span></span>'`) + `} else {
  document.querySelectorAll('#llSched .sd-lane').forEach((ln) => { const n = ln.querySelector('.sd-ln'), eq = n.textContent.trim(), c = C[eq]; if (c) n.insertAdjacentHTML('beforeend', '<small>' + c.v.replace(/<[^>]+>/g, '') + '</small>'); });
  const h = document.querySelector('#llSched .sd-tlhead');
  h.querySelector('b').insertAdjacentHTML('beforebegin', '<span class="ux-hotlead">対象 <b>' + (C[pick('対象ロット')] || {}).v.replace(/<[^>]+>/g, '') + '</b> 本</span>');
  h.title = ((C['抜き出し方'] || {}).t || '').replace(/<[^>]+>/g, '');
  }`)]],
  },
  {
    key: "T6", name: "数を件数の行へ（札の段を無くし、件数の右に区分の札。HOT は T1）",
    css: BAND + CHIPS + `
  .sd-strip[data-mode="line"]{display:none}
  .ux-inline{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .ux-inline .sd-kchip{height:24px}`,
    ops: [["script", WATCH(READ + `if (mode === 'line') {` + G + `
  document.querySelectorAll('.ux-inline').forEach((x) => x.remove());
  document.querySelector('#llCount').insertAdjacentHTML('afterend', '<span class="ux-inline sx-sumline"><button class="sd-kchip">製造 <b>' + g('製造件数') + '</b></button><button class="sd-kchip k-insp">点検 <b>' + g('点検') + '</b></button><button class="sd-kchip k-stop">設備停止 <b>' + g('設備停止') + '</b></button><button class="sd-kchip k-miss">仕掛に無い <b>' + miss + '</b></button></span>');
  }`)]],
  },
];
