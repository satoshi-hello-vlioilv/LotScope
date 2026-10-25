// 2026-10 データ元の一覧性（多いときの見渡し・見出しのタブの出し入れ・グループ・並べ替え）と、結合した表（見出しに出さない元どうしを任意の鍵で合わせて出す）。1 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-srclist.mjs --states master-sources-many --from master
// 今の画面で見えたこと（ui-check の画像 master-sources-many・利用者の画像）:
//   ①カード 1 枚が約 95px あり、15 件のうち 1728 で 9 件しか見えない（1280 では 5 件）。全体を見渡せない
//   ②見出しのタブに出すか（「出さない」）は小さな字の 1 語で、出し入れはカードを開いて選びを替え「保存」する 3 手
//   ③共有の場所の長い道（\\Nlmsrvngy03\Read\【New】仕掛\台帳\）が全部のカードで同じで、違う所（ファイル名）が埋もれる
//   ④状態の点がどれも灰色で同じ「まだ開いていません」。役割の札「マスタ」が 10 枚続く ⑤まとめる・並べ替える手段が無い
//   ⑥結合はカードの中の 1 行だけ。見出しに出さない元どうしを合わせて 1 つの表として出す手段が無い
// 案の方向（何で解くか）:
//   A 見せ方: 1 行 1 件の表（グループの見出し行で畳める）。見出しのタブはスイッチ 1 手。違う所（ファイル名）だけを太く・共有の道はグループの見出しに 1 度
//   B 置き場: 左にグループ → データ元の木（目の印で出し入れ）・右に選んだ元の中身（場所・状態・結合の図）
//   C 減らし方: グループごとの箱を 3 列に並べ、箱の中は名前とスイッチだけ（細部は押して開く）
//   D 流れ: 見出しのタブの置き場で 3 列（見出しのタブ・グループのタブの札・出さない〈結合・ダッシュボードだけ〉）。札を引いて置き場を替える
//   E 見せ方: A ＋ 結合のつながり（結合した表を元の下に木の線で・相手の元に「← 品質データ＋製造条件で使う」）
//   F 減らし方: A ＋ 上に絞りの札（すべて・見出しに出す・出さない・結合・届かない）と、名前・状態・行の列で並べ替え
const D = [
  { g: "", n: "品質データ", role: "品質", dir: "/tmp/…/共有/台帳/", f: "SIKADEF.sqlite3", st: "ok", rows: "1,500", tab: "品質異常", on: true, lock: true, join: "製造条件マスタ" },
  { g: "", n: "作業実績", role: "実績", dir: "/tmp/…/【New】実績/", f: "実績_*.sqlite3", st: "ok", rows: "12 台", tab: "作業実績", on: true, lock: true },
  { g: "", n: "仕掛", role: "仕掛", dir: "/tmp/…/共有/台帳/", f: "LOTNOW.sqlite3", st: "", rows: "", tab: "仕掛", on: true },
  { g: "", n: "品質データ＋製造条件", role: "結合した表", view: "品質データ", f: "品質データ ＋ 製造条件マスタ", st: "ok", rows: "1,500", tab: "品質データ＋製造条件", on: true, join: "製造条件マスタ（合金 = 材質・調質 = 質別）" },
  { g: "マスタ", n: "製造条件マスタ", role: "マスタ", dir: "/tmp/…/共有/マスタ/", f: "製造条件マスタ.sqlite3", st: "ok", rows: "8", on: true, used: "2 つの結合" },
  { g: "マスタ", n: "設備マスタ", role: "マスタ", dir: "/tmp/…/共有/マスタ/", f: "設備マスタ.sqlite3", st: "", rows: "", on: true },
  ...[["組成", "QSOSEI", 1], ["QP直角度NLM", "QSQUARE", 1], ["QP直角度NLM（J）", "QSQUAREJ", 0], ["用途", "QYOTO", 1], ["材調", "QZAICYO", 0], ["材質一覧", "QZAILIST", 1], ["材質", "QZAISHITSU", 0], ["リピート", "REPEAT", 1]]
    .map(([n, f, on]) => ({ g: "台帳", n, role: "マスタ", dir: "\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳\\", f: `${f}.sqlite3`, st: "", rows: "", on: !!on })),
  { g: "工程", n: "スラブ", role: "マスタ", dir: "\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳\\", f: "QSLAB.sqlite3", st: "", rows: "", on: true },
  { g: "工程", n: "圧延予定", role: "マスタ", dir: "\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳\\", f: "QROLLPLAN.sqlite3", st: "", rows: "", on: false },
];
const GROUPS = [...new Set(D.map((d) => d.g))];
const css = `
.sx{display:flex;flex-direction:column;gap:10px;max-width:1180px;font-size:13px;color:#1b2733}
.sx-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sx-top .ps-lead{margin:0;flex:1 1 320px;font-size:12.5px;color:#5d6b77}
.sx-btn{height:30px;padding:0 12px;border:1px solid #dbe3e9;border-radius:7px;background:#fff;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.sx-btn.pri{background:#e6a52e;border-color:#e6a52e;color:#3a2a00;font-weight:700}
.sx-search{height:30px;width:200px;border:1px solid #dbe3e9;border-radius:7px;padding:0 10px;font:inherit}
.sx-t{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dbe3e9;border-radius:10px;overflow:hidden;background:#fff;table-layout:fixed}
.sx-t th{background:#f4f7f9;font-size:12px;color:#5d6b77;font-weight:700;text-align:left;padding:6px 8px;border-bottom:1px solid #dbe3e9;white-space:nowrap}
.sx-t td{padding:0 8px;height:34px;border-bottom:1px solid #edf1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.sx-t tr.off td{color:#7b8895}.sx-t tr.off td.nm b{color:#5d6b77;font-weight:600}
.sx-t tr.gh td{background:#eef3f7;height:30px;font-weight:700;color:#2c3a46;border-bottom:1px solid #dbe3e9}
.sx-t tr.gh small{font-weight:400;color:#5d6b77;margin-left:8px}
.sx-t tr.gh .gt{color:#5d6b77;margin-right:6px}
.sx-t td:first-child{padding:0 0 0 8px;text-overflow:clip}.sx-grip{color:#a9b4bd;cursor:grab;font-size:14px;letter-spacing:0}
.nm b{font-weight:700}
.sx-role{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:#eef1f4;color:#44576a;font-size:11.5px;font-weight:700}
.sx-role.v{background:#e6effa;color:#2b5a8a}
.sx-f{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px}.sx-f i{font-style:normal;color:#8995a0}
.sx-st{display:inline-flex;align-items:center;gap:5px}.sx-st i{width:8px;height:8px;border-radius:50%;background:#b8c2ca;flex:none}
.sx-st.ok i{background:#1f7a4d}.sx-st.no{color:#7b8895}
.sw{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sw i{position:relative;width:30px;height:17px;border-radius:999px;background:#c5ced5;flex:none}
.sw i::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.sw.on i{background:#2f7d78}.sw.on i::after{left:15px}
.sw span{font-size:12px}.sw.on span{color:#1f5f5a;font-weight:700}.sw.lock{opacity:.6;cursor:default}
.sx-j{display:inline-flex;align-items:center;gap:5px;color:#2b5a8a;font-size:12px}
.sx-j svg{flex:none}
.sx-ed{height:26px;padding:0 10px;border:1px solid #dbe3e9;border-radius:6px;background:#fff;font:inherit;font-size:12px;cursor:pointer}
.sx-used{display:inline-block;padding:0 7px;border-radius:999px;background:#fff4dd;color:#8a5a00;font-size:11.5px;font-weight:700}
.sx-tree{color:#9fb3bf;font-family:Consolas,monospace;margin-right:4px}
/* B */
.sb{display:grid;grid-template-columns:300px minmax(0,1fr);gap:12px;align-items:start}
.sb-tree{border:1px solid #dbe3e9;border-radius:10px;background:#fff;padding:6px 0;max-height:820px;overflow:auto}
.sb-g{display:flex;align-items:center;gap:6px;padding:6px 10px;font-weight:700;color:#2c3a46;font-size:12.5px}
.sb-g small{color:#5d6b77;font-weight:400;margin-left:auto}
.sb-i{display:flex;align-items:center;gap:8px;height:28px;padding:0 10px 0 24px;cursor:pointer}
.sb-i.sel{background:#e6effa;box-shadow:inset 3px 0 0 #3f6591}.sb-i.off{color:#8995a0}
.sb-i .eye{margin-left:auto;font-size:12px;color:#2f7d78}.sb-i.off .eye{color:#a9b4bd}
.sb-d{border:1px solid #dbe3e9;border-left:4px solid #3f6591;border-radius:10px;background:#fff;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.sb-d h3{margin:0;font-size:16px}.sb-kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px}.sb-kv span{color:#5d6b77;font-weight:700}
.sb-flow{display:flex;align-items:center;gap:10px;padding:10px;border:1px dashed #b9cde2;border-radius:8px;background:#f8fbfe}
.sb-box{padding:6px 10px;border:1.5px solid #2c5f99;border-radius:6px;background:#fff;font-weight:700}.sb-box.r{border-color:#a5661a;border-style:dashed}
/* C */
.sc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start}
.sc-box{border:1px solid #dbe3e9;border-radius:10px;background:#fff;overflow:hidden}
.sc-h{display:flex;align-items:center;gap:6px;padding:7px 10px;background:#f4f7f9;font-weight:700;border-bottom:1px solid #dbe3e9}.sc-h small{color:#5d6b77;font-weight:400;margin-left:auto}
.sc-r{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;border-bottom:1px solid #edf1f4}.sc-r:last-child{border-bottom:0}
.sc-r b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.sc-r.off b{color:#7b8895}
/* D */
.sd{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start}
.sd-col{border:1px solid #dbe3e9;border-radius:10px;background:#f6f9fb;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:300px}
.sd-col h4{margin:0 2px 2px;font-size:13px;display:flex;align-items:baseline;gap:6px}.sd-col h4 small{color:#5d6b77;font-weight:400}
.sd-c{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid #dbe3e9;border-radius:7px;background:#fff;cursor:grab}
.sd-c b{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-g{font-size:11.5px;color:#5d6b77;font-weight:700;margin:4px 2px 0}
/* F */
.sf{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sf button{height:28px;padding:0 11px;border:1px solid #dbe3e9;border-radius:999px;background:#fff;font:inherit;font-size:12.5px;cursor:pointer}
.sf button b{margin-left:5px;color:#5d6b77}.sf button.on{background:#e5f2f0;border-color:#2f7d78;color:#1f5f5a;font-weight:700}
.sx-t th.srt{cursor:pointer}.sx-t th.srt::after{content:" ⇅";color:#a9b4bd}.sx-t th.srt.on::after{content:" ▲";color:#2f7d78}
`;
const venn = '<svg width="22" height="14" viewBox="0 0 60 36"><circle cx="23" cy="18" r="13" fill="#9fc2ea" stroke="#2c5f99" stroke-width="3"/><circle cx="37" cy="18" r="13" fill="#fff" fill-opacity=".4" stroke="#a5661a" stroke-width="3" stroke-dasharray="5 4"/></svg>';
const sw = (d) => `<span class="sw${d.on ? " on" : ""}${d.lock ? " lock" : ""}" role="switch" aria-checked="${d.on}"><i></i><span>${d.on ? "出す" : "出さない"}</span></span>`;
const st = (d) => d.st === "ok" ? `<span class="sx-st ok" title="写した時刻と行の数"><i></i>10/25 09:16${d.rows ? `・${d.rows} 行` : ""}</span>` : '<span class="sx-st no"><i></i>まだ写していない</span>';
const file = (d) => d.view ? `<span class="sx-f">${d.f}</span>` : `<span class="sx-f" title="${d.dir}${d.f}"><i>${d.dir.length > 18 ? "…\\" : d.dir}</i>${d.f}</span>`;
const role = (d) => d.view ? '<span class="sx-role v">結合した表</span>' : d.g === "台帳" || d.g === "工程" || d.g === "マスタ" ? "" : `<span class="sx-role">${d.role}</span>`;
const where = (d) => d.view ? "見出しのタブ" : d.g ? `${d.g} の札` : "見出しのタブ";
const groupHead = (g, cols, extra = "") => {
  const list = D.filter((d) => d.g === g), on = list.filter((d) => d.on).length;
  return `<tr class="gh"><td colspan="${cols}"><span class="gt">▾</span>${g || "見出しのタブ（グループなし）"}<small>${list.length} 件・出す ${on}${g === "台帳" ? "・\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳" : ""}</small>${extra}</td></tr>`;
};
const COLS = '<colgroup><col style="width:28px"><col style="width:24%"><col style="width:22%"><col style="width:16%"><col style="width:108px"><col><col style="width:86px"></colgroup>';
const HEAD = (srt = false) => `<thead><tr><th></th><th class="${srt ? "srt on" : ""}">名前</th><th>ファイル</th><th class="${srt ? "srt" : ""}">状態</th><th>見出しのタブ</th><th>結合</th><th></th></tr></thead>`;
const rowA = (d, tree = false) => `<tr class="${d.on ? "" : "off"}"><td><span class="sx-grip" title="つかんで並べ替え">⠿</span></td>
  <td class="nm">${tree && d.view ? '<span class="sx-tree">└</span>' : ""}<b>${d.n}</b>${role(d)}</td><td>${file(d)}</td><td>${st(d)}</td><td>${sw(d)}</td>
  <td>${d.join ? `<span class="sx-j">${venn}${d.view ? d.join.split("（")[0] : d.join}</span>` : tree && d.used ? `<span class="sx-used">← ${d.used} で使う</span>` : ""}</td>
  <td><button type="button" class="sx-ed">変える…</button></td></tr>`;
