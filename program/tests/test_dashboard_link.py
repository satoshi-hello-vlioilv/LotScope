# -*- coding: utf-8 -*-
"""ダッシュボードの版 3.40.0（利用者の要望 2026-10）の評価関数:
1) 設備を複数選んで「まとめない」とき、勝手に合算しない（設備ごとの系列・設備ごとに並べる。合算は選んだときだけ）
2) 行・列に「設備」（とその上の設備グループ）を置ける
3) 別のデータを合わせる（軸の値でそろえる・そのまま／積み上げ・目標と実績・差）
4) 設備グループで選べる設備が、実際に出てくる設備（作業実績・設備マスタ・データ元の設備の列）と合う・ルールで決めるグループ
5) 設備グループごとの小計（設備グループの段＋設備の段＋小計）
数はどれも、試験のデータ（tests/test_dashboard.py の Api: 仕掛 3 ロット・作業実績 CR1〈10/15 に 2 本〉・L-1〈10/14 に 1 本〉）を素朴に数えた数と比べる。"""
import sqlite3
import time
import unittest
from datetime import datetime

from app.services import equip_groups, pivot
from tests.test_dashboard import Api, cell


class Base(unittest.TestCase):
    """試験のデータは tests/test_dashboard.py の Api と同じ（Api の試験は引き継がない）"""
    tearDown = Api.tearDown

    def setUp(self):
        Api.setUp(self)
        c = sqlite3.connect(self.wip)        # 作業実績にも設備マスタにも無い設備 VC が仕掛にだけ出てくる（利用者の画面の VC・QF・TUR と同じ形）
        c.execute("INSERT INTO 仕掛 VALUES ('A4', 'VC 3', 'A1100')")
        c.commit()
        c.close()
        self.app.config["DASHBOARD_NOW"] = datetime(2026, 10, 16, 10, 0)

    def q(self, **panel):
        for _ in range(40):            # 写しが無ければ写し終えるまで
            r = self.c.post("/api/dashboard/query", json={"panel": panel})
            d = r.get_json()
            if r.status_code != 503 or d.get("kind") != "copying":
                break
            time.sleep(0.1)
        self.assertEqual(r.status_code, 200, d)
        return d


WORK = {"source": "work", "body": {"rows": [{"column": "@workday"}], "measures": [{"agg": "lots"}]}}


class Split(Base):
    def test_two_equips_are_not_summed(self):
        """要望 1: 設備を 2 つ選んで「まとめない」なら、設備ごとの系列（列の段の頭に設備）。前の版は 10/15 の CR1 2 本と 10/14 の L-1 1 本を合わせていた"""
        d = self.q(visual="column", equips=["CR1", "L-1"], **WORK)
        self.assertEqual(d["esplit"], "series")
        self.assertEqual(d["dims"]["cols"][0]["column"], "@equip")
        self.assertEqual(cell(d, ["2026-10-15"], ["CR1"]), [2])
        self.assertEqual(cell(d, ["2026-10-14"], ["L-1"]), [1])
        self.assertIsNone(cell(d, ["2026-10-15"], ["L-1"]), "L-1 の 10/15 は 0（CR1 の数が混ざらない）")

    def test_all_equips_stay_as_before(self):
        """設備を選ばない（すべて）パネル（組み込みの標準）は、今までどおり 1 つ（合算）"""
        d = self.q(visual="column", **WORK)
        self.assertNotIn("esplit", d)
        self.assertEqual(d["dims"]["cols"], [])
        self.assertEqual(cell(d), [3])

    def test_sum_only_when_chosen(self):
        d = self.q(visual="column", equips=["CR1", "L-1"], esplit="sum", **WORK)
        self.assertEqual((d["esplit"], d["dims"]["cols"], cell(d)), ("sum", [], [3]))

    def test_facets(self):
        """「並べる」: 設備ごとの答え（表を分ける）。表し方（割合）は設備ごとの計で"""
        body = {"rows": [{"column": "@workday"}], "measures": [{"agg": "lots", "show": "pct_total"}]}
        d = self.q(visual="none", source="work", equips=["CR1", "L-1"], esplit="facet", body=body)
        self.assertEqual([f["name"] for f in d["facets"]], ["CR1", "L-1"])
        cr1, l1 = (f["answer"] for f in d["facets"])
        self.assertEqual(cell(cr1, ["2026-10-15"]), [100.0], "CR1 の中の割合（全体の 2/3 ではない）")
        self.assertEqual(cr1["orders"][0], ["2026-10-15"], "その設備の日だけ")
        self.assertEqual(cell(l1, ["2026-10-14"]), [100.0])

    def test_kpi_splits_into_facets(self):
        """数字の形は系列を描けないので、設備ごとに並べる"""
        d = self.q(visual="kpi", source="work", equips=["CR1", "L-1"], body={"rows": [], "measures": [{"agg": "lots"}]})
        self.assertEqual([(f["name"], cell(f["answer"])) for f in d["facets"]], [("CR1", [2]), ("L-1", [1])])

    def test_equip_dim_already_there(self):
        """要望 2: 行・列に設備を置いたなら、それで分かれる（重ねて分けない）"""
        d = self.q(visual="none", source="work", equips=["CR1", "L-1"], body={"rows": [{"column": "@equip"}], "measures": [{"agg": "lots"}]})
        self.assertNotIn("esplit", d)
        self.assertEqual((cell(d, ["CR1"]), cell(d, ["L-1"])), ([2], [1]))


