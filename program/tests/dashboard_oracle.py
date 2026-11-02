# -*- coding: utf-8 -*-
"""ダッシュボードのパネルの数の「正しい答え」を出す係（版 3.62.0。デスクトップ版の Rust の desktop/src/dashboard.rs との突き合わせ。
desktop/tests/dash_parity.rs が呼ぶ）。

    python tests/dashboard_oracle.py
    python tests/dashboard_oracle.py --bench 出力.json   … 速さを測る形（大きな試験データ・Python の道の時間つき。desktop/examples/dash_bench.rs が読む）

開発用サーバーと同じ試験データ（tools/ui_server.build。小さめ）に、ダッシュボードで分かれ道になる物を初めから足す:
読めない設備（ファイルが無い SL3・中身が SQLite でない BAD）・表示しない設備（DL2）・作業実績のロット番号の列の上書き・設備の並び（並び）・
品質の設備の列の書きゆれ（全角・小文字・前後の空白）と 30 を超える設備（並べる図の上限 24）・仕掛の設備の列（前方一致）・
設備グループ（選んだ設備・で始まる・正規表現・除く設備）・全角の合金（別のデータを合わせる軸の NFKC）。
そのうえで POST /api/dashboard/query をパネルの形ごと（数字・グラフ・合わせた表・別のデータ・設備の分け方〈重ねる・並べる・合算〉・
設備のまとめ・設備グループの段・手で並べた順・期間・計算列・箱ひげ・確かめの失敗）に Python の道で答える。
Rust は同じ設定の答え（/api/lotlist/settings。dash に設備の名前・設備グループ・試験の「いま」）と同じ共有のファイルで答える。
    {"settings": 設定の答え, "cases": [{"name", "panel", "status", "body"}], "python": [Python へ回すはずの組の名前]}
"""
import json
from datetime import timedelta
import os
import sqlite3
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
sys.path.insert(0, str(PROGRAM / "tools"))
os.environ.update(TPA_SHELL="desktop", TPA_SHELL_SERVES="lotlist,lists")

from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.services import dashboard, equip_groups, lot_list, work_log  # noqa: E402
import ui_server  # noqa: E402
from app.routes.common import forget_tab_cache  # noqa: E402
from ui_server import as_role, build  # noqa: E402

D = lambda c, p="": {"column": c, "part": p}  # noqa: E731
LOTS, CNT = {"agg": "lots"}, {"agg": "count"}


def pv(visual, source, rows=(), cols=(), measures=(LOTS,), **kw):
    return {"id": "t1", "title": kw.pop("title", ""), "visual": visual, "source": source,
            "body": {"rows": list(rows), "cols": list(cols), "measures": list(measures)}, **kw}


def side(source, key, measure=LOTS, **kw):
    return {"source": source, "key": key, "measure": measure, **kw}


