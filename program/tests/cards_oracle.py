# -*- coding: utf-8 -*-
"""カードの設計の道の「正しい答え」を出す係（版 3.80.0。desktop/tests/cards_parity.rs が呼ぶ）。

    python tests/cards_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/dashboard.py のカードの設計の 4 本）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/card_forms.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
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


def S(who, method, item=None, body=None, query="source=card%3Alotlist%3A%E5%93%81%E8%B3%AA", ctype="application/json"):
    path = "/api/card-forms" + (f"/{item}" if item is not None else "")
    if method != "GET" and query.startswith("source="):
        query = ""
    return {"who": list(who), "method": method, "path": path, "query": query, "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


SRC = "card:lotlist:品質"


def R(i, name, src, scope, login="", std="", body="", note="", rev=1, **kw):
    return {"id": i, "名前": name, "元": src, "範囲": scope, "ログインID": login, "標準": std, "中身": body, "備考": note, "rev": rev, **kw}


GOOD = j({"cols": 12, "row": 48, "theme": {"accent": "teal"}, "items": [{"id": "a", "kind": "field", "col": "ロット番号", "x": 0, "y": 0, "w": 4, "h": 1}]})
ROWS = [R(1, "標準", "dash", "共通デフォルト", std="1", body='{"rows": 8, "panels": []}'),
        R(2, "カードの標準", SRC, "共通", std="1", body=GOOD, rev=2, updated_at="2026-10-01T09:00:00", updated_by={"pc": "PC-9", "login": "x"}),
        R(3, "私のカード", SRC, "ID", login="p1", body=GOOD),
        R(4, "boss の", SRC, "ID", login="boss", std="1", body="abc"),
        R(5, "ほかの表", "card:worklog:実績", "共通", body=GOOD),
        R(6, "空", SRC, "共通", body=""),
        R(7, "セット", "dashset", "共通", body='{"items": ["1"]}')]


def B(*items, **kw):
    return {"items": list(items), **kw}


def F(i, col="c", x=0, y=0, w=3, h=1, **kw):
    return {"id": i, "kind": "field", "col": col, "x": x, "y": y, "w": w, "h": h, **kw}


def P(name, body, scope="me", **kw):
    return {"name": name, "source": SRC, "scope": scope, "body": body, **kw}


INTS = ["5", " 7 ", "+3", "-2", "1_0", "00", "2.9", "1e3", "", "abc", "_1", "1__0", "9" * 40, "-" + "9" * 40,
        "0" * 30 + "7", "0_" * 20 + "7", "0" * 3999 + "7", "-" + "0" * 40 + "3", "0" * 50]
SCENARIOS = [
    {"name": "書く人と範囲・中身・名前・版", "mode": "shared", "rows": ROWS, "steps": [
        S(BOSS, "GET"), S(PART, "GET"), S(VIEW, "GET"), S(NOBODY, "GET"),
        S(PART, "GET", query="source=card%3Aworklog%3A%E5%AE%9F%E7%B8%BE"), S(PART, "GET", query="source=bad"), S(PART, "GET", query="source=card%3Asrc%3AABC%3Ax"),
        S(PART, "GET", query="source=card%3Asrc%3Aabc%3A"), S(PART, "GET", query=""),
        S(PART, "POST", body=P("  新しい  ", B(F("a"), F("b", x=3), {"kind": "text", "text": "見出し", "x": 6, "w": 6, "h": 2, "st": {"fs": "l", "bold": 1, "color": "red", "bg": "x"}}),
                               standard=True, note="  メモ  ")),
        S(PART, "POST", body=P("新しい", B(F("a")))),
        S(PART, "POST", body=P("ｎｅｗ", B(F("a")))),
        S(PART, "POST", body=P("NEW", B(F("a")))),
        S(PART, "POST", body=P("共通", B(F("a")), scope="all")),
        S(VIEW, "POST", body=P("見る人", B(F("a")), scope="all")),
        S(PART, "POST", body=P("既定", B(F("a")), scope="default")),
        S(BOSS, "POST", body=P("既定 2", B(F("a")), scope="default", standard="yes")),
        S(NOBODY, "POST", body=P("だれ", B(F("a")))),
        S(PART, "POST", body={"name": "x", "source": "card:bad", "scope": "me", "body": B(F("a"))}),
        S(PART, "POST", body={"name": "", "source": "card:bad", "scope": "me", "body": B(F("a"))}),
        S(PART, "POST", body={"name": "x", "source": SRC, "scope": "x", "body": B(F("a"))}),
        S(PART, "POST", body=P("あ" * 41, B(F("a")))),
        *[S(PART, "POST", body=P(f"方眼の数 {k}", B(F("n", x=v, y=v, w=v, h=v), cols=v, row=v, theme={"radius": v, "density": "roomy", "accent": ""})))
          for k, v in enumerate(INTS)],
        S(PART, "POST", body=P("方眼 b", B(F("a", w=" 13 "), cols=" 13 ", row="200"))),
        S(PART, "POST", body=P("小数と真偽", B(F("a", x=1.9, y=True, w=2.5, h=False), F("b", x="4", y=0.5, w=3.99), cols=7.9, row=False))),
        S(PART, "POST", body=P("重なり", B(F("a", x=0, w=4), F("b", x=2, w=4, label="二")))),
        S(PART, "POST", body=P("重なり 2", B({"kind": "text", "x": 0, "w": 4}, {"kind": "combo", "expr": "x", "x": 2, "w": 4}))),
        S(PART, "POST", body=P("列が無い", B(F("a", col="")))),
        S(PART, "POST", body=P("式が無い", B({"kind": "combo", "expr": "   ", "label": "合計"}))),
        S(PART, "POST", body=P("日付が無い", B({"kind": "dates", "cols": ["", "  ", None, 0]}))),
        S(PART, "POST", body=P("日付", B({"kind": "dates", "cols": ["作業日", 12, True, " ", "x" * 300] + [f"d{k}" for k in range(40)], "w": 6}))),
        S(PART, "POST", body=P("見出し", B({"kind": "section", "text": "t" * 500, "fold": 1, "shut": "x", "w": 12},
                                          {"kind": "section", "fold": 0, "shut": True, "y": 1, "w": 12}, {"kind": "bogus", "col": "c", "y": 2}))),
        S(PART, "POST", body=P("タブ 2", B(F("a", tab="t1"), F("b", tab="t1"), tabs=[{"id": "t1"}]))),
        S(PART, "POST", body=P("タブ", B(F("a", tab="t1"), F("b", tab="z", y=1), F("c", tab="second"),
                                        tabs=[{"id": "t1", "name": "  基本  "}, {"id": "t1", "name": ""}, {"id": "second", "name": 0}, "x", {"id": "bad id!"}]
                                        + [{"id": f"k{k}"} for k in range(15)]))),
        S(PART, "POST", body=P("id", B({"id": "dup", "col": "a"}, {"id": "dup", "col": "b", "y": 1}, {"id": "i2", "col": "c", "y": 2},
                                      {"id": 7, "col": "d", "y": 3}, {"id": True, "col": "e", "y": 4}, {"id": "x" * 30, "col": "f", "y": 5}, 5))),
        S(PART, "POST", body=P("多すぎ", B(*[F(f"m{k}", y=k % 200, x=(k // 200) * 3) for k in range(251)]))),
        S(PART, "POST", body=P("大きすぎ", B(*[F(f"m{k}", col="c" * 200, y=k % 200, x=(k // 200) * 3, label="l" * 60) for k in range(250)]))),
        S(PART, "POST", body=P("中身なし", None)), S(PART, "POST", body=P("中身が並び", [1])),
        S(PART, "POST", body=P("字で", j(B(F("a"))))), S(PART, "POST", body=P("読めない字", "abc")),
        S(PART, "POST", body="null"), S(PART, "POST", body="[]"),
        S(PART, "POST", body=P("text", B(F("a"))), ctype="text/plain"),
        S(PART, "PUT", 3, {"name": "私の 2", "standard": 1, "base_rev": 1, "body": B(F("z", w=12))}),
        S(PART, "PUT", 3, {"name": "私の 3", "base_rev": 99}),
        S(PART, "PUT", 3, {"name": "新しい"}),
        S(PART, "PUT", 2, {"standard": True, "note": "共通を直す"}),
        S(VIEW, "PUT", 2, {"name": "見る人"}),
        S(PART, "PUT", 1, {"name": "ダッシュボード"}), S(PART, "PUT", 7, {"name": "セット"}), S(PART, "PUT", 99, {"name": "無い"}),
        S(PART, "PUT", 4, {"name": "ほかの ID"}),
        S(BOSS, "PUT", 4, {"body": B(F("a", col=""))}),
        S(BOSS, "PUT", 4, {"note": 12, "source": "card:worklog:x", "scope": "all"}),
        S(BOSS, "PUT", 4, {}), S(BOSS, "PUT", 4, "null"),
        S(PART, "DELETE", 3, query="rev=1"), S(PART, "DELETE", 3, query="rev=3"), S(PART, "DELETE", 3),
        S(PART, "DELETE", 1), S(PART, "DELETE", 7), S(VIEW, "DELETE", 2), S(PART, "DELETE", 2, query="rev=99"), S(PART, "DELETE", 77),
        S(BOSS, "GET"), S(PART, "GET"),
    ], "delegates": [
        S(PART, "POST", body="[1]"), S(PART, "POST", body=""), S(PART, "POST", body="{"),
        W(S(PART, "POST", body=P(1.5, B(F("a"))))), S(PART, "POST", body=P(["x"], B(F("a")))),
        S(PART, "POST", body=P("a", B(F("a"), label=1)) | {"note": ["x"]}),
        S(PART, "POST", body=P("a", B(F("a", label=["x"])))), S(PART, "POST", body=P("a", B(F("a", col={"a": 1})))),
        S(PART, "POST", body=P("a", B({"kind": "combo", "expr": [1]}))), S(PART, "POST", body=P("a", B({"kind": "text", "text": {"a": 1}}))),
        S(PART, "POST", body=P("a", B({"kind": "dates", "cols": [["x"]]}))), S(PART, "POST", body=P("a", B(F("a", tab=["t1"]), tabs=[{"id": "t1"}]))),
        S(PART, "POST", body=P("a", B(F("a"), tabs=[{"id": "t1", "name": ["x"]}]))),
        W(S(PART, "POST", body=P("a", B(F("a", w="４"))))), W(S(PART, "POST", body=P("a", B(F("a", w="4\x1c"))))),
        W(S(PART, "POST", body=P("a", B(F("a", w="　4"))))), W(S(PART, "POST", body=P("a", B(F("a", w="1" * 4400))))),
        W(S(PART, "POST", body=P("a", B(F("a"), cols="１２")))),
        S(PART, "POST", body='{"name": "a", "scope": "me", "source": "card:lotlist:品質", "body": {"items": []}, "x": NaN}'),
        S(PART, "POST", body=P("a", '{"items": [{"col": "a", "w": NaN}]}')), W(S(PART, "POST", body=P("a", '{"items": [{"col": "a", "w": -0}]}'))),
        S(PART, "PUT", 3, "[1]"), S(PART, "PUT", 3, ""), S(PART, "DELETE", 3, '"x"'),
        W(S(PART, "PUT", "４", {"name": "全角の id"})), W(S(PART, "DELETE", "١")),
    ]},
    {"name": "★標準の付け替え（同じ組だけ）", "mode": "shared",
     "rows": [R(1, "A", SRC, "ID", login="p1", std="1", body=GOOD), R(2, "B", SRC, "ID", login="p1", std="1", rev=4, body=GOOD),
              R(3, "C", "card:worklog:実績", "ID", login="p1", std="1", body=GOOD), R(4, "D", SRC, "共通", std="1", body=GOOD)],
     "steps": [S(PART, "GET"), S(PART, "PUT", 1, {"name": "A2"}), S(PART, "GET"),
               S(PART, "POST", body=P("G", B(F("a")), standard=True)), S(PART, "GET")], "delegates": []},
    {"name": "切断中", "mode": "shared", "rows": ROWS, "revoked": True, "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body=P("切断中", B(F("a")))), S(BOSS, "PUT", 4, {"name": "x"}), S(BOSS, "DELETE", 4),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": [], "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body=P("手元", B(F("a")))), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": ROWS, "steps": [
        S(PART, "POST", body=P("写し", B(F("a")))), S(PART, "GET"),
    ], "delegates": []},
    {"name": "写しだけで最初に読む（版 3.105.0 から窓も Python も読むだけで共有に最初の版を作る）", "mode": "mirror", "rows": ROWS, "steps": [], "delegates": [W(S(PART, "GET"))]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": ROWS, "lock": True,
     "steps": [S(PART, "POST", body=P("錠", B(F("a")))), S(PART, "PUT", 3, {"name": "x"}), S(PART, "DELETE", 3), S(PART, "GET")], "delegates": []},
    # 版 3.107.0: 読めない行（中身の字の欄が並び・NaN・名前が数）は行を隔てて答える（一覧は skipped・触れる直す・消すは断る）
    *[{"name": f"置き場のカードの行の中身が {what}（行を隔てて答える）", "mode": "shared", "rows": [R(1, "良い行", SRC, "共通", body=GOOD), bad],
       # 版 3.104.0: 方眼の数の全角の数字は窓も Python の int() と同じに読む（pyfmt::py_int_of）ので、その場面の歩は窓が答える
       "steps": [], "delegates": [W(x) for x in (S(PART, "GET"), S(PART, "POST", body=P("a", B(F("a")))), S(PART, "PUT", 2, {"name": "直す"}),
                                                 S(PART, "DELETE", 2), S(PART, "GET"))]}
      for what, bad in [("並びの名前", R(2, "x", SRC, "共通", body=j(B(F("a", label=["x"]))))),
                        ("全角の数", R(2, "x", SRC, "共通", body=j(B(F("a", w="３"))))),
                        ("NaN", R(2, "x", SRC, "共通", body='{"items": [{"col": "a", "w": NaN}]}')),
                        ("名前が数", R(2, 5, SRC, "共通", body=GOOD))]],
    {"name": "共有のファイルの版 revision が読めない（写しで続け、書く道は断る）", "mode": "shared", "rows": ROWS, "rev": "abc", "steps": [],
     "delegates": [W(S(PART, "GET")), W(S(PART, "POST", body=P("a", B(F("a"))))), W(S(PART, "PUT", 3, {"name": "x"})), W(S(PART, "DELETE", 3))]},
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
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
