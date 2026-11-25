# -*- coding: utf-8 -*-
"""窓の開発用サーバー（desktop/examples/ui_serve.rs）の場面の台本（版 3.118.2。標準の部品だけ。app を import しない）。

    python -u tests/ui_window_scene.py serve 作業フォルダ 窓の開発用サーバーの実行ファイル

撮る・採点する道具（tools/ui-harness.mjs）が起こす。Python の開発用サーバー（前の Python の開発用サーバー の build。段 ⑤ で消す）と同じ場面を、
同じ場面の台本（tests/ui_scene.py の make・finish）で作業フォルダに作り、窓の開発用サーバーを起こして、登録（作業実績の設備・共有の書式 3・
勤務体系 2・設備グループ 2・マスタのデータ元 2）は窓の書く道へ HTTP で当てる（前の Python の開発用サーバー は app の MasterRepository で書いた）。

1. ui_scene.make（品質 1500 行・作業実績 12 台・仕掛 1200 ロット・共有の形・マスタのデータ元の元）
2. 作り物の CM3（tests/fakes_uicm3.py。fakes_serve.start の入口）
3. 配った設定のファイル 作業フォルダ/appsettings.json（config/appsettings.json を読んで、作業実績のフォルダ・品質・更新の置き場・CM3・
   仕掛・マスタの置き場を差し替える。TPA_UI_WORK_STALE は作業実績の古さの時間・TPA_UI_SHARE=shared/down は共有のマスタの置き場）
4. 権限の表に撮る人（この PC の名乗り getpass.getuser）を「開発者・編集可」で 1 行足す（Python の開発用サーバーは判定を差し替えた: as_role）
5. 窓の開発用サーバーを起こし（TPA_DASHBOARD_NOW は試験データの翌日の 10 時）、登録を書く道で当てる
6. TPA_UI_BAD_ROWS の読めない行（TPA_UI_JSON=1 は 1 の後に品質データと仕掛へ JSON の列 5 つを足す）・TPA_UI_SHARE=down の名前替え・ui_scene.finish（前の Python の開発用サーバー と同じ順と中身）
7. 「LISTEN http://127.0.0.1:ポート」の 1 行を出し、標準入力が閉じるまで起こしておく（閉じたら窓と CM3 を止め、作業フォルダを消す）

起動の初期値（検査計・最初の管理者・釜番日付）は当てない（Python の開発用サーバーと同じ）。キーは窓の乱数のまま（道具は画面と API から読む）。
"""
import getpass
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, time, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROGRAM = HERE.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PROGRAM))

from tests import fakes_serve, lotlist_fixture, ui_scene  # noqa: E402  （標準の部品だけ）

# 試験データの「いま」（前の Python の開発用サーバー の DASHBOARD_NOW と同じ: 試験用の作業実績は TODAY〈10/2〉までなので、その翌日の朝）
NOW = datetime.combine(lotlist_fixture.TODAY + timedelta(days=1), time(10)).strftime("%Y-%m-%d %H:%M:%S")

# 共有の書式（作業実績）・勤務体系・設備グループ（前の Python の開発用サーバー の seed_formats・build と同じ中身）
FORMATS = [
    ("標準", "CR1・実績", "全設備の基本の並び", {
        "columns": {"order": ["作業日", "開始", "終了", "ロット番号", "作業区分", "作業者"], "hidden": ["備考", "速度"],
                    "names": {"入側板厚": "入側", "出側板厚": "出側"}, "widths": {}, "locks": [], "formats": {}, "aligns": {}, "formulas": {}, "rules": {}},
        "sorts": [{"column": "作業日", "dir": "desc"}], "arrange": {"levels": [{"column": "作業者", "dir": "asc", "lot": False}], "heads": True, "suppress": False}}),
    ("検査用", "L-1・実績", "", {
        "slicer": {"cards": [{"column": "作業区分"}, {"column": "作業者"}]},
        "presets": [{"name": "再処理だけ", "filters": [{"column": "作業区分", "op": "equals", "value": "再処理"}], "group": "", "always": False}],
        "sorts": [{"column": "重量", "dir": "desc"}]}),
    ("薄板の確認", "CR2・実績", "板厚と減面率", {
        "columns": {"order": ["ロット番号", "入側板厚", "出側板厚", "板幅"], "hidden": ["備考", "合金", "調質"], "names": {}, "widths": {},
                    "locks": [], "formats": {}, "aligns": {}, "formulas": {"減面率": "1-[出側板厚]/[入側板厚]"}, "rules": {}}}),
]
GROUPS = [
    {"name": "CR ライン", "set": "ライン別", "equipment": ["CR1", "CR2"]},
    {"name": "L ライン", "set": "ライン別", "equipment": [], "rules": [{"op": "prefix", "value": "L-"}], "note": "名前が L- で始まる設備"},
]


