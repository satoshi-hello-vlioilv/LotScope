// 2026-10 カードの設計（Access のフォームのように、見た目のまま組む）。1 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-cardform.mjs --states card,card-edit --from card
// 今の画面で見えたこと（card・card-edit の画像）:
//   ①「配置を編集」で各項目に 2 段のボタン（1〜4枠・1行・高さ標準/2倍/3倍・隠す）が付き、項目の背が倍以上になる（見た目と編集の形が違う）
//   ②大きさは段階のボタンで選ぶだけで、四隅を引けない ③項目の名前・字の大きさ・色を項目ごとに変えられない ④列を組み合わせた表示が無い
//   ⑤配置はこの PC・この表だけ（全員の標準・自分の物として残せない）⑥長い値（0.28960928633167626）が枠からはみ出す
// どの案も同じ所（要望の 1〜6）: 12 列の方眼に項目を置く。四隅の取っ手で大きさ・項目を掴んで動かす（ダッシュボードのパネルと同じ）。
//   編集はカードの大きさのまま（取っ手と点線の枠が重なるだけ）。項目のダブルクリックで中身（名前・書式・組み合わせの式・見栄え）。
//   組み合わせた項目（例: 合金・調質 = A1100 / H14）は表示列の作り方と同じ式。保存はダッシュボードと同じ置き場（自分だけ・全員・全員の既定＋組み込みの標準）
// 案の方向（編集の道具の置き場・見せ方）:
//   A 置き場: カードの見出しの下に細い編集の帯 1 段（デザイン ▾・＋ 項目・＋ 組み合わせ・見栄え ▾・終える）。ダブルクリックは項目の横の小さな面
//   B 置き場: カードの右に、カードとは別の「プロパティ」の窓（選んだ項目の中身と見栄え）。カードは 1 つも変わらない
//   C 流れ: 左に列の札の棚（隠した列・まだ置いていない列）。棚からカードへ引いて置く。ダブルクリックは項目の中の小さな面
//   D 置き場: カードの上にリボン（配置・見栄え・組み合わせ・保存 のタブ。Access と同じ型）
//   E 減らし方: 道具は右クリックのメニューと、選んだ項目の上の浮かぶ小さな道具（Word の浮かぶ書式の帯）だけ。帯は出さない
//   F 見せ方: 編集に入ると、カードの左上に「デザイン」の見本（標準・要点だけ・横長・2 段）を絵で並べ、選んでから直す
const ITEMS = [  // [ラベル, 値, x, y, w, h, 見栄え]
  ["不良名", "打痕", 0, 0, 4, 2, "big red"], ["設備", "L-2", 4, 0, 4, 2, "big"], ["発生日", "2026/05/01", 8, 0, 4, 2, "big"],
  ["合金・調質", "A1100 / H14", 0, 2, 4, 1, "combo"], ["板厚 × 板幅", "1e-05 × 1019", 4, 2, 4, 1, "combo"], ["重量", "3,705.3 kg", 8, 2, 4, 1, ""],
  ["検査日", "2026/05/02", 0, 3, 3, 1, ""], ["検査番号", "N334083", 3, 3, 3, 1, ""], ["工程", "圧延", 6, 3, 3, 1, ""], ["担当", "担当1", 9, 3, 3, 1, ""],
  ["長さ", "4,963.91", 0, 4, 3, 1, ""], ["比重", "2.73", 3, 4, 3, 1, ""], ["鋳造番号", "J82G25A", 6, 4, 3, 1, ""], ["数量", "54", 9, 4, 3, 1, ""],
  ["備考", "—", 0, 5, 12, 2, "muted"],
];
const SEC = [["不良", 0], ["製造条件", 2], ["検査", 3]];
const css = `
.lk-body .lk-grid{display:none!important}.lk-foot,.lk-tray{display:none!important}.lk-tools{display:flex;align-items:center;gap:8px}
.cf{position:relative;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:48px;gap:8px;padding:2px}
.cf-i{position:relative;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;padding:3px 12px;border:1px solid #dbe3e9;border-radius:9px;background:#fff;overflow:visible}
.cf-i small{font-size:12px;color:#5d6b77;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cf-i b{font-size:17px;color:#1b2733;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cf-i.big b{font-size:24px}.cf-i.red{border-left:4px solid #c0392b}.cf-i.red b{color:#a3281b}
.cf-i.combo{background:#f3f8fc}.cf-i.combo small::after{content:"組み合わせ";margin-left:6px;padding:0 6px;border-radius:999px;background:#e6effa;color:#2b5a8a;font-size:11px}
.cf-i.muted b{color:#7b8895;font-weight:400}
.cf-sec{grid-column:1/-1;height:auto;align-self:end;font-size:12px;font-weight:800;color:#3f6591;letter-spacing:.05em;border-bottom:2px solid #c9d8e8;padding:0 2px 2px}
.cf.edit{background-image:linear-gradient(#e6edf3 1px,transparent 1px),linear-gradient(90deg,#e6edf3 1px,transparent 1px);background-size:calc((100% + 8px)/12) 56px;background-position:-4px -4px;outline:1px dashed #b9cde2;border-radius:6px}
.cf.edit .cf-i{border-style:dashed;cursor:move}
.cf.edit .cf-i.sel{border:2px solid #e6a52e;box-shadow:0 0 0 3px rgba(230,165,46,.2)}
.cf-h{position:absolute;width:10px;height:10px;background:#fff;border:2px solid #e6a52e;border-radius:2px;z-index:2}
.cf-h.tl{left:-6px;top:-6px;cursor:nwse-resize}.cf-h.tr{right:-6px;top:-6px;cursor:nesw-resize}.cf-h.bl{left:-6px;bottom:-6px;cursor:nesw-resize}.cf-h.br{right:-6px;bottom:-6px;cursor:nwse-resize}
.cf-bar{flex:1 1 100%;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border:1px solid #ecd29a;border-radius:8px;background:#fff8ea;font-size:13px}
.cf-bar b{color:#8a5a00}.cf-bar .sp{flex:1}
.cf-b{height:28px;padding:0 10px;border:1px solid #dbe3e9;border-radius:6px;background:#fff;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.cf-b.pri{background:#3f6591;border-color:#3f6591;color:#fff;font-weight:700}
.cf-pop{position:absolute;z-index:5;width:300px;padding:10px 12px;border:1px solid #b9ccd4;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(12,34,48,.22);font-size:12.5px;display:flex;flex-direction:column;gap:7px}
.cf-pop h5{margin:0;font-size:13px}.cf-pop label{display:grid;grid-template-columns:72px 1fr;align-items:center;gap:6px}
.cf-pop input,.cf-pop select{height:26px;border:1px solid #ecd29a;border-radius:5px;background:#fffdf8;font:inherit;font-size:12.5px;padding:0 6px;min-width:0}
.cf-sw{display:flex;gap:4px}.cf-sw i{width:18px;height:18px;border-radius:4px;border:1px solid #c5ced5}
.cf-insp{position:fixed;z-index:80;width:300px;padding:12px;border:1px solid #b9ccd4;border-radius:12px;background:#fff;box-shadow:0 18px 40px rgba(12,34,48,.25);display:flex;flex-direction:column;gap:9px;font-size:12.5px}
.cf-insp h4{margin:0;font-size:14px}.cf-insp label{display:grid;grid-template-columns:72px 1fr;align-items:center;gap:6px}
.cf-insp input,.cf-insp select{height:28px;border:1px solid #ecd29a;border-radius:5px;background:#fffdf8;font:inherit;padding:0 6px;min-width:0}
.cf-shelf{display:flex;flex-direction:column;gap:5px;padding:8px;border:1px solid #dbe3e9;border-radius:8px;background:#f6f9fb;font-size:12.5px}
.cf-shelf span{padding:3px 8px;border:1px dashed #9fb3bf;border-radius:6px;background:#fff;cursor:grab}
.cf-wrap{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px}
.cf-rib{border:1px solid #dbe3e9;border-radius:8px;background:#fff;font-size:12.5px}
.cf-rib .tabs{display:flex;gap:2px;padding:4px 6px 0;border-bottom:1px solid #dbe3e9;background:#f4f7f9;border-radius:8px 8px 0 0}
.cf-rib .tabs span{padding:4px 12px;border-radius:6px 6px 0 0}.cf-rib .tabs span.on{background:#fff;border:1px solid #dbe3e9;border-bottom-color:#fff;margin-bottom:-1px;font-weight:700}
.cf-rib .row{display:flex;gap:6px;padding:6px 8px;align-items:center;flex-wrap:wrap}
.cf-mini{position:absolute;z-index:6;display:flex;gap:2px;padding:3px;border:1px solid #b9ccd4;border-radius:8px;background:#fff;box-shadow:0 6px 16px rgba(12,34,48,.2)}
.cf-mini button{width:28px;height:26px;border:0;border-radius:5px;background:none;font:inherit;font-weight:700;cursor:pointer}
.cf-gal{display:flex;gap:8px;padding:8px;border:1px solid #dbe3e9;border-radius:8px;background:#f6f9fb;font-size:12px}
.cf-gal figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px;border:1px solid #dbe3e9;border-radius:6px;background:#fff}
.cf-gal figure.on{border:2px solid #3f6591}.cf-gal svg{display:block}
`;
const item = ([l, v, x, y, w, h, cls], sel) => `<div class="cf-i ${cls}${sel ? " sel" : ""}" style="grid-column:${x + 1}/span ${w};grid-row:${y + 1 + (y >= 3 ? 3 : y >= 2 ? 2 : 1)}/span ${h}"><small>${l}</small><b>${v}</b>`
  + (sel ? '<i class="cf-h tl"></i><i class="cf-h tr"></i><i class="cf-h bl"></i><i class="cf-h br"></i>' : "") + "</div>";
