# -*- coding: utf-8 -*-
"""「参照…」の 2 本（POST /api/fs/browse・GET /api/fs/places）の「正しい答え」を出す係（版 3.101.0。desktop/tests/fs_parity.rs が呼ぶ）。

    python tests/fs_oracle.py 作業フォルダ
    python tests/fs_oracle.py --tables         … 字の整え（tidy）・区切り（crumbs）の事例の表（POSIX と Windows の決まりの両方）

1 つのフォルダの木（自然な並びの名前・隠し・記号リンク・目的ごとの印・400 を超える数・読めないフォルダ）に Python の道
（routes/settings.py の門番 _browse_gate を含む）で問い合わせの並びを当てる。窓の試験は同じフォルダに同じ並びを窓の道
（src/folder_browse.rs の handle）で当て、答え（状態・本文。断る言葉も 1 字まで）を突き合わせる。読むだけの道なので、同じフォルダを 1 つ使う。
よく使う場所のこのアプリの場所（appPaths）は、Python の道が設定から組んだ物を窓の試験へ渡す（窓が設定から組むのは Lot::fs_route）。
窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
"""
import json
import logging
import ntpath
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import folder_browse, identity, presence  # noqa: E402

BOSS, VIEW, CUT = ("boss", "PC-1"), ("v1", "PC-3"), ("c1", "PC-4")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有", "rev": 1},
        {"id": 4, "ログインID": "c1", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}]
BR, PLC = "/api/fs/browse", "/api/fs/places"
CAN_LINK = True
POSIX = os.name != "nt"


def j(x):
    return json.dumps(x, ensure_ascii=False)


def S(who, method, path, body=None, query="", **kw):
    return {"who": list(who), "method": method, "path": path, "query": query,
            "body": body if isinstance(body, str) or body is None else j(body), **kw}


def B(path, purpose=None, pattern=None, who=BOSS, **kw):
    b = {"path": path}
    if purpose is not None:
        b["purpose"] = purpose
    if pattern is not None:
        b["pattern"] = pattern
    return S(who, "POST", BR, b, **kw)


