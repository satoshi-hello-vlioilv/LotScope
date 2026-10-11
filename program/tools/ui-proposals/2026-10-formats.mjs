// 2026-10「共有の書式」（作業実績の表示ルールを名前を付けて共有に置き、ほかの設備・ほかの PC で呼び出す）の入口と窓（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-formats.mjs --states formats,formats-pick,formats-applied
// 試験用の書式は 3 つ（検査用・標準・薄板の確認）。設備は 12 台（表示 11 台）。再現は近似: 置き場と見え方を比べるためのもの。
//
// 方向（何で解くか）: A 置き場＝道具の行の「書式 ▾」と小窓（今の作り）／B 置き場＝設備の帯の右（設備に結ぶ物なので設備の隣）／
// D 流れ＝当てる所を「当てる」を押してから聞く（先に設定させない）／E 減らし方＝行は「当てる」だけ・上書き／削除は「…」へ・部品は札に／
// F 見せ方＝右の引き出し（高さいっぱい。設備の選択を広く）
// 5 案を並べると「入口と窓の形」ばかりで、いま何が当たっているかを一覧の上で見せる解き方と、設備ごとの状況を一目で見せる解き方が無い → 2 案を足す:
// G 状態を見せる＝件数の行に「書式: 検査用」の札（更新があれば印）／H 俯瞰＝当てる所を設備の表にし、各設備にいま当たっている書式を添える

const MENU = `
  const sync = () => {
    const pick = document.querySelector('#llFormatPanel input[name="fmTo"][value="pick"]:checked');
    document.querySelectorAll('.px-apply-menu').forEach((m) => m.remove());
    if (!pick) return;
    const first = document.querySelector('#llFormatPanel .fm-item:first-child .fm-acts');
    if (first) first.insertAdjacentHTML('beforeend', '<div class="px-apply-menu"><button>この設備（ANF）</button><button>表示する全設備（11 台）</button><button class="on">設備を選ぶ…</button></div>');
  };
  new MutationObserver(sync).observe(document.querySelector('#llFormatPanel'), { childList: true, subtree: true, attributes: true }); sync();`;

