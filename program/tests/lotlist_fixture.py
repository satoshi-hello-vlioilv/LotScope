# -*- coding: utf-8 -*-
"""品質異常の試験用の品質データ（SQLite）と、問い合わせの組。

乱数の種を固定して、毎回同じ中身を作る。本物に近い「ゆれ」を入れる:
日本語・半角カナ・全角英数・空欄と NULL・いろいろな日付の書き方（2桁の年・和文・8桁・ISO・時刻つき・読めない字）・
数と数の字・同じロット番号の複数行（まとめ）・ロット番号が空の行・ビュー（行番号が無い）・WITHOUT ROWID の表。

Python の試験（test_lot_list.py）と、デスクトップ版の Rust との突き合わせ（desktop/tests/lotlist_parity.rs が
lotlist_oracle.py を通して使う）が同じものを使う。

    python tests/lotlist_fixture.py 出力.sqlite3 [行数]
"""
import json
import random
import sqlite3
import sys
from datetime import date, datetime, timedelta

TODAY = date(2026, 10, 2)      # 「〜日以内」の基準日（問い合わせに today として渡す）
EQUIPMENT = ["L-1", "L-2", "TLV", "LS3", "DL2", "CR1", "ＣＲ２", "ﾛｰﾙ1"]
DEFECTS = ["汚れ", "キズ", "ロール跡", "異物", "ﾍｺﾐ", "打痕", "", None]
COLUMNS = ["ロット番号", "発生日", "設備", "不良名", "重量", "板厚", "板幅", "合金", "調質", "客先", "検査日", "入力日時",
           "数量", "備考", "工程", "担当", "長さ", "比重", "鋳造番号", "検査番号"]


def _date_text(d, kind):
    return [d.strftime("%Y/%m/%d"), d.isoformat() + " 10:00", d.strftime("%Y%m%d"), d.strftime("%y/%m/%d 23:48:54"),
            f"{d.year}年{d.month}月{d.day}日", "", None, "不明", f"{d.year}.{d.month}.{d.day}"][kind]


WORK_COLUMNS = ["ロット番号", "BOX実績_作業開始_日付", "作業日", "開始", "終了", "作業区分", "作業者", "入側板厚", "出側板厚", "板幅", "重量", "速度",
                "合金", "調質", "備考", "BOX実績_作業終了_日付"]


def make_work(path, equipment, n=400, seed=11):
    """作業実績の試験用データ（設備ごとの実績 SQLite。表「実績」）。本物の列は分からないので、画面を確かめるための作り物。
    BOX実績_作業開始_日付 は作業開始の日時（Access の日時の書き方: 2026/10/01 8:15:00）。4 回に 1 回ほどの作業は幅・丈で分割して、
    同じ作業開始の行が 2〜4 行（別のロット番号）になる（作業実績の「作業でまとめる」で 1 作業と数える）。"""
    r = random.Random(f"{seed}-{equipment}")
    c = sqlite3.connect(path)
    c.execute("DROP TABLE IF EXISTS 実績")
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in WORK_COLUMNS) + ")")
    rows = []
    # 作業終了（版 3.46.0。ガントチャート・稼働率・換算係数）: 作業開始から、板厚と重量で決まる作業時間の後。乱数を使わない（ほかの列の値を変えない）
    def end_of(d, start, th, weight):
        t = datetime(d.year, d.month, d.day) + timedelta(minutes=start + round(12 + weight / 70 * (1 + 1 / th)))
        return f"{t:%Y/%m/%d} {t.hour}:{t.minute:02d}:00"
    while len(rows) < n:
        d = TODAY - timedelta(days=r.randint(0, 120))
        start = r.randint(0, 24 * 60 - 1)
        t0, t1 = f"{start // 60:02d}:{start % 60:02d}", f"{(start + 40) // 60 % 24:02d}:{(start + 40) % 60:02d}"
        stamp = f"{d:%Y/%m/%d} {start // 60}:{start % 60:02d}:00"
        th = r.choice([0.3, 0.5, 1.0, 2.0, 3.0])
        lot, kind, who = r.randint(1, 900), r.choice(["通常", "通常", "通常", "再処理", "試作"]), r.choice(["作業者A", "作業者B", "作業者C"])
        for k in range(r.choice([1, 1, 1, 2, 2, 3, 4]) if r.random() < 0.35 else 1):
            row = [f"L{lot:04d}C{(r.randint(0, 9) + k) % 10}", stamp, d.strftime("%Y/%m/%d"), t0, t1, kind, who, th,
                   round(th * r.uniform(0.5, 0.95), 3), r.randint(800, 1600), round(r.uniform(500, 6000), 1), r.randint(80, 600),
                   r.choice(["A1100", "A5052", "A3004"]), r.choice(["H14", "O", "H24"]), r.choice(["", "", "", "速度落とし", "ロール替え後", None])]
            rows.append(row + [end_of(d, start, th, row[10])])
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(WORK_COLUMNS)) + ")", rows[:n])
    c.commit()
    c.close()


