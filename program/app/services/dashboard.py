# -*- coding: utf-8 -*-
"""ダッシュボードの数（版 3.36.0。利用者の要望: 設備別の仕掛ロット数・前日〈現場歴〉の設備別〈日＋直〉の実績本数。集計対象のロットは条件で決める）。

仕掛ロット数
    データ元の役割「仕掛」の元（data_sources.py。既定は 仕掛 LOTNOW.sqlite3）を、条件（一覧と同じ形の filters・検索）で絞り、
    設備の列（既定 残仕掛設備ｺｰｽ）の値から設備を見分けて（EquipmentMatcher。前方一致なら「CR1 L-1 LS3」の先頭 CR1）、
    設備ごとにロット番号の重なりを除いた数を数える。設備の列が空の行は「設備なし」に数える。

前日の実績本数
    作業実績（設備ごとのファイル）を設備ごとに、条件で絞り、作業でまとめて（work_summary.summarize。作業開始が同じ行は 1 本）、
    現場歴（basis=work。勤務体系の日付補正）の「前日」の直ごとの本数を数える。前日は、いまの時刻を同じ勤務体系で現場歴の日にして、その 1 日前。
    勤務体系は設備ごと（shifts.pattern_for: 設備を書いた体系 → 全設備共通）。

条件（全員で 1 つ。管理のマスタ dashboard_settings。行: {id, キー, 条件, 備考}。キーは wip / work、条件は JSON {filters, search}）
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from .data_sources import EquipmentMatcher
from .lot_list import columns, lot_column, pick_table, raw_columns, search_filter_where, tables
from .shifts import Clock
from .sqlite_ro import connect_ro, qi
from .work_summary import start_column, summarize, time_column

NAME = "dashboard_settings"
FIELDS = ["キー", "条件", "備考"]
PANELS = ("wip", "work")
MAX_FILTERS = 20


def clean_condition(raw):
    """画面から来た条件 → 置く形の JSON 字（{filters: [...], search: ""}）。合わなければ ValueError。"""
    d = raw if isinstance(raw, dict) else json.loads(raw or "{}")
    filters = d.get("filters") or []
    if not isinstance(filters, list) or len(filters) > MAX_FILTERS:
        raise ValueError(f"条件は {MAX_FILTERS} 個までの並びで入れてください。")
    keep = []
    for f in filters:
        if not isinstance(f, dict) or not str(f.get("column") or "").strip() or not str(f.get("op") or "").strip():
            raise ValueError("条件には列と比べ方が要ります。")
        keep.append({"column": str(f["column"]).strip(), "op": str(f["op"]).strip(), "value": "" if f.get("value") is None else str(f["value"])})
    return json.dumps({"filters": keep, "search": str(d.get("search") or "").strip()[:200]}, ensure_ascii=False)


def condition_of(rows, key):
    """マスタの行から、そのパネルの条件 {filters, search}（行が無い・壊れていれば条件なし）。"""
    row = next((r for r in rows or [] if str(r.get("キー") or "") == key), None)
    try:
        d = json.loads((row or {}).get("条件") or "{}")
    except (TypeError, ValueError):
        d = {}
    return {"filters": d.get("filters") or [], "search": d.get("search") or "", "rev": (row or {}).get("rev") or 0,
            "updated_at": (row or {}).get("updated_at"), "updated_by": (row or {}).get("updated_by")}


def _where(c, t, cond, today):
    cs = columns(c, t, raw_columns(c, t))
    parts, params = search_filter_where(cs, cond.get("search", ""), json.dumps(cond.get("filters") or [], ensure_ascii=False), today)
    return cs, (" WHERE " + " AND ".join(parts)) if parts else "", params


def wip_by_equipment(path, *, table="", candidates=(), equip_column="", equip_mode="前方一致", names=(), cond=None, today=None):
    """仕掛を設備ごとに数える → {table, equipColumn, lotColumn, items: [{equipment, lots}], total, noEquipment, rows}。
    items は数の多い順（同じなら名前の順）。設備の列が無い・空なら、全部を「設備なし」に数える。"""
    cond = cond or {}
    with connect_ro(path) as c:
        t = pick_table(tables(c), table, list(candidates))
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        cs, where, params = _where(c, t, cond, today)
        lot = lot_column(cs)
        col = equip_column if equip_column in cs else ""
        sel = ", ".join(qi(x) for x in (col, lot) if x) or "1"
        data = c.execute(f"SELECT {sel} FROM {qi(t)}{where}", params).fetchall()
    match = EquipmentMatcher(names, equip_mode)
    lots, none = {}, set()
    for r in data:
        eq = match(r[0]) if col else ""
        key = r[-1] if lot else id(r)
        key = str(key or "").strip().upper() or id(r)
        (lots.setdefault(eq, set()) if eq else none).add(key)
    items = sorted(({"equipment": k, "lots": len(v)} for k, v in lots.items()), key=lambda x: (-x["lots"], x["equipment"]))
    total = len(set().union(*lots.values(), none)) if lots or none else 0
    return {"table": t, "equipColumn": col, "lotColumn": lot, "items": items, "total": total, "noEquipment": len(none), "rows": len(data),
            "missingColumn": equip_column if equip_column and not col else "", "columns": cs}


def work_day_of(now, segments, basis="work"):
    """いまの時刻を、その勤務体系で現場歴の日にする（'YYYY-MM-DD'）。前日はその 1 日前。"""
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    day, _ = Clock(segments).place(stamp, basis)
    return day or now.date().isoformat()


def yesterday_of(now, segments, basis="work"):
    return (date.fromisoformat(work_day_of(now, segments, basis)) - timedelta(days=1)).isoformat()


def works_on(path, *, day, segments, table="", candidates=(), start="", basis="work", cond=None, today=None):
    """作業実績の 1 設備の、その日（現場歴）の直ごとの本数（作業の数。分割したロットは 1 本）。
    → {table, startColumn, shifts: [{index, name, works, rows}], total: {works, rows}, outside, noTime}"""
    cond = cond or {}
    clock = Clock(segments)
    with connect_ro(path) as c:
        t = pick_table(tables(c), table, list(candidates))
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        cs, where, params = _where(c, t, cond, today)
        col = start_column(cs, start)
        if not col:
            return {"table": t, "startColumn": "", "shifts": [], "total": {"works": 0, "rows": 0}, "outside": 0, "noTime": 0,
                    "error": "作業開始の列が見つかりません。", "columns": cs}
        tc = time_column(cs, col)
        pairs = c.execute(f"SELECT {qi(col)}, {qi(tc) if tc else 'NULL'} FROM {qi(t)}{where}", params).fetchall()
    s = summarize(pairs, clock, basis)
    mine = [b for b in s["buckets"] if b["day"] == day]
    names = [seg["name"] for seg in clock.segments]
    by = {b["shift"]: b for b in mine}
    shifts = [{"index": i, "name": n, "works": by.get(i, {}).get("works", 0), "rows": by.get(i, {}).get("rows", 0)} for i, n in enumerate(names)]
    outside = sum(b["works"] for b in mine if b["shift"] is not None and b["shift"] < 0)
    return {"table": t, "startColumn": col, "shifts": shifts, "total": {"works": sum(b["works"] for b in mine), "rows": sum(b["rows"] for b in mine)},
            "outside": outside, "columns": cs}


def now_local():
    return datetime.now()
