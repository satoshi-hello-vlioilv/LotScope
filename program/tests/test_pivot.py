# -*- coding: utf-8 -*-
"""ピボット集計（services/pivot.py・/api/lotlist/pivot・/api/worklog/pivot）と、作業実績の日・直の合計（work_summary の sum）。

評価の芯は oracle（素朴な数え直し）: 試験用のデータを Python の素朴な計算で数え直し、サーバーの答え（段の頭ごとの数・小計・総計・
区間・傾向の数）と突き合わせる。日・直の決め方は test_work_summary.oracle（1直 7-15・2直 15-23・3直 23-7・現場歴は 0〜7 時を前の日）。"""
import json
import math
import shutil
import sqlite3
import statistics
import tempfile
import unittest
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import lot_list, pivot, shifts, work_log, work_summary
from app.services.db_mirror import DbMirror
from tests import lotlist_fixture
from tests.test_work_summary import ROOT, THREE, segs


def place(stamp, basis="work"):
    """素朴な日・直: (日 'YYYY-MM-DD', 直の番号 0/1/2)"""
    dt = datetime.strptime(stamp, "%Y/%m/%d %H:%M:%S")
    shift = 0 if 7 <= dt.hour < 15 else 1 if 15 <= dt.hour < 23 else 2
    day = (dt - timedelta(days=1) if basis == "work" and dt.hour < 7 else dt).date().isoformat()
    return day, shift


def cell(ans, r=(), c=()):
    """答えの段の頭 (r, c) の値の並び。無ければ None"""
    for x in ans["cells"]:
        if tuple(x["r"]) == tuple(r) and tuple(x["c"]) == tuple(c):
            return x["v"]
    return None


