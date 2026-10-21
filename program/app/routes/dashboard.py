"""ダッシュボード（services/dashboard.py）: ダッシュボードの組み（グリッドのパネル。共通デフォルト・共通・ID・標準）と、
パネルの数（どのデータ元でも同じ集計 pivot.query_many）。版 3.38.0 から「設備ごとの仕掛と前日の実績」も汎用の合わせた表（visual board）。"""
import json
import os
import re
import threading
from collections import OrderedDict
from datetime import date, datetime

from ..web import current_app, jsonify, request

from .. import effective_settings
from ..services import aggregate, dashboard, data_sources, db_mirror, equip_groups, operation, pivot, shifts, work_log
from ..services.identity import normalize_part
from .common import base_rev, bp, error, find_row, master_call, master_repo
from .lotlist import lotlist_plan
from .presets import _gate, _who
from .sources import src_plan
from .worklog import start_mirrors, worklog_plan


def _fail(fail):
    """段取りの失敗の答え（(Response, 状態)）→ {error, kind, status}（パネルの中に理由を出す）"""
    resp, status = fail
    d = json.loads(resp.get_data(as_text=True) or "{}")
    return {"error": d.get("error") or "読めませんでした。", "kind": d.get("kind") or "error", "status": status}


def _equipment_names(repo, wl_rows):
    """設備の名前（作業実績の設備 → 設備マスタ）。データ元の設備の列の値を、この名前で見分ける。並びは合わせた表の「設備の並び」"""
    names = [str(r.get("設備名") or "") for r in work_log.ordered(wl_rows)] + [str(r.get("設備名") or "") for r in repo.equipment()]
    return list(dict.fromkeys(n for n in names if n.strip()))


def equipment_seen():
    """実際に出てくる設備（版 3.40.0。設備グループのマスタで選ぶ設備）→ [{name, from: [どこで見たか], n: 件数（データ元の行の数）}]。
    作業実績の設備（表示しない設備も）→ 設備マスタ → データ元の設備の列の値から見分けた設備（ダッシュボードの「設備」と同じ見分け方）の順。
    利用者の要望（2026-10）: 設備グループの設備が作業実績の設備だけで、仕掛などに出てくる設備（パネルの行に出る設備）を選べなかった"""
    repo = master_repo()
    out = {}

    def add(name, where, n=0):
        name = str(name or "").strip()
        if not name:
            return
        k = normalize_part(name)
        x = out.setdefault(k, {"name": name, "from": [], "n": 0})
        if where not in x["from"]:
            x["from"].append(where)
        x["n"] += n or 0
    for r in work_log.ordered(repo.work_logs()):
        add(r.get("設備名"), "作業実績")
    for r in repo.equipment():
        add(r.get("設備名"), "設備マスタ")
    settings, now = effective_settings(current_app), _now()
    for d in data_sources.sources(settings, repo.data_source_rows()):
        if not d.get("equipColumn") or not d.get("place"):
            continue
        key = "lot" if d["key"] == "lot" else f"src:{d['key']}"
        p = dashboard.clean_panel({"visual": "none", "source": key, "body": {"rows": [EQUIP_DIM], "measures": [{"agg": "count"}]}}, 0, dashboard.ROWS_MAX)
        a = _answer(p, now)
        if "cells" not in a:
            continue
        n = {c["r"][0]: c["v"][0] for c in a["cells"] if len(c["r"]) == 1}
        for k in a["orders"][0]:
            if k:
                add(a["labels"][0].get(k, k), d["name"], n.get(k))
    return list(out.values())


# ================================================================== ダッシュボードの組み（版 3.37.0）
SCOPE_ORDER = {"me": 0, "all": 1, "default": 2}


@bp.get("/api/dashboards")
def dashboards_list():
    """ダッシュボードの並び（自分の ID → 共通 → 共通デフォルト〈置いた物 → 組み込み〉）。standardId はいま開く標準
    （ID → 共通 → 共通デフォルトの標準。無ければ組み込みの「標準」）。"""
    login, common_ok, default_ok, _ = _who(dashboard.LAYOUT_NAME)
    every = master_repo().dashboards()
    rows = [r for r in every if pp_visible(r, login)]
    std = dashboard.pivot_presets.standard_for(rows, dashboard.LAYOUT_SOURCE, login)
    items = sorted((dashboard.layout_view(dashboard.with_builtin_replace(r), login, common_ok, default_ok) for r in rows),
                   key=lambda x: (SCOPE_ORDER[x["scope"]], x["name"]))
    # 組み込みは、外した物・入れ替えた物を出さない（版 3.48.0）。入れ替えた物は replaces（"b:鍵"。セットのタブ・覚えた id がそれを開く）
    off, swapped = dashboard.builtin_skip(every, login)
    items += dashboard.builtin_layouts(skip=set(off) | swapped)
    for x in items:
        if x["body"].get("replaces"):
            x["replaces"] = f"b:{x['body']['replaces']}"
    names = {b["key"]: b["name"] for b in dashboard.BUILTIN_LAYOUTS}
    legacy = master_repo().dashboard_rows()       # 版 3.36.0 の 1 枚の表の条件（前の版で保存した 1 枚の表へ引き継ぐ）
    for x in items:
        dashboard.with_legacy_conditions(x["body"], legacy)
    return jsonify(items=items, login=login, canEditCommon=common_ok, canEditDefault=default_ok,
                   standardId=std.get("id") if std else (items[-1]["id"] if items else None), cols=dashboard.GRID_COLS,
                   rowsRange=[dashboard.ROWS_MIN, dashboard.ROWS_MAX],
                   hidden=[{"id": f"b:{k}", "name": names.get(k, k), "scope": sc} for k, sc in off.items()])


