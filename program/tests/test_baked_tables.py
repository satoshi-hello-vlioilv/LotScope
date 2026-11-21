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


# 凍らせた Python の写し（program/tests/legacy/3.117.3。版 3.117.3。tools/freeze-legacy.py が 1 回だけ作った）の MANIFEST.json の sha256。
# 写しのファイルの sha256 は MANIFEST.json が持ち、MANIFEST.json そのものの指紋をここに書く（写しと MANIFEST.json を一緒に書き換えても落ちる）
LEGACY_MANIFEST_SHA = "6fef09de40f5de3ea02163cff084955d485a5859d023327998bc8c2d09a42aad"

# 版 3.117.0 の本の行き先（焼いた本・後の版で焼く本）
BOOKS_3117 = {"3.117.0": ["equipgroups", "lotdsp"], "3.117.1": ["schedule"], "3.117.2": ["dashboard", "ops", "pivot", "routes"]}


class BakedTables(unittest.TestCase):
    def test_tables_are_not_stale(self):
        self.assertEqual(bless.check(), [])

    def test_books_cover_every_oracle(self):
        oracles = {p.name.removesuffix("_oracle.py") for p in (PROGRAM / "tests").glob("*_oracle.py")}
        self.assertEqual(set(bless.BOOKS), oracles)
        self.assertEqual(sum(1 for b in bless.BOOKS.values() if b["phase"] == "3.115.0"), 21)
        self.assertEqual(sum(1 for b in bless.BOOKS.values() if b["phase"] == "keep"), 1)
        # 版 3.116.0: 2 版目で焼いた 7 本
        self.assertEqual(sorted(k for k, b in bless.BOOKS.items() if b["phase"] == "3.116.0"),
                         ["calc", "conversions", "lists", "lotlist", "presence", "settings", "ui_defaults"])
        # 版 3.117.0（段 ④ の入口までを小さい版 4 つに刻む 1 つ目）: 起こしたままの相手の本を焼き、残りは後の版（送った理由を why に書く）
        by = {ph: sorted(k for k, b in bless.BOOKS.items() if b["phase"] == ph) for ph in ("3.117.0", "3.117.1", "3.117.2")}
        self.assertEqual(by, BOOKS_3117)
        for k in by["3.117.1"] + by["3.117.2"]:
            self.assertTrue(bless.BOOKS[k].get("why"), f"{k}: 後の版へ送った理由が無い")
        self.assertEqual({b["phase"] for b in bless.BOOKS.values()}, {"3.115.0", "3.116.0", "keep"} | {ph for ph, ks in by.items() if ks})
        # 焼く版（bless.py・ci-shape.py の PHASES）は books.json の bakedPhases の 1 か所から読む（版 3.117.0 の作った後の直し・割れ 6 (d)）
        phases = json.loads((bless.BAKED / "books.json").read_text(encoding="utf-8"))["bakedPhases"]
        self.assertEqual(list(bless.PHASES), phases)
        self.assertEqual(bless.ci_shape().PHASES, bless.PHASES)
        # 版 3.117.1: schedule を焼いた（③-6 と同じ版）。版 3.117.2: 場面の台本（tests/ui_scene.py）と routes・pivot・dashboard・ops
        self.assertEqual(phases, ["3.115.0", "3.116.0", "3.117.0", "3.117.1", "3.117.2"], "この版で焼いた版の並び（版を足したらここも）")
        self.assertEqual({b["phase"] for b in bless.BOOKS.values() if b["phase"] in phases}, set(phases), "焼いた版ごとに本がある")

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
        # 版 3.117.0: 起こしたままの相手の台本（作り物の CM3 など）と、その作り物も
        # 版 3.117.2: 開発用サーバーと稼働の評価関数の場面の台本（tests/ui_scene.py）と、それが使う写しの部品
        for rel in ["tests/lists_scene.py", "tests/lotlist_fixture.py", "tests/fakes_serve.py", "tests/schedule_fixture.py", "tests/lotdsp_cdp_fake.py",
                    "tests/ui_scene.py", "tests/scene_files.py"] \
                + [f"tests/{p.name}" for p in (PROGRAM / "tests").glob("fakes_*.py")] \
                + [f"tools/{p.name}" for p in (PROGRAM / "tools").glob("*-truth.py")]:
            self.assertIsNone(ci.imports_app(PROGRAM / rel), rel)
        self.assertEqual(ci.imports_app(PROGRAM / "tests" / "lists_oracle.py"), "lists_oracle.py", "答え合わせ役は app を import する（見つける側の確かめ）")
        log = Path(tempfile.mkdtemp()) / "calls.log"
        log.write_text(f"TPA\t-I\t{PROGRAM / 'tests' / 'lists_scene.py'}\tx\nTPA\t-c\timport sys\n", encoding="utf-8")
        self.assertEqual(ci.python_calls_ok(log), [])
        # 起こしたままの相手の入口（版 3.117.0）: 種類ごとの作り物（tests/fakes_<種類>.py）も見る。引数の道（仕掛の SQLite）は種類と読まない
        fakes = PROGRAM / "tests" / "fakes_serve.py"
        log.write_text(f"TPA\t-I\t{fakes}\tequipgroups\nTPA\t-I\t{fakes}\tschedule\t/tmp/x/LOTNOW.sqlite3\nTPA\t-I\t{fakes}\tlotdsp\n", encoding="utf-8")
        self.assertEqual(ci.python_calls_ok(log), [])
        # app を import する作り物（取り出しの中に書かない: 一時フォルダに写した入口の隣に置く。版 3.117.0 の作った後の直し・割れ 6 (b)）
        side = log.parent / "side"
        side.mkdir()
        shutil.copy(fakes, side / "fakes_serve.py")
        (side / "fakes_zz_selftest.py").write_text("from app import create_app\n\n\ndef start():\n    return create_app\n", encoding="utf-8")
        log.write_text(f"TPA\t-I\t{side / 'fakes_serve.py'}\tzz_selftest\n", encoding="utf-8")
        self.assertEqual(len(ci.python_calls_ok(log)), 1, "app を import する作り物は見つける")
        self.assertFalse((PROGRAM / "tests" / "fakes_zz_selftest.py").exists(), "取り出しの中に書かない")
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
        # 版 3.117.2: 答え合わせ役の場面を作る道具（開発用サーバー・稼働の評価関数）と場面の台本も
        for p in sorted((PROGRAM / "tests").glob("*_oracle.py")) + [PROGRAM / "tools" / "ui_server.py", PROGRAM / "tools" / "ops-bench.py",
                                                                    PROGRAM / "tests" / "ui_scene.py"]:
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

    def test_ci_shape_runs_with_the_env_shape(self):
        """ci-shape の環境変数の形（版 3.117.0）: プロキシは閉じた口・TLS の根の置き場は空・PC の名前を替える・nopy は umask 077 と LANG=C。
        足す環境変数（bless の 2 回目の焼きの TPA_BLESS など）と、利用者を替えない形（as_root）も渡る。root でない・unshare の無い PC では流せない"""
        import importlib.util
        import os
        spec = importlib.util.spec_from_file_location("ci_shape", PROGRAM / "tools" / "ci-shape.py")
        ci = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ci)
        if ci.cannot_run():
            self.skipTest(f"形を流せない PC（{ci.cannot_run()}）")
        tmp = Path(tempfile.mkdtemp(dir="/dev/shm" if Path("/dev/shm").is_dir() else None))
        try:
            os.chmod(tmp, 0o755)
            dump = tmp / "dump.sh"       # 試験の実行ファイルの代わり: 環境変数・umask・PC の名前・利用者を書く
            dump.write_text('#!/bin/sh\nenv\necho "umask=$(umask)"\necho "host=$(cat /proc/sys/kernel/hostname)"\necho "uid=$(id -u)"\n')
            os.chmod(dump, 0o755)
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()):      # 「NG dump」（試験の実行ファイルでないので test result が無い）は出さない
                ci.run_shape("nopy", {"dump": str(dump)}, tmp, False)
            text = (tmp / "nopy-dump.log").read_text(encoding="utf-8")
            for want in ("http_proxy=http://127.0.0.1:9", "HTTPS_PROXY=http://127.0.0.1:9", "no_proxy=", "LANG=C", "TPA_NO_PYTHON=1",
                         "umask=0077", "host=ci-shape-host", "TZ=Asia/Tokyo"):
                self.assertIn(want + "\n", text)
            self.assertRegex(text, r"SSL_CERT_FILE=\S+/empty-cert\.pem\n")
            self.assertNotIn("uid=0\n", text, "root でない利用者で流す")
            with contextlib.redirect_stdout(io.StringIO()):
                ci.run_shape("nopy", {"dump": str(dump)}, tmp, False, {"TPA_BLESS": "1", "TPA_BAKE_OUT": "/x"}, as_root=True)
            text = (tmp / "nopy-dump.log").read_text(encoding="utf-8")
            for want in ("TPA_BLESS=1", "TPA_BAKE_OUT=/x", "USER=root", "uid=0", "host=ci-shape-host"):
                self.assertIn(want + "\n", text)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_the_windows_measure_summary_reads_the_records(self):
        """Windows の測るだけの仕事の記録のまとめ（bless.py --measured。落とさない）。流した形（Python と比べる形・表だけの形）ごとに
        別の行で出し、--json の行（仕事の記録）から記録を戻せる（版 3.117.0）"""
        import contextlib
        import io
        tmp = Path(tempfile.mkdtemp())
        try:
            py, tab = tmp / "py", tmp / "table"
            py.mkdir()
            tab.mkdir()
            (py / "calc.json").write_text(json.dumps({"file": "calc", "os": "windows", "steps": 3, "tableSteps": 3, "missing": [], "differing": [
                {"key": "a", "route": "POST /api/calculate", "diff": ".json.processes[1].total_off_front_m: 1.0 / 1.0000000000000002"}]}), encoding="utf-8")
            (tab / "calc.json").write_text(json.dumps({"file": "calc", "os": "windows", "form": "table", "finished": True, "steps": 3, "tableSteps": 3,
                                                        "missing": [], "differing": []}), encoding="utf-8")
            (tab / "fs.json").write_text(json.dumps({"file": "fs", "os": "windows", "form": "table", "finished": False, "steps": 0, "tableSteps": 2,
                                                      "missing": ["a", "b"], "differing": [], "sceneError": "名前「a:b」は作れません"}, ensure_ascii=False), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                bless.measured([py, tab, tmp / "無い"], as_json=True)
            text = out.getvalue()
            self.assertIn("calc（windows）: 歩 3・表と違う歩 1", text)
            self.assertIn("total_off_front_m×1", text)
            self.assertIn("計（Python と比べる形（その PC の Python が場面を作る））: 表 1 つ・歩 3・焼いた表（posix）と違う歩 1・表にあって答えない歩 0・場面を作れなかった表 0", text)
            self.assertIn("計（表だけの形（TPA_NO_PYTHON=1。表の宣言から場面を作る。段 ④ の後の形））: 表 2 つ・歩 3・焼いた表（posix）と違う歩 0・"
                          "表にあって答えない歩 2・場面を作れなかった表 1（fs）・終わりまで流れなかった表 1（fs）", text)
            self.assertIn("sceneError: 名前「a:b」は作れません", text)
            self.assertIn("測りの記録がありません", text)
            # 仕事の記録（log。行の頭に時刻が付く）から戻す
            log = tmp / "job.log"
            log.write_text("\n".join("2026-11-19T13:16:56.9Z " + line for line in text.splitlines()), encoding="utf-8")
            self.assertEqual(bless.from_log(log, tmp / "back"), (3, 0))
            # 読めない行（途中で切れた・file の無い）は数えて言う（版 3.117.0 の作った後の直し・割れ 3）
            cut = tmp / "cut.log"
            cut.write_text(log.read_text(encoding="utf-8") + "\nx " + bless.JSON_LINE + '{"file": "calc", "ste\n' + bless.JSON_LINE + '{"steps": 1}\n',
                           encoding="utf-8")
            self.assertEqual(bless.from_log(cut, tmp / "back2"), (3, 2))
            for form, name in (("python", "calc"), ("table", "calc"), ("table", "fs")):
                src = json.loads(((py if form == "python" else tab) / f"{name}.json").read_text(encoding="utf-8"))
                self.assertEqual(json.loads((tmp / "back" / form / f"{name}.json").read_text(encoding="utf-8")), src)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_the_measure_books_are_told(self):
        """札が measure の本（Windows の表だけの形でまだ比べていない本）は --check の知らせに数と名前が出る（版 3.117.3 の作った後の直し・割れ 3。
        段 ④ の入口の条件 2 は 0 になるまで満たしていない）"""
        left = bless.measure_books()
        want = sorted(b for b, v in bless.BOOKS.items() if v["phase"] in bless.PHASES and v.get("windows") != "table")
        self.assertEqual(left, want)
        told = bless.windows_notice()
        if left:
            self.assertIn(f"札が measure の本 {len(left)}", told)
            self.assertTrue(all(b in told for b in left))
        else:
            self.assertIsNone(told)
        self.assertFalse(any(x.startswith("札が") for x in bless.notices()), "表ごとの知らせ（表の名前: …）とは別の欄")

    def test_the_frozen_python_copy_is_unchanged(self):
        """凍らせた Python の写し（版 3.117.3。段 ④ の入口の条件 3）: 中身が MANIFEST.json と同じ・MANIFEST.json の指紋が試験に書いた物と同じ・
        凍らせた試験が呼ぶ答え合わせ役がそろう・単体の試験の discover に入らない（写しの置き場は package でない）。変異: 1 字変えると言う"""
        import hashlib
        spec = importlib.util.spec_from_file_location("freeze_legacy", PROGRAM / "tools" / "freeze-legacy.py")
        fl = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fl)
        self.assertEqual(fl.check(), [])
        self.assertEqual(hashlib.sha256((fl.DEST / fl.MANIFEST).read_bytes()).hexdigest(), LEGACY_MANIFEST_SHA,
                         "MANIFEST.json が書き換わった（凍らせた写しは 1 回だけ作る）")
        for name in fl.FROZEN_SCRIPTS:
            self.assertTrue((fl.DEST / "tests" / f"{name}.py").is_file(), name)
        self.assertFalse((fl.DEST.parent / "__init__.py").exists() or (fl.DEST / "__init__.py").exists(), "写しの置き場は package にしない")
        self.assertFalse(any(p.name.startswith("test_") for p in fl.DEST.rglob("*.py")), "写しに単体の試験を入れない")
        tmp = Path(tempfile.mkdtemp())
        try:
            shutil.copytree(fl.DEST, tmp / "copy")
            p = tmp / "copy" / "app" / "version.py"
            p.write_bytes(p.read_bytes() + b"# x\n")
            (tmp / "copy" / "tests" / "seeds_oracle.py").unlink()
            (tmp / "copy" / "増えた.py").write_text("", encoding="utf-8")
            bad = fl.check(tmp / "copy")
            self.assertTrue(any("写しが変わった: app/version.py" in x for x in bad), bad)
            self.assertTrue(any("写しから消えた: tests/seeds_oracle.py" in x for x in bad), bad)
            self.assertTrue(any("写しに増えた: 増えた.py" in x for x in bad), bad)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_the_windows_overlay_is_checked_against_the_posix_answers(self):
        """Windows の上書きの表（tests/baked/nt/<表>.json。版 3.117.3）: 上書きした posix の答えの指紋が今の posix の答えと同じか。
        変異: posix の答えを 1 字変えると古いと言う・posix と同じ上書き・表に無い流さない歩・流さない歩の上書きも言う"""
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "nt").mkdir()
            posix = {"book": "x", "file": "x", "answers": {"a": {"status": 200, "json": {"e": "Errno 2"}}, "b": {"status": 200}}}
            (tmp / "x.json").write_text(json.dumps(posix, ensure_ascii=False), encoding="utf-8")
            win = {"status": 200, "json": {"e": "WinError 2"}}
            nt = {"book": "x", "file": "x", "answers": {"a": win}, "posix": {"a": bless.nt_print(posix["answers"]["a"])}, "skip": ["b"], "unmade": ["link s/l"]}

            def bad(n=None, p=None):
                (tmp / "nt" / "x.json").write_text(json.dumps(n or nt, ensure_ascii=False), encoding="utf-8")
                (tmp / "x.json").write_text(json.dumps(p or posix, ensure_ascii=False), encoding="utf-8")
                return bless.check_nt(tmp)[0]
            self.assertEqual(bad(), [])
            self.assertGreater(bless.check_nt(tmp)[1]["x"], 0, "大きさを本に足す")
            changed = json.loads(json.dumps(posix))
            changed["answers"]["a"]["json"]["e"] = "Errno 3"
            self.assertTrue(any("上書きの元の posix の答えが変わった" in x for x in bad(p=changed)), "posix の答えの 1 字")
            same = {**nt, "answers": {"a": posix["answers"]["a"]}}
            self.assertTrue(any("上書きが posix の答えと同じ" in x for x in bad(n=same)))
            self.assertTrue(any("表に無い" in x for x in bad(n={**nt, "skip": ["b", "無い"]})))
            self.assertTrue(any("流さない歩に上書き" in x for x in bad(n={**nt, "skip": ["a"]})))
            self.assertTrue(any("unmade がありません" in x for x in bad(n={k: v for k, v in nt.items() if k != "unmade"})))
            runner = {**nt, "answers": {"a": {"status": 200, "json": {"e": "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\da-fs-2636\\x"}}}}
            self.assertTrue(any("Windows の runner の字" in x for x in bad(n=runner)), "流すたびに変わる runner の道")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_take_nt_reads_the_job_log_and_turns_the_book_to_table(self):
        """bless.py --take-nt（版 3.117.3）: 仕事の記録の詰めた行（measure-z）から nt の表を書き、本の表のどれもが取り込めた本の札を table にする。
        今の表で取った記録だけ（tableSha）・終わりまで流れた記録だけ・posix と同じ答えは上書きしない"""
        import contextlib
        import io
        tmp = Path(tempfile.mkdtemp())
        try:
            baked = tmp / "baked"
            baked.mkdir()
            posix = {"book": "x", "file": "x", "answers": {"a": {"status": 200, "json": {"e": "Errno 2"}}, "b": {"status": 200}, "c": {"status": 1}}}
            (baked / "x.json").write_text(json.dumps(posix, ensure_ascii=False), encoding="utf-8")
            (baked / "x.part.json").write_text(json.dumps({**posix, "file": "x.part"}, ensure_ascii=False), encoding="utf-8")
            books = baked / "books.json"
            books.write_text(json.dumps({"books": {"x": {"phase": bless.PHASES[0], "windows": "measure", "tests": ["x_parity"]}}}), encoding="utf-8")
            win = {"status": 200, "json": {"e": "WinError 2"}}

            def rec(name, **kw):
                return {"file": name, "book": "x", "os": "windows", "form": "table", "finished": True, "steps": 2, "tableSteps": 3,
                        "differing": [{"key": "a", "route": "GET /a", "diff": "…", "got": win},
                                      {"key": "c", "route": "GET /c", "diff": "…", "got": {"status": 1}}],
                        "missing": ["b"], "unmade": ["link s/l"], "tableSha": bless.file_sha(baked / f"{name}.json"), "ntSha": "", **kw}
            meas = tmp / "m"
            meas.mkdir()
            (meas / "x.json").write_text(json.dumps(rec("x"), ensure_ascii=False), encoding="utf-8")
            (meas / "x.part.json").write_text(json.dumps(rec("x.part", tableSha="別の表"), ensure_ascii=False), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                bless.emit([meas])
            log = tmp / "job.log"
            log.write_text("\n".join("2026-11-20T20:45:19.0Z " + line for line in out.getvalue().splitlines()), encoding="utf-8")
            self.assertIn(bless.JSON_Z, log.read_text(encoding="utf-8"))
            taken, refused, flipped = bless.take_nt([log], baked=baked, books_json=books)
            self.assertEqual(taken, ["x"])
            self.assertTrue(any("x.part: 記録は別の表で取った" in r for r in refused), refused)
            self.assertEqual(flipped, [], "本の表の 1 つ（x.part）が取り込めないので札は measure のまま")
            n = json.loads((baked / "nt" / "x.json").read_text(encoding="utf-8"))
            self.assertEqual(n["answers"], {"a": win}, "posix と同じ答え（c）は上書きしない")
            self.assertEqual((n["skip"], n["unmade"]), (["b"], ["link s/l"]))
            self.assertEqual(n["posix"], {"a": bless.nt_print(posix["answers"]["a"])})
            self.assertEqual(bless.check_nt(baked)[0], [])
            # 部分の表も今の表で取り直すと、本の札が table に（x は nt の表ができたので ntSha が要る）
            (meas / "x.part.json").write_text(json.dumps(rec("x.part"), ensure_ascii=False), encoding="utf-8")
            (meas / "x.json").write_text(json.dumps(rec("x", ntSha=bless.file_sha(baked / "nt" / "x.json"), differing=[]), ensure_ascii=False), encoding="utf-8")
            taken, refused, flipped = bless.take_nt([meas], baked=baked, books_json=books)
            self.assertEqual((sorted(taken), refused, flipped), (["x", "x.part"], [], ["x"]))
            self.assertEqual(json.loads(books.read_text(encoding="utf-8"))["books"]["x"]["windows"], "table")
            self.assertEqual(json.loads((baked / "nt" / "x.json").read_text(encoding="utf-8"))["answers"], {"a": win}, "前の上書きは残す")
            # 書く前に確かめる（版 3.117.3 の作った後の直し・割れ 3）: runner の道・ポート・ファイルID が残る記録は断り、何も書かない
            nt_before = (baked / "nt" / "x.json").read_bytes()
            books_before = books.read_bytes()
            for leak in ("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\da-x-1\\y", "http://127.0.0.1:51234/x", "2049:1234567"):
                one = tmp / "one"
                one.mkdir(exist_ok=True)
                (one / "x.json").write_text(json.dumps(rec("x", ntSha=bless.file_sha(baked / "nt" / "x.json"), differing=[
                    {"key": "a", "route": "GET /a", "diff": "…", "got": {"status": 200, "json": {"e": leak, "ファイルID": leak}}}]), ensure_ascii=False), encoding="utf-8")
                taken, refused, flipped = bless.take_nt([one], baked=baked, books_json=books)
                self.assertTrue(any("x: 記録に測った PC の指紋が残る" in r for r in refused), (leak, refused))
                self.assertEqual(((baked / "nt" / "x.json").read_bytes(), books.read_bytes()), (nt_before, books_before), leak)
            # 書いた後の確かめ（check_nt）が落ちたら、前の中身に戻して札も替えない（表に無い歩を流さない歩に書いた記録）
            books.write_text(json.dumps({"books": {"x": {"phase": bless.PHASES[0], "windows": "measure", "tests": ["x_parity"]}}}), encoding="utf-8")
            books_before = books.read_bytes()
            for nm in ("x", "x.part"):
                ntf = baked / "nt" / f"{nm}.json"
                (meas / f"{nm}.json").write_text(json.dumps(rec(nm, ntSha=bless.file_sha(ntf), missing=["b", "無い歩"]), ensure_ascii=False), encoding="utf-8")
            taken, refused, flipped = bless.take_nt([meas], baked=baked, books_json=books)
            self.assertEqual((taken, flipped), ([], []))
            self.assertTrue(any("何も変えていません" in r and "無い歩" in r for r in refused), refused)
            self.assertEqual(((baked / "nt" / "x.json").read_bytes(), books.read_bytes()), (nt_before, books_before))
            self.assertEqual(bless.measure_books(books), ["x"], "札が measure の本の名前")
            # 終わりまで流れなかった記録・got の無い前の記録は取り込まない
            for bad, why in ((rec("x", finished=False), "終わりまで流れなかった"), (rec("x", differing=[{"key": "a", "diff": "…"}]), "got が無い")):
                (meas / "x.json").write_text(json.dumps({**bad, "ntSha": bless.file_sha(baked / "nt" / "x.json")}, ensure_ascii=False), encoding="utf-8")
                self.assertTrue(any(why in r for r in bless.take_nt([meas], baked=baked, books_json=books)[1]), why)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_the_measure_summary_names_the_tables_without_a_record(self):
        """測りのまとめは、焼いた表の一覧と比べて記録の無い表を名前で出す（版 3.117.0 の作った後の採点の割れ 3: 前は記録のある表だけを数え、
        段が上限で切れた・試験が Bake を開く前に落ちた表は、計の「違う歩 0」の側に黙って抜けた）。流さなかった試験（--skip-test）だけが焼く本の表は数えない"""
        import contextlib
        import io
        want = bless.expected_tables()
        self.assertEqual(want, sorted(bless.tables()))
        self.assertEqual(bless.expected_tables(["route_reach"]), want, "settings の表はほかの試験（bundle_parity・page_parity）も焼く")
        self.assertNotIn("calc", bless.expected_tables(bless.BOOKS["calc"]["tests"]))
        tmp = Path(tempfile.mkdtemp())
        try:
            for name in want:
                (tmp / f"{name}.json").write_text(json.dumps({"file": name, "os": "windows", "form": "table", "finished": True, "steps": 1,
                                                               "missing": [], "differing": []}), encoding="utf-8")

            def summary(**kw):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    bless.measured([tmp], **kw)
                return out.getvalue()
            self.assertIn(f"表 {len(want)} つ・歩 {len(want)}・焼いた表（posix）と違う歩 0", summary())
            self.assertIn("・記録の無い表 0（", summary())
            (tmp / "lotdsp.json").unlink()
            text = summary()
            self.assertIn(f"表 {len(want) - 1} つ", text)
            self.assertIn("・記録の無い表 1（lotdsp）", text)
            self.assertIn("・記録の無い表 0（", summary(skip=bless.BOOKS["lotdsp"]["tests"]), "流さなかった試験の表は数えない")
            for p in tmp.glob("*.json"):
                p.unlink()
            self.assertIn(f"記録の無い表 {len(want)}", summary())
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

    def test_tables_keep_no_marks_of_the_baking_pc(self):
        """焼いた表に、焼いた PC の指紋（PC の名前・一時フォルダの下の作業フォルダ・流すたびに変わるポート・ファイルID）が字のまま残っていない
        （版 3.117.0。採点の K2）。変異: 1 つずつ書き込むと --check が落ちる。許す形（場面が決めた閉じた口・時刻・@ の印）は落ちない"""
        import socket
        self.assertEqual([x for x in bless.check() if "焼いた PC の指紋" in x], [])
        host = socket.gethostname()
        marks = {"この PC の名前": [f'{{"pc": "{host}"}}', f'{{"key": "{host}@root"}}', f'{{"error": "PC {host} が保存中"}}'],
                 "一時フォルダ": ['{"dir": "/tmp/da-fs-1234/share"}', '{"file": "/tmp/tpa-ui-abc/【New】実績/x.sqlite3"}', '{"a": "/dev/shm/da-x-9"}'],
                 "ポート": ['{"url": "http://127.0.0.1:43211/api"}', '{"Host": "127.0.0.1:8123"}'],
                 "ファイルID": ['{"fid": "2049:1234567"}', '{"files": {"26:4411": "実績_L1.sqlite3"}}']}
        for why, texts in marks.items():
            for text in texts:
                hit = [w for w, _ in bless.pc_marks(text)]
                self.assertTrue(len(hit) == 1 and why in hit[0], f"{text}: {hit}")
        for ok in ('{"url": "http://127.0.0.1:1"}', '{"at": "2026-10-02 10:30:00.123"}', '{"t": "10:30"}', '{"url": "@URL(cm3)/x", "fid": "@FID(a/b)"}',
                   '{"dir": "/tmp/x/../y"}', '{"dir": "@WORK/share"}', f'{{"pc": "{host}x", "who": "x{host}"}}', '{"range": "1:1000 の比"}',
                   '{"span": "2026-10-02T10:30:00/2026-10-03T08:15:30"}'):
            self.assertEqual(bless.pc_marks(ok), [], ok)
        # ありふれた PC の名前（localhost・desktop・root・PC-1 など。コンテナ・WSL・仮想の PC に多い）でも、今の表に誤って当たらない
        # （版 3.117.0 の作った後の採点の割れ 1: 前は表の字の全部から探し、localhost で fs・root と desktop で 36 表すべてに当たった）。
        # 見るのは名乗りの欄だけで、場面が決めた名前（問い合わせ・場面の字・本の元の字）は飛ばす
        for name, book in bless.tables().items():
            text = (bless.BAKED / f"{name}.json").read_text(encoding="utf-8")
            for h in ("localhost", "desktop", "root", "PC-1"):
                self.assertEqual(bless.pc_marks(text, host=h, user="@USER", book=book), [], f"{name}: {h}")
        # 利用者の名前を書く欄（settle.json の nameKeys）の、焼いた利用者の名前（割れ 2）。ほかの欄・@USER は当たらない
        self.assertEqual(bless.NAME_KEYS, ("login", "holder_login", "ログインID"))
        hit = [w for w, _ in bless.pc_marks('{"login": "root"}', host="zz-host", user="root")]
        self.assertTrue(len(hit) == 1 and "焼いた利用者の名前" in hit[0], hit)
        for ok in ('{"login": "@USER"}', '{"name": "root", "dir": "/root"}', '{"login": "rootx"}'):
            self.assertEqual(bless.pc_marks(ok, host="zz-host", user="root"), [], ok)
        # 表に書き込むと --check が落ちる
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in bless.BAKED.glob("*.json"):
                shutil.copy(p, tmp / p.name)
            t = json.loads((tmp / "builder.json").read_text(encoding="utf-8"))
            t["answers"]["x"] = {"url": "http://127.0.0.1:43211/api"}
            t["routes"]["x"] = "GET /x"
            (tmp / "builder.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
            self.assertTrue(any(x.startswith("builder: 焼いた PC の指紋") and "ポート" in x for x in bless.check(tmp)))
            # 名前を書く欄に焼いた利用者の名前（"login":"root" など）を 1 つ書き込むと --check が落ちる（割れ 2: 前は「古くありません」と言った）
            user = bless.os_user()
            text = (tmp / "equipgroups.json").read_text(encoding="utf-8")
            self.assertIn('"login":"@USER"', text)
            (tmp / "equipgroups.json").write_text(text.replace('"login":"@USER"', '"login":' + json.dumps(user), 1), encoding="utf-8")
            self.assertTrue(any(x.startswith("equipgroups: 焼いた PC の指紋") and "焼いた利用者の名前" in x for x in bless.check(tmp)), user)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_two_bakes_compare_sqlite_files_by_content(self):
        """2 回の焼きの比べは、場面の SQLite のファイルを作った SQLite の版によらない形で比べる（版 3.117.0。2 回目は SQLite の版が違う Python で流す）。
        頭の版の番号・変更の数だけが違うファイルは同じ・行が 1 つ違えば違う・SQLite でない物はバイトのまま"""
        import base64
        import sqlite3
        tmp = Path(tempfile.mkdtemp())
        try:
            def db(name, rows):
                c = sqlite3.connect(tmp / name)
                c.execute("CREATE TABLE t (a, b)")
                c.executemany("INSERT INTO t VALUES (?, ?)", rows)
                c.commit()
                c.close()
                return (tmp / name).read_bytes()
            one = db("a.sqlite3", [(1, "x"), (2, "y")])
            # 別の版の SQLite が書いた形: 頭の「書いた版の番号」（96〜99）と「変更の数」（24〜27・92〜95）だけを変える
            other = bytearray(one)
            other[96:100] = (3045001).to_bytes(4, "big")
            other[24:28] = other[92:96] = (9).to_bytes(4, "big")
            two = db("b.sqlite3", [(1, "x"), (2, "z")])

            def table(data):
                return {"oracle": {}, "answers": {}, "scene": {"files": {"x.sqlite3": {"blob": "h"}}, "dirs": {}, "links": {},
                                                               "blobs": {"h": {"b64": base64.b64encode(bytes(data)).decode()}}}}
            self.assertNotEqual(bytes(other), one)
            self.assertIsNone(bless.first_diff(bless.comparable(table(one)), bless.comparable(table(other))))
            self.assertIsNotNone(bless.first_diff(bless.comparable(table(one)), bless.comparable(table(two))))
            self.assertIsNone(bless.sqlite_logical(b"SQLite format 3\0" + b"x" * 200), "開けない物は None（バイトのまま比べる）")
            self.assertIsNotNone(bless.first_diff(bless.comparable(table(b"abc")), bless.comparable(table(b"abd"))))
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
                t["answers"]["x"] = {"error": f"予定の元に接続できません: {word}"}
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
