# -*- coding: utf-8 -*-
"""集計表・グラフの組み方のプリセットの道の「正しい答え」を出す係（版 3.81.0。desktop/tests/presets_parity.rs が呼ぶ）。

    python tests/presets_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/presets.py の 5 本）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/pivot_presets.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
形は ui_defaults_oracle.py と同じ（"delegates" は窓が答えず Python に任せる本文・置き場の行・道。別の写し pd に当てる）。
"""
import json
import logging
import os
import shutil
import sys
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity, presence  # noqa: E402
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

BOSS, PART, VIEW, NOBODY = ("boss", "PC-1"), ("p1", "PC-2"), ("v1", "PC-3"), ("", "PC-4")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 2, "ログインID": "p1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "有効": "有"},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有"}]


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def S(who, method, item=None, body=None, query="source=lot", ctype="application/json", path=None):
    path = path or ("/api/pivot-presets" + (f"/{item}" if item is not None else ""))
    if method != "GET" and query == "source=lot":
        query = ""
    return {"who": list(who), "method": method, "path": path, "query": query, "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


def Q(who, body, ctype="application/json"):
    return S(who, "PUT", body=body, path="/api/pivot-quick", ctype=ctype)


def R(i, name, src, scope, login="", std="", body="", note="", rev=1, **kw):
    return {"id": i, "名前": name, "元": src, "範囲": scope, "ログインID": login, "標準": std, "中身": body, "備考": note, "rev": rev, **kw}


def QR(i, login, src, keys, rev=1):
    return {"id": i, "ログインID": login, "元": src, "並び": keys if isinstance(keys, str) else j(keys), "rev": rev}


GOOD = j({"rows": [{"column": "工程", "part": ""}], "cols": [], "measures": [{"agg": "count"}], "chart": "bar", "sub": True, "grand": True,
          "chartAt": 0, "split": False, "labels": False})
ROWS = [R(1, "標準の組", "lot", "共通デフォルト", std="1", body=GOOD),
        R(2, "全員の", "lot", "共通", std="1", body=GOOD, rev=2, updated_at="2026-10-01T09:00:00", updated_by={"pc": "PC-9", "login": "x"}),
        R(3, "私の", "lot", "ID", login="p1", body=GOOD),
        R(4, "boss の", "lot", "ID", login="boss", std="1", body="abc"),
        R(5, "実績の", "work", "共通", body=GOOD),
        R(6, "空", "lot", "共通", body=""),
        R(7, "既定の 2", "lot", "共通デフォルト", body=GOOD),
        R(8, "足した元の", "src:abc", "共通", body=GOOD),
        R(9, "標準の後", "lot", "共通デフォルト", body=GOOD)]   # 共通デフォルトの名前の順（7・9・1）が id の順と違う（すぐに見るの既定は id の順）
QUICK_ROWS = [QR(1, "p1", "lot", ["3", "b:hist", "99", "b:nai"]), QR(2, "boss", "lot", "壊れた"), QR(3, "v1", "work", {"a": 1})]


def B(*rows, **kw):
    return {"rows": list(rows), **kw}


def D(col, **kw):
    return {"column": col, **kw}


def P(name, body, scope="me", source="lot", **kw):
    return {"name": name, "source": source, "scope": scope, "body": body, **kw}


ATS = ["3", " 4 ", "+5", "-2", "1_0", "2.5", "", "abc", "0x10", "\x1c6\x1f", "　7", "٣", "９"]
SCENARIOS = [
    {"name": "書く人と範囲・中身・名前・版", "mode": "shared", "rows": ROWS, "quick": QUICK_ROWS, "steps": [
        S(BOSS, "GET"), S(PART, "GET"), S(VIEW, "GET"), S(NOBODY, "GET"), S(PART, "GET", query="source=work"), S(VIEW, "GET", query="source=work"),
        S(PART, "GET", query="source=src%3Aabc"), S(PART, "GET", query="source=bad"), S(PART, "GET", query=""), S(PART, "GET", query="source=src%3AABC"),
        S(PART, "POST", body=P("  新しい  ", B(D("工程"), D("材質", part="ym", width=2, origin=1.5), D("c3"), D("c4"), cols=[D("直"), {"column": ""}, 5],
                                               measures=[{"agg": "sum", "column": "重量", "expr": " x/1000 ", "dec": 2.5}, {"agg": "lots", "column": "x", "dec": 7},
                                                         {"agg": "avg", "expr": "x+", "dec": -1}, {"agg": "bad"}, {"agg": "min", "column": 12, "dec": True},
                                                         {"agg": "max"}], chart="pareto", sub=0, grand=None, split="x", labels=[1], chartAt="2"),
                                    standard=True, note="  メモ  ")),
        S(PART, "POST", body=P("新しい", B(D("a")))), S(PART, "POST", body=P("ｎｅｗ", B(D("a")))), S(PART, "POST", body=P("NEW", B(D("a")))),
        S(PART, "POST", body=P("共通", B(D("a")), scope="all")), S(VIEW, "POST", body=P("見る人", B(D("a")), scope="all")),
        S(PART, "POST", body=P("既定", B(D("a")), scope="default")), S(BOSS, "POST", body=P("既定 2", B(D("a")), scope="default", standard="yes")),
        S(NOBODY, "POST", body=P("だれ", B(D("a")))), S(PART, "POST", body=P("x", B(D("a")), source="bad")), S(PART, "POST", body=P("", B(D("a")), source="bad")),
        S(PART, "POST", body=P("足した元", B(D("a")), source="src:abc")), S(PART, "POST", body=P("x", B(D("a")), scope="x")),
        S(PART, "POST", body=P("あ" * 41, B(D("a")))),
        *[S(PART, "POST", body=P(f"chartAt {k}", B(D("a"), chartAt=v))) for k, v in enumerate(ATS)],
        S(PART, "POST", body=P("chartAt 数", B(D("a"), chartAt=3))), S(PART, "POST", body=P("chartAt 小数", B(D("a"), chartAt=3.0))),
        S(PART, "POST", body=P("chartAt 真", B(D("a"), chartAt=True))), S(PART, "POST", body=P("chartAt 並び", B(D("a"), chartAt=[3]))),
        S(PART, "POST", body=P("段なし", B())), S(PART, "POST", body=P("段が空", B(D(""), {"column": 5}))),
        S(PART, "POST", body=P("形の数", B(D("a"), chart="waterfall"))), S(PART, "POST", body=P("形の並び", B(D("a"), chart=["bar"]))),
        S(PART, "POST", body=P("長い列", B(D("c" * 300, part="p" * 20), measures=[{"agg": "sum", "column": "m" * 300, "expr": "x*2" + " " * 80}]))),
        S(PART, "POST", body=P("式", B(D("a"), measures=[{"agg": "sum", "column": "w", "expr": e} for e in ["÷１０００", "x^2", "(x", "値×2"]]))),
        S(PART, "POST", body=P("大きすぎ", B(D("c" * 200, part="p"), measures=[{"agg": "sum", "column": "あ" * 200}] * 4, extra="x" * 70000))),
        S(PART, "POST", body=P("中身なし", None)), S(PART, "POST", body=P("中身が並び", [1])), S(PART, "POST", body=P("字で", j(B(D("a"))))),
        S(PART, "POST", body=P("読めない字", "abc")), S(PART, "POST", body="null"), S(PART, "POST", body="[]"),
        S(PART, "POST", body=P("text", B(D("a"))), ctype="text/plain"),
        S(PART, "PUT", 3, {"name": "私の 2", "standard": 1, "base_rev": 1, "body": B(D("z"))}),
        S(PART, "PUT", 3, {"name": "私の 3", "base_rev": 99}), S(PART, "PUT", 3, {"name": "新しい"}),
        S(PART, "PUT", 2, {"standard": True, "note": "共通を直す"}), S(VIEW, "PUT", 2, {"name": "見る人"}),
        S(PART, "PUT", 5, {"name": "実績を直す"}), S(PART, "PUT", 99, {"name": "無い"}), S(PART, "PUT", 4, {"name": "ほかの ID"}),
        S(BOSS, "PUT", 4, {"body": B()}), S(BOSS, "PUT", 4, {"note": 12, "source": "work", "scope": "all"}), S(BOSS, "PUT", 4, {}), S(BOSS, "PUT", 4, "null"),
        S(PART, "DELETE", 3, query="rev=1"), S(PART, "DELETE", 3, query="rev=3"), S(PART, "DELETE", 3),
        S(PART, "DELETE", 1), S(VIEW, "DELETE", 2), S(PART, "DELETE", 2, query="rev=99"), S(PART, "DELETE", 77),
        S(BOSS, "GET"), S(PART, "GET"),
    ], "delegates": [
        S(PART, "POST", body="[1]"), S(PART, "POST", body=""), S(PART, "POST", body="{"),
        W(S(PART, "POST", body=P(1.5, B(D("a"))))), S(PART, "POST", body=P(["x"], B(D("a")))),
        S(PART, "POST", body=P("a", B(D("a", part=["x"])))), S(PART, "POST", body=P("a", B(D("a"), measures=[{"agg": "sum", "column": {"a": 1}}]))),
        S(PART, "POST", body=P("a", B(D("a"), measures=[{"agg": "sum", "expr": [1]}]))), S(PART, "POST", body=P("a", B(D("a"), chartAt="1" * 19))),
        S(PART, "POST", body='{"name": "a", "scope": "me", "source": "lot", "body": {"rows": [{"column": "a"}]}, "x": NaN}'),
        S(PART, "POST", body=P("a", '{"rows": [{"column": "a", "width": NaN}]}')), W(S(PART, "POST", body=P("a", '{"rows": [{"column": "a", "width": -0}]}'))),
        S(PART, "PUT", 3, "[1]"), S(PART, "PUT", 3, ""), S(PART, "DELETE", 3, '"x"'),
        W(S(PART, "PUT", "４", {"name": "全角の id"})), W(S(PART, "DELETE", "١")),
    ]},
    {"name": "すぐに見る（ID ごとの並び・既定・戻す）", "mode": "shared", "rows": ROWS, "quick": QUICK_ROWS, "steps": [
        S(PART, "GET"), S(BOSS, "GET"),
        Q(PART, {"source": "lot", "keys": ["7", " 3 ", "b:hist", "b:", "-1", 2, 2.0, True, None, [1], "3", "x" * 50, "b:" + "y" * 50]}), S(PART, "GET"),
        Q(PART, {"source": "lot", "keys": [str(k) for k in range(25)]}), Q(PART, {"source": "lot", "keys": "1,2"}), Q(PART, {"source": "lot"}),
        Q(PART, {"source": "lot", "reset": True}), S(PART, "GET"), Q(PART, {"source": "lot", "reset": True}),
        Q(BOSS, {"source": "work", "keys": ["b:pareto"]}), S(BOSS, "GET", query="source=work"),
        Q(PART, {"source": "bad", "keys": []}), Q(PART, {"keys": []}), Q(NOBODY, {"source": "lot", "keys": ["1"]}), Q(VIEW, {"source": "lot", "keys": []}),
        Q(PART, "null"), Q(PART, "[]"), Q(PART, {"source": "src:abc", "keys": ["8"]}), S(PART, "GET", query="source=src%3Aabc"),
        Q(PART, {"source": "lot", "keys": ["1"]}, ctype="text/plain"),
    ], "delegates": [Q(PART, ""), Q(PART, "[1]"), W(Q(PART, {"source": "lot", "keys": ["²"]})), W(Q(PART, {"source": "lot", "keys": ["　５"]}))]},
    {"name": "すぐに見るの行が 2 つある（1 つにまとめる）", "mode": "shared", "rows": ROWS,
     "quick": [QR(1, "p1", "lot", ["3"]), QR(2, "p1", "lot", ["2"]), QR(3, "p1", "work", ["5"])],
     "steps": [S(PART, "GET"), Q(PART, {"source": "lot", "keys": ["7"]}), S(PART, "GET")], "delegates": []},
    {"name": "すぐに見るの行の版が字・小数・真（Python の int(rev) + 1）", "mode": "shared", "rows": ROWS,
     "quick": [QR(1, "p1", "lot", ["3"], rev="3"), QR(2, "boss", "lot", ["1"], rev=2.0), QR(3, "v1", "lot", ["1"], rev=True), QR(4, "p1", "work", ["1"], rev=" 4 ")],
     "steps": [Q(PART, {"source": "lot", "keys": ["7"]}), Q(PART, {"source": "lot", "keys": ["7", "3"]}), Q(BOSS, {"source": "lot", "keys": ["2"]}),
               Q(VIEW, {"source": "lot", "keys": []}), Q(PART, {"source": "work", "keys": ["5"]})], "delegates": []},
    # 版 3.107.0: 窓も表でない行のあるすぐに見るは書かない（503）・一覧は quickSkipped で知らせる
    {"name": "すぐに見るの置き場に表でない行（書かない・一覧は知らせる）", "mode": "shared", "rows": ROWS, "quick": ["x", QR(2, "p1", "lot", ["3"])],
     "steps": [], "delegates": [W(Q(PART, {"source": "lot", "keys": ["7"]})), W(Q(PART, {"source": "lot", "reset": True})), W(S(PART, "GET"))]},
    {"name": "すぐに見るの置き場に読めない行（版・並びの NaN・ログイン ID が数。隔てて書き戻す）", "mode": "shared", "rows": ROWS,
     "quick": [QR(1, "p1", "lot", ["3"], rev="x"), {"id": 2, "ログインID": "p1", "元": "lot", "並び": '["1", NaN]'}, QR(3, 7, "lot", ["1"]),
               QR(4, "p1", "work", ["1"])],
     "steps": [S(PART, "GET"), Q(PART, {"source": "lot", "keys": ["7"]}), S(PART, "GET"), Q(PART, {"source": "work", "reset": True}),
               Q(PART, {"source": "lot", "reset": True}), S(PART, "GET")], "delegates": []},
    # 版 3.106.0: 窓も Python の rows.remove（== で先の行を消し、書き換えた行が残らない）を写す（pivot_presets::quick_put）
    {"name": "自分のすぐに見るの行が中身まで同じ 2 つ（Python の remove は == で先の行を消す）", "mode": "shared", "rows": ROWS,
     "quick": [QR(1, "p1", "lot", ["3"]), QR(1, "p1", "lot", ["3"])], "steps": [],
     "delegates": [W(Q(PART, {"source": "lot", "keys": ["7"]})), W(Q(PART, {"source": "lot", "reset": True})), W(S(PART, "GET"))]},
    {"name": "自分のすぐに見るの行が中身まで同じ 3 つ・ほかの人の行を挟む（版 3.106.0）", "mode": "shared", "rows": ROWS,
     "quick": [QR(1, "p1", "lot", ["3"]), QR(2, "p2", "lot", ["3"]), QR(1, "p1", "lot", ["3"]), QR(1, "p1", "lot", ["3"])],
     "steps": [Q(PART, {"source": "lot", "keys": ["7", "3"]}), S(PART, "GET"), Q(PART, {"source": "lot", "reset": True}), S(PART, "GET")]},
    # 版 3.107.0: null・小数の id の行は隔てる（窓も Python も）。真の id は int として並べる
    *[{"name": f"共通デフォルトの組み方の id が {what}（既定のすぐに見るの並べ方）", "mode": "shared",
       "rows": [R(a, "既定の一", "lot", "共通デフォルト", body=GOOD), R(b, "既定の二", "lot", "共通デフォルト", body=GOOD)], "quick": [],
       "steps": [S(PART, "GET", query="source=work")], "delegates": [W(S(PART, "GET"))]}
      for what, a, b in [("null と 2", None, 2), ("真と 0", True, 0), ("小数と 1", 2.0, 1)]],
    # 版 3.106.0: 窓も Python の isdigit の表（pyfmt::is_digit）で読む
    {"name": "すぐに見るの行に ASCII でない id", "mode": "shared", "rows": ROWS, "quick": [QR(1, "p1", "lot", ["²", "3", "５", "①", "½"])],
     "steps": [S(BOSS, "GET")], "delegates": [W(S(PART, "GET"))]},
    {"name": "★標準の付け替え（同じ組だけ）", "mode": "shared", "quick": [],
     "rows": [R(1, "A", "lot", "ID", login="p1", std="1", body=GOOD), R(2, "B", "lot", "ID", login="p1", std="1", rev=4, body=GOOD),
              R(3, "C", "work", "ID", login="p1", std="1", body=GOOD), R(4, "D", "lot", "共通", std="1", body=GOOD)],
     "steps": [S(PART, "GET"), S(PART, "PUT", 1, {"name": "A2"}), S(PART, "GET"),
               S(PART, "POST", body=P("G", B(D("a")), standard=True)), S(PART, "GET")], "delegates": []},
    {"name": "切断中", "mode": "shared", "rows": ROWS, "quick": QUICK_ROWS, "revoked": True, "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body=P("切断中", B(D("a")))), S(BOSS, "PUT", 4, {"name": "x"}), S(BOSS, "DELETE", 4),
        Q(BOSS, {"source": "lot", "keys": ["1"]}), Q(BOSS, {"source": "bad"}),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": [], "quick": [], "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body=P("手元", B(D("a")))), Q(BOSS, {"source": "lot", "keys": ["b:hist"]}), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": ROWS, "quick": QUICK_ROWS, "steps": [
        S(PART, "POST", body=P("写し", B(D("a")))), Q(PART, {"source": "lot", "keys": ["1"]}),
    ], "delegates": []},
    {"name": "写しだけで最初に読む（版 3.105.0 から窓も Python も読むだけで共有に最初の版を作る）", "mode": "mirror", "rows": ROWS, "quick": QUICK_ROWS, "steps": [],
     "delegates": [W(S(PART, "GET"))]},
    {"name": "すぐに見るのファイルがまだ無い（版 3.105.0 から窓も Python も読むだけで最初の版を作る）", "mode": "shared", "rows": ROWS, "steps": [],
     "delegates": [W(S(PART, "GET"))]},
    {"name": "すぐに見るのファイルがまだ無い所へ置く（最初の版を作る）", "mode": "shared", "rows": ROWS,
     "steps": [Q(PART, {"source": "lot", "keys": ["1"]}), S(PART, "GET")], "delegates": []},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": ROWS, "quick": QUICK_ROWS, "lock": True,
     "steps": [S(PART, "POST", body=P("錠", B(D("a")))), S(PART, "PUT", 3, {"name": "x"}), S(PART, "DELETE", 3), Q(PART, {"source": "lot", "keys": []}),
               S(PART, "GET")], "delegates": []},
    # 版 3.107.0: 読めない行は隔てて答える（長い chartAt の字は大きな整数なのでまだ任せる。H2）
    *[{"name": f"置き場の組み方の行の中身が {what}（{'窓は答えず Python に任せる' if what == '長い chartAt' else '行を隔てて答える'}）", "mode": "shared",
       "rows": [R(1, "良い行", "lot", "共通", body=GOOD), bad],
       "quick": [], "steps": [], "delegates": [(W if what != "長い chartAt" else (lambda x: x))(x) for x in [
           S(PART, "GET"), S(PART, "POST", body=P("a", B(D("a")))), S(PART, "PUT", 2, {"name": "直す"}), S(PART, "DELETE", 2), S(PART, "GET")]]}
      for what, bad in [("並びの part", R(2, "x", "lot", "共通", body=j(B(D("a", part=["x"]))))),
                        ("長い chartAt", R(2, "x", "lot", "共通", body=j(B(D("a"), chartAt="9" * 30)))),
                        ("NaN", R(2, "x", "lot", "共通", body='{"rows": [{"column": "a", "width": NaN}]}')),
                        ("名前が数", R(2, 5, "lot", "共通", body=GOOD))]],
    {"name": "共有のファイルの版 revision が読めない（写しで続け、書く道は断る）", "mode": "shared", "rows": ROWS, "quick": [], "rev": "abc", "steps": [],
     "delegates": [W(S(PART, "GET")), W(S(PART, "POST", body=P("a", B(D("a"))))), W(S(PART, "PUT", 3, {"name": "x"})), W(S(PART, "DELETE", 3))]},
]
FILE_NAME = "pivot_presets"
QUICK = "pivot_quick"


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    files = [("access_permissions", PERM), (FILE_NAME, sc["rows"])] + ([(QUICK, sc["quick"])] if "quick" in sc else [])
    for name, rows in files:
        if sc["mode"] == "local":
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] == "mirror":
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows, sc.get("rev", 3) if name == FILE_NAME else 3)), encoding="utf-8")
    if sc.get("raw") is not None:             # 生の字を置く（json.dumps では書けない NaN・-0・大きな整数・対の無い代用字）
        f = share / f"{FILE_NAME}.json"
        t = f.read_text(encoding="utf-8").replace('"@RAW@"', sc["raw"]).replace("@SUR@", "\\ud800")
        f.write_text(t, encoding="utf-8")
    if sc.get("mirror_rows") is not None:     # 写しは共有と違う中身（共有を読めないとき窓が写しへ流れないか）
        (cache / f"{FILE_NAME}.json").write_text(j(doc(sc["mirror_rows"])), encoding="utf-8")
    if sc.get("lock"):          # ほかの PC が保存している途中（切れていない錠。窓も Python も 409 locked で答え、書かない）
        from datetime import datetime, timedelta
        n = datetime.now()
        (share / "master.lock.json").write_text(j({"token": "t", "holder_pc": "PC-8", "holder_login": "u8", "holder_instance": "z:1",
                                                   "acquired_at": n.isoformat(timespec="seconds"),
                                                   "expires_at": (n + timedelta(seconds=600)).isoformat(timespec="seconds")}), encoding="utf-8")


