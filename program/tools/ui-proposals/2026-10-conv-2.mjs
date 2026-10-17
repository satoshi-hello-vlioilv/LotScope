// 2026-10 変換表（版 3.42.0）: 2 回目（合格点 90 点）。1 回目（2026-10-conv.mjs）の採点の指摘を土台で直した:
//   判定表は出す値を番号の次に（1280 で切れない）・不問は「–」で 4.5 以上の色・「または」は縦に積む（字の途中で折れない）・マスタの項目の差し込みは 1 回だけ。
//   当てる入口は、列の一覧を隠さない・当てた列の行に「変換」の札を出す。
// 案: G（C を直す: 1 段の帯）・H（F を直す: 帯＋帯の下に開く選び）・I（新: 上の段の「変換表 ▾」の面）・J（新: 列の一覧に「変換」の列）・K（新: 当てた後の帯と元に戻す）
// 以下、1 回目の説明
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-conv-2.mjs --states columns,master-egroups
//   （1280x720 でも: --view 1280x720）
// 今の物を撮って見えたこと（作る前・版 3.41.0。columns-detail・master-egroups）:
//   ・表示列の設定は、上の段に「＋ 列を作る」「幅を内容に合わせる」、右に列ごとの段（見せ方・この列の作り方・値の整え方・読み替え）。
//     表全体にまとめて当てる入口が無く、M 言語のサンプル 1 のように 5 列を一度に読み替えるには、列ごとに式を書くしかない（手が列の数だけ増える）
//   ・どの列が変換表で作り替えられているか・どの変換表が当てられるかは、どこにも出ない（探させる・推測させる）
//   ・マスタ管理は左に項目、設備グループは「左に登録済み・右に直す所」。判定表（入力×行の条件）を見せる形は無い
// 案の方向（何で解くか）:
//   A 置き場: 「＋ 列を作る」の隣に「変換表…」。押すと左の面が変換表のカード（当てる列・できるか）に替わり、選んで「まとめて当てる」
//   B 流れ（列単位）: 列ごとの段に「変換表で読み替え」。足す列は「＋ 列を作る ▾」のメニューに変換表
//   C 先回り: 列の一覧の上に帯「この表に当てられる変換表 6 つ［まとめて当てる］」。当てた列の行に札
//   D 減らし方: 一覧の道具の行の「変換」ボタン → 浮かぶ面で表ごとに ON/OFF（保存は要らない・すぐ効く）
//   E 置き場（マスタ）: 当てる入口はマスタ管理の変換表だけ（編集の右上に「いまの一覧に当てる」）
//   F 合わせ技: C の帯＋「選ぶ…」で A のカード面
// 編集（マスタ）の見せ方: A・C・D・E・F は判定表（入力ごとの列×行。セルは「＝ NFCE・NSCR」「T で始まらない」「≦ 30」の札）、
//   B は文の行（「形状区分が 箔 かつ 材質が NFCE または NSCR なら → 並純箔」）。D はコード表を 2 列の簡易表で見せる
let seq = 0;
const watch = (sel, fn) => { const k = `pv${++seq}`; return ["script", `{ const run = () => { document.querySelectorAll(${JSON.stringify(sel)}).forEach((el) => { if (el.dataset.${k}) return; el.dataset.${k} = "1"; (${fn})(el); }); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true }); run(); }`]; };
const q = (s) => JSON.stringify(s);

