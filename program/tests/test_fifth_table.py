"""計画書の段 ⑤ の入口の表（program/docs/RUST_PORT_PLAN.md の「⑤ 不要になったファイルの片付け」）の数える命令（版 3.118.3 の作った後の採点の割れ 1）。

- 命令は git が追跡しているファイルだけを数える（`find`・`du`・`ls` を使わない。試験を流した PC で増える __pycache__ を数えない）
- 追跡していないファイル（program/app の __pycache__ の .pyc）を置いても、命令の答えは変わらない
- 表を書いた版（3.118.3）の間は、表の数と命令の答えが同じ（版が上がったら ⑤ の版を作る係が流し直す。文書の数〈CLAUDE.md の行・採点の記録〉は除く）
"""

import re
import subprocess
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "program" / "docs" / "RUST_PORT_PLAN.md"
TABLE_VERSION = "3.118.3"


def table_pairs():
    """表の行の「`命令` → 数」の組（表の中の \\| は | に戻す）"""
    text = PLAN.read_text(encoding="utf-8")
    a = text.index("2. **⑤ 不要になったファイルの片付け**")
    b = text.index("   - **⑤ の入口に足す**", a)
    rows = [line for line in text[a:b].splitlines() if line.startswith("   | ") and "` → " in line]
    pairs = []
    for line in rows:
        for cmd, want in re.findall(r"`([^`]+)` → ([^・|\s]+)", line):
            pairs.append((cmd.replace("\\|", "|"), want))
    return pairs


def run(cmd):
    return subprocess.run(["bash", "-c", cmd], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def has_git():
    try:
        return run("git rev-parse --is-inside-work-tree") == "true"
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


@unittest.skipUnless(has_git(), "git の作業フォルダでない")
class FifthTable(unittest.TestCase):
    def test_commands_count_only_tracked_files(self):
        pairs = table_pairs()
        self.assertGreaterEqual(len(pairs), 20, pairs)
        for cmd, _ in pairs:
            with self.subTest(cmd=cmd):
                self.assertIsNone(re.search(r"(^|[\s|;(])(find|du|ls)\s", cmd), "追跡していないファイルまで数える命令")
                if re.search(r"program/(app|tests/legacy|tools/ui-proposals)(\s|'|$)", cmd):  # フォルダそのものを数える命令
                    self.assertRegex(cmd, r"git (ls-files|grep)", "フォルダは git が追跡している物だけを数える")

    def test_untracked_files_do_not_change_the_answers(self):
        cache = ROOT / "program" / "app" / "__pycache__"
        made = not cache.exists()
        cache.mkdir(exist_ok=True)
        probe = cache / f"_fifth_probe_{uuid.uuid4().hex}.pyc"
        legacy = ROOT / "program" / "tests" / "legacy" / "__pycache__"
        made_l = not legacy.exists()
        legacy.mkdir(exist_ok=True)
        probe_l = legacy / f"_fifth_probe_{uuid.uuid4().hex}.pyc"
        try:
            before = {c: run(c) for c, _ in table_pairs() if "program/app" in c or "legacy" in c}
            probe.write_bytes(b"x" * 100)
            probe_l.write_bytes(b"x" * 100)
            after = {c: run(c) for c in before}
            self.assertEqual(before, after)
        finally:
            probe.unlink(missing_ok=True)
            probe_l.unlink(missing_ok=True)
            if made:
                cache.rmdir()
            if made_l:
                legacy.rmdir()

    def test_numbers_are_the_answers_while_the_version_is_the_table_version(self):
        # 版は字で読む（app を import しない: この試験が表の「app を import する試験」の数を変えない）
        version = re.search(r'^APP_VERSION = "([^"]+)"', (ROOT / "program/app/version.py").read_text(encoding="utf-8"), re.M).group(1)
        if version != TABLE_VERSION:
            self.skipTest(f"表は版 {TABLE_VERSION} の数（今は {version}。⑤ の版を作る係が流し直す）")
        for cmd, want in table_pairs():
            # 文書の数（CLAUDE.md の行・採点の記録の数）は版を上げずに文書だけ直しても変わるので、突き合わせない（表の数は版の commit の上の数）
            if "CLAUDE.md" in cmd or "ui-proposals" in cmd:
                continue
            with self.subTest(cmd=cmd):
                self.assertEqual(run(cmd), want)


if __name__ == "__main__":
    unittest.main()
