# -*- coding: utf-8 -*-
"""値の計算（四則演算。版 3.50.0）。画面の static/js/num-format.js の expr と同じ読み方・同じ答え
（事例の表 tests/fixtures/num_expr_cases.json で両方を突き合わせる: tests/test_num_expr.py・tools/num-format-check.mjs）。

値は x（「値」「X」も同じ）。演算子から書けば前に値を置く（「÷1000」＝x÷1000・「×100」・「+5」・「-3」）。
使える物: 数・小数点・＋ − × ÷ ^（累乗）・かっこ・全角の字。式は読むだけ（eval を使わない）。
集計の値ごとの計算（measures の expr。services/aggregate.py）が使う: 数え終えたセルの値に当て、表し方（割合・累計）はその後で決める。
"""
from __future__ import annotations

import math
import operator
import re

_ZEN = str.maketrans("０１２３４５６７８９．（）＋－＊／＾［］", "0123456789.()+-*/^[]")
_TOKEN = re.compile(r"(\d+\.?\d*|\.\d+)|([x+\-*/^()])")
# 基準の数（版 3.103.0）: ［稼働直］のように角かっこで名前を書く。中の字は値（x）に読み替えない
_TOKEN_VARS = re.compile(r"(\d+\.?\d*|\.\d+)|([x+\-*/^()])|\[([^\[\]]*)\]")
_PIECES = re.compile(r"(\[[^\[\]]*\])")


def _outside(s):
    """角かっこの外（名前の中の字は読み替えない）"""
    return _PIECES.sub("", s)


def normalize(src, allow_x=True) -> str:
    """書いた式 → 読む形（全角・×÷−・値 を半角の x * / - に。空白を除き、演算子から書いた式は前に x）。
    ［名前］（基準の数。版 3.103.0）は中の字をそのまま（前後の空白だけ除く）。allow_x=False（基準の数を作る式）は前に x を置かない"""
    s = str("" if src is None else src).strip()
    if not s:
        return ""
    s = s.translate(_ZEN)
    out = []
    for i, piece in enumerate(_PIECES.split(s)):
        if i % 2:
            out.append("[" + piece[1:-1].strip() + "]")
            continue
        piece = re.sub(r"[×✕]", "*", piece).replace("÷", "/")
        piece = re.sub(r"[−–]", "-", piece)
        piece = re.sub(r"値|ｘ|Ｘ|X", "x", piece)
        out.append(re.sub(r"\s+", "", piece))
    s = "".join(out)
    if allow_x and (re.match(r"^[*/+^]", s) or (s.startswith("-") and "x" not in _outside(s))):
        s = "x" + s
    return s


def compile_expr(src, names=None, need_x=True):
    """式 → (関数 fn(x, env=None)→数か None, 知らせの字, 読んだ式の見せ方)。空なら (None, "", "")。読めなければ (None, 理由, "")。
    names（版 3.103.0）… 使える基準の数の名前（［稼働直］など）。None なら角かっこは使えない字。env … 名前 → 数（None は答え無し）。
    need_x=False … 基準の数を作る式（値 x は使えず、基準の数を 1 つ以上使う）"""
    s = normalize(src, allow_x=need_x)
    if not s:
        return None, "", ""
    toks = []
    names = None if names is None else set(names)
    unknown = []

    def take(m):
        if m.group(1) is not None:
            toks.append(("n", float(m.group(1))))
        elif m.group(2) is not None:
            toks.append(("o", m.group(2)))
        else:
            name = m.group(3)
            if name not in names:
                unknown.append(name)
            toks.append(("v", name))
        return ""
    bad = (_TOKEN if names is None else _TOKEN_VARS).sub(take, s)
    if bad:
        return None, "使えない字です: " + " ".join(dict.fromkeys(bad)), ""
    if unknown:
        u = unknown[0]
        return None, (f"「{u}」という基準の数はありません" if u else "［］の中に基準の数の名前がありません"), ""
    pos = [0]
    uses_x = [False]
    uses_v = [False]

    class Bad(Exception):
        pass

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def eat(o):
        t = peek()
        if t and t[0] == "o" and t[1] == o:
            pos[0] += 1
            return True
        return False

    def chain(nxt, ops):
        """左から順に結ぶ（a op b op c …）。ops: 演算子の字 → 計算"""
        a = nxt()
        while True:
            o = next((k for k in ops if eat(k)), None)
            if o is None:
                return a
            a = _join(ops[o], a, nxt())

    def total():
        return chain(prod, {"+": operator.add, "-": operator.sub})

    def prod():
        return chain(power, {"*": operator.mul, "/": operator.truediv})

    def power():
        a = unary()
        if eat("^"):
            b = power()
            return lambda x, e: a(x, e) ** b(x, e)
        return a

    def unary():
        if eat("-"):
            a = unary()
            return lambda x, e: -a(x, e)
        if eat("+"):
            return unary()
        return atom()

    def atom():
        t = peek()
        if not t:
            raise Bad("式が途中で終わっています")
        if t[0] == "n":
            pos[0] += 1
            return lambda x, e, n=t[1]: n
        if t[0] == "v":
            pos[0] += 1
            uses_v[0] = True
            return lambda x, e, k=t[1]: _var(e, k)
        if eat("x"):
            uses_x[0] = True
            return lambda x, e: x
        if eat("("):
            a = total()
            if not eat(")"):
                raise Bad("かっこが閉じていません")
            return a
        raise Bad(f"「{t[1]}」の前に数か値がありません")

    try:
        f = total()
        if pos[0] < len(toks):
            t = toks[pos[0]]
            raise Bad(f"「{_tok_text(t)}」の前に演算子がありません")
        if need_x and not uses_x[0]:
            raise Bad("値（x）を使っていません。例: ÷1000・x×100")
        if not need_x and uses_x[0]:
            raise Bad("基準の数の式に値（x）は使えません")
        if not need_x and not uses_v[0]:
            raise Bad("基準の数（［稼働直］など）を使っていません")
    except Bad as e:
        return None, str(e), ""

    def fn(x, env=None):
        try:
            v = f(None if x is None else float(x), env or {})
        except (ZeroDivisionError, OverflowError, ValueError, TypeError, _Missing):
            return None
        if isinstance(v, complex) or not math.isfinite(v):
            return None
        return v
    text = "".join(p if i % 2 else p.replace("*", "×").replace("/", "÷").replace("x", "値") for i, p in enumerate(_PIECES.split(s)))
    return fn, "", text


def show_text(src):
    """式の見せ方（読めるかは見ない。×÷ と 値 にし、［名前］はそのまま）。compile_expr の 3 つ目と同じ字"""
    s = normalize(src)
    return "".join(p if i % 2 else p.replace("*", "×").replace("/", "÷").replace("x", "値") for i, p in enumerate(_PIECES.split(s)))


class _Missing(Exception):
    """基準の数がそのセルで決まらない（None）"""


def _var(env, k):
    v = env.get(k)
    if v is None or isinstance(v, bool):
        raise _Missing(k)
    return float(v)


def _join(f, a, b):
    return lambda x, e: f(a(x, e), b(x, e))


def _tok_text(t):
    if t[0] == "o":
        return t[1]
    if t[0] == "v":
        return f"[{t[1]}]"
    n = t[1]
    return str(int(n)) if n == int(n) else str(n)
