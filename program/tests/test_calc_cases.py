"""転写距離・ピッチ計算の、人が手で確かめた値の事例の表（tests/fixtures/calc_cases.json。版 3.116.0）を Python の Calculator が満たすか。
窓は cargo test --test calc_cases が同じ表を読む（calc::calculate）。焼いた表（窓が自分の答えを焼いた物）とは別の第 2 の線。"""
import copy
import json
import math
import re
import unittest
from pathlib import Path

from app.repositories.master_repository import MasterRepository
from app.services.calculator import Calculator

from tests.test_calculator import inputs, lot_l6183d0

ROOT = Path(__file__).resolve().parents[1]
TABLE = json.loads((Path(__file__).parent / "fixtures" / "calc_cases.json").read_text(encoding="utf-8"))
ABSENT = object()


def lot_of(spec):
    spec = spec or {}
    if "rows" in spec:
        return {"lot_no": "T", "density": 2.73, "processes": [
            {"no": i + 1, "equipment": eq, "unwind": "上", "thickness": t, "width": w, "weight": kg, "design_split": 1,
             "horizontal_split": 1, "vertical_split": 1, "off_front_m": 0, "off_back_m": ob} for i, (eq, t, w, kg, ob) in enumerate(spec["rows"])]}
    lot = lot_l6183d0(spec.get("unwind", "上"))
    for i, patch in spec.get("set", []):
        lot["processes"][i].update(patch)
    lot.update(spec.get("top", {}))
    for k in spec.get("del", []):
        del lot[k]
    return lot


def inputs_of(case):
    i = {**inputs(), **case.get("inputs", {})}
    for k in case.get("inputsDel", []):
        del i[k]
    return i


def walk(v, path):
    """道 → 値（[*]・[has=欄] を通ると並び。欄が無ければ ABSENT）"""
    cur, many = [v], False
    for seg in path.split("."):
        m = re.fullmatch(r"([^\[\]]+)(?:\[(.*)\])?", seg)
        name, sel = m.group(1), m.group(2)
        nxt = []
        for c in cur:
            x = c.get(name, ABSENT) if isinstance(c, dict) else ABSENT
            if sel is None or x is ABSENT:
                nxt.append(x)
            elif sel == "*":
                nxt.extend(x)
            elif sel.startswith("has="):
                nxt.extend(e for e in x if sel[4:] in e)
            elif sel.startswith("no="):
                nxt.extend(e for e in x if e.get("no") == int(sel[3:]))
            else:
                nxt.append(x[int(sel)])
        many = many or (sel is not None and (sel == "*" or sel.startswith("has=")))
        cur = nxt
    return cur if many else cur[0]


def close(a, b, places=6):
    return isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(a) and round(a - b, places) == 0


def holds(got, op, args, results):
    each = got if isinstance(got, list) and op in (">", "absent") else [got]
    if op == "~":
        return close(got, args[0])
    if op == "!~":
        return not close(got, args[0], 3)
    if op == "=":
        return got == args[0] and not (isinstance(got, bool) ^ isinstance(args[0], bool))
    if op == ">":
        return all(x is not ABSENT and x > args[0] for x in each)
    if op == "null":
        return got is None
    if op == "absent":
        return all(x is ABSENT for x in each)
    if op == "~path":
        return close(got, walk(results[None], args[0]))
    if op in ("~case", "!=case"):
        other = walk(results[args[0]], args[1])
        return close(got, other) if op == "~case" else got != other
    raise AssertionError(f"知らない比べ方 {op}")


class CalcCases(unittest.TestCase):
    def test_python_satisfies_the_human_table(self):
        self.assertGreaterEqual(len(TABLE["cases"]), 30)
        self.assertGreaterEqual(sum(len(c["checks"]) for c in TABLE["cases"]), 90)
        results = {}
        for c in TABLE["cases"]:
            settings = {"calculation": copy.deepcopy(c["cfg"])} if "cfg" in c else {}
            results[c["name"]] = Calculator(settings, MasterRepository(ROOT)).calculate(lot_of(c.get("lot")), inputs_of(c))
        for c in TABLE["cases"]:
            res = {**results, None: results[c["name"]]}
            for path, op, *args in c["checks"]:
                with self.subTest(case=c["name"], path=path, op=op):
                    self.assertTrue(holds(walk(res[None], path), op, args, res), f"{c['name']}: {path} {op} {args}: {walk(res[None], path)!r}")


if __name__ == "__main__":
    unittest.main()
