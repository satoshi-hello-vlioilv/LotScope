# -*- coding: utf-8 -*-
"""計算列の式（static/js/list-formula.js。WaveLog と同じ書き方）を、サーバーでも同じ答えで計算する（版 3.38.0）。

利用者の要望（2026-10）: ダッシュボードで、一覧の表示列で作った列（計算列）も使えるようにする。
計算列の式は画面だけにあり、ダッシュボードの数はサーバー（services/pivot.py）が数えるので、同じ式をここでも計算する。

同じ答えにするための決まり（JavaScript の動きに合わせる。試験 tests/test_formula_parity.py が、画面の式と同じ入力で突き合わせる）:
- 数は倍精度の実数（JavaScript の Number）。字にするときは JavaScript の String(数) と同じ書き方（js_text）
- 字の長さ・位置・切り出し（len・left・right・mid・find・padleft・replace の空の字）は UTF-16 の単位で数える
- 前後の空白（trim）・字の区切りの空白は JavaScript の空白（全角の空白 U+3000 なども）
- 字どうしの大小は UTF-16 の単位の順
- 正規表現（extract・match・regreplace）は JavaScript の書き方を Python の書き方へ読み替える（js_regex）。\\d・\\w・\\b は英数字だけ、
  \\s は JavaScript の空白、. は改行（\\n \\r U+2028 U+2029）以外、$ は字の終わりだけ、(?<名前>…)・\\k<名前>。置き換えの $1・$&・$<名前> も
- 壊れた式は読むとき（compile）に断り、行ごとの失敗（正規表現が読めない等）はその行だけ空（None）にする
合わない所（分かっていて残す）: round の桁に小数を書いたとき（round(x, 2.5)）の最後の桁（10 の 2.5 乗の計算の仕方が JavaScript と違う）・
U+10000 以上の字（絵文字など）を正規表現で扱うとき（JavaScript は 2 つの単位、Python は 1 字と数える）
"""
from __future__ import annotations

import json
import math
import re
import unicodedata

MAX_LEN = 2000
RE_MAX = 200
JS_WS = "\t\n\v\f\r                  　﻿"
_WS = set(JS_WS)


class FormulaError(ValueError):
    pass


# ---------------------------------------------------------------- 字（UTF-16 の単位）
def _bmp(s):
    return not s or max(s) < "\U00010000"


def _units(s):
    return s.encode("utf-16-le", "surrogatepass")


def _from_units(b):
    return b.decode("utf-16-le", "surrogatepass")


def u16len(s):
    return len(s) if _bmp(s) else len(_units(s)) // 2


def u16slice(s, start, end=None):
    """JavaScript の String.prototype.slice（位置は UTF-16 の単位。負は後ろから。小数は 0 の側へ切る）"""
    n = u16len(s)

    def at(v, dflt):
        if v is None:
            return dflt
        if isinstance(v, float):
            if math.isnan(v):
                return 0
            if math.isinf(v):
                return n if v > 0 else 0
            v = int(v)               # 0 の側へ切る（ToIntegerOrInfinity）
        return max(n + v, 0) if v < 0 else min(v, n)
    a, b = at(start, 0), at(end, n)
    if a >= b:
        return ""
    if _bmp(s):
        return s[a:b]
    return _from_units(_units(s)[2 * a:2 * b])


def u16index(s, sub):
    if _bmp(s) and _bmp(sub):
        return s.find(sub)
    hay, needle = _units(s), _units(sub)
    i = hay.find(needle)
    while i >= 0 and i % 2:
        i = hay.find(needle, i + 1)
    return -1 if i < 0 else i // 2


def _u16order(a, b):
    """字の大小（-1/0/1）を UTF-16 の単位の順で（JavaScript の < と同じ。U+10000 以上の字は 2 つの単位で比べる）"""
    if not (_bmp(a) and _bmp(b)):
        a, b = a.encode("utf-16-be", "surrogatepass"), b.encode("utf-16-be", "surrogatepass")
    return -1 if a < b else 1 if a > b else 0


def _u16list(s):
    if _bmp(s):
        return list(s)
    b = _units(s)
    return [_from_units(b[i:i + 2]) for i in range(0, len(b), 2)]


def js_trim(s):
    return s.strip(JS_WS)


# ---------------------------------------------------------------- 数と字（JavaScript と同じ）
_REPR = re.compile(r"([0-9]+)(?:\.([0-9]*))?(?:e([+-]?[0-9]+))?")


