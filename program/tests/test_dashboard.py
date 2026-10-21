# -*- coding: utf-8 -*-
"""ダッシュボード（services/dashboard.py・routes/dashboard.py）: パネルの数（どの元も pivot.query_many）と、合わせた表（版 3.38.0。
標準の組みは版 3.36.0 の 1 枚の表と同じ: 設備別の仕掛ロット数〈残仕掛設備ｺｰｽ の先頭で見分ける〉と、前日〈現場歴〉の直ごとの実績本数
〈作業開始が同じ行は 1 本〉。前の版の集計対象の条件を引き継ぐ）と、ダッシュボードの組みの置き場。"""
import json
import shutil
import sqlite3
import tempfile
import time
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

    def board(self, **panel):
        self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)
        for _ in range(30):            # 写しが無ければ写し終えるまで（共有は直接読まない）
            r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "board", **panel}})
            d = r.get_json()
            if r.status_code != 200 or not any(g.get("kind") == "copying" for g in d["groups"]):
                break
            time.sleep(0.1)
        self.assertEqual(r.status_code, 200, d)
        return d

    def test_board_counts_wip_and_yesterday_like_the_old_table(self):
        """合わせた表（版 3.38.0）の標準の組み＝版 3.36.0 の 1 枚の表: 設備ごとの仕掛ロット数（残仕掛設備ｺｰｽ の先頭の設備）と、
        前日（現場歴）の直ごとの実績本数（作業開始が同じ行は 1 本）。素朴に数え直した数と合う"""
        d = self.board()
        wip, work = d["groups"]
        self.assertEqual({k: cell(wip, [k])[0] for k in wip["orders"][0]}, {"CR1": 1, "L-1": 2}, "仕掛: 先頭の設備で数える")
        self.assertEqual(cell(wip)[0], 3)
        self.assertEqual([(work["labels"][1][k], cell(work, ["CR1"], [k])[0]) for k in work["orders"][1]], [("1直", 1), ("2直", 1)],
                         "前日 10/15 の CR1: 1 直は分割の 2 行で 1 本・2 直 1 本")
        self.assertIsNone(cell(work, ["L-1"]), "前日に作業の無い設備は行が無い（表では 0）")
        self.assertEqual(work["period"]["ranges"], [{"from": "2026-10-15", "to": "2026-10-15"}])
        self.assertEqual(d["equipOrder"][:2], ["CR1", "L-1"], "設備の並び（作業実績の設備の並び）も返す")

    def test_board_groups_are_generic(self):
        """列のまとまりは、ほかのパネルと同じ組み方（データ・値・列の段・条件）。4 つまで"""
        g = {"source": "src:wip", "measure": {"agg": "lots"}, "filters": [{"column": "製造材質", "op": "eq", "value": "A5052"}]}
        d = self.board(groups=[g, {**g, "filters": [], "cols": [{"column": "製造材質"}], "look": "heat"}])
        self.assertEqual(cell(d["groups"][0])[0], 1, "まとまりごとの条件（A5052 のロット）")
        self.assertEqual(cell(d["groups"][1], ["L-1"], ["$A1100"])[0], 1, "列の段（製造材質）")
        r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "board", "groups": [g] * 5}})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "board", "groups": [{**g, "source": "nowhere"}]}})
        self.assertEqual(r.status_code, 400)
        bad = self.board(groups=[g, {**g, "cols": [{"column": "無い列"}]}])
        self.assertTrue(bad["groups"][0]["cells"] and "無い列" in bad["groups"][1]["error"], "数えられないまとまりは、そのまとまりだけ理由")

    def test_old_conditions_move_into_the_board(self):
        """版 3.36.0 の集計対象の条件（全員で 1 つ）は、前の版で保存した 1 枚の表の列のまとまりの条件へ引き継ぐ"""
        def put(rows, stamp):
            rows.append({"id": 1, "キー": "wip", "条件": json.dumps({"filters": [{"column": "製造材質", "op": "eq", "value": "A5052"}]}), "rev": 1, **stamp})
        self.app.config["MASTER_STORE"].write("dashboard_settings", put)
        old = {"id": "board", "x": 0, "y": 0, "w": 12, "h": 8, "visual": "board"}       # 前の版で保存した形（列のまとまりが無い）
        r = self.c.post("/api/dashboards", json={"name": "前の版", "scope": "me", "body": {"rows": 8, "panels": [old]}})
        self.assertEqual(r.status_code, 201, r.get_json())
        items = self.c.get("/api/dashboards").get_json()["items"]
        mine = next(x for x in items if x["name"] == "前の版")["body"]["panels"][0]
        self.assertEqual(mine["groups"][0]["filters"][0]["value"], "A5052", "仕掛の条件が仕掛のまとまりへ")
        self.assertEqual(mine["groups"][1]["filters"], [], "実績の条件は無いまま")
        std = next(x for x in items if x.get("builtin"))["body"]["panels"]
        self.assertEqual(next(x for x in std if x["visual"] == "board")["groups"][0]["filters"], [], "組み込みの標準は条件なし（引き継がない）")


    def test_counts_with_the_real_clock(self):
        """本物の時計（DASHBOARD_NOW を入れない＝利用者の PC と同じ）でも数える。版 3.38.0 は時刻の関数を消し忘れ、どのパネルも 500 だった"""
        self.app.config.pop("DASHBOARD_NOW", None)
        kpi = {"visual": "kpi", "source": "src:wip", "body": {"rows": [], "measures": [{"agg": "lots"}]}}
        for _ in range(30):
            r = self.c.post("/api/dashboard/query", json={"panel": kpi})
            if r.get_json().get("kind") != "copying":
                break
            time.sleep(0.1)
        self.assertEqual((r.status_code, cell(r.get_json())), (200, [3]), r.get_json())
        r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "board", "id": "board", "w": 12, "h": 8}})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True)[:300])
        self.assertEqual(len(r.get_json()["groups"]), 2)

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
        self.assertEqual({k: cell(e, [k])[0] for k in e["orders"][0]}, {"L-1": 2, "CR1": 1}, "設備ごとの数（残仕掛設備ｺｰｽ の先頭の設備）")
        miss = self.ask(source="src:wip", body={"rows": [{"column": "無い区分"}]})
        self.assertEqual(miss[0], 400)
        self.assertIn("無い区分", miss[1]["error"], "列が無ければ、どの列かを言う")

    def test_work_all_equipment_yesterday(self):
        d = self.ok(source="work", body={"rows": [{"column": "@equip"}], "cols": [{"column": "@shift"}], "measures": [{"agg": "lots"}]},
                    period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual(cell(d, ["CR1"])[0], 2, "前日 10/15 の CR1 は 2 本")
        self.assertEqual(cell(d, ["CR1"], ["1直"])[0], 1, "分割（作業開始が同じ 2 行）は 1 本")
        self.assertIsNone(cell(d, ["L-1"]), "前日に作業の無い設備は行が無い")
        self.assertEqual(d["period"]["ranges"], [{"from": "2026-10-15", "to": "2026-10-15"}])
        self.assertEqual([x["name"] for x in d["parts"]], ["CR1", "L-1"])
        kpi = self.ok(visual="kpi", source="work", body={"measures": [{"agg": "lots"}]}, period={"column": "@workday", "kind": "yesterday"})
        self.assertEqual(cell(kpi)[0], 2, "数字の形（行なし）＝総計")
        keys = {x["name"]: x["key"] for x in self.c.get("/api/dashboard/sources").get_json()["items"][1]["equips"]}
        one = self.ok(visual="kpi", source="work", equip=keys["L-1"], body={"measures": [{"agg": "count"}]})
        self.assertEqual(cell(one)[0], 1, "設備を 1 つに絞る")

    def test_fields_and_sources(self):
        f = self.c.get("/api/dashboard/fields", query_string={"source": "work"}).get_json()
        self.assertEqual([x["column"] for x in f["special"]], ["@equip", "@egroup", "@workday", "@shift"], "版 3.40.0 から設備グループの段も")
        self.assertTrue(next(x for x in f["fields"] if x["column"] == "BOX実績_作業開始_日付")["date"], "日付の列の印")
        w = self.c.get("/api/dashboard/fields", query_string={"source": "src:wip"}).get_json()
        self.assertEqual([x["column"] for x in w["special"]], ["@equip", "@egroup"])
        self.assertIn("仕掛区分", [x["column"] for x in w["fields"]])
        s = self.c.get("/api/dashboard/sources").get_json()
        self.assertEqual([x["key"] for x in s["items"]], ["lot", "work", "src:wip"])
        self.assertEqual([x["name"] for x in s["items"][1]["equips"]], ["CR1", "L-1"])

    def test_bad_panels(self):
        self.assertEqual(self.ask(source="nowhere", body={"rows": [{"column": "a"}]})[0], 400)
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

    def test_sets_have_developer_standards_and_personal_patterns(self):
        """セット（版 3.46.0。要望 7）: 開発者は標準のセット（共通デフォルト）をいくつでも作れ、★ はその範囲で 1 つ。
        個人は自分のセット（切り替えのパターン）を置け、★ を付ければ自分の分が先。ダッシュボードの一覧には出ない"""
        mine = self.c.post("/api/dashboards", json={"name": "わたしの", "scope": "me", "body": self.body}).get_json()
        self.as_("dev")
        a = self.c.post("/api/dashboard-sets", json={"name": "現場の朝", "scope": "default", "standard": True, "body": {"items": ["b:standard", "b:standard", "x"]}})
        self.assertEqual(a.status_code, 201, a.get_json())
        self.assertEqual(a.get_json()["body"]["items"], ["b:standard"], "同じ物・形の違う物は外す")
        b = self.c.post("/api/dashboard-sets", json={"name": "品質の会議", "scope": "default", "standard": True, "body": {"items": ["b:standard"]}}).get_json()
        d = self.c.get("/api/dashboard-sets").get_json()
        self.assertEqual(([x["name"] for x in d["items"]], d["standardId"]), (["品質の会議", "現場の朝"], b["id"]), "標準のセットは何個でも・★ は 1 つ")
        self.assertNotIn("dashset", {x["source"] for x in self.c.get("/api/dashboards").get_json()["items"]}, "ダッシュボードの一覧にセットは出ない")
        self.as_("taro")
        self.assertEqual(self.c.post("/api/dashboard-sets", json={"name": "x", "scope": "default", "body": {"items": ["b:standard"]}}).status_code, 403,
                         "標準のセットを置けるのは開発者だけ")
        self.assertEqual(self.c.get("/api/dashboard-sets").get_json()["standardId"], b["id"], "自分の ★ が無ければ標準のセット")
        m = self.c.post("/api/dashboard-sets", json={"name": "わたしの切り替え", "scope": "me", "standard": True, "body": {"items": [str(mine["id"]), "b:standard"]}}).get_json()
        d = self.c.get("/api/dashboard-sets").get_json()
        self.assertEqual((d["standardId"], d["items"][0]["name"]), (m["id"], "わたしの切り替え"), "自分の ★ が先・自分のセットが先頭")
        r = self.c.put(f"/api/dashboard-sets/{m['id']}", json={"body": {"items": ["b:standard", str(mine["id"])]}, "base_rev": m["rev"]})
        self.assertEqual(r.get_json()["body"]["items"], ["b:standard", str(mine["id"])], "並べ替え")
        self.assertEqual(self.c.put(f"/api/dashboard-sets/{m['id']}", json={"body": {"items": []}}).status_code, 400, "空のセットは置けない")
        self.assertEqual(self.c.put(f"/api/dashboard-sets/{b['id']}", json={"name": "y"}).status_code, 403, "標準のセットは個人は直せない")
        self.assertEqual(self.c.put(f"/api/dashboards/{m['id']}", json={"name": "z"}).status_code, 400, "セットはダッシュボードの道では直せない")
        self.assertEqual(self.c.delete(f"/api/dashboard-sets/{m['id']}").status_code, 200)
        self.as_("jiro")
        self.assertEqual([x["name"] for x in self.c.get("/api/dashboard-sets").get_json()["items"]], ["品質の会議", "現場の朝"], "ほかの人の自分のセットは見えない")

if __name__ == "__main__":
    unittest.main()
