# -*- coding: utf-8 -*-
"""設定の束の節（版 3.102.0）: Python の routes/lotlist.SECTIONS が事例の表 tests/fixtures/bundle_cases.json と同じか
（窓の bundle.rs の SECTIONS と lot.rs の sections_for は cargo test --test bundle_cases が同じ表と比べる）。"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.routes import lotlist

TABLE = json.loads((Path(__file__).resolve().parent / "fixtures" / "bundle_cases.json").read_text(encoding="utf-8"))


class Sections(unittest.TestCase):
    def test_sections_are_like_the_table(self):
        self.assertEqual({k: list(v) for k, v in lotlist.SECTIONS.items()}, TABLE["sections"])


    def test_cases_build_or_refuse_like_the_table(self):
        """表でない行だけなら節は読める行で組み、警告（warn）で言う。ファイルが読めないときだけ節を null にする（作った後の採点の割れ 2）"""
        for c in TABLE["cases"]:
            with self.subTest(c=c["name"]):
                tmp = Path(tempfile.mkdtemp())
                try:
                    (tmp / "data").mkdir()
                    (tmp / "data" / f"{c['master']}.json").write_text(c["text"], encoding="utf-8")
                    st = MasterStore(tmp, local_root=tmp / "local", settings={"dir": ""}, who={"pc": "PC", "login": "a"})
                    app = create_app({"MASTER_STORE": st, "BASE_DIR": tmp, "APP_SETTINGS": {"lot_list": {"source": ""}}})
                    b = app.test_client().get("/api/lotlist/settings").get_json()
                    w = b["broken"][c["section"]]
                    self.assertEqual((w["why"], bool(w.get("warn"))), (c["why"], c["warn"]))
                    v = b["lists"][c["section"]]
                    self.assertEqual(v is not None, c["built"])
                    if "rows" in c:
                        self.assertEqual(len(v), c["rows"])
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
