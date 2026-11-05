# -*- coding: utf-8 -*-
"""稼働（ガントチャート）・ABC 分析と換算係数の「正しい答え」を出す係（版 3.63.0。デスクトップ版の Rust の desktop/src/operation.rs・
dashboard.rs の稼働の道との突き合わせ。desktop/tests/ops_parity.rs が呼ぶ）。

    python tests/ops_oracle.py

tools/ops-bench.py の 9 つの書き方の設備（日時・日付＋14 桁・14 桁だけ・午前／午後・日時の数・日付＋時刻の列・焼鈍炉・日跨ぎ・作業終了が空）に、
分かれ道を初めから足す:
  EDGE   … 区間を出せない理由のすべて（空・時刻が無い・読めない・作業開始より前・7 日〈168 時間〉ちょうどと超え・作業開始が読めない）と、
           同じ作業開始の分割ロット（作業終了は遅い方）・作業開始が空の行・14 桁の数・日時の数の字
  MANY   … 5 分ごとの短い作業（棒の上限 1,500 本を超える）
  NOSTART・NOEND・BAD … 作業開始の列が無い・作業終了の列が無い・中身が SQLite でない
どの設備にも 調質・重量・色の列を足す（品種の組み合わせ・量の列・棒の字と色）。NIGHT だけ別の勤務体系（4,5直）。
POST /api/dashboard/query をガントと ABC の選び方ごとに Python の道で答える。設定を替えて問い直す段も持つ（版 3.63.0 の作った後の採点で足した）:
  足した設備 … 作った後の採点者の組（値の書き方: 字の数・ロット番号の空白と空・日付だけの作業開始・整数の日時の数・日時の数＋時刻の列・
               最後の作業の作業終了が日付だけ・ロット番号の列が無い設備・設備をまたぐロット／勤務体系: 0 時で終わる区分・翌日として数える 3直／
               設備ごとに違う作業開始の列）と、上限の両側（当たる行 400,000・線 50 本・基準の値 120 字・列名 200 字）
  いまを替える … 答えの控えを消さずに「いま」だけを替えて同じ組を問い直す（控えの鍵の時・作業日・今日・条件の今日）。組ごとに設定を持つ
  勤務体系が無い … 勤務時間・稼働率が出ない・作業日の区切りが 0 時
    {"settings", "cases": [{"name", "panel", "status", "body"}],
     "phases": [{"name", "settings", "cases": [{…, "settings"（あれば、その組の前に尋ね直す設定）}]}], "workFolder"}
窓の試験は段の始めと、設定を持つ組の前で一覧の設定を尋ね直す（答えの控えは消さない）。
"""
import importlib.util
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.update(TPA_SHELL="desktop", TPA_SHELL_SERVES="lotlist,lists")

spec = importlib.util.spec_from_file_location("ops_bench", PROGRAM / "tools" / "ops-bench.py")
ob = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ob)

from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.services import shifts, work_log  # noqa: E402

S0, E0, S14, E14 = ob.S0, ob.E0, ob.S14, ob.E14


def add_columns(path, i):
    """調質（品種の組み合わせ）・重量（量の列）・色の列（棒の色）を足す"""
    c = sqlite3.connect(path)
    for col, typ in (("調質", "TEXT"), ("重量", "REAL"), ("色", "TEXT")):
        c.execute(f"ALTER TABLE 実績 ADD COLUMN [{col}] {typ}")
    c.execute("UPDATE 実績 SET 調質 = CASE rowid % 3 WHEN 0 THEN 'H14' WHEN 1 THEN 'O' ELSE 'H24' END, "
              f"重量 = (rowid * 37 + {i}) % 900 / 10.0 + 1, 色 = CASE WHEN rowid % 4 = 0 THEN '' ELSE '色' || (rowid % 3) END")
    c.commit()
    c.close()


def edge_rows():
    """EDGE の行: (ロット, 作業開始, 作業終了, 合金)。前日（10/2 7:00〜10/3 7:00）に入れる"""
    d = "2026/10/02"
    return [
        ("E01", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"),
        ("E02", f"{d} 8:00:00", f"{d} 9:30:00", "A1100"),          # 同じ作業開始の分割ロット（作業終了は遅い方）
        ("E03", f"{d} 10:00:00", "", "A5052"),                     # 空
        ("E04", f"{d} 11:00:00", f"{d}", "A5052"),                 # 時刻が無い
        ("E05", f"{d} 12:00:00", "あいう", "A3004"),               # 読めない
        ("E06", f"{d} 13:00:00", f"{d} 12:00:00", "A3004"),        # 作業開始より前（同じ日の前の時刻は翌日と読む → 24 時間後）
        ("E07", f"{d} 14:00:00", "2026/10/02 13:59:00x", "A1100"),
        ("E08", "2026/09/25 14:00:00", f"{d} 14:00:00", "A1100"),  # 7 日（168 時間）ちょうど（期間より前から続く）
        ("E09", "2026/09/25 13:59:00", f"{d} 14:00:00", "A1100"),  # 168 時間を 1 分超える
        ("E10", "あとで", f"{d} 15:00:00", "A5052"),               # 作業開始が読めない
        ("E11", "", "", "A5052"),                                  # 作業開始が空
        ("E12", "20261002160000", "20261002170000", "A3004"),      # 14 桁の字
        ("E13", "46297.75", "46297.79166667", "A3004"),            # 日時の数の字（18:00〜19:00）
        ("E14", f"{d} 20:00:00", "2026/10/01 21:00:00", "A1100"),  # 作業終了が前の日（作業開始より前）
        ("E15", f"{d} 23:00:00", f"{d} 1:30:00", "A1100"),         # 日跨ぎ（作業終了の日付が作業開始の日のまま）
        ("E16", "2026/10/03 6:00:00", "", "A5052"),                # 作業日の最後の作業（いまは 10/3 10:00。前日の作業日の中）
    ]


def write_rows(path, rows):
    c = sqlite3.connect(path)
    c.execute(f"CREATE TABLE 実績 (ロット番号, [{S0}], [{E0}], 合金)")
    c.executemany("INSERT INTO 実績 VALUES (?, ?, ?, ?)", rows)
    c.commit()
    c.close()


def build():
    app, _truth = ob.build()
    folder = ob.WORK / "実績"
    write_rows(folder / "実績_EDGE.sqlite3", edge_rows())
    t, rows = ob.datetime(2026, 9, 26, 7, 0), []
    while t < ob.NOW:
        rows.append((f"M{len(rows):05d}", f"{t:%Y/%m/%d %H:%M:%S}", f"{t + timedelta(minutes=4):%Y/%m/%d %H:%M:%S}", ["A1100", "A5052"][len(rows) % 2]))
        t += timedelta(minutes=5)
    write_rows(folder / "実績_MANY.sqlite3", rows)
    c = sqlite3.connect(folder / "実績_NOSTART.sqlite3")
    c.executescript("CREATE TABLE 実績 (ロット番号, 合金); INSERT INTO 実績 VALUES ('N1', 'A1100');")
    c.close()
    c = sqlite3.connect(folder / "実績_NOEND.sqlite3")
    c.executescript(f"CREATE TABLE 実績 (ロット番号, [{S0}], 合金); INSERT INTO 実績 VALUES ('N1', '2026/10/02 8:00:00', 'A1100');")
    c.close()
    (folder / "実績_BAD.sqlite3").write_text("SQLite ではない中身", encoding="utf-8")
    for i, f in enumerate(sorted(folder.glob("実績_*.sqlite3"))):
        if f.stem not in ("実績_NOSTART", "実績_NOEND", "実績_BAD"):
            add_columns(f, i)
    repo = MasterRepository(app.config["MASTER_STORE"])
    repo.work_log_sync([{**x, "fid": ""} for x in work_log.scan(folder, "実績_*.sqlite3")])
    repo.shift_create(shifts.clean_row({"name": "NIGHT の 4,5直", "equipment": ["NIGHT"], "segments": shifts.TEMPLATES[2]["segments"]}))
    return app, repo


def pv(visual, **kw):
    ops = kw.pop("ops", {})
    return {"id": "g1", "title": kw.pop("title", ""), "visual": visual, "source": kw.pop("source", "work"),
            "body": {"rows": [], "cols": [], "measures": [{"agg": "lots"}]}, "ops": ops, **kw}


# ---------------------------------------------------------------- 足した設備（版 3.63.0 の作った後の採点で足した組）
LONGCOL = "長い列名" + "あ" * 140          # 144 字（列名は 200 字まで）
LONGV = "品種" + "い" * 70                 # 72 字（基準の値は 120 字まで）
COL200 = "列" * 200                        # 列名の上限ちょうど
VAL120 = "値" * 120                        # 基準の値の上限ちょうど
HUGE_ROWS = 400_001                        # 当たる行の上限（400,000）を 1 行超える


def make(path, cols, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in cols) + ")")
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    c.commit()
    c.close()


