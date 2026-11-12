# -*- coding: utf-8 -*-
"""利用状況・使用の履歴・画面の設定の控えの「正しい答え」を出す係（版 3.71.0。順 5 の 3 段目。desktop/tests/presence_parity.rs が呼ぶ）。

    python tests/presence_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（心拍 POST /api/heartbeat・routes/access.py の利用状況の 7 本・
/api/ui-state）で歩みの並びを当てる。時計は 1 歩ごとに決めた時刻に差し替える（presence の datetime・time・now_iso）。
心拍の裏の糸（touch_async）はその場で走らせる（窓の試験も同じ順: 書く → 最新版の数え直し → 答え）。
窓の試験は rs に同じ並びを窓の道（src/presence.rs）で当て、1 歩ごとの答えと、終わった後のファイル（中身と字下げ）を突き合わせる。
    {"version": 書く版, "scenarios": [{"name", "py": 置き場, "rs": 置き場, "conf": 窓へ渡す {who, place},
        "steps": [{"op", "t", "who": [login, pc], "key", "method", "path", "query", "body", "status", "json"}],
        "files": {"相対の道": {"text": Python が残した字, "canon": 字下げをそろえて鍵を並べた字（読めなければ null）}}}]}
歩みの種類: beat（心拍）・route（道）・leave（使い終わり）・file（ほかの PC が書いた物を置く。text が null なら消す）・
want（配る版を作業場所に覚える）・move（利用状況の置き場を移す〈共有が無い置き場へも〉）
"""
import json
import logging
import os
import shutil
import sys
import threading
import types
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)            # Python が自分で決める道（窓の me を使わない）の答え
os.environ.pop("TPA_SHELL_SERVES", None)     # Python が心拍で書く形（窓が受け持つ前の Python）

import app_env  # noqa: E402
from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity, presence  # noqa: E402

VERSION = "3.70.0"
T0 = datetime(2026, 10, 1, 8, 0, 0)
EPOCH = datetime(1970, 1, 1)
BOSS, M2, U1, OP = ("boss", "PC-1"), ("m2", "PC-2"), ("u1", "PC-9"), ("op", "PC-4")


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有"},
        {"id": 2, "ログインID": "m2", "PC名": "", "権限区分": "メンテナンス者", "マスタ編集": "編集可", "有効": "有"},
        {"id": 3, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "有効": "有"},
        {"id": 4, "ログインID": "op", "PC名": "", "権限区分": "設備作業者", "マスタ編集": "非表示", "有効": "有"},
        {"id": 5, "ログインID": "dev2", "PC名": "", "権限区分": "開発者", "有効": "有"}]


def at(sec=0.0, days=0):
    return (T0 + timedelta(days=days, seconds=sec)).isoformat()


def iso(sec=0.0, days=0):
    return (T0 + timedelta(days=days, seconds=sec)).isoformat(timespec="seconds")


def B(t, who=U1):
    return {"op": "beat", "t": t, "who": list(who)}


def R(t, who, method, path, body=None, query=""):
    return {"op": "route", "t": t, "who": list(who), "method": method, "path": path, "query": query,
            "body": body if isinstance(body, str) or body is None else j(body)}


def F(t, path, data):
    return {"op": "file", "t": t, "path": path, "text": data if isinstance(data, str) or data is None else j(data)}


def online(key, login, pc, ver, sec, role="一般ユーザー"):
    return {"key": key, "login": login, "pc": pc, "role": role, "version": ver, "since": iso(sec), "at": iso(sec)}


def hist(key, login, pc, ver, last, **kw):
    return {"key": key, "login": login, "pc": pc, "firstAt": iso(0, -40), "sessions": 3, "totalSec": 1200,
            "versions": {ver: last}, "lastAt": last, "version": ver, **kw}


