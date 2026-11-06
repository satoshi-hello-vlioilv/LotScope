# -*- coding: utf-8 -*-
"""窓が持つ組み込みのダッシュボードの表（desktop/src/dash_builtins.json）が、今の dashboard.BUILTIN_LAYOUTS と同じか（版 3.82.0）"""
import importlib.util
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "dash-builtins.py"


def _tool():
    spec = importlib.util.spec_from_file_location("dash_builtins_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class DashBuiltinsTable(unittest.TestCase):
    def test_baked_table_is_fresh(self):
        tool = _tool()
        self.assertTrue(tool.OUT.exists(), "焼いた表が無い")
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(),
                         "焼いた表が古い（python program/tools/dash-builtins.py で焼き直す）")

    def test_every_builtin_is_baked(self):
        t = _tool().table()["layouts"]
        self.assertTrue(t and all(x["view"]["id"] == f"b:{x['key']}" and x["view"]["builtin"] for x in t))


if __name__ == "__main__":
    unittest.main()
