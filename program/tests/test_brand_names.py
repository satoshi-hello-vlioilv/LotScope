"""評価関数: アプリの名前は 1 か所（app/brand.json）の定義から配る（版 3.3.0。版 3.119.0 の作った後の直し 2 で、app を import しない形にした）。

- 変えてよい名前（name・subtitle・exe）: 作る道具（desktop/Cargo.toml の [[bin]] name・tauri.conf.json）と食い違えば止める
  （窓の試験 desktop/src/brand.rs の agrees_with_the_build_tools も同じ所を見る）
- 変えない目印（app_id・data_dir）: 値を固定して守る（brand.rs の fixed_ids_never_change も）
- 名前を書き写していない（コードに表示名・アプリ名をじかに書かない）。更新履歴・説明・試験は歴史や例を書くので調べない
標準の部品だけ（app を import しない）
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
REPO = PROGRAM.parent
DESKTOP = REPO / "desktop"
BRAND = {k: v for k, v in json.loads((PROGRAM / "app" / "brand.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}


def code_lines(p: Path):
    """(行番号, 行) のうち、説明でないもの: 1 行のコメント・ブロックコメント（/* */・<!-- -->）・Python の docstring・
    Rust の試験（#[cfg(test)] より下）を除く"""
    import ast
    text = p.read_text(encoding="utf-8", errors="replace")

    def blank(m):  # 行番号を保つ
        return "\n" * m.group(0).count("\n")
    if p.suffix in (".js", ".rs", ".html", ".css"):
        text = re.sub(r"/\*.*?\*/", blank, text, flags=re.DOTALL)
    if p.suffix == ".html":
        text = re.sub(r"<!--.*?-->", blank, text, flags=re.DOTALL)
    if p.suffix == ".rs" and "#[cfg(test)]" in text:
        text = text[:text.index("#[cfg(test)]")]
    skip = set()
    if p.suffix == ".py":
        for node in ast.walk(ast.parse(text)):
            body = getattr(node, "body", None)
            if isinstance(body, list) and body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
                    and isinstance(body[0].value.value, str):
                skip.update(range(body[0].lineno, body[0].end_lineno + 1))
    for i, line in enumerate(text.splitlines(), 1):
        if i in skip or line.lstrip().startswith(("//", "#", "<!--")):
            continue
        yield i, line


class Brand(unittest.TestCase):
    def test_definition(self):
        for k in ("name", "subtitle", "exe", "app_id", "data_dir"):
            self.assertTrue(str(BRAND.get(k) or "").strip(), f"brand.json の {k} が空")
        self.assertTrue(BRAND["exe"].endswith(".exe") and "/" not in BRAND["exe"] and "\\" not in BRAND["exe"])

    def test_fixed_ids_never_change(self):
        self.assertEqual(BRAND["app_id"], "local.transferpitchanalyzer.desktop")
        self.assertIn("TransferPitchAnalyzer", [BRAND["data_dir"], *BRAND.get("legacy_data_dir", [])])
        self.assertNotIn(BRAND["data_dir"], BRAND.get("legacy_data_dir", []))
        self.assertNotIn(BRAND["name"], BRAND.get("legacy_names", []), "名前の歴史に、いまの名前は入れない")

    def test_names_are_not_copied_into_code(self):
        """表示名・アプリ名をコードにじかに書かない（brand.json から読む）。行に「名前の歴史」とあるものは、昔の名前そのものが要る所"""
        words = {BRAND["subtitle"]: "副題", BRAND["name"]: "アプリ名"}
        roots = [(PROGRAM / "app", ("*.py", "*.js", "*.html")), (PROGRAM, ("*.py",)), (DESKTOP / "src", ("*.rs", "*.js")),
                 (DESKTOP / "splash", ("*.html",)), (DESKTOP / "bundle", ("*.py",)), (REPO / ".github", ("*.yml",))]
        skip = {PROGRAM / "app" / "version.py"}           # 更新履歴は歴史を書く
        found = []
        for root, pats in roots:
            for pat in pats:
                for p in (root.rglob(pat) if root != PROGRAM else root.glob(pat)):
                    if p in skip or "tests" in p.parts or p.name.startswith("test_") or "__pycache__" in p.parts:
                        continue
                    for i, line in code_lines(p):
                        for w, why in words.items():
                            if w in line and "名前の歴史" not in line:
                                found.append(f"{p.relative_to(REPO)}:{i}: {why}「{w}」")
        self.assertEqual(found, [], "\n".join(found[:30]))

    def test_a_copied_name_is_found(self):
        """変異: コードに名前をじかに書くと見つける（コメントの中は見ない）"""
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.js"
            p.write_text(f"// {BRAND['name']}\nconst t = '{BRAND['name']}';\n", encoding="utf-8")
            self.assertEqual([i for i, line in code_lines(p) if BRAND["name"] in line], [2])


@unittest.skipUnless((DESKTOP / "tauri.conf.json").exists(), "desktop フォルダが無い（配った形）")
class BuildTools(unittest.TestCase):
    """作る道具（desktop/Cargo.toml・tauri.conf.json）が brand.json と食い違わない"""

    def test_identifier_is_the_fixed_id(self):
        conf = json.loads((DESKTOP / "tauri.conf.json").read_text(encoding="utf-8"))
        self.assertEqual(conf["identifier"], BRAND["app_id"], "Tauri の identifier は変えない目印と同じ")

    def test_build_tools_agree_with_the_definition(self):
        stem = BRAND["exe"][:-4]
        bins = re.findall(r'\[\[bin\]\]\s*\nname\s*=\s*"([^"]+)"', (DESKTOP / "Cargo.toml").read_text(encoding="utf-8"))
        self.assertEqual(bins, [stem], "desktop/Cargo.toml の [[bin]] name は brand.json の exe と同じ")
        conf = json.loads((DESKTOP / "tauri.conf.json").read_text(encoding="utf-8"))
        self.assertEqual(conf["mainBinaryName"], stem, "tauri.conf.json の mainBinaryName は brand.json の exe と同じ")
        self.assertEqual(conf["productName"], BRAND["name"], "tauri.conf.json の productName は brand.json の name と同じ")


if __name__ == "__main__":
    unittest.main()
