# -*- coding: utf-8 -*-
"""起こしたままの相手（作り物のサーバー）を起こす台本（版 3.117.0。標準の部品だけ。app を import しない）。

    python tests/fakes_serve.py 種類

    equipgroups … 作り物の CM3（設備グループの本の場面「スケジュールの元がある」: 設備 L-1 の予定 6 行）
    lotdsp      … 作り物の LotDsp の API とサイト（ロット番号ごとの答えは焼いた見本の表 tests/fixtures/lotdsp_fake_tables.json）

最初の 1 行に {"urls": {名前: URL}} を書き、標準入力が閉じるまで作り物を起こしたままにする。

窓の突き合わせの試験は、答え合わせ役（tests/*_oracle.py。app を使う）を起こしたまま、同じ作り物に問い合わせてきた。段 ④ で Python（program/app）を
外すと答え合わせ役は無くなるが、作り物の相手は試験の道具として残る。そこで作り物を起こす所をここへ切り出し、
- Python と比べる形: 答え合わせ役がここの start() を呼ぶ（作り物の中身は 1 か所）
- Python 無しの形（TPA_NO_PYTHON=1）: 窓の試験（desktop/tests/common/bake.rs の Bake::live）がこの台本を標準の Python で起こす
の両方が同じ作り物を使う。焼いた表（desktop/tests/baked）では、作り物の URL（流すたびに変わるポート）を名前つきの印 @URL(名前)・
@ADDR(名前) にそろえる（名前はここの urls の鍵）。
"""
import contextlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:           # python -I（Python 無しの形）は台本のフォルダを道に足さない
    sys.path.insert(0, str(HERE))

import schedule_fixture as fx  # noqa: E402  （標準の部品だけ）

JST = timezone(timedelta(hours=9))


def equipgroups():
    """設備グループの本の作り物の CM3: 設備 L-1 の予定 6 行（発行は 2026-10-03 08:12 JST）→ (閉じる係の並び, {名前: URL})"""
    lots = [(f"S{n}", "CR1", "L-1 LS3") for n in range(6)]
    rows = fx.schedule_rows("L-1", lots, datetime(2026, 10, 3, 8, 12, tzinfo=JST), 1)
    srv, url = fx.serve({"L-1": {"status": "SUCCESS", "entity": {"setsubiName": "L-1", "termKbn": "4", "updateTs": 0,
                                                                 "error": False, "errorMessage": "", "meisaiList": rows}}})
    return [srv.shutdown], {"cm3": url}


KINDS = {"equipgroups": equipgroups}


def start(kind):
    """作り物を起こす → (閉じる係の並び, {名前: URL})"""
    if kind not in KINDS:
        raise SystemExit(f"知らない種類: {kind}（{', '.join(KINDS)}）")
    return KINDS[kind]()


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    closers, urls = start(sys.argv[1])
    sys.stdout.write(json.dumps({"urls": urls}, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    with contextlib.suppress(Exception):
        for _ in sys.stdin:             # 標準入力が閉じるまで起こしておく
            pass
    for close in closers:
        close()


if __name__ == "__main__":
    main()
