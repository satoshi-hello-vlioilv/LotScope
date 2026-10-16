// 2026-10 データ元（品質データ・作業実績・仕掛・足した元を 1 つの並びで。版 3.36.0）。1 回目。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sources.mjs --states master-sources,master-sources-edit,wip
//   （--view 1280x720 でも）
// 利用者の声: WaveLog のように、指定したフォルダの場所のデータを参照できる仕組みを。仕掛（LOTNOW.sqlite3）や実装済みの作業実績も、その仕組みの中で。
// 今の画面（土台。master-sources・master-sources-edit・wip）で見えたこと:
//   ①場所の字が末尾で切れ、いちばん大事なファイル名（LOTNOW.sqlite3）が見えない ②届いているか・いつ写したか・何件か（状態）が見えない
//   ③直す欄が表から離れた下に出て、どの行を直しているか目で追う ④表示名の欄が潰れて低い ⑤品質データの場所は参照先とデータ元の 2 か所で直せる
//   ⑥役割「仕掛」の札だけ形が違う（地が無い） ⑦仕掛は見出しの 4 つ目のタブ（1280 でも収まる）
// 案（何で解くか）:
//   A 表を直す（場所は末尾を残して縮める・状態の列・直す欄はその行のすぐ下に開く）
//   B カード（元ごとに 1 枚。場所は折り返して全部・状態の札・直すのはカードの中）
//   C 左右（左に元の並び、右にいま選んだ元の全部の欄。変える… の手が無い）
//   D 役割でまとめる（品質・実績・仕掛・足した元の見出しで分け、行は 1 段。品質データの場所はここだけで直す〈参照先から外す〉）
//   E 表＋右の引き出し（表は全幅のまま、直す欄は右から重ねる）
// 見出しのタブ（仕掛）はどの案も同じ（4 つ目のタブ）。wip の状態は材料として撮る

const css = `
.pv-path{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 6px;border-radius:4px;white-space:nowrap}
.pv-path b{font-weight:700;color:var(--ink)}
.pv-state{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap}
.pv-state i{width:8px;height:8px;border-radius:50%;background:#9aa6b0;flex:none}
.pv-state.ok i{background:var(--ok)} .pv-state.ng i{background:#c0392b} .pv-state.wait i{background:var(--accent)}
.pv-role{display:inline-block;padding:0 9px;border-radius:999px;font-size:12px;font-weight:700;background:#eef1f4;color:#44576a}
.pv-role.r-品質{background:#e7eef7;color:#2f5d8a} .pv-role.r-実績{background:#e5f3ea;color:#1c7c4a} .pv-role.r-仕掛{background:#fff1d6;color:#8a5200} .pv-role.r-その他{background:#f1f3f6;color:#44576a}
.pv-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;padding:10px 0}
.pv-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;min-width:0}
.pv-form label > span{color:var(--ro-ink);font-weight:700}
.pv-form .w{grid-column:1 / -1}
.pv-form input,.pv-form select{height:32px;box-sizing:border-box}
.pv-acts{display:flex;gap:8px;align-items:center;grid-column:1 / -1}
.pv-lead{color:var(--ro-ink);font-size:13.5px;margin:0}
/* A */
.pvA td{vertical-align:middle}
.pvA tr.is-sel > td{background:var(--input-soft)}
.pvA tr.pv-edit > td{background:#f7fafd;border-left:4px solid var(--h-input);padding:4px 14px}
/* B */
.pvB{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pvB .card{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.pvB .card.is-sel{grid-column:1 / -1;border-left:4px solid var(--h-input)}
.pvB .ch{display:flex;align-items:center;gap:10px}
.pvB .ch b{font-size:15px}
.pvB .ch .sp{flex:1}
.pvB .where{white-space:normal;word-break:break-all;font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;color:var(--ro-ink)}
.pvB .where b{color:var(--ink)}
.pvB .facts{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--ro-ink)}
.pvB .facts span b{color:var(--ink)}
/* C */
.pvC{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;min-height:420px}
.pvC .list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface);align-self:start}
.pvC .it{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;text-align:left;background:none;border-left:4px solid transparent}
.pvC .it.is-sel{background:var(--input-soft);border-left-color:var(--h-input)}
.pvC .it small{grid-column:1 / -1;color:var(--muted);font-size:12px}
.pvC .detail{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px 16px;display:flex;flex-direction:column;gap:6px}
.pvC .dh{display:flex;align-items:center;gap:10px}
.pvC .dh b{font-size:16px}
.pvC .add{padding:10px 12px;text-align:left;color:var(--h-input);font-weight:700;background:none;border:0;cursor:pointer}
/* D */
.pvD{display:flex;flex-direction:column;gap:14px}
.pvD h4{margin:0 0 6px;font-size:13px;color:var(--ro-ink);display:flex;align-items:center;gap:8px}
.pvD .row{display:grid;grid-template-columns:150px minmax(0,1fr) 200px 190px auto;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.pvD .row.is-sel{border-left:4px solid var(--h-input);background:#f7fafd}
.pvD .row .pv-form{grid-column:1 / -1}
/* E */
.pvE-wrap{position:relative}
.pvE-drawer{position:absolute;top:0;right:0;width:440px;max-width:60%;height:100%;min-height:420px;background:var(--surface);border-left:1px solid var(--line);box-shadow:-10px 0 24px rgba(20,40,60,.14);padding:14px 16px;display:flex;flex-direction:column;gap:8px;border-radius:10px 0 0 10px}
.pvE-drawer .pv-form{grid-template-columns:1fr}
`;

