# -*- coding: utf-8 -*-
"""置き場の引っ越しの印をたどる係は窓の 1 つ（版 3.84.0。desktop/src/bundle.rs）。窓が bundle を名乗ると、Python は印をたどらず、
窓が書いたこの PC の覚え（master_share.json）を読み直して置き場を合わせるだけ（2 つの係が同じ印をたどると、覚えの履歴に同じ置き場が 2 回載る）。"""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.repositories.master_store import MOVED_FILENAME, OVERRIDE_FILENAME, MasterStore


def _w(p, d):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")


class ShellFollows(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.a, self.b = self.tmp / "a", self.tmp / "b"
        for d in (self.a, self.b):
            _w(d / "path_settings.json", {"schema": 1, "revision": 1, "rows": []})
        _w(self.a / MOVED_FILENAME, {"to": str(self.b), "at": "2026-11-01T09:00:00"})
        self.local = self.tmp / "local"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def store(self):
        return MasterStore(self.tmp / "base", local_root=self.local, settings={"dir": str(self.a)})

    def test_python_follows_without_the_window(self):
        with mock.patch.dict(os.environ, {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,access"}):
            st = self.store()
            self.assertTrue(st.follow_moved(force=True))
            self.assertEqual(st.share_dir, self.b)
            self.assertEqual(len(json.loads((self.local / OVERRIDE_FILENAME).read_text(encoding="utf-8"))["history"]), 1)

    def test_python_does_not_follow_when_the_window_serves_the_bundle(self):
        with mock.patch.dict(os.environ, {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,access,bundle"}):
            st = self.store()
            self.assertFalse(st.follow_moved(force=True), "印は窓がたどる")
            self.assertEqual(st.share_dir, self.a)
            self.assertFalse((self.local / OVERRIDE_FILENAME).exists(), "Python は覚えを書かない")
            # 窓が引っ越し先を覚えに書いた: Python は読み直して合わせるだけ（覚えは書き直さない）
            _w(self.local / OVERRIDE_FILENAME, {"dir": str(self.b), "history": [{"dir": str(self.a)}]})
            before = (self.local / OVERRIDE_FILENAME).read_text(encoding="utf-8")
            self.assertTrue(st.follow_moved(force=True))
            self.assertEqual(st.share_dir, self.b)
            self.assertEqual((self.local / OVERRIDE_FILENAME).read_text(encoding="utf-8"), before)
            self.assertFalse(st.follow_moved(force=True), "同じ置き場なら何もしない")


if __name__ == "__main__":
    unittest.main()
