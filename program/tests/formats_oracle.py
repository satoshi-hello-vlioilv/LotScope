# -*- coding: utf-8 -*-
"""共有の書式の道の「正しい答え」を出す係（版 3.80.0。desktop/tests/formats_parity.rs が呼ぶ）。

    python tests/formats_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/formats.py の 4 本。門番 routes/access.py も）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/formats_write.rs と門番 access::guard）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
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


def S(who, method, item=None, body=None, query="", ctype="application/json"):
    path = "/api/masters/formats" + (f"/{item}" if item is not None else "")
    return {"who": list(who), "method": method, "path": path, "query": query, "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


def R(i, name, src, body, table="", origin="", note="", rev=1, **kw):
    return {"id": i, "名前": name, "元": src, "表": table, "作った所": origin, "中身": body, "備考": note, "rev": rev, **kw}


ROWS = [R(1, "標準", "lot", '{"columns":{"order":["a","b"]},"sorts":[{"column":"x","dir":"asc"}],"filters":[]}', table="表A", origin="L-1",
          updated_at="2026-10-01T09:00:00", updated_by={"pc": "PC-9", "login": "x"}),
        R(2, "作業の書式", "work", '{"slicer":{"cards":[{"column":"c","sel":["v"]}]},"adhoc":{"column":"a","value":" x "},"marks":[{"on":true}]}', rev=2),
        R(3, "壊れ", "lot", "abc"),
        R(4, "空", "lot", ""),
        R(5, "並びの中身", "src:abc", "[1, 2]"),
        {"id": 6, "名前": "版の無い行", "元": "lot", "表": "", "作った所": "", "中身": '{"adhoc":{"value":"  "},"slicer":{"cards":[]}}', "備考": ""}]
ORDERED = {"sorts": [{"dir": "desc", "column": "z"}], "columns": {"z": 1, "a": [1, 2.5, 1e-05, 1e16], "m": {"y": None, "b": True}},
           "bogus": 1, "filters": "x", "arrange": {}, "views": [], "rules": {"r2": {"rows": []}, "r1": {"self": 1}}}
BIG = {"columns": {"x": "あ" * (180 * 1024)}}
SCENARIOS = [
    {"name": "書く人と門番・中身・名前・版", "mode": "shared", "rows": ROWS, "steps": [
        S(BOSS, "GET"), S(PART, "GET"), S(VIEW, "GET"), S(NOBODY, "GET"),
        S(PART, "GET", query="source=lot"), S(PART, "GET", query="source=work"), S(PART, "GET", query="source=src%3Aabc"),
        S(PART, "GET", query="source=bad"), S(PART, "GET", query="source=src%3AABC"), S(PART, "GET", query="source="),
        S(PART, "POST", body={"name": "  新しい  ", "source": "lot", "table": "  T  ", "origin": "o" * 100, "note": "  n  ", "body": ORDERED}),
        S(PART, "POST", body={"name": "標準", "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "ｽﾀﾝﾀﾞｰﾄﾞ", "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "標準", "source": "work", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "new", "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "NEW", "source": "lot", "body": {"sorts": []}}),
        S(VIEW, "POST", body={"name": "見る人", "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "", "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": 0, "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": True, "source": "lot", "body": {"sorts": []}, "table": 12, "origin": False, "note": None}),
        S(PART, "POST", body={"name": "あ" * 41, "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "あ" * 40, "source": "lot", "body": {"sorts": []}, "note": "い" * 250}),
        S(PART, "POST", body={"name": "x", "source": "bad", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "x", "source": ["lot"], "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "x", "source": "src:ab1", "body": {}}),
        S(PART, "POST", body={"name": "x", "source": "lot"}),
        S(PART, "POST", body={"name": "x", "source": "lot", "body": {"bogus": 1, "sorts": {}, "columns": []}}),
        S(PART, "POST", body={"name": "x", "source": "lot", "body": "abc"}),
        S(PART, "POST", body={"name": "x", "source": "lot", "body": "[1]"}),
        S(PART, "POST", body={"name": "x", "source": "lot", "body": [1]}),
        S(PART, "POST", body={"name": "字で", "source": "lot", "body": '{"sorts":[1],"columns":{"b":1,"a":2,"b":3}}'}),
        S(PART, "POST", body='{"name": "同じ鍵", "source": "lot", "body": {"views": [1], "views": [2], "marks": []}, "name": "同じ鍵 2"}'),
        S(PART, "POST", body={"name": "大きい", "source": "lot", "body": BIG}),
        S(PART, "POST", body={"name": "大きすぎ", "source": "lot", "body": {"columns": {"x": "あ" * (180 * 1024), "y": "い" * 1000}}}),
        S(PART, "POST", body="null"), S(PART, "POST", body="0"), S(PART, "POST", body="[]"),
        S(PART, "POST", body={"name": "text", "source": "work", "body": {"marks": []}}, ctype="text/plain"),
        S(PART, "PUT", 1, {"name": "標準 2", "body": {"marks": [], "sorts": [{"b": 1, "a": 2}]}, "note": "直した", "base_rev": 1,
                           "source": "work", "table": "x"}),
        S(PART, "PUT", 1, {"name": "x", "base_rev": 99}),
        S(PART, "PUT", 1, {"name": "作業の書式"}),
        S(PART, "PUT", 2, {"name": "標準 2"}),
        S(PART, "PUT", 1, {"body": {}}),
        S(PART, "PUT", 1, {"name": ""}),
        S(PART, "PUT", 99, {"name": "無い"}),
        S(PART, "PUT", 99, {"name": "無い", "base_rev": 1}),
        S(VIEW, "PUT", 1, {"name": "見る人"}),
        S(PART, "PUT", 6, {}),
        S(PART, "PUT", 6, "null"),
        S(PART, "PUT", 6, {"note": "  備考  ", "base_rev": " 1 "}),
        S(PART, "PUT", 6, {"name": "z", "base_rev": "x"}),
        S(PART, "DELETE", 3, query="rev=9"),
        S(PART, "DELETE", 3, query="rev=1"),
        S(PART, "DELETE", 3),
        S(PART, "DELETE", 3, query="rev=1"),
        S(VIEW, "DELETE", 2),
        S(PART, "DELETE", 77),
        S(BOSS, "GET"), S(PART, "GET", query="source=lot"),
    ], "delegates": [
        S(PART, "POST", body="[1]"), S(PART, "POST", body=""), S(PART, "POST", body="{"),
        S(PART, "POST", body={"name": 1.5, "source": "lot", "body": {"sorts": []}}),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}, "table": ["x"]}),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}, "origin": 1.5}),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}, "note": {"a": 1}}),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}, "note": 12345678901234567890}),
        S(PART, "POST", body='{"name": "a", "source": "lot", "body": {"sorts": []}, "x": NaN}'),
        W(S(PART, "POST", body='{"name": "a", "source": "lot", "body": {"sorts": [-0]}}')),
        S(PART, "POST", body='{"name": "a", "source": "lot", "body": {"sorts": [12345678901234567890]}}'),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": '{"sorts": [NaN]}'}),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": '{"sorts": [-0]}'}),
        S(PART, "POST", body={"name": "a", "source": "lot", "body": '{"sorts": ["\\ud800"]}'}),
        S(PART, "PUT", 2, "[1]"), S(PART, "PUT", 2, ""), S(PART, "DELETE", 2, '"x"'),
        W(S(PART, "PUT", "４", {"name": "全角の id"})), W(S(PART, "DELETE", "١")),
    ]},
    {"name": "切断中", "mode": "shared", "rows": ROWS, "revoked": True, "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body={"name": "切断中", "source": "lot", "body": {"sorts": []}}),
        S(BOSS, "PUT", 1, {"name": "x"}), S(BOSS, "DELETE", 1),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": [], "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body={"name": "手元", "source": "lot", "body": {"sorts": []}}), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": ROWS, "steps": [
        S(PART, "POST", body={"name": "写し", "source": "lot", "body": {"sorts": []}}), S(PART, "GET"),
    ], "delegates": []},
    {"name": "共有のフォルダにまだ無い・写しだけで最初に読む（Python は読むだけで共有に最初の版を作る）", "mode": "mirror",
     "rows": ROWS, "steps": [], "delegates": [S(PART, "GET")]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": ROWS, "lock": True,
     "steps": [S(PART, "POST", body={"name": "錠", "source": "lot", "body": {"sorts": []}}), S(PART, "PUT", 1, {"name": "x"}),
               S(PART, "DELETE", 1), S(PART, "GET")], "delegates": []},
    *[{"name": f"置き場の行の形が違う: {what}（窓は答えず Python に任せる）", "mode": "shared", "rows": [R(1, "良い行", "lot", '{"sorts":[]}'), bad],
       "steps": [], "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}})]}
      for what, bad in [("名前が数", R(2, 5, "lot", '{"sorts":[]}')),
                        ("中身に NaN", R(2, "NaN の中身", "lot", '{"sorts":[NaN]}')),
                        ("並べ替えが並びでない", R(2, "x", "lot", '{"sorts":{"a":1}}')),
                        ("スライサーの cards が字", R(2, "x", "lot", '{"slicer":{"cards":"abc"}}')),
                        ("版が読めない", R(2, "x", "lot", '{"sorts":[]}', rev="二")),
                        ("id が字", {"id": "4", "名前": "字の id", "元": "lot", "中身": "{}"})]],
    *[{"name": f"共有のファイルの字に {what}（窓は答えず Python に任せる）", "mode": "shared",
       "rows": [R(1, "良い行", "lot", '{"sorts":[]}'), dict(R(2, "生の値", "work", '{"sorts":[]}'), x="@RAW@")], "raw": raw,
       "steps": [], "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}}),
                                  S(PART, "PUT", 1, {"name": "b"})]}
      for what, raw in [("NaN", "NaN"), ("整数の -0", "-0"), ("i64 に入らない整数", "1" + "0" * 30)]],
    {"name": "共有のファイルの版 revision が読めない（Python の int() が読めない。窓は答えず Python に任せる）", "mode": "shared",
     "rows": [R(1, "良い行", "lot", '{"sorts":[]}')], "rev": "abc", "steps": [],
     "delegates": [S(PART, "GET"), S(PART, "POST", body={"name": "a", "source": "lot", "body": {"sorts": []}}), S(PART, "DELETE", 1)]},
]
FILE_NAME = "display_formats"


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
        t = f.read_text(encoding="utf-8").replace('"@RAW@"', sc["raw"])
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