def make_work_box(path, equipment="ANF", seed=17, now=None):
    """焼鈍炉（BOX）の作業実績の試験用データ（版 3.47.0。ガント・換算係数の「出ない設備」を画面で撮るため。本物の列の名前に合わせた作り物）。
    1 回の作業（炉に入れて出すまで）が 20〜50 時間・1 回に 3〜6 ロット（作業開始が同じ）。作業開始_日付 は日時、作業終了_日付 は日付だけで、
    時刻まで持つのは 年月日時分秒 の列（14 桁）。2 回は作業終了の書き忘れ（空）・いちばん新しい作業は、いま炉の中（作業終了がまだ無い）。
    ほかの列はほかの設備と同じ（WORK_COLUMNS。計算列・ほかのパネルがその列を使う）"""
    r = random.Random(f"{seed}-{equipment}")
    now = now or datetime.combine(TODAY + timedelta(days=1), datetime.min.time()).replace(hour=10)
    cols = WORK_COLUMNS + ["BOX実績_作業開始_年月日時分秒", "BOX実績_作業終了_年月日時分秒"]      # ほかの設備と同じ列（計算列・ほかのパネルが使う）＋ 14 桁の列
    c = sqlite3.connect(path)
    c.execute("DROP TABLE IF EXISTS 実績")
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in cols) + ")")
    rows, t, k, lot, forgot = [], now - timedelta(days=60), 0, 0, False
    while t < now:
        dur = timedelta(hours=r.randint(20, 50))
        miss = k == 7 or (not forgot and t.date() >= TODAY - timedelta(days=1))   # 7 回目と、前日ごろに入れた 1 回は書き忘れ。最後はいま炉の中
        forgot = forgot or miss and k != 7
        end = t + dur if t + dur < now and not miss else None
        alloy, temper = r.choice(["A1100", "A5052", "A3004", "A8079"]), r.choice(["O", "H24"])
        th, kind, who = r.choice([0.3, 0.5, 1.0]), r.choice(["通常", "通常", "再処理"]), r.choice(["作業者A", "作業者B"])     # 1 回の作業の中では同じ
        for _ in range(r.randint(3, 6)):
            lot += 1
            v = {"ロット番号": f"B{lot:05d}", "BOX実績_作業開始_日付": f"{t:%Y/%m/%d} {t.hour}:{t.minute:02d}:00", "作業日": f"{t:%Y/%m/%d}",
                 "開始": f"{t:%H:%M}", "終了": f"{end:%H:%M}" if end else "", "作業区分": kind, "作業者": who,
                 "入側板厚": th, "出側板厚": th, "板幅": r.randint(800, 1600), "重量": round(r.uniform(2000, 9000), 1), "速度": 0,
                 "合金": alloy, "調質": temper, "備考": "", "BOX実績_作業終了_日付": f"{end:%Y/%m/%d}" if end else "",
                 "BOX実績_作業開始_年月日時分秒": f"{t:%Y%m%d%H%M%S}", "BOX実績_作業終了_年月日時分秒": f"{end:%Y%m%d%H%M%S}" if end else ""}
            rows.append([v[x] for x in cols])
        t = t + dur + timedelta(minutes=r.randint(40, 180))
        k += 1
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    c.commit()
    c.close()


