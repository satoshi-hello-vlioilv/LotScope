# -*- coding: utf-8 -*-
"""窓（デスクトップ版の Rust）が一覧の段取りも受け持つときの Python 側（版 3.60.0）: 前の窓との組・受け身の写しの係・画面への印・
結合の数の覚え。道の答えそのものは desktop/tests/routes_parity.rs（← tests/routes_oracle.py）が Rust と突き合わせる。"""
import json
import os
import unittest
from unittest import mock

from app import lists_are_external, work_mirrors
from app.services import data_join
from tests.test_sources_unify import Env

LISTS = {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,lists"}
OLD = {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist"}


class OldAndNewWindow(Env):
    """品質のロット番号の列を決めてあるとき: 段取りを知らない前の窓には Python が答える（engine=python）・lists を名乗る窓は窓が答える"""

    def test_engine_follows_what_the_window_serves(self):
        r = self.c.put("/api/sources/lot", json={"ロット番号の列": "-", "base_rev": self.items()["lot"]["rev"] or 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        with mock.patch.dict(os.environ, OLD):
            self.assertEqual(self.c.get("/api/lotlist/settings").get_json()["engine"], "python", "前の窓は品質のロット番号の列を知らない")
        with mock.patch.dict(os.environ, LISTS):
            s = self.c.get("/api/lotlist/settings").get_json()
            self.assertEqual(s["engine"], "rust", "lists を名乗る窓が答える")
            lot = next(x for x in s["lists"]["sources"] if x["key"] == "lot")
            self.assertEqual(lot["lotSet"], "-")
            self.assertTrue(self.items()["lot"]["shellLists"], "画面は結合・ロット番号の列のある品質を Python へ回さない")
        with mock.patch.dict(os.environ, OLD):
            self.assertFalse(self.items()["lot"]["shellLists"], "前の窓とは Python へ回す")

    def test_settings_carry_the_file_ids_to_follow_renames(self):
        from app.services import work_log
        from tests import lotlist_fixture
        folder = self.tmp / "実績"
        folder.mkdir(exist_ok=True)
        lotlist_fixture.make_work(str(folder / "実績_CR1.sqlite3"), "CR1", n=5)
        self.repo.work_log_sync(work_log.scan(folder, "実績_*.sqlite3"))
        rows = self.c.get("/api/lotlist/settings").get_json()["lists"]["work"]["rows"]
        self.assertTrue(rows[0]["ファイルID"], "名前が変わったファイルをたどる「ファイルID」の値まで渡す")
        self.assertTrue(rows and all(set(r) == {"キー", "設備名", "ファイル名", "ファイルID", "表示", "表"} for r in rows),
                        "名前が変わったファイルをたどる「ファイルID」まで渡す")


class PassiveMirrors(Env):
    def test_window_lists_make_the_mirrors_passive(self):
        for k in ("WORK_MIRRORS", "SRC_MIRRORS"):
            self.app.config.pop(k, None)
        told = []
        with mock.patch.dict(os.environ, LISTS), mock.patch("app.shell_notice", lambda ev, **kw: told.append((ev, kw))):
            self.assertTrue(lists_are_external(self.app.config["APP_SETTINGS"]))
            ms = work_mirrors(self.app, "src")
            self.assertTrue(ms.passive and work_mirrors(self.app, "work").passive, "窓と Python の 2 人で写さない")
            self.assertIs(work_mirrors(self.app, "src"), ms, "アプリに 1 つ")
            ms.get("wip", str(self.wip), 60, 36)
            self.assertEqual(told, [("mirror", {"prefix": "src", "key": "wip", "remote": str(self.wip), "interval": 60, "stale": 36})])
        for k in ("WORK_MIRRORS", "SRC_MIRRORS"):
            self.app.config.pop(k, None)
        with mock.patch.dict(os.environ, OLD):
            self.assertFalse(work_mirrors(self.app, "work").passive, "段取りを知らない前の窓なら Python が写す")


class JoinRecent(unittest.TestCase):
    def test_recent_reads_the_numbers_the_window_left_for_the_same_rules(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            j = data_join.Joiner(Path(d))
            items = [{"with": "m1", "how": "left", "on": [["a", "b"]], "cols": []}]
            (Path(d) / "wip_aaa.json").write_text(json.dumps({"stats": [{"out": 3}], "builtAt": 1, "items": items}), encoding="utf-8")
            (Path(d) / "wip_bbb.json").write_text(json.dumps({"stats": [{"out": 9}], "builtAt": 2,
                                                              "items": [{**items[0], "how": "inner"}]}), encoding="utf-8")
            self.assertEqual(j.recent("wip", items)["stats"], [{"out": 3}], "決まりが同じ物だけ（新しくても決まりの違う物は使わない）")
            self.assertIsNone(j.recent("wip", [{**items[0], "how": "full"}]))
            self.assertIsNone(j.recent("lot", items), "キーの違う物は使わない")
            j.last["wip"] = {"stats": [{"out": 5}], "items": items}
            self.assertEqual(j.recent("wip", items)["stats"], [{"out": 5}], "このプロセスで組んだ物が先")


if __name__ == "__main__":
    unittest.main()
