"""数の読み方の事例表（tests/fixtures/pynum_cases.json。版 3.75.0）が、いまの Python の答えと同じか。
窓（desktop/src/pyfmt.rs）は cargo test --test pynum_cases で同じ表と突き合わせる。表が古ければ python tools/pynum-cases.py で作り直す。"""
import importlib.util
import json
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pynum_cases", PROGRAM / "tools" / "pynum-cases.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        have = json.loads(tool.OUT.read_text(encoding="utf-8"))
        want = tool.build()
        self.assertEqual(have["digits"], want["digits"], "数字の範囲が変わった（同梱の Python の Unicode の版が上がった？）。tools/pynum-cases.py で作り直す")
        self.assertEqual(have["cases"], want["cases"], "事例の答えが今の Python と違う。tools/pynum-cases.py で作り直す")

    def test_table_covers_the_known_edges(self):
        cases = {c["s"]: c for c in json.loads(tool.OUT.read_text(encoding="utf-8"))["cases"]}
        self.assertEqual(sum((b - a + 1) // 10 for a, b in tool.digit_ranges()), 68, "Python 3.13（Unicode 15.1）の数字は 68 系統")
        self.assertEqual(cases["᠑:30"]["hm"], 90, "モンゴルの数字の時刻も Python は読む")
        self.assertEqual((cases["²"]["int"], cases["--5"]["int"], cases["1_0"]["int"]), (None, None, 10))
        self.assertEqual((cases["1e400"]["float"], cases["nan"]["float"]), ("inf", "nan"))
        # 版 3.104.0: int()・float() は U+001C〜U+001F を空白に読まない（str.strip は読む）。i64 に入らない数は桁の字・4,300 桁の上限
        self.assertEqual((cases["4\x1c"]["int"], cases["4\x1c"]["float"], cases["4\x85"]["int"]), (None, None, 4))
        self.assertEqual(cases["99999999999999999999"]["int"], "99999999999999999999")
        self.assertTrue(cases["1" * 4301]["int_err"].startswith("Exceeds the limit (4300 digits)"))


if __name__ == "__main__":
    unittest.main()
