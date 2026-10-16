# -*- coding: utf-8 -*-
"""集計表・グラフの組み方のプリセット（共通デフォルト・共通・ID ごと・標準）と、すぐに見るの選び（ID ごと）。
決まりは services/pivot_presets.py。読むのは誰でも（共通デフォルト・共通と自分の ID の分だけ）。
共通デフォルトを書くのは開発者・共通は現場のマスタと同じ権限・ID の分は本人だけ（ここで確かめる）。"""
from ..web import jsonify, request

from ..services import access
from ..services import pivot_presets as pp
from ..services.data_sources import is_screen_source
from .common import Forbidden, base_rev, bp, can_write, error, find_row, master_call, master_repo, me

SCOPE_ORDER = {"me": 0, "all": 1, "default": 2}


def _who():
    """→ (ログインID, 共通を書けるか, 共通デフォルトを書けるか＝開発者か, 切断されているか)"""
    try:
        m = me()
    except Exception:
        return "", False, False, None
    return m["login"], can_write(pp.NAME), m["flags"]["role"] == access.ROLE_DEVELOPER, m["revoked"]


def _gate(row, login, common_ok, default_ok, revoked):
    if revoked:
        raise Forbidden("この PC は一時的に切断されています。組み方を書き換えられません。")
    if not pp.can_edit(row, login, common_ok, default_ok):
        scope = pp.scope_of(row)
        raise Forbidden("共通デフォルトの組み方を書き換えられるのは、開発者だけです。共通か自分の ID に保存してください。" if scope == "default"
                        else "共通の組み方を書き換えられるのは、マスタを書ける権限（部分的編集可から）の人だけです。自分の ID に保存してください。"
                        if scope == "all" else "ほかの ID の組み方は書き換えられません。")


@bp.get("/api/pivot-presets")
def presets_list():
    """組み方の一覧（source の分・自分の ID → 共通 → 共通デフォルト（置いた物 → 組み込み）の順）。
    standardId はいま当てる標準（ID → 共通 → 共通デフォルトの標準）。quick はすぐに見るに並べる id（選んでいなければ既定。quickCustom）。"""
    src = request.args.get("source", "")
    if not is_screen_source(src):
        return error("source は lot・work・src:<キー> のどれかです。", 400)
    login, common_ok, default_ok, _ = _who()
    repo = master_repo()
    rows = [r for r in repo.pivot_presets() if r.get("元") == src and pp.visible(r, login)]
    std = pp.standard_for(rows, src, login)
    items = sorted((pp.view(r, login, common_ok, default_ok) for r in rows), key=lambda x: (SCOPE_ORDER[x["scope"]], x["name"]))
    items += pp.builtin_views(src)
    chosen = pp.quick_for(repo.pivot_quick(), src, login)
    known = {str(x["id"]) for x in items}
    quick = [k for k in chosen if k in known] if chosen is not None else pp.default_quick(items)
    return jsonify(items=items, login=login, canEditCommon=common_ok, canEditDefault=default_ok, standardId=std.get("id") if std else None,
                   quick=quick, quickCustom=chosen is not None, quickDefault=pp.default_quick(items))


@bp.put("/api/pivot-quick")
def quick_put():
    """{source, keys: [id…]} を、この ID のすぐに見るの並びとして置く。{source, reset: true} は既定に戻す。"""
    login, _, _, revoked = _who()

    def go():
        d = request.get_json(force=True) or {}
        src = d.get("source")
        if not is_screen_source(src):
            raise pp.PresetError("元（lot・work・src:<キー>）が違います。")
        if revoked:
            raise Forbidden("この PC は一時的に切断されています。すぐに見るを書き換えられません。")
        if not login:
            raise pp.PresetError("ログイン ID が分からないので、すぐに見るを選んで覚えられません。")
        keys = None if d.get("reset") else pp.clean_quick(d.get("keys"))
        master_repo().quick_set(login, src, keys)
        return {"ok": True, "quick": keys, "quickCustom": keys is not None}
    return _call(go)


@bp.post("/api/pivot-presets")
def presets_create():
    """{name, source, scope: default|all|me, standard, body, note} を新しい組み方として置く。"""
    login, common_ok, default_ok, revoked = _who()

    def go():
        row = pp.clean_row(request.get_json(force=True) or {}, login)
        _gate(row, login, common_ok, default_ok, revoked)
        return pp.view(master_repo().preset_create(row), login, common_ok, default_ok)
    return _call(go, 201)


@bp.put("/api/pivot-presets/<int:item_id>")
def presets_update(item_id):
    """名前・中身（上書き）・標準・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    login, common_ok, default_ok, revoked = _who()
    base = base_rev()

    def go():
        old = find_row(master_repo().pivot_presets(), item_id)
        if old is None:
            raise pp.PresetError(f"id={item_id} が見つかりません。")
        _gate(old, login, common_ok, default_ok, revoked)
        row = master_repo().preset_update(item_id, pp.clean_row(request.get_json(force=True) or {}, login, partial=True), base)
        return pp.view(row, login, common_ok, default_ok)
    return _call(go)


@bp.delete("/api/pivot-presets/<int:item_id>")
def presets_delete(item_id):
    login, common_ok, default_ok, revoked = _who()
    base = base_rev()

    def go():
        old = find_row(master_repo().pivot_presets(), item_id)
        if old is not None:
            _gate(old, login, common_ok, default_ok, revoked)
            master_repo().preset_delete(item_id, base)
        return {"ok": True}
    return _call(go)


def _call(fn, ok_status=200):
    """master_call と同じ（権限・版・重なりはマスタの決まりの形、中身の誤り PresetError は 400 で理由を返す）。"""
    return master_call(fn, ok_status)
