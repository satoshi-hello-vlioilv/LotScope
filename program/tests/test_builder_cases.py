# -*- coding: utf-8 -*-
"""組む所の読み（版 3.99.0）の事例の表 tests/fixtures/builder_cases.json を、Python の部品と独立の答え（tools/builder-truth.py）で確かめる。

事例の答えは仕様（services/builder.py の冒頭の決まり）から人が書いた。Python の部品（pivot.field_sets・merge_fields・column_names・
builder.check_sqlite）が同じ答えか、独立の答え（app を import しない sqlite3 だけ）も同じ答えかを見る。窓（desktop/src）も同じ表を
desktop/tests/builder_cases.rs で読む。
"""
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app.services import builder, pivot, work_log  # noqa: E402
from app.services.formula import clean_calc  # noqa: E402

_spec = importlib.util.spec_from_file_location("builder_truth", PROGRAM / "tools" / "builder-truth.py")
truth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(truth)

CASES = json.loads((PROGRAM / "tests" / "fixtures" / "builder_cases.json").read_text(encoding="utf-8"))


def make(d, name, spec):
    return truth.make_file(Path(d) / name, {**spec, "rows": truth.expand(spec["rows"])} if "rows" in spec else spec)


def place_of(d, cs, i):
    """確かめるの事例のファイル → 確かめる場所の字"""
    kind = cs["file"]
    if kind == "empty":
        return ""
    p = Path(d) / f"c{i}.sqlite3"
    if kind == "two":
        truth.make_file(p, CASES["files"]["two"])
    elif kind == "text":
        p.write_text("abc", encoding="utf-8")
    if "mtimeHours" in cs:
        t = time.time() + cs["mtimeHours"] * 3600
        os.utime(p, (t, t))
    return f'"{p}"' if cs.get("quote") else str(p)


class BuilderCases(unittest.TestCase):
    def test_fields_cases(self):
        with tempfile.TemporaryDirectory() as d:
            for i, cs in enumerate(CASES["fields"]):
                with self.subTest(cs["name"]):
                    files = [make(d, f"f{i}_{j}.sqlite3", p) for j, p in enumerate(cs["parts"])]
                    calc = clean_calc(cs.get("calc"))
                    per = [(f"台{j + 1}", pivot.field_sets(f, table_candidates=work_log.TABLE_CANDIDATES, calc=calc)) for j, f in enumerate(files)]
                    got = {f["column"]: f for f in pivot.merge_fields(per)}
                    for col, want in cs["want"].items():
                        g = got[col]
                        self.assertEqual({k: (bool(g.get(k)) if k in ("blankOnly", "calc") else g.get(k)) for k in want}, want, col)
                    if "order" in cs:
                        self.assertEqual(list(got), cs["order"])
                    # 独立の答え（計算列は数えない）も事例と同じ
                    t = truth.fields(files, candidates=truth.WORK_TABLES)
                    for col, want in cs["want"].items():
                        if col in t["fields"]:
                            self.assertEqual({k: t["fields"][col][k] for k in want if k in t["fields"][col]},
                                             {k: v for k, v in want.items() if k in t["fields"][col]}, f"独立の答え {col}")
                    if "order" in cs:
                        self.assertEqual(t["order"], [c for c in cs["order"] if c in t["order"]])

    def test_sample_cases(self):
        with tempfile.TemporaryDirectory() as d:
            for i, cs in enumerate(CASES["samples"]):
                with self.subTest(cs["name"]):
                    f = make(d, f"s{i}.sqlite3", {"cols": cs["cols"], "rows": cs["rows"]})
                    _, cols = pivot.column_names(f, table_candidates=work_log.TABLE_CANDIDATES)
                    self.assertEqual({c["column"]: c["samples"] for c in cols}, cs["want"])
                    self.assertEqual(truth.samples([f], candidates=truth.WORK_TABLES)["samples"], cs["want"])

    def test_check_cases(self):
        with tempfile.TemporaryDirectory() as d:
            for i, cs in enumerate(CASES["checks"]):
                with self.subTest(cs["name"]):
                    place = place_of(d, cs, i)
                    b = cs["body"]
                    got = builder.check_sqlite(place, b.get("table", ""), b.get("role", ""), b.get("equipColumn", ""))
                    det = got.get("detail") or {}
                    self.assertEqual({k: (got["ok"] if k == "ok" else det.get(k)) for k in cs["want"]}, cs["want"], got["message"])
                    for x in cs.get("has", []):
                        self.assertIn(x, got["message"])
                    for x in cs.get("hasNot", []):
                        self.assertNotIn(x, got["message"])
                    if "table" in cs["want"] and cs["file"] == "two":
                        tr = truth.check(place.strip('"'), b.get("table", ""), b.get("role", ""))
                        self.assertEqual({k: tr[k] for k in ("table", "rows", "lotColumn") if k in cs["want"]},
                                         {k: cs["want"][k] for k in ("table", "rows", "lotColumn") if k in cs["want"]}, "独立の答え")

    def test_truth_does_not_import_the_app(self):
        """独立の答えは app を読まない（Python と同じ誤りを持たない）"""
        src = (PROGRAM / "tools" / "builder-truth.py").read_text(encoding="utf-8")
        self.assertNotIn("from app", src)
        self.assertNotIn("import app", src)
        for mod in ("sqlite3", "json", "unicodedata", "math"):
            self.assertIn(f"import {mod}", src)

    def test_decisions_are_in_one_place(self):
        """決め（主のセッションの決め 1〜7）は services/builder.py の定数（窓の desktop/src/builder.rs と同じ値。builder_parity）"""
        d = builder.decisions()
        self.assertEqual((d["kindsUnion"], d["equipLimit"], d["joinAllEquips"], d["staleRoles"], d["cm3Reach"]),
                         (True, None, True, ["品質", "仕掛", "実績"], True))


if __name__ == "__main__":
    unittest.main()
