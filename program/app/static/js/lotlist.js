"use strict";
/* =========================================================================
   ロット一覧（品質データ SQLite の手元の写し）＋ 絞り込み
   - 元データの読み方は WaveLog の品質データと同じ（サーバーが共有を手元へ写し、写しだけを読む）。
   - 絞り込みの仕組みは WaveLog の汎用フィルタ（static/js/list/filters.js）と同じ:
       一覧を検索（全列の字）／プリセット（登録した条件の組み合わせを切り替え）／
       条件（効いている条件の面: 外す・☆で登録・足す・作る・全部外す）／
       列で絞り込む（列と比べ方は覚え、値はその場だけ。打つと 280ms 後に効く）／
       条件を作る（列・比べ方・値 → 適用／登録）／登録した条件とプリセット（組み合わせ名・いつも適用（固定））。
     比べ方の 12 種と SQL は WaveLog と同じで、絞り込みはサーバー（SQL）で行う。
   - ロット番号を押すと、転写計算の「検索」と同じ流れでそのロットを取り込む（onPick）。
   - 並び・まとめ（「表の見せ方」。表ごとに覚える）:
       まとめる列を上の段から順に選ぶ（例: 設備 → ロット番号）。段の列が並べ替えの先頭のキーになり（▲／▼）、
       その下に見出しで決めた並べ替えが続く（サーバーの並べ替えは合わせて最大4つ）。値が同じ行が続くので、画面でまとまりを作る:
         見出し行で区切る … まとまりごとに見出し（件数・共通の値・畳む）。段の深さで字下げする。
         同じ値の繰り返しを省く … まとめた列で、上の行（見出し）と同じ値を見せない（マウスを乗せると薄く出る）。
       ロット番号の段は、サーバーがロットを1か所に集め（lot_list.grouped_rows・group=1）、ページの境目で切らない。
       ロット番号の段だけ「並べ替えの順」（以前の「ロット番号でまとめる」と同じ: そのロットのいちばん上の行の順）を選べる。
   - 作業実績の「作業でまとめる」（lotlist-work.js）: 作業開始が同じ行（分割したロット）を 1 行に畳み（「＋n」で開く）、右に日×直のロット数。
       まとめている間は、段（並び・まとめ）は使わない（作業開始の順で並べる。見出しで決めた並べ替えは作業の中の順）。
   - 機能: 行のダブルクリックでカード … その1行をカードで見る（lotlist-card.js。Ctrl を押すと別のカードで）。
   - データの元（SOURCES）: 異常ロット一覧（品質データ）と作業実績（設備ごとの実績）の 2 つを、同じ部品・同じ画面で出す。
       元ごとに状態（S: 表・条件・ページ・検索…）を持ち、タブを行き来しても元ごとにそのまま残る。
       覚え（条件・並び・表示列・スライサー…）は「範囲」ごと（scope()）。異常ロット一覧の範囲は表の名前のまま（前からの覚えを使い続ける）、
       作業実績は `wl:<設備のキー>:<表>`（表示列は `worklog:<設備のキー>:<表>`）。設備のキーは登録の行で決まり、ファイルの名前が変わっても同じ。
   ========================================================================= */
