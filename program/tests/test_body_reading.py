# -*- coding: utf-8 -*-
"""書く道の本文と版の読み方（版 3.77.0）。窓（desktop/src/master_rows.rs）と同じ 1 つの決まりにそろえた:
- 本文も版も Content-Type によらず読む（前は版と権限・設定・データ元の本文が Content-Type を見て、text/plain の本文を {} と読んだ。
  権限の行を直すと項目が空に書き換わり、text/plain の [1] を添えた「消す」は行を消した）
- 直す・消す道の本文が表でない（並び・字・数）なら書かない（500）
- 必須の列（設備名・設備）が null でも空として断る（前は「None」と読み、名前の空の行を置いた）"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore


class BodyReading(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "data").mkdir()
        for name, rows in (("equipment_master", [{"id": 1, "設備名": "CR1", "rev": 1}]), ("roll_master", [{"id": 1, "設備": "CR1", "rev": 1}]),
                           ("access_permissions", [{"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "備考": "メモ", "rev": 1}])):
            (self.tmp / "data" / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        self.store = MasterStore(self.tmp, local_root=self.tmp / "local", settings={})
        self.repo = MasterRepository(self.store)
        self.c = create_app({"TESTING": True, "MASTER_STORE": self.store}).test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def send(self, method, path, body, ctype="text/plain"):
        return self.c.open(path, method=method, data=(body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode("utf-8"),
                           content_type=ctype)

    def test_required_null_is_blank(self):
        for path, col in (("/api/masters/equipment", "設備名"), ("/api/masters/rolls", "設備")):
            r = self.send("POST", path, {col: None}, "application/json")
            self.assertEqual((r.status_code, r.get_json()["error"]), (400, f"{col}は必須です。"), path)
            r = self.send("PUT", f"{path}/1", {col: None}, "application/json")
            self.assertEqual(r.status_code, 400, path)
        self.assertEqual(self.send("POST", "/api/masters/equipment", {"設備名": 0}, "application/json").status_code, 201, "0 は空でない")

    def test_text_plain_body_and_version_are_read(self):
        r = self.send("PUT", "/api/masters/access/1", {"ログインID": "u1", "備考": "text/plain で直した"})
        self.assertEqual(r.status_code, 200, r.get_json())
        row = next(x for x in self.repo.access_permissions() if x["id"] == 1)
        self.assertEqual(row["備考"], "text/plain で直した", "text/plain の本文で項目を空に書き換えない")
        r = self.send("PUT", "/api/masters/equipment/1", {"検査計": "有", "base_rev": 99})
        self.assertEqual(r.status_code, 409, "text/plain でも版を確かめる")

    def test_non_object_body_does_not_delete(self):
        self.c = create_app({"MASTER_STORE": self.store}).test_client()   # 本番と同じく、道の外の例外は 500 で答える
        for ctype in ("text/plain", "application/json"):
            r = self.send("DELETE", "/api/masters/rolls/1?rev=1", "[1]", ctype)
            self.assertEqual(r.status_code, 500, ctype)
        self.assertEqual([x["id"] for x in self.repo.rolls()], [1], "表でない本文では消さない")


if __name__ == "__main__":
    unittest.main()
