# -*- coding: utf-8 -*-
"""参照先マスタ（読みに行く場所: LotDsp の URL・ロット一覧の元ファイルなど）。"""
from ..web import current_app, jsonify, request

import app_env

from .. import effective_settings
from ..services import access, folder_browse, master_place, path_settings, presence, release_place
from .common import base_rev, bp, error, master_call, master_repo, me
from .lotlist import lot_mirror


@bp.get("/api/settings")
def settings_get():
    """項目ごとに: 既定（配った設定）・マスタで変えた値・いま効いている値・行の版。マスタの共有フォルダは見るだけ。"""
    st = current_app.config["MASTER_STORE"]
    _, items = path_settings.effective(current_app.config["APP_SETTINGS"], master_repo().path_settings())
    return jsonify(items=items, shared=st.is_shared(path_settings.NAME), share_dir=str(st.share_dir or ""),
                   config_file=str(app_env.config_path(current_app.config["BASE_DIR"])),
                   revision=st.revision(path_settings.NAME))


@bp.post("/api/settings/check")
def settings_check():
    """「確かめる」: 保存の前に、その値で本当に読めるか。"""
    body = request.get_json(silent=True) or {}
    item = path_settings.BY_KEY.get(str(body.get("key") or ""))
    if not item:
        return error("知らない項目です。", 400)
    try:
        value = path_settings.parse(item, body.get("value"))
    except ValueError as e:
        return jsonify(ok=False, message=str(e))
    if value is None:
        value = path_settings.default_of(current_app.config["APP_SETTINGS"], item["key"])
    return jsonify(path_settings.check(item, value, effective_settings(current_app)))


@bp.put("/api/settings/<path:key>")
def settings_put(key):
    """値を置く（空なら既定へ戻す）。base_rev は開いたときの行の版（行が無かったときは 0）。保存したらすぐ効かせる。"""
    item = path_settings.BY_KEY.get(key)
    if not item:
        return error("知らない項目です。", 400, "error")
    body = request.get_json(silent=True) or {}
    try:
        value = path_settings.parse(item, body.get("value"))
    except ValueError as e:
        return error(str(e), 400, "invalid")
    base = base_rev()
    return master_call(lambda: {"row": put_setting(key, value, base)})


def put_setting(key, value, base):
    """参照先の項目を置いて、すぐ効かせる（データ元の接続の設定からも。routes/sources.py）。value は parse 済み（None は既定へ）。"""
    row = master_repo().path_setting_put(key, value, base)
    if key.startswith("lot_list."):
        lot_mirror()       # 元ファイル・間隔・しきいを、起動し直さずに切り替える
    if key.startswith("work_log.") and current_app.config.get("WORK_LISTING"):
        current_app.config["WORK_LISTING"].forget()    # 実績のフォルダ・決まりを変えた → 次は探し直す
    return row


@bp.get("/api/update/settings")
def update_settings():
    """デスクトップ版の Rust が尋ねる、更新の置き場（参照先マスタで変えた値を重ねたもの。取り込みは desktop/src/update.rs）と、
    だれが（版を置く・配る版を決めてよいか。決めるのは services/access.py。置く・配るのは desktop/src/distribute.rs）と、
    この PC が使うマスタの置き場（配る版と一緒に全員へ配る。版 3.34.0）。"""
    up = effective_settings(current_app).get("update") or {}
    try:
        m = me()
        who = {"login": m["login"], "pc": m["pc"], "role": m["flags"]["role"],
               "canRelease": m["caps"]["canRelease"] and not m["revoked"]}
    except Exception as e:      # 権限を読めないときは置かせない（置き場を読むことは止めない）
        who = {"login": "", "pc": "", "role": "", "canRelease": False, "error": str(e)}
    st = current_app.config["MASTER_STORE"]
    # masters: この PC がいま使うマスタの置き場。配る版を決めるとき、全員が使う置き場として配る版の覚えに書く（desktop/src/distribute.rs）
    return jsonify(source=str(up.get("source") or ""), who=who, masters={"dir": str(st.share_dir or "")})


# ---- 配布の置き場を変える（場所・フォルダの名前）。写すのはここ、参照先 update.source を書き換えるのは画面（門番と行の版が効く）
def _release_mover():
    mv = current_app.config.get("RELEASE_MOVER")
    if mv is None:
        mv = current_app.config["RELEASE_MOVER"] = release_place.Mover()
    return mv


def _release_place_gate():
    """置き場を変えてよいか: 版を置く・配る版を決められ（開発者・メンテナンス者）、参照先（管理のマスタ）を書ける PC だけ。"""
    try:
        m = me()
    except Exception as e:
        return error(f"権限を読めないので、置き場を変えられません（{e}）。", 503, "unavailable")
    if m["revoked"]:
        return error("この PC は一時的に切断されています。", 403, "revoked")
    if not m["caps"]["canRelease"]:
        return error(f"配布の置き場を変えられるのは、開発者・メンテナンス者だけです（この PC は「{m['flags']['role']}」）。", 403, "forbidden")
    if not access.master_edit_can(m["flags"]["masterEdit"], "write", access.master_scope(path_settings.NAME)):
        return error(f"この PC のマスタ編集（{m['flags']['masterEdit']}）では、参照先（更新の置き場）を書き換えられません。", 403, "forbidden")
    return None


def _release_place_args():
    b = request.get_json(silent=True) or {}
    return str(b.get("from") or ""), str(b.get("parent") or ""), str(b.get("name") or ""), b.get("copy", True) is not False


@bp.post("/api/release/place/check")
def release_place_check():
    """新しい置き場（上のフォルダ＋名前）へ変えられるか。写す量・写すか切り替えるだけか（release_place.plan）。"""
    return jsonify(release_place.plan(*_release_place_args()))


