# -*- coding: utf-8 -*-
"""画面の部品の評価関数を node で流す（node が無い所では飛ばす）:
- 式ビルダー（static/js/formula-builder.js）: 組み立てた物が式の決まり（list-formula.js）で読め、思ったとおりの値になる（formula-builder-check.mjs）
- Excel を組む部品（static/js/xlsx-writer.js）: 書いた .xlsx を標準の zipfile・xml で読み戻し、値・型・見出しの固定などが合う（xlsx-check.mjs）
- LotDsp を開く URL（static/js/lotdsp-url.js）: WaveLog と同じ URL（ロット番号・鋳造番号の linkkey・タブ）を作る（lotdsp-url-check.mjs）
- 変換表を一覧の列に当てる計画（static/js/conversions.js）: 列の見つけ方・足す所・当て直し・当てた式の答え（conv-plan-check.mjs）"""
import shutil
import subprocess
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "tools"


@unittest.skipUnless(shutil.which("node"), "node がありません")
class ScreenParts(unittest.TestCase):
    def run_tool(self, name):
        r = subprocess.run(["node", str(TOOLS / name)], capture_output=True, text=True, encoding="utf-8", timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(r.stdout.splitlines()[-1].startswith("OK"), r.stdout)

    def test_every_kind_builds_a_formula_that_reads_and_gives_the_value(self):
        self.run_tool("formula-builder-check.mjs")

    @unittest.skipUnless(shutil.which("python3"), "python3 がありません（評価関数が読み戻しに使う）")
    def test_xlsx_writer_writes_a_workbook_that_reads_back(self):
        self.run_tool("xlsx-check.mjs")

    def test_lotdsp_url_is_the_same_as_wavelog(self):
        self.run_tool("lotdsp-url-check.mjs")

    def test_conversion_plan(self):
        self.run_tool("conv-plan-check.mjs")


if __name__ == "__main__":
    unittest.main()
