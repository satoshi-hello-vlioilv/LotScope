"""窓が答えず Python に任せる歩を数える（版 3.102.0。開発用。主のセッションの決め 4・案 E の予算）。

    python tools/delegate-count.py 作業フォルダ                 … 突き合わせの答えの元（*_oracle.py）を流して、元ごと・形ごとに数える
    python tools/delegate-count.py 作業フォルダ --budget        … 元ごとの数を tests/fixtures/delegates_budget.json に書く（予算を下げる版で）
    python tools/delegate-count.py 作業フォルダ --json 出力.json … 層・形・元ごとの数と、Python の答えの状態の数を JSON に書く
    python tools/delegate-count.py --files 答え.json …          … 流してある答えの JSON を数える

数え方（窓の試験 desktop/tests/common.rs の delegate_count と同じ）: 答えの中の "delegates" の並びの中身・"delegate": true の歩・
"expect": "delegate" の場面。数は数え方だけで決まり、形の分け方を変えても元ごとの数（予算）は変わらない。

形の分け方（2026-11-12 に組み直した。前は場面の名前と本文の字を 1 本の正規表現の並びに当て、置き場の場面の GET・POST を
「表でない本文」に、本文の場面の欄の型を「版が読めない」に数える取り違えがあった）:
- 層: 口（?engine=python）・束（設定の束の場面）・種まき・置き場（置き場のファイル・行の形で、その道の歩が本文によらず任される場面）・
  道（道の id の字）・本文（送った本文の形）・OS（フォルダの道の字）
- 置き場の層は場面の名前で分ける（場面の名前が置き場の形を書いている）
- 本文の層は本文を Python の json.loads で読んで分ける。欄の型の違いは、同じ答えの元で窓が答えた歩（steps）の同じ道・同じ欄の型と比べる
  （窓が答えた歩で字だった欄に並びが来た、など）
"""
import json
import math
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
I64 = 2 ** 63

# 置き場の層の形（場面の名前に当てる。上から先に当たった物）
PLACE_RULES = [
    ("置き場の行: 版（rev・revision）が Python の int() で読めない", r"(行の|ファイルの|置き場の)版(が|・値| revision)|revision|版が読めない"),
    ("置き場の字: NaN・Infinity・1e400・片割れの代用字（serde が読めない）", r"NaN|Infinity|1e400|代用字"),
    ("置き場の字: 整数の -0（Python は 0、serde は -0.0）", r"-0"),
    ("置き場の字: i64 に入らない整数・大きな id・大きな表示順", r"i64|大きな|表示順が大きい"),
    ("置き場の字: 入れ子 128 段以上（serde の上限）", r"入れ子"),
    ("置き場の行: 表でない行・null の条件（Python の落ち方）", r"表でない行|null の条件|並びの条件|前の版の条件"),
    ("置き場・配った設定: 39 桁を超える並び・古さが数でない", r"39 桁|古さが abc"),
    ("置き場の行: 項目の型が違う（並び・数・字。Python の str()・比べ方・落ち方）", r"."),
]
PLACE_SCENE = r"置き場|共有のファイル|窓は答えず|窓は答えない|前の版の条件|39 桁|配った設定|同じに読めない"


def load(p):
    t = Path(p).read_text(encoding="utf-8", errors="replace")
    try:
        return json.loads(t)
    except ValueError:
        return json.loads(t.split("\n", 1)[0])


def walk(v, out, scene=None):
    """(場面, 歩) を集める。場面は名前と歩の並び（steps）を持つ表"""
    if isinstance(v, dict):
        if isinstance(v.get("name"), str) and ("delegates" in v or "steps" in v or v.get("expect") == "delegate"):
            scene = v
        if v.get("expect") == "delegate" or v.get("delegate") is True:
            out.append((scene if scene is not None else v, v))
        for k, x in v.items():
            if k == "delegates" and isinstance(x, list):
                for s in x:
                    out.append((scene if scene is not None else v, s))
            elif isinstance(x, (dict, list)):
                walk(x, out, scene)
    elif isinstance(v, list):
        for x in v:
            walk(x, out, scene)


def walk_count(v):
    """数え方（窓の common.rs と同じ）。返り値は [(場面, 歩)]（同じ歩は 1 回）"""
    out = []
    walk(v, out)
    seen, uniq = set(), []
    for scene, s in out:
        if id(s) not in seen:
            seen.add(id(s))
            uniq.append((scene, s))
    return uniq


# ---------------------------------------------------------------- 本文を見る部品

