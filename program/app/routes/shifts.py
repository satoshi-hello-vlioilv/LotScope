# -*- coding: utf-8 -*-
"""勤務体系（直の時間帯。services/shifts.py）。作業実績を日＋直でまとめるときの直の決まり。
読むのは誰でも。書くのは現場のマスタと同じ（部分的編集可から。門番 routes/access.py が確かめる）。"""
from ..web import jsonify

from ..services import shifts
from ..services.identity import normalize_part
from .common import base_rev, bp, can_write, master_call, master_repo, req_body, row_notes


def _equipments(items):
    """適用設備に選べる設備: 作業実績に登録した設備の名前（表示しない設備も）＋体系に書いてある名前（登録から消えた設備も外せるように）。"""
    out = []
    for name in [r.get("設備名") for r in master_repo().work_logs()] + [n for x in items for n in x["equipment"]]:
        s = str(name or "").strip()
        if s and all(normalize_part(s) != normalize_part(y) for y in out):
            out.append(s)
    return out


def _listing():
    repo = master_repo()
    st = repo.store
    rows, skipped = repo.view(shifts.NAME)       # 読めない行は隔てる（版 3.107.0。前は id が字の行で 500）
    items = sorted((shifts.view(r) for r in rows), key=lambda x: (x["order"], x["id"] or 0))
    out = {"items": items, "templates": shifts.TEMPLATES, "equipments": _equipments(items), "canEdit": can_write(shifts.NAME),
           "shared": st.is_shared(shifts.NAME), "revision": st.revision(shifts.NAME), "dayOffsetDefault": shifts.DAYOFF_DEFAULT}
    bad = repo.bad_rows(shifts.NAME)
    if bad:      # 表でない行（一覧では飛ばした行。版 3.102.0 の作った後の採点の割れ 1: 画面が「n 行目が読めません」と知らせる）
        out["badRows"] = bad
    out.update(row_notes(repo, shifts.NAME, skipped))
    return out


@bp.get("/api/masters/shifts")
def shifts_list():
    """勤務体系の一覧（区分・適用設備つき）・テンプレート・選べる設備・この PC が書けるか。"""
    return jsonify(_listing())


@bp.post("/api/masters/shifts")
def shifts_create():
    """{name, equipment, segments, note} を新しい勤務体系として置く。→ 一覧（足した行の id は created）。"""
    body = req_body()

    def run():
        row = master_repo().shift_create(shifts.clean_row(body))
        return {**_listing(), "created": row.get("id")}
    return master_call(run, 201)


@bp.put("/api/masters/shifts/<int:item_id>")
def shifts_update(item_id):
    """名称・適用設備・区分・表示順・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    base = base_rev()
    body = dict(req_body())
    body.pop("base_rev", None)
    return master_call(lambda: master_repo().shift_update(item_id, shifts.clean_row(body, partial=True), base) and _listing())


@bp.delete("/api/masters/shifts/<int:item_id>")
def shifts_delete(item_id):
    base = base_rev()
    return master_call(lambda: master_repo().shift_delete(item_id, base) or _listing())
