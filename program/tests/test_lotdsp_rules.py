# -*- coding: utf-8 -*-
"""LotDsp の 9 本の道が共にする決まりと、版 3.98.0 で直した誤り（app/services/lotdsp_rules.py ほか）。

答えは仕様から人が書いた事例の表（tests/fixtures/lotdsp_rules_cases.json。窓〈desktop/tests/lotdsp_cases.rs〉と画面
〈tools/lotdsp-url-check.mjs〉も同じ表を読む）と、作り物（時計・ブラウザ・HTTP の口）で決まった順に動かした結果。直す前の版で
流すと落ちる（版 3.98.0 の計画書 program/docs/RUST_PORT_PLAN.md に、直す前に落ちた試験の名前を書いた）。

    python -m unittest tests.test_lotdsp_rules
"""
import http.server
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import lotdsp_api as api
from app.services import lotdsp_direct as D
from app.services import lotdsp_link as link
from app.services import lotdsp_progress as lp
from app.services import lotdsp_rules as R

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "lotdsp_rules_cases.json").read_text(encoding="utf-8"))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """決まった状態を返す HTTP の口（delay 秒待ってから答える。answer=False なら受けたまま黙る）。"""

    def __init__(self, status=200, delay=0.0, answer=True, body=b"ok"):
        outer = self
        self.hits = 0

        class H(http.server.BaseHTTPRequestHandler):
            def _do(self):
                outer.hits += 1
                if not answer:
                    time.sleep(30)
                    return
                time.sleep(delay)
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_GET = do_POST = _do

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.srv.daemon_threads = True
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}/LotDspWeb/"

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()


# ------------------------------------------------------------------ 事例の表
class Rules(unittest.TestCase):
    def test_site_base(self):
        for c in CASES["site"]:
            with self.subTest(url=c["url"]):
                self.assertEqual(R.site_base(c["url"]), c["base"])
                self.assertEqual(R.api_search_url(c["url"]), c["api"])
                self.assertEqual(R.direct_search_url(c["url"]), c["direct"])

    def test_settings_use_the_site_base(self):
        """# の URL でも API は …/service/lotdsp/search//searchAction へ、見えない Edge は …/#/lotdsp へ（前は # を重ねた）。"""
        for c in CASES["site"]:
            with self.subTest(url=c["url"]):
                self.assertEqual(api.settings_of({"url": c["url"]})["search_url"], c["api"])
                self.assertEqual(D.settings_of({"url": c["url"]})["search_url"], c["direct"])

    def test_numbers_are_read_whole(self):
        for text, want, how in CASES["number"]:
            with self.subTest(text=text):
                got = R.to_number(text)
                self.assertEqual(got, want)
                self.assertEqual(R.read_number(text)[1], how)
                self.assertEqual(lp.to_number(text), want, "取込も同じ決まり")

    def test_round_eq(self):
        for shown, dec, raw, want in CASES["round_eq"]:
            with self.subTest(case=(shown, dec, raw)):
                self.assertEqual(R.round_eq(shown, dec, raw), want)

    def test_integer_fields_do_not_take_fractions_when_learning(self):
        """学ぶときの一致（lotdsp_api.same）も調べる道具と同じ決まり（前は same('7', 7.4) が真）。"""
        self.assertFalse(api.same("7", 7.4))
        self.assertTrue(api.same("7", 7))
        self.assertTrue(api.same("7.000", 7.0004))
        self.assertFalse(api.same("3", 2.73))

    def test_lot_shape(self):
        for raw, want in CASES["lot"]:
            with self.subTest(raw=raw):
                if want in (None, "shape"):
                    with self.assertRaises(R.LotShapeError):
                        R.checked_lot(raw)
                else:
                    self.assertEqual(R.checked_lot(raw), want)

    def test_reached(self):
        for code, want in CASES["reached"]:
            self.assertEqual(R.reached_status(code), want, code)

    def test_body(self):
        for c in CASES["body"]:
            raw = (bytes.fromhex(c["raw_hex"]) if "raw_hex" in c else
                   ('{"a": ' + "[" * (c["depth"] - 1) + "]" * (c["depth"] - 1) + "}").encode() if "depth" in c else c["raw"].encode("utf-8"))
            with self.subTest(raw=raw[:40]):
                if "error" in c:
                    with self.assertRaises(R.BodyError) as e:
                        R.read_body(raw)
                    self.assertEqual(str(e.exception), c["error"])
                else:
                    got = R.read_body(raw)
                    if "ok" in c:
                        self.assertEqual(got, c["ok"])
                    else:
                        self.assertEqual(sorted(got), c["ok_keys"])

    def test_dates_are_japan_time_whatever_the_pc(self):
        """決め ①: API の日時は日本時間で字にする（前は PC の時間帯。UTC の PC では 9 時間ずれた）。"""
        old = os.environ.get("TZ")
        try:
            os.environ["TZ"] = "UTC"
            time.tzset()
            self.assertEqual(api._date_text(1758097000000), "25/09/17 17:16:40")
            self.assertEqual(api._date_text("2025-09-17T08:16:40Z"), "25/09/17 17:16:40")
            self.assertEqual(api._date_text("2025-09-17T17:16:40+0900"), "25/09/17 17:16:40")
            self.assertEqual(api._date_text("2025-09-17T17:16:40"), "25/09/17 17:16:40", "ずれの無い字はそのまま")
            self.assertTrue(api.same("25/09/17 17:16:40", 1758097000000))
        finally:
            if old is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = old
            time.tzset()