# JSON の列（版 3.120.0 の改良「JSON の列の展開」の案を撮るため。TPA_UI_JSON=1 のときだけ足す。ほかの評価関数の場面は変えない）
JSON_EQUIP = ["ANF", "DL2", "HOT", "KEN", "L-1", "L-2", "LS3", "TLV", "CR1"]
JSON_COLUMNS = ["設備別通過回数", "測定値", "工程履歴", "仕様", "設備別実績"]


def json_cells(i):
    """品質データの i 行目（0 から）の JSON の列 5 つ（標準の 5 形）と、壊れた行・空・違う形の行。乱数は行の番号から決める（再現できる）"""
    import random as _random
    r = _random.Random(1000 + i)
    eq = sorted(r.sample(JSON_EQUIP, r.randint(3, 8)))
    # ① 名前→値の辞書（設備ごとの加重平均通過回数）
    d1 = json.dumps({e: round(r.choice([1, 1, 2, r.uniform(0, 2)]), 3) for e in eq}, ensure_ascii=False, separators=(",", ":"))
    if i % 50 == 7:
        d1 = ""                                          # 空（2%）
    elif i % 250 == 11:
        d1 = d1[:-6]                                     # 壊れた JSON（閉じていない）
    elif i % 300 == 13:
        d1 = "[1, 2]"                                    # 違う形（並び）
    # ② 値の並び（測定値）
    d2 = json.dumps([r.randint(1, 9) for _ in range(r.randint(1, 5))])
    if i % 40 == 3:
        d2 = '[3, 5, "欠"]'                              # 数でない値の混ざった並び
    # ③ 表の並び（工程履歴）
    d3 = json.dumps([{"設備": e, "回": r.randint(1, 3), "日": f"2026-10-{r.randint(1, 28):02d}"} for e in eq[:r.randint(1, 3)]],
                    ensure_ascii=False)
    # ④ 入れ子の辞書（仕様）
    d4 = json.dumps({"寸法": {"幅": r.choice([1000, 1200, 1250]), "厚": r.choice([0.3, 0.5, 1.0])}, "検査": {"者": r.choice(["担当1", "担当2"])}},
                    ensure_ascii=False)
    if i % 120 == 5:
        d4 = "{'寸法': 1200}"                             # 壊れた JSON（引用符が ' ）
    # ⑤ 名前→表の辞書（設備別実績）
    d5 = json.dumps({e: {"回": r.randint(1, 3), "分": r.randint(5, 90)} for e in eq[:4]}, ensure_ascii=False, separators=(",", ":"))
    if i % 60 == 9:
        d5 = None                                        # NULL
    return [d1, d2, d3, d4, d5]


def add_json_columns(path):
    """品質データ・仕掛の表「仕掛」に JSON の列 5 つを足す（TPA_UI_JSON=1）"""
    import sqlite3
    db = sqlite3.connect(path)
    for c in JSON_COLUMNS:
        db.execute(f'ALTER TABLE "仕掛" ADD COLUMN [{c}]')
    ids = [r[0] for r in db.execute('SELECT rowid FROM "仕掛" ORDER BY rowid')]
    db.executemany('UPDATE "仕掛" SET ' + ",".join(f"[{c}] = ?" for c in JSON_COLUMNS) + " WHERE rowid = ?",
                   [json_cells(i) + [rid] for i, rid in enumerate(ids)])
    db.commit()
    db.close()


# 登録で書くマスタ（Python の開発用サーバーが共有の置き場へ先に置いた物）
REGISTERED = {"work_log_files", "display_formats", "shift_patterns", "equipment_groups", "data_sources"}


