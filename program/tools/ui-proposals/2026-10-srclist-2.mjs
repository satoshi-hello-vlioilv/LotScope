// 2026-10 データ元の一覧性・グループ・並べ替え・結合した表。2 回目（合格点 80 点。1 回目は E 71.8 点で届かず）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-srclist-2.mjs --states master-sources-many --from master
// 1 回目の採点で低かった所: ①1280 でファイル名（違う所）と行の数が切れた ②並べ替え・グループを作る入口が ⋮⋮ だけで見えない
//   ③結合の方式と当たった数が表から消えた ④作業実績の「12 台 行」 ⑤札の数と表がずれた
// 直し方（どの案も）: ファイル名だけを出す（共有の道はグループの見出しに 1 度・行の題に全部）・状態は「● 行の数」＋時刻を淡く・
//   結合の列にベン図（方式）と当たった数・作業実績は「12 台」・数は表から数える
// 案の方向:
//   E2 持ち越し: 1 回目の E（結合した表を元の下に └・相手に「← で使う」）＋上の直し＋グループの見出しに「名前を変える」
//   H 減らし方（新）: 名前の下にファイル名を 2 段で（列を減らし、名前と場所を 1 つのまとまりに）
//   I 流れ（新）: 行のチェックで選び、上の帯でまとめて「出す・出さない・グループへ ▾・↑ ↓」（多いときの出し入れを 1 手で）
//   J 置き場（新）: グループの見出し行に、そのグループの操作（全部出す／出さない・名前を変える・↑ ↓）。行の右に「⋮」のメニュー（グループへ・上へ・下へ）
//   K 見せ方（新）: 表の上に、結合した表のつながりの図（元 ＋ 相手 → 結合した表。見出しに出さない元は点線）
//   G 置き場（新）: 左に細いグループの札の列（すべて・グループごと・出さない）。札へ行を引いて入れる・札の ⋮ で名前・＋ グループ
const D = [
  { g: "", n: "品質データ", role: "品質", dir: "/tmp/…/共有/台帳/", f: "SIKADEF.sqlite3", st: "ok", rows: "1,500", tab: "品質異常", on: true, lock: true, join: "製造条件マスタ" },
  { g: "", n: "作業実績", role: "実績", dir: "/tmp/…/【New】実績/", f: "実績_*.sqlite3", st: "ok", rows: "12 台", unit: "", tab: "作業実績", on: true, lock: true },
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
const NOW = { all: D.length, on: D.filter((d) => d.on).length };
const css = `
.sx{display:flex;flex-direction:column;gap:10px;max-width:1180px;font-size:13px;color:#1b2733}
.sx-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sx-top .ps-lead{margin:0;flex:1 1 300px;font-size:12.5px;color:#5d6b77}
.sx-btn{height:30px;padding:0 12px;border:1px solid #dbe3e9;border-radius:7px;background:#fff;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.sx-btn.pri{background:#e6a52e;border-color:#e6a52e;color:#3a2a00;font-weight:700}
.sx-btn.sm{height:24px;padding:0 8px;font-size:12px;font-weight:400}
.sx-search{height:30px;width:180px;border:1px solid #dbe3e9;border-radius:7px;padding:0 10px;font:inherit}
.sx-t{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dbe3e9;border-radius:10px;overflow:hidden;background:#fff;table-layout:fixed}
.sx-t th{background:#f4f7f9;font-size:12px;color:#5d6b77;font-weight:700;text-align:left;padding:6px 8px;border-bottom:1px solid #dbe3e9;white-space:nowrap}
.sx-t td{padding:0 8px;height:34px;border-bottom:1px solid #edf1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.sx-t td:last-child{text-overflow:clip;padding-right:6px}.sx-t td.gp{padding:0 0 0 6px;text-overflow:clip}.sx-t td:first-child{padding:0 0 0 8px;text-overflow:clip}
.sx-t tr.off td{color:#5d6b77}.sx-t tr.off td.nm b{color:#44576a;font-weight:600}
.sx-t tr.gh td{background:#eef3f7;height:32px;font-weight:700;color:#2c3a46;border-bottom:1px solid #dbe3e9}
.sx-t tr.gh .ga{float:right;display:inline-flex;gap:4px;font-weight:400}
.gh small{font-weight:400;color:#5d6b77;margin-left:8px}.gh .gt{color:#5d6b77;margin-right:6px}
.gh .gren{border:0;background:none;color:#2b5a8a;font:inherit;font-size:12px;cursor:pointer;margin-left:8px;font-weight:400}
.sx-grip{color:#9aa6b0;cursor:grab;font-size:14px}
.nm b{font-weight:700}.nm small{display:block;font-family:Consolas,monospace;font-size:12px;color:#5d6b77;font-weight:400;overflow:hidden;text-overflow:ellipsis}
.sx-t.two td{height:44px}
.sx-role{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:#eef1f4;color:#44576a;font-size:11.5px;font-weight:700}
.sx-role.v{background:#e6effa;color:#2b5a8a}
.sx-f{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px}
.sx-st{display:inline-flex;align-items:center;gap:5px}.sx-st i{width:8px;height:8px;border-radius:50%;background:#b8c2ca;flex:none}
.sx-st.ok i{background:#1f7a4d}.sx-st.no{color:#5d6b77}.sx-st small{color:#5d6b77;font-size:11.5px}
.sw{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sw i{position:relative;width:30px;height:17px;border-radius:999px;background:#c5ced5;flex:none}
.sw i::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.sw.on i{background:#2f7d78}.sw.on i::after{left:15px}
.sw span{font-size:12px;color:#44576a}.sw.on span{color:#1f5f5a;font-weight:700}.sw.lock{opacity:.6;cursor:default}
.sx-j{display:flex;align-items:center;gap:5px;min-width:0;color:#2b5a8a;font-size:12px}.sx-j svg{flex:none}.sx-j span{min-width:0;overflow:hidden;text-overflow:ellipsis}.sx-j em{flex:none;font-style:normal;color:#1f7a4d;font-weight:700}
.sx-ed{height:26px;padding:0 10px;border:1px solid #dbe3e9;border-radius:6px;background:#fff;font:inherit;font-size:12px;cursor:pointer}
.sx-more{width:26px;height:26px;border:1px solid #dbe3e9;border-radius:6px;background:#fff;cursor:pointer;color:#44576a;margin-left:4px}
.sx-used{display:inline-block;padding:0 7px;border-radius:999px;background:#fff4dd;color:#7a4f00;font-size:11.5px;font-weight:700}
.sx-tree{color:#8d9ba6;font-family:Consolas,monospace;margin-right:4px}
.sx-bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #9fc5c0;border-radius:8px;background:#eef7f6;font-size:12.5px}
.sx-bar b{color:#1f5f5a}.sx-ck{width:15px;height:15px;accent-color:#2f7d78;vertical-align:middle}
.sk{display:flex;align-items:center;gap:14px;padding:10px 12px;border:1px solid #dbe3e9;border-radius:10px;background:#f8fbfe;flex-wrap:wrap}
.sk h4{margin:0;font-size:12.5px;color:#44576a;width:100%}
.sk-box{padding:5px 10px;border:1.5px solid #2c5f99;border-radius:6px;background:#fff;font-weight:700;font-size:12.5px}
.sk-box.off{border-style:dashed;color:#44576a}.sk-box.v{border-color:#2f7d78;background:#e5f2f0}
.sk-ar{color:#5d6b77;font-size:12px}
.sg{display:grid;grid-template-columns:160px minmax(0,1fr);gap:10px;align-items:start}
.sg-nav{display:flex;flex-direction:column;gap:2px;border:1px solid #dbe3e9;border-radius:10px;background:#fff;padding:6px}
.sg-nav button{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border:0;border-radius:6px;background:none;font:inherit;font-size:13px;cursor:pointer;text-align:left}
.sg-nav button b{margin-left:auto;font-weight:400;color:#5d6b77;font-size:12px}.sg-nav button.on{background:#e6effa;box-shadow:inset 3px 0 0 #3f6591;font-weight:700}
.sg-nav hr{border:0;border-top:1px solid #edf1f4;margin:4px 0}.sg-nav .add{color:#2b5a8a;border:1px dashed #b9cde2}
`;
const venn = '<svg width="22" height="14" viewBox="0 0 60 36" aria-hidden="true"><circle cx="23" cy="18" r="13" fill="#9fc2ea" stroke="#2c5f99" stroke-width="3"/><circle cx="37" cy="18" r="13" fill="#fff" fill-opacity=".4" stroke="#a5661a" stroke-width="3" stroke-dasharray="5 4"/></svg>';
const sw = (d) => `<span class="sw${d.on ? " on" : ""}${d.lock ? " lock" : ""}" role="switch" aria-checked="${d.on}"><i></i><span>${d.on ? "出す" : "出さない"}</span></span>`;
const st = (d) => d.st === "ok" ? `<span class="sx-st ok" title="写した 10/25 09:16"><i></i>${d.rows}${d.unit === "" ? "" : " 行"} <small>09:16</small></span>` : '<span class="sx-st no"><i></i>まだ写していない</span>';
const fileOf = (d) => d.view ? `<span class="sx-f">元: ${d.view}</span>` : `<span class="sx-f" title="${d.dir}${d.f}">${d.f}</span>`;
const role = (d) => d.view ? '<span class="sx-role v">結合した表</span>' : d.g ? "" : `<span class="sx-role">${d.role}</span>`;
const join = (d, used = true) => d.join ? `<span class="sx-j" title="左外部結合（合金 = 材質・調質 = 質別）">${venn}<span>製造条件マスタ</span><em>1,339/1,500</em></span>` : used && d.used ? `<span class="sx-used">← ${d.used}で使う</span>` : "";
const DIRS = { "台帳": "\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳", "工程": "\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳", "マスタ": "/tmp/…/共有/マスタ" };
const ordered = (g) => { const l = D.filter((d) => d.g === g); return g === "" ? [l[0], l[3], l[1], l[2]] : l; };
const gh = (g, cols, { rename = true, acts = "" } = {}) => {
  const l = D.filter((d) => d.g === g), on = l.filter((d) => d.on).length;
  return `<tr class="gh"><td colspan="${cols}"><span class="gt">▾</span>${g || "グループなし"}<small>${l.length} 件・出す ${on}${DIRS[g] ? `・${DIRS[g]}` : ""}</small>${g && rename ? '<button type="button" class="gren">名前を変える</button>' : ""}${acts ? `<span class="ga">${acts}</span>` : ""}</td></tr>`;
};
const top = (extra = "") => `<div class="sx-top"><p class="ps-lead">共有のデータ ${NOW.all} 件（見出しに出す ${NOW.on}）。⠿ を引いて並べ替え・グループへ。</p>${extra}
  <input class="sx-search" placeholder="名前・ファイルで探す"><button type="button" class="sx-btn">＋ グループ</button><button type="button" class="sx-btn">＋ 結合した表</button><button type="button" class="sx-btn pri" id="srAdd">＋ データ元を足す</button></div>`;
const COLS = (o = {}) => `<colgroup>${o.ck ? '<col style="width:30px">' : ""}<col style="width:24px"><col style="width:${o.two ? 34 : 24}%">${o.two ? "" : '<col style="width:17%">'}<col style="width:14%"><col style="width:106px"><col><col style="width:${o.more ? 124 : 96}px"></colgroup>`;
const HEAD = (o = {}) => `<thead><tr>${o.ck ? '<th><input type="checkbox" class="sx-ck"></th>' : ""}<th></th><th>${o.two ? "名前・ファイル" : "名前"}</th>${o.two ? "" : "<th>ファイル</th>"}<th>状態</th><th>見出しのタブ</th><th>結合</th><th></th></tr></thead>`;
const row = (d, o = {}) => `<tr class="${d.on ? "" : "off"}">${o.ck ? `<td><input type="checkbox" class="sx-ck"${o.picked && o.picked.includes(d.n) ? " checked" : ""}></td>` : ""}<td class="gp"><span class="sx-grip" title="つかんで並べ替え・グループへ">⠿</span></td>
  <td class="nm">${d.view ? '<span class="sx-tree">└</span>' : ""}<b>${d.n}</b>${role(d)}${o.two ? `<small title="${d.dir || ""}${d.f}">${d.view ? "品質データ ＋ 製造条件マスタ" : d.f}</small>` : ""}</td>${o.two ? "" : `<td>${fileOf(d)}</td>`}<td>${st(d)}</td><td>${sw(d)}</td>
  <td>${join(d)}</td><td><button type="button" class="sx-ed">変える…</button>${o.more ? '<button type="button" class="sx-more" title="グループへ・上へ・下へ">⋮</button>' : ""}</td></tr>`;
const table = (o = {}) => {
  const n = 6 + (o.two ? 0 : 1) + (o.ck ? 1 : 0);
  const body = GROUPS.map((g) => gh(g, n, o.gacts ? { acts: g ? '<button type="button" class="sx-btn sm">全部出す</button><button type="button" class="sx-btn sm">全部出さない</button><button type="button" class="sx-btn sm" title="グループを上へ">↑</button><button type="button" class="sx-btn sm" title="グループを下へ">↓</button>' : "" } : {})
    + ordered(g).map((d) => row(d, o)).join("")).join("");
  return `<table class="sx-t${o.two ? " two" : ""}">${COLS(o)}${HEAD(o)}<tbody>${body}</tbody></table>`;
};
const bar = '<div class="sx-bar"><b>3 件を選んでいます</b>（材調・材質・圧延予定）<span style="flex:1"></span><button type="button" class="sx-btn sm">出す</button><button type="button" class="sx-btn sm">出さない</button><button type="button" class="sx-btn sm">グループへ ▾</button><button type="button" class="sx-btn sm">↑ 上へ</button><button type="button" class="sx-btn sm">↓ 下へ</button><button type="button" class="sx-btn sm">選びを外す</button></div>';
const graph = `<div class="sk"><h4>結合した表のつながり（点線は見出しに出さない元）</h4><span class="sk-box">品質データ</span><span class="sk-ar">＋</span><span class="sk-box">製造条件マスタ</span>${venn}<span class="sk-ar">左外部結合（合金 = 材質・調質 = 質別）→</span><span class="sk-box v">品質データ＋製造条件</span><span style="margin-left:auto;color:#1f7a4d;font-weight:700">1,339 / 1,500 行が当たる</span></div>`;
const nav = `<div class="sg-nav"><button type="button" class="on">すべて<b>${NOW.all}</b></button><hr>${GROUPS.map((g) => `<button type="button">${g || "グループなし"}<b>${D.filter((d) => d.g === g).length}</b></button>`).join("")}<hr><button type="button">出さない<b>${NOW.all - NOW.on}</b></button><button type="button" class="add">＋ グループを作る</button></div>`;
const page = (html) => ["script", `
  const go = () => { const p = document.querySelector('#masterSettings .sr-page'); if (!p || p.dataset.sx || !p.textContent.includes('組成')) return;
    p.dataset.sx = 1; p.innerHTML = '<div class="sx">' + ${JSON.stringify(html)} + '</div>'; };
  new MutationObserver(go).observe(document.documentElement, { childList: true, subtree: true });`];
export const PROPOSALS = [
  { key: "E2", name: "1 回目の E（つながり）＋切れの直し・グループの名前を変える", css, ops: [page(top() + table())] },
  { key: "H", name: "名前の下にファイル名（2 段）で列を減らす", css, ops: [page(top() + table({ two: true }))] },
  { key: "I", name: "チェックで選び、上の帯でまとめて出す・グループへ・並べる", css, ops: [page(top() + bar + table({ ck: true, picked: ["材調", "材質", "圧延予定"] }))] },
  { key: "J", name: "グループの見出しにグループの操作・行の ⋮ のメニュー", css, ops: [page(top() + table({ gacts: true, more: true }))] },
  { key: "K", name: "表の上に結合した表のつながりの図", css, ops: [page(top() + graph + table())] },
  { key: "G", name: "左にグループの札（すべて・グループ・出さない・＋ グループ）", css, ops: [page(top() + `<div class="sg">${nav}<div>${table({ two: true })}</div></div>`)] },
];
