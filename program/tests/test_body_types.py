"""本文の欄の型と中身の欄の門（版 3.106.0。Rust 化の段 ① の D2・A2。services/body_rules.py の TYPES・check_types・read_inner）。

事例の表 tests/fixtures/body_type_cases.json（仕様から人が書いた答え）を Python の門（body_rules.gate。道は app.rule_for と同じに当てる）が
同じに答えるか。窓は cargo test --test body_cases（types_like_the_table）で同じ表を読む。記録だけの形（TPA_BODY_TYPES_LOG）は断らずに書く。
"""
import json
import logging
import os
import tempfile
import unittest
from pathlib import Path
from urllib.parse import unquote

from app.services import body_rules

TABLE = Path(__file__).resolve().parent / "fixtures" / "body_type_cases.json"
_APP = None


def app():
    global _APP
    if _APP is None:
        from app import create_app
        level = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            _APP = create_app({"TESTING": True})
        finally:
            logging.disable(level)
    return _APP


def gate(method, path, raw, log=None):
    rule = app().rule_for(method, unquote(path))
    if rule is None:
        return {"ok": True}
    try:
        body_rules.gate(method, rule.pattern, raw.encode("utf-8"), log)
    except body_rules.BodyError as e:
        return {"error": str(e)}
    return {"ok": True}


class TypeCases(unittest.TestCase):
    def test_cases(self):
        cases = json.loads(TABLE.read_text(encoding="utf-8"))["cases"]
        self.assertGreater(len(cases), 60)
        bad = [f"{c['name']}: 表 {c['want']} / Python {got}" for c in cases if (got := gate(c["method"], c["path"], c["raw"])) != c["want"]]
        self.assertEqual(bad, [])

    def test_passed_bodies_read_the_same(self):
        """窓が部品へ渡す本文（中身の字の整数の -0 を 0 に書き直した物）は、Python の json.loads で元の本文と同じ値（独立の答え）"""
        for c in json.loads(TABLE.read_text(encoding="utf-8"))["cases"]:
            for k, text in (c.get("passed") or {}).items():
                before = json.loads(json.loads(c["raw"])[k])
                self.assertEqual(json.dumps(json.loads(text)), json.dumps(before), c["name"])

    def test_every_route_with_types_has_a_mode(self):
        """欄の型は門を当てる道（ROUTES）にだけ書く（門の無い道の型は当たらない）"""
        for key in body_rules.TYPES:
            self.assertIn(key, body_rules.ROUTES, key)
            for path, kind in body_rules.TYPES[key]:
                self.assertIn(kind, body_rules.TYPE_NAMES, (key, path))
                if kind == body_rules.J:
                    self.assertNotIn(".", path, "中身の欄は表の上の段だけ")

    def test_record_only_mode_does_not_refuse(self):
        """記録だけの形: 欄の型の違いは断らずに 1 行ずつ書く（中身の欄の門〈NaN など〉は今どおり断る）"""
        with tempfile.TemporaryDirectory() as d:
            dest = os.path.join(d, "types.jsonl")
            os.environ[body_rules.TYPES_LOG_ENV] = dest
            try:
                log = body_rules.types_log()
                self.assertEqual(gate("POST", "/api/card-forms", '{"name": ["x"], "note": {"a": 1}}', log), {"ok": True})
                self.assertEqual(gate("POST", "/api/card-forms", '{"name": "a", "body": "{\\"w\\": NaN}"}', log)["error"], body_rules.E_NONFINITE)
            finally:
                del os.environ[body_rules.TYPES_LOG_ENV]
            lines = [json.loads(x) for x in Path(dest).read_text(encoding="utf-8").splitlines()]
            self.assertEqual([(x["path"], x["got"]) for x in lines], [("name", "list"), ("note", "dict")])
        self.assertIsNone(body_rules.types_log())


if __name__ == "__main__":
    unittest.main()