# ------------------------------------------------------------------ 見えない Edge と LotDsp の窓
class FakeTime:
    """差し替えた時計。sleep は時計が進むまで待つ（試験が advance で進める）。"""

    def __init__(self):
        self.now = 1_000_000.0
        self.cv = threading.Condition()
        self.stopped = False

    def time(self):
        return self.now

    perf_counter = time

    def sleep(self, s):
        with self.cv:
            target = self.now + s
            end = time.monotonic() + 5
            while self.now < target and time.monotonic() < end and not self.stopped:
                self.cv.wait(0.05)

    def advance(self, s):
        with self.cv:
            self.now += s
            self.cv.notify_all()
        time.sleep(0.3)              # 見張りが起きて片付けるのを待つ（本物の時計）


class FakeBrowser:
    made = []

    def __init__(self, exe, extra, visible=False, profile=None, start_timeout=15.0):
        self.exe, self.extra, self.visible, self.open = exe, tuple(extra), visible, True
        self.used = D.time.time()
        self.cdp = None
        FakeBrowser.made.append(self)

    def alive(self):
        return self.open

    def close(self):
        self.open = False


def no_watchers():
    """見張りの糸が終わるまで待つ（ほかの試験の見張りを持ち越さない）。"""
    D.shutdown()
    end = time.time() + 5
    while time.time() < end and any(t.name == "lotdsp-idle" and t.is_alive() for t in threading.enumerate()):
        time.sleep(0.05)


