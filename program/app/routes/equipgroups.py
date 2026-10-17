# -*- coding: utf-8 -*-
"""設備グループ（版 3.39.0。services/equip_groups.py）。ダッシュボードのパネルで、いくつかの設備を合算して出す組。
読むのは誰でも。書くのは現場のマスタと同じ（部分的編集可から。門番 routes/access.py が確かめる）。"""
from ..web import jsonify, request

from ..services import equip_groups
from ..services.identity import normalize_part
from .common import base_rev, bp, can_write, master_call, master_repo
from .dashboard import equipment_seen


def _listing():
    """一覧。選べる設備（equipments）は実際に出てくる設備すべて（版 3.40.0。routes/dashboard.py の equipment_seen。どこで見たか seen）＋
    グループに書いてある名前（もう出てこない設備も外せるように）。グループごとに、いま当てはまる設備（matched。ルールの答え）"""
    st = master_repo().store
    rows = master_repo().equip_groups()
    items = [equip_groups.view(r) for r in equip_groups.ordered(rows)]
    seen = equipment_seen()
    names = [x["name"] for x in seen]
    have = {normalize_part(n) for n in names}
    for n in (n for x in items for n in x["equipment"]):
        if normalize_part(n) not in have:
            have.add(normalize_part(n))
            names.append(n)
            seen.append({"name": n, "from": [], "n": 0})
    for x in items:
        x["matched"] = equip_groups.members_in(x, names)
    sets = equip_groups.sets(rows)
    for st_ in sets:
        for g in st_["groups"]:
            g["matched"] = equip_groups.members_in(g, names)
    return {"items": items, "sets": sets, "equipments": names, "seen": seen, "ruleOps": equip_groups.RULE_OPS, "canEdit": can_write(equip_groups.NAME),
            "shared": st.is_shared(equip_groups.NAME), "revision": st.revision(equip_groups.NAME)}


@bp.get("/api/masters/equipgroups")
def equipgroups_list():
    """設備グループの一覧（まとめ方ごと）・選べる設備・この PC が書けるか。"""
    return jsonify(_listing())


@bp.post("/api/masters/equipgroups")
def equipgroups_create():
    """{name, set, equipment, rules, except, note} を新しいグループとして置く。→ 一覧（足した行の id は created）。"""
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
