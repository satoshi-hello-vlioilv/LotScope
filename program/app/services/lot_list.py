# -*- coding: utf-8 -*-
"""ロット一覧（品質データ SQLite の写し）を引く。

絞り込み・並べ替え・ページの組み立ては WaveLog の /api/table（backend/routes/tables.py）と同じ:
    search  … どの列の字でも LIKE（列ごとに OR）
    filters … [{column, op, value}] を AND（最大 20 件）。op は WaveLog と同じ 12 種＋not_starts・not_ends＋starts_any＋in＋date_range
              （字を比べる op〈contains・not_contains・eq・neq・starts・not_starts・ends・not_ends〉と search は Excel と同じ
               * ?〈全角の ＊ ？ も〉を使える: * は何文字でも・? は 1 字・~ の後ろの * ? ~ はその字そのもの。like_pattern。版 3.54.0）
              （in はスライサー: value は値の JSON 配列で、どれかに当たる行。"" は空欄。key があれば見えている値で比べる）
              （date_range はタイムライン: value は "YYYY-MM-DD..YYYY-MM-DD"。日付と読める値のうち、その間（両端を含む）の行。片側は空でもよい）
    sorts   … [{column, dir}]（最大 4 キー）。実在する列だけを通す
    page / page_size … LIMIT / OFFSET
    group   … ロット番号でまとめる（grouped_rows）。並べ替えは効いたまま、ページの境目でロットを切らない
    marks   … 色付け（条件付き書式）: [[{column, op, value}, ...], ...]（最大 8 組）。行は絞らず、組ごとに
              「そのページで当たった行の位置」と「絞り込んだ全件で当たった数」を返す（mark_rows。判定は filters と同じ式）
列名は実在するものだけを SQL へ入れ（qi で括る）、値はすべてパラメータで渡す。
"""
import json
import os
import re
import sqlite3
import time
from datetime import date, datetime, timedelta

from .formula import clean_calc
from .formula import register as register_calc
from .sqlite_ro import connect_ro, numeric_value, qi, to_date

ALLOWED_OPS = {"contains", "not_contains", "eq", "neq", "starts", "not_starts", "starts_any", "ends", "not_ends",
               "gt", "gte", "lt", "lte", "empty", "not_empty",
               # 今日から数えて N 日（週・か月・年）以内。日付と読める値だけが当たる（ToDate(列) >= 今日−N）
               "within_days", "within_weeks", "within_months", "within_years",
               # スライサー: 選んだ値のどれか（slice_key で比べる。空欄も選べる）
               "in",
               # スライサーの計算列: 式が使う列（columns）の値の組のどれか（value は組の JSON 配列。画面が式の結果から選んだ組）
               "tuple_in",
               # タイムライン: 日付と読める値が、その間（両端を含む）にある行（value は "YYYY-MM-DD..YYYY-MM-DD"。片側は空でもよい）
               "date_range"}
# 字を LIKE で比べる op → (型の向き, 否定か)
LIKE_OPS = {"contains": ("contains", False), "not_contains": ("contains", True), "starts": ("starts", False),
            "not_starts": ("starts", True), "ends": ("ends", False), "not_ends": ("ends", True)}
RELATIVE_OPS = {"within_days": "days", "within_weeks": "weeks", "within_months": "months", "within_years": "years"}
DATE_SAMPLE = 60          # 日付の列か見分けるときに読む値の数
DATE_RATIO = 0.8          # そのうち日付と読める割合がこれ以上なら日付の列
MAX_FILTERS = 20
MAX_IN_VALUES = 1000      # スライサーで一度に選べる値の数
MAX_SLICER_VALUES = 1000  # スライサーに並べる値の数（超えたら truncated）
MAX_TUPLE_COLUMNS = 4     # 計算列のスライサー: 式が使う列の数の上限
MAX_COMBOS = 5000         # 計算列のスライサー: 値の組を並べる数（超えたら truncated）
MAX_SORTS = 4
MAX_MARKS = 8             # 色付け（条件付き書式）の組の数
MARK_VARS = 30000         # 色付けで 1 回に渡す値の数の上限（SQLite の上限 32766 の内側）
PAGE_SIZE_MAX = 5000
PAGE_SIZE_DEFAULT = 500
# 表の既定（WaveLog の品質データの「既定テーブル」＝仕掛、品質情報の読み方の候補）
TABLE_CANDIDATES = ["仕掛", "品質情報", "品質", "保留"]
LOT_COLUMN_CANDIDATES = ["ロット番号", "ﾛｯﾄ番号", "ロット№", "LTNO"]


def tables(conn):
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view') "
                        "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    return [r[0] for r in rows]


def pick_table(names, preferred="", candidates=TABLE_CANDIDATES):
    """設定の表 → 候補の完全一致 → 候補を含む名前 → 最初の表。"""
    if preferred and preferred in names:
        return preferred
    for c in candidates:
        if c in names:
            return c
    for c in candidates:
        for n in names:
            if c in n:
                return n
    return names[0] if names else ""


def raw_columns(conn, table):
    """表の列名を表の並びのまま（同じ名前が2つあってもそのまま。行の値と位置を合わせるため）。"""
    return [r[1] for r in conn.execute(f"PRAGMA table_info({qi(table)})").fetchall()]


