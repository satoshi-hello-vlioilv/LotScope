# -*- coding: utf-8 -*-
"""データ元（services/data_sources.py）。並び・足す・直す・消す・確かめると、1 ファイルの元（仕掛・足した元）の一覧の問い合わせ。

一覧の問い合わせの形は品質異常（lotlist.py）と同じ（page, page_size, search, filters, sorts, group）。
品質データ・作業実績は、これまでの口（/api/lotlist・/api/worklog）が答える。ここは /api/src/<キー> の元だけ。"""
from pathlib import Path

from ..web import current_app, jsonify, request

import app_env

from .. import effective_settings
from ..repositories.master_store import MasterError
from ..services import data_join, data_sources, lot_list, path_settings, pivot, work_log
from .common import base_rev, bp, can_write, error, master_call, master_repo


class SourceInvalid(MasterError):
    """データ元の行が決まりに合わない（表示名・場所が空・知らない役割 など）。"""
    kind, status = "invalid", 400


def _all():
    return data_sources.sources(effective_settings(current_app), master_repo().data_source_rows())


def _mirrors():
    ms = current_app.config.get("SRC_MIRRORS")
    if ms is None:
        ms = current_app.config["SRC_MIRRORS"] = work_log.Mirrors(app_env.local_root() / "db_cache" / "sources", prefix="src")
    return ms


def _rows_of(m, s):
    """写しの行の数（手元の写しを数えるだけ。共有は読まない）。写しがまだ無い・読めなければ None"""
    path = m.read_path() if m else None
    if not path:
        return None
    from ..services.sqlite_ro import connect_ro, qi
    try:
        with connect_ro(Path(path), timeout=2) as c:
            t = lot_list.pick_table(lot_list.tables(c), s.get("table") or "",
                                    lot_list.TABLE_CANDIDATES if s["key"] == "lot" else data_sources.TABLE_CANDIDATES)
            return int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}").fetchone()[0]) if t else None
    except Exception:
        return None


def _public(s):
    """画面へ返す形（写しの様子と行の数つき。共有は見に行かない）。"""
    k = s.get("base") or s["key"]
    m = (current_app.config.get("LOT_MIRROR") if k == "lot" else _mirrors().peek(k)) if (s["api"].startswith("/api/src/") or k == "lot") and s["kind"] != "cm3" else None
    if s["kind"] == "cm3":                  # スケジュール: 最後に取った設備の様子（共有も CM3 も見に行かない）
        from .schedule import schedule_card
        return {**s, **schedule_card(), "rows": None, "joinStats": None}
    rows = _rows_of(m, s) if s["kind"] != "view" else _view_rows(s)
    return {**s, "mirror": m.source_info() if m else None, "rows": rows, "joinStats": _join_stats(s)}


def _view_rows(s):
    """結合した表の行の数（最後に組んだ答えの数。まだ組んでいなければ None）。"""
    got = _joiner().last.get(s["key"]) or _joiner().last.get(f"try-{s['key']}")
    st = (got or {}).get("stats") or []
    return st[-1].get("out") if st and got.get("items") == s["joins"] else None


def _join_stats(s):
    """最後に組んだ結合の数（このプロセスで組んだ物だけ。決まりが今と同じときだけ。カードの「当たった数」）。"""
    if not s.get("joins"):
        return None
    last = _joiner().last
    # 読んだときに組んだ答え → 無ければ、同じ決まりを「試す」で数えた答え（保存した直後のカード）
    got = next((g for g in (last.get(s["key"]), last.get(f"try-{s['key']}")) if g and g.get("items") == s["joins"]), None)
    if got is None:
        return None
    return [{k: x.get(k) for k in ("hit", "rows", "miss")} for x in got.get("stats") or []]


@bp.get("/api/sources")
def sources_list():
    """データ元の並び（決まった元 → 足した元）と、書けるか・共有か。"""
    st = current_app.config["MASTER_STORE"]
    repo = master_repo()
    changed = {str(r.get("項目") or "") for r in repo.path_settings() if str(r.get("値") or "").strip()}
    shown = sum(1 for r in repo.work_logs() if str(r.get("表示") or "有") != "無")
    items = []
    for s in _all():
        x = _public(s)
        if s["key"] == "lot":         # 品質データの場所・表を参照先で変えてあるか（「既定に戻す」を出す）
            x["placeChanged"] = bool({"lot_list.source", "lot_list.table"} & changed)
        if s["kind"] == "folder":     # 作業実績: 表示する設備の台数（状態に出す）
            x["equipCount"] = shown
        items.append(x)
    return jsonify(items=items, roles=data_sources.ROLES, equipModes=data_sources.EQUIP_MODES,
                   canEdit=can_write(data_sources.NAME), shared=st.is_shared(data_sources.NAME), revision=st.revision(data_sources.NAME))


