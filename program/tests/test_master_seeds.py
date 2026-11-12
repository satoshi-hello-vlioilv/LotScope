# -*- coding: utf-8 -*-
"""起動で一度だけ当てるマスタの初期値（services/master_seeds.py）。すでに共有にあるマスタにも届き、2回目は当てない。"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app.repositories.master_repository import MasterRepository
from app.repositories.master_store import MasterStore
from app.services import access, master_seeds

ROOT = Path(__file__).resolve().parents[1]


class Seeds(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "data", self.tmp / "app" / "data")
        self.share = self.tmp / "share"
        self.share.mkdir()
        # 共有にはもう前の版の設備マスタがある（検査計の列が無い・NS1 も無い）。権限はまだ無い
        old = [{k: v for k, v in r.items() if k != "検査計"} for r in json.loads((ROOT / "data" / "equipment_master.json").read_text(encoding="utf-8"))
               if r["設備名"] != "NS1"]
        (self.share / "equipment_master.json").write_text(json.dumps({"revision": 3, "rows": old}, ensure_ascii=False), encoding="utf-8")
        (self.share / "access_permissions.json").write_text(json.dumps({"revision": 1, "rows": [
            {"id": 1, "ログインID": "someone", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "編集可", "有効": "有"}]}, ensure_ascii=False), encoding="utf-8")
        self.store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"dir": str(self.share), "refresh_seconds": 0})
        self.repo = MasterRepository(self.store)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def meters(self):
        return sorted(r["設備名"] for r in self.repo.equipment() if r.get("検査計") == "有")

    def test_reaches_the_shared_master_once(self):
        self.assertEqual(self.meters(), [], "前の版の共有マスタには検査計が無い（同梱を直しても届かない）")
        self.assertEqual(len(master_seeds.run(self.store)), 3)
        self.assertEqual(self.meters(), ["DL2", "LS3", "LS4", "NS1", "TLV"], "NS1 が無ければ足す")
        f = access.flags(self.repo.access_permissions(), "Satoshi-Harada", "NLM-NGY-252134")
        self.assertEqual(f["role"], "開発者", "ログインIDは大小を問わず当たる")
        # 人があとで TLV の検査計を外した → 次の起動で戻さない
        tlv = next(r for r in self.repo.equipment() if r["設備名"] == "TLV")
        self.repo.equipment_update(tlv["id"], {"検査計": ""}, tlv["rev"])
        self.assertEqual(master_seeds.run(self.store), [], "2回目は当てない")
        self.assertNotIn("TLV", self.meters())

    def test_waits_for_a_short_lock_of_the_window_on_the_same_pc(self):
        """版 3.105.0（作った後の採点の落とし穴 1）: 起動の同じ瞬間に同じ PC の窓（係 rs）が種まきで共有の錠を持っていても、
        錠が外れるのを待って当てる（前は MasterLocked で止め、次の起動へ回した）"""
        import threading
        import time
        from datetime import datetime, timedelta
        lock = self.share / "master.lock.json"
        now = datetime.now()
        lock.write_text(json.dumps({"token": "t", "holder_pc": "PC", "holder_login": "u", "holder_instance": f"{self.store.instance}:rs",
                                    "acquired_at": now.isoformat(timespec="seconds"),
                                    "expires_at": (now + timedelta(seconds=20)).isoformat(timespec="seconds")}), encoding="utf-8")
        threading.Timer(1.5, lock.unlink).start()
        t0 = time.monotonic()
        self.assertEqual(len(master_seeds.run(self.store)), 3, "錠が外れるのを待って 3 つとも当てる")
        self.assertGreaterEqual(time.monotonic() - t0, 1.0, "錠が外れるまで待った")
        self.assertEqual(self.meters(), ["DL2", "LS3", "LS4", "NS1", "TLV"])

    def test_gives_up_after_the_tries_when_another_pc_holds_the_lock(self):
        """ほかの PC が長く保存している（錠が外れない）ときは、決めた回数で次の起動へ回す（止まり続けない）"""
        from datetime import datetime, timedelta
        from unittest import mock
        now = datetime.now()
        (self.share / "master.lock.json").write_text(json.dumps({
            "token": "t", "holder_pc": "PC-9", "holder_login": "u9", "holder_instance": "other:py",
            "acquired_at": now.isoformat(timespec="seconds"), "expires_at": (now + timedelta(seconds=60)).isoformat(timespec="seconds")}),
            encoding="utf-8")
        with mock.patch.object(master_seeds, "LOCKED_WAIT_SEC", 0.01):
            self.assertEqual(master_seeds.run(self.store), [], "錠が外れなければ当てない（次の起動で）")

    def test_kama_table_reaches_an_existing_conversions_master_once(self):
        """変換表「釜番日付」（版 3.51.2）: 共有にもう前の版の変換表があっても一度だけ足す。人が消したら戻さない。同じ名前の表があれば触らない"""
        old = [r for r in json.loads((ROOT / "app" / "master_defaults" / "conversions.json").read_text(encoding="utf-8")) if r["名前"] != "釜番日付"]
        (self.share / "conversions.json").write_text(json.dumps({"revision": 4, "rows": old}, ensure_ascii=False), encoding="utf-8")
        names = lambda: [r["名前"] for r in self.repo.conversions()]          # noqa: E731
        self.assertNotIn("釜番日付", names())
        master_seeds.run(self.store)
        self.assertEqual(names().count("釜番日付"), 1)
        got = next(r for r in self.repo.conversions() if r["名前"] == "釜番日付")
        self.assertEqual(got["その他"], "=kamadate([釜番])")
        self.assertEqual(int(got["表示順"]), max(int(r["表示順"]) for r in old) + 10, "最後に並ぶ")
        self.repo.conversion_delete(got["id"], got["rev"])
        master_seeds.run(self.store)
        self.assertNotIn("釜番日付", names(), "消した表は次の起動で戻さない")

    def test_does_not_override_existing_login_row(self):
        rows = self.repo.access_permissions()
        self.repo.access_permissions_update(rows[0]["id"], {"ログインID": "satoshi-harada", "権限区分": "メンテナンス者"}, rows[0]["rev"])
        master_seeds.run(self.store)
        got = [r for r in self.repo.access_permissions() if r["ログインID"] == "satoshi-harada"]
        self.assertEqual([r["権限区分"] for r in got], ["メンテナンス者"], "その ID の行がもうあれば足さない・変えない")

    def test_unreachable_share_records_nothing(self):
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local2", settings={"dir": str(self.tmp / "nowhere"), "refresh_seconds": 0})
        self.assertEqual(master_seeds.run(store), [])
        self.assertFalse((self.tmp / "nowhere").exists())


if __name__ == "__main__":
    unittest.main()
