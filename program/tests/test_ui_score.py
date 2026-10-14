"""改良案の評価関数（tools/ui_score.py）: 決め方（CLAUDE.md の「改良するときは…」）どおりに判定するか。"""
import importlib.util
import json
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("ui_score", Path(__file__).resolve().parents[1] / "tools" / "ui_score.py")
ui = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ui)


def entry(n, minus=(), **override):
    """全項目 n 点（override で項目ごとに変える）・減点の種類の並び"""
    return {"score": {k: override.get(k, n) for k in ui.KEYS}, "minus": [{"kind": k, "where": "画像のどこか"} for k in minus], "seen": "見えたこと"}


def round_(name, *entries, names=None):
    names = names or "ABCDEFG"
    return {"name": name, "proposals": {names[i]: e for i, e in enumerate(entries)}}


def data(*rounds):
    return {"title": "試し", "evaluator": "別のエージェント", "rounds": list(rounds)}


class UiScore(unittest.TestCase):
    def test_points(self):
        self.assertEqual(sum(ui.WEIGHT.values()), 100, "加点は 100 点満点")
        self.assertEqual(ui.GROUPS, ["わかりやすさ", "使いやすさ", "統一感", "美しさ"], "CLAUDE.md の 4 分類")
        self.assertEqual((ui.PASS, ui.MIN_PROPOSALS, ui.MIN_NEW, ui.MAX_ROUNDS), (95, 5, 3, 3), "CLAUDE.md の 95 点・5 案以上・新しい案 3 案・3 回")
        self.assertEqual(ui.total(entry(10)), 100)
        self.assertEqual(ui.total(entry(10, minus=("cut", "wrap"))), 92, "見切れ −5・折り返し −3")
        self.assertEqual(ui.total(entry(0, minus=("lost",))), 0, "0 点より下にはしない")
        with self.assertRaisesRegex(ValueError, "11 項目"):
            ui.total({"score": {"order": 5}})
        with self.assertRaisesRegex(ValueError, "where"):
            ui.total({"score": entry(9)["score"], "minus": [{"kind": "cut"}]})
        with self.assertRaisesRegex(ValueError, "減点の種類"):
            ui.total({"score": entry(9)["score"], "minus": [{"kind": "ugly", "where": "x"}]})

    def test_winner_at_95_is_chosen(self):
        kind, who, _ = ui.decide(data(round_("1 回目", entry(9), entry(10), entry(8), entry(7), entry(6))))
        self.assertEqual((kind, who), ("選ぶ", "B"))

    def test_below_95_starts_over_with_new_proposals(self):
        one = round_("1 回目", entry(9), entry(8), entry(7), entry(6), entry(5))
        kind, who, _ = ui.decide(data(one))
        self.assertEqual((kind, who), ("出し直す", "A"), "90 点では決めない")
        # やり直しは新しい案を 3 案以上。前の案を 3 案持ち越して新しい案が 2 案では足りない
        two = round_("2 回目", entry(9), entry(8), entry(7), entry(10), entry(9), names="ABCXY")
        with self.assertRaisesRegex(ValueError, "新しい案を 3 案以上"):
            ui.decide(data(one, two))
        two = round_("2 回目", entry(9), entry(10), entry(9), entry(8), entry(7), names="AXYZW")
        self.assertEqual(ui.decide(data(one, two))[:2], ("選ぶ", "X"))

    def test_third_round_decides_even_below_95(self):
        r = [round_(f"{i + 1} 回目", entry(9), entry(8), entry(8), entry(7), entry(6), names=[f"{i}{c}" for c in "ABCDE"]) for i in range(3)]
        self.assertEqual(ui.decide(data(*r))[:2], ("届かずに選ぶ", "2A"), "3 回で届かなければ 1 位に決め、足りない点を伝える")
        with self.assertRaisesRegex(ValueError, "3 回まで"):
            ui.decide(data(*r[:2], round_("3 回目", entry(9), entry(8), entry(8), entry(7), entry(6), names="VWXYZ"),
                           round_("4 回目", entry(10), entry(9), entry(9), entry(9), entry(9), names="PQRST")))

    def test_ties_go_to_the_heavier_group(self):
        # どちらも 98 点: A は統一感を、B は使いやすさを 2 点落とす（使いやすさの方が重い分類）
        a = entry(10, form=8)
        b = entry(10, steps=8)
        self.assertEqual(ui.total(a), ui.total(b))
        self.assertEqual(ui.decide(data(round_("1 回目", b, a, entry(5), entry(5), entry(5), names="BACDE")))[1], "A")

    def test_rules(self):
        with self.assertRaisesRegex(ValueError, "5 案以上"):
            ui.decide(data(round_("1 回目", entry(10), entry(9))))
        blind = round_("1 回目", entry(10), entry(9), entry(8), entry(7), entry(6))
        del blind["proposals"]["C"]["seen"]
        with self.assertRaisesRegex(ValueError, "seen"):
            ui.decide(data(blind))
        nobody = data(round_("1 回目", entry(10), entry(9), entry(8), entry(7), entry(6)))
        del nobody["evaluator"]
        with self.assertRaisesRegex(ValueError, "別のエージェント"):
            ui.decide(nobody)

    def test_old_records_still_read(self):
        """旧い決まり（7 基準の数の並び）の記録も読める（判定はしない）"""
        for path in (Path(__file__).resolve().parents[1] / "tools" / "ui-proposals").glob("*.json"):
            d = json.loads(path.read_text(encoding="utf-8"))
            kind, _, _ = ui.decide(d)
            self.assertIn(kind, ("記録", "選ぶ", "届かずに選ぶ", "出し直す"), path.name)


if __name__ == "__main__":
    unittest.main()
