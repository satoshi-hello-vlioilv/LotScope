# -*- coding: utf-8 -*-
"""写しの係（DbMirror）が、共有の書き手（DataRelay）と干渉しないか。

DataRelay の公開（lib/navi_publish.py）: 公開先の横へ隠しファイル .<名前>.<番号>.incoming を書き切り、os.replace で丸ごと
入れ替える。ほかが公開先を開いていると Windows では「使用中」になり、20 秒粘ってだめなら <名前>.pending_<日時> に保留する。
ここではその手順をそのまま真似て、写しと同時に走らせる（Windows の本物の規則は CI の desktop.yml がこの試験を流して確かめる）。
"""
import os
import shutil
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from app.fsio import open_shared_read
from app.services import db_mirror, work_log
from app.services.db_mirror import DbMirror, is_side_file, writer_marks

REPLACE_DEADLINE = 20.0
BACKOFF = (0.25, 0.5, 1.0, 1.5, 2.0, 3.0)


def make_version(path, n, mb=4):
    """版 n の元ファイル（V に n。大きさは mb ほど: 写すのに時間がかかるように）。"""
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE V (n INTEGER)")
    c.execute("INSERT INTO V VALUES (?)", (n,))
    c.execute("CREATE TABLE pad (b BLOB)")
    c.executemany("INSERT INTO pad VALUES (?)", [(os.urandom(4000),)] * (mb * 250))
    c.commit()
    c.close()


class Publish:
    """DataRelay の publish と同じ手順（書きかけを置き、os.replace で入れ替える。だめなら間を空けて粘り、20 秒でだめなら保留）を、
    1 回ずつ試せる形にした物（入れ替えの合間に、試験が読み手を動かせるように）。"""

    def __init__(self, built, dst):
        self.dst, self.attempts, self.waited = dst, 0, 0.0
        self.incoming = dst.parent / f".{dst.name}.{os.getpid()}.incoming"
        shutil.copyfile(built, self.incoming)

    def attempt(self):
        """1 回入れ替えを試す。→ True 入れ替えた／False まだ（間を空けた。次を試す）／None 20 秒粘っても入れ替わらず保留した"""
        self.attempts += 1
        try:
            os.replace(self.incoming, self.dst)
            return True
        except OSError:
            wait = BACKOFF[min(self.attempts - 1, len(BACKOFF) - 1)]
            time.sleep(wait)
            self.waited += wait
        if self.waited < REPLACE_DEADLINE:
            return False
        pending = self.dst.parent / f"{self.dst.stem}.pending_{time.strftime('%Y%m%d_%H%M%S')}{self.dst.suffix}"
        os.replace(self.incoming, pending)
        return None

    def run(self):
        while (done := self.attempt()) is False:
            pass
        return done


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "share").mkdir()
        self.dst = self.tmp / "share" / "実績_CR1.sqlite3"
        make_version(self.dst, 0, mb=1)
        self.cache = self.tmp / "cache"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def version_of(self, path):
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as c:
            n = c.execute("SELECT n FROM V").fetchone()[0]
        return n


class Contract(unittest.TestCase):
    def test_follows_the_shared_read_contract(self):
        """約束の文書（3つのリポジトリに同じ文）が、この実装の従う版を名乗り、読み手の9つの決まりを持つ。"""
        doc = (Path(__file__).resolve().parents[1] / "docs" / "SHARED_READ.md").read_text(encoding="utf-8")
        self.assertIn(f"（第{db_mirror.CONTRACT_VERSION}版）", doc.splitlines()[0])
        for r in [f"R{i}" for i in range(1, 10)] + ["W1", "W2", "W3"]:
            self.assertIn(f"| {r} |", doc)


