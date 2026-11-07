# -*- coding: utf-8 -*-
"""窓が設定の束を組む決まりの表（desktop/src/bundle_tables.json）が、今の Python の決まりと同じか（版 3.84.0）"""
import importlib.util
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "bundle-tables.py"


def _tool():
    spec = importlib.util.spec_from_file_location("bundle_tables_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class BundleTables(unittest.TestCase):
    def test_baked_table_is_fresh(self):
        tool = _tool()
        self.assertTrue(tool.OUT.exists(), "焼いた表が無い")
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(),
                         "焼いた表が古い（python program/tools/bundle-tables.py で焼き直す）")

    def test_bundle_items_only(self):
        keys = [x["key"] for x in _tool().table()["pathItems"]]
        self.assertIn("lot_list.source", keys)
        self.assertFalse(any(k.startswith(("update.", "lotdsp_import.")) for k in keys), "束に出ない項目は写さない")


if __name__ == "__main__":
    unittest.main()
