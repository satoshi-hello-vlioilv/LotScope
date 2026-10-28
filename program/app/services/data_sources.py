# -*- coding: utf-8 -*-
"""データ元（アプリが読む共有のデータ。WaveLog のデータソースマスタと同じ考え・版 3.36.0）。

品質データ・作業実績・仕掛と、あとから足すデータ元を、1 つの並びで扱う。どれも「共有の場所を手元へ写して読む」（db_mirror.py）。

  元           置き方                 場所の置き場                                      読む口
  品質         1 ファイル             参照先 lot_list.source・lot_list.table             /api/lotlist（デスクトップ版は Rust が答える）
  実績         フォルダ＋名前の決まり 参照先 work_log.folder・work_log.pattern           /api/worklog（設備ごとの登録は work_log.py）
  仕掛         1 ファイル             このマスタの行（無ければ設定 sources.wip の既定）  /api/src/wip
  スケジュール CM3（設備ごと）        参照先 schedule.cm3_base_url（設定 schedule）     /api/src/sch（版 3.57.0。services/schedule.py）
  足した元     1 ファイル             このマスタの行                                    /api/src/<キー>

品質・実績・スケジュールの場所・間隔は、これまでどおり参照先（path_settings）に置く（デスクトップ版の Rust・作業実績の登録が読む所を変えない）。
画面の「データ元」はどの元も同じ形の「接続の設定」（CONN。版 3.58.0）で見せ、直すと、その項目の置き場（参照先かこのマスタ）へ書く。
前は「参照先」「作業実績」のタブに分かれていた設定も、ここで直す（「つなぎ先」を 1 つにした。利用者の要望 2026-10-28）。

このマスタ（data_sources。管理のマスタ・共有）の行: {id, キー, 表示名, 役割, 場所, 表, 設備の列, 設備の取り出し方, 画面, 並び, 備考, 結合, グループ, 元}
  キー            … 変わらない名前（wip か、足したとき決める s<8 桁>）。画面の表示ルール（表示列・並び・条件）は src:<キー>:<表> に結ぶ
  役割            … 品質 / 実績 / 仕掛 / マスタ / その他（ダッシュボードが「仕掛」の元を数える。マスタは見出しの「マスタ」のタブの中に
                    設備のタブと同じ形で並ぶ。版 3.53.0）
  設備の列        … どの列で設備を見分けるか（空なら見分けない）
  設備の取り出し方 … そのまま（列の値が設備名）／前方一致（列の値が設備名で始まる。仕掛の 残仕掛設備ｺｰｽ「CR1 L-1 LS3」の先頭が次の設備）
  画面            … 有（見出しにタブを出す）／無（ダッシュボードなどで使うだけ）
  結合            … ほかのデータ元の列を、自由に組んだ鍵で合わせる決まり（JSON。services/data_join.py。版 3.53.0）
  グループ        … まとめる名前（版 3.54.0）。同じグループの元は、データ元の一覧で 1 つのまとまりになり、見出しでは 1 つのタブの中に
                    札で並ぶ（作業実績の設備のタブと同じ形）。役割「マスタ」でグループが空なら「マスタ」（版 3.53.0 の「マスタ」のタブ）
  確かめる間隔・古さの警告 … 仕掛・足した元の写し方（秒・時間。空なら設定 sources の既定。版 3.58.0）
  ロット番号の列  … 空＝自動（名前で探す）／ "-"＝無い／列名＝その列（版 3.58.0。「ロット」という名前の別の列を、ロット番号に
                    させない。どの元にもある。lot_list.lot_column の override）
  元              … 結合した表（版 3.54.0）: ここにほかのデータ元のキーがあれば、この行は自分の場所を持たず、その元の写しに「結合」を当てた
                    答えを 1 つの表として見せる（元・相手は見出しのタブに出さなくてよい。DataRelay の「結合」と同じ考え）
"""
from __future__ import annotations

import re
import uuid

