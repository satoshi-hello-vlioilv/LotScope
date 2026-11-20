# -*- coding: utf-8 -*-
"""起動の初期値の答えの元（版 3.110.0。窓の cargo test --test seeds_parity が呼ぶ）。

    python tests/seeds_oracle.py 作業フォルダ
        … 事例の表 seeds_cases.json の走らせる形（runs）と足した場面を、場面ごとのフォルダ〈作業フォルダ/n/py〉に作って Python の
          master_seeds.run で当て、当てた初期値と終わった後のマスタのファイルを JSON で出す（窓は同じ形を自分のフォルダで当てて突き合わせる）
    python tests/seeds_oracle.py create 共有 作業場所 ready の印 go の印
        … 錠の取り合いの場面（版 3.110.0 の作った後の採点の割れ 3）: 窓の初期値と同じ瞬間に Python の create_app（起動の参照先の読み＝
          path_settings の種まき）を起こす。支度を終えて ready の印を置き、go の印を見てから create_app
    python tests/seeds_oracle.py race 共有 作業場所 ready の印 go の印 [--old]
        … 2 つのプロセスの場面: この共有へ Python の係で当てる。app_seeds を読んだ直後に ready の印を置き、go の印があるまで待つ
          （窓も同じ所で待ち合わせ、同じ時に当てる形を起こす）。--old は版 3.109.0 までの係（錠の中で見直さず、変えなくても書き、記録も足す）
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.repositories.master_store import MasterStore, next_id  # noqa: E402
from app.services import master_seeds  # noqa: E402

TABLE = json.loads((Path(__file__).resolve().parent / "fixtures" / "seeds_cases.json").read_text(encoding="utf-8"))
IM, FD, KD = TABLE["order"]


def doc(rows, rev=1):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


# 事例の表の走らせる形に足す場面（終わった後のファイルを突き合わせる）
EXTRA = [
    {"name": "記録が一部（管理者だけ済み）・人が直した設備（LS3 は無・NS1 は空）", "place": "share",
     "masters": {"app_seeds": doc([{"id": 1, "seed": FD}], 2),
                 "equipment_master": doc([{"id": 1, "設備名": "LS3", "検査計": "無", "rev": 4}, {"id": 2, "設備名": " ns1", "検査計": "", "rev": "3"},
                                          {"id": "x", "設備名": "KEN"}], 6),
                 "conversions": doc([{"id": 1, "名前": "課名", "表示順": "10"}, {"id": 2, "名前": "管理分類", "表示順": "²"}], 9)}},
    {"name": "同じ ID の行・大きな整数の版と id", "place": "share",
     "masters": {"equipment_master": doc([{"id": 5, "設備名": "LS3", "検査計": "", "rev": 12345678901234567890},
                                          {"id": 5, "設備名": "LS4", "検査計": 0, "rev": 100000000000000000000},
                                          {"id": 100000000000000000000, "設備名": "AP3"}], 2),
                 "access_permissions": doc([{"id": 3, "ログインID": "tanaka"}, {"id": 3, "ログインID": "suzuki"}], 1)}},
    {"name": "手元のみ・data/ に前からの行", "place": "local",
     "masters": {"equipment_master": doc([{"id": 1, "設備名": "LS3", "検査計": ""}]), "app_seeds": doc([{"id": 1, "seed": KD}])}},
]


def build(root, run, who="py"):
    base, local, share = root / "base", root / "local", root / "share"
    for d in (base / "data", local / "master_cache"):
        d.mkdir(parents=True, exist_ok=True)
    (local / "instance_id").write_text(f"inst-{who}", encoding="utf-8")
    if run["place"] == "share":
        share.mkdir(exist_ok=True)
        for name, d in run["masters"].items():
            (share / f"{name}.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        if run.get("lock"):
            (share / "master.lock.json").write_text(json.dumps(run["lock"], ensure_ascii=False), encoding="utf-8")
        settings = {"dir": str(share)}
    elif run["place"] == "unreachable":
        settings = {"dir": str(root / "無い共有")}
    else:
        for name, d in run["masters"].items():
            (base / "data" / f"{name}.json").write_text(json.dumps(d["rows"], ensure_ascii=False), encoding="utf-8")
        settings = {}
    return MasterStore(base, local_root=local, settings=settings, who={"pc": f"PC-{who}", "login": who})


def files(root, run):
    where = root / "share" if run["place"] == "share" else root / "base" / "data"
    out = {}
    if where.is_dir():
        for p in sorted(where.glob("*.json")):
            out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
    return out


def scenarios(work):
    out = []
    for i, run in enumerate(TABLE["runs"] + EXTRA):
        root = Path(work) / str(i) / "py"
        store = build(root, run)
        master_seeds.LOCKED_WAIT_SEC = 0
        applied = master_seeds.run(store)
        out.append({"name": run["name"], "run": run, "applied": applied, "files": files(root, run)})
    return {"scenarios": out}


def old_run(store):
    """版 3.109.0 までの係（錠の中で見直さない・変えなくても書く・記録も足す）。2 つのプロセスの場面の『前の版の Python』"""
    done = {str(r.get("seed")) for r in store.read(master_seeds.SEEDS_MASTER)}
    applied = []
    for sid, name, fn in master_seeds.SEEDS:
        if sid in done:
            continue
        try:   # 錠のやり直しは前の版と同じ（_write）。中身は変えなくても書き、記録は見直さずに足す
            master_seeds._write(store, name, lambda rows, stamp, fn=fn: fn(rows, stamp) or True)
            master_seeds._write(store, master_seeds.SEEDS_MASTER,
                                lambda rows, stamp, sid=sid: rows.append({"id": next_id(rows), "seed": sid, **stamp}) or True)
        except Exception:
            break
        applied.append(sid)
    return applied


def race(share, local, ready, go, old):
    local = Path(local)
    (local / "master_cache").mkdir(parents=True, exist_ok=True)
    (local / "instance_id").write_text("inst-py", encoding="utf-8")
    base = local / "base"
    (base / "data").mkdir(parents=True, exist_ok=True)

    class Waiting(MasterStore):
        def read(self, name):
            rows = super().read(name)
            if name == master_seeds.SEEDS_MASTER:
                Path(ready).write_text("1", encoding="utf-8")
                end = time.monotonic() + 30
                while not Path(go).exists() and time.monotonic() < end:
                    time.sleep(0.001)
            return rows

    store = Waiting(base, local_root=local, settings={"dir": share}, who={"pc": "PC-py", "login": "py"})
    # 錠の待ちは本物と同じ 1 秒×5 回（版 3.110.0。0.05 秒に縮めると、書き込みの遅い Windows で相手の錠を待ちきれなかった）
    applied = old_run(store) if old else master_seeds.run(store)
    return {"applied": applied}


def create(share, local, ready, go):
    import os
    local = Path(local)
    (local / "master_cache").mkdir(parents=True, exist_ok=True)
    (local / "instance_id").write_text("inst-py", encoding="utf-8")
    base = local / "base"
    (base / "data").mkdir(parents=True, exist_ok=True)
    os.environ["TRANSFER_LOCAL_ROOT"] = str(local)
    from app import create_app
    store = MasterStore(base, local_root=local, settings={"dir": share}, who={"pc": "PC-py", "login": "py"})
    Path(ready).write_text("1", encoding="utf-8")
    end = time.monotonic() + 30
    while not Path(go).exists() and time.monotonic() < end:
        time.sleep(0.001)
    create_app({"MASTER_STORE": store})
    return {"seeded": (Path(share) / "path_settings.json").exists()}


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "create":
        print(json.dumps(create(a[1], a[2], a[3], a[4]), ensure_ascii=False))
    elif a and a[0] == "race":
        print(json.dumps(race(a[1], a[2], a[3], a[4], "--old" in a), ensure_ascii=False))
    else:
        print(json.dumps(scenarios(a[0]), ensure_ascii=False))