@bp.put("/api/dashboards-hidden")
def dashboards_hidden():
    """組み込みのダッシュボードを外す・戻す（版 3.48.0）。{scope: default（開発者。全員の一覧から）| me（自分の一覧から）, keys: [外す組み込みの鍵]}。
    keys が空なら、その置き場の「外した組み込み」の行を消す（全部戻す）"""
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)
    d = request.get_json(force=True) or {}

    def go():
        scope = d.get("scope") if d.get("scope") in ("default", "me") else ""
        if not scope:
            raise dashboard.LayoutError("置き場（default か me）が違います。")
        want = {"元": dashboard.HIDE_SOURCE, "範囲": dashboard.pivot_presets.SCOPES[scope], "ログインID": login if scope == "me" else ""}
        _gate(want, login, common_ok, default_ok, revoked, "組み込みのダッシュボード")
        repo = master_repo()
        old = next((r for r in repo.dashboards() if dashboard.pivot_presets.group_of(r) == dashboard.pivot_presets.group_of(want)), None)
        keys = dashboard.clean_hide_body({"keys": d.get("keys") or []})[0]["keys"]
        if not keys:
            if old:
                repo.dashboard_delete(old["id"])
            return {"ok": True, "keys": []}
        row = dashboard.clean_hide_row({"name": dashboard.HIDE_NAME, "scope": scope, "body": {"keys": keys}}, login)
        if old:
            repo.dashboard_update(old["id"], {"中身": row["中身"]})
        else:
            repo.dashboard_create(row)
        return {"ok": True, "keys": keys}
    return master_call(go)


def pp_visible(row, login):
    return row.get("元") == dashboard.LAYOUT_SOURCE and dashboard.pivot_presets.visible(row, login)


@bp.post("/api/dashboards")
def dashboards_create():
    """{name, scope: default|all|me, standard, body: {rows, panels}, note} を新しいダッシュボードとして置く。"""
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)

    def go():
        row = dashboard.with_builtin_replace(dashboard.clean_layout_row(request.get_json(force=True) or {}, login))
        _gate(row, login, common_ok, default_ok, revoked, "ダッシュボード")
        return dashboard.layout_view(master_repo().dashboard_create(row), login, common_ok, default_ok)
    return master_call(go, 201)


@bp.put("/api/dashboards/<int:item_id>")
def dashboards_update(item_id):
    """名前・中身（上書き）・標準・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）。"""
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)
    base = base_rev()

    def go():
        old = find_row(master_repo().dashboards(), item_id)
        if old is None or old.get("元") != dashboard.LAYOUT_SOURCE:       # セット（元 dashset）はセットの道で直す
            raise dashboard.LayoutError(f"id={item_id} が見つかりません（ほかの PC が消した可能性があります）。")
        _gate(old, login, common_ok, default_ok, revoked, "ダッシュボード")
        data = dashboard.with_builtin_replace(dashboard.clean_layout_row(request.get_json(force=True) or {}, login, partial=True), old)
        row = master_repo().dashboard_update(item_id, data, base)
        return dashboard.layout_view(row, login, common_ok, default_ok)
    return master_call(go)


@bp.delete("/api/dashboards/<int:item_id>")
def dashboards_delete(item_id):
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)
    base = base_rev()

    def go():
        old = find_row(master_repo().dashboards(), item_id)
        if old is not None and old.get("元") == dashboard.LAYOUT_SOURCE:
            _gate(old, login, common_ok, default_ok, revoked, "ダッシュボード")
            master_repo().dashboard_delete(item_id, base)
        return {"ok": True}
    return master_call(go)


# ---------------------------------------------------------------- ダッシュボードのセット（版 3.46.0。services/dashboard.py の SET_SOURCE）
def _set_rows(login):
    return [r for r in master_repo().dashboards() if r.get("元") == dashboard.SET_SOURCE and dashboard.pivot_presets.visible(r, login)]


@bp.get("/api/dashboard-sets")
def dashboard_sets_list():
    """セットの並び（自分の ID → 共通 → 共通デフォルト）と、いま開く標準のセット（standardId。無ければ null＝セットを使わない）"""
    login, common_ok, default_ok, _ = _who(dashboard.LAYOUT_NAME)
    rows = _set_rows(login)
    std = dashboard.pivot_presets.standard_for(rows, dashboard.SET_SOURCE, login)
    items = sorted((dashboard.set_view(r, login, common_ok, default_ok) for r in rows), key=lambda x: (SCOPE_ORDER[x["scope"]], x["name"]))
    return jsonify(items=items, standardId=std.get("id") if std else None, login=login, canEditCommon=common_ok, canEditDefault=default_ok,
                   max=dashboard.MAX_SET_ITEMS)


def _old_set(item_id):
    old = find_row(master_repo().dashboards(), item_id)
    if old is None or old.get("元") != dashboard.SET_SOURCE:
        raise dashboard.LayoutError(f"セット id={item_id} が見つかりません（ほかの PC が消した可能性があります）。")
    return old


@bp.post("/api/dashboard-sets")
def dashboard_sets_create():
    """{name, scope: default|all|me, standard, body: {items}, note} を新しいセットとして置く"""
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)

    def go():
        row = dashboard.clean_set_row(request.get_json(force=True) or {}, login)
        _gate(row, login, common_ok, default_ok, revoked, "ダッシュボードのセット")
        return dashboard.set_view(master_repo().dashboard_create(row), login, common_ok, default_ok)
    return master_call(go, 201)


@bp.put("/api/dashboard-sets/<int:item_id>")
def dashboard_sets_update(item_id):
    """名前・中身（ダッシュボードの並び）・標準を直す。base_rev が今の版と違えば 409"""
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)
    base = base_rev()

    def go():
        _gate(_old_set(item_id), login, common_ok, default_ok, revoked, "ダッシュボードのセット")
        row = master_repo().dashboard_update(item_id, dashboard.clean_set_row(request.get_json(force=True) or {}, login, partial=True), base)
        return dashboard.set_view(row, login, common_ok, default_ok)
    return master_call(go)


@bp.delete("/api/dashboard-sets/<int:item_id>")
def dashboard_sets_delete(item_id):
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)
    base = base_rev()

    def go():
        old = find_row(master_repo().dashboards(), item_id)
        if old is not None and old.get("元") == dashboard.SET_SOURCE:
            _gate(old, login, common_ok, default_ok, revoked, "ダッシュボードのセット")
            master_repo().dashboard_delete(item_id, base)
        return {"ok": True}
    return master_call(go)