(function () {
  const { $, $$, esc } = TPA;
  const store = TPA.local;
  const KEY = {
    active: "tpa.lotlist.active.v1",      // 適用中の条件（表ごと。固定の条件は覚えない＝毎回導き直す）
    adhoc: "tpa.lotlist.adhoc.v1",        // 列で絞り込むの「列と比べ方」（表ごと。値は覚えない）
    adhocOpen: "tpa.lotlist.adhocOpen.v1",
    presets: "tpa.lotlist.presets.v1",    // 登録した条件（1条件ずつ。group が同じものが組み合わせ＝プリセット）
    presetSel: "tpa.lotlist.presetSel.v1",
    views: "tpa.lotlist.views.v1",        // 保存した見方（条件・並べ替え・まとめ・スライサー・検索を名前を付けて。table が範囲）
    sorts: "tpa.lotlist.sorts.v1",
    pageSize: "tpa.lotlist.pageSize.v1",
    table: "tpa.lotlist.table.v1",
    features: "tpa.lotlist.features.v1",  // 機能の使う／使わない（この PC）
    collapsed: "tpa.lotlist.collapsed.v1", // 畳んだまとまり（表ごと・開いているあいだだけ）
    arrange: "tpa.lotlist.arrange.v1",    // 並び・まとめ（表ごと）{levels:[{column, dir, lot}], heads, suppress}
    workEquip: "tpa.worklog.equip.v1",    // 作業実績: 最後に見た設備（キー）
    workTable: "tpa.worklog.table.v1",    // 作業実績: 設備ごとに最後に見た表 {キー: 表}
  };
  /* 機能の既定: カードは使う（ダブルクリックは今まで何もしなかった操作）。
     以前の「ロット番号でまとめる」（features.group）は、並び・まとめを一度も決めていない表で「ロット番号の段1つ」として引き継ぐ */
  const FEATURES = { card: true, lens: true };
  const feat = Object.assign({}, FEATURES, store.get(KEY.features, {}));
  const legacyGroup = !!feat.group;
  function setFeature(k, v) { feat[k] = !!v; store.set(KEY.features, feat); }
  const OPS = [
    ["contains", "含む"], ["not_contains", "含まない"], ["eq", "＝ 一致"], ["neq", "≠ 不一致"],
    ["starts", "前方一致"], ["ends", "後方一致"], ["gt", "> より大きい"], ["gte", ">= 以上"], ["lt", "< より小さい"], ["lte", "<= 以下"], ["empty", "空欄"], ["not_empty", "空欄以外"],
    // 日付と読める列だけ: 今日から数えて N 日（週・か月・年）以内（サーバーが ToDate(列) >= 今日−N で絞る）
    ["within_days", "日以内（今日から）"], ["within_weeks", "週間以内（今日から）"], ["within_months", "か月以内（今日から）"], ["within_years", "年以内（今日から）"],
  ];
  const REL_UNIT = { within_days: "日", within_weeks: "週間", within_months: "か月", within_years: "年" };
  const REL_PICKS = { within_days: [0, 1, 3, 7, 14, 30], within_weeks: [1, 2, 4], within_months: [1, 3, 6, 12], within_years: [1, 2, 3] };
  const isRel = (op) => op in REL_UNIT;
  const PAGE_SIZES = [200, 500, 1000, 2000];
  const ADHOC_DEBOUNCE_MS = 280;
  const SEARCH_DEBOUNCE_MS = 280;
  const SOURCE_POLL_MS = 20000;
  const COPY_RETRY_MS = 4000;
  let fmtCtx = null;              // 共有の書式の札を描いた範囲（替わったら描き直す）     // 写しがまだ無いとき、引き直すまで（写しの係は書き手が作業中なら 5 秒空けて写し直す）
  const MAX_SORTS = 4;
  const PRESET_NONE = "";

  const opLabel = (op) => (OPS.find((x) => x[0] === op) || [op, op])[1];
  const opShort = (op) => opLabel(op).split(" ")[0];
  const noValueOp = (op) => op === "empty" || op === "not_empty";
  const filterKey = (f) => [f.column, f.op, f.value].join("\u001f");
  const relText = (f) => `${f.value}${REL_UNIT[f.op]}以内` + (String(f.value) === "0" && f.op === "within_days" ? "（今日）" : "");
  const condLabel = (f) => isRel(f.op) ? `${f.column} ${relText(f)}`
    : noValueOp(f.op) ? `${f.column} ${opShort(f.op)}` : `${f.column} ${opShort(f.op)} ${f.value}`;
  const isDateCol = (c) => S.dateColumns.includes(c);
  /* 比べ方の選択欄: 日付の列でなければ「以内」を選べなくする（押しても何も当たらない物を出さない）。
     選んでいた比べ方が使えなくなったら「含む」へ戻す。 */
  function paintOpOptions(sel, column) {
    const date = isDateCol(column);
    [...sel.options].forEach((o) => {
      if (!isRel(o.value)) return;
      o.disabled = !date;
      o.title = date ? "今日から数えて、この期間に入る日付の行" : "日付と読める列だけで使えます";
    });
    if (isRel(sel.value) && !date) sel.value = "contains";
    return sel.value;
  }
  const colOption = (c) => `<option value="${esc(c)}">${esc(c)}${isDateCol(c) ? "（日付）" : ""}</option>`;
  const presetName = (f) => condLabel(f).slice(0, 60);

  /* ================= データの元（異常ロット一覧・作業実績） =================
     api: 一覧の問い合わせの頭（/slicer・/source・/refresh も同じ頭）。params: どの設備か（作業実績だけ）。
     scope(表): 覚えの範囲。target(表): 表示列の対象。owns(範囲): その元の範囲か（書き出しの「すべての表」を元ごとにする）。 */
  const equipName = (k) => ((S && S.equips || []).find((e) => e.key === k) || {}).name || "";
  const SOURCES = {
    lot: {
      id: "lot", api: "/api/lotlist", title: "異常ロット一覧", noun: "品質データ", fileStem: "異常ロット一覧",
      params: () => ({}), scope: (t) => t, target: (t) => "lotlist:" + (t || ""), owns: (k) => !k.startsWith("wl:"),
      colTable: (t) => t, place: (t) => t,
      loadTable: () => store.get(KEY.table, ""), saveTable: (t) => store.set(KEY.table, t),
      settingsKey: "lot_list.", settingsTab: "paths", settingsLabel: "参照先を開く",
      settingsTip: "元ファイルの場所・名前を「マスタ管理」の「参照先」で直します",
      remoteHint: "（設定 lot_list.source）", reading: "品質データを読んでいます…",
      firstNote: "初めて開いたときは、共有の元ファイルを手元へ写し終えるまで待ちます（大きいと数十秒）。",
      staleWhat: "最近の異常ロットは一覧に出ません。",
    },
    work: {
      id: "work", api: "/api/worklog", title: "作業実績", noun: "作業実績", fileStem: "作業実績",
      params: () => (S.equip ? { equip: S.equip } : {}),
      scope: (t, e = S.equip) => `wl:${e}:${t || ""}`, target: (t, e = S.equip) => `worklog:${e}:${t || ""}`, owns: (k) => k.startsWith(`wl:${S.equip}:`),
      colTable: (t) => `wl:${t || ""}`, place: (t) => `${equipName(S.equip)}・${t || ""}`,
      loadTable: () => (store.get(KEY.workTable, {})[S.equip] || ""),
      saveTable: (t) => { const m = store.get(KEY.workTable, {}); if (t) m[S.equip] = t; else delete m[S.equip]; store.set(KEY.workTable, m); },
      settingsKey: "work_log.", settingsTab: "worklog", settingsLabel: "作業実績の設備を開く",
      settingsTip: "作業実績のフォルダ・設備（どのファイルを・表示するか）を「マスタ管理」の「作業実績」で確かめます",
      remoteHint: "（作業実績のフォルダ）", reading: "作業実績を読んでいます…",
      firstNote: "初めて開いた設備は、共有の実績ファイルを手元へ写し終えるまで待ちます（大きいと数十秒）。",
      staleWhat: "最近の作業実績は一覧に出ません。",
    },
  };
  function newState(src) {
    return {
      src: SOURCES[src], table: "", tables: [], columns: [], rows: [], count: 0, lotColumn: "",
      page: 1, pageSize: store.get(KEY.pageSize, 500), search: "", sorts: [],
      genericFilters: [], presets: store.get(KEY.presets, []), source: null, loadedAt: null, dateColumns: [],
      loading: false, error: "", seq: 0, currentLot: "", dateHints: [], today: "",
      groups: null, groupCount: 0, range: [0, 0], cardIdx: -1, cardSet: new Set(),
      ctx: null, adhoc: { column: "", op: "contains", value: "" }, adhocScope: null, activated: false,
      equip: "", equips: null, equipError: "", equipEdit: false, work: null, workOpen: new Set(),
    };
  }
  const STATES = { lot: newState("lot"), work: newState("work") };
  STATES.work.presets = STATES.lot.presets;     // 登録した条件は 1 つの並び（savePresets）
  STATES.lot.table = SOURCES.lot.loadTable();
  STATES.work.equip = store.get(KEY.workEquip, "");
  let S = STATES.lot;
  /** いまの覚えの範囲（表ごと・作業実績は設備ごと） */
  const scope = () => S.src.scope(S.table);
  /* まとめるときのロットの見分け方（サーバーの lot_key と同じ: 大小・前後の空白は同じロット） */
  const lotKey = (r) => (S.lotColumn && r ? String(r[S.lotColumn] ?? "").trim().toUpperCase() : "");
  /* 段の値の見分け方（サーバーの並べ替えの鍵 SortKey と同じ: app/services/sqlite_ro.sort_key）。
     空欄（null・空白だけ）は ""、数と数に読める字（" 54"・"1e-05"）は数、ほかは前後の空白を除いた字。
     並べ替えと同じ鍵で見分けるので、同じ値と見た行は必ず隣り合い、下の段の並びが途中で振り出しに戻らない */
  const NUM_CHARS = /^[0-9.eE+-]+$/;
  function sortKey(v) {
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    const s = String(v).trim();
    if (s && /[0-9]/.test(s) && NUM_CHARS.test(s)) { const n = Number(s); if (!Number.isNaN(n)) return String(n); }
    return s;
  }

  /* ================= 並び・まとめ（表ごと） ================= */
  const LOT_ORDER = "first";      // ロット番号の段だけ: 並べ替えの順（そのロットのいちばん上の行の順）で集める
  function arrange() {
    const a = store.get(KEY.arrange, {})[scope()];
    if (a) return { levels: (a.levels || []).filter((l) => l && l.column), heads: a.heads !== false, suppress: !!a.suppress };
    if (legacyGroup) return { levels: S.lotColumn ? [{ column: S.lotColumn, dir: LOT_ORDER, lot: true }] : [], heads: true, suppress: false, legacy: true };
    return { levels: [], heads: true, suppress: false };
  }
  function saveArrange(patch) {
    const all = store.get(KEY.arrange, {}), cur = arrange();
    delete cur.legacy;
    all[scope()] = Object.assign(cur, patch);
    store.set(KEY.arrange, all);
  }
  /* 効いている段（この表にある列だけ・並べ替えのキーの上限まで） */
  /* 作業でまとめている（作業実績だけ。lotlist-work.js）。その間は段を使わない（並びは作業開始の順・サーバーが作業を 1 か所に集める） */
  const workOn = () => S.src.id === "work" && window.LotListWork.on();
  const levels = () => (workOn() ? [] : arrange().levels.filter((l) => !S.columns.length || S.columns.includes(l.column)).slice(0, MAX_SORTS));
  const grouped = () => levels().length > 0;
  /* 「並べ替えの順」で集められるのは、いちばん上の段のロット番号だけ（サーバーはロットを表全体で1か所に集めるので、
     上に別の段があると、その段の並びを崩す）。深い段で選ばれていたら ▲ として扱う */
  const isLotLevel = (l) => !!l && (l.lot || (!!S.lotColumn && l.column === S.lotColumn));
  const dirOf = (l, d) => (l.dir === LOT_ORDER && !(d === 0 && isLotLevel(l)) ? "asc" : l.dir);
  const sortingLevels = () => levels().map((l, d) => ({ ...l, dir: dirOf(l, d) })).filter((l) => l.dir !== LOT_ORDER);
  /* サーバーへ渡す並べ替え: 段の列（上から）→ 見出しで決めた並べ替え（段の列は除く）。合わせて最大4つ */
  function effectiveSorts() {
    const set = new Set(levels().map((l) => l.column));
    return sortingLevels().map(({ column, dir }) => { const key = levelKeyKind(column); return key ? { column, dir, key } : { column, dir }; })
      .concat(S.sorts.filter((s) => !set.has(s.column))).slice(0, MAX_SORTS);
  }
  /* 段は「見えている値」でまとめる（Excel のピボットと同じ）。列の書式が値を丸めて見せるときは、サーバーにも同じ丸め方で並べさせる
     （鍵の形: 日付だけ date・年月 month・年 year・小数 N 桁 round:N。lot_list.order_key）。時刻を見せる書式・書式なしは元の値のまま */
  function levelKeyKind(c) {
    const f = (window.LotListColumns.get(layoutTarget()).formats || {})[c];
    if (!f || !f.kind) return "";
    if (f.kind === "number") return f.decimals === "" || f.decimals == null ? "" : `round:${Math.max(0, Math.min(10, +f.decimals || 0))}`;
    if (f.kind !== "datetime") return "";
    const tokens = String(f.pattern || "yyyy/MM/dd").replace(/'[^']*'/g, "");
    if (/[Hhms]|tt/.test(tokens)) return "";
    return /d/.test(tokens) ? "date" : /M/.test(tokens) ? "month" : /y/.test(tokens) ? "year" : "";
  }
  /* 段の値の見分け: 見えている字（書式・読み替えの後）。ロット番号は大小・前後の空白を同じに。空欄は1つ */
  function levelKey(r, c) {
    if (c === S.lotColumn) return sortKey(lotKey(r));
    return String(window.LotListColumns.cell(layoutTarget(), c, r).text ?? "").trim();
  }
  /* 受け取ったページの行を、段の見える値が同じ行どうし隣り合うように並べ直す（それぞれ最初に出た順・中の順は保つ）。
     サーバーは見せ方に合わせて並べるので、ふつうは並びは変わらない。読み替え（ルール）で字を変えている列など、
     サーバーが同じ鍵で並べられない列でも、ページの中では必ず1つのまとまりにする */
  function clusterRows(rows) {
    const lv = levels().map((l) => l.column);
    if (!lv.length || rows.length < 3) return rows;
    const walk = (list, d) => {
      if (d >= lv.length || list.length < 3) return list;
      const groups = new Map();
      list.forEach((r, i) => {
        const v = lv[d] === S.lotColumn && !sortKey(lotKey(r)) ? `\u0000#${i}` : levelKey(r, lv[d]);   // ロット番号が空の行はまとめない
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(r);
      });
      return [...groups.values()].flatMap((g) => walk(g, d + 1));
    };
    return walk(rows, 0);
  }
  /* いちばん上の段がロット番号なら、サーバーがロットを1か所に集め、ページの境目で切らない。
     深い段のロット番号は、上の段の並べ替えのあとに並べ替えるだけで続く（同じ上の段の中で集まる） */
  const serverGroup = () => { if (workOn()) return false; const a = arrange(); return !!a.legacy || isLotLevel(a.levels[0]); };
  function setLevels(list) { saveArrange({ levels: list.slice(0, MAX_SORTS) }); S.page = 1; }
  const levelsApi = () => ({
    can: (c) => S.columns.includes(c),
    has: (c) => levels().some((l) => l.column === c),
    count: () => levels().length,
    add: (c) => { if (levels().length >= MAX_SORTS) { flash(`まとめる段は${MAX_SORTS}つまでです`); return; } setLevels(arrange().levels.concat([{ column: c, dir: "asc", lot: c === S.lotColumn }])); flash(`「${window.LotListColumns.label(layoutTarget(), c)}」でまとめました（表の見せ方で段の順を変えられます）`); load(); },
    remove: (c) => { setLevels(arrange().levels.filter((l) => l.column !== c)); load(); },
  });
  /* ---- 並び・まとめの書き出し・読み込み（表示列と同じ形 {kind, version, savedAt, items:[{target, body}]}） ----
     body = {levels:[{column, dir, lot}], heads, suppress, sorts:[{column, dir}]}（sorts は「その中の並び」＝見出しで決めた並べ替え） */
  const ARRANGE_KIND = "tpa-lotlist-arrange";
  const DIRS = ["asc", "desc", LOT_ORDER];
  function cleanArrange(b) {
    const col = (x) => (x && typeof x.column === "string" && x.column ? x.column : "");
    const levels = (Array.isArray(b && b.levels) ? b.levels : []).filter(col).slice(0, MAX_SORTS)
      .map((l) => ({ column: l.column, dir: DIRS.includes(l.dir) ? l.dir : "asc", lot: !!l.lot }));
    const sorts = (Array.isArray(b && b.sorts) ? b.sorts : []).filter(col).slice(0, MAX_SORTS)
      .map((x) => ({ column: x.column, dir: x.dir === "desc" ? "desc" : "asc" }));
    return { levels, heads: !b || b.heads !== false, suppress: !!(b && b.suppress), sorts };
  }
  function arrangeOf(table) {
    if (table === scope()) { const { levels: lv, heads, suppress } = arrange(); return { levels: lv, heads, suppress, sorts: S.sorts }; }
    return cleanArrange({ ...(store.get(KEY.arrange, {})[table] || {}), sorts: store.get(KEY.sorts, {})[table] || [] });
  }
  function exportArrange() {
    const here = scope(), others = Object.keys(store.get(KEY.arrange, {})).filter((t) => t !== here && S.src.owns(t));
    const all = others.length > 0 && confirm("すべての表の並び・まとめを書き出しますか？\n［OK］すべての表　［キャンセル］この表だけ");
    const tables = all ? [here, ...others] : [here];
    TPA.saveJson(ARRANGE_KIND, tables.map((t) => ({ target: t, body: arrangeOf(t) })), `${S.src.fileStem}_並び・まとめ_${all ? "すべて" : S.src.place(S.table)}.json`);
  }
  async function importArrange() {
    let items;
    try { items = await TPA.pickJson(ARRANGE_KIND, "並び・まとめ"); } catch (e) { flash("読み込めませんでした: " + e.message); return; }
    if (!items) return;
    const here = scope(), mine = items.find((x) => x.target === here) || (items.length === 1 ? items[0] : null);
    // ほかの表の分は、その表を開いたときに効くよう覚えるだけ
    const arr = store.get(KEY.arrange, {}), srt = store.get(KEY.sorts, {});
    items.filter((x) => x !== mine && typeof x.target === "string" && x.target && x.target !== here).forEach((x) => {
      const { sorts, ...a } = cleanArrange(x.body); arr[x.target] = a;
      if (sorts.length) srt[x.target] = sorts; else delete srt[x.target];
    });
    store.set(KEY.arrange, arr); store.set(KEY.sorts, srt);
    if (!mine) { flash(`読み込みました（${items.length}件。この表「${S.src.place(S.table)}」の分は入っていません）`); return; }
    // この表の分: この表に無い列は飛ばして数える
    const b = cleanArrange(mine.body), have = (x) => S.columns.includes(x.column);
    const skipped = b.levels.filter((l) => !have(l)).length + b.sorts.filter((x) => !have(x)).length;
    saveArrange({ levels: b.levels.filter(have), heads: b.heads, suppress: b.suppress });
    S.sorts = b.sorts.filter(have); S.page = 1; saveActive();
    if (!$("#llViewMenu").hidden) renderViewMenu();
    flash(`並び・まとめを読み込みました` + (skipped ? `（この表に無い ${skipped}列ぶんは飛ばしました）` : ""));
    load();
  }
  const collapsed = () => new Set((TPA.session.get(KEY.collapsed, {})[scope()]) || []);
  function setCollapsed(set) { const all = TPA.session.get(KEY.collapsed, {}); all[scope()] = [...set]; TPA.session.set(KEY.collapsed, all); }
  let onPick = () => {};
  let onLens = null;            // 虫眼鏡: LotDsp でそのロットを開くだけ（app.js の openLotDsp(ロット番号, 鋳造番号, タブ)。→ 知らせる文）
  const LENS_W = 22;            // 虫眼鏡のぶん、ロット番号の列を広げる（幅を決めていない列だけ）
  const CAST_COLUMNS = ["鋳造番号", "CYNO"];   // 鋳造番号の列の名前（WaveLog の aliases.castingNo と同じ）。LotDsp の linkkey に使う
  // 虫眼鏡で開く LotDsp のタブは進度情報（WaveLog の既定と同じ）。選ぶ所は置かない（7 案を比べて決めた: ui-proposals/2026-10-lotdsp-tab）
  const lotDspTab = () => window.LotDspUrl.DEFAULT_TAB;
  const castOf = (row) => { const c = CAST_COLUMNS.find((x) => S.columns.includes(x)); return c && row ? String(row[c] ?? "") : ""; };
  const LENS_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.3"/><path d="M10.1 10.1 14 14"/></svg>';
  const lensOn = () => feat.lens && !!onLens;
  let root = null;

  /* ================= 読み込み ================= */
  /** 一覧の問い合わせ文字。over で頁・件数だけを替えられる（Excel に出力が全件を頁ごとに引く） */
  /** 絞り込みの問い合わせ（元・表・検索・条件・列で絞り込む・スライサー）。一覧とピボット集計（lotlist-pivot.js）が同じ物を使う */
  function filterParams() {
    const q = new URLSearchParams(S.src.params());
    if (S.table) q.set("table", S.table);
    if (S.search) q.set("search", S.search);
    const list = baseFilters().concat(window.LotListSlicer.filters());
    if (list.length) q.set("filters", JSON.stringify(list));
    return q;
  }
  function queryString(over = {}) {
    const q = filterParams();
    q.set("page", over.page ?? S.page); q.set("page_size", over.pageSize ?? S.pageSize);
    const sorts = effectiveSorts();
    if (sorts.length) q.set("sorts", JSON.stringify(sorts));
    if (serverGroup()) q.set("group", "1");
    const marks = window.LotListMarks.param();
    if (marks) q.set("marks", marks);
    if (S.src.id === "work") Object.entries(window.LotListWork.params()).forEach(([k, v]) => q.set(k, v));
    return q.toString();
  }
  async function load() {
    const me = S, seq = ++S.seq;
    if (S.src.id === "work" && !S.equip) { S.loading = false; renderAll(); return; }   // 設備を選ぶまでは読まない（設備の札が案内する）
    S.loading = true; paintBusy();
    const wait = S.src.id === "work" ? waitFirstCopy(me) : null;
    try {
      const r = await fetch(S.src.api + "?" + queryString(), { cache: "no-store" });
      const d = await r.json();
      if (me !== S || seq !== S.seq) return;  // 追い越された古い答え・ほかの元へ移った後の答えは捨てる
      S.source = d.source || S.source;
      if (!r.ok) throw Object.assign(new Error(d.error || `${S.src.title}を読めませんでした`), { kind: d.kind });
      S.table = d.table; S.tables = d.tables || []; S.columns = d.columns || []; S.rows = d.rows || [];
      S.lotColumn = d.lotColumn || ""; S.work = d.work || null;
      window.LotListMarks.take(S.rows, d.marks, d.markCounts);   // 色付けの印は、並べ替える前の行の並びで行そのものに結ぶ
      if (!S.work) S.rows = clusterRows(S.rows);       // 作業でまとめた答えは、行と作業の印（work.rows）の並びを崩さない
      S.count = d.count || 0; S.lotColumn = d.lotColumn || ""; S.error = ""; S.dateColumns = d.dateColumns || []; S.dateHints = d.dateHints || []; S.today = d.today || "";
      // 並べ替えはサーバーが確かめた形（実在する列だけ）。まとめているときは段の列を除いた、見出しで決めた分だけを持つ
      if (grouped()) { const have = new Set((d.columns || [])); S.sorts = S.sorts.filter((x) => have.has(x.column)); }
      else S.sorts = d.sorts || S.sorts;
      S.groups = d.groups || null; S.groupCount = d.groupCount || 0; S.range = d.range || [0, 0];
      S.loadedAt = (S.source && S.source.copiedAt) || null;
      S.src.saveTable(S.table);
      S.shownEquip = S.equip;
      if (fmtCtx !== scope()) { fmtCtx = scope(); window.LotListFormats?.refresh(); }   // 共有の書式の札（この所に当てた書式）を描き直す
      // 表が初めて決まった（サーバーが既定の表を選んだ）ら、その表の覚えを戻して引き直す
      if (S.ctx !== scope() && syncContext() && (S.genericFilters.length || S.sorts.length || adhocActive() || grouped() || window.LotListSlicer.filters().length)) {
        S.loading = false; wait?.done(); return load();
      }
    } catch (e) {
      if (me !== S || seq !== S.seq) return;
      S.error = e.message; S.rows = []; S.count = 0; S.groups = null; S.range = [0, 0]; S.work = null;
      // 写しがまだ無い（共有は直接読まない）: 写し終えるまで、少し空けて引き直す
      if (e.kind === "copying") { clearTimeout(me.copyRetry); me.copyRetry = setTimeout(() => { if (me === S && seq === S.seq) load(); }, COPY_RETRY_MS); }
    } finally { wait?.done(); }
    S.loading = false;
    renderAll();
    window.LotListSlicer.refresh();   // 件数を今の絞り込みで数え直す
    window.LotListPivot.refresh();    // 集計表・グラフを見ていれば、今の絞り込みで数え直す
  }

  /* ================= 範囲（表・作業実績は設備と表）ごとの覚え ================= */
  function saveActive() {
    const k = S.ctx;
    if (k == null) return;
    const all = store.get(KEY.active, {});
    const keep = S.genericFilters.filter((f) => !f.locked).map((f) => ({ column: f.column, op: f.op, value: f.value }));
    if (keep.length) all[k] = keep; else delete all[k];
    store.set(KEY.active, all);
    const srt = store.get(KEY.sorts, {});
    if (S.sorts.length) srt[k] = S.sorts; else delete srt[k];
    store.set(KEY.sorts, srt);
  }
  /* 表が決まった（変わった）ら、その表の覚えを戻して「いつも適用（固定）」を当て直す。戻り値: 条件が変わったか */
  function syncContext(force) {
    if (!S.table) return false;
    const k = scope();
    if (k === S.ctx && !force) return false;
    if (S.ctx != null && S.ctx !== k) saveActive();
    S.ctx = k;
    window.LotListPivot.sync();         // 集計の組み方・一覧｜集計は範囲ごと
    S.genericFilters = (store.get(KEY.active, {})[k] || []).map((f) => ({ ...f }));
    S.sorts = (store.get(KEY.sorts, {})[k] || []).slice(0, MAX_SORTS);
    applyAlwaysOn();
    syncAdhocContext();
    S.page = 1;
    return true;
  }
  function tablePresets() { const k = scope(); return S.presets.filter((p) => p.table === k); }
  /* 登録した条件は、元（異常ロット一覧・作業実績）をまたいで 1 つの覚え（どの範囲の条件かは table で見分ける）。
     両方の元が同じ並びを持つ（別々に持つと、片方で登録した条件を、もう片方の保存が消してしまう） */
  function savePresets(list = S.presets) { STATES.lot.presets = STATES.work.presets = list; store.set(KEY.presets, list); }
  /* 「いつも適用（固定）」は開くたびに入り、手で外せても開き直すと戻る（WaveLog §9.190 と同じ）。 */
  function applyAlwaysOn() {
    const seen = new Set(S.genericFilters.map(filterKey));
    tablePresets().filter((p) => p.always).forEach((p) => (p.filters || []).forEach((f) => {
      const k = filterKey(f);
      if (!seen.has(k)) { seen.add(k); S.genericFilters.push({ ...f, locked: true }); }
      else { const i = S.genericFilters.findIndex((x) => filterKey(x) === k); if (i >= 0) S.genericFilters[i].locked = true; }
    }));
  }

  /* ================= 条件の操作 ================= */
  function reload() { S.page = 1; saveActive(); renderBar(); load(); }
  /** 並べ替え（見出しで決めた分）を list にして引き直す。見出し・件数の行の札・表の見せ方から */
  function setSorts(list) {
    S.sorts = list.slice(0, MAX_SORTS); S.page = 1; saveActive();
    if (!$("#llViewMenu").hidden) renderViewMenu();
    renderPresetButton(); load();
  }
  function addFilter(f) {
    if (!S.genericFilters.some((x) => filterKey(x) === filterKey(f))) S.genericFilters.push({ column: f.column, op: f.op, value: f.value });
    reload();
  }
  function confirmLocked(list) {
    if (!list.length) return true;
    const desc = list.map(condLabel).join("、");
    return confirm(`「いつも適用（固定）」の条件があります（${desc}）。外すと、この一覧を開き直すまで条件が緩みます。\n本当に外しますか？`);
  }
  function removeFilterAt(i) {
    const f = S.genericFilters[i];
    if (!f || (f.locked && !confirmLocked([f]))) return;
    S.genericFilters.splice(i, 1); reload();
  }
  function dropAllFilters({ adhoc: withAdhoc = false } = {}) {
    const locked = S.genericFilters.filter((f) => f.locked);
    S.genericFilters = locked.length && !confirmLocked(locked) ? locked : [];
    if (withAdhoc) { resetAdhoc(); window.LotListSlicer.clearAll(); }   // 全件を見る: スライサーの選択も外す
  }
  function registeredPreset(f) {
    const k = filterKey(f);
    return tablePresets().find((p) => (p.filters || []).length === 1 && filterKey(p.filters[0]) === k) || null;
  }
  function saveOne(f) {
    if (registeredPreset(f)) return "dup";
    S.presets.unshift({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: presetName(f),
      table: scope(), filters: [{ column: f.column, op: f.op, value: f.value }], group: "", always: false });
    savePresets(S.presets.slice(0, 200));
    return "saved";
  }

  /* ================= 保存した見方（7 案＋2 回目で選んだ: ui-proposals/2026-10-sortview* の M2） =================
     条件・並べ替え・まとめ・スライサー（選んだ値ごと・開いているか）・検索、集計表・グラフの組み方（一覧｜集計も）、
     作業実績の「作業でまとめる」の形（日ごと・日＋直ごと・日付の数え方・合計する列）に名前を付けて保存し、プリセットと同じ面で呼び出す。
     呼び出すと、その形にまるごと入れ替わる（「いつも適用（固定）」の条件はそのまま。列で絞り込むの値は外す）。
     その時だけの状態（列で絞り込むの値・畳んだまとまり・頁）は入れない。範囲（表・設備）ごと（table）。保存する前に、入る物を札で見せる */
  const allViews = () => store.get(KEY.views, []);
  const tableViews = () => { const k = scope(); return allViews().filter((v) => v.table === k); };
  const saveViews = (list) => store.set(KEY.views, list.slice(0, 200));
  const newId = (head) => head + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function captureView() {
    const A = arrange();
    return {
      filters: S.genericFilters.filter((f) => !f.locked).map(({ column, op, value }) => ({ column, op, value })),
      sorts: S.sorts.map(({ column, dir }) => ({ column, dir })),
      arrange: levels().length ? { levels: A.levels.map(({ column, dir, lot }) => ({ column, dir, lot: !!lot })), heads: A.heads, suppress: A.suppress } : null,
      slicer: window.LotListSlicer.setupOf(scope(), { sel: true }),
      slicerOpen: window.LotListSlicer.isOpen(),
      search: S.search || "",
      pivot: window.LotListPivot.stateOf(),
      work: S.src.id === "work" ? (({ mode, basis, order, start, total }) => ({ mode, basis, order, start, total }))(window.LotListWork.conf()) : null,
    };
  }
  /** 入っている物の札（「条件 1」「並べ替え 2」「まとめ なし」…） */
  function viewTags(v) {
    const n = (k, x) => `${k} ${x || "なし"}`, lv = v.arrange && v.arrange.levels ? v.arrange.levels.length : 0;
    const wk = v.work && v.work.mode && v.work.mode !== "none" ? `作業でまとめる: ${v.work.mode === "day" ? "日ごと" : "日＋直ごと"}${v.work.total ? "・合計" : ""}` : "";
    return [n("条件", (v.filters || []).length), n("並べ替え", (v.sorts || []).length), n("まとめ", lv ? `${lv}段` : 0),
      n("スライサー", (v.slicer || []).filter((c) => (c.sel || []).length).length)].concat(v.search ? [`検索「${v.search}」`] : [])
      .concat(v.pivot && v.pivot.view === "pivot" ? ["集計表・グラフ"] : []).concat(wk ? [wk] : []);
  }
  /* 見方の比べ方（変更ありか）。like（保存した見方）に無い部品は比べない（版 3.22.0 で保存した見方には、集計・作業でまとめるが無い） */
  const viewSig = (v, like = v) => JSON.stringify([v.filters || [], v.sorts || [], (v.arrange && v.arrange.levels) || [],
    (v.slicer || []).filter((c) => (c.sel || []).length).map((c) => [c.column, c.sel]), v.search || "",
    "pivot" in like && v.pivot ? [v.pivot.view, v.pivot.rows, v.pivot.cols, v.pivot.measures, v.pivot.chart] : null,
    like.work && v.work ? v.work : null, "slicerOpen" in like ? !!v.slicerOpen : null]);
  function saveCurrentView() {
    const cur = captureView(), list = allViews(), sel = selectedPresetKey();
    const was = sel.startsWith("v:") ? list.find((v) => "v:" + v.id === sel) : null;
    const name = (prompt(`いまの条件と並べ替えに名前を付けて保存します（同じ名前は上書き）\n入る物: ${viewTags(cur).join("・")}`, was ? was.name : "") || "").trim().slice(0, 40);
    if (!name) return;
    const same = list.find((v) => v.table === scope() && v.name === name);
    if (same && !confirm(`保存した見方「${name}」を、いまの形で上書きします。よろしいですか？`)) return;
    const v = { id: same ? same.id : newId("v"), name, table: scope(), savedAt: new Date().toISOString(), ...cur };
    saveViews(same ? list.map((x) => (x === same ? v : x)) : [v, ...list]);
    setSelectedPreset("v:" + v.id); renderPresetButton();
    flash(`「${name}」として保存しました（${viewTags(cur).join("・")}）`, 4000);
  }
  function applyView(v) {
    const have = (x) => !S.columns.length || S.columns.includes(x.column);
    const locked = S.genericFilters.filter((f) => f.locked), seen = new Set(locked.map(filterKey));
    S.genericFilters = locked.concat((v.filters || []).filter((f) => !seen.has(filterKey(f))).map(({ column, op, value }) => ({ column, op, value })));
    S.sorts = cleanArrange({ sorts: v.sorts }).sorts.filter(have);
    const a = cleanArrange(v.arrange || {});
    saveArrange(v.arrange ? { levels: a.levels.filter(have), heads: a.heads, suppress: a.suppress } : { levels: [] });
    if ((v.slicer || []).length) window.LotListSlicer.setSetup(scope(), v.slicer, { sel: true }); else window.LotListSlicer.clearAll();
    S.search = String(v.search || ""); const box = $("#llSearch"); if (box) box.value = S.search;
    resetAdhoc();
    if (typeof v.slicerOpen === "boolean") window.LotListSlicer.setOpen(v.slicerOpen);
    if (v.work && S.src.id === "work") window.LotListWork.setConf(v.work);
    if (v.pivot) window.LotListPivot.setState(v.pivot);
    setSelectedPreset("v:" + v.id);
    if (!$("#llViewMenu").hidden) renderViewMenu();
    reload();
  }

  /* ================= プリセット（登録した条件の組み合わせ・切り替え。保存した見方も同じ面で） ================= */
  function presetEntries() {
    const ps = tablePresets(), out = [], groups = new Map();
    tableViews().forEach((v) => out.push({ kind: "view", key: "v:" + v.id, name: v.name, conds: v.filters || [], view: v }));
    ps.forEach((p) => { if (p.group) { if (!groups.has(p.group)) groups.set(p.group, []); groups.get(p.group).push(p); } });
    groups.forEach((list, g) => out.push({ kind: "combo", key: "g:" + g, name: g, conds: list.flatMap((p) => p.filters || []) }));
    ps.forEach((p) => out.push({ kind: "single", key: "p:" + p.id, name: p.name, conds: p.filters || [] }));
    return out;
  }
  function selectedPresetKey() {
    const k = (store.get(KEY.presetSel, {})[scope()]) || PRESET_NONE;
    return presetEntries().some((e) => e.key === k) ? k : PRESET_NONE;
  }
  function setSelectedPreset(k) { const m = store.get(KEY.presetSel, {}), here = scope(); if (k) m[here] = k; else delete m[here]; store.set(KEY.presetSel, m); }
  /* 切り替え＝入れ替え（足すのではない）。前のプリセットの条件を外し、新しいプリセットの条件を入れる。
     手で足した条件と「いつも適用（固定）」はそのまま。
     保存した見方は、その形にまるごと入れ替える（applyView）。見方から離れるときは、いまの形のまま印だけ外す */
  function switchPreset(key) {
    const entries = presetEntries();
    const prev = entries.find((e) => e.key === selectedPresetKey());
    const next = entries.find((e) => e.key === key);
    if (next && next.kind === "view") { applyView(next.view); return; }
    if (prev && prev.kind !== "view") {
      const drop = new Set(prev.conds.map(filterKey));
      S.genericFilters = S.genericFilters.filter((f) => f.locked || !drop.has(filterKey(f)));
    }
    if (next) {
      const seen = new Set(S.genericFilters.map(filterKey));
      next.conds.forEach((f) => { if (!seen.has(filterKey(f))) { seen.add(filterKey(f)); S.genericFilters.push({ column: f.column, op: f.op, value: f.value }); } });
    }
    setSelectedPreset(next ? key : PRESET_NONE);
    reload();
  }
  function presetButtonState() {
    const entries = presetEntries();
    const cur = entries.find((e) => e.key === selectedPresetKey());
    if (!cur) return { name: "なし", total: 0, off: 0, empty: !entries.length, note: "" };
    if (cur.kind === "view") {
      const changed = viewSig(captureView(), cur.view) !== viewSig(cur.view);
      return { name: cur.name, total: 1, off: changed ? 1 : 0, empty: false, note: changed ? "変更あり" : "", view: cur.view, changed };
    }
    const active = new Set(S.genericFilters.map(filterKey));
    const off = cur.conds.filter((f) => !active.has(filterKey(f))).length;
    return { name: cur.name, total: cur.conds.length, off, empty: false, note: off ? `${off}件外し中` : "" };
  }

  /* ================= 列で絞り込む（登録しない・その場だけ） ================= */
  let adhocTimer = null, adhocColsSig = "";
  let adhocOpen = !!store.get(KEY.adhocOpen, false);
  function saveAdhocSetup() {
    if (S.adhocScope == null) return;
    const all = store.get(KEY.adhoc, {}), a = S.adhoc;
    if (a.column) all[S.adhocScope] = { column: a.column, op: a.op }; else delete all[S.adhocScope];
    store.set(KEY.adhoc, all);
  }
  function syncAdhocContext() {
    const k = scope();
    if (k === S.adhocScope) return;
    if (S.adhocScope != null) saveAdhocSetup();
    const saved = store.get(KEY.adhoc, {})[k] || {};
    S.adhoc = { column: String(saved.column || ""), op: OPS.some((o) => o[0] === saved.op) ? saved.op : "contains", value: "" };
    S.adhocScope = k; adhocColsSig = "";
    const box = $("#llAdhocValue"); if (box) box.value = "";
  }
  const adhocColumnOk = () => !!S.adhoc.column && (!S.columns.length || S.columns.includes(S.adhoc.column));
  const adhocActive = () => adhocColumnOk() && (noValueOp(S.adhoc.op)
    || (isRel(S.adhoc.op) ? /^\d+$/.test(String(S.adhoc.value || "").trim()) : !!String(S.adhoc.value || "").trim()));
  /** スライサーより前の絞り込み（条件・列で絞り込む）。スライサーが自分の件数を数えるときにも使う */
  const baseFilters = () => S.genericFilters.map(({ column, op, value }) => ({ column, op, value })).concat(adhocFilters());
  const adhocFilters = () => adhocActive() ? [{ column: S.adhoc.column, op: S.adhoc.op, value: noValueOp(S.adhoc.op) ? "" : String(S.adhoc.value).trim() }] : [];
  const adhocLabel = () => S.adhoc.column ? condLabel({ column: S.adhoc.column, op: S.adhoc.op, value: String(S.adhoc.value || "").trim() }) : "";
  function applyAdhoc(now) {
    clearTimeout(adhocTimer); adhocTimer = null;
    const run = () => { S.page = 1; renderBar(); load(); };
    if (now) run(); else adhocTimer = setTimeout(run, ADHOC_DEBOUNCE_MS);
  }
  function resetAdhoc() { S.adhoc.value = ""; const b = $("#llAdhocValue"); if (b) b.value = ""; }
  function clearAdhoc() { resetAdhoc(); applyAdhoc(true); }
  function keepAdhoc() { const l = adhocFilters(); if (!l.length) return; resetAdhoc(); addFilter(l[0]); }
  /** 打っている条件を、絞り込む代わりに色付けにする（行は絞らない。色付けの M2） */
  function paintAdhoc() {
    const l = adhocFilters(); if (!l.length) return;
    const label = adhocLabel();
    resetAdhoc(); renderBar();
    if (window.LotListMarks.add([l[0]])) flash(`「${label}」に当たった所に色を付けました（行は絞りません）`, 4000);
    else load();
  }
  function setAdhocOpen(v) {
    adhocOpen = !!v; store.set(KEY.adhocOpen, adhocOpen);
    if (adhocOpen) setBodyOpen(false);
    renderAdhocRow();
    if (adhocOpen) requestAnimationFrame(() => {
      const box = $("#llAdhocValue");
      (box && !box.disabled ? box : $("#llAdhocColumn"))?.focus();
    });
    else $("#llAdhocToggle")?.focus();
  }
  function setBodyOpen(v) {
    const body = $("#llFilterBody"); if (!body) return;
    body.hidden = !v;
    const t = $("#llFilterToggle .fb-act-name"); if (t) t.textContent = v ? "「条件を作る」の欄を閉じる" : "条件を作る・登録する";
    if (v && adhocOpen) { adhocOpen = false; store.set(KEY.adhocOpen, false); renderAdhocRow(); }
    if (v) requestAnimationFrame(() => $("#llFilterColumn")?.focus());
  }

  /* ================= フィルタのバー ================= */
  function buildBar() {
    const bar = $("#llFilterBar");
    bar.innerHTML = `
      <div class="filter-search-row">
        <label class="lt-search" title="この一覧の行を、どの列の字でも探します（打つとすぐ絞り込みます）">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/></svg>
          <input id="llSearch" type="search" autocomplete="off" placeholder="一覧を検索" aria-label="一覧を検索">
        </label>
        <button id="llPresetBtn" class="fb-preset-btn" type="button" aria-haspopup="true" aria-expanded="false">
          <span class="fb-preset-key">プリセット</span><b id="llPresetName">なし</b><em id="llPresetNote" hidden></em><i class="hd-caret" aria-hidden="true">▾</i>
        </button>
        <button id="llCondBtn" class="fb-cond-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="llCondMenu">
          <svg class="fb-cond-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 2.6h12.8L9.4 8.2v4.3l-2.8 1.6V8.2z"/></svg>
          <span class="fb-cond-key">条件</span><b id="llCondCount" class="fb-cond-n">0</b><i class="hd-caret" aria-hidden="true">▾</i>
        </button>
        <button id="llAdhocToggle" class="filter-adhoc-toggle" type="button" aria-expanded="false" aria-controls="llAdhocRow">列で絞り込む</button>
        <button id="llSlicerBtn" class="sx-entry" type="button" aria-expanded="false" aria-controls="llSlicer" title="列の値（重複なし）を並べ、押して絞り込みます（Excel のスライサーと同じ）">スライサー</button>
        <!-- 色付け（条件付き書式）: 絞り込みの派生。行は絞らず、当たった所に色（7 案＋2 回目で選んだ: ui-proposals/2026-10-marks* の M2） -->
        <button id="llMarkBtn" class="mk-entry" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="llMarkMenu">色付け</button>
        <div class="filter-token-input" id="llTokenInput" hidden>
          <span class="filter-token-key" aria-hidden="true">＋条件</span>
          <input class="filter-token-search" id="llTokenSearch" autocomplete="off" placeholder="列名・値を打つと候補が出ます" aria-label="条件を検索して足す">
          <div class="filter-suggest" id="llSuggest" hidden></div>
        </div>
        <!-- 右端の群＝見せ方（WaveLog と同じ: 表示列 → 表の見せ方） -->
        <div class="filter-search-row-actions">
          <button id="llColBtn" type="button" class="ll-colbtn" title="この一覧に出す列・並び・幅・書式・読み替えをまとめて設定します">
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6 2.5v11M10.5 2.5v11"/></svg>表示列</button>
          <button id="llViewBtn" type="button" aria-haspopup="dialog" aria-expanded="false" title="行間・並び・表示件数と、機能（ロット番号でまとめる・カード）の使う／使わないを決めます">表の見せ方 ▾</button>
          <button id="llProfileBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="llProfileMenu" title="この PC の一覧の表示（表示列・スライサー・並び・見せ方・登録した条件）を書き出す・読み込む・初期設定に戻す">表示の設定 ▾</button>
          <!-- Excel に出力（表示の道具の後ろ＝最後にする行動の位置。7 案＋2 回目で選んだ: ui-proposals/2026-10-excel*） -->
          <button id="llExcelBtn" type="button" class="ll-xlbtn" title="いまの検索・条件・スライサー・並びに当たる全件を、表示列の見え方のまま Excel（.xlsx）に出します&#10;作業でまとめているときは、日・直ごとのロット数のシートも出します"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 12.5h10"/></svg>Excel に出力</button>
        </div>
        <div class="ll-profile" id="llProfileMenu" hidden role="menu" aria-label="表示の設定"></div>
        <div class="ll-viewmenu" id="llViewMenu" hidden role="dialog" aria-label="表の見せ方"></div>
        <div class="mk-menu" id="llMarkMenu" hidden role="dialog" aria-label="色付け"></div>
        <div class="fb-cond-menu" id="llCondMenu" hidden role="menu" aria-label="条件">
          <div class="fb-cond-list" id="llCondList"></div>
          <div class="fb-cond-acts" role="group" aria-label="条件の操作">
            <button id="llAddCond" type="button" role="menuitem">条件を検索して足す<small>列名・値を打つと候補が出ます</small></button>
            <button id="llFilterToggle" type="button" role="menuitem"><span class="fb-act-name">条件を作る・登録する</span><small>列・比べ方・値を選んで、いまだけ当てるか登録します</small></button>
            <button id="llOpenPresets" type="button" role="menuitem">登録した条件とプリセット<small>条件の削除と、組み合わせ（プリセット）作り・いつも適用</small></button>
            <button id="llClearFilters" class="fb-cond-clear" type="button" role="menuitem">条件を全部外す<small>「固定」の条件は確かめてから外します</small></button>
          </div>
        </div>
      </div>
      <div class="filter-adhoc-row" id="llAdhocRow" hidden
           title="登録はしません。打っているあいだだけ効き、表を切り替えると入力は消えます（列と比べ方は覚えています）。">
        <select id="llAdhocColumn" class="filter-adhoc-col" title="この一覧の列から選びます。選んだ列は次に開いたときも覚えています"></select>
        <select id="llAdhocOp" class="filter-adhoc-op" title="選んだ列をどう比べるか">${OPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <input id="llAdhocValue" class="filter-adhoc-value" list="llAdhocList" autocomplete="off" type="search" title="打つとその場で絞り込みます。Enterですぐ、Escで解除">
        <datalist id="llAdhocList"></datalist>
        <button id="llAdhocKeep" type="button">条件に残す</button>
        <button id="llAdhocPaint" type="button" class="mk-paint"><span class="mk-dot mk-red" aria-hidden="true"></span>色を付ける</button>
        <button id="llAdhocClear" type="button" title="入力を消して、この絞り込みを解除します">解除</button>
        <span class="filter-adhoc-state" id="llAdhocState"></span>
        <button id="llAdhocClose" class="fb-close" type="button" aria-label="列で絞り込むを閉じる" title="閉じます（Esc）。効いている絞り込みはそのまま残ります">✕</button>
      </div>
      <div class="filter-body" id="llFilterBody" hidden>
        <div class="filter-body-head"><b>条件を作る</b>
          <button id="llFilterBodyClose" class="fb-close" type="button" title="閉じます（Esc）">✕ 閉じる</button></div>
        <div class="filter-builder">
          <label>列<select id="llFilterColumn"></select></label>
          <label>比べ方<select id="llFilterOp">${OPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
          <label>値<input id="llFilterValue" list="llSuggestList" placeholder="値を入力/候補から選択"><datalist id="llSuggestList"></datalist></label>
          <div class="filter-builder-actions">
            <button id="llAddFilter" type="button" title="この条件を今の一覧へ追加します（保存はしません）">適用</button>
            <button id="llRegisterFilter" type="button" title="この条件を登録します（一覧へは適用しません）">登録</button>
          </div>
        </div>
        <p class="filter-builder-note" id="llBuilderNote">「適用」は今だけ効かせる／「登録」は次回も使えるように保存する。両方押せます。</p>
      </div>`;

    // 一覧を検索（打つとすぐ。待ってからまとめて1回）
    let st = null;
    TPA.onText($("#llSearch"), (el) => {   // 変換中は探しに行かない（確定してから）
      clearTimeout(st);
      st = setTimeout(() => { S.search = el.value.trim(); S.page = 1; load(); }, SEARCH_DEBOUNCE_MS);
    });
    $("#llSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !TPA.composing(e)) { clearTimeout(st); S.search = e.target.value.trim(); S.page = 1; load(); }
    });
    $("#llPresetBtn").onclick = (e) => openPresetMenu(e.currentTarget);
    $("#llProfileBtn").onclick = () => ($("#llProfileMenu").hidden ? openProfileMenu() : $("#llProfileMenu").hidden = true);
    $("#llCondBtn").onclick = () => toggleCondMenu();
    $("#llCondMenu").addEventListener("click", (e) => { if (e.target.closest(".fb-cond-acts button")) closeCondMenu(); });
    $("#llAddCond").onclick = () => openTokenSearch();
    $("#llFilterToggle").onclick = () => setBodyOpen($("#llFilterBody").hidden);
    $("#llFilterBodyClose").onclick = () => { setBodyOpen(false); $("#llCondBtn").focus(); };
    $("#llOpenPresets").onclick = openPresetModal;
    $("#llClearFilters").onclick = () => { dropAllFilters(); reload(); };

    // 列で絞り込む
    $("#llAdhocToggle").onclick = () => setAdhocOpen(!adhocOpen);
    $("#llAdhocClose").onclick = () => setAdhocOpen(false);
    $("#llAdhocColumn").onchange = () => { S.adhoc.column = $("#llAdhocColumn").value; saveAdhocSetup(); updateAdhocSuggestions(); renderAdhocRow(); applyAdhoc(true); };
    $("#llAdhocOp").onchange = () => { S.adhoc.op = $("#llAdhocOp").value; saveAdhocSetup(); renderAdhocRow(); applyAdhoc(true); };
    const box = $("#llAdhocValue");
    TPA.onText(box, () => { S.adhoc.value = box.value; renderAdhocRow(); applyAdhoc(false); });
    box.addEventListener("keydown", (e) => {
      if (TPA.composing(e)) return;   // 変換の確定の Enter・Esc は IME のもの
      if (e.key === "Enter") { e.preventDefault(); S.adhoc.value = box.value; renderAdhocRow(); applyAdhoc(true); }
      else if (e.key === "Escape" && box.value) { e.preventDefault(); e.stopPropagation(); clearAdhoc(); }
    });
    box.addEventListener("focus", updateAdhocSuggestions);
    $("#llAdhocKeep").onclick = keepAdhoc;
    $("#llAdhocPaint").onclick = paintAdhoc;
    $("#llAdhocClear").onclick = clearAdhoc;

    // 条件を作る（適用と登録は入力を消さない：片方のあとにもう片方も押せる）
    $("#llFilterColumn").onchange = updateBuilderOp;
    $("#llFilterOp").onchange = updateBuilderOp;
    const NOTE = "「適用」は今だけ効かせる／「登録」は次回も使えるように保存する。両方押せます。";
    const note = (t) => { $("#llBuilderNote").textContent = t; };
    const builderFilter = () => {
      const f = { column: $("#llFilterColumn").value, op: $("#llFilterOp").value, value: $("#llFilterValue").value.trim() };
      if (!f.column) return null;
      if (!noValueOp(f.op) && !f.value) { $("#llFilterValue").focus(); return null; }
      if (isRel(f.op) && !/^\d+$/.test(f.value)) { note("「以内」の値は 0 以上の整数で入れてください（例: 7）"); $("#llFilterValue").focus(); return null; }
      if (noValueOp(f.op)) f.value = "";
      return f;
    };
    $("#llAddFilter").onclick = () => { const f = builderFilter(); if (!f) return; addFilter(f); note(`適用しました: ${condLabel(f)}　続けて「登録」も押せます`); };
    $("#llRegisterFilter").onclick = () => {
      const f = builderFilter(); if (!f) return;
      note(saveOne(f) === "saved" ? `登録しました: ${presetName(f)}　続けて「適用」も押せます` : `すでに登録済みです: ${presetName(f)}`);
      renderBar();
    };
    ["#llFilterColumn", "#llFilterOp", "#llFilterValue"].forEach((s) => $(s).addEventListener("input", () => note(NOTE)));
    bindTokenSearch();

    // Esc はバー全体で受け、1回で閉じるのは1枚だけ
    bar.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.target.closest("#llTokenInput,#llCondMenu")) return;
      if (!$("#llFilterBody").hidden) { e.preventDefault(); setBodyOpen(false); $("#llCondBtn").focus(); }
      else if (adhocOpen) { e.preventDefault(); setAdhocOpen(false); }
    });
  }

  function renderBar() {
    if (!$("#llFilterBar").firstChild) buildBar();
    const box = $("#llSearch"); if (box && document.activeElement !== box && box.value !== S.search) box.value = S.search;
    updateFilterColumns(); renderPresetButton(); renderActiveTokens(); renderAdhocRow();
  }
  function updateFilterColumns() {
    const sel = $("#llFilterColumn"); const cur = sel.value;
    const sig = S.columns.join("\u001f") + "|" + S.dateColumns.join("\u001f");
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = S.columns.map(colOption).join("");
      if (S.columns.includes(cur)) sel.value = cur;
    }
    updateBuilderOp();
  }
  /* 条件を作る: 列に合わせて比べ方を選べる／選べないを決め、値の欄の案内と候補を変える */
  function updateBuilderOp() {
    const op = paintOpOptions($("#llFilterOp"), $("#llFilterColumn").value);
    const v = $("#llFilterValue");
    v.disabled = noValueOp(op);
    v.placeholder = isRel(op) ? `数（例: 7 → 7${REL_UNIT[op]}以内。0＝今日から）` : "値を入力/候補から選択";
    updateFilterSuggestions();
  }
  const distinctValues = (col) => [...new Set(S.rows.map((r) => String(r[col] ?? "").trim()).filter(Boolean))].slice(0, 80);
  // 値の候補: ふつうは読み込んだ行の値、「以内」ならよく使う数（7日・1か月など）
  const valueOptions = (col, op) => (isRel(op) ? REL_PICKS[op].map((n) => `<option value="${n}" label="${n}${REL_UNIT[op]}以内"></option>`)
    : distinctValues(col).map((v) => `<option value="${esc(v)}"></option>`)).join("");
  function updateFilterSuggestions() {
    const col = $("#llFilterColumn").value;
    $("#llSuggestList").innerHTML = col ? valueOptions(col, $("#llFilterOp").value) : "";
  }
  function updateAdhocSuggestions() {
    const list = $("#llAdhocList");
    list.innerHTML = !S.adhoc.column || noValueOp(S.adhoc.op) ? "" : valueOptions(S.adhoc.column, S.adhoc.op);
  }
  function renderPresetButton() {
    const btn = $("#llPresetBtn"), st = presetButtonState();
    $("#llPresetName").textContent = st.name;
    const note = $("#llPresetNote"); note.textContent = st.note; note.hidden = !st.note;
    btn.classList.toggle("is-on", st.total > 0 && !st.off);
    btn.classList.toggle("is-partial", st.total > 0 && st.off > 0);
    btn.classList.toggle("is-none", !st.total);
    btn.title = st.view ? `保存した見方「${st.name}」（${viewTags(st.view).join("・")}）` + (st.changed ? "\nいまは、条件・並べ替えなどを保存した形から変えています（もう一度押すと保存した形に戻ります）" : "")
      : st.empty
      ? "プリセット（登録した条件の組み合わせ）と保存した見方はまだありません。\n押して「いまの条件と並べ替えを名前を付けて保存…」で保存できます。"
      : st.total ? `プリセット「${st.name}」（条件${st.total}件${st.off ? `／うち${st.off}件は外しています` : ""}）\n押すと別のプリセットへ切り替えます。`
        : "プリセットを当てていません。押すと切り替えられます。";
  }
  function condRows() {
    const rows = S.genericFilters.map((f, i) => ({ kind: "cond", f, i, locked: !!f.locked }));
    if (adhocActive()) rows.push({ kind: "adhoc", label: adhocLabel() });
    return rows;
  }
  function renderActiveTokens() {
    const btn = $("#llCondBtn"), rows = condRows(), n = rows.length;
    $("#llCondCount").textContent = String(n);
    btn.classList.toggle("is-on", n > 0);
    btn.setAttribute("aria-label", `条件 ${n}つ`);
    btn.title = n ? "効いている条件 " + n + "つ\n" + rows.map((r) => r.kind === "adhoc" ? `列で絞り込み: ${r.label}` : condLabel(r.f)).join("\n")
      + "\n押すと中身を確かめたり、外したり、条件を足したりできます。"
      : "効いている条件はありません。押すと、条件を足す・作る入口が開きます。";
    renderCondMenu();
  }
  function renderCondMenu() {
    const menu = $("#llCondMenu"), list = $("#llCondList");
    if (menu.hidden) return;
    const rows = condRows();
    const line = (r) => {
      if (r.kind === "adhoc") return '<div class="fb-cond-row is-adhoc"><span class="fb-cond-badge" title="登録していない、いまだけの絞り込み（「列で絞り込む」）">一時</span>'
        + `<span class="fb-cond-text">${esc(r.label)}</span><button type="button" class="fb-cond-x" data-adhoc-clear title="列で絞り込みの入力を消して外します">×</button></div>`;
      const known = !!registeredPreset(r.f);
      return `<div class="fb-cond-row${r.locked ? " is-locked" : ""}">`
        + (r.locked ? '<span class="fb-cond-badge is-lock" title="いつも適用（固定）。一覧を開くたびに入ります">🔒 固定</span>' : "")
        + `<span class="fb-cond-text">${esc(r.f.column)} ${isRel(r.f.op) ? `<b>${esc(relText(r.f))}</b><em class="fb-cond-rel">今日から</em>`
          : `<b>${esc(opLabel(r.f.op))}</b>${noValueOp(r.f.op) ? "" : ` <em>${esc(r.f.value)}</em>`}`}</span>`
        + (r.locked ? "" : `<button type="button" class="fb-cond-save${known ? " is-saved" : ""}" data-cond-save="${r.i}" title="${known ? "登録済み（「登録した条件とプリセット」にあります）" : "この条件を登録します。登録すると組み合わせ（プリセット）に入れられます"}">${known ? "★" : "☆"}</button>`)
        + `<button type="button" class="fb-cond-x" data-cond-x="${r.i}" title="この条件を外します">×</button></div>`;
    };
    list.innerHTML = '<p class="fb-cond-head">効いている条件' + (rows.length ? `<small>${rows.length}つ。この一覧に当てている絞り込みです</small>` : "<small>まだありません。下のどれかで足せます</small>") + "</p>" + rows.map(line).join("");
    $$("[data-cond-x]", list).forEach((b) => { b.onclick = () => removeFilterAt(+b.dataset.condX); });
    $$("[data-cond-save]", list).forEach((b) => { b.onclick = () => { const f = S.genericFilters[+b.dataset.condSave]; if (f && !registeredPreset(f)) { saveOne(f); renderBar(); } }; });
    $("[data-adhoc-clear]", list)?.addEventListener("click", clearAdhoc);
    $("#llClearFilters").disabled = !S.genericFilters.length;
  }
  let condOff = null;
  function closeCondMenu(byEsc) {
    const m = $("#llCondMenu"); if (m.hidden) return;
    m.hidden = true; $("#llCondBtn").setAttribute("aria-expanded", "false");
    if (condOff) condOff(); condOff = null;
    if (byEsc) $("#llCondBtn").focus();
  }
  function toggleCondMenu() {
    const m = $("#llCondMenu"), btn = $("#llCondBtn");
    if (!m.hidden) { closeCondMenu(); return; }
    m.hidden = false; renderCondMenu();
    TPA.placeBelow(m, btn);
    btn.setAttribute("aria-expanded", "true");
    condOff = TPA.dismissable(m, closeCondMenu, { keep: btn });
  }
  function renderAdhocRow() {
    const row = $("#llAdhocRow"), toggle = $("#llAdhocToggle");
    if (!row) return;
    const colSel = $("#llAdhocColumn"), sig = S.columns.join("\u001f");
    if (sig !== adhocColsSig) {
      adhocColsSig = sig;
      const missing = S.adhoc.column && S.columns.length && !S.columns.includes(S.adhoc.column);
      colSel.innerHTML = '<option value="">列を選ぶ…</option>'
        + (missing ? `<option value="${esc(S.adhoc.column)}">${esc(S.adhoc.column)}（この一覧にありません）</option>` : "")
        + S.columns.map(colOption).join("");
    }
    if (colSel.value !== S.adhoc.column) colSel.value = S.adhoc.column;
    const opSel = $("#llAdhocOp"); if (opSel.value !== S.adhoc.op) opSel.value = S.adhoc.op;
    if (paintOpOptions(opSel, S.adhoc.column) !== S.adhoc.op && S.columns.length) { S.adhoc.op = opSel.value; saveAdhocSetup(); }
    const box = $("#llAdhocValue"), noVal = noValueOp(S.adhoc.op);
    box.disabled = noVal || !S.adhoc.column;
    box.placeholder = !S.adhoc.column ? "先に列を選んでください" : noVal ? "この条件では値は要りません"
      : isRel(S.adhoc.op) ? `数を打つと絞り込みます（例: 7 → 7${REL_UNIT[S.adhoc.op]}以内）` : "打つとその場で絞り込みます（Enterですぐ）";
    if (document.activeElement !== box && box.value !== S.adhoc.value) box.value = S.adhoc.value;
    const on = adhocActive();
    const keep = $("#llAdhocKeep");
    keep.disabled = !on;
    keep.title = on ? `「${adhocLabel()}」を上の条件へ移します（そのあと登録もできます）` : "効いている条件があるときだけ移せます";
    const paintBtn = $("#llAdhocPaint");
    paintBtn.disabled = !on;
    paintBtn.title = on ? `「${adhocLabel()}」で絞り込む代わりに、当たった所に色を付けます（行は絞りません）` : "効いている条件があるときだけ色にできます";
    $("#llAdhocClear").disabled = !on && !String(S.adhoc.value || "").trim();
    const state = $("#llAdhocState");
    if (!S.adhoc.column) { state.className = "filter-adhoc-state"; state.textContent = "列と比べ方を選ぶと使えます"; }
    else if (!adhocColumnOk()) { state.className = "filter-adhoc-state is-warn"; state.textContent = `この一覧に「${S.adhoc.column}」の列がありません`; }
    else if (on) { state.className = "filter-adhoc-state is-on"; state.textContent = `効いています: ${adhocLabel()}`; }
    else if (isRel(S.adhoc.op) && String(S.adhoc.value || "").trim()) { state.className = "filter-adhoc-state is-warn"; state.textContent = "「以内」は 0 以上の整数で入れてください（例: 7）"; }
    else { state.className = "filter-adhoc-state"; state.textContent = "まだ効いていません（入力欄に打つと効きます）"; }
    state.title = state.textContent;
    row.hidden = !adhocOpen;
    // 畳んでいても効いていることを名乗る（見えない場所で絞り込みが効いている状態を作らない）
    toggle.textContent = on ? `列で絞り込み中: ${adhocLabel()}` : "列で絞り込む";
    toggle.classList.toggle("active", adhocOpen || on);
    toggle.classList.toggle("is-on", on);
    toggle.setAttribute("aria-expanded", adhocOpen ? "true" : "false");
    toggle.title = on ? `いま「${adhocLabel()}」で絞り込んでいます。押すと開いて直せます` : "列と比べ方を決めておき、値を打つとその場で絞り込みます（登録はしません）";
    renderCondMenu();
  }

  /* ---- 条件を検索して足す（再認 > 想起: 登録した条件・列・値の候補から選ぶ） ---- */
  function openTokenSearch() {
    const w = $("#llTokenInput"); w.hidden = false;
    const inp = $("#llTokenSearch"); inp.value = ""; renderSuggest(""); inp.focus();
  }
  function closeTokenSearch() { $("#llTokenInput").hidden = true; $("#llSuggest").hidden = true; }
  function suggestions(text) {
    const t = text.trim().toLowerCase(), out = [];
    if (!t) {
      tablePresets().slice(0, 8).forEach((p) => out.push({ group: "登録した条件", label: p.name, f: (p.filters || [])[0] }));
      return out.filter((x) => x.f);
    }
    tablePresets().filter((p) => p.name.toLowerCase().includes(t)).slice(0, 6)
      .forEach((p) => out.push({ group: "登録した条件", label: p.name, f: (p.filters || [])[0] }));
    S.columns.filter((c) => c.toLowerCase().includes(t)).slice(0, 5)
      .forEach((c) => out.push({ group: "列", label: `${c} …（比べ方と値を決める）`, build: c }));
    // 日付の列は「今日から」の決まった範囲をすぐ足せる
    S.dateColumns.filter((c) => c.toLowerCase().includes(t) || /日|以内|今日/.test(t)).slice(0, 2).forEach((c) => {
      [["within_days", "7"], ["within_months", "1"], ["within_months", "3"]].forEach(([op, v]) => {
        const f = { column: c, op, value: v };
        out.push({ group: "日付（今日から）", label: condLabel(f), f });
      });
    });
    const vals = [];
    for (const col of S.columns) {
      for (const v of distinctValues(col)) {
        if (v.toLowerCase().includes(t)) { vals.push({ group: "候補の値", label: `${col} ＝ ${v}`, f: { column: col, op: "eq", value: v } }); break; }
      }
      if (vals.length >= 8) break;
    }
    return out.concat(vals).filter((x) => x.f || x.build);
  }
  let suggestItems = [], suggestIdx = 0;
  function renderSuggest(text) {
    suggestItems = suggestions(text); suggestIdx = 0;
    const box = $("#llSuggest");
    if (!suggestItems.length) { box.innerHTML = `<p class="fs-empty">${text.trim() ? "当たる候補がありません（「条件を作る」で作れます）" : "登録した条件がまだありません。列名か値を打ってください"}</p>`; box.hidden = false; return; }
    let last = "";
    box.innerHTML = suggestItems.map((x, i) => {
      const head = x.group !== last ? `<p class="fs-sec">${esc(x.group)}</p>` : ""; last = x.group;
      return head + `<button type="button" class="fs-item${i === 0 ? " is-active" : ""}" data-i="${i}">${esc(x.label)}</button>`;
    }).join("");
    box.hidden = false;
    $$("[data-i]", box).forEach((b) => { b.onmousedown = (e) => { e.preventDefault(); pickSuggest(+b.dataset.i); }; });
  }
  function pickSuggest(i) {
    const x = suggestItems[i]; if (!x) return;
    closeTokenSearch();
    if (x.build) { setBodyOpen(true); $("#llFilterColumn").value = x.build; updateFilterSuggestions(); $("#llFilterValue").focus(); return; }
    addFilter(x.f);
  }
  function bindTokenSearch() {
    const inp = $("#llTokenSearch");
    TPA.onText(inp, () => renderSuggest(inp.value));
    inp.addEventListener("keydown", (e) => {
      if (TPA.composing(e)) return;   // 変換の確定の Enter で候補を選ばない
      const items = $$(".fs-item", $("#llSuggest"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!items.length) return;
        suggestIdx = (suggestIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach((b, i) => b.classList.toggle("is-active", i === suggestIdx));
      } else if (e.key === "Enter") { e.preventDefault(); pickSuggest(suggestIdx); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeTokenSearch(); $("#llCondBtn").focus(); }
    });
    inp.addEventListener("blur", () => setTimeout(closeTokenSearch, 120));
  }

  /* ---- 表示の設定（この PC の一覧の表示をまとめて書き出す・読み込む・初期設定。中身は lotlist-profile.js） ---- */
  async function openProfileMenu() {
    const m = $("#llProfileMenu"), b = $("#llProfileBtn"), P = window.LotListProfile;
    let can = false;
    try { const d = await (await fetch("/api/ui-defaults", { cache: "no-store" })).json(); can = !!d.canPublish;
      window.TPA_UI_PROFILE = { keys: d.keys, defaults: d.defaults, updatedAt: d.updatedAt, updatedBy: d.updatedBy }; } catch (_) { /* 置けるかは分からない＝出さない */ }
    const who = P.defaultsWho();
    const item = (act, title, note, extra = "") => `<button type="button" role="menuitem" data-act="${act}"${extra}><b>${title}</b><small>${note}</small></button>`;
    m.innerHTML = item("export", "書き出し…", "表示列・スライサー・並び・見せ方・登録した条件を 1 つのファイルに")
      + item("import", "読み込み…", "書き出したファイルから、この PC の表示を置き換えます")
      + item("reset", "初期設定に戻す", P.hasDefaults() ? `開発者が配った見せ方（${esc(who)}）に戻します` : "初期設定はまだ配られていません", P.hasDefaults() ? "" : " disabled")
      + (can ? `<div class="pf-dev">${item("publish", '今の表示を初期設定にする <i>開発者</i>', "新しく入れた PC が最初に開いたときの見せ方になります（全員の PC に効きます）")}</div>` : "")
      + '<p class="pf-msg" id="llProfileMsg" aria-live="polite" hidden></p>';
    m.hidden = false; b.setAttribute("aria-expanded", "true");
    const close = () => { m.hidden = true; b.setAttribute("aria-expanded", "false"); };
    TPA.dismissable(m, close, { keep: b });   // 外を押す・Esc で閉じる（項目を押しても開いたまま＝結果を読める）
    const say = (t, ng) => { const x = $("#llProfileMsg"); x.hidden = false; x.textContent = t; x.classList.toggle("is-ng", !!ng); };
    m.onclick = async (e) => {
      const x = e.target.closest("[data-act]"); if (!x || x.disabled) return;
      try {
        if (x.dataset.act === "export") { const n = P.exportFile(); say(`${n} 項目を書き出しました`); }
        else if (x.dataset.act === "import") { say("読み込んでいます…"); if ((await P.importFile()) == null) say("読み込みをやめました"); }
        else if (x.dataset.act === "reset") { if (confirm("この PC の一覧の表示を、開発者が配った初期設定に戻します（今の表示列・スライサー・並び・登録した条件は置き換わります）。よろしいですか？")) await P.resetToDefaults(); }
        else if (x.dataset.act === "publish") {
          if (!confirm("今のこの PC の一覧の表示を、初期設定にします。新しく入れた PC が最初に開いたときに、この見せ方になります。よろしいですか？")) return;
          const n = await P.publish(); say(`初期設定にしました（${n} 項目）`);
        }
      } catch (err) { say(err.message, true); }
    };
    m.querySelector("button:not(:disabled)")?.focus();
  }

  /* ---- プリセットの切り替えメニュー ---- */
  let presetMenuEl = null, presetOff = null;
  function closePresetMenu() {
    presetMenuEl?.remove(); presetMenuEl = null;
    $("#llPresetBtn")?.setAttribute("aria-expanded", "false");
    if (presetOff) presetOff(); presetOff = null;
  }
  const pickHtml = (key, label, sub, on) => `<button type="button" role="menuitemradio" class="fb-preset-pick${on ? " is-current" : ""}" aria-checked="${on}" data-preset-key="${esc(key)}">`
    + `<i class="fb-preset-mark" aria-hidden="true"></i><span class="fb-preset-label">${esc(label)}</span><small class="fb-preset-sub">${esc(sub)}</small></button>`;
  function openPresetMenu(anchor) {
    if (presetMenuEl) { closePresetMenu(); return; }
    const entries = presetEntries(), cur = selectedPresetKey();
    const combos = entries.filter((e) => e.kind === "combo"), ones = entries.filter((e) => e.kind === "single"), views = entries.filter((e) => e.kind === "view");
    const sub = (e) => `${e.conds.length}条件 ／ ` + e.conds.map(condLabel).join(" ・ ");
    let body = '<p class="fb-preset-head">プリセット<small>押すと切り替わります（足すのではなく入れ替え）。保存した見方は、条件・並べ替えなどがその形になります</small></p>'
      + pickHtml(PRESET_NONE, "なし", "プリセットの条件を入れません（保存した見方は、いまの形のまま外します）", !cur);
    if (views.length) body += '<p class="fb-preset-sec">保存した見方（条件・並べ替え・まとめ・スライサー）</p>' + views.map((e) => pickHtml(e.key, e.name, viewTags(e.view).join("・"), e.key === cur)).join("");
    if (combos.length) body += '<p class="fb-preset-sec">組み合わせ</p>' + combos.map((e) => pickHtml(e.key, e.name, sub(e), e.key === cur)).join("");
    if (ones.length) body += '<p class="fb-preset-sec">登録した条件（1件ずつ当てる）</p>' + ones.map((e) => pickHtml(e.key, e.name, sub(e), e.key === cur)).join("");
    if (!entries.length) body += '<p class="fb-preset-empty">登録した条件・保存した見方がまだありません。条件を作って「登録」するか、下でいまの形を保存すると、ここに並びます。</p>';
    body += `<div class="fb-preset-now"><p class="fb-preset-sec">いまの形<small>保存すると入る物</small></p><div class="fb-preset-tags">${viewTags(captureView()).map((t) => `<i>${esc(t)}</i>`).join("")}</div>`
      + '<button type="button" id="llViewSave" class="fb-preset-save">＋ いまの条件と並べ替えを名前を付けて保存…</button></div>'
      + '<div class="fb-preset-foot"><button type="button" id="llPresetManage">登録した条件・プリセット・保存した見方を開く</button>'
      + "<small>「いつも適用（固定）」の条件は、切り替えても入ったままです。</small></div>";
    const menu = document.createElement("div");
    menu.className = "fb-preset-menu"; menu.setAttribute("role", "menu"); menu.innerHTML = body;
    root.append(menu); presetMenuEl = menu;
    TPA.placeBelow(menu, anchor);
    $$("[data-preset-key]", menu).forEach((b) => { b.onclick = () => { const k = b.dataset.presetKey; closePresetMenu(); switchPreset(k); }; });
    $("#llPresetManage", menu).onclick = () => { closePresetMenu(); openPresetModal(); };
    $("#llViewSave", menu).onclick = () => { closePresetMenu(); saveCurrentView(); };
    anchor.setAttribute("aria-expanded", "true");
    presetOff = TPA.dismissable(menu, closePresetMenu, { keep: anchor });
  }

  /* ---- 登録した条件とプリセット（組み合わせ名・いつも適用（固定）・削除） ---- */
  function openPresetModal() {
    const dlg = $("#llPresetModal");
    renderPresetModal(); dlg.hidden = false;
    requestAnimationFrame(() => $("#llPresetModalClose").focus());
  }
  function closePresetModal() { $("#llPresetModal").hidden = true; $("#llCondBtn")?.focus(); }
  /* 保存した見方の行（名前を直す・当てる・いまの形で上書き・削除） */
  function renderViewRows() {
    const vs = tableViews(), body = $("#llViewRows");
    body.innerHTML = vs.length ? vs.map((v) => `<tr data-id="${esc(v.id)}">
        <td><input class="ll-pm-vname" value="${esc(v.name)}" maxlength="40" aria-label="保存した見方の名前"></td>
        <td class="ll-pm-tags">${viewTags(v).map((t) => `<i>${esc(t)}</i>`).join("")}</td>
        <td class="c"><button type="button" class="row-btn ll-pm-vapply">当てる</button></td>
        <td class="c"><button type="button" class="row-btn ll-pm-vput" title="いまの条件・並べ替え・まとめ・スライサー・検索で上書きします">いまの形で上書き</button></td>
        <td class="c"><button type="button" class="row-btn danger ll-pm-vdel">削除</button></td></tr>`).join("")
      : '<tr><td colspan="5" class="ll-pm-empty">保存した見方はまだありません。「プリセット」の「いまの条件と並べ替えを名前を付けて保存…」で保存できます。</td></tr>';
    $$("tr[data-id]", body).forEach((tr) => {
      const id = tr.dataset.id, edit = (fn) => { saveViews(allViews().map((v) => (v.id === id ? fn(v) : v))); renderViewRows(); renderPresetButton(); };
      const v = allViews().find((x) => x.id === id);
      $(".ll-pm-vname", tr).onchange = (e) => { const n = e.target.value.trim().slice(0, 40); if (n) edit((x) => ({ ...x, name: n })); else e.target.value = v.name; };
      $(".ll-pm-vapply", tr).onclick = () => applyView(v);
      $(".ll-pm-vput", tr).onclick = () => { if (confirm(`保存した見方「${v.name}」を、いまの形（${viewTags(captureView()).join("・")}）で上書きします。よろしいですか？`)) edit((x) => ({ ...x, ...captureView(), savedAt: new Date().toISOString() })); };
      $(".ll-pm-vdel", tr).onclick = () => {
        if (!confirm(`保存した見方「${v.name}」を削除します。よろしいですか？（いまの条件・並べ替えはそのままです）`)) return;
        saveViews(allViews().filter((x) => x.id !== id)); renderViewRows(); renderPresetButton();
      };
    });
  }
  function renderPresetModal() {
    renderViewRows();
    const ps = tablePresets(), groups = [...new Set(ps.map((p) => p.group).filter(Boolean))];
    $("#llPresetGroups").innerHTML = groups.map((g) => `<option value="${esc(g)}"></option>`).join("");
    $("#llPresetTable").textContent = S.table ? S.src.place(S.table) : "-";
    const body = $("#llPresetRows");
    if (!ps.length) { body.innerHTML = '<tr><td colspan="5" class="ll-pm-empty">登録した条件はまだありません。「条件」→「条件を作る・登録する」か、効いている条件の ☆ で登録できます。</td></tr>'; return; }
    body.innerHTML = ps.map((p) => `<tr data-id="${esc(p.id)}">
        <td class="ll-pm-cond" title="${esc((p.filters || []).map(condLabel).join(" ・ "))}">${esc(p.name)}</td>
        <td><input class="ll-pm-group" list="llPresetGroups" value="${esc(p.group || "")}" placeholder="（組み合わせに入れない）" aria-label="プリセット（組み合わせ）の名前"></td>
        <td class="c"><label class="ll-pm-always"><input type="checkbox" class="ll-pm-lock"${p.always ? " checked" : ""}> いつも適用（固定）</label></td>
        <td class="c"><button type="button" class="row-btn ll-pm-apply">当てる</button></td>
        <td class="c"><button type="button" class="row-btn danger ll-pm-del">削除</button></td></tr>`).join("");
    $$("tr[data-id]", body).forEach((tr) => {
      const p = S.presets.find((x) => x.id === tr.dataset.id);
      $(".ll-pm-group", tr).onchange = (e) => { p.group = e.target.value.trim().slice(0, 40); savePresets(); renderPresetModal(); renderBar(); };
      $(".ll-pm-lock", tr).onchange = (e) => {
        p.always = e.target.checked; savePresets();
        // すぐ当て直す（開き直しを待たない）
        (p.filters || []).forEach((f) => {
          const i = S.genericFilters.findIndex((x) => filterKey(x) === filterKey(f));
          if (p.always) { if (i >= 0) S.genericFilters[i].locked = true; else S.genericFilters.push({ ...f, locked: true }); }
          else if (i >= 0) { const stillAlways = tablePresets().some((q) => q.always && (q.filters || []).some((g) => filterKey(g) === filterKey(f))); if (!stillAlways) delete S.genericFilters[i].locked; }
        });
        reload();
      };
      $(".ll-pm-apply", tr).onclick = () => { (p.filters || []).forEach((f) => { if (!S.genericFilters.some((x) => filterKey(x) === filterKey(f))) S.genericFilters.push({ ...f }); }); reload(); };
      $(".ll-pm-del", tr).onclick = () => {
        if (!confirm(`登録した条件「${p.name}」を削除します。よろしいですか？（効いている条件からは外しません）`)) return;
        savePresets(S.presets.filter((x) => x.id !== p.id));
        S.genericFilters.forEach((f) => { if (f.locked && !tablePresets().some((q) => q.always && (q.filters || []).some((g) => filterKey(g) === filterKey(f)))) delete f.locked; });
        renderPresetModal(); renderBar();
      };
    });
  }

  /* ================= 一覧（表） ================= */
  /* ---- 表示列（lotlist-columns.js）へ渡す「いまの一覧」 ---- */
  const layoutTarget = () => S.src.target(S.table);
  function columnContext() {
    return { target: layoutTarget(), table: S.src.colTable(S.table), title: `${S.src.title}：${S.src.place(S.table)}`, fileStem: S.src.fileStem,
      place: S.src.place(S.table), columns: window.LotListColumns.allColumns(layoutTarget(), S.columns),
      sourceColumns: S.columns, rows: S.rows, lotColumn: S.lotColumn, grid: $("#llGrid"),
      rerender: () => renderGrid(), toast: (m) => flash(m), levels: levelsApi() };
  }
  /** 件数の行の案内: ロット番号を押したとき・虫眼鏡を押したときに起きること（押す前に違いが分かるように） */
  function paintLotHint() {
    const h = $(".ll-lothint", root); if (!h) return;
    h.innerHTML = lensOn() ? `ロット番号を押すと計算へ取り込み・${LENS_ICON} で LotDsp を開くだけ` : "ロット番号を押すと、計算へ移って取り込みます";
  }
  /** 虫眼鏡: LotDsp でそのロットを開くだけ（取り込まない・画面は移らない）。WaveLog と同じく、ロット番号と鋳造番号の linkkey の URL で開く */
  function showLot(btn) {
    if (onLens) flash(onLens(btn.dataset.lens, btn.dataset.cast || "", lotDspTab()), 5000);
  }
  function flash(msg, ms = 2600) {
    const n = $("#llFlash") || Object.assign(document.createElement("div"), { id: "llFlash", className: "ll-flash" });
    if (!n.isConnected) root.append(n);
    n.textContent = msg; n.classList.add("is-on");
    clearTimeout(flash.t); flash.t = setTimeout(() => n.classList.remove("is-on"), ms);
  }
  /* ---- 表の見せ方（並び・まとめ／列と文字／そのほか） ----
     上から「何を・どの順で並べてまとめるか」→「列と字の詰め方」→「件数・機能」。触るとすぐ後ろの一覧に出る（見て確かめられる）。 */
  const CIRCLED = "①②③④";
  /* まとめの見せ方（見出し行・繰り返しを省く の組）。札は小さな表の絵で、押す前に結果が分かる（再認 > 想起） */
  const LOOKS = [
    ["plain", "並べるだけ", "値が同じ行を続けて並べるだけです（まとまりの切れ目に線を引きます）", false, false],
    ["heads", "見出し行", "まとまりごとに見出し（段の名前・値・件数・共通の値）を付け、押すと畳めます", true, false],
    ["merge", "繰り返しを省く", "まとめた列の同じ値を1つにし、縦につながった面で見せます（値の横に件数）", false, true],
    ["both", "見出し＋省く", "見出し行で区切り、中の行のまとめた列は面にして値を見せません", true, true],
  ];
  /* 詰め具合のおすすめ（余白と入り切らない字の組。1押しで決まり、細かくは下のつまみで） */
  const PACKS = [["roomy", "ゆったり", 12, "ellipsis"], ["normal", "ふつう", 10, "ellipsis"], ["tight", "詰める", 4, "ellipsis"], ["tightest", "最も詰める", 1, "clip"]];
  const SAMPLE_W = 124;
  /* 見本: いまの一覧でいちばん長い値（先頭の行から）を、同じ幅の列で「ふつう」と「いま」に並べて見せる（どこで切れるかが見える） */
  function sampleText() {
    const LC = window.LotListColumns, t = layoutTarget();
    let best = "2025-09-17T08:15:00";
    S.rows.slice(0, 40).forEach((r) => S.columns.slice(0, 30).forEach((c) => {
      const v = String(LC.cell(t, c, r).text || ""); if (v.length > best.length && v.length <= 32) best = v;
    }));
    return best;
  }
  function sampleHtml() {
    const LC = window.LotListColumns, txt = esc(sampleText());
    const cell = (pad, ov) => `<span class="vm-cell" data-ov="${ov}" style="width:${SAMPLE_W}px;padding:0 ${pad}px">${txt}</span>`;
    return `<span class="vm-cellwrap"><small>ふつう</small>${cell(10, "ellipsis")}</span><i aria-hidden="true">→</i><span class="vm-cellwrap is-now"><small>いま</small>${cell(LC.cellPad(), LC.overflow())}</span>`;
  }
  /* 左に固定: 一覧の先頭の列を小さな列の図で出し、押した列までを固定（📌）。いちばん左の「しない」で外す */
  function freezeHtml() {
    const LC = window.LotListColumns, t = layoutTarget(), fz = LC.freeze();
    const cols = LC.visible(t, LC.allColumns(t, S.columns), S.lotColumn).slice(0, LC.FREEZE_MAX + 2);
    return `<button type="button" data-freeze="0" class="vm-fz-none" aria-pressed="${fz === 0}" title="固定しません">しない</button>`
      + cols.map((c, i) => `<button type="button" data-freeze="${Math.min(i + 1, LC.FREEZE_MAX)}" class="vm-fz${i < fz ? " is-on" : ""}${i === fz - 1 ? " is-last" : ""}"${i >= LC.FREEZE_MAX ? " disabled" : ""} title="${i < LC.FREEZE_MAX ? `先頭から「${esc(LC.label(t, c))}」まで（${i + 1}列）を、横に動かしても左に残します` : `固定できるのは${LC.FREEZE_MAX}列までです`}">${i === fz - 1 ? "📌 " : ""}${esc(LC.label(t, c))}</button>`).join("");
  }
  function lookPicture(k) {
    const r = (cells) => `<tr>${cells}</tr>`, H = (a, b, c) => `<tr class="h"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
    const rows = {
      plain: r("<td>L01</td><td>CR1</td><td>キズ</td>") + r("<td>L02</td><td>CR1</td><td>キズ</td>") + `<tr class="cut"><td>L03</td><td>L-1</td><td>汚れ</td></tr>`,
      heads: H("▾CR1 2件", "CR1", "キズ") + r("<td>&nbsp;L01</td><td>CR1</td><td>キズ</td>") + r("<td>&nbsp;L02</td><td>CR1</td><td>キズ</td>"),
      merge: r('<td>L01</td><td class="b0"><b>CR1</b></td><td class="b1"><b>キズ</b></td>') + r('<td>L02</td><td class="b0"></td><td class="b1"></td>') + `<tr class="cut"><td>L03</td><td class="b0"><b>L-1</b></td><td class="b1"><b>汚れ</b></td></tr>`,
      both: H("▾CR1 2件", "CR1", "キズ") + r('<td>&nbsp;L01</td><td class="b0"></td><td class="b1"></td>') + r('<td>&nbsp;L02</td><td class="b0"></td><td class="b1"></td>'),
    };
    return `<table class="vm-pic" aria-hidden="true">${rows[k]}</table>`;
  }
  function renderViewMenu() {
    const m = $("#llViewMenu"), LC = window.LotListColumns, g = LC.rowGap(), t = layoutTarget();
    const A = arrange(), lv = levels(), set = new Set(lv.map((l) => l.column));
    const eff = effectiveSorts(), effSet = new Set(eff.map((x) => x.column));
    const dirs = (l) => [["asc", "▲ 小さい順", "値の小さい順（文字は五十音・ABC 順）"], ["desc", "▼ 大きい順", "値の大きい順"]]
      .concat(l.column === S.lotColumn && lv.indexOf(l) === 0 ? [[LOT_ORDER, "≡ 並べ替えの順", "ロットを、下の「その中の並べ替え」でそのロットのいちばん上に来る行の順に並べます（以前の「ロット番号でまとめる」と同じ）"]] : [])
      .map(([v, txt, tip]) => `<button type="button" data-lv-dir="${v}" aria-pressed="${dirOf(l, lv.indexOf(l)) === v}" title="${esc(tip)}">${txt}</button>`).join("");
    const lvRows = lv.map((l, i) => `<li class="vm-lv" data-col="${esc(l.column)}" draggable="true" style="--ind:${i}">`
      + `<i class="vm-grip" title="ドラッグで段の順を入れ替えます" aria-hidden="true">⠿</i><b class="vm-lvn" title="${i + 1}段目（上の段ほど先に並べます）">${i + 1}</b>`
      + `<span class="vm-lvname" title="${esc(l.column)}">${esc(LC.label(t, l.column))}</span><span class="vm-seg">${dirs(l)}</span>`
      + `<button type="button" class="vm-x" data-lv-x title="この段を外します" aria-label="「${esc(LC.label(t, l.column))}」の段を外す">×</button></li>`).join("");
    const addable = S.columns.filter((c) => !set.has(c));
    const inner = S.sorts.filter((x) => !set.has(x.column));
    const innerText = inner.map((x) => {
      const on = effSet.has(x.column), n = eff.findIndex((e) => e.column === x.column);
      return `<span class="vm-sort${on ? "" : " is-off"}"${on ? "" : ` title="並べ替えのキーは段と合わせて${MAX_SORTS}つまでなので、効いていません"`}>${on ? CIRCLED[n] : "－"} ${esc(LC.label(t, x.column))} ${x.dir === "desc" ? "▼" : "▲"}</span>`;
    }).join("");
    const pad = LC.cellPad(), fz = LC.freeze(), ov = LC.overflow();
    m.innerHTML = `<p class="vm-head">表の見せ方</p>
      <section class="vm-sec" aria-label="並び・まとめ"><h4>並び・まとめ<small>上の段から順に並べ、値が同じ行をまとめます</small></h4>
        ${workOn() ? '<p class="vm-wknote">いまは作業でまとめているので、段は使わず作業開始の順に並べています（件数の行の「まとめない」で段に戻ります）。</p>' : ""}
        <ol class="vm-levels" id="llLevels">${lvRows || '<li class="vm-lv-empty">まだまとめていません。下で列を選ぶと、その列の値ごとに並べてまとめます（いくつでも重ねられます）</li>'}</ol>
        <div class="vm-lvadd"><select id="llLvAdd"${lv.length >= MAX_SORTS ? ` disabled title="まとめる段は${MAX_SORTS}つまでです"` : ""} aria-label="まとめる列を足す">
          <option value="">＋ ${lv.length ? `${lv.length + 1}段目に` : ""}まとめる列を足す…</option>${addable.map((c) => `<option value="${esc(c)}">${esc(LC.label(t, c))}${c === S.lotColumn ? "（ロット番号）" : ""}</option>`).join("")}</select>
          ${lv.length ? '<button type="button" id="llLvClear" title="まとめるのをやめ、1行ずつ並べます">まとめない</button>' : ""}</div>
        <div class="vm-sub">見せ方<small>押すと、すぐ一覧がこの形になります</small></div>
        <div class="vm-looks" role="radiogroup" aria-label="まとめの見せ方">${LOOKS.map(([k, name, tip, heads, sup]) => `<button type="button" role="radio" class="vm-look" data-look="${k}" aria-checked="${!!lv.length && A.heads === heads && A.suppress === sup}"${lv.length ? "" : " disabled"} title="${esc(tip)}">${lookPicture(k)}<span>${name}</span></button>`).join("")}</div>
        <div class="vm-inner"><span>その中の並び</span><div>${innerText || '<em>見出しを押すと並べ替えます（Shift＋クリックで足す）</em>'}
          ${inner.length ? '<button type="button" id="llSortClear">並べ替えを外す</button>' : ""}</div></div>
        <div class="vm-inner vm-file"><span>ファイル</span><div>
          <button type="button" id="llArrExport" title="段・向き・見せ方・その中の並びを、JSON のファイルに書き出します（ほかの PC・人へ渡せます）">書き出し…</button>
          <button type="button" id="llArrImport" title="書き出したファイルを読み込み、この表に当てます（この表に無い列の段は飛ばします）">読み込み…</button></div></div>
      </section>
      <section class="vm-sec" aria-label="列と文字"><h4>列と文字<small>列を狭めても読めるように詰め方を決めます</small></h4>
        <div class="vm-row"><span>詰め具合</span><span class="vm-seg" role="radiogroup" aria-label="詰め具合">${PACKS.map(([k, name, p, o]) => `<button type="button" role="radio" data-pack="${k}" aria-checked="${pad === p && ov === o}" title="余白 左右${p}px・${LC.OVERFLOWS.find((x) => x[0] === o)[1]}">${name}</button>`).join("")}</span></div>
        <div class="vm-row"><span>見本<small>同じ幅の列</small></span><div class="vm-sample" id="llSample">${sampleHtml()}</div></div>
        <label class="vm-row"><span>セルの余白</span><input type="range" id="llCellPad" min="0" max="${LC.PAD_MAX}" step="1" value="${pad}" aria-describedby="llCellPadLabel"><b id="llCellPadLabel">左右 ${pad}px</b></label>
        <div class="vm-row"><span>入り切らない字</span><span class="vm-seg" role="radiogroup" aria-label="入り切らない字">${LC.OVERFLOWS.map(([v, txt, tip]) => `<button type="button" role="radio" data-ov="${v}" aria-checked="${v === ov}" title="${esc(tip)}">${txt}</button>`).join("")}</span></div>
        <div class="vm-row"><span>左に固定<small>押した列まで</small></span><div class="vm-freeze" id="llFreezeMap">${freezeHtml()}</div></div>
        <label class="vm-row"><span>行間</span><input type="range" id="llGap" min="1" max="5" step="1" value="${g}"><b id="llGapLabel">${LC.GAP[g - 1][0]}</b></label>
      </section>
      <section class="vm-sec" aria-label="そのほか"><h4>そのほか</h4>
        <label class="vm-row"><span>表示件数</span><select id="llPageSize">${PAGE_SIZES.map((n) => `<option value="${n}"${n === S.pageSize ? " selected" : ""}>${n}件ずつ</option>`).join("")}</select></label>
        <div class="vm-row"><span>機能</span><div class="vm-feats">
          <label class="vm-switch"><input type="checkbox" id="llFeatLens"${feat.lens ? " checked" : ""}>
            <b>ロット番号の横に虫眼鏡を出す</b><small>押すと LotDsp（ロット問い合わせ）でそのロットを開くだけです。取り込まず、画面も移りません（番号を押すと、これまでどおり計算へ取り込みます）</small></label>
          <label class="vm-switch"><input type="checkbox" id="llFeatCard"${feat.card ? " checked" : ""}>
            <b>行のダブルクリックでカードを開く</b><small>1行を読みやすいカードで見ます。Ctrl＋ダブルクリックで別のカードに開き、並べて比べられます</small></label>
        </div></div>
      </section>`;
    const reArrange = () => { renderViewMenu(); load(); };
    const lvList = () => arrange().levels;
    $("#llLvAdd").onchange = (e) => { const c = e.target.value; if (!c) return; setLevels(lvList().concat([{ column: c, dir: "asc", lot: c === S.lotColumn }])); reArrange(); };
    $("#llLvClear")?.addEventListener("click", () => { setLevels([]); reArrange(); });
    $("#llArrExport").onclick = exportArrange;
    $("#llArrImport").onclick = importArrange;
    $$("#llLevels .vm-lv", m).forEach((li) => {
      const c = li.dataset.col;
      $$("[data-lv-dir]", li).forEach((b) => { b.onclick = () => { setLevels(lvList().map((l) => (l.column === c ? { ...l, dir: b.dataset.lvDir } : l))); reArrange(); }; });
      $("[data-lv-x]", li).onclick = () => { setLevels(lvList().filter((l) => l.column !== c)); reArrange(); };
    });
    TPA.dragSort($("#llLevels"), ".vm-lv", { axis: "vertical", onDrop: (k, target, after) => {
      const list = lvList(), item = list.find((l) => l.column === k), rest = list.filter((l) => l.column !== k);
      rest.splice(rest.findIndex((l) => l.column === target) + (after ? 1 : 0), 0, item);
      setLevels(rest); reArrange();
    } });
    // 見せ方だけ（読み直さない）
    $$("[data-look]", m).forEach((b) => { b.onclick = () => {
      const [, , , heads, suppress] = LOOKS.find((x) => x[0] === b.dataset.look);
      saveArrange({ heads, suppress }); renderGrid(); renderPager();
      $$("[data-look]", m).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }; });
    // 列と文字: 触るとすぐ一覧と見本に出す（詰め具合・余白・入り切らない字は互いの印も合わせ直す）
    const paintText = () => {
      const pad = LC.cellPad(), ov = LC.overflow();
      $("#llCellPad").value = pad; $("#llCellPadLabel").textContent = `左右 ${pad}px`;
      $$("[data-pack]", m).forEach((x) => { const pk = PACKS.find((q) => q[0] === x.dataset.pack); x.setAttribute("aria-checked", String(pk[2] === pad && pk[3] === ov)); });
      $$("[data-ov]", m).forEach((x) => x.setAttribute("aria-checked", String(x.dataset.ov === ov)));
      $("#llSample").innerHTML = sampleHtml();
      renderGrid();
    };
    $$("[data-pack]", m).forEach((b) => { b.onclick = () => { const [, , p, o] = PACKS.find((q) => q[0] === b.dataset.pack); LC.setCellPad(p); LC.setOverflow(o); paintText(); }; });
    $("#llCellPad").oninput = (e) => { LC.setCellPad(+e.target.value); paintText(); };
    $$("[data-ov]", m).forEach((b) => { b.onclick = () => { LC.setOverflow(b.dataset.ov); paintText(); }; });
    $("#llFreezeMap").addEventListener("click", (e) => {
      const b = e.target.closest("[data-freeze]"); if (!b) return;
      LC.setFreeze(+b.dataset.freeze); $("#llFreezeMap").innerHTML = freezeHtml(); renderGrid();
    });
    $("#llGap").oninput = (e) => { LC.setRowGap(+e.target.value); $("#llGapLabel").textContent = LC.GAP[+e.target.value - 1][0]; renderGrid(); };
    $("#llPageSize").onchange = (e) => { S.pageSize = +e.target.value; store.set(KEY.pageSize, S.pageSize); S.page = 1; load(); };
    $("#llSortClear")?.addEventListener("click", () => setSorts([]));
    $("#llFeatLens").onchange = (e) => { setFeature("lens", e.target.checked); renderGrid(); paintLotHint(); };
    $("#llFeatCard").onchange = (e) => { setFeature("card", e.target.checked); if (!feat.card) window.LotListCard.close(); renderPager(); };
  }
  let viewOff = null;
  function closeViewMenu(byEsc) {
    const m = $("#llViewMenu"); if (!m || m.hidden) return;
    m.hidden = true; $("#llViewBtn").setAttribute("aria-expanded", "false");
    if (viewOff) viewOff(); viewOff = null;
    if (byEsc) $("#llViewBtn").focus();
  }
  function toggleViewMenu() {
    const m = $("#llViewMenu"), b = $("#llViewBtn");
    if (!m.hidden) { closeViewMenu(); return; }
    renderViewMenu(); m.hidden = false; b.setAttribute("aria-expanded", "true");
    TPA.placeBelow(m, b, "right");
    const off = TPA.dismissable(m, closeViewMenu, { keep: b, event: "mousedown" });   // つまみ・選択欄を触るので mousedown で見る
    const fit = () => TPA.placeBelow(m, b, "right");                                    // 窓の大きさを変えたら、画面の下端に収め直す
    addEventListener("resize", fit);
    viewOff = () => { off(); removeEventListener("resize", fit); };
    requestAnimationFrame(() => $("#llGap").focus());
  }

  /* 「以内」で 0 件のとき、なぜ当たらないかを言う（サーバーが表全体で数えた dateHints）。
     いちばん新しい日付と元の値を並べるので、写しが古い・日付の読み違い（和暦の2桁の年など）・ほかの条件との重なりが見て分かる。 */
  function dateHintHtml() {
    const ymd = (s) => (s ? s.replace(/-/g, "/") : "-");
    const daysAgo = (s) => (s && S.today ? Math.round((Date.parse(S.today) - Date.parse(s)) / 86400000) : null);
    const items = (S.dateHints || []).map((h) => {
      const lab = condLabel(h), ago = daysAgo(h.newest);
      let why;
      if (!h.dated) why = `この列に日付と読める値がありません（値のある行 ${h.filled.toLocaleString()}件）。`;
      else if (h.alone > 0) why = `この条件だけなら <b>${h.alone.toLocaleString()}件</b>当たります。ほかの条件と重なって 0 件になっています。`;
      else why = `いちばん新しい日付が ${ymd(h.newest)}${ago != null ? `（今日から${ago >= 0 ? ` ${ago}日前` : ` ${-ago}日後`}）` : ""}なので、${ymd(h.cutoff)} 以降の行がありません。`;
      return `<li><b>${esc(lab)}</b>: ${why}<br><small>日付と読めた行 ${h.dated.toLocaleString()} / 値のある行 ${h.filled.toLocaleString()}・`
        + `いちばん新しい ${ymd(h.newest)}（元の値「${esc(h.newestRaw ?? "")}」）・いちばん古い ${ymd(h.oldest)}・今日 ${ymd(S.today)}・${ymd(h.cutoff)} 以降を探しました</small></li>`;
    });
    return items.length ? `<ul class="ll-datehints">${items.join("")}</ul>`
      + (S.source && S.source.at ? `<small>元データ（手元の写し）の時刻: ${hm(S.source.at)}。写しが古いときは右上の札から取り直せます。</small>` : "") : "";
  }
  /* ---- 行（ふつうの行・まとまりの中の行で同じ） ---- */
  const GROUP_HEAD_EXTRA = 64, GROUP_INDENT = 16;   // 見出し行の先頭の列に足す幅（畳むボタンと件数）・段ごとの字下げ
  /* ロット番号のボタンと、その横の虫眼鏡（row: その行。虫眼鏡が鋳造番号を持つ＝LotDsp の linkkey はロット番号と鋳造番号の組） */
  const lotButton = (raw, sub, row = null) => (raw ? `<button type="button" class="ll-lot${sub ? " is-sub" : ""}" data-lot="${esc(raw)}" title="押すと「${esc(raw)}」を転写計算へ取り込みます（転写計算の「検索」と同じ）">${esc(raw)}</button>`
    + (lensOn() ? `<button type="button" class="ll-lens" data-lens="${esc(raw)}" data-cast="${esc(castOf(row))}" title="LotDsp（ロット問い合わせ）の「${esc(window.LotDspUrl.label(lotDspTab()))}」で「${esc(raw)}」を開きます（取り込まず、画面も移りません）" aria-label="${esc(raw)} を LotDsp で開く">${LENS_ICON}</button>` : "") : "");
  const cellTd = (cell, al, extra = "", tail = "") => {
    const tip = cell.raw !== cell.text ? `${cell.text}\n元の値: ${cell.raw}` : cell.text;
    return `<td class="al-${al}${cell.color && !extra.includes("ll-rep") ? " cell-" + cell.color : ""}${extra}" title="${esc(tip)}">${esc(cell.text)}${tail}</td>`;
  };
  const blk = (d) => ` ll-blk ll-blk${Math.min(d, 2)}`;
  /* deco: 列ごとの飾り Map(列 → {cls, tail})。繰り返しを省いた値は面（ll-blk）にして字を見せない（行にマウスを乗せると薄く出る） */
  function rowHtml(cols, aligns, r, i, cells, cls, attrs = "", deco = null) {
    const lot = S.lotColumn ? String(r[S.lotColumn] ?? "") : "";
    const M = window.LotListMarks;
    // 縞（is-odd）は行の番号で決める（描く範囲が動いても、畳んだ行があっても、縞がずれない）
    const k = [cls, i % 2 ? "is-odd" : "", lot && lot.toUpperCase() === String(S.currentLot || "").toUpperCase() ? "is-current" : "", i === S.cardIdx || S.cardSet.has(i) ? "is-carded" : "", M.rowClass(r)].filter(Boolean).join(" ");
    return `<tr data-i="${i}"${k ? ` class="${k}"` : ""}${attrs}>` + cols.map((c, ci) => {
      const d = deco && deco.get(c), extra = (d ? d.cls : "") + M.cellClass(r, c), tail = d ? d.tail || "" : "";
      return c === S.lotColumn ? `<td class="ll-lotcol${extra}"${extra ? ` title="${esc(lot)}"` : ""}>${lotButton(lot, cls.includes("g-child"), r)}${tail}</td>` : cellTd(cells[ci], aligns[ci], extra, tail);
    }).join("") + "</tr>";
  }
  /* 並び・まとめの本体。サーバーは段の列の順（ロット番号の段はロットを1か所に集めて）で返すので、値が同じ行は続いている。
     ここでは続いている行を段ごとのまとまりに分ける（段 d のまとまり＝段 0〜d の値がすべて同じ、続いた行）。
     - 見出し行: 2行以上のまとまりに付ける。先頭の列に ▾・段の値・件数（段が深いほど字下げ）、ほかの列はまとまりの中で同じ値ならその値、
       違えば「n通り」を淡く。列の数は同じ（列の色・幅・固定がずれない）。畳むと、その下の行と深い段の見出しを隠す。
     - 繰り返しを省く: 段の列で、上の行（または包む見出し）と同じ値は見せない。
     - 見出しを付けないときは、まとまりの切れ目に線（上の段ほど濃い）。帯（g-alt）はいちばん上の段のまとまりごとに交互。
     まとまりはこのページの中だけで数える（ロット番号の段のほかは、ページの境目で続くことがある）。
     返すのは行の一覧（{ key, html(), i, head, anc }。描くのは見える分だけ: showRows）。畳んだかどうかは groupOpen が持ち、描くときに読む */
  function arrangedEntries(cols, aligns, cellsOf) {
    const t = layoutTarget(), LC = window.LotListColumns, A = arrange(), lv = levels(), n = lv.length, rows = S.rows, shut = collapsed();
    const keyOf = (r, c, i) => { const v = levelKey(r, c); return c === S.lotColumn && !v ? `\u0000#${i}` : v; };   // 見えている値。ロット番号が空の行はまとめない
    const paths = rows.map((r, i) => lv.map((l) => keyOf(r, l.column, i)));
    const cells = rows.map(cellsOf);
    const same = (i, j, d) => { for (let k = 0; k <= d; k++) if (paths[i][k] !== paths[j][k]) return false; return true; };
    const runEnd = (i, d) => { let j = i + 1; while (j < rows.length && same(i, j, d)) j++; return j; };
    const out = [], stack = [];
    let gid = 0, band = -1;
    groupOpen.clear();
    const headRow = (i, end, d, id, key, anc, alt) => {
      const open = groupOpen.get(id).open;
      const lc = lv[d].column, rs = rows.slice(i, end), len = end - i;
      const lvDepth = new Map(lv.map((l, k) => [l.column, k]));
      const shown = lc === S.lotColumn ? lotButton(String(rows[i][lc] ?? ""), false, rows[i])
        : `<b class="ll-gv">${esc(LC.cell(t, lc, rows[i]).text) || "（空欄）"}</b>`;
      // 段の列が表に出ていれば値だけ（列の名前は見出しにある）。隠している列でまとめているときは列の名前を添える
      // 段の名前の札（どの段の見出しか）＋値。札の色の濃さで段の深さも分かる
      const label = `<small class="ll-gk ll-gk${Math.min(d, 2)}"${cols.includes(lc) ? "" : ' title="表に出していない列でまとめています"'}>${esc(LC.label(t, lc))}</small>` + shown;
      return `<tr class="ll-ghead${alt}" data-g="${id}" data-gkey="${esc(key)}" data-depth="${d}"${anc ? ` data-anc="${anc}"` : ""} aria-expanded="${open}" style="--ind:${d}">`
        + cols.map((c, ci) => {
          if (ci === 0) return `<td class="ll-gcell${c === S.lotColumn ? " ll-lotcol" : ""}"><button type="button" class="ll-gtog" aria-label="${open ? "畳む" : "開く"}" title="このまとまりの行を${open ? "畳みます" : "開きます"}">▾</button>`
            + `${label}<span class="ll-gn" title="このまとまりの行（このページの中）">${len}件</span></td>`;
          const ld = lvDepth.get(c);
          const rep = A.suppress && ld != null && ld < d ? " ll-rep" + blk(ld) : "";     // 外側の段の値は外側の見出しにある（面にする）
          if (c === S.lotColumn) {
            const ks = new Set(rs.map(lotKey));
            return ks.size === 1 ? `<td class="ll-lotcol ll-gsame${rep}">${lotButton(String(rs[0][c] ?? ""), false, rs[0])}</td>`
              : `<td class="ll-gdiff" title="このまとまりの中で ${ks.size}通りのロットがあります">${ks.size}通り</td>`;
          }
          const texts = new Set(cells.slice(i, end).map((x) => x[ci].text));
          if (texts.size === 1) return cellTd(cells[i][ci], aligns[ci], " ll-gsame" + rep);
          return `<td class="al-${aligns[ci]} ll-gdiff" title="このまとまりの中で ${texts.size}通りの値があります（開くと1行ずつ見られます）">${texts.size}通り</td>`;
        }).join("") + "</tr>";
    };
    for (let i = 0; i < rows.length; i++) {
      while (stack.length && stack[stack.length - 1].end <= i) stack.pop();
      let d0 = 0;
      if (i > 0) { d0 = n; for (let d = 0; d < n; d++) if (paths[i][d] !== paths[i - 1][d]) { d0 = d; break; } }
      if (i === 0 || d0 === 0) band++;
      const alt = band % 2 ? " g-alt" : "";
      if (A.heads) for (let d = d0; d < n; d++) {
        const end = runEnd(i, d);
        if (end - i < 2) break;                          // 1行だけのまとまりに見出しは付けない（深い段も1行）
        const id = ++gid, key = `${d}:${paths[i].slice(0, d + 1).join("\u001f")}`;
        const ancIds = stack.map((x) => x.id), anc = ancIds.join(" "), at = i;
        groupOpen.set(id, { key, open: !shut.has(key) });
        out.push({ key: `g${id}`, i: -1, head: id, anc: ancIds, html: () => headRow(at, end, d, id, key, anc, alt) });
        stack.push({ id, end, depth: d });
      }
      const covered = stack.length ? stack[stack.length - 1].depth : -1;
      // 繰り返しを省く: 上の行・包む見出しと同じ値は面（ll-rep）。見出しが無いときは、面の始まりに値（太字）と件数
      let deco = null;
      if (A.suppress) {
        deco = new Map();
        lv.forEach((l, d) => {
          if (d <= covered || (i > 0 && same(i, i - 1, d))) deco.set(l.column, { cls: " ll-rep" + blk(d) });
          else if (!A.heads) {
            const len = runEnd(i, d) - i;
            const empty = !String(rows[i][l.column] ?? "").trim();      // 空欄のまとまりは「（空欄）」と書く（何も無い面にしない）
            deco.set(l.column, { cls: blk(d) + " ll-btop" + (empty ? " ll-bempty" : ""), tail: (empty ? '<span class="ll-bnone">（空欄）</span>' : "")
              + (len > 1 ? `<span class="ll-bn" title="この値が続く行（このページの中）">${len}件</span>` : "") });
          }
        });
      }
      const inGroup = stack.length > 0;
      const last = inGroup && stack[stack.length - 1].end === i + 1;
      const cls = (inGroup ? "g-child" : "g-one") + alt + (last ? " g-last" : "") + (!A.heads && i > 0 && d0 < n ? ` gb gb-${Math.min(d0, 2)}` : "");
      const ancIds = stack.map((x) => x.id), anc = ancIds.join(" "), at = i;
      const attrs = (anc ? ` data-anc="${anc}"` : "") + (inGroup ? ` style="--ind:${covered + 1}"` : "");
      out.push({ key: `r${i}`, i, anc: ancIds, html: () => rowHtml(cols, aligns, rows[at], at, cells[at], cls, attrs, deco) });
    }
    return out;
  }
  /* 作業でまとめた一覧（lotlist-work.js）: サーバーが同じ作業（作業開始が同じ行）を続けて返すので、2 行目からを畳む。
     先頭の行のロット番号の横に「＋n」（押すと開く・畳む）。開いた作業は覚えておく（読み直しても開いたまま） */
  const workBadgeCol = (cols) => (S.lotColumn && cols.includes(S.lotColumn) ? S.lotColumn : cols[0]);
  const workSplit = () => !!S.work && S.work.rows.some((x, i) => i > 0 && x[0] && x[0] === S.work.rows[i - 1][0]);
  function workEntries(cols, aligns, cellsOf) {
    const keys = S.work.rows.map((x) => x[0]), at = workBadgeCol(cols), out = [];
    for (let i = 0; i < S.rows.length;) {
      let j = i + 1;
      if (keys[i]) while (j < S.rows.length && keys[j] === keys[i]) j++;
      const k = keys[i], n = j - i, first = i;
      const tail = () => {        // 開いているかは描くときに読む（＋n を押すと、その行から描き直す）
        const open = S.workOpen.has(k);
        return `<button type="button" class="wk-plus" data-wk-open="${esc(k)}" aria-expanded="${open}" title="同じ作業開始（${esc(S.work.rows[first][3] || k)}）の分割したロットが、ほかに ${n - 1} 行あります（1 ロットと数えています）。押すと${open ? "畳みます" : "開きます"}">＋${n - 1}</button>`;
      };
      out.push({ key: `r${i}`, i, html: () => rowHtml(cols, aligns, S.rows[first], first, cellsOf(S.rows[first]), n > 1 ? "wk-first" : "", "", n > 1 ? new Map([[at, { cls: "", tail: tail() }]]) : null) });
      for (let x = i + 1; x < j; x++) {
        const cls = "wk-sub" + (x === j - 1 ? " wk-last" : ""), attrs = ` data-wk-of="${esc(k)}"`, me = x;
        out.push({ key: `r${x}`, i: x, wk: k, html: () => rowHtml(cols, aligns, S.rows[me], me, cellsOf(S.rows[me]), cls, attrs) });
      }
      i = j;
    }
    return out;
  }
  /* ---- 描く行（見える分＋上下に 1 ページずつだけ描く: virtual-rows.js） ----
     model: 頁の全部の行（見出し行も。{ key, html(), i, head, anc, wk }）。畳んだまとまり・閉じた作業の行は描く一覧に入れない */
  let model = [], rowsView = null, span = 1;
  const groupOpen = new Map();       // まとまりの見出しの番号 → { key, open }
  const shownEntry = (e) => !(e.anc && e.anc.some((g) => !groupOpen.get(g).open)) && !(e.wk && !S.workOpen.has(e.wk));
  /** 描く一覧を作り直す。refocus: 押したボタン（描き直すと消えるので、同じボタンにフォーカスを戻す。キーボードで続けて押せる） */
  function showRows({ keepHeights = true, refocus = "" } = {}) {
    const had = refocus && document.activeElement?.closest?.("#llBody");
    rowsView.set(model.filter(shownEntry), { keepHeights });
    if (had) $(`#llBody ${refocus}`)?.focus({ preventScroll: true });
  }
  function toggleWork(b) {
    const k = b.dataset.wkOpen;
    if (S.workOpen.has(k)) S.workOpen.delete(k); else S.workOpen.add(k);
    showRows({ refocus: `.wk-plus[data-wk-open="${CSS.escape(k)}"]` });
  }
  /** まとまり（見出しの番号 id）を開く・畳む。覚えるのは段の値（読み直しても畳んだまま） */
  function toggleGroup(id, open = !groupOpen.get(id).open) {
    const g = groupOpen.get(id), shut = collapsed();
    g.open = open;
    if (open) shut.delete(g.key); else shut.add(g.key);
    setCollapsed(shut); showRows({ refocus: `tr.ll-ghead[data-g="${id}"] .ll-gtog` });
  }
  function setAllGroups(open) {
    const shut = collapsed();
    groupOpen.forEach((g) => { g.open = open; if (open) shut.delete(g.key); else shut.add(g.key); });
    setCollapsed(shut); showRows();
  }
  /* カードで見ている行を一覧でも示す（描いている行は印だけ替え、まだ描いていない行は描くときに付く）。
     list: カードで見ている行（いくつでも）、focus: いま触ったカードの行（畳んだ所なら開き、見える所まで送る） */
  function markCarded(list, focus = -1) {
    S.cardSet = new Set((Array.isArray(list) ? list : [list]).filter((i) => i >= 0));
    S.cardIdx = focus;
    $$("#llBody tr.is-carded").forEach((tr) => tr.classList.remove("is-carded"));
    S.cardSet.forEach((i) => $(`#llBody tr[data-i="${i}"]`)?.classList.add("is-carded"));
    const e = focus >= 0 ? model.find((x) => x.i === focus) : null;
    if (!e) return;
    if (!shownEntry(e)) {                                // 畳んだまとまり・閉じた作業の中なら開く
      const shut = collapsed();
      (e.anc || []).forEach((id) => { const g = groupOpen.get(id); g.open = true; shut.delete(g.key); });
      if (e.wk) S.workOpen.add(e.wk);
      setCollapsed(shut); showRows();
    }
    rowsView.scrollTo(e.key);
    $(`#llBody tr[data-i="${focus}"]`)?.classList.add("is-carded");
  }
  function renderGrid() {
    const head = $("#llHead"), note = $("#llNote");
    if (S.src.id === "work" && !S.equip) {
      head.innerHTML = ""; model = []; showRows({ keepHeights: false });
      if (S.equips == null) { note.hidden = true; return; }
      note.innerHTML = equipEmptyHtml(); note.hidden = false; return;
    }
    if (S.error) {
      head.innerHTML = ""; model = []; showRows({ keepHeights: false });
      const canRefresh = S.src.id === "lot" || !!S.source;   // 作業実績は、まだ開けていない設備（ファイルが見つからない等）には取り直す物が無い
      note.innerHTML = `<b>${esc(S.src.title)}を読めませんでした。</b><br>${esc(S.error)}<br>`
        + `<small>元: ${esc((S.source && S.source.remote) || S.src.remoteHint)}</small><div class="ll-note-acts">`
        + (canRefresh ? '<button type="button" class="btn-primary" data-ll-refresh>共有から読み直す</button> ' : "")
        + `<button type="button"${canRefresh ? "" : ' class="btn-primary"'} data-ll-settings title="${esc(S.src.settingsTip)}">${esc(S.src.settingsLabel)}</button></div>`;
      note.hidden = false; return;
    }
    const filtered = new Set(baseFilters().concat(window.LotListSlicer.filters()).map((f) => f.column));
    const t = layoutTarget(), LC = window.LotListColumns;
    LC.setContext(columnContext());
    const all = LC.allColumns(t, S.columns);
    const cols = LC.visible(t, all, S.lotColumn), L = LC.get(t);
    const lv = levels(), A = arrange(), eff = effectiveSorts(), isGrouped = grouped(), withHeads = isGrouped && A.heads;
    const sortIdx = (c) => eff.findIndex((s) => s.column === c), lvIdx = (c) => lv.findIndex((l) => l.column === c);
    // 幅: <colgroup> に置き、表の幅は列の和（table-layout:fixed）。見出し行を付けるときは先頭の列に ▾・件数・字下げのぶんを足す
    // 見出しの印は列名の幅を取らない（下線と右下の小さな段の番号。2026-10-headers の H3）。段の番号のぶんだけ足す
    const markW = (c) => (L.widths[c] ? 0 : lvIdx(c) >= 0 ? 8 : 0);
    const tagW = withHeads ? Math.max(...lv.map((l) => TPA.textWidth(LC.label(t, l.column), '700 11.5px "Yu Gothic UI","Meiryo UI",sans-serif'))) + 16 : 0;
    const wk = workOn() && S.work && S.work.rows.length === S.rows.length ? S.work : null, badgeAt = wk && workSplit() ? workBadgeCol(cols) : "";
    const widths = cols.map((c, i) => LC.widthOf(t, c, S.rows) + markW(c) + (withHeads && i === 0 ? GROUP_HEAD_EXTRA + tagW + GROUP_INDENT * (lv.length - 1) : 0)
      + (c === badgeAt && !L.widths[c] ? 38 : 0) + (wk && c === wk.column && !L.widths[c] ? 14 : 0) + (lensOn() && c === S.lotColumn && !L.widths[c] ? LENS_W : 0));
    $("#llCols").innerHTML = cols.map((c, i) => `<col data-col="${esc(c)}" style="width:${widths[i]}px">`).join("");
    const grid = $("#llGrid");
    grid.style.width = widths.reduce((a, b) => a + b, 0) + "px";
    grid.style.setProperty("--ll-row-pad", LC.rowPad() + "px");
    grid.style.setProperty("--ll-cell-padx", LC.cellPad() + "px");
    grid.dataset.overflow = LC.overflow();
    head.innerHTML = "<tr>" + cols.map((c) => {
      const i = sortIdx(c), s = eff[i], calc = LC.isComputed(t, c), al = LC.alignOf(t, c), li = lvIdx(c);
      const first = li >= 0 && dirOf(lv[li], li) === LOT_ORDER, desc = wk && wk.order === "desc";
      /* 見出しは列名を主役に（形は 7 案＋2 回目で選んだ: program/tools/ui-proposals/2026-10-headers*.mjs・.json）。
         札（段・▲①・式・▼）は描かず、ふだんは静かな印だけ: 段＝青緑の下線と右下の小さな段の番号・並べ替え＝琥珀の下線・
         計算列＝斜体・絞り込み＝見出しの地の色。何段目か・並べ替えの順番と向き・式かは、列名に乗せたときの説明で言う */
      const sorted = wk && c === wk.column ? (desc ? "desc" : "asc") : first ? "first" : i < 0 ? "" : s.dir;
      const facts = [
        li >= 0 ? `まとめる段 ${li + 1}段目（表の見せ方・件数の行の帯で順を変えられます）` : "",
        wk && c === wk.column ? `作業でまとめています: 作業開始の${desc ? "新しい順" : "古い順"}（押すと${desc ? "古い順" : "新しい順"}）`
          : first ? "ロットを、並べ替えでそのロットのいちばん上に来る行の順に並べています"
            : i >= 0 ? `並べ替え${eff.length > 1 ? ` ${i + 1}番目` : ""}: ${s.dir === "desc" ? "▼ 大きい順" : "▲ 小さい順"}` : "",
        filtered.has(c) ? "この列で絞り込んでいます" : "",
      ].filter(Boolean);
      const tip = (calc ? `${LC.label(t, c)}（計算列・式）\n表示だけの列です。並べ替え・絞り込みは元のデータの列で行います`
        : `${LC.label(t, c)}${LC.label(t, c) !== c ? `（元: ${c}）` : ""}`)
        + (facts.length ? "\n― " + facts.join("\n― ") : "")
        + (calc ? "\nドラッグで列の入れ替え"
          : "\n" + (li >= 0 ? "まとめている列: クリックで ▲／▼ を入れ替え" : `クリックで ▲ 小さい順 → ▼ 大きい順 → 外す。Shift+クリックで並べ替えのキーを足します（段と合わせて最大${MAX_SORTS}つ）`)
            + "\nドラッグで列の入れ替え（どの列もどこへでも）・右クリックで「この列でまとめる」など");
      return `<th data-col="${esc(c)}" draggable="true" class="${c === S.lotColumn ? "ll-lotcol " : ""}${filtered.has(c) ? "col-filtered " : ""}${calc ? "is-calc " : ""}${li >= 0 ? "is-level " : ""}${sorted ? "is-sorted " : ""}al-h-${al.head}"`
        + `${li >= 0 ? ` data-lv="${li + 1}"` : ""}${sorted ? ` data-sort="${sorted}"` : ""} title="${esc(tip)}">`
        + `<i class="col-grip" aria-hidden="true">⠿</i><span class="th-in"><span>${esc(LC.label(t, c))}</span></span>`
        + `<i class="col-resize${L.locks.includes(c) ? " is-locked" : ""}" title="${L.locks.includes(c) ? "この列は幅を固定しています（列の設定で解けます）" : "ドラッグで列幅を調整（ダブルクリックで既定へ）"}"></i></th>`;
    }).join("") + "</tr>";
    const aligns = cols.map((c) => LC.alignOf(t, c).data);
    const cellsOf = (r) => cols.map((c) => (c === S.lotColumn ? null : LC.cell(t, c, r)));
    grid.classList.toggle("is-grouped", isGrouped);
    grid.classList.toggle("has-heads", withHeads);
    $("#llTintStyle").textContent = LC.tintCss(t, cols, "#llGrid") + LC.freezeCss("#llGrid", widths);
    // 行は見える分＋上下に 1 ページずつだけ描く（列の幅・固定の CSS を当ててから。描いた行の高さを測るので）
    span = cols.length;
    model = wk ? workEntries(cols, aligns, cellsOf) : isGrouped ? arrangedEntries(cols, aligns, cellsOf)
      : S.rows.map((r, i) => ({ key: `r${i}`, i, html: () => rowHtml(cols, aligns, r, i, cellsOf(r), "") }));
    showRows({ keepHeights: false });
    if (!S.rows.length) {
      const conds = condRows();
      note.innerHTML = conds.length || S.search
        ? `<b>検索・絞り込みに当たる行がありません。</b><br>いま効いているもの: ${[S.search ? `一覧を検索「${esc(S.search)}」` : ""].concat(conds.map((r) => esc(r.kind === "adhoc" ? `列で絞り込み: ${r.label}` : condLabel(r.f)))).filter(Boolean).join(" ／ ")}`
          + dateHintHtml()
          + '<div class="ll-note-acts"><button type="button" class="btn-primary" data-ll-clear-all>条件を外して全件を見る</button></div>'
        : "<b>この表に行がありません。</b>";
      note.hidden = false;
    } else note.hidden = true;
    if (!S.lotColumn && S.rows.length) {
      note.innerHTML = "<b>ロット番号の列が見つかりません</b>（ロット番号・ﾛｯﾄ番号・ロット№・LTNO のどれか）。この表からは検索できません。";
      note.hidden = false;
    }
  }
  function renderPager() {
    const [from, to] = S.range;       // まとめるとページの行数は表示件数から少しずれる（ロットを切らない）ので、サーバーの答えのまま
    const lots = grouped() && serverGroup() && S.groups ? `・${S.groupCount.toLocaleString()}ロット` : "";
    const works = workOn() && S.work && S.work.column;        // 作業でまとめている: 分割したロットを 1 と数えたロット数（行の数を添える）
    $("#llCount").textContent = works ? `全 ${S.groupCount.toLocaleString()}ロット（${S.count.toLocaleString()}行）` : `全 ${S.count.toLocaleString()}件` + lots;
    $("#llCount").title = works ? "作業開始が同じ行（幅・丈で分割したロット）を 1 ロットと数えています。（ ）は登録の行の数" : "";
    const gb = $("#llGroupBar"), heads = grouped() ? groupOpen.size : 0;
    const names = levels().map((l) => window.LotListColumns.label(layoutTarget(), l.column));
    gb.hidden = !grouped();
    // まとめているあいだ、件数の横にいつも段を出し、その場で直せるようにする（▲▼ を押して入れ替え・× で外す・＋ で足す）
    gb.innerHTML = grouped() ? '<span class="ll-gchip" title="上の段から順に並べ、値が同じ行をまとめています">まとめて表示中</span>'
      + levels().map((l, k) => `${k ? '<i class="ll-gsep" aria-hidden="true">›</i>' : ""}<span class="ll-glv"><b class="ll-glvn">${k + 1}</b>${esc(names[k])}`
        + `<button type="button" data-gdir="${esc(l.column)}" title="押すと ▲ 小さい順／▼ 大きい順 を入れ替えます">${dirOf(l, k) === LOT_ORDER ? "≡" : dirOf(l, k) === "desc" ? "▼" : "▲"}</button>`
        + `<button type="button" data-gx="${esc(l.column)}" title="この段を外します" aria-label="「${esc(names[k])}」の段を外す">×</button></span>`).join("")
      + `<button type="button" class="ll-gadd" data-gedit title="段を足す・順を変える・見せ方を変える（表の見せ方を開きます）">＋ 段・見せ方</button>`
      + (heads ? '<button type="button" data-gall="1">全部開く</button><button type="button" data-gall="0">全部畳む</button>' : "")
      + '<button type="button" data-goff title="まとめずに1行ずつ並べます">まとめない</button>' : "";
    paintSortBar();
    $("#llCardHint").hidden = !feat.card || !S.rows.length;
    paintLotHint();
    $("#llRange").textContent = S.count ? `${from.toLocaleString()}–${to.toLocaleString()}` : "0";
    $("#llPrev").disabled = S.page <= 1;
    $("#llNext").disabled = !S.count || to >= S.count;
    const tsel = $("#llTable");
    tsel.hidden = S.tables.length <= 1;
    const sig = S.tables.join("\u001f");
    if (tsel.dataset.sig !== sig) { tsel.dataset.sig = sig; tsel.innerHTML = S.tables.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join(""); }
    tsel.value = S.table;
  }
  /* 件数の行の並べ替えの札（7 案＋2 回目で選んだ: ui-proposals/2026-10-sortview* の M2）。まとめの段の札と同じ形で、その後ろに置く。
     番号はサーバーへ渡す並べ替えの順（段の後ろに続く）。▲／▼ で向きを替え、× で外す。キーの上限で効いていない分は淡く */
  function paintSortBar() {
    const bar = $("#llSortBar"), lv = new Set(levels().map((l) => l.column));
    const list = S.sorts.filter((x) => !lv.has(x.column) && (!S.columns.length || S.columns.includes(x.column)));
    bar.hidden = !list.length;
    if (!list.length) { bar.innerHTML = ""; return; }
    const eff = effectiveSorts(), t = layoutTarget();
    bar.innerHTML = `<span class="ll-skey" title="見出しを押して決めた並べ替え（▲ → ▼ → 外す）">${grouped() ? "その中の並べ替え" : "並べ替え"}</span>`
      + list.map((x, k) => {
        const n = eff.findIndex((e) => e.column === x.column), name = window.LotListColumns.label(t, x.column);
        return `${k ? '<i class="ll-gsep" aria-hidden="true">›</i>' : ""}<span class="ll-schip${n < 0 ? " is-off" : ""}"${n < 0 ? ` title="並べ替えのキーは段と合わせて${MAX_SORTS}つまでなので、効いていません"` : ""}>`
          + `<b class="ll-sn">${n < 0 ? "－" : n + 1}</b>${esc(name)}`
          + `<button type="button" data-sdir="${esc(x.column)}" title="押すと ▲ 小さい順／▼ 大きい順 を入れ替えます" aria-label="「${esc(name)}」の向きを入れ替える">${x.dir === "desc" ? "▼" : "▲"}</button>`
          + `<button type="button" data-sx="${esc(x.column)}" title="この並べ替えを外します" aria-label="「${esc(name)}」の並べ替えを外す">×</button></span>`;
      }).join("")
      + '<button type="button" class="ll-soff" data-soff title="並べ替えを全部外し、元の順に戻します">並べ替えを外す</button>';
  }
  const hm = (sec) => {
    if (!sec) return "";
    const d = new Date(sec * 1000), p = TPA.pad2;
    return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  /* 元データの古さを言葉に（36 時間 → 「1日半前」ではなく「2日前」のように丸めすぎない: 48 時間未満は時間で） */
  const ageText = (h) => (h == null ? "" : h < 48 ? `${Math.round(h)}時間前` : `${Math.floor(h / 24)}日前`);
  /* 毎日更新されるはずの元データが古いとき、一覧の上に帯で言う（何が起きていそうか・次に何をするか）。 */
  function renderStale() {
    const el = $("#llStale"), s = S.source;
    if (!el) return;
    if (!s || !s.stale) { el.hidden = true; return; }
    el.innerHTML = `<b>元データが ${ageText(s.ageHours)}から更新されていません</b>（最後の更新 ${hm(s.at)}・${Math.round(s.staleHours)}時間を過ぎると警告）。`
      + `毎日更新されるはずの元ファイルの更新が止まっている可能性があります。${S.src.staleWhat}`
      + `<small>元: ${esc(s.remote || "-")}${s.unreachable ? "（いまは共有に届きません）" : ""}。更新する側（元データを作る PC・仕組み）を確かめてください。</small>`
      + `<button type="button" data-ll-refresh>共有から取り直す</button> <button type="button" data-ll-settings title="${esc(S.src.settingsTip)}">${esc(S.src.settingsLabel)}</button>`;
    el.hidden = false;
  }
  function renderFresh() {
    const b = $("#llFresh"), s = S.source;
    b.className = "ll-fresh";
    if (!s) { b.textContent = "元データ 確認中"; return; }
    const newer = S.loadedAt && s.copiedAt && s.copiedAt > S.loadedAt + 0.5;
    renderStale();
    let text, cls = "";
    if (s.stale) { text = `元データが古い ${hm(s.at)}（${ageText(s.ageHours)}）`; cls = "is-warn"; }
    else if (!s.mirrored) { text = s.unreachable ? "共有に届きません（写しもまだありません）" : "共有から手元へ写しています（写し終えると一覧が出ます）"; cls = "is-warn"; }
    else if (newer) { text = `新しい版を取り込みました（${hm(s.at)}）・押すと表示を更新`; cls = "is-new"; }
    else if (s.unreachable) { text = `共有に届きません・前の写し（${hm(s.at)}）を表示中`; cls = "is-warn"; }
    else text = `元データ ${hm(s.at)}`;
    b.textContent = text; if (cls) b.classList.add(cls);
    b.title = [`元: ${s.remote || "-"}`, s.at ? `元データの更新: ${hm(s.at)}` : "", s.copiedAt ? `手元の写し: ${hm(s.copiedAt)} に取り込み` : "",
      s.checkedAt ? `最後に共有を確かめた: ${hm(s.checkedAt)}（${s.interval_sec}秒ごと）` : "", s.reason || "",
      newer ? "押すと、取り込んだ新しい版で一覧を出し直します。" : "押すと、共有に新しい版があるかを今すぐ確かめ、あれば取り込みます（再読込）。"].filter(Boolean).join("\n");
  }
  function paintBusy() {
    root?.classList.toggle("is-loading", S.loading);
    // まだ1行も無いまま待っているとき（初めて開いた＝共有から写している最中）は、何を待っているかを言う
    const note = $("#llNote");
    if (S.loading && !S.rows.length && !S.error && note) {
      note.innerHTML = `<b>${esc(S.src.reading)}</b><br>${esc(S.src.firstNote)}`;
      note.hidden = false;
    }
  }
  function renderAll() {
    renderEquipBar(); renderBar(); renderGrid(); renderPager(); renderFresh(); paintBusy(); window.LotListCard.refresh();
    window.LotListWork.update(S.src.id === "work" ? S.work : null);
    window.LotListMarks.paint();
  }

  async function refreshFromShare() {
    const b = $("#llFresh"); b.disabled = true; b.textContent = "共有から取り直しています…";
    try {
      const r = await fetch(`${S.src.api}/refresh?${new URLSearchParams(S.src.params())}`, { method: "POST" });
      const d = await r.json(); S.source = d.source || S.source;
    } catch (_) { /* 一覧の読み直しで理由が出る */ }
    b.disabled = false; await load();
  }
  let pollTimer = null;
  async function pollSource() {
    const me = S;
    try {
      const r = await fetch(`${S.src.api}/source?${new URLSearchParams(S.src.params())}`, { cache: "no-store" });
      if (r.ok && me === S) { S.source = await r.json(); renderFresh(); }
    } catch (_) { /* 次の周回で */ }
  }

  /* ---- 一覧の拡大（一時的: この窓のあいだだけ覚え、閉じると 100%） ----
     表に CSS の zoom を掛ける（列の幅・固定・見出しの貼り付きごと拡大する）。幅の覚えは拡大前の px のまま（lotlist-columns.js） */
  const ZOOM = { key: "tpa.lotlist.zoom.v1", stepKey: "tpa.lotlist.zoomStep.v1", min: 60, max: 200, steps: [5, 10, 20, 25], step: 10 };
  const zoomStep = () => { const s = +TPA.local.get(ZOOM.stepKey, ZOOM.step); return ZOOM.steps.includes(s) ? s : ZOOM.step; };
  /** 刻み s で動ける範囲（どの刻みでも 100% に止まるように、端を 100% から刻みで数えた所にする） */
  const zoomRange = (s) => ({ min: 100 - Math.floor((100 - ZOOM.min) / s) * s, max: 100 + Math.floor((ZOOM.max - 100) / s) * s });
  function setZoom(pct) {
    const s = zoomStep(), { min, max } = zoomRange(s);
    const z = Math.min(max, Math.max(min, 100 + Math.round(((+pct || 100) - 100) / s) * s));
    $("#llGrid").style.zoom = z === 100 ? "" : String(z / 100);
    rowsView?.reflow();                                  // 行の高さ（見た目の px）が変わるので、測り直して描く範囲を決め直す
    $("#llZoomRange").value = z; $("#llZoomValue").textContent = `${z}%`;
    $("#llZoomMinus").disabled = z <= min; $("#llZoomPlus").disabled = z >= max;
    $("#llZoomReset").hidden = z === 100; $("#llZoom").classList.toggle("is-zoomed", z !== 100);
    TPA.session.set(ZOOM.key, z);
  }
  /** 刻みを当てる: つまみの範囲・刻み・目盛り（100% は長い線）・札の字 */
  function paintZoomStep() {
    const s = zoomStep(), { min, max } = zoomRange(s), r = $("#llZoomRange");
    Object.assign(r, { min, max, step: s });
    $("#llZoomTicks").innerHTML = Array.from({ length: (max - min) / s + 1 }, (_, i) => min + i * s)
      .map((v) => `<i class="${v === 100 ? "is-100" : ""}" style="left:${(v - min) / (max - min) * 100}%"></i>`).join("");
    $("#llZoomStep").textContent = `${s}%刻み ▾`;
    $("#llZoomMinus").title = `${s}% 小さく`; $("#llZoomPlus").title = `${s}% 大きく`;
  }
  function openZoomSteps() {
    const m = $("#llZoomSteps"), b = $("#llZoomStep");
    m.innerHTML = ZOOM.steps.map((s) => `<button type="button" role="menuitemradio" aria-checked="${s === zoomStep()}" data-step="${s}">${s}%</button>`).join("");
    m.hidden = false; b.setAttribute("aria-expanded", "true");
    const close = () => { m.hidden = true; b.setAttribute("aria-expanded", "false"); };
    const off = TPA.dismissable(m, close, { keep: b });
    m.onclick = (e) => {
      const x = e.target.closest("[data-step]"); if (!x) return;
      TPA.local.set(ZOOM.stepKey, +x.dataset.step); paintZoomStep(); setZoom($("#llZoomRange").value);
      off(); close(); b.focus();
    };
    m.querySelector('[aria-checked="true"]')?.focus();
  }
  function bindZoom() {
    $("#llZoomRange").addEventListener("input", (e) => setZoom(e.target.value));
    $("#llZoomMinus").addEventListener("click", () => setZoom(+$("#llZoomRange").value - zoomStep()));
    $("#llZoomPlus").addEventListener("click", () => setZoom(+$("#llZoomRange").value + zoomStep()));
    $("#llZoomStep").addEventListener("click", () => ($("#llZoomSteps").hidden ? openZoomSteps() : $("#llZoomStep").focus()));
    $("#llZoomReset").addEventListener("click", () => { setZoom(100); $("#llZoomRange").focus(); });
    paintZoomStep();
    setZoom(TPA.session.get(ZOOM.key, 100));
  }
  function bindGrid() {
    rowsView = window.VirtualRows.create({ scroller: $(".ll-grid-wrap"), body: $("#llBody"), span: () => span, zoom: () => +($("#llGrid").style.zoom || 1) });
    bindZoom();
    window.LotListColumns.bindHeader($("#llHead"));
    $("#llHead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-col]"); if (!th || e.target.closest(".col-resize") || th.classList.contains("is-calc")) return;
      const col = th.dataset.col, i = S.sorts.findIndex((s) => s.column === col);
      if (workOn() && S.work && col === S.work.column) { window.LotListWork.toggleOrder(); return; }   // 作業開始の列: 新しい順 ⇄ 古い順
      if (levels().some((l) => l.column === col)) {        // まとめている列: その段の ▲／▼ を入れ替える（段はそのまま）
        setLevels(arrange().levels.map((l) => (l.column === col ? { ...l, dir: l.dir === "asc" ? "desc" : "asc" } : l))); load(); return;
      }
      // ▲ 小さい順 → ▼ 大きい順 → 外す（3 回目で元の順へ。以前は ▲⇄▼ を回るだけで外せなかった）。Shift は足す（その列だけを回す）
      const next = i < 0 ? "asc" : S.sorts[i].dir === "asc" ? "desc" : "";
      if (e.shiftKey) {
        if (i >= 0) { if (next) S.sorts[i] = { column: col, dir: next }; else S.sorts.splice(i, 1); }
        else if (S.sorts.length < MAX_SORTS - sortingLevels().length) S.sorts.push({ column: col, dir: "asc" });
        else { flash(`並べ替えのキーは、まとめる段と合わせて${MAX_SORTS}つまでです`); return; }
      } else S.sorts = i >= 0 && S.sorts.length === 1 ? (next ? [{ column: col, dir: next }] : []) : [{ column: col, dir: "asc" }];
      setSorts(S.sorts);
    });
    $("#llBody").addEventListener("click", (e) => {
      const w = e.target.closest(".wk-plus");
      if (w) { toggleWork(w); return; }
      const lens = e.target.closest(".ll-lens");
      if (lens) { showLot(lens); return; }
      const b = e.target.closest(".ll-lot");
      if (b) { S.currentLot = b.dataset.lot; onPick(b.dataset.lot); return; }
      const head = e.target.closest("tr.ll-ghead");     // 見出し行はどこを押しても畳む／開く
      if (head) toggleGroup(+head.dataset.g);
    });
    // 行のダブルクリック → カード（機能を使うときだけ）。ダブルクリックで字が選ばれないよう、2回目の押下は止める
    $("#llBody").addEventListener("mousedown", (e) => { if (feat.card && e.detail > 1 && e.target.closest("tr[data-i]")) e.preventDefault(); });
    $("#llBody").addEventListener("dblclick", (e) => {
      const tr = e.target.closest("tr[data-i]");
      if (feat.card && tr && !e.target.closest(".ll-lot, .ll-lens")) window.LotListCard.show(+tr.dataset.i, { another: e.ctrlKey || e.metaKey });
    });
    $("#llGroupBar").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.gall) setAllGroups(b.dataset.gall === "1");
      else if (b.hasAttribute("data-gedit")) toggleViewMenu();
      else if (b.dataset.gdir) { const c = b.dataset.gdir; setLevels(arrange().levels.map((l, k) => (l.column === c ? { ...l, dir: dirOf(l, k) === "asc" ? "desc" : "asc" } : l))); load(); }
      else if (b.dataset.gx) { setLevels(arrange().levels.filter((l) => l.column !== b.dataset.gx)); load(); }
      else if (b.hasAttribute("data-goff")) { setLevels([]); load(); }
    });
    $("#llSortBar").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.sdir) setSorts(S.sorts.map((x) => (x.column === b.dataset.sdir ? { column: x.column, dir: x.dir === "desc" ? "asc" : "desc" } : x)));
      else if (b.dataset.sx) setSorts(S.sorts.filter((x) => x.column !== b.dataset.sx));
      else if (b.hasAttribute("data-soff")) setSorts([]);
    });
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-ll-clear-all]")) { dropAllFilters({ adhoc: true }); S.search = ""; $("#llSearch").value = ""; reload(); }
      if (e.target.closest("[data-ll-refresh]")) refreshFromShare();
      if (e.target.closest("[data-ll-settings]") && window.openMasterAt) window.openMasterAt(S.src.settingsTab);
      if (e.target.closest("[data-wl-adopt]")) adoptLoose();
    });
    $("#llPrev").onclick = () => { if (S.page > 1) { S.page--; load(); } };
    $("#llNext").onclick = () => { S.page++; load(); };
    $("#llColBtn").onclick = () => { closeViewMenu(); window.LotListColumns.toggle(); };
    $("#llViewBtn").onclick = () => toggleViewMenu();
    $("#llTable").onchange = (e) => { saveActive(); S.table = e.target.value; S.ctx = null; syncContext(true); window.LotListCard.close(); window.LotListSlicer.reset(); window.LotListMarks.reset(); load(); };
    $("#llFresh").onclick = () => {
      const s = S.source, newer = S.loadedAt && s && s.copiedAt && s.copiedAt > S.loadedAt + 0.5;
      if (newer) load(); else refreshFromShare();
    };
    $("#llPresetModalClose").onclick = closePresetModal;
    TPA.layer($("#llPresetModal"), closePresetModal, { backdrop: false });
  }

  /* ================= 作業実績: 設備を選ぶ =================
     設備は登録（マスタ管理の「作業実績」）で「表示する」にした物。いま見ている設備は札が塗られる（タブと同じ見え方）。
     ファイルが見つからない設備は押せない（理由を札の説明に）。設備を替えると、その設備の覚え（条件・並び・表示列…）に入れ替わる。
     検索の字はそのまま（同じロットを設備を替えて探せる）。 */
  async function loadEquips({ fresh = false } = {}) {
    const me = STATES.work;
    try {
      const r = await fetch("/api/worklog/files" + (fresh ? "?fresh=1" : ""), { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "設備を読めませんでした");
      Object.assign(me, { equips: d.items || [], equipError: d.error || "", equipEdit: !!d.canEdit, equipFolder: d.folder || "", equipStale: d.staleHours,
        equipLoose: d.new || [] });
    } catch (e) { Object.assign(me, { equips: [], equipError: e.message }); }
    const ok = (k) => me.equips.some((x) => x.key === k && x.state !== "missing");
    if (!ok(me.equip)) {
      const first = me.equips.find((x) => x.state !== "missing");
      if (me === S) switchEquip(first ? first.key : "", { load: false }); else me.equip = first ? first.key : "";
    }
  }
  const equipOf = (k = S.equip) => (S.equips || []).find((x) => x.key === k) || null;
  function switchEquip(k, { load: reload = true } = {}) {
    if (S.src.id !== "work") return;
    if (k !== S.equip) {
      saveActive(); saveAdhocSetup();
      S.equip = k; store.set(KEY.workEquip, k);
      Object.assign(S, { table: S.src.loadTable(), tables: [], ctx: null, adhocScope: null, page: 1, rows: [], columns: [], count: 0,
        source: null, error: "", groups: null, range: [0, 0] });
      window.LotListCard.close(); window.LotListSlicer.reset(); window.LotListMarks.reset();
      if (S.table) syncContext(true);
    }
    renderAll();
    if (reload) load();
  }
  const whenText = (sec) => { if (!sec) return ""; const d = new Date(sec * 1000); return `${d.getMonth() + 1}/${TPA.pad2(d.getDate())} ${TPA.pad2(d.getHours())}:${TPA.pad2(d.getMinutes())}`; };
  function equipTip(e) {
    if (e.state === "missing") return `${e.name}: ファイル「${e.file}」が見つかりません（名前が変わったか、消されました）。\nマスタ管理の「作業実績」で結ぶファイルを選び直せます`;
    return `${e.name}（${e.now || e.file}）` + (e.mtime ? `\n最後の更新 ${whenText(e.mtime)}` : "")
      + (e.stale ? `\n${Math.round(e.ageHours)}時間、更新されていません（${S.equipStale || 36}時間を過ぎると印）` : "")
      + (e.state === "renamed" ? `\nファイルの名前が「${e.file}」から変わっています（同じファイルをたどって読みます）` : "");
  }
  function renderEquipBar() {
    const bar = $("#llEquipBar"); if (!bar) return;
    bar.hidden = S.src.id !== "work";
    if (bar.hidden) return;
    const list = S.equips;
    const manage = S.equipEdit ? '<button type="button" class="eq-manage" data-ll-settings title="作業実績のフォルダと、どの設備を表示するかを決めます（マスタ管理の「作業実績」）">設備を管理…</button>' : "";
    if (list == null) { bar.innerHTML = '<span class="eq-lab">設備</span><span class="eq-wait">設備を探しています…</span>'; return; }
    const chips = list.map((e) => `<button type="button" role="tab" class="eq-chip is-${e.state}${e.stale ? " is-stale" : ""}" data-equip="${esc(e.key)}" aria-selected="${e.key === S.equip}"`
      + ` data-when="${esc(whenText(e.mtime))}" tabindex="${e.key === S.equip ? 0 : -1}"${e.state === "missing" ? ' aria-disabled="true"' : ""} title="${esc(equipTip(e))}">`
      + `${esc(e.name)}${e.state === "missing" ? '<i class="eq-warn" aria-label="見つからない">!</i>' : ""}</button>`).join("");
    bar.innerHTML = `<span class="eq-lab" id="llEquipLab">設備</span><div class="eq-chips" role="tablist" aria-labelledby="llEquipLab">${chips || '<span class="eq-wait">表示できる設備がありません</span>'}</div>${manage}`;
  }
  /** 設備がまだ無い・選べないときの案内（一覧の場所に、理由と次にすること）。
      フォルダに登録していない実績ファイルがあり、書ける PC なら、その場で「登録して開く」（マスタ管理を開かせない） */
  function equipEmptyHtml() {
    const loose = S.equipLoose || [], adopt = S.equipEdit && loose.length > 0 && !S.equipError;
    const why = S.equipError ? esc(S.equipError)
      : S.equips && S.equips.length ? "表示できる設備のファイルが、作業実績のフォルダに見つかりません。"
        : loose.length ? `作業実績のフォルダに、まだ登録していない実績ファイルが ${loose.length} 個あります（${esc(loose.slice(0, 8).map((f) => f.equipment).join("・"))}${loose.length > 8 ? " ほか" : ""}）。`
          : "作業実績の設備がまだ登録されていません（フォルダを探すと、実績_＊＊＊.sqlite3 の ＊＊＊ を設備として並べます）。";
    const next = S.equipEdit
      ? `<div class="ll-note-acts">${adopt ? `<button type="button" class="btn-primary" data-wl-adopt>${loose.length} 台を設備として登録して開く</button> ` : ""}`
        + `<button type="button"${adopt ? "" : ' class="btn-primary"'} data-ll-settings>作業実績の設備を開く</button></div>`
      : "<small>設備の登録・表示する設備は、マスタ管理の「作業実績」で管理する人（参照先を書き換えられる人）が決めます。</small>";
    return `<b>作業実績の設備を選べません。</b><br>${why}${next}`;
  }
  /** 見つけた実績ファイルを設備として登録し（マスタ管理の「探す」と同じ）、設備の札を読み直して最初の設備を開く */
  async function adoptLoose() {
    const w = TPA.waiting({ title: "作業実績の設備を登録しています", from: S.equipFolder, now: "フォルダの実績ファイルを探し、設備として登録しています…" });
    let r = null, d = {};
    try { r = await fetch("/api/masters/worklog/scan", TPA.json("POST", {})); d = await r.json().catch(() => ({})); } catch (e) { d = { error: e.message }; }
    w.done();
    if (!r || !r.ok) { flash("登録できませんでした: " + (d.error || "")); return; }
    document.dispatchEvent(new CustomEvent("tpa:worklog-changed"));
  }
  /* まだ見ていない設備を開くとき: 共有の実績ファイルを手元へ写し終えるまで（初めては数十秒）、何を待っているかを窓で言う */
  function waitFirstCopy(me) {
    if (me.shownEquip === me.equip) return null;
    const e = equipOf(me.equip) || {};
    const from = me.equipFolder && (e.now || e.file) ? `${me.equipFolder.replace(/[\\/]+$/, "")}\\${e.now || e.file}` : "";
    return TPA.waiting({ title: "作業実績を読んでいます", subject: e.name || "", from, background: true, delay: 400,
      now: "共有の実績ファイルを手元へ写し、一覧を作っています…",
      note: "初めて開く設備は、共有のファイルを手元へ写し終えるまで待ちます（大きいファイルは数十秒）。2 回目からは手元の写しを読むので、すぐ出ます。" });
  }

  /* ================= 画面に出す・下げる =================
     一覧は窓ではなく「最初の画面」。計算画面と行き来しても、ページ・条件・並べ替えはそのまま残す
     （戻るたびに1ページ目へ戻すと、どこまで見たかを思い出させることになる）。
     「いつも適用（固定）」は、その元を開いた最初の1回に当てる（外した固定は、アプリを開き直すと戻る）。
     異常ロット一覧と作業実績は同じ画面（#lotListScreen）を使い、元（S）を入れ替える。元ごとの状態はそのまま残る。 */
  function activate({ source = "lot", currentLot } = {}) {
    const next = STATES[source] || STATES.lot;
    if (next !== S) { closeViewMenu(); S = next; window.LotListSlicer.reset(); window.LotListMarks.reset(); window.LotListPivot.sync(); }
    S.currentLot = currentLot || S.currentLot || "";
    root.dataset.source = S.src.id;
    if (!S.activated && S.table) syncContext(true);
    S.activated = true;
    renderAll();
    const me = S;
    if (S.src.id === "work" && S.equips == null) loadEquips().then(() => { if (me === S) { renderAll(); load(); } });
    else load();                  // 戻ってきたら今の写しで引き直す（ページはそのまま）
    clearInterval(pollTimer); pollTimer = setInterval(pollSource, SOURCE_POLL_MS);
  }
  function deactivate() {
    clearInterval(pollTimer); pollTimer = null;
    closePresetMenu(); closeCondMenu(); window.LotListCard.close();
    saveActive(); saveAdhocSetup();
  }
  // 参照先マスタで元ファイルなどが変わったら、その元の一覧を読み直す（サーバーは保存と同時に切り替え済み）
  document.addEventListener("tpa:settings-changed", (e) => {
    const key = String((e.detail || {}).key || "");
    if (key.startsWith("work_log.")) STATES.work.equips = null;
    if (!root || root.classList.contains("hidden") || !key.startsWith(S.src.settingsKey)) return;
    S.page = 1;
    if (S.src.id === "work") loadEquips({ fresh: true }).then(() => { renderAll(); load(); }); else load();
  });
  // マスタ管理の「作業実績」で設備の登録（表示する・しない・結ぶファイル）が変わった → 設備の札を読み直す
  document.addEventListener("tpa:worklog-changed", () => {
    STATES.work.equips = null;
    if (S.src.id === "work" && root && !root.classList.contains("hidden")) loadEquips().then(() => { renderAll(); load(); });
  });
  function bindEquipBar() {
    const bar = $("#llEquipBar"); if (!bar) return;
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-equip]");
      if (b && b.getAttribute("aria-disabled") !== "true") switchEquip(b.dataset.equip);
    });
    // 札の並びはタブと同じ: ← → で隣の設備へ（見つからない設備は飛ばす）
    bar.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const chips = $$("[data-equip]:not([aria-disabled=true])", bar), i = chips.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n = chips[(i + (e.key === "ArrowRight" ? 1 : chips.length - 1)) % chips.length];
      switchEquip(n.dataset.equip);
      $(`[data-equip="${CSS.escape(n.dataset.equip)}"]`, bar)?.focus();
    });
  }
  /** Excel に出力の「出力の条件」（一覧の出力と集計表の出力が同じ物を使う） */
  function exportConditions() {
    return [["一覧", S.src.title], [S.src.id === "work" ? "設備・表" : "表", S.src.place(S.table)],
      ["元データ", `${(S.source && S.source.remote) || "-"}${S.source && S.source.at ? `（${hm(S.source.at)} の版）` : ""}`],
      ["検索", S.search || "（なし）"],
      ...(condRows().length ? condRows().map((r) => ["条件", r.kind === "adhoc" ? `列で絞り込み: ${r.label}` : condLabel(r.f)]) : [["条件", "（なし）"]]),
      ...window.LotListSlicer.summary().map(([c, v]) => [`スライサー: ${c}`, v]),
      ...window.LotListMarks.summary(),
      ["並べ替え", effectiveSorts().map((x) => `${window.LotListColumns.label(layoutTarget(), x.column)} ${x.dir === "desc" ? "▼" : "▲"}`).join("・") || "（元の順）"],
      ...((S.src.id === "work" && window.LotListWork.exportInfo()?.conditions) || []),
      ["絞り込みに当たる件数", `${S.count.toLocaleString()} 件`]];
  }
  function mount(opts) {
    root = $("#lotListScreen");
    onPick = opts.onPick || onPick;
    onLens = opts.onLens || null;
    buildBar(); bindGrid(); bindEquipBar();
    window.LotListFormats?.mount();
    window.LotListSlicer.mount({
      table: scope, screen: () => S.src.id, columns: () => S.columns, search: () => S.search, baseFilters, keyOf: levelKeyKind,
      // 計算列（表示列で式から作った列）: 名前・式が使う元の列・元の列の値の組 → 一覧と同じ見えている値
      calcColumns: () => { const LC = window.LotListColumns, t = layoutTarget(); return LC.allColumns(t, S.columns).filter((c) => LC.isComputed(t, c)); },
      sourcesOf: (c) => window.LotListColumns.sourcesOf(layoutTarget(), c),
      calcText: (c, row) => window.LotListColumns.cell(layoutTarget(), c, row).text,
      api: () => S.src.api, params: () => S.src.params(),
      label: (c) => window.LotListColumns.label(layoutTarget(), c),
      onChange: () => { S.page = 1; load(); },
    });
    window.LotListMarks.mount({
      table: scope, columns: () => S.columns, ops: OPS, paintOps: paintOpOptions, noValue: noValueOp, colOption,
      condText: (f) => condLabel({ ...f, column: window.LotListColumns.label(layoutTarget(), f.column) }),
      onChange: () => load(), toast: (m) => flash(m),
    });
    window.LotListWork.mount({
      scope, isWork: () => S.src.id === "work", toast: (m) => flash(m),
      label: (c) => window.LotListColumns.label(layoutTarget(), c),
      reload: () => { S.page = 1; load(); },
      openMaster: (tab) => window.openMasterAt && window.openMasterAt(tab),
    });
    window.LotListExport.mount({
      pageUrl: (page, size) => S.src.api + "?" + queryString({ page, pageSize: size }),
      count: () => S.count, lotColumn: () => S.lotColumn, toast: (m) => flash(m),
      columns: () => { const LC = window.LotListColumns, t = layoutTarget(); return LC.visible(t, LC.allColumns(t, S.columns), S.lotColumn); },
      label: (c) => window.LotListColumns.label(layoutTarget(), c),
      text: (c, r) => window.LotListColumns.cell(layoutTarget(), c, r).text,
      title: () => (S.src.id === "work" ? `${equipName(S.equip)}の作業実績` : S.src.title),
      fileStem: () => `${S.src.fileStem}_${S.src.place(S.table)}`.replace(/[\\/:*?"<>|]/g, "_"),
      work: () => (S.src.id === "work" ? window.LotListWork.exportInfo() : null),
      marks: () => window.LotListMarks.exportPlan(),
      conditions: exportConditions,
    });
    window.LotListPivot.mount({
      scope, api: () => S.src.api, isWork: () => S.src.id === "work",
      base: () => { const q = new URLSearchParams(S.src.params()); if (S.table) q.set("table", S.table); return q.toString(); },
      fieldsKey: () => `${S.equip}|${S.table}|${(S.source && S.source.copiedAt) || ""}`,
      query: () => filterParams().toString(),
      label: (c) => window.LotListColumns.label(layoutTarget(), c),
      dateColumns: () => S.dateColumns,
      workParams: () => { if (S.src.id !== "work") return {}; const c = window.LotListWork.conf(); return { basis: c.basis, start: c.start }; },
      conditions: () => exportConditions().filter(([k]) => k !== "並べ替え"),
      fileStem: () => `${S.src.fileStem}_${S.src.place(S.table)}`.replace(/[\\/:*?"<>|]/g, "_"),
      toast: (m) => flash(m),
      onView: (on) => { root.classList.toggle("is-pivot", on); $("#llPivot").hidden = !on; },
    });
    window.LotListCard.mount({
      rows: () => S.rows, target: layoutTarget, lotColumn: () => S.lotColumn, lotKey,
      columns: () => window.LotListColumns.allColumns(layoutTarget(), S.columns),
      onPick: (lot) => { if (lot) { S.currentLot = lot; onPick(lot); } },
      onShow: markCarded, toast: (m) => flash(m),
    });
    // 表示列の窓・読み替えルールの「使っている列」で、対象を人の読める名前に（作業実績は設備の名前）
    window.LotListColumns.describe((t) => {
      const m = /^worklog:([^:]*):(.*)$/.exec(t);
      if (m) { const e = (STATES.work.equips || []).find((x) => x.key === m[1]); return `作業実績 ${e ? e.name : "（設備）"}・${m[2]}`; }
      return t.replace(/^lotlist:/, "");
    });
  }
  /* ================= 共有の書式（lotlist-formats.js が呼ぶ）: いまの表示ルールを取り出す・ほかの所へ当てる =================
     部品（services/display_formats.PARTS と同じ名前）: 表示列・読み替えルール・並び・まとめ・並べ替え・登録した条件・保存した見方・スライサー・列で絞り込む。
     その時だけの状態（効いている条件の値・スライサーで選んだ値・列で絞り込むの値・畳んだまとまり）は運ばない。
     当てる所（place）: {key: 範囲, target: 表示列の対象, label}。作業実績は設備ごと（その設備で最後に見た表。無ければ書式の表） */
  const isEmptyLayout = (l) => !l || Object.values(l).every((v) => (Array.isArray(v) ? !v.length : !Object.keys(v || {}).length));
  function captureFormat() {
    saveActive(); saveAdhocSetup();
    const k = scope(), LC = window.LotListColumns, LR = window.LotListRules, out = {};
    const columns = LC.layoutOf(layoutTarget());
    if (!isEmptyLayout(columns)) out.columns = columns;
    const rules = {};
    Object.values(columns.rules || {}).forEach((n) => { const r = LR.raw(n); if (r) rules[n] = r; });
    if (Object.keys(rules).length) out.rules = rules;
    const a = store.get(KEY.arrange, {})[k];
    if (a) { const { sorts: _s, ...rest } = cleanArrange(a); out.arrange = rest; }
    if (S.sorts.length) out.sorts = S.sorts.map(({ column, dir }) => ({ column, dir }));
    const ps = tablePresets().map(({ id: _id, table: _t, ...p }) => TPA.clone(p));
    if (ps.length) out.presets = ps;
    const vs = tableViews().map(({ id: _id, table: _t, ...v }) => TPA.clone(v));
    if (vs.length) out.views = vs;
    const cards = window.LotListSlicer.setupOf(k);
    if (cards.length) out.slicer = { cards };
    const marks = window.LotListMarks.setupOf(k);
    if (marks.length) out.marks = marks;
    const ad = store.get(KEY.adhoc, {})[k];
    if (ad && ad.column) out.adhoc = { column: ad.column, op: ad.op || "contains" };
    return out;
  }
  /** 当てられる所（いまの所が先頭）。作業実績は表示する設備ごと、異常ロット一覧はいまの表だけ。
      まだ開いていない設備の表は分からないので、table（書式を作った表。無ければいまの表）にする */
  function formatPlaces(table = S.table) {
    if (S.src.id !== "work") return [{ key: scope(), target: layoutTarget(), label: S.table || "（表）", here: true }];
    const tables = store.get(KEY.workTable, {});
    return (S.equips || []).filter((e) => e.visible !== false && e.state !== "missing").map((e) => {
      const t = e.key === S.equip ? S.table : (tables[e.key] || table || S.table);
      return { key: S.src.scope(t, e.key), target: S.src.target(t, e.key), label: e.name, equip: e.key, here: e.key === S.equip };
    }).sort((x, y) => (y.here - x.here));
  }
  /** 当てた所の、当てる前の表示ルール（元に戻す用）。当てるのと同じ形で持つ */
  function snapshotPlace(pl) {
    const was = { columns: window.LotListColumns.layoutOf(pl.target), arrange: store.get(KEY.arrange, {})[pl.key] || null,
      sorts: store.get(KEY.sorts, {})[pl.key] || [], presets: S.presets.filter((p) => p.table === pl.key).map((p) => TPA.clone(p)),
      views: allViews().filter((v) => v.table === pl.key).map((v) => TPA.clone(v)),
      slicer: { cards: window.LotListSlicer.setupOf(pl.key) }, marks: window.LotListMarks.setupOf(pl.key), adhoc: store.get(KEY.adhoc, {})[pl.key] || null };
    return { place: pl, was };
  }
  /** 書式 body を places へ当てる → {places, rules, undo}。書式に無い部品は、当てた所の今のまま */
  function applyFormat(body, places) {
    const LC = window.LotListColumns, LR = window.LotListRules;
    const undo = places.map(snapshotPlace);
    let rules = 0;
    Object.entries(body.rules || {}).forEach(([n, r]) => { if (LR.putRaw(n, r)) rules++; });   // ルールは名前で呼ぶので先に入れる
    const arr = store.get(KEY.arrange, {}), srt = store.get(KEY.sorts, {}), adh = store.get(KEY.adhoc, {});
    let presets = S.presets, views = allViews();
    places.forEach((pl) => {
      if (body.columns) LC.replaceLayout(pl.target, body.columns);
      if (body.arrange) { const { sorts: _s, ...a } = cleanArrange(body.arrange); arr[pl.key] = a; }
      if (body.sorts) { const x = cleanArrange({ sorts: body.sorts }).sorts; if (x.length) srt[pl.key] = x; else delete srt[pl.key]; }
      if (body.presets) {
        presets = presets.filter((p) => p.table !== pl.key).concat(body.presets.map((p, i) => ({ ...TPA.clone(p),
          id: "p" + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), table: pl.key })));
      }
      if (Array.isArray(body.views)) {
        views = views.filter((v) => v.table !== pl.key).concat(body.views.filter((v) => v && v.name).map((v) => ({ ...TPA.clone(v), id: newId("v"), table: pl.key })));
      }
      if (body.slicer) window.LotListSlicer.setSetup(pl.key, body.slicer.cards);
      if (body.marks) window.LotListMarks.setSetup(pl.key, body.marks);
      if (body.adhoc) adh[pl.key] = { column: String(body.adhoc.column || ""), op: body.adhoc.op || "contains" };
    });
    store.set(KEY.arrange, arr); store.set(KEY.sorts, srt); store.set(KEY.adhoc, adh);
    if (body.presets) savePresets(presets.slice(0, 400));
    if (Array.isArray(body.views)) saveViews(views);
    afterFormat(places);
    return { places: places.length, rules, undo };
  }
  /** 元に戻す: 当てる前の表示ルールへ（applyFormat の undo をそのまま） */
  function undoFormat(undo) {
    const LC = window.LotListColumns, arr = store.get(KEY.arrange, {}), srt = store.get(KEY.sorts, {}), adh = store.get(KEY.adhoc, {});
    let presets = S.presets, views = allViews();
    undo.forEach(({ place: pl, was }) => {
      LC.replaceLayout(pl.target, was.columns);
      if (was.arrange) arr[pl.key] = was.arrange; else delete arr[pl.key];
      if (was.sorts.length) srt[pl.key] = was.sorts; else delete srt[pl.key];
      if (was.adhoc) adh[pl.key] = was.adhoc; else delete adh[pl.key];
      presets = presets.filter((p) => p.table !== pl.key).concat(was.presets);
      views = views.filter((v) => v.table !== pl.key).concat(was.views || []);
      window.LotListSlicer.setSetup(pl.key, was.slicer.cards);
      window.LotListMarks.setSetup(pl.key, was.marks || []);
    });
    store.set(KEY.arrange, arr); store.set(KEY.sorts, srt); store.set(KEY.adhoc, adh);
    savePresets(presets); saveViews(views);
    afterFormat(undo.map((u) => u.place));
  }
  /** いまの所に当たったら、覚えを読み直して引き直す（ほかの所は、その設備を開いたときに効く） */
  function afterFormat(places) {
    if (!places.some((pl) => pl.key === scope())) return;
    S.adhocScope = null; syncContext(true);
    if (!$("#llViewMenu").hidden) renderViewMenu();
    load();
  }

  window.LotList = { mount, activate, deactivate, focus: () => $("#llSearch")?.focus(), source: () => S.src.id,
    formats: { capture: captureFormat, places: formatPlaces, apply: applyFormat, undo: undoFormat,
      here: () => ({ source: S.src.id, table: S.table, origin: S.src.place(S.table), equip: S.equip, title: S.src.title }) } };
})();
