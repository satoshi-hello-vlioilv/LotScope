# -*- coding: utf-8 -*-
"""名前の比べ方（services/identity.normalize_part: NFKC・前後の空白を除く・大文字）の答えを全部の字で出す係（版 3.79.0）。

    python tests/name_key_oracle.py

desktop/tests/name_key_cases.rs が呼び、窓の access::normalize_part と 1 字ずつ突き合わせて、割れる字がみな access::key_split の表に
入っていることを確かめる（窓はその字を含む名前を比べる道を Python に任せる）。答えが字そのものと同じ字は出さない（[符号位置, 答え] の並び）。
"unassigned" はこの Python でまだ割り当てのない字（Cn）の範囲（表 desktop/src/key_split_table.rs の元）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.identity import normalize_part  # noqa: E402

import unicodedata  # noqa: E402

out, unassigned = [], []
for cp in range(0x110000):
    if 0xD800 <= cp <= 0xDFFF:
        continue
    c = chr(cp)
    r = normalize_part(c)
    if r != c:
        out.append([cp, r])
    if unicodedata.category(c) == "Cn":
        if unassigned and unassigned[-1][1] + 1 == cp:
            unassigned[-1][1] = cp
        else:
            unassigned.append([cp, cp])
sys.stdout.write(json.dumps({"python": sys.version.split()[0], "unicode": unicodedata.unidata_version, "changed": out,
                             "unassigned": unassigned}, ensure_ascii=False))
