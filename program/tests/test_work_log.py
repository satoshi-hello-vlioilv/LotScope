# -*- coding: utf-8 -*-
"""作業実績: フォルダを探して設備を見つけ、登録（表示する・しない）と結び、名前が変わってもたどり、設備ごとの写しを一覧と同じ形で引く。"""
import os
import shutil
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import work_log
from app.services.db_mirror import DbMirror

ROOT = Path(__file__).resolve().parents[1]


def make_db(path, lots, table="実績"):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    c.execute(f"CREATE TABLE [{table}] (ロット番号 TEXT, 作業日 TEXT, 重量 REAL)")
    c.executemany(f"INSERT INTO [{table}] VALUES (?, '2026/10/01', ?)", [(x, i * 1.5) for i, x in enumerate(lots)])
    c.commit()
    c.close()


class Names(unittest.TestCase):
    def test_equipment_from_the_file_name(self):
        p = "実績_*.sqlite3"
        self.assertEqual(work_log.equipment_of("実績_CR1.sqlite3", p), "CR1")
        self.assertEqual(work_log.equipment_of("実績_L-1.SQLITE3", p), "L-1", "大文字・小文字は区別しない（Windows と同じ）")
        self.assertEqual(work_log.equipment_of("実績_ 3号機 .sqlite3", p), "3号機")
        for bad in ("実績_.sqlite3", "実績CR1.sqlite3", "実績_CR1.sqlite3-journal", "仕掛_CR1.sqlite3", "実績_CR1.db"):
            self.assertIsNone(work_log.equipment_of(bad, p), bad)

    def test_pattern_needs_exactly_one_star(self):
        for bad in ("実績.sqlite3", "実績_*_*.sqlite3", ""):
            with self.assertRaises(ValueError):
                work_log.split_pattern(bad)
        self.assertEqual(work_log.split_pattern("Log-*.db"), ("Log-", ".db"))


