# -*- coding: utf-8 -*-
"""ダッシュボードの道の「正しい答え」を出す係（版 3.82.0。desktop/tests/dashboards_parity.rs が呼ぶ）。

    python tests/dashboards_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/dashboard.py のダッシュボードの 5 本）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/dashboards_write.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
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


def S(who, method, item=None, body=None, query="", ctype="application/json", path=None):
    path = path or ("/api/dashboards" + (f"/{item}" if item is not None else ""))
    return {"who": list(who), "method": method, "path": path, "query": query, "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


def H(who, body, ctype="application/json"):
    return S(who, "PUT", body=body, path="/api/dashboards-hidden", ctype=ctype)


def R(i, name, src, scope, login="", std="", body="", note="", rev=1, **kw):
    return {"id": i, "名前": name, "元": src, "範囲": scope, "ログインID": login, "標準": std, "中身": body, "備考": note, "rev": rev, **kw}


def Pn(pid="a", x=0, y=0, w=4, h=2, visual="bar", source="work", **kw):
    return {"id": pid, "x": x, "y": y, "w": w, "h": h, "title": kw.pop("title", ""), "visual": visual, "source": source,
            "body": kw.pop("body", {"rows": [{"column": "@workday"}], "measures": [{"agg": "lots"}]}), **kw}


def L(*panels, rows=8, **kw):
    return {"rows": rows, "panels": list(panels), **kw}


def P(name, body, scope="me", **kw):
    return {"name": name, "scope": scope, "body": body, **kw}


GOOD = j(L(Pn()))
LONGT = "a" * 59 + " b"           # 60 字で切った後に末尾が空白（確かめを通すたびに字が変わる）
BOARD_LEGACY = j(L(Pn("bd", w=7, h=7, visual="board", legacy=True)))
ROWS = [R(1, "朝", "dash", "共通デフォルト", std="1", body=GOOD),
        R(2, "全員の", "dash", "共通", std="1", body=GOOD, rev=2, updated_at="2026-10-01T09:00:00", updated_by={"pc": "PC-9", "login": "x"}),
        R(3, "私の", "dash", "ID", login="p1", body=GOOD),
        R(4, "boss の", "dash", "ID", login="boss", std="1", body="abc"),
        R(5, "空", "dash", "共通", body=""),
        R(6, "前の版の表", "dash", "共通", body=BOARD_LEGACY),
        R(7, "セット", "dashset", "共通", body='{"items": ["1"]}'),
        R(8, "カード", "card:lotlist:品質", "共通", body='{"items": []}'),
        R(9, "外した組み込み", "dashoff", "ID", login="v1", body='{"keys": ["standard"]}')]
CONDS = [{"id": 1, "キー": "wip", "条件": j({"filters": [{"column": "区分", "op": "=", "value": "保留"}], "search": "  検  "}), "備考": ""},
         {"id": 2, "キー": "work", "条件": "{bad", "備考": ""}]
SCENARIOS = [
    {"name": "書く人と範囲・中身・名前・版", "mode": "shared", "rows": ROWS, "settings": [], "steps": [
        S(BOSS, "GET"), S(PART, "GET"), S(VIEW, "GET"), S(NOBODY, "GET"),
        S(PART, "POST", body=P("  新しい  ", L(Pn(title=LONGT), Pn("b", x=4, fmt={"colors": {f"k{n:02d}": "#123456" for n in range(40, -1, -1)}})),
                               standard=True, note="  メモ  ")),
        S(PART, "POST", body=P("新しい", L(Pn()))), S(PART, "POST", body=P("ｎｅｗ", L(Pn()))), S(PART, "POST", body=P("NEW", L(Pn()))),
        S(PART, "POST", body=P("共通", L(Pn()), scope="all")), S(VIEW, "POST", body=P("見る人", L(Pn()), scope="all")),
        S(PART, "POST", body=P("既定", L(Pn()), scope="default")), S(BOSS, "POST", body=P("既定 2", L(Pn()), scope="default", standard="yes")),
        S(NOBODY, "POST", body=P("だれ", L(Pn()))), S(PART, "POST", body=P("", L(Pn()))), S(PART, "POST", body=P("x", L(Pn()), scope="x")),
        S(PART, "POST", body=P("あ" * 41, L(Pn()))), S(PART, "POST", body=P("重なり", L(Pn(), Pn("b", x=2)))),
        S(PART, "POST", body=P("段なし", L(Pn(body={"rows": []})))), S(PART, "POST", body=P("中身なし", None)), S(PART, "POST", body=P("字で", GOOD)),
        S(PART, "POST", body=P("読めない字", "abc")), S(PART, "POST", body="null"), S(PART, "POST", body="[]"),
        S(PART, "POST", body=P("text", L(Pn())), ctype="text/plain"),
        S(PART, "PUT", 3, {"name": "私の 2", "standard": 1, "base_rev": 1, "body": L(Pn("z", w=12))}),
        S(PART, "PUT", 3, {"name": "私の 3", "base_rev": 99}), S(PART, "PUT", 3, {"name": "新しい"}),
        S(PART, "PUT", 2, {"standard": True, "note": "共通を直す"}), S(VIEW, "PUT", 2, {"name": "見る人"}),
        S(PART, "PUT", 7, {"name": "セット"}), S(PART, "PUT", 8, {"name": "カード"}), S(PART, "PUT", 99, {"name": "無い"}),
        S(PART, "PUT", 4, {"name": "ほかの ID"}), S(BOSS, "PUT", 4, {"body": L(Pn(), Pn("b", x=1))}),
        S(BOSS, "PUT", 4, {"note": 12, "scope": "all"}), S(BOSS, "PUT", 4, {}), S(BOSS, "PUT", 4, "null"),
        S(PART, "DELETE", 3, query="rev=1"), S(PART, "DELETE", 3, query="rev=3"), S(PART, "DELETE", 3),
        S(PART, "DELETE", 1), S(PART, "DELETE", 7), S(VIEW, "DELETE", 2), S(PART, "DELETE", 2, query="rev=99"), S(PART, "DELETE", 77),
        S(BOSS, "GET"), S(PART, "GET"), S(VIEW, "GET"),
    ], "delegates": [
        S(PART, "POST", body="[1]"), S(PART, "POST", body=""), S(PART, "POST", body="{"),
        W(S(PART, "POST", body=P(1.5, L(Pn())))), S(PART, "POST", body=P(["x"], L(Pn()))),
        S(PART, "POST", body='{"name": "a", "scope": "me", "body": {"rows": 8, "panels": []}, "x": NaN}'),
        W(S(PART, "POST", body='{"name": "a", "scope": "me", "body": {"rows": -0, "panels": []}}')),
        W(S(PART, "POST", body=P("a", L(Pn(w="５"))))), S(PART, "POST", body=P("a", '{"rows": NaN}')),
        S(PART, "PUT", 3, "[1]"), S(PART, "PUT", 3, ""), S(PART, "DELETE", 3, '"x"'),
        W(S(PART, "PUT", "４", {"name": "全角の id"})), W(S(PART, "DELETE", "١")),
    ]},
    {"name": "組み込みと同じ名前（入れ替え・確かめを 2〜3 回通す・大きさ）", "mode": "shared", "settings": [],
     "rows": [R(1, "私の", "dash", "ID", login="p1", body=GOOD), R(2, "標準", "dash", "ID", login="boss", body=j(L(Pn(title=LONGT))))],
     "steps": [S(PART, "GET"), S(BOSS, "GET"),
               S(PART, "POST", body=P("標準", L(Pn(title=LONGT)))), S(PART, "GET"),
               S(PART, "POST", body=P(" 標準 ", L(Pn(title=LONGT), replaces="standard"), scope="all")),
               S(BOSS, "POST", body=P("標準", L(Pn(title=LONGT)), scope="default")),
               S(PART, "PUT", 1, {"name": "標準"}), S(PART, "PUT", 1, {"standard": True}), S(BOSS, "PUT", 2, {"note": "メモ"}),
               S(PART, "GET"), S(BOSS, "GET"), S(VIEW, "GET")], "delegates": []},
    # 版 3.107.0 の割れ 8: 一覧は入れ替えずにそのまま出す（前は Python の一覧が 500。窓は任せた）。行は画面で直せる（次の場面）
    {"name": "組み込みと同じ名前の行の中身が確かめに通らない（一覧は入れ替えずに出す）", "mode": "shared", "settings": [],
     "rows": [R(1, "標準", "dash", "ID", login="p1", body=j(L(Pn(), Pn("b", x=1))))],
     "steps": [S(BOSS, "GET")], "delegates": [W(S(PART, "GET"))]},
    {"name": "組み込みと同じ名前の行の中身が確かめに通らない行を直す", "mode": "shared", "settings": [],
     "rows": [R(1, "標準", "dash", "ID", login="p1", body=j(L(Pn(), Pn("b", x=1))))],
     "steps": [S(PART, "PUT", 1, {"body": L(Pn())}), S(PART, "GET")], "delegates": []},
    {"name": "名前を標準にする行の前の中身が壊れている", "mode": "shared", "settings": [],
     "rows": [R(1, "私の", "dash", "ID", login="p1", body="abc")],
     "steps": [S(PART, "PUT", 1, {"name": "標準"}), S(PART, "GET")], "delegates": []},
    {"name": "組み込みを外す・戻す", "mode": "shared", "rows": ROWS, "settings": [], "steps": [
        S(PART, "GET"), H(PART, {"scope": "me", "keys": ["standard", "x", "standard"]}), S(PART, "GET"),
        H(PART, {"scope": "me", "keys": "standard"}), S(PART, "GET"), H(PART, {"scope": "me", "keys": {"standard": 1}}), S(PART, "GET"),
        H(PART, {"scope": "me", "keys": []}), H(PART, {"scope": "me"}), H(BOSS, {"scope": "default", "keys": ["standard"]}),
        S(PART, "GET"), S(VIEW, "GET"), H(PART, {"scope": "default", "keys": ["standard"]}), H(PART, {"scope": "all", "keys": []}),
        H(NOBODY, {"scope": "me", "keys": ["standard"]}), H(PART, "null"), H(PART, "[]"), H(VIEW, {"scope": "me", "keys": []}),
        H(BOSS, {"scope": "default", "keys": None}), S(BOSS, "GET"),
    ], "delegates": [H(PART, ""), H(PART, "{bad"), H(PART, "[1]"), H(PART, {"scope": "me", "keys": 5}), H(PART, {"scope": "me", "keys": True})]},
    {"name": "前の版の条件（合わせた表の legacy へ入れる）", "mode": "shared", "rows": ROWS, "settings": CONDS,
     "steps": [S(PART, "GET"), S(BOSS, "GET")], "delegates": []},
    # 版 3.107.0: 前の版の条件のマスタの読めない行（表でない・条件が表でない）は隔てて読む（前は Python が落ちて 500）
    *[{"name": f"前の版の条件のマスタが {what}（行を隔てて読む）", "mode": "shared", "rows": ROWS, "settings": rows,
       "steps": [S(PART, "POST", body=P("書くのは窓", L(Pn())))], "delegates": [W(S(PART, "GET"))]}
      for what, rows in [("並びの条件", [{"id": 1, "キー": "wip", "条件": "[1]"}]), ("表でない行", ["x"]), ("2 つの条件の後ろに表でない行", [{"id": 1, "キー": "wip", "条件": "{}"}, {"id": 2, "キー": "work", "条件": "{}"}, "x"]), ("null の条件", [{"id": 1, "キー": "wip", "条件": "null"}])]],
    {"name": "前の版の条件のマスタがまだ無い（版 3.105.0 から窓も Python も読むだけで最初の版を作る）", "mode": "shared", "rows": ROWS,
     "steps": [S(PART, "DELETE", 3)], "delegates": [W(S(PART, "GET"))]},
    # 版 3.107.0 の割れ 8: 中身が表でない外した組み込みの行は外した鍵なしとして読み、外す・戻すの道で置き換えて直せる（前は Python の一覧が 500）
    {"name": "外した組み込みの行の中身が並び（外した鍵なしとして読む）", "mode": "shared", "settings": [],
     "rows": [R(1, "外した組み込み", "dashoff", "ID", login="p1", body="[1]")], "steps": [S(BOSS, "GET")], "delegates": [W(S(PART, "GET")), W(H(PART, {"scope": "me", "keys": ["standard"]})), W(S(PART, "GET"))]},
    {"name": "★標準の付け替え（同じ組だけ）", "mode": "shared", "settings": [],
     "rows": [R(1, "A", "dash", "ID", login="p1", std="1", body=GOOD), R(2, "B", "dash", "ID", login="p1", std="1", rev=4, body=GOOD),
              R(3, "C", "dashset", "ID", login="p1", std="1", body='{"items": ["1"]}'), R(4, "D", "dash", "共通", std="1", body=GOOD)],
     "steps": [S(PART, "GET"), S(PART, "PUT", 1, {"name": "A2"}), S(PART, "GET"),
               S(PART, "POST", body=P("G", L(Pn()), standard=True)), S(PART, "GET")], "delegates": []},
    {"name": "切断中", "mode": "shared", "rows": ROWS, "settings": [], "revoked": True, "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body=P("切断中", L(Pn()))), S(BOSS, "PUT", 4, {"name": "x"}), S(BOSS, "DELETE", 4),
        H(BOSS, {"scope": "me", "keys": ["standard"]}),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": [], "settings": [], "steps": [
        S(BOSS, "GET"), S(BOSS, "POST", body=P("手元", L(Pn()))), H(BOSS, {"scope": "me", "keys": ["standard"]}), S(BOSS, "GET"),
    ], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": ROWS, "settings": [], "steps": [
        S(PART, "POST", body=P("写し", L(Pn()))), H(PART, {"scope": "me", "keys": ["standard"]}),
    ], "delegates": []},
    {"name": "写しだけで最初に読む（版 3.105.0 から窓も Python も読むだけで共有に最初の版を作る）", "mode": "mirror", "rows": ROWS, "settings": [], "steps": [],
     "delegates": [W(S(PART, "GET"))]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": ROWS, "settings": [], "lock": True,
     "steps": [S(PART, "POST", body=P("錠", L(Pn()))), S(PART, "PUT", 3, {"name": "x"}), S(PART, "DELETE", 3), H(PART, {"scope": "me", "keys": ["standard"]}),
               S(PART, "GET")], "delegates": []},
    *[{"name": f"置き場の行の中身が {what}（行を隔てて答える）", "mode": "shared", "rows": [R(1, "良い行", "dash", "共通", body=GOOD), bad],
       "settings": [], "steps": [], "delegates": [W(x) for x in [S(PART, "GET"), S(PART, "POST", body=P("a", L(Pn()))), S(PART, "PUT", 2, {"name": "直す"}),
                                                                S(PART, "DELETE", 2), S(PART, "GET")]]}
      for what, bad in [("NaN", R(2, "x", "dash", "共通", body='{"rows": NaN}')), ("名前が数", R(2, 5, "dash", "共通", body=GOOD))]],
    {"name": "共有のファイルの版 revision が読めない（写しで続け、書く道は断る）", "mode": "shared", "rows": ROWS, "settings": [], "rev": "abc", "steps": [],
     "delegates": [W(S(PART, "GET")), W(S(PART, "POST", body=P("a", L(Pn())))), W(S(PART, "PUT", 3, {"name": "x"})), W(S(PART, "DELETE", 3))]},
]
# 版 3.109.0（H3）: 大きな整数のファイル・中身の字も窓が桁のまま読んで答える（前は Place::split_file・row_check::wide_content で任せた。カード・ダッシュボードとセットの食い違いも消えた）
SCENARIOS += [
    {"name": f"置き場の{what}が i64 に入らない整数（窓も桁のまま読む）", "mode": "shared", "rows": rows, "settings": settings, "steps": [],
      # 前の版の条件のマスタは一覧の道（GET）だけが読む（測って分かった: 書く道は窓が答える）
      "delegates": [W(x) for x in (S(PART, "GET"), S(PART, "POST", body=P("a", L(Pn()))), S(PART, "PUT", 3, {"name": "x"}), S(PART, "DELETE", 3), S(PART, "GET"))]}
    for what, rows, settings in [
        ("dashboards.json の知らない鍵", ROWS + [dict(R(20, "x", "dash", "共通", body=GOOD), x=10 ** 20)], []),
        ("ダッシュボードの行の中身の字", ROWS + [R(20, "x", "dash", "共通", body='{"rows": 8, "panels": [], "n": 100000000000000000000}')], []),
        ("前の版の条件のマスタの知らない鍵", ROWS, [{"id": 1, "キー": "wip", "条件": "{}", "x": 10 ** 20}]),
        ("前の版の条件のマスタの条件の字", ROWS, [{"id": 1, "キー": "wip", "条件": '{"a": 100000000000000000000}'}]),
        ("ダッシュボードの行のパネルの w・条件の値", ROWS + [R(20, "x", "dash", "共通", body='{"rows": 18446744073709551615, "panels": [{"id": "a", "x": 0, "y": 0, "w": 10000000000000000000, "h": 2, "visual": "bar", "source": "work", "title": 9223372036854775807, "cond": {"x": [18446744073709551616]}}]}')], [])]]
FILE_NAME = "dashboards"
SETTINGS = "dashboard_settings"


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    files = [("access_permissions", PERM), (FILE_NAME, sc["rows"])] + ([(SETTINGS, sc["settings"])] if "settings" in sc else [])
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
