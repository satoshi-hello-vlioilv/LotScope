# -*- coding: utf-8 -*-
"""ダッシュボード（版 3.36.0〜。3.37.0 からグリッドのパネル。3.38.0 で「合わせた表」）。

パネルの数は、どの形もサーバーの集計 1 か所（services/pivot.py の query_many）で数える（routes/dashboard.py の /api/dashboard/query）。
ここはダッシュボードの組み（グリッド・パネル）の決まりと、組み込みの標準。

版 3.36.0〜3.37.0 の「設備ごとの仕掛と前日の実績」（1 枚の表）は、専用の数え方と全員で 1 つの集計対象の条件（マスタ dashboard_settings）を
持っていた。版 3.38.0 で、汎用の「合わせた表」（visual board。行の段＝設備を共通にして、列のまとまりを横に並べる）の 1 つにした
（利用者の要望 2026-10: 設備の並びやデザインを変えられるように・ダッシュボードの汎用の仕組みの中で動かせるように）。
前の版の集計対象の条件は、その表の列のまとまりの条件へ引き継ぐ（board_default・condition_of。マスタは読むだけ）。
"""
from __future__ import annotations

import json
import re

from . import pivot_presets
from .data_sources import is_screen_source
from .formula import MAX_LEN
from .pivot import PERIODS

NAME = "dashboard_settings"           # 版 3.36.0 の集計対象の条件（読むだけ。合わせた表へ引き継ぐ）
FIELDS = ["キー", "条件", "備考"]
MAX_FILTERS = 20
PERIODS_KEYS = tuple(PERIODS)


def condition_of(rows, key):
    """マスタの行から、版 3.36.0 の 1 枚の表の条件 {filters, search}（キーは wip / work。行が無い・壊れていれば条件なし）"""
    row = next((r for r in rows or [] if str(r.get("キー") or "") == key), None)
    try:
        d = json.loads((row or {}).get("条件") or "{}")
    except (TypeError, ValueError):
        d = {}
    return {"filters": _filters(d.get("filters")), "search": str(d.get("search") or "").strip()[:200]}


# ================================================================== ダッシュボードの組み（版 3.37.0）
# 利用者の要望: グリッドにパネルを置き、大きさを変え、パネルごとにデータ・条件・グラフや表を組む（Power BI のように）。
# 1 つのダッシュボード＝{rows: グリッドの段の数, panels: [パネル]}。横はいつも GRID_COLS（12）列。段の高さは窓の高さを段の数で割る
# （画面はスクロールしない。どの大きさの窓でも全部のパネルが見える）。
# パネル: {id, x, y, w, h, title, visual, source, equip, body, filters, search, period, sort, top, basis}
#   visual … グラフの形（pivot_presets.CHARTS。none は表だけ）・kpi（大きな数）・board（合わせた表。版 3.38.0。下の「合わせた表」）
#   source … lot・work・src:<キー>（データ元）。equip … 作業実績の設備のキー（空はすべての設備）
#   body   … 集計の組み方（行・列・値。集計表と同じ形。kpi は行が無くてよい）
#   filters・search … 数える行の条件（一覧と同じ形）。period … 期間（pivot.PERIODS）
#   sort   … 行の並べ方（""＝決まった順・desc＝値の大きい順・asc＝小さい順）。top … 上位いくつ（0＝パネルの大きさに合わせる）
#   basis  … 作業日の数え方（work＝現場歴・cal＝太陽暦）
#   emph   … 目立たせる（最初に見る数。淡い藍の地と藍の枠。2026-10-grid の 3 回目で決めた L）
#   calc   … 計算列（版 3.38.0）: {formulas: {列名: 式}, names: {元の列名: 表示名}}。組んだ PC の一覧の表示列の設定から、使う計算列の分だけ写す
#            （共通のダッシュボードをほかの PC で開いても同じ数になる。式は services/formula.py で画面と同じ答え）
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


MAX_CALC = 40


def clean_calc(v):
    """パネルの計算列 → {formulas, names}（字だけ・数と長さを限る）。無ければ None"""
    if not isinstance(v, dict):
        return None

    def strs(d, n, size):
        items = list(d.items())[:n] if isinstance(d, dict) else []
        return {str(k)[:200]: str(x)[:size] for k, x in items if str(k).strip() and isinstance(x, str)}
    f = {k: x for k, x in strs(v.get("formulas"), MAX_CALC, MAX_LEN).items() if x.strip()}
    return {"formulas": f, "names": strs(v.get("names"), 400, 200)} if f else None


