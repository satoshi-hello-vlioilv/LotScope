// 2026-10「データ元を 1 つの仕組みに」（版 3.58.0。利用者の要望 2026-10-28）: データ元の直す欄の置き方 5 案（A）と、
// 見出しのタブの権限の置き方 5 案（B）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-unify.mjs --states master-sources,master-access
// 今の形（撮った画像で見えたこと。scratchpad/now の master-*）:
//   - 同じ「元」の設定が 3 か所に散る: 品質の場所は「データ元」、間隔・スケジュールの CM3 は「参照先」、実績のフォルダと設備は「作業実績」
//   - 「参照先」は 1 項目 1 枚の大きなカードが縦に 9 枚並び、どれが何の元の物かが言葉を読まないと分からない（スクロールも長い）
//   - 実績のカードを開くと「フォルダは作業実績のタブで直します」と別の頁へ送られる（探させる）
//   - グループは名前を変えられるが消せない。品質・実績は名前を変えられない
//   - アクセス権限は人ごとの 5 項目だけで、見出しのタブを決める所が無い
// 再現は近似: 案の ops の script が、本物の API（/api/sources・/api/masters/worklog・/api/masters/tabaccess）の中身で案の形を描く。
// 押したときの動きは再現しない（見た目と置き場の比べ）。

// ---------------------------------------------------------------- 共通の部品（案の中で使う）
const COMMON = String.raw`
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fileOf = (p) => String(p || "").split(/[\\/]/).pop();
const get = async (u) => (await fetch(u, { cache: "no-store" })).json();
async function data() {
  if (window.__ux) return window.__ux;
  const [src, wl, ta] = await Promise.all([get("/api/sources"), get("/api/masters/worklog"), get("/api/masters/tabaccess")]);
  return (window.__ux = { src, wl, ta });
}
// 接続の設定の 1 項目（欄）
const field = (f, wide) => {
  const v = f.value === "" || f.value == null ? "" : String(f.value), dflt = f.default === "" || f.default == null ? "" : String(f.default);
  if (f.kind === "lotcol") return '<label class="ux-f' + (wide ? " w" : "") + '"><span>' + esc(f.label) + '</span><select class="ps-input"><option>自動（見つけた列: ロット番号）</option><option>なし（ロット番号の列は無い）</option><option>列を選ぶ…</option></select></label>';
  return '<label class="ux-f' + (wide ? " w" : "") + '"><span>' + esc(f.label) + (f.bind === "settings" ? "" : "") + '</span><input class="ps-input" value="' + esc(v) + '" placeholder="' + esc(dflt ? "既定: " + dflt : "") + '"></label>';
};
const SWON = '<button type="button" class="sr-sw on"><i></i><span>出す</span></button>';
const eqTable = (wl, n) => '<table class="ux-eq"><thead><tr><th>表示</th><th>設備</th><th>ファイル</th><th>最後の更新</th><th>状態</th></tr></thead><tbody>'
  + wl.items.slice(0, n || 99).map((e) => '<tr><td>' + SWON + '</td><td><b>' + esc(e.name) + '</b></td><td class="ux-mono">' + esc(e.file) + '</td><td>'
    + (e.mtime ? new Date(e.mtime * 1000).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-")
    + '</td><td>' + (e.state === "missing" ? '<span class="ux-bad">見つからない</span>' : e.stale ? '<span class="ux-warn">古い</span>' : '<span class="ux-ok">● 読める</span>') + '</td></tr>').join("")
  + '</tbody></table>';
const others = (d) => d.src.others.map((o) => ({ label: o.label, value: o.effective ?? "" }));
// 一覧（今の表）を残したまま、案の描き物を置く所
function host() { return document.querySelector("#masterSettings .sr-page"); }
// ナビ: 「参照先」「作業実績」を外し、「つなぎ先」の見出しは「データ元」1 つに
function nav(label) {
  document.querySelectorAll("#masterTabs [data-tab='paths'], #masterTabs [data-tab='worklog']").forEach((x) => x.remove());
  document.querySelectorAll("#masterTabs .mg-lab").forEach((x) => { if (x.textContent.trim() === "つなぎ先") x.textContent = label || "つなぎ先"; });
}
// 案を描く: 頁がデータ元を描くたびに（MutationObserver）、案の形へ置き換える
function watch(sel, run) {
  let busy = false;
  const go = async () => { const h = document.querySelector(sel); if (!h || h.querySelector(".ux-done") || busy) return; busy = true;
    let ok = true;
    try { ok = (await run(h)) !== false; } finally { if (ok) h.insertAdjacentHTML("beforeend", '<i class="ux-done" hidden></i>'); busy = false; } };
  new MutationObserver(go).observe(document.body, { childList: true, subtree: true });
}
// 品質・実績の行の名前（品質・実績）とグループの見出しの「消す」
function listTweaks(h) {
  h.querySelectorAll("tr.sr-gh td").forEach((td) => { const g = td.querySelector("b"); if (g && g.textContent !== "グループなし" && !td.querySelector(".ux-gdel"))
    (td.querySelector("[data-sr-rename]") || g).insertAdjacentHTML("afterend", '<button type="button" class="sr-gren ux-gdel">グループを消す</button>'); });
  h.querySelectorAll(".sr-fixed").forEach((x) => { x.textContent = "いつも出す"; });
}
`;

