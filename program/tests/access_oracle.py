# -*- coding: utf-8 -*-
"""アクセス権限の「正しい答え」を出す係（版 3.65.0。デスクトップ版の窓 desktop/src/access.rs との突き合わせ。
desktop/tests/access_parity.rs が呼ぶ）。

    python tests/access_oracle.py [--keep 置き場]     … --keep: 組ごとの置き場をそこに作って残す（窓の試験が同じファイルを読む）

一時フォルダに共有フォルダ・同梱の data/・写し・利用状況の置き場を作り、組ごとに権限のマスタ（access_permissions）・タブの権限
（tab_access）・切断の指示・名乗りを置いて、Python の道（routes/common.me・routes/access._access_guard）で答える:
  行の当たり方 … 両方・ログインIDだけ・PC名だけ・両方空・止めた行・NFKC と大文字と前後の空白・数のログインID・管理する人が居ない／居る
  区分と段     … 4 つの区分 × 段（上限で頭打ち・知らない字）
  タブ        … 区分の決まり（知らない区分・形の違うキー・区切り・後の行が勝つ）・人ごとの例外（字・表・壊れた字・JSON の並び・null）
  切断        … 効いている（理由あり・なし・だれか空）・冷却が切れた・時刻が読めない・壊れたファイル・時差つきの時刻
  置き場      … 共有のファイル・共有が壊れていて写し・共有に無く写し・手元だけ（data/）・BOM・読めない写し（Python は me を決められない）
  門番        … 11 の道（現場・管理）× 書く・読む・除外 3 つ
    {"cases": [{"name", "conf": 窓へ渡す {who, place}, "now": いま, "me": Python の me（決められなければ null）,
                "guards": [{"method", "path", "status", "body"}]}]}
"""
import json
import logging
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)            # Python が自分で決める道（窓の me を使わない）の答え

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity, presence  # noqa: E402
from app.web import Request, _app_var, _request_var  # noqa: E402

NOW = datetime(2026, 11, 3, 10, 0, 0, 250000)
PATHS = [("POST", "/api/masters/equipment"), ("PUT", "/api/masters/rolls/3"), ("POST", "/api/masters/access"),
         ("DELETE", "/api/masters/access/2"), ("PUT", "/api/settings/lot_list"), ("POST", "/api/masters/worklog"),
         ("PUT", "/api/masters/formats/1"), ("POST", "/api/masters/shifts"), ("POST", "/api/masters/equipgroups"),
         ("PUT", "/api/masters/conversions/x"), ("POST", "/api/sources"), ("PUT", "/api/masters/tabaccess"),
         ("GET", "/api/masters/access"), ("HEAD", "/api/sources"), ("OPTIONS", "/api/masters/rolls"),
         ("POST", "/api/settings/check"), ("POST", "/api/sources/check"), ("POST", "/api/sources/q1/conn/check"),
         ("POST", "/api/sources/q1/conn/save"), ("DELETE", "/api/sources/check"), ("PUT", "/api/settings/check"),
         ("DELETE", "/api/sources/q1/conn/check"), ("PATCH", "/api/masters/access/2"), ("POST", "/api/lotlist/refresh"), ("POST", "/api/presence/beat")]

ADMIN = {"ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可"}
TAB_RULES = [{"タブ": "work", "出さない区分": "一般ユーザー・設備作業者"}, {"タブ": "dash", "出さない区分": "設備作業者、 メンテナンス者"},
             {"タブ": "wip", "出さない区分": "一般ユーザー　設備作業者"}, {"タブ": "BAD", "出さない区分": "一般ユーザー"},
             {"タブ": "sch", "出さない区分": "開発者・だれか"}, {"タブ": " calc ", "出さない区分": "一般ユーザー"},
             {"タブ": "wip", "出さない区分": "設備作業者"}]


