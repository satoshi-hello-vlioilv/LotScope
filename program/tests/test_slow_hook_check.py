"""tools/slow-hook-check.py（配る窓に遅くする口が入っていないか。版 3.118.3 の作った後の採点の割れ 2）の決め。標準の部品だけ。"""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "slow-hook-check.py"
_spec = importlib.util.spec_from_file_location("slow_hook_check", TOOL)
shc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shc)


class SlowHookCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def exe(self, body: bytes) -> str:
        p = self.dir / "LotScope"
        p.write_bytes(body)
        return str(p)

    def build(self, feats) -> str:
        p = self.dir / "build.json"
        lines = ["not json", json.dumps({"reason": "compiler-message"})]
        for name, f in feats.items():
            lines.append(json.dumps({"reason": "compiler-artifact", "target": {"name": name}, "features": f}))
        p.write_text("\n".join(lines), encoding="utf-8")
        return str(p)

    def test_marks_are_counted_across_the_read_boundary(self):
        # 1 MB ずつ読む区切りにまたがる印も数え、2 度数えない
        cut = (1 << 20) - 5
        body = b"x" * cut + shc.MARK + b"y" * 100 + shc.MARK
        self.assertEqual(shc.marks_in(Path(self.exe(body))), 2)

    def test_an_exe_with_the_mark_fails_and_ui_serve_is_expected_to_have_it(self):
        with_mark = self.exe(b"abc" + shc.MARK + b"def")
        self.assertEqual(shc.main(["--exe", with_mark]), 1)
        self.assertEqual(shc.main(["--exe", with_mark, "--expect-mark"]), 0)
        clean = self.exe(b"abc tpa-slow hook def")
        self.assertEqual(shc.main(["--exe", clean]), 0)
        self.assertEqual(shc.main(["--exe", clean, "--expect-mark"]), 1)
        self.assertEqual(shc.main(["--exe", str(self.dir / "無い")]), 1)

    def test_testing_in_the_features_fails(self):
        clean = self.exe(b"abc")
        ok = self.build({"da_core": ["custom-protocol", "default"], "LotScope": ["custom-protocol", "default"]})
        self.assertEqual(shc.main(["--exe", clean, "--build-json", ok]), 0)
        bad = self.build({"da_core": ["custom-protocol", "default", "testing"], "LotScope": ["custom-protocol", "default"]})
        self.assertEqual(shc.main(["--exe", clean, "--build-json", bad]), 1)
        # 組んだ記録に見張る target が無い（--message-format=json でない出力）も落とす
        self.assertEqual(shc.main(["--exe", clean, "--build-json", self.build({})]), 1)


if __name__ == "__main__":
    unittest.main()
