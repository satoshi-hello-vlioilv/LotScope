# -*- coding: utf-8 -*-
"""設定の束（GET /api/lotlist/settings）の「正しい答え」を出す係（版 3.84.0。desktop/tests/bundle_parity.rs が呼ぶ）。

    python tests/settings_oracle.py 作業フォルダ

場面ごとに配った設定（config.json）・マスタの置き場（共有 share・この PC の作業場所 local・同梱の data/ の親 base）を作り、
窓と同じ名乗り（TPA_SHELL=desktop・TPA_SHELL_SERVES に bundle）で Python の道に束を尋ねる。答えを取ったら、場面のフォルダを
尋ねる前の形に戻す（Python が写しを作る・この PC の覚えを書き直す前の形）。窓の試験は同じフォルダから自分で束を組み、答えを突き合わせる。

"expect": "same" は窓が同じ束を組む場面（conversions.rev は窓と Python で別の字なので比べない）・"delegate" は窓が組まずに Python に
尋ねる場面（窓の読めない字・Python が束を作れずに落ちる形・共有にまだ無いマスタ・設備グループの正規表現）。
"pyFollows" の場面は Python に引っ越しの印をたどらせて（bundle を名乗らない）答えを取り、窓が同じ置き場へたどるか・この PC の覚えに
同じ置き場を書くかを見る（製品では、印をたどる係は窓の 1 つ）。
"""
import json
import logging
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402

