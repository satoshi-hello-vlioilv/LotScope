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
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

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


def publish(built, dst):
    """DataRelay の publish と同じ手順。→ {published, attempts, pending}"""
    incoming = dst.parent / f".{dst.name}.{os.getpid()}.incoming"
    shutil.copyfile(built, incoming)
    deadline, attempts = time.time() + REPLACE_DEADLINE, 0
    while time.time() < deadline:
        attempts += 1
        try:
            os.replace(incoming, dst)
            return {"published": True, "attempts": attempts}
        except OSError:
            time.sleep(BACKOFF[min(attempts - 1, len(BACKOFF) - 1)])
    pending = dst.parent / f"{dst.stem}.pending_{time.strftime('%Y%m%d_%H%M%S')}{dst.suffix}"
    os.replace(incoming, pending)
    return {"published": False, "attempts": attempts, "pending": str(pending)}


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


class Courtesy(Base):
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
    """写しを休まず繰り返しながら、DataRelay と同じ手順で公開を続ける（実際は 15 分ごと。ここはずっと厳しい）。"""

    def test_publishing_never_goes_pending_and_copies_are_whole(self):
        versions = []
        for n in range(1, 7):
            p = self.tmp / f"built{n}.sqlite3"
            make_version(p, n)
            versions.append(p)
        m = DbMirror("work_log_CR1", self.dst, self.cache)
        results, stop = [], threading.Event()

        def publisher():
            for p in versions:
                results.append(publish(p, self.dst))
                time.sleep(0.2)
            stop.set()
        th = threading.Thread(target=publisher)
        th.start()
        seen, busy = set(), 0
        while not stop.is_set():
            r = m.refresh(force=True)
            busy += bool(r.get("busy"))
            if r["updated"]:
                seen.add(self.version_of(m.read_path()))
        th.join()
        m.refresh()
        seen.add(self.version_of(m.read_path()))
        pending = [r for r in results if not r["published"]]
        retried = sum(r["attempts"] > 1 for r in results)
        print(f"\n  公開 {len(results)} 回（入れ替えをやり直した {retried} 回・保留 {len(pending)} 回）・写しで見送った {busy} 回・写した版 {sorted(seen)}")
        self.assertEqual(pending, [], "公開が保留にならない（20 秒のうちに必ず入れ替わる）")
        self.assertTrue(seen <= set(range(0, 7)), f"書き切った版だけを写す: {seen}")
        self.assertIn(6, seen, "最後の版まで写る")
        self.assertFalse(list(self.dst.parent.glob("*.pending_*")))


if __name__ == "__main__":
    unittest.main()
