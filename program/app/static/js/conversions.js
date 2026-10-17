"use strict";
/* =========================================================================
   変換表（版 3.42.0。マスタ「変換表」: コードの読み替え・判定表。services/conversions.py）
   - 表を式の conv に渡す（WL.formula.setTables）。最初の表は画面に埋めた物（TPA_CONVERSIONS。読み込みを待たない）、
     マスタで直したら take で渡し直し、一覧を描き直す
   - 一覧の列に当てる計画（plan）: 表ごとに、入力に当てる列を一覧の列から探し（半角・全角の違いは見ない）、
       replace … 入力の列の値を作り替える（その列の式を conv('表', [列]) に）
       add     … 列を足す（名前は当て方の column。{列} は入力の列の名前。置き場は left・after・end）
     入力に合う列が無くても、同じ名前の変換表があれば、その表の conv を中に書いて使う（管理分類の 形状区分 など。1 段まで）
   - plan・formulaFor は DOM を使わない（評価関数 program/tools/conv-plan-check.mjs が node で確かめる）
   ========================================================================= */
(function (root) {
  let items = [], byName = new Map(), revision = null;
  const listeners = new Set();

  function take(d) {
    if (!d || !Array.isArray(d.items)) return;
    items = d.items;
    byName = new Map(items.map((x) => [x.name, x]));
    revision = d.revision ?? null;
    if (root.WL && root.WL.formula) root.WL.formula.setTables((n) => { const x = byName.get(n); return x ? { inputs: x.inputs, rows: x.rows, other: x.other } : null; });
    listeners.forEach((fn) => { try { fn(); } catch (_) { /* 描き直しの失敗で、ほかの描き直しを止めない */ } });
  }
  async function refresh() {
    const r = await fetch("/api/masters/conversions", { cache: "no-store" });
    const d = await r.json();
    if (r.ok && d.revision !== revision) take(d);
    return d;
  }

  /* ---------------- 当てる計画 ---------------- */
  const norm = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  /** 候補の名前 → 一覧の列のうち最初に当たる物（候補の順が先。同じ名前 → 半角・全角の違いを見ない）。services/conversions.py の match_column と同じ */
  function matchColumn(cands, columns) {
    for (const c of cands || []) if (columns.includes(c)) return c;
    const by = new Map();
    columns.forEach((c) => { if (!by.has(norm(c))) by.set(norm(c), c); });
    for (const c of cands || []) { const hit = by.get(norm(c)); if (hit) return hit; }
    return "";
  }
  /** 候補に当たる一覧の列ぜんぶ（{列} の当て方: 設備の列ごとに課名など） */
  function matchAll(cands, columns) {
    const want = new Set((cands || []).map(norm));
    return columns.filter((c) => want.has(norm(c)));
  }
  const quote = (v) => (!String(v).includes("'") ? `'${v}'` : `"${v}"`);
  /** 表 x の入力に一覧の列を当てた式（足りなければ null）。first: 1 つ目の入力に決めた列を使う */
  function formulaFor(x, columns, first = "", depth = 0) {
    const args = [];
    for (let i = 0; i < x.inputs.length; i++) {
      const inp = x.inputs[i], col = i === 0 && first ? first : matchColumn(inp.columns || [inp.name], columns);
      if (col) { args.push(`[${col}]`); continue; }
      const sub = depth < 1 && byName.get(inp.name);
      const f = sub && sub !== x ? formulaFor(sub, columns, "", depth + 1) : null;
      if (!f) return null;
      args.push(f);
    }
    return `conv(${quote(x.name)}, ${args.join(", ")})`;
  }
  /** 入力ごとに、当てる列（無ければ変換表・無ければ空） */
  function inputsOf(x, columns, first = "") {
    return x.inputs.map((inp, i) => {
      const col = i === 0 && first ? first : matchColumn(inp.columns || [inp.name], columns);
      if (col) return { name: inp.name, column: col };
      const sub = byName.get(inp.name);
      return { name: inp.name, column: "", table: sub && sub !== x && formulaFor(sub, columns, "", 1) ? sub.name : "" };
    });
  }
  /**
   * 表 name を一覧（columns・いまの式 formulas）に当てる計画。
   * → {name, mode, ok, targets:[{column, formula, add, place, after}], inputs:[{name, column, table}], missing:[入力の名前], done}
   *   done は、もう同じ式が当たっている（当てなくてよい）
   */
  function plan(name, columns, formulas = {}) {
    const x = byName.get(name);
    if (!x) return { name, ok: false, targets: [], inputs: [], missing: [], done: false, gone: true };
    const a = x.apply || {}, mode = a.mode === "replace" ? "replace" : "add", targets = [];
    const firstCols = (a.column || "").includes("{列}") || mode === "replace"
      ? (mode === "replace" ? [matchColumn(x.inputs[0].columns || [x.inputs[0].name], columns)].filter(Boolean) : matchAll(x.inputs[0].columns || [x.inputs[0].name], columns))
      : [""];
    for (const fc of firstCols) {
      const f = formulaFor(x, columns, fc);
      if (!f) continue;
      if (mode === "replace") targets.push({ column: fc, formula: f, add: false });
      else {
        const col = String(a.column || x.name).split("{列}").join(fc).slice(0, 60);
        targets.push({ column: col, formula: f, add: true, place: a.place || "end", after: fc });
      }
    }
    const ins = inputsOf(x, columns, firstCols[0] || "");
    const missing = ins.filter((i) => !i.column && !i.table).map((i) => i.name);
    const ok = targets.length > 0;
    return { name, mode, ok, targets, inputs: ins, missing: ok ? [] : missing, done: ok && targets.every((tg) => formulas[tg.column] === tg.formula) };
  }
  /** いくつかの表を順に計画する（先に足す列を、後の表が入力に使う: 形状区分を足してから管理分類が [形状区分] を読む） */
  function planAll(names, columns, formulas = {}) {
    let cols = columns.slice();
    return names.map((n) => {
      const p = plan(n, cols, formulas);
      if (p.ok) cols = cols.concat(p.targets.filter((tg) => !cols.includes(tg.column)).map((tg) => tg.column));
      return p;
    });
  }
  /** 計画を表示列の設定に当てた形（formulas・order）。新しく足す列は置き場の決まりで並びに入れる。order は ordered() の答え（いまの並び） */
  function applyTo(plans, { formulas = {}, order = [] } = {}) {
    const F = { ...formulas }, O = order.slice();
    plans.filter((p) => p.ok).forEach((p) => p.targets.forEach((tg) => {
      F[tg.column] = tg.formula;
      if (O.includes(tg.column)) return;          // もう並んでいる列（作り替える列・当て直し）は置いた場所のまま
      if (tg.place === "left") O.unshift(tg.column);
      else if (tg.place === "after" && O.includes(tg.after)) O.splice(O.indexOf(tg.after) + 1, 0, tg.column);
      else O.push(tg.column);
    }));
    return { formulas: F, order: O };
  }
  /** 表の中身の短い説明（カードの 2 行目）: コードの読み替えは「0 → 0:一般・2 → 2:再手配 …」、判定表は出す値の並び */
  function summary(x) {
    const outs = x.rows.map((r) => (String(r.out).startsWith("=") ? "（式）" : r.out === "" ? "空欄" : r.out));
    if (x.apply && x.apply.mode === "replace") {
      const pairs = x.rows.slice(0, 3).map((r, i) => `${((Object.values(r.when)[0] || [])[0] || {}).v?.[0] ?? ""} → ${outs[i]}`);
      return pairs.join("・") + (x.rows.length > 3 ? ` …（${x.rows.length}）` : "");
    }
    const uniq = [...new Set(outs)];
    return uniq.slice(0, 4).join("・") + (uniq.length > 4 ? ` …（${x.rows.length} 行）` : `（${x.rows.length} 行）`);
  }

  if (root.TPA_CONVERSIONS) take(root.TPA_CONVERSIONS);
  root.Conversions = { take, refresh, items: () => items, get: (n) => byName.get(n) || null, revision: () => revision,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    plan, planAll, applyTo, formulaFor, matchColumn, summary };
})(typeof window !== "undefined" ? window : globalThis);
