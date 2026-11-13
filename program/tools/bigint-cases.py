"""大きな整数の事例の表を作る（版 3.108.0。Rust 化の段 ① の 5 歩目・案 H2。開発用）。答えは同梱と同じ Python 3 の int で焼き付ける。

    python tools/bigint-cases.py            … tests/fixtures/bigint_cases.json を作り直す
    python tools/bigint-cases.py --check    … 作り直した物が今の表と同じか（違えば終了コード 1）

窓（desktop/src/pyfmt.rs の PyInt・src/held.rs の持っている値）は、i64・u64 に入らない整数を Python の int と同じに比べ・並べ・
字にし・書き戻す約束で、その約束を 1 つの表にする（Rust の cargo test --test bigint_cases と Python の tests/test_bigint_cases.py が同じ表を読む）:
- ints      … 10 進の字の並び（i64・u64 の端・39〜41 桁・負の大きな数・4,300 桁）。sorted は Python の sorted(key=int) の並び（元の位置）、
               succ・plus10 は str(n + 1)・str(n + 10)
- floats    … 小数の repr → str(int(f))（1e20・1e30・-2.5e19 など。int() は 0 の向きへ切って桁のまま）
- next_id   … 行の id の並び（JSON の字）→ master_store.next_id の答え（JSON の字）
- next_order… 行の表示順の並び（JSON の字）→ row_order.next_order の答え
- json      … JSON の字 → json.dumps(json.loads(字), ensure_ascii=False)（桁のまま書き戻す。画面へ返す答え〈held::reply_bytes〉と同じ字）
- marks     … 印の字と同じ頭（NUL・J・:）で始まる利用者の字。字のまま書き戻し・str() も字・int() の誤りの文
- float_of_int … 版 3.109.0 の作った後の採点の割れ 6: float(int) の字（repr）か OverflowError の文（窓は pyfmt::py_float_of_int）
- content   … 版 3.109.0（H3）: 置き場の中身の字の境の数（2^63−1・2^63・10^19・2^64−1・2^64・−2^63−1・10^20）を、カードの設計の方眼・日付の列・
               ラベル・項目の幅・ダッシュボードのパネルの w と段の数と題・セットの並び・共有の書式の並べ替えと値・すぐに見るの並び・前の版の条件の値・
               知らない鍵に置き、Python の清め方（card_forms.clean_body・dashboard.clean_layout・clean_set_body・display_formats.clean_body・
               pivot_presets.clean_quick・dashboard.condition_of・shifts.segments_of。どれも Python の int・str() で読む）の答えを焼く。窓は src/held.rs の印の字で読み、
               desktop/src/held.rs の content_like_the_table が同じ答えか（字は 1 字まで、値は印の字のまま比べる）
next_id・next_order は app を使わない独立の答え（Python の int で仕様どおりに数える）
"""
import json
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]


OUT = PROGRAM / "tests" / "fixtures" / "bigint_cases.json"
INTS = ["0", "-1", "9223372036854775807", "9223372036854775808", "-9223372036854775808", "-9223372036854775809",
        "18446744073709551615", "18446744073709551616", "99999999999999999999", "100000000000000000000", "-100000000000000000000",
        "1" + "0" * 38, "1" + "0" * 39, "2" + "0" * 40, "-" + "9" * 41, "170141183460469231731687303715884105727",
        "170141183460469231731687303715884105728", "9" * 4299, "-" + "9" * 4300, "12", "-12"]
FLOATS = [1e20, 1e30, -2.5e19, 9.223372036854776e18, 1.8446744073709552e19, 1e300, -1e25, 123456789.9, 1.5e16]
NEXT_ID = ['[{"id": 1}, {"id": 100000000000000000000}]', '[{"id": 18446744073709551615}]', '[{"id": 9223372036854775807}]',
           '[{"id": -100000000000000000000}]', '[{"id": "100000000000000000000"}, {"id": 1e19}]', '[{"id": "x"}, {"id": 3}]',
           '[{"id": 1' + "0" * 45 + '}]', '[]']
