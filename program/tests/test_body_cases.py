"""本文の読み方の事例表（tests/fixtures/body_cases.json。版 3.104.0）を Python の部品（services/body_rules.read_body）が同じに読むか。
窓は cargo test --test body_cases で同じ表と突き合わせる。表は仕様から人が書いた答え（Python の答えを焼いた物ではない）。"""
import json
import unittest
from pathlib import Path

from app.services import body_rules

TABLE = Path(__file__).resolve().parent / "fixtures" / "body_cases.json"
RULES = {"read": body_rules.GATE_READ, "need": body_rules.GATE_NEED, "lotdsp": body_rules.LOTDSP}


class BodyCases(unittest.TestCase):
    def test_cases(self):
        cases = json.loads(TABLE.read_text(encoding="utf-8"))["cases"]
        self.assertGreater(len(cases), 40)
        bad = []
        for c in cases:
            raw = bytes.fromhex(c["hex"]) if "hex" in c else c["raw"].encode("utf-8")
            for mode, want in c["want"].items():
                try:
                    got = {"ok": json.dumps(body_rules.read_body(raw, RULES[mode]), ensure_ascii=False)}
                except body_rules.BodyError as e:
                    got = {"error": str(e)}
                if got != want:
                    bad.append(f"{c['name']} [{mode}]: 表 {want} / Python {got}")
        self.assertEqual(bad, [])

    def test_every_case_names_all_three_rules(self):
        for c in json.loads(TABLE.read_text(encoding="utf-8"))["cases"]:
            self.assertEqual(set(c["want"]), {"read", "need", "lotdsp"}, c["name"])


if __name__ == "__main__":
    unittest.main()