def setup(app):
    c = app.test_client()
    repo = MasterRepository(app.config["MASTER_STORE"])
    settings = app.config["APP_SETTINGS"]
    # 品質の設備の列: 書きゆれ（全角・小文字・前後の空白・空欄）と、30 を超える知らない設備（並べる図は 24 まで）
    qdb = sqlite3.connect(settings["lot_list"]["source"])
    qt = lot_list.pick_table(lot_list.tables(qdb))
    ids = [r[0] for r in qdb.execute(f'SELECT rowid FROM "{qt}" ORDER BY rowid')]
    lot_ids = [r[0] for r in qdb.execute(f'SELECT DISTINCT ロット番号 FROM "{qt}" ORDER BY rowid DESC LIMIT 300')]
    vals = ["CR2 1号", "cr1", "L-1 南", "ＣＲ２", " ", None, "TLV", "l-10", " L-9 ", "　"] + [f"X-{i:02d}" for i in range(1, 33)]
    for i, v in zip(ids[::3], vals * 6):
        qdb.execute(f'UPDATE "{qt}" SET 設備 = ? WHERE rowid = ?', (v, i))
    qdb.commit()
    qdb.close()
    # 品質の写しの係を設定の場所に合わせる（routes_oracle.py と同じ。中身を直してから写す）
    app.config["LOT_MIRROR"].reconfigure(remote=settings["lot_list"]["source"])
    # 作業実績: 全角の合金（別のデータを合わせる軸の見分け）・中身が SQLite でない設備・表示しない設備・並び
    folder = ui_server.WORK / "【New】実績"
    db = sqlite3.connect(folder / "実績_CAL.sqlite3")
    db.execute("UPDATE 実績 SET 合金 = 'Ａ５０５２' WHERE 合金 = 'A5052' AND rowid % 2 = 0")
    db.commit()
    db.close()
    (folder / "実績_BAD.sqlite3").write_text("SQLite ではない中身", encoding="utf-8")
    repo.work_log_sync([{**f, "fid": ""} for f in work_log.scan(folder, "実績_*.sqlite3") if f["file"] == "実績_BAD.sqlite3"])
    keys = {r["設備名"]: r for r in repo.work_logs()}
    repo.work_log_update(keys["DL2"]["id"], {"表示": "無"})
    # ファイルが無い設備（SL3）は名前でだけたどる（ファイルID を空に）: 消えた SL3 のファイル番号を新しい BAD が使い回すと、SL3 が BAD の写しを読む
    # （routes_oracle.py と同じ）。SL3 は「見つからない」・BAD は「写しています」の失敗になり、写し中の答えを先に選ぶ決まりが見える
    repo.work_log_update(keys["SL3"]["id"], {"ファイルID": ""})
    # 作業開始の列の無い表（TLV は「別表」を読む）: 実績本数がロット番号の列（上書きの「作業者」）の種類の数になる
    db = sqlite3.connect(folder / "実績_TLV.sqlite3")
    db.execute("CREATE TABLE 別表 AS SELECT ロット番号, 作業者, 重量, 合金, 調質, 作業区分 FROM 実績")
    db.commit()
    db.close()
    repo.work_log_update(keys["TLV"]["id"], {"表": "別表"})
    for n, o in (("TLV", "1"), ("CAL", "2"), ("CR2", "x")):     # 並び（番号の無い・読めない番号は後ろに登録の順）
        repo.work_log_update(keys[n]["id"], {"並び": o})
    # 仕掛の設備の列: 前方一致でだけ設備に見分けられる値（「CR1 南」「L-1 2号」）と、どの設備でもない値
    wdb = sqlite3.connect(settings["sources"]["wip"]["source"])
    wids = [r[0] for r in wdb.execute("SELECT rowid FROM 仕掛 ORDER BY rowid")]
    for i, v in zip(wids[::4], ["CR1 南", "L-1 2号", "ＣＲ２-東", "謎の設備", "", None, " "] * 20):
        wdb.execute("UPDATE 仕掛 SET BOX設計_設備名 = ? WHERE rowid = ?", (v, i))
    wdb.commit()
    wdb.close()
    # 壊れたビューを決めたデータ元（写しはできるが、数える中で読めない: 元の表を消したビュー）
    broken = ui_server.WORK / "共有" / "壊れたビュー.sqlite3"
    bdb = sqlite3.connect(broken)
    bdb.executescript("CREATE TABLE 元 (ロット番号 TEXT, 合金 TEXT); CREATE TABLE 残る (a); INSERT INTO 残る VALUES (1);"
                      "CREATE VIEW 見る AS SELECT * FROM 元; DROP TABLE 元;")
    bdb.close()
    r = c.post("/api/sources", json={"表示名": "壊れたビューの元", "役割": "その他", "場所": str(broken), "表": "見る"})
    assert r.status_code == 201, r.get_json()
    empty_key = r.get_json()["row"]["キー"]
    # データ元: 仕掛の設備の列（前方一致）・作業実績のロット番号の列の上書き
    for key, body in (("wip", {"設備の列": "BOX設計_設備名", "設備の取り出し方": "前方一致"}), ("work", {"ロット番号の列": "作業者"}),
                      ("lot", {"ロット番号の列": "客先"})):
        r = c.put(f"/api/sources/{key}", json=body)
        assert r.status_code == 200, (key, r.get_json())
    # 設備グループ: 正規表現と除く設備のまとめ方（ライン別は ui_server が作る: CR ライン〈選んだ〉・L ライン〈L- で始まる〉）
    repo.equip_group_create(equip_groups.clean_row({"name": "冷延", "set": "工程（冷延・仕上）", "equipment": ["TLV"], "rules": [{"op": "regex", "value": "^CR\\d"}],
                                                    "except": ["CR2"]}))
    repo.equip_group_create(equip_groups.clean_row({"name": "仕上", "set": "工程（冷延・仕上）", "equipment": ["CAL", "ＣＲ２"]}))
    # 除く設備がほかのグループに書かれていないまとめ方（除くが集計のまとめで効く）
    repo.equip_group_create(equip_groups.clean_row({"name": "L 系", "set": "L 系（L-2 を除く）", "equipment": [], "rules": [{"op": "prefix", "value": "L-"}],
                                                    "except": ["L-2"]}))
    repo.equip_group_create(equip_groups.clean_row({"name": "L 全角除く", "set": "L 系（全角で除く）", "equipment": [], "rules": [{"op": "prefix", "value": "L-"}],
                                                    "except": ["ｌ－２"]}))
    # 条件の値の長い字: 仕掛の残仕掛設備ｺｰｽでいちばん多い長い値
    wdb = sqlite3.connect(settings["sources"]["wip"]["source"])
    course = wdb.execute("SELECT 残仕掛設備ｺｰｽ, COUNT(*) n FROM 仕掛 WHERE LENGTH(残仕掛設備ｺｰｽ) > 12 GROUP BY 1 ORDER BY n DESC LIMIT 1").fetchone()[0]
    wdb.close()
    return c, {**{k: v["キー"] for k, v in keys.items()}, "_empty": empty_key, "_quality": [settings["lot_list"]["source"], qt], "_course": course, "_lots": lot_ids}