def _measure(m):
    if isinstance(m, dict) and m.get("agg") in ("count", "lots", "sum", "avg", "min", "max"):
        return {"agg": m["agg"]} if m["agg"] in ("count", "lots") else {"agg": m["agg"], "column": str(m.get("column") or "")[:200]}
    return None


def _data(p, what):
    """数える元と行の決め方（パネルと、合わせた表の列のまとまりで同じ形）: source・equip・filters・search・period・basis・calc"""
    src = str(p.get("source") or "")
    if not is_screen_source(src):
        raise LayoutError(f"{what}のデータ（lot・work・src:<キー>）が違います。")
    out = {"source": src, "equip": str(p.get("equip") or "")[:40], "filters": _filters(p.get("filters")), "search": str(p.get("search") or "").strip()[:200],
           "period": _period(p.get("period")), "basis": "cal" if p.get("basis") == "cal" else "work"}
    calc = clean_calc(p.get("calc"))
    if calc:
        out["calc"] = calc
    return out


# ---------------------------------------------------------------- 合わせた表（版 3.38.0。visual board）
# 行の段（rows。既定は設備）を共通にして、列のまとまり（groups。1〜4）を横に並べる 1 枚の表。まとまりごとにデータ・値・列の段・期間・条件を
# ほかのパネルと同じ組み方で決める（数え方もほかのパネルと同じ 1 か所）。行は行の段の鍵（設備なら設備名）でそろえる。
#   group: {title, source, equip, filters, search, period, basis, calc, measure: {agg, column}, cols: [段]（0〜2）,
#           look: bar（棒と数）・heat（数と濃淡）・num（数だけ）, total: 列の段があるとき計の列を出す, zero: 計が 0 の行に印（ほかのまとまりに数がある行）,
#           color: 色（"" ＝データの種類の色・#rrggbb）}
#   order: {by: value（まとまり group の計の大きい・小さい順 dir）・name（名前の順）・equip（作業実績の設備の並び〈マスタ管理で決めた順〉）・
#           manual（手で並べた list の順。list に無い行は後ろに名前の順）, group, dir: desc|asc, list: [行の鍵], hide: [隠す行の鍵]}
BOARD_LOOKS = ("bar", "heat", "num")
BOARD_ORDERS = ("value", "name", "equip", "manual")
MAX_GROUPS = 4
MAX_ORDER = 200
_COLOR = re.compile(r"#[0-9a-fA-F]{6}")


def _keys(v):
    return [str(x)[:120] for x in (v if isinstance(v, list) else [])[:MAX_ORDER] if str(x).strip()]


def clean_group(g, i):
    if not isinstance(g, dict):
        raise LayoutError("列のまとまりの形が違います。")
    title = str(g.get("title") or "").strip()[:40]
    out = {"title": title, **_data(g, f"列のまとまり「{title or i + 1}」"),
           "measure": _measure(g.get("measure")) or {"agg": "lots"}, "cols": pivot_presets._dims(g.get("cols"))[:2],
           "look": g.get("look") if g.get("look") in BOARD_LOOKS else "num", "total": bool(g.get("total", True)), "zero": bool(g.get("zero")),
           "color": str(g.get("color") or "") if _COLOR.fullmatch(str(g.get("color") or "")) else ""}
    return out


def clean_board(p, what):
    groups = p.get("groups") if isinstance(p.get("groups"), list) else []
    if not groups:
        return board_default()
    if len(groups) > MAX_GROUPS:
        raise LayoutError(f"{what}の列のまとまりは {MAX_GROUPS} つまでです。")
    rows = pivot_presets._dims([p.get("rows")] if isinstance(p.get("rows"), dict) else [])
    o = p.get("order") if isinstance(p.get("order"), dict) else {}
    gs = [clean_group(g, i) for i, g in enumerate(groups)]
    return {"rows": rows[0] if rows else {"column": "@equip", "part": ""}, "groups": gs,
            "order": {"by": o.get("by") if o.get("by") in BOARD_ORDERS else "value", "group": _int(o.get("group"), 0, len(gs) - 1, 0),
                      "dir": "asc" if o.get("dir") == "asc" else "desc", "list": _keys(o.get("list")), "hide": _keys(o.get("hide"))}}


