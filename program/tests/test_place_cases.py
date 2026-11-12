# -*- coding: utf-8 -*-
"""置き場と設定 8 本（版 3.100.0）の事例の表 tests/fixtures/place_cases.json を、Python の道と独立の答え（tools/place-truth.py）で確かめる。

事例の答えは仕様（Microsoft の予約名と使えない字・work_log.scan の決まり・エクスプローラーの並び・利用者の決め）から人が書いた。
Python の部品と道（release_place.check_name・master_place・folder_browse・access.tab_exceptions・GET /api/masters/tabaccess・
POST /api/settings/check）が同じ答えか、独立の答え（app を import しない）も同じ答えかを見る。窓（desktop/src）も同じ表を
desktop/tests/place_cases.rs で読む（3.100.0 は名前とタブの例外。ほかは 3.101.0 で移すときに読む）。
引っ越し（POST /api/masters/place/move）は、独立の答え（錠を取った時の前の置き場の中身・os.stat の大きさ）と突き合わせる:
前の版は手元の写し（5 秒に 1 回の取り直し）から写し、ほかの PC が直前に保存した行を落とし、この PC が共有しないマスタと
利用状況の記録・切断の指示を写さず、写す量を字下げの無い字で数えていた。
Windows でだけ分かる事例（隠し・システムの属性・ドライブだけの「C:」）は Windows の CI（.github/workflows/desktop.yml）で流す。
"""
import ctypes
import importlib.util
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore
from app.services import access, folder_browse as fb, identity, master_place, release_place as rp
from app.services.db_mirror import DbMirror

PROGRAM = Path(__file__).resolve().parents[1]
CASES = json.loads((PROGRAM / "tests" / "fixtures" / "place_cases.json").read_text(encoding="utf-8"))
_spec = importlib.util.spec_from_file_location("place_truth", PROGRAM / "tools" / "place-truth.py")
truth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(truth)
ROOT_USER = hasattr(os, "geteuid") and os.geteuid() == 0


def mark_text(e):
    return (e.get("mark") or {}).get("text")


class TableAndTruth(unittest.TestCase):
    def test_the_table_agrees_with_the_independent_answer(self):
        self.assertEqual(truth.check_table(CASES), [])


class Names(unittest.TestCase):
    """フォルダの名前（配布の置き場とマスタの置き場の check_name）"""

    def test_names(self):
        for cs in CASES["names"]:
            with self.subTest(cs["name"]):
                if cs["ok"]:
                    self.assertEqual(rp.check_name(cs["name"]), cs["want"])
                else:
                    with self.assertRaises(ValueError) as e:
                        rp.check_name(cs["name"])
                    self.assertEqual(str(e.exception), cs["problem"])

    def test_the_master_place_refuses_the_same_names(self):
        with tempfile.TemporaryDirectory() as t:
            store = MasterStore(PROGRAM, local_root=Path(t) / "l", settings={"refresh_seconds": 0}, who={"pc": "P", "login": "u"})
            for n in (".Masters", "COM¹", "CONIN$", ".."):
                with self.subTest(n):
                    pl = master_place.plan(store, t, n)
                    self.assertFalse(pl["ok"])
                    self.assertEqual(pl["problem"], next(c["problem"] for c in CASES["names"] if c["name"] == n))


