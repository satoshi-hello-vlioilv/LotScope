"""ダッシュボードの読み込みの速さを測る評価関数（版 3.43.0。開発用）。

標準のダッシュボード（組み込みの「標準」）の全部のパネルを、大きな試験データで数え、パネルごとの時間と合計を出す。
答え（数）も控えるので、速くする前後で同じ答えかを突き合わせられる。

    python tools/dash-bench.py [--rows 20000] [--equip 11] [--save 前.json] [--compare 前.json]

- データ: 作業実績 設備 --equip 台 × --rows 行（tests/lotlist_fixture.make_work。120 日に散らす）・仕掛 20,000 ロット・品質データ 20,000 行
- 測り方: ①冷えた（サーバーの答えの控えを空にし、開いて最初に出す時）②ファイルが変わった（写しが新しくなった・1 分ごとの引き直し）
  ③同じ組み（控えから）。①②は「画面が全部のパネルを一度に問い合わせる」形（並行 8）でも測る
- --compare は、答えの数（cells・orders・count）が前に控えた物と同じかを確かめる（違えば終了コード 1）
"""
import argparse
import concurrent.futures as cf
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
WORK = Path(tempfile.mkdtemp(prefix="tpa-bench-"))
os.environ["TRANSFER_LOCAL_ROOT"] = str(WORK / "local")
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import shifts, work_log  # noqa: E402
from app.services.db_mirror import DbMirror  # noqa: E402
from tests import lotlist_fixture  # noqa: E402

EQUIPMENT = ("CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1", "SL2", "CS3", "TU1", "P12", "INS1")


def build(rows, equip):
    folder = WORK / "実績"
    folder.mkdir()
    for eq in EQUIPMENT[:equip]:
        lotlist_fixture.make_work(str(folder / f"実績_{eq}.sqlite3"), eq, n=rows)
    share = WORK / "SIKADEF.sqlite3"
    lotlist_fixture.make(str(share), 20000)
    wip = WORK / "LOTNOW.sqlite3"
    lotlist_fixture.make_wip(str(wip), 20000)
    shutil.copytree(PROGRAM / "data", WORK / "base" / "data", ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
    settings = {"lot_list": {"source": str(share)}, "work_log": {"folder": str(folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600},
                "sources": {"wip": {"source": str(wip), "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}}}
    app = create_app({"MASTER_STORE": MasterStore(WORK / "base", local_root=WORK / "masters", settings={}), "APP_SETTINGS": settings,
                      "LOT_MIRROR": DbMirror("lot_list", share, WORK / "cache"),
                      "WORK_MIRRORS": work_log.Mirrors(WORK / "cache" / "work_log"), "WORK_LISTING": work_log.Listing(ttl=0),
                      "SRC_MIRRORS": work_log.Mirrors(WORK / "cache" / "sources", prefix="src"),
                      "DASHBOARD_NOW": datetime.combine(lotlist_fixture.TODAY + timedelta(days=1), datetime.min.time()).replace(hour=10)})
    repo = MasterRepository(app.config["MASTER_STORE"])
    repo.work_log_sync(work_log.scan(folder, "実績_*.sqlite3"))
    repo.shift_create(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))
    return app


def panels(c):
    d = c.get("/api/dashboards").get_json()
    it = next((x for x in d["items"] if str(x["id"]) == str(d.get("standardId"))), d["items"][-1])
    return it["body"]["panels"]


def ask(c, p):
    t = time.perf_counter()
    r = c.post("/api/dashboard/query", json={"panel": p})
    return time.perf_counter() - t, r.status_code, r.get_json()


def copying(st, d):
    return (st == 503 and d.get("kind") == "copying") or any(g.get("kind") == "copying" for g in d.get("groups") or [])


def numbers(d):
    """突き合わせる数（時間・時刻・写しの様子は除く）"""
    def one(a):
        return {k: a.get(k) for k in ("cells", "orders", "count", "error")}
    return {"groups": [one(g) for g in d["groups"]]} if "groups" in d else one(d)


def touch_all():
    """作業実績・仕掛・品質データのファイルを新しくした形（写しを作り直させる）"""
    for f in list((WORK / "実績").glob("*.sqlite3")) + [WORK / "SIKADEF.sqlite3", WORK / "LOTNOW.sqlite3"]:
        os.utime(f, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=20000)
    ap.add_argument("--equip", type=int, default=11)
    ap.add_argument("--save")
    ap.add_argument("--compare")
    a = ap.parse_args()
    t0 = time.perf_counter()
    app = build(a.rows, a.equip)
    c = app.test_client()
    ps = panels(c)
    for p in ps:                       # 写し終えるまで待つ（写すのは測らない）
        for _ in range(600):
            _, st, d = ask(c, p)
            if not copying(st, d):
                break
            time.sleep(0.05)
    print(f"データ: 作業実績 {a.equip} 台 × {a.rows:,} 行・仕掛 20,000・品質 20,000（作る・写す {time.perf_counter() - t0:.1f} 秒）")
    report, answers = {}, {}

    def cold():
        app.config.pop("DASH_CACHE", None)
        for k in [k for k in app.config if k.startswith("PIVOT_")]:
            app.config.pop(k, None)

    def run(label, prep):
        prep()
        t = time.perf_counter()
        per = []
        for p in ps:
            dt, st, d = ask(c, p)
            per.append((p.get("title") or p.get("visual"), round(dt * 1000)))
            answers[p["id"]] = numbers(d)
        total = round((time.perf_counter() - t) * 1000)
        prep()
        t = time.perf_counter()
        with cf.ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda p: ask(app.test_client(), p), ps))
        par = round((time.perf_counter() - t) * 1000)
        report[label] = {"順に": total, "並行": par, "パネル": per}
        print(f"{label}: 順に {total} ms・並行 {par} ms  " + "  ".join(f"{n} {ms}" for n, ms in per))

    run("①冷えた", cold)
    run("③控えから", lambda: None)
    print("（②は写しを作り直すので、写し終えてから測る）")
    touch_all()
    for p in ps:
        for _ in range(600):
            _, st, d = ask(c, p)
            if not copying(st, d):
                break
            time.sleep(0.05)
    run("②ファイルが変わった後", cold)
    out = {"report": report, "answers": answers}
    if a.save:
        Path(a.save).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    code = 0
    if a.compare:
        was = json.loads(Path(a.compare).read_text(encoding="utf-8"))["answers"]
        bad = [k for k in was if json.dumps(was[k], sort_keys=True) != json.dumps(answers.get(k), sort_keys=True)]
        print("答えの突き合わせ:", "OK（前と同じ数）" if not bad else f"NG 違うパネル {bad}")
        code = 1 if bad else 0
    shutil.rmtree(WORK, ignore_errors=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
