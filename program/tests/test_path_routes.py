"""道の門の欄の表（版 3.114.0。services/path_rules.py の ROUTES・SKIP）: 道の字を受ける部品を呼ぶ道は全部、門を当てるか（ROUTES）
当てないか（SKIP。理由つき）のどちらかに決めてある・窓へ焼いた表（desktop/src/path_routes.json）が古くない・道は欄を門へ通す。"""
import importlib.util
import inspect
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import path_rules

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("path_routes", PROGRAM / "tools" / "path-routes.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Table(unittest.TestCase):
    def test_every_path_route_is_decided(self):
        app = create_app({"TESTING": True})
        have = set()
        for r in app.rules:
            src = inspect.getsource(r.fn)
            if any(c in src for c in path_rules.CONSUMERS):
                have |= {(m, r.pattern) for m in r.methods if m in ("POST", "PUT", "DELETE", "PATCH")}
        decided = set(path_rules.ROUTES) | set(path_rules.SKIP)
        self.assertEqual(sorted(have - decided), [], "道の字を受けるのに門を当てるか決めていない道（services/path_rules.py の ROUTES か SKIP に足す）")
        self.assertEqual(sorted(decided - have), [], "もう道の字を受けない道")
        self.assertEqual(set(path_rules.ROUTES) & set(path_rules.SKIP), set())
        self.assertTrue(all(w for w in path_rules.SKIP.values()), "SKIP には理由を書く")
        kinds = {k for fs in path_rules.ROUTES.values() for _, k in fs}
        self.assertEqual(kinds, {"browse", "dir", "name"})

    def test_window_table_is_current(self):
        self.assertEqual(json.loads(tool.OUT.read_text(encoding="utf-8")), tool.build(), "python tools/path-routes.py で作り直す")


class Routes(unittest.TestCase):
    """道が欄を門へ通し、断る理由を道の知らせの置き場（problem・error）に出す"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "data").mkdir()
        perm = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}]
        (self.tmp / "data" / "access_permissions.json").write_text(json.dumps(perm, ensure_ascii=False), encoding="utf-8")
        self.store = MasterStore(self.tmp, local_root=self.tmp / "local", settings={})
        self.c = create_app({"TESTING": True, "MASTER_STORE": self.store}).test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def post(self, path, body):
        return self.c.open(path, method="POST", data=json.dumps(body), content_type="application/json")

    def test_check_routes_answer_the_reason(self):
        nul = str(self.tmp / "a\u0000b")
        r = self.post("/api/release/place/check", {"from": "", "parent": nul, "name": "x"})
        self.assertEqual((r.status_code, r.get_json()), (200, {"ok": False, "problem": path_rules.E_CTRL}))
        r = self.post("/api/masters/place/check", {"parent": nul, "name": "x"})
        self.assertEqual((r.status_code, r.get_json()), (200, {"ok": False, "problem": path_rules.E_CTRL}))
        # 名前の誤りは門より先に check_name の言葉（plan が最初に見る）
        r = self.post("/api/release/place/check", {"from": "", "parent": nul, "name": "a/b"})
        self.assertTrue(r.get_json()["problem"].startswith("フォルダの名前に使えない字があります: /"), r.get_json())
        r = self.post("/api/release/place/check", {"from": nul, "parent": "", "name": "x"})
        self.assertEqual(r.get_json()["problem"], "置く場所（上のフォルダ）を入れてください。")
        r = self.post("/api/release/place/check", {"from": nul, "parent": str(self.tmp), "name": "x"})
        self.assertEqual(r.get_json()["problem"], path_rules.E_CTRL)


if __name__ == "__main__":
    unittest.main()