def bad_rows():
    """置き場の読めない行（前の Python の開発用サーバー の TPA_UI_BAD_ROWS と同じ中身）"""
    return {"dashboards": [{"id": 900, "名前": 5, "元": "dash", "範囲": "共通", "中身": "{}", "rev": 1},
                           {"id": 903, "名前": "版の読めないダッシュボード", "元": "dash", "範囲": "共通", "中身": "{}", "rev": "二"},
                           {"id": 901, "名前": "壊れたカード", "元": "card:lot", "範囲": "共通", "中身": "{\"items\": [{\"w\": NaN}]}", "rev": 1},
                           {"id": 902, "名前": "壊れたセット", "元": "dashset", "範囲": "共通", "中身": "{\"items\": [\"1\"]}", "rev": "二"}],
            "pivot_presets": [{"id": 900, "名前": "壊れた組み方", "元": "lot", "範囲": "共通", "中身": "{\"rows\": [{\"column\": \"合金\", \"part\": [1]}]}"}],
            "display_formats": [{"id": 900, "名前": 5, "元": "lot", "中身": "{}"}, {"id": 901, "名前": "版の読めない書式", "元": "lot", "中身": "{}", "rev": "x"},
                                {"id": 902, "名前": "作業実績の壊れた書式", "元": "work", "中身": "{\"sorts\": [NaN]}"}],
            "equipment_master": [{"id": "x", "設備名": "壊れた設備"}, {"id": 902, "設備名": "数でない値の設備", "x": float("nan")}],
            "data_sources": [{"id": 990, "キー": "bad1", "表示名": "壊れたデータ元", "場所": "/無い/壊れた.sqlite3", "確かめる間隔": ["x"], "rev": "二"}],
            "work_log_files": [7, {"id": 991, "キー": "bad-w", "設備名": "版の読めない設備", "ファイル名": "実績_壊れた.sqlite3", "表示": "有", "rev": "二"}]}


def config_path():
    """配った設定（app_env.config_path と同じ順: TRANSFER_APP_CONFIG → config/appsettings.json → 見本）"""
    path = Path(os.getenv("TRANSFER_APP_CONFIG", PROGRAM / "config" / "appsettings.json"))
    return path if path.exists() else PROGRAM / "config" / "appsettings.example.json"


def settings_for(made, cm3_url, share):
    """作業フォルダの配った設定（前の Python の開発用サーバー の build が create_app に渡した設定と同じ差し替え。マスタの置き場も設定に書く）"""
    s = json.loads(config_path().read_text(encoding="utf-8-sig"))
    s["work_log"] = {**s.get("work_log", {}), "folder": str(made["folder"])}
    if os.environ.get("TPA_UI_WORK_STALE"):
        s["work_log"]["stale_hours"] = os.environ["TPA_UI_WORK_STALE"]
    s["lot_list"] = {**s.get("lot_list", {}), "source": str(made["quality"])}
    s["update"] = {**s.get("update", {}), "source": str(made["update"])}
    s["schedule"] = {**s.get("schedule", {}), "cm3_base_url": cm3_url}
    s["sources"] = {**s.get("sources", {}), "wip": {**s.get("sources", {}).get("wip", {}), "source": str(made["wip"])}}
    s["master_share"] = {**s.get("master_share", {}), "dir": str(share) if share else ""}
    return s


