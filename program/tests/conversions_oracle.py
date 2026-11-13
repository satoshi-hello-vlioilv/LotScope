# -*- coding: utf-8 -*-
"""変換表の道の「正しい答え」を出す係（版 3.93.0。desktop/tests/conversions_write_parity.rs が呼ぶ）。

    python tests/conversions_oracle.py 作業フォルダ

場面ごとに同じ中身の置き場を 3 つ（py・rs・pd）作り、py に Python の道（routes/conversions.py の 8 本。門番 _access_guard を含む）で
問い合わせの並びを当てる。窓の試験は rs に同じ並びを本物の窓の道（Lot::handle_body → conversions_route）で当て、答え（状態・本文）と
できたファイル（変換表・標準）を突き合わせる。窓が答えず Python に任せる歩（delegates）は pd に当てる。
取り込みで標準にもする 2 回の書き込みの間に、ほかの PC の錠を置く場面（between）は、Python は conversion_defaults_set の前に、
窓は conversions_write::set_between_writes で同じ錠のファイルを置く。
"""
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity  # noqa: E402
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

LOGIN = identity.current_login_id()
BUNDLED = json.loads((PROGRAM / "app" / "master_defaults" / "conversions.json").read_text(encoding="utf-8"))


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


def base_rows():
    """同梱のプリセット 9 表（版はまちまち。地取区分は判定を変えてある）と、プリセットに無い表（表示順が空 → 先頭）"""
    rows = [dict(r) for r in BUNDLED]
    for r in rows:
        r["rev"] = 1 + r["id"] % 3
    rows[1]["判定"] = j([{"when": {"地取": [{"op": "eq", "v": ["9"]}]}, "out": "変えた"}])
    rows.append({"id": 12, "名前": "自前の表", "入力": j([{"name": "a", "type": "text", "columns": ["列A"]}]), "判定": "[]",
                 "その他": "=[a]", "当て方": j({"mode": "replace"}), "表示順": "", "rev": 2})
    return rows


INP = [{"name": "a", "columns": ["列A", "ＡＢ"]}, {"name": "b", "type": "num"}]
LIST_OPS = ["eq", "ne", "starts", "nstarts", "ends", "nends", "contains", "ncontains"]


def T(name, **kw):
    """足す表の形（画面の形 {name, inputs, rows, other, apply, order}）"""
    return {"name": name, "inputs": INP, "rows": [{"when": {"a": [{"op": "eq", "v": ["1"]}]}, "out": "一"}], "other": "",
            "apply": {"mode": "add", "column": "{列}_x", "place": "after"}, **kw}


