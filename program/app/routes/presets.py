# -*- coding: utf-8 -*-
"""集計表・グラフの組み方のプリセット（共通と ID ごと・標準）。決まりは services/pivot_presets.py。
読むのは誰でも（共通と自分の ID の分だけ）。共通を書くのは現場のマスタと同じ権限・ID の分は本人だけ（ここで確かめる）。"""
from ..web import jsonify, request

from ..services import pivot_presets as pp
from .common import Forbidden, base_rev, bp, can_write, error, find_row, master_call, master_repo, me


def _who():
    """→ (ログインID, 共通を書けるか, 切断されているか)"""
    try:
        m = me()
    except Exception:
        return "", False, None
    return m["login"], can_write(pp.NAME), m["revoked"]


def _gate(row, login, common_ok, revoked):
    if revoked:
        raise Forbidden("この PC は一時的に切断されています。組み方を書き換えられません。")
    if not pp.can_edit(row, login, common_ok):
        raise Forbidden("共通の組み方を書き換えられるのは、マスタを書ける権限（部分的編集可から）の人だけです。自分の ID に保存してください。"
                        if row.get("範囲") == pp.SCOPES["all"] else "ほかの ID の組み方は書き換えられません。")


@bp.get("/api/pivot-presets")
def presets_list():
    """組み方の一覧（source の分・共通と自分の ID の分）。standardId はいま当てる標準（ID の標準 → 共通の標準）。"""
    src = request.args.get("source", "")
    if src not in pp.SOURCES:
        return error("source は lot か work です。", 400)
    login, common_ok, _ = _who()
    rows = [r for r in master_repo().pivot_presets() if r.get("元") == src and pp.visible(r, login)]
    std = pp.standard_for(rows, src, login)
    items = sorted((pp.view(r, login, common_ok) for r in rows), key=lambda x: (x["scope"] != "me", x["name"]))
    return jsonify(items=items, login=login, canEditCommon=common_ok, standardId=std.get("id") if std else None)


@bp.post("/api/pivot-presets")
def presets_create():
    """{name, source, scope: all|me, standard, body, note} を新しい組み方として置く。"""
    login, common_ok, revoked = _who()

    def go():
        row = pp.clean_row(request.get_json(force=True) or {}, login)
        _gate(row, login, common_ok, revoked)
        return pp.view(master_repo().preset_create(row), login, common_ok)
    return _call(go, 201)


@bp.put("/api/pivot-presets/<int:item_id>")
def presets_update(item_id):
    """名前・中身（上書き）・標準・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    login, common_ok, revoked = _who()
    base = base_rev()

    def go():
        old = find_row(master_repo().pivot_presets(), item_id)
        if old is None:
            raise pp.PresetError(f"id={item_id} が見つかりません。")
        _gate(old, login, common_ok, revoked)
        return pp.view(master_repo().preset_update(item_id, pp.clean_row(request.get_json(force=True) or {}, login, partial=True), base), login, common_ok)
    return _call(go)


@bp.delete("/api/pivot-presets/<int:item_id>")
def presets_delete(item_id):
    login, common_ok, revoked = _who()
    base = base_rev()

    def go():
        old = find_row(master_repo().pivot_presets(), item_id)
        if old is not None:
            _gate(old, login, common_ok, revoked)
            master_repo().preset_delete(item_id, base)
        return {"ok": True}
    return _call(go)


def _call(fn, ok_status=200):
    """master_call と同じ（権限・版・重なりはマスタの決まりの形、中身の誤り PresetError は 400 で理由を返す）。"""
    return master_call(fn, ok_status)
