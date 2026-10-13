# -*- coding: utf-8 -*-
"""集計表・グラフの組み方のプリセット（services/pivot_presets.py・/api/pivot-presets・/api/pivot-quick。版 3.26.0・3.27.0）。

共通デフォルト（開発者だけ書ける・組み込みの物）・共通（全員）と ID（ログイン ID ごと）の置き場・
標準（組ごとに 1 つ・ID → 共通 → 共通デフォルトの順）・書ける人・見える範囲（ほかの ID の分は見えない）・
すぐに見るの選び（ID・元ごと。選んでいなければ既定）を確かめる。"""
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore
from app.services import identity
from app.services import pivot_presets as pp

ROOT = Path(__file__).resolve().parents[1]
BODY = {"rows": [{"column": "@workday", "part": "ym"}], "cols": [{"column": "@shift", "part": ""}],
        "measures": [{"agg": "lots"}, {"agg": "sum", "column": "重量"}], "chart": "time", "sub": True, "grand": True,
        "split": True, "labels": True, "view": "pivot", "month": "2026-09", "unknown": 1}


class Body(unittest.TestCase):
    def test_keeps_only_the_composition(self):
        body, text = pp.clean_body(BODY)
        self.assertEqual(sorted(body), sorted(pp.BODY_KEYS), "一覧｜集計・選んだ月・知らない物は入れない")
        self.assertEqual((body["split"], body["labels"], body["measures"][0]), (True, True, {"agg": "lots"}))
        self.assertEqual(pp.clean_body(text)[0], body, "JSON の字でも同じ")

    def test_refuses_empty_and_wrong(self):
        for bad in ({}, {"rows": []}, "not json", [1], {"rows": "x"}):
            with self.assertRaises(pp.PresetError):
                pp.clean_body(bad)

    def test_standard_prefers_the_id_over_common(self):
        rows = [{"id": 1, "元": "work", "範囲": "共通", "ログインID": "", "標準": "1"},
                {"id": 2, "元": "work", "範囲": "ID", "ログインID": "taro", "標準": "1"},
                {"id": 3, "元": "work", "範囲": "ID", "ログインID": "jiro", "標準": "1"},
                {"id": 4, "元": "lot", "範囲": "共通", "ログインID": "", "標準": "1"}]
        self.assertEqual(pp.standard_for(rows, "work", "taro")["id"], 2, "自分の標準があればそれ")
        self.assertEqual(pp.standard_for(rows, "work", "hanako")["id"], 1, "無ければ共通の標準（ほかの ID の標準は使わない）")
        self.assertEqual(pp.standard_for(rows, "lot", "taro")["id"], 4, "元ごとに分ける")
        self.assertIsNone(pp.standard_for(rows[1:3], "work", "hanako"))
        rows.append({"id": 5, "元": "work", "範囲": "共通デフォルト", "ログインID": "", "標準": "1"})
        self.assertEqual(pp.standard_for(rows[1:], "work", "hanako")["id"], 5, "共通の標準も無ければ共通デフォルトの標準")
        self.assertEqual(pp.standard_for(rows, "work", "hanako")["id"], 1, "共通の標準が共通デフォルトより先")

    def test_builtins_are_valid_and_use_known_roles(self):
        roles = {"$date", "$weight", "$num2", "$few1", "$few2", "$lot", "@workday", "@shift"}
        for src, bs in pp.BUILTINS.items():
            self.assertEqual(len({b["key"] for b in bs}), len(bs), "鍵は元ごとに 1 つずつ")
            self.assertTrue(any(b["quick"] for b in bs), "すぐに見るの既定がある")
            for b in bs:
                cols = [d["column"] for d in b["body"]["rows"] + b["body"]["cols"]] + [m["column"] for m in b["body"]["measures"] if m.get("column")]
                self.assertTrue(set(cols) <= roles, (src, b["key"], cols))
                self.assertIn(b["body"]["chart"], pp.CHARTS)
        charts = {b["body"]["chart"] for bs in pp.BUILTINS.values() for b in bs}
        self.assertTrue({"pareto", "stack", "heat", "control", "box", "scatter", "donut"} <= charts, "増やした形を組み込みで試せる")

    def test_quick_keys(self):
        self.assertEqual(pp.clean_quick(["3", "b:hist", "3", "x", "b:", 7]), ["3", "b:hist", "7"], "数の id と b:鍵 だけ・重ねない")
        with self.assertRaises(pp.PresetError):
            pp.clean_quick("3")
        with self.assertRaises(pp.PresetError):
            pp.clean_quick([str(i) for i in range(pp.QUICK_MAX + 1)])


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "data", self.tmp / "app" / "data")
        (self.tmp / "app" / "data" / "access_permissions.json").write_text("[]", encoding="utf-8")
        (self.tmp / "share").mkdir()
        self.who = {"login": "taro", "pc": "PC-1"}
        self.p1 = mock.patch.object(identity, "current_login_id", lambda: self.who["login"])
        self.p2 = mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": self.who["pc"], "source": "test", "tried": []})
        self.p1.start()
        self.p2.start()
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"dir": str(self.tmp / "share"), "refresh_seconds": 0})
        self.app = create_app({"TESTING": True, "MASTER_STORE": store})
        self.c = self.app.test_client()
        repo = MasterRepository(store)
        for login, me, role in (("taro", "編集可", "一般ユーザー"), ("jiro", "閲覧のみ", "一般ユーザー"), ("hanako", "部分的編集可", "一般ユーザー"),
                                ("dev", "編集可", "開発者")):
            repo.access_permissions_create({"ログインID": login, "PC名": "", "権限区分": role, "マスタ編集": me, "有効": "有"})
        self.as_("taro")

    def tearDown(self):
        self.p1.stop()
        self.p2.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def as_(self, login):
        self.who.update(login=login)
        import app.routes as r
        r._REVOKE_CACHE.update(at=0.0, key="")

    def save(self, **kw):
        return self.c.post("/api/pivot-presets", json={"name": "日ごとのロット数", "source": "work", "scope": "me", "body": BODY, **kw})

    def items(self, source="work", builtin=False):
        """一覧（builtin=False なら組み込みの物を除く: 置いた物だけを確かめる）"""
        d = self.c.get(f"/api/pivot-presets?source={source}").get_json()
        return d if builtin else {**d, "items": [x for x in d["items"] if not x["builtin"]]}

    def test_id_presets_are_only_for_the_owner(self):
        r = self.save(standard=True)
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual((r.get_json()["scope"], r.get_json()["login"], r.get_json()["standard"]), ("me", "taro", True))
        self.as_("jiro")
        got = self.items()
        self.assertEqual((got["items"], got["standardId"]), ([], None), "ほかの ID の組み方は見えない")
        self.assertEqual(self.c.put(f"/api/pivot-presets/{r.get_json()['id']}", json={"name": "乗っ取り"}).status_code, 403)
        self.assertEqual(self.c.delete(f"/api/pivot-presets/{r.get_json()['id']}").status_code, 403)
        self.assertEqual(self.save().status_code, 201, "閲覧のみの人も、自分の ID には保存できる（同じ名前でも持ち主が違えばよい）")

    def test_common_needs_the_master_permission(self):
        self.as_("jiro")
        r = self.save(scope="all")
        self.assertEqual(r.status_code, 403, r.get_json())
        self.assertFalse(self.items()["canEditCommon"])
        self.as_("hanako")
        self.assertTrue(self.items()["canEditCommon"], "部分的編集可から共通を書ける（共有の書式と同じ）")
        self.assertEqual(self.save(scope="all").status_code, 201)
        self.as_("jiro")
        (x,) = self.items()["items"]
        self.assertEqual((x["scope"], x["canEdit"]), ("all", False), "共通は全員に見えるが、書けるのは権限のある人")

    def test_standard_is_one_per_group_and_the_id_standard_wins(self):
        self.as_("hanako")
        common = self.save(scope="all", name="共通の標準", standard=True).get_json()
        self.as_("taro")
        self.assertEqual(self.items()["standardId"], common["id"], "自分の標準が無ければ共通の標準")
        a = self.save(name="A", standard=True).get_json()
        b = self.save(name="B").get_json()
        self.assertEqual(self.items()["standardId"], a["id"], "自分の標準が先")
        r = self.c.put(f"/api/pivot-presets/{b['id']}", json={"standard": True, "base_rev": b["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        got = {x["name"]: x["standard"] for x in self.items()["items"]}
        self.assertEqual(got, {"A": False, "B": True, "共通の標準": True}, "同じ組（自分の ID）の標準は 1 つ。共通の標準はそのまま")
        self.assertEqual(self.items()["standardId"], b["id"])

    def test_names_versions_and_sources(self):
        p = self.save().get_json()
        self.assertEqual(self.save().status_code, 409, "同じ置き場に同じ名前は 2 つ置かない")
        self.assertEqual(self.save(source="lot").status_code, 201, "元が違えばよい")
        self.assertEqual(self.save(name="").status_code, 400)
        self.assertEqual(self.save(name="空", body={"rows": []}).status_code, 400, "行の段の無い組み方は保存しない")
        r = self.c.put(f"/api/pivot-presets/{p['id']}", json={"body": {**BODY, "labels": False}, "base_rev": p["rev"]})
        self.assertEqual((r.status_code, r.get_json()["body"]["labels"]), (200, False))
        r = self.c.put(f"/api/pivot-presets/{p['id']}", json={"name": "古い版から", "base_rev": p["rev"]})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (409, "conflict"), "開いたあとに直された")
        self.assertEqual(self.c.delete(f"/api/pivot-presets/{p['id']}?rev=2").status_code, 200)
        self.assertEqual([x["name"] for x in self.items()["items"]], [])
        self.assertEqual(len(self.items("lot")["items"]), 1)

    def test_default_scope_is_for_the_developer_only(self):
        self.assertFalse(self.items()["canEditDefault"])
        self.assertEqual(self.save(scope="default").status_code, 403, "マスタを書ける人でも、開発者でなければ共通デフォルトは置けない")
        self.as_("dev")
        self.assertTrue(self.items()["canEditDefault"])
        r = self.save(scope="default", name="開発者の既定", standard=True)
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual((r.get_json()["scope"], r.get_json()["login"]), ("default", ""))
        self.as_("taro")
        got = self.items()
        mine = next(x for x in got["items"] if x["name"] == "開発者の既定")
        self.assertEqual((mine["canEdit"], got["standardId"]), (False, mine["id"]), "全員に見え、共通デフォルトの標準が当たる")
        self.assertEqual(self.c.put(f"/api/pivot-presets/{mine['id']}", json={"name": "x"}).status_code, 403)
        self.assertEqual(self.c.delete(f"/api/pivot-presets/{mine['id']}").status_code, 403)
        self.assertEqual(got["quick"][0], str(mine["id"]), "開発者が置いた共通デフォルトは、すぐに見るの既定の先頭")

    def test_builtins_are_listed_last_and_read_only(self):
        self.save()
        got = self.items(builtin=True)
        scopes = [x["scope"] for x in got["items"]]
        self.assertEqual(scopes[0], "me")
        built = [x for x in got["items"] if x["builtin"]]
        self.assertEqual(len(built), len(pp.BUILTINS["work"]))
        self.assertTrue(all(x["scope"] == "default" and not x["canEdit"] and str(x["id"]).startswith("b:") for x in built))
        self.assertEqual(got["quick"], [f"b:{b['key']}" for b in pp.BUILTINS["work"] if b["quick"]], "選んでいなければ組み込みの quick の物")
        self.assertFalse(got["quickCustom"])

    def test_quick_is_chosen_per_id_and_source(self):
        p = self.save().get_json()
        r = self.c.put("/api/pivot-quick", json={"source": "work", "keys": [str(p["id"]), "b:pareto", "b:無い物"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        got = self.items()
        self.assertEqual((got["quick"], got["quickCustom"]), ([str(p["id"]), "b:pareto"], True), "選んだ順のまま・無い物は出さない")
        self.assertFalse(self.items("lot")["quickCustom"], "元ごとに分ける")
        self.as_("jiro")
        self.assertFalse(self.items()["quickCustom"], "ほかの ID には効かない")
        self.assertEqual(self.c.put("/api/pivot-quick", json={"source": "work", "keys": []}).status_code, 200, "閲覧のみの人も自分の分は選べる")
        self.assertEqual((self.items()["quick"], self.items()["quickCustom"]), ([], True), "空も選び（何も出さない）")
        self.as_("taro")
        self.c.put("/api/pivot-quick", json={"source": "work", "keys": ["b:hist"]})
        self.assertEqual(self.items()["quick"], ["b:hist"], "選び直すと置き換わる（行は 1 つ）")
        self.assertEqual(len([r for r in MasterRepository(self.app.config["MASTER_STORE"]).pivot_quick() if r["ログインID"] == "taro"]), 1)
        r = self.c.put("/api/pivot-quick", json={"source": "work", "reset": True})
        self.assertEqual((r.status_code, self.items()["quickCustom"]), (200, False), "既定に戻す")
        self.assertEqual(self.c.put("/api/pivot-quick", json={"source": "x", "keys": []}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
