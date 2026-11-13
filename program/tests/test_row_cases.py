# -*- coding: utf-8 -*-
"""置き場の読めない行を隔てる決まり（版 3.107.0。services/row_check と master_repository.isolated）を、人が仕様から書いた事例の表
tests/fixtures/row_cases.json と突き合わせる。窓は desktop/tests/row_cases.rs が同じ表を読む（cargo test --test row_cases）。"""
import json
import sys
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app.repositories import master_repository as mr  # noqa: E402
from app.services import row_check  # noqa: E402

CASES = json.loads((PROGRAM / "tests" / "fixtures" / "row_cases.json").read_text(encoding="utf-8"))["cases"]


def why_of(case):
    row = json.loads(case["raw"])
    rows = [mr._normalize(row, mr.SPECS[case["master"]]) if isinstance(row, dict) else row]
    got = mr.isolated(case["master"], rows)
    return next(iter(got.values()))[1] if got else None


class RowCases(unittest.TestCase):
    def test_every_case(self):
        bad = [f"{c['name']}: Python {why_of(c)!r}（表 {c['why']!r}）" for c in CASES if why_of(c) != c["why"]]
        self.assertEqual(bad, [])

    def test_coerced_values(self):
        """隔てない行の、名前の列・字だけの列の字でない値は str() で読む（一覧に出す行。割れ 1）"""
        bad = []
        for c in CASES:
            if "coerced" not in c:
                continue
            row = mr._normalize(json.loads(c["raw"]), mr.SPECS[c["master"]])
            got = row_check.coerce(c["master"], row)
            for k, want in c["coerced"].items():
                if got.get(k) != want:
                    bad.append(f"{c['name']}: {k} は {got.get(k)!r}（表 {want!r}）")
        self.assertEqual(bad, [])

    def test_the_table_covers_every_rule(self):
        """表は決まりの全部の言葉を少なくとも 1 回ずつ持つ（決まりを足したら事例も足す）"""
        whys = " ".join(c["why"] or "" for c in CASES)
        for word in ["表でない行", "id が数ではありません", "版（rev）が読めません", "に数でない値（NaN・Infinity）があります",
                     "に対の無い代用字があります", "の入れ子が深すぎます", "数でない値（NaN・Infinity）があります", "対の無い代用字があります",
                     "の形が違います", "が表ではありません", "の part が並び・表です", "column・expr", "タブの名前", "項目の字の欄",
                     "が並び・表です（", "が字ではありません"]:
            self.assertIn(word, whys)
        self.assertTrue(any(c["why"] is None for c in CASES))

    def test_next_id_counts_isolated_rows(self):
        """次の id は隔てた行の id も int() が読めれば数える（字の "4"・小数の 1e19）。読めない id は数えない（前は ValueError）"""
        from app.repositories.master_store import next_id
        self.assertEqual(next_id([{"id": 1}, {"id": "4"}, {"id": "abc"}, {"id": ["x"]}]), 5)
        self.assertEqual(next_id([{"id": 1e19}]), 10000000000000000001)
        self.assertEqual(next_id([{"id": True}, {"id": None}]), 2)

    def test_skipped_text(self):
        sk = [{"row": i, "why": "w"} for i in range(1, 6)]
        self.assertEqual(row_check.skipped_text("dashboards", sk[:1]), "dashboards.json の 1 行目（w）が読めません")
        self.assertEqual(row_check.skipped_text("dashboards", sk), "dashboards.json の 1 行目（w）・2 行目（w）・3 行目（w） ほか 2 行が読めません")


if __name__ == "__main__":
    unittest.main()
