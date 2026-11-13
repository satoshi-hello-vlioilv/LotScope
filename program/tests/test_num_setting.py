"""数の設定の読み方（services/num_setting。版 3.106.0）が事例の表 tests/fixtures/num_setting_cases.json と同じか。
窓は cargo test --lib bundle::tests::num_setting_like_the_table で同じ表を読む。読む所（作業実績・品質の写し・データ元）が同じ部品を使うことも見る。"""
import json
import unittest
from pathlib import Path

from app import lot_list_params
from app.services import data_sources, num_setting, work_log

TABLE = Path(__file__).resolve().parent / "fixtures" / "num_setting_cases.json"


class NumSetting(unittest.TestCase):
    def test_cases(self):
        bad = []
        for c in json.loads(TABLE.read_text(encoding="utf-8"))["cases"]:
            v, ok = num_setting.read(c["value"], c["default"])
            w = "" if ok else num_setting.warn(c["key"], c["value"], c["default"])
            if (v, ok, w) != (c["want"], c["ok"], c["warn"]):
                bad.append(f"{c['name']}: 表 {(c['want'], c['ok'], c['warn'])} / Python {(v, ok, w)}")
        self.assertEqual(bad, [])

    def test_every_reader_defaults_the_same(self):
        """作業実績・品質の写し・データ元が同じ部品で読む（前は品質が float() の ValueError で起動できなかった）"""
        s = {"lot_list": {"refresh_seconds": "12.5", "stale_hours": "abc"}, "work_log": {"stale_hours": "abc", "refresh_seconds": "x"},
             "sources": {"defaults": {"stale_hours": "abc", "refresh_seconds": "   "}}}
        self.assertEqual(lot_list_params(s)[1:], ("12.5", 36))
        wl = work_log.params(s)
        self.assertEqual((wl["stale_hours"], wl["refresh_seconds"]), (36, 60))
        self.assertEqual([(w["field"], w["label"]) for w in wl["settingsWarn"]], [("stale", "古さの警告（時間）"), ("refresh", "確かめる間隔（秒）")])
        self.assertIn("全員の設定ファイルの古さの警告（時間）の値「abc」", wl["settingsWarn"][0]["text"])
        self.assertNotIn("work_log.", wl["settingsWarn"][0]["text"], "技術の鍵は知らせに書かない")
        # 言葉は 1 か所の決まり（num_setting.LABELS）: 接続の段の欄の名前も同じ
        self.assertEqual(data_sources.conn_spec("stale")["label"], num_setting.LABELS["stale"][0])
        self.assertEqual(data_sources.conn_spec("refresh")["label"], num_setting.LABELS["refresh"][0])
        rp = data_sources.read_params(s, "wip")
        self.assertEqual((rp["stale_hours"], rp["refresh_seconds"]), (36, 60))
        lot = data_sources.read_params(s, "lot")
        self.assertEqual((lot["stale_hours"], lot["refresh_seconds"]), (36, "12.5"))

    def test_mirror_reads_a_decimal_interval(self):
        from app.services.db_mirror import DbMirror
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            m = DbMirror("x", "", d, interval_sec="12.5", stale_hours="36")
            self.assertEqual((m.interval >= 1, m.stale_hours), (True, 36.0))
            m.reconfigure(interval_sec="61.9")
            self.assertEqual(m.interval, max(61, m.interval))


if __name__ == "__main__":
    unittest.main()
