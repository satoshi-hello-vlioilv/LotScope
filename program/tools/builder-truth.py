# -*- coding: utf-8 -*-
"""組む所の読み 7 本（版 3.99.0）の「Python に頼らない独立の答え」。app を import せず、sqlite3 と標準の部品だけで元のファイルを数える。

    python tools/builder-truth.py 事例の表.json        # 事例の表（tests/fixtures/builder_cases.json）の答えを作り直して突き合わせる

決まり（仕様から書いた。app のコードは読まない）:
- 空欄 … 値が NULL か、字にして前後の空白（Python の str.strip が除く字）を除くと空
- 同じ値 … 集計の段・並べ替えと同じ見分け（SortKey）: 数と、数の字だけでできた字（' 54'・'1e-05'）は数として 1 つ、ほかは前後の空白を除いた字
- 種類（kinds）… 合わせた全部のファイル（作業実績のすべての設備）の値の集合の大きさ。空欄があり値もあれば「（空欄）」を 1 つ足す。
  1,001 で止め、1,000 を超えたら many。値が 1 つも無く空欄だけなら kinds 0・blankOnly
- 数（numeric）… 値のあったファイルごとに、空欄でない値の先頭 300 個がみな数に読めるか（「,」を除く・前後の空白・有限）。値のあったファイルの全部が数なら数
- 列の並び … 元の列を、ファイルの順に初めて出た順（計算列はその後ろ）
- 値の見本 … 空欄でない値を表の行の順に、字（Python の str）が同じ物を 1 つにして 3 つまで（見せる字は生の値。空白も残す）
- 結合の「試す」… 鍵の比べ方は JoinKey（同じ値の見分けの後、数は整数なら整数の字・字は NFKC・前後の空白を除き大文字）。全部の設備の行を足す。
  鍵の列が無い設備は数えず（skipped）、数えた設備の数（counted）を言う
- 確かめる … 一覧が読むのと同じ表（欄の表 → 役割の候補 → 候補を含む名前 → 最初の表）
"""
import json
import math
import sqlite3
from contextlib import closing
import sys
import unicodedata

KINDS_MAX = 1001
NUM_CHARS = frozenset("0123456789.eE+-")
LOT_TABLES = ["仕掛", "品質情報", "品質", "保留"]          # 品質データの表の候補（仕様: 品質の役割）
SRC_TABLES = ["仕掛", "品質情報", "品質", "保留"]          # ほかのデータ元の表の候補
WORK_TABLES = ["実績", "作業実績"]                          # 作業実績の表の候補
LOT_COLUMNS = ["ロット番号", "ﾛｯﾄ番号", "ロット№", "LTNO"]


def text_of(v):
    """Python の str(値)（None は ""）"""
    return "" if v is None else str(v)


def same_key(v):
    """同じ値の見分け（空欄は None）"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = text_of(v).strip()
    if not s:
        return None
    if set(s) <= NUM_CHARS and any(ch.isdigit() for ch in s):
        try:
            return float(s)
        except ValueError:
            pass
    return s


def as_number(v):
    """数に読める値 → float（読めなければ None）"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    s = str(v).replace(",", "").strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def join_key(v):
    k = same_key(v)
    if k is None:
        return None
    if isinstance(k, float):
        return str(int(k)) if k.is_integer() else repr(k)
    if isinstance(k, int):
        return str(k)
    return unicodedata.normalize("NFKC", k).strip().upper() or None


def q(name):
    return '"' + str(name).replace('"', '""') + '"'


def open_ro(path):
    """読むだけで開く（URI は as_uri の形: Windows の \\ と日本語の名前も読める）"""
    from pathlib import Path
    return closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True))