// 画面の中で描く（/api/sources の答えから）。kind: A〜E。編集は [data-sr-edit] を押したら（撮影の台本が wip を押す）
const page = (kind) => `{
const K = ${JSON.stringify(kind)};
const esc = (s) => TPA.esc(s);
const tail = (p, keep = 2) => { const s = String(p || ""), parts = s.replace(/^\\\\\\\\/, "").split(/[\\\\/]/).filter(Boolean);
  if (parts.length <= keep + 1) return esc(s);
  const head = (s.startsWith("\\\\\\\\") ? "\\\\\\\\" : "") + parts[0];
  return esc(head) + "\\\\…\\\\" + parts.slice(-keep, -1).map(esc).join("\\\\") + (keep > 1 ? "\\\\" : "") + "<b>" + esc(parts[parts.length - 1]) + "</b>"; };
const full = (p) => { const s = String(p || ""), i = s.search(/[^\\\\/]+$/); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<b>" + esc(s.slice(i)) + "</b>"; };
const where = (s) => s.kind === "folder" ? (s.place + "\\\\" + (s.pattern || "")) : s.place;
const role = (r) => '<span class="pv-role r-' + esc(r) + '">' + esc(r) + "</span>";
const state = (s) => { const m = s.mirror;
  if (s.kind === "folder") return '<span class="pv-state ok"><i></i>設備 11 台・作業実績で見る</span>';
  if (!m) return '<span class="pv-state"><i></i>まだ開いていません</span>';
  if (m.unreachable) return '<span class="pv-state ng"><i></i>届きません</span>';
  const d = m.at ? new Date(m.at * 1000) : null, p = TPA.pad2;
  return '<span class="pv-state ok"><i></i>届いています・元 ' + (d ? (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes()) : "-") + "</span>"; };
const tab = (s) => s.screen === "list" ? "異常ロット一覧" : s.screen === "work" ? "作業実績" : s.listed ? "見出しにタブ「" + esc(s.name) + "」" : "タブなし";
const equip = (s) => s.equipColumn ? esc(s.equipColumn) + "（" + esc(s.equipMode) + "）" : "見分けない";
const form = (s) => s.kind === "folder"
  ? '<div class="pv-form"><p class="pv-lead w">作業実績のフォルダと名前の決まりは「作業実績」のタブで直します（直すと設備を探し直します）。</p><div class="pv-acts"><button type="button" class="pz-btn">作業実績を開く ›</button></div></div>'
  : '<div class="pv-form">'
    + (s.key === "lot" ? "" : '<label><span>表示名</span><input class="ps-input" value="' + esc(s.name) + '"></label>')
    + '<label><span>役割</span><select><option>' + esc(s.role) + '</option></select></label>'
    + '<label><span>見出しのタブ</span><select><option>' + (s.listed ? "出す" : "出さない") + '</option></select></label>'
    + '<label class="w"><span>場所（共有の .sqlite3）</span><span style="display:flex;gap:6px"><input class="ps-input" style="flex:1" value="' + esc(s.place) + '"><button type="button" class="pz-btn">📄 参照…</button></span></label>'
    + '<label><span>表（空なら自動）</span><input class="ps-input" placeholder="自動" value="' + esc(s.table) + '"></label>'
    + '<label><span>設備の列</span><input class="ps-input" value="' + esc(s.equipColumn) + '"></label>'
    + '<label><span>設備の取り出し方</span><select><option>' + esc(s.equipMode) + '</option></select></label>'
    + '<div class="pv-acts"><button type="button" class="ps-check">確かめる</button><button type="button" class="btn-primary">保存</button><button type="button" class="btn-ghost">閉じる</button></div></div>';
const btn = (s) => '<button type="button" class="pz-btn" data-sr-edit="' + esc(s.key) + '">変える…</button>';
const add = '<div class="sr-add"><button type="button" class="btn-primary">＋ データ元を足す</button><small>共有の .sqlite3 ファイルを 1 つ選んで、異常ロット一覧と同じ形で見られるようにします。</small></div>';
const lead = '<p class="pv-lead">アプリが読む共有のデータです。どれも手元へ写してから読みます。場所を変えると、全員の PC で次に読むときから新しい場所を読みます。</p>';
function view(items, ed) {
  if (K === "A") return lead + '<div class="master-table-wrap pz-wrap"><table class="master-table pvA"><thead><tr><th>データ元</th><th>役割</th><th>場所</th><th>状態</th><th>設備の列</th><th>見出しのタブ</th><th></th></tr></thead><tbody>'
    + items.map((s) => '<tr' + (s.key === ed ? ' class="is-sel"' : "") + '><td><b>' + esc(s.name) + '</b></td><td>' + role(s.role) + '</td><td><span class="pv-path" title="' + esc(where(s)) + '">' + tail(where(s)) + '</span></td><td>' + state(s) + '</td><td>' + equip(s) + '</td><td>' + tab(s) + '</td><td>' + btn(s) + '</td></tr>'
      + (s.key === ed ? '<tr class="pv-edit"><td colspan="7">' + form(s) + '</td></tr>' : "")).join("") + "</tbody></table></div>" + add;
  if (K === "B") return lead + '<div class="pvB">' + items.map((s) => '<section class="card' + (s.key === ed ? " is-sel" : "") + '"><div class="ch"><b>' + esc(s.name) + '</b>' + role(s.role) + state(s) + '<span class="sp"></span>' + (s.key === ed ? "" : btn(s)) + '</div>'
      + '<div class="where">' + full(where(s)) + '</div><div class="facts"><span>表 <b>' + esc(s.table || "自動") + '</b></span><span>設備の列 <b>' + equip(s) + '</b></span><span>' + tab(s) + '</span></div>'
      + (s.key === ed ? form(s) : "") + "</section>").join("") + "</div>" + add;
  if (K === "C") { const cur = items.find((s) => s.key === ed) || items[0];
    return lead + '<div class="pvC"><div class="list">' + items.map((s) => '<button type="button" class="it' + (s === cur ? " is-sel" : "") + '" data-sr-edit="' + esc(s.key) + '"><b>' + esc(s.name) + '</b>' + role(s.role) + '<small>' + state(s) + '</small></button>').join("")
      + '<button type="button" class="add">＋ データ元を足す</button></div><div class="detail"><div class="dh"><b>' + esc(cur.name) + '</b>' + role(cur.role) + state(cur) + '</div><span class="pv-path" title="' + esc(where(cur)) + '">' + full(where(cur)) + '</span>' + form(cur) + "</div></div>"; }
  if (K === "D") { const groups = [["品質", "品質データ"], ["実績", "作業実績"], ["仕掛", "仕掛"], ["その他", "足した元"]];
    return lead + '<div class="pvD">' + groups.map(([r, label]) => { const xs = items.filter((s) => s.role === r); if (!xs.length && r !== "その他") return "";
      return '<section><h4>' + role(r) + label + "</h4>" + (xs.length ? xs.map((s) => '<div class="row' + (s.key === ed ? " is-sel" : "") + '"><b>' + esc(s.name) + '</b><span class="pv-path" title="' + esc(where(s)) + '">' + tail(where(s)) + '</span>' + state(s) + '<span>' + equip(s) + '</span>' + btn(s) + (s.key === ed ? form(s) : "") + "</div>").join("") : '<small class="pv-lead">まだありません。</small>') + "</section>"; }).join("") + "</div>" + add; }
  if (K === "E") { const cur = items.find((s) => s.key === ed);
    return lead + '<div class="pvE-wrap"><div class="master-table-wrap pz-wrap"><table class="master-table pvA"><thead><tr><th>データ元</th><th>役割</th><th>場所</th><th>状態</th><th>設備の列</th><th>見出しのタブ</th><th></th></tr></thead><tbody>'
      + items.map((s) => '<tr' + (s.key === ed ? ' class="is-sel"' : "") + '><td><b>' + esc(s.name) + '</b></td><td>' + role(s.role) + '</td><td><span class="pv-path" title="' + esc(where(s)) + '">' + tail(where(s)) + '</span></td><td>' + state(s) + '</td><td>' + equip(s) + '</td><td>' + tab(s) + '</td><td>' + btn(s) + "</td></tr>").join("")
      + "</tbody></table></div>" + add + (cur ? '<aside class="pvE-drawer"><div class="dh" style="display:flex;gap:8px;align-items:center"><b style="font-size:16px">' + esc(cur.name) + '</b>' + role(cur.role) + '<span style="flex:1"></span><button type="button" class="icon-btn" aria-label="閉じる">×</button></div>' + state(cur) + form(cur) + "</aside>" : "") + "</div>"; }
  return "";
}
let data = null, ed = null;
const paint = () => { const p = document.querySelector("#masterSettings .sr-page"); if (!p || !data) return;
  if (p.dataset.pv === K + "|" + ed) return; p.dataset.pv = K + "|" + ed; p.innerHTML = view(data, ed); };
document.addEventListener("click", (e) => { const b = e.target.closest("[data-sr-edit]"); if (!b || !b.closest(".sr-page")) return; e.stopImmediatePropagation(); e.preventDefault(); ed = b.dataset.srEdit; paint(); }, true);
const tick = async () => { if (!data && document.querySelector("#masterSettings .sr-page")) { data = (await (await fetch("/api/sources")).json()).items; } paint(); };
new MutationObserver(tick).observe(document.body, { childList: true, subtree: true }); tick();
}`;

