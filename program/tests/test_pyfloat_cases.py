"""小数の字の事例表（tests/fixtures/pyfloat_cases.json。版 3.80.0）が、いまの Python の答えと同じか。
窓（desktop/src/pyfmt.rs の float_repr・join.rs の py_dumps）は cargo test --test pyfloat_cases で同じ表と突き合わせる。
表が古ければ python tools/pyfloat-cases.py で作り直す。"""
import importlib.util
import json
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pyfloat_cases", PROGRAM / "tools" / "pyfloat-cases.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_table_is_current(self):
        have = json.loads(tool.OUT.read_text(encoding="utf-8"))
        new = tool.build()
        self.assertEqual(have["cases"], new["cases"], "事例の答えが今の Python と違う。tools/pyfloat-cases.py で作り直す")
        self.assertEqual(have.get("fields"), new["fields"], "欄の値の事例が今の Python と違う。tools/pyfloat-cases.py で作り直す")

    def test_table_covers_the_known_edges(self):
        cases = {c[1]: c for c in json.loads(tool.OUT.read_text(encoding="utf-8"))["cases"]}
        for r in ("1059438285926254.2", "1e-05", "0.0001", "1e+16", "-0.0", "5e-324", "1e+22"):
            self.assertTrue(r in cases, f"{r} が表に無い")
        # 欄の値（版 3.105.0）: -0.0（偽なので str(v or "") は空）・1e16 の境・i64 と u64 の境
        fields = {f[0]: f for f in json.loads(tool.OUT.read_text(encoding="utf-8"))["fields"]}
        self.assertEqual(fields["-0.0"][1:], ["-0.0", ""])
        self.assertEqual(fields["1e16"][1], "1e+16")
        self.assertEqual(fields["9999999999999998.0"][1], "9999999999999998.0")
        for s in ("9223372036854775807", "9223372036854775808", "18446744073709551615", "18446744073709551616"):
            self.assertEqual(fields[s][1], s, "整数は桁のまま")


if __name__ == "__main__":
    unittest.main()
