# -*- coding: utf-8 -*-
"""読めない行を何行目かで消す道（版 3.108.0。DELETE /api/masters/rows/<名前>/<n>?summary=&key=）の Python の後始末と確かめ。
窓は desktop/tests/equip_rows_parity.rs（同じ場面の答え）と lot::tests::the_window_writes_equipment_and_rolls（消した直後の読み）。
作った後の採点の割れ 4（行の目印）・5（参照先・実績の設備の行を消したら覚えを捨てる）"""
import json
import unittest
from unittest import mock
from urllib.parse import quote

from app.repositories.master_repository import row_key
from app.services import row_check
from tests.test_broken_masters import Env


def q(name, r):
    return f"summary={quote(row_check.summary(name, r))}&key={row_key(name, r)}"


class RowDelete(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def put(self, name, rows):
        self.env.data(name).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def test_path_settings_row_reapplies_the_mirror_and_forgets_the_folder(self):
        bad = {"id": 2, "項目": "work_log.folder", "値": "x", "rev": "abc"}
        self.put("path_settings", [{"id": 1, "項目": "lot_list.table", "値": "品質表", "rev": 1}, bad])
        listing = mock.Mock()
        self.env.app.config["WORK_LISTING"] = listing
        with mock.patch("app.routes.lotlist.lot_mirror") as mirror:
            r = self.env.c.delete(f"/api/masters/rows/path_settings/2?{q('path_settings', bad)}")
        self.assertEqual((r.status_code, r.get_json()["row"]), (200, 2), r.get_json())
        self.assertEqual((mirror.call_count, listing.forget.call_count), (1, 1), "消したら品質の写しを当て直し、実績のフォルダの覚えを捨てる")
        self.assertNotIn("work_log.folder", self.env.data("path_settings").read_text(encoding="utf-8"))

    def test_work_log_row_forgets_the_folder(self):
        bad = {"id": "x", "キー": "z", "設備名": "字の id"}
        self.put("work_log_files", [{"id": 1, "キー": "a", "設備名": "CR1", "rev": 1}, bad])
        listing = mock.Mock()
        self.env.app.config["WORK_LISTING"] = listing
        r = self.env.c.delete(f"/api/masters/rows/work_log_files/2?{q('work_log_files', bad)}")
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(listing.forget.call_count, 1)

    def test_a_shifted_row_with_the_same_summary_is_not_deleted(self):
        """ほかの PC が前の行を消して位置がずれた: 要約が同じでも中身（目印）が違う行は消さない"""
        a, b = {"id": "x", "設備名": "同じ"}, {"id": "x", "設備名": "同じ", "同一工程": "違う中身"}
        self.assertEqual(row_check.summary("equipment_master", a), row_check.summary("equipment_master", b))
        self.put("equipment_master", [a, b])
        r = self.env.c.delete(f"/api/masters/rows/equipment_master/2?{q('equipment_master', a)}")
        self.assertEqual(r.status_code, 404, "2 行目は a でなく b")
        r = self.env.c.delete(f"/api/masters/rows/equipment_master/2?summary={quote(row_check.summary('equipment_master', b))}")
        self.assertEqual(r.status_code, 404, "目印の無い問いは消さない")
        r = self.env.c.delete(f"/api/masters/rows/equipment_master/1?{q('equipment_master', a)}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("違う中身", self.env.data("equipment_master").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()


class KeyedMastersKeepUnreadableRows(unittest.TestCase):
    """データ元・実績の設備の読めない行（版 3.108.0）: 読みでは使い（隔てない。見出しのタブ・設備を消さない）、キー・id の当たる直す・並べ替え・
    探し直しの書きだけを断る（参照先と同じ）。窓はこの形を Python に任せる（lot::tests::the_window_writes_data_sources_and_rebuilds）"""

    def setUp(self):
        self.env = Env()
        from app.repositories.master_repository import MasterRepository
        self.repo = MasterRepository(self.env.store)

    def tearDown(self):
        self.env.close()

    def put(self, name, rows):
        self.env.data(name).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def test_data_sources(self):
        from app.repositories.master_store import MasterUnreadable
        bad = {"id": 2, "キー": "rv", "表示名": "版が字", "場所": "/r.sqlite3", "rev": "abc"}
        self.put("data_sources", [{"id": 1, "キー": "s1", "表示名": "良い", "場所": "/a.sqlite3", "rev": 1}, bad])
        self.assertEqual([r["キー"] for r in self.repo.data_source_rows()], ["s1", "rv"], "読みでは使う")
        with self.assertRaises(MasterUnreadable, msg="キーの当たる読めない行は直さない"):
            self.repo.data_source_put("rv", {"表示名": "直す"})
        with self.assertRaises(MasterUnreadable, msg="並べ替えも触れれば断る"):
            self.repo.data_source_order({"rv": {"並び": "1"}, "s1": {"並び": "2"}})
        self.repo.data_source_order({"s1": {"並び": "2"}})
        self.repo.data_source_put("s1", {"表示名": "直せる", "場所": "/a.sqlite3"})
        self.repo.data_source_delete("rv", base_rev=9)          # 値を読まずに消す（版は見ない）
        self.assertEqual([r["キー"] for r in self.repo.data_source_rows()], ["s1"])

    def test_work_logs(self):
        from app.repositories.master_store import MasterUnreadable
        fid = "1:2"
        rows = [{"id": 1, "キー": "a", "設備名": "CR1", "ファイル名": "実績_CR1.sqlite3", "並び": "2", "rev": 1},
                {"id": "x", "キー": "z", "設備名": "字の id", "ファイル名": "実績_字.sqlite3", "並び": "1"},
                {"id": 3, "キー": "y", "設備名": "名前を変えた", "ファイル名": "実績_旧.sqlite3", "ファイルID": fid, "並び": "3", "rev": "二"}]
        self.put("work_log_files", rows)
        self.assertEqual(len(self.repo.work_logs()), 3, "読みでは使う")
        out = self.repo.work_log_order(["a", "z"])
        self.assertEqual([r["キー"] for r in out], ["a"], "並べ替えは読める行だけ")
        found = [{"file": "実績_CR1.sqlite3", "equipment": "CR1", "fid": "", "size": 1, "mtime": 0},
                 {"file": "実績_字.sqlite3", "equipment": "字", "fid": "", "size": 1, "mtime": 0},
                 {"file": "実績_新.sqlite3", "equipment": "新", "fid": fid, "size": 1, "mtime": 0},
                 {"file": "実績_本当に新しい.sqlite3", "equipment": "本当", "fid": "9:9", "size": 1, "mtime": 0}]
        res = self.repo.work_log_sync(found)
        self.assertEqual([r["設備名"] for r in res["added"]], ["本当"], "隔てた行のファイル（名前でも、名前を変えたファイルID でも）は足さない")
        with self.assertRaises(MasterUnreadable):
            self.repo.work_log_update(3, {"設備名": "直す"})
        self.repo.work_log_delete(3)
        self.assertEqual(len(self.repo.work_logs()), 3, "消すのは通す（足した 1 行・消した 1 行）")