# 仕掛（WaveLog の仕掛 SIKALOTNOW と同じ 34 列の頭。本物は 200 列ほど）。残仕掛設備ｺｰｽ は「次の設備 その次 …」（空白区切り）で、
# 先頭が今その設備に仕掛かっている（WaveLog の作業可否と同じ決まり）。設備名は作業実績の試験用の設備と同じ
WIP_COLUMNS = ["ロット番号", "鋳造番号", "製造材質", "製造調質", "用途名", "BOX設計_設備名", "検査番号", "オーダー番号", "取引先", "納入先",
               "設計_設備ｺｰｽ", "実績_設備ｺｰｽ", "残仕掛設備ｺｰｽ", "ｺﾝﾏ5本ｶｰﾄﾞ区分"] + [f"親子管理_子カード{i}" for i in range(1, 11)] \
    + [f"コンマ5本分割_切断巾{i}" for i in range(1, 11)] + ["仕掛区分"]
# 仕掛区分（版 3.37.0。ダッシュボードの仕掛区分ごとの数。本物の列の名前・値は確かめていない作り物）。ほかの列の値を変えないよう、乱数ではなく行の番号で決める
WIP_CLASSES = ["生産", "生産", "生産", "保留", "検査待ち", "生産", "出荷待ち", "生産", "再処理", "保留", "生産"]
WIP_EQUIPMENT = ["CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1"]