def cases(eq):
    yday = {"column": "@workday", "kind": "yesterday"}
    days7 = {"column": "@workday", "kind": "days", "n": 7}
    sel = ["CAL", "ｃｒ２", "TLV"]
    pg = {"mode": "panel", "groups": [{"name": "前", "members": ["CAL", "CR1"]}, {"name": "後", "members": ["TLV", "L-1"]}], "rest": "other"}
    calc = {"formulas": {"k": "[作業者] + '-' + [作業区分]"}}
    dates = json.dumps([f"2026-{m:02d}-{d:02d}" for m, d in [(9, x) for x in range(1, 31)] + [(10, x) for x in range(1, 11)]])
    out = [(f"組み込み {p['id']}", p) for p in dashboard.BUILTIN_LAYOUTS[0]["body"]["panels"]]
    out += [
        # 数字
        ("数字 品質", pv("kpi", "lot")),
        ("数字 実績 直近 7 日・合計", pv("kpi", "work", measures=[{"agg": "sum", "column": "重量"}, CNT], period=days7)),
        ("数字 設備 2 つ（重ねる→並べる）", pv("kpi", "work", equips=["CAL", "CR2"], period=yday)),
        ("数字 設備を選んで合算", pv("kpi", "work", equips=sel, esplit="sum")),
        ("数字 設備 1 つの鍵", pv("kpi", "work", equip=eq["CAL"])),
        ("数字 期間（日付で決める）", pv("kpi", "lot", period={"column": "発生日", "kind": "range", "from": "2026-09-20", "to": "2026-09-01"})),
        ("数字 先月・太陽暦", pv("kpi", "work", period={"column": "@workday", "kind": "last_month"}, basis="cal")),
        ("数字 仕掛 前方一致の設備を選ぶ", pv("kpi", "src:wip", equips=["CR1", "L-1"])),
        # 設備の分け方
        ("重ねる 設備 3 つ", pv("bar", "work", rows=[D("作業区分")], equips=sel)),
        ("並べる 設備 3 つ・割合", pv("bar", "work", rows=[D("作業区分")], measures=[{"agg": "count", "show": "pct_total"}, {"agg": "sum", "column": "重量", "show": "cum"}],
                                   equips=sel, esplit="facet")),
        ("並べる 割合（行）・順位", pv("heat", "work", rows=[D("作業区分")], cols=[D("@shift")],
                                     measures=[{"agg": "count", "show": "pct_row"}, {"agg": "avg", "column": "速度", "show": "rank"}], esplit="facet", period=days7)),
        ("並べる 品質の設備 30 超（24 まで）", pv("column", "lot", rows=[D("合金")], esplit="facet")),
        ("重ねる 列の段がいっぱい→並べる", pv("stack", "work", rows=[D("作業区分")], cols=[D("@shift"), D("調質"), D("合金")], equips=["CAL", "TLV"])),
        ("並べる 行の段がいっぱい→そのまま", pv("none", "work", rows=[D("作業区分"), D("@shift"), D("調質")], esplit="facet", equips=["CAL", "TLV"])),
        ("合算 設備 2 つ", pv("line", "work", rows=[D("@workday")], equips=["CAL", "CR1"], esplit="sum", period=days7)),
        ("設備の見分けが無い元（重ねない）", pv("bar", "src:m0000001", rows=[D("材質")], measures=[CNT], equips=["CAL", "CR1"])),
        ("箱ひげ 並べる", pv("box", "work", rows=[D("作業区分")], measures=[{"agg": "median", "column": "重量"}], equips=["CAL", "CR1"], esplit="facet")),
        ("X̄-R 重ねる", pv("xbar", "work", rows=[D("@workday")], measures=[{"agg": "avg", "column": "速度"}], equips=["CAL", "CR1"], period=days7)),
        ("ヒストグラム", pv("hist", "lot", rows=[D("重量", "bin")], measures=[CNT])),
        # 設備のまとめ・設備グループ
        ("まとめ 合算（名前）", pv("bar", "work", rows=[D("作業区分")], egroup={"mode": "sum", "name": "  "})),
        ("まとめ 合算 設備の段（既定の名前）", pv("bar", "work", rows=[D("@equip")], equips=["CAL", "CR1"], egroup={"mode": "sum"})),
        ("まとめ このパネルのグループ（その他）", pv("bar", "work", rows=[D("@equip")], egroup=pg)),
        ("まとめ このパネルのグループ（重ねる）", pv("bar", "work", rows=[D("作業区分")], egroup={**pg, "rest": "hide"})),
        ("まとめ マスタ ライン別", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "master", "set": "ライン別", "rest": "keep"})),
        ("まとめ マスタ 工程（正規表現・除く）", pv("bar", "lot", rows=[D("@equip")], egroup={"mode": "master", "set": "工程（冷延・仕上）", "rest": "other"})),
        ("まとめ マスタ 無いまとめ方", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "master", "set": "無い", "rest": "keep"})),
        ("設備グループの段 ライン別×設備", pv("none", "work", rows=[D("@egroup", "ライン別"), D("@equip")])),
        ("設備グループの段 このパネル", pv("bar", "work", rows=[D("@egroup", "@panel")], egroup=pg)),
        ("設備グループの段 空のまとめ方（パネル無し）", pv("bar", "work", rows=[D("@egroup")])),
        ("手で並べた設備", pv("bar", "work", rows=[D("@equip")], cols=[D("@shift")], eorder=["TLV", "ｃａｌ", "無い"], period=days7)),
        ("手で並べた設備（重ねる）", pv("line", "work", rows=[D("@workday")], equips=sel, eorder=["TLV", "CR2"], period=days7)),
        ("手で並べた設備（同じ名前を 2 度・ほかの段の値は動かさない）", pv("bar", "work", rows=[D("@equip")], cols=[D("作業区分")],
                                                                 eorder=["CAL", "CR1", "$試作", "CAL"], period=days7)),
        ("まとめ 合算 設備 2 つ・段に設備なし", pv("bar", "work", rows=[D("作業区分")], equips=["CAL", "CR1"], egroup={"mode": "sum", "name": "2 台"})),
        ("まとめ マスタ 段に設備なし（重ねる）", pv("line", "work", rows=[D("@workday")], period=days7, egroup={"mode": "master", "set": "工程（冷延・仕上）", "rest": "hide"})),
        ("仕掛 前方一致の設備の段", pv("bar", "src:wip", rows=[D("@equip")])),
        ("仕掛 前方一致の設備を選んで重ねる", pv("bar", "src:wip", rows=[D("製造材質")], equips=["CR1", "L-1", "CR2"])),
        ("表 行の段なし（総計だけ）", pv("none", "lot", measures=[CNT, {"agg": "sum", "column": "重量"}])),
        ("手で並べた設備（今の並びと逆）", pv("bar", "work", rows=[D("@equip")], eorder=["SL1", "LS3", "L-2", "L-1", "HOT", "CR2", "CR1", "CAL", "ANF", "TLV"])),
        ("条件 n 日以内（今日から）", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "発生日", "op": "within_days", "value": "10"}])),
        ("期間 全角の日付", pv("kpi", "lot", period={"column": "発生日", "kind": "range", "from": "２０２６-０９-２０", "to": "２０２６-０９-２５"})),
        ("本文のパネルが null", None),
        ("バイオリン図（箱の列）", pv("violin", "work", rows=[D("作業区分")], measures=[{"agg": "median", "column": "重量"}])),
        ("箱ひげ 先が件数（列の無い値は飛ばす）", pv("box", "lot", rows=[D("合金")], measures=[CNT, {"agg": "median", "column": "重量"}])),
        ("値の列の名前が長い（計算列）", pv("bar", "lot", rows=[D("合金")], measures=[{"agg": "sum", "column": "重量の二倍の値"}],
                                         calc={"formulas": {"重量の二倍の値": "[重量] * 2"}})),
        ("値の列の名前が長い（仕掛）", pv("bar", "src:wip", rows=[D("製造材質")], measures=[{"agg": "sum", "column": "コンマ5本分割_切断巾1"}])),
        ("条件の値が長い（＝）", pv("bar", "src:wip", rows=[D("製造材質")], filters=[{"column": "残仕掛設備ｺｰｽ", "op": "eq", "value": eq["_course"]}])),
        ("合算 設備 1 つで選んだ合算", pv("bar", "work", rows=[D("作業区分")], equips=["CAL"], esplit="sum")),
        ("合算 設備を選ばずに選んだ合算", pv("bar", "work", rows=[D("作業区分")], esplit="sum")),
        ("知らせが 2 つ（集計の知らせ＋無いまとめ方）", pv("bar", "src:m0000001", rows=[D("材質")], egroup={"mode": "master", "set": "無い"})),
        ("まとめ マスタ 除く設備が効く", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "master", "set": "L 系（L-2 を除く）", "rest": "hide"})),
        ("まとめ マスタ 除く設備が効く（重ねる）", pv("line", "work", rows=[D("@workday")], period=days7, egroup={"mode": "master", "set": "L 系（L-2 を除く）"})),
        ("確かめ 題が長いパネル", pv("bar", "lot", title="品質のパネルの題（長い題の確かめ）")),
        ("重ねる 列の段あり（設備は列の段の頭）", pv("heat", "work", rows=[D("@workday")], cols=[D("@shift")], equips=["CAL", "CR1"], period=days7)),
        ("列の段に設備（分けない）", pv("stack", "work", rows=[D("作業区分")], cols=[D("@equip")], equips=["CAL", "CR1"])),
        ("列の段に設備グループ（分けない）", pv("stack", "work", rows=[D("作業区分")], cols=[D("@egroup", "ライン別")])),
        ("まとめ 合算 設備を選ばない・設備の段", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "sum", "name": "全設備"})),
        ("まとめ 長いグループ名", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "panel", "groups": [
            {"name": "前工程のラインの組", "members": ["CAL", "CR1"]}, {"name": "後工程のラインの組", "members": ["TLV"]}], "rest": "hide"})),
        ("条件 値を選ぶ（長い値の並び・日）", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "発生日", "op": "in", "value": dates, "key": "date"}])),
        ("計算列 変換表（conv）", pv("bar", "lot", rows=[D("課")], calc={"formulas": {"課": "conv('課名', [設備])"}})),
        ("期間 n か月前（スライサーの月を送る）", pv("bar", "lot", rows=[D("合金")], period={"column": "発生日", "kind": "month", "n": 1})),
        ("期間 n か月前（作業日）", pv("kpi", "work", period={"column": "@workday", "kind": "month", "n": 1})),
        ("箱ひげ 値 2 つ（先の数の値の列で箱）", pv("box", "lot", rows=[D("合金")], measures=[{"agg": "avg", "column": "板厚"}, {"agg": "median", "column": "重量"}])),
        ("まとめ 合算 長い名前", pv("bar", "work", rows=[D("@equip")], equips=["CAL", "CR1"], egroup={"mode": "sum", "name": "CRライン計と仕上げラインの合計（試験用の長い名前）"})),
        ("並べる 空欄のある設備の列（空の鍵は図にしない）", pv("bar", "src:wip", rows=[D("製造材質")], esplit="facet")),
        ("前後の空白（設備・検索）", pv("bar", "work", rows=[D("@equip")], equips=[" CAL ", "CR1\u3000"], search=" 再処理 ")),
        ("まとめ マスタ 半角カナのまとめ方", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "master", "set": "ﾗｲﾝ別"})),
        ("期間 列の無い期間は外す", pv("kpi", "lot", period={"column": " ", "kind": "days", "n": 3})),
        ("合わせる 効かない条件がデータごとに違う", pv("bar", "work", filters=[{"column": "製造材質", "op": "neq", "value": "A3004"}, {"column": "作業区分", "op": "neq", "value": "試作"}],
                                         link={"sides": [side("work", D("作業区分")), side("src:wip", D("製造材質"))]})),
        ("まとめ 知らない rest は keep", pv("bar", "work", rows=[D("@equip")], egroup={**pg, "rest": "xx"})),
        ("まとめ 名前の無いグループだけ（まとめない）", pv("bar", "work", rows=[D("作業区分")], egroup={"mode": "panel", "groups": [{"name": " ", "members": ["CAL"]}]})),
        ("設備グループの段 空のまとめ方＋このパネルのグループ", pv("bar", "work", rows=[D("@egroup")], egroup=pg)),
        ("箱ひげ 種類の数の値は飛ばす", pv("box", "lot", rows=[D("合金")], measures=[{"agg": "distinct", "column": "客先"}, {"agg": "median", "column": "重量"}])),
        ("期間の日数の上限", pv("kpi", "work", period={"column": "@workday", "kind": "days", "n": "99999"})),
        # 条件・検索・計算列・値の計算
        ("条件 値を選ぶ（月）", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "発生日", "op": "in", "value": json.dumps(["2026-09"]), "key": "month"}])),
        ("条件 値を選ぶ（知らない鍵）", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "発生日", "op": "in", "value": json.dumps(["2026-09"]), "key": "week"}])),
        ("条件と検索", pv("bar", "lot", rows=[D("不良名")], filters=[{"column": "合金", "op": "in", "value": json.dumps(["A5052", "A3004"])},
                                                                  {"column": " 重量 ", "op": "gt", "value": 3}, {"column": "", "op": "eq"}], search="汚れ")),
        ("計算列", pv("bar", "work", rows=[D("k")], measures=[CNT, {"agg": "sum", "column": "w2"}],
                      calc={"formulas": {"k": "[作業者] + '-' + [作業区分]", "w2": "[重量] * 2"}}, equips=["CAL"])),
        ("値の計算と小数", pv("bar", "lot", rows=[D("合金")], measures=[{"agg": "sum", "column": "重量", "expr": "÷1000", "dec": 2},
                                                                         {"agg": "avg", "column": "板厚", "expr": "x+?"}])),
        ("統計", pv("bar", "lot", rows=[D("合金")], measures=[{"agg": "median", "column": "重量"}, {"agg": "std", "column": "重量"},
                                                              {"agg": "pct", "column": "重量", "p": 90}, {"agg": "distinct", "column": "客先"}])),
        ("作業日の年月×直", pv("heat", "work", rows=[D("@workday", "ym")], cols=[D("@shift")], measures=[CNT, LOTS])),
        # 別のデータを合わせる
        ("合わせる 日（品質の発生日 × 実績の作業日）・差と達成率", pv("combo", "lot", link={
            "sides": [side("lot", D("発生日", "date"), role="target", title="計画"), side("work", D("@workday"), role="actual", build="cum", period=days7)],
            "extra": ["rate", "diff", "x"]})),
        ("合わせる 合金（全角・$）", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("work", D("合金"), {"agg": "sum", "column": "重量"})]})),
        ("合わせる 数の軸（#）", pv("bar", "lot", link={"sides": [
            side("lot", D("板厚"), {"agg": "sum", "column": "重量"}, role="target"), side("work", D("入側板厚"), role="actual", equips=["CAL"])], "extra": ["rate", "diff"]})),
        ("合わせる 設備と目標 0", pv("bar", "lot", link={"sides": [
            side("lot", D("@equip"), {"agg": "lots", "expr": "x*0"}, role="target"), side("work", D("@equip"), role="actual")], "extra": ["diff", "rate"]})),
        ("合わせる 表し方は使わない・パネルの設備が先", pv("bar", "work", equips=["CAL", "CR1"], link={"sides": [
            side("work", D("作業区分"), {"agg": "count", "show": "pct_total"}, equips=["TLV"]), side("lot", D("合金"), {"agg": "count", "show": "cum"})]})),
        ("合わせる 片方だけ設備で絞れない", pv("bar", "work", equips=["CAL"], link={"sides": [side("work", D("作業区分")), side("src:m0000001", D("材質"), CNT)]})),
        ("合わせる 1 つ目に計算列・検索・設備の鍵", pv("bar", "work", link={"sides": [
            side("work", D("k"), calc=calc, search="再処理", equip=eq["CAL"]), side("lot", D("合金"))]})),
        ("合わせる 目標だけ（差・達成率は出さない）", pv("bar", "lot", link={"sides": [side("lot", D("合金"), role="target"), side("work", D("合金"))],
                                                                     "extra": ["diff", "rate"]})),
        ("合わせる 同じデータを 2 つ", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("lot", D("調質"), CNT, title="")]})),
        ("合わせる 値の無い積み上げ", pv("line", "work", link={"sides": [side("work", D("@workday"), build="cum", search="存在しない字"),
                                                                 side("lot", D("発生日", "date"), search="存在しない字")]})),
        ("合わせる 名前が長い", pv("bar", "lot", link={"sides": [side("lot", D("合金"), title="生産計画のロット数（月ごと・長い名前）"), side("work", D("合金"))]})),
        ("合わせる 3 つのうち 2 つ読めない", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("src:nope", D("合金")),
                                                                    side("work", D("合金"), equips=["無い"])]})),
        ("合わせる 1 つ読めない", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("src:nope", D("合金"))]})),
        ("合わせる 全部読めない", pv("bar", "lot", link={"sides": [side("src:nope", D("合金")), side("work", D("合金"), equips=["無い"])]})),
        ("合わせる 年月と設備の名前", pv("line", "lot", filters=[{"column": "合金", "op": "neq", "value": "A3004"}], link={"sides": [
            side("lot", D("発生日", "ym"), title="品質"), side("work", D("@workday", "ym"), build="cum", equips=["CR1"]),
            side("src:wip", D("BOX設計_設備名"), role="target")]})),
        # 合わせた表
        ("合わせた表 設備×2 まとまり・グループの見出し", {"id": "b1", "visual": "board", "rows": D("@equip"), "order": {"tree": "ライン別"},
                                                         "groups": [{"title": "仕掛", "source": "src:wip", "measure": LOTS},
                                                                    {"source": "work", "period": yday, "cols": [D("@shift")], "measure": CNT}]}),
        ("合わせた表 全体の条件・設備・まとめ", {"id": "b2", "visual": "board", "equips": ["CAL", "CR1", "TLV"], "egroup": {"mode": "master", "set": "工程（冷延・仕上）"},
                                                "filters": [{"column": "合金", "op": "neq", "value": "A3004"}],
                                                "groups": [{"source": "work", "measure": {"agg": "sum", "column": "重量"}}, {"source": "lot", "measure": CNT}]}),
        ("合わせた表 合金の行・1 つ読めない・見出しは使わない", {"id": "b3", "visual": "board", "rows": D("合金"), "order": {"tree": "ライン別"},
                                                               "groups": [{"source": "lot"}, {"source": "src:nope"}, {"source": "work", "cols": [D("調質")]}]}),
        ("合わせた表 4 まとまり・全体とまとまりの両方に設備", {"id": "b5", "visual": "board", "equips": ["CAL", "CR1"],
                                                           "groups": [{"source": "work", "equips": ["TLV"]}, {"source": "work", "measure": CNT},
                                                                      {"source": "src:wip"}, {"source": "lot", "cols": [D("合金")]}]}),
        ("合わせた表 まとまりの列の段は 2 つまで", {"id": "b6", "visual": "board", "groups": [{"source": "work", "cols": [D("@shift"), D("作業区分"), D("調質")]}]}),
        ("合わせた表 まとまりに計算列・検索・設備の鍵", {"id": "b7", "visual": "board", "groups": [
            {"source": "work", "equip": eq["CAL"], "search": "再処理", "calc": calc, "cols": [D("k")]}, {"source": "src:wip"}]}),
        ("合わせた表 工程の見出し", {"id": "b4", "visual": "board", "order": {"tree": "工程（冷延・仕上）"}, "groups": [{"source": "work", "equips": ["CAL", "TLV", "CR1", "CR2"]}]}),
        # 読めない・失敗
        ("実績 表示する設備が無い", pv("kpi", "work", equips=["無い"])),
        ("実績 鍵の違う設備", pv("kpi", "work", equip="nope")),
        ("実績 読めない設備だけ", pv("kpi", "work", equips=["SL3", "BAD"])),
        ("壊れたビューのデータ元", pv("kpi", "src:" + eq["_empty"])),
        ("壊れたビューのデータ元（集計表）", pv("bar", "src:" + eq["_empty"], rows=[D("合金")])),
        ("実績 見つからない設備だけ", pv("kpi", "work", equips=["SL3"])),
        ("実績 作業開始の列の無い表（ロット番号の列）", pv("bar", "work", rows=[D("@equip")], measures=[LOTS, CNT], equips=["TLV", "CAL"])),
        ("実績 表示しない設備を選ぶ", pv("kpi", "work", equips=["DL2"])),
        ("データ元が無い", pv("kpi", "src:nope")),
        ("無い列", pv("bar", "lot", rows=[D("無い列")])),
        ("読めない期間（日付でない列）", pv("bar", "lot", rows=[D("合金")], period={"column": "合金", "kind": "days", "n": 3})),
        ("確かめ パネルの形", [1, 2]),
        ("確かめ データ", pv("kpi", "file:x", title="題")),
        ("確かめ 行の段", pv("bar", "lot")),
        ("確かめ 合わせるデータ 1 つ", pv("bar", "lot", link={"sides": [side("lot", D("合金"))]})),
        ("確かめ 合わせるデータの形", pv("bar", "lot", link={"sides": [1, side("lot", D("合金"))]})),
        ("確かめ 合わせるデータの軸", pv("bar", "lot", link={"sides": [side("lot", {}), side("lot", D("合金"))]})),
        ("確かめ 合わせるデータのデータ", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("x", D("合金"))]})),
        ("確かめ 合わせた表 5 まとまり", {"visual": "board", "title": "表", "groups": [{"source": "lot"}] * 5}),
        ("確かめ 合わせた表 まとまりの形", {"visual": "board", "groups": [{"source": "lot"}, 3]}),
        ("確かめ 合わせた表 まとまりのデータ", {"visual": "board", "groups": [{"source": "lot", "title": "t"}, {"source": "y"}]}),
    ]
    out += boundaries(eq)
    python = [
        ("稼働 ガント（Python）", pv("gantt", "work", period=yday)),
        ("ABC（Python）", pv("abc", "work", period=yday)),
        ("稼働 品質のデータ（Python が確かめる）", pv("gantt", "lot")),
        ("スケジュール（Python）", pv("kpi", "src:sch")),
    ]
    return out, python


