# -*- coding: utf-8 -*-
"""ダッシュボード（services/dashboard.py）: 設備別の仕掛ロット数・前日（現場歴）の設備別（日＋直）の実績本数と、集計対象の条件。"""
import json

from ..web import current_app, jsonify, request

from .. import effective_settings
from ..repositories.master_store import MasterError
from ..services import dashboard, data_sources, shifts, work_log
from .common import base_rev, bp, can_write, error, master_call, master_repo
from .sources import src_plan
from .worklog import worklog_plan


class ConditionInvalid(MasterError):
    kind, status = "invalid", 400


def _fail(fail):
    """段取りの失敗の答え（(Response, 状態)）→ {error, kind, status}（パネルの中に理由を出す）"""
    resp, status = fail
    d = json.loads(resp.get_data(as_text=True) or "{}")
    return {"error": d.get("error") or "読めませんでした。", "kind": d.get("kind") or "error", "status": status}


def _equipment_names(repo, wl_rows):
    """設備の名前（作業実績の設備 → 設備マスタ）。仕掛の設備の列の値を、この名前で見分ける"""
    names = [str(r.get("設備名") or "") for r in wl_rows] + [str(r.get("設備名") or "") for r in repo.equipment()]
    return [n for n in names if n.strip()]


def wip_panel(repo, wl_rows, cond):
    settings = effective_settings(current_app)
    src = data_sources.of_role(settings, repo.data_source_rows(), "仕掛")
    head = {"source": {k: src.get(k) for k in ("key", "name", "place", "equipColumn", "equipMode", "screen")} if src else None, "condition": cond}
    if not src:
        return {**head, "error": "役割「仕掛」のデータ元がありません。「マスタ管理」の「データ元」で決めてください。", "kind": "unset"}
    plan, fail = src_plan(src["key"])
    if fail:
        return {**head, **_fail(fail)}
    try:
        out = dashboard.wip_by_equipment(plan["path"], table=plan["table"], candidates=data_sources.TABLE_CANDIDATES,
                                         equip_column=src["equipColumn"], equip_mode=src["equipMode"],
                                         names=_equipment_names(repo, wl_rows), cond=cond)
    except Exception as e:
        return {**head, "error": str(e), "kind": "error"}
    return {**head, **out, "mirror": plan["source"]}


def work_panel(repo, wl_rows, cond):
    pats = repo.shift_patterns()
    now = current_app.config.get("DASHBOARD_NOW") or dashboard.now_local()   # 試験用のサーバーは試験データの日に合わせる
    items = []
    for row in work_log.ordered([r for r in wl_rows if str(r.get("表示") or "有") != "無"]):
        name = str(row.get("設備名") or "")
        pat = shifts.pattern_for(pats, name)
        segs = pat["segments"] if pat else []
        day = dashboard.yesterday_of(now, segs)
        it = {"key": row.get("キー"), "equipment": name, "day": day, "pattern": pat["name"] if pat else ""}
        plan, fail = worklog_plan(key=row.get("キー"), rows=wl_rows)
        if fail:
            items.append({**it, **_fail(fail)})
            continue
        try:
            items.append({**it, **dashboard.works_on(plan["path"], day=day, segments=segs, table=plan["table"],
                                                     candidates=work_log.TABLE_CANDIDATES, cond=cond), "mirror": plan["source"]})
        except Exception as e:
            items.append({**it, "error": str(e), "kind": "error"})
    days = sorted({x["day"] for x in items})
    # 条件の列の選び口: 読めた設備の列を合わせた物（設備で列が違っても選べる）。答えの設備ごとの列は外す（重いので）
    cols = []
    for x in items:
        for c in x.pop("columns", []) or []:
            if c not in cols:
                cols.append(c)
    return {"items": items, "days": days, "basis": "work", "condition": cond, "columns": cols}


@bp.get("/api/dashboard")
def dashboard_get():
    """2 つのパネル（仕掛・前日の実績）を 1 回で。part=wip|work で片方だけ。"""
    repo = master_repo()
    rows = repo.dashboard_rows()
    wl_rows = repo.work_logs()
    part = request.args.get("part", "")
    st = current_app.config["MASTER_STORE"]
    out = {"canEdit": can_write(dashboard.NAME), "shared": st.is_shared(dashboard.NAME)}
    if part in ("", "wip"):
        out["wip"] = wip_panel(repo, wl_rows, dashboard.condition_of(rows, "wip"))
    if part in ("", "work"):
        out["work"] = work_panel(repo, wl_rows, dashboard.condition_of(rows, "work"))
    return jsonify(out)


@bp.put("/api/dashboard/<panel>")
def dashboard_put(panel):
    """そのパネルの集計対象の条件を置く（全員で 1 つ）。本文 {filters, search, base_rev}。"""
    if panel not in dashboard.PANELS:
        return error("知らないパネルです。", 404)
    body = request.get_json(silent=True) or {}

    def run():
        try:
            cond = dashboard.clean_condition(body)
        except (ValueError, TypeError) as e:
            raise ConditionInvalid(str(e)) from None
        return {"row": master_repo().dashboard_put(panel, cond, base_rev())}
    return master_call(run)
