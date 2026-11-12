# -*- coding: utf-8 -*-
"""窓が Python に任せる歩の予算（tests/fixtures/delegates_budget.json）が、いまの数と合うか（版 3.105.0。作った後の採点の落とし穴 5）。

突き合わせの試験の「任せた歩の下限」（delegated >= N）は外した（任せる歩は 0 へ減らしていく数で、減らすたびに落ちたため）。上限は窓の試験
（desktop/tests/common.rs の check_budget）が見るが、減らした版で予算を下げ忘れても上限なので通る。ここで tools/delegate-count.py の数え方で
19 の答えの元を流し、予算を超えた・予算より減った（下げ忘れ）を止める。環境で増える幅 envExtra・減る幅 envLess は同じとみなす。"""
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("delegate_count", PROGRAM / "tools" / "delegate-count.py")
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)


class Budget(unittest.TestCase):
    def test_counts_match_the_budget(self):
        work = Path(tempfile.mkdtemp())
        try:
            got = dc.count(dc.run(work))
        finally:
            shutil.rmtree(work, ignore_errors=True)
        self.assertEqual(dc.check(got["per"]), [], "任せる歩の数が予算と違う")

    def test_check_finds_a_budget_left_high_and_a_new_delegate(self):
        budget = {"per": {"a_oracle": 5, "b_oracle": 3, "c_oracle": 11}, "envExtra": {"b_oracle": 1}, "envLess": {"c_oracle": 2}}
        per = {"a_oracle": {"x": 4}, "b_oracle": {"x": 4}, "c_oracle": {"x": 9}}
        bad = dc.check(per, budget)
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("予算を下げる", bad[0], "減ったのに予算を下げていない（a）。b は環境で増える幅・c は減る幅の中")
        bad = dc.check({**per, "a_oracle": {"x": 5}, "b_oracle": {"x": 5}}, budget)
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("予算を上げる", bad[0], "幅を超えて増えた（b）")


if __name__ == "__main__":
    unittest.main()
