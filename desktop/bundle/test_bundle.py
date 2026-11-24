# -*- coding: utf-8 -*-
"""配る ZIP の組み立て（bundle.py）。release.json の形（desktop/src/release.rs が読む）・名前の断り方・ZIP の中の並び・配る物の選び方。"""
import ast
import json
import re
import shutil
import subprocess
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
        # 字に変数をつないだ名前（okw("字" + 変数)）は「例外: 」の 1 か所だけ（版 3.118.1 の作った後の採点の割れ 6。ほかは取り出せない名前になる）
        self.assertEqual(re.findall(r'okw\(\s*"([^"]*)"\s*\+', js), ["例外: "], "字をつないだ名前は part() の「例外: 」だけ")
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
        exact, heads, loose = verify_name_lookups(text)
        self.assertTrue(exact and heads, "verify.py が名前で探す所")
        self.assertEqual(loose, [], "verify.py が名前で引く所は、どれも字で書く（変数・つないだ字で引かない）")
        self.assertEqual([n for n in exact if n not in doc], [], "verify.py が探す名前は一覧にある")
        self.assertEqual([h for h in heads if not any(n.startswith(h) for n in doc)], [], "verify.py が頭で探す名前は一覧にある")
        # 一覧の名前を見る所は WINDOW_ONLY などの読み口だけ（verify.py に名前の並びを書き戻さない）
        self.assertNotIn("WINDOW_ONLY = [\n", text)

    def test_name_lookups_are_found_in_every_form(self):
        """名前で引く形（x["name"] == 字・x["name"].startswith(字)・res.get(字)・res[字]）を全部拾い、変数で引く形は loose に出す（割れ 6 の変異）"""
        exact, heads, loose = verify_name_lookups(
            'a = [x for x in r if x["name"] == "甲"]\n'
            'b = [x for x in r if x["name"].startswith("乙")]\n'
            'res = {x["name"]: x for x in r}\n'
            'c = res.get("丙", {})\n'
            'd = res["丁"]\n'
            'e = res.get(name)\n')
        self.assertEqual((sorted(exact), heads), (["丁", "丙", "甲"], ["乙"]))
        self.assertEqual(len(loose), 1, loose)

    def test_gate_marks_in_selftest_are_seen_by_verify(self):
        """門番の印（割れ 5）: verify.py の gate_names は「門番 403」と前の並びの形「試す 403 門番」「参照… 403 門番」を拾い、
        窓の言葉の答え（400・404）は拾わない。selftest.js が書く印は「門番 403」の 1 つの形だけ"""
        import verify
        got = verify.gate_names([{"name": "甲", "info": "[決めた答え] 門番 403・shell 403 / shell 403"},
                                 {"name": "乙", "info": "[道どうし・決めた答え] 札 200 40・試す 403 門番"},
                                 {"name": "丙", "info": "[形・道どうし] 状態 200・参照… 403 門番・よく使う場所 403 門番"},
                                 {"name": "丁", "info": "[決めた答え] 窓の言葉 400・shell 400 / shell 400"},
                                 {"name": "戊", "info": "設備 1403 門番でない"}])
        self.assertEqual(got, ["甲", "乙", "丙"])
        # selftest.js が info に書く門番の印は「門番 403」の 1 つの形だけ（名前と注釈の字は除く）
        js = re.sub(r"//[^\n]*", "", re.sub(r'okw\(\s*"[^"]*"', "okw(", SELFTEST.read_text(encoding="utf-8")))
        marks = re.findall(r'"[^"\n]*門番[^"\n]*"', js)
        self.assertTrue(marks, "門番の印がある")
        self.assertEqual(sorted(set(marks)), ['"門番 403"'], "門番の印の書き方")
        self.assertNotIn("門番", re.sub(r'"[^"\n]*"', '""', js), "テンプレートの字に直に書いた門番の印が無い")

    def test_first_diff_names_the_first_key_that_differs(self):
        """最初に違う所の関数（割れ 8）: selftest.js の firstDiff を node で走らせる。比べる確かめは JSON.stringify どうしで比べない"""
        js = SELFTEST.read_text(encoding="utf-8")
        self.assertEqual(js.count("const firstDiff ="), 1, "1 つの関数")
        self.assertNotRegex(js, r"JSON\.stringify\([^;]*\)\s*[!=]==\s*JSON\.stringify", "比べる確かめは firstDiff で")
        self.assertGreaterEqual(js.count("firstDiff("), 10, "比べる確かめで使う")
        node = shutil.which("node")
        if not node:
            self.skipTest("node が無い")
        body = js.split("// firstDiff:start", 1)[1].split("// firstDiff:end", 1)[0]
        cases = [
            [{"a": 1, "b": [1, 2]}, {"b": [1, 2], "a": 1}, ""],
            [{"a": 1, "b": [1, 2]}, {"a": 1, "b": [1, 3]}, "b[1]"],
            [{"rows": [{"設備": "L-1"}]}, {"rows": [{"設備": "L-2"}]}, "rows[0].設備"],
            [{"a": 1}, {"a": 1, "z": 2}, "z"],
            [[1, 2], [1, 2, 3], "[2]"],
            [[1], {"0": 1}, "(根)"],
            [None, {}, "(根)"],
            ["x", "y", "(根)"],
            [{"a": {"b": None}}, {"a": {"b": 0}}, "a.b"],
            [{"a": 0}, {"a": "0"}, "a"],
            [{"n": [1, {"k": True}]}, {"n": [1, {"k": 1}]}, "n[1].k"],
        ]
        code = body + f"\nconst cs = {json.dumps(cases, ensure_ascii=False)};\n" \
            "console.log(JSON.stringify(cs.map(([a, b]) => firstDiff(a, b))));\n"
        out = subprocess.run([node, "-e", code], capture_output=True, text=True, encoding="utf-8", check=True).stdout
        self.assertEqual(json.loads(out), [c[2] for c in cases])


