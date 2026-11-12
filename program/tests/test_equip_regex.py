# -*- coding: utf-8 -*-
"""設備グループの正規表現の書き方（版 3.102.0。services/equip_regex.py）。窓の cargo test --test equip_regex_cases と同じ表を読む。

物差し: tests/fixtures/equip_regex_cases.json（tools/equip-regex-cases.py が仕様〈人が書いた判定〉と同梱と同じ Python の re から作る。
app を使うのは理由の言葉だけ）。
  ① 判定（ok・unsupported・invalid）と理由の言葉が表と同じ
  ② ok の形は、設備グループの当て方（pivot.compile_rules）の当たりが Python の re の答え（表の hits）と同じ
  ③ ok でない形は当てない（同じグループのほかの決まりは当てる）・保存は理由を添えて断る
  ④ 表が古くない（作り直した物と同じ）
"""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from app.services import equip_groups, equip_regex, pivot

PROGRAM = Path(__file__).resolve().parents[1]
TABLE = json.loads((PROGRAM / "tests" / "fixtures" / "equip_regex_cases.json").read_text(encoding="utf-8"))


class EquipRegex(unittest.TestCase):
    def test_verdicts_and_words_are_like_the_table(self):
        for c in TABLE["cases"]:
            with self.subTest(p=c["pattern"]):
                self.assertEqual(equip_regex.check(c["pattern"]), (c["verdict"], c["why"]))

    def test_hits_are_like_python_re(self):
        names = TABLE["names"]
        for c in TABLE["cases"]:
            p = c["pattern"]
            with self.subTest(p=p):
                if c["verdict"] == "ok":
                    test = pivot.compile_rules([{"op": "regex", "value": p}])
                    self.assertEqual([test(n) for n in names], c["hits"])
                    continue
                test = pivot.compile_rules([{"op": "regex", "value": p}, {"op": "equals", "value": "CAL"}])
                self.assertEqual([n for n in names if test(n)], ["CAL"], "当てない書き方は外し、ほかの決まりは当てる")
                with self.assertRaises(equip_groups.GroupError):
                    equip_groups.clean_rules([{"op": "regex", "value": p}])

    def test_table_is_fresh(self):
        # 道具は日本語を出す。Windows の既定（cp1252）で読むと読み取りの糸が落ちて stdout が None になるので、子に UTF-8 で書かせ UTF-8 で読む
        r = subprocess.run([sys.executable, str(PROGRAM / "tools" / "equip-regex-cases.py"), "--check"], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
