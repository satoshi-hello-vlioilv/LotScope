# -*- coding: utf-8 -*-
"""釜番 → 日付（式の kamadate。版 3.51.2。利用者の要望 2026-10-23）の評価関数。

利用者が渡した関数（date_to_kama・kama_to_date。VBA と同じ数え方）をそのまま答えの元にして、2020〜2030 年の全部の月 × 全部の釜番
（週 1〜5 × 曜日 1〜7）で、サーバーの式（formula.kamadate）が同じ日付を出すか・その月に無い釜番は空か・日付 → 釜番 → 日付が戻るかを突き合わせる。
画面の式（list-formula.js）とは test_formula_parity が同じ式で突き合わせる。
"""
import calendar
import json
import unittest
from datetime import date, datetime
from pathlib import Path

from app.services import conversions
from app.services import formula as F


# ---- 利用者が渡した関数（そのまま） ----
def date_to_kama(target_date, kama_no="*"):
    if isinstance(target_date, str):
        target_date = datetime.strptime(target_date, "%Y/%m/%d").date()
    month_start = target_date.replace(day=1)
    days_from_start = (target_date - month_start).days
    weekday_num = ((target_date.weekday() + 1) % 7) + 1
    start_weekday = ((month_start.weekday() + 1) % 7) + 1
    week_num = ((start_weekday - 1 + days_from_start) // 7) + 1
    if week_num == 6:
        week_num = 1
    return f"{week_num}{weekday_num}{kama_no}"


def kama_to_date(year, month, kama):
    kama = str(kama)
    if len(kama) != 3:
        raise ValueError("釜番は3桁で指定してください")
    target_week, target_weekday = int(kama[0]), int(kama[1])
    if not 1 <= target_week <= 5:
        raise ValueError("週番号は1～5で指定してください")
    if not 1 <= target_weekday <= 7:
        raise ValueError("曜日番号は1～7で指定してください")
    last_day = calendar.monthrange(year, month)[1]
    week_num = 0
    for day in range(1, last_day + 1):
        d = date(year, month, day)
        weekday_num = ((d.weekday() + 1) % 7) + 1
        if week_num == 0 or weekday_num == 1:
            week_num += 1
            if week_num == 6:
                week_num = 1
        if week_num == target_week and weekday_num == target_weekday:
            return d.strftime("%Y/%m/%d")
    raise ValueError(f"{year}/{month} に釜番 {kama} に対応する日付がありません")


_F2, _F1 = F.Formula("kamadate([K], [B])"), F.Formula("kamadate([K])")


def nearest(base, kama):
    """答え: 基準日の前の月・その月・次の月で利用者の kama_to_date を引き、基準日にいちばん近い日（同じなら前）。無ければ None"""
    best = None
    for dm in (-1, 0, 1):
        y, m = base.year + (base.month - 1 + dm) // 12, (base.month - 1 + dm) % 12 + 1
        try:
            d = datetime.strptime(kama_to_date(y, m, kama), "%Y/%m/%d").date()
        except ValueError:
            continue
        if best is None or abs((d - base).days) < abs((best - base).days):
            best = d
    return None if best is None else best.isoformat()


def kd(*args):
    v = {"K": args[0], "B": args[1] if len(args) > 1 else None}
    return (_F2 if len(args) > 1 else _F1).run(v.get)


class KamaDate(unittest.TestCase):
    def test_example(self):
        self.assertEqual(kama_to_date(2021, 3, "161"), "2021/03/05")
        self.assertEqual(kd("161", "2021/03/05"), "2021-03-05")
        self.assertEqual(kd(161, "2021-03-08"), "2021-03-05", "数の 161 も同じ")
        # 2026-10-23（第 4 週の金曜）から見た利用者のデータの釜番: 45x〜47x は今週・5xx は来週・14x〜16x は翌月の第 1 週（10 月の第 1 週に水曜は無い）
        self.assertEqual(kd("451", "2026-10-23"), "2026-10-22")
        self.assertEqual(kd("567", "2026-10-23"), "2026-10-30")
        self.assertEqual(kd("141", "2026-10-23"), "2026-11-04")
        self.assertEqual(kd("166", "2026-10-23"), "2026-11-06")

    def test_every_day_and_kama_matches_users_function(self):
        n = 0
        d = date(2020, 1, 1)
        while d <= date(2030, 12, 31):
            for w in range(1, 6):
                for wd in range(1, 8):
                    k = f"{w}{wd}1"
                    self.assertEqual(kd(k, d.isoformat()), nearest(d, k), (d, k))
                    n += 1
            d = d.fromordinal(d.toordinal() + 5)        # 5 日おき（曜日と月の中の位置がずれる）
        self.assertGreater(n, 25000)

    def test_round_trip_from_date(self):
        """日付 → 釜番（利用者の date_to_kama）→ その日を基準日にして日付へ戻すと、元の日（第 6 週の日は、同じ週・曜日の月初の日）"""
        for y in (2021, 2026):
            for m in range(1, 13):
                for day in range(1, calendar.monthrange(y, m)[1] + 1):
                    k = date_to_kama(date(y, m, day), 1)
                    self.assertEqual(kd(k, f"{y}-{m:02d}-{day:02d}"), nearest(date(y, m, day), k))

    def test_not_a_kama_is_blank(self):
        for k in ("0", "", None, "14", "1411", "611", "181", "101", "abc", "１４１"):
            self.assertIsNone(kd(k, "2026-10-01"), k)
        self.assertIsNone(kd("141", "日付でない"))

    def test_without_base_uses_today(self):
        self.assertEqual(kd("451"), nearest(date.today(), "451"))


class Preset(unittest.TestCase):
    """既定の読み替え（同梱の変換表）の「釜番日付」: 釜番の列（設計PIT_炉番炉順）から、右に日付の列を足す"""

    def test_bundled_table(self):
        rows = json.loads((Path(conversions.__file__).resolve().parents[1] / "master_defaults" / "conversions.json").read_text(encoding="utf-8"))
        row = next(r for r in rows if r["名前"] == "釜番日付")
        t = conversions.clean_row(conversions.view(row))
        self.assertEqual(json.loads(t["入力"])[0]["columns"][:2], ["設計PIT_炉番炉順", "設計_PIT炉番炉順"])
        self.assertEqual(json.loads(t["当て方"]), {"mode": "add", "column": "{列}_日付", "place": "after"})
        f = F.Formula("conv('釜番日付', [K])")
        F.use_tables(conversions.tables([t]).get)
        try:
            self.assertEqual(f.run({"K": "451"}.get), nearest(date.today(), "451"))
            self.assertIsNone(f.run({"K": "0"}.get))
        finally:
            F.use_tables(None)
