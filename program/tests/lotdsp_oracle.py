# -*- coding: utf-8 -*-
"""LotDsp の 9 本の「正しい答え」を出す係（版 3.98.0。desktop/tests/lotdsp_parity.rs が起こしたまま使う）。

    python tests/lotdsp_oracle.py serve 作業フォルダ

作り物の LotDsp の API（道 /<札>/service/lotdsp/search//searchAction・ロット番号ごとの答え）と、作り物の LotDsp のサイト（届くかの
確かめ用）を起こし、場面ごとに Python の道（routes/lots.py。Flask の試験の口）へ同じ本文を当てた答え（状態・本文）と、1 歩ごとの
学びの覚え（lotdsp_api_map.json）を出す。窓の試験は同じ設定・同じ設備マスタ・同じ作り物で窓の係（src/lotdsp.rs）に同じ本文を当て、
答えと覚えが同じかを見る（時刻・秒は伏せる）。見えない Edge の係は、作り物のブラウザ（tests/lotdsp_cdp_fake.py）を Edge として起こし、
答え・送った DevTools の命令の並びを出す（窓は同じ台本で同じ並びを送るか）。最初の 1 行（JSON）を出したあとは、標準入力が閉じるまで
作り物を起こしたままにする。
"""
import contextlib
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import lotdsp_api as api  # noqa: E402
from app.services import lotdsp_direct as D  # noqa: E402
from tests.test_lotdsp_api import FIXTURE, entity_of, html_with_offs  # noqa: E402
from tests.test_lotdsp_rules import with_cells  # noqa: E402

OFFS = [("12.5", "3.0"), ("", "4.5"), ("7.2", ""), ("1.1", "2.2")] + [("", "")] * 6
TAB = ('<table><tr><td><a class="MniTabLnk">ICAS情報</a></td><td class="MniTabTblSelTd"><div class="MniTabSelTxt" title="Current Selection:">'
       '<span class=" disabled TabPad">進度情報</span></div></td></tr></table>')

# ------------------------------------------------------------------ 作り物の LotDsp の API
TABLES = {}          # 札 → {ロット番号: (状態, 本文のバイト, 待つ秒)}


def jb(x):
    return json.dumps(x, ensure_ascii=False).encode("utf-8")


class Api(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            lot = json.loads(raw or b"{}").get("lotNo")
        except ValueError:
            lot = None
        tag = self.path.strip("/").split("/", 1)[0]
        status, body, wait = TABLES.get(tag, {}).get(lot, (200, jb({"status": "OK", "entity": {"searchKeyInfos": []}}), 0))
        time.sleep(wait)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        with contextlib.suppress(OSError):           # 時間切れの場面では相手が先に切る
            self.wfile.write(body)

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


def start_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Api)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


# ------------------------------------------------------------------ 場面
def mask(v):
    """時刻・秒は伏せる（窓と Python で別に測る）"""
    if isinstance(v, dict):
        return {k: ("*" if k in ("at", "conflict", "seconds") else mask(x)) for k, x in v.items()}
    if isinstance(v, list):
        return [mask(x) for x in v]
    return v


def app_for(local, li):
    a = create_app({"TESTING": True, "MASTER_STORE": MasterStore(PROGRAM, local_root=local, settings={})})
    a.config["LOTDSP_API_SYNC"] = True
    a.config["LOTDSP_API_MAP"] = api.KeyMap(local / "lotdsp_api_map.json")
    a.config["APP_SETTINGS"]["lotdsp_import"] = li
    return a