const CSS_COMMON = `
.ux-f{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted);min-width:0}
.ux-f span{font-weight:700}
.ux-f .ps-input{font-size:13px;height:32px !important;min-height:32px;box-sizing:border-box;padding:4px 9px !important;color:var(--ink);width:100%}
.ux-f.w{grid-column:1/-1}
.ux-sec{display:flex;flex-direction:column;gap:8px}
.ux-sec>h4{margin:0;font-size:13px;color:var(--ink);display:flex;align-items:center;gap:8px}
.ux-sec>h4 small{font-weight:400;color:var(--muted);font-size:12px}
.ux-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 12px}
.ux-eq{width:100%;border-collapse:collapse;font-size:12.5px}
.ux-eq th{font-size:11.5px;color:var(--muted);text-align:left;padding:4px 8px;border-bottom:1px solid var(--line);background:var(--surface-3)}
.ux-eq td{padding:3px 8px !important;border-bottom:1px solid var(--line-soft);height:30px !important;line-height:1.3}
.ux-mono{font-family:var(--mono,ui-monospace,monospace);font-size:12px}
.ux-ok{color:#1d6b3a}.ux-warn{color:#8a5300;background:#fff1cc;border-radius:999px;padding:1px 8px}.ux-bad{color:#9b1c1c;background:#fde2e2;border-radius:999px;padding:1px 8px}
.ux-acts{display:flex;gap:8px;align-items:center}
.ux-acts .sp{flex:1}
.ux-box{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.ux-gdel{color:#9b1c1c}
.ux-hint{font-size:12px;color:var(--muted);margin:0}
.ux-oth{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px}
`;

// ---------------------------------------------------------------- A: データ元の直す欄
// 実績（フォルダ・決まり・間隔・設備 12 台）を開いた所で比べる（いちばん項目が多い元）
const A_BASE = (body) => [["script", COMMON + `
watch("#masterSettings .sr-page", async (h) => {
  const d = await data(); listTweaks(h);
  const work = d.src.items.find((x) => x.key === "work"), conn = work.conn;
  ${body}
});`]];

