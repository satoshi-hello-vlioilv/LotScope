# -*- coding: utf-8 -*-
"""ダッシュボードが作業実績の最初の写しを待つ長さ（版 3.92.0。利用者の要望 2026-11-10 の 4）:
- パネルの数（/api/dashboard/query）だけ 2 秒。窓（desktop/src/dashboard.rs の FIRST_WAIT）と Python（routes/dashboard.py の DASH_FIRST_WAIT_SEC）で同じ長さ
- 列の一覧・絞る面の項目（/api/dashboard/fields・/api/data/columns）は前どおり最初の写しを待つ（作った後の採点で見つけた割れ:
  2 秒で作業実績の列が 0 になり、変換表の「当てる列」から消えた）"""
import inspect
import re
import unittest
from pathlib import Path

from app.routes import dashboard as routes
from app.services import db_mirror

DESKTOP = Path(__file__).resolve().parents[2] / "desktop" / "src" / "dashboard.rs"


class DashWait(unittest.TestCase):
    def test_window_and_python_wait_the_same(self):
        m = re.search(r"const FIRST_WAIT: Duration = Duration::from_secs\((\d+)\);", DESKTOP.read_text(encoding="utf-8"))
        self.assertIsNotNone(m)
        self.assertEqual(int(m.group(1)), routes.DASH_FIRST_WAIT_SEC)
        self.assertLess(routes.DASH_FIRST_WAIT_SEC, db_mirror.FIRST_WAIT_SEC)

    def test_only_the_panel_query_waits_short(self):
        src = inspect.getsource(routes)
        short = re.findall(r"panel_parts\([^\n]*first_wait=DASH_FIRST_WAIT_SEC\)", src)
        allc = re.findall(r"= panel_parts\(", src)
        self.assertEqual(len(short), 2, "パネルの数の道（_answer と稼働・ABC）の 2 か所だけ 2 秒")
        self.assertGreater(len(allc), len(short), "列の一覧・絞る面の項目は既定（最初の写しを待つ）")
        self.assertIsNone(inspect.signature(routes.panel_parts).parameters["first_wait"].default)


if __name__ == "__main__":
    unittest.main()
