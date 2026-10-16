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
         "find": 2, "replace": 3, "match": 2, "regreplace": 3, "split": 3, "contains": 2, "startswith": 2, "endswith": 2, "hankaku": 1}
ARITY_RANGE = {"mid": (2, 3), "extract": (2, 3), "padleft": (2, 3)}
REGEX_FUNCS = {"extract", "match", "regreplace"}


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