NEXT_ORDER = ['[{"表示順": "100000000000000000000"}, {"表示順": "5"}]', '[{"表示順": "' + "9" * 41 + '"}]',
              '[{"表示順": 100000000000000000000}]', '[{"表示順": "-' + "9" * 30 + '"}]', '[{"表示順": " ' + "1" * 39 + ' "}]',
              '[{"表示順": "' + "9" * 4301 + '"}, {"表示順": "7"}]', '[{"表示順": 1e20}]', '[{"表示順": "²"}]']
JSON = ['{"a": 100000000000000000000, "b": [-123456789012345678901234567890, 18446744073709551616]}',
        '{"x": 9223372036854775808, "y": 1e20, "z": -0}', '[' + "1" + "0" * 60 + ']']


def _int(v):
    """Python の int(v)。読めなければ None（app を使わない独立の答え。版 3.108.0 の作った後の採点）"""
    try:
        return int(v)
    except (TypeError, ValueError, OverflowError):
        return None


def next_id(rows):
    """次の id の仕様: 表の行の int(id or 0) の読める物の最大 + 1（無ければ 1）"""
    ns = [n for r in rows if isinstance(r, dict) for n in [_int(r.get("id") or 0)] if n is not None]
    return max(ns, default=0) + 1


def next_order(rows):
    """次の表示順の仕様: 0 と、各行の int(str(表示順 or 0).strip()) の読める物の最大 + 10（字）"""
    ns = [n for r in rows for n in [_int(str(r.get("表示順") or 0).strip())] if n is not None]
    return str(max([0] + ns) + 10)


MARKS = ["\u0000J:" + "1234567890" * 3, "\u0000J:NaN", "\u0000J:5", "\u0000J:abc", "\u0000J:-Infinity", "\u0000J:\"x\""]


def _int_err(s):
    try:
        int(s)
        return None
    except ValueError as e:
        return str(e)


# float(int)（版 3.109.0 の作った後の採点の割れ 6）: 丸め（偶数へ）と、f64 に入らない桁（309 桁あたり）の OverflowError
FLOAT_INTS = [str(2 ** 53 + 1), str(10 ** 20), str(-(2 ** 64)), "1" + "0" * 308, "1" + "0" * 309, "-" + "9" * 400,
              str(int(1.7976931348623157e308)), str(int(1.7976931348623157e308) + 2 ** 970), str(int(1.7976931348623157e308) + 2 ** 971)]


def _float_of_int(d):
    try:
        return {"int": d, "float": repr(float(int(d))), "error": None}
    except OverflowError as e:
        return {"int": d, "float": None, "error": str(e)}


EDGES = [2 ** 63 - 1, 2 ** 63, 10 ** 19, 2 ** 64 - 1, 2 ** 64, -(2 ** 63) - 1, 10 ** 20]


def content():
    """中身の字の境の数（版 3.109.0）。答えは Python の清め方（app）の答え"""
    import logging
    if str(PROGRAM) not in sys.path:
        sys.path.insert(0, str(PROGRAM))
    from app.services import card_forms, dashboard, display_formats, pivot_presets, shifts
    # 清め方の中の記録を黙らせる間だけ止め、元に戻す（試験の中で呼ばれても、後の試験の記録〈assertLogs〉を止めない）
    level = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        return _content(card_forms, dashboard, display_formats, pivot_presets, shifts)
    finally:
        logging.disable(level)