def template(path):
    """道の型（最後の段が数の id なら {n}）"""
    return re.sub(r"/[^/]*$", lambda m: "/{n}" if re.fullmatch(r"/[\d０-９١-٩]+|/s%34", m.group(0)) else m.group(0), path or "")


def leaves(v, p="", out=None):
    """(欄の道, 値) の並び（並びの中は [] にまとめる）"""
    out = [] if out is None else out
    if isinstance(v, dict):
        for k, x in v.items():
            out.append((f"{p}.{k}", x))
            leaves(x, f"{p}.{k}", out)
    elif isinstance(v, list):
        for x in v:
            out.append((f"{p}[]", x))
            leaves(x, f"{p}[]", out)
    return out


def type_name(x):
    if isinstance(x, bool):
        return "bool"
    if isinstance(x, int):
        return "int"
    return {float: "float", str: "str", list: "list", dict: "dict"}.get(type(x), "null")


def depth(t):
    """字の外の [ { の入れ子のいちばん深い段"""
    d = deepest = 0
    in_str = esc = False
    for ch in t:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "[{":
            d += 1
            deepest = max(deepest, d)
        elif ch in "]}":
            d -= 1
    return deepest


def body_of(s):
    """(Python の json.loads で読んだ本文〈読めなければ ValueError の型〉, 本文の字)"""
    b = s.get("body")
    if b is None:
        return None, ""
    if isinstance(b, str):
        try:
            return json.loads(b), b
        except ValueError:
            return ValueError, b
    return b, json.dumps(b, ensure_ascii=False)


def int_text_split(x):
    """数の欄に入りそうな字で、Python の int() と ASCII の読みが割れうる物（ASCII でない数字・空白・制御字・4300 桁を超える字）"""
    if not isinstance(x, str):
        return False
    core = "".join(ch for ch in x if not (ch.isspace() or ord(ch) < 32) and ch not in "+-_")
    if not core or not all(ch.isdigit() for ch in core):
        return False
    return len(x) > 4300 or not x.isascii() or any(ord(ch) < 32 for ch in x)


def profile(answer):
    """窓が答えた歩（steps）の、道の型・欄ごとの値の型の集まり"""
    prof = defaultdict(lambda: defaultdict(set))

    def go(v):
        if isinstance(v, dict):
            for st in v.get("steps") if isinstance(v.get("steps"), list) else []:
                if isinstance(st, dict) and st.get("method") in ("POST", "PUT", "DELETE"):
                    o, _ = body_of(st)
                    if isinstance(o, dict):
                        for p, x in leaves(o):
                            prof[(st["method"], template(st.get("path")))][p].add(type_name(x))
            for x in v.values():
                go(x)
        elif isinstance(v, list):
            for x in v:
                go(x)
    go(answer)
    return prof


BODY_BIG = "本文: i64 に入らない整数・1e20・19 桁以上の数の字（serde の数・Python の int()）"
BODY_LIST = "本文: 字・数の欄に並び・表（並びの欄に表も。Python は str() で repr の字・TypeError）"


