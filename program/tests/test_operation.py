# -*- coding: utf-8 -*-
"""設備の稼働（版 3.46.0。services/operation.py）: 勤務時間（直の時間帯）・稼働率・ガントの答え・ABC 分析・換算係数と、
ダッシュボードのパネル（visual gantt・abc）の問い合わせ。素朴に数え直した数と突き合わせる。"""
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore
from app.services import dashboard, operation, shifts, work_log
from app.services.db_mirror import DbMirror
from app.services.sqlite_ro import to_datetime

ROOT = Path(__file__).resolve().parents[1]
THREE = shifts.segments_of(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))
DAY = shifts.segments_of(shifts.clean_row({"name": "日勤", "segments": shifts.TEMPLATES[0]["segments"]}))
T = datetime.fromisoformat


class Windows(unittest.TestCase):
    def test_three_shifts_make_one_workday_of_24_hours(self):
        """交替勤務（3直は翌 7 時まで・現場歴は前の日）: 10/2 の作業日は 10/2 7:00〜10/3 7:00 の 24 時間。3直は 0 時で分ける"""
        w = operation.shift_windows(THREE, "2026-10-02", "2026-10-02")
        self.assertEqual(sum((b - a).total_seconds() for a, b, _, _ in w) / 3600, 24)
        self.assertEqual((w[0][0], w[-1][1]), (T("2026-10-02 07:00"), T("2026-10-03 07:00")))
        self.assertEqual({d for *_, d in w}, {"2026-10-02"})
        self.assertEqual([x[2] for x in w], ["1直", "2直", "3直", "3直"])

    def test_calendar_days_cut_at_midnight(self):
        """太陽暦: 作業日は暦の日（0 時〜24 時の直の時間帯）"""
        w = operation.shift_windows(THREE, "2026-10-02", "2026-10-02", basis="cal")
        self.assertEqual((w[0][0], w[-1][1]), (T("2026-10-02 00:00"), T("2026-10-03 00:00")))

    def test_work_days_follow_the_workday(self):
        """作業日の区切り（版 3.48.0。要望 4）: 現場歴は 7:00〜翌 7:00（交替勤務）・日勤だけなら勤務の外の時刻は暦の日（0 時〜）・太陽暦は 0 時〜"""
        self.assertEqual(operation.work_days(THREE, "2026-10-02", "2026-10-03"),
                         [(T("2026-10-02 07:00"), T("2026-10-03 07:00"), "2026-10-02"), (T("2026-10-03 07:00"), T("2026-10-04 07:00"), "2026-10-03")])
        self.assertEqual(operation.work_days(THREE, "2026-10-02", "2026-10-02", "cal"), [(T("2026-10-02 00:00"), T("2026-10-03 00:00"), "2026-10-02")])
        self.assertEqual(operation.work_days(DAY, "2026-10-02", "2026-10-02"), [(T("2026-10-02 00:00"), T("2026-10-03 00:00"), "2026-10-02")])
        self.assertEqual(operation.work_days([], "2026-10-02", "2026-10-02"), [(T("2026-10-02 00:00"), T("2026-10-03 00:00"), "2026-10-02")])

    def test_day_shift_only(self):
        w = operation.shift_windows(DAY, "2026-10-01", "2026-10-02")
        self.assertEqual([(a, b) for a, b, _, _ in w], [(T("2026-10-01 08:15"), T("2026-10-01 17:05")), (T("2026-10-02 08:15"), T("2026-10-02 17:05"))])


class Utilization(unittest.TestCase):
    def test_overlapping_ops_count_once_and_outside_is_separate(self):
        """重なる作業は 1 と数える・勤務時間の外の稼働は分母にも分子にも入れず outside に"""
        w = operation.shift_windows(DAY, "2026-10-01", "2026-10-01")       # 8:15〜17:05（530 分）
        ops = [{"start": T("2026-10-01 08:00"), "end": T("2026-10-01 10:00")},     # 8:15〜10:00 が勤務時間の中（105 分）・15 分は外
               {"start": T("2026-10-01 09:00"), "end": T("2026-10-01 11:00")},     # 10:00〜11:00 だけが増える（60 分）
               {"start": T("2026-10-01 16:00"), "end": T("2026-10-01 18:00")}]     # 16:00〜17:05（65 分）・55 分は外
        u = operation.utilization(ops, w)
        self.assertEqual((u["shiftMin"], u["busyMin"]), (530, 105 + 60 + 65))
        self.assertAlmostEqual(u["rate"], round(230 / 530, 4))
        self.assertEqual(u["outsideMin"], 15 + 55)
        self.assertEqual([(x["shift"], x["busy"]) for x in u["byShift"]], [("日勤", 230)])

    def test_no_pattern_no_rate(self):
        self.assertIsNone(operation.utilization([{"start": T("2026-10-01 08:00"), "end": T("2026-10-01 09:00")}], [])["rate"])

    def test_end_column(self):
        self.assertEqual(operation.end_column(["BOX実績_作業開始_日付", "BOX実績_作業終了_日付"]), "BOX実績_作業終了_日付")
        self.assertEqual(operation.end_column(["作業開始日時", "作業終了日時"], start="作業開始日時"), "作業終了日時")
        self.assertEqual(operation.end_column(["開始", "終わり"], preferred="終わり"), "終わり")
        self.assertEqual(operation.end_column(["開始"]), "")


