# -*- coding: utf-8 -*-
"""ダッシュボード（services/dashboard.py・routes/dashboard.py）: 設備別の仕掛ロット数（残仕掛設備ｺｰｽ の先頭で見分ける）と、
前日（現場歴）の設備別・直ごとの実績本数（作業開始が同じ行は 1 本）。集計対象の条件（全員で 1 つ）。"""
import json
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore
from app.services import dashboard, shifts, work_log
from app.services.db_mirror import DbMirror

ROOT = Path(__file__).resolve().parents[1]
THREE = shifts.segments_of(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))


def make_wip(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 仕掛 (ロット番号 TEXT, 残仕掛設備ｺｰｽ TEXT, 製造材質 TEXT)")
    c.executemany("INSERT INTO 仕掛 VALUES (?, ?, ?)", rows)
    c.commit()
    c.close()


def make_work(path, starts):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 実績 (ロット番号 TEXT, BOX実績_作業開始_日付 TEXT, 作業区分 TEXT)")
    c.executemany("INSERT INTO 実績 VALUES (?, ?, ?)", starts)
    c.commit()
    c.close()


class Counts(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_wip_is_counted_by_the_head_of_the_remaining_course(self):
        p = self.tmp / "w.sqlite3"
        make_wip(p, [("A1", "CR1 L-1", "A1100"), ("A2", "CR1", "A5052"), ("A3", "CR2 CR1", "A1100"), ("A4", "ＣＲ１ LS3", "A1100"),
                     ("A4", "ＣＲ１ LS3", "A1100"), ("A5", "", "A1100"), ("A6", None, "A1100"), ("A7", "XYZ CR1", "A1100")])
        out = dashboard.wip_by_equipment(p, candidates=["仕掛"], equip_column="残仕掛設備ｺｰｽ", equip_mode="前方一致", names=["CR1", "CR2", "L-1"])
        self.assertEqual({x["equipment"]: x["lots"] for x in out["items"]}, {"CR1": 3, "CR2": 1, "XYZ": 1},
                         "先頭の設備で数える・全角も同じ・同じロットの 2 行は 1・知らない設備も落とさない")
        self.assertEqual(out["items"][0]["equipment"], "CR1", "多い順")
        self.assertEqual((out["noEquipment"], out["total"]), (2, 7))
        only = dashboard.wip_by_equipment(p, candidates=["仕掛"], equip_column="残仕掛設備ｺｰｽ", names=["CR1"], equip_mode="前方一致",
                                          cond={"filters": [{"column": "製造材質", "op": "eq", "value": "A5052"}]})
        self.assertEqual(only["items"], [{"equipment": "CR1", "lots": 1}], "集計対象の条件で絞る")
        miss = dashboard.wip_by_equipment(p, candidates=["仕掛"], equip_column="無い列", names=[])
        self.assertEqual((miss["missingColumn"], miss["noEquipment"]), ("無い列", 7), "設備の列が無ければ全部を設備なしに")

    def test_yesterday_is_the_day_before_today_on_the_shop_calendar(self):
        at = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M")      # noqa: E731
        self.assertEqual(dashboard.yesterday_of(at("2026-10-16 10:00"), THREE), "2026-10-15")
        self.assertEqual(dashboard.yesterday_of(at("2026-10-16 03:00"), THREE), "2026-10-14", "3 直の跨いだ後は前の日の現場歴")
        self.assertEqual(dashboard.yesterday_of(at("2026-10-16 23:30"), THREE), "2026-10-15")
        self.assertEqual(dashboard.yesterday_of(at("2026-10-16 03:00"), []), "2026-10-15", "勤務体系が無ければ暦の前日")

    def test_works_on_counts_one_per_work_start_by_shift(self):
        p = self.tmp / "実績_CR1.sqlite3"
        make_work(p, [("L1", "2026/10/15 8:00:00", "通常"), ("L2", "2026/10/15 8:00:00", "通常"),     # 分割: 1 本
                      ("L3", "2026/10/15 16:00:00", "再処理"), ("L4", "2026/10/16 2:00:00", "通常"),    # 3 直（翌 2 時は 15 日の現場歴）
                      ("L5", "2026/10/16 9:00:00", "通常"), ("L6", "2026/10/14 23:30:00", "通常")])     # 16 日・14 日（15 日ではない）
        out = dashboard.works_on(p, day="2026-10-15", segments=THREE, candidates=["実績"])
        self.assertEqual([(s["name"], s["works"], s["rows"]) for s in out["shifts"]], [("1直", 1, 2), ("2直", 1, 1), ("3直", 1, 1)])
        self.assertEqual(out["total"], {"works": 3, "rows": 4})
        f = dashboard.works_on(p, day="2026-10-15", segments=THREE, candidates=["実績"],
                               cond={"filters": [{"column": "作業区分", "op": "eq", "value": "通常"}]})
        self.assertEqual(f["total"]["works"], 2, "集計対象の条件で絞る")

    def test_condition_is_cleaned(self):
        self.assertEqual(json.loads(dashboard.clean_condition({"filters": [{"column": " 製造材質 ", "op": "eq", "value": 5}], "search": " x "})),
                         {"filters": [{"column": "製造材質", "op": "eq", "value": "5"}], "search": "x"})
        with self.assertRaises(ValueError):
            dashboard.clean_condition({"filters": [{"column": "", "op": "eq"}]})
        with self.assertRaises(ValueError):
            dashboard.clean_condition({"filters": [{"column": "a", "op": "eq"}] * 21})


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.wip = self.tmp / "LOTNOW.sqlite3"
        make_wip(self.wip, [("A1", "CR1 L-1", "A1100"), ("A2", "L-1", "A1100"), ("A3", "L-1 CR1", "A5052")])
        folder = self.tmp / "実績"
        make_work(folder / "実績_CR1.sqlite3", [("L1", "2026/10/15 8:00:00", "通常"), ("L2", "2026/10/15 8:00:00", "通常"), ("L3", "2026/10/15 16:00:00", "通常")])
        make_work(folder / "実績_L-1.sqlite3", [("M1", "2026/10/14 8:00:00", "通常")])
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600},
                    "sources": {"wip": {"source": str(self.wip), "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings, "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"), "WORK_LISTING": work_log.Listing(ttl=0),
                               "SRC_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "sources", prefix="src")})
        repo = MasterRepository(store)
        repo.work_log_sync(work_log.scan(folder, "実績_*.sqlite3"))
        repo.shift_create(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_both_panels(self):
        with mock.patch.object(dashboard, "now_local", return_value=datetime(2026, 10, 16, 10, 0)):
            d = self.c.get("/api/dashboard").get_json()
        self.assertEqual({x["equipment"]: x["lots"] for x in d["wip"]["items"]}, {"L-1": 2, "CR1": 1})
        self.assertEqual(d["wip"]["source"]["key"], "wip")
        work = {x["equipment"]: x for x in d["work"]["items"]}
        self.assertEqual(work["CR1"]["day"], "2026-10-15")
        self.assertEqual([(s["name"], s["works"]) for s in work["CR1"]["shifts"]], [("1直", 1), ("2直", 1), ("3直", 0)])
        self.assertEqual(work["L-1"]["total"]["works"], 0, "前日に作業の無い設備は 0")

    def test_condition_is_shared_and_applied(self):
        r = self.c.put("/api/dashboard/wip", json={"filters": [{"column": "製造材質", "op": "eq", "value": "A5052"}], "base_rev": 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        d = self.c.get("/api/dashboard", query_string={"part": "wip"}).get_json()
        self.assertEqual(d["wip"]["items"], [{"equipment": "L-1", "lots": 1}])
        self.assertEqual(d["wip"]["condition"]["filters"][0]["value"], "A5052")
        self.assertNotIn("work", d)
        self.assertEqual(self.c.put("/api/dashboard/wip", json={"filters": [], "base_rev": 0}).status_code, 409, "ほかの PC が先に変えた版では書かない")
        self.assertEqual(self.c.put("/api/dashboard/zz", json={}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
