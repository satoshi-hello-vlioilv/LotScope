# -*- coding: utf-8 -*-
"""起こしたままの相手（作り物のサーバー）を起こす台本（版 3.117.0。標準の部品だけ。app を import しない）。

    python tests/fakes_serve.py 種類 [引数 …]

種類ごとの作り物は tests/fakes_<種類>.py の start(引数 …) が起こす（ここは入口だけで、種類を足しても変わらない）:

    equipgroups … 作り物の CM3（設備グループの本の場面「スケジュールの元がある」。tests/fakes_equipgroups.py）
    lotdsp      … 作り物の LotDsp の API とサイト（tests/fakes_lotdsp.py）
    schedule 仕掛の SQLite … 作り物の CM3（スケジュールの本の場面ごとの答え）と、接続を受けない口（tests/fakes_schedule.py）

最初の 1 行に {"urls": {名前: URL}} を書き、標準入力が閉じるまで作り物を起こしたままにする。作り物が尋ねられる口（ask）を持つときは、
標準入力の 1 行ごとに答えを JSON の 1 行で書く（スケジュールの作り物の「requests」「count」。口の無い作り物は行を読み捨てる）。

窓の突き合わせの試験は、前の版の答え合わせ役（app を使う）を起こしたまま、同じ作り物に問い合わせてきた。段 ④ で Python（program/app）を
外すと答え合わせ役は無くなるが、作り物の相手は試験の道具として残る。そこで作り物を起こす所を app から切り離し、
- Python と比べる形: 答え合わせ役がここの start(種類) を呼ぶ（作り物の中身は 1 か所）
- Python 無しの形（TPA_NO_PYTHON=1）: 窓の試験（desktop/tests/common/bake.rs の Bake::live）がこの台本を標準の Python で起こす
の両方が同じ作り物を使う。焼いた表（desktop/tests/baked）では、作り物の URL（流すたびに変わるポート）を名前つきの印 @URL(名前)・
@ADDR(名前) にそろえる（名前はここの urls の鍵）。
"""
import contextlib
import importlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:           # python -I（Python 無しの形）は台本のフォルダを道に足さない
    sys.path.insert(0, str(HERE))


def start(kind, *args):
    """作り物を起こす → {"urls": {名前: URL}, "close": 閉じる関数, "ask": 1 行を受けて答える関数か None, …}。args は種類ごとの引数"""
    if not re.fullmatch(r"[a-z][a-z0-9_]*", kind or "") or not (HERE / f"fakes_{kind}.py").is_file():
        raise SystemExit(f"知らない種類: {kind}（tests/fakes_<種類>.py がありません）")
    return importlib.import_module(f"fakes_{kind}").start(*args)


def utf8_pipes():
    """標準入出力を UTF-8 に決める（版 3.117.0 の作った後の直し・割れ 5: python -I は PYTHONIOENCODING を読まないので、Windows の
    パイプはその PC の符号〈cp1252・cp932〉になり、ASCII でない字の答えを書くと落ちた）"""
    for f in (sys.stdin, sys.stdout, sys.stderr):
        with contextlib.suppress(AttributeError, ValueError):
            f.reconfigure(encoding="utf-8")


def answer(fake, line):
    """尋ねられた 1 行への答えの 1 行（JSON）。答える口の中の誤りは飲まずに {"error": …} で答える（前は黙って相手が終わった）"""
    try:
        return json.dumps(fake["ask"](line), ensure_ascii=False, default=str)
    except Exception as e:      # noqa: BLE001  試験の相手: 誤りの訳を窓の試験の記録に出す
        return json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    utf8_pipes()
    fake = start(*sys.argv[1:])
    sys.stdout.write(json.dumps({"urls": fake["urls"]}, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    with contextlib.suppress(BrokenPipeError, KeyboardInterrupt):
        for line in sys.stdin:          # 標準入力が閉じるまで起こしておく
            if fake.get("ask") and line.strip():
                sys.stdout.write(answer(fake, line) + "\n")
                sys.stdout.flush()
    fake["close"]()


if __name__ == "__main__":
    main()
