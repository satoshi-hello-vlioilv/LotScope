// 2026-10 データ元。2 回目（合格点 90 点）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-sources-2.mjs --states master-sources,master-sources-edit,wip
// 1 回目（2026-10-sources.mjs・.json）の 1 位は B（カード・79.8 点）。採点者が挙げた直す所:
//   ①場所はファイル名まで全部（区切りの / と \ を混ぜない） ②品質データの場所はデータ元だけで直す（参照先から外す。D の形）
//   ③状態の言葉をはっきり（「写した 10/16 02:25」）・件数も出す ④見出しのタブを並びに残す ⑤同じ字の繰り返し（「仕掛 仕掛」・役割の見出しと名前）をやめる
//   ⑥開いたら要約と欄で 2 度出さない ⑦2 列で 1 枚だけ残る釣り合い → 1 列 ⑧1280 で開いた形が下で切れない ⑨選ぶだけで開く（C の良い所）
// どの案も共通: 場所は全部（ファイル名は太字）・区切りはその場所の物のまま・状態は「写した M/D HH:MM・N 行」／「まだ開いていません」・
//   役割の札は名前と同じ字なら出さない・品質データの場所は参照先から外す・足した元が無ければ「足した元」の見出しは出さない
// 案:
//   B2 B を直す（1 列のカード。開いたカードは要約を欄に置き換える）
//   D2 D を直す（役割の見出しの下に 1 段の行。場所の列を広く。足した元が無ければその見出しは出さない）
//   F  B2 ＋ 選ぶだけで開く（カードのどこを押しても開く・変える… が無い。開いたカードの頭に「閉じる ×」）
//   G  1 行の並び（表の罫線なし。名前｜場所｜状態｜タブ）。行を押すとその行の下に欄が開く（アコーディオン）
//   H  左右（左に名前と状態だけの並び〈ボタンの線なし〉、右に選んだ元の場所・状態と欄。閉じるは無い）

