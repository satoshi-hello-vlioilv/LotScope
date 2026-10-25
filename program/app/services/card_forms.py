# -*- coding: utf-8 -*-
"""カードの設計（版 3.55.0。利用者の要望 2026-10-25: Access のフォームのように、カードを見た目のまま設計する。画面は static/js/card-form.js）。

一覧の行をダブルクリックで開く「カード」の見た目（項目の置き場・大きさ・名前・中身・見栄え）に名前を付けて置き、表ごとに呼び出す。
置き場と決まりは、ダッシュボード・集計表の組み方と同じ（マスタ dashboards・services/pivot_presets.py の行の形）:
    全員の既定（開発者）・全員（共有。マスタを書ける人）・自分だけ（その ID）。範囲ごとに ★標準（カードを開いたときに当てる）
    組み込みの標準（「標準」「要点」「2 段」）は表の列から画面が組む（列は表ごとに違うので、ここには持たない）
元 … "card:" ＋ 表の鍵（品質データ lotlist:表・作業実績 worklog:表〈設備によらない〉・データ元 src:キー:表）。名前・標準は元・範囲・持ち主ごとに 1 つ

中身（body）:
    {"cols": 12, "row": 48,                      … 方眼の列の数（6〜24）と 1 段の高さ px（32〜96）
     "tabs": [{"id", "name"}],                    … 分けて出すタブ（版 3.56.0。2 つ以上で効く。項目の "tab" がどのタブか。方眼はタブごと）
     "theme": {"accent": 色の鍵, "density": "normal"|"compact"|"roomy", "radius": 0〜16},
     "items": [{"id", "kind": "field"|"combo"|"text"|"section"|"dates", "tab": タブの id,
                "col": 列名（field）, "expr": 式（combo。表示列の作り方と同じ書き方: list-formula.js）, "text": 字（text・section）,
                "cols": [列名]（dates: 日付の列を集め、いまの行の日付の順に並べて出す。版 3.56.0）,
                "fold": 畳める見出し（section。アコーディオン）, "shut": はじめは畳んでおく（section）,
                "label": 出す名前（空なら列名）, "x", "y", "w", "h"（方眼の升。重ならない）,
                "st": {"fs": "s"|"m"|"l"|"xl", "bold": bool, "color": 色の鍵, "bg": 色の鍵, "align": "left"|"center"|"right",
                       "lab": "top"|"bottom"|"left"|"spread"|"legend"|"tag"|"inline"|"none", "border": "line"|"none"|"strong"}}]}
"""
from __future__ import annotations

import json
import re

from . import pivot_presets

SOURCE_PREFIX = "card:"
MAX_ITEMS = 250
MAX_TABS = 12
MAX_DATE_COLS = 30
COLS = (6, 24, 12)          # 最小・最大・既定
ROW = (32, 96, 48)
MAX_Y = 200
MAX_H = 24
KINDS = ("field", "combo", "text", "section", "dates")
FS = ("s", "m", "l", "xl")
ALIGN = ("left", "center", "right")
LAB = ("top", "bottom", "left", "spread", "legend", "tag", "inline", "none")   # 名前と値の置き方（card-form.js の LAB と同じ）
BORDER = ("line", "none", "strong")
DENSITY = ("normal", "compact", "roomy")
# 色の鍵（画面の CSS の色の組。字のまま色を置かない＝細工した字を CSS に入れない。版 3.52.1 と同じ考え）
COLORS = ("", "ink", "muted", "blue", "teal", "green", "amber", "red", "purple")
BGS = ("", "white", "pale", "blue", "teal", "green", "amber", "red", "gray")
_SOURCE = re.compile(r"card:(lotlist|worklog|src:[a-z0-9]{1,16}):[^\x00-\x1f]{0,120}")
_ID = re.compile(r"[A-Za-z0-9_-]{1,24}")


class CardFormError(pivot_presets.PresetError):
    """中身の形が違う（理由は利用者に見せる言葉）。"""


def source_ok(src):
    return isinstance(src, str) and bool(_SOURCE.fullmatch(src))


def _int(v, lo, hi, default):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _pick(v, allowed, default):
    return v if v in allowed else default


def clean_style(st):
    st = st if isinstance(st, dict) else {}
    out = {"fs": _pick(st.get("fs"), FS, "m"), "bold": bool(st.get("bold")), "color": _pick(st.get("color"), COLORS, ""),
           "bg": _pick(st.get("bg"), BGS, ""), "align": _pick(st.get("align"), ALIGN, "left"), "lab": _pick(st.get("lab"), LAB, "top"),
           "border": _pick(st.get("border"), BORDER, "line")}
    return out