def body_kind(s, scene_name, prof):
    """本文の層の形（当たらなければ None）"""
    method, path, query = s.get("method"), s.get("path") or "", s.get("query") or ""
    o, raw = body_of(s)
    if o is ValueError and not re.search(r"NaN|Infinity", raw):
        return "本文: 読めない JSON・空"
    if re.search(r"\bNaN\b|Infinity|\\ud[89ab]", raw) or (o not in (None, ValueError) and any(
            isinstance(x, float) and (math.isinf(x) or math.isnan(x)) for _, x in leaves(o))):
        return "本文: NaN・Infinity・1e400・片割れの代用字（serde が読めない）"
    if raw and depth(raw) >= 128:
        return "本文: 入れ子 128 段以上（serde の上限）"
    if method in ("POST", "PUT", "DELETE") and o is not None and not isinstance(o, dict):
        return "本文: 表でない（並び・字・数・null）"
    if method in ("POST", "PUT") and s.get("body") == "":
        return "本文: 読めない JSON・空"
    if re.search(r"(^|&)rev=([^&0-9]|[^&]*[^\x00-\x7f])", query):
        return "本文: 版 base_rev・?rev= の字・型（²・小数・並び。Python の int()）"
    if re.search(r"/\d{19,}$", path):
        return "道: id が i64 に入らない（Python の int() は読む）"
    if not isinstance(o, dict):
        return None
    # 中身を字で送る欄（"body": "{…}"）の中の字も見る
    for x in (x for _, x in leaves(o) if isinstance(x, str) and x[:1] in "[{"):
        if depth(x) >= 128:
            return "本文: 入れ子 128 段以上（serde の上限）"
        if re.search(r"\bNaN\b|Infinity|\d[eE]\d{3}", x):
            return "本文: NaN・Infinity・1e400・片割れの代用字（serde が読めない）"
    first = o.get("items")[0] if isinstance(o.get("items"), list) and o["items"] and isinstance(o["items"][0], dict) else {}
    name = o.get("name") if isinstance(o.get("name"), str) else first.get("name")
    name = name if isinstance(name, str) else ""
    # 変換表・設備グループの場面は、本文の名前が形を書いている
    if "正規表現" in name:
        return "本文: 正規表現（Python の re）"
    if re.search("入れ子|重ね", name):
        return "本文: 入れ子 128 段以上（serde の上限）"
    if re.search("大きな|桁", name):
        return BODY_BIG
    if re.search("並び|が表", name):
        return BODY_LIST
    vals = leaves(o)
    if re.search(r"(?<![\d.eE])-0(?![\d.eE])", raw):
        return "本文: 整数の -0（Python は 0、serde は -0.0）"
    if any(isinstance(x, int) and not isinstance(x, bool) and not -I64 <= x < I64 for _, x in vals) \
            or any(isinstance(x, float) and abs(x) >= I64 for _, x in vals) \
            or any(isinstance(x, str) and re.fullmatch(r"\s*[+-]?\d{19,}\s*", x) and len(x) <= 4300 for _, x in vals):
        return BODY_BIG
    br = o.get("base_rev")
    if br is not None and not isinstance(br, bool) and (isinstance(br, (float, list, dict)) or (
            isinstance(br, str) and not re.fullmatch(r"\s*[+-]?\d+\s*", br))):
        return "本文: 版 base_rev・?rev= の字・型（²・小数・並び。Python の int()）"
    if any(int_text_split(x) for _, x in vals):
        return "本文: 数の欄の字（全角・ASCII でない空白・制御字・4300 桁・²。Python の int()）"
    seen = prof.get((method, template(path)), {})
    for p, x in vals:
        if isinstance(x, (list, dict)) and seen.get(p) and type_name(x) not in seen[p]:
            return BODY_LIST
    for p, x in vals:
        if isinstance(x, float) and "float" not in seen.get(p, set()):
            return "本文: 字の欄に小数（Python の str() は repr の字）"
    for p, x in vals:
        have = seen.get(p, set())
        if isinstance(x, (list, dict)) and not have:
            return BODY_LIST
        if isinstance(x, (int, bool)) and have and not (have & {"int", "bool", "float"}):
            return "本文: 並び・字の欄に数・真偽（Python の str()・回し方）"
        if isinstance(x, str) and have and "str" not in have:
            return "本文: 並び・表の欄に字（Python は字を 1 字ずつ回す）"
    return None


def kind_of(scene, s, prof, oracle=""):
    """(層, 形)"""
    name = scene.get("name", "") if isinstance(scene, dict) else ""
    if not isinstance(s, dict) or "method" not in s:          # 設定の束の場面（settings_oracle）
        if "まだ無い" in name:
            return "束", "束: 種まき（共有にまだ無いマスタ）"
        if "引っ越し" in name:
            return "束", "束: 引っ越しの印"
        return "束", "束: 配った設定・束の材料の形（NaN・段が字・表でない）"
    path, query = s.get("path") or "", s.get("query") or ""
    if "engine=python" in query:
        return "口", "engine=python（自己診断・突き合わせの口）"
    if re.search(r"写しだけで最初|まだ無い|空の共有", name):
        return "種まき", "種まき: 読むだけで共有に最初の版を置く（Python の読みの副作用）"
    if re.search(r"共有に \w+ が無い", name):
        return "種まき", "種まき: 数える材料のマスタが共有に無い（設備グループ）"
    if re.search(PLACE_SCENE, name) and oracle not in ("release_place_oracle", "fs_oracle"):
        return "置き場", next(k for k, rx in PLACE_RULES if re.search(rx, name))
    if re.search(r"/[^/]*%[0-9A-Fa-f]{2}[^/]*$", path) or re.search(r"/[０-９١-٩]+$", path):
        return "道", "道: id の字（全角・ほかの字の数・百分率符号。Python の int()・道の読み）"
    k = body_kind(s, name, prof)
    if k:
        return ("道" if k.startswith("道") else "本文"), k
    if oracle in ("fs_oracle", "release_place_oracle"):
        return "OS", "OS の道（~ユーザー・file: の [ ]・NUL・読めない置き場）"
    return "そのほか", "そのほか"


