# -*- coding: utf-8 -*-
"""値の計算（四則演算。services/num_expr.py）と、集計の値ごとの計算（aggregate の expr・pivot で表し方の前に当てる）。

事例の表（tests/fixtures/num_expr_cases.json）は画面の num-format.js と同じ物（tools/num-format-check.mjs が画面側を突き合わせる）。"""
import json
import unittest
from pathlib import Path

from app.services import aggregate, num_expr

CASES = json.loads((Path(__file__).parent / "fixtures" / "num_expr_cases.json").read_text(encoding="utf-8"))["cases"]


class NumExprTest(unittest.TestCase):
    def test_same_answers_as_screen(self):
        for src, x, want in CASES:
            with self.subTest(src=src):
                fn, err, _ = num_expr.compile_expr(src)
                if want == "err":
                    self.assertTrue(err and fn is None, (src, err))
                elif want == "none":
                    self.assertIsNone(fn)
                    self.assertEqual(err, "")
                elif want is None:
                    self.assertIsNone(fn(x))
                else:
                    self.assertAlmostEqual(fn(x), want, places=9)

    def test_text(self):
        self.assertEqual(num_expr.compile_expr("÷1000")[2], "値÷1000")
        self.assertEqual(aggregate.name({"agg": "sum", "column": "重量", "expr": "÷1000"}), "重量の合計［値÷1000］")


class MeasureExprTest(unittest.TestCase):
    def test_clean_keeps_and_rejects(self):
        m = aggregate.clean({"agg": "sum", "column": "重量", "expr": " ÷1000 "}, lambda c: True)
        self.assertEqual(m["expr"], "÷1000")
        with self.assertRaises(ValueError):
            aggregate.clean({"agg": "sum", "column": "重量", "expr": "x+"}, lambda c: True)
        self.assertNotIn("expr", aggregate.clean({"agg": "count", "expr": ""}, lambda c: True))

    def test_dec_is_kept_and_clamped(self):
        """桁（版 3.50.1）: 0〜6 に収めて持つ。読めない桁は持たない。値そのものは丸めない（見せる字だけ）"""
        def clean(d):
            return aggregate.clean({"agg": "sum", "column": "重量", "dec": d}, lambda c: True).get("dec")
        self.assertEqual([clean(1), clean("2"), clean(9), clean(-1), clean(1.6), clean("x"), clean(None)], [1, 2, 6, 0, 2, None, None])
        cells = [{"r": [], "c": [], "v": [972.3654]}]
        aggregate.apply_expr(cells, [{"agg": "sum", "column": "a", "dec": 1}])
        self.assertEqual(cells[0]["v"][0], 972.3654)

    def test_expr_before_show(self):
        """計算は表し方の前: 累計は計算した値を足し上げ、割合は計算しても同じ（線形）"""
        ms = [{"agg": "sum", "column": "a", "expr": "-10"}, {"agg": "sum", "column": "a", "expr": "×2", "show": "pct_total"}]
        cells = [{"r": ["x"], "c": [], "v": [30, 30]}, {"r": ["y"], "c": [], "v": [70, 70]}, {"r": [], "c": [], "v": [100, 100]}]
        aggregate.apply_expr(cells, ms)
        aggregate.apply_show(cells, ms, 1, 0, [["x", "y"]])
        self.assertEqual([c["v"][0] for c in cells], [20, 60, 90])
        self.assertEqual([round(c["v"][1], 6) for c in cells], [30.0, 70.0, 100.0])

    def test_none_and_text_untouched(self):
        cells = [{"r": [], "c": [], "v": [None]}]
        aggregate.apply_expr(cells, [{"agg": "avg", "column": "a", "expr": "×2"}])
        self.assertIsNone(cells[0]["v"][0])


if __name__ == "__main__":
    unittest.main()