class Watch(unittest.TestCase):
    def setUp(self):
        no_watchers()
        FakeBrowser.made = []
        self.clock = FakeTime()
        self.mode = {"login": True}

        def run(b, cfg, lot, wait_login=False):
            if not b.visible and self.mode["login"]:
                raise D.DirectError("login", "ログインが要ります")
            return "<html/>"
        self.patches = [mock.patch.object(D, "time", self.clock), mock.patch.object(D, "_Browser", FakeBrowser),
                        mock.patch.object(D, "reachable", lambda *a, **k: True),
                        mock.patch.object(D, "find_browser", lambda c="": "/fake/msedge"),
                        mock.patch.object(D, "_window", lambda b, s: None),
                        mock.patch.object(D, "_open_search_page", lambda b, cfg, lot, reused: None),
                        mock.patch.object(D, "_run", run)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        self.clock.stopped = True
        for p in self.patches:
            p.stop()
        no_watchers()

    def cfg(self, keep=300, window_keep=1800):
        return D.settings_of({"url": "http://x/LotDspWeb/", "direct": {"keep_seconds": keep, "window_keep_seconds": window_keep}})

    def watchers(self):
        return sum(1 for t in threading.enumerate() if t.name == "lotdsp-idle" and t.is_alive())

    def test_window_after_headless_stays_for_window_keep_seconds(self):
        """見えない → ログインが要る → 窓: 600 秒たっても窓は残り、1800 秒で閉じる（前は見えない Edge の見張りが 300 秒で閉じた）。"""
        cfg = self.cfg()
        with self.assertRaises(D.DirectError):
            D.fetch_progress_html("L7150C0", cfg, window=False)
        D.fetch_progress_html("L7150C0", cfg, window=True)
        win = D._SESSION
        self.assertTrue(win and win.visible)
        self.clock.advance(600)
        self.assertIs(D._SESSION, win, "600 秒では窓を閉じない")
        self.assertTrue(win.open)
        self.clock.advance(1250)
        self.assertIsNone(D._SESSION, "1800 秒使わなければ閉じる")
        self.assertFalse(win.open)
        self.assertLessEqual(self.watchers(), 1, "見張りは 1 つ")

    def test_watchers_do_not_pile_up(self):
        cfg = self.cfg()
        self.mode["login"] = False
        for _ in range(3):
            D.fetch_progress_html("L7150C0", cfg, window=False)
            D.shutdown()
        D.fetch_progress_html("L7150C0", cfg, window=False)
        time.sleep(0.2)
        self.assertLessEqual(self.watchers(), 1, "見張りは 1 つ（前は起こすたびに増えた）")
        self.clock.advance(301)
        self.assertIsNone(D._SESSION, "見えない Edge は keep_seconds で閉じる")

    def test_keep_zero_closes_the_headless_but_not_the_window(self):
        """keep_seconds 0 は見えない Edge だけ毎回閉じる。窓は window_keep_seconds で決める（前は窓も毎回閉じた）。"""
        cfg = self.cfg(keep=0)
        self.mode["login"] = False
        D.fetch_progress_html("L7150C0", cfg, window=False)
        self.assertIsNone(D._SESSION)
        D.fetch_progress_html("L7150C0", cfg, window=True)
        self.assertTrue(D._SESSION and D._SESSION.visible, "窓は残す")


class Reach(unittest.TestCase):
    def test_proxy_answers_are_not_reached(self):
        """HTTP の答えでも、プロキシの答え（502 など）は届いていない（前は HTTP の誤りを何でも届いたと数えた）。"""
        for status, want in ((502, False), (504, False), (407, False), (401, True), (404, True), (200, True)):
            s = Server(status=status)
            try:
                self.assertEqual(D.reachable(s.url, 2), want, status)
            finally:
                s.stop()

    def test_only_once_without_the_pc_proxy(self):
        """決め ③: プロキシを通さない 1 回だけ（前は PC のプロキシで 2 回目を試し、届かない場所も届いたと言えた）。"""
        proxy = Server(status=200)
        env = {"http_proxy": proxy.url.rsplit("/LotDspWeb/", 1)[0], "HTTP_PROXY": proxy.url.rsplit("/LotDspWeb/", 1)[0],
               "no_proxy": "", "NO_PROXY": ""}
        try:
            with mock.patch.dict(os.environ, env):
                self.assertFalse(D.reachable(f"http://127.0.0.1:{free_port()}/LotDspWeb/", 1))
            self.assertEqual(proxy.hits, 0, "PC のプロキシへは尋ねない")
        finally:
            proxy.stop()

    def test_settings_check_uses_the_site_base(self):
        """参照先の「確かめる」も # から後ろを捨てた場所へ尋ねる。"""
        from app.services import path_settings
        s = Server(status=200)
        seen = []
        real = D.reachable
        try:
            with mock.patch.object(D, "reachable", lambda u, t: seen.append(u) or real(u, t)):
                r = path_settings._check_url(path_settings.BY_KEY["lotdsp_import.url"], s.url + "#/lotdsp")
            self.assertTrue(r["ok"])
            self.assertEqual(seen, [s.url.rstrip("/")])
        finally:
            s.stop()


class Cancel(unittest.TestCase):
    """中止は、どの待ちの間も 0.1 秒ごとに見る（前は届くかの確かめ・DevToolsActivePort の待ちで最大 15 秒効かなかった）。"""

    def fetch_then_cancel(self, cfg, after=0.3):
        out = {}

        def go():
            t = time.time()
            try:
                D.fetch_progress_html("L7150C0", cfg)
            except D.DirectError as e:
                out["kind"] = e.kind
            out["took"] = time.time() - t
        th = threading.Thread(target=go)
        th.start()
        time.sleep(after)
        D.cancel()
        th.join(20)
        return out

    def test_cancel_while_checking_reach(self):
        s = Server(answer=False)
        try:
            cfg = D.settings_of({"url": s.url, "direct": {"reach_timeout_seconds": 4}})
            out = self.fetch_then_cancel(cfg)
            self.assertEqual(out.get("kind"), "cancelled", out)
            self.assertLess(out["took"], 1.5, out)
        finally:
            s.stop()

    def test_cancel_while_waiting_for_devtools(self):
        s = Server(status=200)
        tmp = tempfile.mkdtemp()
        exe = Path(tmp) / "chromium"
        exe.write_text("#!/bin/sh\nsleep 20\n")
        exe.chmod(0o755)
        try:
            cfg = D.settings_of({"url": s.url, "direct": {"browser": str(exe), "start_timeout_seconds": 8, "keep_seconds": 0}})
            out = self.fetch_then_cancel(cfg, after=0.6)
            self.assertEqual(out.get("kind"), "cancelled", out)
            self.assertLess(out["took"], 2.5, out)
        finally:
            D.shutdown()
            s.stop()


# ------------------------------------------------------------------ 学びの覚え
class Memory(unittest.TestCase):
    def setUp(self):
        from tests import test_lotdsp_api as T
        self.T = T
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = api.settings_of({"url": "http://x/LotDspWeb/"})

    def tearDown(self):
        self.tmp.cleanup()

    def test_status_while_learning_does_not_break(self):
        """学ぶ糸と状態を読む道が同じ錠を使う（前は dictionary changed size during iteration で 500 になりえた）。"""
        import sys
        T = self.T
        entity = T.entity_of(T.FIXTURE)
        tables, actual, design = lp.progress_tables(T.FIXTURE, {})
        km = api.KeyMap(Path(self.tmp.name) / "m.json")
        stop, errs = [False], []
        old = sys.getswitchinterval()
        sys.setswitchinterval(1e-6)

        def learner():
            while not stop[0]:
                with api._LOCK:
                    km.data = {}
                    api.learn(km, entity, self.cfg, tables, actual, design, "L7150C0")

        def reader():
            while not stop[0]:
                try:
                    api.status(km, self.cfg)
                except RuntimeError as e:
                    errs.append(str(e))
        ts = [threading.Thread(target=learner), threading.Thread(target=reader)]
        try:
            for t in ts:
                t.start()
            time.sleep(3)
        finally:
            stop[0] = True
            for t in ts:
                t.join()
            sys.setswitchinterval(old)
        self.assertEqual(errs[:1], [], f"{len(errs)} 回")

    def test_failed_save_keeps_memory_and_file_together(self):
        """保存に失敗したらメモリも前に戻す（前はメモリだけ学んで、/api/config〈ファイル〉と状態〈メモリ〉が違う ready を答えた）。"""
        T = self.T
        km = api.KeyMap(Path(self.tmp.name) / "m.json")
        fake = T.FakeLotDsp()
        try:
            cfg = api.settings_of({"url": "http://x/", "api": {"search_url": fake.url, "timeout_seconds": 3}})
            fake.response = (200, T.entity_of(T.FIXTURE))
            with mock.patch.object(api, "write_json_atomic", side_effect=OSError("書けない")):
                api.learn_from_html(km, cfg, T.FIXTURE, "L7150C0")
            self.assertEqual(km.data, {}, "メモリは前のまま")
            self.assertFalse((Path(self.tmp.name) / "m.json").exists())
        finally:
            fake.stop()


# ------------------------------------------------------------------ 道
class Routes(unittest.TestCase):
    def setUp(self):
        from tests import test_lotdsp_api as T
        self.T = T
        self.tmp = tempfile.TemporaryDirectory()
        self.fake = T.FakeLotDsp()
        self.app = create_app({"TESTING": True, "MASTER_STORE": MasterStore(ROOT, local_root=Path(self.tmp.name), settings={})})
        self.app.config["LOTDSP_API_SYNC"] = True
        self.app.config["LOTDSP_API_MAP"] = api.KeyMap(Path(self.tmp.name) / "map.json")
        self.app.config["APP_SETTINGS"]["lotdsp_import"] = {
            "url": "http://127.0.0.1:9/LotDspWeb/", "api": {"search_url": self.fake.url, "timeout_seconds": 3}}
        self.c = self.app.test_client()

    def tearDown(self):
        self.fake.stop()
        self.tmp.cleanup()

    def test_seconds_have_one_decimal_on_both_routes(self):
        """読んだ秒は道の全体で測り、小数 1 桁（前は API の道が 2 桁）。"""
        T = self.T
        h1, h2 = T.html_with_offs(T.Base.OFFS), T.html_with_offs(T.Base.OFFS, lot_no="L7151C0", thickness_shift=0.5)
        for h, lot in ((h1, "L7150C0"), (h2, "L7151C0")):
            self.fake.response = (200, T.entity_of(h))
            self.assertEqual(self.c.post("/api/lots/import-lotdsp", json={"html": h, "lot_no": lot}).status_code, 200)
        self.fake.response = (200, T.entity_of(h1))
        real = self.fake.server.RequestHandlerClass.do_POST

        def slow(handler):
            time.sleep(0.137)
            return real(handler)
        with mock.patch.object(self.fake.server.RequestHandlerClass, "do_POST", slow):
            r = self.c.post("/api/lots/fetch-lotdsp-api", json={"lot_no": "L7150C0"})
        d = r.get_json()
        self.assertEqual(r.status_code, 200, d)
        self.assertEqual(d["seconds"], round(d["seconds"], 1))
        self.assertEqual(d["report"]["seconds"], d["seconds"])
        self.assertGreaterEqual(d["seconds"], 0.1)

    def test_lot_shape_is_the_same_on_every_route(self):
        for path in ("/api/lots/fetch-lotdsp-api", "/api/lots/fetch-lotdsp"):
            r = self.c.post(path, json={"lot_no": "L71;50"})
            self.assertEqual((r.status_code, r.get_json()["kind"]), (400, "invalid"), path)
            self.assertIn("ロット番号の形が違います", r.get_json()["error"])
        r = self.c.get("/api/lots/lotdsp-api/survey?lot=L71;50")
        self.assertEqual((r.status_code, r.get_json()["kind"]), (400, "invalid"))
        self.assertEqual(self.fake.requests, [], "形の違うロット番号は問い合わせない")

    def test_body_contract(self):
        r = self.c.post("/api/lots/import-lotdsp", json={"html": 123, "lot_no": "L1"})
        self.assertEqual((r.status_code, r.get_json()), (400, {"error": "HTML は字で送ってください。", "kind": "invalid"}))
        r = self.c.post("/api/lots/import-lotdsp", data=b"[1]")
        self.assertEqual((r.status_code, r.get_json()["kind"]), (400, "invalid"))
        r = self.c.post("/api/lots/fetch-lotdsp", data=b"{bad")
        self.assertEqual((r.status_code, r.get_json()), (400, {"error": "本文を JSON として読めません。", "kind": "invalid"}))
        r = self.c.post("/api/lots/lotdsp-api/link", json={"files": "x"})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (400, "invalid"))

    def test_link_has_the_same_size_limit(self):
        """調べる道具も 1 つの HTML は 5,000,000 字まで（前は上限が無かった）。"""
        out = link.link_files([{"name": "大", "html": "x" * (R.MAX_HTML_CHARS + 1)}], api.KeyMap(Path(self.tmp.name) / "x.json"),
                              api.settings_of({"url": "http://x/"}))
        self.assertEqual(out["files"], [{"name": "大", "error": "画面を読めませんでした: HTML が大きすぎます（進度情報の画面だけを渡してください）。"}])