class Paths(unittest.TestCase):
    def test_clean(self):
        for cs in CASES["clean"]:
            if cs.get("os") and cs["os"] != os.name:
                continue
            with self.subTest(cs["text"]):
                self.assertEqual(fb.clean(cs["text"]), cs["want"])

    def test_crumbs_and_paths_have_no_dot_parts(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "c" / "s").mkdir(parents=True)
            d = fb.browse(f"{t}/c/../c", "folder")
            self.assertEqual(d["path"], str(Path(t) / "c"))
            self.assertNotIn("..", [x["name"] for x in d["crumbs"]])
            self.assertEqual(d["entries"][0]["path"], str(Path(t) / "c" / "s"))
            self.assertEqual(d["parent"], t)

    def test_sync_folder(self):
        for cs in CASES["sync"]:
            with self.subTest(cs["path"]):
                self.assertEqual(master_place.sync_folder(cs["path"]), cs["kind"])

    def test_sort_like_the_explorer(self):
        for cs in CASES["sort"]:
            with self.subTest(cs), tempfile.TemporaryDirectory() as t:
                for n in reversed(cs):
                    (Path(t) / n).mkdir()
                self.assertEqual([e["name"] for e in fb.browse(t, "folder")["entries"]], cs)


class Marks(unittest.TestCase):
    def test_marks(self):
        for cs in CASES["marks"]:
            if cs.get("os") and cs["os"] != os.name:
                continue
            with self.subTest(cs["name"]), tempfile.TemporaryDirectory() as t:
                d = Path(t) / "m"
                d.mkdir()
                for n in cs.get("files", []):
                    (d / n).write_bytes(b"x")
                for n in cs.get("dirs", []):
                    (d / n).mkdir()
                up = fb.browse(t, cs["purpose"], cs.get("pattern", ""))
                self.assertEqual(mark_text(next(e for e in up["entries"] if e["name"] == "m")), cs["want"], "上のフォルダの並びの印")
                self.assertEqual((fb.browse(str(d), cs["purpose"], cs.get("pattern", ""))["mark"] or {}).get("text"), cs["want"], "いまのフォルダの印")

    def test_the_worklog_mark_counts_what_the_folder_check_counts(self):
        """印の数と、参照先の「確かめる」（work_log.scan）の設備の数が同じ"""
        from app.services import work_log
        cs = CASES["marks"][0]
        with tempfile.TemporaryDirectory() as t:
            for n in cs["files"]:
                (Path(t) / n).write_bytes(b"x")
            for n in cs["dirs"]:
                (Path(t) / n).mkdir()
            self.assertEqual(cs["want"], f"ファイルのある設備 {len(work_log.scan(t, cs['pattern']))} 台")


class TabAccess(unittest.TestCase):
    def test_tab_exceptions(self):
        for cs in CASES["tabExceptions"]:
            with self.subTest(repr(cs["value"])):
                self.assertEqual(access.tab_exceptions(cs["value"]), cs["want"])

    def test_counts_on_the_route(self):
        """GET /api/masters/tabaccess の exceptions は効く行（有効・開発者でない）だけ。壊れた例外の字でも 500 にしない"""
        for cs in CASES["tabCounts"]:
            with self.subTest(cs["name"]), tempfile.TemporaryDirectory() as t:
                base = Path(t) / "app"
                (base / "data").mkdir(parents=True)
                rows = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}]
                rows += [{"id": i + 2, "PC名": "", "マスタ編集": "閲覧のみ", "rev": 1, **r} for i, r in enumerate(cs["rows"])]
                (base / "data" / "access_permissions.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
                store = MasterStore(base, local_root=Path(t) / "l", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "boss"})
                app = create_app({"MASTER_STORE": store, "APP_SETTINGS": {}, "BASE_DIR": base, "LOT_MIRROR": DbMirror("lot_list", "", Path(t) / "c")})
                with mock.patch.object(identity, "current_login_id", lambda: "boss"):
                    r = app.test_client().get("/api/masters/tabaccess")
                self.assertEqual(r.status_code, 200, r.data[:200])
                self.assertEqual(r.get_json()["exceptions"], cs["want"])