class Stamps(unittest.TestCase):
    """作業開始・作業終了の書き方（版 3.47.0。利用者の要望 2026-10-21 の 2 回目の 1・4）"""

    def test_compact_and_meridiem(self):
        self.assertEqual(to_datetime("20261002201500"), "2026-10-02 20:15:00")          # 年月日時分秒の 14 桁
        self.assertEqual(to_datetime(20261002201500), "2026-10-02 20:15:00")
        self.assertIsNone(to_datetime("20261302201500"), "13 月は無い")
        self.assertEqual(to_datetime("2026/10/02 午後 8:15:00"), "2026-10-02 20:15:00")   # 前は 8:15 と読んだ
        self.assertEqual(to_datetime("2026/10/02 午前 12:05:00"), "2026-10-02 00:05:00")
        self.assertEqual(to_datetime("2026/10/02 8:15:00 PM"), "2026-10-02 20:15:00")
        self.assertEqual(to_datetime("2026/10/02 12:15:00 PM"), "2026-10-02 12:15:00")
        self.assertEqual(to_datetime("2026/10/02", "午後 3:00:00"), "2026-10-02 15:00:00")
        self.assertEqual(to_datetime("2026/10/02 20:15:00"), "2026-10-02 20:15:00")       # 24 時の書き方はそのまま
        self.assertEqual(to_datetime("20261002"), "2026-10-02")

    def test_read_stamp_falls_back_to_the_next_column(self):
        """選んだ列が日付だけなら、次の列（年月日時分秒）で時刻まで読む。日時の数も読む"""
        self.assertEqual(operation.read_stamp([("2026/10/02", None), ("20261002081500", None)])[0], T("2026-10-02 08:15"))
        self.assertEqual(operation.read_stamp([(46297.34375, None)])[0], T("2026-10-02 08:15"))
        self.assertEqual(operation.read_stamp([("2026/10/02", None)])[1:], ("2026-10-02", "notime"))
        self.assertEqual(operation.read_stamp([("", None), (None, None)])[2], "blank")
        self.assertEqual(operation.read_stamp([("不明", None)])[2], "unread")

    def test_stamp_columns(self):
        cs = ["BOX実績_作業終了_日付", "BOX実績_作業終了_直", "BOX実績_作業終了_年月日時分秒", "BOX実績_作業終了_時刻", "合金"]
        self.assertEqual(operation.stamp_columns(cs, "BOX実績_作業終了_日付", "作業終了"),
                         [("BOX実績_作業終了_日付", "BOX実績_作業終了_時刻"), ("BOX実績_作業終了_年月日時分秒", "")])

    def test_every_format_gets_spans(self):
        """評価関数 tools/ops-bench.py: 設備ごとに違う 9 つの書き方（14 桁・午後・日時の数・時刻の列・焼鈍炉・日跨ぎ・空の作業終了 …）の
        どれでも、ガントの棒・稼働の分・作業時間の分かる本数が正しい数と合い、区間を出せない作業の数と理由を答えが持つ"""
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "ops-bench.py")], capture_output=True, text=True, encoding="utf-8", timeout=300)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


def op(k, start, minutes, n=1):
    s = T(start)
    return {"start": s, "end": s + timedelta(minutes=minutes) if minutes else None, "n": n, "values": {"品種": k}, "nums": {"重量": 10.0}}


