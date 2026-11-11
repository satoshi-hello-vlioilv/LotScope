# -*- coding: utf-8 -*-
"""作り物のブラウザ（DevTools の相手。版 3.98.0）。Python の係（services/lotdsp_direct.py）と窓の係（desktop/src/lotdsp_direct.rs）の
両方がこれを Edge として起こし、台本どおりの答えで同じ道を通るかを突き合わせる（desktop/tests/lotdsp_parity.rs ← tests/lotdsp_oracle.py）。

    lotdsp_cdp_fake.py --remote-debugging-port=0 --user-data-dir=X … --fake-script=台本.json

本物の Edge と同じに: --user-data-dir の下に DevToolsActivePort（1 行目がポート）を書き、GET /json/list で口を並べ、WebSocket で
DevTools Protocol の命令に答える。受けた命令は台本の log に 1 行ずつ書く（method・params。ページの手順の長い字は印に替える）。

台本（JSON）の項目:
    log            受けた命令を書くファイル
    href           location.href の答え
    runs           ページの手順を入れるたびに使う「段と結果」の並び（[[stage, result], …]。最後の 1 つを繰り返す）
    login          ログインの欄が見えているかの答えの並び（最後を繰り返す）
    targets        /json/list の並び（"page"・"footer"〈chrome://newtab-footer: 窓を持たない〉）
    start_delay    DevToolsActivePort を書くまでの秒
    exit_at_start  すぐ終わる（同じプロファイルの Edge が開いていて、前の Edge へ渡して終わる 2 つ目の起動の形）
    ignore_close   Browser.close を無視する（止められるまで残る）
    unevaluable    Page.navigate のあと、この回数だけ「[location.href …」の評価を誤りで返す（移る途中）
    ping_every     この回数の答えごとに、先に ping を送る
    fragment       答えを 2 つの枠に分けて送る（続きの枠）
"""
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return default


SCRIPT = json.loads(Path(arg("--fake-script")).read_text(encoding="utf-8"))
PROFILE = Path(arg("--user-data-dir"))
LOG = Path(SCRIPT["log"])
STATE = {"run": -1, "poll": 0, "login": 0, "uneval": 0, "replies": 0, "closed": False}
LOCK = threading.Lock()


def log(entry):
    with LOCK, open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")


def mark(expr):
    """長い字（ページの手順）は印に替えて書く（窓と Python で同じ印になる）。"""
    if "window.__tpaDirect = { stage: 'search'" in expr:
        lot = expr.split("const LOT = ", 1)[1].split(";", 1)[0]
        total = expr.split("const TOTAL_MS = ", 1)[1].split(";", 1)[0]
        return f"<手順 LOT={lot} TOTAL_MS={total}>"
    if "getElementById(id)" in expr:
        return "<ロット番号を入れる " + expr.rsplit("})(", 1)[1]
    if "#input_userId" in expr and "getClientRects" in expr and "for (const t of" not in expr:
        return "<ログインの欄>"
    if "ロット番号" in expr and "readyState" in expr:
        return "<いまの画面>"
    return expr


def answer(method, params):
    """命令 → (result, error)"""
    if method == "Runtime.evaluate":
        expr = params.get("expression", "")
        if "window.__tpaDirect = { stage: 'search'" in expr:
            STATE["run"] = min(STATE["run"] + 1, len(SCRIPT["runs"]) - 1)
            STATE["poll"] = 0
            return {"result": {"type": "boolean", "value": True}}, None
        if expr.startswith("window.__tpaDirect ?"):
            run = SCRIPT["runs"][max(STATE["run"], 0)] if STATE["run"] >= 0 else None
            if run is None:
                return {"result": {"type": "object", "value": None}}, None
            st = run[min(STATE["poll"], len(run) - 1)]
            STATE["poll"] += 1
            return {"result": {"type": "object", "value": st}}, None
        if expr.startswith("[location.href"):
            if STATE["uneval"] > 0:
                STATE["uneval"] -= 1
                return {"result": {"type": "object"}, "exceptionDetails": {"text": "Uncaught", "exception": {"description": "移る途中"}}}, None
            return {"result": {"type": "object", "value": [SCRIPT["href"], "complete"]}}, None
        m = mark(expr)
        if m == "<ログインの欄>":
            seq = SCRIPT.get("login") or [False]
            v = seq[min(STATE["login"], len(seq) - 1)]
            STATE["login"] += 1
            return {"result": {"type": "boolean", "value": v}}, None
        if m == "<いまの画面>":
            return {"result": {"type": "object", "value": [SCRIPT["href"], "complete", SCRIPT.get("shown", "")]}}, None
        return {"result": {"type": "boolean", "value": True}}, None
    if method == "Browser.getWindowForTarget":
        return {"windowId": 7, "bounds": {}}, None
    if method == "Page.navigate":
        STATE["uneval"] = int(SCRIPT.get("unevaluable", 0))
        return {"frameId": "F1"}, None
    if method == "Browser.close":
        if not SCRIPT.get("ignore_close"):
            STATE["closed"] = True
        return {}, None
    return {}, None


