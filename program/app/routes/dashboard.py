"""ダッシュボード（services/dashboard.py）: ダッシュボードの組み（グリッドのパネル。共通デフォルト・共通・ID・標準）と、
パネルの数（どのデータ元でも同じ集計 pivot.query_many）。版 3.38.0 から「設備ごとの仕掛と前日の実績」も汎用の合わせた表（visual board）。"""
import json
import os
import re
import threading
from collections import OrderedDict
from datetime import datetime

from ..web import current_app, jsonify, request

from .. import effective_settings
from ..services import aggregate, dashboard, data_sources, equip_groups, pivot, shifts, work_log
from ..services.identity import normalize_part
from .common import base_rev, bp, error, find_row, master_call, master_repo
from .lotlist import lotlist_plan
from .presets import _gate, _who
from .sources import src_plan
from .worklog import worklog_plan


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
    rows = [r for r in master_repo().dashboards() if pp_visible(r, login)]
    std = dashboard.pivot_presets.standard_for(rows, dashboard.LAYOUT_SOURCE, login)
    items = sorted((dashboard.layout_view(r, login, common_ok, default_ok) for r in rows), key=lambda x: (SCOPE_ORDER[x["scope"]], x["name"]))
    items += dashboard.builtin_layouts()
    legacy = master_repo().dashboard_rows()       # 版 3.36.0 の 1 枚の表の条件（前の版で保存した 1 枚の表へ引き継ぐ）
    for x in items:
        dashboard.with_legacy_conditions(x["body"], legacy)
    return jsonify(items=items, login=login, canEditCommon=common_ok, canEditDefault=default_ok,
                   standardId=std.get("id") if std else items[-1]["id"], cols=dashboard.GRID_COLS,
                   rowsRange=[dashboard.ROWS_MIN, dashboard.ROWS_MAX])


def pp_visible(row, login):
    return row.get("元") == dashboard.LAYOUT_SOURCE and dashboard.pivot_presets.visible(row, login)


@bp.post("/api/dashboards")
def dashboards_create():
    """{name, scope: default|all|me, standard, body: {rows, panels}, note} を新しいダッシュボードとして置く。"""
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)

    def go():
        row = dashboard.clean_layout_row(request.get_json(force=True) or {}, login)
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
        if old is None:
            raise dashboard.LayoutError(f"id={item_id} が見つかりません（ほかの PC が消した可能性があります）。")
        _gate(old, login, common_ok, default_ok, revoked, "ダッシュボード")
        row = master_repo().dashboard_update(item_id, dashboard.clean_layout_row(request.get_json(force=True) or {}, login, partial=True), base)
        return dashboard.layout_view(row, login, common_ok, default_ok)
    return master_call(go)


@bp.delete("/api/dashboards/<int:item_id>")
def dashboards_delete(item_id):
    login, common_ok, default_ok, revoked = _who(dashboard.LAYOUT_NAME)
    base = base_rev()

    def go():
        old = find_row(master_repo().dashboards(), item_id)
        if old is not None:
            _gate(old, login, common_ok, default_ok, revoked, "ダッシュボード")
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
        for row in rows:
            name = str(row.get("設備名") or "")
            plan, fail = worklog_plan(key=row.get("キー"), rows=wl_rows)
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
    return {**hit, "sourceName": name, "mirrors": mirrors, "failed": failed, "now": stamp, **({"note": " ".join(x for x in (hit.get("note"), note) if x)} if note else {})}


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
    a = _link_answer(p, now) if p.get("link") else _split_answer(p, now)
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


@bp.get("/api/dashboard/sources")
def dashboard_sources():
    """パネルに使えるデータ（データ元の並び）。作業実績は表示する設備も（設備を 1 つに絞れる）。"""
    settings = effective_settings(current_app)
    repo = master_repo()
    wl_rows = repo.work_logs()
    out = []
    for d in data_sources.sources(settings, repo.data_source_rows()):
        key = d["key"] if d["key"] in ("lot", "work") else f"src:{d['key']}"
        x = {"key": key, "name": d["name"], "role": d["role"], "equip": bool(d.get("equipColumn")) or d["key"] == "work", "place": bool(d.get("place"))}
        if d["key"] == "work":
            x["equips"] = [{"key": r.get("キー"), "name": r.get("設備名")} for r in _shown_work(wl_rows)]
        out.append(x)
    # 設備グループのマスタ（版 3.39.0）: パネルの「設備をまとめる」で選ぶまとめ方
    return jsonify(items=out, periods=pivot.PERIODS, egroupSets=equip_groups.sets(repo.equip_groups()))
