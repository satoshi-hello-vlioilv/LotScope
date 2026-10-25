// 2026-10 カードの設計。2 回目（合格点 80 点。1 回目は A 77.8 点で届かず）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-cardform-2.mjs --states card,card-edit --from card
// 1 回目の採点で低かった所: ①ダブルクリックの面が 1280 でカードの下の縁で切れ、隣の項目を覆う ②編集の帯が見るときの行より約 16px 高く、方眼が下がる
//   ③見るときのカードの方眼の上に空き ④道具を記号・右クリックだけにすると探させる ⑤見本・棚を常に出すとカードが狭まる・下がる
// 直し方（どの案も）: 見るときの行と編集の帯を同じ高さ 32px の 1 段に（方眼が 1px も動かない）・ダブルクリックの面は窓の上に浮かぶ面
//   （カードの縁で切らず、下に空きが無ければ上に開く。選んだ項目の横に寄せ、なるべく隣を覆わない）・道具は字のボタン
// 案の方向:
//   A2 持ち越し: 1 回目の A ＋ 上の直し（帯は 1 段・面は浮かぶ・上下に開く）
//   G 見せ方（新）: ダブルクリックでその項目がその場で直す形になる（名前を打てる・すぐ下に字の付いた見栄えの札の段が浮かぶ）
//   H 置き場（新）: ダブルクリックの面はカードの左の縁の外に付き、選んだ項目へ矢印で結ぶ（カードと一緒に動く。カードの中は覆わない）
//   J 減らし方（新）: 帯は 1 段のまま、「＋ 項目 ▾」「デザイン ▾」の面に、置いていない列の棚と標準の見本を畳む（開いた所を撮る）
//   K 流れ（新）: 1 回目の E（右クリック・浮かぶ道具）＋字の付いた浮かぶ道具を選んだ項目の右に（見出しを覆わない）と、同じ高さの帯の「＋ 項目・保存」
const ITEMS = [  // [ラベル, 値, x, y, w, h, 見栄え]
  ["不良名", "打痕", 0, 0, 4, 2, "big red"], ["設備", "L-2", 4, 0, 4, 2, "big"], ["発生日", "2026/05/01", 8, 0, 4, 2, "big"],
  ["合金・調質", "A1100 / H14", 0, 2, 4, 1, "combo"], ["板厚 × 板幅", "1e-05 × 1019", 4, 2, 4, 1, "combo"], ["重量", "3,705.3 kg", 8, 2, 4, 1, ""],
  ["検査日", "2026/05/02", 0, 3, 3, 1, ""], ["検査番号", "N334083", 3, 3, 3, 1, ""], ["工程", "圧延", 6, 3, 3, 1, ""], ["担当", "担当1", 9, 3, 3, 1, ""],
  ["長さ", "4,963.91", 0, 4, 3, 1, ""], ["比重", "2.73", 3, 4, 3, 1, ""], ["鋳造番号", "J82G25A", 6, 4, 3, 1, ""], ["数量", "54", 9, 4, 3, 1, ""],
  ["備考", "—", 0, 5, 12, 2, "muted"],
];
const SEC = [["不良", 0], ["製造条件", 2], ["検査", 3]];
const css = `
.lk-body .lk-grid{display:none!important}.lk-foot,.lk-tray{display:none!important}.lk-tools{display:flex;align-items:center;gap:8px;min-height:32px;padding-top:4px;padding-bottom:4px}.lk-body{padding-top:6px!important}
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
.cf-bar{flex:1 1 100%;display:flex;align-items:center;gap:6px;flex-wrap:nowrap;height:32px;box-sizing:border-box;padding:0 8px;border:1px solid #ecd29a;border-radius:8px;background:#fff8ea;font-size:13px}
.cf-bar b{color:#8a5a00}.cf-bar .sp{flex:1}
.cf-b{height:24px;padding:0 10px;border:1px solid #dbe3e9;border-radius:6px;background:#fff;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
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
.cf-pop[data-float]{z-index:90}
.cf-pop::before{content:"";position:absolute;width:12px;height:12px;background:#fff;border-left:1px solid #b9ccd4;border-top:1px solid #b9ccd4;transform:rotate(45deg);top:-7px;left:24px}
.cf-pop.up::before{top:auto;bottom:-7px;transform:rotate(225deg)}
.cf-side{position:fixed;z-index:90;width:280px;padding:10px 12px;border:1px solid #b9ccd4;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(12,34,48,.22);font-size:12.5px;display:flex;flex-direction:column;gap:7px}
.cf-side h5{margin:0;font-size:13px}.cf-side label{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:6px}
.cf-side input,.cf-side select{height:26px;border:1px solid #ecd29a;border-radius:5px;background:#fffdf8;font:inherit;font-size:12.5px;padding:0 6px;min-width:0}
.cf-arrow{position:fixed;z-index:89;height:2px;background:#e6a52e}
.cf-chips{position:fixed;z-index:90;display:flex;gap:4px;padding:4px;border:1px solid #b9ccd4;border-radius:8px;background:#fff;box-shadow:0 8px 20px rgba(12,34,48,.2);font-size:12px}
.cf-chips button{height:24px;padding:0 8px;border:1px solid #dbe3e9;border-radius:6px;background:#fff;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.cf-chips button.on{border-color:#e6a52e;background:#fff8ea;font-weight:700}
.cf-i.inline small{display:none}.cf-i.inline .cf-in{height:20px;border:1px solid #e6a52e;border-radius:4px;font:inherit;font-size:12px;padding:0 4px;width:70%}
.cf-menu{position:fixed;z-index:90;width:340px;padding:8px;border:1px solid #b9ccd4;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(12,34,48,.22);font-size:12.5px;display:flex;flex-direction:column;gap:6px}
.cf-menu h5{margin:2px 2px 0;font-size:12px;color:#5d6b77}.cf-menu .chips{display:flex;flex-wrap:wrap;gap:4px}.cf-menu .chips span{padding:3px 8px;border:1px dashed #9fb3bf;border-radius:6px;background:#fff}
`;
const item = ([l, v, x, y, w, h, cls], sel) => `<div class="cf-i ${cls}${sel ? " sel" : ""}" style="grid-column:${x + 1}/span ${w};grid-row:${y + 1 + (y >= 3 ? 3 : y >= 2 ? 2 : 1)}/span ${h}"><small>${l}</small><b>${v}</b>`
  + (sel ? '<i class="cf-h tl"></i><i class="cf-h tr"></i><i class="cf-h bl"></i><i class="cf-h br"></i>' : "") + "</div>";
