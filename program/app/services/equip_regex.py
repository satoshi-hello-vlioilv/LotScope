# -*- coding: utf-8 -*-
"""設備グループの「に当たる（正規表現）」の書き方の確かめ（版 3.102.0。主のセッションの決め 1: Python の re の意味のまま）。

設備グループの決まりは、Python（services/pivot.compile_rules: re.compile(v, IGNORECASE).search）と窓（desktop/src/pivot.rs:
fancy_regex の (?i)v）の両方で当てる。2 つの読み方は多くの書き方で同じ答えを出すが、違う書き方がある（\\Z・[[:alpha:]]・\\p{…}・\\N{…}
のほか、(?<名前>…)・\\x{41}・\\e・\\z・\\101・同じ名前の組・長さの違う後読み・\\< \\>・[a&&b]・(?a) など。
tests/fixtures/equip_regex_cases.json）。

そこで、両方で同じ意味になる書き方だけを当てる（check が "ok"）。それ以外は:
  "unsupported" … 窓で写せない書き方（Python は読めても、窓と答えが違う・窓が読まない）。保存のときは理由を添えて断り、読むときはその決まりだけ当てない
  "invalid"     … 読めない書き方（Python も読めない）。保存のときは断り、読むときは当てない
決まりは窓の desktop/src/equip_regex.rs と同じ（同じ事例の表を Python の tests/test_equip_regex.py と窓の cargo test --test equip_regex_cases で突き合わせる）。
"""
from __future__ import annotations

# 前に \\ を付けて字そのものを表せる記号（両方で同じ。\\< \\> は窓では語の境目なので入れない）
PUNCT = set("\\.^$*+?{}[]()|-/#&~%@!'\"`,;:=_ ")
CTRL = set("tnrfva")             # \\t \\n \\r \\f \\v \\a
CLASS = set("dDwWsS")            # \\d \\w \\s とその逆
MAX_REPEAT = 1000
SPECIAL = {  # 前の採点で見つけた 4 形（同じ理由の言葉を窓も持つ）
    "Z": "\\Z は Python と窓で意味が違います（終わりは $ で書いてください）",
    "N": "\\N{…}（字の名前）は窓で読めません",
    "p": "\\p{…}（Unicode の種類）は Python の re で読めません",
    "P": "\\P{…}（Unicode の種類）は Python の re で読めません",
}
POSIX = "[[:…:]] は Python では [ と : の字の組になり、窓とは意味が違います"


class _Stop(Exception):
    def __init__(self, verdict, why):
        super().__init__(why)
        self.verdict, self.why = verdict, why


def check(src):
    """正規表現の字 → (判定, 理由)。判定は "ok"・"unsupported"・"invalid"（理由は "ok" のとき ""）"""
    try:
        _Parser(str(src)).run()
    except _Stop as e:
        return e.verdict, e.why
    return "ok", ""


def why_of(src):
    """保存・当てるときの理由（当てられる書き方なら ""）"""
    v, why = check(src)
    if v == "ok":
        return ""
    return f"窓で写せない書き方です（{why}）" if v == "unsupported" else f"読めません（{why}）"


