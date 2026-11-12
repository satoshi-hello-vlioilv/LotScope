# -*- coding: utf-8 -*-
"""ロット一覧（品質データ SQLite の写し）。"""
import logging

from ..web import current_app, jsonify, request

from .. import effective_settings, lot_engine, lot_list_params, shell_serves
from ..repositories.master_repository import MasterRepository
from ..services import conversions, lot_list, pivot
from .common import bp, error, tab_denied

log = logging.getLogger(__name__)


def lot_mirror():
    """参照先マスタの今の値に合わせてから返す（ほかの PC が参照先を直したら、次の問い合わせで切り替わる）。
    → (写しの係, いまのロット一覧の設定)。設定は1回の問い合わせで1回だけ読む（共有のマスタを読みに行くため）。"""
    settings = effective_settings(current_app)
    m = current_app.config["LOT_MIRROR"]
    want = lot_list_params(settings)
    # 参照先が「前に当てた値」から変わったときだけ切り替える（起動時の値は create_app が当てている）
    if want != current_app.config.get("LOT_APPLIED"):
        m.reconfigure(remote=want[0], interval_sec=want[1], stale_hours=want[2])
        current_app.config["LOT_APPLIED"] = want
    m.start()   # サーバー起動時に始まっていなければ、ここで始める（何度呼んでもよい）
    return m, settings.get("lot_list") or {}


def lotlist_plan(joined=True):
    """一覧を読む前の段取り → (段取り, 失敗の答え)。どちらか一方が None。
    段取り: 読むファイル（写しがあれば写し）・既定の表・既定の件数・いつのデータか。
    joined: データ元の結合を当てる（版 3.53.0。結合があれば、合わせた答えのファイルを読む。デスクトップ版の画面は engine=python を付けて Python に尋ねる）"""
    denied = tab_denied("lot", "品質") if joined else None       # タブの権限（版 3.58.0）: 出さない元は読ませない
    if denied:
        return None, denied
    m, ll = lot_mirror()
    if not m.enabled:
        return None, error("品質の元ファイルが決まっていません。「マスタ管理」の「データ元」で品質の場所を入れてください。", 400,
                           source=m.source_info())
    path = m.read_path()
    if not path:      # 写しがまだ無い（共有は直接読まない）。画面は写し終えたら引き直す
        return None, error(m.not_ready_text(), 503, "copying", source=m.source_info())
    plan = {"path": str(path), "table": ll.get("table", ""), "page_size": ll.get("page_size", 500), "source": m.source_info()}
    if not joined:
        return plan, None
    from .sources import source_def, with_joins
    s = source_def("lot")
    return with_joins(plan, s) if s else (plan, None)


def _lot_col():
    from .sources import lot_col_of
    return lot_col_of("lot")


@bp.get("/api/lotlist")
def lotlist():
    """WaveLog の /api/table と同じ引数（page, page_size, search, filters, sorts）で、写しから引く。
    group=1 はロット番号でまとめる（lot_list.grouped_rows）。デスクトップ版は Rust が同じ答えを作る（desktop/src/lotlist.rs）。"""
    plan, fail = lotlist_plan()
    if fail:
        return fail
    a = request.args
    try:
        out = lot_list.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"],
                             page=a.get("page", 1), page_size=a.get("page_size", plan["page_size"]),
                             search=a.get("search", ""), filters=a.get("filters", ""), sorts=a.get("sorts", ""), marks=a.get("marks", ""), calc=a.get("calc", ""),
                             group=a.get("group") == "1", lot_col=_lot_col())
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    out["source"] = plan["source"]
    return jsonify(out)


@bp.get("/api/lotlist/slicer")
def lotlist_slicer():
    """スライサーに並べる値（column の重複なしの値と件数。columns なら計算列の値の組）。filters・search は、このスライサー自身を除いた今の絞り込み。
    デスクトップ版は Rust が同じ答えを作る（desktop/src/lotlist.rs の slicer）。"""
    plan, fail = lotlist_plan()
    if fail:
        return fail
    a = request.args
    try:
        out = lot_list.slicer_answer(plan["path"], a, preferred_table=plan["table"])
    except ValueError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/lotlist/pivot")
def lotlist_pivot():
    """ピボット集計（services/pivot.py）。一覧と同じ絞り込みに当たる全件を数える。fields=1 なら左のカラムの札の手がかり。
    デスクトップ版は版 3.61.0 から窓の Rust（desktop/src/pivot.rs）が同じ答えを作る（ここは前の窓・engine=python・答え合わせの相手）。"""
    plan, fail = lotlist_plan()
    if fail:
        return fail
    a = request.args
    try:
        if a.get("fields") == "1":
            return jsonify(pivot.fields(plan["path"], table=a.get("table", ""), preferred_table=plan["table"]))
        out = pivot.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"], search=a.get("search", ""),
                          filters=a.get("filters", ""), rows=a.get("rows", ""), cols=a.get("cols", ""), measures=a.get("measures", ""),
                          month=a.get("month", ""), box=a.get("box", ""), lot_col=_lot_col())
    except pivot.PivotError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


