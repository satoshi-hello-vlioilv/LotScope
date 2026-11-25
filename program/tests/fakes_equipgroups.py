# -*- coding: utf-8 -*-
"""設備グループの本（desktop/tests/equipgroups_write_parity.rs）の作り物の CM3（版 3.117.0。標準の部品だけ。app を import しない）。

場面「スケジュールの元がある（作り物の CM3 に届く）」が問い合わせる相手: 設備 L-1 の予定 6 行（発行は 2026-10-03 08:12 JST）。
起こすのは tests/fakes_serve.py（python tests/fakes_serve.py equipgroups）と、前の版の答え合わせ役 equipgroups。
"""
from datetime import datetime, timedelta, timezone

import schedule_fixture as fx  # （標準の部品だけ）

JST = timezone(timedelta(hours=9))


def start():
    lots = [(f"S{n}", "CR1", "L-1 LS3") for n in range(6)]
    rows = fx.schedule_rows("L-1", lots, datetime(2026, 10, 3, 8, 12, tzinfo=JST), 1)
    srv, url = fx.serve({"L-1": {"status": "SUCCESS", "entity": {"setsubiName": "L-1", "termKbn": "4", "updateTs": 0,
                                                                 "error": False, "errorMessage": "", "meisaiList": rows}}})
    return {"urls": {"cm3": url}, "close": srv.shutdown, "ask": None}
