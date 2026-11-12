# -*- coding: utf-8 -*-
"""組む所の読み 7 本（版 3.99.0）の「正しい答え」を出す係（desktop/tests/builder_parity.rs が起こしたままにして尋ねる）。

    python tests/builder_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/dashboard.py の dashboard_fields・data_columns、
routes/sources.py の sources_columns・sources_check・sources_join_preview・sources_conn_check。門番 _access_guard を含む）で
問い合わせの並びを当てる。窓の試験は rs に同じ並びを本物の窓の道（Lot::handle_body → builder_route。材料は窓の束の材料）で当て、
答え（状態・本文。断る言葉も 1 字まで。確かめるの ms・更新時刻の小数・SQLite の英語の字だけ伏せる）を突き合わせる。
窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
データのファイル（品質・仕掛・マスタ・作業実績 14 台〈ZZ3 だけの列・CAL の 速度 が全部空・ファイルの無い設備〉・確かめる用）は場面に共通の data に置く。
独立の答え（tools/builder-truth.py。app を import しない）も場面のファイルから出し（"truth"）、窓の答えとも比べる。
最初の 1 行（JSON）を書いた後は起きたままで、作り物の CM3（どの道にも 404 を答える HTTP）を起こしておき、標準入力の 1 行ごとに
{"cmd": "join", "root": 場面のフォルダ, "n": 回数} を受けると、そのフォルダ（窓と同じ作業場所）で Python の「試す」を n 回して答えを 1 行で返す
（窓と Python が同じ try- の名前を同時に組んでも壊れないかを見る）。標準入力が閉じたら終わる。
"""
import http.server
import importlib.util
import json
import logging
import os
import shutil
import sqlite3
import sys
import threading
import time
from contextlib import closing
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import builder, identity  # noqa: E402
import oracle_gate  # noqa: E402

_spec = importlib.util.spec_from_file_location("builder_truth", PROGRAM / "tools" / "builder-truth.py")
truth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(truth)

LOGIN = identity.current_login_id()
EQUIPS = ["CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1", "ZZ1", "ZZ2", "ZZ3"]


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def perm(role="開発者", edit="編集可"):
    return [{"id": 1, "ログインID": LOGIN, "PC名": "", "権限区分": role, "マスタ編集": edit, "有効": "有", "rev": 1}]


def table(path, name, cols, rows):
    with closing(sqlite3.connect(path)) as c:
        c.execute(f"CREATE TABLE \"{name}\" ({', '.join(f'[{x}]' for x in cols)})")
        c.executemany(f"INSERT INTO \"{name}\" VALUES ({', '.join('?' * len(cols))})", rows)
        c.commit()


def make_data(d):
    """場面に共通のデータのファイル"""
    d.mkdir(parents=True, exist_ok=True)
    lots = [f"L{i:04d}" for i in range(1200)]
    # 品質: 不良名に NULL・空・空白・同じ字の別の書き方、数の列に 0 と '0'、全部空の列
    q = [(lots[i], ["CR1", "CR2", " L-1 ", "", None][i % 5], ["A1100", "a5052 ", "A5052", "A3004"][i % 4],
          [None, "", " ", "キズ", "キズ ", "汚れ", "割れ"][i % 7], [0, "0", "1", 1.0, " 2 ", "x"][i % 6], None,
          f"2026/10/{(i % 28) + 1:02d} 08:00") for i in range(900)]
    table(d / "品質.sqlite3", "品質", ["ロット番号", "設備", "合金", "不良名", "数", "空の列", "日時"], q)
    # 仕掛: ロット番号は作業実績と重なる・設備の列に空の字
    w = [(lots[i], ["CR1 L-1", "", None, "ANF DL2 TLV", "CR2"][i % 5], ["A1100", "a5052", "A3004"][i % 3], None) for i in range(0, 1200, 2)]
    table(d / "仕掛.sqlite3", "仕掛", ["ロット番号", "残仕掛設備ｺｰｽ", "合金", "コンマ5本分割_切断巾1"], w)
    # マスタ（製造条件）: 材質の書き方のゆれ（後ろの空白・小文字）
    table(d / "製造条件.sqlite3", "製造条件", ["材質", "質別", "強さ"],
          [("A1100", "O", 10), ("a5052 ", "H34", 20), ("A3004", "H24", None), ("a5052", "O", 30), ("A1100", "H14", "")])
    # 作業実績 14 台（12 台の上限の先に ZZ1〜ZZ3。ZZ3 だけの列・CAL の 速度 は全部空）
    folder = d / "実績"
    folder.mkdir()
    for k, eq in enumerate(EQUIPS):
        cols = ["ロット番号", "BOX実績_作業開始_日付", "重量", "速度", "合金"] + (["ZZだけの列"] if eq == "ZZ3" else []) + (["CALだけ"] if eq == "CAL" else [])
        rows = []
        for i in range(60):
            n = (k * 37 + i * 11) % 1200
            r = [lots[n], f"2026/10/{(i % 20) + 1:02d} {8 + i % 9:02d}:00:00", f"{(n % 13) * 10.5:.1f}",
                 None if eq == "CAL" else str(100 + (n % 17)), ["A1100", "a5052", "A3004", None][i % 4]]
            if eq == "ZZ3":
                r.append(f"z{i % 4}")
            if eq == "CAL":                     # 作った後の採点: 1 台にだけある鍵の列（仕掛のロット番号に当たる値と当たらない値）
                r.append(lots[(i * 2) % 1200] if i % 3 else f"無{i}")
            rows.append(r)
        table(folder / f"実績_{eq}.sqlite3", "実績", cols, rows)
    # 確かめる用: 表 2 つ・SQLite でないファイル・30 分先・40 時間前
    table(d / "two.sqlite3", "A表", ["x", "y"], [(i, i) for i in range(5)])
    table(d / "two.sqlite3", "B表", ["ロット番号", "設備"], [("L0", None), ("L1", ""), ("L2", "CR1"), ("L3", " "), ("L4", "L-1"), ("L5", "CR1")])
    (d / "text.sqlite3").write_text("abc", encoding="utf-8")
    shutil.copy(d / "two.sqlite3", d / "future.sqlite3")
    t = time.time() + 1800
    os.utime(d / "future.sqlite3", (t, t))
    shutil.copy(d / "two.sqlite3", d / "old.sqlite3")
    t = time.time() - 40 * 3600
    os.utime(d / "old.sqlite3", (t, t))
    return folder


