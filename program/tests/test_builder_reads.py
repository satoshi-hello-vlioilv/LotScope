# -*- coding: utf-8 -*-
"""組む所の読み 7 本（版 3.99.0）の答えを、Python に頼らない独立の答え（tools/builder-truth.py。app を import しない sqlite3 だけ）と比べる。

撮影の試験データ（tools/ui_server.build）に、作業実績の設備を 3 台足し（ZZ3 だけに列「ZZだけの列」・表示する設備は 14 台）、CAL の 速度 を全部
空にしてから（最初の問い合わせの前。写しを読む前）、7 本を Python の道で尋ねる。直した誤り（記録 program/tools/ui-proposals/2026-11-port-builder.json の
確か 1〜11・疑い 1・2・3・6）の 1 つずつに試験が 1 つ以上ある。直す前の Python ではどれも落ちた（記録の built の「直す前に落ちた試験」）。
窓（desktop/src/builder.rs）が同じ答えかは desktop/tests/builder_parity.rs（← tests/builder_oracle.py）が突き合わせる。
"""
import importlib.util
import os
import shutil
import sqlite3
import sys
import time
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM / "tools"))

_spec = importlib.util.spec_from_file_location("builder_truth", PROGRAM / "tools" / "builder-truth.py")
truth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(truth)


