# -*- coding: utf-8 -*-
"""CM3 の答えの字の表を Python から焼く（版 3.96.0。desktop/src/cm3_tables.json。窓の src/cm3.rs が読む）。

  python program/tools/cm3-tables.py            … 表を書き直す
  python program/tools/cm3-tables.py --check    … 今の表が Python と同じか（違えば 1 で終わる。tests/test_cm3_tables.py も同じ物を見る）

焼く物（どれも Python 3.13 の答えそのもの。窓は字の決まりを自分で持たない）:
  cp932・shift_jis … 1 バイトの 256 字と、2 バイトの 1 バイト目ごとの 2 バイト目 0x40〜0xFC（189 字）の読み。読めない所は U+0000 の印
                    （2 バイトで U+0000 になる字は無い。1 バイトは並び〈-1 が読めない〉）。cp932 の 0x80・0xA0・0xFD〜0xFF と、
                    shift_jis の 6 字（8160・8161・817C・8191・8192・81CA）の違いもこの表に入る
  cp1252           … 1 バイトの 256 字の読み（-1 が読めない 5 つ）。fix_text の「cp1252 で書き戻す」に使う
  html             … html.unescape の名前の表（html5。「;」の無い名前も）・数の参照の読み替え（_invalid_charrefs）・捨てる符号（_invalid_codepoints）
  codecs           … charset の見出しの名前 → codec の名前（encodings.aliases と encodings の codec のモジュールの名前。codecs.lookup の答え）
  word             … 0xFF までの字のうち Python の正規表現の \\w に当たる字（charset=([\\w\\-]+) の読み。見出しは latin-1 で読む）
"""
from __future__ import annotations

import codecs
import encodings
import encodings.aliases
import html
import html.entities
import json
import pkgutil
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "desktop" / "src" / "cm3_tables.json"
LEADS = list(range(0x81, 0xA0)) + list(range(0xE0, 0x100))
WINDOWS_ONLY = ("mbcs", "oem")


def two_byte(enc):
    out = {}
    for lead in LEADS:
        row = []
        for t in range(0x40, 0xFD):
            try:
                s = bytes([lead, t]).decode(enc)
            except UnicodeDecodeError:
                s = ""
            row.append(s if len(s) == 1 else "\0")
        if any(c != "\0" for c in row):
            out[f"{lead:02X}"] = "".join(row)
    return out


def one_byte(enc):
    out = []
    for b in range(256):
        try:
            s = bytes([b]).decode(enc)
            out.append(ord(s) if len(s) == 1 else -1)
        except UnicodeDecodeError:
            out.append(-1)
    return out


def codec_names():
    """normalize_encoding した名前 → codecs.lookup(名前).name。窓は名前を同じ決まりでそろえてから引く"""
    names = set(encodings.aliases.aliases) | set(encodings.aliases.aliases.values())
    names |= {m.name for m in pkgutil.iter_modules(encodings.__path__)} | set(WINDOWS_ONLY)
    out = {}
    for n in sorted(names):
        try:
            out[n] = codecs.lookup(n).name
        except (LookupError, Exception):
            # Windows だけの codec（mbcs・oem。別名 dbcs も）: どの OS でも窓は持たない codec として扱う（係を降りて Python に任せる。
            # Windows の Python は読み、ほかの OS の Python は LookupError。どちらも Python の答えになる）
            mod = encodings.aliases.aliases.get(n, n)
            if mod in WINDOWS_ONLY:
                out[n] = mod
    return out


def build():
    word = "".join(chr(i) for i in range(256) if re.fullmatch(r"\w", chr(i)))
    return {
        "python": "%d.%d" % sys.version_info[:2],
        "cp932": {"one": one_byte("cp932"), "two": two_byte("cp932")},
        "shift_jis": {"one": one_byte("shift_jis"), "two": two_byte("shift_jis")},
        "cp1252": one_byte("cp1252"),
        "html": {"names": dict(sorted(html.entities.html5.items())),
                 "invalidCharrefs": {str(k): v for k, v in sorted(html._invalid_charrefs.items())},
                 "invalidCodepoints": sorted(html._invalid_codepoints)},
        "codecs": codec_names(),
        "word": word,
    }


def text():
    return json.dumps(build(), ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"


def main(argv):
    t = text()
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else "古い（python program/tools/cm3-tables.py で書き直す）")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8")
    print(f"{OUT}: {len(t.encode('utf-8'))} バイト")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