def masters_of(d):
    sources = [{"id": 1, "キー": "wip", "表示名": "仕掛", "場所": str(d / "仕掛.sqlite3"), "設備の列": "残仕掛設備ｺｰｽ", "並び": "1", "rev": 1},
               {"id": 2, "キー": "m1", "表示名": "製造条件", "役割": "マスタ", "場所": str(d / "製造条件.sqlite3"), "並び": "2", "rev": 1},
               {"id": 3, "キー": "v1", "表示名": "合わせた", "元": "wip", "結合": j([{"with": "m1", "on": [["合金", "材質"]]}]), "並び": "3"},
               {"id": 4, "キー": "e1", "表示名": "届かない", "場所": str(d / "無い" / "x.sqlite3"), "並び": "4"}]
    work = [{"id": i + 1, "キー": f"w{i + 1}", "設備名": eq, "ファイル名": f"実績_{eq}.sqlite3", "表示": "有", "並び": str(i + 1)}
            for i, eq in enumerate(EQUIPS)]
    work.append({"id": 50, "キー": "w50", "設備名": "MISS", "ファイル名": "実績_MISS.sqlite3", "表示": "有", "並び": "50"})
    work.append({"id": 51, "キー": "w51", "設備名": "HID", "ファイル名": "実績_CR1.sqlite3", "表示": "無", "並び": "51"})
    return {"data_sources": sources, "work_log_files": work,
            "path_settings": [{"id": 1, "項目": "lot_list.source", "値": str(d / "品質.sqlite3"), "rev": 1}],
            "equipment_groups": [{"id": 1, "名称": "CR ライン", "まとめ方": "ライン別", "設備": "CR1, CR2", "表示順": "1"}]}