# ---------------------------------------------------------------- パネルの数（どの元も pivot.query_many の 1 か所で数える）
class _Fail(Exception):
    """段取りの失敗（そのまま返す答え）"""

    def __init__(self, resp):
        super().__init__("fail")
        self.resp = resp


def _now():
    """いまの時刻（この PC の時計）。試験用のサーバー・試験は DASHBOARD_NOW で試験データの日に合わせる"""
    return current_app.config.get("DASHBOARD_NOW") or datetime.now()


def _shown_work(wl_rows):
    return work_log.ordered([r for r in wl_rows if str(r.get("表示") or "有") != "無"])


def _equip_of(src, repo, wl_rows):
    """データ元の設備の列 → 設備の段の決め方（無ければ None）"""
    col = (src or {}).get("equipColumn") or ""
    if not col:
        return None
    return {"column": col, "match": data_sources.EquipmentMatcher(_equipment_names(repo, wl_rows), src.get("equipMode"))}


def panel_parts(source, equip="", basis="work", equips=None):
    """パネルのデータ → (数える Part の並び, 読めなかった設備 [{name, error, kind}], 元の名前, 写しの様子の並び)。
    1 つも読めなければ _Fail（写し中が 1 つでもあれば、その答え＝画面は待って引き直す）"""
    settings = effective_settings(current_app)
    repo = master_repo()
    wl_rows = repo.work_logs()
    defs = data_sources.sources(settings, repo.data_source_rows())
    if source == "work":
        pick = {normalize_part(x) for x in equips or []}
        rows = [r for r in _shown_work(wl_rows) if (not equip or r.get("キー") == equip) and (not pick or normalize_part(r.get("設備名")) in pick)]
        if not rows:
            raise _Fail(error("数える設備がありません（「マスタ管理」の「作業実績」で表示する設備を決めてください）。", 404, "unknown"))
        pats = repo.shift_patterns()
        parts, failed, mirrors, first = [], [], [], None
        start_mirrors(rows, db_mirror.FIRST_WAIT_SEC)        # 全部の設備の写しを一度に始めて、まとめて待つ（1 台ずつ順に待たない。版 3.46.0）
        for row in rows:
            name = str(row.get("設備名") or "")
            plan, fail = worklog_plan(key=row.get("キー"), rows=wl_rows, wait=False)
            if fail:
                f = _fail(fail)
                failed.append({"name": name, **f})
                first = first if first and first[1] == "copying" else (fail, f["kind"])
                continue
            pat = shifts.pattern_for(pats, name)
            work = {"clock": shifts.Clock(pat["segments"] if pat else []), "basis": basis, "start": ""}
            parts.append(pivot.Part(plan["path"], preferred_table=plan["table"], table_candidates=work_log.TABLE_CANDIDATES, work=work,
                                    equip={"name": name}, name=name))
            mirrors.append(plan["source"])
        if not parts:
            raise _Fail(first[0])
        return parts, failed, next((d["name"] for d in defs if d["key"] == "work"), "作業実績"), mirrors
    if source == "lot":
        plan, fail = lotlist_plan()
        if fail:
            raise _Fail(fail)
        d = next((x for x in defs if x["key"] == "lot"), {})
        return [pivot.Part(plan["path"], preferred_table=plan["table"], equip=_equip_of(d, repo, wl_rows), name=d.get("name", ""))], [], \
            d.get("name", "品質データ"), [plan["source"]]
    key = source[4:] if source.startswith("src:") else ""
    plan, fail = src_plan(key)
    if fail:
        raise _Fail(fail)
    d = plan["def"]
    return [pivot.Part(plan["path"], preferred_table=plan["table"], table_candidates=data_sources.TABLE_CANDIDATES,
                       equip=_equip_of(d, repo, wl_rows), name=d["name"])], [], d["name"], [plan["source"]]


def _cache():
    c = current_app.config.get("DASH_CACHE")
    if c is None:
        c = current_app.config["DASH_CACHE"] = OrderedDict()
    return c


def _file_sig(path):
    try:
        st = os.stat(path)
        return [str(path), st.st_mtime_ns, st.st_size]
    except OSError:
        return [str(path), 0, 0]


BOX_VISUALS = ("box", "violin", "xbar")


def _box_column(p):
    """行ごとの分かれ方（四分位・密度）が要る形（箱ひげ・バイオリン・X̄-R 管理図）は、1 つ目の数の値の列で数える（版 3.39.0）"""
    if p.get("visual") not in BOX_VISUALS:
        return ""
    return next((m.get("column") for m in p["body"]["measures"] if m.get("column") and m.get("agg") != "distinct"), "")


def _answer(p, now):
    """1 つの組み（パネルか、合わせた表の列のまとまり）の数 → 答え（集計表と同じ形に、元の名前・写しの様子・読めなかった設備）。
    数えられなければ {error, kind, status}。同じ組み・同じ写し・同じ「今日」なら前の答え（パネルは 1 分ごとに引き直すため）"""
    try:
        parts, failed, name, mirrors = panel_parts(p["source"], p["equip"], p["basis"], p.get("equips"))
    except _Fail as f:
        return _fail(f.resp)
    egroups = dashboard.resolve_egroup(p.get("egroup"), p.get("equips"),
                                       lambda name: equip_groups.groups_for(master_repo().equip_groups(), name))
    sets = _group_sets(p)
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    days = [x.work["clock"].place(stamp, x.work["basis"])[0] if x.work else "" for x in parts]
    key = json.dumps([p, egroups, sets, [_file_sig(x.path) for x in parts], days, now.date().isoformat(), [f["name"] for f in failed]], ensure_ascii=False, sort_keys=True)
    cache = _cache()
    hit = cache.get(key)
    if hit is None:
        with _COUNT_LOCK:             # 重い集計は 1 つずつ（待っている間に同じ組みを数え終えていれば、その答え）
            hit = cache.get(key)
            if hit is None:
                hit = _count(p, parts, now, egroups, sets)
                if "error" in hit:
                    return hit
                cache[key] = hit
                while len(cache) > 96:
                    cache.popitem(last=False)
    else:
        cache.move_to_end(key)
    note = "設備のまとめのマスタ「" + p["egroup"]["set"] + "」にグループがありません（マスタ管理の「設備グループ」）。" \
        if p.get("egroup") and p["egroup"]["mode"] == "master" and not egroups else ""
    return {**with_eorder(hit, p), "sourceName": name, "mirrors": mirrors, "failed": failed, "now": stamp, **({"note": " ".join(x for x in (hit.get("note"), note) if x)} if note else {})}