SCENARIOS = [
    {"name": "使い始めと続き・書く間隔・履歴の間隔・TTL の境", "steps": [
        B(at(0)), B(at(3)), B(at(21)), B(at(61)), B(at(61.5)), B(at(140)), B(at(165)), B(at(215.0)), B(at(290.0)), B(at(310)),
        B(at(385.999)), B(at(461)),
        R(at(470), BOSS, "GET", "/api/presence"),
        R(at(470), BOSS, "GET", "/api/presence/sessions"),
        R(at(470), BOSS, "GET", "/api/presence/sessions", query="limit=1"),
        R(at(470), BOSS, "GET", "/api/presence/sessions", query="limit=abc&key=PC-9@u1"),
        R(at(470), BOSS, "GET", "/api/presence/sessions", query="limit=0&key=%20PC-9@u1%20"),
        R(at(470), BOSS, "GET", "/api/presence/sessions", query="key=nobody"),
        R(at(470), BOSS, "GET", "/api/presence/sessions", query="limit=5000"),
        R(at(470), OP, "GET", "/api/presence"),
        R(at(470), OP, "GET", "/api/presence/sessions"),
        R(at(550), M2, "GET", "/api/presence"),
    ]},
    {"name": "最新版: 開発者を数えない・配る版・新しすぎる版", "steps": [
        F(at(0), "history/PC-2@m2.json", hist("PC-2@m2", "m2", "PC-2", "3.69.0", iso(-100))),
        F(at(0), "history/PC-7@dev2.json", hist("PC-7@dev2", "dev2", "PC-7", "3.99.0", iso(-100))),
        F(at(0), "PC-8@op.json", online("PC-8@op", "op", "PC-8", "3.68.5", 0, "設備作業者")),
        B(at(1)), B(at(30)),
        R(at(40), M2, "GET", "/api/presence"),
        {"op": "want", "t": at(50), "version": " 3.71.0 "},
        B(at(60)), B(at(305)),
        R(at(310), M2, "GET", "/api/presence"),
        {"op": "want", "t": at(320), "version": "3.60.0"},
        B(at(610)),
        R(at(615), U1, "GET", "/api/presence"),
        R(at(615), M2, "GET", "/api/presence"),
        {"op": "want", "t": at(620), "version": None},
        F(at(620), "history/PC-2@m2.json", hist("PC-2@m2", "m2", "PC-2", "3.100.0", iso(600))),
        B(at(915), BOSS), B(at(940), BOSS),
        R(at(945), M2, "GET", "/api/presence"),
    ]},
    {"name": "切断・解く・消す・権限・残す日数", "steps": [
        F(at(0), "PC-9@u1.json", online("PC-9@u1", "u1", "PC-9", VERSION, 0)),
        F(at(0), "history/PC-9@u1.json", hist("PC-9@u1", "u1", "PC-9", VERSION, iso(0))),
        F(at(0), "history/PC-4@op.json", hist("PC-4@op", "op", "PC-4", "3.60.0", iso(-5000))),
        F(at(0), "PC-1@dev2.json", online("PC-1@dev2", "dev2", "PC-1", VERSION, 0, "開発者")),
        B(at(1), BOSS),
        R(at(5), BOSS, "POST", "/api/presence/disconnect", {"key": " PC-9@u1 ", "reason": "点検" * 150}),
        R(at(5), BOSS, "GET", "/api/presence"),
        R(at(6), U1, "GET", "/api/presence"),
        R(at(6), BOSS, "POST", "/api/presence/disconnect", {"key": "PC-1@boss"}),
        R(at(6), BOSS, "POST", "/api/presence/disconnect", {"key": "nobody"}),
        R(at(6), BOSS, "POST", "/api/presence/disconnect", {"key": "PC-4@op"}),
        R(at(6), M2, "POST", "/api/presence/disconnect", {"key": "PC-1@dev2"}),
        R(at(6), M2, "POST", "/api/presence/disconnect", {"key": "PC-9@u1", "reason": 12}),
        R(at(6), U1, "POST", "/api/presence/disconnect", {"key": "PC-1@boss"}),
        R(at(7), BOSS, "POST", "/api/presence/forget", {"key": "PC-9@u1"}),
        R(at(7), U1, "POST", "/api/presence/forget", {"key": "PC-4@op"}),
        R(at(7), M2, "POST", "/api/presence/forget", {"key": "PC-4@op"}),
        R(at(7), M2, "POST", "/api/presence/forget", {"key": "PC-4@op"}),
        F(at(7), "history/PC-5@q.json", hist("PC-5@q", "q", "PC-5", "3.60.0", iso(-5000))),
        F(at(7), "sessions/PC-5@q/2026-09.json", {"key": "PC-5@q", "login": "q", "pc": "PC-5", "sessions": [{"start": "2026-09-30T08:00:00"}]}),
        F(at(7), "PC-5@q.revoke.json", {"key": "PC-5@q", "by": "boss", "at": iso(0)}),
        R(at(7), BOSS, "GET", "/api/presence"),
        R(at(7), M2, "POST", "/api/presence/forget", {"key": "PC-5@q"}),
        R(at(8), U1, "POST", "/api/presence/allow", {"key": "PC-9@u1"}),
        R(at(8), BOSS, "POST", "/api/presence/allow", {"key": "PC-9@u1"}),
        R(at(8), BOSS, "POST", "/api/presence/allow", {"key": "PC-9@u1"}),
        R(at(9), BOSS, "POST", "/api/presence/disconnect", {"key": "PC-9@u1", "reason": " 再点検 "}),
        R(at(320), BOSS, "GET", "/api/presence"),
        R(at(330), U1, "POST", "/api/presence/retention", {"days": 100}),
        R(at(330), BOSS, "POST", "/api/presence/retention", {"days": "abc"}),
        R(at(330), BOSS, "POST", "/api/presence/retention", {"days": 10}),
        R(at(330), BOSS, "POST", "/api/presence/retention", {"days": 400.0}),
        R(at(330), BOSS, "POST", "/api/presence/retention", {}),
        R(at(330), BOSS, "POST", "/api/presence/retention", {"days": " 400 "}),
        R(at(331), BOSS, "GET", "/api/presence/sessions"),
        R(at(331), U1, "POST", "/api/presence/prune"),
    ]},
    {"name": "月またぎ・残す日数での整理（自分の分・全部）・読めない月", "steps": [
        F(at(0), "settings.json", {"historyDays": 30, "by": "x"}),
        F(at(0), "sessions/PC-9@u1/2026-07.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": [{"start": "2026-07-03T08:00:00", "end": "2026-07-03T09:00:00", "sec": 3600, "version": "3.60.0"}]}),
        F(at(0), "sessions/PC-9@u1/2026-09.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": [{"start": "2026-09-30T08:00:00", "end": "2026-09-30T09:00:00", "sec": 3600, "version": "3.69.0"}]}),
        F(at(0), "sessions/PC-9@u1/2026-10.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": [
            {"start": "2026-10-01T08:00:00", "end": "2026-10-01T09:00:00", "sec": 3600, "version": "3.69.0"},
            {"start": "2026-10-02T08:00:00", "end": "2026-10-02T09:00:00", "sec": 3600, "version": "3.69.5", "role": "一般ユーザー"}]}),
        F(at(0), "sessions/PC-2@m2/2026-06.json", {"key": "PC-2@m2", "login": "m2", "pc": "PC-2", "sessions": [{"start": "2026-06-01T08:00:00", "end": "2026-06-01T09:00:00"}, {"start": "2026-06-02T08:00:00"}]}),
        F(at(0), "sessions/PC-2@m2/2026-05.json", "{bad"),
        F(at(0), "sessions/PC-2@m2/notes.json", {"x": 1}),
        F(at(0), "sessions/PC-2@m2/2026-10.json", {"key": "PC-2@m2", "login": "m2", "pc": "PC-2", "sessions": [{"start": "2026-10-03T08:00:00", "end": "2026-10-03T10:00:00", "version": "3.70.0"}]}),
        B(at(57590, 30)),
        B(at(57610, 30)), B(at(57690, 30)), B(at(57710, 30)),
        R(at(57720, 30), BOSS, "GET", "/api/presence/sessions"),
        R(at(57720, 30), BOSS, "GET", "/api/presence/sessions", query="limit=2"),
        R(at(57720, 30), BOSS, "POST", "/api/presence/prune"),
        R(at(57720, 30), BOSS, "GET", "/api/presence/sessions"),
        F(at(57730, 30), "settings.json", {"historyDays": "x"}),
        R(at(57730, 30), BOSS, "GET", "/api/presence/sessions", query="limit=5"),
        F(at(57730, 30), "settings.json", {"historyDays": 99999}),
        R(at(57730, 30), BOSS, "POST", "/api/presence/prune"),
    ]},
    # 版 3.104.0 の作った後の採点: 月の名前の年が datetime の外（i64 に入らない数・10000 年）。Python の _month_after は datetime で例外になる:
    # 心拍の _prune_own は touch の糸を例外で終える（利用状況の履歴を書かない）・prune_all は 500（窓は答えず Python に任せる。delegate）
    {"name": "月の名前の年が datetime の外（Python は例外）", "steps": [
        F(at(0), "sessions/PC-9@u1/99999999999999999999-12.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": []}),
        B(at(10)),
        R(at(20), BOSS, "GET", "/api/presence/sessions"),
        dict(R(at(30), BOSS, "POST", "/api/presence/prune"), delegate=True),
        F(at(40), "sessions/PC-9@u1/99999999999999999999-12.json", None),
        F(at(40), "sessions/PC-9@u1/9999-12.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": []}),
        dict(R(at(50), BOSS, "POST", "/api/presence/prune"), delegate=True),
        F(at(60), "sessions/PC-9@u1/9999-12.json", None),
        R(at(70), BOSS, "POST", "/api/presence/prune"),
    ]},
    {"name": "読めないファイル・鍵の正しくない記録・掃除", "steps": [
        F(at(0), "PC-3@x.json", "{bad"),
        F(at(0), "PC-4@y.json", online("PC-4@y", "y", "PC-4", "3.1.0", -1000)),
        F(at(0), "PC-5@z.revoke.json", {"key": "PC-5@z", "by": "a", "at": iso(-2000)}),
        F(at(0), "PC-6@w.revoke.json", {"key": "PC-6@w", "by": "a", "at": iso(-1000)}),
        F(at(0), "history/evil.json", {"key": "../..", "login": "e", "pc": "E", "version": "9.9.9"}),
        F(at(0), "history/empty.json", {}),
        F(at(0), "x y.json", online("../..", "e", "E", "9.9.9", 0)),
        F(at(0), "PC-6@w.json", online("PC-6@w", "w", "PC-6", "3.2.0", -74)),
        F(at(0), "PC-7@v.json", online("PC-7@v", "v", "PC-7", "3.2.0", 30)),
        B(at(1), BOSS),
        R(at(2), BOSS, "GET", "/api/presence"),
        R(at(2), BOSS, "POST", "/api/presence/forget", {"key": "../.."}),
        R(at(2), BOSS, "GET", "/api/presence/sessions", query="key=../.."),
        R(at(2), BOSS, "POST", "/api/presence/disconnect", {"key": "PC-6@w"}),
        R(at(2), BOSS, "GET", "/api/presence"),
    ]},
    {"name": "共有が無い置き場（書かない）", "steps": [
        {"op": "move", "t": at(0), "to": "gone/presence_tpa"},
        B(at(1)), B(at(30)),
        R(at(31), BOSS, "GET", "/api/presence"),
        R(at(31), BOSS, "POST", "/api/presence/retention", {"days": 100}),
        R(at(31), BOSS, "POST", "/api/presence/disconnect", {"key": "PC-9@u1"}),
        R(at(31), BOSS, "GET", "/api/presence/sessions"),
        R(at(31), BOSS, "POST", "/api/presence/prune"),
        {"op": "move", "t": at(40), "to": "share/presence_tpa"},
        B(at(41)),
        R(at(42), BOSS, "GET", "/api/presence"),
    ]},
    {"name": "使い終わり（いまのファイルを消し、記録を最後まで書く）", "steps": [
        B(at(0)), B(at(25)), B(at(40)),
        {"op": "leave", "t": at(44), "who": list(U1)},
        {"op": "leave", "t": at(45), "who": list(U1)},
        R(at(46), BOSS, "GET", "/api/presence"),
        B(at(50)),
        R(at(51), BOSS, "GET", "/api/presence/sessions"),
    ]},
    {"name": "記録の値の形が違う（途中でやめる）", "steps": [
        F(at(0), "history/PC-9@u1.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": "x", "lastAt": iso(-10)}),
        B(at(0)),
        F(at(25), "history/PC-9@u1.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": " 4 ", "totalSec": 2.9, "versions": {"3.1.0": iso(-99)}, "lastAt": 5}),
        B(at(25)),
        F(at(50), "history/PC-9@u1.json", {"key": "PC-9@u1", "login": "u1", "pc": "PC-9", "sessions": True, "totalSec": "7", "versions": {f"3.{i}.0": iso(-200 + i) for i in range(12)}, "lastAt": iso(40)}),
        B(at(100)),
        R(at(101), BOSS, "GET", "/api/presence"),
    ]},
    {"name": "画面の設定の控え（ui-state）", "steps": [
        R(at(0), U1, "GET", "/api/ui-state"),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": {"tpa.a": "1", "tpa.b": "日本", "other": "x", "tpa.n": 5}}),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": {}, "removed": ["tpa.a", "other", 3]}),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": ["tpa.a"]}),
        R(at(0), U1, "POST", "/api/ui-state", {"removed": []}),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": {}, "removed": {"tpa.b": 1}}),
        R(at(0), U1, "POST", "/api/ui-state", ""),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": {"tpa.big": "a" * (4 * 1024 * 1024 - 34)}}),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": {"tpa.big": "a" * (4 * 1024 * 1024 - 33)}}),
        R(at(0), U1, "POST", "/api/ui-state", {"changed": {"tpa.big": "x"}, "removed": None}),
        R(at(0), U1, "GET", "/api/ui-state"),
        {"op": "file", "t": at(1), "path": "@local/ui_state.json", "text": j({"rev": "7", "keys": {"tpa.k": "v", "tpa.n": 1, "x": "y"}})},
        R(at(1), U1, "GET", "/api/ui-state"),
        R(at(1), U1, "POST", "/api/ui-state", {"changed": {"tpa.z": "1"}}),
        {"op": "file", "t": at(2), "path": "@local/ui_state.json", "text": "{bad"},
        R(at(2), U1, "GET", "/api/ui-state"),
        R(at(2), U1, "POST", "/api/ui-state", {"changed": {"tpa.z": "2"}}),
        {"op": "file", "t": at(3), "path": "@local/ui_state.json", "text": j({"rev": "x", "keys": {"tpa.k": "v"}})},
        R(at(3), U1, "GET", "/api/ui-state"),
    ]},
]


