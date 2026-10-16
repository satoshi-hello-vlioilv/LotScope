# -*- coding: utf-8 -*-
"""ダッシュボードの改良（版 3.39.0。利用者の要望 2026-10）のサーバー側:
統計の値（services/aggregate.py）・表し方（割合・累計・差・順位）・設備を複数選ぶ・設備をまとめる（合算・このパネルのグループ・設備グループのマスタ）・
パネルの書式と見せ方の決まり（services/dashboard.py）。どれも素朴に数え直した答えと突き合わせる。"""
import json
import math
import random
import sqlite3
import statistics
import tempfile
import unittest
from pathlib import Path

from app.services import aggregate, dashboard, equip_groups, pivot
from tests import test_dashboard as td


def acc_of(agg, xs, **m):
    a = aggregate.Acc(agg)
    for x in xs:
        a.add(aggregate._num(x), x)
    return a.value({"agg": agg, "column": "x", **m})


class Aggregates(unittest.TestCase):
    def test_stats_match_the_statistics_module(self):
        rnd = random.Random(7)
        xs = [round(rnd.gauss(1000, 3), 3) for _ in range(257)]
        self.assertAlmostEqual(acc_of("median", xs), statistics.median(xs))
        self.assertAlmostEqual(acc_of("sd", xs), statistics.stdev(xs), places=9)
        self.assertAlmostEqual(acc_of("var", xs), statistics.variance(xs), places=7)
        self.assertAlmostEqual(acc_of("avg", xs), statistics.fmean(xs))
        self.assertAlmostEqual(acc_of("cv", xs), statistics.stdev(xs) / statistics.fmean(xs) * 100, places=9)
        self.assertAlmostEqual(acc_of("range", xs), max(xs) - min(xs))
        self.assertEqual(acc_of("n", xs + ["", "abc"]), len(xs))
        q = statistics.quantiles(xs, n=4, method="inclusive")
        self.assertAlmostEqual(acc_of("q1", xs), q[0])
        self.assertAlmostEqual(acc_of("q3", xs), q[2])
        self.assertAlmostEqual(acc_of("iqr", xs), q[2] - q[0])
        self.assertAlmostEqual(acc_of("pct", xs, p=90), statistics.quantiles(xs, n=10, method="inclusive")[8])
        mean, sd = statistics.fmean(xs), statistics.stdev(xs)
        self.assertAlmostEqual(acc_of("cpk", xs, lsl=990, usl=1012), min(1012 - mean, mean - 990) / (3 * sd), places=9)
        self.assertAlmostEqual(acc_of("cpk", xs, usl=1012), (1012 - mean) / (3 * sd), places=9)

    def test_kinds_and_mode(self):
        self.assertEqual(acc_of("distinct", ["A", "B", " A ", "", None, "C"]), 3)
        self.assertEqual(acc_of("mode", [3, 1, 3, 2, 1]), 1)          # 同じ数なら小さい方
        self.assertIsNone(acc_of("sd", [5]))                             # 1 つではばらつきは決まらない
        self.assertIsNone(acc_of("median", []))

    def test_clean_needs_spec_for_cpk_and_keeps_show(self):
        def ok(c):
            return c == "x"
        with self.assertRaises(ValueError):
            aggregate.clean({"agg": "cpk", "column": "x"}, ok)
        with self.assertRaises(ValueError):
            aggregate.clean({"agg": "median", "column": "y"}, ok)
        self.assertEqual(aggregate.clean({"agg": "pct", "column": "x", "p": 250, "show": "cum"}, ok), {"agg": "pct", "column": "x", "p": 99, "show": "cum"})
        self.assertEqual(aggregate.name({"agg": "pct", "column": "厚さ", "p": 90, "show": "pct_total"}), "厚さの90%点（総計に対する%）")