class Work(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "w.sqlite3"
        lotlist_fixture.make_work(str(self.db), "CR1", n=600)
        with sqlite3.connect(self.db) as c:
            self.rows = c.execute("SELECT [BOX実績_作業開始_日付], [重量], [作業区分], [作業日] FROM 実績").fetchall()
        self.work = {"clock": shifts.Clock(segs(THREE)), "basis": "work", "start": ""}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ask(self, rows, cols=(), measures=({"agg": "count"},), **kw):
        return pivot.query(str(self.db), preferred_table="実績", rows=json.dumps(list(rows)), cols=json.dumps(list(cols)),
                           measures=json.dumps(list(measures)), table_candidates=work_log.TABLE_CANDIDATES, work=self.work, **kw)

    def test_workday_by_shift_lots_and_weight_match_the_oracle(self):
        ans = self.ask([{"column": "@workday"}], [{"column": "@shift"}], [{"agg": "lots"}, {"agg": "sum", "column": "重量"}, {"agg": "count"}])
        works, weight, rows = defaultdict(set), defaultdict(float), defaultdict(int)
        for stamp, w, _, _ in self.rows:
            day, s = place(stamp)
            for key in ((day, s), (day, None), (None, s), (None, None)):
                works[key].add(stamp)
                weight[key] += w
                rows[key] += 1
        for (day, s), lots in works.items():
            r, c = ([] if day is None else [day]), ([] if s is None else [str(s)])
            got = cell(ans, r, c)
            self.assertIsNotNone(got, (day, s))
            self.assertEqual(got[0], len(lots), f"ロット数（重複の無い作業開始）{day} {s}")
            self.assertAlmostEqual(got[1], weight[(day, s)], places=4, msg=f"重量の合計 {day} {s}")
            self.assertEqual(got[2], rows[(day, s)], f"行の数 {day} {s}")
        self.assertEqual(ans["lotsBy"], "work")
        self.assertEqual([ans["labels"][1][k] for k in ans["orders"][1]], ["1直", "2直", "3直"], "直は勤務体系の順・名前")
        self.assertEqual(ans["orders"][0], sorted(ans["orders"][0]), "作業日は古い順")
        self.assertRegex(ans["labels"][0][ans["orders"][0][0]], r"^\d{4}/\d{2}/\d{2}\(.\)$", "作業日の見せ方は 2026/10/12(月)")

    def test_grand_total_lots_is_distinct_not_the_sum_of_days(self):
        ans = self.ask([{"column": "@workday"}], [], [{"agg": "lots"}])
        self.assertEqual(cell(ans)[0], len({r[0] for r in self.rows}), "総計のロット数は全体の重複の無い作業開始（日ごとの和ではない）")

    def test_date_parts_and_labels(self):
        ans = self.ask([{"column": "作業日", "part": "ym"}], [{"column": "作業日", "part": "weekday"}], [{"agg": "count"}])
        want = defaultdict(int)
        for _, _, _, d in self.rows:
            dt = datetime.strptime(d, "%Y/%m/%d")
            want[(dt.strftime("%Y-%m"), str(dt.weekday()))] += 1
        for (ym, wd), n in want.items():
            self.assertEqual(cell(ans, [ym], [wd])[0], n, (ym, wd))
        self.assertEqual(ans["labels"][1]["0"], "月")
        self.assertEqual(ans["dims"]["rows"][0]["name"], "作業日（年月）")

    def test_histogram_bins_and_stats(self):
        ans = self.ask([{"column": "重量", "part": "bin"}])
        b = ans["bins"][0]
        ws = [r[1] for r in self.rows]
        self.assertTrue(b["auto"])
        self.assertIn(b["width"] / 10 ** math.floor(math.log10(b["width"])), (1, 2, 2.5, 5, 10), "きりの良い幅")
        self.assertTrue(5 <= (max(ws) - b["origin"]) / b["width"] + 1 <= 41, "区間の数は 5〜40 ほど")
        counts = defaultdict(int)
        for w in ws:
            counts[b["origin"] + math.floor((w - b["origin"]) / b["width"] + 1e-9) * b["width"]] += 1
        for start, n in counts.items():
            key = str(int(start)) if start == int(start) else repr(start)
            self.assertEqual(cell(ans, [key])[0], n, start)
        st = ans["stats"]["重量"]
        self.assertEqual(st["n"], len(ws))
        self.assertAlmostEqual(st["mean"], statistics.mean(ws), places=6)
        self.assertAlmostEqual(st["sd"], statistics.stdev(ws), places=6)
        self.assertAlmostEqual(st["median"], statistics.median(ws), places=6)
        # 幅を決めると、その幅で分ける
        fixed = self.ask([{"column": "重量", "part": "bin", "width": 250}])
        self.assertEqual((fixed["bins"][0]["width"], fixed["bins"][0]["auto"]), (250, False))
        self.assertTrue(all(float(k) % 250 == 0 for k in fixed["orders"][0] if k))

    def test_filters_and_search_match_the_list(self):
        flt = json.dumps([{"column": "作業区分", "op": "eq", "value": "通常"}])
        ans = self.ask([{"column": "作業者"}], [], [{"agg": "count"}], filters=flt, search="A")
        listed = lot_list.query(str(self.db), preferred_table="実績", filters=flt, search="A", table_candidates=work_log.TABLE_CANDIDATES)
        self.assertEqual(cell(ans)[0], listed["count"], "一覧と同じ絞り込みで、同じ件数")
        self.assertEqual(ans["count"], listed["count"])

    def test_bad_requests(self):
        with self.assertRaises(pivot.PivotError):
            self.ask([{"column": "無い列"}])
        with self.assertRaises(pivot.PivotError):
            self.ask([{"column": "作業者"}], [], [{"agg": "sum", "column": "無い列"}])
        with self.assertRaises(pivot.PivotError):
            pivot.query(str(self.db), preferred_table="実績", rows=json.dumps([{"column": "@workday"}]), table_candidates=work_log.TABLE_CANDIDATES)

    def test_summarize_adds_the_total_column(self):
        clock = self.work["clock"]
        got = work_summary.summarize([(s, None, w) for s, w, _, _ in self.rows], clock, "work")
        want = defaultdict(float)
        for s, w, _, _ in self.rows:
            want[place(s)] += w
        self.assertEqual(set((b["day"], b["shift"]) for b in got["buckets"]), set(want))
        for b in got["buckets"]:
            self.assertAlmostEqual(b["sum"], want[(b["day"], b["shift"])], places=4)
        self.assertAlmostEqual(got["total"]["sum"], sum(r[1] for r in self.rows), places=4)
        # 数に読めない値は足さない（"1,234.5" は読める）
        odd = work_summary.summarize([("2026/10/01 8:00:00", None, "1,234.5"), ("2026/10/01 8:00:00", None, "abc"), ("2026/10/01 9:00:00", None, None)], clock)
        self.assertEqual(odd["total"]["sum"], 1234.5)

    def test_nice_width(self):
        self.assertEqual(pivot.nice_width(0, 100, 100), 10)
        self.assertEqual(pivot.nice_width(523.6, 5974.2, 400), 500)
        self.assertEqual(pivot.nice_width(3, 3, 10), 1.0, "範囲が 0 なら 1")


class Api(unittest.TestCase):
    """道（/api/worklog/pivot・fields=1・/api/worklog?work=1&total=）。勤務体系は交替勤務(1,2,3直)。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "【New】実績"
        self.folder.mkdir()
        lotlist_fixture.make_work(str(self.folder / "実績_CR1.sqlite3"), "CR1", n=300)
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"work_log": {"folder": str(self.folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600}, "lot_list": {"source": ""}}
        app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings, "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                          "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"), "WORK_LISTING": work_log.Listing(ttl=0)})
        self.c = app.test_client()
        self.assertEqual(self.c.post("/api/masters/worklog/scan", json={}).status_code, 200)
        self.key = self.c.get("/api/worklog/files").get_json()["items"][0]["key"]
        r = self.c.post("/api/masters/shifts", json={"name": "交替勤務(1,2,3直)", "segments": THREE})
        self.assertEqual(r.status_code, 201, r.get_json())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_pivot_route(self):
        q = {"equip": self.key, "rows": json.dumps([{"column": "@workday"}]), "cols": json.dumps([{"column": "@shift"}]),
             "measures": json.dumps([{"agg": "lots"}, {"agg": "sum", "column": "重量"}])}
        r = self.c.get("/api/worklog/pivot", query_string=q)
        d = r.get_json()
        self.assertEqual(r.status_code, 200, d)
        self.assertEqual(d["shiftPattern"], "交替勤務(1,2,3直)")
        self.assertEqual([m["name"] for m in d["measures"]], ["ロット数", "重量の合計"])
        listed = self.c.get("/api/worklog", query_string={"equip": self.key, "work": "1", "total": "重量"}).get_json()["work"]
        self.assertEqual(cell(d)[0], listed["total"]["works"], "集計の総計のロット数＝作業でまとめたロット数")
        self.assertAlmostEqual(cell(d)[1], listed["total"]["sum"], places=4, msg="集計の総計の重量＝作業でまとめた合計")
        self.assertEqual(listed["totalColumn"], "重量")
        self.assertIn("重量", listed["numeric"], "合計できる数の列")
        bad = self.c.get("/api/worklog/pivot", query_string={"equip": self.key, "rows": json.dumps([{"column": "無い"}])})
        self.assertEqual(bad.status_code, 400)

    def test_fields_route(self):
        d = self.c.get("/api/worklog/pivot", query_string={"equip": self.key, "fields": "1"}).get_json()
        f = {x["column"]: x for x in d["fields"]}
        self.assertTrue(f["重量"]["numeric"])
        self.assertFalse(f["作業区分"]["numeric"])
        self.assertEqual(f["作業区分"]["kinds"], 3)


if __name__ == "__main__":
    unittest.main()
