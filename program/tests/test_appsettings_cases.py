# -*- coding: utf-8 -*-
"""配った設定の読み方の事例（版 3.112.0。段 ③ の最初・採点の指摘 7・12）: 仕様から人が書いた表 tests/fixtures/appsettings_cases.json を、
Python（path_settings._set の最小の直しの後）が表どおりに答えるか。窓は desktop/tests/appsettings_cases.rs が同じ表を読む。

Python で見るのは want.python だけ: create_app が起きるか（starts）・束（GET /api/lotlist/settings）の組まない節（broken）・
更新の置き場（GET /api/update/settings の source）。段の壊れの言葉（settingsBroken）は窓だけが言う（Python は前の版から答えの形を変えない）。
"""
import json
import logging
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.repositories.master_store import MasterStore

HERE = Path(__file__).resolve().parent
TABLE = json.loads((HERE / "fixtures" / "appsettings_cases.json").read_text(encoding="utf-8"))
ENV = ("TPA_SHELL", "TPA_SHELL_SERVES", "TRANSFER_APP_CONFIG", "TRANSFER_LOCAL_ROOT")


def place(root, c):
    """事例を root に置く（窓の試験と同じ形: share・local・base・config.json）"""
    share, local, base = root / "share", root / "local", root / "base"
    for d in (share, local, base):
        d.mkdir(parents=True, exist_ok=True)
    esc = json.dumps(str(share))[1:-1]
    text = c["configText"] if "configText" in c else json.dumps(c["config"], ensure_ascii=False)
    (root / "config.json").write_text(text.replace("@share", esc), encoding="utf-8")
    if "paths" in c:
        rows = [{**r, "id": i + 1} for i, r in enumerate(c["paths"])]
        (share / "path_settings.json").write_text(json.dumps({"schema": 1, "revision": 3, "updated_at": "", "updated_by": {}, "rows": rows},
                                                             ensure_ascii=False), encoding="utf-8")
    if c.get("remember"):
        (local / "master_share.json").write_text(json.dumps({"dir": str(share)}), encoding="utf-8")
    return share, local, base


