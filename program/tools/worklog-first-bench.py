"""入れた直後（手元の写しが 1 つも無い PC）の作業実績の読み込みを測る評価関数（版 3.46.0。開発用）。

利用者の要望（2026-10-21 の 6）: 「設備実績取得、初回インストール時直後不安定です」。
共有の実績ファイルを手元へ写すのに時間がかかる形（1 ファイルを写すのに --delay 秒）を作り、最初の画面（ダッシュボード）が
作業実績のパネル（前日の実績本数）を問い合わせたときの動きを、画面と同じ問い合わせ方（答えが「写している」なら 4 秒ごとに引き直す）で測る。

    python tools/worklog-first-bench.py [--equip 11] [--delay 1.5] [--first-wait 秒]
    （--delay 4 --first-wait 2 で、1 台を写すのに待ちの長さより長くかかる遠い共有の形。--spread で速い設備と遅い設備が混ざる形）

測る物と合格の線（どれかが外れれば終了コード 1）:
  ① 最初の答えが返るまでの時間 … いちばん遅い 1 台を写す時間（か、写しを待つ長さ）＋ 1 秒まで（写しを 1 台ずつ順に待たない）
  ② 途中の数（写し終えた設備だけで数えた数）を、写し中と言わずに出していない（写し中の設備は copying と分かる）
  ③ 画面の引き直しの決まりで、正しい数（全部を写した後の数）に着くまでの時間 … 1 ファイルを写す時間 ＋ 引き直しの間（4 秒）＋ 2 秒まで
  ④ 作業実績のタブで、初めて 1 台を開いたときの答えの時間 … 1 ファイルを写す時間 ＋ 1 秒まで
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
WORK = Path(tempfile.mkdtemp(prefix="tpa-first-"))
os.environ["TRANSFER_LOCAL_ROOT"] = str(WORK / "local")
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import dashboard, db_mirror, shifts, work_log  # noqa: E402
from app.services.db_mirror import DbMirror  # noqa: E402
from tests import lotlist_fixture  # noqa: E402

EQUIPMENT = ("CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1", "SL2", "CS3", "TU1", "P12", "INS1")
RETRY_S = 4.0            # 画面（dashboard.js の RETRY_MS）が「写している」答えを引き直す間


def build(equip):
    folder = WORK / "実績"
    folder.mkdir()
    for eq in EQUIPMENT[:equip]:
        lotlist_fixture.make_work(str(folder / f"実績_{eq}.sqlite3"), eq)
    shutil.copytree(PROGRAM / "data", WORK / "base" / "data", ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
    settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600}}
    app = create_app({"MASTER_STORE": MasterStore(WORK / "base", local_root=WORK / "masters", settings={}), "APP_SETTINGS": settings,
                      "LOT_MIRROR": DbMirror("lot_list", "", WORK / "cache"),
                      "WORK_MIRRORS": work_log.Mirrors(WORK / "cache" / "work_log"), "WORK_LISTING": work_log.Listing(ttl=0),
                      "SRC_MIRRORS": work_log.Mirrors(WORK / "cache" / "sources", prefix="src"),
                      "DASHBOARD_NOW": datetime.combine(lotlist_fixture.TODAY + timedelta(days=1), datetime.min.time()).replace(hour=10)})
    repo = MasterRepository(app.config["MASTER_STORE"])
    repo.work_log_sync(work_log.scan(folder, "実績_*.sqlite3"))
    repo.shift_create(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))
    return app


def slow_copy(delay, spread=False):
    """写し（db_mirror の _copy）を 1 ファイル delay 秒にする（共有が遠い PC の形）。spread は 1 台おきに 3 倍（速い設備と遅い設備が混ざる形）"""
    real = DbMirror._copy

    def copy(remote, tmp):
        i = next((n for n, eq in enumerate(EQUIPMENT) if Path(remote).name == f"実績_{eq}.sqlite3"), 0)
        time.sleep(delay * (3 if spread and i % 2 else 1))
        return real(remote, tmp)
    DbMirror._copy = staticmethod(copy)


def kpi_value(d):
    return next((c["v"][0] for c in d.get("cells") or [] if not c["r"] and not c["c"]), None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--equip", type=int, default=11)
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--spread", action="store_true", help="1 台おきに写す時間を 3 倍にする（途中の数が出る形）")
    ap.add_argument("--first-wait", type=float, default=None, help="写しの係が最初の写しを待つ長さ（db_mirror.FIRST_WAIT_SEC。遠い共有の形を短い時間で作る）")
    a = ap.parse_args()
    if a.first_wait is not None:
        db_mirror.FIRST_WAIT_SEC = a.first_wait
    app = build(a.equip)
    slow_copy(a.delay, a.spread)
    panel = next(p for p in dashboard.BUILTIN_LAYOUTS[0]["body"]["panels"] if p["id"] == "workMonth")
    c = app.test_client()
    fails = []

    def check(name, ok, got):
        print(f"{'OK ' if ok else 'NG '} {name}: {got}")
        if not ok:
            fails.append(name)

    t0 = time.monotonic()
    log = []
    first = None
    final = None
    while time.monotonic() - t0 < a.delay * a.equip + 30:
        r = c.post("/api/dashboard/query", json={"panel": panel})
        d = r.get_json()
        t = time.monotonic() - t0
        copying = d.get("kind") == "copying" or any(f.get("kind") == "copying" for f in d.get("failed") or [])
        log.append({"t": round(t, 2), "status": r.status_code, "value": kpi_value(d) if r.status_code == 200 else None,
                    "failed": [f"{f['name']}:{f.get('kind')}" for f in d.get("failed") or []], "copyingSaid": copying})
        if first is None:
            first = log[-1]
        if r.status_code == 200 and not d.get("failed"):
            final = log[-1]
            break
        if not copying:
            # 画面は「写している」と言われなければ引き直さない（次は 1 分後）。ここで止める＝画面が途中の数のまま止まる形
            break
        time.sleep(RETRY_S)
    print(json.dumps(log, ensure_ascii=False, indent=1))
    # 全部写した後の正しい数（同じ組み）
    for _ in range(100):
        d = c.post("/api/dashboard/query", json={"panel": panel}).get_json()
        if not d.get("failed") and d.get("cells"):
            break
        time.sleep(0.3)
    truth = kpi_value(d)
    line = min(a.delay * (3 if a.spread else 1), db_mirror.FIRST_WAIT_SEC) + 1.0     # いちばん遅い 1 台（か、待つ長さ）＋ 1 秒
    check("① 最初の答えが返るまで（写しを 1 台ずつ順に待たない）", first["t"] <= line, f"{first['t']} 秒（線 {line:.1f} 秒）")
    partial_silent = [x for x in log if x["status"] == 200 and x["value"] != truth and not x["copyingSaid"]]
    check("② 途中の数を、写し中と言わずに出さない", not partial_silent, partial_silent[:2] or "なし")
    reach = final["t"] if final and final["value"] == truth else None
    check("③ 画面の引き直しで正しい数に着く", reach is not None and reach <= a.delay * (3 if a.spread else 1) + RETRY_S + 2, f"{reach} 秒（正しい数 {truth}）")

    # ④ 作業実績のタブで、まだ写していない 1 台を初めて開く
    app2 = build_again(a.equip)
    c2 = app2.test_client()
    t1 = time.monotonic()
    r = c2.get("/api/worklog", query_string={"equip": [x.get("キー") for x in work_log.ordered(MasterRepository(app2.config["MASTER_STORE"]).work_logs())][0]})
    t = time.monotonic() - t1
    check("④ 作業実績のタブで初めて 1 台を開いた答え", t <= a.delay + 1, f"{t:.2f} 秒・{r.status_code} {(r.get_json() or {}).get('kind', '')}")
    print("\nすべて OK" if not fails else f"\nNG {len(fails)} 件")
    shutil.rmtree(WORK, ignore_errors=True)
    sys.exit(1 if fails else 0)


def build_again(equip):
    """写しの無い新しい置き場で、もう一度アプリを作る（④ 用）"""
    global WORK
    WORK = Path(tempfile.mkdtemp(prefix="tpa-first-"))
    return build(equip)


if __name__ == "__main__":
    threading.stack_size(16 * 1024 * 1024)
    main()
