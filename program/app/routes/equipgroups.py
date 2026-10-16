# -*- coding: utf-8 -*-
"""設備グループ（版 3.39.0。services/equip_groups.py）。ダッシュボードのパネルで、いくつかの設備を合算して出す組。
読むのは誰でも。書くのは現場のマスタと同じ（部分的編集可から。門番 routes/access.py が確かめる）。"""
from ..web import jsonify, request

from ..services import equip_groups
from .common import base_rev, bp, can_write, master_call, master_repo
from .shifts import _equipments


def _listing():
    st = master_repo().store
    rows = master_repo().equip_groups()
    items = [equip_groups.view(r) for r in equip_groups.ordered(rows)]
    return {"items": items, "sets": equip_groups.sets(rows), "equipments": _equipments(items), "canEdit": can_write(equip_groups.NAME),
            "shared": st.is_shared(equip_groups.NAME), "revision": st.revision(equip_groups.NAME)}


@bp.get("/api/masters/equipgroups")
def equipgroups_list():
    """設備グループの一覧（まとめ方ごと）・選べる設備・この PC が書けるか。"""
    return jsonify(_listing())


@bp.post("/api/masters/equipgroups")
def equipgroups_create():
    """{name, set, equipment, note} を新しいグループとして置く。→ 一覧（足した行の id は created）。"""
    body = request.get_json(force=True) or {}

    def run():
        row = master_repo().equip_group_create(equip_groups.clean_row(body))
        return {**_listing(), "created": row.get("id")}
    return master_call(run, 201)


@bp.put("/api/masters/equipgroups/<int:item_id>")
def equipgroups_update(item_id):
    """名称・まとめ方・設備・表示順・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    base = base_rev()
    body = dict(request.get_json(force=True) or {})
    body.pop("base_rev", None)
    return master_call(lambda: master_repo().equip_group_update(item_id, equip_groups.clean_row(body, partial=True), base) and _listing())


@bp.delete("/api/masters/equipgroups/<int:item_id>")
def equipgroups_delete(item_id):
    base = base_rev()
    return master_call(lambda: master_repo().equip_group_delete(item_id, base) or _listing())