def columns(conn, table, raw=None):
    """列名を1つずつ（行は dict なので同名を2つ持てない）。raw があれば表を読み直さない。"""
    return list(dict.fromkeys(raw if raw is not None else raw_columns(conn, table)))


def lot_column(cs, candidates=LOT_COLUMN_CANDIDATES):
    for c in candidates:
        if c in cs:
            return c
    for c in cs:
        if "ロット" in c or "ﾛｯﾄ" in c:
            return c
    return ""


def safe_filters(text, cs, calc=()):
    """calc … 計算列の名前（版 3.38.0。ダッシュボード。式は呼ぶ所が SQL の式にして build_filter_where の exprs で渡す）"""
    if not text:
        return []
    try:
        items = json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return []
    if not isinstance(items, list):
        return []
    out = []
    for it in items[:MAX_FILTERS]:
        if not isinstance(it, dict):
            continue
        col = str(it.get("column") or "").strip()
        op = str(it.get("op") or "contains").strip()
        val = str(it.get("value") or "").strip()
        if op == "tuple_in":
            cols = tuple_columns(it.get("columns"), cs)
            if cols:
                out.append({"column": col, "op": op, "value": val, "columns": cols})
            continue
        if (col in cs or col in calc) and op in ALLOWED_OPS:
            f = {"column": col, "op": op, "value": val}
            if op == "in":
                f["key"] = slice_key_kind(it.get("key"))
            out.append(f)
    return out


def tuple_columns(v, cs):
    """計算列のスライサーが渡す列の並び → 実在する列だけ（1〜4 列・重ならない）。合わなければ []。"""
    if not isinstance(v, list) or not 1 <= len(v) <= MAX_TUPLE_COLUMNS:
        return []
    cols = [str(x) for x in v]
    return cols if all(c in cs for c in cols) and len(set(cols)) == len(cols) else []


def tuple_values(value, n):
    """tuple_in の値（[[値, …], …] の JSON）→ 組の並び（長さ n の組だけ・数か字か null だけ・最大 MAX_IN_VALUES）。"""
    try:
        items = json.loads(value) if value else []
    except ValueError:
        return []
    ok = (str, int, float, type(None))

    def big(x):         # i64 を超える整数は実数（Rust と同じ）
        return float(x) if isinstance(x, int) and not -2 ** 63 <= x < 2 ** 63 else x
    out = [[big(x) for x in t] for t in (items if isinstance(items, list) else [])
           if isinstance(t, list) and len(t) == n and all(isinstance(x, ok) and not isinstance(x, bool) for x in t)]
    return out[:MAX_IN_VALUES]


def slice_key_kind(v):
    """スライサーで値をまとめる形: 日付だけ（date）・年月（month）・年（year）。ほかは ''（そのままの値）。"""
    k = sort_key_kind(v)
    return k if k in SORT_KEYS else ""


# 空欄の決まり（版 3.51.1）: 前後の空白（半角・全角・タブ・改行）を除いて空なら空欄。集計の段（pivot.sort_key は Python の strip）・
# スライサーの値・条件（値を選ぶ・空欄・空欄以外・＝・≠）で同じ決まりにする。前は条件が空白を除かずに比べ、空のとき空白で埋まる列
# （固定長の項目）で「空欄以外」が空白だけの行を通し、集計の「（空欄）」に残った（利用者の報告 2026-10-23）
BLANK_CHARS = "' ' || char(9, 10, 13, 12288)"


def trimmed(q):
    """列（か SQL の式）を字にして前後の空白を除いた式"""
    return f"TRIM(CStr({q}), {BLANK_CHARS})"


def slice_key(col, key="", expr=None):
    """スライサーの値（見えている値）の式。前後の空白を除き、空は NULL。
    日付だけ・年月・年で見せている列は、日付と読める値をその形に（時刻が違っても同じ日は 1 つ）。読めない値はそのまま。
    expr … 列の代わりの SQL の式（計算列）"""
    q = expr or qi(col)
    plain = f"NULLIF({trimmed(q)}, '')"
    if key in SORT_KEYS:
        head = {"date": f"ToDate({q})", "month": f"SUBSTR(ToDate({q}), 1, 7)", "year": f"SUBSTR(ToDate({q}), 1, 4)"}[key]
        return f"COALESCE({head}, {plain})"
    return plain


def in_values(value):
    """in の値（JSON 配列の文字）→ 字の並び。読めなければ空（何にも当たらない）。"""
    try:
        items = json.loads(value) if value else []
    except ValueError:
        return []
    return [x for x in items if isinstance(x, str)][:MAX_IN_VALUES] if isinstance(items, list) else []


def date_range(value):
    """date_range の値（"YYYY-MM-DD..YYYY-MM-DD"。片側は空でもよい）→ (始め, 終わり)。読めない側は None（その側は限らない）。"""
    def one(x):
        x = x.strip()
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", x):
            return None
        try:
            return date.fromisoformat(x).isoformat()
        except ValueError:
            return None
    head, _, tail = str(value or "").partition("..")
    return one(head), one(tail)


