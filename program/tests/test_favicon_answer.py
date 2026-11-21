"""窓が GET /favicon.ico に答える 404 の画面（版 3.118.1。desktop/src/small_reads.rs の NOT_FOUND_HTML）が、版 3.117.3 の Python
（凍らせた写し tests/legacy/3.117.3/app/web.py の NotFound。Werkzeug と同じ字）の本文と 1 バイトも違わないか。
写しの web.py を単独で読む（app は import しない・写しに __pycache__ を書かない）。"""
import importlib.util
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
RS = HERE.parents[1] / "desktop" / "src" / "small_reads.rs"
FROZEN_WEB = HERE / "legacy" / "3.117.3" / "app" / "web.py"


def frozen_web():
    spec = importlib.util.spec_from_file_location("frozen_web_3117", FROZEN_WEB)
    mod = importlib.util.module_from_spec(spec)
    keep, sys.dont_write_bytecode = sys.dont_write_bytecode, True
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = keep
    return mod


def rust_const(text: str, name: str) -> str:
    m = re.search(rf'pub const {name}: &str = "((?:[^"\\]|\\.)*)";', text, re.DOTALL)
    assert m, name
    raw = re.sub(r"\\\n\s*", "", m.group(1))     # 行の終わりの \ は次の行の頭の空白ごと消える（Rust の決まり）
    return raw.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")


class FaviconAnswer(unittest.TestCase):
    def test_the_window_answers_the_flask_404_page(self):
        r = frozen_web().NotFound().response()
        self.assertEqual((r.status_code, r.headers["Content-Type"]), (404, "text/html; charset=utf-8"))
        text = RS.read_text(encoding="utf-8")
        self.assertEqual(rust_const(text, "NOT_FOUND_HTML").encode("utf-8"), r.get_data())
        self.assertIn('"text/html; charset=utf-8"', text, "窓も同じ Content-Type")


if __name__ == "__main__":
    unittest.main()
