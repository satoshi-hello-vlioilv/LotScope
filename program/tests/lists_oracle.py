# -*- coding: utf-8 -*-
"""作業実績・データ元の一覧の「正しい答え」を出す係（版 3.60.0。デスクトップ版の Rust との突き合わせ・desktop/tests/lists_parity.rs が呼ぶ）。

    python tests/lists_oracle.py 作業フォルダ

品質の一覧（lotlist_oracle.py）と同じ部品（lot_list.query・slicer）を、作業実績・データ元の道（routes/worklog.py・sources.py）と同じ渡し方で引く:
表の候補（作業実績は 実績・作業実績）・設定の表・ロット番号の列の上書き（データ元の lotSet）・作業でまとめる（work_summary.grouping_of）。
日時の読み方（sqlite_ro.to_datetime・to_minutes）は値ごとの答えも出す（作業開始の鍵・日・直の元）。
    {"dbs": {名前: 場所}, "today": …, "shifts": 勤務体系の行, "cases": [...], "expected": [...], "datetimes": [[値, 時刻の値, 答え]], "minutes": [[値, 答え]]}
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import data_join, data_sources, lot_list, work_log, work_summary  # noqa: E402
from app.services.sqlite_ro import to_datetime, to_minutes  # noqa: E402
from tests import lotlist_fixture  # noqa: E402

TODAY = lotlist_fixture.TODAY
# 勤務体系（開発用サーバーと同じ: 全設備共通の 1,2,3 直と、CR2 だけの 4,5 直。dayOffset は跨ぐ直の跨いだ後）
SHIFTS = [
    {"id": 1, "名称": "交替勤務(1,2,3直)", "適用設備": "", "表示順": "1",
     "区分": json.dumps([{"name": "1直", "start": "07:00", "end": "15:00"}, {"name": "2直", "start": "15:00", "end": "23:00"},
                         {"name": "3直", "start": "23:00", "end": "07:00", "dayOffset": -1}], ensure_ascii=False)},
    {"id": 2, "名称": "CR2", "適用設備": "CR2、ＣＲ２", "表示順": "2",
     "区分": json.dumps([{"name": "4直", "start": "11:00", "end": "19:10"}, {"name": "5直", "start": "21:20", "end": "05:45"}], ensure_ascii=False)},
]
CANDS = {"lot": lot_list.TABLE_CANDIDATES, "work": work_log.TABLE_CANDIDATES, "src": data_sources.TABLE_CANDIDATES}

# 時刻が別の列にある作業実績（作業開始_日付 ＋ 作業開始_時刻）と、書き方のゆれ
SPLIT_ROWS = [
    ("A1", "2026/10/01", "8:15", 10.5), ("A2", "2026/10/01", "8:15", "1,200"), ("A3", "2026/10/01", "午後 8:15", 3),
    ("A4", "2026-10-02", "8:15:30 PM", None), ("A5", "20261002", "23:30", 2.5), ("A6", "２０２６/１０/０３", "６:４５", "x"),
    ("A7", "2026/10/03 2:10", "9:99", 1), ("A8", "", "8:00", 4), ("A9", "不明", "", 5), ("B1", 20261003064500, None, 1),
    ("B2", "2026/10/04", None, 1), ("B3", "2026/10/04T05:59", "", 2), ("B4", "26/10/05 23:48:54", "", 1), ("B5", "2026年10月5日", "7:00", 1),
    ("B6", "2026/10/06 12:00 AM", "", 1), ("B7", "2026/10/06 12:30 pm", "", 1), ("B8", "2026/10/06 0:30 a.m.", "", 1),
    ("B9", "2026/10/07 24:10", "", 1), ("C1", "2026.10.7 7:00:00.5", "", 1), ("C2", None, None, 1), ("C3", "2026/10/07 7:00", "", " 7 "),
]
DT_VALUES = ["2026/10/01 8:15:00", "2026/10/01 8:15", "2026-10-01T08:15", "2026.10.1 8:15:00.250", "20261002201500", "20261302201500",
             "20261002241500", " 2026/10/02 午後 8:15:00 ", "2026/10/02 8:15:00 PM", "2026/10/02 8:15 p.m.", "2026/10/02 12:05 AM",
             "2026/10/02 午前 12:05", "PM 2026/10/02 8:00", "2026/10/02 8:00 PMX", "2026/10/02 8:00 PM.", "XPM 2026/10/02 8:00",
             "２０２６/１０/０２ ８:１５", "２０２６１００２２０１５００", "2026/10/02 25:00", "2026/10/02 23:60", "2026/02/30 8:00",
             "2026年10月2日 8:15", "26/10/02 23:48:54", "20261002", "20261002 8:15", "1899/12/30 8:15:00", "8:15", "", "  ", "不明",
             "2026/10/02T8:15", "2026/10/02  8:15", "2026/10/02 8:5", "2026/10/02 8:15:5", "2026/10/02 8:15:00.", "2026/10/2",
             "2026-10-2 7:00 am", "2026/10/02　8:15", "2026/10/02 8:15　PM", None, 20261002201500, 20261002, 2026.5, 0,
             "2026/10/02 8:15:00Z", "2026/10/02 08:15:00+09:00", "T8:15", "x 8:15 y"]
TIMES = [None, "8:15", "午後 8:15", "8:15 PM", "25:00", "８:１５", "x", "", 815, "20:15:59.9", "1899/12/30 8:15:00"]


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


def _f(*items):
    return json.dumps(list(items), ensure_ascii=False)


def _s(*items):
    return json.dumps([{"column": c, "dir": d} for c, d in items], ensure_ascii=False)


W = {"work": "1"}
CASES = [
    # 作業実績（表 実績・400 行）: 作業でまとめる（新しい順・現場歴）・ページ・古い順・太陽暦・帯で押した日と直・0 件の日・合計する列
    {"db": "work", "cands": "work", "args": {**W}},
    {"db": "work", "cands": "work", "args": {**W, "page": "2", "page_size": "60"}},
    {"db": "work", "cands": "work", "args": {**W, "order": "asc", "basis": "cal", "page_size": "80"}},
    {"db": "work", "cands": "work", "args": {**W, "day": "2026-09-29"}},
    {"db": "work", "cands": "work", "args": {**W, "day": "2026-09-29", "shift": "0"}},
    {"db": "work", "cands": "work", "args": {**W, "day": "2026-09-29", "shift": " 2 "}},
    {"db": "work", "cands": "work", "args": {**W, "day": "-"}},
    {"db": "work", "cands": "work", "args": {**W, "day": "2026-9-29", "shift": "x"}},
    {"db": "work", "cands": "work", "args": {**W, "fill": "1", "total": "重量"}},
    {"db": "work", "cands": "work", "args": {**W, "total": "無い列", "basis": "zzz", "order": "zzz"}},
    {"db": "work", "cands": "work", "args": {**W, "start": "作業日"}},
    {"db": "work", "cands": "work", "args": {**W, "start": "BOX実績_作業終了_日付", "order": "asc"}},
    {"db": "work", "cands": "work", "args": {**W, "start": "無い列"}},
    {"db": "work", "cands": "work", "args": {**W, "search": "再処理", "filters": _f({"column": "作業者", "op": "eq", "value": "作業者B"}),
                                             "sorts": _s(("重量", "desc"))}},
    {"db": "work", "cands": "work", "args": {**W, "marks": json.dumps([[{"column": "作業区分", "op": "eq", "value": "試作"}]], ensure_ascii=False)}},
    {"db": "work", "cands": "work", "equip": "CR2", "args": {**W, "fill": "1"}},
    {"db": "work", "cands": "work", "equip": "ｃｒ２", "args": {**W, "day": "2026-09-30", "shift": "1"}},
    {"db": "work", "cands": "work", "args": {"page_size": "50", "sorts": _s(("BOX実績_作業開始_日付", "desc"))}},
    {"db": "work", "cands": "work", "args": {"group": "1", "page_size": "40"}},
    {"db": "work", "cands": "work", "args": {"work": "0", "group": "1"}},
    {"db": "work", "cands": "work", "slicer": "作業者", "args": {"search": "通常"}},
    {"db": "work", "cands": "work", "combos": json.dumps(["合金", "調質"]), "args": {}},
    # 焼鈍炉（作業開始が日時・14 桁の列・いま炉の中）
    {"db": "box", "cands": "work", "args": {**W, "total": "重量", "fill": "1"}},
    {"db": "box", "cands": "work", "args": {**W, "start": "BOX実績_作業開始_年月日時分秒", "basis": "cal"}},
    {"db": "box", "cands": "work", "args": {**W, "start": "BOX実績_作業終了_年月日時分秒"}},
    # 時刻が別の列・書き方のゆれ（表は「作業実績」。候補の 2 つ目）
    {"db": "split", "cands": "work", "args": {**W, "total": "重量", "fill": "1"}},
    {"db": "split", "cands": "work", "args": {**W, "order": "asc", "basis": "cal"}},
    {"db": "split", "cands": "work", "args": {**W, "day": "2026-10-01"}},
    {"db": "split", "cands": "work", "args": {**W, "day": "-", "shift": "-2"}},
    {"db": "split", "cands": "work", "equip": "CR2", "args": {**W, "page_size": "3", "page": "2"}},
    {"db": "contains", "cands": "work", "args": {**W}},
    {"db": "contains", "cands": "work", "table": "aaa", "args": {}},
    {"db": "contains", "cands": "lot", "args": {}},
    {"db": "empty", "cands": "work", "args": {}},
    {"db": "empty", "cands": "lot", "args": {}},
    {"db": "empty", "cands": "src", "slicer": "x", "args": {}},
    # 仕掛（データ元の 1 ファイルの元）: 候補・設定の表・ロット番号の列の上書き（自動・なし・この列・無い列）
    {"db": "wip", "cands": "src", "args": {"group": "1", "page_size": "100"}},
    {"db": "wip", "cands": "src", "lot": "-", "args": {"group": "1", "page_size": "100"}},
    {"db": "wip", "cands": "src", "lot": "鋳造番号", "args": {"group": "1", "page_size": "100", "sorts": _s(("鋳造番号", "asc"))}},
    {"db": "wip", "cands": "src", "lot": "無い列", "args": {"group": "1"}},
    {"db": "wip", "cands": "src", "lot": "-", "args": {"sorts": _s(("ロット番号", "desc"))}},
    {"db": "wip", "cands": "src", "lot": "取引先", "args": {"sorts": _s(("取引先", "asc")), "page_size": "30"}},
    {"db": "wip", "cands": "src", "table": "無い表", "args": {"search": "缶材"}},
    {"db": "wip", "cands": "src", "slicer": "仕掛区分", "args": {"filters": _f({"column": "製造材質", "op": "eq", "value": "A5052"})}},
    {"db": "quality", "cands": "lot", "lot": "設備", "args": {"group": "1", "page_size": "50"}},
    {"db": "quality", "cands": "lot", "lot": "-", "args": {"group": "1", "page_size": "50"}},
]


# 結合（版 3.60.0。data_join → desktop/src/join.rs）: 元・相手（製造条件・設備のマスタ）・決まり
_COND = [["合金", "材質"], ["調質", "質別"]]
JOINS = [
    {"base": "quality", "items": [{"with": "cond", "how": "left", "on": _COND, "cols": []}]},
    {"base": "quality", "items": [{"with": "cond", "how": "inner", "on": _COND, "cols": ["圧延速度"]},
                                  {"with": "eq", "how": "left", "on": [["設備", "設備名"]], "cols": ["ライン"]}]},
    {"base": "quality", "items": [{"with": "cond", "how": "right", "on": _COND, "cols": ["焼鈍温度", "無い列"]}]},
    {"base": "quality", "items": [{"with": "eq", "how": "full", "on": [["設備", "設備名"]], "cols": []}]},
    {"base": "quality", "items": [{"with": "cond", "how": "left", "on": _COND, "cols": []}, {"with": "cond", "how": "left", "on": _COND, "cols": []},
                                  {"with": "cond", "how": "full", "on": [["合金", "材質"]], "cols": ["圧延速度"]}]},
    {"base": "wip", "items": [{"with": "cond", "how": "left", "on": [["製造材質", "材質"], ["製造調質", "質別"]], "cols": ["圧延速度", "改訂日"]}]},
    {"base": "quality", "items": [{"with": "cond", "how": "left", "on": [["無い鍵", "材質"]], "cols": []}]},
    {"base": "quality", "items": [{"with": "cond", "how": "left", "on": [["合金", "無い相手の鍵"]], "cols": []}]},
]
MASTER_TABLES = {"cond": ("製造条件マスタ", "製造条件"), "eq": ("設備マスタ", "設備")}


def join_answer(work, dbs, masters, i, case):
    base = dbs[case["base"]]
    table = "仕掛"
    rights = [(str(masters[MASTER_TABLES[j["with"]][0]]), MASTER_TABLES[j["with"]][1], MASTER_TABLES[j["with"]][0]) for j in case["items"]]
    dest = work / "joins_py" / f"j{i}.sqlite3"
    try:
        stats = data_join.build(dest, base, table, case["items"], rights)
    except Exception as e:
        return {"error": str(e), "rule": isinstance(e, data_join.JoinError)}
    c = sqlite3.connect(dest)
    cols = [r[1] for r in c.execute(f'PRAGMA table_info("{table}")')]
    rows = [[lot_list._json_value(v) for v in r] for r in c.execute(f'SELECT * FROM "{table}"')]     # バイナリは大きさ（Rust の json_of と同じ）
    c.close()
    path, _ = data_join.Joiner(work / "joiner_py").path_for(f"k{i}", base, table, case["items"], rights)
    return {"stats": stats, "columns": cols, "rows": rows, "rights": rights, "name": Path(path).name}


def answer(dbs, case):
    a = {k: str(v) for k, v in case["args"].items()}
    db, cands = dbs[case["db"]], CANDS[case["cands"]]
    common = {"table": a.get("table", ""), "preferred_table": case.get("table", ""), "search": a.get("search", ""),
              "filters": a.get("filters", ""), "today": TODAY, "table_candidates": cands}
    try:
        if "combos" in case:
            out = lot_list.slicer_combos(db, use=case["combos"], **common)
        elif "slicer" in case:
            out = lot_list.slicer(db, column=case["slicer"], key=a.get("key", ""), **common)
        else:
            grouping = work_summary.grouping_of(a, SHIFTS, case.get("equip", "CAL"))
            out = lot_list.query(db, page=a.get("page", 1), page_size=a.get("page_size", 500), sorts=a.get("sorts", ""),
                                 group=a.get("group") == "1", marks=a.get("marks", ""), grouping=grouping, lot_col=case.get("lot") or None,
                                 **common)
    except Exception as e:
        return {"error": str(e)}
    out.pop("timing", None)
    if isinstance(out.get("work"), dict):
        out["work"].pop("ms", None)
    return {"ok": out}


def main():
    work = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    work.mkdir(parents=True, exist_ok=True)
    dbs = {k: str(work / f"{k}.sqlite3") for k in ("work", "box", "split", "contains", "empty", "wip", "quality")}
    for p in dbs.values():
        Path(p).unlink(missing_ok=True)
    lotlist_fixture.make_work(dbs["work"], "CAL", n=400)
    lotlist_fixture.make_work_box(dbs["box"])
    make_split(dbs["split"])
    make_contains(dbs["contains"])
    make_empty(dbs["empty"])
    lotlist_fixture.make_wip(dbs["wip"], n=600)
    lotlist_fixture.make(dbs["quality"], 800)
    expected = [answer(dbs, c) for c in CASES]
    import shutil
    for d in ("masters", "joins_py", "joiner_py"):
        shutil.rmtree(work / d, ignore_errors=True)
    masters = lotlist_fixture.make_masters(work / "masters")
    joins = [{**c, "expected": join_answer(work, dbs, masters, i, c)} for i, c in enumerate(JOINS)]
    datetimes = [[v, t, to_datetime(v, t)] for v in DT_VALUES for t in TIMES]
    minutes = [[v, (lambda m: list(m) if m else None)(to_minutes(v))] for v in DT_VALUES + TIMES]
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"dbs": dbs, "today": TODAY.isoformat(), "shifts": SHIFTS, "cases": CASES, "expected": expected,
               "datetimes": datetimes, "minutes": minutes, "joins": joins}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