def _content(card_forms, dashboard, display_formats, pivot_presets, shifts):
    out = []
    for e in EDGES:
        texts = {
            "card": json.dumps({"cols": e, "row": e, "theme": {"radius": e}, "items": [
                {"id": "a", "kind": "dates", "cols": [e, "b"], "label": e, "x": e, "y": 0, "w": e, "h": 1},
                {"id": "b", "kind": "field", "col": e, "x": 0, "y": 2, "w": 2, "h": e}]}),
            "layout": json.dumps({"rows": e, "x": e, "panels": [{"id": "a", "x": 0, "y": 0, "w": e, "h": 2, "visual": "bar", "source": "work",
                                                                 "title": e, "top": e,
                                                                 "body": {"rows": [{"column": "設備"}], "measures": [{"agg": "lots"}], "chartAt": e}}]}),
            "set": json.dumps({"items": [e, "1", str(e)], "n": e}),
            "format": json.dumps({"sorts": [{"column": e, "dir": "asc"}], "slicer": {"cards": [{"col": "a", "values": [e, "x"]}]}, "n": e}),
            "quick": json.dumps([e, "3", " " + str(e) + " ", "b:" + str(e)]),
            "condition": json.dumps({"filters": [{"column": "a", "op": "eq", "value": e}, {"column": e, "op": "in", "values": [e]}],
                                     "search": e}),
            # 版 3.109.0 の作った後の採点の割れ 3: 勤務体系の区分（作業実績・ダッシュボードの直の名前も同じ読み手 worksum::segments_of）
            "shift": json.dumps([{"name": e, "start": "8:00", "end": "17:00"}, {"name": "夜", "start": "22:00", "end": "6:00", "dayOffset": e}]),
        }
        for kind, text in texts.items():
            try:
                if kind == "card":
                    want = card_forms.clean_body(text)[1]
                elif kind == "layout":
                    want = dashboard.clean_layout(text)[1]
                elif kind == "set":
                    want = dashboard.clean_set_body(text)[1]
                elif kind == "format":
                    want = display_formats.clean_body(text)[1]
                elif kind == "quick":
                    want = json.dumps(pivot_presets.clean_quick(json.loads(text)), ensure_ascii=False)
                elif kind == "shift":
                    want = json.dumps(shifts.segments_of({"区分": text}), ensure_ascii=False)
                else:
                    want = json.dumps(dashboard.condition_of([{"キー": "wip", "条件": text}], "wip"), ensure_ascii=False)
                err = None
            except Exception as x:   # noqa: BLE001 — 誤りの文も答え
                want, err = None, str(x)
            out.append({"kind": kind, "edge": str(e), "text": text, "want": want, "error": err})
    return out


def build():
    ints = [int(s) for s in INTS]
    return {
        "ints": INTS,
        "sorted": sorted(range(len(ints)), key=lambda i: ints[i]),
        "succ": [str(n + 1) for n in ints],
        "plus10": [str(n + 10) for n in ints],
        "floats": [{"f": repr(f), "int": str(int(f))} for f in FLOATS],
        "next_id": [{"rows": t, "want": json.dumps(next_id(json.loads(t)))} for t in NEXT_ID],
        "next_order": [{"rows": t, "want": next_order(json.loads(t))} for t in NEXT_ORDER],
        "json": [{"text": t, "want": json.dumps(json.loads(t), ensure_ascii=False)} for t in JSON],
        # 印の字（窓の src/held.rs の持っている値の頭）と同じ頭で始まる利用者の字（版 3.108.0 の作った後の採点の割れ 1）: 字のまま読み・書き戻し、
        # int() は読めず、str() は字のまま
        "marks": [{"text": json.dumps({"a": m}), "want": json.dumps({"a": m}, ensure_ascii=False), "str": m, "int_err": _int_err(m)} for m in MARKS],
        "content": content(),
        "float_of_int": [_float_of_int(d) for d in FLOAT_INTS],
    }


def main():
    text = json.dumps(build(), ensure_ascii=False, indent=1) + "\n"
    if "--check" in sys.argv:
        sys.exit(0 if OUT.read_text(encoding="utf-8") == text else 1)
    OUT.write_text(text, encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()