def run_steps(work, name, li, steps, setup=None, equipment=None):
    """Python の道に歩を当てる → 場面（窓へ渡す設定と、歩ごとの答えと覚え）。equipment は設備マスタの行を替える"""
    from unittest import mock
    if equipment is not None:
        with mock.patch("app.repositories.master_repository.MasterRepository.equipment", lambda self: equipment):
            out = run_steps(work, name, li, steps, setup)
        out["equipment"] = equipment
        return out
    local = work / name.replace("/", "_")
    shutil.rmtree(local, ignore_errors=True)
    local.mkdir(parents=True)
    if setup:
        setup(local)
    app = app_for(local, li)
    c = app.test_client()
    from app.repositories.master_repository import MasterRepository
    equipment = MasterRepository(app.config["MASTER_STORE"]).equipment()
    out = []
    for st in steps:
        if "li" in st:
            app.config["APP_SETTINGS"]["lotdsp_import"] = st["li"]
        method, path, query, body = st["method"], st["path"], st.get("query", ""), st.get("body", "")
        url = path + ("?" + query if query else "")
        raw = body.encode("utf-8") if isinstance(body, str) else bytes(body)
        r = c.get(url) if method == "GET" else c.post(url, data=raw)
        mp = local / "lotdsp_api_map.json"
        mapv = json.loads(mp.read_text(encoding="utf-8")) if mp.is_file() else None
        out.append({**{k: v for k, v in st.items() if k != "body"}, "body_hex": raw.hex(), "status": r.status_code,
                    "json": mask(r.get_json()), "map": mask(mapv)})
    return {"name": name, "li": li, "equipment": equipment, "steps": out, "setup": setup.__name__ if setup else None}