const top = (extra = "") => `<div class="sx-top"><p class="ps-lead">アプリが読む共有のデータ（${D.length} 件）。どれも手元へ写してから読みます。</p>${extra}
  <input class="sx-search" placeholder="名前・ファイルで探す"><button type="button" class="sx-btn">＋ 結合した表を作る</button><button type="button" class="sx-btn pri" id="srAdd">＋ データ元を足す</button></div>`;
const tableA = (opt = {}) => {
  let body = "";
  for (const g of GROUPS) {
    let list = D.filter((d) => d.g === g);
    if (opt.tree && g === "") list = [list[0], list[3], list[1], list[2]];
    body += groupHead(g, 7) + list.map((d) => rowA(d, opt.tree)).join("");
  }
  return `<table class="sx-t">${COLS}${HEAD(opt.sort)}<tbody>${body}</tbody></table>`;
};
const viewB = () => {
  const tree = GROUPS.map((g) => `<div class="sb-g">▾ ${g || "見出しのタブ"}<small>${D.filter((d) => d.g === g).length}</small></div>`
    + D.filter((d) => d.g === g).map((d) => `<div class="sb-i${d.on ? "" : " off"}${d.view ? " sel" : ""}">${d.n}<span class="eye">${d.on ? "◉ 出す" : "○ 出さない"}</span></div>`).join("")).join("");
  return `${top()}<div class="sb"><div class="sb-tree">${tree}</div><div class="sb-d"><h3>品質データ＋製造条件 <span class="sx-role v">結合した表</span></h3>
    <div class="sb-kv"><span>元</span><b>品質データ（SIKADEF.sqlite3）</b><span>状態</span>${st(D[3])}<span>見出しのタブ</span>${sw(D[3])}<span>グループ</span><b>（なし）</b></div>
    <div class="sb-flow"><span class="sb-box">品質データ</span>${venn}<b style="color:#2b5a8a">左外部結合</b><span class="sb-box r">製造条件マスタ</span><span>合金 = 材質・調質 = 質別</span><span style="margin-left:auto;color:#1f7a4d;font-weight:700">1,339 / 1,500 行が当たる</span></div>
    <div><button type="button" class="sx-btn pri">変える…</button></div></div></div>`;
};
const viewC = () => `${top()}<div class="sc">${GROUPS.map((g) => `<div class="sc-box"><div class="sc-h">${g || "見出しのタブ"}<small>${D.filter((d) => d.g === g).length} 件</small></div>`
  + D.filter((d) => d.g === g).map((d) => `<div class="sc-r${d.on ? "" : " off"}"><b title="${d.f}">${d.n}</b>${d.view ? '<span class="sx-role v">結合</span>' : ""}${d.st === "ok" ? '<span class="sx-st ok"><i></i></span>' : '<span class="sx-st no"><i></i></span>'}${sw(d)}</div>`).join("") + "</div>").join("")}</div>`;