class Match(unittest.TestCase):
    F = lambda self, name, fid: {"file": name, "equipment": name, "size": 1, "mtime": 0, "fid": fid}   # noqa: E731

    def test_by_name_then_by_file_id_and_never_by_guess(self):
        rows = [{"id": 1, "ファイル名": "実績_A.sqlite3", "ファイルID": "1:10"},
                {"id": 2, "ファイル名": "実績_B.sqlite3", "ファイルID": "1:20"},
                {"id": 3, "ファイル名": "実績_C.sqlite3", "ファイルID": "1:30"}]
        found = [self.F("実績_a.sqlite3", "9:99"), self.F("実績_B2.sqlite3", "1:20"), self.F("実績_D.sqlite3", "1:40")]
        m = work_log.match(rows, found)
        self.assertEqual([(r["id"], f["file"]) for r, f in m["linked"]], [(1, "実績_a.sqlite3")], "名前は大文字・小文字を区別しない")
        self.assertEqual([(r["id"], f["file"]) for r, f in m["renamed"]], [(2, "実績_B2.sqlite3")], "名前が変わってもファイルID でたどる")
        self.assertEqual([r["id"] for r in m["missing"]], [3], "ファイルID も合わない行は、推し量って別のファイルへ結ばない")
        self.assertEqual([f["file"] for f in m["new"]], ["実績_D.sqlite3"])

    def test_empty_file_id_never_matches(self):
        m = work_log.match([{"id": 1, "ファイル名": "x", "ファイルID": ""}], [self.F("実績_A.sqlite3", "")])
        self.assertEqual((len(m["missing"]), len(m["new"])), (1, 1))


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "【New】実績"
        make_db(self.folder / "実績_CR1.sqlite3", ["L0001", "L0002", "L0003"])
        make_db(self.folder / "実績_L-1.sqlite3", ["M0001"], table="作業実績")
        (self.folder / "メモ.txt").write_text("x", encoding="utf-8")
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"work_log": {"folder": str(self.folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600}, "lot_list": {"source": ""}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings,
                               "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"),
                               "WORK_LISTING": work_log.Listing(ttl=0)})
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def scan(self):
        r = self.c.post("/api/masters/worklog/scan", json={})
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()

    def items(self, **q):
        return {x["name"]: x for x in self.c.get("/api/worklog/files", query_string=q).get_json()["items"]}

    def test_scan_registers_each_equipment_once(self):
        d = self.scan()
        self.assertEqual(sorted(d["result"]["added"]), ["CR1", "L-1"])
        self.assertEqual(self.scan()["result"]["added"], [], "2 回目は足さない")
        it = self.items()
        self.assertEqual(sorted(it), ["CR1", "L-1"])
        self.assertTrue(all(x["visible"] and x["state"] == "ok" and len(x["key"]) == 12 for x in it.values()))

    def test_list_reads_the_mirror_with_the_same_shape_as_the_lot_list(self):
        self.scan()
        key = self.items()["CR1"]["key"]
        r = self.c.get("/api/worklog", query_string={"equip": key, "sorts": '[{"column":"重量","dir":"desc"}]'})
        d = r.get_json()
        self.assertEqual(r.status_code, 200, d)
        self.assertEqual((d["table"], d["count"], d["lotColumn"]), ("実績", 3, "ロット番号"))
        self.assertEqual([x["ロット番号"] for x in d["rows"]], ["L0003", "L0002", "L0001"])
        self.assertEqual(d["equip"]["name"], "CR1")
        self.assertIn("mirrored", d["source"])
        l1 = self.items()["L-1"]["key"]
        self.assertEqual(self.c.get("/api/worklog", query_string={"equip": l1}).get_json()["table"], "作業実績", "表の候補: 実績 → 作業実績")
        s = self.c.get("/api/worklog/slicer", query_string={"equip": key, "column": "ロット番号"}).get_json()
        self.assertEqual([v["value"] for v in s["values"]], ["L0001", "L0002", "L0003"])
        self.assertEqual(self.c.post("/api/worklog/refresh", query_string={"equip": key}).status_code, 200)

    def test_hidden_and_unknown_equipment_are_refused_with_a_reason(self):
        self.scan()
        it = self.items()["L-1"]
        r = self.c.put(f"/api/masters/worklog/{it['id']}", json={"表示": "無", "base_rev": it["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertNotIn("L-1", self.items(), "表示しない設備はタブで選べない")
        self.assertIn("L-1", self.items(all="1"))
        r = self.c.get("/api/worklog", query_string={"equip": it["key"]})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (403, "hidden"))
        self.assertEqual(self.c.get("/api/worklog", query_string={"equip": "nope"}).status_code, 404)

    def test_rename_keeps_the_key_and_follows_the_file(self):
        self.scan()
        before = self.items()["CR1"]
        os.rename(self.folder / "実績_CR1.sqlite3", self.folder / "実績_CR-1.sqlite3")
        it = self.items()["CR1"]
        self.assertEqual((it["state"], it["now"], it["key"]), ("renamed", "実績_CR-1.sqlite3", before["key"]), "読む前から名前の変化をたどる")
        r = self.c.get("/api/worklog", query_string={"equip": before["key"]})
        self.assertEqual((r.status_code, r.get_json()["count"]), (200, 3))
        d = self.scan()
        self.assertEqual(d["result"]["added"], [], "名前が変わっただけのファイルを新しい設備にしない")
        self.assertEqual([x["to"] for x in d["result"]["renamed"]], ["実績_CR-1.sqlite3"])
        it = self.items()["CR1"]
        self.assertEqual((it["state"], it["file"], it["key"]), ("ok", "実績_CR-1.sqlite3", before["key"]), "表示ルールを結ぶキーは同じ")

    def test_missing_file_is_relinked_by_hand(self):
        self.scan()
        it = self.items()["CR1"]
        make_db(self.folder / "実績_CR1新.sqlite3", ["N0001"])     # 先に作る（Linux は消したファイルの番号をすぐ使い回す）
        (self.folder / "実績_CR1.sqlite3").unlink()
        self.assertEqual(self.items()["CR1"]["state"], "missing", "別のファイルに置き換わったら、勝手には結ばない")
        r = self.c.get("/api/worklog", query_string={"equip": it["key"]})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (404, "missing"))
        r = self.c.put(f"/api/masters/worklog/{it['id']}", json={"ファイル名": "実績_CR1新.sqlite3", "base_rev": self.items()["CR1"]["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.items()["CR1"]["state"], "ok")
        for _ in range(40):
            d = self.c.get("/api/worklog", query_string={"equip": it["key"]}).get_json()
            if d.get("rows") and d["rows"][0]["ロット番号"] == "N0001":
                break
            time.sleep(0.1)
        self.assertEqual([x["ロット番号"] for x in d["rows"]], ["N0001"])
        self.assertEqual(self.c.post("/api/masters/worklog/scan", json={}).get_json()["result"]["added"], [], "結んだファイルは新しい設備にしない")

    def test_unreachable_folder_says_why(self):
        self.app.config["APP_SETTINGS"]["work_log"]["folder"] = str(self.tmp / "無い")
        r = self.c.post("/api/masters/worklog/scan", json={})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (503, "unreachable"))
        self.assertIn("届きません", self.c.get("/api/worklog/files").get_json()["error"])

    def test_folder_setting_check_counts_the_equipment(self):
        r = self.c.post("/api/settings/check", json={"key": "work_log.folder", "value": f'"{self.folder}"'}).get_json()
        self.assertTrue(r["ok"], r)
        self.assertIn("設備 2 台", r["message"])
        r = self.c.post("/api/settings/check", json={"key": "work_log.pattern", "value": "実績.sqlite3"}).get_json()
        self.assertFalse(r["ok"])

    def test_folder_settings_are_edited_only_on_the_work_log_page(self):
        # 「参照先」は page の無い項目だけを並べる（同じ値を直す所を 1 つに）。作業実績の 2 項目は「作業実績」の頁で直す
        items = {i["key"]: i for i in self.c.get("/api/settings").get_json()["items"]}
        self.assertEqual({k for k, i in items.items() if i.get("page")}, {"work_log.folder", "work_log.pattern"})
        self.assertEqual({i["page"] for i in items.values() if i.get("page")}, {"worklog"})


if __name__ == "__main__":
    unittest.main()
