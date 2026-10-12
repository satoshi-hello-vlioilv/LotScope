# -*- coding: utf-8 -*-
"""ピボット集計（DataRelay のデータビュワーの集計表・グラフと同じ考え方。版 3.23.0）。

一覧と同じ絞り込み（検索・条件・列で絞り込む・スライサー）に当たる全件を数える。数え方はここ 1 か所で、
画面（static/js/lotlist-pivot.js）は受け取った数で表・グラフ（時系列・ヒストグラム）を描くだけ。

行・列（dims）: [{column, part}]。行・列それぞれ最大 MAX_DIMS 段。
    part … ""（値のまま。数に読める字は数として 1 つ・空欄は 1 つ）
           日付のまとめ: year（年）・ym（年月）・date（年月日）・month（月）・weekday（曜日）・hour（時）
           数の区間: bin（ヒストグラム。幅 width・起点 origin。幅が 0 なら、データの範囲と件数から決める）
    作業実績だけの列: @workday（作業日。現場歴／太陽暦）・@shift（直）。作業開始の列と勤務体系で決める（work_summary.Grouping と同じ決め方）
値（measures）: [{agg, column}] 最大 MAX_MEASURES。agg …
    count（行の数）・lots（ロット数: 作業実績は作業開始が同じ行を 1、異常ロット一覧はロット番号が同じ行を 1。鍵が空の行は 1 行ずつ）・
    sum・avg・min・max（数に読める値だけ。読めない値は数えない）
小計・総計: 行・列の段の頭（0〜n 段）の組すべてを数える（ロット数・平均は下の段から足し合わせられないので、組ごとに数える）。
答え: {dims: {rows, cols}, measures, orders, labels, cells: [{r, c, v}], count, truncated, bins, stats}
    orders … 段ごとの鍵の並び（表・グラフの並び。数・日付は小さい順・空欄は最後・直は勤務体系の順）
    labels … 段ごとの {鍵: 見せる字}（2026-10-12 → 2026/10/12(月)・区間 → 100〜150 など）
"""
from __future__ import annotations

import json
import math
import time
from datetime import date

from .lot_list import TABLE_CANDIDATES, columns, lot_column, pick_table, raw_columns, search_filter_where, tables
from .shifts import OUTSIDE
from .sqlite_ro import connect_ro, qi, sort_key, to_datetime
from .work_summary import num, start_column, time_column, work_key

MAX_DIMS = 3
MAX_MEASURES = 4
MAX_ROW_KEYS = 2000       # 行のいちばん下の段の鍵の数（超えたら先頭から。truncated）
MAX_COL_KEYS = 120        # 列のいちばん下の段の鍵の数
MAX_ROWS = 1_000_000      # 数える行の上限（超えたら断る）
DATE_PARTS = ("year", "ym", "date", "month", "weekday", "hour")
PARTS = ("",) + DATE_PARTS + ("bin",)
AGGS = ("count", "lots", "sum", "avg", "min", "max")
WORK_DIMS = ("@workday", "@shift")
AGG_LABEL = {"count": "件数", "lots": "ロット数", "sum": "の合計", "avg": "の平均", "min": "の最小", "max": "の最大"}
PART_LABEL = {"year": "年", "ym": "年月", "date": "年月日", "month": "月", "weekday": "曜日", "hour": "時", "bin": "区間"}
WD = "月火水木金土日"      # date.weekday() の順（月曜＝0）
BLANK = "（空欄）"


class PivotError(ValueError):
    pass


def _num_text(f):
    """数の鍵の字（1.0 → "1"・0.1+0.2 → "0.3"）。並びは orders で決めるので、見せる字だけ"""
    if f is None:
        return ""
    r = round(f, 10)
    return str(int(r)) if r == int(r) else repr(r)


def _parse_list(text, limit, what):
    try:
        v = json.loads(text) if isinstance(text, str) and text else (text or [])
    except ValueError as e:
        raise PivotError(f"{what}の形が違います。") from e
    if not isinstance(v, list):
        raise PivotError(f"{what}の形が違います。")
    return [x for x in v if isinstance(x, dict)][:limit]


def clean_dims(text, cs, work_ok):
    out = []
    for d in _parse_list(text, MAX_DIMS, "行・列"):
        col, part = str(d.get("column") or ""), str(d.get("part") or "")
        if col in WORK_DIMS:
            if not work_ok:
                raise PivotError("作業日・直は作業実績だけで使えます。")
            part = ""
        elif col not in cs:
            raise PivotError(f"列「{col}」がありません。")
        if part not in PARTS:
            part = ""
        dim = {"column": col, "part": part}
        if part == "bin":
            dim["width"] = max(0.0, num(d.get("width")) or 0.0)
            dim["origin"] = num(d.get("origin"))
        out.append(dim)
    return out