const A = [
  {
    key: "A1", name: "行の中で縦に開く（見出しで区切る 1 列）",
    css: CSS_COMMON + `.ux-open td{padding:10px 14px !important;height:auto !important;white-space:normal !important;background:var(--input-soft,#eef4fb)}
      .ux-open .ux-box{gap:14px}.ux-oth-g td{background:var(--surface-3)}`,
    ops: A_BASE(`nav("データ元");
      const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      const sec = (t, s, inner) => '<section class="ux-sec"><h4>' + t + (s ? ' <small>' + s + '</small>' : '') + '</h4>' + inner + '</section>';
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box">'
        + sec("名前と見出しのタブ", "", '<div class="ux-grid"><label class="ux-f"><span>表示名</span><input class="ps-input" value="実績"></label><label class="ux-f"><span>見出しのタブ</span><input class="ps-input" value="いつも出す" disabled></label></div>')
        + sec("接続", "共有の場所と写し方", '<div class="ux-grid">' + conn.filter((f) => f.id !== "lot").map((f, i) => field(f, i < 1)).join("") + '</div>')
        + sec("ロット番号の列", "", '<div class="ux-grid">' + field(conn.find((f) => f.id === "lot")) + '</div>')
        + sec("設備 " + d.wl.items.length + " 台", "フォルダで見つけた設備。表示するものを選ぶ", eqTable(d.wl, 6) + '<p class="ux-hint">… ほか ' + (d.wl.items.length - 6) + ' 台</p>')
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div>'
        + '</div></td></tr>');
      h.querySelector(".sr-table tbody").insertAdjacentHTML("beforeend", '<tr class="sr-gh ux-oth-g"><td colspan="7"><b>そのほかの接続</b><small>データ元ではない所（LotDsp・更新の置き場・ブラウザ）</small></td></tr>'
        + others(d).map((o) => '<tr class="sr-row"><td></td><td><b>' + esc(o.label) + '</b></td><td colspan="4" class="ux-mono">' + esc(o.value) + '</td><td class="sr-ac"><button class="pz-btn">変える…</button></td></tr>').join(""));`),
  },
  {
    key: "A2", name: "一覧＋右の詳細（選んだ元の設定を右に）",
    css: CSS_COMMON + `#masterSettings .sr-page{max-width:none}
      .ux-split{display:grid;grid-template-columns:minmax(0,46%) minmax(0,1fr);gap:14px;align-items:start}
      .ux-split .sr-table{table-layout:auto}.ux-split .sr-table colgroup{display:none}
      .ux-split .sr-table tr:not(.sr-gh) > :is(td,th):is(:nth-child(3),:nth-child(4),:nth-child(6)){display:none}
      .ux-side{position:sticky;top:0;max-height:calc(100vh - 230px);overflow:auto}
      .ux-side h3{margin:0;font-size:16px}
      tr.sr-row[data-key="work"] td{background:var(--input-soft,#e6effa);box-shadow:inset 0 1px 0 var(--h-input),inset 0 -1px 0 var(--h-input)}`,
    ops: A_BASE(`nav("データ元");
      const t = h.querySelector(".sr-table"); if (!t) return;
      const wrap = document.createElement("div"); wrap.className = "ux-split"; t.replaceWith(wrap); wrap.append(t);
      const sec = (tt, s, inner) => '<section class="ux-sec"><h4>' + tt + (s ? ' <small>' + s + '</small>' : '') + '</h4>' + inner + '</section>';
      wrap.insertAdjacentHTML("beforeend", '<div class="ux-box ux-side"><h3>実績 <small class="ux-hint">設備ごとの .sqlite3（フォルダ）</small></h3>'
        + sec("接続", "", '<div class="ux-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + conn.filter((f) => f.id !== "lot").map((f, i) => field(f, i < 2)).join("") + field(conn.find((f) => f.id === "lot"), true) + '</div>')
        + sec("設備 " + d.wl.items.length + " 台", "表示するものを選ぶ", eqTable(d.wl))
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span></div></div>');
      t.querySelector("tbody").insertAdjacentHTML("beforeend", '<tr class="sr-gh"><td colspan="7"><b>そのほかの接続</b><small>LotDsp・更新の置き場・ブラウザ ' + others(d).length + ' 件</small></td></tr>');`),
  },
  {
    key: "A3", name: "行の中で開き、中を段のタブ（基本・接続・設備・ロット番号・結合）で分ける",
    css: CSS_COMMON + `.ux-open td{padding:10px 14px !important;height:auto !important;white-space:normal !important;background:var(--input-soft,#eef4fb)}
      .ux-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line)}
      .ux-tabs button{border:0;background:none;padding:7px 14px;font:inherit;font-size:13px;color:var(--muted);border-bottom:3px solid transparent;cursor:pointer}
      .ux-tabs button.on{color:var(--ink);font-weight:700;border-bottom-color:var(--h-input)}
      .ux-tabs em{font-style:normal;font-size:11px;background:#fde2e2;color:#9b1c1c;border-radius:999px;padding:0 6px;margin-left:4px}`,
    ops: A_BASE(`nav("データ元");
      const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      const bad = d.wl.items.filter((e) => e.state === "missing" || e.stale).length;
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box">'
        + '<div class="ux-tabs"><button>基本</button><button class="on">接続</button><button>設備 ' + d.wl.items.length + (bad ? '<em>' + bad + '</em>' : '') + '</button><button>ロット番号の列</button><button>結合</button></div>'
        + '<div class="ux-grid">' + conn.filter((f) => f.id !== "lot").map((f, i) => field(f, i < 1)).join("") + '</div>'
        + '<p class="ux-hint">フォルダを保存すると、設備を探し直して「設備」の段に並べます。</p>'
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div>'
        + '</div></td></tr>');
      h.querySelector(".sr-table tbody").insertAdjacentHTML("beforeend", '<tr class="sr-gh"><td colspan="7"><b>そのほかの接続</b><small>' + others(d).map((o) => esc(o.label)).join("・") + '</small></td></tr>');`),
  },
  {
    key: "A4", name: "2 列の欄（左: 接続・右: 名前とロット番号）＋下に設備の表",
    css: CSS_COMMON + `.ux-open td{padding:12px 14px !important;height:auto !important;white-space:normal !important;background:var(--surface-2,#f6f8fb)}
      .ux-two{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px}
      .ux-col{display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:10px 12px}
      .ux-col h4{margin:0;font-size:12.5px;color:var(--muted);letter-spacing:.04em}`,
    ops: A_BASE(`nav("データ元");
      const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box">'
        + '<div class="ux-two"><div class="ux-col"><h4>接続（共有の場所と写し方）</h4><div class="ux-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + conn.filter((f) => f.id !== "lot").map((f, i) => field(f, i < 2)).join("") + '</div></div>'
        + '<div class="ux-col"><h4>名前と見え方</h4><label class="ux-f"><span>表示名</span><input class="ps-input" value="実績"></label>' + field(conn.find((f) => f.id === "lot")) + '</div></div>'
        + '<section class="ux-sec"><h4>設備 ' + d.wl.items.length + ' 台 <small>表示する設備を選ぶ（並びは ⠿ で）</small></h4>' + eqTable(d.wl, 5) + '<p class="ux-hint">… ほか ' + (d.wl.items.length - 5) + ' 台</p></section>'
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div>'
        + '</div></td></tr>');
      h.insertAdjacentHTML("beforeend", '<section class="ux-box"><h4 style="margin:0">そのほかの接続 <small class="ux-hint">データ元ではない所</small></h4><div class="ux-oth">' + others(d).map((o) => '<label class="ux-f"><span>' + esc(o.label) + '</span><input class="ps-input" value="' + esc(o.value) + '"></label>').join("") + '</div></section>');`),
  },
  {
    key: "A5", name: "一覧に接続の要約の列（場所・間隔・ロット番号）を出し、押すとその場で直す",
    css: CSS_COMMON + `#masterSettings .sr-page{max-width:none}
      .ux-cell{display:inline-flex;align-items:center;gap:4px;border:1px dashed transparent;border-radius:5px;padding:1px 6px;cursor:text}
      .ux-cell:hover{border-color:var(--line)}
      .ux-pop{position:relative}
      .ux-pop .ux-box{position:absolute;z-index:3;left:40px;top:2px;width:560px;box-shadow:0 10px 30px rgba(15,23,42,.18)}`,
    ops: A_BASE(`nav("データ元");
      const t = h.querySelector(".sr-table"); if (!t) return;
      t.querySelector("thead tr").insertAdjacentHTML("beforeend", '<th>間隔</th><th>ロット番号の列</th>');
      t.querySelector("colgroup").insertAdjacentHTML("beforeend", '<col style="width:70px"><col style="width:120px">');
      t.querySelectorAll("tr.sr-row").forEach((r) => { const s = d.src.items.find((x) => x.key === r.dataset.key) || {}; const c = Object.fromEntries((s.conn || []).map((f) => [f.id, f]));
        r.insertAdjacentHTML("beforeend", '<td><span class="ux-cell">' + esc((c.refresh || {}).effective ?? "-") + ' 秒</span></td><td><span class="ux-cell">' + ((c.lot || {}).value ? esc(c.lot.value) : "自動") + '</span></td>'); });
      t.querySelectorAll("tr.sr-gh td, tr.sr-empty td").forEach((td) => td.colSpan = 9);
      const tr = t.querySelector('tr.sr-row[data-key="work"]');
      tr.insertAdjacentHTML("afterend", '<tr class="ux-pop"><td colspan="9" style="height:0;padding:0"><div class="ux-box"><b>実績の場所</b><div class="ux-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + conn.filter((f) => f.id === "folder" || f.id === "pattern").map((f, i) => field(f, !i)).join("") + '</div><div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="pz-btn">設備 ' + d.wl.items.length + ' 台…</button></div></div></td></tr>');
      t.querySelector("tbody").insertAdjacentHTML("beforeend", '<tr class="sr-gh"><td colspan="9"><b>そのほかの接続</b><small>' + others(d).length + ' 件</small></td></tr>');`),
  },
];

