# -*- coding: utf-8 -*-
"""作業実績を「作業」でまとめ、日ごと・日＋直ごとに数える（作業実績の画面の「作業でまとめる」）。

1 作業
    作業開始（既定の列 BOX実績_作業開始_日付）が同じ行は、その工程で幅分割・丈分割したロット（登録は別のロットでも作業は 1 回）。
    同じ作業開始の行を 1 作業＝1 ロットと数える。作業開始が空の行はまとめない（1 行で 1 作業）。
    時刻が別の列にあれば（〜_日付 に対する 〜_時刻）その時刻も合わせて見る。日時と読めない字は、同じ字どうしを 1 作業にする。

日・直（services/shifts.py。WaveLog の勤務体系と同じ決め方）
    日付は 2 通り: 現場歴（basis="work"。日を跨ぐ直の「跨いだ後」は日付補正の日として数える。既定）・太陽暦（basis="cal"）。
    直は作業開始の時刻が入る勤務区分。どの区分にも入らない時刻は「直の外」、時刻の無い値は「時刻なし」。
    数え方の答えはここ 1 か所（画面は受け取った日・直で描くだけ。画面にも同じ計算を置くと、片方だけ直した日に食い違う）。

一覧（lot_list.query の grouping）
    作業開始の新しい順（order="asc" で古い順）に並べ、同じ作業の行をサーバーが 1 か所に集める（ページの境目で作業を切らない）。
    答えの work に、ページの行ごとの [作業の鍵, 日, 直の番号, 作業開始] と、絞り込みに当たる全部の行の日・直ごとの数（buckets）を入れる。
"""
from __future__ import annotations

import math
import time
from datetime import date, timedelta

from .shifts import NO_TIME, OUTSIDE, Clock
from .sqlite_ro import qi, to_datetime

START_CANDIDATES = ("BOX実績_作業開始_日付",)
MAX_FILL_DAYS = 3660        # 0 件の日を埋める日数の上限（読み違えた古い日付で、何万行もの表にしない）
BASES = ("work", "cal")
ORDERS = ("desc", "asc")