def clean_measures(text, cs):
    out = []
    for m in _parse_list(text, MAX_MEASURES, "値"):
        agg, col = str(m.get("agg") or "count"), str(m.get("column") or "")
        if agg not in AGGS:
            agg = "count"
        if agg in ("sum", "avg", "min", "max") and col not in cs:
            raise PivotError(f"値の列「{col}」がありません。")
        out.append({"agg": agg, "column": col if agg in ("sum", "avg", "min", "max") else ""})
    return out or [{"agg": "count", "column": ""}]


def nice_width(lo, hi, n):
    """ヒストグラムの区間の幅: スタージェスの公式の区間の数（5〜40）で範囲を割り、いちばん近い 1・2・2.5・5 × 10^k にする"""
    span = hi - lo
    if span <= 0:
        return 1.0
    k = min(40, max(5, math.ceil(math.log2(max(n, 1))) + 1))
    raw = span / k
    e = 10 ** math.floor(math.log10(raw))
    w = min((m * e for m in (1, 2, 2.5, 5, 10)), key=lambda x: abs(math.log(x / raw)))
    return int(w) if w == int(w) else w


def describe(values):
    """数の並び → {n, mean, sd, min, q1, median, q3, max}（ヒストグラムの横に出す傾向の数）。空なら None"""
    xs = sorted(values)
    n = len(xs)
    if not n:
        return None

    def q(p):
        i = (n - 1) * p
        lo = math.floor(i)
        return xs[lo] + (xs[min(lo + 1, n - 1)] - xs[lo]) * (i - lo)
    mean = sum(xs) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in xs) / (n - 1)) if n > 1 else 0.0
    return {"n": n, "mean": mean, "sd": sd, "min": xs[0], "q1": q(0.25), "median": q(0.5), "q3": q(0.75), "max": xs[-1]}


class _Keyer:
    """1 つの段の鍵の作り方（値 → (鍵の字, 並べる鍵, 見せる字)）。同じ値は覚えて読み直さない"""

    def __init__(self, dim, clock=None, basis="work"):
        self.dim, self.part, self.clock, self.basis = dim, dim["part"], clock, basis
        self.memo = {}

    def key(self, v, tv=None):
        mk = (v, tv) if self.dim["column"] in WORK_DIMS else v
        hit = self.memo.get(mk)
        if hit is None:
            hit = self.memo[mk] = self._make(v, tv)
        return hit

    def _make(self, v, tv):
        col, part = self.dim["column"], self.part
        if col in WORK_DIMS:
            day, idx = self.clock.place(to_datetime(v, tv), self.basis)
            if col == "@workday":
                return (day, (0, day) if day else (1, ""), _day_label(day) if day else "日付なし")
            name = (self.clock.segments[idx]["name"] if idx >= 0 else "直の外" if idx == OUTSIDE else "時刻なし")
            return (str(idx), (0, idx) if idx >= 0 else (1, -idx), name)
        if part == "":
            k = sort_key(v)
            if k is None:
                return ("", (2, 0, ""), BLANK)
            if isinstance(k, float):
                t = _num_text(k)
                return ("#" + t, (0, k, ""), t)
            return ("$" + k, (1, 0, k), k)
        if part == "bin":
            f = num(v)
            if f is None:
                return ("", (1, 0.0), BLANK)
            w, o = self.dim["width"], self.dim["origin"]
            s = o + math.floor((f - o) / w + 1e-9) * w
            return (_num_text(s), (0, s), f"{_num_text(s)}〜{_num_text(s + w)}")
        stamp = to_datetime(v)
        if not stamp:
            return ("", (1, ""), BLANK)
        d = date.fromisoformat(stamp[:10])
        if part == "year":
            return (stamp[:4], (0, stamp[:4]), f"{stamp[:4]}年")
        if part == "ym":
            return (stamp[:7], (0, stamp[:7]), f"{stamp[:4]}/{stamp[5:7]}")
        if part == "date":
            return (stamp[:10], (0, stamp[:10]), _day_label(stamp[:10]))
        if part == "month":
            return (stamp[5:7], (0, stamp[5:7]), f"{int(stamp[5:7])}月")
        if part == "weekday":
            return (str(d.weekday()), (0, d.weekday()), WD[d.weekday()])
        if part == "hour":
            if len(stamp) < 13:
                return ("", (1, ""), "時刻なし")
            return (stamp[11:13], (0, stamp[11:13]), f"{int(stamp[11:13])}時")
        return ("", (1, ""), BLANK)