class FixedNow(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW


def cases():
    """(名前, 権限の行, タブの行, 名乗り, 切断の指示〈None・字・表〉, 置き場の形)"""
    full = [{"id": 1, **ADMIN}]
    out = [
        ("管理する人が居ない", [], [], ("u1", "PC-1"), None, "shared"),
        ("同梱の初めの形（手元だけ）", None, None, ("u1", "PC-1"), None, "local"),
        ("登録の無い人（管理する人が居る）", full, TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("両方が当たる行が勝つ", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "メンテナンス者", "マスタ編集": "部分的編集可"},
                                 {"id": 3, "ログインID": "ｕ１ ", "PC名": " pc-1", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ"},
                                 {"id": 4, "ログインID": "", "PC名": "PC-1", "権限区分": "設備作業者"}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("止めた行は数えない", full + [{"id": 3, "ログインID": "u1", "PC名": "PC-1", "権限区分": "設備作業者", "有効": " 無 "},
                                {"id": 5, "ログインID": "", "PC名": "pc-1", "権限区分": "メンテナンス者", "マスタ編集": "編集可", "rev": 7}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("両方空の行・同じ段は後の行", [{"id": 1, "ログインID": "", "PC名": "", "権限区分": "一般ユーザー"},
                               {"id": 2, "ログインID": "", "PC名": "", "権限区分": "設備作業者", "マスタ編集": "編集可"}],
         TAB_RULES, ("zz", "PC-9"), None, "shared"),
        ("数のログインID・知らない字", [{"id": 1, "ログインID": 1234, "PC名": None, "権限区分": "社長", "マスタ編集": "なんでも", "有効": 0},
                                {"id": 2, **ADMIN}], TAB_RULES, ("1234", "PC-1"), None, "shared"),
        ("開発者はいつも全部のタブ", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "開発者",
                                      "タブの例外": json.dumps({"lot": "出さない"})}], TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（字）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー",
                                "タブの例外": json.dumps({"work": "出す", "lot": "出さない", "X": "出さない", "sch": "見る"}, ensure_ascii=False)}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（表）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "設備作業者",
                                "タブの例外": {"dash": "出す", "calc": "出さない"}}], TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（壊れた字）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "タブの例外": "{work"}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（並びの JSON。Python はタブを読めず出す）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー",
                                                          "タブの例外": "[1, 2]"}], TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（null と空の並び）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "タブの例外": "null"},
                                       {"id": 3, "ログインID": "u2", "PC名": "", "権限区分": "一般ユーザー", "タブの例外": "[]"}],
         TAB_RULES, ("u2", "PC-1"), None, "shared"),
        ("切断されている（理由あり）", full, [], ("u1", "PC-1"),
         {"by": "boss", "byPc": "PC-0", "reason": "点検のため", "at": (NOW - timedelta(seconds=100.5)).isoformat(timespec="seconds")}, "shared"),
        ("切断されている（だれか空・理由なし）", full, [], ("u1", "PC-1"),
         {"by": "", "reason": "", "at": (NOW - timedelta(seconds=299)).isoformat()}, "shared"),
        ("切断の冷却が切れた", full, [], ("u1", "PC-1"), {"by": "boss", "at": (NOW - timedelta(seconds=301)).isoformat(timespec="seconds")}, "shared"),
        ("切断の時刻が読めない", full, [], ("u1", "PC-1"), {"by": "boss", "at": "きのう"}, "shared"),
        ("切断の時刻に時差", full, [], ("u1", "PC-1"), {"by": "boss", "at": "2026-11-03T09:59:00+09:00"}, "shared"),
        ("切断のファイルが壊れている", full, [], ("u1", "PC-1"), "{broken", "shared"),
        ("開発者は切断されても書けない", [{"id": 1, **ADMIN}], [], ("boss", "PC-1"),
         {"by": "other", "at": (NOW - timedelta(seconds=5)).isoformat(timespec="seconds")}, "shared"),
        ("名前に区切りのある PC", full, TAB_RULES, ("dom\\u1", "PC 1"), {"by": "boss", "at": (NOW - timedelta(seconds=10)).isoformat()}, "shared"),
        ("共有が壊れていて写しで読む", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "メンテナンス者"}], TAB_RULES,
         ("u1", "PC-1"), None, "broken-share"),
        ("共有に無く写しで読む", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "設備作業者"}], TAB_RULES,
         ("u1", "PC-1"), None, "mirror-only"),
        ("手元だけ（data/）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "メンテナンス者", "マスタ編集": "閲覧のみ"}],
         TAB_RULES, ("u1", "PC-1"), None, "local"),
        ("BOM つきの共有", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可"}],
         TAB_RULES, ("u1", "PC-1"), None, "bom"),
        ("タブの権限が壊れている", full, "broken", ("u1", "PC-1"), None, "shared"),
        ("読めない写し（me を決められない）", full, TAB_RULES, ("u1", "PC-1"), None, "broken-all"),
        ("ログインIDだけの行が PC名だけの行に勝つ（前後どちらでも）", full + [{"id": 2, "ログインID": "", "PC名": "PC-1", "権限区分": "設備作業者"},
                                                         {"id": 3, "ログインID": "u1", "PC名": "", "権限区分": "メンテナンス者"},
                                                         {"id": 4, "ログインID": "", "PC名": "PC-1", "権限区分": "設備作業者"}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("PC名だけの行が両方空の行に勝つ", [{"id": 1, "ログインID": "", "PC名": "PC-1", "権限区分": "メンテナンス者"},
                                     {"id": 2, "ログインID": "", "PC名": "", "権限区分": "設備作業者"}], TAB_RULES, ("u9", "PC-1"), None, "shared"),
        ("一般ユーザーだけ（管理する人は居ない）", [{"id": 1, "ログインID": "x", "PC名": "", "権限区分": "一般ユーザー"},
                                         {"id": 2, "ログインID": "y", "PC名": "", "権限区分": "設備作業者"}], TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("止めた管理者は数えない", [{"id": 1, **ADMIN, "有効": "無"}], TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("メンテナンス者が居る", [{"id": 1, "ログインID": "m", "PC名": "", "権限区分": "メンテナンス者"}], TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（JSON の NaN・Infinity・大きな数）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー",
                                                       "タブの例外": '{"work": "出す", "x": NaN, "y": Infinity, "z": -Infinity, "w": 1e999}'},
                                                      {"id": 3, "ログインID": "u2", "PC名": "", "権限区分": "一般ユーザー", "タブの例外": "NaN"},
                                                      {"id": 4, "ログインID": "u3", "PC名": "", "権限区分": "一般ユーザー", "タブの例外": "1e999"}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（対の無いサロゲート）", full + [{"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー",
                                              "タブの例外": '{"lot": "出さない", "work": "出す", "n": "\\ud800", "m": "\\udc00x\\ud83d\\ude00"}'}],
         TAB_RULES, ("u1", "PC-1"), None, "shared"),
        ("大きな数のログインID・区分の前後の空白", full + [{"id": 2, "ログインID": 12345678901234567890, "PC名": "", "権限区分": " メンテナンス者　",
                                                  "マスタ編集": " 閲覧のみ "}], TAB_RULES, ("12345678901234567890", "PC-1"), None, "shared"),
        ("タブのキーは 16 字まで", full, [{"タブ": "a" * 16, "出さない区分": "一般ユーザー"}, {"タブ": "b" * 17, "出さない区分": "一般ユーザー"},
                                     {"タブ": "x1", "出さない区分": "一般ユーザー"}, {"タブ": "1x", "出さない区分": "一般ユーザー"}],
         ("u1", "PC-1"), None, "shared"),
        ("人ごとの例外（字が NaN）", full + [{"id": 3, "ログインID": "u2", "PC名": "", "権限区分": "一般ユーザー", "タブの例外": "NaN"}],
         TAB_RULES, ("u2", "PC-1"), None, "shared"),
        ("人ごとの例外（字が 1e999・文字列の中の NaN）", full + [{"id": 4, "ログインID": "u3", "PC名": "", "権限区分": "一般ユーザー",
                                                      "タブの例外": '{"lot": "出さない", "m": "NaN Infinity"}'}],
         TAB_RULES, ("u3", "PC-1"), None, "shared"),
    ]
    return out


