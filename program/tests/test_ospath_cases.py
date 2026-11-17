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
                else:
                    exp = {"ok": c["text"] if want["ok"] is None else want["ok"]}
                if got != exp:
                    bad.append(f"{c['kind']} {c['text']!r} {col}: 表 {exp} / 門 {got}")
        self.assertGreaterEqual(ran, 150)
        self.assertEqual(bad, [], "\n".join(bad))

    def test_expanduser_is_pythons(self):
        """~ の事例は本物の ntpath.expanduser・posixpath.expanduser（環境変数・pwd を差し替え）とも同じ"""
        import pwd

        class P:
            def __init__(self, d):
                self.pw_dir = d
        n = 0
        for c in TABLE["cases"]:
            if not c["text"].startswith("~"):
                continue
            for col in ("posix", "nt"):
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
        self.assertGreaterEqual(n, 20)

    @unittest.skipUnless(os.name == "nt", "GetFullPathNameW は Windows だけ")
    def test_win32_is_getfullpathname(self):
        """win32 の事例は nt._getfullpathname（ntpath.abspath が呼ぶ関数）の答えと同じ（want を人が書き違えていないか）"""
        import nt
        for c in TABLE["cases"]:
            if not c.get("win32"):
                continue
            w = c["nt"]["want"]
            if "ok" in w and w["ok"] is not None and c["kind"] == "dir":
                from app.fsio import unquote_path
                s = unquote_path(c["text"])
                p = s if path_rules._absolute(s, True) else ntpath.join(TABLE["env"]["nt"]["cwd"], s)
                self.assertEqual(nt._getfullpathname(p), w["ok"], c["text"])


if __name__ == "__main__":
    unittest.main()
