# -*- coding: utf-8 -*-
"""組み込みのダッシュボード（services/dashboard.BUILTIN_LAYOUTS）を、窓（desktop/src/dashboards_write.rs）が持つ表に焼く（版 3.82.0）。

中身の元は Python の BUILTIN_LAYOUTS の 1 か所。窓は焼いた表（desktop/src/dash_builtins.json）を include_str! で持ち、
画面の形（builtin_layouts の答え）と鍵・名前をそのまま使う。BUILTIN_LAYOUTS・board_default を変えたら焼き直す。古い表は tests/test_dash_builtins.py が止める。

    python program/tools/dash-builtins.py           … 焼く
    python program/tools/dash-builtins.py --check   … 焼いた表が今の BUILTIN_LAYOUTS と同じか（違えば終了コード 1）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import dashboard as db  # noqa: E402

OUT = ROOT.parent / "desktop" / "src" / "dash_builtins.json"


def table():
    views = {v["id"][2:]: v for v in db.builtin_layouts()}
    return {"layouts": [{"key": b["key"], "name": b["name"], "view": views[b["key"]]} for b in db.BUILTIN_LAYOUTS]}


def text():
    return json.dumps(table(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def main(argv):
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text()
        print("同じ" if same else f"古い: {OUT} を python program/tools/dash-builtins.py で焼き直してください")
        return 0 if same else 1
    OUT.write_text(text(), encoding="utf-8", newline="\n")
    print(f"焼きました: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
