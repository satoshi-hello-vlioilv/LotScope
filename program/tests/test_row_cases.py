# -*- coding: utf-8 -*-
"""置き場の読めない行を隔てる決まり（版 3.107.0。services/row_check と master_repository.isolated）を、人が仕様から書いた事例の表
tests/fixtures/row_cases.json と突き合わせる。窓は desktop/tests/row_cases.rs が同じ表を読む（cargo test --test row_cases）。"""
import json
import sys
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app.repositories import master_repository as mr  # noqa: E402
from app.services import row_check  # noqa: E402

CASES = json.loads((PROGRAM / "tests" / "fixtures" / "row_cases.json").read_text(encoding="utf-8"))["cases"]


def why_of(case):
    row = json.loads(case["raw"])
    rows = [mr._normalize(row, mr.SPECS[case["master"]]) if isinstance(row, dict) else row]
    got = mr.isolated(case["master"], rows)
    return next(iter(got.values()))[1] if got else None


class RowCases(unittest.TestCase):
    def test_every_case(self):
        bad = [f"{c['name']}: Python {why_of(c)!r}（表 {c['why']!r}）" for c in CASES if why_of(c) != c["why"]]
        self.assertEqual(bad, [])

    def test_row_keys(self):
        """読めない行の目印（何行目かで消す道の確かめ。版 3.108.0 の作った後の採点の割れ 4）: 表の key と同じ字"""
        bad = [f"{c['name']}: {mr.row_key(c['master'], json.loads(c['raw']))}（表 {c['key']}）" for c in CASES
               if "key" in c and mr.row_key(c["master"], json.loads(c["raw"])) != c["key"]]
        self.assertEqual(bad, [])
        self.assertGreaterEqual(sum("key" in c for c in CASES), 4)

    def test_coerced_values(self):
        """隔てない行の、名前の列・字だけの列の字でない値は str() で読む（一覧に出す行。割れ 1）"""
        bad = []
        for c in CASES:
            if "coerced" not in c:
                continue
            row = mr._normalize(json.loads(c["raw"]), mr.SPECS[c["master"]])
            got = row_check.coerce(c["master"], row)
            for k, want in c["coerced"].items():
                if got.get(k) != want:
                    bad.append(f"{c['name']}: {k} は {got.get(k)!r}（表 {want!r}）")
        self.assertEqual(bad, [])

    def test_the_table_covers_every_rule(self):
        """表は決まりの全部の言葉を少なくとも 1 回ずつ持つ（決まりを足したら事例も足す）"""
        whys = " ".join(c["why"] or "" for c in CASES)
        for word in ["表でない行", "id が数ではありません", "版（rev）が読めません", "に数でない値（NaN・Infinity）があります",
                     "に対の無い代用字があります", "の入れ子が深すぎます", "数でない値（NaN・Infinity）があります", "対の無い代用字があります",
                     "の形が違います", "が表ではありません", "の part が並び・表です", "column・expr", "タブの名前", "項目の字の欄",
                     "が並び・表です（", "が字ではありません"]:
            self.assertIn(word, whys)
        self.assertTrue(any(c["why"] is None for c in CASES))

    def test_next_id_counts_isolated_rows(self):
        """次の id は隔てた行の id も int() が読めれば数える（字の "4"・小数の 1e19）。読めない id は数えない（前は ValueError）"""
        from app.repositories.master_store import next_id
        self.assertEqual(next_id([{"id": 1}, {"id": "4"}, {"id": "abc"}, {"id": ["x"]}]), 5)
        self.assertEqual(next_id([{"id": 1e19}]), 10000000000000000001)
        self.assertEqual(next_id([{"id": True}, {"id": None}]), 2)

    def test_skipped_text(self):
        sk = [{"row": i, "why": "w"} for i in range(1, 6)]
        self.assertEqual(row_check.skipped_text("dashboards", sk[:1]), "dashboards.json の 1 行目（w）が読めません")
        self.assertEqual(row_check.skipped_text("dashboards", sk), "dashboards.json の 1 行目（w）・2 行目（w）・3 行目（w） ほか 2 行が読めません")


SHAPES = json.loads((PROGRAM / "tests" / "fixtures" / "rowshape_cases.json").read_text(encoding="utf-8"))


