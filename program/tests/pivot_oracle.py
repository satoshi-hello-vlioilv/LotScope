# -*- coding: utf-8 -*-
"""集計（ピボット）の「正しい答え」を出す係（版 3.61.0。デスクトップ版の Rust の集計 desktop/src/pivot.rs との突き合わせ。
desktop/tests/pivot_parity.rs が呼ぶ）。

    python tests/pivot_oracle.py

一覧の道の集計表（/pivot）は routes_oracle.py が道ごと突き合わせる。ここは、ダッシュボードが使う形（services/pivot.query_many）を
直接呼ぶ: いくつかのファイル（作業実績の全設備）・設備の段（ファイルごと・列の値を見分ける〈そのまま・前方一致〉）・設備で絞る・
設備のまとめ（合算・その他・数えない）・設備グループの段（名前の決まり・正規表現）・期間（7 つの種類・作業日／日付の列）・
計算列（段・値・条件・期間）・箱ひげ・区間・読めないファイル（飛ばす・1 つなら断る）・組み方の誤り・値の計算（四則演算）の事例。
    {"cases": [{"name", "parts": [Part の形], "ask": {...}, "answer" か "fail": {"kind": invalid|down, "error"}}], "num_expr": [[式, 値, 答え]]}
Part の形: {path, table, preferred, cand: lot|work|src, work: {segments, basis, start}|null, equip: {name}|{column, names, mode}|null, name, lot_col}
"""
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
sys.path.insert(0, str(PROGRAM / "tools"))
os.environ.update(TPA_SHELL="desktop", TPA_SHELL_SERVES="lotlist,lists")

from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.services import data_sources, lot_list, num_expr, pivot, shifts, work_log  # noqa: E402
from app.services.work_summary import num as work_log_num  # noqa: E402
import ui_server  # noqa: E402
from ui_server import as_role, build  # noqa: E402

NOW = datetime(2026, 10, 2, 8, 30, 0)
CANDS = {"lot": lot_list.TABLE_CANDIDATES, "work": work_log.TABLE_CANDIDATES, "src": data_sources.TABLE_CANDIDATES}


def part_of(spec):
    w = spec.get("work")
    work = {"clock": shifts.Clock(w["segments"]), "basis": w.get("basis", "work"), "start": w.get("start", "")} if w else None
    e = spec.get("equip")
    equip = None
    if e and "name" in e:
        equip = {"name": e["name"]}
    elif e:
        equip = {"column": e["column"], "match": data_sources.EquipmentMatcher(e["names"], e.get("mode"))}
    return pivot.Part(spec["path"], table=spec.get("table", ""), preferred_table=spec.get("preferred", ""), table_candidates=CANDS[spec["cand"]],
                      work=work, equip=equip, name=spec.get("name", ""), lot_col=spec.get("lot_col"))


def run(name, parts, now=None, **ask):
    """now … その組の「いま」（無ければ NOW）"""
    now = now or NOW
    case = {"name": name, "parts": parts, "ask": ask, "now": now.strftime("%Y-%m-%d %H:%M:%S")}
    if ask.get("calc"):          # 計算列は字のまま渡す（式の並びが列の並び。JSON の物は鍵の順を持たない読み方がある）
        case["calc_text"] = json.dumps(ask["calc"], ensure_ascii=False)
    kw = dict(ask)
    for k in ("rows", "cols", "measures", "filters"):
        if k in kw and not isinstance(kw[k], str):
            kw[k] = json.dumps(kw[k], ensure_ascii=False)
    try:
        out = pivot.query_many([part_of(p) for p in parts], today=now.date(), now=now, **kw)
        out.pop("timing", None)
        case["answer"] = out
    except pivot.PivotError as e:
        case["fail"] = {"kind": "invalid", "error": str(e)}
    except Exception as e:      # 読めないファイルなど（道は 503）
        case["fail"] = {"kind": "down", "error": str(e)}
    return case


