// 2026-10「スケジュール」のタブ（ScheduleView を移した。版 3.57.0）の、設備の数・HOT コイル作業順の札と図の置き方・見せ方の 6 案。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-schedule.mjs --from sch --states sch,sch-hot
// 今の形（S0）の困りごと（撮った画像で見えたこと）:
//   - 設備の数の札が 1 枚ずつ半幅に伸び、7 枚で縦 270px ほど一覧を押し下げる（一覧が画面の半分ほど）
//   - HOT の札も大きく、0 本の L-3 にも同じ面積・抜き出し方の文が 5 行に折れる
//   - CM3 の更新の時刻が、札と件数の行の「元データ」の 2 か所に出る
// 再現は近似: 今の札（#llSched）の中身を読み、案の形に組み替えて撮る（押したときの動きは再現しない）。

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

export const PROPOSALS = [
  { key: "S0", name: "今の形（札を 1 枚ずつ並べる）", css: "", ops: [] },
  {
    key: "S1", name: "数を 1 段の帯に（札を横 1 列・名前と値を 1 行）",
    css: COMPACT, ops: [],
  },
  {
    key: "S2", name: "数を設備のタブの行へ（札の段を無くす。HOT は図の左に本数）",
    css: COMPACT + `
  .sx-sumline{flex:1 1 auto;min-width:0;display:flex;align-items:baseline;gap:14px;padding-bottom:9px;font-size:var(--fs-sm);color:var(--muted);white-space:nowrap;overflow:hidden}
  .sx-sumline b{font-size:var(--fs-md);color:var(--ink);font-variant-numeric:tabular-nums}
  .sx-sumline .is-stop b{color:var(--sd-stop-bar)} .sx-sumline .is-insp b{color:var(--sd-insp-ink)}
  .eq-chips{flex:0 1 auto}
  .sd-strip[data-mode="line"]{display:none}
  .sd-strip[data-mode="hot"] .sd-cards{display:none}
  .sx-ln small{display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:600}
  .sd-ln{flex-basis:84px}.sd-axis{margin-left:84px}
  .sx-rule{font-size:var(--fs-xs);color:var(--muted);margin-left:8px;cursor:help;text-decoration:underline dotted}`,
    ops: [["script", WATCH(READ + `
  const auto = document.querySelector('#llEquipBar .sd-auto') || document.querySelector('#llEquipBar .eq-chips');
  if (mode === 'line') {
    const g = (k) => (C[pick(k)] || {}).v || '-';
    auto.insertAdjacentHTML(auto.classList.contains('eq-chips') ? 'afterend' : 'beforebegin', '<span class="sx-sumline"><span>製造 <b>' + g('製造件数') + '</b></span><span>ロット <b>' + g('ロット数') + '</b></span><span class="is-insp">点検 <b>' + g('点検') + '</b></span><span class="is-stop">設備停止 <b>' + g('設備停止') + '</b></span><span>仕掛と一致 <b>' + g('仕掛と一致') + '</b></span><span>完了予定 <b>' + g('完了予定') + '</b></span></span>');
  } else {
    document.querySelectorAll('#llSched .sd-lane').forEach((ln) => { const n = ln.querySelector('.sd-ln'), eq = n.textContent.trim(); const c = C[eq]; if (c) n.insertAdjacentHTML('beforeend', '<small>' + c.v.replace(/<[^>]+>/g, '') + '</small>'); });
    document.querySelector('#llSched .sd-tlhead b').insertAdjacentHTML('afterend', '<span class="sx-rule" title="' + (C['抜き出し方'] || {}).t.replace(/<[^>]+>/g, ' ').replace(/"/g, '') + '">対象 ' + (C[pick('対象ロット')] || {}).v.replace(/<[^>]+>/g, '') + ' 本・抜き出し方</span>');
  }`)]],
  },
  {
    key: "S3", name: "数を一覧の左の縦の欄へ（スライサーと同じ置き場）",
    css: `
  .sd-strip[data-mode="line"]{flex-direction:column;flex-wrap:nowrap;width:200px;flex:0 0 200px;padding:10px;border:0;border-right:1px solid var(--line);background:var(--surface-2);overflow:auto}
  .sd-strip[data-mode="line"] .sd-card{flex-direction:row;justify-content:space-between;align-items:baseline;min-width:0;padding:5px 10px}
  .sd-strip[data-mode="line"] .sd-card.is-wide{flex-direction:column;align-items:flex-start}
  .sd-strip[data-mode="line"] .sd-value{font-size:var(--fs-lg)}
  .sd-strip[data-mode="hot"] .sd-cards{flex-wrap:nowrap}
  .sd-strip[data-mode="hot"] .sd-card{min-width:0;padding:4px 10px}
  .sd-strip[data-mode="hot"] .sd-value{font-size:var(--fs-lg)}
  .sd-strip[data-mode="hot"] .sd-card.is-info .sd-rule{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--fs-xs)}`,
    ops: [["script", WATCH(`const b = document.querySelector('#llSched'); if (b.dataset.mode === 'line') document.querySelector('#llBodyRow').prepend(b); else document.querySelector('#llEquipBar').after(b);`)]],
  },
  {
    key: "S4", name: "時間の帯で見せる（設備の予定も帯の図。停止・点検の時刻が一目で分かる）",
    css: COMPACT + `
  .sx-line{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:4px 10px 6px;flex:1 1 100%}
  .sx-line .sd-blk{color:#fff;font-weight:700}
  .sx-line .sd-blk.k-lot{background:#8fa3b8}.sx-line .sd-blk.k-insp{background:#e0b100;color:#3b2b00}.sx-line .sd-blk.k-stop{background:#c0392b}
  .sd-strip[data-mode="line"]{flex-wrap:wrap}
  .sd-strip[data-mode="line"] > .sd-card{flex:0 1 auto}`,
    ops: [["script", WATCH(READ + `
  if (mode === 'line') {
    const rows = [...document.querySelectorAll('#llBody tr[data-i]')];
    const head = [...document.querySelectorAll('#llHead tr:first-child th')].map((t) => t.textContent.replace('⠿', '').trim());
    const ci = (n) => head.indexOf(n);
    const items = rows.map((tr) => { const td = tr.children; return { t: (td[ci('完了予定')] || {}).textContent || '', k: tr.classList.contains('sd-stop') ? 'stop' : tr.classList.contains('sd-inspect') ? 'insp' : 'lot', lot: (td[ci('ロットNo')] || {}).textContent || '', s: (td[ci('停止内容')] || {}).textContent || '' }; });
    const tm = (s) => { const m = /(\\d+)\\/(\\d+) (\\d+):(\\d+)/.exec(s); return m ? new Date(2026, m[1] - 1, +m[2], +m[3], +m[4]).getTime() : NaN; };
    const pts = items.map((x) => ({ ...x, e: tm(x.t) })).filter((x) => !isNaN(x.e));
    const t0 = pts[0].e - 1200000, t1 = pts[pts.length - 1].e, span = t1 - t0, pc = (t) => ((t - t0) / span * 100).toFixed(2) + '%';
    let h = '<div class="sx-line"><div class="sd-tlhead"><b>この設備の流れ</b><span>灰＝製造・黄＝点検・赤＝設備停止（帯は前の行の完了予定～完了予定）</span></div><div class="sd-lane"><span class="sd-ln">L-1</span><div class="sd-track">';
    let prev = t0; pts.forEach((p) => { h += '<span class="sd-blk k-' + p.k + '" style="left:' + pc(prev) + ';width:calc(' + ((p.e - prev) / span * 100).toFixed(2) + '% - 1px)" title="' + p.t + ' ' + (p.s || p.lot) + '">' + (p.k === 'stop' ? p.s : '') + '</span>'; prev = p.e; });
    box.insertAdjacentHTML('beforeend', h + '</div></div></div>');
  }`)]],
  },
  {
    key: "S5", name: "要約を 1 行に（開くと札。ふだんは一覧を広く）",
    css: `
  .sx-one{display:flex;align-items:baseline;gap:14px;font-size:var(--fs-sm);color:var(--muted);white-space:nowrap;overflow:hidden}
  .sx-one b{font-size:var(--fs-md);color:var(--ink)}
  .sx-one button{margin-left:auto;height:24px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--h-input);font-family:inherit;font-size:var(--fs-sm)}
  .sd-strip{padding:5px 16px}
  .sd-strip > .sd-card, .sd-strip .sd-cards{display:none}
  .sd-strip[data-mode="line"]{flex-wrap:nowrap}`,
    ops: [["script", WATCH(READ + `
  const g = (k) => ((C[pick(k)] || {}).v || '-').replace(/<[^>]+>/g, '');
  const one = mode === 'line'
    ? '<span>製造 <b>' + g('製造件数') + '</b></span><span>ロット <b>' + g('ロット数') + '</b></span><span>点検 <b>' + g('点検') + '</b></span><span>設備停止 <b>' + g('設備停止') + '</b></span><span>仕掛と一致 <b>' + g('仕掛と一致') + '</b></span><span>完了予定 <b>' + g('完了予定') + '</b></span>'
    : '<span>対象 <b>' + g('対象ロット') + '</b> 本</span>' + ['L-1', 'L-2', 'L-3'].map((e) => '<span>' + e + ' <b>' + g(e) + '</b></span>').join('');
  box.insertAdjacentHTML('afterbegin', '<div class="sx-one">' + one + '<button>詳しく ▾</button></div>');`)]],
  },
  {
    key: "S6", name: "区分を押して絞る札に（点検・設備停止・仕掛に無いを押すとその行だけ）",
    css: COMPACT + `
  .sd-strip[data-mode="line"] > .sd-card{display:none}
  .sx-chips{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;width:100%}
  .sx-chips .sd-kchip b{font-size:var(--fs-md)}
  .sx-chips .k-stop{border-color:#e6bcb6;background:var(--sd-stop-bg);color:var(--sd-stop-ink)}
  .sx-chips .k-insp{border-color:#ecd29a;background:var(--sd-insp-bg);color:var(--sd-insp-ink)}
  .sx-meta{margin-left:auto;font-size:var(--fs-sm);color:var(--muted);white-space:nowrap}
  .sx-meta b{color:var(--ink)}
  .sd-strip[data-mode="hot"] .sd-eqcard{flex-direction:row;align-items:baseline;gap:8px;border-radius:999px;border-top-width:1px;border-left:4px solid var(--eqc);padding:3px 12px}
  .sd-strip[data-mode="hot"] .sd-eqcard .sd-sub{display:none}`,
    ops: [["script", WATCH(READ + `
  if (mode === 'line') {
    const g = (k) => ((C[pick(k)] || {}).v || '-').replace(/<[^>]+>/g, '');
    box.insertAdjacentHTML('afterbegin', '<div class="sx-chips"><span class="sd-klab">区分</span><button class="sd-kchip is-on">すべて <b>' + (document.querySelector('#llCount').textContent.replace(/[^0-9]/g, '')) + '</b></button><button class="sd-kchip">製造 <b>' + g('製造件数') + '</b><small>ロット ' + g('ロット数') + '</small></button><button class="sd-kchip k-insp">点検 <b>' + g('点検') + '</b></button><button class="sd-kchip k-stop">設備停止 <b>' + g('設備停止') + '</b></button><button class="sd-kchip">仕掛に無い <b>' + (() => { const m = g('仕掛と一致').match(/(\\d+)\\s*\\/\\s*(\\d+)/); return m ? m[2] - m[1] : '-'; })() + '</b></button><span class="sx-meta">完了予定 <b>' + g('完了予定') + '</b></span></div>');
  }`)]],
  },
];