def S(method, path, body=None, query=""):
    return {"method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


C = "/api/masters/conversions"
WHEN = [{"when": {"a": [{"op": op, "v": ["x", "", 1, None, True, 2.5]} for op in LIST_OPS] + [{"op": "empty"}, {"op": "filled"},
                                                                                              {"op": "range", "min": 1}]},
         "out": "いろいろ"}]
SCENARIOS = [
    {"name": "一覧と書き出し", "mode": "shared", "steps": [
        S("GET", C), S("GET", f"{C}/export"), S("GET", f"{C}/export", query="which=defaults"),
        S("GET", f"{C}/export", query="which=current"), S("GET", f"{C}/export", query="which=x&which=defaults"),
    ]},
    {"name": "足す（確かめと言葉）", "mode": "shared", "steps": [
        S("POST", C, T("新しい表")),
        S("POST", C, T("新しい表")),
        S("POST", C, T(" 順つき ", order="１２")),
        S("POST", C, T("順が小数", order=1.9)),
        S("POST", C, T("順が字", order="abc")),
        S("POST", C, T("順が真", order=True)),
        S("POST", C, T("順が null", order=None)),
        S("POST", C, T("順が並び", order=[1])),
        S("POST", C, T("順が 0", order=0)),
        S("POST", C, {"name": "  "}),
        S("POST", C, T("a'b\"c")),
        S("POST", C, T("入力なし", inputs=[])),
        S("POST", C, T("入力 9", inputs=[{"name": f"i{n}"} for n in range(9)])),
        S("POST", C, T("入力 10（10 個目は見ない）", inputs=[{"name": f"i{n}"} for n in range(9)] + [{"name": ""}])),
        S("POST", C, T("入力の名前が空", inputs=[{"name": "a"}, {"name": ""}])),
        S("POST", C, T("入力の重なり", inputs=[{"name": "a"}, {"name": " a "}])),
        S("POST", C, T("入力が字", inputs=j(INP))),
        S("POST", C, T("入力が表の字", inputs=j({"name": "a"}))),
        S("POST", C, T("入力の中の表でない物", inputs=[5, "x", {"name": 0, "columns": "A"}, {"name": "a", "columns": [" ", 1, None, "c"]}],
                       rows=[])),
        S("POST", C, T("行が多い", rows=[{} for _ in range(301)])),
        S("POST", C, T("行が 300", rows=[{"when": {}, "out": n} for n in range(300)])),
        S("POST", C, T("行が表", rows={"x": 1})),
        S("POST", C, T("行の中の表でない物", rows=[1, {"when": {"zz": []}}])),
        S("POST", C, T("比べ方いろいろ", rows=WHEN)),
        S("POST", C, T("13 個目の比べ方が誤り", rows=[{"when": {"a": [{"op": "eq", "v": ["1"]}] * 12 + [{"op": "x"}]}}])),
        S("POST", C, T("比べ方 13 個", rows=[{"when": {"a": [{"op": "eq", "v": [str(n)]} for n in range(13)]}}])),
        S("POST", C, T("比べ方が表でない", rows=[{"when": {"a": ["eq"]}}])),
        S("POST", C, T("比べ方が無い", rows=[{"when": {"a": [{"v": ["1"]}]}}])),
        S("POST", C, T("比べ方が並びでない", rows=[{"when": {"a": {"op": "eq"}, "b": [{"op": "filled"}]}}])),
        S("POST", C, T("範囲の端", rows=[{"when": {"b": [
            {"op": "range", "min": "１,000", "max": "-0"}, {"op": "range", "min": 1.5, "minInc": False, "maxInc": False},
            {"op": "range", "max": "1e3", "maxInc": "false"}, {"op": "range", "min": " ", "max": 2, "minInc": 0},
            {"op": "range", "min": "1_000.5", "max": " 2,5 "}, {"op": "range", "min": 1e16, "max": "-1e-5"},
            {"op": "range", "min": "0.1", "max": 1e-7}]}}])),
        S("POST", C, T("範囲が偽", rows=[{"when": {"b": [{"op": "range", "min": False}]}}])),
        S("POST", C, T("範囲が真", rows=[{"when": {"b": [{"op": "range", "min": True}]}}])),
        S("POST", C, T("範囲が字", rows=[{"when": {"b": [{"op": "range", "min": 1, "max": "abc"}]}}])),
        S("POST", C, T("範囲が nan", rows=[{"when": {"b": [{"op": "range", "min": "nan"}]}}])),
        S("POST", C, T("範囲が inf", rows=[{"when": {"b": [{"op": "range", "max": "-Infinity"}]}}])),
        S("POST", C, T("範囲が空", rows=[{"when": {"b": [{"op": "range", "min": "", "max": None}]}}])),
        S("POST", C, T("値が空", rows=[{"when": {"a": [{"op": "contains", "v": ["", None]}]}}])),
        S("POST", C, T("値が 1 つ", rows=[{"when": {"a": [{"op": "ne", "v": ""}, {"op": "starts", "v": 0}, {"op": "eq"}]}}])),
        S("POST", C, T("値が 61", rows=[{"when": {"a": [{"op": "eq", "v": [str(n) for n in range(61)]}]}}])),
        S("POST", C, T("条件の鍵が入力に無い", rows=[{"when": {"a": [], "zz": []}}])),
        S("POST", C, '{"name": "鍵の順", "inputs": [{"name": "a"}, {"name": "b"}], "rows": [{"when": {"b": [{"op": "eq", "v": ["1"]}],'
                     ' "a": [{"op": "filled"}], "b": [{"op": "empty"}]}, "out": "x"}], "name": "鍵の順（後ろ）"}'),
        S("POST", C, T("出す値の式", rows=[{"when": {}, "out": "=if([a] = '1', [b], conv('課名', [a]))"}], other="=[a]")),
        S("POST", C, T("出す値の式が読めない", rows=[{"when": {}, "out": "=[a] +"}])),
        S("POST", C, T("= だけ", other="=")),
        S("POST", C, T("知らない関数", other="=foo([a])")),
        S("POST", C, T("引数の数", other="=left([a])")),
        S("POST", C, T("閉じない", other="=[a")),
        S("POST", C, T("入力に無い列", other="=[a] + [zz] + [yy] + [zz]")),
        S("POST", C, T("式の前の空白", other=" =[zz] ")),
        S("POST", C, T("出す値が数", rows=[{"when": {}, "out": 0}, {"when": {}, "out": False}, {"when": {}, "out": 1.0},
                                         {"when": {}, "out": None}], other=12)),
        S("POST", C, T("出す値が長い", other="あ" * 600)),
        S("POST", C, T("当て方", apply={"mode": "replace", "column": "x"})),
        S("POST", C, T("当て方が字", apply=j({"mode": "add", "place": "left", "column": " c "}))),
        S("POST", C, T("当て方が知らない", apply={"mode": "x", "place": 1, "column": None})),
        S("POST", C, T("当て方が並びの字", apply="[1]")),
        S("POST", C, T("当て方が無い", apply=None)),
        S("POST", C, T("あ" * 50)),
        S("POST", C, T(12.5)),
        S("GET", C),
    ], "delegates": [
        S("POST", C, ""), S("POST", C, "壊れた本文"), S("POST", C, '{"name": NaN}'),
        S("POST", C, T("op が並び", rows=[{"when": {"a": [{"op": ["eq"]}]}}])),
        S("POST", C, T("mode が表", apply={"mode": {}})),
        S("POST", C, T("当て方が並び", apply=[1])),
        S("POST", C, T("入力が表", inputs={"a": 1})),
        S("POST", C, T("大きな範囲", rows=[{"when": {"b": [{"op": "range", "min": "1e19"}]}}])),
        W(S("POST", C, T("正規表現", other="=extract([a], '(')"))),       # 版 3.106.0: re の言葉（位置）を出さない
        # 作った後の採点の割れ 4: 長さの決まらない後読みは Python の re が読めず窓の fancy-regex は読む（formula_regex_cases）。窓は任せる
        S("POST", C, T("長さの決まらない後読みの正規表現", other="=extract([a], '(?<=L|CR)\\d')")),
        S("POST", C, T(["名前が並び"])),
        S("POST", C, T("順が大きい", order="1" + "0" * 40)),
        S("POST", C, T("出す値が並び", other=[1])),
        S("POST", C, T("値が並び", rows=[{"when": {"a": [{"op": "eq", "v": [[1]]}]}}])),
        # 版 3.106.0: 式の入れ子は Python も窓も同じ数え方（かっこ・負の符号・! と not の数）の上限 60 で断る（conversions.NEST_MAX）
        W(S("POST", C, T("入れ子の深い式", other="=" + "(" * 70 + "1" + ")" * 70))),
        # 作った後の採点で見つけた割れ: not の重ね（窓は 200 段で断り、Python は再帰の上限まで読む）
        W(S("POST", C, T("not の重ね", other="=" + "not " * 90 + "(" * 60 + "1" + ")" * 60))),
        W(S("POST", C, T("not の重ね（出す値）", rows=[{"when": {}, "out": "=" + "not " * 90 + "(" * 60 + "1" + ")" * 60}]))),
        W(S("POST", C, T("not だけの重ね", other="=" + "not " * 120 + "1"))),
        W(S("POST", C, T("入れ子の上限ちょうど", other="=" + "not " * 30 + "(" * 30 + "-" * 30 + "1" + ")" * 30))),
        W(S("POST", C, T("入れ子の上限を 1 つ超える", other="=" + "not " * 30 + "(" * 30 + "-" * 31 + "1" + ")" * 30))),
        # 作った後の採点の割れ 3: 字と列の名前の中の「-」「not」は数えない（前は if を 31 重ねた式を 62 と数えて断った）
        W(S("POST", C, T("字の中の L-1 の if を 31 重ねる", other="=" + "".join(f'if([a]="L-{i}",{i},' for i in range(31)) + "0" + ")" * 31))),
        W(S("POST", C, T("列の名前と字の中の not", other='=if([a]="Not yet - not",  "-not-", "x")'))),
        W(S("POST", f"{C}/import", {"items": [T("取り込む if の重ね", other="=" + "".join(f'if([a]="L-{i}",{i},' for i in range(31)) + "0" + ")" * 31)]})),
        W(S("POST", C, T("正規表現の誤り（出す値）", rows=[{"when": {}, "out": "=match([a], '[')"}]))),
    ]},
    {"name": "足す・取り込むの本文の形", "mode": "shared", "steps": [
        S("POST", C, "[1]"), S("POST", C, '"abc"'), S("POST", C, "5"), S("POST", C, "1.5"), S("POST", C, "true"),
        S("POST", C, "0"), S("POST", C, "null"), S("POST", C, "[]"), S("POST", C, "{}"), S("POST", C, ' {"name": "空白つきの本文", "inputs": [{"name": "a"}]} '),
        S("POST", f"{C}/import", "[1]"), S("POST", f"{C}/import", "false"), S("POST", f"{C}/import", '"x"'),
    ], "delegates": [
        S("POST", f"{C}/import", ""), S("POST", f"{C}/import", "壊れた本文"), S("POST", f"{C}/defaults", "[1]"),
        S("POST", f"{C}/defaults", ""), S("POST", f"{C}/defaults", "壊れた本文"),
    ]},
    {"name": "直す・行の版", "mode": "shared", "steps": [
        S("PUT", f"{C}/1", {"name": "新名", "base_rev": 2}),
        S("PUT", f"{C}/1", {"name": "新名 2", "base_rev": 2}),
        S("PUT", f"{C}/1", {"rows": [{"when": {}, "out": "x"}]}),
        S("PUT", f"{C}/1", {"inputs": INP, "rows": WHEN, "base_rev": "３"}),
        S("PUT", f"{C}/1", {"apply": {"mode": "replace"}}),
        S("PUT", f"{C}/1", {"order": " 7 "}),
        S("PUT", f"{C}/1", {}),
        S("PUT", f"{C}/1", "0"),
        S("PUT", f"{C}/1", {"other": "=[zz]"}),
        S("PUT", f"{C}/1", {"name": "版が並び", "base_rev": [1]}),
        S("PUT", f"{C}/1", {"name": "問い合わせの版"}, query="rev=99"),
        S("PUT", f"{C}/1", {"name": "本文の版が勝つ", "base_rev": None}, query="rev=99"),
        S("PUT", f"{C}/2", {"name": "新名"}),
        S("PUT", f"{C}/999", {"name": "x"}),
        S("PUT", f"{C}/999", {"name": "x", "base_rev": 1}),
        S("PUT", f"{C}/０3", {"name": "全角の id", "知らない鍵": 1}),
        S("GET", C),
    ], "delegates": [
        S("PUT", f"{C}/1", "[1]"), S("PUT", f"{C}/1", ""), S("PUT", f"{C}/1", "壊れた本文"),
        W(S("PUT", f"{C}/1", {"name": "x", "base_rev": "²"})), S("PUT", f"{C}/99999999999999999999", {"name": "x"}),
        S("PUT", f"{C}/1", {"name": {"a": 1}}), W(S("PUT", f"{C}/1", '{"name": "x", "base_rev": -0}')),
    ]},
    {"name": "標準に戻す", "mode": "shared", "extra_rows": [{"id": 13, "名前": 5, "rev": 1}, {"id": 14, "rev": 1}], "steps": [
        S("POST", f"{C}/2/preset"),
        S("POST", f"{C}/2/preset", {"base_rev": 1}),
        S("POST", f"{C}/2/preset", query="rev=3"),
        S("POST", f"{C}/2/preset", "壊れた本文"),
        S("POST", f"{C}/12/preset"),
        S("POST", f"{C}/13/preset"),
        S("POST", f"{C}/14/preset"),
        S("POST", f"{C}/999/preset"),
        S("POST", f"{C}/999/preset", {"base_rev": 1}),
        S("POST", f"{C}/０2/preset", "0"),
        S("GET", C),
    ], "delegates": [
        S("POST", f"{C}/2/preset", "[1]"), W(S("POST", f"{C}/2/preset", {"base_rev": "²"})),
        S("POST", f"{C}/2/preset", '{"base_rev": NaN}'),
    ]},
    {"name": "標準を差し替えた（取り込んだ標準）", "mode": "shared", "own": True, "steps": [
        S("GET", C), S("GET", f"{C}/export", query="which=defaults"),
        S("POST", f"{C}/2/preset"), S("POST", f"{C}/1/preset"), S("GET", C),
    ]},
    {"name": "消す", "mode": "shared", "steps": [
        S("DELETE", f"{C}/12", query="rev=1"),
        S("DELETE", f"{C}/12", query="rev=2"),
        S("DELETE", f"{C}/12", query="rev=2"),
        S("DELETE", f"{C}/12"),
        S("DELETE", f"{C}/1", {"base_rev": 1}),
        S("DELETE", f"{C}/1", {"base_rev": 2}),
        S("DELETE", f"{C}/3", "0"),
        S("DELETE", f"{C}/4", query="rev=x"),
        S("GET", C),
    ], "delegates": [
        S("DELETE", f"{C}/5", "[1]"), W(S("DELETE", f"{C}/5", query="rev=²")), S("DELETE", f"{C}/5", '{"base_rev": NaN}'),
    ]},
    {"name": "取り込む", "mode": "shared", "steps": [
        S("POST", f"{C}/import", {"items": [T("新しい"), {**T("地取区分"), "other": " x "}, T("ｺﾝﾏ5本区分 ")]}),
        S("POST", f"{C}/import", {"items": []}),
        S("POST", f"{C}/import", {"items": "x"}),
        S("POST", f"{C}/import", {"items": [T("同じ"), T(" 同じ ")]}),
        S("POST", f"{C}/import", {"items": [T("a"), 5]}),
        S("POST", f"{C}/import", {"items": [{**T(""), "inputs": []}]}),
        S("POST", f"{C}/import", {"items": [T("x"), {**T(0), "inputs": []}]}),
        S("POST", f"{C}/import", {"items": [{**T(True), "inputs": []}]}),
        S("POST", f"{C}/import", {"items": [T("一つ目は良い"), {**T(" 名前 "), "rows": [{"when": {"zz": []}}]}]}),
        S("POST", f"{C}/import", {"items": [T("多い")] * 201}),
        S("POST", f"{C}/import", {"items": [T("順は使わない", order=5), T("真の名前")]}),
        S("POST", f"{C}/import", {"items": [T("標準にする"), T("課名")], "asDefault": True}),
        S("GET", C),
        S("POST", f"{C}/import", {"items": [T("字の false")], "asDefault": "false"}),
        S("POST", f"{C}/import", {"items": [T("0 は標準にしない")], "asDefault": 0}),
        S("POST", f"{C}/import", {"items": [T("並びは標準にする")], "asDefault": [0]}),
        S("GET", C), S("GET", f"{C}/export", query="which=defaults"),
    ], "delegates": [
        S("POST", f"{C}/import", {"items": [T("当て方が並び", apply=[1])]}),
        S("POST", f"{C}/import", {"items": [{**T("x"), "name": ["x"]}]}),
        S("POST", f"{C}/import", {"items": [{**T("x"), "inputs": [], "name": ["x"]}]}),
    ]},
    {"name": "取り込みの後ろ勝ち（同じ名前の行が 2 つ）", "mode": "shared", "extra_rows": [
        {"id": 11, "名前": "地取区分", "入力": "[]", "判定": "[]", "その他": "", "当て方": "{}", "表示順": "1", "rev": 5}], "steps": [
        S("GET", C),
        S("PUT", f"{C}/2", {"order": 3}),
        S("POST", f"{C}/import", {"items": [{**T("地取区分"), "other": "後ろの行を置き換える"}]}),
        S("POST", f"{C}/11/preset"),
        S("GET", C),
    ]},
    {"name": "標準を決める", "mode": "shared", "steps": [
        S("POST", f"{C}/defaults", {"from": "current"}),
        S("GET", C), S("GET", f"{C}/export", query="which=defaults"),
        S("POST", f"{C}/12/preset"),
        S("POST", f"{C}/defaults", {"from": "bundled"}),
        S("GET", C),
        S("POST", f"{C}/defaults", {"from": "x"}),
        S("POST", f"{C}/defaults", {}),
        S("POST", f"{C}/defaults", "0"),
        S("POST", f"{C}/defaults", {"from": ["current"]}),
    ]},
    {"name": "書ける段と門番（閲覧のみ）", "mode": "shared", "perm": perm("一般ユーザー", "閲覧のみ"), "steps": [
        S("GET", C), S("GET", f"{C}/export"),
        S("POST", C, T("x")), S("PUT", f"{C}/1", {"name": "x"}), S("DELETE", f"{C}/1"), S("POST", f"{C}/2/preset"),
        S("POST", f"{C}/import", {"items": [T("x")]}), S("POST", f"{C}/defaults", {"from": "current"}),
        S("POST", C, "[1]"), S("PUT", f"{C}/1", "壊れた本文"),
    ]},
    {"name": "書ける段（部分的編集可）", "mode": "shared", "perm": perm("一般ユーザー", "部分的編集可"), "steps": [
        S("GET", C), S("POST", C, T("部分的に書ける")),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "steps": [
        S("GET", C),
        S("POST", C, T("手元で足す")),
        S("PUT", f"{C}/1", {"name": "手元で直す", "base_rev": 2}),
        S("POST", f"{C}/import", {"items": [T("手元で取り込む"), T("地取区分")], "asDefault": True}),
        S("POST", f"{C}/2/preset"),
        S("POST", f"{C}/defaults", {"from": "current"}),
        S("DELETE", f"{C}/12", query="rev=2"),
        S("GET", C), S("GET", f"{C}/export", query="which=defaults"),
    ]},
    {"name": "手元だけで data/ にまだ無い（同梱のプリセットから）", "mode": "local", "no_conv": True, "steps": [
        S("GET", C), S("POST", C, T("手元で初めて")), S("GET", C),
    ]},
    {"name": "共有に届かない（写しから）", "mode": "unreachable", "steps": [
        S("GET", C), S("GET", f"{C}/export"), S("POST", C, T("x")), S("POST", f"{C}/import", {"items": [T("x")], "asDefault": True}),
        S("PUT", f"{C}/1", {"name": "x"}),
    ]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "lock": True, "steps": [
        S("GET", C), S("POST", C, T("x")), S("PUT", f"{C}/1", {"name": "x"}), S("DELETE", f"{C}/1"), S("POST", f"{C}/2/preset"),
        S("POST", f"{C}/import", {"items": [T("x")]}), S("POST", f"{C}/defaults", {"from": "bundled"}),
        S("POST", C, {"name": ""}),
    ]},
    {"name": "取り込みの標準を書く所で錠（変換表は書けたまま）", "mode": "shared", "between": True, "steps": [
        S("POST", f"{C}/import", {"items": [T("錠の前に書けた"), T("課名")], "asDefault": True}),
        S("GET", C),
    ]},
    {"name": "共有にまだ無い（写しから最初の版を置く）", "mode": "seed", "steps": [
        S("GET", C), S("GET", f"{C}/export", query="which=defaults"), S("POST", C, T("最初の版の後")), S("GET", C),
    ]},
    {"name": "共有にまだ無いまま取り込む", "mode": "seed", "steps": [
        S("POST", f"{C}/import", {"items": [T("最初に取り込む")], "asDefault": True}), S("GET", C),
    ]},
    {"name": "変換表がまだ空", "mode": "shared", "empty": True, "steps": [
        S("GET", C), S("POST", C, T("最初の表")), S("POST", f"{C}/import", {"items": [T("二つ目"), T("三つ目")]}),
        S("PUT", f"{C}/1", {"order": ""}), S("POST", C, T("四つ目", order="")), S("GET", C), S("GET", f"{C}/export"),
    ]},
    {"name": "置き場の行を窓が同じに読めない", "mode": "shared", "extra_rows": [
        {"id": 15, "名前": "大きな表示順", "入力": "[]", "判定": "[]", "表示順": "1" + "0" * 20, "rev": 1}], "steps": [], "delegates": [
        S("GET", C), S("GET", f"{C}/export"), S("POST", C, T("x")), S("PUT", f"{C}/1", {"name": "x"}),
        S("POST", f"{C}/import", {"items": [T("x")]})]},
    # 版 3.107.0（E3・E4）: 読めない行は隔てて答える（一覧は skipped・触れる直す・消す・標準に戻す・同じ名前の取り込みは断る・足すは通す）
    {"name": "置き場の行の版が読めない（行を隔てて答える）", "mode": "shared", "extra_rows": [{"id": 16, "名前": "版が字", "rev": "abc"}], "steps": [],
     "delegates": [W(x) for x in [S("GET", C), S("POST", C, T("x")), S("DELETE", f"{C}/16"), S("POST", f"{C}/16/preset"),
                                  S("POST", f"{C}/import", {"items": [T("版が字")]}), S("GET", f"{C}/export")]]},
    {"name": "置き場の判定の字が NaN（行を隔てて答える）", "mode": "shared", "extra_rows": [{"id": 17, "名前": "NaN の判定", "判定": '[{"when": {}, "out": NaN}]',
                                                                       "rev": 1}], "steps": [],
     "delegates": [W(x) for x in [S("GET", C), S("PUT", f"{C}/1", {"name": "x"}), S("PUT", f"{C}/17", {"name": "y"}),
                                  S("POST", f"{C}/defaults", {"from": "current"})]]},
]
# 作った後の採点で見つけた割れ: 共有にまだ無いとき、Python はその道が読むマスタだけに最初の版を置く（道ごとに 1 場面で、置かれるファイルを突き合わせる）
SEED_STEPS = [
    ("一覧", S("GET", C)),
    ("書き出し（今の表）", S("GET", f"{C}/export")),
    ("書き出し（標準）", S("GET", f"{C}/export", query="which=defaults")),
    ("足す（誤り）", S("POST", C, {"name": ""})),
    ("足す（表示順つき）", S("POST", C, T("順つき", order=5))),
    ("足す（表示順なし）", S("POST", C, T("順なし"))),
    ("直す（誤り）", S("PUT", f"{C}/1", {"name": ""})),
    ("直す", S("PUT", f"{C}/1", {"name": "直した"})),
    ("直す（無い行）", S("PUT", f"{C}/999", {"name": "x"})),
    ("消す（無い行）", S("DELETE", f"{C}/999")),
    ("消す", S("DELETE", f"{C}/12")),
    ("標準に戻す（無い行）", S("POST", f"{C}/999/preset")),
    ("標準に戻す（プリセットに無い）", S("POST", f"{C}/12/preset")),
    ("標準に戻す", S("POST", f"{C}/2/preset")),
    ("取り込む（誤り）", S("POST", f"{C}/import", {"items": []})),
    ("取り込む", S("POST", f"{C}/import", {"items": [T("取り込んだ")]})),
    ("取り込んで標準にも", S("POST", f"{C}/import", {"items": [T("取り込んだ")], "asDefault": True})),
    ("標準を決める（誤り）", S("POST", f"{C}/defaults", {"from": "x"})),
    ("標準を決める（今の表）", S("POST", f"{C}/defaults", {"from": "current"})),
    ("標準を決める（同梱）", S("POST", f"{C}/defaults", {"from": "bundled"})),
]
SCENARIOS += [{"name": f"共有にまだ無い（1 歩だけ）: {label}", "mode": "seed", "steps": [st]} for label, st in SEED_STEPS]


def place(root, sc):
    share, data = root / "share", root / "base" / "data"
    for d in (share, data, root / "local"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    conv = [] if sc.get("empty") else base_rows() + sc.get("extra_rows", [])
    own = []
    if sc.get("own"):
        own = [{"id": 1, "名前": "地取区分", "入力": j([{"name": "地取", "type": "text", "columns": ["地取区分"]}]),
                "判定": j([{"when": {}, "out": "標準を差し替えた"}]), "その他": "", "当て方": j({"mode": "replace"}), "表示順": "", "rev": 1}]
    masters = {"access_permissions": sc.get("perm") or perm(), "conversions": conv, "conversion_defaults": own}
    for n in ("path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns"):
        masters[n] = []
    cache = root / "local" / "master_cache"
    for name, rows in masters.items():
        if sc["mode"] == "local":
            if name == "conversion_defaults" and not rows or name == "conversions" and sc.get("no_conv"):
                continue
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] in ("unreachable", "seed") and name in ("conversions", "conversion_defaults"):
            cache.mkdir(parents=True, exist_ok=True)       # 共有に無い（届かない・まだ置いていない）: 写しだけがある（標準は写しにも無い）
            if name == "conversions":
                (cache / f"{name}.json").write_text(j(doc(rows, 5)), encoding="utf-8")
        elif sc["mode"] == "unreachable":
            cache.mkdir(parents=True, exist_ok=True)
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    if sc.get("lock"):
        (share / "master.lock.json").write_text(j(lock_doc()), encoding="utf-8")
    cfg = {"lot_list": {"source": "/配った/品質.sqlite3", "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"},
           "master_share": {} if sc["mode"] == "local" else {"dir": str(root / "届かない共有" if sc["mode"] == "unreachable" else share),
                                                               "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


def run(root, steps, between=False):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
    c = app.test_client()
    out = []
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    orig = MasterRepository.conversion_defaults_set

    def locked_between(self, rows):        # 変換表を書いた後・標準を書く前に、ほかの PC の錠を置く
        (root / "share" / "master.lock.json").write_text(j(lock_doc()), encoding="utf-8")
        return orig(self, rows)
    with mock.patch.object(MasterRepository, "conversion_defaults_set", locked_between if between else orig):
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
    out = []
    for i, sc in enumerate(SCENARIOS):
        py, rs, pd = (base / f"s{i}" / x for x in ("py", "rs", "pd"))
        for r in (py, rs, pd):
            place(r, sc)
        mine, theirs = oracle_gate.split(sc["steps"], sc.get("delegates", []))
        steps = run(py, mine, sc.get("between", False))
        dele = [{**x, "json": None} for x in run(pd, theirs)]     # 任せる歩は答えを比べない（NaN の答えもある）
        out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "steps": steps, "delegates": dele,
                    "between": j(lock_doc()) if sc.get("between") else None,
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
