# -*- coding: utf-8 -*-
"""作り物の LotDsp の API の答えの表（tests/fixtures/lotdsp_fake_tables.json。版 3.117.0）が古くないか。

表は、画面の見本を app の読み手で読んで作った JSON を焼いた物（tools/lotdsp-fake-tables.py）。作り物（tests/fakes_lotdsp.py）は app を
import せずにこの表を読む。見本・読み手を変えたのに焼き直していなければ、ここで落ちる。
"""
import importlib.util
import json
import unittest
import urllib.request
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lotdsp_fake_tables", PROGRAM / "tools" / "lotdsp-fake-tables.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


class FakeTables(unittest.TestCase):
    def test_the_baked_table_is_not_stale(self):
        self.assertEqual(gen.OUT.read_text(encoding="utf-8"), gen.text(), "python program/tools/lotdsp-fake-tables.py で焼き直す")

    def test_the_samples_keep_the_apps_time_zone(self):
        from app.services import lotdsp_rules
        from tests import lotdsp_samples
        self.assertEqual(lotdsp_samples.TZ.utcoffset(None), lotdsp_rules.TZ.utcoffset(None))

    def test_the_fake_serves_the_table(self):
        """作り物は表のとおりに答える（状態・本文のバイト。知らないロットは該当なし・サイトの GET は 200）"""
        from tests import fakes_serve
        fake = fakes_serve.start("lotdsp")
        try:
            base = fake["urls"]["lotdsp"]
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def post(tag, lot):
                req = urllib.request.Request(f"{base}/{tag}/service/lotdsp/search//searchAction", data=json.dumps({"lotNo": lot}).encode("utf-8"))
                try:
                    with opener.open(req, timeout=5) as r:
                        return r.status, r.read()
                except urllib.error.HTTPError as e:
                    return e.code, e.read()
            t = json.loads(gen.OUT.read_text(encoding="utf-8"))["tables"]
            for tag, lot in (("a", "L7150C0"), ("a", "E500"), ("a", "EBOM"), ("v2", "L7151C0"), ("c2", "L7151C0"), ("LotDspWeb", "L7150C0")):
                self.assertEqual(post(tag, lot), (t[tag][lot]["status"], t[tag][lot]["text"].encode("utf-8")), (tag, lot))
            self.assertEqual(post("a", "NOPE1"), (200, b'{"status": "OK", "entity": {"searchKeyInfos": []}}'))
            with opener.open(base + "/LotDspWeb/", timeout=5) as r:
                self.assertEqual((r.status, r.read()), (200, b"ok"))
        finally:
            fake["close"]()


if __name__ == "__main__":
    unittest.main()
