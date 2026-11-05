# -*- coding: utf-8 -*-
"""勤務体系のマスタの道の「正しい答え」を出す係（版 3.75.0。desktop/tests/shifts_parity.rs が呼ぶ）。

    python tests/shifts_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/shifts.py。門番 _access_guard を含む）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/shifts_write.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
形は access_write_oracle.py と同じ: {"scenarios": [{"name", "py", "rs", "conf", "storeWho", "steps": [{who, method, path, query, body, status, json}]}]}
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
from app.services import identity  # noqa: E402

BOSS, PART, VIEW = ("boss", "PC-1"), ("p1", "PC-2"), ("v1", "PC-3")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 2, "ログインID": "p1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "有効": "有"},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有"}]
WORK = [{"id": 1, "キー": "a", "設備名": "CR1", "rev": 1}, {"id": 2, "キー": "b", "設備名": " l-1 ", "rev": 1}, {"id": 3, "キー": "c", "設備名": "", "rev": 1}]
THREE = [{"name": "1直", "start": "7:00", "end": "15:00"}, {"name": "2直", "start": "15:00", "end": "23:00"},
         {"name": "3直", "start": "23:00", "end": "7:00", "dayOffset": -1}]
OLD = [{"id": 7, "名称": "古い1", "表示順": "²", "区分": "[]", "rev": 1},
       {"id": 8, "名称": "古い2", "表示順": "--5", "適用設備": "CR1、ＣＲ１,L-2\nl-2", "区分": '[{"name":"x","start":"23:00","end":"07:00","dayOffset":9}]'},
       {"id": 9, "名称": "古い3", "表示順": "1e400", "区分": "壊れた", "rev": 4, "備考": "メモ"},
       {"id": 10, "名称": "古い4", "表示順": "３０", "区分": '[{"name":"日","start":"８:15","end":"17:05"}]', "rev": 2}]


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def S(who, method, path, body=None, query=""):
    return {"who": list(who), "method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


P = "/api/masters/shifts"
SCENARIOS = [
    {"name": "足す・同じ名前・本文の確かめ", "mode": "shared", "shifts": [], "steps": [
        S(BOSS, "GET", P),
        S(BOSS, "POST", P, {"name": "交替勤務(1,2,3直)", "segments": THREE, "note": " 現場の基本 "}),
        S(BOSS, "POST", P, {"name": " 交替勤務(1,2,3直) ", "segments": THREE}),
        S(BOSS, "POST", P, {"name": "", "segments": THREE}),
        S(BOSS, "POST", P, {"name": "x", "segments": []}),
        S(BOSS, "POST", P, {"name": "x", "segments": [{"name": "a", "start": "7:00", "end": "7:00"}]}),
        S(BOSS, "POST", P, {"name": "x", "segments": [{"name": "a", "start": "24:00", "end": "7:00"}]}),
        S(BOSS, "POST", P, {"name": "x", "segments": [{"name": "a", "start": "7:00", "end": "8:00"}, {"name": "a", "start": "9:00", "end": "10:00"}]}),
        S(BOSS, "POST", P, {"name": "x", "segments": [{"name": "", "start": "7:00", "end": "8:00"}]}),
        S(BOSS, "POST", P, {"name": "x", "segments": [{"name": f"s{i}", "start": "7:00", "end": "8:00"} for i in range(13)]}),
        S(BOSS, "POST", P, {"name": "x", "segments": "壊れた"}),
        S(BOSS, "POST", P, {"name": "x", "segments": {"a": 1}}),
        S(BOSS, "POST", P, {"name": "x", "segments": [{"name": "a", "start": "23:00", "end": "7:00", "dayOffset": "x"}]}),
        S(BOSS, "POST", P, {"name": "字の区分", "segments": j([{"name": "a", "start": "7:00", "end": "8:00"}])}),
        S(BOSS, "POST", P, {"name": "数の読み方", "segments": [{"name": "夜", "start": "２３:００", "end": "᠑:30", "dayOffset": "３"},
                                                               {"name": "昼", "start": "９:00", "end": "1８:00", "dayOffset": 5},
                                                               {"name": "朝", "start": "5:00", "end": "6:00"}], "order": "１２"}),
        S(BOSS, "POST", P, {"name": "日付補正", "segments": [{"name": "a", "start": "22:00", "end": "6:00", "dayOffset": 1.9},
                                                            {"name": "b", "start": "6:00", "end": "5:00", "dayOffset": True},
                                                            {"name": "c", "start": "8:00", "end": "9:00", "dayOffset": 3},
                                                            {"name": "d", "start": "21:00", "end": "1:00", "dayOffset": -99}]}),
        S(BOSS, "POST", P, {"name": "長い名前" * 12, "equipment": "CR1、 l-1 ,ＣＲ１\nL-2", "segments": THREE, "note": "あ" * 250, "order": "²"}),
        S(BOSS, "POST", P, {"name": "並びの設備", "equipment": ["CR1", "", None, "L-3", "cr1"], "segments": THREE, "order": 7}),
        S(BOSS, "POST", P, {"name": "数の名前", "segments": THREE, "order": "abc"}),
        S(BOSS, "POST", P, {"name": 12345, "segments": THREE, "note": 1.5, "order": True}),
        S(BOSS, "GET", P),
    ]},
    {"name": "直す・消す・行の版", "mode": "shared", "shifts": OLD, "steps": [
        S(BOSS, "GET", P),
        S(BOSS, "POST", P, {"name": "新しい", "segments": THREE}),
        S(BOSS, "PUT", f"{P}/9", {"equipment": "CR1、L-1", "base_rev": 4}),
        S(BOSS, "PUT", f"{P}/9", {"note": "古い版", "base_rev": 4}),
        S(BOSS, "PUT", f"{P}/9", {"note": "全角の版", "base_rev": "５"}),
        S(BOSS, "PUT", f"{P}/9", {"name": "古い4", "base_rev": 6}),
        S(BOSS, "PUT", f"{P}/9", {"name": "名前を変えた", "segments": THREE, "order": "3"}),
        S(BOSS, "PUT", f"{P}/9", {"segments": []}),
        S(BOSS, "PUT", f"{P}/9", {"name": " "}),
        S(BOSS, "PUT", f"{P}/99", {"note": "x", "base_rev": 1}),
        S(BOSS, "PUT", f"{P}/99", {"note": "x"}),
        S(BOSS, "PUT", f"{P}/9", {}),
        S(BOSS, "DELETE", f"{P}/10", query="rev=1"),
        S(BOSS, "DELETE", f"{P}/10", query="rev=2"),
        S(BOSS, "DELETE", f"{P}/10", query="rev=2"),
        S(BOSS, "DELETE", f"{P}/7"),
        S(BOSS, "DELETE", f"{P}/7"),
        S(BOSS, "DELETE", f"{P}/8", query="rev=x"),
        S(BOSS, "GET", P),
    ]},
    {"name": "書ける段と門番", "mode": "shared", "shifts": OLD[:2], "steps": [
        S(PART, "GET", P),
        S(PART, "POST", P, {"name": "部分的編集可でも書ける", "segments": THREE}),
        S(VIEW, "GET", P),
        S(VIEW, "POST", P, {"name": "閲覧のみは書けない", "segments": THREE}),
        S(VIEW, "DELETE", f"{P}/7"),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "shifts": OLD, "steps": [
        S(BOSS, "GET", P),
        S(BOSS, "POST", P, {"name": "手元", "segments": THREE}),
        S(BOSS, "PUT", f"{P}/10", {"note": "直した", "base_rev": 2}),
        S(BOSS, "DELETE", f"{P}/7"),
    ]},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "shifts": OLD[:1], "steps": [
        S(BOSS, "POST", P, {"name": "写しから", "segments": THREE}),
        S(BOSS, "GET", P),
    ]},
]


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    for name, rows in (("access_permissions", PERM), ("work_log_files", WORK), ("shift_patterns", sc["shifts"])):
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
            steps = []
            for st in sc["steps"]:
                who.update(login=st["who"][0], pc=st["who"][1])
                routes._REVOKE_CACHE.update(at=0.0, key="")
                forget_tab_cache()
                path = st["path"] + (f"?{st['query']}" if st["query"] else "")
                r = client.open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"), content_type="application/json")
                try:
                    body = r.get_json()
                except Exception:
                    body = None
                steps.append({**st, "status": r.status_code, "json": body})
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "storeWho": app.config["MASTER_STORE"].who, "steps": steps})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