def make(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE t (設備 TEXT, 日 TEXT, 厚さ TEXT, 品種 TEXT)")
    c.executemany("INSERT INTO t VALUES (?, ?, ?, ?)", rows)
    c.commit()
    c.close()


class Query(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        rnd = random.Random(3)
        self.rows = [(rnd.choice(["CR1", "CR2", "L-1", "L-2", "SL1"]), f"2026-10-{rnd.randint(1, 5):02d}", str(round(rnd.uniform(1, 9), 2)),
                      rnd.choice(["A", "B", "C"])) for _ in range(400)]
        self.path = self.tmp / "d.sqlite3"
        make(self.path, self.rows)
        self.part = pivot.Part(self.path, equip={"column": "設備", "match": lambda v: str(v or "").strip()})

    def q(self, **kw):
        return pivot.query_many([self.part], **{k: json.dumps(v, ensure_ascii=False) if k in ("rows", "cols", "measures") else v for k, v in kw.items()})

    @staticmethod
    def cell(d, r, c=()):
        return next(x["v"] for x in d["cells"] if x["r"] == list(r) and x["c"] == list(c))

    def test_stats_per_row_match_brute_force(self):
        d = self.q(rows=[{"column": "@equip"}], measures=[{"agg": "median", "column": "厚さ"}, {"agg": "sd", "column": "厚さ"}, {"agg": "distinct", "column": "品種"}])
        for e in {r[0] for r in self.rows}:
            xs = [float(r[2]) for r in self.rows if r[0] == e]
            v = self.cell(d, [e])
            self.assertAlmostEqual(v[0], statistics.median(xs), places=6)
            self.assertAlmostEqual(v[1], statistics.stdev(xs), places=6)
            self.assertEqual(v[2], len({r[3] for r in self.rows if r[0] == e}))

    def test_show_as_share_cum_diff_rank(self):
        d = self.q(rows=[{"column": "日", "part": ""}], measures=[{"agg": "count"}, {"agg": "count", "show": "pct_total"}, {"agg": "count", "show": "cum"},
                                                                   {"agg": "count", "show": "diff"}, {"agg": "count", "show": "rank"}])
        days = sorted({r[1] for r in self.rows})
        n = [sum(1 for r in self.rows if r[1] == day) for day in days]
        keys = d["orders"][0]
        self.assertEqual([d["labels"][0][k] for k in keys], days)
        for i, k in enumerate(keys):
            v = self.cell(d, [k])
            self.assertEqual(v[0], n[i])
            self.assertAlmostEqual(v[1], n[i] / len(self.rows) * 100, places=4)
            self.assertEqual(v[2], sum(n[:i + 1]))
            self.assertEqual(v[3], None if i == 0 else n[i] - n[i - 1])
            self.assertEqual(v[4], sorted(n, reverse=True).index(n[i]) + 1)

    def test_pick_equips_and_group_them(self):
        d = self.q(rows=[{"column": "@equip"}], measures=[{"agg": "count"}], equips=["cr1", "L-1"])
        self.assertEqual(set(d["orders"][0]), {"CR1", "L-1"})
        self.assertEqual(self.cell(d, [])[0], sum(1 for r in self.rows if r[0] in ("CR1", "L-1")))
        # 選んだ設備を 1 つに合算
        s = self.q(rows=[{"column": "@equip"}], measures=[{"agg": "count"}], equips=["CR1", "CR2"],
                   egroups={"groups": [{"name": "CR の計", "members": ["CR1", "CR2"]}], "rest": "other", "other": "CR の計"})
        self.assertEqual(s["orders"][0], ["CR の計"])
        self.assertEqual(self.cell(s, ["CR の計"])[0], sum(1 for r in self.rows if r[0] in ("CR1", "CR2")))
        # グループ（並びはグループの順）・入らない設備はそのまま／その他／出さない
        groups = [{"name": "L ライン", "members": ["L-1", "L-2"]}, {"name": "CR ライン", "members": ["CR1", "CR2"]}]
        keep = self.q(rows=[{"column": "@equip"}], measures=[{"agg": "count"}], egroups={"groups": groups, "rest": "keep"})
        self.assertEqual(keep["orders"][0], ["L ライン", "CR ライン", "SL1"])
        other = self.q(rows=[{"column": "@equip"}], measures=[{"agg": "count"}], egroups={"groups": groups, "rest": "other"})
        self.assertEqual(other["orders"][0], ["L ライン", "CR ライン", pivot.OTHER_EQUIP])
        hide = self.q(rows=[{"column": "@equip"}], measures=[{"agg": "count"}], egroups={"groups": groups, "rest": "hide"})
        self.assertEqual(hide["orders"][0], ["L ライン", "CR ライン"])
        self.assertEqual(self.cell(hide, [])[0], sum(1 for r in self.rows if r[0] != "SL1"))
        # 設備の段が無くても、まとめで出さない設備は数えない
        flat = self.q(measures=[{"agg": "count"}], egroups={"groups": groups, "rest": "hide"})
        self.assertEqual(self.cell(flat, [])[0], self.cell(hide, [])[0])


class Layout(unittest.TestCase):
    def test_fmt_frame_egroup_are_cleaned(self):
        p = dashboard.clean_panel({"id": "a", "visual": "column", "source": "work", "body": {"rows": [{"column": "@equip"}], "measures": [{"agg": "pct", "column": "厚さ", "p": 95}]},
                                   "frame": "accent", "equips": ["CR1", "CR1", " "], "egroup": {"mode": "sum"},
                                   "fmt": {"labels": "inside", "xdate": "md", "digits": 9, "ymin": "0", "ymax": "-1", "palette": "cud", "colors": {"CR1": "#123456", "x": "red"},
                                           "refs": [{"value": "10", "label": "目標"}, {"value": "x"}], "grid": False, "bogus": 1}}, 0, 8)
        self.assertEqual(p["frame"], "accent")
        self.assertFalse(p["emph"])
        self.assertEqual(p["equips"], ["CR1"])
        self.assertEqual(p["egroup"], {"mode": "sum", "rest": "keep", "name": dashboard.SUM_NAME})
        self.assertEqual(p["body"]["measures"], [{"agg": "pct", "column": "厚さ", "p": 95}])
        self.assertEqual(p["fmt"], {"labels": "inside", "xdate": "md", "digits": 4, "ymin": 0.0, "palette": "cud", "colors": {"CR1": "#123456"},
                                    "refs": [{"value": 10.0, "label": "目標", "color": ""}], "grid": False})
        old = dashboard.clean_panel({"visual": "kpi", "source": "work", "emph": True}, 0, 8)       # 前の版の「目立たせる」
        self.assertEqual(old["frame"], "emph")

    def test_board_whole_settings_reach_every_group(self):
        b = dashboard.clean_panel({"visual": "board", "equips": ["CR1"], "egroup": {"mode": "master", "set": "ライン別"},
                                   "filters": [{"column": "作業区分", "op": "in", "value": "[\"通常\"]"}], "groups": dashboard.board_default()["groups"]}, 0, 8)
        q = dashboard.board_query(b, 1)
        self.assertEqual(q["equips"], ["CR1"])
        self.assertEqual(q["egroup"]["set"], "ライン別")
        self.assertIn({"column": "作業区分", "op": "in", "value": "[\"通常\"]"}, q["filters"])

    def test_new_board_looks_and_limits(self):
        g = dashboard.clean_group({"source": "work", "look": "signal", "limits": {"warn": "5", "alert": 1, "dir": "low"}}, 0)
        self.assertEqual((g["look"], g["limits"]), ("signal", {"warn": 5.0, "alert": 1.0, "dir": "low"}))

    def test_groups_master_rows(self):
        rows = [{"id": 1, **equip_groups.clean_row({"name": "CR", "set": "ライン別", "equipment": "CR1, CR2"}), "表示順": "20"},
                {"id": 2, **equip_groups.clean_row({"name": "L", "set": "ライン別", "equipment": ["L-1"]}), "表示順": "10"},
                {"id": 3, **equip_groups.clean_row({"name": "全部", "set": "工場", "equipment": "CR1,L-1"})}]
        self.assertEqual(equip_groups.groups_for(rows, "ライン別"), [{"name": "L", "members": ["L-1"]}, {"name": "CR", "members": ["CR1", "CR2"]}])
        self.assertIn("もうあります", equip_groups.check_unique(rows, {"名称": "cr", "まとめ方": "ライン別"}))
        self.assertEqual(equip_groups.check_unique(rows, {"名称": "CR", "まとめ方": "工場"}), "")
        with self.assertRaises(equip_groups.GroupError):
            equip_groups.clean_row({"name": "x", "equipment": []})


class Routes(unittest.TestCase):
    """本物の道（/api/dashboard/query・/api/masters/equipgroups）で: 作業実績の設備を複数選ぶ・合算・マスタのグループ（試験の元は test_dashboard と同じ）"""
    setUp = td.Api.setUp
    tearDown = td.Api.tearDown

    def ask(self, panel):
        from datetime import datetime
        import time
        self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)
        for _ in range(30):
            r = self.c.post("/api/dashboard/query", json={"panel": panel})
            d = r.get_json()
            if r.status_code != 503 and d.get("kind") != "copying":
                break
            time.sleep(0.1)
        self.assertEqual(r.status_code, 200, d)
        return d

    def test_work_equips_sum_and_master_groups(self):
        base = {"visual": "none", "source": "work", "body": {"rows": [{"column": "@equip"}], "measures": [{"agg": "count"}]}}
        d = self.ask({**base, "equips": ["CR1"]})
        self.assertEqual(d["orders"][0], ["CR1"])
        d = self.ask({**base, "egroup": {"mode": "sum", "name": "2 台の計"}})
        self.assertEqual(d["orders"][0], ["2 台の計"])
        self.assertEqual(Query.cell(d, ["2 台の計"])[0], 4)
        r = self.c.post("/api/masters/equipgroups", json={"name": "ライン A", "set": "ライン別", "equipment": ["CR1", "L-1"]})
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual(self.c.post("/api/masters/equipgroups", json={"name": "ライン A", "set": "ライン別", "equipment": ["CR1"]}).status_code, 409)
        d = self.ask({**base, "egroup": {"mode": "master", "set": "ライン別"}})
        self.assertEqual(d["orders"][0], ["ライン A"])
        self.assertEqual(Query.cell(d, ["ライン A"])[0], 4)
        d = self.ask({**base, "egroup": {"mode": "master", "set": "無いまとめ方"}})
        self.assertIn("設備グループ", d["note"])
        src = self.c.get("/api/dashboard/sources").get_json()
        self.assertEqual(src["egroupSets"][0]["name"], "ライン別")

    def test_in_filter_from_the_panel_and_stats(self):
        d = self.ask({"visual": "none", "source": "work", "filters": [{"column": "ロット番号", "op": "in", "value": json.dumps(["L1", "L3", "M1"])}],
                      "body": {"rows": [], "measures": [{"agg": "count"}, {"agg": "distinct", "column": "ロット番号"}]}})
        self.assertEqual(Query.cell(d, [])[0:2], [3, 3])
        self.assertTrue(math.isfinite(Query.cell(d, [])[0]))


if __name__ == "__main__":
    unittest.main()
