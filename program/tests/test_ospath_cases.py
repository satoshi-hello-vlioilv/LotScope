"""道の字の門（版 3.114.0。services/path_rules.py）が事例の表 tests/fixtures/ospath_cases.json のとおりに答えるか。
窓（desktop/src/path_gate.rs）は desktop/tests/ospath_cases.rs で同じ表を読む。

- 種類（browse・dir・name）× OS（posix・nt）の want: 通す字・字のまま・断る理由
- win32 の事例（GetFullPathNameW で整える）は Windows でだけ流す（Windows の CI）
- ~ と ~名前 は、Python の本物の os.path.expanduser（ntpath・posixpath。環境変数と利用者の表を差し替えて）とも同じか（独立の答え）
"""
import json
import ntpath
import os
import posixpath
import unittest
from pathlib import Path
from unittest import mock

from app.services import path_rules

TABLE = json.loads((Path(__file__).parent / "fixtures" / "ospath_cases.json").read_text(encoding="utf-8"))


def env_of(col, case):
    base = dict(TABLE["env"][col])
    base.update(case[col].get("env", {}))
    if col == "nt":
        return path_rules.Env(nt=True, env=base["env"], passwd=lambda n: None, cwd=base["cwd"])
    pw = base["passwd"]
    return path_rules.Env(nt=False, env=base["env"], passwd=lambda n: base["uid"] if n is None else pw.get(n), cwd=base["cwd"])


def os_answer(c):
    """want が os の事例（Microsoft の文書が決めていない形）の正しい答え: nt._getfullpathname そのもの（門の前段と tidy だけを足す）。Windows だけ"""
    import nt
    from app.fsio import unquote_path
    pre = path_rules.device(unquote_path(c["text"]).strip().strip("'"), True)
    if c["kind"] == "browse":
        return path_rules.tidy(nt._getfullpathname(path_rules.tidy(pre, True)), True)
    return nt._getfullpathname(pre)