# 束の節（版 3.102.0）と、節が使うマスタ。窓の desktop/src/bundle.rs の SECTIONS と同じ（tests/fixtures/bundle_cases.json）
SECTIONS = {"lot_list": ("path_settings",), "sources": ("data_sources", "path_settings"), "work": ("work_log_files", "path_settings"),
            "dash": ("work_log_files", "equipment_master", "equipment_groups"), "shifts": ("shift_patterns",), "conversions": ("conversions",)}


def section_broken(name, e=None):
    """節を組めない理由 → {why, file}。e が無ければ、節が使うマスタに表でない行・読めないファイルがあるかを見る（無ければ None）"""
    from ..repositories.master_repository import bad_rows_text
    from ..repositories.master_store import MasterUnreadable
    from .common import master_repo
    if e is None:
        repo = master_repo()
        for m in SECTIONS[name]:
            try:
                bad = repo.bad_rows(m)
            except MasterUnreadable as x:
                return {"why": str(x), "file": f"{m}.json"}
            if bad:
                return {"why": bad_rows_text(m, bad), "file": f"{m}.json"}
        return None
    return {"why": str(e) if isinstance(e, MasterUnreadable) else f"{type(e).__name__}: {e}", "file": ""}


@bp.get("/api/lotlist/settings")
def lotlist_settings():
    """デスクトップ版の Rust が尋ねる、いまの一覧の設定（参照先マスタで変えた値を重ねたもの）。写しと問い合わせは Rust が受け持つ。
    engine: "rust"（既定）か "python"（設定 desktop.lotlist_engine。食い違いに気づいたら Python に戻す）。
    conversions: 計算列の式の conv が引く変換表と版（版 3.59.0。計算列で並べ替える一覧も Rust が答える）。
    broken（版 3.102.0）: 組めない節 → {why（どのファイル・どの行）, file}。その節の値は null。窓はその節を使う道だけを 503 kind settings で断り、
    ほかの道は答え続ける（前は 1 つでも読めないと engine を黙って python にし lists を null にした）"""
    broken = {}

    def section(name, fn):
        why = section_broken(name)
        if why:
            broken[name] = why
            return None
        try:
            return fn()
        except Exception as e:
            log.warning("LOTLIST_SETTINGS section=%s broken: %s", name, e)
            broken[name] = section_broken(name, e)
            return None

    settings = effective_settings(current_app)
    ll = section("lot_list", lambda: (lot_list_params(settings), settings.get("lot_list") or {}))
    (source, refresh_seconds, stale_hours), ll = ll if ll else ((None, None, None), None)
    engine = lot_engine(current_app.config["APP_SETTINGS"])
    if "lists" not in shell_serves() and (tab_denied("lot") or _lot_col()):
        # 段取りを知らない前の窓（版 3.59.0 まで）: 品質のタブを出さない人・ロット番号の列を決めてある元は Python に任せる
        engine = "python"
    lists = lists_settings(section)
    try:
        # 権限の判定の材料（版 3.65.0。desktop/src/access.rs）: 名乗り（決めるのはまだ Python）と、マスタ・利用状況の置き場。
        # 窓はこの置き場から権限のマスタと切断の指示を自分で読み、me を決めて Python へ渡す（判定は窓の 1 か所）
        place = _access_place()
    except Exception:
        place = None     # 読めない: 窓は me を載せず、Python が自分で決める
    # calculation: 転写距離・ピッチ計算の設定（版 3.72.0。窓の desktop/src/calc.rs が POST /api/calculate に答える）。
    # 配った設定（APP_SETTINGS）の値そのもの（参照先マスタでは変えない。Python の calculator と同じ物）
    calculation = current_app.config["APP_SETTINGS"].get("calculation", {})
    conv = section("conversions", _conversions) or {"rev": None, "tables": {}}
    return jsonify(source=source, refresh_seconds=refresh_seconds, stale_hours=stale_hours, table=ll.get("table", "") if ll is not None else None,
                   page_size=ll.get("page_size", 500) if ll is not None else None, engine=engine, conversions=conv, lists=lists, access=place,
                   calculation=calculation, uiProfileKeys=_ui_profile_keys(), broken=broken)


def _ui_profile_keys():
    """表示の設定の範囲（版 3.78.0。窓〈desktop/src/ui_defaults.rs〉が GET／PUT /api/ui-defaults を答えるときの名前。決まりは services/ui_defaults.py の 1 か所）"""
    from ..services import ui_defaults
    return list(ui_defaults.PROFILE_KEYS)


