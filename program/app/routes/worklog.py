# -*- coding: utf-8 -*-
"""作業実績（設備ごとの実績 SQLite。services/work_log.py）。一覧の問い合わせの形は異常ロット一覧（lotlist.py）と同じで、
どの設備かを equip（登録のキー）で渡す。設備の登録（表示する・しない）はマスタ管理の「作業実績」（管理のマスタ）。"""
from ..web import current_app, jsonify, request

import app_env

from .. import effective_settings
from ..repositories.master_store import MasterError
from ..services import lot_list, pivot, shifts, work_log, work_summary
from .common import base_rev, bp, can_write, error, master_call, master_repo


class FolderUnreachable(MasterError):
    """作業実績のフォルダに届かない（探せない）。"""
    kind, status = "unreachable", 503


def _params():
    return work_log.params(effective_settings(current_app))


def _listing():
    li = current_app.config.get("WORK_LISTING")
    if li is None:
        li = current_app.config["WORK_LISTING"] = work_log.Listing()
    return li


def _mirrors():
    ms = current_app.config.get("WORK_MIRRORS")
    if ms is None:
        ms = current_app.config["WORK_MIRRORS"] = work_log.Mirrors(app_env.local_root() / "db_cache" / "work_log")
    return ms


def _found(wl, fresh=False):
    """フォルダで見つけたファイルと、届かなかった理由（届けば ""）。"""
    try:
        return _listing().get(wl["folder"], wl["pattern"], fresh=fresh), ""
    except (work_log.FolderError, ValueError) as e:
        return [], str(e)


@bp.get("/api/worklog/files")
def worklog_files():
    """作業実績のタブで選べる設備（表示が「有」の行。all=1 なら全部）と、いま読むファイル・状態・まだ登録していないファイル（new）。"""
    wl = _params()
    found, err = _found(wl, fresh=request.args.get("fresh") == "1")
    v = work_log.view(master_repo().work_logs(), found, err)
    if request.args.get("all") != "1":
        v["items"] = [x for x in v["items"] if x["visible"]]
    work_log.mark_stale(v["items"], wl["stale_hours"])
    return jsonify(folder=wl["folder"], pattern=wl["pattern"], canEdit=can_write(work_log.NAME), staleHours=wl["stale_hours"], **v)


def worklog_plan(need_copy=True):
    """一覧を読む前の段取り → (段取り, 失敗の答え)。どちらか一方が None。
    段取り: 写しの係・読むファイル（写し）・既定の表・既定の件数・設備の行。need_copy=False は写しがまだ無くてもよい（再読込）。"""
    key = request.args.get("equip", "")
    wl = _params()
    row = next((r for r in master_repo().work_logs() if r.get("キー") == key), None)
    if not key or row is None:
        return None, error("その設備は作業実績に登録されていません。「マスタ管理」の「作業実績」でフォルダを探してください。", 404, "unknown")
    if str(row.get("表示") or "有") == "無":
        return None, error(f"「{row.get('設備名')}」は表示しない設定です（「マスタ管理」の「作業実績」で変えられます）。", 403, "hidden")
    ms = _mirrors()
    found, err = _found(wl)
    path = work_log.resolve(row, wl["folder"], found) if not err else None
    if path is not None:
        m = ms.get(key, path, wl["refresh_seconds"], wl["stale_hours"])
    else:
        m = ms.peek(key)      # フォルダに届かない・見つからなくても、前に写した物があればそれで見せる（fail-open）
        if m is None or not m.source_info()["mirrored"]:
            why = err or (f"「{row.get('ファイル名')}」が作業実績のフォルダに見つかりません（名前が変わったか、消されました）。"
                          "「マスタ管理」の「作業実績」で結ぶファイルを選び直してください。")
            return None, error(why, 404 if not err else 503, "missing" if not err else "unreachable",
                               equip={"key": key, "name": row.get("設備名"), "file": row.get("ファイル名")})
    read = m.read_path()
    equip = {"key": key, "name": row.get("設備名") or "", "file": path.name if path else row.get("ファイル名") or "",
             "renamed": bool(path and path.name != row.get("ファイル名"))}
    if read is None and need_copy:  # 写しがまだ無い（共有は直接読まない）。画面は写し終えたら引き直す
        return None, error(m.not_ready_text(), 503, "copying", source=m.source_info(), equip=equip)
    return {"mirror": m, "path": str(read), "table": row.get("表") or wl["table"], "page_size": wl["page_size"],
            "source": m.source_info(), "equip": equip}, None