const grid = (edit, sel = "合金・調質") => `<div class="cf${edit ? " edit" : ""}">`
  + SEC.map(([n, y], k) => `<div class="cf-sec" style="grid-row:${y + 1 + k}">${n}</div>`).join("")
  + ITEMS.map((it) => item(it, edit && it[0] === sel)).join("") + "</div>";
const pop = (top, left) => `<div class="cf-pop" style="top:${top}px;left:${left}px"><h5>項目「合金・調質」<small style="color:#5d6b77;font-weight:400">ダブルクリックで開いた所</small></h5>
  <label>名前<input value="合金・調質"></label><label>中身<input value="[合金] & ' / ' & [調質]"></label>
  <label>字<select><option>大きさ 中・太字</option></select></label><label>色<span class="cf-sw"><i style="background:#fff"></i><i style="background:#f3f8fc"></i><i style="background:#fdeee9"></i><i style="background:#e3f3ea"></i></span></label></div>`;
const ED = (html) => ["script", `
  const H = ${JSON.stringify(html)};
  const go = () => {
    const w = document.querySelector('.ll-cardwin:not([hidden])'); if (!w) return;
    const edit = !!w.querySelector('.lk-foot:not([hidden])'), mode = edit ? 'e' : 'v';
    const body = w.querySelector('.lk-body'), tools = w.querySelector('.lk-tools');
    let m = body.querySelector('.cf-mock');
    if (!m || m.dataset.mode !== mode) { if (m) m.remove(); body.insertAdjacentHTML('beforeend', '<div class="cf-mock" data-mode="' + mode + '">' + (edit ? H.edit : H.view) + '</div>'); }
    if (!tools.querySelector('.cf-t') || tools.dataset.mode !== mode) { tools.dataset.mode = mode; tools.innerHTML = '<span class="cf-t" style="display:contents">' + (edit ? H.tools : H.vtools) + '</span>'; }
    document.querySelectorAll('.cf-out').forEach((x) => { if (!edit) x.remove(); });
    if (H.outside && edit && !document.querySelector('.cf-out')) { document.body.insertAdjacentHTML('beforeend', '<div class="cf-out">' + H.outside + '</div>'); const x = document.querySelector('.cf-out [data-left]'); if (x) x.style.left = (w.getBoundingClientRect().left - 312) + 'px'; }
  };
  new MutationObserver(() => { try { go(); } catch (e) {} }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });`];
