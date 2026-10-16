# -*- coding: utf-8 -*-
"""ピボット集計（DataRelay のデータビュワーの集計表・グラフと同じ考え方。版 3.23.0）。

一覧と同じ絞り込み（検索・条件・列で絞り込む・スライサー）に当たる全件を数える。数え方はここ 1 か所で、
画面（static/js/lotlist-pivot.js）は受け取った数で表・グラフ（時系列・ヒストグラム）を描くだけ。

行・列（dims）: [{column, part}]。行・列それぞれ最大 MAX_DIMS 段。
    part … ""（値のまま。数に読める字は数として 1 つ・空欄は 1 つ）
           日付のまとめ: year（年）・ym（年月）・date（年月日）・month（月）・weekday（曜日）・hour（時）
           数の区間: bin（ヒストグラム。幅 width・起点 origin。幅が 0 なら、データの範囲と件数から決める）
    作業実績だけの列: @workday（作業日。現場歴／太陽暦）・@shift（直）。作業開始の列と勤務体系で決める（work_summary.Grouping と同じ決め方）
           作業日のまとめ（版 3.26.0〜）: ""（日）・ym（年月）・year（年）
月で絞る（版 3.26.0〜）: month="YYYY-MM" なら、日の段（行の 1 段目が日付の列の年月日か作業日の日。月で区切るときは 2 段目）がその月の行だけを数える。
    答えの months はその段に現れる月の並び（絞る前。画面の ◀ ▶ と月を選ぶ所）
値（measures）: [{agg, column}] 最大 MAX_MEASURES。agg …
    count（行の数）・lots（ロット数: 作業実績は作業開始が同じ行を 1、異常ロット一覧はロット番号が同じ行を 1。鍵が空の行は 1 行ずつ）・
    sum・avg・min・max（数に読める値だけ。読めない値は数えない）
小計・総計: 行・列の段の頭（0〜n 段）の組すべてを数える（ロット数・平均は下の段から足し合わせられないので、組ごとに数える）。
箱ひげ（版 3.27.0〜）: box=列 なら、行の段の葉（いちばん下の段まで決めた組）ごとに、その数の列の傾向（box_stats）を boxes に出す。
いくつかのファイル（版 3.37.0。ダッシュボード）: query_many(Part の並び) が 1 つの集計にまとめる（作業実績の全設備など。query は 1 つの Part）。
    設備の段 @equip … Part.equip で決める（作業実績は設備ごとのファイル・データ元は設備の列の値を EquipmentMatcher で見分ける）
    期間 period … {column: 日付の列か @workday, kind: today/yesterday/days/this_month/last_month, n}。その元の「いま」から日の範囲を決めて絞る
    （作業日は設備ごとの勤務体系で現場歴の今日を決めるので、設備で範囲が違うことがある。答えの period.ranges）
    表に無い列の条件は効かない（一覧と同じく外す）ので、答えの ignoredFilters で知らせる
答え: {dims: {rows, cols}, measures, orders, labels, cells: [{r, c, v}], count, truncated, bins, stats, boxes}
    orders … 段ごとの鍵の並び（表・グラフの並び。数・日付は小さい順・空欄は最後・直は勤務体系の順）
    labels … 段ごとの {鍵: 見せる字}（2026-10-12 → 2026/10/12(月)・区間 → 100〜150 など）
"""
from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timedelta

from .lot_list import TABLE_CANDIDATES, columns, date_columns, lot_column, pick_table, raw_columns, search_filter_where, tables
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
EQUIP_DIM = "@equip"            # 設備（版 3.37.0。作業実績は設備ごとのファイル・データ元は設備の列。Part.equip）
NO_EQUIP = "設備なし"
WORKDAY_PARTS = ("", "ym", "year")
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


def clean_dims(text, cs, work_ok, equip_ok=False):
    out = []
    for d in _parse_list(text, MAX_DIMS, "行・列"):
        col, part = str(d.get("column") or ""), str(d.get("part") or "")
        if col == EQUIP_DIM:
            if not equip_ok:
                raise PivotError("設備の段は、設備を見分けられる元（作業実績・設備の列を決めたデータ元）だけで使えます。")
            part = ""
        elif col in WORK_DIMS:
            if not work_ok:
                raise PivotError("作業日・直は作業実績だけで使えます。")
            part = part if col == "@workday" and part in WORKDAY_PARTS else ""
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


