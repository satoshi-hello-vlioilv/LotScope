# -*- coding: utf-8 -*-
"""サーバーの式（services/formula.py）が、画面の式（static/js/list-formula.js）と同じ答えを出すか（評価関数。版 3.38.0）。

ダッシュボードで計算列（表示列で式から作った列）を数えるため、画面と同じ式をサーバーでも計算する。食い違うと、一覧に見える値と
ダッシュボードの数が合わなくなるので、同じ式・同じ行を両方で計算して突き合わせる:
- 書いた例（数の書き方・UTF-16 の数え方・JavaScript の空白・正規表現の読み替え・置き換えの $1 など、違いが出やすい所）
- 作った例（決まった種から、関数・演算子・列・値をでたらめに組んだ式 1,500 個 × 行）
答え（数・字・空）と、その字（String(値)）と、読めない式の理由が全部合えば通る。
版 3.59.0 から、画面の答えは事例表（tests/fixtures/formula_cases.json。tools/formula-cases.py が node で作る）に焼き付けてあり、
Python（ここ）と Rust（desktop/src/formula.rs の cargo test）は node 無しで同じ表と突き合わせる。node がある所では、表が古くないかも確かめる。
"""
import json
import math
import random
import shutil
import unittest
from pathlib import Path

from app.services import formula as F

CASES = Path(__file__).resolve().parent / "fixtures" / "formula_cases.json"


