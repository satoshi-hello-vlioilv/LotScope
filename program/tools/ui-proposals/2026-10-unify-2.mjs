// 2026-10「データ元を 1 つの仕組みに」の 2 回目（1 回目の 1 位 A3 74.0 点・B1 75.6 点。合格点 80 点に届かず）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-unify-2.mjs --from master --states master-sources,master-access
// 1 回目の採点（2026-10-unify-sources.json・-tabs.json）で見えた弱い所と、この回の手当て:
//   A: 1280 で名前の札（古いと知らせるまで（時間。0 は知らせない））が 2 段に折れ欄の高さが揃わない → 名前を「古さの警告（時間）」に縮め、
//      説明は欄の下の手がかりへ（本物の data_sources.CONN_SPECS も直した）
//      設備・ロット番号の列が別の段で 1 手増え中身が見えない（A3）／設備を 5 台で切り、直すべき設備が隠れる（A4）
//      → 直すべき設備（古い・見つからない）を先に、行を 30px に詰めて 12 台を全部
//      「そのほかの接続」に直す入口が無い → データ元の行と同じ形の行（変える…）で並べる
//      グループを消すが 2 つ並ぶ（再現の重ね付け）→ 本物の画面に入れた 1 つだけ
//   B: 人ごとの例外が「例外 1 人」の札だけ → だれが・出す／出さないを札に書く
//      見出しのタブを見ている間も、人の検索・新規追加が残る → 見出しのタブの道具の段に入れ替える
//      1280 で表が窓の中で送られ、下に空き（二重の送り）→ 頁の送りは 1 つ（表の見出しを上に留める）
// 持ち越し: A3 → C1・A4 → C2・B1 → D1。新しい案: C3・C4・C5・D2・D3・D4・D5。
import { COMMON, CSS_COMMON, CSS_B } from "./2026-10-unify.mjs";

const NOTWEAK = `function listTweaks() {}`;   // グループを消すは本物の画面が出す（1 回目の再現の重ね付けをやめる）
const A_BASE = (body) => [["script", COMMON + NOTWEAK + `
watch("#masterSettings .sr-page", async (h) => {
  const d = await data();
  const work = d.src.items.find((x) => x.key === "work"), conn = work.conn;
  const f = (id) => conn.find((x) => x.id === id);
  const bad = d.wl.items.filter((e) => e.state === "missing" || e.stale);
  const eqRows = [...bad, ...d.wl.items.filter((e) => !bad.includes(e))];
  const eq = (n) => eqTable({ items: eqRows }, n);
  const eqHead = (d) => '<h4>設備 ' + d.wl.items.length + ' 台 <small>直すことのある設備を先に・表示するものを選ぶ</small><span style="flex:1"></span><button class="pz-btn">↻ フォルダを探し直す</button></h4>';
  const othersRows = () => '<tr class="sr-gh"><td colspan="7"><b>そのほかの接続</b><small>データ元ではない所（ロット問い合わせ・更新の置き場・ブラウザ）</small></td></tr>'
    + others(d).map((o) => '<tr class="sr-row"><td></td><td><b>' + esc(o.label.replace(/（.*$/, "")) + '</b></td><td colspan="4" class="ux-mono" title="' + esc(o.value) + '">' + esc(o.value) + '</td><td class="sr-ac"><button class="pz-btn">変える…</button></td></tr>').join("");
  nav("データ元");
  ${body}
});`]];
const CSS_C = CSS_COMMON + `
.ux-open td{padding:10px 14px !important;height:auto !important;white-space:normal !important;background:var(--input-soft,#eef4fb)}
.ux-eq td{height:30px !important;padding:2px 8px !important}
.ux-eq .sr-sw{transform:scale(.9);transform-origin:left center}
.ux-hint2{font-size:11.5px;color:var(--muted);margin-top:-2px}
.ux-sum2{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--muted)}
.ux-sum2 b{color:var(--ink)}
`;

