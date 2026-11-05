"""本文の数の字の事例表を作る（版 3.77.0。開発用）。答えは同梱と同じ Python（3.13）の json.loads と str() で焼き付ける。

    python tools/jsonnum-cases.py            … tests/fixtures/jsonnum_cases.json を作り直す
    python tools/jsonnum-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓（desktop/src/master_rows.rs の unreadable）は、マスタを書く道の本文を Python と同じに読めないときは答えずに Python に任せる約束で、
その約束を 1 つの表にする（Rust の cargo test --test jsonnum_cases と Python の tests/test_jsonnum_cases.py が同じ表を読む）。
- cases … 数の字ごとに、本文 {"v": 字} を Python の json.loads が読めるか（loads）・値の str()（str。マスタに置く字の元）・型（type）・
           窓が必ず答えるべき物か（plain: 読めて、有限の小数か i64 に入る整数で、整数の -0 でない物）
窓の試験は、窓が答えた物は str() と同じ字で、plain は必ず答え、字の中の数（{"v": "字"}）は数として見ないことを確かめる。
"""
import json
import math
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
OUT = PROGRAM / "tests" / "fixtures" / "jsonnum_cases.json"
I64 = (-(2 ** 63), 2 ** 63 - 1)
LITERALS = [
    "0", "-0", "1", "-1", "7", "12", "-12", "00", "01", "-01", "+1", ".5", "1.", "-", "1e", "1e+", "--1",
    "0.0", "-0.0", "1.0", "-1.5", "0.1", "3.14159", "1.0000000000000002", "123456789.125",
    "1e0", "0e0", "-0e0", "-0E5", "1e5", "1E5", "1e+5", "1e-7", "1E-07", "1e-05", "1e16", "1E+16", "1e17", "1.5e300",
    "1.7976931348623157e308", "1e308", "1e309", "1e400", "-1e400", "5e-324", "2.5e-324", "1e-400",
    "9007199254740993", "123456789012345678", "999999999999999999",
    "9223372036854775807", "-9223372036854775808", "9223372036854775808", "-9223372036854775809",
    "18446744073709551615", "18446744073709551616", "100000000000000000000", "1" + "0" * 40,
    "NaN", "Infinity", "-Infinity", "nan", "inf", "true", "false", "null",
]


def entry(s):
    try:
        v = json.loads('{"v": ' + s + "}")["v"]
    except ValueError:
        return {"s": s, "loads": False, "str": None, "type": None, "plain": False}
    t = type(v).__name__
    plain = (t in ("bool", "NoneType") or (t == "float" and math.isfinite(v))
             or (t == "int" and I64[0] <= v <= I64[1] and not s.startswith("-0")))
    return {"s": s, "loads": True, "str": str(v), "type": t, "plain": bool(plain)}


def build():
    return {"python": sys.version.split()[0], "cases": [entry(s) for s in dict.fromkeys(LITERALS)]}


def text(d):
    return json.dumps(d, ensure_ascii=False, indent=1) + "\n"


def main():
    t = text(build())
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else f"違う（python tools/jsonnum-cases.py で作り直す）: {OUT}")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8")
    d = json.loads(t)
    print(f"{OUT}: 事例 {len(d['cases'])}（Python {d['python']}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