from ..fsio import unquote_path
from . import data_join
from .identity import normalize_part

NAME = "data_sources"
FIELDS = ["キー", "表示名", "役割", "場所", "表", "設備の列", "設備の取り出し方", "画面", "並び", "備考", "結合", "グループ", "元",
          "確かめる間隔", "古さの警告", "ロット番号の列"]
ROLES = ["品質", "実績", "仕掛", "マスタ", "その他"]
SCHEDULE_ROLE = "予定"       # スケジュール（組み込みだけの役割。足した元には付けない）
MASTER_ROLE = "マスタ"
VIEW_ROLE = "結合した表"     # 画面の言葉（役割の値ではない。結合した表の役割は、選ばなければ「その他」）
GROUP_MAX = 24               # グループの名前の長さ
NO_GROUP = "-"               # グループを消した印（役割「マスタ」の元が「マスタ」へ自動で入らないように。版 3.58.0）
PATCH_FIELDS = {"画面", "グループ", "表示名"}     # 一覧からその場で変えられる列（PATCH。ほかの列はそのまま）
EQUIP_MODES = ["そのまま", "前方一致"]
# 読み方の既定（設定 sources.<キー> で変えられる。足した元は sources の既定）
READ_DEFAULTS = {"refresh_seconds": 60, "stale_hours": 36, "page_size": 500}
# 仕掛の既定（設定 sources.wip で上書き。WaveLog の仕掛と同じフォルダ）
WIP_DEFAULT = {"source": "\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳\\LOTNOW.sqlite3", "table": "",
               "equip_column": "残仕掛設備ｺｰｽ", "equip_mode": "前方一致"}
# 1 ファイルの元の表の候補（指定が無いとき）
TABLE_CANDIDATES = ["仕掛", "品質情報", "品質", "保留"]

# 決まった元。place/table は参照先の項目（path_settings）、screen は見出しのタブの id（app.js の SCREENS）
BUILTINS = [
    {"key": "lot", "name": "品質", "role": "品質", "kind": "file", "screen": "list", "api": "/api/lotlist",
     "settings": {"place": "lot_list.source", "table": "lot_list.table"}, "equipColumn": "設備", "equipMode": "そのまま"},
    {"key": "work", "name": "実績", "role": "実績", "kind": "folder", "screen": "work", "api": "/api/worklog",
     "settings": {"place": "work_log.folder", "table": "work_log.table", "pattern": "work_log.pattern"}, "equipColumn": "", "equipMode": "そのまま"},
    {"key": "wip", "name": "仕掛", "role": "仕掛", "kind": "file", "screen": "src:wip", "api": "/api/src/wip", "settings": None},
    # スケジュール（版 3.57.0。ScheduleView を移した）: 場所は CM3（参照先 schedule.cm3_base_url）。設備ごとに CM3 から取り、手元の表にして読む
    {"key": "sch", "name": "スケジュール", "role": SCHEDULE_ROLE, "kind": "cm3", "screen": "src:sch", "api": "/api/src/sch",
     "settings": {"place": "schedule.cm3_base_url"}, "equipColumn": "設備", "equipMode": "そのまま", "last": True},
]
GROUPABLE = {"wip"}   # グループに入れられる組み込みの元（品質データ・作業実績・スケジュールは見出しのタブが決まっている。スケジュールは設備のタブを持つ）
# スケジュールの既定の結合（このマスタに行が無いとき）: ロットNo = 仕掛のロット番号の列（仕掛の写しの列から決める: routes/sources.py）。
# 持ってくる列は ScheduleView の既定の台帳の列と、HOT コイル作業順に使う列（列の設定と同じく、あとから結合の欄で変えられる）
SCHEDULE_JOIN = {"with": "wip", "how": "left", "on": [["ロットNo", "ﾛｯﾄ番号"]],
                 "cols": ["製造調質", "ｵｰﾀﾞｰ板厚", "ｵｰﾀﾞｰ板幅", "BOX実績_良品重量", "実績_設備ｺｰｽ", "残仕掛設備ｺｰｽ", "設計_PIT炉番炉順",
                          "特急区分", "保留_区分", "工場納期", "約束納期"]}
