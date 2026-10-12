# -*- coding: utf-8 -*-
"""作業実績の「作業でまとめる」: 作業開始が同じ行を 1 作業（＝1 ロット）と数え、日・日＋直（WaveLog の勤務体系と同じ決め方）でまとめる。

評価の芯は oracle（素朴な数え直し）: 試験用の作業実績を、Clock を使わず日時の計算だけで 1直/2直/3直・現場歴の日に分けて数え、
サーバーの答え（buckets・ページの行の日と直・作業の切れ目）と突き合わせる。"""
import json
import shutil
import sqlite3
import tempfile
import unittest
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import shifts, work_log, work_summary
from app.services.db_mirror import DbMirror
from app.services.sqlite_ro import to_datetime
from tests import lotlist_fixture

ROOT = Path(__file__).resolve().parents[1]
THREE = shifts.TEMPLATES[1]["segments"]          # 1直 07:00-15:00 / 2直 15:00-23:00 / 3直 23:00-07:00（-1）
FOUR_FIVE = shifts.TEMPLATES[2]["segments"]      # 4直 11:00-19:10 / 5直 21:20-05:45（-1）


def segs(raw):
    return shifts.segments_of({"区分": json.dumps(shifts.clean_segments(raw))})


def oracle(rows, basis="work"):
    """素朴な数え直し: 作業開始（2026/10/01 8:15:00 の形）ごとに 1 作業。1直 7-15・2直 15-23・3直 23-7（現場歴は 0〜7 時を前の日）。"""
    works = defaultdict(int)
    for stamp in rows:
        works[stamp] += 1
    out = defaultdict(lambda: [0, 0, 0])
    for stamp, n in works.items():
        dt = datetime.strptime(stamp, "%Y/%m/%d %H:%M:%S")
        shift = 0 if 7 <= dt.hour < 15 else 1 if 15 <= dt.hour < 23 else 2
        day = (dt - timedelta(days=1) if basis == "work" and dt.hour < 7 else dt).date().isoformat()
        b = out[(day, shift)]
        b[0] += 1
        b[1] += n
        b[2] += n > 1
    return dict(out)


class Parse(unittest.TestCase):
    def test_datetime_shapes(self):
        cases = {("2026/10/01 8:15:00", None): "2026-10-01 08:15:00", ("2026-10-01T08:15", None): "2026-10-01 08:15:00",
                 ("2026/10/01", "8:15"): "2026-10-01 08:15:00", ("2026/10/01", "1899/12/30 23:05:09"): "2026-10-01 23:05:09",
                 ("2026/10/01 7:00:00", "9:00"): "2026-10-01 07:00:00", ("20261001", None): "2026-10-01",
                 ("26/10/01 23:48:54", None): "2026-10-01 23:48:54", ("2026/10/01 25:00", None): "2026-10-01",
                 ("不明", None): None, ("", "8:00"): None, (None, None): None}
        for (v, t), want in cases.items():
            self.assertEqual(to_datetime(v, t), want, (v, t))

    def test_work_key(self):
        self.assertEqual(work_summary.work_key("2026/10/01 8:15:00"), work_summary.work_key(" 2026-10-01 08:15 "), "書き方が違っても同じ日時は同じ作業")
        self.assertEqual(work_summary.work_key(""), "", "空はまとめない")
        self.assertEqual(work_summary.work_key("不明"), work_summary.work_key(" 不明 "))
        self.assertNotEqual(work_summary.work_key("不明"), work_summary.work_key("2026/10/01"))

    def test_start_and_time_columns(self):
        cs = ["ロット番号", "BOX実績_作業開始_日付", "BOX実績_作業開始_時刻", "作業日"]
        self.assertEqual(work_summary.start_column(cs), "BOX実績_作業開始_日付")
        self.assertEqual(work_summary.start_column(cs, "作業日"), "作業日", "選んだ列が先")
        self.assertEqual(work_summary.start_column(["X_作業開始日時"]), "X_作業開始日時")
        self.assertEqual(work_summary.start_column(["作業日"]), "")
        self.assertEqual(work_summary.time_column(cs, "BOX実績_作業開始_日付"), "BOX実績_作業開始_時刻")
        self.assertEqual(work_summary.time_column(cs, "作業日"), "")


