# -*- coding: utf-8 -*-
"""データ元（services/data_sources.py・routes/sources.py）: 品質データ・作業実績・仕掛・足した元を 1 つの並びで扱い、
1 ファイルの元（仕掛・足した元）を品質異常と同じ形で引く。設備の見分け（そのまま・前方一致）。"""
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import data_sources as ds
from app.services import work_log
from app.services.db_mirror import DbMirror
from tests import lotlist_fixture

ROOT = Path(__file__).resolve().parents[1]


class Matcher(unittest.TestCase):
    def test_prefix_takes_the_longest_known_name(self):
        m = ds.EquipmentMatcher(["CR", "CR2", "CR1", "L-1", "C R 2"], "前方一致")
        self.assertEqual(m("CR2 L-1 LS3"), "CR2", "CR と CR2 なら長い CR2")
        self.assertEqual(m("CR L-1"), "CR")
        self.assertEqual(m("ＣＲ１ L-1"), "CR1", "全角も同じ名前（NFKC・大文字）")
        self.assertEqual(m("cr1"), "CR1")
        self.assertEqual(m("C R 2 L-1"), "C R 2", "空白を含む設備名も名前どおりに当てる")
        self.assertEqual(m("XYZ L-1"), "XYZ", "知らない設備は最初の空白まで（数から落とさない）")
        self.assertEqual(m(""), "")
        self.assertEqual(m(None), "")

    def test_exact_uses_the_known_spelling(self):
        m = ds.EquipmentMatcher(["CR1", "L-1"], "そのまま")
        self.assertEqual(m("ＣＲ１"), "CR1")
        self.assertEqual(m("L-1 "), "L-1")
        self.assertEqual(m("ANF"), "ANF")


