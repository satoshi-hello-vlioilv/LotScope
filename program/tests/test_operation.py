# -*- coding: utf-8 -*-
"""設備の稼働（版 3.46.0。services/operation.py）: 勤務時間（直の時間帯）・稼働率・ガントの答え・ABC 分析・換算係数と、
ダッシュボードのパネル（visual gantt・abc）の問い合わせ。素朴に数え直した数と突き合わせる。"""
import shutil
import sqlite3
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
        t = operation.abc(ops, "品種", qty="time")
        self.assertEqual([x["key"] for x in t["items"]], ["X", "Y"])
        self.assertEqual(operation.abc(ops, "品種", qty="重量")["items"][0]["qty"], 30.0)


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
        """前日（現場歴 10/15）: CR1 の作業は 3 つ（分割 2 本は 1 作業）＋作業終了の無い 1 つ。稼働は重ねて 8:00〜10:00（1直の 7:00〜）と 16:00〜17:00"""
        d = self.ask(visual="gantt", period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual(d["kind"], "gantt")
        self.assertEqual(d["range"], ["2026-10-15", "2026-10-15"])
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertEqual([(o[0], o[1], o[2], o[4]) for o in cr1["ops"]], [("2026-10-15 08:00:00", "2026-10-15 09:00:00", "L1", 2),
                                                                        ("2026-10-15 08:30:00", "2026-10-15 10:00:00", "L3", 1),
                                                                        ("2026-10-15 16:00:00", "2026-10-15 17:00:00", "L4", 1)])
        self.assertEqual((cr1["noEnd"], cr1["count"], cr1["shiftMin"], cr1["busyMin"]), (1, 4, 1440, 180))
        self.assertEqual(cr1["rate"], round(180 / 1440, 4))
        l1 = next(e for e in d["equips"] if e["name"] == "L-1")
        self.assertEqual((l1["busyMin"], l1["rate"]), (480, round(480 / 1440, 4)))
        self.assertEqual(d["total"]["rate"], round((180 + 480) / 2880, 4))
        self.assertEqual(d["endColumn"], "BOX実績_作業終了_日付")

    def test_gantt_color_and_equips(self):
        d = self.ask(visual="gantt", equips=["CR1"], ops={"color": "合金"}, period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual([e["name"] for e in d["equips"]], ["CR1"])
        self.assertEqual([o[3] for o in d["equips"][0]["ops"]], ["A1100", "A5052", "A1100"])

    def test_abc_per_equipment_and_all(self):
        d = self.ask(visual="abc", ops={"cls": "合金"})
        cr1 = next(e for e in d["equips"] if e["name"] == "CR1")
        self.assertEqual([(x["key"], x["lots"]) for x in cr1["items"]], [("A1100", 3), ("A5052", 2)])
        self.assertEqual([(x["key"], x["lots"]) for x in d["all"]["items"]], [("A1100", 3), ("A5052", 2), ("A3004", 1)])
        a1100 = next(x for x in cr1["items"] if x["key"] == "A1100")
        self.assertEqual(a1100["avg"], 60.0)          # 8:00〜9:00・16:00〜17:00・10/13 8:00〜9:00
        self.assertEqual(cr1["base"]["minutes"], 67.5)   # (60×3＋90) ÷ 4（作業終了の無い 1 本は入れない）

    def test_needs_work_log(self):
        r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "gantt", "source": "src:wip"}})
        self.assertEqual(r.status_code, 400)

    def test_layout_keeps_ops(self):
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "g", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "abc", "source": "work",
                                                                   "ops": {"cls": "合金", "qty": "time", "a": 60, "b": 95, "junk": 1}}]})
        self.assertEqual(body["panels"][0]["ops"], {"cls": "合金", "qty": "time", "base": "avg", "a": 60.0, "b": 95.0})

    def test_combo_series_kind_and_axis(self):
        """組み合わせ（版 3.46.0。要望 3）: 系列ごとの形（棒・線・面）と目盛り（左・右）を書式に置ける。知らない値は外す"""
        fmt = dashboard.clean_fmt({"series": {"ロット数": {"kind": "bar"}, "重量の平均": {"kind": "line", "axis": "right", "dash": True}, "x": {"kind": "pie", "axis": "up"}}})
        self.assertEqual(fmt["series"], {"ロット数": {"kind": "bar"}, "重量の平均": {"kind": "line", "axis": "right", "dash": True}})
        body, _ = dashboard.clean_layout({"rows": 8, "panels": [{"id": "c", "x": 0, "y": 0, "w": 6, "h": 3, "visual": "combo", "source": "work",
                                                                   "body": {"rows": [{"column": "@workday"}], "measures": [{"agg": "lots"}, {"agg": "avg", "column": "重量"}]}}]})
        self.assertEqual(body["panels"][0]["visual"], "combo")


if __name__ == "__main__":
    unittest.main()