class Blank(unittest.TestCase):
    def test_blank_values(self):
        for cs in CASES["blank"]:
            with self.subTest(cs["key"]), tempfile.TemporaryDirectory() as t:
                group, leaf = cs["key"].rsplit(".", 1)
                settings = {}
                cur = settings
                for part in group.split("."):
                    cur = cur.setdefault(part, {})
                cur[leaf] = cs["default"]
                store = MasterStore(Path(t) / "app", local_root=Path(t) / "l", settings={"refresh_seconds": 0}, who={"pc": "P", "login": "u"})
                app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings, "BASE_DIR": Path(t) / "app",
                                  "LOT_MIRROR": DbMirror("lot_list", "", Path(t) / "c")})
                with mock.patch("app.services.lotdsp_direct.reachable", lambda *a, **k: False):
                    got = app.test_client().post("/api/settings/check", json={"key": cs["key"], "value": cs["value"]}).get_json()
                if cs["want"] is None:
                    self.assertNotEqual(got["message"], "値を入れてください。", "exe は空で Edge を探す")
                else:
                    self.assertEqual(got["message"], cs["want"])


class MoveBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.base = self.tmp / "base"
        shutil.copytree(PROGRAM / "data", self.base / "data")
        (self.tmp / "nas").mkdir()

    def store(self, pc, share="", refresh=0):
        return MasterStore(self.base, local_root=self.tmp / pc, settings={"dir": str(share), "refresh_seconds": refresh},
                           who={"pc": pc, "login": "u"})

    def check_written(self, pl, dest):
        """写す量（plan の files・bytes）が、書いた後のファイルの数と os.stat の大きさの計と同じ"""
        self.assertEqual((pl["files"], pl["bytes"]), truth.tree_size(dest), "画面に出す写す量＝実際に書いた量")


