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

    def test_python_reads_like_the_wanted_answer(self):
        """版 3.113.0（採点の指摘 5）: Python の答え ok が正しい答え want（画面が読み、サーバーも計算できる）と同じ。画面だけが読む形は断る"""
        import json
        cases = json.loads(tool.OUT.read_text(encoding="utf-8"))["cases"]
        bad = [c["pattern"] for c in cases if c["ok"] != c["want"]]
        self.assertEqual(bad, [], "Python が正しい答えと割れる形")
        # 版 3.113.0 の作った後の直し: 画面も後読みの決まりで断る（画面だけが読む形は無い）。後読みの断る形は人の決め SPEC_LOOKBEHIND にある
        self.assertEqual([c["pattern"] for c in cases if c["js"] != c["want"]], [])
        self.assertGreaterEqual(sum(1 for v in tool.SPEC_LOOKBEHIND.values() if not v), 10, "断る後読みの形")
        lb = [c for c in cases if "(?<" in c["pattern"] and not c["want"] and c["pattern"] in tool.SPEC_LOOKBEHIND]
        self.assertTrue(all("長さの決まる形だけ" in c["why"] and "長さの決まる形だけ" in c["jsWhy"] for c in lb), "断る言葉は日本語の 1 つ")


class SplitLookbehind(unittest.TestCase):
    """枝の長さの違う後読みの書き替え（formula.split_lookbehind）: 意味は元の形（JavaScript）と同じ"""

    def test_branches_match_like_javascript(self):
        import sys
        sys.path.insert(0, str(PROGRAM))
        from app.services.formula import js_regex
        text = "L1 CR2 ABC3 x9 CC4 B5 CD6 a|be"
        for src, want in [("(?<=L|CR)\\d", ["1", "2"]), ("(?<!L|CR)\\d", ["3", "9", "4", "5", "6"]),
                          ("(?<=L|CR|ABC)\\d", ["1", "2", "3"]), ("(?<=[AB]|CD)\\d", ["5", "6"]), ("(?<=L|C{2})\\d", ["1", "4"]),
                          ("(?<=a\\|b|cd)e", ["e"])]:
            with self.subTest(src=src):
                self.assertEqual([m.group(0) for m in js_regex(src).finditer(text)], want)


if __name__ == "__main__":
    unittest.main()
