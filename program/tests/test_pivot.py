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


def to_datetime_plain(v, time_value=None):
    """近道の無い日時の読み方（sqlite_ro.to_datetime の版 3.42.0 までの形）"""
    from app.services.sqlite_ro import to_date, to_minutes
    d = to_date(v)
    if d is None:
        return None
    hms = to_minutes(v)
    if hms is None and time_value is not None:
        hms = to_minutes(time_value)
    return d if hms is None else f"{d} {hms[0]:02d}:{hms[1]:02d}:{hms[2]:02d}"


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

    def test_workday_by_month_matches_the_oracle(self):
        """作業日のまとめ「年月」（版 3.26.0）: 現場歴の作業日の頭 7 字ごとのロット数・重量"""
        ans = self.ask([{"column": "@workday", "part": "ym"}], [], [{"agg": "lots"}, {"agg": "sum", "column": "重量"}])
        works, weight = defaultdict(set), defaultdict(float)
        for stamp, w, _, _ in self.rows:
            m = place(stamp)[0][:7]
            works[m].add(stamp)
            weight[m] += w
        self.assertEqual(ans["orders"][0], sorted(works))
        for m in works:
            got = cell(ans, [m])
            self.assertEqual(got[0], len(works[m]), m)
            self.assertAlmostEqual(got[1], weight[m], places=4)
        self.assertRegex(ans["labels"][0][ans["orders"][0][0]], r"^\d{4}/\d{2}$")
        self.assertEqual(ans["dims"]["rows"][0]["name"], "作業日（年月）")

    def test_month_filter_counts_only_that_month_and_lists_the_months(self):
        """月で絞る（版 3.26.0）: 日の段がその月の行だけ。months は絞る前の月の並び。月で区切る（年月の段の下に日の段）でも同じ"""
        months = sorted({place(r[0])[0][:7] for r in self.rows})
        pick = months[len(months) // 2]
        want_days = defaultdict(set)
        for stamp, _, _, _ in self.rows:
            day = place(stamp)[0]
            if day.startswith(pick):
                want_days[day].add(stamp)
        for rows in ([{"column": "@workday"}], [{"column": "@workday", "part": "ym"}, {"column": "@workday"}]):
            ans = self.ask(rows, [], [{"agg": "lots"}], month=pick)
            self.assertEqual((ans["months"], ans["month"]), (months, pick), rows)
            day_level = len(rows) - 1
            self.assertEqual(sorted(ans["orders"][day_level]), sorted(want_days), "その月の日だけ")
            self.assertEqual(cell(ans)[0], len(set().union(*want_days.values())), "総計＝その月のロット数")
            if day_level:
                self.assertEqual(cell(ans, [pick])[0], cell(ans)[0], "月の小計（月で区切る）")
        whole = self.ask([{"column": "@workday", "part": "ym"}, {"column": "@workday"}], [], [{"agg": "lots"}])
        self.assertEqual(whole["month"], "", "月を選ばなければ全部")
        for m in months:
            self.assertEqual(cell(whole, [m])[0], len({r[0] for r in self.rows if place(r[0])[0].startswith(m)}), f"月の小計 {m}")
        self.assertEqual(self.ask([{"column": "@shift"}], [], [{"agg": "count"}], month=pick)["month"], "", "日の段が無ければ月では絞らない")

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

    def test_box_stats_per_row_leaf_match_the_oracle(self):
        """箱ひげ（版 3.27.0）: 作業区分ごとの重量の四分位・ひげ・外れ値を素朴に数え直して突き合わせる"""
        ans = self.ask([{"column": "作業区分"}], [], [{"agg": "avg", "column": "重量"}], box="重量")
        groups = defaultdict(list)
        for _, w, kind, _ in self.rows:
            groups[str(kind)].append(float(w))
        self.assertEqual(ans["box"], "重量")
        self.assertEqual(len(ans["boxes"]), len(groups))
        for b in ans["boxes"]:
            xs = sorted(groups[b["r"][0][1:]])
            q1, med, q3 = statistics.quantiles(xs, n=4, method="inclusive")
            self.assertEqual(b["n"], len(xs))
            for k, v in (("q1", q1), ("median", med), ("q3", q3), ("min", xs[0]), ("max", xs[-1])):
                self.assertAlmostEqual(b[k], v, places=6, msg=(b["r"], k))
            lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
            self.assertAlmostEqual(b["lo"], min(x for x in xs if x >= lo), places=6)
            self.assertAlmostEqual(b["hi"], max(x for x in xs if x <= hi), places=6)
            self.assertEqual(b["outN"], sum(1 for x in xs if x < lo or x > hi))
        self.assertEqual(self.ask([{"column": "作業区分"}])["boxes"], [], "頼まなければ出さない")
        with self.assertRaises(pivot.PivotError):
            self.ask([{"column": "作業区分"}], box="無い列")

    def test_box_outliers_are_listed(self):
        b = pivot.box_stats([1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 100.0])
        self.assertEqual((b["out"], b["outN"], b["hi"]), ([100.0], 1, 4.0), "四分位の範囲の 1.5 倍より外は外れ値・ひげは内側の端")
        self.assertIsNone(pivot.box_stats([]))

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

    def test_calc_columns_count_like_the_list_shows_them(self):
        """計算列（版 3.38.0）: 段・値・条件・期間に、表示列で作った式の列を使える。素朴な数え直しと合う"""
        calc = {"formulas": {"重さ": "if([重さの元] >= 1000, '重', '軽')", "倍": "[重量] * 2", "壊れ": "if(1"}, "names": {"重量": "重さの元"}}
        ans = self.ask([{"column": "重さ"}], [], [{"agg": "count"}, {"agg": "sum", "column": "倍"}], calc=calc,
                       filters=json.dumps([{"column": "倍", "op": "gte", "value": "100"}]))
        want_n, want_w = defaultdict(int), defaultdict(float)
        for _, w, _, _ in self.rows:
            if w * 2 >= 100:
                k = "重" if w >= 1000 else "軽"
                want_n[k] += 1
                want_w[k] += w * 2
        for k in want_n:
            got = cell(ans, ["$" + k])
            self.assertEqual(got[0], want_n[k], f"{k} の行の数（表示名で書いた式・計算列の条件）")
            self.assertAlmostEqual(got[1], want_w[k], places=3, msg=f"{k} の計算列の合計")
        self.assertEqual(ans["ignoredFilters"], [], "計算列の条件は効く")
        with self.assertRaisesRegex(pivot.PivotError, "壊れ"):
            self.ask([{"column": "壊れ"}], calc=calc)
        f = pivot.fields(str(self.db), preferred_table="実績", table_candidates=work_log.TABLE_CANDIDATES, calc=calc)
        by = {x["column"]: x for x in f["fields"]}
        self.assertEqual((by["重さ"]["calc"], by["重さ"]["kinds"], by["重さ"]["deps"]), (True, 2, ["重量"]))
        self.assertTrue(by["倍"]["numeric"] and not by["倍"]["date"], "数の計算列は値に使える")
        self.assertEqual(by["壊れ"].get("error"), "式が読めません")
        self.assertNotIn("重量", [x["column"] for x in f["fields"] if x.get("calc")], "表にある列の式（作り替え）は計算列ではない")

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


class Many(unittest.TestCase):
    """いくつかのファイルを 1 つの集計に（版 3.37.0。ダッシュボードの「作業実績 すべての設備」）・設備の段（@equip）・期間で絞る。
    芯は素朴な数え直し: 設備ごとの答えを足した物と、まとめた答えが合うか（ロット数は設備ごとに見分ける）"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.files, self.rows = {}, {}
        for eq in ("CR1", "CR2"):
            p = self.tmp / f"{eq}.sqlite3"
            lotlist_fixture.make_work(str(p), eq, n=300)
            self.files[eq] = p
            with sqlite3.connect(p) as c:
                self.rows[eq] = c.execute("SELECT [BOX実績_作業開始_日付], [重量], [作業区分] FROM 実績").fetchall()
        self.work = {"clock": shifts.Clock(segs(THREE)), "basis": "work", "start": ""}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def parts(self, work=None):
        return [pivot.Part(str(p), preferred_table="実績", table_candidates=work_log.TABLE_CANDIDATES, work=work or self.work, equip={"name": eq})
                for eq, p in self.files.items()]

    def many(self, rows, cols=(), measures=({"agg": "count"},), parts=None, **kw):
        return pivot.query_many(parts or self.parts(), rows=json.dumps(list(rows)), cols=json.dumps(list(cols)), measures=json.dumps(list(measures)), **kw)

    def test_equipment_by_workday_matches_each_file(self):
        ans = self.many([{"column": "@equip"}], [{"column": "@shift"}], [{"agg": "lots"}, {"agg": "sum", "column": "重量"}, {"agg": "avg", "column": "重量"}])
        self.assertEqual(ans["orders"][0], ["CR1", "CR2"], "設備はファイルの並び")
        self.assertEqual(ans["dims"]["rows"][0]["name"], "設備")
        for eq, rows in self.rows.items():
            want_lots = len({r[0] for r in rows})
            self.assertEqual(cell(ans, [eq])[0], want_lots, f"{eq} のロット数＝その設備の重複の無い作業開始")
            self.assertAlmostEqual(cell(ans, [eq])[1], sum(r[1] for r in rows), places=4)
        both = sum(len({r[0] for r in rows}) for rows in self.rows.values())
        self.assertEqual(cell(ans)[0], both, "総計のロット数は設備ごとに見分けて足す（別の設備の同じ作業開始は別の作業）")
        allw = [r[1] for rows in self.rows.values() for r in rows]
        self.assertAlmostEqual(cell(ans)[2], sum(allw) / len(allw), places=4, msg="平均は全部の行で（設備の平均の平均ではない）")
        self.assertEqual([p["name"] for p in ans["parts"]], ["CR1", "CR2"])
        self.assertEqual([ans["labels"][1][k] for k in ans["orders"][1]], ["1直", "2直", "3直"], "直は名前で揃え、勤務体系の順")

    def test_shifts_are_matched_by_name_across_patterns(self):
        """設備で勤務体系が違う（CR2 だけ 4,5直）: 番号ではなく名前で見分ける（CR1 の 1直と CR2 の 4直を同じ列にしない）"""
        two = shifts.segments_of(shifts.clean_row({"name": "4,5直", "segments": [
            {"name": "4直", "start": "07:00", "end": "19:00", "dayOffset": 0}, {"name": "5直", "start": "19:00", "end": "07:00", "dayOffset": -1}]}))
        parts = self.parts()
        parts[1].work = {"clock": shifts.Clock(two), "basis": "work", "start": ""}
        ans = self.many([{"column": "@equip"}], [{"column": "@shift"}], [{"agg": "count"}], parts=parts)
        names = [ans["labels"][1][k] for k in ans["orders"][1]]
        self.assertEqual(sorted(names), sorted(["1直", "2直", "3直", "4直", "5直"]), names)
        self.assertIsNone(cell(ans, ["CR1"], ["4直"]), "CR1 に 4直は無い")
        self.assertEqual(cell(ans, ["CR2"])[0], len(self.rows["CR2"]))

    def test_period_yesterday_by_workday(self):
        """期間「前日」（作業日・現場歴）: いまを勤務体系で現場歴の日にして、その 1 日前の行だけ"""
        days = sorted({place(r[0])[0] for rows in self.rows.values() for r in rows})
        target = days[-3]
        now = datetime.fromisoformat(target) + timedelta(days=1, hours=3)      # 次の日の 3 時＝現場歴ではまだ target の日（3直）
        ans = self.many([{"column": "@equip"}], [], [{"agg": "lots"}], period={"column": "@workday", "kind": "yesterday"}, now=now)
        yday = (datetime.fromisoformat(target) - timedelta(days=1)).date().isoformat()
        self.assertEqual(ans["period"]["ranges"], [{"from": yday, "to": yday}], "3 時は前の日の 3直なので、前日はその 1 日前")
        for eq, rows in self.rows.items():
            want = len({r[0] for r in rows if place(r[0])[0] == yday})
            got = cell(ans, [eq])
            self.assertEqual(got[0] if got else 0, want, eq)
        week = self.many([], [], [{"agg": "count"}], period={"column": "@workday", "kind": "days", "n": 7}, now=now)
        lo = (datetime.fromisoformat(target) - timedelta(days=6)).date().isoformat()
        self.assertEqual(cell(week)[0], sum(1 for rows in self.rows.values() for r in rows if lo <= place(r[0])[0] <= target), "直近 7 日（今日を含む）")

    def test_period_on_a_date_column_and_ranges(self):
        self.assertEqual(pivot.period_range("this_month", 0, "2026-10-16"), ("2026-10-01", "2026-10-16"))
        self.assertEqual(pivot.period_range("last_month", 0, "2026-03-31"), ("2026-02-01", "2026-02-28"))
        self.assertEqual(pivot.period_range("days", 3, "2026-10-01"), ("2026-09-29", "2026-10-01"))
        with self.assertRaises(pivot.PivotError):
            pivot.period_range("week", 0, "2026-10-01")
        now = datetime(2026, 10, 2, 12)
        ans = self.many([], [], [{"agg": "count"}], parts=self.parts()[:1], period={"column": "作業日", "kind": "this_month"}, now=now)
        with sqlite3.connect(self.files["CR1"]) as c:
            want = sum(1 for (d,) in c.execute("SELECT [作業日] FROM 実績") if "2026/10/01" <= d <= "2026/10/02")
        self.assertEqual((cell(ans) or [0])[0], want, "日付の列は暦の今日から")
        with self.assertRaises(pivot.PivotError):
            self.many([], [], [{"agg": "count"}], parts=self.parts()[:1], period={"column": "無い列", "kind": "today"})

    def test_period_prefilter_keeps_odd_formats(self):
        """期間の先絞り（版 3.43.0）: 形の決まった日付は SQLite で前後 2 日に絞るが、形の違う日付（1 桁の月・空白で始まる・ISO・
        Excel の数・2 桁の年・8 桁）は外さず Python が決める。答えは先絞りをしないとき（素朴な数え直し）と同じ"""
        p = self.tmp / "odd.sqlite3"
        odd = ["2026/10/01 8:00:00", "2026/9/30 23:30:00", " 2026/10/01 9:00:00", "2026-10-01T10:00:00", "2026.10.01 11:00",
               "26/10/01 12:00:00", "20261001", "2026/10/01", "2026/08/01 8:00:00", "2026/10/05 8:00:00", None, "", "あ", 46000.5, "2026/13/01 8:00:00"]
        with sqlite3.connect(p) as c:
            c.execute("CREATE TABLE 実績 (ロット番号 TEXT, [BOX実績_作業開始_日付], 作業日)")
            c.executemany("INSERT INTO 実績 VALUES (?, ?, ?)", [(f"L{i}", v, v) for i, v in enumerate(odd)])
        part = pivot.Part(str(p), preferred_table="実績", table_candidates=work_log.TABLE_CANDIDATES, work=self.work, equip={"name": "X"})
        now = datetime(2026, 10, 2, 10)
        for col in ("@workday", "作業日"):
            got = self.many([], [], [{"agg": "count"}], parts=[part], period={"column": col, "kind": "yesterday"}, now=now)
            day = "2026-10-01"
            if col == "@workday":
                want = sum(1 for v in odd if (self.work["clock"].place(to_datetime_plain(v), "work")[0] == day))
            else:
                want = sum(1 for v in odd if (to_datetime_plain(v) or "")[:10] == day)
            self.assertEqual((cell(got) or [0])[0], want, col)
            self.assertGreater(want, 4, "形の違う日付も数えた")
        w, prm = pivot.period_prefilter("d", ("2026-10-01", "2026-10-01"))
        self.assertEqual(prm, ["2026-09-29", "2026-10-03"], "前後 2 日")

    def test_fast_datetime_matches_the_plain_reading(self):
        """日時の近道（sqlite_ro.to_datetime の 1 回の照合）は、近道の無い読み方と同じ答え"""
        from app.services import sqlite_ro
        vals = ["2026/10/01 8:15:00", "2026/1/5 23:59:59", "2026-10-01T08:15", "2026-10-01T08:15:30.123", "2026.10.01 7:05", " 2026/10/01 8:15:00 ",
                "2026/10/01", "2026/02/30 8:00:00", "2026/10/01 24:00:00", "2026/10/01 8:61:00", "2026/10/01 8:15:00 extra", "26/10/01 1:02:03",
                "2026年10月1日 8:00", "20261001", "", None, 45000, "x2026/10/01", "2026/10/01 8:15:00.5"]
        for v in vals:
            for tv in (None, "9:30", "bad"):
                with self.subTest(v=v, tv=tv):
                    self.assertEqual(sqlite_ro.to_datetime(v, tv), to_datetime_plain(v, tv))

    def test_equipment_from_a_column_and_unknown_filters(self):
        p = self.tmp / "wip.sqlite3"
        lotlist_fixture.make_wip(str(p), n=400)
        from app.services.data_sources import EquipmentMatcher
        match = EquipmentMatcher(lotlist_fixture.WIP_EQUIPMENT, "前方一致")
        part = pivot.Part(str(p), table_candidates=["仕掛"], equip={"column": "残仕掛設備ｺｰｽ", "match": match})
        ans = pivot.query_many([part], rows=json.dumps([{"column": "@equip"}]), measures=json.dumps([{"agg": "lots"}]),
                               filters=json.dumps([{"column": "無い列", "op": "eq", "value": "x"}]))
        with sqlite3.connect(p) as c:
            want = defaultdict(set)
            for lot, course in c.execute("SELECT ロット番号, 残仕掛設備ｺｰｽ FROM 仕掛"):
                want[match(course)].add(lot)
        for eq, lots in want.items():
            self.assertEqual(cell(ans, [eq])[0], len(lots), eq or "設備なし")
        self.assertEqual(ans["labels"][0][""], "設備なし")
        self.assertEqual(ans["ignoredFilters"], ["無い列"], "表に無い列の条件は効かないので、知らせる")
        with self.assertRaises(pivot.PivotError):
            pivot.query(str(p), table_candidates=["仕掛"], rows=json.dumps([{"column": "@equip"}]))

    def test_a_broken_file_is_skipped_when_there_are_others(self):
        bad = self.tmp / "bad.sqlite3"
        bad.write_bytes(b"not a database")
        parts = self.parts() + [pivot.Part(str(bad), equip={"name": "XX"})]
        ans = self.many([{"column": "@equip"}], [], [{"agg": "count"}], parts=parts)
        self.assertEqual([x["name"] for x in ans["skipped"]], ["XX"])
        self.assertEqual(cell(ans)[0], sum(len(r) for r in self.rows.values()))
        with self.assertRaises(Exception):
            self.many([{"column": "@equip"}], parts=parts[2:])


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
