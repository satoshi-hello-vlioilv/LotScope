"""設備グループの正規表現の事例の表を作る（版 3.102.0。開発用）。

    python tools/equip-regex-cases.py            … tests/fixtures/equip_regex_cases.json を作り直す
    python tools/equip-regex-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）
    python tools/equip-regex-cases.py --rust 実行ファイル … 窓と同じ版の fancy-regex で当てる小さな道具（標準入力
                                                     [[正規表現, [名前…]], …] → [[読めたか, [当たり…]], …]）で「ok」の当たりも確かめる

答えの元は仕様（下の CASES に人が書いた判定）と、同梱と同じ Python の re（app を import しない: re.compile(v, IGNORECASE).search）。
- verdict … "ok"（Python と窓で同じ意味。当てる）・"unsupported"（窓で写せない。保存は断り、読むときは当てない）・"invalid"（読めない）
- hits    … "ok" の形で、名前（設備名を NFKC・前後の空白を除く・大文字にした字）ごとに当たるか（Python の re の答え）
- python  … Python の re が読めるか（"invalid" は読めないこと、"ok" は読めることをここで確かめる）
- why     … 理由の言葉（app/services/equip_regex.py と窓の desktop/src/equip_regex.rs が同じ言葉を出す。言葉だけは app の check から焼く）
Python は tests/test_equip_regex.py、窓は cargo test --test equip_regex_cases が同じ表を読む。
"""
import json
import re
import subprocess
import sys
import unicodedata
import warnings
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
OUT = PROGRAM / "tests" / "fixtures" / "equip_regex_cases.json"


def norm(x):
    return unicodedata.normalize("NFKC", x).strip().upper()


NAMES = [norm(x) for x in ["L-1", "L-2", "L-3", "LS3", "LS4", "CR1", "CR2", "CAL", "HOT", "ＣＲ３", "ns1", "DL2", "TLV", "FS4", "AP3",
                           "A-10", "L-12", "焼鈍炉1", "焼鈍炉２", "CR 1", "ＡＮＦ", "Ｌ－５", "a_b", "A\tB", "K", "ſ", "X½", "炉", "L-1(旧)", "[CR]"]]

