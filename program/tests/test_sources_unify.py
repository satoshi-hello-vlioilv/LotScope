# -*- coding: utf-8 -*-
"""データ元を 1 つの仕組みに（版 3.58.0。利用者の要望 2026-10-28）の評価関数。

  ① 接続の設定: どの元も同じ形の欄（場所・表・フォルダ・決まり・CM3・間隔・ロット番号の列）で、値は元ごとの置き場
     （品質・実績・スケジュールは参照先の項目、仕掛・足した元はデータ元の行）へ書かれ、読む所（写しの間隔・一覧）に効く
  ② 組み込みの元の名前（品質・実績）と、その名前を変える・戻す
  ③ グループの名前を変える・消す（役割「マスタ」の元も、消せば「マスタ」へ戻らない）
  ④ ロット番号の列: 自動・なし・この列（「ロット」という名前の別の列をロット番号にさせない）。一覧・まとめ・集計のロット数に効く
  ⑤ 見出しのタブの権限: 区分の決まり＋人ごとの例外。出さないタブの元は、一覧・集計の問い合わせも断る（開発者はいつも全部）
"""
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore
from app.services import identity, work_log
from app.services.db_mirror import DbMirror
from tests import lotlist_fixture

ROOT = Path(__file__).resolve().parents[1]


