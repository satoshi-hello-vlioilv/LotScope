"""道の門を当てる欄の表を窓へ焼く（版 3.114.0。開発用）。

    python tools/path-routes.py            … desktop/src/path_routes.json を作り直す
    python tools/path-routes.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓（desktop/src/path_gate.rs）は Python と同じ欄に同じ門を同じ順で当てる。表は services/path_rules.py の ROUTES（道 → [欄, 種類]）と
SKIP（道の字を受けるが、この版では門を当てない道と理由）。tests/test_path_routes.py が古い表と、表に無い道（道の字を受ける部品を
呼ぶのに ROUTES にも SKIP にも無い道）を止める。
"""
import json
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
OUT = PROGRAM.parent / "desktop" / "src" / "path_routes.json"


def build():
    from app.services import path_rules
    return {"about": "道の門を当てる欄（tools/path-routes.py が services/path_rules.py の ROUTES・SKIP から焼く。fields は見る順。"
                     "種類 browse: 「参照…」の欄・dir: 上のフォルダ／いまの置き場・name: フォルダの名前）",
            "routes": [{"method": m, "rule": r, "fields": [list(f) for f in fs]} for (m, r), fs in path_rules.ROUTES.items()],
            "skip": [{"method": m, "rule": r, "why": w} for (m, r), w in path_rules.SKIP.items()]}


def text(d):
    return json.dumps(d, ensure_ascii=False, indent=1) + "\n"


def main():
    t = text(build())
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else f"違う（python tools/path-routes.py で作り直す）: {OUT}")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8", newline="\n")
    print(f"{OUT}: 道 {len(json.loads(t)['routes'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
