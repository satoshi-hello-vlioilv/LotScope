"""変換表の式の入れ子の数え方（formula.nest_count・conversions.NEST_MAX。版 3.106.0）が事例の表 tests/fixtures/nest_cases.json と同じか。
窓は cargo test --test nest_cases。同梱の変換表の式の段は上限より十分小さいことも見る。"""
import json
import unittest
from pathlib import Path

from app.services import conversions, formula

FIX = Path(__file__).resolve().parent / "fixtures"


class NestCases(unittest.TestCase):
    def test_cases(self):
        t = json.loads((FIX / "nest_cases.json").read_text(encoding="utf-8"))
        self.assertEqual(t["max"], conversions.NEST_MAX)
        bad = [f"{c['name']}: 表 {c['count']} / Python {formula.nest_count(c['src'])}" for c in t["cases"] if formula.nest_count(c["src"]) != c["count"]]
        self.assertEqual(bad, [])

    def test_bundled_tables_are_far_below_the_limit(self):
        rows = json.loads((Path(conversions.__file__).resolve().parents[1] / "master_defaults" / "conversions.json").read_text(encoding="utf-8"))
        rows = rows["rows"] if isinstance(rows, dict) else rows
        most = 0
        for r in rows:
            for v in r.values():
                for s in [v] + [x.get("out", "") for x in (json.loads(v) if isinstance(v, str) and v.startswith("[") else []) if isinstance(x, dict)]:
                    if isinstance(s, str) and s.startswith("="):
                        most = max(most, formula.nest_count(s[1:]))
        self.assertLess(most, conversions.NEST_MAX // 4, most)

    def test_the_limit_is_readable_by_python(self):
        """上限ちょうどの式は、Python の道の中（再帰の上限の手前）で読める"""
        formula.compile_formula("(" * conversions.NEST_MAX + "1" + ")" * conversions.NEST_MAX)


if __name__ == "__main__":
    unittest.main()
