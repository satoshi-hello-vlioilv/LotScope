"""マスタの置き場を画面から変える（services/master_place.py・MasterStore.retarget / follow_moved）。"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app.repositories.master_store import MOVED_FILENAME, MasterStore
from app.services import master_place

PROGRAM = Path(__file__).resolve().parents[1]


class MasterPlaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base = self.tmp / "base"          # 同梱の data/（手元のみのマスタ）を写した物。リポジトリを汚さない
        shutil.copytree(PROGRAM / "data", self.base / "data")
        (self.tmp / "nas").mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def store(self, pc, share=""):
        return MasterStore(self.base, local_root=self.tmp / pc, settings={"dir": share, "refresh_seconds": 0}, who={"pc": pc, "login": "u"})

    def test_local_to_shared_copies_and_remembers(self):
        a = self.store("pcA")
        rows = len(a.read("equipment_master"))
        pl = master_place.plan(a, self.tmp / "nas", "Masters")
        self.assertTrue(pl["ok"], pl)
        self.assertEqual(pl["mode"], "copy")
        master_place.move(a, self.tmp / "nas", "Masters")
        dest = self.tmp / "nas" / "Masters"
        self.assertTrue((dest / "equipment_master.json").is_file(), "マスタを写した")
        self.assertEqual(a.status()["dir"], str(dest))
        self.assertEqual(len(a.read("equipment_master")), rows, "写した後も同じ行")
        self.assertFalse(any(p.name.startswith(".Masters.tmp") for p in (self.tmp / "nas").iterdir()), "一時フォルダを残さない")
        again = self.store("pcA")                        # 開き直しても、覚えた置き場を使う
        self.assertEqual(again.status()["dir"], str(dest))

    def test_other_pcs_follow_the_moved_marker(self):
        old = self.tmp / "nas" / "Old"
        a = self.store("pcA")
        master_place.move(a, self.tmp / "nas", "Old")
        b = self.store("pcB", share=str(old))           # 設定ファイルで古い置き場を見ている PC
        self.assertEqual(b.status()["dir"], str(old))
        master_place.move(a, self.tmp / "nas", "New")
        self.assertTrue((old / MOVED_FILENAME).is_file(), "前の置き場に引っ越し先の印")
        b.read("equipment_master")                      # 読みに行くついでに印を見て移る
        self.assertEqual(b.status()["dir"], str(self.tmp / "nas" / "New"))
        self.assertEqual(self.store("pcB", share=str(old)).status()["dir"], str(self.tmp / "nas" / "New"), "移った先を覚える")
        c = self.store("pcC", share=str(old))           # 新しく入れた PC も、古い置き場から印をたどる
        c.read("roll_master")
        self.assertEqual(c.status()["dir"], str(self.tmp / "nas" / "New"))

    def test_moving_back_to_an_earlier_place_does_not_make_a_loop(self):
        """前に使った置き場へ「写さずに切り替える」で戻しても、引っ越し先の印が輪にならない（版 3.34.0。利用者の置き場で
        Masters → Quality-Analyzer → Apps\\LotScope → Masters と戻したとき、Masters に古い印が残り、各 PC が輪の途中の古い置き場へ移り続けた）。
        印は新しい順にしかたどらない（前の印より古い印は、もう使われていない）・戻した先の古い印は消す。"""
        nas = self.tmp / "nas"
        a = self.store("pcA")
        master_place.move(a, nas, "Masters")
        b = self.store("pcB", share=str(nas / "Masters"))
        master_place.move(a, nas, "Quality-Analyzer")
        master_place.move(a, nas, "LotScope")
        self.assertEqual(master_place.plan(a, nas, "Masters")["mode"], "switch", "既にマスタがある置き場へは、写さずに切り替える")
        master_place.move(a, nas, "Masters")
        self.assertFalse((nas / "Masters" / MOVED_FILENAME).exists(), "戻した先の古い印は消す")
        for pc in (a, b, self.store("pcC", share=str(nas / "Quality-Analyzer")), self.store("pcD", share=str(nas / "LotScope"))):
            for _ in range(3):                           # 何度読みに行っても、同じ置き場に落ち着く
                pc.follow_moved(force=True)
                pc.read("equipment_master")
            self.assertEqual(pc.status()["dir"], str(nas / "Masters"), f"{pc.who['pc']} は今の置き場へ")

    def test_old_loop_left_on_the_share_is_still_followed_to_the_newest_place(self):
        """前の版で既に輪になった印が共有に残っていても（戻した先の印を消す前の版で戻した）、印の時刻の新しい順にたどり、今の置き場に落ち着く。"""
        nas = self.tmp / "nas"
        for n in ("A", "B", "C"):
            master_place.move(self.store("pcX"), nas, n) if not (nas / n).exists() else None
        (nas / "A" / MOVED_FILENAME).write_text('{"to": "%s", "at": "2026-10-10T18:32:00"}' % (nas / "B").as_posix(), encoding="utf-8")
        (nas / "B" / MOVED_FILENAME).write_text('{"to": "%s", "at": "2026-10-15T06:18:00"}' % (nas / "C").as_posix(), encoding="utf-8")
        (nas / "C" / MOVED_FILENAME).write_text('{"to": "%s", "at": "2026-10-15T14:27:00"}' % (nas / "A").as_posix(), encoding="utf-8")
        for start in ("A", "B", "C"):
            pc = self.store(f"pc{start}", share=str(nas / start))
            for _ in range(3):
                pc.follow_moved(force=True)
            self.assertEqual(Path(pc.status()["dir"]), nas / "A", f"{start} から始めても今の置き場（A）へ")

    def pin(self, pc, folder, at):
        """窓が配る版の覚え（distribute.json）を作業場所へ写した物（want.json）に、全員が使う置き場を書く"""
        (self.tmp / pc).mkdir(parents=True, exist_ok=True)
        (self.tmp / pc / "want.json").write_text(json.dumps({"schema": 1, "version": "3.34.0", "masters": {"dir": str(folder), "setAt": at}}),
                                                 encoding="utf-8")

    def test_every_pc_follows_the_master_place_in_the_distributed_version(self):
        """配る版の覚えにある置き場（版 3.34.0）へ、どの PC も移る: 古い置き場を見ている PC・手元のみの PC・引っ越し先の印が別を指す PC。
        届かない・マスタが無い置き場なら移らない。この PC で人が選んだ方が新しければ、古い覚えには従わない。"""
        nas = self.tmp / "nas"
        a = self.store("pcA")
        for n in ("Old", "Masters"):
            master_place.move(a, nas, n)
        (nas / "Old" / MOVED_FILENAME).write_text(json.dumps({"to": str(nas / "Elsewhere"), "at": "2026-10-15T00:00:00"}), encoding="utf-8")
        (nas / "Elsewhere").mkdir()
        for pc, share in (("pcB", nas / "Old"), ("pcC", "")):
            self.pin(pc, nas / "Masters", "2099-01-01T00:00:00")
            st = self.store(pc, share=str(share))
            st.read("equipment_master")
            self.assertEqual(st.status()["dir"], str(nas / "Masters"), f"{pc} は配る版の覚えの置き場へ")
            self.assertEqual(st.status()["pin"]["dir"], str(nas / "Masters"))
        self.pin("pcD", nas / "無い", "2099-01-01T00:00:00")
        d = self.store("pcD", share=str(nas / "Masters"))
        d.follow_moved(force=True)
        self.assertEqual(d.status()["dir"], str(nas / "Masters"), "届かない置き場へは移らない")
        self.pin("pcE", nas / "Elsewhere", "2099-01-01T00:00:00")
        e = self.store("pcE", share=str(nas / "Masters"))
        e.follow_moved(force=True)
        self.assertEqual(e.status()["dir"], str(nas / "Masters"), "マスタが無いフォルダへは移らない")
        # この PC で人が選んだ（画面で置き場を変えた）のが、配る版の覚えより新しい → 引き戻されない。新しい覚えが来たら従う
        self.pin("pcA", nas / "Old", "2000-01-01T00:00:00")
        a.follow_moved(force=True)
        self.assertEqual(a.status()["dir"], str(nas / "Masters"), "人が選んだ後の古い覚えには従わない")
        self.pin("pcA", nas / "Old", "2099-01-01T00:00:00")
        a.follow_moved(force=True)
        self.assertEqual(a.status()["dir"], str(nas / "Old"), "新しく配られた覚えには従う")

    def test_history_lists_previous_places_newest_first(self):
        a = self.store("pcA")
        self.assertEqual(a.history(), [])
        master_place.move(a, self.tmp / "nas", "M1")
        master_place.move(a, self.tmp / "nas", "M2")
        h = self.store("pcA").history()                 # 開き直しても残る
        self.assertEqual([x["dir"] for x in h], [str(self.tmp / "nas" / "M1"), ""], "新しい順。空は手元のみ")
        self.assertTrue(all(x["until"] and x["by"]["pc"] == "pcA" for x in h))

    def test_switch_to_existing_place_and_refusals(self):
        a = self.store("pcA")
        master_place.move(a, self.tmp / "nas", "M1")
        b = self.store("pcB")
        pl = master_place.plan(b, self.tmp / "nas", "M1")
        self.assertEqual((pl["ok"], pl["mode"]), (True, "switch"), "既にマスタがある置き場は写さずに切り替える")
        (self.tmp / "nas" / "junk").mkdir()
        (self.tmp / "nas" / "junk" / "x.txt").write_text("x")
        cases = {"junk": "空ではなく", "M1": "いまの置き場と同じ", "a:b": "使えない字"}
        for name, why in cases.items():
            r = master_place.plan(a, self.tmp / "nas", name)
            self.assertFalse(r["ok"], name)
            self.assertIn(why, r["problem"], name)
        self.assertIn("届きません", master_place.plan(a, self.tmp / "無い", "X")["problem"])

    def test_sync_folder_is_cautioned(self):
        """クラウドの同期フォルダ（Box・OneDrive など）を置き場に選ぶと、同時の保存で片方が消えうることを言う（止めはしない）"""
        for path, kind in ((r"C:\Users\u\Box\LotScope", "Box"), (r"C:\Users\u\OneDrive - 会社\共有", "OneDrive"),
                           ("C:/boxdrive/Box/m", "Box"), (r"\\srv\share\masters", ""), (r"C:\Users\u\Boxes\m", "")):
            self.assertEqual(master_place.sync_folder(path), kind, path)
        (self.tmp / "Box").mkdir()
        pl = master_place.plan(self.store("pcA"), self.tmp / "Box", "Masters")
        self.assertTrue(pl["ok"], pl)
        self.assertIn("片方の変更が消える", pl["caution"])
        self.assertEqual(master_place.plan(self.store("pcA"), self.tmp / "nas", "Masters")["caution"], "", "ファイルサーバーには注意を出さない")


if __name__ == "__main__":
    unittest.main()