def P(path, body, **kw):
    return {"method": "POST", "path": path, "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False), **kw}


def G(path, query="", **kw):
    return {"method": "GET", "path": path, "query": query, **kw}


IMPORT = "/api/lots/import-lotdsp"
API = "/api/lots/fetch-lotdsp-api"
STATUS = "/api/lots/lotdsp-api/status"
SURVEY = "/api/lots/lotdsp-api/survey"
LINK = "/api/lots/lotdsp-api/link"


def html_cases():
    t = json.loads((PROGRAM / "tests" / "fixtures" / "lotdsp_html_cases.json").read_text(encoding="utf-8"))
    return [(n, c.get("html") or (PROGRAM / "tests" / "fixtures" / c["file"]).read_text(encoding="utf-8")) for n, c in t["cases"].items()]


def variants():
    """見本を崩した画面（BOX 3・25・空の設備・マスタに無い設備・設計と違う設備・№が数でない・列が無い・ロット番号違い）"""
    import re
    rows = re.findall(r'<tr ng-repeat="meisaiInfo in staffProgressJBoxInfos[^"]*"[^>]*>.*?</tr>', FIXTURE, re.S)
    first, last = FIXTURE.index(rows[0]), FIXTURE.index(rows[-1]) + len(rows[-1])

    def with_rows(n):
        out = []
        for i in range(n):
            src = rows[min(i, len(rows) - 1)]
            out.append(re.sub(r'(<span class="prog-boxno ng-binding">)\s*\d+\s*(</span>)', rf"\g<1>{i + 1}\g<2>", src, count=1))
        return FIXTURE[:first] + "\n".join(out) + FIXTURE[last:]
    eq = re.compile(r'(<span class="prog-jbsm ng-binding">)([^<]*)(</span>)')
    v = {
        "BOX 3": with_rows(3), "BOX 25": with_rows(25),
        "実績の設備が空": FIXTURE.replace(eq.search(rows[1]).group(0), eq.search(rows[1]).group(1) + eq.search(rows[1]).group(3), 1),
        "マスタに無い設備": FIXTURE.replace(rows[2], eq.sub(lambda m: m.group(1) + "ZZZ9" + m.group(3), rows[2], count=1), 1),
        "全角の設備名": FIXTURE.replace(rows[3], eq.sub(lambda m: m.group(1) + " Ｌ－１ " + m.group(3), rows[3], count=1), 1),
        "№が数でない": FIXTURE.replace(rows[4], re.sub(r'(<span class="prog-boxno ng-binding">)\s*\d+\s*(</span>)', r"\g<1>x\g<2>", rows[4], count=1), 1),
        "実績の見出しが無い": FIXTURE.replace("板厚", "板あつ"),
        "前オフの見出しが無い": FIXTURE.replace("前ｵﾌ", "まえ").replace("後ｵﾌ", "うしろ"),
        "地の終わり": FIXTURE[: len(FIXTURE) // 2],
    }
    return v


def scenarios(work, base):
    out = []
    site = base + "/LotDspWeb/"
    off = {"url": site, "api": {"enabled": False}}
    # 1. 画面の表の事例（学ばない）
    steps = [P(IMPORT, {"html": h, "lot_no": ""}, name=n) for n, h in html_cases()]
    steps += [P(IMPORT, {"html": h, "lot_no": "L7150C0"}, name=n) for n, h in variants().items()]
    steps += [
        P(IMPORT, {"html": FIXTURE, "lot_no": "l7150c0"}, name="ロット番号の大小"),
        P(IMPORT, {"html": FIXTURE, "lot_no": "L9999X9"}, name="ロット番号違い"),
        P(IMPORT, {"html": FIXTURE, "lot_no": None}, name="ロット番号 null"),
        P(IMPORT, {"html": FIXTURE, "lot_no": 7150}, name="ロット番号が数"),
        P(IMPORT, {"html": 123, "lot_no": "L1"}, name="html が数"),
        P(IMPORT, {"html": None}, name="html が null"),
        P(IMPORT, {"lot_no": "L1"}, name="html が無い"),
        P(IMPORT, {"html": "   \n\x1c "}, name="空白だけ"),
        P(IMPORT, {"html": "x" * 5_000_001}, name="大きすぎる"),
        P(IMPORT, {"html": "<table><tr><td>&#" + "1" * 4301 + ";</td></tr></table>"}, name="4300 桁の参照"),
        P(IMPORT, "[1]", name="並びの本文"), P(IMPORT, "{bad", name="読めない本文"), P(IMPORT, "", name="空の本文"),
        P(IMPORT, '{"html": NaN}', name="NaN の html"), P(IMPORT, '{"html": "' + FIXTURE.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '", "x": NaN}', name="NaN の欄"),
        P(IMPORT, '{"a": ' + "[" * 70 + "]" * 70 + "}", name="深い本文"),
        P(IMPORT, '\ufeff{"html": "x"}', name="BOM の本文"),
        P(IMPORT, {"html": FIXTURE, "lot_no": "L7150C0"}, name="設備マスタで絞らない", li={**off, "only_master_equipment": False}),
        P(IMPORT, {"html": FIXTURE.replace("板厚", "厚み"), "lot_no": "L7150C0"}, name="列の見出しを設定で替える",
          li={**off, "actual_columns": {"thickness": "厚み"}, "product_columns": {"product_thickness": "厚み"}}),
        P(IMPORT, {"html": FIXTURE, "lot_no": "L7150C0"}, name="見出し項目を設定で替える", li={**off, "lot_labels": {"use_name": "用途", "density": "なし"}}),
        # 作った後の採点の割れ 1（版 3.98.0）: 単位つきの数・桁区切りの空白・読めない欄・2 つの数
        P(IMPORT, {"html": with_cells([("7.000mm", "1,200.00 mm", "6,220.0 kg"), ("*", "1 200", "(7)"), ("7.0/8.0", "-", "1e3kg"),
                                       ("０．５０５", " ", "６，２２０")]), "lot_no": "L7150C0"}, name="単位つき・読めない欄"),
        P(IMPORT, {"html": with_cells([("x", "y", "z")] * 10), "lot_no": "L7150C0"}, name="どの欄も読めない"),
        P(IMPORT, {"html": with_cells([("7.0/8.0", None, None)]), "lot_no": "L7150C0"}, name="列の見出しを替えた知らせ",
          li={**off, "actual_columns": {"thickness": "板厚"}}),
    ]
    out.append(run_steps(work, "画面の表", off, steps))

    # 2. 同一工程の名前（設備マスタ）
    rows = json.loads((PROGRAM / "data" / "equipment_master.json").read_text(encoding="utf-8"))
    for r in rows:
        if r.get("設備名") == "CAL":
            r["同一工程"] = "CAF*, CAI?"
        if r.get("設備名") == "L-1":
            r["同一工程"] = "LONE"
    rows.append({"id": 990, "設備名": 7, "同一工程": "SEVEN"})
    alias = FIXTURE.replace(">CAL<", ">CAF2<").replace(">L-1<", ">LONE<", 1).replace(">TLV<", ">SEVEN<", 1)
    # 3. 学ぶ・API で読む・調べる
    tag = "a"
    h1, h2, h3 = html_with_offs(OFFS), html_with_offs(OFFS, lot_no="L7151C0", thickness_shift=0.5), html_with_offs(OFFS, lot_no="L7152C0", thickness_shift=1.0)
    TABLES[tag] = {
        "L7150C0": (200, jb(entity_of(h1)), 0), "L7151C0": (200, jb(entity_of(h2)), 0), "L7152C0": (200, jb(entity_of(h3)), 0),
        "E500": (500, b"oops", 0), "EJSON": (200, b"<html>login</html>", 0), "EBIZ": (200, jb({"status": "ERROR", "errorMessage": "業務の誤り"}), 0),
        "EBIZ2": (200, jb({"status": "ERROR"}), 0), "EARR": (200, b"[1, 2]", 0), "EBOM": (200, b"\xef\xbb\xbf" + jb(entity_of(h1)), 0),
        "ENOENT": (200, jb({"status": "OK"}), 0), "ESLOW": (200, jb(entity_of(h1)), 2.5), "ENOTDICT": (200, jb({"entity": [1]}), 0),
        "EMIS": (200, jb(entity_of(h2)), 0), "E307": (307, b"", 0),
    }
    li = {"url": site, "api": {"search_url": f"{base}/{tag}/service/lotdsp/search//searchAction", "timeout_seconds": 2}}
    tab_h1 = TAB + h1
    steps = [
        G(STATUS, name="学ぶ前"), P(API, {"lot_no": "L7150C0"}, name="学ぶ前は使えない"),
        P(IMPORT, {"html": h1, "lot_no": "L7150C0"}, name="1 つ目を学ぶ"), G(STATUS, name="1 つ目のあと"),
        P(IMPORT, {"html": h2, "lot_no": "L7151C0"}, name="2 つ目を学ぶ"), G(STATUS, name="使える"),
        P(API, {"lot_no": "L7150C0"}, name="API で読む"), P(API, {"lot_no": "l7151c0"}, name="API で読む 2"),
        P(API, {"lot_no": "NOPE1"}, name="該当なし"), P(API, {"lot_no": "E500"}, name="HTTP 500"), P(API, {"lot_no": "EJSON"}, name="JSON でない"),
        P(API, {"lot_no": "EBIZ"}, name="業務の誤り"), P(API, {"lot_no": "EBIZ2"}, name="理由なしの誤り"), P(API, {"lot_no": "EARR"}, name="並びの応答"),
        P(API, {"lot_no": "EBOM"}, name="BOM の応答"), P(API, {"lot_no": "ENOENT"}, name="entity が無い"), P(API, {"lot_no": "ESLOW"}, name="時間切れ"),
        P(API, {"lot_no": "ENOTDICT"}, name="entity が表でない"), P(API, {"lot_no": "EMIS"}, name="違うロット"), P(API, {"lot_no": "E307"}, name="307"),
        P(API, {"lot_no": "L71;50"}, name="形の違うロット番号"), P(API, {"lot_no": ""}, name="空のロット番号"), P(API, {"lot_no": 5}, name="数のロット番号"),
        P(API, "[1]", name="並びの本文"),
        G(SURVEY, "lot=L7150C0", name="調べる"), G(SURVEY, "lot=L7150C0&values=1", name="値つきで調べる"), G(SURVEY, "", name="ロット番号なし"),
        G(SURVEY, "lot=NOPE1", name="調べる 該当なし"), G(SURVEY, "lot=L71%3B50", name="調べる 形の違うロット番号"),
        P(LINK, {"files": [{"name": "a.html", "html": tab_h1}, {"name": "b.html", "html": TAB + h2}]}, name="紐づけ 2 ロット"),
        P(LINK, {"files": [{"name": "a.html", "html": tab_h1}, {"html": "<p>x</p>"}, {"name": 5, "html": 7}, {"name": "n", "html": TAB + h1.replace("L7150C0", "NOPE1")}]},
          name="紐づけ 読めない画面"),
        P(LINK, {"files": []}, name="紐づけ 空"), P(LINK, {"files": "x"}, name="紐づけ 並びでない"),
        P(LINK, {"files": [{"name": str(i), "html": "<p/>"} for i in range(41)]}, name="紐づけ 41"),
        P(LINK, {"files": [{"name": "大", "html": "x" * 5_000_001}]}, name="紐づけ 大きすぎる"),
        P(IMPORT, {"html": h3, "lot_no": "L7152C0"}, name="3 つ目を学ぶ"), G(STATUS, name="3 つ目のあと"),
        P(IMPORT, {"html": alias, "lot_no": "L7150C0"}, name="同一工程の名前", li={**li, "api": {"enabled": False}}),
    ]
    out.append(run_steps(work, "学ぶ・API・調べる", li, steps, equipment=rows))

    # 4. 応答の書き方の違い（項目名 b・経過ミリ秒・ずれつき・比重が別の所・同じ比重が 2 か所）
    for name, kw in (("項目名 b", {"key_style": "b"}), ("経過ミリ秒", {"date_style": "epoch"}), ("ずれつき", {"date_style": "utc"}),
                     ("比重が別の所", {"density_elsewhere": True}), ("同じ比重が 2 か所", {"density_twice": True})):
        tag = "v" + str(len(out))
        lots = [(html_with_offs(OFFS, lot_no=f"L715{i}C0", thickness_shift=0.5 * i), f"L715{i}C0") for i in range(3)]
        TABLES[tag] = {no: (200, jb(entity_of(h, **kw)), 0) for h, no in lots}
        lv = {"url": site, "api": {"search_url": f"{base}/{tag}/service/lotdsp/search//searchAction", "timeout_seconds": 2}}
        steps = []
        for h, no in lots:
            steps += [P(IMPORT, {"html": h, "lot_no": no}), G(STATUS)]
        steps += [P(API, {"lot_no": lots[0][1]}), G(SURVEY, "lot=" + lots[1][1])]
        out.append(run_steps(work, name, lv, steps))

    # 5. 応答が替わって決め直す・保存に失敗する
    tag = "c"
    TABLES[tag] = {"L7150C0": (200, jb(entity_of(h1)), 0), "L7151C0": (200, jb(entity_of(h2)), 0)}
    TABLES["c2"] = {"L7151C0": (200, jb(entity_of(h2, key_style="b")), 0)}
    lc = {"url": site, "api": {"search_url": f"{base}/{tag}/service/lotdsp/search//searchAction", "timeout_seconds": 2}}
    lc2 = {"url": site, "api": {"search_url": f"{base}/c2/service/lotdsp/search//searchAction", "timeout_seconds": 2}}
    steps = [P(IMPORT, {"html": h1, "lot_no": "L7150C0"}), P(IMPORT, {"html": h2, "lot_no": "L7151C0"}), G(STATUS),
             P(IMPORT, {"html": h2, "lot_no": "L7151C0"}, li=lc2), G(STATUS, li=lc2), P(API, {"lot_no": "L7151C0"}, li=lc2)]
    out.append(run_steps(work, "応答が替わる", lc, steps))

    def unwritable(local):
        (local / "lotdsp_api_map.json").mkdir()
    out.append(run_steps(work, "保存に失敗", lc, [P(IMPORT, {"html": h1, "lot_no": "L7150C0"}), G(STATUS)], setup=unwritable))
    # 6. # の URL（API の問い合わせ先）
    TABLES["LotDspWeb"] = {"L7150C0": (200, jb(entity_of(h1)), 0)}
    lh = {"url": base + "/LotDspWeb/#/lotdsp"}
    out.append(run_steps(work, "# の URL", lh, [G(SURVEY, "lot=L7150C0")]))
    # 7. 使わない設定・届かない
    out.append(run_steps(work, "API を使わない", {"url": site, "api": {"enabled": False}}, [P(API, {"lot_no": "L1"}), G(STATUS), G(SURVEY, "lot=L1")]))
    out.append(run_steps(work, "届かない", {"url": "http://127.0.0.1:9/x/", "api": {"timeout_seconds": 1}}, [P(API, {"lot_no": "L1"}), G(SURVEY, "lot=L1")]))
    # 8. 途中経過・中止（読んでいないとき）
    out.append(run_steps(work, "途中経過", off, [G("/api/lots/fetch-lotdsp/status"), P("/api/lots/fetch-lotdsp/cancel", "")]))
    return out


# ------------------------------------------------------------------ 見えない Edge（作り物のブラウザ）
OK_HTML = "<html><body>" + FIXTURE[:2000] + "</body></html>"
BIG_HTML = "<html><body>" + ("あ" * 40000) + FIXTURE + "</body></html>"


def ok_result(html=OK_HTML):
    return {"ok": True, "html": html}


DIRECT = [
    ("読める", {"runs": [[["search", None], ["read", None], ["read", ok_result()]]]}, {}),
    ("該当なし", {"runs": [[["search", None], ["search", {"ok": False, "kind": "not_found", "error": "ロット問い合わせに L7150C0 が見つかりません"}]]]}, {}),
    ("ログインが要る", {"runs": [[["search", {"ok": False, "kind": "login", "error": "ログインが要ります（VPN）"}]]]}, {}),
    ("画面が入れ替わる", {"runs": [[["search", None], None]]}, {}),
    ("移る途中は評価できない", {"unevaluable": 3, "runs": [[["read", ok_result()]]]}, {}),
    ("ページの誤り", {"runs": [[["search", {"ok": False, "kind": "screen", "error": "表が出ません"}]]]}, {}),
    ("知らない理由", {"runs": [[["search", {"ok": False, "kind": "weird", "error": "何か"}]]]}, {}),
    ("理由なしの誤り", {"runs": [[["search", {"ok": False}]]]}, {}),
    ("大きな枠・分けた枠・ping", {"fragment": True, "ping_every": 2, "runs": [[["search", None], ["read", ok_result(BIG_HTML)]]]}, {}),
    ("すぐ終わる 2 つ目の起動", {"exit_at_start": True, "runs": [[]]}, {}),
    ("起動が遅い", {"start_delay": 3, "runs": [[["read", ok_result()]]]}, {"start_timeout_seconds": 1}),
    ("閉じてを無視する", {"ignore_close": True, "runs": [[["read", ok_result()]]]}, {}),
    ("時間切れ", {"runs": [[["search", None]]]}, {"timeout_seconds": 2}),
    ("LotDsp の窓でログインを待つ", {"targets": ["footer", "page"], "login": [True, True, False],
                                 "runs": [[["search", {"ok": False, "kind": "login", "error": "ログインが要ります"}]], [["search", None], ["read", ok_result()]]]},
     {"window": True}),
    ("LotDsp の窓 ログインを待ちきれない", {"login": [True], "runs": [[["search", {"ok": False, "kind": "login", "error": "要る"}]]]},
     {"window": True, "login_wait_seconds": 2}),
]


def direct_cfg(site, browser, script, profile, over):
    d = {"browser": browser, "extra_args": [f"--fake-script={script}"], "timeout_seconds": over.get("timeout_seconds", 12),
         "start_timeout_seconds": over.get("start_timeout_seconds", 10), "keep_seconds": 0, "window_keep_seconds": 0,
         "login_wait_seconds": over.get("login_wait_seconds", 30), "window_profile": str(profile)}
    return {"url": site, "direct": d}


def wrapper(work):
    d = work / "browser"
    d.mkdir(parents=True, exist_ok=True)
    exe = d / "chromium"
    exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{PROGRAM / "tests" / "lotdsp_cdp_fake.py"}" "$@"\n')
    exe.chmod(0o755)
    return exe


def direct_scenarios(work, base):
    site = base + "/LotDspWeb/"
    exe = wrapper(work)
    out = []
    for name, script, over in DIRECT:
        d = work / ("direct-" + str(len(out)))
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        sc = {**script, "href": site + "#/lotdsp", "log": str(d / "py.log")}
        (d / "py.json").write_text(json.dumps(sc, ensure_ascii=False), encoding="utf-8")
        li = direct_cfg(site, str(exe), d / "py.json", d / "py-window", over)
        cfg = D.settings_of(li)
        before = set(Path(tempfile.gettempdir()).glob("tpa-lotdsp-*"))
        t = time.time()
        try:
            html = D.fetch_progress_html("L7150C0", cfg, window=bool(over.get("window")))
            res = {"ok": True, "html_len": len(html), "html_head": html[:200]}
        except D.DirectError as e:
            res = {"ok": False, "kind": e.kind, "error": str(e)}
        D.shutdown()
        left = set(Path(tempfile.gettempdir()).glob("tpa-lotdsp-*")) - before
        log = [json.loads(x) for x in (d / "py.log").read_text(encoding="utf-8").splitlines()] if (d / "py.log").exists() else []
        out.append({"name": name, "script": script, "over": over, "result": res, "log": log, "left": len(left), "seconds": round(time.time() - t, 1)})
    # 実行できないブラウザ（作った後の採点の割れ 3: 窓と Python で同じ字）
    noexec = work / "noexec" / "chromium"
    noexec.parent.mkdir(parents=True, exist_ok=True)
    noexec.write_text("not a program\n")
    noexec.chmod(0o644)
    # 届かない・ブラウザが無い・使わない
    for name, li, window in (("実行できないブラウザ", {"url": site, "direct": {"browser": str(noexec), "keep_seconds": 0}}, False),
                             ("届かない", {"url": "http://127.0.0.1:9/LotDspWeb/", "direct": {"reach_timeout_seconds": 1}}, False),
                             ("ブラウザが無い", {"url": site, "direct": {"browser": str(work / "none" / "chromium")}}, False),
                             ("使わない", {"url": site, "direct": {"enabled": False}}, False)):
        try:
            D.fetch_progress_html("L7150C0", D.settings_of(li), window=window)
            res = {"ok": True}
        except D.DirectError as e:
            res = {"ok": False, "kind": e.kind, "error": str(e)}
        out.append({"name": name, "li": li, "result": res})
    out.append(watch_scenario(work, site, exe))
    return out


class ClockPlus:
    """差し替えた時計（本物の時計＋進めた秒）。sleep は差し替えた時計で測る（進めると早く起きる）"""

    def __init__(self):
        import time as real
        self.real, self.off, self.cv = real, 0.0, threading.Condition()

    def time(self):
        return self.real.time() + self.off

    def perf_counter(self):
        return self.real.perf_counter() + self.off

    def sleep(self, s):
        end = self.time() + s
        with self.cv:
            while self.time() < end:
                self.cv.wait(min(0.05, max(0.001, end - self.time())))

    def advance(self, s):
        with self.cv:
            self.off += s
            self.cv.notify_all()


# 見張りで閉じる場面: 読む → 290 秒進める（閉じない）→ さらに 40 秒（330 秒: keep_seconds 300 を過ぎて閉じる）
WATCH_STEPS = [290, 40]


def watch_scenario(work, site, exe):
    """作った後の採点の足りない突き合わせ: 差し替えた時計で、Python と窓が同じ時期に Browser.close を出すか"""
    from unittest import mock
    d = work / "direct-watch"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    script = {"runs": [[["read", ok_result()]]]}
    (d / "py.json").write_text(json.dumps({**script, "href": site + "#/lotdsp", "log": str(d / "py.log")}, ensure_ascii=False), encoding="utf-8")
    li = direct_cfg(site, str(exe), d / "py.json", d / "py-window", {})
    li["direct"].update(keep_seconds=300, window_keep_seconds=1800)
    clock = ClockPlus()
    closed = []
    log = d / "py.log"
    with mock.patch.object(D, "time", clock):
        D.fetch_progress_html("L7150C0", D.settings_of(li))
        closed.append("Browser.close" in log.read_text(encoding="utf-8"))
        for s in WATCH_STEPS:
            clock.advance(s)
            time.sleep(2.5)
            closed.append("Browser.close" in log.read_text(encoding="utf-8"))
        D.shutdown()
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    return {"name": "見張りで閉じる（差し替えた時計）", "watch": True, "script": script, "steps": WATCH_STEPS, "closed": closed, "log": lines}


def main():
    work = Path(sys.argv[2])
    work.mkdir(parents=True, exist_ok=True)
    # 見えない Edge の一時プロファイルはこの係のフォルダに作る（同時に流れるほかの試験の一時プロファイルと混ざらない）
    (work / "tmp").mkdir(exist_ok=True)
    tempfile.tempdir = str(work / "tmp")
    srv, base = start_server()
    data = {"base": base, "browser": str(wrapper(work)), "fake": str(PROGRAM / "tests" / "lotdsp_cdp_fake.py"),
            "api": scenarios(work, base), "direct": direct_scenarios(work, base)}
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    with contextlib.suppress(Exception):
        sys.stdin.read()
    srv.shutdown()


if __name__ == "__main__":
    main()
