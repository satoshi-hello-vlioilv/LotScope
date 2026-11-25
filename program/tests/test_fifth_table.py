"""段 ⑤（版 3.119.0。不要になったファイルの片付け）の門: 消した物の名を名指す所が 0（採点 tools/ui-proposals/2026-11-stage5.json の first_fixes 9）。

消した物（中身〈Python〉の係・枠・Python の開発用サーバー・答え合わせ役・凍らせた写しと凍らせた試験・任せる歩の予算と数える道具・
窓が Python を探す口・窓が Python に任せる型）の名を、git が追跡しているファイルの中から git grep で探し、名指す所が 0 であることを見る。
例外は歴史の節だけ:
- 文書（*.md）の印 `<!-- history -->` 〜 `<!-- /history -->` の中（計画書・設計書の済んだ版の記録）
- 更新履歴（program/app/version.py の CHANGELOG・焼いた program/app/changelog.json）
- 採点の記録（program/tools/ui-proposals。残した記録は済んだ版の決めの記録）
- この門の試験そのもの
名を 1 つ戻すと落ちる（test_a_name_put_back_is_found）。app を import しない（標準の部品だけ）
"""

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ("sidecar.rs", "frame.rs", "ui_server", "_oracle.py", "tests/legacy", "TPA_FROZEN_PY", "frozen_python",
         "delegates_budget", "delegate-count", "locate::python", "Fail::Py")
SELF = "program/tests/test_fifth_table.py"
HISTORY = re.compile(r"<!-- history -->.*?<!-- /history -->", re.S)
EXEMPT = (SELF, "program/app/version.py", "program/app/changelog.json")
EXEMPT_DIRS = ("program/tools/ui-proposals/",)


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)


def has_git():
    r = run(["git", "rev-parse", "--is-inside-work-tree"])
    return r.returncode == 0 and r.stdout.strip() == "true"


def found_in(path: str, text: str) -> list[str]:
    """1 つのファイルの中で名指す所（「道:行: 名」）。歴史の節は伏せる"""
    if path in EXEMPT or path.startswith(EXEMPT_DIRS):
        return []
    if path.endswith(".md"):
        text = HISTORY.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for n in NAMES:
            if n in line:
                out.append(f"{path}:{i}: {n}")
    return out


def tracked_hits() -> list[str]:
    """追跡しているファイルのうち、名を含む物（git grep -l -F）の中の名指す所"""
    args = ["git", "grep", "-l", "-I", "-F"]
    for n in NAMES:
        args += ["-e", n]
    r = run(args)
    out = []
    for path in r.stdout.splitlines():
        try:
            text = (ROOT / path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        out += found_in(path, text)
    return out


@unittest.skipUnless(has_git(), "git の作業フォルダでない")
class FifthGate(unittest.TestCase):
    def test_nothing_names_what_was_removed(self):
        hits = tracked_hits()
        self.assertEqual(hits, [], "消した物の名を名指す所があります（歴史の節〈<!-- history -->〉の外）:\n" + "\n".join(hits[:40]))

    def test_a_name_put_back_is_found(self):
        """変異: 名を 1 つ戻すと落ちる（歴史の節の中なら落ちない・節を閉じた後なら落ちる）"""
        for n in NAMES:
            with self.subTest(n):
                self.assertEqual(len(found_in("desktop/src/x.rs", f"// 前の {n} の代わり\n")), 1)
                self.assertEqual(found_in("program/docs/x.md", f"<!-- history -->\n{n}\n<!-- /history -->\n"), [])
                self.assertEqual(len(found_in("program/docs/x.md", f"<!-- history -->\na\n<!-- /history -->\n{n}\n")), 1)
                self.assertEqual(found_in("program/tools/ui-proposals/x.json", n), [])

    def test_removed_files_are_gone(self):
        """消した物そのものが追跡されていない（印の program/sidecar.py は 1 行で残す）"""
        files = set(run(["git", "ls-files"]).stdout.splitlines())
        gone = ["desktop/src/sidecar.rs", "desktop/src/frame.rs", "program/tools/ui_server.py", "program/tools/delegate-count.py",
                "program/tools/freeze-legacy.py", "program/tests/fixtures/delegates_budget.json", "program/app/web.py", "program/app/app_icon.py"]
        self.assertEqual([f for f in gone if f in files], [])
        self.assertEqual([f for f in files if f.startswith("program/tests/legacy/") or f.endswith("_oracle.py")], [])
        py = sorted(f for f in files if f.startswith("program/app/") and f.endswith(".py"))
        self.assertEqual(py, ["program/app/version.py"], "program/app の .py は版の 1 つだけ")
        self.assertIn("program/sidecar.py", files)
        self.assertEqual(len((ROOT / "program" / "sidecar.py").read_text(encoding="utf-8").splitlines()), 1, "印は 1 行")


if __name__ == "__main__":
    unittest.main()