// ---------------------------------------------------------------- 見本のデータ
const TABLES = [
  ["コードの読み替え", "ｺﾝﾏ5本区分", "ｺﾝﾏ5本ｶｰﾄﾞ区分", "0 → 0:一本口・1 → 1:厚別親 …（5 つ）", "ok"],
  ["コードの読み替え", "地取区分", "地取区分", "0 → 0:一般・2 → 2:再手配 …（5 つ）", "ok"],
  ["コードの読み替え", "納期符号", "", "1 → 1:事前約束品・C → C:中間素材 …（13）", "none"],
  ["コードの読み替え", "特急区分", "特急区分", "0 → 空欄・1 → 約・2 → 特", "ok"],
  ["コードの読み替え", "保留区分", "", "1 → 工・2 → R …（9 つ）", "none"],
  ["判定して列を足す", "形状区分", "表面・形状・用途ｺｰﾄﾞ", "HOT・2HI・箔・4HIｺｲﾙ・4HIｻｰｸﾙ・4HI板（6 行）", "ok"],
  ["判定して列を足す", "管理分類", "形状区分・ｵｰﾀﾞｰ材質 …（6 列）", "並純箔・ﾊﾟｲﾗｰ材 …（35 行）", "ok"],
  ["判定して列を足す", "課名", "BOX実績_設備名", "設備 → 熱延課・仕上課 …（13 行）", "ok"],
];
const ROWS = [ // 管理分類の先頭の行（形状区分・材質・調質・板厚・板幅・用途 → 出す値）
  [["＝ 箔"], ["＝ NFCE・NSCR"], [], [], [], [], "並純箔", ""],
  [["＝ 箔"], [], [], [], [], [], "PH対策材", ""],
  [["＝ HOT"], [], ["＝ R"], ["8 〜 10"], [], [], "8･10mm", ""],
  [["＝ HOT・2HI"], [], ["T で始まらない"], ["≦ 30"], [], [], "ﾊﾟｲﾗｰ材", ""],
  [["＝ HOT"], [], ["T で始まらない"], ["30 ＜ 〜 ≦ 75"], [], [], "ｸﾚｰﾝ材", ""],
  [["＝ HOT"], [], [], [], [], [], "ﾄﾝｸﾞ･極厚材", ""],
  [["＝ 2HI"], ["＝ 61S"], ["T で始まる"], ["≦ 30"], [], [], "61S_8-30mm", "名前は 8-30mm ですが、条件は板厚 30 以下だけです"],
  [["＝ 2HI"], ["＝ 61S"], ["T で始まる"], ["＞ 30"], [], [], "61S_31mm以上", ""],
  [["＝ 4HI板"], [], ["T で始まらない"], ["3.1 〜 ＜ 6"], [], ["≠ H259"], "TULｺｰｽ", ""],
  [["＝ 4HIｺｲﾙ"], ["＝ NP56・N532", "5MB で始まる", "52S で終わる"], [], [], [], [], "5XXX系･ｸﾘﾔｰ以外", ""],
];
const INPUTS = [["形状区分", "字"], ["ｵｰﾀﾞｰ材質", "字"], ["ｵｰﾀﾞｰ調質", "字"], ["ｵｰﾀﾞｰ板厚", "数"], ["ｵｰﾀﾞｰ板幅", "数"], ["用途ｺｰﾄﾞ", "字"]];

