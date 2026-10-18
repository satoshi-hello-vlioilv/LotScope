# -*- coding: utf-8 -*-
"""ダッシュボードの版 3.41.0（利用者の要望 2026-10）の評価関数（サーバーの分）:
1) スライサーの月を送る期間（n か月前）: 月のはじめから終わりまで・名前は「2026年9月」
2) 系列ごとの書式（数値ラベル・線）・スライサーに従わない印・合わせた表の設備グループの見出し（tree・glist）が、保存で消えない／知らない値は外れる
3) スライサーの設備（実際に出てくる設備と、設備グループ〈ルールも〉の入り方）
4) 合わせた表の答えに、設備グループの入り方（表の行の名前で）
画面の分（スライサーの数がサーバーと合う・引いて並べる・四隅・保存の往復）は tools/ui-eval-dashslice.mjs。"""
import unittest

from app.services import dashboard, pivot
from tests.test_dashboard import cell
from tests.test_dashboard_link import WORK, Base


class Month(unittest.TestCase):
    def test_month_back(self):
        r = pivot.period_range
        self.assertEqual(r("month", 1, "2026-10-17"), ("2026-09-01", "2026-09-30"))
        self.assertEqual(r("month", 2, "2026-01-05"), ("2025-11-01", "2025-11-30"), "年をまたぐ")
        self.assertEqual(r("month", 8, "2026-10-31"), ("2026-02-01", "2026-02-28"), "月の長さ")
        self.assertEqual(r("month", 1, "2026-10-17"), r("last_month", 0, "2026-10-17"), "1 か月前＝先月")


class Clean(unittest.TestCase):
    def test_clean_fmt_keeps_calc_and_unit(self):
        """数の計算（expr）と単位（utext。空は単位を出さない）を覚える。使えない字の式は捨てる（版 3.45.0）"""
        f = dashboard.clean_fmt({"expr": "(値-10)×2", "utext": "本/日"})
        self.assertEqual(f, {"expr": "(値-10)×2", "utext": "本/日"})
        self.assertEqual(dashboard.clean_fmt({"utext": ""}), {"utext": ""})
        self.assertIsNone(dashboard.clean_fmt({"expr": "alert(1)"}))
        self.assertEqual(dashboard.clean_fmt({"expr": "÷１０００"}), {"expr": "÷１０００"})

    def test_series_fmt(self):
        f = dashboard.clean_fmt({"series": {"CR1": {"label": "below", "dash": True}, "L-1": {"label": "off"}, "X": {"label": "?"}, "": {"label": "top"}}})
        self.assertEqual(f, {"series": {"CR1": {"label": "below", "dash": True}, "L-1": {"label": "off"}}})

    def test_noslice_and_tree_survive_saving(self):
        b = {**dashboard.board_default(), "id": "b", "x": 0, "y": 0, "w": 6, "h": 4, "visual": "board", "noslice": True}
        b["order"] = {**b["order"], "tree": "ライン別", "glist": ["L ライン", "CR ライン"]}
        k = {"id": "k", "x": 6, "y": 0, "w": 3, "h": 1, "visual": "kpi", "source": "work", "body": {"measures": [{"agg": "lots"}]}, "noslice": "yes"}
        out, _ = dashboard.clean_layout({"rows": 8, "panels": [b, k]})
        self.assertTrue(out["panels"][0]["noslice"])
        self.assertEqual((out["panels"][0]["order"]["tree"], out["panels"][0]["order"]["glist"]), ("ライン別", ["L ライン", "CR ライン"]))
        self.assertNotIn("noslice", out["panels"][1], "True の時だけ")
        b2 = {**b, "rows": {"column": "製造材質"}}
        out, _ = dashboard.clean_layout({"rows": 8, "panels": [b2]})
        self.assertNotIn("tree", out["panels"][0]["order"], "行が設備でなければ見出しにまとめない")


class Api(Base):
    def test_month_period_counts(self):
        """10/16 の「今月」は作業実績 3 本（CR1 2・L-1 1）。1 か月前（9 月）は 0。名前は月"""
        per = {"column": "@workday"}
        d = self.q(visual="kpi", **{**WORK, "body": {"rows": [], "measures": [{"agg": "lots"}]}}, period={**per, "kind": "this_month"})
        self.assertEqual(cell(d, []), [3])
        d = self.q(visual="kpi", **{**WORK, "body": {"rows": [], "measures": [{"agg": "lots"}]}}, period={**per, "kind": "month", "n": 1})
        self.assertIn(cell(d, []), ([0], [None], None))
        self.assertEqual(d["period"]["name"], "2026年9月")
        self.assertEqual(d["period"]["ranges"][0], {"from": "2026-09-01", "to": "2026-09-30"})

    def test_equip_tree(self):
        r = self.c.post("/api/masters/equipgroups", json={"name": "L", "set": "ライン", "equipment": [], "rules": [{"op": "prefix", "value": "L-"}]})
        self.assertEqual(r.status_code, 201, r.get_json())
        self.c.post("/api/masters/equipgroups", json={"name": "CR", "set": "ライン", "equipment": ["CR1"]})
        d = self.c.get("/api/dashboard/equip-tree").get_json()
        self.assertTrue({"CR1", "L-1", "VC"} <= set(d["names"]), "仕掛にだけ出てくる VC も")
        st = next(x for x in d["sets"] if x["name"] == "ライン")
        g = {x["name"]: x["members"] for x in st["groups"]}
        self.assertIn("L-1", g["L"])
        self.assertTrue(all(n.startswith("L-") for n in g["L"]), "ルールに当たる設備だけ")
        self.assertEqual(g["CR"], ["CR1"])

    def test_board_answer_has_tree(self):
        self.c.post("/api/masters/equipgroups", json={"name": "L", "set": "ライン", "equipment": [], "rules": [{"op": "prefix", "value": "L-"}]})
        b = {**dashboard.board_default(), "visual": "board"}
        b["order"] = {**b["order"], "tree": "ライン"}
        d = self.q(**b)
        self.assertIn("tree", d)
        self.assertEqual([x["name"] for x in d["tree"]], ["L"])
        self.assertTrue(set(d["tree"][0]["members"]) <= {"L-1", "L-2", "L-3"} and "L-1" in d["tree"][0]["members"], d["tree"])
        b["order"].pop("tree")
        self.assertNotIn("tree", self.q(**b))


if __name__ == "__main__":
    unittest.main()