class RowShape(unittest.TestCase):
    """置き場の行・設定・控えの形の事例（版 3.113.0。採点の指摘 1）: 人が仕様から書いた正しい答え（want）と、版 3.112.0 の Python の答え（py）を並べた
    tests/fixtures/rowshape_cases.json を、いまの Python が正しい答えのとおりに答えるか（窓は desktop/tests/row_cases.rs の rowshape_like_the_table）"""

    def test_row_shapes(self):
        from app.services import conversions
        bad = []
        for c in SHAPES["rows"]:
            row = json.loads(c["raw"])
            rows = [mr._normalize(row, mr.SPECS[c["master"]])]
            got = mr.isolated(c["master"], rows)
            why = next(iter(got.values()))[1] if got else None
            if why != c["why"]:
                bad.append(f"{c['name']}: Python {why!r}（表 {c['why']!r}）")
            if why is None and "view" in c:
                v = conversions.view(row_check.coerce(c["master"], rows[0]))
                for k, w in c["view"].items():
                    if v[k] != w:
                        bad.append(f"{c['name']}: view の {k} = {v[k]!r}（表 {w!r}）")
        self.assertEqual(bad, [])
        self.assertGreaterEqual(len(SHAPES["rows"]), 30)

    def test_work_log_rows(self):
        bad = []
        for c in SHAPES["worklog"]:
            row = json.loads(c["raw"])
            rows = [mr._normalize(row, mr.SPECS["work_log_files"]) if isinstance(row, dict) else row]
            got = mr.isolated("work_log_files", rows)
            why = next(iter(got.values()))[1] if got else None
            listed = isinstance(row, dict)          # 作業実績の登録は読みでは隔てない（row_check.FILTERED に無い）・表でない行だけ飛ばす
            if (why, listed, bool(got)) != (c["why"], c["listed"], c["skipped"]):
                bad.append(f"{c['name']}: Python {why!r} {listed} {bool(got)}（表 {c['why']!r} {c['listed']} {c['skipped']}）")
        self.assertEqual(bad, [])

    def test_source_joins(self):
        from app.services import data_join
        bad = []
        for c in SHAPES["sources"]:
            row = json.loads(c["raw"])
            got = mr.isolated("data_sources", [mr._normalize(row, mr.SPECS["data_sources"])])
            why = next(iter(got.values()))[1] if got else None
            if why != c["why"]:
                bad.append(f"{c['name']}: Python {why!r}（表 {c['why']!r}）")
            if "joins" in c and data_join.parse(row.get("結合")) != c["joins"]:
                bad.append(f"{c['name']}: 結合 {data_join.parse(row.get('結合'))}（表 {c['joins']}）")
        self.assertEqual(bad, [])

    def test_lotdsp_keymap(self):
        import tempfile
        from app.services import lotdsp_api
        bad = []
        with tempfile.TemporaryDirectory() as d:
            for c in SHAPES["keymap"]:
                p = Path(d) / "lotdsp_api_map.json"
                p.write_text(json.dumps(c["data"], ensure_ascii=False), encoding="utf-8")
                st = lotdsp_api.status(lotdsp_api.KeyMap(p), {"enabled": True})
                got = {k: st[k] for k in ("ready", "missing", "learned")}
                if got != c["want"]:
                    bad.append(f"{c['name']}: Python {got}（表 {c['want']}）")
        self.assertEqual(bad, [])

    def test_lotdsp_seconds(self):
        from app.services import lotdsp_direct
        bad = []
        for c in SHAPES["seconds"]:
            got = lotdsp_direct.settings_of({"url": "http://x", "direct": json.loads(c["raw"])})["timeout_seconds"]
            if got != c["want"]:
                bad.append(f"{c['name']}: Python {got!r}（表 {c['want']!r}）")
        self.assertEqual(bad, [])

    def test_ui_state(self):
        import os
        import tempfile
        from unittest import mock
        from app.services import ui_state
        bad = []
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"TRANSFER_LOCAL_ROOT": d}):
            for c in SHAPES["uistate"]:
                p = ui_state.path()
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(c["text"], encoding="utf-8", errors="surrogatepass")
                got = ui_state.load()
                w = c["want"]
                if (str(got["rev"]), got["keys"]) != (w["rev"], w["keys"]):
                    bad.append(f"{c['name']}: 読み {got}（表 {w['rev']} {w['keys']}）")
                try:
                    rev = str(ui_state.merge({"tpa.x": "1"})["rev"])
                except Exception as e:      # noqa: BLE001
                    rev = f"{type(e).__name__}: {e}"
                after = json.loads(p.read_text(encoding="utf-8"))
                if (rev, sorted(after["keys"])) != (w["postRev"], w["kept"]) or str(after["rev"]) != w["postRev"]:
                    bad.append(f"{c['name']}: 書き {rev} {sorted(after['keys'])}（表 {w['postRev']} {w['kept']}）")
        self.assertEqual(bad, [])

    def test_cells_set_and_reset(self):
        """標準に置く値・標準から戻す値（版 3.113.0 の作った後の採点の割れ 1）: 中身の列の並び・表は画面が書くのと同じ JSON の字（書かれた鍵の順）"""
        bad = []
        for c in SHAPES["cells"]:
            got = mr.conv_cell(c["col"], json.loads(c["raw"]))
            if got != c["want"]:
                bad.append(f"{c['name']}: Python {got!r}（表 {c['want']!r}）")
        self.assertEqual(bad, [])

    def test_py_column_tells_the_old_answer(self):
        """どの事例にも版 3.112.0 の Python の答え（py）が書いてある（正しい答えと違う形は Python も直した）"""
        for part in ("rows", "worklog", "sources", "keymap", "seconds", "uistate", "cells"):
            for c in SHAPES[part]:
                self.assertTrue(c.get("py"), f"{part} {c['name']}")


if __name__ == "__main__":
    unittest.main()
