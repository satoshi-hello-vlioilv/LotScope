# -*- coding: utf-8 -*-
"""共有の書式（一覧の表示ルールを、名前を付けて共有フォルダに置く）。

1 つの設備（作業実績）・1 つの表（品質異常）で整えた表示ルールを、名前を付けて共有のマスタに置き、
ほかの設備・ほかの PC の利用者が呼び出して当てる。当てるのは画面（static/js/lotlist-formats.js）で、
当てた先の表示ルールは、その PC の覚え（localStorage）に入る（呼んだ後で自分用に直してよい）。

置き場: MasterStore のマスタ `display_formats`（共有フォルダがあれば共有。全員で 1 つ）。
    行: {id, 名前, 元, 表, 作った所, 中身, 備考, rev, updated_at, updated_by}
    元 … どの一覧の書式か（lot = 品質異常・work = 作業実績）。名前は元ごとに 1 つ
    表 … 作ったときの表（当てる先の表が分からないときに使う）／作った所 … 作ったときの設備名や表（人が読む控え）
    中身 … 表示ルールの JSON（PARTS の部品。画面の覚えの形のまま）
書けるのは現場のマスタと同じ（部分的編集可から）。呼び出して当てるのは、マスタを見られない人もできる（読むだけ）。
"""
from __future__ import annotations

import json

from .data_sources import is_screen_source

NAME = "display_formats"
FIELDS = ["名前", "元", "表", "作った所", "中身", "備考"]
SOURCES = {"lot": "品質異常", "work": "作業実績"}
# 中身の部品（画面の覚えの形）。畳んだまとまりなど、その時だけの状態は入れない。
# 版 3.28.0 から絞り込みの状態（効いている条件・スライサーで選んだ値・列で絞り込むの値）も入れる（利用者の要望。当てるとその状態になる）。
# 中身が空の部品（条件なし・並べ替えなし）は入れない: 当てても、当てた所のその部品は今のまま
PARTS = {
    "columns": (dict, "表示列"),          # 列の設定 {order, hidden, widths, locks, names, formats, aligns, formulas, rules}
    "rules": (dict, "読み替えルール"),    # 表示列が使う読み替えルール {名前: {rows, self}}（ルールは名前で呼ぶので一緒に運ぶ）
    "arrange": (dict, "並び・まとめ"),    # {levels, heads, suppress}
    "sorts": (list, "並べ替え"),          # [{column, dir}]
    "filters": (list, "条件"),            # 効いている条件 [{column, op, value}]（いつも適用〈固定〉の条件は入れない。当てる所の固定の条件はそのまま）
    "presets": (list, "登録した条件"),    # [{name, filters, group, always, …}]（当てる先の表に付け替える）
    "views": (list, "保存した見方"),      # [{name, filters, sorts, arrange, slicer, search, …}]（名前を付けた見方なので値ごと運ぶ。当てる先の表に付け替える）
    "slicer": (dict, "スライサー"),       # {cards:[{column, key, sel?, one?, hide0?, order?, manual?} | {column, kind:"time", from?, to?}]}（sel＝選んだ値。版 3.28.0 から。one＝1 つだけ選ぶ・hide0＝0 件を隠す。版 3.30.0 から。order・manual＝値の並び・タイムライン。版 3.31.0 から）
    "marks": (list, "色付け"),            # 色付け（条件付き書式）の組 [{conds, tone, target, on}]
    "adhoc": (dict, "列で絞り込む"),      # {column, op, value?}（value＝打った値。版 3.28.0 から。当てるといまの所だけに効く）
}
MAX_BYTES = 512 * 1024
NAME_MAX = 40


class FormatError(ValueError):
    pass


def clean_body(body):
    """中身（dict）を確かめて、知っている部品だけの dict に。→ (dict, JSON 字)"""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            raise FormatError("書式の中身が JSON ではありません。")
    if not isinstance(body, dict):
        raise FormatError("書式の中身の形が違います（{部品: 中身}）。")
    out = {k: v for k, v in body.items() if k in PARTS and isinstance(v, PARTS[k][0])}
    if not out:
        raise FormatError("書式に入れる表示ルールがありません（表示列・並び・条件などを整えてから保存してください）。")
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise FormatError(f"書式が大きすぎます（{MAX_BYTES // 1024} KB まで）。")
    return out, text


def clean_row(data, partial=False):
    """画面から来た値 → マスタの行（名前・元・表・作った所・中身・備考）。partial は直すとき（来た物だけ）。"""
    out = {}
    if not partial or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise FormatError("書式の名前を入れてください。")
        if len(name) > NAME_MAX:
            raise FormatError(f"書式の名前は {NAME_MAX} 字までです。")
        out["名前"] = name
    if not partial:
        src = str(data.get("source") or "")
        if not is_screen_source(src):
            raise FormatError("どの一覧の書式か（source: lot・work・src:<キー>）が違います。")
        out["元"] = src
        out["表"] = str(data.get("table") or "").strip()
        out["作った所"] = str(data.get("origin") or "").strip()[:80]
    if not partial or "body" in data:
        out["中身"] = clean_body(data.get("body"))[1]
    if "note" in data:
        out["備考"] = str(data.get("note") or "").strip()[:200]
    return out


def parts_of(body):
    """中身にある部品の名前（人の言葉。表示順）。条件・並べ替えは数を、スライサー・列で絞り込むは選んだ値・打った値があればそれと分かる名前に"""
    out = []
    for k, (_t, label) in PARTS.items():
        v = body.get(k)
        if not v:
            continue
        if k in ("filters", "sorts"):
            label = f"{label} {len(v)}"
        elif k == "slicer" and any(isinstance(c, dict) and c.get("sel") for c in v.get("cards") or []):
            label = "スライサー（選んだ値）"
        elif k == "adhoc" and str(v.get("value") or "").strip():
            label = "列で絞り込む（値）"
        out.append(label)
    return out


def view(row):
    """マスタの行 → 画面の形。中身が壊れていれば body は {}（parts も空）。"""
    try:
        body = json.loads(row.get("中身") or "{}")
        body = body if isinstance(body, dict) else {}
    except ValueError:
        body = {}
    return {"id": row.get("id"), "name": row.get("名前") or "", "source": row.get("元") or "", "table": row.get("表") or "",
            "origin": row.get("作った所") or "", "note": row.get("備考") or "", "rev": row.get("rev", 1),
            "updatedAt": row.get("updated_at") or "", "updatedBy": row.get("updated_by") or {},
            "parts": parts_of(body), "body": body}