def place(root):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    (share / "access_permissions.json").write_text(j(doc(PERM)), encoding="utf-8")
    (share / "tab_access.json").write_text(j(doc([])), encoding="utf-8")


def store_of(root):
    return MasterStore(root / "app", local_root=root / "local", settings={"refresh_seconds": 0, "dir": str(root / "share")})


def target(root, rel):
    """file の道: 「@local/…」は作業場所、ほかは利用状況の置き場（presence_tpa）の中"""
    return root / "local" / rel[len("@local/"):] if rel.startswith("@local/") else Path(presence.presence_dir()) / rel


def snapshot(root):
    """終わった後のファイル（利用状況の置き場〈移した先も〉と画面の控え）→ {相対の道: {text, canon}}"""
    out = {}
    paths = [p for d in ("share/presence_tpa", "gone") for p in (root / d).rglob("*") if p.is_file()]
    paths += [p for p in [root / "local" / "ui_state.json"] if p.exists()]
    for p in sorted(paths):
        rel = p.relative_to(root).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        try:
            indent = 0 if rel.endswith("ui_state.json") else 1
            canon = json.dumps(json.loads(text), ensure_ascii=False, indent=indent, sort_keys=True) + "\n"
        except ValueError:
            canon = None
        out[rel] = {"text": text, "canon": canon}
    return out