# 画面は全部のパネルを一度に問い合わせる。重い集計（Python の 1 行ずつの数え）を同時に走らせると取り合って、順に数えるより
# 4 倍ほど遅かった（版 3.43.0 の tools/dash-bench.py: 6 枚で順に 4.8 秒・一度に 21.7 秒）。数えるのは 1 つずつにする
_COUNT_LOCK = threading.Lock()


def _count(p, parts, now, egroups, sets):
    """数える（pivot.query_many）。数えられなければ {error, kind, status}"""
    b = p["body"]
    try:
        return pivot.query_many(parts, search=p["search"], filters=json.dumps(p["filters"], ensure_ascii=False),
                                rows=json.dumps(b["rows"], ensure_ascii=False), cols=json.dumps(b["cols"], ensure_ascii=False),
                                measures=json.dumps(b["measures"], ensure_ascii=False), today=now.date(), period=p["period"], now=now,
                                calc=p.get("calc"), equips=p.get("equips"), egroups=egroups, box=_box_column(p), sets=sets)
    except pivot.PivotError as e:
        return {"error": str(e), "kind": "invalid", "status": 400}
    except Exception as e:
        return {"error": str(e), "kind": "error", "status": 503}


def _group_sets(p):
    """設備グループの段（@egroup）のまとめ方 → グループ（pivot.query_many の sets）。PANEL_SET はこのパネルで決めたグループ"""
    b = p.get("body") or {}
    names = {d.get("part") or "" for d in (b.get("rows") or []) + (b.get("cols") or []) if d.get("column") == pivot.EGROUP_DIM}
    if not names:
        return None
    rows = master_repo().equip_groups()
    out = {}
    for n in names:
        if n == pivot.PANEL_SET or not n:
            eg = p.get("egroup") or {}
            out[n] = [{"name": g["name"], "members": g.get("members") or []} for g in eg.get("groups") or []] if eg.get("mode") == "panel" else []
        else:
            out[n] = equip_groups.groups_for(rows, n)
    return out


def _equip_ok(source):
    """そのデータで設備を見分けられるか（作業実績・設備の列を決めたデータ元）"""
    if source == "work":
        return True
    settings = effective_settings(current_app)
    key = "lot" if source == "lot" else source[4:]
    return any(d["key"] == key and d.get("equipColumn") for d in data_sources.sources(settings, master_repo().data_source_rows()))


EQUIP_DIM = {"column": pivot.EQUIP_DIM, "part": ""}


def _split_answer(p, now):
    """設備の分け方（版 3.40.0。dashboard.split_of）を当てて数える。
    series … 列の段の頭に設備（グラフは設備ごとの系列・表は設備ごとの列）。数字（kpi）と、列の段がいっぱいなら facet
    facet  … 行の段の頭に設備を足して 1 回数え、設備ごとの答え facets: [{key, name, answer}] に分ける（表し方は分けた後に当てる）"""
    sp = dashboard.split_of(p) if _equip_ok(p["source"]) else ""
    b = p["body"]
    if sp == "series" and (p["visual"] == "kpi" or len(b["cols"]) >= pivot.MAX_DIMS):
        sp = "facet"
    if sp == "series":
        a = _answer({**p, "body": {**b, "cols": [EQUIP_DIM] + b["cols"]}}, now)
        return {**a, "esplit": "series"} if "cells" in a else a
    if sp != "facet" or len(b["rows"]) >= pivot.MAX_DIMS:
        a = _answer(p, now)
        # 合算したと知らせるのは、設備を選んだ・合算を選んだときだけ（すべての設備の 1 つの数は今までどおり）
        told = sp == "sum" and (p.get("esplit") or len(p.get("equips") or []) >= 2 or (p.get("egroup") or {}).get("mode") == "sum")
        return {**a, "esplit": sp} if "cells" in a and told else a
    ms = b["measures"]
    a = _answer({**p, "body": {**b, "rows": [EQUIP_DIM] + b["rows"], "measures": [{k: v for k, v in m.items() if k != "show"} for m in ms]}}, now)
    if "cells" not in a:
        return a
    return {**a, "esplit": "facet", "facets": facets_of(a, ms)}


def facets_of(a, measures):
    """行の段の頭が設備の答え → 設備ごとの答え（ほかの形は 1 つの答えと同じ。行の段・鍵の並びは頭を外す）"""

    nr, nc = len(a["dims"]["rows"]) - 1, len(a["dims"]["cols"])
    out = []
    for k in [x for x in a["orders"][0] if x != ""][:dashboard.MAX_FACETS]:
        cells = [{"r": c["r"][1:], "c": c["c"], "v": list(c["v"])} for c in a["cells"] if c["r"][:1] == [k]]
        orders = [[x for x in o if any(len(c["r"]) > i and c["r"][i] == x for c in cells)] for i, o in enumerate(a["orders"][1:nr + 1])] + a["orders"][nr + 1:]
        aggregate.apply_show(cells, measures, nr, nc, orders)
        sub = {**{x: a[x] for x in ("table", "lotsBy", "start", "bins", "stats", "box", "truncated", "months", "month", "shifts") if x in a},
               "dims": {"rows": a["dims"]["rows"][1:], "cols": a["dims"]["cols"]}, "measures": [{**m, "name": aggregate.name(m)} for m in measures],
               "orders": orders, "labels": a["labels"][1:], "cells": cells, "count": None,
               "boxes": [{**x, "r": x["r"][1:]} for x in a.get("boxes") or [] if x["r"][:1] == [k]]}
        out.append({"key": k, "name": a["labels"][0].get(k, k), "answer": sub})
    return out


