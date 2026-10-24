# -*- coding: utf-8 -*-
"""データ元（アプリが読む共有のデータ。WaveLog のデータソースマスタと同じ考え・版 3.36.0）。

品質データ・作業実績・仕掛と、あとから足すデータ元を、1 つの並びで扱う。どれも「共有の場所を手元へ写して読む」（db_mirror.py）。

  元           置き方                 場所の置き場                                      読む口
  品質データ   1 ファイル             参照先 lot_list.source・lot_list.table             /api/lotlist（デスクトップ版は Rust が答える）
  作業実績     フォルダ＋名前の決まり 参照先 work_log.folder・work_log.pattern           /api/worklog（設備ごとの登録は work_log.py）
  仕掛         1 ファイル             このマスタの行（無ければ設定 sources.wip の既定）  /api/src/wip
  足した元     1 ファイル             このマスタの行                                    /api/src/<キー>

品質データ・作業実績の場所は、これまでどおり参照先（path_settings）に置く（デスクトップ版の Rust・作業実績の登録が読む所を変えない）。
画面の「データ元」はどの元も同じ形で見せ、場所を直すと、その元の置き場（参照先かこのマスタ）へ書く。

このマスタ（data_sources。管理のマスタ・共有）の行: {id, キー, 表示名, 役割, 場所, 表, 設備の列, 設備の取り出し方, 画面, 並び, 備考, 結合}
  キー            … 変わらない名前（wip か、足したとき決める s<8 桁>）。画面の表示ルール（表示列・並び・条件）は src:<キー>:<表> に結ぶ
  役割            … 品質 / 実績 / 仕掛 / マスタ / その他（ダッシュボードが「仕掛」の元を数える。マスタは見出しの「マスタ」のタブの中に
                    設備のタブと同じ形で並ぶ。版 3.53.0）
  設備の列        … どの列で設備を見分けるか（空なら見分けない）
  設備の取り出し方 … そのまま（列の値が設備名）／前方一致（列の値が設備名で始まる。仕掛の 残仕掛設備ｺｰｽ「CR1 L-1 LS3」の先頭が次の設備）
  画面            … 有（見出しにタブを出す）／無（ダッシュボードなどで使うだけ）
  結合            … ほかのデータ元の列を、自由に組んだ鍵で合わせる決まり（JSON。services/data_join.py。版 3.53.0）
"""
from __future__ import annotations

import re
import uuid

from ..fsio import unquote_path
from . import data_join
from .identity import normalize_part

NAME = "data_sources"
FIELDS = ["キー", "表示名", "役割", "場所", "表", "設備の列", "設備の取り出し方", "画面", "並び", "備考", "結合"]
ROLES = ["品質", "実績", "仕掛", "マスタ", "その他"]
MASTER_ROLE = "マスタ"
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
    {"key": "lot", "name": "品質データ", "role": "品質", "kind": "file", "screen": "list", "api": "/api/lotlist",
     "settings": {"place": "lot_list.source", "table": "lot_list.table"}, "equipColumn": "設備", "equipMode": "そのまま"},
    {"key": "work", "name": "作業実績", "role": "実績", "kind": "folder", "screen": "work", "api": "/api/worklog",
     "settings": {"place": "work_log.folder", "table": "work_log.table", "pattern": "work_log.pattern"}, "equipColumn": "", "equipMode": "そのまま"},
    {"key": "wip", "name": "仕掛", "role": "仕掛", "kind": "file", "screen": "src:wip", "api": "/api/src/wip", "settings": None},
]
BUILTIN_KEYS = {b["key"] for b in BUILTINS}


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


def read_params(settings, key):
    """写し直す間隔・古いとみなす時間・1 頁の件数（設定 sources.<キー> → sources の既定 → 決まった既定）。"""
    src = (settings or {}).get("sources") or {}
    out = dict(READ_DEFAULTS)
    for layer in (src.get("defaults") or {}, src.get(key) or {}):
        out.update({k: v for k, v in layer.items() if k in READ_DEFAULTS and v not in (None, "")})
    return out


def clean_row(data, *, key=None, known=None):
    """画面から来た行をマスタの形へ（足りない列は空）。合わなければ ValueError（理由つき）。
    known: 結合の相手にできるデータ元（キー → 表示名）。結合の決まりは data_join.clean が整える"""
    row = {k: _s(data.get(k)) for k in FIELDS if k != "結合"}
    row["結合"] = data_join.clean(data.get("結合"), row["キー"] if key is None else key, known or {})
    if key is not None:
        row["キー"] = key
    if row["役割"] and row["役割"] not in ROLES:
        raise ValueError(f"役割は {'・'.join(ROLES)} のどれかにしてください。")
    if row["設備の取り出し方"] and row["設備の取り出し方"] not in EQUIP_MODES:
        raise ValueError(f"設備の取り出し方は {'・'.join(EQUIP_MODES)} のどちらかにしてください。")
    row["画面"] = "無" if row["画面"] == "無" else "有"
    row["場所"] = unquote_path(row["場所"]) if row["場所"] else ""
    if row["キー"] not in BUILTIN_KEYS and not row["表示名"]:
        raise ValueError("表示名を入れてください（見出しのタブ・ダッシュボードに出す名前）。")
    if row["キー"] not in BUILTIN_KEYS and not row["場所"]:
        raise ValueError("場所（共有の .sqlite3 ファイル）を入れてください。")
    return row


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
        if b["settings"]:                       # 場所は参照先（品質データ・作業実績）。設備の列はこのマスタの行で変えられる
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
        d["read"] = read_params(settings, b["key"])
        d["joins"] = data_join.parse(row.get("結合"))
        out.append(d)
    added = [r for r in rows or [] if _s(r.get("キー")) and _s(r.get("キー")) not in BUILTIN_KEYS]
    added.sort(key=lambda r: (_order(r), int(r.get("id") or 0)))
    for r in added:
        k = _s(r.get("キー"))
        out.append({"key": k, "name": _s(r.get("表示名")) or k, "role": _s(r.get("役割")) or "その他", "kind": "file",
                    "place": unquote_path(_s(r.get("場所"))), "pattern": "", "table": _s(r.get("表")),
                    "equipColumn": _s(r.get("設備の列")), "equipMode": _s(r.get("設備の取り出し方")) or "そのまま",
                    "screen": f"src:{k}", "listed": _s(r.get("画面")) != "無", "builtin": False, "storage": "master",
                    "settings": None, "api": f"/api/src/{k}", "id": r.get("id"), "rev": r.get("rev"), "note": _s(r.get("備考")),
                    "read": read_params(settings, k), "joins": data_join.parse(r.get("結合"))})
    names = {d["key"]: d["name"] for d in out}
    for d in out:
        d["group"] = "mst" if d["role"] == MASTER_ROLE and d["api"].startswith("/api/src/") else ""
        d["joinText"] = data_join.describe(d["joins"], names)
    return out


def join_targets(items):
    """結合の相手にできる元（1 ファイルの元: 品質データ・仕掛・足した元。作業実績は設備ごとのファイルなので外す）→ {キー: 表示名}。"""
    return {d["key"]: d["name"] for d in items if d["kind"] == "file"}


def _order(r):
    try:
        return int(_s(r.get("並び")) or 10 ** 6)
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