const vtools = '<span style="font-size:12.5px;color:#5d6b77">デザイン <b style="color:#1b2733">標準</b>（全員の既定）</span><span style="flex:1"></span><button type="button" class="cf-b" data-edit>デザインを直す</button>';
const tools = (extra) => `<div class="cf-bar" style="width:100%"><b title="四隅で大きさ・掴んで動かす・ダブルクリックで中身">デザインを直しています</b><span class="sp"></span>${extra}<button type="button" class="cf-b">保存 ▾</button><button type="button" class="cf-b pri">終える</button></div>`;
export const PROPOSALS = [
  { key: "A", name: "見出しの下に細い編集の帯・ダブルクリックは項目の横の面", css,
    ops: [ED({ view: grid(false), vtools, tools: tools('<button type="button" class="cf-b">＋ 項目</button><button type="button" class="cf-b">＋ 組み合わせ</button><button type="button" class="cf-b">見栄え ▾</button>'),
      edit: `<div style="position:relative">${grid(true)}${pop(286, 230)}</div>` })] },
  { key: "B", name: "カードの右に別の「プロパティ」の窓（カードは変わらない）", css,
    ops: [ED({ view: grid(false), vtools, tools: tools('<button type="button" class="cf-b">＋ 項目</button><button type="button" class="cf-b">＋ 組み合わせ</button>'), edit: grid(true),
      outside: `<div class="cf-insp" style="top:120px;" data-left><h4>プロパティ <small style="color:#5d6b77;font-weight:400">選んだ項目</small></h4><label>名前<input value="合金・調質"></label><label>中身<input value="[合金] & ' / ' & [調質]"></label><label>位置<input value="横 1〜4 列・縦 3 段目"></label><label>字<select><option>中・太字</option></select></label><label>地の色<span class="cf-sw"><i style="background:#fff"></i><i style="background:#f3f8fc"></i><i style="background:#fdeee9"></i></span></label><label>枠<select><option>細い線</option></select></label><hr style="width:100%;border:0;border-top:1px solid #e6edf3"><h4>カード全体</h4><label>列<select><option>12 列</option></select></label><label>色の組<select><option>標準（藍）</option></select></label></div>` })] },
  { key: "C", name: "左に列の札の棚（引いて置く）・ダブルクリックは項目の中の面", css,
    ops: [ED({ view: grid(false), vtools, tools: tools('<button type="button" class="cf-b">＋ 組み合わせ</button><button type="button" class="cf-b">見栄え ▾</button>'),
      edit: `<div class="cf-wrap"><div class="cf-shelf"><b>置いていない列</b><span>⠿ 客先</span><span>⠿ 入力日時</span><span>⠿ 項目01</span><span>⠿ 項目02</span><span>⠿ 項目03</span><small style="color:#5d6b77">カードへ引いて置く</small></div><div style="position:relative">${grid(true)}${pop(286, 180)}</div></div>` })] },
  { key: "D", name: "カードの上にリボン（配置・見栄え・組み合わせ・保存のタブ）", css,
    ops: [ED({ view: grid(false), vtools, tools: `<div class="cf-rib" style="width:100%"><div class="tabs"><span class="on">配置</span><span>見栄え</span><span>組み合わせ</span><span>保存</span><span style="margin-left:auto;padding-right:4px"><button type="button" class="cf-b pri">終える</button></span></div><div class="row"><button type="button" class="cf-b">＋ 項目</button><button type="button" class="cf-b">そろえる ▾</button><button type="button" class="cf-b">同じ大きさに</button><button type="button" class="cf-b">方眼に吸い付く ✓</button><button type="button" class="cf-b">隠した項目 ▾</button></div></div>`,
      edit: `<div style="position:relative">${grid(true)}${pop(286, 230)}</div>` })] },
  { key: "E", name: "帯は出さず、右クリックと選んだ項目の上の浮かぶ小さな道具だけ", css,
    ops: [ED({ view: grid(false), vtools, tools: '<span style="font-size:12.5px;color:#8a5a00;font-weight:700">デザインを直しています（右クリックで足す・保存）</span><span style="flex:1"></span><button type="button" class="cf-b pri">終える</button>',
      edit: `<div style="position:relative">${grid(true)}<div class="cf-mini" style="top:186px;left:20px"><button title="字を大きく">A＋</button><button title="太字">B</button><button title="色" style="color:#c0392b">●</button><button title="中身">ƒ</button><button title="隠す">×</button></div></div>` })] },
  { key: "F", name: "編集に入るとデザインの見本を絵で並べ、選んでから直す", css,
    ops: [ED({ view: grid(false), vtools, tools: tools('<button type="button" class="cf-b">＋ 項目</button><button type="button" class="cf-b">＋ 組み合わせ</button>'),
      edit: `<div class="cf-gal">${["標準", "要点だけ", "横長", "2 段"].map((n, k) => `<figure class="${k ? "" : "on"}"><svg width="70" height="44" viewBox="0 0 70 44"><rect x="1" y="1" width="68" height="42" rx="4" fill="#fff" stroke="#9fb3bf"/>${k === 1 ? '<rect x="6" y="6" width="58" height="14" rx="2" fill="#c9d8e8"/><rect x="6" y="24" width="28" height="14" rx="2" fill="#e6edf3"/><rect x="36" y="24" width="28" height="14" rx="2" fill="#e6edf3"/>' : k === 2 ? '<rect x="6" y="6" width="18" height="32" rx="2" fill="#c9d8e8"/><rect x="26" y="6" width="18" height="32" rx="2" fill="#e6edf3"/><rect x="46" y="6" width="18" height="32" rx="2" fill="#e6edf3"/>' : '<rect x="6" y="6" width="18" height="10" rx="2" fill="#c9d8e8"/><rect x="26" y="6" width="18" height="10" rx="2" fill="#c9d8e8"/><rect x="46" y="6" width="18" height="10" rx="2" fill="#c9d8e8"/><rect x="6" y="20" width="28" height="8" rx="2" fill="#e6edf3"/><rect x="36" y="20" width="28" height="8" rx="2" fill="#e6edf3"/><rect x="6" y="31" width="58" height="8" rx="2" fill="#e6edf3"/>'}</svg>${n}</figure>`).join("")}<span style="align-self:center;color:#5d6b77">見本を選んでから、四隅・ダブルクリックで直します</span></div><div style="position:relative">${grid(true)}${pop(286, 230)}</div>` })] },
];