# ---------------------------------------------------------------- 別のデータを合わせる（版 3.40.0。dashboard.clean_link）
_DAY = re.compile(r"\d{4}(-\d{2}){0,2}")
ROLE_NAME = {"target": "目標", "actual": "実績", "": ""}


def _link_key(k):
    """軸の鍵 → そろえる鍵（字の値の頭の $・数の # を外し、NFKC・大文字に。日・年月・年・設備名はそのまま比べられる）"""
    k = str(k)
    if k[:1] in ("$", "#"):
        k = k[1:]
    return normalize_part(k)


def _link_answer(p, now):
    """合わせるデータを 1 つずつ数え（ふつうのパネルと同じ _answer）、軸の値でそろえて 1 つの答え（集計表と同じ形。値＝データごと）にする。
    積み上げ（cum）は軸の並び（日・年月なら古い順）に足していく。extra: diff（実績−目標）・rate（実績÷目標 %）"""
    link = p["link"]
    answers = [_answer(dashboard.side_query(link, i, p), now) for i in range(len(link["sides"]))]
    if all("cells" not in a for a in answers):
        return answers[0]
    keys, labels, first = {}, {}, []
    for i, a in enumerate(answers):
        if "cells" not in a:
            continue
        for k in a["orders"][0]:
            if k == "":
                continue
            ck = _link_key(k)
            if ck not in keys:
                keys[ck] = {}
                labels[ck] = a["labels"][0].get(k, k)
                first.append(ck)
            keys[ck][i] = next((c["v"][0] for c in a["cells"] if c["r"] == [k] and not c["c"]), None)
    order = sorted(first) if first and all(_DAY.fullmatch(k) for k in first) else first
    sides = link["sides"]
    vals = {k: [keys[k].get(i) for i in range(len(sides))] for k in order}
    grand = []
    for i, x in enumerate(sides):
        a = answers[i]
        if x["build"] == "cum":
            run = 0
            for k in order:
                v = vals[k][i]
                run += v if isinstance(v, (int, float)) else 0
                vals[k][i] = run
            grand.append(run if order else None)
        else:
            grand.append(next((c["v"][0] for c in a.get("cells") or [] if not c["r"] and not c["c"]), None))
    ti = next((i for i, x in enumerate(sides) if x["role"] == "target"), -1)
    ai = next((i for i, x in enumerate(sides) if x["role"] == "actual"), -1)
    extra = [e for e in link.get("extra") or [] if ti >= 0 and ai >= 0]

    def extras(v):
        t, r = v[ti] if ti >= 0 else None, v[ai] if ai >= 0 else None
        ok = isinstance(t, (int, float)) and isinstance(r, (int, float))
        return [(r - t if ok else None) if e == "diff" else (round(r / t * 100, 4) if ok and t else None) for e in extra]
    names = []
    for i, x in enumerate(sides):
        a = answers[i]
        base = x["title"] or f"{a.get('sourceName') or ''}の{aggregate_name(x['measure'], x['source'])}"
        names.append(f"{ROLE_NAME[x['role']]}：{base}" if x["role"] else base)
    ms = [{**x["measure"], "name": names[i] + ("（積み上げ）" if x["build"] == "cum" else ""), "role": x["role"], "side": i} for i, x in enumerate(sides)]
    ms += [{"agg": "sum", "name": "差（実績−目標）" if e == "diff" else "達成率（実績÷目標 %）", "role": e} for e in extra]
    cells = [{"r": [k], "c": [], "v": vals[k] + extras(vals[k])} for k in order] + [{"r": [], "c": [], "v": grand + extras(grand)}]
    key0 = sides[0]["key"]
    ok = [a for a in answers if "cells" in a]
    note = "　".join(f"{names[i]}: {a['error']}" for i, a in enumerate(answers) if "cells" not in a)
    return {"table": "", "count": sum(a.get("count") or 0 for a in ok), "lotsBy": "", "start": "", "bins": [], "stats": {}, "box": "", "boxes": [],
            "dims": {"rows": [{**key0, "name": "・".join(dict.fromkeys(pivot._dim_name(x["key"]) for x in sides))}], "cols": []},
            "measures": ms, "orders": [order], "labels": [labels], "cells": cells, "truncated": {"rows": False, "cols": False},
            "months": [], "month": "", "ignoredFilters": sorted({f for a in ok for f in a.get("ignoredFilters") or []}),
            "equipIgnored": any(a.get("equipIgnored") for a in ok), "note": " ".join(x for x in [note] + [a.get("note") or "" for a in ok] if x),
            "sourceName": "・".join(dict.fromkeys(a.get("sourceName") or "" for a in ok)), "mirrors": [m for a in ok for m in a.get("mirrors") or []],
            "failed": [f for a in ok for f in a.get("failed") or []], "now": now.strftime("%Y-%m-%d %H:%M:%S"),
            "link": {"sides": [{"role": x["role"], "build": x["build"], "name": names[i], "sourceName": answers[i].get("sourceName") or "",
                                "keyName": pivot._dim_name(x["key"]), **({"error": answers[i]["error"]} if "cells" not in answers[i] else {})}
                               for i, x in enumerate(sides)]}}


# ---------------------------------------------------------------- 設備の手で並べた順（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 3）
def order_names(names, eorder):
    """名前の並び → 手で並べた順（eorder にある名前をその順に先へ・無い名前は今の順のまま後ろへ）。eorder が空なら今の順"""
    if not eorder:
        return list(names)
    at = {normalize_part(n): i for i, n in enumerate(eorder)}
    return sorted(names, key=lambda n: (0, at[normalize_part(n)]) if normalize_part(n) in at else (1, 0))


def order_parts(parts, eorder):
    """数える設備のファイル（Part）を手で並べた順に（ガントの行・ABC の設備の札の順）"""
    if not eorder:
        return parts
    names = order_names([x.name for x in parts], eorder)
    return sorted(parts, key=lambda x: names.index(x.name))