def cutoff_date(op, value, today=None):
    """「今日から N 単位前」の日付（'YYYY-MM-DD'）。N は 0 以上の整数（0＝今日から）。"""
    today = today or date.today()
    try:
        n = max(0, min(36500, int(float(str(value).strip()))))      # 100 年まで（版 3.52.1: 1e400・1e10 で 500 になった）
    except (ValueError, OverflowError):
        n = 0
    unit = RELATIVE_OPS[op]
    if unit == "days":
        d = today - timedelta(days=n)
    elif unit == "weeks":
        d = today - timedelta(weeks=n)
    else:
        months = n * (12 if unit == "years" else 1)
        y, m = divmod(today.year * 12 + today.month - 1 - months, 12)
        m += 1
        last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
        d = date(y, m, min(today.day, last))
    return d.isoformat()


def date_columns(conn, table, cs):
    """値の大半（8 割以上）が日付と読める列。空欄は数えない。"""
    out = []
    for col in cs:
        vals = [r[0] for r in conn.execute(
            f"SELECT {qi(col)} FROM {qi(table)} WHERE {qi(col)} IS NOT NULL AND CStr({qi(col)})<>'' LIMIT {DATE_SAMPLE}")]
        if vals and sum(1 for v in vals if to_date(v)) / len(vals) >= DATE_RATIO:
            out.append(col)
    return out


_DATE_CACHE = {}


def _date_columns_cached(path, conn, table, cs):
    """写しは世代ごとに別のファイルなので、(ファイル, 更新時刻, 表, 列) が同じなら前の答えを使う。"""
    try:
        st = os.stat(path)
        key = (str(path), st.st_mtime_ns, table, tuple(cs))
    except OSError:
        return date_columns(conn, table, cs)
    if key not in _DATE_CACHE:
        if len(_DATE_CACHE) > 32:
            _DATE_CACHE.clear()
        _DATE_CACHE[key] = date_columns(conn, table, cs)
    return _DATE_CACHE[key]


def date_hints(conn, table, filters, today=None):
    """0件のとき、「以内」の条件ごとに、なぜ当たらないかを言うための材料（表全体・ほかの条件は外して数える）。

    dated        … その列で日付と読めた行の数
    newest/raw   … いちばん新しい日付（読んだ日付と元の値。和暦の2桁の年などの読み違いがここで分かる）
    oldest       … いちばん古い日付
    cutoff       … この日付から後ろを探した（今日−N）
    alone        … この条件だけなら何件当たるか（0 でなければ、ほかの条件と重なって 0 件になっている）
    """
    out = []
    for f in filters:
        if f["op"] not in RELATIVE_OPS:
            continue
        col = qi(f["column"])
        cut = cutoff_date(f["op"], f["value"], today)
        dated, newest, oldest = conn.execute(
            f"SELECT COUNT(*), MAX(ToDate({col})), MIN(ToDate({col})) FROM {qi(table)} WHERE ToDate({col}) IS NOT NULL").fetchone()
        raw = None
        if newest:
            r = conn.execute(f"SELECT {col} FROM {qi(table)} WHERE ToDate({col}) = ? LIMIT 1", (newest,)).fetchone()
            raw = None if r is None else _json_value(r[0])
        alone = conn.execute(f"SELECT COUNT(*) FROM {qi(table)} WHERE ToDate({col}) >= ?", (cut,)).fetchone()[0]
        total = conn.execute(f"SELECT COUNT(*) FROM {qi(table)} WHERE {col} IS NOT NULL AND CStr({col})<>''").fetchone()[0]
        out.append({"column": f["column"], "op": f["op"], "value": f["value"], "cutoff": cut, "dated": int(dated or 0),
                    "filled": int(total or 0), "newest": newest, "newestRaw": raw, "oldest": oldest, "alone": int(alone or 0)})
    return out


# 値の印（Excel の * ?。全角も）→ LIKE の印。~ の後ろの印・~ はその字そのもの。LIKE の % _ と ESCAPE の \ は字として逃がす
WILDCARDS = {"*": "%", "＊": "%", "?": "_", "？": "_"}
LIKE_ESCAPE = "ESCAPE '\\'"


def like_pattern(value, mode="contains"):
    """値 → (LIKE の型, * ? を使ったか)。mode: contains（含む）・starts（で始まる）・ends（で終わる）・exact（全体が当たる）。
    Rust の lotlist.rs の like_pattern と同じ（tests/test_lot_list_wildcard.py が突き合わせる）。"""
    out, wild, chars, i = [], False, str(value), 0
    while i < len(chars):
        ch = chars[i]
        if ch == "~" and i + 1 < len(chars) and (chars[i + 1] in WILDCARDS or chars[i + 1] == "~"):
            i += 1
            ch = chars[i]
            out.append("\\" + ch if ch in "\\%_" else ch)
        elif ch in WILDCARDS:
            out.append(WILDCARDS[ch])
            wild = True
        else:
            out.append("\\" + ch if ch in "\\%_" else ch)
        i += 1
    p = "".join(out)
    return {"contains": f"%{p}%", "starts": f"{p}%", "ends": f"%{p}", "exact": p}[mode], wild


def unescape_wild(value):
    """* ? を使っていない値の、~ を外した字（「A~*B」→「A*B」。一致・不一致をそのまま比べるとき）。"""
    return re.sub(r"~([*＊?？~])", r"\1", str(value))