def store_of(root, sc):
    settings = {"refresh_seconds": 0, **({} if sc["mode"] == "local" else {"dir": str(root / "share")})}
    return MasterStore(root / "app", local_root=root / "local", settings=settings)


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    from app.routes.lotlist import _access_place
    from app.web import Request, _app_var, _request_var
    who = {"login": "", "pc": ""}
    patches = [mock.patch.object(identity, "current_login_id", lambda: who["login"]),
               mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": who["pc"], "source": "試験", "tried": []})]
    for p in patches:
        p.start()
    out = []
    try:
        for i, sc in enumerate(SCENARIOS):
            py, rs = base / f"s{i}" / "py", base / f"s{i}" / "rs"
            place(py, sc)
            place(rs, sc)
            app = create_app({"TESTING": True, "MASTER_STORE": store_of(py, sc)})
            client = app.test_client()
            rs_app = create_app({"TESTING": True, "MASTER_STORE": store_of(rs, sc)})
            t1, t2 = _app_var.set(rs_app), _request_var.set(Request("GET", "/api/lotlist/settings"))
            try:
                conf = _access_place()
            finally:
                _request_var.reset(t2)
                _app_var.reset(t1)
            pd = base / f"s{i}" / "pd"      # Python に任せる本文は別の写しに当てる（突き合わせるファイルに混ぜない）
            place(pd, sc)
            clients = {False: client, True: create_app({"TESTING": True, "MASTER_STORE": store_of(pd, sc)}).test_client()}
            # 利用状況の置き場（切断の指示）は、アプリを作り終えてから決める（create_app が置き場を決め直す）
            pdir = base / f"s{i}" / "presence"
            pdir.mkdir(parents=True, exist_ok=True)
            presence.configure(pdir)
            if sc.get("revoked"):
                from datetime import datetime
                key = presence.terminal_key(BOSS[0], BOSS[1])
                (pdir / f"{key}{presence.REVOKE_SUFFIX}").write_text(j({"by": "boss2", "byPc": "PC-8", "reason": "試験", "at": datetime.now().isoformat()}),
                                                                    encoding="utf-8")
            conf["place"]["presence"] = str(pdir)
            steps, dele = [], []
            for st in oracle_gate.seq(sc["steps"], sc.get("delegates", [])):
                who.update(login=st["who"][0], pc=st["who"][1])
                routes._REVOKE_CACHE.update(at=0.0, key="")
                forget_tab_cache()
                path = st["path"] + (f"?{st['query']}" if st["query"] else "")
                try:
                    r = clients[bool(st.get("delegate"))].open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"), content_type=st["ctype"])
                except Exception as e:      # 道の外で落ちた（試験の接続は投げ返す。本番は 500 で答え、書かない）
                    (dele if st.get("delegate") else steps).append(
                        {**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}", "kind": "error", "type": type(e).__name__}})
                    continue
                try:
                    body = r.get_json()
                except Exception:
                    body = None
                try:      # Python の答えに NaN があると JSON にならない（任せる歩だけ。窓が答えないことしか比べない）
                    json.dumps(body, allow_nan=False)
                except ValueError:
                    body = {"_python_wrote_nan": True}
                (dele if st.get("delegate") else steps).append({**st, "status": r.status_code, "json": body})
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "storeWho": app.config["MASTER_STORE"].who,
                        "steps": steps, "delegates": dele})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