const C = [
  {
    key: "C1", name: "（A3 を直した）行の中で開き、段のタブで分ける。接続の段にロット番号の列も・設備の段は直すことを先に",
    css: CSS_C + `.ux-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line)}
      .ux-tabs button{border:0;background:none;padding:7px 14px;font:inherit;font-size:13px;color:var(--muted);border-bottom:3px solid transparent}
      .ux-tabs button.on{color:var(--ink);font-weight:700;border-bottom-color:var(--h-input)}
      .ux-tabs em{font-style:normal;font-size:11px;background:#fde2e2;color:#9b1c1c;border-radius:999px;padding:0 6px;margin-left:4px}`,
    ops: A_BASE(`const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box">'
        + '<div class="ux-tabs"><button>名前とタブ</button><button class="on">接続</button><button>設備 ' + d.wl.items.length + (bad.length ? '<em>' + bad.length + '</em>' : '') + '</button><button>結合</button></div>'
        + '<div class="ux-grid">' + field(f("folder"), true) + field(f("pattern")) + field(f("refresh")) + field(f("stale")) + field(f("lot")) + '</div>'
        + '<p class="ux-hint2">古さの警告: 最後の更新からこの時間を過ぎたら知らせる（0 は知らせない）。ロット番号の列: 押すと計算へ取り込む列</p>'
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div>'
        + '</div></td></tr>');
      h.querySelector(".sr-table tbody").insertAdjacentHTML("beforeend", othersRows());`),
  },
  {
    key: "C2", name: "（A4 を直した）2 列の欄（左: 接続・右: 名前・タブ・ロット番号）＋下に設備の全部（詰めた行・直すことを先に）",
    css: CSS_C + `.ux-two{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:14px}
      .ux-col{display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:10px 12px}
      .ux-col h4{margin:0;font-size:12.5px;color:var(--muted);letter-spacing:.04em}
      .ux-eqwrap{columns:2;column-gap:18px}.ux-eqwrap .ux-eq{break-inside:avoid}`,
    ops: A_BASE(`const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box">'
        + '<div class="ux-two"><div class="ux-col"><h4>接続（共有の場所と写し方）</h4><div class="ux-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + field(f("folder"), true) + field(f("pattern"), true) + field(f("refresh")) + field(f("stale")) + '</div></div>'
        + '<div class="ux-col"><h4>名前と見え方</h4><label class="ux-f"><span>表示名（見出しのタブの名前）</span><input class="ps-input" value="実績"></label>' + field(f("lot")) + '<p class="ux-hint2">見出しのタブ: いつも出す（実績は決まったタブ）</p></div></div>'
        + '<section class="ux-sec">' + eqHead(d) + eq() + '</section>'
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div>'
        + '</div></td></tr>');
      h.querySelector(".sr-table tbody").insertAdjacentHTML("beforeend", othersRows());`),
  },
  {
    key: "C3", name: "（新）畳める段に今の値の要約を出し、押した段だけ開く（接続を開いた所。設備・ロット番号・結合は 1 行の要約）",
    css: CSS_C + `.ux-acc{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
      .ux-acc>div{border-top:1px solid var(--line-soft)}.ux-acc>div:first-child{border-top:0}
      .ux-ah{display:flex;align-items:center;gap:12px;padding:8px 12px;font-size:13px;cursor:pointer}
      .ux-ah b{min-width:110px}.ux-ah span{color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ux-ab{padding:4px 12px 12px}`,
    ops: A_BASE(`const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      const sec = (t, sum, open, inner) => '<div><div class="ux-ah">' + (open ? "▾" : "▸") + '<b>' + t + '</b><span>' + sum + '</span>' + (open ? "" : '<button class="pz-btn">直す</button>') + '</div>' + (open ? '<div class="ux-ab">' + inner + '</div>' : '') + '</div>';
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box"><div class="ux-acc">'
        + sec("名前とタブ", "実績・いつも出す", false)
        + sec("接続", esc(fileOf(f("folder").effective)) + " ・ " + esc(f("pattern").effective) + " ・ " + f("refresh").effective + " 秒ごと・" + f("stale").effective + " 時間で警告", true,
          '<div class="ux-grid">' + field(f("folder"), true) + field(f("pattern")) + field(f("refresh")) + field(f("stale")) + '</div>')
        + sec("設備", '<span class="ux-sum2"><b>' + d.wl.items.length + ' 台</b>' + (bad.map((e) => '<span class="' + (e.state === "missing" ? "ux-bad" : "ux-warn") + '">' + esc(e.name) + ' ' + (e.state === "missing" ? "見つからない" : "古い") + '</span>').join("")) + '</span>', false)
        + sec("ロット番号の列", "自動（見つけた列: ロット番号）", false)
        + sec("結合", "なし", false)
        + '</div><div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div>'
        + '</div></td></tr>');
      h.querySelector(".sr-table tbody").insertAdjacentHTML("beforeend", othersRows());`),
  },
  {
    key: "C4", name: "（新）行の中で開き、左に縦の小さな目次（名前とタブ・接続・設備・ロット番号・結合）、右に選んだ段",
    css: CSS_C + `.ux-side2{display:grid;grid-template-columns:170px minmax(0,1fr);gap:16px}
      .ux-toc{display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--line);padding-right:10px}
      .ux-toc a{display:flex;justify-content:space-between;padding:6px 10px;border-radius:6px;font-size:13px;color:var(--ink);text-decoration:none}
      .ux-toc a.on{background:var(--input-soft,#e6effa);font-weight:700;box-shadow:inset 3px 0 0 var(--h-input)}
      .ux-toc em{font-style:normal;font-size:11px;background:#fde2e2;color:#9b1c1c;border-radius:999px;padding:0 6px}`,
    ops: A_BASE(`const tr = h.querySelector('tr.sr-row[data-key="work"]'); if (!tr) return;
      tr.insertAdjacentHTML("afterend", '<tr class="ux-open"><td colspan="7"><div class="ux-box"><div class="ux-side2">'
        + '<nav class="ux-toc"><a>名前とタブ</a><a class="on">接続</a><a>設備 ' + d.wl.items.length + (bad.length ? '<em>' + bad.length + '</em>' : '') + '</a><a>ロット番号の列</a><a>結合</a></nav>'
        + '<div class="ux-sec"><h4>接続 <small>共有の場所と写し方</small></h4><div class="ux-grid">' + field(f("folder"), true) + field(f("pattern")) + field(f("refresh")) + field(f("stale")) + '</div>'
        + '<p class="ux-hint2">フォルダを保存すると、設備を探し直して「設備」に並べます。</p>'
        + '<div class="ux-acts"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">閉じる</button></div></div>'
        + '</div></div></td></tr>');
      h.querySelector(".sr-table tbody").insertAdjacentHTML("beforeend", othersRows());`),
  },
  {
    key: "C5", name: "（新）一覧から元の頁へ入る（パンくず「データ元 › 実績」・上に要約の札・全部の段を 1 頁・保存は下に留める）",
    css: CSS_C + `#masterSettings .sr-page>.sr-top,#masterSettings .sr-page>.sr-table{display:none}
      .ux-crumb{font-size:13px;color:var(--muted)}.ux-crumb a{color:var(--h-input)}
      .ux-head{display:flex;align-items:baseline;gap:12px}.ux-head h3{margin:0;font-size:20px}
      .ux-cards{display:flex;gap:8px;flex-wrap:wrap}.ux-cards span{border:1px solid var(--line);border-radius:8px;padding:4px 10px;font-size:12.5px;background:var(--surface)}
      .ux-foot{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:8px 0}`,
    ops: A_BASE(`h.insertAdjacentHTML("beforeend", '<div class="ux-box" style="border:0;background:none;padding:0">'
        + '<div class="ux-crumb"><a>‹ データ元</a> › 実績</div>'
        + '<div class="ux-head"><h3>実績</h3><span class="ux-hint">設備ごとの .sqlite3（フォルダ）・見出しのタブ: いつも出す</span></div>'
        + '<div class="ux-cards"><span>● 12 台</span><span>写した 04:24</span>' + bad.map((e) => '<span class="' + (e.state === "missing" ? "ux-bad" : "ux-warn") + '">' + esc(e.name) + ' ' + (e.state === "missing" ? "見つからない" : "古い") + '</span>').join("") + '</div>'
        + '<section class="ux-sec"><h4>接続</h4><div class="ux-grid">' + field(f("folder"), true) + field(f("pattern")) + field(f("refresh")) + field(f("stale")) + field(f("lot")) + '</div></section>'
        + '<section class="ux-sec">' + eqHead(d) + eq() + '</section>'
        + '<div class="ux-acts ux-foot"><button class="ps-check">確かめる</button><button class="btn-primary">保存</button><span class="sp"></span><button class="btn-ghost">一覧へ戻る</button></div></div>');`),
  },
];

