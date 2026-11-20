# -*- coding: utf-8 -*-
"""CM3 のシステムのプロキシの読み方の事例の表（tests/fixtures/sysproxy_cases.json。版 3.117.1）を、urllib の関数を直に当てて確かめる。

env・bypass・choose・pac の事例は posix と nt（Windows）の 2 つの答えを持ち、どの OS で流しても両方を確かめる（版 3.117.1 の作った後の
直し・割れ 1: 前は本物の os.environ に事例の名前を置いたので、Windows の Python〈os.environ が名前を大文字にして持つ〉では印の無い事例が
別の答えになり、Windows の CI の段が必ず落ちた）。環境変数は urllib.request の見る os.environ を事例の dict に差し替える（nt は名前を大文字に
して後ろの値が勝つ＝Windows の os.environ と同じ）。Windows の設定は urllib の getproxies_registry・proxy_bypass_registry を、作り物の
winreg で呼ぶ（Linux では urllib/request.py の Windows の節の元の字から関数を組む。Windows では本物の関数）。ProxyOverride の型は
Windows の fnmatch（ntpath.normcase）で比べる。プロキシの選び（choose）と PAC の一言は app/services/sysproxy.py。窓は
cargo test --test sysproxy_cases。WindowsEnviron は本物の os.environ を Windows の形（os._Environ の名前を大文字にする形）にまねて、
この試験が OS の os.environ の形に頼らないことを Linux でも確かめる。
"""
import ast
import io
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
    """urllib.request の見る os.environ を事例の並びの dict にする（nt は Windows の os.environ と同じく名前を大文字に・後ろの値が勝つ）"""

    def __init__(self, pairs, nt):
        self.env = {}
        for k, v in pairs:
            self.env[k.upper() if nt else k] = v

    def __enter__(self):
        self.p = mock.patch.object(urllib.request.os, "environ", self.env)
        self.p.start()
        return self

    def __exit__(self, *a):
        self.p.stop()


def both(c):
    """事例 → [(OS の名前, nt か, その OS の答え)]"""
    return [(os_name, os_name == "nt", c["want"][os_name]) for os_name in ("posix", "nt")]


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
            for os_name, nt, want in both(c):
                with self.subTest(c["name"], os=os_name), Env(c["env"], nt):
                    self.assertEqual(list(urllib.request.getproxies_environment().items()), [tuple(x) for x in want])

    def test_registry(self):
        for c in CASES["registry"]:
            with self.subTest(c["name"]):
                self.assertEqual(list(registry(c["reg"]).items()), [tuple(x) for x in c["want"]])

    def test_bypass(self):
        for c in CASES["bypass"]:
            for os_name, nt, want in both(c):
                cc = {**c, "nt": nt}
                with self.subTest(c["name"], os=os_name), Env(c["env"], nt):
                    self.assertIs(bypass(cc, c["host"]), want)

    def test_choose(self):
        for c in CASES["choose"]:
            for os_name, nt, want in both(c):
                cc = {**c, "nt": nt}
                with self.subTest(c["name"], os=os_name), Env(c["env"], nt):
                    try:
                        got = sysproxy.choose(c["url_type"], c["host"], proxies(cc), lambda h, cc=cc: bypass(cc, h))
                    except sysproxy.ProxyProblem as e:
                        got = {"error": str(e)}
                    self.assertEqual(got, want)

    def test_pac(self):
        for c in CASES["pac"]:
            for os_name, nt, want in both(c):
                with self.subTest(c["name"], os=os_name), Env(c["env"], nt):
                    self.assertEqual(sysproxy.pac_of(nt, urllib.request.getproxies_environment(), c.get("reg")), want)

    def test_the_table_has_the_cases_the_plan_names(self):
        # 採点の first_fixes 11 の材料: 小文字が勝つ・空の値・REQUEST_METHOD・関係のない *_proxy・後ろ一致と *・ProxyEnable の型・
        # 1 つの値・種類ごと・種類の無い address・socks だけ・「=」の無い段・; と空白・<local>・* ? [ ]・番号を外す・大文字小文字・PAC。
        # 作った後の直し: 種類の無い //名前:番号 と / で始まる値（割れ 3）
        names = " ".join(c["name"] for k in ("env", "registry", "bypass", "choose", "pac") for c in CASES[k])
        for w in ("小文字", "空の", "REQUEST_METHOD", "関係のない", "後ろ一致", "*", "ProxyEnable", "1 つの値", "種類ごと", "socks", "「=」",
                  "<local>", "?", "[ ]", "番号を外して", "大文字小文字", "AutoConfigURL", "//名前:番号", "/ で始まり"):
            self.assertIn(w, names)
        # どの事例も 2 つの OS の答えを持つ（印 nt の 1 つの答えの形に戻さない）
        for k in ("env", "bypass", "choose", "pac"):
            for c in CASES[k]:
                self.assertEqual(set(c["want"]), {"posix", "nt"}, c["name"])
                self.assertNotIn("nt", c, c["name"])


def windows_environ(pairs):
    """Windows の Python の os.environ の形（os._Environ。名前を大文字にして持つ。Lib/os.py の Windows の節と同じ encodekey）"""
    data = {}
    for k, v in pairs:
        data[k.upper()] = v

    def check(v):
        if not isinstance(v, str):
            raise TypeError(f"str expected, not {type(v).__name__}")
        return v
    return os._Environ(data, lambda k: check(k).upper(), lambda k: k, check, lambda v: v)


class WindowsEnviron(unittest.TestCase):
    """割れ 1 の再現の形: 本物の os.environ を Windows の形にまねても、事例の表の試験は同じに通る（Linux の py-tests で流す）"""

    def test_cases_pass_with_a_windows_shaped_environ(self):
        env = windows_environ(list(os.environ.items()) + [("http_proxy", "http://other:9"), ("REQUEST_METHOD", "GET")])
        with mock.patch.object(os, "environ", env):
            self.assertIn("HTTP_PROXY", os.environ)      # まねた形は名前を大文字にして持つ
            result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(
                unittest.defaultTestLoader.loadTestsFromTestCase(SysproxyCases))
        self.assertTrue(result.wasSuccessful(), [str(x[1])[-400:] for x in result.failures + result.errors])
        self.assertGreaterEqual(result.testsRun, 6)


if __name__ == "__main__":
    unittest.main()
