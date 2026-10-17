# -*- coding: utf-8 -*-
"""変換表（版 3.42.0。services/conversions.py）。コードの読み替え・判定表に名前を付けて置き、式 conv('名前', 値…) で使う。
読むのは誰でも（一覧の計算列が使う）。書くのは現場のマスタと同じ（部分的編集可から。門番 routes/access.py が確かめる）。"""
from ..web import jsonify, request

from ..services import conversions
from .common import base_rev, bp, can_write, error, master_call, master_repo


def _listing():
    """一覧（表示順）・選べる比べ方・当て方・この PC が書けるか・標準の名前（標準に戻せる表）と、標準を差し替えたか（customDefaults）"""
    repo = master_repo()
    st = repo.store
    presets = {r["名前"] for r in repo.conversion_presets()}
    items = [{**conversions.view(r), "rev": r.get("rev", 1), "preset": conversions.view(r)["name"] in presets}
             for r in conversions.ordered(repo.conversions())]
    return {"items": items, "ops": conversions.OPS, "modes": conversions.MODES, "places": conversions.PLACES,
            "presets": sorted(presets), "customDefaults": repo.conversion_defaults_custom(), "canEdit": can_write(conversions.NAME),
            "shared": st.is_shared(conversions.NAME), "revision": st.revision(conversions.NAME)}


@bp.get("/api/masters/conversions")
def conversions_list():
    return jsonify(_listing())


@bp.post("/api/masters/conversions")
def conversions_create():
    """{name, inputs, rows, other, apply, order} を新しい表として置く。→ 一覧（足した行の id は created）。"""
    body = request.get_json(force=True) or {}

    def run():
        row = master_repo().conversion_create(conversions.clean_row(body))
        return {**_listing(), "created": row.get("id")}
    return master_call(run, 201)


@bp.put("/api/masters/conversions/<int:item_id>")
def conversions_update(item_id):
    """直す（来た物だけ）。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    base = base_rev()
    body = dict(request.get_json(force=True) or {})
    body.pop("base_rev", None)
    return master_call(lambda: master_repo().conversion_update(item_id, conversions.clean_row(body, partial=True), base) and _listing())


@bp.post("/api/masters/conversions/<int:item_id>/preset")
def conversions_reset(item_id):
    """標準に戻す: 同梱のプリセット（app/master_defaults/conversions.json）の同じ名前の表の中身（入力・判定・その他・当て方）へ戻す。"""
    base = base_rev()
    repo = master_repo()
    row = next((r for r in repo.conversions() if r.get("id") == item_id), None)
    if not row:
        return error("その変換表はもうありません（ほかの PC が消した可能性があります）。", 404, "not_found")
    preset = conversions.preset_of(repo.conversion_presets(), row.get("名前"))
    if not preset:
        return error(f"「{row.get('名前')}」は同梱のプリセットにありません（標準に戻せるのはプリセットの表だけです）。", 400)
    data = {k: preset[k] for k in ("入力", "判定", "その他", "当て方")}
    return master_call(lambda: repo.conversion_update(item_id, data, base) and _listing())


@bp.delete("/api/masters/conversions/<int:item_id>")
def conversions_delete(item_id):
    base = base_rev()
    return master_call(lambda: master_repo().conversion_delete(item_id, base) or _listing())


@bp.get("/api/masters/conversions/export")
def conversions_export():
    """書き出す（版 3.43.0）: which=current（今の表）か defaults（標準）。→ {items: [{name, inputs, rows, other, apply}]}。
    ファイルにするのは画面（TPA.saveJson。形は {kind, version, savedAt, items}）"""
    repo = master_repo()
    rows = repo.conversion_presets() if request.args.get("which") == "defaults" else repo.conversions()
    return jsonify({"items": conversions.export_items(rows)})


@bp.post("/api/masters/conversions/import")
def conversions_import():
    """取り込む（版 3.43.0）: {items, asDefault}。同じ名前の表は中身を置き換え、無い名前は足す。asDefault なら、
    取り込んだ表を標準（「標準に戻す」で戻る中身）にもする。どれか 1 つでも形が違えば、何も取り込まずに断る"""
    body = request.get_json(force=True) or {}

    def run():
        rows = conversions.clean_import(body.get("items"))
        repo = master_repo()
        got = repo.conversion_import(rows)
        if body.get("asDefault"):
            repo.conversion_defaults_set(rows)
        return {**_listing(), **got}
    return master_call(run)


@bp.post("/api/masters/conversions/defaults")
def conversions_defaults():
    """標準を決める（版 3.43.0）: from=current（今の表をすべて標準にする）か bundled（同梱のプリセットに戻す）"""
    which = (request.get_json(force=True) or {}).get("from")
    if which not in ("current", "bundled"):
        return error("from は current か bundled です。", 400)

    def run():
        repo = master_repo()
        repo.conversion_defaults_set([{k: r.get(k) for k in conversions.FIELDS} for r in conversions.ordered(repo.conversions())] if which == "current" else [])
        return _listing()
    return master_call(run)
