# -*- coding: utf-8 -*-
"""設備グループ（版 3.39.0。現場のマスタ）: いくつかの設備を 1 つのまとまり（グループ）にして、ダッシュボードのパネルで合算して出す。

1 行＝1 つのグループ {名称, まとめ方, 設備, 表示順, 備考}。
    まとめ方 … グループの組の名前（例: 「ライン別」に「CR ライン」「L ライン」、「工場別」に「第 1 工場」…）。
               パネルは、まとめ方を 1 つ選ぶと、その中のグループで設備を合算する（groups_for）。同じまとめ方の中で名称は 1 つずつ
    設備   … 設備名のカンマ区切り（勤務体系の適用設備と同じ書き方。services/shifts.py の equipment_list）
パネルの側の決め方（このパネルだけのグループ・選んだ設備を合算）は services/dashboard.py の egroup。数え方は services/pivot.py の EquipGroups。
"""
from __future__ import annotations

from .identity import normalize_part
from .shifts import equipment_list

NAME = "equipment_groups"
FIELDS = ["名称", "まとめ方", "設備", "表示順", "備考"]
NAME_MAX = 40
SET_DEFAULT = "グループ"


class GroupError(ValueError):
    pass


def clean_row(data, partial=False):
    """画面から来た値（name・set・equipment・order・note）→ マスタの行。partial は直すとき（来た物だけ）。"""
    out = {}
    if not partial or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise GroupError("グループの名称を入れてください。")
        out["名称"] = name[:NAME_MAX]
    if not partial or "set" in data:
        out["まとめ方"] = (str(data.get("set") or "").strip() or SET_DEFAULT)[:NAME_MAX]
    if not partial or "equipment" in data:
        eq = equipment_list(data.get("equipment"))
        if not eq:
            raise GroupError("グループに入れる設備を 1 つ以上選んでください。")
        out["設備"] = ",".join(eq)
    if "order" in data:
        try:
            out["表示順"] = str(int(data.get("order")))
        except (TypeError, ValueError):
            out["表示順"] = ""
    if not partial or "note" in data:
        out["備考"] = str(data.get("note") or "").strip()[:200]
    return out


def check_unique(rows, data, self_id=None):
    """同じまとめ方の中で同じ名称を 2 つ持たない → 重なれば理由の字（無ければ ""）"""
    key = (normalize_part(data.get("まとめ方")), normalize_part(data.get("名称")))
    for r in rows:
        if r.get("id") != self_id and (normalize_part(r.get("まとめ方") or SET_DEFAULT), normalize_part(r.get("名称"))) == key:
            return f"まとめ方「{data.get('まとめ方')}」には、グループ「{data.get('名称')}」がもうあります。"
    return ""


def _order(row):
    try:
        return int(row.get("表示順") or 0)
    except (TypeError, ValueError):
        return 0


def ordered(rows):
    return sorted(rows, key=lambda r: (_order(r), int(r.get("id") or 0)))


def view(row):
    """画面へ出す形"""
    return {"id": row.get("id"), "name": row.get("名称") or "", "set": row.get("まとめ方") or SET_DEFAULT,
            "equipment": equipment_list(row.get("設備")), "order": _order(row), "note": row.get("備考") or "", "rev": row.get("rev", 1),
            "updated_at": row.get("updated_at", ""), "updated_by": row.get("updated_by") or {}}


def sets(rows):
    """まとめ方の並び（表示順の最初のグループの順）→ [{name, groups: [view]}]"""
    out = {}
    for r in ordered(rows):
        v = view(r)
        out.setdefault(v["set"], []).append(v)
    return [{"name": k, "groups": v} for k, v in out.items()]


def groups_for(rows, set_name):
    """まとめ方 set_name のグループ → [{name, members}]（pivot.EquipGroups の形）。無ければ空"""
    key = normalize_part(set_name)
    return [{"name": v["name"], "members": v["equipment"]} for v in map(view, ordered(rows)) if normalize_part(v["set"]) == key]