def with_eorder(a, p):
    """集計の答えの設備の段（@equip）の鍵の並びを、パネルの手で並べた順に（表・グラフの並び・系列の順・並べる図の順。答えは控えと分けて作る）"""
    eo = p.get("eorder")
    if not eo or "orders" not in a:
        return a
    dims = a["dims"]["rows"] + a["dims"]["cols"]
    orders = [order_names(o, eo) if i < len(dims) and dims[i].get("column") == pivot.EQUIP_DIM else o for i, o in enumerate(a["orders"])]
    return {**a, "orders": orders}


# ---------------------------------------------------------------- 稼働・ABC 分析（版 3.46.0。services/operation.py）
GANTT_PERIOD = {"column": "@workday", "kind": "yesterday", "n": 1}


def _ops_answer(p, now):
    """稼働（gantt）・ABC 分析と換算係数（abc）のパネル → 設備ごとの答え（作業開始と作業終了から）。
    gantt … {kind, equips: [{name, ops, windows, shiftMin, busyMin, outsideMin, rate, byShift, noEnd, count}], range, total}
    abc   … {kind, equips: [{name, items, total, base, conv, lots}], all: 全設備を合わせた答え}。期間が無ければ全期間。
    同じ組み・同じ写し・同じ「今日」なら前の答え（_answer と同じ控え）"""
    try:
        parts, failed, name, mirrors = panel_parts(p["source"], p["equip"], p["basis"], p.get("equips"))
    except _Fail as f:
        return _fail(f.resp)
    o = p.get("ops") or {}
    period = p["period"] or (GANTT_PERIOD if p["visual"] == "gantt" else None)
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    days = [x.work["clock"].place(stamp, x.work["basis"])[0] if x.work else "" for x in parts]
    key = json.dumps(["ops", p, period, [_file_sig(x.path) for x in parts], days, now.date().isoformat(), now.hour if p["visual"] == "gantt" else 0,
                      [f["name"] for f in failed]], ensure_ascii=False, sort_keys=True, default=str)
    cache = _cache()
    hit = cache.get(key)
    if hit is None:
        with _COUNT_LOCK:
            hit = _ops_count(p, parts, o, period, now)
        if "error" in hit:
            return hit
        cache[key] = hit
        while len(cache) > 96:
            cache.popitem(last=False)
    return {**hit, "failed": failed + hit.get("skipped", []), "sourceName": name, "mirrors": mirrors, "now": stamp}


def _ops_count(p, parts, o, period, now):
    if p["visual"] == "abc":
        return _abc_count(p, parts, o, period, now)
    pats = master_repo().shift_patterns()
    cols = [o.get("label") or "", o.get("color") or ""]
    equips, skipped, rng, start_col, end_col = [], [], None, "", ""
    for part in order_parts(parts, p.get("eorder")):
        try:
            r = operation.read_ops(part, search=p["search"], filters=json.dumps(p["filters"], ensure_ascii=False), today=now.date(), calc=p.get("calc"),
                                   period=period, now=now, end=o.get("end", ""), start=o.get("start", ""), cols=[c for c in cols if c], reach=True)
        except Exception as e:      # 読めない設備は飛ばし、理由をガントの行・知らせに出す
            skipped.append({"name": part.name, "error": str(e)})
            # ガントは読めない設備も行に出す（前は行ごと消え、「出ない設備がある」になった。版 3.47.0）
            equips.append({"name": part.name, "error": str(e), "ops": [], "windows": [], "view": None, "rate": None, "shiftMin": 0, "busyMin": 0,
                           "outsideMin": 0, "byShift": [], "noEnd": 0, "why": {}, "count": 0, "carry": 0, "truncated": False, "pattern": ""})
            continue
        start_col, end_col, rng = start_col or r["start"], end_col or r["end"], rng or r["range"]
        if r["range"] and (date.fromisoformat(r["range"][1]) - date.fromisoformat(r["range"][0])).days + 1 > operation.MAX_DAYS:
            return {"error": f"ガントチャートの期間は {operation.MAX_DAYS} 日までです（期間を短くしてください）。", "kind": "invalid", "status": 400}
        pat = shifts.pattern_for(pats, part.name)
        basis = part.work.get("basis", "work")
        wins = operation.shift_windows(pat["segments"], *r["range"], basis) if pat and r["range"] else []
        days = operation.work_days(pat["segments"] if pat else [], *r["range"], basis) if r["range"] else []
        label = o.get("label") or r["lot"] or ""
        g = operation.gantt(part.name, r, wins, label=label, color=o.get("color") or "", days=days)
        equips.append({**g, "pattern": pat["name"] if pat else ""})
    if not any("error" not in e for e in equips):
        return {"error": "数えられる設備がありません。" + "".join(f" {x['name']}: {x['error']}" for x in skipped[:3]), "kind": "invalid", "status": 400}
    sm, bm = sum(e["shiftMin"] for e in equips), sum(e["busyMin"] for e in equips)
    return {**_ops_head(p, period, rng, start_col, end_col, equips, skipped),
            "total": {"shiftMin": round(sm, 2), "busyMin": round(bm, 2), "rate": round(bm / sm, 4) if sm else None,
                      "noPattern": [e["name"] for e in equips if not e["pattern"] and "error" not in e], "noEnd": sum(e["noEnd"] for e in equips)}}


def _ops_head(p, period, rng, start_col, end_col, equips, skipped):
    # 期間はほかのパネルと同じ形（画面の periodText が読む: 名前と日の範囲）
    per = {**period, "name": pivot.PERIODS.get(period["kind"], ""), "ranges": [{"from": rng[0], "to": rng[1]}] if rng else []} if period else None
    return {"kind": p["visual"], "equips": equips, "skipped": skipped, "range": rng, "startColumn": start_col, "endColumn": end_col, "period": per,
            "basis": p["basis"]}