def box_stats(values, max_out=30):
    """箱ひげの数: describe に、ひげの端（四分位の範囲の 1.5 倍の内側でいちばん外の値）と外れ値（多ければ外側から max_out 個）を足す"""
    d = describe(values)
    if not d:
        return None
    iqr = d["q3"] - d["q1"]
    lo_lim, hi_lim = d["q1"] - 1.5 * iqr, d["q3"] + 1.5 * iqr
    inside = [x for x in values if lo_lim <= x <= hi_lim]
    out = sorted((x for x in values if x < lo_lim or x > hi_lim), key=lambda x: -abs(x - d["median"]))
    return {**d, "lo": min(inside) if inside else d["min"], "hi": max(inside) if inside else d["max"], "out": sorted(out[:max_out]), "outN": len(out)}


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

    def __init__(self, dim, clock=None, basis="work", equip=None, order=0, by_name=False):
        """equip・order … 設備の段の決め方（Part.equip）と、そのファイルの並び。by_name … 直を名前で見分ける（いくつかのファイルをまとめるとき。
        設備で勤務体系が違うと、同じ番号が違う直になるため）"""
        self.dim, self.part, self.clock, self.basis = dim, dim["part"], clock, basis
        self.equip, self.order, self.by_name = equip or {}, order, by_name
        self.memo = {}

    def key(self, v, tv=None):
        mk = (v, tv) if self.dim["column"] in WORK_DIMS else v
        hit = self.memo.get(mk)
        if hit is None:
            hit = self.memo[mk] = self._make(v, tv)
        return hit

    def _make(self, v, tv):
        col, part = self.dim["column"], self.part
        if col == EQUIP_DIM:
            name = self.equip["name"] if "name" in self.equip else (self.equip["match"](v) if self.equip.get("match") else str(v or "").strip())
            if not name:
                return ("", (1, 0, ""), NO_EQUIP)
            return (name, (0, self.order if "name" in self.equip else 0, name), name)
        if col in WORK_DIMS:
            day, idx = self.clock.place(to_datetime(v, tv), self.basis)
            if col == "@workday":
                if not day:
                    return ("", (1, ""), "日付なし")
                if part == "ym":
                    return (day[:7], (0, day[:7]), f"{day[:4]}/{day[5:7]}")
                if part == "year":
                    return (day[:4], (0, day[:4]), f"{day[:4]}年")
                return (day, (0, day), _day_label(day))
            name = (self.clock.segments[idx]["name"] if idx >= 0 else "直の外" if idx == OUTSIDE else "時刻なし")
            sk = (0, idx, name) if idx >= 0 else (1, -idx, name)
            return (name if self.by_name and idx >= 0 else str(idx), sk, name)
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
    if col == EQUIP_DIM:
        return "設備"
    if col == "@workday":
        return f"作業日（{PART_LABEL[part]}）" if part else "作業日"
    if col == "@shift":
        return "直"
    return f"{col}（{PART_LABEL[part]}）" if part else col


def _measure_name(m):
    return AGG_LABEL[m["agg"]] if m["agg"] in ("count", "lots") else f"{m['column']}{AGG_LABEL[m['agg']]}"


def _is_day(d):
    return (d["column"] == "@workday" and d["part"] == "") or (d["column"] != "@workday" and d["part"] == "date")


def day_dim(dims):
    """月で絞れる段（行の 1 段目が日の段: 日付の列の年月日か作業日の日）の番号。無ければ -1。
    月で区切る（画面が日の段の上に同じ列の年月の段を足す）ときは、2 段目の日の段"""
    if dims and _is_day(dims[0]):
        return 0
    if len(dims) > 1 and dims[0]["part"] == "ym" and dims[1]["column"] == dims[0]["column"] and _is_day(dims[1]):
        return 1
    return -1