@bp.post("/api/sources/check")
def sources_check():
    """「確かめる」: その場所（.sqlite3）に届き、表とロット番号の列があるか。設備の列を書いたら、その列があるか・値の例。"""
    body = request.get_json(silent=True) or {}
    place = str(body.get("place") or "").strip()
    out = path_settings.check(path_settings.BY_KEY["lot_list.source"], place)
    det = out.get("detail") or {}
    if str(body.get("role") or "") != "品質" and det.get("table") and not det.get("lotColumn"):
        # ロット番号の列が要るのは品質データだけ（マスタ・仕掛などは無くてよい。結合の鍵は列を自由に選ぶ。版 3.53.0）
        out["message"] = out["message"].replace(" ロット番号の列が見つかりません（ロット番号・ﾛｯﾄ番号・ロット№・LTNO）。", "")
        out["ok"] = True
    col = str(body.get("equipColumn") or "").strip()
    if out.get("ok") and col:
        from ..services.sqlite_ro import connect_ro, qi
        try:
            with connect_ro(Path(place), timeout=5) as c:
                t = lot_list.pick_table(lot_list.tables(c), str(body.get("table") or ""), data_sources.TABLE_CANDIDATES)
                cols = lot_list.columns(c, t) if t else []
                if col not in cols:
                    out.update(ok=False, message=out["message"] + f" 設備の列「{col}」が表「{t}」にありません。")
                else:
                    vals = [r[0] for r in c.execute(f"SELECT DISTINCT {qi(col)} FROM {qi(t)} WHERE {qi(col)} IS NOT NULL LIMIT 4")]
                    out["message"] += f" 設備の列「{col}」の値の例: {'・'.join(str(v) for v in vals) or '（空）'}。"
        except Exception as e:      # 開けないことは上の確かめが言う
            out.update(ok=False, message=f"{out['message']} 設備の列を確かめられません（{e}）。")
    return jsonify(out)


@bp.post("/api/sources")
def sources_add():
    """データ元を足す（1 ファイルの元。キーはここで決める）。"""
    body = request.get_json(silent=True) or {}

    def run():
        try:
            row = data_sources.clean_row(body, key=data_sources.new_key(), known=data_sources.join_targets(_all()))
        except ValueError as e:
            raise SourceInvalid(str(e)) from None
        return {"row": master_repo().data_source_put(row["キー"], row, 0)}
    return master_call(run, 201)


@bp.put("/api/sources/<key>")
def sources_put(key):
    """データ元を直す（決まった元の仕掛も同じ。品質データ・作業実績の場所は参照先 /api/settings で直す）。base_rev は行の版（無ければ 0）。"""
    body = request.get_json(silent=True) or {}

    def run():
        items = _all()
        if key not in {s["key"] for s in items}:
            raise SourceInvalid("そのデータ元はありません（ほかの PC が消した可能性があります）。")
        try:
            row = data_sources.clean_row(body, key=key, known=data_sources.join_targets(items))
        except ValueError as e:
            raise SourceInvalid(str(e)) from None
        return {"row": master_repo().data_source_put(key, row, base_rev())}
    return master_call(run)


@bp.delete("/api/sources/<key>")
def sources_delete(key):
    """足した元を消す（決まった元なら、変えた所を消して既定へ戻す）。画面の表示ルールは残す（同じキーはもう使わない）。"""
    def run():
        master_repo().data_source_delete(key, base_rev())
        return {"ok": True}
    return master_call(run)