const viewD = () => {
  const card = (d) => `<div class="sd-c"><span class="sx-grip">⠿</span><b title="${d.f}">${d.n}</b>${d.view ? '<span class="sx-role v">結合</span>' : ""}${d.st === "ok" ? '<span class="sx-st ok"><i></i></span>' : ""}</div>`;
  const col1 = D.filter((d) => d.on && !d.g), col2 = D.filter((d) => d.on && d.g), col3 = D.filter((d) => !d.on);
  const byG = (list) => [...new Set(list.map((d) => d.g))].map((g) => `<p class="sd-g">${g} の札</p>` + list.filter((d) => d.g === g).map(card).join("")).join("");
  return `${top()}<div class="sd"><div class="sd-col"><h4>見出しのタブ<small>${col1.length}</small></h4>${col1.map(card).join("")}</div>
    <div class="sd-col"><h4>グループのタブの中（札）<small>${col2.length}</small></h4>${byG(col2)}</div>
    <div class="sd-col"><h4>出さない<small>結合・ダッシュボードだけ ${col3.length}</small></h4>${col3.map(card).join("")}</div></div>`;
};
const chips = '<div class="sf"><button type="button" class="on">すべて<b>15</b></button><button type="button">見出しに出す<b>10</b></button><button type="button">出さない<b>5</b></button><button type="button">結合<b>2</b></button><button type="button">届かない<b>0</b></button></div>';
const page = (html) => ["script", `
  const go = () => { const p = document.querySelector('#masterSettings .sr-page'); if (!p || p.dataset.sx || !p.textContent.includes('組成')) return;
    p.dataset.sx = 1; p.innerHTML = '<div class="sx">' + ${JSON.stringify(html)} + '</div>'; };
  new MutationObserver(go).observe(document.documentElement, { childList: true, subtree: true });`];
export const PROPOSALS = [
  { key: "A", name: "1 行 1 件の表・グループの見出し行で畳む・スイッチで出し入れ", css, ops: [page(top() + tableA())] },
  { key: "B", name: "左にグループの木（目の印）・右に選んだ元の中身", css, ops: [page(viewB())] },
  { key: "C", name: "グループごとの箱を 3 列（名前とスイッチだけ）", css, ops: [page(viewC())] },
  { key: "D", name: "見出しのタブの置き場で 3 列（札を引いて置き場を替える）", css, ops: [page(viewD())] },
  { key: "E", name: "A ＋ 結合のつながり（結合した表を元の下に・相手に「で使う」）", css, ops: [page(top() + tableA({ tree: true }))] },
  { key: "F", name: "A ＋ 絞りの札と、列で並べ替え", css, ops: [page(top() + chips + tableA({ sort: true }))] },
];
