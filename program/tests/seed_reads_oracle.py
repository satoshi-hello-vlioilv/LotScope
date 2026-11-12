# -*- coding: utf-8 -*-
"""読む道の種まきの「正しい答え」を出す係（版 3.105.0。desktop/tests/seed_reads_parity.rs が呼ぶ）。

    python tests/seed_reads_oracle.py 作業フォルダ

Python は共有のマスタを読むとき（MasterStore.read → _maybe_refresh → _seed）、共有にまだ無ければ最初の版を置く（種まき）。窓も版 3.105.0 から
読むとき（access::Place の読み → master_store::seed_through）に置く。読む道ごとに、Python が置くマスタの全部と窓が置くマスタの全部が
同じかを確かめるため、道ごとに同じ中身の置き場を 2 つ（py・rs）作る: 共有のフォルダは空、マスタはこの PC の写し（local/master_cache）だけにある
（写しの無いマスタは同梱の data/ も無いので最初の中身〈program/app/master_defaults〉か空の版 1 で置かれる）。py に Python の道で GET を 1 回当て、
終わった後の共有のファイル（中身）を渡す。窓の試験は rs に本物の窓の道（Lot::handle_body・sources_list・page）で同じ GET を当て、
共有に置かれたファイルの名前と中身（時刻は伏せる）を突き合わせる。窓が答えず Python に任せた道は、窓が置いた物が Python の置いた物に含まれるかを見る。
"""
import json
import logging
import os
import shutil
import sqlite3
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity  # noqa: E402

LOGIN = identity.current_login_id()


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=4):
    return {"schema": 1, "revision": rev, "updated_at": "2026-01-01T00:00:00", "updated_by": {"pc": "PC-0", "login": "u0"}, "rows": rows}


# 写しに置くマスタ（ほかのマスタは写しも data/ も無い形: 最初の中身か空の版 1 で置かれる）
MIRROR = {
    "access_permissions": [{"id": 1, "ログインID": LOGIN, "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1}],
    "equipment_master": [{"id": 1, "設備名": "CR1", "rev": 2}, {"id": 2, "設備名": "TLV"}],
    "roll_master": [{"id": 1, "設備": "CR1", "ロール名": "WR-1", "rev": 1}],
    "work_log_files": [{"id": 1, "キー": "w1", "設備名": "CR1", "ファイル名": "実績_CR1.db", "表示": "有", "並び": "1"}],
    "shift_patterns": [],
    "ui_defaults": [{"名前": "tpa.lotlist.cols", "値": "[1]"}],
    "display_formats": [{"id": 1, "名前": "書式", "元": "lot", "表": "", "作った所": "", "中身": '{"sorts":[]}', "備考": "", "rev": 1}],
    "dashboards": [],
}

GET = [
    ("/api/masters/equipment", ""), ("/api/masters/rolls", ""), ("/api/ui-defaults", ""), ("/api/access/me", ""), ("/api/masters/access", ""),
    ("/api/masters/tabaccess", ""), ("/api/masters/shifts", ""), ("/api/masters/conversions", ""), ("/api/masters/conversions/export", ""),
    ("/api/masters/equipgroups", ""), ("/api/masters/formats", ""), ("/api/dashboards", ""), ("/api/dashboard-sets", ""),
    ("/api/card-forms", "source=card%3Alotlist%3A%E5%93%81%E8%B3%AA"), ("/api/pivot-presets", "source=lot"), ("/api/masters/status", ""),
    ("/api/masters/place", ""), ("/api/settings", ""), ("/api/config", ""), ("/api/dashboard/sources", ""), ("/api/sources", ""),
    ("/api/update/settings", ""), ("/api/masters/worklog", ""), ("/api/worklog/files", ""), ("/", ""),
]


def place(root):
    share, data, cache = root / "share", root / "base" / "data", root / "local" / "master_cache"
    for d in (share, data, cache):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    con = sqlite3.connect(root / "仕掛.sqlite3")
    con.execute("CREATE TABLE 仕掛 (ロットNo TEXT, 設備 TEXT)")
    con.execute("INSERT INTO 仕掛 VALUES ('A1', 'CR1')")
    con.commit()
    con.close()
    rows = dict(MIRROR, data_sources=[{"id": 1, "キー": "eq", "表示名": "仕掛", "場所": str(root / "仕掛.sqlite3"), "表": "仕掛", "設備の列": "設備",
                                       "並び": "1"}])
    for name, r in rows.items():
        (cache / f"{name}.json").write_text(j(doc(r)), encoding="utf-8")
    cfg = {"lot_list": {"source": str(root / "無い品質.sqlite3"), "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"}, "master_share": {"dir": str(share), "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


def share_files(root):
    share = root / "share"
    return {f.name: json.loads(f.read_text(encoding="utf-8")) for f in sorted(share.glob("*.json")) if f.name != "master.lock.json"}


def run(root, path, query):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    store = MasterStore(root / "base", local_root=root / "local", settings={"dir": str(root / "share"), "refresh_seconds": 0},
                        who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    routes._REVOKE_CACHE.update(at=0.0, key="")
    forget_tab_cache()
    try:
        r = app.test_client().get(path + (f"?{query}" if query else ""))
        status = r.status_code
    except Exception as e:      # 道の外で落ちた（本番は 500）。置いた物は比べる
        status = f"{type(e).__name__}: {e}"
    return status


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    out = []
    for i, (path, query) in enumerate(GET):
        py, rs = base / f"s{i}" / "py", base / f"s{i}" / "rs"
        for r in (py, rs):
            place(r)
        status = run(py, path, query)
        out.append({"name": f"GET {path}{'?' + query if query else ''}", "path": path, "query": query, "status": status,
                    "py": str(py), "rs": str(rs), "files": share_files(py),
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
