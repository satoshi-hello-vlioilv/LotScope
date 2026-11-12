# -*- coding: utf-8 -*-
"""基準の数（版 3.103.0。services/capacity.py・pivot.query_many の bases）を、app を使わない独立の答え（tools/capacity-truth.py）と比べる。

試験用の作業実績（設備 11 台。CR2 は 2 直・ほかは 3 直〈3 直は日を跨ぐ〉・分割ロット〈同じ作業開始が 2〜4 行〉・焼鈍炉 ANF）で、
    設備ごと（直近 14 日）: 稼働直・稼働日・1日の直数・期間の日数・期間の直数・換算稼働日・稼働率・重量÷稼働直・重量÷換算稼働日
    設備 × 作業月（期間なし）: 換算稼働日（月の稼働日数）・稼働率（期間の日数＝セルの最初〜最後の作業日）
    作業日ごと（直近 7 日）: 全設備の稼働直・稼働率（その日に実績の無い設備も分母に入る）
    設備 × 直（直近 14 日）: 稼働直・期間の直数（直の段は 1 日 1 直）
を数え、総計は Σ分子÷Σ分母であること（行の比の平均ではない）も確かめる。窓（Rust）は dash_parity・pivot_parity で Python と突き合わせる。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM / "tools"))

from app.services import capacity, num_expr, pivot, shifts, work_log  # noqa: E402

NOW = datetime(2026, 10, 3, 10, 0, 0)
OWN = [dict(b) for b in capacity.DEFAULT_OWN]
START = "BOX実績_作業開始_日付"


def _close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= 1e-5 * max(1.0, abs(b))


class CapacityTruthTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import ui_server
        from app.repositories.master_repository import MasterRepository
        ui_server.as_role("開発者")
        app = ui_server.build(quality=200, work_rows=160, wip=100)
        repo = MasterRepository(app.config["MASTER_STORE"])
        pats = repo.shift_patterns()
        folder = ui_server.WORK / "【New】実績"
        cls.parts, cls.eqs = [], []
        for r in work_log.ordered(repo.work_logs()):
            p = folder / r["ファイル名"]
            if not p.exists() or str(r.get("表示") or "有") == "無":
                continue
            pat = shifts.pattern_for(pats, r["設備名"])
            segs = pat["segments"] if pat else []
            cls.parts.append(pivot.Part(str(p), preferred_table=r.get("表") or "", table_candidates=work_log.TABLE_CANDIDATES,
                                        work={"clock": shifts.Clock(segs), "basis": "work", "start": ""}, equip={"name": r["設備名"]}, name=r["設備名"]))
            import sqlite3
            c = sqlite3.connect(p)
            table = [x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'")][0]
            c.close()
            cls.eqs.append({"name": r["設備名"], "path": str(p), "table": table, "start": START, "weight": "重量",
                            "segments": [{"name": s["name"], "start": s["start"], "end": s["end"], "dayOffset": s["dayOffset"] if s["crosses"] else None}
                                         for s in segs]})
        views = [{"id": "eq14", "kind": "equip", "period": {"kind": "days", "n": 14}},
                 {"id": "month", "kind": "equip_month", "period": None},
                 {"id": "day7", "kind": "day", "period": {"kind": "days", "n": 7}},
                 {"id": "shift14", "kind": "equip_shift", "period": {"kind": "days", "n": 14}}]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"now": NOW.isoformat(sep=" "), "equipment": cls.eqs, "views": views}, f, ensure_ascii=False)
        out = subprocess.run([sys.executable, str(PROGRAM / "tools" / "capacity-truth.py"), f.name], capture_output=True, check=True)
        os.unlink(f.name)
        cls.truth = json.loads(out.stdout.decode("utf-8"))

    def ask(self, rows, cols, measures, period=None):
        return pivot.query_many(self.parts, rows=json.dumps(rows, ensure_ascii=False), cols=json.dumps(cols, ensure_ascii=False),
                                measures=json.dumps(measures, ensure_ascii=False), period=period, now=NOW, today=NOW.date(), bases=OWN)

    def compare(self, got, want, keys):
        """got … {鍵の組: 値の並び}・want … 独立の答えのセル。keys … 値の並びの名前"""
        n = 0
        for c in want:
            k = tuple(c["r"])
            self.assertIn(k, got, f"Python にセル {k} がありません")
            for name, v in zip(keys, got[k]):
                self.assertTrue(_close(v, c[name]), f"{k} の {name}: Python {v} / 独立の答え {c[name]}")
                n += 1
        return n

    def test_data_is_read_by_both(self):
        self.assertEqual(self.truth["unread"], 0, "独立の答えが読めない作業開始がある（比べる前提が崩れている）")
        self.assertIn(2, {len(e["segments"]) for e in self.eqs}, "2 直の設備（CR2）が無い")

    def test_equipment_14_days(self):
        keys = ["稼働直", "稼働日", "1日の直数", "期間の日数", "期間の直数", "換算稼働日", "稼働率", "重量/稼働直", "重量/換算稼働日"]
        ms = [{"agg": "base", "base": k} for k in keys[:7]] + [{"agg": "sum", "column": "重量", "per": "稼働直"}, {"agg": "sum", "column": "重量", "per": "換算稼働日"}]
        per = {"column": "@workday", "kind": "days", "n": 14}
        a, b = self.ask([{"column": "@equip"}], [], ms[:5], per), self.ask([{"column": "@equip"}], [], ms[5:], per)     # 値は 6 つまで
        got = {tuple(c["r"]): c["v"] for c in a["cells"]}
        for c in b["cells"]:
            got[tuple(c["r"])] = got[tuple(c["r"])] + c["v"]
        self.assertTrue(all(len(v) == 9 for v in got.values()))
        n = self.compare(got, self.truth["views"]["eq14"]["cells"], keys)
        self.assertGreater(n, 50)
        # 総計は Σ分子÷Σ分母（行の比の平均ではない）
        rows = [c for c in self.truth["views"]["eq14"]["cells"] if c["r"]]
        tot = got[()]
        mean = sum(c["重量/稼働直"] for c in rows) / len(rows)
        self.assertTrue(_close(tot[7], sum(c["重量"] for c in rows) / sum(c["稼働直"] for c in rows)))
        self.assertFalse(_close(tot[7], mean), "総計が行の比の平均になっている")
        self.assertIsNone(tot[2], "設備で直の数が違う総計の 1日の直数は決まらない")

    def test_month_working_days(self):
        ms = [{"agg": "base", "base": "換算稼働日"}, {"agg": "base", "base": "稼働率"}, {"agg": "base", "base": "期間の日数"}]
        a = self.ask([{"column": "@equip"}], [{"column": "@workday", "part": "ym"}], ms)
        got = {}
        for c in a["cells"]:
            r = (c["r"][0] if c["r"] else "", c["c"][0] if c["c"] else "")
            got[() if r == ("", "") else r] = c["v"]
        self.compare(got, self.truth["views"]["month"]["cells"], ["換算稼働日", "稼働率", "期間の日数"])
        # 途中の月（試験データは 10/2 まで・いまは 10/3）
        part = a["bases"]["partial"]["1"]
        self.assertEqual(list(part), ["2026-10"])
        self.assertEqual(part["2026-10"], ["2026-10-01", "2026-10-02"])

    def test_days_include_idle_equipment(self):
        a = self.ask([{"column": "@workday"}], [], [{"agg": "base", "base": "稼働直"}, {"agg": "base", "base": "稼働率"}, {"agg": "base", "base": "期間の直数"}],
                     {"column": "@workday", "kind": "days", "n": 7})
        got = {tuple(c["r"]): c["v"] for c in a["cells"]}
        self.compare(got, self.truth["views"]["day7"]["cells"], ["稼働直", "稼働率", "期間の直数"])
        one_day = [c for c in self.truth["views"]["day7"]["cells"] if c["r"]][0]
        self.assertEqual(one_day["期間の直数"], sum(len(e["segments"]) for e in self.eqs), "その日に実績の無い設備も分母に入る")

    def test_shift_column(self):
        a = self.ask([{"column": "@equip"}, {"column": "@shift"}], [], [{"agg": "base", "base": "稼働直"}, {"agg": "base", "base": "期間の直数"}],
                     {"column": "@workday", "kind": "days", "n": 14})
        names = {i: [s["name"] for s in e["segments"]] for i, e in enumerate(self.eqs)}
        got = {}
        for c in a["cells"]:
            if len(c["r"]) == 2:
                eq = c["r"][0]
                i = next(j for j, e in enumerate(self.eqs) if e["name"] == eq)
                got[(eq, c["r"][1] if c["r"][1] in names[i] else names[i][int(c["r"][1])] if c["r"][1].isdigit() else c["r"][1])] = c["v"]
        self.compare(got, self.truth["views"]["shift14"]["cells"], ["稼働直", "期間の直数"])


class CapacityRulesTest(unittest.TestCase):
    def test_own_clean(self):
        got = capacity.clean_own([{"name": "換算稼働日", "expr": "[稼働直]÷[1日の直数]", "each": True, "unit": "日"}, {"name": "稼働直", "expr": "[稼働日]"},
                                  {"name": "x", "expr": "x×2"}, {"name": "換算稼働日", "expr": "[稼働日]"}, {"name": "a]b", "expr": "[稼働日]"}, "x"])
        self.assertEqual(got, [{"name": "換算稼働日", "expr": "[稼働直]÷[1日の直数]", "each": True, "unit": "日"}])
        self.assertIsNone(capacity.clean_own("x"))

    def test_uses(self):
        fixed, mine = capacity.uses([{"agg": "sum", "column": "重量", "per": "稼働率"}], capacity.DEFAULT_OWN)
        self.assertEqual(mine, {"稼働率"})
        self.assertEqual(fixed, {"稼働直", "期間の直数", "期間の日数", "1日の直数"})
        self.assertEqual(capacity.uses([{"agg": "sum", "column": "重量", "expr": "÷[稼働日]"}], []), ({"稼働日"}, set()))

    def test_text(self):
        from app.services import aggregate
        self.assertEqual(aggregate.name({"agg": "sum", "column": "重量", "expr": "÷1000", "per": "稼働直"}), "重量の合計［値÷1000÷稼働直］")
        self.assertEqual(aggregate.name({"agg": "base", "column": "", "base": "稼働率"}), "稼働率")
        self.assertEqual(num_expr.show_text("÷［稼働直］"), "値÷[稼働直]")

    def test_per_zero_is_none(self):
        from app.services import aggregate
        cells = [{"r": [], "c": [], "v": [10, 10]}]
        aggregate.apply_expr(cells, [{"agg": "sum", "column": "a", "per": "稼働直"}, {"agg": "sum", "column": "a", "per": "稼働日"}],
                             lambda x: {"稼働直": 0, "稼働日": None})
        self.assertEqual(cells[0]["v"], [None, None])


if __name__ == "__main__":
    unittest.main()