// ---------------------------------------------------------------- 共通の見た目
const css = `
.cv-btn{height:32px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
.cv-btn.pri{background:var(--h-input);border-color:var(--h-input);color:#fff}
.cv-btn.teal{background:#0f766e;border-color:#0f766e;color:#fff}
.cv-btn.ghost{background:transparent}
.cv-tag{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:999px;font-size:11.5px;font-weight:800;white-space:nowrap}
.cv-tag.ok{background:#e3f4f1;color:#0f5f58}.cv-tag.none{background:#f1f3f6;color:#6b7785}.cv-tag.on{background:#e7eef8;color:#244569}
.cv-cards{display:flex;flex-direction:column;gap:6px;padding:10px 14px;overflow:auto;flex:1 1 auto;min-height:0}
.cv-grp{font-size:11.5px;font-weight:800;color:#6b7785;margin:6px 2px 0}
.cv-card{display:grid;grid-template-columns:22px 1fr auto;gap:2px 10px;align-items:center;padding:8px 12px;border:1px solid var(--line);border-radius:9px;background:#fff}
.cv-card.is-none{background:#f8f9fb;color:#8a95a3}
.cv-card b{font-size:14px}.cv-card small{grid-column:2/4;color:#5c6b7a;font-size:12px}
.cv-card .cv-cols{grid-column:2/4;font-size:12px;color:#244569}
.cv-card input{width:16px;height:16px;margin:0}
.cv-pane{display:flex;flex-direction:column;height:100%;min-height:0}
.cv-panehead{display:flex;align-items:center;gap:8px;padding:12px 14px 4px}
.cv-panehead h4{margin:0;font-size:15px}.cv-panehead .sp{flex:1}
.cv-panefoot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--line);background:#fafbfc}
.cv-panefoot .sp{flex:1}.cv-panefoot small{color:#5c6b7a;font-size:12.5px}
.cv-strip{display:flex;align-items:center;gap:10px;margin:6px 14px 4px;padding:8px 12px;border-radius:9px;background:#e9f5f3;border:1px solid #b9e0da;color:#0f4f49;font-size:13px}
.cv-strip b{font-weight:800}.cv-strip .sp{flex:1}.cv-strip small{color:#2f6b64}
.lc-row .cv-on{margin-left:6px}
/* マスタ: 左に表の一覧・右に直す所 */
.cv-m{display:grid;grid-template-columns:270px 1fr;gap:16px;height:100%;min-height:0;padding:4px 2px}
.cv-mlist{border:1px solid var(--line);border-radius:10px;background:#fff;padding:10px;overflow:auto}
.cv-mlist h5{margin:8px 4px 4px;font-size:11.5px;color:#6b7785}
.cv-mi{display:block;width:100%;text-align:left;padding:7px 10px;margin:2px 0;border:1px solid transparent;border-radius:8px;background:transparent;font:inherit;cursor:pointer}
.cv-mi b{display:block;font-size:13.5px}.cv-mi small{color:#6b7785;font-size:11.5px}
.cv-mi.on{border-color:#7fa3cf;background:#eef3f9}
.cv-ed{border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:10px;background:#fff;padding:12px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;min-width:0}
.cv-edhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.cv-edhead h4{margin:0;font-size:17px}.cv-edhead .sp{flex:1}
.cv-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:#4b5f72}
.cv-ins{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px}
.cv-in{padding:3px 9px;border-radius:7px;background:#f1f5fa;border:1px solid #d5e0ec;font-weight:700}
.cv-in i{font-style:normal;color:#7a8794;font-weight:400;margin-left:4px}
.cv-grid{border-collapse:separate;border-spacing:0;font-size:12.5px;width:100%}
.cv-grid th{position:sticky;top:0;background:#f3f6f9;color:#4b5f72;font-weight:800;text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.cv-grid td{padding:5px 8px;border-bottom:1px solid #eef1f4;vertical-align:top}
.cv-grid td.no{color:#8a95a3;width:24px;text-align:right}
.cv-grid td.out{font-weight:800;color:#163a5f;white-space:nowrap}
.cv-grid td.out::before{content:"→ ";color:#8a95a3;font-weight:400}
.cv-c{display:inline-block;margin:1px 3px 1px 0;padding:1px 7px;border-radius:6px;background:#eef3f9;color:#244569;white-space:nowrap}
.cv-any{color:#6b7785}
.cv-c{display:block;width:max-content;max-width:100%}.cv-or2{display:block;color:#5c6b7a;font-size:11px}
.cv-grid td.out::before{content:""}.cv-grid td.out{border-right:1px solid #e3e8ee}
.lc-row .cv-row{margin-left:6px}
.cv-pick{margin:0 14px 6px;border:1px solid #b9e0da;border-radius:9px;background:#fff;padding:6px 8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 10px;font-size:12.5px}
.cv-pick label{display:flex;gap:6px;align-items:center;padding:3px 4px;border-radius:6px}.cv-pick label.is-none{color:#6b7785}
.cv-colconv{font-size:12px;color:#0f5f58;display:inline-flex;align-items:center;gap:4px;margin-left:auto;padding-right:6px}
.cv-strip{flex-wrap:nowrap;white-space:nowrap}.cv-strip > span:nth-child(2){overflow:hidden;text-overflow:ellipsis}
.cv-note{display:inline-block;width:16px;height:16px;border-radius:50%;background:#fff3d6;color:#8a5a00;font-size:11px;text-align:center;line-height:16px;font-weight:800;margin-left:4px}
.cv-other{font-size:12.5px;color:#4b5f72;padding:6px 8px;background:#fafbfc;border-radius:7px}
.cv-sent{display:flex;flex-direction:column;gap:6px}
.cv-s{display:flex;gap:8px;align-items:baseline;padding:7px 10px;border:1px solid #e3e8ee;border-radius:8px;font-size:13px;line-height:1.7}
.cv-s .no{color:#8a95a3;width:20px;text-align:right;flex:0 0 auto}.cv-s b{color:#163a5f}
.cv-s em{font-style:normal;color:#0f766e;font-weight:700}
.cv-map{border-collapse:collapse;font-size:13px}.cv-map td,.cv-map th{padding:5px 12px;border-bottom:1px solid #eef1f4;text-align:left}
.cv-pop{position:fixed;top:150px;left:1060px;width:440px;z-index:60;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(16,40,70,.22);padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.cv-pop h4{margin:0 0 4px;font-size:14px}
.cv-tg{display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid #f0f2f5;font-size:13px}
.cv-tg .sp{flex:1}.cv-tg small{color:#6b7785}
.cv-sw{width:34px;height:20px;border-radius:999px;background:#cfd6de;position:relative;flex:0 0 auto}.cv-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff}
.cv-sw.on{background:#0f766e}.cv-sw.on::after{left:16px}
`;

