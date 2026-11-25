# -*- coding: utf-8 -*-
"""窓の開発用サーバー（desktop/examples/ui_serve.rs）の作り物の CM3（版 3.118.2。標準の部品だけ。app を import しない）。

仕掛のロットで作ったスケジュール（tests/schedule_fixture.responses。L-1・L-2・L-3）を作り物の CM3（schedule_fixture.serve）で配る。
Python の開発用サーバー（tools/ui_server.py）が自分の中の糸で起こしていた物と同じ中身。起こすのは場面の台本 tests/ui_window_scene.py
（fakes_serve.start("uicm3", 仕掛の SQLite)）か、`python tests/fakes_serve.py uicm3 仕掛の SQLite`。
"""
import schedule_fixture as fx  # （標準の部品だけ）


def start(wip):
    srv, url = fx.serve(fx.responses(wip))
    return {"urls": {"cm3": url}, "close": srv.shutdown, "ask": None}
