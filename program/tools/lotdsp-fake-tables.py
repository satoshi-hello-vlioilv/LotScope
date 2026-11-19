"""作り物の LotDsp の API の答えの表（tests/fixtures/lotdsp_fake_tables.json）を焼く（版 3.117.0）。

    python program/tools/lotdsp-fake-tables.py           … 表を書き直す
    python program/tools/lotdsp-fake-tables.py --check   … 今の表が古くないか（違えば終了コード 1）

作り物の LotDsp（tests/fakes_lotdsp.py。app を import しない）が返す JSON は、画面の見本を app の読み手で読んで作る
（tests/test_lotdsp_api.py の entity_of）。段 ④ で app を外した後も作り物を起こせるように、答えを表に焼いておく
（答え合わせ役 tests/lotdsp_oracle.py も同じ表の作り物を使う）。見本・読み手を変えたら焼き直す（tests/test_lotdsp_fake_tables.py が止める）。
"""
import json
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
OUT = PROGRAM / "tests" / "fixtures" / "lotdsp_fake_tables.json"


def tables():
    """{札: {ロット番号: {"status", "text", "wait"}}}（text は本文〈UTF-8〉。BOM は \\ufeff）"""
    from tests import lotdsp_samples as S
    from tests.test_lotdsp_api import entity_of

    def ok(html, **kw):
        return {"status": 200, "text": json.dumps(entity_of(html, **kw), ensure_ascii=False), "wait": 0}

    def raw(status, text, wait=0):
        return {"status": status, "text": text, "wait": wait}

    h1, h2, h3 = S.scene_htmls()
    t = {"a": {
        "L7150C0": ok(h1), "L7151C0": ok(h2), "L7152C0": ok(h3),
        "E500": raw(500, "oops"), "EJSON": raw(200, "<html>login</html>"),
        "EBIZ": raw(200, json.dumps({"status": "ERROR", "errorMessage": "業務の誤り"}, ensure_ascii=False)),
        "EBIZ2": raw(200, json.dumps({"status": "ERROR"})), "EARR": raw(200, "[1, 2]"), "EBOM": raw(200, "﻿" + ok(h1)["text"]),
        "ENOENT": raw(200, json.dumps({"status": "OK"})), "ESLOW": raw(200, ok(h1)["text"], 2.5), "ENOTDICT": raw(200, json.dumps({"entity": [1]})),
        "EMIS": ok(h2), "E307": raw(307, ""),
    }}
    for _name, tag, kw in S.STYLES:
        t[tag] = {no: ok(h, **kw) for h, no in S.style_lots()}
    t["c"] = {"L7150C0": ok(h1), "L7151C0": ok(h2)}
    t["c2"] = {"L7151C0": ok(h2, key_style="b")}
    t["LotDspWeb"] = {"L7150C0": ok(h1)}
    return t


def text():
    about = ("作り物の LotDsp の API の答え（札 → ロット番号 → 状態・本文・待つ秒）。画面の見本を app の読み手で読んで作った JSON を焼いた物"
             "（tests/fakes_lotdsp.py が読む。焼くのは python program/tools/lotdsp-fake-tables.py。古い表は tests/test_lotdsp_fake_tables.py が止める）")
    return json.dumps({"about": about, "tables": tables()}, ensure_ascii=False, indent=1) + "\n"


def main():
    new = text()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != new:
            sys.exit(f"{OUT.name} が古い（python program/tools/lotdsp-fake-tables.py で焼き直す）")
        print("作り物の LotDsp の答えの表は古くありません")
        return
    OUT.write_text(new, encoding="utf-8", newline="\n")
    print(f"{OUT} を書きました（{len(new.encode('utf-8'))} バイト）")


if __name__ == "__main__":
    main()
