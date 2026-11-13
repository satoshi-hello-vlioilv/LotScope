# -*- coding: utf-8 -*-
"""設備グループの道の「正しい答え」を出す係（版 3.94.0。desktop/tests/equipgroups_write_parity.rs が呼ぶ）。

    python tests/equipgroups_oracle.py 作業フォルダ

場面ごとに同じ中身の置き場を 3 つ（py・rs・pd）作り、py に Python の道（routes/equipgroups.py の 4 本。門番 _access_guard を含む）で
問い合わせの並びを当てる。窓の試験は rs に同じ並びを本物の窓の道（Lot::handle_body → equipgroups_route）で当て、答え（状態・本文）と
できたファイル（設備グループ）を突き合わせる。窓が答えず Python に任せる歩（delegates）は pd に当てる。
選べる設備（seen: 作業実績 → 設備マスタ → データ元の設備の列）を数えるため、どの場面にも設備の列のあるデータ元（SQLite。写しが済む元）と、
届かない元（ファイルが無い。数えずに飛ばす元）を置く。
ファイルの突き合わせは共有（share）と同梱の data/ だけで、この PC の写し（local/master_cache）は比べない（窓は数えるために読んだマスタの写しを置かず、
直すの誤りや錠では設備グループの写しも置かない。これまでの窓の道と同じ扱い）。共有・data/ に置かれたマスタのファイルの名前は、全部の場面で比べる。
"""
import json
import logging
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity  # noqa: E402
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

LOGIN = identity.current_login_id()


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def perm(role="開発者", edit="編集可"):
    return [{"id": 1, "ログインID": LOGIN, "PC名": "", "権限区分": role, "マスタ編集": edit, "有効": "有", "rev": 1}]


def lock_doc():
    n = datetime.now()
    return {"token": "t", "holder_pc": "PC-8", "holder_login": "u8", "holder_instance": "z:1",
            "acquired_at": n.isoformat(timespec="seconds"), "expires_at": (n + timedelta(seconds=600)).isoformat(timespec="seconds")}


def rules(*rs, ex=None):
    return j({"rules": [{"op": o, "value": v} for o, v in rs], **({"except": ex} if ex else {})})


def base_rows():
    """まとめ方 2 つ（ライン別・工場）と、まとめ方が空の行（グループ）。ルールのグループ（L- で始まる・L-9 を除く）"""
    return [{"id": 1, "名称": "CR ライン", "まとめ方": "ライン別", "設備": "CR1,CR2", "ルール": "", "表示順": "10", "備考": "", "rev": 2},
            {"id": 2, "名称": "L ライン", "まとめ方": "ライン別", "設備": "", "ルール": rules(("prefix", "L-"), ex=["L-9"]), "表示順": "20", "rev": 1},
            {"id": 3, "名称": "全部", "まとめ方": "", "設備": "TLV, VC", "表示順": "", "rev": 3},
            {"id": 4, "名称": "ｃｒ ライン", "まとめ方": "工場", "設備": "CR1", "ルール": rules(("contains", "V"), ("suffix", "-2")),
             "表示順": "5", "備考": "メモ", "rev": 1}]


WORK = [{"id": 1, "キー": "w1", "設備名": "CR1", "ファイル名": "実績_CR1.db", "表示": "有", "並び": "2"},
        {"id": 2, "キー": "w2", "設備名": "L-1", "ファイル名": "実績_L1.db", "表示": "無", "並び": "1"},
        {"id": 3, "キー": "w3", "設備名": " ", "並び": ""}, {"id": 4, "キー": "w4", "設備名": "cr1 ", "並び": "x"}]
EQUIP = [{"id": 1, "設備名": "TLV"}, {"id": 2, "設備名": "CR1"}, {"id": 3, "設備名": "ＣＲ２"}, {"id": 4, "設備名": None}]