def search_filter_where(cs, search="", filters="", today=None, exprs=None):
    """一覧・スライサー・ピボット集計に共通の絞り込み（検索＋条件）→ (WHERE の式の並び, 値の並び)。条件は safe_filters を通す。
    exprs … 計算列の名前 → SQL の式（版 3.38.0。条件に使える。検索は表の列だけ＝一覧と同じ）"""
    where_parts, params = [], []
    q = (search or "").strip()
    if q:
        where_parts.append("(" + " OR ".join(f"CStr({qi(x)}) LIKE ? {LIKE_ESCAPE}" for x in cs) + ")")
        params += [like_pattern(q)[0]] * len(cs)
    fp, fpp = build_filter_where(safe_filters(filters, cs, tuple(exprs or ())), today, exprs)
    return where_parts + fp, params + fpp


def build_filter_where(filters, today=None, exprs=None):
    parts, params = [], []
    exprs = exprs or {}
    for f in filters:
        col, op, value = exprs.get(f["column"]) or qi(f["column"]), f["op"], f["value"]
        if op in LIKE_OPS:              # 字を比べる（* ? を使える）。否定は空欄も当たる（Excel と同じ）
            mode, negate = LIKE_OPS[op]
            pat, _ = like_pattern(value, mode)
            parts.append(f"(CStr({col}) NOT LIKE ? {LIKE_ESCAPE} OR {col} IS NULL)" if negate else f"CStr({col}) LIKE ? {LIKE_ESCAPE}")
            params.append(pat)
        elif op in ("eq", "neq"):       # 前後の空白は除いて比べる（集計の段と同じ値。空なら空欄と同じ）。* ? があれば全体を型で
            pat, wild = like_pattern(str(value).strip(), "exact")
            if wild:
                parts.append(f"COALESCE({trimmed(col)}, '') {'NOT ' if op == 'neq' else ''}LIKE ? {LIKE_ESCAPE}")
                params.append(pat)
            else:
                parts.append(f"COALESCE({trimmed(col)}, '')" + ("=?" if op == "eq" else "<>?"))
                params.append(unescape_wild(str(value).strip()))
        elif op == "starts_any":
            vals = [x for x in (value.split(",") if value else []) if x][:60]
            if not vals:
                parts.append("0=1")
            else:
                parts.append("(" + " OR ".join(f"CStr({col}) LIKE ?" for _ in vals) + ")")
                params += [f"{v}%" for v in vals]
        elif op == "empty":
            parts.append(f"COALESCE({trimmed(col)}, '')=''")
        elif op == "not_empty":
            parts.append(f"COALESCE({trimmed(col)}, '')<>''")
        elif op == "in":
            vals = in_values(value)
            k = slice_key(f["column"], f.get("key", ""), exprs.get(f["column"]))
            some = [v for v in vals if v != ""]
            ors = ([f"{k} IN ({','.join('?' * len(some))})"] if some else []) + ([f"{k} IS NULL"] if "" in vals else [])
            parts.append("(" + " OR ".join(ors) + ")" if ors else "0=1")
            params += some
        elif op == "tuple_in":
            # 値の組のどれか。IS で比べる（空＝NULL の組も当たる・数は数で比べる）
            cols = [qi(x) for x in f["columns"]]
            tuples = tuple_values(value, len(cols))
            one = "(" + " AND ".join(f"{x} IS ?" for x in cols) + ")"
            parts.append("(" + " OR ".join([one] * len(tuples)) + ")" if tuples else "0=1")
            params += [v for t in tuples for v in t]
        elif op == "date_range":
            # 日付と読める値だけが当たる（両側とも読めなければ、日付と読める行すべて）
            lo, hi = date_range(value)
            parts.append("(" + " AND ".join([f"ToDate({col}) IS NOT NULL"] + [f"ToDate({col}) {s} ?" for s, v in ((">=", lo), ("<=", hi)) if v]) + ")")
            params += [v for v in (lo, hi) if v]
        elif op in RELATIVE_OPS:
            parts.append(f"ToDate({col}) >= ?")
            params.append(cutoff_date(op, value, today))
        elif op in ("gt", "gte", "lt", "lte"):
            sign = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            parts.append(f"Val(CStr({col})) {sign} ?")
            params.append(numeric_value(value))
    return parts, params


def safe_marks(text, cs):
    """色付け（条件付き書式）の組の並び。→ [条件の並び または None]。
    組の中に、無い列・使えない比べ方の条件が 1 つでもあれば None（当てない。外して当てると、広く当たってしまう）。"""
    try:
        items = json.loads(text) if isinstance(text, str) and text else (text or [])
    except ValueError:
        return []
    if not isinstance(items, list):
        return []
    out = []
    for rule in items[:MAX_MARKS]:
        given = [f for f in rule if isinstance(f, dict)][:MAX_FILTERS] if isinstance(rule, list) else []
        fl = safe_filters(given, cs)
        out.append(fl if given and len(fl) == len(given) else None)
    return out


