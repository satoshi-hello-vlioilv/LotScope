// 2026-10 待ちの窓（WAITING。shared.js の TPA.waiting）の 7 案。配布の置き場を初めて読むときの文で比べる。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-waiting.mjs --states waiting
// 窓は出すたびに作られるので、組み替えは出たあとに当てる（MutationObserver）。再現は近似。
//
// 方向: A 今の作り（問い合わせ中の窓と同じ形: 題・どこから・回る輪といまのこと・控え・経過の秒・裏で続ける）／
// B 見せ方＝窓の上端に流れる帯（輪の代わり）と大きな経過の秒／C 置き場＝後ろを止めない右下の知らせ（窓にしない）／
// D 見せ方＝アプリの形（周期の山）が流れる絵を真ん中に／E 流れ＝段取り（① 置き場を探す ② 版を集める ③ 表に並べる）を並べる
// 5 案を並べると、どれも「窓の中身」の見せ方で、待つ量そのものを減らす・読ませる量を減らす解き方が無い → 2 案を足す:
// F 減らし方＝輪と 1 行だけ（題・控えは出さない）／G 置き場＝待っている頁そのものに骨組みと 1 行（窓は 3 秒を過ぎてから）

const onWait = (fn) => ["script", `
  const run = () => document.querySelectorAll('.tpa-wait:not([data-px])').forEach((w) => { w.dataset.px = '1'; (${fn})(w); });
  new MutationObserver(run).observe(document.body, { childList: true }); run();`];

export const PROPOSALS = [
  { key: "A", name: "問い合わせ中の窓と同じ形（今の作り）", css: "", ops: [] },
  {
    key: "B", name: "窓の上端に流れる帯・大きな経過の秒",
    css: `.tpa-wait .fetch-card{position:relative;overflow:hidden;padding-top:22px}
      .tpa-wait .fetch-card::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,transparent,var(--h-input),transparent);background-size:40% 100%;background-repeat:no-repeat;animation:pxflow 1.3s linear infinite}
      @keyframes pxflow{from{background-position:-40% 0}to{background-position:140% 0}}
      .tpa-wait .wait-spin{display:none}.tpa-wait .fetch-time{font-size:20px;font-weight:800;color:var(--ink)}`,
    ops: [],
  },
  {
    key: "C", name: "後ろを止めない右下の知らせ（窓にしない）",
    css: `.tpa-wait{inset:auto 18px 18px auto;background:transparent;backdrop-filter:none;display:block}
      .tpa-wait .fetch-card{width:380px;box-shadow:0 12px 32px rgba(10,30,50,.3)}`,
    ops: [],
  },
  {
    key: "D", name: "アプリの形（周期の山）が流れる絵を真ん中に",
    css: `.px-wave{display:block;width:100%;height:46px;margin:10px 0 2px}
      .px-wave path{fill:none;stroke:#d7e2ea;stroke-width:3;stroke-linejoin:round}
      .px-wave .on{stroke:var(--h-xfer,#2f7d78);stroke-dasharray:.18 .82;animation:pxdash 1.6s linear infinite}
      @keyframes pxdash{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}.tpa-wait .wait-spin{display:none}`,
    ops: [onWait(`(w) => {
      let d = 'M0 40'; for (let i = 0; i < 7; i++) { const x = i * 54 + 27; d += ' L' + (x - 12) + ' 40 L' + x + ' 6 L' + (x + 12) + ' 40'; } d += ' L380 40';
      w.querySelector('.wait-now').insertAdjacentHTML('beforebegin', '<svg class="px-wave" viewBox="0 0 380 46" preserveAspectRatio="none"><path d="' + d + '"/><path class="on" pathLength="1" d="' + d + '"/></svg>');
    }`)],
  },
  {
    key: "E", name: "段取り（① 置き場を探す ② 版を集める ③ 表に並べる）を並べる",
    css: `.tpa-wait .wait-now{display:none}`,
    ops: [onWait(`(w) => {
      w.querySelector('.wait-now').insertAdjacentHTML('afterend', '<ol class="fetch-steps" style="margin-top:8px"><li class="done"><i></i>置き場を探す</li><li class="now"><i></i>置いてある版（release.json）を集める</li><li><i></i>表に並べる</li></ol>');
    }`)],
  },
  {
    key: "F", name: "輪と 1 行だけ（題・控えは出さない）",
    css: `.tpa-wait .fetch-head,.tpa-wait .wait-note,.tpa-wait .wait-from{display:none}
      .tpa-wait .fetch-card{width:auto;max-width:520px;padding:14px 18px}.tpa-wait .fetch-foot{margin-top:8px;padding-top:6px}`,
    ops: [],
  },
  {
    key: "G", name: "待っている頁そのものに骨組みと 1 行（窓は 3 秒を過ぎてから）",
    css: `.tpa-wait{display:none}
      .px-skel{position:fixed;z-index:1500;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;padding:18px;border-radius:12px;background:var(--surface);box-shadow:0 10px 30px rgba(10,30,50,.18)}
      .px-skel p{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-weight:700}
      .px-skel i{display:block;height:14px;margin:8px 0;border-radius:6px;background:linear-gradient(90deg,#edf1f5,#f7f9fb,#edf1f5);background-size:200% 100%;animation:pxsk 1.2s linear infinite}
      @keyframes pxsk{from{background-position:100% 0}to{background-position:-100% 0}}`,
    ops: [onWait(`(w) => {
      document.body.insertAdjacentHTML('beforeend', '<div class="px-skel"><p><span class="wait-spin"></span>アプリの配布の置き場を読んでいます…（2 秒）</p><i style="width:60%"></i><i></i><i style="width:80%"></i><i></i><i style="width:70%"></i></div>');
    }`)],
  },
];
