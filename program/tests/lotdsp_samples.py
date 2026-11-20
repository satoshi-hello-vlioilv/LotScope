# -*- coding: utf-8 -*-
"""LotDsp の見本（版 3.117.0。標準の部品だけ。app を import しない）。

進度情報の画面の見本（tests/fixtures/lotdsp_progress_L7150C0.html）と、それを崩して別のロット・別の値の画面を作る係。
前は app を import する試験（tests/test_lotdsp_api.py・test_lotdsp_rules.py）の中にあり、答え合わせ役（tests/lotdsp_oracle.py）が
そこから借りていた。作り物の LotDsp（tests/fakes_lotdsp.py）を app なしで起こすために、ここへ移した（試験もここから読む）。

作り物の API が返す JSON（entity）は、画面の見本を app の読み手（lotdsp_progress）で読んで作る物（tests/test_lotdsp_api.py の entity_of）
なので、ここには置けない。ロット番号ごとの答えは焼いた表 tests/fixtures/lotdsp_fake_tables.json に持つ（焼くのは
python program/tools/lotdsp-fake-tables.py。古い表は tests/test_lotdsp_fake_tables.py が止める）。
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = (ROOT / "tests" / "fixtures" / "lotdsp_progress_L7150C0.html").read_text(encoding="utf-8")
ACTUAL_ROW = re.compile(r'<tr ng-repeat="meisaiInfo in staffProgressJBoxInfos[^"]*"[^>]*>.*?</tr>', re.S)
OFF_CELL = re.compile(r'<span class="prog-jb(?:fo|bo) ng-binding">[^<]*</span>')
# アプリは日本時間で読む（app/services/lotdsp_rules.TZ と同じ決め。tests/test_lotdsp_rules.py が同じ値かを見る）
TZ = timezone(timedelta(hours=9), "JST")
# 答え合わせ役の場面の前オフ・後オフ（行の順）
OFFS = [("12.5", "3.0"), ("", "4.5"), ("7.2", ""), ("1.1", "2.2")] + [("", "")] * 6
# 応答の書き方の違いの場面: (場面の名前, 札〈作り物の API の道の頭〉, entity_of に渡す書き方)
STYLES = (("項目名 b", "v2", {"key_style": "b"}), ("経過ミリ秒", "v3", {"date_style": "epoch"}), ("ずれつき", "v4", {"date_style": "utc"}),
          ("比重が別の所", "v5", {"density_elsewhere": True}), ("同じ比重が 2 か所", "v6", {"density_twice": True}))


def html_with_offs(offs, lot_no="L7150C0", thickness_shift=0.0):
    """見本の HTML。実績の各行の 前オフ・後オフ を入れ（長さ・前オフ・後オフ・肉厚 の順の4つ目までが並ぶ）、
    ロット番号と板厚を替えられる（別のロットを作る）。offs: [(前オフ, 後オフ)] を行の順に。"""
    s = FIXTURE.replace("L7150C0", lot_no)
    out = []
    for i, row in enumerate(ACTUAL_ROW.findall(s)):
        front, back = offs[i] if i < len(offs) else ("", "")
        cells = iter([("長さ", ""), ("前オフ", front), ("後オフ", back), ("肉厚", "0")])
        new = OFF_CELL.sub(lambda m: f'<span class="prog-jbfo ng-binding">{next(cells)[1]}</span>', row)
        if thickness_shift:
            new = re.sub(r'(prog-jbx ng-binding">\s*)([\d.]+)', lambda m: m.group(1) + f"{float(m.group(2)) + thickness_shift:.3f}", new)
        out.append((row, new))
    for old, new in out:
        s = s.replace(old, new, 1)
    return s


def to_moment(display, how):
    """画面の日時（YY/MM/DD hh:mm:ss）を、API の書き方に。iso=ふつうの ISO、epoch=1970年からの経過ミリ秒、utc=ずれつき（Z）の ISO。
    経過ミリ秒とずれつきは、日本時間として画面と同じになる向きに作る（版 3.98.0: アプリは日本時間で読む。lotdsp_rules.TZ）。"""
    dt = datetime.strptime(("20" + display).strip(), "%Y/%m/%d %H:%M:%S") if len(display) > 8 else datetime.strptime("20" + display, "%Y/%m/%d")
    if how == "epoch":
        return int(dt.replace(tzinfo=TZ).timestamp() * 1000)
    if how == "utc":
        return dt.replace(tzinfo=TZ).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def with_cells(cells):
    """見本の画面の実績の行（上から）の、板厚・板幅・重量の字を替える。cells: [(板厚, 板幅, 重量) か None]"""
    s = FIXTURE
    for row, c in zip(ACTUAL_ROW.findall(FIXTURE), cells):
        if c is None:
            continue
        new = row
        for cls, v in zip(("prog-jbx", "prog-jby", "prog-jbrw"), c):
            if v is not None:
                new = re.sub(r'(<span class="' + cls + r' ng-binding">)[^<]*', lambda m, v=v: m.group(1) + v, new, count=1)
        s = s.replace(row, new, 1)
    return s


def scene_htmls():
    """答え合わせ役の場面の画面（学ぶ 3 ロット）→ (h1, h2, h3)"""
    return (html_with_offs(OFFS), html_with_offs(OFFS, lot_no="L7151C0", thickness_shift=0.5),
            html_with_offs(OFFS, lot_no="L7152C0", thickness_shift=1.0))


def style_lots():
    """応答の書き方の違いの場面のロット → [(画面, ロット番号)]"""
    return [(html_with_offs(OFFS, lot_no=f"L715{i}C0", thickness_shift=0.5 * i), f"L715{i}C0") for i in range(3)]


def fake_tables():
    """作り物の API の答え（焼いた表）→ {札: {ロット番号: (状態, 本文のバイト, 待つ秒)}}"""
    t = json.loads((ROOT / "tests" / "fixtures" / "lotdsp_fake_tables.json").read_text(encoding="utf-8"))
    return {tag: {lot: (a["status"], a["text"].encode("utf-8"), a["wait"]) for lot, a in lots.items()} for tag, lots in t["tables"].items()}
