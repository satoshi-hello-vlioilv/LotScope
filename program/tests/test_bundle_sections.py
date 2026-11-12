# -*- coding: utf-8 -*-
"""設定の束の節（版 3.102.0）: Python の routes/lotlist.SECTIONS が事例の表 tests/fixtures/bundle_cases.json と同じか
（窓の bundle.rs の SECTIONS と lot.rs の sections_for は cargo test --test bundle_cases が同じ表と比べる）。"""
import json
import unittest
from pathlib import Path

from app.routes import lotlist

TABLE = json.loads((Path(__file__).resolve().parent / "fixtures" / "bundle_cases.json").read_text(encoding="utf-8"))


class Sections(unittest.TestCase):
    def test_sections_are_like_the_table(self):
        self.assertEqual({k: list(v) for k, v in lotlist.SECTIONS.items()}, TABLE["sections"])


if __name__ == "__main__":
    unittest.main()
