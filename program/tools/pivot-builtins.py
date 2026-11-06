# -*- coding: utf-8 -*-
"""組み込みの組み方（services/pivot_presets.BUILTINS）を、窓（desktop/src/pivot_presets.rs）が持つ表に焼く（版 3.81.0）。

中身の元は Python の BUILTINS の 1 か所。窓は焼いた表（desktop/src/pivot_builtins.json）を include_str! で持ち、画面の形
（builtin_views の答え）をそのまま返す。BUILTINS を変えたら焼き直す。古い表は tests/test_pivot_builtins.py が止める。

    python program/tools/pivot-builtins.py           … 焼く
    python program/tools/pivot-builtins.py --check   … 焼いた表が今の BUILTINS と同じか（違えば終了コード 1）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import pivot_presets as pp  # noqa: E402

OUT = ROOT.parent / "desktop" / "src" / "pivot_builtins.json"


def table():
    return {src: pp.builtin_views(src) for src in pp.SOURCES}


def text():
    return json.dumps(table(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def main(argv):
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text()
        print("同じ" if same else f"古い: {OUT} を python program/tools/pivot-builtins.py で焼き直してください")
        return 0 if same else 1
    OUT.write_text(text(), encoding="utf-8", newline="\n")
    print(f"焼きました: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