const css = `
.pv-path{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;color:var(--ro-ink);word-break:break-all}
.pv-path b{color:var(--ink);font-weight:700}
.pv-state{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap;color:var(--ro-ink)}
.pv-state i{width:8px;height:8px;border-radius:50%;background:#9aa6b0;flex:none}
.pv-state.ok i{background:var(--ok)} .pv-state.ng i{background:#c0392b}
.pv-role{display:inline-block;padding:0 9px;border-radius:999px;font-size:12px;font-weight:700;background:#eef1f4;color:#44576a}
.pv-tab{font-size:12.5px;color:var(--ro-ink);white-space:nowrap}
.pv-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;padding-top:6px}
.pv-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;min-width:0}
.pv-form label > span{color:var(--ro-ink);font-weight:700}
.pv-form .w{grid-column:1 / -1}
.pv-form input,.pv-form select{height:32px;box-sizing:border-box}
.pv-acts{display:flex;gap:8px;align-items:center;grid-column:1 / -1}
.pv-lead{color:var(--ro-ink);font-size:13.5px;margin:0}
.pv-add{display:flex;align-items:center;gap:12px;margin-top:4px}
.pv-add small{color:var(--muted)}
/* B2・F: 1 列のカード */
.pvB{display:flex;flex-direction:column;gap:10px}
.pvB .card{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:10px 14px;display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:4px 14px;align-items:center}
.pvB .card.is-sel{border-left:4px solid var(--h-input);padding-left:11px}
.pvB .card.click{cursor:pointer} .pvB .card.click:hover{border-color:#b9cde2}
.pvB .nm{display:flex;flex-direction:column;gap:3px}
.pvB .nm b{font-size:15px}
.pvB .facts{grid-column:2 / 3;display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--ro-ink)}
.pvB .facts b{color:var(--ink)}
.pvB .card > .pv-form{grid-column:1 / -1}
.pvB .x{border:0;background:none;font-size:18px;color:var(--muted);cursor:pointer}
/* D2 */
.pvD{display:flex;flex-direction:column;gap:12px}
.pvD h4{margin:0 0 4px;font-size:12.5px;color:var(--muted);letter-spacing:.06em}
.pvD .row{display:grid;grid-template-columns:130px minmax(0,1fr) 210px 170px auto;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.pvD .row.is-sel{border-left:4px solid var(--h-input);background:#f7fafd}
.pvD .row .pv-form{grid-column:1 / -1}
/* G: 1 行の並び（罫線なし）＋アコーディオン */
.pvG{display:flex;flex-direction:column;border-top:1px solid var(--line)}
.pvG .it{display:grid;grid-template-columns:24px 150px minmax(0,1fr) 220px 170px;align-items:center;gap:12px;padding:10px 6px;border-bottom:1px solid var(--line);cursor:pointer}
.pvG .it:hover{background:#f7fafd}
.pvG .it.is-sel{background:var(--input-soft)}
.pvG .chev{color:var(--muted);font-size:12px;transition:transform .15s}
.pvG .it.is-sel .chev{transform:rotate(90deg)}
.pvG .open{padding:4px 14px 14px 36px;border-bottom:1px solid var(--line);background:#f7fafd}
/* H: 左右 */
.pvH{display:grid;grid-template-columns:250px minmax(0,1fr);gap:14px}
.pvH .list{display:flex;flex-direction:column;gap:4px;align-self:start}
.pvH .it{display:flex;flex-direction:column;gap:3px;padding:9px 12px;border-radius:8px;border:0;background:transparent;text-align:left;font:inherit;cursor:pointer;border-left:4px solid transparent}
.pvH .it:hover{background:#f1f5f9}
.pvH .it.is-sel{background:var(--input-soft);border-left-color:var(--h-input)}
.pvH .it b{font-size:14.5px}
.pvH .detail{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px 16px;display:flex;flex-direction:column;gap:6px;align-self:start}
.pvH .dh{display:flex;align-items:center;gap:10px}
.pvH .dh b{font-size:16px}
.pvH .add{padding:9px 12px;color:var(--h-input);font-weight:700;background:none;border:0;text-align:left;cursor:pointer;font:inherit}
`;