def num(v):
    """数に読める値 → float（"1,234.5"・" 54"・数）。読めなければ None（合計に入れない）。ピボット集計（pivot.py）も同じ読み方"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    s = str(v).replace(",", "").strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def numeric_columns(c, t, cs, sample=200):
    """数の列（空でない値を先頭から sample 個読み、みな数に読める列）。合計する列の選び口に出す"""
    out = []
    for col in cs:
        vals = [r[0] for r in c.execute(f"SELECT {qi(col)} FROM {qi(t)} WHERE TRIM(CStr({qi(col)})) <> '' LIMIT {int(sample)}")]
        if vals and all(num(v) is not None for v in vals):
            out.append(col)
    return out


def start_column(cs, preferred=""):
    """作業開始の列: 選んだ列（あれば）→ 既定の名前 → 「作業開始」を含み日付・日時の列。無ければ ""。"""
    if preferred and preferred in cs:
        return preferred
    for c in START_CANDIDATES:
        if c in cs:
            return c
    return next((c for c in cs if "作業開始" in c and ("日付" in c or "日時" in c)), "")


def time_column(cs, start):
    """作業開始の時刻が別の列にあるとき、その列（〜日付 → 〜時刻・〜時間）。無ければ ""。"""
    if not start.endswith("日付"):
        return ""
    return next((start[:-2] + x for x in ("時刻", "時間") if start[:-2] + x in cs), "")


def work_key(v, t=None):
    """1 作業の鍵: 日時と読めれば 'YYYY-MM-DD[ HH:MM:SS]'、読めなければ字（前後の空白を除く）、空なら ""（まとめない）。"""
    stamp = to_datetime(v, t)
    if stamp:
        return stamp
    raw = "" if v is None else str(v).strip()
    return f"?{raw}|{'' if t is None else str(t).strip()}" if raw else ""


class Grouping:
    """lot_list.query に渡す係（prepare で鍵と並びを決め、extra で答えに日・直を足す）。"""

    def __init__(self, segments, *, column="", basis="work", order="desc", pattern=None, day="", shift=None, total="", fill=False):
        self.clock = Clock(segments)
        self.day = day if isinstance(day, str) and (len(day) == 10 or day == "-") else ""     # 帯で押した日（"-" は日付なし）
        self.shift = shift if isinstance(shift, int) else None                                 # 帯で押した直の番号（日と組で）
        self.preferred = column
        self.basis = basis if basis in BASES else "work"
        self.order = order if order in ORDERS else "desc"
        self.pattern = pattern
        self.total = total if isinstance(total, str) else ""     # 日・直ごとに合計する数の列（例: BOX実績_良品重量）。無ければ ""
        self.fill = bool(fill)                                    # 作業の無い日（0 件の日）も、最初の日から最後の日まで埋めて出す
        self.column = self.time_col = ""

    def _args(self):
        return f"{qi(self.column)}, {qi(self.time_col) if self.time_col else 'NULL'}"

    def prepare(self, c, t, cs):
        self.column = start_column(cs, self.preferred)
        self.time_col = time_column(cs, self.column) if self.column else ""
        if not self.column:
            return None
        c.create_function("WorkKey", 2, work_key, deterministic=True)
        c.create_function("WorkStamp", 2, to_datetime, deterministic=True)
        stamp = f"WorkStamp({self._args()})"
        plan = {"key": f"WorkKey({self._args()})",
                # 読めない作業開始（空・日時でない字）はいつも後ろ。同じ時刻の作業どうしは鍵で分ける（違う作業の行が混ざらない）
                "lead": [f"{stamp} IS NULL", f"{stamp} {self.order.upper()}", f"WorkKey({self._args()})"]}
        if self.day:
            # 日・直の決め方は summarize と同じ Clock.place（ここ 1 か所の決まりを SQL からも呼ぶ）
            c.create_function("WorkPlace", 2, lambda v, tv: "{}|{}".format(*self.clock.place(to_datetime(v, tv), self.basis)), deterministic=True)
            day = "" if self.day == "-" else self.day
            if self.shift is None:
                plan["where"] = ([f"WorkPlace({self._args()}) LIKE ?"], [day.replace("%", "") + "|%"])
            else:
                plan["where"] = ([f"WorkPlace({self._args()}) = ?"], [f"{day}|{self.shift}"])
        return plan

    def _place(self, v, tv):
        stamp = to_datetime(v, tv)
        day, idx = self.clock.place(stamp, self.basis)
        return work_key(v, tv), day, idx, stamp or ""

    def extra(self, c, t, cs, date_cols, where, params, rows):
        total_col = self.total if self.total in cs else ""
        info = {"column": self.column, "timeColumn": self.time_col, "basis": self.basis, "order": self.order, "totalColumn": total_col, "fill": self.fill,
                "numeric": numeric_columns(c, t, cs),
                "pick": {"day": self.day, "shift": self.shift} if self.day else None,
                "candidates": [x for x in date_cols if x != self.time_col], "pattern": self.pattern,
                "shifts": [{k: s[k] for k in ("name", "start", "end", "dayOffset", "crosses")} for s in self.clock.segments]}
        if not self.column:
            return {"work": {**info, "rows": [], "buckets": [], "total": summarize([], self.clock, self.basis)["total"]}}
        tc = self.time_col
        info["rows"] = [list(self._place(r.get(self.column), r.get(tc) if tc else None)) for r in rows]
        t0 = time.perf_counter()
        pairs = c.execute(f"SELECT {qi(self.column)}, {qi(tc) if tc else 'NULL'}, {qi(total_col) if total_col else 'NULL'} FROM {qi(t)}{where}", params).fetchall()
        info.update(summarize(pairs, self.clock, self.basis, self.order, fill=self.fill))
        info["ms"] = round((time.perf_counter() - t0) * 1000)
        return {"work": info}


def _shift_rank(idx):
    if idx is None:                             # 0 件の日の行（直は無い）
        return -1
    return idx if idx >= 0 else 1000 - idx      # 区分の順 → 直の外 → 時刻なし


def empty_days(days, limit=MAX_FILL_DAYS):
    """作業のあった日（'YYYY-MM-DD'）の最初から最後までのうち、作業の無い日。→ (日の並び, 埋めなかった日数)。
    最初から最後までが limit 日を超えるとき（読み違えた古い日付など）は埋めず、その日数を返す。"""
    have = sorted({d for d in days if d})
    if len(have) < 2:
        return [], 0
    first, last = date.fromisoformat(have[0]), date.fromisoformat(have[-1])
    span = (last - first).days + 1
    if span > limit:
        return [], span
    have = set(have)
    return [d for d in ((first + timedelta(days=i)).isoformat() for i in range(span)) if d not in have], 0


def summarize(pairs, clock, basis="work", order="desc", fill=False):
    """(作業開始, 時刻[, 合計する数]) の並び → 日・直ごとの作業の数。
    → {"buckets": [{day, shift, works, rows, split, sum}], "total": {works, rows, split, noTime, noStamp, sum}, "empty": n, "fillSkipped": 日数}
    fill: 作業の無い日（最初の日から最後の日までの間）も、数 0・直 None の行として入れる（日の表で 0 件の日を出す）。
      empty はその日数。最初から最後までが MAX_FILL_DAYS を超えると埋めず、fillSkipped にその日数を入れる。
    works: 作業の数（同じ作業開始の行は 1）・rows: 行の数・split: 2 行以上の作業（分割したロット）の数。
    sum: 合計する数の列の、行ごとの値の合計（分割したロットも 1 行ずつ足す＝その日に作業した重量など。数に読めない値は足さない）。
    noTime: 時刻の無い作業の数（直を決められない）・noStamp: 作業開始が空か日時と読めない行の数。"""
    works, single = {}, 0
    for p in pairs:
        v, tv = p[0], p[1]
        x = num(p[2]) if len(p) > 2 else None
        k = work_key(v, tv)
        if not k:
            single += 1
            k = ("#", single)
        w = works.get(k)
        if w is None:
            works[k] = [v, tv, 1, x or 0.0]
        else:
            w[2] += 1
            w[3] += x or 0.0
    buckets, total = {}, {"works": 0, "rows": 0, "split": 0, "noTime": 0, "noStamp": 0, "sum": 0.0}
    for v, tv, n, x in works.values():
        stamp = to_datetime(v, tv)
        day, idx = clock.place(stamp, basis)
        b = buckets.setdefault((day, idx), {"day": day, "shift": idx, "works": 0, "rows": 0, "split": 0, "sum": 0.0})
        b["works"] += 1
        b["rows"] += n
        b["split"] += n > 1
        b["sum"] += x
        total["works"] += 1
        total["rows"] += n
        total["split"] += n > 1
        total["sum"] += x
        total["noTime"] += bool(stamp) and idx == NO_TIME
        total["noStamp"] += 0 if stamp else n
    for b in list(buckets.values()) + [total]:
        b["sum"] = round(b["sum"], 6)          # 足し算の誤差を丸める
    empty, skipped = empty_days([d for d, _ in buckets]) if fill else ([], 0)
    for d in empty:
        buckets[(d, None)] = {"day": d, "shift": None, "works": 0, "rows": 0, "split": 0, "sum": 0.0}
    days = sorted({d for d, _ in buckets if d}, reverse=order == "desc")
    rank = {d: i for i, d in enumerate(days)}
    out = sorted(buckets.values(), key=lambda b: (rank.get(b["day"], len(days)), _shift_rank(b["shift"])))
    return {"buckets": out, "total": total, "outside": OUTSIDE, "noTimeIndex": NO_TIME, "empty": len(empty), "fillSkipped": skipped}
