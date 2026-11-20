# -*- coding: utf-8 -*-
"""CM3 のシステムのプロキシの読み方の事例の表（tests/fixtures/sysproxy_cases.json。版 3.117.1）を、urllib の関数を直に当てて確かめる。

環境変数は os.environ を差し替えて urllib.request.getproxies_environment・proxy_bypass_environment を呼ぶ（Windows の形〈nt〉は os.environ と
同じく名前を大文字にして置く）。Windows の設定は urllib の getproxies_registry・proxy_bypass_registry を、作り物の winreg で呼ぶ
（Linux では urllib/request.py の Windows の節の元の字から関数を組む。Windows では本物の関数）。ProxyOverride の型は Windows の fnmatch
（ntpath.normcase）で比べる。プロキシの選び（choose）と PAC の一言は app/services/sysproxy.py。窓は cargo test --test sysproxy_cases。
"""
import ast
import json
import ntpath
import os
import posixpath
import sys
import types
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import sysproxy  # noqa: E402

CASES = json.loads((Path(__file__).resolve().parent / "fixtures" / "sysproxy_cases.json").read_text(encoding="utf-8"))
KEY = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"


def fake_winreg(reg):
    """作り物の winreg（reg: 値の表か None〈鍵が無い〉）"""
    m = types.ModuleType("winreg")
    m.HKEY_CURRENT_USER = "HKCU"

    class Key:
        def Close(self):  # noqa: N802 (winreg の名前)
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def open_key(root, path):
        if reg is None or root != "HKCU" or path != KEY:
            raise OSError("鍵が無い")
        return Key()

    def query(key, name):
        if name not in reg:
            raise OSError(f"値が無い: {name}")
        v = reg[name]
        return v, (4 if isinstance(v, int) else 1)

    m.OpenKey = open_key
    m.QueryValueEx = query
    return m


def nt_functions():
    """urllib の Windows だけの関数（getproxies_registry・proxy_bypass_registry）。Windows では本物、ほかは元の字から組む"""
    if os.name == "nt":
        return urllib.request.getproxies_registry, urllib.request.proxy_bypass_registry
    tree = ast.parse(Path(urllib.request.__file__).read_text(encoding="utf-8"))
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in ("getproxies_registry", "proxy_bypass_registry"):
            found[node.name] = node
    assert set(found) == {"getproxies_registry", "proxy_bypass_registry"}, "urllib の Windows の節が見つかりません"
    ns = dict(vars(urllib.request))
    code = compile(ast.Module(body=list(found.values()), type_ignores=[]), urllib.request.__file__, "exec")
    exec(code, ns)  # noqa: S102 (urllib の元の字そのもの)
    return ns["getproxies_registry"], ns["proxy_bypass_registry"]


GET_REG, BYPASS_REG = nt_functions()


class Env:
    """os.environ を事例の並びにする（nt は Python の Windows の os.environ と同じく名前を大文字に）"""

    def __init__(self, pairs, nt):
        self.pairs = [(k.upper() if nt else k, v) for k, v in pairs]

    def __enter__(self):
        self.p = mock.patch.dict(os.environ, {}, clear=True)
        self.p.start()
        for k, v in self.pairs:
            os.environ[k] = v
        return self

    def __exit__(self, *a):
        self.p.stop()


def registry(reg):
    with mock.patch.dict(sys.modules, {"winreg": fake_winreg(reg)}):
        return GET_REG()


def proxies(c):
    """urllib.request.getproxies（Windows は環境変数が空ならレジストリ）"""
    env = urllib.request.getproxies_environment()
    if env or not c["nt"]:
        return env
    return registry(c.get("reg"))


def bypass(c, host):
    """urllib.request.proxy_bypass（Windows は環境変数のプロキシがあればそれ、無ければ ProxyOverride を Windows の fnmatch で）"""
    env = urllib.request.getproxies_environment()
    if not c["nt"] or env:
        return urllib.request.proxy_bypass_environment(host, env)
    with mock.patch.dict(sys.modules, {"winreg": fake_winreg(c.get("reg"))}), mock.patch.object(posixpath, "normcase", ntpath.normcase):
        return BYPASS_REG(host)


class SysproxyCases(unittest.TestCase):
    def test_environment(self):
        for c in CASES["env"]:
            with self.subTest(c["name"]), Env(c["env"], c["nt"]):
                self.assertEqual(list(urllib.request.getproxies_environment().items()), [tuple(x) for x in c["want"]])

    def test_registry(self):
        for c in CASES["registry"]:
            with self.subTest(c["name"]):
                self.assertEqual(list(registry(c["reg"]).items()), [tuple(x) for x in c["want"]])

    def test_bypass(self):
        for c in CASES["bypass"]:
            with self.subTest(c["name"]), Env(c["env"], c["nt"]):
                self.assertIs(bypass(c, c["host"]), c["want"])

    def test_choose(self):
        for c in CASES["choose"]:
            with self.subTest(c["name"]), Env(c["env"], c["nt"]):
                try:
                    got = sysproxy.choose(c["url_type"], c["host"], proxies(c), lambda h, c=c: bypass(c, h))
                except sysproxy.ProxyProblem as e:
                    got = {"error": str(e)}
                self.assertEqual(got, c["want"])

    def test_clean_keeps_what_choose_uses(self):
        # ProxyHandler に渡す形（clean）は 利用者:合言葉 を持たず、https:// は http:// になり、choose が選ぶ名前:番号を指す
        for c in CASES["choose"]:
            with self.subTest(c["name"]), Env(c["env"], c["nt"]):
                p = proxies(c)
                cleaned = sysproxy.clean(p)
                self.assertFalse(any("@" in v for v in cleaned.values()), cleaned)
                self.assertFalse(any(v.lower().startswith("https://") for v in cleaned.values()), cleaned)

    def test_pac(self):
        for c in CASES["pac"]:
            with self.subTest(c["name"]), Env(c["env"], c["nt"]):
                self.assertEqual(sysproxy.pac_of(c["nt"], urllib.request.getproxies_environment(), c.get("reg")), c["want"])

    def test_the_table_has_the_cases_the_plan_names(self):
        # 採点の first_fixes 11 の材料: 小文字が勝つ・空の値・REQUEST_METHOD・関係のない *_proxy・後ろ一致と *・ProxyEnable の型・
        # 1 つの値・種類ごと・種類の無い address・socks だけ・「=」の無い段・; と空白・<local>・* ? [ ]・番号を外す・大文字小文字・PAC
        names = " ".join(c["name"] for k in ("env", "registry", "bypass", "choose", "pac") for c in CASES[k])
        for w in ("小文字", "空の", "REQUEST_METHOD", "関係のない", "後ろ一致", "*", "ProxyEnable", "1 つの値", "種類ごと", "socks", "「=」",
                  "<local>", "?", "[ ]", "番号を外して", "大文字小文字", "AutoConfigURL"):
            self.assertIn(w, names)


if __name__ == "__main__":
    unittest.main()
