# -*- coding: utf-8 -*-
"""マスタの置き場の 4 本（GET /api/masters/status・GET /api/masters/place・POST /api/masters/place/check・move）の
「正しい答え」を出す係（版 3.101.0。desktop/tests/place_parity.rs が呼ぶ）。

    python tests/place_oracle.py 作業フォルダ
    python tests/place_oracle.py --status 場面のフォルダ      … その置き場で MasterStore.status を 1 回（種まきの競い合いの場面）

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/masters.py・settings.py。門番 _release_place_gate を含む）で
問い合わせの並びを当てる。道・本文の字の中の「@ROOT」は場面のフォルダ。窓の試験は rs に同じ並びを窓の道（src/master_place.rs の handle。
Lot と同じ順）で当て、答え（状態・本文。断る言葉も 1 字まで）と、終わった後のフォルダの中身（引っ越し先・前の置き場の印・この PC の覚え・写し）を
突き合わせる。歩の形: do（その場でフォルダを変える: rename・write・remove・chmod。窓の試験も同じ順で同じことをする）・delegate（窓は答えず
Python に任せる歩。Python の答えは比べない）。
共有のマスタは場面ごとに決まった中身で置く（種まきの時刻が場面ごとに違わないように）。種まき（共有にまだ無いマスタ）の要る status は
窓が Python に任せる（版 3.101.0 の主のセッションの決め）。
"""
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import SHARED_ALWAYS, MasterStore  # noqa: E402
from app.services import identity, presence  # noqa: E402

BOSS, MAINT, VIEW, CUT = ("boss", "PC-1"), ("m1", "PC-2"), ("v1", "PC-3"), ("c1", "PC-4")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 2, "ログインID": "m1", "PC名": "", "権限区分": "メンテナンス者", "マスタ編集": "部分的編集可", "有効": "有", "rev": 1},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有", "rev": 1},
        {"id": 4, "ログインID": "c1", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}]
NAMES = sorted({"roll_master", "equipment_master"} | SHARED_ALWAYS)
T = "2026-01-01T00:00:00"
ST, PL, CK, MV = "/api/masters/status", "/api/masters/place", "/api/masters/place/check", "/api/masters/place/move"


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=1):
    return {"schema": 1, "revision": rev, "updated_at": T, "updated_by": {"pc": "PC-0", "login": "u0"}, "rows": rows}


def rows_of(name):
    if name == "access_permissions":
        return PERM
    if name == "equipment_master":
        return [{"id": 1, "設備名": "CR1", "rev": 1}, {"id": 2, "設備名": "字の設備 ①", "rev": 2}]
    if name == "roll_master":
        return [{"id": 1, "設備": "CR1", "ロール名": "WR-1", "rev": 1}]
    return []


def S(who, method, path, body=None, query="", **kw):
    return {"who": list(who), "method": method, "path": path, "query": query,
            "body": body if isinstance(body, str) or body is None else j(body), **kw}


def A(parent, name):
    return {"parent": parent, "name": name}


def DO(op, **kw):
    return {"do": op, **kw}