def recv_frame(conn, buf):
    while True:
        if len(buf) >= 2:
            b1, b2 = buf[0], buf[1]
            n, at = b2 & 0x7F, 2
            if n == 126 and len(buf) >= 4:
                n, at = int.from_bytes(buf[2:4], "big"), 4
            elif n == 127 and len(buf) >= 10:
                n, at = int.from_bytes(buf[2:10], "big"), 10
            elif n >= 126:
                n = None
            if n is not None and len(buf) >= at + 4 + n:
                mask = buf[at:at + 4]
                payload = bytes(x ^ mask[i % 4] for i, x in enumerate(buf[at + 4:at + 4 + n]))
                return b1 & 0x0F, payload, buf[at + 4 + n:]
        chunk = conn.recv(65536)
        if not chunk:
            return None, None, buf
        buf += chunk


def frame(opcode, payload, fin=True):
    n = len(payload)
    head = bytes([(0x80 if fin else 0) | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + n.to_bytes(2, "big")
    else:
        head += bytes([127]) + n.to_bytes(8, "big")
    return head + payload


def ws_session(conn, target):
    buf = b""
    while not STATE["closed"]:
        op, payload, buf = recv_frame(conn, buf)
        if op is None:
            return
        if op == 0xA:              # pong
            log({"pong": payload.decode("utf-8", "replace")})
            continue
        if op != 0x1:
            continue
        msg = json.loads(payload.decode("utf-8"))
        method, params = msg.get("method"), msg.get("params") or {}
        p = dict(params)
        if "expression" in p:
            p["expression"] = mark(p["expression"])
        log({"method": method, "params": p, "target": target})
        if target == "footer" and method == "Browser.getWindowForTarget":
            res, err = None, {"code": -32000, "message": "Browser window not found"}
        else:
            res, err = answer(method, params)
        reply = json.dumps({"id": msg.get("id"), **({"error": err} if err else {"result": res})}, ensure_ascii=False).encode("utf-8")
        STATE["replies"] += 1
        every = int(SCRIPT.get("ping_every") or 0)
        if every and STATE["replies"] % every == 0:
            conn.sendall(frame(0x9, b"hi"))
        # 先に関係の無い知らせ（id の無い枠）
        conn.sendall(frame(0x1, json.dumps({"method": "Page.frameNavigated", "params": {}}).encode()))
        if SCRIPT.get("fragment") and len(reply) > 4:
            half = len(reply) // 2
            conn.sendall(frame(0x1, reply[:half], fin=False) + frame(0x0, reply[half:]))
        else:
            conn.sendall(frame(0x1, reply))
        if method == "Browser.close" and STATE["closed"]:
            try:
                conn.close()
            finally:
                os._exit(0)


def handle(conn, port):
    try:
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = conn.recv(4096)
            if not chunk:
                return
            head += chunk
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        path = line.split(" ")[1]
        if path == "/json/list":
            items = []
            for i, t in enumerate(SCRIPT.get("targets") or ["page"]):
                url = "chrome://newtab-footer/" if t == "footer" else SCRIPT["href"]
                items.append({"type": "page", "url": url, "webSocketDebuggerUrl": f"ws://127.0.0.1:{port}/devtools/page/{t}{i}"})
            body = json.dumps(items).encode()
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode()
                         + b"\r\nConnection: close\r\n\r\n" + body)
            conn.close()
            return
        if path.startswith("/devtools/page/"):
            target = "footer" if path.rsplit("/", 1)[1].startswith("footer") else "page"
            conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                         b"Sec-WebSocket-Accept: x\r\n\r\n")
            ws_session(conn, target)
            return
        conn.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
    except OSError:
        pass
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main():
    if SCRIPT.get("exit_at_start"):
        log({"start": "exit"})
        return
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(16)
    port = srv.getsockname()[1]
    time.sleep(float(SCRIPT.get("start_delay") or 0))
    PROFILE.mkdir(parents=True, exist_ok=True)
    (PROFILE / "DevToolsActivePort").write_text(f"{port}\n/devtools/browser/x\n")
    log({"start": "listen", "visible": "--app=about:blank" in sys.argv})

    def watch_stdin_parent():
        while True:
            time.sleep(0.2)
            if STATE["closed"]:
                os._exit(0)
    threading.Thread(target=watch_stdin_parent, daemon=True).start()
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn, port), daemon=True).start()


if __name__ == "__main__":
    main()
