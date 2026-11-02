# -*- coding: utf-8 -*-
"""一覧の道の「正しい答え」を出す係（版 3.60.0。デスクトップ版の Rust の受け口 desktop/src/lot.rs・lists.rs との突き合わせ。
desktop/tests/routes_parity.rs が呼ぶ）。

    python tests/routes_oracle.py
    python tests/routes_oracle.py --bench 出力.json   … 速さを測る形（大きな試験データ・Python の道の時間つき。desktop/examples/routes_bench.rs が読む）

開発用サーバーと同じ試験データ（tools/ui_server.build。小さめ）に、結合（品質・作業実績・結合した表）・ロット番号の列・表示しない設備を
足し、品質（/api/lotlist）・作業実績（/api/worklog）・データ元（/api/src/<キー>）の一覧・スライサーの問い合わせを Python の道で答える。
Rust は同じ設定の答え（/api/lotlist/settings）と同じ共有のファイルで、自分の写し・結合・段取りから答える（写しの置き場は別）。
    {"phases": [{"name", "settings": 設定の答え, "asks": [{"method", "path", "query", "status", "body"}]}], "python": Python へ回す道}
段は 2 つ: 開発者（全部のタブ）と、一般ユーザー（実績・結合した表のタブを出さない。タブの権限）。窓は同じ写しの係のまま、段ごとの設定の答えで答える。
分岐ごとの問い合わせ: 名前の変わったファイル・大文字小文字の違う登録名・設備ごとの表・見つからない・表示しない・ロット番号の列のある結合した表・
間隔を変えた元・データの時刻（source）・再読込（refresh）・出さないタブ
"""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
sys.path.insert(0, str(PROGRAM / "tools"))
# 窓（Rust）が段取りも受け持つ形の設定の答え（engine は rust のまま）。写しの係は ui_server が渡す本物（写す係）なので受け身にならない
os.environ.update(TPA_SHELL="desktop", TPA_SHELL_SERVES="lotlist,lists")

from app.repositories.master_repository import MasterRepository  # noqa: E402
import ui_server  # noqa: E402
from app.routes.common import forget_tab_cache  # noqa: E402
from ui_server import as_role, build  # noqa: E402

COND = [["合金", "材質"], ["調質", "質別"]]