class Sources(unittest.TestCase):
    SETTINGS = {"lot_list": {"source": "\\\\s\\q.sqlite3", "table": "仕掛"}, "work_log": {"folder": "\\\\s\\実績", "pattern": "実績_*.sqlite3"},
                "sources": {"wip": {"source": "\\\\s\\LOTNOW.sqlite3", "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}}}

    def test_builtins_come_from_the_path_settings_and_the_defaults(self):
        got = {s["key"]: s for s in ds.sources(self.SETTINGS, [])}
        self.assertEqual(list(got), ["lot", "work", "wip"])
        self.assertEqual((got["lot"]["place"], got["lot"]["table"], got["lot"]["storage"]), ("\\\\s\\q.sqlite3", "仕掛", "settings"))
        self.assertEqual((got["work"]["place"], got["work"]["pattern"], got["work"]["kind"]), ("\\\\s\\実績", "実績_*.sqlite3", "folder"))
        self.assertEqual((got["wip"]["place"], got["wip"]["equipColumn"], got["wip"]["equipMode"], got["wip"]["role"]),
                         ("\\\\s\\LOTNOW.sqlite3", "残仕掛設備ｺｰｽ", "前方一致", "仕掛"))
        self.assertEqual(got["wip"]["api"], "/api/src/wip")

    def test_master_rows_override_and_added_sources_follow_in_order(self):
        rows = [{"id": 1, "キー": "wip", "表示名": "仕掛（台帳）", "場所": "\\\\t\\X.sqlite3", "表": "", "設備の列": "BOX設計_設備名",
                 "設備の取り出し方": "そのまま", "画面": "無"},
                {"id": 2, "キー": "sb", "表示名": "B", "場所": "\\\\t\\b.sqlite3", "並び": "2"},
                {"id": 3, "キー": "sa", "表示名": "A", "場所": "\\\\t\\a.sqlite3", "並び": "1", "役割": "その他"}]
        got = ds.sources(self.SETTINGS, rows)
        self.assertEqual([s["key"] for s in got], ["lot", "work", "wip", "sa", "sb"], "足した元は並びの順")
        wip = got[2]
        self.assertEqual((wip["name"], wip["place"], wip["equipColumn"], wip["equipMode"], wip["listed"]),
                         ("仕掛（台帳）", "\\\\t\\X.sqlite3", "BOX設計_設備名", "そのまま", False))
        self.assertEqual((got[3]["api"], got[3]["screen"], got[3]["builtin"]), ("/api/src/sa", "src:sa", False))

    def test_clean_row_and_screen_source_names(self):
        with self.assertRaises(ValueError):
            ds.clean_row({"表示名": "", "場所": "x"}, key="s1")
        with self.assertRaises(ValueError):
            ds.clean_row({"表示名": "A", "場所": ""}, key="s1")
        with self.assertRaises(ValueError):
            ds.clean_row({"表示名": "A", "場所": "x", "役割": "なにか"}, key="s1")
        row = ds.clean_row({"表示名": " A ", "場所": '"\\\\t\\a.sqlite3"', "画面": "x"}, key="s1")
        self.assertEqual((row["表示名"], row["場所"], row["画面"]), ("A", "\\\\t\\a.sqlite3", "有"))
        self.assertEqual(ds.clean_row({}, key="wip")["キー"], "wip", "決まった元は空でもよい（既定に戻る）")
        for ok in ("lot", "work", "src:wip", "src:s1a2b3c4"):
            self.assertTrue(ds.is_screen_source(ok), ok)
        for ng in ("", "src:", "src:A B", "lotx", "src:../x"):
            self.assertFalse(ds.is_screen_source(ng), ng)


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.wip = self.tmp / "台帳" / "LOTNOW.sqlite3"
        self.wip.parent.mkdir(parents=True)
        lotlist_fixture.make_wip(str(self.wip), n=300)
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(self.tmp / "実績")},
                    "sources": {"wip": {"source": str(self.wip), "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings,
                               "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"),
                               "SRC_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "sources", prefix="src")})
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def items(self):
        return {x["key"]: x for x in self.c.get("/api/sources").get_json()["items"]}

    def test_wip_list_has_the_same_shape_as_the_lot_list(self):
        r = self.c.get("/api/src/wip", query_string={"sorts": '[{"column":"ロット番号","dir":"desc"}]', "page_size": 5})
        d = r.get_json()
        self.assertEqual(r.status_code, 200, d)
        self.assertEqual((d["table"], d["count"], d["lotColumn"]), ("仕掛", 300, "ロット番号"))
        self.assertEqual(d["rows"][0]["ロット番号"], "W00300")
        self.assertIn("mirrored", d["source"])
        s = self.c.get("/api/src/wip/slicer", query_string={"column": "製造材質"}).get_json()
        self.assertEqual(sum(v["count"] for v in s["values"]), 300)
        p = self.c.get("/api/src/wip/pivot", query_string={"rows": '[{"column":"製造材質"}]', "measures": '[{"agg":"lots"}]'})
        self.assertEqual(p.status_code, 200, p.get_json())
        self.assertEqual(self.c.get("/api/src/wip/source").status_code, 200)
        self.assertEqual(self.c.post("/api/src/wip/refresh").status_code, 200)

    def test_data_columns_lists_the_real_columns_per_source(self):
        """変換表の当てる列（版 3.44.0）: データ元ごとの実際の列と値の見本。読めないデータ元は列が空で理由を返す"""
        self.c.get("/api/src/wip", query_string={"page_size": 1})          # 写しを作る
        d = {x["key"]: x for x in self.c.get("/api/data/columns").get_json()["sources"]}
        self.assertEqual(set(d), {"lot", "work", "src:wip"})
        wip = {c["column"]: c["samples"] for c in d["src:wip"]["columns"]}
        self.assertIn("製造材質", wip)
        self.assertTrue(1 <= len(wip["製造材質"]) <= 3 and all(v.strip() for v in wip["製造材質"]), wip["製造材質"])
        self.assertEqual(d["src:wip"]["error"], "")
        self.assertEqual(d["lot"]["columns"], [])
        self.assertTrue(d["lot"]["error"], "品質データの場所が無ければ理由")

    def test_unknown_and_unset_sources(self):
        self.assertEqual(self.c.get("/api/src/zz").status_code, 404)
        self.assertEqual(self.c.get("/api/src/lot").status_code, 404, "品質データは /api/lotlist が答える")
        self.assertEqual(self.c.get("/api/src/zz/source").status_code, 404)

    def test_add_change_and_remove_a_source(self):
        extra = self.tmp / "台帳" / "extra.sqlite3"
        c = sqlite3.connect(extra)
        c.execute("CREATE TABLE 保留 (ロット番号 TEXT, 設備 TEXT)")
        c.executemany("INSERT INTO 保留 VALUES (?, ?)", [("H1", "CR1"), ("H2", "L-1")])
        c.commit()
        c.close()
        r = self.c.post("/api/sources", json={"表示名": "保留ロット", "場所": str(extra), "役割": "その他", "設備の列": "設備"})
        self.assertEqual(r.status_code, 201, r.get_json())
        key = r.get_json()["row"]["キー"]
        self.assertRegex(key, r"^s[0-9a-f]{8}$")
        it = self.items()[key]
        self.assertEqual((it["name"], it["api"], it["listed"]), ("保留ロット", f"/api/src/{key}", True))
        d = self.c.get(f"/api/src/{key}").get_json()
        self.assertEqual((d["table"], d["count"]), ("保留", 2))
        rev = self.items()[key]["rev"]
        r = self.c.put(f"/api/sources/{key}", json={"表示名": "保留", "場所": str(extra), "画面": "無", "base_rev": rev})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual((self.items()[key]["name"], self.items()[key]["listed"]), ("保留", False))
        self.assertEqual(self.c.put(f"/api/sources/{key}", json={"表示名": "x", "場所": str(extra), "base_rev": rev}).status_code, 409,
                         "ほかの PC が先に直した版では書かない")
        self.assertEqual(self.c.post("/api/sources", json={"表示名": "", "場所": "x"}).status_code, 400)
        self.assertEqual(self.c.delete(f"/api/sources/{key}").status_code, 200)
        self.assertNotIn(key, self.items())

    def test_wip_can_be_moved_and_reset(self):
        moved = self.tmp / "台帳" / "LOTNOW2.sqlite3"
        lotlist_fixture.make_wip(str(moved), n=10)
        r = self.c.put("/api/sources/wip", json={"場所": str(moved), "設備の列": "BOX設計_設備名", "base_rev": 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.items()["wip"]["equipColumn"], "BOX設計_設備名")
        self.assertEqual(self.c.get("/api/src/wip").get_json()["count"], 10, "場所を変えたら、起動し直さずに新しい場所を読む")
        self.assertEqual(self.c.delete("/api/sources/wip").status_code, 200)
        self.assertEqual((self.items()["wip"]["place"], self.items()["wip"]["equipColumn"]), (str(self.wip), "残仕掛設備ｺｰｽ"), "消すと既定に戻る")

    def test_check_tells_about_the_table_and_the_equipment_column(self):
        ok = self.c.post("/api/sources/check", json={"place": str(self.wip), "equipColumn": "残仕掛設備ｺｰｽ"}).get_json()
        self.assertTrue(ok["ok"], ok)
        self.assertIn("値の例", ok["message"])
        ng = self.c.post("/api/sources/check", json={"place": str(self.wip), "equipColumn": "無い列"}).get_json()
        self.assertFalse(ng["ok"])
        self.assertIn("無い列", ng["message"])
        self.assertFalse(self.c.post("/api/sources/check", json={"place": str(self.tmp / "無い.sqlite3")}).get_json()["ok"])


if __name__ == "__main__":
    unittest.main()