class AppSettingsCases(unittest.TestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.saved = {k: os.environ.get(k) for k in ENV}
        self.tmp = Path(tempfile.mkdtemp(prefix="tpa-appsettings-"))

    def tearDown(self):
        logging.disable(logging.NOTSET)
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ask(self, c, root):
        """→ (起きたか, 束, 更新の置き場の答え)"""
        share, local, base = place(root, c)
        os.environ.update({"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,lists,access,presence,ui_state,bundle,release",
                           "TRANSFER_APP_CONFIG": str(root / "config.json"), "TRANSFER_LOCAL_ROOT": str(local)})
        try:
            cfg = json.loads((root / "config.json").read_text(encoding="utf-8-sig"))
            store = MasterStore(base, local_root=local, settings=cfg.get("master_share") if isinstance(cfg, dict) else None)
            app = create_app({"MASTER_STORE": store})
        except Exception:
            return False, None, None
        client = app.test_client()
        r = client.get("/api/lotlist/settings")
        u = client.get("/api/update/settings")
        return True, (r.get_json() if r.status_code == 200 else None), (u.get_json() if u.status_code == 200 else None)

    def test_python_answers_like_the_table(self):
        self.assertGreaterEqual(len(TABLE["cases"]), 50)
        bad = []
        for i, c in enumerate(TABLE["cases"]):
            want = c["want"]["python"]
            with self.subTest(c["name"]):
                started, bundle, upd = self.ask(c, self.tmp / f"c{i}")
                if started != want["starts"]:
                    bad.append(f"{c['name']}: 起きた {started}（表 {want['starts']}）")
                    continue
                if not started:
                    continue
                if "broken" in want:
                    got = sorted(k for k, w in ((bundle or {}).get("broken") or {}).items() if not w.get("warn"))
                    if bundle is None or got != sorted(want["broken"]):
                        bad.append(f"{c['name']}: 組まない節 {got}（表 {sorted(want['broken'])}）")
                if "update" in want and (upd or {}).get("source") != want["update"]:
                    bad.append(f"{c['name']}: 更新の置き場 {(upd or {}).get('source')!r}（表 {want['update']!r}）")
                # 答えに NaN を残さない（jsonify）
                if bundle is not None:
                    json.dumps(bundle, allow_nan=False)
        self.assertEqual(bad, [], "\n".join(bad))

    # 版 3.112.0 の作った後の採点の割れ 3: 段の壊れた配った設定で Python の道が HTML の 500 を返さない（理由つきの JSON）。
    # 当てるのは、窓が中身へ回しうる道と比べる口（採点者の測り g3112/py_probe.py の 13 本に一覧と並びを足した）
    ROUTES = [("GET", "/api/lotlist?page=1"), ("GET", "/api/lotlist/pivot?fields=1"), ("GET", "/api/lotlist/source"),
              ("GET", "/api/dashboard/fields"), ("GET", "/api/data/columns"), ("GET", "/api/masters/equipgroups"),
              ("POST", "/api/settings/check"), ("GET", "/api/sources"), ("GET", "/api/masters/tabaccess"), ("GET", "/api/worklog/files"),
              ("GET", "/api/config"), ("GET", "/api/update/settings"), ("GET", "/api/fs/places"), ("GET", "/api/dashboard/sources"),
              ("GET", "/api/worklog?equip=x"), ("GET", "/api/src/wip")]

    def test_python_routes_answer_json_on_broken_stages(self):
        bad = []
        for i, c in enumerate(TABLE["cases"]):
            w = c["want"]
            if not w["python"]["starts"] or not (w.get("stages") or w.get("broken")):
                continue
            share, local, base = place(self.tmp / f"r{i}", c)
            root = self.tmp / f"r{i}"
            os.environ.update({"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,lists,access,presence,ui_state,bundle,release",
                               "TRANSFER_APP_CONFIG": str(root / "config.json"), "TRANSFER_LOCAL_ROOT": str(local)})
            cfg = json.loads((root / "config.json").read_text(encoding="utf-8-sig"))
            # データ元の写しの係は受け身で、窓へ「写して」と知らせない（知らせると窓の周回を 30 秒待つ。settings_oracle と同じ）
            from app.services import work_log
            mirrors = work_log.Mirrors(local / "db_cache" / "sources", passive=True, prefix="src", notify=None)
            app = create_app({"MASTER_STORE": MasterStore(base, local_root=local, settings=cfg.get("master_share")), "SRC_MIRRORS": mirrors})
            cl = app.test_client()
            for m, path in self.ROUTES:
                r = cl.open(path, method=m, json={} if m == "POST" else None)
                ct = r.headers.get("Content-Type") or ""
                if "json" not in ct or r.status_code == 500:
                    bad.append(f"{c['name']}: {m} {path} {r.status_code} {ct} {r.get_data(as_text=True)[:80]}")
                elif r.status_code == 503 and (r.get_json() or {}).get("kind") == "settings" and "配った設定" not in (r.get_json() or {}).get("error", ""):
                    bad.append(f"{c['name']}: {m} {path} の理由が段を言わない: {r.get_json()}")
        self.assertEqual(bad, [], "\n".join(bad))

    def test_set_skips_a_stage_that_is_not_a_table(self):
        """_set の直し（版 3.112.0）: 段が表でない・null なら重ねずに飛ばす（前は TypeError で create_app が落ちた）"""
        from app.services.path_settings import _set
        for d in ({"update": "x"}, {"update": None}, {"update": [1]}, {"a": {"b": 3}}):
            before = json.dumps(d)
            self.assertFalse(_set(d, "update.source" if "update" in d else "a.b.c", "v"))
            self.assertEqual(json.dumps(d), before)
        d = {}
        self.assertTrue(_set(d, "update.source", "v"))
        self.assertEqual(d, {"update": {"source": "v"}})


if __name__ == "__main__":
    unittest.main()