def query(path, *, table="", preferred_table="", search="", filters="", rows="", cols="", measures="", today=None,
          table_candidates=TABLE_CANDIDATES, work=None, month="", box="", equip=None, period=None, now=None):
    """ピボット集計の答え（モジュールの説明）。work は作業実績のとき {clock, basis, start}（作業開始の列は work_summary.start_column で決める）。
    month は "YYYY-MM"（月で絞る。行の 1 段目が日の段のときだけ効く）。equip・period は query_many の説明。"""
    part = Part(path, table=table, preferred_table=preferred_table, table_candidates=table_candidates, work=work, equip=equip)
    return query_many([part], search=search, filters=filters, rows=rows, cols=cols, measures=measures, today=today,
                      month=month, box=box, period=period, now=now)


class Part:
    """数える 1 つのファイル（作業実績なら 1 設備）。
    work  … 作業実績のとき {clock, basis, start}（作業日・直・ロット数の決め方）
    equip … 設備の段（@equip）の決め方。{"name": 設備名}（ファイルが 1 設備）か {"column": 列, "match": 値 → 設備名}（列の値から見分ける）"""

    def __init__(self, path, *, table="", preferred_table="", table_candidates=TABLE_CANDIDATES, work=None, equip=None, name=""):
        self.path, self.table, self.preferred_table, self.table_candidates = path, table, preferred_table, table_candidates
        self.work, self.equip, self.name = work, equip, name or (equip or {}).get("name", "")


# 期間（版 3.37.0。ダッシュボードのパネル）: 日付の列か作業日（現場歴／太陽暦）の「いま」から決める日の範囲
PERIODS = {"today": "今日", "yesterday": "前日", "days": "直近 n 日", "this_month": "今月", "last_month": "先月"}
PERIOD_MAX_DAYS = 3660


def period_range(kind, n, today):
    """期間の種類 → (はじめ, おわり)（'YYYY-MM-DD'。両端を含む）。today はその元の「今日」（作業日なら勤務体系で決めた現場歴の日）"""
    d = date.fromisoformat(today)
    if kind == "today":
        return today, today
    if kind == "yesterday":
        y = (d - timedelta(days=1)).isoformat()
        return y, y
    if kind == "days":
        n = max(1, min(PERIOD_MAX_DAYS, int(n or 7)))
        return (d - timedelta(days=n - 1)).isoformat(), today
    if kind == "this_month":
        return d.replace(day=1).isoformat(), today
    if kind == "last_month":
        last = d.replace(day=1) - timedelta(days=1)
        return last.replace(day=1).isoformat(), last.isoformat()
    raise PivotError("期間の種類が違います。")


def clean_period(period):
    """{column, kind, n} を確かめる（無い・kind が空なら None）"""
    if not isinstance(period, dict) or not period.get("kind"):
        return None
    kind, col = str(period.get("kind")), str(period.get("column") or "")
    if kind not in PERIODS:
        raise PivotError("期間の種類が違います。")
    if not col:
        raise PivotError("期間で絞る日付の列を選んでください。")
    try:
        n = int(period.get("n") or 7)
    except (TypeError, ValueError):
        n = 7
    return {"column": col, "kind": kind, "n": n}