def place(root, d, folder, perm_rows):
    share = root / "share"
    for x in (share, root / "base" / "data", root / "local"):
        x.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    ms = {**masters_of(d), "access_permissions": perm_rows}
    for n in ("equipment_master", "conversions", "shift_patterns"):
        ms[n] = []
    for name, rows in ms.items():
        (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    cfg = {"lot_list": {"source": str(d / "品質.sqlite3"), "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "work_log": {"folder": str(folder), "pattern": "実績_*.sqlite3"},
           "identity": {"pc_name": "PC-ORACLE"}, "sources": {"wip": {"source": str(d / "仕掛.sqlite3")}},
           "master_share": {"dir": str(share), "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


def S(method, path, body=None, query=""):
    return {"method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


def steps_of(d, cm3):
    lot_place, wip = str(d / "品質.sqlite3"), str(d / "仕掛.sqlite3")
    F, C = "/api/dashboard/fields", "/api/sources/check"
    calc = {"formulas": {"重さ2": "[重量]*2", "壊れ": "[重量 +"}, "names": {}}
    jw = [{"with": "wip", "on": [["ロット番号", "ロット番号"]]}]
    return [
        S("GET", F, query="source=work"),
        S("GET", F, query="source=lot"),
        S("GET", F, query="source=src%3Awip"),
        S("GET", F, query="source=src%3Am1"),
        S("GET", F, query="source=src%3Av1"),
        S("GET", F, query="source=work&equip=w14"),
        S("GET", F, query="source=src%3A%E7%84%A1"),
        S("GET", F, query="source=src%3Ae1"),
        S("POST", F, {"source": "work", "calc": calc}),
        S("POST", F, {"source": "work", "equips": ["CR1", "ZZ3", "MISS"]}),
        S("POST", F, {"source": "lot", "calc": calc}),
        S("POST", F, {"source": "work", "equip": "w8"}),
        S("POST", F, ""),
        S("GET", "/api/data/columns"),
        S("GET", "/api/sources/work/columns"),
        S("GET", "/api/sources/wip/columns"),
        S("GET", "/api/sources/m1/columns"),
        S("GET", "/api/sources/v1/columns"),
        S("GET", "/api/sources/lot/columns"),
        S("GET", "/api/sources/無い/columns"),
        S("POST", C, {"place": str(d / "two.sqlite3"), "table": "B表", "role": "品質"}),
        S("POST", C, {"place": str(d / "two.sqlite3"), "table": "", "role": "品質"}),
        S("POST", C, {"place": str(d / "two.sqlite3"), "role": "マスタ"}),
        S("POST", C, {"place": f'"{wip}"', "role": "仕掛", "equipColumn": "残仕掛設備ｺｰｽ"}),
        S("POST", C, {"place": wip, "role": "仕掛", "equipColumn": "無い列"}),
        S("POST", C, {"place": str(d / "future.sqlite3"), "table": "B表", "role": "品質"}),
        S("POST", C, {"place": str(d / "old.sqlite3"), "role": "マスタ"}),
        S("POST", C, {"place": str(d / "old.sqlite3"), "table": "B表", "role": "仕掛"}),
        S("POST", C, {"place": str(d / "text.sqlite3"), "role": "品質"}),
        S("POST", C, {"place": str(d / "無い.sqlite3"), "role": "品質"}),
        S("POST", C, {"place": "  ", "role": "品質"}),
        S("POST", C, {}),
        S("POST", C, {"place": lot_place, "role": 0}),
        S("POST", "/api/sources/join/preview", {"key": "work", "joins": jw}),
        S("POST", "/api/sources/join/preview", {"key": "work", "joins": [{"with": "wip", "on": [["CALだけ", "ロット番号"]]}]}),
        S("POST", "/api/sources/join/preview", {"key": "work", "joins": [{"with": "wip", "on": [["無い列", "ロット番号"]]}]}),
        S("POST", "/api/sources/join/preview", {"key": "wip", "joins": [{"with": "m1", "how": "full", "on": [["合金", "材質"]]}]}),
        S("POST", "/api/sources/join/preview", {"base": "wip", "joins": [{"with": "m1", "on": [["合金", "材質"]], "cols": ["強さ"]}]}),
        S("POST", "/api/sources/join/preview", {"key": "v1", "joins": [{"with": "m1", "how": "inner", "on": [["合金", "材質"]]}]}),
        S("POST", "/api/sources/join/preview", {"key": "wip", "joins": [{"with": "m1", "on": [["無い列", "材質"]]}]}),
        S("POST", "/api/sources/join/preview", {"key": "wip", "joins": [{"with": "", "on": [["a", "b"]]}]}),
        S("POST", "/api/sources/join/preview", {"key": "wip", "joins": []}),
        S("POST", "/api/sources/join/preview", {"key": "無い", "joins": jw}),
        S("POST", "/api/sources/join/preview", {"base": "work", "joins": jw}),
        S("POST", "/api/sources/lot/conn/check", {"field": "place", "value": lot_place}),
        S("POST", "/api/sources/lot/conn/check", {"field": "place", "value": ""}),
        S("POST", "/api/sources/wip/conn/check", {"field": "place", "value": f'"{wip}"'}),
        S("POST", "/api/sources/m1/conn/check", {"field": "place", "value": str(d / "old.sqlite3")}),
        S("POST", "/api/sources/work/conn/check", {"field": "folder", "value": str(d / "実績")}),
        S("POST", "/api/sources/work/conn/check", {"field": "folder", "value": str(d / "実績"), "pattern": "実績_ZZ*.sqlite3"}),
        S("POST", "/api/sources/work/conn/check", {"field": "folder", "value": str(d / "実績"), "pattern": "実績.sqlite3"}),
        S("POST", "/api/sources/work/conn/check", {"field": "folder", "value": str(d / "無いフォルダ")}),
        S("POST", "/api/sources/work/conn/check", {"field": "pattern", "value": "実績_*.db"}),
        S("POST", "/api/sources/sch/conn/check", {"field": "url", "value": cm3}),
        S("POST", "/api/sources/sch/conn/check", {"field": "url", "value": "http://127.0.0.1:1"}),
        S("POST", "/api/sources/sch/conn/check", {"field": "url", "value": "ftp://x"}),
        S("POST", "/api/sources/lot/conn/check", {"field": "refresh", "value": 5}),
        S("POST", "/api/sources/lot/conn/check", {"field": "refresh", "value": "120"}),
        S("POST", "/api/sources/wip/conn/check", {"field": "nope", "value": "x"}),
        S("POST", "/api/sources/無い/conn/check", {"field": "place", "value": "x"}),
        S("POST", "/api/sources/wip/conn/check", {"field": "lot", "value": "ロット番号"}),
        # 参照先の「確かめる」（版 3.101.0。入口は conn/check と同じ check_entry。値も既定も空なら「値を入れてください。」）
        S("POST", "/api/settings/check", {"key": "lot_list.source", "value": lot_place}),
        S("POST", "/api/settings/check", {"key": "lot_list.source", "value": f' "{lot_place}" '}),
        S("POST", "/api/settings/check", {"key": "lot_list.source", "value": ""}),
        S("POST", "/api/settings/check", {"key": "lot_list.source", "value": str(d / "無い.sqlite3")}),
        S("POST", "/api/settings/check", {"key": "lot_list.table", "value": "x"}),
        S("POST", "/api/settings/check", {"key": "lot_list.refresh_seconds", "value": "120"}),
        S("POST", "/api/settings/check", {"key": "lot_list.refresh_seconds", "value": "abc"}),
        S("POST", "/api/settings/check", {"key": "lot_list.refresh_seconds", "value": ""}),
        S("POST", "/api/settings/check", {"key": "work_log.folder", "value": str(d / "実績")}),
        S("POST", "/api/settings/check", {"key": "work_log.folder", "value": str(d / "無いフォルダ")}),
        S("POST", "/api/settings/check", {"key": "work_log.folder", "value": ""}),
        S("POST", "/api/settings/check", {"key": "work_log.pattern", "value": "実績_*.db"}),
        S("POST", "/api/settings/check", {"key": "work_log.pattern", "value": "実績.db"}),
        S("POST", "/api/settings/check", {"key": "schedule.cm3_base_url", "value": cm3}),
        S("POST", "/api/settings/check", {"key": "schedule.cm3_base_url", "value": "ftp://x"}),
        S("POST", "/api/settings/check", {"key": "schedule.cm3_base_url", "value": "  "}),
        S("POST", "/api/settings/check", {"key": "lotdsp_import.url", "value": ""}),
        S("POST", "/api/settings/check", {"key": "lotdsp_import.url", "value": "http://127.0.0.1:1/x#y"}),
        S("POST", "/api/settings/check", {"key": "lotdsp_import.direct.browser", "value": "C:\\x\\notepad.exe"}),
        S("POST", "/api/settings/check", {"key": "知らない", "value": "x"}),
        S("POST", "/api/settings/check", {"key": 5}),
        S("POST", "/api/settings/check", {}),
        S("POST", "/api/settings/check", ""),
    ]


def delegates_of():
    F = "/api/dashboard/fields"
    return [
        S("POST", F, "[1]"),
        S("POST", F, {"source": 5}),
        S("POST", F, {"source": "work", "equips": [1, "CR1"]}),
        S("POST", F, '{"source": "work", "x": NaN}'),
        S("GET", F, query="source=lot&engine=python"),
        S("POST", "/api/sources/check", "[1]"),
        S("POST", "/api/sources/check", {"place": ["x"]}),
        S("POST", "/api/sources/join/preview", {"key": "wip", "joins": [{"with": "m1", "on": [["合金", "材質"]], "cols": 5}]}),
        S("POST", "/api/sources/join/preview", "[1]"),
        S("POST", "/api/sources/wip/conn/check", {"field": "place", "value": [1]}),
        S("GET", "/api/sources/%E7%84%A1/columns"),
        S("POST", "/api/settings/check", "[1]"),
        S("POST", "/api/settings/check", {"key": ["lot_list.source"]}),
        S("POST", "/api/settings/check", {"key": "lot_list.source", "value": "x"}, query="engine=python"),
    ]


def gate_steps(d):
    return [S("POST", "/api/sources/join/preview", {"key": "wip", "joins": [{"with": "m1", "on": [["合金", "材質"]]}]}),
            S("POST", "/api/sources/check", {"place": str(d / "two.sqlite3"), "role": "マスタ"}),
            S("GET", "/api/dashboard/fields", query="source=src%3Am1"),
            S("POST", "/api/settings/check", {"key": "work_log.pattern", "value": "実績_*.db"})]   # 参照先の「確かめる」は門番なし


def app_of(root):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    return create_app({"TESTING": True, "MASTER_STORE": store})


def run(root, steps):
    app = app_of(root)
    c = app.test_client()
    out = []
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    for st in steps:
        routes._REVOKE_CACHE.update(at=0.0, key="")
        forget_tab_cache()
        path = st["path"] + (f"?{st['query']}" if st["query"] else "")
        try:
            r = c.open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"), content_type="application/json")
            try:
                body = r.get_json()
            except Exception:
                body = None
            out.append({**st, "status": r.status_code, "json": body})
        except Exception as e:
            out.append({**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}", "kind": "error"}})
    return out


class _Cm3(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Cm3)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    cm3 = f"http://127.0.0.1:{srv.server_address[1]}"
    d = base / "data"
    folder = make_data(d)
    files = [folder / f"実績_{eq}.sqlite3" for eq in EQUIPS]
    scenes = [("開発者の PC", perm(), steps_of(d, cm3), delegates_of()),
              ("一般ユーザー（データ元を書けない）", perm("一般ユーザー", "部分的編集可"), gate_steps(d), [])]
    out = []
    for i, (name, prm, steps, dele) in enumerate(scenes):
        steps, dele = oracle_gate.split(steps, dele)       # 版 3.104.0: 本文の門が断る歩は窓が答える
        py, rs = base / f"s{i}" / "py", base / f"s{i}" / "rs"
        for r in (py, rs):
            place(r, d, folder, prm)
        out.append({"name": name, "py": str(py), "rs": str(rs), "steps": run(py, steps), "delegates": dele,
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    # 窓と Python が同じ作業場所で同時に「試す」を組む場面（窓の Lot も Python も shared/local を使う）
    shared = base / "shared"
    place(shared, d, folder, perm())
    jw = [{"with": "wip", "on": [["ロット番号", "ロット番号"]]}]
    tr = {"workFields": truth.fields(files, candidates=truth.WORK_TABLES),
          "lotFields": truth.fields([d / "品質.sqlite3"], candidates=truth.LOT_TABLES),
          "wipFields": truth.fields([d / "仕掛.sqlite3"]),
          "workColumns": truth.samples(files, candidates=truth.WORK_TABLES)["order"],
          "workRows": truth.rows_of(files, candidates=truth.WORK_TABLES),
          "workJoin": truth.join_try(files, d / "仕掛.sqlite3", [("ロット番号", "ロット番号")]),
          "workJoinCal": truth.join_try(files, d / "仕掛.sqlite3", [("CALだけ", "ロット番号")]),
          "m1Samples": truth.samples([d / "製造条件.sqlite3"])["samples"]}
    print(j({"scenarios": out, "decisions": builder.decisions(), "truth": tr, "cm3": cm3,
             "shared": {"root": str(shared), "body": j({"key": "work", "joins": jw}),
                        "env": {"base": str(shared / "base"), "program": str(PROGRAM), "local": str(shared / "local"),
                                "config": str(shared / "config.json")}}}), flush=True)
    for line in sys.stdin:
        cmd = json.loads(line)
        if cmd.get("cmd") == "join":
            root = Path(cmd["root"])
            # 製品と同じく、窓が写しの係（lists）を名乗る形: Python の写しは受け身で、窓が写した物を読む（同じ作業場所に写し手は 1 つ）
            os.environ["TPA_SHELL"], os.environ["TPA_SHELL_SERVES"] = "desktop", "lotlist,lists,bundle"
            try:
                got = run(root, [S("POST", "/api/sources/join/preview", cmd["body"])] * int(cmd.get("n", 1)))
            finally:
                os.environ.pop("TPA_SHELL", None)
                os.environ.pop("TPA_SHELL_SERVES", None)
            print(j([{"status": x["status"], "json": x["json"]} for x in got]), flush=True)
    srv.shutdown()


if __name__ == "__main__":
    main()
