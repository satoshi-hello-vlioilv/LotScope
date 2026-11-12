"""窓が答えず Python に任せる歩を数える（版 3.102.0。開発用。主のセッションの決め 4・案 E の予算）。

    python tools/delegate-count.py 作業フォルダ                 … 突き合わせの答えの元（*_oracle.py）を流して、元ごと・形ごとに数える
    python tools/delegate-count.py 作業フォルダ --budget        … 元ごとの数を tests/fixtures/delegates_budget.json に書く（予算を下げる版で）
    python tools/delegate-count.py --files 答え.json …          … 流してある答えの JSON を数える

数え方（窓の試験 desktop/tests/common.rs の delegate_count と同じ）: 答えの中の "delegates" の並びの中身・"delegate": true の歩・
"expect": "delegate" の場面。形の分け方は場面の名前・本文・道の字の手がかり（下の RULES。上から先に当たった物）で、目安（±1 割）。
予算（tests/fixtures/delegates_budget.json）は元ごとの上限。窓の突き合わせの試験は答えの元を呼ぶたびに数え、上限を超えると落ちる
（新しい任せる歩を足すときは、理由を書いて予算を上げる。減ったら下げる）。
"""
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
BUDGET = PROGRAM / "tests" / "fixtures" / "delegates_budget.json"
# 作業フォルダを 1 つ渡して流す答えの元（標準入力を待つ・係を起こしたままにする元は除く）
ORACLES = ["access_write", "calc", "cards", "conversions", "dashboards", "equip_rows", "equipgroups", "formats", "fs", "place", "presets",
           "release_place", "sets", "settings", "settings_write", "shifts", "sources_write", "ui_defaults", "worklog_write"]

RULES = [  # (形, 正規表現〈場面の名前＋本文＋道〉)
    ("engine=python（自己診断・突き合わせの口）", r"engine=python"),
    ("種まき（共有にまだ無い・空の共有・最初の読み）", r"共有にまだ無い|空の共有|種まき|まだ無いファイル|最初の読み|写しだけの最初"),
    ("本文の端: NaN・Infinity・1e400・代用字", r"NaN|Infinity|nan|inf\b|1e400|\\ud8|代用字|有限でない"),
    ("本文の端: 大きな数・-0・i64・2^63・桁", r"大きな|-0\b|i64|2\^63|2\*\*63|桁|9223372036854775808|99999999999999999999|小数"),
    ("本文の端: 入れ子 128 段以上・深い式", r"入れ子|深い|128"),
    ("本文の端: 値が並び・表（Python は repr の字）・unhashable", r"並び|表の値|unhashable|repr|リスト|\[\s*'"),
    ("本文の端: 表でない本文・空・読めない本文・道の外で落ちる", r"表でない本文|空の本文|空\b|読めない本文|JSON でない|道の外|本文の形|落ちる"),
    ("置き場の形: 読めない置き場の行・版が読めない・壊れた JSON・同じ名前の行", r"置き場の行|版が読めない|版の番号|revision|壊れ|置き場のファイル|ファイルの字|行の形|同じ名前の行|数字でない版|id が|ASCII でない id"),
    ("置き場の形: 写しだけ・手元だけ・届かない共有", r"写しだけ|写しから|手元だけ|届かない|共有に無い"),
    ("正規表現（Python の re）", r"正規表現|re\b|regex"),
    ("百分率符号の道・ブラウザの欄・ASCII でない道", r"百分率|%[0-9A-F]{2}|ブラウザの欄|ASCII でない"),
    ("Windows・OS の不確か（resolve・NUL・exists が落ちる・名前付きパイプ）", r"Windows|resolve|NUL|exists|パイプ|win|\\\\\\\\\?"),
]


def load(p):
    t = Path(p).read_text(encoding="utf-8", errors="replace")
    try:
        return json.loads(t)
    except Exception:
        return json.loads(t.split("\n", 1)[0])


def walk(v, out, scen=""):
    if isinstance(v, dict):
        name = v.get("name") if isinstance(v.get("name"), str) else scen
        if v.get("expect") == "delegate" or v.get("delegate") is True:
            out.append((name, v))
        for k, x in v.items():
            if k == "delegates" and isinstance(x, list):
                for s in x:
                    out.append((name, s))
            elif isinstance(x, (dict, list)):
                walk(x, out, name)
    elif isinstance(v, list):
        for x in v:
            walk(x, out, scen)


