"""本文の門を当てる道の表を窓へ焼く（版 3.104.0。開発用）。

    python tools/body-routes.py            … desktop/src/body_routes.json を作り直す
    python tools/body-routes.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓（desktop/src/body.rs）は Python と同じ道に同じ門を当てる。道の当たり方は Python の web.App.dispatch と同じ（道の並び〈変数の少ない道・
固定の字の長い道が先〉で、道の形と方法の両方が合う最初の道）なので、書く方法（POST・PUT・DELETE・PATCH）を持つ道を全部、Python の
並びのまま焼く。門は services/body_rules.py の ROUTES（need・read）、当てない道は skip。版 3.106.0 から欄の型（TYPES）も焼く。tests/test_body_routes.py が古い表を止める。
"""
import json
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
OUT = PROGRAM.parent / "desktop" / "src" / "body_routes.json"
WRITE = ("POST", "PUT", "DELETE", "PATCH")


def build():
    import logging
    from app import create_app
    from app.services import body_rules
    level = logging.root.manager.disable
    logging.disable(logging.CRITICAL)       # アプリを作るときの知らせ（共有に届かない など）は出さない。終わったら戻す（試験の中でも呼ぶ）
    try:
        app = create_app({"TESTING": True})
    finally:
        logging.disable(level)
    rules = []
    for r in app.rules:
        ms = [m for m in WRITE if m in r.methods]
        if ms:
            row = {"rule": r.pattern, "modes": {m: body_rules.mode_of(m, r.pattern) or "skip" for m in ms}}
            types = {m: [list(x) for x in body_rules.TYPES[(m, r.pattern)]] for m in ms if (m, r.pattern) in body_rules.TYPES}
            if types:
                row["types"] = types
            rules.append(row)
    return {"about": "本文の門を当てる道（Python の道の並びのまま。tools/body-routes.py が services/body_rules.py の ROUTES と、"
                     "版 3.106.0 から欄の型の TYPES〈道 → [欄の道, 型] の並び。見る順もこの並び〉から焼く）",
            "rules": rules}


def text(d):
    return json.dumps(d, ensure_ascii=False, indent=1) + "\n"


def main():
    t = text(build())
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else f"違う（python tools/body-routes.py で作り直す）: {OUT}")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8", newline="\n")
    print(f"{OUT}: 道 {len(json.loads(t)['rules'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
