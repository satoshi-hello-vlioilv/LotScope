# -*- coding: utf-8 -*-
"""基準の数（版 3.103.0。利用者の要望 2026-11-12: 直単位・日単位の実績など、設備の実力を見る計算を汎用に）。

集計（services/pivot.py の query_many）のセルごとに、そのセルの行から数える数。値の計算（services/num_expr.py）の式で ［稼働直］ のように読み、
値を割る（値の per）・値として出す（agg "base"）・作った数の式に使う。窓は desktop/src/capacity.rs（同じ決め方。dash_parity・pivot_parity で突き合わせる）。
Python に頼らない独立の答えは tools/capacity-truth.py（tests/test_capacity.py）。

決まった数（FIXED。セルごと）:
    稼働直     … 実績のある（作業日 × 直）の数。設備ごとに数えて足す（直の分からない行〈直の外・時刻なし〉は数えない）
    稼働日     … 実績のある作業日の数（設備ごとに数えて足す）。作業日・直の無いデータ元は、日付の列（期間の列か、日付の段の列）の異なる日の数
    1日の直数  … その設備の勤務体系の直の数（セルが直の段で絞られていれば、その直だけ＝1 か 0）。設備が複数のセルは、どの設備も同じときだけその数
    期間の日数 … パネルの期間の日数（作業日・その日付の段で絞られたセルは、その範囲と重なる日数）。期間で絞らないパネルは、そのセルの
                 最初と最後の作業日の間の日数（両端を含む）
    期間の直数 … 期間の日数 × 1日の直数（設備ごとに掛けて足す）
作った数（own。ダッシュボードで共通。{name, expr, each?, unit?}）: 決まった数の式（値 x は使わない）。each=True は設備ごとに式を当てて足す
    （換算稼働日＝稼働直÷1日の直数）。無ければセルの数で式を当てる（稼働率＝稼働直÷期間の直数×100）
セルの設備（足す設備）: そのセルの設備の段（@equip・@egroup）に当たる、パネルのすべての設備（その期間に実績の無い設備も入る。
    稼働率の分母に休んだ設備も入れるため）。作業実績は設備ごとのファイル、データ元は設備の列の値（設備の列が無ければ 1 つ）
総計・小計を割るとき: 行の比の平均ではなく Σ分子 ÷ Σ分母（セルの値をセルの基準の数で割るので、そうなる）
"""
from __future__ import annotations

from datetime import date, timedelta

from . import num_expr

SHIFTS, DAYS, SPD, PDAYS, PSHIFTS = "稼働直", "稼働日", "1日の直数", "期間の日数", "期間の直数"
FIXED = (SHIFTS, DAYS, SPD, PDAYS, PSHIFTS)
NEED_SHIFT = (SHIFTS, SPD, PSHIFTS)          # 勤務体系の直が要る数（作業実績だけ）
UNIT = {SHIFTS: "直", DAYS: "日", SPD: "直", PDAYS: "日", PSHIFTS: "直"}
HOW = {SHIFTS: "実績のある直の数（作業日×直）", DAYS: "実績のある作業日の数", SPD: "勤務体系の直の数",
       PDAYS: "パネルの期間の日数（期間なしはセルの最初〜最後の作業日）", PSHIFTS: "期間の日数×1日の直数"}
DEFAULT_OWN = [{"name": "換算稼働日", "expr": "[稼働直]÷[1日の直数]", "each": True, "unit": "日"},
               {"name": "稼働率", "expr": "[稼働直]÷[期間の直数]×100", "unit": "%"}]
OWN_MAX = 12
NAME_MAX = 16
EXPR_MAX = 60
UNIT_MAX = 6


def clean_own(v):
    """作った数の並び → [{name, expr, each?, unit?}]（読めない・名前の重なる・決まった数と同じ名前の物は外す）。並びでなければ None"""
    if not isinstance(v, list):
        return None
    out, seen = [], set()
    for x in v:
        if not isinstance(x, dict):
            continue
        name = str(x.get("name") or "").strip()[:NAME_MAX]
        expr = str(x.get("expr") or "").strip()[:EXPR_MAX]
        if not name or "[" in name or "]" in name or name in FIXED or name in seen:
            continue
        _fn, err, _t = num_expr.compile_expr(expr, names=FIXED, need_x=False)
        if err or not _fn:
            continue
        seen.add(name)
        b = {"name": name, "expr": expr}
        if x.get("each") is True:
            b["each"] = True
        unit = str(x.get("unit") or "").strip()[:UNIT_MAX] if isinstance(x.get("unit"), str) else ""
        if unit:
            b["unit"] = unit
        out.append(b)
        if len(out) >= OWN_MAX:
            break
    return out


