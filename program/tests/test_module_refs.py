# -*- coding: utf-8 -*-
"""「モジュール.名前」の参照先が実在するか（routes・services・repositories）。
型検査の道具を入れていないので、関数を消した・名前を変えたときに使う所が残ると、その道を通るまで分からない
（版 3.38.0: dashboard.now_local を消し忘れ、試験は時刻を差し替えていたので通り、利用者の PC ではダッシュボードが全部 500 になった）。"""
import ast
import importlib
import types
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
PACKAGES = ("routes", "services", "repositories")


class ModuleRefs(unittest.TestCase):
    def test_every_module_attribute_exists(self):
        missing = []
        for pkg in PACKAGES:
            for f in sorted((APP / pkg).glob("*.py")):
                mod = importlib.import_module(f"app.{pkg}" + ("" if f.stem == "__init__" else f".{f.stem}"))
                mods = {k: v for k, v in vars(mod).items() if isinstance(v, types.ModuleType) and v.__name__.startswith("app.")}
                for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
                    if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id in mods \
                            and isinstance(n.ctx, ast.Load) and not hasattr(mods[n.value.id], n.attr):
                        missing.append(f"{pkg}/{f.name}:{n.lineno} {n.value.id}.{n.attr}")
        self.assertEqual(missing, [], "使っている所が残っているのに、モジュールに無い名前")


if __name__ == "__main__":
    unittest.main()
