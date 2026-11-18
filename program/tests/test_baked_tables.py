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

    def test_every_table_is_checked_even_the_parts(self):
        """部分の表（本.部分.json）も確かめる（版 3.115.0 の作った後の直し: 前は 本.json だけを見て、部分の表の答えを消しても通った）"""
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            self.assertEqual(bless.check(tmp), [])
            parts = [n for n in bless.tables(tmp) if "." in n]
            self.assertGreaterEqual(len(parts), 5, parts)
            for name in parts:
                with self.subTest(name):
                    t = json.loads((tmp / f"{name}.json").read_text(encoding="utf-8"))
                    keep = json.dumps(t, ensure_ascii=False)
                    t.pop("answers")
                    (tmp / f"{name}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
                    self.assertTrue(any(x.startswith(f"{name}:") for x in bless.check(tmp)), "答えを消した部分の表")
                    t = json.loads(keep)
                    t["sources"] = {k: "0" * 16 for k in t["sources"]}
                    (tmp / f"{name}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
                    self.assertTrue(any(x.startswith(f"{name}: 元") for x in bless.check(tmp)), "指紋を壊した部分の表")
                    (tmp / f"{name}.json").write_text(keep, encoding="utf-8")
            (tmp / "知らない本.json").write_text("{}", encoding="utf-8")
            self.assertTrue(any("知らない本" in x for x in bless.check(tmp)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_near_dates_in_the_sources_stop_the_bless(self):
        """答え合わせ役の元に今日に近い固定の日付があれば焼かない（時限の爆弾にしない）"""
        import datetime as dt
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "tests").mkdir()
            (tmp / "tests" / "settings_write_oracle.py").write_text(f"X = '{dt.date.today():%Y-%m-%d}'\nY = '2001-01-01'\n", encoding="utf-8")
            (tmp / "tests" / "oracle_gate.py").write_text("", encoding="utf-8")
            old = bless.PROGRAM
            bless.PROGRAM = tmp
            try:
                near = bless.near_dates("settings_write")
            finally:
                bless.PROGRAM = old
            self.assertEqual(len(near), 1, near)
            self.assertEqual([x for b in bless.BOOKS for x in bless.near_dates(b)], [], "今の元には近い日付が無い")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_two_blesses_compare_without_offsets_and_random_ids(self):
        t = {"oracle": {}, "answers": {"k": 1}, "variants": None,
             "scene": {"files": {"a": {"blob": "h1", "mtime": "@NOW(-5ms)"}}, "dirs": {}, "links": {},
                       "blobs": {"h1": {"text": "@NOW(-5ms,T,s) 0123456789abcdef0123456789abcdef"}}}}
        t["answers"]["t"] = "@T(Ts|-12)"
        u = json.loads(json.dumps(t).replace("-5ms", "-900ms").replace("0123456789abcdef0123456789abcdef", "f" * 32).replace("|-12)", "|30)"))
        self.assertIsNone(bless.first_diff(bless.comparable(t), bless.comparable(u)))
        u["answers"]["k"] = 2
        self.assertIsNotNone(bless.first_diff(bless.comparable(t), bless.comparable(u)))


if __name__ == "__main__":
    unittest.main()