def verify_name_lookups(text: str) -> tuple[list, list, list]:
    """verify.py の字から、名前で引く所を全部取り出す（版 3.118.1 の作った後の採点の割れ 6）。
    exact: x["name"] == 字・res.get(字)・res[字]（res は名前 → 結果の表）／heads: x["name"].startswith(字)／loose: 字でない物で引く所"""
    exact, heads, loose = [], [], []

    def is_name(n):  # x["name"]
        return isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant) and n.slice.value == "name"

    def text_of(n):
        return n.value if isinstance(n, ast.Constant) and isinstance(n.value, str) else None

    tables = set()
    for n in ast.walk(ast.parse(text)):
        # 名前 → 結果の表（{x["name"]: x for …}）を入れた変数
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.DictComp) and is_name(n.value.key):
            tables |= {t.id for t in n.targets if isinstance(t, ast.Name)}
    for n in ast.walk(ast.parse(text)):
        if isinstance(n, ast.Compare) and is_name(n.left) and any(isinstance(o, (ast.Eq, ast.NotEq)) for o in n.ops):
            for c in n.comparators:
                (exact.append(text_of(c)) if text_of(c) is not None else loose.append(ast.unparse(n)))
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.args:
            target = n.func.value
            if n.func.attr == "startswith" and is_name(target):
                (heads.append(text_of(n.args[0])) if text_of(n.args[0]) is not None else loose.append(ast.unparse(n)))
            elif n.func.attr == "get" and isinstance(target, ast.Name) and target.id in tables:
                (exact.append(text_of(n.args[0])) if text_of(n.args[0]) is not None else loose.append(ast.unparse(n)))
        elif isinstance(n, ast.Subscript) and isinstance(n.value, ast.Name) and n.value.id in tables:
            (exact.append(text_of(n.slice)) if text_of(n.slice) is not None else loose.append(ast.unparse(n)))
    return exact, heads, loose


if __name__ == "__main__":
    unittest.main()