// ---------------------------------------------------------------- B の 2 回目
const B_BASE = (body) => [["script", COMMON + `
const FAKE = [["台帳", ["受入台帳", "出荷台帳", "保留台帳", "検査台帳", "梱包台帳", "倉庫台帳", "再処理台帳", "返品台帳"]], ["工程", ["工程A", "工程B"]], ["マスタ", ["製造条件マスタ", "設備マスタ"]]];
async function tabs() {
  const d = await data(), t = d.ta.tabs.filter((x) => !(x.role === "マスタ"));
  FAKE.forEach(([g, names]) => names.forEach((n, i) => t.push({ key: "f" + g + i, name: n, group: g, kind: "file" })));
  return t;
}
const RULE = { wip: ["設備作業者"], calc: ["設備作業者"], f台帳3: ["一般ユーザー", "設備作業者"], f工程0: ["設備作業者"], sch: ["一般ユーザー"] };
const EXC = { wip: [["line-1", "出す"]], f台帳3: [["user-a", "出す"]], f台帳5: [["line-1", "出さない"]] };
const PEOPLE = [["satoshi-harada", "開発者"], ["maint-b", "メンテナンス者"], ["user-a", "一般ユーザー"], ["line-1", "設備作業者"]];
const ROLES = ["開発者", "メンテナンス者", "一般ユーザー", "設備作業者"];
const groupsOf = (t) => { const out = [["画面", t.filter((x) => x.kind === "screen")], ["グループなし", t.filter((x) => x.kind !== "screen" && !x.group)]];
  [...new Set(t.filter((x) => x.group).map((x) => x.group))].forEach((g) => out.push([g, t.filter((x) => x.group === g)])); return out; };
const hiddenFor = (k, r) => r !== "開発者" && (RULE[k] || []).includes(r);
const ck = (k, r) => '<span class="ux-ck ' + (r === "開発者" ? "lock" : hiddenFor(k, r) ? "off" : "on") + '" title="' + r + ': ' + (hiddenFor(k, r) ? "出さない" : "出す") + '">' + (hiddenFor(k, r) ? "✕" : "✓") + '</span>';
const exChips = (k) => (EXC[k] || []).map(([p, v]) => '<span class="ux-ex ' + (v === "出す" ? "s" : "h") + '">' + (v === "出す" ? "＋" : "−") + esc(p) + '</span>').join("");
// 見出しのタブを見ている間は、人の検索・件数・新規追加を外し、タブの道具（探す・要約・保存）に入れ替える
function toolbar(t, extra) {
  const tb = document.querySelector(".master-toolbar"); if (!tb) return;
  tb.innerHTML = '<div class="ux-seg"><button>人ごと</button><button class="on">見出しのタブ</button></div><input class="ps-input" placeholder="タブの名前で探す" style="width:240px;height:32px">'
    + '<span class="ux-sum">タブ ' + t.length + ' 個・出さない ' + Object.values(RULE).flat().length + ' か所・人ごとの例外 ' + Object.values(EXC).flat().length + '</span>' + (extra || "") + '<div class="spacer" style="flex:1"></div><button class="btn-primary">保存</button>';
  document.querySelector("#masterDetail").style.display = "none";
  const w = document.querySelector(".master-table-wrap"); w.style.gridColumn = "2 / -1";
}
const MX = (t, cols, cell, extraHead = "", extraCell = () => "") => '<table class="ux-mx"><colgroup><col style="width:28%">' + cols.map(() => "<col>").join("") + (extraHead ? '<col style="width:24%">' : "") + '</colgroup><thead><tr><th>タブ</th>'
  + cols.map((r) => '<th>' + r + (r === "開発者" ? "<br><small>いつも全部</small>" : "") + '</th>').join("") + (extraHead ? '<th>' + extraHead + '</th>' : "") + '</tr></thead><tbody>'
  + groupsOf(t).map(([g, xs]) => '<tr class="g"><td colspan="' + (1 + cols.length + (extraHead ? 1 : 0)) + '">▾ ' + esc(g) + ' <small class="ux-sum">' + xs.length + '</small></td></tr>'
    + xs.map((x) => '<tr><td>' + esc(x.name) + '</td>' + cols.map((r) => '<td>' + cell(x.key, r) + '</td>').join("") + (extraHead ? '<td class="exc">' + extraCell(x.key) + '</td>' : "") + '</tr>').join("")).join("") + '</tbody></table>';
watch("#masterDetail", async (h) => {
  if (!document.querySelector('#masterTabs [data-tab="access"].active') || !document.querySelector("#masterBody tr")) return false;
  nav("データ元");
  const t = await tabs();
  ${body}
});`]];
const CSS_D = CSS_B + `
.ux-pane{max-height:none;overflow:visible;padding:0 16px 16px}
.ux-mx thead th{top:0}
.ux-ex{display:inline-flex;align-items:center;gap:2px;border-radius:999px;padding:1px 8px;font-size:12px;margin-right:4px;border:1px solid}
.ux-ex.s{background:#dcf3e4;border-color:#a8dcb9;color:#1d6b3a}.ux-ex.h{background:#fde2e2;border-color:#f3b4b4;color:#9b1c1c}
.ux-mx td.exc{text-align:left}
`;