export const PROPOSALS = [
  { key: "A", name: "道具の行の「書式 ▾」と小窓（今の作り）", css: "", ops: [] },
  {
    key: "B", name: "設備の帯の右に「書式 ▾」（設備の隣）",
    css: `#llFormatPanel{position:fixed;top:128px;right:28px}
      #llEquipBar .fm-entry{height:30px;margin-bottom:6px;border:1px solid var(--line);border-radius:7px;background:var(--surface);padding:0 10px;font-family:inherit;font-size:13px;cursor:pointer}`,
    // 設備の帯は作業実績を開いてから描かれるので、現れたら動かす（帯は描き直されるので、そのたびに）
    ops: [["script", `
      const sync = () => { const m = document.querySelector('#llEquipBar .eq-manage'), b = document.querySelector('#llFormatBtn');
        if (m && b && b.nextElementSibling !== m) m.before(b); };
      new MutationObserver(sync).observe(document.querySelector('#llEquipBar'), { childList: true, subtree: true }); sync();`]],
  },
  {
    key: "D", name: "当てる所は「当てる ▾」を押してから聞く",
    css: `#llFormatPanel .fm-to{display:none}
      #llFormatPanel .fm-acts{position:relative}
      #llFormatPanel .fm-apply::after{content:" ▾"}
      .px-apply-menu{position:absolute;right:0;top:32px;z-index:3;display:grid;min-width:200px;padding:4px;background:var(--surface);border:1px solid var(--pop-line);border-radius:8px;box-shadow:0 10px 26px var(--pop-shadow)}
      .ll-screen .generic-filter-bar .px-apply-menu button{border:0;text-align:left;height:30px;background:none}
      .ll-screen .generic-filter-bar .px-apply-menu button.on{background:var(--ll-pale);color:var(--ll-teal-dark);font-weight:700}`,
    ops: [["script", MENU]],
  },
  {
    key: "E", name: "行は「当てる」だけ（上書き・削除は「…」）・部品は札",
    css: `#llFormatPanel .fm-sub{display:none}
      .px-more{width:28px;padding:0!important;color:var(--muted)}
      .px-parts{display:flex;flex-wrap:wrap;gap:3px}
      .px-parts i{font-style:normal;font-size:10.5px;font-weight:700;padding:0 6px;border-radius:999px;background:var(--surface-4);color:var(--muted);line-height:1.7}`,
    ops: [["script", `
      const sync = () => document.querySelectorAll('#llFormatPanel .fm-item').forEach((li) => {
        if (li.dataset.px) return; li.dataset.px = 1;
        const s = li.querySelector('.fm-main small'); s.outerHTML = '<span class="px-parts">' + s.textContent.split('・').map((t) => '<i>' + t + '</i>').join('') + '</span>';
        li.querySelector('.fm-acts').insertAdjacentHTML('beforeend', '<button class="px-more" title="上書き・削除">…</button>');
      });
      new MutationObserver(sync).observe(document.querySelector('#llFormatPanel'), { childList: true, subtree: true }); sync();`]],
  },
  {
    key: "F", name: "右の引き出し（高さいっぱい）",
    css: `#llFormatPanel{position:fixed;top:0;right:0;bottom:0;width:480px;max-height:none;border-radius:0;border-width:0 0 0 1px;padding:18px 20px;align-content:start;box-shadow:-16px 0 40px rgba(12,34,48,.22)}
      #llFormatPanel .fm-head b{font-size:16px}
      #llFormatPanel .fm-equips{display:grid;grid-template-columns:repeat(3,1fr)}`,
    ops: [],
  },
  {
    key: "G", name: "件数の行に「書式: ○○」の札（いま当てている書式）",
    css: `.px-fmchip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--ll-teal);background:var(--ll-pale);color:var(--ll-teal-dark);font-size:12.5px;font-weight:700;margin-left:6px}
      .px-fmchip small{color:var(--muted);font-weight:600}
      .px-fmchip.none{border-style:dashed;background:transparent;color:var(--muted)}`,
    ops: [["script", `
      const sync = () => {
        const now = document.querySelector('#llFormatBtn .fm-now')?.textContent || '';
        let c = document.querySelector('.px-fmchip');
        if (!c) { document.querySelector('#llCount')?.insertAdjacentHTML('afterend', '<span class="px-fmchip"></span>'); c = document.querySelector('.px-fmchip'); }
        if (!c) return;
        c.className = 'px-fmchip' + (now ? '' : ' none');
        c.innerHTML = now ? '<small>書式</small>' + now + ' ▾' : '書式: なし ▾';
      };
      new MutationObserver(sync).observe(document.querySelector('#llFormatBtn'), { childList: true, subtree: true, characterData: true }); sync();`]],
  },
  {
    key: "H", name: "当てる所を設備の表に（各設備にいま当たっている書式を添える）",
    css: `#llFormatPanel{width:560px}
      #llFormatPanel .fm-equips,#llFormatPanel .fm-equips[hidden]{display:grid!important;grid-template-columns:1fr 1fr;gap:2px 16px}
      #llFormatPanel .fm-equips label{display:flex;justify-content:space-between;gap:8px;padding:2px 4px;border-radius:5px}
      #llFormatPanel .fm-equips label:nth-child(4n+2),#llFormatPanel .fm-equips label:nth-child(4n+3){background:var(--surface-2)}
      .px-cur{color:var(--muted);font-size:11.5px}.px-cur.on{color:var(--ll-teal-dark);font-weight:700}`,
    ops: [["script", `
      const sync = () => {
        const ap = JSON.parse(localStorage.getItem('tpa.lotlist.formatApplied.v1') || '{}');
        document.querySelectorAll('#llFormatPanel .fm-equips label[data-px]').forEach(() => {});
        document.querySelectorAll('#llFormatPanel .fm-equips input[data-key]').forEach((i) => {
          const l = i.closest('label'); if (l.querySelector('.px-cur')) return;
          const a = ap[i.dataset.key]; l.insertAdjacentHTML('beforeend', '<span class="px-cur' + (a ? ' on' : '') + '">' + (a ? a.name : '—') + '</span>');
        });
      };
      new MutationObserver(sync).observe(document.querySelector('#llFormatPanel'), { childList: true, subtree: true }); sync();`]],
  },
];