class Cases(unittest.TestCase):
    def test_messages_are_the_gates(self):
        for k, v in TABLE["messages"].items():
            self.assertEqual(getattr(path_rules, k), v, k)

    def test_cases(self):
        bad, ran = [], 0
        for c in TABLE["cases"]:
            for col in ("posix", "nt"):
                if c.get("win32") and col == "nt" and os.name != "nt":
                    continue
                ran += 1
                want = c[col]["want"]
                try:
                    got = {"ok": path_rules.gate(c["kind"], c["text"], env_of(col, c))}
                except path_rules.PathRefused as e:
                    got = {"no": str(e)}
                if "no" in want:
                    exp = {"no": TABLE["messages"][want["no"]]}
                elif want.get("os"):
                    exp = {"ok": os_answer(c)}
                else:
                    exp = {"ok": c["text"] if want["ok"] is None else want["ok"]}
                if got != exp:
                    bad.append(f"{c['kind']} {c['text']!r} {col}: 表 {exp} / 門 {got}")
        self.assertGreaterEqual(ran, 150)
        self.assertEqual(bad, [], "\n".join(bad))

    def test_expanduser_is_pythons(self):
        """~ の事例は本物の ntpath.expanduser・posixpath.expanduser（環境変数・pwd を差し替え）とも同じ。pwd の無い PC（Windows）では
        posixpath の利用者の表を差し替えられないので POSIX の列は比べない（門の答えは test_cases が表と比べる）"""
        try:
            import pwd
        except ImportError:
            pwd = None

        class P:
            def __init__(self, d):
                self.pw_dir = d
        n = 0
        for c in TABLE["cases"]:
            if not c["text"].startswith("~"):
                continue
            for col in ("posix", "nt"):
                if col == "posix" and pwd is None:
                    continue
                base = dict(TABLE["env"][col])
                base.update(c[col].get("env", {}))
                e = env_of(col, c)
                if col == "nt":
                    with mock.patch.dict(os.environ, base["env"], clear=True):
                        want = ntpath.expanduser(c["text"])
                else:
                    def nam(x, pw=base["passwd"]):
                        if x in pw:
                            return P(pw[x])
                        raise KeyError(x)

                    def uid(_, u=base["uid"]):
                        if u is None:
                            raise KeyError(0)
                        return P(u)
                    with mock.patch.dict(os.environ, base["env"], clear=True), mock.patch.object(pwd, "getpwnam", nam), \
                            mock.patch.object(pwd, "getpwuid", uid):
                        want = posixpath.expanduser(c["text"])
                self.assertEqual(path_rules.expanduser(c["text"], col == "nt", e.env, e.passwd), want, f"{c['text']!r} {col}")
                n += 1
        self.assertGreaterEqual(n, 10 if pwd is None else 20)

    def test_routes(self):
        """欄の並びごとの門（apply）: 名前が check_name で断られる・上のフォルダが空なら後ろの欄を見ない（作った後の採点の割れ 4）"""
        bad = []
        for r in TABLE["routes"]:
            for col in ("posix", "nt"):
                want = r[col]
                try:
                    got = {"ok": path_rules.apply("POST", r["rule"], r["values"], env_of(col, {col: {}}))}
                except path_rules.PathRefused as e:
                    got = {"no": str(e)}
                exp = ({"no": TABLE["messages"][want["no"]]} if "no" in want
                       else {"ok": {**r["values"], **(want["ok"] or {})}})
                if got != exp:
                    bad.append(f"{r['why']} {col}: 表 {exp} / 門 {got}")
        self.assertEqual(bad, [], "\n".join(bad))
        self.assertGreaterEqual(len(TABLE["routes"]), 9)

    def test_stops(self):
        """stops: 名前が check_name で断られる・上のフォルダ（dir）が空なら止める。browse は止めない"""
        self.assertTrue(path_rules.stops("name", ""))
        self.assertTrue(path_rules.stops("name", "a/b"))
        self.assertFalse(path_rules.stops("name", "配布"))
        self.assertTrue(path_rules.stops("dir", ' "" '))
        self.assertFalse(path_rules.stops("dir", "/srv"))
        self.assertFalse(path_rules.stops("browse", ""))

    def test_expandvars_is_pythons(self):
        """%VAR%・$VAR の事例は本物の ntpath・posixpath.expandvars（os.environ を表の環境に差し替え）とも同じ"""
        n = 0
        for c in TABLE["cases"]:
            if "$" not in c["text"] and "%" not in c["text"]:
                continue
            for col, mod in (("posix", posixpath), ("nt", ntpath)):
                envd = dict(TABLE["env"][col]["env"])
                real = dict(envd)
                if col == "nt" and os.name != "nt":      # Windows の os.environ は名前の大文字小文字を見ない（Linux で流すときは小文字の名前も置く）
                    real.update({k.lower(): v for k, v in envd.items()})
                with mock.patch.dict(os.environ, real, clear=True):
                    want = mod.expandvars(c["text"])
                self.assertEqual(path_rules.expandvars(c["text"], col == "nt", envd), want, f"{c['text']!r} {col}")
                n += 1
        self.assertGreaterEqual(n, 16)

    @unittest.skipUnless(os.name == "nt", "GetFullPathNameW は Windows だけ")
    def test_win32_is_getfullpathname(self):
        """win32 の事例のうち want を字で書いた物は nt._getfullpathname（ntpath.abspath が呼ぶ関数）の答えと同じ（want を人が書き違えていないか。
        browse も dir も）。os の事例は test_cases が nt._getfullpathname の答えと比べる"""
        import nt
        from app.fsio import unquote_path
        n = 0
        for c in TABLE["cases"]:
            w = c["nt"]["want"]
            if c.get("win32") and "ok" in w and w["ok"] is not None:
                s = unquote_path(c["text"])
                if c["kind"] == "dir":
                    self.assertEqual(nt._getfullpathname(s), w["ok"], c["text"])
                else:
                    t = path_rules.tidy(s.strip("'"), True)
                    self.assertEqual(path_rules.tidy(nt._getfullpathname(t), True), w["ok"], c["text"])
                n += 1
        self.assertGreaterEqual(n, 6)


if __name__ == "__main__":
    unittest.main()