const page = (kind) => `{
const K = ${JSON.stringify(kind)};
const esc = (s) => TPA.esc(s);
const sep = (p) => (String(p).includes("\\\\") ? "\\\\" : "/");
const where = (s) => s.kind === "folder" ? s.place + sep(s.place) + (s.pattern || "") : s.place;
const full = (p) => { const s = String(p || ""), i = s.search(/[^\\\\/]+$/); return '<span class="pv-path">' + (i < 0 ? esc(s) : esc(s.slice(0, i)) + "<b>" + esc(s.slice(i)) + "</b>") + "</span>"; };
const role = (s) => (s.name.includes(s.role) ? "" : '<span class="pv-role">' + esc(s.role) + "</span>");
const when = (sec) => { const d = new Date(sec * 1000), p = TPA.pad2; return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes()); };
const state = (s) => { const m = s.mirror;
  if (s.kind === "folder") return '<span class="pv-state ok"><i></i>設備ごとに写す（作業実績で見る）</span>';
  if (!m || !m.mirrored) return '<span class="pv-state"><i></i>まだ開いていません</span>';
  if (m.unreachable) return '<span class="pv-state ng"><i></i>届きません（写しで見ています）</span>';
  return '<span class="pv-state ok"><i></i>写した ' + when(m.copiedAt || m.at) + (s.rows != null ? "・" + s.rows.toLocaleString() + " 行" : "") + "</span>"; };
const tab = (s) => '<span class="pv-tab">' + (s.screen === "list" ? "タブ: 異常ロット一覧" : s.screen === "work" ? "タブ: 作業実績" : s.listed ? "タブ: " + esc(s.name) : "タブなし") + "</span>";
const equip = (s) => s.equipColumn ? "設備の列 <b>" + esc(s.equipColumn) + "</b>（" + esc(s.equipMode) + "）" : "設備は見分けない";
const form = (s) => s.kind === "folder"
  ? '<div class="pv-form"><p class="pv-lead w">フォルダとファイル名の決まりは「作業実績」のタブで直します（直すと設備を探し直します）。</p><div class="pv-acts"><button type="button" class="pz-btn">作業実績を開く ›</button></div></div>'
  : '<div class="pv-form">'
    + (s.key === "lot" ? "" : '<label><span>表示名</span><input class="ps-input" value="' + esc(s.name) + '"></label>')
    + (s.builtin ? "" : '<label><span>役割</span><select><option>' + esc(s.role) + "</option></select></label>")
    + (s.key === "lot" ? "" : '<label><span>見出しのタブ</span><select><option>' + (s.listed ? "出す" : "出さない") + "</option></select></label>")
    + '<label class="w"><span>場所（共有の .sqlite3）</span><span style="display:flex;gap:6px"><input class="ps-input" style="flex:1" value="' + esc(s.place) + '"><button type="button" class="pz-btn">📄 参照…</button></span></label>'
    + '<label><span>表（空なら自動）</span><input class="ps-input" placeholder="自動" value="' + esc(s.table) + '"></label>'
    + '<label><span>設備の列</span><input class="ps-input" value="' + esc(s.equipColumn) + '"></label>'
    + '<label><span>設備の取り出し方</span><select><option>' + esc(s.equipMode) + "</option></select></label>"
    + '<div class="pv-acts"><button type="button" class="ps-check">確かめる</button><button type="button" class="btn-primary">保存</button>' + (K === "H" ? "" : '<button type="button" class="btn-ghost" data-pv-close>閉じる</button>') + "</div></div>";
const add = '<div class="pv-add"><button type="button" class="btn-primary">＋ データ元を足す</button><small>共有の .sqlite3 ファイルを 1 つ選んで、異常ロット一覧と同じ形で見られるようにします。</small></div>';
const lead = '<p class="pv-lead">アプリが読む共有のデータです。どれも手元へ写してから読みます。場所を変えると、全員の PC で次に読むときから新しい場所を読みます。</p>';
function card(s, ed, click) {
  const sel = s.key === ed;
  const head = '<div class="nm"><b>' + esc(s.name) + "</b>" + role(s) + "</div>";
  if (sel) return '<section class="card is-sel">' + head + '<div style="display:flex;gap:12px;align-items:center">' + state(s) + tab(s) + '</div>' + (click ? '<button type="button" class="x" data-pv-close aria-label="閉じる">×</button>' : "<span></span>") + form(s) + "</section>";
  return '<section class="card' + (click ? " click" : "") + '"' + (click ? ' data-sr-edit="' + esc(s.key) + '"' : "") + ">" + head + "<div>" + full(where(s)) + "</div>"
    + (click ? "<span></span>" : '<button type="button" class="pz-btn" data-sr-edit="' + esc(s.key) + '">変える…</button>')
    + '<div class="facts">' + state(s) + "<span>" + equip(s) + "</span>" + tab(s) + "</div></section>";
}
function view(items, ed) {
  if (K === "B2" || K === "F") return lead + '<div class="pvB">' + items.map((s) => card(s, ed, K === "F")).join("") + "</div>" + add;
  if (K === "D2") { const groups = [["品質", "品質"], ["実績", "実績"], ["仕掛", "仕掛"], ["その他", "足した元"]];
    return lead + '<div class="pvD">' + groups.map(([r, label]) => { const xs = items.filter((s) => s.role === r); if (!xs.length) return "";
      return "<section><h4>" + label + "</h4>" + xs.map((s) => '<div class="row' + (s.key === ed ? " is-sel" : "") + '"><b>' + esc(s.name) + "</b>" + full(where(s)) + state(s) + tab(s)
        + (s.key === ed ? "<span></span>" + form(s) : '<button type="button" class="pz-btn" data-sr-edit="' + esc(s.key) + '">変える…</button>') + "</div>").join("") + "</section>"; }).join("") + "</div>" + add; }
  if (K === "G") return lead + '<div class="pvG">' + items.map((s) => '<div class="it' + (s.key === ed ? " is-sel" : "") + '" data-sr-edit="' + esc(s.key) + '"><span class="chev">▶</span><span><b>' + esc(s.name) + "</b> " + role(s) + "</span>" + full(where(s)) + state(s) + tab(s) + "</div>"
      + (s.key === ed ? '<div class="open">' + form(s) + "</div>" : "")).join("") + "</div>" + add;
  if (K === "H") { const cur = items.find((s) => s.key === ed) || items[0];
    return lead + '<div class="pvH"><div class="list">' + items.map((s) => '<button type="button" class="it' + (s === cur ? " is-sel" : "") + '" data-sr-edit="' + esc(s.key) + '"><b>' + esc(s.name) + "</b>" + state(s) + "</button>").join("")
      + '<button type="button" class="add">＋ データ元を足す</button></div><div class="detail"><div class="dh"><b>' + esc(cur.name) + "</b>" + role(cur) + tab(cur) + "</div>" + full(where(cur)) + state(cur) + form(cur) + "</div></div>"; }
  return "";
}
let data = null, ed = null;
const paint = () => { const p = document.querySelector("#masterSettings .sr-page"); if (!p || !data) return;
  if (p.dataset.pv === K + "|" + ed) return; p.dataset.pv = K + "|" + ed; p.innerHTML = view(data, ed); };
document.addEventListener("click", (e) => { if (!e.target.closest(".sr-page")) return;
  if (e.target.closest("[data-pv-close]")) { e.stopImmediatePropagation(); ed = null; paint(); return; }
  const b = e.target.closest("[data-sr-edit]"); if (!b) return; e.stopImmediatePropagation(); e.preventDefault(); ed = b.dataset.srEdit; paint(); }, true);
const tick = async () => { if (!data && document.querySelector("#masterSettings .sr-page")) { data = (await (await fetch("/api/sources")).json()).items; } paint(); };
new MutationObserver(tick).observe(document.body, { childList: true, subtree: true }); tick();
}`;