class Env(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.wip = self.tmp / "台帳" / "LOTNOW.sqlite3"
        self.wip.parent.mkdir(parents=True)
        lotlist_fixture.make_wip(str(self.wip), n=300)
        # 「ロット」という名前の列を持つが、ロット番号ではない台帳（利用者の困りごと）。本当のロット番号は「製品番号」（名前で探す決まりには当たらない）
        self.odd = self.tmp / "台帳" / "検査.sqlite3"
        c = sqlite3.connect(self.odd)
        c.execute("CREATE TABLE 検査 (ロット INTEGER, 製品番号 TEXT, 値 REAL)")
        c.executemany("INSERT INTO 検査 VALUES (?,?,?)", [(i % 3 + 1, f"L{i // 2:04d}", i * 1.5) for i in range(40)])
        c.commit()
        c.close()
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        self.who = {"login": "dev", "pc": "PC-1"}
        self.p1 = mock.patch.object(identity, "current_login_id", lambda: self.who["login"])
        self.p2 = mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": self.who["pc"], "source": "test", "tried": []})
        self.p1.start()
        self.p2.start()
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0})
        settings = {"lot_list": {"source": "", "refresh_seconds": 60, "stale_hours": 36},
                    "work_log": {"folder": str(self.tmp / "実績"), "pattern": "実績_*.sqlite3", "refresh_seconds": 60, "stale_hours": 36},
                    "sources": {"defaults": {"refresh_seconds": 60, "stale_hours": 36},
                                "wip": {"source": str(self.wip), "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}},
                    "schedule": {"cm3_base_url": "http://127.0.0.1:9", "auto_refresh_sec": 60}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings,
                               "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"),
                               "SRC_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "sources", prefix="src")})
        self.repo = MasterRepository(store)
        self.c = self.app.test_client()
        self.as_("dev")

    def tearDown(self):
        self.p1.stop()
        self.p2.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def as_(self, login):
        self.who.update(login=login)
        import app.routes as r
        from app.routes import common
        r._REVOKE_CACHE.update(at=0.0, key="")
        common.forget_tab_cache()

    def items(self):
        return {x["key"]: x for x in self.c.get("/api/sources").get_json()["items"]}

    def conn(self, key):
        return {f["id"]: f for f in self.items()[key]["conn"]}

    def put_conn(self, key, field, value):
        f = self.conn(key)[field]
        return self.c.put(f"/api/sources/{key}/conn", json={"field": field, "value": value, "base_rev": f["rev"]})

    def add(self, name, place, **kw):
        r = self.c.post("/api/sources", json={"表示名": name, "場所": str(place), **kw})
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()["row"]["キー"]


class Conn(Env):
    def test_every_source_has_the_same_shape_of_settings(self):
        ids = {k: [f["id"] for f in x["conn"]] for k, x in self.items().items()}
        self.assertEqual(ids["lot"], ["place", "table", "refresh", "stale", "lot"])
        self.assertEqual(ids["work"], ["folder", "pattern", "refresh", "stale", "lot"])
        self.assertEqual(ids["wip"], ["place", "table", "refresh", "stale", "lot"])
        self.assertEqual(ids["sch"], ["url", "client_ip", "equipments", "inspect", "refresh", "lot"])
        binds = {k: {f["id"]: f["bind"] for f in x["conn"]} for k, x in self.items().items()}
        self.assertEqual(set(binds["lot"].values()) | set(binds["work"].values()), {"settings", "row"})
        self.assertEqual(binds["lot"]["lot"], "row", "ロット番号の列はどの元もデータ元の行")
        self.assertEqual(set(binds["wip"].values()), {"row"})
        others = {i["key"] for i in self.c.get("/api/sources").get_json()["others"]}
        self.assertEqual(others, {"lotdsp_import.url", "update.source", "lotdsp_import.direct.browser"}, "そのほかの接続（データ元ではない所）")

    def test_row_bound_settings_reach_the_mirror(self):
        self.assertEqual(self.conn("wip")["refresh"]["effective"], 60, "既定は設定 sources の既定")
        self.assertEqual(self.put_conn("wip", "refresh", "120").status_code, 200)
        self.assertEqual(self.put_conn("wip", "stale", "72").status_code, 200)
        c = self.conn("wip")
        self.assertEqual((c["refresh"]["value"], c["stale"]["value"]), ("120", "72"))
        self.assertEqual(self.items()["wip"]["read"]["refresh_seconds"], 120)
        self.c.get("/api/src/wip", query_string={"page_size": 1})
        m = self.app.config["SRC_MIRRORS"].peek("wip")
        self.assertEqual((m.interval, m.stale_hours), (120, 72.0), "写しの係が新しい間隔で動く")
        bad = self.put_conn("wip", "refresh", "5")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("10〜3600", bad.get_json()["error"])
        self.assertEqual(self.put_conn("wip", "refresh", "").status_code, 200)
        self.assertEqual(self.conn("wip")["refresh"]["effective"], 60, "空にすると既定")

    def test_settings_bound_values_are_written_to_the_path_settings(self):
        self.assertEqual(self.put_conn("work", "refresh", "300").status_code, 200)
        self.assertEqual(self.put_conn("lot", "stale", "72").status_code, 200)
        eff = {i["key"]: i["effective"] for i in self.c.get("/api/settings").get_json()["items"]}
        self.assertEqual((eff["work_log.refresh_seconds"], eff["lot_list.stale_hours"]), (300, 72))
        self.assertEqual(self.items()["work"]["read"]["refresh_seconds"], 300, "実績の写しの間隔")
        self.assertEqual(self.put_conn("sch", "url", "ftp://x").status_code, 400, "参照先の項目の決まり（URL）で断る")
        self.assertEqual(self.put_conn("sch", "equipments", "L-1, L-9:2").status_code, 200)
        self.assertEqual(self.conn("sch")["equipments"]["value"], "L-1, L-9:2")

    def test_check_uses_the_rule_of_each_field(self):
        r = self.c.post("/api/sources/wip/conn/check", json={"field": "place", "value": ""}).get_json()
        self.assertTrue(r["ok"], r)
        self.assertIn("仕掛", r["message"], "空なら既定の場所で確かめる")
        r = self.c.post("/api/sources/wip/conn/check", json={"field": "place", "value": str(self.tmp / "無い.sqlite3")}).get_json()
        self.assertFalse(r["ok"])
        r = self.c.post("/api/sources/work/conn/check", json={"field": "pattern", "value": "実績_.sqlite3"}).get_json()
        self.assertFalse(r["ok"], "* が無い決まり")
        self.assertEqual(self.c.post("/api/sources/wip/conn/check", json={"field": "folder"}).status_code, 400, "仕掛にフォルダの欄は無い")


class Names(Env):
    def test_builtin_names_and_renaming(self):
        got = self.items()
        self.assertEqual((got["lot"]["name"], got["work"]["name"]), ("品質", "実績"))
        lot = got["lot"]
        r = self.c.post("/api/sources/lot/quick", json={"表示名": "品質異常", "base_rev": lot["rev"] or 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.items()["lot"]["name"], "品質異常")
        r = self.c.post("/api/sources/lot/quick", json={"表示名": "", "base_rev": self.items()["lot"]["rev"]})
        self.assertEqual(self.items()["lot"]["name"], "品質", "空にすると元の名前")


    def test_partial_put_keeps_the_other_columns(self):
        """欄の一部だけを送る PUT（品質・実績の名前と結合だけ）でも、送らなかった列（見出しのタブ・ロット番号の列・間隔）は消えない"""
        k = self.add("検査", self.odd, ロット番号の列="製品番号", 確かめる間隔="120", 画面="無")
        r = self.c.put(f"/api/sources/{k}", json={"表示名": "検査2", "base_rev": self.items()[k]["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        got = self.items()[k]
        self.assertEqual((got["name"], got["lotSet"], got["rowRead"]["確かめる間隔"], got["listed"]), ("検査2", "製品番号", "120", False))
        r = self.c.put("/api/sources/lot", json={"表示名": "品質異常", "base_rev": self.items()["lot"]["rev"] or 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        r = self.c.put("/api/sources/lot", json={"ロット番号の列": "-", "base_rev": self.items()["lot"]["rev"]})
        got = self.items()["lot"]
        self.assertEqual((got["name"], got["lotSet"]), ("品質異常", "-"), "名前を変えた後で別の列だけを直しても、名前は残る")

class Groups(Env):
    def test_rename_and_delete(self):
        a = self.add("A", self.wip, グループ="台帳")
        b = self.add("B", self.odd, グループ="台帳")
        m = self.add("製造条件", self.odd, 役割="マスタ")
        got = self.items()
        self.assertEqual((got[a]["group"], got[b]["group"], got[m]["group"]), ("台帳", "台帳", "マスタ"))
        self.assertEqual(self.c.post("/api/sources/groups", json={"from": "台帳", "to": "帳票"}).status_code, 200)
        got = self.items()
        self.assertEqual((got[a]["group"], got[b]["group"]), ("帳票", "帳票"))
        r = self.c.post("/api/sources/groups", json={"from": "帳票", "to": ""})
        self.assertEqual((r.status_code, r.get_json()["count"]), (200, 2))
        got = self.items()
        self.assertEqual((got[a]["group"], got[b]["group"]), ("", ""), "グループを消すと、元はグループなしへ（元は消えない）")
        self.assertEqual(self.c.post("/api/sources/groups", json={"from": "マスタ", "to": ""}).status_code, 200)
        self.assertEqual(self.items()[m]["group"], "", "役割「マスタ」の元も「マスタ」へ戻らない")
        self.assertEqual(self.c.post("/api/sources/groups", json={"from": "無い", "to": ""}).status_code, 400)
        self.assertEqual(self.c.post("/api/sources/groups", json={"from": "", "to": "x"}).status_code, 400)


class LotColumn(Env):
    def test_auto_none_and_chosen(self):
        k = self.add("検査", self.odd)
        def q(**a):
            return self.c.get(f"/api/src/{k}", query_string={"page_size": 100, **a}).get_json()
        self.assertEqual(q()["lotColumn"], "ロット", "自動は名前に「ロット」を含む列を選んでしまう（困りごと）")
        cols = self.c.get(f"/api/sources/{k}/columns").get_json()
        self.assertEqual((cols["autoLot"], cols["lotSet"]), ("ロット", ""))
        self.assertEqual(self.put_conn(k, "lot", "-").status_code, 200)
        d = q(group="1")
        self.assertEqual(d["lotColumn"], "", "なし: ロット番号の列は無い")
        self.assertNotIn("groups", d, "ロット番号でまとめない")
        self.assertEqual(self.put_conn(k, "lot", "製品番号").status_code, 200)
        d = q(group="1")
        self.assertEqual(d["lotColumn"], "製品番号")
        self.assertEqual(d["groupCount"], 20, "まとめは選んだ列（製品番号は 2 行ずつ 20 本）")
        p = self.c.get(f"/api/src/{k}/pivot", query_string={"measures": '[{"agg":"lots"}]'}).get_json()
        self.assertEqual((p["lotsBy"], p["cells"][0]["v"][0]), ("lot", 20), "集計のロット数も選んだ列で数える")
        self.assertEqual(self.put_conn(k, "lot", "無い列").status_code, 200)
        self.assertEqual(q()["lotColumn"], "", "表に無い列を選んだら無い（取り違えない）")
        self.assertEqual(self.put_conn(k, "lot", "").status_code, 200)
        self.assertEqual(q()["lotColumn"], "ロット", "空にすると自動へ戻る")

    def test_lot_override_hands_the_quality_list_to_python(self):
        self.assertEqual(self.c.get("/api/lotlist/settings").get_json()["engine"], "rust")
        self.assertEqual(self.put_conn("lot", "lot", "-").status_code, 200)
        self.assertEqual(self.c.get("/api/lotlist/settings").get_json()["engine"], "python", "Rust は名前で探す決まりしか知らない")


class Tabs(Env):
    def seed(self, login, role, me="編集可", tabs=""):
        self.repo.access_permissions_create({"ログインID": login, "PC名": "", "権限区分": role, "マスタ編集": me, "有効": "有", "タブの例外": tabs})

    def setUp(self):
        super().setUp()
        self.seed("dev", "開発者")
        self.seed("user", "一般ユーザー")
        self.seed("op", "設備作業者", me="非表示")
        self.seed("part", "一般ユーザー", me="部分的編集可")

    def rules(self, rules):
        rev = self.c.get("/api/masters/tabaccess").get_json()["revision"]
        return self.c.put("/api/masters/tabaccess", json={"rules": rules, "base_rev": rev})

    def hidden(self, login):
        self.as_(login)
        return self.c.get("/api/access/me").get_json()["hiddenTabs"]

    def test_role_rules_and_person_exceptions(self):
        d = self.c.get("/api/masters/tabaccess").get_json()
        self.assertEqual([t["key"] for t in d["tabs"]][:6], ["dash", "calc", "lot", "work", "wip", "sch"])
        self.assertEqual(d["roles"], ["メンテナンス者", "一般ユーザー", "設備作業者"], "開発者は決められない（いつも全部）")
        self.assertEqual(self.rules({"wip": ["一般ユーザー", "設備作業者"], "calc": ["設備作業者"]}).status_code, 200)
        self.assertEqual(self.hidden("user"), ["wip"])
        self.assertEqual(self.hidden("op"), ["calc", "wip"])
        self.assertEqual(self.hidden("dev"), [], "開発者はいつも全部")
        # 人ごとの例外: user には仕掛を出す・品質を出さない
        self.as_("dev")
        row = next(r for r in self.c.get("/api/masters/access").get_json()["items"] if r["ログインID"] == "user")
        body = {**{k: row[k] for k in ("ログインID", "PC名", "権限区分", "マスタ編集", "有効", "備考")},
                "タブの例外": {"wip": "出す", "lot": "出さない", "../x": "出さない", "work": "?"}, "base_rev": row["rev"]}
        self.assertEqual(self.c.put(f"/api/masters/access/{row['id']}", json=body).status_code, 200)
        saved = next(r for r in self.c.get("/api/masters/access").get_json()["items"] if r["ログインID"] == "user")
        self.assertEqual(json.loads(saved["タブの例外"]), {"lot": "出さない", "wip": "出す"}, "形の正しい例外だけ")
        self.assertEqual(self.hidden("user"), ["lot"])
        self.as_("dev")
        self.assertEqual(self.c.get("/api/masters/tabaccess").get_json()["exceptions"], {"lot": 1, "wip": 1}, "タブごとの例外の数")

    def test_hidden_sources_are_refused_by_the_server(self):
        self.rules({"wip": ["一般ユーザー"]})
        self.as_("user")
        for path in ("/api/src/wip", "/api/src/wip/pivot", "/api/src/wip/slicer"):
            r = self.c.get(path, query_string={"column": "製造材質", "measures": '[{"agg":"lots"}]'})
            self.assertEqual((r.status_code, r.get_json().get("kind")), (403, "forbidden"), path)
        self.as_("dev")
        self.assertEqual(self.c.get("/api/src/wip", query_string={"page_size": 1}).status_code, 200)
        self.rules({"lot": ["一般ユーザー"], "work": ["一般ユーザー"]})
        self.as_("user")
        self.assertEqual(self.c.get("/api/lotlist/settings").get_json()["engine"], "python", "Rust に答えさせない")
        self.assertEqual(self.c.get("/api/lotlist").status_code, 403)
        self.assertEqual(self.c.get("/api/worklog", query_string={"equip": "x"}).status_code, 403)

    def test_rules_are_written_only_by_admins_and_only_for_known_roles(self):
        self.as_("dev")
        self.assertEqual(self.rules({"wip": ["開発者"]}).status_code, 400)
        self.assertEqual(self.rules({"../x": ["一般ユーザー"]}).status_code, 400)
        self.as_("part")
        self.assertEqual(self.rules({"wip": ["一般ユーザー"]}).status_code, 403, "部分的編集可は管理のマスタを書けない")
        self.as_("dev")
        self.assertEqual(self.rules({"wip": ["一般ユーザー"]}).status_code, 200)
        self.assertEqual(self.rules({"wip": []}).status_code, 200)
        self.assertEqual(self.hidden("user"), [], "空にすると全員に出す")
        stale = self.c.put("/api/masters/tabaccess", json={"rules": {"wip": ["一般ユーザー"]}, "base_rev": -1})
        self.assertEqual(stale.status_code, 409, "開いたあとにほかの PC が変えた")


if __name__ == "__main__":
    unittest.main()