class Shifts(unittest.TestCase):
    def test_resolve_like_wavelog(self):
        clock = shifts.Clock(segs(THREE))
        for hm, want in {"07:00": (0, 0), "14:59": (0, 0), "15:00": (1, 0), "22:59": (1, 0), "23:00": (2, 0), "00:00": (2, -1), "06:59": (2, -1)}.items():
            self.assertEqual(clock.resolve(shifts.hm(hm)), want, hm)
        gap = shifts.Clock(segs(FOUR_FIVE))
        self.assertEqual(gap.resolve(shifts.hm("20:00")), (shifts.OUTSIDE, 0), "直の間の時刻はどの直にも入れない")
        self.assertEqual(gap.resolve(shifts.hm("05:44")), (1, -1))

    def test_place_work_and_calendar_days(self):
        clock = shifts.Clock(segs(THREE))
        self.assertEqual(clock.place("2026-10-02 02:00:00", "work"), ("2026-10-01", 2), "3直の跨いだ後は前の日（現場歴）")
        self.assertEqual(clock.place("2026-10-02 02:00:00", "cal"), ("2026-10-02", 2), "太陽暦は暦の日付のまま")
        self.assertEqual(clock.place("2026-10-01 23:30:00", "work"), ("2026-10-01", 2), "同じ 3直は同じ日")
        self.assertEqual(clock.place("2026-10-01", "work"), ("2026-10-01", shifts.NO_TIME))
        self.assertEqual(clock.place(None), ("", shifts.NO_TIME))
        plus = shifts.Clock(segs([{"name": "夜", "start": "22:00", "end": "06:00", "dayOffset": 0}]))
        self.assertEqual(plus.place("2026-10-02 01:00:00", "work"), ("2026-10-02", 0), "日付補正 0 は暦どおり")

    def test_clean_segments_rules(self):
        out = shifts.clean_segments([{"name": "1直", "start": "7:00", "end": "15:00", "dayOffset": -1},
                                     {"name": "3直", "start": "23:00", "end": "7:00"}])
        self.assertEqual(out[0], {"name": "1直", "start": "07:00", "end": "15:00", "dayOffset": None}, "跨がない区分に補正を持たせない")
        self.assertEqual(shifts.segments_of({"区分": json.dumps(out)})[1]["dayOffset"], -1, "未設定は -1")
        for bad in ([{"name": "", "start": "07:00", "end": "08:00"}], [{"name": "a", "start": "7:60", "end": "8:00"}],
                    [{"name": "a", "start": "07:00", "end": "07:00"}], [{"name": "a", "start": "1:00", "end": "2:00"}] * 2):
            with self.assertRaises(shifts.ShiftError):
                shifts.clean_segments(bad)

    def test_pattern_for_prefers_the_equipment(self):
        rows = [{"id": 1, "名称": "共通", "適用設備": "", "区分": json.dumps(THREE), "表示順": "10"},
                {"id": 2, "名称": "CR1 だけ", "適用設備": "ＣＲ１, L-1", "区分": json.dumps(FOUR_FIVE), "表示順": "20"},
                {"id": 3, "名称": "壊れた", "適用設備": "TLV", "区分": "x", "表示順": "0"}]
        self.assertEqual(shifts.pattern_for(rows, "CR1")["name"], "CR1 だけ", "設備を書いた体系が先（全角も同じ名前）")
        self.assertEqual(shifts.pattern_for(rows, "CR2")["name"], "共通")
        self.assertEqual(shifts.pattern_for(rows, "TLV")["name"], "共通", "区分の読めない体系は使わない")
        self.assertIsNone(shifts.pattern_for(rows[1:], "CR2"))