class Courtesy(Base):
    def test_reload_does_not_open_an_unchanged_source(self):
        """「再読込」でも、元が変わっていなければ共有を開かない（SHARED_READ.md の R2: 開く回数を台数に比例させない）。"""
        m = DbMirror("work_log_CR1", self.dst, self.cache)
        self.assertTrue(m.refresh()["updated"])
        with mock.patch.object(db_mirror, "open_shared_read", side_effect=AssertionError("共有を開いた")):
            r = m.refresh()
        self.assertTrue(r.get("skipped"), r)

    def test_discards_a_copy_when_the_writer_starts_during_it(self):
        """写している間に書き手の印（-journal）が出たら、その写しは使わない（R5。大きさ・時刻が同じでも）。"""
        m = DbMirror("work_log_CR1", self.dst, self.cache)
        m.refresh()
        good = m.read_path()
        make_version(self.tmp / "v2.sqlite3", 2, mb=1)
        shutil.copyfile(self.tmp / "v2.sqlite3", self.dst)
        real = DbMirror._copy

        def copy_then_writer_starts(remote, tmp):
            real(remote, tmp)
            (self.dst.parent / f"{self.dst.name}-journal").write_bytes(b"j")
        with mock.patch.object(DbMirror, "_copy", staticmethod(copy_then_writer_starts)):
            r = m.refresh()
        self.assertTrue(r.get("busy") and not r["updated"], r)
        self.assertIn("書き始めた", r["reason"])
        self.assertEqual(m.read_path(), good, "前の写しを使い続ける")
        (self.dst.parent / f"{self.dst.name}-journal").unlink()
        self.assertTrue(m.refresh()["updated"], "印が消えたら次の回で写す")

    def test_retries_soon_until_the_first_copy(self):
        # 入れた直後・初めて開く設備: 写しがまだ1つも無いあいだは、届かないが続いても写す間隔（ここでは 1 時間）を待たない
        # （待たせると、画面は「写し終えると出ます」のまま、開き直すまで出ないように見える。版 3.33.0）
        gone = self.dst.with_name("仮_" + self.dst.name)
        os.replace(self.dst, gone)
        m = DbMirror("work_log_CR1", self.dst, self.cache, interval_sec=3600)
        for _ in range(3):
            self.assertTrue(m.refresh().get("unreachable"))
            self.assertEqual(m._next_wait(), db_mirror.RETRY_UNTIL_FIRST_COPY_SEC, "写しが無いうちは、2 回目からも早めに")
        os.replace(gone, self.dst)
        self.assertTrue(m.refresh()["updated"])
        self.assertTrue(m.refresh().get("skipped"))
        self.assertEqual(m._next_wait(), 3600, "写せた後は間隔どおり")
        os.replace(self.dst, gone)
        self.assertTrue(m.refresh().get("unreachable"))
        self.assertTrue(m.refresh().get("unreachable"))
        self.assertEqual(m._next_wait(), 3600, "前の写しがあれば、届かないのが続いても間隔どおり（前の写しを見せ続ける）")
        os.replace(gone, self.dst)

    def test_does_not_copy_while_the_writer_is_publishing(self):
        mark = self.dst.parent / f".{self.dst.name}.4242.incoming"
        mark.write_bytes(b"x")
        m = DbMirror("work_log_CR1", self.dst, self.cache)
        r = m.refresh()
        self.assertTrue(r.get("busy") and not r["updated"], r)
        self.assertIn(mark.name, r["reason"])
        self.assertIsNone(m.read_path(), "写さない・共有も読まない")
        self.assertEqual(m._next_wait(), db_mirror.RETRY_AFTER_BUSY_SEC, "少し空けて写し直す")
        mark.unlink()
        r = m.refresh()
        self.assertTrue(r["updated"], r)
        self.assertEqual(self.version_of(m.read_path()), 0)

    def test_sqlite_journal_of_an_in_place_writer_also_waits(self):
        (self.dst.parent / f"{self.dst.name}-journal").write_bytes(b"x")
        self.assertEqual(writer_marks(self.dst), [f"{self.dst.name}-journal"])
        self.assertTrue(DbMirror("k", self.dst, self.cache).refresh().get("busy"))

    def test_replaced_during_the_copy_is_thrown_away(self):
        m = DbMirror("work_log_CR1", self.dst, self.cache)
        m.refresh()
        good = m.read_path()
        new = self.tmp / "v1.sqlite3"
        make_version(new, 1, mb=1)
        real = DbMirror._copy

        def copy_then_replace(remote, tmp):      # 写している最中に DataRelay が入れ替えた
            real(remote, tmp)
            os.replace(new, remote)
            os.utime(remote, ns=(time.time_ns(), time.time_ns() + 10**9))
        os.utime(self.dst, ns=(time.time_ns(), time.time_ns() + 2 * 10**9))   # 前と違う印（写しに行かせる）
        with mock.patch.object(DbMirror, "_copy", staticmethod(copy_then_replace)):
            r = m.refresh()
        self.assertTrue(r.get("busy") and not r["updated"], r)
        self.assertEqual(m.read_path(), good, "前の写しを使い続ける")
        self.assertTrue(m.refresh()["updated"], "次の周回で新しい版を写す")
        self.assertEqual(self.version_of(m.read_path()), 1)

    def test_side_files_are_not_equipment(self):
        for n in ("実績_CR1.pending_20261011_101500.sqlite3", ".実績_CR1.sqlite3.1234.incoming", "実績_CR1.sqlite3-journal"):
            (self.dst.parent / n).write_bytes(b"x")
            self.assertTrue(is_side_file(n), n)
        found = work_log.scan(str(self.dst.parent), "実績_*.sqlite3")
        self.assertEqual([f["equipment"] for f in found], ["CR1"])
        self.assertFalse(is_side_file("実績_CR1.sqlite3"))