def shape(a):
    """答えの形の手がかり（升の数・合わせた表のまとまりごとの升の数・総計）。dash_bench.rs の shape と同じ"""
    def one(x):
        cells = x.get("cells")
        return [len(cells) if isinstance(cells, list) else None, next((c["v"] for c in cells or [] if not c["r"]), None)]
    return [one(g) for g in a["groups"]] if isinstance(a.get("groups"), list) else one(a)


def bench(c, app, plain, out):
    """速さ: 最初の画面（組み込みの標準）と、重い形（並べる・合わせる・合わせた表）。答えの控えは毎回空にして数える時間を測る"""
    import time
    keep = ("組み込み", "重ねる 設備 3 つ", "並べる 割合（行）・順位", "並べる 品質の設備 30 超（24 まで）", "まとめ マスタ ライン別",
            "合わせる 日（品質の発生日 × 実績の作業日）・差と達成率", "合わせた表 設備×2 まとまり・グループの見出し", "計算列", "統計")
    rows = []
    for name, panel in plain:
        if not name.startswith(keep):
            continue
        ask = lambda: c.post("/api/dashboard/query", json={"panel": panel})  # noqa: E731
        first = ask()
        xs = []
        for _ in range(5):
            app.config.get("DASH_CACHE", {}).clear()
            t = time.perf_counter()
            ask()
            xs.append((time.perf_counter() - t) * 1000)
        rows.append({"name": name, "panel": panel, "ms": round(sorted(xs)[2], 2), "shape": shape(first.get_json() or {})})
    Path(out).write_text(json.dumps({"settings": c.get("/api/lotlist/settings").get_json(), "cases": rows}, ensure_ascii=False), encoding="utf-8")


