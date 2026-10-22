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

_ZEN = str.maketrans("０１２３４５６７８９．（）＋－＊／＾", "0123456789.()+-*/^")
_TOKEN = re.compile(r"(\d+\.?\d*|\.\d+)|([x+\-*/^()])")


def normalize(src) -> str:
    """書いた式 → 読む形（全角・×÷−・値 を半角の x * / - に。空白を除き、演算子から書いた式は前に x）"""
    s = str("" if src is None else src).strip()
    if not s:
        return ""
    s = s.translate(_ZEN)
    s = re.sub(r"[×✕]", "*", s).replace("÷", "/")
    s = re.sub(r"[−–]", "-", s)
    s = re.sub(r"値|ｘ|Ｘ|X", "x", s)
    s = re.sub(r"\s+", "", s)
    if re.match(r"^[*/+^]", s) or (s.startswith("-") and "x" not in s):
        s = "x" + s
    return s


def compile_expr(src):
    """式 → (関数 fn(x)→数か None, 知らせの字, 読んだ式の見せ方)。空なら (None, "", "")。読めなければ (None, 理由, "")"""
    s = normalize(src)
    if not s:
        return None, "", ""
    toks = []

    def take(m):
        toks.append(("n", float(m.group(1))) if m.group(1) is not None else ("o", m.group(2)))
        return ""
    bad = _TOKEN.sub(take, s)
    if bad:
        return None, "使えない字です: " + " ".join(dict.fromkeys(bad)), ""
    pos = [0]
    uses_x = [False]

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
            return lambda x: a(x) ** b(x)
        return a

    def unary():
        if eat("-"):
            a = unary()
            return lambda x: -a(x)
        if eat("+"):
            return unary()
        return atom()

    def atom():
        t = peek()
        if not t:
            raise Bad("式が途中で終わっています")
        if t[0] == "n":
            pos[0] += 1
            return lambda x, n=t[1]: n
        if eat("x"):
            uses_x[0] = True
            return lambda x: x
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
        if not uses_x[0]:
            raise Bad("値（x）を使っていません。例: ÷1000・x×100")
    except Bad as e:
        return None, str(e), ""

    def fn(x):
        try:
            v = f(float(x))
        except (ZeroDivisionError, OverflowError, ValueError, TypeError):
            return None
        if isinstance(v, complex) or not math.isfinite(v):
            return None
        return v
    text = s.replace("*", "×").replace("/", "÷").replace("x", "値")
    return fn, "", text


def _join(f, a, b):
    return lambda x: f(a(x), b(x))


def _tok_text(t):
    if t[0] == "o":
        return t[1]
    n = t[1]
    return str(int(n)) if n == int(n) else str(n)