class WithPublisher(Base):
    """写しと DataRelay の公開がぶつかる場面を、毎回同じ順に必ず起こす（実際の公開は 15 分ごと。ここは 6 回とも、読み手が
    元を開いて写している最中に入れ替えを試みる）。
    前はスレッドで休まず写し続けて入れ替えとぶつけていたが、入れ替えが「開いていない一瞬」に当たるかどうかが時の運で、
    Windows では 20 秒のうちに一度も当たらずに保留になり、落ちることがあった。順を決めておけば、結果は時間に左右されない。"""

    def test_publishing_never_goes_pending_and_copies_are_whole(self):
        m = DbMirror("work_log_CR1", self.dst, self.cache)
        self.assertTrue(m.refresh()["updated"])
        replaced_while_open = []
        for n in range(1, 7):
            built = self.tmp / f"built{n}.sqlite3"
            make_version(built, n, mb=1 + n)            # 版ごとに大きさを変える（元の印が必ず変わる）
            before = self.dst.read_bytes()
            with open_shared_read(self.dst) as reader:  # 写しの係と同じ開き方で、写している最中
                got = reader.read(len(before) // 2)
                p = Publish(built, self.dst)            # 書き手が書きかけを置いた
                with mock.patch.object(db_mirror, "open_shared_read", side_effect=AssertionError("共有を開いた")):
                    r = m.refresh()
                self.assertFalse(r["updated"], f"版 {n}: 公開の最中は写さない（共有を開かない）: {r}")
                first = p.attempt()                     # 読み手が開いている最中に入れ替えを試みる
                if os.name != "nt":
                    self.assertTrue(first, "Windows のほかでは、開いていても入れ替えられる")
                got += reader.read()                    # 読み手が写し終えて閉じる
            replaced_while_open.append(first)
            self.assertEqual(got, before, f"版 {n}: 写している最中に入れ替わっても、写した物は前の版のまま欠けない")
            self.assertTrue(first or p.run(), f"版 {n}: 読み手が閉じた後は入れ替わり、保留にならない（{p.attempts} 回）")
            r = m.refresh()
            self.assertTrue(r["updated"], f"版 {n}: {r}")
            self.assertEqual(self.version_of(m.read_path()), n, "書き切った版を写す")
        print(f"\n  公開 6 回（読み手が開いている最中に入れ替えられた {sum(replaced_while_open)} 回・閉じるのを待った {6 - sum(replaced_while_open)} 回）")
        self.assertFalse(list(self.dst.parent.glob("*.pending_*")), "保留が無い")
        self.assertFalse(writer_marks(self.dst), "書きかけが残らない")


if __name__ == "__main__":
    unittest.main()