def lists_settings(section=None):
    """一覧の段取りに要る物（版 3.60.0。デスクトップ版の Rust が品質・作業実績・データ元の一覧とスライサーを受け持つ: desktop/src/lists.rs）。
    hidden: この PC・このログインに出さないタブ（タブの権限）・sources: データ元の定義（場所・表・件数・ロット番号の列・結合・元）・
    work: 作業実績のフォルダ・決まり・設備の登録・shifts: 勤務体系（設備ごとの直）。マスタの中身を Python が読み、決めるのは Rust。
    section（版 3.102.0）: 節ごとに組む係（lotlist_settings の section。組めない節は null。無ければ組めないと落ちる）"""
    from .. import shell_serves
    from ..services import shifts, work_log
    from .common import can_write, master_repo, me
    from .sources import all_sources
    section = section or (lambda _name, fn: fn())
    # 窓が権限を受け持つとき（版 3.65.1）: 出さないタブ・勤務体系を直せるかは窓が自分の me から決める（判定の元を 1 つに）。ここでは決めない（null）。
    # 窓が me を決められないときは、窓はその問い合わせを Python に任せ、Python が自分の me で答える（null を「出さないタブ無し」と読ませない）
    shell_decides = "access" in shell_serves()
    if shell_decides:
        hidden = None
    else:
        try:
            hidden = list(me()["flags"]["hiddenTabs"])
        except Exception:
            hidden = []
    repo = master_repo()
    keep = ("key", "kind", "name", "role", "place", "table", "base", "broken", "api", "lotSet", "joins", "read", "equipColumn", "equipMode")
    from ..services import equip_groups
    from .dashboard import _equipment_names, _now_override

    def work():
        wl = work_log.params(effective_settings(current_app))
        return {**{k: wl[k] for k in ("folder", "pattern", "table", "refresh_seconds", "stale_hours", "page_size")},
                "rows": [{k: r.get(k) for k in ("キー", "設備名", "ファイル名", "ファイルID", "表示", "表", "並び")} for r in repo.work_logs()],
                "canEditShifts": None if shell_decides else can_write(shifts.NAME)}
    return {"hidden": hidden,
            # ダッシュボードの段取りの材料（版 3.62.0。desktop/src/dashboard.rs）: 設備の名前（データ元の設備の列の見分け・合わせた表の並び）・
            # 設備グループ（表示順の並びの view）・試験の「いま」（DASHBOARD_NOW。製品では null＝窓の時計）
            "dash": section("dash", lambda: {"equipNames": _equipment_names(repo, repo.work_logs()),
                                             "equipGroups": [equip_groups.view(r) for r in equip_groups.ordered(repo.equip_groups())],
                                             "now": _now_override()}),
            "sources": section("sources", lambda: [{k: s.get(k) for k in keep} for s in all_sources()]),
            "work": section("work", work),
            "shifts": section("shifts", repo.shift_patterns)}


def _access_place():
    from ..repositories.master_store import DEFAULTS_DIR
    from ..services import identity, presence
    st = current_app.config["MASTER_STORE"]
    st.follow_moved()                    # 置き場の決まり（引っ越し先の印・配る版の覚え）は Python が決め、窓はその答えを読む
    pdir = presence.presence_dir()
    who = identity.current()
    return {"who": {**who, "key": presence.terminal_key(who["login"], who["pc"])},
            "place": {"shareDir": str(st.share_dir) if st.share_dir is not None else "", "shared": sorted(st.shared_names),
                      "data": str(st.base / "data"), "defaults": str(DEFAULTS_DIR), "cache": str(st.cache_dir),
                      "presence": str(pdir) if pdir is not None else "", "lockTtl": st.lock_ttl}}


def _conversions():
    """計算列の式の conv が引く変換表と、その版（版 3.59.0。Rust も式を持ち、計算列で並べ替える一覧に答える。版が同じなら Rust は読み直さない）。
    読めなければ投げる（版 3.102.0: 束の節 conversions を「読めない」とする。前は黙って空の表にした）"""
    st = current_app.config["MASTER_STORE"]
    return {"rev": st.stamp(conversions.NAME), "tables": conversions.tables(MasterRepository(st).conversions())}


@bp.get("/api/lotlist/source")
def lotlist_source():
    """いま読んでいるデータはいつのものか（共有は見に行かない）。"""
    return jsonify(lot_mirror()[0].source_info())


@bp.post("/api/lotlist/refresh")
def lotlist_refresh():
    """「再読込」: 共有に新しい版があるかを今すぐ確かめ、あれば取り込む（変わっていなければ写さない・SHARED_READ.md の R2）。"""
    m, _ = lot_mirror()
    res = m.refresh()
    return jsonify(result=res, source=m.source_info())
