"""大きな整数の事例の表（tests/fixtures/bigint_cases.json。版 3.108.0・案 H2）が、いまの Python の int の答えと同じか。
窓（desktop/src/pyfmt.rs の PyInt・src/held.rs）は cargo test --test bigint_cases で同じ表と突き合わせる。表が古ければ python tools/bigint-cases.py で作り直す。"""
import importlib.util
import json
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bigint_cases", PROGRAM / "tools" / "bigint-cases.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        self.assertEqual(json.loads(tool.OUT.read_text(encoding="utf-8")), tool.build(), "事例の答えが今の Python と違う。tools/bigint-cases.py で作り直す")

    def test_table_covers_the_known_edges(self):
        t = json.loads(tool.OUT.read_text(encoding="utf-8"))
        self.assertIn("18446744073709551616", t["ints"])
        self.assertTrue(any(len(s.lstrip("-")) > 4000 for s in t["ints"]), "4,300 桁の近く")
        self.assertEqual(t["next_id"][0]["want"], "100000000000000000001")
        self.assertEqual(t["next_order"][-3]["want"], "17", "4,300 桁を超える表示順は int() が読めず数えない")


if __name__ == "__main__":
    unittest.main()
