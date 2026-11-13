# -*- coding: utf-8 -*-
"""起動の初期値の事例の表（tests/fixtures/seeds_cases.json。人が仕様から書いた答え）を Python の master_seeds で確かめる（版 3.110.0）。
窓（desktop/src/seeds.rs）は cargo test --test seeds_cases が同じ表を読む。Python と窓の終わった後のファイルの突き合わせは seeds_oracle.py と
cargo test --test seeds_parity"""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.repositories import master_store
from app.repositories.master_store import MasterStore
from app.services import master_seeds

TABLE = json.loads((Path(__file__).resolve().parent / "fixtures" / "seeds_cases.json").read_text(encoding="utf-8"))
FNS = {"2026-09-29-inspection-meter": master_seeds._inspection_meter, "2026-09-29-first-developer": master_seeds._first_developer,
       "2026-10-23-kama-date-table": master_seeds._kama_date_table}


def build(root, run):
    """走らせる形の置き場を root に作る → MasterStore"""
    base, local, share = root / "base", root / "local", root / "share"
    for d in (base / "data", local):
        d.mkdir(parents=True, exist_ok=True)
    (local / "instance_id").write_text("inst-py", encoding="utf-8")
    if run["place"] == "share":
        share.mkdir()
        for name, doc in run["masters"].items():
            (share / f"{name}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        settings = {"dir": str(share)}
    elif run["place"] == "unreachable":
        settings = {"dir": str(root / "無い共有")}
    else:
        for name, doc in run["masters"].items():
            (base / "data" / f"{name}.json").write_text(json.dumps(doc["rows"], ensure_ascii=False), encoding="utf-8")
        settings = {}
    return MasterStore(base, local_root=local, settings=settings, who={"pc": "PC-PY", "login": "py"})


def files(root, run):
    """走らせた後のマスタ（共有なら共有の文書、手元のみなら data/ の行の配列）"""
    where = root / "share" if run["place"] == "share" else root / "base" / "data"
    out = {}
    if where.is_dir():
        for p in sorted(where.glob("*.json")):
            out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
    return out


class SeedsCases(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="tpa-seeds-cases-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def bundled(self, case):
        """釜番日付の同梱の表（事例が渡す中身・読めないファイル）を一時の DEFAULTS_DIR に置く"""
        d = self.tmp / f"defaults-{abs(hash(case['name']))}"
        d.mkdir()
        if case.get("bundled_error"):
            (d / "conversions.json").write_text("{読めない", encoding="utf-8")
        elif "bundled" in case:
            (d / "conversions.json").write_text(json.dumps(case["bundled"], ensure_ascii=False), encoding="utf-8")
        return d

    def test_each_rule_like_the_table(self):
        self.assertGreaterEqual(len(TABLE["cases"]), 30)
        for case in TABLE["cases"]:
            with self.subTest(case["name"]):
                rows = copy.deepcopy(case["rows"])
                stamp = copy.deepcopy(TABLE["stamp"])
                with mock.patch.object(master_store, "DEFAULTS_DIR", self.bundled(case)):
                    try:
                        if case["seed"] == "record":
                            changed = master_seeds._record(rows, stamp, case["sid"])
                        else:
                            changed = FNS[case["seed"]](rows, stamp)
                    except Exception as e:   # Python が止まる形（この初期値と後ろは次の起動へ）
                        self.assertTrue(case["expect"].get("error"), f"止まった: {type(e).__name__}: {e}")
                        continue
                self.assertFalse(case["expect"].get("error"), "止まるはず")
                self.assertEqual(changed, case["expect"]["changed"])
                self.assertEqual(rows, case["expect"]["rows"] if changed else case["rows"])

    def test_each_run_like_the_table(self):
        for i, run in enumerate(TABLE["runs"]):
            with self.subTest(run["name"]):
                root = self.tmp / f"run{i}"
                store = build(root, run)
                with mock.patch.object(master_seeds, "LOCKED_WAIT_SEC", 0):
                    applied = master_seeds.run(store)
                ex = run["expect"]
                self.assertEqual(applied, ex["applied"])
                got = files(root, run)
                if ex.get("seeds") is not None:
                    seeds = got.get("app_seeds")
                    rows = seeds["rows"] if isinstance(seeds, dict) else seeds or []
                    self.assertEqual([r["seed"] for r in rows if isinstance(r, dict)], ex["seeds"])
                for name, rev in (ex.get("revisions") or {}).items():
                    self.assertEqual(got[name]["revision"], rev, name)
                for name, n in (ex.get("counts") or {}).items():
                    doc = got[name]
                    self.assertEqual(len(doc["rows"] if isinstance(doc, dict) else doc), n, name)
                if run["place"] == "unreachable":
                    self.assertFalse((root / "無い共有").exists(), "届かない共有は作らない")


class SeedsNamed(unittest.TestCase):
    """窓が seeds を名乗れば boot.start は当てない（版 3.110.0。engine の設定によらない）"""

    def test_boot_skips_seeds_when_the_window_serves_them(self):
        from app import boot

        class App:
            config = {"LOT_MIRROR": mock.Mock(), "MASTER_STORE": object()}
        for serves, runs in (("lotlist,seeds", False), ("lotlist", True), ("", True)):
            with self.subTest(serves=serves), mock.patch.dict("os.environ", {"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": serves}), \
                    mock.patch("threading.Thread") as th:
                boot.start(App, "stdio", 0.0)
                names = [c.kwargs.get("name") for c in th.call_args_list]
                self.assertEqual("master-seeds" in names, runs, names)


if __name__ == "__main__":
    unittest.main()
