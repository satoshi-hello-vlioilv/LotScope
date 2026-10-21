# -*- coding: utf-8 -*-
"""設備の稼働（版 3.46.0。利用者の要望 2026-10-21 の 1・2）: 作業実績の作業開始・作業終了から、設備ごとの
稼働の区間（ガントチャート）・勤務時間・稼働率と、品種ごとの ABC 分析・換算係数を数える。画面は static/js/dashboard-panels.js（gantt・abc）。

作業（1 本）
    作業開始が同じ行は、その工程で幅・丈で分割したロット（作業は 1 回。work_summary と同じ決まり）。作業の区間は
    [作業開始, その行たちの作業終了のいちばん遅い時刻)。作業終了が無い・作業開始より前・MAX_HOURS を超える作業は区間を持たない（noEnd に数える）
稼働率（利用者が決めた: 分母は勤務時間＝直の時間）
    勤務時間 … その設備の勤務体系（マスタ管理の「勤務体系」。設備を書いた体系 → 全設備共通）の区分を、期間の作業日（現場歴か太陽暦）ごとに並べた時間。
               日を跨ぐ区分は 0 時で 2 つに分け、それぞれの作業日を shifts.Clock.place で決める（作業日・直の決め方と同じ 1 か所）
    稼働時間 … 作業の区間を重ねて（同じ時刻に 2 つ動いても 1 と数える）、勤務時間と重なる分。勤務時間の外の稼働は outside に別に数える
    稼働率   … 稼働時間 ÷ 勤務時間。勤務体系が無い設備は出さない（None）
換算係数（利用者が決めた: 作業時間から自動で出す）
    品種（選んだ列の値。合金・板厚の区分など）ごとの 1 本あたりの平均作業時間 ÷ 基準の作業時間。基準は
    avg（その設備の全作業の 1 本あたりの平均）・top（いちばん本数の多い品種の平均）・値（その品種の平均）。換算量＝本数 × 係数
ABC 分析
    品種を量（本数・作業時間・数の列の合計）の大きい順に並べ、累積構成比が A の線（既定 70%）までを A、B の線（既定 90%）までを B、残りを C
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from .lot_list import columns, lot_column, pick_table, raw_columns, search_filter_where, tables
from .pivot import PivotError, calc_exprs, period_prefilter, period_range
from .shifts import Clock, hm
from .sqlite_ro import connect_ro, qi, to_datetime
from .work_summary import start_column, time_column, work_key

END_CANDIDATES = ("BOX実績_作業終了_日付",)
MAX_HOURS = 48            # 1 作業の長さの上限（これより長いのは読み違い・書き忘れとみなし、区間を持たせない）
MAX_OPS = 1500            # 1 台のガントに出す作業の数（答えの大きさ）。超えた分は数には入れ、棒は出さない（truncated）
MAX_DAYS = 62             # ガントの期間の上限（作業日）
MAX_ROWS = 400_000
QTYS = ("lots", "time")   # 量: 本数・作業時間（分）。ほかは数の列の名前（その列の合計）
BASES = ("avg", "top")    # 換算の基準。ほかは品種の値


def end_column(cs, preferred="", start=""):
    """作業終了の列: 選んだ列（あれば）→ 既定の名前 → 作業開始の列の「開始」を「終了」にした名前 → 「作業終了」を含む日付・日時の列。無ければ ""。"""
    if preferred and preferred in cs:
        return preferred
    for c in END_CANDIDATES:
        if c in cs:
            return c
    if start and "開始" in start and start.replace("開始", "終了") in cs:
        return start.replace("開始", "終了")
    return next((c for c in cs if "作業終了" in c and ("日付" in c or "日時" in c)), "")


def _dt(stamp):
    """'YYYY-MM-DD HH:MM:SS' → datetime（時刻の無い日付・読めない字は None）"""
    if not stamp or len(stamp) < 16:
        return None
    try:
        return datetime.fromisoformat(stamp)
    except ValueError:
        return None


def _iso(t):
    return t.strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 勤務時間（直の時間帯）
def shift_windows(segments, first, last, basis="work"):
    """作業日 first〜last（'YYYY-MM-DD'。両端を含む）の勤務時間 → [(始め, 終わり, 区分の名前, 作業日)]（始めの順）。
    日を跨ぐ区分は 0 時で分け、分けたそれぞれの作業日を Clock.place で決める（作業日・直の決め方と同じ）"""
    clock = Clock(segments)
    lo, hi = date.fromisoformat(first), date.fromisoformat(last)
    out = []
    d = lo - timedelta(days=1)
    while d <= hi + timedelta(days=1):
        base = datetime(d.year, d.month, d.day)
        for seg in segments:
            s, e = hm(seg["start"]), hm(seg["end"])
            a, b = base + timedelta(minutes=s), base + timedelta(minutes=e if e > s else e + 24 * 60)
            pieces = [(a, b)] if e > s else [(a, base + timedelta(days=1)), (base + timedelta(days=1), b)]
            for x, y in pieces:
                if x >= y:
                    continue
                day, _ = clock.place(_iso(x), basis)
                if first <= day <= last:
                    out.append((x, y, seg["name"], day))
        d += timedelta(days=1)
    out.sort(key=lambda w: w[0])
    return out


def merge(spans):
    """区間 [(始め, 終わり)] を重ねる（同じ時刻に 2 つの作業が動いても 1 と数える）"""
    out = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            if b > out[-1][1]:
                out[-1][1] = b
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def overlap_minutes(spans, a, b):
    """重ねた区間 spans と [a, b) の重なり（分）"""
    t = 0.0
    for x, y in spans:
        lo, hi = max(x, a), min(y, b)
        if hi > lo:
            t += (hi - lo).total_seconds() / 60
    return t


def utilization(ops, windows):
    """作業の並び（start・end を持つ dict）と勤務時間 → {shiftMin, busyMin, outsideMin, rate, byShift: [{day, shift, min, busy, rate}]}"""
    spans = merge([(o["start"], o["end"]) for o in ops if o.get("end")])
    shift_min = sum((b - a).total_seconds() / 60 for a, b, _, _ in windows)
    by = {}
    for a, b, name, day in windows:
        x = by.setdefault((day, name), {"day": day, "shift": name, "min": 0.0, "busy": 0.0})
        x["min"] += (b - a).total_seconds() / 60
        x["busy"] += overlap_minutes(spans, a, b)
    busy = sum(x["busy"] for x in by.values())
    total = sum((b - a).total_seconds() / 60 for a, b in spans)       # 期間の作業（作業日で選んだ作業）の稼働のすべて
    rows = []
    for x in by.values():
        rows.append({**x, "min": round(x["min"], 2), "busy": round(x["busy"], 2), "rate": round(x["busy"] / x["min"], 4) if x["min"] else None})
    return {"shiftMin": round(shift_min, 2), "busyMin": round(busy, 2), "outsideMin": round(max(0.0, total - busy), 2),
            "rate": round(busy / shift_min, 4) if shift_min else None, "byShift": rows}


# ---------------------------------------------------------------- 作業を読む
def read_ops(part, *, search="", filters="", today=None, calc=None, period=None, now=None, end="", cols=()):
    """1 つのファイル（作業実績の 1 設備）→ {ops: [{start, end, key, n, values: {列: 最初の行の値}, nums: {列: 合計}}], columns, start, end, range}。
    期間 period は作業日（@workday）か日付の列。作業日の範囲（range）に作業開始の作業日が入る作業だけ。cols … 作業ごとに持たせる列"""
    work = part.work or {}
    clock, basis = work.get("clock") or Clock([]), work.get("basis", "work")
    now = now or datetime.now()
    with connect_ro(part.path) as c:
        names = tables(c)
        t = part.table if part.table in names else pick_table(names, part.preferred_table, part.table_candidates)
        if not t:
            raise PivotError("表が 1 つもありません。")
        raw = columns(c, t, raw_columns(c, t))
        exprs, broken, _ = calc_exprs(c, calc, raw)
        cs = raw + [x for x in exprs if x not in raw]
        start = start_column(cs, work.get("start", ""))
        if not start:
            raise PivotError("作業開始の列がありません（作業実績だけで使えます）。")
        stop = end_column(cs, end, start)
        if not stop:
            raise PivotError("作業終了の列が見つかりません（組む所の「作業終了の列」で選んでください）。")
        tcol, etcol = time_column(cs, start), time_column(cs, stop)
        lot = lot_column(cs)
        want = [x for x in dict.fromkeys(list(cols) + [lot]) if x and x in cs]      # ロット番号はいつも（棒の字の既定）
        bad = [x for x in want if x in broken]
        if bad:
            raise PivotError(f"計算列「{'」「'.join(bad)}」の式が読めません（一覧の「表示列」で式を直してください）。")
        where_parts, params = search_filter_where(raw, search, filters, today, exprs)
        span = None
        if period:
            day = clock.place(now.strftime("%Y-%m-%d %H:%M:%S"), basis)[0] if period["column"] == "@workday" else now.date().isoformat()
            span = period_range(period["kind"], period.get("n"), day or now.date().isoformat())
            pcol = start if period["column"] == "@workday" else period["column"]
            if pcol not in cs:
                raise PivotError(f"期間で絞る列「{pcol}」がありません。")
            if pcol in raw:
                w, wp = period_prefilter(pcol, span)
                if w:
                    where_parts, params = where_parts + [w], params + wp
        where = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        n = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}{where}", params).fetchone()[0])
        if n > MAX_ROWS:
            raise PivotError(f"当たる行が多すぎます（{n:,} 行。{MAX_ROWS:,} 行まで）。期間・条件で絞ってください。")
        sel = [start, tcol, stop, etcol] + want + ([period["column"]] if period and period["column"] not in ("@workday", start) else [])
        data = c.execute(f"SELECT {', '.join(exprs.get(x) or qi(x) if x else 'NULL' for x in sel)} FROM {qi(t)}{where}", params).fetchall()
    ops = {}
    pi = 4 + len(want)
    for row in data:
        stamp = to_datetime(row[0], row[1])
        if period:
            if period["column"] in ("@workday", start):
                day = clock.place(stamp, basis)[0] if stamp else ""
            else:
                day = (to_datetime(row[pi]) or "")[:10]
            if not day or not span[0] <= day <= span[1]:
                continue
        k = work_key(row[0], row[1])
        if not k:
            k = f"#{len(ops)}"                 # 作業開始が空の行は 1 行で 1 作業
        o = ops.get(k)
        if o is None:
            o = ops[k] = {"key": k, "start": _dt(stamp), "end": None, "n": 0, "values": {}, "nums": {}, "day": clock.place(stamp, basis)[0] if stamp else ""}
        o["n"] += 1
        e = _dt(to_datetime(row[2], row[3]))
        if e is not None and (o["end"] is None or e > o["end"]):
            o["end"] = e
        for i, col in enumerate(want):
            v = row[4 + i]
            o["values"].setdefault(col, v)
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            o["nums"][col] = o["nums"].get(col, 0.0) + f
    out = []
    for o in ops.values():
        if o["start"] is None or o["end"] is None or o["end"] <= o["start"] or o["end"] - o["start"] > timedelta(hours=MAX_HOURS):
            o["end"] = None
        out.append(o)
    out.sort(key=lambda o: (o["start"] is None, o["start"] or datetime.min))
    return {"ops": out, "columns": cs, "start": start, "end": stop, "range": span, "lot": lot}


def minutes(o):
    return (o["end"] - o["start"]).total_seconds() / 60 if o.get("end") and o.get("start") else None


# ---------------------------------------------------------------- ガントチャート
def gantt(name, read, windows, *, label="", color=""):
    """1 台の答え → {name, ops: [[始め, 終わり, 字, 色の値, 本数]], windows: [[始め, 終わり, 直, 作業日]], noEnd, count, truncated, …稼働率}"""
    ops = read["ops"]
    u = utilization(ops, windows)
    bars, no_end = [], 0
    for o in ops:
        if o["end"] is None:
            no_end += 1
            continue
        if len(bars) < MAX_OPS:
            text = str(o["values"].get(label) if label else "") if label else ""
            bars.append([_iso(o["start"]), _iso(o["end"]), "" if text in ("None",) else text, str(o["values"].get(color) or "") if color else "", o["n"]])
    return {"name": name, **u, "ops": bars, "windows": [[_iso(a), _iso(b), s, d] for a, b, s, d in windows], "noEnd": no_end,
            "count": len(ops), "truncated": len(ops) - no_end > MAX_OPS}


# ---------------------------------------------------------------- ABC 分析と換算係数
def abc(ops, cls, qty="lots", base="avg", limits=(70.0, 90.0)):
    """作業の並び → 品種ごとの {key, lots, minutes（作業時間の合計）, avg（1 本の平均作業時間）, qty, share, cum, rank（A/B/C）, factor, conv}。
    量の大きい順。lots は作業の本数（分割ロットは 1）。avg・factor は作業時間が分かる作業だけで出す"""
    by = {}
    for o in ops:
        k = o["values"].get(cls)
        k = "" if k is None else str(k).strip()
        x = by.setdefault(k, {"key": k, "lots": 0, "timed": 0, "minutes": 0.0, "sum": 0.0})
        x["lots"] += 1
        m = minutes(o)
        if m is not None:
            x["timed"] += 1
            x["minutes"] += m
        if qty not in QTYS:
            x["sum"] += o["nums"].get(qty, 0.0)
    items = list(by.values())
    for x in items:
        x["avg"] = x["minutes"] / x["timed"] if x["timed"] else None
        x["qty"] = x["lots"] if qty == "lots" else x["minutes"] if qty == "time" else x["sum"]
    items.sort(key=lambda x: (-x["qty"], x["key"]))
    total = sum(x["qty"] for x in items)
    a_lim, b_lim = limits
    run = 0.0
    for i, x in enumerate(items):
        run += x["qty"]
        x["share"] = round(x["qty"] / total * 100, 4) if total else 0.0
        x["cum"] = round(run / total * 100, 4) if total else 0.0
        # 累積構成比が A の線までを A・B の線までを B・残りを C（いちばん大きい品種は、それだけで線を超えても A）
        x["rank"] = "A" if i == 0 or x["cum"] <= a_lim + 1e-9 else "B" if x["cum"] <= b_lim + 1e-9 else "C"
    timed = [x for x in items if x["avg"] is not None]
    if base == "avg":
        n = sum(x["timed"] for x in timed)
        ref = sum(x["minutes"] for x in timed) / n if n else None
        ref_name = "全作業の平均"
    elif base == "top":
        top = max(timed, key=lambda x: (x["lots"], -items.index(x)), default=None)
        ref, ref_name = (top["avg"], f"いちばん多い品種「{top['key'] or '（空欄）'}」") if top else (None, "")
    else:
        hit = next((x for x in timed if x["key"] == str(base)), None)
        ref, ref_name = (hit["avg"], f"品種「{base}」") if hit else (None, f"品種「{base}」（作業がありません）")
    for x in items:
        x["factor"] = round(x["avg"] / ref, 4) if ref and x["avg"] is not None else None
        x["conv"] = round(x["lots"] * x["factor"], 4) if x["factor"] is not None else None
        x["avg"] = round(x["avg"], 2) if x["avg"] is not None else None
        x["minutes"] = round(x["minutes"], 2)
        x.pop("sum", None)
    return {"items": items, "total": total, "base": {"minutes": round(ref, 2) if ref else None, "name": ref_name},
            "conv": round(sum(x["conv"] or 0 for x in items), 4), "lots": sum(x["lots"] for x in items)}