// ---------------------------------------------------------------- B: 見出しのタブの権限（アクセス権限の頁）
// タブが多い形で比べる（本物のタブ＋台帳 8・工程 2・マスタ 2 の作り物。マスタ管理の「データ元」が多い利用者の形）
const B_BASE = (body) => [["script", COMMON + `
const FAKE = [["台帳", ["受入台帳", "出荷台帳", "保留台帳", "検査台帳", "梱包台帳", "倉庫台帳", "再処理台帳", "返品台帳"]], ["工程", ["工程A", "工程B"]], ["マスタ", ["製造条件マスタ", "設備マスタ"]]];
async function tabs() {
  const d = await data(), t = d.ta.tabs.filter((x) => !(x.role === "マスタ"));
  FAKE.forEach(([g, names]) => names.forEach((n, i) => t.push({ key: "f" + g + i, name: n, group: g, kind: "file" })));
  return t;
}
const RULE = { wip: ["設備作業者"], calc: ["設備作業者"], f台帳3: ["一般ユーザー", "設備作業者"], f工程0: ["設備作業者"], sch: ["一般ユーザー"] };
const ROLES = ["開発者", "メンテナンス者", "一般ユーザー", "設備作業者"];
const groupsOf = (t) => { const out = [["画面", t.filter((x) => x.kind === "screen")], ["グループなし", t.filter((x) => x.kind !== "screen" && !x.group)]];
  [...new Set(t.filter((x) => x.group).map((x) => x.group))].forEach((g) => out.push([g, t.filter((x) => x.group === g)])); return out; };
const hiddenFor = (k, r) => r !== "開発者" && (RULE[k] || []).includes(r);
watch("#masterDetail", async (h) => {
  if (!document.querySelector('#masterTabs [data-tab="access"].active') || !document.querySelector("#masterBody tr")) return false;
  nav("データ元");
  const t = await tabs();
  ${body}
});`]];

