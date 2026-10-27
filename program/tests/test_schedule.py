# -*- coding: utf-8 -*-
"""スケジュール（services/cm3_schedule.py・services/schedule.py・routes/schedule.py。ScheduleView を移した。版 3.57.0）。

評価関数:
  1. 旧版（ScheduleView の Python）の答えの記録（tests/fixtures/schedule_golden.json）と、字の直し・値と列名のそろえ方・整形の誤りが同じ
  2. 作り物の CM3（schedule_fixture）の答えを整えた形: 行の区分・停止の文・点検・文字化け・日付の繰り上がり・開始予定・パス
  3. 本物と同じ HTTP で作り物の CM3 に問い合わせ、一覧の口（/api/src/sch）が答える行が、整えた行と同じ・仕掛と突き合わせた列が
     仕掛のファイルを素直に引いた答え（oracle）と同じ・数（製造件数・一致）が合う
  4. HOT コイル作業順が、整えた行と仕掛のファイルから ScheduleView の決まりを素直に当てた答え（oracle）と同じ（並び・前工程・釜番・除いた数）
  5. 覚え: 同じ中身なら置き直さない・変われば新しい世代・CM3 に届かなくなっても前の予定を出し続け、理由を言う・一度も取れなければ 502
"""
import json
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore
from app.services import cm3_schedule, schedule, work_log
from app.services import data_join as dj
from app.services.db_mirror import DbMirror
from tests import lotlist_fixture, schedule_fixture

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "tests" / "fixtures" / "schedule_golden.json").read_text(encoding="utf-8"))


class OldAnswers(unittest.TestCase):
    """旧版（Python）の答えの記録と同じ。"""

    def test_text_repair(self):
        for raw, want in GOLDEN["text"]:
            self.assertEqual(cm3_schedule.fix_text(raw), want, raw)

    def test_key_and_name(self):
        for raw, want in GOLDEN["normKey"]:
            self.assertEqual(schedule.norm_key(raw), want, raw)
        for raw, want in GOLDEN["normName"]:
            self.assertEqual(schedule.norm_name(raw), want, raw)

    def test_normalize_errors(self):
        for raw, want in GOLDEN["normalizeErrors"]:
            with self.assertRaises(cm3_schedule.Cm3Error) as cm:
                cm3_schedule.normalize(raw, "L-1", [])
            self.assertEqual(str(cm.exception), want)


