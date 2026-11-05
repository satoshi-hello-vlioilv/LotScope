"""本文の数の字の事例表（tests/fixtures/jsonnum_cases.json。版 3.77.0）が、いまの Python の答えと同じか。
窓（desktop/src/master_rows.rs の unreadable）は cargo test --test jsonnum_cases で同じ表と突き合わせる。表が古ければ python tools/jsonnum-cases.py で作り直す。"""
import importlib.util
import json
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("jsonnum_cases", PROGRAM / "tools" / "jsonnum-cases.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        have = json.loads(tool.OUT.read_text(encoding="utf-8"))
        self.assertEqual(have["cases"], tool.build()["cases"], "事例の答えが今の Python と違う。tools/jsonnum-cases.py で作り直す")

    def test_table_covers_the_known_edges(self):
        cases = {c["s"]: c for c in json.loads(tool.OUT.read_text(encoding="utf-8"))["cases"]}
        # 整数の -0 は Python では int の 0（窓の serde は小数の -0.0）・小数の -0.0 はどちらも -0.0
        self.assertEqual((cases["-0"]["str"], cases["-0"]["plain"]), ("0", False))
        self.assertEqual((cases["-0.0"]["str"], cases["-0.0"]["plain"]), ("-0.0", True))
        self.assertEqual((cases["1e16"]["str"], cases["1e400"]["str"], cases["NaN"]["str"]), ("1e+16", "inf", "nan"))
        self.assertEqual((cases["9223372036854775808"]["plain"], cases["00"]["loads"]), (False, False))


if __name__ == "__main__":
    unittest.main()