def overlaps(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def clean_body(body):
    """カードの設計の中身（dict か JSON 字）→ (dict, JSON 字)。項目が重なる・方眼をはみ出す・多すぎれば CardFormError"""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise CardFormError("中身の形が違います。") from e
    if not isinstance(body, dict):
        raise CardFormError("中身の形が違います。")
    cols = _int(body.get("cols"), COLS[0], COLS[1], COLS[2])
    th = body.get("theme") if isinstance(body.get("theme"), dict) else {}
    theme = {"accent": _pick(th.get("accent"), COLORS, "blue") or "blue", "density": _pick(th.get("density"), DENSITY, "normal"),
             "radius": _int(th.get("radius"), 0, 16, 9)}
    tabs, tab_ids = [], set()
    for k, t in enumerate(body.get("tabs") if isinstance(body.get("tabs"), list) else []):
        if not isinstance(t, dict) or len(tabs) >= MAX_TABS:
            continue
        tid = str(t.get("id") or "")
        if not _ID.fullmatch(tid) or tid in tab_ids:
            tid = f"t{k + 1}"
            while tid in tab_ids:
                tid += "x"
        tab_ids.add(tid)
        tabs.append({"id": tid, "name": str(t.get("name") or f"タブ {k + 1}").strip()[:30] or f"タブ {k + 1}"})
    raw = body.get("items") if isinstance(body.get("items"), list) else []
    if len(raw) > MAX_ITEMS:
        raise CardFormError(f"項目は {MAX_ITEMS} までです。")
    items, ids = [], set()
    for i, it in enumerate(raw):
        if not isinstance(it, dict):
            continue
        kind = _pick(it.get("kind"), KINDS, "field")
        iid = str(it.get("id") or "")
        if not _ID.fullmatch(iid) or iid in ids:
            iid = f"i{i + 1}"
            while iid in ids:
                iid += "x"
        ids.add(iid)
        w = _int(it.get("w"), 1, cols, 3)
        x = _int(it.get("x"), 0, cols - w, 0)
        h = _int(it.get("h"), 1, MAX_H, 1)
        y = _int(it.get("y"), 0, MAX_Y, 0)
        x_ = {"id": iid, "kind": kind, "x": x, "y": y, "w": w, "h": h, "label": str(it.get("label") or "")[:60], "st": clean_style(it.get("st"))}
        if tabs:
            x_["tab"] = it.get("tab") if it.get("tab") in tab_ids else tabs[0]["id"]
        if kind == "field":
            col = str(it.get("col") or "")[:200]
            if not col:
                raise CardFormError(f"{i + 1} つ目の項目の列がありません。")
            x_["col"] = col
        elif kind == "combo":
            expr = str(it.get("expr") or "").strip()[:2000]
            if not expr:
                raise CardFormError(f"組み合わせた項目「{x_['label'] or iid}」の中身（式）がありません。")
            x_["expr"] = expr
        elif kind == "dates":
            cs = [str(c)[:200] for c in (it.get("cols") if isinstance(it.get("cols"), list) else []) if str(c or "").strip()][:MAX_DATE_COLS]
            if not cs:
                raise CardFormError(f"日付のまとまり「{x_['label'] or iid}」に列がありません。")
            x_["cols"] = cs
        else:
            x_["text"] = str(it.get("text") or "")[:400]
            if kind == "section":
                x_["fold"] = bool(it.get("fold"))
                x_["shut"] = bool(it.get("shut")) and x_["fold"]
        hit = next((q for q in items if q.get("tab") == x_.get("tab") and overlaps(q, x_)), None)   # 重なりはタブの中で見る
        if hit:
            raise CardFormError(f"項目「{x_['label'] or x_.get('col') or iid}」と「{hit['label'] or hit.get('col') or hit['id']}」が重なっています。")
        items.append(x_)
    out = {"cols": cols, "row": _int(body.get("row"), ROW[0], ROW[1], ROW[2]), "theme": theme, "items": items}
    if tabs:
        out["tabs"] = tabs
    text = json.dumps(out, ensure_ascii=False, sort_keys=True)
    if len(text.encode("utf-8")) > pivot_presets.MAX_BYTES:
        raise CardFormError("カードの設計が大きすぎます。")
    return out, text


def clean_row(data, login, partial=False):
    """画面から来た値 → マスタ dashboards の行（ダッシュボード・組み方と同じ列と決まり。中身だけカードの設計の形）"""
    try:
        return pivot_presets.clean_row(data or {}, login, partial, body_text=lambda b: clean_body(b)[1], source_ok=source_ok)
    except pivot_presets.PresetError as e:
        raise CardFormError(str(e)) from None


def view(row, login="", common_ok=False, default_ok=False):
    v = pivot_presets.view(row, login, common_ok, default_ok, body_of=lambda t: clean_body(t)[0])
    return v if v["body"] else {**v, "body": {"cols": COLS[2], "row": ROW[2], "theme": {}, "items": []}}
