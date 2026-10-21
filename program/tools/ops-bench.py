"""稼働のガントチャート・ABC 分析と換算係数が、どの設備でも作業の区間（作業開始〜作業終了）を出すかを測る評価関数（版 3.47.0。開発用）。

利用者の要望（2026-10-21 の 2 回目の 1・4）: 「ガントチャートが出ないものがある」「実際の作業本数はあるのに、作業開始〜作業終了の範囲の塗りが
何も出てこない」。本物の実績ファイルの値は見られないので、本物にありそうな書き方を設備ごとに 1 つずつ持たせた作業実績を作り
（正しい作業の区間は作った側が知っている）、ダッシュボードの問い合わせ（/api/dashboard/query）の答えと突き合わせる。

設備ごとの書き方（WaveLog の BOX実績の列: 作業開始_日付・作業終了_日付・作業開始_年月日時分秒・作業終了_年月日時分秒）
  STD      … 日付の列に日時（2026/10/02 8:15:00）。いまの試験データと同じ
  YMDHMS   … 日付の列は日付だけ（2026/10/02）。時刻まで持つのは 年月日時分秒 の列（20261002081500）
  ONLY14   … 日付の列が無く、年月日時分秒 の列（14 桁）だけ
  AMPM     … 午前・午後の書き方（2026/10/02 午後 8:15:00）
  SERIAL   … Access・Excel の日時の数（46297.34375）
  TIMECOL  … 日付の列は日付だけ・時刻は別の列（BOX実績_作業開始_時刻）
  FURNACE  … 焼鈍炉（BOX）: 1 回の作業が 20〜60 時間。前日より前に入れて前日も動いている作業がある
  NIGHT    … 日を跨いだ作業の作業終了の日付が、作業開始の日のまま（時刻だけが翌日）
  BLANKEND … 作業終了が本当に空の作業が 3 割（区間は出せない。出せない数と理由を答えが言うか）

測る物（どれかが外れれば終了コード 1）
  ① ガント（前日）: 設備ごとに、前日の見る範囲（勤務時間の最初〜最後）に掛かる作業の数と、答えの棒の数が合う
  ② ガント（前日）: 設備ごとの稼働の分（勤務時間と重なる分）が、正しい区間で数えた分と ±1 分で合う
  ③ ABC（全期間）: 設備ごとに、作業時間の分かる作業の数（換算係数の元）が、正しい数と合う
  ④ 区間を出せない作業があるとき、答えがその数と理由（noEnd・why）を持つ（黙って捨てない）

    python tools/ops-bench.py [--json]
"""
import argparse
import json
import os
import random
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
WORK = Path(tempfile.mkdtemp(prefix="tpa-ops-"))
os.environ["TRANSFER_LOCAL_ROOT"] = str(WORK / "local")
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import shifts, work_log  # noqa: E402
from app.services.db_mirror import DbMirror  # noqa: E402

NOW = datetime(2026, 10, 3, 10, 0)                       # 前日（現場歴）は 10/2。交替勤務で 10/2 7:00〜10/3 7:00
VIEW = (datetime(2026, 10, 2, 7, 0), datetime(2026, 10, 3, 7, 0))
FIRST = datetime(2026, 9, 22, 7, 0)                       # 作業を並べ始める時刻
KINDS = ("STD", "YMDHMS", "ONLY14", "AMPM", "SERIAL", "TIMECOL", "FURNACE", "NIGHT", "BLANKEND")
S0, E0, S14, E14 = "BOX実績_作業開始_日付", "BOX実績_作業終了_日付", "BOX実績_作業開始_年月日時分秒", "BOX実績_作業終了_年月日時分秒"
ST, ET = "BOX実績_作業開始_時刻", "BOX実績_作業終了_時刻"


