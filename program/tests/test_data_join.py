# -*- coding: utf-8 -*-
"""データ元の結合（services/data_join.py・routes/sources.py。版 3.53.0）。

評価関数: 小さな表どうしを 4 つの方式（内部・左外部・右外部・完全外部）と複数の鍵で合わせ、答えの行を
Python で素直に組んだ答え（oracle）と突き合わせる。鍵の比べ方（空欄・数・全角・大小）、列の名前のぶつかり、
数（当たった・当たらない・相手だけ・相手の鍵の重なり）、組み直し（元が変わったときだけ）、
一覧・スライサー・集計表・ダッシュボードの口が結合した答えを読むこと、役割「マスタ」を確かめる。"""
import json
import os
import shutil
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import data_join as dj
from app.services import data_sources as ds
from app.services import work_log
from app.services.db_mirror import DbMirror
from tests import lotlist_fixture

ROOT = Path(__file__).resolve().parents[1]


def make(path, table, cols, rows):
    c = sqlite3.connect(path)
    c.execute(f"CREATE TABLE {table} (" + ",".join(f'"{x}"' for x in cols) + ")")
    c.executemany(f"INSERT INTO {table} VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    c.commit()
    c.close()


def read(path, table):
    c = sqlite3.connect(path)
    cur = c.execute(f'SELECT * FROM "{table}"')
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    c.close()
    return cols, rows


def oracle(left, right, on, how, bring):
    """素直な答え: 行ごとに鍵を比べ方の値にして、二重の繰り返しで合わせる（並びは問わない）。相手の列は "R:列" に置く。"""
    def k(r, cols):
        return tuple(dj.join_key(r[c]) for c in cols)

    lk, rk = [a for a, _ in on], [b for _, b in on]
    out = []
    for lr in left:
        hits = [i for i, rr in enumerate(right) if None not in k(lr, lk) and k(lr, lk) == k(rr, rk)]
        for i in hits:
            out.append({**lr, **{"R:" + c: right[i][c] for c in bring}})
        if not hits and how in ("left", "full"):
            out.append({**lr, **{"R:" + c: None for c in bring}})
    if how in ("right", "full"):
        lkeys = {k(lr, lk) for lr in left}
        for i, rr in enumerate(right):
            if None not in k(rr, rk) and k(rr, rk) not in lkeys:
                row = {c: None for c in left[0]}
                row.update({a: rr[b] for a, b in on})
                row.update({"R:" + c: rr[c] for c in bring})
                out.append(row)
    return out


def canon(rows):
    return sorted(json.dumps(r, ensure_ascii=False, sort_keys=True, default=str) for r in rows)


class JoinKey(unittest.TestCase):
    def test_same_value_rules(self):
        self.assertEqual(dj.join_key(" 54"), dj.join_key(54))
        self.assertEqual(dj.join_key("054"), dj.join_key(54.0))
        self.assertEqual(dj.join_key("Ａ１"), dj.join_key("a1"))
        self.assertEqual(dj.join_key(" H24 "), "H24")
        self.assertIsNone(dj.join_key(""))
        self.assertIsNone(dj.join_key("  "))
        self.assertIsNone(dj.join_key(None))
        self.assertNotEqual(dj.join_key("1.5"), dj.join_key("15"))


class Build(unittest.TestCase):
    LEFT_COLS = ["ロット番号", "合金", "調質", "重量"]
    LEFT = [("L1", "5052", "H34", 10), ("L2", "5052", "h34 ", 20), ("L3", "1100", "O", 30), ("L4", "3004", "H19", 40),
            ("L5", "", "O", 50), ("L6", 5052, "H34", 60)]
    RIGHT_COLS = ["材質", "質別", "圧延速度", "重量"]
    RIGHT = [("5052", "H34", 120, 1), ("1100", "O", 80, 2), ("1100", "O", 85, 3), ("8079", "O", 60, 4), ("", "O", 10, 5)]
    ON = [["合金", "材質"], ["調質", "質別"]]

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.l, self.r = self.tmp / "l.sqlite3", self.tmp / "r.sqlite3"
        make(self.l, "品質", self.LEFT_COLS, self.LEFT)
        make(self.r, "条件", self.RIGHT_COLS, self.RIGHT)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def left_rows(self):
        return [dict(zip(self.LEFT_COLS, r)) for r in self.LEFT]

    def right_rows(self):
        return [dict(zip(self.RIGHT_COLS, r)) for r in self.RIGHT]

    def test_four_ways_agree_with_the_oracle(self):
        for how in dj.HOWS:
            with self.subTest(how=how):
                dest = self.tmp / f"{how}.sqlite3"
                items = dj.parse([{"with": "m", "how": how, "on": self.ON, "cols": ["圧延速度", "重量"]}])
                stats = dj.build(dest, self.l, "品質", items, [(self.r, "条件", "条件")])
                cols, rows = read(dest, "品質")
                self.assertEqual(cols, self.LEFT_COLS + ["圧延速度", "重量（条件）"], "同じ名前の列は「列（相手の名前）」")
                want = oracle(self.left_rows(), self.right_rows(), self.ON, how, ["圧延速度", "重量"])
                want = [{**{c: w[c] for c in self.LEFT_COLS}, "圧延速度": w["R:圧延速度"], "重量（条件）": w["R:重量"]} for w in want]
                self.assertEqual(canon(rows), canon(want))
                self.assertEqual(stats[0]["out"], len(want))

    def test_counts_tell_hits_misses_right_only_and_duplicates(self):
        st = dj.build(self.tmp / "o.sqlite3", self.l, "品質", dj.parse([{"with": "m", "on": self.ON}]), [(self.r, "条件", "条件")])[0]
        self.assertEqual((st["rows"], st["hit"], st["miss"]), (6, 4, 2), "L1・L2（空白と小文字）・L6（数）・L3 が当たる")
        self.assertEqual((st["rightRows"], st["rightHit"], st["rightOnly"], st["rightDup"]), (5, 3, 2, 1), "1100/O が 2 行ある")
        self.assertEqual(st["out"], 7, "1100/O の L3 は 2 行になる")
        self.assertIn(["3004", "H19"], st["missSample"])
        self.assertEqual(st["columns"], ["圧延速度", "重量（条件）"], "鍵の相手の列を除いた全部")

    def test_chained_joins_and_bad_columns(self):
        e = self.tmp / "e.sqlite3"
        make(e, "設備", ["名前", "速度上限"], [("5052", 900)])
        items = dj.parse([{"with": "m", "on": self.ON, "cols": ["圧延速度"]}, {"with": "e", "how": "inner", "on": [["合金", "名前"]]}])
        st = dj.build(self.tmp / "c.sqlite3", self.l, "品質", items, [(self.r, "条件", "条件"), (e, "設備", "設備")])
        cols, rows = read(self.tmp / "c.sqlite3", "品質")
        self.assertEqual(cols[-2:], ["圧延速度", "速度上限"])
        self.assertEqual(sorted(r["ロット番号"] for r in rows), ["L1", "L2", "L6"], "2 つ目は内部結合で 5052 だけ")
        self.assertEqual(len(st), 2)
        with self.assertRaises(dj.JoinError):
            dj.build(self.tmp / "x.sqlite3", self.l, "品質", dj.parse([{"with": "m", "on": [["無い列", "材質"]]}]), [(self.r, "条件", "条件")])
        self.assertFalse((self.tmp / "x.sqlite3").exists(), "組めなければ半端なファイルを残さない")

    def test_clean_and_describe(self):
        known = {"m": "条件", "lot": "品質データ"}
        self.assertEqual(dj.clean("", "lot", known), "")
        with self.assertRaises(dj.JoinError):
            dj.clean([{"with": "lot", "on": self.ON}], "lot", known)
        with self.assertRaises(dj.JoinError):
            dj.clean([{"with": "zz", "on": self.ON}], "lot", known)
        with self.assertRaises(dj.JoinError):
            dj.clean([{"with": "m", "on": []}], "lot", known)
        text = dj.clean([{"with": "m", "how": "??", "on": self.ON + [["", "x"]]}], "lot", known)
        self.assertEqual(json.loads(text), [{"with": "m", "how": "left", "on": self.ON, "cols": []}], "知らない方式は左外部・空の鍵は捨てる")
        self.assertEqual(dj.describe(dj.parse(text), known), "条件 を左外部結合（合金 = 材質・調質 = 質別）")
        self.assertEqual(dj.parse("{壊れた"), [])

    def test_joiner_rebuilds_only_when_a_file_changes(self):
        j = dj.Joiner(self.tmp / "joins")
        items = dj.parse([{"with": "m", "on": self.ON}])
        p1, _ = j.path_for("lot", self.l, "品質", items, [(self.r, "条件", "条件")])
        t1 = os.stat(p1).st_mtime_ns
        time.sleep(0.02)
        p2, _ = j.path_for("lot", self.l, "品質", items, [(self.r, "条件", "条件")])
        self.assertEqual((p1, os.stat(p2).st_mtime_ns), (p2, t1), "変わっていなければ組み直さない")
        c = sqlite3.connect(self.r)
        c.execute("INSERT INTO 条件 VALUES ('3004', 'H19', 99, 9)")
        c.commit()
        c.close()
        p3, st = j.path_for("lot", self.l, "品質", items, [(self.r, "条件", "条件")])
        self.assertEqual(st[0]["hit"], 5, "相手が変わったら組み直す")
        p4, _ = j.path_for("lot", self.l, "品質", dj.parse([{"with": "m", "how": "inner", "on": self.ON}]), [(self.r, "条件", "条件")])
        self.assertNotEqual(p3, p4)
        self.assertFalse(p3.exists(), "前の決まりのファイルは消す")


class Api(unittest.TestCase):
    """仕掛（製造材質・製造調質）に、足した「製造条件マスタ」（材質・調質の 2 つの鍵）を合わせる。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.wip = self.tmp / "台帳" / "LOTNOW.sqlite3"
        self.wip.parent.mkdir(parents=True)
        lotlist_fixture.make_wip(str(self.wip), n=300)
        c = sqlite3.connect(self.wip)
        pairs = c.execute("SELECT DISTINCT 製造材質, 製造調質 FROM 仕掛 ORDER BY 1, 2").fetchall()
        c.close()
        self.pairs = pairs
        self.mst = self.tmp / "台帳" / "製造条件.sqlite3"
        make(self.mst, "条件", ["材質", "調質", "圧延速度"], [(a, b, 100 + i) for i, (a, b) in enumerate(pairs[1:])])   # 最初の組だけ無い
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(self.tmp / "実績")},
                    "sources": {"wip": {"source": str(self.wip), "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}}}
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": settings,
                               "LOT_MIRROR": DbMirror("lot_list", "", self.tmp / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "work_log"),
                               "SRC_MIRRORS": work_log.Mirrors(self.tmp / "cache" / "sources", prefix="src"),
                               "JOINER": dj.Joiner(self.tmp / "cache" / "joins")})
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def items(self):
        return {x["key"]: x for x in self.c.get("/api/sources").get_json()["items"]}

    def add_master(self):
        r = self.c.post("/api/sources", json={"表示名": "製造条件マスタ", "場所": str(self.mst), "役割": "マスタ"})
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()["row"]["キー"]

    def test_master_role_goes_under_the_master_tab(self):
        key = self.add_master()
        it = self.items()[key]
        self.assertEqual((it["role"], it["group"], it["listed"]), ("マスタ", "mst", True))
        self.assertEqual(self.items()["wip"]["group"], "")
        self.assertIn("マスタ", self.c.get("/api/sources").get_json()["roles"])
        self.assertEqual(self.c.get(f"/api/src/{key}").get_json()["count"], len(self.pairs) - 1)

    def test_join_is_saved_previewed_and_read_by_every_view(self):
        key = self.add_master()
        joins = [{"with": key, "how": "left", "on": [["製造材質", "材質"], ["製造調質", "調質"]], "cols": ["圧延速度"]}]
        cols = self.c.get(f"/api/sources/{key}/columns").get_json()
        self.assertEqual(cols["columns"], ["材質", "調質", "圧延速度"])
        self.assertTrue(cols["samples"]["材質"])
        pv = self.c.post("/api/sources/join/preview", json={"key": "wip", "joins": joins})
        self.assertEqual(pv.status_code, 200, pv.get_json())
        st = pv.get_json()["stats"][0]
        a, b = self.pairs[0]
        con = sqlite3.connect(self.wip)
        missing = con.execute("SELECT COUNT(*) FROM 仕掛 WHERE 製造材質 = ? AND 製造調質 = ?", (a, b)).fetchone()[0]
        con.close()
        self.assertEqual((st["rows"], st["miss"], st["hit"]), (300, missing, 300 - missing))
        self.assertEqual(st["columns"], ["圧延速度"])
        self.assertEqual(self.c.get("/api/src/wip", query_string={"page_size": 1}).get_json()["columns"][-1:] != ["圧延速度"], True,
                         "保存するまでは一覧に効かない")
        r = self.c.put("/api/sources/wip", json={"結合": joins, "設備の列": "残仕掛設備ｺｰｽ", "設備の取り出し方": "前方一致", "base_rev": 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        it = self.items()["wip"]
        self.assertEqual(it["joins"], joins)
        self.assertEqual(it["joinText"], "製造条件マスタ を左外部結合（製造材質 = 材質・製造調質 = 調質）")
        d = self.c.get("/api/src/wip", query_string={"page_size": 500}).get_json()
        self.assertEqual((d["count"], d["table"]), (300, "仕掛"))
        self.assertIn("圧延速度", d["columns"])
        self.assertEqual(sum(1 for r in d["rows"] if r["圧延速度"] is None), missing)
        s = self.c.get("/api/src/wip/slicer", query_string={"column": "圧延速度"}).get_json()
        self.assertEqual(sum(v["count"] for v in s["values"]), 300)
        f = json.dumps([{"column": "圧延速度", "op": "not_empty", "value": ""}])
        self.assertEqual(self.c.get("/api/src/wip", query_string={"filters": f}).get_json()["count"], 300 - missing, "持ってきた列で絞れる")
        p = self.c.get("/api/src/wip/pivot", query_string={"rows": '[{"column":"圧延速度"}]', "measures": '[{"agg":"count"}]'})
        self.assertEqual(p.status_code, 200, p.get_json())

    def test_bad_joins_are_refused_with_a_reason(self):
        key = self.add_master()
        r = self.c.put("/api/sources/wip", json={"結合": [{"with": key, "on": []}], "base_rev": 0})
        self.assertEqual(r.status_code, 400)
        self.assertIn("鍵", r.get_json()["error"])
        r = self.c.put("/api/sources/wip", json={"結合": [{"with": "work", "on": [["a", "b"]]}], "base_rev": 0})
        self.assertEqual(r.status_code, 400, "作業実績は相手にできない")
        self.c.put("/api/sources/wip", json={"結合": [{"with": key, "on": [["無い列", "材質"]]}], "base_rev": 0})
        d = self.c.get("/api/src/wip")
        self.assertEqual((d.status_code, d.get_json()["kind"]), (400, "join"))
        self.assertIn("無い列", d.get_json()["error"])

    def test_check_needs_a_lot_column_only_for_quality_data(self):
        ok = self.c.post("/api/sources/check", json={"place": str(self.mst), "role": "マスタ"}).get_json()
        self.assertTrue(ok["ok"], ok)
        self.assertNotIn("ロット番号", ok["message"])
        self.assertFalse(self.c.post("/api/sources/check", json={"place": str(self.mst), "role": "品質"}).get_json()["ok"])

    def test_roles_include_master(self):
        self.assertIn("マスタ", ds.ROLES)


if __name__ == "__main__":
    unittest.main()
