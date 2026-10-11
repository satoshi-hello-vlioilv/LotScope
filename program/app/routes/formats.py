# -*- coding: utf-8 -*-
"""共有の書式（一覧の表示ルールに名前を付けて共有に置き、ほかの設備・ほかの PC で呼び出す）。services/display_formats.py。
読むのは誰でも（当てるのは画面）。書くのは現場のマスタと同じ（門番 routes/access.py が確かめる）。"""
from ..web import jsonify, request

from ..services import display_formats as df
from .common import base_rev, bp, can_write, error, master_call, master_repo


@bp.get("/api/masters/formats")
def formats_list():
    """書式の一覧（source を付けるとその一覧の分だけ）。canEdit は、この PC が保存・上書き・削除できるか。"""
    src = request.args.get("source", "")
    if src and src not in df.SOURCES:
        return error("source は lot か work です。", 400)
    st = master_repo().store
    items = [df.view(r) for r in master_repo().formats() if not src or r.get("元") == src]
    items.sort(key=lambda x: x["name"])
    return jsonify(items=items, canEdit=can_write(df.NAME), shared=st.is_shared(df.NAME), revision=st.revision(df.NAME))


@bp.post("/api/masters/formats")
def formats_create():
    """{name, source, table, origin, note, body} を新しい書式として置く。"""
    body = request.get_json(force=True) or {}
    return master_call(lambda: df.view(master_repo().format_create(df.clean_row(body))), 201)


@bp.put("/api/masters/formats/<int:item_id>")
def formats_update(item_id):
    """名前・中身（上書き）・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    base = base_rev()
    body = dict(request.get_json(force=True) or {})
    return master_call(lambda: df.view(master_repo().format_update(item_id, df.clean_row(body, partial=True), base)))


@bp.delete("/api/masters/formats/<int:item_id>")
def formats_delete(item_id):
    base = base_rev()
    return master_call(lambda: master_repo().format_delete(item_id, base) or {"ok": True})
