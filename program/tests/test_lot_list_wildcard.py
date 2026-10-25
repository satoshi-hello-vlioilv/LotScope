# -*- coding: utf-8 -*-
"""絞り込みの で始まらない・で終わらない と、Excel と同じ * ?（版 3.54.0。services/lot_list.py の like_pattern・build_filter_where）。

事例の表（tests/fixtures/like_cases.json）は Rust の lotlist.rs の試験も読む（同じ型を出すか）。
ここでは、型と、一覧の絞り込み（lot_list.query）で当たる値が事例の表のとおりかを確かめる。"""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.services import lot_list

CASES = json.loads((Path(__file__).parent / "fixtures" / "like_cases.json").read_text(encoding="utf-8"))


class WildcardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "w.sqlite3"
        with sqlite3.connect(cls.db) as c:
            c.execute('CREATE TABLE "品質情報" ("ロット番号" TEXT, "設備" TEXT)')
            c.executemany('INSERT INTO "品質情報" VALUES (?, ?)', [(f"L{i:04d}", v if v else None) for i, v in enumerate(CASES["values"])])
        c.close()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_patterns(self):
        for x in CASES["patterns"]:
            with self.subTest(x=x):
                self.assertEqual(lot_list.like_pattern(x["value"], x["mode"]), (x["pattern"], x["wild"]))

    def hits(self, filters="", search=""):
        out = lot_list.query(self.db, filters=json.dumps(filters, ensure_ascii=False) if filters else "", search=search, page_size=100)
        return sorted(r["設備"] or "" for r in out["rows"])

    def test_filters_match(self):
        for x in CASES["match"]:
            with self.subTest(x=x):
                self.assertEqual(self.hits([{"column": "設備", "op": x["op"], "value": x["value"]}]), sorted(x["hit"]))

    def test_new_ops_are_allowed(self):
        self.assertIn("not_starts", lot_list.ALLOWED_OPS)
        self.assertIn("not_ends", lot_list.ALLOWED_OPS)

    def test_search_uses_wildcards(self):
        self.assertEqual(self.hits(search="CR?"), ["CR1", "CR10", "CR2"])     # 含む: CR の後ろに 1 字以上
        self.assertEqual(self.hits(search="%"), ["50%"])                     # % は字そのもの（前は全部に当たっていた）
        self.assertEqual(self.hits(search="A~*"), ["A*B"])


if __name__ == "__main__":
    unittest.main()