class _Now:
    t = T0


class FakeDT(datetime):
    @classmethod
    def now(cls, tz=None):
        return _Now.t


class _SyncThread:
    """裏の糸をその場で走らせる（答えの前に書き終える。窓の試験も同じ順）"""

    def __init__(self, target=None, name=None, daemon=None):
        self._target = target

    def start(self):
        self._target()


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    import app.routes as routes
    from app.routes.lotlist import _access_place
    from app.web import Request, _app_var, _request_var
    who = {"login": "", "pc": ""}
    local = {"root": None}
    patches = [mock.patch.object(identity, "current_login_id", lambda: who["login"]),
               mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": who["pc"], "source": "試験", "tried": []}),
               mock.patch.object(presence, "datetime", FakeDT),
               mock.patch.object(presence, "time", types.SimpleNamespace(time=lambda: (_Now.t - EPOCH).total_seconds())),
               mock.patch.object(presence, "now_iso", lambda: _Now.t.isoformat(timespec="seconds")),
               mock.patch.object(presence, "APP_VERSION", VERSION),
               mock.patch.object(presence, "threading", types.SimpleNamespace(Thread=_SyncThread, Lock=threading.Lock)),
               mock.patch.object(app_env, "local_root", lambda: local["root"] / "local")]
    for p in patches:
        p.start()
    initial = dict(presence._state)
    out = []
    try:
        for i, sc in enumerate(SCENARIOS):
            py, rs = base / f"s{i}" / "py", base / f"s{i}" / "rs"
            place(py)
            place(rs)
            local["root"] = py
            presence._state.clear()
            presence._state.update(initial)
            app = create_app({"TESTING": True, "MASTER_STORE": store_of(py)})
            client = app.test_client()
            rs_app = create_app({"TESTING": True, "MASTER_STORE": store_of(rs)})
            t1, t2 = _app_var.set(rs_app), _request_var.set(Request("GET", "/api/lotlist/settings"))
            try:
                conf = _access_place()
            finally:
                _request_var.reset(t2)
                _app_var.reset(t1)
            presence.configure(py / "share" / presence.SUBDIR)       # 2 つ目の create_app が rs に向けたので戻す
            steps = []
            for st in sc["steps"]:
                _Now.t = datetime.fromisoformat(st["t"])
                op = st["op"]
                if "who" in st:
                    who.update(login=st["who"][0], pc=st["who"][1])
                    st = {**st, "key": presence.terminal_key(*st["who"])}
                routes._REVOKE_CACHE.update(at=-1e18, key="")
                if op == "file":
                    p = target(py, st["path"])
                    if st["text"] is None:
                        p.unlink(missing_ok=True)
                    else:
                        p.parent.mkdir(parents=True, exist_ok=True)
                        p.write_text(st["text"], encoding="utf-8")
                elif op == "want":
                    w = py / "local" / "want.json"
                    if st["version"] is None:
                        w.unlink(missing_ok=True)
                    else:
                        w.write_text(j({"version": st["version"]}), encoding="utf-8")
                elif op == "move":
                    presence.configure(py / st["to"])
                elif op == "leave":
                    presence.leave(*st["who"])
                else:
                    method, path = ("POST", "/api/heartbeat") if op == "beat" else (st["method"], st["path"])
                    url = path + (f"?{st['query']}" if st.get("query") else "")
                    ctype = "text/plain" if path == "/api/ui-state" else "application/json"
                    try:
                        r = client.open(url, method=method, data=(st.get("body") or "").encode("utf-8"), content_type=ctype)
                    except Exception as e:         # 道の外で落ちた（本番は 500）。窓は答えず Python に任せる歩（delegate）だけ
                        assert st.get("delegate"), f"{sc['name']}: {method} {path} が落ちた: {e!r}"
                        st = {**st, "status": 500, "json": None}
                        steps.append(st)
                        continue
                    try:
                        body = r.get_json()
                    except Exception:
                        body = None
                    st = {**st, "status": r.status_code, "json": body}
                steps.append(st)
            out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "conf": conf, "steps": steps, "files": snapshot(py)})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"version": VERSION, "scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
