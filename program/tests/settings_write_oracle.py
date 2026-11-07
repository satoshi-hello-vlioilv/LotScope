# -*- coding: utf-8 -*-
"""参照先の項目を書く道の「正しい答え」を出す係（版 3.89.0。desktop/tests/settings_write_parity.rs が呼ぶ）。

    python tests/settings_write_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/settings.py の PUT /api/settings/<key>。門番 _access_guard を含む）で
問い合わせの並びを当てる。窓の試験は rs に同じ並びを窓の道（desktop/src/settings_write.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
窓が答えず Python に任せる歩（delegates）は別の写し（pd）に当てる。形は shifts_oracle.py と同じ。GET /api/settings は page_parity.rs（settings_oracle.py の reads）
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
OLD = [{"id": 4, "項目": "lot_list.table", "値": "古い表", "rev": 2, "updated_at": "2026-01-01T00:00:00", "updated_by": {"pc": "X"}},
       {"id": 9, "項目": "work_log.pattern"},
       {"id": 2, "項目": "lot_list.table", "値": "2 つ目（使わない）", "rev": 7},
       {"id": 5, "値": "項目の無い行"}]


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def S(who, method, path, body=None, query=""):
    return {"who": list(who), "method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


P = "/api/settings/"
V = lambda v, **kw: {"value": v, **kw}  # noqa: E731
SCENARIOS = [
    {"name": "足す・直す・消す・行の版", "mode": "shared", "rows": [], "steps": [
        S(BOSS, "PUT", P + "lot_list.table", V(" 品質 ")),
        S(BOSS, "PUT", P + "lot_list.table", V("品質2", base_rev=1)),
        S(BOSS, "PUT", P + "lot_list.table", V("古い版", base_rev=1)),
        S(BOSS, "PUT", P + "lot_list.table", V("全角の版", base_rev="２")),
        S(BOSS, "PUT", P + "lot_list.table", V("小数の版", base_rev=3.9)),
        S(BOSS, "PUT", P + "lot_list.table", V("読めない版は確かめない", base_rev="x")),
        S(BOSS, "PUT", P + "lot_list.table", V("問い合わせの版"), query="rev=5"),
        S(BOSS, "PUT", P + "lot_list.table", V("大きな版", base_rev="99999999999999999999")),
        S(BOSS, "PUT", P + "lot_list.table", V("")),
        S(BOSS, "PUT", P + "lot_list.table", V("   ")),
        S(BOSS, "PUT", P + "lot_list.table", V(None, base_rev=0)),
        S(BOSS, "PUT", P + "lot_list.source", V("x", base_rev=3)),
        S(BOSS, "PUT", P + "lot_list.source", V('"C:\\共有\\品質.sqlite3"', base_rev=0)),
        S(BOSS, "PUT", P + "lot_list.source", V(None, base_rev=True)),
        S(BOSS, "PUT", P + "知らない.項目", V("x")),
        S(BOSS, "PUT", P + "lot_list.table/x", V("x")),
        S(BOSS, "PUT", P + "check", V("x")),
    ]},
    {"name": "値の読み方（数・URL・決まり・置き場・候補）", "mode": "shared", "rows": [], "steps": [
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V(60)),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("６０.0")),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V(" 1_200 ")),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("10.5")),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V(5)),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V(3601)),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V(True)),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("nan")),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("inf")),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("abc")),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("1e400")),
        S(BOSS, "PUT", P + "work_log.refresh_seconds", V(1e3)),
        S(BOSS, "PUT", P + "lot_list.stale_hours", V(36)),
        S(BOSS, "PUT", P + "lot_list.stale_hours", V("1e1")),
        S(BOSS, "PUT", P + "lot_list.stale_hours", V("１２０")),
        S(BOSS, "PUT", P + "lot_list.stale_hours", V(0.1)),
        S(BOSS, "PUT", P + "lot_list.stale_hours", V("-0")),
        S(BOSS, "PUT", P + "work_log.stale_hours", V(1440.0)),
        S(BOSS, "PUT", P + "work_log.stale_hours", V(1440.5)),
        S(BOSS, "PUT", P + "work_log.stale_hours", V(-1)),
        S(BOSS, "PUT", P + "work_log.stale_hours", V("1e-7")),
        S(BOSS, "PUT", P + "lotdsp_import.url", V("ftp://x")),
        S(BOSS, "PUT", P + "lotdsp_import.url", V(" https://lot.example/q ")),
        S(BOSS, "PUT", P + "schedule.cm3_base_url", V("HTTP://x")),
        S(BOSS, "PUT", P + "work_log.pattern", V("a*b*")),
        S(BOSS, "PUT", P + "work_log.pattern", V("実績")),
        S(BOSS, "PUT", P + "work_log.pattern", V(" 実績_*.sqlite3 ")),
        S(BOSS, "PUT", P + "work_log.folder", V(' "\\\\srv\\実績" ')),
        S(BOSS, "PUT", P + "update.source", V('"a"; b\n"c" ;;')),
        S(BOSS, "PUT", P + "update.source", V(' ; " " ')),
        S(BOSS, "PUT", P + "schedule.client_ip", V(10.5)),
        S(BOSS, "PUT", P + "schedule.equipments", V(False)),
        S(BOSS, "PUT", P + "schedule.inspect_keywords", V(12)),
        S(BOSS, "PUT", P + "lotdsp_import.direct.browser", V("  ")),
    ]},
    {"name": "本文の形", "mode": "shared", "rows": [{"id": 1, "項目": "lot_list.table", "値": "x", "rev": 1}], "steps": [
        S(BOSS, "PUT", P + "lot_list.table", "0"),
        S(BOSS, "PUT", P + "lot_list.table", V("y")),
        S(BOSS, "PUT", P + "lot_list.table", ""),
        S(BOSS, "PUT", P + "lot_list.table", V("z")),
        S(BOSS, "PUT", P + "lot_list.table", "null"),
        S(BOSS, "PUT", P + "lot_list.table", V("w")),
        S(BOSS, "PUT", P + "lot_list.table", "[]"),
        S(BOSS, "PUT", P + "lot_list.table", {"value": "base_rev が null", "base_rev": None}, query="rev=99"),
        S(BOSS, "PUT", P + "lot_list.table", {"value": "base_rev が空", "base_rev": ""}),
        S(BOSS, "PUT", P + "lot_list.table", "{壊れた"),
    ]},
    {"name": "前からある行（項目が同じ最初の行・版の無い行・項目の無い行）", "mode": "shared", "rows": OLD, "steps": [
        S(BOSS, "PUT", P + "lot_list.table", V("新しい表", base_rev=2)),
        S(BOSS, "PUT", P + "work_log.pattern", V("x_*.db", base_rev=1)),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V(30)),
        S(BOSS, "PUT", P + "lot_list.table", V(None, base_rev=3)),
        S(BOSS, "PUT", P + "lot_list.table", V("2 つ目の行", base_rev=7)),
    ]},
    {"name": "真偽の id（次の id は int(True)+1）", "mode": "shared", "rows": [{"id": True, "項目": "x", "値": "1"}], "steps": [
        S(BOSS, "PUT", P + "lot_list.table", V("t")),
    ]},
    {"name": "Python に任せる形（ブラウザ・表でない本文・並びの値・読めない本文・数字でない版・百分率符号）", "mode": "shared",
     "rows": [{"id": 1, "項目": "lot_list.table", "値": "x", "rev": 1}], "steps": [], "delegates": [
        S(BOSS, "PUT", P + "lotdsp_import.direct.browser", V("C:\\x.exe")),
        S(BOSS, "PUT", P + "lot_list.table", "[1]"),
        S(BOSS, "PUT", P + "lot_list.table", '"x"'),
        S(BOSS, "PUT", P + "lot_list.table", "5"),
        S(BOSS, "PUT", P + "lot_list.table", V([1, 2])),
        S(BOSS, "PUT", P + "lot_list.table", V({"a": 1})),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", '{"value": NaN}'),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", '{"value": 1e400}'),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", '{"value": 99999999999999999999}'),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", '{"value": -0}'),
        S(BOSS, "PUT", P + "lot_list.table", V("y", base_rev="²")),
        S(BOSS, "PUT", P + "lot%5Flist.table", V("y")),
    ]},
    {"name": "置き場の行の版・値が読めない（窓は答えず Python に任せる）", "mode": "shared",
     "rows": [{"id": 1, "項目": "lot_list.table", "値": "x", "rev": "x"}, {"id": 2, "項目": "work_log.pattern", "値": ["a"]}], "steps": [],
     "delegates": [S(BOSS, "PUT", P + "lot_list.table", V("y")), S(BOSS, "PUT", P + "lot_list.source", V("y"))]},
    {"name": "書ける段と門番", "mode": "shared", "rows": [], "steps": [
        S(PART, "PUT", P + "lot_list.table", V("部分的編集可")),
        S(VIEW, "PUT", P + "lot_list.table", V("閲覧のみは書けない")),
        S(VIEW, "PUT", P + "知らない", V("x")),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": OLD[:2], "steps": [
        S(BOSS, "PUT", P + "lot_list.table", V("手元", base_rev=2)),
        S(BOSS, "PUT", P + "lot_list.stale_hours", V(12)),
        S(BOSS, "PUT", P + "work_log.pattern", V("")),
    ]},
    # 共有にまだ無い（写しから最初の版）: 場面を組むときに Python が権限を読み、共有に最初の版を作る（読みの副作用）。窓はその後の形に答える
    # （まだ無いうちは窓は答えない: Lot::settings_route の Inputs::check と、parity の answer の share_absent）
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": OLD[:1], "steps": [
        S(BOSS, "PUT", P + "lot_list.table", V("写しから", base_rev=2)),
    ]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": OLD[:1], "lock": True, "steps": [
        S(BOSS, "PUT", P + "lot_list.table", V("錠", base_rev=2)),
        S(BOSS, "PUT", P + "lot_list.refresh_seconds", V("x")),
    ]},
]


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    for name, rows in (("access_permissions", PERM), ("path_settings", sc["rows"])):
        if sc["mode"] == "local":
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] == "mirror":
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    if sc.get("lock"):          # ほかの PC が保存している途中（切れていない錠。窓も Python も locked で答え、書かない）
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
            pd = base / f"s{i}" / "pd"      # Python に任せる歩（版 3.77.0）は別の写しに当てる（突き合わせるファイルに混ぜない）
            place(pd, sc)
            clients = {False: client, True: create_app({"TESTING": True, "MASTER_STORE": store_of(pd, sc)}).test_client()}
            steps, dele = [], []
            for st in sc["steps"] + [dict(x, delegate=True) for x in sc.get("delegates", [])]:
                who.update(login=st["who"][0], pc=st["who"][1])
                routes._REVOKE_CACHE.update(at=0.0, key="")
                forget_tab_cache()
                path = st["path"] + (f"?{st['query']}" if st["query"] else "")
                try:
                    r = clients[bool(st.get("delegate"))].open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"), content_type="application/json")
                except Exception as e:      # 道の外で落ちた（試験の接続は投げ返す。本番は 500 で答え、書かない）
                    (dele if st.get("delegate") else steps).append(
                        {**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}", "kind": "error", "type": type(e).__name__}})
                    continue
                try:
                    body = r.get_json()
                except Exception:
                    body = None
                (dele if st.get("delegate") else steps).append({**st, "status": r.status_code, "json": body})
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "storeWho": app.config["MASTER_STORE"].who, "steps": steps, "delegates": dele})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
