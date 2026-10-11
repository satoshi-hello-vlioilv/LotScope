"""画面の改良案の評価関数（tools/ui_score.py）: 決め方（CLAUDE.md の「UI/UX を変えるときは…」）どおりに判定するか。"""
import importlib.util
import json
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("ui_score", Path(__file__).resolve().parents[1] / "tools" / "ui_score.py")
ui = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ui)


def scores(n):
    return [n] * len(ui.WEIGHTS)


def first(top, second=None):
    """1 回目（7 案。F・G は方向の違う 2 案）"""
    props = {"A": top, "B": second or scores(5), "C": scores(4), "D": scores(4), "E": scores(3), "F": scores(3), "G": scores(2)}
    return {"name": "1 回目", "proposals": props, "added": ["F", "G"]}


class UiScore(unittest.TestCase):
    def test_weights_and_margin(self):
        self.assertEqual(len(ui.CRITERIA), 7)
        self.assertEqual(sum(ui.WEIGHTS), 100, "100 点満点")
        self.assertAlmostEqual(ui.MARGIN, 10.95, places=2)   # CLAUDE.md の「僅差の幅 11 点」
        self.assertEqual((ui.PROPOSALS, ui.COMPOSITES, ui.KEEP, ui.GOOD), (7, 4, 3, 80), "CLAUDE.md の 7 案・複合 4 案＋上位 3 案・80 点")
        self.assertEqual(ui.total(scores(10)), 100)
        with self.assertRaises(ValueError):
            ui.total([5, 5])

    def test_good_clear_winner_is_chosen_in_the_first_round(self):
        kind, who, _ = ui.decide([first(scores(9))])
        self.assertEqual((kind, who), ("選ぶ", "A"))

    def test_low_winner_goes_to_the_second_round(self):
        kind, who, _ = ui.decide([first(scores(7), scores(4))])   # 差は大きいが 70 点
        self.assertEqual((kind, who), ("比べ直す", ["A", "B", "C"]), "1 位でも点が低ければ、上位 3 案を残して比べ直す")

    def test_close_call_goes_to_the_second_round_and_then_decides(self):
        one = first(scores(9), [9, 9, 9, 9, 9, 9, 8])
        kind, who, _ = ui.decide([one])
        self.assertEqual((kind, who), ("比べ直す", ["A", "B", "C"]), "僅差なら上位 3 案を残して比べ直す")
        two = {"name": "2 回目", "proposals": {"A": scores(9), "B": [9, 9, 9, 9, 9, 9, 8], "C": scores(4),
                                              "W1": [9, 9, 9, 9, 9, 8, 9], "W2": scores(7), "W3": scores(6), "W4": scores(5)}}
        kind, who, _ = ui.decide([one, two])
        self.assertEqual((kind, who), ("選ぶ", "A"), "2 回目は僅差でも 1 位に決める")
        two["proposals"]["W1"] = [10, 9, 9, 9, 9, 8, 8]   # A と同じ 90 点・重い基準（次の行動）が高い
        self.assertEqual(ui.decide([one, two])[1], "W1", "同じ点なら重い基準の点が高い方")

    def test_rounds_must_follow_the_rule(self):
        with self.assertRaisesRegex(ValueError, "7 案"):
            ui.decide([{"name": "1 回目", "proposals": {"A": scores(9), "B": scores(1)}, "added": []}])
        no_added = first(scores(9))
        del no_added["added"]
        with self.assertRaisesRegex(ValueError, "方向の違う 2 案"):
            ui.decide([no_added])
        one = first(scores(7))
        with self.assertRaisesRegex(ValueError, "上位 3 案"):
            ui.decide([one, {"name": "2 回目", "proposals": {"A": scores(8), "B": scores(7), "X": scores(6), "Y": scores(5),
                                                            "Z": scores(4), "W": scores(4), "V": scores(3)}}])
        with self.assertRaisesRegex(ValueError, "複合案は 4 つ"):
            ui.decide([one, {"name": "2 回目", "proposals": {"A": scores(8), "B": scores(7), "C": scores(6), "D": scores(5),
                                                            "X": scores(4), "Y": scores(4), "Z": scores(3)}}])

    def test_old_records_still_read(self):
        """決まりの前の記録（5 案）も読める（組み方は確かめない）"""
        for path in (Path(__file__).resolve().parents[1] / "tools" / "ui-proposals").glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            kind, _, _ = ui.decide(data["rounds"], strict=not data.get("record"))
            self.assertIn(kind, ("選ぶ", "比べ直す"), path.name)


if __name__ == "__main__":
    unittest.main()
