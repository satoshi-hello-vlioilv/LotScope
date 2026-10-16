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
import re
from datetime import date, datetime, timedelta

from . import pivot_presets
from .data_sources import EquipmentMatcher, is_screen_source
from .pivot import PERIODS
from .lot_list import columns, lot_column, pick_table, raw_columns, search_filter_where, tables
from .shifts import Clock
from .sqlite_ro import connect_ro, qi
from .work_summary import start_column, summarize, time_column

NAME = "dashboard_settings"
FIELDS = ["キー", "条件", "備考"]
PANELS = ("wip", "work")
MAX_FILTERS = 20
PERIODS_KEYS = tuple(PERIODS)


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


# ================================================================== ダッシュボードの組み（版 3.37.0）
# 利用者の要望: グリッドにパネルを置き、大きさを変え、パネルごとにデータ・条件・グラフや表を組む（Power BI のように）。
# 1 つのダッシュボード＝{rows: グリッドの段の数, panels: [パネル]}。横はいつも GRID_COLS（12）列。段の高さは窓の高さを段の数で割る
# （画面はスクロールしない。どの大きさの窓でも全部のパネルが見える）。
# パネル: {id, x, y, w, h, title, visual, source, equip, body, filters, search, period, sort, top, basis}
#   visual … グラフの形（pivot_presets.CHARTS。none は表だけ）・kpi（大きな数）・board（設備ごとの仕掛と前日の実績の 1 枚の表。版 3.36.0 の物）
#   source … lot・work・src:<キー>（データ元）。equip … 作業実績の設備のキー（空はすべての設備）
#   body   … 集計の組み方（行・列・値。集計表と同じ形。kpi は行が無くてよい）
#   filters・search … 数える行の条件（一覧と同じ形）。period … 期間（pivot.PERIODS）
#   sort   … 行の並べ方（""＝決まった順・desc＝値の大きい順・asc＝小さい順）。top … 上位いくつ（0＝パネルの大きさに合わせる）
#   basis  … 作業日の数え方（work＝現場歴・cal＝太陽暦）
#   emph   … 目立たせる（最初に見る数。淡い藍の地と藍の枠。2026-10-grid の 3 回目で決めた L）
# 置き場: マスタ dashboards（集計表の組み方のプリセットと同じ列・同じ決まり: 共通デフォルト・共通・ID・標準。元はいつも "dash"）。
LAYOUT_NAME = "dashboards"
LAYOUT_SOURCE = "dash"
GRID_COLS = 12
ROWS_MIN, ROWS_MAX, ROWS_DEFAULT = 4, 16, 8
MAX_PANELS = 24
EXTRA_VISUALS = ("kpi", "board")
SORTS = ("", "desc", "asc")
TOP_MAX = 60
_ID = re.compile(r"[A-Za-z0-9_-]{1,16}")


class LayoutError(pivot_presets.PresetError):
    pass


def _int(v, lo, hi, default):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _filters(v):
    out = []
    for f in (v if isinstance(v, list) else [])[:MAX_FILTERS]:
        if isinstance(f, dict) and str(f.get("column") or "").strip() and str(f.get("op") or "").strip():
            out.append({"column": str(f["column"]).strip()[:200], "op": str(f["op"]).strip()[:20], "value": "" if f.get("value") is None else str(f["value"])[:400]})
    return out


def _period(v):
    if not isinstance(v, dict) or v.get("kind") not in PERIODS_KEYS or not str(v.get("column") or "").strip():
        return None
    return {"column": str(v["column"]).strip()[:200], "kind": v["kind"], "n": _int(v.get("n"), 1, 3660, 7)}


def clean_panel(p, i, rows):
    """画面から来たパネル → 置く形（知らない物は外す・大きさはグリッドに収める）。合わなければ LayoutError"""
    if not isinstance(p, dict):
        raise LayoutError("パネルの形が違います。")
    pid = str(p.get("id") or "")
    pid = pid if _ID.fullmatch(pid) else f"p{i + 1}"
    w, h = _int(p.get("w"), 1, GRID_COLS, 4), _int(p.get("h"), 1, rows, 2)
    out = {"id": pid, "x": _int(p.get("x"), 0, GRID_COLS - w, 0), "y": _int(p.get("y"), 0, rows - h, 0), "w": w, "h": h,
           "title": str(p.get("title") or "").strip()[:60]}
    visual = p.get("visual") if p.get("visual") in pivot_presets.CHARTS + EXTRA_VISUALS else "column"
    out["visual"] = visual
    out["emph"] = bool(p.get("emph"))
    if visual == "board":
        return out
    src = str(p.get("source") or "")
    if not is_screen_source(src):
        raise LayoutError(f"パネル「{out['title'] or pid}」のデータ（lot・work・src:<キー>）が違います。")
    body = p.get("body") if isinstance(p.get("body"), dict) else {}
    ms = []
    for m in (body.get("measures") if isinstance(body.get("measures"), list) else [])[:4]:
        if isinstance(m, dict) and m.get("agg") in ("count", "lots", "sum", "avg", "min", "max"):
            ms.append({"agg": m["agg"]} if m["agg"] in ("count", "lots") else {"agg": m["agg"], "column": str(m.get("column") or "")[:200]})
    out.update(source=src, equip=str(p.get("equip") or "")[:40],
               # 段は集計表の組み方と同じ形（pivot_presets._dims）
               body={"rows": pivot_presets._dims(body.get("rows")), "cols": pivot_presets._dims(body.get("cols")), "measures": ms or [{"agg": "lots"}],
                     "sub": False, "grand": bool(body.get("grand", visual in ("none", "kpi"))), "chartAt": _int(body.get("chartAt"), 0, 3, 0),
                     "labels": bool(body.get("labels", True))},
               filters=_filters(p.get("filters")), search=str(p.get("search") or "").strip()[:200], period=_period(p.get("period")),
               sort=p.get("sort") if p.get("sort") in SORTS else "", top=_int(p.get("top"), 0, TOP_MAX, 0),
               basis="cal" if p.get("basis") == "cal" else "work")
    if visual not in ("kpi", "none") and not out["body"]["rows"]:
        raise LayoutError(f"パネル「{out['title'] or pid}」は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。")
    return out