def _tool():
    """tools/formula-cases.py（名前に - があるので import ではなく読み込む）"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("formula_cases", Path(__file__).resolve().parents[1] / "tools" / "formula-cases.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

VALUES = [None, "", " ", 0, 1, -1, 2.5, 10, 1200, 0.1, 1e21, 1e-7, 123456789012, "0", "010", "10", "1.0", "1,000", " 5 ", "+5", "-3.5e2", "12abc",
          "abc", "ABC def", "A5052", "H24", "L0123C4", "ｱｲｳ", "１２３", "　全角の空白　", "😀x", "x😀y", "Infinity", "1e3", ".5",
          "2026/10/16 08:30", "2026/10/01 8:15:00", "2026-10-01T09:45", "26/10/02 23:48:54", "2026年10月3日", "20261003", "8:15", "2026/02/30", "451", "141", "567", "仕掛", "検査待ち", "O'Neil", "a,b,c", "CR1 L-1 LS3", "﻿BOM", "ß", "İ", "a\rb", "x\u2028y"]
COLUMNS = ["A", "B", "C", "日本"]
REGEX = ["[0-9]+", "\\\\d+", "^L", "C(\\\\d)", "\\\\s", "(?<n>\\\\d)", ".", "\\\\w+$", "[^]", "a|b", "^$", "(x)?y", "[A-Z]{2,}", "\\\\.", "\\\\bdef"]
REPL = ["$1", "$&", "[$`]", "$'", "$<n>", "$$", "$9", "-", ""]
FUNCS1 = ["num", "text", "abs", "len", "trim", "upper", "lower", "hankaku",
          "lenb", "int", "ceil", "sqrt", "isnum", "isblank", "year", "month", "day", "hour", "minute", "weekday", "date", "roundup", "rounddown",
          "min", "max", "sum", "avg"]
FUNCS2 = ["round", "left", "right", "find", "contains", "startswith", "endswith", "cmp", "mid", "padleft", "extract", "match",
          "count", "regcount", "rept", "roundup", "rounddown", "datediff", "ifs", "min", "max", "sum", "avg", "kamadate"]
FUNCS3 = ["replace", "split", "mid", "padleft", "extract", "regreplace", "datediff", "switch", "ifs", "min", "sum"]

WRITTEN = [
    # 重すぎる正規表現・長すぎる答え（版 3.52.1。脆弱性: アプリの中身が止まる・メモリが尽きる）。画面とサーバーで同じ断り方・同じ空
    "match([C], '(.*.*)*!')", "match([C], '(a+)+b')", "extract([C], '(?:x*)+')", "match([C], '.*a.*b.*c')", "match([C], '.*a.*b')",
    "match([C], '(ab|cd)+')", "match([C], '[(.*)]+')", "match([C], '\\.*\\.*\\.*')", "regcount(rept('ab', 1001), 'a')",
    "replace(rept('ab', 1000), '', rept('ab', 1000))", "rept('x', 1000) + rept('y', 1000)", "regreplace(rept('a', 100), 'a', rept('b', 1000))",
    # 釜番 → 日付（版 3.51.2）: 月をまたぐ・第 6 週・読めない釜番・数の釜番・基準日の形
    "kamadate('451', '2026-10-23')", "kamadate('141', '2026-10-23')", "kamadate('567', '2026/10/23')", "kamadate(161, '2021/03/05 08:00')",
    "kamadate('111', '2026-12-28')", "kamadate('171', '2027-01-03')", "kamadate('0', '2026-10-23')", "kamadate('811', '2026-10-23')",
    "kamadate('１４１', '2026-10-23')", "kamadate(' 451 ', '2026-10-23')", "kamadate('451', 'x')", "kamadate([A], [B])",
    "[A] + [B]", "[A] - [B]", "[A] * [B]", "[A] / [B]", "[A] % [B]", "-[A]", "not [A]", "[A] and [B]", "[A] or [B]",
    "[A] = [B]", "[A] <> [B]", "[A] < [B]", "[A] <= [B]", "[A] > [B]", "[A] >= [B]", "[A] != 10",
    "0.1 + 0.2", "1 / 3", "10 % 3", "-7 % 3", "2 * 1000000000000000000000", "1 / 10000000", "round(2.5, 0)", "round(-2.5, 0)", "round(1.005, 2)",
    "left('abcdef', 2.7)", "right('abcdef', 0.5)", "right('abcdef', 2)", "mid('abcdef', 2.9, 2.5)", "mid('abcdef', 3)",
    "len('😀x')", "left('😀x', 1)", "right('x😀', 1)", "find('x😀y', 'y')", "replace('abc', '', '-')", "replace('😀', '', '-')",
    "padleft('7', 3)", "padleft('7', 5, 'ab')", "padleft('7', 2.9, '')", "padleft('😀', 4, '😀')",
    "trim('　a　')", "upper('ß')", "lower('İ')", "hankaku('１２３ＡＢＣ　ｱ')",
    "extract('L0123C4', '[0-9]+')", "extract('L0123C4', 'C(\\d)', 1)", "extract('L0123C4', 'C(\\d)', 2)", "extract('ab', '(x)?b', 1)",
    "extract('１２３', '\\d+')", "match('a\nb', 'a.b')", "match('ab\n', 'b$')", "match('x y', '\\s')", "match('x　y', '\\s')",
    "regreplace('a1b2', '(\\d)', '<$1>')", "regreplace('a1b2', '\\d', '$&$&')", "regreplace('abc', 'b', \"[$`|$']\")",
    "regreplace('a1', '(?<n>\\d)', '$<n>!')", "regreplace('abc', 'x*', '-')", "regreplace('ab', 'b', '$$')", "regreplace('ab', '(b)', '$01$2')",
    "split('a,b,c', ',', 2)", "split('a,b,c', ',', 9)", "split('abc', '', 1)", "coalesce('', [A], 'z')", "concat([A], '-', [B])",
    "if([A] > 1000, '重', '軽')", "if([A], 1)", "if([A] = '010', 'x', 'y')", "cmp([A], [B])", "cmp('5', '05')", "[A] = 10",
    "num('12abc')", "num('1,000')", "num('Infinity')", "num(' 3')", "num('.5e1x')", "text(1/3)", "text(100000000000000000000)",
    "'a' < 'b'", "'😀' > '￿'", "abs(-0)", "-0", "0 * -1", "[日本] + 1", "[無い列]", "[A] + [無い列]",
    # 版 3.46.0 で足した関数
    "count('1、2、3', '、')", "count('aaaa', 'aa')", "count('abc', '')", "count('😀😀x', '😀')", "regcount('a1b22c333', '[0-9]+')", "regcount('abc', 'x*')",
    "lenb('ｱ漢x12')", "lenb('😀')", "lenb('')", "rept('ab', 3)", "rept('ab', 2.9)", "rept('x', -1)", "len(rept('abc', 5000))",
    "min(3, [A], 1)", "max('a', 'b')", "sum(1, 2, '3x')", "avg(1, 2, 4)", "sum(0.1, 0.2, 0.3)", "int(-1.5)", "int('2.7')", "ceil(1.000001)", "ceil(-1.5)",
    "roundup(1.1, 1)", "roundup(1.11, 1)", "roundup(-2.01, 1)", "rounddown(-1.19, 1)", "rounddown(2.999, 2)", "roundup(0.1 + 0.2, 1)", "roundup(3)", "rounddown(9.99, 8.5)",
    "sqrt(2)", "sqrt(-1)", "isnum('010')", "isnum('10')", "isnum(1.5)", "isblank('　')", "isblank([A])",
    "ifs([A] > 5, '大', [A] > 1, '中', '小')", "ifs(0, 'x')", "switch([A], 10, 'ten', '010', 'zero', 'other')", "switch('B', 'A', 1, 'B', 2)",
    "year('2026/10/01 8:15:00')", "month('2026年10月3日')", "day('20261003')", "hour('2026-10-01T09:45')", "minute('8:15')", "year('8:15')",
    "weekday('2026/10/01')", "weekday('1969/12/31')", "weekday('0000/03/01')", "date('26/10/02 23:48:54')", "date('2026/02/30')", "date('2024/02/29')",
    "datediff('2026/10/01 8:15:00', '2026-10-01T09:45', 'm')", "datediff('26/10/02 23:48:54', '2026年10月3日')", "datediff('8:00', '9:30', '時間')",
    "datediff('2026/10/01', '2026/10/02', 'x')", "datediff([A], [B], 's')",
    # 読めない式（理由が同じか）
    "", "[A", "'abc", "foo(1)", "if(1)", "round(1)", "left('a')", "match('a', '[')", "1 +", "(1", "1 2", "#", "mid('a')", "count('a')", "ifs(1)", "switch(1, 2)", "regcount('a', '(')", "min()",
]


# 作った後の採点（版 3.59.0）で、別のエージェントが画面の答えを出して確かめた事例（比べ方・置き換えの $`・. と改行・数の読み方・
# 正規表現の書き方の隅: (?i)・(?#…)・(?P<…>)・a++・(?>…)・\\8・組の無い \\1・[\\d-z]・\\00・a*? など）。行も決めてある
PROBED = [
    ('[A] <= [B]', {"A": 10, "B": 10}),
    ('[A] <= [B]', {"A": 10, "B": "10"}),
    ('[A] <= [B]', {"A": "a", "B": "a"}),
    ('[A] > [B]', {"A": 10, "B": 10}),
    ('[A] > [B]', {"A": "b", "B": "a"}),
    ('[A] >= [B]', {"A": 3, "B": 3}),
    ('[A] < [B]', {"A": 3, "B": 3}),
    ('[A] <= [B]', {"A": None, "B": 0}),
    ('regreplace(\'abc\', \'b\', "[$`|$\']")', {}),
    ('regreplace(\'xaby\', \'ab\', "<$`|$\'>")', {}),
    ("regreplace([C], '\\d', '[$`]')", {"C": "a1b2"}),
    ("regreplace('abc', '(b)', '$2')", {}),
    ("regreplace('abc', '(b)', '$10')", {}),
    ("regreplace('abc', 'b', '$<x>')", {}),
    ("regreplace('abc', '(?<n>b)', '$<x>')", {}),
    ("match([C], 'a.b')", {"C": "a\rb"}),
    ("match([C], 'a.b')", {"C": "a b"}),
    ("match([C], 'a.b')", {"C": "a b"}),
    ("regcount([C], '.')", {"C": "a\r b"}),
    ("regreplace([C], '.', '-')", {"C": "a\rb "}),
    ("regcount([C], '\\s')", {"C": " 　﻿ x"}),
    ('len(trim([C]))', {"C": "﻿ a  "}),
    ("lower('ΑΣ Α')", {}),
    ("upper('ﬀ')", {}),
    ("hankaku('ｶﾞ')", {}),
    ("num('0x10')", {}),
    ('[A] * 1', {"A": "0x10"}),
    ('[A] = 16', {"A": "0x10"}),
    ('[A] - 0', {"A": " "}),
    ("'0b11' * 1", {}),
    ("'1_000' * 1", {}),
    ("'-0' * 1", {}),
    ("'.5.' * 1", {}),
    ("weekday('2026/10/32')", {}),
    ("date('2026/13/01')", {}),
    ("year('99/1/1')", {}),
    ('round(-0.5, 0)', {}),
    ('round(1.45, 1)', {}),
    ('round(1e21, 2)', {}),
    ('int(1e21)', {}),
    ("rept('a', 1e9)", {}),
    ("padleft('x', 1e9)", {}),
    ("mid('abc', -1, 2)", {}),
    ("left('abc', -1)", {}),
    ("right('abc', -1)", {}),
    ("find('abc', '')", {}),
    ("split('a,,b', ',', 2)", {}),
    ("split('a,b', ',', 0)", {}),
    ("split('a,b', ',', -1)", {}),
    ("count('', '')", {}),
    ("extract('abc', '(?=b)')", {}),
    ("match('abab', '(ab)\\1')", {}),
    ("regreplace('aaa', 'a*?', '-')", {}),
    ("regcount('aaa', '(?<=a)a')", {}),
    ("extract('2026-10', '(?<y>\\d{4})-(?<m>\\d+)', 2)", {}),
    ("match('ABC', '[a-z]')", {}),
    ("match('a-b', '[a\\-b]')", {}),
    ("match(']', '[]]')", {}),
    ("match('{', '{')", {}),
    ("match('a{2', 'a{2')", {}),
    ("match('x{,2}', 'x{,2}')", {}),
    ("match('p{L}', '\\p{L}')", {}),
    ("match('é', '\\w')", {}),
    ("match('uuu', '\\u{3}')", {}),
    ("match('AB', '(?i)ab')", {}),
    ("match('a', '(?#c)a')", {}),
    ("match('a', '(?P<n>a)')", {}),
    ("match('aa', 'a++')", {}),
    ("match('a', 'a{2,1}')", {}),
    ("match('a', '(?>a)')", {}),
    ("match('8', '\\8')", {}),
    ("match([C], 'a\\1')", {"C": "a\u0001"}),
    ("match('-', '[\\d-z]')", {}),
    ("match('y', '[\\d-z]')", {}),
    ("match([C], '\\c1')", {"C": "\\c1"}),
    ("match([C], '\\00')", {"C": "\u00000"}),
    ("match('a', '\\Z')", {}),
    ("match('Z', '\\Z')", {}),
    ("match('a', 'a$|b')", {}),
    ("match([C], '^b')", {"C": "a\nb"}),
    # 2 回目の作った後の採点（版 3.59.0）: 組の名前・後方参照（前を指す・合っていない組）・\\k・\\c・8 進・[] の範囲・先読みの繰り返し
    ("match([C], '\\b+')", {"C": "ab"}),
    ("match([C], '\\B*')", {"C": "ab"}),
    ("match([C], '^*')", {"C": "a"}),
    ("match([C], '$+')", {"C": "a"}),
    ("match([C], '(?=a)*')", {"C": "a"}),
    ("match([C], '(?!a)+')", {"C": "b"}),
    ("match([C], '(?<=a)+')", {"C": "ab"}),
    ("match([C], '*a')", {"C": "a"}),
    ("match([C], 'a|*')", {"C": "a"}),
    ("match([C], 'a{2}{3}')", {"C": "aaaaaa"}),
    ("match([C], 'a?+')", {"C": "a"}),
    ("match([C], 'a+?+')", {"C": "a"}),
    ("match([C], 'a{1,}?')", {"C": "aa"}),
    ("match([C], 'a{,5}')", {"C": "a{,5}"}),
    ("match([C], 'a{1')", {"C": "a{1"}),
    ("match([C], 'x{2}?')", {"C": "xx"}),
    ("match([C], '(a)+')", {"C": "aa"}),
    ("match([C], 'a)')", {"C": "a)"}),
    ("match([C], '(a')", {"C": "a"}),
    ("match([C], '()+')", {"C": "a"}),
    ("match([C], '(?:)+')", {"C": "a"}),
    ("match([C], 'a**')", {"C": "a"}),
    ("match([C], '\\k<n>')", {"C": "k<n>"}),
    ("match([C], '\\k<n>')", {"C": "a"}),
    ("match([C], '(?<n>a)\\k<x>')", {"C": "aa"}),
    ("match([C], '(?<n>a)\\k<n>')", {"C": "aa"}),
    ("match([C], '\\1(a)')", {"C": "a"}),
    ("match([C], '(a)|\\1b')", {"C": "b"}),
    ("match([C], '(a)\\2')", {"C": "a\u0002"}),
    ("match([C], '(a)\\10')", {"C": "a\b"}),
    ("match([C], '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10')", {"C": "abcdefghijj"}),
    ("match([C], '[\\1]')", {"C": "\u0001"}),
    ("match([C], '[\\8]')", {"C": "8"}),
    ("match([C], '\\08')", {"C": "\u00008"}),
    ("match([C], '\\377')", {"C": "ÿ"}),
    ("match([C], '\\400')", {"C": " 0"}),
    ("match([C], '\\9')", {"C": "9"}),
    ("match([C], '(a)\\9')", {"C": "a9"}),
    ("match([C], '\\c1')", {"C": "c1"}),
    ("match([C], '[\\c1]')", {"C": "c"}),
    ("match([C], '[\\c1]')", {"C": "\\"}),
    ("match([C], '\\cj')", {"C": "\n"}),
    ("match([C], '[\\cJ]')", {"C": "\n"}),
    ("match([C], '\\c')", {"C": "\\c"}),
    ("match([C], '\\')", {"C": "\\"}),
    ("match([C], '\\x4')", {"C": "x4"}),
    ("match([C], '\\u12')", {"C": "u12"}),
    ("match([C], '\\u{41}')", {"C": "uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu"}),
    ("match([C], '\\-')", {"C": "-"}),
    ("match([C], '\\/')", {"C": "/"}),
    ("match([C], '\\e')", {"C": "e"}),
    ("match([C], '[a-\\d]')", {"C": "-"}),
    ("match([C], '[a-\\d]')", {"C": "5"}),
    ("match([C], '[\\s-\\d]')", {"C": "-"}),
    ("match([C], '[\\w-]')", {"C": "-"}),
    ("match([C], '[-\\w]')", {"C": "-"}),
    ("match([C], '[\\d-]')", {"C": "-"}),
    ("match([C], '[]a]')", {"C": "a]"}),
    ("match([C], '[[]')", {"C": "["}),
    ("match([C], '[a-]')", {"C": "-"}),
    ("match([C], '[\\]]')", {"C": "]"}),
    ("match([C], '[^\\d]')", {"C": "x"}),
    ("match([C], '[z-a]')", {"C": "a"}),
    ("match([C], '[\\b]')", {"C": "\b"}),
    ("match([C], '[.]')", {"C": "x"}),
    ("match([C], '[&&]')", {"C": "&"}),
    ("match([C], '[a&&b]')", {"C": "&"}),
    ("match([C], '[~~]')", {"C": "~"}),
    ("match([C], '[a--b]')", {"C": "-"}),
    ("match([C], '(?<名前>a)')", {"C": "a"}),
    ("match([C], '(?<n>a)(?<n>b)')", {"C": "ab"}),
    ("match([C], '(?<1a>x)')", {"C": "x"}),
    ("extract([C], '(?<n>a)')", {"C": "a"}),
    ("match([C], '(?=a)')", {"C": "a"}),
    ("match([C], '(?<!a)b')", {"C": "cb"}),
    ("match([C], '(?<=a)b')", {"C": "ab"}),
    ("match([C], '(?:a|b)+')", {"C": "ab"}),
    ("match([C], '(?')", {"C": "a"}),
    ("match([C], '(?)')", {"C": "a"}),
    ("match([C], '(?x)')", {"C": "a"}),
    ("match([C], '(?-i)a')", {"C": "a"}),
    ("match([C], '(?i:a)')", {"C": "A"}),
    ("regreplace('abc', '(?<=a)', '-')", {}),
    ("regreplace('abc', '(?=)', '-')", {}),
    ("regcount('aaa', 'a*?')", {}),
    ("regcount('abc', '')", {}),
    ("regreplace('aaa', 'a??', '-')", {}),
    ("regreplace('ab', 'a|', '-')", {}),
    ("regreplace('xax', 'a*', '-')", {}),
    ("regcount('ｱｲｳ', 'x*')", {}),
    ("regreplace('ｱｲ', '', '-')", {}),
    ("extract('abc', 'x*')", {}),
    ("regreplace('aXbX', 'X', '$0')", {}),
    ("regreplace('ab', '(a)', '$01')", {}),
    ("regreplace('ab', '(a)', '$001')", {}),
    ("regreplace('ab', '(a)', '$')", {}),
    ("regreplace('ab', 'a', '$<')", {}),
    ("regreplace('ab', '(?<n>a)', '$<n')", {}),
    ("regreplace('abc', '(a)(b)?(x)?', '[$2|$3]')", {}),
    ("extract('ab', '(a)(x)?', 2)", {}),
    ("regreplace('a.b', '.', '$&$&')", {}),
    ("match([C], '^b')", {"C": "a\rb"}),
    ("match([C], 'a$')", {"C": "a\r"}),
    ("match([C], 'a$')", {"C": "a\n"}),
    ("match([C], '[^a]')", {"C": "\r"}),
    ("match([C], '\\S')", {"C": "　"}),
    ("match([C], '\\s')", {"C": ""}),
    ("match([C], '\\s')", {"C": "᠎"}),
    ("match([C], '\\W')", {"C": "é"}),
    ("match([C], '\\D')", {"C": "１"}),
    ("match('aa', '(?<n>a)\\\\1')", {}),
    ("extract('aa', '(?<n>a)\\\\1(x)?', 0)", {}),
    ("match(' 0', '\\\\400')", {}),
    ("match('\\u0100', '\\\\400')", {}),
    ("match('-', '[\\\\w-z]')", {}),
    ("match('^', '[\\\\w-z]')", {}),
    ("match('-', '[\\\\s-z]')", {}),
    ("match('m', '[\\\\s-z]')", {}),
    ("match([C], '[\\\\c1]')", {"C": "\u0011"}),
    ("match([C], '\\\\c1')", {"C": "\\c1"}),
    ("regreplace('a1b', '(?<名前>\\\\d)', '<$<名前>>')", {}),
    ("regreplace('x', '(?<$a>x)', '[$<$a>]')", {}),
    ("match('b', '(?=a)*b')", {}), ("match('b', '(?=a)?b')", {}), ("match('b', '(?=a){0,2}b')", {}), ("match('b', '(?!b)*b')", {}),
    ("match('ab', '(?=a)+ab')", {}), ("match('b', '(?=a)+b')", {}), ("extract('x', 'x(?=a)*')", {}),
]


def rnd_expr(r, depth=0):
    k = r.random()
    if depth > 3 or k < 0.25:
        c = r.random()
        if c < 0.45:
            return f"[{r.choice(COLUMNS)}]"
        if c < 0.75:
            return r.choice(["0", "1", "2", "3", "10", "2.5", "0.5", "1000", "7"])
        return "'" + r.choice([v for v in VALUES if isinstance(v, str) and "'" not in v and "\n" not in v]) + "'"
    if k < 0.45:
        op = r.choice(["+", "-", "*", "/", "%", "=", "<>", "<", "<=", ">", ">=", " and ", " or "])
        return f"({rnd_expr(r, depth + 1)} {op} {rnd_expr(r, depth + 1)})"
    if k < 0.5:
        return f"{r.choice(['-', 'not '])}{rnd_expr(r, depth + 1)}"
    if k < 0.58:
        return f"if({rnd_expr(r, depth + 1)}, {rnd_expr(r, depth + 1)}, {rnd_expr(r, depth + 1)})"
    if k < 0.66:
        return f"{r.choice(['concat', 'coalesce'])}({', '.join(rnd_expr(r, depth + 1) for _ in range(r.randint(1, 3)))})"
    if k < 0.76:
        return f"{r.choice(FUNCS1)}({rnd_expr(r, depth + 1)})"
    name = r.choice(FUNCS2 + FUNCS3)
    n = 3 if name in FUNCS3 and (name not in FUNCS2 or r.random() < 0.5) else 2
    args = [rnd_expr(r, depth + 1)]
    if name in ("extract", "match", "regreplace"):
        args.append("'" + r.choice(REGEX).replace("\\\\", "\\") + "'")
        if n == 3:
            args.append("'" + r.choice(REPL) + "'" if name == "regreplace" else r.choice(["0", "1", "2", "1.5"]))
    elif name == "round":         # 桁に小数を書いたときの最後の桁は合わない（formula.py の説明）。桁は整数で
        args.append(r.choice(["0", "1", "2", "-1", "9"]))
    else:
        args += [rnd_expr(r, depth + 1) if r.random() < 0.5 else r.choice(["0", "1", "2", "3", "-1", "2.5", "', '", "''"]) for _ in range(n - 1)]
    return f"{name}({', '.join(args)})"


def rnd_row(r):
    return {c: r.choice(VALUES) for c in COLUMNS if r.random() < 0.95}


def corpus():
    r = random.Random(20261016)
    rows = [{"A": 1200, "B": 400, "C": "A5052", "日本": "仕掛"}, {"A": "010", "B": 10, "C": None, "日本": ""}] + [rnd_row(r) for _ in range(4)]
    cases = [{"expr": e, "row": row} for e in WRITTEN for row in rows[:3]]
    cases += [{"expr": rnd_expr(r), "row": rnd_row(r)} for _ in range(1500)]
    cases += [{"expr": e, "row": row} for e, row in PROBED]
    return cases


def py_answer(expr, row):
    chk = F.check(expr)
    if not chk["ok"]:
        return {"ok": False, "error": chk["error"]}
    v = F.Formula(expr).run(lambda c: row.get(c))
    if isinstance(v, float) and not math.isfinite(v):
        return {"ok": True, "value": "#" + F.js_num_text(v), "text": F.js_num_text(v)}
    return {"ok": True, "value": v, "text": F.text_of(v)}


def same(js, py):
    if js["ok"] != py["ok"]:
        return False
    if not js["ok"]:
        # 壊れた正規表現の理由の後半は、正規表現の仕組みの言葉（JavaScript と Python で違う）。前半が合えばよい
        head = "の正規表現として読めません: "
        return js["error"] == py["error"] or (head in js["error"] and js["error"].split(head)[0] == py["error"].split(head)[0])
    a, b = js["value"], py["value"]
    num = (int, float)
    if isinstance(a, num) and isinstance(b, num) and not isinstance(a, bool):
        return float(a) == float(b) and js["text"] == py["text"]     # JSON の大きな数は整数で読まれるので実数で比べる
    return a == b and js["text"] == py["text"]


def load_cases():
    """事例表（tests/fixtures/formula_cases.json。画面の答えを焼き付けた物。作るのは tools/formula-cases.py）"""
    return json.loads(CASES.read_text(encoding="utf-8"))


class FormulaParity(unittest.TestCase):
    """事例表は式の 3 つの実装（画面・Python・Rust の desktop/src/formula.rs）の約束（版 3.59.0）。Rust も同じ表を cargo test で読む"""

    def test_server_gives_the_same_answer_as_the_screen(self):
        d, fc = load_cases(), _tool()
        F.use_tables(d["tables"].get)
        try:
            bad = []
            for c in d["cases"]:
                js = {k: fc.plain(v) for k, v in c["js"].items()}
                if not same(js, p := py_answer(c["expr"], c["row"])):
                    bad.append((c["expr"], c["row"], js, p))
        finally:
            F.use_tables(None)
        n = len(d["cases"])
        self.assertGreater(sum(1 for c in d["cases"] if c["js"]["ok"]), n * 0.6, "読める式が少なすぎる（作った例の作り方を見直す）")
        self.assertFalse(bad, f"{len(bad)} / {n} が食い違い。最初の 5 件:\n" + "\n".join(
            f"  {e!r} 行 {json.dumps(row, ensure_ascii=False)}\n    画面 {j!r}\n    サーバー {p!r}" for e, row, j, p in bad[:5]))

    @unittest.skipUnless(shutil.which("node"), "node がありません")
    def test_cases_are_the_screen_answers_of_today(self):
        """事例表が古くなっていない（事例の作り方・画面の式を変えたら作り直す: python tools/formula-cases.py）"""
        fc = _tool()
        self.assertEqual(fc.text(fc.build()), CASES.read_text(encoding="utf-8"),
                         "事例表が今の画面の答えと違う。python program/tools/formula-cases.py で作り直す")


class CalcColumnsLookup(unittest.TestCase):
    """計算列の引き方（画面の baseRow と同じ）: 表示名・ほかの式の列を 1 段たどる・自分は空"""

    def test_names_and_other_formulas(self):
        calc = F.CalcColumns({"区分": "if([板厚(表示)] > 1, '厚', '薄')", "倍": "[重量] * 2", "倍の倍": "[倍] * 2", "重量": "[重量] + 1", "自分": "[自分]"},
                             {"板厚": "板厚(表示)"}, ["板厚", "重量"])
        self.assertEqual(calc.calcs, ["区分", "倍", "倍の倍", "自分"], "表に無い列の式だけが計算列")
        run, deps = calc.runner("区分")
        self.assertEqual((deps, run(2)), (["板厚"], "厚"), "表示名で書いても元の列を読む")
        run, deps = calc.runner("倍の倍")
        self.assertEqual((deps, run(10)), (["重量"], 40), "計算列から計算列は元の値で 1 段（10*2*2）")
        run, deps = calc.runner("倍")
        self.assertEqual(run(10), 22, "表にある列の式（作り替え）は、計算列の中で [その列] と書くと効く（(10+1)*2）")
        run, deps = calc.runner("自分")
        self.assertEqual((deps, run()), ([], None))
        self.assertEqual(F.sql_value(3.0), 3, "整数に読める答えは整数（字にすると「3」）")


if __name__ == "__main__":
    unittest.main()