BUILTIN_KEYS = {b["key"] for b in BUILTINS}

# ------------------------------------------------------------------ 接続の設定（版 3.58.0）
# どの元も「接続の設定」を同じ形で持つ（項目の並び・言葉・確かめ方は同じ。違うのは値の置き場だけ）。
# 値の置き場（CONN_BIND）: 参照先の項目のキー（path_settings。品質・実績・スケジュール）か、"row:列"（このマスタの行。仕掛・足した元）。
# 項目の種類・範囲・確かめ方は path_settings の項目と同じ物を使う（参照先の項目に結ぶ物は、その項目の決まりそのもの）。
CONN_SPECS = {
    "place": {"label": "場所（共有の .sqlite3）", "kind": "sqlite"},
    "table": {"label": "表（空なら自動）", "kind": "text"},
    "folder": {"label": "フォルダ（設備ごとの .sqlite3 を置く所）", "kind": "folder"},
    "pattern": {"label": "ファイル名の決まり（* が設備名）", "kind": "pattern"},
    "url": {"label": "CM3 の URL", "kind": "url"},
    "client_ip": {"label": "CM3 に名乗る端末の IP", "kind": "text"},
    "equipments": {"label": "設備（「、」区切り。端末区分が違う設備は L-9:2）", "kind": "text"},
    "inspect": {"label": "点検の行の言葉（「、」区切り）", "kind": "text"},
    "refresh": {"label": "確かめる間隔（秒）", "kind": "int", "min": 10, "max": 3600},
    "stale": {"label": "古さの警告（時間）", "kind": "number", "min": 0, "max": 24 * 60},   # 0 は知らせない（手がかりに書く）
    "lot": {"label": "ロット番号の列", "kind": "lotcol",
            "hint": "押すとロットを計算へ取り込む・虫眼鏡・ロットでまとめる列。自動は名前（ロット番号・ﾛｯﾄ番号・ロット№・LTNO → 名前に「ロット」を含む最初の列）で探します。"
                    "ロット番号ではない列が選ばれたときは「なし」か正しい列にしてください。"},
}
CONN_BIND = {
    "lot": {"place": "lot_list.source", "table": "lot_list.table", "refresh": "lot_list.refresh_seconds", "stale": "lot_list.stale_hours",
            "lot": "row:ロット番号の列"},
    "work": {"folder": "work_log.folder", "pattern": "work_log.pattern", "refresh": "work_log.refresh_seconds", "stale": "work_log.stale_hours",
             "lot": "row:ロット番号の列"},
    "sch": {"url": "schedule.cm3_base_url", "client_ip": "schedule.client_ip", "equipments": "schedule.equipments",
            "inspect": "schedule.inspect_keywords", "refresh": "schedule.auto_refresh_sec", "lot": "row:ロット番号の列"},
}
CONN_FILE = {"place": "row:場所", "table": "row:表", "refresh": "row:確かめる間隔", "stale": "row:古さの警告",
             "lot": "row:ロット番号の列"}   # 仕掛・足した元
ROW_READ = {"refresh_seconds": "確かめる間隔", "stale_hours": "古さの警告"}


def conn_bind(item):
    """その元の接続の設定の項目 → 置き場（{項目: 参照先のキー か row:列}）。結合した表は自分の接続を持たない（元の物）。"""
    if item.get("kind") == "view" or item.get("base"):      # 結合した表: 場所・間隔は元の物。ロット番号の列だけ自分で決める
        return {"lot": "row:ロット番号の列"}
    return CONN_BIND.get(item["key"]) or (CONN_FILE if item.get("kind") == "file" else {})