def add_equips(repo):
    """足す設備の表と勤務体系（前の組の「すべての設備」の意味を変えないよう、前の組を答えてから足す）"""
    f, d = ob.WORK / "実績", "2026/10/02"
    make(f / "実績_TXT.sqlite3", ["ロット番号", S0, E0, "合金", "重量字", LONGCOL], [       # 字の数・ロット番号の空白と空・長い列名と品種
        ("T001 ", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", "12.5", "x1"),
        ("T002", f"{d} 9:30:00", f"{d} 11:00:00", "A5052", " 30 ", "x2"),
        (None, f"{d} 12:00:00", f"{d} 13:00:00", "A5052", "7", "x3"),
        ("", f"{d} 14:00:00", f"{d} 15:30:00", LONGV, "1e1", "x4"),
        ("T005", f"{d} 16:00:00", f"{d} 23:30:00", LONGV, "abc", "x5")])
    make(f / "実績_TXT2.sqlite3", ["ロット番号", S0, E0, "合金", "重量字"], [               # 同じロットの後の工程
        ("T001", f"{d} 10:00:00", f"{d} 12:00:00", "A1100", "1"),
        ("T002", f"{d} 13:00:00", f"{d} 14:00:00", "A5052", "2"),
        (None, f"{d} 15:00:00", f"{d} 16:00:00", "A5052", "3")])
    make(f / "実績_DATEONLY.sqlite3", ["ロット番号", S0, E0, "合金"], [                       # 作業開始が日付だけ（同じ字の行が 3 つ）
        ("D1", d, f"{d} 9:00:00", "A1100"), ("D2", d, f"{d} 10:00:00", "A1100"), ("D3", d, f"{d} 11:00:00", "A5052"),
        ("D4", f"{d} 12:00:00", f"{d} 13:00:00", "A5052")])
    make(f / "実績_INTSER.sqlite3", ["ロット番号", S0, E0, "合金"], [                         # 整数の日時の数（真夜中）
        ("I1", 46297, 46297.25, "A1100"), ("I2", 46297.5, 46298, "A5052")])
    make(f / "実績_SERTIME.sqlite3", ["ロット番号", S0, ob.ST, E0, ob.ET, "合金"], [          # 日時の数と時刻の列
        ("S1", 46297.0, "08:00:00", 46297.0, "09:30:00", "A1100"), ("S2", 46297.0, "10:00:00", 46297.0, "12:00:00", "A5052")])
    make(f / "実績_TXTSER.sqlite3", ["ロット番号", S0, E0, "合金"], [                         # 日時の数の字で .0
        ("X1", "46297.0", "46297.5", "A1100"), ("X2", "46297.5", "46298.0", "A5052")])
    make(f / "実績_NOLOT.sqlite3", [S0, E0, "合金"], [(f"{d} 8:00:00", f"{d} 9:00:00", "A1100"), (f"{d} 10:00:00", f"{d} 12:00:00", "A5052")])
    make(f / "実績_LASTNT.sqlite3", ["ロット番号", S0, E0, "合金"], [                         # 最後の作業の作業終了が日付だけ
        ("N1", "2026/10/03 7:30:00", "2026/10/03 8:00:00", "A1100"), ("N2", "2026/10/03 8:30:00", "2026/10/03", "A5052")])
    make(f / "実績_LA.sqlite3", ["ロット番号", S0, E0, "合金"], [                             # 設備をまたぐロット（期間の 3 日以上後の工程）
        ("Z1", "2026-09-26 10:00:00", "2026-09-26 11:00:00", "A1100"), ("Z2", "2026-09-26 12:00:00", "2026-09-26 13:00:00", "A1100"),
        ("Z3", "2026-09-20 12:00:00", "2026-09-20 13:00:00", "A5052")])
    make(f / "実績_LB.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("Z1", "2026-10-01 10:00:00", "2026-10-01 11:00:00", "A1100"), ("Z3", "2026-09-26 15:00:00", "2026-09-26 16:00:00", "A5052")])
    make(f / "実績_BIGNAME.sqlite3", ["ロット番号", S0, E0, COL200], [                        # 列名 200 字・値 120 字
        ("B1", f"{d} 8:00:00", f"{d} 9:00:00", VAL120), ("B2", f"{d} 9:00:00", f"{d} 11:00:00", VAL120),
        ("B3", f"{d} 12:00:00", f"{d} 12:30:00", "短い")])
    make(f / "実績_HUGE.sqlite3", ["ロット番号", S0, E0, "合金"],                              # 当たる行が上限を 1 行超える（X を除けばちょうど）
         [("X" if i == 0 else f"H{i}", f"{d} 8:00:00", f"{d} 9:00:00", "A1100") for i in range(HUGE_ROWS)])
    # 2 回目の採点で足した組: 整数の量と品種・空白だけの作業終了・重なる作業・名前に作業開始／作業終了の無い列を選ぶ・作業終了_日時・
    # 作業終了＝作業開始・秒のある時刻・いちばん多い品種の作業時間が分からない
    make(f / "実績_INTQ.sqlite3", ["ロット番号", S0, E0, "合金", "本数", "板厚"], [
        ("Q1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", 3, 2), ("Q2", f"{d} 9:30:00", f"{d} 11:00:00", "A5052", 5, 3),
        ("Q3", f"{d} 12:00:00", f"{d} 13:00:00", "A5052", 7, 3), ("Q4", f"{d} 14:00:00", f"{d} 15:00:00", "A1100", 1, None)])
    make(f / "実績_SPACE.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("W1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"), ("W2", f"{d} 10:00:00", "   ", "A5052"), ("W3", "2026/10/03 8:00:00", " ", "A1100")])
    make(f / "実績_OVER.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("O1", f"{d} 8:00:00", f"{d} 12:00:00", "A1100"), ("O2", f"{d} 9:00:00", f"{d} 10:00:00", "A5052"),
        ("O3", f"{d} 11:00:00", f"{d} 13:00:00", "A1100"), ("O4", f"{d} 18:00:00", "2026/10/03 9:00:00", "A5052")])
    make(f / "実績_TWOEND.sqlite3", ["ロット番号", S0, E0, "炉出日時", "合金"], [
        ("T1", f"{d} 8:00:00", f"{d} 9:00:00", f"{d} 10:00:00", "A1100"), ("T2", f"{d} 11:00:00", f"{d} 12:00:00", f"{d} 14:30:00", "A5052")])
    make(f / "実績_ENDDT.sqlite3", ["ロット番号", "作業開始日時", "作業終了_日時", "合金"], [
        ("U1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"), ("U2", f"{d} 10:00:00", f"{d} 12:00:00", "A5052")])
    make(f / "実績_SAME.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("S1", f"{d} 8:00:00", f"{d} 8:00:00", "A1100"), ("S2", f"{d} 9:00:00", f"{d} 10:00:00", "A5052")])
    make(f / "実績_SEC.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("C1", f"{d} 8:00:20", f"{d} 9:01:45", "A1100"), ("C2", f"{d} 9:30:10", f"{d} 11:02:59", "A1100"), ("C3", f"{d} 12:00:07", f"{d} 12:41:00", "A5052")])
    make(f / "実績_TWOSTART.sqlite3", ["ロット番号", S0, "炉入日時", E0, "合金"], [
        ("V1", f"{d} 8:00:00", f"{d} 8:40:00", f"{d} 10:00:00", "A1100"), ("V2", f"{d} 11:00:00", f"{d} 12:10:00", f"{d} 14:00:00", "A5052")])
    make(f / "実績_NOTIME.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("Y1", f"{d} 8:00:00", "", "A3004"), ("Y2", f"{d} 9:00:00", "", "A3004"), ("Y3", f"{d} 10:00:00", "", "A3004"),
        ("Y4", f"{d} 11:00:00", f"{d} 12:00:00", "A1100"), ("Y5", f"{d} 13:00:00", f"{d} 13:30:00", "A5052")])
    # 3 回目の採点で足した組: リードタイムの後の工程が期間の終わりのちょうど 62 日後（入る）と 63 日後（入らない）・
    # 作業開始が日付だけの同じロットが 2 つの設備に（値が違う）・工程ごとに値が変わるロット（値は最初の工程の行）
    make(f / "実績_GA.sqlite3", ["ロット番号", S0, E0, "合金"], [("L4", "2026/07/01 8:00:00", "2026/07/01 9:00:00", "A1100"),
                                                           ("L5", "2026/07/01 10:00:00", "2026/07/01 12:00:00", "A5052")])
    make(f / "実績_GB.sqlite3", ["ロット番号", S0, E0, "合金"], [("L4", "2026/09/01 8:00:00", "2026/09/01 9:00:00", "A1100"),
                                                           ("L5", "2026/09/02 8:00:00", "2026/09/02 9:00:00", "A5052")])
    make(f / "実績_LE.sqlite3", ["ロット番号", S0, E0, "合金", "重量"], [("J1", d, f"{d} 9:00:00", "A1100", 5.0)])
    make(f / "実績_LF.sqlite3", ["ロット番号", S0, E0, "合金", "重量"], [("J1", d, f"{d} 15:00:00", "A5052", 9.0)])
    make(f / "実績_LC.sqlite3", ["ロット番号", S0, E0, "合金", "調質", "重量"], [
        ("K1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", "O", 10.0), ("K2", f"{d} 9:00:00", f"{d} 10:00:00", "A5052", "O", 20.0)])
    make(f / "実績_LD.sqlite3", ["ロット番号", S0, E0, "合金", "調質", "重量"], [
        ("K1", f"{d} 12:00:00", f"{d} 13:00:00", "A1100", "H14", 7.5), ("K2", f"{d} 14:00:00", f"{d} 16:00:00", "A5052", "H24", 18.0)])
    # 4 回目の採点で足した組（P…）
    # P1: 点で区切った日付の字（作業開始・作業終了）
    make(f / "実績_DOT.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("D1", "2026.10.02 8:00", "2026.10.02 9:00", "A1100"), ("D2", f"{d} 10:00:00", "2026.10.02", "A1100"),
        ("D3", f"{d} 11:00:00", "2026.10.02 12:30:00", "A5052"), ("D4", f"{d} 13:00:00", "2026.10.2", "A5052")])
    # P2: 同じ作業開始の分割ロットで、作業終了の読めなさが行ごとに違う
    make(f / "実績_WHYMIX.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("W1", f"{d} 8:00:00", "", "A1100"), ("W2", f"{d} 8:00:00", "あいう", "A1100"),
        ("W3", f"{d} 9:00:00", "あいう", "A1100"), ("W4", f"{d} 9:00:00", d, "A1100"),
        ("W5", f"{d} 10:00:00", d, "A5052"), ("W6", f"{d} 10:00:00", "あいう", "A5052"),
        ("W7", f"{d} 11:00:00", "あいう", "A5052"), ("W8", f"{d} 11:00:00", "", "A5052"),
        ("W9", f"{d} 12:00:00", None, "A5052"), ("WA", f"{d} 12:00:00", "あいう", "A5052")])
    # P3: 作業開始に「開始」の無い列（炉入日時）を選び、作業終了は見つけさせる
    make(f / "実績_FURNO.sqlite3", ["ロット番号", "炉入日時", "炉出日時", "作業終了_日付", "合金"], [
        ("F1", f"{d} 8:00:00", f"{d} 9:00:00", f"{d} 9:30:00", "A1100"), ("F2", f"{d} 10:00:00", f"{d} 12:00:00", f"{d} 12:30:00", "A5052")])
    # P4: 作業終了の列が見つからない（完了日時）
    make(f / "実績_NOEND2.sqlite3", ["ロット番号", "作業開始日時", "完了日時", "合金"], [
        ("G1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100")])
    # P5: 字の列（調質）が片方の設備にだけある
    make(f / "実績_LB1.sqlite3", ["ロット番号", S0, E0, "合金", "調質"], [("K1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", "O")])
    make(f / "実績_LB2.sqlite3", ["ロット番号", S0, E0, "合金"], [("K2", f"{d} 8:00:00", f"{d} 9:00:00", "A1100")])
    # P6: 作業開始が日付だけのロットが、期間の前・中・後の設備に（値が違う）
    make(f / "実績_DC1.sqlite3", ["ロット番号", S0, E0, "合金"], [("C9", "2026/09/30", "2026/09/30 9:00:00", "A1100"),
                                                          ("C7", "2026/10/02 8:00:00", "2026/10/02 9:00:00", "A1100")])
    make(f / "実績_DC2.sqlite3", ["ロット番号", S0, E0, "合金"], [("C9", "2026/10/03", "2026/10/03 9:00:00", "A5052"),
                                                          ("C8", "2026/10/03", "2026/10/03 9:00:00", "A5052")])
    make(f / "実績_DC3.sqlite3", ["ロット番号", S0, E0, "合金"], [("C8", "2026/10/09", "2026/10/09 9:00:00", "A3004"),
                                                          ("C7", "2026/10/09 8:00:00", "2026/10/09 9:00:00", "A3004")])
    # P7: いまちょうど始まった作業（いまは 10/3 10:00）
    make(f / "実績_RN.sqlite3", ["ロット番号", S0, E0, "合金"], [("R0", "2026/10/03 8:00:00", "2026/10/03 9:00:00", "A1100"),
                                                         ("R1", "2026/10/03 10:00:00", "", "A1100")])
    # P8: 2 工程のロットで最後の工程の作業終了が空
    make(f / "実績_LT1.sqlite3", ["ロット番号", S0, E0, "合金"], [("Q1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"),
                                                          ("Q3", f"{d} 8:30:00", f"{d} 9:00:00", "A5052")])
    make(f / "実績_LT2.sqlite3", ["ロット番号", S0, E0, "合金"], [("Q1", f"{d} 10:00:00", "", "A1100"), ("Q2", f"{d} 11:00:00", "", "A5052"),
                                                          ("Q3", f"{d} 11:30:00", "あいう", "A5052")])
    make(f / "実績_LT3.sqlite3", ["ロット番号", S0, E0, "合金"], [("Q3", f"{d} 13:00:00", "", "A5052")])
    # P14: 作業終了が NULL（SQLite の空のセル）。今日の最後の作業は いま動いている
    make(f / "実績_NULLEND.sqlite3", ["ロット番号", S0, E0, "合金"], [("N1", f"{d} 8:00:00", None, "A1100"), ("N3", f"{d} 9:00:00", f"{d} 10:00:00", "A1100"),
                                                              ("N2", "2026/10/03 9:00:00", None, "A5052")])
    # P17: ロット番号の列が無い設備だけでリードタイム
    make(f / "実績_LOTLESS.sqlite3", [S0, E0, "合金"], [(f"{d} 8:00:00", f"{d} 9:00:00", "A1100")])
    # P18: 本数の順と占有時間の順が逆（占有時間の計の足し方）
    make(f / "実績_OCC.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("O1", f"{d} 8:00:00", f"{d} 8:00:06", "A1100"), ("O2", f"{d} 8:10:00", f"{d} 8:10:06", "A1100"), ("O3", f"{d} 8:20:00", f"{d} 8:20:06", "A1100"),
        ("O4", f"{d} 9:00:00", "2026/10/05 13:00:18", "A5052"), ("O5", f"{d} 9:30:00", f"{d} 9:30:42", "A3004")])
    repo.work_log_sync([{**x, "fid": ""} for x in work_log.scan(f, "実績_*.sqlite3")])
    repo.shift_create(shifts.clean_row({"name": "TXT の 2 区分", "equipment": ["TXT"],                 # 0 時で終わる区分
                                        "segments": [{"name": "昼", "start": "08:00", "end": "16:00"}, {"name": "夕", "start": "16:00", "end": "00:00"}]}))
    repo.shift_create(shifts.clean_row({"name": "TXT2 の翌日の 3直", "equipment": ["TXT2"], "segments": [  # 翌日として数える 3直
        {"name": "1直", "start": "06:00", "end": "14:00"}, {"name": "2直", "start": "14:00", "end": "22:00"},
        {"name": "3直", "start": "22:00", "end": "06:00", "dayOffset": 1}]}))
    return ["TXT", "TXT2", "DATEONLY", "INTSER", "SERTIME", "TXTSER", "NOLOT", "LASTNT", "LA", "LB", "BIGNAME", "HUGE",
            "INTQ", "SPACE", "OVER", "TWOEND", "ENDDT", "SAME", "SEC", "TWOSTART", "NOTIME", "GA", "GB", "LE", "LF", "LC", "LD",
            "DOT", "WHYMIX", "FURNO", "NOEND2", "LB1", "LB2", "DC1", "DC2", "DC3", "RN", "LT1", "LT2", "LT3", "NULLEND", "LOTLESS", "OCC"]