// 品質データの場所は「データ元」だけで直す（参照先の 2 枚を外す）
const dropLotFromPaths = ["script", `{ const run = () => { document.querySelectorAll('#masterSettings .ps-card[data-key="lot_list.source"], #masterSettings .ps-card[data-key="lot_list.table"]').forEach((c) => c.remove()); };
  run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];

export const PROPOSALS = [
  { key: "0", name: "今（表＋下に直す欄）", css: "", ops: [] },
  { key: "B2", name: "B を直す: 1 列のカード（場所は全部・写した時刻と行の数・役割の札は名前と同じなら出さない）。開いたら要約を欄に置き換える", css, ops: [["script", page("B2")], dropLotFromPaths] },
  { key: "D2", name: "D を直す: 役割の見出しの下に 1 段の行（場所の列を広く・足した元が無ければ見出しを出さない）", css, ops: [["script", page("D2")], dropLotFromPaths] },
  { key: "F", name: "B2 ＋ 選ぶだけで開く（カードのどこを押しても開く・変える… が無い。開いたカードに ×）", css, ops: [["script", page("F")], dropLotFromPaths] },
  { key: "G", name: "1 行の並び（罫線なし。▶ 名前｜場所｜状態｜タブ）。行を押すとその下に欄が開く", css, ops: [["script", page("G")], dropLotFromPaths] },
  { key: "H", name: "左右: 左に名前と状態だけの並び（線なし）、右に選んだ元の場所・状態と欄（閉じるは無い）", css, ops: [["script", page("H")], dropLotFromPaths] },
];
