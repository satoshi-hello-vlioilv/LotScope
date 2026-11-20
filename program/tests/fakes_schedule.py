# -*- coding: utf-8 -*-
"""スケジュールの本（desktop/tests/schedule_parity.rs）の作り物の CM3（版 3.117.0。標準の部品だけ。app を import しない）。

場面ごとの答え（World: 届く・中身が変わる・chunked・HTTP/1.0・charset・文字化けと HTML の壊れ方・答えの形の端・30x・500・黙る・閉じる …）を
作り物の CM3（tests/schedule_fixture.Cm3Server。道の頭 /<係>/<場面>/ で場面と数えを分ける）に載せ、接続を受けない口（blackhole）も作る。
前は答え合わせ役 tests/schedule_oracle.py の中にあった（app を import する台本）。起こすのは tests/fakes_serve.py
（python tests/fakes_serve.py schedule 仕掛の SQLite）と、答え合わせ役。尋ねられる口（ask）: 「requests 係 場面」＝その場面で CM3 が受けた要求の並び・
「count 係 場面」＝その数（窓の試験が途中で尋ねる）・「proxylog 名前」＝作り物のプロキシが受けた要求の行と見出し。
版 3.117.1（段 ③-6）: https の作り物（作り物の CA が出した 127.0.0.1 の証明書・名前の違う証明書・信頼しない CA の証明書。tests/fixtures/tls）・
TLS でない口（何か来たらすぐ平文の 400 を返す）・作り物のプロキシ（中継・黙る・断る）も起こす。
"""
import json
import os
import socket
import threading
import time
from datetime import datetime, timedelta, timezone

import schedule_fixture as fx  # （標準の部品だけ）

JST = timezone(timedelta(hours=9))


def small_rows(update):
    """charset・文字の場面の小さな予定（cp932 で書ける字だけ）"""
    t = update
    rows = []
    for i, (lot, yoto) in enumerate([("A1001", "缶～材"), ("A1002", "一般用材"), ("A1001", "箔地－用"), ("A1003", "点検板")]):
        t += timedelta(minutes=20)
        rows.append(fx._row(f"{t.month:02d}/{t.day:02d} {t.hour:02d}:{t.minute:02d}" if i % 2 == 0 else f"     {t.hour:02d}:{t.minute:02d}",
                            lotNo=lot, zaishitsu="A1100", inItaAtsu="1.200", outItaAtsu="0.900", reienHaba="1250", seihinItaAtsu="0.900",
                            seihinItaHaba="1240", keijo="C", yotoMei=yoto, jiKotei="L-2"))
    t += timedelta(minutes=7)
    rows.append(fx._row(f"     {t.hour:02d}:{t.minute:02d}", roll="段取", lotNo="り替え", inItaAtsu="15分", teisiStyle="cmschview-teisi"))
    return rows


def answer(eq, rows, update):
    return {"status": "SUCCESS", "entity": {"setsubiName": eq, "termKbn": "4", "updateTs": int(update.timestamp() * 1000), "error": False,
                                            "errorMessage": "", "meisaiList": rows}}


def moji_cp932(s):
    """CP932 のバイトを Latin-1 で読んだ字"""
    return s.encode("cp932").decode("latin-1")


def html_rows(update):
    """文字化けと HTML の壊れ方（fix_text のすべての道）"""
    vals = ["&#128;材", "&ampx缶", "&notit;", "<b>太</b>字<br>", "&#xD800;x", "&#1;y", "&#x3000", "&zz;", "a&#;b", "<>", "&lt;A&gt;",
            moji_cp932("缶材"), "缶材".encode("utf-8").decode("latin-1"), "　両端　", "\x1c空白\x1f", "&#12288;全角", "Ã©"]
    rows = []
    t = update
    for i, v in enumerate(vals):
        t += timedelta(minutes=15)
        rows.append(fx._row(f"{t.month:02d}/{t.day:02d} {t.hour:02d}:{t.minute:02d}", lotNo=f"H{i:03d}", zaishitsu=v, inItaAtsu="1.0",
                            outItaAtsu="0.5", reienHaba="1000", seihinItaAtsu="0.5", seihinItaHaba="990", keijo="S", yotoMei=v, jiKotei=v))
    t += timedelta(minutes=5)
    rows.append(fx._row(f"{t.month:02d}/{t.day:02d} {t.hour:02d}:{t.minute:02d}", roll="<i>ロール</i>", lotNo="&amp;交換", zaishitsu=moji_cp932("計画"),
                        inItaAtsu="１０分", teisiStyle="x"))
    return rows


