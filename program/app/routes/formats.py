# -*- coding: utf-8 -*-
"""共有の書式（一覧の表示ルールに名前を付けて共有に置き、ほかの設備・ほかの PC で呼び出す）。services/display_formats.py。
読むのは誰でも（当てるのは画面）。書くのは現場のマスタと同じ（門番 routes/access.py が確かめる）。"""
from ..web import jsonify, request

from ..services import display_formats as df
from ..services.data_sources import is_screen_source
from .common import base_rev, bp, can_write, error, master_call, master_repo, req_body, row_notes


@bp.get("/api/masters/formats")
def formats_list():
    """書式の一覧（source を付けるとその一覧の分だけ）。canEdit は、この PC が保存・上書き・削除できるか。"""
    src = request.args.get("source", "")
    if src and not is_screen_source(src):
        return error("source は lot・work・src:<キー> のどれかです。", 400)
    repo = master_repo()
    st = repo.store
    rows, skipped = repo.view(df.NAME)      # 読めない行は隔てて知らせる（版 3.107.0。前は名前が数の行で 500・NaN の行で答えが JSON でなかった）
    items = [df.view(r) for r in rows if not src or r.get("元") == src]
    items.sort(key=lambda x: x["name"])
    return jsonify(items=items, canEdit=can_write(df.NAME), shared=st.is_shared(df.NAME), revision=st.revision(df.NAME),
                   **row_notes(repo, df.NAME, skipped))


@bp.post("/api/masters/formats")
def formats_create():
    """{name, source, table, origin, note, body} を新しい書式として置く。"""
    body = req_body()
    return master_call(lambda: df.view(master_repo().format_create(df.clean_row(body))), 201)


@bp.put("/api/masters/formats/<int:item_id>")
def formats_update(item_id):
    """名前・中身（上書き）・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    base = base_rev()
    body = dict(req_body())
    return master_call(lambda: df.view(master_repo().format_update(item_id, df.clean_row(body, partial=True), base)))


@bp.delete("/api/masters/formats/<int:item_id>")
def formats_delete(item_id):
    base = base_rev()
    return master_call(lambda: master_repo().format_delete(item_id, base) or {"ok": True})
