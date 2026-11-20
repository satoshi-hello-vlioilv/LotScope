# -*- coding: utf-8 -*-
"""起こしたままの相手の台本（tests/fakes_serve.py。版 3.117.0）: app を import しない標準の Python（python -I）で起こせて、
最初の 1 行で URL を名乗り、標準入力が閉じると終わる。Python 無しの形（TPA_NO_PYTHON=1）の窓の試験が起こす形そのもの。
"""
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with DIRECT.open(req, timeout=5) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


class FakesServe(unittest.TestCase):
    def start(self, *args):
        # -I: 環境変数の PYTHONPATH も台本のフォルダも道に足さない。-X importtime は使わず、app を読んでいないことは終わった後の出力で見る
        code = ("import runpy, sys; sys.argv = sys.argv[1:]; import atexit; "
                "atexit.register(lambda: sys.stderr.write('APP' if any(m == 'app' or m.startswith('app.') for m in sys.modules) else 'NOAPP')); "
                "runpy.run_path(sys.argv[0], run_name='__main__')")
        p = subprocess.Popen([sys.executable, "-I", "-c", code, str(PROGRAM / "tests" / "fakes_serve.py"), *args],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
        self.addCleanup(lambda: (p.stdin.close() if not p.stdin.closed else None, p.wait(timeout=10), p.stdout.close(), p.stderr.close()))
        return p, json.loads(p.stdout.readline())

    def stop(self, p):
        p.stdin.close()
        self.assertEqual(p.wait(timeout=10), 0)
        self.assertEqual(p.stderr.read(), "NOAPP", "起こしたままの相手は app を import しない")

    def test_equipgroups_serves_the_schedule_of_l1(self):
        p, first = self.start("equipgroups")
        self.assertEqual(list(first["urls"]), ["cm3"])
        status, body = post(first["urls"]["cm3"] + "/init", {"setsubiName": "L-1"})
        self.assertEqual((status, body["status"], len(body["entity"]["meisaiList"]) >= 6), (200, "SUCCESS", True))
        self.stop(p)

    def test_schedule_answers_what_it_was_asked(self):
        """スケジュールの作り物: 場面ごとの答えと、受けた要求の数（ask）。仕掛の SQLite は引数で渡す"""
        from tests import lotlist_fixture, schedule_fixture
        with tempfile.TemporaryDirectory() as d:
            wip = Path(d) / "LOTNOW.sqlite3"
            lotlist_fixture.make_wip(str(wip), n=40)
            schedule_fixture.add_kama(wip)
            p, first = self.start("schedule", str(wip))
            self.assertEqual(sorted(first["urls"]), ["cm3", "hole"])

            def ask(line):
                p.stdin.write(line + "\n")
                p.stdin.flush()
                return json.loads(p.stdout.readline())
            self.assertEqual(ask("count rs sjis"), 0)
            base = first["urls"]["cm3"] + "/rs/sjis"
            req = urllib.request.Request(base + "/init", data=json.dumps({"setsubiName": "L-1"}).encode("utf-8"))
            with DIRECT.open(req, timeout=5) as r:
                self.assertIn("Shift_JIS", r.headers.get("Content-Type", ""))
                self.assertEqual(json.loads(r.read().decode("cp932"))["status"], "SUCCESS")
            self.assertEqual(ask("count rs sjis"), 1)
            self.assertEqual(len(ask("requests rs sjis")), 1)
            self.assertEqual(ask("count py sjis"), 0, "係（道の頭）ごとに数える")
            self.stop(p)

    def test_non_ascii_answers_survive_a_non_utf8_pipe_under_isolated_mode(self):
        """python -I は PYTHONIOENCODING を読まない（版 3.117.0 の作った後の採点の割れ 5）。Windows のパイプ（その PC の符号）をまねて、
        標準入出力を ascii にした上で起こしても、ASCII でない字の名乗りと答えを UTF-8 の 1 行で書く。答える口の誤りは {"error": …} の 1 行で答える。
        作り物は一時フォルダに写した入口の隣に置く（取り出しの中に書かない）"""
        with tempfile.TemporaryDirectory() as d:
            here = Path(d)
            (here / "fakes_serve.py").write_bytes((PROGRAM / "tests" / "fakes_serve.py").read_bytes())
            (here / "fakes_zz.py").write_text(
                "def start():\n"
                "    def ask(line):\n"
                "        if line.strip() == 'boom':\n"
                "            raise ValueError('設備が無い')\n"
                "        return {'名前': '設備L-1', 'line': line.strip()}\n"
                "    return {'urls': {'x': 'http://127.0.0.1:1/設備'}, 'close': lambda: None, 'ask': ask}\n", encoding="utf-8")
            code = ("import io, runpy, sys; sys.argv = sys.argv[1:]; "
                    "sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='ascii'); "
                    "sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='ascii', errors='replace'); "
                    "runpy.run_path(sys.argv[0], run_name='__main__')")
            p = subprocess.Popen([sys.executable, "-I", "-c", code, str(here / "fakes_serve.py"), "zz"], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**__import__("os").environ, "PYTHONIOENCODING": "ascii"})
            try:
                first = json.loads(p.stdout.readline().decode("utf-8"))
                self.assertEqual(first["urls"]["x"], "http://127.0.0.1:1/設備")
                for line, want in ((b"ask\n", {"名前": "設備L-1", "line": "ask"}), (b"boom\n", {"error": "ValueError: 設備が無い"})):
                    p.stdin.write(line)
                    p.stdin.flush()
                    self.assertEqual(json.loads(p.stdout.readline().decode("utf-8")), want)
                p.stdin.close()
                self.assertEqual(p.wait(timeout=10), 0, p.stderr.read().decode("utf-8", "replace"))
            finally:
                if p.poll() is None:
                    p.kill()
                p.stdout.close()
                p.stderr.close()

    def test_an_unknown_kind_is_refused(self):
        r = subprocess.run([sys.executable, "-I", str(PROGRAM / "tests" / "fakes_serve.py"), "../x"], capture_output=True, text=True, encoding="utf-8")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("知らない種類", r.stderr)


if __name__ == "__main__":
    unittest.main()
