# -*- coding: utf-8 -*-
"""ファイルの読み書きの共通部品（マスタ・利用状況・写しの台帳が同じ書き方を写さない）。

- write_json_atomic … 一時ファイルに書き切ってから名前を置き換える（読み手に書きかけを見せない）。
- retrying          … 置き換え・削除は、ほかが開いている間 Windows で拒まれるので、少し待ってやり直す。
- now_iso           … 記録に書く時刻（秒まで・この PC の時刻）。
- unquote_path      … 人が入れたファイルの場所（エクスプローラーの「パスのコピー」は " で囲まれる）。
- open_shared_read  … ほかのアプリが置き換え・削除できる開き方で読む（共有の上のファイルを写すとき）。
"""
from __future__ import annotations

import contextlib
import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path


def unquote_path(value) -> str:
    return str(value or "").strip().strip('"')


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def retrying(fn, budget: float = 2.0):
    """fn() を、OSError のあいだ budget 秒まで間を広げながらやり直す。無い（FileNotFoundError）はやり直さない。"""
    delay, waited = 0.05, 0.0
    while True:
        try:
            return fn()
        except FileNotFoundError:
            raise
        except OSError:
            if waited >= budget:
                raise
            time.sleep(delay)
            waited += delay
            delay = min(delay * 2, 0.5)


def write_json_atomic(path, data, *, indent: int = 2, durable: bool = False, retry_budget: float = 0.0) -> None:
    """data を JSON で path へ置き換える。durable=True はディスクへ書き切ってから（マスタ本体）。
    retry_budget 秒まで、置き換えの拒否（Windows で読み手が開いている）を待ってやり直す。失敗は OSError。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
            f.write("\n")
            if durable:
                f.flush()
                os.fsync(f.fileno())
        retrying(lambda: os.replace(tmp, path), retry_budget)
    finally:
        with contextlib.suppress(OSError):   # 置き換え済みなら無い。消せなくても次の書き込みは別の名前
            tmp.unlink()


# Windows の CreateFileW（ほかのアプリに読み・書き・置き換え／削除を許す開き方。Python の open() は置き換え／削除を許さない）
_GENERIC_READ, _SHARE_ALL, _OPEN_EXISTING, _SEQUENTIAL = 0x80000000, 0x1 | 0x2 | 0x4, 3, 0x08000000


def open_shared_read(path):
    """読むために開く（with で閉じる）。Windows では、開いているあいだも書き手が os.replace で置き換えられる開き方にする
    （FILE_SHARE_DELETE。Python の open() は付けないので、開いているあいだ置き換えが「使用中」で失敗する）。ほかの OS は open()。"""
    if os.name != "nt":
        return open(path, "rb")
    import _winapi
    import msvcrt
    h = _winapi.CreateFile(str(path), _GENERIC_READ, _SHARE_ALL, 0, _OPEN_EXISTING, _SEQUENTIAL, 0)
    return open(msvcrt.open_osfhandle(h, os.O_RDONLY | getattr(os, "O_BINARY", 0)), "rb")
