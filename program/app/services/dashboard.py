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

from . import aggregate, pivot_presets
from .data_sources import is_screen_source
from .formula import MAX_LEN
from .pivot import MAX_MEASURES, PERIODS

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
#            （共通のダッシュボードをほかの PC で開いても同じ数になる。式は services/formula.py で画面と同じ答え）。
#            版 3.39.0 からパネルを組む所でも作れる（own: パネルで作った計算列の名前。一覧の表示列には入れない）
# 版 3.39.0（利用者の要望 2026-10）:
#   equips … 数える設備の名前の並び（空はすべて。複数選べる）。作業実績は設備のファイル、データ元は設備の列の値で見分ける
#   egroup … 設備のまとめ（合算）{mode, name, groups, set, rest}（clean_egroup）。合わせた表は表全体（行の段の設備）に効く
#   fmt    … 書式（clean_fmt。数値ラベル・横軸の日付の形・桁・単位・縦軸の範囲・凡例・補助線・基準線・色の組・系列の色・字の大きさ・数字の形と目標）
#   frame  … パネルの見せ方（FRAMES。emph は frame "emph" の前の版の書き方として読む）
#   値（measures）は services/aggregate.py の種類（統計・表し方 show・p 点・規格 lsl/usl）
# 版 3.40.0（利用者の要望 2026-10）:
#   esplit … 設備の分け方（split_of）: series（設備ごとに系列＝列の段に設備）・facet（設備ごとに小さな表・グラフを並べる）・sum（合算して 1 つ）。
#            空なら、設備を 2 つ以上選んだとき（グループでまとめたときも）は series、ほかは sum（今までどおり）
#   body.sub … 小計（表。行の段が 2 つ以上のとき。設備グループの段〈@egroup〉と設備を並べると、グループごとの小計）
#   link   … 別のデータを合わせる（clean_link。45度線管理図の目標と実績など）。データ（側）ごとに元・軸（合わせる段）・値・作り方
#            （そのまま／積み上げ）・役割（目標／実績）を決め、軸の値でそろえて 1 つの答えにする（routes/dashboard.py の _link_answer）
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


IN_MAX = 20000          # 値を選ぶ条件（in。値の並びの JSON）の字の長さ


def _filters(v):
    out = []
    for f in (v if isinstance(v, list) else [])[:MAX_FILTERS]:
        if isinstance(f, dict) and str(f.get("column") or "").strip() and str(f.get("op") or "").strip():
            op = str(f["op"]).strip()[:20]
            x = {"column": str(f["column"]).strip()[:200], "op": op, "value": "" if f.get("value") is None else str(f["value"])[:IN_MAX if op == "in" else 400]}
            if op == "in" and f.get("key") in ("date", "month", "year"):
                x["key"] = f["key"]
            out.append(x)
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
    if not f:
        return None
    own = [str(x)[:200] for x in (v.get("own") if isinstance(v.get("own"), list) else []) if str(x) in f][:MAX_CALC]
    return {"formulas": f, "names": strs(v.get("names"), 400, 200), **({"own": own} if own else {})}


def _measure(m):
    """値（services/aggregate.py の形）。列があるかは数えるときに確かめる（ここは形だけ）。合わなければ None"""
    if not isinstance(m, dict) or m.get("agg") not in aggregate.AGGS:
        return None
    try:
        out = aggregate.clean({**m, "column": str(m.get("column") or "")[:200]}, lambda c: bool(c))
    except ValueError:
        return None
    return {k: v for k, v in out.items() if not (k == "column" and not v)}


# ---------------------------------------------------------------- 設備の選び・まとめ・書式（版 3.39.0）
MAX_EQUIPS = 200
EGROUP_MODES = ("", "sum", "panel", "master")
EGROUP_RESTS = ("keep", "other", "hide")
MAX_EGROUPS = 24
SUM_NAME = "選んだ設備の計"


def _names(v, n=MAX_EQUIPS):
    out = []
    for x in (v if isinstance(v, list) else [])[:n]:
        t = str(x or "").strip()[:120]
        if t and t not in out:
            out.append(t)
    return out


def clean_egroup(v):
    """設備のまとめ → {mode, name, groups, set, rest}。mode: ""（まとめない）・sum（選んだ設備〈無ければ全部〉を 1 つに合算。名前 name）・
    panel（このパネルで決めたグループ groups: [{name, members}]）・master（設備グループのマスタのまとめ方 set）。
    rest … どのグループにも入らない設備: keep（そのまま）・other（その他にまとめる）・hide（出さない）。まとめないなら None"""
    if not isinstance(v, dict) or v.get("mode") not in EGROUP_MODES[1:]:
        return None
    mode = v["mode"]
    out = {"mode": mode, "rest": v.get("rest") if v.get("rest") in EGROUP_RESTS else "keep"}
    if mode == "sum":
        out["name"] = str(v.get("name") or "").strip()[:40] or SUM_NAME
    elif mode == "panel":
        gs = []
        for g in (v.get("groups") if isinstance(v.get("groups"), list) else [])[:MAX_EGROUPS]:
            if isinstance(g, dict) and str(g.get("name") or "").strip():
                gs.append({"name": str(g["name"]).strip()[:40], "members": _names(g.get("members"))})
        if not gs:
            return None
        out["groups"] = gs
    else:
        out["set"] = str(v.get("set") or "").strip()[:40]
        if not out["set"]:
            return None
    return out


