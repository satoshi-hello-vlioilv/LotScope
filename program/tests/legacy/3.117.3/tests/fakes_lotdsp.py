# -*- coding: utf-8 -*-
"""LotDsp の本（desktop/tests/lotdsp_parity.rs）の作り物の LotDsp の API とサイト（版 3.117.0。標準の部品だけ。app を import しない）。

API: 道 /<札>/service/lotdsp/search//searchAction への POST に、札とロット番号ごとの答え（状態・本文・待つ秒）を返す。知らないロットは
「該当なし」（searchKeyInfos が空）。サイト: どの GET にも 200（届くかの確かめ用）。答えの表は焼いた見本
tests/fixtures/lotdsp_fake_tables.json（lotdsp_samples.fake_tables）。起こすのは tests/fakes_serve.py（python tests/fakes_serve.py lotdsp）と、
答え合わせ役 tests/lotdsp_oracle.py。
"""
import contextlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import lotdsp_samples

NOT_FOUND = json.dumps({"status": "OK", "entity": {"searchKeyInfos": []}}, ensure_ascii=False).encode("utf-8")


def start():
    tables = lotdsp_samples.fake_tables()

    class Api(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def do_POST(self):  # noqa: N802 (http.server の決まりの名前)
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n)
            try:
                lot = json.loads(raw or b"{}").get("lotNo")
            except ValueError:
                lot = None
            tag = self.path.strip("/").split("/", 1)[0]
            status, body, wait = tables.get(tag, {}).get(lot, (200, NOT_FOUND, 0))
            time.sleep(wait)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            with contextlib.suppress(OSError):           # 時間切れの場面では相手が先に切る
                self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Api)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return {"urls": {"lotdsp": f"http://127.0.0.1:{srv.server_address[1]}"}, "close": srv.shutdown, "ask": None}