const grid = (edit, sel = "合金・調質") => `<div class="cf${edit ? " edit" : ""}">`
  + SEC.map(([n, y], k) => `<div class="cf-sec" style="grid-row:${y + 1 + k}">${n}</div>`).join("")
  + ITEMS.map((it) => item(it, edit && it[0] === sel)).join("") + "</div>";
const pop = () => `<div class="cf-pop" data-float style="position:fixed"><h5>項目「合金・調質」<small style="color:#5d6b77;font-weight:400">ダブルクリックで開いた所</small></h5>
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
    const sel = w.querySelector('.cf-mock .cf-i.sel');
    if (edit && sel && H.float && !document.querySelector('.cf-fl')) {
      document.body.insertAdjacentHTML('beforeend', '<div class="cf-fl">' + H.float + '</div>');
      const r = sel.getBoundingClientRect(), wr = w.getBoundingClientRect();
      document.querySelectorAll('.cf-fl [data-float]').forEach((f) => { const h = f.offsetHeight, ww = f.offsetWidth;
        const down = innerHeight - r.bottom - 10 >= h; f.classList.toggle('up', !down);
        f.style.top = Math.max(8, down ? r.bottom + 10 : r.top - h - 10) + 'px'; f.style.left = Math.min(innerWidth - ww - 8, Math.max(8, r.left)) + 'px'; });
      document.querySelectorAll('.cf-fl [data-chips]').forEach((f) => { f.style.top = (r.bottom + 6) + 'px'; f.style.left = Math.max(8, r.left) + 'px'; });
      document.querySelectorAll('.cf-fl [data-mini]').forEach((f) => { f.style.top = (r.top + (r.height - f.offsetHeight) / 2) + 'px'; f.style.left = Math.min(innerWidth - f.offsetWidth - 8, r.right + 8) + 'px'; });
      document.querySelectorAll('.cf-fl [data-side]').forEach((f) => { f.style.left = Math.max(8, wr.left - f.offsetWidth - 14) + 'px'; f.style.top = Math.max(8, Math.min(innerHeight - f.offsetHeight - 8, r.top - 20)) + 'px';
        const a = document.querySelector('.cf-fl .cf-arrow'); if (a) { a.style.left = (wr.left - 14) + 'px'; a.style.width = (r.left - wr.left + 14) + 'px'; a.style.top = (r.top + r.height / 2) + 'px'; } });
      document.querySelectorAll('.cf-fl [data-under]').forEach((f) => { const b = document.querySelector(f.dataset.under); if (!b) return; const q = b.getBoundingClientRect(); f.style.top = (q.bottom + 4) + 'px'; f.style.left = Math.min(innerWidth - f.offsetWidth - 8, q.left) + 'px'; });
    }
    if (!edit) document.querySelectorAll('.cf-fl').forEach((x) => x.remove());
    if (H.outside && edit && !document.querySelector('.cf-out')) { document.body.insertAdjacentHTML('beforeend', '<div class="cf-out">' + H.outside + '</div>'); const x = document.querySelector('.cf-out [data-left]'); if (x) x.style.left = (w.getBoundingClientRect().left - 312) + 'px'; }
  };
  new MutationObserver(() => { try { go(); } catch (e) {} }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });`];
