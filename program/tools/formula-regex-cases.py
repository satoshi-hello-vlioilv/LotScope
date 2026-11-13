"""式の正規表現（extract・match・regreplace・regcount の第 2 引数）の事例の表を作る（版 3.106.0。開発用。作った後の採点の割れ 4）。

    python tools/formula-regex-cases.py            … tests/fixtures/formula_regex_cases.json を作り直す
    python tools/formula-regex-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

形は設備グループの正規表現の事例（tests/fixtures/equip_regex_cases.json）の全部と、JavaScript の書き方・危うい形・長さの境を足した物。
答えは Python の formula.js_regex（JavaScript の正規表現を Python の re へ写して読む）が読めるか（ok）と、読めないときの理由の言葉（why）。
窓（desktop/src/formula.rs の js_regex）は cargo test --test formula_regex_cases で、どの形も同じに「読める・読めない」と答えるかを確かめる。
割れる形があれば、窓の変換表の道は式の正規表現の読めない形を Python に任せる形に戻す（conversions_write.rs の check_out）。
"""
import json
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
OUT = PROGRAM / "tests" / "fixtures" / "formula_regex_cases.json"

EXTRA = [
    "(", ")", "[", "]", "a{2", "a{2,1}", "a**", "+", "?", "*a", "\\", "a\\", "(?", "(?<", "(?<n>a)\\k<n>", "(?<n>a)(?<n>b)", "(?:a|b)+",
    "\\d{1,3}", "\\p{L}", "\\u0041", "\\x41", "\\cA", "[\\b]", "\\B", "a{,3}", "a{3,}", "[^]", "[]", "[a-]", "[z-a]", "(?i)a", "(?=a)",
    "(?!a)b", "(?<=a)b", "(?<!a)b", "a|", "|", "^$", "\\1", "(a)\\2", "\\0", "\\01", "[\\d-z]", "[\\w-]", ".*.*.*", "(a+)+", "(a*)*b",
    "(a|aa)+$", "\\s+$", "x" * 200, "x" * 201, "\\/", "a/b", "\\.", "[.]", "\\n", "\\t", "\\r\\n", "\\f\\v", "\\$", "\\^", "a{0}",
    "(?<a>x)|(?<b>y)", "(?P<a>x)", "[[]", "[]]", "\\-", "\\Q", "\\E", "\\h", "\\R", "\\X", "(?#c)a", "a(?#", "\\ud800", "😀+",
]


def patterns():
    eq = json.loads((PROGRAM / "tests" / "fixtures" / "equip_regex_cases.json").read_text(encoding="utf-8"))["cases"]
    out = []
    for p in [c["pattern"] for c in eq] + EXTRA:
        if p not in out:
            out.append(p)
    return out


def build():
    from app.services.formula import FormulaError, js_regex
    cases = []
    for p in patterns():
        try:
            js_regex(p)
            cases.append({"pattern": p, "ok": True, "why": ""})
        except FormulaError as e:
            cases.append({"pattern": p, "ok": False, "why": str(e)})
    return {"about": "式の正規表現の事例（tools/formula-regex-cases.py が Python の formula.js_regex から焼く。版 3.106.0）。"
                     "窓は cargo test --test formula_regex_cases で同じに読めるかを確かめる。古い表は tests/test_formula_regex_cases.py が止める",
            "cases": cases}


def text(d):
    return json.dumps(d, ensure_ascii=False, indent=1) + "\n"


def main():
    t = text(build())
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else f"違う（python tools/formula-regex-cases.py で作り直す）: {OUT}")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8", newline="\n")
    d = json.loads(t)
    print(f"{OUT}: {len(d['cases'])} 形（読める {sum(c['ok'] for c in d['cases'])}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