def text_of(scen, s):
    if not isinstance(s, dict):
        return scen + " " + str(s)[:300]
    body = s.get("body")
    return " ".join(str(x) for x in (scen, s.get("method", ""), s.get("path", ""), s.get("query", ""), str(body)[:300] if body is not None else "",
                                     s.get("why", ""), s.get("name", "") if s.get("name") != scen else ""))


def kind_of(t, scen="", s=None):
    body = s.get("body") if isinstance(s, dict) else None
    b = "" if body is None else (body if isinstance(body, str) else str(body))
    bs = b.strip()
    q = (s.get("query") or "") if isinstance(s, dict) else ""
    path = (s.get("path") or "") if isinstance(s, dict) else ""
    if "engine=python" in q:
        return RULES[0][0]
    if re.search(r"共有にまだ無い|まだ無い（読むだけで作る|写しだけの最初|空の共有", scen):
        return RULES[1][0]
    if re.search(r"共有に \w+ が無い", scen):
        return "置き場の形: 数える材料のマスタが共有に無い（写しも data/ も無い）"
    if bs in ("", "[1]", "{", "\"x\"", "{bad") and isinstance(s, dict) and s.get("method") in ("POST", "PUT", "DELETE"):
        return "本文の端: 表でない本文・空・壊れた JSON"
    if "²" in b or "²" in q or re.search(r"/[４١]$", path):
        return "本文の端: 版・id の字（²・全角やほかの字の数。Python の int() は読む）"
    for k, rx in RULES:
        if re.search(rx, t):
            return k
    if re.search(r'": (\[|\{"a"|\{\}|[0-9]|true)', b):
        return "本文の端: 欄の値の型が違う（字の所に数・並び・表）"
    if re.search(r"表でない|段が字|古さが abc|null|数$|が数", scen):
        return "置き場・配った設定の形: 表でない行・段が字・数でない値"
    return "そのほか"




def walk_count(v):
    """数え方（窓の common.rs と同じ）"""
    out = []
    walk(v, out)
    seen, uniq = set(), []
    for scen, s in out:
        if id(s) not in seen:
            seen.add(id(s))
            uniq.append((scen, s))
    return uniq


def run(work):
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    got = {}
    for name in ORACLES:
        r = subprocess.run([sys.executable, str(PROGRAM / "tests" / f"{name}_oracle.py"), str(work / name)], capture_output=True,
                           text=True, encoding="utf-8", stdin=subprocess.DEVNULL, cwd=PROGRAM, timeout=1800)
        if r.returncode != 0:
            raise SystemExit(f"{name}_oracle.py が失敗しました:\n{r.stderr[-2000:]}")
        try:
            got[f"{name}_oracle"] = json.loads(r.stdout)
        except ValueError:                 # 1 行目だけが答え（続きを待つ形）
            got[f"{name}_oracle"] = json.loads(r.stdout.split("\n", 1)[0])
    return got


def main():
    args = sys.argv[1:]
    if args and args[0] == "--files":
        answers = {Path(f).stem: load(f) for f in args[1:]}
    else:
        answers = run(args[0])
    grand, per, others = Counter(), {}, defaultdict(list)
    for name, d in answers.items():
        c = Counter()
        for scen, s in walk_count(d):
            t = text_of(scen, s)
            k = kind_of(t, scen, s)
            c[k] += 1
            if k == "そのほか":
                others[name].append(t[:160])
        per[name] = c
        grand.update(c)
        print(f"== {name}: {sum(c.values())}")
        for k, n in c.most_common():
            print(f"   {n:3d}  {k}")
    print("== 計", sum(grand.values()))
    for k, n in grand.most_common():
        print(f"   {n:4d}  {k}")
    if "--budget" in args:
        BUDGET.write_text(json.dumps({"about": "窓が答えず Python に任せる歩の上限（答えの元ごと。tools/delegate-count.py が数える。版 3.102.0 から）",
                                      "total": sum(grand.values()), "per": {k: sum(v.values()) for k, v in sorted(per.items())}},
                                     ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"{BUDGET} に書きました")


if __name__ == "__main__":
    main()
