# -*- coding: utf-8 -*-
"""画面の部品の評価関数を node で流す（node が無い所では飛ばす）:
- 式ビルダー（static/js/formula-builder.js）: 組み立てた物が式の決まり（list-formula.js）で読め、思ったとおりの値になる（formula-builder-check.mjs）
- Excel を組む部品（static/js/xlsx-writer.js）: 書いた .xlsx を標準の zipfile・xml で読み戻し、値・型・見出しの固定などが合う（xlsx-check.mjs）
- LotDsp を開く URL（static/js/lotdsp-url.js）: WaveLog と同じ URL（ロット番号・鋳造番号の linkkey・タブ）を作る（lotdsp-url-check.mjs）
- 変換表を一覧の列に当てる計画（static/js/conversions.js）: 列の見つけ方・足す所・当て直し・当てた式の答え（conv-plan-check.mjs）
- 行・列・値の札を引いて組み替える決まり（static/js/pivot-dnd.js）: 並べ替え・行 ⇔ 列・カラムの札から足す・入れ替え（pivot-dnd-check.mjs）
- 数の表示形式（static/js/num-format.js）: Excel の書式コード（区分・条件・色・桁・桁区切り・%・指数・字）と同じ字（num-format-check.mjs）
- 集計の答え → 表の形（lotlist-pivot-charts.js の buildModel）と、ダッシュボードの表の上位 N＋その他（dashboard-panels.js）: 総計を空の値の小計と
  取り違えない・上位＋その他＝総計（pivot-model-check.mjs。版 3.92.0）
- 計算列の式（static/js/list-formula.js）: 事例表 formula_cases.json の js 欄（窓の formula.rs も cargo test --test formula_cases で同じ表と比べる）と
  formula_regex_cases.json の js・jsWhy 欄が、いまの画面の式の答えと同じ（formula-parity.mjs・formula-regex-js.mjs。版 3.119.0 の作った後の直し 1:
  前は app を import する試験が同じ所を見ていた）。片割れの代用字は表の {"utf16": [単位]} の形にそろえて比べる"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "tools"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
LIST_FORMULA = TOOLS.parent / "app" / "static" / "js" / "list-formula.js"


def units_if_lone(v):
    """片割れの代用字（U+D800〜U+DFFF の 1 字）を含む字 → 表の形 {"utf16": [単位]}（JSON の UTF-8 に書けないため）。ほかはそのまま"""
    if not (isinstance(v, str) and any("\ud800" <= ch <= "\udfff" for ch in v)):
        return v
    b = v.encode("utf-16-le", "surrogatepass")
    return {"utf16": [int.from_bytes(b[i:i + 2], "little") for i in range(0, len(b), 2)]}


def formula_answers(env=None):
    """formula_cases.json の cases を画面の式で答える → [js 欄の形]"""
    t = json.loads((FIXTURES / "formula_cases.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "cases.json"
        src.write_text(json.dumps({"cases": [{"expr": c["expr"], "row": c["row"]} for c in t["cases"]], "tables": t["tables"]}, ensure_ascii=False),
                       encoding="utf-8")
        r = subprocess.run(["node", str(TOOLS / "formula-parity.mjs"), str(src)], capture_output=True, text=True, encoding="utf-8",
                           timeout=300, env={**os.environ, **(env or {})}, check=False)
    assert r.returncode == 0, r.stderr
    return t["cases"], [{k: units_if_lone(v) for k, v in a.items()} for a in json.loads(r.stdout)]


def regex_answers(env=None):
    t = json.loads((FIXTURES / "formula_regex_cases.json").read_text(encoding="utf-8"))
    r = subprocess.run(["node", str(TOOLS / "formula-regex-js.mjs")], input=json.dumps([c["pattern"] for c in t["cases"]]), capture_output=True,
                       text=True, encoding="utf-8", timeout=120, env={**os.environ, **(env or {})}, check=False)
    assert r.returncode == 0, r.stderr
    return t["cases"], json.loads(r.stdout)


def mismatches(cases, got):
    return [(c["expr"], c["row"], c["js"], g) for c, g in zip(cases, got) if c["js"] != g]


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

    def test_number_format_codes_like_excel(self):
        self.run_tool("num-format-check.mjs")

    def test_pivot_drag_and_drop_rules(self):
        self.run_tool("pivot-dnd-check.mjs")

    def test_pivot_table_model_and_top_rows(self):
        self.run_tool("pivot-model-check.mjs")

    def test_formula_cases_are_the_answers_of_the_screen(self):
        cases, got = formula_answers()
        self.assertEqual(len(cases), len(got))
        self.assertGreaterEqual(len(cases), 4000)
        self.assertGreaterEqual(sum(1 for c in cases if isinstance(c["js"].get("value"), dict)), 9, "代用字の事例も比べている")
        bad = mismatches(cases, got)
        self.assertEqual(bad[:5], [], f"画面の式の答えが事例表 formula_cases.json の js 欄と違う（{len(bad)} 件）")

    def test_formula_regex_cases_are_the_answers_of_the_screen(self):
        cases, got = regex_answers()
        bad = [(c["pattern"], c["js"], c["jsWhy"], g) for c, g in zip(cases, got) if (c["js"], c["jsWhy"]) != (g["js"], g["why"])]
        self.assertEqual(len(cases), len(got))
        self.assertEqual(bad[:5], [], f"画面の式の正規表現の答えが formula_regex_cases.json の js 欄と違う（{len(bad)} 件）")

    def test_a_changed_screen_formula_is_found(self):
        """変異: list-formula.js の 1 関数（upper・regexRisk）を替えると、2 つの比べが落ちる"""
        src = LIST_FORMULA.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "list-formula.js"
            a = "upper:a=>textOf(a[0]).toUpperCase(),"
            self.assertIn(a, src)
            p.write_text(src.replace(a, "upper:a=>textOf(a[0]).toLowerCase(),"), encoding="utf-8")
            cases, got = formula_answers({"TPA_LIST_FORMULA": str(p)})
            self.assertTrue(mismatches(cases, got), "upper を替えても落ちない")
            mutated = src.replace("function regexRisk(", "function regexRisk(p){return '';}\nfunction regexRiskOld(", 1)
            self.assertNotEqual(mutated, src, "list-formula.js に regexRisk の関数が無い")
            p.write_text(mutated, encoding="utf-8")
            cases, got = regex_answers({"TPA_LIST_FORMULA": str(p)})
            self.assertTrue(any(c["js"] != g["js"] for c, g in zip(cases, got)), "regexRisk を替えても落ちない")


if __name__ == "__main__":
    unittest.main()