class Abc(unittest.TestCase):
    def test_ranks_by_cumulative_share(self):
        """量の大きい順に累積構成比 70%・90% で A・B・C（いちばん大きい品種はそれだけで線を超えても A）"""
        ops = [op("X", "2026-10-01 08:00", 60) for _ in range(6)] + [op("Y", "2026-10-01 08:00", 60) for _ in range(2)] \
            + [op("Z", "2026-10-01 08:00", 60)] + [op("W", "2026-10-01 08:00", 60)]
        a = operation.abc(ops, "品種")
        self.assertEqual([(x["key"], x["lots"], x["cum"], x["rank"]) for x in a["items"]],
                         [("X", 6, 60.0, "A"), ("Y", 2, 80.0, "B"), ("W", 1, 90.0, "B"), ("Z", 1, 100.0, "C")])
        b = operation.abc([op("X", "2026-10-01 08:00", 60) for _ in range(9)] + [op("Y", "2026-10-01 08:00", 60)], "品種")
        self.assertEqual([x["rank"] for x in b["items"]], ["A", "C"], "1 位だけで 90% でも A")

    def test_any_number_of_ranks(self):
        """段は A・B・C に限らない（版 3.51.0）: 線をいくつでも置ける（線の数＋1 の段）・品種ごとに 1 段（A, B, …, Z, AA, AB …）"""
        self.assertEqual([operation.rank_name(i) for i in (0, 1, 25, 26, 27, 51, 52, 701, 702)], ["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"])
        ops = [op(f"K{i:02d}", "2026-10-01 08:00", 60) for i in range(30) for _ in range(30 - i)]       # K00 が 30 本・K01 が 29 本 … K29 が 1 本
        four = operation.abc(ops, "品種", limits=(50, 70, 85, 95))
        ranks = [x["rank"] for x in four["items"]]
        self.assertEqual(sorted(set(ranks)), ["A", "B", "C", "D", "E"])
        self.assertEqual(ranks, sorted(ranks, key=lambda r: (len(r), r)), "量の大きい順に段が進む")
        for x in four["items"]:
            lim = next((v for v in (50, 70, 85, 95) if x["cum"] <= v + 1e-9), None)
            want = "ABCD"[(50, 70, 85, 95).index(lim)] if lim is not None else "E"
            self.assertEqual(x["rank"], "A" if x is four["items"][0] else want, x)
        self.assertEqual(four["ranks"], {"each": False, "lims": [50.0, 70.0, 85.0, 95.0], "count": 5})
        each = operation.abc(ops, "品種", each=True)
        self.assertEqual([x["rank"] for x in each["items"]], [operation.rank_name(i) for i in range(30)])
        self.assertEqual(each["items"][26]["rank"], "AA")
        self.assertEqual(each["ranks"]["count"], 30)
        self.assertEqual([x["rank"] for x in operation.abc(ops, "品種", limits=(100,))["items"]], ["A"] * 30, "線 1 本（100%）なら全部 A")

    def test_factor_is_average_time_over_base(self):
        """換算係数 ＝ 品種の 1 本の平均作業時間 ÷ 基準（全作業の平均・いちばん多い品種・品種の値）。換算本数 ＝ 本数 × 係数"""
        ops = [op("X", "2026-10-01 08:00", 60), op("X", "2026-10-01 09:00", 60), op("X", "2026-10-01 10:00", 60), op("Y", "2026-10-01 11:00", 120),
               op("Y", "2026-10-01 13:00", None)]      # 作業終了の無い作業は本数に入れ、平均には入れない
        avg = operation.abc(ops, "品種")
        self.assertEqual(avg["base"]["minutes"], 75.0)             # (60×3＋120) ÷ 4
        f = {x["key"]: (x["factor"], x["conv"], x["lots"]) for x in avg["items"]}
        self.assertEqual(f, {"X": (0.8, 2.4, 3), "Y": (1.6, 3.2, 2)})
        top = {x["key"]: x["factor"] for x in operation.abc(ops, "品種", base="top")["items"]}
        self.assertEqual(top, {"X": 1.0, "Y": 2.0})
        by_y = {x["key"]: x["factor"] for x in operation.abc(ops, "品種", base="Y")["items"]}
        self.assertEqual(by_y, {"X": 0.5, "Y": 1.0})
        # 量を作業時間にすると占有時間（本数 × 平均作業時間。版 3.49.0）で並べる: X＝3×60＝180・Y＝2×120＝240（区間の分からない 1 本も平均で見積もる）
        t = operation.abc(ops, "品種", qty="time")
        self.assertEqual([(x["key"], x["occ"]) for x in t["items"]], [("Y", 240.0), ("X", 180.0)])
        self.assertEqual(operation.abc(ops, "品種", qty="重量")["items"][0]["qty"], 30.0)


