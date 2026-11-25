# -*- coding: utf-8 -*-
"""一覧の道（lists）の場面の台本（版 3.116.0。標準の部品だけ。app を import しない）。

    python tests/lists_scene.py 作業フォルダ

作業実績・仕掛・品質の SQLite と、結合の相手のマスタを作業フォルダに作る。前の版の答え合わせ役（lists）と、Python 無しの形
（TPA_NO_PYTHON=1）の窓の試験（desktop/tests/lists_parity.rs。焼いた表は指紋だけを持ち、ここが作り直した物と比べる）が同じ台本を呼ぶ。
結合の基（quality_s・wip_s）と重なりマスタは小さくしてある（結合の答えの行を表に全部持つため。版 3.116.0 の採点の first_fixes 3）。
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests import lotlist_fixture  # noqa: E402  （標準の部品だけ）

DBS = ("work", "box", "split", "contains", "empty", "wip", "quality", "quality_s", "wip_s")
MASTERS = ("製造条件マスタ", "設備マスタ", "重なりマスタ")
# 時刻が別の列にある作業実績（作業開始_日付 ＋ 作業開始_時刻）と、書き方のゆれ
SPLIT_ROWS = [
    ("A1", "2026/10/01", "8:15", 10.5), ("A2", "2026/10/01", "8:15", "1,200"), ("A3", "2026/10/01", "午後 8:15", 3),
    ("A4", "2026-10-02", "8:15:30 PM", None), ("A5", "20261002", "23:30", 2.5), ("A6", "２０２６/１０/０３", "６:４５", "x"),
    ("A7", "2026/10/03 2:10", "9:99", 1), ("A8", "", "8:00", 4), ("A9", "不明", "", 5), ("B1", 20261003064500, None, 1),
    ("B2", "2026/10/04", None, 1), ("B3", "2026/10/04T05:59", "", 2), ("B4", "26/10/05 23:48:54", "", 1), ("B5", "2026年10月5日", "7:00", 1),
    ("B6", "2026/10/06 12:00 AM", "", 1), ("B7", "2026/10/06 12:30 pm", "", 1), ("B8", "2026/10/06 0:30 a.m.", "", 1),
    ("B9", "2026/10/07 24:10", "", 1), ("C1", "2026.10.7 7:00:00.5", "", 1), ("C2", None, None, 1), ("C3", "2026/10/07 7:00", "", " 7 "),
]

def make_split(path):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 作業実績 ([ロット番号], [作業開始_日付], [作業開始_時刻], [重量])")
    c.executemany("INSERT INTO 作業実績 VALUES (?,?,?,?)", SPLIT_ROWS)
    c.commit()
    c.close()


def make_contains(path):
    """候補の名前を含む表（BOX作業実績_2026）と、ほかの表。候補を「含む名前」で選ぶ所"""
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE aaa ([x])")
    c.execute("CREATE TABLE BOX作業実績_2026 ([ロット番号], [BOX実績_作業開始_日付], [重量])")
    c.executemany("INSERT INTO BOX作業実績_2026 VALUES (?,?,?)", [("L1", "2026/10/01 8:00", 1), ("L2", "2026/10/01 8:00", 2), ("L3", "", 3)])
    c.commit()
    c.close()


def make_empty(path):
    sqlite3.connect(path).close()


def make_dup(path):
    """相手の方が多く（480 行。基は 160 行）、鍵が NULL・空・前後の空白・大小のゆれ・重なり（当たる設備は 3 行ずつ）を持つ表"""
    from tests.lotlist_fixture import EQUIPMENT
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 設備 ([設備名], [材質], [ライン])")
    rows = []
    for i in range(480):
        if i < 30:                                  # 当たる設備は 3 行ずつ重なる（NULL・空・前後の空白と大小のゆれも）
            e = EQUIPMENT[i % len(EQUIPMENT)]
            e = None if i % 11 == 0 else "" if i % 13 == 0 else (f" {e.lower()} " if i % 7 == 0 else e)
            m = ("A1100", "A5052", None, "a3004 ")[i % 4]
        else:                                       # 当たらない行（相手の方が多い）
            e, m = f"無い設備{i}", f"M{i}"
        rows.append((e, m, f"線{i % 6}"))
    c.executemany("INSERT INTO 設備 VALUES (?,?,?)", rows)
    c.commit()
    c.close()


def build(work):
    """→ ({名前: DB の場所}, {名前: マスタの場所})。作り直す（前の物は消す）"""
    import shutil
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    dbs = {k: str(work / f"{k}.sqlite3") for k in DBS}
    for p in dbs.values():
        Path(p).unlink(missing_ok=True)
    lotlist_fixture.make_work(dbs["work"], "CAL", n=400)
    lotlist_fixture.make_work_box(dbs["box"])
    make_split(dbs["split"])
    make_contains(dbs["contains"])
    make_empty(dbs["empty"])
    lotlist_fixture.make_wip(dbs["wip"], n=600)
    lotlist_fixture.make(dbs["quality"], 800)
    # 結合の基（小さい物。行の作り方は同じ）
    lotlist_fixture.make(dbs["quality_s"], 160)
    lotlist_fixture.make_wip(dbs["wip_s"], n=120)
    shutil.rmtree(work / "masters", ignore_errors=True)
    masters = lotlist_fixture.make_masters(work / "masters")
    masters["重なりマスタ"] = work / "masters" / "重なりマスタ.sqlite3"
    make_dup(masters["重なりマスタ"])
    return dbs, masters


def made():
    """台本が作るファイル（場面の相対の道）"""
    return [f"{k}.sqlite3" for k in DBS] + [f"masters/{m}.sqlite3" for m in MASTERS]


if __name__ == "__main__":
    build(sys.argv[1])
