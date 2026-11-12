# -*- coding: utf-8 -*-
"""壊れた設定・マスタの読み方（版 3.102.0。作った前の採点で見つけた確か 1〜4。記録は tools/ui-proposals/2026-11-port-rest2.json）。

物差し（独立の答え: app に頼らない json.loads・RFC 8259 §8.1・決まりを 1 つずつ当てる compile_rules の考え方）
  ① 配った設定（appsettings.json）が BOM 付きの UTF-8（メモ帳の「UTF-8 (BOM 付き)」）でも読む（確か 4。前は起動できなかった）
  ② 設備グループの決まりのうち 1 つが読めない・重い・窓で写せない書き方でも、その決まりだけを「当てていない（理由）」とし、
     ほかの決まりと除く設備は残す（確か 2。前はグループの決まりが全部黙って消えた）
  ③ 束に効くマスタの 1 行が表でない・ファイルが途中で切れても、そのマスタの道だけが JSON で理由を言い、ほかの道は答え続ける。
     束は engine を黙って python にせず、組めない節を理由（ファイルと行）つきで返す（確か 3・疑い 9）
  ④ 共有の 1 つのマスタが読めない間は、ほかのマスタが取り直せても、マスタの置き場の状態がそのマスタの名前と理由を言い続け、
     そのマスタの source は「cache」（共有が読めず写しで答えている）。書くときも英語の誤りでなく、ファイルの名前で断る（確か 1・疑い 8）
"""
import json
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import app_env
from app import create_app
from app.repositories.master_store import MasterStore
from app.services import equip_groups

ROOT = Path(__file__).resolve().parents[1]
BOM = b"\xef\xbb\xbf"


def readable(path):
    """独立の答え（app を使わない）: JSON として読めるか"""
    try:
        json.loads(Path(path).read_bytes().decode("utf-8-sig"))
        return True
    except ValueError:
        return False


