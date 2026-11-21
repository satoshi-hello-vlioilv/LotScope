# -*- coding: utf-8 -*-
"""共有のマスタを、ふつうの配った設定の Python で読む（版 3.112.0 の作った後の採点の割れ 6b。desktop/tests/appsettings_cases.rs が呼ぶ）。

    python tests/share_reader_oracle.py 配った設定.json この PC の作業場所

壊れた配った設定の窓（3.112.0）が書いた共有を、前の版の読み手（ふつうの設定の Python。共有の形は 3.111.0 と同じ）が読み、束を節の壊れ
なしに組めるか → {"status", "broken"}
"""
import json
import logging
import os
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))


def main():
    logging.disable(logging.CRITICAL)
    cfg, local = Path(sys.argv[1]), Path(sys.argv[2])
    local.mkdir(parents=True, exist_ok=True)
    os.environ.update({"TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist,lists,access,presence,ui_state,bundle,release",
                       "TRANSFER_APP_CONFIG": str(cfg), "TRANSFER_LOCAL_ROOT": str(local)})
    from app import create_app
    from app.repositories.master_store import MasterStore
    from app.services import work_log
    settings = json.loads(cfg.read_text(encoding="utf-8"))
    base = local / "base"
    base.mkdir(exist_ok=True)
    app = create_app({"MASTER_STORE": MasterStore(base, local_root=local, settings=settings.get("master_share")),
                      "SRC_MIRRORS": work_log.Mirrors(local / "src", passive=True, prefix="src", notify=None)})
    r = app.test_client().get("/api/lotlist/settings")
    body = r.get_json(silent=True) or {}
    json.dump({"status": r.status_code, "broken": {k: v for k, v in (body.get("broken") or {}).items() if not v.get("warn")}}, sys.stdout,
              ensure_ascii=False)


if __name__ == "__main__":
    main()
