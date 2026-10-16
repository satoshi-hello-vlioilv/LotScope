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
from app.services import dashboard, identity, shifts, work_log
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



def cell(ans, r=(), c=()):
    return next((x["v"] for x in ans["cells"] if x["r"] == list(r) and x["c"] == list(c)), None)


class Panels(Api):
    """グリッドのパネル（版 3.37.0。POST /api/dashboard/query）: どの元も同じ集計で数え、1 枚の表（/api/dashboard）と同じ数になるか。
    仕掛には仕掛区分の列（本物の列の名前は確かめていない。dashboard.WIP_CLASS_COLUMN）"""

    def setUp(self):
        super().setUp()
        self.wip.unlink()
        c = sqlite3.connect(self.wip)
        c.execute("CREATE TABLE 仕掛 (ロット番号 TEXT, 残仕掛設備ｺｰｽ TEXT, 製造材質 TEXT, 仕掛区分 TEXT)")
        c.executemany("INSERT INTO 仕掛 VALUES (?, ?, ?, ?)", [("A1", "CR1 L-1", "A1100", "生産"), ("A2", "L-1", "A1100", "保留"),
                                                             ("A3", "L-1 CR1", "A5052", "生産"), ("A3", "L-1 CR1", "A5052", "生産")])
        c.commit()
        c.close()
        self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)

    def ask(self, **panel):
        r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "column", **panel}})
        return r.status_code, r.get_json()

    def ok(self, **panel):
        st, d = self.ask(**panel)
        for _ in range(20):            # 写しが無ければ写し終えるまで（共有は直接読まない）
            if st != 503 or d.get("kind") != "copying":
                break
            import time
            time.sleep(0.1)
            st, d = self.ask(**panel)
        self.assertEqual(st, 200, d)
        return d

    def test_wip_by_class_and_by_equipment(self):
        d = self.ok(source="src:wip", body={"rows": [{"column": dashboard.WIP_CLASS_COLUMN}], "measures": [{"agg": "lots"}]})
        self.assertEqual((cell(d, ["$生産"]), cell(d, ["$保留"]), cell(d)), ([2], [1], [3]), "仕掛区分ごとのロット数（同じロットの 2 行は 1）")
        self.assertEqual(d["sourceName"], "仕掛")
        e = self.ok(source="src:wip", body={"rows": [{"column": "@equip"}], "measures": [{"agg": "lots"}]})
        board = self.c.get("/api/dashboard", query_string={"part": "wip"}).get_json()["wip"]
        self.assertEqual({k: cell(e, [k])[0] for k in e["orders"][0]}, {x["equipment"]: x["lots"] for x in board["items"]},
                         "設備ごとの数は 1 枚の表（残仕掛設備ｺｰｽ の先頭の設備）と同じ")
        miss = self.ask(source="src:wip", body={"rows": [{"column": "無い区分"}]})
        self.assertEqual(miss[0], 400)
        self.assertIn("無い区分", miss[1]["error"], "列が無ければ、どの列かを言う")

    def test_work_all_equipment_yesterday_matches_the_board(self):
        d = self.ok(source="work", body={"rows": [{"column": "@equip"}], "cols": [{"column": "@shift"}], "measures": [{"agg": "lots"}]},
                    period={"column": "@workday", "kind": "yesterday"})
        board = {x["equipment"]: x for x in self.c.get("/api/dashboard", query_string={"part": "work"}).get_json()["work"]["items"]}
        self.assertEqual(cell(d, ["CR1"])[0], board["CR1"]["total"]["works"])
        self.assertEqual(cell(d, ["CR1"], ["1直"])[0], 1, "分割（作業開始が同じ 2 行）は 1 本")
        self.assertIsNone(cell(d, ["L-1"]), "前日に作業の無い設備は行が無い")
        self.assertEqual(d["period"]["ranges"], [{"from": "2026-10-15", "to": "2026-10-15"}])
        self.assertEqual([x["name"] for x in d["parts"]], ["CR1", "L-1"])
        kpi = self.ok(visual="kpi", source="work", body={"measures": [{"agg": "lots"}]}, period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual(cell(kpi)[0], sum(x["total"]["works"] for x in board.values()), "数字の形（行なし）＝総計")
        one = self.ok(visual="kpi", source="work", equip=board["L-1"]["key"], body={"measures": [{"agg": "count"}]})
        self.assertEqual(cell(one)[0], 1, "設備を 1 つに絞る")

    def test_fields_and_sources(self):
        f = self.c.get("/api/dashboard/fields", query_string={"source": "work"}).get_json()
        self.assertEqual([x["column"] for x in f["special"]], ["@equip", "@workday", "@shift"])
        self.assertTrue(next(x for x in f["fields"] if x["column"] == "BOX実績_作業開始_日付")["date"], "日付の列の印")
        w = self.c.get("/api/dashboard/fields", query_string={"source": "src:wip"}).get_json()
        self.assertEqual([x["column"] for x in w["special"]], ["@equip"])
        self.assertIn("仕掛区分", [x["column"] for x in w["fields"]])
        s = self.c.get("/api/dashboard/sources").get_json()
        self.assertEqual([x["key"] for x in s["items"]], ["lot", "work", "src:wip"])
        self.assertEqual([x["name"] for x in s["items"][1]["equips"]], ["CR1", "L-1"])

    def test_bad_panels(self):
        self.assertEqual(self.ask(source="nowhere", body={"rows": [{"column": "a"}]})[0], 400)
        self.assertEqual(self.ask(visual="board")[0], 400)
        self.assertEqual(self.ask(source="src:wip", body={})[0], 400, "グラフには行の段が要る")


class Layouts(unittest.TestCase):
    """ダッシュボードの組みの置き場（/api/dashboards。決まりは集計表の組み方と同じ: 共通デフォルト・共通・ID・標準）と、
    権限の門（集計対象の条件だけがマスタの権限。パネルの問い合わせ・自分の ID への保存は誰でも）"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "data", self.tmp / "app" / "data")
        (self.tmp / "app" / "data" / "access_permissions.json").write_text("[]", encoding="utf-8")
        (self.tmp / "share").mkdir()
        self.who = {"login": "taro", "pc": "PC-1"}
        self.p1 = mock.patch.object(identity, "current_login_id", lambda: self.who["login"])
        self.p2 = mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": self.who["pc"], "source": "test", "tried": []})
        self.p1.start()
        self.p2.start()
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"dir": str(self.tmp / "share"), "refresh_seconds": 0})
        self.store = store
        self.c = create_app({"TESTING": True, "MASTER_STORE": store}).test_client()
        repo = MasterRepository(store)
        for login, me, role in (("taro", "編集可", "一般ユーザー"), ("jiro", "閲覧のみ", "一般ユーザー"), ("dev", "編集可", "開発者")):
            repo.access_permissions_create({"ログインID": login, "PC名": "", "権限区分": role, "マスタ編集": me, "有効": "有"})
        self.as_("taro")
        self.body = dashboard.builtin_layouts()[0]["body"]

    def tearDown(self):
        self.p1.stop()
        self.p2.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def as_(self, login):
        self.who.update(login=login)
        import app.routes as r
        r._REVOKE_CACHE.update(at=0.0, key="")

    def test_builtin_standard_is_there_and_fits_the_grid(self):
        d = self.c.get("/api/dashboards").get_json()
        b = d["items"][-1]
        self.assertEqual((b["id"], b["builtin"], d["standardId"]), ("b:standard", True, "b:standard"), "置いた物が無ければ組み込みの標準")
        ps = b["body"]["panels"]
        self.assertIn(dashboard.WIP_CLASS_COLUMN, [r["column"] for p in ps for r in (p.get("body") or {}).get("rows", [])], "仕掛区分ごとのパネル")
        self.assertTrue(all(p["x"] + p["w"] <= 12 and p["y"] + p["h"] <= b["body"]["rows"] for p in ps), "グリッドからはみ出さない（スクロールしない）")
        self.assertFalse(any(dashboard.overlaps(a, c) for i, a in enumerate(ps) for c in ps[i + 1:]), "重ならない")

    def test_save_mine_and_common_with_the_same_rules_as_presets(self):
        r = self.c.post("/api/dashboards", json={"name": "わたしの", "scope": "me", "standard": True, "body": self.body})
        self.assertEqual(r.status_code, 201, r.get_json())
        mine = r.get_json()
        self.assertEqual((mine["scope"], mine["login"], len(mine["body"]["panels"])), ("me", "taro", len(self.body["panels"])))
        self.assertEqual(self.c.get("/api/dashboards").get_json()["standardId"], mine["id"], "自分の標準が先")
        self.assertTrue(self.store.is_shared("dashboards"), "ダッシュボードは全員で 1 つの置き場（ほかの PC でも同じ物）")
        self.as_("jiro")
        self.assertEqual([x["id"] for x in self.c.get("/api/dashboards").get_json()["items"]], ["b:standard"], "ほかの ID の物は見えない")
        self.assertEqual(self.c.post("/api/dashboards", json={"name": "共通の", "scope": "all", "body": self.body}).status_code, 403,
                         "閲覧のみの人は共通に置けない")
        r = self.c.post("/api/dashboards", json={"name": "じろう", "scope": "me", "body": self.body})
        self.assertEqual(r.status_code, 201, "閲覧のみの人も自分の ID には置ける（門番に止められない）")
        self.assertEqual(self.c.put("/api/dashboard/wip", json={"filters": []}).status_code, 403, "集計対象の条件（全員で 1 つ）はマスタの権限")
        self.as_("taro")
        self.assertEqual(self.c.put(f"/api/dashboards/{mine['id']}", json={"name": "わたしの2", "base_rev": mine["rev"]}).status_code, 200)
        self.assertEqual(self.c.put(f"/api/dashboards/{mine['id']}", json={"name": "x", "base_rev": mine["rev"]}).status_code, 409, "古い版では書かない")
        self.assertEqual(self.c.put(f"/api/dashboards/{r.get_json()['id']}", json={"name": "x"}).status_code, 403, "ほかの ID の物は直せない")
        self.assertEqual(self.c.delete(f"/api/dashboards/{mine['id']}").status_code, 200)

    def test_layouts_are_checked(self):
        bad = {"rows": 8, "panels": [{"id": "a", "x": 0, "y": 0, "w": 4, "h": 2, "visual": "kpi", "source": "work"},
                                     {"id": "b", "x": 3, "y": 1, "w": 4, "h": 2, "visual": "kpi", "source": "work"}]}
        r = self.c.post("/api/dashboards", json={"name": "重なる", "scope": "me", "body": bad})
        self.assertEqual(r.status_code, 400)
        self.assertIn("重なって", r.get_json()["error"])
        big = dashboard.clean_layout({"rows": 6, "panels": [{"id": "a", "x": 10, "y": 5, "w": 6, "h": 4, "visual": "kpi", "source": "work"}]})[0]
        p = big["panels"][0]
        self.assertEqual((p["x"], p["y"], p["w"], p["h"]), (6, 2, 6, 4), "大きすぎる・はみ出すパネルはグリッドに収める")
        self.assertEqual(p["body"]["measures"], [{"agg": "lots"}], "値が無ければロット数")
        with self.assertRaises(dashboard.LayoutError):
            dashboard.clean_layout({"panels": [{"visual": "kpi", "source": "x"}]})
        self.assertEqual(self.c.post("/api/dashboards", json={"name": "", "scope": "me", "body": self.body}).status_code, 400, "名前が要る")

if __name__ == "__main__":
    unittest.main()
