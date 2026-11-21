# -*- coding: utf-8 -*-
"""権限の表が共有・写しとも読めない PC で、Python の道が読む道にどう答えるか（版 3.118.0 の作った後の採点の割れ 1。desktop/tests/access_parity.rs の
unreadable_permissions_answer_like_the_frozen_python が呼ぶ）。

    python tests/access_unreadable_answers.py <program の置き場> <場面のフォルダ>

program の置き場は、ふだんは今の program、凍らせた写しを相手にするとき（TPA_FROZEN_PY=1）は program/tests/legacy/<版>（3.117.3 の Python が正）。
場面のフォルダに共有（壊れた access_permissions.json）・この PC の写し（壊れた写し）・同梱の data/ を作り、名乗りを決めて、道ごとの答え
（状態・本文）を JSON で出す。窓の試験は同じフォルダを読む
"""
import json
import os
import shutil
import sys
from pathlib import Path
from unittest import mock

PROG = Path(sys.argv[1]).resolve()
ROOT = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(PROG))
os.environ.pop("TPA_SHELL", None)            # Python が自分で決める道（窓の me を使わない）の答え

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity  # noqa: E402

ROUTES = ["/api/access/me", "/api/masters/access", "/api/ui-defaults", "/api/masters/tabaccess", "/api/presence",
          "/api/masters/shifts", "/api/masters/formats", "/api/masters/equipment", "/api/masters/rolls", "/api/dashboards",
          "/api/dashboard-sets"]


def main():
    share, data, cache = ROOT / "share", ROOT / "app" / "data", ROOT / "local" / "master_cache"
    if ROOT.exists():
        shutil.rmtree(ROOT)
    shutil.copytree(PROG / "data", data, ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
    share.mkdir(parents=True)
    cache.mkdir(parents=True)
    (share / "access_permissions.json").write_text("{", encoding="utf-8")
    (cache / "access_permissions.json").write_text("[", encoding="utf-8")
    (data / "access_permissions.json").unlink(missing_ok=True)
    with mock.patch.object(identity, "current_login_id", lambda: "u1"), \
            mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": "PC-1", "source": "試験", "tried": []}):
        store = MasterStore(ROOT / "app", local_root=ROOT / "local", settings={"refresh_seconds": 0, "dir": str(share)})
        app = create_app({"TESTING": True, "MASTER_STORE": store})
        out = {}
        for path in ROUTES:
            r = app.handle("GET", path, "", {}, b"")
            try:
                body = json.loads(r.get_data())
            except ValueError:
                body = None
            out[f"GET {path}"] = {"status": r.status_code, "body": body}
    print(json.dumps({"root": str(ROOT), "answers": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
