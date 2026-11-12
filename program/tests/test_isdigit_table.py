"""Python の str.isdigit() が真の字の表（desktop/src/isdigit_table.rs。版 3.106.0）が、いまの Python と同じか。
窓の pyfmt::is_digit はこの表で、すぐに見るの id の字を Python の clean_quick と同じに読む（cargo test --test presets_parity）。"""
import importlib.util
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("isdigit_table", PROGRAM / "tools" / "isdigit-table.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        self.assertEqual(tool.OUT.read_text(encoding="utf-8"), tool.text(), "python program/tools/isdigit-table.py で作り直す")

    def test_known_characters(self):
        rs = tool.ranges()
        inside = lambda c: any(a <= c <= b for a, b in rs)  # noqa: E731
        # 「0」・全角の「５」・「²」・丸数字「①」・アラビア文字の「١」は真、「½」・「Ⅷ」・「a」・「〇」は偽（isdigit。isnumeric とは違う）
        self.assertEqual([inside(ord(c)) for c in "0５²①١½Ⅷa〇"], [True, True, True, True, True, False, False, False, False])


if __name__ == "__main__":
    unittest.main()