# ------------------------------------------------------------------ 作った後の採点（版 3.98.0）で見つけた割れ
def with_cells(cells):
    """見本の画面の実績の行（上から）の、板厚・板幅・重量の字を替える。cells: [(板厚, 板幅, 重量) か None]"""
    import re
    from tests.test_lotdsp_api import ACTUAL_ROW, FIXTURE
    s = FIXTURE
    for row, c in zip(ACTUAL_ROW.findall(FIXTURE), cells):
        if c is None:
            continue
        new = row
        for cls, v in zip(("prog-jbx", "prog-jby", "prog-jbrw"), c):
            if v is not None:
                new = re.sub(r'(<span class="' + cls + r' ng-binding">)[^<]*', lambda m, v=v: m.group(1) + v, new, count=1)
        s = s.replace(row, new, 1)
    return s


class Units(unittest.TestCase):
    """決め ② の言い直し（主のセッション・2026-11-11）: 先頭の数の全体を読み、後ろの単位は捨てる。読めない欄は空にして知らせる。"""

    def test_numbers_with_units_are_read_and_unreadable_cells_are_told(self):
        master = json.loads((ROOT / "data" / "equipment_master.json").read_text(encoding="utf-8"))
        html = with_cells([("7.000mm", None, "6,220.0 kg"), ("*", "1 200", None), ("7.0/8.0", "(7)", None)])
        lot, report = lp.parse_progress_html(html, master, expect_lot="L7150C0")
        p = lot["processes"]
        self.assertEqual((p[0]["thickness"], p[0]["weight"]), (7.0, 6220.0), "単位は捨てて読む（前の版は 7.0・6220。3.98.0 の作りかけは 0）")
        self.assertEqual((p[1]["thickness"], p[1]["width"]), (None, 1200.0), "読めない欄は 0 にせず空・空白の桁区切りは読む")
        self.assertEqual((p[2]["thickness"], p[2]["width"]), (7.0, None))
        self.assertIn("№2: 板厚「*」を数として読めませんでした（空として取り込みました）", report["warnings"])
        self.assertIn("№3: 板幅「(7)」を数として読めませんでした（空として取り込みました）", report["warnings"])
        self.assertIn("№3: 板厚「7.0/8.0」は先頭の「7.0」だけを数として読みました", report["warnings"])
        self.assertFalse(any("№1" in w for w in report["warnings"]), "単位だけを捨てたときは知らせない")