def added_cases():
    yday = {"column": "@workday", "kind": "yesterday"}
    rng = {"column": "@workday", "kind": "range", "from": "2026-10-02", "to": "2026-10-03"}
    lims = lambda n: [round(i * 1.9, 1) for i in range(1, n + 1)]      # noqa: E731
    not_x = [{"column": "ロット番号", "op": "neq", "value": "X"}]
    return [
        ("足 ガント 0 時で終わる区分", pv("gantt", equips=["TXT"])),
        ("足 ガント n 日以内の条件", pv("gantt", equips=["STD"], period={"column": "@workday", "kind": "days", "n": 3},
                                    filters=[{"column": S0, "op": "within_days", "value": "1"}])),
        ("足 ABC n 日以内の条件", pv("abc", equips=["STD", "EDGE"], ops={"cls": "合金"}, filters=[{"column": S0, "op": "within_days", "value": "1"}])),
        ("足 ABC 量 字の数の列", pv("abc", equips=["TXT"], ops={"cls": "合金", "qty": "重量字"})),
        ("足 ABC リードタイム ロット番号の空白と空", pv("abc", equips=["TXT", "TXT2"], period=yday, ops={"cls": "合金", "span": "lead", "qty": "time"})),
        ("足 ABC リードタイム 全期間", pv("abc", equips=["TXT", "TXT2"], ops={"cls": "合金", "span": "lead"})),
        ("足 ABC 日付だけの作業開始", pv("abc", equips=["DATEONLY"], ops={"cls": "合金"})),
        ("足 ガント 日付だけの作業開始", pv("gantt", equips=["DATEONLY"])),
        ("足 ガント 整数の日時の数・時刻の列", pv("gantt", equips=["INTSER", "SERTIME"])),
        ("足 ABC 整数の日時の数・時刻の列", pv("abc", equips=["INTSER", "SERTIME"], ops={"cls": "合金", "qty": "time"})),
        ("足 ガント 日時の数の字 .0", pv("gantt", equips=["TXTSER"])),
        ("足 ABC 日時の数の字 .0", pv("abc", equips=["TXTSER"], ops={"cls": "合金", "qty": "time"})),
        ("足 ABC リードタイム ロット番号の列が無い設備がある", pv("abc", equips=["NOLOT", "TXT"], ops={"cls": "合金", "span": "lead"})),
        ("足 ガント 長い列名の字", pv("gantt", equips=["TXT"], ops={"label": LONGCOL})),
        ("足 ABC 長い列名の品種", pv("abc", equips=["TXT"], ops={"cls": LONGCOL})),
        ("足 ABC 長い品種の基準", pv("abc", equips=["TXT"], ops={"cls": "合金", "base": LONGV})),
        ("足 ABC いちばん多い品種が空欄", pv("abc", equips=["EDGE", "TXT"], ops={"cls": "ロット番号", "base": "top"})),
        ("足 ABC 品種の列なし・基準 top", pv("abc", equips=["STD"], ops={"base": "top"})),
        ("足 ガント 翌日として数える 3直", pv("gantt", equips=["TXT2"])),
        ("足 ガント 翌日として数える 3直 直近 3 日", pv("gantt", equips=["TXT2", "STD"], period={"column": "@workday", "kind": "days", "n": 3})),
        ("足 ガント 最後の作業の作業終了が日付だけ", pv("gantt", equips=["LASTNT"], period={"column": "@workday", "kind": "today"})),
        ("足 ガント 設備ごとに作業開始の列が違う", pv("gantt", equips=["ONLY14", "STD"])),
        ("足 ABC 設備ごとに作業開始の列が違う", pv("abc", equips=["ONLY14", "STD"], ops={"cls": "合金"})),
        ("足 ABC リードタイム 設備をまたぐロット 9/26", pv("abc", equips=["LA", "LB"], period={"column": "@workday", "kind": "range", "from": "2026-09-26", "to": "2026-09-26"},
                                                    ops={"cls": "合金", "span": "lead"})),
        ("足 ABC リードタイム 日付で決める 9/26〜9/27", pv("abc", equips=["STD", "YMDHMS", "NIGHT", "FURNACE"],
                                                      period={"column": "@workday", "kind": "range", "from": "2026-09-26", "to": "2026-09-27"}, ops={"cls": "合金", "span": "lead"})),
        ("足 ABC リードタイム 先月", pv("abc", equips=["STD", "YMDHMS", "NIGHT", "FURNACE"], period={"column": "@workday", "kind": "last_month"},
                                    ops={"cls": "合金", "span": "lead", "qty": "time"})),
        # 2 回目の採点で足した組
        ("足 ABC 量 整数の列", pv("abc", equips=["INTQ"], ops={"cls": "合金", "qty": "本数"})),
        ("足 ABC 品種 整数の列（NULL あり）", pv("abc", equips=["INTQ"], ops={"cls": "板厚"})),
        ("足 ガント 字と色 整数の列", pv("gantt", equips=["INTQ"], ops={"label": "本数", "color": "板厚"})),
        ("足 ガント 今日 空白だけの作業終了", pv("gantt", equips=["SPACE"], period={"column": "@workday", "kind": "today"})),
        ("足 ガント 前日 空白だけの作業終了", pv("gantt", equips=["SPACE"], period=yday)),
        ("足 ABC 空白だけの作業終了", pv("abc", equips=["SPACE"], ops={"cls": "合金"})),
        ("足 ガント 重なる作業", pv("gantt", equips=["OVER"])),
        ("足 ABC 重なる作業 作業時間", pv("abc", equips=["OVER"], ops={"cls": "合金", "qty": "time"})),
        ("足 ガント 作業終了の列を選ぶ（炉出日時）", pv("gantt", equips=["TWOEND"], ops={"end": "炉出日時"})),
        ("足 ABC 作業終了の列を選ぶ（炉出日時）", pv("abc", equips=["TWOEND"], ops={"end": "炉出日時", "cls": "合金", "qty": "time"})),
        ("足 ガント 作業開始の列を選ぶ（炉入日時）", pv("gantt", equips=["TWOSTART"], ops={"start": "炉入日時"})),
        # 作業開始・作業終了に計算列（版 3.73.0。利用者の知らせ 2026-11-05: 計算列で作業開始・作業終了を決めると効かない）
        ("足 ガント 作業開始・作業終了に計算列（日付＋時刻）", pv("gantt", equips=["TIMECOL"], ops={"start": "開始C", "end": "終了C"},
                                                       calc={"formulas": {"開始C": f"concat([{S0}], ' ', [{ob.ST}])", "終了C": f"concat([{E0}], ' ', [{ob.ET}])"}})),
        ("足 ABC 作業開始・作業終了に計算列（日付＋時刻）", pv("abc", equips=["TIMECOL"], ops={"start": "開始C", "end": "終了C", "cls": "合金", "qty": "time"},
                                                      calc={"formulas": {"開始C": f"concat([{S0}], ' ', [{ob.ST}])", "終了C": f"concat([{E0}], ' ', [{ob.ET}])"}})),
        ("足 ガント 作業開始・作業終了に計算列（元の列の写し）", pv("gantt", equips=["STD"], ops={"start": "始", "end": "終"},
                                                       calc={"formulas": {"始": f"[{S0}]", "終": f"[{E0}]"}})),
        ("足 ガント 作業終了だけ計算列（作業開始の写し: 作業終了が作業開始と同じ）", pv("gantt", equips=["STD"], ops={"end": "終30"},
                                                  calc={"formulas": {"終30": f"[{S0}]"}})),
        # 選んだ列の値が空・式が読めない（版 3.73.0）: 名前の似たほかの列（元の作業終了の列）へ黙って移らない
        ("足 ガント 選んだ作業終了の計算列が空", pv("gantt", equips=["STD"], ops={"end": "空の終"}, calc={"formulas": {"空の終": "''"}})),
        ("足 ABC 選んだ作業開始の計算列が空", pv("abc", equips=["STD"], ops={"start": "空の始", "cls": "合金"}, calc={"formulas": {"空の始": "''"}})),
        ("足 ガント 選んだ作業終了の計算列の式が読めない", pv("gantt", equips=["STD"], ops={"end": "壊れた終"}, calc={"formulas": {"壊れた終": "[作業終了"}})),
        ("足 ABC 選んだ作業開始の計算列の式が読めない", pv("abc", equips=["STD"], ops={"start": "壊れた始", "cls": "合金"}, calc={"formulas": {"壊れた始": "if("}})),
        # 設備ごとの式（版 3.74.0）: 同じ名前の計算列が設備で違う式。設備ごとにその設備の式で数える
        ("足 ガント 設備ごとの式（作業終了）", pv("gantt", equips=["STD", "SAME", "TWOEND"], ops={"end": "終C"},
                                         calc={"formulas": {"終C": f"[{S0}]"}, "equips": {"STD": {"formulas": {"終C": f"[{E0}]"}}, "TWOEND": {"formulas": {"終C": "[炉出日時]"}}}})),
        ("足 ABC 設備ごとの式（品種と作業終了）", pv("abc", equips=["STD", "TWOEND"], ops={"end": "終C", "cls": "品C", "qty": "time"},
                                            calc={"formulas": {"終C": f"[{E0}]", "品C": "[合金]"}, "equips": {"TWOEND": {"formulas": {"終C": "[炉出日時]", "品C": "'炉'"}}}})),
        ("足 ABC 作業開始の列を選ぶ（炉入日時）", pv("abc", equips=["TWOSTART"], ops={"start": "炉入日時", "cls": "合金", "qty": "time"})),
        ("足 ガント 作業終了_日時（最後の探し方）", pv("gantt", equips=["ENDDT"])),
        ("足 ABC 作業終了_日時（最後の探し方）", pv("abc", equips=["ENDDT"], ops={"cls": "合金"})),
        ("足 ガント 作業終了が作業開始と同じ時刻", pv("gantt", equips=["SAME"])),
        ("足 ABC 作業終了が作業開始と同じ時刻", pv("abc", equips=["SAME"], ops={"cls": "合金", "qty": "time"})),
        ("足 ガント 前日 設備 3 つ", pv("gantt", equips=["STD", "OVER", "SAME"])),
        ("足 ABC 全期間 リードタイム 設備 3 つ（手で並べる）", pv("abc", equips=["STD", "TWOEND", "SAME"], eorder=["SAME", "TWOEND"], ops={"cls": "合金", "span": "lead"})),
        ("足 ABC 設備 3 つ（手で並べる。今の並びと逆）", pv("abc", equips=["STD", "TWOEND", "SAME"], eorder=["SAME", "TWOEND", "STD"], ops={"cls": "合金"})),
        ("足 ABC 基準の期間・設備ごと（手で並べる）", pv("abc", equips=["STD", "NIGHT"], eorder=["NIGHT"], period=yday, ops={"cls": "合金", "refPeriod": {"kind": "days", "n": 5}})),
        ("足 ABC 基準の期間 リードタイム", pv("abc", equips=["STD", "NIGHT"], period=yday, ops={"cls": "合金", "span": "lead", "refPeriod": {"kind": "days", "n": 4}})),
        ("足 ABC 秒のある時刻 作業時間", pv("abc", equips=["SEC"], ops={"cls": "合金", "qty": "time"})),
        ("足 ガント 秒のある時刻", pv("gantt", equips=["SEC"])),
        ("足 ABC 基準 いちばん多い品種の作業時間が分からない", pv("abc", equips=["NOTIME"], ops={"cls": "合金", "base": "top"})),
        ("足 ABC 品種 2 列（長い列名 144 字）", pv("abc", equips=["TXT"], ops={"cls": ["合金", LONGCOL]})),
        ("足 ABC 線 字で（画面の入力欄）", pv("abc", equips=["STD"], ops={"cls": "合金", "lims": ["60", "85"]})),
        ("足 ABC 読めない計算列の品種", pv("abc", equips=["STD"], ops={"cls": "壊"}, calc={"formulas": {"壊": "[合金"}})),
        # 3 回目の採点で足した組
        ("足 ABC リードタイム 後の工程が期間の 62 日後・63 日後", pv("abc", equips=["GA", "GB"], period={"column": "@workday", "kind": "range", "from": "2026-07-01", "to": "2026-07-01"},
                                                       ops={"cls": "合金", "span": "lead", "qty": "time"})),
        ("足 ABC リードタイム 日付だけの作業開始が 2 設備", pv("abc", equips=["LE", "LF"], ops={"cls": "合金", "span": "lead", "qty": "重量"})),
        ("足 ABC リードタイム 工程ごとに値が変わる", pv("abc", equips=["LC", "LD"], ops={"cls": ["合金", "調質"], "span": "lead", "qty": "重量"})),
        # 4 回目の採点で足した組
        ("4 P1 ガント 点の日付", pv("gantt", equips=["DOT"])),
        ("4 P1b ABC 点の日付", pv("abc", equips=["DOT"], ops={"cls": "合金", "qty": "time"})),
        ("4 P2 ガント 分割ロットの理由", pv("gantt", equips=["WHYMIX"])),
        ("4 P2b ABC 分割ロットの理由", pv("abc", equips=["WHYMIX"], ops={"cls": "合金"})),
        ("4 P3 ガント 炉入日時を選ぶ", pv("gantt", equips=["FURNO"], ops={"start": "炉入日時"})),
        ("4 P3b ABC 炉入日時を選ぶ", pv("abc", equips=["FURNO"], ops={"start": "炉入日時", "cls": "合金", "qty": "time"})),
        ("4 P4 ガント 作業終了の列が無い", pv("gantt", equips=["NOEND2", "STD"])),
        ("4 P4b ABC 作業終了の列が無い", pv("abc", equips=["NOEND2", "STD"], ops={"cls": "合金"})),
        ("4 P5 ガント 片方にだけある字の列", pv("gantt", equips=["LB1", "LB2"], ops={"label": "調質", "color": "調質"})),
        ("4 P5b ABC 片方にだけある品種の列", pv("abc", equips=["LB1", "LB2"], ops={"cls": ["合金", "調質"]})),
        ("4 P6 ABC リードタイム 日付だけ 前・中・後", pv("abc", equips=["DC1", "DC2", "DC3"], eorder=["DC1", "DC3", "DC2"], period=rng,
                                                ops={"cls": "合金", "span": "lead"})),
        ("4 P6b ABC リードタイム 日付だけ 後・中", pv("abc", equips=["DC1", "DC2", "DC3"], eorder=["DC3", "DC2", "DC1"], period=rng,
                                               ops={"cls": "合金", "span": "lead"})),
        ("4 P6c ガント 日付だけ", pv("gantt", equips=["DC1", "DC2", "DC3"], period=rng)),
        ("4 P7 ガント いまちょうど始まった作業", pv("gantt", equips=["RN"], period={"column": "@workday", "kind": "today"})),
        ("4 P8 ABC リードタイム 2 工程の最後が空", pv("abc", equips=["LT1", "LT2", "LT3"], ops={"cls": "合金", "span": "lead"})),
        ("4 P8b ABC リードタイム 前日 2 工程の最後が空", pv("abc", equips=["LT1", "LT2", "LT3"], period=yday, ops={"cls": "合金", "span": "lead", "qty": "time"})),
        ("4 P9 ABC 線 inf", pv("abc", equips=["STD"], ops={"cls": "合金", "lims": ["inf", 50]})),
        ("4 P9b ABC 線 nan・1e309", pv("abc", equips=["STD"], ops={"cls": "合金", "lims": ["nan", "1e309", 40]})),
        ("4 P9c ABC 線 Infinity と -inf", pv("abc", equips=["STD"], ops={"cls": "合金", "lims": ["Infinity", "-inf", 30]})),
        ("4 P10 ABC 量 time・基準 avg・品種の列なし 1 設備", pv("abc", equips=["RN"], period={"column": "@workday", "kind": "today"}, ops={"qty": "time"})),
        ("4 P11 ABC 作業時間の分かる作業が無い・基準 avg", pv("abc", equips=["LT2"], ops={"cls": "合金"})),
        ("4 P11b ABC 作業時間の分かる作業が無い・品種ごと", pv("abc", equips=["LT2"], ops={"cls": "合金", "rankBy": "each"})),
        ("4 P12 ABC 量 重量なし・品種ごと・線", pv("abc", equips=["STD", "LT1"], period=yday, ops={"cls": ["合金", "調質"], "rankBy": "each", "base": "top"})),
        ("4 P13 ガント 勤務体系の切れの作業日 直近 2 日", pv("gantt", equips=["STD", "NIGHT"], period={"column": "@workday", "kind": "days", "n": 2})),
        ("4 P15 ABC 線を全部消した（空の並び）", pv("abc", equips=["STD"], ops={"cls": "合金", "lims": []})),
        ("4 P15b ABC 線が読めない物だけ", pv("abc", equips=["STD"], ops={"cls": "合金", "lims": ["", -1, 0]})),
        ("4 P16 ガント 読めない計算列の字", pv("gantt", equips=["STD"], ops={"label": "壊"}, calc={"formulas": {"壊": "[合金"}})),
        ("4 P16b ABC 読めない計算列の品種 2 設備", pv("abc", equips=["STD", "NIGHT"], ops={"cls": ["合金", "壊"]}, calc={"formulas": {"壊": "[合金"}})),
        ("4 P17 ABC リードタイム ロット番号の列が無い設備だけ", pv("abc", equips=["LOTLESS"], ops={"cls": "合金", "span": "lead"})),
        ("4 P18 ABC 本数の順と占有時間の順が逆", pv("abc", equips=["OCC"], ops={"cls": "合金"})),
        ("4 P18b ABC 本数の順と占有時間の順が逆 作業時間", pv("abc", equips=["OCC"], ops={"cls": "合金", "qty": "time"})),
        ("4 P14 ガント 作業終了が NULL 前日", pv("gantt", equips=["NULLEND"])),
        ("4 P14b ガント 作業終了が NULL 今日（いま動いている）", pv("gantt", equips=["NULLEND"], period={"column": "@workday", "kind": "today"})),
        ("4 P14c ABC 作業終了が NULL", pv("abc", equips=["NULLEND"], ops={"cls": "合金", "qty": "time"})),
        # 上限の両側
        ("境 ABC 線 50 本（上限ちょうど）", pv("abc", equips=["MANY"], ops={"cls": "ロット番号", "lims": lims(50)})),
        ("境 ABC 線 51 本（50 本まで）", pv("abc", equips=["MANY"], ops={"cls": "ロット番号", "lims": lims(51)})),
        ("境 ABC 列名 200 字", pv("abc", equips=["BIGNAME"], ops={"cls": COL200, "base": VAL120})),
        ("境 ABC 列名 201 字・基準 121 字（切って当たる）", pv("abc", equips=["BIGNAME"], ops={"cls": COL200 + "x", "base": VAL120 + "y"})),
        ("境 ABC 基準 119 字（当たらない）", pv("abc", equips=["BIGNAME"], ops={"cls": COL200, "base": VAL120[:119]})),
        ("境 ガント 色と字の列名 200 字・201 字", pv("gantt", equips=["BIGNAME"], ops={"label": COL200, "color": COL200 + "x"})),
        ("境 ガント 当たる行 400,001（上限を超える）", pv("gantt", equips=["HUGE"])),
        ("境 ABC 当たる行 400,000（上限ちょうど）", pv("abc", equips=["HUGE"], ops={"cls": "合金"}, filters=not_x)),
    ]


