# -*- coding: utf-8 -*-
"""ダッシュボードが作業実績の最初の写しを待つ長さ（版 3.92.0。利用者の要望 2026-11-10 の 4）:
- パネルの数（/api/dashboard/query）だけ 2 秒。窓（desktop/src/dashboard.rs の FIRST_WAIT）と Python（routes/dashboard.py の DASH_FIRST_WAIT_SEC）で同じ長さ
- 列の一覧・絞る面の項目（/api/dashboard/fields・/api/data/columns）は前どおり最初の写しを待つ（作った後の採点で見つけた割れ:
  2 秒で作業実績の列が 0 になり、変換表の「当てる列」から消えた）
- 版 3.97.0: 待っているパネルの段（GET /api/dashboard/progress）と、写している最中の数え方（答えの copy）"""
import inspect
import re
import threading
import time
import unittest
from datetime import datetime
from pathlib import Path

from app.routes import dashboard as routes
from app.services import dash_progress, db_mirror
from tests.test_dashboard import Api

DESKTOP = Path(__file__).resolve().parents[2] / "desktop" / "src" / "dashboard.rs"


class DashWait(unittest.TestCase):
    def test_window_and_python_wait_the_same(self):
        m = re.search(r"const FIRST_WAIT: Duration = Duration::from_secs\((\d+)\);", DESKTOP.read_text(encoding="utf-8"))
        self.assertIsNotNone(m)
        self.assertEqual(int(m.group(1)), routes.DASH_FIRST_WAIT_SEC)
        self.assertLess(routes.DASH_FIRST_WAIT_SEC, db_mirror.FIRST_WAIT_SEC)

    def test_only_the_panel_query_waits_short(self):
        src = inspect.getsource(routes)
        short = re.findall(r"panel_parts\([^\n]*first_wait=DASH_FIRST_WAIT_SEC\)", src)
        allc = re.findall(r"= panel_parts\(", src)
        self.assertEqual(len(short), 2, "パネルの数の道（_answer と稼働・ABC）の 2 か所だけ 2 秒")
        self.assertGreater(len(allc), len(short), "列の一覧・絞る面の項目は既定（最初の写しを待つ）")
        self.assertIsNone(inspect.signature(routes.panel_parts).parameters["first_wait"].default)


