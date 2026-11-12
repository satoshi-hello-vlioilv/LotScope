"""Python の str.isprintable() が偽の字の表（desktop/src/printable_table.rs。版 3.104.0）が、いまの Python と同じか。
窓の pyfmt::str_repr はこの表で Python の repr と同じに逃がす（cargo test --test pynum_cases が誤りの文を突き合わせる）。"""
import importlib.util
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("printable_table", PROGRAM / "tools" / "printable-table.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(), "python program/tools/printable-table.py で作り直す")

    def test_known_characters(self):
        rs = tool.ranges()
        inside = lambda c: any(a <= c <= b for a, b in rs)  # noqa: E731
        self.assertEqual([inside(c) for c in (0x1C, 0x3000, 0x85, 0x200B, 0x7F, 0xE0001, 0x20, 0x41, 0x3042)],
                         [True, True, True, True, True, True, False, False, False])


if __name__ == "__main__":
    unittest.main()
