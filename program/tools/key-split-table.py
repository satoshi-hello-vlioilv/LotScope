# -*- coding: utf-8 -*-
"""名前の比べ方（NFKC・前後の空白を除く・大文字）が Python と窓で割れうる字の表を焼く（版 3.79.0）。

    python program/tools/key-split-table.py > desktop/src/key_split_table.rs

表 = Python（この Python の unicodedata の版。3.13 は Unicode 15.1）でまだ割り当てのない字（category が Cn）
     ＋ 割り当て済みで、窓（Rust の std と unicode-normalization のより新しい表）だけが大文字の対を持つ字（ASSIGNED_SPLIT）。
割り当て済みの字どうしの合成・並べ替えは、Unicode の正規化の安定の約束で版が上がっても変わらないので、割り当てのない字を
含む名前を Python に任せれば、並びで割れる形（Unicode 16 の合成・新しい結合文字の並べ替え）も閉じる。
ASSIGNED_SPLIT は desktop/tests/name_key_cases.rs が全部の字を Python と突き合わせて見つける（足りなければ落ち、足す字を言う）。
"""
import sys
import unicodedata

# Unicode 15.1 で割り当て済みで、窓の表だけが大文字の対を持つ字（Unicode 16 で足された対: ƛ→Ƛ・ɤ→Ɤ・ꟓ・ꟕ・𐞑）
ASSIGNED_SPLIT = [0x019B, 0x0264, 0xA7D3, 0xA7D5, 0x10791]


def ranges():
    cps = set(ASSIGNED_SPLIT)
    for cp in range(0x110000):
        if not 0xD800 <= cp <= 0xDFFF and unicodedata.category(chr(cp)) == "Cn":
            cps.add(cp)
    out = []
    for c in sorted(cps):
        if out and out[-1][1] + 1 == c:
            out[-1][1] = c
        else:
            out.append([c, c])
    return out


def main():
    rs = ranges()
    w = sys.stdout.write
    w(f"// 焼いた表（program/tools/key-split-table.py。Python {sys.version.split()[0]}・Unicode {unicodedata.unidata_version}）。手で直さない\n")
    w(f"// 名前の比べ方が Python と窓で割れうる字の範囲（{len(rs)} の範囲）。src/access.rs の key_split が使う\n")
    w("pub const KEY_SPLIT: &[(u32, u32)] = &[\n")
    for a, b in rs:
        w(f"    (0x{a:04X}, 0x{b:04X}),\n")
    w("];\n")
    w("// 上の表のうち、Python で割り当て済みで窓だけが大文字の対を持つ字（NFKC は通し、大文字にだけしない）\n")
    w("pub const ASSIGNED_SPLIT: &[u32] = &[" + ", ".join(f"0x{c:04X}" for c in ASSIGNED_SPLIT) + "];\n")


if __name__ == "__main__":
    main()
