# -*- coding: utf-8 -*-
"""設備・ロールのマスタの道の「正しい答え」を出す係（版 3.77.0。desktop/tests/equip_rows_parity.rs が呼ぶ）。

    python tests/equip_rows_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/masters.py。門番 _access_guard を含む）で問い合わせの並びを当てる。
窓の試験は rs に同じ並びを窓の道（desktop/src/equip_write.rs）で当て、答え（状態・本文）と、できたファイルを突き合わせる。
形は shifts_oracle.py と同じ。足して "delegates": 窓が答えず Python に任せる本文（窓が読めない・読みが割れる数・並び／表の値）の並び。
Python の答えも載せる（窓が答えたら食い違う形であることの記録）。steps の ctype は本文の Content-Type（既定 application/json）
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
EQ = [{"id": 1, "設備名": "CR1", "巻取方向": "上", "同一工程": "", "検査計": "有", "rev": 1},
      {"id": 2, "設備名": "ANF", "巻出し方向": "下", "同一工程": "ANI*, ANF2", "rev": 3},
      {"id": 4, "設備名": "CAL", "同一工程": "CA?", "検査計": ""},
      {"id": 5, "設備名": None, "同一工程": "ZZ"}]
ROLLS = [{"id": 1, "設備": "CR1", "入出位置": "入", "ロール径MAX": "500", "rev": 2}, {"id": 3, "設備": "L-1", "本数": 4}]
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


def S(who, method, path, body=None, query="", ctype="application/json"):
    return {"who": list(who), "method": method, "path": path, "query": query, "ctype": ctype,
            "body": body if isinstance(body, str) or body is None else j(body)}


E, R = "/api/masters/equipment", "/api/masters/rolls"
SCENARIOS = [
    {"name": "設備: 足す・必須・一意・同一工程の確かめ", "mode": "shared", "rows": {"equipment_master": EQ, "roll_master": ROLLS}, "steps": [
        S(BOSS, "GET", E),
        S(BOSS, "POST", E, {"設備名": " L-1 ", "巻取方向": "上", "同一工程": "L1、Ｌ１", "検査計": " 有 ", "updated_by": {"pc": "x"}, "rev": 9}),
        S(BOSS, "POST", E, {"設備名": "l-1"}),
        S(BOSS, "POST", E, {"設備名": None}),
        S(BOSS, "POST", E, {"設備名": "  "}),
        S(BOSS, "POST", E, {"巻取方向": "上"}),
        S(BOSS, "POST", E, {}),
        S(BOSS, "POST", E, {"設備名": 0, "同一工程": False, "検査計": True}),
        S(BOSS, "POST", E, {"設備名": "NEW", "同一工程": "CR1"}),
        S(BOSS, "POST", E, {"設備名": "NEW", "同一工程": "AN?"}),
        S(BOSS, "POST", E, {"設備名": "NEW", "同一工程": "anf2"}),
        S(BOSS, "POST", E, {"設備名": "ANI3"}),
        S(BOSS, "POST", E, {"設備名": "cai"}),
        S(BOSS, "POST", E, {"設備名": "ZZ"}),
        S(BOSS, "POST", E, {"設備名": "数", "巻取方向": 1.5, "ライン方向": 12, "同一工程": "Q*", "検査計": -0.0}),
        S(BOSS, "POST", E, {"設備名": "大きな小数", "巻取方向": 1e16, "ライン方向": 1e-05, "検査計": 100.0}),
        S(BOSS, "POST", E, {"設備名": "字の中の数", "同一工程": "-0 99999999999999999999 1e400"}),
        S(BOSS, "POST", E, "null"),
        S(BOSS, "POST", E, "[]"),
        S(BOSS, "POST", E, {"設備名": "text/plain で足す"}, ctype="text/plain"),
        S(BOSS, "GET", E),
    ], "delegates": [
        S(BOSS, "POST", E, {"設備名": "並び", "同一工程": ["A", "B"]}),
        S(BOSS, "POST", E, {"設備名": "表", "巻取方向": {"b": 1, "a": 2}}),
        W(S(BOSS, "POST", E, '{"設備名": "負の零", "ライン方向": -0}')),
        S(BOSS, "POST", E, '{"設備名": "大きな整数", "ライン方向": 100000000000000000000}'),
        S(BOSS, "POST", E, '{"設備名": "i64 の外", "ライン方向": 9223372036854775808}'),
        S(BOSS, "POST", E, '{"設備名": "NaN", "ライン方向": NaN}'),
        S(BOSS, "POST", E, '{"設備名": "1e400", "ライン方向": 1e400}'),
        S(BOSS, "POST", E, '{"設備名": "片割れ", "ライン方向": "\\ud800"}'),
        S(BOSS, "POST", E, ""),
        S(BOSS, "POST", E, "[1]"),
        W(S(BOSS, "PUT", f"{E}/1", '{"base_rev": -0}')),
        W(S(BOSS, "PUT", f"{E}/1", {"巻取方向": "x", "base_rev": "²"})),
    ]},
    {"name": "設備: 直す・消す・行の版・旧い列名", "mode": "shared", "rows": {"equipment_master": EQ, "roll_master": ROLLS}, "steps": [
        S(BOSS, "PUT", f"{E}/2", {"巻取方向": "上", "base_rev": 3}),
        S(BOSS, "PUT", f"{E}/2", {"巻取方向": "古い版", "base_rev": 3}),
        S(BOSS, "PUT", f"{E}/2", {"設備名": "ANF", "同一工程": "ANI*", "base_rev": "４"}),
        S(BOSS, "PUT", f"{E}/2", {"設備名": "CR1"}),
        S(BOSS, "PUT", f"{E}/2", {"設備名": None}),
        S(BOSS, "PUT", f"{E}/2", {"設備名": ""}),
        S(BOSS, "PUT", f"{E}/2", {"同一工程": "CAL"}),
        S(BOSS, "PUT", f"{E}/4", {"検査計": "有", "updated_at": "x"}),
        S(BOSS, "PUT", f"{E}/99", {"検査計": "有", "base_rev": 1}),
        S(BOSS, "PUT", f"{E}/99", {"検査計": "有"}),
        S(BOSS, "PUT", f"{E}/1", {"検査計": "text/plain の版", "base_rev": 7}, ctype="text/plain"),
        S(BOSS, "PUT", f"{E}/1", {"検査計": "text/plain", "base_rev": 1}, ctype="text/plain"),
        S(BOSS, "PUT", f"{E}/1", "[1]"),
        S(BOSS, "PUT", f"{E}/1", "[1]", ctype="text/plain"),
        S(BOSS, "PUT", f"{E}/1", "[]"),
        S(BOSS, "DELETE", f"{E}/1", "[1]", query="rev=2"),
        S(BOSS, "DELETE", f"{E}/1", '"x"', ctype="text/plain"),
        S(BOSS, "DELETE", f"{E}/4", query="rev=2"),
        S(BOSS, "DELETE", f"{E}/4", query="rev=1"),
        S(BOSS, "DELETE", f"{E}/4", query="rev=1"),
        S(BOSS, "DELETE", f"{E}/5"),
        S(BOSS, "DELETE", f"{E}/5"),
        S(BOSS, "DELETE", f"{E}/1", query="rev=x"),
        S(BOSS, "GET", E),
    ], "delegates": [
        S(BOSS, "DELETE", f"{E}/2", '{"base_rev": NaN}'),
        S(BOSS, "PUT", f"{E}/2", ""),
    ]},
    {"name": "ロール: 足す・直す・消す", "mode": "shared", "rows": {"equipment_master": EQ, "roll_master": ROLLS}, "steps": [
        S(BOSS, "GET", R),
        S(BOSS, "POST", R, {"設備": "CR1", "入出位置": "出", "ロール径MAX": 520, "ロール径MIN": 480.5, "本数": True, "備考": " メモ "}),
        S(BOSS, "POST", R, {"設備": "CR1", "入出位置": "出"}),
        S(BOSS, "POST", R, {"設備": None}),
        S(BOSS, "POST", R, {"入出位置": "入"}),
        S(BOSS, "PUT", f"{R}/1", {"ロール径MAX": "510", "base_rev": 2}),
        S(BOSS, "PUT", f"{R}/1", {"設備": " "}),
        S(BOSS, "PUT", f"{R}/3", {"本数": 6}),
        S(BOSS, "DELETE", f"{R}/3", query="rev=1"),
        S(BOSS, "DELETE", f"{R}/3", query="rev=2"),
        S(BOSS, "GET", R),
    ], "delegates": [
        S(BOSS, "POST", R, {"設備": "CR1", "本数": [1, 2.5]}),
        W(S(BOSS, "POST", R, '{"設備": "CR1", "本数": -0}')),
    ]},
    {"name": "id の無い行（一意と同一工程の確かめは id のある行とだけ比べる）", "mode": "shared",
     "rows": {"equipment_master": [{"設備名": "NOID", "同一工程": "NX*"}, {"id": 1, "設備名": "CR1", "rev": 1}],
              "roll_master": [{"設備": "CR1"}]}, "steps": [
        S(BOSS, "POST", E, {"設備名": "noid"}),
        S(BOSS, "POST", E, {"設備名": "NX1"}),
        S(BOSS, "PUT", f"{E}/1", {"設備名": "NOID"}),
        S(BOSS, "PUT", f"{E}/1", {"設備名": "NX2"}),
        S(BOSS, "POST", R, {"設備": "CR1"}),
        S(BOSS, "GET", E),
    ], "delegates": []},
    {"name": "置き場の行の項目が並び（窓は答えず Python に任せる）", "mode": "shared", "rows": {"equipment_master": [{"id": 1, "設備名": ["CR1"], "rev": 1}], "roll_master": [{"id": 1, "設備": "CR1", "備考": {"a": 1}}]}, "steps": [], "delegates": [
        S(BOSS, "GET", E), S(BOSS, "POST", E, {"設備名": "X"}), S(BOSS, "PUT", f"{E}/1", {"巻取方向": "上", "base_rev": 1}),
        S(BOSS, "DELETE", f"{E}/1"), S(BOSS, "GET", R), S(BOSS, "POST", R, {"設備": "X"}), S(BOSS, "PUT", f"{R}/1", {"本数": 1}),
        S(BOSS, "DELETE", f"{R}/1", query="rev=1"),
    ]},
    {"name": "置き場の行の版が読めない（窓は答えず Python に任せる）", "mode": "shared", "rows": {"equipment_master": [{"id": 1, "設備名": "CR1", "rev": "x"}], "roll_master": [{"id": 1, "設備": "CR1", "rev": None}]}, "steps": [], "delegates": [
        S(BOSS, "GET", E), S(BOSS, "POST", E, {"設備名": "X"}), S(BOSS, "PUT", f"{E}/1", {"巻取方向": "上", "base_rev": 1}),
        S(BOSS, "DELETE", f"{E}/1"), S(BOSS, "GET", R), S(BOSS, "POST", R, {"設備": "X"}), S(BOSS, "PUT", f"{R}/1", {"本数": 1}),
        S(BOSS, "DELETE", f"{R}/1", query="rev=1"),
    ]},
    {"name": "置き場の行の id が大きな数・字（窓は答えず Python に任せる）", "mode": "shared", "rows": {"equipment_master": [{"id": 1e19, "設備名": "CR1"}], "roll_master": [{"id": "3", "設備": "CR1"}]}, "steps": [], "delegates": [
        S(BOSS, "GET", E), S(BOSS, "POST", E, {"設備名": "X"}), S(BOSS, "PUT", f"{E}/1", {"巻取方向": "上", "base_rev": 1}),
        S(BOSS, "DELETE", f"{E}/1"), S(BOSS, "GET", R), S(BOSS, "POST", R, {"設備": "X"}), S(BOSS, "PUT", f"{R}/1", {"本数": 1}),
        S(BOSS, "DELETE", f"{R}/1", query="rev=1"),
    ]},
    {"name": "真偽の id（int(True) は 1）", "mode": "shared", "rows": {"equipment_master": [{"id": True, "設備名": "A"}], "roll_master": [{"id": False, "設備": "A"}]},
     "steps": [S(BOSS, "POST", E, {"設備名": "B"}), S(BOSS, "POST", R, {"設備": "B"}), S(BOSS, "GET", E), S(BOSS, "GET", R)], "delegates": []},
    {"name": "置き場の行の値が i64 に入らない整数（窓は答えず Python に任せる）", "mode": "shared",
     "rows": {"equipment_master": [{"id": 1, "設備名": 10000000000000000000}], "roll_master": [{"id": 1, "設備": "A", "本数": 18446744073709551616}]},
     "steps": [], "delegates": [S(BOSS, "POST", E, {"設備名": "Q", "同一工程": "10000000000000000000"}), S(BOSS, "GET", E), S(BOSS, "GET", R),
                                S(BOSS, "POST", R, {"設備": "B"})]},
    # 版 3.102.0 の作った後の採点の割れ 1: 表でない行は一覧では飛ばし（読めない行はマスタの置き場の状態の badRows が言う）、書く道は断る。前は窓が Python に任せた
    {"name": "置き場に表でない行（一覧は読める行・書く道は断る）", "mode": "shared",
     "rows": {"equipment_master": [EQ[0], "壊れた行"], "roll_master": [7, {"id": 1, "設備": "CR1", "rev": 1}]}, "steps": [
        S(BOSS, "GET", "/api/masters/equipment"), S(BOSS, "GET", "/api/masters/rolls"),
        S(BOSS, "POST", "/api/masters/equipment", {"設備名": "新"}), S(BOSS, "POST", "/api/masters/equipment", {"設備名": ""}),
        S(BOSS, "PUT", "/api/masters/rolls/1", {"設備": "CR2"}), S(BOSS, "DELETE", "/api/masters/rolls/1"),
        S(BOSS, "GET", "/api/masters/rolls"),
    ], "delegates": []},
    {"name": "書ける段と門番", "mode": "shared", "rows": {"equipment_master": EQ[:2], "roll_master": ROLLS}, "steps": [
        S(PART, "GET", E),
        S(PART, "POST", E, {"設備名": "部分的編集可でも書ける"}),
        S(VIEW, "GET", R),
        S(VIEW, "POST", R, {"設備": "閲覧のみは書けない"}),
        S(VIEW, "DELETE", f"{E}/1"),
    ], "delegates": []},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": {"equipment_master": EQ, "roll_master": ROLLS}, "steps": [
        S(BOSS, "GET", E),
        S(BOSS, "POST", E, {"設備名": "手元"}),
        S(BOSS, "PUT", f"{E}/2", {"巻取方向": "直した", "base_rev": 3}),
        S(BOSS, "DELETE", f"{R}/1"),
    ], "delegates": []},
    {"name": "共有にまだ無い（写しから最初の版）", "mode": "mirror", "rows": {"equipment_master": EQ[:1], "roll_master": []}, "steps": [
        S(BOSS, "POST", E, {"設備名": "写しから"}),
        S(BOSS, "POST", R, {"設備": "写しから"}),
        S(BOSS, "GET", E),
    ], "delegates": []},
]


def place(root, sc):
    data, cache, share = root / "app" / "data", root / "local" / "master_cache", root / "share"
    for d in (data, cache, share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    for name, rows in (("access_permissions", PERM), ("work_log_files", WORK), *sc["rows"].items()):
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
            pd = base / f"s{i}" / "pd"      # Python に任せる本文は別の写しに当てる（突き合わせるファイルに混ぜない）
            place(pd, sc)
            clients = {False: client, True: create_app({"TESTING": True, "MASTER_STORE": store_of(pd, sc)}).test_client()}
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
