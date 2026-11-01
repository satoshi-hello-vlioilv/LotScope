"""計算列の式の事例表を作る（版 3.59.0。開発用）。答えは画面の式（static/js/list-formula.js）を node で動かして焼き付ける。

    python tools/formula-cases.py            … tests/fixtures/formula_cases.json を作り直す
    python tools/formula-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

事例表は、式の 3 つの実装の約束（画面 list-formula.js・Python services/formula.py・Rust desktop/src/formula.rs）。
- 事例: tests/test_formula_parity.py の書いた例と作った例（corpus）＋ tests/test_conversions.py の変換表の事例（conv）
- 答え: 画面の答え（ok・value・text・error）。Rust の cargo test と Python の試験は、node 無しでこの表と突き合わせる
- 関数を足した・作った例の作り方（rnd_expr）を変えた・画面の答えが変わったときは作り直す（tests/test_formula_parity.py が古い表を止める）
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from tests import test_conversions, test_formula_parity  # noqa: E402

OUT = PROGRAM / "tests" / "fixtures" / "formula_cases.json"
TOOL = PROGRAM / "tools" / "formula-parity.mjs"
CONV_STEP = 37          # 変換表の事例は 37 おき（test_conversions.ScreenGivesTheSameAnswer と同じ）


def _one(op, inp="text", **kw):
    """条件 1 つの表（当たれば「当」、当たらなければ「外」）"""
    return {"inputs": [{"name": "x", "type": inp}], "rows": [{"when": {"x": [{"op": op, **kw}]}, "out": "当"}], "other": "外"}


# 変換表の条件を 1 つずつ試す表（版 3.59.0。同梱のプリセットに無い条件も: nends・ncontains・filled・数の ne・含まない範囲）
OP_TABLES = {
    "試_eq": _one("eq", v=["A5052", "10"]), "試_eq数": _one("eq", "num", v=["10", "2.5"]), "試_ne数": _one("ne", "num", v=["10"]),
    "試_starts": _one("starts", v=["L", "", "ＣＲ"]), "試_nstarts": _one("nstarts", v=["L"]), "試_ends": _one("ends", v=["C4", "c"]),
    "試_nends": _one("nends", v=["C4"]), "試_contains": _one("contains", v=["01", "空白"]), "試_ncontains": _one("ncontains", v=["0"]),
    "試_empty": _one("empty"), "試_filled": _one("filled"), "試_range": _one("range", min="1", max="10"),
    "試_range外": _one("range", min=1, max="10", minInc=False, maxInc=False), "試_range片": _one("range", min="", max="2.5"),
    "試_式": {"inputs": [{"name": "x", "type": "text"}, {"name": "y", "type": "num"}],
             "rows": [{"when": {"x": [{"op": "starts", "v": ["L"]}], "y": [{"op": "range", "min": "0"}]}, "out": "=[x] + '-' + [y]"},
                      {"when": {"x": [{"op": "eq", "v": ["x"]}]}, "out": "=left("}], "other": "=[y] * 2"},
}


def cases():
    out = test_formula_parity.corpus()
    for name, vals, _ in test_conversions.cases()[::CONV_STEP]:
        out.append({"expr": f"conv('{name}', " + ", ".join(f"[v{i}]" for i in range(len(vals))) + ")",
                    "row": {f"v{i}": v for i, v in enumerate(vals)}})
    values = [v for v in test_formula_parity.VALUES if not isinstance(v, str) or "\n" not in v][:40]
    for name in OP_TABLES:
        n = 2 if name == "試_式" else 1
        for v in values:
            out.append({"expr": f"conv('{name}', " + ", ".join(f"[v{i}]" for i in range(n)) + ")", "row": {f"v{i}": v for i in range(n)}})
    return out


def build():
    """→ 事例表（dict）。画面の答えは node で出す"""
    cs, tables = cases(), {**test_conversions.TABLES, **OP_TABLES}
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "cases.json"
        src.write_text(json.dumps({"cases": cs, "tables": tables}, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run(["node", str(TOOL), str(src)], capture_output=True, text=True, encoding="utf-8", timeout=300, check=False)
    if r.returncode != 0:
        raise SystemExit(f"node で画面の式を動かせませんでした: {r.stderr}")
    js = json.loads(r.stdout)
    return {"about": "計算列の式の事例表（画面 list-formula.js の答え）。作り直すのは python program/tools/formula-cases.py。"
                     "片割れのサロゲート（UTF-16 の単位 1 つだけの字）を含む答えの字は {\"utf16\": [単位]} で書く（UTF-8 に書けないため）",
            "tables": tables, "cases": [{**c, "js": {k: units_if_lone(v) for k, v in a.items()}} for c, a in zip(cs, js)]}


def lone(s):
    """片割れのサロゲート（U+D800〜U+DFFF の 1 字）を含むか（JavaScript の字は UTF-16 の単位なので、切り出すと生まれる）"""
    return isinstance(s, str) and any("\ud800" <= ch <= "\udfff" for ch in s)


def units_if_lone(v):
    if not lone(v):
        return v
    b = v.encode("utf-16-le", "surrogatepass")
    return {"utf16": [int.from_bytes(b[i:i + 2], "little") for i in range(0, len(b), 2)]}


def plain(v):
    """事例表の値 → Python の字（{"utf16": […]} は片割れのサロゲートを含む字に戻す）"""
    if isinstance(v, dict) and isinstance(v.get("utf16"), list):
        return b"".join(int(u).to_bytes(2, "little") for u in v["utf16"]).decode("utf-16-le", "surrogatepass")
    return v


def text(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n"


def main():
    new = text(build())
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == new
        print("事例表は今の画面の答えと同じです" if same else "事例表が古くなっています（python program/tools/formula-cases.py で作り直す）")
        return 0 if same else 1
    OUT.write_text(new, encoding="utf-8")
    n = len(json.loads(new)["cases"])
    print(f"{OUT.relative_to(PROGRAM.parent)}: {n:,} 件・{len(new.encode('utf-8')):,} バイト")
    return 0


if __name__ == "__main__":
    sys.exit(main())
