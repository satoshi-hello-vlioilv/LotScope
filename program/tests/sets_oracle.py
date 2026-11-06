# -*- coding: utf-8 -*-
"""ダッシュボードのセットの道の「正しい答え」を出す係（版 3.79.0。desktop/tests/sets_parity.rs が呼ぶ）。

    python tests/sets_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/dashboard.py のセットの 4 本）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/dash_sets.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
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

BOSS, PART, VIEW, NOBODY = ("boss", "PC-1"), ("p1", "PC-2"), ("v1", "PC-3"), ("", "PC-4")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 2, "ログインID": "p1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "有効": "有"},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有"}]


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def S(who, method, item=None, body=None, query="", ctype="application/json"):
    path = "/api/dashboard-sets" + (f"/{item}" if item is not None else "")
    return {"who": list(who), "method": method, "path": path, "query": query, "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


def R(i, name, src, scope, login="", std="", body='{"items": ["1"]}', note="", rev=1, **kw):
    return {"id": i, "名前": name, "元": src, "範囲": scope, "ログインID": login, "標準": std, "中身": body, "備考": note, "rev": rev, **kw}


ROWS = [R(1, "標準", "dash", "共通デフォルト", std="1", body='{"rows": 8, "panels": []}'),
        R(2, "朝の確認", "dashset", "共通", std="1", body='{"items": ["1", "b:standard"]}', rev=2,
          updated_at="2026-10-01T09:00:00", updated_by={"pc": "PC-9", "login": "x"}),
        R(3, "既定のセット", "dashset", "共通デフォルト", std="1", body='{"items": ["b:standard"]}'),
        R(4, "私の", "dashset", "ID", login="p1", body='{"items": ["1", "2"]}'),
        R(5, "boss の", "dashset", "ID", login="boss", std="1", body="abc"),
        R(6, "カード", "card:lot", "共通", body="{}"),
        R(7, "壊れ", "dashset", "共通", body=""),
        R(8, "並びの中身", "dashset", "共通", body='[1, 2]'),
        {"id": 9, "名前": "版の無い行", "元": "dashset", "範囲": "ID", "ログインID": "p1", "標準": "", "中身": '{"items": ["3"]}', "備考": ""}]
DEEP = '{"items": ["1"], "x": ' + "[" * 200 + "]" * 200 + "}"     # 入れ子 200 段（serde は 128 段で読むのをやめる。Python は読む）
EDGE = '{"items": ["1"], "x": ' + "[" * 126 + "]" * 126 + "}"     # 外の { と合わせて 127 段（窓も読む）
OVER = '{"items": ["1"], "x": ' + "[" * 127 + "]" * 127 + "}"     # 128 段（窓は任せる）
MANY = {"items": [str(i) for i in range(1, 14)]}
ITEMS = {"items": ["1", "1", "b:standard", 5, "x", 1.5, True, "١٢", "b:", "b:" + "a" * 33, "1234567890", -1, None, [1], {"a": 1}]}
SCENARIOS = [
    {"name": "書く人と範囲・中身・名前・版", "mode": "shared", "rows": ROWS, "steps": [
        S(BOSS, "GET"), S(PART, "GET"), S(VIEW, "GET"), S(NOBODY, "GET"),
        S(PART, "POST", body={"name": "  新しい  ", "scope": "me", "body": ITEMS, "standard": True, "note": "  メモ  "}),
        S(PART, "POST", body={"name": "新しい", "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "ｎｅｗ", "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "NEW", "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "新しい", "scope": "all", "body": {"items": ["2"]}, "standard": 1}),
        S(VIEW, "POST", body={"name": "見る人", "scope": "all", "body": {"items": ["2"]}}),
        S(VIEW, "POST", body={"name": "見る人", "scope": "default", "body": {"items": ["2"]}}),
        S(PART, "POST", body={"name": "既定", "scope": "default", "body": {"items": ["2"]}}),
        S(BOSS, "POST", body={"name": "既定の 2", "scope": "default", "body": {"items": ["b:standard"]}, "standard": "yes"}),
        S(NOBODY, "POST", body={"name": "だれ", "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "x", "scope": "x", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "x", "scope": 1, "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "", "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": 0, "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": True, "scope": "me", "body": {"items": ["1"]}, "note": 12}),
        S(PART, "POST", body={"name": "あ" * 41, "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "あ" * 40, "scope": "me", "body": {"items": ["1"]}, "note": "い" * 250}),
        S(PART, "POST", body={"name": "空", "scope": "me", "body": {}}),
        S(PART, "POST", body={"name": "空 2", "scope": "me"}),
        S(PART, "POST", body={"name": "多い", "scope": "me", "body": MANY}),
        S(PART, "POST", body={"name": "字で", "scope": "me", "body": j({"items": ["2", "b:x-1_y"]})}),
        S(PART, "POST", body={"name": "字で並び", "scope": "me", "body": "[1]"}),
        S(PART, "POST", body={"name": "items が表", "scope": "me", "body": {"items": {"1": 1}}}),
        S(PART, "POST", body={"name": "読めない字", "scope": "me", "body": "abc"}),
        S(PART, "POST", body={"name": "127 段", "scope": "me", "body": EDGE}),
        S(PART, "POST", body={"name": "字の中の括弧", "scope": "me", "body": j({"items": ["1"], "x": "[" * 300})}),
        S(PART, "POST", body={"name": "読めない字 2", "scope": "me", "body": '{"items": ["1"'}),
        S(PART, "POST", body="null"), S(PART, "POST", body="0"), S(PART, "POST", body="[]"), S(PART, "POST", body='""'),
        S(PART, "POST", body={"name": "text", "scope": "me", "body": {"items": ["4"]}}, ctype="text/plain"),
        S(PART, "PUT", 4, {"name": "私の 2", "standard": 1, "base_rev": 1}),
        S(PART, "PUT", 4, {"name": "私の 3", "base_rev": 99}),
        S(PART, "PUT", 4, {"name": "新しい"}),
        S(PART, "PUT", 9, {"standard": True}),
        S(PART, "PUT", 2, {"standard": True, "note": "共通を直す"}),
        S(VIEW, "PUT", 2, {"name": "見る人が直す"}),
        S(PART, "PUT", 1, {"name": "ダッシュボード"}),
        S(PART, "PUT", 6, {"name": "カードを直す"}),
        S(PART, "PUT", 99, {"name": "無い"}),
        S(PART, "PUT", 5, {"name": "ほかの ID"}),
        S(BOSS, "PUT", 5, {"body": {"items": []}}),
        S(BOSS, "PUT", 5, {"note": 12, "extra": 1, "scope": "all", "source": "dash"}),
        S(BOSS, "PUT", 5, {}),
        S(BOSS, "PUT", 5, "null"),
        S(BOSS, "PUT", 5, {"name": "boss の", "base_rev": "  3  "}),
        S(BOSS, "PUT", 5, {"name": "boss の", "base_rev": "x"}),
        S(PART, "DELETE", 4, query="rev=1"),
        S(PART, "DELETE", 4, query="rev=3"),
        S(PART, "DELETE", 4),
        S(PART, "DELETE", 4, query="rev=1"),
        S(PART, "DELETE", 1),
        S(PART, "DELETE", 6),
        S(VIEW, "DELETE", 2),
        S(PART, "DELETE", 2, query="rev=99"),
        S(PART, "DELETE", 77),
        S(BOSS, "GET"), S(PART, "GET"),
    ], "delegates": [
        S(PART, "POST", body="[1]"), S(PART, "POST", body=""), S(PART, "POST", body="{"),
        S(PART, "POST", body={"name": 1.5, "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": 1059438285926254.25, "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": ["x"], "scope": "me", "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "a", "scope": ["all"], "body": {"items": ["1"]}}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}, "note": ["x", 1.5]}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}, "note": 0.1}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}, "note": 12345678901234567890}),
        S(PART, "POST", body='{"name": "a", "scope": "me", "body": {"items": ["1"]}, "x": NaN}'),
        S(PART, "POST", body='{"name": "a", "scope": "me", "body": {"items": ["1"]}, "x": -0}'),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": '{"items": ["1"], "x": NaN}'}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": '{"items": ["1"], "x": -0}'}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": '{"items": ["1"], "x": 1e400}'}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": '{"items": ["\\ud800"]}'}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": DEEP}),
        S(PART, "POST", body={"name": "a", "scope": "me", "body": OVER}),
        S(PART, "PUT", 4, "[1]"), S(PART, "PUT", 4, ""), S(PART, "DELETE", 4, '"x"'),
        S(PART, "PUT", "４", {"name": "全角の id"}), S(PART, "DELETE", "١"),
    ]},
    {"name": "★標準の付け替え（同じ組だけ・名前だけ直しても）", "mode": "shared",
     "rows": [R(1, "A", "dashset", "ID", login="p1", std="1"), R(2, "B", "dashset", "ID", login="p1", std="1", rev=4),
              R(3, "C", "dashset", "ID", login="boss", std="1"), R(4, "D", "dashset", "共通", std="1"), R(5, "E", "dash", "ID", login="p1", std="1"),
              R(6, "F", "dashset", "共通", std="")],
     "steps": [S(PART, "GET"), S(PART, "PUT", 1, {"name": "A2"}), S(PART, "GET"),
               S(PART, "PUT", 6, {"standard": True}), S(PART, "POST", body={"name": "G", "scope": "me", "body": {"items": ["1"]}, "standard": True}),
               S(BOSS, "GET"), S(PART, "GET")], "delegates": []},
    {"name": "名前の比べ方が Unicode の版で割れうる字（窓も Python 3.13 と同じに比べる）", "mode": "shared",
     "rows": [R(1, "\u1c8a", "dashset", "ID", login="p1"), R(2, "\U00016121", "dashset", "ID", login="p1"), R(3, "a\u0316\u0897", "dashset", "ID", login="p1")],
     "steps": [S(PART, "GET"),
               S(PART, "POST", body={"name": "\u1c89", "scope": "me", "body": {"items": ["1"]}}),
               S(PART, "POST", body={"name": "\U0001611e\U0001611e", "scope": "me", "body": {"items": ["1"]}}),
               S(PART, "POST", body={"name": "a\u0897\u0316", "scope": "me", "body": {"items": ["1"]}}),
               S(PART, "POST", body={"name": "\u019b", "scope": "me", "body": {"items": ["1"]}}),
               S(PART, "POST", body={"name": "\u01bb", "scope": "me", "body": {"items": ["1"]}}),
               S(PART, "PUT", 1, {"name": "\u1c89"}),
               S(PART, "PUT", 2, {"name": "\U0001611e\U0001611e"}),
               S(PART, "GET")], "delegates": []},
    {"name": "切断中", "mode": "shared", "rows": ROWS, "revoked": True, "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body={"name": "切断中", "scope": "me", "body": {"items": ["1"]}}),
        S(BOSS, "PUT", 5, {"name": "x"}), S(BOSS, "DELETE", 5), S(BOSS, "DELETE", 4), S(BOSS, "PUT", 1, {"name": "x"}),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": [], "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body={"name": "手元", "scope": "me", "body": {"items": ["1"]}}), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": ROWS, "steps": [
        S(PART, "POST", body={"name": "写し", "scope": "me", "body": {"items": ["1"]}}), S(PART, "GET"),
    ], "delegates": []},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": ROWS, "lock": True,
     "steps": [S(PART, "POST", body={"name": "錠", "scope": "me", "body": {"items": ["1"]}}), S(PART, "PUT", 4, {"name": "x"}),
               S(PART, "DELETE", 4), S(PART, "GET")], "delegates": []},
    *[{"name": f"置き場の行の形が違う: {what}（窓は答えず Python に任せる）", "mode": "shared", "rows": [R(1, "良い行", "dashset", "共通"), bad],
       "steps": [], "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}})]}
      for what, bad in [("名前が数", R(2, 5, "dashset", "共通")),
                        ("中身に NaN", R(2, "NaN の中身", "dashset", "共通", body='{"items": ["1"], "x": NaN}')),
                        ("中身に -0", R(2, "-0 の中身", "dashset", "共通", body='{"items": [-0]}')),
                        ("版が読めない", R(2, "x", "dashset", "共通", rev="二")),
                        ("id が字", {"id": "4", "名前": "字の id", "元": "dashset", "範囲": "共通", "中身": "{}"}),
                        ("中身の入れ子が 200 段", R(2, "深い中身", "dashset", "共通", body=DEEP)),
                        ("ほかの元の行の値の入れ子が 130 段", dict(R(2, "深い値", "dash", "共通"), x=json.loads("[" * 130 + "]" * 130)))]],
    *[{"name": f"共有のファイルの字に {what}（窓は答えず Python に任せる）", "mode": "shared",
       "rows": [R(1, "良い行", "dashset", "共通"), dict(R(2, "生の値", "dash", "共通", note=note), x="@RAW@")], "raw": raw,
       "steps": [], "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}}),
                                  S(PART, "PUT", 1, {"name": "b"})]}
      for what, note, raw in [("NaN", "", "NaN"), ("Infinity", "", "Infinity"), ("1e400", "", "1e400"), ("整数の -0", "", "-0"),
                              ("i64 に入らない整数", "", "1" + "0" * 30), ("対の無い代用字", "@SUR@", '"x"')]],
    *[{"name": f"共有のファイルの版 revision が {what}（Python の int() が読めない。窓は答えず Python に任せる）", "mode": "shared",
       "rows": [R(1, "良い行", "dashset", "共通"), R(4, "私の", "dashset", "ID", login="p1")], "rev": rev, "steps": [],
       "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}}),
                     S(PART, "PUT", 4, {"name": "b"}), S(PART, "DELETE", 4)]}
      for what, rev in [("字の abc", "abc"), ("null", None), ("表", {}), ("字の 3.5", "3.5")]],
    {"name": "共有のファイルの版 revision が前後に空白のある字の 3（Python も窓も読む）", "mode": "shared", "rows": [R(1, "良い行", "dashset", "共通")],
     "rev": " 3 ", "steps": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}}), S(PART, "GET")],
     "delegates": []},
    {"name": "共有のフォルダにまだ無い・写しだけで最初に読む（Python は読むだけで共有に最初の版を作る）", "mode": "mirror",
     "rows": [R(1, "写しの行", "dashset", "共通")], "steps": [], "delegates": [S(PART, "GET")]},
    {"name": "共有のファイルの値の入れ子が 130 段・写しは前の中身（窓は答えず Python に任せる）", "mode": "shared",
     "rows": [R(1, "新", "dashset", "共通"), dict(R(2, "深い値", "dash", "共通"), x=json.loads("[" * 130 + "]" * 130))],
     "mirror_rows": [R(1, "前", "dashset", "共通")], "steps": [],
     "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "scope": "me", "body": {"items": ["1"]}})]},
]
FILE_NAME = "dashboards"


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    for name, rows in (("access_permissions", PERM), (FILE_NAME, sc["rows"])):
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
            for st in sc["steps"] + [dict(x, delegate=True) for x in sc["delegates"]]:
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
                (dele if st.get("delegate") else steps).append({**st, "status": r.status_code, "json": body})
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "storeWho": app.config["MASTER_STORE"].who,
                        "steps": steps, "delegates": dele})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