def doc(rows):
    return {"schema": 1, "revision": 3, "updated_at": "", "updated_by": {}, "rows": rows}


def place_files(root, share, rows, tabs, mode):
    data, cache = root / "app" / "data", root / "local" / "master_cache"
    cache.mkdir(parents=True, exist_ok=True)
    for name, body in (("access_permissions", rows), ("tab_access", tabs)):
        for p in (share / f"{name}.json", cache / f"{name}.json", data / f"{name}.json"):
            p.unlink(missing_ok=True)
        if body is None:
            shutil.copy(PROGRAM / "data" / f"{name}.json", data / f"{name}.json") if (PROGRAM / "data" / f"{name}.json").exists() else None
            continue
        if body == "broken":
            (share / f"{name}.json").write_text("{", encoding="utf-8")
            continue
        text = json.dumps(doc(body), ensure_ascii=False)
        if mode == "local":
            (data / f"{name}.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        elif mode == "broken-share":
            (share / f"{name}.json").write_text("{\"rows\": [", encoding="utf-8")
            (cache / f"{name}.json").write_text(text, encoding="utf-8")
        elif mode == "mirror-only":
            (cache / f"{name}.json").write_text(text, encoding="utf-8")
        elif mode == "broken-all":
            (share / f"{name}.json").write_text("{", encoding="utf-8")
            (cache / f"{name}.json").write_text("[", encoding="utf-8")
        else:
            (share / f"{name}.json").write_bytes(("﻿" if mode == "bom" else "").encode("utf-8") + text.encode("utf-8"))


AT_FORMS = ["2026-11-03T09:58:00", "2026-11-03 09:58", "2026-11-03T09", "2026-11-03T0958", "20261103T095800", "20261103 095800.5",
            "2026-11-03T09:58:00,5", "2026-11-03T09:58:00.1234567", "2026-11-03X09:58", "2026-11-03　09:58", "2026-W45-2T09:58",
            "2026W452T0958", "2026-W45-2", "2026W45", "2026-W45", "2026-11-03", "20261103", "2026-11-03T9:58", "2026-11-03T09:5",
            "2026-11-03T09:5800", "2026-11-03T24:00:00", "2026-11-03T09:58:00Z", "2026-11-03T09:58:00+09:00", "2026-11-03T09:58:00-",
            "2026-11-3", "2026-13-03T09:00", "2026-11-03T09:58:60", "2026-11-03T09:58:00.", "2026-11-03T09:58:00.5x", "きのう", "",
            "2026-11-03T09:55:00.250000", "2026-11-03T09:55:00.249999",
            "2026-11-03T09.5", "2026-11-03T09:58.5", "2026-11-03T0958,5", "2026-11-03T0958.5", "2026-11-03T09,25", "2026-11-03T09.",
            "2026-11-03T09:58.", "2026-11-03T09:58:00.5.5", "2026-11-03T09:55:00", "2026-11-03T10:00:30", "2026W4"]


def revocations(folder):
    """切断の指示のファイルの読み方の組（時刻の書き方・ファイルの形・冷却の境・鍵の形）→ presence.revocation の答え"""
    Path(folder).mkdir(parents=True, exist_ok=True)
    presence.configure(folder)
    raw = [(f"at {a!r}", "k", json.dumps({"by": "boss", "reason": "r", "at": a}, ensure_ascii=False).encode("utf-8")) for a in AT_FORMS]
    raw += [("BOM 付き", "k", "\ufeff".encode("utf-8") + json.dumps({"by": "b", "at": "2026-11-03T09:58:00"}).encode("utf-8")),
            ("at が数", "k", b'{"by": "b", "at": 20261103}'), ("at が null", "k", b'{"by": "b", "at": null}'), ("at が無い", "k", b'{"by": "b"}'),
            ("by が null", "k", b'{"by": null, "byPc": 3, "at": "2026-11-03T09:58:00"}'), ("JSON の NaN", "k", b'{"by": "b", "x": NaN, "y": -Infinity, "at": "2026-11-03T09:58:00"}'),
            ("at が NaN", "k", b'{"at": NaN}'), ("並び", "k", b'[1, 2]'), ("空の表", "k", b'{}'), ("壊れた字", "k", b'{"at": '),
            ("utf-8 でない", "k", b'{"by": "\x82\xa0", "at": "2026-11-03T09:58:00"}'), ("空のファイル", "k", b''),
            ("鍵が .. を含む", "a..b", b'{"at": "2026-11-03T09:58:00"}'), ("鍵が点で始まる", ".k", b'{"at": "2026-11-03T09:58:00"}'),
            ("鍵に空白", "a b", b'{"at": "2026-11-03T09:58:00"}'), ("ファイルが無い", "none", None)]
    out = []
    with mock.patch.object(presence, "datetime", FixedNow):
        for i, (label, key, body) in enumerate(raw):
            k = f"{key}{i}" if key not in ("none",) else key
            if body is not None and presence.safe_key(k):
                (Path(folder) / f"{k}{presence.REVOKE_SUFFIX}").write_bytes(body)
            try:
                want = presence.revocation(k)
            except Exception:
                want = None              # 鍵の形が違う: me は切断なしとして続ける（routes/common.me）
            out.append({"label": label, "key": k, "want": want})
    return {"now": NOW.isoformat(), "cases": out}


def main():
    logging.disable(logging.WARNING)
    if "--revocations" in sys.argv:
        sys.stdout.write(json.dumps(revocations(sys.argv[sys.argv.index("--revocations") + 1]), ensure_ascii=False))
        return         # 壊れた共有を読む組の「写しで続けます」は答えの外
    keep = sys.argv[sys.argv.index("--keep") + 1] if "--keep" in sys.argv else ""   # 窓の試験が同じ置き場を読む（片付けは窓の試験）
    tmp = Path(keep) if keep else Path(tempfile.mkdtemp(prefix="access-oracle-"))
    try:
        out = run(tmp)
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def run(tmp):
    import app.routes as routes
    from app.routes.access import _access_guard
    from app.routes.common import me
    from app.routes.lotlist import _access_place
    who = {"login": "", "pc": ""}
    patches = [mock.patch.object(identity, "current_login_id", lambda: who["login"]),
               mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": who["pc"], "source": "試験", "tried": []}),
               mock.patch.object(presence, "datetime", FixedNow)]
    for p in patches:
        p.start()
    try:
        out = []
        for name, rows, tabs, (login, pc), revoke, mode in cases():
            root = tmp / f"c{len(out)}"
            share = root / "share"
            share.mkdir(parents=True)
            shutil.copytree(PROGRAM / "data", root / "app" / "data", ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
            place_files(root, share, rows, tabs, mode)
            settings = {"refresh_seconds": 0, **({} if mode == "local" else {"dir": str(share)})}
            store = MasterStore(root / "app", local_root=root / "local", settings=settings)
            app = create_app({"TESTING": True, "MASTER_STORE": store})
            pdir = root / "presence"
            pdir.mkdir()
            presence.configure(pdir)
            who.update(login=login, pc=pc)
            routes._REVOKE_CACHE.update(at=0.0, key="")
            key = presence.terminal_key(login, pc)
            if revoke is not None:
                (pdir / f"{key}{presence.REVOKE_SUFFIX}").write_text(revoke if isinstance(revoke, str) else json.dumps(revoke, ensure_ascii=False),
                                                                    encoding="utf-8")
            t1, t2 = _app_var.set(app), _request_var.set(Request("GET", "/api/access/me"))
            try:
                conf = _access_place()
                try:
                    m = me()
                except Exception:
                    m = None
                guards = []
                for method, path in PATHS:
                    routes._REVOKE_CACHE.update(at=0.0, key="")
                    tr = _request_var.set(Request(method, path))
                    try:
                        r = _access_guard()
                    finally:
                        _request_var.reset(tr)
                    if r is None:
                        guards.append({"method": method, "path": path, "status": None, "body": None})
                    else:
                        resp, status = r
                        guards.append({"method": method, "path": path, "status": status, "body": resp.get_json()})
            finally:
                _request_var.reset(t2)
                _app_var.reset(t1)
            if mode == "bom":     # Python が読んで作った写しを消す（窓が共有の BOM 付きのファイルそのものを読むことを確かめる）
                for n in ("access_permissions", "tab_access"):
                    (root / "local" / "master_cache" / f"{n}.json").unlink(missing_ok=True)
            out.append({"name": name, "conf": conf, "now": NOW.isoformat(), "me": m, "guards": guards})
        return {"cases": out}
    finally:
        for p in patches:
            p.stop()


if __name__ == "__main__":
    main()