# ---------------------------------------------------------------- 1 ファイルの元の一覧
def src_plan(key, need_copy=True, joined=True):
    """一覧を読む前の段取り → (段取り, 失敗の答え)。どちらか一方が None。
    結合した表（版 3.54.0。行に「元」がある）は、元の写しに自分の結合を当てた答えを読む（自分の写しは持たない）。"""
    s = next((x for x in _all() if x["key"] == key), None)
    if s is None or not s["api"].startswith("/api/src/"):
        return None, error("そのデータ元はありません。「マスタ管理」の「データ元」で確かめてください。", 404, "unknown")
    if s["kind"] == "cm3":                  # スケジュール（版 3.57.0）: 設備ごとに CM3 から取った表（routes/schedule.py）
        from .schedule import schedule_plan
        return schedule_plan(s, joined=joined)
    if s["kind"] == "view":
        if s.get("broken"):
            return None, error(f"「{s['name']}」の元のデータ元がありません。「マスタ管理」の「データ元」で元を選び直してください。", 400, "unset")
        plan, fail = raw_plan(s["base"])
        if fail:
            return None, fail
        plan = {**plan, "page_size": s["read"]["page_size"], "def": s, "candKey": s["base"]}
        return with_joins(plan, s) if joined else (plan, None)
    if not s["place"]:
        return None, error(f"「{s['name']}」の場所が決まっていません。「マスタ管理」の「データ元」で入れてください。", 400, "unset")
    m = _mirrors().get(key, s["place"], s["read"]["refresh_seconds"], s["read"]["stale_hours"])
    path = m.read_path()
    if path is None and need_copy:  # 写しがまだ無い（共有は直接読まない）。画面は写し終えたら引き直す
        return None, error(m.not_ready_text(), 503, "copying", source=m.source_info())
    plan = {"mirror": m, "path": str(path), "table": s["table"], "page_size": s["read"]["page_size"],
            "source": m.source_info(), "def": s}
    return with_joins(plan, s) if joined and path is not None else (plan, None)


@bp.get("/api/src/<key>")
def src_list(key):
    plan, fail = src_plan(key)
    if fail:
        return fail
    a = request.args
    try:
        out = lot_list.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"],
                             page=a.get("page", 1), page_size=a.get("page_size", plan["page_size"]),
                             search=a.get("search", ""), filters=a.get("filters", ""), sorts=a.get("sorts", ""), marks=a.get("marks", ""), calc=a.get("calc", ""),
                             group=a.get("group") == "1", table_candidates=_candidates(plan.get("candKey", key)))
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    out["source"] = plan["source"]
    if plan["def"]["kind"] == "cm3":
        from .schedule import schedule_extra
        out["schedule"] = schedule_extra(plan)
    return jsonify(out)


@bp.get("/api/src/<key>/slicer")
def src_slicer(key):
    plan, fail = src_plan(key)
    if fail:
        return fail
    try:
        out = lot_list.slicer_answer(plan["path"], request.args, preferred_table=plan["table"], table_candidates=_candidates(plan.get("candKey", key)))
    except ValueError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/src/<key>/pivot")
def src_pivot(key):
    plan, fail = src_plan(key)
    if fail:
        return fail
    a = request.args
    try:
        if a.get("fields") == "1":
            return jsonify(pivot.fields(plan["path"], table=a.get("table", ""), preferred_table=plan["table"], table_candidates=_candidates(plan.get("candKey", key))))
        out = pivot.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"], search=a.get("search", ""),
                          filters=a.get("filters", ""), rows=a.get("rows", ""), cols=a.get("cols", ""), measures=a.get("measures", ""),
                          month=a.get("month", ""), box=a.get("box", ""), table_candidates=_candidates(plan.get("candKey", key)))
    except pivot.PivotError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/src/<key>/source")
def src_source(key):
    """いま読んでいるデータはいつのものか（共有は見に行かない）。まだ開いていない元は 404。"""
    if (source_def(key) or {}).get("kind") == "cm3":     # スケジュール: CM3 の更新の時刻。古くなった設備は裏で取り直す
        from .schedule import schedule_source
        return schedule_source()
    m = _mirror_of(key)
    if m is None:
        return error("まだ開いていないデータ元です。", 404, "unknown")
    return jsonify(m.source_info())


def _mirror_of(key):
    """そのデータ元の写しの係（結合した表は元の物。品質データは品質データの写し）。まだ開いていなければ None。"""
    s = source_def(key)
    k = (s or {}).get("base") or key
    return current_app.config.get("LOT_MIRROR") if k == "lot" else _mirrors().peek(k)


@bp.post("/api/src/<key>/refresh")
def src_refresh(key):
    """「再読込」: 共有に新しい版があるかを今すぐ確かめ、あれば取り込む（変わっていなければ写さない）。"""
    s = source_def(key)
    if (s or {}).get("kind") == "cm3":                   # スケジュール: 今すぐ CM3 から取り直す（「更新」）
        from .schedule import schedule_plan
        plan, fail = schedule_plan(s, joined=False, force=True)
        if fail:
            return fail
        return jsonify(result={"copied": True}, source=plan["source"])
    plan, fail = src_plan(key, need_copy=False, joined=False)
    if fail:
        return fail
    m = plan.get("mirror") or _mirror_of(key)
    if m is None:
        return error("まだ開いていないデータ元です。", 404, "unknown")
    return jsonify(result=m.refresh(), source=m.source_info())