def boundaries(eq):
    """境の組（版 3.62.0 の作った後の採点で、採点者が替わるたびに境の値を 1 つずつ見つけたため、dashboard.rs の上限・字の長さ・決まった値の並びを
    洗い出して、どの境もまとめて試す）: 形・期間・条件の鍵・まとめ方 × 残り・分け方 × 段の数・役割・データとまとまりの数・字の長さ・件数の上限"""
    out = []
    long_col = "重量を二倍にした長い名前の計算列（境の確かめ）"
    lc = {"formulas": {long_col: "[重量] * 2"}}
    # 形（知らない形は column）。値は箱ひげの列が決まる形も見えるように、先に件数・次に数の値
    for v in dashboard.pivot_presets.CHARTS + ("kpi", "slicer", "xx"):
        out.append((f"境 形 {v}", pv(v, "lot", rows=[D("合金")], measures=[CNT, {"agg": "median", "column": "重量"}])))
    # 期間の種類 × 日付の列・作業日（知らない種類は外す）。日付で決めるは片方だけも
    for kind in ("today", "yesterday", "days", "this_month", "last_month", "month", "range", "week"):
        for col, src in (("発生日", "lot"), ("@workday", "work"), ("BOX実績_作業開始_日付", "work")):
            per = {"column": col, "kind": kind, "n": 2}
            if kind == "range":
                per.update({"from": "2026-09-28", "to": "2026-10-01"})
            out.append((f"境 期間 {kind} {col}", pv("kpi", src, measures=[CNT], period=per)))
    for k, v in (("from", "2026-09-30"), ("to", "2026-09-05")):
        out.append((f"境 期間 日付で決める {k} だけ", pv("kpi", "lot", measures=[CNT], period={"column": "発生日", "kind": "range", k: v})))
    for n in ("0", "3.5", 4000, None):
        out.append((f"境 期間の日数 {n}", pv("kpi", "lot", measures=[CNT], period={"column": "発生日", "kind": "days", "n": n})))
    # 値を選ぶ条件の鍵（日・月・年・知らない鍵・in でない条件に鍵）
    for key, val in (("date", ["2026-09-30", "2026-10-01"]), ("month", ["2026-09"]), ("year", ["2026"]), ("week", ["2026"]), ("", ["2026"])):
        out.append((f"境 条件の鍵 {key or 'なし'}", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "発生日", "op": "in", "value": json.dumps(val), "key": key}])))
    out.append(("境 条件の鍵 in でない", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "合金", "op": "eq", "value": "A5052", "key": "date"}])))
    # まとめ方 × 残り
    pg = {"groups": [{"name": "前", "members": ["CAL", "CR1"]}]}
    for mode, extra in (("sum", {"name": "計"}), ("panel", pg), ("master", {"set": "ライン別"}), ("xx", {})):
        for rest in ("keep", "other", "hide", "xx"):
            out.append((f"境 まとめ {mode} {rest}", pv("bar", "work", rows=[D("@equip")], egroup={"mode": mode, "rest": rest, **extra})))
    # 分け方 × 段の数（列の段 0〜3・行の段 1〜3）
    cols3, rows3 = [D("@shift"), D("調質"), D("合金")], [D("作業区分"), D("@shift"), D("調質")]
    for esplit in ("series", "facet", "sum", "xx", ""):
        for nc in range(4):
            out.append((f"境 分け方 {esplit or '既定'} 列の段 {nc}", pv("bar", "work", rows=[D("作業区分")], cols=cols3[:nc], equips=["CAL", "CR1"],
                                                                       esplit=esplit, period={"column": "@workday", "kind": "days", "n": 5})))
        for nr in (2, 3):
            out.append((f"境 分け方 {esplit or '既定'} 行の段 {nr}", pv("bar", "work", rows=rows3[:nr], equips=["CAL", "CR1"], esplit=esplit,
                                                                       period={"column": "@workday", "kind": "days", "n": 5})))
    out.append(("境 行の段 4 つ（3 つまで）", pv("none", "work", rows=rows3 + [D("合金")], measures=[CNT])))
    out.append(("境 値 7 つ（6 つまで）", pv("none", "lot", rows=[D("合金")], measures=[CNT, LOTS, {"agg": "sum", "column": "重量"}, {"agg": "avg", "column": "重量"},
                                                                                         {"agg": "max", "column": "重量"}, {"agg": "min", "column": "重量"},
                                                                                         {"agg": "median", "column": "重量"}])))
    # 合わせる: データの数 1〜5・役割の組み合わせ・積み上げ
    sides = [side("lot", D("合金")), side("work", D("合金")), side("src:wip", D("製造材質")), side("lot", D("合金"), CNT), side("work", D("合金"), CNT)]
    for n in range(1, 6):
        out.append((f"境 合わせる {n} つ", pv("bar", "lot", link={"sides": sides[:n]})))
    for roles in (("target", "target", "actual"), ("actual", "target"), ("actual", "actual"), ("xx", "actual"), ("target", "")):
        ss = [{**side(["lot", "work", "lot"][i], D("合金"), [LOTS, LOTS, CNT][i]), "role": r} for i, r in enumerate(roles)]
        out.append((f"境 合わせる 役割 {'・'.join(roles)}", pv("bar", "lot", link={"sides": ss, "extra": ["diff", "rate"]})))
    for how in ("cum", "xx"):
        out.append((f"境 合わせる 積み上げ {how}", pv("line", "lot", link={"sides": [side("lot", D("発生日", "date"), build=how), side("work", D("@workday"), build=how)]})))
    # 合わせた表: まとまりの数 1〜5
    gs = [{"source": "lot"}, {"source": "work"}, {"source": "src:wip"}, {"source": "lot", "measure": CNT}, {"source": "work", "measure": CNT}]
    for n in range(1, 6):
        out.append((f"境 合わせた表 {n} まとまり", {"id": "bb", "visual": "board", "groups": gs[:n]}))
    # 字の長さ（上限の前後）
    for n in (16, 17):
        out.append((f"境 パネルの id {n} 字", {"id": "i" * n, "visual": "bar", "source": "lot"}))
    out.append(("境 題 60 字", pv("bar", "lot", title="題" * 70)))
    out.append(("境 長い列名（段・値・条件・計算列）", pv("bar", "lot", rows=[D(long_col)], measures=[{"agg": "sum", "column": long_col}],
                                                       filters=[{"column": long_col, "op": "gt", "value": 2}], calc=lc)))
    out.append(("境 長い名前（まとめ・グループ・まとめ方・見出し）", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "panel", "rest": "other", "groups": [
        {"name": "前工程のラインをまとめた長い名前のグループ（四十字の境）", "members": ["CAL", "CR1"]}]})))
    out.append(("境 長い名前（合わせるデータ・まとまり）", {"id": "bl", "visual": "board", "groups": [
        {"source": "lot", "title": "品質のロット数を数えた長い題のまとまり（四十字を超える境の確かめ）"}]}))
    # 値を選ぶ条件の長さ: 本物のロット番号 300 個（約 3,000 字。上限 20,000 字の内側で、1,000 字より長い）と、上限を超える 2,000 個
    lots = json.dumps(eq["_lots"])
    assert 1500 < len(lots) < 20000, len(lots)
    out.append(("境 値を選ぶ条件が長い（本物の 300 個）", pv("kpi", "lot", measures=[CNT], filters=[{"column": "ロット番号", "op": "in", "value": lots}])))
    out.append(("境 値を選ぶ条件が上限を超える（2,000 個）", pv("kpi", "lot", measures=[CNT], filters=[{"column": "ロット番号", "op": "in",
                                                                                   "value": json.dumps([f"L{i:06d}" for i in range(1, 2000)])}])))
    # 件数の上限: 条件 21 個（20 個まで）・グループ 25 個（24 個まで）
    flt = [{"column": "合金", "op": "neq", "value": f"X{i}"} for i in range(20)] + [{"column": "合金", "op": "eq", "value": "A5052"}]
    out.append(("境 条件 21 個（20 個まで）", pv("bar", "lot", rows=[D("合金")], filters=flt)))
    many = [{"name": f"g{i}", "members": []} for i in range(24)] + [{"name": "g24", "members": ["CAL"]}]
    out.append(("境 グループ 25 個（24 個まで）", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "panel", "rest": "hide", "groups": many})))
    out.append(("境 合わせる 読めない知らせと集計の知らせ", pv("bar", "lot", link={"sides": [side("src:m0000001", D("材質")), side("src:nope", D("合金")),
                                                                         side("src:m0000002", D("設備名"))]})))
    out.append(("境 期間の日数 小数 3.6（切り捨て）", pv("kpi", "lot", measures=[CNT], period={"column": "発生日", "kind": "days", "n": 3.6})))
    out.append(("境 全角で書いた除く設備（見出し）", {"id": "bz", "visual": "board", "order": {"tree": "L 系（全角で除く）"}, "groups": [{"source": "work"}]}))
    out.append(("境 全角で書いた除く設備（まとめ）", pv("bar", "work", rows=[D("@equip")], egroup={"mode": "master", "set": "L 系（全角で除く）", "rest": "keep"})))
    out.append(("境 合わせる データごとの条件", pv("bar", "lot", link={"sides": [
        side("work", D("合金"), filters=[{"column": "作業区分", "op": "neq", "value": "試作"}]), side("lot", D("合金"), filters=[{"column": "調質", "op": "eq", "value": "H24"}])]})))
    out.append(("境 合わせた表 まとまりごとの条件", {"id": "bf", "visual": "board", "filters": [{"column": "合金", "op": "neq", "value": "A3004"}], "groups": [
        {"source": "work", "filters": [{"column": "作業区分", "op": "eq", "value": "通常"}]}, {"source": "lot", "filters": [{"column": "調質", "op": "eq", "value": "O"}]}]}))
    out.append(("境 合わせる 同じ効かない条件が 2 つのデータに", pv("bar", "lot", filters=[{"column": "作業区分", "op": "neq", "value": "試作"}],
                                                                 link={"sides": [side("lot", D("合金")), side("lot", D("調質"))]})))
    out.append(("境 手で並べた設備（全角の名前を先に）", pv("bar", "work", rows=[D("@equip")], eorder=["ＬＳ３", "ｃｒ１", "CAL"])))
    return out