const CSS_B = CSS_COMMON + `
.ux-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
.ux-seg button{border:0;background:none;padding:6px 14px;font:inherit;font-size:13px;color:var(--muted);cursor:pointer}
.ux-seg button.on{background:var(--h-input,#2563eb);color:#fff;font-weight:700}
.ux-mx{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;table-layout:fixed}
.ux-mx th{position:sticky;top:0;background:var(--surface-3);font-size:12px;color:var(--muted);text-align:center;padding:6px;border-bottom:1px solid var(--line);z-index:1}
.ux-mx th:first-child{text-align:left}
.ux-mx td{border-bottom:1px solid var(--line-soft);height:30px;padding:0 8px;text-align:center}
.ux-mx td:first-child{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ux-mx tr.g td{background:var(--surface-2,#f3f6fa);font-weight:700;text-align:left;color:var(--ink)}
.ux-ck{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;border:1.5px solid #9aa9bb;background:#fff;color:#fff;font-size:14px;font-weight:800}
.ux-ck.on{background:#1d6b3a;border-color:#1d6b3a}
.ux-ck.off{background:#fff;border-color:#c0392b;color:#c0392b}
.ux-ck.lock{background:#d8dee6;border-color:#d8dee6;color:#5b6675}
.ux-sum{font-size:12px;color:var(--muted)}
.ux-pane{display:flex;flex-direction:column;gap:10px;padding:12px 16px;overflow:auto;max-height:calc(100vh - 220px)}
.ux-tri{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.ux-tri b{font-weight:400;font-size:12px;padding:3px 9px;color:var(--muted);border-left:1px solid var(--line)}
.ux-tri b:first-child{border-left:0}
.ux-tri b.on{background:var(--input-soft,#e6effa);color:var(--ink);font-weight:700}
.ux-tri b.on.h{background:#fde2e2;color:#9b1c1c}
.ux-tri b.on.s{background:#dcf3e4;color:#1d6b3a}
.ux-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:12px;background:var(--surface)}
.ux-chip.off{background:#fde2e2;border-color:#f3b4b4;color:#9b1c1c;text-decoration:line-through}
.ux-strip{display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;border-radius:8px;background:#163552}
.ux-strip span{color:#dbe7f3;font-size:12px;padding:3px 10px;border-radius:6px;background:rgba(255,255,255,.08)}
`;
// アクセス権限の頁の中身（一覧＋右の詳細）を案で置き換える所: 一覧の上に「人ごと／タブの権限」の切り替え
const B_SWITCH = `const top = document.querySelector(".master-toolbar"); if (top && !top.querySelector(".ux-seg")) top.insertAdjacentHTML("afterbegin", '<div class="ux-seg"><button>人ごと</button><button class="on">見出しのタブ</button></div>');
  document.querySelector("#masterDetail").style.display = "none"; document.querySelector(".master-table-wrap").style.gridColumn = "2 / -1";`;