def conn_spec(field, setting=None):
    """項目の決まり（言葉・種類・範囲・手がかり）。参照先の項目に結ぶ物は、その項目の種類・範囲・手がかりを使う。"""
    spec = {"id": field, **CONN_SPECS[field]}
    if setting:
        spec.update({k: setting[k] for k in ("kind", "min", "max", "hint", "check_url") if k in setting})
    return spec


def conn_of(item, row, settings_items, defaults):
    """その元の接続の設定（画面の欄の並び）。settings_items: 参照先の項目の答え（path_settings.effective の items をキーで）。
    defaults: 行に結ぶ項目の既定（{"place": …, "refresh": …}）。→ [{id, label, kind, hint, min, max, bind, item, value, default, effective, rev}]"""
    out = []
    for field, where in conn_bind(item).items():
        if where.startswith("row:"):
            col = where[4:]
            v = _s((row or {}).get(col))
            dflt = defaults.get(field, "")
            out.append({**conn_spec(field), "bind": "row", "item": col, "value": v, "default": dflt,
                        "effective": v or dflt, "rev": (row or {}).get("rev") or 0})
        else:
            it = settings_items.get(where) or {}
            out.append({**conn_spec(field, it), "bind": "settings", "item": where, "value": "" if it.get("value") is None else it["value"],
                        "default": "" if it.get("default") is None else it["default"], "effective": it.get("effective"),
                        "rev": it.get("rev") or 0})
    return out


_SCREEN_KEY = re.compile(r"src:[a-z0-9]{1,16}")


def is_screen_source(src):
    """一覧の元の名前として正しいか（lot・work・src:<キー>）。共有の書式・集計表の組み方がどの元の物かに使う。"""
    src = str(src or "")
    return src in ("lot", "work") or bool(_SCREEN_KEY.fullmatch(src))


def new_key():
    """足した元のキー（行を消して足し直しても取り違えない。表示ルールが結ぶ名前）。"""
    return "s" + uuid.uuid4().hex[:8]


def _get(d, dotted):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _s(v):
    return ("" if v is None else str(v)).strip()


def read_params(settings, key, row=None):
    """写し直す間隔・古いとみなす時間・1 頁の件数（このマスタの行 → 設定 sources.<キー> → sources の既定 → 決まった既定）。
    品質・実績・スケジュールは、接続の設定の置き場（参照先の項目）の値（版 3.58.0。前は sources の既定だけで、参照先の間隔と食い違えた）。"""
    src = (settings or {}).get("sources") or {}
    out = dict(READ_DEFAULTS)
    for layer in (src.get("defaults") or {}, src.get(key) or {}):
        out.update({k: v for k, v in layer.items() if k in READ_DEFAULTS and v not in (None, "")})
    bind = CONN_BIND.get(key) or {}
    for k, field in (("refresh_seconds", "refresh"), ("stale_hours", "stale")):
        if field in bind and _get(settings, bind[field]) not in (None, ""):
            out[k] = _get(settings, bind[field])
        elif row and _s(row.get(ROW_READ[k])):
            out[k] = _num(row.get(ROW_READ[k]), out[k])
    return out


def _num(v, dflt):
    try:
        n = float(_s(v))
    except ValueError:
        return dflt
    return int(n) if n == int(n) else n