def js_num_text(f):
    """JavaScript の String(数)"""
    if isinstance(f, int) and not isinstance(f, bool):
        f = float(f) if abs(f) >= 2 ** 53 else f
        if isinstance(f, int):
            return str(f)
    if math.isnan(f):
        return "NaN"
    if math.isinf(f):
        return "Infinity" if f > 0 else "-Infinity"
    if f == 0:
        return "0"
    sign = "-" if f < 0 else ""
    m = _REPR.fullmatch(repr(abs(f)))
    ip, fp, ex = m.group(1), m.group(2) or "", int(m.group(3) or 0)
    digits, point = ip + fp, len(ip) + ex
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    k, n = len(digits), point
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def text_of(v):
    if v is None:
        return ""
    if _is_num(v):
        return js_num_text(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return str(v)


_PARSE_FLOAT = re.compile(r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")


def num_of(v):
    """list-formula.js の numOf（parseFloat。, は除く・頭の数だけ読む・数に読めなければ None）"""
    if v is None or v == "":
        return None
    if _is_num(v):
        return float(v)
    s = text_of(v).replace(",", "").lstrip(JS_WS)
    m = _PARSE_FLOAT.match(s)
    if not m:
        return None
    t = m.group(0)
    if t.endswith("Infinity"):
        return None                 # 数ではあるが有限でない（JavaScript の Number.isFinite で外す）
    f = float(t)
    return f if math.isfinite(f) else None


def truthy(v):
    n = num_of(v)
    return text_of(v) != "" if n is None else n != 0


_LOOSE = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)")
_DECIMAL = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def _loose_num(v):
    t = js_trim(text_of(v)).replace(",", "")
    if not t or not _LOOSE.fullmatch(t):
        return None
    f = float(t)
    return f if math.isfinite(f) else None


def js_cmp(a, b):
    """表示ルールと同じ比べ方（-1/0/1）"""
    x, y = _loose_num(a), _loose_num(b)
    if x is not None and y is not None:
        return -1 if x < y else 1 if x > y else 0
    return _u16order(text_of(a), text_of(b))


def _strict_num(v):
    if _is_num(v):
        return float(v)
    s = js_trim(text_of(v))
    if s == "" or not _DECIMAL.fullmatch(s):
        return None
    f = float(s)
    return f if math.isfinite(f) and js_num_text(f) == s else None


# ---------------------------------------------------------------- 正規表現（JavaScript → Python）
_RE_CACHE = {}
_LINE = "\n\r  "
_CLASS_WS = re.escape(JS_WS)


def js_regex(src, flags=""):
    k = (flags, src)
    hit = _RE_CACHE.get(k)
    if hit is not None:
        return hit
    if len(src) > RE_MAX:
        raise FormulaError(f"正規表現は{RE_MAX}文字までです")
    try:
        rx = re.compile(_translate(src), re.ASCII)
    except re.error as e:
        raise FormulaError(str(e)) from None
    if len(_RE_CACHE) > 200:
        _RE_CACHE.clear()
    _RE_CACHE[k] = rx
    return rx


_KEEP_ESC = set("bBdDwWfnrtv")


def _translate(src):
    out, i, n, in_class = [], 0, len(src), False
    while i < n:
        ch = src[i]
        if ch == "\\" and i + 1 < n:
            nx = src[i + 1]
            if nx == "s":
                out.append(_CLASS_WS if in_class else f"[{_CLASS_WS}]")
            elif nx == "S":
                out.append("\\S" if in_class else f"[^{_CLASS_WS}]")
            elif nx == "k" and src[i + 2:i + 3] == "<" and ">" in src[i + 3:]:
                j = src.index(">", i + 3)
                out.append(f"(?P={src[i + 3:j]})")
                i = j + 1
                continue
            elif nx == "c" and i + 2 < n and src[i + 2].isascii() and src[i + 2].isalpha():
                out.append(re.escape(chr(ord(src[i + 2]) % 32)))
                i += 3
                continue
            elif nx == "x" and re.fullmatch(r"[0-9A-Fa-f]{2}", src[i + 2:i + 4]):
                out.append(src[i:i + 4])
                i += 4
                continue
            elif nx == "u" and re.fullmatch(r"[0-9A-Fa-f]{4}", src[i + 2:i + 6]):
                out.append(src[i:i + 6])
                i += 6
                continue
            elif nx == "0" and not src[i + 2:i + 3].isdigit():
                out.append("\\x00")
            elif nx.isdigit() or nx in _KEEP_ESC:
                out.append("\\" + nx)
            elif nx.isascii() and nx.isalpha():
                out.append(re.escape(nx))      # JavaScript では知らない英字の \ は、その字そのもの
            else:
                out.append("\\" + nx)
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            out.append(ch)
            i += 1
            continue
        if ch == "[":
            if src.startswith("[^]", i):
                out.append("[\\s\\S]")
                i += 3
                continue
            if src.startswith("[]", i):
                out.append("(?!)")
                i += 2
                continue
            in_class = True
            out.append(ch)
            if src[i + 1:i + 2] == "^":
                out.append("^")
                i += 1
            if src[i + 1:i + 2] == "]":      # [] の頭の ] は字（Python も同じ）
                out.append("\\]")
                i += 1
            i += 1
            continue
        if ch == "(" and src.startswith("(?<", i) and src[i + 3:i + 4] not in ("=", "!"):
            out.append("(?P<")
            i += 3
            continue
        if ch == ".":
            out.append(f"[^{_LINE}]")
        elif ch == "$":
            out.append("\\Z")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _js_replacement(rep):
    """JavaScript の置き換えの字（$1・$&・$$・$`・$'・$<名前>）→ 合った物ごとに字を作る関数"""
    def make(m):
        s, out, i, n = m.string, [], 0, len(rep)
        groups = m.re.groups
        while i < n:
            ch = rep[i]
            if ch != "$" or i + 1 >= n:
                out.append(ch)
                i += 1
                continue
            nx = rep[i + 1]
            if nx == "$":
                out.append("$")
                i += 2
            elif nx == "&":
                out.append(m.group(0))
                i += 2
            elif nx == "`":
                out.append(s[:m.start()])
                i += 2
            elif nx == "'":
                out.append(s[m.end():])
                i += 2
            elif nx.isdigit() and nx.isascii():
                two = rep[i + 1:i + 3]
                if len(two) == 2 and two.isdigit() and two.isascii() and 1 <= int(two) <= groups:
                    out.append(m.group(int(two)) or "")
                    i += 3
                elif 1 <= int(nx) <= groups:
                    out.append(m.group(int(nx)) or "")
                    i += 2
                else:
                    out.append("$" + nx)
                    i += 2
            elif nx == "<" and m.re.groupindex and ">" in rep[i + 2:]:
                j = rep.index(">", i + 2)
                name = rep[i + 2:j]
                out.append((m.group(name) or "") if name in m.re.groupindex else "")
                i = j + 1
            else:
                out.append("$")
                i += 1
        return "".join(out)
    return make


# ---------------------------------------------------------------- 字句解析・構文解析（list-formula.js と同じ）
_NUM = re.compile(r"[0-9]+(?:\.[0-9]+)?")
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _lex(src):
    out, i, s = [], 0, str(src or "")
    while i < len(s):
        ch = s[i]
        if ch in _WS:
            i += 1
            continue
        if ch == "[":
            end = s.find("]", i + 1)
            if end < 0:
                raise FormulaError("列名の [ ] が閉じていません")
            out.append(("col", s[i + 1:end]))
            i = end + 1
            continue
        if ch in "'\"":
            j = s.find(ch, i + 1)
            if j < 0:
                raise FormulaError("文字列の引用符が閉じていません")
            out.append(("str", s[i + 1:j]))
            i = j + 1
            continue
        m = _NUM.match(s, i)
        if m:
            out.append(("num", float(m.group(0))))
            i = m.end()
            continue
        two = s[i:i + 2]
        if two in ("<=", ">=", "<>", "!="):
            out.append(("op", "<>" if two == "!=" else two))
            i += 2
            continue
        if ch in "+-*/%(),":
            out.append((ch if ch in "()," else "op", ch))
            i += 1
            continue
        if ch in "=<>":
            out.append(("op", ch))
            i += 1
            continue
        m = _NAME.match(s, i)
        if m:
            out.append(("name", m.group(0).lower()))
            i = m.end()
            continue
        bad = ch if ch < "\U00010000" else chr(0xD800 + ((ord(ch) - 0x10000) >> 10))   # JavaScript は UTF-16 の単位 1 つを言う
        raise FormulaError(f"使えない文字です: {bad}")
    return out


ARITY = {"cmp": 2, "num": 1, "text": 1, "abs": 1, "round": 2, "len": 1, "left": 2, "right": 2, "trim": 1, "upper": 1, "lower": 1,
         "find": 2, "replace": 3, "match": 2, "regreplace": 3, "split": 3, "contains": 2, "startswith": 2, "endswith": 2, "hankaku": 1,
         # 版 3.46.0
         "count": 2, "regcount": 2, "lenb": 1, "rept": 2, "int": 1, "ceil": 1, "sqrt": 1, "isnum": 1, "isblank": 1,
         "year": 1, "month": 1, "day": 1, "hour": 1, "minute": 1, "weekday": 1, "date": 1}
ARITY_RANGE = {"mid": (2, 3), "extract": (2, 3), "padleft": (2, 3), "conv": (2, 9),
               "roundup": (1, 2), "rounddown": (1, 2), "datediff": (2, 3), "ifs": (2, 40), "switch": (3, 41), "kamadate": (1, 2),
               "min": (1, 30), "max": (1, 30), "sum": (1, 30), "avg": (1, 30)}
REGEX_FUNCS = {"extract", "match", "regreplace", "regcount"}


def parse(src):
    if len(str(src or "")) > MAX_LEN:
        raise FormulaError(f"式が長すぎます({MAX_LEN}文字まで)")
    ts, p = _lex(src), [0]

    def peek():
        return ts[p[0]] if p[0] < len(ts) else None

    def eat(t, v=None):
        x = peek()
        if not x or x[0] != t or (v is not None and x[1] != v):
            return None
        p[0] += 1
        return x

    def expect(t, v=None):
        x = eat(t, v)
        if not x:
            raise FormulaError(f"{v or t} が必要です")
        return x

    def or_expr():
        n = and_expr()
        while (x := peek()) and x == ("name", "or"):
            p[0] += 1
            n = ("or", n, and_expr())
        return n

    def and_expr():
        n = cmp_expr()
        while (x := peek()) and x == ("name", "and"):
            p[0] += 1
            n = ("and", n, cmp_expr())
        return n

    def cmp_expr():
        n = add_expr()
        while (x := peek()) and x[0] == "op" and x[1] in ("=", "<>", "<", "<=", ">", ">="):
            p[0] += 1
            n = ("cmp", x[1], n, add_expr())
        return n

    def add_expr():
        n = mul_expr()
        while (x := peek()) and x[0] == "op" and x[1] in "+-":
            p[0] += 1
            n = ("bin", x[1], n, mul_expr())
        return n

    def mul_expr():
        n = unary()
        while (x := peek()) and x[0] == "op" and x[1] in "*/%":
            p[0] += 1
            n = ("bin", x[1], n, unary())
        return n

    def unary():
        x = peek()
        if x == ("op", "-"):
            p[0] += 1
            return ("neg", unary())
        if x == ("name", "not"):
            p[0] += 1
            return ("not", unary())
        return atom()

    def atom():
        x = peek()
        if not x:
            raise FormulaError("式が途中で終わっています")
        if x[0] in ("num", "str", "col"):
            p[0] += 1
            return x
        if x[0] == "(":
            p[0] += 1
            n = or_expr()
            expect(")")
            return n
        if x[0] == "name":
            p[0] += 1
            name = x[1]
            if not eat("("):
                raise FormulaError(f"関数の ( が必要です: {name}")
            args = []
            if not eat(")"):
                args.append(or_expr())
                while eat(","):
                    args.append(or_expr())
                expect(")")
            if name != "if" and name not in FUNCS:
                raise FormulaError(f"知らない関数です: {name}")
            if name == "if" and len(args) < 2:
                raise FormulaError("if は if(条件, 真のとき, 偽のとき) です")
            if name in ARITY and len(args) != ARITY[name]:
                raise FormulaError(f"{name} は引数が{ARITY[name]}個です（{len(args)}個でした）")
            if name in ARITY_RANGE and not ARITY_RANGE[name][0] <= len(args) <= ARITY_RANGE[name][1]:
                lo, hi = ARITY_RANGE[name]
                raise FormulaError(f"{name} は引数が{lo}〜{hi}個です（{len(args)}個でした）")
            if name in REGEX_FUNCS and args[1][0] == "str":
                try:
                    js_regex(args[1][1])
                except FormulaError as e:
                    raise FormulaError(f"{name} の正規表現として読めません: {e}") from None
            return ("call", name, args)
        raise FormulaError("式として読めません")
    node = or_expr()
    if p[0] < len(ts):
        raise FormulaError("式の後ろに余分なものがあります")
    return node


# ---------------------------------------------------------------- 関数（list-formula.js の FUNCS と同じ）
def _pos(v):
    n = num_of(v)
    return 1 if n is None else max(1, math.floor(n))


def _js_round(x):
    if not math.isfinite(x):
        return x
    r = math.floor(x)
    return float(r + 1 if x - r >= 0.5 else r)


def _round(a):
    n = num_of(a[0])
    if n is None:
        return None
    d = max(0.0, min(8.0, num_of(a[1]) or 0.0))
    p = math.pow(10, d)
    return _js_round(n * p) / p


def _right(a):
    n = max(0.0, num_of(a[1]) or 0.0)
    return u16slice(text_of(a[0]), -n) if n else ""


def _mid(a):
    t, st = text_of(a[0]), _pos(a[1]) - 1
    n = max(0.0, num_of(a[2]) or 0.0) if len(a) > 2 else u16len(t)
    return u16slice(t, st, st + n)


def _replace(a):
    t, sub, rep = text_of(a[0]), text_of(a[1]), text_of(a[2])
    return rep.join(_u16list(t)) if sub == "" else t.replace(sub, rep)


def _extract(a):
    m = js_regex(text_of(a[1])).search(text_of(a[0]))
    if not m:
        return ""
    g = max(0.0, num_of(a[2]) or 0.0) if len(a) > 2 else 0.0
    if g != int(g) or int(g) > m.re.groups:
        return ""
    v = m.group(int(g))
    return "" if v is None else v


def _split(a):
    sep, t = text_of(a[1]), text_of(a[0])
    parts = t.split(sep) if sep else [t]
    i = _pos(a[2]) - 1
    return parts[i] if i < len(parts) else ""


def _padleft(a):
    t = text_of(a[0])
    width = int(max(0.0, min(64.0, num_of(a[1]) or 0.0)))
    fill = (text_of(a[2]) or "0") if len(a) > 2 else "0"
    need = width - u16len(t)
    if need <= 0:
        return t
    rep = fill * (need // max(1, u16len(fill)) + 1)
    return u16slice(rep, 0, need) + t


def _coalesce(a):
    for v in a:
        if v is not None and v != "":
            return v
    return ""


# ---------------------------------------------------------------- 変換表（版 3.42.0。list-formula.js の conv と同じ決まり・同じ答え）
# conv('表の名前', 値1, …): 値を表の入力の順に渡し、上から順に見て最初に当たった行の出す値（= で始まれば式）。当たらなければ「その他」。
# 表は use_tables で渡す（アプリはマスタ「変換表」を読む係: services/conversions.py の tables）。表の形は list-formula.js の説明
_TABLES = [lambda name: None]
_CONV_CACHE = {}


def use_tables(fn):
    """変換表の引き方（名前 → 表の dict か None）を決める。表は dict のまま（同じ dict は 1 度だけ読み解く）"""
    _TABLES[0] = fn if callable(fn) else (lambda name: None)
    _CONV_CACHE.clear()


def _conv_text(v):
    return js_trim(text_of(v))


def _conv_eq(s, x, kind):
    t = js_trim(str(x))
    if kind == "num":
        a, b = _loose_num(s), _loose_num(t)
        if a is not None and b is not None:
            return a == b
    return s == t


def _conv_bound(v):
    return None if v is None or v == "" else _loose_num(v)


def _conv_test(t, v, kind):
    s = _conv_text(v)
    vs = [text_of(x) for x in t["v"]] if isinstance(t.get("v"), list) else []

    def any_(f):
        return any(x != "" and f(x) for x in vs)
    op = t.get("op")
    if op == "eq":
        return any(_conv_eq(s, x, kind) for x in vs)
    if op == "ne":
        return not any(_conv_eq(s, x, kind) for x in vs)
    if op in ("starts", "nstarts"):
        return any_(s.startswith) == (op == "starts")
    if op in ("ends", "nends"):
        return any_(s.endswith) == (op == "ends")
    if op in ("contains", "ncontains"):
        return any_(lambda x: x in s) == (op == "contains")
    if op == "empty":
        return s == ""
    if op == "filled":
        return s != ""
    if op == "range":
        n = _loose_num(s)
        if n is None:
            return False
        lo, hi = _conv_bound(t.get("min")), _conv_bound(t.get("max"))
        if lo is not None and not (n > lo if t.get("minInc") is False else n >= lo):
            return False
        if hi is not None and not (n < hi if t.get("maxInc") is False else n <= hi):
            return False
        return True
    return False


def _conv_out(o):
    t = "" if o is None else str(o)
    if not t.startswith("="):
        return ("text", t)
    try:
        return ("f", Formula(t[1:]))
    except FormulaError:
        return ("bad", None)


def _conv_prep(tb):
    hit = _CONV_CACHE.get(id(tb))
    if hit and hit[0] is tb:
        return hit[1]
    inputs = [(str(x.get("name")), "num" if x.get("type") == "num" else "text") for x in (tb.get("inputs") or []) if isinstance(x, dict)]
    rows = [((r.get("when") if isinstance(r.get("when"), dict) else {}), _conv_out(r.get("out"))) for r in (tb.get("rows") or []) if isinstance(r, dict)]
    c = (inputs, rows, _conv_out(tb.get("other")))
    if len(_CONV_CACHE) > 200:
        _CONV_CACHE.clear()
    _CONV_CACHE[id(tb)] = (tb, c)
    return c


def _conv_give(o, vals):
    kind, x = o
    if kind == "bad":
        return None
    if kind == "text":
        return x
    return x.run(lambda c: vals.get(c))


def _conv(a):
    tb = _TABLES[0](text_of(a[0]))
    if not isinstance(tb, dict):
        return None
    inputs, rows, other = _conv_prep(tb)
    vals = {name: (a[i + 1] if i + 1 < len(a) else None) for i, (name, _) in enumerate(inputs)}
    for when, out in rows:
        if all(not isinstance(when.get(name), list) or not when.get(name)
               or any(_conv_test(t, vals[name], kind) for t in when[name] if isinstance(t, dict)) for name, kind in inputs):
            return _conv_give(out, vals)
    return _conv_give(other, vals)


# ---------------------------------------------------------------- 版 3.46.0 で足した関数（利用者の要望 2026-10-21 の 5: 文字列のカウント・ほかの便利な関数）
# 画面（list-formula.js）と同じ決まり・同じ答え（tests/test_formula_parity.py が突き合わせる）
REPT_MAX = 10000          # rept の答えの長さ（UTF-16 の単位）
LENB_ONE = re.compile(r"[\x00-\x7f\uff61-\uff9f]")   # lenb で 1 と数える字（半角の英数記号・半角カナ）。ほかは 2（Excel の LENB と同じ数え方）


def _fsum(xs):
    """左から順に足す（JavaScript の reduce と同じ丸め。math.fsum は使わない）"""
    t = 0.0
    for x in xs:
        t += x
    return t


def _nums(a):
    return [n for n in map(num_of, a) if n is not None]


def _digits(v):
    """roundup・rounddown の桁（0〜8 の整数。小数は 0 の側へ切る）"""
    return int(max(0.0, min(8.0, num_of(v) or 0.0)))


def _round_dir(a, up):
    """Excel の ROUNDUP（0 から遠い側）・ROUNDDOWN（0 の側）。x×10^桁 の小さな誤差（1.1×10＝11.000000000000002）は 15 桁で丸めてから切る"""
    n = num_of(a[0])
    if n is None:
        return None
    p = float(10 ** (_digits(a[1]) if len(a) > 1 else 0))
    t = float("%.15g" % (abs(n) * p))
    return (-1.0 if n < 0 else 1.0) * (math.ceil(t) if up else math.floor(t)) / p


def _rept(a):
    t, n = text_of(a[0]), int(max(0.0, min(1000.0, num_of(a[1]) or 0.0)))
    if t and u16len(t) * n > REPT_MAX:
        n = REPT_MAX // u16len(t)
    return t * n


def _switch(a):
    """switch(x, 値1, 答え1, 値2, 答え2, …[, どれでもない時])。値は = と同じ比べ方"""
    for i in range(1, len(a) - 1, 2):
        if _cmp_op("=", a[0], a[i]):
            return a[i + 1]
    return a[-1] if len(a) % 2 == 0 else ""


def _ifs(a):
    """ifs(条件1, 答え1, 条件2, 答え2, …[, どれでもない時])"""
    for i in range(0, len(a) - 1, 2):
        if truthy(a[i]):
            return a[i + 1]
    return a[-1] if len(a) % 2 else ""


# 日時（年月日・時刻）。数字は半角だけ。区切りは - / . 年月日 と、日と時刻の間の T・空白（全角の空白も）
_D_YMD = re.compile(r"([0-9]{4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?(?:[T \u3000]+([0-9]{1,2})[:時]([0-9]{1,2})(?:[:分]([0-9]{1,2})(?:\.[0-9]+)?秒?)?)?")
_D_YY = re.compile(r"([0-9]{2})/([0-9]{1,2})/([0-9]{1,2})(?:[T \u3000]+([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?")
_D_8 = re.compile(r"([0-9]{4})([0-9]{2})([0-9]{2})")
_D_T = re.compile(r"([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?")
_DIM = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _days(y, m, d):
    """1970-01-01 からの日数（Howard Hinnant の days_from_civil。整数だけで計算する: 画面の JavaScript と同じ答え）"""
    y -= m <= 2
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - 719468


def when(v):
    """値 → (年, 月, 日, 時, 分, 秒, 日付がある)。日時と読めなければ None（時刻だけは 1970-01-01 の時刻）"""
    t = js_trim(text_of(v))
    m = _D_YMD.fullmatch(t) or _D_YY.fullmatch(t) or _D_8.fullmatch(t)
    if m:
        g = [int(x) if x else 0 for x in m.groups()] + [0] * (6 - len(m.groups()))
        y = g[0] + 2000 if m.re is _D_YY else g[0]
        has = True
    else:
        m = _D_T.fullmatch(t)
        if not m:
            return None
        g, y, has = [1970, 1, 1] + [int(x) if x else 0 for x in m.groups()], 1970, False
    mo, d, h, mi, sec = g[1], g[2], g[3], g[4], g[5]
    dim = 29 if mo == 2 and (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else _DIM[mo - 1] if 1 <= mo <= 12 else 0
    if not (1 <= d <= dim and h <= 23 and mi <= 59 and sec <= 59):
        return None
    return y, mo, d, h, mi, sec, has


def _sec(w):
    return _days(w[0], w[1], w[2]) * 86400 + w[3] * 3600 + w[4] * 60 + w[5]


DATEDIFF_UNITS = {"d": 86400, "日": 86400, "h": 3600, "時": 3600, "時間": 3600, "m": 60, "分": 60, "s": 1, "秒": 1}


def _datediff(a):
    """datediff(始め, 終わり[, 単位])＝終わり−始め（d＝日〈既定〉・h＝時間・m＝分・s＝秒）"""
    x, y = when(a[0]), when(a[1])
    u = DATEDIFF_UNITS.get(js_trim(text_of(a[2])).lower() if len(a) > 2 else "d")
    if x is None or y is None or u is None:
        return None
    return (_sec(y) - _sec(x)) / u


def _part(i, need_date=True):
    def f(a):
        w = when(a[0])
        return None if w is None or (need_date and not w[6]) else float(w[i])
    return f


def _weekday(a):
    w = when(a[0])
    return None if w is None or not w[6] else float((_days(w[0], w[1], w[2]) % 7 + 4) % 7 + 1)


def _date(a):
    w = when(a[0])
    return None if w is None or not w[6] else f"{w[0]:04d}-{w[1]:02d}-{w[2]:02d}"


def _kama_day(y, m, week, wd):
    """y 年 m 月の、第 week 週・曜日 wd（日＝1 〜 土＝7）の日（無ければ None）。月初を第 1 週として日曜日で 1 つ進み、
    第 6 週は第 1 週に戻す（利用者の kama_to_date・VBA と同じ。同じ週・曜日が 2 度あれば月の早い方）"""
    first = _days(y, m, 1)
    last = (_days(y + 1, 1, 1) if m == 12 else _days(y, m + 1, 1)) - first
    sw = (first % 7 + 4) % 7          # 月初の曜日（0＝日 〜 6＝土）
    n = 0
    for d in range(1, last + 1):
        dw = (sw + d - 1) % 7 + 1
        if n == 0 or dw == 1:
            n = 1 if n == 5 else n + 1
        if n == week and dw == wd:
            return d
    return None


def _kamadate(a):
    """kamadate(釜番[, 基準日])（版 3.51.2。利用者の要望 2026-10-23）: 釜番（3 桁。1 桁目＝月の第何週・2 桁目＝曜日〈日＝1 〜 土＝7〉・
    3 桁目＝何番目〈日付には使わない〉）→ 日付（YYYY-MM-DD）。釜番は月を持たないので、基準日（省くと今日）の前の月・その月・次の月のうち、
    その週・曜日の日付が基準日にいちばん近い物（同じ近さなら前の物）。仕掛の釜番は今日の前後数週間を指し、月をまたぐため
    （例: 2026-10-23 に 141 → 11 月 4 日。10 月の第 1 週に水曜は無い）。3 桁の数字でない・週が 1〜5 でない・曜日が 1〜7 でない釜番（0 など）は空"""
    k = js_trim(text_of(a[0]))
    if not re.fullmatch(r"[0-9]{3}", k):
        return None
    week, wd = int(k[0]), int(k[1])
    if not (1 <= week <= 5 and 1 <= wd <= 7):
        return None
    if len(a) > 1:
        w = when(a[1])
        if w is None or not w[6]:
            return None
        y, m, d0 = w[0], w[1], w[2]
    else:
        t = _today()
        y, m, d0 = t.year, t.month, t.day
    base, best = _days(y, m, d0), None
    for dm in (-1, 0, 1):
        yy, mm = (y - 1, 12) if m + dm == 0 else (y + 1, 1) if m + dm == 13 else (y, m + dm)
        d = _kama_day(yy, mm, week, wd)
        if d is not None:
            gap = abs(_days(yy, mm, d) - base)
            if best is None or gap < best[0]:
                best = (gap, yy, mm, d)
    return None if best is None else f"{best[1]:04d}-{best[2]:02d}-{best[3]:02d}"


def _today():
    import datetime as _dt
    return _dt.date.today()


FUNCS = {
    "num": lambda a: num_of(a[0]),
    "text": lambda a: text_of(a[0]),
    "abs": lambda a: None if num_of(a[0]) is None else abs(num_of(a[0])),
    "round": _round,
    "len": lambda a: float(u16len(text_of(a[0]))),
    "left": lambda a: u16slice(text_of(a[0]), 0, max(0.0, num_of(a[1]) or 0.0)),
    "right": _right,
    "trim": lambda a: js_trim(text_of(a[0])),
    "upper": lambda a: text_of(a[0]).upper(),
    "lower": lambda a: text_of(a[0]).lower(),
    "concat": lambda a: "".join(text_of(x) for x in a),
    "coalesce": _coalesce,
    "mid": _mid,
    "find": lambda a: float(u16index(text_of(a[0]), text_of(a[1])) + 1),
    "replace": _replace,
    "extract": _extract,
    "match": lambda a: 1.0 if js_regex(text_of(a[1])).search(text_of(a[0])) else 0.0,
    "regreplace": lambda a: js_regex(text_of(a[1]), "g").sub(_js_replacement(text_of(a[2])), text_of(a[0])),
    "split": _split,
    "contains": lambda a: 1.0 if text_of(a[1]) in text_of(a[0]) else 0.0,
    "cmp": lambda a: float(js_cmp(a[0], a[1])),
    "startswith": lambda a: 1.0 if text_of(a[0]).startswith(text_of(a[1])) else 0.0,
    "endswith": lambda a: 1.0 if text_of(a[0]).endswith(text_of(a[1])) else 0.0,
    "hankaku": lambda a: unicodedata.normalize("NFKC", text_of(a[0])),
    "padleft": _padleft,
    "conv": _conv,
    # 版 3.46.0
    "count": lambda a: float(text_of(a[0]).count(text_of(a[1]))) if text_of(a[1]) else 0.0,
    "regcount": lambda a: float(sum(1 for _ in js_regex(text_of(a[1]), "g").finditer(text_of(a[0])))),
    "lenb": lambda a: float(sum(1 if LENB_ONE.fullmatch(c) else 2 for c in _u16list(text_of(a[0])))),
    "rept": _rept,
    "min": lambda a: min(_nums(a)) if _nums(a) else None,
    "max": lambda a: max(_nums(a)) if _nums(a) else None,
    "sum": lambda a: _fsum(_nums(a)) if _nums(a) else None,
    "avg": lambda a: _fsum(_nums(a)) / len(_nums(a)) if _nums(a) else None,
    "int": lambda a: None if num_of(a[0]) is None else float(math.floor(num_of(a[0]))),
    "ceil": lambda a: None if num_of(a[0]) is None else float(math.ceil(num_of(a[0]))),
    "roundup": lambda a: _round_dir(a, True),
    "rounddown": lambda a: _round_dir(a, False),
    "sqrt": lambda a: None if num_of(a[0]) is None or num_of(a[0]) < 0 else math.sqrt(num_of(a[0])),
    "isnum": lambda a: 0.0 if _strict_num(a[0]) is None else 1.0,
    "isblank": lambda a: 1.0 if js_trim(text_of(a[0])) == "" else 0.0,
    "ifs": _ifs,
    "switch": _switch,
    "year": _part(0), "month": _part(1), "day": _part(2), "hour": _part(3, False), "minute": _part(4, False),
    "weekday": _weekday,
    "date": _date,
    "datediff": _datediff,
    "kamadate": _kamadate,
}


def _cmp_op(op, a, b):
    x, y = _strict_num(a), _strict_num(b)
    c = (-1 if x < y else 1 if x > y else 0) if x is not None and y is not None else _u16order(text_of(a), text_of(b))
    ok = {"=": c == 0, "<>": c != 0, "<": c < 0, "<=": c <= 0, ">": c > 0}.get(op, c >= 0)
    return 1.0 if ok else 0.0


def _eval(n, row):
    k = n[0]
    if k in ("num", "str"):
        return n[1]
    if k == "col":
        return row(n[1])
    if k == "neg":
        a = num_of(_eval(n[1], row))
        return None if a is None else -a
    if k == "not":
        return 0.0 if truthy(_eval(n[1], row)) else 1.0
    if k == "and":
        return 1.0 if truthy(_eval(n[1], row)) and truthy(_eval(n[2], row)) else 0.0
    if k == "or":
        return 1.0 if truthy(_eval(n[1], row)) or truthy(_eval(n[2], row)) else 0.0
    if k == "cmp":
        return _cmp_op(n[1], _eval(n[2], row), _eval(n[3], row))
    if k == "bin":
        op, a, b = n[1], _eval(n[2], row), _eval(n[3], row)
        x, y = num_of(a), num_of(b)
        if op == "+":
            return x + y if x is not None and y is not None else text_of(a) + text_of(b)
        if x is None or y is None:
            return None
        if op == "-":
            return x - y
        if op == "*":
            return x * y
        if op == "/":
            return None if y == 0 else x / y
        return None if y == 0 else math.fmod(x, y)
    if k == "call":
        name, args = n[1], n[2]
        if name == "if":
            if truthy(_eval(args[0], row)):
                return _eval(args[1], row)
            return _eval(args[2], row) if len(args) > 2 else ""
        return FUNCS[name]([_eval(a, row) for a in args])
    return None


def columns_used(node, out=None):
    out = [] if out is None else out
    if isinstance(node, tuple):
        if node[0] == "col" and node[1] not in out:
            out.append(node[1])
        for x in node[1:]:
            if isinstance(x, tuple):
                columns_used(x, out)
            elif isinstance(x, list):
                for y in x:
                    columns_used(y, out)
    return out


class Formula:
    """読み解いた式（1 回だけ読み、行ごとに使い回す）。run(lookup) の lookup は 列名 → 値（無ければ None）"""

    def __init__(self, src):
        self.src = str(src or "")
        self.node = parse(self.src)
        self.columns = columns_used(self.node)

    def run(self, lookup):
        try:
            return _eval(self.node, lookup)
        except (FormulaError, ValueError, TypeError, OverflowError, IndexError, KeyError, re.error, RecursionError):
            return None      # その行だけ空（列ごと落とさない）


def compile_formula(src):
    return Formula(src)


def check(src):
    if not str(src or "").strip():
        return {"ok": False, "error": "式を入力してください"}
    try:
        return {"ok": True, "columns": Formula(src).columns}
    except FormulaError as e:
        return {"ok": False, "error": str(e)}


def sql_value(v):
    """式の答え → SQLite に返す値（整数に読める実数は整数: 字にしたとき JavaScript と同じ「1」になる）"""
    if isinstance(v, float):
        if not math.isfinite(v):
            return js_num_text(v)
        if v.is_integer() and abs(v) < 2 ** 53:
            return int(v)
    return v


# ---------------------------------------------------------------- 計算列（一覧の表示列の設定と同じ引き方）
class CalcColumns:
    """表示列の設定の式（formulas: {列名: 式}）と表示名（names: {元の列名: 表示名}）→ 計算列を値にする。
    画面（lotlist-columns.js の baseRow）と同じ引き方: [名前] は元の列 → 表示名 → 式を持つ列（その式を元の値で 1 段だけ計算）。
    計算列＝表に無い列の式。表にある列の式（元の値を作り替える式）は、計算列の中で [その列] と書いたときだけ効く（一覧と同じ）。"""

    MAX = 40

    def __init__(self, formulas, names, table_columns):
        self.cols = set(table_columns)
        self.names_rev = {str(v): str(k) for k, v in (names or {}).items() if str(v)}
        self.compiled = {}
        for k, v in list((formulas or {}).items())[:self.MAX]:
            if str(v or "").strip():
                try:
                    self.compiled[str(k)] = Formula(v)
                except FormulaError:
                    self.compiled[str(k)] = None     # 読めない式（使えば断る）
        self.calcs = [k for k in self.compiled if k not in self.cols]

    def key(self, name):
        return name if name in self.cols else self.names_rev.get(name, name)

    def broken(self, name):
        return name in self.compiled and self.compiled[name] is None

    def raw_deps(self, name):
        """計算列 name が読む表の列（表示名・ほかの式の列を 1 段たどる）。並びは決まった順"""
        f = self.compiled.get(name)
        out = []
        if not f:
            return out
        for c in f.columns:
            k = self.key(c)
            sub = self.compiled.get(k) if k != name else None
            for d in (sub.columns if sub else [k]):
                if d in self.cols and d not in out:
                    out.append(d)
        return out

    def runner(self, name):
        """計算列 name の値を出す関数（読む列の値を、raw_deps の並びで受け取る）"""
        f, deps = self.compiled[name], self.raw_deps(name)

        def run(*vals):
            raw = dict(zip(deps, vals))

            def plain(c):
                return raw.get(c)

            def look(c):
                k = self.key(c)
                if k == name:
                    return raw.get(k)
                sub = self.compiled.get(k)
                if sub:
                    return sub.run(plain)
                return raw.get(k)
            return sql_value(f.run(look))
        return run, deps


# ---------------------------------------------------------------- 計算列を SQLite の式にする（一覧の並べ替え・ダッシュボードの集計が同じ物を使う）
MAX_CALC = 40


def clean_calc(v):
    """画面が送る計算列 {formulas: {列名: 式}, names: {元の列名: 表示名}, own?: [名前]}（JSON の字でもよい）→ 字だけ・数と長さを限った形。無ければ None"""
    if isinstance(v, str):
        try:
            v = json.loads(v) if v.strip() else None
        except ValueError:
            return None
    if not isinstance(v, dict):
        return None

    def strs(d, n, size):
        items = list(d.items())[:n] if isinstance(d, dict) else []
        return {str(k)[:200]: str(x)[:size] for k, x in items if str(k).strip() and isinstance(x, str)}
    f = {k: x for k, x in strs(v.get("formulas"), MAX_CALC, MAX_LEN).items() if x.strip()}
    if not f:
        return None
    own = [str(x)[:200] for x in (v.get("own") if isinstance(v.get("own"), list) else []) if str(x) in f][:MAX_CALC]
    return {"formulas": f, "names": strs(v.get("names"), 400, 200), **({"own": own} if own else {})}


def register(conn, calc, cs, qi):
    """計算列を接続に SQLite の関数として登録する → (計算列の名前 → SQL の式, 読めない計算列の名前の並び, CalcColumns か None)。
    calc は clean_calc の形。qi は列名を括る関数（sqlite_ro.qi）。同じ値の組の答えは覚えて使い回す（20 万組まで）"""
    if not calc or not calc.get("formulas"):
        return {}, [], None
    cc = CalcColumns(calc.get("formulas"), calc.get("names"), cs)
    exprs, broken = {}, []
    for i, name in enumerate(cc.calcs):
        if cc.broken(name):
            broken.append(name)
            continue
        run, deps = cc.runner(name)
        memo = {}

        def fn(*vals, run=run, memo=memo):
            hit = memo.get(vals, memo)
            if hit is memo:
                if len(memo) > 200_000:
                    memo.clear()
                hit = memo[vals] = run(*vals)
            return hit
        conn.create_function(f"TpaCalc{i}", len(deps), fn, deterministic=True)
        exprs[name] = f"TpaCalc{i}({', '.join(qi(d) for d in deps)})"
    return exprs, broken, cc