def _day_label(day):
    d = date.fromisoformat(day)
    return f"{day[:4]}/{day[5:7]}/{day[8:10]}({'月火水木金土日'[d.weekday()]})"


def _dim_name(dim):
    col, part = dim["column"], dim["part"]
    if col == "@workday":
        return "作業日"
    if col == "@shift":
        return "直"
    return f"{col}（{PART_LABEL[part]}）" if part else col


def _measure_name(m):
    return AGG_LABEL[m["agg"]] if m["agg"] in ("count", "lots") else f"{m['column']}{AGG_LABEL[m['agg']]}"


def query(path, *, table="", preferred_table="", search="", filters="", rows="", cols="", measures="", today=None,
          table_candidates=TABLE_CANDIDATES, work=None):
    """ピボット集計の答え（モジュールの説明）。work は作業実績のとき {clock, basis, start}（作業開始の列は work_summary.start_column で決める）。"""
    t0 = time.perf_counter()
    with connect_ro(path) as c:
        names = tables(c)
        t = table if table in names else pick_table(names, preferred_table, table_candidates)
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        cs = columns(c, t, raw_columns(c, t))
        start = start_column(cs, (work or {}).get("start", "")) if work else ""
        tcol = time_column(cs, start) if start else ""
        rd, cd = clean_dims(rows, cs, bool(start)), clean_dims(cols, cs, bool(start))
        ms = clean_measures(measures, cs)
        where_parts, params = search_filter_where(cs, search, filters, today)
        where = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        # 読む列: 段の列・値の列・ロットの鍵の列（作業実績は作業開始と時刻・異常ロット一覧はロット番号）
        lot = lot_column(cs)
        need = []

        def use(col):
            if col and col not in need:
                need.append(col)
            return need.index(col) if col else -1
        dims = rd + cd
        pos = []
        for d in dims:
            if d["column"] in WORK_DIMS:
                pos.append((use(start), use(tcol)))
            else:
                pos.append((use(d["column"]), -1))
        mpos = [use(m["column"]) if m["column"] else -1 for m in ms]
        lots_by = "work" if start else "lot" if lot else ""
        kpos = (use(start), use(tcol)) if lots_by == "work" else (use(lot), -1) if lots_by == "lot" else (-1, -1)
        total = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}{where}", params).fetchone()[0])
        if total > MAX_ROWS:
            raise PivotError(f"当たる行が多すぎます（{total:,} 行。{MAX_ROWS:,} 行まで）。条件で絞ってから集計してください。")
        data = c.execute(f"SELECT {', '.join(qi(x) for x in need) or '1'} FROM {qi(t)}{where}", params).fetchall() if need else [()] * total
    # 区間の幅・起点を決める（幅 0 は自動）。傾向の数（平均・ばらつき・四分位）も出す
    bins, stats = [], {}
    for i, d in enumerate(dims):
        if d["part"] != "bin":
            continue
        vals = [f for f in (num(r[pos[i][0]]) for r in data) if f is not None]
        lo, hi = (min(vals), max(vals)) if vals else (0.0, 1.0)
        if not d["width"]:
            d["width"] = nice_width(lo, hi, len(vals))
            d["auto"] = True
        if d["origin"] is None:
            d["origin"] = math.floor(lo / d["width"]) * d["width"]
        bins.append({"dim": i, "column": d["column"], "width": d["width"], "origin": d["origin"], "auto": bool(d.get("auto")), "min": lo, "max": hi})
        stats[d["column"]] = describe(vals)
    clock, basis = (work or {}).get("clock"), (work or {}).get("basis", "work")
    keyers = [_Keyer(d, clock, basis) for d in dims]
    nr, nc = len(rd), len(cd)
    # 1 行ずつ鍵を作り、行・列の段の頭の組（小計・総計）ごとに数える
    cells = {}
    seen = [dict() for _ in dims]      # 段ごとの {鍵: (並べる鍵, 見せる字)}
    single = 0
    for row in data:
        ks = []
        for i, kr in enumerate(keyers):
            a, b = pos[i]
            k, sk, label = kr.key(row[a] if a >= 0 else None, row[b] if b >= 0 else None)
            if k not in seen[i]:
                seen[i][k] = (sk, label)
            ks.append(k)
        if lots_by:
            a, b = kpos
            lk = work_key(row[a], row[b] if b >= 0 else None) if lots_by == "work" else str(row[a] or "").strip().upper()
            if not lk:
                single += 1
                lk = f"\u0000{single}"
        else:
            single += 1
            lk = single
        vals = [num(row[p]) if p >= 0 else None for p in mpos]
        rk, ck = ks[:nr], ks[nr:]
        for a in range(nr + 1):
            for b in range(nc + 1):
                key = (tuple(rk[:a]), tuple(ck[:b]))
                acc = cells.get(key)
                if acc is None:
                    acc = cells[key] = [0, set(), [[0.0, 0, None, None] for _ in ms]]
                acc[0] += 1
                if lots_by and any(m["agg"] == "lots" for m in ms):
                    acc[1].add(lk)
                for j, f in enumerate(vals):
                    if f is None:
                        continue
                    s = acc[2][j]
                    s[0] += f
                    s[1] += 1
                    s[2] = f if s[2] is None or f < s[2] else s[2]
                    s[3] = f if s[3] is None or f > s[3] else s[3]
    # 鍵の並び（段ごと）と、いちばん下の段の数の上限
    orders = [sorted(seen[i], key=lambda k, i=i: seen[i][k][0]) for i in range(len(dims))]
    labels = [{k: seen[i][k][1] for k in seen[i]} for i in range(len(dims))]
    truncated = {"rows": False, "cols": False}
    full = [k for k in cells if len(k[0]) == nr and len(k[1]) == nc]
    for axis, n, lim in (("rows", nr, MAX_ROW_KEYS), ("cols", nc, MAX_COL_KEYS)):
        if not n:
            continue
        leaves = {k[0] if axis == "rows" else k[1] for k in full}
        if len(leaves) > lim:
            rank = [{k: j for j, k in enumerate(orders[i if axis == "rows" else nr + i])} for i in range(n)]
            keep = set(sorted(leaves, key=lambda p: [rank[i][p[i]] for i in range(n)])[:lim])
            truncated[axis] = len(leaves)
            ix = 0 if axis == "rows" else 1
            cells = {k: v for k, v in cells.items() if len(k[ix]) < n or k[ix] in keep}

    def value(acc, j, m):
        if m["agg"] == "count":
            return acc[0]
        if m["agg"] == "lots":
            return len(acc[1]) if lots_by else acc[0]
        s = acc[2][j]
        if not s[1]:
            return None
        return {"sum": s[0], "avg": s[0] / s[1], "min": s[2], "max": s[3]}[m["agg"]]
    def clean(x):          # 足し算の誤差（1248967.0999999992）を丸める
        return round(x, 6) if isinstance(x, float) else x
    out_cells = [{"r": list(k[0]), "c": list(k[1]), "v": [clean(value(acc, j, m)) for j, m in enumerate(ms)]} for k, acc in cells.items()]
    note = "" if lots_by or not any(m["agg"] == "lots" for m in ms) else "ロットを見分ける列（作業開始・ロット番号）が無いので、ロット数は行の数です。"
    return {
        "table": t, "count": len(data),
        "dims": {"rows": [{**d, "name": _dim_name(d)} for d in rd], "cols": [{**d, "name": _dim_name(d)} for d in cd]},
        "measures": [{**m, "name": _measure_name(m)} for m in ms],
        "orders": orders, "labels": labels, "cells": out_cells, "truncated": truncated,
        "bins": bins, "stats": stats, "lotsBy": lots_by, "start": start, "note": note,
        "timing": {"server": round((time.perf_counter() - t0) * 1000)},
    }


def fields(path, *, table="", preferred_table="", table_candidates=TABLE_CANDIDATES, sample=300):
    """集計の左のカラムの札に出す手がかり: 列ごとの値の種類の数（多ければ 1000+）と、数の列か（読める値がみな数）。"""
    with connect_ro(path) as c:
        names = tables(c)
        t = table if table in names else pick_table(names, preferred_table, table_candidates)
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        raw = raw_columns(c, t)
        cs = columns(c, t, raw)
        out = []
        for col in cs:
            kinds = int(c.execute(f"SELECT COUNT(*) FROM (SELECT DISTINCT {qi(col)} FROM {qi(t)} LIMIT 1001)").fetchone()[0])
            vals = [r[0] for r in c.execute(f"SELECT {qi(col)} FROM {qi(t)} WHERE TRIM(CStr({qi(col)})) <> '' LIMIT {int(sample)}")]
            numeric = bool(vals) and all(num(v) is not None for v in vals)
            out.append({"column": col, "kinds": kinds, "many": kinds > 1000, "numeric": numeric})
    return {"table": t, "fields": out}
