# -*- coding: utf-8 -*-
"""集計表・グラフの組み方のプリセット（版 3.26.0。版 3.27.0 で共通デフォルト・すぐに見るの選び。画面は static/js/lotlist-pivot.js）。

集計表・グラフで組んだ形（行・列・値・グラフの形・小計・総計・月で区切る・数値ラベル）に名前を付けて置き、
ほかの設備・ほかの表・ほかの PC で呼び出す。置き場は 3 つ（＋組み込み）:
    共通デフォルト … 全員の分の既定。書けるのは開発者だけ（アクセス権限の区分。ui_defaults の初期設定と同じ）
    共通 … 全員の分。書けるのは現場のマスタと同じ（部分的編集可から。共有の書式と同じ）
    ID   … ログイン ID ごとの分。その ID の本人だけが見て・書ける（マスタの権限は要らない）
    組み込み … このコードに書いた共通デフォルト（BUILTINS。だれも書き換えられない）。列の名前は役（$weight など）で書き、
             画面がその表の列に当てはめる（当てはまる列が無ければ、その表では使えない）
標準 … 範囲（共通デフォルト／共通／その ID）・元（異常ロット一覧／作業実績）ごとに 1 つ。組み方が空のまま集計表を開くと当てる。
       その ID の標準 → 共通の標準 → 共通デフォルトの標準（決めは standard_for の 1 か所）
すぐに見る … グラフの形の行に並べる組み方。ログイン ID・元ごとに選んで並べる（マスタ `pivot_quick`。行: {ログインID, 元, 並び}）。
       選んでいなければ既定（default_quick: 共通デフォルトのうち、開発者が置いた物 → 組み込みの quick の物）

置き場: MasterStore のマスタ `pivot_presets`（共有フォルダがあれば共有。全員で 1 つ）。
    行: {id, 名前, 元, 範囲, ログインID, 標準, 中身, 備考, rev, updated_at, updated_by}
    元 … lot（異常ロット一覧）・work（作業実績）。列が違うので分ける。名前は (元, 範囲, ログインID) ごとに 1 つ
    範囲 … 共通 か ID。ログインID … 範囲が ID のときの持ち主（共通は空）
    標準 … "1" か ""。中身 … 組み方の JSON（BODY_KEYS だけ）
"""
from __future__ import annotations

import json

from .data_sources import is_screen_source

NAME = "pivot_presets"
FIELDS = ["名前", "元", "範囲", "ログインID", "標準", "中身", "備考"]
SOURCES = {"lot": "異常ロット一覧", "work": "作業実績"}
SCOPES = {"default": "共通デフォルト", "all": "共通", "me": "ID"}          # 画面の言葉 → マスタの値（並びは標準を決める順の逆）
MAX_BYTES = 64 * 1024
NAME_MAX = 40
# グラフの形（画面の CHARTS と同じ鍵。版 3.27.0 で 5 → 14）
CHARTS = ("time", "line", "control", "column", "bar", "pareto", "stack", "stack100", "donut", "hist", "box", "heat", "scatter", "none")
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
        if not is_screen_source(src):
            raise PresetError("元（lot・work・src:<キー>）が違います。")
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
    return next((k for k, v in SCOPES.items() if v == row.get("範囲")), "me")


def group_of(row):
    """名前・標準を 1 つに決める組（元・範囲・持ち主）"""
    return (row.get("元"), row.get("範囲"), row.get("ログインID") if row.get("範囲") == SCOPES["me"] else "")


def visible(row, login):
    """この ID に見せる行か（共通デフォルト・共通は全員・ID の分は本人だけ）"""
    return row.get("範囲") in (SCOPES["all"], SCOPES["default"]) or (bool(login) and row.get("範囲") == SCOPES["me"] and row.get("ログインID") == login)


def can_edit(row, login, common_ok, default_ok=False):
    """書いてよいか（共通デフォルトは開発者・共通はマスタの権限・ID の分は本人）"""
    scope = scope_of(row)
    return default_ok if scope == "default" else common_ok if scope == "all" else (bool(login) and row.get("ログインID") == login)


def view(row, login="", common_ok=False, default_ok=False):
    """マスタの行 → 画面の形。中身が壊れていれば body は {}。"""
    try:
        body = clean_body(row.get("中身") or "{}")[0]
    except PresetError:
        body = {}
    return {"id": row.get("id"), "name": row.get("名前", ""), "source": row.get("元", ""), "scope": scope_of(row),
            "login": row.get("ログインID", ""), "standard": row.get("標準") == "1", "body": body, "note": row.get("備考", ""),
            "rev": row.get("rev", 1), "updatedAt": row.get("updated_at", ""), "updatedBy": row.get("updated_by") or {},
            "canEdit": can_edit(row, login, common_ok, default_ok), "builtin": False}


def standard_for(rows, source, login):
    """この ID・この元で当てる標準（ID の標準 → 共通の標準 → 共通デフォルトの標準 → 無し）。rows はマスタの行"""
    mine = [r for r in rows if r.get("元") == source and r.get("標準") == "1" and visible(r, login)]
    for scope in ("me", "all", "default"):
        hit = next((r for r in mine if r.get("範囲") == SCOPES[scope]), None)
        if hit:
            return hit
    return None