const D = [
  {
    key: "D1", name: "（B1 を直した）表（行＝タブ／列＝区分）＋人ごとの例外の列に「＋だれ・−だれ」。道具の段はタブ用に入れ替え・送りは 1 つ",
    css: CSS_D,
    ops: B_BASE(`toolbar(t);
      document.querySelector(".master-table-wrap").innerHTML = '<div class="ux-pane">' + MX(t, ROLES, ck, "人ごとの例外（＋出す・−出さない）", exChips) + '</div>';`),
  },
  {
    key: "D2", name: "（新）表（行＝タブ／列＝区分）＋右に「人ごとの例外」の欄（人を選んでその人だけ出す・出さない）",
    css: CSS_D + `.ux-two2{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
      .ux-pp{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:10px 12px;display:flex;flex-direction:column;gap:8px;position:sticky;top:0}
      .ux-pp .row{display:flex;align-items:center;gap:6px;font-size:13px;border-bottom:1px solid var(--line-soft);padding:4px 0}
      .ux-pp .row .sp{flex:1}`,
    ops: B_BASE(`toolbar(t);
      const ppl = PEOPLE.filter(([, r]) => r !== "開発者");
      document.querySelector(".master-table-wrap").innerHTML = '<div class="ux-pane"><div class="ux-two2">' + MX(t, ROLES, ck)
        + '<aside class="ux-pp"><b>人ごとの例外</b><p class="ux-hint">区分の決まりと違う人だけ。行の ＋ で足す</p>'
        + ppl.map(([p, r]) => { const ex = Object.entries(EXC).flatMap(([k, a]) => a.filter(([q]) => q === p).map(([, v]) => [k, v]));
          return '<div class="row"><b>' + esc(p) + '</b><small class="ux-sum">' + r + '</small><span class="sp"></span>' + (ex.length ? ex.map(([k, v]) => '<span class="ux-ex ' + (v === "出す" ? "s" : "h") + '">' + (v === "出す" ? "＋" : "−") + esc((t.find((x) => x.key === k) || {}).name || k) + '</span>').join("") : '<small class="ux-sum">なし</small>') + '</div>'; }).join("")
        + '<button class="pz-btn">＋ 例外を足す…</button></aside></div></div>';`),
  },
  {
    key: "D3", name: "（新）表の列＝区分の右に、登録した人を「効いている結果」で淡く並べ、例外の升だけ濃い札（＋／−）。人の升を押すと例外",
    css: CSS_D + `.ux-mx td.p{background:var(--surface-2,#f6f8fb)}.ux-mx th.p{background:#e9eef5}
      .ux-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#9ab8a3}.ux-dot.off{background:#e3a6a6}`,
    ops: B_BASE(`toolbar(t);
      const ppl = PEOPLE.filter(([, r]) => r !== "開発者");
      const eff = (k, p, r) => { const e = (EXC[k] || []).find(([q]) => q === p); return e ? e[1] === "出す" : !hiddenFor(k, r); };
      const pc = (k, p, r) => { const e = (EXC[k] || []).find(([q]) => q === p); return e ? '<span class="ux-ex ' + (e[1] === "出す" ? "s" : "h") + '">' + (e[1] === "出す" ? "＋出す" : "−出さない") + '</span>' : '<span class="ux-dot' + (eff(k, p, r) ? "" : " off") + '" title="区分どおり"></span>'; };
      document.querySelector(".master-table-wrap").innerHTML = '<div class="ux-pane"><table class="ux-mx"><colgroup><col style="width:22%"></colgroup><thead><tr><th>タブ</th>' + ROLES.map((r) => '<th>' + r + '</th>').join("") + ppl.map(([p, r]) => '<th class="p">' + esc(p) + '<br><small>' + r + '</small></th>').join("") + '</tr></thead><tbody>'
        + groupsOf(t).map(([g, xs]) => '<tr class="g"><td colspan="' + (1 + ROLES.length + ppl.length) + '">▾ ' + esc(g) + '</td></tr>' + xs.map((x) => '<tr><td>' + esc(x.name) + '</td>' + ROLES.map((r) => '<td>' + ck(x.key, r) + '</td>').join("") + ppl.map(([p, r]) => '<td class="p">' + pc(x.key, p, r) + '</td>').join("") + '</tr>').join("")).join("") + '</tbody></table></div>';`),
  },
  {
    key: "D4", name: "（新）上に区分ごとの札（見えるタブの数と見出しの見本）、下に表（行＝タブ／列＝区分・例外の列）",
    css: CSS_D + `.ux-rc{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:6px}
      .ux-rc>div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface);display:flex;flex-direction:column;gap:4px}
      .ux-rc b{font-size:13px}.ux-rc small{color:var(--muted)}.ux-rc .ux-strip{padding:4px;gap:3px}.ux-rc .ux-strip span{font-size:10.5px;padding:1px 5px}`,
    ops: B_BASE(`toolbar(t);
      const cards = ROLES.map((r) => { const vis = t.filter((x) => !hiddenFor(x.key, r)); return '<div><b>' + r + '</b><small>' + (r === "開発者" ? "いつも全部 " + t.length : "見える " + vis.length + "／" + t.length + "・出さない " + (t.length - vis.length)) + '</small></div>'; }).join("");
      document.querySelector(".master-table-wrap").innerHTML = '<div class="ux-pane"><div class="ux-rc">' + cards + '</div>' + MX(t, ROLES, ck, "人ごとの例外", exChips) + '</div>';`),
  },
  {
    key: "D5", name: "（新）区分の列を押すと、その区分の列だけ大きなスイッチ（1 列ずつ集中）。ほかの区分は小さく比べられる・例外の列",
    css: CSS_D + `.ux-mx th.on{background:var(--h-input);color:#fff}.ux-mx td.on{background:#eef4fb}
      .ux-mx td.on .sr-sw{margin:0 auto}`,
    ops: B_BASE(`toolbar(t, '<span class="ux-sum" style="margin-left:8px">いま直す区分: <b>一般ユーザー</b>（見出しの区分を押して替える）</span>');
      const cur = "一般ユーザー";
      const cell = (k, r) => r === cur ? '<button type="button" class="sr-sw' + (hiddenFor(k, r) ? "" : " on") + '"><i></i><span>' + (hiddenFor(k, r) ? "出さない" : "出す") + '</span></button>' : ck(k, r);
      let html = MX(t, ROLES, cell, "人ごとの例外", exChips);
      html = html.replace('<th>一般ユーザー</th>', '<th class="on">一般ユーザー ✎</th>');
      document.querySelector(".master-table-wrap").innerHTML = '<div class="ux-pane">' + html + '</div>';`),
  },
];

export const PROPOSALS = [...C, ...D];