def clean_row(data, *, key=None, known=None):
    """画面から来た行をマスタの形へ（足りない列は空）。合わなければ ValueError（理由つき）。
    known: 結合の相手・結合した表の元にできるデータ元（キー → 表示名）。結合の決まりは data_join.clean が整える"""
    row = {k: _s(data.get(k)) for k in FIELDS if k != "結合"}
    if key is not None:
        row["キー"] = key
    row["結合"] = data_join.clean(data.get("結合"), row["キー"], known or {})
    if row["役割"] and row["役割"] not in ROLES:
        raise ValueError(f"役割は {'・'.join(ROLES)} のどれかにしてください。")
    if row["設備の取り出し方"] and row["設備の取り出し方"] not in EQUIP_MODES:
        raise ValueError(f"設備の取り出し方は {'・'.join(EQUIP_MODES)} のどちらかにしてください。")
    row["画面"] = "無" if row["画面"] == "無" else "有"
    row["場所"] = unquote_path(row["場所"]) if row["場所"] else ""
    row["グループ"] = " ".join(row["グループ"].split())[:GROUP_MAX]
    row["ロット番号の列"] = row["ロット番号の列"][:120]
    for col, field in (("確かめる間隔", "refresh"), ("古さの警告", "stale")):   # 写し方（空なら既定）。範囲は接続の設定の決まり
        if row[col]:
            spec = conn_spec(field)
            try:
                n = float(row[col])
            except ValueError:
                raise ValueError(f"「{spec['label']}」は数で入れてください。") from None
            if not spec["min"] <= n <= spec["max"]:
                raise ValueError(f"「{spec['label']}」は {spec['min']}〜{spec['max']} で入れてください。")
            row[col] = str(int(n)) if field == "refresh" or n == int(n) else str(n)
    if row["キー"] in BUILTIN_KEYS:
        row["元"] = ""
        if row["キー"] not in GROUPABLE:    # 品質・実績は見出しのタブが決まっている（グループに入れない）
            row["グループ"] = ""
    if row["元"]:                           # 結合した表: 場所は元の物。元は 1 ファイルの元（結合した表は元にできない）
        if row["元"] == row["キー"] or row["元"] not in (known or {}):
            raise ValueError("結合した表の元にするデータ元を選んでください（品質・仕掛・足したデータ元。実績と結合した表は元にできません）。")
        joins = data_join.parse(row["結合"])
        if not joins:
            raise ValueError("結合した表は、合わせる相手を 1 つ以上決めてください（鍵: この列 = 相手の列）。")
        if any(j["with"] == row["元"] for j in joins):
            raise ValueError("結合した表の元と同じデータ元は、相手にできません。")
        row["場所"], row["表"] = "", ""
    if row["キー"] not in BUILTIN_KEYS and not row["表示名"]:
        raise ValueError("表示名を入れてください（見出しのタブ・ダッシュボードに出す名前）。")
    if row["キー"] not in BUILTIN_KEYS and not row["場所"] and not row["元"]:
        raise ValueError("場所（共有の .sqlite3 ファイル）を入れてください。")
    return row


def row_of(item):
    """いま効いているデータ元（sources の 1 つ）→ このマスタの行の形（行が無い決まった元を、その場で変えるとき）。"""
    return {"キー": item["key"], "表示名": "" if item["builtin"] and item["name"] == _builtin(item["key"])["name"] else item["name"],
            "役割": "" if item["builtin"] else item["role"], "場所": item["place"] if item["storage"] == "master" and not item.get("base") else "",
            "表": item["table"] if not item.get("base") else "", "設備の列": item["equipColumn"], "設備の取り出し方": item["equipMode"],
            "画面": "有" if item["listed"] else "無", "並び": _s(item.get("order")), "備考": item.get("note", ""),
            "結合": item.get("joins") or [], "グループ": item.get("groupSet", ""), "元": item.get("base", ""),
            "確かめる間隔": item.get("rowRead", {}).get("確かめる間隔", ""), "古さの警告": item.get("rowRead", {}).get("古さの警告", ""),
            "ロット番号の列": item.get("lotSet", "")}


def _builtin(key):
    return next(b for b in BUILTINS if b["key"] == key)