class Groups(Base):
    def put_group(self, **body):
        r = self.c.post("/api/masters/equipgroups", json=body)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()

    def test_choosable_equipment_is_what_appears(self):
        """要望 4: 選べる設備＝実際に出てくる設備（作業実績 CR1・L-1 ＋ 仕掛の設備の列から見分けた VC）。前の版は作業実績の設備だけ"""
        d = self.c.get("/api/masters/equipgroups").get_json()
        self.assertTrue({"CR1", "L-1", "VC"} <= set(d["equipments"]), d["equipments"])
        vc = next(x for x in d["seen"] if x["name"] == "VC")
        self.assertEqual((vc["from"], vc["n"]), (["仕掛"], 1), "どこで見たか・何件か")
        cr1 = next(x for x in d["seen"] if x["name"] == "CR1")
        self.assertIn("作業実績", cr1["from"])
        self.assertIn("仕掛", cr1["from"])

    def test_rule_group(self):
        """ルール（名前が L- で始まる・V を含む）で決めたグループ。除く設備は入らない。matched はいま当てはまる設備"""
        d = self.put_group(name="L と V", set="ライン", equipment=[], rules=[{"op": "prefix", "value": "l-"}, {"op": "contains", "value": "V"}])
        g = next(x for x in d["items"] if x["name"] == "L と V")
        # 設備マスタの L-2・L-3・TLV も出てくる設備（data/equipment_master.json）
        self.assertTrue({"L-1", "VC"} <= set(g["matched"]) and "CR1" not in g["matched"], "大文字・小文字を見ない")
        self.assertTrue(all(n.startswith("L-") or "V" in n for n in g["matched"]), g["matched"])
        d = self.c.put(f"/api/masters/equipgroups/{g['id']}", json={"except": ["VC"], "rules": g["rules"], "equipment": [], "base_rev": g["rev"]}).get_json()
        after = next(x for x in d["items"] if x["id"] == g["id"])["matched"]
        self.assertTrue("L-1" in after and "VC" not in after, after)
        r = self.c.post("/api/masters/equipgroups", json={"name": "壊れ", "set": "ライン", "rules": [{"op": "regex", "value": "("}]})
        self.assertEqual(r.status_code, 400, "読めない正規表現は断る")
        r = self.c.post("/api/masters/equipgroups", json={"name": "空", "set": "ライン", "equipment": [], "rules": []})
        self.assertEqual(r.status_code, 400, "設備もルールも無いグループは置かない")

    def test_rules_count_in_panels(self):
        """ルールのグループで合算（パネルの「設備グループのマスタから合算」）"""
        self.put_group(name="L", set="ライン", equipment=[], rules=[{"op": "prefix", "value": "L-"}])
        d = self.q(visual="none", source="src:wip", egroup={"mode": "master", "set": "ライン", "rest": "keep"},
                   body={"rows": [{"column": "@equip"}], "measures": [{"agg": "lots"}]})
        self.assertEqual((cell(d, ["L"]), cell(d, ["CR1"])), ([2], [1]))

    def test_subtotals_by_group(self):
        """要望 5: 設備グループの段＋設備の段＋小計。グループに入らない設備は「グループなし」（後ろ）"""
        self.put_group(name="CR 系", set="ライン", equipment=["CR1"])
        self.put_group(name="L 系", set="ライン", equipment=[], rules=[{"op": "prefix", "value": "L-"}])
        d = self.q(visual="none", source="src:wip", body={"rows": [{"column": "@egroup", "part": "ライン"}, {"column": "@equip"}],
                                                        "measures": [{"agg": "lots"}], "sub": True})
        self.assertEqual(d["orders"][0], ["CR 系", "L 系", pivot.NO_GROUP_KEY])
        self.assertEqual(d["labels"][0][pivot.NO_GROUP_KEY], pivot.NO_GROUP)
        self.assertEqual((cell(d, ["CR 系"]), cell(d, ["L 系"]), cell(d, ["L 系", "L-1"]), cell(d, [pivot.NO_GROUP_KEY]), cell(d)), ([1], [2], [2], [1], [4]),
                         "総計は全部（グループなしの鍵が空だと、画面で総計と取り違えた）")
        self.assertEqual(d["dims"]["rows"][0]["name"], "設備グループ（ライン）")

    def test_sub_is_kept_for_tables(self):
        from app.services import dashboard
        p = dashboard.clean_panel({"visual": "none", "source": "work", "body": {"rows": [{"column": "@egroup", "part": "x"}, {"column": "@equip"}], "sub": True}}, 0, 8)
        self.assertTrue(p["body"]["sub"])
        p = dashboard.clean_panel({"visual": "column", "source": "work", "body": {"rows": [{"column": "@equip"}], "sub": True}}, 0, 8)
        self.assertFalse(p["body"]["sub"], "グラフ・段が 1 つなら小計は無い")

    def test_members_in(self):
        g = {"equipment": ["CR1"], "rules": [{"op": "suffix", "value": "-1"}, {"op": "regex", "value": "^T.V$"}], "except": ["L-1"]}
        self.assertEqual(equip_groups.members_in(g, ["CR1", "L-1", "K-1", "TLV", "TL"]), ["CR1", "K-1", "TLV"])


