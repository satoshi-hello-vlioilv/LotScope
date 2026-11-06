# -*- coding: utf-8 -*-
"""窓の部品（desktop/src/layout_clean.rs）と突き合わせる事例の表（tests/fixtures/layout_cases.json）が、今の Python の答えと同じか（版 3.81.0）"""
import importlib.util
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "layout-cases.py"


def _tool():
    spec = importlib.util.spec_from_file_location("layout_cases_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class LayoutCasesTable(unittest.TestCase):
    def test_baked_table_is_fresh(self):
        import json
        tool = _tool()
        self.assertTrue(tool.OUT.exists(), "焼いた表が無い")
        self.assertTrue(json.loads(tool.OUT.read_text(encoding="utf-8"))["cases"] == tool.table()["cases"],
                        "焼いた表が古い（python program/tools/layout-cases.py で焼き直す）")

    def test_table_covers_the_split_forms(self):
        cases = _tool().table()["cases"]
        kinds = {next(iter(c["want"])) for c in cases}
        self.assertEqual(kinds, {"ok", "error", "crash"})
        self.assertGreaterEqual(sum(1 for c in cases if c.get("py")), 10, "窓が任せる形")
        self.assertTrue(any('"colors"' in c["in"] and "x" * 121 in c["in"] for c in cases), "120 字で切った後に重なる色")


if __name__ == "__main__":
    unittest.main()
