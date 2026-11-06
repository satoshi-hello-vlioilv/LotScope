# -*- coding: utf-8 -*-
"""ダッシュボードの中身の確かめ（services/dashboard.py の clean_layout・clean_hide_body・condition_of）の答えを事例の表に焼く（版 3.81.0）。

窓の部品 desktop/src/layout_clean.rs は、この表（tests/fixtures/layout_cases.json）と同じ答えを出すか（cargo test --test layout_cases）で確かめる。
事例は [関数, 入力の JSON の字, 鍵] で、入力は送った順のまま（JSON の字）で持つ。答えは ok（中身と置く字）・error（LayoutError の理由）・
crash（Python が道の外の例外で落ちる）のどれか。"py" の印の事例は、窓が答えず Python に任せる形（窓は Stop::Py を返すこと）。

    python program/tools/layout-cases.py           … 焼く
    python program/tools/layout-cases.py --check   … 焼いた表が今の Python の答えと同じか（違えば終了コード 1）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import dashboard as db  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "layout_cases.json"


def j(x):
    return json.dumps(x, ensure_ascii=False)


def P(pid="a", x=0, y=0, w=4, h=2, visual="bar", source="work", **kw):
    return {"id": pid, "x": x, "y": y, "w": w, "h": h, "title": kw.pop("title", ""), "visual": visual, "source": source,
            "body": kw.pop("body", {"rows": [{"column": "@workday"}], "measures": [{"agg": "lots"}]}), **kw}


def L(*panels, rows=8, **kw):
    return {"rows": rows, "panels": list(panels), **kw}


def lay(x):
    return ["layout", j(x)]


CASES = []


def add(fn, text, key=None, py=False):
    CASES.append({"fn": fn, "in": text, **({"key": key} if key is not None else {}), **({"py": True} if py else {})})


# ---- 組み込み・ふつうの形
for b in db.BUILTIN_LAYOUTS:
    add(*lay(b["body"]))
add(*lay(L()))
add(*lay(L(P(), P("b", x=4), P("c", x=8, visual="kpi", body={"measures": [{"agg": "sum", "column": "重量"}]}))))
# ---- 大きさ・置き場・id の付け直し・重なり
add(*lay(L(P("a"), P("a", x=4), P("p3", x=8))))
add(*lay(L(P("p2"), P(None, x=4), P("p2", x=8))))
add(*lay(L(P("a", w=4.9, h=True, x="1_0"), rows=" 6 ")))
add(*lay(L(P("a", w="9" * 5000), rows=4)))
add(*lay(L(P("a", w="5\x1c"))), py=True)
add(*lay(L(P("a", w="４"))), py=True)
add(*lay(L(P("a", x=0, w=6), P("b", x=3, w=6, title="二"))))
add(*lay(L(P("bad id!", w=20, h=40, x=-3, y=99), rows=100)))
add(*lay(L(*[P(f"q{k}", x=(k % 3) * 4, y=k // 3, h=1) for k in range(25)], rows=16)))
add(*lay(L(rows="abc")))
add(*lay("not json"))
add(*lay([1]))
add(*lay("[1]"))
add(*lay(j(L(P()))))
# ---- 形・見せ方・書式
add(*lay(L(P(visual="nosuch"), P("b", x=4, frame="night"), P("c", x=8, emph=1, noslice=True))))
add(*lay(L(P(fmt={"labels": "top", "xdate": "md", "xrot": "45", "unit": "man", "legend": "none", "size": "l", "palette": "vivid", "kpi": "gauge",
               "digits": "2", "ymin": "1_0", "ymax": 5, "target": True, "grid": False,
               "refs": [{"value": "3.5", "label": "  線  ", "color": "#ABCDEF"}, {"value": None}, "x", {"value": 1, "color": "red"}, {"value": 2}, {"value": 3}],
               "colors": {"x" * 121: "#000000", "x" * 120: "#111111", "  ": "#222222", "b": "#zzzzzz", **{f"k{n:02d}": "#123456" for n in range(45)}},
               "series": {"s1": {"label": "below", "dash": True, "kind": "line", "axis": "right"}, "s2": {"dash": 1}, "s3": "x"},
               "num": "  #,##0.0  ", "numUi": {"cat": "pct", "dec": "9", "sep": False, "neg": "paren", "pre": "¥" * 20, "suf": "本"},
               "align": "center", "valign": "bottom", "nsize": "xl", "bold": "off", "style": "grad", "ncolor": "#FF0000",
               "expr": " ÷１０００ ", "utext": "  本/日  "}))))
add(*lay(L(P(fmt={"palette": "custom", "pcolors": ["#AABBCC", "red", 5, "#00ff00"] + ["#111111"] * 12, "ymin": 5, "ymax": 1, "expr": "x+abc"}))))
add(*lay(L(P(fmt={"palette": "custom", "pcolors": [], "labels": "auto", "size": "m", "kpi": "num", "digits": -1}))))
add(*lay(L(P(fmt={"colors": {"a": "#000000"}, "series": {}, "num": ""}))))
add(*lay(L(P(fmt={"colors": {"\x1c": "#000000", "\u3000": "#111111", "a": "#222222"}, "series": {"\x1f": {"dash": True}, "s": {"dash": True}}}))))   # 空白は str.strip（\x1c〜\x1f・全角空白も）
add(*lay(L(P(fmt={"ymin": "inf", "ymax": "nan", "target": "1e400", "refs": [{"value": "1e3"}]}))))
add(*lay(L(P(fmt={"ymin": "１"}))), py=True)
# ---- 値・段・条件・期間・計算列
add(*lay(L(P(body={"rows": [{"column": "a", "part": "ym", "width": 2.5}, {"column": ""}, {"column": 5}, {"column": "b"}, {"column": "c"}],
                   "cols": [{"column": "d", "part": 3}], "sub": 1, "grand": 0, "chartAt": "2", "labels": None,
                   "measures": [{"agg": "sum", "column": "重量", "expr": "x/1000", "dec": "2.5", "show": "cum"},
                                {"agg": "avg", "column": "", "expr": "x"}, {"agg": "pct", "column": "w", "p": 2.5},
                                {"agg": "cpk", "column": "w", "lsl": 5, "usl": 1}, {"agg": "cpk", "column": "w", "usl": "3"},
                                {"agg": "sum", "column": "w", "expr": "x+"}, {"agg": "bad"}, {"agg": "lots", "column": "x"}]},
             visual="none", filters=[{"column": " 工程 ", "op": " = ", "value": {"b": 1, "a": 2}}, {"column": "x", "op": "in", "value": "[\"a\"]", "key": "month"},
                                     {"column": "", "op": "="}, {"column": "y", "op": "contains", "value": None}, {"column": "z", "op": "=", "value": False},
                                     {"column": "t", "op": "=", "value": [1.5, True, None, "字"]}, "x"] + [{"column": f"c{k}", "op": "="} for k in range(25)],
             search="  検索  ", period={"column": " @workday ", "kind": "days", "n": "30"}, basis="cal",
             equips=[" CR1 ", "CR1", "", None, 5, "x" * 200], calc={"formulas": {"\x1c": "1", "a": "\x1c", "b": "1+1", "  ": "2", "c": 5}, "names": {"a": "名", "b": 5},
                                                                    "own": ["b", "a", "zz", 5], "equips": {"HOT": {"formulas": {"x": "2"}}, "": {"formulas": {"y": "1"}}, "Z": 5}},
             sort="desc", top="7", esplit="facet", eorder=["L-1", "L-1", "CR1"], egroup={"mode": "panel", "rest": "other",
                                                                                          "groups": [{"name": " A ", "members": ["CR1", "CR2"]}, {"name": ""}, "x"]}))))
add(*lay(L(P(calc=j({"formulas": {"a": "1"}}), period={"column": "日付", "kind": "range", "from": "２０２６-１０-０１", "to": "2026-09-30x"}),
           P("b", x=4, calc="  ", period={"column": "d", "kind": "range", "from": "x"}),
           P("c", x=8, calc="{bad", period={"column": "", "kind": "days"}, egroup={"mode": "sum", "name": "  "}, equips="CR1"))))
add(*lay(L(P(egroup={"mode": "master", "set": "  ライン別  "}), P("b", x=4, egroup={"mode": "master", "set": ""}),
           P("c", x=8, egroup={"mode": "panel", "groups": []}, esplit="bad", source="src:abc"))))
add(*lay(L(P(source="bad"))))
add(*lay(L(P(source="src:ABC"))))
add(*lay(L(P(visual="bar", body={"rows": []}))))
add(*lay(L(P(visual="kpi", body={}), P("b", x=4, visual="slicer", body={"rows": [{"column": "工程"}]}))))
add(*lay(L(P(filters=[{"column": "x", "op": "=", "value": {"k": "\x01"}}]))), py=True)
# ---- 稼働・ABC
add(*lay(L(P(visual="gantt", ops={"start": " 開始 ", "end": "終了", "label": "", "color": "色", "span": "lead", "refPeriod": {"kind": "months", "n": 3, "column": "x"},
                                  "hide": ["chart", "x", "share"], "cls": [" 合金 ", "調質", "合金", "", "a", "b", "c"], "qty": "", "base": "  ",
                                  "lims": [90, "70", 0, -5, 150, 0.00005, 70.0, "x"], "rankBy": "each"}, egroup={"mode": "sum"}, esplit="series"),
           P("b", x=4, visual="abc", ops={"a": 60, "b": "80"}), P("c", x=8, visual="abc", ops={"cls": "  合金  ", "lims": []}), P("d", y=2, visual="abc", ops=5))))
add(*lay(L(P(visual="abc", ops={"lims": [70, 90]}), P("b", x=4, visual="gantt", source="lot"))))
# ---- 合わせた表
add(*lay(L(P(visual="board", w=7, h=7), P("b", x=7, visual="board", groups=[], legacy=1))))
add(*lay(L(P(visual="board", w=8, h=6, rows={"column": "@equip"}, equips=["CR1"], filters=[{"column": "a", "op": "="}],
             egroup={"mode": "sum", "name": "計"},
             order={"by": "manual", "group": "5", "dir": "asc", "list": ["CR1", None, 5, "  ", "x" * 130], "hide": ["L-1"], "tree": "  ライン別 ", "glist": ["CR"]},
             groups=[{"title": " 仕掛 ", "source": "src:wip", "measure": {"agg": "sum", "column": "重量"}, "cols": [{"column": "a"}, {"column": "b"}, {"column": "c"}],
                      "look": "signal", "total": 0, "zero": "x", "color": "#ABCDEF", "limits": {"warn": "5", "alert": None, "dir": "low"}},
                     {"source": "work", "measure": {"agg": "nosuch"}, "look": "x", "color": "red", "limits": {"warn": "a"}}]))))
add(*lay(L(P(visual="board", rows={"column": "工程"}, order={"tree": "x"}, groups=[{"source": "work"}]))))
add(*lay(L(P(visual="board", groups=[{"source": "work"}] * 5))))
add(*lay(L(P(visual="board", groups=["x"]))))
add(*lay(L(P(visual="board", groups=[{"source": "bad", "title": ""}]))))
# ---- 別のデータを合わせる
add(*lay(L(P(visual="diag45", link={"sides": [{"key": {"column": "@workday", "part": "date"}, "source": "work", "role": "target", "build": "cum", "title": "  計画  ",
                                                 "measure": {"agg": "sum", "column": "重量", "show": "cum"}},
                                                {"key": {"column": "日付"}, "source": "src:plan", "role": "x", "build": "y", "measure": {"agg": "bad"}}],
                                      "extra": ["rate", "x", "diff"]}))))
add(*lay(L(P(link={"sides": [{"key": {"column": "a"}, "source": "work"}]}))))
add(*lay(L(P(link={"sides": [{"key": {"column": "a"}, "source": "work"}, "x"]}))))
add(*lay(L(P(link={"sides": [{"key": {"column": "a"}, "source": "work"}, {"source": "work"}]}))))
add(*lay(L(P(link={"sides": [{"key": {"column": "a"}, "source": "work"}, {"key": {"column": "b"}, "source": "bad"}]}))))
add(*lay(L(P(link={"sides": []}), P("b", x=4, link="x"))))
# ---- スライサー・入れ替え・大きさ
add(*lay(L(slicer={"off": True, "parts": ["equip", "x", "period"]}, replaces="standard")))
add(*lay(L(slicer={"off": 1, "parts": "date"}, replaces="nosuch")))
add(*lay(L(slicer={"parts": ["period", "date", "equip"]}, replaces=["standard"])))
add(*lay(L(*[P(f"z{k}", x=(k % 3) * 4, y=k // 3, h=1, title="長" * 60, body={"rows": [{"column": "c" * 200, "part": "p"}] * 3, "cols": [{"column": "d" * 200}] * 3,
                                                                                 "measures": [{"agg": "sum", "column": "m" * 200, "expr": "x"}] * 6},
             filters=[{"column": "f" * 200, "op": "in", "value": "v" * 4000}] * 20) for k in range(2)], rows=16)))
# ---- 数の字の割れ（採点の指摘）
add(*lay(L(P(fmt={"digits": "9" * 5000}))))
add(*lay(L(P(fmt={"digits": "1" * 30}), rows="-" + "9" * 40)))
add(*lay(L(P(fmt={"digits": "0" * 40 + "2"}))))
# ---- 外した組み込み（clean_hide_body）と前の版の条件（condition_of）
for x in [{"keys": ["standard", "x", "standard", 5]}, {"keys": "standard"}, {"keys": {"standard": 1}}, {"keys": []}, {}, [], 0, "", None,
          j({"keys": ["standard"]}), "{bad", "[]", "0", {"keys": None}, {"keys": ["standard", None, True, 1.5, [1]]}]:
    add("hide", j(x))
for x in [[1], "[1]", "5", {"keys": 5}, {"keys": True}]:
    add("hide", j(x), py=True)
ROWS = [{"キー": "wip", "条件": j({"filters": [{"column": "区分", "op": "=", "value": "保留"}], "search": "  検  "})},
        {"キー": "work", "条件": "{bad"}, {"キー": "x", "条件": 5}, {"キー": "y", "条件": ""}, {"キー": 5, "条件": j({"search": "数の鍵"})}]
for key in ["wip", "work", "x", "y", "5", "none"]:
    add("cond", j(ROWS), key=key)
for rows, key in [([{"キー": "wip", "条件": "[1]"}], "wip"), ([{"キー": "wip", "条件": "null"}], "wip"), (["x"], "wip"), ([{"キー": "wip", "条件": "[]"}], "wip")]:
    add("cond", j(rows), key=key, py=True)


def answer(c):
    x = json.loads(c["in"])
    try:
        if c["fn"] == "layout":
            v, t = db.clean_layout(x)
        elif c["fn"] == "hide":
            v, t = db.clean_hide_body(x)
        else:
            v = db.condition_of(x, c["key"])
            t = json.dumps(v, ensure_ascii=False, sort_keys=True)
        return {"ok": [v, t]}
    except db.LayoutError as e:
        return {"error": str(e)}
    except Exception as e:      # 道の外の例外（本番は 500）
        return {"crash": type(e).__name__}


def table():
    return {"python": sys.version.split()[0], "cases": [{**c, "want": answer(c)} for c in CASES]}


def text():
    return json.dumps(table(), ensure_ascii=False, indent=0) + "\n"


def main(argv):
    if "--check" in argv:
        same = OUT.exists() and json.loads(OUT.read_text(encoding="utf-8"))["cases"] == table()["cases"]
        print("同じ" if same else f"古い: {OUT} を python program/tools/layout-cases.py で焼き直してください")
        return 0 if same else 1
    OUT.write_text(text(), encoding="utf-8", newline="\n")
    print(f"焼きました: {OUT}（{len(CASES)} 件）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