def sources(root):
    return [{"id": 1, "キー": "eq", "表示名": "仕掛", "場所": str(root / "仕掛.sqlite3"), "表": "仕掛", "設備の列": "設備", "並び": "1"},
            {"id": 2, "キー": "nf", "表示名": "届かない元", "場所": str(root / "無い.sqlite3"), "設備の列": "設備", "並び": "2"},
            {"id": 3, "キー": "ne", "表示名": "設備の列の無い元", "場所": str(root / "仕掛.sqlite3"), "表": "仕掛", "並び": "3"}]


def data_file(root):
    con = sqlite3.connect(root / "仕掛.sqlite3")
    con.execute("CREATE TABLE 仕掛 (ロットNo TEXT, 設備 TEXT, 重量 REAL)")
    con.executemany("INSERT INTO 仕掛 VALUES (?, ?, ?)", [("A1", "CR1", 1), ("A2", " L-2 ", 2), ("A3", "TLV", 3), ("A4", "", 4), ("A5", "ｃｒ１", 5),
                                                        ("A6", "新設備", 6), ("A7", None, 7), ("A8", "VC", 8), ("A9", "CR1", 9), ("B1", "L-9", 1)])
    con.commit()
    con.close()


def G(name, **kw):
    """足すグループの形（画面の形 {name, set, equipment, rules, except, order, note}）"""
    return {"name": name, "set": "ライン別", "equipment": ["TLV"], **kw}


