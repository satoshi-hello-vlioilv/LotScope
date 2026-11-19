# -*- coding: utf-8 -*-
"""転写距離・ピッチ計算の「正しい答え」を出す係（版 3.72.0。順 6 の 1 段目。desktop/tests/calc_parity.rs が呼ぶ）。

    python tests/calc_oracle.py 作業フォルダ

場面ごとに置き場（同梱の data/ を写し、設備マスタを場面の物に替える）と設定の calculation を作り、Python の道
（POST /api/calculate・POST /api/equipment/inspection）に本文を当てた答え（状態・本文）を出す。窓の試験は同じ置き場・設定で
desktop/src/calc.rs に同じ本文を当て、窓が答えた物は Python と同じか、答えなかった物（Python に任せる形）は must でないかを見る。
    {"scenarios": [{"name", "conf": 窓へ渡す {who, place}, "calculation": 設定, "cases": [{"name", "path", "body": 字, "must", "status", "json"}]}]}
2 乗は C の pow のまま（利用者の決め。2026 年 11 月。掛け算に替えない）。版 3.116.0 から窓の答えを焼いた表（desktop/tests/baked/calc.json）にも持つ。
Windows で最後の桁が違う歩は、Windows の測るだけの仕事（desktop.yml）が数える。
"""
import copy
import json
import logging
import os
import random
import shutil
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
sys.path.insert(0, str(PROGRAM / "tests"))
os.environ.pop("TPA_SHELL", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from test_calculator import CORRECT_EQUIPMENT, inputs, lot_l6183d0  # noqa: E402


def j(x):
    return json.dumps(x, ensure_ascii=False)


EQUIP_PLAIN = [{"id": i + 1, "設備名": n, "巻取方向": rw, "ライン方向": ld, "検査計": "有" if n in ("TLV", "LS4", "KEN") else ""}
               for i, (n, rw, ld) in enumerate(CORRECT_EQUIPMENT)]
# 同一工程の名前・* ?・旧い列名（巻出し方向）・全角・空の名前・同じ名前が 2 行
EQUIP_ALIAS = copy.deepcopy(EQUIP_PLAIN) + [
    {"id": 50, "設備名": "ＡＮＦ２", "同一工程": "ANF3, anf*、ANI?", "巻出し方向": "上", "ライン方向": "→", "検査計": "有"},
    {"id": 51, "設備名": "CAL2", "同一工程": "CA?", "巻取方向": "下", "ライン方向": "←"},
    {"id": 52, "設備名": "", "同一工程": "X1"},
    {"id": 53, "設備名": "TLV", "巻取方向": "下", "ライン方向": "→", "検査計": "無"},
    {"id": 55, "設備名": "LX", "同一工程": "L*", "巻取方向": "上", "ライン方向": "→"},
    {"id": 56, "設備名": "KEN2", "同一工程": "KX, ANF3", "検査計": " 有 "},
    {"id": 54, "設備名": "LS9", "同一工程": "LS*", "巻出し方向": "下", "巻取方向": "上", "ライン方向": "←"},
]
# ロールマスタに足す行（入出位置が空・同一工程の名前の設備・径が字）
ROLL_EXTRA = [
    {"id": 900, "設備": "LS9", "入出位置": "", "ロール径MAX": "194.2", "ロール径MIN": "", "ロール名": "空の位置", "基準番号": 7},
    {"id": 901, "設備": "ANF2", "入出位置": "入側", "ロール径MAX": 1.1, "ロール径MIN": "x", "ロール名": None},
    {"id": 902, "設備": "TLV", "入出位置": "ー", "ロール径MAX": "abc", "ロール名": "読めない径"},
    {"id": 903, "設備": "TLV", "入出位置": "出側", "ロール径MAX": 0, "ロール径MIN": 0, "ロール名": "径 0"},
]
CFG_DEFAULT = {}
CFG_FULL = {"default_density": 2.7, "hot_inner_diameter_mm": 610, "default_inner_diameter_mm": 558,
            "equipment_inner_diameter_mm": {"L-2": 508, "TLV": "560.5", "LS4": "x"}, "end_back_equipment": ["L-", "LS"],
            "trace_ratio": "adjacent"}
CFG_FOUND = {**CFG_FULL, "trace_ratio": "found", "default_density": "2.65", "end_back_equipment": []}


def body(lot, inp):
    return j({"lot": lot, "inputs": inp})


def cases_for(rng):
    """本文の場面（名前, 道, 本文, 窓が答えるはずか）"""
    out = []

    def add(name, lot, inp, must=True):
        out.append((name, "/api/calculate", body(lot, inp), must))
    for f in range(1, 11):
        add(f"発見設備 {f}", lot_l6183d0(), inputs(found=f"{f}:X"))
    for un in ("上", "下", "-", "", " 上 "):
        add(f"巻出し {un!r}", lot_l6183d0(unwind=un), inputs())
    for a, b in ((None, None), (1610.7, None), (None, 1613.7), (0, 0), (0, 5), ("１６１０.７", "1_613.7"), (" 12 ", "abc"), (True, False)):
        i = inputs()
        i["soil_a_m"], i["soil_b_m"] = a, b
        add(f"汚れ位置 {a!r} {b!r}", lot_l6183d0(), i)
    i = inputs()
    del i["soil_a_m"]
    add("汚れ位置 A の鍵が無い", lot_l6183d0(), i)
    for tol in (None, 0, 2, 5, "7.5", 50):
        i = inputs()
        if tol is None:
            del i["tolerance_percent"]
        else:
            i["tolerance_percent"] = tol
        add(f"誤差 {tol!r}", lot_l6183d0(), i)
    for d in (None, 0, "x", "2.5", -1):
        lot = lot_l6183d0()
        if d is None:
            del lot["density"]
        else:
            lot["density"] = d
        add(f"比重 {d!r}", lot, inputs())
    # 工程の値を替える
    def variant(name, fn, must=True, inp=None):
        lot = lot_l6183d0()
        fn(lot["processes"])
        add(name, lot, inp or inputs(), must)
    variant("内径を入れる（0・負・字・数）", lambda ps: [p.update(inner_diameter_mm=v) for p, v in zip(ps, (0, -5, "abc", 600, "610.5", None, "", 500, 0.0, "１００"))])
    variant("巻取方向を入れる", lambda ps: [p.update(rewind_master=v) for p, v in zip(ps, ("上", "下", "-", "x", "", None, " 下 ", "上", 1, "下"))])
    variant("後オフを入れる（0 も）", lambda ps: [p.update(off_back_m=v) for p, v in zip(ps, (0, None, "", "3", 0.5, None, None, 0, None, "x"))])
    variant("後オフの自動（重さが減らない・空・エッジ）", lambda ps: [p.update(off_back_m=None, weight=w, width=wd) for p, w, wd in zip(ps, (6214, 6214, 6300, 6100, "", 0, 5854.9, 5511.5, 5121.3, 4935), (1200, 1250, 1200, 1100, 1200, 1200, 1210, 1179.8, 49.87, 49.9))])
    variant("分割（字・0・小数）", lambda ps: [p.update(design_split=s, vertical_split=v, horizontal_split=h) for p, s, v, h in zip(ps, ("2", 0, 1.5, None, "x", 3, 1, 1, 69, 69), (1, 2, "0.5", None, 1, 1, 1, 1, 1, 1), (1, 1, 2, "3", None, 1, 1, 1, 1, 1))])
    variant("幅が細り、横の分割がある（耳の幅）", lambda ps: [p.update(width=w, horizontal_split=h) for p, w, h in zip(ps, (1300, 1250, 1200, 600, 590, 580, 300, 290, 49.87, 49.9), (1, 1, 2, 2, "2", 1, 4, 1, 6, 1))])
    variant("厚さ 0 の工程", lambda ps: ps[3].update(thickness=0))
    variant("番号の重複（同じ鍵の origins は後の値・最初の位置）", lambda ps: [ps[2].update(no=2), ps[5].update(no=5)])
    variant("同じ発見の番号で厚さが違う（found_t は最初の工程）", lambda ps: [ps[8].update(no=8, thickness=0.3)], inp=inputs(found="8:X"))
    variant("横の分割が nan・字", lambda ps: [ps[3].update(horizontal_split="nan"), ps[4].update(horizontal_split="2"), ps[2].update(width=900)])
    variant("番号が i64 に入らない字（Python は範囲外として扱う）", lambda ps: ps[3].update(no="99999999999999999999"))
    add("found_equipment が i64 に入らない字", lot_l6183d0(), {**inputs(), "found_equipment": "9223372036854775807:TLV"})
    add("誤差 100%（径 0 のロールも当たりうる）", lot_l6183d0(), {**inputs(), "tolerance_percent": 100})
    variant("厚さ 0 の発見設備", lambda ps: ps[7].update(thickness=0))
    variant("幅 0", lambda ps: ps[2].update(width=0))
    variant("番号が字・小数", lambda ps: [p.update(no=v) for p, v in zip(ps, ("1", 2, 3.0, " 4 ", 5, 6, 7, "8", 9, 10.9))])
    variant("同一工程の名前で出てくる設備", lambda ps: [p.update(equipment=v) for p, v in zip(ps, ("HOT", "l-1", " L-1 ", "Ｌ－１", "ANF3", "ANI9", "CAX", "TLV", "LS7", "KEN"))])
    variant("焼鈍を挟む", lambda ps: [ps[5].update(equipment="ANF"), ps[6].update(equipment="ANI")])
    variant("空の設備名", lambda ps: [ps[2].update(equipment=""), ps[9].update(equipment=None)])
    variant("発見設備が工程に無い（Python は IndexError）", lambda ps: None, inp=inputs(found="42:X"))
    variant("発見設備が工程に無く A が空（遡らない・found_t は int の 0）", lambda ps: None, inp={**inputs(found="42:X"), "soil_a_m": None})
    variant("番号の順が入れ替わる（Python は IndexError）", lambda ps: (ps[3].update(no=9), ps[8].update(no=4)))
    variant("下流の設備名が null（Python は例外）", lambda ps: ps[7].update(equipment=None), inp=inputs(found="7:X"))
    variant("設備名が数（Python は例外）", lambda ps: ps[2].update(equipment=5))
    variant("番号が読めない（Python は例外）", lambda ps: ps[2].update(no="x"))
    variant("厚さの鍵が無い（Python は例外）", lambda ps: ps[2].pop("thickness"))
    for fe in ("8.0", "abc", 8, " 8 :TLV", "8"):
        add(f"発見設備の書き方 {fe!r}", lot_l6183d0(), {**inputs(), "found_equipment": fe})
    add("found_equipment が無い（Python は例外）", lot_l6183d0(), {k: v for k, v in inputs().items() if k != "found_equipment"})
    add("found_pitch_mm が無い（Python は例外）", lot_l6183d0(), {k: v for k, v in inputs().items() if k != "found_pitch_mm"})
    for pitch in (0, "x", 305.5, "１２３"):
        add(f"発見ピッチ {pitch!r}", lot_l6183d0(), {**inputs(), "found_pitch_mm": pitch})
    out.append(("lot が無い", "/api/calculate", j({"inputs": inputs()}), True))
    out.append(("lot が空", "/api/calculate", j({"lot": {}, "inputs": inputs()}), True))
    out.append(("inputs が無い（Python は例外）", "/api/calculate", j({"lot": lot_l6183d0()}), True))
    out.append(("本文が並び（本文の門が断る）", "/api/calculate", "[1]", True))
    out.append(("NaN（本文の門が断る）", "/api/calculate", body(lot_l6183d0(), inputs()).replace('"soil_a_m": 1610.7', '"soil_a_m": NaN'), True))
    out.extend(overlaps())
    # 小数のオフの厚さ（2 乗の pow の違いを出す）。乱数の種は固定
    for k in range(160):
        lot = lot_l6183d0()
        for p in lot["processes"]:
            p["off_front_thickness_mm"] = round(rng.uniform(0, 40), rng.choice((1, 2, 3)))
            p["off_back_thickness_mm"] = round(rng.uniform(0, 40), rng.choice((1, 2, 3)))
            p["inner_diameter_mm"] = rng.choice((None, round(rng.uniform(400, 700), 2)))
            p["thickness"] = round(p["thickness"] * rng.uniform(0.9, 1.1), 3)
        add(f"乱数 {k}", lot, inputs(found=f"{rng.randint(1, 10)}:X", a=round(rng.uniform(0, 3000), 2), b=round(rng.uniform(0, 3000), 2)))
    # 設備ごとに検査計があるか
    for names in (["TLV", "LS4", "ＡＮＦ２", "anf9", "ANI1", "KEN", "", "x", "CAF", "LS2", "KEN2", "KX", "ANF3"], "TL", [], None, [1, 2.5, True, None], ["TLV"] * 3 + [f"N{i}" for i in range(120)]):
        out.append((f"検査計 {str(names)[:30]}", "/api/equipment/inspection", j({"names": names}), True))
    out.append(("検査計: 名前が表（str は repr の字）", "/api/equipment/inspection", j({"names": [{"a": 1}]}), True))
    out.append(("検査計: 名前が並びの中の並び・null・大きな整数", "/api/equipment/inspection", '{"names": [[1, "x"], null, 123456789012345678901234567890, 1.5]}', True))
    for odd in ({"TLV": 1, "x": 2}, 5, True, 1.5, 0, False):
        out.append((f"検査計: names が {odd!r}（並びでない。本文の門が断る・偽の値は空）", "/api/equipment/inspection", j({"names": odd}), True))
    out.append(("検査計: 本文が空", "/api/equipment/inspection", "", True))
    return out


def overlaps():
    """誤りを 2 つ重ねた本文と、形の違う本文（版 3.116.0。採点の first_fixes 11）。窓は Python の評価の順を写すので、どの誤りが先に出るかまで
    同じかを見る。(名前, 道, 本文, True)"""
    out = []

    def add(name, lot, inp):
        out.append((name, "/api/calculate", body(lot, inp), True))

    def lot_with(fn):
        lot = lot_l6183d0()
        fn(lot["processes"])
        return lot

    def without(d, *keys):
        return {k: v for k, v in d.items() if k not in keys}
    # 欄が無い × 数でない: 先に読む方（found_equipment → found_pitch_mm → 工程の番号 → 厚さ）
    add("重ね: found_equipment が無い × 番号が読めない", lot_with(lambda ps: ps[0].update(no="x")), without(inputs(), "found_equipment"))
    add("重ね: found_equipment が読めない × found_pitch_mm が無い", lot_l6183d0(), without({**inputs(), "found_equipment": "abc"}, "found_pitch_mm"))
    add("重ね: found_pitch_mm が無い × 番号が読めない", lot_with(lambda ps: ps[0].update(no="x")), without(inputs(), "found_pitch_mm"))
    add("重ね: 番号が読めない（3 つ目）× 厚さが無い（1 つ目）", lot_with(lambda ps: (ps[2].update(no="x"), ps[0].pop("thickness"))), inputs())
    add("重ね: 番号が読めない（発見より後ろ）× 設備名が数（1 つ目）", lot_with(lambda ps: (ps[9].update(no="x"), ps[0].update(equipment=5))), inputs())
    add("重ね: 番号が読めない（発見より後ろ・焼鈍）: A が空なら読まない", lot_with(lambda ps: ps[9].update(no="x", equipment="ANF")), {**inputs(), "soil_a_m": None})
    add("重ね: 番号が読めない（発見より後ろ・焼鈍）: A があれば遡りで読む", lot_with(lambda ps: ps[9].update(no="x", equipment="ANF")), inputs())
    add("重ね: 番号が無い（発見より後ろ・焼鈍でない）", lot_with(lambda ps: ps[9].pop("no")), inputs())
    add("重ね: 番号が無い（1 つ目）× found_equipment が読めない", lot_with(lambda ps: ps[0].pop("no")), {**inputs(), "found_equipment": "x"})
    add("重ね: 発見の工程の厚さが無い × 1 つ目の設備名が無い", lot_with(lambda ps: (ps[7].pop("thickness"), ps[0].pop("equipment"))), inputs())
    add("重ね: 1 つ目の設備名が無い × 2 つ目の厚さが無い", lot_with(lambda ps: (ps[0].pop("equipment"), ps[1].pop("thickness"))), inputs())
    add("重ね: 幅が無い × 重さが無い（同じ工程）", lot_with(lambda ps: (ps[2].pop("width"), ps[2].pop("weight"))), inputs())
    add("重ね: 重さが無い（1 つ目）× 厚さが無い（2 つ目・冷延）", lot_with(lambda ps: (ps[0].pop("weight"), ps[1].pop("thickness"))), inputs())
    add("重ね: 前工程の重さが 0 なら今の工程の重さは後で読む", lot_with(lambda ps: (ps[0].update(weight=0), ps[1].pop("weight"))), inputs())
    add("重ね: 設備名が数（3 つ目）× 厚さが無い（2 つ目）", lot_with(lambda ps: (ps[2].update(equipment=5), ps[1].pop("thickness"))), inputs())
    add("重ね: 設備名が並び × 巻出しが数", lot_with(lambda ps: (ps[3].update(equipment=["x"]), ps[1].update(unwind=7))), inputs())
    add("重ね: 巻出しが数（2 つ目）× 発見設備が工程に無い", lot_with(lambda ps: ps[1].update(unwind=7)), inputs(found="42:X"))
    add("重ね: 巻出しが数（1 つ目は比べない）", lot_with(lambda ps: ps[0].update(unwind=7)), inputs())
    add("重ね: 巻出しが数（焼鈍は比べない）", lot_with(lambda ps: ps[5].update(unwind=7, equipment="ANF")), inputs())
    add("重ね: 発見設備が工程に無い × 下流の設備名が null", lot_with(lambda ps: ps[9].update(equipment=None)), inputs(found="42:X"))
    add("重ね: 遡る途中の下流の設備名が null", lot_with(lambda ps: ps[5].update(equipment=None)), inputs())
    add("重ね: 遡る途中の下流の設備名が 0", lot_with(lambda ps: ps[5].update(equipment=0)), inputs())
    add("重ね: 番号の順が入れ替わる × 遡る途中の設備名が null", lot_with(lambda ps: (ps[3].update(no=9), ps[8].update(no=4), ps[5].update(equipment=None))), inputs())
    add("重ね: 番号が null × found_pitch_mm が字", lot_with(lambda ps: ps[1].update(no=None)), {**inputs(), "found_pitch_mm": "x"})
    add("重ね: 番号が並び", lot_with(lambda ps: ps[1].update(no=[1])), inputs())
    add("重ね: 番号が 4,301 桁の字 × 厚さが無い", lot_with(lambda ps: (ps[1].update(no="9" * 4301), ps[0].pop("thickness"))), inputs())
    add("重ね: found_equipment が並び・表・null・真偽", lot_l6183d0(), {**inputs(), "found_equipment": [8, "TLV"]})
    add("found_equipment が表", lot_l6183d0(), {**inputs(), "found_equipment": {"a": 1}})
    add("found_equipment が null", lot_l6183d0(), {**inputs(), "found_equipment": None})
    add("found_equipment が真", lot_l6183d0(), {**inputs(), "found_equipment": True})
    add("found_equipment が小数", lot_l6183d0(), {**inputs(), "found_equipment": 8.5})
    # 形の違う本文
    for name, text in (
            ("lot が並び", j({"lot": [1], "inputs": inputs()})),
            ("lot が字", j({"lot": "x", "inputs": inputs()})),
            ("lot が数", j({"lot": 5, "inputs": inputs()})),
            ("lot が真 × inputs が無い", j({"lot": True})),
            ("processes が無い × found_equipment が無い", j({"lot": {"density": 2.7}, "inputs": {}})),
            ("processes が null", j({"lot": {"processes": None}, "inputs": inputs()})),
            ("processes が数", j({"lot": {"processes": 3}, "inputs": inputs()})),
            ("processes が字", j({"lot": {"processes": "ab"}, "inputs": inputs()})),
            ("processes が空の字（工程なし）", j({"lot": {"processes": ""}, "inputs": inputs()})),
            ("processes が表（鍵を回す）", j({"lot": {"processes": {"a": 1}}, "inputs": inputs()})),
            ("processes が空の鍵の表（空の工程）", j({"lot": {"processes": {"": 1}}, "inputs": inputs()})),
            ("processes が空（工程なし）", j({"lot": {"processes": []}, "inputs": inputs()})),
            ("processes が空で A が空", j({"lot": {"processes": []}, "inputs": {**inputs(), "soil_a_m": None}})),
            ("工程が null", j({"lot": {"processes": [None]}, "inputs": inputs()})),
            ("工程が数", j({"lot": {"processes": [lot_l6183d0()["processes"][0], 5]}, "inputs": inputs()})),
            ("工程が字", j({"lot": {"processes": ["abc"]}, "inputs": inputs()})),
            ("工程が空の字（空の工程）", j({"lot": {"processes": [""]}, "inputs": inputs()})),
            ("工程が空の並び（空の工程）", j({"lot": {"processes": [[]]}, "inputs": inputs()})),
            ("工程が組の並び", j({"lot": {"processes": [[["no", 8], ["equipment", "TLV"], ["thickness", 0.5], ["width", 1000], ["weight", 5000]]]}, "inputs": inputs()})),
            ("工程が組の並び（2 字の字・鍵 2 つの表）", j({"lot": {"processes": [["ab", {"no": 1, "x": 2}]]}, "inputs": inputs()})),
            ("工程の組が 3 つ", j({"lot": {"processes": [[[1, 2, 3]]]}, "inputs": inputs()})),
            ("工程の組の鍵が数（計算は進み、答えを書くときに鍵を並べられない）", j({"lot": {"processes": [[["no", 8], ["equipment", "TLV"], ["thickness", 0.5], ["width", 1000], ["weight", 5000], [1, 2]]]}, "inputs": inputs()})),
            ("工程の組の鍵が数だけ（番号が無い）", j({"lot": {"processes": [[[1, 2], [None, 3], [True, 4]]]}, "inputs": inputs()})),
            ("工程の組の鍵が数 × 厚さが無い", j({"lot": {"processes": [[["no", 8], ["equipment", "TLV"], [1.5, 2]]]}, "inputs": inputs()})),
            ("工程の組が数", j({"lot": {"processes": [[5]]}, "inputs": inputs()})),
            ("工程の組の鍵が並び", j({"lot": {"processes": [[[[1], 2]]]}, "inputs": inputs()})),
            ("inputs が並び", j({"lot": lot_l6183d0(), "inputs": [1]})),
            ("inputs が字", j({"lot": lot_l6183d0(), "inputs": "x"})),
            ("inputs が null", j({"lot": lot_l6183d0(), "inputs": None})),
            ("inputs が数 × processes が無い", j({"lot": {"a": 1}, "inputs": 5})),
            ("本文が空の並び（lot が無い）", "[]"),
            ("本文が null（lot が無い）", "null"),
            ("本文が空（本文の門が断る）", ""),
            ("番号が大きな整数（数）", body(lot_l6183d0(), inputs()).replace('"no": 4,', '"no": 123456789012345678901234567890,')),
            ("発見設備が大きな整数（数）", body(lot_l6183d0(), {**inputs(), "found_equipment": 0}).replace('"found_equipment": 0', '"found_equipment": 123456789012345678901234567890')),
            ("発見ピッチが 400 桁の整数（float にあふれる）", body(lot_l6183d0(), {**inputs(), "found_pitch_mm": 0}).replace('"found_pitch_mm": 0', '"found_pitch_mm": 1' + "0" * 400)),
            ("汚れ位置が 400 桁の整数 × 番号が読めない", body(lot_with(lambda ps: ps[0].update(no="x")), {**inputs(), "soil_a_m": 0}).replace('"soil_a_m": 0', '"soil_a_m": 1' + "0" * 400)),
            ("重さが大きな整数（数）", body(lot_l6183d0(), inputs()).replace('"weight": 6214,', '"weight": 123456789012345678901234567890,', 1)),
            ("オフの厚さが 1e200（2 乗があふれる）", body(lot_with(lambda ps: ps[1].update(off_front_thickness_mm=1e200)), inputs())),
            ("内径が 1e200（r の 2 乗があふれる）", body(lot_with(lambda ps: ps[1].update(inner_diameter_mm=1e200)), inputs())),
            ("厚さが nan の字（答えに NaN → null）", body(lot_with(lambda ps: ps[3].update(thickness="nan")), inputs())),
            ("重さが inf の字（答えに inf → null）", body(lot_with(lambda ps: ps[3].update(weight="inf")), inputs())),
            ("汚れ位置が inf の字", body(lot_l6183d0(), {**inputs(), "soil_a_m": "inf", "soil_b_m": "-inf"})),
            ("発見ピッチが nan の字", body(lot_l6183d0(), {**inputs(), "found_pitch_mm": "nan"})),
            ("比重が 1e308 の字（長さが 0 に近い）", body({**lot_l6183d0(), "density": "1e308"}, inputs())),
            ("幅が 1e308（掛け算があふれて inf）", body(lot_with(lambda ps: ps[2].update(width=1e308)), inputs())),
    ):
        out.append((name, "/api/calculate", text, True))
    return out


SCENARIOS = [("設備マスタ（正しいデータ）・設定なし", EQUIP_PLAIN, CFG_DEFAULT),
             ("同一工程の名前・旧い列名・全部の設定", EQUIP_ALIAS, CFG_FULL),
             ("遡りの板厚比 found・エンドバックなし", EQUIP_ALIAS, CFG_FOUND)]
# 設定・マスタの形が違う場面（版 3.116.0。本文は SMALL の名前だけ。Python が設定を読む所で例外になる順も窓が写す）
EQUIP_NUM = copy.deepcopy(EQUIP_PLAIN) + [{"id": 60, "設備名": 5, "巻取方向": "上"}]
EQUIP_DIR = copy.deepcopy(EQUIP_PLAIN) + [{"id": 61, "設備名": "ZZ", "巻取方向": 3, "ライン方向": ["→"]}]
ROLL_NUM = [{"id": 910, "設備": 7, "入出位置": "出側", "ロール径MAX": 100}, {"id": 911, "設備": "TLV", "入出位置": 0, "ロール径MAX": 123456789012345678901234567890}]
SMALL = ("発見設備 1", "発見設備 8", "巻出し '下'", "汚れ位置 None None", "比重 0", "比重 None", "空の設備名", "焼鈍を挟む", "lot が無い",
         "found_equipment が無い（Python は例外）", "重ね: found_equipment が読めない × found_pitch_mm が無い", "厚さの鍵が無い（Python は例外）",
         "重ね: 番号が読めない（3 つ目）× 厚さが無い（1 つ目）", "発見設備が工程に無い（Python は IndexError）", "processes が空（工程なし）",
         "同一工程の名前で出てくる設備", "誤差 100%（径 0 のロールも当たりうる）")
ODD = [("設定が並び", EQUIP_PLAIN, [1]), ("設定が null", EQUIP_PLAIN, None), ("設定が字", EQUIP_PLAIN, "x"), ("設定が数", EQUIP_PLAIN, 0),
       ("内径の表が並び（設備名を含む）", EQUIP_PLAIN, {"equipment_inner_diameter_mm": ["TLV", 5]}),
       ("内径の表が並び（含まない）", EQUIP_PLAIN, {"equipment_inner_diameter_mm": ["XX"], "hot_inner_diameter_mm": "600", "default_inner_diameter_mm": None}),
       ("内径の表が字（設備名を含む）", EQUIP_PLAIN, {"equipment_inner_diameter_mm": "xL-1x"}),
       ("内径の表が字（含まない）", EQUIP_PLAIN, {"equipment_inner_diameter_mm": "QQQ"}),
       ("内径の表が数", EQUIP_PLAIN, {"equipment_inner_diameter_mm": 5}),
       ("内径の表が真", EQUIP_PLAIN, {"equipment_inner_diameter_mm": True}),
       ("内径の表が 0（空と同じ）", EQUIP_PLAIN, {"equipment_inner_diameter_mm": 0, "default_density": "x"}),
       ("エンドバックの並びに数（当たった後ろ）", EQUIP_PLAIN, {"end_back_equipment": ["H", "L-", 5]}),
       ("エンドバックの並びに数（当たる前）", EQUIP_PLAIN, {"end_back_equipment": [5, "L-"]}),
       ("エンドバックが字（1 字ずつ）", EQUIP_PLAIN, {"end_back_equipment": "LT"}),
       ("エンドバックが空の字", EQUIP_PLAIN, {"end_back_equipment": ""}),
       ("エンドバックが null", EQUIP_PLAIN, {"end_back_equipment": None}),
       ("エンドバックが表（鍵）", EQUIP_PLAIN, {"end_back_equipment": {"L-": 1, "T": 2}}),
       ("エンドバックが数", EQUIP_PLAIN, {"end_back_equipment": 5}),
       ("遡りの板厚比が null・比重が真", EQUIP_PLAIN, {"trace_ratio": None, "default_density": True}),
       ("遡りの板厚比が並び", EQUIP_PLAIN, {"trace_ratio": ["found"]}),
       ("設備マスタの設備名が数", EQUIP_NUM, CFG_DEFAULT),
       ("設備マスタの巻取方向が数・ライン方向が並び", EQUIP_DIR, CFG_DEFAULT),
       ("ロールマスタの設備が数・入出位置が 0・径が大きな整数", (EQUIP_PLAIN, ROLL_NUM), CFG_DEFAULT)]


def place(root, equipment):
    shutil.copytree(PROGRAM / "data", root / "app" / "data")
    if isinstance(equipment, tuple):
        equipment, rolls = equipment
        base = json.loads((PROGRAM / "data" / "roll_master.json").read_text(encoding="utf-8"))
        (root / "app" / "data" / "roll_master.json").write_text(j((base["rows"] if isinstance(base, dict) else base) + rolls), encoding="utf-8")
    (root / "app" / "data" / "equipment_master.json").write_text(j(equipment), encoding="utf-8")
    if equipment is EQUIP_ALIAS:
        rolls = json.loads((PROGRAM / "data" / "roll_master.json").read_text(encoding="utf-8"))
        rows = rolls["rows"] if isinstance(rolls, dict) else rolls
        (root / "app" / "data" / "roll_master.json").write_text(j(rows + ROLL_EXTRA), encoding="utf-8")
    (root / "local").mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    from app.routes.lotlist import _access_place
    from app.web import Request, _app_var, _request_var
    out = []
    for i, (name, equipment, cfg) in enumerate(SCENARIOS + ODD):
        root = base / f"s{i}"
        place(root, equipment)
        app = create_app({"TESTING": True, "MASTER_STORE": MasterStore(root / "app", local_root=root / "local", settings={"refresh_seconds": 0})})
        app.config["APP_SETTINGS"]["calculation"] = copy.deepcopy(cfg)
        client = app.test_client()
        t1, t2 = _app_var.set(app), _request_var.set(Request("GET", "/api/lotlist/settings"))
        try:
            conf = _access_place()
            calc = client.get("/api/lotlist/settings").get_json().get("calculation")
        finally:
            _request_var.reset(t2)
            _app_var.reset(t1)
        cases = []
        for cname, path, text, must in cases_for(random.Random(1234 + i)):
            if i >= len(SCENARIOS) and cname not in SMALL and not cname.startswith("検査計"):
                continue
            r = client.open(path, method="POST", data=text.encode("utf-8"), content_type="application/json")
            try:
                ans = r.get_json()
            except Exception:
                ans = None
            # 版 3.116.0: 窓はどの形も答える（must でない歩は無い。前は Python が例外で答える形・大きな整数・NaN の出る形を任せた）。
            # 答えの字はそのまま（大きな整数の桁を json.loads → dumps で保つ。NaN は web.dumps が null にしてある）
            # 乱数の事例は Python とは 160 件を比べ、焼いた表には 40 件を持つ（"bake": False は焼かない。採点の first_fixes 5）
            unbaked = cname.startswith("乱数 ") and int(cname.split()[1]) >= 40
            cases.append({"name": cname, "path": path, "body": text, "must": must, "status": r.status_code, "json": ans,
                          **({} if must else {"delegate": True}), **({"bake": False} if unbaked else {})})
        # 窓へ渡すのは置き場だけ（名乗り who は流した PC の名前と利用者で変わるので、焼いた表の問い合わせに入れない。版 3.116.0）
        out.append({"name": name, "conf": {"place": conf["place"]}, "calculation": calc, "cases": cases})
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
