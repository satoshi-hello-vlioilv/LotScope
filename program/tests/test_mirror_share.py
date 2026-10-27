# -*- coding: utf-8 -*-
"""元が同じファイルの写しを 1 つにする（版 3.57.1。work_log.Mirrors）と、Windows の SQLite（URI を既定で読まない）でも結合を組めること。

利用者の知らせ（2026-10-27）: スケジュールのタブが「「スケジュール」の結合を組めませんでした: unable to open database:
file:///C:/…/schedule/L-1-….g2.sqlite3?mode=ro」で読めない。原因は結合を組む接続を URI でなく開いていたこと
（ATTACH の file:…?mode=ro は、主の接続を URI で開いたときだけ URI と読まれる。Linux の SQLite は既定で読むので試験で気づけなかった）。
"""
import ctypes
import ctypes.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from app.services import work_log

ROOT = Path(__file__).resolve().parents[1]
# Windows の Python に付く SQLite と同じ形（SQLITE_CONFIG_URI=0: URI を既定で読まない）にしてから試験を流す
NO_URI = """
import ctypes, ctypes.util, sys, unittest
lib = ctypes.CDLL(ctypes.util.find_library("sqlite3"))
lib.sqlite3_shutdown()
if lib.sqlite3_config(17, ctypes.c_int(0)) != 0:
    sys.exit(77)
lib.sqlite3_initialize()
import os, sqlite3, tempfile
from pathlib import Path
probe = Path(tempfile.mkdtemp()) / "probe.sqlite3"
sqlite3.connect(probe).close()
try:
    sqlite3.connect(":memory:").execute("ATTACH ? AS b", (probe.as_uri() + "?mode=ro",))
    sys.exit(77)                         # URI を読んでしまう（この SQLite では Windows の形にできない）
except sqlite3.OperationalError:
    pass
sys.exit(0 if unittest.main(module=None, argv=["x", *sys.argv[1:]], exit=False).result.wasSuccessful() else 1)
"""


class SamePlace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ms = work_log.Mirrors(Path(self.tmp.name), passive=True, prefix="src")

    def tearDown(self):
        self.tmp.cleanup()

    def test_same_file_is_mirrored_once(self):
        a = self.ms.get("wip", r"\\srv\share\LOTNOW.sqlite3", 60, 24)
        b = self.ms.get("wip2", r' "\\srv\share\LOTNOW.sqlite3" ', 300, 48)
        self.assertIs(a, b, "元が同じファイルなら 1 つの写しを分け合う")
        self.assertEqual(a.interval, 60, "間隔は係を作ったキー（持ち主）の設定")
        self.assertIs(self.ms.get("wip2", r"\\srv\share\LOTNOW.sqlite3", 300, 48), a, "もう一度聞いても同じ")
        c = self.ms.get("other", r"\\srv\share\OTHER.sqlite3", 60, 24)
        self.assertIsNot(c, a, "違うファイルは別の写し")

    def test_leaving_and_joining(self):
        a = self.ms.get("wip", "/data/LOTNOW.sqlite3", 60, 24)
        self.ms.get("wip2", "/data/LOTNOW.sqlite3", 60, 24)
        b = self.ms.get("wip2", "/data/NEW.sqlite3", 60, 24)
        self.assertIsNot(b, a, "分け合っていた元を替えたら抜ける")
        self.assertEqual((a.remote, b.remote), ("/data/LOTNOW.sqlite3", "/data/NEW.sqlite3"), "残った方の元は替わらない")
        c = self.ms.get("wip", "/data/NEW.sqlite3", 60, 24)
        self.assertIs(c, b, "1 人で使っていた係の元を、ほかのキーが写しているファイルに替えたら、そちらに乗る")
        self.assertEqual(a.remote, "", "置いて行った係は写さない")
        d = self.ms.get("wip2", "/data/THIRD.sqlite3", 60, 24)
        self.assertIsNot(d, b)
        self.assertEqual(self.ms.peek("wip").remote, "/data/NEW.sqlite3")

    @unittest.skipUnless(os.name == "nt", "Windows だけ: 大文字小文字・区切りの違いは同じファイル")
    def test_windows_spelling(self):
        self.assertIs(self.ms.get("a", r"C:\Data\Lot.sqlite3", 60, 24), self.ms.get("b", "c:/data/LOT.sqlite3", 60, 24))


class WindowsSqlite(unittest.TestCase):
    """結合・スケジュール・データ元の試験を、Windows の SQLite と同じ形（URI を既定で読まない）で流す。"""

    def test_joins_work_without_default_uri(self):
        if not ctypes.util.find_library("sqlite3"):
            self.skipTest("libsqlite3 が見つからない")
        r = subprocess.run([sys.executable, "-c", NO_URI, "tests.test_data_join", "tests.test_schedule", "tests.test_data_sources"],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if r.returncode == 77:
            self.skipTest("この SQLite は URI を読まない形にできない")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])


if __name__ == "__main__":
    unittest.main()