def _open_part(part, *, search, filters, rows, cols, measures, today, box, period):
    """1 つのファイルを読む: 表と列を決め、段・値を確かめ、絞り込みに当たる行の要る列だけを読む → 状態の dict"""
    work = part.work
    with connect_ro(part.path) as c:
        names = tables(c)
        t = part.table if part.table in names else pick_table(names, part.preferred_table, part.table_candidates)
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        cs = columns(c, t, raw_columns(c, t))
        start = start_column(cs, (work or {}).get("start", "")) if work else ""
        tcol = time_column(cs, start) if start else ""
        equip = part.equip or None
        if equip and equip.get("column") and equip["column"] not in cs:
            equip = None                              # 設備の列が無い表では、設備の段は使えない（下で断る）
        rd, cd = clean_dims(rows, cs, bool(start), bool(equip)), clean_dims(cols, cs, bool(start), bool(equip))
        ms = clean_measures(measures, cs)
        if box and box not in cs:
            raise PivotError(f"箱ひげの列「{box}」がありません。")
        if period and period["column"] != "@workday" and period["column"] not in cs:
            raise PivotError(f"期間で絞る列「{period['column']}」がありません。")
        if period and period["column"] == "@workday" and not start:
            raise PivotError("作業日の期間は作業実績だけで使えます。")
        ignored = [str(f.get("column") or "") for f in _filter_items(filters) if str(f.get("column") or "") and f.get("op") != "tuple_in"
                   and str(f.get("column")) not in cs]
        where_parts, params = search_filter_where(cs, search, filters, today)
        where = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        # 読む列: 段の列・値の列・ロットの鍵の列（作業実績は作業開始と時刻・異常ロット一覧はロット番号）・期間の列
        lot = lot_column(cs)
        need = []

        def use(col):
            if col and col not in need:
                need.append(col)
            return need.index(col) if col else -1
        pos = []
        for d in rd + cd:
            if d["column"] in WORK_DIMS:
                pos.append((use(start), use(tcol)))
            elif d["column"] == EQUIP_DIM:
                pos.append((use(equip.get("column", "")), -1))
            else:
                pos.append((use(d["column"]), -1))
        mpos = [use(m["column"]) if m["column"] else -1 for m in ms]
        bpos = use(box) if box else -1
        lots_by = "work" if start else "lot" if lot else ""
        kpos = (use(start), use(tcol)) if lots_by == "work" else (use(lot), -1) if lots_by == "lot" else (-1, -1)
        ppos = ((use(start), use(tcol)) if period["column"] == "@workday" else (use(period["column"]), -1)) if period else (-1, -1)
        total = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}{where}", params).fetchone()[0])
        if total > MAX_ROWS:
            raise PivotError(f"当たる行が多すぎます（{total:,} 行。{MAX_ROWS:,} 行まで）。条件で絞ってから集計してください。")
        data = c.execute(f"SELECT {', '.join(qi(x) for x in need) or '1'} FROM {qi(t)}{where}", params).fetchall() if need else [()] * total
    return {"name": part.name, "table": t, "cs": cs, "rd": rd, "cd": cd, "ms": ms, "pos": pos, "mpos": mpos, "bpos": bpos, "lots_by": lots_by,
            "kpos": kpos, "ppos": ppos, "start": start, "data": data, "clock": (work or {}).get("clock"), "basis": (work or {}).get("basis", "work"),
            "equip": equip, "ignored": ignored}


