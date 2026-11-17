"""窓が焼いた表（desktop/tests/baked/*.json。版 3.115.0）が古くないか: 焼いた時の元（答え合わせ役など）の指紋が今の元と同じ・表の形・
本の行き先の表（books.json）の 36 本（tools/bless.py --check と同じ）。変異: 元を 1 字変えると古いと言う"""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bless", PROGRAM / "tools" / "bless.py")
bless = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bless)


class BakedTables(unittest.TestCase):
    def test_tables_are_not_stale(self):
        self.assertEqual(bless.check(), [])

    def test_books_cover_every_oracle(self):
        oracles = {p.name.removesuffix("_oracle.py") for p in (PROGRAM / "tests").glob("*_oracle.py")}
        self.assertEqual(set(bless.BOOKS), oracles)
        self.assertEqual(sum(1 for b in bless.BOOKS.values() if b["phase"] == "3.115.0"), 21)
        self.assertEqual(sum(1 for b in bless.BOOKS.values() if b["phase"] == "keep"), 1)

    def test_a_changed_source_makes_the_table_stale(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "tests").mkdir()
            src = PROGRAM / "tests" / "settings_write_oracle.py"
            shutil.copy(src, tmp / "tests" / src.name)
            shutil.copy(PROGRAM / "tests" / "oracle_gate.py", tmp / "tests" / "oracle_gate.py")
            old = bless.PROGRAM
            bless.PROGRAM = tmp
            try:
                self.assertEqual([x for x in bless.check() if x.startswith("settings_write:")], [])
                (tmp / "tests" / src.name).write_text(src.read_text(encoding="utf-8") + "# 1 字\n", encoding="utf-8")
                self.assertTrue(any("settings_write: 元" in x for x in bless.check()))
            finally:
                bless.PROGRAM = old
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_two_blesses_compare_without_offsets_and_random_ids(self):
        t = {"oracle": {}, "answers": {"k": 1}, "variants": None,
             "scene": {"files": {"a": {"blob": "h1", "mtime": "@NOW(-5ms)"}}, "dirs": {}, "links": {},
                       "blobs": {"h1": {"text": "@NOW(-5ms,T,s) 0123456789abcdef0123456789abcdef"}}}}
        u = json.loads(json.dumps(t).replace("-5ms", "-900ms").replace("0123456789abcdef0123456789abcdef", "f" * 32))
        self.assertIsNone(bless.first_diff(bless.comparable(t), bless.comparable(u)))
        u["answers"]["k"] = 2
        self.assertIsNotNone(bless.first_diff(bless.comparable(t), bless.comparable(u)))


if __name__ == "__main__":
    unittest.main()
