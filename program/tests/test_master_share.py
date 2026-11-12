# -*- coding: utf-8 -*-
"""マスタの共有と競合管理（app/repositories/master_store.py・WaveLog §9.263／§9.384 と同じ考え方）。

2台の PC（名乗りと手元の写しの置き場が別）を1つのプロセスの中に作り、同じ共有フォルダを取り合わせて確かめる。

物差し（評価関数）
  ① 読むのは手元の写し（共有をほかの PC が書き換えても、取り直すまでは写しを読む）
  ② 書く前に共有から取り直す（ほかの PC の変更を踏み潰さない）・版番号が1つずつ上がる
  ③ 同じ行を後から保存したら断る（誰が・いつ変えたかを返す）。消された行も断る
  ④ 錠: ほかの PC が保存中なら「誰が・あと何秒」で断る。自分の残した錠は引き継ぐ。切れた錠は取れる。
     名乗れない PC は自分と見なさない。錠の期限は相手の時計を信じず、この PC で見てからの経過で測る（時計のずれで保存中の錠をどけない）。
     名乗りが同じ別の PC（手元の置き場が別）の錠は引き継がない。保存が錠の長さを超えて長引き、その間にほかの PC が保存したら、
     長引いた方は書かずに断る（後の保存を黙って消さない）
  ⑤ 共有に届かない: 読みは写しで続け、書きは断る（写しだけ書くと PC ごとにずれる）
  ⑥ 2台×10件を同時に追加しても、全部残り、id が重ならない
  ⑦ API は 409（locked／conflict／duplicate）・503（unavailable）で理由を返す
"""
import json
import shutil
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app import create_app
from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import (DuplicateKey, MasterLocked, MasterStore, RowConflict,
                                           ShareUnavailable)

ROOT = Path(__file__).resolve().parents[1]


