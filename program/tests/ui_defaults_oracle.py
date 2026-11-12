# -*- coding: utf-8 -*-
"""一覧の表示の初期設定の道の「正しい答え」を出す係（版 3.78.0。desktop/tests/ui_defaults_parity.rs が呼ぶ）。

    python tests/ui_defaults_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/system.py の GET／PUT /api/ui-defaults）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/ui_defaults.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
形は equip_rows_oracle.py と同じ（"delegates" は窓が答えず Python に任せる本文・置き場の行。別の写し pd に当てる）。
足して "profileKeys": 表示の設定の範囲（services/ui_defaults.PROFILE_KEYS。窓は一覧の設定の答えで受け取る）・場面の "revoked": この PC が切断中か
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
from app.services import identity, presence, ui_defaults  # noqa: E402
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

BOSS, PART, VIEW = ("boss", "PC-1"), ("p1", "PC-2"), ("v1", "PC-3")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 2, "ログインID": "p1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "有効": "有"},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有"}]

def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def S(who, method, body=None, ctype="application/json"):
    return {"who": list(who), "method": method, "path": "/api/ui-defaults", "query": "", "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


L, P, M = "tpa.lotlist.layout.v1", "tpa.lotlist.pageSize.v1", "tpa.lotlist.marks.v1"
OLD = [{"名前": P, "値": "100", "updated_at": "2026-10-01T09:00:00", "updated_by": {"pc": "PC-9", "login": "x"}},
       {"名前": "知らない名前", "値": "1"}, {"名前": L, "値": "[1,2]"}]
BIG = "あ" * (700 * 1024)
SCENARIOS = [
    {"name": "開発者: 置く・外す・本文の形", "mode": "shared", "rows": OLD, "steps": [
        S(BOSS, "GET"),
        S(BOSS, "PUT", {"keys": {L: '{"c":1}', P: "50", "知らない名前": "x", M: 3, "tpa.lotlist.rules.v1": None}, "extra": [1]}),
        S(BOSS, "GET"),
        S(BOSS, "PUT", {"keys": {M: "制御字\u0001と\u2028", "tpa.lotlist.views.v1": "\"字\""}}),
        S(BOSS, "PUT", "[1]"), S(BOSS, "PUT", "null"), S(BOSS, "PUT", ""), S(BOSS, "PUT", '"x"'), S(BOSS, "PUT", "0"), S(BOSS, "PUT", "[]"),
        S(BOSS, "PUT", {}), S(BOSS, "PUT", {"keys": None}), S(BOSS, "PUT", {"keys": []}), S(BOSS, "PUT", {"keys": "x"}),
        S(BOSS, "PUT", {"keys": {L: BIG, P: BIG, M: BIG}}),
        # 2 MB の境（json.dumps(ensure_ascii=False) の UTF-8 の長さ。{"<名前>": "<値>"} の 29 バイトを足して丁度・1 バイト上）
        S(BOSS, "PUT", {"keys": {L: "a" * (2 * 1024 * 1024 - 29)}}),
        S(BOSS, "PUT", {"keys": {L: "a" * (2 * 1024 * 1024 - 28)}}),
        S(BOSS, "PUT", {"keys": {L: "\u0001" + "あ" * ((2 * 1024 * 1024 - 29 - 6) // 3) + "a" * ((2 * 1024 * 1024 - 29 - 6) % 3)}}),
        S(BOSS, "PUT", {"keys": {L: "text/plain で置く"}}, ctype="text/plain"),
        S(BOSS, "GET"),
        S(BOSS, "PUT", {"keys": {}}),
        S(BOSS, "GET"),
    ], "delegates": [S(BOSS, "PUT", '{"keys": {}, "x": NaN}'), S(BOSS, "PUT", '{"keys": {"tpa.lotlist.layout.v1": "\\ud800"}}'),
                     W(S(BOSS, "PUT", '{"keys": {}, "x": -0}')), S(BOSS, "PUT", "{")]},
    {"name": "開発者でない・切断中", "mode": "shared", "rows": OLD, "steps": [
        S(PART, "GET"), S(PART, "PUT", {"keys": {P: "1"}}), S(VIEW, "PUT", "[1]"),
    ], "delegates": []},
    {"name": "切断中の開発者", "mode": "shared", "rows": OLD, "revoked": True, "steps": [
        S(BOSS, "GET"), S(BOSS, "PUT", {"keys": {P: "1"}}),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": [], "steps": [
        S(BOSS, "GET"), S(BOSS, "PUT", {"keys": {P: "20"}}), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "共有にまだ無い・読むだけ（版 3.105.0: 窓も Python も読むときに最初の版を置く。終わった後の共有のファイルを比べる）", "mode": "mirror", "rows": OLD, "steps": [S(BOSS, "GET")], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": OLD, "steps": [
        # 版 3.105.0（作った後の採点の割れ）: 共有にまだ無いマスタを最初に読む歩。Python も窓も読むときに最初の版を置く（置いたファイルも比べる）
        S(BOSS, "GET"),
        S(BOSS, "PUT", {"keys": {P: "30"}}), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "同じ名前の行が 2 つ・後ろの行に値が無い（後ろが勝って字でなければ落ちる）", "mode": "shared",
     "rows": [{"名前": P, "値": "x"}, {"名前": P}, {"名前": L, "値": "1"}, {"名前": L, "値": "2"}], "steps": [S(BOSS, "GET")], "delegates": []},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": OLD, "lock": True,
     "steps": [S(BOSS, "PUT", {"keys": {P: "1"}}), S(BOSS, "GET")], "delegates": []},
    {"name": "置き場の行の値が字でない（窓は答えず Python に任せる）", "mode": "shared", "rows": [{"名前": P, "値": 100}, {"名前": ["x"], "値": "1"}], "steps": [],
     "delegates": [S(BOSS, "GET"), S(BOSS, "PUT", {"keys": {P: "1"}})]},
]


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    for name, rows in (("access_permissions", PERM), ("ui_defaults", sc["rows"])):
        if sc["mode"] == "local":
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] == "mirror":
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
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
                (dele if st.get("delegate") else steps).append({**st, "status": r.status_code, "json": body})
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "storeWho": app.config["MASTER_STORE"].who,
                        "steps": steps, "delegates": dele})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out, "profileKeys": list(ui_defaults.PROFILE_KEYS)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