def ask(c, name, panel):
    r = c.post("/api/dashboard/query", json={"panel": panel})
    return {"name": name, "panel": panel, "status": r.status_code, "body": r.get_json()}


def main():
    as_role("開発者")
    big = "--bench" in sys.argv
    app = build(quality=20000, work_rows=2000, wip=20000) if big else build(quality=600, work_rows=150, wip=400)
    c, eq = setup(app)
    plain, python = cases(eq)
    if big:
        return bench(c, app, plain, sys.argv[sys.argv.index("--bench") + 1])
    rows = []
    for name, panel in plain:
        r = c.post("/api/dashboard/query", json={"panel": panel})
        rows.append({"name": name, "panel": panel, "status": r.status_code, "body": r.get_json()})
    settings = c.get("/api/lotlist/settings").get_json()
    phases = []
    # 「いま」を変えて同じ組を問い直す（答えの控えは今日・作業日で分ける）: 日付を跨ぐ・同じ日の 1 直の始め（07:00）より前
    again = [("直近 7 日（品質）", pv("kpi", "lot", measures=[CNT], period={"column": "発生日", "kind": "days", "n": 7})),
             ("n 日以内の条件", pv("bar", "lot", rows=[D("合金")], filters=[{"column": "発生日", "op": "within_days", "value": "10"}])),
             ("前日（実績）", pv("kpi", "work", period={"column": "@workday", "kind": "yesterday"})),
             ("今日（実績・設備の段）", pv("bar", "work", rows=[D("@equip")], period={"column": "@workday", "kind": "today"}))]
    base = app.config["DASHBOARD_NOW"]
    for label, now in (("次の日", base + timedelta(days=1)), ("同じ日の 07:00 より前", base.replace(hour=5))):
        app.config["DASHBOARD_NOW"] = now
        phases.append({"name": f"いまを変える（{label}）", "warm": True, "settings": c.get("/api/lotlist/settings").get_json(),
                       "cases": [ask(c, n, p) for n, p in again]})
    app.config["DASHBOARD_NOW"] = base
    # 出さないタブ（品質・仕掛を出さない一般ユーザー。実績は出す）: 数字・集計・合わせた表・合わせる
    as_role("一般ユーザー")
    MasterRepository(app.config["MASTER_STORE"]).tab_access_put({"lot": ["一般ユーザー"], "wip": ["一般ユーザー"]})
    forget_tab_cache()
    hidden = [("品質の数字", pv("kpi", "lot")), ("仕掛の集計", pv("bar", "src:wip", rows=[D("製造材質")])), ("実績の数字（出す）", pv("kpi", "work")),
              ("合わせた表の中に出さないデータ", {"id": "bh", "visual": "board", "groups": [{"source": "src:wip"}, {"source": "work"}]}),
              ("合わせるの中に出さないデータ", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("work", D("合金"))]})),
              ("結合した表・マスタ（出す）", pv("bar", "src:m0000001", rows=[D("材質")]))]
    phases.append({"name": "出さないタブ", "settings": c.get("/api/lotlist/settings").get_json(), "cases": [ask(c, n, p) for n, p in hidden]})
    # 実績を出さない（品質・仕掛は出す）
    MasterRepository(app.config["MASTER_STORE"]).tab_access_put({"work": ["一般ユーザー"]})
    forget_tab_cache()
    hidden_work = [("実績の数字", pv("kpi", "work")), ("品質の数字（前の段の決まりのまま出さない）", pv("kpi", "lot")),
                   ("合わせた表の中に出さない実績", {"id": "bw", "visual": "board", "groups": [{"source": "work"}, {"source": "src:wip"}]}),
                   ("合わせるの中に出さない実績", pv("bar", "lot", link={"sides": [side("lot", D("合金")), side("work", D("合金"))]}))]
    phases.append({"name": "実績を出さないタブ", "settings": c.get("/api/lotlist/settings").get_json(), "cases": [ask(c, n, p) for n, p in hidden_work]})
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"settings": settings, "cases": rows, "phases": phases,
               "python": [{"name": n, "panel": p} for n, p in python],
               # 答えの控えの確かめ（dash_parity.rs）: 品質の元ファイルと表。窓は 1 行消して写し直し、同じパネルの数が変わるかを見る
               "quality": {"path": eq["_quality"][0], "table": eq["_quality"][1]}}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