const vtools = '<span class="cf-vrow" style="display:flex;align-items:center;gap:8px;width:100%;height:32px"><span style="font-size:12.5px;color:#5d6b77">デザイン <b style="color:#1b2733">標準</b>（全員の既定）</span><span style="flex:1"></span><button type="button" class="cf-b" data-edit>デザインを直す</button></span>';
const tools = (extra) => `<div class="cf-bar" style="width:100%"><b title="四隅で大きさ・掴んで動かす・ダブルクリックで中身">デザインを直しています</b><span class="sp"></span>${extra}<button type="button" class="cf-b">保存 ▾</button><button type="button" class="cf-b pri">終える</button></div>`;

const tools2 = (extra) => `<div class="cf-bar"><b title="四隅で大きさ・掴んで動かす・ダブルクリックで中身">デザインを直しています</b><span class="sp"></span>${extra}<button type="button" class="cf-b">保存 ▾</button><button type="button" class="cf-b pri">終える</button></div>`;
const STD = '<button type="button" class="cf-b">＋ 項目</button><button type="button" class="cf-b">＋ 組み合わせ</button><button type="button" class="cf-b">見栄え ▾</button>';
export const PROPOSALS = [
  { key: "A2", name: "1 回目の A ＋ 帯は 1 段・ダブルクリックの面は浮かび上下に開く", css,
    ops: [ED({ view: grid(false), vtools, tools: tools2(STD), edit: grid(true), float: pop() })] },
  { key: "G", name: "ダブルクリックでその項目がその場で直す形に（名前を打つ・下に見栄えの札）", css,
    ops: [ED({ view: grid(false), vtools, tools: tools2(STD), edit: grid(true).replace('class="cf-i combo sel"', 'class="cf-i combo sel inline"').replace('<small>合金・調質</small><b>A1100 / H14</b>', '<small>合金・調質</small><input class="cf-in" value="合金・調質"><b>A1100 / H14</b>'),
      float: '<div class="cf-chips" data-chips><button class="on">字 中</button><button>大</button><button>太字</button><button>色 ▾</button><button>地 ▾</button><button>名前を左に</button><button>中身（式）…</button><button>外す</button></div>' })] },
  { key: "H", name: "ダブルクリックの面はカードの左の縁の外に付き、矢印で項目と結ぶ", css,
    ops: [ED({ view: grid(false), vtools, tools: tools2(STD), edit: grid(true),
      float: `<div class="cf-side" data-side><h5>項目「合金・調質」</h5><label>名前<input value="合金・調質"></label><label>中身<input value="[合金] & ' / ' & [調質]"></label><label>字<select><option>大きさ 中・太字</option></select></label><label>色<span class="cf-sw"><i style="background:#fff"></i><i style="background:#f3f8fc"></i><i style="background:#fdeee9"></i><i style="background:#e3f3ea"></i></span></label><label>名前の位置<select><option>上</option></select></label></div><i class="cf-arrow"></i>` })] },
  { key: "J", name: "帯は 1 段・「＋ 項目 ▾」の面に置いていない列と標準の見本を畳む（開いた所）", css,
    ops: [ED({ view: grid(false), vtools, tools: tools2('<button type="button" class="cf-b" id="cfAddJ" style="border-color:#e6a52e;background:#fff8ea">＋ 項目 ▾</button><button type="button" class="cf-b">デザイン ▾</button><button type="button" class="cf-b">見栄え ▾</button>'), edit: grid(true),
      float: '<div class="cf-menu" data-under="#cfAddJ"><h5>置いていない列（押すと空いた所へ・カードへ引いて置く）</h5><div class="chips"><span>⠿ 客先</span><span>⠿ 入力日時</span><span>⠿ 項目01</span><span>⠿ 項目02</span><span>⠿ 項目03</span></div><h5>作る</h5><div class="chips"><span>＋ 組み合わせた項目（式）</span><span>＋ 見出しの線</span><span>＋ 字</span></div></div>' })] },
  { key: "K", name: "右クリック＋選んだ項目の右に字の付いた浮かぶ道具・帯に＋項目と保存", css,
    ops: [ED({ view: grid(false), vtools, tools: tools2('<button type="button" class="cf-b">＋ 項目</button>'), edit: grid(true),
      float: '<div class="cf-chips" data-mini><button>字 大</button><button>太字</button><button>色 ▾</button><button>地 ▾</button><button>中身（式）…</button><button>名前…</button><button>外す</button></div>' })] },
];
