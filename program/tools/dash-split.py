# -*- coding: utf-8 -*-
"""ダッシュボードのパネルごとの時間を、数える所（pivot.query_many）・稼働の読み込み（operation.read_ops）・それ以外（段取り・後の組み立て）に分けて測る
（版 3.62.0 の移し方を決めるための評価関数。開発用）。

    python tools/dash-split.py

tools/dash-bench.py と同じ大きな試験データ（作業実績 11 台 × 2,000 行・仕掛 20,000・品質 20,000）で、組み込みの標準ダッシュボードの全パネルと、
稼働（ガント・ABC）・設備の分け方（重ねる・並べる）のパネルを、控えを空にして 1 枚ずつ問い合わせる。"""
import importlib.util
import os
import sys
import time
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
os.chdir(PROGRAM)
sys.path.insert(0, str(PROGRAM))
sys.path.insert(0, str(PROGRAM / "tools"))

from app.services import operation, pivot  # noqa: E402

BASE = {"x": 0, "y": 0, "w": 6, "h": 4}
EXTRA = [
    ("ops", {**BASE, "id": "g", "title": "ガント", "visual": "gantt", "source": "work", "body": {"rows": [], "cols": [], "measures": [{"agg": "count"}]}}),
    ("ops", {**BASE, "id": "a", "title": "ABC", "visual": "abc", "source": "work", "body": {"rows": [], "cols": [], "measures": [{"agg": "count"}]},
             "ops": {"cls": ["合金"], "qty": "lots"}}),
    ("split", {**BASE, "id": "s", "title": "設備ごと", "visual": "line", "source": "work", "equips": ["CR1", "CR2", "L-1"], "esplit": "series",
               "body": {"rows": [{"column": "@workday"}], "cols": [], "measures": [{"agg": "lots"}]}, "period": {"column": "@workday", "kind": "days", "n": 14}}),
    ("facet", {**BASE, "id": "f", "title": "並べる", "visual": "bar", "source": "work", "equips": ["CR1", "CR2"], "esplit": "facet",
               "body": {"rows": [{"column": "@shift"}], "cols": [], "measures": [{"agg": "count"}]}}),
]


def bench_module():
    spec = importlib.util.spec_from_file_location("dash_bench", PROGRAM / "tools" / "dash-bench.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def timed(mod, name, key, spent):
    """mod.name を、かかった時間を spent[key] に足す形に替える"""
    f = getattr(mod, name)

    def g(*a, **k):
        t = time.perf_counter()
        try:
            return f(*a, **k)
        finally:
            spent[key] += time.perf_counter() - t
    setattr(mod, name, g)


def main():
    app = bench_module().build(2000, 11)
    c = app.test_client()
    items = c.get("/api/dashboards").get_json().get("items") or []
    panels = [(it.get("name"), p) for it in items for p in (it.get("body") or {}).get("panels") or []] + EXTRA
    print("dashboards", len(items), "panels", len(panels))
    spent = {"pivot": 0.0, "ops": 0.0}
    timed(pivot, "query_many", "pivot", spent)
    timed(operation, "read_ops", "ops", spent)
    rows = []
    for name, p in panels:
        spent.update(pivot=0.0, ops=0.0)
        app.config.pop("DASH_CACHE", None)
        t = time.perf_counter()
        r = c.post("/api/dashboard/query", json={"panel": p})
        ms = (time.perf_counter() - t) * 1000
        rows.append((name, p.get("title") or p.get("visual"), p.get("visual"), r.status_code, round(ms, 1),
                     round(spent["pivot"] * 1000, 1), round(spent["ops"] * 1000, 1)))
    for x in rows:
        print(x)
    tot = [sum(x[i] for x in rows) for i in (4, 5, 6)]
    print("total ms", tot, "pivot share", round(tot[1] / tot[0], 3), "ops share", round(tot[2] / tot[0], 3))


if __name__ == "__main__":
    main()
