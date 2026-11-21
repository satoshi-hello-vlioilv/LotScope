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
           "ssl.SSLEOFError": ssl.SSLEOFError, "ProxyBadAnswer": cm3_net.ProxyBadAnswer}[kind]
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

    def test_verify_codes_like_the_table(self):
        # 検証の番号の決めは表の verify の節が 1 つ（割れ 4: 前は Python の番号の集まりに表に無い 2・27・29・30・79 があった）
        want = {}
        for c in CASES["verify"]:
            want.setdefault(c["kind"], set()).add(c["code"])
            e = ssl.SSLCertVerificationError(1, "x")
            e.verify_code = c["code"]
            with self.subTest(c["code"]):
                self.assertEqual(cm3_net.kind_of(e)[0], c["kind"])
        self.assertEqual(cm3_net.VERIFY_UNTRUSTED, want["tls_untrusted"])
        self.assertEqual(cm3_net.VERIFY_NAME, want["tls_name"])

    def test_proxy_stage(self):
        # プロキシの言葉は、その問い合わせのプロキシとつながったかで決める（割れ 5）
        refused = ConnectionRefusedError(111, "Connection refused")
        cut = http.client.RemoteDisconnected("Remote end closed connection without response")
        hint = CASES["hint"]
        self.assertEqual(cm3_net.message_of(refused, "", "p:1", False), f"予定の元に接続できません: プロキシ（p:1）に届きません{hint}")
        self.assertEqual(cm3_net.message_of(cut, "", "p:1", True), f"予定の元に接続できません: プロキシ（p:1）には届きましたが、その先で接続が切れました{hint}")
        self.assertEqual(cm3_net.message_of(cut, "", None, True), f"予定の元に接続できません: Remote end closed connection without response{hint}")
        self.assertEqual(cm3_net.message_of(socket.gaierror(-2, "x"), "", "p:1", False), f"予定の元に接続できません: プロキシ（p:1）に届きません{hint}")
        self.assertEqual(cm3_net.message_of(cm3_net.ProxyBadAnswer("x"), "", "p:1", True), f"予定の元に接続できません: プロキシ（p:1）の答えを読めません{hint}")
        self.assertEqual(cm3_net.message_of(TimeoutError("timed out"), "", "p:1", True), f"予定の元の応答がタイムアウトしました{hint}")
        eof = ssl.SSLEOFError(8, "EOF occurred in violation of protocol")
        self.assertEqual(cm3_net.message_of(eof, "", "p:1", True), f"予定の元に接続できません: プロキシ（p:1）には届きましたが、その先で接続が切れました{hint}")
        self.assertEqual(cm3_net.message_of(eof, "", None, False), f"予定の元に接続できません: 暗号の通信（TLS）を始められません{hint}")

    def test_every_kind_has_a_message(self):
        kinds = {c["kind"] for c in CASES["messages"]}
        self.assertEqual(kinds, set(cm3_net.MESSAGES))
        for sec in ("python", "openssl", "schannel", "verify"):
            self.assertLessEqual({c["kind"] for c in CASES[sec]}, kinds, sec)


if __name__ == "__main__":
    unittest.main()


class Joins(unittest.TestCase):
    """30x の行き先の組み方の事例（版 3.118.0 の作った後の採点の割れ 2。cm3_net_cases.json の joins）が、Python 3.13 の urllib の手順の答えのまま"""

    def test_joins_are_urllib(self):
        import string
        from urllib.parse import quote, urljoin, urlparse, urlunparse
        t = json.loads((Path(__file__).resolve().parent / "fixtures" / "cm3_net_cases.json").read_text(encoding="utf-8"))
        for c in t["joins"]:
            u = urlparse(c["loc"])
            if not u.path and u.netloc:
                u = u._replace(path="/")
            got = urljoin(c["base"], quote(urlunparse(u), encoding="iso-8859-1", safe=string.punctuation))
            self.assertEqual(got, c["want"], c)