def num_cases():
    srcs = ["÷1000", "×100", "+5", "-3", "-x", "--x", "+-x", "x^2^3", "2^x", "x^0.5", "(x-1)^0.5", "x^-1", "0^x", "x/0", "1/(x/0)", "x*1e3",
            "x.5", ".5*x", "1.5.5*x", "x^1000", "10^x", "(-x)^(1/3)", "((x))", "(x", "x)", "x+", "*", "", "  ", "値×値", "Ｘ＋１", "x−1",
            "x–1", "x✕2", "abc", "x 2", "2 x", "x(2)", "x÷(x-x)", "(x+1)*(x-1)/2", "-2^2*x", "x^-x", "0.1+0.2+x", "x%", "x+値", "×１．５", "値÷１．５", "．５×値", "（値−１０）×０．２５", "x+)", "x*(+)"]
    xs = [0, 1, -1, 2.5, 3, 50, -8, 1e300, 1e-300]
    out = []
    for s in srcs:
        fn, err, _ = num_expr.compile_expr(s)
        if err:
            out.append([s, 0, "err", err])
            continue
        if fn is None:
            out.append([s, 0, "none"])
            continue
        for x in xs:
            out.append([s, x, fn(x)])
    return out


def main():
    as_role("開発者")
    app = build(quality=600, work_rows=150, wip=400)
    repo = MasterRepository(app.config["MASTER_STORE"])
    pats = repo.shift_patterns()
    folder = ui_server.WORK / "【New】実績"
    rows = [r for r in work_log.ordered(repo.work_logs()) if str(r.get("表示") or "有") != "無"]
    work_parts = []
    for r in rows:
        p = folder / r["ファイル名"]
        if not p.exists():
            continue
        pat = shifts.pattern_for(pats, r["設備名"])
        work_parts.append({"path": str(p), "preferred": r.get("表") or "", "cand": "work", "name": r["設備名"], "equip": {"name": r["設備名"]},
                           "work": {"segments": pat["segments"] if pat else [], "basis": "work", "start": ""}})
    names = [r["設備名"] for r in rows]
    lot_src = app.config["APP_SETTINGS"]["lot_list"]["source"]
    # 空白で埋まる値（版 3.51.1 の空欄の決まり）・前方一致で見分ける設備の列の値
    db = sqlite3.connect(lot_src)
    t = lot_list.pick_table(lot_list.tables(db))
    ids = [r[0] for r in db.execute(f'SELECT rowid FROM "{t}" ORDER BY rowid LIMIT 40')]
    for i, v in zip(ids, ["  ", "　", "\t", " ﾃｽﾄ ", "ﾃｽﾄ", "", None, "  　 ", "\n", "\r\n"] * 4):
        db.execute(f'UPDATE "{t}" SET 備考 = ? WHERE rowid = ?', (v, i))
    for i, v in zip(ids, ["CR2 1号", "cr1", "L-1 南", "ＣＲ２", "謎の設備 A", " ", None, "TLV", "L-10 1号", "l-10", " L-9 ", "L-9", "\u3000", "謎の設備\u3000B", "CL-1"] * 3):
        db.execute(f'UPDATE "{t}" SET 設備 = ? WHERE rowid = ?', (v, i))
    # 外れ値（箱ひげのひげの端・外れ値の見せる数 30 の上限）: 40 行の重量を飛び離れた大きな値に
    far = [r[0] for r in db.execute(f'SELECT rowid FROM "{t}" ORDER BY rowid DESC LIMIT 40')]
    for k, i in enumerate(far):
        db.execute(f'UPDATE "{t}" SET 重量 = ? WHERE rowid = ?', (90000 + k * 1700.5, i))
    # 下の側の外れ値（ひげの下の端が最小値でないこと）
    for k, i in enumerate(r[0] for r in db.execute(f'SELECT rowid FROM "{t}" ORDER BY rowid LIMIT 8 OFFSET 200')):
        db.execute(f'UPDATE "{t}" SET 重量 = ? WHERE rowid = ?', (-50000 - k * 333.25, i))
    few = [r[0] for r in db.execute(f'SELECT 検査番号 FROM "{t}" ORDER BY rowid LIMIT 6')]
    # 値の少ない区間の自動の幅（段数の下限 5 が効く広がり 130）・区間の境ちょうどの小数（0.3 ÷ 0.1）・10 桁で丸める数の鍵
    for i, (w, g, th) in zip(ids[:6], [(1000, 0.3, "1.2345678"), (1030, 0.6, "1.2345678"), (1050, 0.7, "2.0000000001"), (1080, 0.3, " 3 "),
                                       (1100, 0.9, "1e-7"), (1130, 0.6, "1.2345678")]):
        db.execute(f'UPDATE "{t}" SET 板幅 = ?, 比重 = ?, 板厚 = ? WHERE rowid = ?', (w, g, th, i))
    # ひげの端の近く（四分位の範囲の 1.5〜1.6 倍の間）の値: 段なしの箱ひげで、1.5 倍の外・1.6 倍の内に入る
    for _ in range(3):
        d = pivot.describe([f for f in (work_log_num(r[0]) for r in db.execute(f'SELECT 重量 FROM "{t}"')) if f is not None])
        near = d["q3"] + 1.55 * (d["q3"] - d["q1"])
        db.execute(f'UPDATE "{t}" SET 重量 = ? WHERE rowid IN (SELECT rowid FROM "{t}" ORDER BY rowid LIMIT 3 OFFSET 100)', (near,))
    d = pivot.describe([f for f in (work_log_num(r[0]) for r in db.execute(f'SELECT 重量 FROM "{t}"')) if f is not None])
    iqr = d["q3"] - d["q1"]
    assert any(d["q3"] + 1.5 * iqr < f[0] <= d["q3"] + 1.6 * iqr for f in db.execute(f'SELECT 重量 FROM "{t}"')), "ひげの端の近くの値を作れません"
    db.commit()
    db.close()
    lot = {"path": lot_src, "preferred": "", "cand": "lot", "name": "品質データ"}
    # 作った表（2,400 行）: 種類が 1,000 を超える列（カラムの札の「1000+」の境）・値の無いまとまり（前との差）・同じ値（順位）
    big_path = ui_server.WORK / "集計の境.sqlite3"
    bdb = sqlite3.connect(big_path)
    bdb.execute("CREATE TABLE 境 (区分 TEXT, 値 REAL, 鍵 TEXT, 小 INTEGER, 千 TEXT)")
    bdb.executemany("INSERT INTO 境 VALUES (?, ?, ?, ?, ?)",
                    [("ABCDE"[i % 5], None if i % 5 == 2 else (i % 7) * 1.5, f"K{i:05d}", i % 3, f"T{i % 1000}") for i in range(2400)])
    bdb.commit()
    bdb.close()
    big = {"path": str(big_path), "preferred": "", "cand": "src", "name": "境"}
    # 作業開始の日付と時刻が別の列の作業実績（2 直だけの勤務体系: 23 時〜7 時は直の外・時刻の無い行・作業開始の無い行）
    tw_path = ui_server.WORK / "実績_時刻別.sqlite3"
    tdb = sqlite3.connect(tw_path)
    tdb.execute("CREATE TABLE 実績 (ロット番号 TEXT, BOX実績_作業開始_日付 TEXT, BOX実績_作業開始_時刻 TEXT, 重量 REAL)")
    rows_tw = []
    for k, (d, t) in enumerate([(d, t) for d in ("2025/12/31", "2026/09/29", "2026/09/30", "2026/10/01")
                                for t in ("06:30", "07:00", "14:59", "15:00", "22:59", "23:30", "", None)] + [(None, "08:00"), ("", "09:00")]):
        rows_tw.append((f"T{k:03d}" if k % 4 else "T000", d, t, 100 + k))
    tdb.executemany("INSERT INTO 実績 VALUES (?, ?, ?, ?)", rows_tw)
    tdb.commit()
    tdb.close()
    two = [{"name": "1直", "start": "07:00", "end": "15:00", "dayOffset": 0, "crosses": False},
           {"name": "2直", "start": "15:00", "end": "23:00", "dayOffset": 0, "crosses": False}]
    three = (shifts.pattern_for(pats, "CAL") or {}).get("segments") or []
    tw = {"path": str(tw_path), "preferred": "", "cand": "work", "name": "時刻別", "equip": {"name": "時刻別"},
          "work": {"segments": two, "basis": "work", "start": ""}}
    # 前方一致は長い名前から試す（L-1 と L-10。並びは L-1 が先）
    lot_pre = {**lot, "equip": {"column": "設備", "names": names + ["L-10", "CL-1"], "mode": "前方一致"}}
    lot_same = {**lot, "equip": {"column": "設備", "names": names, "mode": "そのまま"}}
    wp = work_parts
    rev = list(reversed(work_parts))       # ファイルの並び（手で並べた設備の順）が名前の順と違う形
    cnt = [{"agg": "count"}]
    cases = [
        run("全設備×直（前日）", wp, rows=[{"column": "@equip"}], cols=[{"column": "@shift"}],
            measures=[{"agg": "count"}, {"agg": "lots"}, {"agg": "sum", "column": "重量"}], period={"column": "@workday", "kind": "yesterday"}),
        run("作業日（直近 7 日・設備を選ぶ）", wp, rows=[{"column": "@workday"}], measures=[{"agg": "lots"}],
            period={"column": "@workday", "kind": "days", "n": 7}, equips=["CAL", "ｃｒ２", " "]),
        run("作業日の年月（全期間）", wp, rows=[{"column": "@workday", "part": "ym"}, {"column": "@equip"}], measures=[{"agg": "avg", "column": "速度"}]),
        run("設備のまとめ（その他）", wp, rows=[{"column": "@equip"}], measures=cnt,
            egroups={"groups": [{"name": "CR ライン", "members": ["CR1", "CR2"]}, {"name": "L ライン", "members": [], "rules": [{"op": "prefix", "value": "l-"}]}],
                     "rest": "other", "other": ""}),
        run("設備のまとめ（数えない）", wp, rows=[{"column": "@equip"}], measures=cnt,
            egroups={"groups": [{"name": "CR ライン", "members": ["CR1", "CR2"]}], "rest": "hide"}),
        run("設備のまとめ（合算）", wp, rows=[{"column": "作業区分"}], measures=[{"agg": "sum", "column": "重量"}],
            egroups={"groups": [{"name": "全部"}], "rest": "other", "other": "全部"}),
        run("設備の並び（ファイルの順）", rev, rows=[{"column": "@equip"}], measures=cnt),
        run("設備のまとめ（2 つのまとまりにいる設備は先の方・入らない設備はファイルの順）", rev, rows=[{"column": "@equip"}], measures=cnt,
            egroups={"groups": [{"name": "甲", "members": ["CAL", "CR1"]}, {"name": "乙", "members": ["cal", "TLV"]}], "rest": "keep"}),
        run("設備グループ（正規表現だけで入る・小文字・重い形は当てない）", wp, rows=[{"column": "@egroup", "part": "正規"}], cols=[{"column": "@equip"}], measures=cnt,
            sets={"正規": [{"name": "L 系", "rules": [{"op": "regex", "value": "^l-\\d$"}]}, {"name": "重い", "rules": [{"op": "regex", "value": "(a+)+"}]},
                           {"name": "読めない", "rules": [{"op": "regex", "value": "("}, {"op": "equals", "value": "anf"}]},
                           {"name": "と同じ", "rules": [{"op": "equals", "value": "cr"}, {"op": "equals", "value": "ｃａｌ"}]},
                           {"name": "空の決まり", "rules": [{"op": "contains", "value": "  "}, {"op": "prefix", "value": ""}, {"op": "nope", "value": "x"}]}]}),
        run("設備グループの段", wp, rows=[{"column": "@egroup", "part": "ライン別"}, {"column": "@equip"}], measures=cnt,
            sets={"ライン別": [{"name": "CR", "members": ["CR1"], "rules": [{"op": "regex", "value": "^cr\\d$"}], "except": ["CR2"]},
                              {"name": "L", "rules": [{"op": "contains", "value": "-"}, {"op": "suffix", "value": "LV"}]},
                              {"name": "重い", "rules": [{"op": "regex", "value": "(a+)+$"}]}]}),
        run("このパネルのグループ（空）", wp, rows=[{"column": "@egroup", "part": "@panel"}], measures=cnt, sets={"@panel": []}),
        run("計算列（段・条件・値）", wp, rows=[{"column": "区分2"}], cols=[{"column": "@shift"}], measures=[{"agg": "sum", "column": "倍重量"}],
            filters=[{"column": "区分2", "op": "neq", "value": ""}, {"column": "無い列", "op": "eq", "value": "x"}],
            calc={"formulas": {"区分2": "[作業区分] + '!'", "倍重量": "[重量] * 2", "壊れ": "[重量] +"}, "names": {}}),
        run("読めない計算列を使う", wp, rows=[{"column": "壊れ"}], measures=cnt, calc={"formulas": {"壊れ": "[重量] +"}, "names": {}}),
        run("箱ひげ（外れ値 40・段なし）", [lot], measures=cnt, box="重量"),
        run("箱ひげ（外れ値・合金ごと）", [lot], rows=[{"column": "合金"}], measures=[{"agg": "max", "column": "重量"}], box="重量"),
        run("列が 120 を超える（数の並び）", [lot], rows=[{"column": "合金"}], cols=[{"column": "重量"}], measures=cnt),
        run("計算列の条件で絞る", wp, rows=[{"column": "作業区分"}], measures=[{"agg": "count"}, {"agg": "sum", "column": "倍重量"}],
            filters=[{"column": "倍重量", "op": "gt", "value": "5000"}, {"column": "区分2", "op": "contains", "value": "!"}],
            calc={"formulas": {"区分2": "[作業区分] + '!'", "倍重量": "[重量] * 2"}, "names": {}}),
        run("負の値の変動係数", wp[:3], rows=[{"column": "作業区分"}], measures=[{"agg": "cv", "column": "負"}, {"agg": "avg", "column": "負"}],
            calc={"formulas": {"負": "0 - [重量]"}, "names": {}}),
        run("区間（自動・値が少ない）", [lot], rows=[{"column": "板幅", "part": "bin"}], measures=cnt,
            filters=[{"column": "検査番号", "op": "starts_any", "value": ",".join(few)}]),
        run("種類の数（空白・桁の上限）", [lot], rows=[{"column": "合金"}],
            measures=[{"agg": "distinct", "column": "備考"}, {"agg": "avg", "column": "重量", "dec": 9}, {"agg": "cv", "column": "重量", "expr": "-100000"}]),
        run("箱ひげ（全設備）", wp, rows=[{"column": "作業区分"}], measures=[{"agg": "median", "column": "重量"}], box="重量"),
        run("区間（自動）", wp, rows=[{"column": "重量", "part": "bin"}], measures=cnt),
        run("区間（境ちょうどの小数）", [lot], rows=[{"column": "比重", "part": "bin", "width": 0.1, "origin": 0}], measures=cnt),
        run("数の鍵（10 桁で丸める）", [lot], rows=[{"column": "板厚"}], measures=cnt),
        run("区間（幅・起点）", wp, rows=[{"column": "重量", "part": "bin", "width": "250", "origin": 100}], cols=[{"column": "合金"}], measures=cnt),
        run("列が 120 を超える", wp, rows=[{"column": "合金"}], cols=[{"column": "ロット番号"}], measures=cnt),
        run("読めないファイルは飛ばす", wp[:2] + [{"path": str(ui_server.WORK / "無い.sqlite3"), "cand": "work", "name": "無い", "equip": {"name": "無い"},
                                              "work": {"segments": [], "basis": "work"}}], rows=[{"column": "@equip"}], measures=cnt),
        run("1 つなら断る", [{"path": str(ui_server.WORK / "無い.sqlite3"), "cand": "work", "name": "無い", "work": None}], measures=cnt),
        run("作業日を品質で", [lot], rows=[{"column": "@workday"}], measures=cnt),
        run("設備の段を設備の列の無い元で", [lot], rows=[{"column": "@equip"}], measures=cnt),
        run("品質の設備（前方一致）", [lot_pre], rows=[{"column": "@equip"}], cols=[{"column": "合金"}], measures=[{"agg": "lots"}, {"agg": "count"}]),
        run("品質の設備（そのまま・全部。当たらない値は前後の空白を除く）", [lot_same], rows=[{"column": "@equip"}], measures=cnt),
        run("品質の設備（そのまま・選ぶ）", [lot_same], rows=[{"column": "@equip"}], measures=cnt, equips=["CR2", "L-1"]),
        run("設備を選ぶが見分けられない", [lot], rows=[{"column": "合金"}], measures=cnt, equips=["CR2"]),
        run("空欄の決まり（備考）", [lot], rows=[{"column": "備考"}], measures=cnt, filters=[{"column": "備考", "op": "not_empty"}]),
        run("空欄の決まり（＝・空欄）", [lot], rows=[{"column": "備考"}], measures=cnt,
            filters=[{"column": "備考", "op": "in", "value": json.dumps(["ﾃｽﾄ", ""], ensure_ascii=False)}]),
        run("空欄（＝ ﾃｽﾄ）", [lot], rows=[{"column": "合金"}], measures=cnt, filters=[{"column": "備考", "op": "eq", "value": "ﾃｽﾄ"}]),
        run("空欄（≠ *ｽ*）", [lot], rows=[{"column": "合金"}], measures=cnt, filters=[{"column": "備考", "op": "neq", "value": "*ｽ*"}]),
        run("空欄", [lot], rows=[{"column": "合金"}], measures=cnt, filters=[{"column": "備考", "op": "empty"}]),
    ]
    for kind, extra in (("today", {}), ("this_month", {}), ("last_month", {}), ("month", {"n": 1}), ("month", {"n": "13"}), ("days", {"n": 3.9}), ("days", {"n": 99999}),
                        ("range", {"from": "2026-10-01", "to": "2026-09-20"}), ("range", {"from": "20260915"}), ("range", {"to": "2026-W38-3"}),
                        ("range", {}), ("week", {}), ("days", {"n": "0"}), ("month", {"n": "0"}), ("range", {"from": "2026W383"}), ("range", {"from": "2026-W38-7"}),
                        ("days_before", {"n": 3}), ("days_before", {}), ("days_before", {"n": "0"}), ("months", {"n": 2}), ("months", {"n": 999}), ("months", {}),
                        ("this_year", {}), ("last_year", {}), ("years", {"n": 2}), ("years", {"n": 99}), ("years", {"n": "-3"})):
        cases.append(run(f"期間 {kind} {extra}", [lot], rows=[{"column": "発生日", "part": "date"}], measures=cnt,
                         period={"column": "発生日", "kind": kind, **extra}))
    cases += [
        run("期間の列が無い", [lot], measures=cnt, period={"column": "無い", "kind": "today"}),
        run("期間の列を選ばない", [lot], measures=cnt, period={"kind": "today"}),
        run("作業日の期間を品質で", [lot], measures=cnt, period={"column": "@workday", "kind": "today"}),
        run("期間（作業日・今月・太陽暦）", [{**p, "work": {**p["work"], "basis": "cal"}} for p in wp[:4]],
            rows=[{"column": "@workday"}, {"column": "@shift"}], measures=[{"agg": "lots"}], period={"column": "@workday", "kind": "this_month"}),
        run("早朝の作業日の今日（3 直の中）", wp, now=datetime(2026, 10, 2, 5, 0, 0), rows=[{"column": "@equip"}], measures=cnt,
            period={"column": "@workday", "kind": "today"}),
        run("早朝の作業日の今日（太陽暦）", [{**p, "work": {**p["work"], "basis": "cal"}} for p in wp], now=datetime(2026, 10, 2, 5, 0, 0),
            rows=[{"column": "@equip"}], measures=cnt, period={"column": "@workday", "kind": "yesterday"}),
        run("設備のまとめ（小文字・全角で書いた設備・除く設備）", wp, rows=[{"column": "@equip"}], measures=cnt,
            egroups={"groups": [{"name": "書き方", "members": ["ｓｌ１", "dl2", " ls3 "]},
                                {"name": "決まり", "rules": [{"op": "prefix", "value": "c"}], "except": ["ｃｒ２", "cal "]}], "rest": "other"}),
        run("早朝の作業日の前日・直近 2 日", wp, now=datetime(2026, 10, 2, 5, 0, 0), rows=[{"column": "@workday"}, {"column": "@shift"}], measures=cnt,
            period={"column": "@workday", "kind": "days", "n": 2}),
        run("月で絞る（作業日）", wp[:3], rows=[{"column": "@workday", "part": ""}], measures=cnt, month="2026-09"),
        run("表し方（前との差・値の無いまとまり・順位の同じ値）", [big], rows=[{"column": "区分"}],
            measures=[{"agg": "avg", "column": "値", "show": "diff"}, {"agg": "count", "show": "rank"}, {"agg": "distinct", "column": "小", "show": "rank"},
                      {"agg": "sum", "column": "値", "show": "cum"}, {"agg": "max", "column": "値", "show": "rank"}]),
        run("行が 2,000 を超える（並びの順で残す）", [big], rows=[{"column": "鍵"}], measures=cnt),
        run("3 段の行・月の札・時の札", [lot], rows=[{"column": "客先"}, {"column": "合金"}, {"column": "発生日", "part": "month"}],
            cols=[{"column": "入力日時", "part": "hour"}], measures=cnt),
        run("値が 1 つの傾向の数（区間）", [lot], rows=[{"column": "重量", "part": "bin"}], measures=cnt,
            filters=[{"column": "検査番号", "op": "eq", "value": few[0]}]),
        run("計算列のスライサーの条件は知らせない（tuple_in）", [lot], rows=[{"column": "合金"}], measures=cnt,
            filters=[{"column": "計算の名前", "op": "tuple_in", "columns": ["合金"], "value": json.dumps([["A5052"], ["A1100"]])},
                     {"column": "無い列", "op": "eq", "value": "x"}, {"column": "", "op": "eq", "value": "x"}]),
        run("値が空なら件数", [lot], rows=[{"column": "合金"}], measures=[]),
        run("作業日の知らない区切り", wp[:2], rows=[{"column": "@workday", "part": "date"}, {"column": "@shift", "part": "ym"}], measures=cnt),
        run("作業日×直（日付と時刻が別の列・直の外・時刻なし・日付なし）", [tw], rows=[{"column": "@workday"}], cols=[{"column": "@shift"}],
            measures=[{"agg": "count"}, {"agg": "lots"}]),
        run("作業日の期間（日付と時刻が別の列・3 直が 0 時を跨ぐ）", [{**tw, "work": {**tw["work"], "segments": three}}],
            rows=[{"column": "@workday"}, {"column": "@shift"}], measures=cnt, period={"column": "@workday", "kind": "days", "n": 3}),
        run("作業日の前日（日付と時刻が別の列・3 直）", [{**tw, "work": {**tw["work"], "segments": three}}], now=datetime(2026, 10, 2, 8, 30, 0),
            rows=[{"column": "@shift"}], measures=[{"agg": "count"}, {"agg": "lots"}], period={"column": "@workday", "kind": "yesterday"}),
        run("作業日の年・直（日付と時刻が別の列）", [tw], rows=[{"column": "@workday", "part": "year"}, {"column": "@shift"}], measures=cnt),
        run("日付の列の年", [lot], rows=[{"column": "発生日", "part": "year"}], measures=cnt),
        run("値のいろいろ（最小・範囲・下限の効く Cpk）", [lot], rows=[{"column": "合金"}],
            measures=[{"agg": "min", "column": "重量"}, {"agg": "range", "column": "重量"}, {"agg": "cpk", "column": "重量", "lsl": 3000, "usl": 999999},
                      {"agg": "max", "column": "板幅"}]),
        run("箱ひげ（値 2 つ・分布の形）", [lot], measures=cnt, box="重量", filters=[{"column": "検査番号", "op": "starts_any", "value": ",".join(few[:2])}]),
        run("設備グループ（決まりより手で選んだ設備・で始まる）", [lot_pre], rows=[{"column": "@egroup", "part": "線"}, {"column": "@equip"}], measures=cnt,
            sets={"線": [{"name": "後", "rules": [{"op": "prefix", "value": "cr"}]}, {"name": "手", "members": ["CR1"]},
                         {"name": "L", "rules": [{"op": "prefix", "value": "L-"}]}]}),
        run("設備のまとめ（設備の列の無い元・keep）", [lot], rows=[{"column": "合金"}], measures=cnt,
            egroups={"groups": [{"name": "X", "members": ["CR1"]}], "rest": "keep"}),
        run("設備のまとめ（設備の列の無い元・other）", [lot], rows=[{"column": "合金"}], measures=cnt,
            egroups={"groups": [{"name": "X", "members": ["CR1"]}], "rest": "other"}),
        run("計算列で期間を絞る", [lot], rows=[{"column": "合金"}], measures=cnt, period={"column": "日2", "kind": "last_month"},
            calc={"formulas": {"日2": "[発生日]"}, "names": {}}),
        run("計算列の値を選ぶ（in）", [lot], rows=[{"column": "合金"}], measures=cnt,
            filters=[{"column": "合2", "op": "in", "value": json.dumps(["A5052", "A1100"])}], calc={"formulas": {"合2": "[合金] + ''"}, "names": {}}),
        run("列を使わない組（ロット番号の列の無い元）", [big], measures=[{"agg": "count"}, {"agg": "lots"}]),
        run("ロット数（ロット番号の列の無い元）", [big], rows=[{"column": "区分"}], measures=[{"agg": "lots"}]),
        run("≠（* ? なし・前後の空白）", [lot], rows=[{"column": "合金"}], measures=cnt, filters=[{"column": "備考", "op": "neq", "value": "ﾃｽﾄ"}]),
        run("＝（* ? あり・前後の空白）", [lot], rows=[{"column": "合金"}], measures=cnt, filters=[{"column": "備考", "op": "eq", "value": "ﾃｽﾄ*"}]),
        run("検索の * ?", [lot], rows=[{"column": "合金"}], measures=cnt, search="ﾃ?ﾄ"),
        run("検索の前後の空白", [lot], rows=[{"column": "合金"}], measures=cnt, search=" ﾃｽﾄ "),
        run("組み方の誤り（箱ひげの列が無い）", [lot], measures=cnt, box="無い列"),
        run("%点の既定（p が無い）・値の無い区間・種類の空の期間", [lot], rows=[{"column": "重量", "part": "bin"}],
            measures=[{"agg": "pct", "column": "重量"}, {"agg": "pct", "column": "重量", "p": "x"}],
            filters=[{"column": "検査番号", "op": "eq", "value": "無い番号"}], period={"kind": "", "column": "発生日"}),
        run("組み方の誤り（値の列が無い）", [lot], measures=[{"agg": "sum", "column": "無い列"}]),
        run("値のいろいろ", [lot], rows=[{"column": "不良名"}],
            measures=[{"agg": "sd", "column": "重量"}, {"agg": "var", "column": "重量"}, {"agg": "cv", "column": "板幅"},
                      {"agg": "cpk", "column": "重量", "lsl": 100, "usl": "9000"}, {"agg": "mode", "column": "数量"}, {"agg": "distinct", "column": "客先"}]),
        run("表し方（2 段）", [lot], rows=[{"column": "合金"}, {"column": "調質"}], cols=[{"column": "工程"}],
            measures=[{"agg": "count", "show": "cum"}, {"agg": "sum", "column": "重量", "show": "diff", "expr": "÷1000"},
                      {"agg": "avg", "column": "板幅", "show": "rank"}, {"agg": "lots", "show": "pct_col"}, {"agg": "n", "column": "比重", "show": "pct_row", "dec": 2},
                      {"agg": "pct", "column": "重量", "p": 12.5, "show": "pct_total"}]),
        run("組み方の誤り（値）", [lot], measures=[{"agg": "cpk", "column": "重量"}]),
        run("組み方の誤り（計算）", [lot], measures=[{"agg": "sum", "column": "重量", "expr": "x+"}]),
        run("組み方の誤り（形）", [lot], rows="{", measures=cnt),
        run("組み方の誤り（Cpk の下限＝上限）", [lot], measures=[{"agg": "cpk", "column": "重量", "lsl": 5, "usl": 5}]),
        run("組み方の誤り（計算の小さな数）", [lot], measures=[{"agg": "sum", "column": "重量", "expr": "x 0.0000001"}]),
        run("計算の長い式・桁の半分", [lot], rows=[{"column": "合金"}],
            measures=[{"agg": "sum", "column": "重量", "expr": "((値-10)*2+0.5+0.25+0.125)÷1000+0+0+0+0+0+0+0+0+0+0+0+0+0+0+0+0+0+0", "dec": 2.5},
                      {"agg": "avg", "column": "重量", "dec": "3.5"}]),
    ]
    # カラムの札（計算列も: 式が読む列 deps・読めない式・日付と読める計算列）
    calc = {"formulas": {"区分2": "[作業区分] + '!'", "倍重量": "[重量] * 2", "壊れ": "[重量] +", "日": "left([BOX実績_作業開始_日付], 10)",
                       "数日": "20261002 + [入側板厚] * 0"}, "names": {}}
    fields = []
    for spec, cc in ((wp[0], calc), (lot, None), (lot, {"formulas": {"年": "left([発生日], 4)"}, "names": {}}), (big, None)):
        try:
            got = pivot.fields(spec["path"], preferred_table=spec.get("preferred", ""), table_candidates=CANDS[spec["cand"]], calc=cc)
            fields.append({"part": spec, "calc": cc, "calc_text": json.dumps(cc, ensure_ascii=False) if cc else "", "answer": got})
        except Exception as e:
            fields.append({"part": spec, "calc": cc, "fail": str(e)})
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"cases": cases, "fields": fields, "num_expr": num_cases(), "now": NOW.strftime("%Y-%m-%d %H:%M:%S")}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