OK, UN, BAD = "ok", "unsupported", "invalid"
CASES = [
    # 前の採点の 40 形（rxcmp）
    ("^L-", OK), ("^L-\\d$", OK), ("^L-\\d+$", OK), ("^CR[12]$", OK), ("CR", OK), ("^(CR|L)-?\\d", OK), ("^(?!L)", OK), ("L(?=S)", OK),
    ("(?<=L)S", OK), ("^.{2}$", OK), ("^\\w+$", OK), ("^[A-Z]{2}\\d$", OK), ("^L-[0-9]\\Z", UN), ("^L-[0-9]$", OK), ("\\AL", OK), ("^l-", OK),
    ("炉\\d", OK), ("炉[1-9]", OK), ("^(?P<a>L)-(?P=a)?", OK), ("^(L)-\\1", OK), ("\\bCR\\b", OK), ("CR\\s1", OK), ("[[:alpha:]]", UN),
    ("^L-(1|2)$", OK), ("^[^C]", OK), ("^L-\\d{1,2}$", OK), ("(?i)cr", OK), ("(?x) ^ L - \\d", UN), ("^CR(?#注)1", OK), ("\\d$", OK),
    ("^.*$", OK), ("[ァ-ン]", OK), ("\\p{Han}", UN), ("[\\u7089]", OK), ("\\N{DIGIT ONE}", UN), ("^A-1(?:0)?$", OK), ("^L-.$", OK),
    ("a{,2}", OK), ("x*", OK), ("^$", OK),
    # 窓（fancy-regex）と Python で読み方・当たりが違う形（版 3.102.0 で調べた）
    ("(?<n>L)", UN), ("\\x{41}", UN), ("\\e", UN), ("\\z", UN), ("\\G", UN), ("\\h", UN), ("\\K", UN), ("\\101", UN),
    ("(?P<a>L)(?P<a>x)", BAD), ("(?<=L|CR)\\d", BAD), ("[[:digit:]]", UN), ("[a&&b]", UN), ("[a--b]", BAD), ("(?a)\\w", UN),
    ("\\<", UN), ("\\>", UN), ("\\P{Han}", UN), ("\\Z", UN),
    # 書き方の端
    ("(?s).", UN), ("(?m)^L", UN), ("(?i:cr)", UN), ("a*+", UN), ("(?>CR)1", UN), ("(?(1)a|b)", UN), ("CR(?i)", UN),
    ("\\x41", OK), ("\\u0041", OK), ("\\U00000041", OK), ("\\U00110000", BAD), ("\\x4", UN), ("[\\x41-\\x43]", OK), ("\\0", OK), ("\\01", UN),
    ("\\cA", UN), ("[\\d-z]", UN), ("[a-\\d]", UN), ("[z-a]", BAD), ("a{2,1}", BAD), ("a**", BAD), ("*a", BAD), ("^*", BAD), ("a|*", BAD),
    ("(?=L)*", UN), ("(?<=L)?", UN), ("\\b+", BAD), ("(?P=b)", BAD), ("\\8", BAD), ("(a)\\2", BAD), ("(a\\1)", BAD), ("(a(b)\\2)", OK), ("\\1(a)", BAD),
    ("(?<=L+)\\d", BAD), ("(?<=(L)\\1)", BAD), ("(?<=L|C)R", OK), ("(?<!C)R", OK), ("(?<=(?:L|C))R", OK), ("[]a]", OK), ("[^]a]", OK),
    ("[a-]", OK), ("[-a]", OK), ("[\\]]", OK), ("[\\b]", OK), ("[\\w\\s]", OK), ("[\\[]", OK), ("[a[]", UN), ("[a~~b]", UN), ("[a||b]", UN),
    ("\\Q.\\E", UN), ("{", UN), ("a{", UN), ("a{1", UN), ("x{,}", UN), ("}", UN), ("a{1001}", UN), ("a{2}", OK), ("a{2,}", OK), ("a{2}?", OK),
    ("a*?", OK), ("a+?", OK), ("a??", OK), ("\\w+", OK), ("\\s", OK), ("\\S", OK), ("\\W", OK), ("\\D", OK), ("\\B", OK), ("\\b炉", OK),
    ("[[]", UN), ("(", BAD), (")", BAD), ("(?:", BAD), ("[a", BAD), ("\\", BAD), ("a|", OK), ("|", OK), ("()", OK), ("(?P<1a>x)", UN),
    ("(?P<名>x)", UN), ("(?u)L", UN), ("(?L)a", UN), ("CR\\ 1", OK), ("\\-", OK), ("\\/", OK), ("\\#", OK), ("\\&", OK), ("\\~", OK), ("\\%", OK),
    ("\\@", OK), ("\\!", OK), ("\\'", OK), ("\\\"", OK), ("\\`", OK), ("\\,", OK), ("\\;", OK), ("\\:", OK), ("\\=", OK), ("\\_", OK),
    ("\\a", OK), ("\\f", OK), ("\\v", OK), ("\\t", OK), ("\\n", OK), ("\\r", OK), ("\\(旧\\)$", OK), ("^\\[CR\\]$", OK), ("\\.", OK),
    ("ǅ", OK), ("(?i)Ǆ", OK), ("K", OK), ("\\d²", OK), ("(?#c", BAD), ("(?<=a{2})b", OK), ("(?<=a{1,2})b", BAD), ("x{0}", OK),
]


def python_reads(p):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return re.compile(p, re.IGNORECASE)
        except re.error:
            return None


def build(rust=None):
    sys.path.insert(0, str(PROGRAM))
    from app.services import equip_regex  # 理由の言葉だけ（判定と当たりは上の仕様と Python の re）
    out, bad = [], []
    seen = set()
    for p, verdict in CASES:
        if p in seen:
            bad.append(f"同じ形が 2 つ: {p!r}")
        seen.add(p)
        rx = python_reads(p)
        if verdict == OK and rx is None:
            bad.append(f"ok なのに Python の re が読めない: {p!r}")
        if verdict == BAD and rx is not None:
            bad.append(f"invalid なのに Python の re が読める: {p!r}")
        got, why = equip_regex.check(p)
        if got != verdict:
            bad.append(f"app の check が {got}（仕様は {verdict}）: {p!r} {why}")
        c = {"pattern": p, "verdict": verdict, "python": rx is not None, "why": why}
        if verdict == OK and rx is not None:
            c["hits"] = [bool(rx.search(n)) for n in NAMES]
        out.append(c)
    if rust:
        ok = [c for c in out if c["verdict"] == OK]
        rs = json.loads(subprocess.run([rust], input=json.dumps([[c["pattern"], NAMES] for c in ok]), capture_output=True, text=True,
                                       check=True).stdout)
        for c, (readable, hits) in zip(ok, rs):
            if not readable or hits != c["hits"]:
                bad.append(f"窓と Python で当たりが違う ok の形: {c['pattern']!r} {hits if readable else '窓が読めない'}")
    if bad:
        raise SystemExit("\n".join(bad))
    return {"names": NAMES, "cases": out}


def main():
    rust = sys.argv[sys.argv.index("--rust") + 1] if "--rust" in sys.argv else None
    text = json.dumps(build(rust), ensure_ascii=False, indent=1) + "\n"
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("tests/fixtures/equip_regex_cases.json が古い（python tools/equip-regex-cases.py で作り直す）")
            sys.exit(1)
        print("同じ")
        return
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"{OUT}: {len(CASES)} 形")


if __name__ == "__main__":
    main()
