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
    # 開発用サーバーは品質の写しの係を作業フォルダの share.sqlite3 で渡す（中身は設定の場所の写しと同じ）。窓は設定の場所を写すので、
    # Python の係も設定の場所に合わせる（製品では、どちらも同じ設定から作る）
    app.config["LOT_MIRROR"].reconfigure(remote=app.config["APP_SETTINGS"]["lot_list"]["source"])
    # 結合: 品質と作業実績に製造条件マスタ（合金・調質 = 材質・質別）。仕掛はロット番号の列を「鋳造番号」・確かめる間隔を 120 秒に
    for key, body in (("lot", {"結合": [{"with": "m0000001", "how": "left", "on": COND, "cols": ["圧延速度", "焼鈍温度"]}]}),
                      ("work", {"結合": [{"with": "m0000001", "how": "inner", "on": COND, "cols": []}]}),
                      ("wip", {"ロット番号の列": "鋳造番号", "確かめる間隔": "120"})):
        r = c.put(f"/api/sources/{key}", json=body)
        assert r.status_code == 200, (key, r.get_json())
    # 結合した表（仕掛 × 製造条件マスタ・設備マスタ。ロット番号の列は自分で「鋳造番号」）
    r = c.post("/api/sources", json={"表示名": "仕掛と条件", "役割": "その他", "元": "wip", "ロット番号の列": "鋳造番号",
                                      "結合": [{"with": "m0000001", "how": "left", "on": [["製造材質", "材質"], ["製造調質", "質別"]], "cols": []},
                                               {"with": "m0000002", "how": "full", "on": [["BOX設計_設備名", "設備名"]], "cols": ["ライン"]}]})
    assert r.status_code == 201, r.get_json()
    view = r.get_json()["row"]["キー"]
    hidden = keys["DL2"]
    repo.work_log_update(hidden["id"], {"表示": "無"})
    # 名前の変わったファイル（HOT: 登録のあとに名前を変えた。同じファイルID でたどる）・大文字小文字の違う登録名（L-1）・
    # 設備ごとの表（TLV は「別表」を読む）
    (folder / "実績_HOT.sqlite3").rename(folder / "実績_HOT_2026.sqlite3")
    repo.work_log_update(keys["L-1"]["id"], {"ファイル名": "実績_l-1.SQLITE3"})
    db = sqlite3.connect(folder / "実績_TLV.sqlite3")
    db.execute("CREATE TABLE 別表 AS SELECT ロット番号, 作業者, 重量, 合金, 調質 FROM 実績 WHERE 作業者 = '作業者A'")
    db.commit()
    db.close()
    repo.work_log_update(keys["TLV"]["id"], {"表": "別表"})
    eq = {n: keys[n]["キー"] for n in ("CAL", "CR2", "ANF", "SL3", "HOT", "L-1", "TLV")}
    calc = json.dumps({"formulas": {"k": "[作業者] + '-' + [作業者]"}}, ensure_ascii=False)
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
        ("POST", "/api/src/wip/refresh", {}),
        ("POST", f"/api/src/{view}/refresh", {}),
    ]
    second = [      # 一般ユーザー: 実績と結合した表のタブを出さない（タブの権限）。仕掛・品質は出す
        ("GET", "/api/worklog", {"equip": eq["CAL"]}),
        ("GET", "/api/worklog/slicer", {"equip": eq["CAL"], "column": "作業者"}),
        ("POST", "/api/worklog/refresh", {"equip": eq["CAL"]}),
        ("GET", f"/api/src/{view}", {}),
        ("GET", f"/api/src/{view}/slicer", {"column": "圧延速度"}),
        ("GET", "/api/src/wip", {"page_size": "10"}),
        ("GET", "/api/lotlist", {"page_size": "10"}),
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