# ---------------------------------------------------------------- 組み込みの組み方（共通デフォルト。開発者がコードに書く）
# 列は役で書く（画面の lotlist-pivot.js の ROLES が、その表の列に当てはめる）:
#   $date … 日付の列（最初の 1 つ）  $weight … 量の数の列（重量 → 数量・長さ・枚数 → 最初の数の列）  $num2 … 2 つ目の数の列
#   $few1・$few2 … 種類の少ない（2〜12 種類）字の列（少ない順）  $lot … ロット番号の列
# quick … すぐに見るの既定に入れるか（選んでいない人の、グラフの形の行に出す）
def _d(column, part=""):
    return {"column": column, "part": part}


def _b(key, name, rows, measures, chart, cols=(), quick=False, **opts):
    body = {"rows": list(rows), "cols": list(cols), "measures": list(measures), "chart": chart, "sub": True, "grand": True,
            "chartAt": 0, "split": False, "labels": False, **opts}
    return {"key": key, "name": name, "body": clean_body(body)[0], "quick": quick}


LOTS, COUNT = {"agg": "lots"}, {"agg": "count"}
SUM_W, AVG_W, AVG_2 = {"agg": "sum", "column": "$weight"}, {"agg": "avg", "column": "$weight"}, {"agg": "avg", "column": "$num2"}
BUILTINS = {
    "work": [
        _b("work-day", "作業日ごとのロット数・$weight", [_d("@workday")], [LOTS, SUM_W], "time", quick=True),
        _b("work-shift", "日×直のロット数", [_d("@workday")], [LOTS], "time", cols=[_d("@shift")], quick=True),
        _b("hist", "$weightのヒストグラム", [_d("$weight", "bin")], [COUNT], "hist", quick=True),
        _b("few-pair", "$few1×$few2の件数", [_d("$few1")], [COUNT], "stack", cols=[_d("$few2")], quick=True),
        _b("work-month", "月ごとのロット数・$weight", [_d("@workday", "ym")], [LOTS, SUM_W], "column", labels=True),
        _b("work-heat", "日×直のロット数（ヒートマップ）", [_d("@workday")], [LOTS], "heat", cols=[_d("@shift")]),
        _b("work-control", "$weightの管理図（作業日ごとの平均）", [_d("@workday")], [AVG_W], "control"),
        _b("pareto", "$few1のパレート図", [_d("$few1")], [COUNT], "pareto"),
        _b("box", "$few1ごとの$weightの箱ひげ図", [_d("$few1")], [AVG_W], "box"),
    ],
    "lot": [
        _b("date-ym", "$date（年月）ごとの件数", [_d("$date", "ym")], [COUNT, LOTS], "time", quick=True),
        _b("hist", "$weightのヒストグラム", [_d("$weight", "bin")], [COUNT], "hist", quick=True),
        _b("few-pair", "$few1×$few2の件数", [_d("$few1")], [COUNT], "stack", cols=[_d("$few2")], quick=True),
        _b("pareto", "$few1のパレート図", [_d("$few1")], [COUNT], "pareto", quick=True),
        _b("donut", "$few1の内訳", [_d("$few1")], [COUNT], "donut"),
        _b("week-heat", "曜日×$few1の件数（ヒートマップ）", [_d("$date", "weekday")], [COUNT], "heat", cols=[_d("$few1")]),
        _b("date-control", "$weightの管理図（日ごとの平均）", [_d("$date", "date")], [AVG_W], "control"),
        _b("box", "$few1ごとの$weightの箱ひげ図", [_d("$few1")], [AVG_W], "box"),
        _b("scatter", "ロットごとの$weight×$num2（散布図）", [_d("$lot")], [AVG_W, AVG_2], "scatter"),
    ],
}


def builtin_views(source):
    """組み込みの組み方 → 画面の形（id は "b:鍵"。書き換えられない）"""
    return [{"id": f"b:{b['key']}", "name": b["name"], "source": source, "scope": "default", "login": "", "standard": False,
             "body": b["body"], "note": "", "rev": 0, "updatedAt": "", "updatedBy": {}, "canEdit": False, "builtin": True, "quick": b["quick"]}
            for b in BUILTINS.get(source, [])]


# ---------------------------------------------------------------- すぐに見る（ID ごとの選び。マスタ pivot_quick）
QUICK_NAME = "pivot_quick"
QUICK_FIELDS = ["ログインID", "元", "並び"]
QUICK_MAX = 24


def clean_quick(keys):
    """選んだ組み方の id の並び（数の id か "b:鍵"）。同じ物は 1 つ・QUICK_MAX まで"""
    if not isinstance(keys, list):
        raise PresetError("すぐに見るの並びの形が違います。")
    out = []
    for k in keys:
        k = str(k).strip()[:40]
        if (k.isdigit() or (k.startswith("b:") and len(k) > 2)) and k not in out:
            out.append(k)
    if len(out) > QUICK_MAX:
        raise PresetError(f"すぐに見るに並べられるのは {QUICK_MAX} までです。")
    return out


def default_quick(items):
    """選んでいない人のすぐに見る: 共通デフォルトのうち開発者が置いた物（並びは置いた順）→ 組み込みの quick の物"""
    placed = [str(x["id"]) for x in sorted((x for x in items if x["scope"] == "default" and not x["builtin"]), key=lambda x: x["id"])]
    return placed + [x["id"] for x in items if x["builtin"] and x.get("quick")]


def quick_for(rows, source, login):
    """この ID・この元で選んだ並び（マスタ pivot_quick の行）。選んでいなければ None"""
    row = next((r for r in rows if r.get("元") == source and login and r.get("ログインID") == login), None)
    if row is None:
        return None
    try:
        return clean_quick(json.loads(row.get("並び") or "[]"))
    except (ValueError, PresetError):
        return None