def fill_share(share: Path, names=NAMES, beats=()):
    share.mkdir(parents=True, exist_ok=True)
    for n in names:
        (share / f"{n}.json").write_text(json.dumps(doc(rows_of(n)), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pres = share / presence.SUBDIR
    now = datetime.now().isoformat(timespec="seconds")
    for login, pc in beats:
        key = presence.terminal_key(login, pc)
        pres.mkdir(parents=True, exist_ok=True)
        (pres / f"{key}.json").write_text(j({"key": key, "pc": pc, "login": login, "at": now, "version": "3.101.0"}), encoding="utf-8")


def records(share: Path):
    """利用状況の記録と切断の指示（引っ越しで写す物）と、写さない物（心拍・一時ファイル・錠・印・マスタでない物）"""
    pres = share / presence.SUBDIR
    (pres / "history").mkdir(parents=True, exist_ok=True)
    (pres / "sessions" / "k" / ".hidden").mkdir(parents=True, exist_ok=True)
    (pres / "settings.json").write_text(j({"historyDays": 400}), encoding="utf-8")
    (pres / "history" / "PC-9@u.json").write_text(j({"key": "PC-9@u", "count": 3}), encoding="utf-8")
    (pres / "sessions" / "k" / "2026-11.json").write_text(j({"rows": []}), encoding="utf-8")
    (pres / "sessions" / "k" / ".hidden" / "x.json").write_text("{}", encoding="utf-8")
    (pres / "PC-9@u.revoke.json").write_text(j({"key": "PC-9@u", "by": "boss"}), encoding="utf-8")
    (pres / ".x.tmp").write_text("{", encoding="utf-8")
    (share / "other_master.json").write_text(j(doc([{"id": 1, "名前": "この PC が共有しないマスタ"}])), encoding="utf-8")
    (share / ".roll_master.json.0123.tmp").write_text("{", encoding="utf-8")
    (share / "メモ.txt").write_text("マスタではない", encoding="utf-8")


def setup_local(r: Path):
    (r / "app" / "data" / "access_permissions.json").write_text(j(PERM), encoding="utf-8")
    (r / "app" / "data" / "equipment_master.json").write_text(j(rows_of("equipment_master")), encoding="utf-8")
    (r / "nas").mkdir()
    (r / "file.txt").write_text("ファイル", encoding="utf-8")


def setup_shared(r: Path):
    fill_share(r / "share", beats=[BOSS, MAINT])
    records(r / "share")
    (r / "nas" / "occupied").mkdir(parents=True)
    (r / "nas" / "occupied" / "x.txt").write_text("x", encoding="utf-8")
    fill_share(r / "nas" / "Other", beats=[VIEW])
    (r / "nas" / "Other" / "_MOVED.json").write_text(j({"to": "/前の/古い印", "at": "2025-01-01T00:00:00"}), encoding="utf-8")
    (r / "nas" / "empty").mkdir()
    (r / "nas" / "afile").write_text("x", encoding="utf-8")
    (r / "share" / "sub").mkdir()
    old = r / "old_place"
    fill_share(old, names=["equipment_master"], beats=[CUT])
    (r / "local" / "master_share.json").write_text(j({"dir": str(r / "share"), "at": T, "by": {"pc": "PC-0", "login": "u0"},
                                                        "history": [{"dir": str(old), "until": T, "by": {}}, {"dir": "", "until": T}, "壊れた行"]}),
                                                     encoding="utf-8")
    (r / "local" / "want.json").write_text(j({"version": "3.101.0", "masters": {"dir": str(r / "share"), "setAt": T, "setBy": "boss"}}),
                                           encoding="utf-8")


def setup_lock(r: Path):
    fill_share(r / "share")
    (r / "nas").mkdir()
    now = datetime.now()
    (r / "share" / "master.lock.json").write_text(j({
        "token": "other", "holder_pc": "PC-9", "holder_login": "o", "holder_instance": "zz:py", "acquired_at": now.isoformat(timespec="seconds"),
        "expires_at": (now + timedelta(hours=1)).isoformat(timespec="seconds")}), encoding="utf-8")


def setup_empty(r: Path):
    (r / "share").mkdir()
    (r / "share" / "access_permissions.json").write_text(j(doc(PERM)), encoding="utf-8")


def scenarios():
    return [
        {"name": "手元のみ（状態・確かめる・門番・写して切り替える）", "setup": setup_local, "shared": False, "steps": [
            S(BOSS, "GET", ST),
            S(BOSS, "GET", PL),
            S(VIEW, "GET", PL),
            S(CUT, "GET", PL),
            S(BOSS, "POST", CK, A("@ROOT/nas", "")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "CON")),
            S(BOSS, "POST", CK, A("@ROOT/nas", ".隠し")),
            S(BOSS, "POST", CK, A("", "M")),
            # 空白だけ・ドライブだけ・共有の根は POSIX だけ（Windows は段の末尾の空白を削る〈窓は Python に任せる〉・C:\ に試しのフォルダを
            # 作る・本物の共有へ尋ねる）
            *([S(BOSS, "POST", CK, A("  \"  \"  ", "M")), S(BOSS, "POST", CK, A("C:", "M")), S(BOSS, "POST", CK, A("\\\\srv", "M"))]
              if os.name != "nt" else []),
            S(BOSS, "POST", CK, A("rel", "M")),
            S(BOSS, "POST", CK, A("@ROOT/無い", "M")),
            S(BOSS, "POST", CK, A("@ROOT/file.txt", "M")),
            S(BOSS, "POST", CK, A("@ROOT", "file.txt")),
            S(BOSS, "POST", CK, A(" \"@ROOT/nas/\" ", " M ")),
            S(BOSS, "POST", CK, {"parent": "@ROOT/nas", "name": 123}),
            S(BOSS, "POST", CK, {"parent": "@ROOT/nas", "name": None}),
            S(BOSS, "POST", CK, {"parent": "@ROOT/nas"}),
            S(BOSS, "POST", CK, ""),
            S(VIEW, "POST", MV, A("@ROOT/nas", "M")),
            S(CUT, "POST", MV, A("@ROOT/nas", "M"), revoke=True),
            S(BOSS, "POST", MV, A("@ROOT/nas", "")),
            S(BOSS, "POST", MV, A("@ROOT/nas", "M")),
        ], "delegates": [
            S(BOSS, "GET", ST, query="engine=python"),
            S(BOSS, "POST", CK, {"parent": ["@ROOT/nas"], "name": "M"}),
            S(BOSS, "POST", CK, "[1]"),
        ]},
        {"name": "共有（状態・使っている PC・確かめる・写して切り替える・既にある置き場へ切り替える）", "setup": setup_shared, "shared": True, "steps": [
            S(BOSS, "GET", ST),
            S(BOSS, "GET", PL),
            S(MAINT, "GET", PL),
            S(BOSS, "POST", CK, A("@ROOT", "share")),
            S(BOSS, "POST", CK, A("@ROOT/share", "sub")),
            S(BOSS, "POST", CK, A("@ROOT/share/sub", "x")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "occupied")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "afile")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "empty")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "Other")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "New")),
            S(BOSS, "POST", CK, A("@ROOT/nas", "OneDrive - 会社")),
            S(BOSS, "POST", MV, A("@ROOT/nas", "New")),
            S(BOSS, "GET", ST),
            S(BOSS, "GET", PL),
            S(BOSS, "POST", CK, A("@ROOT/nas", "New")),
            S(BOSS, "POST", MV, A("@ROOT/nas", "Other")),
            S(BOSS, "GET", ST),
            S(BOSS, "POST", MV, A("@ROOT", "share")),
            S(BOSS, "GET", PL),
        ]},
        {"name": "共有に届かない（写しから写す・届かないと分かれば reachable false）", "setup": setup_shared, "shared": True, "steps": [
            S(BOSS, "GET", ST),
            DO("rename", a="@ROOT/share", b="@ROOT/share_off"),
            S(BOSS, "GET", ST),
            S(BOSS, "GET", PL),
            S(BOSS, "POST", CK, A("@ROOT/nas", "FromMirror")),
            S(BOSS, "POST", MV, A("@ROOT/nas", "FromMirror")),
            # 写しから写した置き場には空のマスタが無い（_docs は行のある物・同梱の物だけ写す）。次の status は種まき＝Python の係なので、
            # 窓は答えない（an_empty_share_is_seeded_once_by_python と同じ形。ここでは歩に入れない）
        ]},
        {"name": "ほかの PC が保存中（錠）: 状態の錠・引っ越しは 409", "setup": setup_lock, "shared": True, "steps": [
            S(BOSS, "GET", ST),
            S(BOSS, "POST", MV, A("@ROOT/nas", "New")),
            DO("remove", path="@ROOT/share/master.lock.json"),
            S(BOSS, "GET", ST),
        ]},
        {"name": "空の共有（種まきは Python）", "setup": setup_empty, "shared": True, "steps": [], "delegates": [
            S(BOSS, "GET", ST),
            S(BOSS, "GET", PL),
        ]},
    ]


