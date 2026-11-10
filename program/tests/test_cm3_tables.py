# -*- coding: utf-8 -*-
"""窓が CM3 の答えの字を読む表（desktop/src/cm3_tables.json。版 3.96.0）が、今の Python の決まりと同じか。
CP932・Shift_JIS の 1・2 バイトの全部の読みを窓の読み方で比べるのは desktop/tests/schedule_parity.rs の codecs_match_python"""
import importlib.util
import json
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "cm3-tables.py"


def _tool():
    spec = importlib.util.spec_from_file_location("cm3_tables_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Cm3Tables(unittest.TestCase):
    def test_baked_table_is_fresh(self):
        tool = _tool()
        self.assertTrue(tool.OUT.exists(), "焼いた表が無い")
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(), "焼いた表が古い（python program/tools/cm3-tables.py で焼き直す）")

    def test_known_differences(self):
        t = json.loads(_tool().OUT.read_text(encoding="utf-8"))
        one = t["cp932"]["one"]
        self.assertEqual([one[0x80], one[0xA0], one[0xFD], one[0xFF]], [0x80, 0xF8F0, 0xF8F1, 0xF8F3], "cp932 だけが読む 1 バイト")
        self.assertEqual(t["shift_jis"]["one"][0xA0], -1)
        cp, sj = t["cp932"]["two"]["81"], t["shift_jis"]["two"]["81"]
        diff = [f"81{0x40 + i:02X}" for i, (a, b) in enumerate(zip(cp, sj)) if a != b and a != "\0" and b != "\0"]
        self.assertEqual(diff, ["8160", "8161", "817C", "8191", "8192", "81CA"], "cp932 と shift_jis で違う 6 字")
        self.assertEqual(len(t["html"]["names"]), 2231)
        self.assertEqual(len(t["html"]["invalidCharrefs"]), 34)
        self.assertEqual(sum(1 for k in t["html"]["names"] if not k.endswith(";")), 106)


if __name__ == "__main__":
    unittest.main()
