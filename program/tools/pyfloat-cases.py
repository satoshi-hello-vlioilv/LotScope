"""小数の字の事例表を作る（版 3.80.0。開発用）。答えは同梱と同じ Python（3.13）の repr と json.dumps で焼き付ける。

    python tools/pyfloat-cases.py            … tests/fixtures/pyfloat_cases.json を作り直す
    python tools/pyfloat-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓の小数の書き手（desktop/src/pyfmt.rs の float_repr と join.rs の py_dumps）が、Python の repr・json.dumps と同じ字を書くかを、
1 つの表で突き合わせる（Rust の cargo test --test pyfloat_cases と Python の tests/test_pyfloat_cases.py が同じ表を読む）。
- cases … [ビット（16 進）, repr, json.dumps]。値は、いちばん短い字が 2 つ並ぶ丁度まん中の値（2^48〜2^57 に .125〜.875 を足した値。
          Rust の {:e} は上へ、Python は偶数へ丸める）・字の書き方が変わる境（1e-05〜0.0001・1e16）・10 の累乗・決まった乱数のビット・
          -0.0・いちばん小さい数（5e-324）・いちばん大きい数
"""
import json
import random
import struct
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
OUT = PROGRAM / "tests" / "fixtures" / "pyfloat_cases.json"


def values():
    vs = [1059438285926254.25, 0.0, -0.0, 5e-324, -5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 0.1, 0.2, 0.3, 1 / 3, 2 / 3, 100.0, 1.5, -2.25]
    for k in range(48, 58):                      # 丁度まん中の値（いちばん短い字が 2 つ並ぶ）
        for frac in (0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875):
            for base in (2 ** k, 2 ** k + 1, 2 ** k + 7, 3 * 2 ** (k - 1)):
                vs.append(float(base) + frac)
    for e in range(-330, 309):                   # 10 の累乗と、その前後
        for m in (1.0, 1.5, 9.999999999999999, 2.5):
            try:
                vs.append(float(f"{m}e{e}"))
            except OverflowError:
                pass
    for e in (-6, -5, -4, -3, 15, 16, 17):        # 字の書き方（指数かどうか）が変わる境
        for d in range(1, 10):
            vs.append(float(f"{d}e{e}"))
            vs.append(float(f"{d}.5e{e}"))
    rng = random.Random(20261106)                # 決まった乱数のビット（NaN・inf を除く）
    while len(vs) < 6000:
        f = struct.unpack("<d", struct.pack("<Q", rng.getrandbits(64)))[0]
        if f == f and abs(f) != float("inf"):
            vs.append(f)
    seen, out = set(), []
    for f in vs:
        if f != f or abs(f) == float("inf"):     # float("9.9e308") は例外を出さずに inf になる。有限の数だけを入れる
            continue
        b = struct.pack("<d", f).hex()
        if b not in seen:
            seen.add(b)
            out.append(f)
    return out


def build():
    cases = [[struct.pack(">d", f).hex(), repr(f), json.dumps(f)] for f in values()]
    return {"python": sys.version.split()[0], "cases": cases}


def main():
    new = build()
    if "--check" in sys.argv:
        have = json.loads(OUT.read_text(encoding="utf-8"))
        sys.exit(0 if have["cases"] == new["cases"] else 1)
    OUT.write_text(json.dumps(new, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"{OUT}: {len(new['cases'])} 件")


if __name__ == "__main__":
    main()