class Env:
    """一時の アプリ（data/ の写し）・共有フォルダ・PC ごとの手元の置き場。"""

    def __init__(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base = self.tmp / "app"
        shutil.copytree(ROOT / "data", self.base / "data")
        self.share = self.tmp / "share"
        self.share.mkdir()

    def store(self, pc, login="user", refresh=0.0, ttl=20.0, share=None, root=None):
        cfg = {"dir": str(share or self.share), "refresh_seconds": refresh, "lock_ttl_seconds": ttl}
        return MasterStore(self.base, local_root=self.tmp / (root or f"local-{pc or 'noname'}"), settings=cfg,
                           who={"pc": pc, "login": login})

    def repo(self, *a, **k):
        return MasterRepository(self.store(*a, **k))

    def share_doc(self, name="roll_master"):
        return json.loads((self.share / f"{name}.json").read_text(encoding="utf-8"))

    def put_lock(self, pc, login="user", seconds=10, instance=""):
        now = datetime.now()
        (self.share / "master.lock.json").write_text(json.dumps({
            "token": "x", "holder_pc": pc, "holder_login": login, "holder_instance": instance,
            "acquired_at": now.isoformat(), "expires_at": (now + timedelta(seconds=seconds)).isoformat()},
            ensure_ascii=False), encoding="utf-8")

    @staticmethod
    def seen_long_ago(store, token="x"):
        """この PC が錠（token）を、錠の長さより前から見ていたことにする（見てからの経過で切れたかを測るので）"""
        store._lock_seen[token] = time.monotonic() - 2 * store.lock_ttl

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def save_until_done(save, limit=60):
    """画面と同じく、錠待ちは粘って取り直す（諦めるまでを回数ではなく時間で決める。遅い CI でも揺れない）。できたら True"""
    t0 = time.monotonic()
    while True:
        try:
            save()
            return True
        except MasterLocked:
            if time.monotonic() - t0 > limit:
                return False
            time.sleep(0.01)


class Base(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.bundled = json.loads((self.env.base / "data" / "roll_master.json").read_text(encoding="utf-8"))

    def tearDown(self):
        self.env.close()


class LocalMode(Base):
    """共有しない設定（dir が空）は、これまでどおり data/ を読み書きする。行の版はここでも効く。"""

    def test_local_crud_and_row_conflict(self):
        repo = MasterRepository(MasterStore(self.env.base, local_root=self.env.tmp / "l", settings={}))
        row = repo.rolls_create({"設備": "TLV", "ロール名": "試験"})
        self.assertEqual(row["rev"], 1)
        saved = json.loads((self.env.base / "data" / "roll_master.json").read_text(encoding="utf-8"))
        self.assertIsInstance(saved, list, "同梱の data/ は行の配列の形のまま")
        repo.rolls_update(row["id"], {"備考": "A"}, base_rev=1)
        with self.assertRaises(RowConflict):
            repo.rolls_update(row["id"], {"備考": "B"}, base_rev=1)   # 同じ PC の別の画面が古い版で保存
        with self.assertRaises(DuplicateKey):
            repo.equipment_create({"設備名": "ｔｌｖ"})                  # 全角・小文字でも同じ名前


class Roles(Base):
    """係（版 3.64.0）: 同じ PC・同じ作業場所（同じ instance_id）で Python と窓（Rust）が並んで書いても、互いの生きた錠を
    「自分が残した錠」と取り違えない（順 5 の採点で、取り違えると保存が黙って消える順を再現した。scratchpad/m5/lockrepro.py）。"""

    def pair(self):
        py = self.env.store("PC-A", login="me", root="pc1")
        rs = MasterStore(self.env.base, local_root=self.env.tmp / "pc1", settings={"dir": str(self.env.share)},
                         who={"pc": "PC-A", "login": "me"}, role="rs")
        self.assertEqual(py.instance, rs.instance, "同じ作業場所なのでアプリの印は同じ")
        self.assertNotEqual(py.holder, rs.holder, "錠の持ち主の印は係で分かれる")
        return py, rs

    def test_live_lock_of_the_other_role_is_not_taken(self):
        py, rs = self.pair()
        py._acquire_lock()
        with self.assertRaises(MasterLocked):
            rs._acquire_lock()
        py2, rs2 = self.pair()
        (self.env.share / "master.lock.json").unlink()
        rs2._acquire_lock()
        with self.assertRaises(MasterLocked):
            py2._acquire_lock()

    def test_save_of_the_other_role_while_saving_is_refused(self):
        """保存の途中（当てている間）にもう 1 つの係が同じマスタを保存しようとしても断られ、どちらの保存も黙っては消えない"""
        py, rs = self.pair()
        a, b = MasterRepository(py), MasterRepository(rs)
        a.rolls()
        box = {}

        def mutate(rows, stamp):
            try:
                b.rolls_update(1, {"備考": "窓の保存"})
                box["b"] = "saved"
            except MasterLocked:
                box["b"] = "locked"
            rows[0]["備考"] = "Python の保存"
            return None
        py.write("roll_master", mutate)
        self.assertEqual(box["b"], "locked")
        self.assertEqual({r["id"]: r for r in self.env.share_doc()["rows"]}[1]["備考"], "Python の保存")

    def test_own_leftover_with_role_and_legacy_lock(self):
        """自分の係の残した錠は引き継ぐ。係の無い錠（版 3.63.0 まで）は Python の物: Python は引き継ぎ、窓は引き継がない"""
        py, rs = self.pair()
        self.env.put_lock("PC-A", login="me", seconds=15, instance=py.holder)
        py._release_lock(py._acquire_lock())
        self.env.put_lock("PC-A", login="me", seconds=15, instance=rs.holder)
        rs._release_lock(rs._acquire_lock())
        self.env.put_lock("PC-A", login="me", seconds=15, instance=py.instance)
        with self.assertRaises(MasterLocked):
            rs._acquire_lock()
        py._release_lock(py._acquire_lock())


class Holder(Base):
    """錠の持ち主の見分け（PC 名・ログイン・アプリの印・係）と、断りの言葉"""

    def test_same_instance_on_another_pc_name_is_not_the_holder(self):
        """作業場所ごと複製した PC（アプリの印とログインが同じで、PC 名が違う）の生きた錠は引き継がない"""
        a = self.env.store("PC-A", login="me", root="pc1")
        b = self.env.store("PC-B", login="me", root="pc1")
        self.assertEqual(a.instance, b.instance)
        a._acquire_lock()
        with self.assertRaises(MasterLocked):
            b._acquire_lock()

    def test_lock_without_instance_key_is_not_mine(self):
        """アプリの印の欄が無い錠（もっと前の版・手で置いた錠）は自分の物と見ない（生きている間は断る）"""
        a = self.env.store("PC-A", login="me", root="pc1")
        now = datetime.now()
        (self.env.share / "master.lock.json").write_text(json.dumps({
            "token": "y", "holder_pc": "PC-A", "holder_login": "me",
            "acquired_at": now.isoformat(), "expires_at": (now + timedelta(seconds=15)).isoformat()}), encoding="utf-8")
        with self.assertRaises(MasterLocked):
            a._acquire_lock()

    def test_seed_takes_the_lock(self):
        """共有にまだ無いマスタを読むときの最初の版（seed）も錠を取る。ほかの PC が保存中なら置かない（読みは手元で続く）"""
        a = self.env.store("PC-A")
        self.env.put_lock("PC-B", seconds=15)
        rows = a.read("conversions")
        self.assertTrue(rows, "読みは最初の中身で続く")
        self.assertFalse((self.env.share / "conversions.json").exists(), "錠が取れない間は共有に置かない")

    def test_seed_looks_again_under_the_lock(self):
        """seed は錠を取った後に共有を見直す: 錠を取る直前にほかの PC が最初の版を置いたら、上書きしない"""
        a, b = self.env.store("PC-A"), self.env.store("PC-B")
        real = a._acquire_lock

        def b_seeds_first():
            b.write("conversions", lambda rows, stamp: rows.append({"id": 9101, "by": "PC-B"}))
            return real()
        a._acquire_lock = b_seeds_first
        a.read("conversions")
        ids = {r.get("id") for r in json.loads((self.env.share / "conversions.json").read_text(encoding="utf-8"))["rows"]}
        self.assertIn(9101, ids, "ほかの PC の保存は残る")

    def test_seed_after_the_share_file_is_lost_uses_the_mirror(self):
        """共有のファイルが消えたとき、置き直す最初の版は手元の写し（全員の行）から。同梱の中身からにすると全員の行が消える"""
        a = self.env.store("PC-A")
        a.write("conversions", lambda rows, stamp: rows.append({"id": 9201, "by": "共有にあった行"}))
        (self.env.share / "conversions.json").unlink()
        a2 = self.env.store("PC-A")            # 同じ作業場所（写しは残る）で開き直す
        self.assertIn(9201, {r.get("id") for r in a2.read("conversions")})
        ids = {r.get("id") for r in json.loads((self.env.share / "conversions.json").read_text(encoding="utf-8"))["rows"]}
        self.assertIn(9201, ids)

    def test_lock_message_names_the_holder_correctly(self):
        py = self.env.store("PC-A", login="me", root="pc1")
        rs = MasterStore(self.env.base, local_root=self.env.tmp / "pc1", settings={"dir": str(self.env.share)},
                         who={"pc": "PC-A", "login": "me"}, role="rs")
        rs._acquire_lock()
        with self.assertRaises(MasterLocked) as cm:
            py._acquire_lock()
        self.assertIn("この PC のもう 1 つの係", str(cm.exception))
        (self.env.share / "master.lock.json").unlink()
        twin = self.env.store("PC-A", login="me", root="pc2")      # 名乗りが同じ別の PC（作業場所が別）
        twin._acquire_lock()
        with self.assertRaises(MasterLocked) as cm:
            py._acquire_lock()
        self.assertNotIn("もう 1 つの係", str(cm.exception))
        self.assertIn("PC-A", str(cm.exception))
        (self.env.share / "master.lock.json").unlink()
        self.env.put_lock("PC-A", login="me", seconds=15, instance="")   # 前の版の、印の無い錠（ほかの作業場所の物と見る）
        with self.assertRaises(MasterLocked) as cm:
            py._acquire_lock()
        self.assertNotIn("もう 1 つの係", str(cm.exception))


class LocalLock(Base):
    """共有しない PC（dir が空）でも data/ に同じ錠を取る（版 3.64.0）。前は錠を取らずプロセスの中の _write_lock だけで、
    同じ PC の 2 つの係が同じマスタを書くと後の保存が黙って消えた（順 5 の 2 回目の採点で再現）。"""

    def local(self, role):
        return MasterStore(self.env.base, local_root=self.env.tmp / "l", settings={}, who={"pc": "PC-A", "login": "me"}, role=role)

    def test_save_while_another_role_saves_is_refused(self):
        py, rs = self.local("py"), self.local("rs")
        a, b = MasterRepository(py), MasterRepository(rs)
        row = a.rolls_create({"設備": "TLV", "ロール名": "錠の試験"})
        box = {}

        def mutate(rows, stamp):
            try:
                b.rolls_update(row["id"], {"備考": "窓の保存"})
                box["b"] = "saved"
            except MasterLocked:
                box["b"] = "locked"
            next(r for r in rows if r["id"] == row["id"])["備考"] = "Python の保存"
            return None
        py.write("roll_master", mutate)
        self.assertEqual(box["b"], "locked", "当てている間のもう 1 つの係の保存は断る（黙って消さない）")
        saved = json.loads((self.env.base / "data" / "roll_master.json").read_text(encoding="utf-8"))
        self.assertIsInstance(saved, list, "同梱の data/ は行の配列の形のまま")
        self.assertEqual(next(r for r in saved if r["id"] == row["id"])["備考"], "Python の保存")
        self.assertFalse((self.env.base / "data" / "master.lock.json").exists(), "保存の後は錠を外す")
        b.rolls_update(row["id"], {"備考": "あとで窓の保存"})
        saved = json.loads((self.env.base / "data" / "roll_master.json").read_text(encoding="utf-8"))
        self.assertEqual(next(r for r in saved if r["id"] == row["id"])["備考"], "あとで窓の保存")

    def test_read_happens_after_the_lock(self):
        """当てる前の読みは錠を取った後: 錠を取る直前にもう 1 つの係が保存しても、その保存の上で当てる（初めて保存するマスタも）"""
        for name in ("roll_master", "pivot_presets"):   # data/ にある物と、まだ無い物（初めての保存）
            with self.subTest(name=name):
                (self.env.base / "data" / "master.lock.json").unlink(missing_ok=True)
                py, rs = self.local("py"), self.local("rs")
                real = py._acquire_lock

                def other_saves_first(real=real, rs=rs, name=name):
                    rs.write(name, lambda rows, stamp: rows.append({"id": 9001, "by": "rs"}))
                    return real()
                py._acquire_lock = other_saves_first
                py.write(name, lambda rows, stamp: rows.append({"id": 9002, "by": "py"}))
                ids = {r.get("id") for r in py.read(name)}
                self.assertTrue({9001, 9002} <= ids, f"{name}: 先の保存が残る（{sorted(i for i in ids if i and i > 9000)}）")

    def test_same_pc_lock_message_names_the_other_role(self):
        py, rs = self.local("py"), self.local("rs")
        with rs._lock_here(True):
            rs._acquire_lock()
        with self.assertRaises(MasterLocked) as cm:
            MasterRepository(py).rolls_update(1, {"備考": "x"})
        self.assertIn("この PC のもう 1 つの係", str(cm.exception))

    def test_mixed_settings_local_and_shared_masters(self):
        """共有するマスタを絞った設定（共有の中に手元だけのマスタがある）: 手元のマスタは data/ の錠、共有のマスタは共有の錠で、
        互いに邪魔しない。手元の保存の後も、同じ糸の共有の保存は共有の錠を取る（置き場の切り替えを戻す）"""
        st = MasterStore(self.env.base, local_root=self.env.tmp / "m", settings={"dir": str(self.env.share), "masters": ["equipment_master"]},
                         who={"pc": "PC-A", "login": "me"})
        repo = MasterRepository(st)
        self.assertFalse(st.is_shared("roll_master"))
        self.assertTrue(st.is_shared("path_settings"))
        self.env.put_lock("PC-B", seconds=15)                         # 共有はほかの PC が保存中
        row = repo.rolls_create({"設備": "TLV", "ロール名": "手元だけ"})   # 手元のマスタは共有の錠に邪魔されない
        self.assertIn(row["id"], {r["id"] for r in repo.rolls()}, "手元の保存は読み直しに出る")
        self.assertFalse(getattr(st._where, "local", False), "手元の保存の後は、置き場の切り替えを共有に戻す")
        with self.assertRaises(MasterLocked):
            st.write("path_settings", lambda rows, stamp: rows.append({"id": 1}))   # 共有のマスタは共有の錠を見る
        self.assertTrue((self.env.share / "master.lock.json").exists())
        self.assertFalse((self.env.base / "data" / "master.lock.json").exists(), "手元の錠は残さない")

    def test_switch_is_per_thread(self):
        """手元の保存（data/ の錠）の最中に、別の糸が共有のマスタを保存しても、その糸は共有の錠を取る（置き場の切り替えは糸ごと）"""
        st = MasterStore(self.env.base, local_root=self.env.tmp / "t", settings={"dir": str(self.env.share), "masters": ["equipment_master"]},
                         who={"pc": "PC-A", "login": "me"})
        box = {}

        def mutate(rows, stamp):
            th = threading.Thread(target=lambda: box.update(r=st._lock_file()))
            th.start()
            th.join(5)
            box["mine"] = st._lock_file()
            return None
        st.write("roll_master", mutate)
        self.assertEqual(box["mine"], self.env.base / "data" / "master.lock.json")
        self.assertEqual(box["r"], self.env.share / "master.lock.json", "別の糸の置き場は共有のまま")

    def test_first_local_save_of_a_master_with_defaults(self):
        """入れたばかりの手元だけの PC（data/ に無く、最初の中身〈app/master_defaults〉がある変換表）の初めての保存:
        最初の中身の上で当て、保存できる（いつまでも断らない・中身を減らさない）"""
        st = self.local("py")
        first = st.read("conversions")
        self.assertFalse((self.env.base / "data" / "conversions.json").exists())
        self.assertGreater(len(first), 1, "最初の中身がある")
        st.write("conversions", lambda rows, stamp: rows.append({"id": 9999, "name": "足した表"}))
        after = st.read("conversions")
        self.assertEqual(len(after), len(first) + 1, "最初の中身は残して 1 つ足す")

    def test_broken_lock_is_taken_after_its_time(self):
        """書きかけ・壊れた錠（中身の読めない錠）が残っても、錠の長さを過ぎればどけて保存できる（手元・共有とも。前は
        どけた物を「ほかの錠」と見て元へ戻し、いつまでも断っていた）"""
        st = MasterStore(self.env.base, local_root=self.env.tmp / "b", settings={"lock_ttl_seconds": 0.3}, who={"pc": "PC-A", "login": "me"})
        (self.env.base / "data" / "master.lock.json").write_text("{書きかけ", encoding="utf-8")
        with self.assertRaises(MasterLocked):
            MasterRepository(st).rolls_update(1, {"備考": "すぐは断る"})
        time.sleep(0.5)
        MasterRepository(st).rolls_update(1, {"備考": "壊れた錠の後"})
        self.assertFalse((self.env.base / "data" / "master.lock.json").exists())
        sh = self.env.store("PC-A", ttl=0.3)
        sh.read("roll_master")
        (self.env.share / "master.lock.json").write_text("", encoding="utf-8")
        with self.assertRaises(MasterLocked):
            sh.write("roll_master", lambda rows, stamp: None)
        time.sleep(0.5)
        sh.write("roll_master", lambda rows, stamp: None)

    def test_two_roles_saving_side_by_side_keep_every_save(self):
        """手元だけの PC で 2 つの係が並んで保存し続けても（錠待ちは取り直す）、保存できたと言った行はどれも残る（置き換えは錠の中）"""
        py, rs = self.local("py"), self.local("rs")
        errors = []

        def run(st, tag):
            for i in range(15):
                ok = save_until_done(lambda i=i: st.write("pivot_presets", lambda rows, stamp: rows.append({"id": f"{tag}{i}"})))
                if not ok:
                    errors.append(f"{tag}{i}")
        ts = [threading.Thread(target=run, args=(py, "p")), threading.Thread(target=run, args=(rs, "r"))]
        for t in ts:
            t.start()
        for t in ts:
            t.join(120)
        ids = {r.get("id") for r in py.read("pivot_presets")}
        self.assertEqual(errors, [])
        said = {f"p{i}" for i in range(15)} | {f"r{i}" for i in range(15)}
        self.assertEqual(said - ids, set(), "保存できたと言った行は残る")

    def test_taking_away_a_broken_lock_keeps_a_new_live_lock(self):
        """壊れた錠をどけるつもりで、その間にもう 1 つの係が取り直した生きた錠をどけたら、元へ戻す（消さない）"""
        py, rs = self.local("py"), self.local("rs")
        with rs._lock_here(True):
            token = rs._acquire_lock()
        with py._lock_here(True):
            self.assertEqual(py._take_away("broken:1:2"), "other")
            self.assertEqual((py._read_lock() or {}).get("token"), token, "相手の錠は元のまま")

    def test_file_changed_under_the_lock_is_refused(self):
        """錠を持たない書き手（前の版など）が当てている間にファイルを変えたら、置き換えずに断る"""
        py = self.local("py")
        a = MasterRepository(py)
        row = a.rolls_create({"設備": "TLV", "ロール名": "外の書き手"})
        path = self.env.base / "data" / "roll_master.json"

        def mutate(rows, stamp):
            time.sleep(0.02)
            path.write_text(json.dumps(json.loads(path.read_text(encoding="utf-8")) + [{"id": 9999}], ensure_ascii=False), encoding="utf-8")
            next(r for r in rows if r["id"] == row["id"])["備考"] = "上書きしない"
            return None
        with self.assertRaises(MasterLocked):
            py.write("roll_master", mutate)
        self.assertTrue(any(r.get("id") == 9999 for r in json.loads(path.read_text(encoding="utf-8"))), "外の書き手の保存は残る")


class ReadFromMirror(Base):
    def test_seed_and_read_mirror(self):
        a = self.env.repo("PC-A", refresh=60)
        self.assertEqual(len(a.rolls()), len(self.bundled), "最初は同梱の data/ から共有へ置く")
        doc = self.env.share_doc()
        self.assertEqual((doc["revision"], len(doc["rows"])), (1, len(self.bundled)))
        # ほかの PC が共有を直接書き換える
        doc["rows"][0]["備考"] = "共有で変えた"
        doc["revision"] = 2
        (self.env.share / "roll_master.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        self.assertNotEqual(a.rolls()[0]["備考"], "共有で変えた", "①取り直すまでは手元の写しを読む")
        a.store._maybe_refresh("roll_master", force=True)
        self.assertEqual(a.rolls()[0]["備考"], "共有で変えた", "取り直せば見える（取りこぼしではない）")
        self.assertEqual(json.loads((self.env.base / "data" / "roll_master.json").read_text(encoding="utf-8")),
                         self.bundled, "共有にしたあと、同梱の data/ は書き換えない")


class WriteCycle(Base):
    def test_write_pulls_first_and_bumps_revision(self):
        a = self.env.repo("PC-A", refresh=60)
        b = self.env.repo("PC-B", refresh=60)
        a.rolls()
        b.rolls()                                    # 両方とも写しを持つ（版1）
        x = b.rolls_update(1, {"備考": "B が変更"}, base_rev=1)  # 共有は版2
        y = a.rolls_update(2, {"備考": "A が変更"}, base_rev=1)  # A の写しは古い（版1）まま書く
        rows = {r["id"]: r for r in self.env.share_doc()["rows"]}
        self.assertEqual(rows[1]["備考"], "B が変更", "②A の保存が B の変更を踏み潰していない")
        self.assertEqual(rows[2]["備考"], "A が変更")
        self.assertEqual(self.env.share_doc()["revision"], 3)
        self.assertEqual((x["updated_by"]["pc"], y["updated_by"]["pc"]), ("PC-B", "PC-A"))
        self.assertFalse((self.env.share / "master.lock.json").exists(), "錠は保存のあと返す")

    def test_same_row_conflict_and_deleted_row(self):
        a = self.env.repo("PC-A", refresh=60)
        b = self.env.repo("PC-B", refresh=60)
        opened = a.rolls()[0]                                   # A が編集画面を開いた（版1）
        b.rolls_update(opened["id"], {"備考": "B が先に保存"}, base_rev=1)
        with self.assertRaises(RowConflict) as cm:
            a.rolls_update(opened["id"], {"備考": "A があとで保存"}, base_rev=opened["rev"])
        cur = cm.exception.current
        self.assertEqual((cur["備考"], cur["rev"], cur["updated_by"]["pc"]), ("B が先に保存", 2, "PC-B"))
        self.assertIn("PC-B", str(cm.exception), "③誰が変えたかを言う")
        with self.assertRaises(RowConflict):
            a.rolls_delete(opened["id"], base_rev=1)            # 古い版のまま消そうとした
        a.rolls_update(opened["id"], {"備考": "A が見直して保存"}, base_rev=2)   # 最新を見てからなら通る
        b.rolls_delete(opened["id"], base_rev=3)
        with self.assertRaises(RowConflict) as cm:
            a.rolls_update(opened["id"], {"備考": "消えた行へ"}, base_rev=3)
        self.assertIsNone(cm.exception.current)
        self.assertIn("削除", str(cm.exception))

    def test_duplicate_equipment_name_across_pcs(self):
        a = self.env.repo("PC-A", refresh=60)
        b = self.env.repo("PC-B", refresh=60)
        a.equipment()
        b.equipment()
        b.equipment_create({"設備名": "NEW-1"})
        with self.assertRaises(DuplicateKey):
            a.equipment_create({"設備名": "new-1"})            # A の写しにはまだ無いが、取り直して気づく


class Lock(Base):
    def test_other_pc_holds_lock(self):
        a = self.env.repo("PC-A")
        a.rolls()
        self.env.put_lock("PC-B", seconds=10)
        with self.assertRaises(MasterLocked) as cm:
            a.rolls_update(1, {"備考": "x"})
        e = cm.exception
        self.assertEqual(e.holder_pc, "PC-B")
        self.assertTrue(5 <= e.remaining <= 11, e.remaining)
        self.assertIn("PC-B", str(e))
        self.assertEqual(json.loads((self.env.share / "master.lock.json").read_text(encoding="utf-8"))["holder_pc"],
                         "PC-B", "④ほかの PC の錠は消さない")

    def test_own_leftover_lock_is_taken_over(self):
        a = self.env.repo("PC-A", login="me")
        a.rolls()
        self.env.put_lock("PC-A", login="me", seconds=15, instance=a.store.instance)   # 前回うまく消せなかった自分の錠
        a.rolls_update(1, {"備考": "引き継いで保存"})
        self.assertEqual({r["id"]: r for r in self.env.share_doc()["rows"]}[1]["備考"], "引き継いで保存")
        again = self.env.store("PC-A", login="me")
        self.assertEqual(again.instance, a.store.instance, "アプリの印は手元の置き場に残り、開き直しても同じ")

    def test_same_name_on_another_pc_is_not_the_holder(self):
        """名乗り（PC 名・ログイン ID）が同じでも、手元の置き場が別の PC（端末の名前を同じに付けた・複製した仮想 PC）の錠は
        引き継がない（引き継ぐと、相手の保存中に書いて、どちらかの保存が黙って消える）。"""
        a = self.env.store("PC-A", login="me", root="pc1")
        twin = self.env.store("PC-A", login="me", root="pc2")
        self.assertNotEqual(a.instance, twin.instance)
        a._acquire_lock()
        with self.assertRaises(MasterLocked):
            twin._acquire_lock()

    def test_leftover_lock_of_a_pc_with_clock_ahead_is_taken_after_the_ttl(self):
        """時計が 1 時間進んだ PC が落ちて残した錠（期限が 1 時間先に書いてある）も、この PC で見てから錠の長さが経てば取れる
        （前は、書かれた期限が錠の長さより先の間ずっと錠の長さを返し、時計のずれの分〈1 時間〉取れなかった）"""
        a = self.env.repo("PC-A", ttl=0.3)
        a.rolls()
        self.env.put_lock("PC-B", seconds=3600)
        with self.assertRaises(MasterLocked):
            a.rolls_update(1, {"備考": "見てすぐは断る"})
        time.sleep(0.5)
        a.rolls_update(1, {"備考": "錠の長さの後は取れる"})

    def test_expired_lock_is_taken(self):
        a = self.env.repo("PC-A")
        a.rolls()
        self.env.put_lock("PC-B", seconds=-1)
        self.env.seen_long_ago(a.store)
        a.rolls_update(1, {"備考": "切れた錠のあとで保存"})

    def test_clock_ahead_does_not_take_a_live_lock(self):
        """相手の錠に書かれた期限が（この PC の時計で）切れて見えても、この PC で見てから錠の長さが経つまではどけない
        （時計が 30 秒進んだ PC が、保存中の錠をどけて書くと、保存中の方が取り直した古い中身で上書きして、こちらの保存が消える）。"""
        a = self.env.repo("PC-A")
        a.rolls()
        self.env.put_lock("PC-B", seconds=-30)
        with self.assertRaises(MasterLocked) as cm:
            a.rolls_update(1, {"備考": "x"})
        self.assertTrue(15 <= cm.exception.remaining <= 21, cm.exception.remaining)
        self.assertEqual(json.loads((self.env.share / "master.lock.json").read_text(encoding="utf-8"))["holder_pc"], "PC-B")

    def test_nameless_pc_is_not_the_holder(self):
        a = self.env.repo("", login="")
        a.rolls()
        self.env.put_lock("", login="", seconds=10)
        with self.assertRaises(MasterLocked):
            a.rolls_update(1, {"備考": "x"})

    def test_lock_that_could_not_be_written_is_not_left(self):
        """錠を「無ければ作る」で作れても、中身を書けない（共有の空きが尽きた ENOSPC など）ときは、作った空の錠を残さない（版 3.99.0）。
        前は 0 バイトの錠が残り、ほかの PC・次に開いた窓が、見てから錠の長さ（20 秒）のあいだ「ほかの PC がマスタを保存中です」で断られた
        （手元の窓の通しの 6 段目。空きが尽きた時に開いた新しい PC の Python が、起動の最初の写しを置く錠で作って残した）"""
        import errno
        from unittest import mock

        from app.repositories import master_store
        a = self.env.repo("PC-A")
        a.rolls()
        lock = self.env.share / "master.lock.json"
        real = master_store.os.write

        def full(fd, data):
            if master_store.os.fstat(fd).st_ino == lock.stat().st_ino:
                raise OSError(errno.ENOSPC, "No space left on device")
            return real(fd, data)

        with mock.patch.object(master_store.os, "write", side_effect=full):
            with self.assertRaises(ShareUnavailable) as cm:
                a.rolls_update(1, {"備考": "空きが無い"})
        self.assertIn("錠を置けません", str(cm.exception))
        self.assertFalse(lock.exists(), "書けなかった錠（0 バイト）を残さない")
        b = self.env.repo("PC-B")
        b.rolls()
        b.rolls_update(1, {"備考": "空きが戻ればすぐ保存できる"})   # 前は 20 秒「PC-A でない、名乗りの無い PC が保存中」で断られた
        self.assertEqual({r["id"]: r for r in self.env.share_doc()["rows"]}[1]["備考"], "空きが戻ればすぐ保存できる")

    def test_lock_written_short_is_not_left(self):
        """書けたのが途中まで（短い書き込みのあとに ENOSPC）でも、書きかけの錠を残さない。ほかの PC の錠は消さない"""
        import errno
        from unittest import mock

        from app.repositories import master_store
        lock = self.env.share / "master.lock.json"
        calls = []

        def half(fd, data):
            calls.append(len(data))
            if len(calls) == 1:
                return master_store.os.write.__wrapped__(fd, bytes(data)[:7])
            raise OSError(errno.ENOSPC, "No space left on device")

        with mock.patch.object(master_store.os, "write", side_effect=half) as w:
            w.__wrapped__ = __import__("os").write
            with self.assertRaises(OSError):
                MasterStore._create_exclusive(lock, b'{"token": "mine"}')
        self.assertEqual(len(calls), 2, "短く書けたら残りを書き足す")
        self.assertFalse(lock.exists(), "書きかけの錠を残さない")
        self.env.put_lock("PC-B")
        with mock.patch.object(master_store.os, "write", side_effect=OSError(errno.ENOSPC, "No space left on device")):
            with self.assertRaises(FileExistsError):
                MasterStore._create_exclusive(lock, b'{"token": "mine"}')
        self.assertEqual(json.loads(lock.read_text(encoding="utf-8"))["holder_pc"], "PC-B", "ほかの PC の錠は消さない")


class SeedLock(Base):
    """版 3.105.0（作った後の採点の落とし穴 2）: 共有にまだ無いマスタを読むとき、ほかの係（同じ時に読んだ窓・別の PC）の錠に当たったら、
    理由を _errors に入れずに写しで答え、次に読むときに置く（前は当たった名前の理由が、その回の状態の帯に「…保存中です」と出た。窓も同じ）"""

    def test_a_lock_on_seeding_is_not_reported_and_the_next_read_seeds(self):
        st = self.env.store("PC-1")
        self.env.put_lock("PC-2", seconds=20, instance="other:rs")
        self.assertEqual(st.read("roll_master"), self.bundled, "同梱の data/ を読んで答える")
        self.assertFalse((self.env.share / "roll_master.json").exists(), "錠の間は置かない")
        self.assertEqual(st._last_error, "", "種まきの錠は理由に入れない")
        (self.env.share / "master.lock.json").unlink()
        st.read("roll_master")
        self.assertTrue((self.env.share / "roll_master.json").exists(), "錠が外れた後に読むと置く")


class Unreachable(Base):
    def test_read_continues_write_refused(self):
        a = self.env.repo("PC-A")
        before = a.rolls()
        moved = self.env.tmp / "share-off"
        self.env.share.rename(moved)                             # 共有が見えなくなった
        self.assertEqual(a.rolls(), before, "⑤読みは手元の写しで続く")
        with self.assertRaises(ShareUnavailable):
            a.rolls_update(1, {"備考": "x"})
        st = a.store.status()
        self.assertFalse(st["reachable"])
        self.assertTrue(st["error"])


class Concurrency(Base):
    def test_two_pcs_ten_creates_each(self):
        repos = [self.env.repo("PC-A", ttl=5), self.env.repo("PC-B", ttl=5)]
        for r in repos:
            r.rolls()
        errors = []

        def worker(repo, n):
            for i in range(10):
                if not save_until_done(lambda: repo.rolls_create({"設備": f"{repo.store.who['pc']}", "ロール名": f"{n}-{i}"})):
                    errors.append((n, i))

        ts = [threading.Thread(target=worker, args=(r, r.store.who["pc"])) for r in repos]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        rows = self.env.share_doc()["rows"]
        added = [r for r in rows if r.get("ロール名", "").startswith("PC-")]
        self.assertEqual(errors, [])
        self.assertEqual(len(added), 20, "⑥同時に追加しても全部残る")
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)), "id が重ならない")
        self.assertEqual(self.env.share_doc()["revision"], 21)