def shape_answers(update):
    """答えの形の端（設備ごと）"""
    ts = int(update.timestamp() * 1000)
    dec = int(datetime(2026, 12, 30, 8, 0, tzinfo=JST).timestamp() * 1000)
    rows = small_rows(update)
    edge = [fx._row("12/31 23:50", lotNo="Y1", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("00:10", lotNo="Y2", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("01/01 01:00", lotNo="Y3", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("０１/０２ ０２:０５", lotNo="Y4", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("02/30 10:00", lotNo="Y5", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("25:00", lotNo="Y6", zaishitsu="A", inItaAtsu="0", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("", lotNo="Y7", zaishitsu="A", inItaAtsu="abc", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("   ", lotNo="Y8", zaishitsu="A", inItaAtsu="1e2", outItaAtsu="", reienHaba="1", keijo="C")]
    nums = [{"kanryoYotei": "10/03 09:00", "lotNo": 12345, "zaishitsu": "A1100", "inItaAtsu": 0.3, "outItaAtsu": 0.2, "reienHaba": 1250,
             "seihinItaAtsu": 0.2, "seihinItaHaba": 1240, "keijo": True, "yotoMei": "x", "jiKotei": "S9", "rowStyle": None},
            {"kanryoYotei": "10/03 09:30", "lotNo": 12345.0, "zaishitsu": "A1100", "inItaAtsu": "0.2", "outItaAtsu": "0.1", "reienHaba": "1",
             "keijo": "C", "yotoMei": "x"},
            {"kanryoYotei": "10/03 10:00", "roll": 7.5, "lotNo": 1e16, "zaishitsu": "分", "inItaAtsu": "30分", "keijo": None, "x": [1]}]
    return {
        "S1": {"status": "FAIL", "entity": {}},
        "S2": {"status": ["a", 1, None, True, 2.5], "entity": {}},
        "S3": {"status": "SUCCESS", "entity": {"error": True, "errorMessage": 5}},
        "S4": [1, 2],
        "S5": {"status": "SUCCESS", "entity": {"error": 1, "errorMessage": "&lt;止&gt;　"}},
        "S6": {"status": "SUCCESS", "entity": {"setsubiName": "", "termKbn": 4, "updateTs": dec, "meisaiList": edge}},
        "S7": {"status": "SUCCESS", "entity": {"setsubiName": "S7", "updateTs": str(ts), "meisaiList": rows}},
        "S8": {"status": "SUCCESS", "entity": {"setsubiName": "S8", "updateTs": "abc", "meisaiList": []}},
        "S9": {"status": "SUCCESS", "entity": {"setsubiName": "S9", "updateTs": ts + 0.7, "meisaiList": nums}},
        "SA": {"status": "SUCCESS", "entity": None},
        "SB": {"status": "SUCCESS", "entity": {"error": True, "errorMessage": ""}},
        "SC": {"status": "SUCCESS", "entity": {"updateTs": -1000, "meisaiList": None}},
        "SD": {"status": "SUCCESS", "entity": {"updateTs": 33_000_000_000_000, "meisaiList": rows}},        # 3015 年
        "SE": {"status": "SUCCESS", "entity": {"updateTs": -100_000_000_000_000, "meisaiList": None}},   # 1 年より前（どの OS でも None）
    }


class World:
    """場面の答え（作り物の CM3 の handler）"""

    def __init__(self, wip):
        self.update = datetime(2026, 10, 3, 8, 5, tzinfo=JST)
        self.full = fx.responses(wip)
        self.small = {eq: answer(eq, small_rows(self.update), self.update) for eq in ("L-1", "L-2", "L-3")}
        self.html = answer("L-1", html_rows(self.update), self.update)
        self.shapes = shape_answers(self.update)
        self.port = 0
        self.tls_port = 0

    def __call__(self, scene, req, k):  # noqa: C901 (場面の振り分け)
        eq, runner = req["equip"], req["path"].split("/")[1]
        base = f"/{runner}/{scene}"
        # 同じ答えの場面を分けた名前（版 3.117.1 の K5: 「timeout~38」は timeout の答え。CM3 が受けた要求は場面の名前ごとに数える）
        scene = scene.split("~", 1)[0]
        if scene in ("ok", "concurrent", "timeout", "tls", "ptls", "phttp", "pcred", "pbypass", "pnone", "pkind", "phttps", "engine", "pnone2"):
            return fx.json_reply(self.full.get(eq) or {"status": "SUCCESS", "entity": {}})
        if scene == "change":                         # 問い合わせごとに中身が変わる（新しい世代）
            a = json.loads(json.dumps(self.full[eq]))
            a["entity"]["meisaiList"] = a["entity"]["meisaiList"][(k - 1) % 3:]
            a["entity"]["updateTs"] += k * 60000
            return fx.json_reply(a)
        if scene == "flip":                           # 2 回目だけ i64 に入らない整数（窓は 1 回だけ降り、受け身の Python が取る。版 3.115.0 から NaN は窓も答える）。ほかは回ごとに中身が変わる
            a = json.loads(json.dumps(self.full[eq]))
            a["entity"]["meisaiList"] = a["entity"]["meisaiList"][(k - 1) % 4:]
            a["entity"]["updateTs"] += k * 60000
            if k == 2:
                return fx.reply(body=json.dumps({**a, "x": 10 ** 20}), headers=[("Content-Type", "application/json")])
            return fx.json_reply(a)
        if scene == "chunk11":
            return fx.json_reply(self.small[eq], chunked=True)
        if scene == "http10":
            return fx.json_reply(self.small[eq], version="HTTP/1.0", length=False)
        if scene == "sjis":
            return fx.json_reply(self.small[eq], charset="Shift_JIS", encoding="cp932", chunked=True)
        if scene == "cp932":
            return fx.json_reply(self.small[eq], charset=None, encoding="cp932")
        if scene == "quoted":
            return fx.reply(body=json.dumps(self.small[eq], ensure_ascii=False).encode("utf-8"),
                            headers=[("Content-Type", 'application/json; charset="UTF-8"')])
        if scene == "latin":
            return fx.json_reply(self.small[eq], charset="ISO-8859-1")
        if scene == "winj":
            return fx.json_reply(self.small[eq], charset="Windows-31J", encoding="cp932")
        if scene == "eucjp":                        # EUC-JP に無い「～」は「〜」にして書く
            a = json.loads(json.dumps(self.small[eq]).replace("\\uff5e", "\\u301c").replace("\\uff0d", "\\u2212"))
            return fx.json_reply(a, charset="EUC-JP", encoding="euc_jp")
        if scene == "html":
            return fx.json_reply(self.html)
        if scene == "shapes":
            return fx.json_reply(self.shapes.get(eq, {}))
        if scene == "nan":
            return fx.reply(body=json.dumps({**self.small[eq], "x": float("nan")}), headers=[("Content-Type", "application/json")])
        if scene == "nojson":
            return fx.reply(body="hello 1e3", headers=[("Content-Type", "text/plain")])
        if scene == "e500":
            return fx.reply(500, "Internal Server Error", b"<html>oops</html>", [("Content-Type", "text/html")])
        if scene == "e404":
            return fx.reply(404, "Not  Found ", b"", [])
        if scene == "r302json":
            if req["method"] == "POST":
                return fx.reply(302, "Found", b"", [("Location", f"{base}/next?eq={eq}")])
            return fx.json_reply(self.small[eq])
        if scene == "r302html":
            if req["method"] == "POST":
                return fx.reply(302, "Found", b"", [("Location", f"{base}/page")])
            return fx.reply(body="<html><body>login</body></html>", headers=[("Content-Type", "text/html; charset=utf-8")])
        if scene == "r301abs":
            if req["method"] == "POST":
                return fx.reply(301, "Moved Permanently", b"", [("Location", f"http://127.0.0.1:{self.port}{base}/next?eq={eq}")])
            return fx.json_reply(self.small[eq], chunked=True)
        if scene == "r303then307":
            if req["method"] == "POST":
                return fx.reply(303, "See Other", b"", [("Location", f"{base}/a?eq={eq}")])
            if "/a?" in req["path"]:
                return fx.reply(307, "Temporary Redirect", b"", [("Location", f"{base}/b?eq={eq}")])
            return fx.json_reply(self.small[eq])
        if scene == "r307":
            return fx.reply(307, "Temporary Redirect", b"", [("Location", f"{base}/next")])
        if scene == "rloop":
            return fx.reply(302, "Found", b"", [("Location", f"{base}/loop")])
        if scene == "rbyp":                         # 30x のたびにプロキシを決め直す（localhost は no_proxy で直・行き先の 127.0.0.1 はプロキシ越し）
            if req["method"] == "POST":
                return fx.reply(302, "Found", b"", [("Location", f"http://127.0.0.1:{self.port}{base}/next?eq={eq}")])
            return fx.json_reply(self.small[eq])
        if scene == "rtls":                         # http → https の 302（https の行き先もたどる）
            if req["method"] == "POST":
                return fx.reply(302, "Found", b"", [("Location", f"https://127.0.0.1:{self.tls_port}{base}/next?eq={eq}")])
            return fx.json_reply(self.small[eq])
        if scene == "rnoloc":
            return fx.reply(302, "Found", b"", [])
        if scene == "silent":
            return ("sleep", 2.5)
        if scene == "closed":                       # 何も言わずに閉じる
            return None
        return fx.reply(404, "Not Found", b"", [])


def blackhole():
    """接続を受けない口（待ち行列を埋めた listen。SYN が捨てられ、接続が timeout する）"""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(0)
    held = socket.socket()
    held.settimeout(0.5)
    try:
        held.connect(s.getsockname())
    except OSError:
        pass
    for _ in range(3):
        x = socket.socket()
        x.settimeout(0.3)
        try:
            x.connect(s.getsockname())
        except OSError:
            pass
    return s, held


TLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "tls")


def tls_files(name):
    return os.path.join(TLS, f"{name}.pem"), os.path.join(TLS, f"{name}.key")


def _pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except OSError:
        pass
    finally:
        for x in (a, b):
            try:
                x.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class Proxy:
    """作り物のプロキシ（版 3.117.1）。mode: auth（407 で認証を求める）・relay（中継。「POST http://名前:番号/道 HTTP/1.1」は道だけにして行き先へ送り、CONNECT は
    「200 Connection established」の後に流れをそのまま中継）・silent（受けて黙る）・deny（403 Forbidden で断る）。
    log に受けた要求の行と見出しを残す（窓と Python で比べる: 利用者:合言葉 を送らない・URL の全体・CONNECT の行）"""

    def __init__(self, mode):
        self.mode = mode
        self.log = []
        self.lock = threading.Lock()
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._one, args=(c,), daemon=True).start()

    def _one(self, c):
        up = None
        try:
            data = b""
            while b"\r\n\r\n" not in data:
                got = c.recv(65536)
                if not got:
                    return
                data += got
            head, _, rest = data.partition(b"\r\n\r\n")
            lines = head.decode("latin-1").split("\r\n")
            hs = [x.split(": ", 1) for x in lines[1:]]
            with self.lock:
                self.log.append({"line": lines[0], "headers": hs})
            if self.mode == "silent":
                c.settimeout(30)
                while c.recv(65536):
                    pass
                return
            if self.mode == "deny":
                c.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                return
            if self.mode == "auth":
                c.sendall(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"corp\"\r\nContent-Length: 0\r\n\r\n")
                return
            method, target, ver = lines[0].split(" ", 2)
            if method == "CONNECT":
                host, port = target.rsplit(":", 1)
                up = socket.create_connection((host, int(port)), timeout=10)
                up.settimeout(None)
                c.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                if rest:
                    up.sendall(rest)
            else:
                assert target.startswith("http://")
                hostport, _, path = target[7:].partition("/")
                host, _, port = hostport.partition(":")
                up = socket.create_connection((host, int(port or 80)), timeout=10)
                up.settimeout(None)
                path = "/" + path.split("#", 1)[0]
                up.sendall(f"{method} {path} {ver}\r\n".encode("latin-1") + "".join(f"{k}: {v}\r\n" for k, v in hs).encode("latin-1") + b"\r\n" + rest)
            t = threading.Thread(target=_pipe, args=(c, up), daemon=True)
            t.start()
            _pipe(up, c)
            t.join(10)
        except OSError:
            pass
        finally:
            for x in (c, up):
                if x is not None:
                    try:
                        x.close()
                    except OSError:
                        pass

    def close(self):
        self.sock.close()


class PlainQuick:
    """TLS でない口（何か来たらすぐ平文の 400 を返して閉じる。https の URL で http の口を指した形）"""

    def __init__(self):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            try:
                c.settimeout(5)
                c.recv(1024)
                c.sendall(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                time.sleep(0.05)
            except OSError:
                pass
            finally:
                c.close()

    def close(self):
        self.sock.close()


def start(wip):
    """作り物の CM3 と、接続を受けない口と、https・プロキシの作り物を起こす。wip は仕掛の SQLite（釜番つき。届く場面の予定の元）。
    → {"urls": {名前: URL}, "close", "ask", "srv": 作り物の CM3, "hole_port": 接続を受けない口の番号}"""
    if not os.path.exists(wip):
        # Python 無しの形（窓の試験が台本を起こす）: 答え合わせ役と同じ作り物の仕掛（lotlist_fixture.make_wip の 400 行・釜番つき。乱数の種は固定）
        import lotlist_fixture  # （標準の部品だけ）
        os.makedirs(os.path.dirname(os.path.abspath(wip)), exist_ok=True)
        lotlist_fixture.make_wip(str(wip), n=400)
        fx.add_kama(wip)
    world = World(wip)
    srv = fx.Cm3Server(world)
    world.port = srv.port
    tls = fx.Cm3Server(world, tls=tls_files("server"), share=srv)
    world.tls_port = tls.port
    tlsname = fx.Cm3Server(world, tls=tls_files("wrongname"), share=srv)
    tlsbad = fx.Cm3Server(world, tls=tls_files("untrusted"), share=srv)
    plain = PlainQuick()
    proxies = {"relay_py": Proxy("relay"), "relay_rs": Proxy("relay"), "silent": Proxy("silent"), "deny": Proxy("deny"),
               "auth": Proxy("auth")}
    bh, held = blackhole()

    def ask(line):
        cmd = line.split()
        if cmd[:1] == ["requests"]:
            return srv.requests(cmd[1], cmd[2])
        if cmd[:1] == ["count"]:
            with srv.lock:
                return sum(1 for (ru, sc, _r) in srv.log if ru == cmd[1] and sc == cmd[2])
        if cmd[:1] == ["proxylog"]:
            p = proxies[cmd[1]]
            with p.lock:
                out = list(p.log)
                p.log.clear()
            return out
        return None

    def close():
        for x in (srv, tls, tlsname, tlsbad, plain, *proxies.values()):
            x.close()
        bh.close()
        held.close()
    hole_port = bh.getsockname()[1]
    urls = {"cm3": srv.url, "cm3local": f"http://localhost:{srv.port}", "hole": f"http://127.0.0.1:{hole_port}", "tls": tls.url, "tlsname": tlsname.url, "tlsbad": tlsbad.url,
            "plain": f"https://127.0.0.1:{plain.port}", **{k: p.url for k, p in proxies.items()}}
    return {"urls": urls, "close": close, "ask": ask, "srv": srv, "hole_port": hole_port}