def names_of(own):
    return list(FIXED) + [b["name"] for b in own or []]


def uses(measures, own):
    """値が使う基準の数 → (決まった数の集まり, 作った数の名前の集まり)。何も使わなければ (空, 空)"""
    byname = {b["name"]: b for b in own or []}
    want = set()
    for m in measures:
        if m.get("agg") == "base":
            want.add(m.get("base"))
        if m.get("per"):
            want.add(m["per"])
        if m.get("expr"):
            want |= set(_vars_in(m["expr"]))
    fixed = {w for w in want if w in FIXED}
    mine = {w for w in want if w in byname}
    for w in mine:
        fixed |= set(_vars_in(byname[w]["expr"])) & set(FIXED)
    if PSHIFTS in fixed:
        fixed |= {PDAYS, SPD}
    return fixed, mine


def _vars_in(expr):
    return [p[1:-1] for i, p in enumerate(num_expr._PIECES.split(num_expr.normalize(expr))) if i % 2]


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days + 1


def key_span(part, key):
    """日の段の鍵 → (はじめ, おわり)。読めなければ None（日付なし）"""
    if not key:
        return None
    try:
        if part in ("", "date"):
            date.fromisoformat(key)
            return key, key
        if part == "ym":
            y, m = int(key[:4]), int(key[5:7])
            first = date(y, m, 1)
            nxt = date(y + m // 12, m % 12 + 1, 1)
            return first.isoformat(), (nxt - timedelta(days=1)).isoformat()
        if part == "year":
            return f"{int(key):04d}-01-01", f"{int(key):04d}-12-31"
    except ValueError:
        return None
    return None


class Unit:
    """足す設備 1 つ（作業実績は 1 ファイル＝1 設備・データ元は設備の列の値）"""
    __slots__ = ("pi", "name", "spd", "names", "range", "ekeys")

    def __init__(self, pi, name, segments, rng):
        self.pi, self.name, self.range = pi, name, rng
        self.spd = len(segments) if segments is not None else None
        self.names = [s["name"] for s in segments] if segments is not None else None
        self.ekeys = []


class Cells:
    """セルごと・設備ごとに（作業日, 直）と作業日をためる係。query_many が 1 行ずつ add し、最後に env でセルの数を出す"""

    def __init__(self, fixed, own_names, own, dims, nr, period_col, by_name):
        self.fixed, self.own = fixed, [b for b in own if b["name"] in own_names]
        self.fns = {b["name"]: num_expr.compile_expr(b["expr"], names=FIXED, need_x=False)[0] for b in self.own}
        self.dims, self.nr, self.by_name = dims, nr, by_name
        self.units = []                   # Unit の並び（見つけた順）
        self.hidden = set()               # 数えない設備（設備のまとめで「出さない」設備）の番号
        self.unit_at = {}
        self.at = {}                      # セルの鍵 → {設備の番号: [直の集まり, 日の集まり]}・[最初の日, 最後の日]
        self.span = {}
        # 期間の日数を切る段（期間の列と同じ日の段）・直の段・設備の段
        self.clip = [i for i, d in enumerate(dims) if period_col and (
            (period_col == "@workday" and d["column"] == "@workday") or (d["column"] == period_col and d["part"] in ("date", "ym", "year")))]
        self.shift_dims = [i for i, d in enumerate(dims) if d["column"] == "@shift"]
        self.equip_dims = [i for i, d in enumerate(dims) if d["column"] in ("@equip", "@egroup")]

    def unit(self, pi, name, segments, rng):
        k = (pi, name)
        u = self.unit_at.get(k)
        if u is None:
            u = self.unit_at[k] = len(self.units)
            self.units.append(Unit(pi, name, segments, rng))
        return u

    def add(self, keys, u, day, idx):
        """keys … そのセルの鍵の並び（行・列の段の頭の組）。day … その行の作業日（無ければ ""）・idx … 直の番号（0 から。分からなければ負）"""
        for key in keys:
            c = self.at.get(key)
            if c is None:
                c = self.at[key] = {}
            e = c.get(u)
            if e is None:
                e = c[u] = [set(), set()]
            if day:
                e[1].add(day)
                if idx >= 0:
                    e[0].add((day, idx))
                sp = self.span.get(key)
                if sp is None:
                    self.span[key] = [day, day]
                else:
                    if day < sp[0]:
                        sp[0] = day
                    if day > sp[1]:
                        sp[1] = day

    def _members(self, key):
        """そのセルに当たる設備（設備の段の鍵が同じ設備。設備の段が無ければ全部）"""
        rk, ck = key
        fixed = [(i, rk[i]) for i in self.equip_dims if i < self.nr and i < len(rk)]
        fixed += [(i, ck[i - self.nr]) for i in self.equip_dims if i >= self.nr and i - self.nr < len(ck)]
        return [j for j, u in enumerate(self.units) if j not in self.hidden and all(u.ekeys[self.equip_dims.index(i)] == k for i, k in fixed)]

    def _key_at(self, key, i):
        rk, ck = key
        if i < self.nr:
            return rk[i] if i < len(rk) else None
        return ck[i - self.nr] if i - self.nr < len(ck) else None

    def _spd(self, u, key):
        if u.spd is None:
            return None
        sk = [self._key_at(key, i) for i in self.shift_dims]
        sk = [k for k in sk if k is not None]
        if not sk:
            return u.spd
        n = 0
        for idx, nm in enumerate(u.names):
            mine = nm if self.by_name else str(idx)
            if all(k == mine for k in sk):
                n += 1
        return n

    def _clipped(self, u, key):
        """設備 u の期間を、セルの日の段（期間の列と同じ日の段）の範囲で切った (はじめ, おわり)。重ならなければ None"""
        if not u.range:
            return None
        lo, hi = u.range
        for i in self.clip:
            k = self._key_at(key, i)
            if k is None:
                continue
            sp = key_span(self.dims[i]["part"], k)
            if sp is None:
                return None
            lo, hi = max(lo, sp[0]), min(hi, sp[1])
        return (lo, hi) if lo <= hi else None

    def _pdays(self, u, key):
        """設備 u の期間の日数（期間で絞るパネル）。期間で絞らなければ None（セルの最初〜最後の日）"""
        if not u.range:
            return None
        c = self._clipped(u, key)
        return _days(*c) if c else 0

    def env(self, key):
        """セルの鍵 → {基準の数の名前: 数か None}"""
        c = self.at.get(key, {})
        mem = self._members(key)
        sp = self.span.get(key)
        cell_span = _days(*sp) if sp else 0
        per = []
        for j in mem:
            u = self.units[j]
            e = c.get(j)
            sh, dy = (len(e[0]), len(e[1])) if e else (0, 0)
            spd = self._spd(u, key)
            pd = self._pdays(u, key)
            pd = cell_span if pd is None else pd
            per.append({SHIFTS: sh, DAYS: dy, SPD: spd, PDAYS: pd, PSHIFTS: None if spd is None else pd * spd})
        out = {SHIFTS: sum(x[SHIFTS] for x in per), DAYS: sum(x[DAYS] for x in per)}
        spds = {x[SPD] for x in per}
        out[SPD] = next(iter(spds)) if len(spds) == 1 else None
        if any(self.units[j].range for j in mem):
            # 設備ごとの（切った）期間を重ねた日数（同じ日は 1 つ）
            spans = sorted(x for x in (self._clipped(self.units[j], key) for j in mem) if x)
            n, end = 0, None
            for lo, hi in spans:
                if end is None or lo > end:
                    n += _days(lo, hi)
                    end = hi
                elif hi > end:
                    n += _days(end, hi) - 1
                    end = hi
            out[PDAYS] = n
        else:
            out[PDAYS] = cell_span
        out[PSHIFTS] = None if any(x[PSHIFTS] is None for x in per) or not per else sum(x[PSHIFTS] for x in per)
        for b in self.own:
            fn = self.fns[b["name"]]
            if b.get("each"):
                vals = [fn(None, x) for x in per]
                out[b["name"]] = None if not vals or any(v is None for v in vals) else sum(vals)
            else:
                out[b["name"]] = fn(None, out)
        return out