class Link(Base):
    TARGET = {"role": "target", "source": "src:wip", "key": {"column": "@equip"}, "measure": {"agg": "lots"}}
    ACTUAL = {"role": "actual", "source": "work", "key": {"column": "@equip"}, "measure": {"agg": "lots"}}

    def test_align_by_key_with_roles(self):
        """要望 3: 仕掛（目標）と作業実績（実績）を設備でそろえる。差（実績−目標）と達成率も"""
        d = self.q(visual="diag45", source="work", link={"sides": [self.TARGET, self.ACTUAL], "extra": ["diff", "rate"]}, body={})
        self.assertEqual([m["role"] for m in d["measures"]], ["target", "actual", "diff", "rate"])
        self.assertTrue(d["measures"][0]["name"].startswith("目標："), d["measures"][0]["name"])
        self.assertEqual(cell(d, ["CR1"]), [1, 2, 1, 200.0])
        self.assertEqual(cell(d, ["L-1"]), [2, 1, -1, 50.0])
        self.assertEqual(cell(d, ["VC"])[:3], [1, None, None], "片方にしか無い軸の値も行に出す")
        self.assertEqual(cell(d)[:2], [4, 3])
        self.assertEqual([x["role"] for x in d["link"]["sides"]], ["target", "actual"])

    def test_cumulative_on_days(self):
        """積み上げ: 日の古い順に足す。日（作業日）と日付の列の年月日は同じ鍵でそろう"""
        day = {"source": "work", "key": {"column": "@workday"}, "measure": {"agg": "lots"}}
        d = self.q(visual="line", source="work", body={}, link={"sides": [{**day, "role": "target", "build": "as"}, {**day, "role": "actual", "build": "cum"}]})
        self.assertEqual(d["orders"][0], ["2026-10-14", "2026-10-15"])
        self.assertEqual([cell(d, [k]) for k in d["orders"][0]], [[1, 1], [2, 3]])
        self.assertEqual(cell(d), [3, 3], "積み上げの計は最後の値")
        self.assertIn("（積み上げ）", d["measures"][1]["name"])

    def test_one_side_broken(self):
        bad = {**self.TARGET, "key": {"column": "無い列"}}
        d = self.q(visual="diag45", source="work", body={}, link={"sides": [bad, self.ACTUAL]})
        self.assertIn("無い列", d["link"]["sides"][0]["error"])
        self.assertEqual(cell(d, ["CR1"]), [None, 2])

    def test_needs_two_sides_and_keys(self):
        for link in ({"sides": [self.TARGET]}, {"sides": [self.TARGET, {**self.ACTUAL, "key": None}]}):
            r = self.c.post("/api/dashboard/query", json={"panel": {"visual": "diag45", "source": "work", "body": {}, "link": link}})
            self.assertEqual(r.status_code, 400, link)
