# -*- coding: utf-8 -*-
"""スケジュール（CM3）の正しい答えを出す係（版 3.96.0。desktop/tests/schedule_parity.rs が呼ぶ）。

  python tests/schedule_oracle.py serve <置き場>     … 作り物の CM3（schedule_fixture.Cm3Server）を起こし、場面ごとに Python の道
                                                      （窓の無い形＝Python が係）で問い合わせの並びを当てた答え・置いた世代と状態のファイル・
                                                      CM3 が受けた要求を JSON の 1 行で書き、標準入力が閉じるまで CM3 を起こしたままにする
                                                      （窓が同じ作り物に問い合わせる。道の頭 /py/・/rs/ で数えを分ける）
  python tests/schedule_oracle.py passive <置き場> <URL> [設定に足す JSON]  … 受け身の Python の係（窓が名乗った形）。標準入力の 1 行ごとに
                                                      「p」で取り直しを頼み（知らせは {"event": "schedule", …} の行で書く）、答えを {"result": …} の行で書く
  python tests/schedule_oracle.py codecs               … CP932・Shift_JIS・CP1252・UTF-8 の 1・2 バイトの全部と、乱れたバイト列の読み、
                                                      charset の名前の引き方の答え（窓の焼いた表とその読み方を Python と比べる）

場面: 届く（一覧・スライサー・集計・データの時刻・再読込・HOT・釜番・仕掛との結合・設備の木・ダッシュボードのパネル・結合した表）・
届かない・黙る・接続の timeout・名前が引けない・断る（500）・30x（302 の GET・301 の絶対の URL・307・ぐるぐる）・chunked と HTTP/1.1・
HTTP/1.0 の閉じるまで・charset（Shift_JIS・cp932・引用符つき・無し・ISO-8859-1）・JSON でない・文字化けと HTML の壊れ方・
答えの形の端（status・entity・errorMessage・年の境・全角の数字・読めない日付・数の値）・中身が変わる（世代）・
Python に任せる形（窓の持たない charset・NaN の答え・https・システムのプロキシ・数でない timeout）。
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import socket
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from tests import lotlist_fixture, schedule_fixture as fx  # noqa: E402
from tests.equipgroups_oracle import LOGIN, doc, j, perm  # noqa: E402

JST = timezone(timedelta(hours=9))
WINDOWS = os.name == "nt"           # Windows でだけ窓が Python に任せる歩
SCH = "/api/src/sch"


def S(path, query="", method="GET", body="", delegate=False):
    return {"method": method, "path": path, "query": query, "body": body, "delegate": delegate}


def small_rows(update):
    """charset・文字の場面の小さな予定（cp932 で書ける字だけ）"""
    t = update
    rows = []
    for i, (lot, yoto) in enumerate([("A1001", "缶～材"), ("A1002", "一般用材"), ("A1001", "箔地－用"), ("A1003", "点検板")]):
        t += timedelta(minutes=20)
        rows.append(fx._row(f"{t.month:02d}/{t.day:02d} {t.hour:02d}:{t.minute:02d}" if i % 2 == 0 else f"     {t.hour:02d}:{t.minute:02d}",
                            lotNo=lot, zaishitsu="A1100", inItaAtsu="1.200", outItaAtsu="0.900", reienHaba="1250", seihinItaAtsu="0.900",
                            seihinItaHaba="1240", keijo="C", yotoMei=yoto, jiKotei="L-2"))
    t += timedelta(minutes=7)
    rows.append(fx._row(f"     {t.hour:02d}:{t.minute:02d}", roll="段取", lotNo="り替え", inItaAtsu="15分", teisiStyle="cmschview-teisi"))
    return rows


def answer(eq, rows, update):
    return {"status": "SUCCESS", "entity": {"setsubiName": eq, "termKbn": "4", "updateTs": int(update.timestamp() * 1000), "error": False,
                                            "errorMessage": "", "meisaiList": rows}}


def moji_cp932(s):
    """CP932 のバイトを Latin-1 で読んだ字"""
    return s.encode("cp932").decode("latin-1")


def html_rows(update):
    """文字化けと HTML の壊れ方（fix_text のすべての道）"""
    vals = ["&#128;材", "&ampx缶", "&notit;", "<b>太</b>字<br>", "&#xD800;x", "&#1;y", "&#x3000", "&zz;", "a&#;b", "<>", "&lt;A&gt;",
            moji_cp932("缶材"), "缶材".encode("utf-8").decode("latin-1"), "　両端　", "\x1c空白\x1f", "&#12288;全角", "Ã©"]
    rows = []
    t = update
    for i, v in enumerate(vals):
        t += timedelta(minutes=15)
        rows.append(fx._row(f"{t.month:02d}/{t.day:02d} {t.hour:02d}:{t.minute:02d}", lotNo=f"H{i:03d}", zaishitsu=v, inItaAtsu="1.0",
                            outItaAtsu="0.5", reienHaba="1000", seihinItaAtsu="0.5", seihinItaHaba="990", keijo="S", yotoMei=v, jiKotei=v))
    t += timedelta(minutes=5)
    rows.append(fx._row(f"{t.month:02d}/{t.day:02d} {t.hour:02d}:{t.minute:02d}", roll="<i>ロール</i>", lotNo="&amp;交換", zaishitsu=moji_cp932("計画"),
                        inItaAtsu="１０分", teisiStyle="x"))
    return rows


def shape_answers(update):
    """答えの形の端（設備ごと）"""
    ts = int(update.timestamp() * 1000)
    dec = int(datetime(2026, 12, 30, 8, 0, tzinfo=JST).timestamp() * 1000)
    rows = small_rows(update)
    edge = [fx._row("12/31 23:50", lotNo="Y1", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("00:10", lotNo="Y2", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("01/01 01:00", lotNo="Y3", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("０１/０２ ０２:０５", lotNo="Y4", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("02/30 10:00", lotNo="Y5", zaishitsu="A", inItaAtsu="1", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("25:00", lotNo="Y6", zaishitsu="A", inItaAtsu="0", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("", lotNo="Y7", zaishitsu="A", inItaAtsu="abc", outItaAtsu="0.5", reienHaba="1", keijo="C"),
            fx._row("   ", lotNo="Y8", zaishitsu="A", inItaAtsu="1e2", outItaAtsu="", reienHaba="1", keijo="C")]
    nums = [{"kanryoYotei": "10/03 09:00", "lotNo": 12345, "zaishitsu": "A1100", "inItaAtsu": 0.3, "outItaAtsu": 0.2, "reienHaba": 1250,
             "seihinItaAtsu": 0.2, "seihinItaHaba": 1240, "keijo": True, "yotoMei": "x", "jiKotei": "S9", "rowStyle": None},
            {"kanryoYotei": "10/03 09:30", "lotNo": 12345.0, "zaishitsu": "A1100", "inItaAtsu": "0.2", "outItaAtsu": "0.1", "reienHaba": "1",
             "keijo": "C", "yotoMei": "x"},
            {"kanryoYotei": "10/03 10:00", "roll": 7.5, "lotNo": 1e16, "zaishitsu": "分", "inItaAtsu": "30分", "keijo": None, "x": [1]}]
    return {
        "S1": {"status": "FAIL", "entity": {}},
        "S2": {"status": ["a", 1, None, True, 2.5], "entity": {}},
        "S3": {"status": "SUCCESS", "entity": {"error": True, "errorMessage": 5}},
        "S4": [1, 2],
        "S5": {"status": "SUCCESS", "entity": {"error": 1, "errorMessage": "&lt;止&gt;　"}},
        "S6": {"status": "SUCCESS", "entity": {"setsubiName": "", "termKbn": 4, "updateTs": dec, "meisaiList": edge}},
        "S7": {"status": "SUCCESS", "entity": {"setsubiName": "S7", "updateTs": str(ts), "meisaiList": rows}},
        "S8": {"status": "SUCCESS", "entity": {"setsubiName": "S8", "updateTs": "abc", "meisaiList": []}},
        "S9": {"status": "SUCCESS", "entity": {"setsubiName": "S9", "updateTs": ts + 0.7, "meisaiList": nums}},
        "SA": {"status": "SUCCESS", "entity": None},
        "SB": {"status": "SUCCESS", "entity": {"error": True, "errorMessage": ""}},
        "SC": {"status": "SUCCESS", "entity": {"updateTs": -1000, "meisaiList": None}},
        "SD": {"status": "SUCCESS", "entity": {"updateTs": 33_000_000_000_000, "meisaiList": rows}},        # 3015 年
        "SE": {"status": "SUCCESS", "entity": {"updateTs": -100_000_000_000_000, "meisaiList": None}},   # 1 年より前（どの OS でも None）
    }


class World:
    """場面の答え（作り物の CM3 の handler）"""

    def __init__(self, wip):
        self.update = datetime(2026, 10, 3, 8, 5, tzinfo=JST)
        self.full = fx.responses(wip)
        self.small = {eq: answer(eq, small_rows(self.update), self.update) for eq in ("L-1", "L-2", "L-3")}
        self.html = answer("L-1", html_rows(self.update), self.update)
        self.shapes = shape_answers(self.update)
        self.port = 0

    def __call__(self, scene, req, k):  # noqa: C901 (場面の振り分け)
        eq, runner = req["equip"], req["path"].split("/")[1]
        base = f"/{runner}/{scene}"
        if scene in ("ok", "concurrent"):
            return fx.json_reply(self.full.get(eq) or {"status": "SUCCESS", "entity": {}})
        if scene == "change":                         # 問い合わせごとに中身が変わる（新しい世代）
            a = json.loads(json.dumps(self.full[eq]))
            a["entity"]["meisaiList"] = a["entity"]["meisaiList"][(k - 1) % 3:]
            a["entity"]["updateTs"] += k * 60000
            return fx.json_reply(a)
        if scene == "flip":                           # 2 回目だけ NaN（窓は 1 回だけ降り、受け身の Python が取る）。ほかは回ごとに中身が変わる
            a = json.loads(json.dumps(self.full[eq]))
            a["entity"]["meisaiList"] = a["entity"]["meisaiList"][(k - 1) % 4:]
            a["entity"]["updateTs"] += k * 60000
            if k == 2:
                return fx.reply(body=json.dumps({**a, "x": float("nan")}), headers=[("Content-Type", "application/json")])
            return fx.json_reply(a)
        if scene == "chunk11":
            return fx.json_reply(self.small[eq], chunked=True)
        if scene == "http10":
            return fx.json_reply(self.small[eq], version="HTTP/1.0", length=False)
        if scene == "sjis":
            return fx.json_reply(self.small[eq], charset="Shift_JIS", encoding="cp932", chunked=True)
        if scene == "cp932":
            return fx.json_reply(self.small[eq], charset=None, encoding="cp932")
        if scene == "quoted":
            return fx.reply(body=json.dumps(self.small[eq], ensure_ascii=False).encode("utf-8"),
                            headers=[("Content-Type", 'application/json; charset="UTF-8"')])
        if scene == "latin":
            return fx.json_reply(self.small[eq], charset="ISO-8859-1")
        if scene == "winj":
            return fx.json_reply(self.small[eq], charset="Windows-31J", encoding="cp932")
        if scene == "eucjp":                        # EUC-JP に無い「～」は「〜」にして書く
            a = json.loads(json.dumps(self.small[eq]).replace("\\uff5e", "\\u301c").replace("\\uff0d", "\\u2212"))
            return fx.json_reply(a, charset="EUC-JP", encoding="euc_jp")
        if scene == "html":
            return fx.json_reply(self.html)
        if scene == "shapes":
            return fx.json_reply(self.shapes.get(eq, {}))
        if scene == "nan":
            return fx.reply(body=json.dumps({**self.small[eq], "x": float("nan")}), headers=[("Content-Type", "application/json")])
        if scene == "nojson":
            return fx.reply(body="hello 1e3", headers=[("Content-Type", "text/plain")])
        if scene == "e500":
            return fx.reply(500, "Internal Server Error", b"<html>oops</html>", [("Content-Type", "text/html")])
        if scene == "e404":
            return fx.reply(404, "Not  Found ", b"", [])
        if scene == "r302json":
            if req["method"] == "POST":
                return fx.reply(302, "Found", b"", [("Location", f"{base}/next?eq={eq}")])
            return fx.json_reply(self.small[eq])
        if scene == "r302html":
            if req["method"] == "POST":
                return fx.reply(302, "Found", b"", [("Location", f"{base}/page")])
            return fx.reply(body="<html><body>login</body></html>", headers=[("Content-Type", "text/html; charset=utf-8")])
        if scene == "r301abs":
            if req["method"] == "POST":
                return fx.reply(301, "Moved Permanently", b"", [("Location", f"http://127.0.0.1:{self.port}{base}/next?eq={eq}")])
            return fx.json_reply(self.small[eq], chunked=True)
        if scene == "r303then307":
            if req["method"] == "POST":
                return fx.reply(303, "See Other", b"", [("Location", f"{base}/a?eq={eq}")])
            if "/a?" in req["path"]:
                return fx.reply(307, "Temporary Redirect", b"", [("Location", f"{base}/b?eq={eq}")])
            return fx.json_reply(self.small[eq])
        if scene == "r307":
            return fx.reply(307, "Temporary Redirect", b"", [("Location", f"{base}/next")])
        if scene == "rloop":
            return fx.reply(302, "Found", b"", [("Location", f"{base}/loop")])
        if scene == "rnoloc":
            return fx.reply(302, "Found", b"", [])
        if scene == "silent":
            return ("sleep", 2.5)
        if scene == "closed":                       # 何も言わずに閉じる
            return None
        return fx.reply(404, "Not Found", b"", [])


def place(root, cfg_schedule, sources_rows=None, wip=None):
    share, data = root / "share", root / "base" / "data"
    for d in (share, data, root / "local"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    masters = {"access_permissions": perm(), "equipment_groups": [], "work_log_files": [], "equipment_master": [],
               "data_sources": sources_rows or [], "path_settings": [], "conversions": [], "shift_patterns": []}
    for name, rows in masters.items():
        (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    cfg = {"lot_list": {"source": str(root / "無い品質.sqlite3"), "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"}, "schedule": cfg_schedule,
           "sources": {"wip": {"source": str(wip), "table": "仕掛"}},
           "master_share": {"dir": str(share), "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


VIEW = [{"キー": "v1", "表示名": "予定と仕掛", "役割": "その他", "場所": "", "表": "", "設備の列": "", "設備の取り出し方": "", "画面": "有",
         "並び": "", "備考": "", "グループ": "", "元": "sch", "確かめる間隔": "", "古さの警告": "", "ロット番号の列": "", "id": 1, "rev": 1,
         "結合": json.dumps([{"with": "wip", "how": "inner", "on": [["ロットNo", "ﾛｯﾄ番号"]], "cols": ["実績_設備ｺｰｽ"]}], ensure_ascii=False)}]

PANEL = {"id": "t1", "title": "", "visual": "bar", "source": "src:sch",
         "body": {"rows": [{"column": "区分", "part": ""}], "cols": [], "measures": [{"agg": "count"}]}}
BOARD = {"id": "b9", "title": "表", "visual": "board",
         "groups": [{"source": "src:sch", "cols": [{"column": "区分", "part": ""}], "measures": [{"agg": "count"}]},
                    {"source": "src:sch", "cols": [{"column": "材質", "part": ""}], "measures": [{"agg": "count"}]}]}
KPI = {"id": "k1", "title": "", "visual": "kpi", "source": "src:sch", "body": {"rows": [], "cols": [], "measures": [{"agg": "count"}]}}

LIST_STEPS = [S("/api/schedule"), S("/api/schedule/card"), S(SCH, "equip=L-1"), S(SCH, "equip=L-2&page=1&page_size=10"),
              S(f"{SCH}/slicer", "equip=L-1&column=区分"), S(f"{SCH}/pivot", "equip=L-1&fields=1"),
              S(f"{SCH}/source", "equip=L-1"), S(SCH, "equip=__HOT__"), S(f"{SCH}/source", "equip=__HOT__"), S("/api/schedule/card"),
              S("/api/schedule"), S(f"{SCH}/refresh", "equip=L-1", "POST"), S(SCH), S(SCH, "equip=ZZ"), S(f"{SCH}/source", "equip=ZZ"),
              S("/api/dashboard/equip-tree"), S("/api/dashboard/query", method="POST", body=j({"panel": PANEL})),
              S("/api/dashboard/query", method="POST", body=j({"panel": BOARD})), S("/api/dashboard/query", method="POST", body=j({"panel": KPI})),
              S("/api/src/v1"), S("/api/src/v1/source"), S("/api/src/v1/refresh", method="POST"),
              S(SCH, "equip=__HOT__&search=HOT"), S(f"{SCH}/pivot", "equip=__HOT__&fields=1")]
ONE = [S(SCH, "equip=L-1"), S(SCH, "equip=L-1"), S(f"{SCH}/source", "equip=L-1"), S("/api/schedule/card")]
SHAPES = [S(SCH, f"equip={e}") for e in ("S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "SA", "SB")] + \
         [S("/api/schedule/card"), S(f"{SCH}/source", "equip=S9"), S(f"{SCH}/source", "equip=S7")]


def scenes(world_port, blackhole):
    u = lambda name: f"http://127.0.0.1:{world_port}/{{runner}}/{name}"  # noqa: E731
    base = {"equipments": "L-1, L-2, L-3", "timeout_sec": 2, "auto_refresh_sec": 60}
    out = [
        ("届く（一覧・HOT・釜番・結合・設備の木・パネル・結合した表）", {**base, "cm3_base_url": u("ok")}, LIST_STEPS, VIEW),
        ("中身が変わる（世代）", {**base, "cm3_base_url": u("change")},
         [S(SCH, "equip=L-1"), S(f"{SCH}/refresh", "equip=L-1", "POST"), S(f"{SCH}/refresh", "equip=L-1", "POST"),
          S(f"{SCH}/refresh", "equip=L-1", "POST"), S(SCH, "equip=L-1"), S(SCH, "equip=__HOT__"), S(f"{SCH}/refresh", "equip=__HOT__", "POST"),
          S(SCH, "equip=__HOT__")], None),
        # 断られる口: Windows は断られるまで 2 秒ほど取り直すので、timeout は長く（接続の timeout にならないように）
        ("届かない（断られる）", {**base, "timeout_sec": 10, "cm3_base_url": "http://127.0.0.1:1"}, ONE + [S(SCH, "equip=__HOT__"), S("/api/dashboard/equip-tree"),
                                                                                     S(f"{SCH}/refresh", "equip=L-2", "POST")], None),
        ("黙る（読みの timeout）", {**base, "timeout_sec": 1, "cm3_base_url": u("silent")}, ONE[:1] + [S(f"{SCH}/source", "equip=L-1")], None),
        ("接続の timeout", {**base, "timeout_sec": 1, "cm3_base_url": f"http://127.0.0.1:{blackhole}"}, ONE[:1], None),
        ("名前が引けない", {**base, "cm3_base_url": "http://nonexistent.invalid:9085"}, ONE[:1], None),
        ("何も言わずに閉じる", {**base, "cm3_base_url": u("closed")}, ONE[:1], None),
        ("断る（500・404）", {**base, "cm3_base_url": u("e500")}, ONE[:1] + [S("/api/schedule")], None),
        ("404 と理由の空白", {**base, "cm3_base_url": u("e404")}, ONE[:1], None),
        ("JSON でない", {**base, "cm3_base_url": u("nojson")}, ONE[:1], None),
        ("302 → GET の JSON", {**base, "cm3_base_url": u("r302json")}, ONE, None),
        ("302 → HTML", {**base, "cm3_base_url": u("r302html")}, ONE[:1], None),
        ("301 の絶対の URL・chunked", {**base, "cm3_base_url": u("r301abs")}, ONE[:1], None),
        ("303 → 307（GET はたどる）", {**base, "cm3_base_url": u("r303then307")}, ONE[:1], None),
        ("307（POST はたどらない）", {**base, "cm3_base_url": u("r307")}, ONE[:1], None),
        ("30x のぐるぐる", {**base, "cm3_base_url": u("rloop")}, ONE[:1], None),
        ("30x の行き先が無い", {**base, "cm3_base_url": u("rnoloc")}, ONE[:1], None),
        ("chunked・HTTP/1.1", {**base, "cm3_base_url": u("chunk11")}, ONE[:1], None),
        ("HTTP/1.0・閉じるまで", {**base, "cm3_base_url": u("http10")}, ONE[:1], None),
        ("charset=Shift_JIS（～ は 〜）", {**base, "cm3_base_url": u("sjis")}, ONE[:1], None),
        ("charset 無しの CP932", {**base, "cm3_base_url": u("cp932")}, ONE[:1], None),
        ("charset=Windows-31J", {**base, "cm3_base_url": u("winj")}, ONE[:1], None),
        ("引用符つきの charset", {**base, "cm3_base_url": u("quoted")}, ONE[:1], None),
        ("charset=ISO-8859-1（文字化けを戻す）", {**base, "cm3_base_url": u("latin")}, ONE[:1], None),
        ("文字化けと HTML の壊れ方", {**base, "equipments": "L-1", "cm3_base_url": u("html")}, ONE[:1], None),
        ("答えの形の端", {**base, "equipments": "S1 S2 S3 S4 S5 S6 S7 S8 S9 SA SB", "inspect_keywords": "点検板、Y7",
                       "cm3_base_url": u("shapes")}, SHAPES, None),
        # 1970 年より前・3000 年から後の更新時刻: Windows の gmtime_s（UCRT）が受けるかは CPython のソースで決まらない（CI で −1 秒を受けた）ので、
        # Windows では窓が答えず Python に任せる。1 年より前（どの OS でも None）は窓が答える
        ("1970 年より前・3000 年から後の更新時刻", {**base, "equipments": "SC SD SE", "cm3_base_url": u("shapes")},
         [S(SCH, "equip=SC", delegate=WINDOWS), S(SCH, "equip=SD", delegate=WINDOWS), S(SCH, "equip=SE")], None),
        ("URL に種類が無い", {**base, "cm3_base_url": "nlmfangyweb1a:9085"}, ONE[:1], None),
        ("URL が決まっていない", {**base, "cm3_base_url": "", "init_path": "", "client_ip": 0}, ONE[:1], None),
        ("設備が無い", {**base, "equipments": "、", "cm3_base_url": u("ok")}, [S(SCH), S("/api/schedule"), S("/api/schedule/card")], None),
        # Python に任せる形（窓は答えず、状態に「係を降りた」を書く）
        ("窓の持たない charset（EUC-JP）", {**base, "cm3_base_url": u("eucjp")}, [S(SCH, "equip=L-1", delegate=True)], None),
        ("NaN の答え", {**base, "cm3_base_url": u("nan")}, [S(SCH, "equip=L-1", delegate=True)], None),
        ("https", {**base, "cm3_base_url": "https://127.0.0.1:1"}, [S(SCH, "equip=L-1", delegate=True), S(f"{SCH}/source", "equip=L-1", delegate=True)], None),
        ("システムのプロキシ", {**base, "use_system_proxy": True, "cm3_base_url": u("ok")}, [S(SCH, "equip=L-1", delegate=True)], None),
        ("数でない timeout", {**base, "timeout_sec": "abc", "cm3_base_url": u("ok")}, [S(SCH, "equip=__HOT__", delegate=True)], None),
    ]
    return out


def run(root, steps, runner):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
    c = app.test_client()
    out = []
    for st in steps:
        path = st["path"] + (f"?{st['query']}" if st["query"] else "")
        try:
            r = c.open(path, method=st["method"], data=st["body"].encode("utf-8"), content_type="application/json")
            try:
                body = r.get_json()
            except Exception:
                body = None
            out.append({**st, "status": r.status_code, "json": body})
        except Exception as e:      # 道の外で落ちた（本番は 500）
            out.append({**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}"}})
    return out


def files(root):
    """置き場の世代（表の中身）と状態のファイル（書き手の印は rs/py を「w」にそろえる）"""
    import sqlite3
    d = root / "local" / "db_cache" / "schedule"
    out = {}
    for p in sorted(d.glob("*")) if d.exists() else []:
        name = p.name.replace(".py.", ".w.").replace(".rs.", ".w.")
        if p.name.endswith(".sqlite3"):
            c = sqlite3.connect(str(p))
            try:
                t = c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchone()[0]
                cur = c.execute(f'SELECT * FROM "{t}"')
                cols = [x[0] for x in cur.description]
                rows = [[[type(v).__name__, v] for v in r] for r in cur.fetchall()]
            finally:
                c.close()
            out[name] = {"table": t, "cols": cols, "rows": rows}
        elif p.name.endswith(".state.json"):
            out[name] = json.loads(p.read_text(encoding="utf-8"))
    return out


def blackhole():
    """接続を受けない口（待ち行列を埋めた listen。SYN が捨てられ、接続が timeout する）"""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(0)
    held = socket.socket()
    held.settimeout(0.5)
    try:
        held.connect(s.getsockname())
    except OSError:
        pass
    for _ in range(3):
        x = socket.socket()
        x.settimeout(0.3)
        try:
            x.connect(s.getsockname())
        except OSError:
            pass
    return s, held


def serve(base):
    logging.disable(logging.WARNING)
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True)
    wip = base / "LOTNOW.sqlite3"
    lotlist_fixture.make_wip(str(wip), n=400)
    fx.add_kama(wip)
    world = World(wip)
    srv = fx.Cm3Server(world)
    world.port = srv.port
    bh, held = blackhole()
    out = []
    for i, (name, sched, steps, src_rows) in enumerate(scenes(srv.port, bh.getsockname()[1])):
        py, rs = base / f"s{i}" / "py", base / f"s{i}" / "rs"
        for r, runner in ((py, "py"), (rs, "rs")):
            sc = {k: (v.replace("{runner}", runner) if isinstance(v, str) else v) for k, v in sched.items()}
            place(r, sc, src_rows, wip)
        got = run(py, steps, "py")
        scene = sched.get("cm3_base_url", "").split("/")[-1] if "{runner}" in str(sched.get("cm3_base_url")) else ""
        out.append({"name": name, "py": str(py), "rs": str(rs), "scene": scene, "steps": got, "files": files(py),
                    "requests": srv.requests("py", scene) if scene else [],
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    sys.stdout.write(json.dumps({"scenarios": out, "cm3": srv.url, "port": srv.port}, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()
    # 窓が同じ作り物に問い合わせる間は起こしておく。窓の側の要求は「requests rs <場面>」で尋ねられる
    for line in sys.stdin:
        cmd = line.split()
        if cmd[:1] == ["requests"]:
            sys.stdout.write(json.dumps(srv.requests(cmd[1], cmd[2]), ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()
        elif cmd[:1] == ["count"]:
            with srv.lock:
                n = sum(1 for (ru, sc, _r) in srv.log if ru == cmd[1] and sc == cmd[2])
            sys.stdout.write(json.dumps(n) + "\n")
            sys.stdout.flush()
    srv.close()
    bh.close()
    held.close()


def passive(root, url, extra="{}"):
    """受け身の Python の係（窓が schedule を名乗った形）。p で取り直しを頼み、窓が状態を書くのを待つ。
    extra: 設定に足す項目（JSON。use_system_proxy なら、この試験の環境のプロキシは外す＝作り物の CM3 に直に届く）"""
    from app.services import schedule
    more = json.loads(extra)
    if more.get("use_system_proxy"):
        for k in list(os.environ):
            if k.lower().endswith("_proxy"):
                del os.environ[k]
    lock = threading.Lock()

    def say(v):
        with lock:
            sys.stdout.write(json.dumps(v, ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()
    s = schedule.Schedules(Path(root), passive=True, notify=lambda **kw: say({"event": "schedule", **kw}))
    cfg = schedule.config({"schedule": {"cm3_base_url": url, "equipments": "L-1, L-2, L-3", "timeout_sec": 2, "auto_refresh_sec": 60, **more}})
    say({"ready": True})
    for line in sys.stdin:
        if line.strip() != "p":
            continue
        try:
            st = s.ensure(cfg, "L-1", max_age=0, force=True)
            say({"result": {"path": st.get("path"), "error": st.get("error", "")}})
        except Exception as e:
            say({"result": {"error": f"{type(e).__name__}: {e}"}})


def codecs_answer():
    """字の読みの全部（窓の焼いた表の読み方と比べる）"""
    import codecs
    import random
    out = {}
    for enc in ("cp932", "shift_jis", "cp1252"):
        one = []
        for b in range(256):
            try:
                one.append(bytes([b]).decode(enc))
            except UnicodeDecodeError:
                one.append(None)
        two = {}
        if enc != "cp1252":
            for lead in range(0x80, 0x100):
                row = []
                for t in range(0x100):
                    try:
                        row.append(bytes([lead, t]).decode(enc))
                    except UnicodeDecodeError:
                        row.append(None)
                two[f"{lead:02X}"] = row
        out[enc] = {"one": one, "two": two}
    r = random.Random(3)
    samples = [bytes(r.randrange(256) for _ in range(r.randrange(1, 12))) for _ in range(4000)]
    samples += [b"\xe3\x81", b"\xf0\x9f\x98", b"\xed\xa0\x80", b"\xc0\xaf", b"a\xffb\xfe", b"\xe3\x81\x82\xe3"]
    out["utf8"] = [[s.hex(), (lambda: s.decode("utf-8"))() if _ok(s) else None, s.decode("utf-8", errors="replace")] for s in samples]
    names = ["UTF-8", "utf8", "u8", "Shift_JIS", "SJIS", "x-sjis", "MS932", "Windows-31J", "cp-932", "CP932", "ISO-8859-1", "latin1",
             "L1", "US-ASCII", "ascii", "EUC-JP", "utf-16", "utf_8_sig", "utf--8", "_utf8", "utf8_", "Ütf8", "utf_é8", "ksc5601", "koi8-r",
             "ShiftJIS", "s_jis", "ISO_8859_1", "8859", "iso-2022-jp", "windows-1252", "cp1252", "big5", "x"]
    lk = {}
    for n in names:
        try:
            lk[n] = codecs.lookup(n).name
        except LookupError:
            lk[n] = None
    out["lookup"] = lk
    import re
    cts = ["application/json;charset=UTF-8", "text/html; Charset=Shift_JIS", "a; charset=;charset=euc-jp", 'x; charset="utf-8"',
           "charset=ÿé-x", "CHARSET=utf_8 ;", "charset", "", "a;charset=µx"]
    out["charset"] = {c: (m.group(1) if (m := re.search(r"charset=([\w\-]+)", c, re.I)) else None) for c in cts}
    return out


def _ok(s):
    try:
        s.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def main():
    mode = sys.argv[1]
    if mode == "serve":
        serve(Path(sys.argv[2]))
    elif mode == "passive":
        passive(sys.argv[2], sys.argv[3], *sys.argv[4:5])
    elif mode == "codecs":
        sys.stdout.write(json.dumps(codecs_answer(), ensure_ascii=False))


if __name__ == "__main__":
    main()
