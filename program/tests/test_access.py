# -*- coding: utf-8 -*-
"""版・名乗り・アクセス権限・利用状況（WaveLog から移した仕組み）。

    python -m unittest discover -s tests
"""
import json
import shutil
import tempfile
import time
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import access, identity, presence
from app.version import APP_VERSION

ROOT = Path(__file__).resolve().parents[1]


class Identity(unittest.TestCase):
    def test_setting_name_wins_and_useless_names_are_skipped(self):
        self.assertEqual(identity.resolve_pc_name("  NLM-PC-01 ", force=True)["name"], "NLM-PC-01")
        with mock.patch("socket.gethostname", return_value="localhost"), mock.patch.dict("os.environ", {"COMPUTERNAME": "PC-Z"}):
            got = identity.resolve_pc_name("", force=True)
        self.assertEqual((got["name"], got["source"]), ("PC-Z", "COMPUTERNAME"), "localhost は使えない名前として飛ばす")
        identity.resolve_pc_name("", force=True)

    def test_login_falls_back_to_environment(self):
        with mock.patch("os.getlogin", side_effect=OSError), mock.patch("getpass.getuser", side_effect=KeyError), \
                mock.patch.dict("os.environ", {"USERNAME": "taro"}, clear=False):
            self.assertEqual(identity.current_login_id(), "taro")


def row(i, login="", pc="", role="", me="", on=""):
    return {"id": i, "ログインID": login, "PC名": pc, "権限区分": role, "マスタ編集": me, "有効": on}


class Rules(unittest.TestCase):
    ROWS = [row(1, role="設備作業者"), row(2, pc="PC-A", role="メンテナンス者"),
            row(3, login="taro", role="一般ユーザー", me="閲覧のみ"), row(4, login="taro", pc="PC-A", role="開発者"),
            row(5, login="jiro", role="開発者", on="無")]

    def test_match_priority(self):
        self.assertEqual(access.flags(self.ROWS, "TARO", "pc-a")["matchedId"], 4, "ログインIDとPC名の両方（大小・全半角をそろえる）")
        self.assertEqual(access.flags(self.ROWS, "taro", "PC-B")["matchedId"], 3, "ログインIDだけ")
        self.assertEqual(access.flags(self.ROWS, "hana", "PC-A")["matchedId"], 2, "PC名だけ")
        self.assertEqual(access.flags(self.ROWS, "hana", "PC-B")["matchedId"], 1, "両方空＝全体")
        self.assertEqual(access.flags(self.ROWS, "jiro", "PC-B")["matchedId"], 1, "有効が「無」の行は数えない")

    def test_default_when_nothing_matches(self):
        f = access.flags([], "x", "y")
        self.assertEqual((f["role"], f["masterEdit"], f["matchedId"]), ("一般ユーザー", "編集可", None))

    def test_cap_by_role(self):
        f = access.flags([row(1, login="op", role="設備作業者", me="編集可")], "op", "")
        self.assertEqual(f["masterEdit"], "非表示", "設備作業者は非表示で頭打ち")
        self.assertFalse(access.capabilities(f)["canOpenMaster"])
        self.assertFalse(access.master_edit_check("設備作業者", "閲覧のみ")[0])

    def test_partial_writes_only_field_masters(self):
        self.assertTrue(access.master_edit_can("部分的編集可", "write", access.master_scope("equipment_master")))
        self.assertFalse(access.master_edit_can("部分的編集可", "write", access.master_scope("access_permissions")))
        self.assertFalse(access.master_edit_can("閲覧のみ", "write", "field"))

    def test_role_can(self):
        self.assertTrue(access.role_can("メンテナンス者", "presence:disconnect", "一般ユーザー"))
        self.assertFalse(access.role_can("メンテナンス者", "presence:disconnect", "開発者"))
        self.assertFalse(access.role_can("一般ユーザー", "presence:forget"))
        self.assertFalse(access.role_can("設備作業者", "presence:view"))
        self.assertFalse(access.role_can("メンテナンス者", "role:grant", "メンテナンス者"), "同格は付与できない")
        self.assertTrue(access.role_can("開発者", "role:grant", "開発者"))

    def test_three_gates(self):
        rows = [row(1, login="boss", role="メンテナンス者"), row(2, login="u", role="一般ユーザー")]
        self.assertFalse(access.role_change_check(rows, "u", "", "一般ユーザー", "開発者", row_id=2)[0], "自分の区分は自分で変えられない")
        self.assertFalse(access.role_change_check([], "u", "", "一般ユーザー", "開発者", row_login="u")[0],
                         "新しい行でも自分に当たるなら自分（管理者がまだ居なくても自分は上げられない）")
        self.assertTrue(access.role_change_check([], "u", "", "一般ユーザー", "開発者", row_login="other")[0], "管理者がまだ居なければ最初の1人を作れる")
        self.assertFalse(access.role_change_check(rows, "boss", "", "一般ユーザー", "メンテナンス者", row_login="x")[0], "同格は与えられない")
        self.assertTrue(access.role_change_check(rows, "boss", "", "一般ユーザー", "設備作業者", row_id=2)[0])

    def test_delete_check(self):
        rows = [row(1, login="boss", role="メンテナンス者"), row(2, login="dev", role="開発者")]
        self.assertFalse(access.delete_check(rows, "boss", "", rows[0])[0], "自分の行は消せない")
        self.assertFalse(access.delete_check(rows, "boss", "", rows[1])[0], "上位の行は消せない")
        self.assertTrue(access.delete_check(rows, "dev", "", rows[0])[0])


