# -*- coding: utf-8 -*-
"""CM3 に届かないときの言葉の事例の表（tests/fixtures/cm3_net_cases.json。版 3.117.1）を app/services/cm3_net.py に当てる。
窓は cargo test --test cm3_net_cases が同じ表を src/cm3_net.rs に当てる。"""
import http.client
import json
import socket
import ssl
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import cm3_net, sysproxy  # noqa: E402

CASES = json.loads((Path(__file__).resolve().parent / "fixtures" / "cm3_net_cases.json").read_text(encoding="utf-8"))


def exception(c):
    """事例 → 例外（urllib の URLError.reason に入る物）"""
    kind, args = c["exc"], c.get("args", [])
    if kind == "str":
        return args[0]
    cls = {"TimeoutError": TimeoutError, "socket.timeout": socket.timeout, "socket.gaierror": socket.gaierror,
           "ConnectionRefusedError": ConnectionRefusedError, "http.client.RemoteDisconnected": http.client.RemoteDisconnected,
           "OSError": OSError, "ssl.SSLCertVerificationError": ssl.SSLCertVerificationError, "ssl.SSLError": ssl.SSLError,
           "ssl.SSLEOFError": ssl.SSLEOFError}[kind]
    e = cls(*args) if args else cls(1, "x")
    if "verify_code" in c:
        e.verify_code = c["verify_code"]
    if "reason" in c:
        e.reason = c["reason"]
    return e


class Cm3NetCases(unittest.TestCase):
    def test_messages(self):
        self.assertEqual(cm3_net.HINT, CASES["hint"])
        self.assertEqual(sysproxy.PAC_NOTE, CASES["pac"])
        for c in CASES["messages"]:
            with self.subTest(c["kind"]):
                self.assertEqual(cm3_net.message(c["kind"], c["detail"], c["note"]), c["want"])

    def test_python_materials(self):
        for c in CASES["python"]:
            with self.subTest(c["name"]):
                kind, detail = cm3_net.kind_of(exception(c))
                self.assertEqual(kind, c["kind"])
                self.assertEqual(detail, c.get("detail", ""))

    def test_every_kind_has_a_message(self):
        kinds = {c["kind"] for c in CASES["messages"]}
        self.assertEqual(kinds, set(cm3_net.MESSAGES))
        for sec in ("python", "openssl", "schannel"):
            self.assertLessEqual({c["kind"] for c in CASES[sec]}, kinds, sec)


if __name__ == "__main__":
    unittest.main()
