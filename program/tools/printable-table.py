# -*- coding: utf-8 -*-
"""Python の str.isprintable() が偽の字の表を焼く（版 3.104.0。開発用）。

    python program/tools/printable-table.py            … desktop/src/printable_table.rs を作り直す
    python program/tools/printable-table.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓の pyfmt::str_repr（Python の repr(str)。int()・float() の誤りの文・並びや表の repr）は、この表の字を Python と同じく
\\xhh・\\uhhhh・\\Uhhhhhhhh に逃がす。表 = この Python（3.13 は Unicode 15.1）で isprintable が偽の字（Cc・Cf・Cs・Co・Cn・Zl・Zp・
空白でない Zs）。片割れの代用字（U+D800〜U+DFFF）は窓の字が持てないので表に入れない。tests/test_printable_table.py が古い表を止める。
"""
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "desktop" / "src" / "printable_table.rs"


def ranges():
    out = []
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF or chr(cp).isprintable():
            continue
        if out and out[-1][1] + 1 == cp:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def text():
    rs = ranges()
    lines = [f"// 焼いた表（program/tools/printable-table.py。Python {sys.version.split()[0]}・Unicode {unicodedata.unidata_version}）。手で直さない\n",
             f"// Python の str.isprintable() が偽の字の範囲（{len(rs)} の範囲）。pyfmt::is_printable・str_repr が使う\n",
             "pub const NOT_PRINTABLE: &[(u32, u32)] = &[\n"]
    lines += [f"    (0x{a:04X}, 0x{b:04X}),\n" for a, b in rs]
    lines.append("];\n")
    return "".join(lines)


def main():
    t = text()
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == t
        print("同じ" if same else f"違う（python program/tools/printable-table.py で作り直す）: {OUT}")
        return 0 if same else 1
    OUT.write_text(t, encoding="utf-8", newline="\n")
    print(f"{OUT}: {t.count(chr(10)) - 3} の範囲")
    return 0


if __name__ == "__main__":
    sys.exit(main())