def mark_rows(c, marks, rows, today=None):
    """色付け: ページの行（{列: 値}）が、どの組に当たるか。→ 組ごとに当たった行の位置（0 から）の並び。
    判定は絞り込みと同じ式（build_filter_where）を、その行の値だけを並べた表（VALUES）に当てる
    （行を引く SQL は変えないので、どのまとめ方でも同じに効く。Rust の lotlist.rs も同じ作り）。"""
    out = [[] for _ in marks]
    live = [(k, build_filter_where(fl, today)) for k, fl in enumerate(marks) if fl]
    if not live or not rows:
        return out
    cols = sorted({x for k, _ in live for f in marks[k] for x in (f["columns"] if f["op"] == "tuple_in" else [f["column"]])})
    names = ["_tpa_i", *cols]
    sel = ", ".join("(" + " AND ".join(parts) + ")" for _, (parts, _) in live)
    tail = [v for _, (_, ps) in live for v in ps]
    step = max(1, (MARK_VARS - len(tail)) // len(names))
    for s in range(0, len(rows), step):
        part = rows[s:s + step]
        vals = ", ".join("(" + ", ".join("?" * len(names)) + ")" for _ in part)
        args = [v for i, r in enumerate(part, s) for v in (i, *(r.get(x) for x in cols))]
        sql = f"WITH m({', '.join(qi(n) for n in names)}) AS (VALUES {vals}) SELECT {qi('_tpa_i')}, {sel} FROM m"
        for r in c.execute(sql, args + tail):
            for j, (k, _) in enumerate(live):
                if r[1 + j]:
                    out[k].append(int(r[0]))
    return out


def mark_counts(c, t, marks, where, params, today=None):
    """色付け: 絞り込んだ全件のうち、組ごとに当たる行の数（当てない組は None）。"""
    out = []
    for fl in marks:
        if not fl:
            out.append(None)
            continue
        parts, ps = build_filter_where(fl, today)
        sql = f"SELECT COUNT(*) FROM {qi(t)}" + (where + " AND " if where else " WHERE ") + " AND ".join(parts)
        out.append(int(c.execute(sql, list(params) + ps).fetchone()[0]))
    return out


SORT_KEYS = ("date", "month", "year")      # 並べ替えの鍵の形（画面の書式に合わせる。round:N は小数 N 桁で丸めた数）


def sort_key_kind(v):
    """並べ替えの鍵の形（画面が列の書式から決める）。日付だけ・年月・年・丸めた数。分からなければ ''（そのままの値）。"""
    k = str(v or "").strip().lower()
    if k in SORT_KEYS:
        return k
    m = re.fullmatch(r"round:([0-9]{1,2})", k)
    return f"round:{min(int(m.group(1)), 10)}" if m else ""


def safe_sorts(text, cs):
    """並べ替え → [(列, ASC|DESC, 鍵の形)]。実在する列だけ・同じ列は最初の1つ・最大4つ。"""
    try:
        items = json.loads(text) if isinstance(text, str) and text else (text or [])
    except ValueError:
        items = []
    out = []
    for it in (items if isinstance(items, list) else []):
        if isinstance(it, str):
            it = {"column": it}
        if not isinstance(it, dict):
            continue
        col = str(it.get("column") or "").strip()
        if col not in cs or any(col == c for c, _, _ in out):
            continue
        out.append((col, "DESC" if str(it.get("dir") or "").lower() == "desc" else "ASC", sort_key_kind(it.get("key"))))
        if len(out) >= MAX_SORTS:
            break
    return out


def order_key(col, lot="", key="", expr=None):
    """並べ替えに使う式（「並び・まとめ」の見分けと同じ鍵。→ 式の並び）。
    - ふだん: SortKey(列)（空欄は1つ・数に読める字は数・前後の空白を除く）。ロット番号の列は大小を同じに見る
    - 画面がその列を日付だけ（date）・年月（month）・年（year）で見せているとき: ToDate(列) の頭。時刻が違っても同じ日は隣り合う。
      日付と読めない値はその後ろで SortKey（読めた値には効かない＝下の段の並びを崩さない）
    - 小数 N 桁で見せているとき（round:N）: 数は丸めた値、数でない値は SortKey
    expr … 列の代わりの SQL の式（計算列。formula.register）"""
    q = expr or qi(col)
    if key in SORT_KEYS:
        head = {"date": f"ToDate({q})", "month": f"SUBSTR(ToDate({q}), 1, 7)", "year": f"SUBSTR(ToDate({q}), 1, 4)"}[key]
        return [head, f"CASE WHEN ToDate({q}) IS NULL THEN SortKey({q}) END"]
    if key.startswith("round:"):
        n = int(key[6:])
        return [f"CASE WHEN typeof(SortKey({q})) IN ('integer', 'real') THEN ROUND(SortKey({q}), {n}) ELSE SortKey({q}) END"]
    return [f"SortKey(UPPER(CStr({q})))" if col == lot else f"SortKey({q})"]


def order_sql(order_parts, lot, exprs=None):
    """[(列, 向き[, 鍵の形])] → ORDER BY の後ろ（無ければ ''）。exprs … 計算列の名前 → SQL の式"""
    out = []
    for part in order_parts:
        col, d, key = (tuple(part) + ("",))[:3]
        out += [f"{x} {d}" for x in order_key(col, lot, key, (exprs or {}).get(col))]
    return ",".join(out)


def lot_key(col):
    """まとめるときのロットの見分け方（大小・前後の空白は同じロット）。"""
    return f"UPPER(TRIM(CStr({qi(col)})))"


ROWID_NAMES = ("rowid", "_rowid_", "oid")    # SQLite の行番号の呼び名（同じ名前の列があると、その列を指す）


def rowid_name(c, t, raw_cs):
    """行番号を読める呼び名。ビュー（行番号が NULL）・WITHOUT ROWID の表・3つとも列の名前に使われている表は None。"""
    kind = c.execute("SELECT type FROM sqlite_master WHERE name = ?", (t,)).fetchone()
    if not kind or kind[0] != "table":
        return None
    for name in ROWID_NAMES:
        if name.lower() in (x.lower() for x in raw_cs):
            continue
        try:
            c.execute(f"SELECT {name} FROM {qi(t)} LIMIT 0")
            return name
        except sqlite3.Error:
            return None
    return None


def grouped_rows(c, t, raw_cs, lot, where, params, order_parts, page, size, key_sql=None, lead=(), exprs=None):
    """ロット番号でまとめた並びの1ページ分。→ (行, [[そのロットの行数, ロットの中の何行目], ...], 最初の位置, 最後の位置)

    - ロットの順は、並べ替え（無ければ表の順）で「そのロットでいちばん上に来る行」の順。ロットの中も同じ並べ替えの順。
      こうすると並べ替えは、ロットの間でも中でも効いたままになる。
    - ロットは、その先頭の行が入るページに丸ごと入る（ページの境目で切らない。そのぶん1ページが size を少し超える）。
      大きいロットが次の区切りをまたいで、先頭の行が1つも入らない区切りができたら、その区切りは飛ばす（空のページを作らない）。
    - ロット番号が空の行はまとめない（1行ずつ）。
    - 並びは「行番号・並べ替えの順・ロットの見分け」だけで決め、そのページの行だけを後から読む（全部の列を窓関数の段ごとに
      持ち回さない。3 万行 × 40 列で 1.6 秒 → 0.25 秒・答えは同じ）。行番号を読めない表（ビューなど）は全部の列で決める。
    - key_sql・lead: ロット番号の代わりにまとめる鍵の式と、並べ替えの前に置く式（作業実績の「作業でまとめる」。query の grouping）。"""
    if sqlite3.sqlite_version_info < (3, 25):     # 窓関数（ROW_NUMBER など）は SQLite 3.25 から
        raise RuntimeError(f"この PC の SQLite（{sqlite3.sqlite_version}）では「ロット番号でまとめる」を使えません。"
                           "「表の見せ方」の「機能」でまとめるを外してください。")
    got = c.execute(grouped_sql(t, raw_cs, lot, where, order_parts, size, rowid_name(c, t, raw_cs), key_sql, lead, exprs),
                    list(params) + [page]).fetchall()
    n = len(raw_cs)
    rows = [r[:n] for r in got]
    groups = [[int(r[n]), int(r[n + 1])] for r in got]
    return rows, groups, (int(got[0][n + 2]) if got else 0), (int(got[-1][n + 2]) if got else 0)


def grouped_sql(t, raw_cs, lot, where, order_parts, size, rid=None, key_sql=None, lead=(), exprs=None):
    """まとめた並びの SQL（デスクトップ版の Rust・desktop/src/lotlist.rs も同じ文を作る。key_sql・lead・exprs は Python だけ）。最後の ? はページ。"""
    by = ",".join([*lead, order_sql(order_parts, lot, exprs)] if order_parts else list(lead))
    over = ("ORDER BY " + by) if by else ""
    key = key_sql or lot_key(lot)
    cols = ", ".join(qi(x) for x in raw_cs)
    steps = """
        k AS (SELECT *, CASE WHEN _tpa_k0 = '' THEN '#' || _tpa_rn ELSE _tpa_k0 END AS _tpa_k FROM b),
        g AS (SELECT *, MIN(_tpa_rn) OVER (PARTITION BY _tpa_k) AS _tpa_first, COUNT(*) OVER (PARTITION BY _tpa_k) AS _tpa_n FROM k),
        p AS (SELECT *, ROW_NUMBER() OVER (ORDER BY _tpa_first, _tpa_rn) AS _tpa_pos FROM g),
        q AS (SELECT *, MIN(_tpa_pos) OVER (PARTITION BY _tpa_k) AS _tpa_head FROM p),"""
    page = f"r AS (SELECT *, DENSE_RANK() OVER (ORDER BY (_tpa_head - 1) / {int(size)}) AS _tpa_page FROM q)"
    if rid:
        tail = ", ".join(f"{qi(t)}.{qi(x)}" for x in raw_cs)
        return (f"WITH b AS (SELECT {rid} AS _tpa_id, ROW_NUMBER() OVER ({over}) AS _tpa_rn, {key} AS _tpa_k0 FROM {qi(t)}{where}),"
                f"{steps} {page} SELECT {tail}, r._tpa_n, r._tpa_pos - r._tpa_head + 1, r._tpa_pos FROM r "
                f"JOIN {qi(t)} ON {qi(t)}.{rid} = r._tpa_id WHERE r._tpa_page = ? ORDER BY r._tpa_pos")
    return (f"WITH b AS (SELECT *, ROW_NUMBER() OVER ({over}) AS _tpa_rn, {key} AS _tpa_k0 FROM {qi(t)}{where}),"
            f"{steps} {page} SELECT {cols}, _tpa_n, _tpa_pos - _tpa_head + 1, _tpa_pos FROM r WHERE _tpa_page = ? ORDER BY _tpa_pos")


def group_count(c, t, lot, where, params, key_sql=None):
    """まとめたときのロットの数（ロット番号が空の行は1行ずつ数える）。key_sql はロット番号の代わりの鍵（作業でまとめる）。"""
    return int(c.execute(f"SELECT COUNT(DISTINCT NULLIF(k, '')) + COALESCE(SUM(k = ''), 0) FROM "
                         f"(SELECT {key_sql or lot_key(lot)} AS k FROM {qi(t)}{where})", params).fetchone()[0])


def _json_value(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat(sep=" ") if isinstance(v, datetime) else v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"（バイナリ {len(bytes(v))} バイト）"
    return v


def slicer(path, *, column, key="", table="", preferred_table="", search="", filters="", today=None, table_candidates=TABLE_CANDIDATES):
    """スライサーに並べる値（重複なし）と、ほかの絞り込みのもとでの件数。
    件数 0 の値も出す（今の絞り込みでは当たらないが、選べる値）。並びは SortKey の小さい順で、空欄は最後。"""
    t0 = time.perf_counter()
    q = (search or "").strip()
    with connect_ro(path) as c:
        names = tables(c)
        t = table if table in names else pick_table(names, preferred_table, table_candidates)
        if not t:
            raise RuntimeError(f"{'品質データ' if table_candidates is TABLE_CANDIDATES else 'データ'}にテーブルが1つもありません。")
        cs = columns(c, t, raw_columns(c, t))
        if column not in cs:
            raise ValueError(f"列「{column}」がありません。")
        kind = slice_key_kind(key)
        where_parts, params = search_filter_where(cs, q, filters, today)
        hit = f"SUM(CASE WHEN {' AND '.join(where_parts)} THEN 1 ELSE 0 END)" if where_parts else "COUNT(*)"
        k = slice_key(column, kind)
        sql = (f"SELECT v, n, a FROM (SELECT {k} AS v, {hit} AS n, COUNT(*) AS a FROM {qi(t)} GROUP BY 1)"
               f" ORDER BY v IS NULL, SortKey(v), v LIMIT {MAX_SLICER_VALUES + 1}")
        rows = c.execute(sql, params).fetchall()
    return {
        "table": t, "column": column, "key": kind,
        "values": [{"value": "" if v is None else str(v), "count": int(n or 0), "all": int(a)} for v, n, a in rows[:MAX_SLICER_VALUES]],
        "truncated": len(rows) > MAX_SLICER_VALUES,
        "timing": {"server": round((time.perf_counter() - t0) * 1000)},
    }


def slicer_combos(path, *, use, table="", preferred_table="", search="", filters="", today=None, table_candidates=TABLE_CANDIDATES):
    """計算列のスライサー: 式が使う列（use: 列名の JSON 配列）の値の組（重複なし・元の型のまま）と、ほかの絞り込みのもとでの件数。
    画面が組ごとに式を計算し、同じ結果を足してスライサーの値にする（式は画面にしか無い: list-formula.js）。並びは件数の多い順。"""
    t0 = time.perf_counter()
    q = (search or "").strip()
    with connect_ro(path) as c:
        names = tables(c)
        t = table if table in names else pick_table(names, preferred_table, table_candidates)
        if not t:
            raise RuntimeError("表が 1 つもありません。")
        cs = columns(c, t, raw_columns(c, t))
        try:
            want = json.loads(use) if isinstance(use, str) else use
        except ValueError:
            want = None
        cols = tuple_columns(want, cs)
        if not cols:
            raise ValueError(f"計算列のスライサーは、表にある列を 1〜{MAX_TUPLE_COLUMNS} 個使う式だけです。")
        where_parts, params = search_filter_where(cs, q, filters, today)
        hit = f"SUM(CASE WHEN {' AND '.join(where_parts)} THEN 1 ELSE 0 END)" if where_parts else "COUNT(*)"
        keys = ", ".join(qi(x) for x in cols)
        # 件数が同じ組の順も決める（Rust の lotlist.rs と同じ並びにする）: 列ごとに SortKey → 元の値
        tie = ", ".join(f"SortKey({qi(x)}), {qi(x)}" for x in cols)
        rows = c.execute(f"SELECT {keys}, {hit} AS n, COUNT(*) AS a FROM {qi(t)} GROUP BY {keys} ORDER BY n DESC, a DESC, {tie} LIMIT {MAX_COMBOS + 1}",
                         params).fetchall()
    k = len(cols)
    return {
        "table": t, "columns": cols,
        "combos": [{"values": [_json_value(v) for v in r[:k]], "count": int(r[k] or 0), "all": int(r[k + 1])} for r in rows[:MAX_COMBOS]],
        "truncated": len(rows) > MAX_COMBOS,
        "timing": {"server": round((time.perf_counter() - t0) * 1000)},
    }


def slicer_answer(path, args, **kw):
    """スライサーの問い合わせ（一覧の元ごとの道が同じに呼ぶ）: columns があれば計算列の値の組（slicer_combos）、無ければ列の値（slicer）。"""
    common = dict(table=args.get("table", ""), search=args.get("search", ""), filters=args.get("filters", ""), **kw)
    if args.get("columns"):
        return slicer_combos(path, use=args.get("columns"), **common)
    return slicer(path, column=args.get("column", ""), key=args.get("key", ""), **common)


def query(path, *, table="", preferred_table="", page=1, page_size=PAGE_SIZE_DEFAULT, search="",
          filters="", sorts="", today=None, group=False, table_candidates=TABLE_CANDIDATES, grouping=None, marks="", calc=None):
    """1 ページ分。表は table（あれば）→ preferred_table → table_candidates の順に探す（作業実績は別の候補を渡す）。
    grouping: ロット番号の代わりの鍵でまとめる係（作業実績の「作業でまとめる」。services/work_summary.py の Grouping）。
        grouping.prepare(接続, 表, 列) → まとめるなら {"key": 鍵の式, "lead": [並べ替えの前に置く式], "where": ([式], [値])?}・まとめないなら None
        grouping.extra(接続, 表, 列, 日付の列, where, params, 行) → 答えに足す物（dict。where は係の絞り込みを外した物）
    calc: 計算列（表示列の設定の式。{formulas, names} か その JSON の字。formula.clean_calc）。並べ替えに計算列を使える（版 3.42.0。
        画面は計算列で並べ替えるときだけ送る。デスクトップ版の Rust は式を持たないので、その問い合わせは Python が答える: engine=python）"""
    t0 = time.perf_counter()
    page = max(1, int(page or 1))
    size = min(PAGE_SIZE_MAX, max(1, int(page_size or PAGE_SIZE_DEFAULT)))
    q = (search or "").strip()
    with connect_ro(path) as c:
        names = tables(c)
        t = table if table in names else pick_table(names, preferred_table, table_candidates)
        if not t:
            raise RuntimeError(f"{'品質データ' if table_candidates is TABLE_CANDIDATES else 'データ'}にテーブルが1つもありません。")
        raw_cs = raw_columns(c, t)
        cs = columns(c, t, raw_cs)
        fl = safe_filters(filters, cs)
        where_parts, params = search_filter_where(cs, q, fl, today)
        base_where, base_params = (" WHERE " + " AND ".join(where_parts)) if where_parts else "", list(params)
        lot = lot_column(cs)
        exprs, _, _ = register_calc(c, clean_calc(calc), raw_cs, qi)
        order_parts = safe_sorts(sorts, cs + [x for x in exprs if x not in cs])
        plan = grouping.prepare(c, t, cs) if grouping else None
        if plan and plan.get("where"):             # まとめの係の絞り込み（作業実績の帯で押した日・直）。数の帯（extra）は外した物で数える
            where_parts = where_parts + plan["where"][0]
            params = params + plan["where"][1]
        where = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        lead = list(plan["lead"]) if plan else []
        by = ",".join(lead + ([order_sql(order_parts, lot, exprs)] if order_parts else []))
        order = (" ORDER BY " + by) if by else ""
        count = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}" + where, params).fetchone()[0])
        start = (page - 1) * size
        grouped = {}
        if plan:
            rows, groups, first, last = grouped_rows(c, t, raw_cs, lot, where, params, order_parts, page, size, plan["key"], lead, exprs)
            grouped = {"groups": groups, "groupCount": group_count(c, t, lot, where, params, plan["key"])}
        elif group and lot:
            rows, groups, first, last = grouped_rows(c, t, raw_cs, lot, where, params, order_parts, page, size, exprs=exprs)
            grouped = {"groups": groups, "groupCount": group_count(c, t, lot, where, params)}
        else:
            rows = c.execute(f"SELECT * FROM {qi(t)}" + where + order + f" LIMIT {size} OFFSET {start}", params).fetchall()
            first, last = (start + 1, start + len(rows)) if rows else (0, 0)
        dcols = _date_columns_cached(path, c, t, cs)
        hints = date_hints(c, t, fl, today) if count == 0 else []
        dict_rows = [{col: _json_value(v) for col, v in zip(raw_cs, r)} for r in rows]
        extra = grouping.extra(c, t, cs, dcols, base_where, base_params, dict_rows) if grouping else {}
        ml = safe_marks(marks, cs)
        if ml:
            extra["marks"] = mark_rows(c, ml, dict_rows, today)
            extra["markCounts"] = mark_counts(c, t, ml, where, params, today)
    return {
        "table": t, "tables": names, "columns": cs, "lotColumn": lot, "dateColumns": dcols,
        "today": (today or date.today()).isoformat(), "dateHints": hints,
        "rows": dict_rows,
        "count": count, "page": page, "page_size": size, "range": [first, last], **grouped,
        "filters_applied": len(fl), "sorts": [{"column": col, "dir": d.lower(), **({"key": k} if k else {})} for col, d, k in order_parts],
        "timing": {"server": round((time.perf_counter() - t0) * 1000)}, **extra,
    }