def table_names(c):
    return [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def pick(names, preferred="", candidates=SRC_TABLES):
    if preferred and preferred in names:
        return preferred
    for x in candidates:
        if x in names:
            return x
    for x in candidates:
        for n in names:
            if x in n:
                return n
    return names[0] if names else ""


def read_table(path, preferred="", candidates=SRC_TABLES):
    """(表, 列, 行の並び)"""
    with open_ro(path) as c:
        t = pick(table_names(c), preferred, candidates)
        cols = list(dict.fromkeys(r[1] for r in c.execute(f"PRAGMA table_info({q(t)})")))
        rows = c.execute(f"SELECT {', '.join(q(x) for x in cols)} FROM {q(t)}").fetchall() if cols else []
    return t, cols, rows


def fields(files, preferred="", candidates=SRC_TABLES, sample=300):
    """全部のファイルを合わせた列ごとの手がかり → {"order": [列], "fields": {列: {kinds, many, numeric, blankOnly}}}"""
    order, keys, blank, nums = [], {}, {}, {}
    for path in files:
        _, cols, rows = read_table(path, preferred, candidates)
        for i, col in enumerate(cols):
            if col not in keys:
                order.append(col)
                keys[col], blank[col], nums[col] = set(), False, []
            vals = []
            for r in rows:
                k = same_key(r[i])
                if k is None:
                    blank[col] = True
                    continue
                if len(keys[col]) <= KINDS_MAX:
                    keys[col].add(k)
                if len(vals) < sample:
                    vals.append(r[i])
            if vals:
                nums[col].append(all(as_number(v) is not None for v in vals))
    out = {}
    for col in order:
        n = min(len(keys[col]), KINDS_MAX)
        kinds = min(n + (1 if blank[col] and n else 0), KINDS_MAX)
        out[col] = {"kinds": kinds, "many": kinds > KINDS_MAX - 1, "numeric": bool(nums[col]) and all(nums[col]),
                    "blankOnly": n == 0 and blank[col]}
    return {"order": order, "fields": out}


def samples(files, preferred="", candidates=SRC_TABLES, n=3):
    """列ごとの値の見本（ファイルの順に 3 つまで）→ {"order": [列], "samples": {列: [字]}}"""
    order, out = [], {}
    for path in files:
        _, cols, rows = read_table(path, preferred, candidates)
        for i, col in enumerate(cols):
            if col not in out:
                order.append(col)
                out[col] = []
            for r in rows:
                if len(out[col]) >= n:
                    break
                if same_key(r[i]) is None:
                    continue
                s = text_of(r[i])
                if s not in out[col]:
                    out[col].append(s)
    return {"order": order, "samples": out}


def rows_of(files, preferred="", candidates=SRC_TABLES):
    return sum(len(read_table(p, preferred, candidates)[2]) for p in files)


def lot_column(cols):
    for x in LOT_COLUMNS:
        if x in cols:
            return x
    for x in cols:
        if "ロット" in x or "ﾛｯﾄ" in x:
            return x
    return ""


def join_try(left_files, right_file, on, left_candidates=WORK_TABLES, right_candidates=SRC_TABLES, left_table="", right_table=""):
    """「試す」の数（左外部結合の 1 段目）: 全部の左のファイルを足した rows・hit・miss"""
    _, rcols, rrows = read_table(right_file, right_table, right_candidates)
    ri = [rcols.index(b) for _, b in on]
    have = set()
    for r in rrows:
        k = tuple(join_key(r[i]) for i in ri)
        if all(x is not None for x in k):
            have.add(k)
    rows = hit = counted = 0
    skipped = []
    for path in left_files:
        _, cols, lrows = read_table(path, left_table, left_candidates)
        if any(a not in cols for a, _ in on):        # この設備には鍵の列が無い: 数えない（ほかの設備で数える）
            skipped.append(str(path))
            continue
        counted += 1
        li = [cols.index(a) for a, _ in on]
        for r in lrows:
            rows += 1
            k = tuple(join_key(r[i]) for i in li)
            if all(x is not None for x in k) and k in have:
                hit += 1
    return {"rows": rows, "hit": hit, "miss": rows - hit, "counted": counted, "skipped": skipped}


def check(path, table="", role="品質"):
    """確かめるが言う表・行・ロット番号の列"""
    cands = LOT_TABLES if role == "品質" else SRC_TABLES
    t, cols, rows = read_table(path, table, cands)
    return {"table": t, "rows": len(rows), "lotColumn": lot_column(cols)}


# ------------------------------------------------------------------ 事例の表を作り直す
def make_file(path, spec):
    """事例の表のファイルの書き方（{"tables": {表: {"cols": [...], "rows": [[...]]}}} か {"cols", "rows"}＝表「実績」）を SQLite に"""
    tabs = spec.get("tables") or {spec.get("table", "実績"): {"cols": spec["cols"], "rows": spec["rows"]}}
    with closing(sqlite3.connect(path)) as c:
        for name, t in tabs.items():
            c.execute(f"CREATE TABLE {q(name)} ({', '.join(q(x) for x in t['cols'])})")
            c.executemany(f"INSERT INTO {q(name)} VALUES ({', '.join('?' * len(t['cols']))})", [[value_of(v) for v in r] for r in t["rows"]])
        c.commit()
    return path


def value_of(v):
    """事例の値: {"blob": "16 進"} は BLOB、{"real": 数} は小数、{"rep": [値, 回数]} は使わない（行で書く）、ほかはそのまま"""
    if isinstance(v, dict) and "blob" in v:
        return bytes.fromhex(v["blob"])
    if isinstance(v, dict) and "real" in v:
        return float(v["real"])
    return v


def expand(rows):
    """{"range": [頭, 始め, 終わり]} の行を、頭に番号を付けた行に広げる（1,001 の境の事例）"""
    out = []
    for r in rows:
        if isinstance(r, dict) and "range" in r:
            head, a, b = r["range"]
            out += [[f"{head}{i}" if head is not None else i] for i in range(a, b)]
        else:
            out.append(r)
    return out


def main():
    import tempfile
    from pathlib import Path
    cases = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    bad = 0
    with tempfile.TemporaryDirectory() as d:
        for i, cs in enumerate(cases["fields"]):
            files = []
            for j, p in enumerate(cs["parts"]):
                spec = {**p, "rows": expand(p["rows"])}
                files.append(make_file(Path(d) / f"f{i}_{j}.sqlite3", spec))
            got = fields(files, candidates=WORK_TABLES)
            for col, want in cs["want"].items():
                if want.get("calc"):           # 計算列（式）は独立の答えでは数えない
                    continue
                g = got["fields"].get(col)
                if g is None or any(g[k] != v for k, v in want.items() if k in g):
                    bad += 1
                    print(f"✕ {cs['name']} {col}: 事例 {want} / 独立の答え {g}")
            if "order" in cs and got["order"] != [c for c in cs["order"] if c in got["order"]]:
                bad += 1
                print(f"✕ {cs['name']} 並び: 事例 {cs['order']} / 独立の答え {got['order']}")
    print("OK" if not bad else f"{bad} 件の食い違い")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
