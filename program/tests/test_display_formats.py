# -*- coding: utf-8 -*-
"""共有の書式（一覧の表示ルールに名前を付けて共有に置き、ほかの設備・ほかの PC で呼び出す）。"""
import shutil
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import display_formats as df
from app.services.db_mirror import DbMirror

ROOT = Path(__file__).resolve().parents[1]
BODY = {"columns": {"order": ["作業日", "ロット番号"], "hidden": ["備考"], "names": {"作業日": "日"}, "rules": {"作業区分": "区分"}},
        "rules": {"区分": {"rows": [], "self": "raw"}}, "arrange": {"levels": [{"column": "作業者", "dir": "asc"}]},
        "sorts": [{"column": "作業日", "dir": "desc"}], "slicer": {"cards": [{"column": "作業者"}]}, "unknown": {"x": 1}}


class Body(unittest.TestCase):
    def test_keeps_only_known_parts(self):
        body, text = df.clean_body(BODY)
        self.assertNotIn("unknown", body)
        self.assertEqual(df.parts_of(body), ["表示列", "読み替えルール", "並び・まとめ", "並べ替え", "スライサー"])
        self.assertEqual(df.clean_body(text)[0], body, "JSON の字でも同じ")

    def test_refuses_empty_wrong_and_huge(self):
        for bad in ({}, {"columns": "x"}, "not json", [1]):
            with self.assertRaises(df.FormatError):
                df.clean_body(bad)
        with self.assertRaises(df.FormatError):
            df.clean_body({"columns": {"names": {"a": "x" * (df.MAX_BYTES + 1)}}})


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        share = self.tmp / "share"
        share.mkdir()

        def pc(name):
            store = MasterStore(self.tmp / "app", local_root=self.tmp / name, settings={"refresh_seconds": 0, "dir": str(share)},
                                who={"pc": name, "login": name.lower()})
            app = create_app({"MASTER_STORE": store, "APP_SETTINGS": {"lot_list": {"source": ""}},
                              "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / name / "cache")})
            return app.test_client()
        self.a, self.b = pc("PC-A"), pc("PC-B")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def save(self, c=None, **kw):
        body = {"name": "標準", "source": "work", "table": "実績", "origin": "CR1", "body": BODY, **kw}
        return (c or self.a).post("/api/masters/formats", json=body)

    def test_saved_on_one_pc_is_called_on_another(self):
        r = self.save()
        self.assertEqual(r.status_code, 201, r.get_json())
        got = self.b.get("/api/masters/formats?source=work").get_json()
        self.assertTrue(got["shared"] and got["canEdit"])
        (f,) = got["items"]
        self.assertEqual((f["name"], f["table"], f["origin"], f["updatedBy"]["pc"]), ("標準", "実績", "CR1", "PC-A"))
        self.assertEqual(f["body"]["columns"]["names"], {"作業日": "日"})
        self.assertNotIn("unknown", f["body"])
        self.assertEqual(self.b.get("/api/masters/formats?source=lot").get_json()["items"], [], "元ごとに分ける")

    def test_name_is_unique_per_source(self):
        self.save()
        self.assertEqual(self.save(c=self.b).status_code, 409, "同じ一覧に同じ名前は 2 つ置かない")
        self.assertEqual(self.save(source="lot").status_code, 201, "別の一覧なら同じ名前でよい")
        self.assertEqual(self.save(name="").status_code, 400)
        self.assertEqual(self.save(source="x").status_code, 400)

    def test_overwrite_checks_the_version_and_delete(self):
        f = self.save().get_json()
        new = {**BODY, "sorts": [{"column": "作業日", "dir": "asc"}]}
        r = self.b.put(f"/api/masters/formats/{f['id']}", json={"body": new, "note": "昇順に", "base_rev": f["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual((r.get_json()["rev"], r.get_json()["note"], r.get_json()["body"]["sorts"][0]["dir"]), (2, "昇順に", "asc"))
        r = self.a.put(f"/api/masters/formats/{f['id']}", json={"body": BODY, "base_rev": f["rev"]})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (409, "conflict"), "開いたあとにほかの PC が上書きした")
        self.assertEqual(self.a.delete(f"/api/masters/formats/{f['id']}?rev=2").status_code, 200)
        self.assertEqual(self.b.get("/api/masters/formats").get_json()["items"], [])


if __name__ == "__main__":
    unittest.main()
