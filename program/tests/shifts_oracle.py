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
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

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
        # 作った後の採点で見つけた形（版 3.75.0）: 消す・直す道の本文が表でない（Python は base_rev で落ちて 500・書かない）
        S(BOSS, "DELETE", f"{P}/11", "[1]", query="rev=1"),
        S(BOSS, "DELETE", f"{P}/11", '"x"'),
        S(BOSS, "PUT", f"{P}/11", "[1]"),
        S(BOSS, "GET", P),
    ]},
    {"name": "id の無い行（一意の確かめは id のある行とだけ比べる。版 3.77.0）", "mode": "shared",
     "shifts": [{"名称": "無id", "区分": "[]"}, {"id": 2, "名称": "有id", "区分": "[]", "rev": 1}], "steps": [
        S(BOSS, "POST", P, {"name": "無id", "segments": THREE}),
        S(BOSS, "PUT", f"{P}/2", {"name": "無id"}),
        S(BOSS, "GET", P),
    ]},
    {"name": "真偽の id（int(True) は 1。版 3.77.0）", "mode": "shared", "shifts": [{"id": True, "名称": "真", "区分": "[]"}], "steps": [
        S(BOSS, "POST", P, {"name": "次の id", "segments": THREE}),
        S(BOSS, "GET", P),
    ]},
    # 版 3.107.0（E3）: 読めない行は隔てて答える（一覧は skipped・触れる直す・消すは断る・足すは通す。前は id が字で 500・版で英語の 400）
    {"name": "置き場の行の版が読めない（行を隔てて答える）", "mode": "shared",
     "shifts": [{"id": 1, "名称": "a", "区分": "[]", "rev": "x"}], "steps": [], "delegates": [W(x) for x in [
         S(BOSS, "GET", P), S(BOSS, "POST", P, {"name": "新", "segments": THREE}), S(BOSS, "PUT", f"{P}/1", {"note": "x"}),
         S(BOSS, "DELETE", f"{P}/1", query="rev=1"), S(BOSS, "PUT", f"{P}/2", {"note": "足した行は直せる"})]]},
    {"name": "置き場の行の id が大きな数・字（行を隔てて答える。次の id は隔てた行も数える）", "mode": "shared",
     "shifts": [{"id": 1e19, "名称": "a", "区分": "[]"}, {"id": "3", "名称": "b", "区分": "[]"}], "steps": [], "delegates": [W(x) for x in [
         S(BOSS, "GET", P), S(BOSS, "POST", P, {"name": "新", "segments": THREE}), S(BOSS, "PUT", f"{P}/1", {"note": "x"}),
         S(BOSS, "DELETE", f"{P}/1", query="rev=1"), S(BOSS, "PUT", f"{P}/3", {"note": "x"}), S(BOSS, "DELETE", f"{P}/3")]]},
    {"name": "置き場の行の名称が並び（行を隔てて答える。名前の重なりは隔てた行も見る）", "mode": "shared",
     "shifts": [{"id": 1, "名称": ["x"], "区分": "[]"}, {"id": 2, "名称": "y", "備考": {"a": 1}, "区分": "[]"}], "steps": [],
     "delegates": [W(S(BOSS, "POST", P, {"name": "['x']", "segments": THREE})), W(S(BOSS, "GET", P)),
                   W(S(BOSS, "POST", P, {"name": "z", "segments": THREE})), W(S(BOSS, "DELETE", f"{P}/2"))]},
    {"name": "置き場の区分の字が NaN（行を隔てて答える）", "mode": "shared",
     "shifts": [{"id": 1, "名称": "a", "区分": '[{"name": "1直", "start": NaN}]'}, {"id": 2, "名称": "b", "区分": "[]"}], "steps": [
         S(BOSS, "GET", P), S(BOSS, "PUT", f"{P}/1", {"note": "x"}), S(BOSS, "PUT", f"{P}/2", {"note": "y"}), S(BOSS, "GET", P)], "delegates": []},
    # 版 3.102.0 の作った後の採点の割れ 1: 表でない行は、一覧では飛ばして badRows で言い、書く道は断る（行もファイルも消さない）。前は窓が Python に任せた
    {"name": "置き場に表でない行（一覧は読める行と badRows・書く道は断る）", "mode": "shared",
     "shifts": ["壊れた行", {"id": 7, "名称": "読める行", "区分": "[]", "rev": 1}, 5], "steps": [
        S(BOSS, "GET", P),
        S(BOSS, "POST", P, {"name": "新", "segments": THREE}),
        S(BOSS, "POST", P, {"name": "", "segments": THREE}),
        S(BOSS, "PUT", f"{P}/7", {"note": "x"}),
        S(BOSS, "DELETE", f"{P}/7", query="rev=1"),
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
    {"name": "共有にまだ無い・読むだけ（版 3.105.0: 窓も Python も読むときに最初の版を置く。終わった後の共有のファイルを比べる）", "mode": "mirror", "shifts": OLD[:1], "steps": [S(BOSS, "GET", P)]},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "shifts": OLD[:1], "steps": [
        # 版 3.105.0（作った後の採点の割れ）: 共有にまだ無いマスタを最初に読む歩。Python も窓も読むときに最初の版を置く（置いたファイルも比べる）
        S(BOSS, "GET", P),
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
            pd = base / f"s{i}" / "pd"      # Python に任せる歩（版 3.77.0）は別の写しに当てる（突き合わせるファイルに混ぜない）
            place(pd, sc)
            clients = {False: client, True: create_app({"TESTING": True, "MASTER_STORE": store_of(pd, sc)}).test_client()}
            steps, dele = [], []
            for st in oracle_gate.seq(sc["steps"], sc.get("delegates", [])):
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