// D: 品質データの場所は「データ元」だけで直す（参照先の 2 枚を外し、参照先の頭に一言）
const dropLotFromPaths = ["script", `{ const run = () => { document.querySelectorAll('#masterSettings .ps-card[data-key^="lot_list.source"], #masterSettings .ps-card[data-key^="lot_list.table"]').forEach((c) => c.remove()); };
  run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];

export const PROPOSALS = [
  { key: "0", name: "今（表＋下に直す欄。場所の末尾が切れる・状態が出ない）", css: "", ops: [] },
  { key: "A", name: "表を直す: 場所は末尾（ファイル名）を残して縮める・状態の列・直す欄はその行のすぐ下", css, ops: [["script", page("A")]] },
  { key: "B", name: "カード: 元ごとに 1 枚（場所は全部・状態の札）。直すのは開いたカードの中", css, ops: [["script", page("B")]] },
  { key: "C", name: "左右: 左に元の並び（状態つき）、右に選んだ元の全部の欄（変える… の手が無い）", css, ops: [["script", page("C")]] },
  { key: "D", name: "役割でまとめる: 品質・実績・仕掛・足した元の見出し、行は 1 段。品質データの場所はここだけ（参照先から外す）", css, ops: [["script", page("D")], dropLotFromPaths] },
  { key: "E", name: "表＋右の引き出し: 表は全幅のまま、直す欄は右から重ねる", css, ops: [["script", page("E")]] },
];