def median_ms(fn, n=5):
    import time
    fn()                                 # 1 回目（写し・日付の列の見分け・OS のキャッシュ）は数えない
    xs = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        xs.append((time.perf_counter() - t) * 1000)
    return sorted(xs)[n // 2]


def ask_all(c, asks, bench=False):
    out = []
    for method, path, args in asks:
        q = urlencode(args)
        r = c.get(f"{path}?{q}") if method == "GET" else c.post(f"{path}?{q}")
        out.append({"method": method, "path": path, "query": q, "status": r.status_code, "body": None if bench else r.get_json()})
        if bench:
            out[-1]["count"] = (r.get_json() or {}).get("count")
            out[-1]["ms"] = round(median_ms(lambda: c.get(f"{path}?{q}")), 2)
    return out


def main():
    import sqlite3
    bench = "--bench" in sys.argv
    as_role("開発者")                    # データ元を直せる権限（開発用サーバーと同じ）
    app = build(quality=20000, work_rows=2000, wip=20000) if bench else build(quality=600, work_rows=150, wip=400)
    c = app.test_client()
    repo = MasterRepository(app.config["MASTER_STORE"])
    keys = {r["設備名"]: r for r in repo.work_logs()}
    folder = ui_server.WORK / "【New】実績"
    # 空白で埋まる値（版 3.51.1 の空欄の決まり: 前後の半角・全角の空白・タブを除いて空なら空欄。一覧・スライサー・集計で同じ）
    from app.services import lot_list
    qdb = sqlite3.connect(app.config["APP_SETTINGS"]["lot_list"]["source"])
    qt = lot_list.pick_table(lot_list.tables(qdb))
    for i, v in zip([r[0] for r in qdb.execute(f'SELECT rowid FROM "{qt}" ORDER BY rowid LIMIT 32')], ["  ", "\u3000", "\t", " ﾃｽﾄ ", "ﾃｽﾄ", "", None, " \u3000 "] * 4):
        qdb.execute(f'UPDATE "{qt}" SET 備考 = ? WHERE rowid = ?', (v, i))
    # カラムの札の見本の数（先頭 300 個の空でない値がみな数なら数の列）: 100 行目の長さを字にする（30 個しか見ないと数の列に見える）
    qdb.execute(f'UPDATE "{qt}" SET 長さ = ? WHERE rowid = (SELECT rowid FROM "{qt}" ORDER BY rowid LIMIT 1 OFFSET 100)', ("約 3m",))
    qdb.commit()
    qdb.close()
    # 開発用サーバーは品質の写しの係を作業フォルダの share.sqlite3 で渡す（中身は設定の場所の写しと同じ）。窓は設定の場所を写すので、
    # Python の係も設定の場所に合わせる（製品では、どちらも同じ設定から作る）
    app.config["LOT_MIRROR"].reconfigure(remote=app.config["APP_SETTINGS"]["lot_list"]["source"])
    # 結合: 品質と作業実績に製造条件マスタ（合金・調質 = 材質・質別）。仕掛はロット番号の列を「鋳造番号」・確かめる間隔を 120 秒に
    for key, body in (("lot", {"結合": [{"with": "m0000001", "how": "left", "on": COND, "cols": ["圧延速度", "焼鈍温度"]}]}),
                      ("work", {"結合": [{"with": "m0000001", "how": "inner", "on": COND, "cols": []}]}),
                      ("wip", {"ロット番号の列": "鋳造番号", "確かめる間隔": "120"})):
        r = c.put(f"/api/sources/{key}", json=body)
        assert r.status_code == 200, (key, r.get_json())
    # 結合した表（仕掛 × 製造条件マスタ・設備マスタ。ロット番号の列は自分で「取引先」。元の仕掛の「鋳造番号」とは違う列にして取り違えを見分ける）
    r = c.post("/api/sources", json={"表示名": "仕掛と条件", "役割": "その他", "元": "wip", "ロット番号の列": "取引先",
                                      "結合": [{"with": "m0000001", "how": "left", "on": [["製造材質", "材質"], ["製造調質", "質別"]], "cols": []},
                                               {"with": "m0000002", "how": "full", "on": [["BOX設計_設備名", "設備名"]], "cols": ["ライン"]}]})
    assert r.status_code == 201, r.get_json()
    view = r.get_json()["row"]["キー"]
    # 表がいくつもあるファイルの、決めた表（品質の元の「保留」を読むデータ元）。実績の HOT には品質の候補の「仕掛」の表も置く
    r = c.post("/api/sources", json={"表示名": "保留の表", "役割": "その他", "場所": app.config["APP_SETTINGS"]["lot_list"]["source"], "表": "保留"})
    assert r.status_code == 201, r.get_json()
    held = r.get_json()["row"]["キー"]
    hidden = keys["DL2"]
    repo.work_log_update(hidden["id"], {"表示": "無"})
    # 名前の変わったファイル（HOT: 登録のあとに名前を変えた。同じファイルID でたどる）・大文字小文字の違う登録名（L-1）・
    # 設備ごとの表（TLV は「別表」を読む）
    hdb = sqlite3.connect(folder / "実績_HOT.sqlite3")
    hdb.execute("CREATE TABLE 仕掛 AS SELECT ロット番号, 合金 FROM 実績 LIMIT 3")
    hdb.commit()
    hdb.close()
    (folder / "実績_HOT.sqlite3").rename(folder / "実績_HOT_2026.sqlite3")
    repo.work_log_update(keys["L-1"]["id"], {"ファイル名": "実績_l-1.SQLITE3"})
    db = sqlite3.connect(folder / "実績_TLV.sqlite3")
    db.execute("CREATE TABLE 別表 AS SELECT ロット番号, 作業者, 重量, 合金, 調質 FROM 実績 WHERE 作業者 = '作業者A'")
    db.commit()
    db.close()
    repo.work_log_update(keys["TLV"]["id"], {"表": "別表"})
    # 写しを作れない設備（中身が SQLite でない）: 一覧は「写しています」の 503 と理由・再読込は見送った理由を答える（写しが無くてよい）
    (folder / "実績_BAD.sqlite3").write_text("SQLite ではない中身", encoding="utf-8")
    from app.services import work_log
    # 名前だけで登録する（ファイルID を空に）: 登録のあとに消えた SL3 のファイル番号を、新しい BAD がたまたま使い回すと、
    # 「探す」が BAD を名前の変わった SL3 とたどって BAD の行ができない（Linux の file_id は作った時刻を持たない）
    repo.work_log_sync([{**f, "fid": ""} for f in work_log.scan(folder, "実績_*.sqlite3") if f["file"] == "実績_BAD.sqlite3"])
    keys = {r["設備名"]: r for r in repo.work_logs()}
    eq = {n: keys[n]["キー"] for n in ("CAL", "CR2", "ANF", "SL3", "HOT", "L-1", "TLV", "BAD")}
    J = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731
    cnt = J([{"agg": "count"}])
    calc = json.dumps({"formulas": {"k": "[作業者] + '-' + [作業区分]"}}, ensure_ascii=False)
    first = [
        ("GET", "/api/lotlist", {"page": "1"}),
        ("GET", "/api/lotlist", {"group": "1", "page_size": "50", "sorts": json.dumps([{"column": "圧延速度", "dir": "desc"}])}),
        ("GET", "/api/lotlist/slicer", {"column": "圧延速度"}),
        ("GET", "/api/worklog", {"equip": eq["CAL"]}),
        ("GET", "/api/worklog", {"equip": eq["CAL"], "work": "1", "total": "重量", "fill": "1"}),
        ("GET", "/api/worklog", {"equip": eq["CAL"], "work": "1", "day": "2026-09-30"}),
        ("GET", "/api/worklog", {"equip": eq["CR2"], "work": "1", "page_size": "40", "page": "2"}),
        ("GET", "/api/worklog", {"equip": eq["ANF"], "work": "1", "start": "BOX実績_作業開始_年月日時分秒", "basis": "cal"}),
        ("GET", "/api/worklog", {"equip": eq["CAL"], "calc": calc, "sorts": json.dumps([{"column": "k", "dir": "asc"}])}),
        ("GET", "/api/worklog/slicer", {"equip": eq["CAL"], "column": "焼鈍温度"}),
        ("GET", "/api/worklog/slicer", {"equip": eq["CAL"], "column": "無い列"}),
        ("GET", "/api/worklog", {"equip": eq["HOT"], "page_size": "20"}),
        ("GET", "/api/worklog", {"equip": eq["L-1"], "page_size": "20"}),
        ("GET", "/api/worklog", {"equip": eq["TLV"]}),
        ("GET", "/api/worklog/slicer", {"equip": eq["TLV"], "column": "作業者"}),
        ("GET", "/api/worklog", {"equip": eq["SL3"]}),
        ("GET", "/api/worklog", {"equip": hidden["キー"]}),
        ("GET", "/api/worklog", {"equip": "nope"}),
        ("GET", "/api/worklog", {}),
        ("GET", "/api/src/wip", {"group": "1", "page_size": "60"}),
        ("GET", "/api/src/wip/slicer", {"column": "仕掛区分", "search": "缶材"}),
        ("GET", "/api/src/m0000001", {}),
        ("GET", f"/api/src/{view}", {"page_size": "80", "sorts": json.dumps([{"column": "ライン", "dir": "asc"}])}),
        ("GET", f"/api/src/{view}", {"group": "1", "page_size": "40"}),
        ("GET", f"/api/src/{view}/slicer", {"column": "圧延速度"}),
        ("GET", "/api/src/nope", {}),
        # データの時刻（source）・再読込（refresh）: いつのデータか（時刻）は比べず、元の場所・間隔・写したか・再読込の結果を比べる
        ("GET", "/api/lotlist/source", {}),
        ("GET", "/api/worklog/source", {"equip": eq["CAL"]}),
        ("GET", "/api/worklog/source", {"equip": "nope"}),
        ("GET", "/api/src/wip/source", {}),
        ("GET", f"/api/src/{view}/source", {}),
        ("GET", "/api/src/nope/source", {}),
        ("POST", "/api/worklog/refresh", {"equip": eq["CAL"]}),
        ("POST", "/api/worklog/refresh", {"equip": "nope"}),
        ("POST", "/api/worklog/refresh", {"equip": eq["BAD"]}),
        ("GET", "/api/worklog", {"equip": eq["BAD"]}),
        ("POST", "/api/src/wip/refresh", {}),
        ("POST", f"/api/src/{view}/refresh", {}),
        # 空欄の決まり（一覧の条件・スライサー）
        ("GET", "/api/lotlist", {"filters": J([{"column": "備考", "op": "not_empty"}]), "page_size": "20"}),
        ("GET", "/api/lotlist", {"filters": J([{"column": "備考", "op": "eq", "value": "ﾃｽﾄ"}])}),
        ("GET", "/api/lotlist", {"filters": J([{"column": "備考", "op": "neq", "value": "*ｽ*"}]), "page_size": "10"}),
        ("GET", "/api/lotlist", {"filters": J([{"column": "備考", "op": "empty"}]), "page_size": "10"}),
        ("GET", "/api/lotlist/slicer", {"column": "備考"}),
        ("GET", "/api/lotlist", {"filters": J([{"column": "備考", "op": "in", "value": J(["ﾃｽﾄ", ""])}]), "page_size": "10"}),
        # 集計表・グラフ（版 3.61.0 から窓が答える）
        ("GET", "/api/lotlist/pivot", {"fields": "1"}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "合金"}]), "cols": J([{"column": "調質"}]),
                                       "measures": J([{"agg": "count"}, {"agg": "lots"}, {"agg": "sum", "column": "重量"}, {"agg": "avg", "column": "板幅"}])}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "発生日", "part": "ym"}, {"column": "発生日", "part": "date"}]), "measures": cnt, "month": "2026-09"}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "重量", "part": "bin"}]), "measures": cnt}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "設備"}]), "box": "重量",
                                       "measures": J([{"agg": "median", "column": "重量"}, {"agg": "q1", "column": "重量"}, {"agg": "q3", "column": "重量"},
                                                      {"agg": "iqr", "column": "重量"}, {"agg": "pct", "column": "重量", "p": 90}, {"agg": "mode", "column": "数量"}])}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "備考"}]), "measures": cnt, "filters": J([{"column": "備考", "op": "not_empty"}])}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "圧延速度"}]), "measures": J([{"agg": "avg", "column": "重量", "show": "rank", "expr": "÷1000", "dec": 1}])}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "不良名"}]), "cols": J([{"column": "発生日", "part": "weekday"}]), "measures": cnt, "search": "汚れ"}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "客先"}, {"column": "合金"}]), "cols": J([{"column": "入力日時", "part": "hour"}]),
                                       "measures": J([{"agg": "count", "show": "pct_row"}, {"agg": "sum", "column": "重量", "show": "cum"}])}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "無い列"}]), "measures": cnt}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "@workday"}]), "measures": cnt}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "合金"}]), "measures": J([{"agg": "cpk", "column": "重量"}])}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "fields": "1"}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "rows": J([{"column": "@workday"}]), "cols": J([{"column": "@shift"}]),
                                       "measures": J([{"agg": "count"}, {"agg": "lots"}, {"agg": "sum", "column": "重量"}])}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "rows": J([{"column": "@workday", "part": "ym"}]), "measures": J([{"agg": "lots"}]), "basis": "cal"}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "rows": J([{"column": "@workday"}]), "measures": cnt, "basis": ""}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "rows": J([{"column": "@workday"}]), "measures": cnt, "month": "2026-09"}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "rows": J([{"column": "作業区分"}]), "cols": J([{"column": "@shift"}]),
                                       "measures": J([{"agg": "avg", "column": "速度", "show": "pct_col"}]), "filters": J([{"column": "作業者", "op": "neq", "value": "作業者B"}])}),
        ("GET", "/api/worklog/pivot", {"equip": eq["ANF"], "rows": J([{"column": "@workday"}]), "measures": J([{"agg": "lots"}, {"agg": "count"}]),
                                       "start": "BOX実績_作業開始_年月日時分秒"}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CR2"], "rows": J([{"column": "@shift"}]), "measures": cnt}),
        ("GET", "/api/worklog/pivot", {"equip": eq["TLV"], "rows": J([{"column": "作業者"}]), "measures": cnt}),
        ("GET", "/api/worklog/pivot", {"equip": eq["HOT"], "rows": J([{"column": "合金"}]), "measures": cnt}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "rows": J([{"column": "@equip"}]), "measures": cnt}),
        ("GET", "/api/worklog/pivot", {"equip": eq["BAD"], "rows": J([{"column": "合金"}]), "measures": cnt}),
        ("GET", "/api/worklog/pivot", {"equip": "nope", "measures": cnt}),
        ("GET", "/api/src/wip/pivot", {"fields": "1"}),
        ("GET", "/api/src/wip/pivot", {"rows": J([{"column": "仕掛区分"}]), "cols": J([{"column": "製造材質"}]), "measures": J([{"agg": "lots"}, {"agg": "count"}])}),
        ("GET", f"/api/src/{view}/pivot", {"rows": J([{"column": "ライン"}]), "measures": J([{"agg": "lots"}, {"agg": "distinct", "column": "製造調質"}])}),
        ("GET", f"/api/src/{view}/pivot", {"fields": "1"}),
        ("GET", "/api/src/m0000001/pivot", {"rows": J([{"column": "材質"}]), "measures": cnt}),
        ("GET", f"/api/src/{held}/pivot", {"rows": J([{"column": "合金"}]), "measures": cnt}),
        ("GET", f"/api/src/{held}", {"page_size": "5"}),
        ("GET", "/api/src/nope/pivot", {"measures": cnt}),
    ]
    second = [      # 一般ユーザー: 実績と結合した表のタブを出さない（タブの権限）。仕掛・品質は出す
        ("GET", "/api/worklog", {"equip": eq["CAL"]}),
        ("GET", "/api/worklog/slicer", {"equip": eq["CAL"], "column": "作業者"}),
        ("POST", "/api/worklog/refresh", {"equip": eq["CAL"]}),
        ("GET", f"/api/src/{view}", {}),
        ("GET", f"/api/src/{view}/slicer", {"column": "圧延速度"}),
        ("GET", "/api/worklog/source", {"equip": eq["CAL"]}),   # データの時刻はタブの権限を見ない（Python の worklog_source と同じ）
        ("POST", f"/api/src/{view}/refresh", {}),           # 再読込・データの時刻はタブの権限を見ない（Python の src_refresh・src_source と同じ）
        ("GET", f"/api/src/{view}/source", {}),
        ("GET", "/api/src/wip", {"page_size": "10"}),
        ("GET", "/api/lotlist", {"page_size": "10"}),
        ("GET", "/api/worklog/pivot", {"equip": eq["CAL"], "measures": cnt}),
        ("GET", f"/api/src/{view}/pivot", {"measures": cnt}),
        ("GET", "/api/src/wip/pivot", {"rows": J([{"column": "仕掛区分"}]), "measures": cnt}),
        ("GET", "/api/lotlist/pivot", {"rows": J([{"column": "合金"}]), "measures": cnt}),
    ]
    if bench:      # 速さ: 一覧・まとめ・検索・スライサー（失敗の答え・データの時刻・再読込は測らない）
        first = [a for a in first if a[0] == "GET" and a[2] and not a[1].endswith("/source") and "nope" not in a[1]
                 and a[2].get("equip") not in ("nope", eq["SL3"], hidden["キー"])]
        first += [("GET", "/api/worklog", {"equip": eq["CAL"], "search": "再処理"}), ("GET", "/api/src/wip", {"search": "缶材"}),
                  ("GET", "/api/lotlist", {"search": "汚れ"})]
        doc = {"settings": c.get("/api/lotlist/settings").get_json(), "asks": ask_all(c, first, bench=True)}
        Path(sys.argv[sys.argv.index("--bench") + 1]).write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        return
    phases = [{"name": "開発者", "asks": ask_all(c, first), "settings": c.get("/api/lotlist/settings").get_json()}]
    as_role("一般ユーザー")
    repo.tab_access_put({"work": ["一般ユーザー"], view: ["一般ユーザー"]})
    forget_tab_cache()
    phases.append({"name": "一般ユーザー", "asks": ask_all(c, second), "settings": c.get("/api/lotlist/settings").get_json()})
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"phases": phases, "python": "/api/src/sch"}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
