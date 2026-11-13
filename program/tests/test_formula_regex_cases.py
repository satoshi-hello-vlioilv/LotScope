"""式の正規表現の事例の表（tests/fixtures/formula_regex_cases.json。版 3.106.0）が、いまの Python の formula.js_regex から焼き直した物と同じか。
窓は cargo test --test formula_regex_cases で同じ表を読む。"""
import importlib.util
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("formula_regex_cases", PROGRAM / "tools" / "formula-regex-cases.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(tool.build()), "python tools/formula-regex-cases.py で作り直す")


if __name__ == "__main__":
    unittest.main()
