# -*- coding: utf-8 -*-
"""脆弱性の確認（2026-10-23）で直した所の試験（版 3.52.1）。ほかの所の試験: 記録を消す〈test_access.Presence〉・
LotDsp のブラウザ〈test_lotdsp_direct〉・重すぎる正規表現と長すぎる答え〈test_formula_parity〉・画面の XSS と CSP〈tools/ui-eval-xss.mjs〉"""
import sqlite3
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path

from app.services import formula, lot_list, sqlite_ro
from app.web import csp, foreign_request


class Identifiers(unittest.TestCase):
    def test_any_column_name_is_one_identifier(self):
        """列名に ] や " があっても 1 つの識別子（前の [ ] では ] を逃がせず、その表を開けなかった）"""
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.sqlite3"
            c = sqlite3.connect(p)
            names = ["a]b", 'x"y', "普通", "[c]", "d'); DROP TABLE t; --"]
            c.execute("CREATE TABLE t (" + ", ".join(sqlite_ro.qi(n) + " TEXT" for n in names) + ")")
            c.execute("INSERT INTO t VALUES (?, ?, ?, ?, ?)", ["1", "2", "3", "4", "5"])
            c.commit()
            c.close()
            with sqlite_ro.connect_ro(p) as r:
                got = r.execute("SELECT " + ", ".join(sqlite_ro.qi(n) for n in names) + " FROM t").fetchone()
                cols = [x[1] for x in r.execute("PRAGMA table_info(t)")]
                trusted = r.execute("PRAGMA trusted_schema").fetchone()[0]
            self.assertEqual(list(got), ["1", "2", "3", "4", "5"])
            self.assertEqual(cols, names, "名前はそのまま（表は消えていない）")
            self.assertEqual(trusted, 0, "細工したファイルの定義から関数を呼ばせない")


class Limits(unittest.TestCase):
    def test_huge_day_counts_do_not_fail(self):
        today = date(2026, 10, 23)
        for v in ("1e400", "1e10", "-5", "x", "99999999"):
            lot_list.cutoff_date(next(iter(lot_list.RELATIVE_OPS)), v, today)    # 500 にならない（OverflowError を出さない）

    def test_heavy_regex_is_refused_quickly(self):
        t0 = time.perf_counter()
        for src in ("match([a], '(.*.*)*!')", "match([a], '(a+)+b')", "match([a], '(?:x*)+')"):
            self.assertFalse(formula.check(src)["ok"], src)
        self.assertLess(time.perf_counter() - t0, 1.0, "読む時に断る（数え始めない）")
        self.assertTrue(formula.check("match([a], '^[A-Z]+-[0-9]+$')")["ok"], "ふつうの正規表現は使える")
        self.assertIsNone(formula.Formula("match([a], 'b')").run(lambda c: "x" * 3000), "長すぎる字は調べない（その行は空）")
        self.assertIsNone(formula.Formula("replace(rept([a], 1000), '', rept([a], 1000))").run(lambda c: "xx"), "答えが長すぎればその行は空")
        self.assertFalse(formula.check("(" * 700 + "1" + ")" * 700)["ok"], "深すぎる入れ子は理由つきで断る（500 にしない）")


class DevServer(unittest.TestCase):
    def test_foreign_pages_are_refused(self):
        self.assertEqual(foreign_request("GET", "127.0.0.1:5000", None, 5000), "")
        self.assertEqual(foreign_request("POST", "localhost:5000", "http://localhost:5000", 5000), "")
        self.assertTrue(foreign_request("GET", "evil.example:5000", None, 5000), "DNS の付け替え（よその名前）")
        self.assertTrue(foreign_request("POST", "127.0.0.1:5000", "http://evil.example", 5000), "よその頁からの書き込み（CSRF）")

    def test_screen_has_csp_with_the_same_nonce(self):
        from app import create_app
        app = create_app()
        app.config["TESTING"] = True
        r = app.test_client().get("/")
        policy = r.headers.get("Content-Security-Policy") or ""
        html = r.get_data(as_text=True)
        nonce = policy.split("'nonce-")[1].split("'")[0] if "'nonce-" in policy else ""
        self.assertTrue(nonce and f'<script nonce="{nonce}">' in html, "画面の <script> は CSP の印つき")
        self.assertNotIn("<script>", html, "印の無いインラインの <script> は無い（CSP で止まる）")
        self.assertIn("object-src 'none'", csp("x"))
        self.assertNotEqual(nonce, (app.test_client().get("/").headers.get("Content-Security-Policy") or "").split("'nonce-")[1].split("'")[0],
                            "印は問い合わせごとに変わる")


if __name__ == "__main__":
    unittest.main()