def _abc_pass(p, parts, o, period, now):
    """ABC 分析を 1 つの期間で数える → (設備ごとの答え, 全設備の答え, 読めなかった設備, 日の範囲, 作業開始の列, 作業終了の列) か {error}。
    全設備の作業時間（版 3.48.0。要望 6）: 各設備の積み上げ（作業 1 本ずつ）か、ロットごとのリードタイム（全設備の作業開始の MIN〜作業終了の MAX）。
    リードタイムは期間の前後も読み（版 3.49.0）、最後の工程が期間に入るロット（その期間にできあがったロット）を数える"""
    qty = o.get("qty") or "lots"
    cls = operation.cls_list(o.get("cls"))
    cols = [*cls, qty if qty not in operation.QTYS else ""]
    lead = o.get("span") == "lead"
    args = (cls, qty, o.get("base") or "avg", (o.get("a", dashboard.ABC_A), o.get("b", dashboard.ABC_B)))
    equips, skipped, every, reads, rng, start_col, end_col = [], [], [], [], None, "", ""
    for part in order_parts(parts, p.get("eorder")):
        try:
            r = operation.read_ops(part, search=p["search"], filters=json.dumps(p["filters"], ensure_ascii=False), today=now.date(), calc=p.get("calc"),
                                   period=period, now=now, end=o.get("end", ""), start=o.get("start", ""), cols=[c for c in cols if c],
                                   lots=lead, around=operation.LEAD_AROUND_DAYS if lead and period else 0)
        except Exception as e:      # 読めない設備は飛ばし、理由を知らせに出す
            skipped.append({"name": part.name, "error": str(e)})
            continue
        start_col, end_col, rng = start_col or r["start"], end_col or r["end"], rng or r["range"]
        mine = [x for x in r["ops"] if not x.get("carry") and not x.get("after")]     # 設備ごとの答えは、期間の中の作業だけ
        equips.append({"name": part.name, **operation.abc(mine, *args)})
        every += mine
        reads.append(r)
    if not equips:
        return {"error": "数えられる設備がありません。" + "".join(f" {x['name']}: {x['error']}" for x in skipped[:3]), "kind": "invalid", "status": 400}
    if lead and not any(r["lot"] for r in reads):
        return {"error": "ロット番号の列が無いので、リードタイム（同じロットの最初の作業開始〜最後の作業終了）を出せません。", "kind": "invalid", "status": 400}
    return equips, operation.abc(operation.lead_ops(reads) if lead else every, *args), skipped, rng, start_col, end_col


def _abc_count(p, parts, o, period, now):
    """ABC 分析と換算係数。基準の期間（ops.refPeriod。地点 A。版 3.49.0）があれば、その期間の換算係数で、いまの期間（地点 B）の本数を換算する"""
    got = _abc_pass(p, parts, o, period, now)
    if isinstance(got, dict):
        return got
    equips, every, skipped, rng, start_col, end_col = got
    ref = o.get("refPeriod")
    if ref:
        a = _abc_pass(p, parts, o, ref, now)
        if isinstance(a, dict):
            return {**a, "error": "基準の期間（地点 A）: " + a["error"]}
        by = {e["name"]: e for e in a[0]}
        for e in equips:
            operation.apply_ref(e, by.get(e["name"]) or {}, a[3])
        operation.apply_ref(every, a[1], a[3])
    qty, cls = o.get("qty") or "lots", operation.cls_list(o.get("cls"))
    return {**_ops_head(p, period, rng, start_col, end_col, equips, skipped), "all": every, "span": "lead" if o.get("span") == "lead" else "sum",
            "cls": operation.KEY_SEP.join(cls), "clsList": cls, "qty": qty}


def aggregate_name(m, source):
    """値の名前（ロット数は作業実績なら実績本数）"""

    return ("実績本数" if source == "work" else "ロット数") if m.get("agg") == "lots" else aggregate.name(m)


@bp.post("/api/dashboard/query")
def dashboard_query():
    """1 枚のパネルの数（本文 {panel}）。答えは集計表と同じ形（pivot.query）。
    合わせた表（visual board）は {groups: [列のまとまりごとの答え（数えられなければ {error, kind}）], equipOrder: 設備の並び, now}。
    別のデータを合わせたパネル（link。版 3.40.0）は、データごとの値を並べた 1 つの答え（_link_answer）。
    設備の分け方（esplit。版 3.40.0）は _split_answer（並べる facet は答えに facets）"""
    body = request.get_json(silent=True) or {}
    try:
        p = dashboard.clean_panel(body.get("panel") or {}, 0, dashboard.ROWS_MAX)
    except dashboard.LayoutError as e:
        return error(str(e), 400)
    now = _now()
    if p["visual"] == "board":
        repo = master_repo()
        groups = [_answer(dashboard.board_query(p, i), now) for i in range(len(p["groups"]))]
        extra = {}
        if p["order"].get("tree"):     # 行をグループの見出しの下にまとめる（版 3.41.0）: 表に出る行の名前で、グループの入り方を決める
            keys = list(dict.fromkeys(str((a.get("labels") or [{}])[0].get(k, k)) for a in groups if "orders" in a for k in a["orders"][0] if k != ""))
            extra["tree"] = (equip_tree(keys, p["order"]["tree"]) or [{"groups": []}])[0]["groups"]
        return jsonify(groups=groups, equipOrder=_equipment_names(repo, repo.work_logs()), now=now.strftime("%Y-%m-%d %H:%M:%S"), **extra)
    a = _ops_answer(p, now) if p["visual"] in dashboard.OPS_VISUALS else _link_answer(p, now) if p.get("link") else _split_answer(p, now)
    if "status" in a and "cells" not in a:
        return error(a["error"], a["status"], a["kind"])
    return jsonify(a)