// ---------------------------------------------------------------- 部品（頁の中で動く JavaScript の字）
const H = `const T=${q(TABLES)},R=${q(ROWS)},I=${q(INPUTS)};
const tag=(s)=>s==="ok"?'<span class="cv-tag ok">当てられる</span>':s==="on"?'<span class="cv-tag on">当てた</span>':'<span class="cv-tag none">列がありません</span>';
const cards=(chk)=>{let g="",h="";T.forEach(([grp,name,cols,what,st])=>{if(grp!==g){g=grp;h+='<div class="cv-grp">'+grp+'</div>';}
 h+='<label class="cv-card'+(st==="none"?" is-none":"")+'"><input type="checkbox"'+(st==="ok"&&chk?" checked":"")+(st==="none"?" disabled":"")+'><b>'+name+'</b>'+tag(st)
 +'<span class="cv-cols">'+(cols?(grp==="コードの読み替え"?"列「"+cols+"」の値を読み替え":"列「"+name+(name==="課名"?"」を「BOX実績_設備名_課」として":"」を")+"足す（"+cols+" から）"):"この表に「"+name+"」の列がありません")+'</span><small>'+what+'</small></label>';});return h;};
const grid=()=>'<table class="cv-grid"><thead><tr><th></th><th>出す値</th>'+I.map(([n,t])=>'<th>'+n+(t==="数"?' <small>(数)</small>':'')+'</th>').join("")+'</tr></thead><tbody>'
 +R.map((r,i)=>'<tr><td class="no">'+(i+1)+'</td><td class="out">'+r[6]+(r[7]?'<span class="cv-note" title="'+r[7]+'">!</span>':'')+'</td>'+r.slice(0,6).map((c)=>'<td>'+(c.length?c.map((x)=>'<span class="cv-c">'+x+'</span>').join('<small class="cv-or2">または</small>'):'<span class="cv-any">–</span>')+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
const sent=()=>'<div class="cv-sent">'+R.map((r,i)=>{const parts=r.slice(0,6).map((c,k)=>c.length?I[k][0]+' が <em>'+c.join(' または ')+'</em>':'').filter(Boolean);
 return '<div class="cv-s"><span class="no">'+(i+1)+'</span><span>'+(parts.length?parts.join(' かつ '):'どれでも')+' なら → <b>'+r[6]+'</b></span></div>';}).join("")+'</div>';
const mlist=()=>{let g="",h="";T.forEach(([grp,name,cols,what])=>{if(grp!==g){g=grp;h+='<h5>'+grp+'</h5>';}h+='<button class="cv-mi'+(name==="管理分類"?" on":"")+'"><b>'+name+'</b><small>'+what+'</small></button>';});
 return h+'<button class="cv-btn ghost" style="width:100%;margin-top:8px;border-style:dashed">＋ 変換表を足す</button>';};
const navConv=()=>{const tabs=document.querySelector("#masterTabs");if(!tabs||document.querySelector("#masterTabs .cv-nav"))return;const eg=tabs.querySelector('[data-tab="egroups"]');
 tabs.querySelectorAll(".tab").forEach((b)=>b.classList.remove("active"));const b=eg.cloneNode(true);b.classList.add("cv-nav","active");b.removeAttribute("data-tab");b.textContent="変換表";eg.after(b);};
const edHead=(extra)=>'<div class="cv-edhead"><h4>管理分類</h4><span class="cv-tag on">プリセット</span><span class="sp"></span>'+(extra||'')+'<button class="cv-btn ghost">標準に戻す</button><button class="cv-btn pri">保存</button></div>'
 +'<div class="cv-meta"><span>当て方: <b>列「管理分類」を足す・いちばん左</b></span><span>どれにも当たらないとき: <b>その他</b></span><span>式: <code>conv(\\'管理分類\\', …)</code></span></div>'
 +'<div class="cv-ins"><span style="color:#6b7785">入力</span>'+I.map(([n,t])=>'<span class="cv-in">'+n+'<i>'+t+'</i></span>').join("")+'<button class="cv-btn ghost" style="height:26px">＋ 入力</button></div>';`;

/** 表示列の設定の左の面に何かを入れる（state columns） */
const left = (body) => watch("#llColumnPanel .lc-left", `(el) => { ${H} ${body} }`);
/** マスタの変換表（state master-egroups の中身を替える） */
const master = (body) => watch("#masterSettings .sh-page", `(el) => { ${H} navConv(); ${body} }`);

const masterGrid = (extra = "") => master(`el.innerHTML='<div class="cv-m"><div class="cv-mlist">'+mlist()+'</div><div class="cv-ed">'+edHead(${q(extra)})+grid()+'<div class="cv-other">どれにも当たらないとき → <b>その他</b>　<button class="cv-btn ghost" style="height:26px">＋ 行を足す</button></div></div></div>';`);