class Summarize(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "w.sqlite3"
        lotlist_fixture.make_work(str(self.db), "CR1", n=600)
        with sqlite3.connect(self.db) as c:
            self.stamps = [r[0] for r in c.execute("SELECT [BOX実績_作業開始_日付] FROM 実績")]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_fixture_has_split_lots_and_night_shifts(self):
        n = defaultdict(int)
        for s in self.stamps:
            n[s] += 1
        self.assertGreater(sum(1 for v in n.values() if v > 1), 20, "分割した作業（同じ作業開始の行）がある")
        self.assertTrue(any(datetime.strptime(s, "%Y/%m/%d %H:%M:%S").hour < 7 for s in self.stamps), "3直の跨いだ後がある")

    def test_buckets_match_the_oracle(self):
        clock = shifts.Clock(segs(THREE))
        for basis in ("work", "cal"):
            got = work_summary.summarize([(s, None) for s in self.stamps], clock, basis)
            mine = {(b["day"], b["shift"]): [b["works"], b["rows"], b["split"]] for b in got["buckets"]}
            self.assertEqual(mine, oracle(self.stamps, basis), basis)
            self.assertEqual(got["total"]["rows"], len(self.stamps))
            self.assertEqual(got["total"]["works"], len(set(self.stamps)))
            days = [b["day"] for b in got["buckets"]]
            self.assertEqual(days, sorted(days, reverse=True), "新しい日から")

    def test_empty_and_unreadable_starts(self):
        got = work_summary.summarize([("", None), (None, None), ("不明", None), ("不明", None), ("2026/10/01", None)], shifts.Clock(segs(THREE)))
        self.assertEqual(got["total"], {"works": 4, "rows": 5, "split": 1, "noTime": 1, "noStamp": 4},
                         "空は 1 行ずつ・同じ字は 1 作業・日付だけは時刻なし")
        self.assertEqual(got["buckets"][-1]["day"], "", "日付の無い作業は最後")


class Api(unittest.TestCase):
    """作業実績の一覧（/api/worklog?work=1）と勤務体系のマスタ（/api/masters/shifts）。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "【New】実績"
        self.folder.mkdir()
        lotlist_fixture.make_work(str(self.folder / "実績_CR1.sqlite3"), "CR1", n=500)
        with sqlite3.connect(self.folder / "実績_CR1.sqlite3") as c:
            self.stamps = [r[0] for r in c.execute("SELECT [BOX実績_作業開始_日付] FROM 実績")]
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

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get(self, **q):
        r = self.c.get("/api/worklog", query_string={"equip": self.key, "work": "1", **q})
        d = r.get_json()
        self.assertEqual(r.status_code, 200, d)
        return d

    def add_three(self, **extra):
        r = self.c.post("/api/masters/shifts", json={"name": "交替勤務(1,2,3直)", "segments": THREE, **extra})
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()

    def test_without_shifts_counts_days_only(self):
        d = self.get()
        w = d["work"]
        self.assertEqual((w["column"], w["pattern"], w["shifts"]), ("BOX実績_作業開始_日付", None, []))
        self.assertEqual(w["total"]["works"], len(set(self.stamps)))
        self.assertTrue(all(b["shift"] == shifts.OUTSIDE for b in w["buckets"]), "直を決めていなければ直は分けない")
        self.assertEqual(d["groupCount"], len(set(self.stamps)), "まとめた数は作業の数")

    def test_pages_keep_works_whole_and_match_the_oracle(self):
        self.add_three()
        want = oracle(self.stamps, "work")
        seen, total = set(), 0
        for page in (1, 2, 3):
            d = self.get(page=page, page_size=200)
            w = d["work"]
            self.assertEqual({(b["day"], b["shift"]): [b["works"], b["rows"], b["split"]] for b in w["buckets"]}, want)
            self.assertEqual([s["name"] for s in w["shifts"]], ["1直", "2直", "3直"])
            self.assertEqual(len(w["rows"]), len(d["rows"]))
            i = 0
            # 行ごとの [鍵, 日, 直, 作業開始] は oracle と同じ。同じ鍵の行は続き、ページをまたがない
            keys = [x[0] for x in w["rows"]]
            for k, (key, day, idx, stamp) in enumerate(w["rows"]):
                raw = d["rows"][k]["BOX実績_作業開始_日付"]
                dt = datetime.strptime(raw, "%Y/%m/%d %H:%M:%S")
                self.assertEqual(stamp, dt.strftime("%Y-%m-%d %H:%M:%S"))
                self.assertIn((day, idx), want)
                self.assertEqual(idx, 0 if 7 <= dt.hour < 15 else 1 if 15 <= dt.hour < 23 else 2)
            while i < len(keys):
                j = i
                while j < len(keys) and keys[j] == keys[i]:
                    j += 1
                self.assertNotIn(keys[i], seen, "同じ作業はページの中で 1 か所・ページをまたがない")
                seen.add(keys[i])
                self.assertEqual(j - i, self.stamps.count(d["rows"][i]["BOX実績_作業開始_日付"]), "分割した行は全部そろう")
                i = j
            stamps = [x[3] for x in w["rows"]]
            self.assertEqual(stamps, sorted(stamps, reverse=True), "作業開始の新しい順")
            total += len(d["rows"])
        self.assertEqual(total, len(self.stamps))
        asc = self.get(order="asc", basis="cal")["work"]
        self.assertEqual({(b["day"], b["shift"]): [b["works"], b["rows"], b["split"]] for b in asc["buckets"]}, oracle(self.stamps, "cal"))
        self.assertEqual([x[3] for x in asc["rows"]], sorted(x[3] for x in asc["rows"]))

    def test_pick_a_day_or_a_shift_narrows_the_list_only(self):
        self.add_three()
        want = oracle(self.stamps, "work")
        (day, sh), (works, rows, _) = max(want.items(), key=lambda kv: kv[1][1])
        d = self.get(day=day, shift=sh)
        self.assertEqual((d["count"], d["groupCount"]), (rows, works), "押した日・直の作業だけ")
        self.assertTrue(all(x[1] == day and x[2] == sh for x in d["work"]["rows"]))
        self.assertEqual(sum(b["rows"] for b in d["work"]["buckets"]), len(self.stamps), "数の帯は絞らない（ほかの日も押せる）")
        self.assertEqual(d["work"]["pick"], {"day": day, "shift": sh})
        d = self.get(day=day)
        self.assertEqual(d["count"], sum(v[1] for (dd, _), v in want.items() if dd == day), "日だけ押せばその日の全部の直")

    def test_filters_apply_to_the_counts(self):
        self.add_three()
        d = self.get(filters=json.dumps([{"column": "作業者", "op": "eq", "value": "作業者A"}]))
        with sqlite3.connect(self.folder / "実績_CR1.sqlite3") as c:
            mine = [r[0] for r in c.execute("SELECT [BOX実績_作業開始_日付] FROM 実績 WHERE 作業者='作業者A'")]
        self.assertEqual(d["work"]["total"]["rows"], len(mine))
        self.assertEqual(d["work"]["total"]["works"], len(set(mine)))

    def test_equipment_pattern_and_unknown_start_column(self):
        self.add_three()
        r = self.c.post("/api/masters/shifts", json={"name": "CR1 の 4,5直", "equipment": ["CR1"], "segments": FOUR_FIVE})
        self.assertEqual(r.status_code, 201, r.get_json())
        w = self.get()["work"]
        self.assertEqual((w["pattern"]["name"], [s["name"] for s in w["shifts"]]), ("CR1 の 4,5直", ["4直", "5直"]))
        w = self.get(start="無い列")["work"]
        self.assertEqual(w["column"], "BOX実績_作業開始_日付", "無い列は既定へ")
        w = self.get(start="作業日")["work"]
        self.assertEqual((w["column"], w["total"]["noTime"] > 0), ("作業日", True), "日付だけの列も選べる（直は時刻なし）")
        self.assertIn("作業日", w["candidates"])

    def test_shift_master_crud_and_conflict(self):
        d = self.add_three(note="現場の基本")
        it = d["items"][0]
        self.assertEqual((it["name"], it["equipmentText"], it["order"], [s["dayOffset"] for s in it["segments"]]),
                         ("交替勤務(1,2,3直)", "全設備共通", 10, [0, 0, -1]))
        self.assertIn("CR1", d["equipments"], "適用設備は作業実績の設備から選べる")
        self.assertTrue(d["canEdit"])
        self.assertEqual(self.c.post("/api/masters/shifts", json={"name": "交替勤務(1,2,3直)", "segments": THREE}).status_code, 409, "同じ名称は 2 つ置かない")
        bad = self.c.post("/api/masters/shifts", json={"name": "x", "segments": [{"name": "a", "start": "7:00", "end": "7:00"}]})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("同じ", bad.get_json()["error"])
        r = self.c.put(f"/api/masters/shifts/{it['id']}", json={"equipment": "CR1、L-1", "base_rev": it["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["items"][0]["equipment"], ["CR1", "L-1"])
        r = self.c.put(f"/api/masters/shifts/{it['id']}", json={"name": "古い版", "base_rev": it["rev"]})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (409, "conflict"), "開いた後にほかで直された")
        r = self.c.delete(f"/api/masters/shifts/{it['id']}?rev={it['rev'] + 1}")
        self.assertEqual((r.status_code, r.get_json()["items"]), (200, []))


if __name__ == "__main__":
    unittest.main()