def now_cases():
    """(名前, いま, パネル): 答えの控えを残したまま「いま」だけを替えて問い直す"""
    yday = {"column": "@workday", "kind": "yesterday"}
    g = pv("gantt", equips=["FURNACE", "BLANKEND"], period={"column": "@workday", "kind": "today"})
    a = pv("abc", equips=["STD"], period=yday, ops={"cls": "合金"})
    e = pv("abc", equips=["STD"], period={"column": E0, "kind": "yesterday"}, ops={"cls": "合金"})
    w = pv("abc", equips=["STD"], ops={"cls": "合金"}, filters=[{"column": S0, "op": "within_days", "value": "0"}])
    t = pv("gantt", equips=["STD", "NIGHT"], period={"column": "@workday", "kind": "today"})
    ta = pv("abc", equips=["STD", "NIGHT"], period={"column": "@workday", "kind": "today"}, ops={"cls": "合金"})
    return [("ガント いま 10:00", datetime(2026, 10, 3, 10, 0), g), ("ガント いま 11:30（同じ日・控えの鍵の時）", datetime(2026, 10, 3, 11, 30), g),
            ("ABC 前日 いま 10/3 06:30", datetime(2026, 10, 3, 6, 30), a), ("ABC 前日 いま 10/3 07:30（作業日が変わる）", datetime(2026, 10, 3, 7, 30), a),
            ("ABC 作業終了の日で前日 いま 10/2 23:30", datetime(2026, 10, 2, 23, 30), e),
            ("ABC 作業終了の日で前日 いま 10/3 00:30（日付が変わる）", datetime(2026, 10, 3, 0, 30), e),
            ("ABC n 日以内 いま 10/2 23:30", datetime(2026, 10, 2, 23, 30), w), ("ABC n 日以内 いま 10/3 00:30（条件の今日）", datetime(2026, 10, 3, 0, 30), w),
            ("ガント 今日 いま 06:00（設備ごとに作業日が違う）", datetime(2026, 10, 3, 6, 0), t), ("ABC 今日 いま 06:00", datetime(2026, 10, 3, 6, 0), ta)]