def board_query(board, i):
    """合わせた表の列のまとまり i → ふつうのパネルと同じ形（数えるため。routes/dashboard.py が 1 つずつ数える）"""
    g = board["groups"][i]
    return {**{k: g[k] for k in ("source", "equip", "filters", "search", "period", "basis") if k in g}, **({"calc": g["calc"]} if g.get("calc") else {}),
            "visual": "none", "body": {"rows": [board["rows"]], "cols": g["cols"], "measures": [g["measure"]], "sub": False, "grand": True}}


YESTERDAY = {"column": "@workday", "kind": "yesterday"}


def board_default(conds=None):
    """版 3.36.0〜3.37.0 の 1 枚の表と同じ組み: 設備ごとの仕掛ロット数（棒・大きい順）と、前日（現場歴）の直ごとの実績本数（濃淡・計・0 本の印）。
    conds … 前の版の集計対象の条件（condition_of の wip・work）"""
    w, k = (conds or {}).get("wip") or {}, (conds or {}).get("work") or {}
    return {"rows": {"column": "@equip", "part": ""},
            "groups": [{"title": "仕掛ロット数", "source": "src:wip", "equip": "", "filters": w.get("filters") or [], "search": w.get("search") or "",
                        "period": None, "basis": "work", "measure": {"agg": "lots"}, "cols": [], "look": "bar", "total": True, "zero": False, "color": ""},
                       {"title": "", "source": "work", "equip": "", "filters": k.get("filters") or [], "search": k.get("search") or "",
                        "period": dict(YESTERDAY, n=7), "basis": "work", "measure": {"agg": "lots"}, "cols": [{"column": "@shift", "part": ""}],
                        "look": "heat", "total": True, "zero": True, "color": ""}],
            "order": {"by": "value", "group": 0, "dir": "desc", "list": [], "hide": []}}


def with_legacy_conditions(body, rows):
    """前の版で保存したダッシュボード（合わせた表に列のまとまりが無い 1 枚の表）へ、前の版の集計対象の条件を入れる（画面へ出すとき）"""
    conds = {k: condition_of(rows, k) for k in ("wip", "work")}
    if not any(c["filters"] or c["search"] for c in conds.values()):
        return body
    for x in body.get("panels") or []:
        if x.get("visual") == "board" and x.get("legacy"):
            x.update(board_default(conds))
    return body


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
    what = f"パネル「{out['title'] or pid}」"
    if visual == "board":
        if not p.get("groups") or p.get("legacy"):
            out["legacy"] = True       # 前の版の 1 枚の表（前の版の条件を引き継ぐ印。組む所で組み直すと外れる）
        return {**out, **clean_board(p, what)}
    body = p.get("body") if isinstance(p.get("body"), dict) else {}
    ms = [m for m in map(_measure, (body.get("measures") if isinstance(body.get("measures"), list) else [])[:4]) if m]
    out.update(_data(p, what),
               # 段は集計表の組み方と同じ形（pivot_presets._dims）
               body={"rows": pivot_presets._dims(body.get("rows")), "cols": pivot_presets._dims(body.get("cols")), "measures": ms or [{"agg": "lots"}],
                     "sub": False, "grand": bool(body.get("grand", visual in ("none", "kpi"))), "chartAt": _int(body.get("chartAt"), 0, 3, 0),
                     "labels": bool(body.get("labels", True))},
               sort=p.get("sort") if p.get("sort") in SORTS else "", top=_int(p.get("top"), 0, TOP_MAX, 0))
    if visual not in ("kpi", "none") and not out["body"]["rows"]:
        raise LayoutError(f"{what}は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。")
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
        {"id": "board", "x": 5, "y": 1, "w": 7, "h": 7, "title": "設備ごとの仕掛と前日の実績", "visual": "board", **board_default()},
    ]}},
]


def builtin_layouts():
    """組み込みのダッシュボード → 画面の形（id は "b:鍵"。書き換えられない）"""
    return [{"id": f"b:{b['key']}", "name": b["name"], "source": LAYOUT_SOURCE, "scope": "default", "login": "", "standard": False,
             "body": clean_layout(b["body"])[0], "note": "", "rev": 0, "updatedAt": "", "updatedBy": {}, "canEdit": False, "builtin": True}
            for b in BUILTIN_LAYOUTS]