def ops_of(kind, seed=3):
    """正しい作業の並び [(作業開始, 作業終了 か None, 分割の本数, 合金)]（作業開始の順。前の作業の終わりの後に次を始める）"""
    r = random.Random(f"{seed}-{kind}")
    out, t = [], FIRST
    while t < NOW - timedelta(hours=3):
        dur = timedelta(minutes=r.randint(20 * 60, 60 * 60) if kind == "FURNACE" else r.randint(25, 170))
        end = None if kind == "BLANKEND" and r.random() < 0.3 else t + dur
        out.append((t, end, r.choice([1, 1, 1, 2, 3]), r.choice(["A1100", "A5052", "A3004"])))
        t = t + dur + timedelta(minutes=r.randint(3, 50))
    # いま（NOW）より後に終わる作業は、いま作業中（作業終了がまだ無い）。その後ろは無い
    return [(s, e if e is None or e < NOW else None, k, a) for s, e, k, a in out if s < NOW]


def _jp(t):
    return f"{t:%Y/%m/%d} {t.hour}:{t.minute:02d}:00"


def _ampm(t):
    return f"{t:%Y/%m/%d} {'午前' if t.hour < 12 else '午後'} {t.hour % 12}:{t.minute:02d}:00"


def _serial(t):
    return (t - datetime(1899, 12, 30)).total_seconds() / 86400


def cells(kind, s, e):
    """書き方ごとの列と値 → {列: 値}"""
    if kind in ("STD", "FURNACE", "BLANKEND"):
        return {S0: _jp(s), E0: _jp(e) if e else ""}
    if kind == "YMDHMS":
        return {S0: f"{s:%Y/%m/%d}", E0: f"{e:%Y/%m/%d}" if e else "", S14: f"{s:%Y%m%d%H%M%S}", E14: f"{e:%Y%m%d%H%M%S}" if e else ""}
    if kind == "ONLY14":
        return {S14: f"{s:%Y%m%d%H%M%S}", E14: f"{e:%Y%m%d%H%M%S}" if e else ""}
    if kind == "AMPM":
        return {S0: _ampm(s), E0: _ampm(e) if e else ""}
    if kind == "SERIAL":
        return {S0: _serial(s), E0: _serial(e) if e else None}
    if kind == "TIMECOL":
        return {S0: f"{s:%Y/%m/%d}", ST: f"{s:%H:%M:%S}", E0: f"{e:%Y/%m/%d}" if e else "", ET: f"{e:%H:%M:%S}" if e else ""}
    if kind == "NIGHT":
        return {S0: _jp(s), E0: f"{s:%Y/%m/%d} {e.hour}:{e.minute:02d}:00" if e else ""}
    raise ValueError(kind)


def write(path, kind, ops):
    rows = []
    n = 0
    for s, e, k, alloy in ops:
        for _ in range(k):
            n += 1
            rows.append({"ロット番号": f"L{n:05d}", **cells(kind, s, e), "合金": alloy})
    cols = list(dict.fromkeys(c for r in rows for c in r))
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in cols) + ")")
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(cols)) + ")", [[r.get(x) for x in cols] for r in rows])
    c.commit()
    c.close()


def busy(ops, a, b):
    """区間を重ねて [a, b) と重なる分"""
    spans = sorted((s, e) for s, e, *_ in ops if e)
    t, cur = 0.0, None
    for s, e in spans:
        s, e = max(s, a), min(e, b)
        if e <= s:
            continue
        if cur and s <= cur[1]:
            cur[1] = max(cur[1], e)
        else:
            if cur:
                t += (cur[1] - cur[0]).total_seconds() / 60
            cur = [s, e]
    if cur:
        t += (cur[1] - cur[0]).total_seconds() / 60
    return t


