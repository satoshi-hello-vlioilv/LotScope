// 2026-10 変換表（版 3.42.0）: M 言語の条件を分解した変換表のマスタを、一覧の列に当てる入口と、マスタの変換表の編集。1 回目（合格点 95 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-conv.mjs --states columns,master-egroups
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
.cv-any{color:#b4bcc6}
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
const grid=()=>'<table class="cv-grid"><thead><tr><th></th>'+I.map(([n,t])=>'<th>'+n+(t==="数"?' <small>(数)</small>':'')+'</th>').join("")+'<th>出す値</th></tr></thead><tbody>'
 +R.map((r,i)=>'<tr><td class="no">'+(i+1)+'</td>'+r.slice(0,6).map((c)=>'<td>'+(c.length?c.map((x)=>'<span class="cv-c">'+x+'</span>').join(c.length>1?'<small style="color:#8a95a3"> または </small>':''):'<span class="cv-any">不問</span>')+'</td>').join("")+'<td class="out">'+r[6]+(r[7]?'<span class="cv-note" title="'+r[7]+'">!</span>':'')+'</td></tr>').join("")+'</tbody></table>';
const sent=()=>'<div class="cv-sent">'+R.map((r,i)=>{const parts=r.slice(0,6).map((c,k)=>c.length?I[k][0]+' が <em>'+c.join(' または ')+'</em>':'').filter(Boolean);
 return '<div class="cv-s"><span class="no">'+(i+1)+'</span><span>'+(parts.length?parts.join(' かつ '):'どれでも')+' なら → <b>'+r[6]+'</b></span></div>';}).join("")+'</div>';
const mlist=()=>{let g="",h="";T.forEach(([grp,name,cols,what])=>{if(grp!==g){g=grp;h+='<h5>'+grp+'</h5>';}h+='<button class="cv-mi'+(name==="管理分類"?" on":"")+'"><b>'+name+'</b><small>'+what+'</small></button>';});
 return h+'<button class="cv-btn ghost" style="width:100%;margin-top:8px;border-style:dashed">＋ 変換表を足す</button>';};
const navConv=()=>{const tabs=document.querySelector("#masterTabs");if(!tabs||tabs.querySelector(".cv-nav"))return;const eg=tabs.querySelector('[data-tab="egroups"]');
 tabs.querySelectorAll(".tab").forEach((b)=>b.classList.remove("active"));const b=eg.cloneNode(true);b.classList.add("cv-nav","active");b.removeAttribute("data-tab");b.textContent="変換表";eg.after(b);};
const edHead=(extra)=>'<div class="cv-edhead"><h4>管理分類</h4><span class="cv-tag on">プリセット</span><span class="sp"></span>'+(extra||'')+'<button class="cv-btn ghost">標準に戻す</button><button class="cv-btn pri">保存</button></div>'
 +'<div class="cv-meta"><span>当て方: <b>列「管理分類」を足す・いちばん左</b></span><span>どれにも当たらないとき: <b>その他</b></span><span>式: <code>conv(\\'管理分類\\', …)</code></span></div>'
 +'<div class="cv-ins"><span style="color:#6b7785">入力</span>'+I.map(([n,t])=>'<span class="cv-in">'+n+'<i>'+t+'</i></span>').join("")+'<button class="cv-btn ghost" style="height:26px">＋ 入力</button></div>';`;

/** 表示列の設定の左の面に何かを入れる（state columns） */
const left = (body) => watch("#llColumnPanel .lc-left", `(el) => { ${H} ${body} }`);
/** マスタの変換表（state master-egroups の中身を替える） */
const master = (body) => watch("#masterSettings .sh-page", `(el) => { ${H} navConv(); ${body} }`);

const masterGrid = (extra = "") => master(`el.innerHTML='<div class="cv-m"><div class="cv-mlist">'+mlist()+'</div><div class="cv-ed">'+edHead(${q(extra)})+grid()+'<div class="cv-other">どれにも当たらないとき → <b>その他</b>　<button class="cv-btn ghost" style="height:26px">＋ 行を足す</button></div></div></div>';`);

export const PROPOSALS = [
  { key: "A", name: "A: 変換表…の面（カード）", css,
    ops: [
      left(`const tools=el.querySelector(".lc-tools"); const b=document.createElement("button"); b.className="cv-btn teal"; b.textContent="変換表… 6"; tools.querySelector("#lcAddCol").after(b);
        [...el.children].forEach((c)=>{ if(!c.classList.contains("lc-tools")) c.style.display="none"; });
        el.insertAdjacentHTML("beforeend",'<div class="cv-pane"><div class="cv-panehead"><h4>変換表を当てる</h4><small style="color:#5c6b7a">マスタ「変換表」の表を、この表の列に当てます</small><span class="sp"></span><button class="cv-btn ghost">列の一覧へ戻る</button></div><div class="cv-cards">'+cards(true)+'</div><div class="cv-panefoot"><small>6 表を選んでいます（列を 3 つ読み替え・3 つ足す）</small><span class="sp"></span><button class="cv-btn pri">まとめて当てる</button></div></div>');`),
      masterGrid(),
    ] },
  { key: "B", name: "B: 列ごとの段（変換表で読み替え）", css,
    ops: [
      watch("#llColumnPanel #lcDetail", `(el) => { const steps=el.querySelectorAll(".lc-step, details, section"); const at=[...el.children].find((c)=>/この列の作り方/.test(c.textContent));
        const box=document.createElement("div"); box.style.cssText="margin:0 0 10px;padding:12px 14px;border:1px solid #b9e0da;border-radius:10px;background:#f4fbfa";
        box.innerHTML='<div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;color:#0f4f49"><span class="cv-tag ok">変換</span>変換表で読み替え<span style="flex:1"></span><select class="cv-btn" style="font-weight:400"><option>（使わない）</option><option>地取区分</option><option>特急区分</option></select></div><div style="font-size:12.5px;color:#2f6b64;margin-top:6px">この列に合う変換表: 地取区分（0 → 0:一般・2 → 2:再手配 …）</div>';
        (at||el.lastElementChild).before(box); }`),
      left(`const b=el.querySelector("#lcAddCol"); b.textContent="＋ 列を作る ▾"; const m=document.createElement("div"); m.style.cssText="position:absolute;z-index:30;top:170px;left:520px;width:300px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 26px rgba(16,40,70,.2);padding:6px";
        m.innerHTML='<div class="cv-grp" style="margin:4px 8px">式で作る</div><div class="cv-tg">空の式から作る</div><div class="cv-grp" style="margin:6px 8px 0">変換表で作る</div>'+["形状区分","管理分類","課名（設備の列ごと）"].map((n)=>'<div class="cv-tg">'+n+'<span class="sp"></span><span class="cv-tag ok">作れる</span></div>').join(""); document.body.append(m);`),
      master(`el.innerHTML='<div class="cv-m"><div class="cv-mlist">'+mlist()+'</div><div class="cv-ed">'+edHead()+sent()+'<div class="cv-other">どれにも当たらないとき → <b>その他</b>　<button class="cv-btn ghost" style="height:26px">＋ 行を足す</button></div></div></div>';`),
    ] },
  { key: "C", name: "C: 先回りの帯（まとめて当てる）", css,
    ops: [
      left(`const list=el.querySelector(".lc-chips"); list.insertAdjacentHTML("afterend",'<div class="cv-strip"><span class="cv-tag ok">変換表</span><span>この表に当てられる変換表が <b>6 つ</b>あります<br><small>地取区分・特急区分・ｺﾝﾏ5本区分 を読み替え／形状区分・管理分類・課名 を足す</small></span><span class="sp"></span><button class="cv-btn teal">まとめて当てる</button><button class="cv-btn ghost">選ぶ…</button></div>');`),
      masterGrid(),
    ] },
  { key: "D", name: "D: 道具の行の「変換」と ON/OFF の面", css: css + "#llColumnPanel{display:none!important}",
    ops: [
      ["script", `{ ${H} const put=()=>{ const bar=document.querySelector("#llViewBtn"); if(!bar||document.querySelector(".cv-pop")) return;
        const b=document.createElement("button"); b.className="cv-btn teal"; b.textContent="変換 3/6 ▾"; bar.before(b);
        const p=document.createElement("div"); p.className="cv-pop"; p.innerHTML='<h4>変換表（この表の列に当てる・すぐ効く）</h4>'+T.map(([g,n,c,w,s],i)=>'<div class="cv-tg"><span class="cv-sw'+(i<3&&s==="ok"?" on":"")+'"></span><span><b>'+n+'</b><br><small>'+(s==="none"?"列がありません":w)+'</small></span><span class="sp"></span>'+(s==="none"?tag(s):"")+'</div>').join("")+'<div style="display:flex;gap:8px;margin-top:6px"><span style="flex:1"></span><button class="cv-btn ghost">マスタで直す</button></div>';
        document.body.append(p); }; new MutationObserver(put).observe(document.documentElement,{childList:true,subtree:true}); put(); }`],
      master(`const code='<table class="cv-map"><thead><tr><th>コード</th><th>出す値</th></tr></thead><tbody>'+[["0","0:一般"],["2","2:再手配"],["4","4:計画生産"]].map(([a,b])=>'<tr><td>'+a+'</td><td><b>'+b+'</b></td></tr>').join("")+'</tbody></table>';
        el.innerHTML='<div class="cv-m"><div class="cv-mlist">'+mlist()+'</div><div class="cv-ed">'+edHead()+grid()+'<div class="cv-other">どれにも当たらないとき → <b>その他</b>　<small>（コードの読み替えの表は、コード｜出す値 の 2 列で出します: </small>'+code+'</div></div></div>';`),
    ] },
  { key: "E", name: "E: マスタの変換表から当てる", css,
    ops: [
      left(`el.querySelector(".lc-tools").insertAdjacentHTML("afterend",'<div style="margin:2px 14px 4px;font-size:12.5px;color:#5c6b7a">変換表（コードの読み替え・判定表）は、マスタ管理の「変換表」から当てます。</div>');`),
      masterGrid('<button class="cv-btn teal">いまの一覧に当てる</button>'),
    ] },
  { key: "F", name: "F: 帯＋選ぶ面（C＋A）", css,
    ops: [
      left(`[...el.children].forEach((c)=>{ if(!c.classList.contains("lc-tools")) c.style.display="none"; });
        el.insertAdjacentHTML("beforeend",'<div class="cv-strip"><span class="cv-tag ok">変換表</span><span>当てられる変換表 <b>6 つ</b><small>（列を 3 つ読み替え・3 つ足す）</small></span><span class="sp"></span><button class="cv-btn teal">選んだ 6 つを当てる</button><button class="cv-btn ghost">閉じる</button></div><div class="cv-pane" style="height:auto;flex:1;min-height:0"><div class="cv-cards">'+cards(true)+'</div></div>');`),
      masterGrid(),
    ] },
];