class Moves(MoveBase):
    def test_moves_copy_what_the_share_holds_at_the_lock(self):
        for i, cs in enumerate(CASES["moves"]):
            with self.subTest(cs["name"]):
                share = self.tmp / "nas" / f"Old{i}"
                for rel, body in cs["share"].items():
                    p = share / rel
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(body if isinstance(body, str) else json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
                a = self.store(f"pc{i}", share, refresh=5)
                if (share / "roll_master.json").exists():
                    a.read("roll_master")     # 写しを取った（5 秒は取り直さない）
                held = {}                 # 錠を取った時の前の置き場の中身（独立の答え: os.walk で読んだバイト）
                orig = a.exclusive

                def at_lock(orig=orig, share=share, held=held):
                    cm = orig()

                    class Wrap:
                        def __enter__(self_inner):
                            cm.__enter__()
                            held.update(truth.tree_bytes(share))
                            return None

                        def __exit__(self_inner, *e):
                            return cm.__exit__(*e)
                    return Wrap()
                a.exclusive = at_lock
                pl = master_place.plan(a, self.tmp / "nas", f"New{i}")
                self.assertTrue(pl["ok"], pl)
                master_place.move(a, self.tmp / "nas", f"New{i}")
                dest = self.tmp / "nas" / f"New{i}"
                self.assertEqual(truth.copied_names(share), sorted(cs["copied"]))
                got = truth.tree_bytes(dest)
                self.assertEqual(sorted(got), sorted(cs["copied"]), "写す物")
                for rel in cs["copied"]:
                    self.assertEqual(got[rel], held[rel], f"{rel} は錠を取った時の前の置き場の中身と同じ字")
                self.check_written(pl, dest)

    def test_a_save_just_before_the_move_is_carried(self):
        """ほかの PC が直前（写しの取り直しの 5 秒の間）に保存した行も、引っ越し先に入る（確か 1）"""
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        a = self.store("pcA", share, refresh=5)
        a.status()                                          # 写しを取った
        b = self.store("pcB", share)
        rid = MasterRepository(b).rolls_create({"設備": "TLV", "ロール名": "PC-B が直前に保存"})["id"]
        before = json.loads((share / "roll_master.json").read_text(encoding="utf-8"))
        master_place.move(a, self.tmp / "nas", "New")
        after = json.loads((self.tmp / "nas" / "New" / "roll_master.json").read_text(encoding="utf-8"))
        self.assertEqual(after, before, "引っ越し先＝前の置き場の今の中身")
        b2 = self.store("pcB", share)
        b2.follow_moved(force=True)
        self.assertIn(rid, [r["id"] for r in MasterRepository(b2).rolls()], "PC-B が印をたどった後も自分の行が見える")

    def test_a_presence_record_swept_while_moving_is_skipped(self):
        """利用状況は錠の外でほかの PC が片付ける（古い履歴を消す）。写す間に消えた記録は飛ばし、引っ越しは止めない"""
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        (share / "presence_tpa" / "history").mkdir(parents=True)
        (share / "presence_tpa" / "history" / "PC-X@u.json").write_text("{}", encoding="utf-8")
        real = master_place._read_bytes

        def gone(p):
            if p.name == "PC-X@u.json":
                raise FileNotFoundError(2, "No such file or directory")
            return real(p)
        with mock.patch.object(master_place, "_read_bytes", gone):
            pl = master_place.move(self.store("pcA", share), self.tmp / "nas", "New")
        self.assertFalse((self.tmp / "nas" / "New" / "presence_tpa" / "history" / "PC-X@u.json").exists())
        self.check_written(pl, self.tmp / "nas" / "New")

    def test_local_only_counts_what_it_writes(self):
        a = self.store("pcL")
        pl = master_place.plan(a, self.tmp / "nas", "M")
        self.assertTrue(pl["ok"], pl)
        master_place.move(a, self.tmp / "nas", "M")
        self.check_written(pl, self.tmp / "nas" / "M")

    def test_the_note_says_records_are_copied(self):
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        pl = master_place.plan(self.store("pcA", share), self.tmp / "nas", "New")
        self.assertIn("利用状況の記録と切断の指示も写します", pl["note"])


class MoveRaces(MoveBase):
    def test_a_save_while_a_slow_move_holds_the_lock_is_not_lost(self):
        """引っ越しが錠の長さを超えると、ほかの PC は錠を切れたと見て前の置き場へ保存する。その行が引っ越し先に入らないまま切り替えると、
        その PC が印をたどった後に行が消える（作った後の採点の割れ 2）。マスタだけを錠の中で写し、錠の長さの半分を過ぎたら切り替えずに止める"""
        for cs in CASES["moveRaces"]:
            with self.subTest(cs["name"]):
                share = self.tmp / "nas" / "Masters"
                master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
                hist = share / "presence_tpa" / "history"
                hist.mkdir(parents=True)
                for i in range(cs["presenceFiles"]):
                    (hist / f"PC-{i}@u.json").write_text("{}", encoding="utf-8")
                a = self.store("pcA", share)
                a.lock_ttl = cs["lockTtl"]
                b = self.store("pcB", share)
                b.lock_ttl = cs["lockTtl"]
                real = master_place._read_bytes
                started = threading.Event()

                def slow(p):
                    started.set()
                    time.sleep(cs["readDelay"])
                    return real(p)
                box = {}

                def other_pc():
                    started.wait(10)
                    time.sleep(cs["saveAfter"])
                    end = time.monotonic() + 20
                    while time.monotonic() < end:
                        try:
                            def add(rows, stamp):
                                rid = max([int(r.get("id") or 0) for r in rows] + [0]) + 1
                                rows.append({"id": rid, "ログインID": "race", "PC名": "", "権限区分": "一般ユーザー", "有効": "有", "rev": 1})
                                return rid
                            box["rid"] = b.write(cs["master"], add)
                            return
                        except Exception:          # noqa: BLE001 保存中（錠）。待って送り直す（画面と同じ）
                            time.sleep(0.1)
                th = threading.Thread(target=other_pc)
                th.start()
                with mock.patch.object(master_place, "_read_bytes", slow):
                    try:
                        master_place.move(a, self.tmp / "nas", "New")
                        box["moved"] = True
                    except ValueError as e:
                        box["moved"] = str(e)
                th.join(30)
                self.assertIn("rid", box, "ほかの PC は保存できた")
                b2 = self.store("pcB", share)
                b2.follow_moved(force=True)
                where = truth.followed(share)
                self.assertIn(box["rid"], truth.row_ids(where, cs["master"]), f"印をたどった先（{where}）に、ほかの PC の行がある（{box['moved']}）")
                self.assertIn(box["rid"], [r["id"] for r in b2.read(cs["master"])])
                self.assertFalse([p for p in (self.tmp / "nas").iterdir() if ".tmp-" in p.name], "写しかけを残さない")


class MoveRoute(MoveBase):
    """POST /api/masters/place/move の道（版 3.101.0）"""

    def client(self, share):
        st = self.store("pcR", share)
        perm = {"schema": 1, "revision": 1, "updated_at": "", "updated_by": {},
                "rows": [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}]}
        (share / "access_permissions.json").write_text(json.dumps(perm, ensure_ascii=False), encoding="utf-8")
        pats = [mock.patch.object(identity, "current_login_id", lambda: "boss"),
                mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": "PC-1", "source": "試験", "tried": []})]
        for p in pats:
            p.start()
            self.addCleanup(p.stop)
        return create_app({"TESTING": True, "MASTER_STORE": st}).test_client()

    def test_a_held_lock_is_answered_not_a_500(self):
        """ほかの PC が保存中（錠）のときの引っ越しは、保存の道と同じく 409 と「保存中です」で答える（前は MasterLocked が道の外へ出て 500）"""
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        c = self.client(share)
        from datetime import datetime, timedelta
        now = datetime.now()
        (share / "master.lock.json").write_text(json.dumps({
            "token": "x", "holder_pc": "PC-9", "holder_login": "o", "holder_instance": "z:py", "acquired_at": now.isoformat(timespec="seconds"),
            "expires_at": (now + timedelta(seconds=20)).isoformat(timespec="seconds")}), encoding="utf-8")
        r = c.post("/api/masters/place/move", data=json.dumps({"parent": str(self.tmp / "nas"), "name": "New"}), content_type="application/json")
        self.assertEqual(r.status_code, 409, r.get_json())
        self.assertEqual(r.get_json()["kind"], "locked")
        self.assertIn("保存中", r.get_json()["error"])
        self.assertFalse([p for p in (self.tmp / "nas").iterdir() if ".tmp-" in p.name], "写しかけを残さない")

    def test_the_window_is_the_one_mover(self):
        """窓が place を名乗ったら、Python は写さずに 409（写す係は窓の 1 つ。配布の置き場と同じ型）"""
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        c = self.client(share)
        with mock.patch.dict(os.environ, {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "place"}):
            r = c.post("/api/masters/place/move", data=json.dumps({"parent": str(self.tmp / "nas"), "name": "New"}),
                       content_type="application/json")
        self.assertEqual((r.status_code, r.get_json()["kind"]), (409, "busy"))
        self.assertFalse((self.tmp / "nas" / "New").exists())


class Sources(unittest.TestCase):
    def test_the_modules_compile_without_warnings(self):
        """置き場と設定の部品の字が、警告なしに読める（版 3.101.0: folder_browse の説明の「C:\」が無効な逃がし字の SyntaxWarning だった。
        Python の次の版では誤りになる）"""
        import warnings
        for name in ("folder_browse", "master_place", "release_place", "path_settings", "access"):
            src = (PROGRAM / "app" / "services" / f"{name}.py").read_text(encoding="utf-8")
            with self.subTest(name), warnings.catch_warnings():
                warnings.simplefilter("error")
                compile(src, f"{name}.py", "exec")


class PlanProblems(MoveBase):
    def test_unreadable_new_place_is_a_problem_not_a_500(self):
        (self.tmp / "nas" / "M").mkdir()
        boom = PermissionError(13, "Permission denied")
        with mock.patch.object(master_place, "is_master_place", side_effect=boom):
            pl = master_place.plan(self.store("pcA"), self.tmp / "nas", "M")
        self.assertFalse(pl["ok"])
        self.assertTrue(pl["problem"].startswith("新しい場所を読めません（Permission denied）"), pl["problem"])
        with mock.patch.object(Path, "iterdir", side_effect=boom):
            pl = rp.plan("", str(self.tmp / "nas"), "M")
        self.assertFalse(pl["ok"])
        self.assertTrue(pl["problem"].startswith("新しい場所を読めません（Permission denied）"), pl["problem"])

    @unittest.skipIf(ROOT_USER or os.name == "nt", "権限で読めないフォルダは root でない利用者でだけ作れる（CI の Linux）")
    def test_unreadable_new_place_for_real(self):
        m = self.tmp / "nas" / "M"
        m.mkdir()
        m.chmod(0)
        self.addCleanup(m.chmod, 0o755)
        app = create_app({"MASTER_STORE": self.store("pcA"), "APP_SETTINGS": {}, "BASE_DIR": self.base,
                          "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "c")})
        for url in ("/api/masters/place/check", "/api/release/place/check"):
            r = app.test_client().post(url, json={"parent": str(self.tmp / "nas"), "name": "M"})
            self.assertEqual(r.status_code, 200, r.data[:200])
            self.assertTrue(r.get_json()["problem"].startswith("新しい場所を読めません"), r.get_json())

    def test_cannot_write_is_found_by_trying(self):
        """Windows の os.access はフォルダを常に書ける扱い（ACL を見ない）。試しに一時フォルダを作って確かめる（疑い 1）"""
        real = os.mkdir

        def refuse(p, *a, **k):
            if ".probe-" in str(p):
                raise PermissionError(13, "Access is denied")
            return real(p, *a, **k)
        with mock.patch("os.access", lambda *a, **k: True), mock.patch("os.mkdir", refuse):
            pl = master_place.plan(self.store("pcA"), self.tmp / "nas", "M")
        self.assertFalse(pl["ok"])
        self.assertIn("書き込めません", pl["problem"])
        self.assertEqual([p.name for p in (self.tmp / "nas").iterdir()], [], "試しのフォルダを残さない")


    def test_share_root_switches_to_an_existing_place(self):
        """全員の置き場が共有の根（\\\\srv\\share）。画面は上のフォルダ「\\\\srv」と名前「share」に分けて送る（疑い 8。本物の共有の根は Windows でだけ作れる）"""
        seen = []

        def fake(folder):
            seen.append(str(folder))
            return str(folder).rstrip("\\") == "\\\\srv\\share"      # Windows の Path は共有の根を末尾の \\ つきで書く
        with mock.patch.object(master_place, "is_master_place", fake):
            pl = master_place.plan(self.store("pcA"), "\\\\srv", "share")
            self.assertEqual((pl["ok"], pl["mode"], pl["dest"].rstrip("\\")), (True, "switch", "\\\\srv\\share"), pl)
            pl = master_place.plan(self.store("pcA"), "\\\\srv", "other")
        self.assertFalse(pl["ok"])
        self.assertIn("共有の根", pl["problem"])


class SlowShare(MoveBase):
    def test_status_and_place_do_not_wait_for_a_slow_share(self):
        """届かない共有（SMB は 1 か所数十秒待つことがある）を、まとめて区切った秒で打ち切り、届かないと答える（疑い 2）"""
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        a = self.store("pcA", share, refresh=60)
        a.status()                       # 写しを取った（読む道は 60 秒は共有を見ない。見るのは置き場の状態の道だけ）
        app = create_app({"MASTER_STORE": a, "APP_SETTINGS": {}, "BASE_DIR": self.base, "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "c")})
        gate = threading.Event()
        self.addCleanup(gate.set)
        real_dir = Path.is_dir

        def slow_dir(p):
            if str(p).startswith(str(share)):
                gate.wait(5)
            return real_dir(p)
        with mock.patch.object(master_place, "SHARE_PROBE_SEC", 0.3, create=True), mock.patch.object(Path, "is_dir", slow_dir):
            for url in ("/api/masters/status", "/api/masters/place"):
                t0 = time.monotonic()
                r = app.test_client().get(url)
                self.assertLess(time.monotonic() - t0, 2.5, url)
                self.assertEqual(r.status_code, 200)
                d = r.get_json()
                self.assertIsNone(d["reachable"], url)        # 区切りで終わらない＝確かめ中（届かないとは言わない。採点の割れ 1）
                if "using" in d:
                    self.assertTrue(all(u["reachable"] is None for u in d["using"] if u["dir"] == str(share)), d["using"])


class SlowButReachable(MoveBase):
    def test_a_slow_share_is_checking_not_down_and_saving_still_works(self):
        """遅いが届く共有（is_dir に 3 秒）。置き場の状態は区切った秒で打ち切り、reachable は null（確かめ中）。false（届かない）にすると
        画面がマスタ管理の保存を全部止める（作った後の採点の割れ 1）。保存そのものは届くので通る"""
        share = self.tmp / "nas" / "Masters"
        master_place.move(self.store("pcS"), self.tmp / "nas", "Masters")
        a = self.store("pcA", share, refresh=60)
        a.status()
        app = create_app({"MASTER_STORE": a, "APP_SETTINGS": {}, "BASE_DIR": self.base, "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "c")})
        real_dir = Path.is_dir

        def slow_dir(p):
            if str(p) == str(share):
                time.sleep(3)
            return real_dir(p)
        with mock.patch.object(master_place, "SHARE_PROBE_SEC", 0.3), mock.patch.object(Path, "is_dir", slow_dir):
            for url in ("/api/masters/status", "/api/masters/place"):
                t0 = time.monotonic()
                d = app.test_client().get(url).get_json()
                self.assertLess(time.monotonic() - t0, 2.5, url)
                self.assertIsNone(d["reachable"], f"{url}: 区切りで終わらないのは確かめ中（null）")
                if "using" in d:
                    self.assertTrue(all(u["reachable"] is None for u in d["using"] if u["dir"] == str(share)), d["using"])
            rid = MasterRepository(a).rolls_create({"設備": "TLV", "ロール名": "遅い共有でも保存できる"})["id"]
        self.assertIn(rid, [r["id"] for r in json.loads((share / "roll_master.json").read_text(encoding="utf-8"))["rows"]])


@unittest.skipUnless(os.name == "nt", "Windows の CI だけ（隠し・システムの属性・ドライブだけの字）")
class WindowsOnly(unittest.TestCase):
    def test_hidden_and_system_entries_are_not_listed(self):
        with tempfile.TemporaryDirectory() as t:
            for cs in CASES["hidden"]:
                p = Path(t) / cs["name"]
                p.write_bytes(b"x") if cs.get("file") else p.mkdir()
                bits = (2 if "h" in cs["attrs"] else 0) | (4 if "s" in cs["attrs"] else 0)
                if bits:
                    self.assertTrue(ctypes.windll.kernel32.SetFileAttributesW(str(p), bits | (16 if not cs.get("file") else 0)))
            d = fb.browse(t, "exe")
            shown = [e["name"] for e in d["entries"]]
            for cs in CASES["hidden"]:
                if not cs.get("file"):
                    self.assertEqual(cs["name"] in shown, cs["shown"], cs["name"])
            self.assertEqual(d["others"], sum(1 for c in CASES["hidden"] if c.get("file") and c["shown"]), "隠しのファイルは「ほか」にも数えない")

    def test_drive_only_reads_as_its_root(self):
        drive = os.environ.get("SystemDrive", "C:")
        d = fb.browse(drive, "folder")
        self.assertEqual((d["path"], d["exists"], d["problem"]), (drive + "\\", True, ""))


if __name__ == "__main__":
    unittest.main()