class Env(unittest.TestCase):
    """一時フォルダに共有フォルダを置き、この PC（ログイン・PC名）を差し替えて API を確かめる。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "data", self.tmp / "app" / "data")
        # 同梱の権限（最初の管理者）は外し、「管理者がまだ居ない」ところから確かめる
        (self.tmp / "app" / "data" / "access_permissions.json").write_text("[]", encoding="utf-8")
        (self.tmp / "share").mkdir()
        self.who = {"login": "u1", "pc": "PC-1"}
        self.p1 = mock.patch.object(identity, "current_login_id", lambda: self.who["login"])
        self.p2 = mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": self.who["pc"], "source": "test", "tried": []})
        self.p1.start()
        self.p2.start()
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"dir": str(self.tmp / "share"), "refresh_seconds": 0})
        self.app = create_app({"TESTING": True, "MASTER_STORE": store})
        self.c = self.app.test_client()
        import app.routes as r
        r._REVOKE_CACHE.update(at=0.0, key="")

    def tearDown(self):
        self.p1.stop()
        self.p2.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def as_(self, login, pc="PC-1"):
        self.who.update(login=login, pc=pc)
        import app.routes as r
        r._REVOKE_CACHE.update(at=0.0, key="")

    def seed(self, login, role, me="編集可"):
        """試験の下ごしらえ: 権限の行をマスタへ直接書く（API は「自分の区分は自分で変えられない」ので通らない）。"""
        from app.repositories.master_repository import MasterRepository
        MasterRepository(self.app.config["MASTER_STORE"]).access_permissions_create(
            {"ログインID": login, "PC名": "", "権限区分": role, "マスタ編集": me, "有効": "有"})

    def add_perm(self, **kw):
        body = {"ログインID": "", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "編集可", **kw}
        return self.c.post("/api/masters/access", json=body)

    def put_equipment(self):
        r = next(x for x in self.c.get("/api/masters/equipment").get_json() if x["設備名"] == "TLV")
        return self.c.put(f"/api/masters/equipment/{r['id']}", json={**r, "検査計": "有", "base_rev": r["rev"]})


class Api(Env):
    def test_me_and_version(self):
        d = self.c.get("/api/access/me").get_json()
        self.assertEqual((d["loginId"], d["pcName"], d["role"], d["version"]), ("u1", "PC-1", "一般ユーザー", APP_VERSION))
        self.assertEqual(self.c.get("/api/changelog").get_json()["entries"][0]["version"], APP_VERSION)

    def test_first_admin_then_self_promotion_refused(self):
        self.assertEqual(self.add_perm(ログインID="u1", 権限区分="開発者").status_code, 403, "自分に当たる行で自分を上げられない")
        self.assertEqual(self.add_perm(ログインID="boss", 権限区分="開発者").status_code, 201, "管理者がまだ居なければ最初の1人を作れる")
        self.assertEqual(self.add_perm(ログインID="x", 権限区分="メンテナンス者").status_code, 403, "管理者が居れば、一般ユーザーは上の区分を与えられない")
        self.assertEqual(self.add_perm(ログインID="boss", 権限区分="開発者").status_code, 403, "権限で断るのが先（重複より前）")
        # 版 3.52.1（脆弱性）: 管理者が居れば、登録の無い人は「部分的編集可」＝管理のマスタ（権限の表）を書けない
        self.assertEqual(self.add_perm(ログインID="x", PC名="PC-X").status_code, 403, "未登録の人は権限の表に行を足せない")
        self.as_("boss")
        self.assertEqual(self.add_perm(ログインID="x", PC名="PC-X").status_code, 201)
        self.assertEqual(self.add_perm(ログインID="X", PC名="pc-x").status_code, 409, "同じ組（大小・全半角をそろえて）は2行にしない")
        self.as_("u1")
        me = self.c.get("/api/access/me").get_json()
        self.assertEqual((me["masterEdit"], me["canEditFieldMaster"], me["canEditAdminMaster"]), ("部分的編集可", True, False),
                         "未登録の人は現場のマスタは書けるが、管理のマスタは書けない")

    def test_guard_by_master_edit_level(self):
        self.seed("boss", "開発者")
        self.as_("boss")
        self.assertEqual(self.add_perm(ログインID="u1", マスタ編集="閲覧のみ").status_code, 201)
        self.assertEqual(self.add_perm(ログインID="u2", マスタ編集="部分的編集可").status_code, 201)
        self.as_("u1")
        r = self.put_equipment()
        self.assertEqual((r.status_code, r.get_json()["kind"]), (403, "forbidden"), "閲覧のみはマスタを書けない")
        fmt = {"name": "標準", "source": "work", "body": {"sorts": [{"column": "作業日", "dir": "desc"}]}}
        self.assertEqual(self.c.post("/api/masters/formats", json=fmt).status_code, 403, "閲覧のみは共有の書式を置けない（呼び出すのはできる）")
        self.assertEqual(self.c.get("/api/masters/formats").status_code, 200)
        self.as_("u2")
        self.assertEqual(self.put_equipment().status_code, 200, "部分的編集可は現場のマスタを書ける")
        self.assertEqual(self.c.post("/api/masters/formats", json=fmt).status_code, 201, "共有の書式は現場のマスタと同じ（部分的編集可から）")
        r = self.c.put("/api/settings/lot_list.stale_hours", json={"value": "48", "base_rev": 0})
        self.assertEqual(r.status_code, 403, "部分的編集可は参照先（管理のマスタ）を書けない")
        self.assertEqual(self.c.post("/api/settings/check", json={"key": "lot_list.stale_hours", "value": "48"}).status_code, 200, "確かめるは書き込みではない")
        self.assertEqual(self.add_perm(ログインID="z").status_code, 403, "部分的編集可はアクセス権限を書けない")

    def test_operator_cannot_open_master(self):
        self.seed("boss", "開発者")
        self.as_("boss")
        self.assertEqual(self.add_perm(ログインID="op", 権限区分="設備作業者", マスタ編集="非表示").status_code, 201)
        self.as_("op")
        d = self.c.get("/api/access/me").get_json()
        self.assertFalse(d["canOpenMaster"])
        self.assertFalse(d["canViewPresence"])
        self.assertEqual(self.c.get("/api/presence").status_code, 403)


class Presence(Env):
    def write_history(self, login, pc, version):
        key = presence.terminal_key(login, pc)
        d = presence.presence_dir() / "history"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{key}.json").write_text(json.dumps({"key": key, "login": login, "pc": pc, "version": version,
                                                   "lastAt": datetime.now().isoformat(timespec="seconds"), "versions": {version: "x"}}), encoding="utf-8")

    def beat(self):
        presence._state["last_write"] = 0
        presence.touch(self.who["login"], self.who["pc"], "一般ユーザー", force=True)

    def test_heartbeat_writes_and_fleet_shows_online(self):
        self.beat()
        self.assertTrue((self.tmp / "share" / "presence_tpa").exists(), "共有フォルダの下に置く（WaveLog の presence と分ける）")
        fl = self.c.get("/api/presence").get_json()["fleet"]
        me = next(x for x in fl["items"] if x["login"] == "u1")
        self.assertTrue(me["online"])
        self.assertEqual(me["version"], APP_VERSION)

    def test_latest_version_and_outdated_notice(self):
        self.beat()
        self.write_history("u9", "PC-9", "9.9.9")
        presence.refresh_newest(lambda pairs: {p: "一般ユーザー" for p in pairs})
        n = presence.version_notice("一般ユーザー")
        self.assertEqual((n["latestVersion"], n["outdated"]), ("9.9.9", True), "ほかの人がもっと新しい版を使っている → 古い")
        self.assertFalse(presence.version_notice("開発者")["outdated"], "開発者には古いと言わない")
        fl = self.c.get("/api/presence").get_json()["fleet"]
        self.assertEqual(fl["latest"], "9.9.9")
        self.assertTrue(next(x for x in fl["items"] if x["login"] == "u1")["outdated"])

    def test_heartbeat_tells_outdated_through_the_background_thread(self):
        """心拍 → 裏の糸で最新版を数え直す → 次の心拍の答えに「古い」（裏の糸で current_app を使わない）。"""
        self.write_history("u9", "PC-9", "9.9.9")
        with mock.patch.object(presence, "WRITE_INTERVAL_SEC", 0), mock.patch.object(presence, "NEWEST_INTERVAL_SEC", 0):
            presence._state.update(newest=None, newest_at=0.0)
            v = None
            for _ in range(20):
                v = self.c.post("/api/heartbeat", json={"visible": True}).get_json().get("version")
                if v:
                    break
                time.sleep(0.1)
        self.assertTrue(v and v["outdated"] and v["latestVersion"] == "9.9.9", v)

    def test_developer_versions_do_not_count(self):
        self.write_history("dev", "PC-D", "9.9.9")
        def roles(pairs):
            return {p: ("開発者" if p[0] == "dev" else "一般ユーザー") for p in pairs}
        self.beat()
        self.assertEqual(presence.latest_version(roles), APP_VERSION, "開発者の試しの版は最新版に数えない")

    def test_disconnect_blocks_writes_then_allow(self):
        self.seed("boss", "メンテナンス者")
        self.as_("u1")
        self.beat()
        self.as_("boss")
        key = presence.terminal_key("u1", "PC-1")
        self.assertEqual(self.c.post("/api/presence/disconnect", json={"key": key, "reason": "版を上げてください"}).status_code, 200)
        self.as_("u1")
        r = self.put_equipment()
        self.assertEqual((r.status_code, r.get_json()["kind"]), (403, "revoked"))
        self.assertIn("版を上げてください", r.get_json()["error"])
        self.assertIsNotNone(self.c.get("/api/access/me").get_json()["revoked"])
        self.as_("boss")
        self.assertEqual(self.c.post("/api/presence/allow", json={"key": key}).status_code, 200)
        self.as_("u1")
        self.assertEqual(self.put_equipment().status_code, 200, "切断を解けば書ける")

    def test_general_user_cannot_disconnect_and_self_is_refused(self):
        self.beat()
        key = presence.terminal_key("u1", "PC-1")
        self.assertEqual(self.c.post("/api/presence/disconnect", json={"key": key}).status_code, 400, "自分は切断できない")
        self.as_("u2", "PC-2")
        self.beat()
        self.as_("u1")
        self.assertEqual(self.c.post("/api/presence/disconnect", json={"key": presence.terminal_key("u2", "PC-2")}).status_code, 403)

    def test_forget_refuses_online_and_leave_removes_presence(self):
        self.seed("boss", "開発者")
        self.as_("u1")
        self.beat()
        self.as_("boss")
        key = presence.terminal_key("u1", "PC-1")
        self.assertEqual(self.c.post("/api/presence/forget", json={"key": key}).status_code, 409, "使っている PC の記録は消せない")
        presence.leave("u1", "PC-1")
        self.assertFalse((presence.presence_dir() / f"{key}.json").exists())
        self.assertEqual(self.c.post("/api/presence/forget", json={"key": key}).status_code, 200)
        self.assertFalse((presence.presence_dir() / "history" / f"{key}.json").exists())

    def test_forged_key_cannot_reach_outside_the_presence_folder(self):
        """版 3.52.1（脆弱性）: 同僚が記録の中の key を「../..」にしても、「記録を消す」でマスタの置き場が消えない"""
        import json as _json
        self.seed("boss", "メンテナンス者")
        self.as_("boss")
        self.c.get("/api/masters/equipment")
        self.c.get("/api/access/me")        # 読むだけで置かれるマスタ（タブの権限 tab_access など。版 3.58.0）を先に置いてから数える
        share = self.tmp / "share"
        before = sorted(p.name for p in share.glob("*.json"))
        h = presence.presence_dir() / "history"
        h.mkdir(parents=True, exist_ok=True)
        (presence.presence_dir() / "sessions").mkdir(exist_ok=True)
        (h / "x.json").write_text(_json.dumps({"key": "../..", "login": "ghost", "pc": "OLD-PC", "lastAt": "2025-01-01T00:00:00"}), encoding="utf-8")
        keys = [x["key"] for x in self.c.get("/api/presence").get_json()["fleet"]["items"]]
        self.assertNotIn("../..", keys, "鍵の正しくない記録は並べない")
        for bad in ("../..", "..", "a/b", "a\\b", ".x"):
            self.assertNotEqual(self.c.post("/api/presence/forget", json={"key": bad}).status_code, 200, bad)
            self.assertFalse(presence.forget(bad), bad)
            self.assertFalse(presence.disconnect(bad), bad)
        self.assertTrue(before and sorted(p.name for p in share.glob("*.json")) == before, "共有のマスタは残る")

    def test_no_share_folder_writes_nothing(self):
        presence.configure(self.tmp / "nowhere" / "presence_tpa")
        self.assertFalse(presence.touch("u1", "PC-1", "一般ユーザー", force=True))
        self.assertFalse((self.tmp / "nowhere").exists(), "置き場の親が無ければ作らない")


if __name__ == "__main__":
    unittest.main()


class ShellMe(Env):
    """デスクトップ版で窓が権限を受け持つとき（版 3.65.0。desktop/src/access.rs）: 窓が載せた me（見出し X-TPA-Me）を使い、門番は窓に任せる。
    見出しが無い・読めないときは今までどおり Python が決め、門番も Python が見る（窓が名乗りを読めなかったときに門番が抜けない）。"""

    def setUp(self):
        super().setUp()
        self.env = mock.patch.dict("os.environ", {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,lists,access"})
        self.env.start()
        self.seed("boss", "開発者")

    def tearDown(self):
        self.env.stop()
        super().tearDown()

    @staticmethod
    def shell(role, me_level, hidden=()):
        f = {"role": role, "masterEdit": me_level, "masterEditStored": me_level, "matchedId": None, "hiddenTabs": list(hidden)}
        m = {"login": "窓", "pc": "WIN-PC", "pcSource": "窓", "key": "WIN-PC@窓", "rows": [], "flags": f,
             "caps": access.capabilities(f), "revoked": None}
        return {"X-TPA-Me": json.dumps(m, ensure_ascii=False)}

    def test_uses_the_shell_me(self):
        d = self.c.get("/api/access/me", headers=self.shell("メンテナンス者", "閲覧のみ", ["work"])).get_json()
        self.assertEqual((d["loginId"], d["pcName"], d["role"], d["masterEdit"], d["hiddenTabs"]),
                         ("窓", "WIN-PC", "メンテナンス者", "閲覧のみ", ["work"]))
        self.assertEqual(self.c.get("/api/access/me").get_json()["loginId"], "u1", "見出しが無ければ Python が決める")
        for bad in ("{", "[]", json.dumps({"flags": "x"})):
            self.assertEqual(self.c.get("/api/access/me", headers={"X-TPA-Me": bad}).get_json()["loginId"], "u1", bad)

    def test_revoked_from_the_shell_reaches_the_screen(self):
        h = self.shell("一般ユーザー", "編集可")
        m = json.loads(h["X-TPA-Me"])
        m["revoked"] = {"by": "boss", "byPc": "PC-0", "reason": "点検", "at": "2026-11-04T09:00:00", "remainingSec": 120}
        d = self.c.get("/api/access/me", headers={"X-TPA-Me": json.dumps(m, ensure_ascii=False)}).get_json()
        self.assertEqual((d["revoked"] or {}).get("by"), "boss", "窓が決めた切断を画面へ渡す（見出しの知らせ）")

    def test_header_is_ignored_unless_the_shell_serves_access(self):
        # ブラウザ版（開発用のサーバー）と、権限を受け持たない前の窓では、見出しを信じない（だれでも付けられる）
        h = self.shell("開発者", "編集可")
        for env in ({"TPA_SHELL": "", "TPA_SHELL_SERVES": "lotlist,lists,access"}, {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,lists"}):
            with mock.patch.dict("os.environ", env):
                self.assertEqual(self.c.get("/api/access/me", headers=h).get_json()["loginId"], "u1", env)
                r = self.c.post("/api/masters/access", json={"ログインID": "x2", "PC名": "", "権限区分": "一般ユーザー"}, headers=h)
                self.assertEqual((r.status_code, r.get_json().get("kind")), (403, "forbidden"), env)

    def test_guard_is_left_to_the_shell_only_when_it_sent_me(self):
        # u1 は登録の無い人（管理する人が居る）＝部分的編集可: 管理のマスタは Python の門番が断る
        r = self.add_perm(ログインID="x1")
        self.assertEqual((r.status_code, r.get_json().get("kind")), (403, "forbidden"), "見出しが無ければ Python が門番")
        # 窓が通した問い合わせ（me を載せた）は、窓の判定を使う（Python は門番を繰り返さない）
        h = self.shell("開発者", "編集可")
        r = self.c.post("/api/masters/access", json={"ログインID": "x1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "編集可"}, headers=h)
        self.assertEqual(r.status_code, 201, r.get_json())

    def test_settings_tell_the_shell_where_to_read(self):
        d = self.c.get("/api/lotlist/settings").get_json()["access"]
        st = self.app.config["MASTER_STORE"]
        self.assertEqual((d["who"]["login"], d["who"]["pc"], d["who"]["key"]), ("u1", "PC-1", presence.terminal_key("u1", "PC-1")))
        self.assertEqual(d["place"]["shareDir"], str(st.share_dir))
        self.assertIn("access_permissions", d["place"]["shared"])
        self.assertIn("tab_access", d["place"]["shared"])
        self.assertEqual((d["place"]["cache"], d["place"]["data"]), (str(st.cache_dir), str(st.base / "data")))