def table_of(path):
    with sqlite3.connect(path) as c:
        return [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")][0]


class BuilderReads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.pop("TPA_SHELL", None)
        os.environ.pop("TPA_SHELL_SERVES", None)
        import ui_server
        from app.repositories.master_repository import MasterRepository
        from app.services import work_log
        from app.routes import lotlist
        from app.services import access
        from tests import lotlist_fixture
        # as_role は権限の判定を差し替える（同じプロセスのほかの試験へ漏らさないよう、終わったら戻す）
        cls._saved = (access.flags, lotlist._access_place)
        ui_server.as_role("開発者")
        cls.app = ui_server.build(quality=600, work_rows=120, wip=400)
        cls.W = ui_server.WORK
        cls.c = cls.app.test_client()
        folder = cls.W / "【New】実績"
        # 確か 2: 1 台（CAL）の 速度 を全部空に（最初の問い合わせの前。写す前の元を書き換える）
        cal = folder / "実績_CAL.sqlite3"
        with sqlite3.connect(cal) as k:
            k.execute(f'UPDATE "{table_of(cal)}" SET "速度" = NULL')
        # 作った後の採点: 1 台（CAL）にだけある鍵の列
        with sqlite3.connect(cal) as k:
            t = table_of(cal)
            k.execute(f'ALTER TABLE "{t}" ADD COLUMN "CALだけ" TEXT')
            k.execute(f'UPDATE "{t}" SET "CALだけ" = "ロット番号"')
        # 確か 3: 13 台目からにだけある列（ZZ3 だけ）
        for i in range(1, 4):
            p = folder / f"実績_ZZ{i}.sqlite3"
            lotlist_fixture.make_work(str(p), f"ZZ{i}", n=20)
            if i == 3:
                with sqlite3.connect(p) as k:
                    t = table_of(p)
                    k.execute(f'ALTER TABLE "{t}" ADD COLUMN "ZZだけの列" TEXT')
                    k.execute(f'UPDATE "{t}" SET "ZZだけの列" = \'z\' || rowid')
        repo = MasterRepository(cls.app.config["MASTER_STORE"])
        repo.work_log_sync(work_log.scan(folder, cls.app.config["APP_SETTINGS"]["work_log"]["pattern"]))
        shown = [r for r in work_log.ordered(repo.work_logs()) if str(r.get("表示") or "有") != "無"]
        cls.files = [folder / r["ファイル名"] for r in shown if (folder / r["ファイル名"]).exists()]
        cls.shown = shown
        cls.items = cls.c.get("/api/sources").get_json()["items"]
        cls.wip = next(x["place"] for x in cls.items if x["key"] == "wip")

    @classmethod
    def tearDownClass(cls):
        from app.routes import lotlist
        from app.services import access
        access.flags, lotlist._access_place = cls._saved
        shutil.rmtree(cls.W, ignore_errors=True)

    def fields(self, **q):
        r = self.c.get("/api/dashboard/fields", query_string=q)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return r.get_json()

    # ------------------------------------------------------------------ 札（確か 1〜4・疑い 3・6）
    def test_all_equipment_kinds_are_the_union_of_every_equipment(self):
        """確か 1・2・3: すべての設備の札は、表示する全部の設備（14 台）の値を合わせた種類・値のあった設備だけで決める数・全部の列"""
        self.assertGreater(len(self.files), 12)
        want = truth.fields(self.files, candidates=truth.WORK_TABLES)
        got = {f["column"]: f for f in self.fields(source="work")["fields"]}
        self.assertEqual([c for c in got if not got[c].get("calc")], want["order"], "列の並び（13 台目からの列も）")
        for col, w in want["fields"].items():
            g = got[col]
            self.assertEqual((g["kinds"], g["many"], g["numeric"], bool(g.get("blankOnly"))),
                             (w["kinds"], w["many"], w["numeric"], w["blankOnly"]), col)
        self.assertTrue(got["ロット番号"]["many"], "設備をまたいで 1,001 種類以上")
        self.assertTrue(got["速度"]["numeric"], "CAL だけ空でも、ほかの設備の値で数")

    def test_kinds_use_the_same_values_as_the_slicer_and_blank_only(self):
        """確か 4: n 種類は集計・スライサーと同じ見分け（空欄を 1 つ・0 と '0' を同じ）。全部空欄の列は 0 種類と blankOnly"""
        lot = next(x["place"] for x in self.items if x["key"] == "lot")
        want = truth.fields([lot], candidates=truth.LOT_TABLES)
        got = {f["column"]: f for f in self.fields(source="lot")["fields"]}
        for col, w in want["fields"].items():
            self.assertEqual((got[col]["kinds"], bool(got[col].get("blankOnly"))), (w["kinds"], w["blankOnly"]), col)
        wip = {f["column"]: f for f in self.fields(source="src:wip")["fields"]}
        self.assertEqual((wip["コンマ5本分割_切断巾1"]["kinds"], wip["コンマ5本分割_切断巾1"].get("blankOnly")), (0, True))

    def test_calc_columns_come_after_every_raw_column(self):
        """疑い 3: 計算列は、どの設備の元の列よりも後ろ（2 台目からにだけある列も前）"""
        calc = {"formulas": {"重さ2": "[重量]*2"}, "names": {}}
        r = self.c.post("/api/dashboard/fields", json={"source": "work", "calc": calc}).get_json()
        cols = [f["column"] for f in r["fields"]]
        self.assertLess(cols.index("ZZだけの列"), cols.index("重さ2"))
        self.assertEqual(cols[-1], "重さ2")

    def test_fields_report_progress_per_equipment(self):
        """疑い 6・決め 7: 札の道も待ちの段（GET /api/dashboard/progress）に、読んだ設備 n / 全部 を載せる"""
        self.c.get("/api/dashboard/fields", query_string={"source": "work", "ask": "fields-1"})
        a = self.c.get("/api/dashboard/progress", query_string={"ask": "fields-1"}).get_json()["asks"].get("fields-1")
        self.assertIsNotNone(a, "印の段がある")
        self.assertEqual((a["stage"], a.get("of")), ("read", len(self.files)))

    # ------------------------------------------------------------------ 列と見本（確か 3・8・11）
    def test_data_columns_and_source_columns_use_one_sample_rule(self):
        """確か 11: 値の見本は 2 本の道で同じ（空欄の決まりで選び、見せる字は生の値。'a5052 ' の空白も残す）"""
        dc = self.c.get("/api/data/columns").get_json()["sources"]
        m = next(x for x in self.items if x.get("role") == "マスタ" and "製造条件" in x["name"])
        want = truth.samples([m["place"]])
        a = next(s for s in dc if s["key"] == f"src:{m['key']}")
        b = self.c.get(f"/api/sources/{m['key']}/columns").get_json()
        for col in want["order"]:
            ac = next(x for x in a["columns"] if x["column"] == col)
            self.assertEqual(ac["samples"], want["samples"][col], col)
            self.assertEqual(b["samples"][col], want["samples"][col], col)
        self.assertIn("a5052 ", want["samples"]["材質"])

    def test_work_columns_cover_every_equipment(self):
        """確か 3・8: 作業実績の列（変換表の当てる列・結合の欄）は全部の設備の列と行"""
        dc = next(s for s in self.c.get("/api/data/columns").get_json()["sources"] if s["key"] == "work")
        self.assertIn("ZZだけの列", [x["column"] for x in dc["columns"]])
        b = self.c.get("/api/sources/work/columns").get_json()
        self.assertEqual(b["columns"], truth.samples(self.files, candidates=truth.WORK_TABLES)["order"])
        self.assertEqual(b["rows"], truth.rows_of(self.files, candidates=truth.WORK_TABLES))

    def test_join_preview_counts_every_equipment(self):
        """確か 8・決め 4: 作業実績の「試す」は表示する全部の設備で数えて足し、設備ごとの内訳を答えに書く"""
        wipcols = self.c.get("/api/sources/wip/columns").get_json()["columns"]
        lc = next(x for x in wipcols if "ロット" in x)
        r = self.c.post("/api/sources/join/preview", json={"key": "work", "joins": [{"with": "wip", "on": [["ロット番号", lc]]}]})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        d = r.get_json()
        want = truth.join_try(self.files, self.wip, [("ロット番号", lc)])
        st = d["stats"][0]
        self.assertEqual((st["rows"], st["hit"], st["miss"]), (want["rows"], want["hit"], want["miss"]))
        self.assertEqual(len(d["byEquip"]), len(self.files))
        self.assertEqual(sum(x["stats"][0]["rows"] for x in d["byEquip"]), want["rows"])

    def test_join_preview_skips_equipment_without_the_key(self):
        """作った後の採点: 一部の設備にだけある鍵の列で「試す」と、その設備で数え、ほかの設備は数えずに名前と理由を言う（前は全体が 400）"""
        lc = next(x for x in self.c.get("/api/sources/wip/columns").get_json()["columns"] if "ロット" in x)
        r = self.c.post("/api/sources/join/preview", json={"key": "work", "joins": [{"with": "wip", "on": [["CALだけ", lc]]}]})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        d = r.get_json()
        want = truth.join_try(self.files, self.wip, [("CALだけ", lc)])
        self.assertEqual((d["counted"], d["stats"][0]["rows"], d["stats"][0]["hit"]), (want["counted"], want["rows"], want["hit"]))
        self.assertEqual([x["name"] for x in d["byEquip"]], ["CAL"])
        self.assertEqual(sum(1 for x in d["failed"] if x["kind"] == "join"), len(want["skipped"]))
        self.assertTrue(all("CALだけ" in x["error"] for x in d["failed"] if x["kind"] == "join"))
        r = self.c.post("/api/sources/join/preview", json={"key": "work", "joins": [{"with": "wip", "on": [["無い列", lc]]}]})
        self.assertEqual((r.status_code, r.get_json()["kind"]), (400, "join"), "どの設備でも組めなければ断る")

    # ------------------------------------------------------------------ 確かめる（確か 5・6・7・9・10・疑い 1・2）
    def check(self, **b):
        r = self.c.post("/api/sources/check", json=b)
        self.assertEqual(r.status_code, 200)
        return r.get_json()

    def test_check_counts_the_table_the_list_reads(self):
        """確か 5: 欄の表（table）を数え、その表のロット番号の列を言う"""
        f = self.W / "two.sqlite3"
        with sqlite3.connect(f) as k:
            k.execute('CREATE TABLE "A表"(x, y)')
            k.executemany('INSERT INTO "A表" VALUES (?,?)', [(i, i) for i in range(5)])
            k.execute('CREATE TABLE "B表"("ロット番号", "設備")')
            k.executemany('INSERT INTO "B表" VALUES (?,?)', [(f"L{i}", "CR1") for i in range(9)])
        r = self.check(place=str(f), table="B表", role="品質")
        want = truth.check(f, "B表", "品質")
        self.assertEqual((r["ok"], r["detail"]["table"], r["detail"]["rows"], r["detail"]["lotColumn"]), (True, "B表", want["rows"], "ロット番号"))
        self.assertIn("一覧に使う表: B表・9行", r["message"])

    def test_check_quoted_place_and_equipment_examples(self):
        """確か 6・7: " で括った場所でも設備の列を見る・値の例は空欄を除いて 3 つ（頭に「・」が付かない）"""
        r = self.check(place=f'"{self.wip}"', role="仕掛", equipColumn="残仕掛設備ｺｰｽ")
        self.assertTrue(r["ok"], r["message"])
        ex = r["message"].split("値の例: ")[1].rstrip("。")
        self.assertFalse(ex.startswith("・"))
        self.assertEqual(ex.split("・"), truth.samples([self.wip], candidates=truth.SRC_TABLES)["samples"]["残仕掛設備ｺｰｽ"])

    def test_check_future_mtime_and_stale_warning_by_role(self):
        """確か 10・疑い 1・決め 5: PC の時計より先の更新時刻は 0 時間前。古さの警告は品質・仕掛・実績だけ"""
        f = self.W / "fut.sqlite3"
        shutil.copy(self.wip, f)
        t = time.time() + 1800
        os.utime(f, (t, t))
        r = self.check(place=str(f), role="マスタ")
        self.assertIn("（0時間前）", r["message"])
        self.assertNotIn("-0", r["message"])
        old = self.W / "old.sqlite3"
        shutil.copy(self.wip, old)
        t = time.time() - 40 * 3600
        os.utime(old, (t, t))
        self.assertNotIn("古いファイル", self.check(place=str(old), role="マスタ")["message"])
        self.assertIn("古いファイル", self.check(place=str(old), role="仕掛")["message"])

    def test_cm3_url_check_sees_whether_cm3_answers(self):
        """確か 9・決め 6: スケジュール（CM3）の URL の確かめは CM3 に届くかを見て、CM3 の言葉で言う"""
        url = self.app.config["APP_SETTINGS"]["schedule"]["cm3_base_url"]
        r = self.c.post("/api/sources/sch/conn/check", json={"field": "url", "value": url}).get_json()
        self.assertEqual((r["ok"], "CM3" in r["message"], "LotDsp" in r["message"]), (True, True, False), r)
        r = self.c.post("/api/sources/sch/conn/check", json={"field": "url", "value": "http://127.0.0.1:1"}).get_json()
        self.assertEqual((r["ok"], "CM3 に届きません" in r["message"]), (False, True), r)

    def test_folder_check_uses_the_pattern_on_the_card(self):
        """疑い 2: 作業実績のフォルダの確かめは、カードで打ち替えたファイル名の決まり（本文の pattern）で探す"""
        folder = str(self.W / "【New】実績")
        r = self.c.post("/api/sources/work/conn/check", json={"field": "folder", "value": folder, "pattern": "実績_ZZ*.sqlite3"}).get_json()
        self.assertTrue(r["ok"], r)
        self.assertIn("設備 3 台", r["message"])


if __name__ == "__main__":
    unittest.main()