class LockRaces(Base):
    """共有の錠（master.lock.json）を2台が同時に持てないか。たまたまの順番に頼らず、危ない順番を試験の中で起こす。
    （2026-10-02 の Windows の CI で、2台が同時に追加して1件消えたことがあった。そのとき錠がどの順番で重なったかは記録に無い）"""

    def stores(self, ttl=20.0):
        return self.env.store("PC-A", ttl=ttl), self.env.store("PC-B", ttl=ttl)

    def holder(self):
        return json.loads((self.env.share / "master.lock.json").read_text(encoding="utf-8"))["token"]

    def test_lock_removed_just_before_reading_is_not_overwritten(self):
        """B の作成が断られる → A が外して、すぐ取り直す → B が「錠が無い」と読む。B は上書きで取ってはいけない。"""
        a, b = self.stores()
        a1 = a._acquire_lock()
        real = MasterStore._read_lock
        box = {}

        def b_reads(self_):
            if "a2" not in box:
                a._release_lock(a1)
                v = real(self_)                    # 錠は無い（None）
                box["a2"] = a._acquire_lock()      # B が次に動く前に、A が取り直す
                return v
            return real(self_)
        b._read_lock = b_reads.__get__(b)
        with self.assertRaises(MasterLocked):
            b._acquire_lock()
        self.assertEqual(self.holder(), box["a2"], "錠は A のまま")

    def test_expired_lock_is_taken_over_by_one_only(self):
        """切れた錠を2台が同時に見つけても、引き継げるのは1台だけ。"""
        self.env.put_lock("PC-X", seconds=-5)
        a, b = self.stores()
        self.env.seen_long_ago(a)
        self.env.seen_long_ago(b)
        real = MasterStore._read_lock
        box = {}

        def a_reads(self_):
            v = real(self_)
            if "b" not in box:
                box["b"] = b._acquire_lock()      # A が「切れている」と読んだ直後に、B が先に引き継ぐ
            return v
        a._read_lock = a_reads.__get__(a)
        with self.assertRaises(MasterLocked):
            a._acquire_lock()
        self.assertEqual(self.holder(), box["b"], "錠は B のまま")

    def test_release_does_not_remove_someone_elses_lock(self):
        """A の錠が（長くかかって）切れ、A が外す直前に B が引き継いだ。A は B の錠を消してはいけない。
        割り込ませるのは「A が錠のファイルを消す・どける直前」（消し方が unlink でも名前の変更でも、同じ瞬間を突く）。"""
        from unittest import mock
        from app.repositories import master_store as ms
        a, b = self.env.store("PC-A", ttl=0.05), self.env.store("PC-B")
        a1 = a._acquire_lock()
        time.sleep(0.1)                           # A の錠が切れる
        self.env.seen_long_ago(b, a1)             # B は A の錠を前から見ていた
        lock = self.env.share / "master.lock.json"
        box = {}

        def b_cuts_in():
            if "b" not in box:
                box["b"] = None
                box["b"] = b._acquire_lock()

        real_replace, real_unlink = ms.os.replace, Path.unlink

        def replace(src, dst, *k):
            if Path(src) == lock:
                b_cuts_in()
            return real_replace(src, dst, *k)

        def unlink(self_, *k, **kw):
            if Path(self_) == lock:
                b_cuts_in()
            return real_unlink(self_, *k, **kw)
        with mock.patch.object(ms.os, "replace", replace), mock.patch.object(Path, "unlink", unlink):
            a._release_lock(a1)
        self.assertTrue(box.get("b"), "B が割り込んで錠を取った")
        self.assertTrue(lock.exists(), "B の錠が残っている")
        self.assertEqual(self.holder(), box["b"])

    def test_slow_save_does_not_overwrite_a_later_save(self):
        """A の保存が錠の長さを超えて長引き、その間に B が（切れた錠をどけて）保存した。A は取り直した時の古い中身で
        上書きしてはいけない（B の保存が黙って消える）。A は書かずに断り、送り直せば B の保存の上に当たる。"""
        a, b = self.env.repo("PC-A", ttl=0.3), self.env.repo("PC-B", ttl=0.3)
        a.rolls()
        b.rolls()
        rows = {r["id"]: r for r in a.rolls()}
        first, second = sorted(rows)[:2]

        def slow(rows_, stamp):
            for r in rows_:
                if r["id"] == first:
                    r["備考"] = "A（長引いた）"
            self.assertTrue(save_until_done(lambda: b.rolls_update(second, {"備考": "B（後から）"}), limit=10), "B は錠が切れてから保存できる")
        with self.assertRaises(MasterLocked):
            a.store.write("roll_master", slow)
        got = {r["id"]: r for r in self.env.share_doc()["rows"]}
        self.assertEqual(got[second]["備考"], "B（後から）", "B の保存は消えない")
        self.assertNotEqual(got[first]["備考"], "A（長引いた）", "A は書かなかった")
        a.rolls_update(first, {"備考": "A（送り直し）"})
        got = {r["id"]: r for r in self.env.share_doc()["rows"]}
        self.assertEqual((got[first]["備考"], got[second]["備考"]), ("A（送り直し）", "B（後から）"), "送り直すと両方残る")

    def test_three_pcs_many_creates(self):
        """3 台が同時に 15 件ずつ追加しても、全部残り、版がちょうど件数ぶん進む。
        錠は早い者勝ち（順番待ちの列は無い）。ここでは 3 台が休まずに続けて保存するので、錠を返した台がそのまま取り直し、
        1 台が長く待つことがある（人の保存ではまず起きない）。確かめたいのは「消えない・版が狂わない」なので、
        諦めるまでは回数ではなく時間で決める（以前の 400 回 × 5ms は、Windows の CI の遅さで 2 秒を超えて「諦めた」になった）。"""
        repos = [self.env.repo(f"PC-{c}", ttl=5) for c in "ABC"]
        for r in repos:
            r.rolls()
        start = self.env.share_doc()["revision"]
        errors, waits = [], []

        def worker(repo):
            for i in range(15):
                t0 = time.monotonic()
                while True:
                    try:
                        repo.rolls_create({"設備": repo.store.who["pc"], "ロール名": f"{repo.store.who['pc']}-{i}"})
                        break
                    except MasterLocked:
                        if time.monotonic() - t0 > 60:
                            errors.append((repo.store.who["pc"], i))
                            break
                        time.sleep(0.005)
                waits.append(time.monotonic() - t0)

        ts = [threading.Thread(target=worker, args=(r,)) for r in repos]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        doc = self.env.share_doc()
        added = [r for r in doc["rows"] if str(r.get("ロール名", "")).startswith("PC-")]
        self.assertEqual(errors, [], f"60 秒待っても保存できなかった（いちばん長い待ち {max(waits):.1f} 秒）")
        self.assertEqual(len(added), 45)
        self.assertEqual(doc["revision"], start + 45)