# ---------------------------------------------------------------- 結合（services/data_join.py。版 3.53.0）
def _joiner():
    j = current_app.config.get("JOINER")
    if j is None:
        j = current_app.config["JOINER"] = data_join.Joiner(app_env.local_root() / "db_cache" / "joins")
    return j


def _candidates(key):
    return lot_list.TABLE_CANDIDATES if key == "lot" else work_log.TABLE_CANDIDATES if key == "work" else data_sources.TABLE_CANDIDATES


def actual_table(path, preferred, key):
    """写しの中で実際に読む表の名前（設定の表 → 候補 → 最初の表）。"""
    from ..services.sqlite_ro import connect_ro
    with connect_ro(Path(path), timeout=5) as c:
        return lot_list.pick_table(lot_list.tables(c), preferred or "", _candidates(key))


def raw_plan(key):
    """結合しない元のままの段取り（結合の相手・列の手がかりに使う）→ (段取り, 失敗の答え)。"""
    if key == "lot":
        from .lotlist import lotlist_plan
        return lotlist_plan(joined=False)
    if key == "work":
        rows = [r for r in master_repo().work_logs() if str(r.get("表示") or "有") != "無"]
        if not rows:
            return None, error("作業実績の設備がありません。", 404, "unknown")
        from .worklog import worklog_plan
        return worklog_plan(key=rows[0].get("キー"), rows=rows, joined=False)
    s = source_def(key)
    if s and s["kind"] == "view":           # 結合した表: 結合の欄の「この元」は元の表（列の手がかり・試す）
        return raw_plan(s["base"]) if not s.get("broken") else (None, error("結合した表の元がありません。", 400, "unset"))
    return src_plan(key, joined=False)


def _rights(joins, items):
    """結合ごとの相手の (写し, 表, 名前)。相手の写しがまだ無ければ失敗の答え（写し始めてある。画面は写し終えたら引き直す）。"""
    out = []
    for j in joins:
        d = next((x for x in items if x["key"] == j["with"]), None)
        if d is None or d["kind"] != "file":
            return None, error(f"結合の相手（{j['with']}）がありません。「マスタ管理」の「データ元」で結合を直してください。", 400, "invalid")
        plan, fail = raw_plan(d["key"])
        if fail:
            return None, fail
        out.append((plan["path"], actual_table(plan["path"], plan["table"], d["key"]), d["name"]))
    return out, None


def with_joins(plan, s, scope=None, joins=None):
    """段取り plan の読むファイルを、データ元 s の結合を当てた答えのファイルに替える（結合が無ければそのまま）。→ (段取り, 失敗の答え)。
    scope: 答えのファイルの名前の頭（作業実績は設備ごと）。joins: 決まりを替えて試す（「試す」の数）。"""
    joins = s.get("joins") if joins is None else joins
    if not joins:
        return plan, None
    rights, fail = _rights(joins, _all())
    if fail:
        return None, fail
    table = actual_table(plan["path"], plan["table"], plan.get("candKey") or s.get("base") or s["key"])
    try:
        path, stats = _joiner().path_for(scope or s["key"], plan["path"], table, joins, rights)
    except (data_join.JoinError, Exception) as e:      # 決まりが表に合わない（列を消した など）: 理由を言う
        return None, error(f"「{s['name']}」の結合を組めませんでした: {e}", 400 if isinstance(e, data_join.JoinError) else 503, "join")
    return {**plan, "path": str(path), "table": table, "joined": stats}, None


def source_def(key):
    return next((x for x in _all() if x["key"] == key), None)