def make_wip(path, n=1200, seed=5):
    """仕掛の試験用データ（表「仕掛」。1 行 1 ロット）。設備ごとの仕掛の数がばらつくように、先頭の設備は重みを付けて選ぶ。
    数行は残仕掛設備ｺｰｽ が空（もう流れ終わった）・知らない設備（XYZ）・全角（ＣＲ１）。"""
    r = random.Random(seed)
    c = sqlite3.connect(path)
    c.execute("DROP TABLE IF EXISTS 仕掛")
    c.execute("CREATE TABLE 仕掛 (" + ",".join(f"[{x}]" for x in WIP_COLUMNS) + ")")
    weights = [9, 4, 12, 6, 3, 8, 5, 2, 7, 1, 3]
    rows = []
    for i in range(n):
        route = r.sample(WIP_EQUIPMENT, r.randint(3, 6))
        k = r.randint(0, len(route) - 1)
        head = r.choices(WIP_EQUIPMENT, weights)[0]
        rest = [head] + [x for x in route[k + 1:] if x != head]
        course = " ".join(rest)
        if i % 97 == 0:
            course = ""
        elif i % 89 == 0:
            course = "XYZ " + course
        elif i % 83 == 0:
            course = course.replace("CR1", "ＣＲ１")
        rows.append([f"W{i + 1:05d}", f"C{r.randint(1, 999):03d}", r.choice(["A1100", "A5052", "A3004"]), r.choice(["H14", "O", "H24", "H34"]),
                     r.choice(["一般用材", "缶材", "箔地"]), route[0], f"K{i + 1:05d}", f"J{r.randint(1, 99)}", r.choice(["取引先A", "取引先B", "ﾄﾘﾋｷｻｷC"]),
                     r.choice(["納入先A", "納入先B"]), " ".join(route), " ".join(route[:k]), course, r.choice(["", "", "1", None])]
                    + [None] * 20 + [WIP_CLASSES[(i * 7 + i // 13) % len(WIP_CLASSES)]])
    c.executemany("INSERT INTO 仕掛 VALUES (" + ",".join("?" * len(WIP_COLUMNS)) + ")", rows)
    c.commit()
    c.close()


def make_masters(folder):
    """マスタのデータ元（版 3.53.0。役割「マスタ」・結合の相手）: 製造条件（材質＋質別の 2 つの鍵。品質データの 合金・調質 に当たる。
    A3004 の H24 は無い＝当たらない組・材質は「a5052」のように書き方がゆれた行もある）と、設備（設備名の 1 つの鍵）。→ {名前: ファイル}"""
    from pathlib import Path
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    cond = folder / "製造条件マスタ.sqlite3"
    c = sqlite3.connect(cond)
    c.execute("CREATE TABLE 製造条件 ([材質], [質別], [圧延速度], [焼鈍温度], [板厚公差], [改訂日])")
    rows = []
    for i, (a, t) in enumerate((a, t) for a in ("A1100", "a5052 ", "A3004") for t in ("H14", "O", "H24")):
        if (a, t) != ("A3004", "H24"):
            rows.append((a, t, 600 + 40 * i, None if t != "O" else 340 + 5 * i, 0.010 + 0.002 * (i % 3), f"2026/0{1 + i % 9}/15"))
    c.executemany("INSERT INTO 製造条件 VALUES (?,?,?,?,?,?)", rows)
    c.commit()
    c.close()
    eq = folder / "設備マスタ.sqlite3"
    c = sqlite3.connect(eq)
    c.execute("CREATE TABLE 設備 ([設備名], [ライン], [能力_t日], [管理者])")
    c.executemany("INSERT INTO 設備 VALUES (?,?,?,?)", [(e, "CR ライン" if "CR" in e or "ＣＲ" in e else "L ライン", 40 + 5 * i, f"担当{i % 3 + 1}")
                                                          for i, e in enumerate(EQUIPMENT)])
    c.commit()
    c.close()
    return {"製造条件マスタ": cond, "設備マスタ": eq}


def make(path, n=3000, extra_columns=20, seed=7):
    """n 行 ×（20＋extra_columns）列の表「仕掛」と、ビュー「仕掛_ビュー」・WITHOUT ROWID の表「保留」を作る。"""
    r = random.Random(seed)
    cols = COLUMNS + [f"項目{i:02d}" for i in range(1, extra_columns + 1)]
    c = sqlite3.connect(path)
    c.executescript("DROP VIEW IF EXISTS 仕掛_ビュー; DROP TABLE IF EXISTS 仕掛; DROP TABLE IF EXISTS 保留;")
    c.execute("CREATE TABLE 仕掛 (" + ",".join(f"[{x}]" for x in cols) + ")")
    rows, lot = [], 0
    for _ in range(n):
        if r.random() < 0.6:
            lot += 1                                # 4 割の行は前の行と同じロット
        d = TODAY - timedelta(days=r.randint(0, 900))
        lot_no = f"L{lot:04d}C{lot % 10}"
        if r.random() < 0.02:
            lot_no = r.choice(["", None, " " + lot_no.lower() + " "])   # 空・NULL・大小と前後の空白（まとめでは同じロット）
        row = [lot_no, _date_text(d, r.choices(range(9), [55, 10, 10, 10, 5, 2, 2, 1, 5])[0]), r.choice(EQUIPMENT), r.choice(DEFECTS),
               round(r.uniform(500, 6000), 1), r.choice(["0.300", "0.5", "1", "2.73", "1e-05", "abc"]), r.randint(800, 1600),
               r.choice(["A1100", "A5052", "A3004"]), r.choice(["H14", "O", "H24"]), r.choice(["客先A", "客先Ｂ", "ｷｬｸｻｷC", None]),
               _date_text(d + timedelta(days=1), 0), d.isoformat() + "T08:15:00", str(r.randint(1, 99)),
               r.choice(["", "要確認", "再検査 済", None, "100%", "a]b"]), r.choice(["圧延", "焼鈍", "スリット"]), r.choice(["担当1", "担当2"]),
               r.uniform(10, 9000), r.choice([2.73, 2.7, 1e16, 1.0, 0.1 + 0.2, -0.0, 12345678901234567, 3]),
               f"J{r.randint(10, 99)}G{r.randint(10, 99)}A", f"N{r.randint(100000, 999999)}"]
        row += [r.choice([None, "", str(r.randint(0, 999)), f"文字{r.randint(0, 99)}", r.random(), r.randint(-5, 5), b"\x00\x01"])
                for _ in range(extra_columns)]
        rows.append(row)
    c.executemany("INSERT INTO 仕掛 VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    c.execute("CREATE VIEW 仕掛_ビュー AS SELECT * FROM 仕掛")
    c.execute("CREATE TABLE 保留 ([ロット番号] TEXT PRIMARY KEY, [発生日], [重量]) WITHOUT ROWID")
    c.executemany("INSERT INTO 保留 VALUES (?,?,?)", [(f"H{i:03d}", _date_text(TODAY - timedelta(days=i), i % 9), i * 1.5) for i in range(60)])
    c.commit()
    c.close()
    return cols


def _f(*items):
    return json.dumps([{"column": c, "op": o, "value": v} for c, o, v in items], ensure_ascii=False)


def _in(column, values, key=None, raw=None):
    """スライサーの絞り込み（in）1 つ。values は値の並び（raw を渡せば、その字をそのまま value に）。"""
    f = {"column": column, "op": "in", "value": raw if raw is not None else json.dumps(values, ensure_ascii=False)}
    if key is not None:
        f["key"] = key
    return f


def _fl(*filters):
    return json.dumps(list(filters), ensure_ascii=False)


def _s(*items):
    return json.dumps([{"column": c, "dir": d} for c, d in items], ensure_ascii=False)


# 色付けの組（1 組＝条件の並び。かつ）
MARK_A = [{"column": "不良名", "op": "eq", "value": "汚れ"}]
MARK_B = [{"column": "重量", "op": "gte", "value": "3000"}, {"column": "板厚", "op": "lt", "value": "1"}]
MARK_C = [{"column": "発生日", "op": "within_days", "value": "400"}, {"column": "客先", "op": "not_empty", "value": ""}]
MARK_D = [_in("設備", ["CR1", ""]), {"op": "tuple_in", "columns": ["合金", "調質"], "value": json.dumps([["A1100", "H14"], ["A5052", "O"]])}]
MARK_E = [{"column": "ロット番号", "op": "ends", "value": "C3"}, {"column": "発生日", "op": "within_years", "value": "2"}]

# 問い合わせの組（lot_list.query の引数）。画面が送る形のまま（filters・sorts は JSON の文字）
CASES = [
    {},
    {"page": 3},
    {"page": 999},
    {"page_size": 50, "page": 2},
    {"search": "汚れ"},
    {"search": "ｷｬｸｻｷ"},
    {"search": "2.73"},
    {"search": "%"},
    {"search": "a]b"},
    {"filters": _f(("不良名", "eq", "汚れ"), ("発生日", "within_days", "90"))},
    {"filters": _f(("不良名", "contains", "ロール"))},
    {"filters": _f(("不良名", "not_contains", "汚"))},
    {"filters": _f(("設備", "neq", "L-1"))},
    {"filters": _f(("設備", "starts_any", "L-,ＣＲ"))},
    {"filters": _f(("設備", "starts_any", ""))},
    {"filters": _f(("ロット番号", "ends", "C3"))},
    # 版 3.54.0: で始まらない・で終わらない と、Excel と同じ * ?（全角も）・~ で印そのもの
    {"filters": _f(("設備", "not_starts", "L-"))},
    {"filters": _f(("ロット番号", "not_ends", "C3"))},
    {"filters": _f(("ロット番号", "eq", "L00?1C1"))},
    {"filters": _f(("ロット番号", "eq", "L001*"), ("不良名", "neq", "*汚*"))},
    {"filters": _f(("不良名", "contains", "ロ＊跡"))},
    {"filters": _f(("設備", "starts", "?R"), ("備考", "not_contains", "~?"))},
    {"search": "L00*C1"},
    {"search": "a_b"},
    {"filters": _f(("客先", "empty", ""))},
    {"filters": _f(("客先", "not_empty", ""))},
    {"filters": _f(("重量", "gte", "3000"), ("板厚", "lt", "1"))},
    {"filters": _f(("板厚", "gt", "abc"))},
    {"filters": _f(("発生日", "within_weeks", "3"))},
    {"filters": _f(("発生日", "within_months", "13"))},
    {"filters": _f(("発生日", "within_years", "1"))},
    {"filters": _f(("発生日", "within_days", "x"))},
    {"filters": _f(("無い列", "eq", "x"), ("設備", "bad_op", "x"))},
    {"filters": "壊れた JSON"},
    {"sorts": _s(("重量", "desc"), ("発生日", "asc"))},
    {"sorts": json.dumps(["設備", {"column": "設備", "dir": "desc"}, {"column": "無い列"}, {"column": "比重", "dir": "DESC"}], ensure_ascii=False)},
    {"group": True},
    {"group": True, "page": 4},
    {"group": True, "sorts": _s(("重量", "desc"))},
    {"group": True, "sorts": _s(("設備", "asc"), ("発生日", "desc")), "page": 2, "page_size": 100},
    {"group": True, "search": "汚れ", "filters": _f(("発生日", "within_months", "6"))},
    {"group": True, "page_size": 7, "page": 5},
    {"filters": _f(("発生日", "within_days", "0"), ("設備", "eq", "無い"))},
    {"filters": _f(("発生日", "within_days", "0"), ("入力日時", "within_years", "0"))},
    {"filters": _f(("発生日", "within_days", "0"), ("不良名", "eq", "無い"), ("入力日時", "within_weeks", "1"))},
    {"table": "仕掛_ビュー", "group": True, "sorts": _s(("重量", "desc"))},
    {"table": "保留", "group": True},
    {"table": "保留"},
    {"table": "無い表"},
    # Rust へ移すときに足した: N が小数（切り捨て）・指数で書く小数（1e+16）を字で探す・全角の数字で数を比べる
    {"filters": _f(("発生日", "within_weeks", "2.9"))},
    {"search": "e+16"},
    {"filters": _f(("重量", "lt", "　１０００"))},
    # 並び・まとめ（版 3.12.0）: 並べ替えは SortKey（空欄をまとめ・数に読める字は数・前後の空白を除く・ロット番号は大小を同じに）
    {"sorts": _s(("数量", "asc"), ("備考", "desc"), ("客先", "asc"))},
    {"sorts": _s(("板厚", "desc"), ("比重", "asc"))},
    {"sorts": _s(("ロット番号", "desc"), ("不良名", "asc"))},
    {"group": True, "sorts": _s(("ロット番号", "asc"), ("備考", "asc"), ("数量", "desc"))},
    {"group": True, "sorts": _s(("不良名", "asc"), ("ロット番号", "desc")), "page": 2, "page_size": 120},
    # 見せ方に合わせた鍵（版 3.13.0）: 日付だけ・年月・年・丸めた数。分からない鍵はそのままの値
    {"sorts": json.dumps([{"column": "発生日", "dir": "asc", "key": "date"}, {"column": "設備", "dir": "asc"}], ensure_ascii=False)},
    {"sorts": json.dumps([{"column": "発生日", "dir": "desc", "key": "month"}, {"column": "不良名", "dir": "asc"},
                          {"column": "入力日時", "dir": "asc", "key": "YEAR"}], ensure_ascii=False)},
    {"sorts": json.dumps([{"column": "比重", "dir": "asc", "key": "round:0"}, {"column": "長さ", "dir": "desc", "key": "Round:12"},
                          {"column": "重量", "dir": "asc", "key": "round:x"}, {"column": "板厚", "dir": "asc", "key": 3}], ensure_ascii=False)},
    {"group": True, "page": 2, "page_size": 90,
     "sorts": json.dumps([{"column": "ロット番号", "dir": "asc"}, {"column": "検査日", "dir": "desc", "key": "date"}], ensure_ascii=False)},
    # スライサー（版 3.15.0）: 選んだ値のどれか（in）。空欄も選べる。見せ方の鍵（日付だけ・年月・年）があれば見えている値で比べる
    {"filters": _fl(_in("設備", ["CR1", "L-1"]))},
    {"filters": _fl(_in("客先", ["", "客先A"]), _in("不良名", ["キズ", "汚れ", "無い値"]))},
    {"filters": _fl(_in("発生日", ["2025-03", "2024-12", ""], key="month"))},
    {"filters": _fl(_in("発生日", ["2025"], key="YEAR"), _in("入力日時", ["2025-09-17"], key="date"))},
    {"filters": _fl(_in("重量", ["5828", "1"], key="round:0"))},
    {"filters": _fl(_in("設備", [], raw="[]"))},
    {"filters": _fl(_in("設備", [], raw="壊れた"))},
    {"filters": _fl(_in("設備", [], raw='[1, "CR1", null]'))},
    {"group": True, "filters": _fl(_in("設備", ["DL2"])), "sorts": _s(("重量", "desc"))},
    # スライサーに並べる値（slicer）: 列の重複なしの値・ほかの絞り込みのもとでの件数・空欄は最後・1000 を超えたら truncated
    {"slicer": "設備"},
    {"slicer": "客先"},
    {"slicer": "発生日", "key": "date"},
    {"slicer": "入力日時", "key": "month"},
    {"slicer": "発生日", "key": "round:2"},
    {"slicer": "不良名", "search": "客先", "filters": _fl(_in("設備", ["CR1", ""]), {"column": "重量", "op": "gte", "value": "3000"})},
    {"slicer": "重量"},
    {"slicer": "設備", "table": "保留"},
    {"slicer": "無い列"},
    # 計算列のスライサー（combos）: 式が使う列の値の組と件数（元の型のまま・件数の多い順）と、選んだ組で絞る tuple_in
    {"combos": json.dumps(["合金", "調質"], ensure_ascii=False)},
    {"combos": json.dumps(["客先"], ensure_ascii=False), "filters": _fl(_in("設備", ["CR1"]))},
    {"combos": json.dumps(["比重", "板厚"], ensure_ascii=False), "search": "1"},
    {"combos": json.dumps(["無い列"], ensure_ascii=False)},
    {"combos": json.dumps(["合金", "合金"], ensure_ascii=False)},
    {"filters": json.dumps([{"op": "tuple_in", "columns": ["合金", "調質"], "value": json.dumps([["A1100", "H14"], ["A5052", "O"]])}], ensure_ascii=False)},
    {"filters": json.dumps([{"op": "tuple_in", "columns": ["客先"], "value": json.dumps([[None], ["客先A"]], ensure_ascii=False)}], ensure_ascii=False)},
    {"filters": json.dumps([{"op": "tuple_in", "columns": ["比重"], "value": json.dumps([[2.73], [3], [0.30000000000000004], [12345678901234567]])}], ensure_ascii=False)},
    {"filters": json.dumps([{"op": "tuple_in", "columns": ["合金", "調質"], "value": json.dumps([["A1100"], [True, "O"], "x"])}], ensure_ascii=False)},
    {"filters": json.dumps([{"op": "tuple_in", "columns": ["無い列"], "value": "[]"}], ensure_ascii=False)},
    # タイムライン（版 3.31.0）: 日付と読める値がその間（両端を含む）。片側だけ・読めない側は限らない・形の違う字は読まない。山は日付でまとめたスライサー
    {"filters": _f(("発生日", "date_range", "2025-04-01..2025-09-30"))},
    {"filters": _f(("発生日", "date_range", "2025-06-01.."), ("入力日時", "date_range", "..2026-01-31"))},
    {"filters": _f(("発生日", "date_range", "2025-02-30..2025-4-1"))},
    {"filters": _f(("発生日", "date_range", "0000-01-01..x"))},
    {"group": True, "filters": _f(("発生日", "date_range", "2024-12-01..2025-03-31")), "sorts": _s(("重量", "desc"))},
    {"slicer": "発生日", "key": "date", "filters": _f(("入力日時", "date_range", "2025-01-01..2025-12-31"))},
    {"marks": json.dumps([[{"column": "発生日", "op": "date_range", "value": "2025-01-01..2025-06-30"}]], ensure_ascii=False)},
    # 色付け（条件付き書式・版 3.21.0）: 行は絞らず、組ごとに「ページで当たった行の位置」と「全件で当たった数」。判定は filters と同じ
    {"marks": json.dumps([MARK_A, MARK_B, MARK_C], ensure_ascii=False)},
    {"marks": json.dumps([MARK_A, [{"column": "無い列", "op": "eq", "value": "x"}], [], "x", MARK_D], ensure_ascii=False),
     "filters": _f(("設備", "neq", "L-1")), "sorts": _s(("重量", "desc"))},
    {"group": True, "page": 2, "page_size": 90, "search": "汚", "marks": json.dumps([MARK_B, MARK_D, MARK_E], ensure_ascii=False)},
    {"table": "仕掛_ビュー", "group": True, "marks": json.dumps([MARK_C, MARK_E], ensure_ascii=False)},
    {"table": "保留", "marks": json.dumps([MARK_A, MARK_B], ensure_ascii=False)},
    {"marks": "壊れた"},
    {"marks": json.dumps([[{"column": "設備", "op": "bad_op", "value": "x"}, {"column": "設備", "op": "eq", "value": "CR1"}]], ensure_ascii=False)},
]


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "lotlist_fixture.sqlite3"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
    print(out, n, len(make(out, n)))
