"""式の正規表現（extract・match・regreplace・regcount の第 2 引数）の事例の表を作る（版 3.106.0。開発用。作った後の採点の割れ 4）。

    python tools/formula-regex-cases.py            … tests/fixtures/formula_regex_cases.json を作り直す
    python tools/formula-regex-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

形は設備グループの正規表現の事例（tests/fixtures/equip_regex_cases.json）の全部と、JavaScript の書き方・危うい形・長さの境を足した物。
答えは Python の formula.js_regex（JavaScript の正規表現を Python の re へ写して読む）が読めるか（ok）と、読めないときの理由の言葉（why）、
画面の JavaScript（list-formula.js の reOf: 長さ・regexRisk・new RegExp。tools/formula-regex-js.mjs を node で）が読めるか（js。版 3.113.0）。
正しい答え（want）は画面の JavaScript の答え js（版 3.113.0 の作った後の採点の割れ 4・7 (d) から: 画面の regexRisk が後読みの決まり
〈後読みの中身の枝ごとに長さが決まる〉も見るので、画面が読む形はサーバーも計算できる形）。Python の答え ok からは作らない。
後読みの形は、人が仕様から決めた答え（SPEC_LOOKBEHIND）と js が同じことを焼くときに確かめる（違えば焼かない）。
Python は枝の長さの違う後読み (?<=L|CR) を枝ごとの後読みに書き替えて読む（formula.split_lookbehind。前は re が断り、窓は Python に任せた）。
窓（desktop/src/formula.rs の js_regex）は cargo test --test formula_regex_cases で、どの形も want と同じに「読める・読めない」と答えるかを確かめる。
node が無いときは js を今の表から読む（表に無い形があれば作り直せない）。
"""
import subprocess
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
    # 版 3.113.0（採点の指摘 5）: 後読みの枝の長さ・入れ子・否定・組・字の組の中の |
    "(?<!L|CR)\\d", "(?<=(?:L|CR))\\d", "(?<=x(?:L|CR))\\d", "(?<=L|CR|ABC)\\d", "(?<=(L)|(CR))\\d", "(?<=L|C{2})\\d",
    "(?<=[AB]|CD)\\d", "(?<=[|]|ab)c", "(?<=a\\|b|cd)e", "(?<=L|CR", "(?<=(?<=a|bc)x|y)z", "(?<!a+|b)c", "(?<=L|)\\d",
    "(?<=(L|CR))\\d", "(?<=(?:(?:L|CR)))\\d", "(?<=(?:L|CR)|x)\\d", "(?<=(?<n>L|CR))\\d", "(?<!(?:L|CR))\\d", "(?<=(?:L|CR)+)\\d",
    "(?<=(?:L)|CR)\\d", "(?<=(?:L|(?:C|DE)))\\d", "(?<=a(?:b|cd)e)f", "(?<=[AB]|(?:C|DE))\\d",
    "(?<=x(?:L|C))y", "(?<=a{2,2})b", "(?<=a{2,})b", "(?<=a?)b", "(?<=(?:ab){2})x", "(?<=(?:a|bc){2})x", "(?<=\\k<n>)x", "(?<=(?<=a|bc)b)c",
]


# 後読みの形の決め（人が仕様から書いた: 中身全部を包むだけの (?: ) を外し、| で分けた枝ごとに長さが決まる〈* + ? {n,m} {n,}・\1 などの
# 引き直しが無い・かっこの中の | は同じ長さ〉なら読む。枝どうしの長さは違ってよい）
SPEC_LOOKBEHIND = {
    "(?<=L)S": True, "(?<=L|CR)\\d": True, "(?<!L|CR)\\d": True, "(?<=L|CR|ABC)\\d": True, "(?<=(L)|(CR))\\d": True, "(?<=L|C{2})\\d": True,
    "(?<=[AB]|CD)\\d": True, "(?<=(?:L|CR))\\d": True, "(?<=(?:(?:L|CR)))\\d": True, "(?<!(?:L|CR))\\d": True, "(?<=(?:L)|CR)\\d": True,
    "(?<=x(?:L|C))y": True, "(?<=a{2,2})b": True, "(?<=(?:ab){2})x": True, "(?<=\\k<n>)x": True, "(?<=(?<=a|bc)b)c": True, "(?<=L|)\\d": True,
    "(?<=L+)\\d": False, "(?<=a{1,2})b": False, "(?<=(L)\\1)": False, "(?<=x(?:L|CR))\\d": False, "(?<=(L|CR))\\d": False,
    "(?<=(?:L|CR)|x)\\d": False, "(?<=(?<n>L|CR))\\d": False, "(?<!a+|b)c": False, "(?<=(?:L|CR)+)\\d": False, "(?<=(?:L|(?:C|DE)))\\d": False,
    "(?<=a(?:b|cd)e)f": False, "(?<=[AB]|(?:C|DE))\\d": False, "(?<=a{2,})b": False, "(?<=a?)b": False, "(?<=(?:a|bc){2})x": False,
}


def patterns():
    eq = json.loads((PROGRAM / "tests" / "fixtures" / "equip_regex_cases.json").read_text(encoding="utf-8"))["cases"]
    out = []
    for p in [c["pattern"] for c in eq] + EXTRA:
        if p not in out:
            out.append(p)
    return out


def js_answers(pats):
    """画面の JavaScript の答え {pattern: (js, why)}。node が無ければ今の表から"""
    try:
        r = subprocess.run(["node", str(PROGRAM / "tools" / "formula-regex-js.mjs")], input=json.dumps(pats), capture_output=True,
                           text=True, encoding="utf-8", timeout=120)
        if r.returncode == 0:
            return {x["pattern"]: (x["js"], x["why"]) for x in json.loads(r.stdout)}
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    old = json.loads(OUT.read_text(encoding="utf-8"))["cases"] if OUT.exists() else []
    have = {c["pattern"]: (c["js"], c.get("jsWhy", "")) for c in old if "js" in c}
    missing = [p for p in pats if p not in have]
    if missing:
        raise SystemExit(f"node が無く、表に無い形の JavaScript の答えが分かりません: {missing[:5]}")
    return have


def build():
    from app.services.formula import FormulaError, js_regex
    pats = patterns()
    js = js_answers(pats)
    cases = []
    for p in pats:
        try:
            js_regex(p)
            c = {"pattern": p, "ok": True, "why": ""}
        except FormulaError as e:
            c = {"pattern": p, "ok": False, "why": str(e)}
        c["js"], c["jsWhy"] = js[p]
        c["want"] = c["js"]
        if p in SPEC_LOOKBEHIND and SPEC_LOOKBEHIND[p] != c["want"]:
            raise SystemExit(f"後読みの決め（SPEC_LOOKBEHIND）と画面の答えが違います: {p} 決め {SPEC_LOOKBEHIND[p]} / 画面 {c['js']}")
        cases.append(c)
    missing = [p for p in SPEC_LOOKBEHIND if p not in pats]
    if missing:
        raise SystemExit(f"後読みの決めの形が表にありません: {missing}")
    return {"about": "式の正規表現の事例（tools/formula-regex-cases.py が Python の formula.js_regex と画面の JavaScript から焼く。版 3.106.0・3.113.0）。"
                     "正しい答え want は画面の JavaScript の答え js（版 3.113.0 の作った後の直しから。後読みは人が決めた SPEC_LOOKBEHIND とも同じ）。窓は cargo test --test formula_regex_cases で want と同じに"
                     "読めるかを確かめる。古い表は tests/test_formula_regex_cases.py が止める",
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