def resolve_egroup(eg, equips, group_rows_for):
    """パネルの設備のまとめ → 数える形（pivot.query_many の egroups）。group_rows_for(set) → [{name, members}]（マスタ）"""
    if not eg:
        return None
    if eg["mode"] == "sum":
        return {"groups": [{"name": eg["name"], "members": list(equips or [])}], "rest": "other", "other": eg["name"]}
    groups = eg["groups"] if eg["mode"] == "panel" else group_rows_for(eg["set"])
    if not groups:
        return None
    return {"groups": groups, "rest": eg["rest"]}


FRAMES = ("card", "emph", "accent", "plain", "tint")
LABELS = ("auto", "none", "top", "inside", "both")
XDATES = ("auto", "md", "mdw", "d", "dw", "ymd", "ym", "w")
XROTS = ("auto", "0", "45", "90")
UNITS = ("auto", "none", "k", "man")
LEGENDS = ("auto", "none", "top", "bottom")
SIZES = ("s", "m", "l")
PALETTES = ("", "vivid", "calm", "cud", "mono", "warm", "cool")
KPI_LOOKS = ("num", "bar", "gauge")
MAX_REFS = 4
MAX_COLORS = 40


def _float(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def clean_fmt(v):
    """書式 → 既定と違う物だけの dict（無ければ None）。
    labels（数値ラベル: auto・none・top〈上〉・inside〈棒の中。積み上げはそれぞれの段〉・both）・xdate（横軸の日付の形）・xrot（横軸の字の向き）・
    digits（小数の桁。-1＝自動）・unit（単位: auto〈万・億〉・none・k〈千〉・man〈万〉）・ymin/ymax（縦軸の範囲）・legend・grid（補助線）・
    refs（基準線 [{value, label, color}]）・palette（色の組）・colors（系列・項目の名前 → 色）・size（字の大きさ）・kpi（数字の形）・target（目標）"""
    if not isinstance(v, dict):
        return None
    out = {}
    for k, choices in (("labels", LABELS), ("xdate", XDATES), ("xrot", XROTS), ("unit", UNITS), ("legend", LEGENDS), ("size", SIZES),
                       ("palette", PALETTES), ("kpi", KPI_LOOKS)):
        x = str(v.get(k) or "")
        if x in choices and x not in ("auto", "", "m", "num"):
            out[k] = x
    d = _int(v.get("digits"), -1, 4, -1)
    if d >= 0:
        out["digits"] = d
    for k in ("ymin", "ymax", "target"):
        f = _float(v.get(k))
        if f is not None:
            out[k] = f
    if "ymin" in out and "ymax" in out and out["ymin"] >= out["ymax"]:
        out.pop("ymax")
    if v.get("grid") is False:
        out["grid"] = False
    refs = []
    for r in (v.get("refs") if isinstance(v.get("refs"), list) else [])[:MAX_REFS]:
        f = _float((r or {}).get("value")) if isinstance(r, dict) else None
        if f is not None:
            c = str(r.get("color") or "")
            refs.append({"value": f, "label": str(r.get("label") or "").strip()[:20], "color": c if _COLOR.fullmatch(c) else ""})
    if refs:
        out["refs"] = refs
    cs = {str(k)[:120]: str(c) for k, c in list((v.get("colors") if isinstance(v.get("colors"), dict) else {}).items())[:MAX_COLORS]
          if str(k).strip() and _COLOR.fullmatch(str(c))}
    if cs:
        out["colors"] = cs
    return out or None


ESPLITS = ("", "series", "facet", "sum")
MAX_FACETS = 24


def split_of(p):
    """パネルの設備の分け方（esplit が空なら決める）→ series・facet・sum・""（分けない: 段に設備・設備グループがある・設備を見分けない形）"""
    body = p.get("body") or {}
    if p.get("link") or any(d.get("column") in ("@equip", "@egroup") for d in (body.get("rows") or []) + (body.get("cols") or [])):
        return ""
    eg = p.get("egroup") or {}
    if eg.get("mode") == "sum":
        return "sum"
    want = p.get("esplit") or ""
    if want:
        return want
    return "series" if len(p.get("equips") or []) >= 2 or eg.get("mode") in ("panel", "master") else "sum"


# ---------------------------------------------------------------- 別のデータを合わせる（版 3.40.0。link）
# 利用者の要望（2026-10）: 45度線管理図などの 2 つのデータが要る形は、1 つのデータの中の 2 つの値ではなく、別のデータ（例: 計画のデータ元と作業実績）
# から取る。どの段で軸を合わせるか・合わせた後にそのまま出すか積み上げる（累計）か・どちらが目標でどちらが実績かを、データ（側）ごとに決める。
#   link: {sides: [side（2〜4）], extra: [diff（実績−目標）・rate（実績÷目標 %）]}
#   side: {title, role: target（目標）・actual（実績）・""（比べる）, build: as（そのまま）・cum（積み上げ）, key: 段（軸。日付の列・作業日・設備など）,
#          measure: 値 1 つ, source・equip・equips・filters・search・period・basis・calc（ふつうのパネルと同じ）}
# 軸の値は、日（作業日の日・日付の列の年月日）・年月・年・設備名・字の値で、データが違っても同じ値なら同じ行にそろう（routes の _link_key）
LINK_ROLES = ("target", "actual", "")
LINK_BUILDS = ("as", "cum")
LINK_EXTRAS = ("diff", "rate")
MAX_SIDES = 4


def clean_link(v, what):
    """パネルの link → 置く形（無ければ None）。データが 2 つ未満・軸が無ければ LayoutError"""
    if not isinstance(v, dict):
        return None
    raw = v.get("sides") if isinstance(v.get("sides"), list) else []
    if not raw:
        return None
    if not 2 <= len(raw) <= MAX_SIDES:
        raise LayoutError(f"{what}の合わせるデータは 2〜{MAX_SIDES} つです。")
    sides = []
    for i, x in enumerate(raw):
        if not isinstance(x, dict):
            raise LayoutError(f"{what}の合わせるデータの形が違います。")
        key = pivot_presets._dims([x.get("key")] if isinstance(x.get("key"), dict) else [])
        if not key:
            raise LayoutError(f"{what}の合わせるデータ {i + 1} に、軸（合わせる段）がありません。")
        m = _measure(x.get("measure")) or {"agg": "lots"}
        m.pop("show", None)            # 表し方（割合・累計など）は使わない（積み上げは build で決める）
        sides.append({**_data(x, f"{what}の合わせるデータ {i + 1}"), "title": str(x.get("title") or "").strip()[:40],
                      "role": x.get("role") if x.get("role") in LINK_ROLES else "", "build": x.get("build") if x.get("build") in LINK_BUILDS else "as",
                      "key": key[0], "measure": m})
    extra = [e for e in LINK_EXTRAS if e in (v.get("extra") if isinstance(v.get("extra"), list) else [])]
    return {"sides": sides, **({"extra": extra} if extra else {})}


def side_query(link, i, panel):
    """合わせるデータ i → ふつうのパネルと同じ形（数えるため）。パネルの絞り込み（設備・条件）は、どのデータにも足す"""
    x = link["sides"][i]
    return {**{k: x[k] for k in ("source", "equip", "search", "period", "basis") if k in x}, **({"calc": x["calc"]} if x.get("calc") else {}),
            **({"equips": panel.get("equips") or x["equips"]} if panel.get("equips") or x.get("equips") else {}),
            "filters": (x.get("filters") or []) + (panel.get("filters") or []),
            "visual": "none", "body": {"rows": [x["key"]], "cols": [], "measures": [x["measure"]], "sub": False, "grand": True}}


def _data(p, what):
    """数える元と行の決め方（パネルと、合わせた表の列のまとまりで同じ形）: source・equip・filters・search・period・basis・calc"""
    src = str(p.get("source") or "")
    if not is_screen_source(src):
        raise LayoutError(f"{what}のデータ（lot・work・src:<キー>）が違います。")
    out = {"source": src, "equip": str(p.get("equip") or "")[:40], "filters": _filters(p.get("filters")), "search": str(p.get("search") or "").strip()[:200],
           "period": _period(p.get("period")), "basis": "cal" if p.get("basis") == "cal" else "work"}
    eq = _names(p.get("equips"))
    if eq:
        out["equips"] = eq
    calc = clean_calc(p.get("calc"))
    if calc:
        out["calc"] = calc
    return out


# ---------------------------------------------------------------- 合わせた表（版 3.38.0。visual board）
# 行の段（rows。既定は設備）を共通にして、列のまとまり（groups。1〜4）を横に並べる 1 枚の表。まとまりごとにデータ・値・列の段・期間・条件を
# ほかのパネルと同じ組み方で決める（数え方もほかのパネルと同じ 1 か所）。行は行の段の鍵（設備なら設備名）でそろえる。
#   group: {title, source, equip, filters, search, period, basis, calc, measure: {agg, column}, cols: [段]（0〜2）,
#           look: bar（棒と数）・heat（数と濃淡）・num（数だけ）・stack（列の内訳を 1 本の帯に積む）・share（行の計に対する割合 %）・
#                 dot（点と数）・signal（しきい値で 3 色の信号）・spark（列の段〈日など〉の移りを小さな線で）,
#           total: 列の段があるとき計の列を出す, zero: 計が 0 の行に印（ほかのまとまりに数がある行）,
#           color: 色（"" ＝データの種類の色・#rrggbb）, limits: {warn, alert, dir: high〈大きいと悪い〉・low}（信号・濃淡の色の境）}
#   order: {by: value（まとまり group の計の大きい・小さい順 dir）・name（名前の順）・equip（作業実績の設備の並び〈マスタ管理で決めた順〉）・
#           manual（手で並べた list の順。list に無い行は後ろに名前の順）, group, dir: desc|asc, list: [行の鍵], hide: [隠す行の鍵]}
BOARD_LOOKS = ("bar", "heat", "num", "stack", "share", "dot", "signal", "spark")   # 版 3.39.0 で 3 → 8
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
    lim = g.get("limits") if isinstance(g.get("limits"), dict) else {}
    lim = {k: f for k in ("warn", "alert") if (f := _float(lim.get(k))) is not None}, lim.get("dir")
    if lim[0]:
        out["limits"] = {**lim[0], "dir": "low" if lim[1] == "low" else "high"}
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
    extra = {k: v for k, v in (("equips", _names(p.get("equips"))), ("egroup", clean_egroup(p.get("egroup"))), ("filters", _filters(p.get("filters")))) if v}
    return {**extra, "rows": rows[0] if rows else {"column": "@equip", "part": ""}, "groups": gs,
            "order": {"by": o.get("by") if o.get("by") in BOARD_ORDERS else "value", "group": _int(o.get("group"), 0, len(gs) - 1, 0),
                      "dir": "asc" if o.get("dir") == "asc" else "desc", "list": _keys(o.get("list")), "hide": _keys(o.get("hide"))}}


def board_query(board, i):
    """合わせた表の列のまとまり i → ふつうのパネルと同じ形（数えるため。routes/dashboard.py が 1 つずつ数える）"""
    g = board["groups"][i]
    # 表全体の設備の選び・まとめ・条件（版 3.39.0）は、どのまとまりにも効く（条件はまとまりの条件に足す）
    whole = {k: board[k] for k in ("equips", "egroup") if board.get(k)}
    return {**{k: g[k] for k in ("source", "equip", "search", "period", "basis") if k in g}, **({"calc": g["calc"]} if g.get("calc") else {}),
            **({"equips": g["equips"]} if g.get("equips") else {}), **whole, "filters": (g.get("filters") or []) + (board.get("filters") or []),
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
    frame = p.get("frame") if p.get("frame") in FRAMES else ("emph" if p.get("emph") else "card")
    out["emph"] = frame == "emph"            # 前の版の画面のため（frame と同じ物）
    if frame != "card":
        out["frame"] = frame
    fmt = clean_fmt(p.get("fmt"))
    if fmt:
        out["fmt"] = fmt
    what = f"パネル「{out['title'] or pid}」"
    if visual == "board":
        if not p.get("groups") or p.get("legacy"):
            out["legacy"] = True       # 前の版の 1 枚の表（前の版の条件を引き継ぐ印。組む所で組み直すと外れる）
        return {**out, **clean_board(p, what)}
    body = p.get("body") if isinstance(p.get("body"), dict) else {}
    ms = [m for m in map(_measure, (body.get("measures") if isinstance(body.get("measures"), list) else [])[:MAX_MEASURES]) if m]
    rows_ = pivot_presets._dims(body.get("rows"))
    out.update(_data(p, what),
               # 段は集計表の組み方と同じ形（pivot_presets._dims）。小計は表で行の段が 2 つ以上のとき（版 3.40.0）
               body={"rows": rows_, "cols": pivot_presets._dims(body.get("cols")), "measures": ms or [{"agg": "lots"}],
                     "sub": bool(body.get("sub")) and visual == "none" and len(rows_) > 1, "grand": bool(body.get("grand", visual in ("none", "kpi"))),
                     "chartAt": _int(body.get("chartAt"), 0, 3, 0), "labels": bool(body.get("labels", True))},
               sort=p.get("sort") if p.get("sort") in SORTS else "", top=_int(p.get("top"), 0, TOP_MAX, 0))
    eg = clean_egroup(p.get("egroup"))
    if eg:
        out["egroup"] = eg
    if p.get("esplit") in ESPLITS[1:]:
        out["esplit"] = p["esplit"]
    link = clean_link(p.get("link"), what)
    if link:
        out["link"] = link
        return out
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
