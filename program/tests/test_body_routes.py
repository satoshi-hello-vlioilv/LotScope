"""本文の門（版 3.104.0。services/body_rules.py・routes/common.body_gate）: 書く道は全部、門を当てるか（ROUTES）当てないか（SKIP）の
どちらかに決めてある・窓へ焼いた表（desktop/src/body_routes.json）が古くない・門の答え（断る言葉・門番より先・空の本文）。"""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import body_rules

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("body_routes", PROGRAM / "tools" / "body-routes.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_every_write_route_is_decided(self):
        app = create_app({"TESTING": True})
        have = {(m, r.pattern) for r in app.rules for m in tool.WRITE if m in r.methods}
        decided = set(body_rules.ROUTES) | set(body_rules.SKIP)
        self.assertEqual(sorted(have - decided), [], "門を当てるか決めていない書く道（services/body_rules.py の ROUTES か SKIP に足す）")
        self.assertEqual(sorted(decided - have), [], "もう無い道")
        self.assertEqual(set(body_rules.ROUTES) & set(body_rules.SKIP), set())

    def test_window_table_is_current(self):
        self.assertEqual(json.loads(tool.OUT.read_text(encoding="utf-8")), tool.build(), "python tools/body-routes.py で作り直す")


class Gate(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "data").mkdir()
        rows = {"roll_master": [{"id": 1, "設備": "CR1", "rev": 1}]}
        for name, r in rows.items():
            (self.tmp / "data" / f"{name}.json").write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
        self.store = MasterStore(self.tmp, local_root=self.tmp / "local", settings={})
        self.c = create_app({"TESTING": True, "MASTER_STORE": self.store}).test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def send(self, method, path, body):
        return self.c.open(path, method=method, data=body.encode("utf-8"), content_type="application/json")

    def test_refuses_before_the_guard(self):
        """門は前の係（門番）の列のいちばん前（窓も同じ順）。読めない本文は 400 で断り、読める本文は道へ渡す"""
        self.assertEqual(self.c.application.before[0].__name__, "body_gate")
        r = self.send("POST", "/api/masters/rolls", '{"設備": NaN}')
        self.assertEqual((r.status_code, r.get_json()), (400, {"error": body_rules.E_NONFINITE, "kind": "body"}))
        r = self.send("POST", "/api/masters/rolls", '{"設備": "CR2", "本数": -0}')
        self.assertEqual(r.status_code, 201, r.get_json())

    def test_blank_body(self):
        """本文が要る道（need）の空は断る。読む道（read）の空は今までどおり {}"""
        r = self.send("PUT", "/api/masters/rolls/1", "")
        self.assertEqual((r.status_code, r.get_json()["kind"]), (400, "body"))
        self.assertEqual(r.get_json()["error"], body_rules.E_BLANK)
        r = self.send("DELETE", "/api/masters/rolls/1", "")
        self.assertNotEqual(r.get_json().get("kind"), "body")

    def test_skip_routes_are_not_gated(self):
        r = self.send("POST", "/api/heartbeat", "[1]")
        self.assertNotEqual((r.get_json() or {}).get("kind"), "body")


if __name__ == "__main__":
    unittest.main()
