# -*- coding: utf-8 -*-
"""転写距離・ピッチ計算の「正しい答え」を出す係（版 3.72.0。順 6 の 1 段目。desktop/tests/calc_parity.rs が呼ぶ）。

    python tests/calc_oracle.py 作業フォルダ

場面ごとに置き場（同梱の data/ を写し、設備マスタを場面の物に替える）と設定の calculation を作り、Python の道
（POST /api/calculate・POST /api/equipment/inspection）に本文を当てた答え（状態・本文）を出す。窓の試験は同じ置き場・設定で
desktop/src/calc.rs に同じ本文を当て、窓が答えた物は Python と同じか、答えなかった物（Python に任せる形）は must でないかを見る。
    {"scenarios": [{"name", "conf": 窓へ渡す {who, place}, "calculation": 設定, "cases": [{"name", "path", "body": 字, "must", "status", "json"}]}]}
同じ PC・同じ Python で流す（2 乗の pow の答えが OS の数学の部品で変わりうるため、焼いた表にしない）。
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
    {"id": 54, "設備名": "LS9", "同一工程": "LS*", "巻出し方向": "下", "巻取方向": "上", "ライン方向": "←"},
]
# ロールマスタに足す行（入出位置が空・同一工程の名前の設備・径が字）
ROLL_EXTRA = [
    {"id": 900, "設備": "LS9", "入出位置": "", "ロール径MAX": "194.2", "ロール径MIN": "", "ロール名": "空の位置", "基準番号": 7},
    {"id": 901, "設備": "ANF2", "入出位置": "入側", "ロール径MAX": 1.1, "ロール径MIN": "x", "ロール名": None},
    {"id": 902, "設備": "TLV", "入出位置": "ー", "ロール径MAX": "abc", "ロール名": "読めない径"},
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
    variant("厚さ 0 の発見設備", lambda ps: ps[7].update(thickness=0))
    variant("幅 0", lambda ps: ps[2].update(width=0))
    variant("番号が字・小数", lambda ps: [p.update(no=v) for p, v in zip(ps, ("1", 2, 3.0, " 4 ", 5, 6, 7, "8", 9, 10.9))])
    variant("同一工程の名前で出てくる設備", lambda ps: [p.update(equipment=v) for p, v in zip(ps, ("HOT", "l-1", " L-1 ", "Ｌ－１", "ANF3", "ANI9", "CAX", "TLV", "LS7", "KEN"))])
    variant("焼鈍を挟む", lambda ps: [ps[5].update(equipment="ANF"), ps[6].update(equipment="ANI")])
    variant("空の設備名", lambda ps: [ps[2].update(equipment=""), ps[9].update(equipment=None)])
    variant("発見設備が工程に無い（Python は IndexError）", lambda ps: None, must=False, inp=inputs(found="42:X"))
    variant("発見設備が工程に無く A が空（遡らない・found_t は int の 0）", lambda ps: None, inp={**inputs(found="42:X"), "soil_a_m": None})
    variant("番号の順が入れ替わる（Python は IndexError）", lambda ps: (ps[3].update(no=9), ps[8].update(no=4)), must=False)
    variant("下流の設備名が null（Python は例外）", lambda ps: ps[7].update(equipment=None), must=False, inp=inputs(found="7:X"))
    variant("設備名が数（Python は例外）", lambda ps: ps[2].update(equipment=5), must=False)
    variant("番号が読めない（Python は例外）", lambda ps: ps[2].update(no="x"), must=False)
    variant("厚さの鍵が無い（Python は例外）", lambda ps: ps[2].pop("thickness"), must=False)
    for fe in ("8.0", "abc", 8, " 8 :TLV", "8"):
        add(f"発見設備の書き方 {fe!r}", lot_l6183d0(), {**inputs(), "found_equipment": fe}, must=isinstance(fe, int) or fe in (" 8 :TLV", "8"))
    add("found_equipment が無い（Python は例外）", lot_l6183d0(), {k: v for k, v in inputs().items() if k != "found_equipment"}, must=False)
    add("found_pitch_mm が無い（Python は例外）", lot_l6183d0(), {k: v for k, v in inputs().items() if k != "found_pitch_mm"}, must=False)
    for pitch in (0, "x", 305.5, "１２３"):
        add(f"発見ピッチ {pitch!r}", lot_l6183d0(), {**inputs(), "found_pitch_mm": pitch})
    out.append(("lot が無い", "/api/calculate", j({"inputs": inputs()}), True))
    out.append(("lot が空", "/api/calculate", j({"lot": {}, "inputs": inputs()}), True))
    out.append(("inputs が無い（Python は例外）", "/api/calculate", j({"lot": lot_l6183d0()}), False))
    out.append(("本文が並び（Python は例外）", "/api/calculate", "[1]", False))
    out.append(("NaN（Python に任せる）", "/api/calculate", body(lot_l6183d0(), inputs()).replace('"soil_a_m": 1610.7', '"soil_a_m": NaN'), False))
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
    for names in (["TLV", "LS4", "ＡＮＦ２", "anf9", "ANI1", "KEN", "", "x", "CAF", "LS2"], "TL", [], None, [1, 2.5, True, None], ["TLV"] * 3 + [f"N{i}" for i in range(120)]):
        out.append((f"検査計 {str(names)[:30]}", "/api/equipment/inspection", j({"names": names}), True))
    out.append(("検査計: 名前が表（Python に任せる）", "/api/equipment/inspection", j({"names": [{"a": 1}]}), False))
    return out


SCENARIOS = [("設備マスタ（正しいデータ）・設定なし", EQUIP_PLAIN, CFG_DEFAULT),
             ("同一工程の名前・旧い列名・全部の設定", EQUIP_ALIAS, CFG_FULL),
             ("遡りの板厚比 found・エンドバックなし", EQUIP_ALIAS, CFG_FOUND)]


def place(root, equipment):
    shutil.copytree(PROGRAM / "data", root / "app" / "data")
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
    for i, (name, equipment, cfg) in enumerate(SCENARIOS):
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
            r = client.open(path, method="POST", data=text.encode("utf-8"), content_type="application/json")
            try:
                ans = r.get_json()
            except Exception:
                ans = None
            try:
                json.dumps(ans, allow_nan=False)
            except ValueError:
                ans, must = {"_nonfinite": True}, False      # 答えに NaN・inf（Python の json だけが書ける字）: 窓は Python に任せる
            cases.append({"name": cname, "path": path, "body": text, "must": must, "status": r.status_code, "json": ans})
        out.append({"name": name, "conf": conf, "calculation": calc, "cases": cases})
    sys.stdout.write(json.dumps({"scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
