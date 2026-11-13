# -*- coding: utf-8 -*-
"""データ元の書く道の「正しい答え」を出す係（版 3.90.0。desktop/tests/sources_write_parity.rs が呼ぶ）。

    python tests/sources_write_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 3 つ（py・rs・pd）作り、py に Python の道（routes/sources.py の 7 本。門番 _access_guard を含む）で
問い合わせの並びを当てる。窓の試験は rs に同じ並びを本物の窓の道（Lot::handle_body → sources_write_route。材料は窓の束の材料）で当て、
答え（状態・本文。断る言葉も 1 字まで）と、できたファイルを突き合わせる。窓が答えず Python に任せる歩（delegates）は pd に当てる。
足す元のキーは Python（data_sources.new_key）と窓（Lot::set_new_key）で同じ並び（k001, k002, …）に差し替える。
名乗りはこの PC の名乗り（identity.current_login_id。窓の bundle::login_id と同じ。bundle_parity が確かめる）と、配った設定の PC 名。
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
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import data_sources, identity  # noqa: E402
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

LOGIN = identity.current_login_id()


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def perm(role="開発者", edit="編集可"):
    return [{"id": 1, "ログインID": LOGIN, "PC名": "", "権限区分": role, "マスタ編集": edit, "有効": "有", "rev": 1}]


ROWS = [{"id": 1, "キー": "wip", "表示名": "仕掛X", "場所": "/wip.sqlite3", "並び": "3", "rev": 2},
        {"id": 5, "キー": "s1", "表示名": "製造条件", "役割": "マスタ", "場所": "/m.sqlite3", "表": "M", "並び": "1",
         "結合": j([{"with": "wip", "how": "inner", "on": [["合金", "材質"]], "cols": ["c1"]}]), "rev": 1},
        {"id": 6, "キー": "s2", "表示名": "結合した表", "元": "wip", "結合": j([{"with": "s1", "on": [["a", "b"]]}]), "並び": "2"},
        {"id": 7, "キー": "s3", "表示名": "足した", "場所": "/s3.sqlite3", "グループ": "工程", "並び": "4", "rev": 5},
        {"id": 8, "キー": "s4", "表示名": "足した 2", "場所": "/s4.sqlite3", "グループ": "工程", "役割": "その他", "並び": "5"}]


def S(method, path, body=None, query=""):
    return {"method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


P = "/api/sources"
SCENARIOS = [
    {"name": "足す（誤りの言葉と決まり）", "mode": "shared", "rows": ROWS, "steps": [
        S("POST", P, {"表示名": " 新しい ", "場所": ' "C:\\\\共有\\\\新.sqlite3" ', "グループ": " 工 程　 の  まとまり ", "確かめる間隔": "１０.7",
                      "古さの警告": "0.1", "備考": 12, "画面": "x", "ロット番号の列": "L" * 130, "結合": [{"with": "wip", "on": [["a", 1.0]], "cols": "xy"}]}),
        S("POST", P, {"表示名": "x", "場所": "y", "古さの警告": "-0", "確かめる間隔": "1e1"}),
        S("POST", P, {"表示名": "x", "場所": "y", "古さの警告": "1e-05"}),
        S("POST", P, {"場所": "y"}),
        S("POST", P, {"表示名": "x"}),
        S("POST", P, {"表示名": "x", "場所": "y", "役割": "変"}),
        S("POST", P, {"表示名": "x", "場所": "y", "設備の取り出し方": "後方"}),
        S("POST", P, {"表示名": "x", "場所": "y", "確かめる間隔": "abc"}),
        S("POST", P, {"表示名": "x", "場所": "y", "確かめる間隔": "nan"}),
        S("POST", P, {"表示名": "x", "場所": "y", "確かめる間隔": "5"}),
        S("POST", P, {"表示名": "x", "場所": "y", "古さの警告": "1441"}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": [{"with": ""}]}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": [{"with": "work", "on": [["a", "b"]]}]}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": [{"with": "s1"}]}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": "壊れた"}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": j([{"with": "s1", "how": "full", "on": [["a", "b"]] * 10}] * 8)}),
        S("POST", P, {"表示名": "合わせた", "元": "wip", "結合": [{"with": "s1", "on": [["a", "b"]]}], "場所": "消える"}),
        S("POST", P, {"表示名": "合わせた", "元": "wip"}),
        S("POST", P, {"表示名": "合わせた", "元": "s2", "結合": [{"with": "s1", "on": [["a", "b"]]}]}),
        S("POST", P, {"表示名": "合わせた", "元": "wip", "結合": [{"with": "wip", "on": [["a", "b"]]}]}),
        S("POST", P, {"表示名": True, "場所": 1.5}),
        S("POST", P, "壊れた本文"),
        S("POST", P, "0"),
    ], "delegates": [
        S("POST", P, {"表示名": "x", "場所": "y", "備考": [1, "a"]}),
        S("POST", P, "[1]"),
        S("POST", P, '{"表示名": "x", "場所": "y", "確かめる間隔": NaN}'),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": [{"with": "s1", "on": [["a", "b"]], "cols": 5}]}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": [{"with": "s1", "on": [["a", "b"]], "cols": {"a": 1}}]}),
        S("POST", P, {"表示名": "x", "場所": "y", "結合": '[{"with": "s1", "on": [["a", NaN]]}]'}),
    ]},
    {"name": "直す・その場で変える・消す・行の版", "mode": "shared", "rows": ROWS, "steps": [
        S("PUT", f"{P}/s3", {"表示名": "直した", "備考": "メモ", "知らない列": "x", "base_rev": 5}),
        S("PUT", f"{P}/s3", {"表示名": "古い版", "base_rev": 5}),
        S("PUT", f"{P}/s3", {"表示名": "全角の版", "base_rev": "６"}),
        S("PUT", f"{P}/s3", {"場所": ""}),
        S("PUT", f"{P}/無い元", {"表示名": "x"}),
        S("PUT", f"{P}/order", {"表示名": "x"}),
        S("PUT", f"{P}/lot", {"表示名": "品質の名", "設備の列": "号機", "グループ": "入らない", "base_rev": 0}),
        S("PUT", f"{P}/work", {"表示名": "", "ロット番号の列": "LOT"}),
        S("POST", f"{P}/s4/quick", {"画面": "無", "グループ": "  別の  まとまり ", "場所": "変わらない", "base_rev": 1}),
        S("POST", f"{P}/s4/quick", {"表示名": "", "base_rev": 2}),
        S("POST", f"{P}/wip/quick", {"画面": "無", "base_rev": 2}),
        S("POST", f"{P}/sch/quick", {"表示名": "予定", "base_rev": 0}),
        S("POST", f"{P}/無い元/quick", {"画面": "無"}),
        S("DELETE", f"{P}/s3", query="rev=1"),
        S("DELETE", f"{P}/s3", query="rev=7"),
        S("DELETE", f"{P}/s3"),
        S("DELETE", f"{P}/check"),
        S("DELETE", f"{P}/wip", query="rev=x"),
    ], "delegates": [
        S("PUT", f"{P}/s4", "[1]"),
        W(S("PUT", f"{P}/s4", {"表示名": "x", "base_rev": "²"})),
        W(S("PUT", f"{P}/s%34", {"表示名": "x"})),        # 版 3.106.0: 窓も百分率符号を戻して道を合わせる
        S("POST", f"{P}/s4/quick", {"表示名": ["x"]}),
    ]},
    {"name": "並べ替え・グループ", "mode": "empty", "rows": [], "steps": [
        S("POST", f"{P}/order", {"keys": ["sch", "wip"]}),
        S("POST", f"{P}/order", {"keys": ["lot", "wip", "work", "sch"]}),
        S("POST", f"{P}/order", {"keys": ["wip", "wip"]}),
        S("POST", f"{P}/order", {"keys": ["無い"]}),
        S("POST", f"{P}/order", {"keys": "wip"}),
        S("POST", f"{P}/order", {"keys": []}),
        S("POST", f"{P}/order", {}),
        S("POST", P, {"表示名": "マスタの元", "場所": "/m.sqlite3", "役割": "マスタ"}),
        S("POST", P, {"表示名": "工程の元", "場所": "/k.sqlite3", "グループ": "工程"}),
        S("POST", f"{P}/order", {"keys": ["k002", "k001", "sch", "wip"]}),
        S("POST", f"{P}/groups", {"from": "工程", "to": "  新しい　工程 "}),
        S("POST", f"{P}/groups", {"from": "マスタ", "to": ""}),
        S("POST", f"{P}/groups", {"from": "新しい 工程"}),
        S("POST", f"{P}/groups", {"from": "無いグループ", "to": "x"}),
        S("POST", f"{P}/groups", {"from": "  ", "to": "x"}),
        S("POST", f"{P}/groups", {"to": "x"}),
    ], "delegates": [
        S("POST", f"{P}/order", {"keys": {"wip": 1}}),
        S("POST", f"{P}/order", {"keys": 5}),
        S("POST", f"{P}/order", {"keys": [["wip"]]}),
        S("POST", f"{P}/groups", {"from": ["工程"], "to": "x"}),
        S("POST", f"{P}/order", '"x"'),
    ]},
    {"name": "接続の設定（参照先の項目と行）", "mode": "shared", "rows": ROWS, "steps": [
        S("PUT", f"{P}/lot/conn", {"field": "place", "value": ' "/新しい/品質.sqlite3" ', "base_rev": 0}),
        S("PUT", f"{P}/lot/conn", {"field": "refresh", "value": "10.5"}),
        S("PUT", f"{P}/lot/conn", {"field": "refresh", "value": 120}),
        S("PUT", f"{P}/work/conn", {"field": "pattern", "value": "a*b*"}),
        S("PUT", f"{P}/wip/conn", {"field": "refresh", "value": "300", "base_rev": 2}),
        S("PUT", f"{P}/wip/conn", {"field": "refresh", "value": "3"}),
        S("PUT", f"{P}/wip/conn", {"field": "place", "value": None}),
        S("PUT", f"{P}/s3/conn", {"field": "stale", "value": 2.5}),
        S("PUT", f"{P}/s3/conn", {"field": "nope", "value": "x"}),
        S("PUT", f"{P}/無い元/conn", {"field": "place", "value": "x"}),
        S("PUT", f"{P}/s3/conn", {}),
    ], "delegates": [
        S("PUT", f"{P}/s3/conn", {"field": "stale", "value": [1]}),
        S("PUT", f"{P}/s3/conn", "[1]"),
    ]},
    {"name": "書ける段と門番", "mode": "shared", "rows": ROWS, "perm": perm("一般ユーザー", "部分的編集可"), "steps": [
        S("POST", P, {"表示名": "x", "場所": "y"}),
        S("POST", f"{P}/order", {"keys": ["wip"]}),
        S("DELETE", f"{P}/s3"),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "rows": ROWS, "steps": [
        S("POST", P, {"表示名": "手元", "場所": "/h.sqlite3"}),
        S("PUT", f"{P}/s3", {"備考": "手元で直した", "base_rev": 5}),
        S("POST", f"{P}/order", {"keys": ["s4", "s3"]}),
        S("DELETE", f"{P}/s4"),
    ]},
    {"name": "壊れた結合した表（元が無い）", "mode": "shared",
     "rows": ROWS + [{"id": 9, "キー": "s9", "表示名": "壊れた", "元": "無い元", "結合": j([{"with": "s1", "on": [["a", "b"]]}]), "rev": 1}], "steps": [
        S("POST", f"{P}/s9/quick", {"画面": "無", "base_rev": 1}),
        S("PUT", f"{P}/s9/conn", {"field": "refresh", "value": "60"}),
        S("POST", f"{P}/order", {"keys": ["s9", "s4"]}),
        S("PUT", f"{P}/s9", {"元": "wip", "base_rev": 2}),
        S("POST", f"{P}/s9/quick", {"画面": "無"}),
    ]},
    {"name": "共有に届かない（写しから）", "mode": "unreachable", "rows": ROWS, "steps": [
        S("POST", P, {"表示名": "届かない", "場所": "/u.sqlite3"}),
        S("PUT", f"{P}/s3", {"備考": "x", "base_rev": 5}),
        S("POST", f"{P}/order", {"keys": ["s4", "s3"]}),
        S("DELETE", f"{P}/s4"),
    ]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "rows": ROWS, "lock": True, "steps": [
        S("POST", P, {"表示名": "錠", "場所": "/l.sqlite3"}),
        S("POST", f"{P}/order", {"keys": ["wip"]}),
    ]},
]


def place(root, sc):
    share, data = root / "share", root / "base" / "data"
    for d in (share, data, root / "local"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    masters = {"access_permissions": sc.get("perm") or perm(), "data_sources": sc["rows"],
               "path_settings": [{"id": 1, "項目": "lot_list.table", "値": "品質表", "rev": 1}]}
    for n in ("work_log_files", "equipment_master", "equipment_groups", "conversions", "shift_patterns"):
        masters[n] = []
    for name, rows in masters.items():
        if name == "data_sources" and sc["mode"] == "empty":
            continue
        if sc["mode"] == "local":
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] == "unreachable":       # 共有のフォルダが無い（届かない）: 写しだけがある
            cache = root / "local" / "master_cache"
            cache.mkdir(parents=True, exist_ok=True)
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    if sc["mode"] == "empty":
        (share / "data_sources.json").write_text(j(doc([])), encoding="utf-8")
    if sc.get("lock"):
        n = datetime.now()
        (share / "master.lock.json").write_text(j({"token": "t", "holder_pc": "PC-8", "holder_login": "u8", "holder_instance": "z:1",
                                                   "acquired_at": n.isoformat(timespec="seconds"),
                                                   "expires_at": (n + timedelta(seconds=600)).isoformat(timespec="seconds")}), encoding="utf-8")
    cfg = {"lot_list": {"source": "/配った/品質.sqlite3", "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"}, "sources": {"wip": {"source": "/既定の仕掛.sqlite3"}},
           "master_share": {} if sc["mode"] == "local" else {"dir": str(root / "届かない共有" if sc["mode"] == "unreachable" else share),
                                                               "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


def run(root, steps):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    # 書き手は配った設定の名乗り（窓の束と同じ。最初の場面だけ PC 名の覚えが無く、この PC の名前になった）
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
    c = app.test_client()
    n = {"i": 0}

    def key():
        n["i"] += 1
        return f"k{n['i']:03d}"
    out = []
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    with mock.patch.object(data_sources, "new_key", key):
        for st in steps:
            routes._REVOKE_CACHE.update(at=0.0, key="")
            forget_tab_cache()
            path = st["path"] + (f"?{st['query']}" if st["query"] else "")
            try:
                r = c.open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"), content_type="application/json")
                try:
                    body = r.get_json()
                except Exception:
                    body = None
                out.append({**st, "status": r.status_code, "json": body})
            except Exception as e:      # 道の外で落ちた（試験の接続は投げ返す。本番は 500 で答え、書かない）
                out.append({**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}", "kind": "error"}})
    return out, store.who


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    out = []
    for i, sc in enumerate(SCENARIOS):
        py, rs, pd = (base / f"s{i}" / x for x in ("py", "rs", "pd"))
        for r in (py, rs, pd):
            place(r, sc)
        mine, theirs = oracle_gate.split(sc["steps"], sc.get("delegates", []))
        steps, who = run(py, mine)
        dele, _ = run(pd, theirs)
        out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "storeWho": who, "steps": steps, "delegates": dele,
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