@bp.post("/api/release/place/move")
def release_place_move():
    """置き場を写し始める（写さないときは確かめるだけ）。→ {mode, dest, started}。進み具合は /progress。"""
    denied = _release_place_gate()
    if denied:
        return denied
    pl = release_place.plan(*_release_place_args())
    if not pl.get("ok"):
        return error(pl.get("problem") or "変えられません。", 400, "invalid", plan=pl)
    if pl["mode"] != "copy":
        return jsonify(mode=pl["mode"], dest=pl["dest"], started=False)
    if not _release_mover().start(pl["src"], pl["dest"], pl["files"], pl["bytes"]):
        return error("ほかの置き場を写している最中です。終わってからやり直してください。", 409, "busy")
    return jsonify(mode="copy", dest=pl["dest"], started=True)


@bp.get("/api/release/place/progress")
def release_place_progress():
    return jsonify(_release_mover().progress())


# ---- マスタの置き場（共有フォルダ）を変える（services/master_place.py）。変えてよい PC は配布の置き場と同じ
def _master_place_args():
    b = request.get_json(silent=True) or {}
    return b.get("parent", ""), b.get("name", "")


def _master_using(st, pin):
    """置き場ごとに、いま使っている PC（利用状況の印）→ [{dir, pcs, reachable}]。全員の置き場・この PC の置き場・これまでの置き場（共有の物）。
    置き場を変えたあと、ほかの PC がそろったか（前の置き場に残っていないか）を画面で見せる（版 3.34.0）"""
    dirs = [str((pin or {}).get("dir") or ""), str(st.share_dir or "")] + [str(h.get("dir") or "") for h in st.history()]
    out, seen = [], set()
    for d in dirs:
        key = d.replace("/", "\\").rstrip("\\").lower()
        if not d or key in seen:
            continue
        seen.add(key)
        pcs = presence.online_in(d)
        out.append({"dir": d, "reachable": pcs is not None, "pcs": pcs or []})
    return out


@bp.get("/api/masters/place")
def master_place_get():
    """いまの置き場（共有か手元のみか・届くか・設定ファイルの値・この PC が覚えた値か）と、変えてよいか。"""
    st = current_app.config["MASTER_STORE"]
    s = st.status()
    denied = _release_place_gate()
    return jsonify(mode=s["mode"], dir=s["dir"], configured=s["configured"], override=s["override"],
                   reachable=s.get("reachable", True), history=st.history(), pin=s.get("pin"), using=_master_using(st, s.get("pin")),
                   canChange=denied is None,
                   why=(denied[0].get_json() or {}).get("error", "") if denied else "")


@bp.post("/api/masters/place/check")
def master_place_check():
    """新しい置き場（上のフォルダ＋名前）へ変えられるか。写すか切り替えるだけか・写す量（master_place.plan）。"""
    return jsonify(master_place.plan(current_app.config["MASTER_STORE"], *_master_place_args()))


@bp.post("/api/masters/place/move")
def master_place_move():
    """マスタを写して置き場を変える（この PC は今すぐ・ほかの PC は前の置き場の印をたどって移る）。"""
    denied = _release_place_gate()
    if denied:
        return denied
    try:
        return jsonify(master_place.move(current_app.config["MASTER_STORE"], *_master_place_args()))
    except ValueError as e:
        return error(str(e), 400, "invalid")


# ---- フォルダ・ファイルの欄の補助（「参照…」の窓・よく使う場所。services/folder_browse.py）。読むだけ
def _browse_gate():
    """見てよいか: 参照先（管理のマスタ）を書ける PC だけ（フォルダ・ファイルの欄は、どれも参照先か置き場を変える所にある）。"""
    try:
        m = me()
    except Exception as e:
        return error(f"権限を読めないので、フォルダを見られません（{e}）。", 503, "unavailable")
    if m["revoked"]:
        return error("この PC は一時的に切断されています。", 403, "revoked")
    if not access.master_edit_can(m["flags"]["masterEdit"], "write", access.master_scope(path_settings.NAME)):
        return error(f"この PC のマスタ編集（{m['flags']['masterEdit']}）では、参照先を変えられないため、フォルダを見る補助は使えません。", 403, "forbidden")
    return None


@bp.post("/api/fs/browse")
def fs_browse():
    """そのフォルダの中（フォルダ・その欄で選べるファイル・目的ごとの印）と区切り。無ければ届いた所まで上がる。"""
    denied = _browse_gate()
    if denied:
        return denied
    b = request.get_json(silent=True) or {}
    return jsonify(folder_browse.browse(b.get("path", ""), str(b.get("purpose") or "folder"), str(b.get("pattern") or "")))


@bp.get("/api/fs/places")
def fs_places():
    """よく使う場所: このアプリが使っている場所（ファイルはそのフォルダ）と、この PC の場所（届く物だけ）。"""
    denied = _browse_gate()
    if denied:
        return denied
    s = effective_settings(current_app)
    st = current_app.config["MASTER_STORE"]
    src = str((s.get("lot_list") or {}).get("source") or "")
    app_paths = [("master", "マスタの置き場", str(st.share_dir or "")),
                 ("quality", "品質データのフォルダ", folder_browse.parent_of(src)),
                 ("worklog", "作業実績のフォルダ", str((s.get("work_log") or {}).get("folder") or "")),
                 ("release", "配布の置き場", str((s.get("update") or {}).get("source") or ""))]
    app_paths += [("oldmaster", "前のマスタの置き場", h.get("dir") or "") for h in st.history()]
    return jsonify(items=folder_browse.places(app_paths))