class Progress(unittest.TestCase):
    """版 3.97.0: パネルの問い合わせ（?ask=印）の段を GET /api/dashboard/progress が答える（窓の desktop/src/progress.rs と同じ形）"""
    setUp = Api.setUp          # 試験の土台（作業実績 2 台・仕掛）は test_dashboard の Api と同じ（試験そのものは継がない）
    tearDown = Api.tearDown

    def ask(self, panel, tag):
        self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)
        for _ in range(30):            # 写し終えるまで（写しの段は下の試験で）
            r = self.c.post(f"/api/dashboard/query?ask={tag}", json={"panel": panel})
            d = r.get_json()
            if not d.get("copy") and not any(g.get("copy") for g in d.get("groups") or []):
                break
            time.sleep(0.1)
        return r

    def prog(self, *tags):
        return self.c.get("/api/dashboard/progress?ask=" + ",".join(tags)).get_json()["asks"]

    def test_stage_previous_time_and_unknown_asks(self):
        panel = {"id": "k", "visual": "kpi", "source": "work", "body": {"measures": [{"agg": "lots"}]}}
        self.assertEqual(self.ask(panel, "k-1").status_code, 200)
        e = self.prog("k-1")["k-1"]
        self.assertTrue(e["done"])
        self.assertEqual(e["stage"], "count", e)
        self.assertNotIn("n", e, "n/m の無い段は n を返さない")
        self.app.config["DASH_CACHE"].clear()
        self.ask(panel, "k-2")
        self.assertIsNotNone(self.prog("k-2")["k-2"]["prevMs"], "同じ組みを数えた時間を前回として持つ")
        self.assertEqual(set(self.prog("zz", "k-2", "<x>")), {"k-2"}, "知らない印・読めない印は答えない")
        self.c.post("/api/dashboard/query", json={"panel": panel})     # 印の無い問い合わせは記録しない
        self.assertFalse(dash_progress.valid_ask("bad ask"))

    def test_read_stage_counts_files(self):
        """読む段の n/of は読み終えたファイルの数 / ファイルの数（円と字は同じこの数から出す）。途中の段を糸の外から見る"""
        seen = []
        orig = routes.pivot._open_part

        def slow(part, **kw):
            time.sleep(0.15)
            return orig(part, **kw)

        panel = {"id": "s", "visual": "kpi", "source": "work", "body": {"measures": [{"agg": "lots"}]}}
        self.ask(panel, "warm")
        self.app.config["DASH_CACHE"].clear()
        routes.pivot._open_part = slow
        try:
            t = threading.Thread(target=lambda: self.app.test_client().post("/api/dashboard/query?ask=s-1", json={"panel": panel}))
            t.start()
            while t.is_alive():
                e = self.prog("s-1").get("s-1")
                if e and e["stage"] == "read":
                    seen.append((e["n"], e["of"]))
                time.sleep(0.03)
            t.join()
        finally:
            routes.pivot._open_part = orig
        self.assertIn((0, 2), seen)
        self.assertIn((1, 2), seen, f"設備 2 台を 1 台ずつ読む: {seen}")
        self.assertTrue(all(n < of for n, of in seen))

    def test_board_copy_counts_one_data_source(self):
        """写している最中の数え方は、そのデータ元の設備だけ（前は画面が合わせた表のまとまりの写しを全部足し、仕掛の写しまで数えた: 6/12）"""
        failed = [{"name": "CR2", "kind": "copying"}, {"name": "L-2", "kind": "copying"}, {"name": "SL3", "kind": "unknown"}]
        self.assertEqual(routes._copy_of("作業実績", [{}, {}, {}], failed), {"copy": {"name": "作業実績", "done": 3, "total": 5}})
        self.assertEqual(routes._copy_of("仕掛", [{}], []), {})
        self.assertEqual(routes._first_copy([{"cells": []}, {"copy": {"name": "作業実績", "done": 3, "total": 5}}]),
                         {"copy": {"name": "作業実績", "done": 3, "total": 5}})
        # 本物の道: 写し終える前の合わせた表は、作業実績のまとまりの数え方を上に持つ（仕掛は数えない）
        self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)
        d = self.c.post("/api/dashboard/query", json={"panel": {"visual": "board"}}).get_json()
        if d.get("copy"):
            self.assertEqual(d["copy"]["name"], "作業実績")
            self.assertEqual(d["copy"]["total"], 2, "作業実績の設備 2 台（仕掛の写しを足さない）")

    def test_waiting_before_counting_is_not_compared_or_remembered(self):
        """作った後の採点（版 3.97.0）: 順番待ち（queue）・写しを待つ間は前回と比べる時間（countMs）に入れず、覚える前回も数えている段の時間だけ"""
        ask = dash_progress.begin("q-1", b"Q")
        try:
            dash_progress.step("queue")
            time.sleep(0.12)
            e = dash_progress.answer(["q-1"])["asks"]["q-1"]
            self.assertLess(e["countMs"], 20, e)
            self.assertGreaterEqual(e["elapsedMs"], 120)
            dash_progress.step("read", 0, 2)
            dash_progress.counted()
            time.sleep(0.04)
            self.assertGreaterEqual(dash_progress.answer(["q-1"])["asks"]["q-1"]["countMs"], 40)
        finally:
            dash_progress.finish(ask)
        ask = dash_progress.begin("q-2", b"Q")
        dash_progress.finish(ask)
        prev = dash_progress.answer(["q-2"])["asks"]["q-2"]["prevMs"]
        self.assertTrue(40 <= prev < 120, f"前回は数えた時間だけ（順番待ちの 120ms は入れない）: {prev}")
        self.assertTrue(dash_progress.counting("abc") and not dash_progress.counting("queue") and not dash_progress.counting("copy"))

    def test_copy_left_time_from_bytes(self):
        """写している間のあと何秒（版 3.97.0。作った後の採点: どこにも出なかった）: 設備ごとの済んだバイト÷経過＝速さ、いちばん遅く終わる設備の残り。
        写し始めていない設備・速さがまだ分からない間は出さない。円と字の n/m は台のまま。失敗の並びから途中の様子を外す"""
        cop = lambda n, p: {"name": n, "kind": "copying", "_copy": p}      # noqa: E731
        failed = [cop("A", {"done": 2_000_000, "total": 4_000_000, "secs": 2.0}), cop("B", {"done": 1_000_000, "total": 4_000_000, "secs": 2.0})]
        c = routes._copy_of("作業実績", [{}], failed)["copy"]
        self.assertEqual((c["done"], c["total"], c["bytes"], c["rate"], c["leftSec"]), (1, 3, [3_000_000, 8_000_000], 1_500_000.0, 6.0))
        self.assertTrue(all("_copy" not in f for f in failed))
        c = routes._copy_of("作業実績", [], [cop("A", {"done": 2_000_000, "total": 4_000_000, "secs": 2.0}), cop("B", None)])["copy"]
        self.assertNotIn("leftSec", c, "写し始めていない設備があれば見込みを出さない")
        c = routes._copy_of("作業実績", [], [cop("A", {"done": 10, "total": 4_000_000, "secs": 0.2})])["copy"]
        self.assertTrue("leftSec" not in c and "rate" not in c, c)

    def test_mirror_reports_bytes_while_copying(self):
        """写しの係は写しかけの一時ファイルの大きさを済んだバイトとして答える（窓の mirror.rs の copy_progress と同じ）"""
        from app.services.db_mirror import DbMirror
        d = Path(self.tmp) / "m"
        d.mkdir()
        src = d / "src.sqlite3"
        src.write_bytes(b"x" * 300_000)
        m = DbMirror("t", str(src), d / "cache")
        self.assertIsNone(m.copy_progress())
        seen = []
        real = DbMirror._copy

        def slow(remote, tmp):
            with open(remote, "rb") as a, open(tmp, "wb") as b:
                while chunk := a.read(100_000):
                    b.write(chunk)
                    b.flush()
                    seen.append(m.copy_progress())
                    time.sleep(0.05)

        DbMirror._copy = staticmethod(slow)
        try:
            m.refresh()
        finally:
            DbMirror._copy = staticmethod(real)
        self.assertEqual([p["done"] for p in seen], [100_000, 200_000, 300_000])
        self.assertTrue(all(p["total"] == 300_000 for p in seen))
        self.assertIsNone(m.copy_progress(), "写し終えれば途中の様子は無い")

    def test_copy_state_is_answered_before_any_equipment_is_copied(self):
        """1 台も写し終えていない間（答えは 503 の写しています）も、答えに写しの様子（台・バイト）を付ける（作った後の採点:
        最初の写しの間、道具の行の札に MB も あと何秒 も出なかった）"""
        from app.services.db_mirror import DbMirror
        real = DbMirror._copy

        def slow(remote, tmp):
            with open(remote, "rb") as a, open(tmp, "wb") as b:
                while chunk := a.read(512):
                    b.write(chunk)
                    b.flush()
                    time.sleep(0.4)         # 小さな試験のファイルでも、ダッシュボードが待つ 2 秒を越えて写す

        DbMirror._copy = staticmethod(slow)
        try:
            self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)
            r = self.c.post("/api/dashboard/query", json={"panel": {"id": "k", "visual": "kpi", "source": "work", "body": {"measures": [{"agg": "lots"}]}}})
            d = r.get_json()
            self.assertEqual((r.status_code, d.get("kind")), (503, "copying"), d)
            self.assertEqual((d["copy"]["done"], d["copy"]["total"]), (0, 2), d)
            self.assertEqual(len(d["copy"]["bytes"]), 2)
            self.assertGreater(d["copy"]["bytes"][0], 0)
        finally:
            DbMirror._copy = staticmethod(real)


if __name__ == "__main__":
    unittest.main()
