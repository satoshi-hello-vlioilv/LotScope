"""CM3 への timeout の決め（services/cm3_schedule.timeout_of。版 3.115.0 の PR #115 の Windows の CI の直し）が事例の表
tests/fixtures/cm3_timeout_cases.json と同じか。窓は cargo test --lib schedule::tests::timeout_like_the_table で同じ表を読む。

前の決め（1 年まではそのまま）は OS で答えが変わった: poll の無い Python（Windows）は timeout をミリ秒にして INT_MAX を超えると
socket.settimeout が OverflowError で落ちる（CPython の socketmodule.c の ms > INT_MAX）。Linux の手元ではその決まりを本物で確かめられないので、
答えが必ず INT_MAX ミリ秒より十分小さいことを、ここで決めの試験として見る。Windows の CI（desktop.yml）でも流し、本物の Windows の socket に
どの答えも渡せることを見る。"""
import json
import math
import random
import socket
import struct
import unittest
from pathlib import Path
from unittest import mock

from app.services import cm3_schedule, schedule

TABLE = json.loads((Path(__file__).resolve().parent / "fixtures" / "cm3_timeout_cases.json").read_text(encoding="utf-8"))
INT_MAX = 2 ** 31 - 1


def windows_accepts(secs):
    """poll の無い Python（Windows）の socket.settimeout が受けるか: 0 以上・ミリ秒〈切り上げ〉が INT_MAX 以下"""
    return secs >= 0 and math.ceil(secs * 1000) <= INT_MAX


class Timeout(unittest.TestCase):
    def test_the_decision_is_the_table(self):
        self.assertEqual((cm3_schedule.TIMEOUT_MIN, cm3_schedule.TIMEOUT_MAX, cm3_schedule.TIMEOUT_DEFAULT),
                         (TABLE["min"], TABLE["max"], TABLE["default"]))
        self.assertEqual(TABLE["intMaxMs"], INT_MAX)
        self.assertEqual(schedule.DEFAULTS["timeout_sec"], TABLE["default"])

    def test_cases(self):
        bad = []
        for c in TABLE["cases"]:
            got = cm3_schedule.timeout_of({"timeout_sec": json.loads(c["j"])})
            if not isinstance(got, float) or got != c["want"]:
                bad.append(f"{c['name']}: 表 {c['want']} / Python {got!r}")
        self.assertEqual(bad, [])
        self.assertEqual(cm3_schedule.timeout_of({}), 15.0, "鍵が無い")

    def test_the_upper_bound_is_far_inside_what_every_python_accepts(self):
        """上限は INT_MAX ミリ秒の 1/20 より小さい（Windows の Python が OverflowError で断る境の十分手前）"""
        self.assertLess(cm3_schedule.TIMEOUT_MAX * 1000 * 20, INT_MAX)
        self.assertTrue(windows_accepts(cm3_schedule.TIMEOUT_MAX))
        self.assertFalse(windows_accepts(1e7), "PR #115 の Windows の CI で落ちた値は、Windows の決まりでは受けない")
        self.assertFalse(windows_accepts(2147484))
        self.assertTrue(windows_accepts(2147483))

    def test_every_answer_is_in_range_whatever_is_written(self):
        """何を書いても、答えは下限〜上限の有限の数で、どの OS の Python の socket も受ける（本物の socket にも渡す）"""
        rnd = random.Random(3115)
        values = [json.loads(c["j"]) for c in TABLE["cases"]]
        values += [float("nan"), float("inf"), float("-inf"), 10 ** 400, -10 ** 400, 2 ** 31, 2 ** 31 - 1, 2 ** 63, 2147483.647, 2147483.648,
                   86400 + 1e-9, math.nextafter(86400.0, math.inf), math.nextafter(86400.0, 0), math.nextafter(0.001, 0), math.nextafter(0.001, 1),
                   "1e7", "1e10", "86400.0001", "8640０", "²", b"30", (30,), {30}, object()]
        values += [struct.unpack("<d", rnd.randbytes(8))[0] for _ in range(20000)]    # 全部のビットの形の小数（nan・inf・非正規の数も）
        values += [rnd.uniform(-10, 100000) for _ in range(2000)] + [10.0 ** rnd.uniform(-12, 12) for _ in range(2000)]
        values += [str(10.0 ** rnd.uniform(-12, 12)) for _ in range(500)] + [rnd.randrange(-10 ** 30, 10 ** 30) for _ in range(500)]
        s = socket.socket()
        try:
            for v in values:
                got = cm3_schedule.timeout_of({"timeout_sec": v})
                self.assertIsInstance(got, float, repr(v))
                self.assertTrue(cm3_schedule.TIMEOUT_MIN <= got <= cm3_schedule.TIMEOUT_MAX, f"{v!r} → {got!r}")
                self.assertTrue(windows_accepts(got), f"{v!r} → {got!r}")
                s.settimeout(got)
                # 受け身の Python が窓を待つ長さ（schedule._ensure_passive の式）も threading の上限の内
                self.assertLess(got * 2 * 11 + 5, 4294967.0, repr(v))
        finally:
            s.close()

    def test_fetch_does_not_overflow_under_the_windows_rule(self):
        """Windows の Python の決まりを写した socket（ミリ秒が INT_MAX を超える timeout は OverflowError）で CM3 へ取りに行っても、
        どの timeout でも落ちるのは「接続できません」（つながない口）だけ。上限を 1 年に戻すと 1e7・2147484 で OverflowError になる（変異で確かめた）"""
        real = socket.socket.settimeout
        seen = []

        def windows_rule(sock, value):
            seen.append(value)
            if value is not None and not windows_accepts(value):
                raise OverflowError("timeout doesn't fit into C timeval")
            return real(sock, value)

        def refused(sock, addr):    # 口へは実際につながない（Windows は閉じた口への接続に 2 秒かかる）
            raise ConnectionRefusedError(111, "Connection refused")

        values = [json.loads(c["j"]) for c in TABLE["cases"]]
        with mock.patch.object(socket.socket, "settimeout", windows_rule), mock.patch.object(socket.socket, "connect", refused):
            for v in values:
                with self.assertRaises(cm3_schedule.Cm3Error, msg=repr(v)):
                    cm3_schedule.fetch_raw({"cm3_base_url": "http://127.0.0.1:9", "init_path": "/x", "timeout_sec": v}, "L-1", "4")
        self.assertGreaterEqual(len(seen), len(values), "どの値も socket に timeout を渡した")
        self.assertTrue(all(windows_accepts(x) for x in seen))

    def test_a_value_in_range_is_kept(self):
        for v in (0.001, 0.5, 1, 15, 600, 86400):
            self.assertEqual(cm3_schedule.timeout_of({"timeout_sec": v}), float(v))


if __name__ == "__main__":
    unittest.main()