def touch(p: Path, text="x"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def setup(r: Path):
    t = r / "tree"
    for n in ("v10", "v9", "V2", "a", "B", "3.10.0", "3.9.0", "a b", "字のフォルダ", "$RECYCLE.BIN", "System Volume Information", ".git"):
        (t / n).mkdir(parents=True, exist_ok=True)
    for n in ("x.sqlite3", "y.DB", "z.sqlite", "m.exe", "notes.txt", ".hidden.db", "~$lock.db", "file10.db", "file9.db"):
        touch(t / n)
    touch(t / "master" / "equipment_master.json", "{}")
    touch(t / "release" / "3.9.0" / "release.json", "{}")
    touch(t / "release_deep" / "a" / "b" / "release.json", "{}")
    for n in ("実績_CR1.sqlite3", "実績_ .sqlite3", "実績_X.sqlite3-journal", "実績_Z.SQLITE3", ".実績_H.sqlite3"):
        touch(t / "wl" / n)
    (t / "wl" / "実績_D.sqlite3").mkdir()
    touch(t / "db" / "a.sqlite3")
    touch(t / "db" / "b.db")
    touch(t / "db" / ".c.db")
    touch(t / "exe" / "msedge.EXE")
    many = t / "many"
    for i in range(430):
        (many / f"d{i}").mkdir(parents=True)
    for i in range(130):
        touch(many / f"d{i}" / "equipment_master.json", "{}")
    global CAN_LINK
    try:          # Windows の CI は記号リンクを作れないことがある（その歩は流さない）
        os.symlink(t / "a", t / "link_dir", target_is_directory=True)
        os.symlink(t / "x.sqlite3", t / "link_file.sqlite3")
        os.symlink(r / "無い", t / "broken.db")
    except (OSError, NotImplementedError):
        CAN_LINK = False
    (t / "locked").mkdir()
    touch(t / "locked" / "in.txt")
    if os.name != "nt":
        os.chmod(t / "locked", 0)     # root でない利用者（CI）では読めないフォルダ
    (r / "q").mkdir()
    (r / "share").mkdir()
    (r / "wl2").mkdir()
    # 時刻をそろえる（分までの字。窓と Python が同じフォルダを読むので同じだが、分の境で割れないように）
    ts = datetime(2026, 1, 2, 3, 4, 5).timestamp()
    for p in sorted(t.rglob("*"), key=lambda p: -len(p.parts)):
        if p.is_symlink() or p == t / "locked" or (t / "locked") in p.parents:
            continue
        os.utime(p, (ts, ts))


def steps():
    return [
        B(""),
        B("rel/x"),
        B("@ROOT/tree"),
        B("@ROOT/tree", "folder"),
        B("@ROOT/tree", "sqlite"),
        B("@ROOT/tree", "exe"),
        B("@ROOT/tree", "master"),
        B("@ROOT/tree", "release"),
        B("@ROOT/tree", "worklog", "実績_*.sqlite3"),
        B("@ROOT/tree", "worklog", "決まりに星が無い"),
        B("@ROOT/tree", "worklog"),
        B("@ROOT/tree", "知らない目的"),
        B("@ROOT/tree/many", "master"),
        B("@ROOT/tree/wl", "worklog", "実績_*.sqlite3"),
        B("@ROOT/tree/db", "sqlite"),
        B("@ROOT/tree/exe", "exe"),
        B("@ROOT/tree/無い/もっと"),
        B("@ROOT/tree/x.sqlite3", "sqlite"),
        *([B("@ROOT/tree/link_file.sqlite3", "sqlite"), B("@ROOT/tree/link_dir")] if CAN_LINK else []),
        B("@ROOT/tree/../tree/./a/"),
        B("@ROOT//tree///B"),
        B(" \"@ROOT/tree/\" "),
        B(" '@ROOT/tree/V2' "),
        B("file://@ROOT/tree/a%20b"),
        B("file://localhost@ROOT/tree/%E5%AD%97%E3%81%AE%E3%83%95%E3%82%A9%E3%83%AB%E3%83%80"),
        B("FILE://@ROOT/tree?q#f"),
        # 共有の道・ドライブの根・/ は POSIX だけ（Windows では本物の共有へ尋ねて時間が割れる・C:\ の中を読む）
        *([B("file://srv/share/d"), B("C:"), B("\\\\srv\\share\\d"), B("/")] if POSIX else []),
        B("@ROOT/tree/locked"),
        B("@ROOT/tree/locked/in.txt"),
        S(BOSS, "POST", BR, {"path": 123}),
        S(BOSS, "POST", BR, {"path": "@ROOT/tree/db", "purpose": None, "pattern": 0}),
        S(BOSS, "POST", BR, ""),
        B("@ROOT/tree", who=VIEW),
        B("@ROOT/tree", who=CUT, revoke=True),
        S(BOSS, "GET", PLC),
        S(VIEW, "GET", PLC),
    ]


def delegates():
    return [
        S(BOSS, "POST", BR, {"path": ["@ROOT/tree"]}),
        S(BOSS, "POST", BR, "[1]"),
        B("@ROOT/tree", query="engine=python"),
        B("~nobody/x"),
        B("file://[::1]/x"),
    ]


TIDY = ["C:\\a\\..\\b", "C:/a//b/", "c:", "C:", "C:\\", "C:..\\x", "C:a\\..\\..", "\\\\srv\\share\\c\\..\\d", "\\\\srv\\share", "\\\\srv",
        "\\\\srv\\share\\..\\..", "//srv/share/x/", "/tmp/x/../y", "//tmp/x", "///tmp/x/", "/", "//", "a/../..", ".", "./a/", "\\x\\..\\y",
        "D:\\データ\\検査\\", "Z:\\.\\a\\.\\b\\."]


def tables():
    """字の整え（tidy）と区切り（crumbs）の事例（Windows の決まりは os.name を nt にして）"""
    out = []
    for win in (False, True):
        for s in TIDY:
            with mock.patch.object(folder_browse.os, "name", "nt" if win else "posix"):
                t = folder_browse.tidy(s)
            if win:
                from pathlib import PureWindowsPath as PP
            else:
                from pathlib import PurePosixPath as PP
            with mock.patch.object(folder_browse, "Path", PP):
                c = folder_browse.crumbs(t)
            out.append({"text": s, "win": win, "tidy": t, "crumbs": c})
    return out


def main():
    logging.disable(logging.WARNING)
    if sys.argv[1] == "--tables":
        sys.stdout.write(json.dumps({"tidy": tables(), "ntpath": [[s, ntpath.normpath(s)] for s in TIDY]}, ensure_ascii=False))
        return
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    root = base / "fs"
    (root / "app" / "data").mkdir(parents=True)
    (root / "local").mkdir(parents=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    (root / "app" / "data" / "access_permissions.json").write_text(j(PERM), encoding="utf-8")
    (root / "local" / "master_share.json").write_text(j({"dir": str(root / "share"), "history": [
        {"dir": str(root / "old_place"), "until": "2026-01-01T00:00:00"}, {"dir": "", "until": ""}]}), encoding="utf-8")
    setup(root)
    import app.routes as routes
    import app.routes.settings as settings_routes
    from app.routes.common import forget_tab_cache
    from app.routes.lotlist import _access_place
    from app.web import Request, _app_var, _request_var
    who = {"login": BOSS[0], "pc": BOSS[1]}
    eff = {"lot_list": {"source": str(root / "q" / "lot.sqlite3")}, "work_log": {"folder": f"{root / 'wl2'};{root / 'tree' / 'wl'}"},
           "update": {"source": str(root / "rel")}}
    patches = [mock.patch.object(identity, "current_login_id", lambda: who["login"]),
               mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": who["pc"], "source": "試験", "tried": []}),
               mock.patch.object(settings_routes, "effective_settings", lambda app: eff)]
    for p in patches:
        p.start()
    try:
        st = MasterStore(root / "app", local_root=root / "local", settings={"refresh_seconds": 0})
        app = create_app({"TESTING": True, "MASTER_STORE": st})
        t1, t2 = _app_var.set(app), _request_var.set(Request("GET", "/api/lotlist/settings"))
        try:
            conf = _access_place()
        finally:
            _request_var.reset(t2)
            _app_var.reset(t1)
        app_paths = [["master", "マスタの置き場", str(st.share_dir or "")],
                     ["quality", "品質データのフォルダ", folder_browse.parent_of(eff["lot_list"]["source"])],
                     ["worklog", "作業実績のフォルダ", eff["work_log"]["folder"]],
                     ["release", "配布の置き場", eff["update"]["source"]]]
        app_paths += [["oldmaster", "前のマスタの置き場", h.get("dir") or ""] for h in st.history()]
        pdir = root / "local" / "presence"
        out, dele = [], []
        for s in steps() + [dict(x, delegate=True) for x in delegates()]:
            presence.configure(pdir)
            if s.get("revoke"):
                pdir.mkdir(parents=True, exist_ok=True)
                (pdir / f"{presence.terminal_key(*CUT)}{presence.REVOKE_SUFFIX}").write_text(
                    j({"by": "boss", "byPc": "PC-1", "reason": "点検", "at": datetime.now().isoformat(timespec="seconds")}), encoding="utf-8")
            who.update(login=s["who"][0], pc=s["who"][1])
            routes._REVOKE_CACHE.update(at=0.0, key="")
            forget_tab_cache()
            path = s["path"] + (f"?{s['query']}" if s["query"] else "")
            body = (s["body"] or "").replace("@ROOT", json.dumps(str(root), ensure_ascii=False)[1:-1])
            try:
                r = app.test_client().open(path, method=s["method"], data=body.encode("utf-8"), content_type="application/json")
                rec = {**s, "status": r.status_code, "json": r.get_json()}
            except Exception as e:      # 道の外で落ちた（本番は 500 で答える）
                rec = {**s, "status": 500, "json": {"error": f"{type(e).__name__}: {e}"}}
            if s.get("revoke"):
                (pdir / f"{presence.terminal_key(*CUT)}{presence.REVOKE_SUFFIX}").unlink()
            (dele if s.get("delegate") else out).append(rec)
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"root": str(root), "conf": conf, "appPaths": app_paths, "steps": out, "delegates": dele,
                                 "rootUser": hasattr(os, "geteuid") and os.geteuid() == 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