class SameProcess(Base):
    """同じプロセスの中の糸どうし（版 3.94.0 の CI）。起動の直後に並んだ道が、共有にまだ無いマスタの最初の版（seed）を置くとき、
    同じ係のほかの糸の生きた錠を「自分が残した錠」と見てどけると、持っていた方の保存が途中で断られ（MASTER_WRITE_ABORT）、
    外すときに戻した空の錠が名乗りの無い「ほかの PC が保存中（あと約20秒）」として残った。"""

    def test_seed_does_not_take_a_live_lock_of_the_same_role(self):
        a, b = self.env.store("PC-A", login="me", root="pc1"), self.env.store("PC-A", login="me", root="pc1")
        self.assertEqual(a.holder, b.holder, "同じ作業場所の同じ係")
        box = {}

        def mutate(rows, stamp):
            def seed():
                try:
                    box["b"] = "seeded" if b._pull("conversions") else "not seeded"
                except MasterLocked:
                    box["b"] = "locked"
            th = threading.Thread(target=seed)
            th.start()
            th.join(10)
            rows.append({"id": 1})
        a.write("equipment_groups", mutate)               # 前は b が錠をどけ、ここで MasterLocked（保存が途中で断られた）
        # 生きた錠はどけない。版 3.105.0 から種まきの錠は理由に入れず（投げず）、写しで答えて次に読むときに置く
        self.assertEqual(box["b"], "not seeded", "生きた錠はどけない")
        self.assertFalse((self.env.share / "master.lock.json").exists(), "錠は残らない")
        b._pull("conversions")
        self.assertTrue((self.env.share / "conversions.json").exists(), "錠が外れたら最初の版を置ける")
        self.env.put_lock("PC-A", login="me", seconds=15, instance=a.holder)   # 自分が落ちて残した錠は今までどおり引き継ぐ
        a.write("equipment_groups", lambda rows, stamp: rows.append({"id": 2}))

    def test_threads_of_one_store_wait_for_each_other_to_seed(self):
        a = self.env.store("PC-A", login="me", root="pc1")
        box = {}

        def mutate(rows, stamp):
            th = threading.Thread(target=lambda: box.update(b=a._pull("conversions")))
            th.start()
            time.sleep(0.2)
            box["th"] = th
            rows.append({"id": 1})
        a.write("equipment_groups", mutate)
        box["th"].join(10)
        self.assertTrue(box.get("b"), "保存の後に最初の版を置く（断って写しで続けない）")
        self.assertTrue((self.env.share / "conversions.json").exists())
        self.assertFalse((self.env.share / "master.lock.json").exists())

    def test_release_does_not_leave_an_empty_lock_behind(self):
        """外すとき、どけた錠が自分の物でなく中身もまだ無い（ほかが作って書く前）なら戻さない。戻した空の錠はだれの物でもない"""
        py = self.env.store("PC-A", login="me", root="pc1")
        rs = MasterStore(self.env.base, local_root=self.env.tmp / "pc1", settings={"dir": str(self.env.share)},
                         who={"pc": "PC-A", "login": "me"}, role="rs")
        lock = self.env.share / "master.lock.json"
        token = rs._acquire_lock()
        lock.unlink()
        lock.write_bytes(b"")                             # 自分の錠がどけられ、ほかが作った直後（まだ書いていない）
        rs._release_lock(token)
        self.assertFalse(lock.exists(), "空の錠を戻して残さない")
        py._pull("ui_defaults")                           # 前はここで「ほかの PC がマスタを保存中です（あと約20秒）」
        self.assertTrue((self.env.share / "ui_defaults.json").exists())
        token = rs._acquire_lock()
        lock.unlink()
        self.env.put_lock("PC-B", seconds=15)            # 書き終えたほかの錠は元へ戻す
        rs._release_lock(token)
        self.assertEqual(json.loads(lock.read_text(encoding="utf-8"))["holder_pc"], "PC-B")