class _Parser:
    """書き方を前から 1 字ずつ読む（Python の sre_parse の決まりのうち、ここで使う所だけ）。幅は後読みの長さの決まりに使う"""

    def __init__(self, s):
        self.s, self.i = s, 0
        self.opened = 0          # 開いた組の数（組の番号は開いた順）
        self.closed = set()      # 閉じた組の番号（\\1 は閉じた組だけ指せる）
        self.names = {}          # 名前 → 閉じたか

    def bad(self, why):
        raise _Stop("invalid", why)

    def unsup(self, why):
        raise _Stop("unsupported", why)

    def peek(self, k=0):
        j = self.i + k
        return self.s[j] if j < len(self.s) else ""

    def run(self):
        if self.s.startswith("(?i)"):
            self.i = 4
        self.alt(top=True)
        if self.i < len(self.s):
            self.bad("かっこ ( ) の数が合いません")

    def alt(self, top=False):
        """枝の並び（|）→ 幅（決まった長さなら数、決まらなければ None）"""
        widths = [self.seq()]
        while self.peek() == "|":
            self.i += 1
            widths.append(self.seq())
        if not top and self.peek() != ")":
            self.bad("かっこ ( ) の数が合いません")
        return widths[0] if all(w == widths[0] for w in widths) else None

    def seq(self):
        total = 0
        while self.i < len(self.s) and self.peek() not in "|)":
            w, repeatable = self.atom()
            if self.peek() in ("*", "+", "?", "{") and (self.peek() != "{" or self.is_quant()):
                if repeatable == "look":
                    self.unsup("先読み・後読みの繰り返し")
                if not repeatable:
                    self.bad("繰り返し（* + ? {}）の前に繰り返せる字がありません")
                w = self.quant(w)
            total = None if total is None or w is None else total + w
        return total

    def is_quant(self):
        j = self.i + 1
        k = j
        while k < len(self.s) and self.s[k].isascii() and self.s[k].isdigit():
            k += 1
        a = self.s[j:k]
        if k < len(self.s) and self.s[k] == "}":
            return bool(a)
        if k < len(self.s) and self.s[k] == ",":
            m = k + 1
            while m < len(self.s) and self.s[m].isascii() and self.s[m].isdigit():
                m += 1
            return m < len(self.s) and self.s[m] == "}" and (bool(a) or m > k + 1)
        return False

    def quant(self, w):
        c = self.peek()
        self.i += 1
        if c == "{":
            j = self.s.index("}", self.i)
            body = self.s[self.i:j]
            self.i = j + 1
            lo, _, hi = body.partition(",")
            lo_n = int(lo) if lo else 0
            hi_n = int(hi) if hi else None
            if lo_n > MAX_REPEAT or (hi_n is not None and hi_n > MAX_REPEAT):
                self.unsup(f"繰り返しの数は {MAX_REPEAT} までにしてください")
            if "," not in body:
                hi_n = lo_n
            if hi_n is not None and hi_n < lo_n:
                self.bad("繰り返しの数 {n,m} の n が m より大きい")
            fixed = None if w is None or hi_n != lo_n else w * lo_n
        else:
            fixed = None
        if self.peek() == "?":
            self.i += 1
        if self.peek() == "+":
            self.unsup("後ろの + （取り戻さない繰り返し）")
        if self.peek() in ("*", "+", "?") or (self.peek() == "{" and self.is_quant()):
            self.bad("繰り返し（* + ? {}）が 2 つ続いています")
        return fixed

    def atom(self):
        """1 つの塊 → (幅, 繰り返せるか)"""
        c = self.peek()
        if c == "(":
            return self.group()
        if c == "[":
            self.klass()
            return 1, True
        if c == "\\":
            return self.escape()
        if c in "*+?":
            self.bad("繰り返し（* + ? {}）の前に繰り返せる字がありません")
        if c in "{}":
            self.unsup("{ } は \\{ \\} と書いてください（{n} {n,m} の繰り返しのほか）")
        if c in "^$":
            self.i += 1
            return 0, False
        self.i += 1
        return 1, True

    def escape(self):
        self.i += 1
        c = self.peek()
        if not c:
            self.bad("最後の \\ の後ろに字がありません")
        self.i += 1
        if c in SPECIAL:
            self.unsup(SPECIAL[c])
        if c in CLASS:
            return 1, True
        if c in ("b", "B", "A"):
            return 0, False
        if c in PUNCT or c in CTRL:
            return 1, True
        if c == "0":
            if self.peek().isascii() and self.peek().isdigit():
                self.unsup("\\0 の後ろの数（8 進の字）")
            return 1, True
        if c.isascii() and c.isdigit():
            if self.peek().isascii() and self.peek().isdigit():
                self.unsup("2 桁の \\ の数（Python は 8 進の字・組の番号、窓は組の番号）")
            if int(c) not in self.closed:
                self.bad(f"\\{c} が指す組がまだありません（閉じた組だけ指せます）")
            return None, True
        if c in "xuU":
            n = {"x": 2, "u": 4, "U": 8}[c]
            h = self.s[self.i:self.i + n]
            if len(h) != n or any(x not in "0123456789abcdefABCDEF" for x in h):
                self.unsup(f"\\{c} の後ろは 16 進の {n} 字にしてください")
            if c == "U" and int(h, 16) > 0x10FFFF:
                self.bad(f"\\U{h} は字の範囲の外です")
            self.i += n
            return 1, True
        self.unsup(f"\\{c} は Python と窓で読み方が違う・読めない書き方です")

    def group(self):
        self.i += 1
        if self.peek() != "?":
            self.opened += 1
            no = self.opened
            w = self.alt()
            self.i += 1
            self.closed.add(no)
            return w, True
        self.i += 1
        c = self.peek()
        if c == ":":
            self.i += 1
            w = self.alt()
            self.i += 1
            return w, True
        if c in ("=", "!"):
            self.i += 1
            self.alt()
            self.i += 1
            return 0, "look"
        if c == "<" and self.peek(1) in ("=", "!"):
            self.i += 2
            w = self.alt()
            self.i += 1
            if w is None:
                self.bad("後読み (?<= ) (?<! ) の中は長さの決まった形にしてください")
            return 0, "look"
        if c == "#":
            j = self.s.find(")", self.i)
            if j < 0:
                self.bad("かっこ ( ) の数が合いません")
            self.i = j + 1
            return 0, False
        if c == "P" and self.peek(1) == "<":
            j = self.s.find(">", self.i + 2)
            name = self.s[self.i + 2:j] if j >= 0 else ""
            if j < 0 or not _ident(name):
                self.unsup("組の名前は英字・数字・_ にしてください（(?P<名前>…)）")
            if name in self.names:
                self.bad(f"組の名前「{name}」が 2 つあります")
            self.names[name] = False
            self.i = j + 1
            self.opened += 1
            no = self.opened
            w = self.alt()
            self.i += 1
            self.closed.add(no)
            self.names[name] = True
            return w, True
        if c == "P" and self.peek(1) == "=":
            j = self.s.find(")", self.i + 2)
            name = self.s[self.i + 2:j] if j >= 0 else ""
            if j < 0 or not _ident(name):
                self.unsup("組の名前は英字・数字・_ にしてください（(?P=名前)）")
            if not self.names.get(name):
                self.bad(f"(?P={name}) が指す組がまだありません（閉じた組だけ指せます）")
            self.i = j + 1
            return None, True
        self.unsup("(? の書き方（(?: ) (?= ) (?! ) (?<= ) (?<! ) (?P<名前> ) (?P=名前) (?# ) と最初の (?i) のほか）")

    def klass(self):
        self.i += 1
        if self.peek() == "^":
            self.i += 1
        first = True
        prev_single = False
        while True:
            c = self.peek()
            if not c:
                self.bad("[ ] が閉じていません")
            if c == "]" and not first:
                self.i += 1
                return
            first = False
            if c == "[":
                if self.peek(1) == ":":
                    self.unsup(POSIX)
                self.unsup("[ ] の中の [ は \\[ と書いてください")
            if c in "&~|" and self.peek(1) == c:
                self.unsup(f"[ ] の中の {c}{c} は Python と窓で意味が違います")
            if c == "-" and self.peek(1) == "-":
                self.unsup("[ ] の中の -- は Python と窓で意味が違います")
            if c == "-" and prev_single and self.peek(1) not in ("]", ""):
                self.bad("[ ] の中の範囲の書き方が読めません")
            single = self.class_item()
            if self.peek() == "-" and self.peek(1) not in ("]", "") and single is not None:
                self.i += 1
                if self.peek() == "[":
                    self.unsup("[ ] の中の [ は \\[ と書いてください")
                hi = self.class_item()
                if hi is None:
                    self.unsup("[ ] の中の範囲の端に \\d などは書けません")
                if hi < single:
                    self.bad("[ ] の中の範囲が逆です")
                prev_single = False
                continue
            if self.peek() == "-" and self.peek(1) not in ("]", "") and single is None:
                self.unsup("[ ] の中の範囲の端に \\d などは書けません")
            prev_single = single is not None

    def class_item(self):
        """[ ] の中の 1 つ → 字の番号（\\d などは None）"""
        c = self.peek()
        if c != "\\":
            self.i += 1
            return ord(c)
        self.i += 1
        c = self.peek()
        if not c:
            self.bad("[ ] が閉じていません")
        self.i += 1
        if c in SPECIAL:
            self.unsup(SPECIAL[c])
        if c in CLASS:
            return None
        if c == "b":
            return 8
        if c in CTRL:
            return {"t": 9, "n": 10, "r": 13, "f": 12, "v": 11, "a": 7}[c]
        if c in PUNCT:
            return ord(c)
        if c in "xuU":
            n = {"x": 2, "u": 4, "U": 8}[c]
            h = self.s[self.i:self.i + n]
            if len(h) != n or any(x not in "0123456789abcdefABCDEF" for x in h):
                self.unsup(f"\\{c} の後ろは 16 進の {n} 字にしてください")
            if c == "U" and int(h, 16) > 0x10FFFF:
                self.bad(f"\\U{h} は字の範囲の外です")
            self.i += n
            return int(h, 16)
        self.unsup(f"[ ] の中の \\{c} は Python と窓で読み方が違う・読めない書き方です")


def _ident(name):
    return bool(name) and name.isascii() and (name[0].isalpha() or name[0] == "_") and all(x.isalnum() or x == "_" for x in name)