class Inputs(unittest.TestCase):
    """設備マスタ・参照先を読めないときは、どの道も 503 kind settings（前は取込が 400 JSONDecodeError・API の道が 500）。"""

    def test_unreadable_masters_are_settings_errors(self):
        import shutil
        tmp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "data", tmp / "data")
        for name, why in (("equipment_master.json", "設備マスタ"), ("path_settings.json", "参照先")):
            (tmp / "data" / name).write_text("{bad", encoding="utf-8")
            app = create_app({"TESTING": True, "MASTER_STORE": MasterStore(tmp, local_root=tmp / ("local-" + why), settings={})})
            app.config["APP_SETTINGS"]["lotdsp_import"] = {"url": "http://127.0.0.1:9/x/", "api": {"enabled": False}}
            c = app.test_client()
            for path, body in (("/api/lots/import-lotdsp", {"html": "<table></table>"}), ("/api/lots/fetch-lotdsp-api", {"lot_no": "L1"})):
                r = c.post(path, json=body)
                self.assertEqual((r.status_code, r.get_json()), (503, {"error": f"LotDsp の設定・設備マスタを読めません（{why}）。", "kind": "settings"}),
                                 (name, path))
            shutil.copy(ROOT / "data" / name, tmp / "data" / name)


class Shell(unittest.TestCase):
    """窓が LotDsp を受け持つと名乗ったら（TPA_SHELL_SERVES に lotdsp）、Python の 9 本は答えず「来たら誤り」の印を返す。"""

    def test_python_does_not_answer_when_the_window_serves(self):
        from app.routes import lots
        app = create_app({"TESTING": True, "MASTER_STORE": MasterStore(ROOT, local_root=Path(tempfile.mkdtemp()), settings={})})
        c = app.test_client()
        routes = [("POST", "/api/lots/import-lotdsp"), ("POST", "/api/lots/fetch-lotdsp"), ("POST", "/api/lots/fetch-lotdsp-api"),
                  ("GET", "/api/lots/lotdsp-api/survey?lot=L1"), ("POST", "/api/lots/lotdsp-api/link"), ("GET", "/lotdsp-link"),
                  ("GET", "/api/lots/lotdsp-api/status"), ("GET", "/api/lots/fetch-lotdsp/status"), ("POST", "/api/lots/fetch-lotdsp/cancel")]
        before = lots.SHELL_HITS
        with mock.patch.dict(os.environ, {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotdsp"}):
            for method, path in routes:
                r = c.get(path) if method == "GET" else c.post(path, json={})
                self.assertEqual(r.status_code, 409, path)
                self.assertEqual(r.get_json()["kind"], "shell", path)
        self.assertEqual(lots.SHELL_HITS - before, len(routes), "来た数を数える（窓が答えていれば 0）")
        r = c.get("/api/lots/fetch-lotdsp/status")
        self.assertEqual(r.status_code, 200, "名乗っていなければ今までどおり")


if __name__ == "__main__":
    unittest.main()
