# -*- coding: utf-8 -*-
"""LotDsp の HTML の表の読み方の事例の表（tests/fixtures/lotdsp_html_cases.json。版 3.98.0）。

- 焼いた Python の修正版と、この Python の修正版が同じか（html.parser は修正版で答えが変わる: 3.13 の修正版で閉じない注釈・
  textarea の中の </td> の読み方が替わった）。違えば止まる: `python program/tools/lotdsp-cases.py` で焼き直し、
  `node program/tools/lotdsp-dom-cases.mjs` で DOM の答えを足し、違いを確かめてから CI の Python の版（.github/workflows の python-version）を上げる
- 表の答えが今の lotdsp_progress.inner_tables と同じか（窓〈desktop/src/lotdsp_html.rs〉は同じ表と突き合わせる）
- 独立の答え（Chromium の DOM）と同じか。違う事例は理由（dom_differs）が書いてある物だけ

    python -m unittest tests.test_lotdsp_html_cases
"""
import json
import platform
import unittest
from pathlib import Path

from app.services.lotdsp_progress import inner_tables

ROOT = Path(__file__).resolve().parents[1]
TABLE = json.loads((ROOT / "tests" / "fixtures" / "lotdsp_html_cases.json").read_text(encoding="utf-8"))


def html_of(c):
    return (ROOT / "tests" / "fixtures" / c["file"]).read_text(encoding="utf-8") if "file" in c else c["html"]


class HtmlCases(unittest.TestCase):
    def test_baked_with_this_python(self):
        self.assertEqual(platform.python_version(), TABLE["python"],
                         "焼いた Python の修正版と違います。program/tools/lotdsp-cases.py で焼き直し、窓の答えも確かめてください")

    def test_answers_are_the_table(self):
        for name, c in TABLE["cases"].items():
            with self.subTest(name=name):
                self.assertEqual(inner_tables(html_of(c)), c["python"])

    def test_dom_agrees_unless_a_reason_is_written(self):
        """独立の答え（ブラウザの DOM）と同じ。違う事例は理由がある物だけ（理由のある事例が同じになったら、理由を消す）。"""
        self.assertGreaterEqual(len(TABLE["cases"]), 50)
        for name, c in TABLE["cases"].items():
            with self.subTest(name=name):
                self.assertIn("dom", c, "DOM の答えがありません（node program/tools/lotdsp-dom-cases.mjs）")
                if "dom_differs" in c:
                    self.assertNotEqual(c["dom"], c["python"], "理由の要らない事例")
                else:
                    self.assertEqual(c["dom"], c["python"])


if __name__ == "__main__":
    unittest.main()
