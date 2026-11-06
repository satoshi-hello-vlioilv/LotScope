# -*- coding: utf-8 -*-
"""窓が持つ組み込みの組み方の表（desktop/src/pivot_builtins.json）が、今の pivot_presets.BUILTINS と同じか（版 3.81.0）"""
import importlib.util
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "pivot-builtins.py"


def _tool():
    spec = importlib.util.spec_from_file_location("pivot_builtins_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class PivotBuiltinsTable(unittest.TestCase):
    def test_baked_table_is_fresh(self):
        tool = _tool()
        self.assertTrue(tool.OUT.exists(), "焼いた表が無い")
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(),
                         "焼いた表が古い（python program/tools/pivot-builtins.py で焼き直す）")

    def test_table_has_both_sources(self):
        t = _tool().table()
        self.assertEqual(set(t), {"lot", "work"})
        self.assertTrue(all(x["builtin"] and x["id"].startswith("b:") for xs in t.values() for x in xs))


if __name__ == "__main__":
    unittest.main()