def run(work):
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    got = {}
    for name in ORACLES:
        r = subprocess.run([sys.executable, str(PROGRAM / "tests" / f"{name}_oracle.py"), str(work / name)], capture_output=True,
                           text=True, encoding="utf-8", stdin=subprocess.DEVNULL, cwd=PROGRAM, timeout=1800, check=False)
        if r.returncode != 0:
            raise SystemExit(f"{name}_oracle.py が失敗しました:\n{r.stderr[-2000:]}")
        try:
            got[f"{name}_oracle"] = json.loads(r.stdout)
        except ValueError:                 # 1 行目だけが答え（続きを待つ形）
            got[f"{name}_oracle"] = json.loads(r.stdout.split("\n", 1)[0])
    return got


def count(answers):
    """{per: 元→形→数, layers: 層→数, kinds: 形→数, status: 形→Python の答えの状態の頭→数, others: [そのほかの歩]}"""
    per, layers, kinds, status, others = {}, Counter(), Counter(), defaultdict(Counter), []
    for name, d in answers.items():
        prof, c = profile(d), Counter()
        for scene, s in walk_count(d):
            layer, k = kind_of(scene, s, prof, name)
            c[k] += 1
            layers[layer] += 1
            code = s.get("status") if isinstance(s, dict) else None
            status[k][f"{str(code)[0]}xx" if code else "なし"] += 1
            if k == "そのほか":
                others.append(f"{name}: {(scene or {}).get('name', '')} {s.get('method', '') if isinstance(s, dict) else ''} "
                              f"{s.get('path', '') if isinstance(s, dict) else ''} {str(s.get('body') if isinstance(s, dict) else s)[:120]}")
        per[name] = c
        kinds.update(c)
    return {"per": per, "layers": layers, "kinds": kinds, "status": status, "others": others}


def main():
    args = sys.argv[1:]
    # 作業フォルダが無い・知らない「--」の引数は、作業フォルダと読まずに使い方を出す（前は --help を作業フォルダと読み、program/--help に答えの元を流した）
    known = ("--budget", "--json")
    flags = [a for i, a in enumerate(args[1:], 1) if a.startswith("-") and args[i - 1] != "--json"]
    if not args or (args[0] != "--files" and (args[0].startswith("-") or any(a not in known for a in flags))):
        sys.exit(__doc__)
    out_json = args[args.index("--json") + 1] if "--json" in args and args.index("--json") + 1 < len(args) else None
    if args[0] == "--files":
        answers = {Path(f).stem: load(f) for f in args[1:] if f.endswith(".json") and f != out_json}
    else:
        answers = run(args[0])
    got = count(answers)
    for name, c in got["per"].items():
        print(f"== {name}: {sum(c.values())}")
        for k, n in c.most_common():
            print(f"   {n:3d}  {k}")
    total = sum(got["kinds"].values())
    print("== 計", total)
    for layer, n in got["layers"].most_common():
        print(f"   {n:4d}  層: {layer}")
    for k, n in got["kinds"].most_common():
        print(f"   {n:4d}  {k}  （Python の答え {dict(got['status'][k])}）")
    for line in got["others"]:
        print("   そのほか:", line)
    if out_json:
        Path(out_json).write_text(json.dumps({
            "total": total, "layers": dict(got["layers"].most_common()), "kinds": dict(got["kinds"].most_common()),
            "pythonStatus": {k: dict(v) for k, v in got["status"].items()},
            "per": {k: dict(v.most_common()) for k, v in sorted(got["per"].items())}, "others": got["others"]},
            ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"{out_json} に書きました")
    if "--budget" in args:
        # 環境で増える歩（envExtra と理由の envWhy）は手で書く物なので、書き直しても残す（窓の試験は per＋envExtra を上限にする）
        old = json.loads(BUDGET.read_text(encoding="utf-8")) if BUDGET.exists() else {}
        keep = {k: old[k] for k in ("envExtra", "envWhy") if k in old}
        BUDGET.write_text(json.dumps({"about": "窓が答えず Python に任せる歩の上限（答えの元ごと。tools/delegate-count.py が数える。版 3.102.0 から）",
                                      "total": total, "per": {k: sum(v.values()) for k, v in sorted(got["per"].items())}, **keep},
                                     ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"{BUDGET} に書きました")


if __name__ == "__main__":
    main()