class Normalize(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.wip = self.tmp / "LOTNOW.sqlite3"
        lotlist_fixture.make_wip(str(self.wip), n=1200)
        self.raw = schedule_fixture.responses(self.wip)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rows(self):
        d = cm3_schedule.normalize(self.raw["L-1"], "L-1", ["点検板"])
        items = d["items"]
        kinds = [i["rowKind"] for i in items]
        self.assertEqual((kinds.count("stop"), kinds.count("inspect")), (2, 1))
        self.assertEqual((d["stopCount"], d["inspectCount"], d["count"]), (2, 1, kinds.count("lot")))
        stops = [i["stopText"] for i in items if i["rowKind"] == "stop"]
        self.assertEqual(stops, [f"{n} {t}" for n, t in (schedule_fixture.STOPS[1], schedule_fixture.STOPS[0])], "切れ端をつなぎ、長さを最後に")
        self.assertIn("缶材", [i["yotoMei"] for i in items], "文字化けを直す")
        self.assertIn("缶 材", [i["yotoMei"] for i in items], "HTML の文字参照（全角空白）を直す")
        # 完了予定は時刻の順で、時刻だけの行の日付の繰り上がりも読む（一度は日を跨ぐ）
        iso = [i["kanryoYoteiIso"] for i in items]
        self.assertTrue(all(iso), "どの行も日時が読める")
        self.assertEqual(iso, sorted(iso))
        self.assertGreater(len({x[:10] for x in iso}), 1, "日を跨ぐ")
        self.assertTrue(any(len(b["kanryoYoteiRaw"]) == 5 and b["kanryoYoteiIso"][:10] != a["kanryoYoteiIso"][:10]
                            for a, b in zip(items, items[1:])), "時刻だけの行で翌日へ繰り上がる")
        # 開始予定は前の行の完了予定
        for a, b in zip(items, items[1:]):
            self.assertEqual(b["startYoteiIso"], a["kanryoYoteiIso"])
        # 同じロットの 2 パス: パスの番号と総パス
        twice = [i for i in items if i["passTotal"] == 2]
        self.assertTrue(twice)
        self.assertEqual(sorted(i["passNo"] for i in twice if i["lotNo"] == twice[0]["lotNo"]), [1, 2])
        self.assertTrue(all(i["selfNext"] for i in twice if i["passNo"] == 1), "1 パス目の次工程は同じ設備")

    def test_table_rows(self):
        d = cm3_schedule.normalize(self.raw["L-2"], "L-2", ["点検板"])
        rows = cm3_schedule.table_rows(d)
        self.assertEqual(len(rows), len(d["items"]))
        named = [dict(zip(cm3_schedule.COLUMN_NAMES, r)) for r in rows]
        self.assertEqual({r["区分"] for r in named}, {"製造", "点検", "設備停止"})
        stop = next(r for r in named if r["区分"] == "設備停止")
        self.assertIsNone(stop["ロットNo"])
        self.assertTrue(stop["停止内容"])
        self.assertRegex(named[0]["完了予定日時"], r"^\d{4}-\d\d-\d\d \d\d:\d\d$")
        self.assertEqual(named[0]["入側板厚"], d["items"][0]["inItaAtsu"], "板厚は CM3 の字のまま")


def oracle_join(items, wip):
    """仕掛（{そろえたロット番号: 行}）を素直に引いた答え: 製造の行ごとに仕掛の行（無ければ None）。"""
    return [wip.get(schedule.norm_key(i["lotNo"])) if i["rowKind"] == "lot" else None for i in items]


def oracle_hot(per_eq, wip, cfg):
    """ScheduleView（app.py の hot_list）の決まりを素直に当てた答え → (並んだ (設備, ロットNo, 前工程, 釜番), 数)"""
    hot = cfg["hot"]
    out, counts = [], {"lots": 0, "noMaster": 0, "otherNext": 0, "laterPass": 0}
    for eq, items in per_eq.items():
        for it in items:
            if it["rowKind"] != "lot":
                continue
            counts["lots"] += 1
            m = wip.get(schedule.norm_key(it["lotNo"]))
            if m is None:
                counts["noMaster"] += 1
                continue
            hist = str(m.get(hot["result_course_column"]) or "").split()
            prev = hist[-1] if hist else ""
            if schedule.norm_key(prev) != schedule.norm_key(hot["prev_value"]):
                continue
            rem = str(m.get(hot["remain_course_column"]) or "").split()
            if rem and schedule.norm_key(rem[0]) != schedule.norm_key(eq):
                counts["otherNext"] += 1
                continue
            if it["passNo"] != 1:
                counts["laterPass"] += 1
                continue
            out.append((it["kanryoYoteiIso"][:16].replace("T", " "), hot["equipments"].index(eq), it["seq"], eq, it["lotNo"], prev,
                        m.get(hot["kama_column"])))
    out.sort()
    return [x[3:] for x in out], counts


class Api(unittest.TestCase):
    """作り物の CM3（HTTP）と仕掛の作り物で、アプリの口を通して確かめる。"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.wip = cls.tmp / "台帳" / "LOTNOW.sqlite3"
        cls.wip.parent.mkdir(parents=True)
        lotlist_fixture.make_wip(str(cls.wip), n=1200)
        schedule_fixture.add_kama(cls.wip)
        cls.answers = schedule_fixture.responses(cls.wip)
        cls.srv, cls.url = schedule_fixture.serve(cls.answers)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.run_dir = Path(tempfile.mkdtemp(dir=self.tmp))
        (self.run_dir / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.run_dir / "app" / "data" / f"{n}.json")
        store = MasterStore(self.run_dir / "app", local_root=self.run_dir / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        self.settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(self.run_dir / "実績")},
                         "sources": {"wip": {"source": str(self.wip), "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}},
                         "schedule": {"cm3_base_url": self.url, "auto_refresh_sec": 60, "timeout_sec": 5}}
        self.sch = schedule.Schedules(self.run_dir / "schedule")
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": self.settings,
                               "LOT_MIRROR": DbMirror("lot_list", "", self.run_dir / "cache"),
                               "WORK_MIRRORS": work_log.Mirrors(self.run_dir / "cache" / "work_log"),
                               "SRC_MIRRORS": work_log.Mirrors(self.run_dir / "cache" / "sources", prefix="src"),
                               "JOINER": dj.Joiner(self.run_dir / "cache" / "joins"), "SCHEDULES": self.sch})
        self.c = self.app.test_client()
        self.cfg = schedule.config(self.settings)
        self.wiprows = self._wip_rows()

    def tearDown(self):
        self.answers.update(schedule_fixture.responses(self.wip))      # 差し替えた答えを戻す

    def _wip_rows(self):
        c = sqlite3.connect(self.wip)
        cur = c.execute("SELECT * FROM 仕掛")
        cols = [d[0] for d in cur.description]
        rows = {schedule.norm_key(r[0]): dict(zip(cols, r)) for r in cur.fetchall()}
        c.close()
        return rows

    def list_of(self, equip, **q):
        r = self.c.get("/api/src/sch", query_string={"equip": equip, "page_size": 1000, **q})
        for _ in range(100):                              # 仕掛をまだ写し終えていない（503 copying）: 写し終えるまで待つ
            if r.status_code != 503:
                break
            time.sleep(0.1)
            r = self.c.get("/api/src/sch", query_string={"equip": equip, "page_size": 1000, **q})
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()

    def norm(self, equip):
        return cm3_schedule.normalize(self.answers[equip], equip, self.cfg["inspect_keywords"])

    def test_meta_and_source_list(self):
        m = self.c.get("/api/schedule").get_json()
        self.assertEqual([e["key"] for e in m["equipments"]], ["L-1", "L-2", "L-3"])
        self.assertEqual(m["hot"]["key"], schedule.HOT_KEY)
        self.assertIn("termkbn=4&setsubi=L-1", m["equipments"][0]["viewUrl"])
        items = {x["key"]: x for x in self.c.get("/api/sources").get_json()["items"]}
        s = items["sch"]
        self.assertEqual((s["name"], s["screen"], s["listed"], s["kind"], s["place"]), ("スケジュール", "src:sch", True, "cm3", self.url))
        self.assertEqual(s["joins"][0]["with"], "wip", "既定は仕掛と結合")

    def test_list_matches_cm3_and_wip(self):
        for eq in ("L-1", "L-3"):
            d = self.list_of(eq)
            want = self.norm(eq)["items"]
            self.assertEqual(d["count"], len(want))
            self.assertEqual(d["lotColumn"], "ロットNo")
            self.assertEqual(d["table"], "予定")
            rows = sorted(d["rows"], key=lambda r: r["No"])
            self.assertEqual([r["No"] for r in rows], [i["seq"] for i in want], "CM3 の並びのまま")
            self.assertEqual([r["ロットNo"] or "" for r in rows], [i["lotNo"] for i in want])
            self.assertEqual([r["区分"] for r in rows], [cm3_schedule.KIND_LABEL[i["rowKind"]] for i in want])
            # 仕掛と突き合わせた列（既定の結合: ロットNo = 仕掛のロット番号の列〈この作り物は「ロット番号」〉）
            got = [(r.get("残仕掛設備ｺｰｽ"), r.get("実績_設備ｺｰｽ"), r.get("製造調質")) for r in rows]
            ref = [(m["残仕掛設備ｺｰｽ"], m["実績_設備ｺｰｽ"], m["製造調質"]) if m else (None, None, None) for m in oracle_join(want, self.wiprows)]
            self.assertEqual(got, ref)
            sm = d["schedule"]["summary"]
            lots = [i for i in want if i["rowKind"] == "lot"]
            hit = sum(1 for m in oracle_join(want, self.wiprows) if m)
            self.assertEqual((sm["count"], sm["lots"], sm["stop"], sm["inspect"], sm["hit"]),
                             (len(lots), len({i["lotNo"] for i in lots}), 2, 1, hit))
            self.assertLess(hit, len(lots), "仕掛に無いロットがある（Z9999X0）")
        # 並べ替え・絞り込みはほかの一覧と同じ口で効く
        f = json.dumps([{"column": "区分", "op": "eq", "value": "設備停止"}])
        self.assertEqual(self.list_of("L-2", filters=f)["count"], 2)

    def test_hot_matches_the_rule(self):
        d = self.list_of(schedule.HOT_KEY)
        per = {eq: self.norm(eq)["items"] for eq in self.cfg["hot"]["equipments"]}
        want, counts = oracle_hot(per, self.wiprows, self.cfg)
        self.assertGreater(len(want), 0, "作り物に前工程が HOT のロットがある")
        rows = sorted(d["rows"], key=lambda r: r["HOT順"])
        self.assertEqual([(r["設備"], r["ロットNo"], r["前工程"], r["釜番"]) for r in rows], want)
        self.assertEqual(d["schedule"]["hot"]["counts"], counts)
        self.assertEqual(d["columns"][:9], ["HOT順", "設備", "開始予定", "完了予定", "No", "ロットNo", "パス", "前工程", "釜番"])
        self.assertTrue(all(r["釜番"] for r in rows), "釜番は仕掛の 設計_PIT炉番炉順")

    def test_cache_generations_and_unreachable(self):
        a = self.sch.ensure(self.cfg, "L-1")
        b = self.sch.ensure(self.cfg, "L-1", force=True)
        self.assertEqual(a["path"], b["path"], "中身が同じなら置き直さない")
        self.assertGreaterEqual(b["checkedAt"], a["checkedAt"])
        changed = json.loads(json.dumps(self.answers["L-1"]))
        changed["entity"]["meisaiList"] = changed["entity"]["meisaiList"][3:]
        self.answers["L-1"] = changed
        c = self.sch.ensure(self.cfg, "L-1", force=True)
        self.assertNotEqual(c["path"], a["path"], "変わったら新しい世代")
        self.assertFalse(Path(a["path"]).exists(), "前の世代は消す")
        # 届かなくなった: 前の予定のまま、理由を言う
        bad = {**self.cfg, "cm3_base_url": "http://127.0.0.1:9"}
        d = self.sch.ensure(bad, "L-1", force=True)
        self.assertEqual(d["path"], c["path"])
        self.assertIn("CM3に接続できません", d["error"])
        info = schedule.source_info(bad, d, "L-1")
        self.assertTrue(info["unreachable"] and info["mirrored"])
        # 一度も取れていない設備は 502（理由つき）
        self.settings["schedule"]["cm3_base_url"] = "http://127.0.0.1:9"
        r = self.c.get("/api/src/sch", query_string={"equip": "L-2"})
        self.assertEqual(r.status_code, 502)
        self.assertIn("L-2 の予定を CM3 から取れません", r.get_json()["error"])
        r = self.c.get("/api/src/sch", query_string={"equip": "X-9"})
        self.assertEqual(r.status_code, 400)

    def test_same_equipment_is_fetched_once_at_a_time(self):
        calls = []

        def slow(cfg, code, kbn, kws):
            calls.append(code)
            time.sleep(0.3)
            return cm3_schedule.normalize(self.answers[code], code, kws)
        s = schedule.Schedules(self.run_dir / "slow", fetch=slow)
        ts = [threading.Thread(target=s.ensure, args=(self.cfg, "L-1")) for _ in range(5)]
        t0 = time.time()
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(calls, ["L-1"], "後から来た問い合わせは先の答えを使う")
        calls.clear()
        got = s.ensure_many(self.cfg, ["L-2", "L-3"])
        self.assertEqual(sorted(calls), ["L-2", "L-3"])
        self.assertLess(time.time() - t0, 0.3 * 3 + 0.25, "HOT の設備は同時に取りに行く")
        self.assertTrue(all("path" in v for v in got.values()))

    def test_source_and_refresh(self):
        self.list_of("L-1")
        s = self.c.get("/api/src/sch/source", query_string={"equip": "L-1"}).get_json()
        self.assertEqual((s["kind"], s["mirrored"], s["unreachable"]), ("cm3", True, False))
        self.assertEqual(time.strftime("%Y/%m/%d %H:%M", time.localtime(s["at"])),
                         time.strftime("%Y/%m/%d %H:%M", time.localtime(self.answers["L-1"]["entity"]["updateTs"] / 1000)))
        r = self.c.post("/api/src/sch/refresh", query_string={"equip": "L-1"})
        self.assertEqual(r.status_code, 200, r.get_json())
        h = self.c.get("/api/src/sch/source", query_string={"equip": schedule.HOT_KEY}).get_json()
        self.assertEqual(h["kind"], "cm3")

    def test_saved_join_follows_the_wip_lot_column(self):
        """結合を保存した後も（既定ではなくなっても）、仕掛の鍵の列名の違い（ﾛｯﾄ番号／ロット番号）を吸収して当たる。データ元の欄の様子も出る"""
        self.list_of("L-1")
        joins = [{"with": "wip", "how": "left", "on": [["ロットNo", "ﾛｯﾄ番号"]], "cols": ["残仕掛設備ｺｰｽ"]}]
        r = self.c.put("/api/sources/sch", json={"結合": joins, "base_rev": 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        items = {x["key"]: x for x in self.c.get("/api/sources").get_json()["items"]}
        self.assertFalse(items["sch"].get("joinsDefault"))
        self.assertEqual((items["sch"]["equipCount"], items["sch"]["mirror"]["mirrored"]), (3, True))
        d = self.list_of("L-1")
        self.assertIn("残仕掛設備ｺｰｽ", d["columns"])
        self.assertNotIn("製造調質", d["columns"], "持ってくる列は保存した物だけ")
        hit = sum(1 for m in oracle_join(self.norm("L-1")["items"], self.wiprows) if m)
        self.assertEqual(d["schedule"]["summary"]["hit"], hit)

    def test_settings_shape(self):
        c = schedule.config({"schedule": {"equipments": "L-1、L-9:2 ,L-1", "inspect_keywords": "点検板, テスト材", "hot": {"equipments": "L-9, X"}}})
        self.assertEqual([(e["code"], e["term_kbn"]) for e in c["equipments"]], [("L-1", "4"), ("L-9", "2")])
        self.assertEqual(c["inspect_keywords"], ["点検板", "テスト材"])
        self.assertEqual(c["hot"]["equipments"], ["L-9"], "HOT の設備は登録した設備だけ")


if __name__ == "__main__":
    unittest.main()