def cases():
    yday = {"column": "@workday", "kind": "yesterday"}
    calc = {"formulas": {"区分": "[合金] + '-' + [調質]"}}
    out = [
        # ガント
        ("ガント 既定（前日）", pv("gantt")),
        ("ガント 今日（いま動いている作業）", pv("gantt", period={"column": "@workday", "kind": "today"})),
        ("ガント 直近 3 日", pv("gantt", period={"column": "@workday", "kind": "days", "n": 3})),
        ("ガント 日付で決める", pv("gantt", period={"column": "@workday", "kind": "range", "from": "2026-09-30", "to": "2026-10-01"})),
        ("ガント 太陽暦", pv("gantt", basis="cal")),
        ("ガント 62 日（上限）", pv("gantt", period={"column": "@workday", "kind": "days", "n": 62}, equips=["STD"])),
        ("ガント 63 日（上限を超える）", pv("gantt", period={"column": "@workday", "kind": "days", "n": 63}, equips=["STD"])),
        ("ガント 字と色", pv("gantt", ops={"label": "合金", "color": "色"})),
        ("ガント 字と色（計算列）", pv("gantt", ops={"label": "区分", "color": "区分"}, calc=calc)),
        ("ガント 無い列の字", pv("gantt", ops={"label": "無い列"})),
        ("ガント 作業開始・作業終了の列を選ぶ（14 桁）", pv("gantt", ops={"start": S14, "end": E14}, equips=["YMDHMS", "ONLY14", "STD"])),
        ("ガント 無い作業終了の列", pv("gantt", ops={"end": "無い列"}, equips=["STD"])),
        ("ガント 設備を選ぶ・手で並べる", pv("gantt", equips=["STD", "NIGHT", "FURNACE"], eorder=["FURNACE", "STD"])),
        ("ガント 条件と検索", pv("gantt", filters=[{"column": "合金", "op": "neq", "value": "A3004"}], search="A1100")),
        ("ガント 日付の列の期間", pv("gantt", period={"column": S0, "kind": "days", "n": 2}, equips=["STD", "EDGE"])),
        ("ガント 日付の列でない期間（作業開始が日付だけの列）", pv("gantt", period={"column": E14, "kind": "days", "n": 2}, equips=["YMDHMS"])),
        ("ガント 無い列の期間", pv("gantt", period={"column": "無い列", "kind": "days", "n": 2}, equips=["STD"])),
        ("ガント 1 設備の鍵", pv("gantt", equip="")),
        ("ガント 境の設備（EDGE）", pv("gantt", equips=["EDGE"], period={"column": "@workday", "kind": "days", "n": 9})),
        ("ガント 棒の上限（MANY）", pv("gantt", equips=["MANY"], period={"column": "@workday", "kind": "days", "n": 7})),
        ("ガント 読めない設備だけ", pv("gantt", equips=["NOSTART", "NOEND"])),
        ("ガント 読めない設備（写し）", pv("gantt", equips=["BAD"])),
        ("ガント 読めない計算列", pv("gantt", ops={"label": "壊"}, calc={"formulas": {"壊": "[合金"}})),
        # ABC
        ("ABC 既定（全期間・本数）", pv("abc")),
        ("ABC 前日・品種 合金", pv("abc", period=yday, ops={"cls": "合金"})),
        ("ABC 品種 合金×調質", pv("abc", ops={"cls": ["合金", "調質", "合金"]})),
        ("ABC 品種 4 列（上限）", pv("abc", ops={"cls": ["合金", "調質", "色", "ロット番号", "重量"]}, equips=["STD"])),
        ("ABC 量 作業時間", pv("abc", ops={"cls": "合金", "qty": "time"})),
        ("ABC 量 重量の合計", pv("abc", ops={"cls": "合金", "qty": "重量"})),
        ("ABC 量 無い列", pv("abc", ops={"cls": "合金", "qty": "無い列"})),
        ("ABC 基準 いちばん多い品種", pv("abc", ops={"cls": "調質", "base": "top"})),
        ("ABC 基準 品種の値", pv("abc", ops={"cls": "合金", "base": "A5052"})),
        ("ABC 基準 無い品種", pv("abc", ops={"cls": "合金", "base": "X"})),
        ("ABC 線 3 本", pv("abc", ops={"cls": "ロット番号", "lims": [50, 80, 95]}, equips=["STD"])),
        ("ABC 線 前の a・b", pv("abc", ops={"cls": "合金", "a": 40, "b": "60"})),
        ("ABC 線 読めない・範囲の外", pv("abc", ops={"cls": "合金", "lims": [-5, 0, "x", 120, 33.33333, 33.33333]})),
        ("ABC 品種ごと", pv("abc", ops={"cls": "ロット番号", "rankBy": "each"}, equips=["STD"])),
        ("ABC リードタイム（全期間）", pv("abc", ops={"cls": "合金", "span": "lead"})),
        ("ABC リードタイム（前日・前後も読む）", pv("abc", period=yday, ops={"cls": "合金", "span": "lead", "qty": "time"})),
        ("ABC 基準の期間（地点 A）", pv("abc", period=yday, ops={"cls": "合金", "refPeriod": {"kind": "days", "n": 5}})),
        ("ABC 基準の期間に無い品種", pv("abc", period=yday, ops={"cls": "調質", "refPeriod": {"kind": "range", "from": "2026-09-23", "to": "2026-09-23"}})),
        ("ABC 基準の期間で数えられない", pv("abc", period=yday, equips=["STD"], ops={"cls": "合金", "refPeriod": {"kind": "days", "n": 2}},
                                         filters=[{"column": "無い列", "op": "eq", "value": "x"}])),
        ("ABC 条件・計算列の品種", pv("abc", ops={"cls": "区分"}, calc=calc, filters=[{"column": "調質", "op": "neq", "value": "O"}])),
        ("ABC 境の設備（EDGE・理由ごとの数）", pv("abc", equips=["EDGE"], ops={"cls": "合金", "qty": "time"})),
        ("ABC 手で並べる", pv("abc", equips=["STD", "NIGHT"], eorder=["NIGHT"], ops={"cls": "合金"})),
        ("ABC 読めない設備だけ", pv("abc", equips=["NOSTART", "BAD"])),
        ("ABC リードタイム（ロット番号の列が無い）", pv("abc", equips=["NOEND", "STD"], ops={"span": "lead", "cls": "合金"},
                                                   filters=[{"column": "ロット番号", "op": "eq", "value": "無い"}])),
        ("ABC 出さない項目", pv("abc", ops={"cls": "合金", "hide": ["chart", "foot", "x"]})),
        # 確かめ
        ("確かめ 稼働を品質で", pv("gantt", source="lot")),
        ("確かめ 稼働を仕掛で", pv("abc", source="src:wip")),
        ("確かめ 稼働に行の段（使わない）", {**pv("gantt"), "body": {"rows": [{"column": "合金"}], "cols": [{"column": "調質"}]}, "egroup": {"mode": "sum"}}),
    ]
    return out


