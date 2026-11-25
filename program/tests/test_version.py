# -*- coding: utf-8 -*-
"""版の管理（app/version.py・app_build.release_digest）。

版を上げずにプログラムを変えて配ることを止める。失敗したら、表示された手順で版を上げて記録し直す。
"""
import re
import unittest
from datetime import date

import app_build

# 版 3.119.0（段 ⑤）: app を import しない（program/app の .py は version.py だけ。原文から読む）
_V = app_build._version_module(app_build.BASE)
APP_VERSION, CHANGELOG, RELEASE, version_key = _V["APP_VERSION"], _V["CHANGELOG"], _V["RELEASE"], _V["version_key"]


class Changelog(unittest.TestCase):
    def test_head_is_the_app_version(self):
        self.assertRegex(APP_VERSION, r"^\d+\.\d+\.\d+$")
        self.assertEqual(CHANGELOG[0]["version"], APP_VERSION, "CHANGELOG の先頭にいまの版の1件を足してください")

    def test_newest_first_and_filled(self):
        keys = [version_key(e["version"]) for e in CHANGELOG]
        self.assertEqual(keys, sorted(keys, reverse=True), "新しい版を上に")
        self.assertEqual(len(keys), len(set(keys)), "同じ版が2つある")
        dates = [date.fromisoformat(e["date"]) for e in CHANGELOG]
        self.assertEqual(dates, sorted(dates, reverse=True))
        for e in CHANGELOG:
            self.assertTrue(e["notes"] and all(n.strip() for n in e["notes"]), e["version"])

    def test_versions_compare_as_numbers(self):
        self.assertGreater(version_key("1.10.0"), version_key("1.9.3"))
        self.assertEqual(version_key("1.0"), (1, 0, 0))


class Release(unittest.TestCase):
    def test_program_matches_the_recorded_release(self):
        digest = app_build.release_digest()
        how = ("APP_VERSION を上げて CHANGELOG の先頭に1件足し、`python app_build.py --release` で記録してください"
               "（まだ配っていない版を直しただけなら `python app_build.py --amend`）。")
        self.assertEqual(RELEASE["version"], APP_VERSION, f"版 {APP_VERSION} がまだ記録されていません。{how}")
        self.assertEqual(RELEASE["digest"], digest, f"版 {APP_VERSION} を記録したあとにプログラムが変わっています。{how}")

    def test_digest_ignores_line_endings_and_version_file(self):
        files = app_build.release_files()
        self.assertNotIn("app/version.py", files, "RELEASE を書くと要約が変わってしまう")
        self.assertIn("app/static/js/app.js", files)
        # 版 3.119.0（段 ⑤）: sidecar.py は前の版（3.117.x まで）の窓が取り込みの確かめで見る 1 行の印（中身は無い）。配る物に入れ、要約にも数える
        self.assertIn("sidecar.py", files, "前の版の窓が見る印も配る物")
        mark = files["sidecar.py"].read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(mark), 1, "印は 1 行")
        self.assertTrue(mark[0].startswith("#"), "印はコメントだけ（中身は無い）")
        self.assertFalse(any(k.startswith("app/") and k.endswith(".py") for k in files), "app の .py は配らない（版の version.py は要約の外）")
        self.assertFalse(any(k.endswith(".vbs") for k in files), "入口は exe だけ（版 3.1.0）")
        self.assertFalse(any(k.startswith(("tests/", "docs/")) or k.endswith(".md") for k in files), "説明とテストは含めない")


if __name__ == "__main__":
    unittest.main()


class Desktop(unittest.TestCase):
    """デスクトップ版（desktop/）の版は、アプリの版と同じ（窓の版と中身の版がずれない）。配る ZIP には desktop が無いので、そのときは比べない。"""

    def test_same_version(self):
        import json
        from pathlib import Path
        root = Path(app_build.BASE).parent / "desktop"
        if not root.is_dir():
            self.skipTest("desktop フォルダが無い（配った形）")
        cargo = re.search(r'^version\s*=\s*"([^"]+)"', (root / "Cargo.toml").read_text(encoding="utf-8"), re.M).group(1)
        conf = json.loads((root / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual((cargo, conf), (APP_VERSION, APP_VERSION), "desktop/Cargo.toml と tauri.conf.json の version をアプリの版に合わせてください")


class ChangelogJson(unittest.TestCase):
    """版 3.88.0: 窓が GET /api/changelog を答えるための焼いた更新履歴（app/changelog.json。`python app_build.py --release` が書く）。"""

    def test_baked_changelog_is_current(self):
        path = app_build.BASE / app_build.CHANGELOG_JSON
        want = app_build.changelog_text(app_build._version_module(app_build.BASE))
        self.assertTrue(path.exists(), "app/changelog.json がありません。`python app_build.py --release`（--amend）で焼いてください")
        self.assertNotIn(b"\r", path.read_bytes(), "改行が CRLF です（窓は字のまま返すので前の版の答えと 1 バイト違う）。.gitattributes の -text を確かめてください")
        self.assertEqual(path.read_text(encoding="utf-8"), want,
                         "app/changelog.json が app/version.py の更新履歴と違います。`python app_build.py --release`（--amend）で焼き直してください")

    def test_baked_changelog_is_tracked_by_git(self):
        # 配る ZIP（desktop/bundle の program_files）は git が知るファイルだけを入れる。commit し忘れると窓は更新履歴を答えられない
        import shutil
        import subprocess
        if not shutil.which("git"):
            self.skipTest("git がありません")
        r = subprocess.run(["git", "ls-files", "--error-unmatch", app_build.CHANGELOG_JSON], cwd=app_build.BASE,
                           capture_output=True, text=True)
        if r.returncode != 0 and "not a git repository" in (r.stderr or ""):
            self.skipTest("git の中ではありません")
        self.assertEqual(r.returncode, 0, "app/changelog.json を git に足してください（配る ZIP に入らない）")
