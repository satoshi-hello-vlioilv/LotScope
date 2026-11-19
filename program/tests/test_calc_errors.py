"""転写距離・ピッチ計算の誤りの言葉（版 3.115.0。services/calc_errors）が人の書いた事例の表 tests/fixtures/calc_error_cases.json と同じか。
窓は cargo test --test calc_error_cases が同じ表を読む。計算の道の答えも言葉になる（前は Python の例外の字）"""
import json
import unittest
from pathlib import Path

from app.services import calc_errors

TABLE = json.loads((Path(__file__).parent / "fixtures" / "calc_error_cases.json").read_text(encoding="utf-8"))


class CalcErrors(unittest.TestCase):
    def test_like_the_table(self):
        self.assertEqual(calc_errors.KINDS, TABLE["kinds"])
        for c in TABLE["cases"]:
            with self.subTest(c["why"]):
                self.assertEqual(calc_errors.message(c["type"], c["str"]), c["want"])

    def test_real_exceptions(self):
        for e, want in [(KeyError("thickness"), "計算の入力に「thickness」がありません。"),
                        (IndexError("list index out of range"), "計算の入力の並び（工程・候補）が足りません。")]:
            self.assertEqual(calc_errors.of(e), want)
        try:
            int("x")
        except ValueError as e:
            self.assertEqual(calc_errors.of(e), "計算の入力に数で読めない値「x」があります（整数で書いてください）。")

    def test_every_kind_has_a_case(self):
        kinds = {TABLE["kinds"].get(c["type"]) for c in TABLE["cases"]}
        self.assertLessEqual({"missing", "number", "short", "text"}, kinds)


if __name__ == "__main__":
    unittest.main()