/** 当てた列の行に「変換」の札（表示列の設定の列の一覧） */
const marks = (names) => watch("#llColumnPanel #lcList li[data-col]", `(li) => { const m = ${q(names)}; const n = m[li.dataset.col]; if (!n) return;
  const nm = li.querySelector(".lc-name"); if (nm) nm.insertAdjacentHTML("beforeend", '<span class="cv-tag on cv-row" title="変換表「' + n + '」を当てています">変換 ' + n + '</span>'); }`);
const APPLIED = { "設備": "課名" };   // 見本の表（異常ロット一覧）には地取区分などの列が無いので、設備の列に課名を当てた形で札を見せる
const strip = (extra = "") => `'<div class="cv-strip"><span class="cv-tag ok">変換表</span><span>当てられる変換表 <b>6</b>（3 列を読み替え・3 列を足す）</span><span class="sp"></span><button class="cv-btn teal">まとめて当てる</button>${extra}</div>'`;

export const PROPOSALS = [
  { key: "G", name: "G: 1 段の帯＋行の札（C を直す）", css,
    ops: [left(`el.querySelector(".lc-chips").insertAdjacentHTML("afterend", ${strip('<button class="cv-btn ghost">選ぶ ▾</button>')});`), marks(APPLIED), masterGrid()] },
  { key: "H", name: "H: 帯＋帯の下に開く選び（F を直す）", css,
    ops: [left(`el.querySelector(".lc-chips").insertAdjacentHTML("afterend", ${strip('<button class="cv-btn ghost" aria-expanded="true">選ぶ ▴</button>')}
        + '<div class="cv-pick">' + T.map(([g,n,c,w,s]) => '<label class="' + (s==="none"?"is-none":"") + '"><input type="checkbox"' + (s==="ok"?" checked":"") + (s==="none"?" disabled":"") + '><b>' + n + '</b><small>' + (s==="none"?"列がありません":(g==="コードの読み替え"?"読み替え":"列を足す")) + '</small></label>').join("") + '</div>');`), marks(APPLIED), masterGrid()] },
  { key: "I", name: "I: 上の段の「変換表 ▾」の面", css,
    ops: [left(`const b=document.createElement("button"); b.className="cv-btn teal"; b.textContent="変換表 6 ▾"; el.querySelector("#lcAddCol").after(b);
        const p=document.createElement("div"); p.className="cv-pop"; p.style.cssText="top:210px;left:520px;width:420px";
        p.innerHTML='<h4>この表に当てる変換表</h4>'+T.map(([g,n,c,w,s])=>'<div class="cv-tg"><input type="checkbox"'+(s==="ok"?" checked":"")+(s==="none"?" disabled":"")+'><span><b>'+n+'</b><br><small>'+(s==="none"?"列がありません":(g==="コードの読み替え"?"列「"+c+"」を読み替え":"列を足す（"+c+" から）"))+'</small></span></div>').join("")+'<div style="display:flex;gap:8px;margin-top:6px"><span style="flex:1"></span><button class="cv-btn pri">選んだ 6 つを当てる</button></div>';
        document.body.append(p);`), marks(APPLIED), masterGrid()] },
  { key: "J", name: "J: 列の一覧に「変換」の列", css,
    ops: [left(`el.querySelector(".lc-chips").insertAdjacentHTML("afterend", ${strip()});
        const head=el.querySelector(".lc-listhead"); if (head) head.insertAdjacentHTML("beforeend",'<span class="cv-colconv" style="font-weight:800;color:#4b5f72">変換表</span>');`),
      watch("#llColumnPanel #lcList li[data-col]", `(li) => { const m = { "設備": ["課名", true], "不良名": ["", false], "調質": ["", false] }; const x = m[li.dataset.col];
        li.insertAdjacentHTML("beforeend", '<span class="cv-colconv">' + (x && x[0] ? '<span class="cv-sw on" style="transform:scale(.75)"></span>' + x[0] : '<span style="color:#6b7785">–</span>') + '</span>'); }`),
      masterGrid()] },
  { key: "K", name: "K: 当てた後の帯と元に戻す", css,
    ops: [left(`el.querySelector(".lc-chips").insertAdjacentHTML("afterend", '<div class="cv-strip" style="background:#eef3f9;border-color:#c9d8ea;color:#244569"><span class="cv-tag on">変換表</span><span><b>6 表</b>を当てました（3 列を読み替え・3 列を足した。保存で確定）</span><span class="sp"></span><button class="cv-btn ghost">元に戻す</button><button class="cv-btn ghost">選び直す ▾</button></div>');`), marks(APPLIED), masterGrid()] },
];