const mainArea = `document.querySelector(".master-table-wrap")`;

const B = [
  {
    key: "B1", name: "表（行＝タブ・グループで畳む／列＝区分）で、押して出す・出さない。開発者はいつも出す",
    css: CSS_B,
    ops: B_BASE(`${B_SWITCH}
      const area = ${mainArea};
      const row = (x) => '<tr><td>' + esc(x.name) + '</td>' + ROLES.map((r) => '<td><span class="ux-ck ' + (r === "開発者" ? "lock" : hiddenFor(x.key, r) ? "off" : "on") + '">' + (r === "開発者" ? "✓" : hiddenFor(x.key, r) ? "✕" : "✓") + '</span></td>').join("") + '<td>' + (x.key === "wip" ? '<span class="ux-chip">例外 1 人</span>' : "") + '</td></tr>';
      area.innerHTML = '<div class="ux-pane"><div class="ux-acts"><input class="ps-input" placeholder="タブの名前で探す" style="width:260px;height:32px"><span class="ux-sum">✓ 出す・✕ 出さない。タブ ' + t.length + ' 個・出さない ' + Object.values(RULE).flat().length + ' か所</span><span class="sp"></span><button class="btn-primary">保存</button></div>'
        + '<table class="ux-mx"><colgroup><col style="width:34%"><col><col><col><col><col style="width:16%"></colgroup><thead><tr><th>タブ</th>' + ROLES.map((r) => '<th>' + r + (r === "開発者" ? "<br><small>いつも全部</small>" : "") + '</th>').join("") + '<th>人ごとの例外</th></tr></thead><tbody>'
        + groupsOf(t).map(([g, xs]) => '<tr class="g"><td colspan="6">▾ ' + esc(g) + ' <small class="ux-sum">' + xs.length + '</small></td></tr>' + xs.map(row).join("")).join("") + '</tbody></table></div>';`),
  },
  {
    key: "B2", name: "区分ごとに切り替え（上に区分のタブ）、タブをスイッチで出し入れ。上に、その区分に見える見出しの見本",
    css: CSS_B + `.ux-rl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 18px}
      .ux-rl label{display:flex;align-items:center;gap:8px;height:32px;border-bottom:1px solid var(--line-soft);font-size:13px}
      .ux-rl label .sp{flex:1}`,
    ops: B_BASE(`${B_SWITCH}
      const area = ${mainArea}, r = "一般ユーザー";
      area.innerHTML = '<div class="ux-pane"><div class="ux-seg">' + ROLES.slice(1).map((x) => '<button class="' + (x === r ? "on" : "") + '">' + x + ' <small>出さない ' + t.filter((y) => hiddenFor(y.key, x)).length + '</small></button>').join("") + '</div>'
        + '<p class="ux-hint">一般ユーザーに見える見出し:</p><div class="ux-strip">' + t.filter((x) => !hiddenFor(x.key, r) && !x.group).map((x) => '<span>' + esc(x.name) + '</span>').join("") + [...new Set(t.filter((x) => x.group).map((x) => x.group))].map((g) => '<span>' + esc(g) + ' ▾</span>').join("") + '</div>'
        + groupsOf(t).map(([g, xs]) => '<section class="ux-sec"><h4>' + esc(g) + ' <small>' + xs.length + '</small><button class="sr-gren">全部出す</button><button class="sr-gren">全部出さない</button></h4><div class="ux-rl">' + xs.map((x) => '<label>' + esc(x.name) + '<span class="sp"></span><button type="button" class="sr-sw' + (hiddenFor(x.key, r) ? "" : " on") + '"><i></i><span>' + (hiddenFor(x.key, r) ? "出さない" : "出す") + '</span></button></label>').join("") + '</div></section>').join("")
        + '<div class="ux-acts"><span class="sp"></span><button class="btn-primary">保存</button></div></div>';`),
  },
  {
    key: "B3", name: "人の詳細（右）に「見えるタブ」: タブごとに 区分どおり／出す／出さない。区分の決まりは別の表",
    css: CSS_B + `#masterFormBody .ux-sec{grid-column:1/-1}.ux-pl{display:flex;flex-direction:column}
      .ux-pl div{display:flex;align-items:center;gap:8px;height:32px;border-bottom:1px solid var(--line-soft);font-size:13px}
      .ux-pl div .sp{flex:1}.ux-pl .g{font-weight:700;background:var(--surface-2,#f3f6fa);padding:0 6px}`,
    ops: B_BASE(`const pane = document.querySelector("#masterFormBody"); if (!pane) return;
      const r = "一般ユーザー", st = (x) => x.key === "wip" ? "s" : x.key === "f台帳5" ? "h" : "";
      pane.insertAdjacentHTML("beforeend", '<section class="ux-sec" style="margin-top:8px"><h4>見えるタブ <small>区分（' + r + '）の決まり＋この人だけの例外</small></h4><input class="ps-input" placeholder="タブを探す" style="height:30px"><div class="ux-pl">'
        + groupsOf(t).map(([g, xs]) => '<div class="g">' + esc(g) + '</div>' + xs.map((x) => '<div>' + (hiddenFor(x.key, r) && st(x) !== "s" || st(x) === "h" ? '<span class="ux-chip off">' + esc(x.name) + '</span>' : esc(x.name)) + '<span class="sp"></span><span class="ux-tri"><b class="' + (st(x) ? "" : "on") + '">区分どおり</b><b class="' + (st(x) === "s" ? "on s" : "") + '">出す</b><b class="' + (st(x) === "h" ? "on h" : "") + '">出さない</b></span></div>').join("")).join("")
        + '</div><button class="pz-btn">区分ごとの決まりを直す…</button></section>');`),
  },
  {
    key: "B4", name: "表（行＝タブ／列＝区分＋登録した人）。人の列は効いている結果で、例外に印",
    css: CSS_B + `.ux-wide{overflow:auto}.ux-mx.w{min-width:900px}.ux-mx td.ex{box-shadow:inset 0 0 0 2px #e0a100}`,
    ops: B_BASE(`${B_SWITCH}
      const area = ${mainArea}, people = [["satoshi-harada", "開発者"], ["user-a", "一般ユーザー"], ["line-1", "設備作業者"]];
      const cell = (k, r, ex) => '<td class="' + (ex ? "ex" : "") + '"><span class="ux-ck ' + (r === "開発者" ? "lock" : (ex ? !hiddenFor(k, r) : hiddenFor(k, r)) ? "off" : "on") + '">' + ((ex ? !hiddenFor(k, r) : hiddenFor(k, r)) && r !== "開発者" ? "✕" : "✓") + '</span></td>';
      area.innerHTML = '<div class="ux-pane ux-wide"><table class="ux-mx w"><colgroup><col style="width:220px"></colgroup><thead><tr><th>タブ</th>' + ROLES.map((r) => '<th>' + r + '</th>').join("") + people.map(([p, r]) => '<th>' + esc(p) + '<br><small>' + r + '</small></th>').join("") + '</tr></thead><tbody>'
        + groupsOf(t).map(([g, xs]) => '<tr class="g"><td colspan="' + (1 + ROLES.length + people.length) + '">▾ ' + esc(g) + '</td></tr>' + xs.map((x) => '<tr><td>' + esc(x.name) + '</td>' + ROLES.map((r) => cell(x.key, r)).join("") + people.map(([p, r]) => cell(x.key, r, p === "user-a" && x.key === "wip")).join("") + '</tr>').join("")).join("") + '</tbody></table></div>';`),
  },
  {
    key: "B5", name: "タブごとの札（タブの名前＋出さない区分の札）を並べ、押して区分を足す・外す。出さない物だけに絞れる",
    css: CSS_B + `.ux-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .ux-card{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}
      .ux-card b{font-size:13px}.ux-card .rs{display:flex;flex-wrap:wrap;gap:4px}`,
    ops: B_BASE(`${B_SWITCH}
      const area = ${mainArea};
      area.innerHTML = '<div class="ux-pane"><div class="ux-acts"><input class="ps-input" placeholder="タブの名前で探す" style="width:260px;height:32px"><label class="ux-sum"><input type="checkbox"> 出さない区分がある物だけ</label><span class="sp"></span><button class="btn-primary">保存</button></div>'
        + groupsOf(t).map(([g, xs]) => '<section class="ux-sec"><h4>' + esc(g) + ' <small>' + xs.length + '</small></h4><div class="ux-cards">' + xs.map((x) => '<div class="ux-card"><b>' + esc(x.name) + '</b><div class="rs">' + ROLES.slice(1).map((r) => '<span class="ux-chip' + (hiddenFor(x.key, r) ? " off" : "") + '">' + r + '</span>').join("") + '</div></div>').join("") + '</div></section>').join("") + '</div>';`),
  },
];

export const PROPOSALS = [...A, ...B];
export { COMMON, CSS_COMMON, CSS_B };   // 2 回目（2026-10-unify-2.mjs）が使う