class Occupancy(unittest.TestCase):
    """占有時間・構成比・換算本数のつじつま（版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 2）と、地点 A の換算係数で地点 B を換算する（同じく 3）"""

    def test_occupancy_and_conversion_agree(self):
        ops = [op("X", "2026-10-01 08:00", 60) for _ in range(3)] + [op("Y", "2026-10-01 08:00", 120), op("Y", "2026-10-01 08:00", None)]
        a = operation.abc(ops, "品種")
        by = {x["key"]: x for x in a["items"]}
        self.assertEqual((by["X"]["occ"], by["Y"]["occ"], a["occ"]), (180.0, 240.0, 420.0))
        self.assertEqual((by["X"]["lotShare"], by["Y"]["lotShare"]), (60.0, 40.0))
        self.assertAlmostEqual(by["Y"]["occShare"], 240 / 420 * 100, places=3)
        # 換算本数の計 × 基準 ＝ 占有時間の計（区間の分かる作業だけの平均 75 分が基準。換算本数＝本数 × 係数）
        self.assertAlmostEqual(a["conv"] * a["base"]["minutes"], 3 * 60 + 2 * 120, places=2)

    def test_reference_factors_convert_another_mix(self):
        """地点 A（X 60 分・Y 120 分。平均 80 分 → 係数 X 0.75・Y 1.5）の係数で、地点 B（X 1 本・Y 4 本・Z 2 本）を換算する。A に無い Z は 1.00"""
        a = operation.abc([op("X", "2026-09-01 08:00", 60), op("X", "2026-09-01 08:00", 60), op("Y", "2026-09-01 08:00", 120)], "品種")
        b = operation.abc([op("X", "2026-10-01 08:00", 30)] + [op("Y", "2026-10-01 08:00", 30) for _ in range(4)] + [op("Z", "2026-10-01 08:00", 30) for _ in range(2)], "品種")
        operation.apply_ref(b, a, ("2026-09-01", "2026-09-30"))
        by = {x["key"]: x for x in b["items"]}
        self.assertEqual((by["X"]["refFactor"], by["Y"]["refFactor"], by["Z"]["refFactor"]), (0.75, 1.5, None))
        self.assertEqual(b["ref"], {"range": ["2026-09-01", "2026-09-30"], "base": a["base"], "conv": 0.75 + 4 * 1.5 + 2, "missing": 2, "lots": 7})


