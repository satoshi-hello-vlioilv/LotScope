"""窓が焼いた表（desktop/tests/baked/*.json。版 3.115.0）が古くないか: 焼いた時の元（答え合わせ役など）の指紋が今の元と同じ・表の形・
本の行き先の表（books.json）の 36 本（tools/bless.py --check と同じ）。変異: 元を 1 字変えると古いと言う"""
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bless", PROGRAM / "tools" / "bless.py")
bless = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bless)


class BakedTables(unittest.TestCase):
    def test_tables_are_not_stale(self):
        self.assertEqual(bless.check(), [])

    def test_books_cover_every_oracle(self):
        oracles = {p.name.removesuffix("_oracle.py") for p in (PROGRAM / "tests").glob("*_oracle.py")}
        self.assertEqual(set(bless.BOOKS), oracles)
        self.assertEqual(sum(1 for b in bless.BOOKS.values() if b["phase"] == "3.115.0"), 21)
        self.assertEqual(sum(1 for b in bless.BOOKS.values() if b["phase"] == "keep"), 1)
        # 版 3.116.0: 2 版目で焼いた 7 本と、次の版（3.117.0）へ送った 7 本（送った理由を why に書く）
        self.assertEqual(sorted(k for k, b in bless.BOOKS.items() if b["phase"] == "3.116.0"),
                         ["calc", "conversions", "lists", "lotlist", "presence", "settings", "ui_defaults"])
        sent = sorted(k for k, b in bless.BOOKS.items() if b["phase"] == "3.117.0")
        self.assertEqual(sent, ["dashboard", "equipgroups", "lotdsp", "ops", "pivot", "routes", "schedule"])
        for k in sent:
            self.assertTrue(bless.BOOKS[k].get("why"), f"{k}: 次の版へ送った理由が無い")
        self.assertEqual({b["phase"] for b in bless.BOOKS.values()}, {"3.115.0", "3.116.0", "3.117.0", "keep"})

    def test_packed_tables_open_and_stay_under_the_size_limits(self):
        """詰めた表（版 3.116.0。parts・@same・@rep）は開ける・大きさ（UTF-8 のバイト）は上限の内。変異: 上限を下げる・参照の先を消すと落ちる"""
        packed = [n for n in bless.tables() if "parts" in json.loads((bless.BAKED / f"{n}.json").read_text(encoding="utf-8"))]
        self.assertGreaterEqual(len(packed), 7, packed)
        for n in packed:
            t = bless.unpack_table(json.loads((bless.BAKED / f"{n}.json").read_text(encoding="utf-8")))
            self.assertNotIn("parts", t)
            self.assertNotIn('{"@same"', json.dumps(list(t["answers"].values())[:3], ensure_ascii=False), n)
        old_total, old_cap = bless.MAX_TOTAL_MB, bless.BOOKS["calc"].get("maxMB")
        try:
            bless.MAX_TOTAL_MB = 1.0
            self.assertTrue(any("焼いた表の計が大きい" in x for x in bless.check()))
            bless.MAX_TOTAL_MB = old_total
            bless.BOOKS["calc"]["maxMB"] = 1.0
            self.assertTrue(any(x.startswith("calc: 表が大きい") for x in bless.check()))
        finally:
            bless.MAX_TOTAL_MB = old_total
            bless.BOOKS["calc"]["maxMB"] = old_cap
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            t = json.loads((tmp / "presence.json").read_text(encoding="utf-8"))
            t["parts"].pop(next(iter(t["parts"])))
            (tmp / "presence.json").write_text(json.dumps(t), encoding="utf-8")       # 対の無い代用字は \\udXXX のまま書く
            self.assertTrue(any(x.startswith("presence:") and "parts にありません" in x for x in bless.check(tmp)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_stats_count_the_settled_stamps(self):
        """本ごとの大きさ・歩・葉・そろえた印の数（そろえすぎを数で見せる。版 3.116.0 の first_fixes 12）"""
        s = bless.stats_of(bless.BAKED / "calc.json")
        self.assertGreater(s["steps"], 1000)
        self.assertGreater(s["leaves"], 100000)
        self.assertLess(s["stamped"], s["leaves"] * bless.STAMP_SHARE, "計算の答えに印はほとんど無い")
        s = bless.stats_of(bless.BAKED / "settings.bundle.json")
        self.assertIn("@WORK", s["stamps"])
        # 知らせ（落とさない）: 印のある葉が 2 割を超えるのは fs だけ（答えがフォルダの道そのものの本。@WORK は道の頭だけを替え、後ろの段は比べる）
        self.assertEqual([x.split(":")[0] for x in bless.notices()], ["fs"])

    def test_scene_scripts_and_truths_do_not_import_the_app(self):
        """場面の台本（Python 無しの形でも流す標準の Python）と独立の答えは program/app を import しない（版 3.116.0。ci-shape.py の確かめと同じ）"""
        import importlib.util
        spec = importlib.util.spec_from_file_location("ci_shape", PROGRAM / "tools" / "ci-shape.py")
        ci = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ci)
        for rel in ["tests/lists_scene.py", "tests/lotlist_fixture.py"] + [f"tools/{p.name}" for p in (PROGRAM / "tools").glob("*-truth.py")]:
            self.assertIsNone(ci.imports_app(PROGRAM / rel), rel)
        self.assertEqual(ci.imports_app(PROGRAM / "tests" / "lists_oracle.py"), "lists_oracle.py", "答え合わせ役は app を import する（見つける側の確かめ）")
        log = Path(tempfile.mkdtemp()) / "calls.log"
        log.write_text(f"TPA\t-I\t{PROGRAM / 'tests' / 'lists_scene.py'}\tx\nTPA\t-c\timport sys\n", encoding="utf-8")
        self.assertEqual(ci.python_calls_ok(log), [])
        log.write_text(f"TPA\t{PROGRAM / 'tests' / 'calc_oracle.py'}\tx\nPATH\t-V\n", encoding="utf-8")
        self.assertEqual(len(ci.python_calls_ok(log)), 2, "app を import する台本と PATH の python は見つける")
        shutil.rmtree(log.parent, ignore_errors=True)

    def test_scenes_do_not_carry_the_checkout_times_and_modes(self):
        """場面は取り出しのファイルの更新時刻と権限を持ち込まない（版 3.116.0 の作った後の採点の割れ 1: 持ち込むと、取り出してから 2 日を過ぎた
        作業フォルダ・umask 002 の取り出しで「表が古い」と落ちた）。答え合わせ役は取り出しから直に写さず tests/scene_files.py を通す。
        変異: 古い時刻・775/664 の元を写しても、写した物は今の時刻・755/644。表の場面に今から離れた時刻があれば知らせる"""
        import os
        import re
        import time
        from tests import scene_files
        direct = re.compile(r"shutil\.(copytree|copy2|copy|copyfile)\(\s*\(?\s*(PROGRAM|ROOT|BASE)\b")
        for p in sorted((PROGRAM / "tests").glob("*_oracle.py")):
            self.assertIsNone(direct.search(p.read_text(encoding="utf-8")), f"{p.name}: 取り出しから直に写している（scene_files を通す）")
        tmp = Path(tempfile.mkdtemp())
        try:
            src = tmp / "src"
            (src / "sub").mkdir(parents=True)
            for f in (src / "a.json", src / "sub" / "b.json"):
                f.write_text("{}", encoding="utf-8")
            old = time.time() - 5 * 86400
            for p in (src / "a.json", src / "sub" / "b.json", src / "sub", src):
                os.chmod(p, 0o775 if p.is_dir() else 0o664)
                os.utime(p, (old, old))
            scene_files.copy_tree(src, tmp / "dst")
            scene_files.copy_file(src / "a.json", tmp / "one.json")
            for p in (tmp / "dst", tmp / "dst" / "sub", tmp / "dst" / "a.json", tmp / "dst" / "sub" / "b.json", tmp / "one.json"):
                st = p.stat()
                self.assertEqual(st.st_mode & 0o777, 0o755 if p.is_dir() else 0o644, p)
                self.assertLess(abs(st.st_mtime - time.time()), 60, p)
            self.assertLess(abs((src / "a.json").stat().st_mtime - old), 2, "元は変えない")
            # 表の場面に今から離れた更新時刻があれば知らせる（sceneTimesWhy のある本〈builder〉は知らせない）
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            self.assertEqual([x.split(":")[0] for x in bless.notices(tmp)], ["fs"])
            t = json.loads((tmp / "shifts.json").read_text(encoding="utf-8"))
            rel = next(iter(t["scene"]["files"]))
            t["scene"]["files"][rel]["mtime"] = "@NOW(-432000000ms)"
            (tmp / "shifts.json").write_text(json.dumps(t), encoding="utf-8")
            far = [x for x in bless.notices(tmp) if x.startswith("shifts:")]
            self.assertTrue(far and "今から 10 分より離れている" in far[0], bless.notices(tmp))
            self.assertTrue(bless.BOOKS["builder"].get("sceneTimesWhy"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_ci_shape_makes_an_old_checkout_and_says_when_nothing_ran(self):
        """ci-shape.py（版 3.116.0 の作った後の直し）: 取り出しを「古い・775/664」の形にして、抜けるときに元へ戻す。1 つの形も流せない PC
        （root でない）では「流せませんでした」・終了コード 3（通ったことにしない）"""
        import contextlib
        import importlib.util
        import io
        import os
        import time
        spec = importlib.util.spec_from_file_location("ci_shape", PROGRAM / "tools" / "ci-shape.py")
        ci = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ci)
        tmp = Path(tempfile.mkdtemp())
        old_program = ci.PROGRAM
        try:
            (tmp / "data" / "sub").mkdir(parents=True)
            f = tmp / "data" / "sub" / "x.json"
            f.write_text("{}", encoding="utf-8")
            os.chmod(f, 0o644)
            before = (f.stat().st_mode & 0o777, f.stat().st_mtime_ns)
            ci.PROGRAM = tmp
            with ci.OldCheckout():
                st = f.stat()
                self.assertEqual(st.st_mode & 0o777, 0o664)
                self.assertEqual((tmp / "data" / "sub").stat().st_mode & 0o777, 0o775)
                self.assertGreater(time.time() - st.st_mtime, (ci.OLD_DAYS - 1) * 86400)
            self.assertEqual((f.stat().st_mode & 0o777, f.stat().st_mtime_ns), before, "元の権限と更新時刻へ戻す")
        finally:
            ci.PROGRAM = old_program
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertIn("builder_parity", ci.NODNS_TESTS)
        # root でない PC: どの形も流せない → 終了コード 3 と「流せませんでした」
        old = (ci.test_bins, os.geteuid, sys.argv)
        out = io.StringIO()
        try:
            ci.test_bins = lambda tests: {"bake_selftest": "/bin/true"}
            os.geteuid = lambda: 1000
            sys.argv = ["ci-shape.py", tempfile.mkdtemp()]
            with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as e:
                ci.main()
            self.assertEqual(e.exception.code, 3)
            self.assertIn("流せませんでした", out.getvalue())
            self.assertNotIn("すべて通りました", out.getvalue())
        finally:
            shutil.rmtree(sys.argv[1], ignore_errors=True)
            ci.test_bins, os.geteuid, sys.argv = old

    def test_the_windows_measure_summary_reads_the_records(self):
        """Windows の測るだけの仕事の記録のまとめ（bless.py --measured。落とさない）"""
        import contextlib
        import io
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "calc.json").write_text(json.dumps({"file": "calc", "os": "windows", "steps": 3, "tableSteps": 3, "missing": [], "differing": [
                {"key": "a", "route": "POST /api/calculate", "diff": ".json.processes[1].total_off_front_m: 1.0 / 1.0000000000000002"}]}), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                bless.measured(tmp)
                bless.measured(tmp / "無い")
            text = out.getvalue()
            self.assertIn("calc（windows）: 歩 3・表と違う歩 1", text)
            self.assertIn("total_off_front_m×1", text)
            self.assertIn("計: 表 1 つ・歩 3・焼いた表（posix）と違う歩 1", text)
            self.assertIn("測りの記録がありません", text)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_changed_source_makes_the_table_stale(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "tests").mkdir()
            src = PROGRAM / "tests" / "settings_write_oracle.py"
            shutil.copy(src, tmp / "tests" / src.name)
            shutil.copy(PROGRAM / "tests" / "oracle_gate.py", tmp / "tests" / "oracle_gate.py")
            old = bless.PROGRAM
            bless.PROGRAM = tmp
            try:
                self.assertEqual([x for x in bless.check() if x.startswith("settings_write:")], [])
                (tmp / "tests" / src.name).write_text(src.read_text(encoding="utf-8") + "# 1 字\n", encoding="utf-8")
                self.assertTrue(any("settings_write: 元" in x for x in bless.check()))
            finally:
                bless.PROGRAM = old
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_every_table_is_checked_even_the_parts(self):
        """部分の表（本.部分.json）も確かめる（版 3.115.0 の作った後の直し: 前は 本.json だけを見て、部分の表の答えを消しても通った）"""
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            self.assertEqual(bless.check(tmp), [])
            parts = [n for n in bless.tables(tmp) if "." in n]
            self.assertGreaterEqual(len(parts), 5, parts)
            for name in parts:
                with self.subTest(name):
                    t = json.loads((tmp / f"{name}.json").read_text(encoding="utf-8"))
                    keep = json.dumps(t, ensure_ascii=False)
                    t.pop("answers")
                    (tmp / f"{name}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
                    self.assertTrue(any(x.startswith(f"{name}:") for x in bless.check(tmp)), "答えを消した部分の表")
                    t = json.loads(keep)
                    t["sources"] = {k: "0" * 16 for k in t["sources"]}
                    (tmp / f"{name}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
                    self.assertTrue(any(x.startswith(f"{name}: 元") for x in bless.check(tmp)), "指紋を壊した部分の表")
                    (tmp / f"{name}.json").write_text(keep, encoding="utf-8")
            (tmp / "知らない本.json").write_text("{}", encoding="utf-8")
            self.assertTrue(any("知らない本" in x for x in bless.check(tmp)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_tables_keep_no_local_paths(self):
        """焼いた表に、焼いた PC のリポジトリの道・家・cargo の作業フォルダが字のまま残っていない（版 3.115.0 の 2 回目の直し）。変異: 道を書き込むと落ちる"""
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            self.assertEqual([x for x in bless.check(tmp) if "焼いた PC" in x], [])
            t = json.loads((tmp / "settings_write.json").read_text(encoding="utf-8"))
            t["oracle"]["x"] = str(PROGRAM / "app" / "master_defaults")
            (tmp / "settings_write.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
            self.assertTrue(any("settings_write: 焼いた PC のリポジトリの根" in x for x in bless.check(tmp)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_tables_keep_no_words_of_the_resolver(self):
        """焼いた表に、PC の名前を引く係（DNS）の様子で変わる言葉が無い（版 3.115.0 の PR #115 の CI の直し: 場面は本物の名前を引かない）。
        変異: 答えに書き込むと --check が落ちる"""
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            self.assertEqual([x for x in bless.check(tmp) if "名前を引く係" in x], [])
            for word in ("[Errno -2] Name or service not known", "[Errno -3] Temporary failure in name resolution"):
                t = json.loads((tmp / "builder.json").read_text(encoding="utf-8"))
                t["answers"]["x"] = {"error": f"CM3に接続できません: {word}"}
                (tmp / "builder.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
                self.assertTrue(any("builder: PC の名前を引く係" in x for x in bless.check(tmp)), word)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_near_dates_in_the_sources_stop_the_bless(self):
        """答え合わせ役の元に今日に近い固定の日付があれば焼かない（時限の爆弾にしない）"""
        import datetime as dt
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "tests").mkdir()
            (tmp / "tests" / "settings_write_oracle.py").write_text(f"X = '{dt.date.today():%Y-%m-%d}'\nY = '2001-01-01'\n", encoding="utf-8")
            (tmp / "tests" / "oracle_gate.py").write_text("", encoding="utf-8")
            old = bless.PROGRAM
            bless.PROGRAM = tmp
            try:
                near = bless.near_dates("settings_write")
            finally:
                bless.PROGRAM = old
            self.assertEqual(len(near), 1, near)
            self.assertEqual([x for b in bless.BOOKS for x in bless.near_dates(b)], [], "今の元には近い日付が無い")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_two_blesses_compare_without_offsets_and_random_ids(self):
        t = {"oracle": {}, "answers": {"k": 1}, "variants": None,
             "scene": {"files": {"a": {"blob": "h1", "mtime": "@NOW(-5ms)"}}, "dirs": {}, "links": {},
                       "blobs": {"h1": {"text": "@NOW(-5ms,T,s) 0123456789abcdef0123456789abcdef"}}}}
        t["answers"]["t"] = "@T(Ts|-12)"
        u = json.loads(json.dumps(t).replace("-5ms", "-900ms").replace("0123456789abcdef0123456789abcdef", "f" * 32).replace("|-12)", "|30)"))
        self.assertIsNone(bless.first_diff(bless.comparable(t), bless.comparable(u)))
        u["answers"]["k"] = 2
        self.assertIsNotNone(bless.first_diff(bless.comparable(t), bless.comparable(u)))


if __name__ == "__main__":
    unittest.main()
