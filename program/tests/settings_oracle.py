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

版 3.85.0 から、同じ場面で画面（GET /）・/api/config・/api/dashboard/sources・/api/dashboard/equip-tree の答えも取る（"reads"。
desktop/tests/page_parity.rs が窓の答えと突き合わせる）。画面の印（nonce）は @NONCE@ に揃える。版 3.87.0 から GET /api/sources も。版 3.89.0 から GET /api/settings（参照先の項目）も。スケジュールの元に場所がある場面の
設備の木は尋ねない（Python は CM3 へ読みに行く。窓は Python に任せる）。
"""
import json
import logging
import os
import re
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
    if share is not None:      # 画面の初期設定（版 3.85.0。共有に置く名前。無ければ Python が写しから最初の版を作るので窓は描かない）
        write(share / "ui_defaults.json", doc([{"名前": "tpa.lotlist.cols", "値": "[1]", "updated_at": "2026-11-01T00:00:00",
                                                 "updated_by": {"login": "x"}}, {"名前": "外", "値": "y"}]))
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

    def sc(name, setup, expect="same", py_follows=False, now=None, env=None, program=None, override=None, tree=False, serves=None):
        root = work / f"s{len(out)}"
        root.mkdir(parents=True)
        (root / "base").mkdir()
        (root / "local").mkdir()
        cfg = setup(root)
        write(root / "config.json", cfg) if isinstance(cfg, dict) else (root / "config.json").write_text(cfg, encoding="utf-8")
        out.append({"name": name, "root": root, "expect": expect, "pyFollows": py_follows, "now": now, "env": env or {},
                    "program": program, "expectOverride": override, "tree": tree, "serves": serves})

    sc("共有・ふつう", lambda r: (masters(share=r / "share"), config(r))[1])
    sc("手元だけ（同梱の data/）", lambda r: (masters(data=r / "base" / "data"), config(r, master_share={}))[1])
    sc("既定の中身だけ（master_defaults）", lambda r: config(r, master_share={}, identity={}), tree=True)
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

    # 作った後の採点（版 3.84.0）で見つかった形
    def chain(r):
        masters(share=r / "share")
        masters(share=r / "share2")
        masters(share=r / "share3")
        write(r / "share" / "_MOVED.json", {"to": str(r / "share2"), "at": "2026-11-01T09:00:00"})
        write(r / "share2" / "_MOVED.json", {"to": str(r / "share3"), "at": " 2026-11-02T09:00:00"})   # 前に空白（字の順で前の印より前）
        return config(r)
    sc("引っ越しの印の時刻の空白は落とさない", chain, py_follows=True)

    def loop(r):
        masters(share=r / "share")
        masters(share=r / "share2")
        write(r / "share" / "_MOVED.json", {"to": str(r / "share2"), "at": "2026-11-01T09:00:00"})
        write(r / "share2" / "_MOVED.json", {"to": str(r / "share"), "at": "2026-11-03T09:00:00"})
        return config(r)
    sc("引っ越しの印の輪", loop, py_follows=True)

    def old_mark(r):
        masters(share=r / "share")
        masters(share=r / "share2")
        masters(share=r / "share3")
        write(r / "share" / "_MOVED.json", {"to": str(r / "share2"), "at": "2026-11-05T09:00:00", "by": False})
        write(r / "share2" / "_MOVED.json", {"to": str(r / "share3"), "at": False})
        return config(r)
    sc("前の印より古い・偽の時刻の印", old_mark, py_follows=True)

    def pin_space(r):
        masters(share=r / "share")
        masters(share=r / "share3")
        write(r / "local" / "want.json", {"masters": {"dir": str(r / "share3"), "setAt": " 2026-11-09"}})
        write(r / "local" / "master_share.json", {"dir": str(r / "share"), "chosenAt": "2026-11-05T00:00:00"})
        return config(r)
    sc("配る版の覚えの時刻の空白", pin_space, py_follows=True)

    def pin_chosen(r):
        masters(share=r / "share")
        masters(share=r / "share3")
        write(r / "local" / "want.json", {"masters": {"dir": str(r / "share3"), "setAt": "2026-11-01T00:00:00"}})
        write(r / "local" / "master_share.json", {"dir": str(r / "share"), "chosenAt": "2026-11-05T00:00:00"})
        return config(r)
    sc("人が選んだ時刻の方が新しい配る版の覚えには従わない", pin_chosen, py_follows=True)

    def over_nan(r):
        masters(share=r / "share2")
        (r / "local" / "master_share.json").write_text('{"dir": %s, "n": NaN, "big": 123456789012345678901234567890}' % json.dumps(str(r / "share2")),
                                                     encoding="utf-8")
        return config(r)
    sc("この PC の覚えに NaN と大きな整数", over_nan)

    def moved_nan(r):
        masters(share=r / "share")
        masters(share=r / "share2")
        (r / "share" / "_MOVED.json").write_text('{"to": %s, "at": "2026-11-01T09:00:00", "x": NaN}' % json.dumps(str(r / "share2")), encoding="utf-8")
        return config(r)
    sc("引っ越しの印に NaN", moved_nan, py_follows=True)

    def big_orders(r):
        masters(share=r / "share")
        g = [{"id": 1, "名称": "a", "設備": "CR1", "表示順": "999999999999999999"}, {"id": 2, "名称": "b", "設備": "CR1", "表示順": "5"},
             {"id": 3, "名称": "c", "設備": "CR1", "表示順": "１２"}, {"id": 4, "名称": "d", "設備": "CR1", "表示順": "1_0"}]
        write(r / "share" / "equipment_groups.json", doc(g))
        cv = json.loads((r / "share" / "conversions.json").read_text(encoding="utf-8"))
        cv["rows"] += [{"id": 9, "名前": "同じ名", "入力": "[]", "その他": "1", "表示順": "99999999999999999999"},
                       {"id": 8, "名前": "同じ名", "入力": "[]", "その他": "2", "表示順": "7"}]
        write(r / "share" / "conversions.json", cv)
        ds = json.loads((r / "share" / "data_sources.json").read_text(encoding="utf-8"))
        ds["rows"] += [{"id": 30, "キー": "b1", "表示名": "大", "場所": "/b1", "並び": "99999999999999999999"},
                       {"id": 31, "キー": "b2", "表示名": "小", "場所": "/b2", "並び": "4", "確かめる間隔": "1e18"},
                       {"id": 32, "キー": "b3", "表示名": "u64", "場所": "/b3", "古さの警告": "1e19"}]
        write(r / "share" / "data_sources.json", ds)
        wl = json.loads((r / "share" / "work_log_files.json").read_text(encoding="utf-8"))
        wl["rows"] += [{"id": 9, "キー": "w9", "設備名": "BIG", "並び": "99999999999999999999"}, {"id": 10, "キー": "w10", "設備名": "全角", "並び": "３"}]
        write(r / "share" / "work_log_files.json", wl)
        return config(r)
    sc("大きな数・全角の並べ替え", big_orders)
    sc("中身の置き場の道に ..", lambda r: (masters(share=r / "share"), config(r))[1], program=str(PROGRAM.parent / "desktop" / ".." / "program"))
    sc("ログイン ID の環境が空白だけ", lambda r: (masters(share=r / "share"), config(r))[1], env={"LOGNAME": "  ", "USER": "  ", "LNAME": "", "USERNAME": "名乗り"})

    def nan_cfg_moved(r):
        masters(share=r / "share")
        masters(share=r / "share2")
        write(r / "share" / "_MOVED.json", {"to": str(r / "share2"), "at": "2026-11-01T09:00:00"})
        return json.dumps(config(r), ensure_ascii=False).replace('"page_size": 300', '"page_size": NaN')
    sc("束を組めない設定でも引っ越しの印は窓がたどる", nan_cfg_moved, expect="delegate", override="share2")

    def bad_rows(r):
        masters(share=r / "share")
        write(r / "share" / "shift_patterns.json", doc(["x", {"id": 1, "名称": "a"}]))
        return config(r)
    sc("勤務体系に表でない行", bad_rows, expect="delegate")

    def op_list(r):
        masters(share=r / "share")
        write(r / "share" / "equipment_groups.json", doc([{"id": 1, "名称": "g", "ルール": json.dumps({"rules": [{"op": ["prefix"], "value": "L"}]})}]))
        return config(r)
    sc("設備グループのルールの op が並び", op_list, expect="delegate")

    def update_str(r):
        masters(share=r / "share")
        ps = json.loads((r / "share" / "path_settings.json").read_text(encoding="utf-8"))
        ps["rows"].append({"id": 99, "項目": "update.source", "値": "C:\\x"})
        write(r / "share" / "path_settings.json", ps)
        return config(r, update="x")
    sc("束に出ない項目の段が字", update_str, expect="delegate")

    def nested(r):
        masters(share=r / "share")
        write(r / "share" / "equipment_groups.json", doc([{"id": 1, "名称": "g", "設備": [["a"], "b"]}]))
        return config(r)
    sc("設備の並びの中に並び", nested, expect="delegate")
    sc("表示順が i64 に入らない設備グループ", lambda r: (masters(share=r / "share"),
                                                 write(r / "share" / "equipment_groups.json", doc([{"id": 1, "名称": "g", "設備": "a", "表示順": "99999999999999999999"}])),
                                                 config(r))[2], expect="delegate")

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

    # 画面と最初の画面の読む道（版 3.85.0。page_parity.rs）
    def page_parts(r):
        masters(share=r / "share")
        cv = json.loads((r / "share" / "conversions.json").read_text(encoding="utf-8"))
        cv["rows"] += [{"id": 7, "名前": "絵文字😀と<b>&'", "入力": json.dumps([{"name": "a", "columns": ["Ａ"]}]),
                        "判定": json.dumps([{"when": {"a": [{"op": "ge", "v": [1.5, 2.0, -0.0, 1e16]}]}, "out": "</script>"}]),
                        "当て方": json.dumps({"列": "x", "n": 3}), "表示順": 2.7},
                       {"id": "12", "名前": "id が字", "入力": "[]", "判定": "{}", "当て方": "[]", "表示順": True}]
        cv["revision"] = 41
        write(r / "share" / "conversions.json", cv)
        write(r / "local" / "ui_state.json", {"rev": 7, "keys": {"tpa.dash.open": "1", "tpa.x": "字<\u2028>", "外": "y", "tpa.n": 3}})
        write(r / "local" / "lotdsp_api_map.json", {
            "actual": {"list": "entity.rows", "cols": {"equipment": {"cands": ["a.b"], "seen": 2}, "work_date": {"cands": ["d"], "trusted": True},
                                                      "thickness": {"cands": ["t1", "t2"], "seen": 9}, "width": {"cands": None, "seen": 0}}},
            "design": {"list": None, "cols": {}},
            "lot": {"cols": {"lot_no": {"cands": ["x", "y"], "seen": 3}, "density": {"cands": ["z"], "seen": 1}}},
            "login_free": True, "last_error": "時間切れ", "probe": {"actual.width": {"shape": "数"}}})
        return config(r, lotdsp_import={"url": " http://lotdsp/x/ ", "api": {"enabled": True, "timeout_seconds": "20"},
                                        "direct": {"enabled": 1, "login_window": 0, "keep_seconds": 30}},
                      presence={"heartbeat_interval_seconds": "2.5"}, ui_defaults={"max_rows": "30", "found_pitch_mm": 610})
    sc("画面の材料（控え・初期設定・変換表の小数と絵文字・LotDsp の学び）", page_parts)

    def page_learned(r):
        masters(share=r / "share")
        write(r / "local" / "lotdsp_api_map.json", {"actual": {"list": "e", "cols": {c: {"cands": [c], "trusted": True} for c in
                                                                                 ("equipment", "work_date", "thickness", "width", "weight", "off_front_m", "off_back_m")}},
                                                    "design": {"list": "d", "cols": {c: {"cands": [c], "seen": 5} for c in ("equipment", "horizontal_split", "vertical_split")}},
                                                    "lot": {"cols": {"lot_no": {"cands": ["n"], "seen": 2}}}})
        return config(r, lotdsp_import={"url": "", "api": {"search_url": "http://s"}, "direct": {"enabled": False}},
                      presence={"heartbeat_interval_seconds": 4}, ui_defaults={"max_rows": 12.9})
    sc("LotDsp の学びが済んだ・API だけの URL・数の max_rows", page_learned)
    sc("参照先で LotDsp の URL を変える・初期設定が無い", lambda r: (masters(share=r / "share"), (r / "share" / "ui_defaults.json").unlink(),
                                                      write(r / "share" / "ui_defaults.json", doc([])),
                                                      config(r, lotdsp_import={"url": "http://配った"}, presence={}, ui_defaults={}))[3])

    def ps_lotdsp(r):
        masters(share=r / "share")
        ps = json.loads((r / "share" / "path_settings.json").read_text(encoding="utf-8"))
        ps["rows"].append({"id": 50, "項目": "lotdsp_import.url", "値": ' "http://参照先/lotdsp" '})
        write(r / "share" / "path_settings.json", ps)
        return config(r, lotdsp_import={"url": "http://配った", "direct": {"login_window": True}})
    sc("参照先の LotDsp の URL を重ねる", ps_lotdsp)
    sc("心拍の段が null（Python は /api/config で落ちる）", lambda r: (masters(share=r / "share"), config(r, presence=None))[1])
    sc("max_rows が int() で読めない", lambda r: (masters(share=r / "share"), config(r, ui_defaults={"max_rows": "x"}))[1])
    sc("LotDsp の待つ秒が読めない", lambda r: (masters(share=r / "share"), config(r, lotdsp_import={"url": "u", "direct": {"timeout_seconds": "長い"}}))[1])
    sc("LotDsp の学びの形が違う", lambda r: (masters(share=r / "share"),
                                       write(r / "local" / "lotdsp_api_map.json", {"actual": {"list": "e", "cols": {"equipment": {"cands": "ab", "seen": "多い"}}}}),
                                       config(r))[2])
    def tree_data(r):
        masters(share=r / "share")
        import sqlite3
        db = r / "品質.sqlite3"
        con = sqlite3.connect(db)
        con.execute("CREATE TABLE 品質 (ロットNo TEXT, 設備 TEXT, 合金 TEXT)")
        con.executemany("INSERT INTO 品質 VALUES (?, ?, ?)", [("A1", "CR1", "x"), ("A2", " L-2 ", "x"), ("A3", "TLV", "y"), ("A4", "", "y"),
                                                                ("A5", "ｃｒ１", "y"), ("A6", "新設備", "z"), ("A7", None, "z")])
        con.commit()
        con.close()
        ps = json.loads((r / "share" / "path_settings.json").read_text(encoding="utf-8"))
        ps["rows"] = [x for x in ps["rows"] if x["項目"] not in ("lot_list.source", "lot_list.table", "schedule.cm3_base_url")]
        write(r / "share" / "path_settings.json", ps)
        ds = json.loads((r / "share" / "data_sources.json").read_text(encoding="utf-8"))
        ds["rows"] = [x for x in ds["rows"] if x.get("キー") != "lot"]
        write(r / "share" / "data_sources.json", ds)
        return config(r, lot_list={"source": str(db), "table": "品質", "refresh_seconds": 60, "stale_hours": 36, "page_size": 300})
    # 窓が品質の一覧を受け持つと Python は品質データを自分で写さない（写しは窓の係）。ここでは Python に写させて、窓と同じ写しで数えさせる
    sc("設備の木（品質データの設備の列・表示しない設備・設備グループ）", tree_data, tree=True, serves=SERVES.replace("lotlist,", ""))
    # 作った後の採点（版 3.85.0）で見つかった割れ: 窓は Python に任せる
    sc("画面の控えの rev が i64 に入らない", lambda r: (masters(share=r / "share"),
                                              (r / "local" / "ui_state.json").write_text('{"rev": 99999999999999999999, "keys": {"tpa.a": "1"}}', encoding="utf-8"),
                                              config(r))[2])
    sc("画面の控えの rev が字の大きな整数", lambda r: (masters(share=r / "share"),
                                              write(r / "local" / "ui_state.json", {"rev": "99999999999999999999", "keys": {}}), config(r))[2])
    sc("画面の控えに対の無い代用字", lambda r: (masters(share=r / "share"),
                                          (r / "local" / "ui_state.json").write_text('{"rev": 2, "keys": {"tpa.a": "x\\ud800y"}}', encoding="utf-8"),
                                          config(r))[2])
    sc("画面の控えに入れ子 130 段", lambda r: (masters(share=r / "share"),
                                         (r / "local" / "ui_state.json").write_text('{"rev": 3, "keys": {"tpa.a": "1"}, "x": ' + "[" * 130 + "]" * 130 + "}",
                                                                                     encoding="utf-8"), config(r))[2])
    sc("LotDsp の学びの cols が null", lambda r: (masters(share=r / "share"),
                                              write(r / "local" / "lotdsp_api_map.json", {"actual": {"list": "e", "cols": None}}), config(r))[2])
    sc("LotDsp の学びの cols が並び", lambda r: (masters(share=r / "share"),
                                              write(r / "local" / "lotdsp_api_map.json", {"design": {"list": "e", "cols": ["a"]}}), config(r))[2])
    sc("初期設定が共有にまだ無い", lambda r: (masters(share=r / "share"), (r / "share" / "ui_defaults.json").unlink(), config(r))[2])

    # 版 3.87.0: データ元の並び（GET /api/sources）。グループ（消した印「-」・マスタの役割）・結合の答えの覚え（今の決まり・try- だけ・
    # 決まりが違う）・参照先の項目のゆれ（ブラウザの欄が空・鍵の無い行・URL の欄が http でない）・スケジュールの設備が並び・端末区分つき
    def sources_rich(r):
        from app.services import data_join
        masters(share=r / "share")
        ds = json.loads((r / "share" / "data_sources.json").read_text(encoding="utf-8"))
        for x in ds["rows"]:
            x.update({"wip": {"グループ": "現場"}, "s5": {"グループ": "-"}, "s6": {"グループ": "現場", "役割": "マスタ"}}.get(x.get("キー"), {}))
        write(r / "share" / "data_sources.json", ds)
        ps = json.loads((r / "share" / "path_settings.json").read_text(encoding="utf-8"))
        ps["rows"] += [{"id": 20, "項目": "lotdsp_import.direct.browser", "値": " "}, {"id": 21, "項目": None, "値": "x"},
                       {"id": 22, "項目": "lotdsp_import.url", "値": "ftp://x"}, {"id": 23, "項目": "update.source", "値": ' "C:\\a" ;\n; D:\\b '}]
        write(r / "share" / "path_settings.json", ps)
        joins = r / "local" / "db_cache" / "joins"
        s1 = next(x for x in ds["rows"] if x.get("キー") == "s1")
        s2 = next(x for x in ds["rows"] if x.get("キー") == "s2")
        write(joins / "s1_aaaa.json", {"items": data_join.parse(s1["結合"]), "builtAt": 10, "seconds": 0.1,
                                       "stats": [{"hit": 3, "rows": 5, "miss": 2, "out": 5}, {"hit": 1, "rows": 5, "miss": 4, "out": 5}]})
        write(joins / "s1_bbbb.json", {"items": [], "builtAt": 99, "stats": [{"hit": 9}]})          # 決まりが違う（使わない）
        # 周回の様子（窓のほかの係が置いた物）: 仕掛は今の元の様子・s5 は元が違う（読まない）。s7 は仕掛と同じファイル（写しを分け合う）
        write(r / "local" / "db_cache" / "sources" / "src_wip.state.json",
              {"remote": "/wip.sqlite3", "at": 1700000000.5, "unreachable": True, "reason": "届きません（試験）"})
        write(r / "local" / "db_cache" / "sources" / "src_s5.state.json", {"remote": "/別の.sqlite3", "at": 1, "unreachable": True, "reason": "古い"})
        ds["rows"].append({"id": 13, "キー": "s7", "表示名": "仕掛と同じ", "場所": "/wip.sqlite3", "並び": "9"})
        write(r / "share" / "data_sources.json", ds)
        write(joins / "try-s2_cccc.json", {"items": data_join.parse(s2["結合"]), "builtAt": 5, "stats": [{"hit": 7, "rows": 8, "miss": 1, "out": 8}]})
        return config(r, schedule={"auto_refresh_sec": 90, "equipments": ["L-1", "L-2:2", "L-1", " "], "hot": {"equipments": ""}})
    sc("データ元の並び（グループ・結合の覚え・項目のゆれ・設備の並び）", sources_rich)
    # ブラウザの欄に値があると Python は trusted_browser で確かめる（窓は Python に任せる）
    def sources_exe(r):
        masters(share=r / "share")
        ps = json.loads((r / "share" / "path_settings.json").read_text(encoding="utf-8"))
        ps["rows"].append({"id": 30, "項目": "lotdsp_import.direct.browser", "値": "C:\\Program Files\\x.exe"})
        write(r / "share" / "path_settings.json", ps)
        return config(r)
    sc("ブラウザの欄に値がある", sources_exe)

    # 版 3.89.0（作った後の採点で見つけた）: 参照先の値を重ねる配った設定の段が表でない（Python の path_settings._set が落ちる）
    def section_null(r):
        masters(share=r / "share")
        ps = json.loads((r / "share" / "path_settings.json").read_text(encoding="utf-8"))
        ps["rows"].append({"id": 31, "項目": "update.source", "値": "C:\\置き場"})
        write(r / "share" / "path_settings.json", ps)
        return config(r, update=None)
    sc("更新の段が null で参照先に更新の置き場", section_null, expect="delegate")
    return out


def ask(s, follows):
    root = s["root"]
    os.environ["TPA_SHELL"] = "desktop"
    os.environ["TPA_SHELL_SERVES"] = s["serves"] or (SERVES.replace(",bundle", "") if follows else SERVES)
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    saved = {k: os.environ.get(k) for k in s["env"]}
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
    # データ元の写しの係（版 3.87.0）: 受け身で、窓へ「写して」と知らせない（知らせると窓の周回を最大 30 秒待つ。場面に窓は居ない）
    from app.services import work_log
    tc["SRC_MIRRORS"] = work_log.Mirrors(root / "local" / "db_cache" / "sources", passive=True, prefix="src", notify=None)
    try:
        app = create_app(tc)
        c = app.test_client()
        r = c.get("/api/lotlist/settings")
        answer = r.get_json() if r.status_code == 200 else None
        reads = page_reads(c, answer, s["tree"], tc["SRC_MIRRORS"])
    except Exception as e:      # Python が束を作れずに落ちる形（窓は Python に尋ねる）
        answer, reads = {"error": repr(e)}, {}
    over = root / "local" / "master_share.json"
    after = json.loads(over.read_text(encoding="utf-8")) if over.exists() else None
    after = {k: after.get(k) for k in ("dir", "history")} if isinstance(after, dict) else None   # 比べるのは置き場と履歴（NaN を渡さない）
    for k, v in saved.items():           # 場面の前の値へ戻す（名乗りの環境はほかの場面にも効く）
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    return answer, after, reads


READS = ("/", "/api/config", "/api/dashboard/sources", "/api/dashboard/equip-tree", "/api/sources", "/api/settings")


def page_reads(c, bundle, tree, mirrors):
    """画面と最初の画面の読む道の答え → {道: {status, body（字）, headers}}。印（nonce）は @NONCE@ に揃える。
    設備の木は tree の場面だけ（届かない品質データの最初の写しを 30 秒待つので）。スケジュールの元に場所があれば尋ねない"""
    out = {}
    srcs = ((bundle or {}).get("lists") or {}).get("sources") or []
    sch = any(d.get("key") == "sch" and d.get("place") for d in srcs)
    for path in READS:
        if path.endswith("equip-tree") and (sch or not tree):
            out[path] = None
            continue
        if path == "/api/sources":
            # どの元も写しの係を作っておく（Python の答えは、そのプロセスが開いた元だけ写しの様子を言う。窓は全部の元で言う）
            ms = mirrors
            # 並びは /api/sources の答えから（束を組めない場面でもデータ元の並びは答える）
            first = c.get(path)
            items = (first.get_json(silent=True) or {}).get("items") or [] if first.status_code == 200 else srcs
            by = {}
            for d in items:             # 同じキーの行が 2 つあれば最初の行（一覧を開く道 data_sources.find と同じ）
                by.setdefault(d.get("key"), d)
            for d in items:
                k = d.get("base") or d.get("key")
                b = by.get(k) or d
                if str(d.get("api") or "").startswith("/api/src/") and d.get("kind") != "cm3" and k != "lot" and b.get("place"):
                    rd = b.get("read") or {}
                    ms.get(k, b["place"], rd.get("refresh_seconds", 60), rd.get("stale_hours", 36))
        r = c.get(path)
        csp = r.headers.get("Content-Security-Policy") or ""
        m = re.search(r"nonce-([A-Za-z0-9_-]+)", csp)
        text = r.get_data(as_text=True)
        if m:
            text, csp = text.replace(m.group(1), "@NONCE@"), csp.replace(m.group(1), "@NONCE@")
        out[path] = {"status": r.status_code, "body": text,
                     "headers": {k: r.headers.get(k) for k in ("Content-Type", "Cache-Control") if r.headers.get(k)} | ({"Content-Security-Policy": csp} if csp else {})}
    return out


def main():
    logging.disable(logging.CRITICAL)
    work = Path(sys.argv[1])
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    out = []
    for s in scenarios(work):
        keep = work / "_keep"
        shutil.copytree(s["root"], keep)
        answer, after, reads = ask(s, s["pyFollows"])
        shutil.rmtree(s["root"])
        shutil.move(str(keep), s["root"])          # 尋ねる前の形へ戻す（窓は同じフォルダから組む）
        root = s["root"]
        # 窓が Python に尋ねる場面の答えは比べない（NaN を含むと JSON で渡せない）
        out.append({"name": s["name"], "expect": s["expect"], "pyFollows": s["pyFollows"],
                    "answer": answer if s["expect"] == "same" else None, "override": after, "reads": reads,
                    "expectOverride": str(root / s["expectOverride"]) if s["expectOverride"] else None,
                    "env": {"base": str(root / "base"), "program": s["program"] or str(PROGRAM), "local": str(root / "local"),
                            "config": str(root / "config.json"),
                            "now": s["now"]},
                    "vars": {k: (str(root) if v == "@root" else v) for k, v in s["env"].items()}})
    json.dump({"scenarios": out}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