def sources(settings, rows):
    """いま効いているデータ元の並び（決まった元 → 足した元。足した元は「並び」の順）。
    settings: 参照先で変えた値を重ねた設定（effective_settings）。rows: このマスタの行。
    -> [{key, name, role, kind, place, pattern, table, equipColumn, equipMode, screen, listed, builtin, storage, settings, api,
         id, rev, note, read}]"""
    by_key = {_s(r.get("キー")): r for r in rows or []}
    out = []
    for b in BUILTINS:
        row = by_key.get(b["key"]) or {}
        d = {**b, "builtin": True, "id": row.get("id"), "rev": row.get("rev"), "note": _s(row.get("備考"))}
        if b["kind"] == "cm3":                  # スケジュール: 場所は CM3 の URL（参照先）。表は設備ごと（予定）
            d.update(storage="settings", place=_s(_get(settings, b["settings"]["place"])), table="", pattern="")
            dflt = {"equip_column": b["equipColumn"], "equip_mode": b["equipMode"]}
        elif b["settings"]:                     # 場所は参照先（品質データ・作業実績）。設備の列はこのマスタの行で変えられる
            keys = b["settings"]
            d.update(storage="settings", place=unquote_path(_s(_get(settings, keys["place"]))), table=_s(_get(settings, keys["table"])),
                     pattern=_s(_get(settings, keys["pattern"])) if keys.get("pattern") else "")
            dflt = {"equip_column": b["equipColumn"], "equip_mode": b["equipMode"]}
        else:                                   # 場所はこのマスタ（行が無ければ設定 sources.<キー> の既定）
            dflt = {**WIP_DEFAULT, **(((settings or {}).get("sources") or {}).get(b["key"]) or {})}
            d.update(storage="master", place=unquote_path(_s(row.get("場所")) or _s(dflt.get("source"))),
                     table=_s(row.get("表")) or _s(dflt.get("table")), pattern="", placeDefault=unquote_path(_s(dflt.get("source"))))
        # 行があれば行の値（空にした＝見分けない、も含む）。無ければ既定
        d["equipColumn"] = _s(row.get("設備の列")) if row else _s(dflt.get("equip_column"))
        d["equipMode"] = (_s(row.get("設備の取り出し方")) if row else "") or _s(dflt.get("equip_mode")) or "そのまま"
        d["name"] = _s(row.get("表示名")) or b["name"]
        d["listed"] = True if b["key"] in ("lot", "work") else _s(row.get("画面")) != "無"
        d["read"] = read_params(settings, b["key"], row)
        d["rowRead"] = {c: _s(row.get(c)) for c in ROW_READ.values()}
        d["lotSet"] = _s(row.get("ロット番号の列"))
        d["joins"] = data_join.parse(row.get("結合"))
        if b["kind"] == "cm3" and not row:      # 行がまだ無い: 既定の結合（仕掛と合わせる）
            d["joins"], d["joinsDefault"] = data_join.parse([SCHEDULE_JOIN]), True
        d["groupSet"] = _s(row.get("グループ")) if b["key"] in GROUPABLE else ""
        d["order"] = _s(row.get("並び"))
        out.append(d)
    added = [r for r in rows or [] if _s(r.get("キー")) and _s(r.get("キー")) not in BUILTIN_KEYS]
    for r in added:
        k = _s(r.get("キー"))
        out.append({"key": k, "name": _s(r.get("表示名")) or k, "role": _s(r.get("役割")) or "その他", "kind": "file",
                    "place": unquote_path(_s(r.get("場所"))), "pattern": "", "table": _s(r.get("表")),
                    "equipColumn": _s(r.get("設備の列")), "equipMode": _s(r.get("設備の取り出し方")) or "そのまま",
                    "screen": f"src:{k}", "listed": _s(r.get("画面")) != "無", "builtin": False, "storage": "master",
                    "settings": None, "api": f"/api/src/{k}", "id": r.get("id"), "rev": r.get("rev"), "note": _s(r.get("備考")),
                    "read": read_params(settings, k, r), "rowRead": {c: _s(r.get(c)) for c in ROW_READ.values()},
                    "lotSet": _s(r.get("ロット番号の列")),
                    "joins": data_join.parse(r.get("結合")),
                    "groupSet": _s(r.get("グループ")), "order": _s(r.get("並び")), "base": _s(r.get("元"))})
    # 並び: 品質データ・作業実績は先頭に決まる。ほかは「並び」の順（無ければ足した順。仕掛は足した元より前・
    # あとから組み込んだ元〈スケジュール〉は最後。いまのタブの並びを崩さない）
    head, rest = out[:2], out[2:]
    rest.sort(key=lambda d: (_order(d["order"]) if d["order"] or not d["builtin"] else (10 ** 7 if d.get("last") else 0),
                             0 if d["builtin"] else 1, int(d.get("id") or 0)))
    out = head + rest
    by = {d["key"]: d for d in out}
    for d in out:                               # 結合した表: 場所・表は元の物（読むのは元の写し）
        b = by.get(d.get("base") or "")
        if d.get("base"):
            if b is None or b.get("base") or b["kind"] != "file":
                d.update(kind="view", place="", table="", broken=True)
            else:
                d.update(kind="view", place=b["place"], table=b["table"], baseName=b["name"])
    names = {d["key"]: d["name"] for d in out}
    for d in out:
        # グループ（見出しのタブのまとまり）。マスタは、決めていなければ「マスタ」
        if d["groupSet"] == NO_GROUP:       # グループを消した元（役割「マスタ」でも「マスタ」へ入れない）
            d["group"] = ""
        else:
            d["group"] = d["groupSet"] or (MASTER_ROLE if d["role"] == MASTER_ROLE and d["api"].startswith("/api/src/") else "")
        d["joinText"] = data_join.describe(d["joins"], names)
        d["usedBy"] = [x["key"] for x in out if x is not d and (x.get("base") == d["key"] or any(j["with"] == d["key"] for j in x["joins"]))]
    return out


