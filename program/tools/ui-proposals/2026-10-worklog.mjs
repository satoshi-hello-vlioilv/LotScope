// 2026-10「作業実績」タブで、どの設備を見るかを選ぶ形（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-worklog.mjs --states worklog
// 試験用の作業実績は設備 12 台（1 台はファイルが見つからない）。再現は近似: 置き場と見え方を比べるためのもの。
//
// 方向（何で解くか）: A 置き場＝一覧の上の帯（札を並べる）／B 減らし方＝件数の行の選択欄／C 置き場＝左の縦の帯／
// D 見せ方＝タブの中のタブ（紙のタブ）／E 流れ＝見出しのタブで設備を選ぶ
// 5 案を並べると「どこに置くか」が 3 つで、縦の場所を取らない解き方と、設備の様子（最後の更新）を見せる解き方が無い → 2 案を足す:
// F 置き場＝絞り込みの行の先頭に収める（縦を節約）／G 見せ方＝札に最後の更新を添える（どの設備が新しいかを読ませずに見せる）

const NAMES = ["CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1", "SL3"];

export const PROPOSALS = [
  { key: "A", name: "一覧の上に設備の札の帯（今の作り）", css: "", ops: [] },
  {
    key: "B", name: "件数の行に「設備」の選択欄（表の選択と同じ形）",
    css: `#llEquipBar{display:none!important}
      .wx-pick{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--muted)}
      .wx-pick select{height:28px;border-radius:7px;border:1px solid var(--ll-teal);background:#f2faf9;color:var(--ink);padding:0 8px;font-size:14px;font-weight:800;font-family:inherit}`,
    ops: [["insert", `<label class="wx-pick">設備<select>${NAMES.map((n) => `<option>${n}</option>`).join("")}</select></label>`, "beforebegin", "#llCount"]],
  },
  {
    key: "C", name: "左に設備の縦の帯（一覧の横・いつも全部見える）",
    css: `#llEquipBar{flex-direction:column;align-items:stretch;margin:0;width:132px;flex:none;gap:8px;overflow:auto;padding:8px;border:1px solid var(--line);border-radius:8px;background:#f6f9fb}
      #llEquipBar .eq-lab{padding:0 4px}
      #llEquipBar .eq-chips{flex-direction:column;flex-wrap:nowrap;gap:2px;flex:none}
      #llEquipBar .eq-chip{border-radius:7px;text-align:left;border-color:transparent;height:32px;background:transparent}
      #llEquipBar .eq-chip[aria-selected=true]{background:var(--ll-teal)}
      #llEquipBar .eq-manage{margin-top:auto}`,
    ops: [["move", "#llEquipBar", "prepend", "#llBodyRow"]],
  },
  {
    key: "D", name: "タブの中のタブ（設備を紙のタブにして一覧につなぐ）",
    css: `#llEquipBar{margin:0;padding:8px 16px 0;background:#e9f0f3;border-bottom:1px solid var(--line);gap:12px;align-items:flex-end}
      #llEquipBar .eq-lab{padding-bottom:8px}
      #llEquipBar .eq-chips{gap:2px;flex-wrap:nowrap;overflow:hidden}
      #llEquipBar .eq-chip{border-radius:8px 8px 0 0;border:1px solid transparent;border-bottom:0;height:34px;background:transparent;color:var(--muted);box-shadow:none}
      #llEquipBar .eq-chip:hover{background:rgba(255,255,255,.6)}
      #llEquipBar .eq-chip[aria-selected=true]{background:var(--surface);color:var(--ll-teal-dark);border-color:var(--line);box-shadow:inset 0 3px 0 var(--ll-teal);margin-bottom:-1px}
      #llEquipBar .eq-manage{margin-bottom:6px}`,
    ops: [],
  },
  {
    key: "E", name: "見出しのタブに設備名（「作業実績 CR1 ▾」を押して選ぶ）",
    css: `#llEquipBar{display:none!important}
      .wx-tabeq{margin-left:8px;padding:1px 8px;border-radius:999px;background:var(--ll-teal);color:#fff;font-size:12.5px;font-weight:800}`,
    ops: [["insert", '<span class="wx-tabeq">CR1 ▾</span>', "beforeend", "#tabWork"]],
  },
  {
    key: "F", name: "絞り込みの行の先頭に設備の札（縦の場所を取らない）",
    css: `#llEquipBar{margin:0;gap:6px;flex:0 1 auto;min-width:0;max-width:46%;overflow:hidden;padding-right:8px;border-right:1px solid var(--line)}
      #llEquipBar .eq-chips{flex-wrap:nowrap;overflow:hidden;mask-image:linear-gradient(90deg,#000 88%,transparent)}
      #llEquipBar .eq-chip{height:28px;padding:0 10px;font-size:13px}
      #llEquipBar .eq-manage{display:none}`,
    ops: [["move", "#llEquipBar", "prepend", ".filter-search-row"]],
  },
  {
    key: "G", name: "設備の札に最後の更新を添える（どれが新しいかが見える）",
    css: `#llEquipBar .eq-chip{height:40px;border-radius:9px;display:inline-flex;flex-direction:column;justify-content:center;line-height:1.15;padding:0 12px}
      .eq-sub{font-size:10.5px;font-weight:600;opacity:.75}`,
    ops: [["script", `
      const add = () => document.querySelectorAll('#llEquipBar .eq-chip').forEach((b) => {
        if (b.querySelector('.eq-sub')) return;
        const m = /最後の更新 ([0-9/: ]+)/.exec(b.title || '');
        b.insertAdjacentHTML('beforeend', '<small class="eq-sub">' + (m ? m[1] : 'ファイルなし') + '</small>');
      });
      new MutationObserver(add).observe(document.querySelector('#llEquipBar'), { childList: true, subtree: true }); add();`]],
  },
];
