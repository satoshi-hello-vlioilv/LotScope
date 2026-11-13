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
"""
import json
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app.repositories.master_store import next_id  # noqa: E402
from app.services.row_order import next_order  # noqa: E402

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
    }


def main():
    text = json.dumps(build(), ensure_ascii=False, indent=1) + "\n"
    if "--check" in sys.argv:
        sys.exit(0 if OUT.read_text(encoding="utf-8") == text else 1)
    OUT.write_text(text, encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()
