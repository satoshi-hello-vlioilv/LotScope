# -*- coding: utf-8 -*-
"""権限のマスタを書く道の「正しい答え」を出す係（版 3.68.0。順 5 の 2 段目 b。desktop/tests/access_write_parity.rs が呼ぶ）。

    python tests/access_write_oracle.py 作業フォルダ

場面ごとに 同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/access.py。門番 _access_guard を含む）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/access_write.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
    {"scenarios": [{"name", "py": 置き場, "rs": 置き場, "conf": 窓へ渡す {who, place}（who は 1 歩ごとに差し替える）,
                    "steps": [{"who": [login, pc], "method", "path", "query", "body": 字, "status", "json"}]}]}
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
os.environ.pop("TPA_SHELL", None)            # Python が自分で決める道（窓の me を使わない）の答え

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity  # noqa: E402

BOSS, M1, U = ("boss", "PC-1"), ("m2", "PC-2"), ("u1", "PC-9")


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


ADMIN_ROWS = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
              {"id": 3, "ログインID": "m2", "PC名": "", "権限区分": "メンテナンス者", "マスタ編集": "編集可", "有効": "有"},
              {"id": 4, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "有効": "有", "rev": 2}]
TAB_ROWS = [{"id": 1, "タブ": "work", "出さない区分": "設備作業者", "rev": 1}, {"id": 2, "タブ": "dash", "出さない区分": "一般ユーザー"}]


def S(who, method, path, body=None, query=""):
    return {"who": list(who), "method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


SCENARIOS = [
    {"name": "管理する人がまだ居ない → 最初の 1 人", "mode": "shared", "perm": [], "tabs": [], "steps": [
        S(U, "POST", "/api/masters/access", {"ログインID": "u1", "権限区分": "開発者"}),
        S(U, "POST", "/api/masters/access", {"ログインID": "boss", "権限区分": "開発者", "マスタ編集": "編集可"}),
        S(U, "POST", "/api/masters/access", {"ログインID": "x", "権限区分": "一般ユーザー"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "m1", "権限区分": "メンテナンス者"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": " M1 ", "PC名": ""}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "op", "権限区分": "設備作業者", "マスタ編集": "編集可"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "op", "権限区分": "設備作業者", "マスタ編集": "非表示"}),
    ]},
    {"name": "直す・消す・行の版・自分の行・上位の行", "mode": "shared", "perm": ADMIN_ROWS, "tabs": TAB_ROWS, "steps": [
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "base_rev": 1e20}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "base_rev": 123456789012345678901234}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "base_rev": "1234567890123456789012"}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "base_rev": "2.0"}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "権限区分": "一般ユーザー", "マスタ編集": "編集可", "base_rev": "２"}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "権限区分": "一般ユーザー", "base_rev": 2}),
        S(BOSS, "PUT", "/api/masters/access/3", {"ログインID": "m2", "権限区分": "一般ユーザー", "base_rev": "1"}),
        S(BOSS, "PUT", "/api/masters/access/99", {"ログインID": "z", "base_rev": 1}),
        S(BOSS, "PUT", "/api/masters/access/99", {"ログインID": "z"}),
        S(BOSS, "PUT", "/api/masters/access/1", {"ログインID": "boss", "権限区分": "一般ユーザー"}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "boss", "PC名": "", "権限区分": "一般ユーザー"}),
        S(BOSS, "DELETE", "/api/masters/access/1"),
        S(BOSS, "DELETE", "/api/masters/access/4", query="rev=1"),
        S(BOSS, "DELETE", "/api/masters/access/4", query="rev=%D9%A4"),
        S(BOSS, "DELETE", "/api/masters/access/4", query="rev=%D9%A4"),
        S(BOSS, "DELETE", "/api/masters/access/4"),
        S(BOSS, "DELETE", "/api/masters/access/4", query="rev=x"),
    ]},
    {"name": "メンテナンス者: 上位を与えない・上位の行を直さない・消さない", "mode": "shared", "perm": ADMIN_ROWS, "tabs": [], "steps": [
        S(M1, "POST", "/api/masters/access", {"ログインID": "x", "権限区分": "開発者"}),
        S(M1, "POST", "/api/masters/access", {"ログインID": "x", "権限区分": "メンテナンス者"}),
        S(M1, "POST", "/api/masters/access", {"ログインID": "x", "権限区分": "一般ユーザー"}),
        S(M1, "PUT", "/api/masters/access/1", {"ログインID": "boss", "権限区分": "一般ユーザー"}),
        S(M1, "PUT", "/api/masters/access/1", {"ログインID": "boss2", "権限区分": "開発者"}),
        S(M1, "DELETE", "/api/masters/access/1"),
        S(M1, "PUT", "/api/masters/access/3", {"ログインID": "m2", "権限区分": "一般ユーザー"}),
        S(M1, "DELETE", "/api/masters/access/4"),
    ]},
    {"name": "門番: 部分的編集可・閲覧のみは管理のマスタを書けない", "mode": "shared", "perm": ADMIN_ROWS, "tabs": [], "steps": [
        S(U, "POST", "/api/masters/access", {"ログインID": "y"}),
        S(U, "PUT", "/api/masters/access/4", {"ログインID": "u1"}),
        S(U, "DELETE", "/api/masters/access/1"),
        S(U, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["一般ユーザー"]}}),
        S(("nobody", "PC-0"), "POST", "/api/masters/access", {"ログインID": "y"}),
    ]},
    {"name": "本文の形: 数・真偽・空白・止めた行・タブの例外の字・読めない本文", "mode": "shared", "perm": ADMIN_ROWS, "tabs": [], "steps": [
        S(BOSS, "POST", "/api/masters/access", {"ログインID": 123, "PC名": True, "備考": "  メモ  ", "有効": "無", "権限区分": " メンテナンス者 ",
                                                "マスタ編集": "閲覧のみ", "タブの例外": {"work": "出さない", "BAD": "出す", "dash": "出す", "x": "maybe", "calc": 1}}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "t2", "タブの例外": "{\"wip\": \"出さない\", \"aa\": \"出す\"}"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "t3", "タブの例外": "{"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "t4", "タブの例外": "[1]"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "t5", "PC名": 0, "備考": None, "有効": False, "権限区分": "だれか", "マスタ編集": "なんでも"}),
        S(BOSS, "POST", "/api/masters/access", "これは JSON ではない"),
        S(BOSS, "POST", "/api/masters/access", "[1, 2]"),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "t6", "PC名": "ｐｃ－１", "権限区分": "一般ユーザー"}),
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "T6", "PC名": "PC-1"}),
    ]},
    {"name": "タブの権限: 足す・直す・同じ・外す・版・断る", "mode": "shared", "perm": ADMIN_ROWS, "tabs": TAB_ROWS, "steps": [
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["一般ユーザー"], "sch": ["設備作業者", "メンテナンス者"], "aa": ["一般ユーザー"],
                                                          "work": ["一般ユーザー", "設備作業者"]}, "base_rev": "3"}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["一般ユーザー"]}, "base_rev": 3}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["一般ユーザー"], "dash": []}}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {" sch ": None, "zz": [], "work": ["設備作業者", "設備作業者"]}, "base_rev": 5}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"BAD": []}}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["開発者", "だれか"]}}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": ["wip"]}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": "一般ユーザー"}}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {}),
        S(BOSS, "PUT", "/api/masters/tabaccess", '{"rules": {"wip": ["一般ユーザー"]}, "rules": {"sch": ["設備作業者"], "aa": []}}'),
        S(BOSS, "PUT", "/api/masters/tabaccess", '{"rules": {"wip": []}, "rules": 5}'),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "perm": ADMIN_ROWS, "tabs": TAB_ROWS, "steps": [
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "n1", "権限区分": "一般ユーザー"}),
        S(BOSS, "PUT", "/api/masters/access/4", {"ログインID": "u1", "権限区分": "設備作業者", "マスタ編集": "非表示", "base_rev": 2}),
        S(BOSS, "DELETE", "/api/masters/access/3", query="rev=1"),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["一般ユーザー"]}, "base_rev": 0}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"wip": ["設備作業者"]}, "base_rev": 7}),
    ]},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "perm": ADMIN_ROWS, "tabs": TAB_ROWS, "steps": [
        S(BOSS, "POST", "/api/masters/access", {"ログインID": "s1"}),
        S(BOSS, "PUT", "/api/masters/tabaccess", {"rules": {"calc": ["一般ユーザー"]}}),
    ]},
]


def place(root, sc):
    """場面の初めの中身を置く（共有・写し・同梱の data/）"""
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    for name, rows in (("access_permissions", sc["perm"]), ("tab_access", sc["tabs"])):
        if sc["mode"] == "local":
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] == "mirror":
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")


def store_of(root, sc):
    settings = {"refresh_seconds": 0, **({} if sc["mode"] == "local" else {"dir": str(root / "share")})}
    return MasterStore(root / "app", local_root=root / "local", settings=settings)


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    import app.routes as routes
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
                conf = _access_place()       # 窓へ渡す置き場（rs の物。名乗りは 1 歩ごとに差し替える）
            finally:
                _request_var.reset(t2)
                _app_var.reset(t1)
            steps = []
            for st in sc["steps"]:
                who.update(login=st["who"][0], pc=st["who"][1])
                routes._REVOKE_CACHE.update(at=0.0, key="")
                from app.routes.common import forget_tab_cache
                forget_tab_cache()
                path = st["path"] + (f"?{st['query']}" if st["query"] else "")
                r = client.open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"),
                                content_type="application/json")
                try:
                    body = r.get_json()
                except Exception:
                    body = None
                steps.append({**st, "status": r.status_code, "json": body})
            # 書く係の名乗り（保存した人の印 updated_by。本番ではどちらの係もこの PC の名乗り）
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "storeWho": app.config["MASTER_STORE"].who,
                        "steps": steps})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