def add_viewer(data):
    """権限の表に撮る人（この PC の名乗り）を「開発者・編集可」で足す（Python の開発用サーバーの as_role の代わり）"""
    f = data / "access_permissions.json"
    rows = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    rows = rows["rows"] if isinstance(rows, dict) else rows
    rows.append({"id": max([r.get("id", 0) for r in rows if isinstance(r.get("id"), int)] + [0]) + 1, "ログインID": getpass.getuser(), "PC名": "",
                 "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "備考": "開発用サーバーで撮る人", "rev": 1})
    f.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


class Window:
    """窓の開発用サーバー（標準入力が閉じたら終わる形で起こす）"""

    def __init__(self, exe, work):
        env = {**os.environ, "TPA_DASHBOARD_NOW": NOW}
        self.proc = subprocess.Popen([str(exe), str(work), "0", "--stdin"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
        line = self.proc.stdout.readline().decode("utf-8", "replace").strip()
        if not line.startswith("LISTEN "):
            self.proc.kill()
            raise SystemExit(f"窓の開発用サーバーが待ち受けません（{line or self.proc.wait()}）")
        self.base = line.split(" ", 1)[1]
        threading.Thread(target=self.proc.stdout.read, daemon=True).start()

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{method} {path}: {e.code} {e.read().decode('utf-8', 'replace')}") from None

    def stop(self):
        if self.proc.poll() is None:
            self.proc.stdin.close()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def register(w, masters):
    """登録（前の Python の開発用サーバー の build と同じ中身を、窓の書く道で）"""
    w.call("POST", "/api/masters/worklog/scan")
    for name, origin, note, body in FORMATS:
        w.call("POST", "/api/masters/formats", {"name": name, "source": "work", "table": "実績", "origin": origin, "body": body, "note": note})
    templates = w.call("GET", "/api/masters/shifts")["templates"]
    w.call("POST", "/api/masters/shifts", {"name": "交替勤務(1,2,3直)", "segments": templates[1]["segments"], "note": "工場の基本"})
    w.call("POST", "/api/masters/shifts", {"name": "CR2 の 4,5直", "equipment": ["CR2"], "segments": templates[2]["segments"]})
    for g in GROUPS:
        w.call("POST", "/api/masters/equipgroups", g)
    for i, (name, path) in enumerate(masters.items(), 1):
        w.call("POST", "/api/sources", {"表示名": name, "場所": str(path), "役割": "マスタ", "並び": str(i)})


def serve(work, exe):
    work = Path(work)
    made = ui_scene.make(work)
    if os.environ.get("TPA_UI_JSON"):          # JSON の列の展開の案を撮る形（版 3.120.0）
        add_json_columns(made["quality"])
        add_json_columns(made["wip"])          # 仕掛にも（ダッシュボードの組む所の撮る形〈仕掛区分のパネル〉が仕掛のデータを組むため）
    cm3 = fakes_serve.start("uicm3", str(made["wip"]))
    share_mode = os.environ.get("TPA_UI_SHARE", "")
    master_share = work / "マスタ共有"
    if share_mode in ("shared", "down"):
        master_share.mkdir()
    (work / "appsettings.json").write_text(
        json.dumps(settings_for(made, cm3["urls"]["cm3"], master_share if share_mode in ("shared", "down") else None), ensure_ascii=False, indent=2),
        encoding="utf-8")
    # 配る版の覚えの写し（ui_scene.make が Python の開発用サーバーの置き場 masters/ に置く）を窓の作業場所 local/ へ
    (work / "local").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(work / "masters" / "want.json", work / "local" / "want.json")
    data = work / "base" / "data"
    add_viewer(data)
    w = Window(exe, work)
    try:
        register(w, made["masters"])
        if os.environ.get("TPA_UI_BAD_ROWS"):
            for name, rows in bad_rows().items():
                f = data / f"{name}.json"
                have = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
                have = have["rows"] if isinstance(have, dict) else have
                f.write_text(json.dumps(have + rows, ensure_ascii=False, indent=2), encoding="utf-8")
                # 共有の置き場（TPA_UI_SHARE）: Python の開発用サーバーは登録で書いたマスタだけを先に共有へ置き、ほかは読めない行を足した後の
                # 手元の物で最初の版を置いた。窓は登録の間の読みで先に置くので、登録で書かないマスタは共有と写しにも足す（同じ形にする）
                if share_mode in ("shared", "down") and name not in REGISTERED:
                    for g in (master_share / f"{name}.json", work / "local" / "master_cache" / f"{name}.json"):
                        if g.exists():
                            doc = json.loads(g.read_text(encoding="utf-8"))
                            doc["rows"] = doc["rows"] + rows
                            g.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        if share_mode == "down":
            master_share.rename(master_share.with_name("マスタ共有_届かない"))
        ui_scene.finish(work)
        # 登録の「探す」で窓が覚えたフォルダの中身を読み直す（finish で SL3 を場面の外へ移し・HOT を古くした後の形にする。Python の開発用サーバーは
        # 登録を app で直に書いたので、窓の覚えにあたる物が無かった）
        w.call("GET", "/api/masters/worklog?fresh=1")
        print(f"LISTEN {w.base}", flush=True)
        for _ in sys.stdin:         # 標準入力が閉じるまで起こしておく
            pass
    finally:
        w.stop()
        cm3["close"]()
        # 作業フォルダの持ち主はこの台本（版 3.118.2 の作った後の採点の割れ C10）: 起こした node が SIGKILL で消えても、標準入力が閉じて
        # ここへ来るので、窓と CM3 を止めた後に消す（harness の stop・exit も消すが、node が殺されたときは走らない）
        shutil.rmtree(work, ignore_errors=True)


def main():
    if len(sys.argv) != 4 or sys.argv[1] != "serve":
        raise SystemExit(__doc__)
    fakes_serve.utf8_pipes()
    serve(sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    main()