def place_masters(root: Path):
    for d in (root / "app" / "data", root / "local" / "master_cache"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")


def store_of(root: Path, shared: bool):
    cfg = {"refresh_seconds": 0, **({"dir": str(root / "share")} if shared else {})}
    return MasterStore(root / "app", local_root=root / "local", settings=cfg)


def sub(x, root):
    return x.replace("@ROOT", str(root))


def sub_json(x, root):
    return x.replace("@ROOT", json.dumps(str(root), ensure_ascii=False)[1:-1])


def listing(root: Path):
    """フォルダの中身（道 → 形）。.json は中身（読めれば）、ほかは字"""
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if rel == "app" or rel.startswith("app/"):
            continue
        if p.is_dir():
            out[rel] = {"type": "dir"}
            continue
        try:
            raw = p.read_bytes()
        except OSError:
            out[rel] = {"type": "file", "body": "<読めない>"}
            continue
        try:
            body = json.loads(raw.decode("utf-8-sig")) if p.suffix == ".json" else raw.decode("utf-8")
        except ValueError:
            body = raw.decode("utf-8", "replace")
        out[rel] = {"type": "file", "body": body}
    return out


def do(st, root):
    if st["do"] == "rename":
        os.rename(sub(st["a"], root), sub(st["b"], root))
    elif st["do"] == "remove":
        os.remove(sub(st["path"], root))


def one_status(folder):
    """--status: その場面のフォルダの置き場で MasterStore.status（種まきを含む）"""
    from app.services import master_place
    root = Path(folder)
    st = store_of(root, True)
    sys.stdout.write(json.dumps(master_place.status(st), ensure_ascii=False))


def main():
    logging.disable(logging.WARNING)
    if sys.argv[1] == "--status":
        one_status(sys.argv[2])
        return
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    from app.routes.lotlist import _access_place
    from app.web import Request, _app_var, _request_var
    who = {"login": BOSS[0], "pc": BOSS[1]}
    patches = [mock.patch.object(identity, "current_login_id", lambda: who["login"]),
               mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": who["pc"], "source": "試験", "tried": []})]
    for p in patches:
        p.start()
    out = []
    try:
        for i, sc in enumerate(scenarios()):
            roots = {k: base / f"s{i}" / k for k in ("py", "rs", "pd")}
            for r in roots.values():
                r.mkdir(parents=True)
                place_masters(r)
                sc["setup"](r)
            confs, apps = {}, {}
            who.update(login=BOSS[0], pc=BOSS[1])
            for k, r in roots.items():
                st = store_of(r, sc["shared"])
                apps[k] = create_app({"TESTING": True, "MASTER_STORE": st})
                t1, t2 = _app_var.set(apps[k]), _request_var.set(Request("GET", "/api/lotlist/settings"))
                try:
                    confs[k] = _access_place()
                finally:
                    _request_var.reset(t2)
                    _app_var.reset(t1)
                confs[k]["configured"] = str(st.configured_dir or "")
            steps, dele = [], []
            for st in list(sc["steps"]) + [dict(x, delegate=True) for x in sc.get("delegates", [])]:
                k = "pd" if st.get("delegate") else "py"
                root, app = roots[k], apps[k]
                if "do" in st:
                    do(st, root)
                    steps.append(st)
                    continue
                store = app.config["MASTER_STORE"]
                pdir = (store.share_dir / presence.SUBDIR) if store.share_dir else (root / "local" / "presence")
                presence.configure(pdir)
                if st.get("revoke"):
                    pdir.mkdir(parents=True, exist_ok=True)
                    key = presence.terminal_key(*CUT)
                    (pdir / f"{key}{presence.REVOKE_SUFFIX}").write_text(
                        j({"by": "boss", "byPc": "PC-1", "reason": "点検", "at": datetime.now().isoformat(timespec="seconds")}), encoding="utf-8")
                who.update(login=st["who"][0], pc=st["who"][1])
                routes._REVOKE_CACHE.update(at=0.0, key="")
                forget_tab_cache()
                path = st["path"] + (f"?{st['query']}" if st["query"] else "")
                body = sub_json(st["body"] or "", root)
                try:
                    r = app.test_client().open(path, method=st["method"], data=body.encode("utf-8"), content_type="application/json")
                    try:
                        js = r.get_json()
                    except Exception:
                        js = None
                    rec = {**st, "status": r.status_code, "json": js}
                except Exception as e:      # 道の外で落ちた（本番は 500 で答える）
                    rec = {**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}"}}
                if st.get("revoke"):
                    (pdir / f"{presence.terminal_key(*CUT)}{presence.REVOKE_SUFFIX}").unlink()
                    routes._REVOKE_CACHE.update(at=0.0, key="")
                (dele if st.get("delegate") else steps).append(rec)
            out.append({"name": sc["name"], "roots": {k: str(v) for k, v in roots.items()}, "conf": confs["rs"], "shared": sc["shared"],
                        "steps": steps, "delegates": dele, "files": listing(roots["py"])})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out, "root": hasattr(os, "geteuid") and os.geteuid() == 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