def wait_copied(c, equips=None):
    """写しを作り終えてから数える（写し中の失敗を答えに入れない）"""
    panel = pv("gantt", **({"equips": equips} if equips else {}))
    for _ in range(80):
        r = c.post("/api/dashboard/query", json={"panel": panel})
        if not any(f.get("kind") == "copying" and f.get("name") != "BAD" for f in (r.get_json() or {}).get("failed") or []):
            break


def ask(c, name, panel):
    r = c.post("/api/dashboard/query", json={"panel": panel})
    return {"name": name, "panel": panel, "status": r.status_code, "body": r.get_json()}


def main():
    app, repo = build()
    c = app.test_client()
    wait_copied(c)
    rows = [ask(c, n, p) for n, p in cases()]
    settings = c.get("/api/lotlist/settings").get_json()
    phases = []
    added = add_equips(repo)
    wait_copied(c, added)
    phases.append({"name": "足した設備", "settings": c.get("/api/lotlist/settings").get_json(), "cases": [ask(c, n, p) for n, p in added_cases()]})
    keep_now, seq = app.config["DASHBOARD_NOW"], []
    for n, t, p in now_cases():
        app.config["DASHBOARD_NOW"] = t
        seq.append({**ask(c, n, p), "settings": c.get("/api/lotlist/settings").get_json()})
    app.config["DASHBOARD_NOW"] = keep_now
    phases.append({"name": "いまを替える（控えを残す）", "settings": seq[0]["settings"], "cases": seq})
    # 勤務体系を消す（勤務時間・稼働率が出ない・作業日の区切りが 0 時）
    for row in repo.shift_patterns():
        repo.shift_delete(row["id"])
    phases.append({"name": "勤務体系が無い", "settings": c.get("/api/lotlist/settings").get_json(),
                   "cases": [ask(c, n, p) for n, p in (("ガント 前日", pv("gantt")), ("ガント 直近 2 日", pv("gantt", period={"column": "@workday", "kind": "days", "n": 2})),
                                                      ("ABC 前日", pv("abc", period={"column": "@workday", "kind": "yesterday"}, ops={"cls": "合金"})))]})
    sys.stdout.reconfigure(encoding="utf-8")
    # 作業実績の元のフォルダ（窓の試験が、元のファイルを書き換えて写し直したら数え直すかを確かめる）
    json.dump({"settings": settings, "cases": rows, "phases": phases, "workFolder": str(ob.WORK / "実績")}, sys.stdout, ensure_ascii=False, default=str)


if __name__ == "__main__":
    main()