@bp.get("/api/sources/<key>/columns")
def sources_columns(key):
    """結合の欄の手がかり: その元の表の列（結合しない元のまま）と、値の見本（列ごとに 3 つまで）。写しがまだ無ければ 503 copying。"""
    s = source_def(key)
    if s is None:
        return error("そのデータ元はありません。", 404, "unknown")
    plan, fail = raw_plan(key)
    if fail:
        return fail
    from ..services.sqlite_ro import connect_ro, qi
    try:
        with connect_ro(Path(plan["path"]), timeout=5) as c:
            t = lot_list.pick_table(lot_list.tables(c), plan["table"] or "", _candidates(key))
            cols = lot_list.columns(c, t)
            rows = c.execute(f"SELECT * FROM {qi(t)} LIMIT 200").fetchall()
            n = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}").fetchone()[0])
    except Exception as e:
        return error(str(e), 503)
    samples = {}
    for i, col in enumerate(cols):
        vals = list(dict.fromkeys(str(r[i]).strip() for r in rows if i < len(r) and r[i] not in (None, "") and str(r[i]).strip()))
        samples[col] = vals[:3]
    return jsonify(key=key, name=s["name"], table=t, columns=cols, samples=samples, rows=n)


@bp.post("/api/sources/join/preview")
def sources_join_preview():
    """「試す」: 決まり（joins）をその元に当てたときの数（当たった・当たらない・相手だけ・相手の鍵の重なり）と、当たらない鍵の見本。
    答えのファイルは本物と同じ係で組む（保存しなくても、同じ決まりを保存したら組み直さずに使える）。"""
    body = request.get_json(silent=True) or {}
    key, base = str(body.get("key") or ""), str(body.get("base") or "")
    items = _all()
    if base and not key:                    # 足す前の結合した表（版 3.54.0）: 元の表に当てて数える
        if base not in data_sources.join_targets(items):
            return error("結合した表の元にするデータ元を選んでください。", 400, "invalid")
        s = {"key": "", "name": "結合した表", "base": base, "kind": "view", "joins": []}
    else:
        s = source_def(key)
        if s is None:
            return error("そのデータ元はありません。", 404, "unknown")
    known = {k: v for k, v in data_sources.join_targets(items).items() if k != (s.get("base") or "")}
    try:
        joins = data_join.parse(data_join.clean(body.get("joins"), key, known))
    except data_join.JoinError as e:
        return error(str(e), 400, "invalid")
    if not joins:
        return jsonify(stats=[], rows=None)
    plan, fail = raw_plan(base or key)
    if fail:
        return fail
    scope = (key or f"new-{base}") if key != "work" else f"work-{plan.get('equip', {}).get('key', '')}"
    out, fail = with_joins(plan, s, scope=f"try-{scope}", joins=joins)
    if fail:
        return fail
    return jsonify(stats=out["joined"], table=out["table"], equip=plan.get("equip"))


@bp.post("/api/sources/<key>/quick")
def sources_patch(key):
    """一覧からその場で変える（版 3.54.0。POST /api/sources/<キー>/quick）: 見出しのタブに出すか（画面）・グループ・表示名だけ。ほかの列はそのまま。
    行が無い決まった元（仕掛など）は、いま効いている値で行を作る。base_rev は行の版（無ければ 0）。"""
    body = request.get_json(silent=True) or {}

    def run():
        items = _all()
        it = next((x for x in items if x["key"] == key), None)
        if it is None:
            raise SourceInvalid("そのデータ元はありません（ほかの PC が消した可能性があります）。")
        row = {**data_sources.row_of(it), **{k: body[k] for k in data_sources.PATCH_FIELDS if k in body}}
        try:
            row = data_sources.clean_row(row, key=key, known=data_sources.join_targets(items))
        except ValueError as e:
            raise SourceInvalid(str(e)) from None
        return {"row": master_repo().data_source_put(key, row, base_rev())}
    return master_call(run)


@bp.post("/api/sources/order")
def sources_order():
    """並べ替え（版 3.54.0）: keys の順に「並び」を振る（品質データ・作業実績は先頭に決まっているので、並べるのはほかの元）。
    行が無い決まった元（仕掛）は、いま効いている値で行を作る。グループの中の順・グループどうしの順・見出しのタブの順がこの並びになる。"""
    body = request.get_json(silent=True) or {}
    keys = [str(k) for k in body.get("keys") or [] if str(k) not in ("lot", "work")]

    def run():
        items = {x["key"]: x for x in _all()}
        if any(k not in items for k in keys) or len(set(keys)) != len(keys):
            raise SourceInvalid("並べ替えるデータ元が、いまの並びと合いません。読み直してから並べてください。")
        rows = {k: {**data_sources.row_of(items[k]), "並び": str((i + 1) * 10)} for i, k in enumerate(keys)}
        master_repo().data_source_order(rows)
        return {"ok": True}
    return master_call(run)
