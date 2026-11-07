# -*- coding: utf-8 -*-
"""設定の束（GET /api/lotlist/settings）を組む決まりを、窓（desktop/src/bundle.rs）が持つ表に焼く（版 3.84.0）。

決まりの元は Python の 1 か所（path_settings.ITEMS・data_sources.BUILTINS ほか・work_log.DEFAULTS・master_store の名前と既定・
master_repository.SPECS の読み替え・ui_defaults.PROFILE_KEYS・identity の使えない PC 名）。窓は焼いた表（desktop/src/bundle_tables.json）を
include_str! で持つ。どれかを変えたら焼き直す。古い表は tests/test_bundle_tables.py が止める。

    python program/tools/bundle-tables.py           … 焼く
    python program/tools/bundle-tables.py --check   … 焼いた表が今の決まりと同じか（違えば終了コード 1）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.repositories import master_store as ms  # noqa: E402
from app.repositories.master_repository import SPECS  # noqa: E402
from app.services import data_join, data_sources, equip_groups, identity, lotdsp_api, path_settings, pivot, presence, ui_defaults, work_log  # noqa: E402
from app.models import DEFAULT_UNWIND  # noqa: E402
import app_build  # noqa: E402

OUT = ROOT.parent / "desktop" / "src" / "bundle_tables.json"
# 束に出る項目（lot_list・work_log・schedule）。exe（trusted_browser）・release・lotdsp_import は束に出ないので窓は写さない
BUNDLE_PREFIXES = ("lot_list.", "work_log.", "schedule.")
MASTERS = ("path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "conversions", "shift_patterns")


def table():
    items = [{k: it[k] for k in ("key", "kind", "min", "max") if k in it} for it in path_settings.ITEMS if it["key"].startswith(BUNDLE_PREFIXES)]
    return {
        "pathItems": items,
        # 束に出ない項目（窓は値を写さない）。ただ、その段が表でない設定に値を重ねると Python は落ちるので、窓も組まない（版 3.84.0）
        "otherItems": [it["key"] for it in path_settings.ITEMS if not it["key"].startswith(BUNDLE_PREFIXES)],
        "sources": {"builtins": data_sources.BUILTINS, "wipDefault": data_sources.WIP_DEFAULT, "readDefaults": data_sources.READ_DEFAULTS,
                    "connBind": data_sources.CONN_BIND, "rowRead": data_sources.ROW_READ, "scheduleJoin": data_sources.SCHEDULE_JOIN,
                    "groupable": sorted(data_sources.GROUPABLE)},
        "join": {"hows": data_join.HOWS, "maxJoins": data_join.MAX_JOINS, "maxKeys": data_join.MAX_KEYS},
        "workDefaults": work_log.DEFAULTS,
        "equipGroups": {"ruleOps": list(pivot.RULE_OPS), "maxRules": equip_groups.MAX_RULES, "setDefault": equip_groups.SET_DEFAULT},
        "store": {"sharedAlways": sorted(ms.SHARED_ALWAYS), "sharedDefault": ["roll_master", "equipment_master"],
                  "lockTtl": ms.LOCK_TTL_DEFAULT, "refresh": ms.REFRESH_DEFAULT, "override": ms.OVERRIDE_FILENAME, "pin": ms.PIN_FILENAME,
                  "moved": ms.MOVED_FILENAME, "movedHops": ms.MOVED_HOPS, "historyKeep": ms.HISTORY_KEEP, "markers": list(ms.MASTER_MARKERS),
                  "presenceSubdir": presence.SUBDIR},
        "renamed": {n: SPECS[n]["renamed"] for n in MASTERS},
        "uselessPcNames": sorted(identity.USELESS_PC_NAMES),
        "uiProfileKeys": list(ui_defaults.PROFILE_KEYS),
        # 版 3.85.0: 画面（GET /）・/api/config・/api/dashboard/sources を窓が答える（desktop/src/page.rs・bundle.rs の config）
        "configItems": [{k: it[k] for k in ("key", "kind") if k in it} for it in path_settings.ITEMS if it["key"] == "lotdsp_import.url"],
        "periods": pivot.PERIODS,
        "defaultUnwind": DEFAULT_UNWIND,
        "lotdsp": {"required": {k: list(v) for k, v in lotdsp_api.REQUIRED.items()}, "minSeen": lotdsp_api.MIN_SEEN,
                   "tieSeen": lotdsp_api.TIE_SEEN},
        "fingerprint": {"exts": list(app_build.EXTS), "skipDirs": list(app_build.SKIP_DIRS)},
    }


def text():
    return json.dumps(table(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def main(argv):
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text()
        print("同じ" if same else f"古い: {OUT} を python program/tools/bundle-tables.py で焼き直してください")
        return 0 if same else 1
    OUT.write_text(text(), encoding="utf-8", newline="\n")
    print(f"焼きました: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
