# -*- coding: utf-8 -*-
"""マスタの行の表示順（版 3.75.0）。勤務体系・設備グループ・変換表・起動の種まきが同じ決まりで使う。"""


def next_order(rows):
    """表示順を書かずに足す行の表示順（いまの最大 + 10。版 3.75.0）。読めない表示順（「²」・「--5」・「1e400」）の行は数えない。
    前は 4 か所が str.isdigit と int で選び、読めない行が 1 つあると ValueError で、表示順なしではだれも足せなかった"""
    best = 0
    for r in rows:
        try:
            best = max(best, int(str(r.get("表示順") or 0).strip()))
        except (TypeError, ValueError, OverflowError):
            continue
    return str(best + 10)
