# -*- coding: utf-8 -*-
"""設備の稼働（版 3.46.0。利用者の要望 2026-10-21 の 1・2）: 作業実績の作業開始・作業終了から、設備ごとの
稼働の区間（ガントチャート）・勤務時間・稼働率と、品種ごとの ABC 分析・換算係数を数える。画面は static/js/dashboard-panels.js（gantt・abc）。

作業（1 本）
    作業開始が同じ行は、その工程で幅・丈で分割したロット（作業は 1 回。work_summary と同じ決まり）。作業の区間は
    [作業開始, その行たちの作業終了のいちばん遅い時刻)。作業終了が無い・作業開始より前・MAX_HOURS を超える作業は区間を持たない（noEnd に数え、
    理由ごとの数を why に。版 3.47.0）。日時は選んだ列 → 同じ言葉のほかの日時の列（年月日時分秒）→ 日付＋時刻の列の順に読む（stamp_columns）。
    日を跨いだ作業で作業終了の日付が作業開始の日のままなら翌日と読む
ガントの見る範囲（版 3.47.0）
    期間（既定は前日）の勤務時間の最初〜最後。期間より前に始まって期間にも動いている作業（carry）と、作業終了がまだ無い
    いちばん新しい作業（running: いままで）も棒にする（数・作業時間・換算係数には入れない）
稼働率（利用者が決めた: 分母は勤務時間＝直の時間）
    勤務時間 … その設備の勤務体系（マスタ管理の「勤務体系」。設備を書いた体系 → 全設備共通）の区分を、期間の作業日（現場歴か太陽暦）ごとに並べた時間。
               日を跨ぐ区分は 0 時で 2 つに分け、それぞれの作業日を shifts.Clock.place で決める（作業日・直の決め方と同じ 1 か所）
    稼働時間 … 作業の区間を重ねて（同じ時刻に 2 つ動いても 1 と数える）、勤務時間と重なる分。勤務時間の外の稼働は outside に別に数える
    稼働率   … 稼働時間 ÷ 勤務時間。勤務体系が無い設備は出さない（None）
換算係数（利用者が決めた: 作業時間から自動で出す）
    品種（選んだ列の値か、いくつかの列の値の組み合わせ。合金・板厚の区分など）ごとの 1 本あたりの平均作業時間 ÷ 基準の作業時間。基準は
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
MAX_HOURS = 168           # 1 作業の長さの上限（これより長いのは読み違い・書き忘れとみなし、区間を持たせない）。版 3.47.0 で 48 → 168（7 日）: 焼鈍炉（BOX）の
                          # 1 回の作業は 20〜60 時間で、48 時間を超える作業の作業時間・棒が出なかった
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


def utilization(ops, windows, clip=None):
    """作業の並び（start・end を持つ dict）と勤務時間 → {shiftMin, busyMin, outsideMin, rate, byShift: [{day, shift, min, busy, rate}]}。
    clip（見る範囲 (始め, 終わり)）… 勤務時間の外の稼働（outside）を、その範囲の中だけで数える（期間より前から続く作業の前の分を入れない）"""
    spans = merge([(o["start"], o["end"]) for o in ops if o.get("end") and o.get("start")])
    if clip:
        spans = [(max(a, clip[0]), min(b, clip[1])) for a, b in spans if b > clip[0] and a < clip[1]]
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
# 日時を読む列（版 3.47.0。利用者の要望 2026-10-21 の 2 回目の 1・4。tools/ops-bench.py で設備ごとの書き方を確かめる）:
#   選んだ（見つけた）列で時刻まで読めない行は、同じ言葉（作業開始・作業終了）を持つほかの日付・日時の列（WaveLog の BOX実績_作業終了_年月日時分秒 など）、
#   日付と別の時刻の列の組（〜日付 ＋ 〜時刻）の順に読む。Access・Excel の日時の数（46297.34375）も読む。
#   前は選んだ列が日付だけ・14 桁・日時の数の設備で、作業が 1 つも区間を持たず、ガントの棒も換算係数も出なかった
SERIAL_RANGE = (20000.0, 80000.0)      # 日時の数として読む範囲（1954〜2119 年）
WHY = {"blank": "作業終了が空", "notime": "作業終了に時刻が無い", "unread": "作業終了が日時と読めない", "before": "作業終了が作業開始より前",
       "long": f"{MAX_HOURS // 24} 日より長い", "nostart": "作業開始が日時と読めない"}
WHY_RANK = {"": 0, "blank": 1, "unread": 2, "notime": 3}


def stamp_columns(cs, first, word):
    """日時を読む列の順 → [(列, 時刻の列 か "")]: first → word（作業開始・作業終了）を持つほかの日付・日時の列（時刻の列そのものは除く）"""
    others = [c for c in cs if c != first and word in c and any(k in c for k in ("日付", "日時", "時分秒"))]
    return [(c, time_column(cs, c)) for c in dict.fromkeys([first] + others) if c]


def _serial(v):
    """日時の数（1899/12/30 からの日数。小数は時刻）→ 'YYYY-MM-DD HH:MM:SS'（範囲の外・数でない字は None）"""
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    if not SERIAL_RANGE[0] <= f < SERIAL_RANGE[1] or (isinstance(v, str) and "." not in v):
        return None
    return _iso(datetime(1899, 12, 30) + timedelta(seconds=round(f * 86400)))


def read_stamp(vals):
    """列の組の値 [(値, 時刻の値)] → (日時 か None, 日付だけの字 か "", 何が読めなかったか: "" / "blank" / "notime" / "unread")"""
    day, why = "", "blank"
    for v, t in vals:
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        stamp = to_datetime(v, t) if isinstance(v, str) or t else (_serial(v) or to_datetime(v, t))
        if stamp and len(stamp) == 10 and isinstance(v, str) and "." in v:
            stamp = _serial(v) or stamp
        dt = _dt(stamp)
        if dt is not None:
            return dt, stamp[:10], ""
        if stamp:
            day, why = day or stamp, "notime"
        elif why == "blank":
            why = "unread"
    return None, day, why


def read_ops(part, *, search="", filters="", today=None, calc=None, period=None, now=None, end="", cols=(), reach=False):
    """1 つのファイル（作業実績の 1 設備）→ {ops: [{start, end, key, n, values: {列: 最初の行の値}, nums: {列: 合計}, why, carry, running}], columns, start, end, range}。
    期間 period は作業日（@workday）か日付の列。作業日の範囲（range）に作業開始の作業日が入る作業だけ。cols … 作業ごとに持たせる列。
    reach（ガント）… 期間より前に始まって期間にも動いている作業（carry）と、作業終了がまだ無いいちばん新しい作業（running: いままで動いている）も読む"""
    work = part.work or {}
    clock, basis = work.get("clock") or Clock([]), work.get("basis", "work")
    now = now or datetime.now()
    back = timedelta(hours=MAX_HOURS) + timedelta(days=1)
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
        s_cols, e_cols = stamp_columns(cs, start, "作業開始"), stamp_columns(cs, stop, "作業終了")
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
                lo = (date.fromisoformat(span[0]) - back).isoformat()[:10] if reach else span[0]
                w, wp = period_prefilter(pcol, (lo, span[1]))
                if w:
                    where_parts, params = where_parts + [w], params + wp
        where = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        n = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}{where}", params).fetchone()[0])
        if n > MAX_ROWS:
            raise PivotError(f"当たる行が多すぎます（{n:,} 行。{MAX_ROWS:,} 行まで）。期間・条件で絞ってください。")
        pc = period["column"] if period and period["column"] not in ("@workday", start) else ""
        sel = [x for pair in s_cols + e_cols for x in pair] + want + ([pc] if pc else [])
        data = c.execute(f"SELECT {', '.join(exprs.get(x) or qi(x) if x else 'NULL' for x in sel)} FROM {qi(t)}{where}", params).fetchall()
    ns, ne = len(s_cols) * 2, len(e_cols) * 2
    pairs = lambda row, a, k: [(row[a + 2 * i], row[a + 2 * i + 1]) for i in range(k)]      # noqa: E731
    ops = {}
    lo_carry = (datetime.fromisoformat(span[0]) - back).date().isoformat() if span and reach else ""
    last_any = None                       # 読んだ行でいちばん新しい作業開始（いま動いている作業を決める）
    for row in data:
        s_dt, s_day, _ = read_stamp(pairs(row, 0, len(s_cols)))
        stamp = _iso(s_dt) if s_dt else s_day
        if s_dt and (last_any is None or s_dt > last_any):
            last_any = s_dt
        carry = False
        if period:
            if pc:
                day = (to_datetime(row[ns + ne + len(want)]) or "")[:10]
            else:
                day = clock.place(stamp, basis)[0] if stamp else ""
            if not day:
                continue
            if not span[0] <= day <= span[1]:
                if not (reach and lo_carry <= day < span[0] and s_dt):
                    continue
                carry = True
        k = stamp if s_dt else work_key(row[0], row[1])
        if not k:
            k = f"#{len(ops)}"                 # 作業開始が空の行は 1 行で 1 作業
        o = ops.get(k)
        if o is None:
            o = ops[k] = {"key": k, "start": s_dt, "end": None, "n": 0, "values": {}, "nums": {}, "day": clock.place(stamp, basis)[0] if stamp else "",
                          "why": "" if s_dt else "nostart", "carry": carry}
        o["n"] += 1
        e, _, why = read_stamp(pairs(row, ns, len(e_cols)))
        if e is not None and o["start"] is not None and e < o["start"] and e.date() == o["start"].date():
            e = e + timedelta(days=1)          # 日を跨いだ作業で、作業終了の日付が作業開始の日のまま（時刻だけが翌日）
        if e is not None and (o["end"] is None or e > o["end"]):
            o["end"] = e
        elif e is None and o["end"] is None and WHY_RANK.get(why, 0) > WHY_RANK.get(o["why"], 0):
            o["why"] = why                     # 分割した行のうち、いちばん分かることの多い理由（時刻が無い ＞ 読めない ＞ 空）
        for i, col in enumerate(want):
            v = row[ns + ne + i]
            o["values"].setdefault(col, v)
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            o["nums"][col] = o["nums"].get(col, 0.0) + f
    out = []
    for o in ops.values():
        if o["start"] is None:
            o.update(end=None, why="nostart")
        elif o["end"] is not None:
            if o["end"] <= o["start"]:
                o["why"] = "before"
            elif o["end"] - o["start"] > timedelta(hours=MAX_HOURS):
                o["why"] = "long"
            else:
                o["why"] = ""
            if o["why"]:
                o["end"] = None
        elif not o["why"]:
            o["why"] = "blank"
        out.append(o)
    out.sort(key=lambda o: (o["start"] is None, o["start"] or datetime.min))
    # いま動いている作業: 読んだ中でいちばん新しく始まり、作業終了がまだ空で、始まって MAX_HOURS 以内（いままでの区間にする）
    newest = next((o for o in reversed(out) if o["start"] is not None), None)
    if reach and newest and newest["end"] is None and newest["why"] == "blank" and newest["start"] == last_any and timedelta(0) < now - newest["start"] <= timedelta(hours=MAX_HOURS):
        newest.update(end=now, running=True, why="")
    out = [o for o in out if not (o["carry"] and o["end"] is None)]      # 期間より前に始まり、区間の分からない作業は出さない（数にも入れない）
    return {"ops": out, "columns": cs, "start": start, "end": stop, "range": span, "lot": lot}


def minutes(o):
    return (o["end"] - o["start"]).total_seconds() / 60 if o.get("end") and o.get("start") and not o.get("running") else None


def reasons(ops):
    """区間を出せない作業の理由ごとの数 → {理由の字: 本数}（多い順）"""
    by = {}
    for o in ops:
        if o.get("end") is None and o.get("why"):
            by[o["why"]] = by.get(o["why"], 0) + 1
    return {WHY.get(k, k): n for k, n in sorted(by.items(), key=lambda x: -x[1])}


# ---------------------------------------------------------------- ガントチャート
VIEW_OVER = timedelta(hours=6)      # 期間の作業が勤務時間の後ろへはみ出すとき、見る範囲を広げる上限（焼鈍炉の何十時間もの作業で図が縮まない）


def view_of(read, windows):
    """見る範囲（横の時間）: 勤務時間の最初〜最後（無ければ期間の日の 0 時〜翌 0 時）を、期間の作業の始め・終わりまで広げる（後ろは VIEW_OVER まで）"""
    r = read["range"]
    if windows:
        a, b = windows[0][0], max(w[1] for w in windows)
    elif r:
        a, b = datetime.fromisoformat(r[0]), datetime.fromisoformat(r[1]) + timedelta(days=1)
    else:
        return None
    mine = [o for o in read["ops"] if not o.get("carry") and o["start"] is not None]
    a = min([a] + [o["start"] for o in mine])
    b = max([b] + [min(o["end"], b + VIEW_OVER) for o in mine if o["end"] is not None and not o.get("running")])     # 動いている作業では広げない
    return a, b


def gantt(name, read, windows, *, label="", color=""):
    """1 台の答え → {name, ops: [[始め, 終わり, 字, 色の値, 本数, 印]], windows: [[始め, 終わり, 直, 作業日]], view, noEnd, why, count, carry, truncated, …稼働率}。
    印 … "c"＝期間より前から続く・"r"＝いま動いている（作業終了がまだ無い）・""。棒は見る範囲（view）に掛かる作業だけ"""
    ops = read["ops"]
    view = view_of(read, windows)
    mine = [o for o in ops if not o.get("carry")]
    u = utilization(ops, windows, clip=view)
    bars = []
    for o in ops:
        if o["end"] is None or (view and (o["end"] <= view[0] or o["start"] >= view[1])):
            continue
        if len(bars) < MAX_OPS:
            text = str(o["values"].get(label) if label else "") if label else ""
            bars.append([_iso(o["start"]), _iso(o["end"]), "" if text in ("None",) else text, str(o["values"].get(color) or "") if color else "", o["n"],
                         "r" if o.get("running") else "c" if o.get("carry") else ""])
    no_end = sum(1 for o in mine if o["end"] is None)
    return {"name": name, **u, "ops": bars, "windows": [[_iso(a), _iso(b), s, d] for a, b, s, d in windows], "view": [_iso(view[0]), _iso(view[1])] if view else None,
            "noEnd": no_end, "why": reasons(mine), "count": len(mine), "carry": sum(1 for o in ops if o.get("carry")),
            "truncated": len([o for o in ops if o["end"] is not None]) > MAX_OPS}


# ---------------------------------------------------------------- ABC 分析と換算係数
KEY_SEP = "／"          # 品種を複数の列の組み合わせで分けるとき（版 3.47.0）の鍵の区切り（A1100／H14）。parts に列ごとの値も持つ
MAX_CLS = 4             # 組み合わせる列の数の上限


def cls_list(cls):
    """品種の列（字か列の並び）→ 列の並び（空は除く・同じ列は 1 つ・MAX_CLS まで）"""
    xs = cls if isinstance(cls, (list, tuple)) else [cls]
    return [x for x in dict.fromkeys(str(c or "").strip() for c in xs) if x][:MAX_CLS]


def abc(ops, cls, qty="lots", base="avg", limits=(70.0, 90.0)):
    """作業の並び → 品種ごとの {key, parts（列ごとの値）, lots, timed, minutes（作業時間の合計）, avg（1 本の平均作業時間）, qty, share, cum, rank（A/B/C）, factor, conv}。
    量の大きい順。lots は作業の本数（分割ロットは 1）。avg・factor は作業時間が分かる作業だけで出す。
    cls … 品種の列。列の並びなら、その値の組み合わせ（合金 × 調質 など。版 3.47.0）を 1 つの品種とする。
    答えの noEnd・why … 作業時間の分からない本数と理由（換算係数に入らない作業。黙って捨てない）"""
    cols = cls_list(cls)
    by = {}
    for o in ops:
        parts = ["" if o["values"].get(c) is None else str(o["values"].get(c)).strip() for c in cols] or [""]
        k = KEY_SEP.join(parts)
        x = by.setdefault(k, {"key": k, "parts": parts, "lots": 0, "timed": 0, "minutes": 0.0, "sum": 0.0})
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
            "conv": round(sum(x["conv"] or 0 for x in items), 4), "lots": sum(x["lots"] for x in items),
            "noEnd": sum(1 for o in ops if minutes(o) is None), "why": reasons(ops), "cls": cols}