def overlaps(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def clean_layout(body):
    """ダッシュボードの中身（dict か JSON 字）→ (dict, JSON 字)。パネルが重なる・多すぎる・大きすぎれば LayoutError"""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise LayoutError("中身の形が違います。") from e
    if not isinstance(body, dict):
        raise LayoutError("中身の形が違います。")
    rows = _int(body.get("rows"), ROWS_MIN, ROWS_MAX, ROWS_DEFAULT)
    raw = body.get("panels") if isinstance(body.get("panels"), list) else []
    if len(raw) > MAX_PANELS:
        raise LayoutError(f"パネルは {MAX_PANELS} 枚までです。")
    panels, ids = [], set()
    for i, p in enumerate(raw):
        x = clean_panel(p, i, rows)
        while x["id"] in ids:
            x["id"] = f"p{len(ids) + i + 2}"
        ids.add(x["id"])
        hit = next((q for q in panels if overlaps(q, x)), None)
        if hit:
            raise LayoutError(f"パネル「{x['title'] or x['id']}」と「{hit['title'] or hit['id']}」が重なっています。")
        panels.append(x)
    out = {"rows": rows, "panels": panels}
    text = json.dumps(out, ensure_ascii=False, sort_keys=True)
    if len(text.encode("utf-8")) > pivot_presets.MAX_BYTES * 2:
        raise LayoutError("ダッシュボードが大きすぎます。")
    return out, text


def clean_layout_row(data, login, partial=False):
    """画面から来た値 → マスタ dashboards の行（集計表の組み方と同じ列・決まり。中身だけダッシュボードの形）"""
    try:
        return pivot_presets.clean_row({**(data or {}), "source": LAYOUT_SOURCE}, login, partial,
                                       body_text=lambda b: clean_layout(b)[1], source_ok=lambda s: s == LAYOUT_SOURCE)
    except pivot_presets.PresetError as e:
        raise LayoutError(str(e)) from None


def layout_view(row, login="", common_ok=False, default_ok=False):
    """マスタの行 → 画面の形（中身が壊れていれば panels は空）"""
    v = pivot_presets.view(row, login, common_ok, default_ok, body_of=lambda t: clean_layout(t)[0])
    return v if v["body"] else {**v, "body": {"rows": ROWS_DEFAULT, "panels": []}}


# ---------------------------------------------------------------- 組み込みの標準（共通デフォルト。開発者がコードに書く）
# 要望（2026-10）: 最初の画面。仕掛区分ごと・設備ごとの仕掛ロット数と、前日（現場歴）の設備×直の実績本数をスクロールせずに見る。
# 仕掛区分の列の名前は本物の LOTNOW.sqlite3 で確かめていない（WIP_CLASS_COLUMN）。無ければパネルが「列がありません」と言い、パネルを直す所で選び直せる。
WIP_CLASS_COLUMN = "仕掛区分"


def _pv(pid, x, y, w, h, title, visual, source, rows=(), cols=(), measures=({"agg": "lots"},), **kw):
    return {"id": pid, "x": x, "y": y, "w": w, "h": h, "title": title, "visual": visual, "source": source,
            "body": {"rows": list(rows), "cols": list(cols), "measures": list(measures), "grand": visual in ("none", "kpi"), "labels": True}, **kw}


YESTERDAY = {"column": "@workday", "kind": "yesterday"}
# 並び（2026-10-grid の 2 回目で 1 位の J＋3 回目）: 上 1 段に数字 3 つ → 左にグラフ 2 つ（仕掛区分・直近 14 日）・右に縦長の 1 枚の表。
# 設備ごとの仕掛ロット数は 1 枚の表の棒と同じ数なので、別のグラフにはしない（同じ数を 2 回見せない）
BUILTIN_LAYOUTS = [
    {"key": "standard", "name": "標準", "body": {"rows": 8, "panels": [
        _pv("wipTotal", 0, 0, 4, 1, "仕掛ロット数", "kpi", "src:wip", emph=True),
        _pv("workTotal", 4, 0, 4, 1, "前日の実績本数", "kpi", "work", period=YESTERDAY),
        _pv("workMonth", 8, 0, 4, 1, "今月の実績本数", "kpi", "work", period={"column": "@workday", "kind": "this_month"}),
        _pv("wipClass", 0, 1, 5, 4, "仕掛区分ごとの仕掛ロット数", "bar", "src:wip", rows=[{"column": WIP_CLASS_COLUMN}], sort="desc"),
        _pv("workDays", 0, 5, 5, 3, "直近 14 日の実績本数", "time", "work", rows=[{"column": "@workday"}],
            period={"column": "@workday", "kind": "days", "n": 14}),
        {"id": "board", "x": 5, "y": 1, "w": 7, "h": 7, "title": "設備ごとの仕掛と前日の実績", "visual": "board"},
    ]}},
]


def builtin_layouts():
    """組み込みのダッシュボード → 画面の形（id は "b:鍵"。書き換えられない）"""
    return [{"id": f"b:{b['key']}", "name": b["name"], "source": LAYOUT_SOURCE, "scope": "default", "login": "", "standard": False,
             "body": clean_layout(b["body"])[0], "note": "", "rev": 0, "updatedAt": "", "updatedBy": {}, "canEdit": False, "builtin": True}
            for b in BUILTIN_LAYOUTS]