@bp.route("/api/dashboard/fields", methods=["GET", "POST"])
def dashboard_fields():
    """パネルを組む所の左のカラムの札（source・equip）: 列ごとの手がかり（種類の数・数・日付）と、特別な段（設備・作業日・直）。
    作業実績のすべての設備は、読めた設備の列を合わせる（設備で列が違っても選べる）。
    POST {source, equip, calc}（版 3.38.0）: 計算列（一覧の表示列の設定の式）も同じ手がかりで後ろに並べる（calc: true）"""
    a = (request.get_json(silent=True) or {}) if request.method == "POST" else request.args
    calc = dashboard.clean_calc(a.get("calc")) if request.method == "POST" else None
    try:
        parts, failed, name, _ = panel_parts(a.get("source", ""), a.get("equip", ""), equips=a.get("equips") if isinstance(a.get("equips"), list) else None)
    except _Fail as f:
        return f.resp
    merged, order, table = {}, [], ""
    for x in parts[:12]:
        try:
            d = pivot.fields(x.path, preferred_table=x.preferred_table, table_candidates=x.table_candidates, calc=calc)
        except Exception as e:
            failed.append({"name": x.name, "error": str(e), "kind": "error"})
            continue
        table = table or d["table"]
        for f in d["fields"]:
            m = merged.get(f["column"])
            if m is None:
                merged[f["column"]] = dict(f)
                order.append(f["column"])
            else:
                m.update(kinds=max(m["kinds"], f["kinds"]), many=m["many"] or f["many"], numeric=m["numeric"] and f["numeric"], date=m["date"] or f["date"])
                if m.get("error") and not f.get("error"):
                    m.pop("error")
    special = []
    if all(x.equip for x in parts):
        col = parts[0].equip.get("column")
        special.append({"column": pivot.EQUIP_DIM, "name": "設備", "hint": f"「{col}」の値から見分けた設備" if col else "作業実績の設備（ファイル）ごと"})
        # 設備グループ（版 3.40.0）: 設備の上の段（まとめ方は札で選ぶ。設備と並べて置くと、グループごとの小計）
        sets = [x["name"] for x in equip_groups.sets(master_repo().equip_groups())]
        special.append({"column": pivot.EGROUP_DIM, "name": "設備グループ", "sets": sets,
                        "hint": "設備が入るグループ（マスタ管理の「設備グループ」のまとめ方）" if sets else "まだ設備グループがありません（マスタ管理の「設備グループ」で作ります）"})
    if parts[0].work:
        special += [{"column": "@workday", "name": "作業日", "hint": "作業開始の日（現場歴／太陽暦）", "date": True},
                    {"column": "@shift", "name": "直", "hint": "作業開始の時刻が入る直（マスタ管理の勤務体系）"}]
    return jsonify(fields=[merged[c] for c in order], special=special, table=table, sourceName=name, failed=failed)


@bp.get("/api/data/columns")
def data_columns():
    """データ元ごとの、実際の列の名前と値の見本（版 3.44.0。変換表の「当てる列」を、取り込んでいるデータの列から選ぶ）。
    → {sources: [{key, name, columns: [{column, samples}], error}]}。作業実績は読めた設備の列を合わせる（設備で列が違っても選べる）"""
    out = []
    for src in source_items(master_repo()):
        x = {"key": src["key"], "name": src["name"], "columns": [], "error": ""}
        try:
            parts, failed, _, _ = panel_parts(src["key"])
        except _Fail as f:
            x["error"] = _fail(f.resp)["error"]
            out.append(x)
            continue
        seen = {}
        for part in parts[:12]:
            try:
                cols = pivot.column_names(part.path, preferred_table=part.preferred_table, table_candidates=part.table_candidates)
            except Exception as e:  # 読めない設備は飛ばす（ほかの設備の列で選べる）
                x["error"] = x["error"] or f"{part.name}: {e}"
                continue
            for col in cols:
                m = seen.setdefault(col["column"], {"column": col["column"], "samples": []})
                m["samples"] = list(dict.fromkeys(m["samples"] + col["samples"]))[:3]
        x["columns"] = list(seen.values())
        if not x["columns"] and failed:
            x["error"] = x["error"] or failed[0]["error"]
        out.append(x)
    return jsonify(sources=out)


def equip_tree(names, set_name=None):
    """設備グループのまとめ方ごとに、names の設備がどのグループに入るか（ルールも当てる）→ [{name, groups: [{name, members}]}]。
    set_name を決めればそのまとめ方だけ。どのグループにも入らない設備は、呼んだ所が「グループなし」にする（版 3.41.0）"""
    out = []
    for st in equip_groups.sets(master_repo().equip_groups()):
        if set_name and st["name"] != set_name:
            continue
        out.append({"name": st["name"], "groups": [{"name": g["name"], "members": equip_groups.members_in(g, names)} for g in st["groups"]]})
    return out


@bp.get("/api/dashboard/equip-tree")
def dashboard_equip_tree():
    """ダッシュボードのスライサーの設備（版 3.41.0）: 実際に出てくる設備（equipment_seen と同じ）と、設備グループのまとめ方ごとの入り方"""
    names = [x["name"] for x in equipment_seen()]
    return jsonify(names=names, sets=equip_tree(names))


def source_items(repo):
    """パネルに使えるデータ（データ元の並び）。作業実績は表示する設備も"""
    settings = effective_settings(current_app)
    wl_rows = repo.work_logs()
    out = []
    for d in data_sources.sources(settings, repo.data_source_rows()):
        key = d["key"] if d["key"] in ("lot", "work") else f"src:{d['key']}"
        x = {"key": key, "name": d["name"], "role": d["role"], "equip": bool(d.get("equipColumn")) or d["key"] == "work", "place": bool(d.get("place"))}
        if d["key"] == "work":
            x["equips"] = [{"key": r.get("キー"), "name": r.get("設備名")} for r in _shown_work(wl_rows)]
        out.append(x)
    return out


@bp.get("/api/dashboard/sources")
def dashboard_sources():
    """パネルに使えるデータ（データ元の並び）。作業実績は表示する設備も（設備を 1 つに絞れる）。"""
    repo = master_repo()
    # 設備グループのマスタ（版 3.39.0）: パネルの「設備をまとめる」で選ぶまとめ方
    return jsonify(items=source_items(repo), periods=pivot.PERIODS, egroupSets=equip_groups.sets(repo.equip_groups()))