SERVES = "lotlist,lists,access,presence,ui_state,bundle"
NAMES = ("path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "conversions", "shift_patterns")


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def write(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


PATHS = [{"id": 1, "項目": "lot_list.refresh_seconds", "値": "30"}, {"id": 2, "項目": "lot_list.stale_hours", "値": "12"},
         {"id": 3, "項目": "lot_list.source", "値": ' "/q/品質.sqlite3" '}, {"id": 4, "項目": "work_log.pattern", "値": "実績_*.db"},
         {"id": 5, "項目": "schedule.cm3_base_url", "値": "http://cm3/x"}, {"id": 6, "項目": "work_log.refresh_seconds", "値": "5"},
         {"id": 7, "項目": "schedule.auto_refresh_sec", "値": "x"}, {"id": 8, "項目": "lot_list.table", "値": 12},
         {"id": 9, "項目": "work_log.stale_hours", "値": "1.5"}, {"id": 10, "項目": "lot_list.refresh_seconds", "値": "45"},
         {"id": 11, "項目": "update.source", "値": "C:\\x"}, {"id": 12, "項目": "work_log.folder", "値": '"\\\\srv\\実績"'},
         {"id": 13, "項目": "lot_list.page_size", "値": "9"}, {"id": 14, "項目": "schedule.equipments", "値": "L-1、L-2"}]
SOURCES = [{"id": 1, "キー": "wip", "表示名": "仕掛X", "場所": '"/wip.sqlite3"', "設備の列": "", "確かめる間隔": "120", "並び": "3"},
           {"id": 5, "キー": "s1", "表示名": "製造条件", "役割": "マスタ", "場所": "/m.sqlite3", "表": "M", "並び": "1",
            "結合": json.dumps([{"with": "wip", "how": "inner", "on": [["合金", "材質"], ["", "x"], "ab"], "cols": ["c1", " ", "c2"]},
                                {"with": "lot", "how": "bad", "on": "xy", "cols": "ab"}], ensure_ascii=False), "古さの警告": "2.5"},
           {"id": 6, "キー": "s2", "表示名": "結合した表", "元": "wip", "結合": [{"with": "s1", "on": [["a", "b"]]}], "並び": ""},
           {"id": 7, "キー": "s3", "表示名": "", "元": "s2", "確かめる間隔": "abc"},
           {"id": 8, "キー": "s4", "元": "無い元", "画面": "無"},
           {"id": 9, "キー": "s5", "表示名": "後", "場所": "/s5.sqlite3", "並び": "x"},
           {"id": "3", "キー": "s6", "表示名": "前", "場所": "/s6.sqlite3", "設備の取り出し方": "前方一致", "設備の列": "設備"},
           {"id": 10, "キー": "s6", "表示名": "前の 2 つ目", "場所": "/s6b.sqlite3"},
           {"id": 11, "キー": "lot", "表示名": "品質の名", "設備の列": "号機", "ロット番号の列": "LOT"},
           {"id": 12, "キー": "", "表示名": "鍵の無い行"}]
WORK = [{"id": 1, "キー": "w1", "設備名": "CAL", "ファイル名": "実績_CAL.db", "表示": "有", "並び": "2"},
        {"id": 2, "キー": "w2", "設備名": "CR1", "ファイル名": "実績_CR1.db", "ファイルID": "1:2", "表示": "無", "並び": ""},
        {"id": 3, "キー": "w3", "設備名": " ", "並び": "1"}, {"id": 4, "キー": "w4", "設備名": "L-1", "並び": "x"}]
EQUIP = [{"id": 1, "設備名": "CR1", "巻出し方向": "上"}, {"id": 2, "設備名": "TLV"}, {"id": 3, "設備名": "CAL"}, {"id": 4, "設備名": None}]
GROUPS = [{"id": 2, "名称": "L ライン", "まとめ方": "ライン別", "設備": "", "ルール": json.dumps({"rules": [{"op": "prefix", "value": " L- "},
                                                                                                   {"op": "prefix", "value": "L-"},
                                                                                                   {"op": "x", "value": "a"}],
                                                                                         "except": "L-9、L-9"}), "表示順": "20"},
          {"id": 1, "名称": "CR ライン", "まとめ方": "", "設備": "CR1, CR2,cr1", "表示順": "10", "備考": "メモ"},
          {"id": 3, "名称": "壊れたルール", "設備": "CAL", "ルール": "{", "表示順": "x"}]
CONV = [{"id": 2, "名前": "読み替え", "入力": json.dumps([{"name": "a", "type": "text", "columns": ["A"]}]),
         "判定": json.dumps([{"when": {"a": [{"op": "eq", "v": ["1"]}]}, "out": "x", "note": "古いメモ"}, 1, {"out": "y"}]), "その他": "z", "表示順": "2"},
        {"id": 1, "名前": "読み替え", "入力": "[]", "判定": "[]", "表示順": "2"},
        {"id": 3, "名前": "数の名", "入力": {"a": 1}, "判定": "{}", "その他": 5, "表示順": "1"},
        {"id": 4, "名前": "", "入力": "[]"}]
SHIFTS = [{"id": 1, "名称": "交替勤務", "適用設備": "", "区分": "[]", "表示順": "10"}]


def masters(share=None, data=None):
    """共有（share）か同梱の data/（data）に、束に使う 7 つのマスタを置く"""
    rows = {"path_settings": PATHS, "data_sources": SOURCES, "work_log_files": WORK, "equipment_master": EQUIP,
            "equipment_groups": GROUPS, "conversions": CONV, "shift_patterns": SHIFTS}
    for n in NAMES:
        if share is not None:
            write(share / f"{n}.json", doc(rows[n]))
        if data is not None:
            write(data / f"{n}.json", rows[n])


def config(root, **kw):
    c = {"lot_list": {"source": "/配った/品質.sqlite3", "table": "", "refresh_seconds": 60, "stale_hours": 36, "page_size": 300},
         "work_log": {"folder": "\\\\srv\\配った実績", "pattern": "実績_*.sqlite3", "page_size": None},
         "master_share": {"dir": str(root / "share")}, "desktop": {"lotlist_engine": "rust"}, "calculation": {"rolls": 3},
         "identity": {"pc_name": "PC-ORACLE"}, "sources": {"defaults": {"page_size": 200, "stale_hours": ""}, "wip": {"source": "/既定の仕掛.sqlite3"}},
         "schedule": {"auto_refresh_sec": 90}}
    c.update(kw)
    return c


def scenarios(work):
    out = []

    def sc(name, setup, expect="same", py_follows=False, now=None, env=None):
        root = work / f"s{len(out)}"
        root.mkdir(parents=True)
        (root / "base").mkdir()
        (root / "local").mkdir()
        cfg = setup(root)
        write(root / "config.json", cfg) if isinstance(cfg, dict) else (root / "config.json").write_text(cfg, encoding="utf-8")
        out.append({"name": name, "root": root, "expect": expect, "pyFollows": py_follows, "now": now, "env": env or {}})

    sc("共有・ふつう", lambda r: (masters(share=r / "share"), config(r))[1])
    sc("手元だけ（同梱の data/）", lambda r: (masters(data=r / "base" / "data"), config(r, master_share={}))[1])
    sc("既定の中身だけ（master_defaults）", lambda r: config(r, master_share={}, identity={}))
    sc("共有に置く名前を選ぶ・字の秒", lambda r: (masters(share=r / "share", data=r / "base" / "data"),
                                          config(r, master_share={"dir": str(r / "share") + "//", "masters": ["roll_master"],
                                                                  "lock_ttl_seconds": "7.5", "refresh_seconds": True}))[1])
    sc("置き場の字の $ を開く", lambda r: (masters(share=r / "share"), config(r, master_share={"dir": "$TPA_ORACLE_ROOT/share"}))[1],
       env={"TPA_ORACLE_ROOT": "@root"})
    sc("端末の名前に空白とコロン（名乗りの鍵に sha1 の 6 字）", lambda r: (masters(share=r / "share"), config(r, identity={"pc_name": " PC 1:北 "}))[1])
    sc("試験の「いま」", lambda r: (masters(share=r / "share"), config(r))[1], now="2026-10-03 10:00:00")

    def moved(r):
        masters(share=r / "share")
        masters(share=r / "share2")
        write(r / "share" / "_MOVED.json", {"to": str(r / "share2"), "at": "2026-11-01T09:00:00", "by": {"pc": "X"}})
        return config(r)
    sc("引っ越しの印をたどる", moved, py_follows=True)

    def pinned(r):
        masters(share=r / "share")
        masters(share=r / "share3")
        write(r / "local" / "want.json", {"masters": {"dir": str(r / "share3"), "setAt": "2026-11-02T09:00:00"}})
        write(r / "local" / "master_share.json", {"dir": str(r / "share"), "chosenAt": "2026-11-01T00:00:00",
                                                   "history": [{"dir": "/前の", "until": "2026-10-01T00:00:00", "by": {}}]})
        return config(r)
    sc("配る版の覚えの置き場に従う", pinned, py_follows=True)

    def remembered(r):
        masters(share=r / "share4")
        write(r / "local" / "master_share.json", {"dir": str(r / "share4")})
        return config(r)
    sc("この PC が覚えた置き場", remembered)

    # 窓は組まず Python に尋ねる形
    sc("配った設定に NaN", lambda r: (masters(share=r / "share"),
                                     json.dumps(config(r), ensure_ascii=False).replace('"page_size": 300', '"page_size": NaN'))[1], expect="delegate")

    def inf(r):
        masters(share=r / "share")
        rows = json.loads((r / "share" / "data_sources.json").read_text(encoding="utf-8"))
        rows["rows"].append({"id": 20, "キー": "s9", "表示名": "x", "場所": "/x", "確かめる間隔": "inf"})
        write(r / "share" / "data_sources.json", rows)
        return config(r)
    sc("データ元の行の間隔が inf", inf, expect="delegate")

    def regex(r):
        masters(share=r / "share")
        write(r / "share" / "equipment_groups.json", doc([{"id": 1, "名称": "g", "ルール": json.dumps({"rules": [{"op": "regex", "value": "^L"}]})}]))
        return config(r)
    sc("設備グループの正規表現", regex, expect="delegate")
    sc("共有にまだ無いマスタ", lambda r: ((r / "share").mkdir(), config(r))[1], expect="delegate")
    sc("lot_list が表でない", lambda r: (masters(share=r / "share"), config(r, lot_list="x"))[1], expect="delegate")
    return out


def ask(s, follows):
    root = s["root"]
    os.environ["TPA_SHELL"] = "desktop"
    os.environ["TPA_SHELL_SERVES"] = SERVES.replace(",bundle", "") if follows else SERVES
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    for k, v in s["env"].items():
        os.environ[k] = str(root) if v == "@root" else v
    try:
        cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    except ValueError:
        cfg = {}
    tc = {"MASTER_STORE": MasterStore(root / "base", local_root=root / "local",
                                      settings=cfg.get("master_share") if isinstance(cfg, dict) else None)}
    if s["now"]:
        tc["DASHBOARD_NOW"] = datetime.strptime(s["now"], "%Y-%m-%d %H:%M:%S")
    try:
        app = create_app(tc)
        r = app.test_client().get("/api/lotlist/settings")
        answer = r.get_json() if r.status_code == 200 else None
    except Exception as e:      # Python が束を作れずに落ちる形（窓は Python に尋ねる）
        answer = {"error": repr(e)}
    over = root / "local" / "master_share.json"
    after = json.loads(over.read_text(encoding="utf-8")) if over.exists() else None
    for k in s["env"]:
        os.environ.pop(k, None)
    return answer, after


def main():
    logging.disable(logging.CRITICAL)
    work = Path(sys.argv[1])
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    out = []
    for s in scenarios(work):
        keep = work / "_keep"
        shutil.copytree(s["root"], keep)
        answer, after = ask(s, s["pyFollows"])
        shutil.rmtree(s["root"])
        shutil.move(str(keep), s["root"])          # 尋ねる前の形へ戻す（窓は同じフォルダから組む）
        root = s["root"]
        # 窓が Python に尋ねる場面の答えは比べない（NaN を含むと JSON で渡せない）
        out.append({"name": s["name"], "expect": s["expect"], "pyFollows": s["pyFollows"],
                    "answer": answer if s["expect"] == "same" else None, "override": after,
                    "env": {"base": str(root / "base"), "program": str(PROGRAM), "local": str(root / "local"), "config": str(root / "config.json"),
                            "now": s["now"]},
                    "vars": {k: (str(root) if v == "@root" else v) for k, v in s["env"].items()}})
    json.dump({"scenarios": out}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