class Env:
    def __init__(self, share=False):
        self.tmp = Path(tempfile.mkdtemp())
        self.base = self.tmp / "app"
        shutil.copytree(ROOT / "data", self.base / "data")
        from app.services.identity import current_login_id
        (self.base / "data" / "access_permissions.json").write_text(json.dumps(
            [{"id": 1, "ログインID": current_login_id(), "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}],
            ensure_ascii=False), encoding="utf-8")
        self.share = self.tmp / "share" if share else None
        if share:
            self.share.mkdir()
        self.store = MasterStore(self.base, local_root=self.tmp / "local",
                                 settings={"dir": str(self.share) if share else "", "refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        self.app = create_app({"MASTER_STORE": self.store, "BASE_DIR": self.base,
                               "APP_SETTINGS": {"lot_list": {"source": "", "table": ""}, "work_log": {"folder": str(self.tmp / "実績")}}})
        self.c = self.app.test_client()

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def data(self, name):
        return self.base / "data" / f"{name}.json"


class Bom(unittest.TestCase):
    def test_settings_with_bom_are_read(self):
        """① メモ帳の「UTF-8 (BOM 付き)」で保存した配った設定を読む（RFC 8259 §8.1: 読む側は BOM を無視してよい）"""
        d = Path(tempfile.mkdtemp())
        try:
            p = d / "appsettings.json"
            p.write_bytes(BOM + json.dumps({"presence": {"heartbeat_interval_seconds": 7}}, ensure_ascii=False).encode("utf-8"))
            self.assertTrue(readable(p), "独立の答えでは読める")
            with mock.patch.dict(os.environ, {"TRANSFER_APP_CONFIG": str(p)}):
                self.assertEqual(app_env.load_settings(d)["presence"]["heartbeat_interval_seconds"], 7)
        finally:
            shutil.rmtree(d, ignore_errors=True)


class Rules(unittest.TestCase):
    def row(self, rules, ex=None):
        return {"ルール": json.dumps({"rules": rules, **({"except": ex} if ex else {})}, ensure_ascii=False)}

    def test_one_heavy_rule_does_not_drop_the_others(self):
        """② 重い正規表現の決まり 1 つだけを外し、ほかの決まりと除く設備は残す"""
        got = equip_groups.rules_of(self.row([{"op": "prefix", "value": "L-"}, {"op": "regex", "value": "(a+)+"}], ["L-9"]))
        self.assertEqual(got["rules"], [{"op": "prefix", "value": "L-"}])
        self.assertEqual(got["except"], ["L-9"])
        self.assertEqual([u["value"] for u in got["unapplied"]], ["(a+)+"])
        self.assertTrue(got["unapplied"][0]["why"], "外した理由")
        v = equip_groups.view({"id": 1, "名称": "L", **self.row([{"op": "prefix", "value": "L-"}, {"op": "regex", "value": "(a+)+"}], ["L-9"])})
        self.assertEqual(equip_groups.members_in(v, ["L-1", "L-9", "CR1"]), ["L-1"])

    def test_forms_the_window_cannot_copy_are_refused_and_not_applied(self):
        """② Python の re と窓（fancy-regex）で当たりが違う 4 形（\\Z・[[:alpha:]]・\\p{…}・\\N{…}）は保存のときに断り、読むときは当てない"""
        for v in ["^L-[0-9]\\Z", "[[:alpha:]]", "\\p{Han}", "\\N{DIGIT ONE}"]:
            with self.subTest(v=v):
                with self.assertRaises(equip_groups.GroupError) as e:
                    equip_groups.clean_rules([{"op": "regex", "value": v}])
                self.assertIn(v, str(e.exception))
                got = equip_groups.rules_of(self.row([{"op": "regex", "value": v}, {"op": "equals", "value": "CAL"}]))
                self.assertEqual(got["rules"], [{"op": "equals", "value": "CAL"}])
                self.assertEqual(got["unapplied"][0]["value"], v)


class BrokenRows(unittest.TestCase):
    def setUp(self):
        self.e = Env()

    def tearDown(self):
        self.e.close()

    def test_a_row_that_is_not_a_table(self):
        """③ 勤務体系に表でない行: 勤務体系の道は JSON で読める行と理由を答え、束はほかの節を組む。ファイルは消さない"""
        p = self.e.data("shift_patterns")
        p.write_text(json.dumps(["壊れた行", {"id": 1, "名称": "交替", "適用設備": "", "区分": "[]"}], ensure_ascii=False), encoding="utf-8")
        before = p.read_bytes()
        r = self.e.c.get("/api/masters/shifts")
        self.assertTrue(r.is_json, r.get_data(as_text=True)[:200])
        b = self.e.c.get("/api/lotlist/settings").get_json()
        self.assertNotEqual(b["engine"], "python", "壊れたマスタで黙って Python に回さない")
        self.assertIn("shifts", b["broken"])
        self.assertIn("shift_patterns.json", b["broken"]["shifts"]["why"])
        self.assertIn("1 行目", b["broken"]["shifts"]["why"])
        self.assertIsNotNone(b["lists"]["sources"], "ほかの節は組む")
        put = self.e.c.post("/api/masters/shifts", json={"name": "x", "equipment": "", "shifts": []})
        self.assertTrue(put.is_json)
        self.assertGreaterEqual(put.status_code, 400, "読めない行のあるマスタは書かない（消さない）")
        self.assertEqual(p.read_bytes(), before, "壊れた行・ファイルは消さない")

    def test_a_truncated_local_file(self):
        """③ 手元の設備マスタが途中で切れた: 設備マスタ・設備グループ・置き場の状態は JSON で理由を言う（HTML の 500 にしない）"""
        p = self.e.data("equipment_master")
        b = p.read_bytes()
        p.write_bytes(b[: len(b) // 2])
        self.assertFalse(readable(p))
        for path in ("/api/masters/equipment", "/api/masters/equipgroups", "/api/masters/status"):
            with self.subTest(path=path):
                r = self.e.c.get(path)
                self.assertTrue(r.is_json, f"{path} {r.status_code} {r.get_data(as_text=True)[:120]}")
                if r.status_code != 200:
                    self.assertIn("equipment_master.json", r.get_json()["error"])
        st = self.e.c.get("/api/masters/status").get_json()
        self.assertIn("equipment_master.json", st["masters"]["equipment_master"]["error"])
        self.assertIn("途中で切れて", st["masters"]["equipment_master"]["error"])
        self.assertNotIn("error", st["masters"]["roll_master"], "ほかのマスタは並べる")


class BrokenShare(unittest.TestCase):
    def test_the_status_keeps_saying_which_master_is_unreadable(self):
        """④ 共有の設備マスタが途中で切れた間に、ほかの PC がロールのマスタを保存しても、状態は設備マスタを言い続ける"""
        e = Env(share=True)
        try:
            e.c.get("/api/masters/status")          # 種まき（共有に最初の版を置く）
            e.c.get("/api/masters/equipment")
            p = e.share / "equipment_master.json"
            b = p.read_bytes()
            p.write_bytes(b[: len(b) // 2])
            time.sleep(0.02)
            st = e.c.get("/api/masters/status").get_json()
            self.assertIn("equipment_master", st["error"])
            q = e.share / "roll_master.json"
            d = json.loads(q.read_text(encoding="utf-8"))
            d["revision"] = int(d.get("revision", 1)) + 1        # ほかの PC が保存した
            q.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            st = e.c.get("/api/masters/status").get_json()
            self.assertFalse(readable(p), "独立の答え: 共有の設備マスタはまだ読めない")
            self.assertIn("equipment_master", st["error"], "取り直せた別のマスタで理由を消さない")
            self.assertEqual(st["masters"]["equipment_master"]["source"], "cache")
            self.assertEqual(st["masters"]["roll_master"]["source"], "shared")
            r = e.c.put("/api/masters/equipment/1", json={"設備名": "x"})
            self.assertGreaterEqual(r.status_code, 400)
            self.assertIn("equipment_master.json", r.get_json()["error"], "書くときもファイルの名前で断る")
            self.assertNotIn("Unterminated", r.get_json()["error"])
            p.write_bytes(b)                           # 直した
            st = e.c.get("/api/masters/status").get_json()
            self.assertEqual(st["error"], "")
            self.assertEqual(st["masters"]["equipment_master"]["source"], "shared")
        finally:
            e.close()


if __name__ == "__main__":
    unittest.main()
