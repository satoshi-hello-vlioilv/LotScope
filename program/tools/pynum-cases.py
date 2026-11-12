"""数の読み方の事例表を作る（版 3.75.0。開発用）。答えは同梱と同じ Python（3.13・Unicode 15.1）で焼き付ける。

    python tools/pynum-cases.py            … tests/fixtures/pynum_cases.json を作り直す
    python tools/pynum-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓（desktop/src/pyfmt.rs）は Python の int()・float()・正規表現の \\d・勤務体系の時刻（shifts.hm）と同じ読み方をする約束で、
その約束を 1 つの表にする（Rust の cargo test --test pynum_cases と Python の tests/test_pynum_cases.py が同じ表を読む）。
- digits … Python の \\d が読む 10 進数字（Unicode の Nd）の範囲。0 から始まる並びごと（[はじめ, おわり]）
- cases  … 字ごとの int()（読めなければ null と int_err〈誤りの文〉・i64 に入らなければ桁の字〈版 3.104.0。前は "big"〉）・
            float()（"nan"・"inf"・"-inf" か数・読めなければ null）・\\d+ に全部が当たるか・shifts.hm（0 時からの分か null）
版 3.104.0: str.isspace の全部の字（29 字）を前後に付けた事例と、4,300 桁の上限の事例を足した（int()・float() は U+001C〜U+001F を
空白に読まない。str.strip と \\s は読む）
同梱の Python の版が上がり Unicode の数字が増えたら作り直す（試験が古い表を止める）。
"""
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app.services import shifts  # noqa: E402

OUT = PROGRAM / "tests" / "fixtures" / "pynum_cases.json"
I64 = (-(2 ** 63), 2 ** 63 - 1)


def digit_ranges():
    """\\d が読む字の範囲（0 から 9 へ続く並びを 1 つずつ。数学の太字などの続いた並びは 1 つにまとめる）"""
    out = []
    for n in range(sys.maxunicode + 1):
        c = chr(n)
        if not re.fullmatch(r"\d", c):
            continue
        if out and out[-1][1] == n - 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return out


def _int(s):
    try:
        v = int(s)
    except (ValueError, OverflowError):
        return None
    return v if I64[0] <= v <= I64[1] else str(v)


def _int_err(s):
    try:
        int(s)
    except (ValueError, OverflowError) as e:
        return str(e)
    return None


def spaces():
    """str.isspace の字（Python の int()・float()・strip が見る空白の候補）"""
    return [chr(n) for n in range(sys.maxunicode + 1) if chr(n).isspace()]


def _float(s):
    try:
        v = float(s)
    except (ValueError, OverflowError):
        return None
    if math.isnan(v):
        return "nan"
    if math.isinf(v):
        return "inf" if v > 0 else "-inf"
    return v


def samples(ranges):
    """字の事例: どの数字の系統も 0・9・2 桁・符号つき・時刻、と端の形"""
    xs = []
    for a, b in ranges:
        for start in range(a, b + 1, 10):
            z, n = chr(start), chr(start + 9)
            xs += [z, n, z + n, "-" + n + z, f"{chr(start + 7)}:3{z}", f"1{chr(start + 2)}:{chr(start + 4)}5"]
    xs += ["", " ", "　", "12", " 12 ", "　12　", "+5", "-５", "－5", "1_0", "1__0", "_1", "1_", "1e400", "-1e400", "1e5", "1E-7",
           ".5", "5.", ".", "1.5", "１．５", "١٫٥", "0x10", "12a", "inf", "-Infinity", "+inf", "nan", "NaN", "-nan", "infinity ",
           "²", "³", "½", "Ⅻ", "①", "--5", "+-5", "- 5", "9" * 25, "-" + "9" * 19, "9223372036854775807", "9223372036854775808",
           "1 2", "1\n", "\t7\t", "007", "0", "-0", "+0", "1e", "e5", "1.2.3", "08:15", "8:15", "24:00", "23:59", "7:60", "07:5",
           "２３:５９", "2３:00", "᠑:30", "𑽙:30", "𞓹:45", "12:3４", "1:2:3", ":30", "8:", "008:15"]
    for ch in spaces():
        xs += ["4" + ch, ch + "4" + ch, ch + "1.5"]
    xs += ["1" * 4300, "1" * 4301, "-" + "1" * 4301, "0" * 4301, "1" * 4301 + "x", "1_" * 2150 + "1", "99999999999999999999",
           "-9223372036854775809", "9223372036854775807", "-0009223372036854775808", "+00"]
    return list(dict.fromkeys(xs))


def build():
    ranges = digit_ranges()
    cases = [{"s": s, "int": _int(s), **({"int_err": _int_err(s)} if _int(s) is None else {}), "float": _float(s),
              "d": bool(re.fullmatch(r"\d+", s)), "hm": shifts.hm(s)} for s in samples(ranges)]
    return {"python": sys.version.split()[0], "unicode": unicodedata.unidata_version, "digits": ranges, "cases": cases}


def text(d):
    return json.dumps(d, ensure_ascii=False, indent=1) + "\n"


def main():
    t = text(build())
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else f"違う（python tools/pynum-cases.py で作り直す）: {OUT}")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8")
    d = json.loads(t)
    print(f"{OUT}: 数字の範囲 {len(d['digits'])}・事例 {len(d['cases'])}（Python {d['python']}・Unicode {d['unicode']}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