def _filter_items(filters):
    try:
        v = json.loads(filters) if isinstance(filters, str) and filters else (filters or [])
    except ValueError:
        return []
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def query_many(parts, *, search="", filters="", rows="", cols="", measures="", today=None, month="", box="", period=None, now=None):
    """いくつかのファイル（Part の並び）を 1 つの集計にまとめる（版 3.37.0。ダッシュボードの「作業実績 すべての設備」など）。
    段・値の決め方・答えの形は 1 ファイルのときと同じ。ロット数はファイルごとに見分ける（別の設備の同じ作業開始は別の作業）。
    ファイルが 2 つ以上なら、読めない・列が無いファイルは飛ばして skipped に出す（1 つなら断る）。直の段は名前で揃える（設備で勤務体系が違うため）。
    period … {column: 日付の列か "@workday", kind: PERIODS の鍵, n}。その元の「いま」（now。作業日は勤務体系の現場歴）から日の範囲を決めて絞る。
    設備の段 @equip … Part.equip で決める（作業実績は設備ごとのファイル・データ元は設備の列）"""
    t0 = time.perf_counter()
    period = clean_period(period)
    box = str(box or "")
    now = now or datetime.now()
    multi = len(parts) > 1
    states, skipped = [], []
    for part in parts:
        try:
            states.append(_open_part(part, search=search, filters=filters, rows=rows, cols=cols, measures=measures, today=today, box=box, period=period))
        except PivotError as e:
            if not multi:
                raise
            skipped.append({"name": part.name, "error": str(e)})
        except Exception as e:      # 読めないファイル（1 つなら呼んだ所が答える）
            if not multi:
                raise
            skipped.append({"name": part.name, "error": str(e)})
    if not states:
        raise PivotError("数えられるファイルがありません。" + "".join(f" {x['name']}: {x['error']}" for x in skipped[:3]))
    head = states[0]
    rd, cd, ms = head["rd"], head["cd"], head["ms"]
    # 期間で絞る: その元の「今日」（作業日は勤務体系で現場歴の日にする）から範囲を決め、範囲の日の行だけにする
    ranges = []
    if period:
        stamp = now.strftime("%Y-%m-%d %H:%M:%S")
        pdim = {"column": period["column"], "part": "" if period["column"] == "@workday" else "date"}
        for s in states:
            today_day = (s["clock"].place(stamp, s["basis"])[0] if period["column"] == "@workday" and s["clock"] else "") or now.date().isoformat()
            lo, hi = period_range(period["kind"], period["n"], today_day)
            pk, (a, b) = _Keyer(pdim, s["clock"], s["basis"]), s["ppos"]
            s["data"] = [r for r in s["data"] if lo <= (pk.key(r[a] if a >= 0 else None, r[b] if b >= 0 else None)[0] or "~") <= hi]
            if (lo, hi) not in ranges:
                ranges.append((lo, hi))
    # 月で絞る: 日の段の鍵（YYYY-MM-DD）の頭 7 字で月を決め、選んだ月の行だけにする（区間・傾向の数も、その月の行で決める）
    months, dd = set(), day_dim(rd)
    month = str(month or "") if dd >= 0 else ""
    if dd >= 0:
        for s in states:
            dk, (a, b) = _Keyer(s["rd"][dd], s["clock"], s["basis"]), s["pos"][dd]
            mk = [dk.key(r[a] if a >= 0 else None, r[b] if b >= 0 else None)[0][:7] for r in s["data"]]
            months |= {m for m in mk if m}
            if month:
                s["data"] = [r for r, m in zip(s["data"], mk) if m == month]
    # 区間の幅・起点を決める（幅 0 は自動）。全部のファイルの値で決め、どのファイルにも同じ幅を当てる。傾向の数も出す
    dims = rd + cd
    bins, stats = [], {}
    for i, d in enumerate(dims):
        if d["part"] != "bin":
            continue
        vals = [f for s in states for f in (num(r[s["pos"][i][0]]) for r in s["data"]) if f is not None]
        lo, hi = (min(vals), max(vals)) if vals else (0.0, 1.0)
        if not d["width"]:
            d["width"] = nice_width(lo, hi, len(vals))
            d["auto"] = True
        if d["origin"] is None:
            d["origin"] = math.floor(lo / d["width"]) * d["width"]
        for s in states[1:]:
            sd = (s["rd"] + s["cd"])[i]
            sd["width"], sd["origin"] = d["width"], d["origin"]
        bins.append({"dim": i, "column": d["column"], "width": d["width"], "origin": d["origin"], "auto": bool(d.get("auto")), "min": lo, "max": hi})
        stats[d["column"]] = describe(vals)
    nr, nc = len(rd), len(cd)
    lots_on = any(m["agg"] == "lots" for m in ms)
    # 1 行ずつ鍵を作り、行・列の段の頭の組（小計・総計）ごとに数える
    cells = {}
    box_vals = {}                      # 箱ひげ: 行の葉 → 数の並び
    seen = [dict() for _ in dims]      # 段ごとの {鍵: (並べる鍵, 見せる字)}
    single = 0
    count = 0
    for pi, s in enumerate(states):
        keyers = [_Keyer(d, s["clock"], s["basis"], equip=s["equip"], order=pi, by_name=multi) for d in s["rd"] + s["cd"]]
        pos, mpos, bpos, lots_by, kpos = s["pos"], s["mpos"], s["bpos"], s["lots_by"], s["kpos"]
        count += len(s["data"])
        for row in s["data"]:
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
                elif multi:
                    lk = (pi, lk)
            else:
                single += 1
                lk = single
            vals = [num(row[p]) if p >= 0 else None for p in mpos]
            rk, ck = ks[:nr], ks[nr:]
            if bpos >= 0:
                f = num(row[bpos])
                if f is not None:
                    box_vals.setdefault(tuple(rk), []).append(f)
            for a in range(nr + 1):
                for b in range(nc + 1):
                    key = (tuple(rk[:a]), tuple(ck[:b]))
                    acc = cells.get(key)
                    if acc is None:
                        acc = cells[key] = [0, set(), [[0.0, 0, None, None] for _ in ms]]
                    acc[0] += 1
                    if lots_by and lots_on:
                        acc[1].add(lk)
                    for j, f in enumerate(vals):
                        if f is None:
                            continue
                        x = acc[2][j]
                        x[0] += f
                        x[1] += 1
                        x[2] = f if x[2] is None or f < x[2] else x[2]
                        x[3] = f if x[3] is None or f > x[3] else x[3]
    lots_by = head["lots_by"] if all(s["lots_by"] for s in states) else ""
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
        x = acc[2][j]
        if not x[1]:
            return None
        return {"sum": x[0], "avg": x[0] / x[1], "min": x[2], "max": x[3]}[m["agg"]]

    def clean(x):          # 足し算の誤差（1248967.0999999992）を丸める
        return round(x, 6) if isinstance(x, float) else x
    out_cells = [{"r": list(k[0]), "c": list(k[1]), "v": [clean(value(acc, j, m)) for j, m in enumerate(ms)]} for k, acc in cells.items()]
    leaves = {k[0] for k in cells if len(k[0]) == nr}
    boxes = [{"r": list(k), **box_stats(v)} for k, v in box_vals.items() if k in leaves] if box else []
    note = "" if lots_by or not lots_on else "ロットを見分ける列（作業開始・ロット番号）が無いので、ロット数は行の数です。"
    ignored = sorted({c for s in states for c in s["ignored"]})
    out = {
        "table": head["table"], "count": count,
        "dims": {"rows": [{**d, "name": _dim_name(d)} for d in rd], "cols": [{**d, "name": _dim_name(d)} for d in cd]},
        "measures": [{**m, "name": _measure_name(m)} for m in ms],
        "orders": orders, "labels": labels, "cells": out_cells, "truncated": truncated,
        "bins": bins, "stats": stats, "box": box, "boxes": boxes, "lotsBy": lots_by, "start": head["start"], "note": note,
        "months": sorted(months), "month": month, "ignoredFilters": ignored,
        "timing": {"server": round((time.perf_counter() - t0) * 1000)},
    }
    if period:
        out["period"] = {**period, "name": PERIODS[period["kind"]], "ranges": [{"from": a, "to": b} for a, b in ranges]}
    if multi:
        out["parts"] = [{"name": s["name"], "table": s["table"], "count": len(s["data"])} for s in states]
        out["skipped"] = skipped
    return out


def fields(path, *, table="", preferred_table="", table_candidates=TABLE_CANDIDATES, sample=300):
    """集計の左のカラムの札に出す手がかり: 列ごとの値の種類の数（多ければ 1000+）と、数の列か（読める値がみな数）・日付の列か。"""
    with connect_ro(path) as c:
        names = tables(c)
        t = table if table in names else pick_table(names, preferred_table, table_candidates)
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        raw = raw_columns(c, t)
        cs = columns(c, t, raw)
        dates = set(date_columns(c, t, cs))
        out = []
        for col in cs:
            kinds = int(c.execute(f"SELECT COUNT(*) FROM (SELECT DISTINCT {qi(col)} FROM {qi(t)} LIMIT 1001)").fetchone()[0])
            vals = [r[0] for r in c.execute(f"SELECT {qi(col)} FROM {qi(t)} WHERE TRIM(CStr({qi(col)})) <> '' LIMIT {int(sample)}")]
            numeric = bool(vals) and all(num(v) is not None for v in vals)
            out.append({"column": col, "kinds": kinds, "many": kinds > 1000, "numeric": numeric, "date": col in dates})
    return {"table": t, "fields": out}