def work_grouping(equip_name):
    """「作業でまとめる」（work=1）の係。直はその設備の勤務体系（設備を書いた体系 → 全設備共通）。
    start: 作業開始の列（無ければ既定の名前）・basis: work（現場歴）／cal（太陽暦）・order: desc（新しい順）／asc・
    day（YYYY-MM-DD。"-" は日付なし）・shift（直の番号）: 帯で押した日・直に一覧を絞る（数の帯は絞らない）。
    fill=1: 帯に作業の無い日（0 件の日）も出す。"""
    a = request.args
    if a.get("work") != "1":
        return None
    pat = shifts.pattern_for(master_repo().shift_patterns(), equip_name)
    brief = {k: pat[k] for k in ("id", "name", "equipmentText")} if pat else None
    try:
        shift = int(a["shift"]) if a.get("shift", "") != "" else None
    except ValueError:
        shift = None
    return work_summary.Grouping(pat["segments"] if pat else [], column=a.get("start", ""), basis=a.get("basis", "work"),
                                 order=a.get("order", "desc"), pattern=brief, day=a.get("day", ""), shift=shift, total=a.get("total", ""),
                                 fill=a.get("fill") == "1")


@bp.get("/api/worklog")
def worklog_list():
    """異常ロット一覧（/api/lotlist）と同じ引数（page, page_size, search, filters, sorts, group）で、その設備の写しから引く。
    work=1 なら作業（作業開始が同じ行）でまとめ、日・直ごとの数を work に入れる（services/work_summary.py）。"""
    plan, fail = worklog_plan()
    if fail:
        return fail
    a = request.args
    try:
        grouping = work_grouping(plan["equip"]["name"])
        out = lot_list.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"],
                             page=a.get("page", 1), page_size=a.get("page_size", plan["page_size"]),
                             search=a.get("search", ""), filters=a.get("filters", ""), sorts=a.get("sorts", ""), marks=a.get("marks", ""),
                             group=a.get("group") == "1", table_candidates=work_log.TABLE_CANDIDATES, grouping=grouping)
    except Exception as e:
        return error(str(e), 503, source=plan["source"], equip=plan["equip"])
    out["source"], out["equip"] = plan["source"], plan["equip"]
    if grouping:
        out["work"]["canEditShifts"] = can_write(shifts.NAME)
    return jsonify(out)


@bp.get("/api/worklog/slicer")
def worklog_slicer():
    plan, fail = worklog_plan()
    if fail:
        return fail
    a = request.args
    try:
        out = lot_list.slicer_answer(plan["path"], a, preferred_table=plan["table"], table_candidates=work_log.TABLE_CANDIDATES)
    except ValueError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/worklog/pivot")
def worklog_pivot():
    """ピボット集計（services/pivot.py）。一覧と同じ絞り込みに当たる全件を数える。作業日・直（@workday・@shift）と
    ロット数（作業開始が同じ行を 1）は、作業でまとめるのと同じ作業開始の列（start）・日付の数え方（basis）・勤務体系で決める。
    fields=1 なら、左のカラムの札の手がかり（値の種類の数・数の列か）。"""
    plan, fail = worklog_plan()
    if fail:
        return fail
    a = request.args
    try:
        if a.get("fields") == "1":
            return jsonify(pivot.fields(plan["path"], table=a.get("table", ""), preferred_table=plan["table"], table_candidates=work_log.TABLE_CANDIDATES))
        pat = shifts.pattern_for(master_repo().shift_patterns(), plan["equip"]["name"])
        work = {"clock": shifts.Clock(pat["segments"] if pat else []), "basis": a.get("basis", "work"), "start": a.get("start", ""),
                "pattern": pat["name"] if pat else ""}
        out = pivot.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"], search=a.get("search", ""),
                          filters=a.get("filters", ""), rows=a.get("rows", ""), cols=a.get("cols", ""), measures=a.get("measures", ""),
                          table_candidates=work_log.TABLE_CANDIDATES, work=work, month=a.get("month", ""), box=a.get("box", ""))
        out["shiftPattern"] = work["pattern"]
    except pivot.PivotError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/worklog/source")