def join_targets(items):
    """結合の相手・結合した表の元にできる元（1 ファイルの元: 品質データ・仕掛・足した元。作業実績は設備ごとのファイル・
    結合した表は自分の写しを持たないので外す）→ {キー: 表示名}。"""
    return {d["key"]: d["name"] for d in items if d["kind"] == "file"}


def _order(v):
    try:
        return int(_s(v) or 10 ** 6)
    except ValueError:
        return 10 ** 6


def find(settings, rows, key):
    """キーのデータ元（無ければ None）。"""
    return next((s for s in sources(settings, rows) if s["key"] == key), None)


def of_role(settings, rows, role):
    """その役割の元（最初の 1 つ。ダッシュボードが「仕掛」「実績」を探す）。"""
    return next((s for s in sources(settings, rows) if s["role"] == role), None)


# ------------------------------------------------------------------ 設備の見分け
class EquipmentMatcher:
    """列の値 → 設備名。names: 設備の名前の並び（設備マスタ・作業実績の設備）。
    そのまま: 値そのもの（前後の空白を除く）。前方一致: 値が設備名で始まる物（長い名前を先に当てる。CR と CR2 なら CR2）。
    どれにも当たらない値は、最初の空白までを設備名とみなす（名前の分からない設備も数から落とさない）。比べ方は NFKC・大文字。"""

    def __init__(self, names, mode="そのまま"):
        self.mode = mode if mode in EQUIP_MODES else "そのまま"
        seen, self.names = set(), []
        for n in sorted((_s(x) for x in names or []), key=lambda x: -len(normalize_part(x))):
            k = normalize_part(n)
            if k and k not in seen:
                seen.add(k)
                self.names.append((k, n))
        self._cache = {}

    def __call__(self, value):
        v = _s(value)
        if v in self._cache:
            return self._cache[v]
        out = v
        if self.mode == "前方一致" and v:
            k = normalize_part(v)
            hit = next((n for nk, n in self.names if k.startswith(nk)), None)
            out = hit if hit is not None else v.split()[0]
        elif self.mode == "そのまま" and v:
            k = normalize_part(v)
            out = next((n for nk, n in self.names if nk == k), v)
        self._cache[v] = out
        return out
