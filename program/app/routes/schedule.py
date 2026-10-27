# -*- coding: utf-8 -*-
"""スケジュール（データ元 sch。services/schedule.py。版 3.57.0）。

一覧・スライサー・集計表は、ほかのデータ元と同じ口（/api/src/sch・/slicer・/pivot・/source・/refresh）が答える。
違いは「どの表を読むか」だけで、それをここの schedule_plan が決める（sources.src_plan から呼ぶ）:
  ?equip=<設備>   … その設備の予定（CM3 から取り、手元の表にして、データ元の結合〈既定: 仕掛〉を当てた答え）
  ?equip=__HOT__  … HOT コイル作業順（HOT の設備の結合した答えから組んだ表。もう結合してあるので重ねない）
  equip が無い    … 最初の設備（ダッシュボードのパネルなど）
ここだけの口: GET /api/schedule（設備のタブ・HOT の設定・CM3 の画面の URL・自動更新の間隔）"""
from ..web import current_app, jsonify, request

import app_env

from .. import effective_settings
from ..services import lot_list, schedule
from ..services.cm3_schedule import Cm3Error
from .common import bp, error


def schedules():
    s = current_app.config.get("SCHEDULES")
    if s is None:
        s = current_app.config["SCHEDULES"] = schedule.Schedules(app_env.local_root() / "db_cache" / "schedule")
    return s


def cfg():
    return schedule.config(effective_settings(current_app))


def equip_of(c, equip=None):
    """問い合わせの設備（無ければ最初の設備）。知らない設備は ValueError。"""
    code = equip if equip is not None else (request.args.get("equip") or "")
    codes = [e["code"] for e in c["equipments"]]
    if not code:
        if not codes:
            raise ValueError("スケジュールの設備が決まっていません（参照先の「スケジュールの設備」）。")
        return codes[0]
    if code == schedule.HOT_KEY:
        if not c["hot"]["equipments"]:
            raise ValueError("HOT コイル作業順の設備が決まっていません。")
        return code
    if code not in codes:
        raise ValueError(f"未登録の設備です: {code}")
    return code


def _resolved(s):
    """データ元 s の結合の、仕掛の鍵の列を実際の列に合わせる（ﾛｯﾄ番号／ロット番号 など台帳ごとの書き方の違い。
    無い列を指している鍵だけ、仕掛の写しのロット番号の列に替える。仕掛がまだ写せていなければそのまま）。"""
    if not any(j.get("with") == "wip" for j in s.get("joins") or []):
        return s
    from .sources import actual_table, raw_plan
    plan, fail = raw_plan("wip")
    if fail:
        return s
    try:
        from ..services.sqlite_ro import connect_ro
        from pathlib import Path
        t = actual_table(plan["path"], plan["table"], "wip")
        with connect_ro(Path(plan["path"]), timeout=5) as c:
            cols = lot_list.columns(c, t)
    except Exception:
        return s
    joins = []
    for j in s["joins"]:
        on = j["on"] if j.get("with") != "wip" else [[a, b if b in cols else (lot_list.lot_column(cols) or b)] for a, b in j["on"]]
        joins.append({**j, "on": on})
    return {**s, "joins": joins}


def schedule_plan(s, *, joined=True, equip=None, force=False):
    """スケジュールの段取り（sources.src_plan と同じ形）→ (段取り, 失敗の答え)。"""
    from .sources import with_joins
    c = cfg()
    try:
        code = equip_of(c, equip)
    except ValueError as e:
        return None, error(str(e), 400, "unset")
    if code == schedule.HOT_KEY:
        return hot_plan(s, c, force=force)
    try:
        st = schedules().ensure(c, code, max_age=c["auto_refresh_sec"], force=force)
    except Cm3Error as e:
        return None, error(f"{code} の予定を CM3 から取れません: {e}", 502, "cm3")
    plan = {"path": st["path"], "table": schedule.TABLE, "page_size": s["read"]["page_size"], "def": s, "equip": code,
            "state": st, "source": schedule.source_info(c, st, code)}
    if not joined:
        return plan, None
    return with_joins(plan, _resolved(s), scope=f"sch_{schedule._safe(code)}")