def build():
    folder = WORK / "実績"
    folder.mkdir()
    truth = {}
    for kind in KINDS:
        truth[kind] = ops_of(kind)
        write(folder / f"実績_{kind}.sqlite3", kind, truth[kind])
    shutil.copytree(PROGRAM / "data", WORK / "base" / "data", ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
    settings = {"lot_list": {"source": ""}, "work_log": {"folder": str(folder), "pattern": "実績_*.sqlite3", "refresh_seconds": 3600}}
    app = create_app({"MASTER_STORE": MasterStore(WORK / "base", local_root=WORK / "masters", settings={}), "APP_SETTINGS": settings,
                      "LOT_MIRROR": DbMirror("lot_list", "", WORK / "cache"),
                      "WORK_MIRRORS": work_log.Mirrors(WORK / "cache" / "work_log"), "WORK_LISTING": work_log.Listing(ttl=0),
                      "SRC_MIRRORS": work_log.Mirrors(WORK / "cache" / "sources", prefix="src"), "DASHBOARD_NOW": NOW})
    repo = MasterRepository(app.config["MASTER_STORE"])
    repo.work_log_sync(work_log.scan(folder, "実績_*.sqlite3"))
    repo.shift_create(shifts.clean_row({"name": "交替", "segments": shifts.TEMPLATES[1]["segments"]}))
    return app, truth


def ask(client, panel):
    for _ in range(100):
        r = client.post("/api/dashboard/query", json={"panel": {"source": "work", **panel}})
        d = r.get_json()
        if r.status_code == 200 and not any(f.get("kind") == "copying" for f in d.get("failed") or []):
            return d
        if r.status_code != 503:
            raise SystemExit(f"問い合わせが失敗しました: {r.status_code} {d}")
        time.sleep(0.1)
    raise SystemExit("写しが終わりません")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        app, truth = build()
        c = app.test_client()
        g = ask(c, {"visual": "gantt", "period": {"column": "@workday", "kind": "yesterday"}})
        a = ask(c, {"visual": "abc", "ops": {"cls": "合金"}})
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
    ge = {e["name"]: e for e in g.get("equips") or []}
    ae = {e["name"]: e for e in a.get("equips") or []}
    skipped = {x["name"]: x["error"] for x in (g.get("skipped") or []) + (a.get("skipped") or [])}
    rows, bad = [], []
    for kind in KINDS:
        ops = truth[kind]
        # いちばん新しい作業で作業終了がまだ空（始まって 7 日以内）は、いま作業中: ガントではいままでの区間（数・作業時間には入れない）
        last = ops[-1]
        running = last[1] is None and NOW - last[0] <= timedelta(hours=168)
        ops_g = ops[:-1] + [(last[0], NOW, *last[2:])] if running else ops
        want_bars = sum(1 for s, e, *_ in ops_g if e and s < VIEW[1] and e > VIEW[0])
        want_busy = busy(ops_g, *VIEW)
        want_timed = sum(1 for _, e, *_ in ops if e)
        want_none = len(ops) - want_timed
        x, y = ge.get(kind) or {}, ae.get(kind) or {}
        bars, got_busy = len(x.get("ops") or []), x.get("busyMin")
        timed = sum(i.get("timed", 0) for i in y.get("items") or []) if y else None
        no_end = (x.get("noEnd"), y.get("noEnd") if y else None)
        why = bool(x.get("why")) if want_none else True
        ok = {"① 棒": bars == want_bars, "② 稼働": got_busy is not None and abs(got_busy - want_busy) <= 1,
              "③ 作業時間": timed == want_timed, "④ 理由": (not want_none) or (x.get("noEnd") == sum(1 for s, e, *_ in ops_g if not e and VIEW[0] <= s < VIEW[1])
                                                                  and (why or not x.get("noEnd")) and y.get("noEnd") == want_none and bool(y.get("why")))}
        rows.append({"kind": kind, "bars": [bars, want_bars], "busy": [got_busy, round(want_busy, 1)], "timed": [timed, want_timed],
                     "noEnd": no_end, "skipped": skipped.get(kind, ""), "ok": ok})
        bad += [f"{kind} {k}" for k, v in ok.items() if not v]
    if args.json:
        print(json.dumps({"rows": rows, "bad": bad}, ensure_ascii=False, indent=1, default=str))
    else:
        print(f"{'書き方':<9} {'棒 答え/正':>11} {'稼働(分) 答え/正':>20} {'作業時間の分かる本数':>16}  判定")
        for r in rows:
            mark = "OK" if all(r["ok"].values()) else "NG: " + "・".join(k for k, v in r["ok"].items() if not v)
            print(f"{r['kind']:<9} {r['bars'][0]:>5}/{r['bars'][1]:<5} {str(r['busy'][0]):>9}/{r['busy'][1]:<9} {str(r['timed'][0]):>8}/{r['timed'][1]:<7}  {mark}"
                  + (f"  （読めない: {r['skipped']}）" if r["skipped"] else ""))
        print(f"\n{len(KINDS) - len({b.split()[0] for b in bad})}/{len(KINDS)} の書き方で合いました。" + (" 外れ: " + "、".join(bad) if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
