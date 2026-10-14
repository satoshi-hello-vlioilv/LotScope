# -*- coding: utf-8 -*-
"""フォルダ・ファイルの欄の補助（services/folder_browse.py・/api/fs/browse・/api/fs/places）。読むだけで何も書かない。"""
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import folder_browse as fb
from app.services.db_mirror import DbMirror

ROOT = Path(__file__).resolve().parents[1]


class Clean(unittest.TestCase):
    def test_pasted_text_becomes_a_path(self):
        self.assertEqual(fb.clean('  "C:\\データ\\検査\\"  '), "C:\\データ\\検査")
        self.assertEqual(fb.clean("file:///C:/a%20b/c"), "C:\\a b\\c")
        self.assertEqual(fb.clean("file://srv/share/d"), "\\\\srv\\share\\d")
        self.assertEqual(fb.clean("C:\\"), "C:\\", "ドライブの根は区切りを残す")
        self.assertEqual(fb.clean(""), "")

    def test_crumbs_start_at_the_share(self):
        c = fb.crumbs("\\\\srv\\share\\a\\b")
        self.assertEqual([x["name"] for x in c], ["\\\\srv\\share", "a", "b"], "サーバーの中は一覧できないので、共有を 1 つ目に")
        self.assertEqual(c[-1]["path"], "\\\\srv\\share\\a\\b")
        self.assertEqual(fb.parent_of("\\\\srv\\share\\台帳\\SIKADEF.sqlite3"), "\\\\srv\\share\\台帳")


class Browse(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        t = self.tmp
        (t / "Masters").mkdir()
        (t / "Masters" / "equipment_master.json").write_text("{}", encoding="utf-8")
        (t / "台帳").mkdir()
        (t / "台帳" / "SIKADEF.sqlite3").write_bytes(b"x")
        (t / "台帳" / "メモ.txt").write_text("x", encoding="utf-8")
        (t / "配布" / "LotScope" / "3.28.0").mkdir(parents=True)
        (t / "配布" / "LotScope" / "3.28.0" / "release.json").write_text("{}", encoding="utf-8")
        (t / "実績").mkdir()
        for n in ("実績_CR1.sqlite3", "実績_L-1.sqlite3", "ほか.sqlite3"):
            (t / "実績" / n).write_bytes(b"x")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def names(self, d):
        return [(e["name"], (e.get("mark") or {}).get("text", "")) for e in d["entries"]]

    def test_folder_purpose_lists_folders_with_marks_for_that_purpose(self):
        d = fb.browse(str(self.tmp), "master")
        self.assertTrue(d["exists"])
        self.assertEqual(self.names(d), [("Masters", "マスタあり"), ("台帳", ""), ("実績", ""), ("配布", "")])
        d = fb.browse(str(self.tmp / "配布"), "release")
        self.assertEqual(self.names(d), [("LotScope", "版の置き場")], "版のフォルダが並ぶ所に印（版のフォルダそのものには付けない）")
        d = fb.browse(str(self.tmp / "配布" / "LotScope"), "release")
        self.assertEqual(self.names(d), [("3.28.0", "")])
        self.assertEqual(d["mark"]["text"], "版の置き場", "いまのフォルダの印")

    def test_worklog_counts_files_that_match_the_pattern(self):
        d = fb.browse(str(self.tmp / "実績"), "worklog", "実績_*.sqlite3")
        self.assertEqual(d["mark"], {"text": "実績のファイル 2 個", "tone": "ok"})
        self.assertEqual(d["entries"], [], "フォルダを選ぶ欄にファイルは出さない")
        self.assertEqual(d["others"], 3)

    def test_file_purpose_shows_only_files_it_can_pick(self):
        d = fb.browse(str(self.tmp / "台帳"), "sqlite")
        self.assertEqual([(e["name"], e["dir"]) for e in d["entries"]], [("SIKADEF.sqlite3", False)])
        self.assertEqual(d["others"], 1)
        d = fb.browse(str(self.tmp / "台帳" / "SIKADEF.sqlite3"), "sqlite")
        self.assertEqual((d["path"], d["file"], d["exists"]), (str(self.tmp / "台帳"), "SIKADEF.sqlite3", True), "ファイルなら、そのフォルダでそのファイルを選んだ形")

    def test_missing_path_climbs_to_what_it_could_reach(self):
        d = fb.browse(str(self.tmp / "台帳" / "無い" / "もっと無い"), "folder")
        self.assertFalse(d["exists"])
        self.assertEqual(d["path"], str(self.tmp / "台帳"))
        self.assertIn("見つかりません", d["problem"])
        self.assertIn("届いた所", d["problem"])

    def test_relative_text_is_refused(self):
        d = fb.browse("台帳\\Masters", "folder")
        self.assertIn("ドライブ", d["problem"])
        self.assertEqual(d["entries"], [])

    def test_a_slow_share_does_not_keep_the_screen_waiting(self):
        real = fb._list

        def slow(*a, **k):
            time.sleep(1.0)
            return real(*a, **k)
        with mock.patch.object(fb, "_list", slow):
            t0 = time.monotonic()
            d = fb.browse(str(self.tmp), "folder", timeout=0.2)
        self.assertLess(time.monotonic() - t0, 0.8)
        self.assertIn("読めませんでした", d["problem"])

    def test_places_split_dedupe_and_keep_unreachable_app_places(self):
        rows = fb.places([("quality", "品質データのフォルダ", str(self.tmp / "台帳")),
                          ("release", "配布の置き場", f"{self.tmp / '配布'};{self.tmp / '無い'}"),
                          ("worklog", "作業実績のフォルダ", str(self.tmp / "台帳") + os.sep)])
        app = [r for r in rows if r["group"] == "app"]
        self.assertEqual([(r["key"], r["reach"]) for r in app], [("quality", True), ("release", True), ("release", False)],
                         "「;」で分け、同じ場所は 1 つに。このアプリの場所は届かなくても出す（届かないと分かる）")
        self.assertTrue(all(r["reach"] for r in rows if r["group"] == "pc"), "この PC の場所は届く物だけ")


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        (self.tmp / "共有" / "台帳").mkdir(parents=True)
        (self.tmp / "共有" / "台帳" / "SIKADEF.sqlite3").write_bytes(b"x")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"lot_list": {"source": str(self.tmp / "共有" / "台帳" / "SIKADEF.sqlite3")}, "work_log": {"folder": str(self.tmp / "共有")}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings, "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache")})
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_browse_and_places(self):
        r = self.c.post("/api/fs/browse", json={"path": str(self.tmp / "共有"), "purpose": "sqlite"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual([e["name"] for e in r.get_json()["entries"]], ["台帳"])
        items = self.c.get("/api/fs/places").get_json()["items"]
        app = {x["key"]: x["path"] for x in items if x["group"] == "app"}
        self.assertEqual(app["quality"], str(self.tmp / "共有" / "台帳"), "元ファイルは、それを入れたフォルダを出す")
        self.assertEqual(app["worklog"], str(self.tmp / "共有"))

    def test_only_people_who_can_change_the_paths_can_look(self):
        def flags(rows, login, pc):
            return {"role": "一般ユーザー", "masterEdit": "部分的編集可", "masterEditStored": "部分的編集可", "matchedId": None}
        with mock.patch("app.services.access.flags", flags):
            r = self.c.post("/api/fs/browse", json={"path": str(self.tmp)})
            self.assertEqual(r.status_code, 403)
            self.assertIn("参照先", r.get_json()["error"])
            self.assertEqual(self.c.get("/api/fs/places").status_code, 403)


if __name__ == "__main__":
    unittest.main()