def make_work(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 実績 (ロット番号 TEXT, BOX実績_作業開始_日付 TEXT, BOX実績_作業終了_日付 TEXT, 合金 TEXT)")
    c.executemany("INSERT INTO 実績 VALUES (?, ?, ?, ?)", rows)
    c.commit()
    c.close()


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        folder = self.tmp / "実績"
        # CR1: 10/15 の 1直に 8:00〜9:00（分割 2 本）と 8:30〜10:00（重なる）・2直に 16:00〜17:00。作業終了の無い 1 本
        make_work(folder / "実績_CR1.sqlite3", [("L1", "2026/10/15 8:00:00", "2026/10/15 9:00:00", "A1100"), ("L2", "2026/10/15 8:00:00", "2026/10/15 8:50:00", "A1100"),
                                                 ("L3", "2026/10/15 8:30:00", "2026/10/15 10:00:00", "A5052"), ("L4", "2026/10/15 16:00:00", "2026/10/15 17:00:00", "A1100"),
                                                 ("L5", "2026/10/15 18:00:00", "", "A5052"), ("L9", "2026/10/13 8:00:00", "2026/10/13 9:00:00", "A1100")])
        make_work(folder / "実績_L-1.sqlite3", [("M1", "2026/10/15 7:00:00", "2026/10/15 15:00:00", "A3004")])
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings, "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"), "WORK_LISTING": work_log.Listing(ttl=0),
                               "SRC_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "sources", prefix="src"),
                               "DASHBOARD_NOW": datetime(2026, 10, 16, 10, 0)})
        repo = MasterRepository(store)
        repo.work_log_sync(work_log.scan(folder, "実績_*.sqlite3"))
        repo.shift_create(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ask(self, **panel):
        for _ in range(50):
            r = self.c.post("/api/dashboard/query", json={"panel": {"source": "work", **panel}})
            d = r.get_json()
            if r.status_code == 200 and not any(f.get("kind") == "copying" for f in d.get("failed") or []):
                return d
            if r.status_code != 503:
                self.fail(d)
            time.sleep(0.1)
        self.fail(d)

    def test_gantt_yesterday(self):
        """前日（現場歴 10/15）: CR1 の作業は 3 つ（分割 2 本は 1 作業）＋作業終了がまだ無いいちばん新しい 1 つ（18:00〜。いま 10/16 10:00 まで動いている。
        版 3.47.0 から、いままでの棒〈印 r〉にする）。稼働は重ねて 8:00〜10:00（1直の 7:00〜）と 16:00〜17:00 と 18:00〜勤務時間の終わり（10/16 7:00）"""
        d = self.ask(visual="gantt", period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual(d["kind"], "gantt")
        self.assertEqual(d["range"], ["2026-10-15", "2026-10-15"])
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertEqual([(o[0], o[1], o[2], o[4], o[5]) for o in cr1["ops"]], [("2026-10-15 08:00:00", "2026-10-15 09:00:00", "L1", 2, ""),
                                                                              ("2026-10-15 08:30:00", "2026-10-15 10:00:00", "L3", 1, ""),
                                                                              ("2026-10-15 16:00:00", "2026-10-15 17:00:00", "L4", 1, ""),
                                                                              ("2026-10-15 18:00:00", "2026-10-16 10:00:00", "L5", 1, "r")])
        busy = 180 + 13 * 60
        self.assertEqual((cr1["noEnd"], cr1["count"], cr1["shiftMin"], cr1["busyMin"]), (0, 4, 1440, busy))
        self.assertEqual(cr1["rate"], round(busy / 1440, 4))
        self.assertEqual(cr1["view"], ["2026-10-15 07:00:00", "2026-10-16 07:00:00"])
        l1 = next(e for e in d["equips"] if e["name"] == "L-1")
        self.assertEqual((l1["busyMin"], l1["rate"]), (480, round(480 / 1440, 4)))
        self.assertEqual(d["total"]["rate"], round((busy + 480) / 2880, 4))
        self.assertEqual(d["endColumn"], "BOX実績_作業終了_日付")

    def test_gantt_today_shows_carry_over(self):
        """今日（10/16）: 前日 18:00 に始まり、まだ動いている L5 は、期間より前から続く作業として今日の見る範囲にも出る（数には入れない）"""
        d = self.ask(visual="gantt", period={"column": "@workday", "kind": "today"})
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertEqual([(o[2], o[5]) for o in cr1["ops"]], [("L5", "r")])
        self.assertEqual((cr1["count"], cr1["busyMin"]), (0, 180))         # 10/16 7:00〜10:00

    def test_unreadable_equipment_stays_as_a_row(self):
        """作業終了の列が無い設備も、ガントの行に理由と一緒に出す（前は行ごと消えた）"""
        folder = self.tmp / "実績"
        c = sqlite3.connect(folder / "実績_L-1.sqlite3")
        c.execute("DROP TABLE 実績")
        c.execute("CREATE TABLE 実績 (ロット番号 TEXT, BOX実績_作業開始_日付 TEXT)")
        c.execute("INSERT INTO 実績 VALUES ('M1', '2026/10/15 7:00:00')")
        c.commit()
        c.close()
        d = self.ask(visual="gantt", period={"column": "@workday", "kind": "yesterday"})
        l1 = next(e for e in d["equips"] if e["name"] == "L-1")
        self.assertIn("作業終了の列が見つかりません", l1["error"])
        self.assertEqual(d["total"]["noPattern"], [])

    def test_gantt_color_and_equips(self):
        d = self.ask(visual="gantt", equips=["CR1"], ops={"color": "合金"}, period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual([e["name"] for e in d["equips"]], ["CR1"])
        self.assertEqual([o[3] for o in d["equips"][0]["ops"]], ["A1100", "A5052", "A1100", "A5052"])

    def test_gantt_color_by_calc_column(self):
        """色分けに計算列（一覧の表示列で作った式の列。版 3.47.0。要望 2）: 式をパネルに添えれば、その値で色を分ける"""
        d = self.ask(visual="gantt", equips=["CR1"], ops={"color": "系統"}, period={"column": "@workday", "kind": "yesterday"},
                     calc={"formulas": {"系統": 'left([合金], 3)'}, "names": {}})
        self.assertEqual([o[3] for o in d["equips"][0]["ops"]], ["A11", "A50", "A11", "A50"])

    def test_abc_per_equipment_and_all(self):
        d = self.ask(visual="abc", ops={"cls": "合金"})
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertEqual([(x["key"], x["lots"]) for x in cr1["items"]], [("A1100", 3), ("A5052", 2)])
        self.assertEqual([(x["key"], x["lots"]) for x in d["all"]["items"]], [("A1100", 3), ("A5052", 2), ("A3004", 1)])
        a1100 = next(x for x in cr1["items"] if x["key"] == "A1100")
        self.assertEqual(a1100["avg"], 60.0)          # 8:00〜9:00・16:00〜17:00・10/13 8:00〜9:00
        self.assertEqual(cr1["base"]["minutes"], 67.5)   # (60×3＋90) ÷ 4（作業終了の無い 1 本は入れない）

    def test_abc_by_combination(self):
        """品種を 2 つの列の組み合わせで分ける（版 3.47.0。要望 3）: 鍵は「合金／ロット番号の頭」・列ごとの値は parts"""
        d = self.ask(visual="abc", equips=["CR1"], ops={"cls": ["合金", "ロット番号"]})
        cr1 = d["equips"][0]
        self.assertEqual(d["clsList"], ["合金", "ロット番号"])
        self.assertEqual(sorted(x["key"] for x in cr1["items"]), ["A1100／L1", "A1100／L4", "A1100／L9", "A5052／L3", "A5052／L5"])
        self.assertEqual(next(x["parts"] for x in cr1["items"] if x["key"] == "A5052／L3"), ["A5052", "L3"])
        self.assertEqual((cr1["noEnd"], cr1["why"]), (1, {"作業終了が空": 1}))      # ABC は作業中を作業時間に入れない
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "g", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "abc", "source": "work",
                                                                   "ops": {"cls": ["合金", "", "合金", "調質"]}}]})
        self.assertEqual(body["panels"][0]["ops"]["cls"], ["合金", "調質"])

    def test_gantt_view_is_the_workday(self):
        """ガントの横の範囲（版 3.48.0。要望 4）: 現場歴の作業日の区切り（7:00〜翌 7:00）そのもの。範囲の外へ出る作業は切って出す（範囲を広げない）。
        太陽暦なら 0 時〜翌 0 時。日の区切り（days）も答えに持つ"""
        d = self.ask(visual="gantt", equips=["CR1"], period={"column": "@workday", "kind": "yesterday"})
        cr1 = d["equips"][0]
        self.assertEqual(cr1["view"], ["2026-10-15 07:00:00", "2026-10-16 07:00:00"])
        self.assertEqual(cr1["days"], [["2026-10-15 07:00:00", "2026-10-16 07:00:00", "2026-10-15"]])
        c = self.ask(visual="gantt", equips=["CR1"], basis="cal", period={"column": "@workday", "kind": "yesterday"})["equips"][0]
        self.assertEqual(c["view"], ["2026-10-15 00:00:00", "2026-10-16 00:00:00"])

    def test_start_column_can_be_chosen(self):
        """作業開始の列を選ぶ（版 3.48.0。要望 7）: 選んだ列で作業の区間を決める。選ばなければ今までどおり見つける"""
        folder = self.tmp / "実績"
        c = sqlite3.connect(folder / "実績_L-1.sqlite3")
        c.execute("ALTER TABLE 実績 ADD COLUMN 段取開始_日付 TEXT")
        c.execute("UPDATE 実績 SET 段取開始_日付 = '2026/10/15 6:00:00'")
        c.commit()
        c.close()
        auto = self.ask(visual="gantt", equips=["L-1"], period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual((auto["startColumn"], auto["equips"][0]["busyMin"]), ("BOX実績_作業開始_日付", 480))
        d = self.ask(visual="gantt", equips=["L-1"], ops={"start": "段取開始_日付"}, period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual(d["startColumn"], "段取開始_日付")
        l1 = d["equips"][0]
        self.assertEqual(l1["ops"][0][:2], ["2026-10-15 06:00:00", "2026-10-15 15:00:00"])
        a = self.ask(visual="abc", equips=["L-1"], ops={"cls": "合金", "start": "段取開始_日付"})
        self.assertEqual(a["equips"][0]["items"][0]["avg"], 540.0)

    def test_abc_lead_time_for_all_equipment(self):
        """全設備の作業時間（版 3.48.0。要望 6）: 積み上げ（作業ごとの作業時間）か、リードタイム（同じロットの全設備の作業開始の MIN〜作業終了の MAX）。
        L1 は CR1 で 8:00〜9:00、L-1 で 10:30〜12:00 → 積み上げ 60＋90 分・リードタイム 240 分"""
        (self.tmp / "実績" / "実績_L-1.sqlite3").unlink()
        make_work(self.tmp / "実績" / "実績_L-1.sqlite3", [("L1", "2026/10/15 10:30:00", "2026/10/15 12:00:00", "A1100"), ("M1", "2026/10/15 7:00:00", "2026/10/15 15:00:00", "A3004")])
        s = self.ask(visual="abc", ops={"cls": "合金", "qty": "time"})
        self.assertEqual(s["span"], "sum")
        a1100 = next(x for x in s["all"]["items"] if x["key"] == "A1100")
        self.assertEqual((a1100["lots"], a1100["minutes"]), (4, 60 + 60 + 60 + 90))      # 作業 4 本（CR1 の 3 本＋L-1 の 1 本）
        d = self.ask(visual="abc", ops={"cls": "合金", "qty": "time", "span": "lead"})
        self.assertEqual(d["span"], "lead")
        items = {x["key"]: x for x in d["all"]["items"]}
        # ロット: A1100 は L1（8:00〜12:00 ＝ 240 分）・L2（分割で L1 と同じ作業 8:00〜9:00 ＝ 60 分）・L4（60 分）・L9（60 分）
        self.assertEqual((items["A1100"]["lots"], items["A1100"]["minutes"]), (4, 240 + 60 + 60 + 60))
        self.assertEqual((items["A5052"]["lots"], items["A5052"]["timed"]), (2, 1))       # L5 は作業終了が空（区間なし）
        self.assertEqual(d["all"]["why"], {"作業終了が空": 1})
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertEqual(next(x for x in cr1["items"] if x["key"] == "A1100")["lots"], 3, "設備ごとの答えは今までどおり作業の本数")

    def test_lead_time_spans_the_period_edge(self):
        """リードタイム（版 3.49.0）: 期間の前に始まったロットも、最初の作業開始から数える。最後の工程が期間の後のロットは、その期間の物とする。
        L1: 10/14 の L-1（前日の前）で 10:00 に始まり、10/15 の CR1 で 9:00 に終わる → 前日（10/15）の LT は 23 時間（前は 10/15 の作業だけで 60 分）。
        L4: 10/15 の CR1 の後に 10/16 の L-1 がある → 最後の工程は 10/16 なので、前日（10/15）のロットに入れない"""
        (self.tmp / "実績" / "実績_L-1.sqlite3").unlink()
        make_work(self.tmp / "実績" / "実績_L-1.sqlite3", [("L1", "2026/10/14 10:00:00", "2026/10/14 12:00:00", "A1100"),
                                                         ("L4", "2026/10/16 8:00:00", "2026/10/16 9:00:00", "A1100")])
        d = self.ask(visual="abc", ops={"cls": "ロット番号", "span": "lead"}, period={"column": "@workday", "kind": "yesterday"})
        items = {x["key"]: x for x in d["all"]["items"]}
        self.assertEqual(items["L1"]["avg"], 23 * 60.0)
        self.assertNotIn("L4", items)
        self.assertIn("L3", items)
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertIn("L4", {x["key"] for x in cr1["items"]}, "設備ごとの答えは期間の中の作業だけ（前後の作業は入れない）")
        self.assertNotIn("L1", {x["key"] for x in next(e for e in d["equips"] if e["name"] == "L-1")["items"]})

    def test_reference_period(self):
        """基準の期間（地点 A。版 3.49.0）: その期間の換算係数で、パネルの期間（地点 B）の本数を換算する。日付で決める期間（range）も"""
        d = self.ask(visual="abc", ops={"cls": "合金", "refPeriod": {"kind": "range", "from": "2026-10-13", "to": "2026-10-13"}},
                     period={"column": "@workday", "kind": "yesterday"})
        ref = d["all"]["ref"]
        self.assertEqual(ref["range"], ["2026-10-13", "2026-10-13"])
        a1100 = next(x for x in d["all"]["items"] if x["key"] == "A1100")
        self.assertEqual(a1100["refFactor"], 1.0)      # 10/13 は A1100 だけ（その平均が基準）
        self.assertEqual(ref["missing"], sum(x["lots"] for x in d["all"]["items"] if x["key"] != "A1100"))
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "g", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "abc", "source": "work",
                                                                   "ops": {"refPeriod": {"kind": "range", "from": "2026-09-30", "to": "2026-09-01"}}}]})
        self.assertEqual(body["panels"][0]["ops"]["refPeriod"], {"column": "@workday", "kind": "range", "n": 7, "from": "2026-09-01", "to": "2026-09-30"})

    def test_lead_ops_needs_the_last_end(self):
        """リードタイムは、いちばん後に始まった作業の作業終了が無ければ区間を持たない（途中の工程で止まっているロットを短く数えない）"""
        a = {"start": T("2026-10-01 08:00"), "end": T("2026-10-01 09:00"), "why": "", "lots": {"X": {"品種": "P", "重量": "5"}}}
        b = {"start": T("2026-10-01 10:00"), "end": None, "why": "blank", "lots": {"X": {"品種": "P", "重量": "5"}}}
        ops = operation.lead_ops([{"ops": [a]}, {"ops": [b]}])
        self.assertEqual((ops[0]["end"], ops[0]["why"], ops[0]["nums"]), (None, "last", {"重量": 5.0}))
        ops = operation.lead_ops([{"ops": [a]}, {"ops": [{**b, "end": T("2026-10-01 11:30")}]}])
        self.assertEqual((ops[0]["start"], ops[0]["end"], ops[0]["steps"]), (T("2026-10-01 08:00"), T("2026-10-01 11:30"), 2))

    def test_equipment_order_by_hand(self):
        """設備を手で並べた順（版 3.48.0。要望 3）: ガントの行・ABC の設備・集計の設備の段の並び。並びに無い設備は後ろ"""
        d = self.ask(visual="gantt", eorder=["L-1", "CR1"], period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual([e["name"] for e in d["equips"]], ["L-1", "CR1"])
        a = self.ask(visual="abc", eorder=["L-1"], ops={"cls": "合金"})
        self.assertEqual([e["name"] for e in a["equips"]], ["L-1", "CR1"])
        t = self.ask(visual="bar", eorder=["L-1"], body={"rows": [{"column": "@equip"}], "measures": [{"agg": "lots"}]})
        self.assertEqual(t["orders"][0], ["L-1", "CR1"])
        u = self.ask(visual="bar", body={"rows": [{"column": "@equip"}], "measures": [{"agg": "lots"}]})
        self.assertEqual(u["orders"][0], ["CR1", "L-1"])

    def test_needs_work_log(self):
        r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "gantt", "source": "src:wip"}})
        self.assertEqual(r.status_code, 400)

    def test_layout_keeps_ops(self):
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "g", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "abc", "source": "work",
                                                                   "ops": {"cls": "合金", "qty": "time", "a": 60, "b": 95, "junk": 1}}]})
        self.assertEqual(body["panels"][0]["ops"], {"cls": "合金", "qty": "time", "base": "avg", "lims": [60.0, 95.0]}, "前の a・b は線の並びとして読む")
        # 線はいくつでも（昇順・同じ線は 1 本・0 以下は捨てる・100 を超えれば 100）・品種ごとに 1 段（版 3.51.0）
        self.assertEqual(dashboard.clean_ops({"cls": "合金", "lims": [95, "50", 70, 70, -3, 120, "x"]})["lims"], [50.0, 70.0, 95.0, 100.0])
        self.assertNotIn("lims", dashboard.clean_ops({"cls": "合金", "lims": [90, 70]}), "既定（70・90）は書かない")
        self.assertEqual(dashboard.clean_ops({"cls": "合金", "lims": []}).get("lims"), None, "線が無ければ既定")
        self.assertEqual(dashboard.clean_ops({"cls": "合金", "rankBy": "each"})["rankBy"], "each")
        self.assertNotIn("rankBy", dashboard.clean_ops({"cls": "合金", "rankBy": "x"}))
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "g", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "abc", "source": "work", "eorder": ["CR1", "", "CR1", "L-1"],
                                                                   "ops": {"start": "段取開始", "span": "lead", "hide": ["rank", "junk", "chart"]}}]})
        p = body["panels"][0]
        self.assertEqual((p["ops"]["start"], p["ops"]["span"], p["ops"]["hide"], p["eorder"]), ("段取開始", "lead", ["rank", "chart"], ["CR1", "L-1"]))

    def test_combo_series_kind_and_axis(self):
        """組み合わせ（版 3.46.0。要望 3）: 系列ごとの形（棒・線・面）と目盛り（左・右）を書式に置ける。知らない値は外す"""
        fmt = dashboard.clean_fmt({"series": {"ロット数": {"kind": "bar"}, "重量の平均": {"kind": "line", "axis": "right", "dash": True}, "x": {"kind": "pie", "axis": "up"}}})
        self.assertEqual(fmt["series"], {"ロット数": {"kind": "bar"}, "重量の平均": {"kind": "line", "axis": "right", "dash": True}})
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "c", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "combo", "source": "work",
                                                                   "body": {"rows": [{"column": "@workday"}], "measures": [{"agg": "lots"}, {"agg": "avg", "column": "重量"}]}}]})
        self.assertEqual(body["panels"][0]["visual"], "combo")


if __name__ == "__main__":
    unittest.main()
