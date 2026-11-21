# -*- coding: utf-8 -*-
"""配る ZIP の組み立て（bundle.py）。release.json の形（desktop/src/release.rs が読む）・名前の断り方・ZIP の中の並び・配る物の選び方。"""
import json
import re
import tempfile
import unittest
import zipfile
from pathlib import Path

import bundle


class Bundle(unittest.TestCase):
    def test_release_json_matches_what_the_window_reads(self):
        b = bundle.brand()
        r = bundle.release_json(b, "3.9.0", f"{b['name']}-3.9.0-windows.zip", "a" * 64)
        self.assertEqual(set(r), {"schema", "app_id", "name", "version", "zip", "sha256", "exe"})
        self.assertEqual((r["schema"], r["app_id"], r["exe"]), (1, b["app_id"], b["exe"]))
        for bad in ("../x.zip", "a/b.zip", "a\\b.zip", "C:x.zip", " x.zip", ".."):
            with self.assertRaises(SystemExit, msg=bad):
                bundle.release_json(b, "3.9.0", bad, "a" * 64)

    def test_legacy_exe_names(self):
        """名前の歴史: 前の名前の exe は、いまの exe と別の 1 つの名前。使えない名前は断る。"""
        b = bundle.brand()
        self.assertNotIn(b["exe"], bundle.legacy_exe(b))
        self.assertEqual(bundle.legacy_exe({**b, "legacy_exe": [b["exe"], "Old.exe"]}), ["Old.exe"], "いまの名前は除く")
        for bad in ("../Old.exe", "a\\b.exe", "Old.txt"):
            with self.assertRaises(SystemExit, msg=bad):
                bundle.legacy_exe({**b, "legacy_exe": [bad]})

    def test_zip_has_one_top_folder_in_name_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "stage"
            (root / "program" / "app").mkdir(parents=True)
            (root / "program" / "sidecar.py").write_text("x", encoding="utf-8")
            (root / "program" / "app" / "日本.txt").write_text("y", encoding="utf-8")
            (root / "A.exe").write_bytes(b"MZ")
            out = Path(tmp) / "a.zip"
            self.assertEqual(bundle.zip_dir(root, "App", out), 3)
            names = zipfile.ZipFile(out).namelist()
            self.assertEqual(names, sorted(names))
            self.assertTrue(all(n.startswith("App/") for n in names), names)
            self.assertIn("App/program/app/日本.txt", names)

    def test_release_notes_carry_this_versions_changelog_and_fingerprint(self):
        b = bundle.brand()
        version = bundle.app_version()
        rel = bundle.release_json(b, version, f"{b['name']}-{version}-windows.zip", "a" * 64)
        history = bundle.changelog()
        notes = bundle.release_notes(rel, history)
        self.assertTrue(notes.startswith(f"## 版 {version}（"), notes[:40])
        for n in history[0]["notes"]:
            self.assertIn(f"- {n}", notes)
        self.assertIn(rel["zip"], notes)
        self.assertIn("a" * 64, notes)
        with self.assertRaisesRegex(SystemExit, "更新履歴"):
            bundle.release_notes({**rel, "version": "0.0.1"}, history)

    def test_program_files_are_tracked_files_without_local_state(self):
        files = bundle.program_files()
        self.assertIn("program/sidecar.py", files)
        self.assertIn("program/app/brand.json", files)
        self.assertFalse([f for f in files if "__pycache__" in f or f.endswith(".pyc")])
        self.assertEqual(bundle.app_version(), json.loads(json.dumps(bundle.app_version())))



HERE = Path(__file__).resolve().parent
SELFTEST = HERE.parent / "src" / "selftest.js"


def names_doc():
    return json.loads((HERE / "selftest_names.json").read_text(encoding="utf-8"))["items"]


class SelftestNames(unittest.TestCase):
    """自己診断の項目の名前の 1 か所（版 3.118.1。selftest_names.json）が、selftest.js・verify.py と食い違わないか（窓を開かずに見る）"""

    def test_names_are_the_same_as_selftest_js(self):
        js = SELFTEST.read_text(encoding="utf-8")
        # 名前は固定の字（テンプレートの字・字をつないだ名前は、ここで取り出せないので使わない。「例外: 」＋節の名前だけは part が作る）
        self.assertEqual(re.findall(r"okw\(\s*`", js), [], "名前にテンプレートの字を使わない")
        okw = [n for n in re.findall(r'okw\(\s*"([^"]*)"', js) if n != "例外: "]
        self.assertEqual(len(re.findall(r'okw\(\s*"例外: " \+ name', js)), 1, "例外の名前は part() の 1 か所だけが作る")
        self.assertEqual(len(re.findall(r"okw\(\s*[^\s\"`]", js)), 0, "okw の名前はいつも字で書く")
        parts = re.findall(r'part\(\s*"([^"]*)"', js)
        self.assertEqual(len(parts), len(set(parts)), "節の名前は 1 つずつ")
        js_names = set(okw) | {"例外: " + p for p in parts}
        items = names_doc()
        doc = [x["name"] for x in items]
        self.assertEqual(len(doc), len(set(doc)), "一覧の名前は 1 つずつ")
        self.assertEqual(sorted(js_names - set(doc)), [], "selftest.js にあって一覧に無い名前")
        self.assertEqual(sorted(set(doc) - js_names), [], "一覧にあって selftest.js に無い名前")
        for x in items:
            for k in ("maybe", "nan", "except"):
                if k in x:
                    self.assertTrue(isinstance(x[k], str) and x[k].strip(), f"{x['name']} の {k} に理由")
            self.assertFalse(set(x) - {"name", "maybe", "nan", "except", "part"}, x)
        # 必ず出る項目の数は 3.117.3 の流れた数（ok 39 ＋ okw 22 ＋ 版を置けない人の 1）を下回らない（採点の first_fixes 1）
        self.assertGreaterEqual(len([x for x in items if "maybe" not in x]) + 1, 63)

    def test_verify_looks_up_only_listed_names(self):
        import verify
        items = names_doc()
        doc = [x["name"] for x in items]
        self.assertEqual(verify.WINDOW_ONLY, [x["name"] for x in items if "maybe" not in x])
        self.assertTrue(set(verify.NAN_EXPECTED) <= set(doc) and set(verify.EXCEPT) <= set(doc))
        text = (HERE / "verify.py").read_text(encoding="utf-8")
        exact = re.findall(r'x\["name"\] == "([^"]+)"', text)
        heads = re.findall(r'x\["name"\]\.startswith\("([^"]+)"\)', text)
        self.assertTrue(exact and heads, "verify.py が名前で探す所")
        self.assertEqual([n for n in exact if n not in doc], [], "verify.py が探す名前は一覧にある")
        self.assertEqual([h for h in heads if not any(n.startswith(h) for n in doc)], [], "verify.py が頭で探す名前は一覧にある")
        # 一覧の名前を見る所は WINDOW_ONLY などの読み口だけ（verify.py に名前の並びを書き戻さない）
        self.assertNotIn("WINDOW_ONLY = [\n", text)


if __name__ == "__main__":
    unittest.main()
