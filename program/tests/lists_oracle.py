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
from tests import lists_scene, lotlist_fixture  # noqa: E402

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

DT_VALUES = ["2026/10/01 8:15:00", "2026/10/01 8:15", "2026-10-01T08:15", "2026.10.1 8:15:00.250", "20261002201500", "20261302201500",
             "20261002241500", " 2026/10/02 午後 8:15:00 ", "2026/10/02 8:15:00 PM", "2026/10/02 8:15 p.m.", "2026/10/02 12:05 AM",
             "2026/10/02 午前 12:05", "PM 2026/10/02 8:00", "2026/10/02 8:00 PMX", "2026/10/02 8:00 PM.", "XPM 2026/10/02 8:00",
             "２０２６/１０/０２ ８:１５", "２０２６１００２２０１５００", "2026/10/02 25:00", "2026/10/02 23:60", "2026/02/30 8:00",
             "2026年10月2日 8:15", "26/10/02 23:48:54", "20261002", "20261002 8:15", "1899/12/30 8:15:00", "8:15", "", "  ", "不明",
             "2026/10/02T8:15", "2026/10/02  8:15", "2026/10/02 8:5", "2026/10/02 8:15:5", "2026/10/02 8:15:00.", "2026/10/2",
             "2026-10-2 7:00 am", "2026/10/02　8:15", "2026/10/02 8:15　PM", None, 20261002201500, 20261002, 2026.5, 0,
             "2026/10/02 8:15:00Z", "2026/10/02 08:15:00+09:00", "T8:15", "x 8:15 y"]
TIMES = [None, "8:15", "午後 8:15", "8:15 PM", "25:00", "８:１５", "x", "", 815, "20:15:59.9", "1899/12/30 8:15:00"]


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
MASTER_TABLES = {"cond": ("製造条件マスタ", "製造条件"), "eq": ("設備マスタ", "設備"), "dup": ("重なりマスタ", "設備")}
# 版 3.96.0（rightHit を索引で数える直し）: 相手の鍵が NULL・空・重なり・相手の方が多い・複数の鍵の形
_DUP = [["設備", "設備名"]]
JOINS += [
    {"base": "quality", "items": [{"with": "dup", "how": "left", "on": _DUP, "cols": ["ライン"]}]},
    {"base": "quality", "items": [{"with": "dup", "how": "inner", "on": _DUP, "cols": []}]},
    {"base": "quality", "items": [{"with": "dup", "how": "right", "on": _DUP, "cols": ["ライン"]}]},
    {"base": "quality", "items": [{"with": "dup", "how": "full", "on": _DUP + [["合金", "材質"]], "cols": ["ライン"]}]},
    {"base": "wip", "items": [{"with": "dup", "how": "left", "on": [["製造材質", "材質"]], "cols": []},
                              {"with": "dup", "how": "left", "on": [["BOX設計_設備名", "設備名"]], "cols": ["ライン"]}]},
]


def join_answer(work, dbs, masters, i, case):
    base = dbs[case["base"] + "_s"]          # 結合の基は小さい物（lists_scene）
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
    return {"stats": stats, "columns": cols, "rows": rows, "name": Path(path).name}


def rights_of(masters, case):
    """結合の相手（場所・表・名前）。失敗の事例も同じ作り方（版 3.116.0: 前は答えの中に持ち、窓の試験が失敗の事例の分を作り直していた）"""
    return [[str(masters[MASTER_TABLES[j["with"]][0]]), MASTER_TABLES[j["with"]][1], MASTER_TABLES[j["with"]][0]] for j in case["items"]]


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
    dbs, masters = lists_scene.build(work)          # 場面の台本（標準の部品だけ。Python 無しの形の窓の試験も同じ台本を呼ぶ）
    expected = [answer(dbs, c) for c in CASES]
    import shutil
    for d in ("joins_py", "joiner_py"):
        shutil.rmtree(work / d, ignore_errors=True)
    joins = [{**c, "rights": rights_of(masters, c), "expected": join_answer(work, dbs, masters, i, c)} for i, c in enumerate(JOINS)]
    datetimes = [[v, t, to_datetime(v, t)] for v in DT_VALUES for t in TIMES]
    minutes = [[v, (lambda m: list(m) if m else None)(to_minutes(v))] for v in DT_VALUES + TIMES]
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"dbs": dbs, "today": TODAY.isoformat(), "shifts": SHIFTS, "cases": CASES, "expected": expected,
               "datetimes": datetimes, "minutes": minutes, "joins": joins, "sceneMade": lists_scene.made()}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
