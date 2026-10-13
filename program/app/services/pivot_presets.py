# -*- coding: utf-8 -*-
"""集計表・グラフの組み方のプリセット（版 3.26.0。画面は static/js/lotlist-pivot.js）。

集計表・グラフで組んだ形（行・列・値・グラフの形・小計・総計・月で区切る・数値ラベル）に名前を付けて置き、
ほかの設備・ほかの表・ほかの PC で呼び出す。置き場は 2 つ:
    共通 … 全員の分。書けるのは現場のマスタと同じ（部分的編集可から。共有の書式と同じ）
    ID   … ログイン ID ごとの分。その ID の本人だけが見て・書ける（マスタの権限は要らない）
標準 … 範囲（共通／その ID）・元（異常ロット一覧／作業実績）ごとに 1 つ。組み方が空のまま集計表を開くと当てる。
       その ID の標準があればそちら、無ければ共通の標準（決めは standard_for の 1 か所）

置き場: MasterStore のマスタ `pivot_presets`（共有フォルダがあれば共有。全員で 1 つ）。
    行: {id, 名前, 元, 範囲, ログインID, 標準, 中身, 備考, rev, updated_at, updated_by}
    元 … lot（異常ロット一覧）・work（作業実績）。列が違うので分ける。名前は (元, 範囲, ログインID) ごとに 1 つ
    範囲 … 共通 か ID。ログインID … 範囲が ID のときの持ち主（共通は空）
    標準 … "1" か ""。中身 … 組み方の JSON（BODY_KEYS だけ）
"""
from __future__ import annotations

import json

NAME = "pivot_presets"
FIELDS = ["名前", "元", "範囲", "ログインID", "標準", "中身", "備考"]
SOURCES = {"lot": "異常ロット一覧", "work": "作業実績"}
SCOPES = {"all": "共通", "me": "ID"}          # 画面の言葉 → マスタの値
MAX_BYTES = 64 * 1024
NAME_MAX = 40
CHARTS = ("time", "column", "bar", "hist", "none")
# 中身に入れる物（画面の組み方の覚えの形）。一覧｜集計の切り替え・選んだ月はその時だけの状態なので入れない
BODY_KEYS = ("rows", "cols", "measures", "chart", "sub", "grand", "chartAt", "split", "labels")


class PresetError(ValueError):
    pass


def _dims(v):
    if not isinstance(v, list):
        return []
    out = []
    for d in v[:3]:
        if isinstance(d, dict) and isinstance(d.get("column"), str) and d["column"]:
            x = {"column": d["column"][:200], "part": str(d.get("part") or "")[:10]}
            for k in ("width", "origin"):
                if isinstance(d.get(k), (int, float)) and not isinstance(d.get(k), bool):
                    x[k] = d[k]
            out.append(x)
    return out


def clean_body(body):
    """組み方（dict）を確かめて、知っている物だけの dict に。→ (dict, JSON 字)"""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise PresetError("中身の形が違います。") from e
    if not isinstance(body, dict):
        raise PresetError("中身の形が違います。")
    out = {"rows": _dims(body.get("rows")), "cols": _dims(body.get("cols"))}
    ms = []
    for m in (body.get("measures") if isinstance(body.get("measures"), list) else [])[:4]:
        if isinstance(m, dict) and m.get("agg") in ("count", "lots", "sum", "avg", "min", "max"):
            ms.append({"agg": m["agg"], "column": str(m.get("column") or "")[:200]} if m["agg"] not in ("count", "lots") else {"agg": m["agg"]})
    out["measures"] = ms
    out["chart"] = body.get("chart") if body.get("chart") in CHARTS else "time"
    for k in ("sub", "grand", "split", "labels"):
        out[k] = bool(body.get(k, k in ("sub", "grand")))
    out["chartAt"] = int(body.get("chartAt") or 0) if str(body.get("chartAt") or "0").isdigit() else 0
    if not out["rows"]:
        raise PresetError("行の段が 1 つも無い組み方は保存できません（左のカラムの［行］を押してから保存してください）。")
    text = json.dumps(out, ensure_ascii=False, sort_keys=True)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise PresetError("組み方が大きすぎます。")
    return out, text


def clean_row(data, login, partial=False):
    """画面から来た値 → マスタの行。scope は all（共通）か me（その ID）。partial は直すとき（来た物だけ）。"""
    d = data or {}
    row = {}
    if not partial or "name" in d:
        name = str(d.get("name") or "").strip()
        if not name:
            raise PresetError("名前を入れてください。")
        if len(name) > NAME_MAX:
            raise PresetError(f"名前は {NAME_MAX} 字までです。")
        row["名前"] = name
    if not partial:
        src = d.get("source")
        if src not in SOURCES:
            raise PresetError("元（lot か work）が違います。")
        scope = d.get("scope")
        if scope not in SCOPES:
            raise PresetError("置き場（all か me）が違います。")
        if scope == "me" and not login:
            raise PresetError("ログイン ID が分からないので、ID ごとには保存できません。")
        row.update({"元": src, "範囲": SCOPES[scope], "ログインID": login if scope == "me" else ""})
    if not partial or "body" in d:
        row["中身"] = clean_body(d.get("body"))[1]
    if not partial or "standard" in d:
        row["標準"] = "1" if d.get("standard") else ""
    if not partial or "note" in d:
        row["備考"] = str(d.get("note") or "")[:200]
    return row


def scope_of(row):
    return "all" if row.get("範囲") == SCOPES["all"] else "me"


def group_of(row):
    """名前・標準を 1 つに決める組（元・範囲・持ち主）"""
    return (row.get("元"), row.get("範囲"), row.get("ログインID") if row.get("範囲") == SCOPES["me"] else "")


def visible(row, login):
    """この ID に見せる行か（共通は全員・ID の分は本人だけ）"""
    return row.get("範囲") == SCOPES["all"] or (bool(login) and row.get("範囲") == SCOPES["me"] and row.get("ログインID") == login)


def can_edit(row, login, common_ok):
    """書いてよいか（共通はマスタの権限・ID の分は本人）"""
    return common_ok if row.get("範囲") == SCOPES["all"] else (bool(login) and row.get("ログインID") == login)


def view(row, login="", common_ok=False):
    """マスタの行 → 画面の形。中身が壊れていれば body は {}。"""
    try:
        body = clean_body(row.get("中身") or "{}")[0]
    except PresetError:
        body = {}
    return {"id": row.get("id"), "name": row.get("名前", ""), "source": row.get("元", ""), "scope": scope_of(row),
            "login": row.get("ログインID", ""), "standard": row.get("標準") == "1", "body": body, "note": row.get("備考", ""),
            "rev": row.get("rev", 1), "updatedAt": row.get("updated_at", ""), "updatedBy": row.get("updated_by") or {},
            "canEdit": can_edit(row, login, common_ok)}


def standard_for(rows, source, login):
    """この ID・この元で当てる標準（ID の標準 → 共通の標準 → 無し）。rows はマスタの行"""
    mine = [r for r in rows if r.get("元") == source and r.get("標準") == "1" and visible(r, login)]
    own = next((r for r in mine if r.get("範囲") == SCOPES["me"]), None)
    return own or next((r for r in mine if r.get("範囲") == SCOPES["all"]), None)