def S(method, path, body=None, query=""):
    return {"method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


E = "/api/masters/equipgroups"
P = [{"op": "prefix", "value": "L-"}]
SCENARIOS = [
    {"name": "一覧", "mode": "shared", "steps": [S("GET", E), S("GET", E, query="x=1")]},
    {"name": "足す（確かめと言葉）", "mode": "shared", "steps": [
        S("POST", E, G("新しい")),
        S("POST", E, G("新しい")),
        S("POST", E, G("ＣＲ ライン", set="ﾗｲﾝ別 ")),
        S("POST", E, G("CR ライン", set="工場 2")),
        S("POST", E, G("  ")),
        S("POST", E, G(0)),
        S("POST", E, G(12.5)),
        S("POST", E, G(True)),
        S("POST", E, G("あ" * 50, set="い" * 50)),
        S("POST", E, G("まとめ方が空", set="")),
        S("POST", E, G("まとめ方が null", set=None)),
        S("POST", E, G("まとめ方が 0", set=0)),
        S("POST", E, G("設備が字", equipment="CR1、CR2,，cr1\nL-1")),
        S("POST", E, G("設備がいろいろ", equipment=[5, True, 1.0, "", None, " x ", 0, False, 1e16])),
        S("POST", E, G("設備が数", equipment=5)),
        S("POST", E, G("設備が空の表", equipment={}, rules=P)),
        S("POST", E, G("ルール", equipment=[], rules=P + [{"op": "prefix", "value": " L- "}, {"op": "x", "value": "a"}, 5, "prefix",
                                                         {"op": "suffix", "value": ""}, {"op": "contains", "value": 5},
                                                         {"op": "equals", "value": True}, {"op": "suffix", "value": "う" * 100},
                                                         {"op": "contains", "value": 0}, {"op": 5, "value": "a"}, {"op": None}])),
        S("POST", E, G("ルール 13", equipment=[], rules=[{"op": "equals", "value": f"E{n}"} for n in range(13)])),
        S("POST", E, G("13 個目が正規表現", equipment=[], rules=[{"op": "equals", "value": f"E{n}"} for n in range(12)] + [{"op": "regex", "value": "("}])),
        S("POST", E, G("空の正規表現", rules=[{"op": "regex", "value": " "}, {"op": "regex"}])),
        S("POST", E, G("空の正規表現だけ", equipment=[], rules=[{"op": "regex", "value": ""}])),
        S("POST", E, G("除くだけ", **{"except": ["TLV"]})),
        S("POST", E, G("除くつき", equipment=[], rules=P, **{"except": "L-9、L-8,l-8"})),
        S("POST", E, G("除くが空", equipment=[], rules=P, **{"except": []})),
        S("POST", E, G("ルールが字", rules="prefix")),
        S("POST", E, G("ルールが表", equipment=[], rules={"op": "prefix", "value": "L-"})),
        S("POST", E, G("何も無い", equipment=[], rules=[])),
        S("POST", E, {"name": "鍵が無い"}),
        S("POST", E, G("順つき", order="１２")),
        S("POST", E, G("順が小数", order=1.9)),
        S("POST", E, G("順が負の小数", order=-0.5)),
        S("POST", E, G("順が字", order="abc")),
        S("POST", E, G("順が真", order=True)),
        S("POST", E, G("順が null", order=None)),
        S("POST", E, G("順が並び", order=[1])),
        S("POST", E, G("順が 0", order=0)),
        S("POST", E, G("順が空白つき", order=" 7 ")),
        S("POST", E, G("順に下線", order="1_0")),
        S("POST", E, G("備考", note=" " + "メ" * 250)),
        S("POST", E, G("備考が 0", note=0)),
        S("POST", E, G("備考が数", note=3.25)),
        S("POST", E, G("知らない鍵", 知らない=1)),
        S("POST", E, '{"name": "同じ鍵", "equipment": ["A"], "name": "同じ鍵（後ろ）"}'),
        # 正規表現（版 3.102.0 から窓が答える。Python の re と同じ意味の書き方だけ。src/equip_regex.rs）
        S("POST", E, G("正規表現", rules=[{"op": "regex", "value": "^CR"}])),
        S("POST", E, G("読めない正規表現", rules=[{"op": "regex", "value": "(a"}])),
        S("POST", E, G("窓で写せない \\Z", rules=[{"op": "regex", "value": "^L-\\d\\Z"}])),
        S("POST", E, G("窓で写せない [[:alpha:]]", rules=[{"op": "regex", "value": "[[:alpha:]]"}])),
        S("POST", E, G("窓で写せない \\p", rules=[{"op": "regex", "value": "\\p{Han}"}])),
        S("POST", E, G("窓で写せない \\N", rules=[{"op": "regex", "value": "\\N{DIGIT ONE}"}])),
        S("POST", E, G("長さの違う後読み", rules=[{"op": "regex", "value": "(?<=L|CR)\\d"}])),
        S("POST", E, G("重い正規表現", rules=[{"op": "regex", "value": "(a+)+"}])),
        S("POST", E, G("正規表現と名前の決まり", equipment=[], rules=[{"op": "prefix", "value": "L-"}, {"op": "regex", "value": "^CR\\d$"}])),
        S("GET", E),
    ], "delegates": [
        S("POST", E, ""), S("POST", E, "壊れた本文"), S("POST", E, '{"name": NaN}'),
        S("POST", E, G("op が並び", rules=[{"op": ["prefix"], "value": "a"}])),
        S("POST", E, G("op が表", rules=[{"op": {}, "value": "a"}])),
        S("POST", E, G(["名前が並び"])), S("POST", E, G({"a": 1})),
        S("POST", E, G("設備が並びの並び", equipment=[["A"]])), S("POST", E, G("設備が表", equipment={"a": 1})),
        S("POST", E, G("値が並び", rules=[{"op": "prefix", "value": ["L-"]}])),
        S("POST", E, G("除くが並びの並び", rules=P, **{"except": [["x"]]})),
        S("POST", E, G("順が大きい", order=1e20)), S("POST", E, G("順が 41 桁", order="1" + "0" * 40)),
        S("POST", E, G("順が 20 桁", order="1" + "0" * 20)), S("POST", E, G("順が 30 桁", order="1" + "0" * 30)),
        S("POST", E, G("備考が並び", note=[1])),
        S("POST", E, '{"name": "大きな整数", "equipment": [99999999999999999999]}'),
        W(S("POST", E, '{"name": "x", "equipment": ["A"], "order": -0}')),
    ]},
    {"name": "足すの本文の形", "mode": "shared", "steps": [
        S("POST", E, "[1]"), S("POST", E, '"abc"'), S("POST", E, "5"), S("POST", E, "1.5"), S("POST", E, "true"),
        S("POST", E, "0"), S("POST", E, "null"), S("POST", E, "[]"), S("POST", E, "{}"),
        S("POST", E, ' {"name": "空白つきの本文", "equipment": "A"} '),
    ]},
    {"name": "直す・行の版・一部だけの直し", "mode": "shared", "steps": [
        S("PUT", f"{E}/1", {"name": "新名", "base_rev": 2}),
        S("PUT", f"{E}/1", {"name": "新名 2", "base_rev": 2}),
        S("PUT", f"{E}/1", {"rules": [{"op": "suffix", "value": "1"}]}),
        S("PUT", f"{E}/1", {"equipment": "CR3"}),
        S("PUT", f"{E}/1", {"except": ["CR9"]}),
        S("PUT", f"{E}/2", {"equipment": ["TLV"]}),
        S("PUT", f"{E}/2", {"except": []}),
        S("PUT", f"{E}/2", {"rules": [], "equipment": []}),
        S("PUT", f"{E}/2", {"rules": []}),
        S("PUT", f"{E}/4", {"except": "X1,X2"}),
        S("PUT", f"{E}/1", {"set": "工場", "name": "CR ライン"}),
        S("PUT", f"{E}/1", {"set": "工場"}),
        S("PUT", f"{E}/3", {"name": "全部", "base_rev": "３"}),
        S("PUT", f"{E}/1", {"order": " 7 "}),
        S("PUT", f"{E}/1", {"order": "x", "note": "  直した  "}),
        S("PUT", f"{E}/1", {}),
        S("PUT", f"{E}/1", "0"),
        S("PUT", f"{E}/1", {"name": ""}),
        S("PUT", f"{E}/1", {"name": "版が並び", "base_rev": [1]}),
        S("PUT", f"{E}/1", {"name": "問い合わせの版"}, query="rev=99"),
        S("PUT", f"{E}/1", {"name": "本文の版が勝つ", "base_rev": None}, query="rev=99"),
        S("PUT", f"{E}/999", {"name": "x"}),
        S("PUT", f"{E}/999", {"name": "x", "base_rev": 1}),
        S("PUT", f"{E}/999", {"rules": P}),
        S("PUT", f"{E}/999", {"equipment": []}),
        S("PUT", f"{E}/０4", {"name": "全角の id", "知らない鍵": 1}),
        S("PUT", f"{E}/1", {"rules": [{"op": "regex", "value": "^C"}]}),
        S("GET", E),
    ], "delegates": [
        S("PUT", f"{E}/1", "[1]"), S("PUT", f"{E}/1", ""), S("PUT", f"{E}/1", "壊れた本文"),
        W(S("PUT", f"{E}/1", {"name": "x", "base_rev": "²"})), S("PUT", f"{E}/99999999999999999999", {"name": "x"}),
        S("PUT", f"{E}/1", {"name": {"a": 1}}), W(S("PUT", f"{E}/1", '{"name": "x", "base_rev": -0}')),
    ]},
    {"name": "まとめ方が空の行と同じ名前", "mode": "shared", "extra_rows": [{"id": 5, "名称": "全部", "まとめ方": "グループ", "設備": "A", "rev": 1}],
     "steps": [S("GET", E), S("PUT", f"{E}/3", {"name": "全部 "}), S("PUT", f"{E}/3", {"set": " "}), S("POST", E, G("全部", set="")),
               S("PUT", f"{E}/5", {"name": "全部"}), S("GET", E)]},
    {"name": "同じ id の行が 2 つ", "mode": "shared", "extra_rows": [{"id": 1, "名称": "二つ目", "まとめ方": "工場", "設備": "Z", "rev": 1},
                                                                  {"id": 6, "名称": "id が小数", "設備": "Y", "rev": 1}],
     "steps": [S("PUT", f"{E}/1", {"rules": P}), S("DELETE", f"{E}/1"), S("GET", E)]},
    {"name": "消す", "mode": "shared", "steps": [
        S("DELETE", f"{E}/4", query="rev=1"),
        S("DELETE", f"{E}/4", query="rev=1"),
        S("DELETE", f"{E}/4"),
        S("DELETE", f"{E}/1", {"base_rev": 1}),
        S("DELETE", f"{E}/1", {"base_rev": 2}),
        S("DELETE", f"{E}/3", "0"),
        S("DELETE", f"{E}/2", query="rev=x"),
        S("GET", E),
    ], "delegates": [
        S("DELETE", f"{E}/5", "[1]"), W(S("DELETE", f"{E}/5", query="rev=²")), S("DELETE", f"{E}/5", '{"base_rev": NaN}'),
    ]},
    {"name": "書ける段と門番（閲覧のみ）", "mode": "shared", "perm": perm("一般ユーザー", "閲覧のみ"), "steps": [
        S("GET", E), S("POST", E, G("x")), S("PUT", f"{E}/1", {"name": "x"}), S("DELETE", f"{E}/1"),
        S("POST", E, "[1]"), S("PUT", f"{E}/1", "壊れた本文"),
    ]},
    {"name": "書ける段（部分的編集可）", "mode": "shared", "perm": perm("一般ユーザー", "部分的編集可"), "steps": [
        S("GET", E), S("POST", E, G("部分的に書ける")), S("PUT", f"{E}/1", {"note": "直せる"}),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "steps": [
        S("GET", E), S("POST", E, G("手元で足す")), S("PUT", f"{E}/1", {"name": "手元で直す", "base_rev": 2}),
        S("DELETE", f"{E}/4", query="rev=1"), S("GET", E),
    ]},
    {"name": "手元だけで data/ にまだ無い（最初の中身から）", "mode": "local", "no_groups": True, "steps": [
        S("GET", E), S("POST", E, G("手元で初めて")), S("GET", E),
    ]},
    {"name": "共有に届かない（写しから）", "mode": "unreachable", "steps": [
        S("GET", E), S("POST", E, G("x")), S("PUT", f"{E}/1", {"name": "x"}), S("DELETE", f"{E}/1"),
    ]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "lock": True, "steps": [
        S("GET", E), S("POST", E, G("x")), S("PUT", f"{E}/1", {"name": "x"}), S("DELETE", f"{E}/1"), S("POST", E, {"name": ""}),
        S("PUT", f"{E}/1", {"equipment": []}),
    ]},
    {"name": "共有にまだ無い（写しから最初の版を置く）", "mode": "seed", "steps": [
        S("GET", E), S("POST", E, G("最初の版の後")), S("GET", E),
    ]},
    {"name": "設備グループがまだ空", "mode": "shared", "empty": True, "steps": [
        S("GET", E), S("POST", E, G("最初のグループ")), S("POST", E, G("二つ目", order="")), S("PUT", f"{E}/1", {"order": ""}),
        S("POST", E, G("三つ目")), S("GET", E),
    ]},
    {"name": "データ元が無い（作業実績と設備マスタだけ）", "mode": "shared", "no_sources": True, "steps": [S("GET", E), S("POST", E, G("x"))]},
    {"name": "置き場に正規表現のルール", "mode": "shared", "extra_rows": [
        {"id": 7, "名称": "正規表現", "まとめ方": "ライン別", "ルール": rules(("regex", "^CR")), "rev": 1}], "steps": [
        S("POST", E, G("")), S("POST", E, "[1]"),
        S("GET", E), S("POST", E, G("x")), S("PUT", f"{E}/1", {"name": "x"}), S("PUT", f"{E}/7", {"equipment": "A"}), S("DELETE", f"{E}/7")]},
    # 版 3.102.0: 置き場の決まりに重い・窓で写せない・読めない正規表現があっても、その決まりだけを当てず（理由を添えて）、ほかは残す。
    # 一部だけを直しても、当てていない決まりを黙って消さない（確か 2）
    {"name": "置き場に当てられない正規表現の決まり", "mode": "shared", "extra_rows": [
        {"id": 7, "名称": "混ざった決まり", "まとめ方": "ライン別",
         "ルール": json.dumps({"rules": [{"op": "prefix", "value": "L-"}, {"op": "regex", "value": "(a+)+"}, {"op": "regex", "value": "^CR\\d\\Z"},
                                        {"op": "regex", "value": "("}], "except": ["L-9"]}, ensure_ascii=False), "rev": 1}], "steps": [
        S("GET", E), S("PUT", f"{E}/7", {"equipment": "A"}), S("PUT", f"{E}/7", {"except": ["L-8"]}), S("GET", E),
        S("PUT", f"{E}/7", {"rules": [{"op": "prefix", "value": "L-"}]}), S("GET", E)]},
    {"name": "置き場の表示順が大きい", "mode": "shared", "extra_rows": [{"id": 8, "名称": "大きな表示順", "設備": "A", "表示順": "1" + "0" * 20, "rev": 1}],
     "steps": [], "delegates": [S("GET", E), S("POST", E, G("x")), S("PUT", f"{E}/1", {"name": "x"}), S("DELETE", f"{E}/1")]},
    # 版 3.107.0（E3・E4）: 読めない行（数のまとめ方・読めない版・ルールの NaN）は隔てて答える（一覧は skipped・触れる直す・消すは断る）
    {"name": "置き場のまとめ方が数（行を隔てて答える）", "mode": "shared", "extra_rows": [{"id": 9, "名称": "数のまとめ方", "まとめ方": 5, "設備": "A", "rev": 1}],
     "steps": [], "delegates": [W(S("GET", E)), W(S("POST", E, G("x"))), W(S("PUT", f"{E}/9", {"name": "y"}))]},
    {"name": "置き場の版が読めない（行を隔てて答える）", "mode": "shared", "extra_rows": [{"id": 10, "名称": "版が字", "設備": "A", "rev": "abc"}], "steps": [],
     "delegates": [W(S("GET", E)), W(S("POST", E, G("x"))), W(S("DELETE", f"{E}/10"))]},
    {"name": "置き場のルールの字が NaN（触れる直すは断る）", "mode": "shared", "extra_rows": [{"id": 11, "名称": "NaN", "ルール": '{"rules": [{"op": "prefix", "value": NaN}]}',
                                                                        "rev": 1}], "steps": [],
     # 版 3.107.0 の割れ 2: 隔てた行は束（選べる設備を数える）でも使わないので、窓も答える
     "delegates": [W(S("GET", E)), W(S("PUT", f"{E}/1", {"name": "x"})), W(S("PUT", f"{E}/11", {"name": "y"})), W(S("DELETE", f"{E}/11"))]},
    {"name": "置き場の設備名が並び（選べる設備を数える束が設備マスタの並びの名前を読めないので任せる）", "mode": "shared",
     "equip_extra": [{"id": 9, "設備名": ["X"]}], "steps": [], "delegates": [S("GET", E), S("POST", E, G("x"))]},
]
# 作った後の採点の提案: 選べる設備を数えるマスタ（作業実績・設備マスタ・データ元）のどれかが共有にまだ無い形。前は窓が束を組めず数えられないので
# 書く前に Python に任せた（Python は読むときにそのマスタの最初の版を置く）。版 3.105.0 から窓も束を組むときに同じ最初の版を置き（種まき）、
# 数えて答える（置いたファイルの中身も Python と突き合わせる）。断る歩（確かめの誤り・無い行。数えずに答える）は窓も同じ答え。
# 写しがある形と、写しも data/ も無い形（Python も窓も最初の中身〈program/app/master_defaults。無ければ空の版 1〉から置く）
for _absent, _copy in (("work_log_files", True), ("work_log_files", False), ("equipment_master", True), ("equipment_master", False),
                       ("data_sources", True), ("data_sources", False)):
    SCENARIOS.append({"name": f"共有に {_absent} が無い（{'写しから' if _copy else '写しも data/ も無い'}）", "mode": "shared",
                      "absent": _absent, "absent_copy": _copy, "steps": [
                          S("POST", E, {"name": ""}), S("POST", E, "[1]"), S("PUT", f"{E}/1", {"name": ""}),
                          S("PUT", f"{E}/1", {"equipment": [], "rules": []}), S("DELETE", f"{E}/999"), S("PUT", f"{E}/999", {"name": "x"})],
                      "delegates": [W(S("GET", E)), W(S("POST", E, G("x"))), W(S("PUT", f"{E}/1", {"name": "x"})),
                                    W(S("PUT", f"{E}/2", {"equipment": "A"})), W(S("DELETE", f"{E}/4")), W(S("DELETE", f"{E}/999", query="rev=1"))]})
# CI の自己診断で見つけた形（版 3.94.0）: 配る設定に CM3 の場所と設備があると、組み込みのスケジュールの元が設備の列を持つ。Python の選べる設備は
# CM3 に届くかで変わる（届けばスケジュールの最初の設備の予定も数える）。版 3.96.0 から窓がスケジュールの係（CM3 へ取りに行く）なので、
# 一覧と書ける歩も窓が答え、Python と同じ答え（前は任せていた）。届かない CM3 と、届く作り物の CM3（tests/schedule_fixture.py。
# 窓が問い合わせる間も起こしておく: main の serve）の 2 つ。一覧でスケジュールの設備を数えたか（"from"）も見る
SCH_STEPS = [S("POST", E, {"name": ""}), S("POST", E, G("CR ライン")), S("PUT", f"{E}/999", {"name": "x"}),
             S("PUT", f"{E}/999", {"name": "x", "base_rev": 1}), S("PUT", f"{E}/1", {"name": "x", "base_rev": 9}),
             S("PUT", f"{E}/1", {"set": "工場", "name": "ｃｒ ライン"}), S("PUT", f"{E}/1", {"name": ""}), S("DELETE", f"{E}/999"),
             S("DELETE", f"{E}/1", query="rev=9"), S("PUT", f"{E}/987654321", {"note": "x"})]
SCH_DELEGATES = [S("GET", E), S("POST", E, G("x")), S("PUT", f"{E}/1", {"note": "x"}), S("DELETE", f"{E}/4"),
                 S("DELETE", f"{E}/999", query="rev=1")]
SCENARIOS += [{"name": "スケジュールの元がある（CM3 に届かない）", "mode": "shared", "cm3": "down", "steps": SCH_DELEGATES[:1] + SCH_STEPS + SCH_DELEGATES},
              {"name": "スケジュールの元がある（作り物の CM3 に届く）", "mode": "shared", "cm3": "up", "steps": SCH_DELEGATES[:1] + SCH_STEPS + SCH_DELEGATES}]
CM3 = {}                                    # 届く作り物の CM3 の URL（main が起こす）

# 共有にまだ無いとき、Python はその道が読むときに最初の版を置く（道ごとに 1 場面で、置かれるファイルを突き合わせる）
SEED_STEPS = [
    ("一覧", S("GET", E)),
    ("足す（誤り）", S("POST", E, {"name": ""})),
    ("足す（本文が並び）", S("POST", E, "[1]")),
    ("足す（表示順つき）", S("POST", E, G("順つき", order=5))),
    ("足す（表示順なし）", S("POST", E, G("順なし"))),
    ("直す（誤り）", S("PUT", f"{E}/1", {"name": ""})),
    ("直す", S("PUT", f"{E}/1", {"name": "直した"})),
    ("直す（一部だけ）", S("PUT", f"{E}/2", {"equipment": "TLV"})),
    ("直す（無い行）", S("PUT", f"{E}/999", {"name": "x"})),
    ("消す（無い行）", S("DELETE", f"{E}/999")),
    ("消す", S("DELETE", f"{E}/4")),
]
SCENARIOS += [{"name": f"共有にまだ無い（1 歩だけ）: {label}", "mode": "seed", "steps": [st]} for label, st in SEED_STEPS]


def place(root, sc):
    share, data = root / "share", root / "base" / "data"
    for d in (share, data, root / "local"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    data_file(root)
    groups = [] if sc.get("empty") else base_rows() + sc.get("extra_rows", [])
    masters = {"access_permissions": sc.get("perm") or perm(), "equipment_groups": groups, "work_log_files": WORK,
               "equipment_master": EQUIP + sc.get("equip_extra", []), "data_sources": [] if sc.get("no_sources") else sources(root)}
    for n in ("path_settings", "conversions", "shift_patterns"):
        masters[n] = []
    cache = root / "local" / "master_cache"
    for name, rows in masters.items():
        if sc["mode"] == "local":
            if name == "equipment_groups" and sc.get("no_groups"):
                continue
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif name == sc.get("absent"):
            if sc.get("absent_copy"):                       # 共有にまだ無い: 写しだけがある（無い形は写しも data/ も無い）
                cache.mkdir(parents=True, exist_ok=True)
                (cache / f"{name}.json").write_text(j(doc(rows, 5)), encoding="utf-8")
        elif sc["mode"] == "seed" and name == "equipment_groups":
            cache.mkdir(parents=True, exist_ok=True)       # 共有にまだ置いていない: 写しだけがある
            (cache / f"{name}.json").write_text(j(doc(rows, 5)), encoding="utf-8")
        elif sc["mode"] == "unreachable":
            cache.mkdir(parents=True, exist_ok=True)
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    if sc.get("lock"):
        (share / "master.lock.json").write_text(j(lock_doc()), encoding="utf-8")
    cfg = {"lot_list": {"source": str(root / "無い品質.sqlite3"), "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"},
           **({"schedule": {"cm3_base_url": CM3["url"] if sc["cm3"] == "up" else "http://127.0.0.1:1", "equipments": "L-1",
                            "timeout_sec": 3},
                  # スケジュールは既定で仕掛と結合する（届かない仕掛は「写し中」でスケジュールごと飛ぶ）。仕掛は場面の SQLite に
                  "sources": {"wip": {"source": str(root / "仕掛.sqlite3"), "table": "仕掛"}}} if sc.get("cm3") else {}),
           "master_share": {} if sc["mode"] == "local" else {"dir": str(root / "届かない共有" if sc["mode"] == "unreachable" else share),
                                                               "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


def run(root, steps):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
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
        except Exception as e:      # 道の外で落ちた（試験の接続は投げ返す。本番は 500 で答え、書かない）
            out.append({**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}", "kind": "error"}})
    return out


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    from datetime import datetime as dt, timedelta as td, timezone as tz
    from tests import schedule_fixture
    lots = [(f"S{n}", "CR1", "L-1 LS3") for n in range(6)]
    rows = schedule_fixture.schedule_rows("L-1", lots, dt(2026, 10, 3, 8, 12, tzinfo=tz(td(hours=9))), 1)
    srv, CM3["url"] = schedule_fixture.serve({"L-1": {"status": "SUCCESS", "entity": {"setsubiName": "L-1", "termKbn": "4", "updateTs": 0,
                                                                                        "error": False, "errorMessage": "", "meisaiList": rows}}})
    out = []
    for i, sc in enumerate(SCENARIOS):
        py, rs, pd = (base / f"s{i}" / x for x in ("py", "rs", "pd"))
        for r in (py, rs, pd):
            place(r, sc)
        mine, theirs = oracle_gate.split(sc["steps"], sc.get("delegates", []))
        steps = run(py, mine)
        # 任せる歩は答えの本文を比べない（NaN の答えもある）。状態と、Python が置いたマスタのファイルの名前（共有・data/）は残す
        dele = [{**x, "json": None, "from": sorted({f for e in (x["json"] or {}).get("seen") or [] for f in e.get("from") or []})}
                for x in run(pd, theirs)]
        out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "steps": steps, "delegates": dele,
                    "absent": sc.get("absent"),
                    "cm3": sc.get("cm3"),
                    "delegatedFiles": sorted(f"{d}/{f.name}" for d in ("share", "base/data") for f in (pd / d).glob("*.json")),
                    # 共有にまだ無かった数える材料を Python が置いた中身（版 3.105.0: 窓が置いた物と突き合わせる）
                    "absentPlaced": (json.loads((py / "share" / f"{sc['absent']}.json").read_text(encoding="utf-8"))
                                     if sc.get("absent") and (py / "share" / f"{sc['absent']}.json").exists() else None),
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    if "--serve" in sys.argv:              # 窓が同じ作り物の CM3 に問い合わせる間は起こしておく（標準入力が閉じるまで）
        for _ in sys.stdin:
            pass
    srv.shutdown()


if __name__ == "__main__":
    main()