def worklog_source():
    """いま読んでいるその設備のデータはいつのものか（共有は見に行かない）。"""
    m = _mirrors().peek(request.args.get("equip", ""))
    if m is None:
        return error("まだ開いていない設備です。", 404, "unknown")
    return jsonify(m.source_info())


@bp.post("/api/worklog/refresh")
def worklog_refresh():
    """「再読込」: その設備のファイルに新しい版があるかを今すぐ確かめ、あれば取り込む（変わっていなければ写さない・SHARED_READ.md の R2）。"""
    plan, fail = worklog_plan(need_copy=False)
    if fail:
        return fail
    m = plan["mirror"]
    res = m.refresh()
    return jsonify(result=res, source=m.source_info())


# ---------------- マスタ管理の「作業実績」（設備の登録。書くのは管理のマスタを書ける PC: routes/access.py の門番）
def _master_view(fresh=False):
    wl = _params()
    found, err = _found(wl, fresh=fresh)
    st = current_app.config["MASTER_STORE"]
    v = work_log.view(master_repo().work_logs(), found, err)
    work_log.mark_stale(v["items"], wl["stale_hours"])
    return {"folder": wl["folder"], "pattern": wl["pattern"], "canEdit": can_write(work_log.NAME), "shared": st.is_shared(work_log.NAME),
            "revision": st.revision(work_log.NAME), "staleHours": wl["stale_hours"], **v}


@bp.get("/api/masters/worklog")
def worklog_master():
    """登録の行（いま結んでいるファイル・状態つき）と、まだ登録していないファイル。fresh=1 はフォルダを読み直す。"""
    return master_call(lambda: _master_view(fresh=request.args.get("fresh") == "1"))


@bp.post("/api/masters/worklog/scan")
def worklog_scan():
    """フォルダを探し、見つけたファイルを登録に当てる（新しい設備を足す・名前が変わったファイルをたどって書き換える）。"""
    def run():
        wl = _params()
        try:
            found = _listing().get(wl["folder"], wl["pattern"], fresh=True)
        except (work_log.FolderError, ValueError) as e:
            raise FolderUnreachable(str(e)) from e
        res = master_repo().work_log_sync(found)
        return {"result": {"added": [r.get("設備名") for r in res["added"]], "renamed": res["renamed"],
                           "missing": [r.get("設備名") for r in res["missing"]], "files": len(found)}, **_master_view()}
    return master_call(run)


@bp.put("/api/masters/worklog/order")
def worklog_order():
    """設備の並び（作業実績のタブ・マスタ管理の一覧。全員で 1 つ）を {keys: [キー…]} の順にする。書けるのは管理のマスタを書ける人（門番 routes/access.py）。"""
    body = request.get_json(force=True) or {}

    def run():
        keys = body.get("keys")
        if not isinstance(keys, list) or not keys:
            raise ValueError("並べるキー（keys）がありません。")
        master_repo().work_log_order(keys)
        return _master_view()
    return master_call(run)


@bp.put("/api/masters/worklog/<int:item_id>")
def worklog_update(item_id):
    """設備名・表示・表・備考と、結ぶファイル（見つからない行を、フォルダにあるファイルへ結び直す: ファイル名）を直す。"""
    base = base_rev()
    body = dict(request.get_json(force=True) or {})
    body.pop("base_rev", None)

    def run():
        if "ファイル名" in body:      # 結び直す: そのファイルの今のファイルID も入れる（次に名前が変わってもたどれる）
            wl = _params()
            f = next((x for x in _listing().get(wl["folder"], wl["pattern"], fresh=True)
                      if x["file"].lower() == str(body["ファイル名"]).lower()), None)
            if f is None:
                raise ValueError(f"「{body['ファイル名']}」はフォルダにありません。")
            body.update({"ファイル名": f["file"], "ファイルID": f["fid"]})
        return master_repo().work_log_update(item_id, body, base)
    return master_call(run)


@bp.delete("/api/masters/worklog/<int:item_id>")
def worklog_delete(item_id):
    base = base_rev()

    def run():
        master_repo().work_log_delete(item_id, base)
        return {"status": "deleted", "id": item_id}
    return master_call(run)
