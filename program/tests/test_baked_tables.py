"""窓が焼いた表（desktop/tests/baked/*.json。版 3.115.0）が古くないか: 焼いた時の元（答え合わせ役など）の指紋が今の元と同じ・表の形・
本の行き先の表（books.json）の 36 本（tools/bless.py --check と同じ）。変異: 元を 1 字変えると古いと言う"""
import importlib.util
import json
import shutil
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
            (tmp / "presence.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
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
        self.assertEqual(bless.notices(), [], "印のある葉が 2 割を超える本は無い")

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