class Api(Base):
    def client(self, store):
        app = create_app({"MASTER_STORE": store})
        return app.test_client()

    def test_api_reports_reasons(self):
        a = self.client(self.env.store("PC-A"))
        b_repo = self.env.repo("PC-B")
        row = a.get("/api/masters/rolls").get_json()[0]
        b_repo.rolls_update(row["id"], {"備考": "B"}, base_rev=row["rev"])
        r = a.put(f"/api/masters/rolls/{row['id']}", json={"備考": "A", "base_rev": row["rev"]})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["kind"], "conflict")
        self.assertEqual(r.get_json()["current"]["備考"], "B")
        r = a.delete(f"/api/masters/rolls/{row['id']}?rev={row['rev']}")
        self.assertEqual((r.status_code, r.get_json()["kind"]), (409, "conflict"))
        r = a.post("/api/masters/equipment", json={"設備名": "TLV"})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (409, "duplicate"))
        self.env.put_lock("PC-B", seconds=10)
        r = a.post("/api/masters/rolls", json={"設備": "X"})
        self.assertEqual((r.status_code, r.get_json()["kind"], r.get_json()["holder_pc"]), (409, "locked", "PC-B"))
        (self.env.share / "master.lock.json").unlink()
        st = a.get("/api/masters/status").get_json()
        self.assertEqual((st["mode"], st["reachable"], st["who"]["pc"]), ("shared", True, "PC-A"))
        self.assertGreaterEqual(st["masters"]["roll_master"]["revision"], 2)
        self.env.share.rename(self.env.tmp / "gone")
        r = a.post("/api/masters/rolls", json={"設備": "X"})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (503, "unavailable"))
        self.assertEqual(a.get("/api/masters/rolls").status_code, 200, "読みは続く")

    def test_calculation_uses_shared_rolls(self):
        """計算（ロール候補）も同じ置き場のマスタを読む。"""
        store = self.env.store("PC-A")
        MasterRepository(self.env.store("PC-B")).rolls_create({"設備": "TLV", "ロール名": "共有で足した", "ロール径MAX": "610"})
        names = [r["ロール名"] for r in MasterRepository(store).rolls() if r["設備"] == "TLV"]
        self.assertIn("共有で足した", names)


if __name__ == "__main__":
    unittest.main()