def hot_plan(s, c, *, force=False):
    """HOT コイル作業順: HOT の設備を同時に取りに行き、それぞれの結合した答えから組む。"""
    from .sources import with_joins
    got = schedules().ensure_many(c, c["hot"]["equipments"], max_age=c["auto_refresh_sec"], force=force)
    parts, errors, states = [], [], {}
    rs = _resolved(s)
    if not rs.get("joins"):
        return None, error("HOT コイル作業順は、スケジュールを仕掛と結合して使います（前工程・次の設備・釜番は仕掛の列）。"
                           "「マスタ管理」の「データ元」で、スケジュールに仕掛の結合を足してください。", 400, "join")
    for code, st in got.items():
        if isinstance(st, Cm3Error):
            errors.append(f"{code}: {st}")
            continue
        p, fail = with_joins({"path": st["path"], "table": schedule.TABLE}, rs, scope=f"sch_{schedule._safe(code)}")
        if fail:
            return None, fail
        parts.append((code, p["path"], p["table"]))
        states[code] = st
    if not parts:
        return None, error(" / ".join(errors) or "HOT の設備の予定を取れません。", 502, "cm3")
    path, info = schedules().build_hot(c, parts, errors)
    hot = schedules().peek(schedule.HOT_KEY)
    ats = [x for x in (schedule.source_info(c, st, k)["at"] for k, st in states.items()) if x]
    src = schedule.source_info(c, {**hot, "data": {}, "error": " / ".join(errors)}, schedule.HOT_KEY)
    src["at"] = max(ats) if ats else None
    return {"path": path, "table": schedule.HOT_TABLE, "page_size": s["read"]["page_size"], "def": s, "equip": schedule.HOT_KEY,
            "state": hot, "states": states, "hot": info, "source": src}, None


def schedule_extra(plan):
    """一覧の答えに添える数（設備の札・HOT の札）。"""
    c = cfg()
    if plan["equip"] == schedule.HOT_KEY:
        return {"equip": plan["equip"], "hot": plan["hot"],
                "perEquipment": {k: schedule.summary(st) for k, st in (plan.get("states") or {}).items()}}
    joined = (plan.get("joined") or [None])[0]
    wip = next((st for st in plan.get("joined") or [] if st.get("with") == "wip"), None)
    sm = schedule.summary(plan["state"], wip or joined)
    sm["missLots"] = schedule.missing_lots(plan["path"], plan["table"], wip["columns"]) if wip else []
    return {"equip": plan["equip"], "summary": sm, "viewUrl": schedule.view_url(c, plan["equip"]), "joined": bool(wip)}


def schedule_source(equip=None):
    """鮮度の問い合わせ（画面が 20 秒ごと）。古くなった設備は裏で取り直す（答えは待たない）。"""
    c = cfg()
    try:
        code = equip_of(c, equip)
    except ValueError as e:
        return error(str(e), 400, "unset")
    codes = c["hot"]["equipments"] if code == schedule.HOT_KEY else [code]
    schedules().refresh_later(c, codes)
    if code == schedule.HOT_KEY:
        sts = [schedules().peek(k) for k in codes]
        infos = [schedule.source_info(c, st, k) for k, st in zip(codes, sts)]
        changed = [i["copiedAt"] for i in infos if i["copiedAt"]]
        return jsonify({**infos[0], "remote": str(c["cm3_base_url"]), "at": max((i["at"] for i in infos if i["at"]), default=None),
                        "copiedAt": max(changed) if changed else None, "mirrored": all(i["mirrored"] for i in infos),
                        "unreachable": any(i["unreachable"] for i in infos),
                        "reason": " / ".join(f"{k}: {i['reason']}" for k, i in zip(codes, infos) if i["reason"])})
    return jsonify(schedule.source_info(c, schedules().peek(code), code))


def schedule_card():
    """データ元の一覧の行の様子（最後に取った設備の時刻・設備の数。CM3 は見に行かない）。"""
    c = cfg()
    sts = [(e["code"], schedules().peek(e["code"])) for e in c["equipments"]]
    got = [(k, st) for k, st in sts if st.get("path")]
    if not got:
        return {"mirror": None, "equipCount": len(sts)}
    k, st = max(got, key=lambda x: x[1].get("checkedAt") or 0)
    return {"mirror": schedule.source_info(c, st, k), "equipCount": len(sts)}


@bp.get("/api/schedule")
def schedule_meta():
    """設備のタブ（設備・HOT）と、画面が使う設定。"""
    c = cfg()
    eqs = [{"key": e["code"], "name": e["name"], "termKbn": e["term_kbn"], "viewUrl": schedule.view_url(c, e["code"]),
            "state": "ok" if schedules().peek(e["code"]).get("path") else "unknown"} for e in c["equipments"]]
    hot = c["hot"]
    return jsonify(equipments=eqs, hot={"key": schedule.HOT_KEY, "title": hot["title"], "equipments": hot["equipments"], "prevValue": hot["prev_value"]},
                   autoRefreshSec=c["auto_refresh_sec"], inspectKeywords=c["inspect_keywords"], cm3=str(c["cm3_base_url"]))
