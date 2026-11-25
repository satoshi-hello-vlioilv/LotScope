"""数の読み方の事例表（tests/fixtures/pynum_cases.json。版 3.75.0）が、いまの Python の int()・float()・\\d と同じか。
窓（desktop/src/pyfmt.rs）は cargo test --test pynum_cases で同じ表と突き合わせる。版 3.119.0（段 ⑤）で表を焼いた道具（app の時刻の読み手 hm を
使った）を消したので、表は凍った答え: ここは標準の部品だけで int()・float()・\\d の答えを確かめる（hm の欄は凍ったまま。窓の試験が読む）"""
import json
import math
import re
import sys
import unittest
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "pynum_cases.json"
I64 = (-(2 ** 63), 2 ** 63 - 1)


def digit_ranges():
    out = []
    for n in range(sys.maxunicode + 1):
        if not re.fullmatch(r"\d", chr(n)):
            continue
        if out and out[-1][1] == n - 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return out


def _int(s):
    try:
        v = int(s)
    except (ValueError, OverflowError):
        return None
    return v if I64[0] <= v <= I64[1] else str(v)


def _float(s):
    try:
        v = float(s)
    except (ValueError, OverflowError):
        return None
    if math.isnan(v):
        return "nan"
    if math.isinf(v):
        return "inf" if v > 0 else "-inf"
    return v


class Table(unittest.TestCase):
    def test_table_is_current(self):
        have = json.loads(OUT.read_text(encoding="utf-8"))
        self.assertEqual(have["digits"], digit_ranges(), "数字の範囲が変わった（Python の Unicode の版が上がった？）")
        for c in have["cases"]:
            with self.subTest(s=c["s"][:20]):
                self.assertEqual((c["int"], c["float"]), (_int(c["s"]), _float(c["s"])))

    def test_table_covers_the_known_edges(self):
        cases = {c["s"]: c for c in json.loads(OUT.read_text(encoding="utf-8"))["cases"]}
        self.assertEqual(sum((b - a + 1) // 10 for a, b in digit_ranges()), 68, "Python 3.13（Unicode 15.1）の数字は 68 系統")
        self.assertEqual(cases["᠑:30"]["hm"], 90, "モンゴルの数字の時刻も Python は読む")
        self.assertEqual((cases["²"]["int"], cases["--5"]["int"], cases["1_0"]["int"]), (None, None, 10))
        self.assertEqual((cases["1e400"]["float"], cases["nan"]["float"]), ("inf", "nan"))
        # 版 3.104.0: int()・float() は U+001C〜U+001F を空白に読まない（str.strip は読む）。i64 に入らない数は桁の字・4,300 桁の上限
        self.assertEqual((cases["4\x1c"]["int"], cases["4\x1c"]["float"], cases["4\x85"]["int"]), (None, None, 4))
        self.assertEqual(cases["99999999999999999999"]["int"], "99999999999999999999")
        self.assertTrue(cases["1" * 4301]["int_err"].startswith("Exceeds the limit (4300 digits)"))


if __name__ == "__main__":
    unittest.main()
